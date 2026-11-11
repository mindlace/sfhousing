/**
 * Calibration model (design doc T12): pure, free of any schema library and worker-safe. Only
 * `./types`, `./time`, `./math` and the finance checks `../sim/finance/{instruments,debt}` (the
 * one validation every pool and programme validator calls) are imported, and `exp`/`log` come
 * from `./math` so results are bit-reproducible. Per-transition constants are memoised by object
 * identity (`Constants`), so a Transition must not be mutated after its first use here.
 */
import { exp, log } from './math';
import { MONTH_DAYS, monthDay, stageDay } from './time';
import { validateDebt } from '../sim/finance/debt';
import { validateInstrument } from '../sim/finance/instruments';
import {
  EXIT_ORDER,
  INCOME_TIERS,
  PATHWAYS,
  STAGE_ORDER,
  pathwayStages,
  type Calibration,
  type ExitReason,
  type FeatureId,
  type InitiationModel,
  type Instrument,
  type PoolKind,
  type Pathway,
  type Stage,
  type Transition
} from './types';

type Incidence = { advance: number; exit: Partial<Record<ExitReason, number>> };
type Kind = 'advance' | ExitReason;

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
export function tailRate(t: Transition): number {
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

/**
 * Per-transition constants (T12 perf), memoised per Transition object so `sampleTransition` does
 * not recompute them on every call. Each is computed once, on first use, with exactly the
 * expression and evaluation order the per-call code used, so every output is bit-identical to
 * computing it afresh. The parts fill lazily and independently, so a code path reads only the
 * Transition fields it read before.
 *
 * The cache is a WeakMap keyed by object identity: a Transition is treated as IMMUTABLE after its
 * first use by any function in this module. Mutating one in place afterwards (its months, table
 * or tail) leaves its constants stale and the results wrong; build a new Transition (for example
 * with `structuredClone`) instead. `parseCalibration` returns the caller's object unfrozen, so
 * this is a documented contract rather than an enforced one.
 */
type Constants = {
  /**
   * sums[k] = `tableSum(t, k)` = C(k) for k = 0..K. Index 0 is read only as C(K) when K = 0, where
   * the uncached code read `tableSum(t, 0)` too; C(0) itself is 0 (`total`).
   */
  sums?: number[];
  tail?: TailConstants;
  /** Per-kind columns for `sampleKind` and `sampleTime`. */
  cols?: Columns;
};

/** Per kind j, aligned with `TailConstants.kinds`: F_j(0..K) and F_j(infinity). */
type Columns = { F: number[][]; inf: number[] };

type TailConstants = {
  /** rho = `tailRate(t)`. */
  rho: number;
  /** log(1 - rho). */
  logSurvive: number;
  /** `reasonsOf(t)`. */
  reasons: ExitReason[];
  /** 'advance', then `reasons`. */
  kinds: Kind[];
  /** The tail proportions p_j / rho, aligned with `kinds`. */
  shares: number[];
  /** The last index of `kinds` with a positive share (0 when none is). */
  last: number;
  /** acc[j] = shares[0] + ... + shares[j], summed in that order, for j < `last`. */
  acc: number[];
};

const CONSTANTS = new WeakMap<Transition, Constants>();

function constantsOf(t: Transition): Constants {
  let c = CONSTANTS.get(t);
  if (c === undefined) {
    c = {};
    CONSTANTS.set(t, c);
  }
  return c;
}

function sumsOf(t: Transition, c: Constants): number[] {
  if (c.sums === undefined) {
    const sums = [tableSum(t, 0)];
    for (let k = 1; k <= t.months; k++) sums.push(tableSum(t, k));
    c.sums = sums;
  }
  return c.sums;
}

function tailOf(t: Transition, c: Constants): TailConstants {
  if (c.tail === undefined) {
    const rho = tailRate(t);
    const reasons = reasonsOf(t);
    const kinds: Kind[] = ['advance', ...reasons];
    const shares = kinds.map((kind) =>
      kind === 'advance' ? t.tail.advance / rho : (t.tail.exit[kind] ?? 0) / rho
    );
    let last = kinds.length - 1;
    while (last > 0 && !(shares[last] > 0)) last--;
    const acc: number[] = [];
    let sum = 0;
    for (let j = 0; j < last; j++) {
      sum += shares[j];
      acc.push(sum);
    }
    c.tail = { rho, logSurvive: log(1 - rho), reasons, kinds, shares, last, acc };
  }
  return c.tail;
}

/** C(k), `cumulativeTotal` on a transition's constants: k must be a non-negative integer. */
function total(t: Transition, c: Constants, k: number): number {
  checkMonths(k);
  if (k === 0) return 0;
  const sums = sumsOf(t, c);
  if (k <= t.months) return sums[k];
  return 1 - (1 - sums[t.months]) * exp((k - t.months) * tailOf(t, c).logSurvive);
}

/** C(k): advance plus all exits by month k; closed-form beyond the table. */
export function cumulativeTotal(t: Transition, k: number): number {
  checkMonths(k);
  return total(t, constantsOf(t), k);
}

/** The tail proportions p_j / rho, advance then the transition's reasons in `EXIT_ORDER`. */
function tailShares(tc: TailConstants): Incidence {
  const exit: Partial<Record<ExitReason, number>> = {};
  for (let i = 0; i < tc.reasons.length; i++) exit[tc.reasons[i]] = tc.shares[i + 1];
  return { advance: tc.shares[0], exit };
}

/**
 * F_j beyond the table: F_j(K) + (1 - C(K)) * (p_j / rho) * decay, where decay is
 * 1 - (1 - rho)^(k - K). With decay = 1 it is F_j(infinity).
 */
function beyondTable(t: Transition, c: Constants, decay: number): Incidence {
  const K = t.months;
  const { reasons, shares } = tailOf(t, c);
  const survive = 1 - sumsOf(t, c)[K];
  const exit: Partial<Record<ExitReason, number>> = {};
  for (let i = 0; i < reasons.length; i++) {
    const r = reasons[i];
    exit[r] = (t.exit[r]?.[K - 1] ?? 0) + survive * shares[i + 1] * decay;
  }
  return { advance: t.advance[K - 1] + survive * shares[0] * decay, exit };
}

/** F_j(k) for advance and each exit reason: cumulative probability of leaving by month k. */
export function cumulativeIncidence(t: Transition, k: number): Incidence {
  checkMonths(k);
  const c = constantsOf(t);
  if (k <= t.months) {
    const exit: Partial<Record<ExitReason, number>> = {};
    for (const r of tailOf(t, c).reasons) exit[r] = k === 0 ? 0 : (t.exit[r]?.[k - 1] ?? 0);
    return { advance: k === 0 ? 0 : t.advance[k - 1], exit };
  }
  return beyondTable(t, c, 1 - exp((k - t.months) * tailOf(t, c).logSurvive));
}

/** P(eventually j) given survival to `monthsElapsed` months; memoryless from K onward. */
export function eventualProbabilities(t: Transition, monthsElapsed: number): Incidence {
  checkMonths(monthsElapsed);
  const c = constantsOf(t);
  if (monthsElapsed >= t.months) return tailShares(tailOf(t, c));
  const inf = beyondTable(t, c, 1);
  const at = cumulativeIncidence(t, monthsElapsed);
  const denom = 1 - total(t, c, monthsElapsed);
  const exit: Partial<Record<ExitReason, number>> = {};
  for (const r of tailOf(t, c).reasons) exit[r] = (inf.exit[r]! - (at.exit[r] ?? 0)) / denom;
  return { advance: (inf.advance - at.advance) / denom, exit };
}

/** Per-kind F_j(0..K) and F_j(infinity), aligned with `TailConstants.kinds` (memoised). */
function colsOf(t: Transition, c: Constants): Columns {
  if (c.cols === undefined) {
    const { kinds } = tailOf(t, c);
    const end = beyondTable(t, c, 1);
    const F = kinds.map((kind) => {
      const col = kind === 'advance' ? t.advance : t.exit[kind];
      const out = [0];
      for (let k = 1; k <= t.months; k++) out.push(col?.[k - 1] ?? 0);
      return out;
    });
    const inf = kinds.map((kind) => (kind === 'advance' ? end.advance : end.exit[kind]!));
    c.cols = { F, inf };
  }
  return c.cols;
}

/** F_j at real months n + a (0 <= a < 1, n < K): linear between table months n and n + 1. */
function columnAt(col: number[], n: number, a: number): number {
  return a === 0 ? col[n] : col[n] + a * (col[n + 1] - col[n]);
}

function checkElapsed(tau: number): void {
  if (!(tau >= 0 && tau < MAX_EVENT_MONTH - 1)) {
    throw new RangeError(`monthsElapsed must be in [0, ${MAX_EVENT_MONTH - 1}), got ${tau}`);
  }
}

function checkUniform(u: number, name: string): void {
  if (!(u >= 0 && u < 1)) throw new RangeError(`${name} must be in [0, 1), got ${u}`);
}

/** The largest double below 1. */
const BELOW_ONE = 1 - Number.EPSILON / 2;

/**
 * The outcome of one stage step (paired-draw fix, "Sampling one stage step"), from the kind
 * uniform `uKind` given `monthsElapsed` = tau real months already in the stage: the j, in the
 * order advance then `EXIT_ORDER`, whose cumulative slice of the remaining masses R_j = F_j(inf)
 * - F_j(tau) holds uKind * (1 - C(tau)). F_j is linear between table months. From K on, the
 * slices are the tail shares (memoryless). A kind with no remaining mass is never drawn; the last
 * kind with mass takes any rounding remainder. Throws RangeError for uKind outside [0, 1) or tau
 * outside [0, MAX_EVENT_MONTH - 1).
 */
export function sampleKind(t: Transition, uKind: number, monthsElapsed: number): Kind {
  checkElapsed(monthsElapsed);
  checkUniform(uKind, 'uKind');
  const c = constantsOf(t);
  const tc = tailOf(t, c);
  const { kinds } = tc;
  if (monthsElapsed >= t.months) {
    for (let j = 0; j < tc.last; j++) if (uKind < tc.acc[j]) return kinds[j];
    return kinds[tc.last];
  }
  const { F, inf } = colsOf(t, c);
  const n = Math.floor(monthsElapsed);
  const a = monthsElapsed - n;
  let C = 0;
  for (let j = 0; j < kinds.length; j++) C += columnAt(F[j], n, a);
  const target = uKind * (1 - C);
  let cum = 0;
  let last = 0;
  for (let j = 0; j < kinds.length; j++) {
    const R = inf[j] - columnAt(F[j], n, a);
    if (!(R > 0)) continue;
    last = j;
    cum += R;
    if (target < cum) return kinds[j];
  }
  return kinds[last];
}

/**
 * The time of one stage step given its kind (paired-draw fix): integer days from stage entry, by
 * inverting kind j's conditional CDF from tau, G_j(x) = (F_j(x) - F_j(tau)) / R_j, at `uTime`.
 * F_j is linear within table months, and past K it is F_j(K) + (1 - C(K)) pi_j H(x - K) with H
 * linear between integer months and H(n) = 1 - (1 - rho)^n, so from K on the time is the same for
 * every kind (`tailDay`). The result is >= stageDay(tau) and < 2^24 (Float32-exact). Throws
 * RangeError for uTime outside [0, 1), tau outside [0, MAX_EVENT_MONTH - 1), or a kind that is not
 * one of the transition's outcomes or has no mass left at tau.
 */
export function sampleTime(
  t: Transition,
  kind: Kind,
  uTime: number,
  monthsElapsed: number
): number {
  checkElapsed(monthsElapsed);
  checkUniform(uTime, 'uTime');
  const c = constantsOf(t);
  const tc = tailOf(t, c);
  const j = tc.kinds.indexOf(kind);
  if (j < 0) throw new RangeError(`${kind} is not an outcome of this transition`);
  const K = t.months;
  const floorDay = stageDay(monthsElapsed);
  if (monthsElapsed >= K) {
    if (!(tc.shares[j] > 0)) throw new RangeError(`${kind} has no mass left at ${monthsElapsed}`);
    return Math.max(tailDay(K, tc, monthsElapsed, uTime), floorDay);
  }
  const { F, inf } = colsOf(t, c);
  const col = F[j];
  const n = Math.floor(monthsElapsed);
  const a = monthsElapsed - n;
  const from = columnAt(col, n, a);
  const R = inf[j] - from;
  if (!(R > 0)) throw new RangeError(`${kind} has no mass left at ${monthsElapsed}`);
  let f = from + uTime * R;
  const FK = col[K];
  const mass = (1 - sumsOf(t, c)[K]) * tc.shares[j];
  if (f >= FK) {
    if (mass > 0) {
      const v = Math.min((f - FK) / mass, BELOW_ONE);
      return Math.max(tailDay(K, tc, K, v), floorDay);
    }
    // No tail mass for this kind: its last table mass ends at F_j(K); stay just below it.
    f = Math.max(FK * (1 - Number.EPSILON), from);
  }
  // The least table month k in (n, K] with F_j(k) > f, given F_j(n) <= f < F_j(K).
  let below = n;
  let above = K;
  while (above - below > 1) {
    const mid = (below + above) >>> 1;
    if (col[mid] > f) above = mid;
    else below = mid;
  }
  const lo = col[above - 1];
  let frac = (f - lo) / (col[above] - lo);
  if (above - 1 === n && frac < a) frac = a;
  return Math.max(monthDay(above - 1, frac > 0 ? frac : 0), floorDay);
}

/**
 * The days from stage entry at which a fresh stage step would advance, given only the time
 * uniform `u` (no kind draw): `sampleTime(t, 'advance', u, 0)`. A transition whose advance kind
 * has no mass (all-zero table and tail advance 0, exits only) never advances; it returns the last
 * event day, `ceil(MAX_EVENT_MONTH * MONTH_DAYS) - 1`. Throws RangeError for u outside [0, 1).
 */
export function sampleAdvance(t: Transition, u: number): { days: number } {
  checkUniform(u, 'u');
  const c = constantsOf(t);
  const tc = tailOf(t, c);
  // The condition under which sampleTime(t, 'advance', u, 0) throws "no mass left" (advance is
  // kinds[0]); column j starts at 0, so R = inf[0] - 0.
  const mass = t.months === 0 ? tc.shares[0] > 0 : colsOf(t, c).inf[0] > 0;
  if (!mass) return { days: Math.ceil(MAX_EVENT_MONTH * MONTH_DAYS) - 1 };
  return { days: sampleTime(t, 'advance', u, 0) };
}

/**
 * The tail inverse from `from` >= K months with uniform v (kind-independent). Working relative
 * to month n0 = floor(from - K) past K keeps a large `from` precise: survival relative to K + n0
 * is 1 - f0 rho at `from` (f0 its fraction), and the event is where it reaches R = (1 - f0 rho)
 * (1 - v). Same month when R > 1 - rho; otherwise month m + 1 past K + n0 for the least m >= 1
 * with (1 - rho)^(m+1) < R <= (1 - rho)^m (closed form, then stepped by one). Every event from the cap month on (a slow tail, or
 * log(1 - rho) = 0) lands in the cap month, at R's position in the survival s = (1 - rho)^top left at its start.
 */
function tailDay(K: number, tc: TailConstants, from: number, v: number): number {
  const { rho, logSurvive: L } = tc;
  const n0 = Math.floor(from - K);
  const f0 = from - K - n0;
  const R = (1 - f0 * rho) * (1 - v);
  if (R > 1 - rho) return monthDay(K + n0, clampFrac((1 - R) / rho));
  const top = MAX_EVENT_MONTH - 1 - K - n0;
  const pw = (m: number) => exp(m * L);
  let m = top;
  if (L !== 0) {
    const q = Math.floor(log(R) / L);
    m = Number.isFinite(q) ? Math.min(Math.max(q, 1), top) : top;
    while (m > 1 && pw(m) < R) m--;
    while (m < top && pw(m + 1) >= R) m++;
  }
  const s = pw(m);
  // The cap month (m = top) holds all the mass from (1 - rho)^top down, so its position is
  // 1 - R / s over that whole range, never the geometric one: mixing the two would restart the
  // position inside the month and break monotonicity in v.
  const f = m < top ? (1 - R / s) / rho : 1 - R / s;
  return monthDay(K + n0 + m, clampFrac(f));
}

/** A position within a month, clamped to [0, 1] (NaN to 0); `monthDay` keeps 1 in the month. */
function clampFrac(f: number): number {
  return f > 0 ? Math.min(f, 1) : 0;
}

/**
 * The last event month `sampleTransition` returns: the greatest k with k * MONTH_DAYS <= 2^24,
 * so `days` stays an integer exact in Float32 (`Day`). 551,213 months is about 45,000 years:
 * "never" on any display, but finite. It bounds the tail search. It is reached only by a tail
 * too slow to leave within it, notably one whose 1 - rho rounds to 1 (log(1 - rho) = 0: C is
 * flat past K and nothing ever leaves).
 */
const MAX_EVENT_MONTH = Math.floor(16777216 / MONTH_DAYS);

/** `chanceTable` arrays cover months in stage 0..240 (K <= 240). */
const CHANCE_MONTHS = 241;

/**
 * The least tail month k > K whose C(k) reaches c (strictly above c, or at least c when
 * `inclusive`): the closed form K + ceil(log((1 - c) / (1 - C(K))) / log(1 - rho)), clamped to
 * [K + 1, MAX_EVENT_MONTH], then stepped by one until the test holds at k and fails at k - 1 as
 * `cumulativeTotal` evaluates it (spec §4.2 step 2). Null when no month satisfies that in
 * double precision. `typicalMonths` uses it.
 */
function tailMonth(t: Transition, cs: Constants, c: number, inclusive: boolean): number | null {
  const K = t.months;
  const reached = (k: number) => {
    const ck = total(t, cs, k);
    return inclusive ? ck >= c : ck > c;
  };
  const q = log((1 - c) / (1 - sumsOf(t, cs)[K])) / tailOf(t, cs).logSurvive;
  let k = Number.isFinite(q) ? K + Math.ceil(q) : MAX_EVENT_MONTH;
  k = Math.min(Math.max(k, K + 1), MAX_EVENT_MONTH);
  while (k - 1 > K && reached(k - 1)) k--;
  while (k < MAX_EVENT_MONTH && !reached(k)) k++;
  return reached(k) ? k : null;
}

/**
 * One stage step, the engine's and V27's sampler: `{ kind, days }` with kind = `sampleKind(t,
 * uKind, monthsElapsed)` and days = `sampleTime(t, kind, uTime, monthsElapsed)`. Two uniforms
 * in [0, 1) draw the kind and the time apart, so a rescaled table moves a project's time without
 * changing its kind (paired-draw fix). `monthsElapsed` = tau is the real months already in the
 * stage (fractional allowed); days are integer days from stage entry, >= stageDay(tau). Throws
 * RangeError for either uniform outside [0, 1) or tau outside [0, MAX_EVENT_MONTH - 1).
 *
 * The transition's constants (C(1..K), rho, log(1 - rho), the tail shares, the per-kind
 * columns) are memoised per object on first use (`Constants`): `t` is treated as immutable from
 * then on. Mutating it in place afterwards gives stale results; pass a new object instead.
 */
export function sampleTransition(
  t: Transition,
  uKind: number,
  uTime: number,
  monthsElapsed: number
): { kind: Kind; days: number } {
  const kind = sampleKind(t, uKind, monthsElapsed);
  return { kind, days: sampleTime(t, kind, uTime, monthsElapsed) };
}

/** The linear predictor z of `initiationHazard`: intercept plus the binned coefficients. */
export function initiationLogit(m: InitiationModel, f: Record<FeatureId, number>): number {
  let z = m.intercept;
  for (const term of m.terms) z += term.coef[binIndex(term.bins, f[term.feature])];
  return z;
}

/**
 * Monthly initiation probability: logistic of the intercept plus the binned coefficients.
 * `f` must hold a finite value for every term's feature; this hot-loop function does not check.
 * A missing or NaN feature silently takes bin 0's coefficient (`edge <= NaN` is false), so
 * callers validate their feature records once, before the loop.
 */
export function initiationHazard(m: InitiationModel, f: Record<FeatureId, number>): number {
  let z = m.intercept;
  for (const term of m.terms) z += term.coef[binIndex(term.bins, f[term.feature])];
  return 1 / (1 + exp(-z));
}

type Tabled = Exclude<Stage, 'complete'>;

/**
 * Per pathway and stage, the chance by month in stage m = 0..240 of eventually reaching
 * `complete`: eventual advance from the stage, times the chance from the start of the next stage
 * (1 for `complete`). Beyond 240 callers use index 240, which is the tail value since K <= 240.
 * A stage whose transition, or whose successor's, is missing has no entry.
 */
export function chanceTable(
  cal: Calibration
): Record<Pathway, Partial<Record<Tabled, Float32Array>>> {
  const out = {} as Record<Pathway, Partial<Record<Tabled, Float32Array>>>;
  for (const p of PATHWAYS) {
    const stages = pathwayStages(p);
    const built: Partial<Record<Tabled, Float32Array>> = {};
    let next0: number | undefined = 1; // chance(p, next, 0) in double precision
    for (let i = stages.length - 2; i >= 0; i--) {
      const stage = stages[i] as Tabled;
      const tr = cal.transitions[p][stage];
      if (tr === undefined || next0 === undefined) {
        next0 = undefined;
        continue;
      }
      const arr = new Float32Array(CHANCE_MONTHS);
      let first = 0;
      for (let m = 0; m < CHANCE_MONTHS; m++) {
        const v = eventualProbabilities(tr, m).advance * next0;
        if (m === 0) first = v;
        arr[m] = v;
      }
      built[stage] = arr;
      next0 = first;
    }
    // Built back to front; emit in pathway order.
    const ordered: Partial<Record<Tabled, Float32Array>> = {};
    for (const stage of stages) {
      if (stage !== 'complete' && built[stage]) ordered[stage] = built[stage];
    }
    out[p] = ordered;
  }
  return out;
}

/**
 * Per pathway and stage, the median month of leaving the stage by any outcome: the least k >= 1
 * with C(k) >= 0.5. Inside the table a scan; beyond K the shared closed-form `tailMonth`. A tail
 * too slow to reach 0.5 within the event-month cap reports `MAX_EVENT_MONTH` (finite).
 */
export function typicalMonths(cal: Calibration): Record<Pathway, Partial<Record<Tabled, number>>> {
  const out = {} as Record<Pathway, Partial<Record<Tabled, number>>>;
  for (const p of PATHWAYS) {
    const row: Partial<Record<Tabled, number>> = {};
    for (const stage of pathwayStages(p)) {
      if (stage === 'complete') continue;
      const tr = cal.transitions[p][stage];
      if (tr === undefined) continue;
      const cs = constantsOf(tr);
      const sums = sumsOf(tr, cs);
      let k = 1;
      while (k <= tr.months && sums[k] < 0.5) k++;
      row[stage] = k <= tr.months ? k : (tailMonth(tr, cs, 0.5, true) ?? MAX_EVENT_MONTH);
    }
    out[p] = row;
  }
  return out;
}

/** A `parseCalibration` violation; `path` locates it and the message starts with it. */
export class CalibrationFormatError extends Error {
  constructor(
    readonly path: string,
    message: string
  ) {
    super(`${path}: ${message}`);
    this.name = 'CalibrationFormatError';
  }
}

const TOLERANCE = 1e-9;
const MAX_MONTHS = 240;
const FEATURE_IDS = Object.keys({
  potentialRatio: 0,
  existingUnits: 0,
  lotAreaM2: 0,
  yearBuilt: 0,
  storiesGap: 0,
  improvementShare: 0,
  rentControlLikely: 0,
  landUseClass: 0
} satisfies Record<FeatureId, 0>);

function fail(path: string, message: string): never {
  throw new CalibrationFormatError(path, message);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function record(v: unknown, path: string): Record<string, unknown> {
  if (!isRecord(v)) fail(path, 'expected an object');
  return v;
}

function array(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, 'expected an array');
  return v;
}

function finite(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'expected a finite number');
  return v;
}

