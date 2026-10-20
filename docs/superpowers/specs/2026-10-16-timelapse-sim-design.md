# timelapse-sim: design spec

**Status:** derived 2026-10-16 from the [FZP timelapse composition design](../design/2026-10-16-1903-fzp-timelapse.md), which is approved with partner rulings OD-T1..T5. It has been updated to the design's "Interface reconciliation (2026-10-16, after spec derivation)". Revised 2026-10-17 to the design's Reappraisal 1 (DQ-1..DQ-4, IA-1..IA-28).

Subsystem slug: `timelapse-sim`.

- **Owns:** T5, T6, T8 and T9.
- **Consumes:**
  - T1, T2, T3, T4, T4a–c, T7, T10, T11 and T12.
  - T4d, but only in one pipeline test.

T1 and T12 (time and the sampling module) now belong to stage-calibration. `packTimedCell` (T7) belongs to timelapse-render.

## 1. Scope

From the design (§Subsystems, verbatim):

> **`timelapse-sim`** (worker). From the scenario parcels, the in-flight projects, the calibration and a seed, it builds the **schedule** of every project. A schedule is a pure function of `(dataset, seed)` (T5). It also runs N schedule-only realisations for the **uncertainty band**. It generates geometry lazily: only for projects in loaded chunks, and once per revision. It posts a timeline (T6–T7) once per seed. **Scrubbing time never round-trips to the worker.**

### In scope

New files in `src/lib/sim/scenario/`, all worker-safe (no zod, no DOM, no `$app`):

| File | Contents |
|---|---|
| `types.ts` | **Step 0** of the design's Dependency order, landed before any body. It holds the T5 types (`Schedule`, `SimInput`, the `simulate` signature). `SimInput.projects` imports the T3 `InFlightProject` type from `src/lib/timelapse/projects.ts`, owned by project-records (step 0, round 4 N5). It also holds the T6 types (`ScenarioRequest`, `TimelineResponse`, `ScenarioErrorCode`, `ScenarioResponse`, `ProjectCard`) and the T8 types (`TimelineScore`, `TargetProgressAt`). Types only: `protocol.ts` re-exports them, and fzp-mode and timelapse-render import them. |
| `dates.ts` | `dayOf(y, m, d)` and `isoOf(day)`, built on `Date.UTC` |
| `rng.ts` | counter-based draws |
| `simulate.ts` | T5 `simulate`, the internal `simulateDetailed` (schedules plus multi-phase masters), and the schedule-only `simulateNet` |
| `policy.ts` | T9 `PolicyOp` type and `baseZoning`, the package's only PolicyOp |
| `score.ts` | T8, including `planEffect` |
| `band.ts` | the uncertainty band and the plan-effect band |
| `card.ts` | `ProjectCard` |
| `scenario-host.ts` | `createScenarioHost` |

`projects.json` is validated with project-records' shared `parseProjectsFile` (T3, `src/lib/timelapse/projects.ts`). This module ships no projects check of its own (ruling A4, IA-6).

Other changes:

- **`eslint.config.js`:** the determinism rule's `files` gains `src/lib/sim/scenario/**`, beside `src/lib/timelapse/**` and `pipeline/lib/fzp-cal/**` (T12; rulings A3, IA-7). The rule forbids `Math.exp`, `Math.log`, `Math.pow` and `**` in every file of this module, so constants such as 2³² are written as literals (`4294967296`).
- **`src/lib/sim/protocol.ts`:** the T6 unions are added beside `SimRequest` and `SimResponse`, which stay unchanged.
- **`src/lib/sim/worker.ts`:** becomes a router between the editor host and the scenario host.
- **`src/lib/sim/scenario-client.ts`:** `ScenarioClient` (T6), including `prefetch(bbox)` and `retryChunks()`. This module ships it. fzp-mode has no fallback client.
- **`pipeline/test/simulate-replay.test.ts`:** replays the historical cohort through `simulate`.

### Out of scope

Owned by other subsystems:

- **stage-calibration:**
  - `src/lib/timelapse/time.ts` (T1);
  - `src/lib/timelapse/model.ts`: `sampleTransition`, `initiationHazard`, `chanceTable`, `typicalMonths`, `parseCalibration` (T12);
  - fitting `calibration.json`.
- **timelapse-render:** `packTimedCell` and all rendering.
- **fzp-mode:** the `/fzp` page.
- **scenario-data:** the `sfh-scenario/1` codec, `FILL_LEVELS` and the manifest `scenarios` field.
- **project-records:** `projects.json`.
- **pipeline-massing:** `generateForUnits`.

Not in this package:

- user-facing policy levers (the only PolicyOp shipped is `baseZoning`, T9);
- addenda sub-stages;
- renderings.

Unchanged:

- the editor host (`src/lib/sim/host.ts`, `display.ts`);
- `SimClient` (`src/lib/sim/client.ts`).

## 2. Interfaces

The rows below are copied verbatim from the current design. T4d is consumed only by `simulate-replay.test.ts`. T13 and T14 are pipeline-internal and are not consumed here: this module sees T14 rule ids only through T3 `quality` and `qualityRules`.

