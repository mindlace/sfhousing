// The timeline chart's arithmetic (rules 3, 4): points from today, the current-law series, the
// running maxima that set the scale, and the path strings. Pure; ChartRow lays it out.
import { niceCeil } from '$lib/fzp/chart';
import { formatCompactCount, formatCount } from '$lib/scoreboard/format';
import type { TimelineView } from '$lib/sim/world/score/types';
import type { Day } from '$lib/timelapse/time';
import { filledEndDay } from './playhead';
import { currentLawHomes, type PlayheadAt } from './results';

/** Position j: 0 is today (value 0); j = i + 1 is the end of month i. Filled months only. */
export interface ChartPoints {
  policy: number[];
  law: number[] | null;
}

/** policy[j]: 0, then rows[i].completedNet; law: 0, then currentLawHomes(view, i), only inForce. */
export function chartPoints(view: TimelineView, inForce: boolean): ChartPoints {
  const n = Math.min(view.filledThrough + 1, view.rows.length);
  const policy = [0];
  const law = inForce ? [0] : null;
  for (let i = 0; i < n; i++) {
    policy.push(view.rows[i].completedNet);
    law?.push(currentLawHomes(view, i));
  }
  return { policy, law };
}

function running(p: ChartPoints, pick: (a: number, b: number) => number): number[] {
  const out: number[] = [];
  let m = 0;
  for (let j = 0; j < p.policy.length; j++) {
    m = pick(m, p.policy[j]);
    if (p.law) m = pick(m, p.law[j]);
    out.push(m);
  }
  return out;
}

/** [j] = max(0, policy[0..j], law[0..j]); built once per view. */
export function runningMax(p: ChartPoints): number[] {
  return running(p, Math.max);
}

/** [j] = min(0, policy[0..j], law[0..j]): a falling line stays inside the plot. */
export function runningMin(p: ChartPoints): number[] {
  return running(p, Math.min);
}

const atPos = (run: number[], pos: number) =>
  run.length === 0 ? 0 : run[Math.min(Math.max(pos, 0), run.length - 1)];

/**
 * niceCeil(max(goalUnits ?? 0, runMax[min(pos, last)], 1)): the scale grows only with what has
 * been reached, in 1-2-5 steps, so it changes a handful of times in a whole window.
 */
export function yTop(goalUnits: number | null, runMax: number[], pos: number): number {
  return niceCeil(Math.max(goalUnits ?? 0, atPos(runMax, pos), 1));
}

/** 0, or -niceCeil of the lowest value reached when one is below 0. */
export function yBottom(runMin: number[], pos: number): number {
  const m = atPos(runMin, pos);
  return m < 0 ? -niceCeil(-m) : 0;
}

/** atToday ? 0 : index + 1. */
export function posOf(at: PlayheadAt): number {
  return at.atToday ? 0 : at.index + 1;
}

/** The day position j is plotted at: asOf, then filledEndDay(months, j - 1, asOf). */
export function posDay(view: TimelineView, j: number, asOf: Day): Day {
  return j <= 0 ? asOf : filledEndDay(view.months, j - 1, asOf);
}

const num = (n: number) => n.toFixed(2);

export function linePath(
  values: number[],
  x: (j: number) => number,
  y: (v: number) => number
): string {
  let d = '';
  for (let j = 0; j < values.length; j++)
    d += `${j === 0 ? 'M' : 'L'}${num(x(j))},${num(y(values[j]))}`;
  return d;
}

/** The band between the two series: along `policy`, back along `law`, closed. '' when empty. */
export function gapPath(
  policy: number[],
  law: number[],
  x: (j: number) => number,
  y: (v: number) => number
): string {
  if (policy.length === 0) return '';
  let d = linePath(policy, x, y);
  for (let j = law.length - 1; j >= 0; j--) d += `L${num(x(j))},${num(y(law[j]))}`;
  return `${d}Z`;
}

const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * [{ value: top / 2, label }, { value: top, label }], both in one format: compact ('50K',
 * '100K') when the top is formatCompactCount's compact, else both in full ('25,000', '50,000').
 */
export function yLabels(top: number): { value: number; label: string }[] {
  const compact = formatCompactCount(top) !== formatCount(top);
  return [top / 2, top].map((value) => ({
    value,
    label: compact ? COMPACT.format(value) : formatCount(value)
  }));
}
