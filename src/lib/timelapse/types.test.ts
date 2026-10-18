import { describe, expect, it } from 'vitest';
import type { ParcelId } from '../data/parcel';
import {
  chanceTable,
  cumulativeIncidence,
  initiationHazard,
  parseCalibration,
  sampleTransition,
  typicalMonths
} from './model';
import type { Day } from './time';
import {
  EXIT_ORDER,
  PATHWAYS,
  STAGE_ORDER,
  pathwayStages,
  type Calibration,
  type ExitReason,
  type FeatureId,
  type InitiationModel,
  type Pathway,
  type ProjectHistory,
  type ProjectHistoriesFile,
  type Provenance,
  type RevisionModel,
  type SizeModel,
  type Stage,
  type Transition
} from './types';

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

// Each row below is restated literally from the design doc interface table
// (docs/superpowers/design/2026-10-16-1903-fzp-timelapse.md), then compared with the export.

// T2
type RowStage =
  | 'preApplication'
  | 'filed'
  | 'entitled'
  | 'permitFiled'
  | 'permitIssued'
  | 'construction'
  | 'complete';
type RowPathway = 'discretionary' | 'streamlined' | 'permitOnly';
type RowExitReason = 'withdrawn' | 'disapproved' | 'cancelled' | 'expired';

// T4
interface RowProvenance {
  tier: 0 | 1 | 2 | 3 | 4;
  label: string;
  sources: { label: string; url: string }[];
  method: string;
  n?: number;
  window?: [from: string, to: string];
}
interface RowTransition {
  months: number;
  advance: number[];
  exit: Partial<Record<RowExitReason, number[]>>;
  tail: { advance: number; exit: Partial<Record<RowExitReason, number>> };
  provenance: RowProvenance;
  tailProvenance: RowProvenance;
}
interface RowCalibration {
  schema: 1;
  asOf: Day;
  transitions: Record<RowPathway, Partial<Record<Exclude<RowStage, 'complete'>, RowTransition>>>;
  initiation: RowInitiationModel;
  pathwayForNew: Record<RowPathway, number> & { provenance: RowProvenance };
  ppaShare: Record<RowPathway, number> & { provenance: RowProvenance };
  size: RowSizeModel;
  revision: RowRevisionModel;
  streamlinedForLocalProgram: RowProvenance;
  phaseGap: { days: number[]; provenance: RowProvenance };
}

// T4a
type RowFeatureId =
  | 'potentialRatio'
  | 'existingUnits'
  | 'lotAreaM2'
  | 'yearBuilt'
  | 'storiesGap'
  | 'improvementShare'
  | 'rentControlLikely'
  | 'landUseClass';
interface RowInitiationModel {
  kind: 'logit-monthly';
  intercept: number;
  terms: { feature: RowFeatureId; bins: number[]; coef: number[] }[];
  provenance: RowProvenance;
}

// T4b
interface RowSizeModel {
  fillLevels: number[];
  byEnvelope: { maxStoriesUpTo: number; probs: number[] }[];
  provenance: RowProvenance;
}

// T4c
interface RowRevisionModel {
  at: {
    stage: RowStage;
    probability: number;
    ratio: { edges: number[]; probs: number[] };
  }[];
  provenance: RowProvenance;
}

// T4d
interface RowProjectHistory {
  id: string;
  pathway: RowPathway | null;
  parcelIds: ParcelId[];
  entered: Partial<Record<RowStage, Day>>;
  end:
    | { kind: 'complete'; day: Day }
    | { kind: 'exit'; stage: RowStage; reason: RowExitReason; day: Day }
    | { kind: 'open'; lastObserved: Day };
  unitsAt: Partial<Record<RowStage, number>>;
  existingUnits: number;
  storiesProposed: number | null;
  baseStoriesAtFiling: number | null;
  sources: { dataset: string; id: string; key?: string }[];
  quality: string[];
}
type RowProjectHistoriesFile = { schema: 1; asOf: Day; histories: RowProjectHistory[] };

