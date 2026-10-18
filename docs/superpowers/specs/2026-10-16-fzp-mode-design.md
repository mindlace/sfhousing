# `fzp-mode`: the Family Zoning Plan timelapse page (spec)

Status: reconciled with the design's interface reconciliation, reconciliation round 2 and partner rulings round 3 (2026-10-16). Revised 2026-10-17 to the design's Reappraisal 1 (DQ-1..DQ-4, IA-1..IA-28). Composition: [FZP timelapse design](../design/2026-10-16-1903-fzp-timelapse.md) (approved with partner rulings OD-T1..T5). Slug `fzp-mode`. Route `/fzp`. Built last (dependency order step 4).

## 1. Scope

From the design, verbatim:

- **`fzp-mode`** (route `/fzp`). A read-only page: the map, plus a **time scrubber** (play/pause, speed, date readout, keyboard-operable), a **time-aware scoreboard**, a ghost-state legend, a **project card** on hover or tap, a **"Where these numbers come from"** panel listing each parameter's tier and source, and a **"Show another possible future"** reroll. There is a header link between the editor and this mode.

**In scope**

- The route `src/routes/fzp/` (`+page.ts`, `+page.svelte`) and a new module `src/lib/fzp/`: the page composition (using timelapse-sim's `ScenarioClient`), the time scrubber, the time-aware scoreboard (a sibling of the editor's), the chart, the ghost-state legend, the project card, the "Where these numbers come from" dialog, the reroll, the seed in the URL, an e2e debug hook, and all copy.
- Shell changes: `/fzp` becomes a full-height route; a mode link in the site header.
- Attribution: a conditional notice on `/attribution` and a licence-aware title in the on-map attribution.
- Tests: unit, component, e2e and the axe gate for everything above.
- `docs/dev/fzp-mode.md` (the scrubber contract, layout variables and debug hook), linked from `CLAUDE.md`'s scoped docs list.

**Out of scope** (owned elsewhere or deferred)

- Schedules, the band, `TimelineScore` and `chanceTable` (timelapse-sim). GPU ghost rendering, bars, `applyTimeline` and `setTime` internals (timelapse-render). Scenario files (scenario-data, project-records, stage-calibration).
- Any change to `/` or `/p/:id` behaviour, to `BrushEditor`, or to `Scoreboard.svelte`. The editor gains only the header link.
- Policy levers, sharing a timelapse view (no `t` in the URL), painting, transit layers on `/fzp`, renderings and affordability breakdowns.

## 2. Interfaces

Rows this subsystem consumes, copied verbatim from the design's interface table. fzp-mode owns no T-row.

