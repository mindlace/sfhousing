# brush-tool — Spec (Milestone 1)

Source: `docs/superpowers/design/2026-10-10-1749-sf-housing-sim.md` (approved 2026-10-10).
Companion: `2026-10-10-plan-model-design.md` (the plan-model types and functions referenced here).
Status: draft for orchestrator review. No product code written.

## 1. Scope

Design row (verbatim):

| slug | scope |
|---|---|
| `brush-tool` | Pointer and touch interaction that emits `BrushStroke` ops: paint or erase, a stories value, and a radius. Includes the brush cursor ring, an explicit pan/paint mode switch on touch devices, undo/redo over the op log, and a live preview while dragging. |

**In:**
- The toolbar UI (tool switch, stories picker, radius control, undo/redo, status line), the brush ring and the stroke swath.
- Pointer, touch and pen handling over the MapLibre map, and stroke sampling.
- Keyboard shortcuts and the keyboard stamp.
- The **editor store**: the in-memory current `Plan`, plus the undo and redo stacks.
- The **simulation worker protocol** (`SimRequest`/`SimResponse`) and the **worker host**. The host loads the manifest and parcel chunks, owns the `ParcelIndex`, runs plan-model resolution, calls `generate` (I8), and sends diffs to the main thread.

**Out:**
- Rendering generated buildings and hiding existing ones (`map-view`). The ring and swath are drawn through map-view's overlay (§4.3, IC-1).
- The typology table and `generate` (`typology-generator`).
- Score computation (`scoreboard`). The host calls scoreboard's function and forwards the result (IC-2).
- Autosave, publish, the `/p/:id` loading and stale-dataset notice (`plan-sharing`).

Files (internal layout): `src/lib/brush/` (`BrushToolbar.svelte`, `BrushController.svelte.ts`, `sampler.ts`, `editor.svelte.ts`, `shortcuts.ts`) and `src/lib/sim/` (`protocol.ts`, `client.ts`, `worker.ts`, `host.ts`). The worker is created with `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`, following the interplanetary pattern (verified: interplanetary/src/lib/game.svelte.ts:50). `worker.ts` is a thin `onmessage` shell over `createSimHost(deps)` in `host.ts`, so the host can be tested in Node.

## 2. Interfaces

Copied verbatim:

| # | interface | owner → consumers | mark |
|---|---|---|---|
| I1 | `type ParcelId = string` — SF `mapblklot` (block+lot, e.g. `"3512008"`), the single join key across all data | data-pipeline → all | DC |
| I2 | `interface Envelope { maxStories: number }` — the per-parcel allowed envelope. The **only** thing manipulation writes. Later milestones add optional fields; M1 code must ignore unknown fields | plan-model → generator, scoreboard | MC (envelope-as-common-currency), DC (field set) |
| I3 | `type PlanOp = BrushStroke` where `interface BrushStroke { kind: 'paint' \| 'erase'; stories: number; radiusM: number; path: [lng: number, lat: number][]; id: string }`. The union widens in later milestones (`AreaOp`, `PolicyOp`) | brush-tool → plan-model | DC |
| I4 | `interface Plan { schema: 1; datasetVersion: string; ops: PlanOp[]; title?: string }` | plan-model → brush-tool, plan-sharing | DC |
| I5 | `resolveEnvelopes(plan: Plan, index: ParcelIndex): Map<ParcelId, Envelope>`. Ops apply in order and later ops win. A parcel is covered by a stroke iff its label point is within `radiusM` of the stroke polyline. `erase` deletes the entry. Ineligible parcels never get an entry | plan-model → generator | DC |
| I7 | `type BuildoutMode = 'max'` (M1). `'likely'` is reserved for M2 | generator, scoreboard | MC (sequence) |
| I8 | `generate(parcel: ParcelRecord, env: Envelope, seed: number, mode: BuildoutMode): GeneratedBuilding \| null`. Returns `null` when the generated floor area does not exceed `existingFloorAreaM2`: nobody rebuilds smaller | generator → map-view, scoreboard | DC |
| I9 | `interface GeneratedBuilding { parcelId: ParcelId; source: 'user'; /* widens to 'pipeline' \| 'scenario' later */ typology: TypologyId; parts: { footprint: [lng, lat][]; baseM: number; topM: number }[]; stories: number; units: number; floorAreaM2: number; replacesExisting: boolean }` | generator → map-view, scoreboard | DC |
| I12 | Data manifest: `/data/<datasetVersion>/manifest.json` → `{ datasetVersion, builtAt, sources: { id, url, retrievedAt, license }[], chunks: { cellId, bbox, url, parcelCount }[], buildingsTiles: url, neighborhoods: url }` | data-pipeline → map-view, generator, platform | DC |
| I14 | Seed: `seed = fnv1a32(parcelId)`. Variety is a pure function of parcel and envelope, so the same plan always renders identically for everyone | generator | DC |

