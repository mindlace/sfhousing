# timelapse-sim: design spec

Status: derived 2026-10-16 from the [FZP timelapse composition design](../design/2026-10-16-1903-fzp-timelapse.md) (approved with partner rulings OD-T1..T5). Subsystem slug `timelapse-sim`. Owns T1, T5, T6, T8, T9, T12; consumes T2, T3, T4, T4a–c, T7, T10, T11 (and T4d in one pipeline test only).

## 1. Scope

From the design (§Subsystems, verbatim):

> **`timelapse-sim`** (worker). From the scenario parcels, the in-flight projects, the calibration and a seed, it builds the **schedule** of every project. A schedule is a pure function of `(dataset, seed)` (T5). It also runs N schedule-only realisations for the **uncertainty band**. It generates geometry lazily: only for projects in loaded chunks, and once per revision. It posts a timeline (T6–T7) once per seed. **Scrubbing time never round-trips to the worker.**

**In scope**

- `src/lib/sim/scenario/` (new, worker-safe, no zod, no DOM, no `$app`; the files the pipeline imports use relative imports only, like `pipeline/test/chunks.test.ts:5`):
  - `day.ts`: T1 helpers.
  - `detmath.ts`: deterministic `log`, `log1p` and `exp`.
  - `rng.ts`: counter-based draws.
  - `hazard.ts`: InitiationModel evaluation.
  - `stage-sampler.ts`: the T4 sampling semantics.
  - `chance.ts`: T12 `chanceTable`.
  - `simulate.ts`: T5 `simulate`, plus the schedule-only `simulateNet`.
  - `score.ts`: T8.
  - `band.ts`.
  - `card.ts`: ProjectCard.
  - `shape.ts`: worker-safe structural validation of `projects.json` and `calibration.json`.
  - `scenario-host.ts`: `createScenarioHost`.
- `src/lib/sim/protocol.ts`: the T6 additions, as new unions beside the unchanged `SimRequest`/`SimResponse`.
- `src/lib/sim/worker.ts`: a router that sends each request to the editor host or the scenario host.
- `src/lib/sim/scenario-client.ts`: the main-thread `ScenarioClient`.
- `src/lib/map/pack.ts`: a new `packTimedCell` (T7 producer). `packCell` keeps byte-identical output.
- A pipeline test, `pipeline/test/cohort-replay.test.ts`, that replays the historical cohort through the stage sampler.

**Out of scope**

- **Owned by other subsystems:**
  - Rendering, the GPU state machine and `setTime` (timelapse-render).
  - The `/fzp` page, the scrubber, the card UI and the provenance panel (fzp-mode).
  - The `sfh-scenario/1` codec and the manifest `scenarios` field (scenario-data).
  - Producing `projects.json` (project-records).
  - Fitting `calibration.json` (stage-calibration).
  - `generateForUnits` (pipeline-massing).
- **Not built in this package:** policy levers (the T9 seam only), addenda sub-stages, DA phasing, and renderings.
- **Unchanged:** the editor host (`src/lib/sim/host.ts`, `display.ts`), `SimClient` (`src/lib/sim/client.ts`) and every editor behaviour.

## 2. Interfaces

Rows copied verbatim from the design's interface table (T4d is consumed only by `cohort-replay.test.ts`):