| # | interface | owner → consumers | mark |
|---|---|---|---|
| T1 | `type Day = number` is integer days since 1970-01-01 UTC. All schedule times use it. It is exact in Float32. `MONTH_DAYS = 30.436875` (365.2425 / 12). `monthsIn(enteredDay, day) = floor((day − enteredDay) / MONTH_DAYS)` is the single months-in-stage rule, used by every table index (T4, T12, the bar, the card). `OPEN_DAY = Math.fround(3.0e38)` encodes an open-ended window end (exact in Float32; consumers compare with the exported constant, never a literal: A1). `DYING_DAYS = 270` is the display window of a death (90 days red, then a 180-day fade; tier 4), read by timelapse-render's uniforms and by timelapse-sim's card visibility. These live in `src/lib/timelapse/time.ts` | stage-calibration → all | DC |
| T2 | `type Stage = 'preApplication' \| 'filed' \| 'entitled' \| 'permitFiled' \| 'permitIssued' \| 'construction' \| 'complete'`; `type Pathway = 'discretionary' \| 'streamlined' \| 'permitOnly'`; `type ExitReason = 'withdrawn' \| 'disapproved' \| 'cancelled' \| 'expired'`. `STAGE_ORDER` lists the stages in this order. `preApplication` is optional on every pathway. `permitOnly` projects never enter `filed` or `entitled`. A ghost is visible from the project's first entered stage | stage-calibration → project-records, timelapse-sim, timelapse-render, fzp-mode | MC (stage sequence and exits follow real records), DC (names) |
| T3 | `interface InFlightProject { id: string /* 'PRJ:<record_id>', 'BP:<permit>', 'PRJ:<record_id>:BP:<permit>' for split pipeline rows, 'CASE:<case_no>' for PRX rows, 'PPA:<record_id>' for PPA-only; unique */; label: string \| null /* street address from the records, if any */; parcelIds: ParcelId[] /* current mapblklot, mapped through retired-parcel lineage; [] only for a score-only last-resort master (multiPhase, phases null, quality includes 'pr.multiphase.score-only'): no free DA parcel (DQ-3) */; pathway: Pathway; stage: Stage; history: Partial<Record<Stage, Day>> /* observed entry days */; units: number; existingUnits: number; stories: number \| null; storiesTier: 0 \| 3 \| null /* 0 = recorded field, 3 = parsed from description text */; multiPhase: boolean /* PRX/DA remaining-phase row */; phases: { units: number; parcelIds: ParcelId[]; plannedPermitFiled: Day \| null /* from the DA phasing schedule, if enriched */; source: { label: string; url: string; retrieved: string } \| null }[] \| null /* multi-phase only: null until enriched, then each phase is simulated as its own sub-project */; sources: { dataset: string; id: string; key?: string /* field to query, e.g. 'case_no'; absent = the dataset's record-id field */ }[]; quality: string[] /* sorted T14 rule ids that changed or estimated a value of this project; [] if none */ }`. `existingUnits` counts each parcel's assessor units once across in-flight projects (rule `pr.parcels.shared-existing`). `scenarios/fzp/projects.json` = `{ schema: 1; asOf: Day; rhnaCompletedNet: { units: number /* net units added since `since` up to `asOf`, Housing Inventory definition: completions plus alteration gains, minus demolitions and alteration losses */; since: Day /* 2022-06-30, RHNA projection period start */; provenance: Provenance }; qualityRules: { id: string; label: string /* generic, about the rule, never naming a record */; tier: 2 \| 3 \| 4 /* of the rule */; valueTier: 0 \| 1 \| 2 \| 3 \| 4 \| null /* of the value it writes; null if it writes none */ }[] /* every id used in any project's quality, sorted by id */; projects: InFlightProject[] }`. Projects are new construction only (alterations adding units are out of scope). The shared validator is `parseProjectsFile(json, opts?: { asOf?; parcelIds?; onInvalid?: (path: string, message: string) => void })` in `src/lib/timelapse/projects.ts`: without `onInvalid` it throws at the first violation (V20); with it, an invalid project is reported and left out of the returned file, and a file-level violation still throws | project-records → timelapse-sim, fzp-mode, stage-calibration (`asOf`, pathway mix) | MC (real pipeline is the starting state), DC (shape) |
| T4 | `interface Provenance { tier: 0 \| 1 \| 2 \| 3 \| 4; label: string; sources: { label: string; url: string }[]; method: string; n?: number; window?: [from: string, to: string] }`. `interface Transition { months: number; advance: number[] /* cumulative incidence by month 1..months */; exit: Partial<Record<ExitReason, number[]>>; tail: { advance: number; exit: Partial<Record<ExitReason, number>> } /* constant monthly hazards beyond months */; provenance: Provenance; tailProvenance: Provenance /* tier 2: extrapolation beyond the observed months */ }`. `scenarios/fzp/calibration.json` = `{ schema: 1; asOf: Day; transitions: Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Transition>>>; initiation: InitiationModel; pathwayForNew: Record<Pathway, number> & { provenance: Provenance }; size: SizeModel; revision: RevisionModel; streamlinedForLocalProgram: Provenance /* tier 2: Local Program projects use the streamlined tables */; phaseGap: { days: number[] /* empirical gaps between successive phases' permitFiled */; provenance: Provenance } }`. The calibration also carries `ppaShare: Record<Pathway, number> & { provenance: Provenance }`, the share of new projects that start at `preApplication`. `InitiationModel`, `SizeModel` and `RevisionModel` are rows T4a–c. Everything is plain JSON, so future policy levers can transform it (the T9 seam). **Sampling semantics:** a project entering stage *s* at day *d* draws one uniform. The month of advance or exit comes from the cumulative tables (`advance` + Σ`exit` ≤ 1 at every month), with the tail hazards beyond `months`. An in-flight project already *m* months into *s* draws conditionally on having survived *m* months. Day within the month is uniform | stage-calibration → timelapse-sim, fzp-mode | MC (every parameter carries tier + source), DC (encoding) |
| T4a | `type FeatureId = 'potentialRatio' /* yield units at full envelope ÷ max(existingUnits, 1); base variant uses the density-capped base yield (T13), FZP variant the Local Program yield (T11) — this is how density decontrol is seen */ \| 'existingUnits' \| 'lotAreaM2' \| 'yearBuilt' \| 'storiesGap' /* envelope stories − existing stories */ \| 'improvementShare' /* improvement ÷ (land + improvement) assessed value */ \| 'rentControlLikely' /* 0/1: ≥ 2 units and built < 1979 */ \| 'landUseClass' /* categorical: residential, mixed, commercial, pdr, vacant, other */`. `interface InitiationModel { kind: 'logit-monthly'; intercept: number; terms: { feature: FeatureId; bins: number[] /* ascending edges; categorical features use category index */; coef: number[] /* one per bin */ }[]; provenance: Provenance }`. Monthly hazard = `1 / (1 + exp(−(intercept + Σ coef[bin(feature)])))`. It is fitted on pre-FZP (base) envelopes and evaluated on FZP envelopes. Parcels with an in-flight project are not at risk until that project ends | stage-calibration → timelapse-sim, scenario-data (feature list) | DC |
| T4b | `interface SizeModel { fillLevels: number[] /* ascending fractions of envelope stories; last = 1; length F matches T11 yield */; byEnvelope: { maxStoriesUpTo: number; probs: number[] /* length F, sums to 1 */ }[]; provenance: Provenance }`. A new project proposes `stories = max(1, round(fill × envelope.maxStories))` | stage-calibration → timelapse-sim, scenario-data (F) | DC |
| T4c | `interface RevisionModel { at: { stage: Stage /* applied on entering this stage */; probability: number; ratio: { edges: number[]; probs: number[] } /* histogram of new units ÷ previous units; edges include 1, so shrink and grow shares are separable */ }[]; provenance: Provenance }`. No revision on or after `construction`. Upsizing is capped at the parcel's envelope. A revision changes units, and stories follow from the yield table (simulated) or scale proportionally (pipeline) | stage-calibration → timelapse-sim | MC (projects can resize before construction), DC (shape) |
| T4d | `interface ProjectHistory { id: string; pathway: Pathway \| null /* null = unclassifiable: excluded from per-pathway tables, included in pooled ones */; parcelIds: ParcelId[]; entered: Partial<Record<Stage, Day>>; end: { kind: 'complete'; day: Day } \| { kind: 'exit'; stage: Stage; reason: ExitReason; day: Day } \| { kind: 'open'; lastObserved: Day }; unitsAt: Partial<Record<Stage, number>> /* current proposed units from the record that represents each stage: PRJ → 'filed', site/full permit → 'permitFiled', TCO/CFC certified → 'complete'; cross-record, not snapshots (tier 2) */; existingUnits: number /* assessor units at filing: the roll year of the first entered day, clamped to 2007..latest */; storiesProposed: number \| null; baseStoriesAtFiling: number \| null /* current base height proxy, tier 3: no pre-FZP height map exists */; sources: { dataset: string; id: string; key?: string /* field to query, e.g. 'case_no'; absent = the dataset's record-id field */ }[]; quality: string[] /* sorted T14 rule ids that changed or estimated a value of this history; [] if none */ }`. Pipeline-internal file `pipeline/.cache/derived/<datasetVersion>/project-histories.json` = `{ schema: 1; asOf: Day; histories: ProjectHistory[] }`, never shipped. The history population and the in-flight population (T3) come from the same linkage. `entered` days are clamped forward (`pr.stages.forward-clamp`); a consumer that needs a raw filing day reads `permits.parquet`. Pipeline-internal `pipeline/.cache/derived/<datasetVersion>/permits.parquet`: one row per linked type 1/2 permit, columns `permit_number`, `project_id`, `prj_record_id`, `dva_record_id`, `prx_case_no`, `da`, `parcel_ids`, `proposed_units`, `site_permit`, `status`, `live`, `superseded`, `filed_day`, `issued_day`, `construction_day`, `complete_day`, `status_day` (raw valid days, T1, no project-level clamp) | project-records → stage-calibration, timelapse-sim (replay test fixtures) | DC |
| T5 | `interface Schedule { projectId: string; origin: 'pipeline' \| 'simulated'; parcelIds: ParcelId[]; pathway: Pathway; entered: Partial<Record<Stage, Day>>; end: { kind: 'complete'; day: Day } \| { kind: 'exit'; stage: Stage; reason: ExitReason; day: Day } \| { kind: 'open' } /* still in progress at horizon */; revisions: { day: Day; units: number; stories: number \| null /* null = unknown until massed */ }[] /* [0] is the initial proposal; strictly ascending days (revisions due on one day are merged, the last wins); none after entered.construction; a revision due on the construction-entry day is the as-built proposal */; existingUnits: number; multiPhase: boolean; phase: { masterId: string; index: number /* 1-based */; of: number; start: 'scheduled' \| 'estimated' /* scheduled = its permitFiled is the published plan date; estimated = the phaseGap stagger */ } \| null /* a phase sub-project of a multi-phase master */ }`. `simulate(input: SimInput, seed: number, horizon: Day): Schedule[]` is pure and deterministic. `SimInput = { parcels: ScenarioParcels /* decoded T11 */; projects: InFlightProject[]; calibration: Calibration; asOf: Day }`. Buildings of simulated projects carry `source: 'scenario'`, and pipeline projects carry `'pipeline'` (the sim stamps them) | timelapse-sim → timelapse-render (via T7), fzp-mode | MC (deaths, resizing, real starting state), DC (shape) |
| T6 | Worker protocol additions (I15 extended), served by a separate scenario host behind the same Worker and a separate `ScenarioClient` (the editor's host and `SimClient` are unchanged). Requests: `{ type: 'initScenario'; rev; manifest: Manifest; scenario: 'fzp'; seed: number \| null /* null = representative seed */; horizon: Day }`, `{ type: 'reroll'; rev; seed: number \| null }` (also the resync path: same seed → fresh revision-0 snapshot), and `{ type: 'parcelSummary'; reqId: number; parcelId: ParcelId; day: Day; projectId?: string /* the picked project; returned if visible at day */ }`. Responses: `ready` (existing shape), `{ type: 'timeline'; rev; seed: number; render: TimelineUpdate; score: TimelineScore; bandRuns: number /* band runs finished so far; the band is provisional until bandRuns = bandRunsTotal */; bandRunsTotal: number /* N */; complete: boolean /* all loaded cells packed */ }`. A band-only update is a `timeline` whose `render` is `{ revision: last + 1, cells: [], removedCells: [], demolish: [] }`, `chunks` (existing), and `error` with `code: 'manifest-invalid' \| 'scenario-missing' \| 'scenario-invalid' \| 'bad-request' \| 'internal'`. `parcelSummary` responds with `project?: ProjectCard`: the project named by `projectId` if it is visible at `day`; otherwise the project on that parcel whose first entered stage is ≤ `day`, latest first; none if no project is visible at `day`. `ProjectCard = { projectId: string; origin: 'pipeline' \| 'simulated'; label: string /* pipeline: T3 label, else 'Block B, Lot L'; simulated: always 'Block B, Lot L' */; pathway: Pathway; units: number; existingUnits: number /* pipeline: the project's T3 existingUnits; phase: the T11 sum of its own parcels; simulated: the T11 sum of its parcels not already demolished earlier in the run */; stories: number \| null; storiesTier: 0 \| 3 \| 4 \| null /* pipeline cards: 0 = recorded field, 3 = parsed from description text (both only for revisions[0]), 4 = from the simulator's massing or a later revision's proportional scaling, null iff stories is null; simulated cards: always null (their stories are the simulated size draw) */; massing: 'matched' \| 'approximate' \| 'none'; multiPhase: boolean; phase: Schedule['phase']; localProgram: boolean /* the project's parcel is a Local Program parcel and the project is simulated */; stages: { stage: Stage; day: Day; actual: boolean }[] /* only stages entered ≤ day */; revisions: Schedule['revisions'] /* only those ≤ day */; end: Schedule['end'] \| null /* null if the end is after day */; sources: { dataset: string; id: string; key?: string /* field to query, e.g. 'case_no'; absent = the dataset's record-id field */ }[]; quality: { label: string; tier: 2 \| 3 \| 4; valueTier: 0 \| 1 \| 2 \| 3 \| 4 \| null }[] /* pipeline: T3 quality mapped through qualityRules, in id order; simulated: []. A display shows valueTier when non-null, else tier */ }`. The card's chance to finish is computed on the main thread from T12 at the current time. `prefetch` is reused, viewport-driven at every zoom in this mode | timelapse-sim ↔ fzp-mode, timelapse-render | DC |
| T7 | `interface TimedPackedCell extends PackedCell { slotProjectIds: string[] /* render slots are keyed by project; parcelIds may repeat across slots */; partWindow: Float32Array /* per part: [fromDay, toDay) the part's revision is current; toDay = OPEN_DAY if open */; slotStages: Float32Array /* per slot: STAGE_ORDER.length entry days, NaN = never */; slotEnd: Float32Array /* per slot: [endDay, endKind] (0 open, 1 complete, 2 exit) */; slotPathway: Uint8Array /* index into ['discretionary','streamlined','permitOnly'] */ }`. `parcelMeta` rows describe the slot's final revision. `packTimedCell` is pure and owned by timelapse-render (in `src/lib/map/`); the worker imports it. `interface TimelineUpdate { revision: number /* 0 = snapshot */; cells: TimedPackedCell[]; removedCells: string[]; demolish: { parcelId: ParcelId; day: Day }[] /* complete list in revision 0 (needs no geometry); empty afterwards */ }`. `SimMapHandle` gains `applyTimeline(u: TimelineUpdate): void`, `setTime(day: Day): void` and `setTimelineLookups(l: { chance: ReturnType<typeof chanceTable>; typicalMonths: ReturnType<typeof typicalMonths> }): void`. `SimMapProps` gains `timelinePick?: (p: { projectId: string; parcelId: ParcelId; x: number; y: number; kind: 'hover' \| 'tap' } \| { projectId: null; kind: 'hover' \| 'tap' }) => void`. `kind` is `'hover'` for a fine-pointer move and `'tap'` for a touch tap or a mouse/pen click. A miss is `{ projectId: null, kind }`: a hover miss is sent once when the pointer leaves the timeline parts after a hover hit; a tap miss is sent on every tap or click that hits no timeline part. `null` is never sent. When `timelinePick` is set, SimMap's built-in tooltip is suppressed over timeline parts. Timeline colour tokens (`tl-*` in `palette.ts`), an exported `TIMELINE_LEGEND` and `timelineTokenCss(selector: string): string` (CSS text, no `<style>` wrapper: the `--map-*` custom properties of every `tl-*` token and of every token `TIMELINE_LEGEND` names, light values then dark under `prefers-color-scheme: dark`, scoped to `selector`, so a legend outside SimMap follows the system theme) are owned here. `setTime` does O(1) JS work per call, except the existing-building catch-up, which applies at most 2,000 feature-state changes per frame until it converges | timelapse-render ↔ timelapse-sim, fzp-mode | DC |
| T12 | In `src/lib/timelapse/model.ts` (pure, zod-free, worker-safe): `sampleTransition(t: Transition, u: number, monthsElapsed: number): { kind: 'advance' \| ExitReason; days: number }`, `initiationHazard(m: InitiationModel, f: Record<FeatureId, number>): number`, `chanceTable(cal: Calibration): Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Float32Array>>>` (per month in a stage, the probability of eventually reaching `complete`; the table is 241 months long, and the tail is used beyond it), `typicalMonths(cal: Calibration): Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, number>>>` (median months to leave each stage, used for the bar's within-stage fill), and `parseCalibration(json: unknown): Calibration` (throws on schema mismatch), and `cumulativeIncidence(t: Transition, k: number): { advance: number; exit: Partial<Record<ExitReason, number>> }` (the cumulative incidence by month k ≥ 0, tail included). `sampleTransition`'s `days` counts from stage entry and is ≥ ⌈monthsElapsed · MONTH_DAYS⌉; placing a draw that falls before the snapshot is the caller's job. Every function here, and timelapse-sim's schedule code, computes `exp` and `log` with `src/lib/timelapse/math.ts` (fdlibm ports), never `Math.exp`/`Math.log`/`Math.pow`/`**`; an ESLint rule over `src/lib/timelapse/**`, `pipeline/lib/fzp-cal/**` and `src/lib/sim/scenario/**` enforces it. The pipeline's validation, the worker, the renderer (lookups uploaded once) and the card all use these, and nothing re-implements them. The bar colour and the card's "chance of finishing" both come from `chanceTable` | stage-calibration → timelapse-sim, timelapse-render, fzp-mode | MC (health = chance of finishing, OD-T2; one sampling semantics everywhere) |
| T8 | `interface TimelineScore { months: Day[] /* months[i] = the 1st of the i-th month, starting with asOf's month and ending with the horizon's month; every series value at i is the state at the end of that month (events with day < months[i + 1], or ≤ horizon for the last entry) */; shown: { completedNet: number /* cumulative since asOf, simulation only, excludes baseline */; completedNetPipeline: number; completedNetNew: number; entitledNew: number /* cumulative net units of new (simulated) projects reaching entitled */; inProgress: Record<Exclude<Stage, 'complete'>, number> /* current proposed units of projects in each stage at that month */; exitedUnits: number /* cumulative */ }[]; planEffect: { entitledNew: number; completedNetNew: number }[] /* shown seed: FZP run minus its paired old-zoning run (T9 `baseZoning`), cumulative net units */; planEffectBand: { p10: number; p50: number; p90: number }[] /* planEffect.completedNetNew over the N paired runs */ /* planEffect and planEffectBand are [] until computed: always [] in revision 0, filled by later band-only updates */; band: { p10: number; p50: number; p90: number }[] /* completedNet over N runs, same basis as shown */; baseline: { completedNet: number; since: Day; provenance: Provenance }; phasing: { masters: number; enrichedMasters: number; phasesScheduled: number /* plan date from a published schedule */; phasesEstimated: number /* fallback sizes or phaseGap stagger */; unenriched: { projectId: string; label: string \| null; units: number; drawn: boolean /* false = score-only: no free DA parcel (DQ-3) */ }[] }; targets: TargetProgressAt[]; references: { id: string; label: string; units: number; from: Day; by: Day; measure: 'planEffect.entitledNew' \| 'planEffect.completedNetNew' \| 'completedNet'; provenance: Provenance }[] /* published estimates, each compared with the matching shown series */ }`, where `TargetProgressAt = { target: Target /* I11 */; deadline: Day; fraction: number[] /* per month, (baseline + completedNet) ÷ target, uncapped */ }` | timelapse-sim → fzp-mode | MC (net units against RHNA; band shown; baseline actuals counted), DC (shape) |
| T9 | Policy-lever seam: `simulate` reads all behaviour from `Calibration`. A `PolicyOp` is a pure `(Calibration, ScenarioParcels) → (Calibration, ScenarioParcels)` transform applied before `simulate`. This package ships exactly one: `baseZoning`, the old-zoning counterfactual. It sets every envelope to base stories, every yield to `baseYield`, `localProgram` false and hostability to `hostable_base`, and evaluates initiation on the base features. Each FZP run is paired with a `baseZoning` run on the same seed. Draws are keyed by entity, so in-flight projects get identical stage timing, exits and ends in both runs (their revision units may differ, because the upsizing cap follows each run's envelope) and the difference isolates the plan (common random numbers). Only the FZP run is drawn on the map | timelapse-sim → future policy-levers | MC (levers change inputs, not the engine) |
| T10 | `GeneratedBuilding.source: 'user' \| 'pipeline' \| 'scenario'` (amends I9). `generateForUnits(parcel: ParcelRecord \| ParcelRecord[], units: number, maxStories: number, seed: number, stories?: number): GeneratedBuilding \| null` | pipeline-massing → timelapse-sim, map-view | DC |
| T11 | `scenarios/fzp/parcels.bin` (codec `sfh-scenario/1`, in `src/lib/data/`; deflate inside the file, async decode). It holds **every** parcel: `id`, `labelPoint`, `cellId`, a `hostable` flag (eligible and able to host a new project: an envelope of at least one story and an uncapped full-fill yield above 0; the density cap does not gate it), `envelope: Envelope` (FZP stories: Local Program height if `localProgram`, else base height; clamped to `MAX_STORIES`), base stories, the base-zoning density cap in units (null = none), `localProgram: boolean`, `existingUnits` (latest assessor roll, post-T14) and `existingFloorAreaM2` (u32, whole m²: the value the yield used), the T4a feature values (base and FZP variants of `potentialRatio` and `storiesGap`) with an imputation mask (`imputed`, a bit set exactly when that field's value is not the source's own value: bit 0 `yearBuilt`, 1 `existingStories`, 2 `improvementShare`, 3 `existingUnits`, 4 no roll row, 5 row carried from the previous roll year, 6 `existingFloorAreaM2` (fallback to the chunk record), 7 reserved; each T14 rule that writes a parcel feature names its bit; rules that write no feature (e.g. zoning caps) have none), `hostable_base` (hostable under the old zoning: the base envelope, uncapped), `eligible` (scenario eligibility, which can differ from the chunk's `eligible`: a parcel with no land-use row but assessor units > 0 is eligible, under T14 rule `sd.landuse.none-with-units`; the `flags` column carries it as bit 5, with bits 6–7 reserved), `baseYield: Uint16[F]` (gross units at each fill level of the base envelope, density-capped), and `yield: Uint16[F]`, the gross units at each fill level of the envelope, replacement typologies only (no ADU outcomes), with no density cap under the Local Program. `FILL_LEVELS = [0.25, 0.5, 0.75, 0.9, 1]` (F = 5, tier-4 quantisation grid) is owned here, and stage-calibration imports it. Named in the manifest as `scenarios?: { fzp: { parcels: url; projects: url; calibration: url } }` (amends I12 and `ManifestBaseSchema`; optional, so older datasets load). `scenarioRecordOf(p: ScenarioParcels, i: number, rec: ParcelRecord): ParcelRecord` (worker-safe, in the codec module) returns the chunk record with `existingUnits`, `existingFloorAreaM2`, `existingHeightM` (= existing stories × 3.1) and `eligible` replaced from row i. The pipeline's yield and timelapse-sim's simulated massing both use it, so the worker reproduces the building the yield was sized from. Because the yield uses the generator, `src/lib/generator` and `src/lib/timelapse` join the dataset-version hash | scenario-data → timelapse-sim, stage-calibration (`FILL_LEVELS`, `featureValue`, `hostable`), project-records and fzp-mode (manifest `scenarios`) | DC |

### Internal types (not T-rows; they alter no row)

```ts
// src/lib/sim/scenario/types.ts (step 0), re-exported by protocol.ts. SimRequest and SimResponse
// stay byte-identical, so the editor's exhaustiveness checks still compile (host.ts:452,
// client.ts:214).
type ScenarioRequest =
  | Extract<SimRequest, { type: 'prefetch' | 'retryChunks' }>
  | { type: 'initScenario'; rev: Rev; manifest: Manifest; scenario: 'fzp'; seed: number | null; horizon: Day } // T6
  | { type: 'reroll'; rev: Rev; seed: number | null } // T6
  | { type: 'parcelSummary'; reqId: number; parcelId: ParcelId; day: Day; projectId?: string }; // T6