function integer(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(path, 'expected an integer');
  return v;
}

function unit(v: unknown, path: string): number {
  const x = finite(v, path);
  if (x < 0 || x > 1) fail(path, `expected a number in [0, 1], got ${x}`);
  return x;
}

function text(v: unknown, path: string): string {
  if (typeof v !== 'string' || v === '') fail(path, 'expected a non-empty string');
  return v;
}

function numbers(v: unknown, path: string): number[] {
  return array(v, path).map((x, i) => finite(x, `${path}[${i}]`));
}

/** Every key of `obj` must be one of `allowed`; the caller checks presence. */
function checkKeys(obj: Record<string, unknown>, path: string, allowed: readonly string[]): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) fail(`${path}.${k}`, 'unexpected key');
  }
}

function checkSumsToOne(xs: number[], path: string): void {
  let s = 0;
  for (const x of xs) s += x;
  if (!(Math.abs(s - 1) <= TOLERANCE)) fail(path, `expected values summing to 1, got ${s}`);
}

function checkProvenance(v: unknown, path: string): void {
  const p = record(v, path);
  const tier = p.tier;
  if (typeof tier !== 'number' || !Number.isInteger(tier) || tier < 0 || tier > 4) {
    fail(`${path}.tier`, 'expected an integer tier 0..4');
  }
  text(p.label, `${path}.label`);
  text(p.method, `${path}.method`);
  const sources = array(p.sources, `${path}.sources`);
  if (sources.length === 0) fail(`${path}.sources`, 'expected at least one source');
  sources.forEach((s, i) => {
    const sp = `${path}.sources[${i}]`;
    const src = record(s, sp);
    text(src.label, `${sp}.label`);
    const url = text(src.url, `${sp}.url`);
    let protocol = '';
    try {
      protocol = new URL(url).protocol;
    } catch {
      // not a URL: reported below
    }
    if (protocol !== 'https:') fail(`${sp}.url`, `expected an https: URL, got ${url}`);
  });
  if (tier <= 2 || p.n !== undefined) {
    if (p.n === undefined) fail(`${path}.n`, `expected n for tier ${tier}`);
    const n = finite(p.n, `${path}.n`);
    if (n < 0) fail(`${path}.n`, 'expected a non-negative n');
  }
  if (tier <= 2 || p.window !== undefined) {
    if (p.window === undefined) fail(`${path}.window`, `expected window for tier ${tier}`);
    const w = array(p.window, `${path}.window`);
    if (w.length !== 2) fail(`${path}.window`, 'expected [from, to]');
    text(w[0], `${path}.window[0]`);
    text(w[1], `${path}.window[1]`);
  }
}

