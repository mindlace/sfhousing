# /sim runs, plan 2 of 3: map overlays, paint feedback and lot limits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/sim`, replace the lot dots with what the spec's map shows: a translucent height fog at the effective allowed height, transit layers and a View menu in Setup only, dashed outlines of custom-painted lots while the eraser is selected, generated buildings that briefly fill a painted lot and fade, and an "Allowed: N · Buildable here: M" line in the lot tooltip.

**Architecture:** The scenario worker already holds the effective allowed stories per `parcels.bin` row (`li.plan.parcels.envelopeStories`, via `parcelsView`, `src/lib/sim/levers/view.ts:50`) and every row's label point (`ScenarioParcels.labelPoint`, `src/lib/data/scenario-codec.ts:46`). It turns them into a smoothed 50 m height grid and posts it with every lever `current` message. The page draws the grid with a small custom deck.gl layer (an instanced unit quad per grid cell, the pattern `StageBarLayer` already uses) through SimMap's overlay slot. Outlines and paint feedback are two new worker requests in the `resolveBrush` mould: lot rings from the loaded chunk records, and buildings from `generate` packed with `packCell`, drawn with the same `SolidPolygonLayer` accessors `GeneratedController` uses. The tooltip's limits come from the worker's `parcelSummary`.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, deck.gl 9.4 (`@deck.gl/core`, `@deck.gl/layers`), luma.gl 9.4 (`@luma.gl/engine`), MapLibre 6, Vitest (server and client projects), Playwright, the headed `npm run bench:map`.

**Spec:** `docs/superpowers/specs/2026-10-31-sim-runs-design.md` (§1 overlays in Setup only, §3 paint feedback, §3a "What the map shows", §4). Plans 1 (`docs/superpowers/plans/2026-10-31-sim-runs-1-policy-and-runs.md`) and 3 (`docs/superpowers/plans/2026-10-31-sim-runs-3-palette-and-physical-limits.md`) execute **before** this one (order 1 → 3 → 2). Every file reference below is to their end state where they change it; current-code line numbers are given only for code they do not touch.

## Global Constraints

- The fog shows what zoning allows, not the physical cap: its height is the effective allowed stories (FZP, raised by rules, set by custom paint; a protected lot keeps its FZP stories, plan 1 `resolve.ts`). The tooltip shows what can be built: "Allowed: 40 · Buildable here: 6" (spec §3a, verbatim format).
- Fog: one see-through surface over the whole map (roads and open space too, not boxes per parcel), smoothed between neighbouring limits, one neutral colour (token `'height-fog'`: light `rgba(255,255,255,0.30)`, dark `rgba(200,210,214,0.20)`, plan 3 Task 4), existing and in-progress buildings visible through it, updates as the policy changes, toggled in the View menu, shown in Setup only, **on by default**.
- The View menu on `/sim` holds transit stops, transit capacity and the height fog. It is shown, and its layers drawn, only while `run.phase === 'setup'` (plan 1 `RunPhase`). Each toggle keeps its own value across a run.
- Painted outlines: only while the erase tool is selected; each custom-painted lot dashed in token `'painted-outline'` (light `#B4532F`, dark `#DB8B42`, plan 3 Task 4). At other times the map shows no painted marking.
- Paint feedback: a custom paint stroke shows the generated buildings its lots could hold as soon as the stroke resolves; adding or editing a rule shows them after the recompute, for lots in the current view only; the eraser shows none. They fade out over about two seconds.
- The lot dots go: `lot-overlay.ts`, `lotRoles`/`LotRole`, the "Map key" in Custom zoning.
- Map perf bar (`docs/dev/map-perf.md`): p95 frame time ≤ 16.7 ms on the headed `npm run bench:map`.
- Overlay layer ids never start with `generated-`, `rising-` or `timeline-` (`SimMap.svelte:127`).
- WCAG 2.2 AA (`docs/dev/accessibility.md`); every new or changed control is in an axe scan under both Playwright projects.
- Every Vitest test calls `expect` (`expect.requireAssertions`). 2-space indent, single quotes, no trailing commas, 100 columns. Conventional Commits; commit with `-m` flags, never a heredoc; never `cd x && cmd`.

## Review Focus

