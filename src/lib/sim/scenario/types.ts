// The simulation's schedule, input, card and score types (T5, T8), types only and worker-safe (no
// runtime exports). `protocol.ts` re-exports the card and the score.
import type { ParcelId } from '$lib/data/parcel';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import type { GeneratedBuilding } from '$lib/generator';
import type { Target } from '$lib/scoreboard';
import type { InFlightProject } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import type {
  Calibration,
  Dollars,
  ExitReason,
  LimitStatement,
  MarketStep,
  Pathway,
  Pool,
  PoolKind,
  Programme,
  Provenance,
  ResolvedTerms,
  Stage,
  TierUnits
} from '$lib/timelapse/types';
import type { StageScale } from '../levers/timers';

// T5
export interface Schedule {
  projectId: string;
  origin: 'pipeline' | 'simulated';
  parcelIds: ParcelId[];
  pathway: Pathway;
  entered: Partial<Record<Stage, Day>>;
  end:
    | { kind: 'complete'; day: Day }
    | { kind: 'exit'; stage: Stage; reason: ExitReason; day: Day }
    | { kind: 'open' }; // still in progress at horizon
  revisions: {
    day: Day;
    units: number;
    stories: number | null; /* null = unknown until massed */
  }[]; // [0] is the initial proposal; strictly ascending days (revisions due on one day are merged, the last wins); none after entered.construction; a revision due on the construction-entry day is the as-built proposal
  existingUnits: number;
  multiPhase: boolean;
  phase: {
    masterId: string;
    index: number; // 1-based
    of: number;
    start: 'scheduled' | 'estimated'; // scheduled = its permitFiled is the published plan date; estimated = the phaseGap stagger
  } | null; // a phase sub-project of a multi-phase master
  // A simulated project on a run with `regimes`: the view its initiation month ran on (size row,
  // yields, envelope, Local Program), 0 = `input.parcels`, k = `regimes[k - 1]`. Absent on every
  // other Schedule, including all of a run without regimes.
  regime?: number;
  // On a run whose input has `newProjects`: true when the schedule's job ran on `calibration`
  // (a pipeline row past preApplication, or a phase), so its map bar reads the in-flight lookups
  // (Call 15). Absent on every other Schedule, so a run without lever timers is unchanged.
  inFlight?: true;
  /** F10: 'affordable' for a funded affordable start; absent means market. */
  kind?: 'affordable';
  /**
   * F10: only on simulated schedules of a run with `finance`. `programmes` pay the project, in
   * `finance.programmes` order (a programme pays when its exact amount per home is above 0,
   * before rounding); `certain` is whether they fully fund it; the dollars are project totals;
   * `displaced` is the homes of the ordinary start this funded start pre-empted on its lot.
   */
  funding?: {
    programmes: string[];
    applied: Day;
    granted: Dollars;
    lent: Dollars;
    guaranteed: Dollars;
    displaced: number;
    certain: boolean;
  };
}
export type SimInput = {
  parcels: ScenarioParcels; // decoded T11
  projects: InFlightProject[];
  calibration: Calibration;
  asOf: Day;
  districtMaxStories: number | null; // projects.json `districtMaxStories.stories` (large-site massing §4.3, tier 2); null when absent
  // Policy levers (plan 2 ruling 3, "Policy start date = calibration.asOf"). Simulated projects and
  // pipeline rows at preApplication run on `newProjects`; every other row, master and phase on
  // `calibration`. Both calibrations are unscaled (paired-draw fix): `newProjects.scale` and
  // `inFlightScale` multiply the time in stage of every stage step of their cohort's jobs, fresh or
  // in flight (in-flight rows, masters and phases on `inFlightScale`; simulated projects and rows
  // at preApplication on `newProjects.scale`). Initiation, size, revision and phaseGap always read
  // `calibration`.
  newProjects?: { calibration: Calibration; scale: StageScale }; // absent = calibration, scale 1
  inFlightScale?: StageScale; // absent = 1
  // Dated regimes (the retired law switch, plan 2 ruling 1, generalised): from `regimes[k].day` the
  // view `regimes[k].parcels` is in force. A simulated project runs on the view of the month it
  // initiated in (size row, yields, envelope, Local Program) and its initiation hazard is
  // piecewise over the views; in-flight rows keep `parcels` above. Days strictly ascending and
  // every day > asOf; each view must have the same rows, ids and existingUnits as `parcels`
  // (the caller's contract; the world throws a RangeError only on a different row count or id
  // array length). Absent or [] = none.
  regimes?: { day: Day; parcels: ScenarioParcels }[];
  // Per T11 row, the day the parcel is reserved from (a later conversion's start), 0 = none. A
  // reservation is kept unless a project began on the row before the day and had not exited by
  // it; a kept one stops simulated initiations on or after the day (`Sink.reservation` reports
  // each). Same length as `parcels.count`, every non-zero day > asOf. Absent = none.
  reservedFrom?: Int32Array;
  // F3: the market term. Absent or [] means shift 0.
  market?: MarketStep[];
  // F9: public money. Absent means no public money at all.
  finance?: {
    pools: Pool[];
    programmes: Programme[];
    off: { pool: string; from: Day; to: Day | null }[];
    slope: number;
    terms: ResolvedTerms;
  };
};

