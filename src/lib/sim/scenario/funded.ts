// The funded simulated pass (finance-engine spec 4.1, 4.5 to 4.12) and the funded latent starts
// of one attempt (spec 4.4): per lot and attempt, the ordinary start (today's arithmetic,
// unchanged), and one funded latent start per project kind some programme reaches, on the finer
// finance segments (spec 4.3). Pure and worker-safe; `exp` and `log` only from math.ts.
//
// `engine.ts` imports this module and this module imports `engine.ts` (builder's call): nothing
// here reads an `engine.ts` binding at module evaluation time, only inside functions.
import { FILL_LEVELS, fillStories } from '$lib/data/scenario-codec';
import { exp, log } from '$lib/timelapse/math';
import { MONTH_DAYS, type Day } from '$lib/timelapse/time';
import type { Pathway, ProjectKind } from '$lib/timelapse/types';
import {
  PROTOTYPES,
  costPerHome,
  oddsShift,
  projectDollars,
  prototypeFor,
  uncoveredPerHome,
  type Prototype,
  type PrototypeId
} from '../finance';
import {
  holdVoids,
  newJob,
  ordinaryMonth,
  pathwayFrom,
  reservationsOff,
  runOf,
  simulatedProject,
  startSimulated,
  type EngineOpts,
  type Holds,
  type Run,
  type Sink
} from './engine';
import {
  awardPasses,
  awardSet,
  below,
  coverageLevel,
  financeIndexOf,
  isOffered,
  type Award,
  type FinanceIndex
} from './funding';
import { groupedLine, scanLine, type App, type AwardProbe, type AwardTest } from './line';
import { Treasury, type LedgerEvent } from './money';
import {
  lastInitiationMonth,
  parcelRankOf,
  piecewiseMonth,
  precomputeOf,
  regimeMonths,
  sizeCumAgainst,
  skipBounds,
  type Precompute
} from './input';
import { P, drawOn, simEntity, streamOf } from './rng';
import type { Schedule, SimInput } from './types';

const F = FILL_LEVELS.length;
const KINDS: readonly ProjectKind[] = ['market', 'affordable'];
/** `keyDay` of a latent that never starts, and the bound every later day compares equal to. */
export const NEVER_KEY_DAY = 268_435_456; // 2^28
const RANK_LIMIT = 524_288; // 2^19
const KEY_DAY_SCALE = 1_048_576; // 2^20
const PROTOTYPE = new Map<PrototypeId, Prototype>(PROTOTYPES.map((p) => [p.id, p]));

/**
 * The finance segments of one input (spec 4.3), memoised per input. Segment j covers the months
 * that start on or after its start day (`asOf + 1` for j = 0, else `days[j − 1]`) and before
 * `days[j]`; within it the view, the market step and the offered programmes are constant.
 */
export interface FinancePre {
  /**
   * The change days after `asOf`, ascending, deduplicated: `Precompute.segments.days` (regime and
   * later market days), every programme's `from` and `to + 1` and every `off` entry's `from` and
   * `to + 1`.
   */
  days: Day[];
  /**
   * The re-pricing days (spec 4.11), ascending, deduplicated, a subset of `days`: the days after
   * `asOf` in { programme `from`, `to + 1` } ∪ { `off` `from`, `to + 1` } ∪ regime days. Market
   * step days are not among them: a step changes no bundle and no size. The horizon cut is the
   * run's.
   */
  repricing: Day[];
  /** per segment: its regime view (0 = `input.parcels`) */
  view: number[];
  /** per segment: the index of the `Precompute.segments` segment it lies in */
  ordSeg: number[];
  /** per segment: the log-odds of the market step in force on its start day (0 = none) */
  m: number[];
  /**
   * per kind and segment: the programmes of that kind offered on the segment's start day, as
   * ascending indices into `finance.programmes`
   */
  offered: Record<ProjectKind, number[][]>;
  /** the kinds some programme reaches, in F1 order */
  reached: ProjectKind[];
  /** `parcelRankOf(input.parcels.id)` */
  rank: Uint32Array;
  /** `financeIndexOf(input.finance)` */
  index: FinanceIndex;
  /**
   * Per kind, by candidate (`Precompute.candidates` order): 1 when the lot's largest level in some
   * view where it has a hazard meets the least `minHomes` of the kind's programmes (spec 4.17 item
   * 1). A lot with 0 can never be in a bundle of that kind, so that kind's latent never applies.
   */
  eligible: Record<ProjectKind, Uint8Array>;
  /**
   * Per candidate, a bound on attempt 0's INIT draw `uO` for a lot at risk from `asOf` (spec 4.17
   * item 2): above it neither the ordinary start nor the market funded start is on or before
   * `horizon`. Built as `skipAbove` from the per-segment rates `min(ordinary, the most-shifted
   * market bundle any level of the lot can get in the segment's view)`; `Infinity` where some such
   * bundle is certain. A cost shortcut only: every draw at or below it takes the exact path.
   */
  marketSkip(horizon: Day): Float64Array;
  /**
   * The same bound for the affordable kind's draw `uA` (the builder's addition, exact on the same
   * argument): the per-segment rate is the least of the lot's affordable rates over its levels
   * (unshifted where a level's bundle is empty, shifted where not); `Infinity` where some bundle
   * is certain. Above it the affordable latent is after `horizon` and makes no application.
   */
  affordableSkip(horizon: Day): Float64Array;
}

const pres = new WeakMap<SimInput, FinancePre>();

export function financePreOf(input: SimInput): FinancePre {
  const hit = pres.get(input);
  if (hit) return hit;
  const f = input.finance;
  if (!f) throw new Error('financePreOf: the input has no finance');
  const { asOf } = input;
  const segs = precomputeOf(input).segments;
  const all = new Set<Day>();
  const re = new Set<Day>();
  const add = (d: Day, repricing: boolean) => {
    if (d <= asOf) return;
    all.add(d);
    if (repricing) re.add(d);
  };
  for (const d of segs.days) add(d, false);
  for (const g of input.regimes ?? []) add(g.day, true);
  for (const g of f.programmes) {
    add(g.from, true);
    if (g.to !== null) add(g.to + 1, true);
  }
  for (const o of f.off) {
    add(o.from, true);
    if (o.to !== null) add(o.to + 1, true);
  }
  const days = [...all].sort((a, b) => a - b);
  const index = financeIndexOf(f);
  const steps = input.market ?? [];
  const view: number[] = [];
  const ordSeg: number[] = [];
  const m: number[] = [];
  const offered: Record<ProjectKind, number[][]> = { market: [], affordable: [] };
  for (let j = 0; j <= days.length; j++) {
    const start = j === 0 ? asOf + 1 : days[j - 1];
    // `segmentsOf` dates segment 0 from asOf; every segment day is after asOf
    const ordStart = j === 0 ? asOf : start;
    let o = 0;
    while (o < segs.days.length && segs.days[o] <= ordStart) o++;
    ordSeg.push(o);
    view.push(segs.view[o]);
    let step = 0;
    for (const s of steps) if (s.from <= start) step = s.logOdds;
    m.push(step);
    for (const kind of KINDS) {
      const out: number[] = [];
      f.programmes.forEach((g, gi) => {
        if (g.reach === kind && isOffered(index, gi, start)) out.push(gi);
      });
      offered[kind].push(out);
    }
  }
  const pre = precomputeOf(input);
  const views = viewsOf(input, pre);
  const eligible = {
    market: eligibleOf(views, pre.candidates, f.programmes, 'market'),
    affordable: eligibleOf(views, pre.candidates, f.programmes, 'affordable')
  };
  // the skip bounds of a horizon finish the input's warm first (`financeWarm`)
  const skips = (kind: ProjectKind) => (horizon: Day) => {
    financeWarm(input, horizon).step(Infinity);
    return fused.get(fp)!.bounds.get(horizon)![kind];
  };
  const fp: FinancePre = {
    days,
    repricing: [...re].sort((a, b) => a - b),
    view,
    ordSeg,
    m,
    offered,
    reached: KINDS.filter((k) => f.programmes.some((g) => g.reach === k)),
    rank: parcelRankOf(input.parcels.id),
    index,
    eligible,
    marketSkip: skips('market'),
    affordableSkip: skips('affordable')
  };
  pres.set(input, fp);
  fused.set(fp, {
    input,
    views,
    pre,
    next: 0,
    rates: null,
    certain: null,
    tabs: null,
    bounds: new Map()
  });
  return fp;
}

/** One view's parcels and precompute (0 = the input's own). */
interface View {
  parcels: SimInput['parcels'];
  pre: Precompute;
}

