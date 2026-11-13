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

const FIRST_BUCKET = 64;

/** `a` grown to at least `n` entries (doubling), the new ones 0. */
function atLeast(a: Int32Array, n: number): Int32Array {
  let cap = Math.max(FIRST_BUCKET, a.length * 2);
  while (cap < n) cap *= 2;
  const next = new Int32Array(cap);
  next.set(a);
  return next;
}

/**
 * What is due in which model month (S11). Not part of the world: it may be rebuilt at any time by
 * `planDue`. An entity is due in at most one month; nothing is kept past `through`.
 *
 * Each entity's month is kept in a typed array (lots by lot, projects by row; 0 = not due), and
 * each month's entities in a growable bucket. Moving or dropping an entity leaves its old bucket
 * entry behind; `take` keeps only the entries whose entity is still due in that month.
 */
export class DueList implements Due {
  /** Month each lot is due in, by lot; 0 = none. */
  private lotMonth: Int32Array;
  /** Month each project is due in, by row; 0 = none. */
  private rowMonth = new Int32Array(0);
  /** Entities put in each month (stale ones included), and how many. */
  private readonly buckets: (Int32Array | undefined)[] = [];
  private readonly sizes: number[] = [];

  /** `lots`: how many lots to make room for at once (they grow as needed). */
  constructor(
    readonly through: number,
    lots = 0
  ) {
    this.lotMonth = new Int32Array(lots);
  }

  private monthOf(entity: number): number {
    if (entity >= 0) return entity < this.lotMonth.length ? this.lotMonth[entity] : 0;
    const row = -1 - entity;
    return row < this.rowMonth.length ? this.rowMonth[row] : 0;
  }

  private setMonth(entity: number, month: number): void {
    if (entity >= 0) {
      if (entity >= this.lotMonth.length) {
        if (month === 0) return;
        this.lotMonth = atLeast(this.lotMonth, entity + 1);
      }
      this.lotMonth[entity] = month;
    } else {
      const row = -1 - entity;
      if (row >= this.rowMonth.length) {
        if (month === 0) return;
        this.rowMonth = atLeast(this.rowMonth, row + 1);
      }
      this.rowMonth[row] = month;
    }
  }

  /** Entities due in `month`, ascending; they are forgotten. */
  take(month: number): Int32Array {
    const bucket = this.buckets[month];
    if (bucket === undefined) return new Int32Array(0);
    const size = this.sizes[month];
    this.buckets[month] = undefined;
    this.sizes[month] = 0;
    const out = new Int32Array(size);
    let n = 0;
    for (let i = 0; i < size; i++) {
      const e = bucket[i];
      // Forgetting the entity at its first entry also passes over any repeat of it.
      if (this.monthOf(e) !== month) continue;
      out[n++] = e;
      this.setMonth(e, 0);
    }
    return (n === size ? out : out.slice(0, n)).sort();
  }

  /**
   * Makes `entity` due in `month` (a model month, 1 or later), replacing any earlier month; nothing
   * after `through`.
   */
  put(entity: number, month: number): void {
    if (month > this.through) {
      this.setMonth(entity, 0);
      return;
    }
    if (!(month >= 1) || !Number.isInteger(month)) {
      throw new RangeError(`DueList.put: month ${month} is not a model month`);
    }
    this.setMonth(entity, month);
    let bucket = this.buckets[month];
    let size = this.sizes[month] ?? 0;
    if (bucket === undefined) {
      bucket = new Int32Array(FIRST_BUCKET);
      this.buckets[month] = bucket;
      size = 0;
    } else if (size === bucket.length) {
      bucket = atLeast(bucket, size + 1);
      this.buckets[month] = bucket;
    }
    bucket[size] = entity;
    this.sizes[month] = size + 1;
  }

  drop(entity: number): void {
    this.setMonth(entity, 0);
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
  const due = new DueList(through, statics.parcelId.length);
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
  const rowOf = l.rowOf;
  for (let lot = 0; lot < statics.parcelId.length; lot++) {
    const i = lot < rowOf.length ? rowOf[lot] - 1 : -1;
    if (i >= 0) {
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