### Internal types (new; no I-row altered)

```ts
// src/lib/sim/protocol.ts — the single main↔worker protocol for M1
type Rev = number; // strictly increasing per client, starting at 1
type SimRequest =
  | { type: 'init'; rev: Rev; manifestUrl: string; mode: BuildoutMode }
  | { type: 'load'; rev: Rev; plan: Plan }               // replace the whole plan (open, remix, new)
  | { type: 'preview'; rev: Rev; op: PlanOp }            // replaces any earlier preview
  | { type: 'cancelPreview'; rev: Rev }
  | { type: 'commit'; rev: Rev; op: PlanOp }             // append; also used for redo
  | { type: 'undo'; rev: Rev; opId: string }             // must be the last committed op
  | { type: 'prefetch'; bbox: BBox }                     // advisory, no rev
  | { type: 'retryChunks' };
type DiffPhase = 'load' | 'preview' | 'cancel' | 'commit' | 'undo' | 'chunk';
interface OpStats { opId: string; kind: 'paint' | 'erase'; stories: number;
  covered: number; ineligible: number; built: number; notBigger: number; removed: number; partial: boolean }
type SimResponse =
  | { type: 'ready'; rev: Rev; datasetVersion: string; chunkCount: number }
  | { type: 'diff'; rev: Rev; phase: DiffPhase; upserts: GeneratedBuilding[]; removals: ParcelId[];
      stats?: OpStats; complete: boolean; score?: Score }
  | { type: 'chunks'; pending: number; failed: string[] }  // cellIds
  | { type: 'error'; rev: Rev; code: 'manifest-failed' | 'bad-request' | 'internal'; message: string };

// src/lib/brush/editor.svelte.ts
interface Editor {
  readonly plan: Plan; readonly canUndo: boolean; readonly canRedo: boolean;
  readonly readOnly: boolean;
  load(plan: Plan, opts?: { readOnly?: boolean }): void; // clears redo
  commit(op: PlanOp): CommitResult;                       // clears redo
  undo(): void; redo(): void;
}
type CommitResult = { ok: true } | { ok: false; reason: 'too-large' | 'too-many-ops' | 'read-only' };

// src/lib/brush/sampler.ts (pure)
interface StrokeSampler { push(lng: number, lat: number): boolean; path(): [number, number][]; full(): boolean }
function createSampler(radiusM: number): StrokeSampler;
type BrushTool = 'move' | 'paint' | 'erase';
```

## 3. Global constraints (verbatim from design)

- **Free and open source.** No paid APIs and no vendor keys are needed to run
  or build it. Licence: MIT for code (OD-3). Data attribution is shown in-app
  (ODbL for the OSM/Protomaps basemap and Overture, PDDL/public domain for
  DataSF).
- **Determinism.** The same `Plan` + `datasetVersion` gives the same buildings
  and the same score, on every machine.
- **Overshoot is meaningful.** No readout caps at 100% of a target.
- **Honesty of numbers.** Every unit count is labelled with what it is (M1:
  *theoretical max buildout*). Net counts are shown, not gross. Sources and
  vintages are visible.
- **Performance targets.** Existing-city view pans at 60 fps on a 2022-era
  laptop. Generated buildings appear within 150 ms of pointer-up for strokes
  covering ≤ 500 parcels. A whole-city repaint (≈150k parcels) finishes within
  5 s, off the main thread. The first meaningful paint transfers ≤ 5 MB (parcel
  chunks load lazily under the brush).