function viewsOf(input: SimInput, pre: Precompute): View[] {
  return [
    { parcels: input.parcels, pre },
    ...(input.regimes ?? []).map((g, k) => ({ parcels: g.parcels, pre: pre.regimes[k] }))
  ];
}

/** `FinancePre.eligible` for one kind. */
function eligibleOf(
  views: readonly View[],
  candidates: Int32Array,
  programmes: NonNullable<SimInput['finance']>['programmes'],
  kind: ProjectKind
): Uint8Array {
  const out = new Uint8Array(candidates.length);
  let least = Infinity;
  for (const g of programmes) if (g.reach === kind) least = Math.min(least, g.minHomes);
  if (least === Infinity) return out;
  for (let c = 0; c < candidates.length; c++) {
    const i = candidates[c];
    for (const w of views) {
      if (w.pre.logit[i] === -Infinity) continue;
      let top = 0;
      for (let f = 0; f < F; f++) top = Math.max(top, w.parcels.yield[i * F + f]);
      if (top >= least) {
        out[c] = 1;
        break;
      }
    }
  }
  return out;
}

/** The lot's size in one view: level, homes, stories and prototype. */
export interface LatentSize {
  f: number;
  units: number;
  stories: number;
  protoId: PrototypeId;
}

/**
 * One kind's funded latent start (spec 4.4). `T` is its month from the spell's risk start (0 =
 * never); `day` its application day, null when there is none (T = 0, after the horizon, or an
 * empty bundle in month T). `keyDay` is the line's second key: `start(T_O)` for `market`,
 * `start(T_ref)` at the unshifted affordable rates for `affordable`, `NEVER_KEY_DAY` when that
 * month is 0. `view`, the size fields, `bundle` (ascending programme indices) and `level` (its
 * coverage level, 0 when empty) are month T's. When T = 0 they are the last segment's, and a view
 * with no size gives f = −1, units 0, stories 0 and protoId 'E': read them only when T ≠ 0.
 */
export interface KindLatent {
  kind: ProjectKind;
  T: number;
  day: Day | null;
  keyDay: Day;
  view: number;
  f: number;
  units: number;
  stories: number;
  protoId: PrototypeId;
  bundle: number[];
  level: number;
}

/** The draws of one attempt, on its `(entity, k)` stream. */
export interface AttemptDraws {
  uO: number;
  vO: number;
  uA: number;
  vA: number;
  uS: number;
}

/**
 * The latents of one attempt. `TO` is the ordinary month (0 = never), `O` its day (null when
 * never or after the horizon; the reservation cut is the pass's), `Oview` its view. `size` is the
 * size draw per view (null when the view has none). `market` and `affordable` are null when no
 * programme reaches that kind.
 */
export interface AttemptLatents extends AttemptDraws {
  TO: number;
  O: Day | null;
  Oview: number;
  size: (LatentSize | null)[];
  market: KindLatent | null;
  affordable: KindLatent | null;
}

/** The first day of month T from risk start r. */
const startOf = (r: Day, T: number): Day => r + 1 + Math.floor((T - 1) * MONTH_DAYS);

const logistic = (x: number) => 1 / (1 + exp(-x));

/** The view's parcels, input and precompute (0 = the run's own). */
function viewOf(run: Run, v: number) {
  return v > 0 ? run.regimes[v - 1] : run;
}

/** The size draw `uS` in view v against `existing` units, as `simulatedProject` draws it. */
function sizeIn(run: Run, v: number, i: number, existing: number, uS: number): LatentSize | null {
  const w = viewOf(run, v);
  const p = w.parcels;
  const own = existing === p.existingUnits[i];
  const cum = own ? w.pre.sizeCum : sizeCumAgainst(w.input, i, existing);
  const at = own ? i * F : 0;
  let f = 0;
  while (f < F && !(uS < cum[at + f])) f++;
  if (f === F) return null;
  return sizeAt(p, i, f);
}

/** The size of row i at level f of a parcels table, built once (`sizeMemo`). */
function sizeAt(p: SimInput['parcels'], i: number, f: number): LatentSize {
  let memo = sizeMemo.get(p);
  if (memo === undefined) {
    memo = new Array(p.count * F);
    sizeMemo.set(p, memo);
  }
  let sz = memo[i * F + f];
  if (sz === undefined) {
    const units = p.yield[i * F + f];
    const stories = fillStories(FILL_LEVELS[f], p.envelopeStories[i]);
    sz = { f, units, stories, protoId: prototypeFor(stories, units).id };
    memo[i * F + f] = sz;
  }
  return sz;
}

/**
 * The size of row i at level f in a view does not depend on the draw or the existing homes, so
 * each is built once per parcels table and shared (never mutated).
 */
const sizeMemo = new WeakMap<SimInput['parcels'], (LatentSize | undefined)[]>();

/** The view of the last `ordinaryMonthOf` (module scratch: read it right after the call). */
let ordView = 0;

/**
 * Today's ordinary month on the `Precompute.segments` grid from risk start r (0 = never); its view
 * goes to `ordView`.
 */
function ordinaryMonthOf(run: Run, i: number, r: Day, uO: number): number {
  const { segments, log1mh } = run.pre;
  const K = segments.days.length;
  ordView = 0;
  if (K === 0) {
    // the engine reaches this only on candidates, whose log1mh is below 0
    if (!(log1mh[i] < 0)) return 0;
    return ordinaryMonth(uO, log1mh[i], null, []);
  }
  const bounds = regimeMonths(r, segments.days);
  const rates = segments.log1mh.map((a) => a[i]);
  const T = ordinaryMonth(uO, log1mh[i], bounds, rates);
  let seg = 0;
  while (seg < K && bounds[seg] < T) seg++;
  ordView = segments.view[seg];
  return T;
}

/** Today's ordinary month on the `Precompute.segments` grid from risk start r (0 = never). */
function ordinaryT(run: Run, i: number, r: Day, uO: number): { T: number; view: number } {
  const T = ordinaryMonthOf(run, i, r, uO);
  return { T, view: ordView };
}

/** The ordinary start's day from r for month T on draw vO; null when never or after the horizon. */
function ordinaryDay(run: Run, r: Day, T: number, vO: number): Day | null {
  if (T === 0) return null;
  const day = r + 1 + Math.floor((T - 1 + vO) * MONTH_DAYS);
  return day <= run.horizon ? day : null;
}

const EMPTY: number[] = [];

interface BundleMemo {
  byUnits: Map<number, number[]>;
  byKey: Map<string, number[]>;
}

const bundles = new WeakMap<FinancePre, Record<ProjectKind, BundleMemo[]>>();

/**
 * The programmes of kind κ offered in segment j whose `minHomes` a lot of `units` homes meets,
 * ascending: one shared array per (kind, segment, set), so the price memo, the bundle keys and the
 * line's groups find it by identity. Never mutate it.
 */
function bundleOf(
  fp: FinancePre,
  fin: NonNullable<SimInput['finance']>,
  kind: ProjectKind,
  j: number,
  units: number
): number[] {
  let m = bundles.get(fp);
  if (!m) {
    const per = () => fp.view.map(() => ({ byUnits: new Map(), byKey: new Map() }));
    m = { market: per(), affordable: per() };
    bundles.set(fp, m);
  }
  const memo = m[kind][j];
  let b = memo.byUnits.get(units);
  if (b === undefined) {
    const set = fp.offered[kind][j].filter((g) => fin.programmes[g].minHomes <= units);
    const key = set.join(',');
    b = memo.byKey.get(key);
    if (b === undefined) {
      b = set;
      memo.byKey.set(key, b);
    }
    memo.byUnits.set(units, b);
  }
  return b;
}

/** One segment's values for a lot of one size (spec 4.4): rate, unshifted rate, bundle, level. */
interface SegValue {
  rate: number;
  ref: number;
  bundle: number[];
  level: number;
}

/**
 * The rate, unshifted rate, bundle and level of kind κ in segment j for row i at size `sz` in the
 * segment's view, whose log-odds is z (finite), with `ord` the ordinary rate (market) or 0. The
 * one computation both the direct path and the tables (`KindTables`) use.
 */
