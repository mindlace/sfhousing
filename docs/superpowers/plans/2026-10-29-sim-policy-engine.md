# /sim Policy Engine (Plan 2 of 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lever document and the worker engine behind it. Stock-layer toggles, a user layer of per-lot envelope overrides, protections, timer rescales, route shares, in-flight versus new reach, the time-switched current law and its twin all become `PolicyOp`s and `SimInput` fields. The worker resolves them, recomputes touched lots in the background, and posts the transformed lookups. No UI.

**Architecture:** A new `src/lib/sim/levers/` package compiles a `SimLevers` document into envelope tables (stock blend, then user layer, then protections) and calibration rewrites. `envelopeOp`, `timersOp` and `routeSharesOp` are `PolicyOp`s applied through `applyPolicies`. The engine gains three optional `SimInput` fields:

- `newProjects`, the calibration new projects use;
- `inFlightScale`, which rescales the remaining time of in-flight stages;
- `lawSwitch`, a second parcels view in force from a day.

When all three are absent, the engine takes exactly today's code path. The scenario host gains `levers` on `initScenario`, a `setLevers` request and a `levers` response. Lots the user layer touches get their yields recomputed in scheduler slices from their chunk records. No timeline is posted for a lever revision until that recompute is complete.

**Tech Stack:** TypeScript, worker-safe modules in `src/lib/sim/` and `src/lib/data/`, Vitest (`server` and `pipeline` projects), Playwright for the unchanged `/fzp` e2e.

**Spec:** `docs/superpowers/specs/2026-10-28-sim-policy-levers-design.md`. Read all of it, including "Partner rulings after the builder check", "Partner rulings, round 2" (ruling 7 is this plan's), "Calls made after the builder check" and "Carried from plan 1". Read it with plan 1, `docs/superpowers/plans/2026-10-28-sim-data-layers.md`, for the `policy.bin` contract, and with `docs/dev/fzp-mode.md` ("The T9 lookups seam", "Request flow").

## Plan sequence

This is plan 2 of 5. Plan 1 (data layers) is merged. Plan 3 owns the `/sim` page, the `/fzp` → `/sim` routing, the toggles, the brushes and their resolution to lot sets, and `startScenario`'s lever argument in the page. Plan 4 owns the timeline UI, the preset research, the preset values and the stage floors. Plan 5 owns publishing, which includes size limits on the lever document.

## Rulings

Controller rulings and builder's calls this plan rests on. Each one has its reason.

1. **The law switch (round-2 ruling 7): no pipeline change and no dataset bump.**
   - `policy.bin` already carries everything the switch needs: SB 79 as written per lot (`sb79Status`, `sb79Stories`, `sb79Cap`, `sb79Yield`, `hostableSb79`, which ignore the exemptions per ruling 3), the permanent-exemption flag `exemptPermanent` (Ord. 082-26 §3) and `fzpYieldCap`. The FZP row is in `parcels.bin`.
   - From the switch day, current law per lot is the SB 79 row where `sb79Status = 'applies'`, `exemptPermanent = 0` and `mostPermissive(fzp, sb79) = 'b'`. Otherwise it is the FZP row. SB 79 raises the floor over local zoning. §207.11 lapses with the Alternative Plan. The temporary exemptions end on the same date, one year after the 7th-cycle Housing Element, so they are not applied.
   - Measured on `2026-10-29-0fd62c4d`: 87,165 lots are SB 79 `applies`. 1,657 lots are permanently exempt, and only 7 of those are `applies`. After the switch, SB 79 beats FZP on 26,653 lots.
   - The default is `CURRENT_LAW_SWITCH.day = 2032-01-31`, with tier 4 provenance labelled "Assumption: SB 79 as written takes effect one year after the 7th-cycle Housing Element due date". `assumeAlternativePlanKept: true` keeps FZP + §207.11 throughout.
   - **Builder's call:** a project keeps the regime of the month it initiated in, for both its hazard and its envelope. Reason: a filed application vests the standards in force, as SB 330's preliminary application does (Gov. Code §65941.1). In-flight projects keep their current envelope.
2. **§207.11 null cap and height: a code and comment fix with a V33 assertion. No dataset bump.**
   - The ordinance text (Ord. 082-26 §5, `https://media.api.sf.gov/documents/o0082-26.pdf`, p. 6–7):
     - (b): "applies to residential development projects on parcels meeting all of the following conditions";
     - (b)(3): "Either limits residential density by Numeric Density, or has a height limit of less than 40 feet";
     - (b)(8): "The permitted density prior to applying the density and height exception in subsection (c) does not meet the minimum density required by California Government Code Section 65912.157";
     - (c)(2): "For any housing development project located on a site meeting the criteria in subsection (b) and with a height limit of less than 40 feet, the applicable height limit shall be 40 feet."
   - **Null cap.** A lot with no density cap permits unlimited density. It therefore meets any minimum, and (b)(8) fails. Such a lot never qualifies, and the provisional ruling stands. `s207Status` returns `meets-minimum` for a null cap that reaches (b)(8). `s207Envelope` takes a non-null `fzpCap: number`, and `s207Row` throws on an `applies` row with a null cap. The `fzpCap ?? 0` default goes.
   - **Under-40 ft height.** §207.11 applies per project, and (c)(2) reads that project's height limit. In the model, every project on a Local Program lot uses the Local Program: `fzpYieldCapOf` gives it no cap, it is forced onto streamlined, and its envelope is the Local Program height. So the height §207.11 reads is `lpFt` on a Local Program lot and `baseFt` elsewhere. The input is renamed `fzpBaseFt` → `fzpHeightFt`.
   - **Shipped rows are unaffected.** Measured on `2026-10-29-0fd62c4d`:
     - 79,805 Local Program lots, none with a base height under 40 ft;
     - every null-cap row is `no-limit` (75,381), `outside` (18,021), `exempt` (3,333), `not-eligible` (706) or `not-residential` (567). None reaches `r4`, `historic`, (b)(8) or `applies`.

     Task 1 proves this with `check` on that build: V33 must stay OK. If it does not, stop. A shipped row would then change, which needs a pipeline task and a dataset bump.
3. **Builder's calls.**
   - **Lever document:** a sibling document type, `SimLevers` (schema 1), not new `PlanOp` variants. The editor's `Plan` is a list of geometric paint ops, while levers are a mostly static configuration. Plan 5 publishes it as its own schema. User edits name lots by `ParcelId`, so the document stays meaningful across row reorderings. Plan 3 resolves brushes to those lot sets.
   - **Stock blend order:** blending is order-insensitive. The canonical order is `currentLaw, fzp, sb79, base`, and a tie keeps the earlier layer, which matches plan 1's "a tie keeps FZP".
   - **User edit semantics:** `raise` gives `max(s, N)`, `lower` gives `min(s, N)` and `set` gives `N`. Edits apply in document order, so a later edit wins. With `densityLimits: true` the cap is the period's current-law cap ("keeps each lot's current-law cap"). With `false` there is no cap. Raise-defaults-to-off is a UI default (plan 3).
   - **Protected lots follow current law's switch.** Protection is defined as "keeps its current-law envelope", and the switch is part of current law. With `assumeAlternativePlanKept` they stay on FZP + §207.11. See Open question 1.
   - **Protection resets every protected lot**, including one the user lowered. The capacity metric is therefore signed.
   - **Local Program forcing:** Local Program lots are forced onto streamlined when `localProgramStreamlined` is set and `fzp` or `currentLaw` is on, since current law contains the FZP map. Otherwise the column is all zero, as in `baseZoning`.
   - **Policy start date = `calibration.asOf`.** A `'new'`-reach timer applies to simulated projects and to pipeline rows whose current stage is `preApplication`, because those have not filed yet. A `'all'`-reach timer applies to everything. Route shares apply to new projects only. That is already how `pathwayForNew` works. Reason: the simulation has no earlier start, and a later one would need a third calibration with no preset asking for it.
   - **Rescale construction** (Task 6): stretch every cumulative-incidence column in time together, then fit the tail so that the eventual shares from month 0 are exact. Reason: it is the spec's "spread kept, exit shares unchanged", and it stays inside `parseCalibration`'s limits.
   - **Remaining-time rescale for in-flight stages:** sample the rescaled transition conditioned on `round(m·s)` months, then map the draw back onto the real elapsed time (Task 8). Reason: the partner ruling says "the remaining time in the stage is rescaled". Conditioning on `m` in the rescaled curve would instead treat the project as `m/s` months old.
   - **Scale bounds:** `MIN_SCALE = 0.05` and `MAX_SCALE = 10` are numerical limits only. Sourced physical floors are plan 4's. Reason: at 0.05 every live and fixture table still has `C(K') ≤ 1 − 1e-6`.
   - **References:** the existing `REFERENCES` are FZP-versus-pre-FZP estimates on `planEffect.*`. They are shown only when `compare = 'preFzp'`. With `'currentLaw'`, only `completedNet` references remain. Reason: the two series would no longer measure the same thing (see Spec contradictions).
   - **Capacity metric:** static net capacity, Σ over hostable lots of max(0, full-fill yield − existing homes), the same measure as `policy.current.net_capacity`. It is given for the plan with and without protections, before and after the switch. Reason: "how much capacity the protections removed" is a capacity, and a third simulated twin would double the band cost.
   - **Disapproval-zero threshold:** the exception is negligible when every pathway's eventual disapproved share of new projects is below 1% (`DISAPPROVAL_NEGLIGIBLE = 0.01`). Reason: that is below the run-to-run spread of the band.

## Global Constraints

- **Determinism.** Spec: "deterministic in `(dataset, levers, seed)`, with common random numbers across the pair". No draw depends on timing, chunk arrival order or toggle order.
- **`/fzp` is unchanged.** `initScenario` without `levers` takes today's path exactly: no `policy.bin` fetch, no `levers` message, byte-identical timelines. `docs/dev/fzp-mode.md`'s contract that the worker "fetches only those chunks and the three `scenarios/fzp/` files" holds. `e2e/fzp.spec.ts` and `e2e/fzp-sim.spec.ts` pass unmodified.
- **Anti-goal: "A policy that skips the simulation. No user setting may decide directly how much gets built."** Levers change only envelopes, yields, hostability, transitions and pathway shares.
- **Locked values.** Spec: "Construction is shown but locked." `parseSimLevers` rejects a construction timer. Spec: "The chances of advancing are shown, not editable." No lever writes an exit column, except the disapproval exception, and Task 7 measures it first.
- **Scoring.** "Total net units against RHNA ... (82,069 by 2031-01-31, plus the 15%-buffer reference and the existing references)". `targetsOf` and `RHNA_DEADLINE` are unchanged.
- **Shared yield rule.** User-layer yields and `hostable` come from `scenarioYield` through `envelopeRow`, the computation `parcels.bin` and `policy.bin` use (scenario-data spec §5).
- **Evidence hierarchy.** Every new constant carries its tier and source in a comment or `Provenance`. Invented values are marked tier 4.
- **Stack and style.** Svelte 5 / TS, colocated Vitest, `expect.requireAssertions` (every test calls `expect`), 2-space indent, single quotes, no trailing commas, 100 columns. Worker modules are zod-free, DOM-free and `$app`-free.
- **No CSP change, no new dependency.**
- **Shell and worktree.** Never compound `cd … && cmd`. Work only in `.claude/worktrees/sim-policy-levers` (branch `sim-policy-engine`).
- **No push, no upload.** `npm run signoff` runs once, after the last task, when the controller asks.
- **Commits.** Conventional Commits, with `-m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"` as the last `-m`.