| # | interface | owner → consumers | mark |
|---|---|---|---|
| T1 | `type Day = number` is integer days since 1970-01-01 UTC. All schedule times use it. It is exact in Float32. `MONTH_DAYS = 30.436875` (365.2425 / 12). `monthsIn(enteredDay, day) = floor((day − enteredDay) / MONTH_DAYS)` is the single months-in-stage rule, used by every table index (T4, T12, the bar, the card). `OPEN_DAY = Math.fround(3.0e38)` encodes an open-ended window end (exact in Float32; consumers compare with the exported constant, never a literal: A1). `DYING_DAYS = 270` is the display window of a death (90 days red, then a 180-day fade; tier 4), read by timelapse-render's uniforms and by timelapse-sim's card visibility. These live in `src/lib/timelapse/time.ts` | stage-calibration → all | DC |
| T2 | `type Stage = 'preApplication' \| 'filed' \| 'entitled' \| 'permitFiled' \| 'permitIssued' \| 'construction' \| 'complete'`; `type Pathway = 'discretionary' \| 'streamlined' \| 'permitOnly'`; `type ExitReason = 'withdrawn' \| 'disapproved' \| 'cancelled' \| 'expired'`. `STAGE_ORDER` lists the stages in this order. `preApplication` is optional on every pathway. `permitOnly` projects never enter `filed` or `entitled`. A ghost is visible from the project's first entered stage | stage-calibration → project-records, timelapse-sim, timelapse-render, fzp-mode | MC (stage sequence and exits follow real records), DC (names) |
| T3 | `interface InFlightProject { id: string /* 'PRJ:<record_id>', 'BP:<permit>', 'PRJ:<record_id>:BP:<permit>' for split pipeline rows, 'CASE:<case_no>' for PRX rows, 'PPA:<record_id>' for PPA-only; unique */; label: string \| null /* street address from the records, if any */; parcelIds: ParcelId[] /* current mapblklot, mapped through retired-parcel lineage; [] only for a score-only last-resort master (multiPhase, phases null, quality includes 'pr.multiphase.score-only'): no free DA parcel (DQ-3) */; pathway: Pathway; stage: Stage; history: Partial<Record<Stage, Day>> /* observed entry days */; units: number; existingUnits: number; stories: number \| null; storiesTier: 0 \| 3 \| null /* 0 = recorded field, 3 = parsed from description text */; multiPhase: boolean /* PRX/DA remaining-phase row */; phases: { units: number; parcelIds: ParcelId[]; plannedPermitFiled: Day \| null /* from the DA phasing schedule, if enriched */; source: { label: string; url: string; retrieved: string } \| null }[] \| null /* multi-phase only: null until enriched, then each phase is simulated as its own sub-project */; sources: { dataset: string; id: string; key?: string /* field to query, e.g. 'case_no'; absent = the dataset's record-id field */ }[]; quality: string[] /* sorted T14 rule ids that changed or estimated a value of this project; [] if none */ }`. `existingUnits` counts each parcel's assessor units once across in-flight projects (rule `pr.parcels.shared-existing`). `scenarios/fzp/projects.json` = `{ schema: 1; asOf: Day; rhnaCompletedNet: { units: number /* net units added since `since` up to `asOf`, Housing Inventory definition: completions plus alteration gains, minus demolitions and alteration losses */; since: Day /* 2022-06-30, RHNA projection period start */; provenance: Provenance }; qualityRules: { id: string; label: string /* generic, about the rule, never naming a record */; tier: 2 \| 3 \| 4 /* of the rule */; valueTier: 0 \| 1 \| 2 \| 3 \| 4 \| null /* of the value it writes; null if it writes none */ }[] /* every id used in any project's quality, sorted by id */; projects: InFlightProject[] }`. Projects are new construction only (alterations adding units are out of scope). The shared validator is `parseProjectsFile(json, opts?: { asOf?; parcelIds?; onInvalid?: (path: string, message: string) => void })` in `src/lib/timelapse/projects.ts`: without `onInvalid` it throws at the first violation (V20); with it, an invalid project is reported and left out of the returned file, and a file-level violation still throws | project-records → timelapse-sim, fzp-mode, stage-calibration (`asOf`, pathway mix) | MC (real pipeline is the starting state), DC (shape) |
| T4 | `interface Provenance { tier: 0 \| 1 \| 2 \| 3 \| 4; label: string; sources: { label: string; url: string }[]; method: string; n?: number; window?: [from: string, to: string] }`. `interface Transition { months: number; advance: number[] /* cumulative incidence by month 1..months */; exit: Partial<Record<ExitReason, number[]>>; tail: { advance: number; exit: Partial<Record<ExitReason, number>> } /* constant monthly hazards beyond months */; provenance: Provenance; tailProvenance: Provenance /* tier 2: extrapolation beyond the observed months */ }`. `scenarios/fzp/calibration.json` = `{ schema: 1; asOf: Day; transitions: Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Transition>>>; initiation: InitiationModel; pathwayForNew: Record<Pathway, number> & { provenance: Provenance }; size: SizeModel; revision: RevisionModel; streamlinedForLocalProgram: Provenance /* tier 2: Local Program projects use the streamlined tables */; phaseGap: { days: number[] /* empirical gaps between successive phases' permitFiled */; provenance: Provenance } }`. The calibration also carries `ppaShare: Record<Pathway, number> & { provenance: Provenance }`, the share of new projects that start at `preApplication`. `InitiationModel`, `SizeModel` and `RevisionModel` are rows T4a–c. Everything is plain JSON, so future policy levers can transform it (the T9 seam). **Sampling semantics:** a project entering stage *s* at day *d* draws one uniform. The month of advance or exit comes from the cumulative tables (`advance` + Σ`exit` ≤ 1 at every month), with the tail hazards beyond `months`. An in-flight project already *m* months into *s* draws conditionally on having survived *m* months. Day within the month is uniform | stage-calibration → timelapse-sim, fzp-mode | MC (every parameter carries tier + source), DC (encoding) |
| T4a | `type FeatureId = 'potentialRatio' /* yield units at full envelope ÷ max(existingUnits, 1); base variant uses the density-capped base yield (T13), FZP variant the Local Program yield (T11) — this is how density decontrol is seen */ \| 'existingUnits' \| 'lotAreaM2' \| 'yearBuilt' \| 'storiesGap' /* envelope stories − existing stories */ \| 'improvementShare' /* improvement ÷ (land + improvement) assessed value */ \| 'rentControlLikely' /* 0/1: ≥ 2 units and built < 1979 */ \| 'landUseClass' /* categorical: residential, mixed, commercial, pdr, vacant, other */`. `interface InitiationModel { kind: 'logit-monthly'; intercept: number; terms: { feature: FeatureId; bins: number[] /* ascending edges; categorical features use category index */; coef: number[] /* one per bin */ }[]; provenance: Provenance }`. Monthly hazard = `1 / (1 + exp(−(intercept + Σ coef[bin(feature)])))`. It is fitted on pre-FZP (base) envelopes and evaluated on FZP envelopes. Parcels with an in-flight project are not at risk until that project ends | stage-calibration → timelapse-sim, scenario-data (feature list) | DC |
| T4b | `interface SizeModel { fillLevels: number[] /* ascending fractions of envelope stories; last = 1; length F matches T11 yield */; byEnvelope: { maxStoriesUpTo: number; probs: number[] /* length F, sums to 1 */ }[]; provenance: Provenance }`. A new project proposes `stories = max(1, round(fill × envelope.maxStories))` | stage-calibration → timelapse-sim, scenario-data (F) | DC |
| T4c | `interface RevisionModel { at: { stage: Stage /* applied on entering this stage */; probability: number; ratio: { edges: number[]; probs: number[] } /* histogram of new units ÷ previous units; edges include 1, so shrink and grow shares are separable */ }[]; provenance: Provenance }`. No revision on or after `construction`. Upsizing is capped at the parcel's envelope. A revision changes units, and stories follow from the yield table (simulated) or scale proportionally (pipeline) | stage-calibration → timelapse-sim | MC (projects can resize before construction), DC (shape) |
| T5 | `interface Schedule { projectId: string; origin: 'pipeline' \| 'simulated'; parcelIds: ParcelId[]; pathway: Pathway; entered: Partial<Record<Stage, Day>>; end: { kind: 'complete'; day: Day } \| { kind: 'exit'; stage: Stage; reason: ExitReason; day: Day } \| { kind: 'open' } /* still in progress at horizon */; revisions: { day: Day; units: number; stories: number \| null /* null = unknown until massed */ }[] /* [0] is the initial proposal; strictly ascending days (revisions due on one day are merged, the last wins); none on or after entered.construction */; existingUnits: number; multiPhase: boolean; phase: { masterId: string; index: number /* 1-based */; of: number; start: 'scheduled' \| 'estimated' /* scheduled = its permitFiled is the published plan date; estimated = the phaseGap stagger */ } \| null /* a phase sub-project of a multi-phase master */ }`. `simulate(input: SimInput, seed: number, horizon: Day): Schedule[]` is pure and deterministic. `SimInput = { parcels: ScenarioParcels /* decoded T11 */; projects: InFlightProject[]; calibration: Calibration; asOf: Day }`. Buildings of simulated projects carry `source: 'scenario'`, and pipeline projects carry `'pipeline'` (the sim stamps them) | timelapse-sim → timelapse-render (via T7), fzp-mode | MC (deaths, resizing, real starting state), DC (shape) |
| T6 | Worker protocol additions (I15 extended), served by a separate scenario host behind the same Worker and a separate `ScenarioClient` (the editor's host and `SimClient` are unchanged). Requests: `{ type: 'initScenario'; rev; manifest: Manifest; scenario: 'fzp'; seed: number \| null /* null = representative seed */; horizon: Day }`, `{ type: 'reroll'; rev; seed: number \| null }` (also the resync path: same seed → fresh revision-0 snapshot), and `{ type: 'parcelSummary'; reqId: number; parcelId: ParcelId; day: Day; projectId?: string /* the picked project; returned if visible at day */ }`. Responses: `ready` (existing shape), `{ type: 'timeline'; rev; seed: number; render: TimelineUpdate; score: TimelineScore; bandRuns: number /* band runs finished so far; the band is provisional until bandRuns = bandRunsTotal */; bandRunsTotal: number /* N */; complete: boolean /* all loaded cells packed */ }`. A band-only update is a `timeline` whose `render` is `{ revision: last + 1, cells: [], removedCells: [], demolish: [] }`, `chunks` (existing), and `error` with `code: 'manifest-invalid' \| 'scenario-missing' \| 'scenario-invalid' \| 'bad-request' \| 'internal'`. `parcelSummary` responds with `project?: ProjectCard`: the project named by `projectId` if it is visible at `day`; otherwise the project on that parcel whose first entered stage is ≤ `day`, latest first; none if no project is visible at `day`. `ProjectCard = { projectId: string; origin: 'pipeline' \| 'simulated'; label: string /* pipeline: T3 label, else 'Block B, Lot L'; simulated: always 'Block B, Lot L' */; pathway: Pathway; units: number; existingUnits: number /* pipeline: the project's T3 existingUnits; phase: the T11 sum of its own parcels; simulated: the T11 sum of its parcels not already demolished earlier in the run */; stories: number \| null; storiesTier: 0 \| 3 \| 4 \| null /* pipeline cards: 0 = recorded field, 3 = parsed from description text (both only for revisions[0]), 4 = from the simulator's massing or a later revision's proportional scaling, null iff stories is null; simulated cards: always null (their stories are the simulated size draw) */; massing: 'matched' \| 'approximate' \| 'none'; multiPhase: boolean; phase: Schedule['phase']; localProgram: boolean /* the project's parcel is a Local Program parcel and the project is simulated */; stages: { stage: Stage; day: Day; actual: boolean }[] /* only stages entered ≤ day */; revisions: Schedule['revisions'] /* only those ≤ day */; end: Schedule['end'] \| null /* null if the end is after day */; sources: { dataset: string; id: string; key?: string /* field to query, e.g. 'case_no'; absent = the dataset's record-id field */ }[]; quality: { label: string; tier: 2 \| 3 \| 4; valueTier: 0 \| 1 \| 2 \| 3 \| 4 \| null }[] /* pipeline: T3 quality mapped through qualityRules, in id order; simulated: []. A display shows valueTier when non-null, else tier */ }`. The card's chance to finish is computed on the main thread from T12 at the current time. `prefetch` is reused, viewport-driven at every zoom in this mode | timelapse-sim ↔ fzp-mode, timelapse-render | DC |
| T7 | `interface TimedPackedCell extends PackedCell { slotProjectIds: string[] /* render slots are keyed by project; parcelIds may repeat across slots */; partWindow: Float32Array /* per part: [fromDay, toDay) the part's revision is current; toDay = OPEN_DAY if open */; slotStages: Float32Array /* per slot: STAGE_ORDER.length entry days, NaN = never */; slotEnd: Float32Array /* per slot: [endDay, endKind] (0 open, 1 complete, 2 exit) */; slotPathway: Uint8Array /* index into ['discretionary','streamlined','permitOnly'] */ }`. `parcelMeta` rows describe the slot's final revision. `packTimedCell` is pure and owned by timelapse-render (in `src/lib/map/`); the worker imports it. `interface TimelineUpdate { revision: number /* 0 = snapshot */; cells: TimedPackedCell[]; removedCells: string[]; demolish: { parcelId: ParcelId; day: Day }[] /* complete list in revision 0 (needs no geometry); empty afterwards */ }`. `SimMapHandle` gains `applyTimeline(u: TimelineUpdate): void`, `setTime(day: Day): void` and `setTimelineLookups(l: { chance: ReturnType<typeof chanceTable>; typicalMonths: ReturnType<typeof typicalMonths> }): void`. `SimMapProps` gains `timelinePick?: (p: { projectId: string; parcelId: ParcelId; x: number; y: number; kind: 'hover' \| 'tap' } \| { projectId: null; kind: 'hover' \| 'tap' }) => void`. `kind` is `'hover'` for a fine-pointer move and `'tap'` for a touch tap or a mouse/pen click. A miss is `{ projectId: null, kind }`: a hover miss is sent once when the pointer leaves the timeline parts after a hover hit; a tap miss is sent on every tap or click that hits no timeline part. `null` is never sent. When `timelinePick` is set, SimMap's built-in tooltip is suppressed over timeline parts. Timeline colour tokens (`tl-*` in `palette.ts`), an exported `TIMELINE_LEGEND` and `timelineTokenCss(selector: string): string` (CSS text, no `<style>` wrapper: the `--map-*` custom properties of every `tl-*` token and of every token `TIMELINE_LEGEND` names, light values then dark under `prefers-color-scheme: dark`, scoped to `selector`, so a legend outside SimMap follows the system theme) are owned here. `setTime` does O(1) JS work per call, except the existing-building catch-up, which applies at most 2,000 feature-state changes per frame until it converges | timelapse-render ↔ timelapse-sim, fzp-mode | DC |
| T12 | In `src/lib/timelapse/model.ts` (pure, zod-free, worker-safe): `sampleTransition(t: Transition, u: number, monthsElapsed: number): { kind: 'advance' \| ExitReason; days: number }`, `initiationHazard(m: InitiationModel, f: Record<FeatureId, number>): number`, `chanceTable(cal: Calibration): Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Float32Array>>>` (per month in a stage, the probability of eventually reaching `complete`; the table is 241 months long, and the tail is used beyond it), `typicalMonths(cal: Calibration): Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, number>>>` (median months to leave each stage, used for the bar's within-stage fill), and `parseCalibration(json: unknown): Calibration` (throws on schema mismatch), and `cumulativeIncidence(t: Transition, k: number): { advance: number; exit: Partial<Record<ExitReason, number>> }` (the cumulative incidence by month k ≥ 0, tail included). `sampleTransition`'s `days` counts from stage entry and is ≥ ⌈monthsElapsed · MONTH_DAYS⌉; placing a draw that falls before the snapshot is the caller's job. Every function here, and timelapse-sim's schedule code, computes `exp` and `log` with `src/lib/timelapse/math.ts` (fdlibm ports), never `Math.exp`/`Math.log`/`Math.pow`/`**`; an ESLint rule over `src/lib/timelapse/**`, `pipeline/lib/fzp-cal/**` and `src/lib/sim/scenario/**` enforces it. The pipeline's validation, the worker, the renderer (lookups uploaded once) and the card all use these, and nothing re-implements them. The bar colour and the card's "chance of finishing" both come from `chanceTable` | stage-calibration → timelapse-sim, timelapse-render, fzp-mode | MC (health = chance of finishing, OD-T2; one sampling semantics everywhere) |
| T8 | `interface TimelineScore { months: Day[] /* months[i] = the 1st of the i-th month, starting with asOf's month and ending with the horizon's month; every series value at i is the state at the end of that month (events with day < months[i + 1], or ≤ horizon for the last entry) */; shown: { completedNet: number /* cumulative since asOf, simulation only, excludes baseline */; completedNetPipeline: number; completedNetNew: number; entitledNew: number /* cumulative net units of new (simulated) projects reaching entitled */; inProgress: Record<Exclude<Stage, 'complete'>, number> /* current proposed units of projects in each stage at that month */; exitedUnits: number /* cumulative */ }[]; planEffect: { entitledNew: number; completedNetNew: number }[] /* shown seed: FZP run minus its paired old-zoning run (T9 `baseZoning`), cumulative net units */; planEffectBand: { p10: number; p50: number; p90: number }[] /* planEffect.completedNetNew over the N paired runs */ /* planEffect and planEffectBand are [] until computed: always [] in revision 0, filled by later band-only updates */; band: { p10: number; p50: number; p90: number }[] /* completedNet over N runs, same basis as shown */; baseline: { completedNet: number; since: Day; provenance: Provenance }; phasing: { masters: number; enrichedMasters: number; phasesScheduled: number /* plan date from a published schedule */; phasesEstimated: number /* fallback sizes or phaseGap stagger */; unenriched: { projectId: string; label: string \| null; units: number; drawn: boolean /* false = score-only: no free DA parcel (DQ-3) */ }[] }; targets: TargetProgressAt[]; references: { id: string; label: string; units: number; from: Day; by: Day; measure: 'planEffect.entitledNew' \| 'planEffect.completedNetNew' \| 'completedNet'; provenance: Provenance }[] /* published estimates, each compared with the matching shown series */ }`, where `TargetProgressAt = { target: Target /* I11 */; deadline: Day; fraction: number[] /* per month, (baseline + completedNet) ÷ target, uncapped */ }` | timelapse-sim → fzp-mode | MC (net units against RHNA; band shown; baseline actuals counted), DC (shape) |
| T11 | `scenarios/fzp/parcels.bin` (codec `sfh-scenario/1`, in `src/lib/data/`; deflate inside the file, async decode). It holds **every** parcel: `id`, `labelPoint`, `cellId`, a `hostable` flag (eligible and able to host a new project: an envelope of at least one story and an uncapped full-fill yield above 0; the density cap does not gate it), `envelope: Envelope` (FZP stories: Local Program height if `localProgram`, else base height; clamped to `MAX_STORIES`), base stories, the base-zoning density cap in units (null = none), `localProgram: boolean`, `existingUnits` (latest assessor roll, post-T14) and `existingFloorAreaM2` (u32, whole m²: the value the yield used), the T4a feature values (base and FZP variants of `potentialRatio` and `storiesGap`) with an imputation mask (`imputed`, a bit set exactly when that field's value is not the source's own value: bit 0 `yearBuilt`, 1 `existingStories`, 2 `improvementShare`, 3 `existingUnits`, 4 no roll row, 5 row carried from the previous roll year, 6 `existingFloorAreaM2` (fallback to the chunk record), 7 reserved; each T14 rule that writes a parcel feature names its bit; rules that write no feature (e.g. zoning caps) have none), `hostable_base` (hostable under the old zoning: the base envelope, uncapped), `eligible` (scenario eligibility, which can differ from the chunk's `eligible`: a parcel with no land-use row but assessor units > 0 is eligible, under T14 rule `sd.landuse.none-with-units`; the `flags` column carries it as bit 5, with bits 6–7 reserved), `baseYield: Uint16[F]` (gross units at each fill level of the base envelope, density-capped), and `yield: Uint16[F]`, the gross units at each fill level of the envelope, replacement typologies only (no ADU outcomes), with no density cap under the Local Program. `FILL_LEVELS = [0.25, 0.5, 0.75, 0.9, 1]` (F = 5, tier-4 quantisation grid) is owned here, and stage-calibration imports it. Named in the manifest as `scenarios?: { fzp: { parcels: url; projects: url; calibration: url } }` (amends I12 and `ManifestBaseSchema`; optional, so older datasets load). `scenarioRecordOf(p: ScenarioParcels, i: number, rec: ParcelRecord): ParcelRecord` (worker-safe, in the codec module) returns the chunk record with `existingUnits`, `existingFloorAreaM2`, `existingHeightM` (= existing stories × 3.1) and `eligible` replaced from row i. The pipeline's yield and timelapse-sim's simulated massing both use it, so the worker reproduces the building the yield was sized from. Because the yield uses the generator, `src/lib/generator` and `src/lib/timelapse` join the dataset-version hash | scenario-data → timelapse-sim, stage-calibration (`FILL_LEVELS`, `featureValue`, `hostable`), project-records and fzp-mode (manifest `scenarios`) | DC |

Rows from the source design that this subsystem consumes, verbatim:

| # | interface | owner → consumers | mark |
|---|---|---|---|
| I11 | `interface Score { grossUnits: number; demolishedUnits: number; netUnits: number; targets: TargetProgress[]; parcelsChanged: number; byNeighborhood: Record<string, number> }`; `interface Target { id: string; label: string; units: number; range?: [low: number, high: number] /* M1 never sets; M2 affordability targets are ranges */; source: { label: string; url: string } }`; `interface TargetProgress { target: Target; fraction: number /* uncapped: 1.8 = 180% */ }`. M1 registers `rhna` (82,069) and `rhna-buffer` (94,379); M2 registers affordability targets | scoreboard → UI | MC (net units against named targets; overshoot is meaningful), DC (shape) |
| I12 | Data manifest: `/data/<datasetVersion>/manifest.json` → `{ datasetVersion, builtAt, sources: { id, label?, url, retrievedAt, license }[], chunks: { cellId, bbox, url, parcelCount }[], buildingsTiles: url, basemapTiles: url, glyphs: url /* MapLibre `{fontstack}/{range}.pbf` template */, sprite?: url, neighborhoods: url }`. All `url`s are root-relative (`/data/<v>/…`). Every eligible-or-not parcel appears in **exactly one** chunk. `buildingsTiles` has one source-layer `buildings` with properties `parcelId`, `heightM`, `baseM`, at minzoom ≤ 12, with buildings clipped to parcels. Published versions are immutable and retained indefinitely. `datasetVersion` matches `^(\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\|fixture-\d+)$` (build date + 8-hex input hash) everywhere it is validated. R2 key = `data/<datasetVersion>/<path>`, served at `/data/<datasetVersion>/<path>` | data-pipeline → platform, plan-model, brush-tool (worker host), typology-generator, map-view | DC |
| I15 | **The one main↔worker protocol** (`src/lib/sim/protocol.ts`, owned by brush-tool's worker host): `SimRequest` as in the brush-tool spec, and `SimResponse = { type: 'ready'; rev; datasetVersion; chunkCount } \| { type: 'diff'; rev; phase: DiffPhase; render: GeneratedUpdate; stats?: OpStats; complete: boolean; score: Score } \| { type: 'chunks'; status: Record<cellId, ChunkStatus>; pending: number; failed: string[] } \| { type: 'parcelSummary'; reqId: number; summary: ParcelSummary \| null } \| { type: 'error'; rev; code; message }`, with matching request `{ type: 'parcelSummary'; reqId: number; parcelId: ParcelId }` (no rev). `ParcelSummary = { parcelId; neighborhood; landUse; eligible; existingUnits; envelope: Envelope \| null; generated: { typology; stories; units } \| null }`, used by map-view's tooltip. `GeneratedUpdate` and `PackedCell` are owned by map-view (the worker imports the pure `packCell`). `Score` is owned by scoreboard (the worker calls its pure `score()`). The main thread never receives `GeneratedBuilding[]` | brush-tool ↔ map-view, scoreboard, typology-generator | DC |
| I16 | Dataset version discovery: the worker var `PUBLIC_DATASET_VERSION` names the current version for new plans. A **published** plan (`/p/:id`) renders on **its own** `plan.datasetVersion`, with an "Open with current data" action that remixes onto current. A **locally autosaved** plan is rebased to current on load: strokes are version-independent, so `datasetVersion` is rewritten and the plan re-resolved, with a one-line notice if the version changed (`manifestUrl = /data/${v}/manifest.json`). map-view and the worker host take the manifest as a parameter, never a global. If that version's manifest 404s, fall back to current and show the plan-sharing "older data" notice | platform → plan-sharing, brush-tool, map-view | DC |
| I17 | `SimMapHandle` (map-view → brush-tool), as in the map-view spec, plus `setOverlayLayers(layers: import('@deck.gl/core').Layer[]): void` for the brush ring and swath preview | map-view → brush-tool | DC |

The shell contracts consumed are `useHeaderActions(snippet)` (`src/lib/shell/header-actions.svelte.ts:15-22`) and `isFullHeightRoute` (`src/lib/shell/layout.ts:2-4`). The map-layout contract consumed is `--map-controls-br-*` (`docs/dev/map-interfaces.md`).

### Internal types (`src/lib/fzp/`; none alters a T- or I-row)

```ts
type FzpPhase = 'loading' | 'ready' | 'failed' | 'no-scenario';
type Speed = 'month' | 'year' | 'threeYears';              // playback speed choice
interface ScoreAt {                                         // score-view.ts, pure
  monthIndex: number; total: number; actual: number;        // actual = baseline.completedNet
  pipeline: number; fresh: number;                          // completedNetPipeline, completedNetNew
  planCompleted: number | null; planEntitled: number | null; // T8 planEffect[i].completedNetNew / .entitledNew; null while planEffect is [] (T8, IA-9)
  planBand: { low: number; high: number } | null;           // T8 planEffectBand p10/p90 (no baseline); null while planEffectBand is []
  band: { low: number; high: number } | null;               // p10/p90 + baseline (same basis, T8)
  inProgress: { stage: Exclude<Stage, 'complete'>; units: number }[];
  exitedUnits: number;
  targets: { tp: TargetProgress; atDeadline: number }[];    // I11 TargetProgress at this month
}
interface CardStatus {                                      // card.ts, pure
  kind: 'inStage' | 'complete' | 'exited';                  // no project visible → no card status
  stage: Stage; monthsInStage: number; day: Day;            // monthsIn(entered, t), T1
  units: number; stories: number | null; chance: number | null; // chance only for 'inStage'
}
```

## 3. Global constraints

Copied verbatim from the design.

### Global constraints

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

### Evidence hierarchy (partner ruling; global)

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

### 4.1 Route, load and states

- **Load** (`src/routes/fzp/+page.ts`, universal like `src/routes/+page.ts:8-25`): read `datasetVersion` from the layout; parse `seed` from the URL (§4.7); `loadManifest(datasetVersion, datasetVersion, fetch)` (`src/lib/sim/manifest.ts:21-36`). If `manifest.scenarios?.fzp` is absent, return `no-scenario`. Otherwise fetch `manifest.scenarios.fzp.calibration` and validate it with `parseCalibration` (T12, `src/lib/timelapse/model.ts`, the same parser the worker uses). The main thread needs the calibration for `chanceTable` (T12) and the sources dialog. Any failure returns `manifestError: true` or `calibrationError: true`, never a thrown 500. The page always uses the current dataset; there is no plan and no I16 fallback.
- **Page phases** (`FzpPhase`), each with a single `role="status"` or `role="alert"` element over the map:
  - `loading`: "Loading the simulation…". Shown until the first `timeline` answering the latest `initScenario`/`reroll` rev arrives.
  - `ready`: the controls are live.
  - `no-scenario`: the map still renders (existing buildings only). A panel says: "The Family Zoning Plan timelapse isn't available for dataset {version}. It needs simulation data that this dataset doesn't have." Below it is a link, "Go to the editor" (`/`). There is no scrubber, scoreboard or "Another future" button, and the worker is never started. This covers every dataset older than the first scenario release.
  - `failed`: "The simulation couldn't load." plus a **Retry** button (≥ 44×44 px, as `BrushEditor.svelte:417-422`). When the worker's error code is `scenario-missing` or `scenario-invalid` (T6), the message is "The simulation data for dataset {version} is missing or damaged." and Retry is still offered.
- **SimMap failures** (WebGL unsupported, context lost) are SimMap's own overlays (`SimMap.svelte:1062-1092`). The scoreboard, chart and scrubber keep working without a map, because they read only `TimelineScore`.

### 4.2 Composition and worker lifecycle

`+page.svelte` renders an sr-only `<h1>`, "Family Zoning Plan timelapse (simulation)", and `<div id="map-region" class="relative h-full">`, the same as `src/routes/+page.svelte:131-132`. Inside it is `FzpMode.svelte`, which composes `SimMap` directly (no `BrushEditor`), `TimeScrubber`, `FzpScoreboard`, `ProjectCardPanel` and `SourcesDialog`. `<svelte:head><title>`: "Family Zoning Plan timelapse · SF Housing Simulator".

- **Client.** fzp-mode imports timelapse-sim's `ScenarioClient` from `src/lib/sim/scenario-client.ts` (round 2, "Client"). fzp-mode has no client of its own, and `SimClient` is unchanged (T6). Through it the page:
  - sends `initScenario { manifest, scenario: 'fzp', seed, horizon }`, where horizon is the `Day` of 2050-12-31 (OD-T4);
  - sends `reroll { seed: number | null }`, `prefetch(bbox)`, `retryChunks()` and `parcelSummary { parcelId, day, projectId? }`, passing the picked `projectId` when there is one (T6).
  - The host answers `initScenario` with `ready` (existing shape). Phase `ready` still waits for the first `timeline`.
  - A `timeline` or `error` whose `rev` is older than the latest `initScenario`/`reroll` rev is dropped.
- **Pending state before the map handle exists** (mirroring `BrushEditor.svelte:149-163,298-312`): `TimelineUpdate`s and chunk statuses queue, and an update with `revision === 0` clears the queue. `onready(h)` then:
  1. calls `h.setTimelineLookups({ chance: chanceTable(cal), typicalMonths: typicalMonths(cal) })` (T7, T12). It computes both once per calibration on the main thread, and the card reuses the same `chance` table. The lookup objects are never mutated: SimMap compares them by identity (timelapse-render carry-forward), so a reloaded calibration (Retry, §4.2 "Crash") builds fresh objects and calls `setTimelineLookups` again. No handle method is called before `onready`, because the handle validates eagerly and throws before it is ready (carry-forward R18);
  2. applies the queue in order;
  3. calls `h.setTime(day)` with the current scrub day;
  4. calls `h.setBottomInset(px)` (§4.3);
  5. registers `h.onResyncNeeded`.
- **Every `timeline` message**: call `applyTimeline(render)`, or queue it, then replace the held `TimelineScore` and record `seed`, `bandRuns`, `bandRunsTotal` and `complete`. Several messages per seed are normal: band-only updates (empty `render`, T6) and new chunks bringing geometry.
- **Chunks.** `chunks` messages feed `setChunkStatus` and the chunk-error chip, as in the editor. The chip's Retry sends `retryChunks`.
- **Prefetch.** After the first `timeline`, and on every map `moveend`, send `prefetch(viewport bbox)` **at every zoom**. This differs from the editor's zoom-14 gate (`BrushController.svelte.ts:59,656-661`): ghosts must appear at the city view (OD-T2 tints below street zoom), and the first paint (score and controls) never waits on chunks. T6 ("viewport-driven at every zoom in this mode") rules this.
- **Resync** (`onResyncNeeded`): call `client.resync()` (timelapse-sim's `ScenarioClient`). fzp-mode never sends the resync `reroll` itself, so the client's one-resync-per-episode guard holds (IA-23). The client sends `reroll` with the seed of the latest accepted timeline; T6 makes this the resync path, and the same seed gives a fresh revision-0 snapshot. The answering `timeline` is handled like any other: the URL, the play state, the reroll button and the representative flag (below) do not change.
- **Representative flag** (IA-23). The page holds `representative: boolean`, the answer to "did the shown seed come from a `null` request?". It is set when a `timeline` answers a request the page made:
  - `initScenario` or `reroll` with `seed: null` (a bare `/fzp`, or "Back to the representative future") → `true`;
  - `initScenario` with a URL seed, or the "Another future" `reroll` → `false`;
  - `client.resync()` and the crash Retry's `initScenario` resend the numeric seed of the shown future. They reproduce the same future, so they leave the flag unchanged.

  T6 `timeline` carries no representative field, so the page keeps the flag per request rev. A URL seed that happens to equal the representative seed is shown without " (representative)": the page cannot know, and the label is never claimed without a `null` request.
- **Errors.**
  - An `error` answering the latest scenario rev in phase `loading` → `failed`.
  - In phase `ready` (a failed reroll), keep the shown future and show a dismissible notice: "Couldn't make another future. Try again."
  - `bad-request` with any other rev is logged only.
- **Crash** (mirroring `BrushEditor.svelte:204-240`).
  - Before `ready`: go to `failed`.
  - After `ready`: everything needed to scrub is already on the main thread, so scrubbing and the scoreboard keep working. A status chip reads "Part of the simulation stopped. Retry". Card requests resolve `null`, and the card shows "Details unavailable".
  - **Retry** runs these steps:
    1. restart the client's worker with `ScenarioClient`'s restart API;
    2. reset the chunk statuses (`BrushEditor.svelte:249-253`);
    3. reload the manifest and calibration if either failed;
    4. send **only** `initScenario` (round 2, "Client"), with the shown seed, or with the URL seed (`null` when absent) before any future has been shown. The representative flag is kept (above).

  The same seed reproduces the same future, so the map and score do not change.
- **Teardown** on unmount: stop playback, dispose the client and drop the handle.
- **Transit:** `/fzp` passes `view={{ transitStops: false, transitAccess: false }}` and mounts no View menu. The transit-access palette is blue (`src/lib/map/palette.ts`, `transit-access-*`) and would be confused with the translucent-blue ghosts (OD-T2). The viewer's `sfhousing:view` prefs are neither read nor written.

### 4.3 Layout (WCAG reflow; 375 px)

All overlays are absolutely positioned inside `#map-region`. None uses the viewport, so the footer stays visible, as the editor's W6b rule requires (`e2e/layout.spec.ts:1-3`).