function segValue(
  fp: FinancePre,
  fin: NonNullable<SimInput['finance']>,
  kind: ProjectKind,
  j: number,
  z: number,
  sz: LatentSize,
  ord: number
): SegValue {
  const market = kind === 'market';
  const { slope } = fin;
  const p = PROTOTYPE.get(sz.protoId)!;
  const x0 = market
    ? z + fp.m[j]
    : z +
      fp.m[j] -
      (slope * (uncoveredPerHome('affordable', p) - uncoveredPerHome('market', p))) /
        costPerHome('affordable', p);
  const ref = market ? ord : log(1 - logistic(x0));
  const bundle = bundleOf(fp, fin, kind, j, sz.units);
  if (bundle.length === 0) return { rate: ref, ref, bundle, level: 0 };
  const priced = fp.index.price(kind, bundle, sz.protoId);
  const level = coverageLevel(priced.coverage);
  if (priced.certain) return { rate: -Infinity, ref, bundle, level };
  const x = log(1 - logistic(x0 + oddsShift(priced.grantEquivalent, kind, p, slope)));
  return { rate: market ? Math.min(ord, x) : x, ref, bundle, level };
}

/**
 * Per kind, the seed-independent values of `segValue` per eligible lot, size level and segment
 * (spec 4.17 fallback 1, kept in 64-bit floats so that a run reads exactly what it would compute):
 * a run does no `exp`, `log` or pricing for an entry already filled. The input's warm
 * (`financeWarm`) fills every entry whose level has homes; a run fills any other it needs. Indexed
 * `slot * F + f`, `slot` the lot's place among the kind's eligible candidates.
 */
export interface KindTables {
  /** by candidate: its slot, or −1 when not eligible */
  slot: Int32Array;
  /** per segment: the rate and unshifted rate; read only where `at` is filled */
  rate: Float64Array[];
  ref: Float64Array[];
  /**
   * per segment: the index of the entry's (bundle, level) in `values[j]`, `none[j]` until filled.
   * A `Uint8Array` (none 255) until the segment has 255 values, then promoted to a `Uint16Array`
   * (none 65,535), then to a `Uint32Array`.
   */
  at: (Uint8Array | Uint16Array | Uint32Array)[];
  none: number[];
  values: { bundle: number[]; level: number }[][];
  /** per segment: `values[j]` by bundle (the canonical `bundleOf` array), then level */
  index: Map<readonly number[], Map<number, number>>[];
}

function tablesFor(fp: FinancePre): Record<ProjectKind, KindTables> {
  const make = (kind: ProjectKind): KindTables => {
    const elig = fp.eligible[kind];
    const slot = new Int32Array(elig.length).fill(-1);
    let n = 0;
    for (let c = 0; c < elig.length; c++) if (elig[c] === 1) slot[c] = n++;
    const per = <T>(fill: () => T) => Array.from({ length: fp.view.length }, fill);
    return {
      slot,
      rate: per(() => new Float64Array(n * F)),
      ref: per(() => new Float64Array(kind === 'market' ? 0 : n * F)),
      at: per(() => new Uint8Array(n * F).fill(255)),
      none: per(() => 255),
      values: per(() => []),
      index: per(() => new Map())
    };
  };
  return { market: make('market'), affordable: make('affordable') };
}

/** Segment j's index of (bundle, level) in `t.values[j]`, added (and `at` promoted) when new. */
function valueAt(t: KindTables, j: number, bundle: number[], level: number): number {
  let byLevel = t.index[j].get(bundle);
  if (byLevel === undefined) {
    byLevel = new Map();
    t.index[j].set(bundle, byLevel);
  }
  let at = byLevel.get(level);
  if (at === undefined) {
    at = t.values[j].length;
    if (at >= t.none[j]) {
      const old = t.at[j];
      const none = t.none[j];
      const wide = none === 255 ? new Uint16Array(old.length) : new Uint32Array(old.length);
      const wideNone = none === 255 ? 65_535 : 4_294_967_295;
      for (let x = 0; x < old.length; x++) wide[x] = old[x] === none ? wideNone : old[x];
      t.at[j] = wide;
      t.none[j] = wideNone;
    }
    t.values[j].push({ bundle, level });
    byLevel.set(level, at);
  }
  return at;
}

/** Fills one table entry from its `segValue` (a no-op when it is filled). */
function fillEntry(t: KindTables, j: number, x: number, sv: SegValue, market: boolean): void {
  if (t.at[j][x] !== t.none[j]) return;
  const at = valueAt(t, j, sv.bundle, sv.level);
  t.at[j][x] = at;
  t.rate[j][x] = sv.rate;
  if (!market) t.ref[j][x] = sv.ref;
}

/**
 * The warm of one input (perf Task 1): one pass over its candidates that fills, per kind, the
 * per-segment skip rates (`FinancePre.marketSkip`, `affordableSkip`) and the tables together,
 * resumable between candidates. `bounds` holds the skip bounds per horizon once the pass is done.
 */
interface Fused {
  input: SimInput;
  views: View[];
  pre: Precompute;
  /** the next candidate of the pass */
  next: number;
  /**
   * per kind and segment, by row (candidates only): the least rate of the kind over the lot's
   * levels, at or below the kind's rate in that segment for every size the lot can draw (the
   * market kind's starts at the ordinary rate, the affordable kind's at 0); 0 where it is −∞
   */
  rates: Record<ProjectKind, Float64Array[]> | null;
  /** per kind, by candidate: 1 when some certain bundle of the kind reaches the lot */
  certain: Record<ProjectKind, Uint8Array> | null;
  tabs: Record<ProjectKind, KindTables> | null;
  bounds: Map<Day, Record<ProjectKind, Float64Array>>;
}

const fused = new WeakMap<FinancePre, Fused>();

/**
 * Does candidates `s.next` to `s.next + max − 1` of the fused pass; true once every candidate is
 * done. Per candidate, kind and segment, each level with homes in the segment's view (when the lot
 * is eligible and has a hazard there) takes one `segValue` on the canonical bundle: its entry goes
 * into the tables and its rate into the segment's skip rate.
 */
function advance(fp: FinancePre, s: Fused, max: number): boolean {
  const { pre, views } = s;
  const { candidates } = pre;
  if (s.tabs === null) {
    const n = s.input.parcels.count;
    s.rates = {
      market: fp.view.map(() => new Float64Array(n)),
      affordable: fp.view.map(() => new Float64Array(n))
    };
    s.certain = {
      market: new Uint8Array(candidates.length),
      affordable: new Uint8Array(candidates.length)
    };
    s.tabs = tablesFor(fp);
  }
  const end = Math.min(candidates.length, s.next + max);
  const fin = s.input.finance!;
  const J = fp.view.length;
  for (let c = s.next; c < end; c++) {
    const i = candidates[c];
    for (const kind of KINDS) {
      const market = kind === 'market';
      const t = s.tabs[kind];
      const rates = s.rates![kind];
      const slot = t.slot[c];
      for (let j = 0; j < J; j++) {
        const ord = market ? pre.segments.log1mh[fp.ordSeg[j]][i] : 0;
        let best = ord;
        const w = views[fp.view[j]];
        const z = w.pre.logit[i];
        // the market kind's rate is never above the ordinary one; the affordable kind's is 0 where
        // the view has no size or no hazard (the affordable bound is read only for eligible lots)
        if (slot >= 0 && z !== -Infinity) {
          const p = w.parcels;
          for (let f = 0; f < F; f++) {
            const units = p.yield[i * F + f];
            if (!(units > 0)) continue;
            const sz = sizeAt(p, i, f);
            const sv = segValue(fp, fin, kind, j, z, sz, ord);
            fillEntry(t, j, slot * F + f, sv, market);
            if (sv.rate === -Infinity && fp.index.price(kind, sv.bundle, sz.protoId).certain) {
              s.certain![kind][c] = 1;
            }
            if (sv.rate < best) best = sv.rate;
          }
        }
        rates[j][i] = best === -Infinity ? 0 : best;
      }
    }
  }
  s.next = end;
  return end === candidates.length;
}

/** Candidates per host warm step: 2 × 16,384 × about 0.7 µs ≈ 23 ms on a quiet machine. */
export const WARM_CHUNK = 16_384;

export interface FinanceWarm {
  /**
   * Does the next `maxCandidates` candidates of the fused pass (both kinds); true once everything,
   * bounds for `horizon` included, is built.
   */
  step(maxCandidates: number): boolean;
}

const warms = new WeakMap<SimInput, Map<Day, FinanceWarm>>();

/**
 * The warm of `input`'s finance precompute for `horizon` (perf Task 1), memoised per input and
 * horizon: `financePreOf`, then the fused pass that fills the skip rates and the tables, then the
 * skip bounds for `horizon`. The pass progresses per input, so a second horizon only adds its
 * bounds. A step that builds `financePreOf` does nothing else (unless `maxCandidates` is
 * infinite). `marketSkip`, `affordableSkip` and the run's tables finish a warm not yet done.
 */
