/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { dayFromUtc } from '$lib/fzp/time';
import type { TimelineView } from '$lib/sim/world/score/types';
import { EMPTY_LOG, logCompiled, logFilled, viewOfLog } from './chunk-log';
import ChartRow from './ChartRow.svelte';
import Ruler from './Ruler.svelte';
import { chunk, cut, statics } from './test/fixtures';
import { vi } from 'vitest';

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
    const xs = ['chart-avg', 'chart-avg-later', 'chart-city', 'chart-band', 'chart-band-later']
      .map((id) => page.getByTestId(id).element().getAttribute('d')!)
      .flatMap(pathXs);
    const through = (5 / 23) * 1000;
    expect(Math.max(...xs)).toBeCloseTo(through, 1);
  });

  it('draws the part after the playhead lighter, and tells the lines apart by dash', async () => {
    await render(ChartRow, { props: { view: fullView(), index: 10, target: null } });
    const solid = page.getByTestId('chart-avg').element();
    const later = page.getByTestId('chart-avg-later').element();
    expect(later.getAttribute('stroke-opacity')).toBe('0.45');
    expect(solid.getAttribute('stroke-opacity')).toBeNull();
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
    await expect.element(readout).toHaveTextContent(/average 9,/);
    await expect.element(readout).toHaveTextContent(/this city 10/);
    await expect.element(readout).toHaveTextContent(/8 in 10 \d/);
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(readout).toHaveTextContent(/average 12/);
  });

  it('shows the numbers on hover and nothing without a view', async () => {
    await render(ChartRow, { props: { view: fullView(), index: 0, target: null } });
    const el = page.getByRole('slider', { name: 'Month in the chart' });
    await el.hover();
    await expect.element(page.getByTestId('chart-readout')).toBeVisible();
  });

  it('draws no marks and no overlay without a view', async () => {
    await render(ChartRow, { props: { view: null, index: 0, target: null } });
    await expect.element(page.getByTestId('chart-avg')).not.toBeInTheDocument();
    await expect.element(page.getByRole('slider')).not.toBeInTheDocument();
  });
});

describe('Ruler', () => {
  const asOf = dayFromUtc(2026, 10, 15);
  const windowEnd = dayFromUtc(2066, 10, 31);
  it('labels the years from the dataset date, fills to the mark and jumps from markers', async () => {
    const onjump = vi.fn();
    const rhna = dayFromUtc(2031, 1, 31);
    await render(Ruler, {
      props: {
        asOf,
        windowEnd,
        filledEnd: dayFromUtc(2046, 10, 15),
        markers: [
          { day: rhna, label: 'RHNA deadline', name: 'Jump to RHNA deadline, January 2031' },
          { day: dayFromUtc(2045, 1, 1), label: '2045', name: 'Jump to 2045' }
        ],
        onjump
      }
    });
    await expect.element(page.getByText('2026')).toBeVisible();
    await expect.element(page.getByText('2066')).toBeVisible();
    const filled = page.getByTestId('tl-ruler-filled').element() as HTMLElement;
    expect(parseFloat(filled.style.width)).toBeCloseTo(50, 0);
    await page.getByRole('button', { name: 'Jump to RHNA deadline, January 2031' }).click();
    expect(onjump).toHaveBeenCalledWith(rhna);
  });
});
