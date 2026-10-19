/**
 * Calibration model (design doc T12): pure, free of any schema library and worker-safe. Only
 * `./types`, `./time` and `./math` are imported, and `exp`/`log` come from `./math` so results
 * are bit-reproducible. Per-transition constants are memoised by object identity (`Constants`),
 * so a Transition must not be mutated after its first use here.
 */
import { exp, log } from './math';
import { MONTH_DAYS } from './time';
import {
  EXIT_ORDER,
  PATHWAYS,
  STAGE_ORDER,
  pathwayStages,
  type Calibration,
  type ExitReason,
  type FeatureId,
  type InitiationModel,
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
  /** `tableSlice` boundary j of table month k at bounds[(k - 1) * (kinds.length - 1) + j]. */
  bounds?: number[];
};

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

/**
 * `tableSlice`'s boundaries: for table month k and j < kinds.length - 1, the sum of F_i(k) for
 * i <= j and F_i(k - 1) for i > j, over `kinds` in order, starting from 0.
 */
function boundsOf(t: Transition, c: Constants): number[] {
  if (c.bounds === undefined) {
    const { kinds } = tailOf(t, c);
    const at = (kind: Kind, month: number) =>
      month === 0
        ? 0
        : kind === 'advance'
          ? t.advance[month - 1]
          : (t.exit[kind]?.[month - 1] ?? 0);
    const bounds: number[] = [];
    for (let k = 1; k <= t.months; k++) {
      for (let j = 0; j < kinds.length - 1; j++) {
        let hi = 0;
        for (let i = 0; i < kinds.length; i++) hi += at(kinds[i], i <= j ? k : k - 1);
        bounds.push(hi);
      }
    }
    c.bounds = bounds;
  }
  return c.bounds;
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

type Slice = { kind: Kind; lo: number; hi: number };
type Draw = { k: number; slice: Slice; x: number };

/** The least k in (m, K] with C(k) > c, given C(m) <= c < C(K): binary search. */
function tableMonth(t: Transition, sums: number[], c: number, m: number): number {
  let below = m; // invariant: C(below) <= c < C(above)
  let above = t.months;
  while (above - below > 1) {
    const mid = (below + above) >>> 1;
    if (sums[mid] > c) above = mid;
    else below = mid;
  }
  return above;
}

/**
 * The least tail month k > K whose C(k) reaches c (strictly above c, or at least c when
 * `inclusive`): the closed form K + ceil(log((1 - c) / (1 - C(K))) / log(1 - rho)), clamped to
 * [K + 1, MAX_EVENT_MONTH], then stepped by one until the test holds at k and fails at k - 1 as
 * `cumulativeTotal` evaluates it (spec §4.2 step 2). Null when no month satisfies that in
 * double precision. `sampleTransition` (m < K) and `typicalMonths` share it.
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
 * A tail draw relative to `from` >= K whole months survived (controller ruling R8): by
 * memorylessness, the months still to wait follow G(n) = 1 - (1 - rho)^n whatever `from` is,
 * so this is spec §4.2 in exact arithmetic without forming c = C(m) + (1 - C(m)) * u, which
 * loses every digit once 1 - C(m) nears 1e-16. n = the least n >= 1 with G(n) > v (closed form
 * ceil(log(1 - v) / log(1 - rho)), then stepped by one), k = from + n, and the slice is
 * [G(n - 1), G(n)) split by p_j / rho. If no n up to MAX_EVENT_MONTH qualifies (log(1 - rho) =
 * 0, or a tail too slow for the cap), k is the cap and v is split over the mass the search
 * never reached, [G(top), 1).
 */
function relativeTail(t: Transition, c: Constants, from: number, v: number): Draw {
  const tc = tailOf(t, c);
  const L = tc.logSurvive;
  const G = (n: number) => (n === 0 ? 0 : 1 - exp(n * L));
  const top = Math.max(MAX_EVENT_MONTH - from, 1);
  const q = Math.ceil(log(1 - v) / L);
  let n = Number.isFinite(q) ? Math.min(Math.max(q, 1), top) : top;
  while (n > 1 && G(n - 1) > v) n--;
  while (n < top && G(n) <= v) n++;
  if (G(n) > v) return { k: from + n, slice: tailSlice(tc, G(n - 1), G(n), v), x: v };
  return { k: from + top, slice: tailSlice(tc, G(top), 1, v), x: v };
}

/**
 * The sub-interval of table month k's mass [C(k - 1), C(k)) holding c, split by the increments
 * of F_j in the order advance, then `EXIT_ORDER`. Boundary j sums F_i(k) for i <= j and
 * F_i(k - 1) for i > j in that fixed order (`boundsOf`), so the last boundary is exactly C(k).
 */
function tableSlice(t: Transition, cs: Constants, k: number, c: number): Slice {
  const { kinds } = tailOf(t, cs);
  const sums = sumsOf(t, cs);
  const bounds = boundsOf(t, cs);
  const width = kinds.length - 1;
  const row = (k - 1) * width;
  let lo = k === 1 ? 0 : sums[k - 1];
  let j = 0;
  for (; j < width; j++) {
    const hi = bounds[row + j];
    if (c < hi) return { kind: kinds[j], lo, hi };
    lo = hi;
  }
  return { kind: kinds[j], lo, hi: sums[k] };
}

/**
 * The sub-interval of [lo, hi) holding x, split by the tail proportions p_j / rho in the order
 * advance, then `EXIT_ORDER`. The last kind with a positive share ends exactly at hi.
 */
function tailSlice(tc: TailConstants, lo: number, hi: number, x: number): Slice {
  const { kinds, last, acc } = tc;
  let from = lo;
  for (let j = 0; j < last; j++) {
    const to = lo + (hi - lo) * acc[j];
    if (x < to) return { kind: kinds[j], lo: from, hi: to };
    from = to;
  }
  return { kind: kinds[last], lo: from, hi };
}

/** The draw for m < K: spec §4.2 steps 1 to 3 literally (1 - C(m) >= 1 - C(K) >= 1e-6). */
function literalDraw(t: Transition, cs: Constants, u: number, m: number): Draw {
  const sums = sumsOf(t, cs);
  const cm = total(t, cs, m);
  const c = cm + (1 - cm) * u;
  if (c < sums[t.months]) {
    const k = tableMonth(t, sums, c, m);
    return { k, slice: tableSlice(t, cs, k, c), x: c };
  }
  const k = tailMonth(t, cs, c, false);
  if (k !== null) {
    const slice = tailSlice(tailOf(t, cs), total(t, cs, k - 1), total(t, cs, k), c);
    return { k, slice, x: c };
  }
  // Past the cap (a flat or very slow tail), or c rounded to 1, which needs 1 - u < ~1.1e-10
  // (below mulberry32's 2^-32 step): draw relative to K at v = (c - C(K)) / (1 - C(K)), the
  // position within the tail. Only a c that rounded to 1 has lost it, and u stands in.
  const ck = sums[t.months];
  return relativeTail(t, cs, t.months, c < 1 ? (c - ck) / (1 - ck) : u);
}

/**
 * One uniform u in [0, 1) to an outcome and a duration in days from stage entry, given
 * `monthsElapsed` = m whole months already survived (spec §4.2): target c = C(m) + (1 - C(m))u;
 * event month k = the least k > m with C(k) > c; kind = the slice of month k's mass holding c;
 * the day within month k is uniform by c's position in that slice. For m >= K the same mapping
 * is evaluated relative to m by memorylessness (`relativeTail`, ruling R8). monthsIn(0, days) =
 * k - 1 and days >= ceil(m * MONTH_DAYS).
 *
 * The transition's constants (C(1..K), rho, log(1 - rho), the tail shares, the table slice
 * boundaries) are memoised per object on first use (`Constants`): `t` is treated as immutable
 * from then on. Mutating it in place afterwards gives stale results; pass a new object instead.
 */
export function sampleTransition(
  t: Transition,
  u: number,
  monthsElapsed: number
): { kind: Kind; days: number } {
  checkMonths(monthsElapsed);
  if (!(u >= 0 && u < 1)) throw new RangeError(`u must be in [0, 1), got ${u}`);
  const cs = constantsOf(t);
  const { k, slice, x } =
    monthsElapsed < t.months
      ? literalDraw(t, cs, u, monthsElapsed)
      : relativeTail(t, cs, monthsElapsed, u);
  const phi = (x - slice.lo) / (slice.hi - slice.lo);
  const first = Math.ceil((k - 1) * MONTH_DAYS);
  const end = Math.ceil(k * MONTH_DAYS);
  return { kind: slice.kind, days: Math.min(first + Math.floor(phi * (end - first)), end - 1) };
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
  return json as Calibration;
}
