/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import type { TimelineView } from '$lib/sim/world/score/types';
import { EMPTY_LOG, logCompiled, logFilled, viewOfLog } from './chunk-log';
import ChartRow from './ChartRow.svelte';
import { chunk, cut, statics } from './test/fixtures';

function fullView(): TimelineView {
  const log = logFilled(logCompiled(EMPTY_LOG, statics()), chunk(0, 24));
  return viewOfLog(log)!;
}

const pathXs = (d: string) =>
  [...d.matchAll(/[ML]([\d.-]+),/g)].map((m) => Number(m[1])).filter((n) => !Number.isNaN(n));

describe('ChartRow', () => {
  it('draws nothing past the filled mark and names itself', async () => {
    const view = cut(fullView(), 5);
    await render(ChartRow, { props: { view, index: 2, target: null } });
    const fig = page.getByRole('figure', { name: 'Net new homes by month' });
    await expect.element(fig).toBeVisible();
    expect(fig.element().querySelector('figcaption')!.textContent).toMatch(/Results table/);
    const xs = ['chart-line', 'chart-line-later']
      .map((id) => page.getByTestId(id).element().getAttribute('d')!)
      .flatMap(pathXs);
    const through = (5 / 23) * 1000;
    expect(Math.max(...xs)).toBeCloseTo(through, 1);
  });

  it('draws one line through the filled mark and no band, average or city', async () => {
    await render(ChartRow, { props: { view: cut(fullView(), 5), index: 2, target: null } });
    for (const id of [
      'chart-band',
      'chart-band-later',
      'chart-avg',
      'chart-avg-later',
      'chart-city',
      'chart-city-later'
    ]) {
      expect(document.querySelector(`[data-testid="${id}"]`), id).toBeNull();
    }
    expect(document.querySelector('[data-testid="chart-line"]')).not.toBeNull();
  });

  it('draws the part after the playhead dashed at full colour', async () => {
    await render(ChartRow, { props: { view: fullView(), index: 10, target: null } });
    const solid = page.getByTestId('chart-line').element();
    const later = page.getByTestId('chart-line-later').element();
    expect(solid.getAttribute('stroke-dasharray')).toBeNull();
    expect(later.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(later.getAttribute('stroke-opacity')).toBeNull();
  });

  it('shows the state target as a dashed marker', async () => {
    await render(ChartRow, {
      props: { view: fullView(), index: 0, target: { deadlineIndex: 12, units: 40 } }
    });
    expect(page.getByTestId('chart-target').element().getAttribute('stroke-dasharray')).toBe('5 3');
  });

  it("reads out the month's homes completed", async () => {
    const view = fullView();
    await render(ChartRow, { props: { view, index: 3, target: null } });
    await expect.element(page.getByTestId('chart-readout')).not.toBeInTheDocument();
    (page.getByRole('slider', { name: 'Month in the chart' }).element() as HTMLElement).focus();
    const readout = page.getByTestId('chart-readout');
    await expect.element(readout).toBeVisible();
    // chunk(): shown = 3k + 1 at k = 3, on the 1,000 baseline.
    await expect.element(readout).toHaveTextContent(/: 1,010 homes completed$/);
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(readout).toHaveTextContent(/: 1,013 homes completed$/);
  });

  it('shows the numbers on hover', async () => {
    await render(ChartRow, { props: { view: fullView(), index: 0, target: null } });
    const el = page.getByRole('slider', { name: 'Month in the chart' });
    await el.hover();
    await expect.element(page.getByTestId('chart-readout')).toBeVisible();
  });

  it('plots and reads out completed net homes with the baseline added', async () => {
    const view = fullView();
    expect(view.baseline.completedNet).toBe(1000);
    await render(ChartRow, {
      props: { view, index: 0, target: { deadlineIndex: 12, units: 1020 } }
    });
    // Month 0 of the fixture is 1 home: the line starts at the baseline, below the target.
    const lineY = Number(
      /M[\d.-]+,([\d.-]+)/.exec(page.getByTestId('chart-line').element().getAttribute('d')!)![1]
    );
    const targetY = Number(page.getByTestId('chart-target').element().getAttribute('y1'));
    expect(lineY).toBeGreaterThan(targetY);
    (page.getByRole('slider', { name: 'Month in the chart' }).element() as HTMLElement).focus();
    await expect.element(page.getByTestId('chart-readout')).toHaveTextContent(/: 1,001 homes/);
  });

  it('keeps a falling line inside the plot', async () => {
    const view = fullView();
    const rows = view.rows.map((r, i) => ({ ...r, completedNet: -1500 * i }));
    await render(ChartRow, { props: { view: { ...view, rows }, index: 0, target: null } });
    const d = page.getByTestId('chart-line-later').element().getAttribute('d')!;
    const ys = [...d.matchAll(/[ML][\d.-]+,([\d.-]+)/g)].map((m) => Number(m[1]));
    expect(ys.length).toBeGreaterThan(1);
    for (const v of ys) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('names two legend entries and explains neither', async () => {
    await render(ChartRow, { props: { view: fullView(), index: 0, target: null } });
    const names = [...document.querySelectorAll('.legend li')].map((li) => li.textContent!.trim());
    expect(names).toEqual(['Homes completed', 'State target']);
    expect(document.querySelectorAll('.legend button').length).toBe(0);
  });

  it('draws no marks and no overlay without a view', async () => {
    await render(ChartRow, { props: { view: null, index: 0, target: null } });
    await expect.element(page.getByTestId('chart-line')).not.toBeInTheDocument();
    await expect.element(page.getByRole('slider')).not.toBeInTheDocument();
  });
});
