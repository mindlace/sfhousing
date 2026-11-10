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
  /** F2: the market term and its slope; absent means shift 0 and no slope (no programme can be compiled). */
  market?: MarketModel;
  /**
   * F12: the pathway shares of projects of 10 homes or more, first recorded in the planning-side
   * window, whose Planning record proposes at least 95% affordable homes (sum to 1).
   */
  affordableRoutes?: Record<Pathway, number> & { provenance: Provenance };
  /**
   * F12: today's public funding of affordable homes. `provenance` holds one entry per pool in
   * `pools` order, then one for the programmes' `tiers` and `minHomes`. Absent means no baseline
   * funding.
   */
  baselineFunding?: {
    pools: Pool[];
    programmes: Programme[];
    provenance: Provenance[];
    check: {
      impliedHomesPerYear: number;
      observedHomesPerYear: number;
      provenance: Provenance;
    };
  };
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
  /** The primary Planning record's `number_of_units_prop` and `number_affordable_units_prop`;
   * null when the project has no primary Planning record. Absent (hand-built histories) = null. */
  planningProposed?: { units: number | null; affordable: number | null } | null;
}

/** `pipeline/.cache/derived/<datasetVersion>/project-histories.json`; never shipped. */
export type ProjectHistoriesFile = { schema: 1; asOf: Day; histories: ProjectHistory[] };

// F1: money and income tiers (sim-financing step 0).

/** Whole constant dollars of the dataset's `asOf` year. */
export type Dollars = number;
export type IncomeTier = 'veryLow' | 'low' | 'moderate' | 'aboveModerate';
export const INCOME_TIERS = [
  'veryLow',
  'low',
  'moderate',
  'aboveModerate'
] as const satisfies readonly IncomeTier[];
/** `unrecorded` is income-restricted homes whose tier the records do not give. */
export type TierUnits = Record<IncomeTier, number> & { unrecorded: number };
export type ProjectKind = 'market' | 'affordable';

// F2: the market term.

/**
 * From `from` on, `logOdds` is added to every lot's initiation log-odds. Steps are strictly
 * ascending by `from` and the first is at or before `asOf`.
 */
export interface MarketStep {
  from: Day;
  logOdds: number;
}

export interface MarketModel {
  today: {
    /** natural log of observed starts over implied starts in the last three panel years */
    all: number;
    /** the same, with the observed count restricted to starts not proposing at least 95% affordable homes */
    private: number;
    /** first and last of the panel years */
    years: [number, number];
    observed: { all: number; private: number };
    implied: number;
    provenance: Provenance;
  };
  /** the Controller's coefficients on its own indices: reported, never applied */
  crossCheck: { logOdds: number; provenance: Provenance };
  slope: {
    /** log-odds shift for public money equal to 100% of a project's construction cost */
    perCostShare: number;
    provenance: Provenance;
    /** the same quantity from the Controller's cost and price coefficients: reported, never applied */
    crossChecks: { costCoefficient: number; priceCoefficient: number; provenance: Provenance };
  };
}

// F5: pools.

/**
 * A yearly inflow arrives on `from` and on the same month and day of each later year (29 February
 * becomes 28 February in a common year), up to `to` inclusive; an arrival before the run's
 * `asOf` is never received.
 */
export type Inflow =
  | { kind: 'once'; day: Day; dollars: Dollars }
  | { kind: 'yearly'; from: Day; to: Day | null; dollarsPerYear: Dollars };

export type PoolKind =
  'goBond' | 'cop' | 'generalRevenue' | 'dedicatedTax' | 'state' | 'federal' | 'bank';

export interface Pool {
  id: string;
  kind: PoolKind;
  label: string;
  inflows: Inflow[];
  /** can always pay and has no inflows (in the baseline, only the federal tax-credit pool) */
  uncapped: boolean;
  /** non-null exactly for `goBond` and `cop`; rate in (0, 0.25], termYears 1 to 40 */
  debt: { rate: number; termYears: number } | null;
  /** dollars a pool may have committed or out per dollar received: 1 for every kind but `bank` */
  leverage: number;
}

// F6: programmes.

/**
 * A grant pays `share` (0 < share <= 1) of the project's uncovered cost per home. A loan lends
 * `costShare` of cost per home at `rate`, repaid to its pool on completion; `requiredReturn`,
 * when set, is the return the lent capital accepts in place of the market's (0.01 to 0.25). A
 * guarantee covers a private loan of `costShare` of cost per home and holds `reserve` (a share of
 * that loan) in its pool until completion.
 */
export type Instrument =
  | { kind: 'grant'; share: number }
  | { kind: 'loan'; costShare: number; rate: number; requiredReturn: number | null }
  | { kind: 'guarantee'; costShare: number; reserve: number };

export interface Programme {
  id: string;
  label: string;
  /** a pool id */
  pool: string;
  reach: ProjectKind;
  instrument: Instrument;
  from: Day;
  to: Day | null;
  /** a whole number, 0 to 10,000 */
  minHomes: number;
  /** shares summing to 1; required for `reach: 'affordable'`, null otherwise */
  tiers: Record<IncomeTier, number> | null;
}

// F8: market terms.

export type TermKey =
  'constructionRate' | 'constructionYears' | 'requiredReturn' | 'guaranteeRateCut' | 'lossOnExit';

/** Each term a number, or null when it is unsourced and not typed; `custom` names the typed ones. */
export type ResolvedTerms = Record<TermKey, number | null> & { custom: TermKey[] };

// F14: a legal limit the policy's borrowing meets or exceeds.

export type LimitStatement = {
  id: 'goRate' | 'goCap' | 'goVote' | 'copCap';
  exceeded: boolean;
  text: string;
  provenance: Provenance;
};