## Review Focus

1. **Brush strokes faster than the recompute.** Two `setLevers` arrive while the first is still resolving. Only the latest lever revision gets `current` and a timeline, and no timeline mixes old and new envelopes. Task 12 test `latest setLevers wins`.
2. **A touched lot's chunk fails to load.** The status stays `resolving` and names the failed cells. `retryChunks` resumes the recompute. The run never starts with the touched lots missing. Task 12 test `chunk failure holds the lever revision`.
3. **The switch day relative to the run window.** `asOf ≥ switchDay`: the after-switch law is in force from the start, with no `lawSwitch`. `horizon < switchDay`: there is no `lawSwitch`. A `lawSwitch` whose parcels equal the base gives a byte-identical run. Tests in Tasks 4 and 9.
4. **A user edit names a lot that is not in `parcels.bin`** (a stale id, another dataset) or repeats one. The lot is ignored and counted in `unknownLots`, and nothing throws. Task 4 test `unknown and duplicate lots`.
5. **Extreme timer scales.** At `MIN_SCALE` the table shrinks to one month. At `MAX_SCALE` it is cut at 240 months. `parseCalibration` accepts both, and the eventual shares hold within 1e-9. A scale outside `[MIN_SCALE, MAX_SCALE]` fails in `parseSimLevers`, not in the engine. Task 6 tests.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `pipeline/lib/current-law.ts`, `pipeline/steps/policy.ts`, `pipeline/steps/check-policy.ts`, `pipeline/sb79-config.ts` | Ruling 2: null cap at (b)(8), applicable height, V33 assertion |
| `src/lib/data/envelope-row.ts` (new) | `envelopeRow` / `EnvelopeRow`, moved from `pipeline/lib/current-law.ts` so the worker shares it |
| `src/lib/sim/levers/types.ts` (new) | `SimLevers`, `parseSimLevers`, `DEFAULT_LEVERS`, `FZP_COMPAT_LEVERS`, `CURRENT_LAW_SWITCH`, scale bounds |
| `src/lib/sim/levers/layers.ts` (new) | `EnvelopeTable`, stock tables, after-switch current law, `blendStock` |
| `src/lib/sim/levers/resolve.ts` (new) | User layer, protections, `Need`s, `fillNeeds`, capacity metric |
| `src/lib/sim/levers/view.ts` (new) | `parcelsView`, `envelopeOp`, `localProgramColumn` |
| `src/lib/sim/levers/timers.ts` (new) | `rescaleTransition`, `scaleTable`, `timersOp`, `routeSharesOp`, `disapprovedShare` |
| `src/lib/sim/levers/apply.ts` (new) | `applyLevers`, `twinInput`, `lookupsOf` |
| `src/lib/sim/levers/recompute.ts` (new) | `createYieldRecompute`: touched-lot yields from chunk records, in budgeted steps |
| `src/lib/sim/scenario/fixtures/mini-policy.ts` (new) | `miniPolicy(city)`: a `PolicyParcels` over the mini city with named lots |
| `src/lib/sim/scenario/types.ts` | `SimInput` fields; `initScenario.levers`, `setLevers`, the `levers` response |
| `src/lib/sim/scenario/engine.ts`, `input.ts` | Per-job calibration, in-flight remaining-time rescale, law switch |
| `src/lib/sim/scenario/load.ts` | Optional `policy.bin` fetch |
| `src/lib/sim/scenario/scenario-host.ts`, `test/host-harness.ts` | Lever session state, recompute job, band reset, posts |
| `src/lib/sim/scenario-client.ts` | `initScenario(…, levers?)`, `setLevers`, `onLevers`, `leversPending` |
| `scripts/disapproval-share.ts` (new) | Prints `disapprovedShare` for a `calibration.json` |
| `docs/dev/sim-levers.md` (new), `docs/dev/fzp-mode.md`, `docs/dev/pipeline.md`, `CLAUDE.md` | Engine docs, the T9 seam update, the ruling 2 text, the doc link |

