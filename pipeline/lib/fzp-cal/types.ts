/**
 * Internal types of the stage-calibration step (stage-calibration spec §2, §4.4, §4.11).
 * Pipeline-internal: nothing here ships in `calibration.json`.
 */
import type { ParcelId } from '../../../src/lib/data/parcel';
import type {
  Day,
  ExitReason,
  Pathway,
  ProjectHistory,
  Stage
} from '../../../src/lib/timelapse/types';

/** A stage a project can wait in: every stage but the terminal `complete`. */
export type CalStage = Exclude<Stage, 'complete'>;

/** The six registered `sc.*` T14 rules (spec §4.4a). */
export type ScRuleId =
  | 'sc.stages.gap-impute'
  | 'sc.stages.no-fcd-duration'
  | 'sc.stages.running-max'
  | 'sc.exit.last-stage'
  | 'sc.exit.purge-censor'
  | 'sc.revision.ratio-clamp';

export const SC_RULE_IDS: readonly ScRuleId[] = [
  'sc.stages.gap-impute',
  'sc.stages.no-fcd-duration',
  'sc.stages.running-max',
  'sc.exit.last-stage',
  'sc.exit.purge-censor',
  'sc.revision.ratio-clamp'
];

/** One rule's count for `recordQuality`: records changed, denominator, affected ids. */
export interface RuleTally {
  fired: number;
  of: number;
  sample: string[];
}

export type Tallies = Record<ScRuleId, RuleTally>;

/** One project's time in one stage (spec §2). */
export interface Spell {
  pathway: Pathway | null;
  stage: CalStage;
  /** age at which the spell enters the risk set, in days (left truncation at a window start) */
  a: number;
  /** entry day */
  e: Day;
  /** duration in days to `outcome` */
  x: number;
  outcome: 'advance' | ExitReason | 'censored';
  projectId: string;
  /**
   * Weight of the spell's at-risk contribution and event (default 1). Only observed advances of a
   * permit-side cell are weighted, to carry its no-FCD completions (ruling R13, `no-fcd.ts`).
   */
  w?: number;
}

/**
 * A `permitIssued` or `construction` spell of a no-FCD completion (partner ruling P1): the
 * project passed the stage, but when it left is unobserved, so it is not a spell. It counts in
 * the incidence of the cells it belongs to through `weightAdvances`.
 */
export interface UnobservedAdvance {
  projectId: string;
  /** after the defensive pathway rule */
  pathway: Pathway | null;
  stage: 'permitIssued' | 'construction';
  /** completion day */
  complete: Day;
  /**
   * `eff.permitIssued`; set on every `permitIssued` entry, absent on a `construction` entry of a
   * history that never entered permitIssued (a null-pathway history first seen at construction)
   */
  enteredPermitIssued?: Day;
}

/** A qualifying history after normalisation (spec §4.4 steps 1–6). */
export interface NormHistory {
  id: string;
  /** after the defensive pathway rule */
  pathway: Pathway | null;
  parcelIds: ParcelId[];
  /** effective entry days after steps 1 and 2 */
  eff: Partial<Record<Stage, Day>>;
  /** after steps 3 and 6 */
  end: ProjectHistory['end'];
  /** step 6 turned this history's exit into a censored observation */
  purgeCensored: boolean;
  /**
   * A completion with no construction start (no FCD: `entered.construction` missing or on the
   * completion day) that entered `permitIssued` or `construction`: its durations in those stages
   * are unobserved (`sc.stages.no-fcd-duration`, partner ruling P1). `normalise` always sets it;
   * absent (hand-built histories) means false.
   */
  noFcd?: boolean;
  src: ProjectHistory;
}

/**
 * One administrative purge window found by step 6 (spec §4.4), for the calibration report.
 * `exits`, `byReason`, `byStage` and `medianDays` cover every exit dated inside the window.
 */
export interface PurgeWindow {
  first: Day;
  last: Day;
  exits: number;
  censored: number;
  byReason: Partial<Record<ExitReason, number>>;
  byStage: Partial<Record<Stage, number>>;
  /** median duration x (days in the exit stage) of the window's exits */
  medianDays: number;
}

/** A row of the §4.4 fitting-window table. */
export interface CoverageRow {
  stage: CalStage;
  side: 'planning' | 'permit';
  pooledStart: string;
  pathwayStart: string;
  entryEnd?: string;
  evidence: string;
}

/** Method constants (spec §4.11); `LIVE_CAL` and `FIXTURE_CAL` in `config.ts`. */
export interface CalProfile {
  name: 'live' | 'fixture';
  nSpellsMin: number;
  nEventsMin: number;
  nRiskMin: number;
  kMax: number;
  tailSpan: number;
  tailMinEvents: number;
  minBinEvents: number;
  ridgeLambda: number;
  /** null: the initiation fit has no event floor (fixture) */
  initMinEvents: number | null;
  sizeMinN: number;
  revMinN: number;
  v27N: number;
  v27Tol: number;
  coverageGuard: boolean;
  purgeMinExits: number;
  purgeRatio: number;
  purgeMinDays: number;
  purgeGapDays: number;
  phPrior: number;
  phaseMinUnits: number;
  phaseMinGaps: number;
  fixtureInitiation: boolean;
  backcastGate: boolean;
}

/** One `permits.parquet` row, as read (nulls kept). */
export interface PermitRow {
  permit_number: string | null;
  project_id: string | null;
  prj_record_id: string | null;
  dva_record_id: string | null;
  prx_case_no: string | null;
  da: string | null;
  parcel_ids: string[];
  proposed_units: number | null;
  site_permit: boolean | null;
  status: string | null;
  live: boolean | null;
  superseded: boolean | null;
  filed_day: number | null;
  issued_day: number | null;
  construction_day: number | null;
  complete_day: number | null;
  status_day: number | null;
}

/** Aborts the calibration build (spec §4.13). */
export class CalibrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalibrationError';
  }
}
