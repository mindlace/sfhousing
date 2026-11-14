// The per-lot eligibility skip (perf, Task 12): a kind no frame of a lot's spell can fund (no
// offer of the kind, no chance in the view, or the lot's largest size below the least `minHomes`
// offered) gets no clock. Exact: runs with and without the skip give the same events, ledger and
// world, and every skipped (lot, kind) has a clock with no day.
import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import { seedHash } from '$lib/sim/scenario/rng';
import type { ProjectKind } from '$lib/timelapse/types';
import type { PolicyFrame, PolicyTimeline } from '../policy/frame';
import { frameIdOf } from '../policy/intern';
import { staticsOf, type Statics } from '../statics';
import type { FundingSystem, StepSink, World } from '../types';
import { withFunding } from '../world';
import { ELIGIBILITY, fundableAny, spellsOf } from './apply';
import { kindClock } from './clocks';
import { createFundingSystem } from './system';
import { benchFunded } from './test/cities.node';
import {
  fundedMini,
  moneyTimeline,
  oneMoneyTimeline,
  randomFinance,
  type MonthEvent
} from './test/fixtures';

const KINDS: readonly ProjectKind[] = ['market', 'affordable'];

interface Run {
  world: World;
  events: MonthEvent[];
  ledger: LedgerEvent[];
}

function run(
  f: FundingSystem,
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number,
  through: number,
  skip: boolean
): Run {
  const events: MonthEvent[] = [];
  const ledger: LedgerEvent[] = [];
  let month = 0;
  const out: StepSink = {
    event: (e) => events.push({ ...e, month }),
    ledger: (e) => ledger.push(e)
  };
  ELIGIBILITY.skip = skip;
  try {
    const core = withFunding(f);
    const world = core.createWorld(statics, timeline, seed, out);
    const due = core.planDue(world, statics, timeline, seed, through);
    for (let m = 1; m <= through; m++) {
      month = m;
      core.step(world, due, statics, timeline, seed, out);
    }
    return { world, events, ledger };
  } finally {
    ELIGIBILITY.skip = true;
  }
}

function same(statics: Statics, timeline: PolicyTimeline, seed: number, through: number): Run {
  const a = run(createFundingSystem(), statics, timeline, seed, through, false);
  const b = run(createFundingSystem(), statics, timeline, seed, through, true);
  expect(b.events).toEqual(a.events);
  expect(b.ledger).toEqual(a.ledger);
  expect(b.world).toEqual(a.world);
  return b;
}

/** The funding system whose `planLot` checks every skipped kind's clock has no day; counts them. */
function checkingSystem(count: { skipped: number; asked: number }): FundingSystem {
  const f = createFundingSystem();
  const inner = f.planLot;
  f.planLot = (ctx, lot) => {
    const spells = spellsOf(ctx, lot);
    for (const kind of KINDS) {
      count.asked++;
      if (fundableAny(ctx, spells[kind].r, kind, lot)) continue;
      count.skipped++;
      const c = kindClock(
        ctx.statics,
        ctx.timeline,
        ctx.month,
        seedHash(ctx.seed),
        spells[kind],
        kind
      );
      expect(c.day).toBeNull();
    }
    return inner(ctx, lot);
  };
  return f;
}

describe('the eligibility skip on the mini city, random finances', () => {
  const input = fundedMini();
  const statics = staticsOf(input);

  it.each([1, 2, 3])('finance %i, 480 months: the same with and without the skip', (n) => {
    const finance = randomFinance(n);
    const t = oneMoneyTimeline({ ...input, finance }, finance);
    same(statics, t, n, 480);
    const count = { skipped: 0, asked: 0 };
    run(checkingSystem(count), statics, t, n, 120, true);
    expect(count.asked).toBeGreaterThan(0);
  });
});

describe.each([['baseline'], ['bench']] as const)(
  'the eligibility skip on synthCity, %s money',
  (set) => {
    const { input, doc } = benchFunded(set);
    const statics = staticsOf(input);
    const timeline = moneyTimeline(input, doc);

    it.each([1, 2, 3])(`synthCity ${set} seed %i, 24 months: the same with and without`, (seed) => {
      const got = same(statics, timeline, seed, 24);
      expect(got.events.some((e) => e.kind === 'award')).toBe(true);
    });

    it(`synthCity ${set} seed 1, 6 months: every skipped kind's clock has no day`, () => {
      const count = { skipped: 0, asked: 0 };
      run(checkingSystem(count), statics, timeline, 1, 6, true);
      // Many lots cannot be funded: the skip is not vacuous.
      expect(count.skipped).toBeGreaterThan(count.asked / 10);
    });
  }
);

/** `t` with every frame from `month` on under another id: every free lot is planned again then. */
function replanAt(t: PolicyTimeline, month: number): PolicyTimeline {
  const moved = new Map<number, PolicyFrame>();
  const changes = [...new Set([...t.changes(), month])].sort((a, b) => a - b);
  return {
    frameAt(m) {
      const f = t.frameAt(m);
      if (m < month) return f;
      let g = moved.get(m);
      if (g === undefined) {
        g = { ...f, id: frameIdOf(`replan-probe|${f.id}`) };
        moved.set(m, g);
      }
      return g;
    },
    changes: () => changes,
    touched: (m) => (m === month ? null : t.touched(m)),
    readyThrough: () => t.readyThrough()
  };
}

describe('eligibility before spells, synthCity bench set, a replan month', () => {
  const { input, doc } = benchFunded('bench');
  const statics = staticsOf(input);
  const REPLAN = 6;
  const timeline = replanAt(moneyTimeline(input, doc), REPLAN);

  it.each([1, 2, 3])('seed %i: the early return never changes planLot’s answer', (seed) => {
    const count = { asked: 0, differ: 0, inReplan: 0 };
    const f = createFundingSystem();
    const inner = f.planLot;
    f.planLot = (ctx, lot) => {
      const early = inner(ctx, lot);
      ELIGIBILITY.early = false;
      try {
        if (inner(ctx, lot) !== early) count.differ++;
      } finally {
        ELIGIBILITY.early = true;
      }
      count.asked++;
      if (ctx.month === REPLAN) count.inReplan++;
      return early;
    };
    run(f, statics, timeline, seed, REPLAN, true);
    expect(count.differ).toBe(0);
    // planDue and the replan month ask every free lot.
    expect(count.inReplan).toBeGreaterThan(100_000);
  });
});
