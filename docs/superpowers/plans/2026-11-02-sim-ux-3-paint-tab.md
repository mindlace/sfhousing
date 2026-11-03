# /sim UX, plan 3 of 5: the shared Paint tab and live preview on `/sim` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the one Paint tab both modes will use (tools, a height palette, brush size, a list of painted areas you select and remove), put it in `/sim`'s dock, and replace `/sim`'s post-stroke flash with a live preview under the brush that fades on release.

**Architecture:** New mode-agnostic components in `src/lib/paint/` (`PaintTab`, `HeightPalette`, `PaletteStrip`, `HistoryButtons`) take a `BrushState`, the tool and a list of `PaintRow`s; each page derives its rows (`/sim` from `policy.custom`, `/` from its op list in plan 5). On `/sim` the stroke adapter's client gains `preview` and `cancelPreview`, served by a `StrokePreview` that resolves the stroke's lots and asks the worker's existing `previewBuildings`; `BrushController` already rate-limits previews to one in flight, and a new `previewDone(rev)` lets it know an answer came. `PaintFeedback` shows the live buildings and fades them on release.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, Tailwind 4, deck.gl (already in the bundle), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-sim-ux-design.md` (Goal 3; Goal 11 for the strip; Problem 3). Builds on plans 1 and 2. Plan 5 puts these components on `/`.

## Global Constraints