---

### Task 1: §207.11 null cap and applicable height (ruling 2)

**Files:**
- Modify: `pipeline/lib/current-law.ts`, `pipeline/steps/policy.ts:440-460`, `pipeline/steps/check-policy.ts:279-345`, `pipeline/sb79-config.ts:318` (the comment) and `UNSOURCED`, `docs/dev/pipeline.md` ("Current law" statuses and height bullets)
- Test: `pipeline/test/current-law.test.ts`, `pipeline/test/invariants.test.ts`

**Interfaces:**
- Produces:
  - `s207Status(a: { …; fzpHeightFt: number | null; fzpCap: number | null; … }): S207Status`. `fzpBaseFt` is renamed `fzpHeightFt`: the height limit of the envelope the model's project uses, `lpFt` on a Local Program lot, else `baseFt`. A null cap that passes (b)(3) by height returns `'meets-minimum'` at (b)(8).
  - `s207Envelope(a: { tier; band; fzpStories: number; fzpHeightFt: number | null; fzpCap: number; lotAreaM2: number }): { stories: number; cap: number }`, with `cap = max(fzpCap, s207Cap)`.
  - `s207Row` throws `Error('s207Row: applies with a null cap')` if that state is ever reached.
  - `envelopeRow` and `EnvelopeRow` move to `src/lib/data/envelope-row.ts` (see Task 3), and `current-law.ts` re-exports them.

- [ ] **Step 1: Failing tests** in `current-law.test.ts`:

```ts
it('a null cap never qualifies (b)(8)', () => {
  expect(s207Row({ ...BASE, fzpCap: null, fzpHeightFt: 30 }).status).toBe('meets-minimum');
  expect(s207Row({ ...BASE, fzpCap: null, fzpHeightFt: 40 }).status).toBe('no-limit');
});
it('reads the Local Program height on a Local Program lot', () => {
  // base 30 ft, LP 65 ft, uncapped: (b)(3) fails on the LP height
  expect(s207Row({ ...BASE, fzpCap: null, fzpHeightFt: 65 }).status).toBe('no-limit');
});
```

  In `invariants.test.ts`: V33 fails when one fixture row has its `fzpYieldCap` set to `NULL_CAP` while staying `applies` / `currentFromS207`, with detail containing `applies with no FZP cap`.
- [ ] **Step 2:** Run `npx vitest --run --project pipeline pipeline/test/current-law.test.ts pipeline/test/invariants.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The step passes `fzpHeightFt: s.localProgram[i] === 1 ? r.lp_ft : r.base_ft` (`lp_ft` is in `sc_height_parse`). If `sc_district` lacks it, select it in `80_scenario.sql`. V33 uses `hd.lpFt ?? hd.baseFt` on Local Program rows, else `hd.baseFt`. `policy.s207.base_ft_mismatch` compares the same value.
  - V33 adds a check: no `applies` row has `fzpYieldCap === NULL_CAP`.
  - Fix the `sb79-config.ts:318` comment to state (b)(8) as ruled. Add the applicable-height reading to `UNSOURCED` (tier 2: the ordinance names "the" height limit of the project).
  - In `docs/dev/pipeline.md`, edit the `no-limit`, `meets-minimum` and "Height and cap" bullets, quoting (b)(8) and (c)(2).
- [ ] **Step 4:** Run the Step 2 tests (PASS). Run `npm run pipeline -- fixture --update-golden`, then `git diff --stat pipeline/test/fixtures/mini/golden e2e/fixtures/data/fixture-0`. Expected: no change.
- [ ] **Step 5: Prove no shipped row changes.** Run `npm run pipeline -- check 2026-10-29-0fd62c4d`. Expected: V33 OK. If V33 fails, or the Step 4 golden changed, **stop and report to the controller**: ruling 2 would then need a dataset bump.
- [ ] **Step 6:** Run `npm run test:pipeline` (PASS). Commit: `git add pipeline docs/dev/pipeline.md`, then `git commit -m "fix(pipeline): §207.11 never qualifies an uncapped lot and reads the project's height (V33)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.

### Task 2: The lever document

**Files:**
- Create: `src/lib/sim/levers/types.ts`
- Test: `src/lib/sim/levers/types.spec.ts`

**Interfaces:**
- Consumes: `Pathway`, `Stage`, `Provenance` (`$lib/timelapse/types`), `ParcelId`, `dayOf` (`src/lib/sim/scenario/dates.ts`).
- Produces:

```ts
export const STOCK_LAYERS = ['currentLaw', 'fzp', 'sb79', 'base'] as const; // canonical blend order
export type StockLayerId = (typeof STOCK_LAYERS)[number];
export type TimedStage = Exclude<Stage, 'complete' | 'construction'>;
export interface UserEdit { lots: ParcelId[]; mode: 'raise' | 'lower' | 'set'; stories: number; densityLimits: boolean }
export interface Protections { rentControl: boolean; historic: boolean; newerThanYears: number | null; lots: ParcelId[] }
export interface TimerEdit { pathway: Pathway; stage: TimedStage; scale: number; reach: 'all' | 'new' }
export interface SimLevers {
  schema: 1;
  stock: StockLayerId[];
  assumeAlternativePlanKept: boolean;
  user: UserEdit[];
  protect: Protections;
  timers: TimerEdit[];
  routeShares: Record<Pathway, number> | null; // null = observed pathwayForNew
  localProgramStreamlined: boolean;
  compare: 'currentLaw' | 'preFzp';
}
export const MIN_SCALE = 0.05; // tier 4, numerical (ruling 3)
export const MAX_SCALE = 10;   // tier 4, numerical
export const CURRENT_LAW_SWITCH: { day: Day; provenance: Provenance }; // dayOf(2032, 1, 31), tier 4
export const DEFAULT_LEVERS: SimLevers;   // stock ['currentLaw'], compare 'currentLaw', assume false, LP on
export const FZP_COMPAT_LEVERS: SimLevers; // stock ['fzp'], compare 'preFzp', everything else empty, LP on
export class LeverFormatError extends Error { readonly path: string }
export function parseSimLevers(json: unknown): SimLevers; // returns a normalised copy
```

- [ ] **Step 1: Failing tests:**
  - `parseSimLevers(DEFAULT_LEVERS)` and `parseSimLevers(FZP_COMPAT_LEVERS)` round-trip `toEqual`.
  - `stock` is normalised to canonical order and de-duplicated: `['sb79', 'fzp', 'sb79']` gives `['fzp', 'sb79']`.
  - Each of these throws `LeverFormatError`, with a `path` naming the field:
    - an empty `stock`;
    - an unknown key;
    - `stories` of -1, 256 or 2.5;
    - `stage: 'construction'`;
    - `scale` of 0.04, 10.01 or NaN;
    - a negative route share, or shares summing to 0;
    - `newerThanYears` of 0;
    - a non-string lot id.
  - `CURRENT_LAW_SWITCH.day === dayOf(2032, 1, 31)` and `CURRENT_LAW_SWITCH.provenance.tier === 4`.
- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/sim/levers/types.spec.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** with hand-written guards (worker-safe, no zod), in the `parseCalibration` style. Routes shares stay as given; `routeSharesOp` normalises them.
- [ ] **Step 4:** Rerun (PASS). Commit: `feat(sim): the SimLevers document and its parser`.

