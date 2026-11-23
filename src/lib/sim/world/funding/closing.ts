// Closing a spent pool: when a pool last receives money, and the timeline view in which the
// programmes of the world's closed pools are not offered.
import { prototypeFor } from '$lib/sim/finance';
import { asksOf, inflowArrivals } from '$lib/sim/scenario/funding';
import type { Day } from '$lib/timelapse/time';
import type { Pool } from '$lib/timelapse/types';
import { lotRow } from '../columns';
import { monthFirstDay, monthOfDay } from '../months';
import type { PolicyFrame, PolicyTimeline } from '../policy/frame';
import { frameIdOf } from '../policy/intern';
import { LOT_FREE, NO_DAY, type StepCtx } from '../types';
import { INSTR_GUARANTEE, INSTR_LOAN, addShutRow, fundOf, type FundPools } from './columns';
import type { FrameMoney } from './frame-money';
import { kindOf, servingMoney } from './serve';

/**
 * System 5, end of the scan: closes each spent pool from `ctx.lastDay + 1` (spec sec-design-spent).
 * A pool of the frame is spent when it is open, the month begins after its last arrival, it has
 * no loan out and no guarantee reserve held, and some waiting application of a free lot whose
 * bundle draws on it asks it for more than serving's available money (the whole bundle's ask).
 * The pools are judged in world pool row order, the cheap conditions first.
 */
export function closeSpent(ctx: StepCtx): void {
  const { pools } = fundOf(ctx.world);
  const { fm, rowOf, avail } = servingMoney(ctx);
  const defs = fm.fin.pools;
  const asOf = ctx.statics.asOf;
  const order = defs.map((_, fq) => fq).sort((a, b) => rowOf[a] - rowOf[b]);
  for (const fq of order) {
    const q = rowOf[fq];
    if (pools.closedDay[q] !== NO_DAY) continue;
    const last = lastArrivalOf(defs[fq], asOf);
    if (last === null || last >= ctx.firstDay) continue;
    if (holdsCredit(pools, pools.id[q])) continue;
    if (askedPast(ctx, fm, fq, avail(fq))) addShutRow(pools, q, ctx.lastDay + 1);
  }
}

/** Whether some money row of pool `id` is a loan or a guarantee (a loan out, a reserve held). */
function holdsCredit(pools: FundPools, id: string): boolean {
  for (let k = 0; k < pools.mN; k++) {
    if (pools.mPool[k] !== id) continue;
    const instr = pools.mInstr[k];
    if (instr === INSTR_LOAN || instr === INSTR_GUARANTEE) return true;
  }
  return false;
}

/**
 * Whether some waiting row of a free lot has a bundle holding a programme of frame pool `fq` and
 * asks that pool, for the whole bundle, more than `money`. A bundle the frame no longer offers
 * whole (`bundleIds` null) is skipped.
 */
function askedPast(ctx: StepCtx, fm: FrameMoney, fq: number, money: number): boolean {
  const { line } = fundOf(ctx.world);
  const lots = ctx.world.lots;
  const progPool = fm.index.progPool;
  for (let i = 0; i < line.n; i++) {
    if (line.gone[i] === 1) continue;
    const bundle = fm.bundleIds(line.bundle[i]);
    if (bundle === null || !bundle.some((g) => progPool[g] === fq)) continue;
    const li = lotRow(lots, line.lot[i]);
    if (li >= 0 && lots.state[li] !== LOT_FREE) continue;
    const units = line.units[i];
    const protoId = prototypeFor(line.stories[i], units).id;
    const ask = asksOf(fm.index, kindOf(line, i), bundle, protoId, units).get(fq) ?? 0;
    if (ask > money) return true;
  }
  return false;
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
    readyThrough: () => base.readyThrough()
  };
}
