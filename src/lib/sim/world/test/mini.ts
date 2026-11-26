import { buildSimInput } from '$lib/sim/scenario/input';
import type { SimInput } from '$lib/sim/scenario/types';
import miniCalibrationJson from '$lib/sim/scenario/fixtures/mini-calibration.json';
import { miniCity } from '$lib/sim/scenario/fixtures/mini-parcels';
import { miniProjectsJson } from '$lib/sim/scenario/fixtures/mini-projects';
import { parseCalibration } from '$lib/timelapse/model';
import { parseProjectsFile } from '$lib/timelapse/projects';

/** The mini city's FZP SimInput, built from the three decoded files, finance included. */
export function miniFzpInput(): SimInput {
  return buildSimInput({
    parcels: miniCity().parcels,
    projects: parseProjectsFile(miniProjectsJson(), { onInvalid() {} }),
    calibration: parseCalibration(structuredClone(miniCalibrationJson) as unknown)
  });
}

let memo: SimInput | null = null;

/** The mini city's FZP input without public money. Browser-safe. */
export function miniInput(): SimInput {
  if (!memo) {
    const { finance: _finance, ...rest } = miniFzpInput();
    void _finance;
    memo = rest;
  }
  return memo;
}
