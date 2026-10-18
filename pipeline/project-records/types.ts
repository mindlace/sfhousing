/**
 * Types shared by every project-records step (parse, link, stages, ends, in-flight, multiphase,
 * deriveProjects). Internal to `pipeline/`; not a cross-subsystem interface.
 */
import type { ParcelId } from '../../src/lib/data/parcel';
import type { Day } from '../../src/lib/timelapse/time';
import type { ConstructionVerifiedFile } from '../enrichment/construction-schema';
import type { MultiphaseFile } from '../enrichment/schema';

export type ProjectSourceId =
  | 'datasf-permits-newcon'
  | 'datasf-planning-projects'
  | 'datasf-planning-records'
  | 'datasf-planning-review'
  | 'datasf-unit-completions'
  | 'datasf-housing-production'
  | 'datasf-dev-pipeline';

export const PROJECT_SOURCE_IDS: readonly ProjectSourceId[] = [
  'datasf-permits-newcon',
  'datasf-planning-projects',
  'datasf-planning-records',
  'datasf-planning-review',
  'datasf-unit-completions',
  'datasf-housing-production',
  'datasf-dev-pipeline'
];

/** Lock id to DataSF dataset id. */
export const DATASET: Record<ProjectSourceId, string> = {
  'datasf-permits-newcon': 'i98e-djp9',
  'datasf-planning-projects': 'qvu5-m3a2',
  'datasf-planning-records': 'y673-d69b',
  'datasf-planning-review': 'd4jk-jw33',
  'datasf-unit-completions': 'j67f-aayr',
  'datasf-housing-production': 'xdht-4php',
  'datasf-dev-pipeline': '6jgi-cpb4'
};

export type RawRow = Record<string, unknown>;

export interface AddressRow {
  /** `block` + `lot` (both trimmed); null when either is missing. */
  blklot: string | null;
  streetNumber: string | null;
  streetName: string | null;
  streetSuffix: string | null;
  primary: boolean;
}

export interface Permit {
  number: string;
  sitePermit: boolean;
  /** Trimmed, lower-case; '' if absent. */
  status: string;
  statusDay: Day | null;
  /** `filed_date`, else `permit_creation_date`. */
  filedDay: Day | null;
  issuedDay: Day | null;
  fcdDay: Day | null;
  completedDateDay: Day | null;
  lastActivityDay: Day | null;
  stories: number | null;
  existingUnits: number | null;
  proposedUnits: number | null;
  /** `revised_cost`, else `estimated_cost` (dollars); null when neither is a number (Ruling E2). */
  valuation: number | null;
  rows: AddressRow[];
}

export interface Prj {
  recordId: string;
  status: string | null;
  address: string | null;
  blklot: string | null;
  openDay: Day | null;
  closeDay: Day | null;
  permits: string[];
  decision: string | null;
  decisionDay: Day | null;
  unitsProp: number | null;
  unitsExist: number | null;
  newConstruction: boolean;
  sb35: boolean;
  hsd: boolean;
  ab2162: boolean;
  description: string | null;
}

export interface Child {
  recordId: string;
  type: string;
  status: string | null;
  blklot: string | null;
  parentId: string | null;
  openDay: Day | null;
  closeDay: Day | null;
}

export interface Review {
  recordId: string;
  startType: string | null;
  startDay: Day | null;
  endType: string | null;
  endDay: Day | null;
}

export interface Completion {
  permit: string;
  day: Day | null;
  kind: 'TCO' | 'CFC' | null;
  units: number | null;
}

export interface HousingRow {
  bpa: string | null;
  /** `blocklot` (block + lot), trimmed; null when missing. */
  blklot: string | null;
  form: string | null;
  netUnits: number | null;
  firstCompletionDay: Day | null;
}

export interface PipelineRow {
  /** Position after the canonical sort. */
  idx: number;
  blklot: string | null;
  nameaddr: string | null;
  status: string | null;
  statusDay: Day | null;
  approvedDay: Day | null;
  caseNo: string | null;
  bpaNo: string | null;
  newUnits: number | null;
  existingUnits: number | null;
  proposedUnits: number | null;
  completedNewUnits: number | null;
  netUnits: number | null;
  description: string | null;
  da: string | null;
  /** `caseNo` ends with 'PRX'. */
  prx: boolean;
  /**
   * Set on the copy of a pipeline-only row with no valid status date that DQ-2 joined to a graph
   * project (spec 4.2 step 10). Such a row gives the project only its `sources` entry and the
   * pipeline match of 4.7: no date, units, label or stories are read from it.
   */
  linkedNoDate?: true;
}

