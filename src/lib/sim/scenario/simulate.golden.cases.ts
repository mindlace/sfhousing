/**
 * The input and run of the cross-engine `simulate` golden (AC 1). The builder
 * (`fixtures/build-golden.ts`, Node) writes `fixtures/golden-seed1.json` from `goldenRun`;
 * `simulate.golden.shared.ts` (the server test and the client project's browser spec) reruns it
 * and compares deep-equal. Browser-safe: the parcels come from `miniCity()` directly, never through
 * the Node-only `parcels.bin` deflate. Test support only: nothing in the app imports it.
 */
import { parseCalibration } from '$lib/timelapse/model';
import { parseProjectsFile } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import { dayOf } from './dates';
import miniCalibrationJson from './fixtures/mini-calibration.json';
import { miniCity } from './fixtures/mini-parcels';
import { miniProjectsJson } from './fixtures/mini-projects';
import { buildSimInput } from './input';
import { simulate } from './simulate';
import type { Schedule, SimInput } from './types';

export const GOLDEN_SEED = 1;
export const GOLDEN_HORIZON: Day = dayOf(2050, 12, 31);

/** The mini city's FZP SimInput, built from the three decoded files. */
export function goldenInput(): SimInput {
  return buildSimInput({
    parcels: miniCity().parcels,
    projects: parseProjectsFile(miniProjectsJson(), { onInvalid() {} }),
    calibration: parseCalibration(structuredClone(miniCalibrationJson) as unknown)
  });
}

export type GoldenRun = { seed: number; horizon: Day; schedules: Schedule[] };

/** `simulate(goldenInput(), 1, 2050-12-31)`, as the golden file holds it (a JSON round trip). */
export function goldenRun(): GoldenRun {
  const schedules = simulate(goldenInput(), GOLDEN_SEED, GOLDEN_HORIZON);
  return JSON.parse(
    JSON.stringify({ seed: GOLDEN_SEED, horizon: GOLDEN_HORIZON, schedules })
  ) as GoldenRun;
}
