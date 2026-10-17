// sfh-scenario/1 codec: step-0 declarations only. Constants, types and function
// signatures are in place so timelapse-sim and stage-calibration can compile against
// them. The function bodies land in scenario-data step 1.
import type { FeatureId, Provenance } from '../timelapse/types';
import type { ParcelId } from './parcel';
import type { Envelope } from '../plan/types';

export const SCENARIO_FORMAT = 'sfh-scenario/1';
/** T4b fill levels; F = FILL_LEVELS.length = 5. stage-calibration imports this constant. */
export const FILL_LEVELS = [0.25, 0.5, 0.75, 0.9, 1] as const;
/** The T4b proposal rule, shared so the pipeline and the worker round identically. */
export const fillStories = (fill: number, maxStories: number) =>
  Math.max(1, Math.round(fill * maxStories));
export const LAND_USE_CLASSES = [
  'residential',
  'mixed',
  'commercial',
  'pdr',
  'vacant',
  'other'
] as const;
export type LandUseClass = (typeof LAND_USE_CLASSES)[number];

/** Decoded T11 (T5's `ScenarioParcels`). Struct of arrays; row i is one parcel; rows sorted by (cellId, id). */
export interface ScenarioParcels {
  format: 'sfh-scenario/1';
  datasetVersion: string;
  scenario: 'fzp';
  rollYear: number; // latest closed_roll_year the features come from
  count: number;
  fillLevels: number[];
  cells: { cellId: string; start: number; count: number }[];
  districts: string[]; // normalised height strings; '' = no district
  provenance: Record<
    'envelope' | 'localProgram' | 'features' | 'existingUnits' | 'yield',
    Provenance
  >;
  id: string[];
  index: Map<ParcelId, number>;
  labelPoint: Float64Array; // 2 per row, lng/lat, exact to 1e-7
  cell: Uint16Array; // index into cells
  district: Uint16Array; // index into districts
  envelopeStories: Uint8Array; // T11 envelope.maxStories (0 = no envelope)
  baseStories: Uint8Array;
  localProgram: Uint8Array; // 0/1
  hostable: Uint8Array; // 0/1: may receive a simulated project
  split: Uint8Array; // 0/1: largest district overlap < 90% of parcel area
  imputed: Uint8Array; // bit 0 yearBuilt, 1 existingStories, 2 improvementShare, 4 no roll row (bit 3 unused)
  baseCap: Uint16Array; // T11 base-zoning density cap in units; 0xFFFF = null (no cap)
  existingUnits: Uint16Array;
  existingStories: Uint8Array;
  lotAreaM2: Uint32Array;
  yearBuilt: Uint16Array;
  improvementShare: Float32Array;
  rentControlLikely: Uint8Array;
  landUseClass: Uint8Array; // index into LAND_USE_CLASSES
  hostableBase: Uint8Array; // 0/1: T11 hostable_base (eligible, baseStories ≥ 1, baseYield[F−1] > 0)
  baseYield: Uint16Array; // count × F: gross units at each fill level of the base envelope, density-capped
  yield: Uint16Array; // count × F, row-major: yield[i * F + k]
  potentialRatio: { fzp: Float32Array; base: Float32Array }; // derived at decode
  storiesGap: { fzp: Int16Array; base: Int16Array }; // derived at decode
}
export function encodeScenarioPayload(_p: ScenarioParcels): Uint8Array {
  throw new Error('not implemented');
} // deterministic
export function decodeScenarioPayload(_bytes: Uint8Array): ScenarioParcels {
  throw new Error('not implemented');
} // sync; throws ScenarioFormatError
export async function readScenarioParcels(
  _body: ReadableStream<Uint8Array> | Uint8Array
): Promise<ScenarioParcels> {
  throw new Error('not implemented');
} // inflate + decode
export function featureValue(
  _p: ScenarioParcels,
  _i: number,
  _f: FeatureId,
  _env: 'fzp' | 'base'
): number {
  throw new Error('not implemented');
}
export function envelopeOf(_p: ScenarioParcels, _i: number): Envelope {
  throw new Error('not implemented');
} // { maxStories: envelopeStories[i] }

export class ScenarioFormatError extends Error {
  name = 'ScenarioFormatError';
}