type TimelineResponse = { type: 'timeline'; rev: Rev; seed: number; render: TimelineUpdate; score: TimelineScore; bandRuns: number; bandRunsTotal: number; complete: boolean }; // T6
type Massing = GeneratedBuilding | { footprint: [lng: number, lat: number][] }; // timelapse-render's packTimedCell input entry
type ScenarioErrorCode = 'manifest-invalid' | 'scenario-missing' | 'scenario-invalid' | 'bad-request' | 'internal'; // T6
type ScenarioResponse =
  | ReadyResponse
  | ChunksResponse
  | TimelineResponse
  | { type: 'error'; rev: Rev; code: ScenarioErrorCode; message: string }
  | { type: 'parcelSummary'; reqId: number; summary: ParcelSummary | null };
type WorkerRequest = SimRequest | ScenarioRequest;
// ParcelSummary (protocol.ts:55) gains `project?: ProjectCard` (T6). The editor never sets it.
// The step-0 declarations of Schedule (T5) and ProjectCard (T6) predate Reappraisal 1. This module
// owns them and updates them to the amended rows: `phase.index` 1-based, `phase.start`, the
// strictly-ascending revisions comment, `storiesTier: 0 | 3 | 4 | null`, `quality`, and the
// `existingUnits` source comment. The T8 comment gains the empty-until-computed note.

interface ScenarioHostDeps {
  fetch: FetchLike; // JSON files (chunks.ts:9)
  fetchBytes(url: string): Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>; // parcels.bin
  post(msg: ScenarioResponse, transfer: ArrayBuffer[]): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  now(): number; // ms
  generate?: typeof generate;
  generateForUnits?: typeof generateForUnits;
  retryDelaysMs?: readonly number[];
  maxConcurrent?: number;
  memoCap?: number;
  bandRuns?: number;
}

// policy.ts (T9)
type PolicyOp = (cal: Calibration, parcels: ScenarioParcels) => { cal: Calibration; parcels: ScenarioParcels };
const baseZoning: PolicyOp;

// simulate.ts
interface Master { // a multi-phase row with `phases`; never drawn, never a Schedule
  masterId: string; pathway: Pathway; entered: Partial<Record<Stage, Day>> /* Planning-side only */;
  end: { kind: 'entitled'; day: Day } | { kind: 'exit'; stage: Stage; reason: ExitReason; day: Day } | { kind: 'open' };
  phaseUnits: number[]; phaseFiled: (Day | null)[] /* permitFiled day of each phase, null = not by horizon */;
}
function simulateDetailed(input: SimInput, seed: number, horizon: Day): { schedules: Schedule[]; masters: Master[] };
// simulate(...) === simulateDetailed(...).schedules
function simulateNet(input: SimInput, seed: number, horizon: Day, months: Day[]):
  { completedNet: Int32Array; completedNetNew: Int32Array; entitledNew: Int32Array }; // per month
```

### Interface concerns

**Resolved by the Interface reconciliation (2026-10-16):**

| # | Concern | Ruling that resolves it |
|---|---|---|
| C1 | `parcelSummary` had no time | T6 request now carries `day`, with a defined selection rule |
| C2 | stories nullability | T5 and ProjectCard `stories: number \| null` |
| C3 | no address | T3 `label`; reconciliation "Ids and labels" |
| C4 | no cell for pipeline parcels | T11 holds **every** parcel, with `cellId` |
| C5 | month and bin conventions | T1 `MONTH_DAYS` / `monthsIn`, plus the single T12 module, both owned by stage-calibration |
| C6 | baseline semantics | T3 `rhnaCompletedNet`: Housing Inventory net (completions plus alteration gains, minus demolitions and alteration losses), since 2022-06-30 |
| C7 | references | T8 `from` / `measure` / `entitledNew`; reconciliation "References" |
| C8 | ADU outcomes in yield | T11 yield excludes them |
| C9 | error codes | T6 adds `scenario-missing` / `scenario-invalid`; separate `ScenarioClient` |
| C10 | pack ownership | T7: `packTimedCell` is owned by timelapse-render; slots keyed by `slotProjectIds` |
| C11 | calibration completeness | Invariant: every pathway × stage pair is present |
| R1 | T12 determinism across engines | Late rulings: `src/lib/timelapse/math.ts` (fdlibm `exp`/`log`, owned by stage-calibration) is used by T12 and by timelapse-sim; `Math.exp`/`Math.log` never appear on a determinism path. Now stated in the T12 row, with the lint scope (IA-7, IA-16) |
| R2 | `sampleTransition` days contract | Late rulings / stage-calibration spec §4.2: days count from stage entry and are ≥ ⌈m·M⌉; ρ > 0, so every project eventually leaves. Placing a result in a past month at the snapshot day is timelapse-sim's job (§4.4.2). Now stated in the T12 row (IA-15) |
| R3 | T9 "identical schedules" against the T4c pipeline upsizing cap | Round 4 N3: T9 now promises identical stage timing, exits and ends. Pipeline revision **units** may differ between twins, because `baseZoning` lowers the envelope cap. That doesn't touch `planEffect`, which counts only simulated projects. fzp-mode's dialog states it |

These concerns stay closed. The concerns raised by Reappraisal 1 are listed in "Interface concerns (reappraisal 1)" at the end of this spec.

## 3. Global constraints

### Global constraints (design, verbatim)

The source design's constraints still apply (free and open, determinism, overshoot meaningful, honesty of numbers, performance, mobile, static versioned data, conventions). In addition:

- **Evidence hierarchy** (above). No number reaches the simulation without a tier and a source. A tier-3 or tier-4 number is never presented as data.
- **Data quality** (reappraisal 1). Live sources are not assumed clean. Every pipeline rule that nulls, replaces, defaults or drops a source value is a registered T14 rule with a tier, a label and counts in every build. A replaced parcel value sets its `imputed` bit, and a changed record carries the rule's id in `quality`. A value a rule wrote is never presented as a record.
- **Determinism.** The same `datasetVersion` and seed always give the same future, on every machine. The representative seed is chosen deterministically: the run whose final `completedNet` is the median of the N band runs.
- **Honesty of numbers.** The mode is labelled a *simulation*. The scoreboard shows the shown run and the p10–p90 band. Pipeline and new-FZP units are separate lines. Actual completions since the RHNA period start are counted and labelled as actual. Units lost to dead projects are shown.
- **Time scrubbing performance.** At 60 fps on a 2022-era laptop with the whole city's timeline loaded, per-frame JS during scrub or playback is O(1) in project count. A reroll reaches a full new timeline (the shown run, to 2050) within 3 s off the main thread. The p10–p90 band may fill in progressively afterwards; the UI marks it as provisional until it is complete.
- **First paint.** `/fzp` must not require loading every parcel chunk. The whole-city score comes from `parcels.bin`, `projects.json` and `calibration.json`. Geometry streams with the viewport, as on `/`.
- **The editor is unchanged.** `/` and `/p/:id` behave exactly as before. FZP mode is additive. The one intended exception is the shared header, which gains the mode links ("Paint" / "Timelapse") and shortens the brand to "SF Housing" below 640 px so the links fit at 375 px.
- **Map budgets in FZP mode.** Two deck layers per cell are allowed for timeline cells: translucency needs them. This is an exception to map-view's one-layer-per-cell rule, so a `bench:map` timeline scenario must pass the same p95 frame bar. The existing-building catch-up stays within 2,000 feature-state changes per frame.
- **Accessibility.** WCAG 2.2 AA as in `docs/dev/accessibility.md`. The scrubber is a labelled slider: arrow keys step a month, Page Up/Down a year. Reduced motion stops autoplay, but scrubbing still works.

### Evidence hierarchy (design, verbatim)

Every number the simulation uses comes from the highest tier available. It carries that tier and its source, and the UI can show both.

| tier | kind | example here |
|---|---|---|
| 0 | per-record time series | DBI permit dates, Planning approval dates, TCO/CFC dates |
| 1 | published first-party aggregates | Housing Inventory production tables, quarterly pipeline report |
| 2 | researched inferences from observations | a redevelopment hazard fitted to SF parcel history; resize ratios measured across linked records |
| 3 | research models / literature | NAHB construction durations, statutory review clocks used as duration proxies |
| 4 | made up | anything else, labelled as such |

Consequence: calibration is **computed by the data pipeline from DataSF records**, and literature figures are used only where the records can't answer. The dataset probe found tier-0 coverage for almost every stage. There is no tier-0 figure for deaths before any filing, or for the new Local Program's own durations (it has been in force only since 2026-01-12).

## 4. Behaviour

### 4.1 Host: a separate module behind the same Worker

T6 fixes the structure: a separate scenario host behind the same Worker, and a separate `ScenarioClient`. This spec settles the mechanics.

**Why a separate host.** The editor host's state is plan, committed, preview and op cells (`host.ts:67-82`). Its `dispatch` switch ends in a `never` check (`host.ts:452`), and so does `SimClient.#receive` (`client.ts:214`). Adding scenario variants to `SimRequest` or `SimResponse` would force edits to both. A separate host keeps the diff to `host.ts`, `display.ts` and `client.ts` at zero, which is the cleanest proof of "the editor is unchanged".

**Routing.** `worker.ts` becomes a router.

- **Editor host.** Created eagerly, exactly as today (`worker.ts:10-17`). It handles `init`, `load`, `preview`, `cancelPreview`, `commit` and `undo`.
- **Scenario host.** `createScenarioHost(deps)`, created on the first `initScenario`. It handles `initScenario` and `reroll`.
- **Shared requests.** `prefetch`, `retryChunks` and `parcelSummary` go to whichever host received the latest `init` or `initScenario`. Before either has arrived, they go to the editor host.
- **Switching modes.** An `init` disposes the scenario state, and an `initScenario` disposes the editor state.

**What the scenario host reuses unchanged:**

- `createChunkLoader` and `cellsIntersecting` (`chunks.ts:54`, `chunks.ts:191`);
- `checkManifestShape`;
- `createLru` (`lru.ts:19`);
- `fnv1a32` (`generator/seed.ts:4`);
- `ReadyResponse` and `ChunksResponse`.

**`ScenarioClient`** (`src/lib/sim/scenario-client.ts`) is modelled on `SimClient`: it keeps the rev counter, crash handling, `restart` and `dispose`, and the pending summary promises. Its API:

- `initScenario(manifest, horizon, seed = null): Rev`
- `reroll(seed: number | null): Rev` (sets the barrier)
- `isStale(t)`, true when `t.rev < barrier`
- `resync()`: sends one `reroll(currentSeed)` per episode, on a T7 revision gap. `currentSeed` is the `seed` of the latest accepted timeline.
- `parcelSummary(parcelId, day, projectId?)`
- `prefetch(bbox)` and `retryChunks()`, which forward the existing fire-and-forget requests
- events: `onReady`, `onTimeline`, `onChunks`, `onError`, `onCrash`

It never auto-resyncs on an `error`, unlike `client.ts:209`. After a crash, fzp-mode's Retry calls `restart(spawnSimWorker())` and then sends only `initScenario`, using the current seed.

### 4.2 Data loading

1. **Validate the request.**
   - `scenario` must be `'fzp'`.
   - `seed` must be `null` or an integer in [0, 2³²).
   - `horizon` must be an integer.
   - Otherwise: `bad-request`.
2. **Validate the manifest.**
   - A failed `checkManifestShape` gives `manifest-invalid`.
   - If `manifest.scenarios?.fzp` is absent, or lacks a `/data/<datasetVersion>/` URL for `parcels`, `projects` or `calibration`, the host posts `scenario-missing` with the message `dataset <v> has no fzp scenario`. This relies on T11 amending `ManifestBaseSchema`.
3. **Start.** Prior scenario state is disposed and the host posts `ready` `{ rev, datasetVersion, chunkCount }`.
4. **Fetch the three files concurrently.**
   - `parcels.bin` goes through `fetchBytes`, because `FetchLike` has only `json()` (`chunks.ts:10`).
   - The JSON files go through `fetch`.
   - A fetch has failed when the request rejects, when `ok` is false, or when reading the body (`arrayBuffer()` or `json()`) rejects. A body read is part of the fetch, so a dropped connection mid-body is retryable.
   - Each fetch retries on `retryDelaysMs`, default 1, 4 and 16 s (`host.ts:60`).
   - When the retries run out: `internal`, with the message `scenario fetch failed: <url> (HTTP <status>)`, or `(network)` when there was no response.
   - The files are fetched once per `initScenario` and never on `reroll`.
