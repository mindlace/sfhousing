# /sim runs, plan 1 of 3: policy model and runs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Narrow `/sim` to "FZP as written vs my policy": an FZP-only engine with additive rules and "allow N stories" painting, a schema-2 policy document, a four-section pane, a named automatic comparison, a still timeline bar, and Setup/Run phases.

**Architecture:** The lever engine (`src/lib/sim/levers/`) loses stock blending, the 2032 law switch and density-capped edits; it resolves FZP, then rules (max, uncapped), then paint (set, uncapped, later wins), then category protections, and compares with pre-FZP or a new FZP twin. The page's recipe (`src/lib/sim-page/policy.ts`) becomes `SimPolicy` schema 2 (`rules`, `custom`, category `protect`, `timing`) and chooses the comparison itself. A `RunPhase` store in `SimPage` drives FzpMode's scrubber (Run in Setup) and makes the pane read-only during a run.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, Tailwind 4, Vitest (server and client projects), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-31-sim-runs-design.md` (sections 1, 2, 3, 5, 6 and Compatibility). Plans 2 (fog, map feedback, transit view on `/sim`) and 3 (palette, Paint/Simulate tabs, physical limits and dataset rebuild) build on this one.

## Global Constraints

- The window stays the present day (`calibration.asOf`) to `HORIZON` (2066-12-31, `src/lib/fzp/time.ts`).
- Baseline: FZP as written for the whole window; engine terms "stock `['fzp']`, no law switch". Nothing takes the §207.11 or 2032 law-switch path.
- The baseline keeps FZP's own per-lot caps (`fzpYieldCap`); rules and painting are always uncapped.
- Comparison: policy equal to the default (no rules, no painting, default timers, default protections) compares with pre-FZP; any customisation compares with FZP unchanged (`compare: 'fzp'`).
- Comparison copy, verbatim: default policy "FZP added N homes vs no FZP"; otherwise "Your policy added N homes vs FZP" (or "−N", U+2212).
- The headline score is unchanged: the existing absolute count in `ScoreBar`.
- Resolution order per lot: 1 FZP, 2 rules (highest wins), 3 custom painting (last stroke wins), 4 protections (non-redevelopable), 5 `min(…, physical max)` (plan 3, in the generator).
- Removed from the document: `raise`/`lower` modes, `densityLimits`, `area` rules, protect strokes, `stock`, `assumeAlternativePlanKept`, `compare`. Schema version bumped; no migration; an older document fails with the existing "can't open this policy" path.
- `?start=fzp` becomes the default and is dropped.
- Pane sections in order: New zoning rules, Custom zoning, Permitting timelines, Protections. "Zoning layers" is removed. Both zoning sections open expanded; the others start collapsed.
- Protections are category-only (rent control, historic, newer than N years).
- Phase is not persisted: reload, restore and `/s/<id>` open in Setup. On `/s/<id>` the pane button reads "Back to start"; elsewhere "Change policy".
- Timeline bar: no "Simulation" pill; month readout sized to the widest month-year label with `tabular-nums`; Run/Play/Pause/Replay share one fixed-width slot.
- Score centred in the header from md (three columns: status left, score centre, actions right).
- Every Vitest test calls `expect` (`expect.requireAssertions`). 2-space indent, single quotes, no trailing commas, 100 columns. Conventional Commits; commit with `-m` flags, never a heredoc; never `cd x && cmd`.

## Review Focus

1. **Policy edits during a run by a non-pane input** (Ctrl+Z / Ctrl+Shift+Z through `BrushController`, a map stroke with Paint still selected, the phone tool bar). Expected: nothing changes the policy until Change policy. Test in Task 7 (`store.locked`, tool reset to Move).
2. **Run pressed while the latest policy is still resolving or debouncing.** Expected: the run does not play the stale timeline; it starts playing once the score is current, and the existing pending notice shows meanwhile. Test in Task 7.
3. **Undo back to the default policy.** Expected: the comparison returns to pre-FZP and the copy to "FZP added … vs no FZP". Test in Task 3 (`compileLevers`) and Task 5 (panel copy).
4. **A schema-1 policy in autosave or behind a `/s/<id>` link.** Expected: autosave keeps it under the corrupt key with notice N1 and opens the default; `/s/<id>` shows the unparsable-policy page, not a 500. Test in Task 3.
5. **A rule at or below a lot's FZP height on a density-capped lot, and transit bands whose outer band is taller than the inner.** Expected: the rule leaves the FZP row (stories, cap, yields, hostable) untouched; the taller band wins wherever both apply. Test in Task 1 (engine) and Task 3 (compile).

---

## File Structure

| File | Responsibility | Tasks |
| --- | --- | --- |
| `src/lib/sim/levers/types.ts` | `SimLevers` schema 2, parser, `DEFAULT_LEVERS` | 1, 3 |
| `src/lib/sim/levers/layers.ts` | FZP and base envelope tables only | 1 |
| `src/lib/sim/levers/resolve.ts` | FZP → rules → paint → protections; `Resolution`, capacity | 1, 3 |
| `src/lib/sim/levers/view.ts` | Local Program column (no period) | 1 |
| `src/lib/sim/levers/apply.ts` | plan input, `preFzp`/`fzp` twins, references | 1 |
| `src/lib/sim/scenario/scenario-host.ts` | `leverStep` calls the new resolve/apply | 1 |
| `scripts/bench-levers.ts` | bench on the new lever shape | 1 |
| `src/lib/sim-page/policy.ts` | `SimPolicy` schema 2, parse, queries, compile, defaults, roles, score copy | 1 (bridge), 3, 5 |
| `src/lib/sim-page/sim-doc.ts` | `SimDoc` schema 2, limits, codec | 3 |
| `src/lib/sim-page/brush-summary.ts`, `brush-forms.svelte.ts`, `RuleBrushForm.svelte`, `BrushCard.svelte` | rules and custom brushes in words and forms | 3, 4 |
| `src/lib/sim-page/brush-tools.svelte.ts`, `stroke-adapter.ts`, `PhoneToolBar.svelte` | Move/Paint/Erase, "allow N stories" strokes | 3 |
| `src/lib/sim-page/RulesSection.svelte` (new), `CustomZoningSection.svelte` (new; replace `BrushSection.svelte`) | the two zoning sections | 4 |
| `src/lib/sim-page/ProtectionsSection.svelte` | categories only | 3 |
| `src/lib/sim-page/LayersSection.svelte` (+ spec) | deleted | 2 |
| `src/lib/sim-page/PolicyPanel.svelte` | section order and expansion, read-only, Change policy | 2, 4, 7 |
| `src/lib/sim-page/PolicySummary.svelte` | read-only summary of schema 2 | 3 |
| `src/lib/sim-page/lot-overlay.ts` | one `'changed'` role (plan 2 removes the dots) | 3 |
| `src/lib/sim-page/run-phase.svelte.ts` (new) | `RunPhase` store | 7 |
| `src/lib/sim-page/SimPage.svelte`, `SimRoute.svelte`, `sim-session.ts`, `src/routes/sim/*`, `src/routes/fzp/+page.ts` | wiring, no `start`, phase | 1, 2, 3, 4, 7 |
| `src/lib/fzp/FzpScorePanel.svelte` | comparison line, protections line without switch | 1, 5 |
| `src/lib/shell/SiteHeader.svelte` | three-column header with a pinned item from md | 5 |
| `src/lib/fzp/TimeScrubber.svelte`, `src/lib/fzp/format.ts` | no pill, fixed widths, setup mode | 6 |
| `src/lib/fzp/FzpMode.svelte`, `src/lib/fzp/debug.ts` | phase props, pinned day, deferred play | 7 |
| `src/lib/sim/scenario/{engine,input,card,types}.ts` | law switch removed | 8 |
| `docs/dev/sim-levers.md`, `sim-page.md`, `fzp-mode.md`, `plan-sharing.md` | updated with the task that changes each subject | 1–8 |

---

### Task 1: FZP-only lever engine with additive rules and paint

The engine drops stock blending, current law, the law switch and density-capped edits, and gains `compare: 'fzp'`. Confirmed consumers (grep, this branch): `CURRENT_LAW_SWITCH`, `blendStock`, `currentLaw*`, `sb79WinsAfter`, `beforePeriod`, `assumeAlternativePlanKept` and `FZP_COMPAT_LEVERS` are used only by `src/lib/sim/levers/*`, `scenario-host.ts:79,723`, `FzpScorePanel.svelte:9,77`, `scripts/bench-levers.ts:29,117`, sim-page (`policy.ts`, `SimPage.svelte:37`, `LayersSection`, `PolicySummary`) and specs. `SimInput.lawSwitch` in the scenario engine stays until Task 8 (nothing sets it after this task). `policy.bin`'s `currentStories`/`sb79*` columns are data and stay.

**Files:**
- Modify: `src/lib/sim/levers/types.ts`, `layers.ts`, `resolve.ts`, `view.ts`, `apply.ts` and their specs (`types.spec.ts`, `layers.spec.ts`, `resolve.spec.ts`, `view.spec.ts`, `apply.spec.ts`)
- Modify: `src/lib/sim/scenario/scenario-host.ts:719-770`, `scenario-host.levers.spec.ts`, `scenario-host.brushes.spec.ts`, `src/lib/sim/scenario-client.spec.ts`, `src/lib/sim/worker-router.spec.ts`, `src/lib/sim/scenario/card.spec.ts`, `engine-switch.spec.ts` (only the imports that no longer exist: build its `lawSwitch` input by hand; Task 8 deletes the file)
- Modify: `scripts/bench-levers.ts`
- Modify (bridge): `src/lib/sim-page/policy.ts`, `sim-doc.ts`, `SimPage.svelte:37,126-149`, `LayersSection.svelte`, `PolicySummary.svelte`, `src/lib/fzp/FzpScorePanel.svelte:9,73-85`, `FzpMode.svelte.spec.ts`, `FzpScorePanel.svelte.spec.ts`, `src/routes/sim/page.svelte.spec.ts`, `src/lib/sim-page/policy.spec.ts`, `sim-doc.spec.ts`
- Modify: `e2e/sim.spec.ts:230-252`
- Modify: `docs/dev/sim-levers.md`

**Interfaces:**
- Consumes: `EnvelopeRow`, `envelopeRow` (`src/lib/data/envelope-row.ts`), `NULL_CAP` (`policy-codec`), `applyPolicies`, `baseZoning` (`scenario/policy`), `REFERENCES` (`scenario/score`).
- Produces (`src/lib/sim/levers/types.ts`):
  ```ts
  export interface StoryEdit { lots: ParcelId[]; stories: number } // integer 0..255
  export interface Protections {
    rentControl: boolean; historic: boolean; newerThanYears: number | null;
    lots: ParcelId[]; // removed in Task 3
  }
  export type Compare = 'preFzp' | 'fzp';
  export interface SimLevers {
    schema: 2;
    rules: StoryEdit[]; // max(current, N), uncapped where it raises; order-free
    paint: StoryEdit[]; // set N, uncapped; document order, later wins
    protect: Protections;
    timers: TimerEdit[];
    routeShares: Record<Pathway, number> | null;
    localProgramStreamlined: boolean;
    compare: Compare;
  }
  export const DEFAULT_LEVERS: SimLevers; // rules [], paint [], no protections, no timers, null shares, true, 'preFzp'
  export function parseSimLevers(json: unknown): SimLevers; // throws LeverFormatError
  ```
  Removed: `STOCK_LAYERS`, `StockLayerId`, `UserEdit`, `FZP_COMPAT_LEVERS`, `CURRENT_LAW_SWITCH`.
- Produces (`layers.ts`): `export type DataLayer = 'fzp' | 'base'; export function stockTable(ctx: LayerCtx, id: DataLayer): EnvelopeTable;` (`EnvelopeTable`, `LayerCtx` unchanged). Removed: `Period`, `blendStock`, `currentLawTable`, `currentLawAfterTable`, `sb79WinsAfter`.
- Produces (`resolve.ts`):
  ```ts
  export interface ResolvedTable { table: EnvelopeTable; needs: Need[] } // was PeriodResolution
  export interface Resolution {
    plan: ResolvedTable;
    unprotected: ResolvedTable; // === plan when no row is protected
    protectedRows: Int32Array;
    unknownLots: number; // distinct ids in rules, paint and protect.lots not in the dataset
  }
  export function resolveEnvelopes(ctx: LayerCtx, levers: SimLevers, asOf: Day): Resolution;
  export function allNeeds(r: Resolution): Need[];
  export function fillNeeds(r: Resolution, rows: ReadonlyMap<string, EnvelopeRow>): Resolution;
  export interface LeverCapacity { plan: number; withoutProtections: number; protectedLots: number }
  export function leverCapacity(r: Resolution, parcels: ScenarioParcels): LeverCapacity;
  ```
  `protectedRows`, `netCapacity`, `Need`, `needKey` keep their signatures.
- Produces (`view.ts`): `export function localProgramColumn(ctx: LayerCtx, levers: SimLevers): Uint8Array` (`parcels.localProgram` when `localProgramStreamlined`, else all zero).
- Produces (`apply.ts`): `export function twinInput(base: SimInput, ctx: LayerCtx, compare: Compare): SimInput; export function applyLevers(base: SimInput, ctx: LayerCtx, levers: SimLevers, filled: Resolution): LeverInputs;` (`LeverInputs`, `LeverLookups`, `lookupsOf` unchanged in shape).
- Produces (bridge, `src/lib/sim-page/policy.ts`; Task 3 replaces it): `DEFAULT_POLICY` and `isDefaultPolicy` move here from `sim-doc.ts` (which re-exports both); `ScoreCopy` gains `compare: Compare`.

- [ ] **Step 1: Write the failing engine tests**

In `resolve.spec.ts`, replace the user-edit and law-switch suites. `CAPPED` is the first mini-city row with `fzpYieldCap !== NULL_CAP` and `hostable === 1` (find it in the spec with a loop; `miniPolicy` sets `fzpYieldCap` from `baseCap`, `mini-policy.ts:78`).

```ts
const L = (patch: Partial<SimLevers> = {}): SimLevers => ({ ...structuredClone(DEFAULT_LEVERS), ...patch });
const e = (lots: string[], stories: number): StoryEdit => ({ lots, stories });

it('with no edits the plan is the FZP table row for row', () => {
  const c = ctx();
  const r = resolveEnvelopes(c, L(), ASOF);
  const fzp = stockTable(c, 'fzp');
  for (let i = 0; i < c.parcels.count; i++) expect(row(r.plan.table, i)).toEqual(row(fzp, i));
  expect(allNeeds(r)).toEqual([]);
});

it('a rule above FZP raises the lot uncapped', () => {
  const c = ctx(); const id = c.parcels.id[CAPPED]; const s = stockTable(c, 'fzp').stories[CAPPED];
  const r = resolveEnvelopes(c, L({ rules: [e([id], s + 3)] }), ASOF);
  expect(r.plan.table.stories[CAPPED]).toBe(s + 3);
  expect(r.plan.table.cap[CAPPED]).toBe(NULL_CAP);
  expect(r.plan.needs).toEqual([{ row: CAPPED, stories: s + 3, cap: null }]);
});

it('a rule at or below FZP leaves the FZP row, cap included', () => {
  const c = ctx(); const id = c.parcels.id[CAPPED]; const s = stockTable(c, 'fzp').stories[CAPPED];
  for (const n of [s, s - 1]) {
    const r = resolveEnvelopes(c, L({ rules: [e([id], n)] }), ASOF);
    expect(row(r.plan.table, CAPPED)).toEqual(row(stockTable(c, 'fzp'), CAPPED));
    expect(r.plan.needs).toEqual([]);
  }
});

it('rules: the highest applicable wins, in any order', () => {
  const c = ctx(); const i = at(c, FZP_LOT);
  for (const rules of [[e([FZP_LOT], 6), e([FZP_LOT], 9)], [e([FZP_LOT], 9), e([FZP_LOT], 6)]])
    expect(resolveEnvelopes(c, L({ rules }), ASOF).plan.table.stories[i]).toBe(9);
});

it('paint sets N after the rules, can lower, and a later stroke wins', () => {
  const c = ctx(); const i = at(c, FZP_LOT);
  const one = resolveEnvelopes(c, L({ rules: [e([FZP_LOT], 9)], paint: [e([FZP_LOT], 2)] }), ASOF);
  expect(one.plan.table.stories[i]).toBe(2);
  expect(one.plan.table.cap[i]).toBe(NULL_CAP);
  const two = resolveEnvelopes(c, L({ paint: [e([FZP_LOT], 5), e([FZP_LOT], 7)] }), ASOF);
  expect(two.plan.table.stories[i]).toBe(7);
});

it('a protected lot keeps its FZP row, not hostable, whatever rules and paint say', () => {
  const c = ctx(); const i = at(c, MINI_HISTORIC_ID);
  const r = resolveEnvelopes(
    c, L({ rules: [e([MINI_HISTORIC_ID], 20)], paint: [e([MINI_HISTORIC_ID], 30)],
      protect: { ...DEFAULT_LEVERS.protect, historic: true } }), ASOF);
  const fzp = row(stockTable(c, 'fzp'), i);
  expect(row(r.plan.table, i)).toEqual({ ...fzp, hostable: 0 });
  expect(r.unprotected.table.stories[i]).toBe(30);
});

it('unknown ids are counted once across rules, paint and protect.lots', () => {
  const r = resolveEnvelopes(ctx(), L({ rules: [e(['nope', 'gone'], 5)], paint: [e(['nope'], 5)] }), ASOF);
  expect(r.unknownLots).toBe(2);
});
```

In `types.spec.ts`: `parseSimLevers(DEFAULT_LEVERS)` deep-equals `DEFAULT_LEVERS`; a schema-1 document throws `LeverFormatError` with path `schema`; a document with `user`, `stock` or `assumeAlternativePlanKept` throws with path `user` / `stock` / `assumeAlternativePlanKept` ("unknown key"); `compare: 'currentLaw'` throws with path `compare`; `rules[0].stories` of 256 throws with path `rules[0].stories`.

In `apply.spec.ts`:

```ts
it("the 'fzp' twin is the default plan and never switches", () => {
  const twin = twinInput(base, c, 'fzp');
  const plan = applyLevers(base, c, DEFAULT_LEVERS, resolveEnvelopes(c, DEFAULT_LEVERS, base.asOf)).plan;
  expect(twin.parcels.envelopeStories).toEqual(plan.parcels.envelopeStories);
  expect(twin.lawSwitch).toBeUndefined();
  expect(twin.inFlightScale).toBeUndefined();
  expect(twinInput(base, c, 'fzp')).toBe(twin); // memoised
});
it('references: all under preFzp, only completedNet under fzp', () => {
  const r = (compare: Compare) =>
    applyLevers(base, c, { ...DEFAULT_LEVERS, compare }, resolveEnvelopes(c, DEFAULT_LEVERS, base.asOf)).references;
  expect(r('preFzp')).toEqual(REFERENCES);
  expect(r('fzp').every((x) => x.measure === 'completedNet')).toBe(true);
});
```

In `view.spec.ts`: `localProgramColumn(c, DEFAULT_LEVERS)` is `c.parcels.localProgram`; with `localProgramStreamlined: false` every entry is 0.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/sim/levers`
Expected: FAIL (type errors and missing exports: `StoryEdit`, `Compare`, `resolveEnvelopes(…, asOf)`).

- [ ] **Step 3: Implement the engine**

- `types.ts`: the interfaces above; `parseSimLevers` checks keys `schema, rules, paint, protect, timers, routeShares, localProgramStreamlined, compare` with the existing `record`/`fail` helpers; `parseStoryEdit(v, path)` reuses today's stories check (`types.ts:166-172`).
- `layers.ts`: keep `stockTable` for `'fzp'` and `'base'` only; delete the rest.
- `resolve.ts`: `resolvePlan(ctx, levers, protect)` copies the FZP table (fresh arrays, `stockTable` returns views), then: for each lot the rules touch, `n = max over rules`; if `n > stories`, set `stories = n`, `cap = NULL_CAP`, mark touched; then each paint edit in order sets `stories = N`, `cap = NULL_CAP`, touched; then protections reset to the FZP row with `hostable` 0 (today's block, `resolve.ts:118-127`). Need detection is today's loop (`resolve.ts:129-150`) with `candidates = [stockTable(ctx, 'fzp'), stockTable(ctx, 'base')]`: builder's call — the SB 79 and current-law rows follow other yield rules (`sim-levers.md`, "Resolution order"), so reusing them would give an uncapped edit yields `envelopeRow` would not.
- `view.ts`: `localProgramColumn` as above; `parcelsView`, `envelopeOp` unchanged.
- `apply.ts`: `planOf(base, ctx, levers, filled)` without the `lawSwitch` branch. `twinInput` keys its memo on `compare`: `'preFzp'` is today's `baseZoning` twin; `'fzp'` is `planOf(base, ctx, DEFAULT_LEVERS, resolveEnvelopes(ctx, DEFAULT_LEVERS, base.asOf))`, throwing if it has needs (as `apply.ts:119-120`). `references`: `REFERENCES` under `'preFzp'`, the `completedNet` ones under `'fzp'` (the `planEffect` references are FZP-vs-pre-FZP estimates).
- `scenario-host.ts`: `leverStep` calls `resolveEnvelopes(lw.ctx, p.levers, base.asOf)` and `applyLevers(lw.base.fzp, lw.ctx, p.levers, filled)`; drop the `CURRENT_LAW_SWITCH` import and the window.
- `scripts/bench-levers.ts`: brushes (a) to (c) become `rules` edits (raise semantics, uncapped); keep the table columns.

- [ ] **Step 4: Bridge the page to the new levers**

In `src/lib/sim-page/policy.ts` (old `SimPolicy` schema 1 stays until Task 3):
- Move `DEFAULT_POLICY` and `isDefaultPolicy` here; `DEFAULT_POLICY` is the old shape at FZP: `stock: ['fzp']`, `assumeAlternativePlanKept: false`, `compare: 'preFzp'`, no brushes, no protections, `timing: { current: structuredClone(OBSERVED_TIMING.current), saved: null }`. `sim-doc.ts` re-exports both. Delete `policyFromLevers`.
- Define `LEGACY_STOCK_LAYERS` / `LegacyStockLayer` locally for the parser, `LayersSection` and `PolicySummary` (deleted in Tasks 2 and 3).
- `compileLevers`: `emit` as today; edits with `mode === 'raise'` go to `rules`, the rest to `paint` in order; `protect.lots` as today; `compare: isDefaultPolicy(p) ? 'preFzp' : 'fzp'`; `stock`, `assumeAlternativePlanKept`, `densityLimits` and the document's `compare` are ignored.
- `scoreCopy(l)`: `null` or `l.compare === 'preFzp'` → `{ plan: 'the Family Zoning Plan', twin: 'the old zoning', compare: 'preFzp' }`; else `{ plan: 'your policy', twin: 'the Family Zoning Plan as written', compare: 'fzp' }`.

In `SimPage.svelte`: `firstPolicy = opened?.doc.policy ?? DEFAULT_POLICY` and `initial = opened ? (compileLevers(firstPolicy, () => []) ?? DEFAULT_LEVERS) : DEFAULT_LEVERS` for both `start` values. In `FzpScorePanel.svelte` the protections line drops its after-switch clause and `SWITCH_YEAR`. Update the listed specs to the new imports and names.

- [ ] **Step 5: Update the e2e and the doc**

`e2e/sim.spec.ts` "/sim starts on current law…" becomes "/sim starts on the Family Zoning Plan; the score bar opens the score details": drop the two current-law assertions; the details show "What the plan added" (the FZP copy). In `docs/dev/sim-levers.md`: rewrite "The lever document", "Resolution order", "Twins and the references rule" and "Protections and the capacity metric" to the new model; delete "Stock blend and tie rule" and "The law switch"; under "Performance" note the bench now runs rules.

- [ ] **Step 6: Verify**

Run: `npx vitest --run --project server src/lib/sim scripts` then `npm run check`
Expected: PASS, 0 errors.
Run: `npx vitest --run --project client src/lib/fzp src/lib/sim-page src/routes/sim`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src/lib/sim src/lib/sim-page src/lib/fzp src/routes/sim scripts/bench-levers.ts e2e/sim.spec.ts docs/dev/sim-levers.md
git commit -m "feat(sim): FZP-only lever engine with additive rules, paint and an FZP twin" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Drop `?start=fzp` and the Zoning layers section

FZP is now what `/sim` opens on (Task 1), so the `start=fzp` deferral, its notice and the layer toggles go.

**Files:**
- Modify: `src/routes/fzp/+page.ts` (+ `page.spec.ts`), `src/routes/sim/+page.ts`, `+page.svelte` (+ `page.spec.ts`, `page.svelte.spec.ts`), `src/lib/sim-page/load.ts` (`SimPageData.start` removed), `SimRoute.svelte:79`, `SimPage.svelte` (props `start`, `persist: 'deferred'`, the `fzp-kept` notice, `FZP_KEPT_TEXT`), `sim-session.ts:25`, `SimNotices.svelte:3`
- Delete: `src/lib/sim-page/LayersSection.svelte`, `LayersSection.svelte.spec.ts`
- Modify: `src/lib/sim-page/PolicyPanel.svelte:15,64-77,166-167` (+ spec)
- Modify: `e2e/sim.spec.ts:220-228`, `e2e/sim-share.spec.ts:322-342`, `e2e/fzp.spec.ts:1,129-138`, `e2e/fzp-sim.spec.ts`
- Modify: `docs/dev/sim-page.md` (intro, "Autosave…" `start=fzp` bullet), `docs/dev/fzp-mode.md` ("Routing", e2e notes)

**Interfaces:**
- Consumes: `DEFAULT_POLICY` (Task 1).
- Produces: `SimPage` props without `start`; `persist?: 'restore' | 'off'` (default `'off'` in view, else `'restore'`). `/fzp` → 307 `/sim?<params>` with `start` removed if present. `PolicyPanel` sections `'zoning' | 'protections' | 'timing'` until Task 4. `Autosave.guard` and `rememberPublished` (`src/lib/sharing/autosave.svelte.ts:138,202`) stay: builder's call, the shared sharing module documents them and removing them is not this spec's scope.

- [ ] **Step 1: Write the failing tests**

`src/routes/fzp/page.spec.ts`:

```ts
it('redirects to /sim keeping every parameter but start', () => {
  expect(() => load({ url: new URL('http://x/fzp?seed=5&start=fzp&a=1') } as never)).toThrow(
    expect.objectContaining({ status: 307, location: '/sim?seed=5&a=1' })
  );
});
```

`src/routes/sim/page.spec.ts`: the load's data has no `start` key (`expect('start' in data).toBe(false)`) for `/sim?start=fzp`. `PolicyPanel.svelte.spec.ts`: no button named "Zoning layers" (`expect(page.getByRole('button', { name: 'Zoning layers' }).query()).toBeNull()`).

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/routes/fzp src/routes/sim/page.spec.ts` and `npx vitest --run --project client src/lib/sim-page/PolicyPanel.svelte.spec.ts`
Expected: FAIL (location keeps `start=fzp`; data has `start`; the layers button exists).

- [ ] **Step 3: Implement**

Remove `start` end to end, the `'deferred'` branch of `persistMode` and the effect's deferred guard (`SimPage.svelte:160-162,214-227,237-245,257-260`), `FZP_KEPT_TEXT` and its notice, and the layers section. `e2e/fzp.spec.ts` uses `FZP_PATH = '/sim'` and seed URLs `/sim?seed=N`; delete the "/fzp keeps the saved policy" test; the redirect test asserts `/fzp?seed=5` lands on `/sim?seed=5`.

- [ ] **Step 4: Verify**

Run: `npx vitest --run --project server src/routes src/lib/sim-page` and `npx vitest --run --project client src/lib/sim-page src/routes`, then `npm run check`
Expected: PASS, 0 errors.
Run: `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/sim.spec.ts e2e/fzp.spec.ts e2e/fzp-sim.spec.ts e2e/sim-share.spec.ts --project=chromium`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/routes src/lib/sim-page e2e docs/dev/sim-page.md docs/dev/fzp-mode.md
git commit -m "feat(sim): open on FZP by default; drop start=fzp and the zoning layers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Policy document schema 2 and its controls

The recipe becomes rules, custom strokes and category protections; every control for a removed field goes with it. This replaces Task 1's bridge.

**Files:**
- Modify: `src/lib/sim-page/policy.ts`, `sim-doc.ts`, `policy-store.svelte.ts` (types only), `brush-summary.ts`, `brush-forms.svelte.ts`, `RuleBrushForm.svelte`, `BrushCard.svelte`, `BrushSection.svelte`, `brush-tools.svelte.ts`, `stroke-adapter.ts`, `PhoneToolBar.svelte`, `ProtectionsSection.svelte`, `PolicySummary.svelte`, `lot-overlay.ts`, `SimPage.svelte`, `reconcile.ts` (types only), and every matching `*.spec.ts`
- Modify: `src/lib/sim/levers/types.ts`, `resolve.ts` (`Protections.lots` removed) and specs
- Modify: `src/lib/sharing/fixtures/` or `src/lib/sim-page/test/` policy fixtures that carry schema-1 bodies
- Modify: `e2e/sim.spec.ts` (Paint stroke, brushed protection, Area form tests), `e2e/sim-share.spec.ts` (seeded bodies)
- Modify: `docs/dev/sim-page.md` ("The recipe and its compile rules", "Stop types and bands"), `docs/dev/plan-sharing.md` ("Policies (`/sim`)": schema 2, `op_count`, limits)

**Interfaces:**
- Consumes: `SimLevers`, `StoryEdit`, `Compare`, `DEFAULT_LEVERS` (Task 1); `BrushQuery` (`src/lib/sim/levers/brushes.ts`, unchanged; its `area` kind stays in the worker, builder's call: the spec drops Area "for now" from the document only).
- Produces (`src/lib/sim-page/policy.ts`):
  ```ts
  export interface Stroke { path: [lng: number, lat: number][]; radiusM: number }
  export interface TransitBand { maxM: number; stories: number }
  export type ZoningRule =
    | { id: string; kind: 'transit'; stopTypes: StopType[]; bands: TransitBand[] }
    | { id: string; kind: 'street'; classes: StreetClass[]; names: string[]; depth: 0 | 1;
        ncOnly: boolean; stories: number }; // ncOnly: the Commercial corridor preset
  export type CustomBrush =
    | { id: string; kind: 'paint'; strokes: Stroke[]; stories: number }
    | { id: string; kind: 'erase'; strokes: Stroke[] };
  export interface CategoryProtections { rentControl: boolean; historic: boolean; newerThanYears: number | null }
  export interface SimPolicy {
    schema: 2; rules: ZoningRule[]; custom: CustomBrush[]; protect: CategoryProtections; timing: SimTiming;
  }
  export const DEFAULT_POLICY: SimPolicy;
  export function isDefaultPolicy(p: SimPolicy): boolean; // ignores timing.saved
  export function parseSimPolicy(json: unknown, opts?: { presetLayer?: PresetLayerMode }): SimPolicy;
  export function ruleQueries(r: ZoningRule): BrushQuery[]; // transit: one per band, outermost first
  export function customQuery(b: CustomBrush): BrushQuery; // { kind: 'freehand', strokes }
  export function queriesOf(p: SimPolicy): { key: string; query: BrushQuery }[];
  export type Lots = (key: string) => readonly ParcelId[] | undefined;
  /** Lot → painted stories after erasing, last stroke wins; null while a query is unknown. */
  export function paintedLots(p: SimPolicy, lots: Lots): Map<ParcelId, number> | null;
  export function compileLevers(p: SimPolicy, lots: Lots): SimLevers | null;
  export type LotRole = 'changed';
  export function lotRoles(p: SimPolicy, lots: Lots): Map<ParcelId, LotRole>;
  export interface ScoreCopy { plan: string; twin: string; compare: Compare }
  export function scoreCopy(l: SimLevers | null): ScoreCopy; // as Task 1
  ```
  Removed: `BrushMode`, `Effect`, `defaultEffect`, `ZoningBrush`, `ProtectStroke`, `brushQueries`, `protectQueryKeys`, `protectedLots`, `LEGACY_STOCK_LAYERS`.
- Produces (`src/lib/sim/levers/types.ts`): `Protections = { rentControl; historic; newerThanYears }` (no `lots`).
- Produces (`sim-doc.ts`): `SIM_DOC_SCHEMA = 2`; `SimDoc = { schema: 2; kind: 'sim'; datasetVersion; title?; policy: SimPolicy }`; `SIM_KEY` stays `'sfhousing:sim:v1'` (builder's call: the record's own `v` and the doc's schema already gate it, and a new key would orphan the corrupt-copy path); `SIM_CODEC.opCount(d) = d.policy.rules.length + d.policy.custom.length`; stroke limits count `custom` strokes only.
- Produces (`brush-tools.svelte.ts`): `export type SimTool = 'move' | 'paint' | 'erase'; export class SimBrushTools { tool: SimTool; readonly brush: BrushState; stories(): number }`.
- Produces (`stroke-adapter.ts`): `strokeLabel(stories: number): string` → "Allowed 8 stories" ("1 story"); erase label "Erased custom zoning"; a paint stroke appends to the last `custom` brush when it is `paint` with the same `stories`, an erase to the last `erase`; otherwise a new brush (`newOpId()`).
- Produces (`brush-summary.ts`): `RuleKind = 'transit' | 'street' | 'corridor'`; `ruleKindOf(r: ZoningRule): RuleKind`; `ruleSummary(r, lotsText): string`, `customSummary(b, lotsText): string`, `ruleChangeLabel(r): string`, `customChangeLabel(b): string`, `ruleLotStatus(r, result): LotStatus`, `customLotStatus(b, result): LotStatus`. Copy: rule effect "Up to 8 stories" (transit: "Up to 6 stories within 402 m, 4 stories within 805 m"); custom paint "Allow 8 stories · 3 strokes"; no "density limits" tail.
- Produces (`BrushCard.svelte`): props `{ store, sync, list: 'rules' | 'custom', id: string, index, onedit?, editUnavailable?, announce?, onremoved? }`; rules cards have Edit and Remove; custom cards have Move up, Move down and Remove.

- [ ] **Step 1: Write the failing model tests**

`policy.spec.ts`:

```ts
const lotsOf = (m: Record<string, string[]>): Lots => (k) => m[k];
const T = (bands: TransitBand[]): ZoningRule => ({ id: 't', kind: 'transit', stopTypes: ['metro'], bands });