export function financeWarm(input: SimInput, horizon: Day): FinanceWarm {
  let byHorizon = warms.get(input);
  if (byHorizon === undefined) {
    byHorizon = new Map();
    warms.set(input, byHorizon);
  }
  const hit = byHorizon.get(horizon);
  if (hit) return hit;
  let fp: FinancePre | null = null;
  const warm: FinanceWarm = {
    step(maxCandidates) {
      if (fp === null) {
        const built = pres.has(input);
        fp = financePreOf(input);
        if (!built && maxCandidates !== Infinity) return false;
      }
      const s = fused.get(fp)!;
      if (s.bounds.has(horizon)) return true;
      if (!advance(fp, s, maxCandidates)) return false;
      const months = regimeMonths(input.asOf, fp.days);
      const last = lastInitiationMonth(input.asOf, horizon);
      const boundOf = (kind: ProjectKind) => {
        const b = skipBounds(s.rates![kind], s.pre.candidates, last, months);
        const certain = s.certain![kind];
        for (let c = 0; c < b.length; c++) if (certain[c] === 1) b[c] = Infinity;
        return b;
      };
      s.bounds.set(horizon, { market: boundOf('market'), affordable: boundOf('affordable') });
      return true;
    }
  };
  byHorizon.set(horizon, warm);
  return warm;
}

/**
 * The tables of the input's finance, its warm's pass finished first.
 * @internal exported for the kernel's test
 */
export function tablesOf(fp: FinancePre): Record<ProjectKind, KindTables> {
  const s = fused.get(fp)!;
  advance(fp, s, Infinity);
  return s.tabs!;
}

/**
 * One table entry as filled so far: kind κ, segment j, candidate c, level f; null when the lot is
 * not eligible for κ or the entry is not filled. `ref` is the ordinary rate for `market`.
 * @internal exported for the warm's tests
 */
export function tableEntry(
  fp: FinancePre,
  kind: ProjectKind,
  j: number,
  c: number,
  f: number
): { rate: number; ref: number; bundle: number[]; level: number } | null {
  const s = fused.get(fp);
  if (!s || s.tabs === null) return null;
  const t = s.tabs[kind];
  const slot = t.slot[c];
  if (slot < 0) return null;
  const x = slot * F + f;
  const at = t.at[j][x];
  if (at === t.none[j]) return null;
  const v = t.values[j][at];
  const ref =
    kind === 'market' ? s.pre.segments.log1mh[fp.ordSeg[j]][s.pre.candidates[c]] : t.ref[j][x];
  return { rate: t.rate[j][x], ref, bundle: v.bundle, level: v.level };
}

/** Scratch arrays of `kindLatent` (it is not re-entrant), sized for K + 1 segments. */
let scratch = {
  rates: [0] as number[],
  ref: [0] as number[],
  ord: [0] as number[],
  bundles: [EMPTY] as number[][],
  levels: [0] as number[]
};

/**
 * A reusable, mutable `KindLatent` record (perf Task 3): `kindLatentInto` writes it in place.
 * `bundle` holds the canonical array (`bundleOf`, or the shared empty one when T = 0), never a copy.
 */
export type KindOut = KindLatent;

/** A fresh `KindOut`. */
export function newKindOut(): KindOut {
  return {
    kind: 'market',
    T: 0,
    day: null,
    keyDay: NEVER_KEY_DAY,
    view: 0,
    f: -1,
    units: 0,
    stories: 0,
    protoId: 'E',
    bundle: EMPTY,
    level: 0
  };
}

/**
 * One kind's latent, as `kindLatent` returns it, written into `out`. The one kernel: `kindLatent`
 * (the object path) and the funded pass's typed walk compute the same numbers through it.
 * @internal exported for the kernel's test
 */
export function kindLatentInto(
  out: KindOut,
  run: Run,
  fp: FinancePre,
  i: number,
  size: readonly (LatentSize | null)[],
  kind: ProjectKind,
  r: Day,
  u: number,
  v: number,
  TO: number,
  c: number,
  tab: KindTables | null
): void {
  const fin = run.input.finance!;
  const K = fp.days.length;
  const bounds = K === 0 ? EMPTY : regimeMonths(r, fp.days);
  if (scratch.rates.length !== K + 1) {
    const zeros = () => Array.from({ length: K + 1 }, () => 0);
    scratch = {
      rates: zeros(),
      ref: zeros(),
      ord: zeros(),
      bundles: Array.from({ length: K + 1 }, () => EMPTY),
      levels: zeros()
    };
  }
  const { rates, ref, ord, bundles, levels } = scratch;
  const market = kind === 'market';
  const slot = tab !== null && c >= 0 ? tab.slot[c] : -1;
  for (let j = 0; j <= K; j++) {
    const view = fp.view[j];
    const z = viewOf(run, view).pre.logit[i];
    const sz = size[view];
    ord[j] = market ? run.pre.segments.log1mh[fp.ordSeg[j]][i] : 0;
    if (sz === null || z === -Infinity) {
      rates[j] = ref[j] = ord[j];
      bundles[j] = EMPTY;
      levels[j] = 0;
    } else if (slot < 0) {
      const sv = segValue(fp, fin, kind, j, z, sz, ord[j]);
      rates[j] = sv.rate;
      ref[j] = sv.ref;
      bundles[j] = sv.bundle;
      levels[j] = sv.level;
    } else {
      const t = tab!;
      const x = slot * F + sz.f;
      // an entry the warm did not fill (a level with no homes) is filled here
      if (t.at[j][x] === t.none[j])
        fillEntry(t, j, x, segValue(fp, fin, kind, j, z, sz, ord[j]), market);
      rates[j] = t.rate[j][x];
      ref[j] = market ? ord[j] : t.ref[j][x];
      const val = t.values[j][t.at[j][x]];
      bundles[j] = val.bundle;
      levels[j] = val.level;
    }
  }
  const L = log(1 - u);
  const segOf = (T: number) => {
    let seg = 0;
    while (seg < K && bounds[seg] < T) seg++;
    return seg;
  };
  let T = piecewiseMonth(L, bounds, rates);
  if (market && TO !== 0) {
    // Never later than the ordinary start; and where no rate up to month T is below the ordinary
    // one, the month is the ordinary month itself (finer segments can move the sum by an ulp).
    if (T === 0 || T > TO) T = TO;
    else if (T < TO) {
      let shifted = false;
      for (let j = 0, a = 0; j <= segOf(T); j++) {
        const end = j < K ? bounds[j] : Infinity;
        if (end > a && rates[j] < ord[j]) shifted = true;
        a = Math.max(a, end);
      }
      if (!shifted) T = TO;
    }
  }
  const seg = segOf(T);
  const view = fp.view[seg];
  const sz = size[view];
  let day: Day | null = null;
  if (T !== 0 && bundles[seg].length > 0) {
    const d =
      rates[seg] === -Infinity ? startOf(r, T) : r + 1 + Math.floor((T - 1 + v) * MONTH_DAYS);
    if (d <= run.horizon) day = d;
  }
  const Tref = market ? TO : piecewiseMonth(L, bounds, ref);
  out.kind = kind;
  out.T = T;
  out.day = day;
  out.keyDay = Tref === 0 ? NEVER_KEY_DAY : startOf(r, Tref);
  out.view = view;
  out.f = sz ? sz.f : -1;
  out.units = sz ? sz.units : 0;
  out.stories = sz ? sz.stories : 0;
  out.protoId = sz ? sz.protoId : 'E';
  out.bundle = T === 0 ? EMPTY : bundles[seg];
  out.level = T === 0 ? 0 : levels[seg];
}

/** The object path's record of `kindLatentInto` (`noShortcuts`, `latentsOf`, `respell`). */
const objOut = newKindOut();

/**
 * One kind's latent for the spell from risk start r on draws (u, v), with `TO` the ordinary month
 * of that spell (spec 4.4 with the builder's calls: the market rate is
 * `min(ordinary, shifted)`, exactly the ordinary rate where the bundle is empty). With `c` (the
 * lot's candidate index) and the pass's tables, the segment values come from the tables.
 */
function kindLatent(
  run: Run,
  fp: FinancePre,
  i: number,
  size: readonly (LatentSize | null)[],
  kind: ProjectKind,
  r: Day,
  u: number,
  v: number,
  TO: number,
  c = -1,
  tab: KindTables | null = null
): KindLatent {
  const o = objOut;
  kindLatentInto(o, run, fp, i, size, kind, r, u, v, TO, c, tab);
  return {
    kind: o.kind,
    T: o.T,
    day: o.day,
    keyDay: o.keyDay,
    view: o.view,
    f: o.f,
    units: o.units,
    stories: o.stories,
    protoId: o.protoId,
    bundle: o.T === 0 ? [] : o.bundle,
    level: o.level
  };
}