5. **Decode and validate.** Decoding starts only after every byte has arrived, so a failure here is a bad file, never a network error, and it is not retried.
   - `parcels.bin`: the T11 async decoder `readScenarioParcels(bytes)`, always given the fully read `Uint8Array`, never a stream. `readScenarioParcels` reports any stream error as `ScenarioFormatError('inflate failed')` (`scenario-codec.ts:522-524`). Because its input is already in memory, that error can only mean a corrupt deflate body, so it maps to `scenario-invalid` (IA-22, scenario-data carry-forward).
   - `calibration.json`: T12 `parseCalibration`.
   - `projects.json`: T3 `parseProjectsFile(json, { onInvalid })` (IA-5). A file-level violation throws and gives `scenario-invalid`. An invalid project is reported to `onInvalid(path, message)` and left out of the returned file; see "Invalid projects" below.
   - Calibration `size.fillLevels` must equal T11 `FILL_LEVELS` element by element. `parseCalibration` checks only that the levels are ascending, end at 1 and match every `probs` length (ruling A2), so this equality is checked here, when the `SimInput` is assembled.
   - Any failure gives `scenario-invalid`, with the message `scenario <file>: <first problem>`.
   - **Invalid projects.** The host collects every `onInvalid` call and logs one aggregated warning: `projects.json: skipped <n> invalid project(s); first: <path>: <message>`. The skipped projects are absent from the run: not simulated, not scored, no geometry. They do not block the risk set. A file whose every project is invalid is still a valid, empty pipeline.
   - The host does not pass `parcelIds` to `parseProjectsFile`. A parcel id absent from T11 is handled below, not rejected.
   - `projects.asOf ≥ horizon` gives `bad-request`.
   - The run's `asOf` is `projects.asOf`. If `calibration.asOf` differs, the host logs one warning.
6. **Build two inputs.** `buildSimInput(files)` makes the FZP `SimInput`. `applyPolicies([baseZoning], fzpInput)` makes its twin (§4.4.8).
7. **Precompute once per input.** Each input (FZP and twin) gets its own precompute. The values are keyed by `SimInput` identity and never held in module state:
   - each hostable parcel's hazard `h = initiationHazard(calibration.initiation, features(i))` and its `log(1 − h)`, using `math.ts`;
   - each parcel's renormalised size distribution;
   - the parcels blocked by in-flight projects.

**Geometry** is built only for projects anchored in ready cells.

- Chunks are requested only by `prefetch`, which is viewport-driven at every zoom (T6). First paint never requires an all-chunk load.
- **Cell anchor.** A project's cell is the T11 `cellId` of the smallest `ParcelId` among its parcels. This is deliberate: it is stable and needs no records.
- **Footprint parcel.** The parcel with the largest `areaM2` (ties to the smallest id) supplies the fallback footprint (§4.8). It is also timelapse-render's pick parcel, and it is the massing anchor: `generateForUnits` returns `b.parcelId` = this parcel (pipeline-massing §4.2). The host never assumes `b.parcelId` equals the cell-anchor parcel (IA-22, pipeline-massing carry-forward).
- A parcel id that is absent from T11 is logged once. A project with no T11 parcel gets no geometry but is still scored.
- **Score-only projects** (DQ-3). A project whose `parcelIds` is empty gets no geometry, no cell, no demolish entry and no card, and is still simulated and scored. The only such rows are last-resort masters whose DA parcels are all held by other in-flight projects (§4.4.3). T3 encodes them: `parcelIds` is `[]` only for such a master (`multiPhase` true, `phases` null, `quality` holds `pr.multiphase.score-only`; IC-R1 resolved).
- For a multi-parcel project the host also `want`s the cells of its other parcels, and packs the project once all of them are ready.

### 4.3 Time

The run uses T1's `MONTH_DAYS`, `monthsIn` and `OPEN_DAY`. `dates.ts` adds `dayOf` and `isoOf`.

**`TimelineScore.months`** follows T8.

- `months[i]` is the 1st of the i-th month, starting with `asOf`'s month and ending with the horizon's month. For `asOf` 2026-10-16 and horizon 2050-12-31 that runs from 2026-10-01 to 2050-12-01: 291 entries.
- Every series value at `i` is the state at the **end** of that month. It counts the events with `day < months[i + 1]`, or `day ≤ horizon` for the last entry.
- Snapshot instant: `T_i = months[i + 1]`, or `horizon + 1` for the last entry.
- `idx(d)` is the `i` with `months[i] ≤ d < T_i`.
- Every future event is after `asOf`, so `idx` is always ≥ 0, and month 0 holds only the rest of October 2026.

fzp-mode indexes `months` by the scrubbed day's month.

Day bounds:

- Every future event satisfies `asOf < day ≤ horizon`.
- History days are ≤ `asOf`. A history day after `asOf` is clamped to `asOf`.

### 4.4 `simulate(input, seed, horizon)` exactly

#### 4.4.1 RNG and stream splitting

Draws are counter-based and stateless (`rng.ts`):

```
u = (H + 0.5) / 2³²
H = fmix32(seed ^ 0x5bd1e995)
H = fmix32(H ^ entity)
H = fmix32(H ^ imul(k + 1, 0x9e3779b1))
H = fmix32(H ^ ((purpose << 8) | stageIdx))
```

- **`fmix32`** is MurmurHash3's finalizer, written with `Math.imul` and `>>>`. These are integer ops only, so the result is bit-identical everywhere (compare `mulberry32`, `seed.ts:29`).
- **`entity`:**
  - simulated project: `fnv1a32('p:' + parcelId)`;
  - pipeline project: `fnv1a32('j:' + projectId)`. T3 ids are prefixed and unique.
- **`k`:** the initiation index on the parcel; 0 for pipeline projects.
- **`purpose`:** `INIT=1`, `INIT_DAY=2`, `PATHWAY=3`, `PPA=4`, `SIZE=5`, `STAGE=6`, `REV=8`, `REV_RATIO=9`, `PHASE_GAP=11` (§4.4.3a), `STAGE_REDRAW=16 + j` for `j = 1…7` (§4.4.2).
- **`stageIdx`:** the `STAGE_ORDER` index of the stage being left (for `STAGE`) or entered (for `REV` and `REV_RATIO`). It is 0 otherwise.

What this guarantees:

- A project's schedule depends only on the seed, its entity, `k` and the calibration.
- Adding, removing or reordering unrelated parcels or projects changes nothing.
- Revision draws never shift stage draws, and stage draws never shift revision draws.

**Transcendental math.** The geometric inversion uses `log` from `src/lib/timelapse/math.ts`, stage-calibration's fdlibm port (T12). `Math.log`, `Math.exp`, `Math.pow` and `**` are never used anywhere in `src/lib/sim/scenario/`, and the ESLint rule whose scope this module extends (§1) enforces it. For hazards near 10⁻⁴, `log(1 − h)` has a relative error of about 10⁻¹². That is far below one month in `T` and has no effect on determinism.

#### 4.4.2 One stage step

For a project in stage `s` (entered on day `e`, pathway `p`):

1. **Sample.** Call `r = sampleTransition(transitions[p][s], draw(STAGE, s), monthsElapsed)` (T12).
   - `monthsElapsed` is `monthsIn(e, asOf)` for an in-flight project's current stage, and 0 otherwise.
2. **Event day.** `day = e + floor(r.days)`.
   - **In-flight first draw only: redraw** (reconciliation round 2). By the T12 days contract, `days` counts from stage entry and is ≥ ⌈monthsElapsed · MONTH_DAYS⌉, and placing a draw that falls before the snapshot is the caller's job. The result can still land in the snapshot's month on or before `asOf`. Up to 8 attempts are made:
     - attempt 0 uses `draw(STAGE, s)`;
     - attempt `j` (1…7) uses `draw(STAGE_REDRAW + j, s)`;
     - every attempt calls `sampleTransition(t, u_j, monthsIn(e, asOf))`.

     The first attempt with `e + floor(r.days) > asOf` is accepted, outcome and day together. Rejecting until acceptance is exactly conditioning on survival to `asOf`. If all 8 attempts land on or before `asOf`, the last attempt's outcome is kept and placed at `day = asOf + 1`.

     The cap of 8 is tier 4 and numerical only. A single attempt is rejected only when the event falls in the part of the current month before the snapshot. With one month's worth of event probability split across that partial month, a fallback needs 8 consecutive rejections. That is negligible except for stages with near-certain exit within a month.
3. **Outcome.**
   - If `day > horizon`, the schedule ends `{ kind: 'open' }`. ρ > 0 guarantees every project leaves its stage eventually, so a horizon cut is the only way a schedule stays open.
   - On an exit: the schedule ends `{ kind: 'exit', stage: s, reason, day }`.
   - On an advance: set `entered[next] = day`. If `next` is `complete`, the schedule ends `{ kind: 'complete', day }`.

**Next stage** (`nextStage`) follows `STAGE_ORDER`:

- `preApplication` → `filed`, or → `permitFiled` for `permitOnly`;
- then `filed` → `entitled` → `permitFiled` → `permitIssued` → `construction` → `complete`.

#### 4.4.3 Pipeline projects (in-flight conditioning)

Every valid InFlightProject (T3) is simulated. A row with `multiPhase && phases !== null` follows §4.4.3a. A multi-phase row without `phases` (a last-resort master) is simulated here as a single project, with footprint geometry (§4.8) on its `parcelIds`.

- **Last-resort masters on held lots** (DQ-3). project-records gives a last-resort master only DA parcels that no other in-flight project holds (V24 extended). With none free, the master is **score-only**: it is simulated and scored here like any other row, has no geometry, no demolish entry and no card, blocks no parcel, and is listed in `phasing.unenriched` like every `phases === null` row, with `drawn: false`. The host recognises it by its empty `parcelIds`, which T3 allows only for this case (IC-R1 resolved).
- **Rows linked by parcel** (DQ-2). A pipeline-only PRX row that project-records joined to its open PRJ (rule `pr.pipeline.status-date-linked`, e.g. Freedom West at `filed` on 2020-07-24 with 2,387 units) arrives as an ordinary in-flight row with real history days. It needs no special handling. Its card shows the rule's label through `quality` (§4.9).

- **Skipped projects.** `stage === 'complete'`, or `permitOnly` at `filed` or `entitled`, is skipped. The count is logged once.
- **Starting state.**
  - `entered` is a copy of `history`.
  - `e = history[stage]`. If that is absent, `e = asOf` and the draw is unconditioned.
- **First proposal.** `revisions[0] = { day: min(entered), units, stories }`. `stories` may be null (T5).
- **Carried over.** `existingUnits` and `multiPhase` are copied from T3. T3 now counts each parcel's assessor units once across in-flight projects (rule `pr.parcels.shared-existing`), so subtracting each project's own `existingUnits` at its construction start never subtracts a parcel twice among in-flight projects (IA-10). This module does not re-apportion them. §4.4.6 covers a later project on a parcel that has already been demolished.

OD-T5 applies: pipeline projects face the same tables and can die.

#### 4.4.3a Multi-phase rows with `phases` (partner rulings, round 3)

Each such row becomes a **master** plus one **phase sub-project** per entry of `phases`.

**The master** is internal: it is a `Master`, never a Schedule. It is never packed, drawn, picked or scored as a building. It holds the row's shared Planning-side entitlement.

- `entered` is the row's history for `preApplication`, `filed` and `entitled`.
- **If the row is already entitled** (`history.entitled` set, or `stage` at or past `entitled`), then `end = { kind: 'entitled', day: E }`, where `E = history.entitled` if present, else the earliest permit-side history day, else `asOf`.
- **If the row is not yet entitled**, the master runs the ordinary §4.4.2 steps on the row's pathway, with entity `'j:' + masterId`. It stops when it enters `entitled`, which sets `E`.
  - If it exits first, every phase dies unborn: no phase schedules, and the units count as exited (§4.5).
  - If it is still open at the horizon, nothing files.

**Phase sub-projects.** For phase `i` (1-based, in array order, `of = phases.length`):

- `projectId = '<masterId>:phase:<i>'`
- `origin: 'pipeline'`, `multiPhase: true`, `phase: { masterId, index: i, of, start }`, with `index` 1-based (T5, IA-21) and `start` as below
- the master's `pathway`
- `parcelIds = phases[i−1].parcelIds`
- `revisions[0] = { day: F_i, units: phases[i−1].units, stories: null }`
- `existingUnits`: the T11 assessor units of its parcels. T3 phases carry no `existingUnits` of their own, so the T11 sum is the only per-phase source. It cannot double-subtract: V24 makes a phase's parcels disjoint from the other phases (round 4 N8: the fallback caps the phase count at the parcel count P) and from every other in-flight project's parcels, and T3's shared-parcel rule covers the in-flight projects themselves (IA-10). When P = 1 there is a single phase on that parcel, staggered after entitlement by the first-phase rule.

**When a phase files** (`F_i`, its `permitFiled` day):

- **Planned date.** If `plannedPermitFiled` is set and is after `asOf`: `F_i = max(plannedPermitFiled, E + 1)`.
- **Otherwise,** with an overdue or absent plan date, the phase files one gap later: `F_i = base_i + 1 + g_i`.
  - `g_i = phaseGap.days[floor(u × phaseGap.days.length)]`, with `u = draw(entity 'j:' + masterId, k = i, PHASE_GAP)`. That is a uniform pick from the empirical gap list (tier 2, stage-calibration).
  - For `i = 1`: `base_1 = max(E, asOf)`. Using a successive-phase gap for the first phase's delay after entitlement is a tier-2 proxy. Its provenance is `phaseGap`, and it is stated in the sources dialog.
  - For `i > 1`: `base_i = max(F_{i−1}, asOf)`, where `F_{i−1}` is the predecessor's computed filing day. A predecessor's later stall or death does not hold this phase back.
- **Not filed in time.** A phase with `F_i > horizon` produces no Schedule. It is invisible, and its units stay in the master's bucket (§4.5).

**`phase.start`** (T5, IA-2). It is `'scheduled'` exactly when the phase's `permitFiled` day is the published plan date: `plannedPermitFiled !== null`, `plannedPermitFiled > asOf`, and `F_i === plannedPermitFiled`. Every other phase is `'estimated'`: an absent or overdue plan date (the `phaseGap` stagger), or a plan date that the master's later entitlement pushed to `E + 1`. fzp-mode reads this field and never infers the start from `sources` or `phases[].source`.

- `start` depends on the run when the master is not yet entitled, because `E` is drawn. `phasing.phasesScheduled` (§4.5) is the seed-independent count of phases with a usable plan date, so in a given run the number of `'scheduled'` phases can be lower than `phasesScheduled`, never higher.
- Twins share `E` and every `F_i` (common random numbers), so `start` is identical in both runs.

**From filing onwards.**

- The phase's `entered` contains **only** `permitFiled = F_i` and later stages. Neither the master's entitlement nor any other stage before `permitFiled` is copied in, so its ghost and slot stage days start at filing (render requirement). The card shows the master's entitlement as context (§4.9).
- From `F_i` the phase runs the ordinary §4.4.2 steps with entity `'j:' + projectId`, starting fresh (`monthsElapsed = 0`), so phases stall or die independently.
- Revisions follow §4.4.5, using the pipeline rule on the phase's own parcels.
- The risk set treats the master's parcels as blocked until the master ends. Each phase's parcels are then blocked until that phase ends, following the normal exit and completion rules. If the master dies, all of its parcels are at risk from that day.

