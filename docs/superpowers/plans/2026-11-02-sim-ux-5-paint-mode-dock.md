# /sim UX, plan 5 of 5: `/` on the dock with the shared Paint tab and score — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/` the same dock, Paint tab, header score and Results face as `/sim`, so the two modes are one product: rows of painted areas with lot counts, outlines and Remove; the floating Scoreboard card and the floating brush toolbar go.

**Architecture:** `/`'s editor history learns a second kind of step, removing a row of ops, which reaches the worker as a `load` of the new plan (the host's `undo` only pops the last op, `src/lib/sim/host.ts:380-400`). Rows are derived from the op list with the same grouping `/sim` uses. A new editor-worker request, `opLots`, counts a row's eligible lots and returns its outlines through a packer shared with the scenario host. `BrushEditor` renders plan 2's `Dock` with plan 3's `PaintTab`, `HistoryButtons` and `PaletteStrip`; the page owns the `DockState`, the `HeaderScore` and the Results face (`ScoreboardPanel`, restyled). `/p/:id` gets the same, read-only.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, Tailwind 4, deck.gl, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-sim-ux-design.md` (Goals 1, 3, 5, 11, 12; anti-goal "Two paint experiences"). Builds on plans 1 to 4.

## Global Constraints

- Line numbers cited here predate earlier plans in the series; locate code by symbol.
- Tabs on `/`: Paint. The dock has two faces: the Paint tab and Results; the flip button on Results reads **"Paint"**, in the same place as `/sim`'s "Edit policy".
- The header score is the one `HeaderScore`: a headline number and a progress bar toward RHNA; `/` shows no "vs FZP" delta. Tapping it flips the dock to Results, which shows what the floating Scoreboard card shows today. The floating Scoreboard card goes away.
- Rows mean the same thing on both pages: a run of consecutive strokes at one height (erase strokes a run of erases). On `/`, rows are derived from the plan's op list. `/` gains a remove-row edit, lot counts, and row outlines (new requests in `/`'s editor worker).
- On `/` the live preview stays after release, because it is the plan (today's behaviour, unchanged).
- This replaces `BrushToolbar`'s floating panel. Undo and redo sit at the top of the dock; the keyboard shortcuts stay.
- Desktop: the dock open by default, collapsing to a rail; the header's "Paint" button toggles it. Phones: a bottom sheet with a peek handle, reachable from the Menu; Paint or Erase collapses it to the palette strip.
- Saved and shared plans open unchanged: the `Plan` shape (`src/lib/plan/types.ts`) and its codec do not change; a removal is a new op list.
- CSP unchanged; no new runtime dependencies; plan 1's tokens; WCAG 2.2 AA in both themes.
- Vitest `expect.requireAssertions`; colocated tests; Playwright for flows. 2-space indent, single quotes, no trailing commas, 100 columns. Conventional Commits with `-m` flags. Never `cd x && cmd`. No Claude attribution.

## Review Focus

1. **Remove a middle row, undo, redo, then paint a new stroke.** Expected: each step leaves the editor's ops and the worker's in step (the next Ctrl+Z after the stroke pops that stroke without a `bad-request`); the score and the map match a fresh load of the same plan. Test in Task 1 (editor and controller) and Task 3 (e2e).
2. **Remove pressed while a stroke is in progress** (touch on a phone with the sheet up, or a keyboard user mid-stamp). Expected: the stroke is cancelled first, then the row is removed; nothing half-commits. Test in Task 3.
3. **A row whose chunks are still loading.** Expected: "Finding lots…", then the count once the chunks arrive (asked again on each `chunks` message while lots are missing). Test in Task 2.
4. **`/p/:id`, read-only.** Expected: rows list and select (with outlines), no tools, no Remove, Ctrl+Z does nothing, and the Results face and header score match `/`. Test in Task 4.
5. **Autosave and Publish after a removal.** Expected: the autosaved plan is the new op list and restores to the same rows; Publish reads "Publish" again (the hash changed). Test in Task 3.

---

## File Structure

| File | Responsibility | Tasks |
| --- | --- | --- |
| `src/lib/brush/editor.svelte.ts` (+ spec) | history steps; `removeOps` | 1 |
| `src/lib/brush/BrushController.svelte.ts` (+ spec), `messages.ts` | undo/redo of a row step through `client.load` | 1 |
| `src/lib/paint/rows.ts` (+ spec) | `planRowGroups`, `planPaintRows` | 2 |
| `src/lib/sim/outlines.ts` (new, + spec) | `LotOutlines`, `packOutlines` (shared with the scenario host) | 2 |
| `src/lib/sim/protocol.ts`, `host.ts` (+ spec), `router.ts` (+ `worker-router.spec.ts`), `client.ts` (+ spec) | the `opLots` request; `RouterDeps.post` widened | 2 |
| `src/lib/sim-page/painted-outline.ts` (+ spec) | `paintedOutlineLayers` takes `LotOutlines` | 2 |
| `src/lib/sim/scenario/scenario-host.ts` | `lotOutlines` uses `packOutlines` | 2 |
| `src/lib/brush/row-lots.svelte.ts` (new, + spec) | rows' lot counts and the selected row's outline, latest wins | 2 |
| `src/lib/map/overlay-mux.ts`, `src/lib/paint/outline-layers.ts` (moved from `src/lib/sim-page/overlay-mux.ts`, `painted-outline.ts`) | shared overlay slots and outline layers | 3 |
| `src/lib/brush/BrushEditor.svelte` (+ specs) | the dock, Paint tab, strip, outlines, remove; status as pills | 3 |
| `src/lib/brush/BrushToolbar.svelte` (+ spec), `StoriesPopover.svelte` | deleted (`StoriesPopover` has no user left) | 3 |
| `src/routes/+page.svelte` (+ specs) | `DockState`, "Paint" button, header score, Results, notices | 3, 4 |
| `src/lib/scoreboard/ScoreboardPanel.svelte` (+ spec) | the Results face for `/`, tokens | 4 |
| `src/lib/scoreboard/Scoreboard.svelte` (+ spec) | deleted | 4 |
| `src/lib/sharing/NoticeStack.svelte` (+ spec) | renders its pills into BrushEditor's `notices` snippet (no `NoticePills` of its own) | 4 |
| `src/routes/p/[id]/+page.svelte` (+ spec) | the read-only dock, header score, Results | 4 |
| `e2e/brush.spec.ts`, `scoreboard.spec.ts`, `layout.spec.ts`, `share-*.spec.ts`, `chrome-dark.spec.ts`, `pages-a11y.spec.ts`, `map.spec.ts` | flows | 3, 4 |
| `docs/dev/developing.md`, `plan-sharing.md`, `map-interfaces.md`, `testing.md` | the brush hook, layout, insets | 3, 4 |

---

### Task 1: Removing a row is an undoable editor step

**Files:**
- Modify: `src/lib/brush/editor.svelte.ts`, `editor.svelte.spec.ts`
- Modify: `src/lib/brush/BrushController.svelte.ts:27-33, 254-272`, `BrushController.svelte.spec.ts`, `messages.ts` (a row-step message)
- Modify: `src/lib/sim-page/stroke-adapter.ts` (its `undo`/`redo` still return null; the type changes)

**Interfaces:**
- Consumes: `Plan`, `PlanOp`, `OPS_MAX`, `MAX_PLAN_BYTES`, `planByteSize` (`$lib/plan`).
- Produces:
  ```ts
  // editor.svelte.ts
  export type HistoryStep =
    | { kind: 'op'; op: PlanOp }                       // a stroke committed, undone or redone
    | { kind: 'rows'; plan: Plan; label: string };     // a row removed or restored: send `plan`
  export interface Editor {
    // … unchanged members …
    undo(): HistoryStep | null;
    redo(): HistoryStep | null;
    /** Removes the ops with these ids as one undoable step; false if read-only or none matched. */
    removeOps(ids: readonly string[], label: string): boolean;
  }
  // BrushController deps
  client: Pick<SimClient, 'commit' | 'undo' | 'prefetch' | 'datasetVersion'> &
    Partial<Pick<SimClient, 'preview' | 'cancelPreview' | 'load'>>;
  // messages.ts
  export function rowStepMessage(step: { label: string }, verb: 'Undid' | 'Redid'): string; // "Undid: Removed 8 stories"
  ```
  The editor keeps one past stack and one future stack of entries `{ kind: 'op'; op } | { kind: 'rows'; removed: { index: number; op: PlanOp }[]; label }`. `load` sets the past to one op entry per loaded op (so Undo still steps back through a restored plan, as `canUndo = plan.ops.length > 0` allows today, `editor.svelte.ts:58-60`) and clears the future; `commit` pushes an op entry; `removeOps` pushes a rows entry and clears the future. Undo of an op entry pops the last op (stack order guarantees it is last); undo of a rows entry puts the ops back at their indices; redo replays. `canUndo` is "the past is not empty and not read-only". `undo`/`redo` return a `rows` step with the plan after the change. `onLoad` never fires for these steps.
  `BrushController.undo()` / `redo()`: an `op` step does what it does today (`client.undo(op.id)` / `#commit(op)`); a `rows` step calls `client.load?.(step.plan)` and announces `rowStepMessage`.

- [ ] **Step 1: Write the failing tests**

`editor.svelte.spec.ts`:

```ts
it('removeOps removes a middle row as one step; undo restores the ops at their places', () => {
  const e = createEditor(plan([a, b1, b2, c]));
  expect(e.removeOps([b1.id, b2.id], 'Removed 8 stories')).toBe(true);
  expect(e.plan.ops).toEqual([a, c]);
  const u = e.undo()!;
  expect(u).toEqual({ kind: 'rows', plan: e.plan, label: 'Removed 8 stories' });
  expect(e.plan.ops).toEqual([a, b1, b2, c]);
  expect(e.redo()).toMatchObject({ kind: 'rows' });
  expect(e.plan.ops).toEqual([a, c]);
});
it('after a removal, a commit then undo pops the new op', () => {});
it('a loaded plan can still be undone op by op', () => {});
it('removeOps is refused read-only and for unknown ids', () => {});
it('a removal clears redo', () => {});
```

`BrushController.svelte.spec.ts`: undo of a `rows` step calls `client.load(step.plan)` (not `client.undo`) and announces "Undid: Removed 8 stories"; redo likewise with "Redid:"; an `op` step is unchanged.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/brush/editor.svelte.spec.ts` and `npx vitest --run --project client src/lib/brush/BrushController.svelte.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** as in Interfaces. Callers of `editor.undo()` that read an op (`BrushController` only; check with `grep -rn "\.undo()" src/lib/brush src/routes`) move to the step shape.

- [ ] **Step 4: Run the tests**

Run: the Step 2 commands, then `npx vitest --run --project client src/lib/brush src/lib/sim-page/stroke-adapter.spec.ts` and `npm run check`
Expected: PASS; 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/brush src/lib/sim-page/stroke-adapter.ts
git commit -m "feat(brush): removing a row of strokes is one undoable step"
```

---

### Task 2: Row lots and outlines from `/`'s worker

**Files:**
- Modify: `src/lib/paint/rows.ts`, `rows.spec.ts`
- Create: `src/lib/sim/outlines.ts`, `outlines.spec.ts`
- Modify: `src/lib/sim/protocol.ts:11-51`, `host.ts` (a handler beside `parcelSummary`, `:404-475`), `host.spec.ts`
- Modify: `src/lib/sim/router.ts:23, 44-56` (route `opLots` to the editor in editor mode; outside it answer `result: null`; widen `RouterDeps.post` from `ScenarioResponse | PlaybackResponse` to also take `SimResponse`, since `opLots` is a `SimResponse`), `worker-router.spec.ts`
- Modify: `src/lib/sim-page/painted-outline.ts:18-21`, `painted-outline.spec.ts` (`paintedOutlineLayers`' parameter widens from `Extract<LotOutlinesResult, { ok: true }>` to `LotOutlines`, so `RowLots.outline` fits; the layer output is unchanged)
- Modify: `src/lib/sim/client.ts` (`opLots`, its pending map like `parcelSummary`, `:108-116`), `client.spec.ts`
- Modify: `src/lib/sim/scenario/scenario-host.ts:1289-1330` (use `packOutlines`)
- Create: `src/lib/brush/row-lots.svelte.ts`, `row-lots.svelte.spec.ts`

**Interfaces:**
- Consumes: Task 1; plan 3's `PaintRow`, `LotStatus`; `index.covered(op)` and `index.get(id).eligible` (`parcel-index.ts:16-24`); `toLngLat` (`src/lib/generator/geo.ts:39`); `cellsIntersecting`, `opBBox`, the loader's `isReady`.
- Produces:
  ```ts
  // paint/rows.ts
  export interface PlanRowGroup { id: string; kind: 'paint' | 'erase'; stories: number | null; opIds: string[] }
  /** Consecutive ops of one kind (and, for paint, one height) form a row; its id is its first op's. */
  export function planRowGroups(ops: readonly PlanOp[]): PlanRowGroup[];
  export function planPaintRows(groups: readonly PlanRowGroup[], status: (id: string) => LotStatus): PaintRow[];
  // sim/outlines.ts
  export interface LotOutlines { lots: ParcelId[]; ringLot: Uint32Array; starts: Uint32Array; positions: Float64Array }
  export function packOutlines(
    recs: readonly { id: ParcelId; polygon: ParcelRecord['polygon']; labelPoint: [number, number] }[]
  ): { outlines: LotOutlines; transfer: ArrayBuffer[] };
  // sim/protocol.ts
  | { type: 'opLots'; reqId: number; opIds: string[]; outlines: boolean }   // SimRequest
  | { type: 'opLots'; reqId: number; result: OpLotsResult | null }          // SimResponse
  /** The eligible loaded lots the ops cover (union); `missing` the ops' cells not loaded yet. */
  export interface OpLotsResult { lots: number; missing: number; outline: LotOutlines | null }
  // sim/client.ts
  opLots(opIds: string[], outlines: boolean): Promise<OpLotsResult | null>; // null: no worker state, crashed or disposed
  // brush/row-lots.svelte.ts
  export class RowLots {
    constructor(deps: { request(opIds: string[], outlines: boolean): Promise<OpLotsResult | null> });
    /** Asks for every row whose op ids changed since its last answer; forgets rows that are gone. */
    want(groups: readonly PlanRowGroup[]): void;
    /** 'finding' until answered with missing 0, then 'found'. */
    status(id: string): LotStatus;
    /** The selected row's outline (asked with outlines: true), or null. */
    readonly outline: LotOutlines | null;
    select(id: string | null): void;
    /** A `chunks` message: ask again for rows answered with missing > 0. */
    chunksChanged(): void;
    /** A worker restart: everything is asked again. */
    reset(): void;
  }
  ```
  Unknown op ids are skipped by the host. `LotOutlinesResult`'s ok shape becomes `LotOutlines & { ok: true; missing: number }` (same fields, so `outline-request.ts` is unchanged; `paintedOutlineLayers` takes `LotOutlines` as above). Builder's call: `RowLots` keeps one request in flight and a queue, since a long plan can have many rows.

- [ ] **Step 1: Write the failing tests**

`rows.spec.ts`: `planRowGroups` groups `[p8, p8, p6, e, e, p8]` into four rows (`p8×2`, `p6`, `e×2`, `p8`) with the first op ids; `planPaintRows` carries the statuses.
`outlines.spec.ts`: one ring per polygon ring, `starts` cumulative, `positions` the lng/lat of `toLngLat`, `transfer` the three buffers.
`host.spec.ts`: on the mini dataset, `opLots` for two overlapping paint ops counts the union of their eligible covered lots, `missing` 0 once their chunks are loaded and > 0 before; `outlines: true` returns rings for exactly those lots; before `init` the answer is `result: null`.
`worker-router.spec.ts`: `opLots` goes to the editor in editor mode and is answered `result: null` in scenario mode (through the widened `RouterDeps.post`).
`client.spec.ts`: `opLots` resolves by `reqId`; after a crash it resolves null.
`row-lots.svelte.spec.ts`: `want` asks once per changed row; an unchanged row is not asked again; a growing last row is asked again; `missing > 0` stays `finding` and `chunksChanged` asks again; `select` asks with `outlines: true` and exposes `outline`; an answer for a row since changed is dropped.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/paint src/lib/sim/outlines.spec.ts src/lib/sim/host.spec.ts src/lib/sim/worker-router.spec.ts src/lib/sim/client.spec.ts src/lib/brush/row-lots.svelte.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** as in Interfaces.

- [ ] **Step 4: Run the tests**

Run: the Step 2 command, then `npx vitest --run --project server src/lib/sim` (the scenario host's outline specs must pass unchanged on the shared packer)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/paint src/lib/sim src/lib/sim-page/painted-outline.ts src/lib/sim-page/painted-outline.spec.ts src/lib/brush/row-lots.svelte.ts src/lib/brush/row-lots.svelte.spec.ts
git commit -m "feat(brush): count and outline a painted row's lots in the editor worker"
```

---

### Task 3: `BrushEditor` on the dock

**Files:**
- Move: `src/lib/sim-page/overlay-mux.ts` (+ spec) → `src/lib/map/overlay-mux.ts`; `src/lib/sim-page/painted-outline.ts` (+ spec) → `src/lib/paint/outline-layers.ts` (`git mv`; update `SimPage.svelte`'s imports)
- Modify: `src/lib/brush/BrushEditor.svelte`, `BrushEditor.svelte.spec.ts`, `BrushEditor.inset.svelte.spec.ts`, `BrushEditor.load.svelte.spec.ts`, `BrushEditor.restart.svelte.spec.ts`, `BrushEditor.title.svelte.spec.ts`
- Delete: `src/lib/brush/BrushToolbar.svelte`, `BrushToolbar.svelte.spec.ts`, `StoriesPopover.svelte`
- Modify: `src/routes/+page.svelte`, `src/routes/page.svelte.spec.ts`, `page.header.svelte.spec.ts`
- Modify: `src/lib/brush/debug.ts` (the hook keeps `ops`, `lastStats`, `ready`, `chunks`, `load`; add `rows: number`)
- Modify: `src/lib/shell/accent.spec.ts` (`THEMED_FILES` += `src/lib/brush/BrushEditor.svelte`)
- Modify: `e2e/brush.spec.ts`, `e2e/map.spec.ts`, `e2e/layout.spec.ts`; `docs/dev/map-interfaces.md`, `docs/dev/developing.md`, `docs/dev/testing.md` (the brush hook)

**Interfaces:**
- Consumes: Tasks 1 and 2; plan 2's `Dock`, `DockState`, `DOCK_ICONS`; plan 3's `PaintTab`, `HistoryButtons`, `PaletteStrip`, `PAINT_TOOLS`; plan 1's `NoticePills`, `PILL`.
- Produces:
  ```ts
  // BrushEditor props (new)
  dock: DockState;          // the page's; tab 'paint'
  dockId: string;           // for the page's "Paint" button and the score's aria-controls
  results?: Snippet;        // the page's Results face
  notices?: Snippet;        // the page's own notices (/: NoticeStack's items), rendered in BrushEditor's one NoticePills, as FzpMode's `notices`
  ```
  `BrushEditor` renders (root class `brush-editor sfh-dock-host`): SimMap; the `Dock` (`label="Paint"`, `tabs=[{ id: 'paint', label: 'Paint', icon: DOCK_ICONS.paint }]`, `top` = `HistoryButtons` with `editor.canUndo`/`canRedo`, labels null, `onundo`/`onredo` → the controller, `panel` = `PaintTab` with `brush`, `tool = brush.tool`, `ontool = onToolChange` (below md, choosing Paint or Erase also sets `dock.sheet = 'closed'` so the strip shows; `PaletteStrip` calls `ontool` and relies on it), `rows = planPaintRows(planRowGroups(editor.plan.ops), rowLots.status)`, `selected`, `onselect`, `onremove = removeRow`, `eraseHint = MSG.eraseHint`, `readonly = editor.readOnly`; `results`; `flipLabel="Paint"`, `onflip` → `dock.showEdit('paint')`); the `PaletteStrip` below md while a stroke tool is chosen and the sheet is closed; the brush status line and its Retry, and the read-only status (`BrushEditor.svelte:409-425`), as pills in the one `NoticePills` (with `PILL`), followed by `{@render notices?.()}`: the page's notices go into that same container, so there is one stack and one `fzp-notices` testid, never a second `NoticePills`. An overlay mux (`createOverlayMux`) owns `handle.setOverlayLayers`: the controller writes `ring`, and the selected row's outline (`rowLots.outline` through `paintedOutlineLayers`) writes `outline`. `removeRow(id)`: `controller?.cancelStroke()`, `editor.removeOps(group.opIds, \`Removed ${rowName(group)}\`)`, `client.load(editor.plan)`, announce the label, clear the selection. `rowLots.want(groups)` runs on every plan change; `rowLots.chunksChanged()` on each `chunks` message; `rowLots.reset()` on a restart. The map's bottom inset below md is the sheet's height from `onsheetheight` (the `--brushbar-h` and `--scorebar-h` arithmetic, `BrushEditor.svelte:255-268`, goes; `setSheetInset` goes with the Scoreboard in Task 4).
  `+page.svelte`: `dock = new DockState({ tab: 'paint' })`, opened on mount from md; a "Paint" header action (`aria-expanded={dock.visible(wide)}`, `aria-controls={dockId}`) toggling it, before View and Publish.
  Builder's calls: the "Paint" header button shares its name with the "Paint" mode link (spec Goal 12); they are distinct roles (a link with `aria-current`, a button with `aria-expanded`); the keyboard shortcuts table moves behind `HistoryButtons`' ⓘ.

- [ ] **Step 1: Write the failing tests**

`BrushEditor.svelte.spec.ts` (fake worker, as today):

```ts
it('renders the dock with the Paint tab: tools, height, size and no rows on an empty plan', async () => {});
it('two strokes at one height make one row; a new height starts another', async () => {});
it('a row shows its lot count once the worker answers opLots', async () => {});
it('selecting a row asks for its outline and draws it in the outline slot', async () => {});
it('Remove on the selected row loads the new plan and Undo loads it back', async () => {
  // w.lastOf('load').plan.ops after Remove lacks the row's ops; after Ctrl+Z they are back at their places
});
it('Remove during a stroke cancels the stroke first', async () => {});
it('the status line and Retry are pills in the notice stack, together with the page\'s `notices` snippet in one `fzp-notices`', async () => {});
it('below md a stroke tool shows the palette strip; Done reopens the sheet on Paint', async () => {});
it('read-only (/p/:id): rows only; no tools, no Remove; Ctrl+Z does nothing', async () => {});
```

Retarget the existing BrushEditor specs from the toolbar to the dock (the tool radios keep the names Move, Paint, Erase in the group "Brush tool"; Undo and Redo are `HistoryButtons`).
`page.svelte.spec.ts`: "the header has a Paint button that toggles the dock"; "an autosave after a row removal restores the same rows".

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project client src/lib/brush src/routes/page.svelte.spec.ts src/routes/page.header.svelte.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** as in Interfaces; delete `BrushToolbar` and `StoriesPopover` (`grep -rn "StoriesPopover\|BrushToolbar" src` must come back empty, ignoring comment lines: `RadiusPopover.svelte:2`, `TimeScrubber.svelte:327` and `NoticeStack.svelte:64` only mention them in comments, so reword those comments or filter comments out of the gate).

- [ ] **Step 4: Run the tests and e2e**

Run: the Step 2 command, then `npx vitest --run --project client src/lib/sim-page` (the moved modules), `npx vitest --run --project server src/lib/shell/accent.spec.ts`, then `npx playwright test e2e/brush.spec.ts e2e/map.spec.ts e2e/layout.spec.ts --project=chromium --project=mobile`. Add to `brush.spec.ts`: paint two heights, remove the first row, reload, see one row; and remove a middle row, undo, redo, paint, Ctrl+Z, and compare `__sfhBrush.ops` with the rows. The layout tests that measured the toolbar column measure the dock.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib src/routes e2e docs/dev
git commit -m "feat(paint): / paints from the shared dock and Paint tab"
```

---

### Task 4: The header score and Results on `/` and `/p/:id`

**Files:**
- Modify: `src/lib/scoreboard/ScoreboardPanel.svelte`, `ScoreboardPanel.svelte.spec.ts` (tokens; it is the Results body)
- Delete: `src/lib/scoreboard/Scoreboard.svelte`, `Scoreboard.svelte.spec.ts`
- Modify: `src/lib/scoreboard/TargetRow.svelte`, `NeighborhoodList.svelte` (tokens)
- Modify: `src/lib/sharing/NoticeStack.svelte` (+ spec): render only its `PILL` items, to be passed to BrushEditor as the `notices` snippet and so land inside BrushEditor's one `NoticePills` (no `NoticePills` of its own, no second `fzp-notices`); drop its toolbar-column placement and `--notice-stack-h`
- Modify: `src/routes/+page.svelte`, `src/routes/page.view.svelte.spec.ts`, `src/routes/p/[id]/+page.svelte`, `src/routes/p/[id]/page.view.svelte.spec.ts`
- Modify: `src/lib/shell/accent.spec.ts` (`THEMED_FILES` += `ScoreboardPanel.svelte`, `TargetRow.svelte`, `NeighborhoodList.svelte`, `NoticeStack.svelte`)
- Modify: `e2e/scoreboard.spec.ts`, `e2e/share-*.spec.ts`, `e2e/chrome-dark.spec.ts`, `e2e/pages-a11y.spec.ts`; `docs/dev/plan-sharing.md` (notices, the view), `docs/dev/map-interfaces.md` (no `--scorebar-h`)

**Interfaces:**
- Consumes: plan 2's `HeaderScore`; `announcement`, `primaryTarget`, `viewState` (`src/lib/scoreboard/view.ts`); Task 3's BrushEditor props.
- Produces: on `/` and `/p/:id`, the page derives `shown = $derived(score ?? EMPTY)` and `scoreView = $derived(viewState(shown, status))` itself (`shown` and `view` were `Scoreboard.svelte`'s internals, `:27-28`; `view` is already `ViewPrefs` in `+page.svelte:89`, so use `scoreView`, never `view`; `EMPTY` is imported as `Scoreboard.svelte` does). Then `useHeaderActions(headerActions, { pinned: score, status })` where `score` renders `HeaderScore` with `total = shown.netUnits`, `target = primaryTarget(shown) ?? null`, no `delta`, `busy = scoreView.updating`, `expanded = dock.face === 'results' && dock.visible(wide)`, `controls = dockId`, `onclick` → `dock.toggleResults(wide)`, `live = announcement(shown)`, `quiet = scoreView.updating`. `/` passes `notices` (a snippet rendering `NoticeStack`) to `BrushEditor`; `/p/:id` does the same for its own notices. The Results snippet renders `ScoreboardPanel` (score, status, `onretry` → `brushEditor.retryChunks()`). `/p/:id` passes `readOnly` and the same dock, header score and Results, and opens on the Paint tab (rows, no tools). `--scorebar-h` and `BrushEditor.setSheetInset` are deleted.

- [ ] **Step 1: Write the failing tests**

`page.view.svelte.spec.ts`: "the header score shows the net homes and the RHNA bar; pressing it shows Results with the scoreboard's content and a Paint button that flips back"; "there is no Housing scoreboard region".
`p/[id]/page.view.svelte.spec.ts`: "a shared plan shows the header score, a read-only Paint tab with its rows, and Results".
`ScoreboardPanel.svelte.spec.ts`: keep its content assertions; add that it renders no `bg-white`.
`NoticeStack.svelte.spec.ts`: rendered through BrushEditor's `notices` snippet, its notices sit inside the single `fzp-notices` (the page has exactly one), toasts still dismiss after 8 s.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project client src/routes src/lib/scoreboard src/lib/sharing/NoticeStack.svelte.spec.ts` and `npx vitest --run --project server src/lib/shell/accent.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** as in Interfaces; delete `Scoreboard.svelte` and its spec (`grep -rn "Scoreboard.svelte\|scorebar-h\|setSheetInset" src e2e docs/dev` must come back empty apart from history notes).

- [ ] **Step 4: Run the tests and e2e**

Run: the Step 2 commands, then `npx playwright test e2e/scoreboard.spec.ts e2e/share-a11y.spec.ts e2e/share-notices.spec.ts e2e/share-roundtrip.spec.ts e2e/share-states.spec.ts e2e/chrome-dark.spec.ts e2e/pages-a11y.spec.ts --project=chromium --project=mobile`. Rewrite `scoreboard.spec.ts` around the header score and the Results region (its numbers, updating state, the failed-chunks Retry, the neighbourhood list); `chrome-dark.spec.ts`'s `openScoreboard` becomes "press the header score"; add dark axe runs on `/`'s dock and Results; the 375 px no-horizontal-scroll and footer checks keep passing with the sheet's handle.
Expected: PASS.

- [ ] **Step 5: Full gate, docs and commit**

Run: `npm run lint`, `npm run check`, `npm run test:unit`. Expected: clean, 0 errors, PASS.

```bash
git add -A src e2e docs/dev
git commit -m "feat(score): / and shared plans use the header score and the Results face"
```

---

## Open questions

None. Decided here:

1. **`/p/:id` (shared plans)** gets the dock, the header score and the Results face, with a read-only Paint tab (Task 4): the spec's Goal 5 says the score looks the same in both modes, and keeping the floating Scoreboard on `/p/:id` would leave two score UIs. It opens on the Paint tab.
2. **`/`'s plan-sharing notices** (N1 to N3, the Remix toast, `NoticeStack`) move into the one pill stack that `BrushEditor` renders, through its `notices` snippet (Tasks 3 and 4): spec Goal 8, one notice style.
