// Pure view helpers for the /lesscars headline, source breakdown and extra-homes chart.
import { SOURCES, type LessCarsSummary, type Source } from '$lib/data/lesscars/codec';
import { niceCeil } from '$lib/fzp/chart';
import { utcParts } from '$lib/fzp/time';
import { formatCount } from '$lib/scoreboard/format';
import type { Day } from '$lib/timelapse/time';
import { bandCopy, headlineCopy, headlineNameCopy } from './copy';

export const SOURCE_LABEL: Record<Source, string> = {
  freed: 'Freed land',
  parking: 'Parking sites',
  transitUnlocked: 'Transit-unlocked',
  other: 'Other'
};

/** '+1,234', '−56' (U+2212), '0'. */
export function signed(n: number): string {
  const r = Math.round(n);
  if (r === 0) return '0';
  return r > 0 ? `+${formatCount(r)}` : formatCount(r);
}

export function finalYear(s: LessCarsSummary): number {
  return utcParts(s.yearEnds[s.yearEnds.length - 1]).y;
}

/** The headline number: the mean at the last year, rounded (never -0). */
export function finalHomes(s: LessCarsSummary): number {
  return Math.round(s.extra.mean[s.extra.mean.length - 1]) + 0;
}

export const headlineText = (s: LessCarsSummary): string =>
  headlineCopy(finalHomes(s), finalYear(s));

export const headlineName = (s: LessCarsSummary): string =>
  headlineNameCopy(finalHomes(s), finalYear(s));

export function bandText(s: LessCarsSummary): string {
  const last = s.extra.p10.length - 1;
  return bandCopy(s.seeds, signed(s.extra.p10[last]), signed(s.extra.p90[last]));
}

/** Largest-remainder rounding: integers, each within 1 of its part, summing to Math.round(total). */
export function roundedParts(parts: readonly number[], total: number): number[] {
  const out = parts.map((p) => Math.floor(p));
  const rem = parts.map((p, i) => p - out[i]);
  let deficit = Math.round(total) - out.reduce((a, b) => a + b, 0);
  const order = parts.map((_, i) => i);
  if (deficit >= 0) {
    order.sort((a, b) => rem[b] - rem[a] || a - b);
    for (let k = 0; deficit > 0 && order.length; k++, deficit--) out[order[k % order.length]]++;
  } else {
    order.sort((a, b) => rem[a] - rem[b] || a - b);
    for (let k = 0; deficit < 0 && order.length; k++, deficit++) out[order[k % order.length]]--;
  }
  return out.map((v) => v + 0);
}

export function breakdownRows(
  s: LessCarsSummary
): { source: Source; label: string; homes: number }[] {
  const last = s.extra.mean.length - 1;
  const homes = roundedParts(
    SOURCES.map((k) => s.bySource[k][last]),
    s.extra.mean[last]
  );
  return SOURCES.map((source, i) => ({ source, label: SOURCE_LABEL[source], homes: homes[i] }));
}

/** The year-end bucket at or after `day`, clamped to the series. */
export function yearIndexAt(s: LessCarsSummary, day: Day): number {
  const i = s.yearEnds.findIndex((d) => d >= day);
  return i < 0 ? s.yearEnds.length - 1 : i;
}

export interface ExtraChartModel {
  years: number[];
  mean: number[];
  p10: number[];
  p90: number[];
  yMin: number;
  yMax: number;
}

export function extraChartModel(s: LessCarsSummary): ExtraChartModel {
  const { mean, p10, p90 } = s.extra;
  const hi = Math.max(0, ...mean, ...p10, ...p90);
  const lo = Math.min(0, ...mean, ...p10, ...p90);
  return {
    years: s.yearEnds.map((d) => utcParts(d).y),
    mean,
    p10,
    p90,
    yMax: niceCeil(hi),
    yMin: lo < 0 ? -niceCeil(-lo) : 0
  };
}
