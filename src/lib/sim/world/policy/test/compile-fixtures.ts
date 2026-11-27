// Compile contexts on the mini city for the policy compiler's specs. Test values, not data.
import type { LayerCtx } from '$lib/sim/levers/layers';
import { miniFinance } from '$lib/sim/world/fixtures/mini-finance';
import { miniMarket } from '$lib/sim/world/fixtures/mini-market';
import { miniOptions } from '$lib/sim/world/fixtures/mini-options';
import { miniCity } from '$lib/sim/world/fixtures/mini-parcels';
import { miniPolicy } from '$lib/sim/world/fixtures/mini-policy';
import { miniProjectsJson } from '$lib/sim/world/fixtures/mini-projects';
import miniCalibrationJson from '$lib/sim/world/fixtures/mini-calibration.json';
import { buildSimInput } from '$lib/sim/world/input/build';
import type { SimInput } from '$lib/sim/world/input/types';
import { parseCalibration } from '$lib/timelapse/model';
import { parseProjectsFile } from '$lib/timelapse/projects';
import type { CompileCtx } from '../compile';

/** A clock the fakes advance: `now()` reads `t`. */
export interface FakeClock {
  t: number;
  now(): number;
}

export function fakeClock(): FakeClock {
  const c: FakeClock = { t: 0, now: () => c.t };
  return c;
}

/** The mini city's input and layers (as `levers/apply.spec.ts` sets them up). */
export function miniInput(opts: { finance?: boolean; market?: boolean } = {}): {
  input: SimInput;
  layers: LayerCtx;
} {
  const city = miniCity();
  const options = miniOptions(city);
  const plain = buildSimInput({
    parcels: city.parcels,
    projects: parseProjectsFile(miniProjectsJson(), { onInvalid() {} }),
    calibration: parseCalibration(structuredClone(miniCalibrationJson) as unknown),
    options
  });
  const input: SimInput = {
    ...plain,
    ...(opts.market ? { market: [{ from: plain.asOf, logOdds: miniMarket().today.all }] } : {}),
    ...(opts.finance ? { finance: miniFinance(plain.asOf) } : {})
  };
  return { input, layers: { parcels: city.parcels, policy: miniPolicy(city), options } };
}

/** A compile context on the mini city on `clock` (default 24 months). */
export function miniCompileCtx(
  opts: { finance?: boolean; market?: boolean; windowMonths?: number; clock?: FakeClock } = {}
): CompileCtx {
  const { input, layers } = miniInput(opts);
  const clock = opts.clock ?? fakeClock();
  return {
    input,
    layers,
    windowMonths: opts.windowMonths ?? 24,
    now: clock.now
  };
}
