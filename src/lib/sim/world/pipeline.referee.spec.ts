// The exact referee for pipeline rows, masters and phases: under one frame, every pipeline
// schedule (phases included) and every master a world reads at the horizon equals today's engine,
// and at a near horizon in mid-month every schedule does (`referee.spec.ts` has the full one).
import { beforeAll, describe, expect, it } from 'vitest';
import { HORIZON } from '$lib/fzp/time';
import type { Master } from '$lib/sim/scenario/simulate';
import { simulateDetailed } from '$lib/sim/scenario/simulate';
import type { Schedule, SimInput } from '$lib/sim/scenario/types';
import { monthOfDay } from './months';
import { staticsOf, type Statics } from './statics';
import { benchInput, fixtureInput } from './test/cities.node';
import { Recorder, SEEDS, horizonMonth, readAll, runWorld } from './test/run';
import { frameOf, oneFrame, oldInputOf } from './test/timeline';

const cities: [string, () => SimInput | Promise<SimInput>][] = [
  ['bench', benchInput],
  ['fixture', fixtureInput]
];

describe.each(cities)('pipeline referee on the %s city', (name, load) => {
  let input: SimInput;
  let statics: Statics;
  beforeAll(async () => {
    input = await load();
    statics = staticsOf(input);
  });

  // What the referee runs below have read, for the non-degeneracy check after them (each run
  // steps the whole city, so they are not run twice).
  const seen = { phases: 0, entitled: 0, exit: 0, complete: 0, open: 0, revised: 0 };
  const tally = (schedules: Schedule[], masters: Master[]) => {
    for (const s of schedules) {
      if (s.origin !== 'pipeline') continue;
      if (s.phase !== null) seen.phases++;
      seen[s.end.kind]++;
      if (s.revisions.length > 1) seen.revised++;
    }
    for (const m of masters) if (m.end.kind === 'entitled') seen.entitled++;
  };

  it.each(SEEDS)(`${name} seed %i: pipeline schedules and masters equal today’s`, (seed) => {
    const old = simulateDetailed(oldInputOf(input), seed, HORIZON);
    const w = runWorld(statics, oneFrame(frameOf(input)), seed, horizonMonth(input.asOf));
    const mine = readAll(w, statics, HORIZON);
    tally(mine.schedules, mine.masters);
    expect(mine.schedules.filter((s) => s.origin === 'pipeline')).toEqual(
      old.schedules.filter((s) => s.origin === 'pipeline')
    );
    expect(mine.masters).toEqual(old.masters);
  });

  // A near horizon in mid-month: rows still open, and events later in that month hidden. Every
  // schedule, ordinary starts included (their readers hide what falls after the day too).
  const near = (asOf: number) => asOf + 1000;

  it.each(SEEDS)(`${name} seed %i: the same at a near horizon`, (seed) => {
    const day = near(input.asOf);
    const old = simulateDetailed(oldInputOf(input), seed, day);
    const w = runWorld(statics, oneFrame(frameOf(input)), seed, monthOfDay(input.asOf, day));
    const mine = readAll(w, statics, day);
    tally(mine.schedules, mine.masters);
    expect(mine.schedules).toEqual(old.schedules);
    expect(mine.masters).toEqual(old.masters);
  });

  it(`${name}: the referee is not degenerate`, () => {
    // The fixture's calibration revises nothing (every `revision.at` probability is 0).
    const revises = input.calibration.revision.at.some((a) => a.probability > 0);
    expect(revises).toBe(name === 'bench');
    if (!revises) delete (seen as Partial<typeof seen>).revised;
    for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThan(0);
  });

  it(`${name}: every row starts before its other events, and step events fall in their month`, () => {
    const rec = new Recorder();
    const through = 120;
    runWorld(statics, oneFrame(frameOf(input)), 3, through, rec);
    const started = new Set<number>();
    for (const e of rec.events) {
      if (e.kind === 'start') {
        expect(started.has(e.row)).toBe(false);
        started.add(e.row);
      } else expect(started.has(e.row)).toBe(true);
      if (e.month > 0) {
        expect(monthOfDay(input.asOf, e.day)).toBe(e.month);
      }
    }
    expect(started.size).toBeGreaterThan(0);
  });
});