/** The size draw `uS` in every view. */
function sizesOf(run: Run, i: number, existing: number, uS: number): (LatentSize | null)[] {
  const views = 1 + run.regimes.length;
  const size: (LatentSize | null)[] = [];
  for (let v = 0; v < views; v++) size.push(sizeIn(run, v, i, existing, uS));
  return size;
}

/** The ordinary start from r on draws (uO, vO): its month, day (null after the horizon) and view. */
function ordinaryOf(
  run: Run,
  i: number,
  r: Day,
  uO: number,
  vO: number
): { T: number; O: Day | null; view: number } {
  const T = ordinaryMonthOf(run, i, r, uO);
  return { T, O: ordinaryDay(run, r, T, vO), view: ordView };
}

/**
 * Whether attempt 0 of candidate c, at risk from `asOf` and not held, is passed over on its draws:
 * `uO` above `marketSkip` and, when the lot is eligible for a reached affordable kind, `uA` above
 * `affordableSkip` (exactly when the pass's `quick` gives no latents for it).
 */
function passesOver(
  fp: FinancePre,
  c: number,
  stream: number,
  skipM: Float64Array,
  skipA: Float64Array
): boolean {
  if (!(drawOn(stream, P.INIT, 0) > skipM[c])) return false;
  if (fp.eligible.affordable[c] === 0 || !fp.reached.includes('affordable')) return true;
  return drawOn(stream, P.INIT_AFFORDABLE, 0) > skipA[c];
}

/**
 * The latents of the attempt on row i at risk from r with `existing` units, on given draws.
 * @internal the working form of `latentsOf`, exported so tests can vary one draw
 */
export function latentsWith(
  run: Run,
  fp: FinancePre,
  i: number,
  r: Day,
  existing: number,
  d: AttemptDraws
): AttemptLatents {
  const { uO, vO, uA, vA, uS } = d;
  const size = sizesOf(run, i, existing, uS);
  const o = ordinaryOf(run, i, r, uO, vO);
  const reach = (k: ProjectKind) => fp.reached.includes(k);
  return {
    uO,
    vO,
    uA,
    vA,
    uS,
    TO: o.T,
    O: o.O,
    Oview: o.view,
    size,
    market: reach('market') ? kindLatent(run, fp, i, size, 'market', r, uO, vO, o.T) : null,
    affordable: reach('affordable')
      ? kindLatent(run, fp, i, size, 'affordable', r, uA, vA, o.T)
      : null
  };
}

/** The draws of one attempt on its stream (spec 4.4). */
export function drawsOf(stream: number): AttemptDraws {
  return {
    uO: drawOn(stream, P.INIT, 0),
    vO: drawOn(stream, P.INIT_DAY, 0),
    uA: drawOn(stream, P.INIT_AFFORDABLE, 0),
    vA: drawOn(stream, P.INIT_DAY_AFFORDABLE, 0),
    uS: drawOn(stream, P.SIZE, 0)
  };
}

/**
 * The latents of attempt k on row i, at risk from r with `existing` units, on its
 * `streamOf(sh, entity, k)` stream.
 */
export function latentsOf(
  run: Run,
  fp: FinancePre,
  i: number,
  r: Day,
  existing: number,
  stream: number
): AttemptLatents {
  return latentsWith(run, fp, i, r, existing, drawsOf(stream));
}

/**
 * The test-facing form of `latentsOf`: attempt k on row i of `input` (which must carry
 * `finance`), at risk from r with `existing` units, for one seed and horizon.
 */
export function attemptLatents(
  input: SimInput,
  seed: number,
  horizon: Day,
  row: number,
  k: number,
  r: Day,
  existing: number
): AttemptLatents {
  const run = runOf(input, seed, horizon, true);
  const fp = financePreOf(input);
  const stream = streamOf(run.sh, simEntity(input.parcels.id[row]), k);
  return latentsOf(run, fp, row, r, existing, stream);
}

/**
 * The new spell of one kind after a lapse on day D (spec 4.11): months start on D (r′ = D − 1),
 * on the attempt's same draws and sizes, with a fresh `keyDay`. Null when the kind is reached by
 * no programme or the spell makes no application.
 */
export function respell(
  run: Run,
  fp: FinancePre,
  i: number,
  lat: AttemptLatents,
  kind: ProjectKind,
  D: Day,
  c = -1,
  tab: KindTables | null = null
): KindLatent | null {
  if (!fp.reached.includes(kind)) return null;
  const r = D - 1;
  const TO = ordinaryT(run, i, r, lat.uO).T;
  const out =
    kind === 'market'
      ? kindLatent(run, fp, i, lat.size, kind, r, lat.uO, lat.vO, TO, c, tab)
      : kindLatent(run, fp, i, lat.size, kind, r, lat.uA, lat.vA, TO, c, tab);
  return out.day === null ? null : out;
}

/**
 * The line key after `applied` (spec 4.4, rule (d)): `keyDay` (days after 2^28 equal), then the
 * parcel rank, then `market` before `affordable`. Exact in a double: below 2^49.
 */
export function lineKey(keyDay: Day, rank: number, kind: ProjectKind): number {
  if (rank >= RANK_LIMIT) throw new RangeError(`lineKey: rank ${rank} is not below 2^19`);
  const bit = kind === 'affordable' ? 1 : 0;
  return Math.min(keyDay, NEVER_KEY_DAY) * KEY_DAY_SCALE + rank * 2 + bit;
}

/** `bundle.join(',')`, memoised by the array (bundles are never mutated). */
const bundleKeys = new WeakMap<readonly number[], string>();
function bundleKeyOf(bundle: readonly number[]): string {
  let k = bundleKeys.get(bundle);
  if (k === undefined) {
    k = bundle.join(',');
    bundleKeys.set(bundle, k);
  }
  return k;
}

/**
 * Sorts one day's new applications by line key, in place. The keys are distinct whole numbers
 * below 2^53 whose low 20 bits are the slot `rank × 2 + kind bit` (`lineKey`), so the keys are
 * sorted as numbers and each is mapped back through its slot (`bySlot`, all empty between calls);
 * on a repeated slot it falls back to a comparison sort. The order is the same either way. The
 * slot is found by subtraction, not `%` (exact: whole numbers below 2^53, a power-of-two scale).
 */
function sortByKey(apps: App[], bySlot: (App | undefined)[]): void {
  const n = apps.length;
  if (n < 32) {
    apps.sort((x, y) => x.key - y.key);
    return;
  }
  const keys = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const a = apps[k];
    const slot = slotOf(a);
    if (bySlot[slot] !== undefined) {
      for (let m = 0; m < k; m++) bySlot[slotOf(apps[m])] = undefined;
      apps.sort((x, y) => x.key - y.key);
      return;
    }
    bySlot[slot] = a;
    keys[k] = a.key;
  }
  keys.sort();
  for (let k = 0; k < n; k++) {
    const key = keys[k];
    // the key's own day: `key / KEY_DAY_SCALE` is exact, its floor is `min(keyDay, NEVER)`
    const slot = key - Math.floor(key / KEY_DAY_SCALE) * KEY_DAY_SCALE;
    apps[k] = bySlot[slot]!;
    bySlot[slot] = undefined;
  }
}

/** An application's slot, `rank × 2 + kind bit`: its key less its key day's part (`lineKey`). */
const slotOf = (a: App): number => a.key - Math.min(a.keyDay, NEVER_KEY_DAY) * KEY_DAY_SCALE;

/** A day that is none: no ordinary start, no application, no reservation (perf Task 3). */
const NO_DAY = -2_147_483_648;

/** Calendar entry tags (`c * 4 + tag`): applications of each kind, ordinary start, reservation. */
const TAG_MARKET = 0;
const TAG_AFFORDABLE = 1;
const TAG_ORDINARY = 2;
const TAG_RESERVATION = 3;

/**
 * The loop's calendar (spec 4.8): a min-heap of days, each day once, with its bucket. A bucket is
 * a list of entries `c * 4 + tag` (the lot's candidate index and what it does that day: tag 0 a
 * market application, 1 an affordable one, 2 an ordinary start, 3 a reservation day) with the
 * `gen` of the parked attempt that made it; an entry whose `gen` is not the lot's is stale. The
 * entries live in typed arrays, chained per bucket in the order they were added.
 */
class Calendar {
  private readonly heap: Day[] = [];
  private readonly ids = new Map<Day, number>();
  private readonly head: number[] = [];
  private readonly tail: number[] = [];
  /** per entry: its code, its gen and the next entry of its bucket (−1 = none) */
  code = new Int32Array(4096);
  gen = new Int32Array(4096);
  next = new Int32Array(4096);
  private n = 0;

