import type { ParcelId } from '$lib/data/parcel';
import type { Precompute } from '$lib/sim/scenario/input';
import * as inputModule from '$lib/sim/scenario/input';
import * as rngModule from '$lib/sim/scenario/rng';
import * as mathModule from '$lib/timelapse/math';
import * as timeModule from '$lib/timelapse/time';
import type { Day } from '$lib/timelapse/time';
import * as monthsModule from './months';
import type { PolicyTimeline, ZoningView } from './policy/frame';
import type { Statics } from './statics';

// Imports are bound once, here: under Vite's module runner (the tests and the cost bench) every
// use of an imported name is a getter call (docs/dev/world-core.md, Cost).
const { lastInitiationMonth, piecewiseMonth, skipBounds } = inputModule;
const { P, drawOn, simEntity, streamOf } = rngModule;
const { exp, log } = mathModule;
const { MONTH_DAYS } = timeModule;
const { monthFirstDay, monthLastDay, monthOfDay } = monthsModule;

const rateMemo = new WeakMap<Precompute, Map<number, Float64Array>>();

/**
 * Per lot row, the log-survival rate of starting, `log(1 - h)` with
 * `h = 1 / (1 + exp(-(z + market)))` from `view.pre.logit` (0 where the logit is -Infinity): the
 * expression `precomputeOf` uses. Memoised per (`view.pre`, `market`); never reads `pre.log1mh`.
 */
export function startRates(view: ZoningView, market: number): Float64Array {
  let byMarket = rateMemo.get(view.pre);
  if (!byMarket) {
    byMarket = new Map();
    rateMemo.set(view.pre, byMarket);
  }
  let out = byMarket.get(market);
  if (!out) {
    const logit = view.pre.logit;
    out = new Float64Array(logit.length);
    for (let i = 0; i < logit.length; i++) {
      const z = logit[i];
      if (z === -Infinity) continue;
      out[i] = log(1 - 1 / (1 + exp(-(z + market))));
    }
    byMarket.set(market, out);
  }
  return out;
}

interface EntityMemo {
  entity: Uint32Array;
  have: Uint8Array;
}

const entityMemo = new WeakMap<ParcelId[], EntityMemo>();

/** `simEntity(statics.parcelId[lot])`, memoised per `statics.parcelId` array. */
export function lotEntity(statics: Statics, lot: number): number {
  let m = entityMemo.get(statics.parcelId);
  if (!m) {
    const n = statics.parcelId.length;
    m = { entity: new Uint32Array(n), have: new Uint8Array(n) };
    entityMemo.set(statics.parcelId, m);
  }
  if (m.have[lot] === 0) {
    m.entity[lot] = simEntity(statics.parcelId[lot]);
    m.have[lot] = 1;
  }
  return m.entity[lot];
}

/** A planned ordinary start. */
export interface OrdinaryStart {
  /** The start day. */
  day: Day;
  /** The model month holding `day`: the month the lot is due in. */
  month: number;
  /** The model month holding the first day of the lot-month in which the threshold passes. */
  frameMonth: number;
}

/**
 * The ordinary start of a lot free since day `r`, on attempt `k` (rules 5 and 6), evaluated when
 * `month` is the latest month whose frame may be read. Lot-month T runs from day
 * `r + 1 + floor((T - 1) * MONTH_DAYS)` on the frame of the model month holding that day: the
 * frame of `monthOfDay(r + 1)` (capped at `month`), then each frame change `c` with
 * `monthOfDay(r + 1) < c <= month` from lot-month `lastInitiationMonth(r, monthFirstDay(c) - 1) + 1`,
 * the last continuing without end. Empty segments are dropped and equal neighbouring rates
 * merged before `piecewiseMonth`, so a change that leaves the lot's rate alone gives exactly the
 * plan it had. Null when the threshold is never passed; in particular a lot whose rate is 0 under
 * every frame it reads is never planned (rule 6), where today's `ordinaryMonth` would fall back
 * to month 1. Never reads a frame above `month`.
 */