| # | interface | owner → consumers | mark |
|---|---|---|---|
| T1 | `type Day = number` is integer days since 1970-01-01 UTC. All schedule times use it. It is exact in Float32 | timelapse-sim → all | DC |
| T2 | `type Stage = 'preApplication' \| 'filed' \| 'entitled' \| 'permitFiled' \| 'permitIssued' \| 'construction' \| 'complete'`; `type Pathway = 'discretionary' \| 'streamlined' \| 'permitOnly'`; `type ExitReason = 'withdrawn' \| 'disapproved' \| 'cancelled' \| 'expired'`. `STAGE_ORDER` lists the stages in this order. `preApplication` is optional on every pathway. `permitOnly` projects never enter `filed` or `entitled`. A ghost is visible from the project's first entered stage | stage-calibration → project-records, timelapse-sim, timelapse-render, fzp-mode | MC (stage sequence and exits follow real records), DC (names) |
| T3 | `interface InFlightProject { id: string /* PRJ record id, else permit number */; parcelIds: ParcelId[]; pathway: Pathway; stage: Stage; history: Partial<Record<Stage, Day>> /* observed entry days */; units: number; existingUnits: number; stories: number \| null; sources: { dataset: string; id: string }[] }`. `scenarios/fzp/projects.json` = `{ schema: 1; asOf: Day; rhnaCompletedNet: { units: number; since: Day; provenance: Provenance }; projects: InFlightProject[] }` | project-records → timelapse-sim, fzp-mode | MC (real pipeline is the starting state), DC (shape) |
| T4 | `interface Provenance { tier: 0 \| 1 \| 2 \| 3 \| 4; label: string; sources: { label: string; url: string }[]; method: string; n?: number; window?: [from: string, to: string] }`. `interface Transition { months: number; advance: number[] /* cumulative incidence by month 1..months */; exit: Partial<Record<ExitReason, number[]>>; tail: { advance: number; exit: Partial<Record<ExitReason, number>> } /* constant monthly hazards beyond months */; provenance: Provenance }`. `scenarios/fzp/calibration.json` = `{ schema: 1; asOf: Day; transitions: Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Transition>>>; initiation: InitiationModel; pathwayForNew: Record<Pathway, number> & { provenance: Provenance }; size: SizeModel; revision: RevisionModel }`. The calibration also carries `ppaShare: Record<Pathway, number> & { provenance: Provenance }`, the share of new projects that start at `preApplication`. `InitiationModel`, `SizeModel` and `RevisionModel` are rows T4a–c. Everything is plain JSON, so future policy levers can transform it (the T9 seam). **Sampling semantics:** a project entering stage *s* at day *d* draws one uniform. The month of advance or exit comes from the cumulative tables (`advance` + Σ`exit` ≤ 1 at every month), with the tail hazards beyond `months`. An in-flight project already *m* months into *s* draws conditionally on having survived *m* months. Day within the month is uniform | stage-calibration → timelapse-sim, fzp-mode | MC (every parameter carries tier + source), DC (encoding) |
| T4a | `type FeatureId = 'potentialRatio' /* yield units at envelope ÷ max(existingUnits, 1) */ \| 'existingUnits' \| 'lotAreaM2' \| 'yearBuilt' \| 'storiesGap' /* envelope stories − existing stories */ \| 'improvementShare' /* improvement ÷ (land + improvement) assessed value */ \| 'rentControlLikely' /* 0/1: ≥ 2 units and built < 1979 */ \| 'landUseClass' /* categorical: residential, mixed, commercial, pdr, vacant, other */`. `interface InitiationModel { kind: 'logit-monthly'; intercept: number; terms: { feature: FeatureId; bins: number[] /* ascending edges; categorical features use category index */; coef: number[] /* one per bin */ }[]; provenance: Provenance }`. Monthly hazard = `1 / (1 + exp(−(intercept + Σ coef[bin(feature)])))`. It is fitted on pre-FZP (base) envelopes and evaluated on FZP envelopes. Parcels with an in-flight project are not at risk until that project ends | stage-calibration → timelapse-sim, scenario-data (feature list) | DC |
| T4b | `interface SizeModel { fillLevels: number[] /* ascending fractions of envelope stories; last = 1; length F matches T11 yield */; byEnvelope: { maxStoriesUpTo: number; probs: number[] /* length F, sums to 1 */ }[]; provenance: Provenance }`. A new project proposes `stories = max(1, round(fill × envelope.maxStories))` | stage-calibration → timelapse-sim, scenario-data (F) | DC |
| T4c | `interface RevisionModel { at: { stage: Stage /* applied on entering this stage */; probability: number; ratio: { edges: number[]; probs: number[] } /* histogram of new units ÷ previous units */ }[]; provenance: Provenance }`. No revision on or after `construction`. Upsizing is capped at the parcel's envelope. A revision changes units, and stories follow from the yield table (simulated) or scale proportionally (pipeline) | stage-calibration → timelapse-sim | MC (projects can resize before construction), DC (shape) |
| T4d | `interface ProjectHistory { id: string; pathway: Pathway; parcelIds: ParcelId[]; entered: Partial<Record<Stage, Day>>; end: { kind: 'complete'; day: Day } \| { kind: 'exit'; stage: Stage; reason: ExitReason; day: Day } \| { kind: 'open'; lastObserved: Day }; unitsAt: Partial<Record<Stage, number>> /* proposed units as recorded at each stage */; existingUnits: number; storiesProposed: number \| null; baseStoriesAtFiling: number \| null; sources: { dataset: string; id: string }[] }`. Pipeline-internal: `pipeline/.cache/derived/project-histories.json`, never shipped | project-records → stage-calibration | DC |
| T5 | `interface Schedule { projectId: string; origin: 'pipeline' \| 'simulated'; parcelIds: ParcelId[]; pathway: Pathway; entered: Partial<Record<Stage, Day>>; end: { kind: 'complete'; day: Day } \| { kind: 'exit'; stage: Stage; reason: ExitReason; day: Day } \| { kind: 'open' } /* still in progress at horizon */; revisions: { day: Day; units: number; stories: number }[] /* [0] is the initial proposal; ascending days; none on or after entered.construction */; existingUnits: number }`. `simulate(input: SimInput, seed: number, horizon: Day): Schedule[]` is pure and deterministic. `SimInput = { parcels: ScenarioParcels; projects: InFlightProject[]; calibration: Calibration; asOf: Day }` | timelapse-sim → timelapse-render (via T7), fzp-mode | MC (deaths, resizing, real starting state), DC (shape) |
| T6 | Worker protocol additions (I15 extended): request `{ type: 'initScenario'; rev; manifest: Manifest; scenario: 'fzp'; seed: number \| null /* null = representative seed */; horizon: Day }` and `{ type: 'reroll'; rev; seed: number }`. Response `{ type: 'timeline'; rev; seed: number; render: TimelineUpdate; score: TimelineScore; complete: boolean }`. `parcelSummary` gains `project?: ProjectCard`, where `ProjectCard = { projectId: string; origin: 'pipeline' \| 'simulated'; label: string /* address if known, else 'Block B Lot L' */; pathway: Pathway; units: number; stories: number; stages: { stage: Stage; day: Day; actual: boolean }[]; revisions: Schedule['revisions']; end: Schedule['end']; sources: { dataset: string; id: string }[] }`. The card's chance to finish is computed on the main thread from T12 at the current time. `prefetch` and `chunks` are reused unchanged | timelapse-sim ↔ fzp-mode, timelapse-render | DC |
| T7 | `interface TimedPackedCell extends PackedCell { partWindow: Float32Array /* per part: [fromDay, toDay) the part's revision is current */; slotStages: Float32Array /* per slot: STAGE_ORDER.length entry days, NaN = never */; slotEnd: Float32Array /* per slot: [endDay, endKind] (0 open, 1 complete, 2 exit) */; slotPathway: Uint8Array /* index into ['discretionary','streamlined','permitOnly'] */ }`. `interface TimelineUpdate { revision: number; cells: TimedPackedCell[]; removedCells: string[]; demolish: { parcelId: ParcelId; day: Day }[] }`. `SimMapHandle` gains `applyTimeline(u: TimelineUpdate): void` and `setTime(day: Day): void`. `setTime` does O(1) JS work per call | timelapse-render ↔ timelapse-sim, fzp-mode | DC |
| T12 | `chanceTable(cal: Calibration): Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Float32Array>>>` gives, per month spent in a stage, the probability of eventually reaching `complete`. Beyond the table length it uses the tail. It is pure and shared by the worker, the renderer (uploaded once as a lookup) and the card. The bar colour and the card's "chance of finishing" both come from it | timelapse-sim → timelapse-render, fzp-mode | MC (health = chance of finishing, OD-T2) |
| T8 | `interface TimelineScore { months: Day[] /* first of each month, asOf → horizon */; shown: { completedNet: number; completedNetPipeline: number; completedNetNew: number; inProgress: Record<Exclude<Stage, 'complete'>, number> /* units */; exitedUnits: number }[]; band: { p10: number; p50: number; p90: number }[] /* completedNet over N runs */; baseline: { completedNet: number; since: Day; provenance: Provenance }; targets: TargetProgressAt[]; references: { id: string; label: string; units: number; by: Day; provenance: Provenance }[] /* published estimates to compare against, e.g. Planning ~39k in 5 yrs, Controller 14,646 by 2045 */ }`, where `TargetProgressAt = { target: Target /* I11 */; deadline: Day; fraction: number[] /* per month, uncapped, baseline included */ }` | timelapse-sim → fzp-mode | MC (net units against RHNA; band shown; baseline actuals counted), DC (shape) |
| T9 | Policy-lever seam (no levers in this package): `simulate` reads all behaviour from `Calibration`. A future `PolicyOp` is a pure `(Calibration, ScenarioParcels) → (Calibration, ScenarioParcels)` transform applied before `simulate` | timelapse-sim → future policy-levers | MC (levers change inputs, not the engine) |
| T10 | `GeneratedBuilding.source: 'user' \| 'pipeline' \| 'scenario'` (amends I9). `generateForUnits(parcel: ParcelRecord \| ParcelRecord[], units: number, maxStories: number, seed: number, stories?: number): GeneratedBuilding \| null` | pipeline-massing → timelapse-sim, map-view | DC |
| T11 | `scenarios/fzp/parcels.bin` (codec `sfh-scenario/1`, in `src/lib/data/`): per eligible parcel `id`, `labelPoint`, `cellId`, `envelope: Envelope` (FZP Local Program stories), the base (pre-FZP) stories, the T4a feature values (with base-envelope and FZP-envelope variants of `potentialRatio` and `storiesGap`), a `localProgram: boolean` flag (false when the parcel is excluded from the Local Program, in which case `envelope` is the base height) and `yield: Uint16[F]`, the units at each quantised fill level of the envelope. Named in the manifest as `scenarios?: { fzp: { parcels: url; projects: url; calibration: url } }` (amends I12; optional, so older datasets load) | scenario-data → timelapse-sim | DC |

### Internal types (not T-rows; they alter no row)

```ts
// protocol.ts: SimRequest/SimResponse stay byte-identical, so host.ts:452 and client.ts:214
// exhaustiveness checks still compile.
type ScenarioRequest =
  | Extract<SimRequest, { type: 'prefetch' | 'retryChunks' }>
  | { type: 'parcelSummary'; reqId: number; parcelId: ParcelId; day?: Day } // `day`: see concern C1
  | { type: 'initScenario'; rev: Rev; manifest: Manifest; scenario: 'fzp'; seed: number | null; horizon: Day } // T6
  | { type: 'reroll'; rev: Rev; seed: number }; // T6
type TimelineResponse = { type: 'timeline'; rev: Rev; seed: number; render: TimelineUpdate; score: TimelineScore; complete: boolean }; // T6
type ScenarioResponse = ReadyResponse | ChunksResponse | ErrorResponse | TimelineResponse
  | { type: 'parcelSummary'; reqId: number; summary: ParcelSummary | null };
type WorkerRequest = SimRequest | ScenarioRequest;
// ParcelSummary (protocol.ts:55) gains `project?: ProjectCard` (T6). The editor never sets it.

interface ScenarioHostDeps {
  fetch: FetchLike; // json files (chunks.ts:9)
  fetchBytes(url: string): Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>; // parcels.bin
  post(msg: ScenarioResponse, transfer: ArrayBuffer[]): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  now(): number; // ms; slice and budget clocks
  generate?: typeof generate;
  generateForUnits?: typeof generateForUnits;
  retryDelaysMs?: readonly number[]; maxConcurrent?: number; memoCap?: number; bandRuns?: number;
}

interface TimedPackInput {
  schedule: Schedule;
  anchor: ParcelId; // the slot's parcelIds[] entry
  buildings: (GeneratedBuilding | null)[]; // one per schedule.revisions entry
}
function packTimedCell(cellId: string, items: readonly TimedPackInput[]): TimedPackedCell; // map/pack.ts

function simulateNet(input: SimInput, seed: number, horizon: Day, months: Day[]): Int32Array; // completedNet per month
function hazardOf(model: InitiationModel, f: (id: FeatureId) => number): number;
function sampleStage(t: Transition, u: number): { month: number; event: 'advance' | ExitReason } | null; // null = never
function sampleStageGiven(t: Transition, survivedMonths: number, u: number): ReturnType<typeof sampleStage>;
```

