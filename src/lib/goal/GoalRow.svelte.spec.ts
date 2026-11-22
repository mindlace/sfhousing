/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import GoalRow from './GoalRow.svelte';
import type { GoalRowData } from './goal';

const row = (over: Partial<GoalRowData> = {}): GoalRowData => ({
  id: 'goal',
  label: 'Goal',
  amount: 82_069,
  value: 8_723,
  fraction: 8_723 / 82_069,
  note: 'by Jan 2031',
  atDeadline: null,
  ...over
});

/**
 * Renders the row with the pointer at rest: the pointer stays where an earlier test or file left
 * it, so it moves to the row's own box (which opens nothing) and the test goes on once no
 * tooltip is open.
 */
async function renderAtRest(r: GoalRowData, primary = true) {
  const screen = await render(GoalRow, { props: { row: r, max: 1, primary } });
  await userEvent.hover(page.getByTestId(`goal-row-${r.id}`));
  await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument();
  return screen;
}

const rowEl = (id = 'goal') => page.getByTestId(`goal-row-${id}`).element();

describe('GoalRow', () => {
  it('a meter named by the label, with the remainder and the note after it', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(row());
    const meter = page.getByRole('meter', { name: 'Goal' });
    await expect.element(meter).toBeInTheDocument();
    expect(meter.element().getAttribute('aria-valuetext')).toBe('10% of Goal');
    expect(meter.element().getAttribute('aria-valuenow')).toBe('8723');
    expect(meter.element().getAttribute('aria-valuemax')).toBe('82069');
    expect(rowEl().getAttribute('data-primary')).toBe('true');
    const lines = [...rowEl().querySelectorAll('p')].map((p) => p.textContent!.trim());
    expect(lines).toEqual(['73,346 to go by Jan 2031']);
    expect(rowEl().textContent).not.toMatch(/RHNA/);
    // No caption under the tick: the label names the goal.
    const spans = [...rowEl().querySelectorAll('span')].map((s) => s.textContent!.trim());
    expect(spans).not.toContain('target');
  });

  it('a held row shows Held at Jan 2031 on its own muted line', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(row({ id: 'buffer', label: 'Goal + 15%', note: 'Held at Jan 2031' }), false);
    expect(rowEl('buffer').getAttribute('data-primary')).toBe('false');
    const lines = [...rowEl('buffer').querySelectorAll('p')];
    expect(lines.map((p) => p.textContent!.trim())).toEqual(['73,346 to go', 'Held at Jan 2031']);
    expect(lines[1].className).toContain('text-ink-muted');
  });

  it('the deadline preview line shows only when atDeadline is a number', async () => {
    await page.viewport(1024, 768);
    const screen = await renderAtRest(row());
    expect(rowEl().textContent).not.toContain('At the deadline');
    await screen.rerender({ row: row({ atDeadline: 0.74 }), max: 1, primary: true });
    await expect.element(page.getByText('At the deadline: 74%')).toBeInTheDocument();
    await screen.rerender({ row: row({ atDeadline: 0 }), max: 1, primary: true });
    await expect.element(page.getByText('At the deadline: 0%')).toBeInTheDocument();
  });

  it('a Paint row (no note) shows the remainder alone', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(row({ note: null, value: 90_000, fraction: 90_000 / 82_069 }));
    const lines = [...rowEl().querySelectorAll('p')].map((p) => p.textContent!.trim());
    expect(lines).toEqual(['7,931 over target']);
  });
});
