/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page } from 'vitest/browser';
import '../../routes/layout.css';
import { REFERENCE_NOTE } from '$lib/timeline/copy';
import { chartLabel, chartModel, tableRows } from './chart';
import {
  FIX_ASOF,
  FIX_HORIZON,
  TIMELINE_SCORE,
  TIMELINE_SCORE_R0,
  makeTimelineScore
} from './fixtures/timeline-score';
import ScoreChart from './ScoreChart.svelte';
import { formatMonthYear } from './format';
import { dayFromUtc, monthIndex } from './time';

const DAY1 = dayFromUtc(2031, 3, 15);
const DAY2 = dayFromUtc(2040, 7, 1);

const props = (over: Record<string, unknown> = {}) => ({
  score: TIMELINE_SCORE,
  asOf: FIX_ASOF,
  horizon: FIX_HORIZON,
  day: DAY1,
  highWater: FIX_HORIZON,
  reached: FIX_HORIZON,
  ...over
});

const svg = () => document.querySelector('svg[role="img"]') as SVGSVGElement;
const svgWidth = () => svg().viewBox.baseVal.width;
/** The month index of a day in the fixture. */
const monthOf = (d: number) =>
  monthIndex(d, TIMELINE_SCORE.months[0], TIMELINE_SCORE.months.length);
const rect = (id: string) => {
  const r = document.querySelector(`[data-testid="${id}"]`)!;
  return { x: Number(r.getAttribute('x')), width: Number(r.getAttribute('width')) };
};
const cursorX = () => Number(document.querySelector('[data-cursor]')!.getAttribute('x1'));