- **Mobile works.** Touch painting uses an explicit mode switch. Layout works
  at 375 px.
- **Data is static and versioned.** The worker does no geo computation at
  runtime.
- **Cross-project conventions apply:** Conventional Commits, worktrees for all
  work, bare-name Cloudflare resources (`sfhousing`), and the migration
  workflow via Drizzle.

("The worker" in the constraint above is the Cloudflare Worker. The browser web worker described here does do geometry.)

## 4. Behaviour

### 4.1 Tools and modes

- There are three tools in one segmented control (a `radiogroup`): **Move** (hand icon), **Paint** (brush icon), **Erase** (eraser icon). Each button has a visible label at ≥ 768 px. At narrower widths the label becomes an `aria-label` plus a tooltip.
- **Default tool:** Paint when `matchMedia('(pointer: fine)')` matches at load, otherwise Move. The tool is not persisted. Stories and radius are persisted in `localStorage['sfhousing:brush'] = {"stories":6,"radiusM":30}`; all access is wrapped in try/catch, and the defaults are 6 stories and 30 m.
- **Move:** all MapLibre handlers are enabled.
- **Paint/Erase:** one-pointer drag paints. MapLibre `dragPan` is disabled. `scrollZoom`, `touchZoomRotate`, right-drag rotate/pitch, `doubleClickZoom` (mouse only) and `keyboard` remain enabled.
- **Space held** (desktop) switches temporarily to Move: the cursor becomes `grab` and `dragPan` is enabled. Releasing Space restores the tool. Space pressed during a stroke is ignored until the stroke ends.
- **Touch:** in Paint/Erase, one finger paints. When a second touch lands, the in-progress stroke is **cancelled** (no op is created, and the preview is reverted) and the gesture passes to MapLibre pinch/rotate. While any touch remains down, single-finger painting does not resume; a fresh touch is required. In Move, all touches pan and zoom.
- **Pen** behaves like a mouse, and pressure is ignored. A mouse button other than the primary one never paints.
- **Read-only** (`editor.readOnly`, used by `/p/:id`): the toolbar shows only the Move tool and a disabled-tools note, "Read-only — Remix to edit". The Remix button itself belongs to plan-sharing.
- **Before `ready`**, Paint and Erase are disabled, and the status line reads "Loading city data…". If `error manifest-failed` arrives, the status line reads "Couldn't load city data." with a **Retry** button, which resends `init`.

### 4.2 Stories and radius controls

- **Stories:** a stepper `[−] 6 stories [+]`. The value is an editable `<input type="number" min=1 max=60 step=1>`. Out-of-range or non-integer input is clamped and rounded on blur or Enter. Beside it is the derived height `≈ 19 m` (stories × 3.1 m, rounded to an integer). This uses the design's floor-to-floor height, so it is a height hint, not a typology claim. Preset chips: **2 · 3 · 4 · 6 · 8 · 12 · 20 · 40**. The active chip is `aria-pressed`. The stepper is disabled when the tool is Erase, with the hint "Erase removes painted height".
- **Radius:** a slider with `aria-valuetext="Brush radius 30 metres"`, on a logarithmic scale from 5 to 500 m with 100 positions. The value is rounded to integer metres. It is labelled "Brush 30 m". On narrow screens it lives in a popover opened from a "30 m" button.
- **Shortcuts** (§4.7) step the radius by ×1.25 or ÷1.25 (rounded and clamped), and the stories by ±1.

### 4.3 Brush ring and swath

- Both are drawn as deck.gl layers in metres, so they are correct under pitch and zoom. `brush-ring` is a `ScatterplotLayer` with one stroked point (`radiusUnits: 'meters'`, a 2 px line, no fill). `brush-swath` is a `PathLayer` (`widthUnits: 'meters'`, width = 2·radiusM, rounded caps and joints, 25% opacity). Paint uses token `--brush-paint` and Erase uses `--brush-erase`; the erase ring is dashed (`PathStyleExtension`, or a 64-gon path in place of the scatterplot point). They are registered through map-view's overlay layer list (IC-1).
- The ring follows the hovered pointer (fine pointers only) whenever the tool is Paint or Erase. During a stroke it follows the active pointer on every device. The swath shows the **sampled path** (§4.4), so what you see is the op that will be stored.
- At a zoom where the radius is under 4 px on screen, a minimum-size 4 px ring is drawn instead, and the status line reads "Zoom in to see the brush".

