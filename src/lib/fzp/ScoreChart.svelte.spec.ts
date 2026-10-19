import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { chartLabel, chartModel, tableRows } from './chart';
import {
  FIX_ASOF,
  TIMELINE_SCORE,
  TIMELINE_SCORE_R0,
  makeTimelineScore
} from './fixtures/timeline-score';
import ScoreChart from './ScoreChart.svelte';
import { HORIZON, dayFromUtc } from './time';

const DAY1 = dayFromUtc(2031, 3, 15);
const DAY2 = dayFromUtc(2040, 7, 1);

const props = (over: Record<string, unknown> = {}) => ({
  score: TIMELINE_SCORE,
  asOf: FIX_ASOF,
  horizon: HORIZON,
  day: DAY1,
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
      .element(page.getByRole('img', { name: chartLabel(TIMELINE_SCORE) }))
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
    const expected = tableRows(TIMELINE_SCORE, FIX_ASOF);
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
    const model = () => chartModel(TIMELINE_SCORE, FIX_ASOF, HORIZON, svgWidth());
    expect(cursorX()).toBeCloseTo(model().x(DAY1), 1);
    await screen.rerender(props({ day: DAY2 }));
    await expect.poll(cursorX).toBeCloseTo(model().x(DAY2), 1);
    expect(model().x(DAY2)).toBeGreaterThan(model().x(DAY1));
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
    expect(attr('total', 'stroke')).toBe('#1d4ed8');
    expect(attr('total', 'stroke-width')).toBe('2.5');
    expect(attr('pipeline', 'stroke-dasharray')).toBe('6 3');
    expect(attr('fresh', 'stroke')).toBe('#b45309');
    expect(attr('planCompleted', 'stroke')).toBe('#6d28d9');
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
    const model = chartModel(score, FIX_ASOF, HORIZON, svgWidth());
    expect(model.yMin).toBeLessThan(0);
    const d = document.querySelector('[data-series="planCompleted"]')!.getAttribute('d')!;
    const ys = [...d.matchAll(/ (-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(140);
  });
});
