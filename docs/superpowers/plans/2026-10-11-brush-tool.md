# brush-tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the brush editor and the simulation web worker for SF Housing Simulator. The pieces are the I15 main↔worker protocol, the worker host (`createSimHost`), the I16 `loadManifest`, the editor store, sampler, toolbar, ring/swath overlay, the pointer/touch/keyboard controller and the `/` page wiring. Painting on the map then emits `BrushStroke` ops, which the worker resolves, generates, packs, scores and sends back to map-view as `GeneratedUpdate` diffs.

**Architecture:** The worker side splits into four layers:
- `chunks.ts` loads chunks (queue, concurrency, backoff, status reports).
- `display.ts` holds the display state (generated buildings per cell, hide set, score accumulator, render diffs with batching and rising split).
- `host.ts` orchestrates them: it handles requests, holds the plan, the committed envelopes and the preview overlay.
- `worker.ts` is a thin shell over `createSimHost(deps)`, so everything above it is tested in Node.

On the main thread, `client.ts` wraps the worker (rev counter, resync dedupe, summary promises). Pure brush modules (`sampler`, `shortcuts`, `radius`, `messages`, `settings`, `ids`, `overlay`) feed three things:
- a Svelte 5 `Editor` store,
- a `BrushState` store,
- `BrushController` (DOM events → ops).

`BrushEditor.svelte` composes SimMap, toolbar, controller and client. `+page.svelte` renders `BrushEditor`.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, Vite module workers, deck.gl 9.4 (`ScatterplotLayer`, `PathLayer` from `@deck.gl/layers`), MapLibre 6, Vitest (server project = Node `*.spec.ts`, client project = browser `*.svelte.spec.ts`), fast-check, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-10-brush-tool-design.md` (design: `docs/superpowers/design/2026-10-10-1749-sf-housing-sim.md`). Every implementer reads the spec sections named in their task. The plan argues from the spec. Where the spec is silent, the **Spec-silent rulings** section below governs.

## Global Constraints

Verbatim from spec §3:

- **Free and open source.** No paid APIs and no vendor keys are needed to run or build it. Licence: MIT for code (OD-3). Data attribution is shown in-app (ODbL for the OSM/Protomaps basemap and Overture, PDDL/public domain for DataSF).
- **Determinism.** The same `Plan` + `datasetVersion` gives the same buildings and the same score, on every machine.
- **Overshoot is meaningful.** No readout caps at 100% of a target.
- **Honesty of numbers.** Every unit count is labelled with what it is (M1: *theoretical max buildout*). Net counts are shown, not gross. Sources and vintages are visible.
- **Performance targets.** Existing-city view pans at 60 fps on a 2022-era laptop. Generated buildings appear within 150 ms of pointer-up for strokes covering ≤ 500 parcels. A whole-city repaint (≈150k parcels) finishes within 5 s, off the main thread. The first meaningful paint transfers ≤ 5 MB (parcel chunks load lazily under the brush).
- **Mobile works.** Touch painting uses an explicit mode switch. Layout works at 375 px.
- **Data is static and versioned.** The worker does no geo computation at runtime.
- **Cross-project conventions apply:** Conventional Commits, worktrees for all work, bare-name Cloudflare resources (`sfhousing`), and the migration workflow via Drizzle.

("The worker" above is the Cloudflare Worker. The browser web worker built here does do geometry.)

Interfaces, verbatim from spec §2 (the rows this plan produces or consumes):

- I1 `type ParcelId = string` — SF `mapblklot` (block+lot, e.g. `"3512008"`), the single join key across all data.
- I2 `interface Envelope { maxStories: number }`. M1 code must ignore unknown fields.
- I3 `type PlanOp = BrushStroke` where `type BrushStroke = { kind: 'paint'; stories: number /* integer 1..80 */; radiusM: number /* 5..500 */; path: [lng: number, lat: number][]; id: string } | { kind: 'erase'; radiusM: number; path: [lng: number, lat: number][]; id: string }`.
- I4 `interface Plan { schema: 1; datasetVersion: string; ops: PlanOp[]; title?: string }`.
- I5 `resolveEnvelopes(plan, index)`: ops apply in order and later ops win. A parcel is covered iff its label point is within `radiusM` of the stroke polyline. `erase` deletes the entry. Ineligible parcels never get an entry.
- I8 `generate(parcel, env, seed, mode): GeneratedBuilding | null`. It returns `null` when a replacement's floor area ≤ `existingFloorAreaM2` or its units ≤ `existingUnits`. An `adu` is exempt.
- I12 manifest: `{ datasetVersion, builtAt, sources, chunks: { cellId, bbox, url, parcelCount }[], buildingsTiles, basemapTiles, glyphs, sprite?, neighborhoods }`. Every `url` is root-relative (`/data/<v>/…`). `datasetVersion` matches `^(\d{4}-\d{2}-\d{2}-[0-9a-f]{8}|fixture-\d+)$`.
- I14 `seed = fnv1a32(parcelId)`.
- I15 is exactly the code block in spec §2 "Protocol and internal types": `SimRequest`, `DiffPhase`, `OpStats`, `SimResponse`, `ParcelSummary`. The main thread never receives `GeneratedBuilding[]`.
- I16: `manifestUrl = /data/${v}/manifest.json`. map-view and the worker host take the manifest as a parameter, never a global. If that version's manifest 404s, fall back to current.
- I17: `SimMapHandle` (`src/lib/map/types.ts`), including `setOverlayLayers(layers)`.

Project and assignment constraints:

- Code style: 2-space indent, single quotes, no trailing commas, 100 columns. Vitest runs with `expect.requireAssertions`, so every test calls `expect`. Conventional Commits. No heredoc commit messages: use `git commit -m … -m …` or `-F <file>`.
- Do **not** modify `src/lib/{data,plan,generator,scoreboard}/` or `src/lib/map/` (other operators own them). Import from them only. If a change there seems needed, stop and report it (operator escalates to main).
- Worker-bundle modules (`src/lib/sim/{protocol,manifest-shape,chunks,display,host,worker}.ts` and everything they import) must not import zod or `$app/*`, and must not touch the DOM. `src/lib/data/manifest.ts` imports zod, so the worker side may only `import type` from it. `src/lib/data/parcel-chunk.ts`, `src/lib/data/dataset-version.ts`, `$lib/plan`, `$lib/generator`, `$lib/scoreboard`, `$lib/map/pack` and `$lib/map/types` (type-only) are zod-free and safe.
- **I17 addendum (DC ruling):**
  - SimMap props `requestParcelSummary?: (parcelId) => Promise<ParcelSummaryLike | null>` (SimMap owns latest-wins), `onRetryChunks?: () => void`, `onready?: (h: SimMapHandle) => void`.
  - The handle is the component instance via `bind:this`/`onready`.
  - `ParcelSummary` must be assignable to `ParcelSummaryLike`, with a compile-time assertion.
- Replace map-view's interim `src/routes/+page.ts` with `loadManifest(plan.datasetVersion, PUBLIC_DATASET_VERSION)` (I16, 404 → current with `fellBack: true`).
- `radiusM` is an integer: validate and round at the editor boundary.
- plan-model:
  - `rebasePlan`/`emptyPlan` throw `TypeError` on an invalid datasetVersion, so guard them.
  - `applyOp` mutates its input.
  - Map iteration order is not guaranteed except in `resolveEnvelopes` output.
  - `resolveParcels`/`resolveChunk` return `null` for no entry.
- Worker host:
  - Load ALL chunks intersecting the plan's strokes.
  - Re-resolve late chunks via `resolveChunk` and emit their diff.
  - Reject a chunk whose `datasetVersion` ≠ the manifest's as failed.
  - A re-`init` with a new manifest rebuilds the ParcelIndex, the memo, the chunks and the score.
  - Pass landUse sentinels `UNKNOWN`/`NONE` through as data.
- scoreboard notes:
  - Targets are structured-cloned, so match by `target.id`.
  - `score()` is last-entry-wins.
  - `byNeighborhood` keys are sorted and trimmed.
- map-view has no resync latch, so `onResyncNeeded` fires once per out-of-order revision. **The client dedupes: one `load` per resync episode.**
- Any `GeneratedUpdate` size is safe (map-view slices it).
- The e2e build sets `VITE_E2E=1`. Kill any stale :4173 server before Playwright (`lsof -ti :4173 | xargs kill`).
- Generated layers draw without `beforeId`. That is map-view's ruling, so leave it.
- e2e that need scoreboard UI or plan-sharing go in as `test.fixme('W6: <reason>')`. Do NOT un-fixme map-view's W6 tests in `e2e/map.spec.ts`.
- Reuse `typologyLabel(typology, units)` from `src/lib/map/tooltip.ts` if a typology name is ever rendered. Do not fork it.
- **Conductor ruling (backoff):** the chunk retry schedule is a host option `retryDelaysMs`, default `[1000, 4000, 16000]`. Only the `VITE_E2E === '1'` build passes `[50, 100, 200]`. Unit tests check the real schedule with fake timers.
- **Conductor ruling (load version):** a `load` whose `plan.datasetVersion` ≠ the manifest's renders the strokes on the manifest's data and is never rejected. There is a host test for it.
- **Conductor ruling (bench):** `host.bench.spec.ts` uses a synthetic 150k-parcel `ParcelRecord` city: generator `synthParcels` lot shapes on plan-model's `resolve.bench.spec.ts` grid.
- Runtime dependencies: none added. (deck.gl, MapLibre and kdbush are already credited.)

## Spec-silent rulings (made by the operator; implementers follow them)

| # | ruling | cost if wrong |
|---|---|---|
| R1 | Worker host is split into `chunks.ts` (loader), `display.ts` (display state + render diffs), `host.ts` (requests/plan/preview). The spec's file list names `host.ts`; the split is internal. | none (internal) |
| R2 | Manifest validation in the worker is a zod-free structural check, `checkManifestShape` (`src/lib/sim/manifest-shape.ts`). It duplicates `CELL_ID_RE`, with a test asserting the copies are equal. | small |
| R3 | `loadManifest(planVersion, currentVersion, fetchFn = fetch)` takes an optional fetch (SvelteKit `load` passes its own). Rules: an invalid `planVersion` goes straight to current with `fellBack: true`; an invalid `currentVersion` rejects; a manifest whose `datasetVersion` ≠ the requested one rejects. | small |
| R4 | Every rev-carrying request (`load`, `preview`, `cancelPreview`, `commit`, `undo`) gets ≥ 1 `diff` reply, even when nothing changed (an empty render with revision +1). A landed chunk always yields a `phase:'chunk'` diff. Flow control and stats rely on this. | small |
| R5 | Main-thread "drop stale previews" (§4.9 Ordering) is not done by dropping `render`. Every `render` is applied in order, because revisions are a gap-free chain and dropping one triggers a resync. Staleness only governs controller flow control and announcements (`SimClient.isStalePreview`). | none visible: the host always follows with a cancel/commit diff |
| R6 | `rising` (map-view spec §4.4) = parcels whose new building is new in the cell, or whose max part `topM` exceeds the previous one. Revision-0 diffs put everything in `settled` (`rising: null`). | cosmetic |
| R7 | Batching: a cell's changed-parcel count is the number of its ids whose display envelope differs from the rendered one (computed before generating). A diff is flushed before a cell would push it over 5,000. A single cell over 5,000 goes alone. | none |
| R8 | `OpStats` is attached only to `phase:'commit'` diffs (the last diff of the commit). `removed` = covered eligible parcels whose generated building under the committed state went non-null → null, counted for paint too. | low |
| R9 | Before `init` (or after a failed init), rev requests get `error bad-request`. `parcelSummary` gets `summary: null`. `prefetch`/`retryChunks` are ignored. | none |
| R10 | Host memoises `generate` per `parcelId|maxStories` (cleared on re-init). It catches exceptions as `null` and logs once per parcel, like generator's `createGeneratorCache`. `deps.generate` is injectable for tests. | none |
| R11 | `Editor.commit(op, opts?: { datasetVersion?: string })`: the optional version triggers the defensive `rebasePlan` (§4.5). `Editor.undo()`/`redo()` return the affected `PlanOp \| null` (the spec types them `void`). A redo the editor refuses stays on the stack. | none: plan-sharing only uses load/plan/readOnly |
| R12 | Composition lives in a new `src/lib/brush/BrushEditor.svelte` (props: manifest, plan, readOnly, retry callback), so plan-sharing's `/p/:id` can reuse it. `+page.svelte` just renders it. | small |
| R13 | Paint/Erase mode uses map-view's `setPanEnabled(false)`. That also disables dragRotate and touch rotation (map-view's choice), whereas spec §4.1 keeps right-drag rotate. Not worked around. | right-drag rotate unavailable while painting |
| R14 | Status-line precedence: city-data phase (loading / failed + Retry) > transient announcement > "Loading parcels…" > "Zoom in to see the brush". | cosmetic |
| R15 | Announcement copy uses singular forms for 1 ("1 story", "1 parcel", "1 new building", "1 generated building removed", "1 not eligible"). Numbers use en-US grouping. The partial suffix also applies to the "No parcels" forms. | copy |
| R16 | A11y e2e (#6) runs two scans: desktop with the shortcuts disclosure open, and mobile (375 px) with the radius popover open. The two never coexist (the disclosure is hidden on coarse pointers; the popover is narrow-only). | none |
| R17 | `--scorebar-h` doesn't exist until scoreboard UI (W5): CSS uses `var(--scorebar-h, 0px)`, and `setBottomInset` uses 56 + the computed `--scorebar-h` (0 when unset). | small, W5 wires the sheet |
| R18 | The bench file is `src/lib/sim/host.bench.spec.ts` so the server project runs it (conductor-accepted). | none |
| R19 | The fixture-1 cellIds are `0_0`, `1_0`, `0_1`, `1_1` (`CELL_ID_RE` rejects plan-model's `q00`…), mapped from `GRID_CHUNKS` q00, q10, q01, q11. | none |
| R20 | The canvas `aria-label` (§4.8) is set by the controller on `map.getCanvas()` (MapLibre's focusable canvas). The centre crosshair is a DOM element in `BrushEditor`. | small |

## Review Focus

1. **Requests arriving before `init`, during a re-`init`, or after `manifest-invalid`:** a commit or preview with no manifest must yield `error bad-request`, not throw or post a diff. Stale fetch results from the previous manifest must never enter the new index. Pinned in Task 4 (pre-init + re-init tests) and Task 2 (dispose drops late fetches).
2. **Malformed chunk payloads:** a non-JSON body, an `sfh-parcels/1` decode error, a `cellId` or `datasetVersion` that differs from the manifest. Each must count as a failed attempt (retried, then `error`), never enter the index and never crash the host. Pinned in Task 2.
3. **A stroke that leaves SF_BBOX and comes back, or lies entirely outside it:** out-of-bbox points are dropped. A stroke with no in-bounds point creates no op, and if previews were already sent it sends `cancelPreview`. Pinned in Task 7 (sampler) and Task 10 (controller).
4. **Corrupt or hostile `localStorage['sfhousing:brush']`** (`'{"stories":"abc","radiusM":9999}'`, `'null'`, invalid JSON, a throwing getter): it must fall back to the defaults or clamp, never throw or block the toolbar. Pinned in Task 8.
5. **Mid-stroke interruptions:** window blur, a tool switch via keyboard, an Escape, Space pressed mid-stroke (ignored), and an undo shortcut mid-stroke (ignored). Each ends with no op and the preview reverted (or stroke continuing, for Space/undo). Pinned in Task 10.

---

## File structure

| file | responsibility |
|---|---|
| `src/lib/sim/protocol.ts` | I15 types: `Rev`, `SimRequest`, `DiffPhase`, `OpStats`, `SimResponse`, `ParcelSummary`, `DiffResponse` alias; compile-time `ParcelSummary → ParcelSummaryLike` assertion |
| `src/lib/sim/manifest-shape.ts` | `checkManifestShape(m: unknown): string \| null` (zod-free, worker-safe) |
| `src/lib/sim/manifest.ts` | `loadManifest` (main thread, I16) |
| `src/lib/sim/chunks.ts` | `createChunkLoader`: queue, ≤ 4 concurrent, backoff, version check, status reports |
| `src/lib/sim/display.ts` | `createDisplay`: generated buildings per cell, hide set, score accumulator, `GeneratedUpdate` emission with batching/rising |
| `src/lib/sim/host.ts` | `createSimHost`: request handling, plan, committed envelopes, preview overlay, stats, parcel summary |
| `src/lib/sim/worker.ts` | `onmessage` shell |
| `src/lib/sim/client.ts` | `SimClient` (main thread), `spawnSimWorker()` |
| `src/lib/sim/fixtures/build-fixture-1.ts`, `src/lib/sim/fixtures/data/fixture-1/**` | host test dataset |
| `src/lib/sim/test/harness.ts` | host test harness: in-memory fetch, deferred chunks, stub generate, display reconstruction |
| `src/lib/brush/sampler.ts` | `createSampler`, `BrushTool` |
| `src/lib/brush/ids.ts` | `newOpId()` (12 chars base58) |
| `src/lib/brush/editor.svelte.ts` | `Editor` store, `createEditor`, `CommitResult` |
| `src/lib/brush/shortcuts.ts` | `actionForKey`, `isEditableTarget`, `SHORTCUTS` table |
| `src/lib/brush/radius.ts` | log slider mapping, radius/stories clamp and step |
| `src/lib/brush/messages.ts` | all status-line copy |
| `src/lib/brush/settings.ts` | `readSettings`/`writeSettings` for `localStorage['sfhousing:brush']` |
| `src/lib/brush/overlay.ts` | `buildOverlayLayers`, `dashedCircle`, `metersPerPixel`, brush colours |
| `src/lib/brush/state.svelte.ts` | `BrushState` (tool, stories, radius, phase, status line) |
| `src/lib/brush/BrushToolbar.svelte` | toolbar UI |
| `src/lib/brush/BrushController.svelte.ts` | pointer/touch/pen/keyboard → sampler → preview/commit, overlay, pan mode, prefetch |
| `src/lib/brush/BrushEditor.svelte` | composition: SimMap + toolbar + controller + client + crosshair |
| `src/lib/brush/debug.ts` | `window.__sfhBrush` e2e hook (VITE_E2E only) |
| `src/routes/+page.ts`, `src/routes/+page.svelte`, `src/routes/page.svelte.spec.ts` | page wiring |
| `e2e/brush.spec.ts` | brush e2e |

---

### Task 1: Protocol types, worker-safe manifest check, `loadManifest`

**Read:** spec §2 (code block), §4.9 "Manifest (I16)", §6 `manifest.spec.ts`. Read `src/lib/data/manifest.ts`, `src/lib/map/types.ts`.

**Files:**
- Create: `src/lib/sim/protocol.ts`, `src/lib/sim/manifest-shape.ts`, `src/lib/sim/manifest.ts`
- Test: `src/lib/sim/manifest.spec.ts`, `src/lib/sim/manifest-shape.spec.ts`, `src/lib/sim/protocol.spec.ts`

**Interfaces:**
- Consumes: `Manifest`, `parseManifest`, `manifestUrl`, `CELL_ID_RE` (`$lib/data/manifest`); `DATASET_VERSION_RE` (`$lib/data/dataset-version`); `ParcelSummaryLike`, `GeneratedUpdate`, `ChunkStatus` (`$lib/map/types`); `Score` (`$lib/scoreboard`); `Plan`, `PlanOp`, `Envelope`, `BBox` (`$lib/plan`); `BuildoutMode`, `TypologyId` (`$lib/generator`).
- Produces: everything below, exactly.

- [ ] **Step 1: Write `protocol.ts`** (types only, all imports `import type`):

```ts
// The single main↔worker protocol for M1 (I15). Owned by brush-tool's worker host.
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId } from '$lib/data/parcel';
import type { BuildoutMode, TypologyId } from '$lib/generator';
import type { ChunkStatus, GeneratedUpdate, ParcelSummaryLike } from '$lib/map/types';
import type { BBox, Envelope, Plan, PlanOp } from '$lib/plan';
import type { Score } from '$lib/scoreboard';

export type Rev = number; // strictly increasing per client, starting at 1
export type SimRequest =
  | { type: 'init'; rev: Rev; manifest: Manifest; mode: BuildoutMode }
  | { type: 'load'; rev: Rev; plan: Plan }
  | { type: 'preview'; rev: Rev; op: PlanOp }
  | { type: 'cancelPreview'; rev: Rev }
  | { type: 'commit'; rev: Rev; op: PlanOp }
  | { type: 'undo'; rev: Rev; opId: string }
  | { type: 'prefetch'; bbox: BBox }
  | { type: 'retryChunks' }
  | { type: 'parcelSummary'; reqId: number; parcelId: ParcelId };
export type DiffPhase = 'load' | 'preview' | 'cancel' | 'commit' | 'undo' | 'chunk';
export interface OpStats {
  opId: string;
  kind: 'paint' | 'erase';
  stories?: number /* paint only */;
  covered: number;
  ineligible: number;
  built: number;
  notBigger: number;
  removed: number;
  partial: boolean;
}
export type SimResponse =
  | { type: 'ready'; rev: Rev; datasetVersion: string; chunkCount: number }
  | {
      type: 'diff';
      rev: Rev;
      phase: DiffPhase;
      render: GeneratedUpdate;
      stats?: OpStats;
      complete: boolean;
      score: Score;
    }
  | { type: 'chunks'; status: Record<string, ChunkStatus>; pending: number; failed: string[] }
  | { type: 'parcelSummary'; reqId: number; summary: ParcelSummary | null }
  | {
      type: 'error';
      rev: Rev;
      code: 'manifest-invalid' | 'bad-request' | 'internal';
      message: string;
    };