/** A cumulative array: length `months`, values in [0, 1], non-decreasing. */
function checkCumulative(v: unknown, path: string, months: number): number[] {
  const xs = array(v, path);
  if (xs.length !== months) fail(path, `expected length ${months}, got ${xs.length}`);
  let prev = 0;
  return xs.map((x, i) => {
    const y = unit(x, `${path}[${i}]`);
    if (y < prev) fail(`${path}[${i}]`, `expected a non-decreasing array, ${y} < ${prev}`);
    prev = y;
    return y;
  });
}

function checkTransition(v: unknown, path: string): void {
  const t = record(v, path);
  const months = integer(t.months, `${path}.months`);
  if (months < 1 || months > MAX_MONTHS) {
    fail(`${path}.months`, `expected 1..${MAX_MONTHS}, got ${months}`);
  }
  const advance = checkCumulative(t.advance, `${path}.advance`, months);
  const exitObj = record(t.exit, `${path}.exit`);
  checkKeys(exitObj, `${path}.exit`, EXIT_ORDER);
  const exits = EXIT_ORDER.filter((r) => exitObj[r] !== undefined).map((r) =>
    checkCumulative(exitObj[r], `${path}.exit.${r}`, months)
  );
  let c = 0;
  for (let k = 0; k < months; k++) {
    c = advance[k];
    for (const e of exits) c += e[k];
    if (c > 1 + TOLERANCE) {
      fail(`${path}.advance[${k}]`, `advance + exits is ${c} > 1 + 1e-9 at month ${k + 1}`);
    }
  }
  if (c > 1 - 1e-6) fail(path, `cumulative incidence at month ${months} is ${c} > 1 - 1e-6`);

  const tail = record(t.tail, `${path}.tail`);
  checkKeys(tail, `${path}.tail`, ['advance', 'exit']);
  let rho = finite(tail.advance, `${path}.tail.advance`);
  if (rho < 0) fail(`${path}.tail.advance`, `expected a value >= 0, got ${rho}`);
  const tailExit = record(tail.exit, `${path}.tail.exit`);
  checkKeys(tailExit, `${path}.tail.exit`, EXIT_ORDER);
  for (const r of EXIT_ORDER) {
    if (tailExit[r] === undefined) continue;
    const x = finite(tailExit[r], `${path}.tail.exit.${r}`);
    if (x < 0) fail(`${path}.tail.exit.${r}`, `expected a value >= 0, got ${x}`);
    rho += x;
  }
  if (!(rho > 0 && rho <= 1)) fail(`${path}.tail`, `expected 0 < rho <= 1, got ${rho}`);
  checkProvenance(t.provenance, `${path}.provenance`);
  checkProvenance(t.tailProvenance, `${path}.tailProvenance`);
}