### Interface concerns (for the orchestrator; no row was changed)

- **C1. A parcel can hold several projects over time, but `parcelSummary` carries no time.**
  - After an exit the parcel is at risk again (§4.5.7), so one anchor parcel can have several slots. T6 only extends the response, so the worker cannot tell which project the user picked.
  - *Recommend:* the `parcelSummary` request gains `day?: Day`. This spec implements it as optional and defines the behaviour without it (§4.11).
- **C2. `stories` is `number` in T5 `revisions` and T6 `ProjectCard`, but `number | null` in T3.**
  - A pipeline project with unknown stories gets `stories: 0`, meaning "unknown", in its Schedule (§4.5.3).
  - *Recommend:* `stories: number | null` in T5 and in ProjectCard.
- **C3. T3 has no address.**
  - The ProjectCard `label` "address if known" can never be filled. Every label falls back to `Block B Lot L`.
  - *Recommend:* add `address?: string` to InFlightProject.
- **C4. There is no location for pipeline parcels outside `parcels.bin`.**
  - T3 carries only `parcelIds`. T11 holds `cellId` for eligible parcels only. A project with no parcel in `parcels.bin` can't be put in a cell, so it is scored but has no geometry.
  - *Recommend:* T11 includes every parcel referenced by `projects.json`, with no initiation risk.
- **C5. The month and bin conventions must be shared with stage-calibration.**
  - The sampler (T4 semantics) and the fitter must agree on four things:
    - month length `L = 30.436875` d;
    - month index `⌊daysInStage / L⌋ + 1`;
    - the InitiationModel bin rule and the handling of a missing feature (§4.5.6);
    - the initiation event, defined here as a project's first dated record of any kind (OD-T1).
  - *Recommend:* stage-calibration imports `day.ts`, `hazard.ts` and `stage-sampler.ts` from `src/lib/sim/scenario/`, so the code cannot drift.
- **C6. The meaning of `rhnaCompletedNet` is undefined.**
  - This spec subtracts `existingUnits` only for construction starts after `asOf`. If the baseline does not already count demolitions from before `asOf`, those are lost; if it does, nothing is double-counted.
  - *Recommend:* project-records defines the baseline as Σ units completed − Σ existing units of projects whose construction started, both in `[since, asOf]`.
- **C7. The T8 references are not all tier-1 completions.**
  - **Planning's 39,000** is *"Expected Net Approvals from Rezoning"* over the *"remaining RHNA period (5 yrs)"*. That is approvals, not completions. Verified: Land Use Committee deck, 2025-11-17, slide 6.
  - **The Controller figures** come from the Office of Economic Analysis. They are verified only via KQED 2025-10-29: "14,646 additional units over the next 20 years", and "8,504" low. The primary report was not located.
  - Both are model outputs, which the hierarchy's own definitions would put at tier 3. This spec labels them tier 1 as instructed, and puts "approvals" in the Planning label.
  - *Recommend:* T8 `shown` gains `approvedNetNew` (units of new projects that reached `entitled`, or `permitIssued` for `permitOnly`), so the Planning line compares like with like.
- **C8. T11 `yield` should exclude ADU and non-replacing outcomes.**
  - The schedule path never runs the generator, so every simulated project is treated as replacing the existing building.
  - *Recommend:* `yield[f] = 0` wherever `generate()` returns null or an ADU.
- **C9. There are no scenario-specific error codes.**
  - The spec reuses `manifest-invalid`, `bad-request` and `internal` (§4.12). `SimClient` auto-resyncs with a `load` on `bad-request`/`internal` (`client.ts:209`), which is wrong in scenario mode. Hence the separate `ScenarioClient`.
- **C10. `packTimedCell` lives in `map/pack.ts` but is produced by this subsystem.**
  - The T7 slot is a project, not a parcel: `parcelIds[slot]` is the project's anchor parcel and may repeat across slots. timelapse-render must not assume parcel ids are unique within a TimedPackedCell.
- **C11. Calibration completeness.**
  - `shape.ts` rejects a calibration that lacks a Transition for any valid `(pathway, stage)` pair. That is every stage except `complete` and, for `permitOnly`, `filed`/`entitled`. stage-calibration must guarantee completeness, falling back to pooled pathways with provenance saying so.

## 3. Global constraints

### Global constraints (design, verbatim)

The source design's constraints still apply (free and open, determinism, overshoot meaningful, honesty of numbers, performance, mobile, static versioned data, conventions). In addition:

- **Evidence hierarchy** (above). No number reaches the simulation without a tier and a source. A tier-3 or tier-4 number is never presented as data.
- **Determinism.** The same `datasetVersion` and seed always give the same future, on every machine. The representative seed is chosen deterministically: the run whose final `completedNet` is the median of the N band runs.
- **Honesty of numbers.** The mode is labelled a *simulation*. The scoreboard shows the shown run and the p10–p90 band. Pipeline and new-FZP units are separate lines. Actual completions since the RHNA period start are counted and labelled as actual. Units lost to dead projects are shown.
- **Time scrubbing performance.** At 60 fps on a 2022-era laptop with the whole city's timeline loaded, per-frame JS during scrub or playback is O(1) in project count. A reroll reaches a full new timeline (the shown run, to 2050) within 3 s off the main thread. The p10–p90 band may fill in progressively afterwards; the UI marks it as provisional until it is complete.
- **First paint.** `/fzp` must not require loading every parcel chunk. The whole-city score comes from `parcels.bin`, `projects.json` and `calibration.json`. Geometry streams with the viewport, as on `/`.
- **The editor is unchanged.** `/` and `/p/:id` behave exactly as before. FZP mode is additive.
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

### 4.1 Host: a separate module behind the same Worker (decision)

Scenario mode gets its own host, `createScenarioHost(deps)` in `src/lib/sim/scenario/scenario-host.ts`. It is not a set of branches inside `createSimHost`, for three reasons:

- The editor host is shaped by plan ops: its state (`host.ts:67-82`) holds plan, committed, preview and opCells. None of that applies to a citywide scenario.
- Its `dispatch` switch ends in `never` exhaustiveness (`host.ts:452`), and `SimClient.#receive` ends the same way (`client.ts:214`). Adding scenario variants to `SimRequest`/`SimResponse` would force edits to both.
- The design rule "the editor is unchanged" is easiest to prove when `host.ts`, `display.ts` and `client.ts` have no diff at all.

**Routing.** `worker.ts` becomes a router.

- It creates the editor host eagerly, exactly as today (`worker.ts:10-17`), and creates the scenario host on the first `initScenario`.
- `init`, `load`, `preview`, `cancelPreview`, `commit` and `undo` go to the editor host.
- `initScenario` and `reroll` go to the scenario host.
- `prefetch`, `retryChunks` and `parcelSummary` go to whichever host received the most recent `init`/`initScenario`. Before either has arrived, they go to the editor host, which is today's behaviour.
- An `init` disposes the scenario host's state, and an `initScenario` disposes the editor host's state. Each page spawns its own worker in practice, so this switching is defensive.
- The router contains no other logic.

**Shared parts.** The scenario host reuses these unchanged:

