/**
 * Calibration model (design doc T12): pure, zod-free and worker-safe. Functions still marked
 * `not implemented` are signature stubs so every consumer compiles against the final API; their
 * bodies land in later stage-calibration steps. Only `./types`, `./time` and `./math` are
 * imported, and `exp`/`log` come from `./math` so results are bit-reproducible.
 */
import { exp, log } from './math';
import { MONTH_DAYS } from './time';
import {
  EXIT_ORDER,
  type Calibration,
  type ExitReason,
  type FeatureId,
  type InitiationModel,
  type Pathway,
  type Stage,
  type Transition
} from './types';

type Incidence = { advance: number; exit: Partial<Record<ExitReason, number>> };

/** (number of edges <= x) - 1, clamped to [0, edges.length - 1]. */
export function binIndex(edges: number[], x: number): number {
  let n = 0;
  while (n < edges.length && edges[n] <= x) n++;
  const i = n - 1;
  return i < 0 ? 0 : i > edges.length - 1 ? edges.length - 1 : i;
}

/** The exit reasons a transition mentions, table or tail, in `EXIT_ORDER`. */
function reasonsOf(t: Transition): ExitReason[] {
  return EXIT_ORDER.filter((r) => t.exit[r] !== undefined || t.tail.exit[r] !== undefined);
}

/** rho: the tail's total monthly hazard, summed advance first, then `EXIT_ORDER`. */
function tailRate(t: Transition): number {
  let rho = t.tail.advance;
  for (const r of EXIT_ORDER) rho += t.tail.exit[r] ?? 0;
  return rho;
}

function checkMonths(k: number): void {
  if (!Number.isInteger(k) || k < 0) {
    throw new RangeError(`months must be a non-negative integer, got ${k}`);
  }
}

/** C(k) for 1 <= k <= K: advance plus every exit at table month k, in `EXIT_ORDER`. */
function tableSum(t: Transition, k: number): number {
  let c = t.advance[k - 1];
  for (const r of EXIT_ORDER) c += t.exit[r]?.[k - 1] ?? 0;
  return c;
}

/** C(k): advance plus all exits by month k; closed-form beyond the table. */
export function cumulativeTotal(t: Transition, k: number): number {
  checkMonths(k);
  if (k === 0) return 0;
  if (k <= t.months) return tableSum(t, k);
  const rho = tailRate(t);
  return 1 - (1 - tableSum(t, t.months)) * exp((k - t.months) * log(1 - rho));
}

/** The tail proportions p_j / rho, advance then the transition's reasons in `EXIT_ORDER`. */
function tailShares(t: Transition): Incidence {
  const rho = tailRate(t);
  const exit: Partial<Record<ExitReason, number>> = {};
  for (const r of reasonsOf(t)) exit[r] = (t.tail.exit[r] ?? 0) / rho;
  return { advance: t.tail.advance / rho, exit };
}

/**
 * F_j beyond the table: F_j(K) + (1 - C(K)) * (p_j / rho) * decay, where decay is
 * 1 - (1 - rho)^(k - K). With decay = 1 it is F_j(infinity).
 */
function beyondTable(t: Transition, decay: number): Incidence {
  const K = t.months;
  const share = tailShares(t);
  const survive = 1 - tableSum(t, K);
  const exit: Partial<Record<ExitReason, number>> = {};
  for (const r of reasonsOf(t)) {
    exit[r] = (t.exit[r]?.[K - 1] ?? 0) + survive * share.exit[r]! * decay;
  }
  return { advance: t.advance[K - 1] + survive * share.advance * decay, exit };
}

/** F_j(k) for advance and each exit reason: cumulative probability of leaving by month k. */
export function cumulativeIncidence(t: Transition, k: number): Incidence {
  checkMonths(k);
  if (k <= t.months) {
    const exit: Partial<Record<ExitReason, number>> = {};
    for (const r of reasonsOf(t)) exit[r] = k === 0 ? 0 : (t.exit[r]?.[k - 1] ?? 0);
    return { advance: k === 0 ? 0 : t.advance[k - 1], exit };
  }
  return beyondTable(t, 1 - exp((k - t.months) * log(1 - tailRate(t))));
}