function checkTransitions(v: unknown): void {
  const path = 'transitions';
  const all = record(v, path);
  checkKeys(all, path, PATHWAYS);
  for (const p of PATHWAYS) {
    const row = record(all[p], `${path}.${p}`);
    const stages = pathwayStages(p).filter((s) => s !== 'complete');
    checkKeys(row, `${path}.${p}`, stages);
    for (const s of stages) {
      if (row[s] === undefined) fail(`${path}.${p}.${s}`, 'missing transition');
      checkTransition(row[s], `${path}.${p}.${s}`);
    }
  }
}

function checkInitiation(v: unknown): void {
  const path = 'initiation';
  const m = record(v, path);
  if (m.kind !== 'logit-monthly') fail(`${path}.kind`, "expected 'logit-monthly'");
  finite(m.intercept, `${path}.intercept`);
  array(m.terms, `${path}.terms`).forEach((term, i) => {
    const tp = `${path}.terms[${i}]`;
    const t = record(term, tp);
    if (typeof t.feature !== 'string' || !FEATURE_IDS.includes(t.feature)) {
      fail(`${tp}.feature`, `expected one of ${FEATURE_IDS.join(', ')}`);
    }
    const bins = numbers(t.bins, `${tp}.bins`);
    if (bins.length === 0) fail(`${tp}.bins`, 'expected at least one bin');
    for (let j = 1; j < bins.length; j++) {
      if (!(bins[j] > bins[j - 1])) fail(`${tp}.bins`, 'expected strictly ascending bins');
    }
    const coef = numbers(t.coef, `${tp}.coef`);
    if (coef.length !== bins.length) {
      fail(`${tp}.coef`, `expected length ${bins.length} (one per bin), got ${coef.length}`);
    }
  });
  checkProvenance(m.provenance, `${path}.provenance`);
}