- `createChunkLoader` and `cellsIntersecting` (`chunks.ts:54`, `chunks.ts:191`);
- `checkManifestShape` (`manifest-shape.ts`);
- `createLru` (`lru.ts:19`);
- `fnv1a32` (`generator/seed.ts:4`);
- `ReadyResponse`, `ChunksResponse` and `ErrorResponse`.

**Main thread.** `ScenarioClient` in `src/lib/sim/scenario-client.ts` is modelled on `SimClient`: it keeps the rev counter, crash handling, `restart`/`dispose` and the pending summary promises. Its API:

- `initScenario(manifest, horizon, seed = null): Rev` and `reroll(seed): Rev` both set the barrier rev.
- `isStale(t)` is true when `t.rev` is below the barrier.
- `resync()` sends one `reroll(currentSeed)` per episode, where `currentSeed` is the `seed` of the latest accepted timeline. It is called on a T7 revision gap.
- `parcelSummary(parcelId, day?)`.
- Events: `onReady`, `onTimeline`, `onChunks`, `onError` and `onCrash`.
- It never auto-resyncs on an `error`, unlike `SimClient` (`client.ts:209`).

### 4.2 Data loading

1. **Validate the request.**
   - `scenario` must be `'fzp'`.
   - `seed` must be `null` or an integer in [0, 2³²).
   - `horizon` must be an integer.
   - Otherwise the host posts `error` `bad-request`.
2. **Validate the manifest.** It must pass `checkManifestShape`. In addition, `manifest.scenarios?.fzp` must have `parcels`, `projects` and `calibration` as strings starting `/data/<datasetVersion>/`. Otherwise the host posts `error` `manifest-invalid` with the message `dataset <v> has no fzp scenario`. This depends on scenario-data adding `scenarios` to `ManifestBaseSchema` (`manifest.ts:43`): zod strips unknown keys, so without it the field never reaches the worker.
3. **Start.** Any prior scenario state is disposed and the host posts `ready` `{ rev, datasetVersion, chunkCount }`.
4. **Fetch.** The three files are fetched concurrently: `parcels.bin` through `deps.fetchBytes`, because `FetchLike` has only `json()` (`chunks.ts:10`), and the two JSON files through `deps.fetch`. Each is retried on the `retryDelaysMs` schedule, which defaults to 1, 4 and 16 s (`host.ts:60`).
   - When retries are exhausted, the host posts `error` `internal` with the message `scenario fetch failed: <url> (HTTP <status>)`.
   - The files are immutable per version (`docs/dev/data-serving.md`), so they are fetched once per `initScenario` and never re-fetched on `reroll`.
5. **Decode and validate.**
   - `parcels.bin` goes through the scenario-data `sfh-scenario/1` decoder.
   - `projects.json` and `calibration.json` go through `shape.ts`. The checks: `schema === 1`; integer days; every cumulative table non-decreasing with `advance + Σexit ≤ 1 + 1e-9`; tail hazards in [0, 1] with their sum ≤ 1; probability vectors summing to 1 ± 1e-6; `fillLevels.length === F` of the parcels' yield; and C11.
   - Any failure posts `error` `manifest-invalid` with the message `scenario <file>: <first problem>`.
   - `projects.asOf ≥ horizon` posts `bad-request`.
   - **`asOf` comes from `projects.json`.** If `calibration.asOf` differs, the run continues and the worker logs one warning.
6. **Precompute once per `initScenario`.** This is pure in `SimInput`, keyed by object identity, and never module-global:
   - each parcel's monthly hazard `h` and its `log1p(−h)` (Float64Array);
   - each parcel's renormalised size distribution (§4.5.6);
   - the risk set blocked by in-flight projects.

**Geometry** is generated only for projects anchored in a cell the loader has made ready.

- Chunks are requested only through `prefetch` (viewport), exactly as on `/`. There is never an all-chunk load.
- A project's **anchor** is the smallest `ParcelId` (string order) among its parcels that are present in `parcels.bin`. Its cell is that parcel's T11 `cellId`.
- A project with no parcel in `parcels.bin` is scored but has no geometry (C4). The worker logs the count once.
- For a multi-parcel project, the host also `want`s the cells of its other parcels. It packs the project when all of them are ready, so `generateForUnits` gets every `ParcelRecord`.

### 4.3 Time (T1)

`day.ts` exports these helpers:

- `dayOf(y, m, d)`, built on `Date.UTC`, and `isoOf(day)`;
- `MONTH_DAYS = 365.2425 / 12 = 30.436875`, the definition of a month (not evidence; must match stage-calibration, C5);
- `monthsBetween(asOf, horizon)`.

`TimelineScore.months` runs from the 1st of the calendar month after `asOf` to the 1st of the month after `horizon`, inclusive.

- For `asOf` 2026-10-16 and `horizon` 2050-12-31 that gives 291 entries, 2026-11-01 … 2051-01-01. The last entry carries the end-of-horizon state.
- The value at `months[i]` counts every event with `day < months[i]`.

All schedule events in the future satisfy `asOf < day ≤ horizon`. Observed history days are ≤ `asOf`; a history day after `asOf` is clamped to `asOf`.

### 4.4 Determinism: RNG, stream splitting, deterministic math

**Counter-based draws** come from `rng.ts`. They are stateless, so a draw depends only on its key. Each draw is

`u = (H + 0.5) / 2³²`, which lies in (0, 1),

where `H` is computed as follows:

```
H = fmix32(seed ^ 0x5bd1e995)
H = fmix32(H ^ entity)
H = fmix32(H ^ imul(k + 1, 0x9e3779b1))
H = fmix32(H ^ ((purpose << 8) | stageIdx))
```

- `fmix32` is MurmurHash3's finalizer, written with `Math.imul` and `>>>`. These are integer operations only, so the result is bit-identical in every engine, like `mulberry32` at `seed.ts:29`.
- **`entity`** is `fnv1a32('p:' + parcelId)` for a simulated project, or `fnv1a32('j:' + projectId)` for a pipeline project.
- **`k`** is the initiation index on the parcel (0, 1, …). It is 0 for pipeline projects.
- **`purpose`** is one of: `INIT=1`, `INIT_DAY=2`, `PATHWAY=3`, `PPA=4`, `SIZE=5`, `STAGE=6`, `STAGE_DAY=7`, `REV=8`, `REV_RATIO=9`.
- **`stageIdx`** is the `STAGE_ORDER` index of the stage being left (for `STAGE`/`STAGE_DAY`) or entered (for `REV`/`REV_RATIO`). It is 0 otherwise.

Consequences:

- A project's schedule depends only on the seed, its own entity key and the calibration. Adding, removing or reordering unrelated parcels or projects changes nothing. A property test enforces this.
- Changing the revision model never shifts a stage draw, and vice versa.

**Deterministic transcendental functions.** `Math.log`, `Math.exp` and `Math.log1p` are not specified to be correctly rounded, and engines may differ in the last ulp (inferred from ECMA-262 §21.3.2, "implementation-approximated"). So the whole schedule path (hazard, geometric inversion, tail powers) uses `detmath.ts`. It holds ports of fdlibm `e_log.c`, `s_log1p.c` and `e_exp.c`, built from `+ − × /` only, which IEEE-754 defines exactly. Golden vectors pin them. `chanceTable` uses arithmetic only.

### 4.5 `simulate(input, seed, horizon)` exactly

The output is `Schedule[]`, sorted with pipeline schedules first, then simulated, each group by `projectId` ascending. Simulated ids are `sim:<parcelId>:<k>`.

#### 4.5.1 Stage order and next stage

`nextStage(pathway, s)` follows `STAGE_ORDER`:

- `preApplication` goes to `filed`, or to `permitFiled` for `permitOnly`;
- `filed` → `entitled` → `permitFiled` → `permitIssued` → `construction` → `complete`.

#### 4.5.2 Sampling one stage (T4 semantics)

Notation:

- `M = t.months`;
- `A(m)` and `E_r(m)` are the cumulative tables, with `A(0) = 0`;
- `F(m) = A(m) + Σ_r E_r(m)`;
- reasons are taken in ExitReason declaration order: withdrawn, disapproved, cancelled, expired.

