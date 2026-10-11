import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { score } from './accumulator';
import { building, parcel } from './score-fixtures';
import ScoreboardPanel from './ScoreboardPanel.svelte';
import { M1_TARGETS } from './targets';
import type { Score } from './types';
import type { ScoreStatus } from './view';

const status = (s: Partial<ScoreStatus> = {}): ScoreStatus => ({
  pendingChunks: 0,
  failedChunks: 0,
  complete: true,
  datasetVersion: '2026-10-10-abcdef12',
  builtAt: '2026-10-10T12:00:00Z',
  mode: 'max',
  ...s
});

/** One parcel per neighborhood with the given net (vacant replacements). */
function scoreOf(hoods: Record<string, number>): Score {
  return score(
    Object.entries(hoods).map(([h, net], i) => {
      const p = parcel(String(8_000_000 + i), 0, h);
      return [p, building(p, net, true)] as [typeof p, ReturnType<typeof building>];
    }),
    M1_TARGETS
  );
}

function show(s: Score, st: ScoreStatus = status()) {
  const onretry = vi.fn();
  render(ScoreboardPanel, { props: { score: s, status: st, onretry } });
  return { onretry };
}

const COPY_LEADS = ['Theoretical max buildout.', 'Net, not gross.', 'Targets.'];

describe('ScoreboardPanel states (§4.4)', () => {
  it('empty: net 0, 0% on both targets, hint, no neighborhood disclosure', async () => {
    show(score([], M1_TARGETS));
    await expect.element(page.getByTestId('score-net')).toHaveTextContent('0');
    await expect.element(page.getByText('Paint a height on the map to add homes.')).toBeVisible();
    const meters = page.getByRole('meter');
    expect(meters.elements()).toHaveLength(2);
    for (const m of meters.elements()) expect(m.getAttribute('aria-valuetext')).toMatch(/^0% of /);
    expect(page.getByText('By neighborhood').elements()).toHaveLength(0);
  });

  it('badge and §4.6 copy are present in every state', async () => {
    for (const st of [
      status(),
      status({ pendingChunks: 2 }),
      status({ failedChunks: 1 }),
      status({ planDatasetVersion: 'fixture-0' })
    ]) {
      const screen = await render(ScoreboardPanel, {
        props: { score: scoreOf({ Mission: 5 }), status: st }
      });
      await expect
        .element(page.getByText('Theoretical max buildout', { exact: true }))
        .toBeVisible();
      for (const lead of COPY_LEADS)
        expect(page.getByText(lead, { exact: true }).elements().length).toBeGreaterThan(0);
      screen.unmount();
    }
  });

  it('updating: spinner and "Updating…", numbers shown as-is', async () => {
    show(scoreOf({ Mission: 5 }), status({ complete: false }));
    await expect.element(page.getByText('Updating…')).toBeVisible();
    await expect.element(page.getByTestId('score-net')).toHaveTextContent('5');
  });

  it('partial failure: warning text and Retry emits', async () => {
    const { onretry } = show(scoreOf({ Mission: 5 }), status({ failedChunks: 3 }));
    await expect
      .element(page.getByText("Some areas didn't load (3). Totals leave them out."))
      .toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    expect(onretry).toHaveBeenCalledTimes(1);
  });

  it('old plan: footnote adds the recalculated note; Sources links to /attribution', async () => {
    show(scoreOf({ Mission: 5 }), status({ planDatasetVersion: 'fixture-0' }));
    await expect
      .element(page.getByText(/plan made on data fixture-0, recalculated on current data/))
      .toBeVisible();
    await expect
      .element(page.getByText(/Data 2026-10-10-abcdef12 · built 2026-10-10/))
      .toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'Sources' }))
      .toHaveAttribute('href', '/attribution');
  });

  it('overshoot: "180%", fill past the tick, "over target"', async () => {
    show(scoreOf({ Mission: 147725 })); // 1.800009 of rhna
    const row = page.getByTestId('target-rhna');
    await expect.element(row.getByText('180%', { exact: true })).toBeVisible();
    await expect.element(row.getByText('65,656 over target')).toBeVisible();
    const fill = row.getByTestId('bar-fill').element() as HTMLElement;
    const tick = row.getByTestId('bar-tick').element() as HTMLElement;
    expect(fill.getBoundingClientRect().right).toBeGreaterThan(tick.getBoundingClientRect().left);
    expect(parseFloat(fill.style.width)).toBeCloseTo(90, 1); // track grows to 200%
    const meter = row.getByRole('meter').element();
    expect(meter.getAttribute('aria-valuemax')).toBe(String(2 * 82069));
    expect(meter.getAttribute('aria-valuenow')).toBe('147725');
    expect(meter.getAttribute('aria-valuetext')).toBe('180% of RHNA 2023–2031');
  });

  it('headline is net; gross only in the secondary line', async () => {
    const p = parcel('8100000', 3, 'Mission');
    show(score([[p, building(p, 12, true)]], M1_TARGETS));
    await expect.element(page.getByTestId('score-net')).toHaveTextContent('9');
    await expect.element(page.getByText('12 built · 3 replaced · 1 parcels changed')).toBeVisible();
  });

  it('targets render generically, keyed by id, first is primary', async () => {
    show(scoreOf({ Mission: 5 }));
    await expect.element(page.getByTestId('target-rhna')).toHaveAttribute('data-primary', 'true');
    await expect
      .element(page.getByTestId('target-rhna-buffer'))
      .toHaveAttribute('data-primary', 'false');
  });

  it('each target source link is shown under the copy', async () => {
    show(scoreOf({ Mission: 5 }));
    await page.getByText('What does this number mean?').click();
    const links = page.getByRole('link', { name: /RHNA Primer/ }).elements();
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe(M1_TARGETS[0].source.url);
  });
});

describe('neighborhood list', () => {
  it('sorts by net desc then name, shows top 10, then "Show all {k}"', async () => {
    const hoods: Record<string, number> = {};
    for (let i = 0; i < 12; i++) hoods[`Hood ${String.fromCharCode(65 + i)}`] = 100 - i;
    hoods['Aaa Tie'] = 100; // ties with Hood A → name order puts "Aaa Tie" first
    show(scoreOf(hoods));
    await page.getByText('By neighborhood').click();
    const items = () => page.getByTestId('hood-row').elements();
    await expect.poll(() => items().length).toBe(10);
    expect(items()[0].textContent).toContain('Aaa Tie');
    expect(items()[1].textContent).toContain('Hood A');
    await page.getByRole('button', { name: 'Show all 13' }).click();
    await expect.poll(() => items().length).toBe(13);
    expect(page.getByRole('button', { name: /Show all/ }).elements()).toHaveLength(0);
  });

  it('is collapsed by default', async () => {
    show(scoreOf({ Mission: 5 }));
    const details = page.getByText('By neighborhood').element().closest('details')!;
    expect(details.open).toBe(false);
  });
});
