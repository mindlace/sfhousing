// The funding system world-core's hook calls (spec S12): `create`, `planLot`, `policyChanged`,
// `apply`, `moneyIn`, `onProjectEvent` (ordinary starts and money events), `serve`, and `shadow`
// (shadow starts, then the line's compaction, then `recordWaiting` records the homes waiting).
import type { PolicyTimeline } from '../policy/frame';
import type { Statics } from '../statics';
import {
  ORIGIN_SIM,
  type FundingSystem,
  type StepCtx,
  type World,
  type WorldOptions
} from '../types';
import { lotRow } from '../columns';
import { applyLots, leaveLine, planLotMonth } from './apply';
import { closedTimeline, reopenArrivals } from './closing';
import { fundOf, initFunding, type FundLine, type FundPools } from './columns';
import { lineIndex, rowOfSeq } from './line-index';
import { policyChanged } from './policy';
import { moneyIn, moneyOnEvent } from './pools';
import { serveLine } from './serve';
import { stepShadows } from './shadow';
import * as typesModule from '../types';

// Imports are bound once, here: under Vite's module runner every use of an imported name is a
// getter call (docs/dev/world-core.md, Cost).
const { LOT_FREE } = typesModule;
const lotRowOf = lotRow;
const lineIndexOf = lineIndex;
const rowOfSeqIn = rowOfSeq;

/** Homes in the applications waiting in the line now. 0 for a world without funding columns. */
export function waitingHomes(world: World): number {
  if (!('gone' in world.line)) return 0;
  const line = world.line as FundLine;
  const lots = world.lots;
  let sum = 0;
  for (const [lot, members] of lineIndexOf(line).byLot) {
    // Rule 8's lazy guard, the same test as serveRow's: a lot no longer free waits for nothing.
    const li = lotRowOf(lots, lot);
    if (li >= 0 && lots.state[li] !== LOT_FREE) continue;
    // A lot with two applications counts once, by the larger.
    let most = 0;
    for (const m of members) {
      const i = rowOfSeqIn(line, m.seq);
      if (i < 0 || line.gone[i] === 1) continue;
      if (line.units[i] > most) most = line.units[i];
    }
    sum += most;
  }
  return sum;
}

/**
 * Records `waitingHomes(world)` as model month `month`'s. Called once per funded step, last. Months
 * between the last one recorded and `month` took no hook, so they keep the last value.
 */
export function recordWaiting(world: World, month: number): void {
  if (!('gone' in world.line)) return;
  const line = world.line as FundLine;
  const t = line.waitThrough;
  if (month <= t) throw new Error(`recordWaiting: month ${month} is not after month ${t}`);
  if (line.waitHomes.length <= month) {
    const next = new Int32Array(Math.max(month + 1, 2 * line.waitHomes.length, 8));
    next.set(line.waitHomes);
    line.waitHomes = next;
  }
  const last = line.waitHomes[t];
  for (let m = t + 1; m < month; m++) line.waitHomes[m] = last;
  line.waitHomes[month] = waitingHomes(world);
  line.waitThrough = month;
}

/**
 * Gives the world its funding columns when a timeline first offers money after month 1. The core
 * calls no hook in a month whose frame has `finance` null, so `ctx.frame.finance` is set here.
 */
function ensure(ctx: StepCtx): World {
  const world = ctx.world;
  if (!('gone' in world.line))
    initFunding(
      world,
      ctx.frame.finance!.pools.map((p) => p.id)
    );
  return world;
}

/**
 * The world steps and plans under the closed view of its closings (`closedTimeline`): `timeline`
 * itself in a world without funding columns or without a closing.
 */
function closedOf(world: World, statics: Statics, timeline: PolicyTimeline): PolicyTimeline {
  if (!('shutN' in world.pools)) return timeline;
  const pools = world.pools as FundPools;
  if (pools.shutN === 0) return timeline;
  return closedTimeline(timeline, pools, statics.asOf);
}

/**
 * The funding system. `opts.poolClosing` (default true) closes spent pools in system 5 and steps
 * and plans the world under its closings' view; false serves as the older engine does, an
 * application waiting on a spent pool.
 */
export function createFundingSystem(opts: WorldOptions = {}): FundingSystem {
  const closing = opts.poolClosing !== false;
  return {
    beforeStep(world, statics, timeline) {
      // A closed pool opens on its next arrival, before the month's view is taken.
      reopenArrivals(world, statics, timeline);
      return closedOf(world, statics, timeline);
    },
    timelineOf: closedOf,
    create(world, _statics, frame) {
      initFunding(
        world,
        frame.finance!.pools.map((p) => p.id)
      );
    },
    policyChanged(ctx) {
      ensure(ctx);
      policyChanged(ctx);
    },
    moneyIn(ctx) {
      ensure(ctx);
      moneyIn(ctx);
    },
    onProjectEvent(ctx, e) {
      ensure(ctx);
      // Rule 13: a funded row's money moves at its own events.
      if (e.kind !== 'start') {
        moneyOnEvent(ctx, e);
        return;
      }
      // Rule 8: a lot's ordinary start takes both its applications off the line. Only identity
      // columns are read: the row's stage columns are not written yet at its `'start'`.
      const p = ctx.world.projects;
      if (p.origin[e.row] !== ORIGIN_SIM) return;
      leaveLine(fundOf(ctx.world).line, p.src[e.row]);
    },
    apply(ctx, lots) {
      ensure(ctx);
      applyLots(ctx, lots);
    },
    serve(ctx) {
      ensure(ctx);
      serveLine(ctx, { closing });
    },
    shadow(ctx) {
      ensure(ctx);
      stepShadows(ctx);
      recordWaiting(ctx.world, ctx.month);
    },
    planLot(ctx, lot) {
      return planLotMonth(ctx, lot);
    }
  };
}
