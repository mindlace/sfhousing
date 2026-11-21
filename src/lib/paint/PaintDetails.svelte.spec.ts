/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { capacityGoalText } from './headline';
import PaintDetails from './PaintDetails.svelte';
import { M1_TARGETS, score as computeScore, type Score, type ScoreStatus } from '$lib/scoreboard';
import { building, parcel } from '$lib/scoreboard/score-fixtures';

const status = (s: Partial<ScoreStatus> = {}): ScoreStatus => ({
  pendingChunks: 0,
  failedChunks: 0,
  complete: true,
  datasetVersion: '2026-10-10-abcdef12',
  builtAt: '2026-10-10T12:00:00Z',
  mode: 'max',
  ...s
});

/** One vacant parcel per neighborhood with the given net. */
function scoreOf(hoods: Record<string, number>): Score {
  return computeScore(
    Object.entries(hoods).map(([h, net], i) => {
      const p = parcel(String(8_000_000 + i), 0, h);
      return [p, building(p, net, true)] as [typeof p, ReturnType<typeof building>];
    }),
    M1_TARGETS
  );
}

/**
 * Renders the panel with the pointer at rest: the pointer stays where an earlier test left it, so
 * it moves to the panel's own box (which opens nothing) and the test goes on once no tooltip is
 * open.
 */
async function renderAtRest(s: Score, st: ScoreStatus = status()) {
  const onretry = vi.fn();
  const screen = await render(PaintDetails, { props: { score: s, status: st, onretry } });
  await userEvent.hover(page.getByTestId('paint-details'));
  await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument();
  return { screen, onretry };
}

const panel = () => page.getByTestId('paint-details').element();

describe('PaintDetails', () => {
  it("shows the two goal rows at the headline's share: net over 82,069 and 94,379", async () => {
    await page.viewport(1024, 768);
    await renderAtRest(scoreOf({ Mission: 1_000, Sunset: 234 }));
    const goal = page.getByTestId('goal-row-goal');
    const buffer = page.getByTestId('goal-row-buffer');
    await expect.element(goal).toHaveAttribute('data-primary', 'true');
    await expect.element(buffer).toHaveAttribute('data-primary', 'false');
    // The goal row's percentage is the header's line 2.
    expect(capacityGoalText(1_234)).toBe('1.5% of the goal');
    await expect.element(goal.getByText('1.5%', { exact: true })).toBeVisible();
    await expect.element(goal.getByText('80,835 to go', { exact: true })).toBeVisible();
    await expect.element(buffer.getByText('1.3%', { exact: true })).toBeVisible();
    await expect.element(buffer.getByText('93,145 to go', { exact: true })).toBeVisible();
    const meters = page.getByRole('meter').elements();
    expect(meters.map((m) => m.getAttribute('aria-label'))).toEqual([
      'State target',
      'State target + 15%'
    ]);
    expect(meters.map((m) => m.getAttribute('aria-valuenow'))).toEqual(['1234', '1234']);
    // Then the counts, the neighborhoods and what room for homes means.
    await expect
      .element(page.getByText('1,234 built · 0 replaced · 2 lots changed', { exact: true }))
      .toBeVisible();
    await expect.element(page.getByText('By neighborhood', { exact: true })).toBeVisible();
    await page.getByText('What room for homes means', { exact: true }).click();
    await expect
      .element(
        page.getByText('Every eligible lot you painted, rebuilt to its height at once.', {
          exact: true
        })
      )
      .toBeVisible();
    await expect
      .element(page.getByText('Homes in replaced buildings are subtracted.', { exact: true }))
      .toBeVisible();
  });

  it('names no RHNA and repeats no headline or badge', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(scoreOf({ Mission: 5 }), status({ planDatasetVersion: 'fixture-0' }));
    for (const d of panel().querySelectorAll('details')) d.open = true;
    const text = panel().textContent ?? '';
    expect(text).not.toMatch(/RHNA/);
    expect(text).not.toMatch(/Theoretical max buildout/i);
    expect(text).not.toMatch(/net new homes/);
    expect(text).not.toMatch(/Room for/);
    expect(document.querySelector('[data-testid="score-net"]')).toBeNull();
  });

  it('empty plan: the empty line and no counts', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(scoreOf({}));
    await expect
      .element(page.getByText('Paint a height on the map to add homes.', { exact: true }))
      .toBeVisible();
    expect(panel().textContent).not.toMatch(/built ·/);
    expect(page.getByText('By neighborhood').elements()).toHaveLength(0);
    // The rows stay, at 0%.
    const meters = page.getByRole('meter').elements();
    expect(meters.map((m) => m.getAttribute('aria-valuetext'))).toEqual([
      '0% of State target',
      '0% of State target + 15%'
    ]);
  });

  it('failed areas: the line and Retry calls onretry', async () => {
    await page.viewport(1024, 768);
    const { onretry } = await renderAtRest(
      scoreOf({ Mission: 5 }),
      status({ failedChunks: 3, complete: false })
    );
    await expect
      .element(page.getByText("Some areas didn't load (3). Totals leave them out."))
      .toBeVisible();
    expect(page.getByText('Updating…').elements()).toHaveLength(0);
    await page.getByRole('button', { name: 'Retry' }).click();
    expect(onretry).toHaveBeenCalledTimes(1);
  });

  it('updating: Updating… first; the footnote names the data, Sources and an old plan', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(
      scoreOf({ Mission: 5 }),
      status({ complete: false, planDatasetVersion: 'fixture-0' })
    );
    await expect.element(page.getByText('Updating…')).toBeVisible();
    const first = panel().querySelector('p');
    expect(first?.textContent?.trim()).toBe('Updating…');
    await expect
      .element(page.getByText(/Data 2026-10-10-abcdef12 · built 2026-10-10/))
      .toBeVisible();
    await expect
      .element(page.getByText(/plan made on data fixture-0, recalculated on current data/))
      .toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'Sources' }))
      .toHaveAttribute('href', '/attribution');
  });
});
