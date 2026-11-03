# /sim UX, plan 4 of 5: transit layers edited in place, map selection, project cards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Transit tab into a list of layers you select and edit in place (no form, no Save, no invalid states), make a click on a lot select the layer that sets its limit, and in a run pop a project card beside the building with the layer that allowed it.

**Architecture:** Pure helpers (`transit-edit.ts`) clamp every edit so a rule is valid by construction; `TransitTab` renders a row per rule plus a locked FZP baseline row, and the selected row expands into the editor, each edit one labelled store change. A new scenario-worker request, `lotAt`, finds the lot under a point (built or vacant) and its limit owner from the limits table the height layer already uses (`limitSources`, `src/lib/sim/levers/source.ts:23-59`); the page maps a painted owner to its brush with `paintBrushOf`. The same owner rides on `parcelSummary`'s `limits`, so the card can say "Allowed by: …". FzpMode stops opening cards in Set Policy.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, Tailwind 4, MapLibre (already in the bundle), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-sim-ux-design.md` (Goals 2 and 6's development details; Goal 10's "+ Transit layer"). Builds on plans 1 to 3 (`DockSelection` and `limitsViewOf` from plan 3, `DockState` from plan 2).

## Global Constraints

- Each transit rule is a layer row: a height swatch (its tallest band), a name from its stop types ("Near Muni Metro"), its lot count. **FZP baseline** is the last row: locked, not editable, a lock glyph, no explanatory sentence.
- **"+ Transit layer"** adds a layer, selected and expanded, with sensible defaults. A selected layer has a Remove control.
- The selected row expands in place to show the editor: stop-type chips; up to 3 distance bands, each with an editable distance and a stories stepper; add and remove a band. No separate form and no Save: edits apply as you make them, and undo covers them.
- Invalid states can't be entered: an outer band's stepper stops at the inner band's height; band distances can't collide; the last stop-type chip can't be turned off. Nothing invalid reaches `compileLevers`. No reordering.
- Selecting on the map (Set Policy, Move tool): clicking a lot (built or vacant) selects the layer that sets its limit, opening the Transit tab if needed and scrolling the row into view, expanded. A painted area that sets it opens the Paint tab and selects that area. FZP (no layer, a layer below FZP, a protected lot) selects the FZP baseline row. Clicking outside every lot clears the selection. Vacant lots need a point-to-lot hit test in the worker.
- Selection on the map uses the height-limits layer's `rule` mode: the selected layer's lots in ink, everything else dimmed. The `paint` mode (dashes while a paint tool is chosen) stays.
- No building flash on transit edits: lids, contours, the row's lot count and the "Updating…" pill show progress (the flash went in plan 3).
- Run: clicking a building pops its project card next to the building (today's content, dark/light), with "Allowed by: <layer name>" when the lot's limit came from a layer. Phones keep the card as a bottom sheet.
- Stories 1 to 80 (`STORIES_MIN`, `STORIES_MAX`). Saved and shared policies open unchanged (the parser's band rules, `policy.ts:191-212`, are untouched).
- CSP unchanged; no new runtime dependencies; plan 1's tokens; WCAG 2.2 AA in both themes.
- Vitest `expect.requireAssertions`; colocated tests; Playwright for flows. 2-space indent, single quotes, no trailing commas, 100 columns. Conventional Commits with `-m` flags. Never `cd x && cmd`. No Claude attribution.

## Review Focus

1. **A click while the latest revision is still resolving**, so the worker's limits are from the revision before (or name a rule just removed). Expected: the selection follows the answer; a rule id no longer in the policy selects the FZP baseline instead of nothing. Test in Task 4.
2. **Steppers and distances at their bounds**: the outer band at the inner band's height, an inner band lowered to the outer's, a distance typed past a neighbour's, a non-number typed. Expected: clamped (or reverted for non-numbers); `bandProblem` of every result is null. Test in Task 1.
3. **Adding a band when three exist or when the outermost is at the distance cap; removing the last band.** Expected: the controls are disabled with their reason; the helpers return null. Test in Task 1.
4. **Clicks outside Set Policy's Move tool**: Paint/Erase chosen (a stroke, not a selection), a run (a card, not a selection), the view (nothing). Expected: exactly one of the three happens. Test in Task 4.
5. **Undo of an in-place edit** (a stepper run, a chip, a band added). Expected: one undo per coalesced run, the row stays selected and expanded, and the store never holds an invalid rule. Test in Task 2.

---

## File Structure

| File | Responsibility | Tasks |
| --- | --- | --- |
| `src/lib/sim-page/transit-edit.ts` (new, + spec) | clamps and edits for transit layers, names, defaults | 1 |
| `src/lib/sim-page/brush-summary.ts` | `ruleTarget` exported | 1 |
| `src/lib/sim-page/TransitTab.svelte`, `TransitLayerRow.svelte` (new, + specs) | the tab, the rows, the in-place editor | 2 |
| `src/lib/sim-page/selection.ts` (+ spec) | `fzp` selection, `selectionForLot`, `tabOf`, `ownerLabel` | 2, 4, 5 |
| `src/lib/map/height/limits-style.ts` (+ spec) | `LimitsView` `{ kind: 'fzp' }` | 2 |
| `src/lib/sim-page/RulesSection.svelte`, `RuleBrushForm.svelte`, `brush-forms.svelte.ts`, `BrushCard.svelte` (+ specs) | deleted | 2 |
| `src/lib/sim/levers/source.ts` (+ spec) | `LimitOwner`, `ownerOf` | 3 |
| `src/lib/sim/scenario/lot-at.ts` (new, + spec) | point-in-lot over chunk records | 3 |
| `src/lib/sim/scenario/types.ts`, `scenario-host.ts` (+ spec), `src/lib/sim/router.ts` (+ `worker-router.spec.ts`), `src/lib/sim/scenario-client.ts` (+ spec) | the `lotAt` request; `limits.owner` on `parcelSummary` | 3 |
| `src/lib/map/types.ts` | `LotLimits.owner` | 3 |
| `src/lib/fzp/FzpMode.svelte` (+ spec) | `SimClientApi.lotAt`; `cards`; card anchor; `ownerName` | 3, 4, 5 |
| `src/lib/sim-page/policy.ts` (+ spec) | `paintBrushOf` | 4 |
| `src/lib/dock/dock-state.svelte.ts` (+ spec) | `reveal(tab)` | 4 |
| `src/lib/sim-page/SimPage.svelte` (+ spec) | Transit tab, map clicks, owner names | 2, 4, 5 |
| `src/lib/fzp/summary-request.ts` (+ spec), `ProjectCardPanel.svelte` (+ spec), `card-place.ts` (new, + spec) | limits in the card state; placement; "Allowed by" | 5 |
| `e2e/sim.spec.ts`, `e2e/sim-share.spec.ts`, `e2e/fzp.spec.ts`; `docs/dev/sim-page.md`, `docs/dev/fzp-mode.md`, `docs/dev/map-interfaces.md` | flows, docs | 2, 4, 5 |

---

### Task 1: `transit-edit.ts`, valid by construction

**Files:**
- Create: `src/lib/sim-page/transit-edit.ts`, `transit-edit.spec.ts`
- Modify: `src/lib/sim-page/brush-summary.ts:57,67-70` (export `ruleTarget(r)`: "Muni Metro", "regional rail and Muni Metro")

**Interfaces:**
- Consumes: `ZoningRule`, `TransitBand`, `DEFAULT_BANDS`, `bandsInnermostFirst`, `bandProblem` (`policy.ts:36-92`); `STOP_TYPES`, `StopType`; `STORIES_MIN`, `STORIES_MAX`; `newOpId`.
- Produces:
  ```ts
  export const MAX_BANDS = 3;
  /** Tier 4 (UI): the largest band distance the editor offers, 2 miles. */
  export const BAND_MAX_M = 3219;
  /** Tier 4: a new band sits a quarter mile beyond the outermost. */
  export const NEW_BAND_STEP_M = 402;
  /** "+ Transit layer": rail (BART, Caltrain) and Muni Metro, at DEFAULT_BANDS. */
  export function newLayer(): ZoningRule;
  /** "Near Muni Metro". */
  export function layerName(r: ZoningRule): string;
  /** The swatch: the tallest band's stories. */
  export function layerTop(r: ZoningRule): number;
  /** Bounds for band i (innermost first): stories between the outer band's and the inner band's. */
  export function storiesRange(bands: readonly TransitBand[], i: number): { min: number; max: number };
  /** Bounds for band i's distance: strictly between its neighbours, 1 m to BAND_MAX_M. */
  export function distanceRange(bands: readonly TransitBand[], i: number): { min: number; max: number };
  /** Every edit returns bands innermost first; values are clamped (and distances rounded to 1 m). */
  export function setBandStories(r: ZoningRule, i: number, n: number): ZoningRule;
  export function setBandDistance(r: ZoningRule, i: number, m: number): ZoningRule;
  /** null when MAX_BANDS exist or the outermost is at BAND_MAX_M. New band: step out, same stories. */
  export function addBand(r: ZoningRule): ZoningRule | null;
  /** null for the last band. */
  export function removeBand(r: ZoningRule, i: number): ZoningRule | null;
  /** null when it would turn off the last stop type; stop types kept in STOP_TYPES order. */
  export function toggleStop(r: ZoningRule, t: StopType): ZoningRule | null;
  ```
  Builder's calls: the new layer's stops are regional rail and Muni Metro (SB 79's first tier, `docs/dev/sim-page.md` "Stop types and bands", tier 0); `BAND_MAX_M` 3,219 m (2 mi) because the citywide brushes measured in plan 3 of the sim page used up to 1,609 m and the parser has no cap.

- [ ] **Step 1: Write the failing tests**

```ts
const rule = (bands: TransitBand[], stopTypes: StopType[] = ['metro']): ZoningRule =>
  ({ id: 'r', kind: 'transit', stopTypes, bands });

it('the outer stepper stops at the inner height, the inner at the outer', () => {
  const r = rule([{ maxM: 402, stories: 6 }, { maxM: 805, stories: 4 }]);
  expect(storiesRange(r.bands, 1)).toEqual({ min: STORIES_MIN, max: 6 });
  expect(storiesRange(r.bands, 0)).toEqual({ min: 4, max: STORIES_MAX });
  expect(setBandStories(r, 1, 9).bands[1].stories).toBe(6);
  expect(setBandStories(r, 0, 2).bands[0].stories).toBe(4);
});
it('distances stay strictly between their neighbours and never collide', () => {
  const r = rule([{ maxM: 402, stories: 6 }, { maxM: 805, stories: 4 }, { maxM: 1200, stories: 2 }]);
  expect(distanceRange(r.bands, 1)).toEqual({ min: 403, max: 1199 });
  expect(setBandDistance(r, 1, 402).bands[1].maxM).toBe(403);
  expect(setBandDistance(r, 2, 99_999).bands[2].maxM).toBe(BAND_MAX_M);
  expect(setBandDistance(r, 0, 0).bands[0].maxM).toBe(1);
});
it('every edit result satisfies bandProblem', () => {
  // fast-check: random monotone rules and random edit sequences → bandProblem(result.bands) === null
});
it('addBand steps out at the same height; null at three bands or at the cap', () => {});
it('removeBand refuses the last band', () => {});
it('toggleStop refuses to turn off the last stop type and keeps STOP_TYPES order', () => {
  expect(toggleStop(rule(DEFAULT_BANDS, ['metro']), 'metro')).toBeNull();
  expect(toggleStop(rule(DEFAULT_BANDS, ['metro']), 'regionalRail')!.stopTypes).toEqual(['regionalRail', 'metro']);
});
it('names a layer from its stops and swatches its tallest band', () => {
  expect(layerName(rule(DEFAULT_BANDS, ['metro']))).toBe('Near Muni Metro');
  expect(layerTop(rule(DEFAULT_BANDS))).toBe(6);
});
it('an unsorted saved rule is returned innermost first by any edit', () => {});
```

(Wrap the property test as `expect(() => fc.assert(...)).not.toThrow()`; `fast-check` is already a dev dependency, used by `accumulator.property.spec.ts`.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/sim-page/transit-edit.spec.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** as in Interfaces.

- [ ] **Step 4: Run the tests**

Run: the Step 2 command, then `npx vitest --run --project server src/lib/sim-page`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sim-page/transit-edit.ts src/lib/sim-page/transit-edit.spec.ts src/lib/sim-page/brush-summary.ts
git commit -m "feat(sim): transit layer edits that cannot produce an invalid rule"
```

---

### Task 2: The Transit tab

**Files:**
- Create: `src/lib/sim-page/TransitTab.svelte`, `TransitTab.svelte.spec.ts`, `TransitLayerRow.svelte`, `TransitLayerRow.svelte.spec.ts`
- Modify: `src/lib/sim-page/selection.ts`, `selection.spec.ts` (the `fzp` kind)
- Modify: `src/lib/map/height/limits-style.ts:14-47`, `limits-style.spec.ts`
- Modify: `src/lib/sim-page/SimPage.svelte` (the Transit panel; the catalog stays), `SimPage.svelte.spec.ts`
- Delete: `src/lib/sim-page/RulesSection.svelte`, `RuleBrushForm.svelte`, `brush-forms.svelte.ts`, `BrushCard.svelte` and their specs
- Modify: `src/lib/shell/accent.spec.ts` (`THEMED_FILES`), `e2e/sim.spec.ts`, `e2e/sim-share.spec.ts` (the `addTransitRule` helpers)

**Interfaces:**
- Consumes: Task 1; plan 3's `DockSelection`, `liveSelection`, `limitsViewOf`; `ruleLotStatus`, `ruleChangeLabel`, `transitUnavailable`, `STOP_LABELS`, `count` (`brush-summary.ts`); `PolicyStore.apply(change, label, coalesce)` (`policy-store.svelte.ts:59-73`); `SRC_FZP` (`source.ts:9`).
- Produces:
  ```ts
  // selection.ts
  export type DockSelection =
    | { kind: 'rule'; id: string } | { kind: 'paint'; id: string } | { kind: 'fzp' } | null;
  // limitsViewOf: { kind: 'fzp' } → { kind: 'fzp' }
  // limits-style.ts
  export type LimitsView =
    { kind: 'plain' } | { kind: 'paint' } | { kind: 'rule'; ruleId: string } | { kind: 'fzp' };
  // resolveMode: { kind: 'fzp' } → { kind: 'rule', source: SRC_FZP } (FZP-set lots in ink, the rest dimmed)
  // TransitTab.svelte
  interface Props {
    store: PolicyStore;
    sync: Pick<LeverSync, 'result' | 'retry'>;
    catalog: BrushCatalog | null | undefined;
    selection: DockSelection;
    onselect(sel: DockSelection): void;
    announce?: (msg: string) => void;
  }
  // TransitLayerRow.svelte
  interface Props {
    rule: ZoningRule;
    status: LotStatus;
    catalog: BrushCatalog | null | undefined;
    selected: boolean;
    onselect(): void;                       // toggles
    onedit(next: ZoningRule, coalesce?: string): void;
    onremove(): void;
    onretry(keys: string[]): void;
  }
  ```
  Markup: `<ol aria-label="Transit layers">`, one `TransitLayerRow` per rule (`data-layer-row={rule.id}`), then the FZP baseline row (`data-layer-row="fzp"`: a select button named "FZP baseline" with an `aria-hidden` lock glyph, no lot count, no editor), then "+ Transit layer" (`data-brush-add`, accessible name "Add transit layer", `aria-disabled` with `transitUnavailable(catalog)` as its description). A row's select button has `aria-pressed={selected}` and holds the swatch (`layerTop` on the neutral tile), `layerName` and the lot count (a polite `role="status"`, `lotsText`). When selected, the editor follows the button: a group "Stop types" of chips (`aria-pressed`, "Muni Metro · 34 stops" from the catalog, the stop label alone without one; the last pressed chip `aria-disabled` with the description "A layer needs at least one stop type"), then per band (innermost first) "Within" a number input in metres (`min`/`max` from `distanceRange`, commit on change and Enter, clamped, a non-number reverts) and a stories stepper (Fewer, the value, More, disabled at `storiesRange`'s bounds), and "Remove band" (disabled with one band), then "+ Band" (disabled when `addBand` is null) and "Remove layer".
  Edits: each is `store.apply(p => replaceRule(p, next), \`Edited: ${ruleChangeLabel(next)}\`, coalesce)`, with `coalesce` `rule:<id>:stories:<i>` for a stepper and `rule:<id>:distance:<i>` for a distance; chips and band adds/removes are not coalesced. "+ Transit layer" applies `newLayer()` (label `ruleChangeLabel`), selects it and focuses its first chip. Remove layer: `Removed: …`, the selection clears, focus goes to the row now at that index or "+ Transit layer". Selecting any row turns `viewPrefs.heightLimits` on if off (today's `selectRule`, `SimPage.svelte:505-509`).

- [ ] **Step 1: Write the failing tests**

`limits-style.spec.ts`: `resolveMode({ kind: 'fzp' }, ids)` is `{ kind: 'rule', source: SRC_FZP }`.
`selection.spec.ts`: `limitsViewOf({ kind: 'fzp' }, 'move', 'edit')` is `{ kind: 'fzp' }`; `liveSelection` keeps `{ kind: 'fzp' }`.
`TransitLayerRow.svelte.spec.ts`: collapsed shows swatch, name and count; selected shows the editor; More stories on the outer band is disabled at the inner band's height; typing 402 into band 2's distance (band 1 at 402) commits 403; the last chip is `aria-disabled` and pressing it calls nothing; each control calls `onedit` with a rule `bandProblem` accepts.
`TransitTab.svelte.spec.ts`:

```ts
it('lists the layers, then the locked FZP baseline row, then + Transit layer', async () => {});
it('+ Transit layer adds a selected, expanded layer with the default stops and bands', async () => {});
it('three More presses on one band are one undo step; the row stays selected', async () => {
  // store.apply with the coalesce key; store.undo() restores the original stories in one step
});
it('Remove layer is one change Undo names, and focus moves on', async () => {});
it('+ Transit layer is aria-disabled with its reason while the catalog loads', async () => {});
```

`SimPage.svelte.spec.ts`: replace the rule-form and "Show on map" tests with "selecting a layer sets the limits mode to its rule; the FZP row sets fzp mode"; "removing the selected layer clears the selection and Undo does not bring it back"; "an edit sends a new revision and shows no preview buildings".

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/map/height/limits-style.spec.ts src/lib/sim-page/selection.spec.ts` and `npx vitest --run --project client src/lib/sim-page/TransitLayerRow.svelte.spec.ts src/lib/sim-page/TransitTab.svelte.spec.ts src/lib/sim-page/SimPage.svelte.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** as in Interfaces; delete the four components and their specs. `PolicySummary` (the view) keeps using `ruleSummary` and is unaffected.

- [ ] **Step 4: Run the tests and e2e**

Run: the Step 2 commands, then `npm run check`, then `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/sim.spec.ts e2e/sim-share.spec.ts` (rewrite `addTransitRule`: open the Transit tab, press "+ Transit layer", wait for the row's lot count; the edit tests use the chips and steppers; the "Show on map" a11y test becomes "a selected layer's expanded editor passes axe", light and dark).
Expected: PASS on `chromium` and `mobile`.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib e2e
git commit -m "feat(sim): transit layers you select and edit in place"
```

---

### Task 3: The worker's `lotAt` and the limit owner

**Files:**
- Modify: `src/lib/sim/levers/source.ts`, `source.spec.ts`
- Create: `src/lib/sim/scenario/lot-at.ts`, `lot-at.spec.ts`
- Modify: `src/lib/sim/scenario/types.ts:90-123, 175-192` (request, response, `LotAtResult`)
- Modify: `src/lib/sim/scenario/scenario-host.ts:1194-1245` (`parcelSummary`'s `limits.owner`), `:1285-1330` (beside `lotOutlines`, the new handler), `:1540-1550` (dispatch); a new `scenario-host.lot-at.spec.ts`
- Modify: `src/lib/sim/router.ts` (answer `lotAt` with `no-session` outside scenario mode), `worker-router.spec.ts`
- Modify: `src/lib/sim/scenario-client.ts` (`lotAt`), `scenario-client.spec.ts`
- Modify: `src/lib/map/types.ts:108-112`, `src/lib/fzp/FzpMode.svelte:29-38, 781-788, 755-768` (`SimClientApi.lotAt`; pass `owner` through `requestParcelSummary`)

**Interfaces:**
- Consumes: `LimitSources`, `SRC_FZP`, `SRC_PAINT`, `SRC_RULE0` (`source.ts`); `lw.limits` (`scenario-host.ts:291, 933`); `cellsIntersecting`, `st.chunks.byCell`, `toLngLat` (as `lidLots`, `scenario-host.ts:981-1003`).
- Produces:
  ```ts
  // source.ts
  export type LimitOwner = { kind: 'fzp' } | { kind: 'paint' } | { kind: 'rule'; ruleId: string };
  export function ownerOf(s: LimitSources, row: number): LimitOwner;
  // lot-at.ts (pure)
  /** Even-odd test of `p` (lng, lat) against a lot's rings (lng, lat). */
  export function pointInRings(p: [number, number], rings: readonly [number, number][][]): boolean;
  /** The first record whose polygon holds `p`, or null. */
  export function lotAtPoint<R extends { id: ParcelId; polygon: unknown; labelPoint: [number, number] }>(
    records: Iterable<R>, p: [number, number], rings: (r: R) => [number, number][][]
  ): R | null;
  // scenario/types.ts
  | { type: 'lotAt'; reqId: number; point: [number, number] }           // ScenarioRequest
  | { type: 'lotAt'; reqId: number; result: LotAtResult }                // ScenarioResponse
  export type LotAtResult =
    | { ok: true; parcelId: ParcelId | null; owner: LimitOwner | null }
    | { ok: false; reason: 'no-session'; message: string };
  // map/types.ts
  export interface LotLimits { allowed: number; buildable: number | null; protected: boolean; owner?: LimitOwner }
  // scenario-client.ts
  lotAt(point: [number, number]): Promise<LotAtResult>;
  // FzpMode SimClientApi
  lotAt(point: [number, number]): Promise<LotAtResult>;
  ```
  The handler answers at once: no lever session → `no-session`; otherwise the loaded records of the cells around `point` are tested; no lot → `parcelId: null`; a lot with no row in the limits table, or before the session's first limits → `owner: null`; else `ownerOf(lw.limits.sources, row)`. `parcelSummary` adds `owner` to `limits` when `lw.limits` exists (a protected lot reads `fzp`, as `limitSources` resets it, `source.ts:57`).

- [ ] **Step 1: Write the failing tests**

`source.spec.ts`: `ownerOf` maps `SRC_FZP`, `SRC_PAINT` and `SRC_RULE0 + k` to `ruleIds[k]`.
`lot-at.spec.ts`: a point inside a square ring is in, outside is out, inside a hole (second ring) is out; `lotAtPoint` returns the containing record or null.
`scenario-host.lot-at.spec.ts` (the mini city the other host specs use): with levers whose rule raises lot X, `lotAt` at X's label point answers `{ parcelId: X, owner: { kind: 'rule', ruleId } }`; at a vacant eligible lot under no rule, `owner: { kind: 'fzp' }`; at a point in the bay, `parcelId: null`; a session without levers answers `no-session`; `parcelSummary(X)` carries `limits.owner`.
`worker-router.spec.ts`: `lotAt` in editor mode is answered `no-session`.
`scenario-client.spec.ts`: `lotAt` resolves with the matching `reqId`'s result and resolves `no-session` after a crash.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/sim`
Expected: FAIL.

- [ ] **Step 3: Implement** as in Interfaces.

- [ ] **Step 4: Run the tests**

Run: the Step 2 command, then `npm run check`
Expected: PASS; 0 errors.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/sim src/lib/map/types.ts src/lib/fzp/FzpMode.svelte
git commit -m "feat(sim): the worker finds the lot under a point and who sets its limit"
```

---

### Task 4: Clicking a lot selects its layer

**Files:**
- Modify: `src/lib/sim-page/policy.ts` (`paintBrushOf`), `policy.spec.ts`
- Modify: `src/lib/sim-page/selection.ts` (`selectionForLot`, `tabOf`), `selection.spec.ts`
- Modify: `src/lib/dock/dock-state.svelte.ts` (`reveal`), `dock-state.svelte.spec.ts`
- Modify: `src/lib/fzp/FzpMode.svelte:509-524` (`cards`), `FzpMode.svelte.spec.ts`
- Modify: `src/lib/sim-page/SimPage.svelte:366-374` (the click listener), `SimPage.svelte.spec.ts`
- Modify: `e2e/sim.spec.ts`

**Interfaces:**
- Consumes: Task 3's `lotAt`; `Lots`, `customQuery`, `queryKey` (`policy.ts`); plan 2's `DockState`.
- Produces:
  ```ts
  // policy.ts
  /** The custom paint brush whose paint holds on `lot` after erasing (last wins); null if none or a query is unknown. */
  export function paintBrushOf(p: SimPolicy, lots: Lots, lot: ParcelId): string | null;
  // selection.ts
  /** What a click on `lot` selects: its rule (if still in the policy), its painted area, else the FZP row; null clears. */
  export function selectionForLot(
    owner: LimitOwner | null, lot: ParcelId | null, p: SimPolicy, lots: Lots
  ): DockSelection;
  export function tabOf(sel: Exclude<DockSelection, null>): 'transit' | 'paint';
  // dock-state.svelte.ts
  /** Show the editing face at `tab`: desktop opens the panel, a closed phone sheet goes to 'peek'. */
  reveal(tab: string): void;
  // FzpMode
  /** Taps open project cards (default true). /sim passes false in Set Policy; turning it off closes an open card. */
  cards?: boolean;
  ```
  `selectionForLot`: `lot === null` → null; `owner === null` → null; `fzp` → `{ kind: 'fzp' }`; `rule` → the rule if `p.rules` has its id, else `{ kind: 'fzp' }`; `paint` → `paintBrushOf` (or `{ kind: 'fzp' }` when it is null).
  SimPage, in `onMapReady`: `map.on('click', onMapClick)` (removed on a new map and on destroy). `onMapClick(e)` acts only when `mode === 'edit' && run.phase === 'setup' && tools.tool === 'move'`; it asks `api.lotAt([e.lngLat.lng, e.lngLat.lat])` with a sequence number (latest wins), then sets `picked = selectionForLot(…)`, and for a non-null selection calls `dock.reveal(tabOf(sel))` and, after `tick()`, `scrollIntoView({ block: 'nearest' })` on `[data-layer-row="…"]` or `[data-paint-row="…"]`. Focus stays on the map. `no-session` changes nothing. FzpMode gets `cards={run.phase === 'run'}`.
  Builder's calls: the click path uses the worker's owner (one source of truth with the height layer) and only maps paint to a brush on the main thread; a phone opens the sheet at `'peek'` so the clicked lot stays in view; the view mode does not select (its summary has no rows to select).

- [ ] **Step 1: Write the failing tests**

`policy.spec.ts`: `paintBrushOf` returns the last paint brush covering the lot; an erase after it returns null; a later paint after the erase returns that one; an unknown query returns null.
`selection.spec.ts`: `selectionForLot` for each owner kind, a removed rule id (→ fzp), a null lot (→ null); `tabOf`.
`dock-state.svelte.spec.ts`: `reveal('paint')` from Results with a closed sheet gives `face 'edit'`, `tab 'paint'`, `open true`, `sheet 'peek'`.
`FzpMode.svelte.spec.ts`: with `cards: false` a tap pick opens no card; switching `cards` to false closes an open one; hover tooltips still show.
`SimPage.svelte.spec.ts`:

```ts
it('a click with Move in Set Policy asks lotAt and selects the rule that owns the lot', async () => {
  const { w, map } = await readySimWithRule();
  map.fire('click', { lngLat: { lng: X[0], lat: X[1] } });
  const req = w.lastOf('lotAt')!;
  w.emit({ type: 'lotAt', reqId: req.reqId, result: { ok: true, parcelId: 'X', owner: { kind: 'rule', ruleId: ruleId } } });
  await expect.element(page.locator(`[data-layer-row="${ruleId}"] [aria-pressed="true"]`)).toBeVisible();
});
it('a painted owner opens the Paint tab on that area', async () => {});
it('an FZP owner selects the baseline row; a click on no lot clears the selection', async () => {});
it('only the latest click answer counts', async () => {});
it('with Paint chosen, in a run, or in the view a click asks nothing', async () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/sim-page/policy.spec.ts src/lib/sim-page/selection.spec.ts src/lib/dock/dock-state.svelte.spec.ts` and `npx vitest --run --project client src/lib/fzp/FzpMode.svelte.spec.ts src/lib/sim-page/SimPage.svelte.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** as in Interfaces (the map stub in `src/lib/fzp/test/sim-map-stub.ts` gains `fire('click', e)` if it has no event emitter).

- [ ] **Step 4: Run the tests and e2e**

Run: the Step 2 commands, then `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/sim.spec.ts` with new tests: add a transit layer covering a fixture lot, wait for `levers.status === 'current'`, click the lot's label point (`projectToPage`), and expect its row pressed and visible in the Transit tab; paint a stroke, wait current, click inside it, expect the Paint tab with that row pressed; click open water, expect no pressed row.
Expected: PASS on `chromium` and `mobile`.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib e2e/sim.spec.ts
git commit -m "feat(sim): clicking a lot selects the layer that sets its limit"
```

---

### Task 5: The project card beside the building, and "Allowed by"

**Files:**
- Create: `src/lib/fzp/card-place.ts`, `card-place.spec.ts`
- Modify: `src/lib/fzp/summary-request.ts:12-18` (and where it builds `project`), `summary-request.spec.ts`
- Modify: `src/lib/fzp/ProjectCardPanel.svelte`, `ProjectCardPanel.svelte.spec.ts`
- Modify: `src/lib/fzp/FzpMode.svelte:258-260, 509-524, 936-948` (anchor, `ownerName`)
- Modify: `src/lib/sim-page/selection.ts` (`ownerLabel`), `selection.spec.ts`, `SimPage.svelte`
- Modify: `e2e/fzp.spec.ts`, `e2e/sim.spec.ts`; `docs/dev/sim-page.md`, `docs/dev/fzp-mode.md` (card placement, `cards`, `lotAt`), `docs/dev/map-interfaces.md` (`LimitsView` `fzp`)

**Interfaces:**
- Consumes: Task 3's `LotLimits.owner`; Task 4's `paintBrushOf`; plan 3's `rowName`; Task 1's `layerName`.
- Produces:
  ```ts
  // card-place.ts
  /**
   * The card's top-left in map-container px: right of the anchor by `gap`, or left of it when
   * that overflows `area.right`; vertically centred on it; clamped 8 px inside `area`.
   */
  export function cardPlacement(
    anchor: { x: number; y: number },
    size: { w: number; h: number },
    area: { left: number; top: number; right: number; bottom: number },
    gap?: number // default 16
  ): { left: number; top: number };
  // summary-request.ts
  export type SummaryState = … | { kind: 'project'; card: ProjectCard; limits?: LotLimits } | …;
  // ProjectCardPanel props (new)
  anchor?: { left: number; top: number } | null; // from md; below md the card stays a bottom sheet
  allowedBy?: string | null;                     // shown as "Allowed by: {allowedBy}" (data-testid="card-allowed-by")
  // FzpMode prop
  ownerName?: (owner: LimitOwner, parcelId: ParcelId) => string | null;
  // selection.ts
  /** "Near Muni Metro" for a rule still in the policy, "Painted 8 stories" for paint, null for FZP. */
  export function ownerLabel(owner: LimitOwner, lot: ParcelId, p: SimPolicy, lots: Lots): string | null;
  ```
  FzpMode keeps the tap's `{ x, y }` (`TimelinePick`, `src/lib/map/types.ts:146-148`, map-container px) as the card's anchor, measures the card (`bind:offsetWidth`, `bind:offsetHeight`) and places it with `cardPlacement` inside the map area (left `--dock-w` read from the root's computed style, bottom above the scrubber). The "Allowed by" line follows the size line, only when `ownerName` returns a name.

- [ ] **Step 1: Write the failing tests**

`card-place.spec.ts`: right of the anchor when it fits; flipped left near the right edge; clamped at the top and bottom; clamped right of the dock.
`summary-request.spec.ts`: a summary with `project` and `limits` gives `{ kind: 'project', card, limits }`.
`selection.spec.ts`: `ownerLabel` for a rule, a removed rule (null), paint ("Painted 8 stories"), fzp (null).
`ProjectCardPanel.svelte.spec.ts`: `allowedBy` renders "Allowed by: Near Muni Metro"; absent renders no line; at 1024 px with `anchor` the card's `left`/`top` styles are the anchor's; at 375 px it is the bottom sheet whatever the anchor.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/fzp/card-place.spec.ts src/lib/fzp/summary-request.spec.ts src/lib/sim-page/selection.spec.ts` and `npx vitest --run --project client src/lib/fzp/ProjectCardPanel.svelte.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** as in Interfaces; SimPage passes `ownerName={(o, id) => ownerLabel(o, id, store.policy, lotsFromSync)}`.

- [ ] **Step 4: Run the tests and e2e**

Run: the Step 2 commands, then `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/fzp.spec.ts e2e/sim.spec.ts` (the card tests: in a run, the card's box sits beside the clicked point at 1280 px and does not overlap the dock; at 375 px it stays above the attribution; a run of a policy with a layer over a pipeline project's lot shows "Allowed by"). Keep the axe runs with the card open, light and dark.
Expected: PASS on `chromium` and `mobile`.

- [ ] **Step 5: Lint, docs and commit**

Run: `npm run lint` and `npm run check`. Expected: clean.

```bash
git add -A src/lib e2e docs/dev
git commit -m "feat(sim): project cards open beside the building and name the layer that allowed it"
```

---

## Open questions

None. Builder's calls are marked in Tasks 1 and 4: the new layer's default stops (regional rail and Muni Metro), the 2-mile distance cap, the worker's owner as the click's source of truth, the phone sheet's peek on a map selection, and no selection in the view.