### Task 3: Stock layers and the time-switched current law

**Files:**
- Create: `src/lib/data/envelope-row.ts`, `src/lib/sim/levers/layers.ts`, `src/lib/sim/scenario/fixtures/mini-policy.ts`
- Modify: `pipeline/lib/current-law.ts` (import and re-export `envelopeRow` from `src/lib/data/envelope-row.ts`)
- Test: `src/lib/sim/levers/layers.spec.ts`

**Interfaces:**
- Consumes: `PolicyParcels`, `NULL_CAP` (`policy-codec`), `mostPermissive` (`stock-layers`), `ScenarioParcels`, `StockLayerId` (Task 2).
- Produces:

```ts
// envelope-row.ts (moved, unchanged)
export interface EnvelopeRow { stories: number; cap: number | null; yield: number[]; hostable: boolean }
export function envelopeRow(a: { stories: number; cap: number | null; eligible: boolean; existingUnits: number; grossAt: (stories: number) => number }): EnvelopeRow;
// layers.ts
export interface EnvelopeTable { count: number; stories: Uint8Array; cap: Uint16Array /* NULL_CAP = none */; yield: Uint16Array /* count × F */; hostable: Uint8Array }
export interface LayerCtx { parcels: ScenarioParcels; policy: PolicyParcels }
export type Period = 'before' | 'after';
export function stockTable(ctx: LayerCtx, id: StockLayerId): EnvelopeTable; // views over decoded columns; 'currentLaw' = FZP + §207.11
export function currentLawAfterTable(ctx: LayerCtx): EnvelopeTable; // ruling 1; memoised per ctx
export function currentLawTable(ctx: LayerCtx, period: Period, assumeAlternativePlanKept: boolean): EnvelopeTable;
export function blendStock(ctx: LayerCtx, layers: readonly StockLayerId[], period: Period, assumeAlternativePlanKept: boolean): EnvelopeTable;
// mini-policy.ts
export const MINI_SB79_ID: ParcelId, MINI_EXEMPT_PERM_ID: ParcelId, MINI_S207_ID: ParcelId, MINI_HISTORIC_ID: ParcelId, MINI_TIE_ID: ParcelId;
export function miniPolicy(city: MiniCity): PolicyParcels;
```

  - Row sources:
    - `fzp`: `envelopeStories`, `fzpYieldCap`, `yield`, `hostable`;
    - `base`: `baseStories`, `baseCap`, `baseYield`, `hostableBase`;
    - `sb79`: `sb79*`, `hostableSb79`;
    - `currentLaw`: `current*`, `hostableCurrent`.
  - In period `'after'`, `currentLaw` means `currentLawAfterTable` unless `assumeAlternativePlanKept` is set.
  - `blendStock` walks the layers in `STOCK_LAYERS` order. Per row it keeps the running winner unless `mostPermissive(winner, next) === 'b'`, where top = `yield[F−1]`. It copies the winning row's four fields, so a row's stories, cap and yields always come from one layer.

- [ ] **Step 1: Failing tests:**
  - `miniPolicy(miniCity())` survives `decodePolicyPayload(encodePolicyPayload(…))`.
  - `blendStock(ctx, ['fzp'], 'before', false)` equals the FZP columns element-wise.
  - In `['fzp', 'sb79']`, `MINI_SB79_ID` takes the SB 79 row, and `MINI_TIE_ID` (equal tops) keeps FZP.
  - `['sb79', 'fzp']` gives the same table as `['fzp', 'sb79']`.
  - `currentLawAfterTable`: `MINI_EXEMPT_PERM_ID` keeps FZP, `MINI_SB79_ID` takes SB 79, and `MINI_S207_ID` drops §207.11 back to the better of FZP and SB 79.
  - With `assumeAlternativePlanKept: true`, `currentLawTable(ctx, 'after', true)` equals `stockTable(ctx, 'currentLaw')`.
- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/sim/levers/layers.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Move `envelopeRow` with its doc comment.
- [ ] **Step 4:** Run the Step 2 test and `npx vitest --run --project pipeline pipeline/test/current-law.test.ts` (PASS). Commit: `feat(sim): stock-layer tables, the blend and the time-switched current law`.

### Task 4: User layer, protections and the capacity metric

**Files:**
- Create: `src/lib/sim/levers/resolve.ts`
- Test: `src/lib/sim/levers/resolve.spec.ts`

**Interfaces:**
- Consumes: Task 3 (`EnvelopeTable`, `LayerCtx`, `blendStock`, `currentLawTable`, `stockTable`, `currentLawAfterTable`); Task 2 (`SimLevers`, `Protections`); `EnvelopeRow`.
- Produces:

```ts
export interface Need { row: number; stories: number; cap: number | null }
export const needKey: (n: Need) => string; // `${row}:${stories}:${cap ?? 'n'}`
export interface PeriodResolution { table: EnvelopeTable; needs: Need[] } // a Need row's yield/hostable are 0 until filled
export interface Resolution {
  before: PeriodResolution;
  after: { day: Day; period: PeriodResolution } | null;
  unprotected: { before: PeriodResolution; after: PeriodResolution | null }; // same plan, protections off
  protectedRows: Int32Array;
  unknownLots: number;
}
export function protectedRows(ctx: LayerCtx, p: Protections, asOf: Day): { rows: Int32Array; unknown: number };
export function resolveEnvelopes(ctx: LayerCtx, levers: SimLevers, window: { asOf: Day; horizon: Day; switchDay: Day }): Resolution;
export function allNeeds(r: Resolution): Need[]; // de-duplicated by needKey, sorted by (row, stories, cap)
export function fillNeeds(r: Resolution, rows: ReadonlyMap<string, EnvelopeRow>): Resolution; // throws on a missing need
export function netCapacity(t: EnvelopeTable, parcels: ScenarioParcels): number;
export interface LeverCapacity {
  plan: number; withoutProtections: number; protectedLots: number;
  afterSwitch: { plan: number; withoutProtections: number } | null;
}
export function leverCapacity(r: Resolution, parcels: ScenarioParcels): LeverCapacity;
```

  - **Resolution order, per period** (spec "Resolution order"):
    1. `blendStock`.
    2. Each `UserEdit` in order, on its known lots: `raise` max, `lower` min, `set`. Then the cap: `densityLimits ? currentLawTable(period).cap[row] : NULL_CAP`.
    3. Each protected row takes `currentLawTable(period)`'s row.
  - A row whose final `(stories, cap)` equals one of its own stock rows (`fzp`, `base`, `sb79`, `currentLaw`, after-switch current law) reuses that row's yields and `hostable`. `stories = 0` gives zero yields and `hostable = 0`. Every other row is a `Need`.
  - `after` is non-null only when `currentLaw ∈ stock`, `!assumeAlternativePlanKept` and `asOf < switchDay ≤ horizon`. When `switchDay ≤ asOf`, `before` already uses the after-switch law.
  - Protection categories:
    - `rentControl`: `parcels.rentControlLikely`;
    - `historic`: `policy.historicProtected` (A/A\*, ruling 4);
    - `newerThanYears N`: `yearBuilt > 0 && yearBuilt ≥ year(asOf) − N`;
    - `lots`: by id.
  - `netCapacity` is Σ over `hostable` rows of `max(0, yield[F−1] − existingUnits)`.

