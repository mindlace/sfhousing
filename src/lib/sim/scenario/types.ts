// Step 0 of the FZP timelapse build: the worker scenario protocol types (T5, T6, T8), types
// only and worker-safe (no runtime exports). `protocol.ts` re-exports this module; fzp-mode and
// timelapse-render import it. timelapse-sim implements behaviour against it from step 3.
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId } from '$lib/data/parcel';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import type { GeneratedBuilding } from '$lib/generator';
import type { HeightCity, HeightLids } from '$lib/map/height/types';
import type { PackedCell, TimelineUpdate } from '$lib/map/types';
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
import type { LeverLookups } from '../levers/apply';
import type { BrushCatalog, BrushQuery } from '../levers/brushes';
import type { LeverCapacity } from '../levers/resolve';
import type { LimitOwner } from '../levers/source';
import type { StageScale } from '../levers/timers';
import type { LotOutlines } from '../outlines';
import type { SimLevers } from '../levers/types';
import type { PlaybackRequest, PlaybackResponse } from '../lesscars/types';
import type {
  ChunksResponse,
  ParcelSummary,
  ReadyResponse,
  Rev,
  SimRequest,
  SimResponse
} from '../protocol';

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
  // (the caller's contract; `runEngine` throws a RangeError only on a different row count or id
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
export type Simulate = (input: SimInput, seed: number, horizon: Day) => Schedule[];

// T6
export type ScenarioRequest =
  | Extract<SimRequest, { type: 'prefetch' | 'retryChunks' }>
  | {
      type: 'initScenario';
      rev: Rev;
      manifest: Manifest;
      scenario: 'fzp';
      seed: number | null; // null = representative seed
      horizon: Day;
      levers?: SimLevers; // /sim (plan 2); absent = /fzp, which never fetches policy.bin
      // Only with `levers`: run no revision from them; wait for the first `setLevers`, and post
      // nothing but `ready`, errors and request answers until it is current (an `/s/<id>` open).
      awaitLevers?: boolean;
    }
  // `swap` (the run slider): revision 0 goes out after one packing slice, viewport cells first,
  // and the page installs it over the cells on the map; the rest follow in later revisions.
  | { type: 'reroll'; rev: Rev; seed: number | null; swap?: true }
  // A barrier rev like reroll; needs a session initialised with levers. The latest one wins.
  | { type: 'setLevers'; rev: Rev; levers: SimLevers }
  | {
      type: 'parcelSummary';
      reqId: number;
      parcelId: ParcelId;
      day: Day;
      projectId?: string;
    }
  // Brushes (plan 3): answered only in a session initialised with levers, once it has loaded.
  | { type: 'resolveBrush'; reqId: number; query: BrushQuery }
  | { type: 'brushCatalog'; reqId: number }
  // Map overlays (plan 2 Task 5): the ring outlines of lots, answered like `resolveBrush`.
  | { type: 'lotOutlines'; reqId: number; lots: ParcelId[] }
  // Live preview (plan 2 Task 6, sim UX plan 3 Task 4): the buildings a Paint stroke's lots could
  // hold at `stories`. The page sends the lots nearest first.
  | { type: 'previewBuildings'; reqId: number; lots: ParcelId[]; stories: number }
  // Glass lids (height-lids Task 8): the lids of the loaded lots in a view (lng/lat bbox),
  // answered on the latest complete city of a session initialised with levers.
  | { type: 'heightLids'; reqId: number; bbox: [number, number, number, number] }
  // Map selection (sim UX plan 4 Task 3): the lot under a point (lng, lat) and who sets its limit,
  // answered at once from the limits the worker holds.
  | { type: 'lotAt'; reqId: number; point: [number, number] };
/**
 * The glass lids of a view, built on the latest complete city (`lids.limitsRev`). `missing`
 * counts the cells intersecting the bbox whose chunks are not loaded (the page asks again as they
 * load). `no-session`: no session with levers (or it ended before answering); `superseded`: a
 * newer `heightLids` replaced this one; `too-large`: the bbox spans too far for lids.
 */
export type HeightLidsResult =
  | { ok: true; lids: HeightLids; missing: number }
  | { ok: false; reason: 'no-session' | 'superseded' | 'too-large'; message: string };
/**
 * The lot under a point, built or vacant, and the layer that sets its height limit. `parcelId` is
 * null where no loaded lot holds the point. `owner` is null when the lot has no row in the limits
 * table or the session has no limits yet. `no-session`: no session with levers.
 */
