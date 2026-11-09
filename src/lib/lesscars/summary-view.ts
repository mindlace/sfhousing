// Pure view helpers for the /lesscars headline, source breakdown and extra-homes chart.
import {
  SOURCES,
  type LessCarsSitesFile,
  type LessCarsSummary,
  type Source
} from '$lib/data/lesscars/codec';
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

/** The last year-end index whose date is at or before `highWater`, else -1. */
export function revealedYearIndex(s: LessCarsSummary, highWater: Day): number {
  let i = -1;
  while (i + 1 < s.yearEnds.length && s.yearEnds[i + 1] <= highWater) i++;
  return i;
}

/** The calendar year of year end `i` (the first year's when nothing is revealed). */
export function yearAt(s: LessCarsSummary, i: number): number {
  return utcParts(s.yearEnds[Math.max(i, 0)]).y;
}

/** The headline number at year end `i`: the mean, rounded (never -0); 0 when nothing is revealed. */
export function homesAt(s: LessCarsSummary, i: number): number {
  return i < 0 ? 0 : Math.round(s.extra.mean[i]) + 0;
}

export const headlineText = (s: LessCarsSummary, i: number): string =>
  headlineCopy(homesAt(s, i), yearAt(s, i), i >= 0);

export const headlineName = (s: LessCarsSummary, i: number): string =>
  headlineNameCopy(homesAt(s, i), yearAt(s, i), i >= 0);

export function bandText(s: LessCarsSummary, i: number): string {
  const j = Math.max(i, 0);
  return bandCopy(s.seeds, signed(i < 0 ? 0 : s.extra.p10[j]), signed(i < 0 ? 0 : s.extra.p90[j]));
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
  s: LessCarsSummary,
  i: number
): { source: Source; label: string; homes: number }[] {
  const homes =
    i < 0
      ? SOURCES.map(() => 0)
      : roundedParts(
          SOURCES.map((k) => s.bySource[k][i]),
          s.extra.mean[i]
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

/** The model for year ends 0..i; the y domain comes from that slice (floor 0), years stay whole. */
export function extraChartModel(s: LessCarsSummary, i: number): ExtraChartModel {
  const mean = s.extra.mean.slice(0, i + 1);
  const p10 = s.extra.p10.slice(0, i + 1);
  const p90 = s.extra.p90.slice(0, i + 1);
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

/** Freed land in m²: parcelM2 summed, and the rest of each site's area; held sites excluded. */
export function freedLandSplit(s: LessCarsSitesFile): { parcelM2: number; rowM2: number } {
  let parcelM2 = 0;
  let rowM2 = 0;
  for (const site of s.sites) {
    if (site.heldBy) continue;
    const p = Math.min(site.parcelM2 ?? 0, site.rec.areaM2);
    parcelM2 += p;
    rowM2 += site.rec.areaM2 - p;
  }
  return { parcelM2, rowM2 };
}
