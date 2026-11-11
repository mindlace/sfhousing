/**
 * Public money in the engine: inflow arrivals (F5), the pipeline statement (spec 4.13) and the
 * finance input check (spec 4.2). Pure.
 */
import type { Day } from '$lib/timelapse/time';
import type { Inflow, Provenance } from '$lib/timelapse/types';
import { missingTerms, validateInstrument } from '../finance';
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