/** P(eventually j) given survival to `monthsElapsed` months; memoryless from K onward. */
export function eventualProbabilities(t: Transition, monthsElapsed: number): Incidence {
  checkMonths(monthsElapsed);
  if (monthsElapsed >= t.months) return tailShares(t);
  const inf = beyondTable(t, 1);
  const at = cumulativeIncidence(t, monthsElapsed);
  const denom = 1 - cumulativeTotal(t, monthsElapsed);
  const exit: Partial<Record<ExitReason, number>> = {};
  for (const r of reasonsOf(t)) exit[r] = (inf.exit[r]! - (at.exit[r] ?? 0)) / denom;
  return { advance: (inf.advance - at.advance) / denom, exit };
}

/**
 * The last event month `sampleTransition` returns: the greatest k with k * MONTH_DAYS <= 2^24,
 * so `days` stays an integer exact in Float32 (`Day`). 551,213 months is about 45,000 years:
 * "never" on any display, but finite. It bounds the tail search, and it is the month of a tail
 * whose 1 - rho rounds to 1 (C is then flat past K and nothing ever leaves).
 */
const MAX_EVENT_MONTH = Math.floor(16777216 / MONTH_DAYS);

/**
 * The event month k: the least k > m with C(k) > c, given C(m) <= c (`resolved`). Table months
 * by binary search; beyond K the closed form, then stepped by one until C(k - 1) <= c < C(k) as
 * `cumulativeTotal` evaluates it, within [max(m, K) + 1, MAX_EVENT_MONTH]. A non-finite closed
 * form goes to the cap. When no month satisfies the inequality in double precision (c rounds
 * to 1, or C(m) is already 1 because rho = 1), the month is the memoryless one from
 * max(m, K): + max(1, ceil(log(1 - u) / log(1 - rho))), capped (`resolved` false).
 */
function eventMonth(
  t: Transition,
  c: number,
  u: number,
  m: number
): { k: number; resolved: boolean } {
  const K = t.months;
  if (m < K && c < tableSum(t, K)) {
    let below = m; // invariant: C(below) <= c < C(above)
    let above = K;
    while (above - below > 1) {
      const mid = (below + above) >>> 1;
      if (tableSum(t, mid) > c) above = mid;
      else below = mid;
    }
    return { k: above, resolved: true };
  }
  const floor = m > K ? m : K; // C(floor) <= c
  const cap = Math.max(MAX_EVENT_MONTH, floor + 1);
  const L = log(1 - tailRate(t));
  const q = log((1 - c) / (1 - tableSum(t, K))) / L;
  let k = Number.isFinite(q) ? K + Math.ceil(q) : cap;
  k = Math.min(Math.max(k, floor + 1), cap);
  while (k - 1 > floor && cumulativeTotal(t, k - 1) > c) k--;
  while (k < cap && cumulativeTotal(t, k) <= c) k++;
  if (cumulativeTotal(t, k) > c) return { k, resolved: true };
  const n = Math.ceil(log(1 - u) / L);
  const memoryless = L < 0 && Number.isFinite(n) ? floor + Math.max(1, n) : cap;
  return { k: Math.min(memoryless, cap), resolved: false };
}

type Kind = 'advance' | ExitReason;
type Slice = { kind: Kind; lo: number; hi: number };

/**
 * The sub-interval of table month k's mass [C(k - 1), C(k)) holding c, split by the increments
 * of F_j in the order advance, then `EXIT_ORDER`. Boundary j sums F_i(k) for i <= j and
 * F_i(k - 1) for i > j in that fixed order, so the last boundary is exactly C(k).
 */