function checkSize(v: unknown): void {
  const path = 'size';
  const s = record(v, path);
  const levels = numbers(s.fillLevels, `${path}.fillLevels`);
  if (levels.length === 0) fail(`${path}.fillLevels`, 'expected at least one fill level');
  levels.forEach((x, i) => {
    if (!(x > 0 && x <= 1))
      fail(`${path}.fillLevels[${i}]`, `expected a value in (0, 1], got ${x}`);
    if (i > 0 && !(x > levels[i - 1])) fail(`${path}.fillLevels`, 'expected strictly ascending');
  });
  if (levels[levels.length - 1] !== 1)
    fail(`${path}.fillLevels`, 'expected the last level to be 1');
  const rows = array(s.byEnvelope, `${path}.byEnvelope`);
  if (rows.length === 0) fail(`${path}.byEnvelope`, 'expected at least one entry');
  let prev = -Infinity;
  rows.forEach((row, i) => {
    const rp = `${path}.byEnvelope[${i}]`;
    const r = record(row, rp);
    const upTo = finite(r.maxStoriesUpTo, `${rp}.maxStoriesUpTo`);
    if (upTo < prev) fail(`${rp}.maxStoriesUpTo`, 'expected ascending maxStoriesUpTo');
    prev = upTo;
    const probs = array(r.probs, `${rp}.probs`);
    if (probs.length !== levels.length) {
      fail(`${rp}.probs`, `expected length ${levels.length} (fillLevels), got ${probs.length}`);
    }
    checkSumsToOne(
      probs.map((x, j) => unit(x, `${rp}.probs[${j}]`)),
      `${rp}.probs`
    );
  });
  checkProvenance(s.provenance, `${path}.provenance`);
}

