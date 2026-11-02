# Height limits as glass lids: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/sim`'s height fog with glass lids (zoomed in) and ground contour lines (zoomed out), built in the scenario worker from the effective per-lot limits, with a paint-source look while painting and a rule-selection highlight.

**Architecture:** The worker gains a pure, worker-safe module `src/lib/map/height/`. At each lever revision's resolve step it runs a staged **city build** (a 15 m label-point raster of the whole city: region components, room to grow per component, contour chains and contour labels) and posts it as a new `heights` message. The page asks for **lids** for its view (`heightLids { bbox }`). The worker answers from a staged **lid build**: a 2 m raster of the loaded lots in the view, street gaps of up to 30 m closed between lots of the same component, traced into faces, rims and walls. Every face, rim and chain carries the source that decided its lots (FZP, paint or a rule id), so paint styling and rule selection are page-side restyles. The page draws one deck `CompositeLayer` (`HeightLimitsLayer`) in the overlay mux. It holds the glaze faces, a custom wall layer, rim and contour paths (metric dashes for paint) and labels, and crossfades lids and contours around z15.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, deck.gl ~9.4 (`@deck.gl/core`, `@deck.gl/layers`; **no** `@deck.gl/extensions`), luma.gl, MapLibre GL 6, Vitest (server, client and GPU browser specs), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-01-height-lids-design.md` (supersedes §4 "Height fog" of `docs/superpowers/specs/2026-10-31-sim-runs-design.md`; §8's palette rules still bind).

## Global Constraints

