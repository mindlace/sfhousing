// Closing a spent pool: when a pool last receives money, and the timeline view in which the
// programmes of the world's closed pools are not offered.
import { inflowArrivals } from '$lib/sim/scenario/funding';
import type { Day } from '$lib/timelapse/time';
import type { Pool } from '$lib/timelapse/types';
import { monthFirstDay, monthOfDay } from '../months';
import type { PolicyFrame, PolicyTimeline } from '../policy/frame';
import { frameIdOf } from '../policy/intern';
import { NO_DAY } from '../types';
import type { FundPools } from './columns';

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