- [ ] **Step 1: Failing tests** (mini city, `miniPolicy`):
  - `raise`, `lower` and `set` on a 4-story FZP lot: raise 6 → 6, raise 3 → 4, lower 2 → 2, set 0 → 0 with `hostable` 0 and no `Need`.
  - A later edit wins. `densityLimits: true` takes `currentCap`, and `false` gives `NULL_CAP`.
  - A protected lot equals its current-law row after a raise and after a lower. In the lowered case, `withoutProtections − plan < 0`.
  - `unknown and duplicate lots`: the ids `['nope', id, id]` give `unknownLots` 1 and no throw.
  - Over every row, `withoutProtections − plan` equals the Σ of protected rows' net-capacity differences.
  - A raise to a lot's SB 79 `(stories, cap)` gives no `Need`. A raise to 7 stories gives `Need { row, stories: 7, cap: null }`.
  - `after` is null with `assumeAlternativePlanKept`, with `asOf ≥ switchDay` and with `horizon < switchDay`.
- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/sim/levers/resolve.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Rerun (PASS). Commit: `feat(sim): user-layer overrides, protections and the protection capacity metric`.

### Task 5: The parcels view and `envelopeOp`

**Files:**
- Create: `src/lib/sim/levers/view.ts`
- Test: `src/lib/sim/levers/view.spec.ts`

**Interfaces:**
- Consumes: `EnvelopeTable` (Task 3), `PolicyOp` (`scenario/policy.ts`), `SimLevers` (Task 2).
- Produces:

```ts
export function localProgramColumn(parcels: ScenarioParcels, levers: SimLevers): Uint8Array;
export function parcelsView(parcels: ScenarioParcels, t: EnvelopeTable, localProgram: Uint8Array): ScenarioParcels;
export function envelopeOp(t: EnvelopeTable, localProgram: Uint8Array): PolicyOp; // calibration returned as the same object
```

  `parcelsView` follows the `baseZoning` pattern. It sets `envelopeStories`, `yield` and `hostable` from `t`, and `localProgram` as given. It derives `potentialRatio.fzp = yield[F−1] / max(existingUnits, 1)` (Float32) and `storiesGap.fzp = stories − existingStories` (Int16), the decoder's formulas. The `base` variants are kept. No source column is mutated.

- [ ] **Step 1: Failing tests:**
  - With `t = blendStock(ctx, ['fzp'], …)`, the view's `potentialRatio.fzp` and `storiesGap.fzp` are element-wise `Object.is`-equal to the decoder's.
  - `precomputeOf` of the view gives the same `hazard` array as the base input.
  - `localProgramColumn` is `parcels.localProgram` for `['fzp']` and `['currentLaw']`, all zero for `['sb79']`, and all zero with `localProgramStreamlined: false`.
- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/sim/levers/view.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Rerun (PASS). Commit: `feat(sim): envelopeOp, the parcels view under resolved envelopes`.

### Task 6: Timer rescale and route shares

**Files:**
- Create: `src/lib/sim/levers/timers.ts`
- Test: `src/lib/sim/levers/timers.spec.ts`

**Interfaces:**
- Consumes: `Transition`, `Calibration`, `Pathway` (`$lib/timelapse/types`); `eventualProbabilities`, `parseCalibration`, `typicalMonths` (`$lib/timelapse/model`); `TimerEdit`, `MIN_SCALE` and `MAX_SCALE` (Task 2).
- Produces:

```ts
export type StageScale = Record<Pathway, Partial<Record<TimedStage, number>>>; // absent = 1
export function scaleTable(edits: readonly TimerEdit[], who: 'inFlight' | 'new'): StageScale; // inFlight: product of 'all' edits; new: product of all edits
export function isIdentity(s: StageScale): boolean;
export function rescaleTransition(t: Transition, s: number): Transition; // s === 1 returns t itself
export function timersOp(scale: StageScale): PolicyOp;      // rescales each scaled transition; parcels unchanged
export function routeSharesOp(shares: Record<Pathway, number> | null): PolicyOp; // normalised pathwayForNew; null = identity
```

- [ ] **Step 1: Failing tests:**
  - **The calibration parses.** For every transition of `mini-calibration.json` and of `fixture-1/calibration.json`, at each s in {0.05, 0.25, 0.5, 2, 4, 10}, `parseCalibration` accepts the calibration with that transition replaced.
  - **The shares hold.** For each `r`, `|eventualProbabilities(t', 0).exit[r] − eventualProbabilities(t, 0).exit[r]| < 1e-9`, and likewise for `advance`.
  - **The median scales.** When `round(K·s) ≤ 240`, `typicalMonths` of the rescaled stage is within ±1 month of `round(s × typicalMonths)`.
  - `rescaleTransition(t, 1) === t`.
  - `scaleTable([{ …filed, scale: 0.5, reach: 'new' }, { …filed, scale: 0.8, reach: 'all' }], 'inFlight')` gives 0.8 on that stage, and `'new'` gives 0.4.
  - `routeSharesOp({ discretionary: 0, streamlined: 2, permitOnly: 2 })` gives shares 0, 0.5 and 0.5, and keeps `provenance`.
- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/sim/levers/timers.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `rescaleTransition`.** The signature and tests do not fix the construction, so here it is:

```text
C_j(x), x ≥ 0 real, per column j (advance and each exit reason):
  x ≤ K: linear interpolation of the table between whole months, C_j(0) = 0
  x > K: C_j(K) + (1 − C(K)) · σ_j · (1 − (1 − ρ)^(x − K)),  σ_j = tail_j / ρ   (the model's beyond-table form)
K' = the largest k ≤ min(240, max(1, round(K·s))) with C(k/s) ≤ 1 − 1e-6; none → RangeError
table'_j[k−1] = C_j(k/s), k = 1..K'   (columns: t's table reasons, plus tail reasons with σ_j > 0 when K'/s > K)
ρ' = 1 − (1 − ρ)^(1/s)
π_j = max(0, P_j − C_j(K'/s)) / (1 − C(K'/s)),  P_j = eventualProbabilities(t, 0)
tail'_j = ρ' · π_j   (same keys as t.tail)
provenance: { ...t.provenance, method: t.provenance.method + `; time-rescaled ×${s} (policy lever)` }
tailProvenance: likewise
```

  Use `exp`/`log` from `$lib/timelapse/math` so the result is the same on every platform.
- [ ] **Step 4:** Rerun (PASS). Commit: `feat(sim): rescale stage durations in time with exit shares kept; route shares`.

### Task 7: Measure the disapproved share (the disapproval-zero gate)

**Files:**
- Modify: `src/lib/sim/levers/timers.ts`
- Create: `scripts/disapproval-share.ts`, `docs/dev/sim-levers.md` (section "Disapproval exception")
- Test: `src/lib/sim/levers/timers.spec.ts`

**Interfaces:**
- Produces: `export function disapprovedShare(cal: Calibration): Record<Pathway, number>`. Per pathway, it starts with reach 1 at the first stage after `preApplication`. For each non-terminal stage it adds `reach × eventualProbabilities(t, 0).exit.disapproved`, then multiplies reach by `.advance`. It also exports `DISAPPROVAL_NEGLIGIBLE = 0.01` (ruling 3).

- [ ] **Step 1: Failing test:** on `mini-calibration.json`, `disapprovedShare` equals a hand fold of `eventualProbabilities` over `pathwayStages` within 1e-12. A calibration with every `disapproved` column zeroed gives 0 for every pathway.
- [ ] **Step 2:** Run the test file. Expected: FAIL.
- [ ] **Step 3: Implement.** The script `scripts/disapproval-share.ts <calibration.json>` prints one line per pathway.
- [ ] **Step 4: Measure.** Run `npx tsx scripts/disapproval-share.ts pipeline/out/2026-10-29-0fd62c4d/scenarios/fzp/calibration.json`. A preliminary run of this computation gave discretionary 0.0082, streamlined 0.0034 and permitOnly 0.0012, with Planning stages (filed + entitled) 0.0055 of discretionary.
  - **If every value < `DISAPPROVAL_NEGLIGIBLE`:** record the values, the dataset version and the decision in `docs/dev/sim-levers.md`: "the disapproval exception is dropped (spec: 'If it is negligible, drop the exception')". No lever or op is added.
  - **Otherwise: stop and report to the controller** before adding a lever.
