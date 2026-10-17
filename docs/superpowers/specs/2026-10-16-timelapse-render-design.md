# timelapse-render: spec

Status: derived 2026-10-16 from [the FZP timelapse design](../design/2026-10-16-1903-fzp-timelapse.md) (approved with partner rulings; OD-T2 option A). Updated the same day to the design's "Interface reconciliation" section: rows were re-copied and every ruling was applied.

- **Owns:** T7, including `packTimedCell`, the `tl-*` tokens and `TIMELINE_LEGEND`.
- **Consumes:** T1, T2, T5, T6, T10 and T12.
- **Library versions:** citations are to the installed versions in `package-lock.json`: deck.gl 9.4.0, luma.gl 9.4.2, maplibre-gl 6.13.0. Library paths are relative to `node_modules/`.
- **`@deck.gl/extensions`** is not a dependency. Its 9.4.0 source was read from the npm tarball (`npm pack @deck.gl/extensions@9.4.0`).
- **Marks:** V = verified at the cited line; I = inferred.

## 1. Scope

From the design:

- **`timelapse-render`** (map view). Renders timeline geometry so that the state at time `t` is decided on the GPU from per-part time windows and per-project stage times, with `t` passed as a uniform. That state covers hidden, ghost, constructing, complete and dying. It draws the per-project progress bar. It hides each existing building from its project's construction start. `setTime(day)` costs O(1) JavaScript regardless of project count.

**In scope**

- `packTimedCell` (T7): pure and worker-safe, in `src/lib/map/pack-timed.ts`. The worker imports it (§4.1.1).
- `SimMapHandle.applyTimeline`, `setTime` and `setTimelineLookups`, plus `SimMapProps.timelinePick` (T7). These are implemented in `SimMap.svelte` over a new `TimelineController` (`src/lib/map/timeline-controller.ts`), which is deps-injected like `GeneratedController` (`generated-controller.ts:15-26`).
- A deck `LayerExtension`, `TimelapseExtension`, that decides each part's state at time *t* on the GPU (§4.2).
- A custom deck layer, `StageBarLayer`, for the progress bars (§4.4), and its declutter.
- Time-driven hiding of existing buildings from T7 `demolish` (§4.5).
- The `tl-*` tokens in `palette.ts` (both themes) and the exported `TIMELINE_LEGEND` (§4.6).
- The debug hook, fixtures, tests and a `bench:map` timeline case.

**Out of scope**

- Building schedules and computing `demolish` days (timelapse-sim).
- `chanceTable` and `typicalMonths` (T12, stage-calibration).
- The card's text, the legend markup, the scrubber, playback speeds and autoplay (fzp-mode).
- Any change to the editor (`/`, `/p/:id`): no new layer, paint property, request or animation there (§4.8).
- On-map text labels (OQ-1), wireframe edges (OQ-2), and screen-space collision on the GPU.

## 2. Interfaces

These rows are copied verbatim from the design's interface table (as reconciled).

