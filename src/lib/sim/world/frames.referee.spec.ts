// The referee across one frame change at month m (spec "Tests that must pass"): a zoning change
// equals today's dated regime and a market change today's market step, both dated the first day of
// month m.
import { beforeAll, describe, expect, it } from 'vitest';
import { HORIZON } from '$lib/fzp/time';
import { precomputeOf } from '$lib/sim/scenario/input';
import { simulateDetailed } from '$lib/sim/scenario/simulate';
import type { SimInput } from '$lib/sim/scenario/types';
import { monthFirstDay } from './months';
import { staticsOf, type Statics } from './statics';
import { benchInput, fixtureInput } from './test/cities.node';
import { SEEDS, horizonMonth, readAll, runWorld } from './test/run';
import { changingAt, frameOf, marketAt, oldInputOf, touchedRows, upzoned } from './test/timeline';

const M = 121;

/** Every tenth entry. */
function everyTenth(a: Int32Array): Int32Array {
  return a.filter((_, i) => i % 10 === 0);
}

/** Today's output with each schedule's `regime` deleted (Open question 4). */
function withoutRegime(old: ReturnType<typeof simulateDetailed>) {
  return {
    schedules: old.schedules.map((s) => {
      const { regime: _regime, ...rest } = s;
      void _regime;
      return rest;
    }),
    masters: old.masters
  };
}

function expectSame(
  mine: ReturnType<typeof readAll>,
  old: { schedules: ReturnType<typeof readAll>['schedules']; masters: unknown[] }
): void {
  expect(mine.schedules.map((s) => s.projectId)).toEqual(old.schedules.map((s) => s.projectId));
  for (let i = 0; i < old.schedules.length; i++)
    expect(mine.schedules[i], old.schedules[i].projectId).toEqual(old.schedules[i]);
  expect(mine.masters).toEqual(old.masters);
}

const cities: [string, () => SimInput | Promise<SimInput>][] = [
  ['bench', benchInput],
  ['fixture', fixtureInput]
];

describe.each(cities)('%s, one frame change at month 121', (name, load) => {
  let input: SimInput;
  let statics: Statics;
  beforeAll(async () => {
    input = await load();
    statics = staticsOf(input);
  });

  it.each(SEEDS)(
    `${name}: a zoning change at month m equals today’s dated regime (seed %i)`,
    (seed) => {
      const asOf = input.asOf;
      const rows = everyTenth(precomputeOf(input).candidates);
      const p2 = upzoned(input, rows);
      const old = simulateDetailed(
        oldInputOf(input, { regimes: [{ day: monthFirstDay(asOf, M), parcels: p2 }] }),
        seed,
        HORIZON
      );
      const after = frameOf(input, {
        id: 1,
        view: { parcels: p2, pre: precomputeOf({ ...input, parcels: p2 }) }
      });
      const t = changingAt(M, frameOf(input), after, touchedRows(input.parcels, p2));
      const w = runWorld(statics, t, seed, horizonMonth(asOf));
      expectSame(readAll(w, statics, HORIZON), withoutRegime(old));
    }
  );

  it.each(SEEDS)(
    `${name}: a market change at month m equals today’s market step (seed %i)`,
    (seed) => {
      const asOf = input.asOf;
      const s0 = marketAt(input, asOf);
      const old = simulateDetailed(
        oldInputOf(input, {
          market: [
            { from: asOf, logOdds: s0 },
            { from: monthFirstDay(asOf, M), logOdds: s0 + 0.4 }
          ]
        }),
        seed,
        HORIZON
      );
      const t = changingAt(M, frameOf(input), frameOf(input, { id: 1, market: s0 + 0.4 }), null);
      const w = runWorld(statics, t, seed, horizonMonth(asOf));
      expectSame(readAll(w, statics, HORIZON), old);
    }
  );

  // Some start ran on the new view: the zoning referee is not met by ignoring the change.
  it(`${name}: the zoning change reaches some start`, () => {
    const p2 = upzoned(input, everyTenth(precomputeOf(input).candidates));
    let seen = 0;
    for (const seed of SEEDS) {
      const old = simulateDetailed(
        oldInputOf(input, { regimes: [{ day: monthFirstDay(input.asOf, M), parcels: p2 }] }),
        seed,
        HORIZON
      );
      seen += old.schedules.filter((s) => s.regime === 1).length;
      if (seen > 0) break;
    }
    expect(seen).toBeGreaterThan(0);
  });
});