`sampleStage(t, u)` works in three cases:

- **Within the table** (`u ≤ F(M)`). The event month `m` is the smallest `m` with `F(m) ≥ u`. The increment `(F(m−1), F(m)]` is split in order into `ΔA(m)`, then each `ΔE_r(m)`. The segment that contains `u` gives the event.
- **In the tail** (`u > F(M)`). Let `λ = tail.advance + Σ tail.exit[r]`.
  - If `λ = 0`, it returns `null`: the project never leaves.
  - Otherwise let `v = (u − F(M)) / (1 − F(M))`. The tail month is `k = max(1, ⌈log1p(−v) / log1p(−λ)⌉)` and the event month is `M + k`.
  - The event type comes from the residual `w = (v − (1 − (1−λ)^(k−1))) / ((1−λ)^(k−1) λ)`, clamped to (0, 1]. It is split by `tail.advance/λ`, then each `tail.exit[r]/λ`.
- **In-flight conditioning.** `sampleStageGiven(t, s, u)` is used when a project has survived `s` whole months.
  - If `s < M` and `F(s) < 1`, it returns `sampleStage(t, F(s) + u·(1 − F(s)))`.
  - Otherwise the tail is memoryless: it uses the tail branch with `v = u`, and the event month is `s + k`.

**Day of the event.** For an entry day `e`, event month `m` and `v_d = draw(STAGE_DAY)`, the event day is `e + ⌊(m − 1 + v_d)·L⌋`.

For the conditioned first event of an in-flight project, when `m = s + 1`, the day is drawn instead as `lo + ⌊v_d·(hi − lo)⌋`, with:

- `lo = asOf + 1`;
- `hi = max(lo + 1, e + ⌊m·L⌋)`.

That makes the day uniform over the rest of the current month.

**What the event does.**

- An event day after `horizon` ends the schedule as `{ kind: 'open' }`.
- An exit ends it as `{ kind: 'exit', stage: s, reason, day }`.
- An advance sets `entered[next] = day`. If `next` is `complete`, it ends as `{ kind: 'complete', day }`.

#### 4.5.3 Pipeline projects (in-flight conditioning)

For each InFlightProject (T3):

- **Rejected projects.** `stage === 'complete'`, or `permitOnly` at `filed`/`entitled`, is skipped. The skip is counted and logged once.
- **Entered days.** `entered` is `history` (clamped to `asOf`).
- **Current-stage entry day.** `e = history[stage]` if present. Otherwise `e = asOf` and `entered[stage] = asOf`; the draw is then unconditioned, and the card marks the stage `actual: false`.
- **Months survived.** `s = ⌊(asOf − e) / L⌋`.
- **First draw.** `sampleStageGiven(t, s, draw(STAGE, stageIdx))` with `t = transitions[pathway][stage]`, then ordinary `sampleStage` for every later stage.
- **Initial revision.** `revisions[0] = { day: min(entered), units, stories: stories ?? 0 }`. `0` means unknown (C2).
- **Existing units.** `existingUnits` comes from T3.

OD-T5 applies: pipeline projects face the same tables and can die.

#### 4.5.4 Revisions (T4c)

A revision is considered on entering a stage `n` in the future that comes before `construction` in `STAGE_ORDER` and is not the project's first stage.

1. **Trigger.** It uses the first `at` entry with `stage === n`. If `draw(REV, n) < probability`, a revision happens.
2. **Ratio.** One uniform, `draw(REV_RATIO, n)`, picks histogram bin `i` from the normalised `probs`. Its residual `w` places the ratio uniformly in `[edges[i], edges[i+1])`.
3. **Units.** `units' = max(1, round(ratio × units))`, then capped:
   - **simulated:** `units' ≤ yield[F−1]`;
   - **pipeline:** `units' ≤ max(units, Σ yield[F−1])` when all its parcels are in `parcels.bin`, and uncapped otherwise. The cap never forces a downsize.
4. **Stories.**
   - **Simulated:** the stories of the smallest fill level `f` with `yield[f] ≥ units'`.
   - **Pipeline:** if `stories > 0`, `max(1, round(stories × units'/units))`. When upsizing, this is capped at `max(stories, max FZP envelope of its parcels in parcels.bin)`. If `stories = 0` it stays 0.
5. **Recording.** If `units' === units`, nothing is recorded. Otherwise `{ day, units', stories' }` is appended to `revisions`.

There are never revisions on or after `entered.construction`.

#### 4.5.5 Construction (demolition) and net units

- **Demolition day.** `entered.construction` is the demolition day of every parcel of the project. That includes pipeline projects already under construction, whose demolition day lies in the past, so the existing building stays hidden for all `t ≥ asOf`.
- **Net units.** Existing units are subtracted at the construction day, but only when that day is after `asOf` (C6). The final revision's units are added at the completion day.
- **Every simulated project replaces the existing building** and subtracts the parcel's `existingUnits` (C8).
- **Death after construction starts.** A project that exits from `construction` keeps its subtraction and adds nothing.

#### 4.5.6 Initiation (T4a, T4b) and the risk set

**Hazard.** For each parcel, `h = 1 / (1 + exp(−(intercept + Σ coef[bin])))`, where:

- `bin` is the largest `i` with `bins[i] ≤ x`, or 0 if `x < bins[0]`;
- for `landUseClass`, `x` is the category index;
- a NaN feature contributes 0 (C5);
- the FZP-envelope variants of `potentialRatio` and `storiesGap` are used.

**Size distribution.** The `byEnvelope` bucket is the first one with `maxStories ≤ maxStoriesUpTo`, or the last bucket. It is restricted to levels with `yield[f] > existingUnits` and renormalised. If no level qualifies, `h := 0`. This is a structural rule: a net-negative or no-gain project is not a housing filing, and Planning's soft-site rule likewise requires capacity well above existing units (literature doc §3). It is not a number.

**Initiation time** (inverse CDF, not per-month Bernoulli). The hazard is constant per parcel, so the first initiation month after a risk start `r` is geometric:

- `T = ⌈log1p(−u) / log1p(−h)⌉ ≥ 1`, with `u = draw(INIT, k)`;
- the day is `r + 1 + ⌊(T − 1 + v)·L⌋`, with `v = draw(INIT_DAY, k)`;
- a day after `horizon` means no initiation.

This costs one draw and one division per parcel per run, against about 291 Bernoulli draws per parcel.

**A new project.**

- **Pathway:** `draw(PATHWAY)` over the normalised `pathwayForNew` (T9 hook: Local Program parcels use the same shares).
- **First stage:** `preApplication` if `draw(PPA) < ppaShare[pathway]`. Otherwise `filed`, or `permitFiled` for `permitOnly`.
- **Size:** `draw(SIZE)` picks fill level `f`, giving `stories = max(1, round(fillLevels[f] × envelope.maxStories))` and `units = yield[f]`.
- **Initial revision:** `revisions[0] = { day, units, stories }`.

**Risk set.** The design's T4a rule is "not at risk until that project ends".

| Parcel state | At risk? |
|---|---|
| Free at `asOf` | yes, from `r = asOf`, k = 0 |
| In an in-flight project | no, until that project ends; if the parcel is in several, until the last ends |
| After a project **exits** at day x | yes again, from `r = x`, k + 1 |
| After a project **completes**, or is still open at the horizon | no, for the rest of the horizon |

Not re-initiating after completion is a decision, made for four reasons:

- The hazard's features describe the old building: `yearBuilt`, `existingUnits`, `potentialRatio`, `storiesGap` and `improvementShare` all change on completion. Re-evaluating the hazard against an imagined new building has no tier-0–2 support.
- A just-completed building has `improvementShare` near 1 and `storiesGap` near 0, which the fitted hazard would put at its minimum anyway.
- The longest remaining span after any completion is under 24 years, while building lifetimes far exceed that.
- SF's residential demolitions average about 0.02 %/yr of stock (literature §3), so new buildings are essentially never redeveloped within the horizon.