  get size(): number {
    return this.heap.length;
  }

  /** The bucket of `day`, made (and the day put in the heap) when it has none. */
  at(day: Day): number {
    let b = this.ids.get(day);
    if (b === undefined) {
      b = this.head.length;
      this.head.push(-1);
      this.tail.push(-1);
      this.ids.set(day, b);
      const h = this.heap;
      h.push(day);
      for (let n = h.length - 1; n > 0;) {
        const up = (n - 1) >> 1;
        if (h[up] <= h[n]) break;
        [h[up], h[n]] = [h[n], h[up]];
        n = up;
      }
    }
    return b;
  }

  /** Adds an entry at the end of bucket b (also a popped bucket, while its day is processed). */
  append(b: number, code: number, gen: number): void {
    const x = this.n++;
    if (x === this.code.length) {
      const grow = (a: Int32Array) => {
        const w = new Int32Array(a.length * 2);
        w.set(a);
        return w;
      };
      this.code = grow(this.code);
      this.gen = grow(this.gen);
      this.next = grow(this.next);
    }
    this.code[x] = code;
    this.gen[x] = gen;
    this.next[x] = -1;
    if (this.tail[b] < 0) this.head[b] = x;
    else this.next[this.tail[b]] = x;
    this.tail[b] = x;
  }

  push(day: Day, code: number, gen: number): void {
    this.append(this.at(day), code, gen);
  }

  /** The first entry of bucket b (−1 = none); `next` chains the rest. */
  first(b: number): number {
    return this.head[b];
  }

  /** the bucket of the day `pop` last returned */
  popped = -1;

  /** The earliest day, removed; its bucket goes to `popped`. */
  pop(): Day {
    const h = this.heap;
    const day = h[0];
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      for (let n = 0; ;) {
        const a = 2 * n + 1;
        const b = a + 1;
        let m = n;
        if (a < h.length && h[a] < h[m]) m = a;
        if (b < h.length && h[b] < h[m]) m = b;
        if (m === n) break;
        [h[m], h[n]] = [h[n], h[m]];
        n = m;
      }
    }
    this.popped = this.ids.get(day)!;
    this.ids.delete(day);
    return day;
  }
}

/** Candidate index by row (−1 = not a candidate), per precompute. */
const candidateOf = new WeakMap<Precompute, Int32Array>();
function candidateIndex(pre: Precompute, rows: number): Int32Array {
  let m = candidateOf.get(pre);
  if (m === undefined) {
    m = new Int32Array(rows).fill(-1);
    const { candidates } = pre;
    for (let c = 0; c < candidates.length; c++) m[candidates[c]] = c;
    candidateOf.set(pre, m);
  }
  return m;
}

/** The counts of one funded run (`fundedRunStats`). */
export interface FundedRunStats {
  /** applications made on `asOf + 1`, the first day a latent start can fall on */
  firstDayApplications: number;
  awards: number;
  /** `respell` calls: lapses on re-pricing days (spec 4.11), whether or not a new spell applies */
  respells: number;
  /** candidates passed over on attempt 0's draws by the shortcuts (0 with `noShortcuts`) */
  passedOver: number;
}

const noStats = (): FundedRunStats => ({
  firstDayApplications: 0,
  awards: 0,
  respells: 0,
  passedOver: 0
});
let stats = noStats();

/** The last funded run's counts. Module counters, overwritten by every `fundedPass`. */
export function fundedRunStats(): FundedRunStats {
  return { ...stats };
}

/**
 * The simulated pass of a run with `finance` (spec 4.1): the eager phase (each candidate's
 * attempts walked as today while its ordinary start comes before every funded application; the
 * first attempt with an application on or before its ordinary start parks the lot), then the day
 * loop (spec 4.8) over the parked lots, the line and the pools, then the reservation reports.
 * Every choice is ordered by day, step, line key or parcel rank, never by visit order (spec
 * 4.16).
 *
 * The lots are records in typed arrays indexed by candidate c (perf Task 3), not objects; the
 * calendar's entries are `c * 4 + tag`. The parked attempt's latents are kept as the fields the
 * pass reads: the ordinary day and view, the size per view, and per kind the application day,
 * `keyDay`, view, bundle and level. With the shortcuts they are computed in place
 * (`kindLatentInto`); with `noShortcuts` they are copied from `latentsOf`'s objects.
 */
