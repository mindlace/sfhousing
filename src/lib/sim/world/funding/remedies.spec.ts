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
  let direct = 0;
  let grouped = 0;

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
      expect(b.probes).toBeLessThanOrEqual(a.probes);
      awarded += awards(a);
      direct += a.probes;
      grouped += b.probes;
    }
  );

  it('over the 20 finances: awards were made, and grouping asked the award rule less often', () => {
    expect(awarded).toBeGreaterThan(0);
    expect(grouped).toBeLessThan(direct);
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
