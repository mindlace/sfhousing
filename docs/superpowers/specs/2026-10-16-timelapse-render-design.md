# timelapse-render: spec

Status: derived 2026-10-16 from [the FZP timelapse design](../design/2026-10-16-1903-fzp-timelapse.md) (approved with partner rulings; OD-T2 option A). Owns T7; consumes T1, T2, T5, T6, T10, T12. The code is ground truth; where this spec cites a library, the citation is to the installed version (deck.gl 9.4.0, luma.gl 9.4.2, maplibre-gl 6.13.0, the versions in `package-lock.json`). Library paths below are relative to `node_modules/`. `@deck.gl/extensions` is not a dependency; its 9.4.0 source was read from the npm tarball (`npm pack @deck.gl/extensions@9.4.0`). V = verified at the cited line, I = inferred.

## 1. Scope

From the design:

- **`timelapse-render`** (map view). Renders timeline geometry so that the state at time `t` is decided on the GPU from per-part time windows and per-project stage times, with `t` passed as a uniform. That state covers hidden, ghost, constructing, complete and dying. It draws the per-project progress bar. It hides each existing building from its project's construction start. `setTime(day)` costs O(1) JavaScript regardless of project count.

**In scope**

- `SimMapHandle.applyTimeline` and `setTime` (T7), implemented in `SimMap.svelte` over a new `TimelineController` (`src/lib/map/timeline-controller.ts`), deps-injected like `GeneratedController` (`generated-controller.ts:15-26`).
- A deck `LayerExtension`, `TimelapseExtension`, that decides each part's state at time *t* on the GPU (§4.2).
- A custom deck layer, `StageBarLayer`, for the progress bars (§4.4), and its declutter.
- Time-driven hiding of existing buildings from T7 `demolish` (§4.5).
- Uploading T12's chance table and per-stage typical durations (§4.4.3, pending IC-1).
- New `TOKENS` entries for the ghost and bar colours, both themes, exposed as `--map-*` CSS custom properties for fzp-mode's legend (§4.6).
- Debug hook, fixtures, tests and a `bench:map` timeline case.

**Out of scope**

- Building schedules, packing `TimedPackedCell`s, computing `demolish` days (timelapse-sim).
- `chanceTable` itself (T12, timelapse-sim); the card's "chance of finishing" text, the legend markup, the scrubber, playback speed and autoplay (fzp-mode).
- Any change to the editor (`/`, `/p/:id`): no new layer, paint property, request or animation there (§4.8).
- On-map text labels (OQ-1), wireframe edges (OQ-3), screen-space collision on the GPU.

## 2. Interfaces

Rows copied verbatim from the design's interface table.

