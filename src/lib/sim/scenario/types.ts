// Step 0 of the FZP timelapse build: the worker scenario protocol types (T5, T6, T8), types
// only and worker-safe (no runtime exports). `protocol.ts` re-exports this module; fzp-mode and
// timelapse-render import it. timelapse-sim implements behaviour against it from step 3.
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId } from '$lib/data/parcel';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import type { GeneratedBuilding } from '$lib/generator';
import type { FogGrid } from '$lib/map/fog/grid';
import type { PackedCell, TimelineUpdate } from '$lib/map/types';
import type { Target } from '$lib/scoreboard';
import type { InFlightProject } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import type { Calibration, ExitReason, Pathway, Provenance, Stage } from '$lib/timelapse/types';
import type { LeverLookups } from '../levers/apply';
import type { BrushCatalog, BrushQuery } from '../levers/brushes';
import type { LeverCapacity } from '../levers/resolve';
import type { StageScale } from '../levers/timers';
import type { SimLevers } from '../levers/types';
import type { ChunksResponse, ParcelSummary, ReadyResponse, Rev, SimRequest } from '../protocol';

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
  // A simulated project on a run with `lawSwitch`: true when its initiation month started on or
  // after the switch, so it ran on the after view (size row, yields, envelope, Local Program).
  // Absent on every other Schedule, including all of a run without a switch.
  afterSwitch?: boolean;
  // On a run whose input has `newProjects`: true when the schedule's job ran on `calibration`
  // (a pipeline row past preApplication, or a phase), so its map bar reads the in-flight lookups
  // (Call 15). Absent on every other Schedule, so a run without lever timers is unchanged.
  inFlight?: true;
}
export type SimInput = {
  parcels: ScenarioParcels; // decoded T11
  projects: InFlightProject[];
  calibration: Calibration;
  asOf: Day;
  districtMaxStories: number | null; // projects.json `districtMaxStories.stories` (large-site massing §4.3, tier 2); null when absent
  // Policy levers (plan 2 ruling 3, "Policy start date = calibration.asOf"). Simulated projects and
  // pipeline rows at preApplication run on `newProjects`; every other row, master and phase on
  // `calibration`, its current stage's remaining time rescaled by `inFlightScale`. Initiation,
  // size, revision and phaseGap always read `calibration`.
  newProjects?: { calibration: Calibration; scale: StageScale }; // absent = calibration, scale 1
  inFlightScale?: StageScale; // absent = 1
  // The time-switched envelope (plan 2 ruling 1): a simulated project whose initiation month starts
  // on or after `day` runs on `parcels` (size row, yields, envelope, Local Program) and its
  // initiation hazard switches there too; in-flight rows keep `parcels` above. `parcels` has the
  // same rows, ids and existing columns as the base. Requires asOf < day (`runEngine` throws a
  // RangeError otherwise). Absent = no switch.
  lawSwitch?: { day: Day; parcels: ScenarioParcels };
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
    }
  | { type: 'reroll'; rev: Rev; seed: number | null }
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
  // Paint feedback (plan 2 Task 6): `stories` given = a custom stroke at that height; absent =
  // the levers in force (a rule). The page sends the lots nearest first.
  | { type: 'previewBuildings'; reqId: number; lots: ParcelId[]; stories?: number };
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
  | {
      ok: true;
      lots: ParcelId[];
      ringLot: Uint32Array;
      starts: Uint32Array;
      positions: Float64Array;
      missing: number;
    }
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
  | LeversResponse;
/**
 * A lever revision's status (plan 2): `rev` is the `initScenario` or `setLevers` that named the
 * levers. `resolving` while touched-lot yields are recomputed (`failedCells`: needed chunks that
 * failed to load; `retryChunks` re-wants them); `current` once the levers are in force, before
 * any timeline computed on them. A superseded revision never gets `current`. `fog` (map overlays
 * plan Task 2) is the revision's height-limit grid: on its first `resolving`, and on `current`.
 */
export type LeversResponse =
  | {
      type: 'levers';
      rev: Rev;
      phase: 'resolving';
      done: number;
      total: number;
      failedCells: string[];
      /** On the revision's first `resolving` only: its stories are final before any recompute. */
      fog?: FogGrid;
    }
  | {
      type: 'levers';
      rev: Rev;
      phase: 'current';
      lookups: LeverLookups;
      capacity: LeverCapacity;
      unknownLots: number;
      fog: FogGrid; // the height-limit grid of the levers in force; `heightM.buffer` transferred
    };
export type WorkerRequest = SimRequest | ScenarioRequest;
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
}
export type TargetProgressAt = {
  target: Target; // I11
  deadline: Day;
  fraction: number[]; // per month, (baseline + completedNet) / target, uncapped
};