it('the default policy compiles to DEFAULT_LEVERS', () => {
  expect(compileLevers(DEFAULT_POLICY, () => [])).toEqual(DEFAULT_LEVERS);
});

it('transit bands compile to rules; the taller band wins where both apply', () => {
  const p = { ...DEFAULT_POLICY, rules: [T([{ maxM: 402, stories: 4 }, { maxM: 805, stories: 6 }])] };
  const [outer, inner] = ruleQueries(p.rules[0]).map(queryKey);
  const l = compileLevers(p, lotsOf({ [outer]: ['a', 'b'], [inner]: ['a'] }))!;
  expect(l.rules).toEqual([{ lots: ['a', 'b'], stories: 6 }, { lots: ['a'], stories: 4 }]);
  expect(l.compare).toBe('fzp');
});

it('erase removes earlier paint only; paint order is kept', () => {
  const s: Stroke = { path: [[-122.4, 37.77]], radiusM: 20 };
  const p: SimPolicy = { ...DEFAULT_POLICY, custom: [
    { id: '1', kind: 'paint', strokes: [s], stories: 9 },
    { id: '2', kind: 'erase', strokes: [{ ...s, radiusM: 10 }] },
    { id: '3', kind: 'paint', strokes: [{ ...s, radiusM: 5 }], stories: 3 }] };
  const [k1, k2, k3] = p.custom.map((b) => queryKey(customQuery(b)));
  const lots = lotsOf({ [k1]: ['a', 'b', 'c'], [k2]: ['a', 'b'], [k3]: ['b'] });
  expect(compileLevers(p, lots)!.paint).toEqual([{ lots: ['c'], stories: 9 }, { lots: ['b'], stories: 3 }]);
  expect(paintedLots(p, lots)).toEqual(new Map([['c', 9], ['b', 3]]));
});

