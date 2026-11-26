// Wall-clock bar for scoring (`npm run test:perf`; never in signoff). The bar: on the bench city,
// one model month's scoring for one pair (a plan world and its twin) takes at most 1 ms at the
// median: adding the month's events to both series, `stepped`, and `chunkOf` when a calendar month
// became final. Reported with no bar: the same on funded worlds (tiers filed in both worlds, the
// plan world's whole ledger re-filed by every chunk), at months 101-150 and 400-450.
//
// Setup is untimed. The plan world and its twin run seed 1 under the same frame, so the world is
// run once and its events fed to two series (the scoring work is that of one pair).
// `SFH_PERF_QUIET=1` marks a run made while holding the measurement lock.
import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '$lib/sim/world/types';
import type { SimInput } from '$lib/sim/scenario/types';
import { benchFunded } from '../funding/test/cities.node';
import { oneMoneyTimeline, runFunded } from '../funding/test/fixtures';
import type { PolicyTimeline } from '../policy/frame';
import { staticsOf, type Statics } from '../statics';
import { benchInput } from '../test/cities.node';
import { Recorder, runWorld } from '../test/run';
import { frameOf, oneFrame } from '../test/timeline';
import type { World, WorldEvent } from '../types';
import { chunkOf } from './chunk';
import { createWorldSeries } from './series';
import { testStatics, timelineStatics } from './test/feed';
import type { MoneyFeed, ScoreStatics, WorldSeries } from './types';

const WINDOW = 480;
const BAR = 1;
const SEED = 1;
const QUIET = process.env.SFH_PERF_QUIET === '1' ? 'quiet (lock held)' : 'not quiet (no lock)';
const DATASET = 'dataset: bench (synthCity)';

const ms = (x: number) => x.toFixed(3);

/** One world's events by the model month that sent them (0 for `createWorld`). */
interface Run {
  world: World;
  byMonth: WorldEvent[][];
}

function byMonthOf(events: (WorldEvent & { month: number })[], through: number): WorldEvent[][] {
  const out: WorldEvent[][] = Array.from({ length: through + 1 }, () => []);
  for (const e of events) out[e.month].push(e);
  return out;
}

/** Plan and twin series for `run`, fed every month before `from` (untimed). */
function seriesFor(score: ScoreStatics, run: Run, statics: Statics, from: number) {
  const plan = createWorldSeries(score);
  const twin = createWorldSeries(score);
  feed(run, plan, twin, statics, 0, from - 1);
  return { plan, twin };
}

/** Adds months `from..through` to both series (untimed), month 0 without a `stepped`. */
function feed(
  run: Run,
  plan: WorldSeries,
  twin: WorldSeries,
  statics: Statics,
  from: number,
  through: number
) {
  for (let m = from; m <= through; m++) {
    for (const e of run.byMonth[m]) {
      plan.add(e, run.world, statics);
      twin.add(e, run.world, statics);
    }
    if (m > 0) {
      plan.stepped(m);
      twin.stepped(m);
    }
  }
}

/** The plan world's money for `chunkOf`, its ledger grown by month (untimed) to `ledgerLen[m]`. */
interface Money {
  feed: MoneyFeed;
  all: LedgerEvent[];
  ledgerLen: number[];
}

/**
 * Times months `from..through`: each month's events and `stepped` on both series, then `chunkOf`
 * when a calendar month became final. Returns the per-month times and the chunks made.
 */
function timeMonths(
  run: Run,
  plan: WorldSeries,
  twin: WorldSeries,
  statics: Statics,
  from: number,
  through: number,
  money: Money | null
): { times: number[]; chunks: number } {
  const times: number[] = [];
  let chunks = 0;
  let final = plan.finalThrough();
  const { world, byMonth } = run;
  for (let m = from; m <= through; m++) {
    if (money !== null) {
      const ledger = money.feed.ledger;
      while (ledger.length < money.ledgerLen[m]) ledger.push(money.all[ledger.length]);
    }
    const t = performance.now();
    for (const e of byMonth[m]) {
      plan.add(e, world, statics);
      twin.add(e, world, statics);
    }
    plan.stepped(m);
    twin.stepped(m);
    const now = plan.finalThrough();
    if (now > final) {
      chunkOf(plan, twin, money === null ? null : money.feed, final + 1, now);
      final = now;
      chunks++;
    }
    times.push(performance.now() - t);
  }
  return { times, chunks };
}

function stats(times: number[]) {
  const s = [...times].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return { median: at(0.5), p90: at(0.9), worst: s[s.length - 1] };
}