### 4.4 Stroke sampling and simplification

- Each `pointermove` is processed with `getCoalescedEvents()` when the browser supports it. Each position is unprojected (`map.unproject`) and quantised with plan-model's `quantize`.
- Points outside `SF_BBOX` are ignored. A stroke that ends with no in-bounds points produces no op.
- **Streaming radial filter:** a point is *kept* if its plan-model `project` distance from the last kept point is ≥ `s = clamp(radiusM / 2, 2, 50)` m. The first point is always kept. The path is `kept + [latest point]`, unless the latest point equals the last kept point. The kept prefix only ever grows, so each preview's path is a prefix of the final path plus the live tail. The final preview (sent on the last move before pointer-up) is identical to the committed op. Douglas–Peucker is **not** used, because it is not prefix-stable and so would make preview and commit disagree.
- A pointer-down followed by a pointer-up with no movement gives a one-point path, a **stamp** (a disc). This is the single-pointer, non-drag way to paint (WCAG 2.2 SC 2.5.7).
- **Cap:** when kept points reach `PATH_MAX_POINTS` (2,000), the current stroke commits and a new stroke begins at the same point with a new id. To the user it is continuous; each piece undoes separately. This needs at least 4 km of drag, because s ≥ 2 m.
- **Op id:** 12 characters of base58 from `crypto.getRandomValues`. Ids do not affect resolution.
- `stories` and `radiusM` are captured at pointer-down and frozen for the stroke. Shortcut changes during a stroke apply to the next stroke.

### 4.5 Preview, commit, cancel

- **During drag**, the controller sends `preview` with the current path. There is **at most one preview in flight**, so the newest pending path replaces any unsent one. Previews are sent no more than once per animation frame. When a diff arrives with `phase:'preview'`, the next pending preview (if any) is sent.
- **On pointer-up**, the controller builds the final op and calls `editor.commit(op)`:
  - If the plan's `datasetVersion` ≠ the worker's `ready.datasetVersion`, it first does `rebasePlan`.
  - If adding the op makes `planByteSize > MAX_PLAN_BYTES` or `ops.length > OPS_MAX`, the commit is refused. The controller sends `cancelPreview`. The status line shows, for 6 s, "This stroke would make the plan too large to save (256 KB limit). Undo some strokes or start a new plan."
  - Otherwise the editor appends the op, clears redo, and the controller sends `commit`.
- **The 150 ms budget** is measured from `pointerup` to map-view applying the `phase:'commit'` diff. The host meets it by promoting the matching preview: if the last preview op deep-equals the commit op, the commit diff is computed against the already-displayed preview state and is normally empty.
- **Cancel** (Escape, `pointercancel`, a second touch, or a tool change mid-stroke) sends `cancelPreview`. The host reverts the display to committed state (`phase:'cancel'`).
- **Result announcement** (the status line, inside an `aria-live="polite"` region, shown for 4 s):
  - paint: "Painted 6 stories on 143 parcels · 97 new buildings · 46 already as big or bigger"
  - erase: "Erased 143 parcels · 97 generated buildings removed"
  - if any parcels were ineligible, append " · 12 not eligible (parks, streets)"
  - if `stats.partial`, append " · some areas still loading"
  - if nothing was covered: "No parcels under that stroke"

  The numbers come from `OpStats`: `covered` is the eligible parcels covered, `built` is the non-null generated buildings, `notBigger` is the eligible parcels for which `generate` returned null, and `removed` is the buildings removed.

### 4.6 Undo and redo

- Undo and redo work over the op log. **Undo** removes the last op from `plan.ops`, pushes it onto the in-memory redo stack, and sends `undo {opId}`. **Redo** pops the stack, `commit`s that op again (same id) and sends `commit`.
- The redo stack is cleared by any new commit and by `load`. It is not persisted, so a reload loses redo. Undo depth is the whole op log, including ops from a loaded plan.
- Undo and redo are ignored while a stroke is in progress, and in read-only mode.
- Buttons: **Undo** and **Redo**, with `aria-label`s that include the shortcut, disabled when unavailable.
- Announcements: "Undid paint, 6 stories" / "Undid erase" / "Redid paint, 6 stories".

