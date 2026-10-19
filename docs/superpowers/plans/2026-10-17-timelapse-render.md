# timelapse-render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement T7: render a FZP timeline (ghosts, construction, completion, deaths, progress bars, demolition of existing buildings) on the map, with every visible state decided on the GPU from a `day` uniform, so `setTime` is O(1) in JS.

**Architecture:** The worker packs each cell with `packTimedCell` (pure). On the main thread a `TimelineController` (deps-injected like `GeneratedController`) installs cells as two `SolidPolygonLayer`s each (solid pass and ghost pass), both carrying one shared `TimelapseExtension` whose shader decides each part's state from per-part attributes and a mutable clock. One custom `StageBarLayer` draws the progress bars from instanced attributes plus a chance texture. A `DemolishPump` moves a sorted cursor over the `demolish` list with at most 2,000 feature-state calls per frame. `SimMap` enters timeline mode on the first `applyTimeline` and lazy-imports the deck-side code.

**Tech Stack:** TypeScript, Svelte 5, deck.gl 9.4.0 (`@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/maplibre`), luma.gl 9.4.2 (`@luma.gl/engine` becomes direct), MapLibre GL 6.13, Vitest (server = Node, client = Playwright Chromium), Playwright e2e and bench.

**Spec:** `docs/superpowers/specs/2026-10-16-timelapse-render-design.md` (design: `docs/superpowers/design/2026-10-16-1903-fzp-timelapse.md`). Executors read the spec section each task cites; the plan does not restate the spec's tables.

## Global Constraints

Copied from spec §3 (verbatim) plus the assignment's rulings:

- **Evidence hierarchy.** No number reaches the simulation without a tier and a source. A tier-3 or tier-4 number is never presented as data.
- **Determinism.** The same `datasetVersion` and seed always give the same future, on every machine.
- **Time scrubbing performance.** At 60 fps on a 2022-era laptop with the whole city's timeline loaded, per-frame JS during scrub or playback is O(1) in project count.
- **First paint.** `/fzp` must not require loading every parcel chunk. Geometry streams with the viewport, as on `/`.
- **The editor is unchanged.** `/` and `/p/:id` behave exactly as before. FZP mode is additive.
- **Map budgets in FZP mode.** Two deck layers per cell are allowed for timeline cells: translucency needs them. This is an exception to map-view's one-layer-per-cell rule, so a `bench:map` timeline scenario must pass the same p95 frame bar. The existing-building catch-up stays within 2,000 feature-state changes per frame.
- **Accessibility.** WCAG 2.2 AA as in `docs/dev/accessibility.md`. (This subsystem adds no DOM.)
- **Ruling A1:** `OPEN_DAY` is `Math.fround(3.0e38)`. Compare with the exported constant from `src/lib/timelapse/time.ts`, never a `3.0e38` literal, in JS and in any shader-uniform upload. No GLSL source contains a `3.0e38` literal.
- **Time constants** (`MONTH_DAYS`, `monthsIn`, `OPEN_DAY`, `DYING_DAYS = 270`) are imported from `src/lib/timelapse/time.ts`; nothing redefines them.
- **Step-0 declarations are read-only.** `TimedPackedCell`, `TimelineUpdate`, the `SimMapHandle` timeline methods and `SimMapProps.timelinePick` in `src/lib/map/types.ts`, the T5/T6 types in `src/lib/sim/scenario/types.ts` (including `Massing`), T1/T2 types: implement against them, never redeclare or edit them. A needed change is an interface request to the operator, who escalates.
- **T12 bodies are not implemented** (`chanceTable`/`typicalMonths` throw). Use only their return types; tests use hand-made lookups (`src/lib/map/fixtures/timeline-lookups.ts`).
- **Display constants are tier 4**, named and commented as such where defined: ghost alpha 0.28 light / 0.35 dark; bar zoom gate 15 with a 0.5-zoom ramp; bar 32–48 × 6–8 px, 10 px offset; fill cap 0.9; death hold 90 d then fade `DYING_DAYS − 90` = 180 d; completed bar hold/fade 90/90 d; chance ramp stops 0.15/0.45/0.75; declutter ladder 15…18 step 0.5; `FOOTPRINT_M` = 1 m. Floor heights 3.1 m / ground 4.5 m are imported from `src/lib/generator/constants.ts` (`FTF_M`, `GROUND_FTF_M`).
- **No on-map exit labels; ghost edges (wireframe) off.** Playback speeds belong to fzp-mode.
- Code style: 2-space indent, single quotes, no trailing commas, 100 columns. Conventional Commits. Every Vitest test calls `expect` (`expect.requireAssertions`). Never compound `cd` with another command; `cd` to the worktree in its own call first.
- Runtime dependencies that ship in the bundle get a credit in `SOFTWARE` (`src/lib/attribution.ts`).
- Worktree: `/Users/mindlace/Projects/sfhousing/.claude/worktrees/fzp-timelapse/.claude/worktrees/fzp-timelapse-render`, branch `fzp/timelapse-render`. Do not merge, do not run `npm run signoff`, do not push.

## Review Focus

