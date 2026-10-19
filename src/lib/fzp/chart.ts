/**
 * The score chart as numbers and path strings (spec §4.6). Pure: `ScoreChart.svelte` only lays
 * the model out. There is no plotting library; the marks are plain SVG paths.
 */
import { M1_TARGETS, formatCompactCount, formatCount } from '$lib/scoreboard';
import type { TimelineScore } from '$lib/sim/protocol';
import type { Day } from '$lib/timelapse/time';
import { formatDate, formatMonthYear } from './format';
import { deadlineIndex, scrubMarkers } from './score-view';
import { dayFromUtc, monthIndex, utcParts } from './time';

export const CHART_H = 140;

/** Stroke colours (spec §4.6): each has at least 3:1 contrast on white (SC 1.4.11). */
export const COLORS = {
  total: '#1d4ed8',
  pipeline: '#374151',
  fresh: '#b45309',
  plan: '#6d28d9'
} as const;

export const SERIES_NAME: Record<
  'total' | 'pipeline' | 'fresh' | 'planCompleted' | 'planEntitled' | 'band' | 'planBand',
  string
> = {
  total: 'Total net new homes',
  pipeline: "From today's pipeline",
  fresh: 'New projects',
  planCompleted: 'Plan effect, completed',
  planEntitled: 'Plan effect, approved',
  band: '8 in 10 futures',
  planBand: 'Plan effect, 8 in 10 futures'
};

export interface ChartModel {
  width: number;
  height: number;
  yMin: number;
  yMax: number;
  gridlines: { y: number; label: string }[];
  xTicks: { x: number; label: string }[];
  total: string;
  pipeline: string;
  fresh: string;
  band: string | null;
  planCompleted: string | null;
  planEntitled: string | null;
  planBand: string | null;
  rhnaY: number;
  verticals: { x: number; label: string }[];
  references: { x1: number; x2: number; y: number; label: string; color: string }[];
  x(day: Day): number;
}

export interface TableRow {
  index: number;
  date: string;
  total: string;
  pipeline: string;
  fresh: string;
  planCompleted: string;
  planEntitled: string;
  band: string;
  planBand: string;
}

/** Least vertical distance (px) between the zero gridline and a floor gridline. */
const MIN_FLOOR_GAP = 12;
const CALCULATING = 'calculating…';
const EN_DASH = '–';
const RHNA_UNITS = M1_TARGETS.find((t) => t.id === 'rhna')!.units;