- **Before Task 1:** the worktree has no `node_modules`. Run `npm install`, then `npx playwright install chromium`, then `echo 'PUBLIC_DATASET_VERSION=fixture-0' > .dev.vars`, then `npm run data:fixture` and `npm run db:migrate`.
- Issue `cd` as its own command. Never `cd … && cmd`.
- Conventional Commits. No Claude attribution or co-author trailers. For multi-line messages use several `-m` flags, never heredocs.
- Vitest runs with `expect.requireAssertions`: every test calls `expect`. Single file: `npx vitest --run --project server <file>` (or `--project client`).
- Hues (spec §8, design "Constraints"): limits use **ink and neutral only**. Terracotta (the `painted-outline` token) is used only for the paint-source dash while the brush or eraser is selected. No blue or violet anywhere (they are reserved for water).
- Anti-goals: no marker on every lot (no sticks, ghost boxes or per-building caps); limits must not look like a ground tint; overlays must stay distinguishable from transit (teal), pipeline (plum) and new housing (terracotta).
- Lids and contours show **in Setup only**. They are on by default and toggled in the View menu.
- Room to grow = Σ `max(0, limit − existingStories)` over **countable** lots only. Imputed `existingStories` counts as given.
- A single 25 ft (7.62 m) lot whose limit differs from its neighbours stays its own region. The lid raster is never coarser than 2 m.
- Lid and contour geometry is built in the worker, never on the main thread (the bench's synthetic loader is the one exception).
- Worker work runs in slices: no macrotask over 50 ms (`SLICE_MS`, `src/lib/sim/scenario/scenario-host.ts`). Each staged build's `step(budgetMs)` returns within its budget plus one row band.
- Map perf bar: p95 frame ≤ 16.7 ms (`docs/dev/map-perf.md`). Zero main-thread map JS per pan frame beyond deck's own `shouldUpdateState`.
- WCAG 2.2 AA: the paint state is carried by the dash, not colour alone. Label text keeps ≥ 4.5:1 against its halo and the land. New controls are ≥ 24×24 CSS px and named.
- No new runtime dependency. `clipper2-ts` is present but unused here (see Task 3's decision).
- CSP is unchanged: no font or asset fetch. Deck's `TextLayer` draws with a system font through a canvas atlas.

## Review Focus

1. **Limits change while a lid build runs** (a stroke lands mid-pan). The lid answer must come entirely from the newest limits, never mixing components of one revision with stories of another. The test is in Task 8 ("a setLevers during a lid build restarts it on the new limits").
2. **The selected rule is removed, or decides no lot.** Selection clears on removal. A rule that decides nothing dims everything and highlights nothing, without throwing. The tests are in Task 13.
3. **A huge or very pitched viewport** (a 2560 px wide window at z14.5) asks for a span beyond the raster cap. The page clamps the bbox around the centre and the worker never allocates over the cap. The tests are in Task 12 (`LidRequest` clamp) and Task 7 (`too-large`).
4. **Session restart, crash or `/fzp`**: `heightLids` answers `no-session`. The page keeps the contours, drops the lids and asks again on the next `onclient`. The tests are in Tasks 8 and 12.
5. **A theme switch or a tool change while lids are shown** rebuilds only the deck layer and sends no new worker request. The test is in Task 12.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/sim/levers/types.ts` (modify) | `StoryEdit.source?: string` (the rule id), parsed optionally |
| `src/lib/sim/levers/source.ts` (create) | `limitSources`: the per-lot winning source (FZP, paint, rule k) |
| `src/lib/sim-page/policy.ts` (modify) | `ruleEdits` stamps `source: rule.id` |
| `src/lib/map/height/types.ts` (create) | Wire types `HeightCity`, `HeightLids`, `ChainSet`, `LabelSet`, source codes |
| `src/lib/map/height/room.ts` (create) | `storiesToM`, the countable mask, glaze steps, label text |
| `src/lib/map/height/raster.ts` (create) | Raster frame, ring rasterizing, nearest-seed field, gap closing, inside distance |
| `src/lib/map/height/vectorize.ts` (create) | Topology-preserving boundary chains, simplify, smooth, face assembly |
| `src/lib/map/height/labels.ts` (create) | Greedy per-zoom label placement (precomputed collision) |
| `src/lib/map/height/city.ts` (create) | Staged city build: components, room, contours, contour labels |
| `src/lib/map/height/lids.ts` (create) | Staged lid build: faces, rims, walls, lid labels |
| `src/lib/map/height/test/fixtures.ts` (create) | Tiny real-builder fixtures shared by host, page and GPU specs |
| `src/lib/map/height/height.bench.spec.ts` (create) | Per-step budgets of both builds on synthetic data |
| `src/lib/sim/scenario/types.ts`, `scenario-host.ts`, `src/lib/sim/router.ts`, `src/lib/sim/scenario-client.ts` (modify) | The `heights` message, the `heightLids` request, staged jobs; the fog removed |
| `src/lib/fzp/FzpMode.svelte` (modify) | `onheights` replaces `onfog`; `SimClientApi.heightLids` |
| `src/lib/map/palette.ts` (modify) | `limit-ink`, `limit-glaze`, `limit-wall`, `limit-halo`; `height-fog` removed |
| `src/lib/map/dash.ts` (create) | `dashPath` (2D/3D, open or closed), extracted from `painted-outline.ts` |
| `src/lib/map/height/wall-layer.ts` (create) | Custom instanced wall quads (from the fog layer's shader pattern) |
| `src/lib/map/height/limits-style.ts` (create) | Pure per-mode looks of rims, chains, glaze and walls; the crossfade |
| `src/lib/map/height/limits-layer.ts` (create) | `HeightLimitsLayer` CompositeLayer |
| `src/lib/sim-page/lid-request.ts` (create) | Page side of `heightLids`: latest wins, clamp, re-ask |
| `src/lib/sim-page/SimPage.svelte`, `overlay-mux.ts`, `src/lib/view/prefs.ts`, `src/lib/view/ViewMenu.svelte` (modify) | Wiring, the `limits` slot, the pref rename, the View row |
| `src/lib/sim-page/BrushCard.svelte`, `RulesSection.svelte` (modify) | The rule "Show on map" toggle |
| `src/lib/map/fog/*`, `src/lib/map/test/synthetic-fog.ts` (delete) | Fog removed |
| `src/lib/map/test/synthetic-limits.ts`, `src/lib/map/debug.ts`, `e2e/bench/map-timeline.bench.ts` (create/modify) | Bench case "playback + limits" |
| `docs/dev/*.md` (modify) | sim-page, map-interfaces, sim-levers, fzp-mode, map-perf, testing |

## Decisions (builder's calls, made here)

- **Dissolve: raster, not clipper offsets.** Lots are rasterized at 2 m (cell centres, even-odd). Street gaps close by **directional runs**: along 4 directions (E, N, NE, NW), a run of empty cells ≤ 30 m bounded at both ends by lots of the same component is filled. Two passes are made, so intersections close too. Reason: only empty cells are ever filled, so an exception lot can never be swallowed (clipper's offset closing would fill it and need a subtraction pass). Water, open lots and runs that leave the raster are never bridged. It is O(cells), so it slices by line ranges. `clipper2-ts` (`src/lib/generator/assemble.ts:1`) is not needed.
- **Vectorizing:** boundary chains between differing labels run junction to junction. Each is simplified once with Douglas–Peucker (lids 1.2 m, city 7.5 m), and faces are assembled from the same simplified chains. So neighbouring faces share edges exactly, with no gaps or slivers. City chains are also Chaikin-smoothed twice for a topographic look.
- **City-wide source: a 15 m label-point raster, not a pipeline layer.** Each cell takes the nearest lot's label point within that lot's reach, `clamp(0.5·√lotAreaM2 + 20, 30, 200)` m (two-pass vector propagation). Reason: it needs no chunks and no dataset bump (`/sim` data ordering, `docs/dev/sim-page.md` "Dataset requirement"). It also follows paint and rules at every revision, which a pipeline layer for the FZP baseline would need deltas layered on top to do.
- **Regions (components):** 4-connected city cells with equal stories > 0. A lot's component is that of its label-point cell when the stories match, else a singleton component of its own (the exception). Lids merge only lots of one component. So "one region, one label, one room figure" holds city-wide, even though lids cover only loaded chunks.
- **Countable lots (room to grow):** not protected, `eligible`, stories ≥ 1, and either `hostable` on the resolved table or a pending `Need` row (a Need's `hostable` is 0 until `fillNeeds`, `src/lib/sim/levers/resolve.ts:122-125`).
- **Glaze density:** room per area is `Σ countable·max(0, s − e)·lotArea / Σ lotArea` (an area-weighted mean of unused stories). Steps at 1, 3 and 6 give steps 0 to 3. The glaze alpha is the `limit-glaze` token alpha × `[0.3, 0.55, 0.8, 1]`.
- **Zoom:** lids fade in over z14.5 to 15.5 and contours fade out over the same band. The page asks for lids only at z ≥ 14.5. The lid request span is clamped to 3 km × 3 km around the view centre.
- **Labels: precomputed collision.** For each integer zoom (lids 15 to 19, contours 11 to 15) the worker places labels greedily by priority (area for lids, chain length for contours). Each label's estimated box (7 px per character + 4 px padding, 16 px tall) must not overlap any placed box. A lid label also needs an inscribed radius ≥ half its box height ("labelled when there's room"). Each label gets a `minZoom`, and the layer shows the labels with `minZoom ≤ floor(zoom)`. Reason: deck's `CollisionFilterExtension` needs `@deck.gl/extensions`, a dependency the codebase avoided (`src/lib/sim-page/painted-outline.ts:3-4`). Labels ignore depth.
- **Contour labels:** the higher side's stories, `40+` at 40 or more. Only chains ≥ 300 m long get one. Contour widths are 1 px below a 4-story step, 1.5 px from 4 to 11, and 2 px from 12. Dashes are 40 m on, 30 m off for contours and 4 m on, 3 m off for rims (`OUTLINE_DASH_M`/`OUTLINE_GAP_M`).
- **Ties in the per-lot source:** a rule decides only if its stories are strictly above FZP. Among rules at the same height, the first in list order decides. Paint overrides rules. A protected lot is FZP.
- **The paint split** is done without a worker round trip. Faces, rims and chains are split by (component, source) all the time. Rims between same-component pieces (kind `SOURCE`) are hidden unless the mode needs them. With no tool, adjacent same-component faces share a glaze and edges, so they read as one region.
- **Rule selection affordance:** a "Show on map" toggle button (`aria-pressed`) on each rule card, beside Edit and Remove. It is inside `ReadonlyFieldset`. Rule mode takes precedence over paint mode.
- **View menu:** the field `heightFog` becomes `heightLimits`, and a stored `heightFog` is still read. The row is "Zoning height limits", with the caption "Glass lids at the height zoning allows, with each area's room to grow in floors. Zoomed out, contour lines."

## Open questions (for the partner; the plan proceeds on the recommendation)

- **Per-lot source delivery.** The spec says the worker "must report, for each lot, which source won". The plan computes it per lot in the worker (`limitSources`). It ships it to the page already aggregated onto faces, rims and chains, plus `sourceIds`, rather than as a raw 160k-entry column. The page has no per-lot geometry to apply a raw column to. *Recommend: as planned.*
- **Row label wording** ("Zoning height limits" and the caption above). *Recommend: as planned, tune in review.*

---

### Task 1: Rule ids on edits and the per-lot limit source

**Files:**
- Modify: `src/lib/sim/levers/types.ts:19-23` (`StoryEdit`), `:125-136` (`parseStoryEdit`)
- Modify: `src/lib/sim-page/policy.ts:483-495` (`ruleEdits`)
- Create: `src/lib/sim/levers/source.ts`
- Test: `src/lib/sim/levers/types.spec.ts`, `src/lib/sim/levers/source.spec.ts`, `src/lib/sim-page/policy.spec.ts`

**Interfaces:**
- Consumes: `LayerCtx`, `stockTable` (`src/lib/sim/levers/layers.ts:18-42`); `protectedRows` (`resolve.ts:44-62`).
- Produces:
  ```ts
  // types.ts
  export interface StoryEdit { lots: ParcelId[]; stories: number; source?: string } // source: rule id
  // source.ts
  export const SRC_FZP = 0, SRC_PAINT = 1, SRC_RULE0 = 2, SRC_NONE = 0xffff;
  export interface LimitSources { source: Uint16Array; ruleIds: string[] } // code SRC_RULE0 + k ↔ ruleIds[k]
  export function limitSources(ctx: LayerCtx, levers: SimLevers, protectedRows: Int32Array): LimitSources;
  ```
  `ruleIds` lists each distinct `source` of `levers.rules` in first-appearance order. An edit with no `source` uses `''`.

- [ ] **Step 1: Write the failing tests**

```ts
// types.spec.ts
it('a rule edit may carry a string source; a non-string source names its path', () => {
  expect(parseSimLevers(with_({ rules: [{ ...edit, source: 'r1' }] })).rules[0].source).toBe('r1');
  expect(pathOf(with_({ rules: [{ ...edit, source: 3 }] }))).toBe('rules[0].source');
  expect('source' in parseSimLevers(with_({ rules: [edit] })).rules[0]).toBe(false);
});
// policy.spec.ts
it('compileLevers stamps each rule band edit with its rule id; paint edits have none', () => {
  const l = compileLevers(policyWithRuleAndPaint, lotsOf);
  expect(l!.rules.every((e) => e.source === 'rule-a')).toBe(true);
  expect(l!.paint.every((e) => !('source' in e))).toBe(true);
});
// source.spec.ts (ctx from the resolve.spec helpers: lot A FZP 4, B FZP 4, C FZP 4, D FZP 4)
it('a rule above FZP decides; the first of equal rules decides; a rule at or below FZP does not', () => {
  const s = limitSources(ctx, levers({ rules: [e(['A'], 6, 'r1'), e(['A'], 6, 'r2'), e(['B'], 3, 'r3')] }), none);
  expect(s.ruleIds).toEqual(['r1', 'r2', 'r3']);
  expect(s.source[rowOf('A')]).toBe(SRC_RULE0 + 0);
  expect(s.source[rowOf('B')]).toBe(SRC_FZP);
});
it('paint overrides a rule; a protected painted lot is FZP', () => {
  const s = limitSources(ctx, levers({ rules: [e(['C'], 8, 'r1')], paint: [e(['C', 'D'], 2)] }), Int32Array.of(rowOf('D')));
  expect(s.source[rowOf('C')]).toBe(SRC_PAINT);
  expect(s.source[rowOf('D')]).toBe(SRC_FZP);
});
it('agrees with resolveEnvelopes on every lot (property)', () => {
  // fc over random rules/paint/protections on the resolve.spec ctx:
  // src FZP ⇒ plan stories = fzp stories; rule k ⇒ = max stories of rule k's edits naming it; PAINT ⇒ = last paint
  expect(() => fc.assert(prop)).not.toThrow();
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest --run --project server src/lib/sim/levers/types.spec.ts src/lib/sim/levers/source.spec.ts src/lib/sim-page/policy.spec.ts`
Expected: FAIL (`source` rejected as an unknown key; `limitSources` not defined).

- [ ] **Step 3: Implement**

`parseStoryEdit` accepts the keys `lots`, `stories` and optional `source` (a string, else `LeverFormatError` at `<path>.source`). `ruleEdits` adds `source: r.id`. `limitSources` mirrors `resolvePlan`'s order (`resolve.ts:74-110`): rules (strictly above FZP, first max wins), then paint in order, then protections reset to FZP.

- [ ] **Step 4: Run the tests and see them pass**

Run: the same command. Expected: PASS. Also run `npx vitest --run --project server src/lib/sim` to check that nothing else keyed on edit shape broke.

- [ ] **Step 5: Commit**

`git add src/lib/sim/levers/types.ts src/lib/sim/levers/types.spec.ts src/lib/sim/levers/source.ts src/lib/sim/levers/source.spec.ts src/lib/sim-page/policy.ts src/lib/sim-page/policy.spec.ts`
`git commit -m "feat(sim): rule ids on story edits and the per-lot limit source"`

---

### Task 2: Wire types and room to grow

**Files:**
- Create: `src/lib/map/height/types.ts`, `src/lib/map/height/room.ts`
- Test: `src/lib/map/height/room.spec.ts`

**Interfaces:**
- Consumes: `EnvelopeTable`, `Need` (`resolve.ts:17-28`); `GROUND_FTF_M`, `FTF_M` (`$lib/generator/constants`, as `src/lib/map/fog/grid.ts:12,43-45` uses them).
- Produces (`types.ts`, types and constants only, worker-safe):
  ```ts
  export const CHAIN_LIMIT = 0, CHAIN_SOURCE = 1; export const NO_ZOOM = 255;
  export interface LabelSet { text: string[]; position: Float64Array /* lng,lat,zM per label */; minZoom: Uint8Array }
  export interface ChainSet { starts: Uint32Array; positions: Float64Array /* lng,lat */; hi: Uint8Array; lo: Uint8Array; kind: Uint8Array; srcA: Uint16Array; srcB: Uint16Array }
  export interface HeightCity { rev: number; sourceIds: string[]; chains: ChainSet; labels: LabelSet }
  export interface LidPieces { stories: Uint8Array; source: Uint16Array; component: Uint32Array; glaze: Uint8Array }
  export interface LidFace { piece: number; rings: Float64Array[] } // lng,lat pairs; rings[0] outer (CCW), rest holes
  export interface LidRims { starts: Uint32Array; positions: Float64Array /* lng,lat,zM */; piece: Uint32Array; kind: Uint8Array }
  export interface LidWalls { count: number; a: Float64Array; b: Float64Array /* lng,lat */; zLo: Float32Array; zHi: Float32Array; piece: Uint32Array /* the higher side */ }
  export interface HeightLids { limitsRev: number; pieces: LidPieces; faces: LidFace[]; rims: LidRims; walls: LidWalls; labels: LabelSet }
  ```
  `room.ts`:
  ```ts
  export function storiesToM(stories: number): number; // 0 → 0; s ≥ 1 → GROUND_FTF_M + (s − 1)·FTF_M (moved from fog/grid.ts)
  export function countableMask(t: EnvelopeTable, eligible: Uint8Array, needs: readonly Need[], protectedRows: Int32Array): Uint8Array;
  export const GLAZE_STEP_AT = [1, 3, 6] as const;
  export function glazeStep(unusedStoryM2: number, areaM2: number): 0 | 1 | 2 | 3;
  export function lidLabelText(stories: number, roomFloors: number): string; // "4 stories · +120 floors"
  export function contourLabelText(stories: number): string; // "8", "40+"
  ```

- [ ] **Step 1: Write the failing tests**

```ts
it('storiesToM matches the fog it replaces', () => {
  expect(storiesToM(0)).toBe(0);
  expect(storiesToM(1)).toBe(GROUND_FTF_M);
  expect(storiesToM(4)).toBeCloseTo(GROUND_FTF_M + 3 * FTF_M);
});
it('countable: hostable or a Need row, eligible, ≥ 1 story, not protected', () => {
  // rows: 0 hostable; 1 not hostable, not a need; 2 a Need (hostable 0); 3 protected hostable; 4 ineligible need; 5 stories 0
  expect([...countableMask(t, eligible, [{ row: 2, stories: 6, cap: null }, { row: 4, stories: 6, cap: null }], Int32Array.of(3))])
    .toEqual([1, 0, 1, 0, 0, 0]);
});
it('glaze steps at 1, 3, 6 unused stories per area', () => {
  expect([0.5, 1, 2.9, 3, 6, 40].map((m) => glazeStep(m * 100, 100))).toEqual([0, 1, 1, 2, 3, 3]);
  expect(glazeStep(0, 0)).toBe(0);
});
it('label text', () => {
  expect(lidLabelText(4, 120)).toBe('4 stories · +120 floors');
  expect(lidLabelText(1, 1)).toBe('1 story · +1 floor');
  expect(lidLabelText(12, 1240)).toBe('12 stories · +1,240 floors');
  expect(lidLabelText(4, 0)).toBe('4 stories · +0 floors');
  expect([4, 39, 40, 65].map(contourLabelText)).toEqual(['4', '39', '40+', '40+']);
});
```

- [ ] **Step 2: Run and see it fail.** Run `npx vitest --run --project server src/lib/map/height/room.spec.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement both files.** `types.ts` holds no runtime code beyond the constants.
- [ ] **Step 4: Run and see it pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/lib/map/height/types.ts src/lib/map/height/room.ts src/lib/map/height/room.spec.ts` then `git commit -m "feat(sim): height-limit wire types and room to grow"`

---

### Task 3: Raster primitives

**Files:**
- Create: `src/lib/map/height/raster.ts`
- Test: `src/lib/map/height/raster.spec.ts`

**Interfaces:**
- Consumes: `project`, `M_PER_DEG_LNG`, `M_PER_DEG_LAT`, `LNG0`, `LAT0`, `BBox` (`src/lib/plan/geometry.ts:5-23`).
- Produces:
  ```ts
  export interface RasterFrame { x0: number; y0: number; cell: number; cols: number; rows: number } // plan metres, SW origin
  export const EMPTY = 0, BLOCK = 0xffffffff;
  export function frameFor(bbox: BBox, cell: number, padM: number): RasterFrame;
  export function vertexToLngLat(f: RasterFrame, gx: number, gy: number): [number, number]; // grid-vertex units
  export function rasterizeRings(f: RasterFrame, rings: readonly (readonly [number, number])[][], label: number, out: Uint32Array): number; // lng/lat rings, even-odd, cell centres; returns cells written
  export type GapDir = 0 | 1 | 2 | 3; // E, N, NE, NW
  export function lineCount(f: RasterFrame, d: GapDir): number;
  export function closeGapLines(labels: Uint32Array, f: RasterFrame, d: GapDir, from: number, to: number, maxGapM: number,
    bridge: (a: number, b: number) => number /* fill label, or EMPTY for none */, rank: (label: number) => number): void;
  export class NearestField { // city: nearest label point within its reach
    constructor(f: RasterFrame, seedsLngLat: Float64Array, reachM: Float32Array);
    forward(r0: number, r1: number): void; backward(r0: number, r1: number): void; result(): Int32Array; // seed index or -1
  }
  export function insideDistance(group: Uint32Array, f: RasterFrame, r0: number, r1: number, out: Float32Array, pass: 'forward' | 'backward'): void; // metres to the nearest cell of another group
  ```
  `closeGapLines` fills only `EMPTY` cells, never `BLOCK` or lot cells. A run touching the raster edge is never filled. On a conflict (a cell filled by an earlier direction) the higher `rank` wins, and on a tie the lower label. Diagonal steps count √2·cell.

- [ ] **Step 1: Write the failing tests**

```ts
// frame: 2 m cells; helpers lotRect(xM, yM, wM, hM) give lng/lat rings in the frame
it('a 25 ft × 100 ft lot covers 3–4 cells across and survives between two same-limit blocks', () => {
  rasterizeRings(f, blockA_west, 1, L); rasterizeRings(f, lot25ft, 2, L); rasterizeRings(f, blockA_east, 1, L);
  for (let d = 0 as GapDir; d < 4; d++) closeGapLines(L, f, d, 0, lineCount(f, d), 30, sameComp, rank);
  expect(cellsWith(L, 2)).toBeGreaterThanOrEqual(3 * 15);
  expect(cellsWith(L, 2)).toBe(cellsWith(before, 2)); // never overwritten
});
it('closes a 20 m street between two blocks of one component, not a 40 m one', () => {
  expect(labelAtM(L20, streetCentre)).toBe(1);
  expect(labelAtM(L40, streetCentre)).toBe(EMPTY);
});
it('never bridges across BLOCK (a limit-0 lot) or off the raster edge (water)', () => {
  expect(labelAtM(Lpark, parkCentre)).toBe(BLOCK);
  expect(labelAtM(Lshore, beyondLastLot)).toBe(EMPTY);
});
it('does not bridge two different components', () => {
  expect(labelAtM(L48, streetCentre)).toBe(EMPTY);
});
it('a second pass closes the intersection; the taller rank wins a contested cell', () => {
  expect(labelAtM(Lx, intersectionCentre)).toBe(1);
  expect(labelAtM(Lcontest, contested)).toBe(tallerLabel);
});
it('NearestField: a cell takes the nearest seed within that seed’s reach, -1 beyond', () => {
  const nf = new NearestField(f15, seeds, Float32Array.of(30, 30));
  nf.forward(0, f15.rows); nf.backward(0, f15.rows);
  expect(nf.result()[cellAt(f15, 10, 0)]).toBe(0);
  expect(nf.result()[cellAt(f15, 200, 0)]).toBe(-1);
});
it('insideDistance: the centre of a 20 m square is ≈ 10 m from its edge', () => {
  expect(distAt(centre)).toBeCloseTo(10, 0);
});
```

- [ ] **Step 2: Run and see it fail.** Run `npx vitest --run --project server src/lib/map/height/raster.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Rasterizing is a scanline over cell-centre rows. `NearestField` is two-pass vector propagation (8 neighbours, distance measured to the seed point, accepted only within that seed's reach). `insideDistance` is a two-pass chamfer (3-4 weights × cell/3).
- [ ] **Step 4: Run and see it pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/lib/map/height/raster.ts src/lib/map/height/raster.spec.ts` then `git commit -m "feat(sim): raster primitives for height regions"`

---

### Task 4: Vectorizer

**Files:**
- Create: `src/lib/map/height/vectorize.ts`
- Test: `src/lib/map/height/vectorize.spec.ts`

**Interfaces:**
- Consumes: label rasters (`Uint32Array`, `cols × rows`, `EMPTY`/`BLOCK` meaning "no piece") from Task 3.
- Produces:
  ```ts
  export interface Chains { starts: Uint32Array; xy: Float64Array /* grid-vertex units */; left: Uint32Array; right: Uint32Array; closed: Uint8Array }
  export function traceChains(labels: Uint32Array, cols: number, rows: number): Chains; // BLOCK read as EMPTY; outside the raster is EMPTY
  export function simplifyChains(c: Chains, tolCells: number): Chains; // Douglas–Peucker; open chains keep endpoints; closed loops keep vertex 0 and the vertex farthest from it
  export function smoothChains(c: Chains, iterations: number): Chains; // Chaikin; endpoints fixed
  export function assembleFaces(c: Chains): Map<number, { outer: Float64Array; holes: Float64Array[] }[]>; // per label ≠ EMPTY
  ```
  Algorithm (the part signatures don't fix): boundary edges lie between 4-adjacent cells with different labels. A grid vertex is a **junction** when its four cells hold ≥ 3 distinct labels, or 2 labels in a checkerboard. A chain is a maximal run of boundary edges through non-junction vertices, with `left`/`right` the labels on each side in walking order. Faces walk each label's chains with the label on the left, link them by shared endpoints into rings, and classify rings by signed area (> 0 outer, < 0 hole). Each hole goes to the outer that contains its first vertex.

- [ ] **Step 1: Write the failing tests**

```ts
it('a 2×2 block of label 1 in an empty 4×4 grid: one closed chain, left 1, right EMPTY', () => {
  const c = traceChains(grid4x4with2x2, 4, 4);
  expect(c.starts.length - 1).toBe(1);
  expect([c.left[0], c.right[0], c.closed[0]]).toEqual([1, EMPTY, 1]);
});
it('three labels meeting make junctions; each chain has one label pair', () => {
  const c = traceChains(tJunction, 6, 4);
  expect(pairsOf(c)).toEqual(new Set(['1|2', '1|0', '2|0', '3|0', '1|3', '2|3']));
});
it('faces share simplified chains: two adjacent pieces tile their cells with no gap or overlap', () => {
  const faces = assembleFaces(simplifyChains(traceChains(two, 40, 20), 0.6));
  expect(areaOf(faces.get(1)!) + areaOf(faces.get(2)!)).toBeCloseTo(cellsNonEmpty(two), 0);
});
it('a hole (an exception lot) is its own face and a hole in its surroundings', () => {
  const f = assembleFaces(traceChains(withHole, 10, 10));
  expect(f.get(1)![0].holes).toHaveLength(1);
  expect(f.get(2)![0].holes).toHaveLength(0);
});
it('simplify keeps a straight staircase within tolerance and keeps endpoints', () => {
  expect(maxDeviation(simplified, original)).toBeLessThanOrEqual(0.6 + 1e-9);
});
it('smooth keeps endpoints and adds vertices', () => {
  expect(endpoints(smoothChains(c, 2))).toEqual(endpoints(c));
});
```

- [ ] **Step 2: Run and see it fail.** Run `npx vitest --run --project server src/lib/map/height/vectorize.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** to the algorithm above.
- [ ] **Step 4: Run and see it pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/lib/map/height/vectorize.ts src/lib/map/height/vectorize.spec.ts` then `git commit -m "feat(sim): topology-preserving raster vectorizer"`

---

### Task 5: Label placement

**Files:**
- Create: `src/lib/map/height/labels.ts`
- Test: `src/lib/map/height/labels.spec.ts`

**Interfaces:**
- Consumes: `NO_ZOOM`, `LabelSet` (Task 2); `LAT0` (`src/lib/plan/geometry.ts:11`).
- Produces:
  ```ts
  export const LABEL_CHAR_PX = 7, LABEL_PAD_PX = 4, LABEL_H_PX = 16;
  export const LID_ZOOMS = [15, 16, 17, 18, 19] as const, CONTOUR_ZOOMS = [11, 12, 13, 14, 15] as const;
  export function metersPerPixel(zoom: number): number; // 78271.517 · cos(LAT0) / 2^zoom (512 px tiles)
  export interface LabelCandidate { lng: number; lat: number; zM: number; text: string; priority: number; roomM: number }
  export function placeLabels(c: readonly LabelCandidate[], zooms: readonly number[]): Uint8Array; // minZoom, NO_ZOOM = never
  export function toLabelSet(c: readonly LabelCandidate[], minZoom: Uint8Array): LabelSet; // drops NO_ZOOM entries
  ```
  At each zoom, candidates go in descending priority. A box is placed when it overlaps no box placed at that zoom and `roomM ≥ LABEL_H_PX/2 · metersPerPixel(z)`. `minZoom` is the smallest zoom where it is placed. The page shows `minZoom ≤ floor(zoom)` and clamps zoom to the last listed one.

- [ ] **Step 1: Write the failing tests**

```ts
it('metersPerPixel at z15 is ≈ 1.89 m', () => expect(metersPerPixel(15)).toBeCloseTo(1.894, 2));
it('two labels 50 m apart: the higher priority shows from z15, the other only once they no longer overlap', () => {
  const z = placeLabels([cand({ priority: 2 }), cand({ lng: +50 m, priority: 1 })], LID_ZOOMS);
  expect(z[0]).toBe(15);
  expect(z[1]).toBeGreaterThan(15);
});
it('a single 25 ft lot is labelled only at a zoom where its inscribed radius holds the box', () => {
  // half box height 8 px: 8 · mpp(16) ≈ 7.6 m > 3.8; 8 · mpp(17) ≈ 3.79 m ≤ 3.8
  expect(placeLabels([cand({ roomM: 3.8 })], LID_ZOOMS)[0]).toBe(17);
  expect(placeLabels([cand({ roomM: 0.5 })], LID_ZOOMS)[0]).toBe(NO_ZOOM); // 8 · mpp(19) ≈ 0.95 m
});
it('toLabelSet keeps placed labels with lng, lat, z', () => {
  expect(toLabelSet(c, Uint8Array.of(15, NO_ZOOM)).text).toEqual([c[0].text]);
});
```

- [ ] **Step 2: Run and see it fail.** Run `npx vitest --run --project server src/lib/map/height/labels.spec.ts`.
- [ ] **Step 3: Implement.** Use a uniform grid hash of placed boxes per zoom.
- [ ] **Step 4: Run and see it pass.**
- [ ] **Step 5: Commit.** `git add src/lib/map/height/labels.ts src/lib/map/height/labels.spec.ts` then `git commit -m "feat(sim): precomputed label collision for height labels"`

---

### Task 6: City build (contours, components, room)

**Files:**
- Create: `src/lib/map/height/city.ts`
- Test: `src/lib/map/height/city.spec.ts`

**Interfaces:**
- Consumes: Tasks 1 to 5 (`LimitSources`, `SRC_*`; `storiesToM`, `glazeStep`, `contourLabelText`; `frameFor`, `NearestField`; `traceChains`, `simplifyChains`, `smoothChains`; `placeLabels`, `CONTOUR_ZOOMS`). `CITY_BOUNDS` is defined here with the values of `FOG_BOUNDS` (= `CONSTRAINTS.maxBounds`, `src/lib/map/fog/grid.ts:28-31`), which goes in Task 14.
- Produces:
  ```ts
  export const CITY_CELL_M = 15, CITY_SIMPLIFY_M = 7.5, CONTOUR_LABEL_MIN_M = 300;
  export interface CityInput { rev: number; labelPoint: Float64Array; lotAreaM2: Uint32Array; existingStories: Uint8Array;
    stories: Uint8Array; countable: Uint8Array; sources: LimitSources }
  export interface CityModel { lotComponent: Uint32Array; componentStories: Uint8Array; componentRoom: Uint32Array; componentGlaze: Uint8Array }
  export interface StagedBuild<T> { step(budgetMs: number, now: () => number): boolean; result(): T } // true = done
  export function createCityBuild(input: CityInput): StagedBuild<{ city: HeightCity; model: CityModel }>;
  ```
  Stages, each resumable by row bands: nearest forward, nearest backward, components (union-find over 4-connected equal stories > 0; then lot components with singletons for mismatches), per-component sums (room = Σ countable·max(0, s − e); area-weighted unused for `glazeStep`), pieces (component, source of the cell's nearest lot), chains (trace, simplify `CITY_SIMPLIFY_M/CITY_CELL_M`, smooth ×2), chain attributes (`hi`/`lo` stories, `kind` = `CHAIN_LIMIT` when the components differ or one side is empty, else `CHAIN_SOURCE`, and `srcA`/`srcB`), contour labels.

- [ ] **Step 1: Write the failing tests** (synthetic lots from a helper `grid(lots)` giving label points and areas; run `build.step(Infinity, now)` until done)

```ts
it('two 4-story blocks across a 20 m street are one component; room sums countable lots only', () => {
  const { model } = run(twoBlocksAcrossStreet(4, existing = 2, protectedEvery = 3));
  expect(model.lotComponent[a0]).toBe(model.lotComponent[b0]);
  expect(model.componentRoom[model.lotComponent[a0]]).toBe(2 * countableCount);
});
it('a 4 | 8 step gives a CHAIN_LIMIT chain with hi 8 and lo 4', () => {
  expect(chainsWith(city, { kind: CHAIN_LIMIT, hi: 8, lo: 4 }).length).toBeGreaterThan(0);
});
it('a single 6-story lot among 4s is its own component', () => {
  expect(model.lotComponent[exception]).not.toBe(model.lotComponent[neighbour]);
  expect(model.componentStories[model.lotComponent[exception]]).toBe(6);
});
it('the shore is a contour with lo 0; open water gets no cells', () => {
  expect(chainsWith(city, { kind: CHAIN_LIMIT, lo: 0, hi: 4 }).length).toBeGreaterThan(0);
});
it('a painted lot at its neighbours’ height is a CHAIN_SOURCE boundary with SRC_PAINT on one side', () => {
  expect(chainsWith(city, { kind: CHAIN_SOURCE }).some((k) => city.chains.srcA[k] === SRC_PAINT || city.chains.srcB[k] === SRC_PAINT)).toBe(true);
});
it('sourceIds are the LimitSources ruleIds; a rule-decided area is bounded by chains with its code', () => {
  expect(city.sourceIds).toEqual(['r1']);
  expect(chainsTouchingSource(city, SRC_RULE0)).toBeGreaterThan(0);
});
it('a long 4 | 40 chain is labelled "40+" from z15 or lower; short chains are not labelled', () => {
  expect(city.labels.text).toContain('40+');
  expect(Math.min(...city.labels.minZoom)).toBeLessThanOrEqual(15);
});
it('step(budget) returns false until done and finishes', () => {
  const b = createCityBuild(input); let n = 0;
  while (!b.step(0, () => 0)) n++;
  expect(n).toBeGreaterThan(3);
});
```

- [ ] **Step 2: Run and see it fail.** Run `npx vitest --run --project server src/lib/map/height/city.spec.ts`.
- [ ] **Step 3: Implement `createCityBuild`.** Positions convert grid vertices to lng/lat with `vertexToLngLat`. Lot reach is `clamp(0.5·√area + 20, 30, 200)`.
- [ ] **Step 4: Run and see it pass.**
- [ ] **Step 5: Commit.** `git add src/lib/map/height/city.ts src/lib/map/height/city.spec.ts` then `git commit -m "feat(sim): city-wide height regions and contours"`

---

### Task 7: Lid build, fixtures and build budgets

**Files:**
- Create: `src/lib/map/height/lids.ts`, `src/lib/map/height/test/fixtures.ts`, `src/lib/map/height/height.bench.spec.ts`
- Test: `src/lib/map/height/lids.spec.ts`

**Interfaces:**
- Consumes: `CityModel`, `StagedBuild` (Task 6); raster, vectorizer and labels (Tasks 3 to 5); `storiesToM`, `lidLabelText` (Task 2).
- Produces:
  ```ts
  export const LID_CELL_M = 2, LID_CLOSE_M = 30, LID_PAD_M = 60, LID_MAX_SPAN_M = 3000, LID_SIMPLIFY_M = 1.2;
  export class LidTooLarge extends Error {}
  export interface LidLot { row: number; rings: [number, number][][] } // lng/lat (toLngLat of the chunk record's polygon)
  export interface LidInput { limitsRev: number; bbox: BBox; lots: readonly LidLot[]; stories: Uint8Array; sources: Uint16Array; model: CityModel }
  export function createLidBuild(input: LidInput): StagedBuild<HeightLids>; // throws LidTooLarge if either span > LID_MAX_SPAN_M + 2·LID_PAD_M
  // test/fixtures.ts
  export function tinyLimits(): { city: HeightCity; lids: HeightLids }; // ≈ 12 lots: two 4-story blocks across a 20 m street, one 25 ft 6-story exception, one 8-story block wall-adjacent, one painted lot
  ```
  Pieces are (component, source). A lot with stories 0 rasterizes as `BLOCK`. `bridge(a, b)` returns the piece of (component, source) when the components match: source `a` if both sources agree, else `SRC_FZP`. Rims: for each chain side with a piece, a path at `storiesToM` of that piece, `kind` `CHAIN_LIMIT` when the other side is another component or empty, else `CHAIN_SOURCE`. Walls: chain segments whose two pieces both have stories > 0 and differ, from the lower height to the higher, owned by the higher. One label per component, at the cell of maximum `insideDistance` over the component's cells, at `zM` = its height. The priority is the component's cell count and the text is `lidLabelText(stories, model.componentRoom[c])`. Glaze per piece = `model.componentGlaze[component]`.

- [ ] **Step 1: Write the failing tests**

```ts
it('a 25 ft exception is its own piece: a face, rims at its height, walls to its 4-story neighbours', () => {
  const l = run(exceptionInBlock(4, 6));
  const p = pieceOf(l, { stories: 6 });
  expect(l.faces.filter((f) => f.piece === p)).toHaveLength(1);
  expect(rimHeights(l, p)).toEqual(new Set([storiesToM(6)]));
  expect(wallsOwnedBy(l, p).length).toBeGreaterThan(0);
  expect(wallSpan(l, p)).toEqual([storiesToM(4), storiesToM(6)]);
});
it('a lid spans a 20 m street between two blocks of one component; not a 40 m one', () => {
  expect(facesContaining(run(twoBlocks(20)), streetCentre)).toBe(1);
  expect(facesContaining(run(twoBlocks(40)), streetCentre)).toBe(0);
});
it('no wall to the water or to a limit-0 lot: only the rim', () => {
  const l = run(blockByWaterAndPark(4));
  expect(l.walls.count).toBe(0);
  expect(rimCount(l, { kind: CHAIN_LIMIT })).toBeGreaterThan(0);
});
it('4 and 8 blocks across a street: no wall (not adjacent), rims at both heights', () => {
  const l = run(stepAcrossStreet(4, 8));
  expect(l.walls.count).toBe(0);
});
it('a painted lot at its neighbours’ height is a separate piece with a CHAIN_SOURCE rim', () => {
  const l = run(paintedSameHeight(4));
  expect(l.pieces.source).toContain(SRC_PAINT);
  expect(rimCount(l, { kind: CHAIN_SOURCE, ownerSource: SRC_PAINT })).toBeGreaterThan(0);
});
it('faces tile the lid cells: Σ face area ≈ lid cells × 4 m² (±1%)', () => {
  expect(Math.abs(faceAreaM2(l) - lidCells(l) * 4) / (lidCells(l) * 4)).toBeLessThan(0.01);
});
it('one label per component, with the component’s room', () => {
  expect(l.labels.text.filter((t) => t.startsWith('4 stories'))).toHaveLength(1);
  expect(l.labels.text).toContain(lidLabelText(4, model.componentRoom[compA]));
});
it('a bbox over 3 km + pads throws LidTooLarge; limitsRev is echoed', () => {
  expect(() => createLidBuild({ ...input, bbox: span(3500) })).toThrow(LidTooLarge);
  expect(run(input).limitsRev).toBe(input.limitsRev);
});
```

`height.bench.spec.ts` (server project, like `src/lib/sim/scenario/scenario.bench.spec.ts`):

```ts
it('city build on 150,000 synthetic lots: every step(30) returns within 45 ms; total ≤ 600 ms', ...);
it('lid build over a 3 km × 3 km view of ≈ 25,000 synthetic 25 ft lots: every step(30) ≤ 45 ms; total ≤ 400 ms', ...);
```

- [ ] **Step 2: Run and see it fail.** Run `npx vitest --run --project server src/lib/map/height/lids.spec.ts src/lib/map/height/height.bench.spec.ts`.
- [ ] **Step 3: Implement `createLidBuild` and `tinyLimits`.** If a bench step overruns, band that stage further. Do not raise the budgets.
- [ ] **Step 4: Run and see it pass.** Log the totals (`console.log('[perf] …')`, as the scenario bench does).
- [ ] **Step 5: Commit.** `git add src/lib/map/height/lids.ts src/lib/map/height/lids.spec.ts src/lib/map/height/test/fixtures.ts src/lib/map/height/height.bench.spec.ts` then `git commit -m "feat(sim): glass lid geometry from loaded lots"`

---

### Task 8: Worker protocol and host integration (the fog leaves the worker)

**Files:**
- Modify: `src/lib/sim/scenario/types.ts:8,85-95,141-178` (requests, responses, `LeversResponse` without `fog`)
- Modify: `src/lib/sim/scenario/scenario-host.ts:60,240-256,259-266,314-315,677-814,1312-1345`
- Modify: `src/lib/sim/router.ts:77-98`, `src/lib/sim/scenario-client.ts:45,216-224,365-371,403-407`
- Modify: `src/lib/fzp/FzpMode.svelte:24-31,63,123-127,337-364,639-642,784-785`
- Modify: `src/lib/sim-page/SimPage.svelte:38,437-452,693-698,831` (keep the latest `city`; the fog effect and import go; nothing is drawn until Task 12)
- Test: `src/lib/sim/scenario/scenario-host.heights.spec.ts` (create; move the fog cases out of `scenario-host.levers.spec.ts:300-340`), `src/lib/sim/router.spec.ts`, `src/lib/sim/scenario-client.spec.ts`, `src/lib/fzp/FzpMode.svelte.spec.ts`, `src/lib/sim/scenario/types.spec.ts`, `src/lib/sim-page/SimPage.svelte.spec.ts` (drop the fog cases, `:855-982`)

**Interfaces:**
- Consumes: `limitSources` (Task 1); `countableMask` (Task 2); `createCityBuild`, `CityModel` (Task 6); `createLidBuild`, `LidTooLarge`, `LidLot` (Task 7).
- Produces:
  ```ts
  // types.ts
  | { type: 'heightLids'; reqId: number; bbox: [number, number, number, number] }            // ScenarioRequest
  | { type: 'heights'; rev: Rev; city: HeightCity }                                          // ScenarioResponse
  | { type: 'heightLids'; reqId: number; result: HeightLidsResult }                          // ScenarioResponse
  export type HeightLidsResult =
    | { ok: true; lids: HeightLids; missing: number } // missing: cells intersecting bbox not loaded
    | { ok: false; reason: 'no-session' | 'superseded' | 'too-large'; message: string };
  // scenario-client.ts
  heightLids(bbox: [number, number, number, number]): Promise<HeightLidsResult>; // no-session on crash, restart, dispose
  onHeights?(m: Extract<ScenarioResponse, { type: 'heights' }>): void;              // client event
  // FzpMode.svelte
  SimClientApi.heightLids(bbox: [number, number, number, number]): Promise<HeightLidsResult>;
  onheights?: (c: HeightCity) => void; // replaces onfog; forwarded when leverState.sentRev !== null && m.rev >= sentRev
  ```
  Host state on `LeverWork`: `limits: { rev; stories; sources; model } | null` (the latest complete city), `city: { rev; build; stories; sources } | null`, `lidWant: { reqId; bbox } | null`, `lid: { reqId; limitsRev; build } | null`. Scheduler order (job kinds gain `'heights'`):
  1. The pending revision's resolve step.
  2. Its city build steps (`'heights'`; then post `heights` with `city.chains`/`labels` buffers transferred and set `limits`).
  3. A wanted lid build, once `limits.rev` is the newest resolved rev (`'heights'`).
  4. The recompute steps.
  5. Everything else.

  With no revision pending, a lid build runs ahead of other jobs. A new `heightLids` answers any queued or running older one `superseded`. A new city drops and restarts a running lid build on the new limits. A session end answers waiting lid requests `no-session`. The lid lots are the chunk records of `cellsIntersecting(manifest, bbox ± LID_PAD_M)` whose label point lies in the padded bbox, with rows from `base.parcels.index`.

- [ ] **Step 1: Write the failing tests** (`scenario-host.heights.spec.ts`, using `test/host-harness.ts` like the levers spec)

```ts
it('a lever revision posts one heights at its rev, before its current', async () => {
  expect(h.posted('heights').map((m) => m.rev)).toEqual([initRev]);
  expect(h.indexOf('heights', initRev)).toBeLessThan(h.indexOf('levers/current', initRev));
  expect(h.lastTransfer('heights')).toContain(h.last('heights').city.chains.positions.buffer);
});
it('a painted lot at a new height shows in the next heights; a protected painted lot keeps FZP', async () => { … });
it('levers responses no longer carry fog', () => expect('fog' in h.lastCurrent()).toBe(false));
it('heightLids before any heights waits, then answers from the first limits', async () => {
  expect((await answer).ok && answer.lids.limitsRev).toBe(initRev);
});
it('a newer heightLids answers the older superseded', async () => {
  expect(first.ok).toBe(false); expect(!first.ok && first.reason).toBe('superseded');
});
it('a setLevers during a lid build restarts it on the new limits', async () => {
  expect(r.ok && r.lids.limitsRev).toBe(nextRev); // Review Focus 1
});
it('missing counts the bbox cells not loaded; lots of loaded cells form faces', async () => { … });
it('a 4 km bbox answers too-large', async () => expect(!r.ok && r.reason).toBe('too-large'));
it('no lever session (/fzp) answers no-session; a new init answers waiting requests no-session', async () => { … }); // Review Focus 4
it('no macrotask over SLICE_MS while a revision resolves, builds its city and a lid view', async () => {
  expect(h.longestTask()).toBeLessThanOrEqual(50);
});
```

Add a `heightLids` row to `router.spec.ts` (editor mode answers `no-session`) and to `scenario-client.spec.ts` (resolves on its answer; `no-session` on crash and dispose). In `FzpMode.svelte.spec.ts`, replace the `onfog` cases with: "`onheights` gets a kept rev's city once; a stale rev's not at all", and "`SimClientApi.heightLids` forwards to the client".

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest --run --project server src/lib/sim` and then `npx vitest --run --project client src/lib/fzp/FzpMode.svelte.spec.ts`.
- [ ] **Step 3: Implement.** Remove `buildFogGrid` and `FogGrid` from the host, types, FzpMode and SimPage. SimPage keeps `let city = $state.raw<HeightCity | null>(null)`, set by `onheights`, and writes nothing to the overlay yet. `src/lib/map/fog/` stays until Task 14 (only `debug.ts` uses it).
- [ ] **Step 4: Run and see it pass.** Run `npm run check` (exhaustive `never` switches), then `npx vitest --run --project server src/lib/sim` and `npx vitest --run --project client src/lib/fzp src/lib/sim-page`.
- [ ] **Step 5: Commit.** Add the files above, then `git commit -m "feat(sim): worker posts height regions and answers lid requests; fog leaves the worker"`

---

### Task 9: Palette tokens

**Files:**
- Modify: `src/lib/map/palette.ts:24,68,110` (and the token CSS emitter)
- Test: `src/lib/map/palette.spec.ts:70-72,233,253` (the pinned `DEFAULT_TOKENS_CSS` body)

**Interfaces:**
- Produces: `TokenName` gains `'limit-ink' | 'limit-glaze' | 'limit-wall' | 'limit-halo'`. `'height-fog'` stays until Task 14 deletes the fog layer that reads it (`src/lib/map/fog/fog-layer.ts:203`). Starting values (tune by eye in Task 12, keeping the tests green):
  - light: ink `#2B2A28`, glaze `rgba(96,98,102,0.14)`, wall `rgba(96,98,102,0.20)`, halo `#F3EFE6`.
  - dark: ink `#E8E4DC`, glaze `rgba(214,216,220,0.12)`, wall `rgba(214,216,220,0.18)`, halo `#1C1D1F`.

- [ ] **Step 1: Write the failing tests**

```ts
it(`${theme}: limit-ink is ≥ 4.5:1 against land and against limit-halo`, () => { … toBeGreaterThanOrEqual(4.5) });
it(`${theme}: limit-ink is ≥ 3:1 over every transit-access step composited at TRANSIT_ACCESS_OPACITY`, () => { … });
it(`${theme}: glaze and wall are neutral (channel spread ≤ 12) and translucent (alpha ≤ 0.25)`, () => { … });
```

Add the four `--map-limit-*` entries to the pinned CSS strings.

- [ ] **Step 2: Run and see it fail.** Run `npx vitest --run --project server src/lib/map/palette.spec.ts`.
- [ ] **Step 3: Implement the tokens.**
- [ ] **Step 4: Run and see it pass.** Also run `npm run check`.
- [ ] **Step 5: Commit.** `git add src/lib/map/palette.ts src/lib/map/palette.spec.ts` then `git commit -m "feat(map): ink and neutral height-limit tokens"`

---

### Task 10: Deck layers (walls, style, the composite) with GPU tests

**Files:**
- Create: `src/lib/map/dash.ts` (move `dashRing` from `src/lib/sim-page/painted-outline.ts:23-56`, generalized), `src/lib/map/height/wall-layer.ts`, `src/lib/map/height/limits-style.ts`, `src/lib/map/height/limits-layer.ts`
- Modify: `src/lib/sim-page/painted-outline.ts` (import `dashPath`)
- Test: `src/lib/map/dash.spec.ts` (move the `dashRing` cases from `painted-outline.spec.ts`), `src/lib/map/height/limits-style.spec.ts`, `src/lib/map/height/limits-layer.gpu.svelte.spec.ts`

**Interfaces:**
- Consumes: `HeightCity`, `HeightLids`, `CHAIN_*`, `SRC_*`, `NO_ZOOM` (Task 2); tokens (Task 9); `tinyLimits()` (Task 7); the fog layer's instanced-quad pattern (`src/lib/map/fog/fog-layer.ts:52-193`).
- Produces:
  ```ts
  // dash.ts
  export function dashPath(path: readonly number[][], dashM: number, gapM: number, closed: boolean): number[][][]; // 2D or 3D points
  // limits-style.ts (pure)
  export type LimitsMode = { kind: 'plain' } | { kind: 'paint' } | { kind: 'rule'; source: number }; // source -1 = rule decides nothing
  export const DIM_ALPHA = 0.3, LIDS_FADE = [14.5, 15.5] as const, GLAZE_ALPHA = [0.3, 0.55, 0.8, 1] as const;
  export interface Look { show: boolean; dashed: boolean; tone: 'ink' | 'paint'; alpha: number }
  export function rimLook(kind: number, owner: number, mode: LimitsMode): Look;
  export function chainLook(kind: number, srcA: number, srcB: number, mode: LimitsMode): Look;
  export function chainWidthPx(hi: number, lo: number): 1 | 1.5 | 2;
  export function glazeAlpha(owner: number, step: number, mode: LimitsMode): number; // × the token alpha
  export function wallAlpha(owner: number, mode: LimitsMode): number;
  export function lidsOpacity(zoom: number): number; // smoothstep over LIDS_FADE; contours get 1 − it
  // wall-layer.ts
  export class LidWallLayer extends Layer<{ data: LidWalls; color: RGBA; alpha: Float32Array }>; // depth test less-equal, no depth write, no culling
  // limits-layer.ts
  export const LIMITS_LAYER_ID = 'sim-height-limits';
  export interface HeightLimitsProps { city: HeightCity | null; lids: HeightLids | null; mode: LimitsMode; theme: Theme }
  export class HeightLimitsLayer extends CompositeLayer<HeightLimitsProps>;
  export function heightLimitsLayer(p: HeightLimitsProps): HeightLimitsLayer;
  ```
  Look rules:
  - `plain`: `CHAIN_LIMIT` rims and chains are solid ink at alpha 1, and `CHAIN_SOURCE` is hidden.
  - `paint`: anything owned by `SRC_PAINT` (rims) or touching it (chains, either side) is dashed in the paint tone, including `CHAIN_SOURCE`. Other `CHAIN_SOURCE` stays hidden.
  - `rule s`: a rim owned by `s` is solid ink at 1, `CHAIN_SOURCE` included. A chain with exactly one side `s` is solid ink at 1 and 2 px (the outline of the rule's lot set). Everything else is `DIM_ALPHA`. Glaze is 0 except on `s`. Walls owned by `s` are at 1, others at `DIM_ALPHA`.

  Sublayers: `-glaze` (`SolidPolygonLayer`, 3D rings at the piece height, `depthWriteEnabled: false`), `-walls`, `-rims` and `-rims-dashed` (`PathLayer`, 3D, px widths 1.5), `-contours` and `-contours-dashed` (`PathLayer` on the ground), `-lid-labels` and `-contour-labels` (`TextLayer`, ink with a `limit-halo` outline, `fontSettings.sdf`, `characterSet` covering digits, `+`, `,`, `·`, space and the letters of "stories story floors floor", depth `always`). Lid sublayers take opacity `lidsOpacity(zoom)` and contour sublayers `1 − it`. A sublayer with opacity 0 is not rendered. `shouldUpdateState` returns true on a viewport change only when `floor(zoom)` changes or the zoom is inside `LIDS_FADE`. Filtered and dashed data is memoized per `(lids|city, mode)` and labels per zoom bucket.

- [ ] **Step 1: Write the failing tests**

```ts
// limits-style.spec.ts
it('plain: source rims hidden, limit rims solid ink', () => {
  expect(rimLook(CHAIN_SOURCE, SRC_FZP, PLAIN).show).toBe(false);
  expect(rimLook(CHAIN_LIMIT, SRC_PAINT, PLAIN)).toEqual({ show: true, dashed: false, tone: 'ink', alpha: 1 });
});
it('paint: paint-owned rims and paint boundaries are dashed paint; others unchanged', () => {
  expect(rimLook(CHAIN_SOURCE, SRC_PAINT, PAINT)).toEqual({ show: true, dashed: true, tone: 'paint', alpha: 1 });
  expect(rimLook(CHAIN_LIMIT, SRC_FZP, PAINT).dashed).toBe(false);
  expect(chainLook(CHAIN_SOURCE, SRC_PAINT, SRC_FZP, PAINT).dashed).toBe(true);
});
it('rule s: its rims and its lot-set outline full, others dimmed; glaze only on s', () => {
  const m = { kind: 'rule', source: SRC_RULE0 } as const;
  expect(rimLook(CHAIN_SOURCE, SRC_RULE0, m).alpha).toBe(1);
  expect(rimLook(CHAIN_LIMIT, SRC_FZP, m).alpha).toBe(DIM_ALPHA);
  expect(glazeAlpha(SRC_FZP, 3, m)).toBe(0);
  expect(chainLook(CHAIN_SOURCE, SRC_RULE0, SRC_FZP, m)).toMatchObject({ show: true, alpha: 1 });
});
it('a rule that decides nothing dims everything', () => { // Review Focus 2
  expect(rimLook(CHAIN_LIMIT, SRC_FZP, { kind: 'rule', source: -1 }).alpha).toBe(DIM_ALPHA);
});
it('crossfade', () => {
  expect([14, 14.5, 15, 15.5, 17].map(lidsOpacity)).toEqual([0, 0, 0.5, 1, 1]);
});
// dash.spec.ts: the moved dashRing cases, plus "a 3D open path keeps z on every dash vertex".
```

`limits-layer.gpu.svelte.spec.ts`: a standalone `Deck` (as `src/lib/map/fog/fog-layer.gpu.svelte.spec.ts:1-120`: a 128×64 canvas, magenta clear, unlit `SolidPolygonLayer` boxes, `altitude: 6`) with `tinyLimits()`:

```ts
it('top-down z17: open ground under a lid is the glaze over the ground', () => expectPx(streetPx, over(glazeRgb, glazeA)));
it('a roof above the lid is untinted; a roof below it is tinted', () => {
  expectPx(tallRoofPx, BOX_RGB, TOL); expectPx(lowRoofPx, mix(BOX_RGB, glazeRgb, glazeA), TOL_BLEND);
});
it('the lid edge draws ink', () => expectPx(edgePx, inkRgb, TOL_BLEND));
it('z13: contours draw, glaze does not', () => { expectPx(contourPx, inkRgb, TOL_BLEND); expectPx(streetPx, BG, TOL); });
it('pitched 60°: the wall between 4 and 6 stories shows the wall colour; a box in front hides it', () => { … });
it('rule mode: a dimmed rim is lighter than a highlighted one', () => { … });
```

- [ ] **Step 2: Run and see it fail.** Run `npx vitest --run --project server src/lib/map/height/limits-style.spec.ts src/lib/map/dash.spec.ts`, then `npx vitest --run --project client src/lib/map/height/limits-layer.gpu.svelte.spec.ts`.
- [ ] **Step 3: Implement.** `LidWallLayer` per instance: `instanceA` (fp64 lng/lat), `instanceDelta` (b − a, degrees), `instanceZ` (lo, hi) and `instanceAlpha`. The unit quad is a triangle strip, with the same low-part offset handling as `fog-layer.ts:73-90`.
- [ ] **Step 4: Run and see it pass.** Run the same commands.
- [ ] **Step 5: Commit.** `git add src/lib/map/dash.ts src/lib/map/dash.spec.ts src/lib/sim-page/painted-outline.ts src/lib/sim-page/painted-outline.spec.ts src/lib/map/height/wall-layer.ts src/lib/map/height/limits-style.ts src/lib/map/height/limits-style.spec.ts src/lib/map/height/limits-layer.ts src/lib/map/height/limits-layer.gpu.svelte.spec.ts` then `git commit -m "feat(map): HeightLimitsLayer: glass lids, walls, contours and labels"`

---

### Task 11: Pitched depth against a MapLibre fill-extrusion

**Files:**
- Create: `src/lib/map/height/limits-maplibre.gpu.svelte.spec.ts`
- Modify (only if the test fails): `src/lib/map/height/limits-layer.ts`, `wall-layer.ts` (layer `parameters`)

**Interfaces:**
- Consumes: `heightLimitsLayer`, `tinyLimits()`; `MapLibreOverlay` from `@deck.gl/maplibre` with `interleaved: true`, as `src/lib/map/SimMap.svelte:591-596` does.

- [ ] **Step 1: Write the test.** Use a 256×160 `maplibregl.Map` with `preserveDrawingBuffer: true` and an inline style: a background, plus a GeoJSON `fill-extrusion` holding a 40 m box in front of a lid and a 10 m box under it (both in the `existing` colour). Set pitch 60 and bearing 0, and centre the camera so that the tall box stands between the camera and part of the lid. Render each scene twice, once with the overlay's `layers: [heightLimitsLayer(...)]` and once with `[]`, and read pixels from `map.getCanvas()` after `idle`.

```ts
it('a lid behind a taller MapLibre building is hidden by it', () => expectSame(withLids, without, tallBoxFacePx, 3));
it('the roof of a MapLibre building under the lid is tinted', () => expectDiffer(withLids, without, lowRoofPx, 6));
it('the lid rim does not draw over the tall building', () => expectSame(withLids, without, rimBehindTallPx, 3));
it('open ground under the lid is tinted (the lid reads as up there, not a ground fill at pitch)', () =>
  expectDiffer(withLids, without, groundPx, 4));
```

- [ ] **Step 2: Run it.** Run `npx vitest --run --project client src/lib/map/height/limits-maplibre.gpu.svelte.spec.ts`. If it fails, find out why (superpowers:systematic-debugging). The likely knobs are the sublayers' `depthCompare` and `depthWriteEnabled`, or the overlay's `beforeId`. Fix it in the layer, never in the test.
- [ ] **Step 3: Run until it passes,** then run the Task 10 GPU spec again.
- [ ] **Step 4: Commit.** `git add src/lib/map/height/` then `git commit -m "test(map): pitched depth of height lids against MapLibre extrusions"`

---

### Task 12: Page wiring: lid requests, the limits slot, the View row

**Files:**
- Create: `src/lib/sim-page/lid-request.ts`, `src/lib/sim-page/lid-request.spec.ts`
- Modify: `src/lib/sim-page/overlay-mux.ts:12-18` (slot `fog` → `limits`), `overlay-mux.spec.ts`
- Modify: `src/lib/view/prefs.ts` (`heightFog` → `heightLimits`), `prefs.spec.ts`; `src/lib/view/ViewMenu.svelte:3,8-9,30,121-131`, `ViewMenu.svelte.spec.ts`
- Modify: `src/lib/sim-page/SimPage.svelte:425-452,693-698,831` and `SimPage.svelte.spec.ts`; `src/routes/page.view.svelte.spec.ts`, `src/routes/p/[id]/page.view.svelte.spec.ts`, `src/lib/map/SimMap.transit.svelte.spec.ts`, `src/lib/fzp/FzpMode.svelte.spec.ts:262` (field rename)
- Modify: `e2e/sim.spec.ts:675-770`

**Interfaces:**
- Consumes: `SimClientApi.heightLids`, `onheights` (Task 8); `heightLimitsLayer`, `LIMITS_LAYER_ID`, `LimitsMode`, `LIDS_FADE` (Task 10); `LID_MAX_SPAN_M` (Task 7).
- Produces:
  ```ts
  // lid-request.ts
  export interface LidRequestDeps { request(bbox: [number, number, number, number]): Promise<HeightLidsResult>; show(l: HeightLids | null): void }
  export function clampBbox(bbox: [number, number, number, number], maxSpanM: number): [number, number, number, number];
  export class LidRequest {
    want(bbox: [number, number, number, number] | null): void; // null clears (zoomed out, run, toggle off)
    limitsChanged(rev: number): void;  // a new city: ask again for the current bbox
    chunksChanged(): void;             // ask again if the last answer had missing > 0
    sessionChanged(): void;            // a new client: ask again if the last failed no-session
  }
  // prefs.ts
  export interface ViewPrefs { transitStops: boolean; transitAccess: boolean; heightLimits: boolean } // reads a legacy heightFog
  // ViewMenu.svelte
  export type ViewRow = 'transitStops' | 'transitAccess' | 'heightLimits';
  ```
  `LidRequest` keeps at most one request in flight. A want or trigger that arrives meanwhile marks it dirty, and only the latest bbox is sent after the answer. Answers to older tokens are dropped. A `superseded` answer is ignored, and `no-session` shows null and waits for `sessionChanged`. SimPage:
  - On the map's `moveend` (attached in `onMapReady`), it wants `clampBbox(bounds, LID_MAX_SPAN_M)` when `zoom ≥ LIDS_FADE[0]` and Setup and `viewPrefs.heightLimits`, else null.
  - `onheights` sets `city` and calls `limitsChanged`, `onchunks` calls `chunksChanged`, and `onclient` calls `sessionChanged`.
  - `limitsMode` is `selectedRule` (Task 13; `null` here) ? rule : `mode === 'edit' && (tools.tool === 'paint' || tools.tool === 'erase')` ? paint : plain.
  - One effect writes the `limits` slot `[heightLimitsLayer({ city, lids, mode: limitsMode, theme })]` in Setup with `heightLimits` on and a city in hand, else `[]`.
  - The `limits-layer` module is lazy-imported on mount, where the fog layer was (`SimPage.svelte:693-698`).

- [ ] **Step 1: Write the failing tests**

```ts
// lid-request.spec.ts
it('clampBbox keeps a small bbox and clamps a 6 km one to 3 km around its centre', () => { … }); // Review Focus 3
it('one request in flight; the latest bbox goes after the answer; older answers are dropped', async () => { … });
it('limitsChanged and chunksChanged (after missing > 0) ask again; chunksChanged after missing 0 does not', async () => { … });
it('no-session shows null; sessionChanged asks again', async () => { … }); // Review Focus 4
// prefs.spec.ts
it('a stored heightFog: false reads as heightLimits: false; writes heightLimits only', () => { … });
// ViewMenu.svelte.spec.ts
it('the Zoning height limits row toggles heightLimits only, with its caption', async () => { … });
// SimPage.svelte.spec.ts (fake worker emits { type: 'heights', rev, city: tinyLimits().city })
it('the View menu and the limits layer show in Setup only', async () => { … expect(overlayIds()).toContain(LIMITS_LAYER_ID) … });
it('at zoom ≥ 14.5 the page asks heightLids for the view; below, it asks nothing', async () => { … });
it('a theme change or a tool change rebuilds the layer without a new heightLids', async () => { // Review Focus 5
  expect(w.sent('heightLids')).toHaveLength(before);
  expect(lastLayer().props.mode).toEqual({ kind: 'paint' });
});
it('a stored heightLimits: false draws nothing until turned on', async () => { … });
```

In `e2e/sim.spec.ts`, set `FOG_LAYER` → `LIMITS_LAYER = 'sim-height-limits'` and the checkbox name to `'Zoning height limits'`, and retitle the three tests. Keep the axe scan in both schemes.

- [ ] **Step 2: Run and see it fail.** Run `npx vitest --run --project server src/lib/sim-page/lid-request.spec.ts src/lib/view/prefs.spec.ts src/lib/sim-page/overlay-mux.spec.ts`, then `npx vitest --run --project client src/lib/view src/lib/sim-page/SimPage.svelte.spec.ts src/routes`.
- [ ] **Step 3: Implement.** Then tune the token values by eye with `npm run dev` on `/sim`: pitched and flat, light and dark, transit capacity on, and a stroke painted. The glaze must stay faint enough that teal and plum read through it. Keep Task 9's tests green.
- [ ] **Step 4: Run and see it pass.** Run the commands above, then `npm run check`, `npm run lint` and `npx playwright test e2e/sim.spec.ts`.
- [ ] **Step 5: Commit.** Add the files above, then `git commit -m "feat(sim): draw height lids and contours on /sim in Setup"`

---

### Task 13: Rule selection

**Files:**
- Modify: `src/lib/sim-page/BrushCard.svelte` (props and the toggle), `src/lib/sim-page/RulesSection.svelte:16-30,90-100`, `src/lib/sim-page/SimPage.svelte:775` (and the `limitsMode` derivation)
- Test: `src/lib/sim-page/BrushCard.svelte.spec.ts`, `RulesSection.svelte.spec.ts`, `SimPage.svelte.spec.ts`, `e2e/sim.spec.ts`

**Interfaces:**
- Consumes: `LimitsMode` (Task 10); `city.sourceIds` and `SRC_RULE0` (Tasks 1 and 2).
- Produces:
  ```ts
  // BrushCard props (rules only)
  selected?: boolean; onselect?: (on: boolean) => void;
  // RulesSection props
  selectedRule?: string | null; onselectrule?: (id: string | null) => void;
  // SimPage
  let selectedRule = $state<string | null>(null);
  // limitsMode: selectedRule ? { kind: 'rule', source: idx < 0 ? -1 : SRC_RULE0 + idx } (idx = city.sourceIds.indexOf(selectedRule)) : …
  ```
  The toggle is a `button` labelled "Show on map" with `aria-pressed={selected}`, `aria-label="Show on map: {summary}"` and the shared `btn` class (≥ 24 px; 44 px on coarse pointers). It comes first in the card's button row, inside `ReadonlyFieldset`. Selecting one rule deselects any other. Selection clears when the rule leaves `store.policy.rules` (Remove, Undo), on `startRun`, and when its card's toggle is pressed again.

- [ ] **Step 1: Write the failing tests**

```ts
it('a rule card has a Show on map toggle with aria-pressed; custom brush cards do not', async () => { … });
it('pressing it calls onselect(true), pressing again onselect(false)', async () => { … });
it('RulesSection: selecting B deselects A', async () => { … });
it('SimPage: a selected rule sets the layer mode to its source code', async () => {
  expect(lastLayer().props.mode).toEqual({ kind: 'rule', source: SRC_RULE0 });
});
it('SimPage: removing the selected rule clears the selection; Run clears it', async () => { … }); // Review Focus 2
it('SimPage: a selected rule absent from sourceIds gives source -1', async () => { … });     // Review Focus 2
```

e2e: on `/sim`, add a transit rule, press "Show on map", and expect it to have `aria-pressed="true"`. Run the axe scan of the panel with the card selected, in both Playwright projects.

- [ ] **Step 2: Run and see it fail.** Run `npx vitest --run --project client src/lib/sim-page/BrushCard.svelte.spec.ts src/lib/sim-page/RulesSection.svelte.spec.ts src/lib/sim-page/SimPage.svelte.spec.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see it pass.** Also run `npx playwright test e2e/sim.spec.ts`.
- [ ] **Step 5: Commit.** Add the files above, then `git commit -m "feat(sim): select a zoning rule to see the lots it decides"`

---

### Task 14: Remove the fog, swap the bench case, update the docs

**Files:**
- Delete: `src/lib/map/fog/` (all four files), `src/lib/map/test/synthetic-fog.ts`, `src/lib/map/test/synthetic-fog.spec.ts`
- Create: `src/lib/map/test/synthetic-limits.ts`, `synthetic-limits.spec.ts`
- Modify: `src/lib/map/debug.ts:47-51,178-187` (`loadSyntheticLimits`), `src/lib/map/debug.svelte.spec.ts`, `e2e/bench/map-timeline.bench.ts:31-47,82,140`
- Modify docs: `docs/dev/sim-page.md` (the overlay mux slots at line 53; "View menu", "Fog" and "Fog colour" become "Height limits" and "Rule selection"; known gaps), `docs/dev/map-interfaces.md` ("Height fog" becomes "Height limits"; the `ViewPrefs` fields at line 38; gating at line 40), `docs/dev/sim-levers.md:84` (`fog` becomes the `heights` message, the `heightLids` request and `StoryEdit.source`), `docs/dev/fzp-mode.md:68-72` (`onheights`, `SimClientApi.heightLids`), `docs/dev/map-perf.md` ("Height fog case" becomes "Height limits case", plus a results row), `docs/dev/testing.md` (the MapLibre-interleaved GPU spec pattern of Task 11)

**Interfaces:**
- Consumes: `createCityBuild`, `createLidBuild` (Tasks 6 and 7), `heightLimitsLayer` (Task 10).
- Produces:
  ```ts
  // synthetic-limits.ts (bench and test only; the one place the builders run on the main thread)
  export function makeSyntheticLimits(seed: number): { city: HeightCity; lids: HeightLids };
  // 150,000 seeded lots over CITY_BOUNDS for the city; lids over a 3 km × 3 km downtown view of 25 ft × 100 ft lots,
  // block limits 4–40 with 1 lot in 20 an exception and 1 in 50 painted
  // debug.ts (VITE_E2E only)
  loadSyntheticLimits(seed?: number): Promise<{ faces: number; rimPaths: number; chains: number }>;
  ```
  The bench case is `{ name: 'playback + limits', … }`. It prints `limits=faces/rims/chains`, renders at z15.5 pitch 55 (the lid band) and passes `mode: { kind: 'plain' }`.

- Modify: `src/lib/map/palette.ts:24,68,110` and `palette.spec.ts:70-72` and the pinned CSS at `:233,253` (the `height-fog` token and its test go)

- [ ] **Step 1: Write the failing tests.** `synthetic-limits.spec.ts`: "is deterministic per seed and has more than 10,000 rim paths and 1,000 chains". `debug.svelte.spec.ts`: "`loadSyntheticLimits` draws `sim-height-limits` in the resolved theme" (assert `layer.props.theme`). `palette.spec.ts`: "no height-fog token remains" (`expect('height-fog' in TOKENS.light).toBe(false)`), with `--map-height-fog` removed from the pinned CSS.
- [ ] **Step 2: Run and see it fail.** Run `npx vitest --run --project server src/lib/map/test/synthetic-limits.spec.ts` and `npx vitest --run --project client src/lib/map/debug.svelte.spec.ts`.
- [ ] **Step 3: Implement.** Delete the fog files. Run `rg -n -i "fog" src e2e docs/dev` and expect no hits except history notes in docs that say the fog was replaced.
- [ ] **Step 4: Run the bench.** Run `lsof -ti :4173 | xargs kill` (only if a non-E2E preview runs), then `npm run bench:map` (headed, real GPU). Expected: "playback + limits" p95 ≤ 16.7 ms. Add the results row to `docs/dev/map-perf.md` with the machine, date, frames, p50, p95 and the counts. If no display is available, record "not yet run" in the row and say so in the hand-off. Do not claim a pass.
- [ ] **Step 5: Run everything.** Run `npm run check`, `npm run lint`, `npm run test:unit` and `npm run test:e2e`. Expected: all pass.
- [ ] **Step 6: Commit.** `git add -A src/lib/map e2e/bench docs/dev`, then `git commit -m "refactor(sim): remove the height fog; bench and docs for height lids"`

---

## Self-review

- **Spec coverage.**
  - Glass lids (ink top edge, neutral glaze, walls only at steps, no wall to water or limit 0): Tasks 7 and 10.
  - Regions spanning streets, and the 25 ft exception: Tasks 3 and 7.
  - One label per region with room to grow: Tasks 2, 5, 6 and 7.
  - Glaze density steps: Tasks 2 and 10.
  - Contours on the ground with labels and step widths: Tasks 6 and 10.
  - The crossfade around z15: Task 10.
  - Paint dashes while a tool is selected, keyed by source: Tasks 7 and 10, with the mode in Task 12.
  - Rule selection (protocol rule id, per-lot source, page-side restyle, zoomed-out outline): Tasks 1, 6, 7, 10 and 13.
  - Feedback timing (a new city per revision, lids again on chunks and moves): Tasks 8 and 12.
  - The depth check at pitch against MapLibre: Task 11.
  - Perf: Tasks 7, 8 and 14.
  - Coverage (city-wide contours need no chunks): Task 6.
  - Hue rules and contrast: Task 9.
  - The View row rename, Setup-only and default on: Task 12.
  - Fog and token removal, and docs: Tasks 9 and 14.
  - WCAG (dash, contrast, toggle): Tasks 9, 10 and 13.
  - Non-goals respected: no `Buildable here` and nothing during a run.
- **Types.**
  - `HeightCity` and `HeightLids` (Task 2) are used unchanged in Tasks 6 to 14.
  - `StagedBuild` (Task 6) is used by Tasks 7 and 8.
  - `LimitsMode` (Task 10) is used in Tasks 12 and 13.
  - `SRC_*` (Task 1) is re-exported where Task 2's types need it. Import it from `$lib/sim/levers/source`, so `map/height` depends on `sim/levers` for constants only.
- **Proportion.** Signatures and assertions only. Bodies are given only for the non-obvious algorithms (gap closing, vectorizing, label placement), as prose.