| # | interface | owner → consumers | mark |
|---|---|---|---|
| T1 | `type Day = number` is integer days since 1970-01-01 UTC. All schedule times use it. It is exact in Float32 | timelapse-sim → all | DC |
| T2 | `type Stage = 'preApplication' \| 'filed' \| 'entitled' \| 'permitFiled' \| 'permitIssued' \| 'construction' \| 'complete'`; `type Pathway = 'discretionary' \| 'streamlined' \| 'permitOnly'`; `type ExitReason = 'withdrawn' \| 'disapproved' \| 'cancelled' \| 'expired'`. `STAGE_ORDER` lists the stages in this order. `preApplication` is optional on every pathway. `permitOnly` projects never enter `filed` or `entitled`. A ghost is visible from the project's first entered stage | stage-calibration → project-records, timelapse-sim, timelapse-render, fzp-mode | MC (stage sequence and exits follow real records), DC (names) |
| T5 | `interface Schedule { projectId: string; origin: 'pipeline' \| 'simulated'; parcelIds: ParcelId[]; pathway: Pathway; entered: Partial<Record<Stage, Day>>; end: { kind: 'complete'; day: Day } \| { kind: 'exit'; stage: Stage; reason: ExitReason; day: Day } \| { kind: 'open' } /* still in progress at horizon */; revisions: { day: Day; units: number; stories: number }[] /* [0] is the initial proposal; ascending days; none on or after entered.construction */; existingUnits: number }`. `simulate(input: SimInput, seed: number, horizon: Day): Schedule[]` is pure and deterministic. `SimInput = { parcels: ScenarioParcels; projects: InFlightProject[]; calibration: Calibration; asOf: Day }` | timelapse-sim → timelapse-render (via T7), fzp-mode | MC (deaths, resizing, real starting state), DC (shape) |
| T6 | Worker protocol additions (I15 extended): request `{ type: 'initScenario'; rev; manifest: Manifest; scenario: 'fzp'; seed: number \| null /* null = representative seed */; horizon: Day }` and `{ type: 'reroll'; rev; seed: number }`. Response `{ type: 'timeline'; rev; seed: number; render: TimelineUpdate; score: TimelineScore; complete: boolean }`. `parcelSummary` gains `project?: ProjectCard`, where `ProjectCard = { projectId: string; origin: 'pipeline' \| 'simulated'; label: string /* address if known, else 'Block B Lot L' */; pathway: Pathway; units: number; stories: number; stages: { stage: Stage; day: Day; actual: boolean }[]; revisions: Schedule['revisions']; end: Schedule['end']; sources: { dataset: string; id: string }[] }`. The card's chance to finish is computed on the main thread from T12 at the current time. `prefetch` and `chunks` are reused unchanged | timelapse-sim ↔ fzp-mode, timelapse-render | DC |
| T7 | `interface TimedPackedCell extends PackedCell { partWindow: Float32Array /* per part: [fromDay, toDay) the part's revision is current */; slotStages: Float32Array /* per slot: STAGE_ORDER.length entry days, NaN = never */; slotEnd: Float32Array /* per slot: [endDay, endKind] (0 open, 1 complete, 2 exit) */; slotPathway: Uint8Array /* index into ['discretionary','streamlined','permitOnly'] */ }`. `interface TimelineUpdate { revision: number; cells: TimedPackedCell[]; removedCells: string[]; demolish: { parcelId: ParcelId; day: Day }[] }`. `SimMapHandle` gains `applyTimeline(u: TimelineUpdate): void` and `setTime(day: Day): void`. `setTime` does O(1) JS work per call | timelapse-render ↔ timelapse-sim, fzp-mode | DC |
| T12 | `chanceTable(cal: Calibration): Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Float32Array>>>` gives, per month spent in a stage, the probability of eventually reaching `complete`. Beyond the table length it uses the tail. It is pure and shared by the worker, the renderer (uploaded once as a lookup) and the card. The bar colour and the card's "chance of finishing" both come from it | timelapse-sim → timelapse-render, fzp-mode | MC (health = chance of finishing, OD-T2) |
| T10 | `GeneratedBuilding.source: 'user' \| 'pipeline' \| 'scenario'` (amends I9). `generateForUnits(parcel: ParcelRecord \| ParcelRecord[], units: number, maxStories: number, seed: number, stories?: number): GeneratedBuilding \| null` | pipeline-massing → timelapse-sim, map-view | DC |

### 2.1 Internal types (timelapse-render-owned; none alters a T-row)

```ts
// src/lib/map/timelapse/constants.ts
export const NEVER = 10_000_000;            // Day sentinel for "never"; an exact Float32 integer
export const DAYS_PER_MONTH = 365.2425 / 12; // 30.436875, the mean Gregorian month (definitional)

// src/lib/map/timelapse/types.ts
export interface TimelineLookups {          // pending IC-1
  chance: ReturnType<typeof chanceTable>;   // T12, unchanged
  typicalDays: Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, number>>>;
}
export type PartState = 'hidden' | 'planning' | 'permit' | 'ready' | 'constructing' | 'complete' | 'dying';
export interface PartEval { state: PartState; alpha: number; zCutM: number } // zCutM: solid below, ghost above
/** CPU reference of the shader (§4.2). Golden tests compare the two. */
export function evalPart(a: PartAttrs, t: Day): PartEval;
export interface BarEval { visible: boolean; fill: number /* 0..1 of bar */; segCount: number; chance: number | null; dead: boolean; alpha: number }
export function evalBar(b: BarAttrs, lookups: TimelineLookups, t: Day, zoom: number): BarEval;
export function timelineLookups(cal: Calibration): TimelineLookups; // §4.4.3
export interface TimelineSnapshot {         // debug hook
  revision: number; cells: number; parts: number; bars: number; day: number;
  demolish: { total: number; applied: number }; pending: number; layerIds: string[];
}
```

