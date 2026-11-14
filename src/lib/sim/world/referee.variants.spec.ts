// The one-frame referee (see referee.spec.ts) under frames that are not the identity: a shifted
// market, a stage speed, a speedNew entry from the day after the dataset date, and route shares.
import { beforeAll, describe, expect, it } from 'vitest';
import { HORIZON } from '$lib/fzp/time';
import { routeSharesOp, type StageScale } from '$lib/sim/levers/timers';
import { simulateDetailed } from '$lib/sim/scenario/simulate';
import type { SimInput } from '$lib/sim/scenario/types';
import { staticsOf, type Statics } from './statics';
import { benchInput, fixtureInput } from './test/cities.node';
import { SEEDS, horizonMonth, readAll, runWorld } from './test/run';
import { frameOf, marketAt, oldInputOf, oneFrame, scaleProduct } from './test/timeline';
import type { PolicyFrame } from './policy/frame';
import type { OldOpts } from './test/timeline';

const A: StageScale = {
  discretionary: { filed: 0.6, entitled: 1.4 },
  streamlined: { permitFiled: 0.5 },
  permitOnly: { permitIssued: 1.3 }
};
const N: StageScale = {
  discretionary: { filed: 0.5, permitFiled: 0.7 },
  streamlined: {},
  permitOnly: { permitFiled: 2 }
};

function referee(input: SimInput, statics: Statics, seed: number, frame: PolicyFrame, o: OldOpts) {
  const old = simulateDetailed(oldInputOf(input, o), seed, HORIZON);
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

describe.each(cities)('%s, one frame variants', (name, load) => {
  let input: SimInput;
  let statics: Statics;
  beforeAll(async () => {
    input = await load();
    statics = staticsOf(input);
  });

  it.each(SEEDS)(`${name} market shifted, seed %i`, (seed) => {
    const logOdds = marketAt(input, input.asOf) + 0.5;
    referee(input, statics, seed, frameOf(input, { market: logOdds }), {
      market: [{ from: input.asOf, logOdds }]
    });
  });

  it.each(SEEDS)(`${name} speed not 1, seed %i`, (seed) => {
    referee(input, statics, seed, frameOf(input, { speed: A }), {
      inFlightScale: A,
      newScale: A
    });
  });

  it.each(SEEDS)(`${name} speedNew from asOf + 1, seed %i`, (seed) => {
    const frame = frameOf(input, {
      speed: A,
      speedNew: [{ from: input.asOf + 1, scale: N }]
    });
    referee(input, statics, seed, frame, {
      inFlightScale: A,
      newScale: scaleProduct(A, N)
    });
  });

  it.each(SEEDS)(`${name} route shares, seed %i`, (seed) => {
    const { cal } = routeSharesOp({ discretionary: 1, streamlined: 2, permitOnly: 1 })(
      input.calibration,
      input.parcels
    );
    referee(input, statics, seed, frameOf(input, { newCalibration: cal }), {
      newCalibration: cal
    });
  });
});