#### 4.4.4 Initiation of simulated projects

**Who is at risk.** Only `hostable` T11 parcels. The hazard is constant per parcel, so the first initiation month after a risk start `r` is geometric. It is sampled by inverse CDF, not by monthly Bernoulli trials:

1. `T = max(1, ceil(log(1 − u) / log(1 − h)))`, with `log` from `math.ts`, where `u = draw(INIT, k)`.
2. The initiation day is `r + 1 + floor((T − 1 + v) × MONTH_DAYS)`, where `v = draw(INIT_DAY, k)`.
3. If that day is after the horizon, there is no initiation. A parcel with `h = 0` never initiates.

That is one draw and one division per parcel per run, against about 291 Bernoulli draws.

**Pathway.**

- A `localProgram` parcel takes `streamlined`. This is the reconciliation's tier-1 rule.
- Any other parcel draws from the normalised `pathwayForNew`.

**First stage.** `preApplication` if `draw(PPA) < ppaShare[pathway]`. Otherwise `filed`, or `permitFiled` for `permitOnly`. The measured `ppaShare` is 0, so in practice no simulated project starts at `preApplication`.

**Size.**

- The bucket is the first `byEnvelope` entry with `envelope.maxStories ≤ maxStoriesUpTo`, otherwise the last.
- Only levels with `yield[f] > existingUnits` are allowed, renormalised. If none qualifies, the hazard is set to 0. This is a structural rule, not a number: a no-gain project is not a housing filing.
- `draw(SIZE)` picks the level `f`. Then `stories = max(1, round(FILL_LEVELS[f] × envelope.maxStories))` and `units = yield[f]`.
- The draw sets `revisions[0] = { day, units, stories }`.

**Risk set** (reconciliation, "Open questions answered"):

| Parcel situation | At risk? |
|---|---|
| Free at `asOf` | Yes, from `asOf`, with `k = 0` |
| In any in-flight project | No, until the last such project ends |
| After an exit on day `x` | Yes, from `x`, with `k + 1`, at the same hazard |
| After a completion | No, for the rest of the horizon |
| Project still open at the horizon | No, for the rest of the horizon |

#### 4.4.5 Revisions (T4c)

A revision can happen only on entering a later stage `n`. That means a future entry, before `construction`, and never the project's first stage (reconciliation: the first stage carries `revisions[0]`). No revision falls after `entered.construction`. A zero-day transition can put a revision due on entering `permitIssued` on the construction-entry day itself; it is kept, and it is the as-built proposal (T5; conductor ruling A, 2026-10-18).

1. **Whether it happens.** Use the first `at` entry for `n`. A revision happens if `draw(REV, n) < probability`.
2. **The ratio.** One uniform, `draw(REV_RATIO, n)`, picks histogram bin `i`. Its residual places the ratio uniformly in `[edges[i], edges[i+1])`.
3. **New units.**
   - **Simulated:** `units' = min(max_f yield[f], max(existingUnits + 1, round(ratio × units)))`. The cap is the largest yield over the fill levels, not `yield[F−1]`, because T11 yields can be non-monotone in `f` (mini fixture 3600003); for a monotone row the two are equal (conductor ruling, 2026-10-18). A downsize is floored at `existingUnits + 1` (reconciliation round 2), so a simulated project never becomes net-negative. The size draw already guaranteed `units > existingUnits`.
   - **Pipeline:** `units' = max(1, round(ratio × units))`, capped at `max(units, Σ yield[F−1] of its parcels)`.

   The cap never forces a downsize.
4. **New stories.**
   - Simulated: the stories of the smallest level `f` with `yield[f] ≥ units'`.
   - Pipeline with known stories: `max(1, round(stories × units'/units))`. When upsizing, this is capped at `max(stories, max envelope of its parcels)`.
   - Pipeline with null stories: stays null.
5. **Record it.** If `units' ≠ units`, append `{ day, units', stories' }`.
6. **Merge same-day revisions** (T5, IA-4). Revision days are strictly ascending. `sampleTransition` can return `days` 0, so two stage entries can fall on one day (a simulated project's first stage and its next entry; a phase's `permitFiled` and `permitIssued`). A revision due on the same day as the last recorded entry replaces that entry's `units` and `stories`: the last wins, and `revisions[0]` keeps its day. If the merged entry then equals the entry before it in both `units` and `stories`, it is removed. `units` in steps 1–5 always means the current last entry. The merge is part of `simulate` itself, so every Schedule satisfies T5, and `packTimedCell`, which throws on a revision day ≤ its predecessor's (timelapse-render R17), never sees a tie. `simulateNet` applies the same merge, and the score reads the merged list.

#### 4.4.6 Construction, demolition and net units

- **Demolition.** `entered.construction` is the demolition day of every parcel in the project. It may be in the past.
- **Existing units are subtracted** at that day only when it is after `asOf`. This matches T3's baseline, which already counts demolitions up to `asOf`.
- **Final units are added** at completion.
- **Simulated projects** always replace the existing building (T11 yield has no ADU outcomes).
- **An exit from `construction`** keeps the subtraction and adds nothing.
- **A parcel is demolished once per run** (IA-10, completing the shared-parcel rule over time). Once any project on a parcel has entered `construction` (before or after `asOf`), that parcel's existing units are gone. A later project on the same parcel, a simulated re-initiation after an exit from `construction`, takes 0 existing units from it: its `existingUnits`, its size-draw rule (`yield[f] > existingUnits`, §4.4.4) and its downsize floor (§4.4.5) all use the remaining value. The initiation hazard is unchanged (the at-risk rule after an exit keeps the same hazard). This applies to both runs of a pair and to `simulateNet`.

#### 4.4.7 Output and purity

**Order.** Output is pipeline projects first, then simulated, each sorted by `projectId`. Simulated ids are `sim:<parcelId>:<k>`.

**Inputs only.** `simulate` reads every behavioural number from `input.calibration` and `input.parcels` (T9). The rule constants (`localProgram` → `streamlined`, the risk rules) are the reconciliation's.

**Fast path.** `simulateNet` is an allocation-light copy of the same logic, used for band runs. Its `completedNet`, `completedNetNew` and `entitledNew` must equal those of `score(simulateDetailed(...))` exactly.

#### 4.4.8 `baseZoning` twin and common random numbers (T9)

`baseZoning(cal, parcels)` returns the calibration unchanged and a `ScenarioParcels` **view** over the same decoded columns. Nothing is copied. In the view:

- `envelope.maxStories` is the base stories;
- `yield` is `baseYield`;
- `localProgram` is false, so new projects take the measured `pathwayForNew`;
- `hostable` is `hostable_base`;
- the `potentialRatio` and `storiesGap` features read their base variants.

**Pairing.** Every FZP run, the shown seed's and each band seed's, is paired with `simulateDetailed(baseZoningInput, sameSeed, horizon)`.

**Common random numbers.** The draws are keyed by entity, `k`, purpose and stage, never by position or envelope. So in-flight projects, multi-phase phases included, get identical stage timing, exits and ends in both runs (concern R3 covers revision units). A simulated project on a given parcel with a given `k` uses the same uniforms in both runs, so the difference isolates the plan. The difference comes from the hazard, the size draw and hostability.

**What is drawn.** Only the FZP run is packed, drawn or used for cards. Twins produce score series only. Their Schedules are discarded after scoring.

### 4.5 Score (T8)

The score is built from schedules only, as prefix sums of per-month deltas. `idx(d)` and the snapshot instant `T_i` are defined in §4.3. Value `i` is the end-of-month state.

**Shown series:**

| Series | How it is built |
|---|---|
| `completedNetPipeline`, `completedNetNew` | Split by origin; phase sub-projects count as pipeline. Add `+units_final` at `idx(complete)`. Add `−existingUnits` at `idx(construction)` when construction is after `asOf`. |
| `completedNet` | The sum of the two series above. It excludes the baseline. |
| `entitledNew` | Cumulative **net** units of simulated projects entering `entitled` after `asOf`: the revision's units on that day minus `existingUnits`. It is net so that `planEffect.entitledNew` is net units (round 3). `permitOnly` projects never count. |
| `inProgress[s]` | Units of the revision current at `T_i`, for Schedules with `entered[s] < T_i` whose next event is on or after `T_i`. |
| `exitedUnits` | Cumulative units at exit, for exits after `asOf`. |

**Multi-phase masters: no double count.** A master is not a Schedule, so it never counts as completed or demolished.

- Its **unfiled** phases' units sit in `inProgress` at the master's current Planning-side stage, or at `entitled` once it is entitled.
- At each phase's `F_i` those units leave the master's bucket and move to the phase's own Schedule. They are counted exactly once at any time.
- If the master exits before entitlement, the sum of its phases' units goes to `exitedUnits` on the exit day.
- Phases still unfiled at the horizon stay in `inProgress.entitled`.

**`planEffect`** (shown seed): `entitledNew[i]` and `completedNetNew[i]` of the FZP run, minus the same series of its `baseZoning` twin. Both are cumulative net units.

**`planEffectBand`**: nearest-rank p10, p50 and p90 per month (§4.6) of `planEffect.completedNetNew` over the paired band runs.

**Empty until computed** (T8, IA-9). `planEffect` and `planEffectBand` are `[]` in every revision 0, including each reroll's, even when the band pairs are already folded. The first band-only update after revision 0 carries the shown twin's `planEffect` and the `planEffectBand` folded so far. Before any pair is done, `planEffectBand` stays `[]` in that update too. fzp-mode shows "calculating…" while either is empty.

**`phasing`** is computed once per dataset in `buildSimInput`, independent of seed, and reused on every timeline.

| Field | Value |
|---|---|
| `masters` | number of `multiPhase` rows |
| `enrichedMasters` | number of those rows with `phases !== null` |
| `phasesScheduled` | phases with `source !== null` and `plannedPermitFiled > asOf`: a plan date from a published schedule that is used as-is. It is seed-independent; a run's `phase.start` can still be `'estimated'` for such a phase when the master's drawn entitlement pushes `F_i` past the plan date (§4.4.3a) |
| `phasesEstimated` | all other phases: fallback sizes, or the `phaseGap` stagger, including overdue plan dates |
| `unenriched` | the `phases === null` rows, as `{ projectId, label, units, drawn }`, sorted by `units` descending, then `projectId`. `drawn` is `false` exactly for a score-only last-resort master (DQ-3: no free DA parcel, recognised by empty `parcelIds`, T3), and `true` for every other row, which draws a footprint ghost. |

**Baseline.** T3 `rhnaCompletedNet`, passed through unchanged: `since` = 2022-06-30.

**Targets.** One per `M1_TARGETS` entry (`targets.ts:11`): `rhna` = 82,069 and `rhna-buffer` = 94,379.

- `deadline = dayOf(2031, 1, 31)`. This comes from partner ruling OD-T4. It is tier 1, and the source is the RHNA Primer (`targets.ts:5-8`).
- `fraction[i] = (baseline.completedNet + shown[i].completedNet) / target.units`, uncapped.

**References** (reconciliation, "References"):

| id | label | units | from | by | measure | tier and source |
|---|---|---|---|---|---|---|
| `planning-citywide` | "SF Planning: ~39,000 net units approved because of the rezoning within 5 years (citywide method)" | 39000 | `dayOf(2026,1,12)` | `dayOf(2031,1,12)` | `planEffect.entitledNew` | 1. Land Use Committee deck 2025-11-17, slide 6 (verified by fetch): https://sfplanning.org/sites/default/files/documents/citywide/fzp_land_use_committee_presentation-111725.pdf |
| `controller-high` | "Controller's Office of Economic Analysis: 14,646 net additional units from the rezoning by 2045, high growth (via press coverage)" | 14646 | `dayOf(2026,1,12)` | `dayOf(2045,12,31)` | `planEffect.completedNetNew` | 1 via secondary: https://www.kqed.org/news/12062042 (verified by fetch, 2025-10-29) |
| `controller-low` | "Controller's Office of Economic Analysis: 8,504 net additional units from the rezoning by 2045, conservative (via press coverage)" | 8504 | `dayOf(2026,1,12)` | `dayOf(2045,12,31)` | `planEffect.completedNetNew` | as above |

Notes on the references:

- **Controller primary report.** It was searched for on sf.gov's Office of Economic Analysis page and on the web, 2026-10-16, and was not found. The ruling covers this case, so the label says "via press coverage". Each `provenance.method` gives the source's own wording: "beyond what existing zoning might produce"; "over the next 20 years".
- **Inferred dates.** For the Controller entries, `from` (the FZP effective date) and `by` (the end of 2045) are inferred.

### 4.6 Band runs, seeds and the representative seed

**N = 101 band runs** (`bandRunsTotal`). This is tier 4, a numerical-method choice, not evidence. It changes no expected value. The reasons:

- It is odd, so the median is a single run.
- The rank SE at p10 is about `√(0.09/101) ≈ 0.03`.
- 101 FZP runs × 15 ms is about 1.5 s, which fits the 3 s budget when `seed` is null.

**One band run is a pair**: the FZP run plus its `baseZoning` twin on the same seed. `bandRuns` counts completed pairs. The twins roughly double the background work, to about 3 s in total, and are progressive (§4.7).

**Seeds and quantiles.**

- Band seeds are `i + 1` for `i = 0…100`.
- Quantiles are nearest-rank over the `n` runs folded so far: `p_q = sorted[ceil(q·n) − 1]`. With `n = 101`, p10 = [10], p50 = [50] and p90 = [90], taken per month over `completedNet`.

**Representative seed.** It is used when `seed` is `null` on `initScenario` or on `reroll`.

- Sort the runs by final-month `completedNet`, ties broken by lower `i`, and take rank 50.
- Its final value equals the final p50. At earlier months it need not, and that is not a bug.

**Band reuse.** Both bands depend only on the dataset, so `reroll` reuses them. The reused `planEffectBand` is still sent as `[]` in revision 0 and reappears in the next band-only update (T8). The shown run and its twin are never added to a band. A `reroll` recomputes only the shown seed's twin, and therefore `planEffect`.

### 4.7 Timeline messages and timings

**Delivery order.**

