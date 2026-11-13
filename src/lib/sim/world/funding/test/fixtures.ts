// Fixtures for the world-funding tests: the mini city with public money, and its money as frames.
import { miniCalibrationWithRoutes, miniFinance } from '$lib/sim/scenario/fixtures/mini-finance';
import { financeIndexOf, inflowArrivals, isOff, isOffered } from '$lib/sim/scenario/funding';
import type { SimInput } from '$lib/sim/scenario/types';
import type { Day } from '$lib/timelapse/time';
import { monthFirstDay, monthLastDay } from '../../months';
import type { FinanceFrame, PolicyFrame, PolicyTimeline } from '../../policy/frame';
import { frameIdOf } from '../../policy/intern';
import { miniInput } from '../../test/mini';
import { frameOf } from '../../test/timeline';

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