| # | interface | owner → consumers | mark |
|---|---|---|---|
| T1 | `type Day = number` is integer days since 1970-01-01 UTC. All schedule times use it. It is exact in Float32. `MONTH_DAYS = 30.436875` (365.2425 / 12). `monthsIn(enteredDay, day) = floor((day − enteredDay) / MONTH_DAYS)` is the single months-in-stage rule, used by every table index (T4, T12, the bar, the card). `OPEN_DAY = 3.0e38` encodes an open-ended window end. These live in `src/lib/timelapse/time.ts` | stage-calibration → all | DC |
| T2 | `type Stage = 'preApplication' \| 'filed' \| 'entitled' \| 'permitFiled' \| 'permitIssued' \| 'construction' \| 'complete'`; `type Pathway = 'discretionary' \| 'streamlined' \| 'permitOnly'`; `type ExitReason = 'withdrawn' \| 'disapproved' \| 'cancelled' \| 'expired'`. `STAGE_ORDER` lists the stages in this order. `preApplication` is optional on every pathway. `permitOnly` projects never enter `filed` or `entitled`. A ghost is visible from the project's first entered stage | stage-calibration → project-records, timelapse-sim, timelapse-render, fzp-mode | MC (stage sequence and exits follow real records), DC (names) |
| T5 | `interface Schedule { projectId: string; origin: 'pipeline' \| 'simulated'; parcelIds: ParcelId[]; pathway: Pathway; entered: Partial<Record<Stage, Day>>; end: { kind: 'complete'; day: Day } \| { kind: 'exit'; stage: Stage; reason: ExitReason; day: Day } \| { kind: 'open' } /* still in progress at horizon */; revisions: { day: Day; units: number; stories: number \| null /* null = unknown until massed */ }[] /* [0] is the initial proposal; ascending days; none on or after entered.construction */; existingUnits: number; multiPhase: boolean }`. `simulate(input: SimInput, seed: number, horizon: Day): Schedule[]` is pure and deterministic. `SimInput = { parcels: ScenarioParcels /* decoded T11 */; projects: InFlightProject[]; calibration: Calibration; asOf: Day }`. Buildings of simulated projects carry `source: 'scenario'`, and pipeline projects carry `'pipeline'` (the sim stamps them) | timelapse-sim → timelapse-render (via T7), fzp-mode | MC (deaths, resizing, real starting state), DC (shape) |
| T6 | Worker protocol additions (I15 extended), served by a separate scenario host behind the same Worker and a separate `ScenarioClient` (the editor's host and `SimClient` are unchanged). Requests: `{ type: 'initScenario'; rev; manifest: Manifest; scenario: 'fzp'; seed: number \| null /* null = representative seed */; horizon: Day }`, `{ type: 'reroll'; rev; seed: number \| null }` (also the resync path: same seed → fresh revision-0 snapshot), and `{ type: 'parcelSummary'; reqId: number; parcelId: ParcelId; day: Day }`. Responses: `ready` (existing shape), `{ type: 'timeline'; rev; seed: number; render: TimelineUpdate; score: TimelineScore; complete: boolean /* band complete and all loaded cells packed */ }`, `chunks` (existing), and `error` with `code: 'manifest-invalid' \| 'scenario-missing' \| 'scenario-invalid' \| 'bad-request' \| 'internal'`. `parcelSummary` responds with `project?: ProjectCard`: the project on that parcel whose first entered stage is ≤ `day`, latest first, and none if no project is visible at `day`. `ProjectCard = { projectId: string; origin: 'pipeline' \| 'simulated'; label: string /* pipeline: T3 label, else 'Block B, Lot L'; simulated: always 'Block B, Lot L' */; pathway: Pathway; units: number; stories: number \| null; massing: 'matched' \| 'approximate' \| 'none'; multiPhase: boolean; stages: { stage: Stage; day: Day; actual: boolean }[] /* only stages entered ≤ day */; revisions: Schedule['revisions'] /* only those ≤ day */; end: Schedule['end'] \| null /* null if the end is after day */; sources: { dataset: string; id: string }[] }`. The card's chance to finish is computed on the main thread from T12 at the current time. `prefetch` is reused, viewport-driven at every zoom in this mode | timelapse-sim ↔ fzp-mode, timelapse-render | DC |
| T7 | `interface TimedPackedCell extends PackedCell { slotProjectIds: string[] /* render slots are keyed by project; parcelIds may repeat across slots */; partWindow: Float32Array /* per part: [fromDay, toDay) the part's revision is current; toDay = OPEN_DAY if open */; slotStages: Float32Array /* per slot: STAGE_ORDER.length entry days, NaN = never */; slotEnd: Float32Array /* per slot: [endDay, endKind] (0 open, 1 complete, 2 exit) */; slotPathway: Uint8Array /* index into ['discretionary','streamlined','permitOnly'] */ }`. `parcelMeta` rows describe the slot's final revision. `packTimedCell` is pure and owned by timelapse-render (in `src/lib/map/`); the worker imports it. `interface TimelineUpdate { revision: number /* 0 = snapshot */; cells: TimedPackedCell[]; removedCells: string[]; demolish: { parcelId: ParcelId; day: Day }[] /* complete list in revision 0 (needs no geometry); empty afterwards */ }`. `SimMapHandle` gains `applyTimeline(u: TimelineUpdate): void`, `setTime(day: Day): void` and `setTimelineLookups(l: { chance: ReturnType<typeof chanceTable>; typicalMonths: ReturnType<typeof typicalMonths> }): void`. `SimMapProps` gains `timelinePick?: (p: { projectId: string; parcelId: ParcelId; x: number; y: number; kind: 'hover' \| 'tap' } \| null) => void`. When it is set, SimMap's built-in tooltip is suppressed over timeline parts. Timeline colour tokens (`tl-*` in `palette.ts`) and an exported `TIMELINE_LEGEND` are owned here. `setTime` does O(1) JS work per call, except the existing-building catch-up, which applies at most 2,000 feature-state changes per frame until it converges | timelapse-render ↔ timelapse-sim, fzp-mode | DC |
| T12 | In `src/lib/timelapse/model.ts` (pure, zod-free, worker-safe): `sampleTransition(t: Transition, u: number, monthsElapsed: number): { kind: 'advance' \| ExitReason; days: number }`, `initiationHazard(m: InitiationModel, f: Record<FeatureId, number>): number`, `chanceTable(cal: Calibration): Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Float32Array>>>` (per month in a stage, the probability of eventually reaching `complete`; the table is 241 months long, and the tail is used beyond it), `typicalMonths(cal: Calibration): Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, number>>>` (median months to leave each stage, used for the bar's within-stage fill), and `parseCalibration(json: unknown): Calibration` (throws on schema mismatch). The pipeline's validation, the worker, the renderer (lookups uploaded once) and the card all use these, and nothing re-implements them. The bar colour and the card's "chance of finishing" both come from `chanceTable` | stage-calibration → timelapse-sim, timelapse-render, fzp-mode | MC (health = chance of finishing, OD-T2; one sampling semantics everywhere) |
| T10 | `GeneratedBuilding.source: 'user' \| 'pipeline' \| 'scenario'` (amends I9). `generateForUnits(parcel: ParcelRecord \| ParcelRecord[], units: number, maxStories: number, seed: number, stories?: number): GeneratedBuilding \| null` | pipeline-massing → timelapse-sim, map-view | DC |

### 2.1 Internal types (timelapse-render-owned; none alters a T-row)

```ts
// src/lib/map/pack-timed.ts (pure, worker-safe; imported by the worker)
export interface TimedPackInput {
  schedule: Schedule;                       // T5
  /** Index-aligned with schedule.revisions. A building, or the footprint ring (lng/lat) when
   *  the massing is 'none' (multi-phase rows, failed massing). */
  massings: (GeneratedBuilding | { footprint: [lng: number, lat: number][] })[];
}
export function packTimedCell(cellId: string, items: readonly TimedPackInput[]): TimedPackedCell;
export const FOOTPRINT_M = 1;               // height of a footprint-only ghost (tier 4)

// src/lib/map/timelapse/types.ts
export type TimelineLookups = Parameters<SimMapHandle['setTimelineLookups']>[0]; // T7
export type PartState = 'hidden' | 'planning' | 'permit' | 'ready' | 'constructing' | 'complete' | 'dying';
export interface PartEval { state: PartState; alpha: number; zCutM: number } // solid below zCutM, ghost above
/** CPU reference of the shader (§4.2). Golden tests compare the two. */
export function evalPart(a: PartAttrs, t: Day): PartEval;
export interface BarEval { visible: boolean; fill: number /* 0..1 */; segCount: number; chance: number | null; dead: boolean; alpha: number }
export function evalBar(b: BarAttrs, l: TimelineLookups, t: Day, zoom: number): BarEval;
export interface TimelineSnapshot {         // debug hook
  revision: number; cells: number; parts: number; bars: number; day: number;
  demolish: { total: number; applied: number }; pending: number; layerIds: string[];
}

// src/lib/map/palette.ts
export interface TimelineLegendEntry { id: string; kind: 'ghost' | 'solid' | 'bar'; tokens: TokenName[]; label: string }
export const TIMELINE_LEGEND: readonly TimelineLegendEntry[]; // §4.6
```

`PartAttrs` and `BarAttrs` are the CPU-side records of the GPU attributes in §4.2.1 and §4.4.2. Time constants (`MONTH_DAYS`, `monthsIn`, `OPEN_DAY`) are imported from `src/lib/timelapse/time.ts` (T1), and nothing is redefined here.

### 2.2 Interface concerns: all resolved by the reconciliation

| # | concern (original) | resolution |
|---|---|---|
| IC-1 | no channel to upload T12 | resolved: T7 `setTimelineLookups({ chance, typicalMonths })`; T12 `typicalMonths(cal)` ("Rendering": "lookups come via `setTimelineLookups`"). This spec's own median helper is dropped |
| IC-2 | T12 length and tail; month undefined | resolved: T1 `MONTH_DAYS` and `monthsIn`, and the T12 table is 241 months long. With constant tail hazards the chance is constant beyond the table, so the renderer clamps the index to 240 (I, from T4's tail semantics) |
| IC-3 | `demolish` full or delta | resolved: T7 says it is complete in revision 0 and empty afterwards ("Rendering") |
| IC-4 | open-ended window encoding | resolved: T1 `OPEN_DAY`; T7 `toDay = OPEN_DAY` |
| IC-5 | `parcelMeta` and slots | resolved: T7 `slotProjectIds`; "`parcelMeta` rows describe the slot's final revision" |
| IC-6 | O(1) `setTime` vs MapLibre reloads | resolved: T7 text ("except the existing-building catch-up … at most 2,000 feature-state changes per frame") and the global constraint "Map budgets in FZP mode". The evidence stands: `maplibre-gl/src/style/style_layer.ts:294-307`, `style/style.ts:1421-1425`, `:1561-1567`, `:410-414` |
| IC-7 | no card channel | resolved: T7 `timelinePick` |
| IC-8 | two layers per cell | resolved: global constraint "Map budgets in FZP mode" |
| IC-9 | `@luma.gl/engine` dependency and credit | resolved: "Rendering": a direct dependency, credited in `SOFTWARE` in `src/lib/attribution.ts` |

No new concerns.

## 3. Global constraints (verbatim)


The source design's constraints still apply (free and open, determinism, overshoot meaningful, honesty of numbers, performance, mobile, static versioned data, conventions). In addition:

- **Evidence hierarchy** (above). No number reaches the simulation without a tier and a source. A tier-3 or tier-4 number is never presented as data.
- **Determinism.** The same `datasetVersion` and seed always give the same future, on every machine. The representative seed is chosen deterministically: the run whose final `completedNet` is the median of the N band runs.
- **Honesty of numbers.** The mode is labelled a *simulation*. The scoreboard shows the shown run and the p10–p90 band. Pipeline and new-FZP units are separate lines. Actual completions since the RHNA period start are counted and labelled as actual. Units lost to dead projects are shown.
- **Time scrubbing performance.** At 60 fps on a 2022-era laptop with the whole city's timeline loaded, per-frame JS during scrub or playback is O(1) in project count. A reroll reaches a full new timeline (the shown run, to 2050) within 3 s off the main thread. The p10–p90 band may fill in progressively afterwards; the UI marks it as provisional until it is complete.
- **First paint.** `/fzp` must not require loading every parcel chunk. The whole-city score comes from `parcels.bin`, `projects.json` and `calibration.json`. Geometry streams with the viewport, as on `/`.
- **The editor is unchanged.** `/` and `/p/:id` behave exactly as before. FZP mode is additive. The one intended exception is the shared header, which gains the mode links ("Paint" / "Timelapse").
- **Map budgets in FZP mode.** Two deck layers per cell are allowed for timeline cells: translucency needs them. This is an exception to map-view's one-layer-per-cell rule, so a `bench:map` timeline scenario must pass the same p95 frame bar. The existing-building catch-up stays within 2,000 feature-state changes per frame.
- **Accessibility.** WCAG 2.2 AA as in `docs/dev/accessibility.md`. The scrubber is a labelled slider: arrow keys step a month, Page Up/Down a year. Reduced motion stops autoplay, but scrubbing still works.

### Evidence hierarchy (verbatim)


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

### 4.0 Library facts this spec rests on

| fact | evidence |
|---|---|
| A primitive layer merges each extension's `getShaders` into its own shaders, and calls each extension's `draw` before its own `draw` on every render, picking included | `@deck.gl/core/src/lib/layer.ts:468-477`, `:1168-1171` (V) |
| An extension sets its shader-module uniforms per draw with `this.setShaderModuleProps({name: props})` | `layer.ts:348`; `@deck.gl/extensions` 9.4.0 `data-filter/data-filter-extension.ts:273-304` (V) |
| A shader module can bind a texture by returning it from `getUniforms` (sampler declared in the module source) | extensions 9.4.0 `mask/shader-module.ts:31`, `:107-109`; `mask/mask-extension.ts:85` (V) |
| Injection hooks `vs:#decl`, `vs:#main-start`, `vs:#main-end`, `fs:#decl`, `fs:#main-end`, `fs:DECKGL_FILTER_COLOR` are supported | `@luma.gl/shadertools/src/lib/shader-assembly/shader-injections.ts:117`, `:147`; DataFilter uses `vs:#main-end` and `fs:DECKGL_FILTER_COLOR` at `data-filter/shader-module.ts:307-345` (V) |
| Picking's `fs:DECKGL_FILTER_COLOR` injection runs at `order: 99`, after default-order injections | `@deck.gl/core/src/shaderlib/picking/picking.ts:182-190` (V) |
| `SolidPolygonLayer` draws a side model (instanced quads, `triangle-strip`) then a top model, sharing attributes. Side quad `positions.y` is 0 at the ground and 1 at the top, and the side shader `#define`s `IS_SIDE_VERTEX` | `@deck.gl/layers/src/solid-polygon-layer/solid-polygon-layer.ts:334-343`, `:452-462`; `solid-polygon-layer-vertex-side.glsl.ts:10`, `:12`, `:56` (V) |
| The vertical offset is `pos.z += props.elevations * solidPolygon.elevationScale`, and lighting is applied to `fillColors` in the vertex shader via `lighting_getLightColor` | `solid-polygon-layer-vertex-main.glsl.ts:39`, `:52` (V) |
| Per-object accessors on `stepMode: 'dynamic'` attributes are expanded per vertex using the tessellator's `vertexStarts` | `solid-polygon-layer.ts:251-257`, `:395-398` (V); extension attributes added the same way, `data-filter-extension.ts:166-173` (V) |
| The side model binds 10 attribute locations (`positions`, `vertexPositions` + `64Low`, `nextVertexPositions` + `64Low`, `instanceVertexValid`, `elevations`, `fillColors`, `lineColors`, `rowIndexes`). WebGL2 guarantees 16 | `solid-polygon-layer.ts:200-284` (V); the WebGL2 minimum `MAX_VERTEX_ATTRIBS` = 16 (I, GLES 3.0 spec) |
| In interleaved mode every MapLibre render calls `deck._drawLayers` for each layer group, unconditionally | `@deck.gl/maplibre/src/deck-utils.ts:187-221` (V) |
| `project.scale` is `2 ** zoom`. `TILE_SIZE` is 512 | `@deck.gl/core/src/shaderlib/project/viewport-uniforms.ts:314`; `project.glsl.ts:37`, `:53` (V) |
| luma `Parameters.depthWriteEnabled` exists | `@luma.gl/core/src/adapter/types/parameters.ts:100` (V) |
| `DataFilterExtension` only scales alpha or size by a range test on per-object values (`filterSoftRange`) and discards out-of-range fragments. It cannot choose colours or split a prism by height | extensions 9.4.0 `data-filter/shader-module.ts:157-181`, `:328-345` (V) |
| `CollisionFilterExtension` re-renders its collision map only when the viewport or layer props change | extensions 9.4.0 `collision-filter/collision-filter-effect.ts:80-82` (V) |
| Data-driven paint changes (feature-state or `global-state`) reload the source | see IC-6 (V) |

### 4.1 Applying a timeline

- **Mode.** `SimMap` enters *timeline mode* on the first `applyTimeline` call. It lazily imports `src/lib/map/timelapse/deck.ts` (the extension and `StageBarLayer`), creates the `TimelineController`, and keeps it until unmount. In timeline mode `applyGenerated` is ignored with one `console.error`. The two controllers share the `replaced` feature-state key, and FZP mode has no plan. Before the map and deck are ready, updates queue as `pendingApplies` do (`SimMap.svelte:204-210`). A revision-0 update drops the queue.
- **Ordering** follows `GeneratedUpdate` (`types.ts:43-60`, `generated-controller.ts:153-173`):
  - `revision: 0` is a full snapshot that replaces every cell, the demolish list and the bars;
  - otherwise the revision must equal `last + 1`, or the update is discarded and the shared `onResyncNeeded` callback fires;
  - `cells` are full repacks of each touched cell, and `removedCells` drop cells.
- **Slicing.** Updates install at most `MAX_CELLS_PER_SLICE = 4` cells per animation frame (`hide.ts:28`). Updates within one slice apply synchronously. There is **no rise-in**: timeline geometry appears in the state that the current `t` dictates.
- **Validation** (a programming error throws a `TypeError` naming the cell):
  - `slotProjectIds.length === slots`;
  - `partWindow.length === 2·partCount`;
  - `slotStages.length === 7·slots`;
  - `slotEnd.length === 2·slots`;
  - `slotPathway.length === slots`;
  - `slotPathway[i] ∈ {0,1,2}`;
  - `slotEnd` kind ∈ {0,1,2}.
- **Encoding to GPU values** (CPU, once per installed cell): a `NaN` stage day becomes `OPEN_DAY` (T1; 3.0e38 is below the Float32 maximum, and `OPEN_DAY + 270` still compares as open). The same "never" sentinel serves everywhere on the GPU.
- **Late demolish entries.** `demolish` must be empty after revision 0 (T7). A non-empty list on a later revision is ignored, with one `console.error`.

#### 4.1.1 `packTimedCell` (owned here; the worker calls it)

- **Slots**: one slot per item, sorted by `schedule.projectId` (`slotProjectIds`). A slot's `parcelIds` entry is the final massing's `parcelId`, or `schedule.parcelIds[0]` for a footprint. Parcel ids may repeat across slots (T7).
- **`parcelMeta`** (final revision): `[units, existingUnits, stories, typologyIdx]`. For a footprint, stories = 0 and the typology index is 0. Stories = 0 marks a slot as footprint-only on the GPU (§4.2.3).
- **Parts**: each revision *i* contributes its parts, built exactly as `packCell` builds them (`pack.ts:42-116`: merged occupied runs, normalised CW rings, `encodeAppearance`), with `partWindow = [revisions[i].day, revisions[i+1].day)`. The last revision's window ends at `OPEN_DAY`. A footprint contributes one part: its ring, `partTopM = FOOTPRINT_M`, appearance code 0.
- **Slot arrays**: `slotStages` comes from `schedule.entered` in `STAGE_ORDER`, with `NaN` for stages never entered. `slotEnd` holds `[end.day or NaN, kind]`. `slotPathway` is the index of the pathway.
- **Sources**: buildings of every source (`'pipeline'`, `'scenario'`, T5/T10) are accepted. Colour comes from typology, never from `colorFor`.
- **Throws** on:
  - `massings.length !== schedule.revisions.length`;
  - non-ascending revision days;
  - a duplicate `projectId`;
  - an unknown typology.
- **Determinism**: identical inputs give byte-identical buffers.
- **Transfer**: `packTimedTransferables(p)` lists every typed array for `postMessage`.

### 4.2 GPU state: `TimelapseExtension`

**Mechanism (decision).** A custom `LayerExtension` attached to the cell layers. It adds three per-part `vec4` attributes and one shader module, `timelapse`, whose uniform `day` comes from a shared mutable **clock** object passed in the extension's options. One extension instance serves every timeline layer. `LayerExtension.equals` compares options shallowly by reference (`layer-extension.ts:28-35`), so mutating the clock never re-initialises a layer. The extension's `draw` reads `clock.day`, the theme tints and the pass into `setShaderModuleProps({timelapse})` on every draw. `setTime` writes `clock.day` and calls `map.triggerRepaint()`. No deck prop changes, and no layer is cloned.

#### 4.2.1 Per-part attributes (all `float32`, `stepMode: 'dynamic'`, accessor functions indexed by part)

| attribute | x | y | z | w |
|---|---|---|---|---|
| `tlA` | `partFrom` | `partTo` | `ghostFrom` = min over the slot's 7 `slotStages` | `endDay` (`OPEN_DAY` if open) |
| `tlB` | `permitDay` = min(`entitled`, `permitFiled`) | `readyDay` = `permitIssued` | `constructionDay` | `completeDay` (= `endDay` if kind 1, else `OPEN_DAY`) |
| `tlC` | `endKind` (0 open, 1 complete, 2 exit) | `constructionTypicalDays` = `typicalMonths[pathway].construction · MONTH_DAYS` (T12, T1); `OPEN_DAY` until lookups arrive | `stories` = `parcelMeta[4s+2]` (final revision, T7; 0 = footprint-only) | `groundFtfM`: 4.5 for podium/midrise/tower parts, else 3.1 (`generator/constants.ts:3-5`) |

That makes 13 of the 16 guaranteed locations. `updateTriggers` on the `tlC` accessor include the lookups' identity.

#### 4.2.2 Uniforms (`timelapse` module)

`day`, `pass` (0 solid, 1 ghost), `ghostAlpha`, `dyingHoldDays`, `dyingFadeDays`, `ftfM` (3.1, `generator/constants.ts:3`), and `tintPlanning`, `tintPermit`, `tintReady`, `tintDying` (RGB from §4.6 for the current theme).

#### 4.2.3 State rules (normative; `evalPart` implements the same rules on the CPU)

Let `t = day`. In the vertex shader at `vs:#main-end`:

1. **Hidden** if `t < ghostFrom`, `t < partFrom` or `t ≥ partTo`, or if dying and `t ≥ endDay + hold + fade`. Then `gl_Position = vec4(0.)`, as DataFilter does (`data-filter/shader-module.ts:328-331`). Hidden parts produce no fragments, so they are neither drawn nor picked.
2. **Dying**: `endKind == 2 && t ≥ endDay`. `age = t − endDay`, and `f = age < hold ? 1 : 1 − (age − hold)/fade`.
3. **Complete**: `t ≥ completeDay`.
4. **Constructing**: `t ≥ constructionDay`. Progress `p = min((t − constructionDay)/constructionTypicalDays, 0.9)`, floors `n = floor(p · stories)`, and `zCut = n == 0 ? 0 : groundFtfM + (n − 1)·ftfM`. A construction-stage death freezes `p` at `t = endDay`.
5. Otherwise a **pre-construction ghost**, tinted `ready` if `t ≥ readyDay`, `permit` if `t ≥ permitDay`, else `planning`.

The vertex shader outputs these varyings:
- `tl_heightM` (side: `elevations · positions.y`; top: `elevations`);
- flat `tl_zCut`, flat `tl_mode`;
- `tl_ghost`: the lit ghost colour. That is `lighting_getLightColor(tint, project.cameraPosition, geometry.position.xyz, geometry.normal)`, the same call the layer makes for its fill (`vertex-main.glsl.ts:52`), with alpha from the table below.

`vColor` keeps the layer's lit palette colour.

In the fragment shader (`fs:DECKGL_FILTER_COLOR`, default order, so before picking):

| state | solid pass (`pass` 0) | ghost pass (`pass` 1) |
|---|---|---|
| planning / permit / ready | discard | `tl_ghost`, alpha `ghostAlpha` |
| constructing | `vColor` where `tl_heightM < tl_zCut`, else discard | `tl_ghost` (ready tint) where `tl_heightM ≥ tl_zCut`, else discard |
| complete | `vColor` (palette, opaque) | discard |
| dying, `tl_heightM ≥ zCut` | discard | `tintDying` lit, alpha `1.5 · ghostAlpha · f` |
| dying, `tl_heightM < zCut` (construction death) | discard | `mix(vColor.rgb, tintDying, 0.6)`, alpha `f` |

- **Construction, from the outside**, shows solid palette floors up to `zCut` and the ghost above. There is no cap at `zCut`: from above, the inner walls of the solid portion show through the ghost's roof (accepted).
- **Completion** is a step at `completeDay`: floors stall at ≤ 90% and then snap to full. This is deliberate, so the map never reveals a future completion date (§4.4.2).
- **A construction death** leaves the floors frozen and tinted red. They fade together with the ghost over `fade`, which leaves a vacant lot: the existing building does not come back (§4.5).
- **Revisions** swap instantly at the revision day through `partWindow`.
- **Footprint-only slots** (`stories == 0`: multi-phase rows and failed massings, "massing `none`") never enter the solid pass. They are ghost-tinted by stage, use the `ready` tint while constructing and after completion, and die like any ghost. The card explains (fzp-mode).

#### 4.2.4 Why not `DataFilterExtension`

It would cover only rule 1 and an alpha fade. It cannot tint by stage, split a prism at `zCut` or pass solid and ghost fragments separately (§4.0). It also adds `@deck.gl/extensions` to the bundle.

### 4.3 Layers, passes and depth

Each cell with timeline parts gets two `SolidPolygonLayer`s (the global constraint "Map budgets in FZP mode" allows this), built from the same cached binary `data`, `getElevation` and `getFillColor` accessors as `accessorsFor` (`generated-controller.ts:89-112`), with `extruded`, `_normalize:false`, `_windingOrder:'CW'` and `elevationScale: 1`:

- `timeline-solid-<cellId>` (`pass` 0, deck's default depth state);
- `timeline-ghost-<cellId>` (`pass` 1, `parameters: { depthWriteEnabled: false }`, depth test on).

The emit order is:
1. every solid layer, by `cellId`;
2. every ghost layer, by `cellId`;
3. `timeline-bars`;
4. the overlay layers.

Every one of these layers carries `beforeId` = the first label layer (`generated-controller.ts:387-402`). Solid layers are `pickable` with `autoHighlight`. Ghost layers are pickable too, so a ghost can be hovered.

- `generatedCellFilter` culls `timeline-(solid|ghost)-` layers by the cell bounds registered over all revisions' parts. The regex at `cull.ts:28` is extended to cover them.
- The reserved-id regexes (`generated-controller.ts:114`, `SimMap.svelte:116`) are extended to `timeline-`.
- Existing MapLibre extrusions draw earlier in the frame, so an old house shows through its ghost, as in the mockup.

### 4.4 Progress bar: `StageBarLayer`

#### 4.4.1 Geometry and visibility

- **One layer**, `timeline-bars`, holds every loaded project. It draws one instanced screen-space quad per *(project, revision)*, not pickable, with depth test on and depth writes off. It is rebuilt only when cells change or lookups change.
- **Anchor**: the centre of the revision's parts' bounding box, at `max(partTopM of that revision) + 2 m`, using fp64 positions. The bar's bottom edge sits 10 px above the anchor's screen position.
- **Size**: `W = clamp(32 + 8·(zoom − 15), 32, 48)` px and `H = clamp(6 + (zoom − 15), 6, 8)` px, with `zoom = log2(project.scale)`.
- **Visibility**: zoom ≥ `max(15, minZoom)`. Alpha ramps from 0 at 0.5 zoom below that threshold to 1 at it, and the zoom test runs in the shader, so panning and zooming cost no JS.
- **When a bar shows**: from `ghostFrom` within the revision window. It ends:
  - for a death, with the ghost (`endDay + hold + fade`, same alpha factor `f`);
  - for a completion, 90 days after `completeDay` at full fill, then fades over 90 days;
  - for a project still open, never.

#### 4.4.2 Segments and fill

Segments are equal-width, in this order:

| pathway | segments |
|---|---|
| `discretionary`, `streamlined` | [`preApplication`]? `filed`, `entitled`, `permitFiled`, `permitIssued`, `construction` |
| `permitOnly` | [`preApplication`]? `permitFiled`, `permitIssued`, `construction` |

`preApplication` is included only when the slot entered it (T2: optional). That gives 3 to 6 segments.

- **Current segment** `k`: the last segment whose entry day ≤ `t`. A stage the records skipped (`NaN`) counts as passed once a later stage has started.
- **Fill**: `(k + min(((t − entry_k)/MONTH_DAYS) / typicalMonths[pathway][stage_k], 0.9)) / segCount`. Elapsed months are continuous here, because a fill is not a table index; `monthsIn` is for indexes only. It is 1 when complete, and frozen at `endDay` after an exit. The 0.9 cap means a bar never reaches the end of a segment before the project actually leaves it, so the map never reveals the future.
- **Drawing**: unfilled is `tl-bar-track`. The border and the 1 px separators are `tl-bar-edge`.

#### 4.4.3 Colour and the lookups

- **Colour**:
  - exited: `tl-bar-dead`;
  - complete: `tl-bar-likely`;
  - otherwise the chance `c = chance[pathway][stage_k][min(monthsIn(entry_k, t), len − 1)]`, with `monthsIn` from T1 and `len` = 241 (T12). Clamping to the last entry is exact because the chance is constant under the constant tail hazards (T4).
- **Ramp**: piecewise linear in **linear RGB** through `tl-bar-unlikely` at c ≤ 0.15, `tl-bar-uncertain` at 0.45 and `tl-bar-likely` at c ≥ 0.75. Interpolating in linear RGB keeps relative luminance between the stops' values, so every blend keeps the stops' ≥ 3:1 contrast against `tl-bar-track` (§4.6).
- **Upload**: one `r8unorm` texture, 18 rows by `max(len)` columns, read with `texelFetch`.
  - Row = `pathwayIndex·6 + STAGE_ORDER.indexOf(stage)`, with pathways in T7's `slotPathway` order.
  - Short rows are padded with their last value. Absent rows (e.g. `permitOnly`/`filed`) are 0, and never read.
  - `len > 2048` throws a `RangeError` in `setTimelineLookups` (2048 is WebGL2's guaranteed `MAX_TEXTURE_SIZE`, I).
  - The texture is uploaded once per `setTimelineLookups` call, and the previous texture is destroyed.
- **Typical durations**: `typicalMonths` (T12) is used as given. A missing or non-finite entry becomes `OPEN_DAY`, so that segment's fill stays at 0. Nothing here re-derives it (T12: "nothing re-implements them").
- **Before lookups arrive**, bars are not drawn, construction shows no solid floors until completion, and dev builds warn once.

#### 4.4.4 Declutter (CPU, on each bar rebuild; zero cost on `setTime`)

1. Sort projects by final units, descending, then lead `parcelId`, ascending.
2. Each project gets `minZoom` = the smallest value in {15, 15.5, …, 18} such that, for every higher-priority project whose active interval `[ghostFrom, barEnd)` overlaps its own, the anchor distance is ≥ `W(z)·mpp(z)` at `z = max(minZoom_i, minZoom_j)`.
   - `mpp(z) = 40,075,016.686 · cos(lat) / (512 · 2^z)`, with 512 = `TILE_SIZE` (§4.0).
   - At z15 a bar is about 60 m wide; at z17, about 23 m.
3. Anything still conflicting at z18 shows at z18 (the map's `maxZoom`, `camera.ts`).

A uniform grid keyed by anchor makes this O(n log n). Projects that never coexist in time never block each other. Pitch and bearing are ignored (approximate by design).

### 4.5 Hiding existing buildings by time

**Rejected:** a `demolishDay` feature-state plus a paint literal updated on `setTime`. Each update would reload every loaded `buildings` tile (the evidence is in §2.2, IC-6). T7 and the global constraint fix the catch-up bound below.

**Mechanism:** the T7 `demolish` list is held sorted by `(day, parcelId)`, with a cursor `applied` = the number of entries whose `replaced` state is currently set.

- **`setTime`** only records the target. It schedules the **demolish pump** (one `requestAnimationFrame`) when `t` crosses `days[applied]` or `days[applied − 1]`, an O(1) check.
- **The pump**, each frame:
  - moves the cursor toward `t`, calling `setFeatureState({source:'buildings', sourceLayer:'buildings', id}, {replaced:true})` forward or `removeFeatureState(…, 'replaced')` backward;
  - makes at most `SLICE_IDS = 2,000` calls per frame (`hide.ts:22`);
  - stops when caught up.
- **Paint**: the existing paint (`style.ts:203-219`) is reused unchanged, so a demolished parcel shows the flat `--map-replaced` footprint.
- **On revision 0**: `removeFeatureState({source:'buildings'})`, then a pump from 0.
- **Picking**: a parcel counts as hidden when it is in the pump's applied set (O(1)). This set feeds `resolveExistingHit` (`SimMap.svelte:819`).
- **`retryBuildings`** re-applies the set (`SimMap.svelte:777-779`).
- **Cost estimate**:
  - At fzp-mode's default speed of 1 year/s, a 30k-project timeline has ≈ 3.4 demolitions per simulated day: 30,000 over 8,842 days, from 2026-10-16 (Day 20742) to 2050-12-31 (Day 29584). At 6.09 simulated days per 60 Hz frame, that is ≈ 21 feature-state calls per frame. At 3 years/s it is ≈ 62.
  - A slider drag across the whole range in 2 s averages ≈ 250 per frame.
  - A single jump across the range takes ⌈30,000/2,000⌉ = 15 frames to catch up. During those frames the deck layers are already exact and MapLibre lags.
- **Pass bar**: a 2,000-id pump frame takes ≤ 8 ms main thread, the existing C5 slice budget (map-view §4.5).

### 4.6 Tokens (`palette.ts` `TOKENS`, both themes) and legend

New `TokenName`s. Like all tokens, `SimMap` exposes them as `--map-*` CSS custom properties (`SimMap.svelte:10-16`, `:148-155`), and fzp-mode's legend uses those variables (e.g. `var(--map-tl-ghost-planning)`).

| token | light | dark | use |
|---|---|---|---|
| `tl-ghost-planning` | `#9DB0FF` | `#5466B8` | ghost: `preApplication`, `filed` |
| `tl-ghost-permit` | `#6F86F0` | `#7D90F0` | ghost: `entitled`, `permitFiled` |
| `tl-ghost-ready` | `#4257D6` | `#AEBBFF` | ghost: `permitIssued`; unbuilt floors during construction |
| `tl-ghost-dying` | `#D84A4A` | `#FF6E6E` | dying ghost and floors |
| `tl-bar-track` | `#FFFFFF` | `#2C2E31` | unfilled bar |
| `tl-bar-edge` | `#5E5A52` | `#A9A59C` | bar border and separators |
| `tl-bar-likely` / `tl-bar-uncertain` / `tl-bar-unlikely` | `#2E7D32` / `#B26A00` / `#C62828` | `#81C784` / `#FFB74D` / `#FF8A80` | chance ramp |
| `tl-bar-dead` | `#8A8478` | `#8F8A80` | exited project |

- **Checked here** (a scratch script, recomputed by the tests in §6):
  - fills against `tl-bar-track`: light 5.13 / 4.24 / 5.62 / 3.72, dark 6.77 / 7.87 / 5.96 / 3.97 (all ≥ 3:1, WCAG 1.4.11);
  - `tl-bar-edge` against `tl-bar-track`: 6.86 (light), 5.54 (dark).
- **Ghost hues** are 228–231°, chosen to differ from the transit-access ramp (199–200°). Ghost lightness steps monotonically by stage: darker in light mode, brighter in dark mode.
- `ghostAlpha` is 0.28 (light, the mockup's opacity) and 0.35 (dark).
- Completed buildings and solid floors use the existing typology palette through `appearanceColor` (`appearance.ts:21-24`). `colorFor` stays `'user'`-only (`palette.ts:103-110`; T10 sources need no palette lookup).
- Colour is never the only carrier: fzp-mode's card names the stage and the chance.

**`TIMELINE_LEGEND`** (exported from `palette.ts`; fzp-mode renders it, in this order):

| `id` | `kind` | `tokens` | `label` |
|---|---|---|---|
| `planning` | ghost | `tl-ghost-planning` | Proposed: in Planning review |
| `permit` | ghost | `tl-ghost-permit` | Approved: in permit review |
| `ready` | ghost | `tl-ghost-ready` | Permit issued |
| `building` | solid | `tl-ghost-ready`, `gen-walkup` | Under construction (solid floors are built) |
| `complete` | solid | `gen-adu` … `gen-tower` | Completed (colour shows building type) |
| `stopped` | ghost | `tl-ghost-dying` | Stopped: withdrawn, disapproved, cancelled or expired |
| `chance` | bar | `tl-bar-unlikely`, `tl-bar-uncertain`, `tl-bar-likely` | Bar colour: chance of finishing, low to high |
| `bar-stopped` | bar | `tl-bar-dead` | Bar: project stopped |

### 4.7 The `setTime` contract, performance and reduced motion

- **`setTime(day)`** does exactly this:
  - throws a `RangeError` on a non-finite `day`;
  - writes `clock.day`;
  - runs the O(1) pump check;
  - calls `triggerRepaint()`.

  It allocates nothing and touches no layer, attribute or feature-state. Calls before `applyTimeline` are stored and used. Many calls in one frame coalesce into one repaint, so throttling is unnecessary and the latest day wins.
- **Pass bars**:
  - `setTime` p95 ≤ 0.05 ms per call in the client test. The ratio between 30,000-project and 300-project timelines is ≤ 1.5.
  - Per-frame map-view JS during playback with no demolitions crossing is ≤ 0.5 ms.
  - The pump is bounded as in §4.5.
  - GPU: `bench:map` timeline case p95 ≤ 16.7 ms (the existing bar, `map-perf.md`).
- **Wall-clock timings at fzp-mode's speeds** (1 month/s; 1 year/s, the default; 3 years/s). The simulated-day values are normative.

  | event | simulated days | 1 month/s | **1 year/s** | 3 years/s |
  |---|---|---|---|---|
  | death: red (`dyingHoldDays`) | 90 | 2.96 s | **0.25 s** | 0.08 s |
  | death: fade (`dyingFadeDays`) | 180 | 5.91 s | **0.49 s** | 0.16 s |
  | completed bar: full, then fade | 90 + 90 | 2.96 s + 2.96 s | **0.25 s + 0.25 s** | 0.08 s + 0.08 s |

  At the default speed a death reads as a quick red flash, and scrubbing or pausing shows it as long as wanted.
- **Reduced motion**: timeline rendering has no wall-clock animation. Every visible change is a pure function of `t`, so `prefers-reduced-motion` changes nothing here. The rise-in is not used. Autoplay is fzp-mode's (global constraint).

### 4.8 Editor unchanged, picking, errors

- **Editor unchanged**. Without `applyTimeline`, nothing timeline-related loads or runs: the lazy module is never imported and no `timeline-*` layer exists. The shared changes are limited to:
  - the extended regexes;
  - new `TOKENS` (unused CSS custom properties on the map root);
  - `setLayers` concatenating an empty timeline list;
  - the new handle methods.

  Existing tests pass unmodified.
- **Picking**. A timeline hit is a pick on a `timeline-(solid|ghost)-` layer, resolved to `{ projectId: slotProjectIds[s], parcelId: parcelIds[s] }`.
  - With `timelinePick` set (T7), `SimMap` calls it with `x` and `y` in canvas px. It follows the same pointer and tap rules as map-view spec §4.7 (one pick per frame; none while moving). It suppresses its built-in tooltip over timeline parts, and calls `timelinePick(null)` on a miss.
  - Without the prop, it shows the generated tooltip from `parcelMeta`.
- **Errors**:
  - deck fails to load: the existing `error` state, and queued timelines are dropped;
  - a shader compile or link error: `console.error('[map] timelapse shader', e)` and `data-state="error"` (existing alert);
  - a removed cell that is unknown: ignored;
  - a cell with zero parts: no layers.

### 4.9 Parameters introduced

All of these are presentation constants, not simulation inputs. None is ever shown as data.

| parameter | value | tier and source |
|---|---|---|
| ghost alpha | 0.28 light / 0.35 dark | 4 (light: partner-approved mockup `tl-ghost-styles-v2.html`, `op: 0.28`; dark: this spec) |
| bar zoom gate | 15, 0.5-zoom ramp | 4 (OD-T2 "street zoom"; value: this spec) |
| bar size, offset | 32–48 × 6–8 px, 10 px | 4 (this spec) |
| fill cap | 0.9 | 4 (this spec; prevents revealing the future) |
| dying hold / fade | 90 / 180 days | 4 (this spec; OD-T2 "red, then it fades") |
| completed bar hold / fade | 90 / 90 days | 4 (this spec) |
| chance ramp stops | 0.15 / 0.45 / 0.75 | 4 (this spec; mockup colours at 41% amber, 78% green) |
| declutter ladder | 15…18 step 0.5 | 4 (this spec; 18 = map `maxZoom`) |
| floor heights | 3.1 m; ground 4.5 m | inherited generator constants (`generator/constants.ts:3-5`) |
| footprint-only ghost height (`FOOTPRINT_M`) | 1 m | 4 (this spec) |
| pump cap | 2,000 per frame | existing measured budget (`hide.ts:22`, C5); T7 |

The chance and typical durations are not parameters of this spec. They come from T12 and carry calibration provenance. `MONTH_DAYS` and `OPEN_DAY` are T1's.

## 5. Seams

- **Policy levers (T9).** Nothing. Levers change `Calibration` before `simulate`, and the renderer sees only a new `TimelineUpdate` (revision 0) and new lookups. The renderer never reads `Calibration`: its lookups arrive already computed by T12's `chanceTable` and `typicalMonths`.
- **Addenda sub-stages.** The bar's segment list comes from one table, `BAR_SEGMENTS: Record<Pathway, Stage[]>`, in `timelapse/bars.ts`. Ghost tint groups come from one table, `TINT_GROUP: Record<Stage, 'planning' | 'permit' | 'ready'>`. Nothing else is added: no spare attribute slots and no sub-stage encoding.
- **DA phasing.** Nothing. Multi-phase projects render as ordinary slots.
- **Renderings.** Nothing. Ghosts and buildings are generator massings. `partAppearance` is reused unchanged.

## 6. Testing

Every test calls `expect` (`expect.requireAssertions`).

**Fixtures (hand-made, committed):**

- `src/lib/map/fixtures/timeline-small.ts`: a `TimelineUpdate` (revision 0) over parcels from `fixtures/parcels-small.json`, packed with `packTimedCell`. It has eight slots:
  - (a) discretionary with PPA, completes;
  - (b) streamlined, exits `withdrawn` at `permitFiled`;
  - (c) permitOnly, in construction, open at the horizon;
  - (d) downsizes at `permitFiled`: two revisions, `partWindow` split;
  - (e) construction-stage death;
  - (f) simulated, first stage in 2040;
  - (g) a pipeline record with a skipped stage (`entitled` = `NaN`);
  - (h) a multi-phase footprint-only row that shares its parcel with (a), so a parcel id repeats across slots.

  Its demolish entries cover (a), (c) and (e). It also provides `timelineSmallRev1`, which repacks one cell, removes another and has an empty `demolish`.
- `src/lib/map/fixtures/timeline-lookups.ts`: hand-made `{ chance, typicalMonths }`. The chance has 241-entry rows and one absent row. `typicalMonths` has one missing entry.
- `src/lib/map/test/synthetic-timeline.ts`: `makeSyntheticTimeline(seed, nProjects)`. It reuses `makeSyntheticCity` buildings with seeded stage days between Day 20742 and Day 29584, about 1.3 revisions per project, and a 15% exit share. The share is a test value only.
- e2e: `e2e/fixtures/timeline/fixture0-timeline.json`, a `TimelineUpdate` over fixture-0 parcels (built by `src/lib/map/fixtures/build-fixtures.ts`).

**Vitest server project (pure TS):**

- `timelapse/state.spec.ts` (`evalPart`) runs a golden table on `timeline-small`:
  - hidden before `ghostFrom`;
  - tint changes at `permitDay` and `readyDay`;
  - `zCut` at p = 0, 0.5 and the 0.9 cap, and the snap at `completeDay`;
  - the revision swap exactly at the day (`[from, to)`);
  - dying alpha at `end`, `end + 89`, `end + 90`, `end + 269`, and hidden at `end + 270`;
  - construction death with `zCut` frozen;
  - open-ended windows (`OPEN_DAY`);
  - the footprint-only slot never takes the solid state.
- `pack-timed.spec.ts` (`packTimedCell`):
  - slots sorted by `projectId`, and repeated parcel ids allowed;
  - `parcelMeta` from the final revision;
  - `partWindow` boundaries, ending at `OPEN_DAY`;
  - footprint parts at `FOOTPRINT_M` with stories 0;
  - byte-identical repacks;
  - every throw case;
  - transferables cover all buffers.
- `timelapse/encode.spec.ts`: TimedPackedCell → `tlA`/`tlB`/`tlC` (`NaN` → `OPEN_DAY` mapping, `ghostFrom` = min, `groundFtfM` by typology). Validation throws on each malformed length.
- `timelapse/bars.spec.ts`:
  - segment lists per pathway with and without PPA (3–6);
  - fill per §4.4.2, including the skipped stage;
  - the chance index (`min(monthsIn(entry, t), 240)`, T1), including the boundary days `entry + k·MONTH_DAYS`;
  - property: every ramp blend is ≥ 3:1 against `tl-bar-track`, both themes.
- `timelapse/declutter.spec.ts`:
  - determinism;
  - time-disjoint projects never conflict;
  - priority order;
  - property (fast-check): two time-overlapping bars shown together at zoom z < 18 are ≥ `W(z)·mpp(z)` apart;
  - 30,000 bars in ≤ 50 ms (server; the client budget is below).
- `timelapse/demolish.spec.ts`:
  - the pump moves ≤ 2,000 per frame, forward and back;
  - a revision-0 replace;
  - a non-empty `demolish` list on revision > 0 is ignored;
  - applied-set membership;
  - `setTime` schedules a frame only on a crossing.
- `timelapse/lookups.spec.ts`:
  - texture packing (row order, padding, absent rows, `RangeError` above 2048);
  - a missing `typicalMonths` entry becomes `OPEN_DAY`;
  - `constructionTypicalDays = typicalMonths · MONTH_DAYS`.
- `palette.spec.ts` additions:
  - the new tokens in both themes;
  - every `TIMELINE_LEGEND` token exists in `TOKENS`, and the ids are unique;
  - fills ≥ 3:1 against `tl-bar-track`;
  - ghost hues in [220°, 240°];
  - monotonic ghost lightness;
  - ΔE2000 ≥ 20 between ghost tints and `existing` (the existing U4 rule).
- `timeline-controller.spec.ts` (fake deps, as `fake-deps.ts`):
  - revision ordering and resync;
  - ≤ 4 cells per slice;
  - emit order (§4.3);
  - `setTime` makes no layer or feature-state calls;
  - `applyGenerated` is ignored in timeline mode.

**Vitest client project (Playwright Chromium):**

- `timelapse-extension.gpu.svelte.spec.ts`: a standalone deck `Deck` over a 64×64 canvas with `preserveDrawingBuffer`, top-down, with one part from each fixture state. After `setTime(d)` and a redraw, `readPixels` at the part centre matches the `evalPart` colour class (hidden / ghost tint / palette / red) within tolerance, for 12 days covering every rule. It fails on any shader compile error.
- `SimMap.timeline.svelte.spec.ts` (real map, fixture manifest):
  - `applyTimeline(timeline-small)` installs `timeline-solid-*`, `timeline-ghost-*` and `timeline-bars`;
  - the `tlA` attribute expands per vertex (read through deck's attribute manager, as `readAttributes` does);
  - `pickObject` returns nothing before `ghostFrom` and the slot after;
  - `timelinePick` fires with `projectId`, `parcelId`, `x` and `y`, and the built-in tooltip stays hidden over timeline parts;
  - a theme switch updates the tints without re-creating the extension.
- `timeline-perf.svelte.spec.ts`:
  - the `setTime` budget (§4.7) at 300 and 30,000 projects;
  - a 2,000-id pump frame takes ≤ 8 ms;
  - declutter of 30,000 bars takes ≤ 20 ms.
- Editor regression: the existing `SimMap*.svelte.spec.ts` and `generated-controller.svelte.spec.ts` pass unmodified. A new assertion checks that with no `applyTimeline` the lazy timelapse module is never requested and no `timeline-` layer id exists.

**Playwright e2e:**

- `e2e/timelapse-render.spec.ts` on `/` with the debug hook (`__sfhMap.applyTimeline`, `setTime`, `setTimelineLookups`, `timelineSnapshot`), loading `fixture0-timeline.json`:
  - before the construction day, `queryRenderedFeatures` on `existing-buildings` returns the parcel with `state.replaced` unset;
  - after it, `replaced` is true;
  - scrubbing back clears it;
  - `timelineSnapshot().demolish.applied` tracks the cursor;
  - no console errors.
- The axe gate does not change: this subsystem adds no DOM. fzp-mode's page runs `expectNoA11yViolations`, including the legend that uses these tokens.

**Bench (`npm run bench:map`, headed GPU):** `e2e/bench/map-timeline.bench.ts` adds the debug hook `loadSyntheticTimeline(seed, n)` (VITE_E2E only).

- **Case "playback"**: 30,000 projects, downtown at zoom 15.5, pitch 55. It pans as the existing bench does while `setTime` advances at fzp-mode's fastest speed, 3 years/s (1,095.7 days/s; it covers the 1 year/s default too), from Day 20742. Pass at p95 ≤ 16.7 ms.
- **Case "drag"**: the same pan while `setTime` sweeps the full range in 2 s, back and forth. Pass at p95 ≤ 16.7 ms.
- Both cases print the pump's maximum per-frame operations. Results get a row in `docs/dev/map-perf.md`. 30,000 projects is a tier-4 stress size: about 1.5× the high end of the design's buildout expectations, at ~10–25 units per project.

## 7. Acceptance criteria

1. `applyTimeline`, `setTime` and `setTimelineLookups` exist on `SimMapHandle`, and `timelinePick` on `SimMapProps`, all with T7's signatures. `packTimedCell` is pure, deterministic and worker-importable. `setTime` makes no deck prop change, layer clone, attribute update or feature-state call (fake-deps test). It meets §4.7's per-call budget, with the 30k/300 ratio ≤ 1.5.
2. For every fixture state, the GPU pixel class equals `evalPart` (client GPU test). Hidden parts are not pickable.
3. Floors turn solid bottom-up in whole floors, stall at ≤ 90% until completion and snap to full at `completeDay`. A construction death freezes them, turns them red and fades them out over 90 + 180 days.
4. A pre-construction death turns the ghost red for 90 days, then fades it over 180 days. The existing building stays.
5. A revision swaps the massing exactly at its day.
6. The existing building on each `demolish` parcel shows the `replaced` footprint from its day, and returns when scrubbed earlier. The pump catches up within ⌈k/2,000⌉ frames.
7. Bars appear at zoom ≥ 15 (or the project's `minZoom`), in 3–6 equal segments. Fill and colour follow §4.4.2–4.4.3. Exited bars are `tl-bar-dead`, and no bar shows before lookups arrive.
8. Every `tl-*` token exists in both themes and passes the §6 palette tests. `TIMELINE_LEGEND` is exported as in §4.6.
8a. Footprint-only (multi-phase) slots render as a 1 m ghost and are never solid.
9. With no `applyTimeline` call, the editor makes no new request and renders no new layer, and all existing map tests pass unmodified.
10. Both `bench:map` timeline cases pass at p95 ≤ 16.7 ms on the reference machine, with a row recorded in `docs/dev/map-perf.md`.
11. `npm run check`, `npm run lint` and `npm run test:unit` pass.

## 8. Open questions

- **OQ-1. On-map exit-reason text.** The mockup shows "withdrawn" over a dying bar. *Recommend: not in this package.* Text needs `TextLayer` with time-gated sublayers, and it adds clutter. The card shows the reason.
- **OQ-2. Ghost edges.** The mockup strokes ghost edges. `SolidPolygonLayer`'s `wireframe` adds a third model per layer (`solid-polygon-layer.ts:328-332`). *Recommend off.* Face lighting already separates the faces; revisit after the partner's visual review.
