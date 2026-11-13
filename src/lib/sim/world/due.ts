import { seedHash } from '$lib/sim/scenario/rng';
import { dueMonthOf } from './pipeline';
import type { PolicyTimeline } from './policy/frame';
import { initDraw, ordinaryStart, skipBound, startRates } from './rates';
import type { Statics } from './statics';
import { LOT_FREE, type Due, type World } from './types';

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

/** `planDue`, with the skip shortcut on or off (a test seam: the two give the same list). */
export function planDueWith(
  world: World,
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number,
  through: number,
  opts: { skip: boolean }
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
  planLots(world, statics, timeline, seed, due, opts.skip);
  return due;
}

/**
 * Calls `visit(lot, r, k, rowless)` for every free lot in ascending lot order: a lot with no row
 * (`rowless`: free since the dataset date on attempt 0) and a row in `LOT_FREE` (its own `r` and
 * `k`). A lot with no row is left out when every frame from month 1 through `month` gives it a
 * zero start rate: it has lived through all of them and never starts. Reads frames up to `month`
 * only.
 */
export function eachFreeLot(
  world: World,
  statics: Statics,
  timeline: PolicyTimeline,
  month: number,
  visit: (lot: number, r: number, k: number, rowless: boolean) => void
): void {
  const rates = [timeline.frameAt(1)];
  for (const c of timeline.changes()) if (c > 1 && c <= month) rates.push(timeline.frameAt(c));
  const rateRows = rates.map((f) => startRates(f.view, f.market));
  const l = world.lots;
  let next = 0;
  for (let lot = 0; lot < statics.parcelId.length; lot++) {
    if (next < l.n && l.lot[next] === lot) {
      const i = next++;
      if (l.state[i] === LOT_FREE) visit(lot, l.r[i], l.k[i], false);
    } else if (rateRows.some((a) => a[lot] < 0)) visit(lot, statics.asOf, 0, true);
  }
}

/**
 * Puts every free lot at the month of its ordinary start (rules 5 and 6); with `skip`, a lot with
 * no row whose `INIT` draw is above its `skipBound` is passed over (it starts after `through`,
 * where `put` would record nothing).
 */
function planLots(
  world: World,
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number,
  due: DueList,
  skip: boolean
): void {
  const month = world.month + 1;
  const sh = seedHash(seed);
  const bound = skip ? skipBound(statics, timeline, month, due.through) : null;
  eachFreeLot(world, statics, timeline, month, (lot, r, k, rowless) => {
    if (bound !== null && rowless && initDraw(statics, sh, lot, 0) > bound[lot]) return;
    const s = ordinaryStart(statics, timeline, month, sh, lot, r, k);
    if (s === null) return;
    if (s.month <= world.month) {
      throw new Error(`planDue: lot ${lot} starts in month ${s.month}, already stepped`);
    }
    due.put(lot, s.month);
  });
}
