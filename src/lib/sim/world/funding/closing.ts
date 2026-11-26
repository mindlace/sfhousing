// Closing a spent pool: when a pool last receives money, and the timeline view in which the
// programmes of the world's closed pools are not offered.
import { prototypeFor } from '$lib/sim/finance';
import { asksOf, inflowArrivals } from '$lib/sim/world/rules/funding';
import type { Day } from '$lib/timelapse/time';
import type { Pool } from '$lib/timelapse/types';
import { lotRow } from '../columns';
import { monthFirstDay, monthOfDay } from '../months';
import type { PolicyFrame, PolicyTimeline } from '../policy/frame';
import { frameIdOf } from '../policy/intern';
import type { Statics } from '../statics';
import { LOT_FREE, NO_DAY, type StepCtx, type World } from '../types';
import {
  INSTR_GUARANTEE,
  INSTR_LOAN,
  addShutRow,
  fundOf,
  reopenPool,
  type FundPools
} from './columns';
import type { FrameMoney } from './frame-money';
import { kindOf, servingMoney } from './serve';

/**
 * System 5, end of the scan: closes each spent pool from `ctx.lastDay + 1` (spec sec-design-spent).
 * A pool of the frame is spent when it is open, the month begins after its last arrival, it has
 * no loan out and no guarantee reserve held, and some waiting application of a free lot whose
 * bundle holds a programme of it asks it more than 0, and no such application asks it for
 * serving's available money or less (the whole bundle's ask; one that fits holds the pool open).
 * A pool none of whose programmes the frame offers is never asked (`bundleIds` refuses a bundle
 * holding one), so it is no candidate. The candidates are found first, the cheap conditions
 * first; one pass over the line then finds those no ask can pay, and they close in world
 * pool row order.
 */
export function closeSpent(ctx: StepCtx): void {
  const { pools } = fundOf(ctx.world);
  const { fm, rowOf, avail } = servingMoney(ctx);
  // This month's definitions: frame ids leave inflows out, so `fm` (memoised by id) may hold an
  // earlier month's, in the same pool order.
  const defs = ctx.frame.finance!.pools;
  const asOf = ctx.statics.asOf;
  const progPool = fm.index.progPool;
  const drawn = new Set<number>();
  for (const i of fm.offered.market) drawn.add(progPool[i]);
  for (const i of fm.offered.affordable) drawn.add(progPool[i]);
  // Frame pool index -> serving's available money, for each candidate.
  const money = new Map<number, number>();
  let credit: Set<string> | null = null;
  for (let fq = 0; fq < defs.length; fq++) {
    if (!drawn.has(fq)) continue;
    const q = rowOf[fq];
    if (pools.closedDay[q] !== NO_DAY) continue;
    const last = lastArrivalOf(defs[fq], asOf);
    if (last === null || last >= ctx.firstDay) continue;
    credit ??= creditPools(pools);
    if (credit.has(pools.id[q])) continue;
    money.set(fq, avail(fq));
  }
  if (money.size === 0) return;
  const short = askedPast(ctx, fm, money);
  const order = [...short].sort((a, b) => rowOf[a] - rowOf[b]);
  for (const fq of order) addShutRow(pools, rowOf[fq], ctx.lastDay + 1);
}

/** The ids of the pools some money row of which is a loan or a guarantee (a loan out, a reserve). */
function creditPools(pools: FundPools): Set<string> {
  const out = new Set<string>();
  for (let k = 0; k < pools.mN; k++) {
    const instr = pools.mInstr[k];
    if (instr === INSTR_LOAN || instr === INSTR_GUARANTEE) out.add(pools.mPool[k]);
  }
  return out;
}

/**
 * The pools of `money` (frame pool index -> serving's available money) that are spent among
 * `rows`, the waiting rows' asks (frame pool index -> dollars, for the whole bundle): a pool is
 * spent when at least one row asks it more than 0 and every row that asks it more than 0 asks more
 * than its money. One ask that fits (an exact fit included) holds the pool open.
 */
export function spentAmong(
  rows: Iterable<ReadonlyMap<number, number>>,
  money: ReadonlyMap<number, number>
): Set<number> {
  const asked = new Set<number>();
  const fits = new Set<number>();
  for (const row of rows) {
    for (const [fq, dollars] of row) {
      const have = money.get(fq);
      if (have === undefined || !(dollars > 0)) continue;
      asked.add(fq);
      if (dollars <= have) fits.add(fq);
    }
  }
  const spent = new Set<number>();
  for (const fq of asked) if (!fits.has(fq)) spent.add(fq);
  return spent;
}