it('undoing back to the default compares with pre-FZP again', () => {
  const store = new PolicyStore(DEFAULT_POLICY);
  store.apply((p) => ({ ...p, protect: { ...p.protect, historic: true } }), 'x');
  expect(compileLevers(store.policy, () => [])!.compare).toBe('fzp');
  store.undo();
  expect(compileLevers(store.policy, () => [])!.compare).toBe('preFzp');
});

it('a timing change alone is a customisation', () => {
  const p = { ...DEFAULT_POLICY, timing: { ...DEFAULT_POLICY.timing,
    current: { ...DEFAULT_POLICY.timing.current, localProgramStreamlined: false } } };
  expect(isDefaultPolicy(p)).toBe(false);
});

it.each(['stock', 'assumeAlternativePlanKept', 'compare', 'brushes'])('rejects the removed key %s', (k) => {
  expect(() => parseSimPolicy({ ...DEFAULT_POLICY, [k]: [] })).toThrow(PolicyFormatError);
});
it('rejects protect.strokes and a street rule with mode or densityLimits', () => {
  expect(() => parseSimPolicy({ ...DEFAULT_POLICY, protect: { ...DEFAULT_POLICY.protect, strokes: [] } })).toThrow(/protect\.strokes: unknown key/);
  const street = { id: 's', kind: 'street', classes: ['arterial'], names: [], depth: 0, ncOnly: false, stories: 6, mode: 'raise' };
  expect(() => parseSimPolicy({ ...DEFAULT_POLICY, rules: [street] })).toThrow(/rules\[0\]\.mode: unknown key/);
});
it("rejects an 'area' rule", () => {
  expect(() => parseSimPolicy({ ...DEFAULT_POLICY, rules: [{ id: 'a', kind: 'area' }] })).toThrow(/rules\[0\]\.kind/);
});
```

`sim-doc.spec.ts`:

```ts
it('a schema-1 document is unknown-schema, not future-schema', () => {
  const r = parseSimDoc(JSON.stringify({ schema: 1, kind: 'sim', datasetVersion: 'fixture-0', policy: {} }), 'reconcile');
  expect(r).toEqual({ ok: false, errors: [expect.objectContaining({ path: '/schema', code: 'unknown-schema' })] });
});
it('round-trips schema 2 and counts rules plus custom brushes as ops', () => {
  const d: SimDoc = { schema: 2, kind: 'sim', datasetVersion: 'fixture-0', policy: { ...DEFAULT_POLICY,
    custom: [{ id: '1', kind: 'paint', strokes: [{ path: [[-122.4, 37.77]], radiusM: 20 }], stories: 8 }] } };
  expect(SIM_CODEC.load(SIM_CODEC.serialize(d))).toEqual({ ok: true, value: d });
  expect(SIM_CODEC.opCount(d)).toBe(1);
});
```

`sim-session.spec.ts`: restoring a stored record whose body is a schema-1 policy gives the default policy, notice N1, and a copy under `sfhousing:sim:corrupt:<ISO>` (use the existing restore test's fake storage).

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/sim-page`
Expected: FAIL (`ruleQueries`, `customQuery`, `paintedLots` undefined; schema 1 parses).

