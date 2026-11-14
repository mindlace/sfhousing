// Wall-clock bar for scoring (`npm run test:perf`; never in signoff). The bar: on the bench city,
// one model month's scoring for 96 worlds (48 plan and 48 twin) takes at most 1 ms at the median:
// adding the month's events to every series, `stepped`, and `chunkOf` when a calendar month became
// final. Reported with no bar: the same on funded worlds (tiers filed in every world, world 1's
// whole ledger re-filed by every chunk), at months 101-150 and 400-450.
//
// Setup is untimed. A plan world and its twin run the same seed under the same frame, so each seed
// is run once and its events fed to two series (the scoring work is that of 96 worlds).
// `SFH_SCORE_PERF_SEEDS` / `SFH_SCORE_PERF_FUNDED_SEEDS` shrink the runs while debugging;
// `SFH_PERF_QUIET=1` marks a run made while holding the measurement lock.
import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import type { SimInput } from '$lib/sim/scenario/types';
import { benchFunded, oneMoneyTimeline, runFunded } from '../funding/test/fixtures';
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
const SEEDS = Number(process.env.SFH_SCORE_PERF_SEEDS ?? 48);
const FUNDED_SEEDS = Number(process.env.SFH_SCORE_PERF_FUNDED_SEEDS ?? 16);
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

/** Plan and twin series for `runs`, fed every month before `from` (untimed). */
function seriesFor(score: ScoreStatics, runs: Run[], statics: Statics, from: number) {
  const plan = runs.map(() => createWorldSeries(score));
  const twin = runs.map(() => createWorldSeries(score));
  feed(runs, plan, twin, statics, 0, from - 1);
  return { plan, twin };
}

/** Adds months `from..through` to every series (untimed), month 0 without a `stepped`. */
function feed(
  runs: Run[],
  plan: WorldSeries[],
  twin: WorldSeries[],
  statics: Statics,
  from: number,
  through: number
) {
  for (let m = from; m <= through; m++) {
    for (let i = 0; i < runs.length; i++) {
      for (const e of runs[i].byMonth[m]) {
        plan[i].add(e, runs[i].world, statics);
        twin[i].add(e, runs[i].world, statics);
      }
      if (m > 0) {
        plan[i].stepped(m);
        twin[i].stepped(m);
      }
    }
  }
}

/** World 1's money for `chunkOf`, its ledger grown month by month (untimed) to `ledgerLen[m]`. */
interface Money {
  feed: MoneyFeed;
  all: LedgerEvent[];
  ledgerLen: number[];
}

/**
 * Times months `from..through`: each month's events and `stepped` on every series, then `chunkOf`
 * when a calendar month became final. Returns the per-month times and the chunks made.
 */
function timeMonths(
  runs: Run[],
  plan: WorldSeries[],
  twin: WorldSeries[],
  statics: Statics,
  from: number,
  through: number,
  money: Money | null
): { times: number[]; chunks: number } {
  const times: number[] = [];
  let chunks = 0;
  let final = plan[0].finalThrough();
  for (let m = from; m <= through; m++) {
    if (money !== null) {
      const ledger = money.feed.ledger;
      while (ledger.length < money.ledgerLen[m]) ledger.push(money.all[ledger.length]);
    }
    const t = performance.now();
    for (let i = 0; i < runs.length; i++) {
      const { world, byMonth } = runs[i];
      const p = plan[i];
      const q = twin[i];
      for (const e of byMonth[m]) {
        p.add(e, world, statics);
        q.add(e, world, statics);
      }
      p.stepped(m);
      q.stepped(m);
    }
    const now = plan[0].finalThrough();
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

const seedsOf = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('scoring timing, bench city', () => {
  it(`one month's scoring for ${2 * SEEDS} worlds within ${BAR} ms at the median (months 101-150)`, () => {
    const FROM = 101;
    const TO = 150;
    const input = benchInput();
    const statics = staticsOf(input);
    const timeline = oneFrame(frameOf(input));
    const score = testStatics(input, WINDOW);
    const t0 = performance.now();
    const runs: Run[] = seedsOf(SEEDS).map((seed) => {
      const rec = new Recorder();
      const world = runWorld(statics, timeline, seed, TO, rec);
      return { world, byMonth: byMonthOf(rec.events, TO) };
    });
    const setup = performance.now() - t0;
    const { plan, twin } = seriesFor(score, runs, statics, FROM);
    const { times, chunks } = timeMonths(runs, plan, twin, statics, FROM, TO, null);
    const { median, p90, worst } = stats(times);
    console.log(
      `[perf] scoring ${2 * SEEDS} worlds (${SEEDS} plan + ${SEEDS} twin), months ${FROM}-${TO}: ` +
        `median ${ms(median)} ms, p90 ${ms(p90)} ms, worst ${ms(worst)} ms per month ` +
        `(${chunks} chunks; setup ${(setup / 1000).toFixed(1)} s), ${QUIET}, ${DATASET}`
    );
    expect(chunks).toBeGreaterThan(0);
    expect(median, `median ${ms(median)} ms per month`).toBeLessThanOrEqual(BAR);
  }, 600_000);
});

describe('scoring timing, funded bench city (no bar)', () => {
  it(`${2 * FUNDED_SEEDS} funded worlds, world 1's whole ledger: months 101-150 and 400-450`, () => {
    const TO = 450;
    const input: SimInput = benchFunded(benchInput());
    const statics = staticsOf(input);
    const timeline: PolicyTimeline = oneMoneyTimeline(input, input.finance!);
    const score = timelineStatics(input, timeline, WINDOW);
    const t0 = performance.now();
    let money: Money | null = null;
    const runs: Run[] = seedsOf(FUNDED_SEEDS).map((seed) => {
      const ledgerLen: number[] = [0];
      const got = runFunded(statics, timeline, seed, TO, {
        afterStep: (_w, _m, ledger) => ledgerLen.push(ledger.length)
      });
      if (seed === 1) {
        money = {
          feed: {
            ledger: [],
            finance: timeline.frameAt(1).finance!,
            world: got.world,
            statics
          },
          all: got.ledger,
          ledgerLen
        };
      }
      return { world: got.world, byMonth: byMonthOf(got.events, TO) };
    });
    const setup = performance.now() - t0;
    const m = money as Money | null;
    expect(m).not.toBeNull();

    const { plan, twin } = seriesFor(score, runs, statics, 101);
    const report = (from: number, through: number) => {
      const { times, chunks } = timeMonths(runs, plan, twin, statics, from, through, m);
      const { median, p90, worst } = stats(times);
      console.log(
        `[perf] funded scoring ${2 * FUNDED_SEEDS} worlds (${FUNDED_SEEDS} plan + ${FUNDED_SEEDS} ` +
          `twin), months ${from}-${through}, world 1's ledger ${m!.feed.ledger.length} events: ` +
          `median ${ms(median)} ms, p90 ${ms(p90)} ms, worst ${ms(worst)} ms per month ` +
          `(${chunks} chunks; setup ${(setup / 1000).toFixed(1)} s), ${QUIET}, ${DATASET}`
      );
      return times;
    };
    const early = report(101, 150);
    feed(runs, plan, twin, statics, 151, 399);
    while (m!.feed.ledger.length < m!.ledgerLen[399]) {
      m!.feed.ledger.push(m!.all[m!.feed.ledger.length]);
    }
    const late = report(400, 450);
    expect(early.length).toBeGreaterThan(0);
    expect(late.length).toBeGreaterThan(0);
  }, 600_000);
});
