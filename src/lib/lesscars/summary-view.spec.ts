import { describe, expect, it } from 'vitest';
import { parseSummary, type LessCarsSummary } from '$lib/data/lesscars/codec';
import { LESSCARS_HORIZON, LESSCARS_START } from '$lib/data/lesscars/schedule';
import summaryJson from '../../../e2e/fixtures/data/fixture-0/scenarios/lesscars/summary.json';
import {
  bandText,
  breakdownRows,
  extraChartModel,
  finalYear,
  headlineName,
  headlineText,
  roundedParts,
  signed,
  yearIndexAt
} from './summary-view';

const fx = parseSummary(summaryJson);
const Y = finalYear(fx);

const last = <T>(a: T[], v: T): T[] => [...a.slice(0, -1), v];
const withFinal = (s: LessCarsSummary, v: number): LessCarsSummary => ({
  ...s,
  extra: { ...s.extra, mean: last(s.extra.mean, v) }
});
const withP10 = (s: LessCarsSummary, v: number): LessCarsSummary => ({
  ...s,
  extra: { ...s.extra, p10: s.extra.p10.map(() => v) }
});
/** Fractional means: integer sums over `seeds`, in the last year only. */
function fractional(s: LessCarsSummary, seeds: number): LessCarsSummary {
  const sums = { freed: 31, parking: -11, transitUnlocked: 17, other: 4 };
  const bySource = Object.fromEntries(
    Object.entries(s.bySource).map(([k, a]) => [k, last(a, sums[k as keyof typeof sums] / seeds)])
  ) as LessCarsSummary['bySource'];
  return { ...s, seeds, bySource, extra: { ...s.extra, mean: last(s.extra.mean, 41 / seeds) } };
}

describe('summary-view', () => {
  it('roundedParts sums to the rounded total, negatives included', () => {
    expect(roundedParts([10.4, 10.4, 10.2, 0], 31)).toEqual([11, 10, 10, 0]);
    const p = [100.6, -40.3, 12.35, 0.35];
    const r = roundedParts(p, 73);
    expect(r.reduce((a, b) => a + b, 0)).toBe(73);
    expect(r.every((x, i) => Math.abs(x - p[i]) < 1)).toBe(true);
  });
  it('breakdownRows add to the headline number on the fixture and on a fractional summary', () => {
    for (const s of [fx, fractional(fx, 7)]) {
      const n = Math.round(s.extra.mean.at(-1)!);
      expect(breakdownRows(s).reduce((a, r) => a + r.homes, 0)).toBe(n);
    }
  });
  it('headline copy for positive, negative and zero (synthetic values)', () => {
    expect(headlineText(withFinal(fx, 1234.4))).toBe(`+1,234 homes by ${Y}`);
    expect(headlineText(withFinal(fx, -56.2))).toBe(`−56 homes by ${Y}`);
    expect(headlineText(withFinal(fx, 0.3))).toBe(`No extra homes by ${Y}`);
    expect(headlineText(withFinal(fx, -0.3))).toBe(`No extra homes by ${Y}`);
    expect(headlineName(withFinal(fx, -56.2))).toBe(
      `The plan has 56 fewer homes by ${Y} than no plan. Show details`
    );
    expect(headlineName(withFinal(fx, 12))).toBe(
      `The plan adds 12 homes by ${Y} compared with no plan. Show details`
    );
  });
  it('bandText names the seed count and signed bounds', () => {
    const [p10, p90] = [fx.extra.p10.at(-1)!, fx.extra.p90.at(-1)!];
    expect(bandText(fx)).toBe(
      `Middle 80% of ${fx.seeds} paired futures: ${signed(p10)} to ${signed(p90)}`
    );
    expect(signed(12)).toBe('+12');
    expect(signed(-3)).toBe('−3');
    expect(signed(0)).toBe('0');
  });
  it('extraChartModel reaches below zero only when a value does', () => {
    expect(extraChartModel(withP10(fx, 0)).yMin).toBe(0);
    expect(extraChartModel(withP10(fx, -30)).yMin).toBeLessThan(0);
    expect(extraChartModel(fx).yMax).toBeGreaterThanOrEqual(Math.max(...fx.extra.p90));
  });
  it('yearIndexAt clamps to the year ends', () => {
    expect(yearIndexAt(fx, LESSCARS_START)).toBe(0);
    expect(yearIndexAt(fx, LESSCARS_HORIZON + 99)).toBe(fx.yearEnds.length - 1);
  });
});