1. **One parcel in two `demolish` entries** (two projects on the same parcel, e.g. fixture slot (h) shares (a)'s parcel): scrubbing back past the later entry must not restore a building the earlier entry still demolishes. Pinned in Task 7 (reference counting).
2. **A revision-0 snapshot while the pump or a slice queue is mid-flight**, or a jump backward across thousands of entries: no stale frame keeps running, the cursor restarts from 0 and converges to the current day. Pinned in Task 7 and Task 10.
3. **Calls in an unusual order:** `setTime`/`setTimelineLookups` before `applyTimeline`, `applyTimeline` before the map is ready, and a remount (new manifest) while in timeline mode. Each must end in the same rendered state as the normal order. Pinned in Task 11.
4. **Lookups arriving after cells are installed:** construction floors and bars must appear without re-sending the timeline (`tlC` `updateTriggers`, bar rebuild). Pinned in Task 10.
5. **Pointer moving from a timeline part to empty map or to an existing building, with `timelinePick` set:** exactly one `timelinePick(null)` on leaving the part, and the existing-building tooltip still works. Pinned in Task 11.

---

## File Structure

| file | responsibility |
|---|---|
| `src/lib/map/palette.ts` (modify) | `tl-*` tokens, `TimelineLegendEntry`, `TIMELINE_LEGEND` |
| `src/lib/map/pack.ts` (modify) | extract `renderParts(b)` (merged occupied runs, normalised CW rings, appearance) shared by `packCell` and `packTimedCell` |
| `src/lib/map/pack-timed.ts` | `TimedPackInput`, `packTimedCell`, `FOOTPRINT_M`, `packTimedTransferables` (pure, worker-safe) |
| `src/lib/map/timelapse/types.ts` | `TimelineLookups`, `PartState`, `PartAttrs`, `PartEval`, `BarAttrs`, `BarEval`, `TimelineSnapshot`, `TimelineClock` |
| `src/lib/map/timelapse/constants.ts` | the tier-4 display constants above, one place |
| `src/lib/map/timelapse/encode.ts` | `TINT_GROUP`, `validateTimedCell`, `encodeParts`, `partAttrs`, `typicalDays` |
| `src/lib/map/timelapse/state.ts` | `evalPart` (CPU reference of the shader) |
| `src/lib/map/timelapse/bars.ts` | `BAR_SEGMENTS`, `buildBars`, `evalBar`, `barSizePx`, `rampColor` |
| `src/lib/map/timelapse/lookups.ts` | `packChanceTexture` |
| `src/lib/map/timelapse/declutter.ts` | `declutter`, `mpp` |
| `src/lib/map/timelapse/demolish.ts` | `DemolishPump` |
| `src/lib/map/timelapse/shader.ts` | `timelapse` shader module and GLSL injections |
| `src/lib/map/timelapse/extension.ts` | `TimelapseExtension` |
| `src/lib/map/timelapse/stage-bar-layer.ts` | `StageBarLayer` |
| `src/lib/map/timelapse/deck.ts` | lazy entry: re-exports `TimelapseExtension`, `StageBarLayer` |
| `src/lib/map/timeline-controller.ts` | `TimelineController`, `TimelineDeps` |
| `src/lib/map/SimMap.svelte`, `cull.ts`, `generated-controller.ts`, `debug.ts` (modify) | timeline mode, regexes, picking, debug hook |
| fixtures/tests | `src/lib/map/fixtures/timeline-small.ts`, `timeline-lookups.ts`, `src/lib/map/test/synthetic-timeline.ts`, `src/lib/map/test/fake-timeline-deps.ts`, `e2e/fixtures/timeline/fixture0-timeline.json` |

---

### Task 1: Timeline tokens and legend

**Files:**
- Modify: `src/lib/map/palette.ts`
- Test: `src/lib/map/palette.spec.ts` (add a `describe('timeline tokens')` block; existing tests unchanged)

**Interfaces:**
- Produces: `TokenName` gains `'tl-ghost-planning' | 'tl-ghost-permit' | 'tl-ghost-ready' | 'tl-ghost-dying' | 'tl-bar-track' | 'tl-bar-edge' | 'tl-bar-likely' | 'tl-bar-uncertain' | 'tl-bar-unlikely' | 'tl-bar-dead'`; `export interface TimelineLegendEntry { id: string; kind: 'ghost' | 'solid' | 'bar'; tokens: TokenName[]; label: string }`; `export const TIMELINE_LEGEND: readonly TimelineLegendEntry[]`.

- [ ] **Step 1: Write the failing tests.** For both themes: every `tl-*` token exists with the spec §4.6 hex (assert two verbatim, e.g. `TOKENS.light['tl-ghost-planning'] === '#9DB0FF'`, `TOKENS.dark['tl-bar-dead'] === '#8F8A80'`); `tl-bar-likely|uncertain|unlikely|dead` each ≥ 3:1 against `tl-bar-track`; `tl-bar-edge` ≥ 3:1 against `tl-bar-track`; ghost hues (culori `hsl`) in [220, 240]; CIELAB L of planning→permit→ready strictly decreases in light and strictly increases in dark; ΔE2000 ≥ 20 between each of the four ghost tints and `existing`. `TIMELINE_LEGEND`: ids in order `['planning','permit','ready','building','complete','stopped','chance','bar-stopped']`, unique, every token in `TOKENS.light` and `TOKENS.dark`, labels verbatim from §4.6 (assert `'Stopped: withdrawn, disapproved, cancelled or expired'`), `complete.tokens` equals the six `gen-*` in `TYPOLOGY_ORDER` order, `building.tokens` = `['tl-ghost-ready','gen-walkup']`. Reuse the file's `luminance`/`contrast`/`de` helpers.
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/map/palette.spec.ts` — Expected: FAIL (tokens missing).
- [ ] **Step 3: Implement** the tokens (spec §4.6 table, both themes) and `TIMELINE_LEGEND` (§4.6 legend table, in order). The SSR CSS (`SimMap.svelte` `tokenVars`) picks them up as `--map-tl-*` automatically; do not touch SimMap.
- [ ] **Step 4: Run** the same command — Expected: PASS. Also `npx vitest run --project server src/lib/map/` stays green.
- [ ] **Step 5: Commit** `feat(map): add timeline tl-* tokens and TIMELINE_LEGEND`

---

### Task 2: `packTimedCell`

**Files:**
- Modify: `src/lib/map/pack.ts` (extract helper; `packCell` output byte-identical)
- Create: `src/lib/map/pack-timed.ts`
- Test: `src/lib/map/pack-timed.spec.ts` (server); `src/lib/map/pack.spec.ts` must pass unmodified

**Interfaces:**
- Consumes: `Schedule`, `Massing` from `$lib/sim/scenario/types` (type-only); `STAGE_ORDER`, `PATHWAYS` from `$lib/timelapse/types`; `OPEN_DAY` from `$lib/timelapse/time`.
- Produces:
  - `pack.ts`: `export function renderParts(b: GeneratedBuilding): { ring: [number, number][]; topM: number; appearance: number }[]` and `export function normaliseRing(...)` (now exported). `packCell` calls `renderParts`.
  - `pack-timed.ts`: `export interface TimedPackInput { schedule: Schedule; massings: Massing[]; pickParcelId: ParcelId }`, `export const FOOTPRINT_M = 1` (tier 4 comment), `export function packTimedCell(cellId: string, items: readonly TimedPackInput[]): TimedPackedCell`, `export function packTimedTransferables(p: TimedPackedCell): ArrayBuffer[]`.

Rules (spec §4.1.1): slots sorted by `schedule.projectId` (code-unit `<`, as `packCell`); slot `parcelIds[s] = pickParcelId`; `parcelMeta[4s..]` = `[revisions.at(-1).units, schedule.existingUnits, finalStories, finalTypologyIdx]` where final stories/typology come from the final massing (`b.stories`, `TYPOLOGY_ORDER.indexOf(b.typology)`), and are `0, 0` for a footprint. Parts in slot order, revision order within a slot; revision *i*'s parts get `partWindow = [revisions[i].day, revisions[i+1]?.day ?? OPEN_DAY]`. A footprint entry contributes one part: `normaliseRing(footprint)`, `partTopM = FOOTPRINT_M`, appearance 0, typology 0. `slotStages[7s+j] = schedule.entered[STAGE_ORDER[j]] ?? NaN`; `slotEnd[2s..] = [end.kind === 'open' ? NaN : end.day, {open:0, complete:1, exit:2}[end.kind]]`; `slotPathway[s] = PATHWAYS.indexOf(pathway)`. Building `source` is not checked (every T10 source accepted). Throws `Error` naming the cell and project on: `massings.length !== revisions.length`; `revisions.length === 0`; a revision day lower than its predecessor (equal days are allowed and yield an empty window); duplicate `projectId`; unknown typology.

- [ ] **Step 1: Write the failing tests** in `pack-timed.spec.ts`, building inputs from `fixtures/generated-small.json` with hand-made `Schedule` objects: slots sorted by projectId and two slots sharing one `pickParcelId` allowed; `parcelMeta` from the final revision (units from schedule, stories from final building); a two-revision slot's `partWindow` = `[d0, d1, …, d1, OPEN_DAY]` and `partWindow[last] === OPEN_DAY`; a footprint-only slot (both revisions footprints) has `partTopM` all `FOOTPRINT_M`, `parcelMeta[4s+2] === 0`; NaN in `slotStages` for never-entered stages; `slotEnd` for each kind; packing the same input twice gives byte-identical buffers (compare every typed array with `toEqual` on `Array.from` of the bytes); each throw case throws with a message containing the cellId; `packTimedTransferables` returns 11 distinct `ArrayBuffer`s covering every typed array (the 7 of `packTransferables` plus `partWindow`, `slotStages`, `slotEnd`, `slotPathway`).
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/map/pack-timed.spec.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `renderParts` in `pack.ts` (move the existing merge loop and `normaliseRing`/`encodeAppearance` calls unchanged), then `pack-timed.ts`. The file imports nothing from DOM, zod, `$app`, deck or luma.
- [ ] **Step 4: Run** `npx vitest run --project server src/lib/map/pack-timed.spec.ts src/lib/map/pack.spec.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(map): add packTimedCell for timeline cells`

---

### Task 3: Fixtures, timeline types and GPU-attribute encoding

**Files:**
- Create: `src/lib/map/timelapse/types.ts`, `src/lib/map/timelapse/constants.ts`, `src/lib/map/timelapse/encode.ts`, `src/lib/map/fixtures/timeline-small.ts`, `src/lib/map/fixtures/timeline-lookups.ts`
- Test: `src/lib/map/timelapse/encode.spec.ts` (server)

**Interfaces:**
- Consumes: Task 2 `packTimedCell`.
- Produces:
  - `types.ts`: `export type TimelineLookups = Parameters<SimMapHandle['setTimelineLookups']>[0]`; `export type PartState = 'hidden' | 'planning' | 'permit' | 'ready' | 'constructing' | 'complete' | 'dying'`; `export interface PartAttrs { partFrom; partTo; ghostFrom; endDay; permitDay; readyDay; constructionDay; completeDay; endKind; constructionTypicalDays; stories; groundFtfM }` (all `number`, the §4.2.1 table's fields in its order); `export interface PartEval { state: PartState; alpha: number; zCutM: number }`; `export interface BarAttrs` (Task 5 fills it); `export interface BarEval { visible: boolean; fill: number; segCount: number; chance: number | null; dead: boolean; alpha: number }`; `export interface TimelineSnapshot` exactly as spec §2.1; `export interface TimelineClock { day: Day; theme: Theme }`.
  - `constants.ts`: `GHOST_ALPHA: Record<Theme, number>` = `{ light: 0.28, dark: 0.35 }`, `DYING_HOLD_DAYS = 90`, `DYING_FADE_DAYS = DYING_DAYS - DYING_HOLD_DAYS`, `FLOOR_CAP = 0.9`, `BAR_MIN_ZOOM = 15`, `BAR_ZOOM_RAMP = 0.5`, `BAR_OFFSET_PX = 10`, `BAR_TOP_GAP_M = 2`, `COMPLETE_HOLD_DAYS = 90`, `COMPLETE_FADE_DAYS = 90`, `RAMP_STOPS = [0.15, 0.45, 0.75] as const`, `DECLUTTER_MAX_ZOOM = 18`, `DECLUTTER_STEP = 0.5`. Each with a one-line "tier 4: <source>" comment from spec §4.9.
  - `encode.ts`: `export const TINT_GROUP: Record<Stage, 'planning' | 'permit' | 'ready'>` (preApplication, filed → planning; entitled, permitFiled → permit; permitIssued, construction, complete → ready); `export function validateTimedCell(c: TimedPackedCell): void` (throws `TypeError` naming the cell for each §4.1 "Validation" rule); `export function typicalDays(l: TimelineLookups | null, pathway: Pathway, stage: Exclude<Stage,'complete'>): number` (months · `MONTH_DAYS`; `OPEN_DAY` when `l` is null or the entry is missing or non-finite); `export interface EncodedParts { tlA: Float32Array; tlB: Float32Array; tlC: Float32Array }` (each `4 · partCount`); `export function encodeParts(c: TimedPackedCell, l: TimelineLookups | null): EncodedParts`; `export function partAttrs(e: EncodedParts, k: number): PartAttrs`.
  - `fixtures/timeline-small.ts`: `export const timelineSmall: TimelineUpdate` (revision 0), `export const timelineSmallRev1: TimelineUpdate`, `export const SLOT: Record<'a'|'b'|'c'|'d'|'e'|'f'|'g'|'h'|'i1'|'i2', { projectId: string; cellId: string }>` and `export const DAYS` (the named stage/end days used by golden tests).
  - `fixtures/timeline-lookups.ts`: `export const timelineLookups: TimelineLookups`.

Encoding (spec §4.2.1, §4.1 "Encoding"): every NaN day becomes `OPEN_DAY`. `ghostFrom` = min of the slot's 7 stage days; `permitDay` = min of days whose `TINT_GROUP` is `'permit'`; `readyDay` = `permitIssued`; `completeDay` = `endDay` if kind 1 else `OPEN_DAY`; `constructionTypicalDays = typicalDays(l, pathway, 'construction')`; `stories = parcelMeta[4s+2]`; `groundFtfM = GROUND_FTF_M` for typologies podium/midrise/tower, else `FTF_M`.

Fixture content: spec §6 "Fixtures" (a)–(i), ten slots in at least two cells (`'tl-A'`, `'tl-B'`) over `parcels-small.json`/`generated-small.json`; days are integers between 20742 and 29584; demolish entries for (a), (c), (e) plus one for (h) on (a)'s parcel at a later day (Review Focus 1). `timelineSmallRev1` = revision 1 repacking `tl-A` (e.g. (d) gains a third revision), removing `tl-B`, `demolish: []`. Lookups: `chance` with 241-entry rows for every occupiable pair except one absent row (`discretionary.preApplication`), values a deterministic ramp; `typicalMonths` with every entry except `streamlined.permitFiled`.

- [ ] **Step 1: Write the failing tests** in `encode.spec.ts`: on `timelineSmall`, for (g) (`entitled` NaN) `permitDay === permitFiled day`; `ghostFrom` = first entered stage (PPA day for (a)); open slot (c) has `endDay === OPEN_DAY` and `completeDay === OPEN_DAY`; `groundFtfM` 4.5 for a midrise part and 3.1 for a walkup part; `constructionTypicalDays` is `OPEN_DAY` with `l = null` and `typicalMonths.<pathway>.construction * MONTH_DAYS` with `timelineLookups`; `typicalDays(timelineLookups, 'streamlined', 'permitFiled') === OPEN_DAY`; `validateTimedCell` throws `TypeError` (message contains the cellId) for each of the seven malformed-length/out-of-range cases (mutate a structured clone of a fixture cell).
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/map/timelapse/encode.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the five files.
- [ ] **Step 4: Run** the same command — Expected: PASS. `npm run check` clean for the new files.
- [ ] **Step 5: Commit** `feat(map): add timeline fixtures and part attribute encoding`

---

### Task 4: `evalPart` (CPU reference of the shader)

**Files:**
- Create: `src/lib/map/timelapse/state.ts`
- Test: `src/lib/map/timelapse/state.spec.ts` (server)

**Interfaces:**
- Consumes: Task 3 `PartAttrs`, `partAttrs`, `encodeParts`, fixtures, constants.
- Produces: `export function evalPart(a: PartAttrs, t: Day): PartEval`.

Rules: spec §4.2.3 rules 1–5, in order, with these decisions:
- `alpha` is the fade factor: 0 hidden; `f` while dying (`f = age < DYING_HOLD_DAYS ? 1 : 1 − (age − DYING_HOLD_DAYS)/DYING_FADE_DAYS`); 1 otherwise. Theme alpha (`GHOST_ALPHA`) is applied by the shader, not here.
- `zCutM`: 0 for hidden and ghost states; `OPEN_DAY` for complete; for constructing `n = floor(min((t − constructionDay)/constructionTypicalDays, FLOOR_CAP) · stories)`, `zCut = n === 0 ? 0 : groundFtfM + (n − 1)·FTF_M`; while dying, the same formula evaluated at `min(t, endDay)` if `constructionDay ≤ endDay`, else 0.
- Footprint-only (`stories === 0`) never returns `'constructing'` or `'complete'`: at or after `constructionDay` (and not dying) it returns `'ready'` with `zCutM = 0`.

- [ ] **Step 1: Write the failing golden table** `state.spec.ts` over `timelineSmall` parts (via `encodeParts(cell, timelineLookups)` + `partAttrs`), one `it` per spec §6 `state.spec` bullet: hidden at `ghostFrom − 1`, `'planning'` at `ghostFrom`; tint flips to `'permit'` exactly at `permitDay` and `'ready'` at `readyDay`; `zCutM` 0 at p = 0, the floor at p = 0.5 (days chosen mid-floor, not on a floor boundary), the 0.9 cap just before `completeDay`, and `'complete'` exactly at `completeDay`; (d)'s revision 0 part visible at `d1 − 1` and hidden at `d1` while its revision 1 part is the reverse; (b) dying: `alpha` is 1 at `end`, `end + 89` and `end + 90`, `1/180` at `end + 269` (`toBeCloseTo`), and the state is `'hidden'` at `end + 270`; (e) construction death keeps `zCutM` equal at `end` and `end + 100`; (c) open window still visible at Day 29584; (h) footprint-only never `'constructing'`/`'complete'` for every day in a sweep from 20742 to 29584 step 7.
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/map/timelapse/state.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `evalPart`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(map): add evalPart timeline state reference`

---

### Task 5: Bars, ramp and chance texture packing

**Files:**
- Create: `src/lib/map/timelapse/bars.ts`, `src/lib/map/timelapse/lookups.ts`
- Modify: `src/lib/map/timelapse/types.ts` (`BarAttrs`)
- Test: `src/lib/map/timelapse/bars.spec.ts`, `src/lib/map/timelapse/lookups.spec.ts` (server)

**Interfaces:**
- Consumes: Tasks 3–4; `TOKENS`.
- Produces:
  - `export const BAR_SEGMENTS: Record<Pathway, Stage[]>` (spec §4.4.2 table, without `preApplication`; it is prepended per slot when entered).
  - `export interface BarAttrs { projectId: string; parcelId: ParcelId; units: number; pathway: number; anchor: [lng: number, lat: number, z: number]; from: Day /* max(ghostFrom, revision from) */; to: Day /* min(revision to, barEnd) */; barEnd: Day; endDay: Day; endKind: number; completeDay: Day; segCount: number; segEntry: number[] /* effective entry day per segment, length segCount */; segTypicalDays: number[]; segRow: number[] /* chance texture row per segment */ ; minZoom: number }`.
  - `export function buildBars(cells: Iterable<TimedPackedCell>, l: TimelineLookups): BarAttrs[]` — one entry per (slot, revision) with parts; `minZoom` filled by Task 6's `declutter` (initially `BAR_MIN_ZOOM`).
  - `export function evalBar(b: BarAttrs, l: TimelineLookups, t: Day, zoom: number): BarEval`.
  - `export function barSizePx(zoom: number): { w: number; h: number }`.
  - `export function rampColor(c: number, theme: Theme): RGBA` (linear-RGB piecewise blend through `tl-bar-unlikely` ≤ 0.15, `tl-bar-uncertain` at 0.45, `tl-bar-likely` ≥ 0.75; returns sRGB 0–255).
  - `lookups.ts`: `export function packChanceTexture(chance: TimelineLookups['chance']): { data: Uint8Array; width: number; height: 18 }` — row `PATHWAYS.indexOf(p)·6 + STAGE_ORDER.indexOf(stage)`, `round(c·255)`, short rows padded with their last value, absent rows 0, `RangeError` if any row length > 2048.

Rules: spec §4.4.1–§4.4.3. Effective entry: `segEntry[k]` = the stage's entry day if finite, else the minimum of the later segments' effective entries, else `OPEN_DAY` (this implements "a skipped stage counts as passed once a later stage has started"). Anchor: centre of the revision's parts' lng/lat bbox, `z = max(partTopM of that revision) + BAR_TOP_GAP_M`. `barEnd`: exit → `endDay + DYING_DAYS`; complete → `completeDay + COMPLETE_HOLD_DAYS + COMPLETE_FADE_DAYS`; open → `OPEN_DAY`. `evalBar`: visible iff `from ≤ t < to` and zoom alpha > 0; `alpha = zoomAlpha · timeAlpha` where `zoomAlpha = clamp((zoom − (max(BAR_MIN_ZOOM, minZoom) − BAR_ZOOM_RAMP)) / BAR_ZOOM_RAMP, 0, 1)` and `timeAlpha` = the dying `f` after an exit, the completed hold/fade after completion, else 1. Fill per §4.4.2 using `tEff = endKind === 2 ? min(t, endDay) : t`; fill 1 when `t ≥ completeDay`. `chance`: null when dead or complete, else `chance[pathway][stage_k][min(monthsIn(entry_k, tEff), len − 1)]`.

- [ ] **Step 1: Write the failing tests.** `bars.spec.ts`: segCount 6 for discretionary with PPA, 5 without, 4 for permitOnly with PPA, 3 without; fill for (g) treats skipped `entitled` as passed (k advances to `permitFiled` segment at its day); fill never reaches `(k+1)/segCount` before the next entry (cap 0.9) and is 1 at `completeDay`; chance index at `entry + k·MONTH_DAYS` exactly (k = 0, 1, 240, 300 → index clamps to 240) matches `monthsIn`; exited bar has `dead: true`, `chance: null`; property (fast-check, 200 runs): for every `c ∈ [0, 1]` and both themes, `rampColor(c)` has ≥ 3:1 contrast against `tl-bar-track`; `barSizePx(15) = {w: 32, h: 6}`, `barSizePx(17) = {w: 48, h: 8}`, `barSizePx(19)` = same as 17. `lookups.spec.ts`: row order (assert row 6·1 + 3 = `streamlined.permitFiled`), padding a 10-entry row to width, absent row zeros, `RangeError` above 2048; `typicalDays` missing → `OPEN_DAY` and `constructionTypicalDays = typicalMonths · MONTH_DAYS` (re-assert via `encodeParts`).
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/map/timelapse/bars.spec.ts src/lib/map/timelapse/lookups.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(map): add stage bar model, chance ramp and texture packing`

---

### Task 6: Declutter

**Files:**
- Create: `src/lib/map/timelapse/declutter.ts`
- Test: `src/lib/map/timelapse/declutter.spec.ts` (server)

**Interfaces:**
- Consumes: Task 5 `BarAttrs`, `barSizePx`; constants.
- Produces: `export function mpp(z: number, lat: number): number` (`40075016.686 · cos(lat·π/180) / (512 · 2^z)`); `export function declutter(bars: BarAttrs[]): void` — sets `minZoom` on every bar in place.

Rules: spec §4.4.4. Declutter is per project: all of a project's bars (its revisions) share one `minZoom`, computed from its final revision's anchor and its whole active interval `[min from, max to)`. Priority: final units descending, then `parcelId` ascending, then `projectId` ascending (total order, for determinism). For project *i*, `minZoom_i` = smallest *z* in {15, 15.5, …, 18} such that for every higher-priority *j* whose interval overlaps, `dist(i, j) ≥ W(z′)·mpp(z′, lat_i)` with `z′ = max(z, minZoom_j)`; 18 if none passes. Distance: equirectangular metres at `lat_i`. Uniform grid with cell size `W(15)·mpp(15, 37.75)` metres (the largest conflict distance); check the 3×3 neighbourhood.

- [ ] **Step 1: Write the failing tests:** same input twice → same `minZoom`s; two co-located, time-disjoint projects both get 15; two co-located, overlapping projects: the larger-units one gets 15 and the other a higher zoom; property (fast-check, 100 runs of ≤ 60 random bars in a 300 m square with random intervals): for every overlapping pair and every z in the ladder below 18 at which both show (`z ≥ max(minZoom_i, minZoom_j)`), the anchor distance ≥ `W(z)·mpp(z)`; 30,000 synthetic bars across the SF bbox decluttered in ≤ 50 ms (`performance.now()`, best of 3).
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/map/timelapse/declutter.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(map): add stage bar declutter`

---

### Task 7: Demolish pump

**Files:**
- Create: `src/lib/map/timelapse/demolish.ts`
- Test: `src/lib/map/timelapse/demolish.spec.ts` (server)

**Interfaces:**
- Consumes: `SLICE_IDS` from `src/lib/map/hide.ts`.
- Produces:
```ts
export interface PumpDeps {
  setReplaced(id: ParcelId): void;
  clearReplaced(id: ParcelId): void;
  clearAllReplaced(): void;
  raf(cb: (t: number) => void): number;
  cancelRaf(h: number): void;
}
export class DemolishPump {
  constructor(deps: PumpDeps);
  replace(list: readonly { parcelId: ParcelId; day: Day }[]): void; // rev 0: clearAllReplaced, cursor 0
  setTarget(day: Day): void;           // O(1): schedules one frame only on a crossing
  has(id: ParcelId): boolean;          // applied-set membership (O(1))
  readonly applied: number; readonly total: number; readonly pending: boolean;
  appliedIds(): Iterable<ParcelId>;    // for retryBuildings
  lastFrameOps: number; maxFrameOps: number; // bench reporting
  destroy(): void;
}
```

Rules: spec §4.5. Sorted by `(day, parcelId)`; entry *i* is applied iff `day_i ≤ target`. Crossing check: `(applied < total && days[applied] ≤ target) || (applied > 0 && days[applied − 1] > target)`. Each frame moves the cursor toward the target by at most `SLICE_IDS` entries, then reschedules if not converged. A parcel is reference-counted across entries: `setReplaced` on 0→1, `clearReplaced` on 1→0, so a parcel in two entries is cleared only when both are unapplied (Review Focus 1). `replace` cancels any pending frame first (Review Focus 2). Days stored in a `Float64Array`.

- [ ] **Step 1: Write the failing tests** with a recording fake (calls + manual `flushFrame`): 5,000 entries, `setTarget(max)` → frame 1 makes exactly 2,000 `setReplaced`, frame 3 converges, `pending` false; `setTarget(min − 1)` → 2,000 `clearReplaced` per frame back to 0; `setTarget` within the same gap between two entry days schedules no frame (`pendingFrames() === 0`) and crossing one day schedules exactly one; a parcel in two entries stays replaced (and `has` true) when the target is between the two days and is cleared below both; `replace` mid-flight: the old frame callback never runs (cancelled), `clearAllReplaced` called once, then convergence to the current target; `has` reflects the applied set.
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/map/timelapse/demolish.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(map): add time-driven demolish pump`

---

### Task 8: `TimelapseExtension` and its GPU test

**Files:**
- Create: `src/lib/map/timelapse/shader.ts`, `src/lib/map/timelapse/extension.ts`
- Test: `src/lib/map/timelapse/timelapse-extension.gpu.svelte.spec.ts` (client)

**Interfaces:**
- Consumes: Tasks 3–4 (`encodeParts`, `evalPart`, constants), `TimelineClock`, `TOKENS`, `hexToRgba`.
- Produces:
  - `extension.ts`: `export class TimelapseExtension extends LayerExtension<{ clock: TimelineClock }>` with `static extensionName = 'TimelapseExtension'` and `static defaultProps = { getTlA: {type:'accessor', value:[0,0,0,0]}, getTlB: …, getTlC: …, timelapsePass: 0 }`. Layers pass `extensions: [ext]`, `timelapsePass: 0 | 1`, and accessors `getTlA/getTlB/getTlC: (_, {index}) => number[]` reading `EncodedParts`.
  - `shader.ts`: `export const timelapseModule` (luma `ShaderModule` with a std140 `timelapseUniforms` block: `day`, `pass`, `ghostAlpha`, `dyingHoldDays`, `dyingFadeDays`, `ftfM`, `tintPlanning`, `tintPermit`, `tintReady`, `tintDying` as vec3), and `export const TIMELAPSE_INJECT` (`vs:#decl`, `vs:#main-end`, `fs:#decl`, `fs:DECKGL_FILTER_COLOR`).

Mechanism: spec §4.2 (decision, attributes, uniforms, rules, fragment table). Attributes: `attributeManager.add({ tlA: { size: 4, stepMode: 'dynamic', accessor: 'getTlA' }, tlB: …, tlC: … })` in `initializeState`, as `data-filter-extension.ts:166-173` does (spec §4.0). `draw` calls `this.setShaderModuleProps({ timelapse: { day: clock.day, pass: this.props.timelapsePass, ghostAlpha: GHOST_ALPHA[clock.theme], …tints from TOKENS[clock.theme] as 0–1 RGB } })`. In `vs:#main-end`: `tl_heightM = elevations * positions.y` under `#ifdef IS_SIDE_VERTEX` (the top shader has no `positions` attribute), else `elevations`; hidden → `gl_Position = vec4(0.)`. The ghost colour is `lighting_getLightColor(tint, project.cameraPosition, geometry.position.xyz, geometry.normal)`. Fragment logic per the §4.2.3 table, default injection order (before picking). The GLSL is a direct port of `evalPart`: keep the rule order and names identical so a reviewer can diff them. On a shader compile/link failure deck reports through its `onError`; nothing here catches it.

- [ ] **Step 1: Write the failing GPU test.** A standalone `new Deck({ canvas, width: 64, height: 64, useDevicePixels: false, deviceProps: { webgl: { preserveDrawingBuffer: true } }, views: new MapView(), viewState: top-down pitch 0 over the part, layers: [solid, ghost] })` with one large square part per state (one 4-slot `TimedPackedCell` from `packTimedCell` with hand-made schedules: one completing, one exiting pre-construction, one dying in construction, one footprint-only) and the fixture lookups. For 12 days covering rules 1–5 (hidden, planning, permit, ready, constructing below and above zCut seen top-down → ghost ready tint, complete, dying hold, dying fade, hidden after death, construction-death floors, footprint at completion), set `clock.day`, `deck.redraw('test')`, `readPixels` at the centre and classify the pixel: background (hidden), near the theme's ghost tint blended over the background, near a palette colour (complete), or red-dominant (dying); assert the class equals what `evalPart` gives for that part and day. A second assertion: `deck` reports no `onError` (shader compiled). Re-use the clock object across days (no layer re-creation between days: assert the layer instances are the same objects).
- [ ] **Step 2: Run** `npx vitest run --project client src/lib/map/timelapse/timelapse-extension.gpu.svelte.spec.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `shader.ts` and `extension.ts`.
- [ ] **Step 4: Run** — Expected: PASS. If the headless Chromium GPU path (SwiftShader) cannot render the test at all, stop and report BLOCKED with the error; do not weaken the assertions.
- [ ] **Step 5: Commit** `feat(map): add TimelapseExtension GPU state shader`

---

### Task 9: `StageBarLayer`, lazy deck entry and the `@luma.gl/engine` dependency

**Files:**
- Create: `src/lib/map/timelapse/stage-bar-layer.ts`, `src/lib/map/timelapse/deck.ts`
- Modify: `package.json` (`"@luma.gl/engine": "~9.4.0"` in `dependencies`; run `npm install` so the lockfile records it), `src/lib/attribution.ts` (`{ name: 'luma.gl', license: 'MIT', url: 'https://luma.gl' }` in `SOFTWARE`)
- Test: `src/lib/map/timelapse/stage-bar-layer.gpu.svelte.spec.ts` (client), `src/lib/attribution.spec.ts` or the existing attribution test (add a luma.gl assertion)

**Interfaces:**
- Consumes: Task 5 (`BarAttrs`, `barSizePx` constants, `rampColor` stops, `packChanceTexture`), Task 8 `TimelineClock`.
- Produces:
  - `export class StageBarLayer extends Layer<{ data: BarAttrs[]; chance: ReturnType<typeof packChanceTexture>; clock: TimelineClock }>` with id `timeline-bars`, not pickable, depth test on, depth writes off.
  - `deck.ts`: `export { TimelapseExtension } from './extension'; export { StageBarLayer } from './stage-bar-layer';` — the only module SimMap lazy-imports.

Mechanism: spec §4.4. A luma `Model` (from `@luma.gl/engine`) over an instanced 4-vertex triangle-strip quad, following deck's own `@deck.gl/layers` `line-layer` for model setup and `bitmap-layer` for binding a texture; instance attributes from `BarAttrs` with fp64 anchor positions (`project_position_to_clipspace` then a pixel offset via `project_pixel_size_to_clipspace`). Per-segment arrays (`segEntry`, `segTypicalDays`, `segRow`) go in vec4+vec2 attributes (6 segments max). The `r8unorm` chance texture is created from `props.chance` when its identity changes (previous texture destroyed) and read with `texelFetch`. The fragment shader draws the track, fill, colour (`tl-bar-dead` when exited, `tl-bar-likely` when complete, else the linear-RGB ramp of the texel), the 1 px `tl-bar-edge` border and separators. `draw` reads `clock.day` and the theme's colours (uniforms from `TOKENS[clock.theme]`, linearised on the CPU). Zoom gate and alpha in the shader from `project.scale` (`zoom = log2(scale)`). The GLSL ports `evalBar` with identical rule order.

- [ ] **Step 1: Write the failing tests.** GPU test (standalone `Deck`, 128×64, `preserveDrawingBuffer`, MapView top-down at zoom 17 on the anchor): one bar with known stage days and lookups; at a day in the second of 4 segments, `readPixels` at the left quarter of the bar is the ramp colour for the expected chance (± 12 per channel, compare with `rampColor`), at the right end is `tl-bar-track`; at zoom 14 nothing is drawn; an exited bar's fill pixel is `tl-bar-dead`; replacing `chance` with a new object re-uploads (a different texel value changes the pixel). Attribution test: `SOFTWARE` contains `luma.gl`; `package.json` `dependencies['@luma.gl/engine'] === '~9.4.0'`.
- [ ] **Step 2: Run** `npx vitest run --project client src/lib/map/timelapse/stage-bar-layer.gpu.svelte.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**, add the dependency and the credit.
- [ ] **Step 4: Run** both tests — Expected: PASS. `npm run check` clean.
- [ ] **Step 5: Commit** `feat(map): add StageBarLayer and luma.gl engine dependency`

---

### Task 10: `TimelineController`

**Files:**
- Create: `src/lib/map/timeline-controller.ts`, `src/lib/map/test/fake-timeline-deps.ts`
- Modify: `src/lib/map/cull.ts:28` (regex covers `^(generated|rising|timeline-(solid|ghost))-`), `src/lib/map/generated-controller.ts:114` (`RESERVED = /^(generated|rising|timeline)-/`)
- Test: `src/lib/map/timeline-controller.spec.ts` (server; deck classes construct under Node, verified); `cull.spec.ts` gains one case

**Interfaces:**
- Consumes: Tasks 2–9.
- Produces:
```ts
export interface TimelineDeps extends PumpDeps {
  setLayers(layers: Layer[]): void;
  SolidPolygonLayer: typeof SolidPolygonLayer;
  TimelapseExtension: typeof TimelapseExtension;
  StageBarLayer: typeof StageBarLayer;
  repaint(): void;            // map.triggerRepaint()
  onResyncNeeded(): void;
}
export interface TimelinePartLookup { projectId: string; parcelId: ParcelId; typology: TypologyId; stories: number; units: number; existingUnits: number }
export class TimelineController {
  constructor(deps: TimelineDeps, theme: Theme, labelBeforeId?: string);
  apply(u: TimelineUpdate): void;
  setTime(day: Day): void;
  setLookups(l: TimelineLookups): void;
  setTheme(t: Theme): void;
  setOverlayLayers(layers: Layer[]): void;
  lookup(layerId: string, index: number): TimelinePartLookup | null;
  readonly demolished: { has(id: ParcelId): boolean };   // the pump's applied set
  reapplyDemolished(): void;                              // retryBuildings
  debugSnapshot(): TimelineSnapshot;
  destroy(): void;
}
export const TIMELINE_PART_LAYER = /^timeline-(solid|ghost)-/;
```

Rules: spec §4.1 (mode-independent parts: ordering, band-only, slicing at `MAX_CELLS_PER_SLICE` cells + removed per frame, validation via `validateTimedCell` before install, late `demolish` ignored with one `console.error`), §4.3 (two layers per cell with the `generated-controller.ts` `accessorsFor` caching pattern and `registerCellBounds`; ids `timeline-solid-<cellId>` / `timeline-ghost-<cellId>`; ghost `parameters: { depthWriteEnabled: false }`; emit order solids by cellId, ghosts by cellId, `timeline-bars`, overlay; every layer carries `beforeId`; solids `pickable` + `autoHighlight`, ghosts `pickable`), §4.7 (`setTime`). One `TimelapseExtension` instance and one `clock` object per controller, created in the constructor. `setTime`: `RangeError` on non-finite; `clock.day = day; pump.setTarget(day); deps.repaint()` — nothing else (no allocation). `setTheme`: `clock.theme = t`, rebuild layers with the theme's fill accessor (same extension instance), emit. `setLookups`: store, re-encode `tlC` (bump an `updateTriggers.getTlC` counter), rebuild bars, emit. Bars: rebuilt (`buildBars` + `declutter`) only when lookups are set, and only when the slice queue has drained (once per update, not per slice); without lookups no `timeline-bars` layer is emitted, and dev builds (`import.meta.env.DEV`) `console.warn` once, on the first install without lookups (spec §4.4.3). A cell with zero parts emits no layers; an unknown removed cell is ignored. Revision 0 cancels queued slices, clears cells, `pump.replace(u.demolish)`, then installs in slices.

- [ ] **Step 1: Write the failing tests** with `makeFakeTimelineDeps()` (recording fake like `test/fake-deps.ts`: `layerHistory`, `events`, `replaced`, `resyncCount`, `repaintCount`, manual `flushFrame`, real deck classes): revision 2 after 0 → resync, nothing applied; band-only `{revision: 1, cells: [], removedCells: [], demolish: []}` → revision advances, `layerHistory`, `events` unchanged, no resync, then revision 2 accepted; a 9-cell snapshot installs 4, 4, 1 cells over three frames; emit order of ids after `timelineSmall` + lookups is `[timeline-solid-tl-A, timeline-solid-tl-B, timeline-ghost-tl-A, timeline-ghost-tl-B, timeline-bars, <overlay>]`; 1,000 `setTime` calls add no `layerHistory` entry and no `setReplaced`/`clearReplaced` event until a frame flushes, and `repaintCount` = 1,000; `setTime(NaN)` throws `RangeError`; a revision-1 update with non-empty `demolish` is applied with the list ignored and one `console.error` (spy); `setLookups` after install changes the ghost layers' `updateTriggers.getTlC` and adds `timeline-bars` (Review Focus 4); `setTheme` keeps `props.extensions[0]` the same instance; `lookup('timeline-ghost-tl-A', k)` returns the slot's `projectId` and pick parcel; `timelineSmallRev1` removes `tl-B`'s layers and its bars; validation failure throws `TypeError` from `apply`; `setOverlayLayers` with a `timeline-x` id throws. `cull.spec.ts`: a `timeline-ghost-` layer outside the view is culled.
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/map/timeline-controller.spec.ts src/lib/map/cull.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** those, plus `npx vitest run --project client src/lib/map/generated-controller.svelte.spec.ts` (unmodified, still green) — Expected: PASS.
- [ ] **Step 5: Commit** `feat(map): add TimelineController`

---

### Task 11: SimMap timeline mode, picking and debug hook

**Files:**
- Modify: `src/lib/map/SimMap.svelte`, `src/lib/map/debug.ts`
- Test: `src/lib/map/SimMap.timeline.svelte.spec.ts` (client); one new assertion appended to `src/lib/map/SimMap.svelte.spec.ts` (editor regression); all existing `SimMap*.svelte.spec.ts` otherwise unmodified

**Interfaces:**
- Consumes: Task 10 `TimelineController`, `TIMELINE_PART_LAYER`; Task 9 `deck.ts`.
- Produces: the real `applyTimeline`, `setTime`, `setTimelineLookups` on `SimMapHandle`; `timelinePick` prop behaviour; debug hook additions on `SfhMapDebug`: `applyTimeline(u)`, `setTime(day)`, `setTimelineLookups(l)`, `timelineSnapshot(): TimelineSnapshot | null`, `loadSyntheticTimeline(seed: number, n: number): Promise<{ projects: number; cells: number }>` (Task 12 implements its body), `readonly demolishMaxFrameOps: number`.

Rules: spec §4.1 "Mode", §4.8. Decisions:
- Handle-level state that outlives a remount: `timelineMode: boolean`, `pendingTimeline: TimelineUpdate[]` (revision 0 drops the queue), `pendingDay: Day | null`, `pendingLookups: TimelineLookups | null`. `setTime`/`setTimelineLookups` validate (RangeError on non-finite day) and store even with no controller; the controller is created with them applied.
- Entering timeline mode (first `applyTimeline`, or `onLoad` when `timelineMode` is already set): once the overlay exists, `import('./timelapse/deck')`; on failure → `fail(l, e)` (queued timelines dropped). Then destroy the `GeneratedController` (set `l.controller = null`) so only one controller emits to the overlay, create the `TimelineController` with deps mirroring the generated ones (`repaint: () => map.triggerRepaint()`), apply the stored day, lookups, overlay layers and queued updates, and set `overlay.setProps({ onError })` where `onError` for a `timeline-` layer logs `console.error('[map] timelapse shader', e)` and sets `mapState = 'error'` (other layers keep deck's default logging). The `onError` is set only in timeline mode (editor unchanged).
- In timeline mode `applyGenerated` returns after one `console.error` (first call only).
- `applyTheme` and `setOverlayLayers` route to whichever controller exists; `SimMap`'s `RESERVED` becomes `/^(generated|rising|timeline)-/`; generated picking keeps testing `/^(generated|rising)-/`.
- Picking: in `pickAt`, a hit on a `TIMELINE_PART_LAYER` layer resolves through `timeline.lookup` to `{ kind: 'timeline', ... }`. With `timelinePick` set: hover (existing `onPointerMove` rAF path) calls `timelinePick({ projectId, parcelId, x, y, kind: 'hover' })` and clears the tooltip; a non-timeline result calls `timelinePick(null)` only if the last hover report was non-null (Review Focus 5) and then presents normally. Taps: the existing touch tap path, plus — only when `timelinePick` is set — mouse/pen `pointerdown`/`pointerup` within `TAP_PX`/`TAP_MS` on the canvas; a tap on a timeline part calls `timelinePick({..., kind: 'tap'})`, a tap elsewhere calls `timelinePick(null)`. Without `timelinePick`, a timeline hit shows the generated tooltip from `parcelMeta` (`kind: 'generated'` with the lookup's fields).
- `resolveExistingHit` receives the timeline controller's `demolished` set in timeline mode; `retryBuildings` calls `reapplyDemolished()`.

- [ ] **Step 1: Write the failing tests** in `SimMap.timeline.svelte.spec.ts` (render `SimMap` with the fixture manifest like `SimMap.svelte.spec.ts` does): after `applyTimeline(timelineSmall)` + `setTimelineLookups(timelineLookups)` + `setTime(day)`, the overlay's layer ids include `timeline-solid-*`, `timeline-ghost-*`, `timeline-bars`; the `tlA` attribute value length on a rendered ghost layer is `4 × vertexCount` (read via the attribute manager as `readAttributes` does); `pickObject` at a part's screen centre returns nothing before its `ghostFrom` and the slot after; with `timelinePick` set, a synthetic `pointermove` over the part calls it once with `kind: 'hover'` and the right `projectId`/`parcelId`, and no `[role=tooltip]` is shown; a mouse click (down+up, 0 px, < 300 ms) calls it with `kind: 'tap'`; moving off the part calls `timelinePick(null)` once (two further misses add no calls); a theme switch keeps the same extension instance; calls in the order `setTime` → `setTimelineLookups` → `applyTimeline` before `onready` end in the same snapshot (`timelineSnapshot()`) as the normal order (Review Focus 3); a remount with a new manifest object in timeline mode re-creates the controller and fires `onResyncNeeded`. Editor regression assertion in `SimMap.svelte.spec.ts`: after `ready`, `performance.getEntriesByType('resource')` has no entry whose name contains `timelapse/deck` and no overlay layer id starts with `timeline-`.
- [ ] **Step 2: Run** `npx vitest run --project client src/lib/map/SimMap.timeline.svelte.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run --project client src/lib/map/` — Expected: PASS, every existing SimMap spec unchanged and green.
- [ ] **Step 5: Commit** `feat(map): implement timeline mode in SimMap`

---

### Task 12: Synthetic timeline and client perf budgets

**Files:**
- Create: `src/lib/map/test/synthetic-timeline.ts`
- Modify: `src/lib/map/debug.ts` (`loadSyntheticTimeline` body)
- Test: `src/lib/map/test/synthetic-timeline.spec.ts` (server), `src/lib/map/timeline-perf.svelte.spec.ts` (client)

**Interfaces:**
- Consumes: `makeSyntheticCity` building placement (`src/lib/map/test/synthetic-city.ts`; export its `building()`/`mulberry32`/exemplar helpers if needed rather than copying them), `packTimedCell`, Task 10/11.
- Produces: `export function makeSyntheticTimeline(seed: number, nProjects: number, perCell = 1500): TimelineUpdate` (revision 0, with `demolish` for every project that reaches construction) and `export const SYNTHETIC_LOOKUPS: TimelineLookups` (re-export of `timelineLookups`).

Rules: spec §6 "synthetic-timeline". Stage days seeded between Day 20742 and Day 29584; ~1.3 revisions per project (30% have a second revision using a different exemplar building); 15% exits (test value only, commented as such); pathways mixed; deterministic for a seed.

- [ ] **Step 1: Write the failing tests.** `synthetic-timeline.spec.ts`: same seed → byte-identical first cell; 3,000 projects → revisions per project in [1.2, 1.4], exit share in [0.12, 0.18], every stage day in range. `timeline-perf.svelte.spec.ts` (real map from the fixture manifest; timeline loaded through the handle): `setTime` p95 ≤ 0.05 ms over 2,000 calls at 300 projects and at 30,000 projects, ratio of the two p95s ≤ 1.5 (median of 3 runs each); a pump frame with 2,000 operations takes ≤ 8 ms (measure the rAF callback via `performance.now()` around `flushFrame`-equivalent: jump the target across ≥ 2,000 entries and time the first pump frame through a `performance.measure` the pump emits under `import.meta.env.DEV || VITE_E2E`, named `sfh-pump`); `declutter` of 30,000 bars ≤ 20 ms (best of 3).
- [ ] **Step 2: Run** `npx vitest run --project server src/lib/map/test/synthetic-timeline.spec.ts` and `npx vitest run --project client src/lib/map/timeline-perf.svelte.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** (`sfh-pump` measure goes in `DemolishPump`'s frame, gated like `generated-controller.ts`'s `MEASURE`).
- [ ] **Step 4: Run** — Expected: PASS. If a budget fails, profile and fix the code; do not relax a budget.
- [ ] **Step 5: Commit** `test(map): add synthetic timeline and timeline perf budgets`

---

### Task 13: e2e timeline over fixture-0

**Files:**
- Modify: `src/lib/map/fixtures/build-fixtures.ts` (add a `--timeline` mode, or a sibling script `build-timeline-fixture.ts` in the same folder, that writes the JSON below)
- Create: `e2e/fixtures/timeline/fixture0-timeline.json`, `e2e/timelapse-render.spec.ts`

**Interfaces:**
- Consumes: debug hook from Task 11; `packTimedCell`.
- Produces: a committed `TimelineUpdate` (revision 0) over fixture-0 parcels whose existing buildings appear in `buildings.pmtiles`; typed arrays serialised as plain number arrays (with `NaN` encoded as `null`) and revived in the test by a small `reviveTimeline(json)` helper inside the spec file.

- [ ] **Step 1: Write the failing e2e** `e2e/timelapse-render.spec.ts` on `/` with the debug hook: load the JSON, `applyTimeline`, `setTimelineLookups(fixture lookups)`, `setTime(constructionDay − 1)`; `queryRenderedFeatures` on the `existing-buildings` layer at the demolish parcel returns it with `state.replaced` unset; after `setTime(constructionDay)` and the pump converges (`timelineSnapshot().demolish.applied` = expected count), `replaced` is `true`; `setTime(constructionDay − 1)` clears it; `demolish.applied` tracks each step; the page logs no console errors (collect `page.on('console')` errors and `pageerror`).
- [ ] **Step 2: Run** `npx playwright test e2e/timelapse-render.spec.ts` — Expected: FAIL (fixture missing).
- [ ] **Step 3: Implement** the generator and commit its output (run it deliberately, as `build-fixtures.ts` documents).
- [ ] **Step 4: Run** the e2e — Expected: PASS. Then `npx playwright test e2e/map.spec.ts` stays green.
- [ ] **Step 5: Commit** `test(e2e): cover time-driven demolition on fixture-0`

---

### Task 14: `bench:map` timeline cases

**Files:**
- Create: `e2e/bench/map-timeline.bench.ts`
- Modify: `docs/dev/map-perf.md` (describe the timeline cases; add a results row)

**Interfaces:**
- Consumes: `__sfhMap.loadSyntheticTimeline`, `setTime`, `timelineSnapshot`, `demolishMaxFrameOps`.

Rules: spec §6 "Bench". Reuse `map-pan.bench.ts`'s structure (copy its `pct`/verdict helpers or move them to a shared `e2e/bench/bench-util.ts` and import from both). Case "playback": 30,000 projects, downtown `[-122.401, 37.789]` zoom 15.5 pitch 55, pan as the existing bench while `setTime` advances 1,095.7 days/s from Day 20742 (clamped at Day 29584, then reversing). Case "drag": the same pan while `setTime` sweeps the full range in 2 s back and forth. Both print p50, p95, frames, pump max ops per frame, renderer, PASS/FAIL, and assert p95 ≤ 16.7 ms.

- [ ] **Step 1: Write the bench.**
- [ ] **Step 2: Run** `npm run bench:map` (headed, GPU; kill a stale non-VITE_E2E preview first per `map-perf.md`). If it cannot run in this environment, record the exact error in the task report; do not skip silently.
- [ ] **Step 3: Record** the results row in `docs/dev/map-perf.md` (machine, date, browser, DPR, frames, p50, p95, pump max ops, pass) if it ran.
- [ ] **Step 4: Verify** `npm run check`, `npm run lint` and `npm run test:unit` pass on the whole branch.
- [ ] **Step 5: Commit** `test(bench): add timeline playback and drag bench cases`

---

## Fix round F1 (reappraisal 1)

Spec revised at package commit 35b36f6 (branch `worktree-fzp-timelapse`): `/Users/mindlace/Projects/sfhousing/.claude/worktrees/fzp-timelapse/docs/superpowers/specs/2026-10-16-timelapse-render-design.md` — §9 lists the fix round; §4.6.1, §4.8.1, §6 and AC14–AC16 are normative. Port rule for every F1 task: Playwright and bench run with `SFH_E2E_PORT=4202` only (4173 is integration's, 4201 scenario-data's).

### Task 15: Bring the branch current

**Files:** merge commits only, plus conflict resolutions in `docs/dev/map-perf.md`, `src/lib/map/SimMap.svelte`, `src/lib/map/pack.ts` (and any others git reports); `docs/superpowers/specs/2026-10-16-timelapse-render-design.md` (replaced by the 35b36f6 revision).

- [ ] **Step 1:** `git -C <worktree> merge --no-ff dda6252` (integration `superconductor/fzp-timelapse`); expected near-trivial.
- [ ] **Step 2:** `git -C <worktree> merge --no-ff 0fbef45` (origin/main: #21 closed rings in `normaliseRing`, #22 generator flake fix, #23 deck viewport resync `onDeviceInitialized` → `map.fire('move')` in a microtask + `SimMap.deck-viewport.svelte.spec.ts`). Resolve conflicts keeping all three behaviours: closed rings through the shared `normaliseRing` (pack-timed keeps calling it, no ring logic of its own), #23's resync, and timeline mode (`deviceProps.onError`, lazy timeline load, picking). `map-perf.md` keeps every results row from both sides in one contiguous table.
- [ ] **Step 3:** Replace the branch's spec copy with the 35b36f6 revision (`git -C <worktree> show 35b36f6:docs/superpowers/specs/2026-10-16-timelapse-render-design.md`); commit `docs(specs): adopt timelapse-render reappraisal 1`.
- [ ] **Step 4:** Full verification on the merged branch: `npm run check`, `npm run lint`, `npm run test:unit` (all GPU pixel specs and `SimMap.deck-viewport.svelte.spec.ts` included), `SFH_E2E_PORT=4202 npx playwright test e2e/timelapse-render.spec.ts e2e/map.spec.ts`.
- [ ] **Step 5:** Recheck the side-wall test in `timelapse-extension.gpu.svelte.spec.ts` now that rings are closed: its `mean()` averages every stored vertex (a closing duplicate biases it toward the first corner). Make the probe ring-agnostic (bbox or distinct-vertex mean) and update the comment that says the closing wall is not drawn (it now is). Re-run the GPU spec.
- [ ] **Step 6:** If any render-path file changed in the merge resolution beyond #23's resync, run `SFH_E2E_PORT=4202 npm run bench:map` and record p95s.

### Task 16: Pick misses carry their kind (IA-1, T7)

**Files:** `src/lib/map/types.ts` (step-0 T7 types — authorised by the package), `src/lib/map/timeline-types.spec.ts`, `src/lib/map/SimMap.svelte` (`deliver`, `unreportHover`, doc comment), `src/lib/map/SimMap.timeline.svelte.spec.ts`, any other spec asserting `null`.

- [ ] **Step 1:** `types.ts`: export `TimelinePick` exactly as spec §2.1; `SimMapProps.timelinePick?: (p: TimelinePick) => void`. `timeline-types.spec.ts` restates the amended T7 row from the design's current table (35b36f6) and still compiles the Equals check.
- [ ] **Step 2:** Replace the pinning test (~`:362-424`) with the §6 pick-miss test, every bullet as written there (hover leave to building / to empty, `pointerleave`, suppressed move, click on empty ×2, click on building, touch tap on building with card, touch tap while mouse hover reported, never `null`, exact keys, no console errors). Run it: RED.
- [ ] **Step 3:** `SimMap.svelte` `deliver()` and `unreportHover()` exactly as §4.8.1 "Code changes"; update the `deliver` doc comment. GREEN; client `src/lib/map/` green.
- [ ] **Step 4:** Commit `feat(map)!: report timeline pick misses with their kind` (T7 interface change).

### Task 17: `timelineTokenCss` (IA-3, T7)

**Files:** `src/lib/map/palette.ts`, `src/lib/map/SimMap.svelte` (`DEFAULT_TOKENS_CSS` built on the helper), `src/lib/map/palette.spec.ts`.

- [ ] **Step 1:** Before changing code, capture today's `DEFAULT_TOKENS_CSS` string (the body inside `<style>…</style>`) as a literal for the byte-identity test.
- [ ] **Step 2:** Tests per spec §6 palette bullets for `timelineTokenCss('.x')` (every `tl-*` and every `TIMELINE_LEGEND`-named token exactly once, light block then dark under `@media (prefers-color-scheme: dark)`, no other token, deterministic, `TypeError` for `''`, `'  '` and selectors containing `{`, `}`, `<`, `;`) and the byte-identity of the helper over all tokens and `.sim-map`. RED.
- [ ] **Step 3:** `palette.ts`: internal `tokenCss(selector, names)` and exported `timelineTokenCss(selector)` per §4.6.1 (pure, DOM-free, `TOKENS` key order, `; ` joins, camelCase → kebab). `SimMap.svelte`'s module script builds `DEFAULT_TOKENS_CSS` from `tokenCss` over every token. GREEN; `SimMap.ssr.spec.ts` and the editor specs unmodified and green.
- [ ] **Step 4:** Commit `feat(map): add timelineTokenCss for outside legends`.