/** Stages from `construction` on: no revision applies there (T4c). */
const NO_REVISION: Stage[] = ['construction', 'complete'];

function checkRevision(v: unknown): void {
  const path = 'revision';
  const r = record(v, path);
  const seen: Stage[] = [];
  array(r.at, `${path}.at`).forEach((entry, i) => {
    const ap = `${path}.at[${i}]`;
    const a = record(entry, ap);
    const stage = a.stage as Stage;
    if (!STAGE_ORDER.includes(stage)) fail(`${ap}.stage`, `expected a stage, got ${String(stage)}`);
    if (NO_REVISION.includes(stage)) fail(`${ap}.stage`, `no revision applies at ${stage}`);
    if (seen.includes(stage)) fail(`${ap}.stage`, `a second revision at ${stage}`);
    seen.push(stage);
    unit(a.probability, `${ap}.probability`);
    const ratio = record(a.ratio, `${ap}.ratio`);
    const edges = numbers(ratio.edges, `${ap}.ratio.edges`);
    for (let j = 1; j < edges.length; j++) {
      if (!(edges[j] > edges[j - 1])) fail(`${ap}.ratio.edges`, 'expected strictly ascending');
    }
    if (!edges.includes(1)) fail(`${ap}.ratio.edges`, 'expected the edges to include 1');
    const probs = array(ratio.probs, `${ap}.ratio.probs`);
    if (probs.length !== edges.length - 1) {
      fail(`${ap}.ratio.probs`, `expected length ${edges.length - 1}, got ${probs.length}`);
    }
    const ps = probs.map((x, j) => unit(x, `${ap}.ratio.probs[${j}]`));
    if (ps.length > 0) checkSumsToOne(ps, `${ap}.ratio.probs`);
  });
  checkProvenance(r.provenance, `${path}.provenance`);
}

function checkPathwayMap(v: unknown, path: string, sumsToOne: boolean): void {
  const m = record(v, path);
  checkKeys(m, path, [...PATHWAYS, 'provenance']);
  const xs = PATHWAYS.map((p) => unit(m[p], `${path}.${p}`));
  if (sumsToOne) checkSumsToOne(xs, path);
  checkProvenance(m.provenance, `${path}.provenance`);
}

function checkPhaseGap(v: unknown): void {
  const path = 'phaseGap';
  const g = record(v, path);
  const days = array(g.days, `${path}.days`);
  if (days.length === 0) fail(`${path}.days`, 'expected at least one gap');
  days.forEach((d, i) => {
    if (integer(d, `${path}.days[${i}]`) < 1) fail(`${path}.days[${i}]`, 'expected a positive day');
    if (i > 0 && (d as number) < (days[i - 1] as number))
      fail(`${path}.days`, 'expected ascending');
  });
  checkProvenance(g.provenance, `${path}.provenance`);
}

/** Every key in `keys` present (`missing`), then no other (`unexpected key`). */
function exactKeys(obj: Record<string, unknown>, path: string, keys: readonly string[]): void {
  for (const k of keys) if (obj[k] === undefined) fail(`${path}.${k}`, 'missing');
  checkKeys(obj, path, keys);
}

function positive(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || !(v > 0)) {
    fail(path, `expected a positive number, got ${String(v)}`);
  }
  return v;
}

