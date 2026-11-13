// The funding system world-core's hook calls (spec S12). This task fills `create`, `planLot`,
// `apply`, the ordinary-start side of `onProjectEvent` and the line's compaction; the money,
// serving, policy and shadow systems come with their own tasks.
import { ORIGIN_SIM, type FundingSystem, type StepCtx, type World } from '../types';
import { applyLots, leaveLine, planLotMonth } from './apply';
import { compactLine, fundOf, initFunding } from './columns';

/** Gives the world its funding columns when a timeline first offers money after month 1. */
function ensure(ctx: StepCtx): World {
  const world = ctx.world;
  if (!('gone' in world.line))
    initFunding(
      world,
      ctx.frame.finance!.pools.map((p) => p.id)
    );
  return world;
}

export function createFundingSystem(): FundingSystem {
  return {
    create(world, _statics, frame) {
      initFunding(
        world,
        frame.finance!.pools.map((p) => p.id)
      );
    },
    policyChanged(ctx) {
      ensure(ctx);
    },
    moneyIn(ctx) {
      ensure(ctx);
    },
    onProjectEvent(ctx, e) {
      // Rule 8: a lot's ordinary start takes both its applications off the line. Only identity
      // columns are read: the row's stage columns are not written yet at its `'start'`.
      if (e.kind !== 'start') return;
      const p = ensure(ctx).projects;
      if (p.origin[e.row] !== ORIGIN_SIM) return;
      leaveLine(fundOf(ctx.world).line, p.src[e.row]);
    },
    apply(ctx, lots) {
      ensure(ctx);
      applyLots(ctx, lots);
    },
    serve(ctx) {
      ensure(ctx);
    },
    shadow(ctx) {
      // System 7 runs last in every funded month: no `gone` row survives the step.
      compactLine(fundOf(ensure(ctx)).line);
    },
    planLot(ctx, lot) {
      return planLotMonth(ctx, lot);
    }
  };
}