1. **A run starts and ends with the fog or transit toggled off.** Expected: the toggle is still off after Change policy, the layer stays hidden, and nothing about the choice is lost when the View menu unmounts during the run. Test in Task 4 (`SimPage.svelte.spec.ts`, "toggles survive a run") and its e2e.
2. **A dataset with no `manifest.transit`.** Expected: `/sim` still shows a View menu, with only the height-fog row, and the fog works; no transit sources are requested. Test in Task 4 (`ViewMenu.svelte.spec.ts` "rows", and the SimPage spec with a transit-less manifest).
3. **A rule that covers thousands of lots in view, or a wide stroke at a low zoom.** Expected: feedback builds at most `PREVIEW_MAX_LOTS` buildings, nearest the view centre first, and the timeline keeps playing (the worker does not stall). Test in Task 6 (`scenario-host.preview.spec.ts` "cap", `feedback.spec.ts` "nearest first").
4. **The eraser chosen while the painted lots' chunks are not loaded** (painted, panned away, came back). Expected: outlines appear for the lots whose chunks arrive, without re-choosing the tool. Test in Task 5 (`outline-request.spec.ts` "re-requests on chunks").
5. **The tooltip over a protected lot, a lot with allowed 0, and a lot whose generator returns no building.** Expected: protected reads "Allowed: N · Protected"; allowed 0 shows no limits line; no-gain falls back to `lotBuildableStories`. Test in Task 7 (`tooltip.spec.ts`, `scenario-host.limits.spec.ts`).

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/lib/sim-page/lot-overlay.ts` (+ spec) | deleted | 1 |
| `src/lib/sim-page/policy.ts` (+ spec) | `lotRoles`, `LotRole` removed | 1 |
| `src/lib/sim-page/overlay-mux.ts` (+ spec) | slots `feedback`, `fog`, `outline`, `ring`, in that draw order | 1 |
| `src/lib/sim-page/CustomZoningSection.svelte` (+ spec) | map key removed | 1 |
| `src/lib/map/fog/grid.ts` (+ `grid.spec.ts`) | pure, worker-safe: `FogGrid`, `buildFogGrid`, `fogInstances`, `sampleFog`, `storiesToM` | 2 |
| `src/lib/sim/scenario/types.ts` | `fog` on `levers` `current`; `previewBuildings`, `lotOutlines` requests and answers; `LotLimits` | 2, 5, 6, 7 |
| `src/lib/sim/scenario/scenario-host.ts` | posts the fog; answers outlines and previews; protected mask; limits | 2, 5, 6, 7 |
| `src/lib/sim/router.ts`, `src/lib/sim/scenario-client.ts` | route and expose the new requests | 5, 6 |
| `src/lib/fzp/FzpMode.svelte` | props `view`, `onfog`, `onchunks`; `SimClientApi` grows; summary `limits` passthrough | 2, 4, 5, 6, 7 |
| `src/lib/map/fog/fog-layer.ts` (+ `fog-layer.gpu.svelte.spec.ts`) | `HeightFogLayer` (deck + luma) | 3 |
| `src/lib/map/test/synthetic-fog.ts`, `src/lib/map/debug.ts`, `SimMap.svelte` (debug only), `e2e/bench/map-timeline.bench.ts` | the fog bench case | 3 |
| `src/lib/view/prefs.ts`, `ViewMenu.svelte` (+ specs) | `heightFog` pref; `rows` prop | 4 |
| `src/lib/sim-page/SimPage.svelte` (+ spec, `test/SimPageHost.svelte`) | View menu, Setup-only view, fog, outlines, feedback wiring | 1, 4, 5, 6 |
| `src/lib/sim-page/painted-outline.ts` (+ spec) | `dashRing`, `paintedOutlineLayers` | 5 |
| `src/lib/sim-page/outline-request.ts` (+ spec) | latest-wins outline requests while erasing | 5 |
| `src/lib/map/generated-controller.ts` | exports `packedCellLayer` (makeLayer uses it) | 6 |
| `src/lib/brush/overlay.ts` | `OverlayCtors` gains `SolidPolygonLayer` | 6 |
| `src/lib/sim-page/feedback.ts` (+ spec) | `PaintFeedback` fade, `RuleFeedbackTrigger`, `lotsInView` | 6 |
| `src/lib/sim-page/stroke-adapter.ts` (+ spec) | `onpaint` callback | 6 |
| `src/lib/sim/protocol.ts`, `src/lib/map/types.ts`, `src/lib/map/tooltip.ts` (+ spec), `SimMap.svelte` | `limits` on summaries; third tooltip line | 7 |
| `e2e/sim.spec.ts` | overlays, outlines, feedback, tooltip | 4–7 |
| `docs/dev/sim-page.md`, `fzp-mode.md`, `map-interfaces.md`, `map-perf.md` | updated with the task that changes each subject | 1, 3–7 |

---

### Task 1: Remove the lot dots

Plan 1 Task 3 left a single `'changed'` role and one dot layer; this removes them and reshapes the overlay mux for the layers that replace them.

**Files:**
- Delete: `src/lib/sim-page/lot-overlay.ts`, `src/lib/sim-page/lot-overlay.spec.ts`
- Modify: `src/lib/sim-page/policy.ts`, `policy.spec.ts` (delete `lotRoles`, `LotRole` and their tests)
- Modify: `src/lib/sim-page/overlay-mux.ts`, `overlay-mux.spec.ts`
- Modify: `src/lib/sim-page/CustomZoningSection.svelte`, `CustomZoningSection.svelte.spec.ts` (the "Map key" list and its test)
- Modify: `src/lib/sim-page/SimPage.svelte` (the lot-dot effect, `lotsSlot`, `attachController`)
- Modify: `docs/dev/sim-page.md` ("The recipe and its compile rules", the "Map feedback" bullet; "Autosave…", "the lot dots still draw")

**Interfaces:**
- Consumes: `createOverlayMux` (`overlay-mux.ts`, today `ORDER = ['lots', 'ring']`).
- Produces:
  ```ts
  // overlay-mux.ts — draw order bottom to top: feedback buildings under the fog; outlines and the
  // brush ring over it (the fog writes no depth, so a ground line drawn after it stays visible).
  export const OVERLAY_ORDER = ['feedback', 'fog', 'outline', 'ring'] as const;
  export type OverlaySlot = (typeof OVERLAY_ORDER)[number];
  export function createOverlayMux(set: (layers: Layer[]) => void): {
    slot(name: OverlaySlot): (layers: Layer[]) => void;
  };
  ```
  `SimPage` keeps `let overlay = $state.raw<ReturnType<typeof createOverlayMux> | null>(null)`, set in `attachController` for **both** modes (the view mode gets the fog in Task 4; it has no ring, outline or feedback).

- [ ] **Step 1: Write the failing tests**

`overlay-mux.spec.ts` (replace the `sim-lots` cases):

```ts
it('concatenates slots in draw order whatever the write order', () => {
  const set = vi.fn();
  const mux = createOverlayMux(set);
  const [ring, fog, fb, out] = ['brush-ring', 'sim-height-fog', 'sim-feedback-1', 'sim-painted-outline'].map(layer);
  mux.slot('ring')([ring]);
  mux.slot('fog')([fog]);
  mux.slot('outline')([out]);
  mux.slot('feedback')([fb]);
  expect(set).toHaveBeenLastCalledWith([fb, fog, out, ring]);
});
it('clearing one slot leaves the others', () => {
  const set = vi.fn();
  const mux = createOverlayMux(set);
  mux.slot('fog')([layer('sim-height-fog')]);
  mux.slot('ring')([layer('brush-ring')]);
  mux.slot('fog')([]);
  expect(set.mock.lastCall![0].map((l: Layer) => l.id)).toEqual(['brush-ring']);
});
```

`CustomZoningSection.svelte.spec.ts`: `expect(page.getByRole('list', { name: 'Map key' }).query()).toBeNull()`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/sim-page/overlay-mux.spec.ts` and `npx vitest --run --project client src/lib/sim-page/CustomZoningSection.svelte.spec.ts`
Expected: FAIL (`'fog'` is not a slot; the key renders).

- [ ] **Step 3: Implement**

Delete the files and symbols above. In `SimPage`, `attachController` creates the mux once per map handle in either mode and passes `mux.slot('ring')` to `BrushController` as today. `npm run check` lists every remaining reference.

- [ ] **Step 4: Verify**

Run: `npm run check`, then `npx vitest --run --project server src/lib/sim-page` and `npx vitest --run --project client src/lib/sim-page`
Expected: 0 errors; PASS. `grep -rn "lot-overlay\|lotRoles\|sim-lots" src e2e docs/dev` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/sim-page docs/dev/sim-page.md
git commit -m "refactor(sim): remove the lot dots; overlay mux slots for fog, outlines and feedback" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The fog grid, computed in the worker

Plan 1's interface note says the per-row stories are not posted and suggests a per-row array on `current`. The page has no label points (they are in `parcels.bin`, worker-only), so this task posts the computed grid instead; the per-row stories stay in the worker.

**Files:**
- Create: `src/lib/map/fog/grid.ts`, `src/lib/map/fog/grid.spec.ts`
- Modify: `src/lib/sim/scenario/types.ts` (`LeversResponse` `current`), `src/lib/sim/scenario/scenario-host.ts` (`leverStep`, the `post` of `current`)
- Modify: `src/lib/sim/scenario/scenario-host.levers.spec.ts`
- Modify: `src/lib/sim/scenario-client.ts` (nothing to route: `levers` already reaches `onLevers`), `src/lib/fzp/FzpMode.svelte` (`onfog`), `src/lib/fzp/FzpMode.svelte.spec.ts`

**Interfaces:**
- Consumes: `ScenarioParcels.labelPoint`, `envelopeStories` (`scenario-codec.ts:46,49`; `0` = no envelope); `FTF_M`, `GROUND_FTF_M` (`src/lib/generator/constants.ts:3,5`); `project` from `$lib/plan` (the metres-per-degree plane `src/lib/brush/overlay.ts:24-25` uses); `CONSTRAINTS.maxBounds` (`src/lib/map/camera.ts:9-12`, for a test only: `grid.ts` must stay worker-safe and not import `camera.ts`).
- Produces (`src/lib/map/fog/grid.ts`):
  ```ts
  /** A vertex grid over FOG_BOUNDS; heightM is (cols+1)·(rows+1), row-major from the south-west. */
  export interface FogGrid {
    west: number; south: number; dLng: number; dLat: number;
    cols: number; rows: number; heightM: Float32Array;
  }
  export const FOG_CELL_M = 50;     // tier 4: our choice; about a quarter block
  export const FOG_FILL_CELLS = 2;  // tier 4: an empty cell within 2 cells (~100 m) of a limit is filled
  export const FOG_BOUNDS: [[number, number], [number, number]]; // = CONSTRAINTS.maxBounds
  export function storiesToM(stories: number): number; // 0 → 0; s ≥ 1 → GROUND_FTF_M + (s − 1)·FTF_M
  export function buildFogGrid(labelPoint: Float64Array, stories: Uint8Array): FogGrid;
  /** Bilinear height at a point; 0 outside the grid. */
  export function sampleFog(g: FogGrid, lng: number, lat: number): number;
  export interface FogInstances {
    count: number;
    anchors: Float64Array; // 2 per cell: south-west lng, lat
    corners: Float32Array; // 4 per cell, metres: SW, SE, NW, NE
  }
  /** Cells with any corner above 0, for the layer (Task 3). */
  export function fogInstances(g: FogGrid): FogInstances;
  ```
- Produces (`types.ts`): `LeversResponse` `current` gains `fog: FogGrid` (its `heightM.buffer` is transferred). Every `current` carries it, the session's first included.
- Produces (`FzpMode` props): `onfog?: (g: FogGrid) => void`, called from `events.onLevers` for each kept `current` (`FzpMode.svelte:514-523`), after `pushLookups`.

