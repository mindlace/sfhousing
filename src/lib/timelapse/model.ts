/**
 * Calibration model (design doc T12): pure, zod-free and worker-safe. These are signature stubs
 * so every consumer compiles against the final API from day one; the bodies land in
 * stage-calibration step 2.
 */
import type {
  Calibration,
  ExitReason,
  FeatureId,
  InitiationModel,
  Pathway,
  Stage,
  Transition
} from './types';

export function sampleTransition(
  _t: Transition,
  _u: number,
  _monthsElapsed: number
): { kind: 'advance' | ExitReason; days: number } {
  throw new Error('not implemented');
}

export function initiationHazard(_m: InitiationModel, _f: Record<FeatureId, number>): number {
  throw new Error('not implemented');
}

export function chanceTable(
  _cal: Calibration
): Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Float32Array>>> {
  throw new Error('not implemented');
}

export function typicalMonths(
  _cal: Calibration
): Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, number>>> {
  throw new Error('not implemented');
}

export function parseCalibration(_json: unknown): Calibration {
  throw new Error('not implemented');
}
