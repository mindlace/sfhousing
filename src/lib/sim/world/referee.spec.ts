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
import { everyStage, frameOf, oneFrame, oldInputOf } from './test/timeline';

/** The referee, under one frame with every stage at `speed` (today's `inFlightScale` and `newProjects.scale`). */
function referee(input: SimInput, statics: Statics, seed: number, speed = 1): void {
  const scale = everyStage(speed);
  const old = simulateDetailed(
    oldInputOf(input, speed === 1 ? {} : { inFlightScale: scale, newScale: scale }),
    seed,
    HORIZON
  );
  const frame = frameOf(input, speed === 1 ? {} : { speed: scale });
  const w = runWorld(statics, oneFrame(frame), seed, horizonMonth(input.asOf));
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

  // A start that exits in its own month and whose lot starts again in that month, inside one chain
  // of `startProject` (rule 14), never happens at normal speed on these cities in 20 seeds; with
  // every stage at 0.05 it does on the bench city (seed 13 first). The fixture's 25 lots never show
  // it, so it is refereed on the bench city only.
  if (name === 'bench')
    it(`${name}: a start, its exit and a restart in one month are refereed`, () => {
      const speed = 0.05;
      let found = 0;
      for (const seed of SEEDS) {
        const seen: Record<string, number> = { chainRestart: 0 };
        tally(seed, seen, speed);
        if (seen.chainRestart === 0) continue;
        found += seen.chainRestart;
        referee(input, statics, seed, speed);
        break;
      }
      expect(found).toBeGreaterThan(0);
    });

  function tally(seed: number, seen: Record<string, number>, speed = 1): void {
    const rec = new Recorder();
    const frame = frameOf(input, speed === 1 ? {} : { speed: everyStage(speed) });
    const w = runWorld(statics, oneFrame(frame), seed, horizonMonth(input.asOf), rec);
    const { schedules } = readAll(w, statics, HORIZON);
    const sim = schedules.filter((s) => s.origin === 'simulated');
    const count = (k: string, n = 1) => {
      if (k in seen) seen[k] += n;
    };
    count('simulated', sim.length);
    const index = input.parcels.index;
    for (const s of sim) {
      if (!s.projectId.endsWith(':0')) count('again');
      const i = index.get(s.parcelIds[0])!;
      if (s.existingUnits === 0 && input.parcels.existingUnits[i] > 0) count('demolished');
    }
    // A row that enters a stage and leaves it in one step; a lot freed and started again in one,
    // counted apart by where the freeing exit came from: a row begun in an earlier month (its exit
    // in system 3, the restart in system 6) or a row begun this same month (start, exit and start
    // again inside one chain of `startProject`, rule 14).
    const p = w.projects;
    const lastEnter = new Map<number, number>();
    const startMonth = new Map<number, number>();
    const exitOf = new Map<number, { month: number; fresh: boolean }>();
    for (const e of rec.events) {
      if (e.kind === 'start') startMonth.set(e.row, e.month);
      if (e.month === 0) continue;
      if (e.kind === 'enter') {
        if (lastEnter.get(e.row) === e.month) count('sameStep');
        lastEnter.set(e.row, e.month);
      }
      if (e.kind === 'end' && lastEnter.get(e.row) === e.month) count('sameStep');
      if (p.origin[e.row] !== ORIGIN_SIM) continue;
      const lot = p.src[e.row];
      if (e.kind === 'end' && e.how === 'exit') {
        exitOf.set(lot, { month: e.month, fresh: startMonth.get(e.row) === e.month });
      }
      const exit = exitOf.get(lot);
      if (e.kind === 'start' && exit?.month === e.month) {
        count(exit.fresh ? 'chainRestart' : 'restartSameStep');
      }
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