`buildFogGrid` algorithm (the tests pin its properties, not every value):
1. `dLat = FOG_CELL_M / mPerDegLat`, `dLng = FOG_CELL_M / mPerDegLng` at the bounds' mid latitude; `cols`, `rows` = `ceil` of the bounds' extent over them.
2. Cell value `v` = the **max** of `storiesToM(stories[i])` over rows whose label point falls in the cell, for `stories[i] > 0`; such a cell is occupied.
3. Fill: an empty cell with an occupied cell within `FOG_FILL_CELLS` (Chebyshev) takes the binomial-weighted mean (weights `[1,4,6,4,1]` per axis) of the occupied cells in that 5×5 window. Cells with none stay empty (value 0): open water, the interior of a large park with no envelope.
4. Smooth: one 3×3 binomial pass (`[1,2,1]` per axis) over non-empty cells, averaging only non-empty neighbours, so the edge of the city does not sag toward 0.
5. Vertex height = the mean of the up-to-four non-empty cells that touch it; 0 when none does.

- [ ] **Step 1: Write the failing tests** (`grid.spec.ts`, server project)

Build label points on the grid with a helper `at(c, r)` (the centre of cell `(c, r)` from a first `buildFogGrid(new Float64Array(0), new Uint8Array(0))`), and `field(f: (c, r) => number | null)` that places one row per cell.

```ts
it('FOG_BOUNDS is the map's max bounds', () => {
  expect(FOG_BOUNDS).toEqual(CONSTRAINTS.maxBounds);
});
it('stories to metres uses the generator's floor heights', () => {
  expect(storiesToM(0)).toBe(0);
  expect(storiesToM(1)).toBe(GROUND_FTF_M);
  expect(storiesToM(4)).toBeCloseTo(GROUND_FTF_M + 3 * FTF_M, 6);
});
it('a uniform field is flat at its height, inside the city', () => {
  const g = field((c, r) => (c >= 10 && c < 30 && r >= 10 && r < 30 ? 4 : null));
  for (let r = 13; r <= 27; r++) for (let c = 13; c <= 27; c++)
    expect(g.heightM[r * (g.cols + 1) + c]).toBeCloseTo(storiesToM(4), 4);
});
it('two plateaus meet in a monotone ramp, flat three cells from the seam', () => {
  const g = field((c, r) => (r >= 10 && r < 30 && c >= 10 && c < 40 ? (c < 25 ? 4 : 12) : null));
  const row = 20, h = (c: number) => g.heightM[row * (g.cols + 1) + c];
  for (let c = 12; c < 38; c++) expect(h(c + 1)).toBeGreaterThanOrEqual(h(c) - 1e-4);
  expect(h(21)).toBeCloseTo(storiesToM(4), 4);
  expect(h(29)).toBeCloseTo(storiesToM(12), 4);
});
it('roads between blocks are covered; far water is not', () => {
  // two blocks one empty cell apart, and an empty area 10 cells away
  const g = field((c, r) => (r >= 10 && r < 20 && (c === 10 || c === 12) ? 6 : null));
  expect(sampleFog(g, ...at(11, 15))).toBeGreaterThan(0);
  expect(sampleFog(g, ...at(25, 15))).toBe(0);
});
it('the tallest limit in a cell wins; rows with no envelope (0) are empty', () => {
  const lp = new Float64Array([...at(20, 20), ...at(20, 20), ...at(5, 5)]);
  const g = buildFogGrid(lp, new Uint8Array([4, 20, 0]));
  expect(sampleFog(g, ...at(20, 20))).toBeGreaterThan(storiesToM(4));
  expect(sampleFog(g, ...at(5, 5))).toBe(0);
});
it('fogInstances keeps only cells with height and their four corners', () => {
  const g = field((c, r) => (c === 20 && r === 20 ? 8 : null));
  const fi = fogInstances(g);
  expect(fi.count).toBeGreaterThan(0);
  expect(fi.corners.length).toBe(4 * fi.count);
  for (let k = 0; k < fi.count; k++)
    expect(Math.max(...fi.corners.subarray(4 * k, 4 * k + 4))).toBeGreaterThan(0);
});
```