| Trigger | What happens |
|---|---|
| `seed: null` | Run the 101 **FZP** band runs in slices of ≤ 50 ms, separated by `setTimeout(0)`; `prefetch` and `parcelSummary` are served between slices. Then simulate the representative seed and post revision 0, with `band` complete, `planEffect` and `planEffectBand` `[]`, and `bandRuns` 0. Next comes the shown seed's twin, as a band-only update carrying `planEffect`. Then the band twins, as band-only updates every 16 pairs and after the last. |
| A seed is given (the common case: the seed is in the URL) | Post the shown FZP run's revision 0 first. Its `band` holds the quantiles folded so far, or `[]` before any; `planEffect` and `planEffectBand` are `[]`. Then post the shown twin as a band-only update with `planEffect` and the `planEffectBand` folded so far. Then run the band pairs, FZP and twin per seed, posting a band-only update every 16 pairs and after the last. |
| `reroll(seed)` | Cancel the old seed's geometry and twin work. Post revision 0 under the reroll's `rev`, with the reused `band`, and `planEffect` and `planEffectBand` `[]` (T8). Then post the twin's band-only update, carrying `planEffect` and the reused `planEffectBand`. |
| `reroll` before loading has finished | `bad-request`, with the message `not initialised`. |

**Revisions** count up per `(rev, seed)`.

- **Revision 0 is the snapshot.** It carries the **complete** `demolish` list for the shown run (T7: it needs no geometry), plus every ready anchored cell packed within 2.5 s of the request.
- **Revisions n > 0** add or fully replace the cells they list. They carry `demolish: []` and `removedCells: []`. A newly ready chunk produces one message per 50 ms packing slice.
- **A band-only update** is a `timeline` whose `render` is `{ revision: last + 1, cells: [], removedCells: [], demolish: [] }` (T6).
- **`bandRuns` and `bandRunsTotal`** are on every timeline. `bandRunsTotal` is N = 101. `bandRuns` counts completed pairs, from 0 to N.
  - With `seed: null`, the FZP `band` is already complete at revision 0, while `bandRuns` is still 0.
  - fzp-mode labels the bands provisional while `bandRuns < bandRunsTotal`.
- **`complete`** is true when every ready anchored cell is packed (T6). It says nothing about the band.
- **Score.** Every message carries the seed's full `TimelineScore`: 291 months, under 64 KB.

### 4.8 Geometry, memo and packing

**Massing per revision `k`.** T5: the sim stamps `source`.

- **Simulated:** `{ ...generate(scenarioRecordOf(parcels, i, rec), { maxStories: stories_k }, fnv1a32(rec.id), 'max'), source: 'scenario' }`, where `rec` is the chunk record and `i` the parcel's T11 row (IA-8). `scenarioRecordOf` (T11, codec module) replaces `existingUnits`, `existingFloorAreaM2` and `existingHeightM` with the row's values, so this is the same call the pipeline's yield made (`scenario-yield.ts:32`: same record view, same stories, same seed `fnv1a32(rec.id)`, `'max'`). An uncapped parcel's building therefore holds exactly `yield[f]` units at the size draw's level; a density-capped parcel's building can hold more than the capped yield. The seed rule is also the editor's (`host.ts:147`). Memo key: `s|<parcelId>|<stories>`.
- **Pipeline:** `generateForUnits(records sorted by id, units_k, maxStories, fnv1a32(projectId), stories_k ?? undefined)`, stamped `source: 'pipeline'`. `maxStories` is `stories_k` when known, otherwise `MAX_STORIES` (80, `constants.ts:27`), per the reconciliation's Massing ruling. Pipeline massing uses the chunk records as they are: the T11 replacement applies to simulated massing only. Memo key (pipeline-massing's memo contract, IA-22): `p|<seed>|<units>|<stories ?? '-'>|<parcel ids sorted and de-duplicated, joined by ','>`, with `seed = fnv1a32(projectId)`; `maxStories` follows from `stories` and needs no key part.
- **Phase sub-projects** (§4.4.3a) use the pipeline rule on their own parcels: `generateForUnits(phase records, units_k, MAX_STORIES, fnv1a32(phaseProjectId), undefined)`. Each phase's cell anchor is its own smallest `ParcelId`. Masters are never massed.
- **Multi-phase rows without `phases`** get no generator call. Every revision gets the footprint entry described below.

**Footprint entries** (reconciliation round 2). When a massing returns `null` or throws, that revision becomes a footprint entry `{ footprint }`. Unphased multi-phase rows take the same path.

- The ring comes from the project's footprint parcel: the largest `areaM2`, ties to the smallest id (§4.2).
- It is that parcel's outer ring, `polygon[0]` in local metres, converted to lng/lat with `localFrame(rec.labelPoint).to(x, y)` (`generator/geo.ts:13-37`; equivalently `toLngLat`, `geo.ts:39`).
- The ring is passed as stored. The shared `normaliseRing` in packing closes every ring exactly once (PR #21, merged to main), so this module never closes or reopens a ring, and its tests count a part's vertices from the packed `startIndices`, never from the input ring length (IA-22, ring-closure carry-forward).
- It is display-only geometry, so `geo.ts`'s `Math.sin` and `Math.cos` never touch the score.

As a result, `packTimedCell` gets one entry, a building or a footprint, for **every** revision, and every slot can be rendered and picked.

**Memo and failures.**

- The memo is `createLru(60_000)`. That is tier 4, an engineering budget of about 60 MB at the ≈0.8–1.0 KB per entry measured in `host.ts:50-56`.
- Keys are content-based, so pipeline projects hit the memo across every seed. Keys hold no dataset version, so the memo is valid within one `datasetVersion` only: an `initScenario` with a different `datasetVersion` clears it; one with the same version keeps it.
- A throwing generator is logged once per project (as at `host.ts:149`). Its revision falls back to the footprint entry.

**Packing.** The worker calls timelapse-render's `packTimedCell` (T7) with each schedule and its index-aligned `massings: Massing[]`. It transfers every typed array.

### 4.9 `parcelSummary` → `ProjectCard` (T6)

**When it returns null.** If the parcel's record is not loaded, the summary is `null`, following the rule at `host.ts:401`.

**ParcelSummary fields.**

| Field | Value |
|---|---|
| `neighborhood`, `landUse`, `eligible` | from the record |
| `existingUnits` | T11 assessor value, so the card can say "existing homes (assessor)" |
| `envelope` | T11 FZP envelope |
| `generated` | the chosen project's building at the shown revision, or `null` |
| `project` | the ProjectCard |

**Project choice.**

A project is **visible at `day`** when both hold:

- its first entered day is ≤ `day`;
- it has not exited more than `DYING_DAYS` before `day`. `DYING_DAYS` (= 270, display, tier 4) is imported from `src/lib/timelapse/time.ts`.

Selection, per T6:

1. If `projectId` is given, that project is returned when it is in the shown run, includes this parcel and is visible at `day`.
2. Otherwise, among the shown-run schedules on this parcel whose first entered day is ≤ `day`, the latest is taken, if it is visible.
3. If neither rule yields a project, `project` is absent.

A score-only project (empty `parcelIds`, DQ-3) is on no parcel, so no summary ever returns it.

**ProjectCard fields.**

| Field | Value |
|---|---|
| `label` | **Pipeline:** the T3 `label`, else `Block <B>, Lot <L>`. A phase uses its master row's label, so fzp-mode can render "Phase 3 of 12, Candlestick Point". **Simulated:** always `Block <B>, Lot <L>`. `B` is the first 4 characters of the anchor, plus a following letter if present; `L` is the rest. `0026T001A` → "Block 0026T, Lot 001A"; `3512008` → "Block 3512, Lot 008". These formats were verified in `fixture-0` and against live DataSF `mapblklot`. |
| `units`, `stories` | From the latest revision ≤ `day`. `stories` falls back to the building's stories, else `null`. |
| `existingUnits` | `schedule.existingUnits`, the value the score subtracts, so the card agrees with the score (T6). **Pipeline:** the project's own T3 `existingUnits`, which under the shared-parcel rule can be less than the assessor sum over its parcels. **Phase:** the T11 sum over the phase's own parcels (§4.4.3a). **Simulated:** the T11 sum over its parcel, except 0 on a parcel already demolished in the run (§4.4.6; Interface concern IC-R3). |
| `storiesTier` | **Pipeline** (including phases): T3 `storiesTier` (0 or 3) only when `stories` comes from `revisions[0]` (the record's value); `4` when `stories` comes from a later revision's proportional scaling (§4.4.5) or from the building's massing (IA-14; T6 row; IC-R2 resolved; fzp-mode prints "about N stories (simulated)" for both); `null` exactly when `stories` is `null`. A phase's revisions carry `stories: null`, so a phase's tier is `4` or `null`. **District (amended 2026-10-19, [large-site massing](2026-10-19-large-site-massing-design.md) §4.5):** `1` when every built lot is at the curated DA height (`opts.curatedStories`, T3 `phases[].stories` else the master's `daHeights.stories`); `4` when the lots' heights were drawn (no evidence) or raised to `L` because the lots ran out (§4.3 step 3). The card's `stories` is the district's tallest lot. A master without phases follows the same rule. **Simulated:** always `null` (T6: their stories are the simulated size draw). |
| `massing` | Follows reconciliation round 2, using pipeline-massing's helpers (pipeline-massing §4.9): ~~an unphased multi-phase row~~, **a score-only master (no free parcel), or a footprint entry**, gives `none`; a phase uses the pipeline rule; a master without phases that has free parcels is massed ([large-site massing](2026-10-19-large-site-massing-design.md) §4.7) and uses the pipeline rule, so it gives `matched` or `approximate`; **pipeline** gives `massingApproximate(b) \|\| massedUnits(b) === 0 ? 'approximate' : 'matched'` (`massingApproximate` alone is false for 1 unit with 0 massed: IA-22); **simulated** gives `massedUnits(b) === 0 \|\| abs(b.units − revision.units) > unitsTolerance(revision.units) ? 'approximate' : 'matched'`. |
| `stages` | Only the stages entered on or before `day`. `actual` is true only for a pipeline history day ≤ `asOf`. For a **phase**, the list starts with the master's Planning-side stages (`preApplication`, `filed`, `entitled`, each ≤ `day`, with `actual` per the master's history), followed by the phase's own stages from `permitFiled`. fzp-mode renders entries before `permitFiled` as master context, e.g. "Master plan entitled 2010". They never appear in the phase's Schedule or slot stage days (§4.4.3a). |
| `revisions` | only those on or before `day` |
| `end` | `null` when the end falls after `day` |
| `multiPhase`, `phase` | from the schedule (`phase` is `null` except for phase sub-projects) |
| `localProgram` | `true` when the project is simulated and its parcel has T11 `localProgram` in the FZP run. Otherwise `false`. |
| `sources` | Pipeline: T3 `sources`, passed through with `key`. A phase uses its master row's `sources`. Simulated: `[]`. |
| `quality` | **Pipeline:** the row's T3 `quality` ids, in their (sorted) id order, each mapped through `projects.json` `qualityRules` to `{ label, tier, valueTier }`. A phase uses its master row's `quality`. An id missing from `qualityRules` is dropped from the card and logged once (the shared validator is expected to reject it first). **Simulated:** `[]`. fzp-mode shows the labels, so a value a rule wrote is never presented as a record. |

### 4.10 Error states

