/**
 * Public money in the engine: inflow arrivals (F5), the pipeline statement (spec 4.13) and the
 * finance input check (spec 4.2). Pure.
 */
import type { Day } from '$lib/timelapse/time';
import type { Inflow, PoolKind, ProjectKind, Provenance } from '$lib/timelapse/types';
import {
  CERTAIN_TOLERANCE,
  fundBundle,
  isCertain,
  oddsShift,
  projectDollars,
  uncoveredPerHome,
  type BundleFunding,
  type Prototype
} from '../../finance';
import { dayOf } from '../dates';
import type { SimInput } from '../input/types';

/** `keyDay` of a latent that never starts, and the bound every later day compares equal to. */
export const NEVER_KEY_DAY = 268_435_456; // 2^28
const RANK_LIMIT = 524_288; // 2^19
const KEY_DAY_SCALE = 1_048_576; // 2^20

const MS_PER_DAY = 86400000;

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * The days `inflow` arrives, ascending, within `asOf <= day <= horizon`. A yearly inflow arrives
 * on `from` and on the same UTC month and day of each later year (29 February becomes 28 February
 * in a common year), up to `to` inclusive.
 */
export function inflowArrivals(inflow: Inflow, asOf: Day, horizon: Day): Day[] {
  if (inflow.kind === 'once') {
    return inflow.day >= asOf && inflow.day <= horizon ? [inflow.day] : [];
  }
  const last = inflow.to === null ? horizon : Math.min(inflow.to, horizon);
  const start = new Date(inflow.from * MS_PER_DAY);
  const y0 = start.getUTCFullYear();
  const m = start.getUTCMonth() + 1;
  const d = start.getUTCDate();
  const out: Day[] = [];
  for (let y = y0; ; y++) {
    const day = m === 2 && d === 29 && !isLeap(y) ? dayOf(y, 2, 28) : dayOf(y, m, d);
    if (day > last) break;
    if (day >= asOf) out.push(day);
  }
  return out;
}

export const PIPELINE_FUNDED: Provenance = {
  tier: 4,
  label: 'Projects already in the pipeline are taken as funded',
  sources: [],
  method:
    'The simulation’s funding pools pay only for projects that start after the data date. ' +
    'Projects already in the pipeline are assumed to have their funding already, outside the ' +
    'pools, so the pools start with nothing committed: money the City has already committed to ' +
    'them is not subtracted. This overstates what the pools can fund in the first years.'
};

type Finance = NonNullable<SimInput['finance']>;

/** The coverage level: coverage counted up to 1, with `isCertain`'s tolerance (spec, Terms). */
export function coverageLevel(c: number): number {
  return isCertain(c) ? 1 : c;
}

/**
 * The odds shift of a priced bundle, its grant-equivalent capped at the uncovered cost: coverage
 * above 1 shifts as coverage 1, so a fully funded project starts at the ordinary odds at full
 * coverage and more loan beyond it raises them no further (funding award rule, R2's rider).
 * `oddsShift` itself does not cap.
 */
export function cappedShift(
  priced: BundleFunding,
  kind: ProjectKind,
  p: Prototype,
  slope: number
): number {
  return oddsShift(Math.min(priced.grantEquivalent, uncoveredPerHome(kind, p)), kind, p, slope);
}

/** x is below y when `x < y - CERTAIN_TOLERANCE`. */
export function below(x: number, y: number): boolean {
  return x < y - CERTAIN_TOLERANCE;
}

export interface FinanceIndex {
  finance: Finance;
  /** pool id to pool index */
  poolOf: Map<string, number>;
  /** programme index to pool index */
  progPool: Int32Array;
  progPoolKind: PoolKind[];
  /** by pool: the `finance.off` spans, sorted by `from`; a null `to` is Infinity */
  offSpans: [Day, Day][][];
  /**
   * `fundBundle` of the programmes `set` (ascending indices) for a project of `kind` priced as
   * `proto`, memoised by kind, prototype (market only) and set. A prototype is one priced object
   * per (PriceKey, price step) (`optionPrototype`), so the memo keys on both. The result is
   * shared: never mutate it.
   */
  price(kind: ProjectKind, set: readonly number[], proto: Prototype): BundleFunding;
}

const indexes = new WeakMap<Finance, FinanceIndex>();

