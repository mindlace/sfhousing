/**
 * Public money in the engine: inflow arrivals (F5), the pipeline statement (spec 4.13) and the
 * finance input check (spec 4.2). Pure.
 */
import type { Day } from '$lib/timelapse/time';
import type { Inflow, Pool, PoolKind, ProjectKind, Provenance } from '$lib/timelapse/types';
import {
  CERTAIN_TOLERANCE,
  PROTOTYPES,
  fundBundle,
  isCertain,
  missingTerms,
  projectDollars,
  validateInstrument,
  type BundleFunding,
  type PrototypeId
} from '../finance';
import { dayOf, isoOf } from './dates';
import type { SimInput } from './types';

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

/** Finance objects whose pools, programmes, off, slope and terms passed the checks. */
const checkedFinance = new WeakSet<Finance>();

const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function checkFinanceShape(f: Finance): void {
  if (!(typeof f.slope === 'number' && Number.isFinite(f.slope) && f.slope >= 0)) {
    throw new RangeError(`finance.slope must be a finite number of 0 or more; got ${f.slope}`);
  }
  const poolIds = new Set<string>();
  f.pools.forEach((p, i) => {
    if (poolIds.has(p.id)) throw new RangeError(`finance.pools[${i}].id ${p.id} is repeated`);
    poolIds.add(p.id);
  });
  const progIds = new Set<string>();
  f.programmes.forEach((g, i) => {
    if (progIds.has(g.id)) throw new RangeError(`finance.programmes[${i}].id ${g.id} is repeated`);
    progIds.add(g.id);
  });
  f.programmes.forEach((g, i) => {
    if (!poolIds.has(g.pool)) {
      throw new RangeError(`finance.programmes[${i}].pool ${g.pool} names no pool`);
    }
  });
  f.pools.forEach((p, i) => {
    if (p.uncapped && p.inflows.length > 0) {
      throw new RangeError(`finance.pools[${i}] (${p.id}): an uncapped pool has no inflows`);
    }
  });
  f.pools.forEach((p, i) => {
    if (!(typeof p.leverage === 'number' && Number.isFinite(p.leverage) && p.leverage > 0)) {
      throw new RangeError(
        `finance.pools[${i}] (${p.id}): leverage must be a finite number above 0; got ${p.leverage}`
      );
    }
  });
  f.pools.forEach((p, i) => {
    p.inflows.forEach((fl, j) => {
      const dollars = fl.kind === 'once' ? fl.dollars : fl.dollarsPerYear;
      const at = `finance.pools[${i}].inflows[${j}]`;
      if (!(isWhole(dollars) && dollars >= 0)) {
        throw new RangeError(`${at}: dollars must be a whole number of 0 or more`);
      }
      if (fl.kind === 'yearly' && fl.to !== null && fl.to < fl.from) {
        throw new RangeError(`${at}: to is before from`);
      }
    });
  });
  f.programmes.forEach((g, i) => {
    if (g.to !== null && g.to < g.from) {
      throw new RangeError(
        `finance.programmes[${i}] (${g.id}): to ${isoOf(g.to)} is before from ${isoOf(g.from)}`
      );
    }
  });
  f.pools.forEach((p, i) => {
    const at = `finance.pools[${i}] (${p.id}): `;
    const borrows = p.kind === 'goBond' || p.kind === 'cop';
    if (borrows && p.debt === null)
      throw new RangeError(`${at}debt is required for a goBond or cop pool`);
    if (!borrows) {
      if (p.debt !== null) throw new RangeError(`${at}debt must be null for a ${p.kind} pool`);
      return;
    }
    const { rate, termYears } = p.debt!;
    if (!(typeof rate === 'number' && rate > 0 && rate <= 0.25)) {
      throw new RangeError(`${at}debt.rate must be above 0 and at most 0.25; got ${rate}`);
    }
    if (!(isWhole(termYears) && termYears >= 1 && termYears <= 40)) {
      throw new RangeError(
        `${at}debt.termYears must be a whole number from 1 to 40; got ${termYears}`
      );
    }
  });
  f.programmes.forEach((g, i) => {
    if (!(isWhole(g.minHomes) && g.minHomes >= 0 && g.minHomes <= 10000)) {
      throw new RangeError(
        `finance.programmes[${i}] (${g.id}): minHomes must be a whole number from 0 to 10000`
      );
    }
  });
  f.programmes.forEach((g, i) => {
    const msg = validateInstrument(g.instrument);
    if (msg !== null) throw new RangeError(`finance.programmes[${i}] (${g.id}): ${msg}`);
  });
  f.programmes.forEach((g, i) => {
    const key = missingTerms(g.instrument, f.terms)[0];
    if (key !== undefined) {
      throw new RangeError(
        `finance.programmes[${i}] (${g.id}): ${g.instrument.kind} needs ${key}, which is not sourced`
      );
    }
  });
  const loss = f.terms.lossOnExit;
  if (!(typeof loss === 'number' && loss >= 0 && loss <= 1)) {
    throw new RangeError(`finance.terms.lossOnExit must be between 0 and 1; got ${loss}`);
  }
  f.off.forEach((o, i) => {
    if (!poolIds.has(o.pool))
      throw new RangeError(`finance.off[${i}].pool ${o.pool} names no pool`);
  });
  f.off.forEach((o, i) => {
    if (o.to !== null && o.to < o.from) {
      throw new RangeError(
        `finance.off[${i}] (${o.pool}): to ${isoOf(o.to)} is before from ${isoOf(o.from)}`
      );
    }
  });
}

/**
 * Throws a RangeError on bad `finance` (spec 4.2), first failing check first. The checks on the
 * finance object are memoised by its identity; the routes check reads the calibration and runs
 * on every call.
 */
