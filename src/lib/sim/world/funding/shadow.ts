// Shadow starts (spec rule 20): when an award pre-empts a lot's ordinary start, the lot keeps a
// shadow of the attempt it was on. In the month holding the ordinary start day that attempt would
// have had, the homes that start would have added are recorded on the funded row as displaced.
import { P, drawOn, seedHash, streamOf } from '$lib/sim/scenario/rng';
import { lotRow } from '../columns';
import { lotEntity, ordinaryStart, type OrdinaryStart } from '../rates';
import type { StepCtx } from '../types';
import { sizeIn } from './clocks';
import { addShadow, dropShadows, fundOf, type FundLine } from './columns';
import { compact } from './line-index';

/**
 * Records the shadow of an award about to start funded row `row` on free `lot`: the lot's attempt
 * k, the day r it became free (`lots.r`, never a respelled day of the line's spell table, which is
 * a funded clock's), and its existing homes now (0 once demolished). Called before the funded
 * start, whose chain may free the lot and start it again on a later attempt.
 */
export function shadowAward(ctx: StepCtx, line: FundLine, lot: number, row: number): void {
  const l = ctx.world.lots;
  const i = lotRow(l, lot);
  const k = i < 0 ? 0 : l.k[i];
  const r = i < 0 ? ctx.statics.asOf : l.r[i];
  const existing = i >= 0 && l.demolished[i] === 1 ? 0 : ctx.frame.view.parcels.existingUnits[lot];
  addShadow(line, lot, row, k, r, existing);
}

/** True when ascending `a` holds `v`. */
function holds(a: readonly number[], v: number): boolean {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo < a.length && a[lo] === v;
}

/**
 * System 7 (rule 20): each shadow's ordinary start, as `world-core` rule 6 plans it for the
 * shadow's attempt (`ordinaryStart` through `ctx.month`), is evaluated when it has not been yet
 * and in a month whose frame differs from last month's; between changes it cannot move. In the
 * month that holds its day the shadow calls `displace` with that day, its funded row and the homes
 * that start would have added (its size from the attempt's SIZE draw in the view `startRow` would
 * read, less the existing homes recorded at the award), and ends; when no size level gains a home
 * it ends without a `displace`. Nothing else ends a shadow: the funded project's exit and the lot
 * starting again leave it running on its own attempt. A planned month before `ctx.month` throws
 * (the due list's invariant). Then the line is compacted (amortized, `compact`).
 */
export function stepShadows(ctx: StepCtx): void {
  const { line } = fundOf(ctx.world);
  const { statics, timeline, month } = ctx;
  const changed = holds(timeline.changes(), month);
  const sh = seedHash(ctx.seed);
  const ended: number[] = [];
  for (let i = 0; i < line.shadowN; i++) {
    const lot = line.shadowLot[i];
    const k = line.shadowK[i];
    const r = line.shadowR[i];
    let s: OrdinaryStart | null = null;
    if (line.shadowMonth[i] === 0 || changed) {
      s = ordinaryStart(statics, timeline, month, sh, lot, r, k);
      line.shadowMonth[i] = s === null ? -1 : s.month;
    }
    const m = line.shadowMonth[i];
    if (m === -1 || m > month) continue;
    if (m < month)
      throw new Error(`stepShadows: lot ${lot}'s shadow start fell in month ${m}, before ${month}`);
    s ??= ordinaryStart(statics, timeline, month, sh, lot, r, k);
    if (s === null || s.month !== month)
      throw new Error(`stepShadows: lot ${lot}'s shadow start moved without a frame change`);
    ended.push(i);
    // The view and calibration `startRow` reads for this ordinary start (`world.ts`).
    const g = timeline.frameAt(Math.min(s.frameMonth, month));
    const existing = line.shadowExisting[i];
    const uS = drawOn(streamOf(sh, lotEntity(statics, lot), k), P.SIZE, 0);
    const size = sizeIn(statics, g.view, g.calibration, lot, existing, uS);
    if (size !== null) ctx.displace(line.shadowRow[i], lot, s.day, size.units - existing);
  }
  dropShadows(line, ended);
  // System 7 runs last in every funded month. Compaction is amortized (`compact`): on a long line
  // `gone` rows may survive the step; every reader of the line skips them.
  compact(line);
}
