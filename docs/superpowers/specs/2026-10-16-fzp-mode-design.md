# `fzp-mode`: the Family Zoning Plan timelapse page (spec)

Status: draft for orchestrator review (2026-10-16). Composition: [FZP timelapse design](../design/2026-10-16-1903-fzp-timelapse.md) (approved with partner rulings OD-T1..T5). Slug `fzp-mode`. Route `/fzp`. Built last (dependency order step 4).

## 1. Scope

From the design, verbatim:

- **`fzp-mode`** (route `/fzp`). A read-only page: the map, plus a **time scrubber** (play/pause, speed, date readout, keyboard-operable), a **time-aware scoreboard**, a ghost-state legend, a **project card** on hover or tap, a **"Where these numbers come from"** panel listing each parameter's tier and source, and a **"Show another possible future"** reroll. There is a header link between the editor and this mode.

**In scope**

- The route `src/routes/fzp/` (`+page.ts`, `+page.svelte`) and a new module `src/lib/fzp/`: the page composition, a main-thread scenario client, the time scrubber, the time-aware scoreboard (a sibling of the editor's), the chart, the ghost-state legend, the project card, the "Where these numbers come from" dialog, the reroll, the seed in the URL, an e2e debug hook, and all copy.
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
| T1 | `type Day = number` is integer days since 1970-01-01 UTC. All schedule times use it. It is exact in Float32. `MONTH_DAYS = 30.436875` (365.2425 / 12). `monthsIn(enteredDay, day) = floor((day − enteredDay) / MONTH_DAYS)` is the single months-in-stage rule, used by every table index (T4, T12, the bar, the card). `OPEN_DAY = 3.0e38` encodes an open-ended window end. These live in `src/lib/timelapse/time.ts` | stage-calibration → all | DC |
| T2 | `type Stage = 'preApplication' \| 'filed' \| 'entitled' \| 'permitFiled' \| 'permitIssued' \| 'construction' \| 'complete'`; `type Pathway = 'discretionary' \| 'streamlined' \| 'permitOnly'`; `type ExitReason = 'withdrawn' \| 'disapproved' \| 'cancelled' \| 'expired'`. `STAGE_ORDER` lists the stages in this order. `preApplication` is optional on every pathway. `permitOnly` projects never enter `filed` or `entitled`. A ghost is visible from the project's first entered stage | stage-calibration → project-records, timelapse-sim, timelapse-render, fzp-mode | MC (stage sequence and exits follow real records), DC (names) |
| T3 | `interface InFlightProject { id: string /* 'PRJ:<record_id>', 'BP:<permit>', 'PRJ:<record_id>:BP:<permit>' for split pipeline rows, 'CASE:<case_no>' for PRX rows, 'PPA:<record_id>' for PPA-only; unique */; label: string \| null /* street address from the records, if any */; parcelIds: ParcelId[] /* current mapblklot, mapped through retired-parcel lineage */; pathway: Pathway; stage: Stage; history: Partial<Record<Stage, Day>> /* observed entry days */; units: number; existingUnits: number; stories: number \| null; storiesTier: 0 \| 3 \| null /* 0 = recorded field, 3 = parsed from description text */; multiPhase: boolean /* PRX/DA remaining-phase row */; sources: { dataset: string; id: string; key?: string /* field to query, e.g. 'case_no'; absent = the dataset's record-id field */ }[] }`. `scenarios/fzp/projects.json` = `{ schema: 1; asOf: Day; rhnaCompletedNet: { units: number /* net units added since `since` up to `asOf`, Housing Inventory definition: completions plus alteration gains, minus demolitions and alteration losses */; since: Day /* 2022-06-30, RHNA projection period start */; provenance: Provenance }; projects: InFlightProject[] }`. Projects are new construction only (alterations adding units are out of scope) | project-records → timelapse-sim, fzp-mode | MC (real pipeline is the starting state), DC (shape) |
| T4 | `interface Provenance { tier: 0 \| 1 \| 2 \| 3 \| 4; label: string; sources: { label: string; url: string }[]; method: string; n?: number; window?: [from: string, to: string] }`. `interface Transition { months: number; advance: number[] /* cumulative incidence by month 1..months */; exit: Partial<Record<ExitReason, number[]>>; tail: { advance: number; exit: Partial<Record<ExitReason, number>> } /* constant monthly hazards beyond months */; provenance: Provenance }`. `scenarios/fzp/calibration.json` = `{ schema: 1; asOf: Day; transitions: Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Transition>>>; initiation: InitiationModel; pathwayForNew: Record<Pathway, number> & { provenance: Provenance }; size: SizeModel; revision: RevisionModel }`. The calibration also carries `ppaShare: Record<Pathway, number> & { provenance: Provenance }`, the share of new projects that start at `preApplication`. `InitiationModel`, `SizeModel` and `RevisionModel` are rows T4a–c. Everything is plain JSON, so future policy levers can transform it (the T9 seam). **Sampling semantics:** a project entering stage *s* at day *d* draws one uniform. The month of advance or exit comes from the cumulative tables (`advance` + Σ`exit` ≤ 1 at every month), with the tail hazards beyond `months`. An in-flight project already *m* months into *s* draws conditionally on having survived *m* months. Day within the month is uniform | stage-calibration → timelapse-sim, fzp-mode | MC (every parameter carries tier + source), DC (encoding) |
| T4a | `type FeatureId = 'potentialRatio' /* yield units at full envelope ÷ max(existingUnits, 1); base variant uses the density-capped base yield (T13), FZP variant the Local Program yield (T11) — this is how density decontrol is seen */ \| 'existingUnits' \| 'lotAreaM2' \| 'yearBuilt' \| 'storiesGap' /* envelope stories − existing stories */ \| 'improvementShare' /* improvement ÷ (land + improvement) assessed value */ \| 'rentControlLikely' /* 0/1: ≥ 2 units and built < 1979 */ \| 'landUseClass' /* categorical: residential, mixed, commercial, pdr, vacant, other */`. `interface InitiationModel { kind: 'logit-monthly'; intercept: number; terms: { feature: FeatureId; bins: number[] /* ascending edges; categorical features use category index */; coef: number[] /* one per bin */ }[]; provenance: Provenance }`. Monthly hazard = `1 / (1 + exp(−(intercept + Σ coef[bin(feature)])))`. It is fitted on pre-FZP (base) envelopes and evaluated on FZP envelopes. Parcels with an in-flight project are not at risk until that project ends | stage-calibration → timelapse-sim, scenario-data (feature list) | DC |
| T4b | `interface SizeModel { fillLevels: number[] /* ascending fractions of envelope stories; last = 1; length F matches T11 yield */; byEnvelope: { maxStoriesUpTo: number; probs: number[] /* length F, sums to 1 */ }[]; provenance: Provenance }`. A new project proposes `stories = max(1, round(fill × envelope.maxStories))` | stage-calibration → timelapse-sim, scenario-data (F) | DC |
| T4c | `interface RevisionModel { at: { stage: Stage /* applied on entering this stage */; probability: number; ratio: { edges: number[]; probs: number[] } /* histogram of new units ÷ previous units */ }[]; provenance: Provenance }`. No revision on or after `construction`. Upsizing is capped at the parcel's envelope. A revision changes units, and stories follow from the yield table (simulated) or scale proportionally (pipeline) | stage-calibration → timelapse-sim | MC (projects can resize before construction), DC (shape) |
| T5 | `interface Schedule { projectId: string; origin: 'pipeline' \| 'simulated'; parcelIds: ParcelId[]; pathway: Pathway; entered: Partial<Record<Stage, Day>>; end: { kind: 'complete'; day: Day } \| { kind: 'exit'; stage: Stage; reason: ExitReason; day: Day } \| { kind: 'open' } /* still in progress at horizon */; revisions: { day: Day; units: number; stories: number \| null /* null = unknown until massed */ }[] /* [0] is the initial proposal; ascending days; none on or after entered.construction */; existingUnits: number; multiPhase: boolean }`. `simulate(input: SimInput, seed: number, horizon: Day): Schedule[]` is pure and deterministic. `SimInput = { parcels: ScenarioParcels /* decoded T11 */; projects: InFlightProject[]; calibration: Calibration; asOf: Day }`. Buildings of simulated projects carry `source: 'scenario'`, and pipeline projects carry `'pipeline'` (the sim stamps them) | timelapse-sim → timelapse-render (via T7), fzp-mode | MC (deaths, resizing, real starting state), DC (shape) |
| T6 | Worker protocol additions (I15 extended), served by a separate scenario host behind the same Worker and a separate `ScenarioClient` (the editor's host and `SimClient` are unchanged). Requests: `{ type: 'initScenario'; rev; manifest: Manifest; scenario: 'fzp'; seed: number \| null /* null = representative seed */; horizon: Day }`, `{ type: 'reroll'; rev; seed: number \| null }` (also the resync path: same seed → fresh revision-0 snapshot), and `{ type: 'parcelSummary'; reqId: number; parcelId: ParcelId; day: Day; projectId?: string /* the picked project; returned if visible at day */ }`. Responses: `ready` (existing shape), `{ type: 'timeline'; rev; seed: number; render: TimelineUpdate; score: TimelineScore; bandRuns: number /* band runs finished so far, of N; the band is provisional until bandRuns = N */; complete: boolean /* all loaded cells packed */ }`. A band-only update is a `timeline` whose `render` is `{ revision: last + 1, cells: [], removedCells: [], demolish: [] }`, `chunks` (existing), and `error` with `code: 'manifest-invalid' \| 'scenario-missing' \| 'scenario-invalid' \| 'bad-request' \| 'internal'`. `parcelSummary` responds with `project?: ProjectCard`: the project named by `projectId` if it is visible at `day`; otherwise the project on that parcel whose first entered stage is ≤ `day`, latest first; none if no project is visible at `day`. `ProjectCard = { projectId: string; origin: 'pipeline' \| 'simulated'; label: string /* pipeline: T3 label, else 'Block B, Lot L'; simulated: always 'Block B, Lot L' */; pathway: Pathway; units: number; existingUnits: number /* summed over the project's parcels */; stories: number \| null; storiesTier: 0 \| 3 \| null /* pipeline only; 3 = parsed from description text */; massing: 'matched' \| 'approximate' \| 'none'; multiPhase: boolean; stages: { stage: Stage; day: Day; actual: boolean }[] /* only stages entered ≤ day */; revisions: Schedule['revisions'] /* only those ≤ day */; end: Schedule['end'] \| null /* null if the end is after day */; sources: { dataset: string; id: string; key?: string /* field to query, e.g. 'case_no'; absent = the dataset's record-id field */ }[] }`. The card's chance to finish is computed on the main thread from T12 at the current time. `prefetch` is reused, viewport-driven at every zoom in this mode | timelapse-sim ↔ fzp-mode, timelapse-render | DC |
| T7 | `interface TimedPackedCell extends PackedCell { slotProjectIds: string[] /* render slots are keyed by project; parcelIds may repeat across slots */; partWindow: Float32Array /* per part: [fromDay, toDay) the part's revision is current; toDay = OPEN_DAY if open */; slotStages: Float32Array /* per slot: STAGE_ORDER.length entry days, NaN = never */; slotEnd: Float32Array /* per slot: [endDay, endKind] (0 open, 1 complete, 2 exit) */; slotPathway: Uint8Array /* index into ['discretionary','streamlined','permitOnly'] */ }`. `parcelMeta` rows describe the slot's final revision. `packTimedCell` is pure and owned by timelapse-render (in `src/lib/map/`); the worker imports it. `interface TimelineUpdate { revision: number /* 0 = snapshot */; cells: TimedPackedCell[]; removedCells: string[]; demolish: { parcelId: ParcelId; day: Day }[] /* complete list in revision 0 (needs no geometry); empty afterwards */ }`. `SimMapHandle` gains `applyTimeline(u: TimelineUpdate): void`, `setTime(day: Day): void` and `setTimelineLookups(l: { chance: ReturnType<typeof chanceTable>; typicalMonths: ReturnType<typeof typicalMonths> }): void`. `SimMapProps` gains `timelinePick?: (p: { projectId: string; parcelId: ParcelId; x: number; y: number; kind: 'hover' \| 'tap' } \| null) => void`. When it is set, SimMap's built-in tooltip is suppressed over timeline parts. Timeline colour tokens (`tl-*` in `palette.ts`) and an exported `TIMELINE_LEGEND` are owned here. `setTime` does O(1) JS work per call, except the existing-building catch-up, which applies at most 2,000 feature-state changes per frame until it converges | timelapse-render ↔ timelapse-sim, fzp-mode | DC |
| T12 | In `src/lib/timelapse/model.ts` (pure, zod-free, worker-safe): `sampleTransition(t: Transition, u: number, monthsElapsed: number): { kind: 'advance' \| ExitReason; days: number }`, `initiationHazard(m: InitiationModel, f: Record<FeatureId, number>): number`, `chanceTable(cal: Calibration): Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Float32Array>>>` (per month in a stage, the probability of eventually reaching `complete`; the table is 241 months long, and the tail is used beyond it), `typicalMonths(cal: Calibration): Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, number>>>` (median months to leave each stage, used for the bar's within-stage fill), and `parseCalibration(json: unknown): Calibration` (throws on schema mismatch). The pipeline's validation, the worker, the renderer (lookups uploaded once) and the card all use these, and nothing re-implements them. The bar colour and the card's "chance of finishing" both come from `chanceTable` | stage-calibration → timelapse-sim, timelapse-render, fzp-mode | MC (health = chance of finishing, OD-T2; one sampling semantics everywhere) |
| T8 | `interface TimelineScore { months: Day[] /* months[i] = the 1st of the i-th month, starting with asOf's month and ending with the horizon's month; every series value at i is the state at the end of that month (events with day < months[i + 1], or ≤ horizon for the last entry) */; shown: { completedNet: number /* cumulative since asOf, simulation only, excludes baseline */; completedNetPipeline: number; completedNetNew: number; entitledNew: number /* cumulative units of new (simulated) projects reaching entitled */; inProgress: Record<Exclude<Stage, 'complete'>, number> /* current proposed units of projects in each stage at that month */; exitedUnits: number /* cumulative */ }[]; band: { p10: number; p50: number; p90: number }[] /* completedNet over N runs, same basis as shown */; baseline: { completedNet: number; since: Day; provenance: Provenance }; targets: TargetProgressAt[]; references: { id: string; label: string; units: number; from: Day; by: Day; measure: 'entitledNew' \| 'completedNetNew' \| 'completedNet'; provenance: Provenance }[] /* published estimates, each compared with the matching shown series */ }`, where `TargetProgressAt = { target: Target /* I11 */; deadline: Day; fraction: number[] /* per month, (baseline + completedNet) ÷ target, uncapped */ }` | timelapse-sim → fzp-mode | MC (net units against RHNA; band shown; baseline actuals counted), DC (shape) |
| T11 | `scenarios/fzp/parcels.bin` (codec `sfh-scenario/1`, in `src/lib/data/`; deflate inside the file, async decode). It holds **every** parcel: `id`, `labelPoint`, `cellId`, a `hostable` flag (eligible and able to host a new project), `envelope: Envelope` (FZP stories: Local Program height if `localProgram`, else base height; clamped to `MAX_STORIES`), base stories, the base-zoning density cap in units (null = none), `localProgram: boolean`, `existingUnits` (latest assessor roll), the T4a feature values (base and FZP variants of `potentialRatio` and `storiesGap`) with an imputation mask, and `yield: Uint16[F]`, the gross units at each fill level of the envelope, replacement typologies only (no ADU outcomes), with no density cap under the Local Program. `FILL_LEVELS = [0.25, 0.5, 0.75, 0.9, 1]` (F = 5, tier-4 quantisation grid) is owned here, and stage-calibration imports it. Named in the manifest as `scenarios?: { fzp: { parcels: url; projects: url; calibration: url } }` (amends I12 and `ManifestBaseSchema`; optional, so older datasets load). Because the yield uses the generator, `src/lib/generator` and `src/lib/timelapse` join the dataset-version hash | scenario-data → timelapse-sim | DC |

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
  entitledNew: number;                                      // T8 shown[i].entitledNew
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
- **Determinism.** The same `datasetVersion` and seed always give the same future, on every machine. The representative seed is chosen deterministically: the run whose final `completedNet` is the median of the N band runs.
- **Honesty of numbers.** The mode is labelled a *simulation*. The scoreboard shows the shown run and the p10–p90 band. Pipeline and new-FZP units are separate lines. Actual completions since the RHNA period start are counted and labelled as actual. Units lost to dead projects are shown.
- **Time scrubbing performance.** At 60 fps on a 2022-era laptop with the whole city's timeline loaded, per-frame JS during scrub or playback is O(1) in project count. A reroll reaches a full new timeline (the shown run, to 2050) within 3 s off the main thread. The p10–p90 band may fill in progressively afterwards; the UI marks it as provisional until it is complete.
- **First paint.** `/fzp` must not require loading every parcel chunk. The whole-city score comes from `parcels.bin`, `projects.json` and `calibration.json`. Geometry streams with the viewport, as on `/`.
- **The editor is unchanged.** `/` and `/p/:id` behave exactly as before. FZP mode is additive. The one intended exception is the shared header, which gains the mode links ("Paint" / "Timelapse").
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

- **Client.** T6 names a separate `ScenarioClient` behind the same Worker. If timelapse-sim does not ship it, fzp-mode writes it at `src/lib/fzp/client.ts`. It wraps `spawnSimWorker()` (`src/lib/sim/client.ts:226-230`). It keeps a rev counter, `parcelSummary` promises and crash detection, mirroring `SimClient`. `SimClient` is unchanged (T6).
  - It sends `initScenario { manifest, scenario: 'fzp', seed, horizon }`, where horizon is the `Day` of 2050-12-31 (OD-T4).
  - It sends `reroll { seed: number | null }`, plus `prefetch`, `retryChunks` and `parcelSummary { parcelId, day }`.
  - The host answers `initScenario` with `ready` (existing shape). Phase `ready` still waits for the first `timeline`.
  - A `timeline` or `error` whose `rev` is older than the latest `initScenario`/`reroll` rev is dropped.
- **Pending state before the map handle exists** (mirroring `BrushEditor.svelte:149-163,298-312`): `TimelineUpdate`s and chunk statuses queue, and an update with `revision === 0` clears the queue. `onready(h)` then:
  1. calls `h.setTimelineLookups({ chance: chanceTable(cal), typicalMonths: typicalMonths(cal) })` (T7, T12). It computes both once per calibration on the main thread, and the card reuses the same `chance` table;
  2. applies the queue in order;
  3. calls `h.setTime(day)` with the current scrub day;
  4. calls `h.setBottomInset(px)` (§4.3);
  5. registers `h.onResyncNeeded`.
- **Every `timeline` message**: call `applyTimeline(render)`, or queue it, then replace the held `TimelineScore` and record `seed` and `complete`. Several messages per seed are normal: the band fills in, and new chunks bring geometry.
- **Chunks.** `chunks` messages feed `setChunkStatus` and the chunk-error chip, as in the editor. The chip's Retry sends `retryChunks`.
- **Prefetch.** After the first `timeline`, and on every map `moveend`, send `prefetch(viewport bbox)` **at every zoom**. This differs from the editor's zoom-14 gate (`BrushController.svelte.ts:59,656-661`): ghosts must appear at the city view (OD-T2 tints below street zoom), and the first paint (score and controls) never waits on chunks. T6 ("viewport-driven at every zoom in this mode") rules this.
- **Resync** (`onResyncNeeded`): send `reroll` with the seed of the shown future. T6 makes this the resync path: the same seed gives a fresh revision-0 snapshot.
- **Errors.**
  - An `error` answering the latest scenario rev in phase `loading` → `failed`.
  - In phase `ready` (a failed reroll), keep the shown future and show a dismissible notice: "Couldn't make another future. Try again."
  - `bad-request` with any other rev is logged only.
- **Crash** (mirroring `BrushEditor.svelte:204-240`).
  - Before `ready`: go to `failed`.
  - After `ready`: everything needed to scrub is already on the main thread, so scrubbing and the scoreboard keep working. A status chip reads "Part of the simulation stopped. Retry". Card requests resolve `null`, and the card shows "Details unavailable".
  - **Retry** runs these steps:
    1. `restart(spawnSimWorker())`;
    2. reset the chunk statuses (`BrushEditor.svelte:249-253`);
    3. reload the manifest and calibration if either failed;
    4. call `init` with the manifest. The host answers with `ready`;
    5. send `initScenario` with the shown seed, or with the URL seed (`null` when absent) before any future has been shown.

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
  - the score month index is computed arithmetically: `(Y(day) − Y(months[0]))·12 + (M(day) − M(months[0]))`, clamped to `[0, months.length − 1]`;
  - the chart cursor moves to x(day);
  - an open card recomputes `CardStatus` (O(stages)). When the month index changes, it re-requests `parcelSummary(parcelId, day)`, with at most one request in flight and the latest wins (§4.8).

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
   - "Simulated, new under the plan": `completedNetNew`;
   - "Simulated, new homes approved under the plan": `entitledNew` (T8; this is the series Planning's estimate compares with).
5. **Band:** "In 8 of 10 simulated futures: {p10 + baseline}–{p90 + baseline}" (the band has the same basis as `shown`, T8). While `complete` is false it gets the suffix " (still calculating)" and `aria-busy="true"`. Until any band value exists it reads "Range: calculating…".
6. **Targets:** one `TargetRow` per T8 `targets` entry, in order (RHNA, then RHNA + buffer). Under each is "At the deadline ({deadline as Mon D, YYYY}): {formatPercent(fraction[d])}", where `d` is the month index of the deadline. The fractions come straight from T8, which includes the baseline.
7. **In progress:** "Homes in projects still in progress: {sum}". Then a `<dl>` with one row per stage in `STAGE_ORDER` (unknown keys appended), using the "in stage" labels of §4.9.
8. **Stopped:** "Proposed homes in projects that stopped since {asOf month}: {exitedUnits}".
9. **Chart** (§4.6).
10. **Future line:** "This future: #{seed}", plus " (representative)" when the shown seed came from a `null` request. When it is not representative there is also a button, "Back to the representative future" (§4.7).
11. **"Map key"** (`<details>`, open by default ≥ 768 px), the ghost-state legend. It renders one row per entry of timelapse-render's exported `TIMELINE_LEGEND` (T7), drawing each swatch from the `tl-*` tokens through their `--map-*` CSS variables, so the legend follows the theme. After the entries it adds one line of fzp-mode's own: "Bar length: progress through the stages. Bar colour: chance of finishing, low to high."
12. **Button:** "Where these numbers come from" (opens §4.10).
13. **Footnote:** "Data {datasetVersion} · built {date} · as of {asOf date} · [Sources](/attribution)".

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
  | new under the plan, completed (`completedNetNew`) | `#b45309` (amber-700) solid 2 px |
  | new under the plan, approved (`entitledNew`) | amber-700 dashed 2 2 |
  | RHNA (82,069) | 1 px black horizontal line, labelled "RHNA" |
  | each T8 reference | dotted horizontal line at `units`, a dot at `by`, labelled `label` (detail below) |
  | RHNA deadline and 2045 | gray dashed verticals |
  | current day | black vertical cursor |

  Each reference line runs from `max(from, asOf)` to `by`. It takes the colour of the series its `measure` names: amber for `completedNetNew` and `entitledNew`, blue for `completedNet`. Its label ends "(compare with: {series name})".
- **Contrast:** every stroke has ≥ 3:1 contrast on white (SC 1.4.11: blue-700 is 6.7:1, gray-700 10.3:1, amber-700 5.0:1). Every series is also told apart by its dash pattern, plus a legend in text under the chart.
- **References are compared with the series their `measure` names** (T8, reconciliation "References"):
  - Planning's ~39k are entitlements, compared with `entitledNew`;
  - the Controller's 14,646 and 8,504 by 2045 are completions, compared with `completedNetNew`.

  They are levels, not trajectories, so they are drawn horizontal. The simulated series start at `asOf`, while Planning's window starts at 2026-01-12. The dialog's reference entry says so: "Simulated counts start on {asOf date}."
- **Accessibility:**
  - The chart is a `<figure>` whose SVG has `role="img"` and an `aria-label` summary: "Net new homes in this simulation: {x} by the RHNA deadline, {y} by 2045, {z} by the end of 2050."
  - A `<details>` "Show as table" holds a `<table>` with one row per January from `asOf`'s year + 1 to 2050, plus the deadline row and the final month. Its columns are date, total, from pipeline, new under the plan (completed), new under the plan (approved), and the 8-in-10 range.

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

- **Picks** come from `SimMapProps.timelinePick` (T7). SimMap suppresses its own tooltip over timeline parts, and parts hidden at `t` are not pickable. Existing buildings keep SimMap's normal tooltip and open no card.
- **Hover** (fine pointer, `matchMedia('(pointer: fine)')`): a non-null pick shows fzp-mode's own non-interactive tooltip at `(x, y)`. It uses the same `role="tooltip"` and `sim-map-panel` styling as `SimMap.svelte:1032-1043`, and its text is `[label, "{Real|Simulated} project · {in-stage label} · {units} homes"]`. A null pick hides it. The text comes from a `parcelSummary(parcelId, day)` request. Requests are latest-wins, and "Loading…" shows until the answer.
- **Opening the card.**
  - With a fine pointer, a map `click` (via `handle.getMap()`) while the latest pick is non-null opens the card.
  - With a coarse pointer, any non-null pick (a tap) opens it.

  The card is an interactive panel, so its links work. The page calls `client.parcelSummary(parcelId, day)` and reads `summary.project`. Per T6, that is the latest project on the parcel whose first stage is ≤ `day`. With no project it reads "No project on this parcel at this date." The card closes on Close, on Escape, and on a click or tap on empty map.
- **While the card is open,** it re-requests when the month index changes. Per T6 the card shows only stages and revisions on or before `day`, and `end` only once it has passed. The card therefore never shows future stages, which the reconciliation ruled under "Open questions answered".
- **Card content** (all from `ProjectCard` plus the current `day`; `card.ts` is pure):
  - **Heading**, the `label`, and a badge: "Real project" for `origin 'pipeline'` or "Simulated project". Simulated labels are always "Block B, Lot L" (T6).
  - **Massing note:**
    - `massing === 'approximate'`: "Building shape approximate";
    - `massing === 'none'` or `multiPhase`: "Multi-phase project; buildings not drawn" (reconciliation "Multi-phase projects").
  - **Simulated projects** add: "Not a real proposal. In this simulated future a project starts on this parcel. The parcel was picked by chance, weighted by how often parcels like it have been redeveloped. It says nothing about the owner's plans."
  - **Pathway**, using the §4.9 labels.
  - **Status at `day`**:
    - `inStage`: "{in-stage label}, {n} months so far".
    - `complete`: "Completed {date}".
    - `exited`: "Stopped during {in-stage label of end.stage} ({reason label}), {date}".
    - The current stage is the last entry in `stages` with `day ≤ t`, unless `end` is non-null and `end.day ≤ t`.
  - **Size at `day`**: the last `revisions` entry with `day ≤ t`. It reads "{units} homes · {stories} stories (omitted when null) · replaces {existingUnits} existing homes (assessor) (net +{units − existingUnits})". Each later revision is listed as "Resized: {a} → {b} homes, {date}", with ", simulated" appended when its day is after `asOf`.
  - **Chance of finishing** (`inStage` only): `chance[pathway][stage][min(monthsIn(entered, t), 240)]`, using the main thread's `chanceTable(calibration)` (241 months long, T12) and `monthsIn` (T1). These are the same functions and table the renderer receives, so the card and the bar colour agree. The value is shown as a whole percent, rounded, or as "under 1%" or "over 99%": "Chance of finishing from here: 62%". Under it, a `<details>` "How is this estimated?" lists every `Transition` from the current stage to `complete` on this pathway, each with its tier and `provenance.label`. It links to the matching dialog section. If any listed transition has tier ≥ 3, the line also says "partly based on research estimates, not San Francisco records". The copy says the number is the share of similar projects that finish, not this project's fate.
  - **Timeline**: one row per `stages` entry (iterated from data, not from `STAGE_ORDER`), then `end` if non-null. Each row is "{entered label} · {date} · Recorded" when `actual`, else "Simulated". Actual dates are `Mon D, YYYY`; simulated dates are `Mon YYYY` (the day within the month is a uniform draw, T4). All dates are formatted in UTC.
  - **Sources**: one link per `sources` entry: "{dataset name} {id}: DataSF record (JSON)". The URL is `https://data.sf.gov/resource/{dataset}.json?{key}={encodeURIComponent(id)}`, with keys verified live on 2026-10-16:

    | dataset | key | name |
    |---|---|---|
    | `i98e-djp9` | `permit_number` | Building permit |
    | `qvu5-m3a2` | `record_id` | Planning project |
    | `y673-d69b` | `record_id` | Planning record |
    | `d4jk-jw33` | `b1_alt_id` | Planning review |
    | `j67f-aayr` | `building_permit_application` | Completion certificate |
    | `xdht-4php` | `bpa` | Housing production record |
    | `6jgi-cpb4` | `case_no` if the id ends `PRJ`, else `bpa_no` | Development pipeline |

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
   - the share advanced and the share stopped, by reason, within 12, 24 and 60 months. These come from the cumulative tables, extended past `months` with the tail hazards. The extension is a pure function in `provenance.ts`, following the T4 sampling semantics.
4. **"Where new projects start":** `initiation`. Its terms are shown as a table: feature, bin, coefficient.
5. **"How big new projects are":** `size`, as a table: envelope band, fill level, share.
6. **"How projects change size":** `revision`. For each stage: the chance of a resize, the share that shrink and the share that grow.
7. **"Which approval path":** `pathwayForNew` and `ppaShare`, as percentages. Before them, a fixed sentence: "New projects on Local Program parcels always take the streamlined path. That is a rule (administrative approval with a 180-day clock), tier 1. The shares below apply to other parcels." This follows the reconciliation, "New-project pathway and PPA".
8. **"Targets and published estimates":** each T8 target `source` and each `references[].provenance`.

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

- **T9 policy levers.** All scenario requests go through one function, `startScenario({ seed })`, so a future `levers` field is one parameter. The URL parser keeps unknown parameters. The scoreboard renders any number of `references` and `targets`. Nothing else is added.
- **Addenda sub-stages.** Stage labels are one table (§4.9). The card iterates `card.stages` and the scoreboard iterates `inProgress` keys (`STAGE_ORDER` first, unknown keys appended), so new stages render without code changes. A stage missing from the label table falls back to its id.
- **DA phasing.** Nothing: phased projects arrive as ordinary `ProjectCard`s.
- **Renderings.** Nothing: the card has no image slot.
- **calibration-report.md.** The dialog's sections have stable `id`s, so a later link to the report can deep-link to them.

## 6. Testing

**Fixtures:**

- `src/lib/fzp/fixtures/timeline-score.ts`: a hand-made `TimelineScore` with 291 months (2026-10 to 2050-12), a partial band and two references;
- `src/lib/fzp/fixtures/cards.ts`: `ProjectCard`s that are real-actual, simulated (labelled "Block B, Lot L"), exited, revised, `massing: 'approximate'`, `multiPhase` with `massing: 'none'`, and with null `stories`;
- the fixture calibration: `e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json`, read from disk in server tests through `parseCalibration`. A copy with one provenance set to tier 3 covers the tier-3 notes;
- `FakeScenarioWorker` (`src/lib/fzp/test/fake-worker.ts`).

**Vitest server project** (pure TS):

- **`time.spec.ts`:**
  - Day ↔ UTC date;
  - next and previous first-of-month (from the 1st, the 31st and `asOf`);
  - ±12 months; clamps at `asOf` and `horizon`;
  - month index of any day, including before `months[0]` and after the end;
  - Day 2050-12-31 = 29,584.
- **`playback.spec.ts`:** advancing by dt × speed; the 100 ms clamp; stopping at horizon; Replay restarts; property test (fast-check): the day is monotonic and within range.
- **`format.spec.ts`:** readout "March 2031"; actual and simulated date formats; UTC at midnight boundaries; percent rounding including "under 1%" and "over 99%".
- **`score-view.spec.ts`:**
  - `ScoreAt` from the fixture: total = baseline + completedNet; `entitledNew` passed through;
  - band offset by the baseline, and `null` when absent;
  - deadline fraction; stage order with an unknown key appended.
- **`chart.spec.ts`:** `niceCeil`; the x and y scales; the band path closes; references start at `max(from, asOf)`, end at `by`, and are coloured by `measure`; table rows (Januaries, the deadline and the final month).
- **`card.spec.ts`:**
  - `CardStatus` for each fixture at days inside, at and after each stage, with `end: null`;
  - the size and revision at a day;
  - chance from `chanceTable(fixture calibration)` indexed by `monthsIn`, clamped at month 240;
  - the massing and multi-phase notes;
  - the provenance transition list;
  - the tier ≥ 3 note;
  - source URLs for every dataset in the key table, plus the fallback.
- **`provenance.spec.ts`:** the cumulative shares at 12, 24 and 60 months with tail extension, checked against hand-computed values; advance + Σexit ≤ 1; an entry for every calibration parameter present in the fixture.
- **`seed.spec.ts`:** valid, out-of-range and junk seeds; unknown parameters kept.
- **`client.spec.ts`** (if fzp-mode owns the client): rev ordering; stale `timeline`s dropped; `parcelSummary` carries `day`; summary promises resolve `null` on crash or restart.
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
  - "still calculating" and `aria-busy`;
  - the representative label;
  - the live region silent while playing and speaking 1 s after a pause;
  - the mobile bar and sheet, with focus moving and returning;
  - `--scorebar-h`.
- **`ScoreChart.svelte.spec.ts`:** the `role="img"` label; the table opens; the cursor moves with `day`.
- **`ProjectCardPanel.svelte.spec.ts`:** each status; the simulated-parcel disclaimer; the massing note; "No project on this parcel at this date."; links; the provenance disclosure; a re-request on a month change with one in flight; Escape closes it.
- **`SourcesDialog.svelte.spec.ts`:** opens modal; the focus trap and Escape; the section deep link; every fixture parameter has a tier badge and label.
- **`FzpMode.svelte.spec.ts`** (fake worker, `SimMapStub` as `src/lib/brush/test/`):
  - loading → `ready` message → still loading → first `timeline` → ready;
  - `setTimelineLookups` called before the queued `applyTimeline`s;
  - an error before ready (including `scenario-missing` with its copy) → failed → Retry re-sends `initScenario` with the same seed;
  - "Back to the representative future" sends `reroll { seed: null }`;
  - a fine-pointer hover pick shows the tooltip; a click opens the card; a coarse pick opens the card;
  - a crash after ready → chip, scrubbing still works, Retry sends `initScenario` with the shown seed;
  - reroll keeps the day, then a stale timeline is ignored;
  - resync sends `reroll` with the shown seed;
  - `TimelineUpdate`s queued before the handle are flushed in order and `revision 0` clears the queue;
  - prefetch on `moveend`;
  - `no-scenario` never spawns a worker.
- **`SiteHeader.svelte.spec.ts`:** the mode nav at both widths, `aria-current`, and the shortened brand.

**Playwright e2e** (`e2e/fzp.spec.ts`; projects `chromium` and `mobile`; fixture-0 with the scenario files the reconciliation specifies under "Fixture-0 contents": one in-flight project per stage, one PPA, one multi-phase row, and a high initiation hazard):

- **Load and controls:** `/fzp` reaches `ready` (`__sfhFzp.phase`). The readout shows the `asOf` month. Keyboard End → "December 2050", and the headline equals `baseline + score.shown[last].completedNet` from the hook.
- **Reduced motion:** with `emulateMedia({ reducedMotion: 'reduce' })` the day stays at `asOf` for 2 s. Without it, the day advances.
- **Reroll:** puts `?seed=N` in the URL with the day unchanged. Reloading `/fzp?seed=N` gives identical `score.shown`. `/fzp` twice gives the same seed (determinism).
- **Card:** jump to the fixture's pipeline project (`jumpAndIdle` + `projectToPage`, `e2e/helpers/sharing.ts:53-72`). Click or tap opens a card with "Real project" and a DataSF link whose `href` matches the key table. The multi-phase row's card says "Multi-phase project; buildings not drawn".
- **Sources dialog:** lists one entry per parameter in fixture-0's `calibration.json`.
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
   - actual-to-date, the two simulated completion lines and the simulated approvals (`entitledNew`), each separately;
   - the 8-in-10 band, marked provisional until `complete`;
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
   - the massing or multi-phase note;
   - the chance of finishing (from `chanceTable` via `monthsIn`), with its provenance;
   - DataSF links.

   Simulated projects are labelled "Block B, Lot L" and carry the disclaimer.
8. The sources dialog lists every parameter in `calibration.json`, plus the baseline, targets and references, each with a tier and source. Tier ≥ 3 entries say they are not from SF records.
9. A worker crash after `ready` leaves scrubbing working, and Retry restores the same future.
10. `/` and `/p/:id` behave as before. Their only visible change is the header mode link and the shortened brand below 640 px. `Scoreboard.svelte` and `BrushEditor.svelte` are byte-identical.
11. `/attribution` shows the scenario notice when the manifest has `scenarios.fzp`. The on-map attribution title is unchanged for existing datasets.
12. Every new page state passes `expectNoA11yViolations` under `chromium` and `mobile`.

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

**Still open**

- **R1. T7 `timelinePick` does not say whether a call is a hover or a tap.** The render spec's draft carried `surface: 'tooltip' | 'card'`, but the reconciled row dropped it. Without it, fzp-mode infers the trigger: fine-pointer picks are hovers, and a map `click` with a live pick opens the card; coarse-pointer picks are taps (§4.8). Recommend restoring `surface` in T7, which would remove the inference.
- **R2. T6 names a `ScenarioClient` but not its owner.** fzp-mode writes it at `src/lib/fzp/client.ts` unless timelapse-sim ships it.