/** Spec 4.10: the market model. `today.all` and `.private` must reproduce ln(observed / implied). */
function checkMarket(v: unknown): void {
  const m = record(v, 'market');
  exactKeys(m, 'market', ['today', 'crossCheck', 'slope']);

  const t = record(m.today, 'market.today');
  exactKeys(t, 'market.today', ['all', 'private', 'years', 'observed', 'implied', 'provenance']);
  const years = t.years;
  if (
    !Array.isArray(years) ||
    years.length !== 2 ||
    !Number.isInteger(years[0]) ||
    !Number.isInteger(years[1]) ||
    years[1] !== years[0] + 2
  ) {
    fail('market.today.years', `expected [first, first + 2], got ${JSON.stringify(years)}`);
  }
  const o = record(t.observed, 'market.today.observed');
  exactKeys(o, 'market.today.observed', ['all', 'private']);
  const obs: Record<'all' | 'private', number> = { all: 0, private: 0 };
  for (const k of ['all', 'private'] as const) {
    const x = o[k];
    if (typeof x !== 'number' || !Number.isInteger(x) || x < 1) {
      fail(`market.today.observed.${k}`, `expected a positive integer, got ${String(x)}`);
    }
    obs[k] = x;
  }
  if (obs.private > obs.all) {
    fail('market.today.observed.private', `expected at most ${obs.all}, got ${obs.private}`);
  }
  const implied = positive(t.implied, 'market.today.implied');
  for (const k of ['all', 'private'] as const) {
    const x = t[k];
    if (typeof x !== 'number' || !Number.isFinite(x) || x < -10 || x > 10) {
      fail(`market.today.${k}`, `expected a number in [-10, 10], got ${String(x)}`);
    }
    const want = log(obs[k] / implied);
    if (!(Math.abs(x - want) <= 1e-5)) {
      fail(`market.today.${k}`, `expected ln(observed.${k} ÷ implied) = ${want}, got ${x}`);
    }
  }
  checkProvenance(t.provenance, 'market.today.provenance');

  const c = record(m.crossCheck, 'market.crossCheck');
  exactKeys(c, 'market.crossCheck', ['logOdds', 'provenance']);
  finite(c.logOdds, 'market.crossCheck.logOdds');
  checkProvenance(c.provenance, 'market.crossCheck.provenance');

  const s = record(m.slope, 'market.slope');
  exactKeys(s, 'market.slope', ['perCostShare', 'provenance', 'crossChecks']);
  positive(s.perCostShare, 'market.slope.perCostShare');
  checkProvenance(s.provenance, 'market.slope.provenance');
  const x = record(s.crossChecks, 'market.slope.crossChecks');
  exactKeys(x, 'market.slope.crossChecks', ['costCoefficient', 'priceCoefficient', 'provenance']);
  finite(x.costCoefficient, 'market.slope.crossChecks.costCoefficient');
  finite(x.priceCoefficient, 'market.slope.crossChecks.priceCoefficient');
  checkProvenance(x.provenance, 'market.slope.crossChecks.provenance');
}

export const BASELINE_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Every `PoolKind`: a `Record` so a kind added to the type fails to compile until listed here. */
const POOL_KIND_SET: Record<PoolKind, true> = {
  goBond: true,
  cop: true,
  generalRevenue: true,
  dedicatedTax: true,
  state: true,
  federal: true,
  bank: true
};
const POOL_KINDS = Object.keys(POOL_KIND_SET) as readonly PoolKind[];

/** The keys of each instrument kind (F6), checked before `validateInstrument`. */
const INSTRUMENT_KEYS: {
  [K in Instrument['kind']]: readonly (keyof Extract<Instrument, { kind: K }>)[];
} = {
  grant: ['kind', 'share'],
  loan: ['kind', 'costShare', 'rate', 'requiredReturn'],
  guarantee: ['kind', 'costShare', 'reserve']
};

function checkId(v: unknown, path: string): string {
  if (typeof v !== 'string' || !BASELINE_ID_RE.test(v)) {
    fail(path, `expected an id matching ${BASELINE_ID_RE.source}, got ${String(v)}`);
  }
  return v;
}

function checkInflow(v: unknown, path: string): void {
  const f = record(v, path);
  if (f.kind === 'once') {
    exactKeys(f, path, ['kind', 'day', 'dollars']);
    integer(f.day, `${path}.day`);
    if (integer(f.dollars, `${path}.dollars`) < 0) {
      fail(`${path}.dollars`, `expected a non-negative integer, got ${String(f.dollars)}`);
    }
  } else if (f.kind === 'yearly') {
    exactKeys(f, path, ['kind', 'from', 'to', 'dollarsPerYear']);
    const from = integer(f.from, `${path}.from`);
    if (f.to !== null && integer(f.to, `${path}.to`) < from) {
      fail(`${path}.to`, `expected null or a day from ${from} on, got ${String(f.to)}`);
    }
    if (integer(f.dollarsPerYear, `${path}.dollarsPerYear`) < 0) {
      fail(
        `${path}.dollarsPerYear`,
        `expected a non-negative integer, got ${String(f.dollarsPerYear)}`
      );
    }
  } else {
    fail(`${path}.kind`, `expected once or yearly, got ${String(f.kind)}`);
  }
}

/**
 * F5: shape, id pattern, kind, label, inflows, uncapped (no inflows), debt exactly for goBond and
 * cop (validateDebt's bounds), leverage. Not the `u-` prefix: the caller's rule.
 */
export function checkPool(v: unknown, path: string): void {
  const p = record(v, path);
  exactKeys(p, path, ['id', 'kind', 'label', 'inflows', 'uncapped', 'debt', 'leverage']);
  checkId(p.id, `${path}.id`);
  const kind = p.kind as PoolKind;
  if (!POOL_KINDS.includes(kind)) fail(`${path}.kind`, `expected a pool kind, got ${String(kind)}`);
  text(p.label, `${path}.label`);
  const inflows = array(p.inflows, `${path}.inflows`);
  inflows.forEach((f, i) => checkInflow(f, `${path}.inflows[${i}]`));
  if (typeof p.uncapped !== 'boolean') fail(`${path}.uncapped`, 'expected a boolean');
  if (p.uncapped && inflows.length > 0) {
    fail(`${path}.inflows`, 'expected no inflows on an uncapped pool');
  }
  const hasDebt = kind === 'goBond' || kind === 'cop';
  if (p.debt === null) {
    if (hasDebt) fail(`${path}.debt`, `expected debt for kind ${kind}`);
  } else {
    if (!hasDebt) fail(`${path}.debt`, `expected null debt for kind ${kind}`);
    const d = record(p.debt, `${path}.debt`);
    exactKeys(d, `${path}.debt`, ['rate', 'termYears']);
    const rate = finite(d.rate, `${path}.debt.rate`);
    const termYears = finite(d.termYears, `${path}.debt.termYears`);
    const bad = validateDebt({ rate, termYears });
    if (bad !== null) fail(`${path}.debt`, bad);
  }
  const leverage = finite(p.leverage, `${path}.leverage`);
  if (!(leverage > 0)) fail(`${path}.leverage`, `expected a number above 0, got ${leverage}`);
  if (kind !== 'bank' && leverage !== 1) {
    fail(`${path}.leverage`, `expected 1 unless kind is bank, got ${leverage}`);
  }
}

/**
 * F6: shape, id pattern, pool in `poolIds`, reach, validateInstrument, from/to, minHomes 0..10000,
 * tiers rule. Not the `u-` prefix and not the grant-only rule: the caller's.
 */