export type Massing = GeneratedBuilding | { footprint: [lng: number, lat: number][] }; // timelapse-render's packTimedCell input entry
export type ProjectCard = {
  projectId: string;
  origin: 'pipeline' | 'simulated';
  label: string; // pipeline: T3 label, else 'Block B, Lot L'; simulated: always 'Block B, Lot L'
  pathway: Pathway;
  units: number;
  existingUnits: number; // pipeline: the project's T3 existingUnits; phase: the T11 sum of its own parcels; simulated: the T11 sum of its parcels not already demolished earlier in the run
  stories: number | null;
  storiesTier: 0 | 1 | 3 | 4 | null; // pipeline cards: 0 = recorded field, 3 = parsed from description text (both only for revisions[0]), 1 = a district massed at the curated DA height (its tallest lot is at that height; large-site massing §4.5), 4 = from the simulator's massing (drawn or raised district heights included) or a later revision's proportional scaling, null iff stories is null; simulated cards: always null (their stories are the simulated size draw)
  massing: 'matched' | 'approximate' | 'none';
  multiPhase: boolean;
  phase: Schedule['phase'];
  /** F10: copied from the schedule */
  kind?: 'affordable';
  /** F10: copied from the schedule */
  funding?: { programmes: string[]; certain: boolean };
  localProgram: boolean; // the project's parcel is a Local Program parcel and the project is simulated
  lookups: 'inFlight' | 'fresh'; // the chance table of the calibration it runs on: fresh for a simulated project and a pipeline row at preApplication at asOf (newProjects), else inFlight
  /** Months to add to the real months in `stage` before reading `chance` (in-flight rescale). */
  chanceShift: { stage: Stage; months: number } | null; // non-null only for the stage the engine conditions in flight with a scale x ≠ 1: inFlightMonths(m, x) - m, m = months in it at asOf
  stages: { stage: Stage; day: Day; actual: boolean }[]; // only stages entered <= day
  revisions: Schedule['revisions']; // only those <= day
  end: Schedule['end'] | null; // null if the end is after day
  sources: {
    dataset: string;
    id: string;
    key?: string; // field to query, e.g. 'case_no'; absent = the dataset's record-id field
  }[];
  quality: { label: string; tier: 2 | 3 | 4; valueTier: 0 | 1 | 2 | 3 | 4 | null }[]; // pipeline: T3 quality mapped through qualityRules, in id order; simulated: []. A display shows valueTier when non-null, else tier
};

// T8
export interface TimelineScore {
  months: Day[]; // months[i] = the 1st of the i-th month, starting with asOf's month and ending with the horizon's month; every series value at i is the state at the end of that month (events with day < months[i + 1], or <= horizon for the last entry)
  shown: {
    completedNet: number; // cumulative since asOf, simulation only, excludes baseline
    completedNetPipeline: number;
    completedNetNew: number;
    entitledNew: number; // cumulative net units of new (simulated) projects reaching entitled
    inProgress: Record<Exclude<Stage, 'complete'>, number>; // current proposed units of projects in each stage at that month
    exitedUnits: number; // cumulative
  }[];
  planEffect: { entitledNew: number; completedNetNew: number }[]; // shown seed: FZP run minus its paired old-zoning run (T9 `baseZoning`), cumulative net units
  planEffectBand: { p10: number; p50: number; p90: number }[]; // planEffect.completedNetNew over the N paired runs; planEffect and planEffectBand are [] until computed: always [] in revision 0, filled by later band-only updates
  band: { p10: number; p50: number; p90: number }[]; // completedNet over N runs, same basis as shown
  baseline: { completedNet: number; since: Day; provenance: Provenance };
  phasing: {
    masters: number;
    enrichedMasters: number;
    phasesScheduled: number; // plan date from a published schedule
    phasesEstimated: number; // fallback sizes or phaseGap stagger
    unenriched: { projectId: string; label: string | null; units: number; drawn: boolean }[]; // drawn false = score-only: no free DA parcel (DQ-3)
  };
  targets: TargetProgressAt[];
  references: {
    id: string;
    label: string;
    units: number;
    from: Day;
    by: Day;
    measure: 'planEffect.entitledNew' | 'planEffect.completedNetNew' | 'completedNet';
    provenance: Provenance;
  }[]; // published estimates, each compared with the matching shown series
  /** F14: present on every run (once `finance-score` fills it) */
  tiers?: {
    completed: TierUnits[]; // cumulative net new homes by tier at the end of month i
    baseline: TierUnits;
    targets: TargetProgressAt[]; // one per RHNA_TIER_TARGETS row; fraction[i] = (tier baseline + completed[i]) over its target
  };
  /** F14: only on a run with at least one pool; series per month at the month's end */
  money?: {
    pools: {
      id: string;
      label: string;
      kind: PoolKind;
      received: number[];
      committed: number[]; // amount outstanding
      out: number[]; // amount outstanding
      spent: number[];
      repaid: number[];
      lost: number[]; // every `loss` event, including grants paid to projects that then dropped out
      lostCredit: number[]; // the part of `lost` that is loan principal and guarantee reserves
    }[];
    fundedHomes: number[];
    displacedHomes: number[];
    publicSpent: number[];
    owed: { pool: string; principal: Dollars; repayment: number; nominal: true }[];
    limits: LimitStatement[];
  };
}
export type TargetProgressAt = {
  target: Target; // I11
  deadline: Day;
  fraction: number[]; // per month, (baseline + completedNet) / target, uncapped
};