### 4.7 Keyboard

Shortcuts are active when focus is not in an `input`, `textarea` or `[contenteditable]`, and no modal is open.

| key | action |
|---|---|
| `V` or `H` | Move |
| `B` | Paint |
| `E` | Erase |
| Space (hold) | temporary Move |
| `-` / `=` (or `+`) | stories −1 / +1 |
| `[` / `]` | radius ÷1.25 / ×1.25 |
| ⌘Z / Ctrl+Z | undo |
| ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y | redo |
| Esc | cancel the stroke in progress |
| Enter (map focused, Paint or Erase) | **keyboard stamp** at the map centre |

A "Keyboard shortcuts" disclosure button in the toolbar lists this table.

### 4.8 Accessibility (WCAG 2.2 AA, planafoot doctrine)

- All toolbar controls are native or ARIA-correct (radiogroup with arrow-key roving, buttons, slider, number input). On touch layouts every control has a target of at least 44 × 44 px (above SC 2.5.8's 24 px).
- **Keyboard painting:** the map canvas container is focusable, with `aria-label` "Map. Arrow keys pan, plus and minus zoom. In Paint or Erase, press Enter to apply the brush at the centre crosshair." When the map has `:focus-visible` and Paint/Erase is active, a centre crosshair and the brush ring are shown at the map centre. Enter commits a stamp op there. Arrow keys pan with MapLibre's keyboard handler (inferred: MapLibre `KeyboardHandler` is enabled by default), so a keyboard user paints by panning and stamping.
- **Stated limits:** freeform strokes need a pointer. The generated buildings are not exposed individually to assistive tech. Each stroke's outcome is announced in text (§4.5), and the totals are in the scoreboard's text readouts.
- Colour is never the only signal: Erase also has a dashed ring and a different icon and label.
- There is no motion from brush-tool beyond following the pointer. Rise-in animation belongs to map-view and is gated on reduced motion there.

### 4.9 Worker host behaviour

- **`init`:** fetch the manifest. On failure, send `error manifest-failed`. On success, send `ready`. Chunk URLs resolve relative to the manifest URL.
- **Chunk loading:** the host loads a chunk whenever its bbox intersects the `opBBox` of any op in the plan, the current preview op, or a `prefetch` bbox. At most 4 fetches run concurrently. A failed chunk is retried after 1 s, 4 s and 16 s; after that it is reported in `chunks.failed`, and `retryChunks` starts another cycle. On every change in the pending or failed sets, the host sends `chunks`.
  - The toolbar shows "Loading parcels…" while `pending > 0`.
  - While `failed` is non-empty, a persistent line reads "Some parcel data didn't load — buildings there are missing." with a **Retry** button.
  - When a chunk lands, the host calls `addChunk` and then `resolveChunk`. It reapplies the active preview, if any, generates, and sends `phase:'chunk'`.
- **Prefetch:** while the tool is Paint or Erase and zoom ≥ 14, the controller sends `prefetch(viewport bbox)` on `moveend`. This keeps the first paint within 5 MB, because the initial city-wide view prefetches nothing.
- **Diffs:** `upserts` and `removals` are relative to the last diff the host sent, so the main thread applies them in order. The display state is the committed state, or the committed state plus the active preview.
  - Upserts are sorted by `parcelId`.
  - A parcel whose envelope resolves to an entry but whose `generate` returns `null` appears in neither list, or in `removals` if it previously had a building.
  - `complete` is true iff no chunk needed by the plan (plus the preview) is pending or failed.
- **Ordering:** requests are handled in FIFO order. Every response carries the `rev` of the request it answers, or the latest rev for `phase:'chunk'`. The main thread drops `preview` diffs whose rev is older than its latest `cancelPreview` or `commit`, by sending order; the host enforces this by always sending a cancel or commit diff after them.
- **Generation:** for every changed parcel, the host calls `generate(record, env, fnv1a32(id), 'max')`. The whole-city path (`load` of a plan covering about 150k parcels) generates in ascending id order. Results are batched so that diffs of at most 5,000 upserts are sent as they complete, so the city fills in progressively; the 5 s target is to the final batch.
- **Score:** after each diff, the host calls scoreboard's pure score function over the display state and attaches `score` (IC-2).
- **Errors:** an invalid request (for example, an `undo` whose `opId` is not last) gets `error bad-request`, and the host resyncs: the main thread responds by sending `load` with `editor.plan`.

### 4.10 Edge cases

- **Empty plan:** Undo is disabled and no diffs are sent beyond the `load` diff, which is empty.
- **Stroke entirely over ineligible parcels:** the op is still committed (it is a valid, undoable op), and the announcement reads "No eligible parcels under that stroke · 12 not eligible (parks, streets)".
- **Stroke over unloaded or failed chunks:** the op commits, `stats.partial = true`, and buildings appear when the data arrives.
- **Plan from an older `datasetVersion`:** it resolves against the current dataset. Rebasing happens on the next commit (§4.5). The notice belongs to plan-sharing.
- **Overshoot (>100% of target):** scoreboard owns readouts. brush-tool never limits painting to reach or stay under a target.
- **Window blur mid-stroke:** treated as a cancel.

## 5. Seams

- **`area-select` (M2):** `SimRequest.commit/preview` already carry `PlanOp`, so a new variant flows through unchanged. The toolbar's tool `radiogroup` is a list, so an "Area" tool is one more entry. Nothing else is added now.
- **`buildout-likelihood` (M2):** `init.mode` carries `BuildoutMode` (`'max'` only). A mode toggle would send a new `init` or a future `setMode`. Nothing else now.
- **`consequences` (M2):** carried by `diff.score`. No brush-tool change.
- **`scenario-loader` (M3):** a future `load` gains a baseline. Now: none.
- **`policy-levers` (M3):** new tools and ops. Now: none.
- **`time-permitting` (M4) / `pipeline-overlay` (M5):** `GeneratedBuilding.source` passes through untouched. Now: none.
- **`plan-sharing` (M1 sibling):** consumes `Editor.load`, `Editor.plan` (reactive, for autosave) and `readOnly`. It owns the stale-`datasetVersion` notice and the Remix action.

## 6. Testing

**Server project (Node, `*.spec.ts`):**
- `sampler.spec.ts`
  - The radial filter spacing.
  - Prefix stability: for any point sequence, `path()` after k pushes, minus its tail, is a prefix of the final `path()` (fast-check).
  - Quantisation, out-of-bbox dropping, a one-point stamp, and `full()` at 2,000.
- `editor.spec.ts`
  - The commit, undo and redo state machine.
  - Redo is cleared on a new commit or a load.
  - `too-large` and `too-many-ops` refusals, using the plan-model fixture `too-large` that is generated in-test.
  - Rebase on commit.
  - Read-only refusal.
- `host.spec.ts`
  - Uses `createSimHost` with an in-memory fetch serving `src/lib/sim/fixtures/data/test-v1/` (a manifest plus 4 chunks of the plan-model `grid-20x20` parcels) and a stub `generate`: a building with `units = maxStories` when `maxStories > 2`, else `null`.
  - (a) Preview then commit gives the same display as commit alone.
  - (b) Undo gives the same display as `load(plan minus last op)`.
  - (c) Chunk arrival order does not matter, including a chunk that arrives mid-preview.
  - (d) A failed chunk is retried 3 times on a fake clock, then reported in `failed`.
  - (e) Stale previews are superseded.
  - (f) A bad undo leads to `error bad-request`.
  - (g) The `stats` counts on a hand-checked stroke.
  - Properties (a)–(c) run under fast-check over random op sequences.
- `shortcuts.spec.ts`: the key → action map, and suppression inside inputs.

**Client project (Vitest browser, `*.svelte.spec.ts`):**
- `BrushToolbar.svelte.spec.ts`
  - Radiogroup arrow-key roving.
  - Stepper clamping, presets with `aria-pressed`, and the `≈ m` hint.
  - The log slider maps to 5 and 500 at its ends, with `aria-valuetext`.
  - Erase disables the stepper.
  - Disabled states before `ready` and on `manifest-failed`, including the Retry wiring.
  - Status-line texts for each §4.5 template.
  - The read-only layout at 375 px.
- `BrushController.svelte.spec.ts`
  - Uses a stub map that exposes `unproject` and handler toggles.
  - A drag emits previews (no more than one per frame, one in flight) and then a commit.
  - Space toggles `dragPan`.
  - A second touch cancels the stroke.
  - Escape cancels.
  - Enter on the focused map stamps at the centre.

**Playwright e2e** (the fixture dataset `test-v1` is served by platform at `/data/test-v1/`, IC-3):
1. Desktop paint: a drag across the grid produces a status line "Painted 6 stories on N parcels…", and map-view's test hook reports N generated buildings. The time from pointer-up to the commit diff being applied is ≤ 150 ms, read from a `performance.mark` pair (a 500-parcel stroke, as a soft-failing perf check on CI).
2. Undo and redo with the keyboard; the counts revert.
3. Mobile (375 × 812, touch): Move-mode drag pans and creates no op. Switching to Paint and dragging creates an op. A two-finger gesture during a stroke creates no op.
4. A stamp by click and a stamp by keyboard (Enter) each create one op.
5. A failed chunk (the route aborts one chunk) shows the Retry line, and Retry recovers.
6. The axe gate (`expectNoA11yViolations`, planafoot pattern) on the editor page with the radius popover open and the shortcuts disclosure open.

## 7. Acceptance criteria

1. On desktop, Paint is the default tool. A drag paints, and Space-drag pans. On touch, Move is the default, and painting requires an explicit switch.
2. The committed op's path equals the path of the last preview sent (asserted in tests).
3. Strokes are quantised to 1e-6°, spaced ≥ `clamp(r/2, 2, 50)` m, and capped at 2,000 points with a continuous split.
4. Generated buildings appear ≤ 150 ms after pointer-up for strokes of ≤ 500 parcels on CI-class hardware.
5. Undo and redo restore the exact display of `load(ops prefix)`.
6. A commit that would exceed 256 KB or 5,000 ops is refused with the specified message, and no partial op is stored.
7. Every brush action has a non-drag alternative (a click or tap stamp, and the keyboard Enter stamp). The axe gate passes. Touch targets are ≥ 44 px.
8. The worker protocol in `src/lib/sim/protocol.ts` matches §2. It is the only main↔worker channel.
9. A chunk failure is visible, retried automatically, and recoverable manually.

## 8. Open questions

1. **Default tool on hybrid devices** (a touch laptop with a fine pointer). *Recommend:* use `(pointer: fine)` at load (Paint). A touch on Paint still paints, which is fine because two-finger gestures still pan.
2. **Should Erase take a stories value**, so that erase becomes "lower to N"? *Recommend:* no. Painting a lower height already does that.

## Interface concerns (for the orchestrator)

- **IC-1: overlay layer registration.** brush-tool needs map-view to accept extra deck.gl layers (`brush-ring`, `brush-swath`) and to expose `unproject`, the handler toggles and the canvas container. No I-row covers this. Proposed internal contract: `mapView.setOverlayLayers('brush', Layer[])`, plus access to the `maplibregl.Map` instance.
- **IC-2: score inputs.** Scoreboard needs `existingUnits`, `neighborhood` and `replacesExisting` per parcel, and `GeneratedBuilding` (I9) does not carry the first two. This spec has the worker host (which holds the `ParcelRecord`s) call scoreboard's pure `computeScore` and attach `diff.score: Score` (I11). The scoreboard spec must confirm that it provides a pure function that can run in the worker.
- **IC-3: test dataset.** The e2e tests need platform to serve a fixture `datasetVersion` (`test-v1`), and the app to accept a manifest-URL override in test builds.
- **IC-4: diff payload size.** A whole-city `load` sends about 150k `GeneratedBuilding`s by structured clone. If map-view needs a columnar or transferable format to meet 5 s, it would replace `upserts: GeneratedBuilding[]` in this internal protocol. That is map-view's call; no I-row changes.
- **IC-5: one protocol.** typology-generator's spec must not define a second worker protocol. It supplies `generate` (I8) and `fnv1a32` (I14) as pure imports into `host.ts`.
- **IC-6: I12 consumers** should include brush-tool (the worker host), which reads `chunks[]`.