export type DiffResponse = Extract<SimResponse, { type: 'diff' }>;
export type ChunksResponse = Extract<SimResponse, { type: 'chunks' }>;
export type ReadyResponse = Extract<SimResponse, { type: 'ready' }>;
export type ErrorResponse = Extract<SimResponse, { type: 'error' }>;
export interface ParcelSummary {
  parcelId: ParcelId;
  neighborhood: string;
  landUse: string;
  eligible: boolean;
  existingUnits: number;
  envelope: Envelope | null; // committed-plus-preview display state
  generated: { typology: TypologyId; stories: number; units: number } | null;
}

// I17 addendum: ParcelSummary must be assignable to map-view's ParcelSummaryLike.
type Assert<T extends true> = T;
export type ParcelSummaryIsLike = Assert<ParcelSummary extends ParcelSummaryLike ? true : false>;
```

- [ ] **Step 2: Write `protocol.spec.ts`.** Use a runtime-checked typed literal so the file carries an `expect`:

```ts
import { describe, expect, it } from 'vitest';
import type { ParcelSummaryLike } from '$lib/map/types';
import type { ParcelSummary } from './protocol';

describe('protocol', () => {
  it('ParcelSummary is assignable to ParcelSummaryLike (compile-time, I17 addendum)', () => {
    const s: ParcelSummary = {
      parcelId: '3512008',
      neighborhood: 'Mission',
      landUse: 'UNKNOWN',
      eligible: true,
      existingUnits: 2,
      envelope: { maxStories: 6 },
      generated: { typology: 'plex', stories: 3, units: 2 }
    };
    const like: ParcelSummaryLike = s;
    expect(like.generated?.units).toBe(2);
  });
});
```

- [ ] **Step 3: Write failing `manifest-shape.spec.ts`.** Cases:
  - the fixture-0 manifest (`e2e/fixtures/data/fixture-0/manifest.json`) → `null`;
  - `null`, `[]`, `'x'` → message;
  - bad `datasetVersion` `'v1'`;
  - `chunks` not an array;
  - a chunk with `cellId: 'q00'`;
  - a bbox `[1, 0, 0, 1]` (w > e);
  - a bbox containing `NaN`;
  - a chunk url `/data/other/parcels/a.json`;
  - `parcelCount: -1` and `1.5`;
  - duplicate cellIds;
  - plus `expect(String(CELL_ID_RE_COPY)).toBe(String(CELL_ID_RE))` (import `CELL_ID_RE` from `$lib/data/manifest`; the test may import zod modules).

- [ ] **Step 4: Implement `manifest-shape.ts`:**

```ts
// Worker-safe structural check of an I12 manifest (no zod: the worker bundle must stay zod-free).
import { DATASET_VERSION_RE } from '$lib/data/dataset-version';