| element | ≥ 768 px | < 768 px |
|---|---|---|
| scrubber bar | full width, bottom 0, one row, measured height `--fzp-scrubber-h` | full width, bottom `var(--scorebar-h)`, two rows (controls, then track) |
| score panel | `top-4 right-4 w-80`, max-height `calc(100% - 2rem - var(--fzp-scrubber-h))`, scrolls | collapsed bar `h-14` at bottom 0; sheet `max-h-[85%]` on tap (pattern of `Scoreboard.svelte:96-129`) |
| project card | `top-4 left-4 w-80`, same max-height | `left/right 16px`, `bottom: calc(var(--map-controls-br-block-size, 60px) + 8px)`, max-height 50%, scrolls |
| sources dialog | native `<dialog>` modal, `max-w-2xl`, max-height 85vh | full-width modal, max-height 85vh |

- **Map inset:** `setBottomInset(scrubberH + scorebarH)`, where `scorebarH` is 56 below 768 px and 0 above. While the mobile sheet is open the inset is the sheet height (as `BrushEditor.svelte:121-124`). This lifts MapLibre's bottom controls above the scrubber (`SimMap.svelte:1162-1166`). The scrubber therefore needs no `--map-controls-br-*` clearance. The mobile card does use `--map-controls-br-block-size`, which includes the inset, so the card clears the attribution.
- `FzpScoreboard` sets `--scorebar-h: 56px` below 768 px through its own `:root:has(.sfh-fzp-scoreboard)` rule, mirroring `Scoreboard.svelte:134-140`.
- At 375 px the page has no horizontal scroll, and every target is ≥ 24×24 px (≥ 44×44 px on coarse pointers, the repo's pattern).

### 4.4 The time scrubber (`TimeScrubber.svelte`, `playback.ts`, `time.ts`)

- **Range.** From `asOf` (the snapshot `Day`, read from `calibration.asOf`, T4, which the main thread already loads) to `horizon` = 2050-12-31 (OD-T4), Day 29,584. The initial day is `asOf`. If `calibration.asOf` differs from the month of `TimelineScore.months[0]`, that is logged as a data error and the scrubber still uses `calibration.asOf`.
- **Control:** a native `<input type="range">` with:
  - `min=asOf`, `max=horizon`, `step=1` (one day);
  - `aria-label="Date in the simulation"` and `aria-valuetext` = the readout (e.g. "March 2031").

  A native range input supplies slider semantics, touch dragging and focus visibility, and pointer dragging is continuous. The keyboard is overridden on `keydown` (`preventDefault`):

  | key | effect |
  |---|---|
  | ← / ↓ | the previous first-of-month strictly before the current day, clamped to `asOf` |
  | → / ↑ | the next first-of-month strictly after the current day, clamped to `horizon` |
  | Page Down / Page Up | 12 months back or forward from the current month start, clamped |
  | Home / End | `asOf` / `horizon` |

  Any key, drag or marker jump **pauses** playback.
- **Markers** on the track, each a button below it that jumps to its day:
  - "RHNA deadline", at the deadline `Day` of the T8 target with `id === 'rhna'` (expected 2031-01-31);
  - "2045", at the `by` day of the T8 reference whose `by` falls in 2045, else 2045-01-01 (OD-T4).

  The ends of the track are labelled with the `asOf` month ("Oct 2026") and "2050". Marker buttons have accessible names "Jump to RHNA deadline, January 2031" and "Jump to 2045".
- **Readout:** the visible text is `Simulation · March 2031`. The format is `Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })`. "Simulation" is a pill, so the date can never read as a real calendar. The readout is not a live region: it changes every frame during playback.
- **Play/Pause:** one button whose label switches between "Play" and "Pause". At `horizon` playback stops, and the button reads "Replay". Pressing Replay jumps to `asOf` and plays.
- **Speeds:** a native `<select>` labelled "Speed" (the label is visible ≥ 640 px and sr-only below). The options are "1 month/s", "1 year/s" (default) and "3 years/s". The speed changes the days advanced per second of wall time: `MONTH_DAYS`, `12 × MONTH_DAYS` and `36 × MONTH_DAYS` (T1, 30.436875 days). The reconciliation section "Page" rules that the speeds and the default belong to fzp-mode. The values are tier 4 (UI design choices, not model numbers). The reasons:
  - **1 year/s** plays the whole range (about 24 years) in about 24 s, short enough to watch to the end;
  - **1 month/s** (about 290 s) is slow enough to follow one project's bar through its stages;
  - **3 years/s** (about 8 s) shows the overall shape at a glance.
- **Autoplay:** once phase becomes `ready`, playback starts at the default speed from `asOf`, **unless** `matchMedia('(prefers-reduced-motion: reduce)')` matches. In that case the page waits on Play. Scrubbing, keys and a user-pressed Play all work under reduced motion. The Pause button satisfies SC 2.2.2.
- **Opening the sources dialog pauses.** Opening a card does not.
- **Per frame** (`requestAnimationFrame`, only while playing):

  ```
  t += min(dt, 100 ms) × daysPerSecond
  day = min(floor(t), horizon)
  ```

  When `day` changes, call `handle.setTime(day)` once and update the `day` state. The 100 ms clamp is tier 4 and stops a jump after a background tab. Everything the frame triggers is O(1) in project count:
  - the score month index is the scrubbed day's month (T8, round 2), computed arithmetically: `i = (Y(day) − Y(months[0]))·12 + (M(day) − M(months[0]))`, clamped to `[0, months.length − 1]`. `months[0]` is the 1st of `asOf`'s month, and each series value at `i` is the state at the **end** of that month. So the scoreboard always shows the end of the month the readout names:
    - at `asOf` it shows index 0 (the end of `asOf`'s month);
    - at `horizon` it shows index `months.length − 1` (December 2050);
    - the at-deadline value uses the deadline's month (January 2031, which includes the 31st);
  - the chart cursor moves to x(day);
  - an open card recomputes `CardStatus` (O(stages)). When the month index changes, it re-requests `parcelSummary(parcelId, day, projectId)`, with at most one request in flight and the latest wins (§4.8).

  While paused, every `input` event calls `setTime` directly.
- **Debug hook** (`VITE_E2E === '1'` only, like `src/lib/map/debug.ts`): `window.__sfhFzp = { phase, seed, representative, day, asOf, horizon, playing, score: TimelineScore | null }`, read-only.

### 4.5 The time-aware scoreboard (`FzpScoreboard.svelte`, `FzpScorePanel.svelte`, `score-view.ts`)

A **sibling** component, so `Scoreboard.svelte`, `ScoreboardPanel.svelte` and `view.ts` are untouched. It reuses `TargetRow.svelte` unchanged (`TargetRow.svelte:6-13`, fed `{ target, fraction: fraction[i] }`) and `formatCount`, `formatPercent` and `formatCompactCount` (`format.ts`). The panel has the same white card and black text as the editor's (`Scoreboard.svelte:91`). `role="region"` with `aria-label="Simulation scoreboard"`.

The panel's contents at month index `i`, in order:

1. **Badge:** "Simulation".
2. **Intro**, one paragraph: "One possible future for San Francisco under the Family Zoning Plan. It starts from every real project in the pipeline today and adds new ones at the rates the city's own records show. It is a simulation, not a forecast."
3. **Headline:** `formatCount(baseline.completedNet + shown[i].completedNet)` and "net new homes since {Mon D, YYYY of baseline.since}".
4. **Split**, each a labelled row:
   - "Actually completed, to {asOf date}": `baseline.completedNet`;
   - "Simulated, from today's pipeline": `completedNetPipeline`;
   - "Simulated, new projects not yet in today's pipeline": `completedNetNew`.

   The headline, this split and RHNA progress (item 6) all come from the FZP run (round 3).
5. **Band:** "In 8 of 10 simulated futures: {p10 + baseline}–{p90 + baseline}" (the band has the same basis as `shown`, T8).
   - While `bandRuns < bandRunsTotal` (T6), the band gets the suffix " (still calculating)" and `aria-busy="true"`. `complete` does not drive this label.
   - Until any band value exists, the line reads "Range: calculating…".
   - The same rule applies to the plan-effect band in item 5a.
5a. **"What the plan added"**, a sub-heading with three rows (round 3, "Plan effect"):
   - "Homes completed because of the plan": `planEffect[i].completedNetNew`, with "In 8 of 10 futures: {planEffectBand p10}–{p90}". This band has no baseline, because the plan effect is a difference;
   - "Homes approved because of the plan": `planEffect[i].entitledNew`;
   - one paragraph of plain copy: "To see what the plan itself does, each future is run twice: once with the Family Zoning Plan, and once as the same city simulated under the old zoning, with the same luck. The difference between the two is the plan's effect. Some homes would have been built anyway; they are not counted here." Values can be negative early on, and are shown with a U+2212 minus via `formatCount`.
   - **While `planEffect` is `[]`** (T8: always so in revision 0, including after every reroll and resync, until the shown twin's band-only update arrives; IA-9), both value rows read "calculating…" with `aria-busy="true"` on the sub-section, and `ScoreAt.planCompleted` and `.planEntitled` are `null`. While `planEffectBand` is `[]`, the band line reads "Range: calculating…" (the rule of item 5). The twin paragraph is always shown.
6. **Targets:** one `TargetRow` per T8 `targets` entry, in order (RHNA, then RHNA + buffer). Under each is "At the deadline ({deadline as Mon D, YYYY}): {formatPercent(fraction[d])}", where `d` is the month index of the deadline. The fractions come straight from T8, which includes the baseline.
7. **In progress:** "Homes in projects still in progress: {sum}". Then a `<dl>` with one row per stage in `STAGE_ORDER` (unknown keys appended), using the "in stage" labels of §4.9.
8. **Stopped:** "Proposed homes in projects that stopped since {asOf month}: {exitedUnits}".
9. **Chart** (§4.6).
10. **Future line:** "This future: #{seed}", plus " (representative)" when the shown seed came from a `null` request. When it is not representative there is also a button, "Back to the representative future" (§4.7).
11. **"Map key"** (`<details class="sfh-fzp-legend">`, open by default ≥ 768 px), the ghost-state legend. It renders one row per entry of timelapse-render's exported `TIMELINE_LEGEND` (T7), with the entry's `label` verbatim, drawing each swatch from the entry's tokens through their `--map-*` CSS variables. The variables are set on `.sim-map` only, and the legend is a sibling of SimMap, so it cannot inherit them (IA-3). fzp-mode therefore renders `<svelte:head>{@html '<style>' + timelineTokenCss('.sfh-fzp-legend') + '</style>'}</svelte:head>` once (T7: the function returns CSS text with no `<style>` wrapper, holding the `--map-*` property of every `tl-*` token and of every token `TIMELINE_LEGEND` names, `gen-*` included, light then dark under `prefers-color-scheme`, scoped to the selector; the CSP allows inline styles, `svelte.config.js` `style-src 'unsafe-inline'`). `/fzp` passes SimMap no `theme` prop, so SimMap and the legend both follow the system theme (`prefers-color-scheme`) and always agree; fzp-mode sets no theme of its own anywhere. After the entries it adds one line of fzp-mode's own: "Bar length: progress through the stages." The bar-colour line is not repeated: `TIMELINE_LEGEND`'s `chance` entry already reads "Bar colour: chance of finishing, low to high" (IA-3).
12. **Button:** "Where these numbers come from" (opens §4.10).
13. **Footnote:** "Data {datasetVersion} · built {date} · as of {asOf date} · [Sources](/attribution)". When T8 `phasing.masters > 0`, a second line follows (round 3 "Multi-phase", round 4 N4): "Multi-phase projects: {phasesScheduled} phases scheduled from published plans, {phasesEstimated} estimated from past projects; {unenriched.length} projects without phase data are simulated as one project each: {drawn} drawn as one footprint on a free lot, {scoreOnly} counted in the score but not drawn." Here {drawn} counts the `phasing.unenriched` entries with `drawn: true` and {scoreOnly} those with `drawn: false` (T8; DQ-3's score-only masters, which have no geometry). A clause whose count is 0 is omitted with its comma, and with `unenriched` empty the sentence ends after "estimated from past projects". When `masters` is 0 the line is omitted.

- **Mobile collapsed bar** (button, `aria-expanded`): line 1 is `{formatCompactCount(total)} net new homes · {formatPercent(rhna fraction)} of RHNA`, line 2 "Simulation".
- **Announcements:** an sr-only `aria-live="polite"` region. It speaks only when playback is paused, 1,000 ms after the day settles (the debounce of `Scoreboard.svelte:72-80`): "{March 2031}: {45,210} net new homes in this simulation, {55%} of RHNA."
- **Before the first `timeline`** the panel shows only the badge, the intro and "Loading the simulation…".

### 4.6 The chart (`ScoreChart.svelte`, `chart.ts`)

There are no chart conventions in the repo (no chart, sparkline or SVG plotting found under `src/`), so the chart is a plain inline SVG with no new dependency.

- **Size:** the full panel width, 140 px tall (tier 4).
- **x axis:** linear in `Day` from `asOf` to `horizon`, with ticks and labels at 2030, 2040 and 2050.
- **y axis:** 0 to `niceCeil(max(series, band high, references, 82,069))`, with three gridlines labelled by `formatCompactCount`. `niceCeil` rounds up to 1, 2 or 5 × 10ⁿ.
- **Marks:**

  | series | mark |
  |---|---|
  | band p10–p90 + baseline | `#1d4ed8` area at 15% opacity |
  | total (baseline + completedNet) | `#1d4ed8` (blue-700) solid 2.5 px |
  | from pipeline | `#374151` (gray-700) dashed 6 3 |
  | new projects (`completedNetNew`) | `#b45309` (amber-700) solid 2 px |
  | plan effect, completed (`planEffect.completedNetNew`) | `#6d28d9` (violet-700) solid 2 px |
  | plan-effect band (`planEffectBand` p10–p90) | violet-700 area at 15% opacity |
  | plan effect, approved (`planEffect.entitledNew`) | violet-700 dashed 2 2 |
  | RHNA (82,069) | 1 px black horizontal line, labelled "RHNA" |
  | each T8 reference | dotted horizontal line at `units`, a dot at `by`, labelled `label` (detail below) |
  | RHNA deadline and 2045 | gray dashed verticals |
  | current day | black vertical cursor |

  Each reference line runs from `max(from, asOf)` to `by`. It takes the colour of the series its `measure` names: violet for `planEffect.*`, blue for `completedNet`. Its label ends "(compare with: {series name})".

  While `planEffect` or `planEffectBand` is `[]` (T8, IA-9), that series is not drawn, its legend entry reads "{series name}: calculating…", and its table cells read "calculating…". The y-axis maximum ignores empty series. The reference lines are still drawn.
- **Contrast:** every stroke has ≥ 3:1 contrast on white (SC 1.4.11: blue-700 is 6.7:1, gray-700 10.3:1, amber-700 5.0:1, violet-700 7.1:1). Every series is also told apart by its dash pattern, plus a legend in text under the chart.
- **References are compared with the plan-effect series their `measure` names** (T8, round 3 "Plan effect"). Both published estimates are increments over the old zoning:
  - Planning's ~39k are entitlements, compared with `planEffect.entitledNew`;
  - the Controller's 14,646 and 8,504 by 2045 are completions, compared with `planEffect.completedNetNew`.

  The legend line reads: "Dotted: published estimates of what the plan adds. Compare them with the violet lines, which show this simulation's plan effect (with the plan minus the old zoning)." References are levels, not trajectories, so they are drawn horizontal. The simulated series start at `asOf`, while Planning's window starts at 2026-01-12. The dialog's reference entry says so: "Simulated counts start on {asOf date}."
- **Accessibility:**
  - The chart is a `<figure>` whose SVG has `role="img"` and an `aria-label` summary: "Net new homes in this simulation: {x} by the RHNA deadline, {y} by 2045, {z} by the end of 2050."
  - A `<details>` "Show as table" holds a `<table>` with one row per January from `asOf`'s year + 1 to 2050, plus the deadline row and the final month. Its columns are date, total, from pipeline, new projects, plan effect (completed), plan effect (approved), the 8-in-10 range, and the plan-effect 8-in-10 range.

### 4.7 Seed, URL and "Show another possible future"

- **URL:** `/fzp` means the representative future, sent as `seed: null` (T6; the design's global constraint says the median band run). `/fzp?seed=N` loads seed `N`. `N` must match `^\d{1,10}$` and be ≤ 4,294,967,295. Anything else is treated as absent, and the URL is cleaned with `replaceState`. Unknown query parameters are ignored and kept (the T9 seam).
- **Header action** (`useHeaderActions`): a button "Another future" (title "Show another possible future"), disabled until `ready` and while a reroll is in flight. On press:
  1. draw `crypto.getRandomValues(new Uint32Array(1))[0]`;
  2. send `reroll`;
  3. set `aria-busy` on the button, and announce "Making another future…".

  On the answering `timeline`, apply it, keep the **current scrub day and play state**, and call `replaceState('?seed=N', {})` from `$app/navigation`, so Back still leaves the page and no history entry is added per reroll. Any open card re-requests its parcel (§4.8).
- **"Back to the representative future":**
  - send `reroll { seed: null }` (T6);
  - on answer, remove `seed` from the URL.
- **Reproducibility is per dataset.** The footnote shows the dataset version beside "This future: #N", so a seed is never presented as permanent across dataset releases.

### 4.8 The project card (`ProjectCardPanel.svelte`, `card.ts`)

- **Picks** come from `SimMapProps.timelinePick` (T7), which `/fzp` always sets. SimMap suppresses its own tooltip over timeline parts, and parts hidden at `t` are not pickable. So SimMap's footprint-only part tooltip ("ADU · adds N units", a timelapse-render carry-forward copy question) never appears on `/fzp`. Existing buildings keep SimMap's normal tooltip and open no card.
- **Hits and misses** (T7, IA-1). A hit is `{ projectId: string; parcelId; x; y; kind }`; a miss is `{ projectId: null; kind }`, and `null` is never sent:

  | pick | effect |
  |---|---|
  | hit, `kind: 'hover'` (a fine-pointer move) | show fzp-mode's own non-interactive tooltip at `(x, y)`; the card is unaffected |
  | hit, `kind: 'tap'` (a touch tap or a mouse/pen click) | open the card on that project (replacing any open card) and hide the tooltip |
  | miss, `kind: 'hover'` (sent once when the pointer leaves the timeline parts) | hide the tooltip; the card stays open |
  | miss, `kind: 'tap'` (a tap or click on no timeline part, including an existing building) | close the card and hide the tooltip |

  The tooltip uses the same `role="tooltip"` and `sim-map-panel` styling as `SimMap.svelte:1032-1043`, and its text is `[label, "{Real|Simulated} project · {in-stage label} · {units} homes"]`. Opening the card on tap only is a **deliberate narrowing** of the design's "card on hover or tap" (round 2, "Picking"): hover gives only the tooltip, because the card holds links and must be interactive.
- **Requests.** Both surfaces call `client.parcelSummary(parcelId, day, projectId)` with the picked `projectId` (T6) and read `summary.project`. Requests are latest-wins, with at most one in flight per surface. The card is an interactive panel, so its links work, and it closes on Close, on Escape, and on a tap miss (above).
- **Summary states** (round 2; IA-24). Four cases, with this copy in the tooltip and the card:

  | state | copy |
  |---|---|
  | the request is in flight | "Loading project details…" |
  | answered with `summary: null`: the parcel's chunk record is not loaded yet (timelapse-sim §4.9) | "Project details are still loading for this area." While a surface shows this, it re-requests on every `chunks` message (latest-wins, one in flight), so it resolves once the chunk arrives |
  | answered with a summary that has no `project` | "No project on this parcel at this date." |
  | the worker crashed, until Retry | "Details unavailable" |

- **Existing-building tooltip** (IA-24). `/fzp` passes `SimMapProps.requestParcelSummary = (parcelId) => client.parcelSummary(parcelId, day).then((s) => s && { parcelId: s.parcelId, eligible: s.eligible, existingUnits: s.existingUnits, generated: null })`, with `day` the scrubbed day at the moment of the request and no `projectId`. `generated` is forced to `null` because that tooltip describes the existing building; anything about a project belongs to the project card. `existingUnits` is the T11 assessor value (post-rule, so a capacity-replaced value is what the roll implies, not a raw outlier). SimMap does not re-request as the day changes, and the existing-building facts do not depend on the day. A `null` summary keeps SimMap's own loading behaviour.
- **While the card is open,** it re-requests when the month index changes. Per T6 the card shows only stages and revisions on or before `day`, and `end` only once it has passed. The card therefore never shows future stages, which the reconciliation ruled under "Open questions answered".
- **Card content** (all from `ProjectCard` plus the current `day`; `card.ts` is pure):
  - **Heading**, the `label`, and a badge: "Real project" for `origin 'pipeline'` or "Simulated project". Simulated labels are always "Block B, Lot L" (T6).
  - **Phase line** (round 3, "Multi-phase"): when `phase` is non-null it reads "Phase {phase.index} of {phase.of}, {label}" (e.g. "Phase 3 of 12, Candlestick Point"). The master is never drawn, so it is never picked. `label` is the master's T3 label.
  - **Massing note:**
    - `massing === 'approximate'`: "Building shape approximate";
    - `multiPhase && phase === null` (an unenriched row, the round-3 last resort): "Multi-phase project without published or estimated phases; drawn as one footprint on the site's lots that no other project holds". A score-only master (DQ-3) has no geometry, so it is never picked and never gets a card;
    - any other `massing === 'none'`: "Building not drawn; footprint only".
  - **Simulated projects** add: "Not a real proposal. In this simulated future a project starts on this parcel. The parcel was picked by chance, weighted by how often parcels like it have been redeveloped. It says nothing about the owner's plans."
  - **Pathway**, using the §4.9 labels.
  - **Status at `day`**:
    - `inStage`: "{in-stage label}, {n} months so far".
    - `complete`: "Completed {date}".
    - `exited`: "Stopped during {in-stage label of end.stage} ({reason label}), {date}".
    - The current stage is the last entry in `stages` with `day ≤ t`, unless `end` is non-null and `end.day ≤ t`.
  - **Size at `day`**: the last `revisions` entry with `day ≤ t`. It reads "{units} homes · {stories} · replaces {card.existingUnits} existing homes (assessor) (net +{units − existingUnits})". `existingUnits` is `ProjectCard.existingUnits` as T6 defines it: for a pipeline project, the project's own T3 `existingUnits`, which counts each parcel's assessor units once across in-flight projects (`pr.parcels.shared-existing`), so it can be 0 on a shared parcel; for a simulated project, the sum over its T11 parcels. The card shows the value as given and never re-sums parcels, so it agrees with the score. The `{stories}` part follows `storiesTier` (T6, IA-14):

    | case | text |
    |---|---|
    | `stories` null | omitted |
    | a simulated project (`origin 'simulated'`; the whole card is labelled simulated) | "{N} stories" |
    | pipeline, `storiesTier` 0 (recorded field) | "{N} stories" |
    | pipeline, `storiesTier` 3 (parsed from the description) | "about {N} stories, from the project description" (round 2, "Card") |
    | pipeline, `storiesTier` 4 (from the simulator's massing, or a later revision's proportional scaling; T6) | "about {N} stories (simulated)" |
    | pipeline, `stories` non-null with `storiesTier` null (T6 says this cannot happen) | treated as 4, so a count of unknown origin is never shown as a record |

    Each later revision is listed as "Resized: {a} → {b} homes, {date}", with ", simulated" appended when its day is after `asOf`.
  - **Chance of finishing** (`inStage` only): `chance[pathway][stage][min(monthsIn(entered, t), 240)]`, using the main thread's `chanceTable(calibration)` (241 months long, T12) and `monthsIn` (T1). These are the same functions and table the renderer receives, so the card and the bar colour agree. The value is shown as a whole percent, rounded, or as "under 1%" or "over 99%": "Chance of finishing from here: 62%". Under it, a `<details>` "How is this estimated?" lists, for every `Transition` from the current stage to `complete` on this pathway:
    - its tier and `provenance.label`;
    - its tail provenance, `calibration.transitions[pathway][stage].tailProvenance` (T4; tier 2: extrapolation beyond the observed months, round 2 "Provenance"; IA-20), since `chanceTable` integrates the tail.

    For a **Local Program project** the list starts with the `streamlinedForLocalProgram` provenance (tier 2: the Local Program uses the streamlined tables as a proxy). A project counts as Local Program when `ProjectCard.localProgram` is true (T6, round 3). Each entry links to the matching dialog section. If any listed transition has tier ≥ 3, the line also says "partly based on research estimates, not San Francisco records". The copy says the number is the share of similar projects that finish, not this project's fate.
  - **Timeline**: one row per `stages` entry (iterated from data, not from `STAGE_ORDER`), then `end` if non-null. Each row is "{entered label} · {date} · Recorded" when `actual`, else "Simulated". Actual dates are `Mon D, YYYY`; simulated dates are `Mon YYYY` (the day within the month is a uniform draw, T4). All dates are formatted in UTC.
    - **Phase cards** (`phase` non-null, round 4 N10): the stage rows before `permitFiled` belong to the master plan. They are labelled as master context, with the stage label prefixed "Master plan": for example "Master plan approved · 2010 · Recorded" for `entitled` and "Master plan application filed" for `filed`. A sub-heading "This phase" precedes the `permitFiled` row and the rows after it.
    - **Phase start** (T5 `phase.start`, set by timelapse-sim; IA-2). When the phase's `permitFiled` row is not `actual`, it reads "Building permit filed · {Mon YYYY} · Simulated (start estimated)" if `card.phase.start === 'estimated'` (the `phaseGap` stagger), and "Building permit filed · {Mon YYYY} · Simulated (published plan date)" if it is `'scheduled'`. The card reads only `phase.start`, never `sources`: timelapse-sim also uses the stagger for an overdue plan date that has a schedule source. An `actual` row reads "Recorded" as any other.
  - **Data notes** (`ProjectCard.quality`, T6; the "Quality on records" ruling). When `quality` is non-empty (pipeline projects only; simulated cards have `[]`), the card shows a sub-heading "About this record's data" before Sources, with one list item per entry, in the given order: "{label} ({tier label})", where the tier shown is `valueTier` when it is non-null, else `tier` (T6: "A display shows valueTier when non-null, else tier"), using the §4.9 tier labels (e.g. "… (Assumption, not data)"; `pr.pipeline.status-date-linked`, rule tier 2 and value tier 0, reads "… (San Francisco project records)"). Under the list: "The data checks changed or estimated some values on this card, so not every value is the record's own." `quality` does not say which field a rule touched, so on such a card every record-derived value is marked: each "Recorded" timeline row reads "Recorded*", "(assessor)" reads "(assessor*)", and the sub-heading reads "* About this record's data". With `quality` empty, nothing is marked and the sub-heading is absent. This keeps a value a rule wrote from reading as a record (global "Data quality").
  - **Sources**: one link per `sources` entry: "{dataset name} {id}: DataSF record (JSON)". The URL is `https://data.sf.gov/resource/{dataset}.json?{field}={encodeURIComponent(id)}`. `field` is `sources[].key` when present (T3/T6, round 2 "DataSF links"). Otherwise it is the dataset's record-id field from this table, with keys verified live on 2026-10-16:

    | dataset | key | name |
    |---|---|---|
    | `i98e-djp9` | `permit_number` | Building permit |
    | `qvu5-m3a2` | `record_id` | Planning project |
    | `y673-d69b` | `record_id` | Planning record |
    | `d4jk-jw33` | `b1_alt_id` | Planning review |
    | `j67f-aayr` | `building_permit_application` | Completion certificate |
    | `xdht-4php` | `bpa` | Housing production record |
    | `6jgi-cpb4` | `bpa_no` (project-records sets `key: 'case_no'` for PRJ/PRX ids) | Development pipeline |

    Any other dataset links to `https://data.sf.gov/d/{dataset}`, with the id as text.
- **Reroll and crash.** On reroll the card re-requests its parcel. On a crash it shows "Details unavailable" until Retry.
- **Keyboard gap.** Map picking is pointer-only, a known gap shared with the editor's tooltips (`docs/dev/map-interfaces.md`, "Known gap"). The reconciliation section ("Page") records it as a known a11y gap, and it is documented in `docs/dev/fzp-mode.md`.

### 4.9 Labels (`labels.ts`; one table each, so new stages render)

| stage | entered (timeline row) | in stage (status, score) |
|---|---|---|
| `preApplication` | Pre-application meeting requested | Pre-application |
| `filed` | Planning application filed | In Planning review |
| `entitled` | Planning approval | Approved, building permit not yet filed |
| `permitFiled` | Building permit filed | Building permit review |
| `permitIssued` | Building permit issued | Permit issued, not started |
| `construction` | Construction started | Under construction |
| `complete` | Completed | Completed |

- **Pathways:**
  - `discretionary`: "Discretionary review (Planning Commission or similar)";
  - `streamlined`: "Streamlined approval (state law or the plan's Local Program)";
  - `permitOnly`: "Building permit only".
- **Exit reasons:** withdrawn, disapproved, cancelled, and expired, shown as "permit expired".
- **Tiers:**

  | tier | label |
  |---|---|
  | 0 | San Francisco project records |
  | 1 | Official published totals |
  | 2 | Inferred from San Francisco records |
  | 3 | Research or literature, not SF records |
  | 4 | Assumption, not data |

### 4.10 "Where these numbers come from" (`SourcesDialog.svelte`, `provenance.ts`)

**Decision: an in-page modal dialog, not a separate page.** The main thread already holds `calibration.json` (for T12) and the T8 provenance (baseline, references, targets), which live nowhere else on the client. A dialog keeps the scrub position. It is a native `<dialog>` opened with `showModal()`, so it is inert behind, traps focus, closes on Escape, and returns focus to its opener. It has an `<h2>` "Where these numbers come from" and one `<h3>` per section. Each section has an `id` (e.g. `src-transition-discretionary-entitled`) so the card can open it scrolled to that section.

**Sections, in order:**

1. **"How to read this":** the tier table (§4.9 labels) and one sentence: "Every number the simulation uses comes from the best evidence available, and says which kind it is."
2. **"Actual completions":** T8 `baseline` (or T3 `rhnaCompletedNet`, the same provenance).
3. **"How projects move through the stages":** one entry per `transitions[pathway][stage]` present. Each entry shows:
   - the share advanced and the share stopped, by reason, within 12, 24 and 60 months. These are T12's `cumulativeIncidence(transition, k)` for k = 12, 24, 60, which includes the tail beyond `months` (IA-13). `provenance.ts` only formats them as whole percents; it does not re-implement the cumulative tables or the tail extension (T12: nothing re-implements them).
   - a second provenance line for the tail, `transitions[pathway][stage].tailProvenance` (T4; tier 2, extrapolation beyond the observed months; IA-20).
   - for the permit-side stages (`permitFiled`, `permitIssued`, `construction`), a fixed sentence after the window line: "Building-permit stages use records from 2007 on, the first year the assessor's roll can say how many homes a site had before the project (DQ-1)." The window itself is always read from `provenance.window`, never written into the copy; a test checks that the fixture's permit-side windows start on 2007-01-01, so the sentence and the data agree. No copy anywhere in fzp-mode names 1989 or 2000 as a transition window.

   After the `streamlined` entries, a separate entry shows `streamlinedForLocalProgram`: "Local Program projects use the streamlined tables", tier 2 (round 2, "Provenance").
4. **"Where new projects start":** `initiation`. Its terms are shown as a table: feature, bin, coefficient.
5. **"How big new projects are":** `size`, as a table: envelope band, fill level, share.
6. **"How projects change size":** `revision`. For each stage: the chance of a resize, the share that shrink and the share that grow.
7. **"Which approval path":** `pathwayForNew` and `ppaShare`, as percentages. Before them, a fixed sentence: "New projects on Local Program parcels always take the streamlined path. That is a rule (administrative approval with a 180-day clock), tier 1. The shares below apply to other parcels." This follows the reconciliation, "New-project pathway and PPA".
8. **"Targets and published estimates":** each T8 target `source` and each `references[].provenance`.
   - Each reference names the series it is compared with.
   - It adds the twin copy of §4.5 item 5a: the plan effect is this simulation minus the same city under the old zoning, with the same seed.
   - It says "Simulated counts start on {asOf date}."
   - It states the twins' pipeline-resize difference (round 4 N3): "Under the old zoning a real project's resize is capped by the old height limit, so its size can differ between the two runs. That difference is a real effect of the plan, but it appears only in 'from today's pipeline', not in 'what the plan added', so that the published estimates compare like with like."
9. **"Multi-phase projects"** (round 3; bound to T8 `phasing` per round 4 N4; shown only when `phasing.masters > 0`):
   - **Counts:** {masters} multi-phase projects, of which {enrichedMasters} have a published Development Agreement phasing plan (tier 1, `pipeline/enrichment/multiphase.json`). {phasesScheduled} phases are scheduled from those plans, and {phasesEstimated} are estimated from past projects (tier 2).
   - **How estimated phases are built:**
     - phase size: the median completed building size;
     - start gaps: `phaseGap`;
     - at most one phase per parcel; extra units are spread over the existing phases (N8).

     `phaseGap` has its own provenance entry when present in `calibration.json`. Its window comes from its own provenance (records since 1989; DQ-1 leaves it decoupled from the transition windows), and the entry adds: "This gap is measured on building permits alone, so its records start earlier than the stage tables'."
   - **First-phase delay proxy** (round 4 N10): "Where no published schedule gives a start date, the first phase starts after the master plan's approval by a gap drawn from `phaseGap`. That is the typical gap between successive phases of past projects, used here as a stand-in for the wait before the first phase (tier 2, proxy)."
   - **Unenriched projects:** `phasing.unenriched`, each shown by `label`, falling back to `projectId`, with its `units`, in T8's order, split by `drawn` (T8) into two lists. The copy above them: "These are simulated as one project each. Where the site has lots that no other project holds, the project is drawn as one footprint on them. Where another project in the pipeline already holds every lot (in every known case, one of the same development's own phases), it is counted in the score but not drawn." (DQ-3) The first list, "Drawn as one footprint ({n})", holds the entries with `drawn: true`; the second, "Counted but not drawn ({n})", those with `drawn: false`. An empty list is omitted with its heading.

10. **"How the records were checked"** (the data-quality disclosure; global "Data quality", the "Quality on records" ruling). fzp-mode shows only what the design gives the client: T3 `qualityRules` and each project's `quality`, both in `projects.json`.
    - **Loading.** The main thread does not otherwise read `projects.json`. On the first opening of the dialog, `provenance.ts` fetches `manifest.scenarios.fzp.projects` (the worker has already fetched the same immutable URL, so it is normally an HTTP-cache hit) and validates it with T3's shared `parseProjectsFile(json, { onInvalid })` (imported dynamically, so it is not in the page's first bundle), where `onInvalid` drops the invalid project silently (the worker already reported it). The result is held for the page's lifetime. While it loads the section reads "Loading…"; if the fetch fails or a file-level check throws, it reads "The list of data checks couldn't be loaded." and the rest of the dialog is unaffected.
    - **Copy:** "The city's records are checked for missing and impossible values before the simulation uses them. Every rule that changes or estimates a value is listed in each data build with how often it fired. The rules below changed a value of at least one project in today's pipeline; that project's card says so."
    - **Table:** one row per `qualityRules` entry, in file order (sorted by id): the rule's `label`, its tier badge (§4.9 labels) for `valueTier` when non-null, else `tier` (T3 `qualityRules`, the T6 display rule), and "{n} projects", where n counts the parsed projects whose `quality` includes the id. A rule whose shown tier is ≥ 3 gets the tier ≥ 3 note below. When `qualityRules` is empty the table is replaced by "No project's values were changed by the data checks."
    - **Parcel and calibration checks.** One fixed sentence: "Checks on the assessor's roll and on the stage tables follow the same rules; a value they replace is marked as estimated in the data and is never shown as a record." The client receives no per-rule list for those (T11 carries only the `imputed` mask, T4 only provenance), so none is shown.

**Every entry shows:**

- a tier badge;
- `provenance.label`;
- `method`;
- `n` ("based on N records") when present;
- `window` ("records from {from} to {to}") when present;
- each `sources` link.

An entry with tier ≥ 3 also gets a visible note: "Not from San Francisco records."

**No link to stage-calibration's `calibration-report.md`** (reconciliation, "Page"). It is a pipeline build artifact and is not uploaded. The dialog reads `calibration.json`.

### 4.11 Shell

- `isFullHeightRoute` returns true for `'/fzp'` as well (`src/lib/shell/layout.ts:3`).
- **SiteHeader** (`SiteHeader.svelte:8-11`) gains a `<nav aria-label="Modes">` after the brand link.
  - At ≥ 640 px it holds two links, **"Paint"** (`/`) and **"Timelapse"** (`/fzp`). The current one carries `aria-current="page"` and a visible underline: "Paint" on `/` only, "Timelapse" on `/fzp` only.
  - Below 640 px only the link to the other mode shows: "Paint" on `/fzp`, and "Timelapse" everywhere else.
  - To fit `/`'s three header actions at 375 px, the brand's visible text below 640 px is "SF Housing", with " Simulator" in `hidden sm:inline`.
- The wording uses the app's own verb ("Paint a height on the map", `ScoreboardPanel.svelte:66`) and the mode's own name. Both are short enough for the header. This is the only visible change on `/` and `/p/:id`.

### 4.12 Attribution

- **`/attribution`.** `ManifestSourcesSchema` (`src/lib/data/manifest.ts:88-92`) also picks `scenarios`, which T11 adds to `ManifestBaseSchema`. When `manifest.scenarios?.fzp` is present, the "Licences and notices" list (`src/routes/attribution/+page.svelte:52-80`) gains this item: "Housing project records (building permits, Planning applications, approvals and completions, the development pipeline), the assessor's secured roll and the Family Zoning Plan height districts from DataSF, under PDDL, CC0 or public domain. The simulation's comparison estimates are cited from SF Planning and the SF Controller's Office." The sources table already lists every manifest source automatically.
- **On-map attribution.** The visible text stays "… · DataSF · …" (`src/lib/map/attribution.ts:32-41`), since all new data is DataSF. The link `title` names the distinct licences of the manifest's `datasf-*` sources:
  - the order is PDDL, public domain, CC0, joined with " / ";
  - so it reads "DataSF under PDDL / public domain" for every existing dataset (unchanged), and gains " / CC0" only when a CC0 source is present.
- **SOFTWARE** (`src/lib/attribution.ts:1-17`): fzp-mode adds no runtime dependency. timelapse-render credits `@luma.gl/engine` (reconciliation, "Rendering"). Any dependency fzp-mode adds during implementation gets an entry.

### 4.13 UI constants introduced (all tier 4, design choices; none feeds the simulation)

| constant | value |
|---|---|
| playback speeds | 1 month/s, **1 year/s**, 3 years/s |
| frame clamp | 100 ms |
| chart height | 140 px |
| announcement debounce | 1,000 ms (reused from `Scoreboard.svelte:75-78`) |

Real-world values are read from data, not hard-coded:

| value | source |
|---|---|
| RHNA 82,069 | `targets.ts:11-19`, tier 1 |
| RHNA deadline | T8 target |
| reference estimates | T8 |
| horizon 2050-12-31 and the 2045 marker | partner ruling OD-T4 |

## 5. Seams

- **T9 policy levers.** All scenario requests go through one function, `startScenario({ seed })`, so a future `levers` field is one parameter.
  - **Lookups seam** (round 2): today the page builds `chanceTable` and `typicalMonths` from the base `calibration.json` and passes them to `setTimelineLookups`. Under future levers the calibration is transformed in the worker, so the worker will post the lookups and the page will use the posted ones for both the map and the card. The single call site in `onready` is the place to switch. The URL parser keeps unknown parameters. The scoreboard renders any number of `references` and `targets`. Nothing else is added.
- **Addenda sub-stages.** Stage labels are one table (§4.9). The card iterates `card.stages` and the scoreboard iterates `inProgress` keys (`STAGE_ORDER` first, unknown keys appended), so new stages render without code changes. A stage missing from the label table falls back to its id.
- **DA phasing.** Nothing: phased projects arrive as ordinary `ProjectCard`s.
- **Renderings.** Nothing: the card has no image slot.
- **calibration-report.md.** The dialog's sections have stable `id`s, so a later link to the report can deep-link to them.

## 6. Testing

**Fixtures:**

- `src/lib/fzp/fixtures/timeline-score.ts`: a hand-made `TimelineScore` derived from the T8 rule, with `asOf` = 2026-10-16:
  - `months[0]` = 2026-10-01, ending at `months[290]` = 2050-12-01 (291 entries);
  - each value is the end-of-month state, so an event dated 2026-10-20 counts at index 0 and one dated 2026-11-01 at index 1;
  - a partial band with `bandRuns` 40 of `bandRunsTotal` 101;
  - `planEffect` and `planEffectBand` series, including negative early values;
  - `phasing` with `masters: 2`, `enrichedMasters: 1`, `phasesScheduled: 5`, `phasesEstimated: 3` and two `unenriched` entries: one `drawn: true` with a null label and one score-only `drawn: false`. A second variant has `masters: 0`;
  - two references, with `measure` set to `planEffect.entitledNew` and `planEffect.completedNetNew`;
  - a revision-0 variant with `planEffect: []` and `planEffectBand: []` (T8, IA-9);
- `src/lib/fzp/fixtures/cards.ts`: `ProjectCard`s that are:
  - real-actual;
  - simulated (labelled "Block B, Lot L"), including one with `localProgram: true`;
  - exited;
  - revised;
  - `massing: 'approximate'`;
  - a phase (`phase: { index: 3, of: 12, start: 'estimated' }`, label "Candlestick Point"), and a second phase with `start: 'scheduled'` and a non-actual `permitFiled`;
  - an unenriched `multiPhase` row with `phase: null`;
  - with null `stories`;
  - pipeline cards with `storiesTier` 0, 3 and 4, and one with non-null `stories` and `storiesTier: null` (IA-14);
  - a pipeline card with three `quality` entries (tier 2 with `valueTier` 0, as `pr.pipeline.status-date-linked`; tier 2 with `valueTier` null; tier 4; labels taken from the fixture `qualityRules`) and `existingUnits: 0` on a shared parcel, and a pipeline card with `quality: []`;
- `src/lib/fzp/fixtures/projects.ts`: a small `projects.json` body that passes `parseProjectsFile`, with three `qualityRules` (one tier 4, one tier 2 with `valueTier` 0), projects carrying them (one rule on two projects), one project that fails per-project validation, and a variant with `qualityRules: []`;
- the fixture calibration: `e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json`, read from disk in server tests through `parseCalibration`. A copy with one provenance set to tier 3 covers the tier-3 notes;
- `FakeScenarioWorker` (`src/lib/fzp/test/fake-worker.ts`): a fake `WorkerLike` behind the real `ScenarioClient`.

**Vitest server project** (pure TS):

- **`time.spec.ts`:**
  - Day ↔ UTC date;
  - next and previous first-of-month (from the 1st, the 31st and `asOf`);
  - ±12 months; clamps at `asOf` and `horizon`;
  - the month index of any day is its own month (`asOf` → 0, 2026-10-31 → 0, 2026-11-01 → 1, `horizon` → 290), clamped before `months[0]` and after the end;
  - Day 2050-12-31 = 29,584.
- **`playback.spec.ts`:** advancing by dt × speed; the 100 ms clamp; stopping at horizon; Replay restarts; property test (fast-check): the day is monotonic and within range.
- **`format.spec.ts`:** readout "March 2031"; actual and simulated date formats; UTC at midnight boundaries; percent rounding including "under 1%" and "over 99%".
- **`score-view.spec.ts`:**
  - `ScoreAt` from the fixture: total = baseline + completedNet; the plan-effect values and band (no baseline offset);
  - band offset by the baseline, and `null` when absent;
  - `planCompleted`, `planEntitled` and `planBand` are `null` on the `planEffect: []` variant, while the other fields are unchanged (IA-9);
  - deadline fraction; stage order with an unknown key appended.
- **`chart.spec.ts`:** `niceCeil`; the x and y scales; the band path closes; references start at `max(from, asOf)`, end at `by`, and are coloured by `measure`; table rows (Januaries, the deadline and the final month).
- **`card.spec.ts`:**
  - `CardStatus` for each fixture at days inside, at and after each stage, with `end: null`;
  - the size and revision at a day;
  - chance from `chanceTable(fixture calibration)` indexed by `monthsIn`, clamped at month 240;
  - the massing and multi-phase notes;
  - the stories text for every row of the §4.8 table, including tier 4 → "about N stories (simulated)" (one card from the massing, one from a scaled later revision) and the null-tier case treated as 4 (IA-14);
  - the phase `permitFiled` suffix from `phase.start` ("start estimated" / "published plan date"), with `sources` ignored (IA-2);
  - data notes: the label and tier text in order, the tier from `valueTier` when non-null (the `valueTier` 0 entry reads "San Francisco project records", not "Inferred from San Francisco records") and from `tier` otherwise, the "Recorded*" and "(assessor*)" marks on a card with `quality`, and no marks or sub-heading with `quality: []`;
  - `existingUnits` printed as given (0 on the shared-parcel card), never re-summed;
  - the provenance transition list, with each tail entry read from `transitions[p][s].tailProvenance` (IA-20);
  - the tier ≥ 3 note;
  - source URLs: `key` wins when present (e.g. `6jgi-cpb4` with `key: 'case_no'`); otherwise every dataset in the key table, plus the fallback.
- **`provenance.spec.ts`:**
  - the shares at 12, 24 and 60 months equal T12's `cumulativeIncidence(t, k)` for every fixture transition, formatted as whole percents (IA-13). The hand-computed known answers for `cumulativeIncidence` itself belong to stage-calibration's tests, not here;
  - an entry for every calibration parameter present in the fixture;
  - every permit-side transition in the fixture calibration has `provenance.window[0]` = 2007-01-01, and its entry carries the DQ-1 sentence; the `phaseGap` entry shows its own window and the decoupling sentence;
  - section 10 from the projects fixture: one row per `qualityRules` entry in id order, the per-rule project counts (the shared rule counts 2), the tier badge from `valueTier` when non-null and from `tier` otherwise, the invalid project dropped through `onInvalid` without throwing, and the empty-rules copy on the variant.
- **`seed.spec.ts`:** valid, out-of-range and junk seeds; unknown parameters kept.
- **Edits to existing specs:**
  - `src/lib/shell/layout.spec.ts`: `/fzp` → true;
  - `src/lib/map/attribution.spec.ts`: the title is unchanged for fixture-0's sources and gains " / CC0" with a CC0 `datasf-*` source.

**Vitest client project** (browser):

- **`TimeScrubber.svelte.spec.ts`:**
  - the ARIA attributes and valuetext;
  - every key in the §4.4 table, each producing the right `setTime` day and pausing playback;
  - marker jumps;
  - Play, Pause and Replay;
  - speed change;
  - autoplay on, and autoplay off under a stubbed reduced-motion `matchMedia`;
  - `setTime` called at most once per frame.
- **`FzpScoreboard.svelte.spec.ts`:**
  - the values at a month;
  - "still calculating" and `aria-busy` on both bands while `bandRuns < bandRunsTotal`, even when `complete` is true; neither shows at `bandRuns = bandRunsTotal`, even when `complete` is false;
  - the "What the plan added" rows and the twin copy;
  - on the `planEffect: []` variant, both plan rows read "calculating…" with `aria-busy`, and the plan band reads "Range: calculating…" (IA-9);
  - the legend: one row per `TIMELINE_LEGEND` entry with its label verbatim; exactly one "Bar colour" line (the entry's own) and the "Bar length" line; `timelineTokenCss('.sfh-fzp-legend')` is in the document head, and every token an entry names resolves to a non-empty computed `--map-*` value on its swatch under both an emulated light and an emulated dark `prefers-color-scheme`, and SimMap receives no `theme` prop (IA-3);
  - the multi-phase footnote: its counts from `phasing`, and omitted when `masters` is 0;
  - the representative label;
  - the live region silent while playing and speaking 1 s after a pause;
  - the mobile bar and sheet, with focus moving and returning;
  - `--scorebar-h`.
- **`ScoreChart.svelte.spec.ts`:** the `role="img"` label; the table opens; the cursor moves with `day`; on the `planEffect: []` variant the plan-effect paths are absent, their legend entries and table cells read "calculating…", and the references are still drawn.
- **`ProjectCardPanel.svelte.spec.ts`:** each status; the simulated-parcel disclaimer; the massing note; `existingUnits` from the card; the tier-3 and tier-4 stories wording; the four summary states ("Loading project details…", "Project details are still loading for this area." with a re-request on the next `chunks` message, "No project on this parcel at this date.", "Details unavailable"; IA-24); links built from `key` when present, else from the table; the tail and Local Program provenance entries; the provenance disclosure; the data notes sub-heading and marks; the phase-start suffixes; a re-request on a month change with one in flight; Escape closes it.
  - A phase card's "Phase 3 of 12" line, its master-context rows before `permitFiled` ("Master plan approved · … · Recorded") and its "This phase" sub-heading.
- **`SourcesDialog.svelte.spec.ts`:** opens modal; the focus trap and Escape; the section deep link; every fixture parameter has a tier badge and label.
  - The N3 pipeline-resize paragraph in section 8.
  - Section 9 bound to `phasing` (counts, the unenriched entries split into the "Drawn as one footprint" and "Counted but not drawn" lists by `drawn`, with the `projectId` fallback and the DQ-3 copy, and the first-phase delay proxy text), and absent when `masters` is 0.
  - Section 3's tail lines come from each transition's `tailProvenance`; the DQ-1 sentence is on the permit-side entries only.
  - Section 10: "Loading…" before the projects fetch resolves, then the rule table; the failure copy when the fetch rejects, with the other sections intact; the fetch happens once, on first open, and never before the dialog opens.
- **`FzpMode.svelte.spec.ts`** (fake worker, `SimMapStub` as `src/lib/brush/test/`):
  - loading → `ready` message → still loading → first `timeline` → ready;
  - `setTimelineLookups` called before the queued `applyTimeline`s;
  - an error before ready (including `scenario-missing` with its copy) → failed → Retry re-sends `initScenario` with the same seed;
  - "Back to the representative future" sends `reroll { seed: null }`;
  - a `hover` hit shows the tooltip and never opens the card; a `tap` hit opens the card; both requests carry the picked `projectId`;
  - misses (IA-1): `{ projectId: null, kind: 'hover' }` hides the tooltip and leaves an open card open; `{ projectId: null, kind: 'tap' }` closes the card;
  - `requestParcelSummary(parcelId)` sends `parcelSummary` with the current scrubbed day and no `projectId`, and resolves with `generated: null` (IA-24);
  - a crash after ready → chip, scrubbing still works, and Retry sends only `initScenario` (no `init`), with the shown seed;
  - reroll keeps the day, then a stale timeline is ignored;
  - `onResyncNeeded` calls `client.resync()` and the page sends no `reroll` of its own; two gaps in one episode send one `reroll` (IA-23);
  - the representative flag: `/fzp` → " (representative)"; it survives a resync and a crash Retry (both resend the numeric seed); "Another future" clears it; "Back to the representative future" sets it; `?seed=N` never shows it;
  - `TimelineUpdate`s queued before the handle are flushed in order and `revision 0` clears the queue;
  - prefetch on `moveend`;
  - `no-scenario` never spawns a worker.
- **`SiteHeader.svelte.spec.ts`:** the mode nav at both widths, `aria-current`, and the shortened brand.

**Playwright e2e** (`e2e/fzp.spec.ts`; projects `chromium` and `mobile`; fixture-0 with the scenario files the reconciliation specifies under "Fixture-0 contents": one in-flight project per stage, one PPA, one multi-phase row, and a high initiation hazard):

- **Load and controls:** `/fzp` reaches `ready` (`__sfhFzp.phase`). The readout shows the `asOf` month. Keyboard Home shows the headline `baseline + score.shown[0].completedNet`, the end of `asOf`'s month. Keyboard End → "December 2050", and the headline equals `baseline + score.shown[score.months.length − 1].completedNet` from the hook, the index of the horizon's month.
- **Reduced motion:** with `emulateMedia({ reducedMotion: 'reduce' })` the day stays at `asOf` for 2 s. Without it, the day advances.
- **Reroll:** puts `?seed=N` in the URL with the day unchanged. Reloading `/fzp?seed=N` gives identical `score.shown`. `/fzp` twice gives the same seed (determinism).
- **Card:** jump to the fixture's pipeline project (`jumpAndIdle` + `projectToPage`, `e2e/helpers/sharing.ts:53-72`). Click or tap opens a card with "Real project" and a DataSF link whose `href` matches the key table. A phase sub-project's card reads "Phase {n} of {m}, {label}" once that phase has filed.
- **Sources dialog:** lists one entry per parameter in fixture-0's `calibration.json`, and section 10 lists one row per `qualityRules` entry in fixture-0's `projects.json` (project-records' fixture cases supply them; the row count is read from the file in the test, not hard-coded).
- **Card data notes:** a fixture-0 pipeline project whose `quality` is non-empty shows "About this record's data" with its labels; the project is chosen in the test by reading `projects.json`, golden computed at implementation.
- **Tap miss:** with a card open, a click on empty map closes it; moving the pointer off the part does not.
- **No scenario:** `page.route` strips `scenarios` from `manifest.json`, and the message and editor link show.
- **Header:** the "Timelapse" link on `/` navigates to `/fzp`, and "Paint" returns.
- **`/attribution`:** shows the scenario notice for fixture-0.
- **Axe gate:**
  - `e2e/pages-a11y.spec.ts` adds `/fzp` (no horizontal overflow, footer link visible);
  - `e2e/fzp.spec.ts` runs `expectNoA11yViolations` with the card open, the dialog open (`structure: true` scoped to the dialog) and the mobile sheet open;
  - a W6b-style check that the footer links are unobscured at 375 px on `/fzp`.
- **Editor unchanged:** every existing e2e and unit test passes unmodified, except `layout.spec.ts`, `SiteHeader.svelte.spec.ts` and `attribution.spec.ts`, which gain cases without changing the existing ones.

## 7. Acceptance criteria

1. `/fzp` renders a full-height map page with an sr-only h1, a skip link, one `<main>` and the footer. At 375 px it has no horizontal scroll, and every target is ≥ 24×24 px.
2. With fixture-0, the page reaches `ready` without loading every parcel chunk before the score shows. On a dataset without `scenarios` it shows the no-scenario message and spawns no worker.
3. Scrubbing:
   - the slider has an accessible name and valuetext;
   - ←/→ step one calendar month, Page Up/Down one year, and Home/End go to `asOf`/2050-12-31;
   - every change calls `setTime` once with the new `Day`.
4. Playback defaults to 1 year/s and offers 1 month/s and 3 years/s. Autoplay happens only without reduced motion, and any scrub input pauses it.
5. The scoreboard shows, for the scrubbed month:
   - actual-to-date and the two simulated completion lines, each separately, all from the FZP run;
   - "What the plan added": the plan effect on completions with its band, the plan effect on approvals, and the twin explanation; both rows read "calculating…" while `planEffect` is `[]`;
   - the 8-in-10 band, marked provisional while `bandRuns < bandRunsTotal`;
   - the multi-phase footnote: phases scheduled versus estimated, and unenriched rows counted as drawn and score-only (T8 `drawn`);
   - RHNA and buffer progress, with the at-deadline values;
   - homes in progress by stage;
   - stopped homes;
   - a chart with each reference estimate compared with the series its `measure` names, and a table alternative.

   It is labelled "Simulation".
6. A reroll changes the seed, keeps the day, and writes `?seed=N`. Loading that URL reproduces the same numbers on the same dataset.
7. The project card shows:
   - the origin and pathway;
   - the status at the current day;
   - the size and resizes;
   - recorded versus simulated dates, with no future stages;
   - "Phase N of M, {name}" for phases, the phase start marked estimated or published from `phase.start`, and the massing or unenriched-row note;
   - stories with their origin: recorded, "from the project description", or "(simulated)" (the massing or a scaled later revision);
   - `existingUnits` exactly as `ProjectCard.existingUnits`;
   - on a pipeline project with non-empty `quality`, the data notes with their tiers, and every record-derived value marked;
   - the chance of finishing (from `chanceTable` via `monthsIn`), with its provenance;
   - DataSF links.

   Simulated projects are labelled "Block B, Lot L" and carry the disclaimer. A tap on empty map closes the card; the pointer leaving a part only hides the tooltip.
8. The sources dialog lists every parameter in `calibration.json`, plus the baseline, targets and references, each with a tier and source. Tier ≥ 3 entries say they are not from SF records. Its transition shares come from T12's `cumulativeIncidence`, its permit-side entries state the 2007 window, and section 10 lists every `qualityRules` entry of `projects.json` with its tier and project count.
9. A worker crash after `ready` leaves scrubbing working, and Retry restores the same future. A resync goes through `client.resync()`. " (representative)" shows exactly when the shown seed came from a `null` request, and survives resync and Retry.
10. `/` and `/p/:id` behave as before. Their only visible change is the header mode link and the shortened brand below 640 px. `Scoreboard.svelte` and `BrushEditor.svelte` are byte-identical.
11. `/attribution` shows the scenario notice when the manifest has `scenarios.fzp`. The on-map attribution title is unchanged for existing datasets.
12. Every new page state passes `expectNoA11yViolations` under `chromium` and `mobile`.
13. The map key draws every `TIMELINE_LEGEND` swatch from `timelineTokenCss` in both themes and adds no second bar-colour line.
14. A repo search finds no implementation in `src/lib/fzp/` of cumulative incidence, the tail extension or the chance table: `provenance.ts` and `card.ts` call T12 (IA-13).

## 8. Open questions

None remain. The design's reconciliation section, under "Page", answered all four earlier questions:

| question | answer |
|---|---|
| header link gated on scenario data? | no |
| link `calibration-report.md`? | no |
| keyboard access to cards? | a known a11y gap |
| scrub day in the URL? | no; the seed only |

## Interface concerns (for the orchestrator)

**Resolved by the 2026-10-16 interface reconciliation**

| # | concern | resolved by |
|---|---|---|
| C1 | `parcelSummary` time | T6 `parcelSummary { day }`, latest visible project, only stages ≤ day |
| C2 | resync / null reroll | T6 `reroll { seed: number \| null }` is the resync path |
| C3 | `ready` and error codes | T6 `ready` plus `scenario-missing` / `scenario-invalid` |
| C4 | T8 semantics | T8 row and "Units semantics" |
| C5 | reference series | T8 `references[].from` / `measure` and "References" |
| C6 | months in stage | T1 `monthsIn` / `MONTH_DAYS` and T12 |
| C7 | SimMap picking | T7 `timelinePick` with tooltip suppression |
| C8 | legend colours | T7 `tl-*` tokens and `TIMELINE_LEGEND` |
| C9 | prefetch | T6 "viewport-driven at every zoom" |
| C10 | `ManifestBaseSchema` | T11 |
| C11 | fixture contents | reconciliation, "Fixture-0 contents" |
| C12 | simulated labels | T6 `label` and "Ids and labels" |
| C13 | validator | T12 `parseCalibration` |

**Resolved by reconciliation round 2**

| # | concern | resolved by |
|---|---|---|
| R1 | hover vs tap | T7 `timelinePick.kind: 'hover' \| 'tap'`. fzp-mode shows a tooltip on hover and the card on tap, a deliberate narrowing ("Picking") |
| R2 | client ownership | timelapse-sim ships `src/lib/sim/scenario-client.ts`; fzp-mode has no fallback client ("Client") |

**Resolved by partner rulings round 3**

| # | concern | resolved by |
|---|---|---|
| R3 | band total and Local Program flag | T6 `bandRunsTotal` and `ProjectCard.localProgram` |
| — | reference lines and multi-phase notes (pending partner question) | the plan-effect twin (T8 `planEffect`, `planEffectBand`, `references[].measure`) and phase-by-phase simulation (T3 `phases`, T5/T6 `phase`) |

**Resolved by reconciliation round 4**

| # | concern | resolved by |
|---|---|---|
| R4 | phasing summary | T8 `phasing` (N4) |

**Still open:** see "Interface concerns (reappraisal 1)" below.

## Interface concerns (reappraisal 1)

All five are ruled (ledger, "FM spec revised", 2026-10-17) and the rows are amended; this spec follows the rulings.

| # | concern | ruling and where applied |
|---|---|---|
| Q1 | **T6 `storiesTier` comment is self-contradictory.** It said "pipeline only" and also "4 = from the simulator's massing; null iff stories null", which cannot both hold for a simulated card. | **Resolved.** T6 comment fixed: pipeline cards 0, 3 or 4, null iff `stories` is null; simulated cards always null. Simulated cards print "{N} stories" (§4.8); a pipeline card with non-null `stories` and a null tier is still treated as 4, defensively. Later ruling (timelapse-sim IC-R2): tier 4 also covers a later revision's proportional scaling, so its text is "about {N} stories (simulated)". |
| Q2 | **`ProjectCard.quality` is not field-scoped**, and the design's example labels named a record. | **Resolved.** Labels are generic (never naming a record) and the card marks the record's values as touched by a check, not field by field; the design example is fixed. §4.8 marks every record-derived value (`*`) on a card with non-empty `quality`. |
| Q3 | **`qualityRules` reach the main thread only through `projects.json`.** | **Resolved** (accepted): the sources dialog fetches and validates `projects.json` lazily on first open (§4.10 section 10) and states the parcel and calibration checks in one generic sentence. |
| Q4 | **T8 `phasing.unenriched` did not say which entries are drawn.** | **Resolved.** T8 `unenriched` entries gain `drawn: boolean` (false = score-only, DQ-3). The footnote (§4.5 item 13) counts drawn and score-only entries separately, and dialog section 9 lists them in two lists (§4.10). |
| Q5 | **`qualityRules.tier` was the rule's tier only.** `pr.pipeline.status-date-linked` has rule tier 2 and value tier 0. | **Resolved.** T3 `qualityRules` and T6 `ProjectCard.quality` carry `valueTier`; a display shows `valueTier` when non-null, else `tier`. The card's data notes (§4.8) and dialog section 10 (§4.10) do so, so Freedom West's dates read "San Francisco project records". |

## Reappraisal 1 changes

- **Rows (verbatim re-copy).** T1, T3, T4c, T5, T6, T7, T8, T11 and T12 replaced with the design's current text (T7 re-copied after its `timelineTokenCss` amendment). T2, T4, T4a and T4b were already identical. No T-row is owned; T14 is not consumed directly (its effects reach fzp-mode through T3 `quality`/`qualityRules` and T6 `quality`).
- **Global constraints.** Added the "Data quality" bullet.
- **IA-1** (T7 misses). §4.8 "Hits and misses" table: a tap miss closes the card, a hover miss only hides the tooltip; `null` is never sent. Tests in `FzpMode.svelte.spec.ts` and e2e "Tap miss".
- **IA-2** (`phase.start`). The phase `permitFiled` suffix reads `card.phase.start` ("start estimated" / "published plan date"); the `sources` check is removed.
- **IA-3** (legend tokens; orchestrator note). The legend applies `timelineTokenCss('.sfh-fzp-legend')` in the head; `/fzp` passes SimMap no `theme`, so both follow `prefers-color-scheme`. fzp-mode's duplicate "Bar colour" sentence is dropped; "Bar length" is kept. AC 13.
- **IA-9** (empty `planEffect`). `ScoreAt.planCompleted`/`planEntitled` are nullable; plan rows, chart series and table cells read "calculating…" while the series are `[]`. Fixture variant and tests added.
- **IA-13** (`cumulativeIncidence`). Sources section 3 uses T12's `cumulativeIncidence`; `provenance.ts` no longer re-implements the tail extension. Its test compares with T12 rather than hand-computed values. AC 14.
- **IA-14** (`storiesTier` 4). The stories table gains a tier-4 row, now "about N stories (simulated)" (massing or scaled later revision), and a defensive null-tier row (Q1).
- **IA-20** (`tailProvenance`). Card and dialog read `transitions[p][s].tailProvenance`.
- **IA-23** (resync, representative). `onResyncNeeded` calls `client.resync()`; a per-request representative flag survives resync and crash Retry.
- **IA-24** (null summaries, `requestParcelSummary`). Four summary states, with "Project details are still loading for this area." and a re-request on `chunks`; `/fzp`'s `requestParcelSummary` sends the scrubbed day and returns `generated: null`.
- **"Quality on records" ruling.** The card shows `ProjectCard.quality` as "About this record's data", with tier labels, and marks record-derived values; `existingUnits` follows T6 (pipeline: T3 value after `pr.parcels.shared-existing`; simulated: the T11 sum) and is never re-summed.
- **Data-quality disclosure** (global "Data quality"). New sources section 10, "How the records were checked": `qualityRules` from a lazily fetched `projects.json`, with per-rule project counts (Q3).
- **DQ-1.** The permit-side transition entries carry the 2007 window sentence, and the window is read from provenance. The `phaseGap` entry states its own decoupled window. A test checks the fixture's windows start on 2007-01-01.
- **DQ-3.** The footnote, section 9 and the card's unenriched note cover score-only masters (listed in `phasing.unenriched`, never drawn or picked) (Q4).
- **Carry-forwards** (IA-22, wave1-assignments). Lookups are never mutated (identity compare); no handle call before `onready` (R18); SimMap's "ADU · adds N units" footprint tooltip never appears on `/fzp` because `timelinePick` is always set.
- **Doc debt.** None was logged for fzp-mode (not yet dispatched). No known answer depends on the corrected project-records fixture values (A13); the e2e tests that need fixture-0 data read it from the files.
- **Residue removed.** The `tailProvenance[pathway][stage]` map; the `card.sources` schedule test; the bare `null` pick; FM's direct resync `reroll`; "drawn as one footprint" for every unenriched row.
- **Fidelity pass 3 (2026-10-17).** Tier-4 stories copy neutral, "about {N} stories (simulated)", covering the massing and a later revision's proportional scaling (F3-5); the card's data notes and dialog section 10 show `valueTier` when non-null, else `tier`, with fixture and test cases (F3-6); the footnote and dialog section 9 use T8 `unenriched[].drawn` to separate drawn and score-only masters (F3-7); Q1–Q5 marked resolved with their rulings (F3-9).