Re-initiation after an exit *is* modelled, because the parcel is unchanged.

#### 4.5.7 Purity

`simulate` reads every behavioural number from `input.calibration` and `input.parcels` (T9). The only constants are the definitions `L`, `STAGE_ORDER`, the reason order and the purpose codes.

`simulateNet` is the schedule-free fast path used for band runs. It allocates no Schedule objects. It must equal `score(simulate(...)).shown[i].completedNet` exactly, and a property test checks this.

### 4.6 `chanceTable` (T12)

For each pathway and non-`complete` stage, the table has length `M + 1`. Index `m` is the probability of eventually reaching `complete` after surviving `m` whole months in the stage:

- for `m < M` with `F(m) < 1`: `P(m) = [(A(M) − A(m)) + (1 − F(M))·τ] / (1 − F(m)) × P_next`;
- otherwise: `P(m) = τ·P_next`.

The terms:

- `τ = tail.advance / λ` (0 when `λ = 0`);
- `P_next` is index 0 of the next stage's table;
- `P_next = 1` when the next stage is `complete`.

Callers use index `min(⌊daysInStage / L⌋, M)`. The function is pure, arithmetic-only and Float32. The main thread fetches `calibration.json` itself, for this and for the provenance panel; T6 does not carry the calibration.

### 4.7 Score (T8)

All values are computed from schedules alone, with no geometry, as prefix sums of per-month deltas.

**`shown[i]` fields.** Let `idx(d)` be the first `i` with `months[i] > d`.

| Field | Contribution |
|---|---|
| `completedNet` | `= completedNetPipeline + completedNetNew` |
| `completedNetPipeline` / `completedNetNew` (by origin) | `+units_final` at `idx(complete)`; `−existingUnits` at `idx(construction)` when construction is after `asOf` |
| `inProgress[s]` | units of the revision current at instant `months[i]`, summed over projects with `entered[s] < months[i]` whose next event is on or after `months[i]` |
| `exitedUnits` | cumulative units at exit, for exits after `asOf` |

`shown` excludes the baseline.

**`baseline`** is `projects.json` `rhnaCompletedNet`: `{ completedNet: units, since, provenance }`, passed through unchanged.

**`targets`**: one entry per `M1_TARGETS` entry (`targets.ts:11`): `rhna` 82,069 and `rhna-buffer` 94,379.

- `deadline = dayOf(2031, 1, 31)`. The source is partner ruling OD-T4, which matches the end of the 2023–2031 Housing Element period (inferred). The `Target` I11 type has no deadline field, so the deadline lives here.
- `fraction[i] = (baseline.completedNet + shown[i].completedNet) / target.units`, uncapped.

**`references`** has three entries, all tier 1 as instructed (see C7). Each label names its comparison basis: new FZP-enabled units, not totals.

| id | label | units | by | source |
|---|---|---|---|---|
| `planning-citywide` | "SF Planning: ~39,000 expected net approvals from the rezoning, remaining RHNA period (citywide method)" | 39000 | `dayOf(2031,1,31)` | https://sfplanning.org/sites/default/files/documents/citywide/fzp_land_use_committee_presentation-111725.pdf |
| `controller-high` | "Controller's Office of Economic Analysis: 14,646 additional units by 2045 (high growth)" | 14646 | `dayOf(2045,12,31)` | https://www.kqed.org/news/12062042 |
| `controller-low` | "Controller's Office of Economic Analysis: 8,504 additional units by 2045 (conservative)" | 8504 | `dayOf(2045,12,31)` | https://www.kqed.org/news/12062042 |

- The Planning figure was verified by fetching the deck: slide 6, "Expected Net Approvals from Rezoning 39,000", "% entitled in remaining RHNA period (5 yrs) 5%".
- The Controller figures were verified by fetching the KQED article (2025-10-29, "over the next 20 years").
- For the Controller entries, `by` is inferred as October 2025 plus 20 years, rounded to the end of 2045.
- Each `method` gives the source's own method sentence:
  - **Planning:** "22% of zoned capacity entitled 2005–2023 (~1%/yr) applied to the 780,000-unit capacity increase".
  - **Controller:** "beyond what existing zoning might produce".

### 4.8 Band runs, seeds and the representative seed

- **N = 101 band runs** (`bandRuns` dep for tests). This is tier 4, a numerical-method choice, not evidence: it changes no expected value, only noise.
  - **Why 101:**
    - It is odd, so the median is one run, which the representative-seed rule needs.
    - The rank standard error of an estimated p10/p90 is `√(0.1·0.9/101) ≈ 0.03`, so the band edge sits between about the true p7 and p13. That is adequate for a shaded band.
    - At the 15 ms/run budget, 101 runs take about 1.5 s, inside the 3 s first-timeline budget. 201 runs would cost about 3 s for a √2 noise reduction.
- **Band seeds:** `bandSeed(i) = i + 1` for `i = 0…100`, fixed and independent of the dataset. The future still varies by dataset, because the inputs differ.
- **Quantiles** are nearest-rank over the runs folded so far (`n`): `p_q = sorted[⌈q·n⌉ − 1]`. For `n = 101` that is p10 = sorted[10], p50 = sorted[50] and p90 = sorted[90], computed per month over `completedNet`.
- **Representative seed** (used when `seed === null`): rank the 101 runs by their final-month `completedNet` ascending, breaking ties by lower `i`, and take the run at rank 50. Its final value equals the band's final p50 exactly. At earlier months it need not equal p50, and that is not a bug.
- **The band depends only on the dataset.** So `reroll` reuses it, and the shown run of a reroll is not added to the band.

### 4.9 Timeline messages and timings

**`initScenario` with `seed: null`:**

1. The host posts `ready`.
2. After the fetches, it runs the band in slices of at most 50 ms wall time each, separated by `setTimeout(0)`. Between slices, `prefetch` and `parcelSummary` are served. Nothing is posted yet, because the representative seed needs all 101 runs.
3. It runs `simulate` with the representative seed, then posts revision 0 with `complete: true`.

**`initScenario` with a seed** (for example, a crash restart):

1. The host runs the shown run first and posts revision 0 with `complete: false`. Its `band` holds the quantiles of the runs folded so far; with 0 runs, the arrays are empty.
2. The band then streams. A band-only timeline message (no cells, empty `demolish`) is posted after each 16 runs folded.
3. The last message has `complete: true`.

**`reroll(seed)`:**

- Pending geometry work for the old seed is cancelled.
- The host posts revision 0 for the new seed under the reroll's `rev`.
- `complete` is true if the band is done.
- `reroll` before `initScenario` has finished loading posts `bad-request` with the message `not initialised`.

**Revision rules.** These apply per `(rev, seed)`.

- **Revision 0 is a snapshot.** It replaces every cell and the whole demolish set.
  - It is posted when all ready anchored cells are packed, or 2.5 s after the request arrived, whichever comes first. The remaining cells follow in later revisions.
- **Revision n > 0** adds or fully replaces the cells it lists and appends to `demolish`.
  - `removedCells` is always `[]` in this mode.
  - Each chunk that becomes ready produces one timeline message per 50 ms slice of packing.
- **Demolish entries travel with geometry.** They are sent in the same message as the anchor cell of the project. So an existing building is never hidden before its project's geometry exists.
- **Score.** Every message carries the same full `TimelineScore` for its seed. That is 291 months, under 64 KB as structured clone.

**`complete`** means "the band has all N runs". It does not depend on geometry. Chunk progress is reported through the existing `chunks` responses, which come from the shared loader.

### 4.10 Geometry, memo and packing (T7)

**Massing per revision `k`:**

- **Simulated:** `generate(rec, { maxStories: stories_k }, fnv1a32(rec.id), 'max')`. This is the same seed rule as the editor (`host.ts:147`). Memo key: `s|<parcelId>|<stories>`.
- **Pipeline:** `generateForUnits(records sorted by id, units_k, maxStories, fnv1a32(projectId), stories_k > 0 ? stories_k : undefined)`, where `maxStories` is `max(stories_k, max FZP envelope of its parcels in parcels.bin)`, or `MAX_STORIES` = 80 (`constants.ts:27`) when both are 0. Memo key: `p|<projectId>|<units>|<stories>`.