| Condition | Response |
|---|---|
| Bad seed, horizon or scenario; a `reroll` before loading; `asOf ≥ horizon` | `bad-request` |
| The manifest fails its shape check | `manifest-invalid` |
| No `scenarios.fzp`, or its URLs are bad | `scenario-missing` |
| Decode fails (including `ScenarioFormatError('inflate failed')` on fully read bytes), `parseCalibration` throws, `parseProjectsFile` throws on a file-level violation, or `fillLevels` differs from `FILL_LEVELS` | `scenario-invalid`, not retried |
| A fetch fails after retries (request rejected, `ok` false, or the body read rejected) | `internal`. fzp-mode's Retry re-sends `initScenario`. |
| One or more projects are invalid (`parseProjectsFile`'s `onInvalid`) | Skipped; one aggregated warning |
| The generator throws or returns null | That revision gets a footprint entry and card `massing: 'none'`; the project is still scored |
| A chunk fails | The existing `chunks` / `retryChunks` path |
| The worker crashes | `ScenarioClient.onCrash`; the page restarts the worker and re-inits with the current seed |

### 4.11 Performance budgets

These are tier-4 engineering budgets, enforced by `scenario.bench.spec.ts`.

**Bench setup:**

- the `host.bench` synthetic city: 150,360 parcels in 16×16 cells;
- 2,000 synthetic pipeline projects;
- a bench calibration tuned to about 8,000 initiations by 2050.

| Budget | Limit |
|---|---|
| `simulateNet`, median per run | ≤ 15 ms |
| `simulate` + `score` | ≤ 80 ms |
| `initScenario(null)`: from fetched files to the first timeline (the shown FZP run), with no chunks ready | ≤ 3 s |
| `reroll` → revision 0 of the shown FZP run (warm or cold, including the 2.5 s geometry cap) | ≤ 3 s |
| Shown twin → `planEffect` update, after revision 0 | ≤ 200 ms |
| All 101 pairs complete, after revision 0 (progressive, not gating) | ≤ 4 s |
| Longest worker macrotask during band, twin or geometry work | ≤ 50 ms |
| Worker heap growth with all 256 cells loaded, after 3 rerolls | ≤ 300 MB |

The 3 s budget covers the shown FZP run only. The twin and both bands fill in progressively (round 3). Heap is measured as the `process.memoryUsage().heapUsed` delta.

**Memory impact of the twin.** It stays within the unchanged 300 MB budget:

- The `baseZoning` view shares the decoded T11 columns.
- The twin's own precompute (hazard, `log(1 − h)`, size distributions) adds about 5–8 MB for 150k parcels (inferred: 2 × Float64 plus F × Float32 per parcel).
- Band state grows by one `Int32Array(291)` per pair for `planEffect.completedNetNew`, about 120 KB.
- Twin Schedules are transient and are discarded after scoring.

Time scrubbing never messages the worker.

### 4.12 Numbers this spec introduces

| Number | Value | Tier | Source |
|---|---|---|---|
| Band runs N | 101 | 4 (numerical) | §4.6 |
| Band seeds | 1…101 | definition | §4.6 |
| RHNA deadline | 2031-01-31 | 1 | OD-T4; RHNA Primer |
| References | 39,000; 14,646; 8,504 | 1; 1 via secondary | §4.5 |
| Reference dates | 2026-01-12 → 2031-01-12; 2026-01-12 → 2045-12-31 | reconciliation / inferred | §4.5 |
| Memo cap | 60,000 | 4 (engineering) | `host.ts:50-56` |
| Slice; revision-0 geometry cap; band post cadence | 50 ms; 2.5 s; 16 runs | 4 (engineering) | §4.7 |
| Planned slice length `SLICE_PLAN_MS` | 45 ms (the 50 ms slice minus a 5 ms margin, so a job over its estimate still ends within 50 ms) | 4 (engineering; measured in `scenario.bench.spec.ts`) | §4.7, §4.11 |
| Cost-estimate window `COST_WINDOW` | 4 (a job kind's estimate is the largest of its last 4 measured costs) | 4 (engineering) | §4.7 |
| In-flight redraw attempts | 8 | 4 (numerical) | §4.4.2 |
| First-phase delay after entitlement | one `phaseGap` draw | 2 (proxy; `phaseGap` provenance) | §4.4.3a |
| Budgets | see §4.11 | 4 (engineering) | §4.11 |

This spec introduces no tier-3 or tier-4 model rates. Every behavioural rate comes from `calibration.json`, through T12.

### 4.13 Producer notes that bind this module (IA-22)

These notes were carried forward from the producers' completion reports. They are recorded here so that they are not only in the carry-forward file.

| From | Note | What this module does |
|---|---|---|
| timelapse-render R17 | `packTimedCell` throws when a revision day is ≤ its predecessor's | Same-day revisions are merged in `simulate` (§4.4.5 step 6), so every Schedule is strictly ascending before packing |
| timelapse-render R18 | The SimMap handle validates eagerly, and calls made before the map is ready throw | The worker posts only updates that satisfy T7, in revision order per `(rev, seed)`. Holding `applyTimeline` until the map is ready is fzp-mode's job, on the main thread |
| timelapse-render | `setTimelineLookups` compares its argument by identity | The worker never sends lookups. fzp-mode builds fresh `chanceTable` / `typicalMonths` objects for each calibration and never mutates them in place |
| timelapse-render R8 | `typicalDays` is floored at 1 day; a non-finite or negative value becomes `OPEN_DAY` | No action here: `typicalMonths` is not used by the worker. Tests that compare with `OPEN_DAY` use the exported constant (ruling A1) |
| pipeline-massing | the card treats `massedUnits === 0` as approximate; the memo key is (seed, units, stories, sorted de-duplicated parcel ids) within one `datasetVersion`; `b.parcelId` is the massing anchor (largest `areaM2`, ties smallest id), not the cell-placement parcel | §4.9 `massing`; §4.8 memo key and memo clearing; §4.2 footprint parcel |
| scenario-data | `readScenarioParcels` reports any stream error as `ScenarioFormatError('inflate failed')` | Bytes are read fully through `fetchBytes` first; body-read failures retry, decode failures are `scenario-invalid` (§4.2) |
| ringfix (PR #21) | packed rings are closed once, by the shared `normaliseRing` | Footprint rings are passed as stored and never closed here; vertex counts come from `startIndices` (§4.8) |
| stage-calibration (A2) | `parseCalibration` does not compare `fillLevels` with `FILL_LEVELS` | The host checks it and answers `scenario-invalid` (§4.2) |

## 5. Seams

- **T9 policy levers.** This package now ships the `PolicyOp` type and exactly one op, `baseZoning` (§4.4.8). It is applied by `applyPolicies(ops, input)`, the single place future levers would plug in.
  - `simulate` still takes all behaviour from `SimInput`, and precomputation is keyed by `SimInput` identity.
  - A test shows that calibration edits alone change outcomes: zeroed exit tables give no exits, and a zero hazard gives no simulated projects.
  - No user-facing levers are added.
- **Addenda sub-stages.** `nextStage` and the score iterate `STAGE_ORDER` generically. Nothing more.
- **DA phasing.** This is now implemented for enriched rows (§4.4.3a). Unenriched rows keep the single-project footprint path, and `phasing.unenriched` discloses them.
- **Renderings.** All massing goes through one function, `massingFor(schedule, k, records)`, which a later rendering source can replace. Nothing more.

## 6. Testing

Every test calls `expect`.

**Fixtures** (`src/lib/sim/scenario/fixtures/`):

- `mini-parcels.ts`: 60 parcels, encoded with the T11 encoder.
- `mini-projects.ts`: 14 projects before Reappraisal 1, plus the new cases below (the final count is fixed at implementation). It is a full `projects.json` with `qualityRules`. They cover:
  - every stage, multi-parcel projects and a missing current-stage day;
  - an unphased `multiPhase` row;
  - an entitled master with 3 `phases` (one planned date after `asOf`, one overdue, one null);
  - an unentitled master with 2 phases, one with a plan date close enough after `asOf` that some seeds' drawn entitlement pushes it to `E + 1`;
  - a null `label`, null stories, and one invalid project (rejected per project by `parseProjectsFile`, not at file level);
  - a score-only last-resort master with empty `parcelIds` (DQ-3; the T3 encoding);
  - a row linked by parcel (DQ-2) carrying `quality: ['pr.pipeline.status-date-linked']`, and a row carrying `pr.parcels.shared-existing`, with matching `qualityRules` entries;
  - a 1-unit pipeline project on a lot where `generateForUnits` masses 0 units, if pipeline-massing's fixtures provide one; otherwise the `massedUnits === 0` case is a unit test on a hand-made `GeneratedBuilding`.
- `mini-calibration.json` carries a `phaseGap` list.
- `mini-calibration.json`: built so that it passes `parseCalibration`.
- `synth-city.ts`: for the bench.

`fixture-0` gains the mini `scenarios/fzp/*` files, per the reconciliation, with a high initiation hazard.

### Vitest server project

**Determinism primitives**

- **`rng.spec.ts`:**
  - golden `u` values;
  - chi-square over 10⁶ draws, p > 0.001;
  - cross-purpose correlation |r| < 0.005.

**`simulate`**

- **`simulate.spec.ts`** (mini fixtures):
  - Same output across runs and after a JSON round trip.
  - Revisions only after the first stage, never at or after `construction`.
  - `permitOnly` never enters `filed` or `entitled`.
  - Future events fall in `(asOf, horizon]`.
  - History is preserved; a missing current-stage day becomes `asOf`; the invalid project is skipped.
  - **Same-day revisions** (IA-4): with a calibration rigged so that a stage step returns `days` 0 and every revision fires, every Schedule's revision days are strictly ascending; the merged entry holds the last revision's units and stories; a merge back to the previous entry's units and stories removes the entry; `packTimedCell` accepts every Schedule of the run.
  - **Demolished once** (§4.4.6): a parcel whose project exits from `construction` and is re-initiated gives the new project `existingUnits` 0, and `completedNet` subtracts the parcel's units once.
  - **Score-only master** (DQ-3): it has a Schedule with empty `parcelIds`, is counted in the score series, and blocks no parcel.
  - A `localProgram` parcel gives `streamlined`.
  - Only `hostable` parcels initiate.
  - Risk rules: no re-initiation after completion; re-initiation after an exit, with `k + 1`; blocked while in flight.
  - The size draw never chooses `yield ≤ existingUnits`.
  - Caps hold, and null stories stay null.
  - A simulated downsize never goes below `existingUnits + 1`.
  - **In-flight redraw:**
    - a fixture project whose first draw lands on or before `asOf` is redrawn, and its accepted day is > `asOf`;
    - a calibration rigged so that all 8 attempts land at or before `asOf` takes the fallback `asOf + 1`;
    - across 20,000 synthetic projects, the accepted outcomes match the incidence conditioned on survival to `asOf`, within 4·SE.
  - `source` stamping is correct.
- **`simulate.incidence.property.spec.ts`** (acceptance: "reproduces observed per-stage death rates", through the whole engine):
  - **Fresh entries:** for each Transition in the fixture calibration, 20,000 synthetic pipeline projects enter that stage on day `asOf − 0`, with the horizon far out. The simulated cumulative incidence of advance and of each exit, by month, must be within 4·SE of T12 `cumulativeIncidence(t, k)`, which includes the tail beyond `months`.
  - **In-flight cohort:** the same check for projects `m` months in, against the conditional incidence derived from `cumulativeIncidence` (survival to month `m` divided out). No second incidence implementation is written.
- **`simulate.property.spec.ts`:**
  - Adding or removing unrelated parcels or projects, or shuffling input order, leaves the other schedules identical.
  - `simulateNet` equals `score(simulateDetailed)` for 50 seeds, on all three series, for both FZP and `baseZoning` inputs, including the same-day merge and the demolished-once rule.
- **`policy.spec.ts`:**
  - the `baseZoning` view swaps envelope, `yield`, `localProgram`, `hostable` and the feature variants, and copies nothing (the same typed-array buffers);
  - the calibration is unchanged;
  - **common random numbers:** for 20 seeds, every in-flight and phase Schedule has identical `entered` and `end` in the FZP run and its twin;
  - with base columns made equal to the FZP columns, `planEffect` is identically 0.
- **`multiphase.spec.ts`:**
  - a master is never a Schedule;
  - phase ids are `<masterId>:phase:<i>`, and each phase's `entered` starts at `permitFiled`, with nothing earlier;
  - `F_i` follows the plan date, the overdue-date rule, the null-date rule and the first-phase rule, using `PHASE_GAP` draws keyed by master and index;
  - `phase.index` is 1-based; `phase.start` is `'scheduled'` exactly when `F_i` is the plan date, and `'estimated'` for the overdue, null and pushed-to-`E + 1` cases (IA-2); it is identical in each twin;
  - an unentitled master that exits gives no phases, and its units go to `exitedUnits`;
  - phases stall and die independently;
  - each phase's `existingUnits` is the assessor sum of its own parcels, which are disjoint (N8); with P = 1 there is a single phase;
  - an unphased row stays single-project.
- **`initiation.property.spec.ts`:** first-initiation months follow the geometric distribution within 4·SE.

**Score, band and card**

- **`score.spec.ts`:**
  - Hand-computed deltas for every series, including net `entitledNew`, `planEffect`, the master bucket's `inProgress` and `exitedUnits`, with no double count between master and phases.
  - `phasing` counts and the `unenriched` order on the mini fixture, identical for every seed; the score-only master is in `unenriched` with `drawn: false`, every other entry `drawn: true`.
  - `planEffect` and `planEffectBand` are `[]` in revision 0 (also after a reroll with a folded band) and filled by the next band-only update (T8).
  - 291 months, from 2026-10-01 to 2050-12-01.
  - Each value is the end-of-month state: an event on 2026-10-20 counts at `i = 0`; one on 2026-11-01 counts at `i = 1`; one on 2050-12-31 counts in the last entry.
  - No subtraction for construction before `asOf`.
  - Target fractions include the baseline; deadline 2031-01-31.
  - The references match §4.5 exactly.
- **`band.spec.ts`:** nearest-rank quantiles for `band` and `planEffectBand`; the rank-50 representative with its tie-break, using FZP runs only; partial bands; `bandRuns` counts pairs.
- **`card.spec.ts`:**
  - labels for `0026T001A`, `2999A019` and `3512008`, and the pipeline label;
  - `projectId` honoured when visible, and falling back to the day rule when not;
  - the day-based choice, including the `DYING_DAYS` cut;
  - filtering of stages, revisions and `end`;
  - `existingUnits` from the schedule: T3's value for a pipeline row on a shared parcel (`pr.parcels.shared-existing`, less than the assessor sum), the T11 sum for phases and simulated projects;
  - `storiesTier`: T3's tier for stories from `revisions[0]`, `4` for stories from a later revision scaled from the record (§4.4.5) and for stories from the building, `null` exactly when `stories` is null, `null` for simulated;
  - `quality`: ids mapped through `qualityRules` to `{ label, tier, valueTier }` in id order; a phase inherits its master's; simulated `[]`; an unknown id dropped and logged once;
  - `sources[].key`;
  - the `massing` rule: pipeline and phases via `massingApproximate` or `massedUnits === 0`; simulated via `unitsTolerance` or `massedUnits === 0`; footprint and unphased multi-phase give `none`;
  - `localProgram`; `phase`; a phase card's `stages` starting with the master's Planning-side entries, followed by the phase's own.
- **`footprint.spec.ts`:**
  - a null or throwing massing gives a footprint entry whose ring is the largest-area parcel's `polygon[0]` through `localFrame`;
  - unphased multi-phase rows take the same path, and phases are massed with `generateForUnits` on their own parcels;
  - the entries stay index-aligned with `revisions`;
  - footprint rings are passed as stored, and the test reads the packed part's vertex count from `startIndices` and compares it with `normaliseRing` applied to the same ring, never with the input ring's length;
  - **simulated massing on the scenario record** (IA-8): for every simulated project on an uncapped mini parcel, the revision-0 building's `units` equals `revisions[0].units`, because the call matches the pipeline's yield call, and its `stories` is at most the drawn level's stories (equal on at least one parcel): the generator can saturate a typology's volume below the drawn level, e.g. 6 → 5 stories on the mini 9-unit lots at f4, while the units still equal the yield (operator ruling, accepted by the conductor 2026-10-18); the building is generated from `scenarioRecordOf(parcels, i, rec)`, not from `rec` (a spy on the generator's input record shows the T11 `existingUnits`);
  - the pipeline memo key includes the sorted, de-duplicated parcel ids, and the memo is cleared by an `initScenario` with a different `datasetVersion`.

**Host, router and client**

- **`scenario-host.spec.ts`** (a harness modelled on `src/lib/sim/test/harness.ts`, with a fake clock):
  - `ready`, then the first timeline.
  - A null seed gives a complete `band`, `planEffect` `[]` and `bandRuns` 0 on revision 0. Then the twin update fills `planEffect`, and pair updates raise `bandRuns` to `bandRunsTotal` = 101.
  - A seeded init streams band-only updates with the exact T6 `render` shape.
  - Every timeline carries `bandRunsTotal`.
  - `complete` tracks packing only.
  - A `reroll` recomputes only the shown twin.
  - Twin Schedules are never packed.
  - `reroll(null)` returns the representative seed; `reroll` reuses the band.
  - Stale revs are handled.
  - Revision 0 carries the full `demolish` list; later revisions carry none.
  - A multi-parcel project waits for all its cells.
  - The memo hits on reroll.
  - Every row of §4.10, including: a `fetchBytes` whose `arrayBuffer()` rejects is retried and, after the retries, gives `internal`; corrupt `parcels.bin` bytes give `scenario-invalid` with no retry; a file-level `projects.json` violation gives `scenario-invalid`; invalid projects are skipped with exactly one warning; a `fillLevels` mismatch gives `scenario-invalid`.
  - A score-only project is never packed and has no `demolish` entry.
  - Slices take ≤ 50 ms.
- **`worker-router.spec.ts`:** routing as in §4.1.
- **`scenario-client.spec.ts`:**
  - the barrier;
  - resync sends one `reroll(currentSeed)`;
  - no resync on error;
  - crash and restart, then `initScenario` only;
  - `prefetch(bbox)` and `retryChunks()` post the existing request shapes;
  - `parcelSummary` forwards `projectId`.
- **`types.spec.ts`:** compile-time assertions that `src/lib/sim/scenario/types.ts` matches the amended T5, T6 and T8 rows (`phase.start`, `storiesTier` 4, `quality`).
- **Lint:** `npm run lint` fails on a `Math.log` placed in any file under `src/lib/sim/scenario/` (a fixture check in the ESLint config's test, or a one-off verification recorded in the completion report).

**Bench and regression**

- **`scenario.bench.spec.ts`:** the §4.11 budgets.
- Existing `host*.spec.ts`, `client.spec.ts` and `display.spec.ts` pass with no edits.

### Pipeline (`npm run test:pipeline`)

**`simulate-replay.test.ts`** checks the whole engine against real history.

- **Inputs** (round 4 N9). Cohorts follow each stage's own fitting window:
  - **Planning-side stages** (`filed`, `entitled`): one cohort per `(pathway, stage)` with n ≥ 50, from T4d histories that entered the stage on or after 2015-01-01.
  - **`preApplication`:** one cohort pooled across pathways, from histories that entered it on or after 2015-01-01, because stage-calibration always fits `preApplication` pooled (stage-calibration §4.5). Each twin runs its history's declared pathway; an unclassifiable history takes a pathway from the cohort's own mix, as on the permit side (conductor ruling, timelapse-sim final review, 2026-10-18).
  - **Permit-side stages** (`permitFiled`, `permitIssued`, `construction`): one cohort per stage, pooled across pathways, using stage-calibration's pooled window, which starts on 2007-01-01 for all three (DQ-1). A spell that started earlier and is still running then enters by left truncation at 2007-01-01, as in the fit.

  Each history is converted to an in-flight starting state at its stage entry.
- **Run:** call `simulate` with 20 seeds, censoring each simulated project at its own `lastObserved` or the snapshot.
- **Check:** compare Aalen–Johansen cumulative incidence against the observed histories.
  - **Planning-side stages:** strict, per pathway, against the observed cohort; `preApplication` against its pooled cohort, with simulated pathways mixed in the cohort's own proportions.
  - **Permit-side stages:** against the pooled cohort, with simulated pathways mixed in the cohort's own proportions. No per-pathway check here, because the pooled tables are scaled per pathway.
  - **Pass bar:** max |Δ| ≤ max(0.03, 2.5·SE), at every month of the observed table.
  - **Too-thin cohorts:** a cohort with no month at stage-calibration's at-risk minimum (`nRiskMin`, 20 observed at risk) has no observed table to compare. It is reported as too thin, with its n and its largest observed at-risk. It is not a failure.
  - **Pass rule:** a block fails if no cohort is comparable, or if any comparable cohort is outside the pass bar. Each block prints its per-cohort table.
- **Overlap:** this complements stage-calibration's V-check of `sampleTransition` alone. The tolerance is a test parameter, not a model number.

### Playwright e2e

**`e2e/fzp-sim.spec.ts`** (with fzp-mode, on `fixture-0`):

- Only the viewport's chunks and the three scenario files are fetched.
- The first timeline arrives within 3 s.
- A reroll changes the shown run but not the band.
- The same URL seed after a reload gives an identical `TimelineScore`.

The existing `/` and `/p/:id` suites pass unchanged. The axe gate on `/fzp` belongs to fzp-mode.

## 7. Acceptance criteria

1. **Determinism.** `simulate` is deterministic across runs, machines and an input JSON round trip.
   - Golden schedules for the mini fixtures at seed 1 pass in Node and in Chromium.
   - Unrelated input changes never alter another schedule.
2. **Stage rates.** Simulated per-stage advance and exit incidence matches the calibration, both for fresh and for in-flight cohorts (server). The historical replay passes (pipeline).
3. **In-flight projects.** They keep their history. Their first future event falls after `asOf`.
4. **Revisions.** They occur only on later stage entries before `construction`, and none falls after `entered.construction` (one due on the construction-entry day is the as-built proposal, T5). Caps hold. Units are ≥ 1. Revision days are strictly ascending; same-day revisions are merged, the last wins (T5, IA-4).
5. **Net units.** Existing units are subtracted at a construction start after `asOf`; final units are added at completion. `completedNet = completedNetPipeline + completedNetNew`. Pipeline subtraction uses T3's shared-parcel `existingUnits` (IA-10), and a parcel's existing units are subtracted at most once per run (§4.4.6).
6. **Score shape and contents.**
   - 291 months, from asOf's month to the horizon's month, each holding the end-of-month state.
   - Deadline 2031-01-31; target fractions include the baseline.
   - `references`, net `entitledNew`, `planEffect`, `planEffectBand` and `phasing` are as in §4.5. `planEffect` and `planEffectBand` are `[]` in every revision 0 (T8).
   - References compare with `planEffect.entitledNew` (Planning) and `planEffect.completedNetNew` (Controller), both in net units.
7. **Band.** N = 101 pairs. With a null seed, the shown run's final `completedNet` equals the final FZP p50.
8. **Timeline delivery.**
   - Revision 0 carries the complete `demolish` list.
   - `complete` means the loaded cells are packed.
   - `bandRuns` counts completed pairs; `bandRunsTotal` = 101 on every timeline.
   - The 3 s budget covers only the shown FZP run; the twin and bands follow progressively.
   - Band-only updates have the T6 shape.
   - A reroll posts revision 0 within 3 s (bench).
9. **Geometry.**
   - Built only for anchors in ready cells.
   - Each content key is generated once while memoised.
   - `source` is stamped `scenario` or `pipeline`.
   - Unphased multi-phase rows, and every failed massing, get footprint entries, so every revision has an entry.
   - Phases are massed on their own parcels.
   - Masters and twins are never packed.
10. **Card.** It follows T6 exactly:
    - `projectId` first, then the `day` rule;
    - no future stages, and `end` null after `day`;
    - labels, `existingUnits` (the schedule's, per the T6 source rule), `storiesTier` (including 4 from a scaled later revision and from the massing), `phase` (with `start`), `localProgram`, `quality` and `sources[].key`;
    - the round-2 `massing` rule, with `massedUnits === 0` approximate;
    - master entitlement shown as context on phase cards only.
11. **Editor unchanged.** `host.ts`, `display.ts` and `client.ts` have no diff, and their tests pass untouched.
12. **Errors.** Every §4.10 condition produces its stated response, and the worker remains usable. A body-read failure is retried; a decode failure is `scenario-invalid` and is not retried. Invalid projects are skipped through `parseProjectsFile`'s `onInvalid`, with one aggregated warning, and no `projects-shape.ts` exists.
13. **Budgets.** The §4.11 budgets hold.
14. **Step-0 types.** `src/lib/sim/scenario/types.ts` lands first, and `protocol.ts` re-exports it.
15. **Client.** `ScenarioClient`, including `prefetch` and `retryChunks`, ships in `src/lib/sim/scenario-client.ts`.
16. **Redraw rule.** An in-flight first event is never on or before `asOf`. It is redrawn up to 8 times, then placed at `asOf + 1`.
17. **Plan-effect twin.** Every FZP run is paired with a `baseZoning` run on the same seed. In-flight and phase stage timing and ends are identical across each pair.
18. **Multi-phase.**
    - A row with `phases` becomes an unscored master plus phase Schedules.
    - Each phase's `entered` starts at `permitFiled`.
    - Phase units are counted once, through the master bucket and then the phase.
    - `phase.index` is 1-based and `phase.start` follows §4.4.3a (IA-2, IA-21).
    - A last-resort master with no free DA parcel is score-only: simulated and counted, no geometry, listed in `phasing.unenriched` with `drawn: false` (DQ-3).
19. **Lint scope.** `eslint.config.js`'s determinism rule covers `src/lib/sim/scenario/**` (IA-7).
20. **Simulated massing.** Simulated buildings are generated from `scenarioRecordOf(parcels, i, rec)`, so an uncapped parcel's revision-0 building holds the drawn yield (IA-8).

## 8. Open questions

None remain for this subsystem. The reconciliation answered the earlier ones:

- **Q1:** the card shows no future stages.
- **Q2:** after an exit, a parcel is at risk again immediately, at the same hazard.
- **Q3:** reroll seeds are any uint32.

R1 and R2 are resolved by the late rulings (now in the T12 row), and R3 by round 4 N3 (§2). The interface questions opened by Reappraisal 1 follow.

## Interface concerns (reappraisal 1)

All three are ruled (ledger, "TS spec revised", 2026-10-17) and the rows are amended; this spec follows the rulings.

| # | Concern | Ruling | Where applied |
|---|---|---|---|
| IC-R1 | **DQ-3 has no T3 encoding.** A last-resort master whose DA parcels are all held is score-only, but the T3 row did not say how such a row is marked, and the shared validator rejected an empty project `parcelIds` (`checkParcelIds(…, nonEmpty = true)`, `projects.ts:201`). | **Resolved.** T3 `parcelIds` may be `[]` only for a score-only last-resort master (`multiPhase` true, `phases` null, `quality` holds `pr.multiphase.score-only`); project-records' V20 and `parseProjectsFile` accept it there only. T3 amended. | §4.2, §4.4.3, §4.5 (`drawn: false`), §6 |
| IC-R2 | **`storiesTier` of scaled revisions.** A pipeline revision after `asOf` scales the record's stories (§4.4.5); the row's tiers were "recorded", "parsed" and "from the simulator's massing". | **Resolved.** Later-revision scaled stories take `storiesTier` 4; 0 and 3 apply only to `revisions[0]`. T6 amended ("4 = from the simulator's massing or a later revision's proportional scaling"). | §4.9, `card.spec.ts` (§6) |
| IC-R3 | **Card `existingUnits` after a demolition in the run.** §4.4.6 subtracts a parcel's existing units at most once per run, so a simulated re-initiation on a parcel demolished earlier in the run has `existingUnits` 0, while the T6 row said a simulated card shows the T11 sum. | **Resolved.** T6 amended: a simulated card's `existingUnits` is "the T11 sum of its parcels not already demolished earlier in the run". The card shows `schedule.existingUnits`, which already matches. | §4.4.6, §4.9 (no change needed) |

## Reappraisal 1 changes

- **Rows and constraints verbatim.** §2 rows T1–T12 replaced from the current design by script, byte for byte; the Global constraints copy now includes the "Data quality" bullet and the header text change. T13 and T14 are named as not consumed. R1 and R2 now cite the T12 row (IA-15, IA-16).
- **IA-2, IA-21.** `phase.index` 1-based; `phase.start` set in §4.4.3a: `'scheduled'` iff `F_i` is the published plan date, else `'estimated'`; relation to `phasing.phasesScheduled` stated; tests and AC 18.
- **IA-4.** Same-day revisions merged in `simulate` (§4.4.5 step 6), last wins, strictly ascending; tests and AC 4.
- **IA-5, IA-6, A4.** `projects.json` validated with `parseProjectsFile(json, { onInvalid })`; invalid projects skipped with one aggregated warning; file-level violation → `scenario-invalid`; `projects-shape.ts` removed from the file table, §4.2 and §4.10.
- **IA-7, A3.** `eslint.config.js` scope edit adding `src/lib/sim/scenario/**` listed under §1; `Math.pow` and `**` banned too (T12); AC 19.
- **IA-8.** Simulated massing uses `scenarioRecordOf(parcels, i, rec)` (§4.8); test that uncapped revision-0 buildings hold the drawn yield; AC 20.
- **IA-9 / T8.** `planEffect` and `planEffectBand` are `[]` in every revision 0, including reroll's, and are filled by the next band-only update (§4.5, §4.6, §4.7).
- **IA-10.** §4.4.3 and §4.4.3a no longer argue exclusivity only for phases: T3's shared-parcel rule makes per-project subtraction correct. New TS-internal rule in §4.4.6: a parcel is demolished once per run (raised as IC-R3 for the card; resolved, T6 amended).
- **IA-14.** `storiesTier` 4 when stories come from the massing; `null` iff stories null; simulated cards always `null` (amended T6 row); the residual scaled-revision question (IC-R2) is ruled: scaled later revisions take `4` (T6 amended, §4.9).
- **IA-22.** Carry-forwards folded in: the `massedUnits === 0` approximate rule; the pipeline memo key (seed, units, stories, sorted de-duplicated parcel ids) and clearing the memo when `datasetVersion` changes; the massing anchor (`b.parcelId`) is not the cell anchor; `readScenarioParcels`' stream error vs a retryable body read; TR R17, R18, `setTimelineLookups` identity and the `typicalDays` floor; ring closure (PR #21); A2 `fillLevels` check → `scenario-invalid`. All are gathered in the new §4.13.
- **T6 ProjectCard.** `quality` as `{ label, tier, valueTier }` (T3 ids through `qualityRules` in id order; phases inherit the master's; simulated `[]`); `existingUnits` source per the row (pipeline: T3; phase: T11 sum of its own parcels; simulated: T11 sum).
- **DQ-3.** Score-only last-resort masters (empty `parcelIds`): simulated and counted, no geometry, listed in `phasing.unenriched` with `drawn: false` (amended T8) (§4.2, §4.4.3, §4.5, §4.9); the T3 marking, raised as IC-R1, is now in the T3 row (`parcelIds: []` only for that master).
- **DQ-2.** Parcel-linked PRX rows (Freedom West) need no special handling; noted in §4.4.3; fixture row with `pr.pipeline.status-date-linked`.
- **DQ-1.** The replay test's permit-side cohorts start on 2007-01-01, replacing the round-3 "around 1989" text.
- **T12.** The days contract and `math.ts` are cited from the T12 row (§4.4.1, §4.4.2); the incidence property tests compare with T12 `cumulativeIncidence` and write no second implementation.
- **Step-0 types.** §2 notes that this module updates its own step-0 declarations in `types.ts` to the amended T5, T6 and T8 rows; `types.spec.ts` asserts them.
- **Status line** updated.
- **Fidelity pass 3 (2026-10-17).** IC-R1..IC-R3 marked resolved with their rulings, and the stale "pending IC-R1" texts replaced by the T3 encoding (F3-9); `storiesTier` 0/3 only for `revisions[0]`, 4 for a scaled later revision or the massing, in §4.9 and `card.spec.ts` (F3-4).
