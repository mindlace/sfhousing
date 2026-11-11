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
  awardSet,
  coverageLevel,
  financeIndexOf,
  isOffered,
  type Award,
  type FinanceIndex
} from './funding';
import { scanLine, type App, type AwardTest } from './line';
import { Treasury, type LedgerEvent } from './money';
import { parcelRankOf, piecewiseMonth, precomputeOf, regimeMonths, sizeCumAgainst } from './input';
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

/** One parked or walking lot of the funded pass (spec 4.5). */
interface Lot {
  /** its index in `Precompute.candidates` */
  c: number;
  /** its T11 row */
  i: number;
  /** the attempt */
  k: number;
  /** the attempt's risk start */
  r: Day;
  demolished: boolean;
  /** the reservation day while it is kept; 0 = none or voided */
  d: Day;
  /** the parked attempt: its stream, existing units, latents and ordinary day (reservation cut) */
  stream: number;
  e: number;
  lat: AttemptLatents | null;
  O: Day | null;
  /** the calendar entries of the parked attempt carry `gen`; any other entry is stale */
  gen: number;
  parked: boolean;
  /** its applications in the line */
  apps: App[];
}

interface Entry {
  lot: Lot;
  gen: number;
}

/** What the day loop does on one day (spec 4.8): reservations, applications, ordinary starts. */
interface Bucket {
  res: Entry[];
  apps: (Entry & { kind: ProjectKind })[];
  ords: Entry[];
}

/** The loop's calendar: a min-heap of days, each day once, with its bucket. */
class Calendar {
  private readonly heap: Day[] = [];
  private readonly buckets = new Map<Day, Bucket>();

  get size(): number {
    return this.heap.length;
  }

