// Fixtures for the world-funding tests: the mini city with public money, and its money as frames.
import { MARKET_TERMS, resolveTerms } from '$lib/sim/finance';
import {
  benchBaselineFunding,
  benchMarket,
  benchRoutes
} from '$lib/sim/scenario/fixtures/bench-finance';
import { miniCalibrationWithRoutes, miniFinance } from '$lib/sim/scenario/fixtures/mini-finance';
import { financeIndexOf, inflowArrivals, isOff, isOffered } from '$lib/sim/scenario/funding';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import type { SimInput } from '$lib/sim/scenario/types';
import type { Day } from '$lib/timelapse/time';
import type { Inflow, Pool, PoolKind, Programme } from '$lib/timelapse/types';
import { monthFirstDay, monthLastDay } from '../../months';
import type { FinanceFrame, PolicyFrame, PolicyTimeline } from '../../policy/frame';
import { frameIdOf } from '../../policy/intern';
import type { Statics } from '../../statics';
import { miniInput } from '../../test/mini';
import { frameOf } from '../../test/timeline';
import type { StepSink, World, WorldEvent } from '../../types';
import { withFunding } from '../../world';
import { createFundingSystem } from '../system';

type Finance = NonNullable<SimInput['finance']>;

/** The months `oneMoneyTimeline` scans for changes (50 years). */
export const MONEY_MONTHS = 600;

/**
 * The mini city with `miniFinance` and `miniCalibrationWithRoutes` (the finance-engine fixtures),
 * optionally with other money.
 */
export function fundedMini(finance?: Finance): SimInput {
  const base = miniInput();
  return {
    ...base,
    calibration: miniCalibrationWithRoutes(),
    finance: finance ?? miniFinance(base.asOf)
  };
}

/**
 * The bench city with the bench baseline as money (as `compile.perf.spec.ts` builds the bench
 * calibration): `benchRoutes`, `benchBaselineFunding(asOf)` as `baselineFunding` and the
 * `finance`, `benchMarket` and no market steps. `base` is `benchInput()` (Node only, so passed in).
 */
export function benchFunded(base: SimInput): SimInput {
  const baseline = benchBaselineFunding(base.asOf);
  return {
    ...base,
    calibration: {
      ...base.calibration,
      affordableRoutes: benchRoutes(),
      baselineFunding: baseline,
      market: benchMarket()
    },
    market: [],
    finance: {
      pools: baseline.pools,
      programmes: baseline.programmes,
      off: [],
      slope: 3,
      terms: resolveTerms(MARKET_TERMS)
    }
  };
}

/**
 * Month m's money of `fin`: `offered` from `isOffered` on the month's first day, `arrivals` from
 * `inflowArrivals` over the month's days (month 1 from `asOf`), capped pools only and not on a
 * day their pool is off, as `policy/money.ts:156-168` builds them.
 */
export function financeFrameOf(fin: Finance, asOf: Day, m: number): FinanceFrame {
  const idx = financeIndexOf(fin);
  const first = monthFirstDay(asOf, m);
  const last = monthLastDay(asOf, m);
  const offered = Uint8Array.from(fin.programmes, (_, g) => (isOffered(idx, g, first) ? 1 : 0));
  const lo = m === 1 ? asOf : first;
  const arrivals: FinanceFrame['arrivals'] = [];
  fin.pools.forEach((p, q) => {
    if (!idx.capped[q]) return;
    for (const fl of p.inflows) {
      const dollars = fl.kind === 'once' ? fl.dollars : fl.dollarsPerYear;
      for (const day of inflowArrivals(fl, lo, last))
        if (!isOff(idx, q, day)) arrivals.push({ pool: q, day, dollars });
    }
  });
  arrivals.sort((a, b) => a.day - b.day || a.pool - b.pool);
  return {
    pools: fin.pools,
    programmes: fin.programmes,
    offered,
    slope: fin.slope,
    terms: fin.terms,
    arrivals
  };
}

/**
 * The input's zoning and market with `fin` as money, one frame per month: the frame id comes from
 * `frameIdOf` of the offered set and the market, so months with the same offers share an id.
 * Changes are found over the first `MONEY_MONTHS` months.
 */
export function oneMoneyTimeline(input: SimInput, fin: Finance): PolicyTimeline {
  const frames = new Map<number, PolicyFrame>();
  const frameAt = (m: number): PolicyFrame => {
    let f = frames.get(m);
    if (f === undefined) {
      const finance = financeFrameOf(fin, input.asOf, m);
      const probe = frameOf(input, { finance });
      const id = frameIdOf(`clocks-fixture|${finance.offered.join('')}|${probe.market}`);
      f = { ...probe, id };
      frames.set(m, f);
    }
    return f;
  };
  const changes: number[] = [];
  for (let m = 2; m <= MONEY_MONTHS; m++) if (frameAt(m).id !== frameAt(m - 1).id) changes.push(m);
  return {
    frameAt,
    changes: () => changes,
    touched: () => new Int32Array(0),
    readyThrough: () => Number.MAX_SAFE_INTEGER
  };
}

