/**
 * The fixture-0 calibration for fzp-mode unit tests: the committed e2e file, parsed through the
 * production parser. A JSON import, so it loads in both Vitest projects.
 */
import type { Calibration } from '$lib/timelapse/types';
import { parseCalibration } from '$lib/timelapse/model';
import json from '../../../../e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json';

let cached: Calibration | undefined;

/**
 * The parsed fixture calibration. One object per module: model.ts memoises per object, and no
 * test may mutate it.
 */
export function fixtureCalibration(): Calibration {
  cached ??= parseCalibration(json);
  return cached;
}

/**
 * A deep copy whose discretionary `entitled` transition is tier 3, so a stage path through
 * `entitled` is "partly based on research estimates". Never edits the shared object.
 */
export function tier3Calibration(): Calibration {
  const copy = structuredClone(fixtureCalibration());
  const entitled = copy.transitions.discretionary.entitled;
  if (entitled === undefined) throw new Error('fixture calibration has no discretionary.entitled');
  entitled.provenance.tier = 3;
  return copy;
}