/** Round up to 1, 2 or 5 × 10ⁿ (at least 1). */
export function niceCeil(v: number): number {
  if (!(v > 1)) return 1;
  let p = 10 ** Math.floor(Math.log10(v));
  // Math.log10 can land a hair either side of an exact power of ten.
  while (p * 10 <= v) p *= 10;
  while (p > v) p /= 10;
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const num = (n: number) => String(Math.round(n * 100) / 100);

/** The T8 series' values as one drawn series. Empty arrays are not drawn. */
function seriesRange(values: number[]): { min: number; max: number } | null {
  if (values.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

const MEASURE_SERIES = {
  'planEffect.entitledNew': 'planEntitled',
  'planEffect.completedNetNew': 'planCompleted',
  completedNet: 'total'
} as const;

export function chartModel(
  score: TimelineScore,
  asOf: Day,
  horizon: Day,
  width: number
): ChartModel {
  const n = score.months.length;
  const base = score.baseline.completedNet;
  const x = (day: Day) => ((day - asOf) / (horizon - asOf)) * width;
  // Each value is the state at the end of its month: plot it at the next month's start, and the
  // last at the horizon.
  const xAt = (i: number) => (i + 1 < n ? x(score.months[i + 1]) : x(horizon));

  const total = score.shown.map((s) => base + s.completedNet);
  const pipeline = score.shown.map((s) => s.completedNetPipeline);
  const fresh = score.shown.map((s) => s.completedNetNew);
  const bandLow = score.band.map((b) => base + b.p10);
  const bandHigh = score.band.map((b) => base + b.p90);
  const planCompleted = score.planEffect.map((p) => p.completedNetNew);
  const planEntitled = score.planEffect.map((p) => p.entitledNew);
  const planLow = score.planEffectBand.map((b) => b.p10);
  const planHigh = score.planEffectBand.map((b) => b.p90);

  // Domain: every drawn value, the references and RHNA. It starts at 0 unless a drawn value is
  // negative (early plan effect can be): then it reaches down to -niceCeil. This is a deliberate
  // extension of spec §4.6's "0 to niceCeil", so negative values stay inside the plot.
  const drawn = [
    total,
    pipeline,
    fresh,
    bandLow,
    bandHigh,
    planCompleted,
    planEntitled,
    planLow,
    planHigh
  ]
    .map(seriesRange)
    .filter((r) => r !== null);
  const refUnits = score.references.map((r) => r.units);
  const top = Math.max(RHNA_UNITS, ...refUnits, ...drawn.map((r) => r.max));
  const bottom = Math.min(0, ...drawn.map((r) => r.min));
  const yMax = niceCeil(top);
  const yMin = bottom < 0 ? -niceCeil(-bottom) : 0;
  const y = (v: number) => CHART_H - ((v - yMin) / (yMax - yMin)) * CHART_H;

  const line = (values: number[]) =>
    values.length === 0
      ? null
      : 'M' + values.map((v, i) => `${num(xAt(i))} ${num(y(v))}`).join('L');
  const area = (low: number[], high: number[]) => {
    if (high.length === 0) return null;
    const upper = high.map((v, i) => `${num(xAt(i))} ${num(y(v))}`);
    const lower = low.map((v, i) => `${num(xAt(i))} ${num(y(v))}`).reverse();
    return `M${upper.join('L')}L${lower.join('L')}Z`;
  };

  // Zero, the midpoint and the ceiling. A floor line joins them only when it is clear of the
  // zero line, so the two labels never overprint.
  const gridValues = [0, yMax / 2, yMax];
  if (yMin < 0 && y(yMin) - y(0) >= MIN_FLOOR_GAP) gridValues.unshift(yMin);
  const lastYear = utcParts(horizon).y;
  const xTicks = [2030, 2040, 2050]
    .filter((year) => year <= lastYear)
    .map((year) => ({ x: x(dayFromUtc(year, 1, 1)), label: String(year) }));

  return {
    width,
    height: CHART_H,
    yMin,
    yMax,
    gridlines: gridValues.map((v) => ({ y: y(v), label: formatCompactCount(v) })),
    xTicks,
    total: line(total)!,
    pipeline: line(pipeline)!,
    fresh: line(fresh)!,
    band: area(bandLow, bandHigh),
    planCompleted: line(planCompleted),
    planEntitled: line(planEntitled),
    planBand: area(planLow, planHigh),
    rhnaY: y(RHNA_UNITS),
    verticals: scrubMarkers(score).map((m) => ({ x: x(m.day), label: m.label })),
    references: score.references.map((r) => {
      const series = MEASURE_SERIES[r.measure];
      return {
        x1: x(Math.max(r.from, asOf)),
        x2: x(r.by),
        y: y(r.units),
        label: `${r.label} (compare with: ${SERIES_NAME[series]})`,
        color: series === 'total' ? COLORS.total : COLORS.plan
      };
    }),
    x
  };
}

/**
 * The "Show as table" rows: every January after `asOf`'s year, the RHNA deadline's month (dated
 * to the day) and the final month. One row per month index, sorted; the deadline row replaces
 * the month row it falls in.
 */
export function tableRows(score: TimelineScore, asOf: Day): TableRow[] {
  const n = score.months.length;
  const base = score.baseline.completedNet;
  const row = (index: number, date: string): TableRow => {
    const s = score.shown[index];
    const plan = score.planEffect[index];
    const planBand = score.planEffectBand[index];
    const band = score.band[index];
    return {
      index,
      date,
      total: formatCount(base + s.completedNet),
      pipeline: formatCount(s.completedNetPipeline),
      fresh: formatCount(s.completedNetNew),
      planCompleted: plan ? formatCount(plan.completedNetNew) : CALCULATING,
      planEntitled: plan ? formatCount(plan.entitledNew) : CALCULATING,
      band: band
        ? `${formatCount(base + band.p10)}${EN_DASH}${formatCount(base + band.p90)}`
        : CALCULATING,
      planBand: planBand
        ? `${formatCount(planBand.p10)}${EN_DASH}${formatCount(planBand.p90)}`
        : CALCULATING
    };
  };

  const byIndex = new Map<number, TableRow>();
  const lastYear = utcParts(score.months[n - 1]).y;
  for (let year = utcParts(asOf).y + 1; year <= lastYear; year++) {
    const i = monthIndex(dayFromUtc(year, 1, 1), score.months[0], n);
    byIndex.set(i, row(i, formatMonthYear(score.months[i])));
  }
  const rhna = score.targets.find((t) => t.target.id === 'rhna');
  if (rhna) {
    const i = deadlineIndex(score, rhna.deadline);
    byIndex.set(i, row(i, formatDate(rhna.deadline)));
  }
  if (!byIndex.has(n - 1)) byIndex.set(n - 1, row(n - 1, formatMonthYear(score.months[n - 1])));
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/** The SVG's `aria-label` (spec §4.6). */
export function chartLabel(score: TimelineScore): string {
  const n = score.months.length;
  const totalAt = (i: number) =>
    formatCount(score.baseline.completedNet + score.shown[i].completedNet);
  const markers = scrubMarkers(score);
  const parts: string[] = [];
  const rhna = score.targets.find((t) => t.target.id === 'rhna');
  if (rhna) parts.push(`${totalAt(deadlineIndex(score, rhna.deadline))} by the RHNA deadline`);
  const y2045 = markers[markers.length - 1];
  parts.push(`${totalAt(monthIndex(y2045.day, score.months[0], n))} by 2045`);
  parts.push(`${totalAt(n - 1)} by the end of 2050`);
  return `Net new homes in this simulation: ${parts.join(', ')}.`;
}
