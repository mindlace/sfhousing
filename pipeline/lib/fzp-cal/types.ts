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

/** The five registered `sc.*` T14 rules (spec §4.4a). */
export type ScRuleId =
  | 'sc.stages.gap-impute'
  | 'sc.stages.running-max'
  | 'sc.exit.last-stage'
  | 'sc.exit.purge-censor'
  | 'sc.revision.ratio-clamp';

export const SC_RULE_IDS: readonly ScRuleId[] = [
  'sc.stages.gap-impute',
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
  src: ProjectHistory;
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