/**
 * The frame pools of `money` that no waiting row of a free lot asking them can pay (see
 * `spentAmong`); a row's bundle must hold a programme of the pool. A bundle the frame no longer
 * offers whole (`bundleIds` null) is skipped. One pass over the line, the cheap checks first, each
 * distinct bundle read once.
 */
function askedPast(ctx: StepCtx, fm: FrameMoney, money: Map<number, number>): Set<number> {
  const { line } = fundOf(ctx.world);
  const lots = ctx.world.lots;
  const progPool = fm.index.progPool;
  // Joined ids -> the bundle when it holds a programme of a pool of `money`, else null.
  const asking = new Map<string, number[] | null>();
  function* rows(): Generator<ReadonlyMap<number, number>> {
    for (let i = 0; i < line.n; i++) {
      if (line.gone[i] === 1) continue;
      const li = lotRow(lots, line.lot[i]);
      if (li >= 0 && lots.state[li] !== LOT_FREE) continue;
      const ids = line.bundle[i];
      let bundle = asking.get(ids);
      if (bundle === undefined) {
        const b = fm.bundleIds(ids);
        bundle = b !== null && b.some((g) => money.has(progPool[g])) ? b : null;
        asking.set(ids, bundle);
      }
      if (bundle === null) continue;
      const units = line.units[i];
      const protoId = prototypeFor(line.stories[i], units).id;
      yield asksOf(fm.index, kindOf(line, i), bundle, protoId, units);
    }
  }
  return spentAmong(rows(), money);
}

/**
 * Before month m = world.month + 1 is stepped: for each arrival of the base frame of month m with
 * dollars above 0 whose pool has an open shut row, `reopenPool(pools, q, monthFirstDay(asOf, m))`.
 * Nothing when m > timeline.readyThrough() (step then throws as today) or the frame has no finance.
 * Pool rows are found by id without appending; an arrival whose pool has no world row is skipped.
 */
export function reopenArrivals(world: World, statics: Statics, timeline: PolicyTimeline): void {
  if (!('shutN' in world.pools)) return;
  const pools = world.pools as FundPools;
  if (pools.shutN === 0) return;
  const m = world.month + 1;
  if (m > timeline.readyThrough()) return;
  const fin = timeline.frameAt(m).finance;
  if (fin === null) return;
  const day = monthFirstDay(statics.asOf, m);
  for (const a of fin.arrivals) {
    if (!(a.dollars > 0)) continue;
    const id = fin.pools[a.pool].id;
    let q = 0;
    while (q < pools.n && pools.id[q] !== id) q++;
    if (q === pools.n || pools.closedDay[q] === NO_DAY) continue;
    reopenPool(pools, q, day);
  }
}

const lastArrivals = new WeakMap<Pool, Map<Day, Day | null>>();

/** The last day `pool` receives money under this definition; null when it never stops. */
export function lastArrivalOf(pool: Pool, asOf: Day): Day | null {
  let byAsOf = lastArrivals.get(pool);
  if (byAsOf === undefined) lastArrivals.set(pool, (byAsOf = new Map()));
  if (byAsOf.has(asOf)) return byAsOf.get(asOf) as Day | null;
  let last: Day | null = NO_DAY;
  for (const fl of pool.inflows) {
    if (fl.kind === 'yearly' && fl.to === null && fl.dollarsPerYear > 0) {
      last = null;
      break;
    }
    const dollars = fl.kind === 'once' ? fl.dollars : fl.dollarsPerYear;
    if (!(dollars > 0)) continue;
    const horizon = fl.kind === 'once' ? fl.day : fl.to!;
    const days = inflowArrivals(fl, asOf, horizon);
    if (days.length > 0 && days[days.length - 1] > last) last = days[days.length - 1];
  }
  byAsOf.set(asOf, last);
  return last;
}

const KEPT_VIEWS = 8;
const views = new WeakMap<PolicyTimeline, Map<string, PolicyTimeline>>();
const derived = new WeakMap<PolicyFrame, Map<string, PolicyFrame>>();

interface Shut {
  pool: string;
  from: Day;
  to: Day;
}