export function fundedPass(run: Run, holds: Holds, sink: Sink, opts: EngineOpts): void {
  stats = noStats();
  const fin = run.input.finance!;
  const fp = financePreOf(run.input);
  const f = fp.index;
  const { parcels, pre, st, reservedFrom } = run;
  const { candidates, entity } = pre;
  const rank = fp.rank;
  const job = newJob(run);
  // the capped pools of a bundle, for the grouped line's "shares a pool" (spec 4.17 item 5)
  const poolsOf = (bundle: readonly number[]): number[] => {
    const qs: number[] = [];
    for (const g of bundle) {
      const q = f.progPool[g];
      if (f.capped[q] && !qs.includes(q)) qs.push(q);
    }
    return qs;
  };
  const line = (opts.serving ?? 'grouped') === 'grouped' ? groupedLine(poolsOf) : scanLine();
  const shortcuts = opts.noShortcuts !== true;
  const skipM = shortcuts ? fp.marketSkip(run.horizon) : new Float64Array(0);
  const skipA = shortcuts ? fp.affordableSkip(run.horizon) : new Float64Array(0);
  const tabs = shortcuts ? tablesOf(fp) : null;
  const cal = new Calendar();
  const cOf = candidateIndex(pre, parcels.count);
  const firstDay = run.asOf + 1;
  /** the day being processed; money events dated on it are settled by the serving loop */
  let today = -Infinity;
  const { ledger } = sink;
  const probe = opts.probe;
  const emit =
    ledger || probe
      ? (e: LedgerEvent) => {
          ledger?.(e);
          if (probe)
            probe(
              e,
              fin.pools.map((_, q) => tr.available(q))
            );
        }
      : null;
  const tr: Treasury = new Treasury(
    f,
    run.asOf,
    run.horizon,
    fin.terms.lossOnExit as number,
    emit,
    (day) => {
      if (day > today) cal.at(day);
    }
  );
  const avail = (q: number) => tr.available(q);
  const test: AwardTest = (g, units) => awardSet(g.bundle, g.kind, g.protoId, units, avail, f);
  const passes: AwardProbe = (g, units) =>
    awardPasses(g.bundle, g.kind, g.protoId, units, avail, f);

  // The lot table, by candidate c (spec 4.5): a lot is walked from attempt `lk[c]` at risk from
  // `lr[c]`; `ld[c]` is its reservation day while kept (0 = none or voided).
  const N = candidates.length;
  const V = 1 + run.regimes.length;
  const lk = new Int32Array(N);
  const lr = new Int32Array(N);
  const ld = new Int32Array(N);
  /** not held: at risk from `asOf`, so attempt 0 may take the one-draw skips */
  const lfresh = new Uint8Array(N);
  const ldemolished = new Uint8Array(N);
  const lparked = new Uint8Array(N);
  /** the calendar entries of the parked attempt carry `lgen`; any other entry is stale */
  const lgen = new Int32Array(N);
  // the walked (then parked) attempt: its stream, existing units, ordinary day after the
  // reservation cut (NO_DAY = none), ordinary view and size per view (`c * V + view`)
  const lstream = new Float64Array(N);
  const le = new Float64Array(N);
  const lO = new Int32Array(N);
  const lOview = new Int32Array(N);
  const lsize: (LatentSize | null)[] = new Array<LatentSize | null>(N * V).fill(null);
  // per kind (`c * 2 + kind bit`): the latent's application day (NO_DAY = none), keyDay, view,
  // bundle and level; the rest is read only where the day is not NO_DAY
  const kday = new Int32Array(2 * N);
  const kkey = new Int32Array(2 * N);
  const kview = new Int32Array(2 * N);
  const klevel = new Float64Array(2 * N);
  const kbundle: number[][] = new Array<number[]>(2 * N).fill(EMPTY);
  /** its applications in the line, in the order they were made: at most one per kind */
  const lapps: (App | null)[] = new Array<App | null>(2 * N).fill(null);
  const reachM = fp.reached.includes('market');
  const reachA = fp.reached.includes('affordable');
  const eligM = fp.eligible.market;
  const eligA = fp.eligible.affordable;
  const sizeBuf: (LatentSize | null)[] = new Array<LatentSize | null>(V).fill(null);
  const out = newKindOut();

  /** Keeps one kind's latent (null = none) as the lot's record. */
  const keep = (c: number, bit: number, x: KindLatent | null): void => {
    const at = c * 2 + bit;
    if (x === null || x.day === null) {
      kday[at] = NO_DAY;
      return;
    }
    kday[at] = x.day;
    kkey[at] = x.keyDay;
    kview[at] = x.view;
    klevel[at] = x.level;
    kbundle[at] = x.bundle;
  };

  /**
   * The latents of attempt k of lot c as the pass needs them, with the per-input shortcuts (spec
   * 4.5 cost note, 4.17 items 1 and 2), into the lot's record; false when the lot is passed over
   * on its draws. A kind the lot is not eligible for (`FinancePre.eligible`) gets no latent: every
   * bundle of it is empty, so it never applies. On attempt 0 of a lot at risk from `asOf` and not
   * held (`fresh`), a `uO` above `marketSkip` means neither the ordinary start nor the market
   * funded start falls by the horizon (`TO` 0, no ordinary day, no market latent), and a `uA`
   * above `affordableSkip` the same for the affordable latent. Every draw that takes a computation
   * takes the exact one, so the pass's schedules and ledger are those of `latentsOf` (the
   * `noShortcuts` test). The sizes are kept only when a kind latent is computed (they are read only
   * then). Returns the ordinary day before the reservation cut (NO_DAY = none).
   */
  const quick = (c: number, i: number, r: Day, e: number, stream: number, fresh: boolean) => {
    const uO = drawOn(stream, P.INIT, 0);
    const wantM = eligM[c] === 1 && reachM;
    let wantA = eligA[c] === 1 && reachA;
    const skipO = fresh && uO > skipM[c];
    let uA = 0;
    if (wantA) {
      uA = drawOn(stream, P.INIT_AFFORDABLE, 0);
      if (fresh && uA > skipA[c]) wantA = false;
    }
    if (skipO && !wantA) return null;
    const doM = wantM && !skipO;
    const vO = skipO ? 0 : drawOn(stream, P.INIT_DAY, 0);
    const vA = wantA ? drawOn(stream, P.INIT_DAY_AFFORDABLE, 0) : 0;
    const uS = doM || wantA ? drawOn(stream, P.SIZE, 0) : 0;
    let TO = 0;
    let O: Day = NO_DAY;
    lOview[c] = 0;
    if (!skipO) {
      TO = ordinaryMonthOf(run, i, r, uO);
      lOview[c] = ordView;
      O = ordinaryDay(run, r, TO, vO) ?? NO_DAY;
    }
    if (doM || wantA) {
      for (let v = 0; v < V; v++) {
        const sz = sizeIn(run, v, i, e, uS);
        sizeBuf[v] = sz;
        lsize[c * V + v] = sz;
      }
    }
    if (doM) {
      kindLatentInto(out, run, fp, i, sizeBuf, 'market', r, uO, vO, TO, c, tabs!.market);
      keep(c, 0, out);
    } else kday[c * 2] = NO_DAY;
    if (wantA) {
      kindLatentInto(out, run, fp, i, sizeBuf, 'affordable', r, uA, vA, TO, c, tabs!.affordable);
      keep(c, 1, out);
    } else kday[c * 2 + 1] = NO_DAY;
    return O;
  };

  /** `latentsOf`'s objects into the lot's record (`noShortcuts`); the ordinary day as `quick`. */
  const slow = (c: number, i: number, r: Day, e: number, stream: number): Day => {
    const lat = latentsOf(run, fp, i, r, e, stream);
    lOview[c] = lat.Oview;
    for (let v = 0; v < V; v++) lsize[c * V + v] = lat.size[v];
    keep(c, 0, lat.market);
    keep(c, 1, lat.affordable);
    return lat.O ?? NO_DAY;
  };

  const addApp = (c: number, app: App): void => {
    if (lapps[c * 2] === null) lapps[c * 2] = app;
    else if (lapps[c * 2 + 1] === null) lapps[c * 2 + 1] = app;
    else throw new Error('fundedPass: a lot with three applications');
  };

  const dropApp = (c: number, app: App): void => {
    if (lapps[c * 2] === app) {
      lapps[c * 2] = lapps[c * 2 + 1];
      lapps[c * 2 + 1] = null;
    } else if (lapps[c * 2 + 1] === app) lapps[c * 2 + 1] = null;
  };

  const leaveLine = (c: number) => {
    const a = lapps[c * 2];
    const b = lapps[c * 2 + 1];
    if (a !== null) line.remove(a);
    if (b !== null) line.remove(b);
    lapps[c * 2] = null;
    lapps[c * 2 + 1] = null;
    lparked[c] = 0;
  };

  /** After a project started on the lot: true when it exited and attempt k + 1 is to be walked. */
  const after = (c: number, s: Schedule): boolean => {
    if (ld[c] > 0 && (s.end.kind !== 'exit' || s.end.day >= ld[c])) ld[c] = 0;
    if (s.entered.construction !== undefined) ldemolished[c] = 1;
    if (s.end.kind !== 'exit') return false;
    lr[c] = s.end.day;
    lk[c]++;
    return true;
  };

  /**
   * Walks the lot's attempts from `lk[c]` (spec 4.5): an attempt whose ordinary start comes
   * before every application runs as today; the first other one parks the lot in the calendar.
   * The lot is never parked while it is walked, so its record holds no live attempt.
   */
  const walk = (c: number): void => {
    const i = candidates[c];
    for (;;) {
      const k = lk[c];
      const stream = streamOf(run.sh, entity[c], k);
      const e = ldemolished[c] === 1 ? 0 : parcels.existingUnits[i];
      let O: Day;
      if (shortcuts) {
        const q = quick(c, i, lr[c], e, stream, lfresh[c] === 1 && k === 0);
        if (q === null) {
          stats.passedOver++;
          return;
        }
        O = q;
      } else O = slow(c, i, lr[c], e, stream);
      const d = ld[c];
      if (O !== NO_DAY && d > 0 && O >= d) O = NO_DAY;
      let A: Day = NO_DAY;
      let applies = 0;
      for (let bit = 0; bit < 2; bit++) {
        const day = kday[c * 2 + bit];
        if (day === NO_DAY || (d > 0 && day >= d)) continue;
        applies |= 1 << bit;
        if (A === NO_DAY || day < A) A = day;
      }
      if (A === NO_DAY || (O !== NO_DAY && A > O)) {
        if (O === NO_DAY) return;
        const s = simulatedProject(run, job, i, stream, k, O, e, lOview[c]);
        if (s === null) return;
        sink.schedule(s);
        if (!after(c, s)) return;
        continue;
      }
      lstream[c] = stream;
      le[c] = e;
      lO[c] = O;
      lparked[c] = 1;
      const gen = ++lgen[c];
      for (let bit = 0; bit < 2; bit++) {
        if ((applies & (1 << bit)) !== 0) cal.push(kday[c * 2 + bit], c * 4 + bit, gen);
      }
      if (O !== NO_DAY) cal.push(O, c * 4 + TAG_ORDINARY, gen);
      if (d > 0 && d <= run.horizon) cal.push(d, c * 4 + TAG_RESERVATION, gen);
      return;
    }
  };

  /** The funding fields of an award (spec 4.12). */
  const fundingOf = (c: number, app: App, a: Award, certain: boolean): Schedule['funding'] => {
    const programmes: string[] = [];
    let granted = 0;
    let lent = 0;
    let guaranteed = 0;
    a.set.forEach((g, n) => {
      const it = a.priced.items[n];
      if (it.granted > 0 || it.lent > 0 || it.guaranteed > 0) programmes.push(fin.programmes[g].id);
      granted += projectDollars(it.granted, app.units);
      lent += projectDollars(it.lent, app.units);
      guaranteed += projectDollars(it.guaranteed, app.units);
    });
    let displaced = 0;
    if (lO[c] !== NO_DAY) {
      const sz = lsize[c * V + lOview[c]];
      if (sz !== null) displaced = sz.units - le[c];
    }
    return { programmes, applied: app.applied, granted, lent, guaranteed, displaced, certain };
  };

  /**
   * Re-makes a waiting application under the rules of re-pricing day D, whose finance segment is
   * `seg` (spec 4.11): the view in force on D, the attempt's size draw in it, and B′ the
   * programmes of its kind offered on D whose `minHomes` it meets. False when it lapses (no size or
   * a 0 hazard in the view, B′ empty, or `level(B′)` below its level just before D); otherwise it
   * keeps `applied` and `key`, takes B′, its view, size and prototype, and is regrouped.
   */
  const remake = (app: App, seg: number): boolean => {
    const c = cOf[app.lot];
    const view = fp.view[seg];
    const sz = lsize[c * V + view];
    if (sz === null || viewOf(run, view).pre.logit[app.lot] === -Infinity) return false;
    const bundle = bundleOf(fp, fin, app.kind, seg, sz.units);
    if (bundle.length === 0) return false;
    const level = coverageLevel(f.price(app.kind, bundle, sz.protoId).coverage);
    if (below(level, app.level)) return false;
    app.bundle = bundle;
    app.bundleKey = bundleKeyOf(bundle);
    app.protoId = sz.protoId;
    app.units = sz.units;
    app.level = level;
    app.view = view;
    app.f = sz.f;
    app.stories = sz.stories;
    line.regroup(app);
    return true;
  };

  /**
   * A lapse on re-pricing day D (spec 4.11): the application leaves the line, and the kind's
   * latent start is computed again as a new spell from D (`respell`, on the attempt's draws and
   * sizes). A new application (not on or after a kept reservation day) joins the calendar: on D
   * itself through today's bucket.
   */
  const lapse = (app: App, D: Day, todays: number): void => {
    const c = cOf[app.lot];
    line.remove(app);
    dropApp(c, app);
    stats.respells++;
    const lat: AttemptLatents = {
      ...drawsOf(lstream[c]),
      TO: 0,
      O: null,
      Oview: lOview[c],
      size: lsize.slice(c * V, c * V + V),
      market: null,
      affordable: null
    };
    const nl = respell(run, fp, app.lot, lat, app.kind, D, c, tabs?.[app.kind] ?? null);
    if (nl === null || (ld[c] > 0 && nl.day! >= ld[c])) return;
    const bit = app.kind === 'affordable' ? 1 : 0;
    keep(c, bit, nl);
    if (nl.day === D) cal.append(todays, c * 4 + bit, lgen[c]);
    else cal.push(nl.day!, c * 4 + bit, lgen[c]);
  };

  /** An award on `today` (spec 4.9): the lot leaves every line and its funded project starts. */
  const take = (app: App, a: Award): void => {
    const c = cOf[app.lot];
    const i = app.lot;
    leaveLine(c);
    const certain = coverageLevel(a.priced.coverage) === 1;
    const view = app.view;
    const vp = view > 0 ? run.regimes[view - 1].parcels : parcels;
    let pathway: Pathway | null = null;
    if (vp.localProgram[i] === 1) pathway = 'streamlined';
    else if (certain && app.kind === 'affordable') {
      pathway = pathwayFrom(run.newCal.affordableRoutes!, lstream[c]);
    }
    const s = startSimulated(
      run,
      job,
      i,
      lstream[c],
      lk[c],
      today,
      le[c],
      view,
      app.f,
      pathway,
      certain
    );
    if (app.kind === 'affordable') s.kind = 'affordable';
    s.funding = fundingOf(c, app, a, certain);
    tr.award(today, a, app.units, s);
    stats.awards++;
    sink.schedule(s);
    if (after(c, s)) walk(c);
  };

  // 1. The eager phase (spec 4.5): holds and reservations exactly as `simulatedPass`.
  const reserved: number[] = [];
  for (let c = 0; c < N; c++) {
    const i = candidates[c];
    let r = run.asOf;
    let demolished = false;
    let d = reservedFrom === null ? 0 : reservedFrom[i];
    const isReserved = d > 0;
    if (st.held[i] === 1) {
      const hold = holds.get(i);
      if (d > 0 && holdVoids(hold, d)) d = 0;
      if (hold?.blocked) {
        if (isReserved) sink.reservation?.(i, false);
        continue;
      }
      r = Math.max(run.asOf, hold?.lastExit ?? run.asOf);
      demolished = hold !== undefined && hold.demolished !== null;
    } else if (
      shortcuts &&
      !isReserved &&
      passesOver(fp, c, streamOf(run.sh, entity[c], 0), skipM, skipA)
    ) {
      // passed over on its draws, as `walk` would (spec 4.5 cost note), without a lot record
      stats.passedOver++;
      continue;
    }
    lfresh[c] = st.held[i] !== 1 ? 1 : 0;
    lr[c] = r;
    ldemolished[c] = demolished ? 1 : 0;
    ld[c] = d;
    walk(c);
    if (isReserved) reserved.push(c);
  }

  // 2. The day loop (spec 4.8). Every re-pricing day up to the horizon is a day of the loop.
  const repricing = new Map<Day, number>();
  for (const d of fp.repricing) {
    if (d > run.horizon) break;
    // its finance segment: the one that starts on d
    repricing.set(d, fp.days.indexOf(d) + 1);
    cal.at(d);
  }
  const bySlot: (App | undefined)[] = shortcuts ? new Array(2 * parcels.count) : [];
  /** money moved outside a serving pass since the last one: no group keeps its threshold */
  let moneyChanged = true;
  const byRank = (x: number, y: number) => rank[candidates[x]] - rank[candidates[y]];
  /** The lots of bucket b's live entries with tag `tag`, in rank order. */
  const liveByRank = (b: number, tag: number): number[] => {
    const cs: number[] = [];
    for (let x = cal.first(b); x >= 0; x = cal.next[x]) {
      const code = cal.code[x];
      const c = code >> 2;
      if ((code & 3) === tag && lparked[c] === 1 && lgen[c] === cal.gen[x]) cs.push(c);
    }
    return cs.length > 1 ? cs.sort(byRank) : cs;
  };
  while (cal.size > 0) {
    const D = cal.pop();
    const b = cal.popped;
    if (D > run.horizon) break;
    today = D;
    let did = tr.receive(D);
    if (tr.settle(D).any) did = true;
    if (did) moneyChanged = true;
    // a kept reservation's day: the lot's waiting applications lapse for good (spec 4.11)
    for (const c of liveByRank(b, TAG_RESERVATION)) {
      leaveLine(c);
      did = true;
    }
    // re-pricing and lapse (spec 4.11), in key order, once per application however many kinds of
    // change fall on D; serving follows
    const seg = repricing.get(D);
    if (seg !== undefined && line.size > 0) {
      for (const app of line.apps()) if (!remake(app, seg)) lapse(app, D, b);
      did = true;
    }
    const fresh: App[] = [];
    for (let x = cal.first(b); x >= 0; x = cal.next[x]) {
      const code = cal.code[x];
      const bit = code & 3;
      if (bit > TAG_AFFORDABLE) continue;
      const c = code >> 2;
      if (lparked[c] !== 1 || lgen[c] !== cal.gen[x]) continue;
      const i = candidates[c];
      const at = c * 2 + bit;
      const kind: ProjectKind = bit === TAG_MARKET ? 'market' : 'affordable';
      const view = kview[at];
      const sz = lsize[c * V + view]!;
      const bundle = kbundle[at];
      const keyDay = kkey[at];
      const app: App = {
        lot: i,
        kind,
        applied: D,
        key: lineKey(keyDay, rank[i], kind),
        bundle,
        bundleKey: bundleKeyOf(bundle),
        protoId: sz.protoId,
        units: sz.units,
        level: klevel[at],
        view,
        f: sz.f,
        stories: sz.stories,
        keyDay,
        seq: 0,
        lgr: null,
        lgi: -1,
        lk: -1
      };
      addApp(c, app);
      fresh.push(app);
    }
    if (shortcuts) sortByKey(fresh, bySlot);
    else fresh.sort((x, y) => x.key - y.key);
    for (const app of fresh) {
      line.add(app);
      if (D === firstDay) stats.firstDayApplications++;
      did = true;
    }
    if (did) {
      let r: { any: boolean; returned: boolean };
      do {
        line.serve(test, take, shortcuts && !moneyChanged, passes);
        moneyChanged = false;
        r = tr.settle(D);
        if (r.any) moneyChanged = true;
      } while (r.returned);
    }
    // ordinary starts of parked lots that have not started (spec 4.8 step 6)
    for (const c of liveByRank(b, TAG_ORDINARY)) {
      leaveLine(c);
      const s = simulatedProject(run, job, candidates[c], lstream[c], lk[c], D, le[c], lOview[c]);
      if (s === null) continue;
      sink.schedule(s);
      if (after(c, s)) walk(c);
    }
    opts.lineProbe?.(D, line.apps());
  }
  opts.lineProbe?.(run.horizon, line.apps());

  // 3. Close: each reserved candidate once, and the reserved rows that are not candidates.
  for (const c of reserved) sink.reservation?.(candidates[c], ld[c] > 0);
  if (reservedFrom !== null) reservationsOff(run, holds, sink, candidates);
}