function tableSlice(t: Transition, k: number, c: number): Slice {
  const kinds: Kind[] = ['advance', ...reasonsOf(t)];
  const at = (kind: Kind, month: number) =>
    month === 0 ? 0 : kind === 'advance' ? t.advance[month - 1] : (t.exit[kind]?.[month - 1] ?? 0);
  let lo = k === 1 ? 0 : tableSum(t, k - 1);
  let j = 0;
  for (; j < kinds.length - 1; j++) {
    let hi = 0;
    for (let i = 0; i < kinds.length; i++) hi += at(kinds[i], i <= j ? k : k - 1);
    if (c < hi) return { kind: kinds[j], lo, hi };
    lo = hi;
  }
  return { kind: kinds[j], lo, hi: tableSum(t, k) };
}

/**
 * The sub-interval of [lo, hi) holding x, split by the tail proportions p_j / rho in the order
 * advance, then `EXIT_ORDER`. The last kind with a positive share ends exactly at hi.
 */
function tailSlice(t: Transition, lo: number, hi: number, x: number): Slice {
  const share = tailShares(t);
  const kinds: Kind[] = ['advance', ...reasonsOf(t)];
  const p = (kind: Kind) => (kind === 'advance' ? share.advance : share.exit[kind]!);
  let last = kinds.length - 1;
  while (last > 0 && !(p(kinds[last]) > 0)) last--;
  let acc = 0;
  let from = lo;
  for (let j = 0; j < last; j++) {
    acc += p(kinds[j]);
    const to = lo + (hi - lo) * acc;
    if (x < to) return { kind: kinds[j], lo: from, hi: to };
    from = to;
  }
  return { kind: kinds[last], lo: from, hi };
}

/**
 * One uniform u in [0, 1) to an outcome and a duration in days from stage entry, given
 * `monthsElapsed` whole months already survived (spec §4.2): target c = C(m) + (1 - C(m)) * u;
 * event month k = the least k > m with C(k) > c; kind = the slice of month k's mass holding c;
 * the day within month k is uniform by c's position in that slice. monthsIn(0, days) = k - 1
 * and days >= ceil(m * MONTH_DAYS). When no month can hold c in double precision (see
 * `eventMonth`), kind and day position come from u split by the tail proportions instead.
 */
export function sampleTransition(
  t: Transition,
  u: number,
  monthsElapsed: number
): { kind: Kind; days: number } {
  checkMonths(monthsElapsed);
  const cm = cumulativeTotal(t, monthsElapsed);
  const c = cm + (1 - cm) * u;
  const { k, resolved } = eventMonth(t, c, u, monthsElapsed);
  let slice: Slice;
  let x = c;
  if (!resolved) {
    slice = tailSlice(t, 0, 1, u);
    x = u;
  } else if (k <= t.months) slice = tableSlice(t, k, c);
  else slice = tailSlice(t, cumulativeTotal(t, k - 1), cumulativeTotal(t, k), c);
  const phi = (x - slice.lo) / (slice.hi - slice.lo);
  const first = Math.ceil((k - 1) * MONTH_DAYS);
  const end = Math.ceil(k * MONTH_DAYS);
  return { kind: slice.kind, days: Math.min(first + Math.floor(phi * (end - first)), end - 1) };
}

/** Monthly initiation probability: logistic of the intercept plus the binned coefficients. */
export function initiationHazard(m: InitiationModel, f: Record<FeatureId, number>): number {
  let z = m.intercept;
  for (const term of m.terms) z += term.coef[binIndex(term.bins, f[term.feature])];
  return 1 / (1 + exp(-z));
}

export function chanceTable(
  _cal: Calibration
): Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Float32Array>>> {
  throw new Error('not implemented');
}

export function typicalMonths(
  _cal: Calibration
): Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, number>>> {
  throw new Error('not implemented');
}

export function parseCalibration(_json: unknown): Calibration {
  throw new Error('not implemented');
}