export function ordinaryStart(
  statics: Statics,
  timeline: PolicyTimeline,
  month: number,
  sh: number,
  lot: number,
  r: Day,
  k: number
): OrdinaryStart | null {
  const asOf = statics.asOf;
  const first = Math.min(monthOfDay(asOf, r + 1), month);
  const f0 = timeline.frameAt(first);
  const bounds: number[] = [];
  const rates: number[] = [startRates(f0.view, f0.market)[lot]];
  for (const c of timeline.changes()) {
    if (c <= first) continue;
    if (c > month) break;
    const f = timeline.frameAt(c);
    const rate = startRates(f.view, f.market)[lot];
    const bound = lastInitiationMonth(r, monthFirstDay(asOf, c) - 1);
    const last = rates.length - 1;
    // An empty segment: the new rate replaces the one that never ran.
    if (bounds.length > 0 && bound <= bounds[bounds.length - 1]) {
      rates[last] = rate;
      if (rates[last] === rates[last - 1]) {
        bounds.pop();
        rates.pop();
      }
      continue;
    }
    if (rate === rates[last]) continue;
    bounds.push(bound);
    rates.push(rate);
  }
  const stream = streamOf(sh, lotEntity(statics, lot), k);
  const T = piecewiseMonth(log(1 - drawOn(stream, P.INIT, 0)), bounds, rates);
  if (T === 0) return null;
  const lotMonthStart = r + 1 + Math.floor((T - 1) * MONTH_DAYS);
  const day = r + 1 + Math.floor((T - 1 + drawOn(stream, P.INIT_DAY, 0)) * MONTH_DAYS);
  return { day, month: monthOfDay(asOf, day), frameMonth: monthOfDay(asOf, lotMonthStart) };
}

const skipMemo = new WeakMap<PolicyTimeline, WeakMap<Statics, Map<string, Float64Array>>>();
const allLots = new WeakMap<Statics, Int32Array>();

/**
 * The skip shortcut (Decisions): per statics row, a bound on the `INIT` draw of a lot free since
 * the dataset date on attempt 0 above which its ordinary start, read through `month`, falls after
 * month `through`. It is `skipBounds` over the start rates of month 1's frame and of each change
 * `c <= month` from lot-month `lastInitiationMonth(asOf, monthFirstDay(c) - 1) + 1` (the segments
 * `ordinaryStart` walks), with `Tmax = lastInitiationMonth(asOf, monthLastDay(through))`: a draw
 * above it passes its threshold after lot-month `Tmax`, which begins after `through` ends.
 * Infinity where nothing is skipped. Memoised per (timeline, statics, last change `<= month`,
 * `through`); reads frames up to `month` only.
 */
export function skipBound(
  statics: Statics,
  timeline: PolicyTimeline,
  month: number,
  through: number
): Float64Array {
  let byStatics = skipMemo.get(timeline);
  if (!byStatics) {
    byStatics = new WeakMap();
    skipMemo.set(timeline, byStatics);
  }
  let memo = byStatics.get(statics);
  if (!memo) {
    memo = new Map();
    byStatics.set(statics, memo);
  }
  const asOf = statics.asOf;
  const changes: number[] = [];
  for (const c of timeline.changes()) {
    if (c <= 1) continue;
    if (c > month) break;
    changes.push(c);
  }
  // The bound reads only the changes up to `month`: every month from the last of them on shares it.
  const key = `${changes.length > 0 ? changes[changes.length - 1] : 1}:${through}`;
  let out = memo.get(key);
  if (out) return out;
  const f1 = timeline.frameAt(1);
  const views: Float64Array[] = [startRates(f1.view, f1.market)];
  const bounds: number[] = [];
  for (const c of changes) {
    const f = timeline.frameAt(c);
    bounds.push(lastInitiationMonth(asOf, monthFirstDay(asOf, c) - 1));
    views.push(startRates(f.view, f.market));
  }
  let lots = allLots.get(statics);
  if (!lots) {
    lots = Int32Array.from({ length: statics.parcelId.length }, (_, i) => i);
    allLots.set(statics, lots);
  }
  const Tmax = lastInitiationMonth(asOf, monthLastDay(asOf, through));
  out = skipBounds(views, lots, Tmax, bounds);
  memo.set(key, out);
  return out;
}

/** The `INIT` draw of `lot` on attempt `k`: what `ordinaryStart` compares with its threshold. */
export function initDraw(statics: Statics, sh: number, lot: number, k: number): number {
  return drawOn(streamOf(sh, lotEntity(statics, lot), k), P.INIT, 0);
}
