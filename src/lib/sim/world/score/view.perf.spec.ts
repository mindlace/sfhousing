// Wall-clock report for `viewOf` (`npm run test:perf`; never in signoff; no bar). The page calls
// `viewOf` on every fill, so this times it at a full window on the funded bench city: world 1's
// money (pools, homes, rule 12's figures) is the part that grows with the window.
//
// Setup is untimed: `SEEDS` funded worlds run through the window, each fed to one series used as
// both plan and twin, then one chunk per calendar month (as the runner makes them when each month
// becomes final). `SFH_PERF_QUIET=1` marks a run made while holding the measurement lock.
import { describe, expect, it } from 'vitest';
import type { SimInput } from '$lib/sim/scenario/types';
import { benchFunded } from '../funding/test/cities.node';
import { oneMoneyTimeline } from '../funding/test/fixtures';
import { staticsOf } from '../statics';
import { chunkOf } from './chunk';
import { createWorldSeries } from './series';
import { feedFunded, timelineStatics } from './test/feed';
import type { MoneyFeed, SeriesChunk } from './types';
import { viewOf } from './view';

const WINDOW = 480;
const SEEDS = 4;
const RUNS = 1000;
const QUIET = process.env.SFH_PERF_QUIET === '1' ? 'quiet (lock held)' : 'not quiet (no lock)';
const DATASET = 'dataset: bench (synthCity)';

const ms = (x: number) => x.toFixed(3);

function stats(times: number[]) {
  const s = [...times].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return { median: at(0.5), p90: at(0.9), worst: s[s.length - 1] };
}

describe('viewOf timing, funded bench city (no bar)', () => {
  it(`viewOf at a full ${WINDOW}-month window, ${SEEDS} funded worlds`, () => {
    const input: SimInput = benchFunded('baseline').input;
    const statics = staticsOf(input);
    const timeline = oneMoneyTimeline(input, input.finance!);
    const score = timelineStatics(input, timeline, WINDOW);
    const t0 = performance.now();
    const series = [];
    let feed: MoneyFeed | null = null;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = createWorldSeries(score);
      const got = feedFunded(statics, timeline, seed, WINDOW, s);
      series.push(s);
      if (seed === 1) {
        feed = {
          ledger: got.ledger,
          finance: timeline.frameAt(1).finance!,
          world: got.world,
          statics
        };
      }
    }
    const last = score.lastIndex;
    const chunks: SeriesChunk[] = [];
    for (let i = 0; i <= last; i++) chunks.push(chunkOf(series, series, feed, i, i));
    const setup = performance.now() - t0;

    const times: number[] = [];
    let filled = -2;
    let funded = false;
    for (let k = 0; k < RUNS; k++) {
      const t = performance.now();
      const v = viewOf(chunks, score);
      times.push(performance.now() - t);
      filled = v.filledThrough;
      funded = v.money !== null;
    }
    const { median, p90, worst } = stats(times);
    console.log(
      `[perf] viewOf ${SEEDS} funded worlds (plan = twin), window ${WINDOW} (${last + 1} months, ` +
        `${chunks.length} chunks, ${RUNS} runs): median ${ms(median)} ms, p90 ${ms(p90)} ms, ` +
        `worst ${ms(worst)} ms (setup ${(setup / 1000).toFixed(1)} s), ${QUIET}, ${DATASET}`
    );
    expect(filled).toBe(last);
    expect(funded).toBe(true);
  }, 600_000);
});
