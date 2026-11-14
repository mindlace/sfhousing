// Pools, arrivals and money events (spec rules 12-16). Arrivals come only from the frame's
// `finance.arrivals`; an award's later money events (`money.ts:97-163`) are made when the project's
// own event happens, with today's kinds, amounts, counters and within-event order.
import { projectDollars } from '$lib/sim/finance';
import type { Award } from '$lib/sim/scenario/funding';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import type { Day } from '$lib/timelapse/time';
import { STAGE_ORDER, type Pool } from '$lib/timelapse/types';
import { NO_DAY, type StepCtx, type WorldEvent } from '../types';
import {
  INSTR_GRANT,
  INSTR_GUARANTEE,
  INSTR_LOAN,
  addMoneyRow,
  dropMoneyRows,
  fundOf,
  moneyRowsOf,
  poolRowOf,
  type FundPools
} from './columns';
import { frameMoney, type FrameMoney } from './frame-money';

const S = STAGE_ORDER.length;
const CONSTRUCTION = STAGE_ORDER.indexOf('construction');

type Later = 'spend' | 'repay' | 'loss' | 'release';
/** Within-event order of a project's events (`money.ts:25-30`). */
const ORDER: Record<Later, number> = { spend: 0, repay: 1, loss: 2, release: 3 };
const INSTR = ['grant', 'loan', 'guarantee'] as const;

/**
 * Money reached pool row `q` on `day` of `month` (rule 11, T17): keep the month's LATEST day.
 * Money events of a month are not booked in day order (system 2's arrivals, then system 3's
 * releases and repayments by project row), so an earlier day never overwrites a later one.
 */
function noteMoney(pools: FundPools, q: number, month: number, day: Day): void {
  if (pools.moneyMonth[q] !== month || day > pools.moneyDay[q]) {
    pools.moneyDay[q] = day;
    pools.moneyMonth[q] = month;
  }
}

/**
 * Rule 10: the dollars returned to each capped pool row (releases and repayments) while serve's
 * scan is open, held out of the scan's available money until it ends; null outside the scan, so
 * nothing is held between steps and the world carries no column for it.
 */
let scan: { pools: FundPools; held: Map<number, number> } | null = null;

/**
 * Runs serve's scan `fn` over `pools` with returned money held (rule 10): money a chain started in
 * the scan returns is booked and written at its event, but waits for next month's scan and does
 * not set the pool's money day (T17). Reductions apply at once.
 */
export function holdingReturns(pools: FundPools, fn: () => void): void {
  if (scan !== null) throw new Error('holdingReturns: a scan is already open');
  scan = { pools, held: new Map() };
  try {
    fn();
  } finally {
    scan = null;
  }
}

/** Dollars returned to pool row `q` in the open scan and held from it; 0 outside a scan. */
export function heldOf(pools: FundPools, q: number): number {
  return scan !== null && scan.pools === pools ? (scan.held.get(q) ?? 0) : 0;
}

/** System 2 (rule 12): every entry of frame.finance.arrivals, in list order; 0 dollars skipped. */
export function moneyIn(ctx: StepCtx): void {
  const fin = ctx.frame.finance!;
  const { pools } = fundOf(ctx.world);
  const ledger = ctx.out.ledger;
  for (const a of fin.arrivals) {
    if (a.dollars === 0) continue;
    const id = fin.pools[a.pool].id;
    const q = poolRowOf(pools, id);
    pools.received[q] += a.dollars;
    noteMoney(pools, q, ctx.month, a.day);
    if (ledger) ledger({ day: a.day, pool: id, programme: null, kind: 'in', dollars: a.dollars });
  }
}

/** Available money of world pool row `q` under the frame's definition of that pool (Infinity uncapped). */
export function availableOf(pools: FundPools, q: number, def: Pool): number {
  if (def.uncapped) return Infinity;
  return (
    def.leverage * pools.received[q] -
    pools.committed[q] -
    pools.spentGrant[q] -
    pools.outLoan[q] -
    pools.lostLoan[q] -
    pools.lostGuarantee[q]
  );
}

/** The commit of one award (Task 6 calls it before startProject): money rows for `row`, counters, 'commit' events. */
export function commitAward(
  ctx: StepCtx,
  fm: FrameMoney,
  row: number,
  day: Day,
  award: Award,
  units: number
): void {
  const { pools } = fundOf(ctx.world);
  if (pools.mN > 0 && pools.mRow[pools.mN - 1] >= row)
    throw new Error(`commitAward: row ${row} is not after the last awarded row`);
  const fin = fm.fin;
  const ledger = ctx.out.ledger;
  const loss = fin.terms.lossOnExit as number;
  award.set.forEach((g, i) => {
    const prog = fin.programmes[g];
    const it = award.priced.items[i];
    const kind = prog.instrument.kind;
    const G = projectDollars(it.granted, units);
    const P = projectDollars(it.lent, units);
    const H = projectDollars(it.reserve, units);
    const commit = kind === 'grant' ? G : kind === 'loan' ? P : H;
    const q = poolRowOf(pools, prog.pool);
    if (commit > 0) {
      pools.committed[q] += commit;
      if (ledger)
        ledger({ day, pool: prog.pool, programme: prog.id, kind: 'commit', dollars: commit });
    }
    const m = addMoneyRow(pools);
    pools.mRow[m] = row;
    pools.mProg[m] = prog.id;
    pools.mPool[m] = prog.pool;
    pools.mInstr[m] =
      kind === 'grant' ? INSTR_GRANT : kind === 'loan' ? INSTR_LOAN : INSTR_GUARANTEE;
    pools.mGrant[m] = G;
    pools.mLent[m] = P;
    pools.mReserve[m] = H;
    pools.mGuaranteed[m] = projectDollars(it.guaranteed, units);
    pools.mLoss[m] = loss;
  });
}

