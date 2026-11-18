/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import type { TimelineView } from '$lib/sim/world/score/types';
import type { Day } from '$lib/timelapse/time';
import { EMPTY_LOG, logCompiled, logFilled, viewOfLog } from './chunk-log';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import { monthLastDay } from '$lib/sim/world/months';
import ChartRow from './ChartRow.svelte';
import { yearMarks } from './axis';
import { chartPoints, gapPath, linePath, posOf, runningMax, yLabels, yTop } from './chart-model';
import { chartCaption, goalNote, homesBy } from './copy';
import { filledEndDay } from './playhead';
import { playheadAt } from './results';
import { dayPct } from './rows';
import { calendarMonths, chunk, statics } from './test/fixtures';

// The path builders as they are, counted: a rebuild is a call, whatever string it yields.
vi.mock('./chart-model', async (importOriginal) => {
  const real = await importOriginal<typeof import('./chart-model')>();
  return { ...real, linePath: vi.fn(real.linePath), gapPath: vi.fn(real.gapPath) };
});

/** Calendar months from Nov 2026 (`statics()` spaces months 30 days apart), today their first. */
function fullView(): TimelineView {
  const log = logFilled(logCompiled(EMPTY_LOG, statics()), chunk(0, 24));
  return calendarMonths(viewOfLog(log)!);
}
const asOf = fullView().months[0];
const windowEnd = monthLastDay(asOf, WINDOW_MONTHS);
const W = 1000;
const LAST = 23;
/** The last day of the last row's month: where the playhead stops. */
const lastDay = (v: TimelineView) => filledEndDay(v.months, v.months.length - 1, asOf);
const xOf = (d: Day) => (dayPct(d, asOf, windowEnd) / 100) * W;

type Props = {
  asOf: Day;
  windowEnd: Day;
  view: TimelineView | null;
  inForce: boolean;
  day: Day;
  reached: Day;
  target: { deadlineIndex: number; units: number } | null;
  stale: boolean;
};
const props = (over: Partial<Props> = {}): Props => ({
  asOf,
  windowEnd,
  view: fullView(),
  inForce: false,
  day: asOf,
  reached: asOf,
  target: null,
  stale: false,
  ...over
});

const attr = (id: string, name: string) => page.getByTestId(id).element().getAttribute(name);
const num = (id: string, name: string) => Number(attr(id, name));
const legendNames = () =>
  [...document.querySelectorAll('.legend li')].map((li) => li.textContent!.trim());
const ysOf = (d: string) => [...d.matchAll(/[ML][\d.-]+,([\d.-]+)/g)].map((m) => Number(m[1]));
const firstPoint = (d: string) => /^M([\d.-]+),([\d.-]+)/.exec(d)!.slice(1).map(Number);
const overlay = () => page.getByRole('slider', { name: 'Month in the chart' });