`PartAttrs` and `BarAttrs` are the CPU-side records of the GPU attributes in §4.2.1 and §4.4.2.

**Proposed handle and prop additions (need orchestrator rulings IC-1 and IC-7; not T-rows):**

- `SimMapHandle.setTimelineLookups(l: TimelineLookups): void`.
- `SimMapProps.onTimelinePick?: (hit: { parcelId: ParcelId; surface: 'tooltip' | 'card'; x: number; y: number } | null) => void`.

### 2.2 Interface concerns (for the orchestrator)

- **IC-1. No channel for T12's table.** T12 says the table is "uploaded once as a lookup" to the renderer, but T7's `SimMapHandle` gains only `applyTimeline` and `setTime`. Bar fill also needs per-stage typical durations so that it never reveals a project's future (§4.4.2). Those durations derive from T4 `Transition` tables, which this subsystem does not otherwise consume. Proposal: `setTimelineLookups` (above), fed by fzp-mode from `timelineLookups(calibration)`. Alternatively timelapse-sim could export a `typicalStageDays(cal)` beside `chanceTable`.
- **IC-2. T12 encoding and the month.** T12 does not say how long each `Float32Array` is or how the tail is represented. This spec reads `arr[min(floor(m), arr.length − 1)]`, which is correct only if the last element equals the tail's limit. With constant tail hazards the chance of finishing is constant beyond the table, so that is exact if timelapse-sim guarantees it. T4 also never defines "month". This spec uses `DAYS_PER_MONTH = 30.436875`, and timelapse-sim must sample with the same constant, or the bar and the card disagree.
- **IC-3. `demolish` semantics are undefined in T7** (full list or delta?). This spec: `revision === 0` replaces the whole list; a later revision upserts by `parcelId`. timelapse-sim should send the citywide list in revision 0, independent of which chunks are loaded, because existing buildings render citywide from PMTiles.
- **IC-4. Open-ended `partWindow`.** T7 does not say how the final revision's `toDay` is encoded. This spec treats `NaN`, `±Infinity` and values ≥ `NEVER` as "open".
- **IC-5. `parcelMeta` and slots in a `TimedPackedCell`.** One slot holds one project (keyed by its lead parcel, the `GeneratedBuilding.parcelId`), but revisions carry different stories and units, while `parcelMeta` has one row per slot. This spec assumes that row is the **final** revision (the one current at construction or at the end).
- **IC-6. "`setTime` does O(1) JS work per call" vs MapLibre.** Verified: changing a data-driven paint property makes MapLibre reload the whole source (`maplibre-gl/src/style/style_layer.ts:294-307` returns relayout when the value is data-driven; `style/style.ts:1421-1425` then calls `_updateLayer`, which marks the source `'reload'` at `style.ts:1561-1567`). `global-state` paint changes take the same path (`style.ts:410-414`). So existing buildings cannot be hidden by time with an expression literal. `setTime` stays O(1). The feature-state catch-up is bounded per frame (≤ 2,000 operations, the existing `SLICE_IDS`, `hide.ts:22`), not O(1) per call. That meets the global constraint "per-frame JS … O(1) in project count" as a constant bound (§4.5).
- **IC-7. No SimMap → page channel for the project card.** T6 puts `ProjectCard` on `parcelSummary`, but `SimMap`'s tooltip renders only `ParcelSummaryLike` lines (`tooltip.ts`). Proposal: `onTimelinePick`. When it is set, `SimMap` draws no tooltip or card of its own for timeline hits, and fzp-mode renders the card.
- **IC-8. Layer budget.** Translucent ghosts drawn with depth writes hide solid buildings drawn after them. This spec therefore draws two layers per cell (solid pass, then ghost pass without depth writes; §4.3), not map-view §4.12's "≤ 1 layer per cell". The timeline population (≤ ~30k projects) is far below the 150k-building bench population, and the `bench:map` timeline case gates it.
- **IC-9. Dependencies.** `StageBarLayer` imports `Model` and `Geometry` from `@luma.gl/engine` (already locked at 9.4.2 as a transitive dependency). It must become a direct dependency at `~9.4.0`, as `@luma.gl/core` is (`package.json:51`). luma.gl already ships inside the deck chunk but has no credit of its own, so `SOFTWARE` in `src/lib/attribution.ts` gains `{ name: 'luma.gl', license: 'MIT', url: 'https://luma.gl' }` (CLAUDE.md convention). `@deck.gl/extensions` is **not** added (§4.2.4).

