// The world's cost bars (spec "Cost"): perf project only (`npm run test:perf`), on an idle machine.
// Every number is printed; on a busy machine they are ballpark.
import { describe, expect, it } from 'vitest';
import type { Due, World } from './types';
import { createWorld, planDue, step } from './index';
import { staticsOf } from './statics';
import { benchInput, liveDir, liveInput } from './test/cities.node';
import { changingAt, frameOf, oneFrame } from './test/timeline';

const NOWHERE = { event() {} };
const WORLDS = 48;
const THROUGH = 480;
const WARM = 24;
const LAST = 120;
/** A market change: every free lot of every world is planned again in this month. */
const CHANGE = 72;

const quantile = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

describe('world cost, bench city', () => {
  it('48 worlds, one month, no money, bench city: at most 3 ms', () => {
    const input = benchInput();
    const statics = staticsOf(input);
    const f = frameOf(input);
    const t = changingAt(CHANGE, f, frameOf(input, { id: 1, market: f.market + 0.25 }), null);
    const worlds: World[] = [];
    const dues: Due[] = [];
    for (let seed = 1; seed <= WORLDS; seed++) {
      const w = createWorld(statics, t, seed, NOWHERE);
      worlds.push(w);
      dues.push(planDue(w, statics, t, seed, THROUGH));
    }
    const month = (): number => {
      const t0 = performance.now();
      for (let i = 0; i < WORLDS; i++) step(worlds[i], dues[i], statics, t, i + 1, NOWHERE);
      return performance.now() - t0;
    };
    for (let m = 1; m <= WARM; m++) month();
    const samples: number[] = [];
    let change = 0;
    for (let m = WARM + 1; m <= LAST; m++) {
      const ms = month();
      if (m === CHANGE) change = ms;
      else samples.push(ms);
    }
    const median = quantile(samples, 0.5);
    console.log(
      `world bench: ${WORLDS} worlds, one month (months ${WARM + 1}..${LAST} but ${CHANGE}): ` +
        `median ${median.toFixed(3)} ms, p90 ${quantile(samples, 0.9).toFixed(3)} ms; ` +
        `market-change month ${CHANGE}: ${change.toFixed(3)} ms`
    );
    expect(worlds.every((w) => w.month === LAST)).toBe(true);
    expect(worlds.some((w) => w.projects.n > 0 && w.lots.n > 0)).toBe(true);
    expect(median).toBeLessThanOrEqual(3);
  });

  // The one-frame case, printed beside it (no bar): the cost without any frame change.
  it('48 worlds, one month, one frame: printed', () => {
    const input = benchInput();
    const statics = staticsOf(input);
    const t = oneFrame(frameOf(input));
    const worlds = Array.from({ length: WORLDS }, (_, i) =>
      createWorld(statics, t, i + 1, NOWHERE)
    );
    const dues = worlds.map((w, i) => planDue(w, statics, t, i + 1, THROUGH));
    const samples: number[] = [];
    for (let m = 1; m <= LAST; m++) {
      const t0 = performance.now();
      for (let i = 0; i < WORLDS; i++) step(worlds[i], dues[i], statics, t, i + 1, NOWHERE);
      if (m > WARM) samples.push(performance.now() - t0);
    }
    console.log(
      `world bench, one frame: median ${quantile(samples, 0.5).toFixed(3)} ms, ` +
        `p90 ${quantile(samples, 0.9).toFixed(3)} ms`
    );
    expect(samples).toHaveLength(LAST - WARM);
  });
});

describe.skipIf(liveDir() === null)('live city', () => {
  it('createWorld plus planDue through month 480, one world: printed', async () => {
    const input = await liveInput(liveDir()!);
    const statics = staticsOf(input);
    const t = oneFrame(frameOf(input));
    const once = (seed: number): number => {
      const t0 = performance.now();
      const w = createWorld(statics, t, seed, NOWHERE);
      planDue(w, statics, t, seed, THROUGH);
      return performance.now() - t0;
    };
    once(1);
    const ms = quantile(
      [2, 3, 4, 5, 6].map((seed) => once(seed)),
      0.5
    );
    console.log(
      `world bench, live city: createWorld + planDue through ${THROUGH}: ${ms.toFixed(1)} ms`
    );
    expect(ms).toBeGreaterThan(0);
  });
});