describe('ChartRow', () => {
  it('one line when nothing is in force; two lines and the gap with a policy', async () => {
    const view = fullView();
    const end = lastDay(view);
    const { rerender } = await render(ChartRow, {
      props: props({ view, day: end, reached: end })
    });
    await expect.element(page.getByTestId('chart-line')).toBeInTheDocument();
    expect(document.querySelector('[data-testid=chart-law]')).toBeNull();
    expect(document.querySelector('[data-testid=chart-gap]')).toBeNull();
    await rerender({ inForce: true });
    await expect.element(page.getByTestId('chart-law')).toBeInTheDocument();
    await expect.element(page.getByTestId('chart-gap')).toBeInTheDocument();
    // Each is drawn twice, once per zone, from the same path.
    for (const id of ['chart-line', 'chart-law', 'chart-gap'])
      expect(attr(`${id}-seen`, 'd'), id).toBe(attr(id, 'd'));
    expect(attr('chart-gap', 'd')).toMatch(/Z$/);
  });

  it('the legend names only what is drawn', async () => {
    const target = { deadlineIndex: 12, units: 40 };
    const { rerender } = await render(ChartRow, { props: props({ target }) });
    expect(legendNames()).toEqual(['Homes completed', 'Goal']);
    await rerender({ inForce: true });
    expect(legendNames()).toEqual(['With your policy', 'Current law', 'From your policy', 'Goal']);
    await rerender({ target: null });
    expect(legendNames()).toEqual(['With your policy', 'Current law', 'From your policy']);
    await rerender({ inForce: false });
    expect(legendNames()).toEqual(['Homes completed']);
    expect(document.querySelectorAll('.legend button')).toHaveLength(0);
  });

  it('starts at zero at today', async () => {
    await render(ChartRow, { props: props({ inForce: true }) });
    for (const id of ['chart-line', 'chart-law']) {
      const [x, y] = firstPoint(attr(id, 'd')!);
      expect(x, id).toBe(0);
      // The plot's floor is 0 (nothing below it), 2 units above the bottom edge.
      expect(y, id).toBe(98);
    }
  });

  it('solid to the day, thinner to the furthest date, nothing past it', async () => {
    const view = fullView();
    const day = view.months[5] + 10;
    const reached = view.months[12] + 3;
    const { rerender } = await render(ChartRow, { props: props({ view, day, reached }) });
    await expect.element(page.getByTestId('chart-clip-shown')).toBeInTheDocument();
    expect(num('chart-clip-shown', 'x')).toBe(0);
    expect(num('chart-clip-shown', 'width')).toBeCloseTo(xOf(day), 1);
    expect(num('chart-clip-seen', 'x')).toBeCloseTo(xOf(day), 1);
    expect(num('chart-clip-seen', 'width')).toBeCloseTo(xOf(reached) - xOf(day), 1);
    expect(num('chart-line', 'stroke-width')).toBe(2.5);
    expect(num('chart-line-seen', 'stroke-width')).toBe(1.25);
    expect(attr('chart-line', 'stroke')).toBe('var(--chart-total)');
    expect(attr('chart-line-seen', 'stroke')).toBe('var(--chart-total-seen)');
    // Each copy is cut by its own zone.
    const clipOf = (id: string) => page.getByTestId(id).element().closest('g[clip-path]')!;
    const ref = (id: string) => `url(#${page.getByTestId(id).element().parentElement!.id})`;
    expect(clipOf('chart-line').getAttribute('clip-path')).toBe(ref('chart-clip-shown'));
    expect(clipOf('chart-line-seen').getAttribute('clip-path')).toBe(ref('chart-clip-seen'));
    // At the last day, or reached past it, the zones reach the plot's end: no gap.
    const end = lastDay(view);
    await rerender({ day: view.months[5] + 10, reached: end });
    expect(num('chart-clip-seen', 'x') + num('chart-clip-seen', 'width')).toBeCloseTo(W, 6);
    await rerender({ day: end, reached: end });
    expect(num('chart-clip-shown', 'width')).toBeCloseTo(W, 6);
    expect(num('chart-clip-seen', 'width')).toBeCloseTo(0, 6);
    // At today nothing is drawn in either zone.
    await rerender({ day: asOf, reached: asOf });
    expect(num('chart-clip-shown', 'width')).toBe(0);
    expect(num('chart-clip-seen', 'width')).toBe(0);
  });

  it('while stale everything takes the seen styling', async () => {
    const view = fullView();
    const day = view.months[5] + 10;
    await render(ChartRow, {
      props: props({ view, day, reached: day, inForce: true, stale: true })
    });
    const fig = page.getByRole('figure', { name: 'Homes completed' });
    await expect.element(fig).toHaveAttribute('data-stale', 'true');
    expect(attr('chart-line', 'stroke')).toBe('var(--chart-total-seen)');
    expect(num('chart-line', 'stroke-width')).toBe(1.25);
    expect(attr('chart-law', 'stroke')).toBe('var(--chart-law-seen)');
  });

  it("labels the vertical axis and shares the ruler's years", async () => {
    const view = fullView();
    const target = { deadlineIndex: 12, units: 40 };
    const reached = view.months[5] + 10;
    await render(ChartRow, { props: props({ view, day: reached, reached, target }) });
    const pos = posOf(playheadAt(view.months, asOf, reached));
    const top = yTop(40, runningMax(chartPoints(view, false)), pos);
    expect(top).toBe(50);
    await expect.element(page.getByTestId('chart-ylabel').first()).toBeInTheDocument();
    const labels = [...document.querySelectorAll('[data-testid=chart-ylabel]')].map((e) =>
      e.textContent!.trim()
    );
    expect(labels).toEqual(yLabels(top).map((l) => l.label));
    const marks = yearMarks(asOf, windowEnd);
    const years = [...document.querySelectorAll('[data-testid=chart-year]')];
    expect(years).toHaveLength(marks.length);
    years.forEach((el, k) => {
      expect(Number(el.getAttribute('x1'))).toBeCloseTo((marks[k].pct / 100) * W, 1);
    });
  });

  it('draws the goal step at the homes still needed and says so', async () => {
    const view = fullView();
    const target = { deadlineIndex: 12, units: 40 };
    await render(ChartRow, { props: props({ view, target }) });
    await expect
      .element(page.getByTestId('chart-target-note'))
      .toHaveTextContent(goalNote(40, view.months[12]));
    // The scale at today: niceCeil(40) = 50, so 40 sits a fifth of the way down the plot.
    expect(num('chart-target', 'y1')).toBeCloseTo(2 + (1 - 40 / 50) * 96, 1);
    // The step ends at the end of the deadline's month, where the ruler's goal flag sits.
    expect(num('chart-target', 'x2')).toBeCloseTo(xOf(filledEndDay(view.months, 12, asOf)), 1);
  });

  it("the readout at the playhead is the header's line 1, at today and at the end", async () => {
    const view = fullView();
    const { rerender } = await render(ChartRow, { props: props({ view }) });
    await expect.element(page.getByTestId('chart-readout')).not.toBeInTheDocument();
    (overlay().element() as HTMLElement).focus();
    await expect.element(page.getByTestId('chart-readout')).toHaveTextContent('0 homes by today');
    await expect.element(overlay()).toHaveAttribute('aria-valuetext', '0 homes by today');
    (overlay().element() as HTMLElement).blur();
    const end = lastDay(view);
    await rerender({ day: end, reached: end });
    (overlay().element() as HTMLElement).focus();
    const text = homesBy(view.rows[LAST].completedNet, view.months[LAST]);
    await expect.element(page.getByTestId('chart-readout')).toHaveTextContent(text);
    await expect.element(overlay()).toHaveAttribute('aria-valuetext', text);
  });

  it('the overlay reads only the months reached', async () => {
    const view = fullView();
    const reached = view.months[6] + 4;
    await render(ChartRow, { props: props({ view, day: view.months[3] + 2, reached }) });
    const max = posOf(playheadAt(view.months, asOf, reached));
    expect(max).toBe(7);
    await expect.element(overlay()).toHaveAttribute('aria-valuemax', String(max));
    await expect.element(overlay()).toHaveAttribute('aria-valuenow', '4');
    (overlay().element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowRight>6/}');
    await expect.element(overlay()).toHaveAttribute('aria-valuenow', String(max));
    await expect
      .element(page.getByTestId('chart-readout'))
      .toHaveTextContent(homesBy(view.rows[6].completedNet, view.months[6]));
  });

  it('shows the numbers on hover', async () => {
    const view = fullView();
    const end = lastDay(view);
    await render(ChartRow, { props: props({ view, day: end, reached: end }) });
    await overlay().hover();
    await expect.element(page.getByTestId('chart-readout')).toBeVisible();
  });

  it('moving the day and the furthest date writes no path and reads no row', async () => {
    const base = fullView();
    let reads = 0;
    const counted = <T extends object>(a: T[]): T[] =>
      new Proxy(a, {
        get(t, p, r) {
          if (typeof p === 'string' && /^\d+$/.test(p)) reads++;
          return Reflect.get(t, p, r);
        }
      });
    const view = { ...base, rows: counted(base.rows), planEffect: counted(base.planEffect) };
    const m = base.months[7];
    const { rerender } = await render(ChartRow, {
      props: props({
        view,
        inForce: true,
        day: m,
        reached: m + 5,
        target: { deadlineIndex: 12, units: 40 }
      })
    });
    await expect.element(page.getByTestId('chart-gap')).toBeInTheDocument();
    const svg = page.getByTestId('chart-svg').element();
    let paths = 0;
    const pathObs = new MutationObserver((r) => (paths += r.length));
    pathObs.observe(svg, { attributeFilter: ['d'], subtree: true });
    let clips = 0;
    const clipObs = new MutationObserver((r) => (clips += r.length));
    clipObs.observe(svg, { attributeFilter: ['x', 'width'], subtree: true });
    reads = 0;
    const builds = () =>
      vi.mocked(linePath).mock.calls.length + vi.mocked(gapPath).mock.calls.length;
    const built = builds();
    for (let k = 1; k <= 20; k++) await rerender({ day: m + k, reached: m + k + 5 });
    // Inside the month: no row read at all.
    expect(reads).toBe(0);
    // Across a month where the scale holds (the goal's 40 tops every value to month 16: 50),
    // only the overlay's value text reads its one month (a row and its effect).
    const n = base.months[8];
    for (let k = 0; k < 5; k++) await rerender({ day: n + k, reached: n + k + 5 });
    expect(reads).toBeLessThanOrEqual(2);
    expect(builds() - built).toBe(0);
    paths += pathObs.takeRecords().length;
    clips += clipObs.takeRecords().length;
    pathObs.disconnect();
    clipObs.disconnect();
    expect(paths).toBe(0);
    expect(clips).toBeGreaterThanOrEqual(25);
    // The counter sees a rebuild: reaching month 20 (61 homes) steps the scale to 100.
    await rerender({ reached: base.months[20] + 3 });
    expect(builds() - built).toBeGreaterThan(0);
  });

  it('the value labels and the goal note are hidden from assistive tech', async () => {
    const view = fullView();
    await render(ChartRow, { props: props({ view, target: { deadlineIndex: 12, units: 40 } }) });
    await expect.element(page.getByTestId('chart-target-note')).toBeInTheDocument();
    for (const el of [
      ...document.querySelectorAll('[data-testid=chart-ylabel]'),
      page.getByTestId('chart-target-note').element()
    ])
      expect(el.closest('[aria-hidden=true]'), el.textContent!).not.toBeNull();
    // The goal's figures are in the caption instead.
    expect(document.querySelector('figcaption')!.textContent).toContain(
      goalNote(40, view.months[12])
    );
  });

  it('the caption says what is drawn', async () => {
    const view = fullView();
    const target = { deadlineIndex: 12, units: 40 };
    const goal = { units: 40, deadline: view.months[12] };
    const caption = () => document.querySelector('figcaption')!.textContent!.trim();
    const { rerender } = await render(ChartRow, { props: props({ view, target }) });
    expect(caption()).toBe(chartCaption(false, goal));
    await rerender({ inForce: true });
    expect(caption()).toBe(chartCaption(true, goal));
    await rerender({ target: null });
    expect(caption()).toBe(chartCaption(true, null));
    await expect.element(page.getByRole('figure', { name: 'Homes completed' })).toBeInTheDocument();
  });

  it('keeps a falling line inside the plot', async () => {
    const view = fullView();
    const rows = view.rows.map((r, i) => ({ ...r, completedNet: -1500 * i }));
    const end = lastDay(view);
    await render(ChartRow, {
      props: props({ view: { ...view, rows }, day: end, reached: end })
    });
    const ys = ysOf(attr('chart-line', 'd')!);
    expect(ys.length).toBeGreaterThan(1);
    for (const v of ys) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('draws no marks and no overlay without a view', async () => {
    await render(ChartRow, { props: props({ view: null }) });
    await expect.element(page.getByTestId('chart-line')).not.toBeInTheDocument();
    await expect.element(page.getByRole('slider')).not.toBeInTheDocument();
  });
});
