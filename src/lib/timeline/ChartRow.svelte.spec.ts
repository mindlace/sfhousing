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
    const xs = [
      'chart-avg',
      'chart-avg-later',
      'chart-city',
      'chart-city-later',
      'chart-band',
      'chart-band-later'
    ]
      .map((id) => page.getByTestId(id).element().getAttribute('d')!)
      .flatMap(pathXs);
    const through = (5 / 23) * 1000;
    expect(Math.max(...xs)).toBeCloseTo(through, 1);
  });

  it('draws the part after the playhead lighter, and tells the lines apart by dash', async () => {
    await render(ChartRow, { props: { view: fullView(), index: 10, target: null } });
    const solid = page.getByTestId('chart-avg').element();
    const later = page.getByTestId('chart-avg-later').element();
    // Full-strength colour (so it keeps 3:1) told apart from the part before by dash.
    expect(later.getAttribute('stroke-opacity')).toBeNull();
    expect(later.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(solid.getAttribute('stroke-dasharray')).toBeNull();
    expect(
      page.getByTestId('chart-city-later').element().getAttribute('stroke-opacity')
    ).toBeNull();
    const city = page.getByTestId('chart-city').element();
    expect(city.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(solid.getAttribute('stroke-dasharray')).toBeNull();
    expect(Number(city.getAttribute('stroke-width'))).toBeLessThan(
      Number(solid.getAttribute('stroke-width'))
    );
  });

  it('shows the state target as a dashed marker', async () => {
    await render(ChartRow, {
      props: { view: fullView(), index: 0, target: { deadlineIndex: 12, units: 40 } }
    });
    expect(page.getByTestId('chart-target').element().getAttribute('stroke-dasharray')).toBe('5 3');
  });

  it("shows a month's three numbers on focus", async () => {
    const view = fullView();
    await render(ChartRow, { props: { view, index: 3, target: null } });
    await expect.element(page.getByTestId('chart-readout')).not.toBeInTheDocument();
    (page.getByRole('slider', { name: 'Month in the chart' }).element() as HTMLElement).focus();
    const readout = page.getByTestId('chart-readout');
    await expect.element(readout).toBeVisible();
    // chunk(): mean 3k, this city 3k + 1, at k = 3.
    await expect.element(readout).toHaveTextContent(/average 1,009,/);
    await expect.element(readout).toHaveTextContent(/this city 1,010/);
    await expect.element(readout).toHaveTextContent(/8 in 10 \d/);
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(readout).toHaveTextContent(/average 1,012/);
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
    // Month 0 of the fixture is 0 homes: the line starts at the baseline, below the target.
    const avgY = (id: string) =>
      Number(/M[\d.-]+,([\d.-]+)/.exec(page.getByTestId(id).element().getAttribute('d')!)![1]);
    const targetY = Number(page.getByTestId('chart-target').element().getAttribute('y1'));
    expect(avgY('chart-avg')).toBeGreaterThan(targetY);
    (page.getByRole('slider', { name: 'Month in the chart' }).element() as HTMLElement).focus();
    await expect.element(page.getByTestId('chart-readout')).toHaveTextContent(/average 1,000,/);
    await expect.element(page.getByTestId('chart-readout')).toHaveTextContent(/8 in 10 1,0/);
  });

  it("each legend explanation keeps a 24 px target clear of the chart's slider (WCAG 2.5.8)", async () => {
    await render(ChartRow, { props: { view: fullView(), index: 0, target: null } });
    const slider = page.getByRole('slider', { name: 'Month in the chart' }).element();
    const s = slider.getBoundingClientRect();
    const buttons = [...document.querySelectorAll<HTMLElement>('.legend button')];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      const r = b.getBoundingClientRect();
      // The 24 px circle around the target's centre stays below the slider.
      expect(r.top + r.height / 2 - 12, b.textContent!).toBeGreaterThanOrEqual(s.bottom);
    }
  });

  it('draws no marks and no overlay without a view', async () => {
    await render(ChartRow, { props: { view: null, index: 0, target: null } });
    await expect.element(page.getByTestId('chart-avg')).not.toBeInTheDocument();
    await expect.element(page.getByRole('slider')).not.toBeInTheDocument();
  });
});
