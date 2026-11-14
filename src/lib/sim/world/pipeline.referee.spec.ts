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

  // What each referee run below has read, by run: kept from whichever test ran it first (each run
  // steps the whole city), so the non-degeneracy check holds on its own when run alone or shuffled.
  type Seen = {
    phases: number;
    entitled: number;
    exit: number;
    complete: number;
    open: number;
    revised: number;
  };
  const tallies = new Map<string, Seen>();
  const tally = (key: string, schedules: Schedule[], masters: Master[]): void => {
    const seen: Seen = { phases: 0, entitled: 0, exit: 0, complete: 0, open: 0, revised: 0 };
    for (const s of schedules) {
      if (s.origin !== 'pipeline') continue;
      if (s.phase !== null) seen.phases++;
      seen[s.end.kind]++;
      if (s.revisions.length > 1) seen.revised++;
    }
    for (const m of masters) if (m.end.kind === 'entitled') seen.entitled++;
    tallies.set(key, seen);
  };

  // A near horizon in mid-month: rows still open, and events later in that month hidden. Every
  // schedule, ordinary starts included (their readers hide what falls after the day too).
  const near = (asOf: number) => asOf + 1000;

  /** The world of one referee run read at its day, tallied under `key`. */
  const mineOf = (seed: number, atNear: boolean) => {
    const day = atNear ? near(input.asOf) : HORIZON;
    const through = atNear ? monthOfDay(input.asOf, day) : horizonMonth(input.asOf);
    const w = runWorld(statics, oneFrame(frameOf(input)), seed, through);
    const mine = readAll(w, statics, day);
    tally(`${seed}:${atNear}`, mine.schedules, mine.masters);
    return { day, mine };
  };

  it.each(SEEDS)(`${name} seed %i: pipeline schedules and masters equal today’s`, (seed) => {
    const old = simulateDetailed(oldInputOf(input), seed, HORIZON);
    const { mine } = mineOf(seed, false);
    expect(mine.schedules.filter((s) => s.origin === 'pipeline')).toEqual(
      old.schedules.filter((s) => s.origin === 'pipeline')
    );
    expect(mine.masters).toEqual(old.masters);
  });

  it.each(SEEDS)(`${name} seed %i: the same at a near horizon`, (seed) => {
    const { day, mine } = mineOf(seed, true);
    const old = simulateDetailed(oldInputOf(input), seed, day);
    expect(mine.schedules).toEqual(old.schedules);
    expect(mine.masters).toEqual(old.masters);
  });

  it(`${name}: the referee is not degenerate`, () => {
    // The fixture's calibration revises nothing (every `revision.at` probability is 0).
    const revises = input.calibration.revision.at.some((a) => a.probability > 0);
    expect(revises).toBe(name === 'bench');
    const seen: Partial<Seen> = { phases: 0, entitled: 0, exit: 0, complete: 0, open: 0 };
    if (revises) seen.revised = 0;
    const done = () => Object.values(seen).every((v) => v! > 0);
    // The referee's own runs, seed by seed, until every case has been seen.
    for (const seed of SEEDS) {
      for (const atNear of [false, true]) {
        const key = `${seed}:${atNear}`;
        if (!tallies.has(key)) mineOf(seed, atNear);
        const t = tallies.get(key)!;
        for (const k of Object.keys(seen) as (keyof Seen)[]) seen[k]! += t[k];
      }
      if (done()) break;
    }
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