describe('scoring timing, bench city', () => {
  it(`one month's scoring for one pair within ${BAR} ms at the median`, () => {
    const FROM = 101;
    const TO = 150;
    const input = benchInput();
    const statics = staticsOf(input);
    const timeline = oneFrame(frameOf(input));
    const score = testStatics(input, WINDOW);
    const t0 = performance.now();
    const rec = new Recorder();
    const world = runWorld(statics, timeline, SEED, TO, rec);
    const run: Run = { world, byMonth: byMonthOf(rec.events, TO) };
    const setup = performance.now() - t0;
    const { plan, twin } = seriesFor(score, run, statics, FROM);
    const { times, chunks } = timeMonths(run, plan, twin, statics, FROM, TO, null);
    const { median, p90, worst } = stats(times);
    console.log(
      `[perf] scoring one pair, months ${FROM}-${TO}: ` +
        `median ${ms(median)} ms, p90 ${ms(p90)} ms, worst ${ms(worst)} ms per month ` +
        `(${chunks} chunks; setup ${(setup / 1000).toFixed(1)} s), ${QUIET}, ${DATASET}`
    );
    expect(chunks).toBeGreaterThan(0);
    expect(median, `median ${ms(median)} ms per month`).toBeLessThanOrEqual(BAR);
  }, 600_000);
});

describe('scoring timing, funded bench city (no bar)', () => {
  it(`one funded pair, the plan world's whole ledger: months 101-150 and 400-450`, () => {
    const TO = 450;
    const input: SimInput = benchFunded('baseline').input;
    const statics = staticsOf(input);
    const timeline: PolicyTimeline = oneMoneyTimeline(input, input.finance!);
    const score = timelineStatics(input, timeline, WINDOW);
    const t0 = performance.now();
    const ledgerLen: number[] = [0];
    const got = runFunded(statics, timeline, SEED, TO, {
      afterStep: (_w, _m, ledger) => ledgerLen.push(ledger.length)
    });
    const m: Money = {
      feed: {
        ledger: [],
        finance: timeline.frameAt(1).finance!,
        world: got.world,
        statics
      },
      all: got.ledger,
      ledgerLen
    };
    const run: Run = { world: got.world, byMonth: byMonthOf(got.events, TO) };
    const setup = performance.now() - t0;

    const { plan, twin } = seriesFor(score, run, statics, 101);
    const report = (from: number, through: number) => {
      const { times, chunks } = timeMonths(run, plan, twin, statics, from, through, m);
      const { median, p90, worst } = stats(times);
      console.log(
        `[perf] funded scoring one pair, ` +
          `months ${from}-${through}, the plan world's ledger ${m.feed.ledger.length} events: ` +
          `median ${ms(median)} ms, p90 ${ms(p90)} ms, worst ${ms(worst)} ms per month ` +
          `(${chunks} chunks; setup ${(setup / 1000).toFixed(1)} s), ${QUIET}, ${DATASET}`
      );
      return times;
    };
    const early = report(101, 150);
    feed(run, plan, twin, statics, 151, 399);
    while (m.feed.ledger.length < m.ledgerLen[399]) {
      m.feed.ledger.push(m.all[m.feed.ledger.length]);
    }
    const late = report(400, 450);
    expect(early.length).toBeGreaterThan(0);
    expect(late.length).toBeGreaterThan(0);
  }, 600_000);
});

describe('scoring timing, with cars (sanity only, no bar)', () => {
  it('files a snapshot each month and reads the chunks', () => {
    const score = testStatics(benchInput(), WINDOW);
    const plan = createWorldSeries(score);
    const zones = new Float32Array(2000).fill(0.5);
    const times: number[] = [];
    let final = plan.finalThrough();
    for (let m = 1; m <= 150; m++) {
      const t = performance.now();
      plan.stepped(m, { households: 1e6 + m, cars: 5e5, carless: 1e5, spacesPerHome: 1, zones });
      const now = plan.finalThrough();
      if (now > final) {
        chunkOf(plan, plan, null, final + 1, now);
        final = now;
      }
      times.push(performance.now() - t);
    }
    const { median, p90, worst } = stats(times);
    console.log(
      `[perf] cars, 2000 zones, months 1-150: median ${ms(median)} ms, p90 ${ms(p90)} ms, ` +
        `worst ${ms(worst)} ms per month, ${QUIET}`
    );
    for (const x of [median, p90, worst]) {
      expect(Number.isFinite(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
    }
  }, 600_000);
});