/** Each priced prototype's memo key: its id and a number unique to the object. */
const protoKeys = new WeakMap<Prototype, string>();
let protoCount = 0;
function protoKeyOf(p: Prototype): string {
  let key = protoKeys.get(p);
  if (key === undefined) protoKeys.set(p, (key = `${p.id}#${protoCount++}`));
  return key;
}

export function financeIndexOf(finance: Finance): FinanceIndex {
  const hit = indexes.get(finance);
  if (hit) return hit;
  const poolOf = new Map<string, number>();
  finance.pools.forEach((p, i) => poolOf.set(p.id, i));
  const progPool = new Int32Array(finance.programmes.length);
  const progPoolKind: PoolKind[] = [];
  finance.programmes.forEach((g, i) => {
    const q = poolOf.get(g.pool)!;
    progPool[i] = q;
    progPoolKind.push(finance.pools[q].kind);
  });
  const offSpans: [Day, Day][][] = finance.pools.map(() => []);
  for (const o of finance.off) {
    offSpans[poolOf.get(o.pool)!].push([o.from, o.to === null ? Infinity : o.to]);
  }
  for (const spans of offSpans) spans.sort((a, b) => a[0] - b[0]);

  const memo = new Map<string, BundleFunding>();
  const byArray = new WeakMap<readonly number[], Map<string, BundleFunding>>();
  const index: FinanceIndex = {
    finance,
    poolOf,
    progPool,
    progPoolKind,
    offSpans,
    price(kind, set, proto) {
      // first by the array itself (the engine passes the same bundle arrays again and again),
      // then by its contents
      const sub = kind === 'market' ? protoKeyOf(proto) : '~affordable';
      let byArr = byArray.get(set);
      if (byArr === undefined) {
        byArr = new Map();
        byArray.set(set, byArr);
      }
      const hit = byArr.get(sub);
      if (hit !== undefined) return hit;
      const key = `${kind}|${kind === 'market' ? sub : ''}|${set.join(',')}`;
      let r = memo.get(key);
      if (!r) {
        r = fundBundle(
          set.map((g) => ({
            instrument: finance.programmes[g].instrument,
            poolKind: progPoolKind[g]
          })),
          kind,
          proto,
          finance.terms
        );
        memo.set(key, r);
      }
      byArr.set(sub, r);
      return r;
    }
  };
  indexes.set(finance, index);
  return index;
}

/** Whether `pool` is switched off on day `d`: the union of its `off` spans, `to` inclusive. */
export function isOff(f: FinanceIndex, pool: number, d: Day): boolean {
  for (const [from, to] of f.offSpans[pool]) {
    if (from > d) return false;
    if (d <= to) return true;
  }
  return false;
}

/** A programme is offered on `d` when it is active and its pool is not off. */
export function isOffered(f: FinanceIndex, prog: number, d: Day): boolean {
  const g = f.finance.programmes[prog];
  return g.from <= d && (g.to === null || d <= g.to) && !isOff(f, f.progPool[prog], d);
}

export interface Award {
  set: number[];
  priced: BundleFunding;
  /** whole dollars asked of each pool, by pool index; a pool asked 0 is absent */
  asks: Map<number, number>;
}

/** What the programmes `set` ask of each pool for a project of `units` homes (spec 4.6). */
export function asksOf(
  f: FinanceIndex,
  kind: ProjectKind,
  set: readonly number[],
  proto: Prototype,
  units: number
): Map<number, number> {
  const priced = f.price(kind, set, proto);
  const asks = new Map<number, number>();
  set.forEach((g, i) => {
    const q = f.progPool[g];
    const it = priced.items[i];
    const dollars =
      projectDollars(it.granted, units) +
      projectDollars(it.lent, units) +
      projectDollars(it.reserve, units);
    if (dollars > 0) asks.set(q, (asks.get(q) ?? 0) + dollars);
  });
  return asks;
}

/**
 * Rounds of leaving out every programme of every short pool (a pool is short when
 * `avail(pool) < ask`), until none is short or the set is empty. `rounds` counts the rounds that
 * removed pools. Pools are never added back.
 */
export function leaveOut(
  bundle: readonly number[],
  kind: ProjectKind,
  proto: Prototype,
  units: number,
  avail: (pool: number) => number,
  f: FinanceIndex
): { set: number[]; rounds: number } {
  // `bundle` itself while nothing is left out (never mutated; the price memo knows the array)
  let set = bundle as number[];
  let rounds = 0;
  while (set.length > 0) {
    const asks = asksOf(f, kind, set, proto, units);
    let short: Set<number> | null = null;
    for (const [q, ask] of asks) {
      if (avail(q) < ask) (short ??= new Set()).add(q);
    }
    if (!short) break;
    const gone = short;
    set = set.filter((g) => !gone.has(f.progPool[g]));
    rounds++;
  }
  return { set, rounds };
}