  at(day: Day): Bucket {
    let b = this.buckets.get(day);
    if (!b) {
      b = { res: [], apps: [], ords: [] };
      this.buckets.set(day, b);
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

  /** The earliest day and its bucket, removed. */
  pop(): [Day, Bucket] {
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
    const bucket = this.buckets.get(day)!;
    this.buckets.delete(day);
    return [day, bucket];
  }
}

let stats = { firstDayApplications: 0, awards: 0 };

/**
 * The last funded run's counts: applications made on `asOf + 1` (the first day a latent start
 * can fall on) and awards. Module counters, overwritten by every `fundedPass`.
 */
export function fundedRunStats(): { firstDayApplications: number; awards: number } {
  return { ...stats };
}

/**
 * The simulated pass of a run with `finance` (spec 4.1): the eager phase (each candidate's
 * attempts walked as today while its ordinary start comes before every funded application; the
 * first attempt with an application on or before its ordinary start parks the lot), then the day
 * loop (spec 4.8) over the parked lots, the line and the pools, then the reservation reports.
 * Every choice is ordered by day, step, line key or parcel rank, never by visit order (spec
 * 4.16). Re-pricing (spec 4.11) is not done here.
 */
export function fundedPass(run: Run, holds: Holds, sink: Sink, opts: EngineOpts): void {
  stats = { firstDayApplications: 0, awards: 0 };
  if (opts.serving === 'grouped') throw new Error('fundedPass: grouped serving is not built yet');
  const fin = run.input.finance!;
  const fp = financePreOf(run.input);
  const f = fp.index;
  const { parcels, pre, st, reservedFrom } = run;
  const { candidates, entity } = pre;
  const rank = fp.rank;
  const job = newJob(run);
  const line = scanLine();
  const cal = new Calendar();
  const lotOf: (Lot | undefined)[] = new Array(parcels.count);
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

  const leaveLine = (lot: Lot) => {
    for (const a of lot.apps) line.remove(a);
    lot.apps = [];
    lot.parked = false;
  };

  /** After a project started on the lot: true when it exited and attempt k + 1 is to be walked. */
  const after = (lot: Lot, s: Schedule): boolean => {
    if (lot.d > 0 && (s.end.kind !== 'exit' || s.end.day >= lot.d)) lot.d = 0;
    if (s.entered.construction !== undefined) lot.demolished = true;
    if (s.end.kind !== 'exit') return false;
    lot.r = s.end.day;
    lot.k++;
    return true;
  };

  /**
   * Walks the lot's attempts from `lot.k` (spec 4.5): an attempt whose ordinary start comes
   * before every application runs as today; the first other one parks the lot in the calendar.
   */
  const walk = (lot: Lot): void => {
    for (;;) {
      const stream = streamOf(run.sh, entity[lot.c], lot.k);
      const e = lot.demolished ? 0 : parcels.existingUnits[lot.i];
      const lat = latentsOf(run, fp, lot.i, lot.r, e, stream);
      const d = lot.d;
      let O = lat.O;
      if (O !== null && d > 0 && O >= d) O = null;
      let A: Day | null = null;
      const kinds: ProjectKind[] = [];
      for (const kind of KINDS) {
        const day = lat[kind]?.day ?? null;
        if (day === null || (d > 0 && day >= d)) continue;
        kinds.push(kind);
        if (A === null || day < A) A = day;
      }
      if (A === null || (O !== null && A > O)) {
        if (O === null) return;
        const s = simulatedProject(run, job, lot.i, stream, lot.k, O, e, lat.Oview);
        if (s === null) return;
        sink.schedule(s);
        if (!after(lot, s)) return;
        continue;
      }
      lot.stream = stream;
      lot.e = e;
      lot.lat = lat;
      lot.O = O;
      lot.parked = true;
      const gen = ++lot.gen;
      for (const kind of kinds) cal.at(lat[kind]!.day!).apps.push({ lot, gen, kind });
      if (O !== null) cal.at(O).ords.push({ lot, gen });
      if (d > 0 && d <= run.horizon) cal.at(d).res.push({ lot, gen });
      return;
    }
  };

  /** The funding fields of an award (spec 4.12). */
  const fundingOf = (lot: Lot, app: App, a: Award, certain: boolean): Schedule['funding'] => {
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
    if (lot.O !== null) {
      const sz = lot.lat!.size[lot.lat!.Oview];
      if (sz !== null) displaced = sz.units - lot.e;
    }
    return { programmes, applied: app.applied, granted, lent, guaranteed, displaced, certain };
  };

  /** An award on `today` (spec 4.9): the lot leaves every line and its funded project starts. */
  const take = (app: App, a: Award): void => {
    const lot = lotOf[app.lot]!;
    leaveLine(lot);
    const certain = coverageLevel(a.priced.coverage) === 1;
    const view = app.view;
    const vp = view > 0 ? run.regimes[view - 1].parcels : parcels;
    let pathway: Pathway | null = null;
    if (vp.localProgram[lot.i] === 1) pathway = 'streamlined';
    else if (certain && app.kind === 'affordable') {
      pathway = pathwayFrom(run.newCal.affordableRoutes!, lot.stream);
    }
    const s = startSimulated(
      run,
      job,
      lot.i,
      lot.stream,
      lot.k,
      today,
      lot.e,
      view,
      app.f,
      pathway,
      certain
    );
    if (app.kind === 'affordable') s.kind = 'affordable';
    s.funding = fundingOf(lot, app, a, certain);
    tr.award(today, a, app.units, s);
    stats.awards++;
    sink.schedule(s);
    if (after(lot, s)) walk(lot);
  };

  // 1. The eager phase (spec 4.5): holds and reservations exactly as `simulatedPass`.
  const reserved: Lot[] = [];
  for (let c = 0; c < candidates.length; c++) {
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
    }
    const lot: Lot = {
      c,
      i,
      k: 0,
      r,
      demolished,
      d,
      stream: 0,
      e: 0,
      lat: null,
      O: null,
      gen: 0,
      parked: false,
      apps: []
    };
    lotOf[i] = lot;
    walk(lot);
    if (isReserved) reserved.push(lot);
  }

  // 2. The day loop (spec 4.8).
  const live = (x: Entry) => x.lot.parked && x.lot.gen === x.gen;
  const byRank = (x: Entry, y: Entry) => rank[x.lot.i] - rank[y.lot.i];
  while (cal.size > 0) {
    const [D, b] = cal.pop();
    if (D > run.horizon) break;
    today = D;
    let did = tr.receive(D);
    if (tr.settle(D).any) did = true;
    // a kept reservation's day: the lot's waiting applications lapse for good (spec 4.11)
    for (const x of b.res.filter(live).sort(byRank)) {
      leaveLine(x.lot);
      did = true;
    }
    const fresh: App[] = [];
    for (const x of b.apps) {
      if (!live(x)) continue;
      const lt = x.lot.lat![x.kind]!;
      const app: App = {
        lot: x.lot.i,
        kind: x.kind,
        applied: D,
        key: lineKey(lt.keyDay, rank[x.lot.i], x.kind),
        bundle: lt.bundle,
        bundleKey: lt.bundle.join(','),
        protoId: lt.protoId,
        units: lt.units,
        level: lt.level,
        view: lt.view,
        f: lt.f,
        stories: lt.stories,
        keyDay: lt.keyDay,
        seq: 0
      };
      x.lot.apps.push(app);
      fresh.push(app);
    }
    fresh.sort((x, y) => x.key - y.key);
    for (const app of fresh) {
      line.add(app);
      if (D === firstDay) stats.firstDayApplications++;
      did = true;
    }
    if (did) {
      let r: { returned: boolean };
      do {
        line.serve(test, take);
        r = tr.settle(D);
      } while (r.returned);
    }
    // ordinary starts of parked lots that have not started (spec 4.8 step 6)
    for (const x of b.ords.filter(live).sort(byRank)) {
      const lot = x.lot;
      leaveLine(lot);
      const s = simulatedProject(run, job, lot.i, lot.stream, lot.k, D, lot.e, lot.lat!.Oview);
      if (s === null) continue;
      sink.schedule(s);
      if (after(lot, s)) walk(lot);
    }
  }

  // 3. Close: each reserved candidate once, and the reserved rows that are not candidates.
  for (const lot of reserved) sink.reservation?.(lot.i, lot.d > 0);
  if (reservedFrom !== null) reservationsOff(run, holds, sink, candidates);
}
