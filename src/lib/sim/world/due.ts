import { seedHash } from '$lib/sim/scenario/rng';
import { monthFirstDay, monthLastDay } from './months';
import { dueMonthOf } from './pipeline';
import type { PolicyTimeline } from './policy/frame';
import { initDraw, ordinaryStart, skipBound, startRates } from './rates';
import type { Statics } from './statics';
import {
  LOT_FREE,
  type Due,
  type FundingSystem,
  type StepCtx,
  type StepSink,
  type World
} from './types';

/**
 * What is due in which model month (S11). Not part of the world: it holds a map and may be
 * rebuilt at any time by `planDue`. An entity is due in at most one month; nothing is kept past
 * `through`.
 */
export class DueList implements Due {
  private readonly month = new Map<number, number>();
  private readonly buckets = new Map<number, number[]>();

  constructor(readonly through: number) {}

  /** Entities due in `month`, ascending; they are forgotten. */
  take(month: number): Int32Array {
    const bucket = this.buckets.get(month);
    if (!bucket) return new Int32Array(0);
    this.buckets.delete(month);
    const live: number[] = [];
    for (const e of bucket) if (this.month.get(e) === month) live.push(e);
    live.sort((a, b) => a - b);
    const out: number[] = [];
    for (let i = 0; i < live.length; i++) {
      if (i > 0 && live[i] === live[i - 1]) continue;
      out.push(live[i]);
      this.month.delete(live[i]);
    }
    return Int32Array.from(out);
  }

  /** Makes `entity` due in `month`, replacing any earlier month; nothing after `through`. */
  put(entity: number, month: number): void {
    if (month > this.through) {
      this.month.delete(entity);
      return;
    }
    this.month.set(entity, month);
    const bucket = this.buckets.get(month);
    if (bucket) bucket.push(entity);
    else this.buckets.set(month, [entity]);
  }

  drop(entity: number): void {
    this.month.delete(entity);
  }
}

/**
 * What is due in months `world.month + 1 .. through`, worked out from the world alone (S11): each
 * live row at the month of its stage end, each master at the month of its next phase filing, and
 * every free lot (no row: free since the dataset date on attempt 0; a row in `LOT_FREE`) at the
 * month of its ordinary start, reading frames up to `world.month + 1` only. A lot with no row whose
 * `INIT` draw is above its `skipBound` starts after `through` and is passed over unplanned.
 */
export function planDue(
  world: World,
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number,
  through: number
): DueList {
  return planDueWith(world, statics, timeline, seed, through, { skip: true });
}

/**
 * `planDue`, with the skip shortcut on or off (a test seam: the two give the same list) and with a
 * funding system. With `funding` set and `frameAt(world.month + 1).finance` non-null, every free lot
 * is planned at `plannedMonth(ordinary month, funding.planLot(ctx, lot), world.month + 1)` (S12),
 * `ctx` being `planCtx`'s: the skip shortcut and the zero-rate filter then only spare the ordinary
 * clock, and `planLot` is asked for every free lot.
 */
export function planDueWith(
  world: World,
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number,
  through: number,
  opts: { skip: boolean; funding?: FundingSystem | null }
): DueList {
  const due = new DueList(through);
  const p = world.projects;
  for (let row = 0; row < p.n; row++) {
    const m = dueMonthOf(world, statics.asOf, row);
    if (m === 0) continue;
    if (m <= world.month)
      throw new Error(`planDue: row ${row} is due in month ${m}, already stepped`);
    due.put(-1 - row, m);
  }
  planLots(world, statics, timeline, seed, due, opts.skip, opts.funding ?? null);
  return due;
}

/**
 * The month a free lot is put at: its ordinary month `ord` (0 = none), or the month `apply` that
 * `FundingSystem.planLot` gave when that is earlier and not before `from`, the first month in which
 * the lot can still apply (S12: "a free lot is planned at min(ordinary month, planLot || Infinity)").
 * An `apply` before `from` is a month whose system 4 has already run, and is not counted. 0 when
 * neither counts.
 */