- [ ] **Step 5:** Rerun the tests (PASS). Commit: `feat(sim): measure the disapproved share; record the disapproval-exception decision`.

### Task 8: Engine, per-project calibration and in-flight remaining time

**Files:**
- Modify: `src/lib/sim/scenario/types.ts` (`SimInput`), `src/lib/sim/scenario/engine.ts` (`Job`, `stageStep`, `pipelineRow`, `masterOf`, `phaseSchedule`, `newPathway`, `simulatedProject`)
- Test: `src/lib/sim/scenario/engine-levers.spec.ts`

**Interfaces:**
- Consumes: `StageScale` (Task 6).
- Produces:

```ts
// SimInput, new optional fields
newProjects?: { calibration: Calibration; scale: StageScale }; // absent = input.calibration, scale 1
inFlightScale?: StageScale;                                     // absent = 1
// engine.ts
export function inFlightMonths(m: number, s: number): number; // s === 1 ? m : Math.round(m * s)
```

  - **Choosing the calibration.** `Job` gains `cal: Calibration` and `scale: StageScale | null`. A simulated project, and a pipeline row whose current stage is `preApplication`, use `newProjects` when present (ruling 3). Every other pipeline row, master and phase uses `input.calibration` with `inFlightScale`.
  - `newPathway` and `ppaShare` read the job's calibration. Initiation, size, revision and `phaseGap` keep reading `input.calibration`. Timer ops never change them.
  - **In-flight current stage with scale s ≠ 1.** Let `m = monthsIn(e, asOf)` and `m' = inFlightMonths(m, s)`. Draw `r = sampleTransition(t, u, m')`, then set `day = e + floor(r.days) − ceil(m'·MONTH_DAYS) + ceil(m·MONTH_DAYS)`. The redraw loop is unchanged. With s = 1 this is exactly today's expression.

- [ ] **Step 1: Failing tests** (mini input):
  - With neither field, `simulateDetailed` equals the existing golden (`simulate.golden.*` stays green, run in Step 4).
  - With `newProjects` from `timersOp` at 0.5 on discretionary `filed`, the schedules of `origin: 'pipeline'` rows not at `preApplication` deep-equal the base run's for seeds 1–20. The median filed → entitled days of simulated discretionary projects over seeds 1–50 is ≤ 0.6 × the base median.
  - A pipeline row at `preApplication` reads `newProjects`: its `entered.entitled` differs from the base run's for at least one seed.
  - `inFlightMonths(7, 1) === 7` and `inFlightMonths(7, 0.5) === 4`. With `inFlightScale` 0.5 on a stage holding in-flight rows, each such row's leave day is ≤ the base run's for seeds 1–20, and identical with scale 1.
  - With `pathwayForNew` all streamlined in `newProjects`, every simulated non-Local-Program project is streamlined.
- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/sim/scenario/engine-levers.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `npx vitest --run --project server src/lib/sim/scenario` (PASS, goldens included). Commit: `feat(sim): new-project calibration and in-flight remaining-time rescale in the engine`.

### Task 9: Engine, the law switch

**Files:**
- Modify: `src/lib/sim/scenario/types.ts`, `src/lib/sim/scenario/input.ts` (`precomputeOf`, `skipBounds`), `src/lib/sim/scenario/engine.ts` (`runOf`, `simulatedPass`, `initiationDay`, `simulatedProject`)
- Test: `src/lib/sim/scenario/engine-switch.spec.ts`

**Interfaces:**
- Produces:
  - `SimInput.lawSwitch?: { day: Day; parcels: ScenarioParcels }`. It requires `asOf < day`, otherwise `runEngine` throws `RangeError`. The parcels have the same rows, ids and existing columns as `input.parcels`.
  - `Precompute` gains `after: Precompute | null`: the after-view's precompute, memoised by input. Candidates become the union, in row order, of the before and after candidates. `entity` stays per row.
  - `export function switchMonth(r: Day, day: Day): number`: the number of initiation months from `r` that start before `day`. Month T starts on `r + 1 + floor((T − 1)·MONTH_DAYS)`.
  - **Piecewise inversion:** with `L = log(1 − u)`, `T0 = switchMonth(r, day)` and `l1`, `l2` the before and after `log1mh`:
    - if `l1 < 0` and `max(1, ceil(L / l1)) ≤ T0`, take that T;
    - else, if `l2 < 0`, take `T0 + max(1, ceil((L − T0·l1) / l2))`;
    - else return null.

    The first branch is today's expression, so pre-switch draws are unchanged.
  - **Regime by month:** a project whose month starts on or after `day` uses the after parcels for its size row, yields, envelope and `localProgram` (ruling 1). `skipAbove` uses `u* = 1 − exp(min(Tmax, T0)·l1 + max(0, Tmax − T0)·l2)` with today's widening.

- [ ] **Step 1: Failing tests** (mini input):
  - A `lawSwitch` whose parcels are a view equal to the base gives `simulateDetailed` deep-equal to no switch, for seeds 1–20.
  - A lot hostable only after the switch never initiates before `day`, and does initiate in some seed in 1–50. A lot hostable only before the switch never initiates in a month starting at or after `day`.
  - A project initiated before the switch takes its units from the before yields, and one after takes them from the after yields.
  - `simulateNet` equals `netOf(shownSeries(simulateDetailed(…)))` with a switch, for seeds 1–20 (the fast-path equivalence).
  - `day ≤ asOf` throws.
- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/sim/scenario/engine-switch.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `npx vitest --run --project server src/lib/sim/scenario` (PASS). Run `npx vitest --run --project server src/lib/sim/scenario/scenario.bench.spec.ts` and record the band-run time with and without a switch (the bar is 15 ms per band run; the bench is known to be flaky). Commit: `feat(sim): time-switched envelopes for the current-law change`.

### Task 10: `applyLevers`, the twins, lookups and the `policy.bin` load

**Files:**
- Create: `src/lib/sim/levers/apply.ts`
- Modify: `src/lib/sim/scenario/load.ts` (`ScenarioUrls.policy`, `loadScenario` option, `Loaded.policy`), `src/lib/sim/scenario/score.ts` (`assembleScore` takes `references`)
- Test: `src/lib/sim/levers/apply.spec.ts`, `src/lib/sim/scenario/scenario-host.load.spec.ts` (new cases)

**Interfaces:**
- Consumes: Tasks 3–9; `applyPolicies`, `baseZoning`; `chanceTable` and `typicalMonths`; `readPolicyParcels`.
- Produces:

