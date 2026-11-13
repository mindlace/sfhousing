// world-funding Task 8a: grouped serving (the rule 1 decision). The grouped scan awards the same
// rows, on the same days, in the same order, with the same ledger and the same world as the direct
// scan (`serveLine(ctx, { grouped: false })`), and asks the award rule fewer times.
import { describe, expect, it, vi } from 'vitest';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import type { PolicyTimeline } from '../policy/frame';
import { staticsOf, type Statics } from '../statics';
import { benchInput } from '../test/cities.node';
import type { FundingSystem, StepSink, World } from '../types';
import { withFunding } from '../world';
import { emptyWorld } from '../columns';
import { leaveLine } from './apply';
import { KIND_AFFORDABLE, KIND_MARKET, addLineRow, fundOf, initFunding } from './columns';
import { compact, isWaiting } from './line-index';
import { serveLine } from './serve';
import { createFundingSystem } from './system';
import {
  benchFunded,
  fundedMini,
  oneMoneyTimeline,
  randomFinance,
  type MonthEvent
} from './test/fixtures';

/** Calls of the award rule's probe, counted through the real one. */
const probes = vi.hoisted(() => ({ n: 0 }));
vi.mock('$lib/sim/scenario/funding', async (importOriginal) => {
  const mod = await importOriginal<typeof import('$lib/sim/scenario/funding')>();
  return {
    ...mod,
    awardPasses: (...a: Parameters<typeof mod.awardPasses>) => {
      probes.n++;
      return mod.awardPasses(...a);
    }
  };
});

const MONTHS = 480;
const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

/** The funding system serving by the direct scan. */
function directSystem(): FundingSystem {
  return { ...createFundingSystem(), serve: (ctx) => serveLine(ctx, { grouped: false }) };
}

interface Run {
  world: World;
  events: MonthEvent[];
  ledger: LedgerEvent[];
  probes: number;
}

function run(
  system: FundingSystem,
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number,
  through: number
): Run {
  const events: MonthEvent[] = [];
  const ledger: LedgerEvent[] = [];
  let month = 0;
  const out: StepSink = {
    event: (e) => events.push({ ...e, month }),
    ledger: (e) => ledger.push(e)
  };
  const core = withFunding(system);
  const world = core.createWorld(statics, timeline, seed, out);
  const due = core.planDue(world, statics, timeline, seed, through);
  const before = probes.n;
  for (let m = 1; m <= through; m++) {
    month = m;
    core.step(world, due, statics, timeline, seed, out);
  }
  return { world, events, ledger, probes: probes.n - before };
}

const awards = (r: Run) => r.events.filter((e) => e.kind === 'award').length;

describe('8a: grouped serving awards the same rows on the same days as the direct scan', () => {
  const input = fundedMini();
  const statics = staticsOf(input);
  let awarded = 0;

  it.each(seeds(20))(
    'mini city, random finance %i, 480 months: same events, ledger, world',
    (n) => {
      const finance = randomFinance(n);
      const timeline = oneMoneyTimeline({ ...input, finance }, finance);
      const a = run(directSystem(), statics, timeline, n, MONTHS);
      const b = run(createFundingSystem(), statics, timeline, n, MONTHS);
      expect(b.events).toEqual(a.events);
      expect(b.ledger).toEqual(a.ledger);
      expect(b.world).toEqual(a.world);
      awarded += awards(a);
    }
  );

  it('over the 20 finances: awards were made', () => {
    expect(awarded).toBeGreaterThan(0);
  });

  it.each([2, 7, 19])(
    'random finance %i: a structuredClone at month 24 steps as the original, whose caches are warm',
    (n) => {
      const finance = randomFinance(n);
      const timeline = oneMoneyTimeline({ ...input, finance }, finance);
      const core = withFunding(createFundingSystem());
      const NOWHERE: StepSink = { event() {} };
      const world = core.createWorld(statics, timeline, n, NOWHERE);
      const due = core.planDue(world, statics, timeline, n, MONTHS);
      for (let m = 1; m <= 24; m++) core.step(world, due, statics, timeline, n, NOWHERE);
      const copy = structuredClone(world);
      const copyDue = core.planDue(copy, statics, timeline, n, MONTHS);
      const tail = (w: World, d: typeof due) => {
        const events: MonthEvent[] = [];
        const ledger: LedgerEvent[] = [];
        let month = 0;
        const out: StepSink = {
          event: (e) => events.push({ ...e, month }),
          ledger: (e) => ledger.push(e)
        };
        for (let m = 25; m <= MONTHS; m++) {
          month = m;
          core.step(w, d, statics, timeline, n, out);
        }
        return { events, ledger };
      };
      const a = tail(world, due);
      const b = tail(copy, copyDue);
      expect(b.events).toEqual(a.events);
      expect(b.ledger).toEqual(a.ledger);
      expect(copy).toEqual(world);
    }
  );
});

describe('the line index', () => {
  it('a row added outside joinLine (the version moves) is seen: the index is rebuilt', () => {
    const w = emptyWorld(0);
    initFunding(w, ['p']);
    const { line } = fundOf(w);
    expect(isWaiting(line, 5, KIND_AFFORDABLE)).toBe(false);
    const r = addLineRow(line);
    line.lot[r] = 5;
    line.kind[r] = KIND_AFFORDABLE;
    expect(isWaiting(line, 5, KIND_AFFORDABLE)).toBe(true);
    expect(isWaiting(line, 5, KIND_MARKET)).toBe(false);
    leaveLine(line, 5);
    expect(line.gone[r]).toBe(1);
    expect(isWaiting(line, 5, KIND_AFFORDABLE)).toBe(false);
    compact(line);
    expect(line.n).toBe(0);
  });
});

describe('8a on the bench city (synthCity, bench baseline money)', () => {
  const bench = benchFunded(benchInput());
  const bs = staticsOf(bench);
  const bt = oneMoneyTimeline(bench, bench.finance!);
  const M = 12;

  it.each(seeds(3))('seed %i, 12 months: same events, ledger and world; fewer probes', (seed) => {
    const a = run(directSystem(), bs, bt, seed, M);
    const b = run(createFundingSystem(), bs, bt, seed, M);
    // Awards after month 1, when the opening wave waits on the line.
    expect(a.events.filter((e) => e.kind === 'award' && e.month > 1).length).toBeGreaterThan(0);
    expect(b.events).toEqual(a.events);
    expect(b.ledger).toEqual(a.ledger);
    expect(b.world).toEqual(a.world);
    expect(b.probes).toBeLessThan(a.probes);
  });
});