- One Paint tab component, used by both modes. Anti-goal: two paint experiences that drift.
- Tools: Move / Paint / Erase. Height: a palette of swatches (`STORY_PRESETS`, `src/lib/brush/radius.ts:51`: 2, 3, 4, 6, 8, 12, 20, 40) plus the stepper for other values (1 to 80). Brush size.
- Painted areas: a list; each row has a swatch, an auto name, its stroke and lot counts, and Remove when selected. Selecting one outlines it on the map. Creation order, later wins, no reordering (Move up/down go). Erase areas are rows too, with an eraser swatch.
- A row is a run of consecutive strokes at one height, as `/sim`'s brushes already group them (`stroke-adapter.ts:22-39`).
- Live preview while dragging: buildings appear under the brush ring mid-stroke, showing what the painted lots could hold (the paint feedback's computation), rate-limited during the stroke, one request in flight. On `/sim` the preview fades out on release. This replaces the post-stroke flash.
- No building flash on transit edits (spec Goal 2, my call): the saved-rule feedback goes too.
- Height swatches use the neutral ink look: the story number on a neutral tile, no hue ramp.
- Undo and redo sit at the top of the dock; the keyboard shortcuts stay.
- Phones: choosing Paint or Erase collapses the sheet to a one-line palette strip (tool, height swatch, size, Done), the same component on `/` and `/sim`.
- CSP unchanged; no new runtime dependencies; plan 1's tokens; WCAG 2.2 AA in both themes; anything draggable has a non-drag alternative (the keyboard stamp stays).
- Vitest `expect.requireAssertions`; colocated tests; Playwright for flows. 2-space indent, single quotes, no trailing commas, 100 columns. Conventional Commits with `-m` flags. Never `cd x && cmd`. No Claude attribution.

## Review Focus

1. **Release before the first preview answer arrives.** Expected: the late answer is dropped; nothing reappears after the fade. Test in Task 4.
2. **A stroke cancelled mid-drag** (Escape, a second finger, a tool change). Expected: the live buildings clear at once; the next stroke's first preview is not held up. Test in Task 4.
3. **An Erase drag on `/sim`.** Expected: no live buildings (erasing removes paint; the dashed paint-mode lines show the effect), and the controller still sees each preview answered. Test in Task 4.
4. **Removing the selected painted area, or undoing the stroke that created it.** Expected: the selection clears in the same render and its outline goes; Redo does not bring the selection back. Test in Task 3.
5. **Run pressed mid-stroke or during the fade.** Expected: the preview clears and no answer still on its way is shown. Test in Task 4.

---

## File Structure

| File | Responsibility | Tasks |
| --- | --- | --- |
| `src/lib/paint/rows.ts` (new, + spec) | `PaintRow`, `LotStatus`, `rowName`, `rowMeta`, `simPaintRows` | 1 |
| `src/lib/paint/tools.ts` (new) | `PAINT_TOOLS` with icon paths (moved from `BrushToolbar.svelte:22-47`) | 1 |
| `src/lib/paint/HeightPalette.svelte` (new, + spec) | swatches and the stepper | 1 |
| `src/lib/paint/HistoryButtons.svelte` (new, + spec) | Undo, Redo and the shortcuts ⓘ | 1 |
| `src/lib/paint/PaintTab.svelte` (new, + spec, `test/PaintTabHost.svelte`) | the tab | 2 |
| `src/lib/sim-page/brush-summary.ts` | `LotStatus`, `lotsText` re-exported from `paint/rows.ts` | 1 |
| `src/lib/sim-page/selection.ts` (new, + spec) | `DockSelection`, `liveSelection`, `limitsViewOf` | 3 |
| `src/lib/sim-page/SimPage.svelte` (+ spec) | Paint tab, selection, outlines, preview wiring | 3, 4, 5 |
| `src/lib/sim-page/CustomZoningSection.svelte` (+ spec), `HistoryRow.svelte` (+ spec), `PhoneToolBar.svelte` (+ spec) | deleted | 3, 5 |
| `src/lib/sim-page/BrushCard.svelte` | rules only (no Move up/down) | 3 |
| `src/lib/brush/BrushController.svelte.ts` (+ spec) | `previewDone(rev)` | 4 |
| `src/lib/sim-page/stroke-preview.ts` (new, + spec) | the live preview's requests, latest wins | 4 |
| `src/lib/sim-page/stroke-adapter.ts` (+ spec) | `preview`, `cancelPreview`; no `onpaint` | 4 |
| `src/lib/sim-page/feedback.ts` (+ spec) | `PaintFeedback.live/release/clear`; `RuleFeedbackTrigger` deleted | 4 |
| `src/lib/sim-page/debug.ts` (new) | `window.__sfhSim.preview` (VITE_E2E only) | 4 |
| `src/lib/paint/PaletteStrip.svelte` (new, + spec) | the phone strip | 5 |
| `e2e/sim.spec.ts`, `e2e/chrome-dark.spec.ts`; `docs/dev/sim-page.md` | flows, docs | 3, 4, 5 |

---

### Task 1: Rows, the height palette and the history buttons

**Files:**
- Create: `src/lib/paint/rows.ts`, `rows.spec.ts`, `tools.ts`, `HeightPalette.svelte`, `HeightPalette.svelte.spec.ts`, `HistoryButtons.svelte`, `HistoryButtons.svelte.spec.ts`
- Modify: `src/lib/sim-page/brush-summary.ts:99-140` (move `LotStatus` and `lotsText` out, re-export)

**Interfaces:**
- Consumes: `BrushState` (`setStories`, `stories`, `phase`), `STORY_PRESETS`, `heightHintM` (`radius.ts`), `SHORTCUTS` (`shortcuts.ts`), `customLotStatus`, `count` (`brush-summary.ts`).
- Produces:
  ```ts
  // rows.ts
  export type LotStatus =
    { kind: 'found'; lots: number } | { kind: 'finding' } | { kind: 'failed'; keys: string[] };
  export function lotsText(s: LotStatus): string; // moved verbatim
  export interface PaintRow {
    id: string;                 // /sim: the custom brush id; /: the row's first op id
    kind: 'paint' | 'erase';
    stories: number | null;     // null for erase
    strokes: number;
    lots: LotStatus;
  }
  /** "8 stories", "1 story", "Erased". */
  export function rowName(r: Pick<PaintRow, 'kind' | 'stories'>): string;
  /** "3 strokes · 52 lots". */
  export function rowMeta(r: PaintRow): string;
  /** /sim: one row per custom brush, in policy order. */
  export function simPaintRows(
    p: SimPolicy,
    result: (key: string) => BrushLotsResult | undefined
  ): PaintRow[];
  // tools.ts
  export const PAINT_TOOLS: readonly { id: BrushTool; label: string; icon: readonly string[] }[];
  export const HISTORY_ICONS: { undo: readonly string[]; redo: readonly string[] };
  ```
  `HeightPalette.svelte`: `{ brush: BrushState; disabled?: boolean; hint?: string }`. A `role="group"` named "Height": one button per preset (`aria-pressed`, name "{n} stories", the number on a neutral tile: `bg-surface-raised text-ink dark:bg-surface-dark-raised dark:text-ink-dark`, pressed `bg-ink text-surface dark:bg-ink-dark dark:text-surface-dark`), then the stepper (Fewer stories, the number input, More stories, "≈ N m"), all disabled with `hint` as their description while `disabled` (the behaviour of `StoriesPopover.svelte:45-116`, which stays for `/` until plan 5).
  `HistoryButtons.svelte`: `{ canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null; onundo(): void; onredo(): void }`. Two icon buttons named "Undo: {label}" / "Undo" (and Redo), `title` the same, then an ⓘ disclosure (`<details>`, summary named "Keyboard shortcuts") holding the `SHORTCUTS` table, hidden on coarse pointers (as `BrushToolbar.svelte:222-244`).

- [ ] **Step 1: Write the failing tests**

`rows.spec.ts` (server):

```ts
it('names rows by height or as erased', () => {
  expect(rowName({ kind: 'paint', stories: 8 })).toBe('8 stories');
  expect(rowName({ kind: 'paint', stories: 1 })).toBe('1 story');
  expect(rowName({ kind: 'erase', stories: null })).toBe('Erased');
});
it('simPaintRows: one row per custom brush in order, with strokes and lot status', () => {
  const p = { ...DEFAULT_POLICY, custom: [paint('a', 8, 3), erase('b', 1)] };
  const rows = simPaintRows(p, (k) => (k === queryKey(customQuery(p.custom[0])) ? found(52) : undefined));
  expect(rows).toEqual([
    { id: 'a', kind: 'paint', stories: 8, strokes: 3, lots: { kind: 'found', lots: 52 } },
    { id: 'b', kind: 'erase', stories: null, strokes: 1, lots: { kind: 'finding' } }
  ]);
  expect(rowMeta(rows[0])).toBe('3 strokes · 52 lots');
});
```

`HeightPalette.svelte.spec.ts`: pressing "12 stories" sets `brush.stories` to 12 and only that swatch is pressed; the stepper's More stories goes 12 → 13 and no swatch is pressed; `disabled` disables every control and describes them by `hint`.
`HistoryButtons.svelte.spec.ts`: names include the labels; disabled when `canUndo` is false; the shortcuts disclosure lists `SHORTCUTS`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/paint` and `npx vitest --run --project client src/lib/paint`
Expected: FAIL.

- [ ] **Step 3: Implement** as in Interfaces; `brush-summary.ts` imports and re-exports `LotStatus` and `lotsText`, so its callers are unchanged.

- [ ] **Step 4: Run the tests**

Run: the Step 2 commands, then `npx vitest --run --project server src/lib/sim-page`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/paint src/lib/sim-page/brush-summary.ts
git commit -m "feat(paint): painted-area rows, a height palette and history buttons"
```

---

### Task 2: `PaintTab`

**Files:**
- Create: `src/lib/paint/PaintTab.svelte`, `PaintTab.svelte.spec.ts`, `test/PaintTabHost.svelte`

**Interfaces:**
- Consumes: Task 1; `RadiusPopover` (`src/lib/brush/RadiusPopover.svelte`, `inline`).
- Produces:
  ```ts
  interface Props {
    brush: BrushState;
    tool: BrushTool;
    ontool(t: BrushTool): void;       // the page routes it through the controller
    rows: readonly PaintRow[];
    selected: string | null;          // a row id
    onselect(id: string | null): void;
    onremove(id: string): void;
    eraseHint: string;                // /sim: ERASE_HINT; /: MSG.eraseHint
    /** /p/:id (plan 5): rows only, no tools, no Remove. */
    readonly?: boolean;
    /** A row's lot lookup failed: retry its keys (/sim: sync.retry). */
    onretry?: (keys: string[]) => void;
  }
  ```
  Markup: a `role="radiogroup"` named "Brush tool" with Move, Paint, Erase as `role="radio"` buttons (roving tabindex, arrows, Paint and Erase disabled until `brush.phase === 'ready'`, as `CustomZoningSection.svelte:36-61`); `HeightPalette` (disabled while Erase, with `eraseHint`); "Brush size" (`RadiusPopover inline`); then, when there are rows, `<ol aria-label="Painted areas">`, each `<li>` with a select button (`aria-pressed={selected === row.id}`, `data-paint-row={row.id}`, holding the swatch, `rowName`, and `rowMeta` whose lot part is a polite `role="status"`), Retry when `lots.kind === 'failed'`, and when selected a Remove button named "Remove: {rowName} · {rowMeta}". Pressing a selected row unselects it. After Remove, focus moves to the row now at that index, the one before it, or the checked tool radio (the rule of `CustomZoningSection.svelte:63-71`). The erase swatch is an eraser glyph on the same neutral tile.

- [ ] **Step 1: Write the failing tests**

`PaintTab.svelte.spec.ts` through `PaintTabHost` (holds `selected` and records `ontool`, `onremove`):
- the three tool radios; arrow keys move between enabled ones; Paint and Erase are disabled while `brush.phase` is `'loading'`;
- Erase disables the height palette with the hint;
- rows render in order with name and meta; pressing a row sets `selected` (and `aria-pressed`), shows its Remove; pressing it again clears `selected`;
- Remove calls `onremove(id)` and focus lands on the next row, then on the checked tool when none is left;
- `readonly`: no radiogroup, no palette, no size, no Remove; rows still select;
- a failed row shows Retry, which calls `onretry(keys)`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project client src/lib/paint/PaintTab.svelte.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** as in Interfaces, with plan 1's tokens (a selected row `border-accent dark:border-accent-dark` with a raised surface).

- [ ] **Step 4: Run the tests**

Run: the Step 2 command
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/paint
git commit -m "feat(paint): the Paint tab shared by both modes"
```

---

### Task 3: `/sim`'s Paint tab, selection and outlines

**Files:**
- Create: `src/lib/sim-page/selection.ts`, `selection.spec.ts`
- Modify: `src/lib/sim-page/SimPage.svelte:453-583` (selection, limits mode, outlines), the Dock's `panel` and `top` snippets, `SimPage.svelte.spec.ts`
- Modify: `src/lib/sim-page/BrushCard.svelte` (drop `list="custom"`, Move up/down), `BrushCard.svelte.spec.ts`, `RulesSection.svelte` (selection props renamed below)
- Delete: `src/lib/sim-page/CustomZoningSection.svelte`, `CustomZoningSection.svelte.spec.ts`, `HistoryRow.svelte`, `HistoryRow.svelte.spec.ts`
- Modify: `e2e/sim.spec.ts` (the custom zoning tests: rows, select, remove)

**Interfaces:**
- Consumes: Tasks 1 and 2; `OutlineRequest` (`outline-request.ts`), `paintedLots`, `customQuery`, `queryKey`, `customChangeLabel`.
- Produces:
  ```ts
  // selection.ts
  export type DockSelection = { kind: 'rule'; id: string } | { kind: 'paint'; id: string } | null;
  /** `sel`, or null once its rule or brush has left the policy (Remove, Undo, a restore). */
  export function liveSelection(sel: DockSelection, p: SimPolicy): DockSelection;
  /** A selected rule → rule mode; a selected painted area, or Paint/Erase chosen (edit) → paint; else plain. */
  export function limitsViewOf(sel: DockSelection, tool: SimTool, mode: 'edit' | 'view'): LimitsView;
  ```
  SimPage replaces `pickedRule` / `selectedRule` (`:453-517`) with `picked = $state.raw<DockSelection>(null)` and `selection = $derived(liveSelection(picked, store.policy))` (the effect that forgets a gone selection stays, so Redo does not restore it). RulesSection's `selectedRule` / `onselectrule` read and write `{ kind: 'rule', id }` (its "Show on map" stays until plan 4). The Paint tab: `rows = simPaintRows(store.policy, (k) => sync.result(k))`, `selected = selection?.kind === 'paint' ? selection.id : null`, `onremove(id)` → `store.apply(p => ({ ...p, custom: p.custom.filter(b => b.id !== id) }), \`Removed: ${customChangeLabel(b)}\`)` and announce it; `onretry` → `sync.retry`. The outline request wants, in order: the selected painted area's lots (its `customQuery` result; an erase area's too), else the painted lots while Erase is chosen (today's rule, `:559-574`), else nothing. The dock's `top` is `HistoryButtons` over the store (`undoLabel`, `redoLabel`, `canUndo`, `canRedo`) with SimPage's `undo`/`redo`.

- [ ] **Step 1: Write the failing tests**

`selection.spec.ts`: `liveSelection` keeps a rule or brush still in the policy and drops one that is gone; `limitsViewOf` gives `{ kind: 'rule', ruleId }` for a rule (winning over the tool), `{ kind: 'paint' }` for a painted area or for Paint/Erase in edit, `{ kind: 'plain' }` for Move or in view.

`SimPage.svelte.spec.ts`:

```ts
it('a Paint stroke adds a row to the Paint tab with its stroke and lot counts', async () => {});
it('selecting a painted area asks for its outlines; unselecting drops them', async () => {
  const { w } = await readySimWithPaint(); // one custom brush resolved
  await page.getByRole('tab', { name: 'Paint' }).click();
  await page.locator('[data-paint-row]').first().click();
  await expect.poll(() => w.lastOf('lotOutlines')?.lots).toEqual(brushLots);
});
it('Remove on the selected area is one change Undo names; the selection clears', async () => {});
it('undoing the stroke that made the selected area clears the selection; Redo does not restore it', async () => {});
```

Delete the custom-brush Move up/down tests in `BrushCard.svelte.spec.ts`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/sim-page/selection.spec.ts` and `npx vitest --run --project client src/lib/sim-page/SimPage.svelte.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** as in Interfaces; delete the four files.

- [ ] **Step 4: Run the tests and e2e**

Run: the Step 2 commands, then `npx vitest --run --project client src/lib/sim-page`, then `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/sim.spec.ts` (retarget the custom zoning tests: `getByRole('list', { name: 'Painted areas' })` instead of `'Custom zoning'`).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/sim-page e2e/sim.spec.ts
git commit -m "feat(sim): the Paint tab lists painted areas you select and remove"
```

---

### Task 4: Live preview while painting on `/sim`

**Files:**
- Modify: `src/lib/brush/BrushController.svelte.ts:191-206`, `BrushController.svelte.spec.ts`
- Create: `src/lib/sim-page/stroke-preview.ts`, `stroke-preview.spec.ts`, `src/lib/sim-page/debug.ts`
- Modify: `src/lib/sim-page/stroke-adapter.ts`, `stroke-adapter.spec.ts`
- Modify: `src/lib/sim-page/feedback.ts`, `feedback.spec.ts`
- Modify: `src/lib/sim-page/SimPage.svelte:319-324, 392-402, 585-688, 745-754, 927`, `SimPage.svelte.spec.ts`
- Modify: `e2e/sim.spec.ts`; `docs/dev/sim-page.md` ("Paint feedback" becomes "Live preview")

**Interfaces:**
- Consumes: `customQuery`, `queryKey`, `lotsInView` (`feedback.ts:140-160`), `PREVIEW_MAX_LOTS`, `SimClientApi.resolveBrush` / `previewBuildings`, `packedCellLayer`.
- Produces:
  ```ts
  // BrushController
  /** A preview at or above the one in flight was answered without a diff (/sim): stop waiting. */
  previewDone(rev: number): void; // onDiff's first line delegates here
  // stroke-preview.ts
  export interface StrokePreviewDeps {
    resolve(q: BrushQuery): Promise<BrushLotsResult>;
    buildings(lots: ParcelId[], stories: number): Promise<PreviewResult>;
    /** The stroke's lots nearest `at` (the brush ring) inside the view, at most PREVIEW_MAX_LOTS. */
    nearest(lots: readonly ParcelId[], points: Float64Array, at: [number, number]): ParcelId[];
    live(pack: PackedCell | null): void;   // PaintFeedback.live
    release(): void;                        // PaintFeedback.release (fade)
    clear(): void;                          // PaintFeedback.clear
    answered(rev: number): void;            // controller.previewDone
  }
  export class StrokePreview {
    constructor(deps: StrokePreviewDeps);
    /** The controller's client.preview: asks for `op`'s buildings; returns its rev. */
    preview(op: PlanOp): number;
    /** client.cancelPreview: a barrier; the live buildings clear at once. */
    cancel(): number;
    /** client.commit / client.undo: a barrier; the live buildings fade. */
    barrier(fade: boolean): number;
    /** A run started or the page is going: drop everything, clear. */
    reset(): void;
  }
  // stroke-adapter.ts
  export function createStrokeAdapter(deps: {
    store: PolicyStore;
    stories(): number;
    announce(msg: string): void;
    preview?: StrokePreview;   // absent: no previews (the view mode has no controller anyway)
  }): { editor: BrushControllerDeps['editor']; client: BrushControllerDeps['client'] };
  // feedback.ts
  export const FEEDBACK_FADE_MS = 1500; // FEEDBACK_HOLD_MS and RuleFeedbackTrigger are deleted
  export class PaintFeedback {
    live(pack: PackedCell | null): void; // full strength, no timer
    release(): void;                      // fade linearly over FEEDBACK_FADE_MS; reduced motion: clear
    clear(): void;
    get state(): 'none' | 'live' | 'fading';
    destroy(): void;
  }
  // debug.ts
  export function installSimDebug(get: () => { preview: 'none' | 'live' | 'fading' }): () => void; // window.__sfhSim
  ```
  `StrokePreview` keeps one rev counter shared by `preview`, `cancel` and `barrier` (the adapter's `client.commit` and `client.undo` call `barrier`, so revs stay increasing as `SimClient`'s do), and the latest barrier rev. `preview(op)`: an Erase op is answered at once (`answered(rev)` in a microtask) with nothing shown; a Paint op resolves `customQuery({ id: 'preview', kind: 'paint', strokes: [stroke], stories })`, picks `nearest(lots, points, op.path.at(-1))`, asks `buildings(lots, op.stories)`, and calls `live(pack)` only if no barrier came after it; `answered(rev)` always runs (in a `finally`), so the controller never stalls.
  SimPage: `adapter = createStrokeAdapter({ store, stories, announce, preview })` with `answered: (rev) => controller?.previewDone(rev)`; `startRun()` calls `preview.reset()`; `paintFeedback`, `ruleFeedback`, `strokeWait`, `feedbackSeq`, `feedbackTrigger`, `onLevers`'s trigger and `ruleSaved` are deleted. `nearest` is `lotsInView(lots, points, viewBounds, at, PREVIEW_MAX_LOTS)`.
  Builder's calls: an Erase drag on `/sim` previews nothing (erasing removes paint; the paint-mode dashed lines show its reach); a cancelled stroke clears at once (nothing was committed, so nothing should fade); the preview's lots are the nearest the ring, not the view centre, so the buildings appear under the brush.

- [ ] **Step 1: Write the failing tests**

`BrushController.svelte.spec.ts`: with a client whose `preview` returns revs and never answers, a second preview waits; `previewDone(firstRev)` lets the latest path out on the next frame.

`stroke-preview.spec.ts` (server, fake deps with controllable promises):

```ts
it('a paint preview shows the buildings of the stroke lots nearest the ring and answers its rev', async () => {});
it('an answer after a barrier is dropped, and still answered', async () => {
  const rev = sp.preview(paintOp);
  sp.barrier(true);
  resolveLots(found); resolvePreview(pack);
  await flush();
  expect(live).not.toHaveBeenCalledWith(pack);
  expect(answered).toHaveBeenCalledWith(rev);
  expect(release).toHaveBeenCalledTimes(1);
});
it('cancel clears at once; barrier(true) fades', () => {});
it('an erase preview shows nothing and is answered', async () => {});
it('a failed resolve is answered and shows nothing', async () => {});
it('reset drops answers on their way and clears', async () => {});
```

`feedback.spec.ts`: replace the hold/fade tests with `live` → one layer at opacity 1 and no frame loop; `release` → opacities fall linearly to removal at `FEEDBACK_FADE_MS`; `release` under reduced motion clears at once; `live` during a fade stops it; `state` reports each phase. Delete the `RuleFeedbackTrigger` suite.

`stroke-adapter.spec.ts`: `client.preview` and `client.cancelPreview` forward to the `StrokePreview`; `client.commit` calls `barrier(true)`; there is no `onpaint`.

`SimPage.svelte.spec.ts`: "a Paint drag asks previewBuildings mid-stroke and fades on release" (fake worker: pointer down and moves on the stub map, a `previewBuildings` request before pointer-up, `__sfhSim.preview` `'live'`, then `'fading'` after up); "saving a transit rule shows no buildings" (no `previewBuildings` after the rule's revision is current); "Run clears the preview".

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/sim-page/stroke-preview.spec.ts src/lib/sim-page/feedback.spec.ts src/lib/sim-page/stroke-adapter.spec.ts` and `npx vitest --run --project client src/lib/brush/BrushController.svelte.spec.ts src/lib/sim-page/SimPage.svelte.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** as in Interfaces.

- [ ] **Step 4: Run the tests and e2e**

Run: the Step 2 commands, then `npx vitest --run --project client src/lib/brush` (the `/` controller suite must be unchanged), then `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/sim.spec.ts` with a new test: on the fixture's painted area (the coordinates the existing stroke test uses), `mouse.down`, two `mouse.move`s, poll `window.__sfhSim.preview === 'live'`, `mouse.up`, poll `'fading'` then `'none'`. Replace the e2e checks of the old 2-second flash.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/brush/BrushController.svelte.ts src/lib/brush/BrushController.svelte.spec.ts src/lib/sim-page e2e/sim.spec.ts docs/dev/sim-page.md
git commit -m "feat(sim): live building preview under the brush, fading on release"
```

---

### Task 5: The phone palette strip

**Files:**
- Create: `src/lib/paint/PaletteStrip.svelte`, `PaletteStrip.svelte.spec.ts`
- Delete: `src/lib/sim-page/PhoneToolBar.svelte`, `PhoneToolBar.svelte.spec.ts`
- Modify: `src/lib/sim-page/SimPage.svelte:902-904`, `SimPage.svelte.spec.ts`
- Modify: `src/lib/shell/accent.spec.ts` (`THEMED_FILES` += the `src/lib/paint/*.svelte` files)
- Modify: `e2e/sim.spec.ts` (375 px tool bar tests), `e2e/chrome-dark.spec.ts`; `docs/dev/sim-page.md`

**Interfaces:**
- Consumes: Task 1's `HeightPalette`, `PAINT_TOOLS`; `RadiusPopover`.
- Produces:
  ```ts
  // PaletteStrip.svelte
  interface Props {
    brush: BrushState;
    tool: BrushTool;
    ontool(t: BrushTool): void;
    ondone(): void;          // after Done chose Move: the page reopens the sheet on Paint
    eraseHint: string;
  }
  export function focus(): void; // its first control
  ```
  One line, `md:hidden`, `role="group"` named "Brush", `data-testid="palette-strip"`, `bottom: calc(var(--fzp-scrubber-h, 0px) + 0.5rem)` on `/sim` (plan 5 passes 0 on `/` through the same variable unset): the tool (a button cycling Paint ↔ Erase, named "Tool: Paint"), the height swatch (a neutral tile with the number, opening a popover holding `HeightPalette`; disabled with the hint while Erase), the size (`RadiusPopover` opener), Done. It lifts the map's bottom-left control while shown (the rule of `PhoneToolBar.svelte:76-83`, keyed on `.sfh-palette-strip`).

- [ ] **Step 1: Write the failing tests**

`PaletteStrip.svelte.spec.ts`: the four controls in one row at 375 px; the swatch opens the palette and choosing "6 stories" sets the brush and closes it; Erase disables the swatch with the hint; Done calls `ontool('move')` then `ondone`; `focus()` focuses the first control.
`SimPage.svelte.spec.ts`: retarget the 375 px tool bar tests to `palette-strip`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project client src/lib/paint/PaletteStrip.svelte.spec.ts src/lib/sim-page/SimPage.svelte.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**; delete `PhoneToolBar`.

- [ ] **Step 4: Run the tests and e2e**

Run: the Step 2 command, then `npx vitest --run --project server src/lib/shell/accent.spec.ts`, then `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/sim.spec.ts e2e/chrome-dark.spec.ts` (the 375 px footer and navigation-control checks now name `palette-strip`; add a dark axe run on the strip).
Expected: PASS on `chromium` and `mobile`.

- [ ] **Step 5: Lint, docs and commit**

Run: `npm run lint` and `npm run check`. Expected: clean.

```bash
git add -A src/lib e2e docs/dev/sim-page.md
git commit -m "feat(paint): one phone palette strip for painting"
```

---

## Open questions

None. Builder's calls made here are marked in Task 4 (Erase previews nothing on `/sim`; a cancelled stroke clears without a fade; the preview takes the lots nearest the ring).
