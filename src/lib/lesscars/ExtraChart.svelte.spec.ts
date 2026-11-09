/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { parseSummary, type LessCarsSummary } from '$lib/data/lesscars/codec';
import summaryJson from '../../../e2e/fixtures/data/fixture-0/scenarios/lesscars/summary.json';
import ExtraChart from './ExtraChart.svelte';
import { homesAt, signed, yearAt } from './summary-view';

const fx = parseSummary(summaryJson);
const withP10 = (s: LessCarsSummary, v: number): LessCarsSummary => ({
  ...s,
  extra: { ...s.extra, p10: s.extra.p10.map(() => v) }
});

describe('ExtraChart', () => {
  it('names the first and last values, draws a zero line only below zero, marks the day', async () => {
    const { container } = await render(ExtraChart, {
      props: { summary: fx, day: fx.yearEnds[3], highWater: fx.yearEnds[3] }
    });
    await expect
      .element(page.getByRole('img'))
      .toHaveAccessibleName(`Extra homes by year: ${signed(homesAt(fx, 3))} by ${yearAt(fx, 3)}`);
    expect(container.querySelector('[data-zero-line]')).toBeNull();
    expect(container.querySelector('[data-now]')?.getAttribute('data-year-index')).toBe('3');
    const neg = await render(ExtraChart, {
      props: { summary: withP10(fx, -30), day: fx.yearEnds[0], highWater: fx.yearEnds[0] }
    });
    expect(neg.container.querySelector('[data-zero-line]')).not.toBeNull();
  });

  it('draws only the revealed points; nothing when none is revealed; day moves only the marker', async () => {
    const a = await render(ExtraChart, {
      props: { summary: fx, day: fx.yearEnds[1], highWater: fx.yearEnds[3] }
    });
    const pts = a.container.querySelector('polyline')!.getAttribute('points')!.trim().split(' ');
    expect(pts).toHaveLength(4);
    expect(a.container.querySelector('[data-now]')?.getAttribute('data-year-index')).toBe('1');
    a.unmount();
    const b = await render(ExtraChart, {
      props: { summary: fx, day: fx.yearEnds[0], highWater: fx.yearEnds[0] - 1 }
    });
    expect(b.container.querySelector('polyline')).toBeNull();
    expect(b.container.querySelector('polygon')).toBeNull();
    await expect.element(page.getByRole('img')).toHaveAccessibleName('No extra homes yet');
  });
});