**Memo.** Keys describe content, not seeds. So rerolls and repeated cells hit the memo, and every pipeline project without revisions hits across all seeds.

- The memo is `createLru(60_000)`. The cap is an engineering budget, tier 4. The per-entry cost is ≈0.8–1.0 KB, measured at `host.ts:50-56`, so the memo is at most about 60 MB.
- A throwing generator gives `null` for that revision and is logged once per project, as `host.ts:149` does.

**`packTimedCell(cellId, items)`:**

- **Slot order.** One slot per project with at least one non-null building. Slots are sorted by anchor ascending, then first entered day, then `projectId`. `parcelIds[slot]` is the anchor, and duplicates across slots are allowed (C10).
- **Parts.** Each revision's parts use the same ring normalisation and same-tone merge as `packCell` (`pack.ts:27-88`). That code is factored into one shared helper; `packCell`'s output stays byte-identical.
- **`partWindow`** for a part of revision `k` is `[revisions[k].day, revisions[k+1]?.day ?? Infinity)`.
- **`slotStages`** has `7 × slots` entries: `entered[STAGE_ORDER[j]]`, or NaN.
- **`slotEnd`** is `[day, 0|1|2]`. An open schedule uses `[NaN, 0]`.
- **`slotPathway`** indexes `['discretionary','streamlined','permitOnly']`.
- **`parcelMeta`** is `[units, existingUnits, stories, typologyIdx]` of the last revision with a building. When the schedule's stories are 0, `stories` comes from the building.
- **Transfer.** Every typed array is transferred, as `packTransferables` already does (`pack.ts:165`).

All days are integers below 2²⁴, so they are exact in Float32 (T1).

### 4.11 `parcelSummary` → `ProjectCard`

**Null result.** If the parcel's record is not loaded, the summary is `null`. This is the "never fetches" rule of `host.ts:401`.

**Project choice.** The candidates are the shown-run schedules whose `parcelIds` include the parcel.

- **With `day`:** pick the candidate with the latest first entered day that is ≤ `day`. If none has started, no project is returned.
- **Without `day`:** pick the latest-started candidate (C1).

**ParcelSummary fields:**

- `neighborhood`, `landUse`, `eligible` and `existingUnits` come from the record.
- `envelope` is the FZP envelope from `parcels.bin`, or `null`.
- `generated` is the chosen project's building at the selected revision, or `null`.
- `project` is the ProjectCard.

**ProjectCard fields:**

- **`label`:** `Block <B> Lot <L>` of the anchor. The block is the first 4 characters plus a following letter if there is one; the lot is the rest. So `0026T001A` gives "Block 0026T Lot 001A", and `3512008` gives "Block 3512 Lot 008" (formats verified in `fixture-0` and by a live DataSF query of `mapblklot`).
- **`units` and `stories`:** from the revision current at `day`, or the last revision when there is no `day`.
- **`stages`:** every entered stage, in `STAGE_ORDER`. `actual` is true only for a pipeline history day ≤ `asOf`.
- **`revisions`, `end` and `sources`:** from the schedule. `sources` is `[]` for simulated projects.

The card carries the whole schedule, including future events. Which of those to reveal is up to fzp-mode (open question Q1).

### 4.12 Error states

| condition | response |
|---|---|
| bad seed, horizon or scenario; `reroll` before load; `asOf ≥ horizon` | `error` `bad-request` |
| manifest shape bad or no `scenarios.fzp` | `error` `manifest-invalid` |
| scenario file fails decode or `shape.ts` | `error` `manifest-invalid`, message `scenario <file>: …` |
| scenario fetch fails after retries | `error` `internal`, message `scenario fetch failed: …` (fzp-mode offers Retry, which resends `initScenario`) |
| one project invalid (§4.5.3) | skipped; one aggregated `console.warn`; no error |
| generator throws or returns null | that revision has no geometry; still scored |
| chunk fails | existing `chunks` report and `retryChunks`, unchanged |
| worker crash | `ScenarioClient.onCrash`; page restarts and re-inits with the current seed |

### 4.13 Performance budgets

These are engineering budgets (tier 4), checked in `scenario.bench.spec.ts`. The bench uses the `host.bench.spec.ts` synthetic city: 150,360 parcels in 16×16 cells, plus 2,000 synthetic pipeline projects and a bench calibration tuned to give about 8,000 initiations by 2050.

| Budget | Limit |
|---|---|
| `simulateNet`, one run, median | ≤ 15 ms |
| `simulate` + `score` | ≤ 80 ms |
| `initScenario(null)` after fetch → first timeline, with no chunks ready | ≤ 3 s |
| `reroll` → revision 0, with 64 cells ready and a warm memo | ≤ 3 s |
| `reroll` → revision 0, cold | ≤ 3 s, the 2.5 s geometry cap included |
| Longest worker macrotask during band or geometry work | ≤ 50 ms |
| Worker heap growth with all 256 cells loaded after 3 rerolls (`process.memoryUsage().heapUsed` delta) | ≤ 300 MB |
| Main-thread cost per timeline message | structured clone only; `setTime` never messages the worker |

### 4.14 Numbers this spec introduces

| number | value | tier | source |
|---|---|---|---|
| month length `L` | 30.436875 d | definition | Gregorian mean year ÷ 12 |
| band runs N | 101 | 4 (numerical) | §4.8 |
| band seeds | 1…101 | definition | §4.8 |
| RHNA deadline | 2031-01-31 | 1 | partner ruling OD-T4; RHNA Primer (`targets.ts:5-8`) |
| references | 39,000; 14,646; 8,504 | 1 (as instructed; C7) | §4.7 |
| reference `by` dates | 2031-01-31; 2045-12-31 | 1 / inferred | §4.7 |
| memo cap | 60,000 | 4 (engineering) | `host.ts:50-56` per-entry measure |
| slice, revision-0 cap, band post cadence | 50 ms, 2.5 s, 16 runs | 4 (engineering) | §4.9 |
| budgets | §4.13 | 4 (engineering) | §4.13 |

No model parameter of tier 3 or 4 is introduced. Every behavioural rate comes from `calibration.json`.

## 5. Seams

- **T9 policy levers.** This spec keeps the seam open with three things only:
  - `simulate` takes all behaviour from `SimInput` (§4.5.7);
  - precomputation is keyed by `SimInput` identity, never held in module state;
  - the host builds `SimInput` in one function, `buildSimInput(files)`, which is the single place a future `PolicyOp[]` would be applied.

  No `PolicyOp` type, UI or hook is added. A test proves that calibration edits alone change outcomes: zeroing every exit table gives no exits, and zeroing the hazard gives no simulated projects.
- **Addenda sub-stages.** The sampler and the packer iterate `STAGE_ORDER` and `nextStage` generically. `slotStages` is sized `STAGE_ORDER.length × slots`. Nothing else.
- **DA phasing.** Multi-phase pipeline rows run through the ordinary tables (design §Out of scope). Nothing else.
- **Renderings.** Massing goes through one function, `massingFor(schedule, k, records)` (§4.10), so a later rendering source can substitute there. Nothing else.

## 6. Testing

Every test calls `expect` (`expect.requireAssertions`, `vite.config.ts:15`).

**Fixtures** (in `src/lib/sim/scenario/fixtures/`):

- `mini-calibration.ts`: hand-made tables for all three pathways. Months 1–24, round numbers, plus tail.
- `mini-parcels.ts`: 60 parcels encoded with the scenario-data encoder.
- `mini-projects.ts`: 12 in-flight projects, covering every stage, both multi-parcel and missing-day cases, and one invalid project.
- `synth-city.ts`: for the bench.
- `fixture-0`: gains mini `scenarios/fzp/*`, produced by the three pipeline subsystems; e2e uses them.