```ts
export interface Lookups { chance: ReturnType<typeof chanceTable>; typicalMonths: ReturnType<typeof typicalMonths> }
export interface LeverLookups { inFlight: Lookups; fresh: Lookups } // fresh === inFlight when no 'new'-reach timer
export interface LeverInputs { plan: SimInput; twin: SimInput; lookups: LeverLookups; capacity: LeverCapacity; unknownLots: number; references: TimelineScore['references'] }
export function applyLevers(base: SimInput, ctx: LayerCtx, levers: SimLevers, filled: Resolution): LeverInputs;
export function twinInput(base: SimInput, ctx: LayerCtx, levers: SimLevers, horizon: Day): SimInput; // memoised on (base, compare, assumeAlternativePlanKept)
export function lookupsOf(plan: SimInput): LeverLookups;
// load.ts
export type ScenarioUrls = { parcels: string; projects: string; calibration: string; policy: string | null };
export interface Loaded { fzp: SimInput; twin: SimInput; projects: ProjectsFile; policy: PolicyParcels | null }
export function loadScenario(deps: LoadDeps, urls: ScenarioUrls, cancelled: () => boolean, opts?: { policy: boolean }): Promise<Loaded | LoadFailure>;
```

  - **The plan.** `applyPolicies([envelopeOp(before, lp), timersOp(scaleTable(t, 'inFlight'))], base)`. Then:
    - `newProjects` is the calibration from `applyPolicies([timersOp(scaleTable(t, 'new')), routeSharesOp(shares)], …)`, with that scale;
    - `inFlightScale` is set only when it is not the identity;
    - `lawSwitch` is set when `filled.after` is non-null.
  - **The twins.** The `'preFzp'` twin is `applyPolicies([baseZoning], base)`. The `'currentLaw'` twin is the plan built from `{ ...DEFAULT_LEVERS, assumeAlternativePlanKept }` on the base calibration. It has no needs.
  - `references` is `REFERENCES` for `'preFzp'`, and the `completedNet` subset for `'currentLaw'` (ruling 3).
  - `opts.policy` fetches `urls.policy` with `fetchBytes`, and `readPolicyParcels` binds it to the decoded parcels. A missing URL gives `LoadFailure` `scenario-missing`, and a decode error gives `scenario-invalid`. Without `opts.policy`, nothing changes.

- [ ] **Step 1: Failing tests:**
  - **The FZP-compatible levers change nothing.** With `FZP_COMPAT_LEVERS`, the plan's `simulateDetailed` and the twin's `simulateNet` deep-equal the base input's and the `baseZoning` twin's, for seeds 1–20.
  - **The default levers give a zero plan effect.** With `DEFAULT_LEVERS`, `planEffectOf(simulateNet(plan), simulateNet(twin))` is all zero at every month, for seeds 1–5 (common random numbers).
  - **Same levers, same result.** `applyLevers` called twice gives equal `simulateNet` output.
  - `twinInput` returns the same object across two lever documents that differ only in `user`.
  - With no timers, `lookups.fresh === lookups.inFlight`, and `chance` equals `chanceTable(base.calibration)`. With a `'new'` timer they are different objects.
  - **The load.** With `opts.policy`, `loadScenario` fetches the policy URL once and returns `Loaded.policy`. Without it, the policy URL is never requested. A manifest without `scenarios.fzp.policy` gives `scenario-missing`.
- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/sim/levers/apply.spec.ts src/lib/sim/scenario/scenario-host.load.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Rerun (PASS). Commit: `feat(sim): compile levers to plan and twin inputs; current-law twin; policy.bin load`.

### Task 11: Background recompute of touched lots

**Files:**
- Create: `src/lib/sim/levers/recompute.ts`
- Test: `src/lib/sim/levers/recompute.spec.ts`

**Interfaces:**
- Consumes: `Need` (Task 4); `envelopeRow` (Task 3); `scenarioYield`, `scenarioRecordOf`; `ParcelRecord`.
- Produces:

```ts
export type GrossCache = Map<string, number>; // `${row}:${stories}` → uncapped gross; one per session (dataset-scoped)
export interface YieldRecompute {
  readonly total: number;
  readonly done: number;
  cellsNeeded(): string[];           // cell ids of needs whose record is not yet available
  step(budgetMs: number): boolean;   // computes ready needs in need order until the budget is spent; true when done === total
  result(): ReadonlyMap<string, EnvelopeRow>; // keyed by needKey; complete only after step() returned true
}
export function createYieldRecompute(
  parcels: ScenarioParcels,
  needs: readonly Need[],
  deps: { record(id: ParcelId): ParcelRecord | undefined; now(): number },
  gross: GrossCache
): YieldRecompute;
```

  Each need computes `envelopeRow({ stories, cap, eligible: parcels.eligible[row] === 1, existingUnits, grossAt: s => scenarioYield(scenarioRecordOf(parcels, row, rec), s, null) })`, with `grossAt` memoised in `gross`.

- [ ] **Step 1: Failing tests** (mini city records):
  - For every mini row, recomputing at the FZP stories and `fzpYieldCap` reproduces `parcels.bin`'s `yield` and `hostable` exactly. This is the client side of `policy.current.yield_mismatch = 0`.
  - The result map is equal whichever order records become available in (three orders).
  - `cellsNeeded` lists only the cells of needs with no record yet.
  - A zero budget still computes at least one ready need per `step`.
  - A second recompute that shares the `GrossCache` makes no new `scenarioYield` calls for the same `(row, stories)` (spy on an injected `grossAt` counter).
- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/sim/levers/recompute.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Rerun (PASS). Commit: `feat(sim): budgeted yield recompute for lots the user layer touches`.

### Task 12: Worker and client plumbing

**Files:**
- Modify: `src/lib/sim/scenario/types.ts` (protocol), `src/lib/sim/scenario/load.ts` (`validateInitRequest`), `src/lib/sim/scenario/scenario-host.ts`, `src/lib/sim/scenario/test/host-harness.ts` (serve `miniPolicy` as `policy.bin`), `src/lib/sim/scenario-client.ts`
- Test: `src/lib/sim/scenario/scenario-host.levers.spec.ts`, `src/lib/sim/scenario-client.spec.ts` (new cases)

**Interfaces:**
- Consumes: Tasks 2, 4, 10 and 11.
- Produces:

```ts
// ScenarioRequest
| { type: 'initScenario'; …; levers?: SimLevers }         // absent = today's /fzp behaviour
| { type: 'setLevers'; rev: Rev; levers: SimLevers }       // a barrier rev, like reroll
// ScenarioResponse
| { type: 'levers'; rev: Rev; phase: 'resolving'; done: number; total: number; failedCells: string[] }
| { type: 'levers'; rev: Rev; phase: 'current'; lookups: LeverLookups; capacity: LeverCapacity; unknownLots: number }
// ScenarioClient
initScenario(manifest: Manifest, horizon: Day, seed?: number | null, levers?: SimLevers): Rev;
setLevers(levers: SimLevers): Rev;
get leversPending(): boolean; // true from initScenario-with-levers or setLevers until its 'current'
ScenarioClientEvents.onLevers?(l: Extract<ScenarioResponse, { type: 'levers' }>): void;
```

  Host behaviour:
  - **Validation.** `parseSimLevers` failures are `bad-request`.
  - **Init with levers.** Load with `{ policy: true }`, then `resolveEnvelopes` with `switchDay = CURRENT_LAW_SWITCH.day`.
  - **Resolving.** When `allNeeds` is non-empty, post `resolving`. Call `chunks.loader.want(recompute.cellsNeeded())` and run the recompute as a scheduler job of kind `'recompute'`, which comes before every other job.
  - **Current.** When the recompute completes, run `fillNeeds` and `applyLevers`, and post `current`. The session's work then gets a fresh `createBandState`, `fzpNew` cleared, `loaded.fzp`/`loaded.twin` replaced by `plan`/`twin`, `references` from `LeverInputs`, and `newRun(rev, requestedSeed)`.
  - **No mixed timelines.** No timeline is posted for a lever revision before its `current`.
  - **setLevers.** It requires a session initialised with levers; otherwise `bad-request` `'setLevers needs a session initialised with levers'`. It stops the current run's jobs, drops any recompute in flight (latest wins), and keeps the session's `GrossCache` and chunks.
  - **Reroll while resolving.** The pending run takes the reroll's rev and seed.
  - **Failed chunks.** A needed cell that ends `failed` re-posts `resolving` with `failedCells`. `retryChunks` re-wants them.

