// The car system of a loaded dataset: built once per dataset load (the timeline host's
// `loadDataset`) and shared by both /sim worlds, as the world core it plugs into
// (`withFunding(funding, cars)`). Null for a dataset without cars.bin or without
// `calibration.cars`, and when switched off (`level2-check --cars off`): the worlds then run as before the car model.
import type { Loaded } from '$lib/sim/scenario/load';
import type { CarSystem } from '../types';
import { createCarSystem } from './system';

export interface CarSystemOfOptions {
  /** True: no car system at all (`level2-check --cars off`). */
  off?: boolean;
}

/**
 * `createCarSystem(loaded.cars, calibration.cars)`, the link on iff the model's
 * `parking.costPerSpace` is set; null without either input, or with `off`.
 */
export function carSystemOf(
  loaded: Pick<Loaded, 'cars' | 'fzp'>,
  opts: CarSystemOfOptions = {}
): CarSystem | null {
  const model = loaded.fzp.calibration.cars;
  if (opts.off === true || loaded.cars === null || model === undefined) return null;
  return createCarSystem(loaded.cars, model);
}