- [ ] **Step 3: Implement the model**

`policy.ts` and `sim-doc.ts` as the Interfaces block. `compileLevers`: rules in list order (each transit band its own edit, outermost first; edits with no lots are not emitted); paint from `custom` in order with erase removing lots from the paint edits already emitted (today's `emit`, `policy.ts:565-593`); `compare: isDefaultPolicy(p) ? 'preFzp' : 'fzp'`. `lotRoles` marks every lot in a rule edit or `paintedLots` as `'changed'`. Remove `Protections.lots` and its `protectedRows` branch in the engine; `unknownLots` counts rules and paint ids.

- [ ] **Step 4: Run the model tests**

Run: `npx vitest --run --project server src/lib/sim-page src/lib/sim/levers`
Expected: PASS.

- [ ] **Step 5: Write the failing control tests**

- `ProtectionsSection.svelte.spec.ts`: three category checkboxes and the years input; no button named "Protect lots with the brush" and no "Protected with the brush" text.
- `BrushSection.svelte.spec.ts`: the tool radiogroup has exactly Move, Paint, Erase; no "Mode" radiogroup, no "Density limits" checkbox; the stories control's label reads "Allow N stories" (`expect(page.getByText(/Allow \d+ stor/)).toBeVisible()`); "Add a rule" offers Transit, Street and Commercial corridor and no Area.
- `RuleBrushForm.svelte.spec.ts`: no Mode radios, no Density limits checkbox; saving a street form calls `onsave` with `{ kind: 'street', …, stories: 6 }` and no `effect`.
- `stroke-adapter.spec.ts`: two Paint strokes at 8 stories make one `custom` paint brush with two strokes, labelled "Allowed 8 stories"; a Paint at 8 then at 5 makes two brushes; an Erase appends an `erase` brush labelled "Erased custom zoning".
- `lot-overlay.spec.ts`: one layer of filled dots (`sim-lots`) plus the halo; no `sim-lots-protected` layer; `LOT_COLORS.light.changed` keeps today's raise blue `[29, 78, 216]` (plan 2 replaces the dots and plan 3 the palette).
- `PolicySummary.svelte.spec.ts`: lists rules ("Up to 6 stories within 402 m…"), custom brushes, protections by category; no "layers" or "comparison" line.

- [ ] **Step 6: Run them to see them fail**

Run: `npx vitest --run --project client src/lib/sim-page`
Expected: FAIL.

- [ ] **Step 7: Implement the controls**

Retype every listed component to the schema-2 model. `BrushSection` keeps its place as the one "Your zoning" section for now (Task 4 splits it): Undo/Redo, Move/Paint/Erase, `StoriesPopover` with the label "Allow N stories", radius, the map key with one swatch "Your zoning changes", the rules list (`BrushCard list="rules"`) with "Add a rule", then the custom list (`BrushCard list="custom"`). `PhoneToolBar` drops the protect cases. `SimPage`: delete the Protect/Unprotect branch of the tool-key effect (`SimPage.svelte:401-414`), `lotsOf` takes `'rule:<id>' | 'custom:<id>'`, and the lot-dot effect reads `queriesOf` and `lotRoles` as before.

- [ ] **Step 8: Update the e2e and docs**

`e2e/sim.spec.ts`: "a Paint stroke adds a custom brush and Ctrl+Z removes it" (card text `/Allow \d+ stor/`); "a category protection shows the protections line in the score" (check "Rent-controlled buildings (likely)", wait for `status === 'current'`, the score details show "lots protected"); delete "axe: the Area brush form open" and replace it with the Transit rule form. `e2e/sim-share.spec.ts`: seeded and published bodies are schema 2; add "a schema-1 policy link shows the can't-open page" (seed a schema-1 body with `seedPlanRow(request, { body, kind: 'sim' })`, `/s/<id>` shows the existing unparsable-policy heading, status 200 or the page's own error status, not 500). Docs as listed.

- [ ] **Step 9: Verify**

Run: `npm run check`, then `npm run test:unit`
Expected: 0 errors; PASS.
Run: `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/sim.spec.ts e2e/sim-share.spec.ts`
Expected: PASS (chromium and mobile).

- [ ] **Step 10: Commit**

```bash
git add -A src/lib/sim-page src/lib/sim/levers src/lib/sharing e2e docs/dev/sim-page.md docs/dev/plan-sharing.md
git commit -m "feat(sim)!: policy schema 2 with additive rules, custom painting and category protections" -m "Older /sim documents no longer open; nothing migrates them." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Policy pane in four sections

**Files:**
- Create: `src/lib/sim-page/RulesSection.svelte` (+ `RulesSection.svelte.spec.ts`), `CustomZoningSection.svelte` (+ spec)
- Delete: `src/lib/sim-page/BrushSection.svelte` and its spec (their tests move to the two new specs)
- Modify: `src/lib/sim-page/PolicyPanel.svelte` (+ spec), `SimPage.svelte:572-625`
- Modify: `e2e/sim.spec.ts` (section helpers: `expandSection` names)
- Modify: `docs/dev/sim-page.md` ("Layout", items 4, 6, 7, 8)

**Interfaces:**
- Consumes: Task 3's `BrushCard`, `BrushForms`, `RuleBrushForm`, `SimBrushTools`.
- Produces: `RulesSection` props `{ store, sync, catalog?, forms?, inlineForm?, announce? }`; `CustomZoningSection` props `{ store, sync, tools, ontool(t: SimTool): void, announce? }`. `PolicyPanel` props replace `zoning`/`protections` with `rules?: Snippet; custom?: Snippet; protections?: Snippet; timing?: Snippet; history?: Snippet` (the Undo/Redo row). Section ids `'rules' | 'custom' | 'timing' | 'protections'`.

- [ ] **Step 1: Write the failing test**

`PolicyPanel.svelte.spec.ts`:

```ts
it('shows four sections in order; the two zoning sections start open', async () => {
  render(PolicyPanelHost, { open: true });
  const toggles = page.getByRole('heading', { level: 3 }).getByRole('button').elements();
  const titles = ['New zoning rules', 'Custom zoning', 'Permitting timelines', 'Protections'];
  expect(toggles).toHaveLength(4);
  titles.forEach((t, i) => expect(toggles[i].textContent).toContain(t));
  expect(toggles.map((b) => b.getAttribute('aria-expanded'))).toEqual(['true', 'true', 'false', 'false']);
});
it('renders the history row above the sections', async () => {
  render(PolicyPanelHost, { open: true });
  const undo = page.getByRole('button', { name: /^Undo/ }).element();
  const first = page.getByRole('button', { name: 'New zoning rules' }).element();
  expect(undo.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
```

(`PolicyPanelHost` is the spec's existing host under `src/lib/sim-page/test/`, extended to pass the new snippets.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest --run --project client src/lib/sim-page/PolicyPanel.svelte.spec.ts`
Expected: FAIL (old sections).

- [ ] **Step 3: Implement**

Move the rules list and "Add a rule" (form inline from md, sub-view below md as today) into `RulesSection`; tools, stories, radius, key and custom list into `CustomZoningSection`. Undo/Redo move into the `history` snippet, rendered once at the top of the sections view: builder's call — the history covers every section, so it no longer belongs inside the first one.

- [ ] **Step 4: Verify**

Run: `npx vitest --run --project client src/lib/sim-page` then `npm run check`
Expected: PASS, 0 errors.
Run: `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/sim.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/sim-page e2e/sim.spec.ts docs/dev/sim-page.md
git commit -m "feat(sim): policy pane sections in order, zoning sections open" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Named comparison and the centred score

**Files:**
- Modify: `src/lib/sim-page/policy.ts` (add `comparisonLine`), `policy.spec.ts`
- Modify: `src/lib/fzp/FzpScorePanel.svelte:158-188` (+ spec)
- Modify: `src/lib/shell/SiteHeader.svelte:104-152` (+ `SiteHeader.svelte.spec.ts`)
- Modify: `docs/dev/sim-page.md` (Layout item 1)

**Interfaces:**
- Consumes: `ScoreCopy` (Tasks 1, 3); `CALCULATING` (`src/lib/fzp/score-view.ts`); `formatCount` (`src/lib/fzp/format.ts`).
- Produces: `export function comparisonLine(copy: ScoreCopy, homes: number | null): string` in `policy.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
it('names what the comparison is against', () => {
  const fzp = scoreCopy(null);
  const mine = scoreCopy({ ...DEFAULT_LEVERS, compare: 'fzp' });
  expect(comparisonLine(fzp, 1234)).toBe('FZP added 1,234 homes vs no FZP');
  expect(comparisonLine(mine, 56)).toBe('Your policy added 56 homes vs FZP');
  expect(comparisonLine(mine, -56)).toBe('Your policy added −56 homes vs FZP');
  expect(comparisonLine(mine, null)).toBe(`Your policy added ${CALCULATING} homes vs FZP`);
});
```

`FzpScorePanel.svelte.spec.ts`: with `copy = scoreCopy(null)` and a score whose `planCompleted` at the month is 1234, the "What the plan added" section's first paragraph reads "FZP added 1,234 homes vs no FZP"; with the `'fzp'` copy, "Your policy added …"; with `planCompleted: null` the section has `aria-busy="true"`.

`SiteHeader.svelte.spec.ts` (at 1024 px, with a `pinned` snippet): the pinned item's centre is within 1 px of the header's centre (`getBoundingClientRect`); at 375 px the existing order (name, status, pinned, Menu) is unchanged.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/sim-page/policy.spec.ts` and `npx vitest --run --project client src/lib/fzp/FzpScorePanel.svelte.spec.ts src/lib/shell/SiteHeader.svelte.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`comparisonLine` formats with `formatCount` and U+2212 for negatives. `FzpScorePanel` renders it as the first `<p>` of the "What {short} added" section (the section keeps its `aria-busy` and existing rows). `SiteHeader`: when `pinned` is given, from md the header is `md:grid md:grid-cols-[1fr_auto_1fr]`; the left cell wraps the site name, the mode links and the status (`flex min-w-0 items-center gap-2`), the centre is the pinned item, the right cell is the actions (`md:justify-self-end`); without `pinned` (and below md) it stays `flex justify-between`. Builder's call: the grid applies only when `pinned` is given, because only `/sim` pins an item.

- [ ] **Step 4: Verify**

Run: the Step 2 commands, then `npm run check`
Expected: PASS, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sim-page/policy.ts src/lib/sim-page/policy.spec.ts src/lib/fzp/FzpScorePanel.svelte src/lib/fzp/FzpScorePanel.svelte.spec.ts src/lib/shell/SiteHeader.svelte src/lib/shell/SiteHeader.svelte.spec.ts docs/dev/sim-page.md
git commit -m "feat(sim): name the comparison in the score and centre the score bar" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: A timeline bar that stays still, with a Setup mode

**Files:**
- Modify: `src/lib/fzp/TimeScrubber.svelte`, `TimeScrubberHarness.svelte`, `TimeScrubber.svelte.spec.ts`
- Modify: `src/lib/fzp/format.ts` (+ `format.spec.ts`)
- Modify: `docs/dev/fzp-mode.md` ("The scrubber contract")

**Interfaces:**
- Consumes: `formatMonthYear` (`format.ts:29`).
- Produces: `export function monthYearLabels(year: number): string[]` (the 12 `formatMonthYear` labels of `year`). `TimeScrubber` props gain `setup?: boolean` (default false) and `onrun?: () => void`. In setup: the button reads "Run" and calls `onrun` (not `toggle`); the range and marker buttons are `disabled`; keys do nothing.

- [ ] **Step 1: Write the failing tests**

```ts
it('has no Simulation pill', () => {
  render(TimeScrubberHarness, props());
  expect(page.getByTestId('fzp-readout').element().textContent).not.toMatch(/Simulation/);
});

it('the play button and the readout keep their width across labels and months', async () => {
  const r = render(TimeScrubberHarness, props({ day: dayFromUtc(2027, 5, 1) })); // "May 2027"
  const btn = () => page.getByTestId('fzp-play').element().getBoundingClientRect().width;
  const out = () => page.getByTestId('fzp-readout').element().getBoundingClientRect().width;
  const w0 = btn(); const o0 = out();
  await r.rerender({ day: dayFromUtc(2027, 9, 1), setup: true }); // "September 2027", "Run"
  expect(btn()).toBe(w0);
  expect(out()).toBe(o0);
  await r.rerender({ day: HORIZON, setup: false }); // "Replay"
  expect(btn()).toBe(w0);
});

it('in setup the button runs and the track is disabled', async () => {
  const onrun = vi.fn();
  render(TimeScrubberHarness, props({ setup: true, onrun }));
  await page.getByRole('button', { name: 'Run' }).click();
  expect(onrun).toHaveBeenCalledOnce();
  await expect.element(page.getByRole('slider', { name: 'Date in the simulation' })).toBeDisabled();
  for (const m of MARKERS) await expect.element(page.getByRole('button', { name: m.name })).toBeDisabled();
});
```

`format.spec.ts`: `monthYearLabels(2066)` has 12 entries, the first "January 2066", the ninth "September 2066".

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project client src/lib/fzp/TimeScrubber.svelte.spec.ts` and `npx vitest --run --project server src/lib/fzp/format.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Remove the pill and its "·". The button gets `data-testid="fzp-play"` and is a one-cell CSS grid: each of "Run", "Play", "Pause", "Replay" sits in the same cell (`[grid-area:1/1]`), the shown one visible and the others `invisible` and `aria-hidden`, so the cell takes the widest label's width in the page's font. The readout (`data-testid="fzp-readout"`) is the same stack over `monthYearLabels(year of day)` with `tabular-nums`, the current label visible. Builder's call: the stack measures the real font, where a fixed `ch` width would not.

- [ ] **Step 4: Verify**

Run: the Step 2 commands
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fzp/TimeScrubber.svelte src/lib/fzp/TimeScrubberHarness.svelte src/lib/fzp/TimeScrubber.svelte.spec.ts src/lib/fzp/format.ts src/lib/fzp/format.spec.ts docs/dev/fzp-mode.md
git commit -m "feat(fzp): fixed-width timeline controls, no pill, and a Run mode" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Setup and Run phases

**Files:**
- Create: `src/lib/sim-page/run-phase.svelte.ts` (+ `run-phase.svelte.spec.ts`)
- Modify: `src/lib/fzp/FzpMode.svelte` (props, an effect, the scrubber call at `:908-920`, the debug hook at `:669-684`), `src/lib/fzp/debug.ts`, `FzpMode.svelte.spec.ts`, `src/lib/fzp/test/FzpModeHost.svelte`
- Modify: `src/lib/sim-page/policy-store.svelte.ts` (+ spec), `PolicyPanel.svelte` (+ spec), `SimPage.svelte` (+ spec), `src/lib/sim-page/test/SimPageHost.svelte`
- Modify: `e2e/fzp.spec.ts` (`gotoFzp`), `e2e/fzp-sim.spec.ts`, `e2e/sim.spec.ts`, `e2e/sim-share.spec.ts`
- Modify: `docs/dev/sim-page.md` (new section "Setup and Run"), `docs/dev/fzp-mode.md` (scrubber contract, debug hook table)

**Interfaces:**
- Consumes: `TimeScrubber`'s `setup`/`onrun` (Task 6); `PolicyPanel`'s sections (Task 4).
- Produces (`run-phase.svelte.ts`):
  ```ts
  export type SimPhase = 'setup' | 'run';
  export class RunPhase {
    phase: SimPhase; // $state, starts 'setup'; never persisted
    run(): void; // setup → run
    reset(): void; // run → setup ("Change policy" / "Back to start")
  }
  ```
- Produces (`FzpMode` props): `runPhase?: SimPhase` (absent: today's behaviour) and `onrun?: () => void`. While `'setup'`: `playing` is false and the day is `asOf` (moved with the same path as a scrubber jump, so `onDay` runs). On `onrun`: FzpMode sets an internal `playWhenCurrent` flag; while the phase is `'run'` and the flag is set, playback starts as soon as `scoreBusy` is false, and the flag clears; Pause clears it too. Builder's call: Run never plays a timeline computed before the latest policy.
- Produces (`PolicyStore`): `locked: boolean` ($state, default false); while locked, `apply`, `undo` and `redo` are no-ops (`undo`/`redo` return null).
- Produces (`PolicyPanel` props): `readonly?: boolean`; `onreset?: () => void`; `resetLabel?: 'Change policy' | 'Back to start'`. While `readonly`, a button with `resetLabel` sits at the top of the pane (sections and summary views), the history row is hidden, and each section body is wrapped in `<fieldset disabled class="contents">`; the disclosure toggles still work. Builder's call: a disabled fieldset keeps every control readable and focus-skips it natively.
- Produces (`window.__sfhFzp`): `runPhase: SimPhase | null` (null without `runPhase`).

- [ ] **Step 1: Write the failing tests**

`run-phase.svelte.spec.ts`: a new `RunPhase` is `'setup'`; `run()` makes it `'run'`; `reset()` makes it `'setup'`.

`policy-store.svelte.spec.ts`:

```ts
it('a locked store ignores changes, undo and redo', () => {
  const s = new PolicyStore(DEFAULT_POLICY);
  s.apply((p) => ({ ...p, protect: { ...p.protect, historic: true } }), 'a');
  s.locked = true;
  const before = s.policy;
  s.apply((p) => ({ ...p, protect: { ...p.protect, rentControl: true } }), 'b');
  expect(s.undo()).toBeNull();
  expect(s.redo()).toBeNull();
  expect(s.policy).toBe(before);
});
```

`FzpMode.svelte.spec.ts` (fake worker, as the existing specs):

```ts
it('setup pins the day at asOf; Run waits for the current score, then plays', async () => {
  const h = renderFzp({ runPhase: 'setup', levers: DEFAULT_LEVERS });
  await h.ready();
  expect(h.debug().day).toBe(h.debug().asOf);
  await expect.element(page.getByRole('slider', { name: 'Date in the simulation' })).toBeDisabled();
  h.setLevers({ ...DEFAULT_LEVERS, compare: 'fzp' }); // sent, not yet answered: score busy
  await page.getByRole('button', { name: 'Run' }).click();
  h.setPhase('run');
  expect(h.debug().playing).toBe(false);
  h.worker.answerCurrent(); h.worker.answerTimeline(); // the sent rev's timeline
  await expect.poll(() => h.debug().playing).toBe(true);
});
it('back to setup pauses and returns to asOf', async () => {
  const h = renderFzp({ runPhase: 'run', levers: DEFAULT_LEVERS });
  await h.ready();
  h.scrubTo(h.debug().asOf + 400);
  h.setPhase('setup');
  await expect.poll(() => h.debug().day).toBe(h.debug().asOf);
  expect(h.debug().playing).toBe(false);
});
```

(`renderFzp`, `setLevers`, `setPhase`, `scrubTo` and the worker's `answer*` are the spec's helpers; add the ones missing to `FzpModeHost.svelte` and the spec's fake worker.)

`SimPage.svelte.spec.ts`:

```ts
it('Run locks the pane and resets the tool; Change policy unlocks it', async () => {
  const h = renderSimPage();
  await h.ready();
  await page.getByRole('checkbox', { name: /Historic/ }).click(); // one change to undo
  await h.chooseTool('paint');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect.element(page.getByRole('button', { name: 'Change policy' })).toBeVisible();
  await expect.element(page.getByRole('checkbox', { name: /Rent-controlled/ })).toBeDisabled();
  expect(h.tools().tool).toBe('move');
  const before = h.store().policy;
  await userEvent.keyboard('{Control>}z{/Control}');
  expect(h.store().policy).toBe(before); // the controller's undo key changed nothing
  expect(h.store().locked).toBe(true);
  await page.getByRole('button', { name: 'Change policy' }).click();
  await expect.element(page.getByRole('checkbox', { name: /Rent-controlled/ })).toBeEnabled();
  expect(h.store().locked).toBe(false);
});
it('the view reads Back to start and opens in Setup', async () => {
  renderSimPage({ mode: 'view', initialPolicy: DEFAULT_POLICY });
  await page.getByRole('button', { name: 'Run' }).click();
  await expect.element(page.getByRole('button', { name: 'Back to start' })).toBeVisible();
});
it('a remount opens in Setup', async () => {
  const h = renderSimPage(); await h.ready();
  await page.getByRole('button', { name: 'Run' }).click();
  h.remount();
  await expect.element(page.getByRole('button', { name: 'Run' })).toBeVisible();
});
```

(`renderSimPage`, `ready`, `chooseTool`, `tools`, `store` and `remount` are `SimPage.svelte.spec.ts` helpers over `SimPageHost`; add the missing ones there.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project client src/lib/sim-page src/lib/fzp/FzpMode.svelte.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`SimPage` owns `const run = new RunPhase()`; `startRun()` calls `setTool('move')`, sets `store.locked = true`, `run.run()`; `resetRun()` sets `store.locked = false`, `run.reset()`. It passes `runPhase={run.phase}` and `onrun={startRun}` to FzpMode and `readonly={run.phase === 'run'}`, `onreset={resetRun}`, `resetLabel={mode === 'view' ? 'Back to start' : 'Change policy'}` to PolicyPanel. The phone tool bar shows only in Setup. The worker keeps computing in Setup unchanged (LeverSync and `setLevers` are untouched).

- [ ] **Step 4: Update the e2e**

`e2e/fzp.spec.ts` `gotoFzp` and `e2e/sim.spec.ts` `gotoSim` take `{ run?: boolean }`: with `run`, press Run, then Pause, then Home on the slider, and wait for `__sfhFzp.day === asOf` and `playing === false`. Pass `run: true` in every test that scrubs, plays or presses a marker. Add to `e2e/sim.spec.ts`: "Run locks the policy and Change policy returns to the present" (Run → "Change policy" visible, a protections checkbox disabled → Change policy → day is `asOf`, the checkbox enabled, `runPhase === 'setup'`) and an axe pass with the pane open during a run.

- [ ] **Step 5: Verify**

Run: `npm run check`, then `npm run test:unit`
Expected: 0 errors; PASS.
Run: `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/sim.spec.ts e2e/fzp.spec.ts e2e/fzp-sim.spec.ts e2e/sim-share.spec.ts`
Expected: PASS (chromium and mobile).

- [ ] **Step 6: Commit**

```bash
git add -A src/lib/sim-page src/lib/fzp e2e docs/dev/sim-page.md docs/dev/fzp-mode.md
git commit -m "feat(sim): Setup and Run phases with a read-only policy during a run" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Remove the scenario engine's law switch

After Task 1 no caller sets `SimInput.lawSwitch` (grep `lawSwitch` in `src`: only `scenario/{engine,input,card,types}.ts` and specs remain). This task deletes the dead path.

**Files:**
- Modify: `src/lib/sim/scenario/types.ts:44-47,70`, `engine.ts:209-243,820-915`, `input.ts:95-120,240-310`, `card.ts:211-213`, `card.spec.ts`, `types.spec.ts`
- Delete: `src/lib/sim/scenario/engine-switch.spec.ts`
- Modify: `docs/dev/sim-levers.md` (drop the "Notes for plans 3 and 4" switch bullets), `docs/dev/fzp-mode.md` if it mentions `afterSwitch`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SimInput` without `lawSwitch`; `Schedule` without `afterSwitch`; `Precompute` without `after`; `afterInputOf` removed.

- [ ] **Step 1: Pin the goldens first**

Run: `npx vitest --run --project server src/lib/sim/scenario`
Expected: PASS before any change (the goldens, `fixtures/golden-seed1.json`, and the engine specs are the regression net; a run with no `lawSwitch` never took the removed branches, `engine.ts:915`).

- [ ] **Step 2: Remove the switch**

Delete the fields, the `sw` member of `Run`, the `after` view in `precomputeOf` (candidates become the plain hostable-hazard set), the `T0` / `l2` branch of the initiation draw, and `card.ts`'s after-view pick. `npm run check` reports every remaining reference.

- [ ] **Step 3: Verify**

Run: `npm run check`, then `npx vitest --run --project server src/lib/sim`
Expected: 0 errors; PASS with the goldens unchanged (`git diff --stat src/lib/sim/scenario/fixtures` is empty).

- [ ] **Step 4: Commit**

```bash
git add -A src/lib/sim/scenario docs/dev/sim-levers.md docs/dev/fzp-mode.md
git commit -m "refactor(sim): remove the scenario engine's unused law switch" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Open questions

1. **Painting a lot to its current FZP height.** Painting always sets `(N, uncapped)`, so painting a capped lot at its own FZP height lifts its density cap (more homes, same height). Rules never touch a lot they don't raise. Recommendation: keep it — the spec says painting sets "exactly N" and every painted change is uncapped; the alternative (paint at the FZP height is a no-op) hides an effect the user asked for. Partner to confirm.
2. **No density-limits control exists on `/`.** The spec (§3) removes one "from paint mode on `/`", but `/`'s paint op carries only `stories` (`src/lib/plan/types.ts:9`) and `src/lib/brush/` has no density control or checkbox; the only density-limits controls are `/sim`'s, which Task 3 removes. Recommendation: nothing to do on `/`.
3. **Transit band semantics changed.** Today the inner band wins; under "highest applicable wins" a taller outer band overrides a shorter inner one. Recommendation: accept (it follows the spec's rule); the form already rejects two bands at one distance.

## Interfaces for plans 2 and 3

- **Policy and rule types** (`src/lib/sim-page/policy.ts`): `SimPolicy { schema: 2; rules: ZoningRule[]; custom: CustomBrush[]; protect: CategoryProtections; timing: SimTiming }`; `ZoningRule` (`transit` with `bands: TransitBand[]`, or `street` with `stories` and `ncOnly` for the corridor preset); `CustomBrush` (`paint` with `strokes` and `stories`, or `erase` with `strokes`); `DEFAULT_POLICY`, `isDefaultPolicy(p)`; `ruleQueries(r)`, `customQuery(b)`, `queriesOf(p)`, `queryKey(q)`; `compileLevers(p, lots): SimLevers | null`; `scoreCopy(l)`, `comparisonLine(copy, homes)`.
- **Where custom strokes live:** `store.policy.custom` (`PolicyStore`, `policy-store.svelte.ts`), in stroke order; each brush's lots are `sync.result(queryKey(customQuery(b)))` (`LeverSync`, `{ ok: true, lots, points }`, points as lng/lat pairs). The lots painted now, after erasing and with their stories: `paintedLots(store.policy, lots): Map<ParcelId, number> | null`. A new stroke is one store change with label "Allowed N stories" (`stroke-adapter.ts`).
- **Lever document** (`src/lib/sim/levers/types.ts`): `SimLevers { schema: 2; rules: StoryEdit[]; paint: StoryEdit[]; protect: Protections; timers; routeShares; localProgramStreamlined; compare: Compare }`, `StoryEdit { lots: ParcelId[]; stories: number }`, `Compare = 'preFzp' | 'fzp'`, `DEFAULT_LEVERS`.
- **Resolution output per lot** (worker, `src/lib/sim/levers/resolve.ts`): `resolveEnvelopes(ctx, levers, asOf): Resolution` with `Resolution.plan.table: EnvelopeTable { count; stories: Uint8Array; cap: Uint16Array (NULL_CAP = none); yield: Uint16Array (count × F); hostable: Uint8Array }` in `parcels.bin` row order. `table.stories[i]` is the **effective allowed stories** (FZP, raised by rules, set by paint; a protected lot keeps its FZP stories with `hostable` 0) — what the fog draws. `Resolution.unprotected.table` is the same without protections. It lives in the worker's `PendingLevers.state.resolution` (`scenario-host.ts` `leverStep`) and is not posted to the page; plan 2 adds the transport it needs (for example a per-row `Uint8Array` on the `levers` `current` message).
- **Phase store** (`src/lib/sim-page/run-phase.svelte.ts`): `RunPhase { phase: SimPhase; run(); reset() }`, `SimPhase = 'setup' | 'run'`, owned by `SimPage` (`run`), starting `'setup'`, never persisted. Overlays shown in Setup only read `run.phase === 'setup'`; their toggles are plan 2's and must keep their own state across a run. FzpMode takes `runPhase` and `onrun`; `window.__sfhFzp.runPhase` reports it.
- **Lot dots:** `lotRoles(p, lots): Map<ParcelId, 'changed'>` and `lotOverlayLayers(L, roles, points, dark)` (`lot-overlay.ts`) are the minimal single-role version; plan 2 removes them.
- **Physical-cap seam:** the generator applies it, not the resolution. Plan 3 adds `physicalMaxStories(site: Site): number` beside `selectTypology` in `src/lib/generator/`, and `generate` clamps its stories with it before choosing a typology. Every yield already flows through `generate`: stock rows from the pipeline (`parcels.bin`, rebuilt with the new dataset) and the worker's Need rows through `envelopeRow` → `grossAt` → `scenarioYield` → `generate` (`src/lib/sim/levers/recompute.ts:80`, `src/lib/data/scenario-yield.ts:1`). So `EnvelopeTable.stories` stays the allowed stories (the fog's height, "Allowed: N") and `yield` becomes buildable once plan 3 lands; the tooltip's "Buildable here: M" calls `physicalMaxStories` on the lot's `Site`. Plan 1 adds no cap parameter.
