import { describe, expect, it } from 'vitest';
import { parseSitesFile, parseSummary, type LessCarsSummary } from '$lib/data/lesscars/codec';
import { LESSCARS_HORIZON, LESSCARS_START } from '$lib/data/lesscars/schedule';
import sitesJson from '../../../e2e/fixtures/data/fixture-0/scenarios/lesscars/sites.json';
import summaryJson from '../../../e2e/fixtures/data/fixture-0/scenarios/lesscars/summary.json';
import {
  bandText,
  breakdownRows,
  extraChartModel,
  freedLandSplit,
  homesAt,
  headlineName,
  headlineText,
  revealedYearIndex,
  roundedParts,
  signed,
  yearAt,
  yearIndexAt
} from './summary-view';

const fx = parseSummary(summaryJson);
const L = fx.yearEnds.length - 1;
const Y = yearAt(fx, L);
const fixtureSites = parseSitesFile(sitesJson);

describe('freedLandSplit', () => {
  it('sums parcel land and the rest, without held sites', () => {
    expect(freedLandSplit(fixtureSites)).toEqual({
      parcelM2: expect.closeTo(800, 0),
      rowM2: expect.closeTo(3684, 0)
    });
    const held = structuredClone(fixtureSites);
    for (const x of held.sites) x.heldBy = 'garage';
    expect(freedLandSplit(held)).toEqual({ parcelM2: 0, rowM2: 0 });
  });
});

const last = <T>(a: T[], v: T): T[] => [...a.slice(0, -1), v];
const withFinal = (s: LessCarsSummary, v: number): LessCarsSummary => ({
  ...s,
  extra: { ...s.extra, mean: last(s.extra.mean, v) }
});
const withP10 = (s: LessCarsSummary, v: number): LessCarsSummary => ({
  ...s,
  extra: { ...s.extra, p10: s.extra.p10.map(() => v) }
});
const nonNegative = (s: LessCarsSummary): LessCarsSummary => ({
  ...s,
  extra: {
    mean: s.extra.mean.map((v) => Math.max(0, v)),
    p10: s.extra.p10.map((v) => Math.max(0, v)),
    p50: s.extra.p50.map((v) => Math.max(0, v)),
    p90: s.extra.p90.map((v) => Math.max(0, v))
  }
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
      expect(breakdownRows(s, L).reduce((a, r) => a + r.homes, 0)).toBe(n);
    }
  });
  it('headline copy for positive, negative and zero (synthetic values)', () => {
    expect(headlineText(withFinal(fx, 1234.4), L)).toBe(`+1,234 homes by ${Y}`);
    expect(headlineText(withFinal(fx, -56.2), L)).toBe(`−56 homes by ${Y}`);
    expect(headlineText(withFinal(fx, 0.3), L)).toBe(`No extra homes by ${Y}`);
    expect(headlineText(withFinal(fx, -0.3), L)).toBe(`No extra homes by ${Y}`);
    expect(headlineName(withFinal(fx, -56.2), L)).toBe(
      `−56 homes by ${Y} compared with no plan. Show details`
    );
    expect(headlineName(withFinal(fx, 12), L)).toBe(
      `+12 homes by ${Y} compared with no plan. Show details`
    );
  });
  it('bandText names the seed count and signed bounds', () => {
    const [p10, p90] = [fx.extra.p10.at(-1)!, fx.extra.p90.at(-1)!];
    expect(bandText(fx, L)).toBe(
      `Middle 80% of ${fx.seeds} paired futures: ${signed(p10)} to ${signed(p90)}`
    );
    expect(signed(12)).toBe('+12');
    expect(signed(-3)).toBe('−3');
    expect(signed(0)).toBe('0');
  });
  it('extraChartModel reaches below zero only when a value does', () => {
    // every band value at or above zero: the axis starts at zero
    expect(extraChartModel(nonNegative(fx), L).yMin).toBe(0);
    expect(extraChartModel(withP10(nonNegative(fx), -30), L).yMin).toBeLessThan(0);
    // fixture-0 under today's market: paired runs where the plan's reservations block projects the
    // baseline builds (bySource.parking < 0), so a real negative value reaches below zero
    expect(Math.min(...fx.extra.mean, ...fx.extra.p10)).toBeLessThan(0);
    expect(extraChartModel(fx, L).yMin).toBeLessThan(0);
    expect(extraChartModel(fx, L).yMax).toBeGreaterThanOrEqual(Math.max(...fx.extra.p90));
  });
  it('yearIndexAt clamps to the year ends', () => {
    expect(yearIndexAt(fx, LESSCARS_START)).toBe(0);
    expect(yearIndexAt(fx, LESSCARS_HORIZON + 99)).toBe(fx.yearEnds.length - 1);
  });
  it('revealedYearIndex is the last year end at or before the high-water mark', () => {
    expect(revealedYearIndex(fx, fx.yearEnds[0] - 1)).toBe(-1);
    expect(revealedYearIndex(fx, fx.yearEnds[3])).toBe(3);
    expect(revealedYearIndex(fx, fx.yearEnds[3] + 1)).toBe(3);
    expect(revealedYearIndex(fx, LESSCARS_HORIZON + 99)).toBe(L);
  });
  it('homesAt and yearAt at -1', () => {
    expect(homesAt(fx, -1)).toBe(0);
    expect(yearAt(fx, -1)).toBe(yearAt(fx, 0));
    expect(homesAt(fx, 3)).toBe(Math.round(fx.extra.mean[3]));
  });
  it('extraChartModel(s, 3) slices to four points and takes its y domain from them', () => {
    const m = extraChartModel(fx, 3);
    expect([m.mean.length, m.p10.length, m.p90.length]).toEqual([4, 4, 4]);
    expect(m.years).toHaveLength(fx.yearEnds.length);
    const hi = Math.max(0, ...fx.extra.mean.slice(0, 4), ...fx.extra.p90.slice(0, 4));
    expect(m.yMax).toBeGreaterThanOrEqual(hi);
    const empty = extraChartModel(fx, -1);
    expect(empty.mean).toEqual([]);
    expect(empty.yMin).toBe(0);
  });
  it('breakdownRows(s, 3) sums to the rounded mean at 3', () => {
    expect(breakdownRows(fx, 3).reduce((a, r) => a + r.homes, 0)).toBe(
      Math.round(fx.extra.mean[3])
    );
  });
  it('headline at -1 is "No extra homes yet"; at 3 it names that year', () => {
    expect(headlineText(fx, -1)).toBe('No extra homes yet');
    expect(headlineName(fx, -1).startsWith('No extra homes yet')).toBe(true);
    expect(headlineText(fx, 3)).toContain(String(yearAt(fx, 3)));
    expect(bandText(fx, 3)).toContain(signed(fx.extra.p10[3]));
  });
});