export function checkFinance(input: SimInput): void {
  const f = input.finance;
  if (!f) return;
  if (!checkedFinance.has(f)) {
    checkFinanceShape(f);
    checkedFinance.add(f);
  }
  const cal = input.newProjects?.calibration ?? input.calibration;
  if (!cal.affordableRoutes) {
    const g = f.programmes.find((p) => p.reach === 'affordable');
    if (g) {
      throw new RangeError(
        `finance: the calibration has no affordableRoutes, but programme ${g.id} reaches affordable projects`
      );
    }
  }
}

/** The coverage level: coverage counted up to 1, with `isCertain`'s tolerance (spec, Terms). */
export function coverageLevel(c: number): number {
  return isCertain(c) ? 1 : c;
}

/** x is below y when `x < y - CERTAIN_TOLERANCE`. */
export function below(x: number, y: number): boolean {
  return x < y - CERTAIN_TOLERANCE;
}

/** A capped pool's counters, in whole dollars (spec 4.7). */
export interface PoolState {
  received: number;
  committed: number;
  spentGrant: number;
  outLoan: number;
  lostLoan: number;
  lostGuarantee: number;
}

export function newPoolState(): PoolState {
  return {
    received: 0,
    committed: 0,
    spentGrant: 0,
    outLoan: 0,
    lostLoan: 0,
    lostGuarantee: 0
  };
}

/** Money a pool can still commit; `Infinity` for an uncapped pool (spec 4.7). */
export function available(pool: Pool, s: PoolState): number {
  if (pool.uncapped) return Infinity;
  return (
    pool.leverage * s.received -
    s.committed -
    s.spentGrant -
    s.outLoan -
    s.lostLoan -
    s.lostGuarantee
  );
}

export interface FinanceIndex {
  finance: Finance;
  /** pool id to pool index */
  poolOf: Map<string, number>;
  /** programme index to pool index */
  progPool: Int32Array;
  progPoolKind: PoolKind[];
  /** 1 for a capped pool, by pool */
  capped: Uint8Array;
  /** by pool: the `finance.off` spans, sorted by `from`; a null `to` is Infinity */
  offSpans: [Day, Day][][];
  /**
   * `fundBundle` of the programmes `set` (ascending indices) for a project of `kind`, memoised by
   * kind, prototype (market only) and set. The result is shared: never mutate it.
   */
  price(kind: ProjectKind, set: readonly number[], protoId: PrototypeId): BundleFunding;
}

const indexes = new WeakMap<Finance, FinanceIndex>();

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
  const capped = Uint8Array.from(finance.pools, (p) => (p.uncapped ? 0 : 1));
  const offSpans: [Day, Day][][] = finance.pools.map(() => []);
  for (const o of finance.off) {
    offSpans[poolOf.get(o.pool)!].push([o.from, o.to === null ? Infinity : o.to]);
  }
  for (const spans of offSpans) spans.sort((a, b) => a[0] - b[0]);

  const memo = new Map<string, BundleFunding>();
  const byArray = new WeakMap<readonly number[], Map<string, BundleFunding>>();
  const protos = new Map<string, (typeof PROTOTYPES)[number]>(PROTOTYPES.map((p) => [p.id, p]));
  const index: FinanceIndex = {
    finance,
    poolOf,
    progPool,
    progPoolKind,
    capped,
    offSpans,
    price(kind, set, protoId) {
      // first by the array itself (the engine passes the same bundle arrays again and again),
      // then by its contents
      const sub = kind === 'market' ? protoId : '~affordable';
      let byArr = byArray.get(set);
      if (byArr === undefined) {
        byArr = new Map();
        byArray.set(set, byArr);
      }
      const hit = byArr.get(sub);
      if (hit !== undefined) return hit;
      const key = `${kind}|${kind === 'market' ? protoId : ''}|${set.join(',')}`;
      let r = memo.get(key);
      if (!r) {
        r = fundBundle(
          set.map((g) => ({
            instrument: finance.programmes[g].instrument,
            poolKind: progPoolKind[g]
          })),
          kind,
          protos.get(protoId)!,
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
  /** whole dollars asked of each capped pool, by pool index; a pool asked 0 is absent */
  asks: Map<number, number>;
}

/** What the programmes `set` ask of each capped pool for a project of `units` homes (spec 4.6). */
export function asksOf(
  f: FinanceIndex,
  kind: ProjectKind,
  set: readonly number[],
  protoId: PrototypeId,
  units: number
): Map<number, number> {
  const priced = f.price(kind, set, protoId);
  const asks = new Map<number, number>();
  set.forEach((g, i) => {
    const q = f.progPool[g];
    if (!f.capped[q]) return;
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
  protoId: PrototypeId,
  units: number,
  avail: (pool: number) => number,
  f: FinanceIndex
): { set: number[]; rounds: number } {
  // `bundle` itself while nothing is left out (never mutated; the price memo knows the array)
  let set = bundle as number[];
  let rounds = 0;
  while (set.length > 0) {
    const asks = asksOf(f, kind, set, protoId, units);
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
 * The award rule (spec 4.6): leave out short pools, then award iff the set is not empty and its
 * level is not below the whole bundle's. Null means the application waits.
 */
export function awardSet(
  bundle: readonly number[],
  kind: ProjectKind,
  protoId: PrototypeId,
  units: number,
  avail: (pool: number) => number,
  f: FinanceIndex
): Award | null {
  const { set } = leaveOut(bundle, kind, protoId, units, avail, f);
  if (set.length === 0) return null;
  const whole = f.price(kind, bundle, protoId);
  const priced = f.price(kind, set, protoId);
  if (below(coverageLevel(priced.coverage), coverageLevel(whole.coverage))) return null;
  return { set, priced, asks: asksOf(f, kind, set, protoId, units) };
}
