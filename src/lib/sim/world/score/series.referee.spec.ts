// Rule 5's referee: one world fed to a `WorldSeries` under one frame without public money gives
// exactly today's `shownSeries` of `simulateDetailed` at the horizon, every month, every field.
import { beforeAll, describe, expect, it } from 'vitest';
import { HORIZON } from '$lib/fzp/time';
import { monthsOf, shownSeries } from '$lib/sim/scenario/score';
import { simulateDetailed } from '$lib/sim/scenario/simulate';
import type { SimInput } from '$lib/sim/scenario/types';
import { staticsOf, type Statics } from '../statics';
import { benchInput, fixtureInput, liveDir, liveInput } from '../test/cities.node';
import { LIVE_SEEDS, horizonMonth } from '../test/run';
import { frameOf, oldInputOf, oneFrame } from '../test/timeline';
import { createWorldSeries } from './series';
import { feedWorld, testStatics } from './test/feed';
import type { MonthRow } from './types';

const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);

/** Feeds seed `seed` live, checks it against `shownSeries`, and returns the rows. */
function referee(input: SimInput, statics: Statics, seed: number): MonthRow[] {
  const old = simulateDetailed(oldInputOf(input), seed, HORIZON);
  const want = shownSeries(old, input.asOf, HORIZON, monthsOf(input.asOf, HORIZON));
  const s = testStatics(input, horizonMonth(input.asOf));
  const series = createWorldSeries(s);
  feedWorld(statics, oneFrame(frameOf(input)), seed, horizonMonth(input.asOf), series, 'live');
  expect(series.finalThrough()).toBe(s.lastIndex);
  const got = series.rows(0, s.lastIndex);
  expect(got).toEqual(want);
  return got;
}

const cities: [string, () => SimInput | Promise<SimInput>][] = [
  ['bench', benchInput],
  ['fixture', fixtureInput]
];

describe.each(cities)('%s, one frame, no money', (name, load) => {
  let input: SimInput;
  let statics: Statics;
  const seen = new Map<number, MonthRow[]>();
  beforeAll(async () => {
    input = await load();
    statics = staticsOf(input);
  });

  it.each(SEEDS)(`${name} seed %i equals shownSeries`, (seed) => {
    seen.set(seed, referee(input, statics, seed));
  });

  it(`${name}: is not degenerate`, () => {
    const hit = { exited: 0, entitledNew: 0, pipeline: 0, fresh: 0, entitled: 0 };
    for (const seed of SEEDS) {
      const rows = seen.get(seed) ?? referee(input, statics, seed);
      for (const r of rows) {
        if (r.exitedUnits > 0) hit.exited++;
        if (r.entitledNew > 0) hit.entitledNew++;
        if (r.completedNetPipeline !== 0) hit.pipeline++;
        if (r.completedNetNew !== 0) hit.fresh++;
        if (r.inProgress.entitled > 0) hit.entitled++;
      }
    }
    for (const [k, v] of Object.entries(hit)) expect(v, k).toBeGreaterThan(0);
  });
});

const live = liveDir();

describe.skipIf(live === null)('live, one frame, no money', () => {
  let input: SimInput;
  let statics: Statics;
  beforeAll(async () => {
    input = await liveInput(live!);
    statics = staticsOf(input);
  });

  it.each(LIVE_SEEDS)('live seed %i equals shownSeries', (seed) => {
    referee(input, statics, seed);
  });
});
