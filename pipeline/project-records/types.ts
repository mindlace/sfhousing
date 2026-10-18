/**
 * Types shared by every project-records step (parse, link, stages, ends, in-flight, multiphase,
 * deriveProjects). Internal to `pipeline/`; not a cross-subsystem interface.
 */
import type { ParcelId } from '../../src/lib/data/parcel';
import type { Day } from '../../src/lib/timelapse/time';
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
}

export interface ProjectRecordsInput {
  asOf: Day;
  raw: Record<ProjectSourceId, RawRow[]>;
  parcelIds: ReadonlySet<ParcelId>;
  lineage(blklot: string): ParcelId | null;
  assessorUnits(id: ParcelId, rollYear: number): number | null;
  latestRollYear: number;
  baseStories(id: ParcelId, rollYear: number): number | null;
  hiNet: Record<number, number>;
  areaM2(id: ParcelId): number;
  /** Parsed `multiphase.json` (spec 4.10.1). */
  multiphase: MultiphaseFile;
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
  /** `resolve(blklots)`. */
  parcelIds: ParcelId[];
}