/**
 * One money event of a project, before it is applied (`money.ts:33-42`). Its pool and programme
 * ids are read when it is made: an `'end'` drops the row's money rows before the ledger is written.
 */
interface Made {
  order: number;
  sub: number;
  prog: number;
  pool: string;
  programme: string;
  kind: Later;
  dollars: number;
}

/** Rule 13: the money events of a funded row on `e`; no-op for a row without money rows. */
export function moneyOnEvent(ctx: StepCtx, e: WorldEvent): void {
  if (e.kind !== 'end' && !(e.kind === 'enter' && e.stage === 'construction')) return;
  const { pools } = fundOf(ctx.world);
  if (pools.mN === 0) return;
  const [from, to] = moneyRowsOf(pools, e.row);
  if (from === to) return;
  const fm = frameMoney(ctx.timeline, ctx.frame);
  const ledger = ctx.out.ledger;
  // Only built with a ledger (rule 14): the counters are sums of whole dollars, so applying them in
  // money-row order gives the same state as `settle`'s sorted order.
  const made: Made[] | null = ledger ? [] : null;
  const make = (m: number, kind: Later, dollars: number, order = ORDER[kind]): void => {
    if (dollars === 0) return;
    book(ctx, fm, pools, m, kind, dollars, e.day);
    if (made)
      made.push({
        order,
        sub: kind === 'loss' ? 1 : 0,
        prog: fm.prog.get(pools.mProg[m]) ?? -1,
        pool: pools.mPool[m],
        programme: pools.mProg[m],
        kind,
        dollars
      });
  };

  if (e.kind === 'enter') {
    for (let m = from; m < to; m++) {
      const instr = pools.mInstr[m];
      if (instr === INSTR_GRANT) make(m, 'spend', pools.mGrant[m]);
      else if (instr === INSTR_LOAN) make(m, 'spend', pools.mLent[m]);
    }
  } else if (e.kind === 'end') {
    const after =
      e.how === 'exit' && ctx.world.projects.entered[e.row * S + CONSTRUCTION] !== NO_DAY;
    for (let m = from; m < to; m++) {
      const instr = pools.mInstr[m];
      const lambda = pools.mLoss[m];
      const G = pools.mGrant[m];
      const P = pools.mLent[m];
      const H = pools.mReserve[m];
      if (e.how === 'complete') {
        if (instr === INSTR_LOAN) make(m, 'repay', P);
        else if (instr === INSTR_GUARANTEE) make(m, 'release', H);
      } else if (e.how === 'exit') {
        if (instr === INSTR_GRANT) {
          if (after) make(m, 'loss', Math.round(lambda * G));
          else make(m, 'release', G);
        } else if (instr === INSTR_LOAN) {
          if (after) {
            const L = Math.round(lambda * P);
            make(m, 'repay', P - L);
            make(m, 'loss', L);
          } else make(m, 'release', P);
        } else {
          // A guarantee's release precedes its loss: it takes the loss's order, ahead of it.
          make(m, 'release', H, after ? ORDER.loss : undefined);
          if (after) make(m, 'loss', Math.min(Math.round(lambda * pools.mGuaranteed[m]), H));
        }
      }
    }
    dropMoneyRows(pools, e.row);
  }

  if (made && ledger && made.length > 0) {
    made.sort((x, y) => x.order - y.order || x.prog - y.prog || x.sub - y.sub);
    for (const x of made)
      ledger({
        day: e.day,
        pool: x.pool,
        programme: x.programme,
        kind: x.kind,
        dollars: x.dollars
      } satisfies LedgerEvent);
  }
}

/** One event's counter updates, as `settle` makes them (`money.ts:177-196`). */
function book(
  ctx: StepCtx,
  fm: FrameMoney,
  pools: FundPools,
  m: number,
  kind: Later,
  d: number,
  day: Day
): void {
  const q = poolRowOf(pools, pools.mPool[m]);
  const instr = INSTR[pools.mInstr[m]];
  switch (kind) {
    case 'spend':
      pools.committed[q] -= d;
      if (instr === 'grant') pools.spentGrant[q] += d;
      else pools.outLoan[q] += d;
      break;
    case 'repay':
      pools.outLoan[q] -= d;
      break;
    case 'loss':
      if (instr === 'loan') {
        pools.outLoan[q] -= d;
        pools.lostLoan[q] += d;
      } else if (instr === 'guarantee') pools.lostGuarantee[q] += d;
      break;
    case 'release':
      pools.committed[q] -= d;
      break;
  }
  if (kind === 'repay' || kind === 'release') {
    const fq = fm.pool.get(pools.mPool[m]);
    if (fq === undefined || fm.index.capped[fq] !== 1) return;
    // Rule 10: returned during serve's scan, it waits for next month's scan (and its money day).
    if (scan !== null && scan.pools === pools) scan.held.set(q, (scan.held.get(q) ?? 0) + d);
    else noteMoney(pools, q, ctx.month, day);
  }
}