export function plannedMonth(ord: number, apply: number, from: number): number {
  const a = apply >= from ? apply : 0;
  if (ord === 0) return a;
  if (a === 0) return ord;
  return Math.min(ord, a);
}

const DROP: StepSink = { event() {} };

/**
 * The context `planDue` gives `planLot` (S12): month `world.month + 1`, its frame and days, the due
 * list being built, a sink that drops events, and `startProject` and `displace` that throw.
 */
export function planCtx(
  world: World,
  due: Due,
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number
): StepCtx {
  const month = world.month + 1;
  return {
    world,
    due,
    statics,
    timeline,
    frame: timeline.frameAt(month),
    month,
    seed,
    out: DROP,
    firstDay: monthFirstDay(statics.asOf, month),
    lastDay: monthLastDay(statics.asOf, month),
    startProject() {
      throw new Error('planLot: no project starts while the due list is planned');
    },
    displace() {
      throw new Error('planLot: nothing is displaced while the due list is planned');
    }
  };
}

/**
 * Calls `visit(lot, r, k, rowless, never)` for every free lot in ascending lot order: a lot with no
 * row (`rowless`: free since the dataset date on attempt 0) and a row in `LOT_FREE` (its own `r`
 * and `k`). A lot with no row to which every frame from month 1 through `month` gives a zero start
 * rate has lived through all of them and never starts on its ordinary clock: it is left out, or,
 * with `all` (a funded month, where it may still apply), visited with `never` true. Reads frames up
 * to `month` only.
 */
export function eachFreeLot(
  world: World,
  statics: Statics,
  timeline: PolicyTimeline,
  month: number,
  visit: (lot: number, r: number, k: number, rowless: boolean, never: boolean) => void,
  all = false
): void {
  const rates = [timeline.frameAt(1)];
  for (const c of timeline.changes()) if (c > 1 && c <= month) rates.push(timeline.frameAt(c));
  const rateRows = rates.map((f) => startRates(f.view, f.market));
  const l = world.lots;
  let next = 0;
  for (let lot = 0; lot < statics.parcelId.length; lot++) {
    if (next < l.n && l.lot[next] === lot) {
      const i = next++;
      if (l.state[i] === LOT_FREE) visit(lot, l.r[i], l.k[i], false, false);
    } else if (rateRows.some((a) => a[lot] < 0)) visit(lot, statics.asOf, 0, true, false);
    else if (all) visit(lot, statics.asOf, 0, true, true);
  }
}

/**
 * Puts every free lot at the month of its ordinary start (rules 5 and 6); with `skip`, a lot with
 * no row whose `INIT` draw is above its `skipBound` is passed over (it starts after `through`,
 * where `put` would record nothing). With a funding system in force in month `world.month + 1`,
 * each free lot is put at `plannedMonth` of its ordinary month and `planLot`'s answer.
 */
function planLots(
  world: World,
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number,
  due: DueList,
  skip: boolean,
  funding: FundingSystem | null
): void {
  const month = world.month + 1;
  const sh = seedHash(seed);
  const bound = skip ? skipBound(statics, timeline, month, due.through) : null;
  const fund = funding !== null && timeline.frameAt(month).finance !== null ? funding : null;
  const ctx = fund === null ? null : planCtx(world, due, statics, timeline, seed);
  eachFreeLot(
    world,
    statics,
    timeline,
    month,
    (lot, r, k, rowless, never) => {
      let ord = 0;
      if (!never && !(bound !== null && rowless && initDraw(statics, sh, lot, 0) > bound[lot])) {
        const s = ordinaryStart(statics, timeline, month, sh, lot, r, k);
        if (s !== null) {
          if (s.month <= world.month) {
            throw new Error(`planDue: lot ${lot} starts in month ${s.month}, already stepped`);
          }
          ord = s.month;
        }
      }
      const m = plannedMonth(ord, fund === null ? 0 : fund.planLot(ctx!, lot), month);
      if (m > 0) due.put(lot, m);
    },
    fund !== null
  );
}
