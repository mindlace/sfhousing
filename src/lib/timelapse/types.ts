/**
 * Shared FZP timelapse types (design doc rows T2, T4, T4a-d). Relative imports only: the data
 * pipeline imports this file by path. Worker-safe: no zod, no DOM.
 */
import type { ParcelId } from '../data/parcel';
import type { Day } from './time';

export type { Day } from './time';

// T2: stages, pathways and exits.

export type Stage =
  | 'preApplication'
  | 'filed'
  | 'entitled'
  | 'permitFiled'
  | 'permitIssued'
  | 'construction'
  | 'complete';
export type Pathway = 'discretionary' | 'streamlined' | 'permitOnly';
export type ExitReason = 'withdrawn' | 'disapproved' | 'cancelled' | 'expired';

/** The stages in T2 order. `preApplication` is optional on every pathway. */
export const STAGE_ORDER = [
  'preApplication',
  'filed',
  'entitled',
  'permitFiled',
  'permitIssued',
  'construction',
  'complete'
] as const satisfies readonly Stage[];

export const PATHWAYS = [
  'discretionary',
  'streamlined',
  'permitOnly'
] as const satisfies readonly Pathway[];

/** Within a month, outcomes are ordered advance first, then `EXIT_ORDER`. */
export const EXIT_ORDER: ExitReason[] = ['withdrawn', 'disapproved', 'cancelled', 'expired'];

/** The stages a pathway passes through, in order. A fresh array on every call. */
export function pathwayStages(p: Pathway): Stage[] {
  if (p === 'permitOnly') {
    return ['preApplication', 'permitFiled', 'permitIssued', 'construction', 'complete'];
  }
  return [...STAGE_ORDER];
}

// T4: calibration.

export interface Provenance {
  tier: 0 | 1 | 2 | 3 | 4;
  label: string;
  sources: { label: string; url: string }[];
  method: string;
  n?: number;
  window?: [from: string, to: string];
}

export interface Transition {
  months: number;
  advance: number[]; // cumulative incidence by month 1..months
  exit: Partial<Record<ExitReason, number[]>>;
  tail: { advance: number; exit: Partial<Record<ExitReason, number>> }; // constant monthly hazards beyond months
  provenance: Provenance;
  tailProvenance: Provenance; // tier 2: extrapolation beyond the observed months
}

/** The `scenarios/fzp/calibration.json` object. Keys are emitted in this order. */
export interface Calibration {
  schema: 1;
  asOf: Day;
  transitions: Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Transition>>>;
  initiation: InitiationModel;
  pathwayForNew: Record<Pathway, number> & { provenance: Provenance };
  ppaShare: Record<Pathway, number> & { provenance: Provenance }; // share of new projects that start at preApplication
  size: SizeModel;
  revision: RevisionModel;
  streamlinedForLocalProgram: Provenance; // tier 2: Local Program projects use the streamlined tables
  phaseGap: { days: number[]; provenance: Provenance }; // days: empirical gaps between successive phases' permitFiled
}

// T4a: initiation.

export type FeatureId =
  | 'potentialRatio' // yield units at full envelope ÷ max(existingUnits, 1); base variant uses the density-capped base yield (T13), FZP variant the Local Program yield (T11) — this is how density decontrol is seen
  | 'existingUnits'
  | 'lotAreaM2'
  | 'yearBuilt'
  | 'storiesGap' // envelope stories − existing stories
  | 'improvementShare' // improvement ÷ (land + improvement) assessed value
  | 'rentControlLikely' // 0/1: ≥ 2 units and built < 1979
  | 'landUseClass'; // categorical: residential, mixed, commercial, pdr, vacant, other

export interface InitiationModel {
  kind: 'logit-monthly';
  intercept: number;
  terms: {
    feature: FeatureId;
    bins: number[]; // ascending edges; categorical features use category index
    coef: number[]; // one per bin
  }[];
  provenance: Provenance;
}

// T4b: size.

export interface SizeModel {
  fillLevels: number[]; // ascending fractions of envelope stories; last = 1; length F matches T11 yield
  byEnvelope: {
    maxStoriesUpTo: number;
    probs: number[]; // length F, sums to 1
  }[];
  provenance: Provenance;
}

// T4c: revision.

export interface RevisionModel {
  at: {
    stage: Stage; // applied on entering this stage
    probability: number;
    ratio: { edges: number[]; probs: number[] }; // histogram of new units ÷ previous units
  }[];
  provenance: Provenance;
}

// T4d: project histories (pipeline-internal).

export interface ProjectHistory {
  id: string;
  pathway: Pathway | null; // null = unclassifiable: excluded from per-pathway tables, included in pooled ones
  parcelIds: ParcelId[];
  entered: Partial<Record<Stage, Day>>;
  end:
    | { kind: 'complete'; day: Day }
    | { kind: 'exit'; stage: Stage; reason: ExitReason; day: Day }
    | { kind: 'open'; lastObserved: Day };
  unitsAt: Partial<Record<Stage, number>>; // current proposed units from the record that represents each stage: PRJ → 'filed', site/full permit → 'permitFiled', TCO/CFC certified → 'complete'; cross-record, not snapshots (tier 2)
  existingUnits: number; // assessor units at filing: the roll year of the first entered day, clamped to 2007..latest
  storiesProposed: number | null;
  baseStoriesAtFiling: number | null; // current base height proxy, tier 3: no pre-FZP height map exists
  sources: {
    dataset: string;
    id: string;
    key?: string; // field to query, e.g. 'case_no'; absent = the dataset's record-id field
  }[];
  quality: string[]; // sorted T14 rule ids that changed or estimated a value of this history; [] if none
}

/** `pipeline/.cache/derived/<datasetVersion>/project-histories.json`; never shipped. */
export type ProjectHistoriesFile = { schema: 1; asOf: Day; histories: ProjectHistory[] };