/** Copy of CELL_ID_RE in src/lib/data/manifest.ts (that module imports zod). A test pins equality. */
export const CELL_ID_RE_COPY = /^-?\d+_-?\d+$/;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** null when the manifest is usable by the host, else the first problem found. */
export function checkManifestShape(m: unknown): string | null {
  if (!isObj(m)) return 'manifest is not an object';
  const v = m.datasetVersion;
  if (typeof v !== 'string' || !DATASET_VERSION_RE.test(v)) return 'bad datasetVersion';
  if (!Array.isArray(m.chunks)) return 'chunks is not an array';
  const prefix = `/data/${v}/`;
  const seen = new Set<string>();
  for (let i = 0; i < m.chunks.length; i++) {
    const c: unknown = m.chunks[i];
    if (!isObj(c)) return `chunks.${i} is not an object`;
    if (typeof c.cellId !== 'string' || !CELL_ID_RE_COPY.test(c.cellId))
      return `chunks.${i}.cellId is invalid`;
    if (seen.has(c.cellId)) return `chunks.${i}.cellId is a duplicate`;
    seen.add(c.cellId);
    const b = c.bbox;
    if (
      !Array.isArray(b) ||
      b.length !== 4 ||
      !b.every((x) => typeof x === 'number' && Number.isFinite(x)) ||
      b[0] > b[2] ||
      b[1] > b[3]
    )
      return `chunks.${i}.bbox is invalid`;
    if (typeof c.url !== 'string' || !c.url.startsWith(prefix)) return `chunks.${i}.url is invalid`;
    if (typeof c.parcelCount !== 'number' || !Number.isInteger(c.parcelCount) || c.parcelCount < 0)
      return `chunks.${i}.parcelCount is invalid`;
  }
  return null;
}
```

- [ ] **Step 5: Write failing `manifest.spec.ts`** (Node, fake `fetchFn` recording URLs; build manifests by cloning fixture-0's JSON with `datasetVersion` and every url rewritten for `fixture-7` etc.). Cases:
  1. plan version present → `{ manifest (plan's), fellBack: false }`, one fetch of `/data/fixture-7/manifest.json`;
  2. plan 404 → fetches current, `fellBack: true`;
  3. plan === current, 404 → rejects (one fetch);
  4. 5xx on the plan version → rejects, with no fallback fetch;
  5. double 404 → rejects;
  6. network error (fetch throws) → rejects;
  7. invalid JSON / schema-invalid manifest → rejects (`ManifestError`);
  8. a manifest whose `datasetVersion` ≠ requested → rejects;
  9. invalid `planVersion` (`'nope'`) → fetches current directly, `fellBack: true`;
  10. invalid `currentVersion` → rejects without fetching.

- [ ] **Step 6: Implement `manifest.ts`:**

```ts
// Main-thread I16 loader. Its result goes to both map-view (SimMap) and the worker host (init).
import { DATASET_VERSION_RE } from '$lib/data/dataset-version';
import { manifestUrl, parseManifest, type Manifest } from '$lib/data/manifest';

type FetchFn = (url: string) => Promise<Response>;

async function fetchManifest(version: string, fetchFn: FetchFn): Promise<Manifest | 404> {
  const res = await fetchFn(manifestUrl(version));
  if (res.status === 404) return 404;
  if (!res.ok) throw new Error(`manifest ${version}: HTTP ${res.status}`);
  const m = parseManifest(await res.json());
  if (m.datasetVersion !== version)
    throw new Error(`manifest ${version}: datasetVersion is ${m.datasetVersion}`);
  return m;
}

/**
 * Fetches /data/${planVersion}/manifest.json; on 404 fetches /data/${currentVersion}/manifest.json
 * (fellBack: true). Any other failure (network, 5xx, invalid, both 404) rejects.
 */
export async function loadManifest(
  planVersion: string,
  currentVersion: string,
  fetchFn: FetchFn = (u) => fetch(u)
): Promise<{ manifest: Manifest; fellBack: boolean }> {
  if (!DATASET_VERSION_RE.test(currentVersion))
    throw new Error(`invalid current datasetVersion ${JSON.stringify(currentVersion)}`);
  if (DATASET_VERSION_RE.test(planVersion)) {
    const own = await fetchManifest(planVersion, fetchFn);
    if (own !== 404) return { manifest: own, fellBack: false };
    if (planVersion === currentVersion) throw new Error(`manifest ${planVersion}: HTTP 404`);
  }
  const cur = await fetchManifest(currentVersion, fetchFn);
  if (cur === 404) throw new Error(`manifest ${currentVersion}: HTTP 404`);
  return { manifest: cur, fellBack: true };
}
```

- [ ] **Step 7: Run** `npx vitest --run --project server src/lib/sim` and `npm run check`. Expect PASS and 0 errors.
- [ ] **Step 8: Commit** `feat(sim): add I15 protocol types, worker-safe manifest check and loadManifest`.

---

### Task 2: Chunk loader (`chunks.ts`)

**Read:** spec §4.9 "Chunk loading" and §6 host test (d). Read `src/lib/data/parcel-chunk.ts`.

**Files:**
- Create: `src/lib/sim/chunks.ts`
- Test: `src/lib/sim/chunks.spec.ts`

**Interfaces:**
- Consumes: `Manifest` (type), `ParcelRecord`, `decodeParcelChunk`, `ChunkStatus`, `ChunksResponse` (Task 1).
- Produces:

```ts
export interface FetchLike {
  (url: string): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
}
export interface ChunkLoaderDeps {
  fetch: FetchLike;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  retryDelaysMs: readonly number[]; // [1000, 4000, 16000] in production
  maxConcurrent: number; // 4
  /** Called once per chunk, after its status is already 'ready'. */
  onLoaded(cellId: string, records: ParcelRecord[]): void;
  /** Called on every change of any chunk's mapped ChunkStatus. */
  onReport(r: Omit<ChunksResponse, 'type'>): void;
}
export interface ChunkLoader {
  /** Queues every listed cell that is idle (unknown cellIds are ignored). */
  want(cellIds: Iterable<string>): void;
  /** Failed cells start a fresh retry cycle. */
  retryFailed(): void;
  isReady(cellId: string): boolean;
  /** Stops timers; results of in-flight fetches are dropped. */
  dispose(): void;
}
export function createChunkLoader(manifest: Manifest, deps: ChunkLoaderDeps): ChunkLoader;
/** cellIds whose manifest bbox intersects bbox ([w,s,e,n], inclusive), manifest order. */
export function cellsIntersecting(manifest: Manifest, bbox: readonly number[]): string[];
```

Internal per-cell state: `idle | queued | fetching | waiting | ready | failed` plus an `attempt` counter. It maps to `ChunkStatus`:
- `queued`/`fetching`/`waiting` → `'loading'`
- `ready` → `'ready'`
- `failed` → `'error'`
- `idle` is not reported

Each attempt does the following:
1. `fetch(chunk.url)`.
2. `!ok` → fail.
3. `await json()`. A throw → fail.
4. The raw value must be an object with `datasetVersion === manifest.datasetVersion` and `cellId === cellId`, else fail.
5. `decodeParcelChunk(raw)`. A throw → fail.
6. On success the state becomes `ready`, then a report goes out, then `onLoaded` runs. If `onLoaded` throws, the exception is caught and logged; the chunk stays ready.

On failure after attempt `k` (0-based): if `k < retryDelaysMs.length`, the state becomes `waiting` and `setTimeout(retryDelaysMs[k])` re-queues it. Otherwise the state becomes `failed`. That gives 1 initial fetch plus 3 retries, then `error`.

`pump()` starts queued cells in `want` order while `fetching < maxConcurrent`. A report contains:
- `status`: every cell whose mapped status changed since the last report, plus every cell currently `loading` or `error`.
- `pending`: the count of `loading` cells.
- `failed`: the sorted `error` cellIds.

A `disposed` flag (or generation token) makes late fetch results no-ops.

- [ ] **Step 1: Write failing tests** (`vi.useFakeTimers()`; a fake fetch built from a `Map<url, () => Promise<…>>`; build chunk bodies with `encodeParcelChunk('fixture-1', cellId, records)` + `JSON.parse`, using `GRID_CHUNKS` records from `$lib/plan/fixtures/grid-20x20`; a small two- or five-chunk manifest object written in-test):
  - `want` fetches each wanted chunk once. Wanting it again while loading or ready does not refetch.
  - At most 4 fetches are in flight: want 6 chunks with never-resolving fetches → 4 calls; resolving one → a 5th starts.
  - Backoff on the real schedule. With an always-failing chunk: fetch #1; after 999 ms no new fetch; at 1000 ms fetch #2; at +4000 #3; at +16000 #4. Then a report with `failed: [cellId]`, `status[cellId] === 'error'`, `pending: 0`, and no further fetch even after 60 s.
  - `retryFailed()` starts a new cycle (fetch #5 immediately) and the status goes back to `'loading'`.
  - A chunk whose body has `datasetVersion: 'fixture-9'` counts as a failure (retried). So do a `cellId` mismatch, `json()` throwing, and `{ format: 'nope' }`. `onLoaded` is never called for them.
  - On success, `onLoaded(cellId, records)` gets the decoded records, and `isReady` is already true inside `onLoaded`.
  - The reports sequence for one successful chunk is `[{status:{c:'loading'},pending:1,failed:[]}, {status:{c:'ready'},pending:0,failed:[]}]`.
  - After `dispose()`, resolving an in-flight fetch calls neither `onLoaded` nor `onReport`, and pending retry timers are cleared (`vi.getTimerCount() === 0`).
  - `cellsIntersecting` handles inclusive edges and returns manifest order.
- [ ] **Step 2: Run, verify FAIL.** `npx vitest --run --project server src/lib/sim/chunks.spec.ts`
- [ ] **Step 3: Implement `chunks.ts`** per the description above.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** `feat(sim): add chunk loader with bounded concurrency, backoff and version check`.

---

### Task 3: Display state and render diffs (`display.ts`)

**Read:** spec §4.9 "Diffs", "Generation", "Score". Read map-view spec §4.4–§4.5 (`docs/superpowers/specs/2026-10-10-map-view-design.md`, on `rising` and revision 0), `src/lib/map/pack.ts`, `src/lib/map/types.ts` (`GeneratedUpdate` doc comment) and `src/lib/scoreboard/accumulator.ts`.

**Files:**
- Create: `src/lib/sim/display.ts`
- Test: `src/lib/sim/display.spec.ts`

**Interfaces:**
- Consumes: `packCell`, `packTransferables` (`$lib/map/pack`); `GeneratedUpdate`, `PackedCell` (types); `createScoreAccumulator`, `Target`, `Score` (`$lib/scoreboard`); `ParcelRecord`, `ParcelId`; `Envelope`; `GeneratedBuilding`; `DiffPhase`, `OpStats`, `DiffResponse` (Task 1).
- Produces:

```ts
export interface DisplayDeps {
  record(id: ParcelId): ParcelRecord | undefined;
  cellOf(id: ParcelId): string | undefined;
  /** Memoised generate (host supplies it): same inputs → same object. */
  build(rec: ParcelRecord, env: Envelope): GeneratedBuilding | null;
  targets: readonly Target[];
  post(msg: DiffResponse, transfer: ArrayBuffer[]): void;
  batchParcels: number; // 5000
}
export interface UpdateMeta {
  rev: number;
  phase: DiffPhase;
  stats?: OpStats; // attached to the last diff of this update only
  complete(): boolean; // evaluated per diff
}
export interface Display {
  /** Envelope currently rendered for id (null = none). */
  renderedEnv(id: ParcelId): Envelope | null;
  building(id: ParcelId): GeneratedBuilding | null;
  /**
   * Re-derives each id's building from envFor(id), in ascending cell then id order, applying
   * changes to the accumulator and hide set, and posts ≥ 1 diff (an empty one when nothing changed).
   */
  update(ids: Iterable<ParcelId>, envFor: (id: ParcelId) => Envelope | null, meta: UpdateMeta): void;
  /** Forget everything; the next update's first diff is a revision-0 snapshot. */
  reset(): void;
  readonly revision: number; // last revision posted, -1 before any
}
export function createDisplay(deps: DisplayDeps): Display;
```

Algorithm (implement exactly):

```
state: renderedEnv Map<id, Envelope>; buildings Map<cellId, Map<id, GeneratedBuilding>>;
       hidden Set<id>; acc = createScoreAccumulator(targets); sentCells Set<cellId>;
       revision = -1; snapshotNext = true (after reset/creation)

update(ids, envFor, meta):
  byCell: Map<cellId, id[]> from unique ids with record && cellOf; sort cells with `<`, ids with `<`
  batch = { cells: Map<cellId, Set<id> /*rising ids*/>, count: 0, hideAdd: [], hideRemove: [] }
  for cell of cells:
    pending = ids of cell whose envFor(id) differs from renderedEnv (maxStories compare; null≠env)
    if pending.length === 0: continue
    if batch.count > 0 && batch.count + pending.length > batchParcels: flush(batch, meta, false)
    for id of pending:
      env = envFor(id); prev = building(id); next = env ? build(rec, env) : null
      env ? renderedEnv.set(id, env) : renderedEnv.delete(id)
      if (next === prev) continue                       // memo makes equal inputs identical
      store next in buildings[cell] (delete when null; drop empty cell maps); acc.set(rec, next)
      if prev?.replacesExisting && !next?.replacesExisting: hidden.delete(id); hideRemove.push(id)
      if next?.replacesExisting && !prev?.replacesExisting: hidden.add(id); hideAdd.push(id)
      touch cell; if next && (!prev || maxTop(next) > maxTop(prev)) rising(cell).add(id)
    batch.count += pending.length
  flush(batch, meta, true)        // always: guarantees ≥ 1 diff per update (R4)

flush(batch, meta, last):
  snapshot = snapshotNext; snapshotNext = false; revision = snapshot ? 0 : revision + 1
  for each touched cell (sorted): items = buildings[cell] → PackInput {building, existingUnits: rec.existingUnits}
    if none: if (!snapshot && sentCells.delete(cell)) removedCells.push(cell)
    else if snapshot: cells.push({ settled: packCell(cell, all), rising: null }); sentCells.add
    else: risingIds = batch rising(cell); settled = items not in risingIds; rising = items in risingIds
          cells.push({ settled: packCell(cell, settled), rising: rising.length ? packCell(cell, rising) : null })
          sentCells.add(cell)
  hide = snapshot ? { add: [...hidden-in-this-batch's cells…] } — see note — : { add: hideAdd, remove: hideRemove }
  post({ type:'diff', rev: meta.rev, phase: meta.phase, render: {revision, cells, removedCells, hide},
         ...(last && meta.stats ? { stats: meta.stats } : {}), complete: meta.complete(), score: acc.snapshot() },
       transfer = all packs' packTransferables)
  reset batch (cells, count, hide lists)
```

Note on snapshots: after `reset()` every rendered state is empty, so the hideAdd list of the first batch is exactly that batch's hidden set and `remove` is `[]`. Use the batch lists as-is; the snapshot flag only changes the revision number, the settled-only packing and the omission of `removedCells`. `reset()` clears `renderedEnv`, `buildings`, `hidden`, `acc.clear()` and `sentCells`, and sets `snapshotNext = true`. It does **not** post.

- [ ] **Step 1: Write failing tests.** Use a fake `record`/`cellOf` over a handful of hand-made records in two cells, a stub `build` (units = maxStories when > 2, else null; one square part with topM = 3.1 × maxStories; `replacesExisting: true`; typology `'midrise'`), memoised in-test, and a recording `post`. Cases:
  - The first update after creation posts revision 0. Its cells are all `rising: null`, `removedCells: []`, and `hide.add` holds the built ids (ascending).
  - The second update posts revision 1. A new parcel goes in `rising`. Raising a parcel's stories puts it in `rising`. Lowering it (still built) puts it in `settled` only.
  - A parcel whose build becomes `null` leaves its cell's pack and appears in `hide.remove`. When it was the cell's last building, the cell is in `removedCells` (only if the cell had been sent).
  - An update with no changes posts exactly one diff with an empty render and revision +1.
  - Batching with `batchParcels: 3` over two cells of 2 and 3 changed parcels: two diffs. Revisions are consecutive, each cell is whole, `stats` is only on the second, and each diff's `score` equals `score(entries so far, targets)` from `$lib/scoreboard`.
  - A single cell with more changes than `batchParcels` is one diff.
  - `reset()` posts nothing, and the next update is revision 0 again.
  - Transfer list: every typed array buffer of every posted pack is in `transfer`.
  - Packs list parcels in ascending id order (assert `parcelIds`).
  - `renderedEnv` and `building` reflect the latest state.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement `display.ts`.**
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** `feat(sim): add display state with packed render diffs, batching and score`.

---

### Task 4: Worker host core (`host.ts`): init, load, commit, undo, chunks, summaries

**Read:** spec §4.9 (all), §4.10, §6 `host.spec.ts`. Read `src/lib/plan/resolve.ts`, `src/lib/plan/parcel-index.ts`, `src/lib/plan/schema.ts` (`validatePlan`), `src/lib/plan/fixtures/grid-20x20.ts` and `src/lib/generator/cache.ts`.

**Files:**
- Create: `src/lib/sim/host.ts`, `src/lib/sim/fixtures/build-fixture-1.ts`, `src/lib/sim/fixtures/data/fixture-1/manifest.json`, `src/lib/sim/fixtures/data/fixture-1/parcels/{0_0,1_0,0_1,1_1}.json`, `src/lib/sim/test/harness.ts`
- Test: `src/lib/sim/host.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–3; `createParcelIndex`, `resolveEnvelopes`, `applyOp`, `resolveParcels`, `resolveChunk`, `opBBox`, `validatePlan`, `emptyPlan`, `type EnvelopeMap` (`$lib/plan`); `generate`, `fnv1a32` (`$lib/generator`); `M1_TARGETS` (`$lib/scoreboard`).
- Produces:

```ts
export interface SimHostDeps {
  fetch: FetchLike; // from chunks.ts
  post(msg: SimResponse, transfer: ArrayBuffer[]): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  generate?: typeof generate; // default: $lib/generator generate
  targets?: readonly Target[]; // default M1_TARGETS
  retryDelaysMs?: readonly number[]; // default [1000, 4000, 16000]
  maxConcurrent?: number; // default 4
  batchParcels?: number; // default 5000
}
export interface SimHost {
  handle(req: SimRequest): void;
  dispose(): void;
}
export function createSimHost(deps: SimHostDeps): SimHost;
export const DEFAULT_RETRY_DELAYS_MS: readonly number[]; // [1000, 4000, 16000]
```

Host state and request handling (implement exactly; preview is completed in Task 5, but declare its state now):

```
state (per init; all rebuilt on init):
  manifest | null; version; mode; index = createParcelIndex(); cellOf Map<id, cellId>;
  plan: Plan (host copy, ops array owned by host); opIds Set<string>;
  committed: EnvelopeMap; preview: { op: PlanOp; env: Map<id, Envelope | null> } | null;
  memo Map<string, GeneratedBuilding | null> (key `${id}|${maxStories}`), logged Set<id>;
  display = createDisplay({...}); loader = createChunkLoader(manifest, {...}); latestRev = 0;
  opCells WeakMap<PlanOp, string[]> (cellsIntersecting(manifest, opBBox(op)))

envFor(id) = preview && preview.env.has(id) ? preview.env.get(id)! : committed.get(id) ?? null
build(rec, env): memo; generate(rec, env, fnv1a32(rec.id), mode); exceptions → null, logged once (R10)
neededCells() = union of opCells over plan.ops (+ preview.op)
complete() = every neededCells() cell loader.isReady

handle(req): latestRev = max(latestRev, req.rev ?? latestRev); try { dispatch } catch (e) →
  post error 'internal' (rev = req.rev ?? latestRev, message = String(e))

init: problem = checkManifestShape(req.manifest) → post error 'manifest-invalid' (state unchanged
  if never inited; if previously inited, drop to un-inited). Else dispose old loader, rebuild
  all state for the new manifest (plan = emptyPlan(version) — version already regex-checked),
  post { type:'ready', rev, datasetVersion, chunkCount: manifest.chunks.length }.
not inited + rev request → error 'bad-request' "not initialised"; parcelSummary → summary null;
  prefetch / retryChunks → ignored (R9)

load(plan): v = validatePlan(plan) → !ok: error bad-request (message = first error). Do NOT
  compare plan.datasetVersion with the manifest's (conductor ruling: render on manifest data).
  plan = { ...v.value, ops: v.value.ops.slice() }; opIds = ids; preview = null;
  committed = resolveEnvelopes(plan, index); loader.want(neededCells()); display.reset();
  display.update(committed.keys(), envFor, { rev, phase:'load', complete })

commit(op): check(op) [Task 5 adds promotion + stats]; applyOp(committed, op, index);
  plan.ops.push(op); opIds.add(op.id); touched = coverage.eligible ∪ (preview?.env.keys());
  preview = null; loader.want(opCells(op)); display.update(touched, envFor,
  { rev, phase:'commit', stats, complete })
  check(op) = validatePlan({ schema:1, datasetVersion: version, ops:[op] }).ok && !opIds.has(op.id)
  else error bad-request (no state change)

undo(opId): last = plan.ops.at(-1); if !last || last.id !== opId → error bad-request.
  plan.ops.pop(); opIds.delete(opId); ids = index.covered(last).filter(eligible);
  for [id, env] of resolveParcels(plan.ops, index, ids): env ? committed.set : committed.delete;
  display.update(ids, envFor, { rev, phase:'undo', complete })

prefetch(bbox): loader.want(cellsIntersecting(manifest, bbox))
retryChunks: loader.retryFailed()

parcelSummary: rec = index.get(id) → null if absent (no fetch) else
  { parcelId, neighborhood, landUse, eligible, existingUnits, envelope: envFor(id),
    generated: b ? { typology, stories, units } : null } with b = display.building(id)

loader.onLoaded(cellId, records): ids = index.addChunk(cellId, records); ids → cellOf;
  for [id, env] of resolveChunk(plan, index, ids): if env committed.set(id, env)
  if preview: covered = new Set(index.covered(preview.op)); value = written(preview.op);
    for id of ids if covered.has(id) && eligible: preview.env.set(id, value)
  display.update(ids, envFor, { rev: latestRev, phase:'chunk', complete })
loader.onReport(r) → post { type:'chunks', ...r }
```

`written(op)` for the preview: `op.kind === 'paint' ? { maxStories: op.stories } : null`. Use a `switch` with an exhaustive `never` default, matching plan-model's seam.

**fixture-1:** `build-fixture-1.ts` (run once via `npx tsx src/lib/sim/fixtures/build-fixture-1.ts`) writes `encodeParcelChunk('fixture-1', cellId, records)` for each `GRID_CHUNKS` entry, mapped `q00→0_0`, `q10→1_0`, `q01→0_1`, `q11→1_1` (R19). It also writes a manifest that passes `parseManifest`: `builtAt '2026-10-10T00:00:00.000Z'`, `sources: []`, and `buildingsTiles`/`basemapTiles`/`glyphs`/`neighborhoods` under `/data/fixture-1/`. Each chunk's `bbox` is the min/max of its label points padded by 1e-6, its `url` is `/data/fixture-1/parcels/<cellId>.json`, and its `parcelCount` is 100. Commit the generated JSON. Add a test that `parseManifest(fixture)` succeeds.

**Harness (`src/lib/sim/test/harness.ts`):**

```ts
export interface Harness {
  host: SimHost;
  sent: SimResponse[];
  fetches: string[];
  /** 'auto': every fetch resolves on the next microtask; 'manual': resolve(cellId) releases it. */
  release(cellId: string): void;
  fail(cellId: string, times: number): void; // next `times` fetches of cellId fail with 500
  flush(): Promise<void>; // await a few macrotask turns so fetch→json→onLoaded completes
  next(): number; // next rev, starting at 1
  diffs(): DiffResponse[];
  display(): Reconstructed; // reconstructed from every render in order
}
export interface Reconstructed {
  parcels: Map<string, { cellId: string; units: number; existingUnits: number; stories: number; typology: number }>;
  hidden: Set<string>;
}
export function makeHarness(opts?: {
  mode?: 'auto' | 'manual';
  generate?: SimHostDeps['generate'];
  retryDelaysMs?: readonly number[];
  batchParcels?: number;
}): Harness;
export function stubGenerate(p: ParcelRecord, env: Envelope): GeneratedBuilding | null; // units = maxStories when > 2, else null
export function reconstruct(updates: GeneratedUpdate[]): Reconstructed;
export function serialise(r: Reconstructed): string; // sorted, for deep comparison
export const FIXTURE_1: { manifest: Manifest; chunks: Record<string, unknown> }; // read via fs from fixtures/data/fixture-1
```

`reconstruct` applies updates in order:
- revision 0 clears everything.
- For each cell, it replaces the cell's parcels with the union of the `settled` and `rising` packs, decoded from `parcelMeta` as `[units, existingUnits, stories, typologyIdx]` per slot.
- `removedCells` deletes cells.
- `hide.add`/`remove` update the hidden set.
- It asserts each revision is exactly previous + 1, or 0.

`stubGenerate` returns a building with one 4-vertex square part around the label point, `topM = 3.1 × maxStories`, `stories = maxStories`, `units = maxStories`, `replacesExisting: true`, typology `'midrise'`. `makeHarness` defaults to `generate: (p, e) => stubGenerate(p, e)`, ignoring seed and mode.

- [ ] **Step 1: Build fixture-1** with the script; add `src/lib/sim/fixtures/fixture-1.spec.ts` asserting `parseManifest` passes and every chunk decodes to 100 records.
- [ ] **Step 2: Write failing `host.spec.ts` tests** for this task. Each test does init → `ready`, then `load` an empty plan → one revision-0 empty diff, unless stated otherwise.
  - **init:**
    - `ready` carries `datasetVersion: 'fixture-1'` and `chunkCount: 4`.
    - A manifest with `chunks: 'x'` → `error manifest-invalid`.
    - A rev request before init → `error bad-request`, `parcelSummary` → `summary: null`, and no throw.
    - A re-init with another manifest (`fixture-2`, built in-test by rewriting the urls) drops the index: a `parcelSummary` for a fixture-1 parcel → null. A fixture-1 fetch resolving after the re-init is ignored (manual mode).
  - **load:**
    - A plan with one paint op over the grid triggers fetches only of the intersecting chunk urls.
    - After `flush()` the reconstructed display equals the direct computation: for every eligible covered parcel, `stubGenerate(record, env)` from `resolveEnvelopes(plan, gridIndex())`.
    - A load whose plan has `datasetVersion: 'fixture-0'` (≠ manifest) is accepted and renders the same as with `'fixture-1'` (conductor ruling).
  - **load on unloaded chunks:**
    - The first load's diff has `complete: false`. After `flush()` the `phase:'chunk'` diffs bring the buildings, the last has `complete: true`, and its rev is the latest rev.
  - **commit (no preview):**
    - A paint covering known grid parcels → the `phase:'commit'` diff adds exactly those built parcels.
    - A duplicate op id → `error bad-request`, with no diff and no state change.
    - An op with `radiusM: 4.5` → bad-request.
  - **(b) undo:**
    - commit A, commit B, undo B → the display equals a fresh harness after `load(plan with only A)`.
    - Undo of a non-last opId → `error bad-request` (**(f)**).
  - **(i):** `render.revision` is gap-free across load/commit/undo/chunk, and a second `load` (resync) yields revision 0.
  - **(j):** `parcelSummary` for a loaded parcel returns its record fields, the current envelope and `generated: {typology:'midrise', stories, units}`. A parcel in an unloaded chunk → `null` and `fetches` does not grow. A landUse `'UNKNOWN'` record (patch one record in-test via a custom chunk) passes through verbatim.
  - **(h):** for every diff in every test, `diff.score` equals `score(entries, M1_TARGETS)`. Entries are rebuilt from the reconstructed display at that point: `[record, stubGenerate(record, {maxStories: stories})]`. Put this in a helper `assertScores(h)` called at the end of each test. Compare `targets` by `target.id` + `fraction`.
  - **(d)** at host level: one chunk that always fails, on the default delays, with fake timers. `chunks` messages show `'loading'`, then after 1 s + 4 s + 16 s exactly 4 fetches and `failed: [cellId]`. `retryChunks` → fetch #5 and `'loading'`.
- [ ] **Step 3: Run, verify FAIL.** `npx vitest --run --project server src/lib/sim/host.spec.ts`
- [ ] **Step 4: Implement `host.ts`.**
- [ ] **Step 5: Run, verify PASS**, then `npm run check`.
- [ ] **Step 6: Commit** `feat(sim): add worker host core with chunk-driven resolution and fixture-1`.

---

### Task 5: Host preview, promotion, stats and properties

**Read:** spec §4.5 (all), §4.9 "Ordering", §6 host (a), (c), (e), (g) and the fast-check line.

**Files:**
- Modify: `src/lib/sim/host.ts`
- Test: `src/lib/sim/host.spec.ts` (extend), `src/lib/sim/host.property.spec.ts`

**Interfaces:**
- Consumes: Task 4 host internals; `arbGridOps` (`$lib/plan/fixtures/arbitraries`); fast-check.
- Produces: the complete `preview`/`cancelPreview`/`commit` semantics:

```
preview(op): if !validOp(op) (shape only; duplicate ids allowed for previews) → error bad-request.
  value = written(op); env = new Map(); for id of index.covered(op): if eligible env.set(id, value)
  touched = (preview?.env.keys() ∪ env.keys()); preview = { op, env }; loader.want(opCells(op));
  display.update(touched, envFor, { rev, phase:'preview', complete })

cancelPreview: touched = preview?.env.keys() ?? []; preview = null;
  display.update(touched, envFor, { rev, phase:'cancel', complete })   // always one diff

commit(op) (replaces Task 4's body after check):
  promoted = preview !== null && deepEqual(preview.op, op)     // structural: kind, id, radiusM,
                                                                 // stories, path points
  before = new Map(id → committed.get(id) ?? null) for id of covered eligible  // via applyOp result
  { changes, coverage } = applyOp(committed, op, index)
  touched = coverage.eligible ∪ preview?.env.keys(); preview = null
  stats = computeStats(op, coverage, changes)
  plan.ops.push(op) ...; display.update(touched, ..., { phase:'commit', stats })
  (promotion needs no special path: after a matching preview the rendered envelopes already
   equal the committed ones, so display.update generates nothing and posts an empty diff)

computeStats(op, coverage, changes):
  beforeOf(id) = changes.find(id)?.before ?? committed.get(id) ?? null   (use a Map from changes)
  for id of coverage.eligible: after = committed.get(id) ?? null; bAfter = after ? build(rec, after) : null
    bBefore = beforeOf(id) ? build(rec, beforeOf(id)) : null
    if paint: bAfter ? built++ : notBigger++
    if bBefore && !bAfter: removed++
  return { opId, kind, ...(paint ? { stories } : {}), covered: eligible.length,
           ineligible: coverage.ineligible.length, built, notBigger, removed,
           partial: opCells(op).some(c => !loader.isReady(c)) }
```

- [ ] **Step 1: Write failing tests** (extend `host.spec.ts`):
  - **(a)** Preview P (op X), then commit X, gives the same reconstructed display as a fresh harness committing X alone. The commit diff after a matching preview has an empty render (`cells: []`, `removedCells: []`, empty hide).
  - Preview X, then commit Y (Y ≠ X): the display equals commit Y alone.
  - **(e)** Stale previews are superseded. preview A then preview B (disjoint areas): the display shows only B's buildings. Then `cancelPreview` gives the committed display. The cancel diff's phase is `'cancel'`. A `cancelPreview` with no preview still posts one diff.
  - **(g)** stats on a hand-checked stroke. Pick a stamp at `gridLngLat(5, 5)` with `radiusM: 10` and stories 6. `index.covered` gives the 5 parcels (centre + 4 neighbours at 10 m, inclusive) minus the ineligible ones (`n % 7 === 0`). Compute expected counts in the test from `gridRecord(i, j).eligible` with an explicit list of the 5 (i, j), so the test states its arithmetic. Assert `stats` deep-equals `{ opId, kind:'paint', stories: 6, covered, ineligible, built: covered, notBigger: 0, removed: 0, partial: false }`.
  - A paint with stories 2 (stub returns null) over a parcel previously at 6 → `notBigger` counts it and `removed` is 1.
  - An erase over the same → `stats` has **no `stories` key** (`expect('stories' in stats).toBe(false)`), `removed` = the previously built count, and `built: 0`.
  - A commit while the covered chunk is unloaded → `partial: true`. After flush the chunk diff fills it.
  - **(c)** Chunk arrival order. Manual mode, plan with ops spanning all 4 chunks. For each of a few permutations of `release()` order, the final display is identical. Also: preview over chunk `1_1` while it is unloaded → release it → the chunk diff includes the preview's buildings → `cancelPreview` → those buildings disappear and the committed buildings remain.
- [ ] **Step 2: Write `host.property.spec.ts`** (fast-check, `numRuns: 30`, ops from `arbGridOps(6)`, auto mode, default stub generate). The fixture has 4 chunks over the grid; `arbGridOps` stays within ±30 m of it.
  - **P-a:** for any ops, `ops.forEach(op => { preview(op); commit(op) })` ≡ `ops.forEach(commit)` (serialised reconstructions equal).
  - **P-b:** commit all, then undo the last k (k ≤ ops.length) ≡ fresh `load({ ops: ops.slice(0, n - k) })`.
  - **P-c:** in manual mode, `load(plan)` then release the chunks in a random permutation (`fc.shuffledSubarray` of all 4, full length) ≡ auto-mode `load(plan)` after flush.
  - Each property also runs `assertScores`.
- [ ] **Step 3: Run, verify FAIL; implement; run, verify PASS.**
- [ ] **Step 4: Commit** `feat(sim): add preview overlay, commit promotion and op stats to the worker host`.

---

### Task 6: Worker shell, main-thread client, host bench

**Read:** spec §1 (worker creation), §4.9 "Ordering"/"Errors", §6 `host.bench.ts` (as amended by the conductor ruling). Read `src/lib/plan/resolve.bench.spec.ts` and `src/lib/generator/fixtures/synth.ts`.

**Files:**
- Create: `src/lib/sim/worker.ts`, `src/lib/sim/client.ts`, `src/lib/sim/host.bench.spec.ts`
- Modify: `vite.config.ts` (add `worker: { format: 'es' }` if `npm run build` fails without it; verify)
- Test: `src/lib/sim/client.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces:

```ts
// client.ts
export interface WorkerLike {
  postMessage(msg: SimRequest): void;
  onmessage: ((e: { data: SimResponse }) => void) | null;
  terminate(): void;
}
export interface SimClientEvents {
  onReady?(r: ReadyResponse): void;
  onDiff?(d: DiffResponse): void;
  onChunks?(c: ChunksResponse): void;
  onError?(e: ErrorResponse): void;
}
export class SimClient {
  constructor(worker: WorkerLike, events: SimClientEvents, getPlan: () => Plan);
  readonly datasetVersion: string | null; // from the latest ready
  init(manifest: Manifest, mode?: BuildoutMode): Rev;
  load(plan: Plan): Rev;
  preview(op: PlanOp): Rev;
  cancelPreview(): Rev;
  commit(op: PlanOp): Rev;
  undo(opId: string): Rev;
  prefetch(bbox: BBox): void;
  retryChunks(): void;
  parcelSummary(parcelId: ParcelId): Promise<ParcelSummary | null>;
  /** map-view onResyncNeeded and bad-request both call this; one load per episode. */
  resync(): void;
  /** True for a preview diff older than the latest commit/cancelPreview/undo/load (R5). */
  isStalePreview(d: DiffResponse): boolean;
  dispose(): void; // terminates; pending summaries resolve null
}
export function spawnSimWorker(): Worker; // new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
```

Client semantics:
- `rev` starts at 1 and increments per rev request.
- `barrierRev` = the rev of the latest commit/cancelPreview/undo/load/init.
- **Resync latch:** `resync()` does nothing if `resyncRev !== null`. Otherwise it sets `resyncRev = load(getPlan())`. The latch clears on a `diff` with `phase === 'load' && rev >= resyncRev`, or on an `error` with `rev >= resyncRev`.
- An `error` with `code === 'bad-request'` calls `resync()` after `onError`.
- `parcelSummary` uses `reqId` ++ and a `Map<reqId, resolve>`.
- A `ready` response sets `datasetVersion`.
- `init()` clears the latch.

`worker.ts`:

```ts
// Thin shell: all behaviour lives in createSimHost (tested in Node).
import { createSimHost } from './host';
import type { SimRequest, SimResponse } from './protocol';

interface Scope {
  postMessage(msg: SimResponse, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<SimRequest>) => void) | null;
}
const scope = self as unknown as Scope;
const host = createSimHost({
  fetch: (url) => fetch(url),
  post: (msg, transfer) => scope.postMessage(msg, transfer),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  // Conductor ruling: production keeps 1/4/16 s; only the e2e build shortens it.
  retryDelaysMs: import.meta.env.VITE_E2E === '1' ? [50, 100, 200] : undefined
});
scope.onmessage = (e) => host.handle(e.data);
```

Bench (`host.bench.spec.ts`, timeouts 120 s):
- Build a 150,360-parcel city: plan-model's grid (420 × 358 over `W=-122.51, E=-122.36, S=37.71, N=37.81`, 16 × 16 cells, cellId `${ci}_${cj}`). Each record's polygon/area/units/floor area/height come from `synthParcels(150_360, 42)[n].parcel`, with `labelPoint` replaced by the grid point and `eligible: n % 7 !== 0`.
- Encode each cell with `encodeParcelChunk('fixture-9', …)` then `JSON.parse` (untimed setup).
- Write a manifest object with exact bboxes.
- Use an in-memory fetch, the real `generate`, `packCell` and `M1_TARGETS`, and real timers.
- Load all chunks first: init, then `prefetch([W,S,E,N])`, and await until a `chunks` message has `pending: 0`.
- **(a)** Commit a paint stamp at the city centre with stories 6 and a radius chosen so that 450–550 eligible parcels are covered (start with `radiusM: 390`; assert the range on `stats.covered`). Measure from `handle(commit)` to the post of the `phase:'commit'` diff (`performance.now()` inside `post`). Assert ≤ 100 ms (median of 3 different stamps, after one warm-up).
- **(b)** `load` a plan whose single paint op (radius 500, stories 6) zigzags across the whole bbox in rows ≤ 900 m apart (so every label point is within 500 m). Measure from `handle(load)` to the last diff posted during the synchronous handle. Assert ≤ 5,000 ms, that more than one diff was posted (batches ≤ 5,000 parcels), and that the last diff has `complete: true`.
- Log both numbers with `console.log('[perf] …')`.

If the bench fails the budget, profile before changing anything. The usual suspects are `index.covered` per op, `packCell` per batch and `acc.snapshot()`. Fix inside `src/lib/sim/` only. If the cost is in plan-model or generator code, stop and report.

- [ ] **Step 1: Write failing `client.spec.ts`** (a fake `WorkerLike` recording posts, with `emit(resp)` to deliver):
  - revs increment from 1;
  - resync dedupe: three `resync()` calls → one `load` posted; after a `diff phase:'load'` with that rev, another `resync()` posts again;
  - a `bad-request` error → `onError` then one `load`;
  - `parcelSummary` resolves by `reqId`, out of order;
  - `dispose` resolves pending summaries with null and terminates;
  - `isStalePreview` is true for a preview diff with rev < the latest commit's rev, false for later ones;
  - `datasetVersion` comes from `ready`.
- [ ] **Step 2: Implement `client.ts` and `worker.ts`; run tests, verify PASS.**
- [ ] **Step 3: Write and run the bench.** `npx vitest --run --project server src/lib/sim/host.bench.spec.ts` must PASS within budget. Record the numbers in the task report.
- [ ] **Step 4: Verify the worker bundles.** Run `npm run build`, then confirm a worker asset exists (`ls .svelte-kit/output/client/_app/immutable/workers/` or grep the build output for `worker`) and does not contain zod: `grep -l "jitless\|ZodError" <worker file>` must print nothing. If the build errors on worker format, add `worker: { format: 'es' }` to `vite.config.ts` and rebuild.
- [ ] **Step 5: Commit** `feat(sim): add worker shell, main-thread client with resync dedupe, and host bench`.

---

### Task 7: Sampler, op ids, editor store

**Read:** spec §2 (`Editor`, `StrokeSampler`), §4.4, §4.5 (commit refusals), §4.6, §6 `sampler.spec.ts` and `editor.spec.ts`.

**Files:**
- Create: `src/lib/brush/sampler.ts`, `src/lib/brush/ids.ts`, `src/lib/brush/editor.svelte.ts`
- Test: `src/lib/brush/sampler.spec.ts`, `src/lib/brush/ids.spec.ts`, `src/lib/brush/editor.svelte.spec.ts` (client project, since runes need the Svelte compiler; it is the spec's `editor.spec.ts`, renamed for the runes file)

**Interfaces:**
- Consumes: `quantize`, `project`, `SF_BBOX`, `PATH_MAX_POINTS`, `OPS_MAX`, `MAX_PLAN_BYTES`, `planByteSize`, `rebasePlan`, `type Plan`, `type PlanOp` (`$lib/plan`).
- Produces:

```ts
// sampler.ts
export type BrushTool = 'move' | 'paint' | 'erase';
export interface StrokeSampler {
  /** Returns true iff path() changed. Out-of-SF_BBOX points are ignored (false). */
  push(lng: number, lat: number): boolean;
  path(): [number, number][];
  /** kept.length === PATH_MAX_POINTS: commit path() now and start a new sampler at its last point. */
  full(): boolean;
}
export function spacingM(radiusM: number): number; // clamp(radiusM / 2, 2, 50)
export function createSampler(radiusM: number): StrokeSampler;

// ids.ts
export function newOpId(rand?: (buf: Uint8Array) => Uint8Array): string; // 12 base58 chars

// editor.svelte.ts
export type CommitResult = { ok: true } | { ok: false; reason: 'too-large' | 'too-many-ops' | 'read-only' };
export interface Editor {
  readonly plan: Plan;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly readOnly: boolean;
  load(plan: Plan, opts?: { readOnly?: boolean }): void; // clears redo
  commit(op: PlanOp, opts?: { datasetVersion?: string }): CommitResult; // clears redo (R11)
  undo(): PlanOp | null;
  redo(): PlanOp | null;
}
export function createEditor(plan: Plan, opts?: { readOnly?: boolean }): Editor;
```

Sampler algorithm (spec §4.4):
- `q = [quantize(lng), quantize(lat)]`; drop it if it is outside `SF_BBOX` (inclusive).
- The first point is always kept.
- If `full()`, return false.
- Keep `q` iff the `project` distance from the last kept point is ≥ `spacingM(radiusM)`.
- `latest = q` either way.
- `path() = latest && !samePoint(latest, lastKept) ? [...kept, latest] : [...kept]`.
- `push` returns whether `path()` differs from before.

Base58 alphabet: `123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`. Use rejection sampling (bytes ≥ 232 are discarded, so the result is unbiased: 232 = 58 × 4). The default `rand` is `crypto.getRandomValues`.

Editor implementation:
- Use `$state.raw` for `plan` and the `redo` stack, replacing them on every change.
- `canUndo = !readOnly && plan.ops.length > 0`; `canRedo = !readOnly && redo.length > 0`.
- `commit`:
  1. `readOnly` → `read-only`.
  2. `base = plan`. If `opts.datasetVersion` is given and differs, `base = rebasePlan(plan, v)` inside `try/catch (TypeError)`; on TypeError keep `plan`.
  3. `next = { ...base, ops: [...base.ops, op] }`.
  4. `next.ops.length > OPS_MAX` → `too-many-ops`.
  5. `planByteSize(next) > MAX_PLAN_BYTES` → `too-large`.
  6. Else `plan = next; redo = []`.
- `undo`: no-op (null) when it can't undo. Otherwise pop the last op into `redo` and return it.
- `redo`: pop the top op and append it via the same size checks (no rebase). On refusal, keep it on the stack and return null.
- `load` replaces the plan, sets `readOnly`, clears redo.

- [ ] **Step 1: Write failing `sampler.spec.ts`:**
  - Spacing: with radius 30 (s = 15 m), points every 1 m along a line keep every 15th point. `spacingM(2) === 2`, `spacingM(400) === 50`, `spacingM(30) === 15`.
  - Quantisation: a push of `-122.41234567` yields `-122.412346` in `path()`.
  - Out-of-bbox points are dropped. A stroke entirely outside gives `path()` `[]`.
  - A one-point stamp: a single push → a path of length 1. Pushing the same point again → `false` and still length 1.
  - `full()`: push 2,000 points spaced 3 m apart at radius 5 (s = 2.5) → `full()` true, `path().length === 2000`, and further pushes return false.
  - **Prefix stability (fast-check):** for any sequence of 1–200 in-bbox points (micro-degree integers in the Mission) and radius 5–500, at every k, `path_k` minus its tail element when that element ≠ the k-th kept point is a prefix of the final `path()`. Simpler equivalent: `path_k.slice(0, keptCount_k)` is a prefix of the final path, where `keptCount_k` is `path_k.length` minus 1 if the last element is not kept. Implement by tracking `path().length` changes.
  - The final `path()` never has more than `PATH_MAX_POINTS` points.
- [ ] **Step 2: Write failing `ids.spec.ts`:** length 12, alphabet only, rejection sampling (feed a fake `rand` returning bytes `[255, 0, …]` → the first char comes from byte 0, i.e. `'1'`), and 1,000 ids are unique.
- [ ] **Step 3: Write failing `editor.svelte.spec.ts`:**
  - The commit → undo → redo state machine, including `canUndo`/`canRedo` and the returned ops.
  - Redo is cleared by a new commit and by `load`.
  - `too-many-ops`: build a plan with `OPS_MAX` tiny ops in-test (stamp ops with distinct ids) → the next commit is refused and the plan is unchanged.
  - `too-large`: build ops of 2,000 points each until `planByteSize` is near 256 KB (generated in-test) → the commit is refused with `too-large` and no partial op.
  - Rebase on commit: a plan on `fixture-0` committed with `{ datasetVersion: 'fixture-1' }` → `plan.datasetVersion === 'fixture-1'`. An invalid version `'bad'` → no throw, the version is unchanged, and the op is appended.
  - Read-only: `commit` → `read-only`, `undo`/`redo` → null, and `canUndo` is false.
  - Reactivity: a `$derived` over `editor.plan.ops.length` updates (use `flushSync`).
- [ ] **Step 4: Run (FAIL) → implement → run (PASS).** Commands: `npx vitest --run --project server src/lib/brush` and `npx vitest --run --project client src/lib/brush/editor.svelte.spec.ts`.
- [ ] **Step 5: Commit** `feat(brush): add stroke sampler, op ids and editor store`.

---

### Task 8: Pure UI helpers: shortcuts, radius/stories, messages, settings

**Read:** spec §4.1 (persistence), §4.2, §4.5 announcements, §4.6 announcements, §4.7 table, §6 `shortcuts.spec.ts`. Read the R14/R15 rulings above.

**Files:**
- Create: `src/lib/brush/shortcuts.ts`, `src/lib/brush/radius.ts`, `src/lib/brush/messages.ts`, `src/lib/brush/settings.ts`
- Test: one `*.spec.ts` per file (server project)

**Interfaces:**
- Consumes: `OpStats` (Task 1); `PlanOp`; `STORIES_MIN/MAX`, `RADIUS_MIN_M/MAX_M`.
- Produces:

```ts
// shortcuts.ts
export type ShortcutAction =
  | { type: 'tool'; tool: BrushTool }
  | { type: 'stories'; delta: 1 | -1 }
  | { type: 'radius'; dir: 'up' | 'down' }
  | { type: 'undo' } | { type: 'redo' } | { type: 'cancel' } | { type: 'stamp' }
  | { type: 'space'; down: boolean };
export interface KeyLike {
  key: string; code?: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean;
  altKey?: boolean; repeat?: boolean; target: EventTarget | null; type: 'keydown' | 'keyup';
}
/** Elements where shortcuts never fire: input, textarea, select, [contenteditable]. */
export function isEditableTarget(t: EventTarget | null): boolean;
/** `mapFocused` gates Enter → stamp; `modalOpen` suppresses everything. */
export function actionForKey(e: KeyLike, ctx: { mapFocused: boolean; modalOpen?: boolean }): ShortcutAction | null;
export const SHORTCUTS: readonly { keys: string; action: string }[]; // the §4.7 table, for the disclosure

// radius.ts
export const RADIUS_STEPS = 100; // slider positions 0..99
export function radiusFromPos(pos: number): number; // log scale 5..500, rounded integer; 0 → 5, 99 → 500
export function posFromRadius(r: number): number; // inverse, rounded, clamped 0..99
export function clampRadius(r: number): number; // round, clamp 5..500; NaN → 30
export function stepRadius(r: number, dir: 'up' | 'down'): number; // ×/÷ 1.25, then clampRadius; always moves ≥ 1 m unless at a bound
export function clampStories(s: number): number; // round, clamp 1..80; NaN → 6
export function heightHintM(stories: number): number; // Math.round(stories * 3.1)
export const STORY_PRESETS = [2, 3, 4, 6, 8, 12, 20, 40] as const;

// messages.ts
export const MSG: {
  loadingCity: 'Loading city data…'; cityFailed: "Couldn't load city data.";
  loadingParcels: 'Loading parcels…'; zoomIn: 'Zoom in to see the brush';
  tooLarge: 'This stroke would make the plan too large to save (256 KB limit). Undo some strokes or start a new plan.';
  readOnly: 'Read-only — Remix to edit'; eraseHint: 'Erase removes painted height';
  mapLabel: 'Map. Arrow keys pan, plus and minus zoom. In Paint or Erase, press Enter to apply the brush at the centre crosshair.';
};
export function strokeMessage(s: OpStats): string;
export function undoMessage(op: PlanOp, verb: 'Undid' | 'Redid'): string;
export function radiusValueText(r: number): string; // 'Brush radius 30 metres'
export const ANNOUNCE_MS = 4000; export const TOO_LARGE_MS = 6000;

// settings.ts
export interface BrushSettings { stories: number; radiusM: number }
export const SETTINGS_KEY = 'sfhousing:brush';
export const DEFAULT_SETTINGS: BrushSettings; // { stories: 6, radiusM: 30 }
export function readSettings(storage?: Pick<Storage, 'getItem'> | null): BrushSettings;
export function writeSettings(s: BrushSettings, storage?: Pick<Storage, 'setItem'> | null): void;
```

Key map (spec §4.7):
- `v`/`h` → Move; `b` → Paint; `e` → Erase. Case-insensitive, and only without meta/ctrl/alt.
- `-` → stories −1; `=` or `+` → +1; `[` → radius down; `]` → up.
- `meta|ctrl + z` → undo. `meta|ctrl + shift + z` (key `z` or `Z`) or `ctrl + y` → redo.
- `Escape` → cancel; `Enter` → stamp (only when `mapFocused`).
- `' '` (Space) keydown/keyup → `{type:'space', down}`. A keydown with `repeat` → null.
- Everything returns null when `isEditableTarget(target)` or `modalOpen`. **Escape is still returned inside inputs? No**: spec says shortcuts are inactive in inputs, so return null there too.

`strokeMessage` (R15; `n()` = en-US format):
- `covered === 0 && ineligible === 0` → `No parcels under that stroke`.
- `covered === 0 && ineligible > 0` → `No eligible parcels under that stroke`, plus the ineligible suffix.
- paint → `Painted ${n(stories)} ${stories===1?'story':'stories'} on ${n(covered)} ${parcel(s)} · ${n(built)} new building(s) · ${n(notBigger)} already as big or bigger`.
- erase → `Erased ${n(covered)} parcel(s) · ${n(removed)} generated building(s) removed`.
- Ineligible suffix: ` · ${n(ineligible)} not eligible (open space or unmapped lots)`.
- Partial suffix: ` · some areas still loading`.

`undoMessage`: `Undid paint, 6 stories` / `Undid erase` / `Redid paint, 1 story`.

`readSettings` wraps everything in try/catch. It parses JSON and takes the numeric fields through `clampStories`/`clampRadius`. Any non-number, a missing field, `null` or a throw → that field's default.

- [ ] **Step 1: Write failing specs.** Shortcuts:
  - every table row;
  - suppression for an `<input>`, `<textarea>` and `[contenteditable]` target (use fake objects with `tagName` / `isContentEditable`, since there is no DOM in Node; implement `isEditableTarget` duck-typed on `tagName` and `isContentEditable`);
  - Enter returns null when `mapFocused` is false;
  - `modalOpen` suppresses all;
  - repeat Space keydown → null.

  Radius:
  - ends 0 → 5 and 99 → 500;
  - monotonic;
  - `posFromRadius(radiusFromPos(p))` within ±1 for all p;
  - `stepRadius(30, 'up') === 38`, `stepRadius(30, 'down') === 24`, `stepRadius(500, 'up') === 500`, `stepRadius(5, 'down') === 5`, `stepRadius(5, 'up') === 6`;
  - `clampStories(0.4) === 1`, `(80.6) === 80`, `(6.5) === 7`;
  - `heightHintM(6) === 19`.

  Messages: each template, including the singulars, 1,234 grouping, ineligible + partial combined, and the no-eligible form.

  Settings:
  - defaults on `null` storage;
  - invalid JSON;
  - `'null'`;
  - `'{"stories":"abc","radiusM":9999}'` → `{6, 500}`;
  - a getter that throws;
  - `writeSettings` swallows a throwing `setItem`;
  - round trip.
- [ ] **Step 2: Run (FAIL) → implement → run (PASS).**
- [ ] **Step 3: Commit** `feat(brush): add shortcut map, radius scale, status copy and settings persistence`.

---

### Task 9: `BrushState`, overlay layers, `BrushToolbar.svelte`

**Read:** spec §4.1, §4.1a, §4.2, §4.3, §4.5 (status), §4.8, §6 `BrushToolbar.svelte.spec.ts`. Read `docs/dev/accessibility.md`, `src/lib/shell/SiteHeader.svelte` (styling conventions) and `src/lib/map/palette.ts` (token style).

**Files:**
- Create: `src/lib/brush/state.svelte.ts`, `src/lib/brush/overlay.ts`, `src/lib/brush/BrushToolbar.svelte`
- Test: `src/lib/brush/overlay.spec.ts` (server), `src/lib/brush/BrushToolbar.svelte.spec.ts` (client)

**Interfaces:**
- Consumes: Task 8 modules, `Editor` (Task 7), `BrushTool`.
- Produces:

```ts
// state.svelte.ts
export type CityPhase = 'loading' | 'ready' | 'failed';
export class BrushState {
  tool: BrushTool;            // $state; default from (pointer: fine) at construction
  stories: number;            // $state, persisted
  radiusM: number;            // $state, persisted
  phase: CityPhase;           // $state
  loadingParcels: boolean;    // $state (chunks.pending > 0)
  zoomHint: boolean;          // $state
  spaceHeld: boolean;         // $state
  readonly statusText: string; // R14 precedence; '' when nothing to say
  constructor(opts?: { fine?: boolean; storage?: Storage | null; now?: () => number;
                       setTimeout?: typeof setTimeout; clearTimeout?: typeof clearTimeout });
  setStories(n: number): void;  // clampStories + writeSettings
  setRadius(n: number): void;   // clampRadius + writeSettings
  announce(text: string, ms: number): void; // transient, replaces any current one
  readonly announcement: string; // current transient text or ''
}

// overlay.ts
export const BRUSH_COLORS: { light: { paint: [number, number, number]; erase: [number, number, number] };
                              dark: { paint: [number, number, number]; erase: [number, number, number] } };
export function metersPerPixel(lat: number, zoom: number): number; // 40075016.686 * cos(lat°) / (512 * 2^zoom)
export function dashedCircle(center: [number, number], radiusM: number, n?: number): [number, number][][]; // n=64 → 32 dash paths
export interface OverlayCtors {
  ScatterplotLayer: new (props: Record<string, unknown>) => Layer;
  PathLayer: new (props: Record<string, unknown>) => Layer;
}
export interface OverlayInput {
  tool: 'paint' | 'erase'; ring: [number, number] | null; radiusM: number;
  swath: [number, number][] | null; metersPerPixel: number; dark: boolean;
}
/** [] when nothing to draw. Layer ids: 'brush-ring', 'brush-swath' (never generated-/rising-). */
export function buildOverlayLayers(L: OverlayCtors, s: OverlayInput): Layer[];
```

Overlay details (spec §4.3):
- **ring, paint:** a `ScatterplotLayer` with `id: 'brush-ring'`, `data: [ring]`, `getPosition: d => d`, `getRadius: radiusM`, `radiusUnits: 'meters'`, `radiusMinPixels: 4`, `stroked: true`, `filled: false`, `lineWidthUnits: 'pixels'`, `getLineWidth: 2`, `getLineColor: [...paint, 255]`.
- **ring, erase:** a `PathLayer` with `id: 'brush-ring'` over `dashedCircle(ring, max(radiusM, 4 * metersPerPixel))`, `widthUnits: 'pixels'`, `getWidth: 2`, colour erase.
- **swath:** a `PathLayer` with `id: 'brush-swath'`, `data: [swath]`, `getPath: d => d`, `widthUnits: 'meters'`, `getWidth: 2 * radiusM`, `capRounded: true`, `jointRounded: true`, `opacity: 0.25`, tool colour.
- A one-point swath (stamp) is drawn as a two-point path `[p, p]`, which rounded caps make a disc.
- Order is `[swath, ring]`, so the ring draws on top.
- `BRUSH_COLORS`: paint and erase must each be ≥ 3:1 against the map land/building colours in both themes (WCAG 1.4.11). Choose and record them: paint is a saturated blue (e.g. light `[37, 99, 235]`, dark `[96, 165, 250]`), erase a magenta or red (light `[219, 39, 119]`, dark `[244, 114, 182]`).

Toolbar component props:

```ts
interface Props {
  state: BrushState;
  editor: Pick<Editor, 'canUndo' | 'canRedo' | 'readOnly'>;
  onUndo(): void; onRedo(): void; onRetry(): void;
  onToolChange?(t: BrushTool): void; // controller cancels a stroke on change
}
```

Toolbar markup rules:
- A `role="radiogroup" aria-label="Brush tool"` of three `role="radio"` buttons with `aria-checked`, roving tabindex, and Arrow Left/Right/Up/Down moving and selecting with wrap.
- Each tool button has an inline SVG icon (`aria-hidden`) and a visible label at `md:` (≥ 768 px). Below `md`, the label is `sr-only`, plus a `title` tooltip.
- Paint and Erase are `disabled` when `state.phase !== 'ready'`.
- **Stories stepper** (≥ md inline; < md inside a popover opened by a "6 st" button with `aria-expanded`/`aria-controls`):
  - `[−]` and `[+]` buttons (`aria-label="Fewer stories"`/`"More stories"`);
  - `<input type="number" min="1" max="80" step="1" aria-label="Stories">`, clamped and rounded on blur or Enter;
  - the text `≈ {heightHintM} m`;
  - chips 2·3·4·6·8·12·20·40 with `aria-pressed`;
  - the whole fieldset is `disabled` when the tool is Erase, with the hint `MSG.eraseHint`.
- **Radius:** `<input type="range" min=0 max=99 step=1 aria-label="Brush radius" aria-valuetext={radiusValueText(r)}>` with the visible label `Brush {r} m`. It sits inline at ≥ md and in a popover from a "30 m" button below md.
- **Undo/Redo:** buttons with `aria-label="Undo (⌘Z / Ctrl+Z)"` and `"Redo (⇧⌘Z / Ctrl+Shift+Z)"`, disabled per `editor`.
- **Shortcuts disclosure:** a button `aria-expanded` "Keyboard shortcuts" toggling a table from `SHORTCUTS`. It is rendered only when `matchMedia('(pointer: coarse)')` does not match.
- **Status line:** `<p aria-live="polite" role="status">{state.statusText}</p>`. When `phase === 'failed'` it also shows a `Retry` button calling `onRetry`.
- **Read-only (`editor.readOnly`):** render only the Move radio (checked) plus `MSG.readOnly`, at every width.
- Popovers close on Escape (focus returns to the opener) and on an outside click.
- Every interactive control is `min-h-11 min-w-11` (44 px).
- **Layout:** ≥ md, `absolute top-4 left-4` floating panel. < md, `fixed inset-x-0` bar of height 56 px at `bottom: var(--scorebar-h, 0px)`, with the status line floating above. Expose `--brushbar-h: 56px` on the bar.
- Colours come from CSS custom properties `--brush-paint`/`--brush-erase` (set from `BRUSH_COLORS`) for the active tool indicator.

- [ ] **Step 1: Write failing `overlay.spec.ts`:**
  - `metersPerPixel(0, 0) ≈ 78271.517`;
  - `dashedCircle` returns 32 paths whose vertices are all at ≈ radius (±0.5 %, via plan-model `project`);
  - `buildOverlayLayers` with fake ctors capturing props: the paint ring props (meters, min 4 px, stroked, no fill);
  - the erase ring is a `PathLayer` with 32 paths;
  - the swath width is `2 * r` in meters, at opacity 0.25;
  - a stamp swath is `[p, p]`;
  - `ring: null, swath: null` → `[]`;
  - no id starts with `generated-` or `rising-`.
- [ ] **Step 2: Write failing `BrushToolbar.svelte.spec.ts`** (vitest-browser-svelte, `page` locators):
  - Radiogroup arrow-key roving: focus Paint, ArrowRight → Erase checked and focused; ArrowLeft from Move wraps to Erase.
  - Stepper: `+` from 80 stays 80; typing `0` + blur → 1; `85` + Enter → 80; `6.6` → 7. Clicking chip 12 → `stories === 12` and that chip has `aria-pressed="true"`. The `≈ 37 m` hint for 12.
  - The slider at 0 → label `Brush 5 m`; at 99 → `Brush 500 m` and `aria-valuetext="Brush radius 500 metres"`.
  - Erase disables the stepper and shows the hint.
  - Before ready, Paint and Erase are disabled and the status reads `Loading city data…`. `phase = 'failed'` → `Couldn't load city data.`, and clicking Retry calls `onRetry`.
  - Status texts: `state.announce(strokeMessage(stats), 4000)` for a paint, an erase, ineligible, partial and none → the matching text appears in the live region. Covering each template once is enough, since they are unit-tested in Task 8.
  - Read-only at 375 px (`page.viewport(375, 812)`): only Move plus `Read-only — Remix to edit`.
  - Persistence: `setStories(8)` writes `localStorage['sfhousing:brush']`.
  - At 375 px, the stories button text is `6 st` and opens a popover with the stepper; Escape closes it and focus returns to the button.
- [ ] **Step 3: Run (FAIL) → implement → run (PASS).** Then `npm run check` and `npm run lint`.
- [ ] **Step 4: Commit** `feat(brush): add brush state, ring and swath overlay, and toolbar`.

---

### Task 10: `BrushController` (pointer, touch, pen, keyboard → ops)

**Read:** spec §4.1, §4.3, §4.4, §4.5, §4.6, §4.7, §4.8, §4.9 "Prefetch", §4.10 (window blur), §6 `BrushController.svelte.spec.ts`.

**Files:**
- Create: `src/lib/brush/BrushController.svelte.ts`
- Test: `src/lib/brush/BrushController.svelte.spec.ts`

**Interfaces:**
- Consumes: Tasks 6–9; `SimMapHandle` (`$lib/map/types`).
- Produces:

```ts
export interface ControllerMap {
  // the subset of maplibre Map the controller uses (stubbed in tests)
  getCanvas(): HTMLCanvasElement;
  getCanvasContainer(): HTMLElement;
  unproject(p: [number, number]): { lng: number; lat: number };
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  getBounds(): { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number };
  on(ev: 'move' | 'moveend' | 'zoom', fn: () => void): void;
  off(ev: 'move' | 'moveend' | 'zoom', fn: () => void): void;
}
export interface BrushControllerDeps {
  handle: Pick<SimMapHandle, 'setPanEnabled' | 'setOverlayLayers'>;
  map: ControllerMap;
  client: Pick<SimClient, 'preview' | 'cancelPreview' | 'commit' | 'undo' | 'prefetch' | 'datasetVersion'>;
  editor: Editor;
  state: BrushState;
  layers: OverlayCtors; // from import('@deck.gl/layers')
  raf(cb: () => void): number;
  cancelRaf(h: number): void;
  dark?(): boolean; // default matchMedia('(prefers-color-scheme: dark)')
  win?: Window; // default window (keydown/keyup/blur listeners)
  onCrosshair?(visible: boolean): void;
}
export class BrushController {
  constructor(deps: BrushControllerDeps);
  readonly stroking: boolean;   // $state
  attach(): void;                // listeners + canvas aria-label (MSG.mapLabel) + pan mode effect
  destroy(): void;
  setTool(t: BrushTool): void;   // cancels a stroke in progress
  onDiff(d: DiffResponse, stale: boolean): void; // flow control + announcements
  cancelStroke(): void;
  stampAtCenter(): void;
  undo(): void;
  redo(): void;
  /** rev of the last commit sent, for the page's performance.mark pairing. */
  readonly lastCommitRev: number | null;
}
```

Behaviour (implement exactly):
- **Pan mode:** `panEnabled = tool === 'move' || spaceHeld || readOnly || phase !== 'ready'`. Call `handle.setPanEnabled(panEnabled)` whenever it changes (R13). The canvas container cursor is `grab` when `spaceHeld`, `crosshair` in Paint/Erase, `''` otherwise.
- **pointerdown** on the canvas container (capture phase):
  - Track touch pointer ids. If this is a touch and another touch is already down, then:
    - if stroking → `cancelStroke()`;
    - set `touchBlocked = true` and return (MapLibre handles the pinch).
  - Start a stroke only if all of these hold: tool paint/erase, phase ready, `!readOnly`, `!spaceHeld`, `e.isPrimary`, `e.button === 0`, `!touchBlocked`.
  - Start: freeze `stories`/`radiusM`, `id = newOpId()`, `sampler = createSampler(radiusM)`, `setPointerCapture`, `push(unproject(offsetXY))`, `schedulePreview()`, then `preventDefault()`.
- **pointermove:**
  - When stroking with this pointer: for each event in `e.getCoalescedEvents?.() ?? [e]`, push the unprojected point. If `sampler.full()`, split: commit the current op and start a new stroke at `path().at(-1)` with a new id and the same frozen values. Then `schedulePreview()`, and the ring follows.
  - When not stroking: if `pointerType !== 'touch'` and the tool is paint/erase, the ring follows the hover.
- **pointerup** (stroking pointer) → `finishStroke()`. **pointercancel** → `cancelStroke()`.
- On a touch pointerup/cancel, remove the id. When none remain, `touchBlocked = false`.
- Window **blur** → `cancelStroke()`. **pointerleave** with no stroke → clear the ring.
- **Previews:** `schedulePreview` requests one raf if none is pending. On raf: if `inFlightRev !== null`, set `dirty = true`; else if the path is non-empty and differs from the last sent, `inFlightRev = client.preview(op)` and `sentPreview = true`.
- `onDiff(d)`: if `inFlightRev !== null && d.rev >= inFlightRev`, clear `inFlightRev`, and if `dirty && stroking` then `dirty = false` and `schedulePreview()`.
- **finishStroke:**
  1. `path = sampler.path()`.
  2. Empty → if `sentPreview`, `client.cancelPreview()`; end.
  3. Otherwise build the op (paint `{ kind, stories, radiusM, path, id }`, erase `{ kind:'erase', radiusM, path, id }`, with no `stories` key) and call `editor.commit(op, { datasetVersion: client.datasetVersion ?? undefined })`.
  4. On ok: `performance.mark('sfh-brush-pointerup')` (in DEV or `VITE_E2E === '1'` only), `lastCommitRev = client.commit(op)`, `awaitingStats = op.id`.
  5. On `too-large`/`too-many-ops`: `client.cancelPreview()` and `state.announce(MSG.tooLarge, TOO_LARGE_MS)`.
  6. In every case, clear the swath and end the stroke.
- **cancelStroke:** if stroking: if `sentPreview`, `client.cancelPreview()`; clear the swath; end.
- **Announcements in `onDiff`:** a `phase === 'commit'` diff with `d.stats?.opId === awaitingStats` → `state.announce(strokeMessage(d.stats), ANNOUNCE_MS)` and clear `awaitingStats`.
- **Chunks:** the page sets `state.loadingParcels` from `chunks.pending > 0`. The controller doesn't handle chunks.
- **Keyboard:** a window keydown/keyup listener → `actionForKey(e, { mapFocused: document.activeElement === map.getCanvas() })`.
  - `tool` → `setTool`. `stories` → `state.setStories(state.stories ± 1)`. `radius` → `state.setRadius(stepRadius(…))`.
  - `undo`/`redo` → methods, with `preventDefault`. `cancel` → `cancelStroke()`.
  - `stamp` → `stampAtCenter()` with `preventDefault`.
  - `space` down: if stroking, ignore. Otherwise `spaceHeld = true` with `preventDefault` (stops page scroll). `space` up → `spaceHeld = false`.
- **undo/redo:** ignored while stroking or when read-only.
  - `undo`: `op = editor.undo()`; if op, `client.undo(op.id)` and announce `undoMessage(op, 'Undid')`.
  - `redo`: `op = editor.redo()`; if op, `lastCommitRev = client.commit(op)` and announce `undoMessage(op, 'Redid')`.
- **stampAtCenter:** requires tool paint/erase, phase ready and not read-only. Take the centre, quantize it, and check it is inside SF_BBOX. Build a one-point op, then `editor.commit` → `client.commit` with the same refusal handling as `finishStroke`.
- **Focus crosshair:**
  - On canvas `focus`/`blur` and on `setTool`: `visible = canvas.matches(':focus-visible') && tool !== 'move'` → `onCrosshair(visible)`. When visible, the ring sits at the map centre (updated on map `move`).
- **Zoom hint:** on ring updates, `state.zoomHint = tool !== 'move' && radiusM / metersPerPixel(lat, zoom) < 4`.
- **Prefetch:** on map `moveend`, if the tool is paint/erase and `getZoom() >= 14`, call `client.prefetch([W, S, E, N])` from `getBounds()`.
- **Overlay:** whenever the ring/swath/tool/radius change, `handle.setOverlayLayers(buildOverlayLayers(layers, …))`. Use `[]` when the tool is move and nothing is shown.
- `setTool(t)`: `cancelStroke()` if stroking, then `state.tool = t`, then update the crosshair and overlay.
- `destroy()` removes every listener and cancels pending raf.

- [ ] **Step 1: Write failing `BrushController.svelte.spec.ts`.** Fixtures:
  - A real DOM `div` container plus a `canvas` (tabindex 0) appended to `document.body`.
  - A stub map: `unproject` maps pixel (x, y) → `[-122.42 + x * 1e-5, 37.76 - y * 1e-5]`; `getCenter`; `getZoom` → 17; `getBounds`; `on`/`off` recorded.
  - A recording `handle` (`setPanEnabled` calls, `setOverlayLayers` calls).
  - A fake client whose methods record calls and return incrementing revs.
  - A real `createEditor(emptyPlan('fixture-0'))` and a `BrushState({ fine: true })` with `phase = 'ready'`.
  - Fake ctors as layers.
  - A manual raf queue (`raf` pushes, `flushRaf()` runs).

  Dispatch `PointerEvent`s on the container. Cases:
  - **Drag:** down at (0, 0), moves to (100, 0) in 10 steps, one `flushRaf()` per 3 moves:
    - at most one `preview` per raf;
    - none while one is in flight (no `onDiff` yet);
    - after `onDiff({rev: inFlight, phase:'preview'})` the next raf sends;
    - up → `editor.plan.ops.length === 1` and `client.commit` was called with that op;
    - **the committed path equals the last preview's path** when the last move was flushed and acked before up (acceptance 2);
    - the op has `stories` (paint) and integer `radiusM`.
  - **Erase drag:** the committed op has no `stories` key.
  - **Space** keydown → `setPanEnabled(true)`; keyup → `false`. Space during a stroke → no `setPanEnabled(true)` and the stroke continues.
  - **Second touch:** a touch down (id 1), move, a touch down (id 2) → `cancelPreview` called (if a preview was sent) and no op. Lift id 2 only and move id 1 → nothing. Lift both, new touch down/move/up → one op.
  - **Escape** mid-stroke → cancel, no op.
  - **Enter** with the canvas focused (`canvas.focus()`) → one stamp op at the quantised centre (`path.length === 1`). Enter with focus elsewhere → no op.
  - **Window blur** mid-stroke → cancel. **`B`/`E`/`V`** mid-stroke → cancel and tool changed.
  - **Undo shortcut mid-stroke** → ignored. After the stroke → `client.undo(id)` and announcement `Undid paint, 6 stories`. Redo → `client.commit` with the same id and `Redid paint, 6 stories`.
  - **Out-of-bbox stroke** (stub unproject returning `[0, 0]` for all points) → no op; if previews were sent, `cancelPreview`.
  - **Refusal:** the editor pre-filled to `OPS_MAX` ops → up → `cancelPreview` and `state.announcement === MSG.tooLarge`.
  - **Non-primary button** (`button: 2`) → no stroke. A pen pointer behaves like a mouse.
  - **Overlay:** hover with the mouse in paint mode → `setOverlayLayers` gets a `brush-ring` layer. Move tool → `[]`.
  - **Prefetch:** `moveend` at zoom 17 in paint mode → `client.prefetch` with the bounds; at zoom 13 → none.
- [ ] **Step 2: Run (FAIL) → implement → run (PASS).** Then `npm run check`.
- [ ] **Step 3: Commit** `feat(brush): add brush controller for pointer, touch, pen and keyboard strokes`.

---

### Task 11: `BrushEditor.svelte`, page wiring, e2e hook

**Read:** spec §4.1 ("Before ready"), §4.1a, §4.9 "Manifest (I16)", the I17 addendum above, R12/R17/R20. Read `src/lib/map/SimMap.svelte` (props, `onready`), `src/routes/+page.ts`, `src/routes/+page.svelte`, `src/routes/page.svelte.spec.ts` and `src/lib/map/debug.ts`.

**Files:**
- Create: `src/lib/brush/BrushEditor.svelte`, `src/lib/brush/debug.ts`
- Modify: `src/routes/+page.ts` (replace), `src/routes/+page.svelte`, `src/routes/page.svelte.spec.ts`
- Test: `src/lib/brush/BrushEditor.svelte.spec.ts`, `src/routes/page.spec.ts` (server: the `+page.ts` load)

**Interfaces:**
- Consumes: everything above; `SimMap` props `manifest`, `requestParcelSummary`, `onRetryChunks`, `onready`.
- Produces:

```ts
// +page.ts
export const load: PageLoad = async ({ fetch, parent }) => {
  const { datasetVersion } = await parent();
  let plan: Plan;
  try {
    plan = emptyPlan(datasetVersion); // plan-sharing (W5) will supply the autosaved plan here
  } catch {
    error(500, 'Invalid dataset version');
  }
  try {
    const { manifest, fellBack } = await loadManifest(plan.datasetVersion, datasetVersion, fetch);
    return { plan, manifest, fellBack, manifestError: false };
  } catch (e) {
    console.error('[brush] manifest load failed', e);
    return { plan, manifest: null, fellBack: false, manifestError: true };
  }
};

// BrushEditor.svelte props
interface Props {
  manifest: Manifest | null;
  manifestError: boolean;
  plan: Plan;
  currentVersion: string;   // PUBLIC_DATASET_VERSION (layout data)
  readOnly?: boolean;
  /** Retry: reruns loadManifest client-side (the parent supplies it so /p/:id can reuse this). */
  reloadManifest(): Promise<Manifest>;
  /** Latest score from the worker, for scoreboard UI (W5). */
  onscore?(s: Score): void;
}

// debug.ts (VITE_E2E only, mirrors src/lib/map/debug.ts)
export interface SfhBrushDebug {
  readonly ops: number;
  readonly lastStats: OpStats | null;
  readonly ready: boolean;
  readonly chunks: { pending: number; failed: string[] };
}
declare global { interface Window { __sfhBrush?: SfhBrushDebug } }
export function installBrushDebug(get: () => SfhBrushDebug): () => void;
```

`BrushEditor` behaviour:
- Create `editor = createEditor(plan, { readOnly })` and `state = new BrushState({ fine: matchMedia('(pointer: fine)').matches })`.
- Local `$state` `manifest` is initialised from the prop.
- `phase` starts `'failed'` if `manifestError`, else `'loading'`.
- `onMount`:
  1. `worker = spawnSimWorker()`.
  2. `client = new SimClient(worker, events, () => editor.plan)`.
  3. If there is a manifest, `client.init(manifest)`.
  4. `layers = await import('@deck.gl/layers')`.
  5. On destroy: `client.dispose()`, `controller?.destroy()`.
- Events:
  - `onReady` → `state.phase = 'ready'; client.load(editor.plan)`.
  - `onDiff(d)` →
    1. `handle?.applyGenerated(d.render)`. If the handle isn't ready, buffer renders and replay them in `onready`, preserving order.
    2. If `d.phase === 'commit' && d.rev === controller.lastCommitRev` → `performance.mark('sfh-brush-commit-applied')` and `performance.measure('sfh-brush-commit', 'sfh-brush-pointerup', 'sfh-brush-commit-applied')`. DEV or `VITE_E2E === '1'` only, in try/catch.
    3. `controller?.onDiff(d, client.isStalePreview(d))`.
    4. `onscore?.(d.score)`.
  - `onChunks(c)` → for each `[cellId, s]` of `c.status`, `handle?.setChunkStatus(cellId, s)` (buffer until ready, as above); `state.loadingParcels = c.pending > 0`.
  - `onError(e)` → if `e.code === 'manifest-invalid'`, `state.phase = 'failed'`. `bad-request` resync is automatic in the client. `internal` → `console.error`.
- **Retry** (toolbar `onRetry`): `state.phase = 'loading'`; `manifest = await reloadManifest()`; `client.init(manifest)`. On reject → `state.phase = 'failed'`.
- **SimMap wiring:**
  - `<SimMap manifest={manifest} requestParcelSummary={(id) => client.parcelSummary(id)} onRetryChunks={() => client.retryChunks()} onready={(h) => { handle = h; h.onResyncNeeded(() => client.resync()); flush buffers; create the controller with map = h.getMap()!; controller.attach() }} />`.
  - Render it only when `manifest` is non-null. Otherwise render a static frame with the toolbar, so the failed state is visible.
- **Bottom inset:** with `matchMedia('(max-width: 767px)')` (listen for changes): `h.setBottomInset(56 + scorebarPx)`, where `scorebarPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scorebar-h')) || 0` (R17). Otherwise 0.
- **Crosshair:** an absolutely centred 24 px `aria-hidden` SVG cross shown when `onCrosshair(true)`.
- **e2e hook:** `installBrushDebug(() => ({ ops: editor.plan.ops.length, lastStats, ready: state.phase === 'ready', chunks }))`.
- The toolbar gets `state`, `editor`, `onUndo={() => controller?.undo()}`, `onRedo`, `onRetry`, `onToolChange={(t) => controller ? controller.setTool(t) : (state.tool = t)}`.

`+page.svelte`:

```svelte
<script lang="ts">
  import BrushEditor from '$lib/brush/BrushEditor.svelte';
  import { loadManifest } from '$lib/sim/manifest';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  async function reloadManifest() {
    return (await loadManifest(data.plan.datasetVersion, data.datasetVersion)).manifest;
  }
</script>

<svelte:head><title>SF Housing Simulator</title></svelte:head>

<h1 class="sr-only">SF Housing Simulator</h1>
<div id="map-region" class="relative h-full">
  <BrushEditor
    manifest={data.manifest}
    manifestError={data.manifestError}
    plan={data.plan}
    currentVersion={data.datasetVersion}
    {reloadManifest}
  />
</div>
```

- [ ] **Step 1: Write failing `src/routes/page.spec.ts`** (server). Call the `load` with a fake `fetch` and `parent`:
  - success → `{ plan: emptyPlan('fixture-0'), manifest, fellBack: false, manifestError: false }`;
  - a manifest 500 → `manifestError: true, manifest: null` and no throw;
  - an invalid `datasetVersion` from the parent → throws a 500 `HttpError` (`isHttpError` from `@sveltejs/kit`).
- [ ] **Step 2: Update `src/routes/page.svelte.spec.ts`:**
  - it now passes `data: { plan, manifest, fellBack: false, manifestError: false, datasetVersion: 'fixture-0', appRelease: 'dev' }`;
  - stub `Worker` (`vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null })`);
  - keep the WebGL2-null stub;
  - assert the h1, `#map-region`, the map region role and the toolbar radiogroup `Brush tool`;
  - add a case with `manifestError: true` → the status `Couldn't load city data.` and a Retry button, and no map root.
- [ ] **Step 3: Write `BrushEditor.svelte.spec.ts`** with an injectable fake worker. Add a prop `createWorker?: () => WorkerLike` (default `spawnSimWorker`) for tests. Cases:
  - `init` is posted with the manifest;
  - emitting `ready` → `load` posted with the editor plan, and the toolbar Paint is enabled;
  - an `error manifest-invalid` → the failed status;
  - Retry → `reloadManifest` called and a second `init` posted;
  - `chunks {pending: 1}` → `Loading parcels…`.

  Use the WebGL2-null stub so SimMap takes its fallback (no handle). That is fine: these assert the client wiring, not the map.
- [ ] **Step 4: Run (FAIL) → implement → run (PASS).** Then `npm run check`, `npm run lint` and `npm run test:unit`.
- [ ] **Step 5: Commit** `feat(brush): wire brush editor, worker client and loadManifest into the editor page`.

---

### Task 12: e2e and full verification

**Read:** spec §6 Playwright list, §7 acceptance criteria. Read `e2e/map.spec.ts` (helpers `gotoReady`, `jumpAndIdle`, `projectToPage`; the fixture parcel coordinates), `e2e/helpers/a11y.ts`, `playwright.config.ts` and `docs/dev/testing.md`.

**Files:**
- Create: `e2e/brush.spec.ts`
- Modify: `docs/dev/testing.md` (one short paragraph: the brush e2e hook `window.__sfhBrush`, the shortened chunk retry in VITE_E2E builds, and `host.bench.spec.ts` budgets). Modify `CLAUDE.md` only if a new scoped doc is added (it shouldn't be).

**Interfaces:**
- Consumes: `window.__sfhBrush` (Task 11), `window.__sfhMap` (map-view), fixture-0 (one chunk `50_25`, 14 parcels, around `[-122.4186, 37.7601]`).

Tests (`test.describe('brush tool')`). Helpers:
- `gotoEditor(page)`: `page.goto('/')`, map `data-state="ready"`, and `window.__sfhBrush?.ready`.
- `jumpAndIdle` to `{ center: [-122.4187, 37.76014], zoom: 18.5 }`.

1. **Desktop paint** (chromium project only; `test.skip(isMobile)`):
   - The tool radio `Paint` is checked by default.
   - `page.mouse` drag across the block: from the projected `[-122.4193, 37.76014]` to `[-122.4180, 37.76014]` in 15 steps.
   - Expect the status to match `/^Painted 6 stories on \d+ parcels/` and `__sfhBrush.ops === 1`.
   - `__sfhMap.snapshot()` reports ≥ 1 generated parcel. Read `src/lib/map/generated-controller.ts` `debugSnapshot()` for the exact field; use it.
   - `expect.soft` the `sfh-brush-commit` measure duration ≤ 150 ms (`performance.getEntriesByName`).
2. **Undo/redo by keyboard:**
   - After a paint, `Control+z` → `ops === 0`, the status says `Undid paint, 6 stories` and the generated count returns to 0.
   - `Control+Shift+z` → `ops === 1` and the count is restored.
3. **Mobile** (mobile project only):
   - Move is checked by default.
   - A one-finger touch drag (CDP `Input.dispatchTouchEvent` via `page.context().newCDPSession(page)`, or `page.touchscreen` plus manual `dispatchEvent` of pointer events) pans the map: the centre changed and `ops === 0`.
   - Tap the `Paint` radio, then a touch drag → `ops === 1`.
   - A two-finger gesture during a stroke (second touchStart mid-drag) → still `ops === 1` (no new op).
4. **Stamps:**
   - A click without movement in Paint → `ops === 1`.
   - Focus the map canvas via `Tab` (so `:focus-visible` holds), then press `Enter` → `ops === 2`.
   - The canvas has `aria-label` = `MSG.mapLabel`.
5. **Failed chunk:**
   - `page.route('**/data/fixture-0/parcels/50_25.json', r => r.abort())` before navigating.
   - Paint a stroke, so the chunk is needed.
   - Expect map-view's chip `Some parcels didn't load —` with a Retry button within 5 s. The VITE_E2E retry schedule is 50/100/200 ms.
   - `page.unroute(...)`, click Retry, and expect the chip to disappear and generated buildings to appear (snapshot count > 0).
6. **Axe gate** (R16):
   - chromium: open the `Keyboard shortcuts` disclosure → `expectNoA11yViolations(page)`.
   - mobile: tap the radius button (`30 m`) → popover open → `expectNoA11yViolations(page)`.
   - Use the helper's default options. If map-view's canvas triggers a known exclusion, reuse the exact options `e2e/pages-a11y.spec.ts` uses for `/`.

No test here needs scoreboard UI or plan-sharing. If one turns out to, add it as `test.fixme('W6: <reason>')`.

- [ ] **Step 1: Write `e2e/brush.spec.ts`.**
- [ ] **Step 2: Run e2e.**
  1. `lsof -ti :4173 | xargs kill 2>/dev/null; npx playwright test e2e/brush.spec.ts`.
  2. Fix failures in brush code (not in map-view).
  3. Then run the whole suite `npx playwright test`. map-view's fixme tests stay fixme.
- [ ] **Step 3: Full verification** (record each result in the task report): `npm run check` · `npm run lint` · `npm run test:unit` · `npm run test:pipeline` (needs tippecanoe/pmtiles; if missing, record "skipped: tool missing") · `npm run build` · `npx playwright test`.
- [ ] **Step 4: Commit** `test(brush): add brush e2e and document test hooks`.

---

## Self-review notes (operator)

- Spec coverage:
  - §4.1 → T9/T10/T11
  - §4.1a → T9/T11
  - §4.2 → T8/T9
  - §4.3 → T9/T10
  - §4.4 → T7/T10
  - §4.5 → T5/T7/T10
  - §4.6 → T7/T10
  - §4.7 → T8/T10
  - §4.8 → T9/T10/T11/T12
  - §4.9 → T2–T6
  - §4.10 → T4/T5/T7/T10
  - §6 tests → T1–T12
  - §7 acceptance → T5 (2: preview/commit path equality is also in T10), T7 (3, 6), T6 bench (4), T5 property P-b (5), T12 (7, 9), T1 (8).
- Types used across tasks:
  - `DiffResponse`, `ChunksResponse`, `ReadyResponse`, `ErrorResponse` (T1);
  - `FetchLike` (T2);
  - `Display`/`UpdateMeta` (T3);
  - `SimHostDeps` (T4);
  - `SimClient` (T6);
  - `Editor`/`CommitResult` (T7);
  - `BrushState`, `OverlayCtors` (T9);
  - `BrushController` (T10).