export type LotAtResult =
  | { ok: true; parcelId: ParcelId | null; owner: LimitOwner | null }
  | { ok: false; reason: 'no-session'; message: string };
/**
 * The buildings a preview's lots could hold, packed as one cell (`'preview'`), or null when none
 * builds. `built` counts the lots packed; `missing` the requested lots (within the cap) whose
 * record is not loaded. `no-session`: no session with levers (or it ended before answering).
 */
export type PreviewResult =
  | { ok: true; pack: PackedCell | null; built: number; missing: number }
  | { ok: false; reason: 'no-session'; message: string };
/**
 * The outlines of requested lots, for the dashed overlay while the eraser is chosen. `positions`
 * holds lng/lat pairs of every ring of every loaded lot (transferred); `starts` the vertex index
 * where each ring starts (rings + 1 entries); `ringLot` each ring's index into `lots` (the lots
 * answered, in request order). `missing` counts requested lots whose record is not loaded.
 * `no-session`: no session with levers (or it ended before answering).
 */
export type LotOutlinesResult =
  | (LotOutlines & { ok: true; missing: number })
  | { ok: false; reason: 'no-session'; message: string };
/**
 * A brush's lots: `points` holds each lot's label point (lng, lat), transferred. `no-session`: no
 * session with levers (or it ended before answering); `data-missing`: a file the query needs is
 * absent from the manifest or failed to load; `bad-request`: the query is malformed.
 */
export type BrushLotsResult =
  | { ok: true; lots: ParcelId[]; points: Float64Array }
  | { ok: false; reason: 'no-session' | 'data-missing' | 'bad-request'; message: string };
export type TimelineResponse = {
  type: 'timeline';
  rev: Rev;
  seed: number;
  render: TimelineUpdate;
  score: TimelineScore;
  bandRuns: number; // band runs finished so far; the band is provisional until bandRuns = bandRunsTotal
  bandRunsTotal: number; // N
  complete: boolean; // all loaded cells packed
};
export type Massing = GeneratedBuilding | { footprint: [lng: number, lat: number][] }; // timelapse-render's packTimedCell input entry
export type ScenarioErrorCode =
  'manifest-invalid' | 'scenario-missing' | 'scenario-invalid' | 'bad-request' | 'internal';
export type ScenarioResponse =
  | ReadyResponse
  | ChunksResponse
  | TimelineResponse
  | { type: 'error'; rev: Rev; code: ScenarioErrorCode; message: string }
  | { type: 'parcelSummary'; reqId: number; summary: ParcelSummary | null }
  | { type: 'brushLots'; reqId: number; result: BrushLotsResult }
  | { type: 'brushCatalog'; reqId: number; catalog: BrushCatalog | null }
  | { type: 'lotOutlines'; reqId: number; result: LotOutlinesResult }
  | { type: 'previewBuildings'; reqId: number; result: PreviewResult }
  // A lever revision's height regions and contours, once per revision, before its `current`
  // (a superseded revision may get none); the chain and label buffers are transferred.
  | { type: 'heights'; rev: Rev; city: HeightCity }
  | { type: 'heightLids'; reqId: number; result: HeightLidsResult }
  | { type: 'lotAt'; reqId: number; result: LotAtResult }
  // The band's runs ranked best to worst as seeds, once per band (each lever revision has its
  // own), when its last FZP run is set; `rev` is the revision whose band it ranks.
  | RanksResponse
  | LeversResponse;
export type RanksResponse = { type: 'ranks'; rev: Rev; seeds: number[] };
/**
 * A lever revision's status (plan 2): `rev` is the `initScenario` or `setLevers` that named the
 * levers. `resolving` while touched-lot yields are recomputed (`failedCells`: needed chunks that
 * failed to load; `retryChunks` re-wants them); `current` once the levers are in force, before
 * any timeline computed on them. A superseded revision never gets `current`. Its height limits
 * go out separately, as `heights`.
 */
export type LeversResponse =
  | {
      type: 'levers';
      rev: Rev;
      phase: 'resolving';
      done: number;
      total: number;
      failedCells: string[];
    }
  | {
      type: 'levers';
      rev: Rev;
      phase: 'current';
      lookups: LeverLookups;
      capacity: LeverCapacity;
      unknownLots: number;
    };
export type WorkerRequest = SimRequest | ScenarioRequest | PlaybackRequest;
/** Everything the Worker posts: the editor's, the scenario host's and the playback host's. */
export type WorkerResponse = SimResponse | ScenarioResponse | PlaybackResponse;
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
