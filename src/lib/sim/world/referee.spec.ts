// The exact referee under one frame and no public money (OD-2): every schedule (pipeline, phases
// and ordinary starts) and every master a world reads at the horizon equals `simulateDetailed`.
import { beforeAll, describe, expect, it } from 'vitest';
import { HORIZON } from '$lib/fzp/time';
import { simulateDetailed } from '$lib/sim/scenario/simulate';
import type { SimInput } from '$lib/sim/scenario/types';
import { ORIGIN_SIM } from './types';
import { staticsOf, type Statics } from './statics';
import { benchInput, fixtureInput, liveDir, liveInput } from './test/cities.node';
import { LIVE_SEEDS, Recorder, SEEDS, horizonMonth, readAll, runWorld } from './test/run';
import { frameOf, oneFrame, oldInputOf } from './test/timeline';

function referee(input: SimInput, statics: Statics, seed: number): void {
  const old = simulateDetailed(oldInputOf(input), seed, HORIZON);
  const w = runWorld(statics, oneFrame(frameOf(input)), seed, horizonMonth(input.asOf));
  const mine = readAll(w, statics, HORIZON);
  expect(mine.schedules.map((s) => s.projectId)).toEqual(old.schedules.map((s) => s.projectId));
  for (let i = 0; i < old.schedules.length; i++)
    expect(mine.schedules[i], old.schedules[i].projectId).toEqual(old.schedules[i]);
  expect(mine.masters).toEqual(old.masters);
}

const cities: [string, () => SimInput | Promise<SimInput>][] = [
  ['bench', benchInput],
  ['fixture', fixtureInput]
];

describe.each(cities)('%s, one frame, no money', (name, load) => {
  let input: SimInput;
  let statics: Statics;
  beforeAll(async () => {
    input = await load();
    statics = staticsOf(input);
  });

  it.each(SEEDS)(`${name} seed %i equals simulateDetailed at the horizon`, (seed) => {
    referee(input, statics, seed);
  });

  // Seeds from 1 until every case has been seen (the fixture's 25 lots need more than one).
  it(`${name}: is not degenerate`, () => {
    const seen = { simulated: 0, again: 0, demolished: 0, sameStep: 0, restartSameStep: 0 };
    for (const seed of SEEDS) {
      tally(seed, seen);
      if (Object.values(seen).every((v) => v > 0)) break;
    }
    for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThan(0);
  });

  function tally(seed: number, seen: Record<string, number>): void {
    const rec = new Recorder();
    const w = runWorld(statics, oneFrame(frameOf(input)), seed, horizonMonth(input.asOf), rec);
    const { schedules } = readAll(w, statics, HORIZON);
    const sim = schedules.filter((s) => s.origin === 'simulated');
    seen.simulated += sim.length;
    const index = input.parcels.index;
    for (const s of sim) {
      if (!s.projectId.endsWith(':0')) seen.again++;
      const i = index.get(s.parcelIds[0])!;
      if (s.existingUnits === 0 && input.parcels.existingUnits[i] > 0) seen.demolished++;
    }
    // A row that enters a stage and leaves it in one step; a lot freed and started again in one.
    const p = w.projects;
    const lastEnter = new Map<number, number>();
    const exitMonth = new Map<number, number>();
    for (const e of rec.events) {
      if (e.month === 0) continue;
      if (e.kind === 'enter') {
        if (lastEnter.get(e.row) === e.month) seen.sameStep++;
        lastEnter.set(e.row, e.month);
      }
      if (e.kind === 'end' && lastEnter.get(e.row) === e.month) seen.sameStep++;
      if (p.origin[e.row] !== ORIGIN_SIM) continue;
      const lot = p.src[e.row];
      if (e.kind === 'end' && e.how === 'exit') exitMonth.set(lot, e.month);
      if (e.kind === 'start' && exitMonth.get(lot) === e.month) seen.restartSameStep++;
    }
  }
});

const live = liveDir();

describe.skipIf(live === null)('live, one frame, no money', () => {
  let input: SimInput;
  let statics: Statics;
  beforeAll(async () => {
    input = await liveInput(live!);
    statics = staticsOf(input);
  });

  it.each(LIVE_SEEDS)('live seed %i equals simulateDetailed at the horizon', (seed) => {
    referee(input, statics, seed);
  });
});
