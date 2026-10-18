/**
 * Aalen–Johansen cumulative incidence with delayed entry (stage-calibration spec §4.4).
 * One sorted sweep over the distinct event durations of a cell; every reason at a duration is
 * applied before S is updated, and the risk set counts events before censoring at ties.
 */
import { MONTH_DAYS } from '../../../src/lib/timelapse/time';
import { EXIT_ORDER, type ExitReason } from '../../../src/lib/timelapse/types';
import type { Spell } from './types';

export type Outcome = 'advance' | ExitReason;

/** Advance, then `EXIT_ORDER`: the fixed order of every per-outcome sum. */
export const OUTCOMES: readonly Outcome[] = ['advance', ...EXIT_ORDER];

export interface AjSweep {
  /** distinct event durations in days, ascending */
  d: number[];
  /** at risk at d[i]: #(a <= d) - #(x < d) */
  n: number[];
  /** events of each outcome at d[i] */
  e: Record<Outcome, number[]>;
  spells: number;
  /** total events of each outcome */
  events: Record<Outcome, number>;
}

/** The cause-specific hazard increment of outcome j at sweep index i. */
export type Hazard = (j: Outcome, i: number) => number;

function perOutcome<T>(make: () => T): Record<Outcome, T> {
  const r = {} as Record<Outcome, T>;
  for (const j of OUTCOMES) r[j] = make();
  return r;
}

/** #(v <= t) over an ascending array. */
function countAtMost(sorted: Float64Array, t: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** #(v < t) over an ascending array. */
function countBelow(sorted: Float64Array, t: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Entry ages and end durations of the spells, each sorted ascending. */
export function riskIndex(spells: Spell[]): { a: Float64Array; x: Float64Array } {
  const a = Float64Array.from(spells, (s) => s.a).sort();
  const x = Float64Array.from(spells, (s) => s.x).sort();
  return { a, x };
}

/** n(t) = #(a <= t) - #(x < t): events (and censorings) at t are still at risk at t. */
export function atRisk(idx: { a: Float64Array; x: Float64Array }, t: number): number {
  return countAtMost(idx.a, t) - countBelow(idx.x, t);
}

/** The event grid of a cell: distinct event durations, risk sets and event counts. */
export function ajSweep(spells: Spell[]): AjSweep {
  const byD = new Map<number, Record<Outcome, number>>();
  const events = perOutcome(() => 0);
  for (const s of spells) {
    if (s.outcome === 'censored') continue;
    let row = byD.get(s.x);
    if (!row) {
      row = perOutcome(() => 0);
      byD.set(s.x, row);
    }
    row[s.outcome]++;
    events[s.outcome]++;
  }
  const d = [...byD.keys()].sort((p, q) => p - q);
  const idx = riskIndex(spells);
  const e = perOutcome<number[]>(() => []);
  const n: number[] = [];
  for (const t of d) {
    n.push(atRisk(idx, t));
    const row = byD.get(t)!;
    for (const j of OUTCOMES) e[j].push(row[j]);
  }
  return { d, n, e, spells: spells.length, events };
}

/** Floors to 1e-6: keeps the table monotone and advance + sum(exit) <= 1. */
const floor6 = (v: number): number => Math.floor(v * 1e6) / 1e6;

/**
 * The AJ recursion F_j += S * h_j(i); S *= 1 - sum_j h_j(i) over the sweep, read off at whole
 * months: value k - 1 is F after every event with d < k * MONTH_DAYS, floored to 1e-6. `months`
 * is the largest k <= kMax with n(k * MONTH_DAYS) >= nRiskMin over `spellsAll` (0 if none).
 * `hazard` defaults to e_j(d_i) / n(d_i); it is not capped here (a caller that scales it applies
 * its own cap). Every exit reason gets an array, in `EXIT_ORDER`; dropping reasons with no
 * events is the caller's. S is the survival after the whole sweep.
 */
export function ajTable(
  sw: AjSweep,
  hazard: Hazard = (j, i) => sw.e[j][i] / sw.n[i],
  kMax: number,
  nRiskMin: number,
  spellsAll: Spell[]
): { months: number; advance: number[]; exit: Partial<Record<ExitReason, number[]>>; S: number } {
  const idx = riskIndex(spellsAll);
  let months = 0;
  for (let k = kMax; k >= 1; k--) {
    if (atRisk(idx, k * MONTH_DAYS) >= nRiskMin) {
      months = k;
      break;
    }
  }

  const F = perOutcome(() => 0);
  const h = perOutcome(() => 0);
  let S = 1;
  const step = (at: number): void => {
    let sum = 0;
    for (const j of OUTCOMES) {
      h[j] = hazard(j, at);
      sum += h[j];
    }
    for (const j of OUTCOMES) F[j] += S * h[j];
    S *= 1 - sum;
  };

  const out = perOutcome<number[]>(() => []);
  let i = 0;
  for (let k = 1; k <= months; k++) {
    const bound = k * MONTH_DAYS;
    for (; i < sw.d.length && sw.d[i] < bound; i++) step(i);
    for (const j of OUTCOMES) out[j].push(floor6(F[j]));
  }
  for (; i < sw.d.length; i++) step(i);

  const exit: Partial<Record<ExitReason, number[]>> = {};
  for (const r of EXIT_ORDER) exit[r] = out[r];
  return { months, advance: out.advance, exit, S };
}