## 3. Global constraints (verbatim)


The source design's constraints still apply (free and open, determinism, overshoot meaningful, honesty of numbers, performance, mobile, static versioned data, conventions). In addition:

- **Evidence hierarchy** (above). No number reaches the simulation without a tier and a source. A tier-3 or tier-4 number is never presented as data.
- **Determinism.** The same `datasetVersion` and seed always give the same future, on every machine. The representative seed is chosen deterministically: the run whose final `completedNet` is the median of the N band runs.
- **Honesty of numbers.** The mode is labelled a *simulation*. The scoreboard shows the shown run and the p10–p90 band. Pipeline and new-FZP units are separate lines. Actual completions since the RHNA period start are counted and labelled as actual. Units lost to dead projects are shown.
- **Time scrubbing performance.** At 60 fps on a 2022-era laptop with the whole city's timeline loaded, per-frame JS during scrub or playback is O(1) in project count. A reroll reaches a full new timeline (the shown run, to 2050) within 3 s off the main thread. The p10–p90 band may fill in progressively afterwards; the UI marks it as provisional until it is complete.
- **First paint.** `/fzp` must not require loading every parcel chunk. The whole-city score comes from `parcels.bin`, `projects.json` and `calibration.json`. Geometry streams with the viewport, as on `/`.
- **The editor is unchanged.** `/` and `/p/:id` behave exactly as before. FZP mode is additive.
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
- **Validation** (a programming error throws a `TypeError` naming the cell): `partWindow.length === 2·partCount`, `slotStages.length === 7·slots`, `slotEnd.length === 2·slots`, `slotPathway.length === slots`, `slotPathway[i] ∈ {0,1,2}`, and `slotEnd` kind ∈ {0,1,2}.
- **Encoding to GPU values** (CPU, once per installed cell): `NaN`, `±Infinity` and values ≥ `NEVER` become `NEVER`, and `toDay` uses the same rule (IC-4).

### 4.2 GPU state: `TimelapseExtension`

**Mechanism (decision).** A custom `LayerExtension` attached to the cell layers. It adds three per-part `vec4` attributes and one shader module, `timelapse`, whose uniform `day` comes from a shared mutable **clock** object passed in the extension's options. One extension instance serves every timeline layer. `LayerExtension.equals` compares options shallowly by reference (`layer-extension.ts:28-35`), so mutating the clock never re-initialises a layer. The extension's `draw` reads `clock.day`, the theme tints and the pass into `setShaderModuleProps({timelapse})` on every draw. `setTime` writes `clock.day` and calls `map.triggerRepaint()`. No deck prop changes, and no layer is cloned.

#### 4.2.1 Per-part attributes (all `float32`, `stepMode: 'dynamic'`, accessor functions indexed by part)

| attribute | x | y | z | w |
|---|---|---|---|---|
| `tlA` | `partFrom` | `partTo` | `ghostFrom` = min over the slot's 7 `slotStages` | `endDay` (`NEVER` if open) |
| `tlB` | `permitDay` = min(`entitled`, `permitFiled`) | `readyDay` = `permitIssued` | `constructionDay` | `completeDay` (= `endDay` if kind 1, else `NEVER`) |
| `tlC` | `endKind` (0 open, 1 complete, 2 exit) | `constructionTypicalDays` for the slot's pathway (from lookups; `NEVER` until lookups arrive) | `stories` = `parcelMeta[4s+2]` (IC-5) | `groundFtfM`: 4.5 for podium/midrise/tower parts, else 3.1 (`generator/constants.ts:3-5`) |

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

#### 4.2.4 Why not `DataFilterExtension`

It would cover only rule 1 and an alpha fade. It cannot tint by stage, split a prism at `zCut` or pass solid and ghost fragments separately (§4.0). It also adds `@deck.gl/extensions` to the bundle.

### 4.3 Layers, passes and depth