**Vitest server project:**

- `detmath.spec.ts`: golden vectors for log, log1p and exp at 200 points, matched against fdlibm values within 0 ulp. Relative error against `Math.*` is below 1e-15.
- `rng.spec.ts`: golden `u` values for fixed keys. A chi-square test over 10⁶ draws (p > 0.001). Distinct purposes are uncorrelated (|r| < 0.005).
- `stage-sampler.property.spec.ts` (fast-check), over random valid Transitions with K = 20,000 entries:
  - **Per-stage death rates (acceptance):** the empirical cumulative incidence of advance and of each exit at each month is within 4·SE of the table, as is the tail incidence beyond `M`.
  - **Conditioning:** given `s` months survived, it matches `(F(m) − F(s)) / (1 − F(s))`.
  - With `λ = 0`, unresolved entries never leave.
- `hazard.spec.ts`: bin edges, the categorical index, NaN contributes 0, and the logistic matches a hand calculation.
- `simulate.spec.ts` (mini fixtures):
  - **Purity and determinism:** `simulate` is deterministic, and its output is equal after a JSON round trip of the input.
  - **Ordering and staging:** revisions ascend with none on or after construction; no `permitOnly` project ever has `filed` or `entitled`; every future event is in `(asOf, horizon]`.
  - **Pipeline starting state:** history days are preserved; a missing-day stage gets `asOf`; the invalid project is skipped.
  - **Risk set:**
    - no re-initiation after completion;
    - re-initiation after an exit starts after the exit day;
    - parcels in a pipeline project are not at risk until it ends.
  - **Caps:** the size draw never picks a level with `yield ≤ existingUnits`; caps hold.
- `simulate.property.spec.ts`:
  - **Stream isolation:** adding or removing unrelated parcels or projects, or shuffling the input order, leaves every other schedule identical.
  - **Fast path:** `simulateNet` equals `score(simulate(...))` for 50 seeds.
- `initiation.property.spec.ts`: across 2,000 seeds on a single parcel with hazard `h`, the first-initiation month distribution matches the geometric within 4·SE.
- `chance.spec.ts`: matches a Monte-Carlo estimate from `stage-sampler` within 0.01. Monotone where the table implies it. Index beyond `M` equals the tail value.
- `score.spec.ts`:
  - hand-computed months, deltas, `inProgress`, `exitedUnits`, origin split, target fractions with the baseline, the deadline, and the three references verbatim;
  - month count 291 for the design dates;
  - pre-`asOf` construction does not subtract.
- `band.spec.ts`: nearest-rank quantiles, the representative rank-50 rule with tie-break, and partial bands with `n < N`.
- `card.spec.ts`: label parsing (`0026T001A`, `2999A019`, `3512008`); day-based and day-less selection; `actual` flags.
- `shape.spec.ts`: each rejection rule, including C11.
- `pack-timed.spec.ts`:
  - `partWindow`, `slotStages` (NaN for never), `slotEnd`, `slotPathway` and slot order;
  - duplicate anchors allowed;
  - `packCell` golden output unchanged (`pack.spec.ts` passes untouched).
- `scenario-host.spec.ts` (harness modelled on `src/lib/sim/test/harness.ts`, with a fake clock):
  - **Sequencing:** `ready`, then the first timeline; null-seed `complete: true`; seeded init streams the band (`complete: false`, then true); `reroll` reuses the band; stale revs; revision 0 snapshot then increments.
  - **Geometry and loading:** demolish travels with cells; multi-parcel waits for all cells; memo hits on reroll.
  - **Failures:** every row of §4.12; slices ≤ 50 ms on the fake clock; `prefetch` served mid-band.
- `worker-router.spec.ts`: editor requests reach `createSimHost` unchanged, scenario requests reach the scenario host, and the shared requests follow the last init.
- `scenario-client.spec.ts`: the barrier, `resync` sends one `reroll` with the current seed, no resync on error, and crash/restart.
- `scenario.bench.spec.ts`: the §4.13 budgets (fails above budget).
- Existing `host*.spec.ts`, `client.spec.ts` and `display.spec.ts` pass with no edits. That is the editor-unchanged proof.

**Pipeline (`npm run test:pipeline`):** `cohort-replay.test.ts` is the "reproduces observed per-stage death rates" acceptance against real data.

- **Cohort:** for each `(pathway, stage)` with n ≥ 50 in `project-histories.json` (T4d), take every history that entered the stage within the calibration's provenance window.
- **Simulation:** run `sampleStage` from its entry day for 20 seeds, censoring each simulated event at that history's own censoring day (`end.lastObserved`, or the snapshot).
- **Comparison:** compute Aalen–Johansen cumulative incidence for each exit reason and for advance, both observed and simulated.
- **Pass bar:** max |Δ| over months ≤ max(0.03, 2.5·SE). This is a tier-4 test tolerance, not a model parameter.

**Playwright e2e** (`fixture-0` scenario files; owned jointly with fzp-mode):

- `e2e/fzp-sim.spec.ts`:
  - `/fzp` loads with no all-chunk fetch (network log shows only viewport chunks plus the three scenario files);
  - the first timeline arrives within 3 s of the scenario files on the preview server;
  - reroll changes the shown run but not the band;
  - the same seed after reload gives an identical `TimelineScore`.
- `/` and `/p/:id` existing e2e suites pass unchanged.
- The axe gate for `/fzp` belongs to fzp-mode; this subsystem adds no DOM.

## 7. Acceptance criteria

1. `simulate(input, seed, horizon)` gives deep-equal output across runs, machines and a JSON round trip of the input. Golden schedules for `mini-*` with seed 1 are committed and pass in Node and in Chromium (client project).
2. Adding, removing or reordering unrelated parcels or projects never changes another project's schedule.
3. For every Transition, the simulated cumulative incidence of each exit reason and of advance, by month, matches the table (server property test). On real data the cohort replay passes (pipeline test).
4. In-flight projects keep their observed history. Their first future event is after `asOf` and follows the conditional distribution.
5. There are no revisions on or after construction. Upsizing never exceeds the envelope cap. Every revision's units are ≥ 1.
6. Net units subtract existing units at a construction start after `asOf` and add final units at completion. `completedNet = completedNetPipeline + completedNetNew`.
7. Score values:
   - `TimelineScore.months` has 291 entries for asOf 2026-10-16 and horizon 2050-12-31;
   - targets use deadline 2031-01-31 and include the baseline;
   - `references` equals §4.7's table.
8. Band: N = 101, nearest-rank quantiles. With `seed: null` the shown run's final `completedNet` equals band p50 final.
9. `reroll` reuses the band and posts revision 0 within 3 s (bench). A seeded init marks the band provisional (`complete: false`) until it holds 101 runs.
10. Geometry exists only for anchors in ready cells. Each `(project, revision content)` is generated at most once while it stays in the memo. Demolish entries never arrive before their project's cell.
11. `packCell` output is byte-identical to before. `host.ts`, `display.ts` and `client.ts` have no diff, and their tests pass untouched.
12. Every §4.12 condition produces the stated response, and the worker stays usable afterwards.
13. The §4.13 budgets hold in `scenario.bench.spec.ts`.

## 8. Open questions

- **Q1. Should the ProjectCard reveal a project's future?** The worker sends the full schedule, and fzp-mode decides what to show. *Recommend:* show only stages with `day ≤ t`, plus the T12 chance of finishing. Revealing "this project dies in 2031" would undercut the uncertainty the band expresses.
- **Q2. Should a parcel whose project exited face the same hazard again immediately?** The design implies yes, through T4a's "until that project ends", and this spec does that. *Recommend:* keep it. stage-calibration could later measure a post-exit refiling hazard as a separate T4a term, which this spec would read without changes.
- **Q3. Should fzp-mode's reroll draw seeds from the band seeds (1…101) or from any uint32?** *Recommend:* any uint32, from `crypto.getRandomValues`. Band seeds would make "another possible future" cycle through a fixed set.
