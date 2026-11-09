/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page } from 'vitest/browser';
import '../../routes/layout.css';
import { chartLabel, chartModel, tableRows } from './chart';
import {
  FIX_ASOF,
  FIX_HORIZON,
  TIMELINE_SCORE,
  TIMELINE_SCORE_R0,
  makeTimelineScore
} from './fixtures/timeline-score';
import ScoreChart from './ScoreChart.svelte';
import { dayFromUtc } from './time';

const DAY1 = dayFromUtc(2031, 3, 15);
const DAY2 = dayFromUtc(2040, 7, 1);

const props = (over: Record<string, unknown> = {}) => ({
  score: TIMELINE_SCORE,
  asOf: FIX_ASOF,
  horizon: FIX_HORIZON,
  day: DAY1,
  highWater: FIX_HORIZON,
  ...over
});

const svg = () => document.querySelector('svg[role="img"]') as SVGSVGElement;
const svgWidth = () => svg().viewBox.baseVal.width;
const cursorX = () => Number(document.querySelector('[data-cursor]')!.getAttribute('x1'));

describe('ScoreChart', () => {
  it('is a figure whose svg is an image labelled with the summary', async () => {
    await page.viewport(1024, 768);
    await render(ScoreChart, { props: props() });
    expect(document.querySelector('figure svg[role="img"]')).not.toBeNull();
    await expect
      .element(page.getByRole('img', { name: chartLabel(TIMELINE_SCORE, 290) }))
      .toBeInTheDocument();
  });

  it('Show as table opens a table with the eight columns and tableRows rows', async () => {
    await page.viewport(1024, 768);
    await render(ScoreChart, { props: props() });
    await page.getByText('Show as table').click();
    const headers = page.getByRole('columnheader').elements();
    expect(headers.map((h) => h.textContent)).toEqual([
      'Date',
      'Total',
      'From pipeline',
      'New projects',
      'Plan effect (completed)',
      'Plan effect (approved)',
      '8 in 10 futures',
      'Plan effect, 8 in 10 futures'
    ]);
    const expected = tableRows(TIMELINE_SCORE, FIX_ASOF, 290);
    // The RHNA deadline shares January 2031's month index, so 24 Januaries + the end = 25.
    expect(expected).toHaveLength(25);
    const body = document.querySelectorAll('tbody tr');
    expect(body).toHaveLength(expected.length);
    expect(body[0].querySelector('th')!.textContent).toBe(expected[0].date);
    expect([...body].some((r) => r.querySelector('th')!.textContent === 'Jan 31, 2031')).toBe(true);
    expect(body[0].querySelectorAll('td')[0].textContent).toBe(expected[0].total);
  });

  it('moves the cursor line with the day prop', async () => {
    await page.viewport(1024, 768);
    const screen = await render(ScoreChart, { props: props() });
    const model = () => chartModel(TIMELINE_SCORE, FIX_ASOF, FIX_HORIZON, svgWidth(), 290);
    expect(cursorX()).toBeCloseTo(model().x(DAY1), 1);
    await screen.rerender(props({ day: DAY2 }));
    await expect.poll(cursorX).toBeCloseTo(model().x(DAY2), 1);
    expect(model().x(DAY2)).toBeGreaterThan(model().x(DAY1));
  });

  it('draws only up to the high-water month and keeps the curve when day moves back', async () => {
    await page.viewport(1024, 768);
    const mid = dayFromUtc(2035, 6, 15);
    const totalD = () => document.querySelector('[data-series="total"]')!.getAttribute('d')!;
    const full = await render(ScoreChart, { props: props({ day: mid, highWater: FIX_HORIZON }) });
    const fullD = totalD();
    await full.rerender(props({ day: mid, highWater: mid }));
    await expect.poll(totalD).not.toBe(fullD);
    const partial = totalD();
    expect(partial.length).toBeLessThan(fullD.length);
    const before = cursorX();
    await full.rerender(props({ day: DAY1, highWater: mid }));
    await expect.poll(cursorX).not.toBeCloseTo(before, 1);
    expect(totalD()).toBe(partial);
  });

  it('draws every series, each tagged with data-series', async () => {
    await page.viewport(1024, 768);
    await render(ScoreChart, { props: props() });
    for (const key of [
      'band',
      'total',
      'pipeline',
      'fresh',
      'planCompleted',
      'planEntitled',
      'planBand'
    ]) {
      expect(document.querySelector(`[data-series="${key}"]`), key).not.toBeNull();
    }
    expect(document.querySelectorAll('[data-reference]')).toHaveLength(2);
  });

  it('marks the series by stroke and dash pattern', async () => {
    await page.viewport(1024, 768);
    await render(ScoreChart, { props: props() });
    const attr = (key: string, name: string) =>
      document.querySelector(`[data-series="${key}"]`)!.getAttribute(name);
    expect(attr('total', 'stroke')).toBe('var(--chart-total)');
    expect(attr('total', 'stroke-width')).toBe('2.5');
    expect(attr('pipeline', 'stroke-dasharray')).toBe('6 3');
    expect(attr('fresh', 'stroke')).toBe('var(--chart-fresh)');
    expect(attr('planCompleted', 'stroke')).toBe('var(--chart-plan)');
    expect(attr('planEntitled', 'stroke-dasharray')).toBe('2 2');
    expect(attr('band', 'fill-opacity')).toBe('0.15');
  });

  it('plan effect not yet computed: no plan paths, calculating legend and cells, references kept', async () => {
    await page.viewport(1024, 768);
    await render(ScoreChart, { props: props({ score: TIMELINE_SCORE_R0 }) });
    for (const key of ['planCompleted', 'planEntitled', 'planBand']) {
      expect(document.querySelector(`[data-series="${key}"]`), key).toBeNull();
    }
    expect(document.querySelector('[data-series="total"]')).not.toBeNull();
    await expect
      .element(page.getByText('Plan effect, completed: calculating…'))
      .toBeInTheDocument();
    await expect.element(page.getByText('Plan effect, approved: calculating…')).toBeInTheDocument();
    await expect
      .element(page.getByText('Plan effect, 8 in 10 futures: calculating…'))
      .toBeInTheDocument();
    expect(document.querySelectorAll('[data-reference]')).toHaveLength(2);

    await page.getByText('Show as table').click();
    const first = document.querySelector('tbody tr')!.querySelectorAll('td');
    expect([first[3].textContent, first[4].textContent, first[6].textContent]).toEqual([
      'calculating…',
      'calculating…',
      'calculating…'
    ]);
  });

  it('explains the dotted reference lines', async () => {
    await page.viewport(1024, 768);
    await render(ScoreChart, { props: props() });
    await expect
      .element(
        page.getByText(
          "Dotted: published estimates of what the plan adds. Compare them with the violet lines, which show this simulation's plan effect (with the plan minus the old zoning)."
        )
      )
      .toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          'Planning: about 39,000 homes approved (compare with: Plan effect, approved)'
        )
      )
      .toBeInTheDocument();
  });

  it('keeps the plan-effect domain inside the plot when the effect is negative', async () => {
    await page.viewport(1024, 768);
    const score = makeTimelineScore();
    await render(ScoreChart, { props: props({ score }) });
    const model = chartModel(score, FIX_ASOF, FIX_HORIZON, svgWidth(), 290);
    expect(model.yMin).toBeLessThan(0);
    const d = document.querySelector('[data-series="planCompleted"]')!.getAttribute('d')!;
    const ys = [...d.matchAll(/ (-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(140);
  });
});

describe('ScoreChart themes', () => {
  const scheme = (value: 'light' | 'dark') =>
    cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value }]
    });
  afterEach(() => scheme('light'));

  it('resolves every stroke, label and halo, and they change with the scheme', async () => {
    await page.viewport(1024, 768);
    await render(ScoreChart, { props: props() });
    const st = (sel: string, prop: 'stroke' | 'fill') =>
      getComputedStyle(document.querySelector(sel)!)[prop];
    const read = () => [
      st('[data-series="total"]', 'stroke'),
      st('[data-series="pipeline"]', 'stroke'),
      st('[data-series="fresh"]', 'stroke'),
      st('[data-series="planCompleted"]', 'stroke'),
      st('[data-series="rhna"]', 'stroke'),
      st('[data-cursor]', 'stroke'),
      st('[data-vertical]', 'stroke'),
      st('svg[role="img"] text', 'fill'),
      st('svg[role="img"] text', 'stroke')
    ];
    await scheme('light');
    const light = read();
    await scheme('dark');
    await expect.poll(read).not.toEqual(light);
    const dark = read();
    light.forEach((v, k) => {
      expect(v, `light ${k}`).toMatch(/^rgb/);
      expect(dark[k], `dark ${k}`).toMatch(/^rgb/);
      expect(dark[k], `dark ${k} differs`).not.toBe(v);
    });
  });
});
