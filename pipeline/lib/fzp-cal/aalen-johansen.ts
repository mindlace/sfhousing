/**
 * Aalen–Johansen cumulative incidence with delayed entry (stage-calibration spec §4.4).
 * One sorted sweep over the distinct event durations of a cell; every reason at a duration is
 * applied before S is updated, and the risk set counts events before censoring at ties.
 * A spell's weight `w` (default 1; ruling R13) scales its at-risk contribution and its event;
 * with every weight 1 the sums are exact integers, so results are those of plain counts.
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
  /** weight at risk at d[i]: Σ w over a <= d minus Σ w over x < d */
  n: number[];
  /** weighted events of each outcome at d[i] */
  e: Record<Outcome, number[]>;
  /** spells in the cell (a count, unweighted) */
  spells: number;
  /** total weighted events of each outcome */
  events: Record<Outcome, number>;
}

/** The cause-specific hazard increment of outcome j at sweep index i. */
export type Hazard = (j: Outcome, i: number) => number;

/** One value per outcome, built in `OUTCOMES` order. */
export function perOutcome<T>(make: () => T): Record<Outcome, T> {
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

/** Entry ages and end durations, each sorted ascending, with prefix sums of the weights. */
export interface RiskIndex {
  a: Float64Array;
  x: Float64Array;
  /** wa[k]: Σ w of the k smallest entry ages (wa[0] = 0) */
  wa: Float64Array;
  /** wx[k]: Σ w of the k smallest end durations */
  wx: Float64Array;
}

/** `key` ascending (stable on ties: input order) and the prefix sums of the weights. */
function sortedPrefix(spells: Spell[], key: (s: Spell) => number): [Float64Array, Float64Array] {
  const order = spells.map((_, i) => i).sort((p, q) => key(spells[p]) - key(spells[q]));
  const v = new Float64Array(order.length);
  const w = new Float64Array(order.length + 1);
  order.forEach((i, k) => {
    v[k] = key(spells[i]);
    w[k + 1] = w[k] + (spells[i].w ?? 1);
  });
  return [v, w];
}

/** The risk index of a cell (see `atRisk`). */
export function riskIndex(spells: Spell[]): RiskIndex {
  const [a, wa] = sortedPrefix(spells, (s) => s.a);
  const [x, wx] = sortedPrefix(spells, (s) => s.x);
  return { a, x, wa, wx };
}

/**
 * n(t) = Σ w over a <= t minus Σ w over x < t (#(a <= t) − #(x < t) when every w is 1): events
 * (and censorings) at t are still at risk at t.
 */
export function atRisk(idx: RiskIndex, t: number): number {
  return idx.wa[countAtMost(idx.a, t)] - idx.wx[countBelow(idx.x, t)];
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
    const w = s.w ?? 1;
    row[s.outcome] += w;
    events[s.outcome] += w;
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

/** The largest k <= kMax with n(k * MONTH_DAYS) >= nRiskMin over `spellsAll` (0 if none). */
export function tableMonths(spellsAll: Spell[], kMax: number, nRiskMin: number): number {
  const idx = riskIndex(spellsAll);
  for (let k = kMax; k >= 1; k--) {
    if (atRisk(idx, k * MONTH_DAYS) >= nRiskMin) return k;
  }
  return 0;
}

/**
 * The AJ recursion F_j += S * h_j(i); S *= 1 - sum_j h_j(i) over the sweep, read off at whole
 * months: value k - 1 is F after every event with d < k * MONTH_DAYS, floored to 1e-6. `months`
 * is `tableMonths(spellsAll, kMax, nRiskMin)`.
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
  const months = tableMonths(spellsAll, kMax, nRiskMin);

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