- [ ] **Step 1: Failing tests** (`host-harness`):
  - **No levers.** The post sequence (types and revs) and every timeline's `score` equal the pre-change baseline, and the policy URL is never fetched.
  - **FZP-compatible levers.** Timelines equal the no-lever run's, and one `levers` `current` is posted before the first timeline.
  - **`latest setLevers wins`.** Two `setLevers` back-to-back, each with a user raise. Only the second rev gets `current` and timelines, and the first rev's `current` is never posted.
  - **No timeline while resolving.** Between `setLevers` and its `current`, no `timeline` is posted, and `resolving.total` equals `allNeeds` length.
  - **`chunk failure holds the lever revision`.** Fail one needed cell: `resolving.failedCells` names it and no timeline is posted. After `retryChunks` and a successful fetch, `current` and timelines follow.
  - **Same levers, same score.** Two fresh hosts given the same `(levers, seed)` produce equal `score`.
  - **Client.** `leversPending` is true after `setLevers` and false after its `current`. A timeline with a rev below the `setLevers` rev is stale.
- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/sim/scenario/scenario-host.levers.spec.ts src/lib/sim/scenario-client.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `worker.ts` needs no change.
- [ ] **Step 4:** Run `npx vitest --run --project server src/lib/sim` (PASS). Commit: `feat(sim): levers on initScenario, setLevers, lever status and posted lookups`.

### Task 13: Docs and full verification

**Files:**
- Modify: `docs/dev/sim-levers.md` (complete), `docs/dev/fzp-mode.md` ("The T9 lookups seam"), `CLAUDE.md` (Scoped reference docs list)

- [ ] **Step 1: `docs/dev/sim-levers.md`.** Cover:
  - the `SimLevers` fields and defaults;
  - the resolution order;
  - the stock blend and its tie rule;
  - the law switch, with its date, its provenance and the vesting rule;
  - protections and the signed capacity metric;
  - timer reach (who counts as new);
  - the rescale construction and the bounds;
  - the in-flight remaining-time rule;
  - route shares and Local Program forcing;
  - the twins and the references rule;
  - the protocol (`levers` messages, latest-wins, failed cells);
  - the disapproval decision (Task 7);
  - the builder's calls (Rulings 1–3), each with its reason.
- [ ] **Step 2: `docs/dev/fzp-mode.md`.** In the T9 seam paragraph, say the seam now exists: the worker posts `lookups` in `levers`/`current`, with `inFlight` for pipeline cards and `fresh` for simulated ones. `/fzp` sends no levers and keeps its main-thread lookups. Plan 3 switches `pushLookups` on `/sim`. In `CLAUDE.md`, add "**Policy levers engine (`SimLevers`, resolution order, law switch, timer reach, `setLevers` protocol)** — [docs/dev/sim-levers.md](docs/dev/sim-levers.md)".
- [ ] **Step 3: Verify.** Run, in turn:
  - `npm run check`
  - `npm run lint`
  - `npm run test:unit`
  - `npm run test:pipeline`
  - `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/fzp.spec.ts e2e/fzp-sim.spec.ts`

  Expected: all PASS, with the two e2e specs unmodified.
- [ ] **Step 4: Commit.** `git add docs CLAUDE.md`, then `git commit -m "docs: the /sim policy engine" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`. Do not push. Signoff is the controller's call.

---

## Self-review

- **Spec coverage.**
  - Stock-layer toggles and the most-permissive rule: Tasks 3 and 5.
  - User layer (raise, lower, set, density on or off, over resolved lot sets): Task 4.
  - Protections by category and by list, the resolution order, and the visible protection cost: Task 4, surfaced in Task 12's `current`.
  - Yields from `scenarioYield`, with only touched lots recomputed in the background and "out of date until complete" (`leversPending`, `resolving`): Tasks 11 and 12.
  - Duration rescale with exit shares kept and accepted by `parseCalibration`: Task 6.
  - Route shares and Local Program forcing: Tasks 5, 6 and 8.
  - Per-project reach (in-flight versus new) and the remaining-time rescale: Task 8.
  - Disapproval exception, measured first: Task 7.
  - Current-law twin as default, pre-FZP selectable: Task 10.
  - Law switch (ruling 7) and `assumeAlternativePlanKept`: Tasks 3, 4 and 9.
  - The worker lookups seam and the lever parameter on `initScenario`: Task 12.
  - Determinism: Tasks 9, 10 and 12.
  - `/fzp` unchanged: Tasks 10, 12 and 13.
  - §207.11 semantics carried from plan 1: Task 1.
  - Out of scope here: the page and `startScenario` (plan 3), presets and stage floors (plan 4), lever size limits and publishing (plan 5).
- **Step scan.** Every code step names its signatures and file. Task 6 gives the rescale construction, and Task 9 gives the piecewise inversion: neither is fixed by its signature. Task 7's outcome is conditional, with a stop rule.
- **Type consistency.**
  - `EnvelopeTable`, `LayerCtx` and `Period` are defined in Task 3.
  - `Need`, `needKey`, `Resolution`, `LeverCapacity` and `fillNeeds` are defined in Task 4 and used in Tasks 10–12.
  - `StageScale` is defined in Task 6 and used in Tasks 8 and 10.
  - `LeverLookups` is defined in Task 10 and used in Task 12.
  - `CURRENT_LAW_SWITCH` is defined in Task 2 and used in Task 12.
  - `fzpHeightFt` is used in Task 1 only.
- **Review Focus.** Each of the five items has its named test in its owning task (Tasks 4, 6, 9 and 12).
- **Proportion.** Code blocks are signatures, test assertions and the two algorithms the signatures leave open.

## Spec contradictions found in the code

1. **References.** Spec goal 4 keeps "the existing references" while it moves the twin to current law. But `REFERENCES` in `score.ts` are FZP-versus-pre-FZP estimates on `planEffect.*`, so they are shown only under `compare = 'preFzp'` (ruling 3).
2. **Protection.** The partner ruling says a protected lot keeps "FZP + §207.11, fixed", but round-2 ruling 7 makes current law change in 2032. This plan has protected lots follow the switch (Open question 1).
3. **§207.11.** Plan 1's `docs/dev/pipeline.md` says "an uncapped lot never meets it", while `s207Envelope` gave an uncapped, under-40 ft lot the §207.11 cap (`fzpCap ?? 0`). Task 1 makes the code match the docs and the ordinance.
4. **The lookups seam.** `docs/dev/fzp-mode.md` says the worker "will transform the calibration per future". The transform is per lever document, not per seed, and it produces two calibrations (in-flight and new), so two lookup sets.

## Open questions for the partner

1. **Do protected lots follow the 2032 switch to SB 79?** **Partner ruling (2026-10-29): yes, protected lots keep current law, including the switch.** Recommendation was: yes. Protection means "not upzoned by your policy", and the switch is current law, not the user's policy. The alternative freezes them on FZP + §207.11 even after the state law takes effect.
2. **When does a pipeline project at pre-application count as new?** Recommendation: it counts as new for SB 423-style timers, since it has not filed. Otherwise the policy start is the simulation's `asOf`, until a preset needs a later start date.
3. **Disapproval exception.** The preliminary measurement is 0.82% of new discretionary projects. Recommendation: drop it, as the spec allows, unless Task 7's measurement on the promoted dataset reaches 1%.