/** `timeline` with the world's closed pools' programmes not offered; `timeline` itself with none. */
export function closedTimeline(
  timeline: PolicyTimeline,
  pools: FundPools,
  asOf: Day
): PolicyTimeline {
  if (pools.shutN === 0) return timeline;
  const rows: Shut[] = [];
  for (let i = 0; i < pools.shutN; i++)
    rows.push({
      pool: pools.id[pools.shutRow[i]],
      from: pools.shutFrom[i],
      to: pools.shutTo[i]
    });
  const signature = `${asOf}|${rows.map((r) => `${r.pool}:${r.from}:${r.to}`).join('|')}`;
  let kept = views.get(timeline);
  const hit = kept?.get(signature);
  if (hit !== undefined) return hit;
  const view = buildView(timeline, rows, asOf);
  if (kept === undefined) views.set(timeline, (kept = new Map()));
  kept.set(signature, view);
  if (kept.size > KEPT_VIEWS) kept.delete(kept.keys().next().value!);
  return view;
}

function buildView(base: PolicyTimeline, rows: Shut[], asOf: Day): PolicyTimeline {
  /** Ids of the pools closed on month k's first day, sorted. */
  const closedIn = (k: number): string[] => {
    const day = monthFirstDay(asOf, k);
    const out = new Set<string>();
    for (const r of rows) if (r.from <= day && (r.to === NO_DAY || day < r.to)) out.add(r.pool);
    return [...out].sort();
  };
  /** The closed ids the base frame of month k holds, joined. */
  const presentKey = (k: number): string => {
    const fin = base.frameAt(k).finance;
    if (fin === null) return '';
    const held = new Set(fin.pools.map((p) => p.id));
    return closedIn(k)
      .filter((id) => held.has(id))
      .join(',');
  };
  // Months at which some row opens or ends: the first month whose first day is on or after the day.
  const edges = new Set<number>();
  for (const r of rows) {
    edges.add(monthOfDay(asOf, r.from - 1) + 1);
    if (r.to !== NO_DAY) edges.add(monthOfDay(asOf, r.to - 1) + 1);
  }
  // The base's changes as last read (it may hand out a new array each call), and what they gave.
  let seen: number[] = [];
  let seenReady = -1;
  let result: number[] = [];
  let baseSet = new Set<number>();
  const sameAsSeen = (b: number[]): boolean => {
    if (b.length !== seen.length) return false;
    for (let i = 0; i < b.length; i++) if (b[i] !== seen[i]) return false;
    return true;
  };
  /** Read-only: the same array while neither the base's changes nor its ready months move. */
  const changes = (): number[] => {
    const b = base.changes();
    const ready = base.readyThrough();
    if (ready !== seenReady || !sameAsSeen(b)) {
      const all = new Set(b);
      for (const k of edges)
        if (k >= 2 && k <= ready && presentKey(k) !== presentKey(k - 1)) all.add(k);
      result = [...all].sort((x, y) => x - y);
      baseSet = new Set(b);
      seen = [...b];
      seenReady = ready;
    }
    return result;
  };
  /** Month k's view frame with the base frame it came from; the base's frame of a month is fixed. */
  const frames = new Map<number, { from: PolicyFrame; out: PolicyFrame }>();
  const derive = (frame: PolicyFrame, k: number): PolicyFrame => {
    const fin = frame.finance;
    if (fin === null) return frame;
    const held = new Set(fin.pools.map((p) => p.id));
    const ids = closedIn(k)
      .filter((id) => held.has(id))
      .join(',');
    if (ids === '') return frame;
    let cache = derived.get(frame);
    if (cache === undefined) derived.set(frame, (cache = new Map()));
    let out = cache.get(ids);
    if (out === undefined) {
      const shut = new Set(ids.split(','));
      const offered = fin.offered.slice();
      fin.programmes.forEach((g, i) => {
        if (shut.has(g.pool)) offered[i] = 0;
      });
      out = { ...frame, id: frameIdOf(`closed|${frame.id}|${ids}`), finance: { ...fin, offered } };
      cache.set(ids, out);
    }
    return out;
  };
  return {
    frameAt(k) {
      const frame = base.frameAt(k);
      const got = frames.get(k);
      if (got !== undefined && got.from === frame) return got.out;
      const out = derive(frame, k);
      frames.set(k, { from: frame, out });
      return out;
    },
    changes,
    touched(k) {
      changes();
      return baseSet.has(k) ? base.touched(k) : new Int32Array(0);
    },
    // A parking-only month of the base stays one when no pool opens or closes in it.
    parkingOnly: (k) =>
      k >= 2 && base.parkingOnly?.(k) === true && presentKey(k) === presentKey(k - 1),
    readyThrough: () => base.readyThrough()
  };
}