/** A small seeded generator (mulberry32), as `engine-finance.spec.ts` has it. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TIERS = { veryLow: 0.5, low: 0.5, moderate: 0, aboveModerate: 0 };

const randomPool = (id: string, kind: PoolKind, inflows: Inflow[], uncapped = false): Pool => ({
  id,
  kind,
  label: id,
  inflows,
  uncapped,
  debt: kind === 'goBond' || kind === 'cop' ? { rate: 0.04, termYears: 30 } : null,
  leverage: kind === 'bank' ? 0.8 : 1
});

/**
 * A random valid finance on the mini city's `asOf` (test values): a copy of
 * `engine-finance.spec.ts:196-260` (not exported there), draw for draw.
 */
export function randomFinance(seed: number): Finance {
  const asOf = miniInput().asOf;
  const once = (day: Day, dollars: number): Inflow => ({ kind: 'once', day, dollars });
  const r = rng(seed * 7919 + 13);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const kinds: PoolKind[] = ['generalRevenue', 'state', 'dedicatedTax', 'bank', 'goBond'];
  const pools: Pool[] = [];
  const nCapped = 1 + Math.floor(r() * 3);
  for (let q = 0; q < nCapped; q++) {
    const inflows: Inflow[] = [];
    const nIn = Math.floor(r() * 3);
    for (let j = 0; j < nIn; j++) {
      if (r() < 0.5) inflows.push(once(asOf + Math.floor(r() * 4000), Math.floor(r() * 3e7)));
      else {
        const from = asOf + Math.floor(r() * 1000);
        inflows.push({
          kind: 'yearly',
          from,
          to: r() < 0.5 ? null : from + Math.floor(r() * 5000),
          dollarsPerYear: Math.floor(r() * 2e7)
        });
      }
    }
    const p = randomPool(`p${q}`, pick(kinds), inflows);
    if (p.kind === 'bank') p.leverage = 0.5 + r() * 0.5;
    pools.push(p);
  }
  if (r() < 0.6) pools.push(randomPool('fed', 'federal', [], true));
  const programmes: Programme[] = [];
  const nProg = 1 + Math.floor(r() * 5);
  for (let g = 0; g < nProg; g++) {
    const reach = r() < 0.5 ? 'market' : 'affordable';
    const x = r();
    const instrument: Programme['instrument'] =
      x < 0.5
        ? { kind: 'grant', share: 0.05 + r() * 0.95 }
        : x < 0.75
          ? { kind: 'loan', costShare: 0.1 + r() * 0.7, rate: r() * 0.08, requiredReturn: null }
          : { kind: 'guarantee', costShare: 0.2 + r() * 0.6, reserve: 0.05 + r() * 0.25 };
    const from = asOf - 100 + Math.floor(r() * 3000);
    programmes.push({
      id: `g${g}`,
      label: `g${g}`,
      pool: pick(pools).id,
      reach,
      instrument,
      from,
      to: r() < 0.6 ? null : from + Math.floor(r() * 4000),
      minHomes: Math.floor(r() * 4),
      tiers: reach === 'affordable' ? { ...TIERS } : null
    });
  }
  const off: Finance['off'] = [];
  if (r() < 0.4) {
    const from = asOf + Math.floor(r() * 5000);
    off.push({ pool: pick(pools).id, from, to: r() < 0.5 ? null : from + Math.floor(r() * 800) });
  }
  return {
    pools,
    programmes,
    off,
    slope: 1 + r() * 4,
    terms: resolveTerms(MARKET_TERMS, { guaranteeRateCut: 0.01, lossOnExit: r() })
  };
}

/** A world event with the month of the call that sent it (0 during `createWorld`). */
export type MonthEvent = WorldEvent & { month: number };

/**
 * A funded world (`withFunding(createFundingSystem())`) created and stepped through month
 * `through` on one due list planned at the start; every event with its month. With
 * `ledger: false` the sink has no `ledger` (rule 14). `afterStep` runs after each month's step,
 * with the ledger so far.
 */
export function runFunded(
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number,
  through: number,
  opts: {
    ledger?: boolean;
    afterStep?: (w: World, m: number, ledger: readonly LedgerEvent[]) => void;
  } = {}
): { world: World; events: MonthEvent[]; ledger: LedgerEvent[] } {
  const events: MonthEvent[] = [];
  const ledger: LedgerEvent[] = [];
  let month = 0;
  const out: StepSink = { event: (e) => events.push({ ...e, month }) };
  if (opts.ledger !== false) out.ledger = (e) => ledger.push(e);
  const core = withFunding(createFundingSystem());
  const world = core.createWorld(statics, timeline, seed, out);
  const due = core.planDue(world, statics, timeline, seed, through);
  for (let m = 1; m <= through; m++) {
    month = m;
    core.step(world, due, statics, timeline, seed, out);
    opts.afterStep?.(world, m, ledger);
  }
  return { world, events, ledger };
}
