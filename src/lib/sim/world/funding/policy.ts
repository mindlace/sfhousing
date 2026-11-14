// A change of policy (spec rules 17, 18, 19): each waiting application re-made under the new
// frame as `remake` does (`funded.ts:1684-1720`), or lapsed, its kind starting a new spell on the
// month's first day (`respell`, `funded.ts:1033-1051`) and its lot planned again. Rule 19 needs no
// code here: `planLot` is pure, and world-core's system 1 replans the free lots before this runs.
import { seedHash } from '$lib/sim/scenario/rng';
import { lotRow } from '../columns';
import { plannedMonth } from '../due';
import { ordinaryStart } from '../rates';
import { LOT_FREE, type StepCtx, type World } from '../types';
import { planLotMonth, remakeRow } from './apply';
import { fundOf, poolRowOf } from './columns';
import { frameMoney, sameMoney } from './frame-money';

/** True when `lot` has no row or its row is `LOT_FREE` (the test `serve`'s lazy guard uses). */
function isFree(world: World, lot: number): boolean {
  const i = lotRow(world.lots, lot);
  return i < 0 || world.lots.state[i] === LOT_FREE;
}

/**
 * Plans each lot of `lots` (free, a kind just lapsed) again (rule 18): at the earlier of its
 * ordinary start and the month `planLot` now gives, when that is in this month or later. The core
 * planned every free lot before the lapse, with the lapsed kind still waiting, so this month is no
 * later than the one it holds (a safe put, `types.ts` `StepCtx.due`).
 */
export function planAgain(ctx: StepCtx, lots: readonly number[]): void {
  const { world, statics, timeline, month } = ctx;
  const sh = seedHash(ctx.seed);
  for (const lot of lots) {
    const li = lotRow(world.lots, lot);
    const r = li < 0 ? statics.asOf : world.lots.r[li];
    const k = li < 0 ? 0 : world.lots.k[li];
    const s = ordinaryStart(statics, timeline, month, sh, lot, r, k);
    const m = plannedMonth(s === null ? 0 : s.month, planLotMonth(ctx, lot), month);
    if (m > 0) ctx.due.put(lot, m);
  }
}

/**
 * System 1's funding part (rules 17-19), after world-core's own replanning. Every pool id of the
 * frame gets a pool row (a resumed world under an edited timeline meets ids it has never seen).
 * When the frame of the month before is the one the world last stepped and both the view and the
 * money identity (`sameMoney`) are unchanged, nothing else happens. Otherwise, in line order, each
 * waiting row is re-made or lapses (`remakeRow`); a row whose lot is no longer free (rule 8's lazy
 * guard, `serve.ts`) just leaves the line, its lot never put on the due list. Lots with a kind
 * lapsed are planned again (`planAgain`).
 *
 * The core calls no hook in a month whose frame has `finance` null, and within one timeline
 * `finance` is null in every month or in none (`policy/money.ts:118`): `ctx.frame.finance` is set.
 * The month-before test reads `world.frame` as well as `frameAt(month - 1)` because a world
 * resumed under another timeline last stepped a frame that timeline may not hold: its rows were
 * made under money this frame cannot be compared with, so they are all re-made.
 */
export function policyChanged(ctx: StepCtx): void {
  const { world, timeline, frame, month } = ctx;
  const { line, pools } = fundOf(world);
  for (const p of frame.finance!.pools) poolRowOf(pools, p.id);
  const before = timeline.frameAt(Math.max(1, month - 1));
  if (before.id === world.frame && before.view === frame.view && sameMoney(before, frame, timeline))
    return;
  const fm = frameMoney(timeline, frame);
  const lapsed = new Set<number>();
  let changed = false;
  for (let i = 0; i < line.n; i++) {
    if (line.gone[i] === 1) continue;
    changed = true;
    const lot = line.lot[i];
    if (!isFree(world, lot)) {
      line.gone[i] = 1;
      continue;
    }
    if (remakeRow(ctx, fm, line, i)) lapsed.add(lot);
  }
  // After the writes: the line's indices (`line-index.ts`) are rebuilt from the rows.
  if (changed) line.version++;
  planAgain(ctx, [...lapsed]);
}
