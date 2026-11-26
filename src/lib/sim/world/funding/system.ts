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
import { policyChanged } from './policy';
import { moneyIn, moneyOnEvent } from './pools';
import { serveLine } from './serve';
import { stepShadows } from './shadow';
import * as typesModule from '../types';

// Imports are bound once, here: under Vite's module runner every use of an imported name is a
// getter call (docs/dev/world-core.md, Cost).
const { LOT_FREE } = typesModule;
const lotRowOf = lotRow;

// Per-lot scratch for waitingHomes, outside any world: `seenAt[lot] === stamp` marks a lot met in
// this call, `bestOf[lot]` its largest units so far. Grown (doubling) only when a lot id is past
// the end, so a month allocates nothing.
let seenAt = new Int32Array(0);
let bestOf = new Int32Array(0);
let stamp = 0;

/** Homes in the applications waiting in the line now. 0 for a world without funding columns. */
export function waitingHomes(world: World): number {
  if (!('gone' in world.line)) return 0;
  const line = world.line as FundLine;
  const lots = world.lots;
  const n = line.n;
  const lotCol = line.lot;
  const gone = line.gone;
  const units = line.units;
  if (stamp >= 0x7fffffff) {
    seenAt.fill(0);
    stamp = 0;
  }
  stamp++;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (gone[i] === 1) continue;
    const lot = lotCol[i];
    if (lot >= seenAt.length) {
      const size = Math.max(lot + 1, 2 * seenAt.length, 1024);
      const nextSeen = new Int32Array(size);
      nextSeen.set(seenAt);
      seenAt = nextSeen;
      const nextBest = new Int32Array(size);
      nextBest.set(bestOf);
      bestOf = nextBest;
    }
    const u = units[i] > 0 ? units[i] : 0;
    if (seenAt[lot] === stamp) {
      // A lot with two applications counts once, by the larger.
      if (u > bestOf[lot]) {
        sum += u - bestOf[lot];
        bestOf[lot] = u;
      }
      continue;
    }
    // Rule 8's lazy guard, the same test as serveRow's: a lot no longer free waits for nothing.
    const li = lotRowOf(lots, lot);
    if (li >= 0 && lots.state[li] !== LOT_FREE) continue;
    seenAt[lot] = stamp;
    bestOf[lot] = u;
    sum += u;
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