/**
 * The award rule (spec 4.6, amended 2026-11-25, R1): leave out short pools, then award what is
 * left iff it is not empty and its level is above 0. The award may be below the whole bundle's
 * level: the application is read as formed from the pools that can pay. Null means it waits.
 */
export function awardSet(
  bundle: readonly number[],
  kind: ProjectKind,
  proto: Prototype,
  units: number,
  avail: (pool: number) => number,
  f: FinanceIndex
): Award | null {
  const { set } = leaveOut(bundle, kind, proto, units, avail, f);
  if (set.length === 0) return null;
  const priced = f.price(kind, set, proto);
  if (!(coverageLevel(priced.coverage) > 0)) return null;
  return { set, priced, asks: asksOf(f, kind, set, proto, units) };
}

/** `awardPasses` scratch, by pool: the summed ask, and a short pool's mark (0 between calls). */
let passAsk = new Float64Array(16);
let passShort = new Uint8Array(16);
/** The kept subsets of a bundle array, by the bit mask of kept positions (bundles never mutate). */
const subsets = new WeakMap<readonly number[], Map<number, number[]>>();

/** The members of `bundle` at the positions set in `mask`; one array per (bundle, mask). */
function subsetOf(bundle: readonly number[], mask: number): number[] {
  let byMask = subsets.get(bundle);
  if (byMask === undefined) {
    byMask = new Map();
    subsets.set(bundle, byMask);
  }
  let set = byMask.get(mask);
  if (set === undefined) {
    set = bundle.filter((_, i) => (mask & (1 << i)) !== 0);
    byMask.set(mask, set);
  }
  return set;
}

/**
 * Exactly `awardSet(...) !== null` (the kept set is not empty and its level is above 0), without
 * building the award: the serving probe of the grouped line's bisection. Each round sums a pool's
 * ask over the set in the order `asksOf` does (so the sums are the same doubles), and the
 * left-out sets are memoised by the bundle array and the kept positions, so a call allocates
 * nothing once its sets are known.
 */
export function awardPasses(
  bundle: readonly number[],
  kind: ProjectKind,
  proto: Prototype,
  units: number,
  avail: (pool: number) => number,
  f: FinanceIndex
): boolean {
  const n = bundle.length;
  // the kept positions are a 31-bit mask
  if (n > 30) return awardSet(bundle, kind, proto, units, avail, f) !== null;
  if (n === 0) return false;
  const P = f.finance.pools.length;
  if (passAsk.length < P) {
    passAsk = new Float64Array(P);
    passShort = new Uint8Array(P);
  }
  let mask = (1 << n) - 1;
  let set = bundle;
  for (;;) {
    const priced = f.price(kind, set, proto);
    // sum each pool's positive asks, in set order
    for (let j = 0; j < set.length; j++) {
      const q = f.progPool[set[j]];
      const it = priced.items[j];
      const dollars =
        projectDollars(it.granted, units) +
        projectDollars(it.lent, units) +
        projectDollars(it.reserve, units);
      if (dollars > 0) passAsk[q] += dollars;
    }
    // mark the short pools (a pool asked nothing is never short), clearing the sums
    let anyShort = false;
    for (let j = 0; j < set.length; j++) {
      const q = f.progPool[set[j]];
      const ask = passAsk[q];
      if (ask === 0) continue;
      passAsk[q] = 0;
      if (avail(q) < ask) {
        passShort[q] = 1;
        anyShort = true;
      }
    }
    if (!anyShort) break;
    // leave out every programme of a short pool, then clear the marks
    for (let i = 0; i < n; i++) {
      if ((mask & (1 << i)) !== 0 && passShort[f.progPool[bundle[i]]] === 1) mask &= ~(1 << i);
    }
    for (let i = 0; i < n; i++) passShort[f.progPool[bundle[i]]] = 0;
    if (mask === 0) return false;
    set = subsetOf(bundle, mask);
  }
  // the kept set, whole or partial, is awarded when its level is above 0
  return coverageLevel(f.price(kind, set, proto).coverage) > 0;
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