`scenario-host.levers.spec.ts` (the spec's mini-city session helpers):

```ts
it('every current carries the fog of the levers in force', async () => {
  const h = await leverSession(DEFAULT_LEVERS);
  const first = h.posted('levers').find((m) => m.phase === 'current')!;
  const [lng, lat] = h.labelPoint(FZP_LOT);
  const before = sampleFog(first.fog, lng, lat);
  h.setLevers({ ...DEFAULT_LEVERS, paint: [{ lots: [FZP_LOT], stories: 40 }], compare: 'fzp' });
  await h.untilCurrent();
  expect(sampleFog(h.lastCurrent().fog, lng, lat)).toBeGreaterThan(before);
  expect(h.lastTransfer('levers')).toContain(h.lastCurrent().fog.heightM.buffer);
});
it('a painted lot under a category protection keeps its FZP fog', async () => {
  const h = await leverSession(DEFAULT_LEVERS);
  const [lng, lat] = h.labelPoint(MINI_HISTORIC_ID);
  const fzp = sampleFog(h.lastCurrent().fog, lng, lat);
  h.setLevers({ ...DEFAULT_LEVERS, paint: [{ lots: [MINI_HISTORIC_ID], stories: 40 }],
    protect: { ...DEFAULT_LEVERS.protect, historic: true }, compare: 'fzp' });
  await h.untilCurrent();
  expect(sampleFog(h.lastCurrent().fog, lng, lat)).toBeCloseTo(fzp, 4);
});
```

(`leverSession`, `labelPoint`, `untilCurrent`, `lastCurrent`, `lastTransfer` are spec helpers; add the missing ones beside the existing session helpers.)

`FzpMode.svelte.spec.ts`: a fake-worker `levers` `current` with a `fog` calls `onfog` once with that object; a `current` below the latest sent rev (dropped by `leversMessage`) does not.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/map/fog src/lib/sim/scenario/scenario-host.levers.spec.ts` and `npx vitest --run --project client src/lib/fzp/FzpMode.svelte.spec.ts`
Expected: FAIL (module missing; no `fog` on `current`; no `onfog`).

- [ ] **Step 3: Implement**

`grid.ts` as above. In `leverStep`, after `applyLevers` (plan 1's `leverStep`, the `post({ type: 'levers', phase: 'current', … })`), build `buildFogGrid(li.plan.parcels.labelPoint, li.plan.parcels.envelopeStories)` and post it with `[fog.heightM.buffer]` as transfer. Measure it with the host's existing `measure(w, …)` under a new kind `'fog'`.

- [ ] **Step 4: Verify**

Run: the Step 2 commands, then `npx vitest --run --project server src/lib/sim` and `npm run check`
Expected: PASS, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/map/fog src/lib/sim/scenario src/lib/fzp/FzpMode.svelte src/lib/fzp/FzpMode.svelte.spec.ts
git commit -m "feat(sim): worker posts a smoothed height-limit grid with each lever revision" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `HeightFogLayer` and the perf bar

**Files:**
- Create: `src/lib/map/fog/fog-layer.ts`, `src/lib/map/fog/fog-layer.gpu.svelte.spec.ts`
- Create: `src/lib/map/test/synthetic-fog.ts` (+ `synthetic-fog.spec.ts`)
- Modify: `src/lib/map/debug.ts`, `src/lib/map/SimMap.svelte` (the `installDebug` extras only, `SimMap.svelte:432-442`)
- Modify: `e2e/bench/map-timeline.bench.ts`
- Modify: `docs/dev/map-perf.md` (a "Height fog" case and a results row)

**Interfaces:**
- Consumes: `FogInstances`, `FogGrid`, `FOG_CELL_M` (Task 2); `TOKENS[theme]['height-fog']`, `hexToRgba` (`src/lib/map/palette.ts`; plan 3 Task 4 adds the token, `hexToRgba` reads `rgba()`); `Layer`, `project32` (`@deck.gl/core`); `Model`, `Geometry` (`@luma.gl/engine`). Pattern: `StageBarLayer` (`src/lib/map/timelapse/stage-bar-layer.ts:381-506`: float64 instance anchor with `fp64: this.use64bitPositions()`, a triangle-strip unit quad, a uniforms module, `FIXED` props).
- Produces:
  ```ts
  export interface HeightFogLayerProps extends LayerProps {
    data: FogInstances;
    cellDeg: [dLng: number, dLat: number];
    color: [number, number, number, number]; // 0–255, from the 'height-fog' token
  }
  export class HeightFogLayer extends Layer<HeightFogLayerProps> {} // static layerName 'HeightFogLayer'
  export const FOG_LAYER_ID = 'sim-height-fog';
  export function heightFogLayer(fi: FogInstances, g: FogGrid, theme: Theme): HeightFogLayer;
  ```
  Fixed props: `id: FOG_LAYER_ID`, `pickable: false`, `parameters: { depthWriteEnabled: false, depthCompare: 'less-equal', cullMode: 'none' }`. Buildings drawn before it (the timeline solids, ghosts, bars and the feedback slot) depth-test it: a roof above the fog stays clear, one below shows through it.
- Shader (builder writes it): corner `(u, v)` of the unit quad is `anchor + (u·dLng, v·dLat)`, the offset added to the anchor's **low** part so neighbouring cells meet without cracks; `z` = the instance's corner height for that `(u, v)`. Builder's call, so the surface reads as a surface and not a flat tint: `rgb *= mix(0.82, 1.0, n.z)`, `n` the quad's normal from its four corners over `FOG_CELL_M`; alpha stays the token's. A flat area is exactly the token.
- Produces (`synthetic-fog.ts`): `makeSyntheticFog(seed: number, n = 150_000): FogGrid` (seeded label points over `FOG_BOUNDS`, stories 4–40). `SfhMapDebug.loadSyntheticFog(seed?: number): Promise<{ cells: number }>`: lazy-imports `fog-layer`, sets `[heightFogLayer(…)]` with `setOverlayLayers` (VITE_E2E builds only, like `loadSyntheticTimeline`).

- [ ] **Step 1: Write the failing GPU test** (`fog-layer.gpu.svelte.spec.ts`, client project; standalone `Deck` over a 128×64 canvas, top-down, as `stage-bar-layer.gpu.svelte.spec.ts:1-60`, with its `BG`, `TOL`, `TOL_BLEND` and `over`)

```ts
it.each(['light', 'dark'] as const)('%s: a flat fog is the token over the ground', async (theme) => {
  const px = await render([heightFogLayer(flat(30), GRID, theme)]);
  const [r, g, b, a] = hexToRgba(TOKENS[theme]['height-fog']);
  expectPixel(px.at(64, 32), over([r, g, b], a / 255), TOL_BLEND);
});
it('no crack or double blend on a shared cell edge', async () => {
  const px = await render([heightFogLayer(flat(30), GRID, 'light')]);
  const edge = px.at(edgeX(GRID), 32); // the column on the boundary between two cells
  expectPixel(edge, px.at(64, 32), 1);
});
it('a roof above the fog is clear; a roof below shows through', async () => {
  const roof: Rgb = [200, 80, 40];
  const tall = solidBox(CENTRE, 60, roof), low = solidBox(OFFSET, 10, roof);
  const px = await render([tall, low, heightFogLayer(flat(30), GRID, 'light')]);
  expectPixel(px.at(...toPx(CENTRE)), roof, TOL);
  const [r, g, b, a] = hexToRgba(TOKENS.light['height-fog']);
  expectPixel(px.at(...toPx(OFFSET)), mix(roof, [r, g, b], a / 255), TOL_BLEND);
});
```

(`flat(h)` is a 4×2-cell `FogInstances` with every corner `h`; `solidBox` an extruded `SolidPolygonLayer` box with `_normalize: false`, `_windingOrder: 'CW'` as `generated-controller.ts:387-401`; `render`, `expectPixel`, `toPx`, `edgeX`, `mix` are local helpers.)

`synthetic-fog.spec.ts` (server): `makeSyntheticFog(1)` is deterministic (two calls deep-equal) and `fogInstances` of it has more than 10,000 cells.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project client src/lib/map/fog/fog-layer.gpu.svelte.spec.ts` and `npx vitest --run --project server src/lib/map/test/synthetic-fog.spec.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement** the layer, `heightFogLayer`, `makeSyntheticFog` and the debug hook.

- [ ] **Step 4: Run them to see them pass**

Run: the Step 2 commands
Expected: PASS.

- [ ] **Step 5: Add and run the bench case**

`map-timeline.bench.ts` gains a case `playback + fog`: as `playback`, plus `await window.__sfhMap.loadSyntheticFog(1)` after the timeline cells install. It prints the fog's cell count with the usual line and asserts p95 ≤ 16.7 ms.

Run: `lsof -ti :4173 | xargs kill` (if a non-VITE_E2E preview runs), then `npm run bench:map`
Expected: every case PASS. Add the result row to `docs/dev/map-perf.md` ("Results") and a short "Height fog case" paragraph under "Timeline cases" (synthetic grid size, instance count). If p95 fails, halve the instance count by doubling `FOG_CELL_M` and re-run; record both.

- [ ] **Step 6: Commit**

```bash
git add src/lib/map/fog src/lib/map/test/synthetic-fog.ts src/lib/map/test/synthetic-fog.spec.ts src/lib/map/debug.ts src/lib/map/SimMap.svelte e2e/bench/map-timeline.bench.ts docs/dev/map-perf.md
git commit -m "feat(map): height fog layer, a translucent smoothed surface at the allowed height" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: View menu on `/sim`, overlays in Setup only, the fog on the map

**Files:**
- Modify: `src/lib/view/prefs.ts`, `prefs.spec.ts`, `src/lib/view/ViewMenu.svelte`, `ViewMenu.svelte.spec.ts`
- Modify: `src/lib/fzp/FzpMode.svelte` (`view` prop instead of the literal at `FzpMode.svelte:756`), `FzpMode.svelte.spec.ts`
- Modify: `src/lib/sim-page/SimPage.svelte`, `SimPage.svelte.spec.ts`, `src/lib/sim-page/test/SimPageHost.svelte`
- Modify: `e2e/sim.spec.ts`
- Modify: `docs/dev/map-interfaces.md` ("Transit layers": UI gating on `/sim`; a new "Height fog" section), `docs/dev/fzp-mode.md` (FzpMode props `view`, `onfog`), `docs/dev/sim-page.md` (new "Map overlays" section)

**Interfaces:**
- Consumes: `RunPhase`, `run.phase` (plan 1 Task 7); `useSystemTheme()` (plan 3 Task 5, `src/lib/map/system-theme.svelte.ts`); `ViewMenu` props `{ view, theme, onchange }` (plan 3 Task 5); `heightFogLayer`, `fogInstances` (Tasks 2, 3); `overlay.slot('fog')` (Task 1).
- Produces (`prefs.ts`): `ViewPrefs { transitStops: boolean; transitAccess: boolean; heightFog: boolean }`; `DEFAULT_VIEW.heightFog = true`; `readViewPrefs` / `writeViewPrefs` read and write all three under the same `sfhousing:view` key. Builder's call: one record shared with `/`, so a viewer's transit choice follows them between modes; `/` never shows or uses `heightFog` and writes back the value it read.
- Produces (`ViewMenu.svelte`): `export type ViewRow = 'transitStops' | 'transitAccess' | 'heightFog'`; prop `rows?: readonly ViewRow[]` (default `['transitStops', 'transitAccess']`, so `/` is unchanged). The fog row: checkbox "Height limits", caption "A haze at the height zoning allows. Room under it is room to grow." (exact copy).
- Produces (`FzpMode` props): `view?: ViewPrefs` (default `HIDDEN_VIEW`), passed to `SimMap`. `export const HIDDEN_VIEW: ViewPrefs = { transitStops: false, transitAccess: false, heightFog: false }` from `prefs.ts`.
- Produces (`SimPage`): `viewPrefs = $state(readViewPrefs())`; the actions snippet renders `ViewMenu` first, only while `run.phase === 'setup'`, with `rows = manifest?.transit ? ['transitStops', 'transitAccess', 'heightFog'] : ['heightFog']` and `theme = systemTheme.current`; FzpMode gets `view = run.phase === 'setup' ? viewPrefs : HIDDEN_VIEW`; `fog = $state.raw<FogGrid | null>(null)` from `onfog`; one effect sets `overlay.slot('fog')` to `[heightFogLayer(fogInstances(fog), fog, systemTheme.current)]` when `run.phase === 'setup' && viewPrefs.heightFog && fog`, else `[]`. `fogInstances` is a `$derived` on `fog`, so a theme change rebuilds the layer, not the instances. The fog layer module is lazy-imported once in `onMount` beside `@deck.gl/layers`.

- [ ] **Step 1: Write the failing tests**

`prefs.spec.ts`: `readViewPrefs(null).heightFog` is `true`; a stored `{ transitStops: true, transitAccess: false }` (no `heightFog`) reads `heightFog: true`; `writeViewPrefs({ …, heightFog: false })` then `readViewPrefs` gives `false`.

`ViewMenu.svelte.spec.ts`:

```ts
it('rows: the default menu has no fog row; /sim's lists all three in order', async () => {
  const a = render(ViewMenu, { view: DEFAULT_VIEW, theme: 'light', onchange: vi.fn() });
  await page.getByRole('button', { name: 'View' }).click();
  expect(page.getByRole('checkbox', { name: 'Height limits' }).query()).toBeNull();
  a.unmount();
  render(ViewMenu, { view: DEFAULT_VIEW, theme: 'light', onchange: vi.fn(),
    rows: ['transitStops', 'transitAccess', 'heightFog'] });
  await page.getByRole('button', { name: 'View' }).click();
  const names = page.getByRole('checkbox').elements().map((e) => e.closest('label')!.textContent!.trim());
  expect(names).toEqual(['Transit stops', 'Transit capacity within a 10-minute walk', 'Height limits']);
});
it('the fog row toggles heightFog only', async () => {
  const onchange = vi.fn();
  render(ViewMenu, { view: DEFAULT_VIEW, theme: 'light', onchange, rows: ['heightFog'] });
  await page.getByRole('button', { name: 'View' }).click();
  await page.getByRole('checkbox', { name: 'Height limits' }).click();
  expect(onchange).toHaveBeenCalledWith({ ...DEFAULT_VIEW, heightFog: false });
});
```

`SimPage.svelte.spec.ts` (plan 1's `renderSimPage` helpers; the host gains `overlayIds(): string[]`, the ids last passed to the map's `setOverlayLayers`, and `postFog(g)`, a fake-worker `current` with a fog):

```ts
it('the View menu and the fog show in Setup only', async () => {
  const h = renderSimPage(); await h.ready(); h.postFog(GRID);
  await expect.element(page.getByRole('button', { name: 'View', exact: true })).toBeVisible();
  await expect.poll(() => h.overlayIds()).toContain('sim-height-fog');
  await page.getByRole('button', { name: 'Run' }).click();
  expect(page.getByRole('button', { name: 'View', exact: true }).query()).toBeNull();
  await expect.poll(() => h.overlayIds()).not.toContain('sim-height-fog');
  expect(h.mapView()).toEqual(HIDDEN_VIEW);
});
it('toggles survive a run', async () => {
  const h = renderSimPage(); await h.ready(); h.postFog(GRID);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Height limits' }).click();
  await page.getByRole('checkbox', { name: 'Transit stops' }).click();
  await page.getByRole('button', { name: 'Run' }).click();
  await page.getByRole('button', { name: 'Change policy' }).click();
  expect(h.mapView()).toEqual({ ...DEFAULT_VIEW, heightFog: false, transitStops: true });
  expect(h.overlayIds()).not.toContain('sim-height-fog');
});
it('without transit the menu has only the fog row', async () => {
  const h = renderSimPage({ manifest: { ...MANIFEST, transit: undefined } }); await h.ready();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  expect(page.getByRole('checkbox').elements()).toHaveLength(1);
});
```

(`mapView()` reads the `view` the host's SimMap stand-in last received.)

`e2e/sim.spec.ts`:
- "Setup shows the fog and transit; Run hides them; Change policy brings them back": in Setup poll `__sfhMap.timelineSnapshot().layerIds` to contain `'sim-height-fog'` and `transit-access` visibility `'visible'`; Run → the id is gone, visibility `'none'`, no View button (`headerAction` helper below 768 px); Change policy → both back.
- "the open View menu on /sim has no axe violations" (light and dark, both projects).

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/view` and `npx vitest --run --project client src/lib/view src/lib/sim-page/SimPage.svelte.spec.ts src/lib/fzp/FzpMode.svelte.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** as the Interfaces block. The `/` page (`src/routes/+page.svelte`) keeps its `ViewMenu` call without `rows`.

- [ ] **Step 4: Verify**

Run: `npm run check`, then the Step 2 commands, then `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/sim.spec.ts e2e/transit.spec.ts`
Expected: 0 errors; PASS (chromium and mobile). Open `/sim` in `npm run preview` and look at the fog in light and dark, at zoom 13 and 16, pitched: it covers streets, rises over downtown, buildings show through. Note what you saw in the commit body.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/view src/lib/fzp src/lib/sim-page e2e/sim.spec.ts docs/dev/map-interfaces.md docs/dev/fzp-mode.md docs/dev/sim-page.md
git commit -m "feat(sim): View menu with transit and height fog, shown in Setup only" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Outlines of custom-painted lots while erasing

**Files:**
- Modify: `src/lib/sim/scenario/types.ts`, `scenario-host.ts` (+ new `scenario-host.outlines.spec.ts`), `src/lib/sim/router.ts` (+ `worker-router.spec.ts`), `src/lib/sim/scenario-client.ts` (+ `scenario-client.spec.ts`)
- Modify: `src/lib/fzp/FzpMode.svelte` (`SimClientApi.lotOutlines`, `onchunks`)
- Create: `src/lib/sim-page/painted-outline.ts` (+ spec), `src/lib/sim-page/outline-request.ts` (+ spec)
- Modify: `src/lib/sim-page/SimPage.svelte`, `e2e/sim.spec.ts`, `docs/dev/sim-page.md` ("Map overlays")

**Interfaces:**
- Consumes: `paintedLots(p, lots)` (plan 1 Task 3, `policy.ts`); `SimBrushTools.tool` (`'move' | 'paint' | 'erase'`, plan 1); `ParcelRecord.polygon` (rings in local metres about `labelPoint`) and `toLngLat(ring, labelPoint)` (`src/lib/generator/geo.ts:39`); `TOKENS[theme]['painted-outline']`; `OverlayCtors.PathLayer` (`src/lib/brush/overlay.ts`); the dash idea of `dashedCircle` (`overlay.ts:27-43`).
- Produces (`types.ts`):
  ```ts
  // request
  | { type: 'lotOutlines'; reqId: number; lots: ParcelId[] }
  // answer
  | { type: 'lotOutlines'; reqId: number; result: LotOutlinesResult }
  export type LotOutlinesResult =
    | { ok: true; lots: ParcelId[]; ringLot: Uint32Array; starts: Uint32Array; positions: Float64Array; missing: number }
    | { ok: false; reason: 'no-session'; message: string };
  ```
  `positions` are lng/lat pairs of every ring of every loaded lot, `starts` the vertex index where each ring starts (length rings + 1), `ringLot` each ring's index into `lots` (the lots answered, in request order); `missing` counts requested lots whose record is not loaded. Typed arrays are transferred. Answered only by a session with levers; `no-session` otherwise (router, as `resolveBrush` at `router.ts:62-72`; client, as `resolveBrush` at `scenario-client.ts:187-195`).
- Produces: `ScenarioClient.lotOutlines(lots): Promise<LotOutlinesResult>`; `SimClientApi.lotOutlines`; FzpMode prop `onchunks?: () => void`, called from `events.onChunks` (`FzpMode.svelte:524`).
- Produces (`painted-outline.ts`):
  ```ts
  export const OUTLINE_DASH_M = 4; // tier 4
  export const OUTLINE_GAP_M = 3;  // tier 4
  /** A closed lng/lat ring as dash paths, measured in metres along the ring. */
  export function dashRing(ring: [number, number][], dashM: number, gapM: number): [number, number][][];
  /** One PathLayer, id 'sim-painted-outline', 2 px, the 'painted-outline' token. */
  export function paintedOutlineLayers(L: OverlayCtors, o: Extract<LotOutlinesResult, { ok: true }>, theme: Theme): Layer[];
  ```
  Builder's call: one outline per lot (the lot is what the eraser acts on), not a dissolved area; metric dashes (no `PathStyleExtension`, which would be a new dependency).
- Produces (`outline-request.ts`):
  ```ts
  export class OutlineRequest {
    constructor(deps: { request(lots: ParcelId[]): Promise<LotOutlinesResult>; show(o: Extract<LotOutlinesResult, { ok: true }> | null): void });
    /** null: not erasing (clears). Same set as the last call: no new request. */
    want(lots: ReadonlySet<ParcelId> | null): void;
    /** A chunk arrived: ask again if the last answer had missing lots. */
    chunksChanged(): void;
  }
  ```
  Latest wins: an answer to an older `want` is dropped.

- [ ] **Step 1: Write the failing tests**

`scenario-host.outlines.spec.ts`: in a lever session with one cell loaded, `lotOutlines` for a loaded lot, an unloaded one and an unknown id answers `lots` = the loaded one, `missing` = 2, `starts.at(-1) * 2 === positions.length`, and the first vertex equals `toLngLat(rec.polygon[0], rec.labelPoint)[0]`; without a session the router answers `no-session`.

`painted-outline.spec.ts`:

```ts
it('dashes a 100 m square into dash and gap lengths along its edges', () => {
  const ring = squareRing(CENTRE, 100); // closed, lng/lat
  const d = dashRing(ring, 4, 3);
  expect(d.length).toBe(Math.floor(400 / 7) + 1);
  for (const dash of d.slice(0, -1)) expect(pathLengthM(dash)).toBeCloseTo(4, 1);
});
it('one path layer in the painted-outline token, per theme', () => {
  for (const theme of ['light', 'dark'] as const) {
    const [l] = paintedOutlineLayers(FAKE_L, ONE_LOT, theme);
    expect(l.id).toBe('sim-painted-outline');
    expect(l.props.getColor).toEqual(hexToRgba(TOKENS[theme]['painted-outline']));
  }
});
```

`outline-request.spec.ts`: `want(null)` calls `show(null)` and sends nothing; two `want`s with the second answered first show only the second; "re-requests on chunks": an answer with `missing: 1`, then `chunksChanged()`, sends the same lots again and shows the new answer; with `missing: 0`, `chunksChanged()` sends nothing.

`e2e/sim.spec.ts` "the eraser outlines painted lots, only while chosen": paint a stroke (plan 1's Paint helper), choose Erase → poll `timelineSnapshot().layerIds` contains `'sim-painted-outline'`; choose Move → it is gone.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/sim src/lib/sim-page/painted-outline.spec.ts src/lib/sim-page/outline-request.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `SimPage`: one `OutlineRequest` whose `request` is `api.lotOutlines` (a `no-session` result is treated as `null`) and whose `show` writes `overlay.slot('outline')`; an effect calls `want(tools.tool === 'erase' && mode === 'edit' ? new Set(paintedLots(store.policy, lots)?.keys() ?? []) : null)`; FzpMode's `onchunks` calls `chunksChanged()`; a theme change re-renders the last answer.

- [ ] **Step 4: Verify**

Run: the Step 2 command, `npx vitest --run --project client src/lib/sim-page`, `npm run check`, then `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/sim.spec.ts`
Expected: PASS, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/sim src/lib/fzp/FzpMode.svelte src/lib/sim-page e2e/sim.spec.ts docs/dev/sim-page.md
git commit -m "feat(sim): outline custom-painted lots while the eraser is chosen" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Paint feedback

On `/sim` the map is in timeline mode, so `GeneratedController` (the `/` paint path) is not running. The feedback draws the same buildings — `generate` in the worker, `packCell`, the controller's `SolidPolygonLayer` accessors — as one overlay layer that fades.

**Files:**
- Modify: `src/lib/sim/scenario/types.ts`, `scenario-host.ts` (+ new `scenario-host.preview.spec.ts`), `src/lib/sim/router.ts`, `src/lib/sim/scenario-client.ts` (+ specs)
- Modify: `src/lib/fzp/FzpMode.svelte` (`SimClientApi.previewBuildings`)
- Modify: `src/lib/map/generated-controller.ts` (export `packedCellLayer`; `makeLayer` calls it), `src/lib/brush/overlay.ts` (`OverlayCtors`)
- Create: `src/lib/sim-page/feedback.ts`, `src/lib/sim-page/feedback.spec.ts`
- Modify: `src/lib/sim-page/stroke-adapter.ts` (+ spec), `SimPage.svelte`
- Modify: `e2e/sim.spec.ts`, `docs/dev/sim-page.md` ("Map overlays")

**Interfaces:**
- Consumes: `generate(parcel, env, seed, 'max')` and `fnv1a32` (`$lib/generator`; plan 3 makes `generate` clamp at the physical max); `packCell(cellId, items)` and `packTransferables` (`src/lib/map/pack.ts:81,187`); `Lru` (`src/lib/sim/lru.ts`); `Resolution.protectedRows` (plan 1 `resolve.ts`); `ruleQueries`, `customQuery`, `queryKey` (plan 1 `policy.ts`); `LeverStatus` (`src/lib/sim-page/lever-status.ts:8-12`, `rev` on every kind but `off`); `accessorsFor` (`generated-controller.ts:89-112`).
- Produces (`types.ts`):
  ```ts
  // request: stories given = a custom stroke at that height; absent = the levers in force (a rule)
  | { type: 'previewBuildings'; reqId: number; lots: ParcelId[]; stories?: number }
  | { type: 'previewBuildings'; reqId: number; result: PreviewResult }
  export type PreviewResult =
    | { ok: true; pack: PackedCell | null; built: number; missing: number }
    | { ok: false; reason: 'no-session'; message: string };
  ```
  Worker rules, in order, per lot (the first `PREVIEW_MAX_LOTS` of the request; the page sends them nearest first): skip a lot protected under the levers in force (`LeverWork.protectedMask`, set from `filled.protectedRows` in `leverStep`); count it `missing` if its record is not loaded; with no `stories`, skip it when its plan stories equal the FZP stock stories (`lw.base.fzp.parcels.envelopeStories`), else build at the plan stories; with `stories`, build at `stories`. `generate(rec, { maxStories }, fnv1a32(rec.id), 'max')` through a host `Lru<string, GeneratedBuilding | null>` keyed `${id}|${stories}` (cap 512, builder's call), packed as `packCell('preview', …)` with `existingUnits` from the plan parcels; `pack` null when nothing builds. `ScenarioHostDeps.previewMaxLots?: number`, default `PREVIEW_MAX_LOTS = 300`, exported from `src/lib/sim/scenario/types.ts` so the page uses the same cap (tier 4: a few hundred generator calls fit a worker slice budget's order of magnitude; measured in Step 4).
- Produces: `ScenarioClient.previewBuildings(lots, stories?)`, `SimClientApi.previewBuildings`.
- Produces (`generated-controller.ts`):
  ```ts
  export function packedCellLayer(
    SolidPolygonLayer: ControllerDeps['SolidPolygonLayer'], id: string, pack: PackedCell, theme: Theme,
    opts?: { opacity?: number; pickable?: boolean; beforeId?: string; elevationScale?: number }
  ): Layer;
  ```
  `OverlayCtors` gains `SolidPolygonLayer` (the same `@deck.gl/layers` module SimPage already loads).
- Produces (`feedback.ts`):
  ```ts
  export const FEEDBACK_HOLD_MS = 500;  // tier 4: full strength
  export const FEEDBACK_FADE_MS = 1500; // tier 4: then linear to 0 (about 2 s in all, spec "my call")
  export function feedbackOpacity(t: number, reducedMotion: boolean): number | null; // null: remove
  export class PaintFeedback {
    constructor(deps: { set(layers: Layer[]): void; layer(pack: PackedCell, opacity: number): Layer;
      now(): number; raf(cb: () => void): number; cancelRaf(h: number): void; reducedMotion(): boolean });
    show(pack: PackedCell | null): void; // replaces what is showing; null clears
    destroy(): void;
  }
  export class RuleFeedbackTrigger {
    /** A rule was added or edited (BrushForms save) while the latest lever rev seen was `lastRev`. */
    saved(ruleId: string): void;
    /** Every LeverStatus; returns the rule id to show once a `current` above the save's rev lands. */
    status(s: LeverStatus): string | null;
  }
  /** Lots whose label point is in `bounds`, nearest `centre` first, at most `max`. */
  export function lotsInView(lots: readonly ParcelId[], points: Float64Array,
    bounds: [w: number, s: number, e: number, n: number], centre: [number, number], max: number): ParcelId[];
  ```
  Under reduced motion `feedbackOpacity` is 1 until `HOLD + FADE`, then null (no fade animation; builder's call, matching SimMap's reduced-motion rising animation). Layer id `sim-feedback-<n>`, `pickable: false`.
- Produces (`stroke-adapter.ts`): deps gain `onpaint?(stroke: Stroke, stories: number): void`, called after a Paint stroke's store change (never for Erase).
- SimPage wiring: `onpaint` resolves the single stroke (`api.resolveBrush(customQuery({ id: 'feedback', kind: 'paint', strokes: [stroke], stories }))`), then `api.previewBuildings(lotsInView(…, PREVIEW_MAX_LOTS), stories)`, then `feedback.show(pack)`. `saveRuleBrush` calls `trigger.saved(id)`; FzpMode's `onlevers` feeds `trigger.status`; a returned id sends that rule's lots (`ruleQueries` results from `sync`, `lotsInView` of the map's bounds) with no `stories`. A request is latest-wins (a sequence number). Builder's call: the feedback does not hide the existing building under it, because the timeline controller's demolish pump owns the `replaced` feature state.

- [ ] **Step 1: Write the failing tests**

`scenario-host.preview.spec.ts` (mini city, one cell loaded):

```ts
it('a stroke height builds the loaded lots at that height, at most the physical max', async () => {
  const h = await leverSession(DEFAULT_LEVERS);
  const r = await h.preview([LOADED_LOT, UNLOADED_LOT], 40);
  expect(r).toMatchObject({ ok: true, missing: 1 });
  const s = r.pack!.parcelIds.indexOf(LOADED_LOT);
  expect(r.pack!.parcelMeta[4 * s + 2]).toBeLessThanOrEqual(Math.min(40, lotPhysicalMaxStories(h.record(LOADED_LOT).polygon)!));
});
it('a protected lot builds nothing', async () => {
  const h = await leverSession({ ...DEFAULT_LEVERS, protect: { ...DEFAULT_LEVERS.protect, historic: true }, compare: 'fzp' });
  expect(await h.preview([MINI_HISTORIC_ID], 40)).toMatchObject({ ok: true, built: 0, pack: null });
});
it('without stories, only lots the policy changed build, at their plan height', async () => {
  const h = await leverSession({ ...DEFAULT_LEVERS, rules: [{ lots: [LOADED_LOT], stories: 30 }], compare: 'fzp' });
  const r = await h.preview([LOADED_LOT, OTHER_LOADED_LOT]);
  expect(r.ok && r.pack!.parcelIds).toEqual([LOADED_LOT]);
});
it('cap: builds at most previewMaxLots, in request order', async () => {
  const h = await leverSession(DEFAULT_LEVERS, { previewMaxLots: 1 });
  const r = await h.preview([LOADED_LOT, OTHER_LOADED_LOT], 12);
  expect(r.ok && r.pack!.parcelIds).toEqual([LOADED_LOT]);
});
```

`feedback.spec.ts` (server, fake clock and raf):

```ts
it('holds, fades and removes', () => {
  expect(feedbackOpacity(0, false)).toBe(1);
  expect(feedbackOpacity(FEEDBACK_HOLD_MS, false)).toBe(1);
  expect(feedbackOpacity(FEEDBACK_HOLD_MS + FEEDBACK_FADE_MS / 2, false)).toBeCloseTo(0.5, 6);
  expect(feedbackOpacity(FEEDBACK_HOLD_MS + FEEDBACK_FADE_MS, false)).toBeNull();
  expect(feedbackOpacity(FEEDBACK_HOLD_MS + 1, true)).toBe(1);
  expect(feedbackOpacity(FEEDBACK_HOLD_MS + FEEDBACK_FADE_MS, true)).toBeNull();
});
it('a new show replaces the old; the layer is cleared at the end', () => {
  const f = harness(); f.fb.show(PACK_A); f.tick(300); f.fb.show(PACK_B);
  expect(f.lastPack()).toBe(PACK_B);
  f.tick(FEEDBACK_HOLD_MS + FEEDBACK_FADE_MS);
  expect(f.lastLayers()).toEqual([]);
});
it('the rule trigger fires once, on a current above the save', () => {
  const t = new RuleFeedbackTrigger();
  t.status({ kind: 'resolving', rev: 4, done: 0, total: 0, failedCells: [] });
  t.saved('r1');
  expect(t.status(current(4))).toBeNull(); // the revision sent before the save
  t.status({ kind: 'resolving', rev: 5, done: 0, total: 0, failedCells: [] });
  expect(t.status(current(5))).toBe('r1');
  expect(t.status(current(6))).toBeNull();
});
it('nearest first: lotsInView keeps in-view lots, nearest the centre, up to max', () => {
  const pts = new Float64Array([0.5, 0.5, 0.1, 0.1, 2, 2, 0.45, 0.5]);
  expect(lotsInView(['a', 'b', 'out', 'c'], pts, [0, 0, 1, 1], [0.5, 0.5], 2)).toEqual(['a', 'c']);
});
```

`stroke-adapter.spec.ts`: a Paint stroke at 8 stories calls `onpaint` once with the stroke and 8; an Erase stroke does not call it.

`e2e/sim.spec.ts` "a Paint stroke shows its buildings, then they fade": paint a stroke over fixture lots → poll `timelineSnapshot().layerIds.some((id) => id.startsWith('sim-feedback-'))` to be true, then false within 4 s; an Erase stroke never adds one.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/sim src/lib/sim-page/feedback.spec.ts src/lib/sim-page/stroke-adapter.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** as the Interfaces block; `makeLayer` (`generated-controller.ts:387-402`) becomes a call to `packedCellLayer` with `pickable: true`, `autoHighlight` and the controller's `beforeId`, so `generated-controller.svelte.spec.ts` stays green unchanged.

- [ ] **Step 4: Verify and measure**

Run: the Step 2 command, `npx vitest --run --project server src/lib/map src/lib/sim-page`, `npx vitest --run --project client src/lib/map src/lib/sim-page`, `npm run check`, then `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/sim.spec.ts`
Expected: PASS, 0 errors. Then in `npm run preview` on a local copy of the live dataset (`npm run data:local -- <version>`), add a Transit rule at zoom 14 downtown and read the worker's `previewBuildings` duration from the console `measure`; if it exceeds 500 ms, lower `PREVIEW_MAX_LOTS` and say so in the commit body.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/sim src/lib/fzp/FzpMode.svelte src/lib/map/generated-controller.ts src/lib/brush/overlay.ts src/lib/sim-page e2e/sim.spec.ts docs/dev/sim-page.md
git commit -m "feat(sim): painted and rule-zoned lots briefly show the buildings they could hold" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: "Allowed: N · Buildable here: M" in the lot tooltip

The lot tooltip on `/sim` is SimMap's existing-building tooltip (hover) and tap surface (`SimMap.svelte:1103-1143`, `tooltipLines`), fed by `requestParcelSummary`, which FzpMode maps to `ParcelSummaryLike` (`FzpMode.svelte:633-645`). The worker's `parcelSummary` already reads the shown levers' envelope (`scenario-host.ts:959-972`).

**Files:**
- Modify: `src/lib/sim/protocol.ts` (`ParcelSummary.limits?`), `src/lib/map/types.ts` (`ParcelSummaryLike.limits?`), `src/lib/sim/scenario/scenario-host.ts` (`parcelSummary`) (+ new `scenario-host.limits.spec.ts`)
- Modify: `src/lib/map/tooltip.ts`, `tooltip.spec.ts`, `src/lib/map/SimMap.svelte` (render a third line when present)
- Modify: `src/lib/fzp/FzpMode.svelte` (`requestParcelSummary` passes `limits`)
- Modify: `e2e/sim.spec.ts`, `docs/dev/sim-page.md` ("Map overlays")

**Interfaces:**
- Consumes: `lotBuildableStories(polygon, allowed, existingUnits)` (plan 3 Task 1, `$lib/generator`); the Task 6 generate memo and `LeverWork.protectedMask`.
- Produces:
  ```ts
  // src/lib/map/types.ts (ParcelSummary in protocol.ts gains the same optional field)
  export interface LotLimits { allowed: number; buildable: number | null; protected: boolean }
  export interface ParcelSummaryLike { /* … */ limits?: LotLimits }
  // src/lib/map/tooltip.ts
  export function tooltipLines(hit: TooltipHit): [string, string] | [string, string, string];
  ```
  Worker: `limits` only in a session with levers, for an eligible lot with plan stories `allowed > 0`. `buildable` = the generated building's `stories` at `allowed` (Task 6 memo), else `lotBuildableStories(rec.polygon, allowed, existingUnits)` (plan 3 open question 3's order; builder's call: the generator's null means "no gain over what stands", while the line is about what the lot's shape allows). `protected` from `protectedMask`. The editor host (`src/lib/sim/host.ts`) never sets it, so `/` is unchanged.
- Third line copy (exact): `Allowed: ${allowed} · Buildable here: ${buildable}`; `Allowed: ${allowed} · Protected` when protected; `Allowed: ${allowed}` when `buildable` is null.

- [ ] **Step 1: Write the failing tests**

`tooltip.spec.ts`:

```ts
const existing = (limits?: LotLimits): TooltipHit => ({ kind: 'existing', parcelId: '1', chunk: 'ready',
  summary: { parcelId: '1', eligible: true, existingUnits: 2, generated: null, ...(limits && { limits }) } });
it('adds the limits line', () => {
  expect(tooltipLines(existing({ allowed: 40, buildable: 6, protected: false }))[2]).toBe('Allowed: 40 · Buildable here: 6');
  expect(tooltipLines(existing({ allowed: 40, buildable: 6, protected: true }))[2]).toBe('Allowed: 40 · Protected');
  expect(tooltipLines(existing({ allowed: 8, buildable: null, protected: false }))[2]).toBe('Allowed: 8');
});
it('two lines without limits (the editor)', () => {
  expect(tooltipLines(existing())).toHaveLength(2);
});
```

`scenario-host.limits.spec.ts`: painting a loaded 25×100 ft-class mini lot to 40 stories gives `limits.allowed === 40` and `limits.buildable` ≤ `lotPhysicalMaxStories(polygon)` once `current`; under `historic: true` the historic lot reads `protected: true`; a lot with plan stories 0 has no `limits`; with a fake `generate` returning null, `buildable` equals `lotBuildableStories(polygon, allowed, existingUnits)`.

`e2e/sim.spec.ts` "hovering a building shows its allowed and buildable stories" (chromium): hover the projected centre of a fixture building whose parcel is eligible (read from fixture-0's chunk and `parcels.bin` with the shared codecs, `projectToPage` from `e2e/helpers/sharing.ts`) → the tooltip (`role="tooltip"`) text matches `/Allowed: \d+ · (Buildable here: \d+|Protected)/`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/map/tooltip.spec.ts src/lib/sim/scenario/scenario-host.limits.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** as the Interfaces block; SimMap renders the optional third line as the second, in the same element style.

- [ ] **Step 4: Verify**

Run: the Step 2 command, `npx vitest --run --project client src/lib/map`, `npm run check`, then `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/sim.spec.ts e2e/map.spec.ts`
Expected: PASS, 0 errors (the `/` tooltip e2e unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sim src/lib/map src/lib/fzp/FzpMode.svelte e2e/sim.spec.ts docs/dev/sim-page.md
git commit -m "feat(sim): lot tooltip shows allowed and buildable stories" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Full verification and the docs pass

**Files:**
- Modify: `docs/dev/sim-page.md`, `docs/dev/fzp-mode.md`, `docs/dev/map-interfaces.md` (consistency read; fix anything a task left stale)

- [ ] **Step 1: Read the three docs end to end.** `sim-page.md` "Map overlays" covers: the fog (source, grid constants and tiers, Setup only, default on, View menu row), the outlines (erase tool only), the feedback (stroke vs rule triggers, `PREVIEW_MAX_LOTS`, fade timings, reduced motion), the tooltip line, and these known gaps: a vacant lot has no tooltip (picking reads the buildings layer, `SimMap.svelte:1052-1061`); the fog's self-overlap at steep edges blends twice (no depth write); outlines and feedback cover loaded chunks only. `fzp-mode.md` lists FzpMode's `view`, `onfog`, `onchunks` props and drops the hard-coded-off note. `map-interfaces.md` "Transit layers" says the View menu is mounted on `/sim` in Setup with a fog row, and gating there is per row.

- [ ] **Step 2: Run the full gate**

Run: `npm run check` then `npm run lint` then `npm run test:unit` then `npm run test:e2e`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add docs/dev
git commit -m "docs(sim): map overlays, paint feedback and lot limits" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Open questions (partner)

1. **Fog legibility.** A uniform translucent tint can read as a colour cast, not a surface. The plan shades by slope (`rgb *= mix(0.82, 1.0, n.z)`, alpha unchanged), so ridges read. *Recommendation:* keep it; flat areas stay exactly the spec's token.
2. **Fog over large areas with no limit.** Water and the interior of a large park with no envelope get no fog beyond ~100 m from a limit (`FOG_FILL_CELLS = 2`), so the haze ends at the shore rather than lying on the Bay. *Recommendation:* accept; "covering roads and open space" is met for streets and small parks.
3. **One View-prefs record for `/` and `/sim`.** Turning transit stops on in `/sim` turns them on in `/` too. *Recommendation:* shared; a viewer's map preference is about them, not the mode.
4. **Rule feedback cap.** A rule covering thousands of lots in view shows the 300 nearest the view centre. *Recommendation:* accept, and lower the cap if the Task 6 measurement says so.
5. **Feedback over the existing building.** For two seconds the generated building and the existing one overlap (the existing one is not hidden). *Recommendation:* accept; hiding would fight the timeline's demolish pump.

## Spec / plan / code contradictions found

- **Plan 1's transport note.** Plan 1 ("Interfaces for plans 2 and 3") says `EnvelopeTable.stories` lives only in `PendingLevers.state.resolution` and suggests a per-row `Uint8Array` on `current`. The worker already carries it after each revision as `w.loaded.fzp.parcels.envelopeStories` (`parcelsView`, `view.ts:50`; read today by `parcelSummary`, `scenario-host.ts:959-972`). The page has no label points to grid a per-row array, so this plan posts the computed grid, and nothing reads the `Resolution` after `leverStep` except the new protected mask.
- **Plan 1's physical-cap seam vs plan 3's open question 3.** Plan 1 says the tooltip "calls `physicalMaxStories` on the lot's `Site`"; plan 3 recommends the worker's generated stories, else `lotBuildableStories`. The main thread has no lot polygons, so this plan computes it in the worker, in plan 3's order.
- **Spec §4 fog height "FZP as written plus your painting"** vs the dispatch's "FZP + rules + paint". The plan follows the effective table (rules are part of the limit in force). A painted lot under a category protection shows its FZP height, because the protected row keeps its FZP stories (plan 1 Task 1).
- **Spec §8 painted-outline `#BF5A3A`.** Plan 3 rules it `#B4532F` for contrast; this plan uses the token.
- **`/`'s View menu is gated on `manifest.transit`** (`docs/dev/map-interfaces.md`, "UI gating"); on `/sim` the menu always shows (the fog row needs no transit) and only the transit rows are gated.