Each cell with timeline parts gets two `SolidPolygonLayer`s, built from the same cached binary `data`, `getElevation` and `getFillColor` accessors as `accessorsFor` (`generated-controller.ts:89-112`), with `extruded`, `_normalize:false`, `_windingOrder:'CW'` and `elevationScale: 1`:

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
- **Fill**: `(k + min((t − entry_k)/typicalDays[pathway][stage_k], 0.9)) / segCount`. It is 1 when complete, and frozen at `endDay` after an exit. The 0.9 cap means a bar never reaches the end of a segment before the project actually leaves it, so the map never reveals the future.
- **Drawing**: unfilled is `bar-track`. The border and the 1 px separators are `bar-edge`.

#### 4.4.3 Colour, chance lookup and typical durations

- **Colour**:
  - exited: `bar-dead`;
  - complete: `bar-likely`;
  - otherwise the chance `c = T12[pathway][stage_k][min(floor(m), len − 1)]`, with `m = (t − entry_k)/DAYS_PER_MONTH` (IC-2).
- **Ramp**: piecewise linear in **linear RGB** through `bar-unlikely` at c ≤ 0.15, `bar-uncertain` at 0.45 and `bar-likely` at c ≥ 0.75. Interpolating in linear RGB keeps relative luminance between the stops' values, so every blend keeps the stops' ≥ 3:1 contrast against `bar-track` (§4.6).
- **Upload**: one `r8unorm` texture, 18 rows by `max(len)` columns, read with `texelFetch`.
  - Row = `pathwayIndex·6 + STAGE_ORDER.indexOf(stage)`, with pathways in T7's `slotPathway` order.
  - Short rows are padded with their last value. Absent rows (e.g. `permitOnly`/`filed`) are 0, and never read.
  - `len > 2048` throws a `RangeError` in `setTimelineLookups` (2048 is WebGL2's guaranteed `MAX_TEXTURE_SIZE`, I).
  - The texture is uploaded once per `setTimelineLookups` call, and the previous texture is destroyed.
- **Typical durations**: `typicalDays[p][s]` is the median time to advance, conditional on advancing, from `Transition` *p*/*s* (T4):
  1. `A∞ = advance[M] + S_M · a/(a + Σe)`, where `S_M = 1 − advance[M] − Σexit[M]` and `a`, `e` are the tail hazards;
  2. `m*` = the first month with cumulative advance ≥ `A∞/2`, extended into the tail geometrically if needed;
  3. `typicalDays = (m* − 0.5)·DAYS_PER_MONTH` (day within the month is uniform, T4);
  4. if `A∞ = 0`, it is `NEVER`.

  It inherits the transition's tier and provenance.
- **Before lookups arrive**, bars are not drawn, construction shows no solid floors until completion, and dev builds warn once.

#### 4.4.4 Declutter (CPU, on each bar rebuild; zero cost on `setTime`)

1. Sort projects by final units, descending, then lead `parcelId`, ascending.
2. Each project gets `minZoom` = the smallest value in {15, 15.5, …, 18} such that, for every higher-priority project whose active interval `[ghostFrom, barEnd)` overlaps its own, the anchor distance is ≥ `W(z)·mpp(z)` at `z = max(minZoom_i, minZoom_j)`.
   - `mpp(z) = 40,075,016.686 · cos(lat) / (512 · 2^z)`, with 512 = `TILE_SIZE` (§4.0).
   - At z15 a bar is about 60 m wide; at z17, about 23 m.
3. Anything still conflicting at z18 shows at z18 (the map's `maxZoom`, `camera.ts`).

A uniform grid keyed by anchor makes this O(n log n). Projects that never coexist in time never block each other. Pitch and bearing are ignored (approximate by design).

### 4.5 Hiding existing buildings by time

**Rejected:** a `demolishDay` feature-state plus a paint literal updated on `setTime`. Each update would reload every loaded `buildings` tile (IC-6).

**Mechanism:** the T7 `demolish` list is held sorted by `(day, parcelId)`, with a cursor `applied` = the number of entries whose `replaced` state is currently set.

- **`setTime`** only records the target. It schedules the **demolish pump** (one `requestAnimationFrame`) when `t` crosses `days[applied]` or `days[applied − 1]`, an O(1) check.
- **The pump**, each frame:
  - moves the cursor toward `t`, calling `setFeatureState({source:'buildings', sourceLayer:'buildings', id}, {replaced:true})` forward or `removeFeatureState(…, 'replaced')` backward;
  - makes at most `SLICE_IDS = 2,000` calls per frame (`hide.ts:22`);
  - stops when caught up.
- **Paint**: the existing paint (`style.ts:203-219`) is reused unchanged, so a demolished parcel shows the flat `--map-replaced` footprint.
- **On revision 0**: `removeFeatureState({source:'buildings'})`, then a pump from 0.
- **Upserts** reconcile the applied set against the new target through the same pump.
- **Picking**: a parcel counts as hidden when it is in the pump's applied set (O(1)). This set feeds `resolveExistingHit` (`SimMap.svelte:819`).
- **`retryBuildings`** re-applies the set (`SimMap.svelte:777-779`).
- **Cost estimate**:
  - At default playback (§4.7), a 30k-project timeline has ≈ 3.4 demolitions per simulated day: 30,000 over 8,842 days, from 2026-10-16 (Day 20742) to 2050-12-31 (Day 29584). At 1.52 simulated days per 60 Hz frame, that is ≈ 5 feature-state calls per frame.
  - A slider drag across the whole range in 2 s averages ≈ 250 per frame.
  - A single jump across the range takes ⌈30,000/2,000⌉ = 15 frames to catch up. During those frames the deck layers are already exact and MapLibre lags.
- **Pass bar**: a 2,000-id pump frame takes ≤ 8 ms main thread, the existing C5 slice budget (map-view §4.5).

### 4.6 Tokens (`palette.ts` `TOKENS`, both themes) and legend

New `TokenName`s. Like all tokens, `SimMap` exposes them as `--map-*` CSS custom properties (`SimMap.svelte:10-16`, `:148-155`), and fzp-mode's legend uses those variables (e.g. `var(--map-ghost-planning)`).

| token | light | dark | use |
|---|---|---|---|
| `ghost-planning` | `#9DB0FF` | `#5466B8` | ghost: `preApplication`, `filed` |
| `ghost-permit` | `#6F86F0` | `#7D90F0` | ghost: `entitled`, `permitFiled` |
| `ghost-ready` | `#4257D6` | `#AEBBFF` | ghost: `permitIssued`; unbuilt floors during construction |
| `ghost-dying` | `#D84A4A` | `#FF6E6E` | dying ghost and floors |
| `bar-track` | `#FFFFFF` | `#2C2E31` | unfilled bar |
| `bar-edge` | `#5E5A52` | `#A9A59C` | bar border and separators |
| `bar-likely` / `bar-uncertain` / `bar-unlikely` | `#2E7D32` / `#B26A00` / `#C62828` | `#81C784` / `#FFB74D` / `#FF8A80` | chance ramp |
| `bar-dead` | `#8A8478` | `#8F8A80` | exited project |

- **Checked here** (a scratch script, recomputed by the tests in §6):
  - fills against `bar-track`: light 5.13 / 4.24 / 5.62 / 3.72, dark 6.77 / 7.87 / 5.96 / 3.97 (all ≥ 3:1, WCAG 1.4.11);
  - `bar-edge` against `bar-track`: 6.86 (light), 5.54 (dark).
- **Ghost hues** are 228–231°, chosen to differ from the transit-access ramp (199–200°). Ghost lightness steps monotonically by stage: darker in light mode, brighter in dark mode.
- `ghostAlpha` is 0.28 (light, the mockup's opacity) and 0.35 (dark).
- Completed buildings and solid floors use the existing typology palette through `appearanceColor` (`appearance.ts:21-24`). `colorFor` stays `'user'`-only (`palette.ts:103-110`; T10 sources need no palette lookup).
- Colour is never the only carrier: fzp-mode's card names the stage and the chance.

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
- **Default playback speed (assumed, OQ-2)**: 1 simulated year per 4 s, i.e. 91.31 days/s.
  - Death: red for `dyingHoldDays = 90` (≈ 0.99 s), fading over `dyingFadeDays = 180` (≈ 1.97 s).
  - Completed bar: 90 days full (≈ 0.99 s) plus a 90-day fade.
  - The simulated-day values are normative. The wall-clock values change with the speed.
- **Reduced motion**: timeline rendering has no wall-clock animation. Every visible change is a pure function of `t`, so `prefers-reduced-motion` changes nothing here. The rise-in is not used. Autoplay is fzp-mode's (global constraint).

### 4.8 Editor unchanged, picking, errors

- **Editor unchanged**. Without `applyTimeline`, nothing timeline-related loads or runs: the lazy module is never imported and no `timeline-*` layer exists. The shared changes are limited to:
  - the extended regexes;
  - new `TOKENS` (unused CSS custom properties on the map root);
  - `setLayers` concatenating an empty timeline list;
  - the new handle methods.

  Existing tests pass unmodified.
- **Picking**. A timeline hit is a pick on a `timeline-(solid|ghost)-` layer, resolved to the slot's lead `parcelId`.
  - With `onTimelinePick` set, `SimMap` calls it (latest-wins, with the same tooltip/tap rules as §4.7 of the map-view spec), shows nothing itself, and calls `onTimelinePick(null)` on a miss.
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
| ghost alpha | 0.28 light / 0.35 dark | 4 (light: partner-approved mockup `ghost-styles-v2.html`, `op: 0.28`; dark: this spec) |
| bar zoom gate | 15, 0.5-zoom ramp | 4 (OD-T2 "street zoom"; value: this spec) |
| bar size, offset | 32–48 × 6–8 px, 10 px | 4 (this spec) |
| fill cap | 0.9 | 4 (this spec; prevents revealing the future) |
| dying hold / fade | 90 / 180 days | 4 (this spec; OD-T2 "red, then it fades") |
| completed bar hold / fade | 90 / 90 days | 4 (this spec) |
| chance ramp stops | 0.15 / 0.45 / 0.75 | 4 (this spec; mockup colours at 41% amber, 78% green) |
| declutter ladder | 15…18 step 0.5 | 4 (this spec; 18 = map `maxZoom`) |
| floor heights | 3.1 m; ground 4.5 m | inherited generator constants (`generator/constants.ts:3-5`) |
| typical stage days | per pathway × stage | derived from T4 transitions (tier 0→2; inherits provenance) |
| pump cap | 2,000 per frame | existing measured budget (`hide.ts:22`, C5) |
| `DAYS_PER_MONTH`, `NEVER` | 30.436875, 10⁷ | definitional |

## 5. Seams

- **Policy levers (T9).** Nothing. Levers change `Calibration` before `simulate`, and the renderer sees only a new `TimelineUpdate` (revision 0) and new lookups. The renderer never reads `Calibration` except through `timelineLookups`, which is pure.
- **Addenda sub-stages.** The bar's segment list comes from one table, `BAR_SEGMENTS: Record<Pathway, Stage[]>`, in `timelapse/bars.ts`. Ghost tint groups come from one table, `TINT_GROUP: Record<Stage, 'planning' | 'permit' | 'ready'>`. Nothing else is added: no spare attribute slots and no sub-stage encoding.
- **DA phasing.** Nothing. Multi-phase projects render as ordinary slots.
- **Renderings.** Nothing. Ghosts and buildings are generator massings. `partAppearance` is reused unchanged.

## 6. Testing

Every test calls `expect` (`expect.requireAssertions`).

**Fixtures (hand-made, committed):**

- `src/lib/map/fixtures/timeline-small.ts`: a `TimelineUpdate` (revision 0) over parcels from `fixtures/parcels-small.json`, packed with `packCell`. It has seven slots:
  - (a) discretionary with PPA, completes;
  - (b) streamlined, exits `withdrawn` at `permitFiled`;
  - (c) permitOnly, in construction, open at the horizon;
  - (d) downsizes at `permitFiled`: two revisions, `partWindow` split;
  - (e) construction-stage death;
  - (f) simulated, first stage in 2040;
  - (g) a pipeline record with a skipped stage (`entitled` = `NaN`).

  Its demolish entries cover (a), (c) and (e). It also provides `timelineSmallRev1`, which repacks one cell and removes another.
- `src/lib/map/fixtures/timeline-lookups.ts`: a hand-made chance table (rows of different lengths, one absent row) and two `Transition`s with known medians, one with all advance in the tail.
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
  - open-ended windows (`NaN`, `Infinity`).
- `timelapse/encode.spec.ts`: TimedPackedCell → `tlA`/`tlB`/`tlC` (`NEVER` mapping, `ghostFrom` = min, `groundFtfM` by typology). Validation throws on each malformed length.
- `timelapse/bars.spec.ts`:
  - segment lists per pathway with and without PPA (3–6);
  - fill per §4.4.2, including the skipped stage;
  - the chance index (`min(floor(m), len − 1)`);
  - property: every ramp blend is ≥ 3:1 against `bar-track`, both themes.
- `timelapse/declutter.spec.ts`:
  - determinism;
  - time-disjoint projects never conflict;
  - priority order;
  - property (fast-check): two time-overlapping bars shown together at zoom z < 18 are ≥ `W(z)·mpp(z)` apart;
  - 30,000 bars in ≤ 50 ms (server; the client budget is below).
- `timelapse/demolish.spec.ts`:
  - the pump moves ≤ 2,000 per frame, forward and back;
  - a revision-0 replace;
  - upsert reconcile;
  - applied-set membership;
  - `setTime` schedules a frame only on a crossing.
- `timelapse/lookups.spec.ts`:
  - texture packing (row order, padding, absent rows, `RangeError` above 2048);
  - `typicalDays` against hand-computed medians, including the tail case and `A∞ = 0`.
- `palette.spec.ts` additions:
  - the new tokens in both themes;
  - fills ≥ 3:1 against `bar-track`;
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
  - `onTimelinePick` fires;
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

- **Case "playback"**: 30,000 projects, downtown at zoom 15.5, pitch 55. It pans as the existing bench does while `setTime` advances 91.31 days/s from Day 20742. Pass at p95 ≤ 16.7 ms.
- **Case "drag"**: the same pan while `setTime` sweeps the full range in 2 s, back and forth. Pass at p95 ≤ 16.7 ms.
- Both cases print the pump's maximum per-frame operations. Results get a row in `docs/dev/map-perf.md`. 30,000 projects is a tier-4 stress size: about 1.5× the high end of the design's buildout expectations, at ~10–25 units per project.

## 7. Acceptance criteria

1. `applyTimeline` and `setTime` exist on `SimMapHandle` with T7's signatures. `setTime` makes no deck prop change, layer clone, attribute update or feature-state call (fake-deps test). It meets §4.7's per-call budget, with the 30k/300 ratio ≤ 1.5.
2. For every fixture state, the GPU pixel class equals `evalPart` (client GPU test). Hidden parts are not pickable.
3. Floors turn solid bottom-up in whole floors, stall at ≤ 90% until completion and snap to full at `completeDay`. A construction death freezes them, turns them red and fades them out over 90 + 180 days.
4. A pre-construction death turns the ghost red for 90 days, then fades it over 180 days. The existing building stays.
5. A revision swaps the massing exactly at its day.
6. The existing building on each `demolish` parcel shows the `replaced` footprint from its day, and returns when scrubbed earlier. The pump catches up within ⌈k/2,000⌉ frames.
7. Bars appear at zoom ≥ 15 (or the project's `minZoom`), in 3–6 equal segments. Fill and colour follow §4.4.2–4.4.3. Exited bars are `bar-dead`, and no bar shows before lookups arrive.
8. Every new token exists in both themes and passes the §6 palette tests.
9. With no `applyTimeline` call, the editor makes no new request and renders no new layer, and all existing map tests pass unmodified.
10. Both `bench:map` timeline cases pass at p95 ≤ 16.7 ms on the reference machine, with a row recorded in `docs/dev/map-perf.md`.
11. `npm run check`, `npm run lint` and `npm run test:unit` pass.

## 8. Open questions

- **OQ-1. On-map exit-reason text.** The mockup shows "withdrawn" over a dying bar. *Recommend: not in this package.* Text needs `TextLayer` with time-gated sublayers, and it adds clutter. The card shows the reason.
- **OQ-2. Default playback speed** (fzp-mode owns it). *Recommend 1 simulated year per 4 s* (the full run in ≈ 97 s). The wall-clock figures in §4.7 assume it.
- **OQ-3. Ghost edges.** The mockup strokes ghost edges. `SolidPolygonLayer`'s `wireframe` adds a third model per layer (`solid-polygon-layer.ts:328-332`). *Recommend off.* Face lighting already separates the faces; revisit after the partner's visual review.