export interface Parsed {
  asOf: Day;
  /** Key order = ascending permit number. */
  permits: Map<string, Permit>;
  /** Key order = ascending record id. */
  prjs: Map<string, Prj>;
  children: Child[];
  reviews: Review[];
  completions: Completion[];
  housing: HousingRow[];
  pipeline: PipelineRow[];
  counts: Record<string, number>;
  /**
   * Rule `pr.date.valid-range` (spec §4.1): non-empty date values read (`of`), those treated as
   * missing (`fired`), and the sorted source ids of the records holding one (`sample`).
   */
  dates: { of: number; fired: number; sample: string[] };
  /** The parsed records (any kind) that held a date `pr.date.valid-range` treated as missing. */
  clipped: ReadonlySet<object>;
  /**
   * Rule `pr.permits.placeholder-valuation`: permits with a `revised_cost` (`of`), those whose
   * placeholder under $1,000 was replaced by `estimated_cost` (`fired`), their numbers (`sample`).
   */
  placeholderValuation: { of: number; fired: number; sample: string[] };
  /** The permit numbers `pr.permits.placeholder-valuation` replaced. */
  placeholderPermits: ReadonlySet<string>;
}

export interface ProjectRecordsInput {
  asOf: Day;
  raw: Record<ProjectSourceId, RawRow[]>;
  parcelIds: ReadonlySet<ParcelId>;
  lineage(blklot: string): ParcelId | null;
  /**
   * The current parcels descended from a block-lot through the subdivision chain (main's ruling 3,
   * Ruling D1 revised; `descendantsIndex`): sorted, unique, every element in `parcelIds`.
   */
  descendants(blklot: string): ParcelId[];
  assessorUnits(id: ParcelId, rollYear: number): number | null;
  /** T13 `scenario_panel.year_built` for a parcel and roll year; null when absent. */
  yearBuilt(id: ParcelId, rollYear: number): number | null;
  /** T13 `scenario_panel.lien_day` of a roll year; null when the panel has no such year. */
  lienDay(rollYear: number): Day | null;
  /** T13 `scenario_panel.imputed` mask for a parcel and roll year; null when there is no row. */
  panelImputed(id: ParcelId, rollYear: number): number | null;
  latestRollYear: number;
  baseStories(id: ParcelId, rollYear: number): number | null;
  hiNet: Record<number, number>;
  areaM2(id: ParcelId): number;
  /** Parsed `multiphase.json` (spec 4.10.1). */
  multiphase: MultiphaseFile;
  /** Parsed `construction-verified.json` (spec 4.6, curated verdicts). */
  constructionVerified: ConstructionVerifiedFile;
}

/** A project after linking (spec 4.2): one connected component, or one split of it. */
export interface LinkedProject {
  id: string;
  kind: 'graph' | 'pipelineOnly' | 'ppaOnly';
  /** Non-satellite PRJs, by recordId. */
  anchors: Prj[];
  /** Anchor the lead permit is assigned to, else earliest open (tie: lowest id). */
  primary: Prj | null;
  /** PRJs whose permits all went to other PRJs; sources only. By recordId. */
  satellites: Prj[];
  /** Children of anchors, incl. PPAs (attached PPAs too), in parsed order. */
  children: Child[];
  /** Children of satellites, in parsed order. */
  sourceOnlyChildren: Child[];
  /** d4jk rows of anchors, in parsed order. */
  reviews: Review[];
  /** All permits, ascending number. */
  permits: Permit[];
  /** Permits that are not dead (and so not superseded), ascending number. */
  live: Permit[];
  /** Dead permits with a later-filed permit in the project. */
  superseded: Set<string>;
  lead: Permit | null;
  /** j67f rows of the project's permits, in parsed order. */
  completions: Completion[];
  /** By idx. */
  pipelineRows: PipelineRow[];
  /** Candidate block-lots (spec 4.2 Parcels), sorted unique. */
  blklots: string[];
  /** `resolve(blklots)` less the parcels `pr.parcels.cross-block` dropped. */
  parcelIds: ParcelId[];
  /**
   * Spec 4.2 Parcels, `pr.parcels.cross-block`: `applies` when at least one permit address lot
   * resolves to a parcel; `dropped` the PRJ-only parcels left out because their block holds no
   * permit parcel.
   */
  crossBlock: { applies: boolean; dropped: ParcelId[] };
}
