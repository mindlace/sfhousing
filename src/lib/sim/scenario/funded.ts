// The funded latent starts of one attempt (finance-engine spec 4.4): per lot and attempt, the
// ordinary start (today's arithmetic, unchanged), and one funded latent start per project kind
// some programme reaches, on the finer finance segments (spec 4.3). Pure and worker-safe; `exp`
// and `log` only from math.ts.
//
// `engine.ts` imports this module and this module imports `engine.ts` (builder's call): nothing
// here reads an `engine.ts` binding at module evaluation time, only inside functions.
import { FILL_LEVELS, fillStories } from '$lib/data/scenario-codec';
import { exp, log } from '$lib/timelapse/math';
import { MONTH_DAYS, type Day } from '$lib/timelapse/time';
import type { ProjectKind } from '$lib/timelapse/types';
import {
  PROTOTYPES,
  costPerHome,
  oddsShift,
  prototypeFor,
  uncoveredPerHome,
  type Prototype,
  type PrototypeId
} from '../finance';
import { ordinaryMonth, runOf, type Run } from './engine';
import { coverageLevel, financeIndexOf, isOffered, type FinanceIndex } from './funding';
import { parcelRankOf, piecewiseMonth, precomputeOf, regimeMonths, sizeCumAgainst } from './input';
import { P, drawOn, simEntity, streamOf } from './rng';
import type { SimInput } from './types';

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
  const add = (d: Day) => {
    if (d > asOf) all.add(d);
  };
  for (const d of segs.days) add(d);
  for (const g of f.programmes) {
    add(g.from);
    if (g.to !== null) add(g.to + 1);
  }
  for (const o of f.off) {
    add(o.from);
    if (o.to !== null) add(o.to + 1);
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
  const fp: FinancePre = {
    days,
    view,
    ordSeg,
    m,
    offered,
    reached: KINDS.filter((k) => f.programmes.some((g) => g.reach === k)),
    rank: parcelRankOf(input.parcels.id),
    index
  };
  pres.set(input, fp);
  return fp;
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
  const units = p.yield[i * F + f];
  const stories = fillStories(FILL_LEVELS[f], p.envelopeStories[i]);
  return { f, units, stories, protoId: prototypeFor(stories, units).id };
}

/** Today's ordinary month on the `Precompute.segments` grid from risk start r (0 = never). */
function ordinaryT(run: Run, i: number, r: Day, uO: number): { T: number; view: number } {
  const { segments, log1mh } = run.pre;
  const K = segments.days.length;
  if (K === 0) {
    // the engine reaches this only on candidates, whose log1mh is below 0
    if (!(log1mh[i] < 0)) return { T: 0, view: 0 };
    return { T: ordinaryMonth(uO, log1mh[i], null, []), view: 0 };
  }
  const bounds = regimeMonths(r, segments.days);
  const rates = segments.log1mh.map((a) => a[i]);
  const T = ordinaryMonth(uO, log1mh[i], bounds, rates);
  let seg = 0;
  while (seg < K && bounds[seg] < T) seg++;
  return { T, view: segments.view[seg] };
}

/**
 * One kind's latent for the spell from risk start r on draws (u, v), with `TO` the ordinary month
 * of that spell (spec 4.4 with the builder's calls: the market rate is
 * `min(ordinary, shifted)`, exactly the ordinary rate where the bundle is empty).
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
  TO: number
): KindLatent {
  const fin = run.input.finance!;
  const { slope } = fin;
  const K = fp.days.length;
  const bounds = regimeMonths(r, fp.days);
  const rates = new Array<number>(K + 1);
  const ref = new Array<number>(K + 1);
  const ord = new Array<number>(K + 1);
  const bundles: number[][] = [];
  const levels: number[] = [];
  const market = kind === 'market';
  for (let j = 0; j <= K; j++) {
    const view = fp.view[j];
    const z = viewOf(run, view).pre.logit[i];
    const sz = size[view];
    ord[j] = market ? run.pre.segments.log1mh[fp.ordSeg[j]][i] : 0;
    let bundle: number[] = [];
    let level = 0;
    if (sz === null || z === -Infinity) {
      rates[j] = ref[j] = ord[j];
    } else {
      const p = PROTOTYPE.get(sz.protoId)!;
      const x0 = market
        ? z + fp.m[j]
        : z +
          fp.m[j] -
          (slope * (uncoveredPerHome('affordable', p) - uncoveredPerHome('market', p))) /
            costPerHome('affordable', p);
      ref[j] = market ? ord[j] : log(1 - logistic(x0));
      bundle = fp.offered[kind][j].filter((g) => fin.programmes[g].minHomes <= sz.units);
      if (bundle.length === 0) {
        rates[j] = ref[j];
      } else {
        const priced = fp.index.price(kind, bundle, sz.protoId);
        level = coverageLevel(priced.coverage);
        if (priced.certain) {
          rates[j] = -Infinity;
        } else {
          const x = log(1 - logistic(x0 + oddsShift(priced.grantEquivalent, kind, p, slope)));
          rates[j] = market ? Math.min(ord[j], x) : x;
        }
      }
    }
    bundles.push(bundle);
    levels.push(level);
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
  return {
    kind,
    T,
    day,
    keyDay: Tref === 0 ? NEVER_KEY_DAY : startOf(r, Tref),
    view,
    f: sz ? sz.f : -1,
    units: sz ? sz.units : 0,
    stories: sz ? sz.stories : 0,
    protoId: sz ? sz.protoId : 'E',
    bundle: T === 0 ? [] : bundles[seg],
    level: T === 0 ? 0 : levels[seg]
  };
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
  const views = 1 + run.regimes.length;
  const size: (LatentSize | null)[] = [];
  for (let v = 0; v < views; v++) size.push(sizeIn(run, v, i, existing, uS));
  const o = ordinaryT(run, i, r, uO);
  let O: Day | null = null;
  if (o.T !== 0) {
    const day = r + 1 + Math.floor((o.T - 1 + vO) * MONTH_DAYS);
    if (day <= run.horizon) O = day;
  }
  const reach = (k: ProjectKind) => fp.reached.includes(k);
  return {
    uO,
    vO,
    uA,
    vA,
    uS,
    TO: o.T,
    O,
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
  D: Day
): KindLatent | null {
  if (!fp.reached.includes(kind)) return null;
  const r = D - 1;
  const TO = ordinaryT(run, i, r, lat.uO).T;
  const out =
    kind === 'market'
      ? kindLatent(run, fp, i, lat.size, kind, r, lat.uO, lat.vO, TO)
      : kindLatent(run, fp, i, lat.size, kind, r, lat.uA, lat.vA, TO);
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