describe('ScoreChart', () => {
  it('is a figure whose svg is an image labelled with the summary', async () => {
    await page.viewport(1024, 768);
    await render(ScoreChart, { props: props() });
    expect(document.querySelector('figure svg[role="img"]')).not.toBeNull();
    await expect
      .element(page.getByRole('img', { name: chartLabel(TIMELINE_SCORE, monthOf(DAY1)) }))
      .toBeInTheDocument();
  });

  it('Show as table opens a table with the six columns and tableRows rows', async () => {
    await page.viewport(1024, 768);
    await render(ScoreChart, { props: props() });
    await page.getByText('Show as table').click();
    const headers = page.getByRole('columnheader').elements();
    expect(headers.map((h) => h.textContent)).toEqual([
      'Date',
      'Toward the goal',
      'From pipeline',
      'New projects',
      'Plan effect (completed)',
      'Plan effect (approved)'
    ]);
    const expected = tableRows(TIMELINE_SCORE, FIX_ASOF, monthOf(DAY1));
    // The Januaries after the as-of year up to 2031 (the deadline's month among them) + the
    // playhead's month.
    expect(expected).toHaveLength(6);
    const body = document.querySelectorAll('tbody tr');
    expect(body).toHaveLength(expected.length);
    expect(body[0].querySelector('th')!.textContent).toBe(expected[0].date);
    expect([...body].some((r) => r.querySelector('th')!.textContent === 'Jan 31, 2031')).toBe(true);
    expect(body[0].querySelectorAll('td')[0].textContent).toBe(expected[0].total);
  });

  it('the Results chart says it counts toward the goal since Jun 2022', async () => {
    await page.viewport(1024, 768);
    await render(ScoreChart, { props: props() });
    expect(svg().getAttribute('aria-label')).toMatch(/^Toward the goal, since Jun 2022: /);
    expect([...svg().querySelectorAll('text')].some((t) => t.textContent === 'State target')).toBe(
      true
    );
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

  it('lines are solid to the cursor, thinner to the furthest date, absent past it', async () => {
    await page.viewport(1024, 768);
    const reached = dayFromUtc(2038, 1, 1);
    await render(ScoreChart, { props: props({ reached }) });
    const model = chartModel(TIMELINE_SCORE, FIX_ASOF, FIX_HORIZON, svgWidth(), 290);
    const shown = rect('results-clip-shown');
    const seen = rect('results-clip-seen');
    expect(shown.x).toBe(0);
    expect(shown.width).toBeCloseTo(model.x(DAY1), 1);
    expect(seen.x).toBeCloseTo(model.x(DAY1), 1);
    expect(seen.x + seen.width).toBeCloseTo(model.x(reached), 1);
    expect(seen.x + seen.width).toBeLessThan(svgWidth());
    const key = 'total';
    const solid = document.querySelector(`[data-series="${key}"]`)!;
    const thin = document.querySelector(`[data-series-seen="${key}"]`)!;
    expect(solid.getAttribute('d')).toBe(thin.getAttribute('d'));
    expect(Number(thin.getAttribute('stroke-width'))).toBeLessThan(
      Number(solid.getAttribute('stroke-width'))
    );
    expect(solid.closest('g')!.getAttribute('clip-path')).toMatch(/^url\(#.+-shown\)$/);
    expect(thin.closest('g')!.getAttribute('clip-path')).toMatch(/^url\(#.+-seen\)$/);
  });

  it('a fully reached forecast cuts nothing short of the plot end', async () => {
    await page.viewport(1024, 768);
    await render(ScoreChart, { props: props() });
    const seen = rect('results-clip-seen');
    expect(seen.x + seen.width).toBeCloseTo(svgWidth(), 1);
  });

  it('the table lists months up to the playhead only', async () => {
    await page.viewport(1024, 768);
    const day = TIMELINE_SCORE.months[30];
    await render(ScoreChart, { props: props({ day, reached: TIMELINE_SCORE.months[200] }) });
    await page.getByText('Show as table').click();
    const expected = tableRows(TIMELINE_SCORE, FIX_ASOF, 30);
    expect(expected[expected.length - 1].index).toBe(30);
    const body = document.querySelectorAll('tbody tr');
    expect(body).toHaveLength(expected.length);
    expect(body[body.length - 1].querySelector('th')!.textContent).toBe(
      formatMonthYear(TIMELINE_SCORE.months[30])
    );
  });

  it('the label names values up to the playhead only', async () => {
    await page.viewport(1024, 768);
    await render(ScoreChart, { props: props({ day: DAY1, reached: FIX_HORIZON }) });
    const label = svg().getAttribute('aria-label')!;
    expect(label).not.toContain('by 2045');
    expect(label).toContain("by the goal's deadline");
    expect(label).toBe(chartLabel(TIMELINE_SCORE, monthOf(DAY1)));
  });

  it('moving the day writes no path', async () => {
    await page.viewport(1024, 768);
    const screen = await render(ScoreChart, { props: props() });
    let writes = 0;
    const observer = new MutationObserver((records) => (writes += records.length));
    observer.observe(svg(), { subtree: true, attributes: true, attributeFilter: ['d'] });
    await screen.rerender(props({ day: DAY2 }));
    await expect.poll(cursorX).toBeGreaterThan(0);
    await screen.rerender(props({ day: dayFromUtc(2033, 1, 1) }));
    await expect.poll(() => rect('results-clip-shown').width).toBeGreaterThan(0);
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();
    expect(writes).toBe(0);
  });

  it('references and the target line are drawn whole', async () => {
    await page.viewport(1024, 768);
    const reached = dayFromUtc(2026, 6, 1);
    await render(ScoreChart, { props: props({ day: reached, reached }) });
    const model = chartModel(TIMELINE_SCORE, FIX_ASOF, FIX_HORIZON, svgWidth(), 290);
    const target = document.querySelector('[data-series="rhna"]')!;
    expect(Number(target.getAttribute('x1'))).toBe(0);
    expect(Number(target.getAttribute('x2'))).toBeCloseTo(svgWidth(), 1);
    const refs = [...document.querySelectorAll('[data-reference]')];
    expect(refs).toHaveLength(model.references.length);
    refs.forEach((el, i) => {
      expect(Number(el.getAttribute('x1'))).toBeCloseTo(model.references[i].x1, 1);
      expect(Number(el.getAttribute('x2'))).toBeCloseTo(model.references[i].x2, 1);
    });
    expect(model.references.some((r) => r.x2 > model.x(reached))).toBe(true);
  });

  it('draws every series, each tagged with data-series', async () => {
    await page.viewport(1024, 768);
    await render(ScoreChart, { props: props() });
    for (const key of ['total', 'pipeline', 'fresh', 'planCompleted', 'planEntitled']) {
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
  });

  it('plan effect not yet computed: no plan paths, calculating legend and cells, references kept', async () => {
    await page.viewport(1024, 768);
    await render(ScoreChart, { props: props({ score: TIMELINE_SCORE_R0 }) });
    for (const key of ['planCompleted', 'planEntitled']) {
      expect(document.querySelector(`[data-series="${key}"]`), key).toBeNull();
    }
    expect(document.querySelector('[data-series="total"]')).not.toBeNull();
    await expect
      .element(page.getByText('Plan effect, completed: calculating…'))
      .toBeInTheDocument();
    await expect.element(page.getByText('Plan effect, approved: calculating…')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-reference]')).toHaveLength(2);

    await page.getByText('Show as table').click();
    const first = document.querySelector('tbody tr')!.querySelectorAll('td');
    expect([first[3].textContent, first[4].textContent]).toEqual(['calculating…', 'calculating…']);
  });

  it('explains the dotted reference lines', async () => {
    await page.viewport(1024, 768);
    await render(ScoreChart, { props: props() });
    await expect.element(page.getByText(REFERENCE_NOTE).first()).not.toBeInTheDocument();
    await page
      .getByRole('button', { name: /^Planning: about 39,000/ })
      .first()
      .click();
    await expect.element(page.getByText(REFERENCE_NOTE).first()).toBeVisible();
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