export function checkProgramme(v: unknown, path: string, poolIds: ReadonlySet<string>): void {
  const g = record(v, path);
  exactKeys(g, path, [
    'id',
    'label',
    'pool',
    'reach',
    'instrument',
    'from',
    'to',
    'minHomes',
    'tiers'
  ]);
  checkId(g.id, `${path}.id`);
  text(g.label, `${path}.label`);
  if (typeof g.pool !== 'string' || !poolIds.has(g.pool)) {
    fail(`${path}.pool`, `expected a pool id, got ${String(g.pool)}`);
  }
  if (g.reach !== 'market' && g.reach !== 'affordable') {
    fail(`${path}.reach`, `expected market or affordable, got ${String(g.reach)}`);
  }
  const inst = record(g.instrument, `${path}.instrument`);
  if (inst.kind === 'grant' || inst.kind === 'loan' || inst.kind === 'guarantee') {
    exactKeys(inst, `${path}.instrument`, INSTRUMENT_KEYS[inst.kind]);
  }
  const bad = validateInstrument(g.instrument as Instrument);
  if (bad !== null) fail(`${path}.instrument`, bad);
  const from = integer(g.from, `${path}.from`);
  if (g.to !== null && integer(g.to, `${path}.to`) < from) {
    fail(`${path}.to`, `expected null or a day from ${from} on, got ${String(g.to)}`);
  }
  const m = g.minHomes;
  if (typeof m !== 'number' || !Number.isInteger(m) || m < 0 || m > 10000) {
    fail(`${path}.minHomes`, `expected a whole number from 0 to 10000, got ${String(m)}`);
  }
  if (g.reach === 'affordable') {
    if (g.tiers === null) {
      fail(`${path}.tiers`, 'expected tiers for reach affordable');
    }
    const t = record(g.tiers, `${path}.tiers`);
    exactKeys(t, `${path}.tiers`, INCOME_TIERS);
    checkSumsToOne(
      INCOME_TIERS.map((k) => unit(t[k], `${path}.tiers.${k}`)),
      `${path}.tiers`
    );
  } else if (g.tiers !== null) {
    fail(`${path}.tiers`, 'expected null tiers for reach market');
  }
}

/** Spec 4.6: the baseline pools and programmes, one grant programme each, ids never `u-`. */
function checkBaselineFunding(v: unknown): void {
  const path = 'baselineFunding';
  const b = record(v, path);
  exactKeys(b, path, ['pools', 'programmes', 'provenance', 'check']);
  const pools = array(b.pools, `${path}.pools`);
  if (pools.length === 0) fail(`${path}.pools`, 'expected at least one pool');
  const poolIds = new Set<string>();
  const noPrefix = (id: unknown, p: string) => {
    if (typeof id === 'string' && id.startsWith('u-')) {
      fail(p, `expected a baseline id not starting u-, got ${id}`);
    }
  };
  pools.forEach((pool, i) => {
    const pp = `${path}.pools[${i}]`;
    checkPool(pool, pp);
    const id = (pool as { id: string }).id;
    noPrefix(id, `${pp}.id`);
    if (poolIds.has(id)) fail(`${pp}.id`, `expected a unique id, got ${id}`);
    poolIds.add(id);
  });
  const programmes = array(b.programmes, `${path}.programmes`);
  const programmeIds = new Set<string>();
  programmes.forEach((prog, i) => {
    const pp = `${path}.programmes[${i}]`;
    checkProgramme(prog, pp, poolIds);
    const g = prog as { id: string; instrument: Instrument };
    noPrefix(g.id, `${pp}.id`);
    if (programmeIds.has(g.id)) fail(`${pp}.id`, `expected a unique id, got ${g.id}`);
    programmeIds.add(g.id);
    if (g.instrument.kind !== 'grant') {
      fail(`${pp}.instrument`, `expected a grant, got ${g.instrument.kind}`);
    }
  });
  const prov = array(b.provenance, `${path}.provenance`);
  if (prov.length !== pools.length + 1) {
    fail(
      `${path}.provenance`,
      `expected ${pools.length + 1} entries (one per pool, then the programmes' tiers and ` +
        `minHomes), got ${prov.length}`
    );
  }
  prov.forEach((p, i) => checkProvenance(p, `${path}.provenance[${i}]`));
  const c = record(b.check, `${path}.check`);
  exactKeys(c, `${path}.check`, ['impliedHomesPerYear', 'observedHomesPerYear', 'provenance']);
  for (const k of ['impliedHomesPerYear', 'observedHomesPerYear'] as const) {
    const x = c[k];
    if (typeof x !== 'number' || !Number.isInteger(x) || x < 0) {
      fail(`${path}.check.${k}`, `expected a non-negative integer, got ${String(x)}`);
    }
  }
  checkProvenance(c.provenance, `${path}.check.provenance`);
}

/**
 * Validate a parsed `calibration.json` (design doc T12, spec section 4.2). Throws a
 * `CalibrationFormatError` naming the path of the first violation; otherwise returns the same
 * value, typed. The input is never mutated or copied. `size.fillLevels` is checked internally
 * only (ruling A2): equality with T11's `FILL_LEVELS` is V25's and timelapse-sim's job.
 */
export function parseCalibration(json: unknown): Calibration {
  const c = record(json, '$');
  if (c.schema !== 1) fail('schema', `expected 1, got ${String(c.schema)}`);
  integer(c.asOf, 'asOf');
  checkTransitions(c.transitions);
  checkInitiation(c.initiation);
  checkPathwayMap(c.pathwayForNew, 'pathwayForNew', true);
  checkPathwayMap(c.ppaShare, 'ppaShare', false);
  checkSize(c.size);
  checkRevision(c.revision);
  if (c.streamlinedForLocalProgram === undefined) fail('streamlinedForLocalProgram', 'missing');
  checkProvenance(c.streamlinedForLocalProgram, 'streamlinedForLocalProgram');
  checkPhaseGap(c.phaseGap);
  if (c.market !== undefined) checkMarket(c.market);
  if (c.affordableRoutes !== undefined)
    checkPathwayMap(c.affordableRoutes, 'affordableRoutes', true);
  if (c.baselineFunding !== undefined) checkBaselineFunding(c.baselineFunding);
  return json as Calibration;
}
