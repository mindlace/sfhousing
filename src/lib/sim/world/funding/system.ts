// The funding system world-core's hook calls (spec S12): `create`, `planLot`, `policyChanged`,
// `apply`, `moneyIn`, `onProjectEvent` (ordinary starts and money events), `serve`, and `shadow`
// (shadow starts, then the line's compaction).
import type { PolicyTimeline } from '../policy/frame';
import type { Statics } from '../statics';
import {
  ORIGIN_SIM,
  type FundingSystem,
  type StepCtx,
  type World,
  type WorldOptions
} from '../types';
import { applyLots, leaveLine, planLotMonth } from './apply';
import { closedTimeline } from './closing';
import { fundOf, initFunding, type FundPools } from './columns';
import { policyChanged } from './policy';
import { moneyIn, moneyOnEvent } from './pools';
import { serveLine } from './serve';
import { stepShadows } from './shadow';

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
    beforeStep: closedOf,
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
    },
    planLot(ctx, lot) {
      return planLotMonth(ctx, lot);
    }
  };
}