// T12
type RowSampleTransition = (
  t: RowTransition,
  u: number,
  monthsElapsed: number
) => { kind: 'advance' | RowExitReason; days: number };
type RowCumulativeIncidence = (
  t: RowTransition,
  k: number
) => { advance: number; exit: Partial<Record<RowExitReason, number>> };
type RowInitiationHazard = (m: RowInitiationModel, f: Record<RowFeatureId, number>) => number;
type RowChanceTable = (
  cal: RowCalibration
) => Record<RowPathway, Partial<Record<Exclude<RowStage, 'complete'>, Float32Array>>>;
type RowTypicalMonths = (
  cal: RowCalibration
) => Record<RowPathway, Partial<Record<Exclude<RowStage, 'complete'>, number>>>;
type RowParseCalibration = (json: unknown) => RowCalibration;

const rowsMatch: Assert<
  Equals<Stage, RowStage> extends true
    ? Equals<Pathway, RowPathway> extends true
      ? Equals<ExitReason, RowExitReason> extends true
        ? Equals<Provenance, RowProvenance> extends true
          ? Equals<Transition, RowTransition> extends true
            ? Equals<Calibration, RowCalibration> extends true
              ? Equals<FeatureId, RowFeatureId> extends true
                ? Equals<InitiationModel, RowInitiationModel> extends true
                  ? Equals<SizeModel, RowSizeModel> extends true
                    ? Equals<RevisionModel, RowRevisionModel> extends true
                      ? Equals<ProjectHistory, RowProjectHistory> extends true
                        ? Equals<ProjectHistoriesFile, RowProjectHistoriesFile> extends true
                          ? Equals<typeof sampleTransition, RowSampleTransition> extends true
                            ? Equals<typeof initiationHazard, RowInitiationHazard> extends true
                              ? Equals<typeof chanceTable, RowChanceTable> extends true
                                ? Equals<typeof typicalMonths, RowTypicalMonths> extends true
                                  ? Equals<
                                      typeof parseCalibration,
                                      RowParseCalibration
                                    > extends true
                                    ? Equals<typeof cumulativeIncidence, RowCumulativeIncidence>
                                    : false
                                  : false
                                : false
                              : false
                            : false
                          : false
                        : false
                      : false
                    : false
                  : false
                : false
              : false
            : false
          : false
        : false
      : false
    : false
> = true;

describe('compile-time row checks', () => {
  it('exported types equal the design-doc rows', () => {
    expect(rowsMatch).toBe(true);
  });
});

describe('stage constants', () => {
  it('STAGE_ORDER lists the seven stages in T2 order', () => {
    expect([...STAGE_ORDER]).toEqual([
      'preApplication',
      'filed',
      'entitled',
      'permitFiled',
      'permitIssued',
      'construction',
      'complete'
    ]);
  });

  it('PATHWAYS and EXIT_ORDER have the exact values', () => {
    expect([...PATHWAYS]).toEqual(['discretionary', 'streamlined', 'permitOnly']);
    expect(EXIT_ORDER).toEqual(['withdrawn', 'disapproved', 'cancelled', 'expired']);
  });

  it('pathwayStages gives every stage to discretionary and streamlined', () => {
    expect(pathwayStages('discretionary')).toEqual([...STAGE_ORDER]);
    expect(pathwayStages('streamlined')).toEqual([...STAGE_ORDER]);
  });

  it('pathwayStages skips filed and entitled for permitOnly', () => {
    expect(pathwayStages('permitOnly')).toEqual([
      'preApplication',
      'permitFiled',
      'permitIssued',
      'construction',
      'complete'
    ]);
  });

  it('pathwayStages returns a fresh array each call', () => {
    const a = pathwayStages('discretionary');
    a.pop();
    a.push('filed');
    expect(pathwayStages('discretionary')).toEqual([...STAGE_ORDER]);
    const b = pathwayStages('permitOnly');
    b.length = 0;
    expect(pathwayStages('permitOnly')).toHaveLength(5);
  });
});

describe('model stubs', () => {
  it('remaining T12 stubs throw not implemented', () => {
    expect(() => parseCalibration({})).toThrow('not implemented');
  });
});
