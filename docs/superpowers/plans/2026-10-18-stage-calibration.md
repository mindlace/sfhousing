# stage-calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement T12 (`src/lib/timelapse/model.ts`) and the pipeline step that fits `scenarios/fzp/calibration.json` (competing-risks stage tables, initiation logit, size, revision, pathway mix, phase gaps) from the project histories, permits and the T13 panel, with V25–V29 and the five `sc.*` T14 rules.

**Architecture:** `model.ts` is the one sampler/validator every consumer uses (pure, worker-safe, `math.ts` only). The pipeline side is a pure core `calibrate(input, cal)` in `pipeline/lib/fzp-cal/` (each estimator in its own file, fed by plain arrays and a per-roll-year panel callback) wrapped by a thin build step `pipeline/steps/calibration.ts` that adapts DuckDB/files, runs the core twice (V29), writes the outputs and records `quality.sc.*` through `recordQuality`. V25–V27 are file-based checks in `check.ts`; V28–V29 are measured in the step and passed through like project-records' V21–V24.

**Tech Stack:** TypeScript, Vitest (server, client/Playwright, pipeline projects), DuckDB (`pipeline/lib/duck.ts`), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-16-stage-calibration-design.md` (reappraisal 1). Design: `docs/superpowers/design/2026-10-16-1903-fzp-timelapse.md` §"Reappraisal 1". Every task's implementer reads the spec sections its task names; the spec's formulas are normative and not repeated here.

## Global Constraints

- Evidence hierarchy: no number reaches the simulation without a tier and a source; a tier-3 or tier-4 number is never presented as data. Every `Provenance` has tier 0..4, a non-empty label and method, ≥ 1 source with an `https:` URL; tiers 0–2 also have `n` and `window`.
- Data quality: every pipeline rule that nulls, replaces, defaults or drops a source value is a registered T14 rule. No code in `pipeline/steps/calibration.ts` or `pipeline/lib/fzp-cal/` rewrites a history value outside a registered `sc.*` rule. `recordQuality` is the only writer of `quality.*` keys. Model choices (defensive pathway rule, preApplication pooling, size r > 1 → 1) are `calibration.method.*` counts, never T14 rules.
- Determinism: the same `datasetVersion` always gives byte-identical `calibration.json` and `calibration-report.md`; inputs sorted (spells by pathway, stage, project id; panel rows by key), every sum in fixed order; the only randomness is V27's `mulberry32(0x5eed)`; the step runs twice in-run and outputs must be byte-identical. No wall-clock times in outputs.
- Determinism math: under `src/lib/timelapse/**` and `pipeline/lib/fzp-cal/**` never `Math.exp`/`Math.log`/`Math.pow`/`Math.log1p`/`Math.expm1` nor `**`/`**=`; use `exp`/`log` from `src/lib/timelapse/math.ts`. (1 − ρ)^n is `exp(n · log(1 − ρ))`. Do not edit the ESLint determinism glob line.
- `model.ts` is pure, zod-free, worker-safe and imports nothing outside `src/lib/timelapse` (AC-7). `parseCalibration` checks `fillLevels` internally only (A2); equality with `FILL_LEVELS` is V25's job.
- `OPEN_DAY` is `Math.fround(3.0e38)`; compare with the exported constant, never a literal (A1).
- No statistics dependency is added. No network access in the step. No new CLI command.
- Paths follow A6: the step takes `derivedDir` (= `<derivedRoot>/<datasetVersion>`) and never hard-codes `pipeline/.cache/derived`; the panel is the in-build DuckDB table `scenario_panel` (outside a build, the same columns from `<derivedDir>/parcel-panel.parquet`); `parcel_lineage` is not read.
- `permits.parquet` columns are used as project-records ships them (N1): `permit_number VARCHAR, project_id VARCHAR, prj_record_id VARCHAR, dva_record_id VARCHAR, prx_case_no VARCHAR, da VARCHAR, parcel_ids VARCHAR[], proposed_units INTEGER, site_permit BOOLEAN, status VARCHAR, live BOOLEAN, superseded BOOLEAN, filed_day INTEGER, issued_day INTEGER, construction_day INTEGER, complete_day INTEGER, status_day INTEGER`.
- T14 `counts`: the build has ONE shared `counts` object; the step records into it (never a step-local object merged in). The determinism rerun records into a fresh `{}` (T14 rows are keyed per counts object). `writeQualityReport` moves to after the calibration step.
- `calibration.json`: keys in T4 order `schema, asOf, transitions, initiation, pathwayForNew, ppaShare, size, revision, streamlinedForLocalProgram, phaseGap`, `PATHWAYS` and `STAGE_ORDER` order inside, `JSON.stringify` with no whitespace, ≤ 256 KB (expected 40–120 KB).
- Table values floored to 1e-6; tail values and initiation coefficients rounded to 6 significant digits; size `probs` rounded to 6 decimals with the residual on the largest.
- Code style: 2-space indent, single quotes, no trailing commas, 100 columns. Conventional Commits. Vitest runs with `expect.requireAssertions`: every test calls `expect`.
- Safety: never `cd x && y` (use absolute paths, `git -C`, `npm --prefix`); never bare `git stash`; never touch other `fzp-*` worktrees except to read; no R2 uploads, no remote Cloudflare changes; no `npm run signoff`, no push. Playwright/e2e with `SFH_E2E_PORT=4204`.
- Worktree: `/Users/mindlace/Projects/sfhousing/.claude/worktrees/fzp-timelapse/.claude/worktrees/fzp-stage-calibration`, branch `fzp/stage-calibration`. All commands run with absolute paths.

## Method constants (spec §4.11; tier 4 unless noted)

| constant | LIVE_CAL | FIXTURE_CAL |
|---|---|---|
| `N_SPELLS_MIN` / `N_EVENTS_MIN` | 30 / 20 | 3 / 2 |
| `N_RISK_MIN` | 20 | 2 |
| `K_MAX` | 240 | 240 |
| `TAIL_SPAN` / `TAIL_MIN_EVENTS` | 24 / 5 | 24 / 1 |
| `MIN_BIN_EVENTS` | 10 | 1 |
| `RIDGE_LAMBDA` | 1.0 | 1.0 |
| `INIT_MIN_EVENTS` | 100 | null (fixture model) |
| `SIZE_MIN_N` / `REV_MIN_N` | 30 / 30 | 2 / 2 |
| `V27_N` / `V27_TOL` | 100000 / 0.005 | same |
| `COVERAGE_GUARD` | true | false |
| `PURGE_MIN_EXITS` / `PURGE_RATIO` / `PURGE_MIN_DAYS` / `PURGE_GAP_DAYS` | 10 / 10 / 730 / 30 | same |
| `PH_PRIOR` | 5 | 5 |
| `PHASE_MIN_UNITS` / `PHASE_MIN_GAPS` | 10 / 10 | 10 / 1 |
| `fixtureInitiation` | false | true |
| `backcastGate` (V28) | true | false |

## Review Focus

1. **Histories carrying stages off their pathway** (a `permitOnly` history with an `entered.filed` key, a null-pathway history): stages not in `pathwayStages(pathway)` are ignored for spells; a null pathway uses `STAGE_ORDER`. Test in Task 7.
2. **Zero-duration and same-day spells** (site permit filed the day of approval, x = 0): an event at d = 0 lands in month 1 (`advance[0]`), and an event-and-censor tie counts the event first. Test in Task 9.
3. **A cell with spells but no events, or all censored** (thin live pathway, fixture): rejection routes to the next rung, never throws; rung 3 gives a valid `months = 1` table. Test in Task 11.
4. **History parcels missing from the panel or not `hostable_base` in the event year**: the event is not counted, the count `calibration.panel.eventsOffPanel` records it, and nothing throws. Test in Task 12.
5. **Empty or thin `permits.parquet`** (fixture has few rows; a DA group with one phase): `phaseGap` falls through to rung 3 `[730]`, initiation basis "permit" histories without a `filed_day` get no event and no coverage. Tests in Tasks 12 and 14.

---

## File structure

**`src/lib/timelapse/`**
- `model.ts` — T12: `binIndex`, `cumulativeIncidence`, `eventualProbabilities`, `sampleTransition`, `chanceTable`, `typicalMonths`, `initiationHazard`, `parseCalibration`, `CalibrationFormatError`.
- `fixtures/calibration-small.json` — hand-made tier-4 unit fixture (spec §4.12).
- `fixtures/model-golden.json` — bit patterns of fixed model outputs (AC-11 cross-engine).
- `model.test.ts`, `reproduce.test.ts`, `model.golden.test.ts`, `model.golden.svelte.spec.ts`.
- `math.ts` (licence opener only), `types.test.ts` (T12 Equals extended).

**`src/lib/attribution.ts`** (+ `attribution.spec.ts`) — fdlibm credit.

**`pipeline/lib/fzp-cal/`** (all under the determinism lint)
- `types.ts` — internal types (`Spell`, `CoverageRow`, `CalProfile`, `PanelRow`, `FitCell`, `NormHistory`, `RuleTally`, `PermitRow`, `CalInput`, `CalOutput`, `CalibrationError`).
- `config.ts` — `LIVE_CAL`, `FIXTURE_CAL`.
- `window.ts` — coverage table, window constants, `windowStart`, coverage guard.
- `spells.ts` — qualifying predicate, normalisation steps 1–5, spell building with window cut.
- `purge.ts` — step 6.
- `aalen-johansen.ts` — AJ sweep and table extraction; `tail.ts` — tail span and hazards.
- `ph-pool.ts` — θ scaling; `fallback.ts` — the ladder and rung 3; `transitions.ts` — every cell.
- `panel.ts` — initiation risk timeline and panel aggregation; `irls.ts` — ridge IRLS; `initiation.ts` — bins, fit, back-cast, FZP application.
- `pathway-mix.ts` — `pathwayForNew`, `ppaShare`, `streamlinedForLocalProgram`; `phase-gap.ts`; `size.ts`; `revision.ts`.
- `provenance.ts` — source URLs and label/method builders; `report.ts` — `calibration-report.md`; `invariants.ts` — V25–V29 functions; `calibrate.ts` — the pure core.

**`pipeline/lib/quality-rules/sc.ts`** — `SC_RULES`.

**`pipeline/steps/calibration.ts`** — `writeCalibration`. Modified: `pipeline/steps/build.ts`, `pipeline/steps/check.ts`, `pipeline/cli.ts`, `pipeline/steps/fixture.ts`, `pipeline/test/golden.test.ts`, `docs/dev/pipeline.md`.

**`pipeline/test/fzp-cal/*.test.ts`** — one file per estimator (the pipeline vitest project includes `pipeline/test/**/*.test.ts`).

---

### Task 1: fdlibm licence opener and attribution (A5)

**Files:**
- Modify: `src/lib/timelapse/math.ts:1`
- Modify: `src/lib/attribution.ts` (`SOFTWARE`)
- Test: `src/lib/attribution.spec.ts`

- [ ] **Step 1: Write the failing tests** in `attribution.spec.ts`:
  - `it('credits fdlibm')`: `expect(SOFTWARE).toContainEqual({ name: 'fdlibm (exp, log)', license: 'Sun Microsystems permissive notice', url: 'https://www.netlib.org/fdlibm/' })`.
  - `it('keeps the fdlibm notice through minification')`: read `src/lib/timelapse/math.ts` with `readFileSync`; `expect(src.startsWith('/*!')).toBe(true)` and `expect(src).toContain('Copyright (C) 1993 by Sun Microsystems')`.
  - If the existing package.json dependency check in that spec iterates `SOFTWARE`, exempt entries with no npm package (fdlibm is vendored source) in the check, not by removing the entry.
- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/attribution.spec.ts` (absolute repo path via `npm --prefix`). Expected: FAIL.
- [ ] **Step 3:** Change the opener of `math.ts` from `/**` to `/*!` (nothing else in the comment), append the `SOFTWARE` entry.
- [ ] **Step 4:** Run the test; run `npm --prefix <wt> run build` and `grep -l 'Sun Microsystems' <wt>/.svelte-kit/output/client/_app/immutable/**/*.js` only if `math.ts` is already imported by client code — otherwise note in the report that bundle presence is verified when a client import lands. Expected: PASS.
- [ ] **Step 5:** Commit `feat(timelapse): preserve the fdlibm notice and credit it on /attribution`.

### Task 2: model.ts — binIndex, cumulativeIncidence, eventualProbabilities, initiationHazard + fixture

**Files:**
- Create: `src/lib/timelapse/fixtures/calibration-small.json`
- Modify: `src/lib/timelapse/model.ts`, `src/lib/timelapse/types.test.ts`
- Test: `src/lib/timelapse/model.test.ts`

**Interfaces:**
- Produces (exact):
  - `export function binIndex(edges: number[], x: number): number` — (number of edges ≤ x) − 1, clamped to [0, len − 1].
  - `export function cumulativeIncidence(t: Transition, k: number): { advance: number; exit: Partial<Record<ExitReason, number>> }` — spec §4.2; `RangeError` on negative or non-integer k; keys: `advance`, then one `exit` key per reason present in `exit` or `tail.exit`, in `EXIT_ORDER`.
  - `export function eventualProbabilities(t: Transition, monthsElapsed: number): { advance: number; exit: Partial<Record<ExitReason, number>> }` — spec §4.2; same key rule.
  - `export function initiationHazard(m: InitiationModel, f: Record<FeatureId, number>): number` — terms summed in array order, `exp` from `./math`.
  - Internal helper (not exported, or exported for tests as `cumulativeTotal(t, k): number`): C(k).
- `calibration-small.json` content (spec §4.12): a full valid `Calibration` (schema 1, asOf 20736, all 16 occupiable pathway × stage cells, every provenance tier 4 label "test fixture", source `{ label: 'stage-calibration spec §4.12', url: 'https://github.com/mindlace/sfhousing' }`, method "hand-made test fixture"). discretionary `permitFiled`: `months` 12, `advance[k−1] = 0.05·k` (to 0.60), `exit.expired[k−1] = round6(0.10·k/12)` with the last exactly 0.10, `tail { advance: 0.05, exit: { expired: 0.01 } }`. Every other cell: `months` 1, `advance [0.1]`, `exit { withdrawn: [0.02] }`, `tail { advance: 0.1, exit: { withdrawn: 0.02 } }`. initiation: intercept −6, one term `potentialRatio` bins `[0, 2, 5]` coef `[0, 0.5, 1]`. size: `fillLevels [0.25, 0.5, 0.75, 0.9, 1]`, `byEnvelope [{ maxStoriesUpTo: 999, probs: [0.1, 0.2, 0.3, 0.2, 0.2] }]`. revision: `at [{ stage: 'permitFiled', probability: 0.2, ratio: { edges: [0.5, 1, 2], probs: [0.5, 0.5] } }]`. pathwayForNew 0.6/0.3/0.1; ppaShare all 0; phaseGap `{ days: [365, 730] }`.

- [ ] **Step 1: Write failing tests** in `model.test.ts` (load the fixture with `import small from './fixtures/calibration-small.json'`, cast to `Calibration`; let `t = small.transitions.discretionary.permitFiled`):
  - `binIndex([0,2,5], -1) === 0`, `(…, 0) === 0`, `(…, 1.99) === 0`, `(…, 2) === 1`, `(…, 5) === 2`, `(…, 99) === 2`.
  - `initiationHazard` with `potentialRatio` 3 equals `1 / (1 + exp(-(-6 + 0.5)))` using `math.ts` `exp` (`toBe`, exact).
  - `cumulativeIncidence(t, 0)` is `{ advance: 0, exit: { expired: 0 } }`; for k = 1..12 equals the table values exactly; k = 13 and k = 24 equal the closed form F_j(K) + (1 − C(K))·(p_j/ρ)·(1 − exp((k−K)·log(1 − ρ))) with C(K) = 0.7, ρ = 0.06, computed in the test with `math.ts` (golden numbers printed into the test as literals after first run, plus the formula assertion with `toBeCloseTo(…, 15)`); `advance + Σexit` equals C(k) for k in 0..60; each F_j is non-decreasing and < F_j(∞) from `eventualProbabilities(t, 0)`, within 1e-6 of it at k = 600; a transition whose `exit` lacks `cancelled` but whose `tail.exit.cancelled = 0.01` returns `exit.cancelled === 0` for k ≤ K and > 0 after; `Object.keys(r.exit)` follows `EXIT_ORDER`; `cumulativeIncidence(t, -1)` and `(t, 1.5)` throw `RangeError`.
  - `eventualProbabilities(t, m)` sums (advance + Σ exit) to 1 within 1e-12 for m in {0, 6, 12, 30}; for m ≥ 12 it equals `{ advance: 0.05/0.06, exit: { expired: 0.01/0.06 } }` within 1e-15.
  - `types.test.ts`: add `type RowCumulativeIncidence = (t: RowTransition, k: number) => { advance: number; exit: Partial<Record<RowExitReason, number>> }` and extend the Equals chain with `Equals<typeof cumulativeIncidence, RowCumulativeIncidence>`; change the "model stubs" test so it only lists functions still stubbed (remove each one as its task lands; delete the test when none remain).
- [ ] **Step 2:** Run `vitest --run --project server src/lib/timelapse/`. Expected: FAIL.
- [ ] **Step 3:** Implement in `model.ts` (spec §4.2 formulas). Imports only `./types`, `./time`, `./math`.
- [ ] **Step 4:** Run tests. Expected: PASS. Run `npx eslint src/lib/timelapse` clean.
- [ ] **Step 5:** Commit `feat(timelapse): cumulative incidence, eventual probabilities and the initiation hazard (T12)`.

### Task 3: model.ts — sampleTransition + reproduction (AC-1)

**Files:** Modify `src/lib/timelapse/model.ts`; Test `src/lib/timelapse/model.test.ts`, `src/lib/timelapse/reproduce.test.ts`

**Interfaces:**
- Consumes: Task 2's C(k) and per-outcome F_j.
- Produces: `sampleTransition(t, u, monthsElapsed): { kind: 'advance' | ExitReason; days: number }` exactly per spec §4.2 steps 1–4. Table months: binary search for the least k > m with C(k) > c. Beyond K: closed form with `log`, then adjust ±1 until C(k−1) ≤ c < C(k) holds with C evaluated via `exp`/`log`.
- Also produce a test-shared helper `src/lib/timelapse/test-rng.ts`? No: import `mulberry32` from `src/lib/generator/seed.ts` in tests only (tests may import outside `src/lib/timelapse`; `model.ts` may not).

- [ ] **Step 1: Write failing tests.** `model.test.ts`: u = 0 at m = 0 gives `kind 'advance'`, `days` in [0, ⌈M⌉ − 1]; u → 1 − 1e-12 gives a tail month (> 12) with `kind` an exit or advance consistent with p_j/ρ split; m = 30 (≥ months) gives `days ≥ ⌈30·M⌉`; for 10,000 random (u, m ∈ 0..40) pairs: `monthsIn(0, days) === k − 1` where k is recomputed from `cumulativeIncidence`, and `days ≥ Math.ceil(m * MONTH_DAYS)`. `reproduce.test.ts` (AC-1): 200,000 draws with `mulberry32(0x5eed)` from m = 0: empirical expired by month 12 (`monthsIn(0, days) + 1 ≤ 12`) = 0.10 ± 0.005; every month 1..36, advance and expired, within 0.005 of `cumulativeIncidence(t, k)`; conditional draws from m = 6 (200,000) give eventual shares within 0.005 of `eventualProbabilities(t, 6)`; tail geometry: among draws with month > 12, P(month = 13 + j) / P(month = 13) within 0.01 of (1 − ρ)^j for j = 1..5.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expected PASS (reproduce test under 10 s).
- [ ] **Step 5:** Commit `feat(timelapse): sampleTransition with one uniform per stage (T12, AC-1)`.

### Task 4: model.ts — chanceTable and typicalMonths

**Files:** Modify `src/lib/timelapse/model.ts`; Test `src/lib/timelapse/model.test.ts`

**Interfaces:** Produces `chanceTable(cal)` and `typicalMonths(cal)` per spec §4.2 (`Float32Array(241)`, `next` along `pathwayStages(p)`, fresh objects on every call). `typicalMonths` beyond K by closed form: least k > K with 1 − (1 − C(K))(1 − ρ)^{k−K} ≥ 0.5, adjusted ±1 like `sampleTransition`.

- [ ] **Step 1: Failing tests** on `calibration-small.json`: `chanceTable(small).permitOnly.preApplication[0]` equals `Math.fround` of the product of `eventualProbabilities(T, 0).advance` along preApplication → permitFiled → permitIssued → construction (hand product in the test); a discretionary chain likewise through filed and entitled; every array has length 241; `[240]` equals `Math.fround(eventual(T, 240).advance × chance(next, 0))` and equals the tail value `p_advance/ρ × …`; `permitOnly` has no `filed`/`entitled` keys; two calls return different object identities. `typicalMonths(small).discretionary.permitFiled === 9` (C(k) = k·(0.05 + 0.10/12): C(8) ≈ 0.467, C(9) = 0.525); a cell with `months 1`, C(1) = 0.12, ρ = 0.12 gives the closed-form tail answer (expect the least k with 1 − 0.88^k ≥ 0.5, i.e. 6).
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5:** Commit `feat(timelapse): chanceTable and typicalMonths (T12)`.

### Task 5: model.ts — parseCalibration

**Files:** Modify `src/lib/timelapse/model.ts`; Test `src/lib/timelapse/model.test.ts`

**Interfaces:** Produces `export class CalibrationFormatError extends Error { constructor(readonly path: string, message: string) }` (message starts with the path, e.g. `transitions.discretionary.permitFiled.advance[3]: …`) and `parseCalibration(json: unknown): Calibration` enforcing every bullet of spec §4.2 "parseCalibration". Returns the input value typed (no copying needed, but it must not mutate).

- [ ] **Step 1: Failing tests:** accepts `calibration-small.json`; rejects, each with `toThrow(CalibrationFormatError)` and the path substring in the message: `advance[k] + Σexit[k] > 1 + 1e-9` (`…permitFiled`), a decreasing `advance`, an array of length ≠ `months`, `months` 0 and 241, tail all zeros (ρ = 0), C(K) > 1 − 1e-6, a missing `permitOnly.construction`, an extra `permitOnly.filed`, `fillLevels` `[0.5, 0.9]` (not ending at 1) and `[0.5, 0.25, 1]`, a `probs` of length 4, `probs` summing to 0.99, revision `edges [0.5, 2]` (no 1), a revision `at.stage` `'construction'`, `pathwayForNew` summing to 0.9, `ppaShare` 1.2, a provenance with an `http:` URL, a tier-2 provenance with no `window`, a missing `tailProvenance`, a missing `streamlinedForLocalProgram`, `phaseGap.days` `[]`, `[3, 2]`, `[0]`, `[1.5]`, `schema 2`, `asOf 1.5`. **A2:** a copy with `fillLevels [0.5, 1]` and every `probs` of length 2 summing to 1 is accepted. **AC-7 scan:** read `model.ts` source; every `from '…'` specifier matches `^\./(types|time|math)$`, and the source contains no `zod`.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS). Remove the last entry from the "model stubs" test (delete it).
- [ ] **Step 5:** Commit `feat(timelapse): parseCalibration validator (T12, A2)`.

### Task 6: sc.* T14 rules and the fzp-cal skeleton (types, config, window)

**Files:**
- Modify: `pipeline/lib/quality-rules/sc.ts`
- Create: `pipeline/lib/fzp-cal/types.ts`, `config.ts`, `window.ts`, `provenance.ts`
- Test: `pipeline/test/fzp-cal/sc-rules.test.ts`, `pipeline/test/fzp-cal/window.test.ts` (window-constant part only; spell cuts are in Task 7)

**Interfaces (Produces, exact):**
- `SC_RULES`: the five rows of spec §4.4a table, `owner 'stage-calibration'`, `source 'project-histories'`, `maskBit null`, `unitsWeighted false`, `warnShare 0.01`, `failShare 0.1`, labels verbatim from §4.4a "Labels", `denominator` verbatim from the table's last column, `field` `'entered'`, `'entered'`, `'end'`, `'end'`, `'unitsAt'` respectively.
- `export type ScRuleId = 'sc.stages.gap-impute' | 'sc.stages.running-max' | 'sc.exit.last-stage' | 'sc.exit.purge-censor' | 'sc.revision.ratio-clamp'` and `export const SC_RULE_IDS: readonly ScRuleId[]` (in `fzp-cal/types.ts`).
- `fzp-cal/types.ts`:
  - `type CalStage = Exclude<Stage, 'complete'>`.
  - `interface RuleTally { fired: number; of: number; sample: string[] }`; `type Tallies = Record<ScRuleId, RuleTally>`.
  - `interface Spell { pathway: Pathway | null; stage: CalStage; a: number; x: number; outcome: 'advance' | ExitReason | 'censored'; projectId: string }` (spec §2), plus `e: Day` (entry day, needed for window cuts and the 2015 pathway level).
  - `interface NormHistory { id: string; pathway: Pathway | null /* after the defensive rule */; parcelIds: ParcelId[]; eff: Partial<Record<Stage, Day>>; end: ProjectHistory['end'] /* after steps 3 and 6 */; purgeCensored: boolean; src: ProjectHistory }`.
  - `interface CoverageRow { stage: CalStage; side: 'planning' | 'permit'; pooledStart: string; pathwayStart: string; entryEnd?: string; evidence: string }`.
  - `interface CalProfile` with exactly the fields of the "Method constants" table above (camelCase: `nSpellsMin, nEventsMin, nRiskMin, kMax, tailSpan, tailMinEvents, minBinEvents, ridgeLambda, initMinEvents: number | null, sizeMinN, revMinN, v27N, v27Tol, coverageGuard, purgeMinExits, purgeRatio, purgeMinDays, purgeGapDays, phPrior, phaseMinUnits, phaseMinGaps, fixtureInitiation, backcastGate`, plus `name: 'live' | 'fixture'`).
  - `interface PermitRow` = the N1 columns in camelCase-free form: same snake_case names as the parquet, `parcel_ids: string[]`, integers as `number | null`, booleans as `boolean | null`.
  - `class CalibrationError extends Error` (aborts the build; spec §4.13).
  - `PanelRow`, `FitCell` (defined in Task 12), `CalInput`/`CalOutput` (Task 16) — declared where their task says.
- `config.ts`: `export const LIVE_CAL: CalProfile`, `export const FIXTURE_CAL: CalProfile` (values from the table).
- `window.ts`: `export const PLANNING_START = '2015-01-01'`, `PERMIT_POOLED_START = '2007-01-01'`, `PHASE_GAP_START = '1989-01-01'`, `PPA_SERIES_END = '2023-07-07'`, `PANEL_FIRST_MONTH = '2007-01'`, `PANEL_LAST_MONTH = '2025-12'`, `LOCAL_PROGRAM_START = '2026-01-12'`; `export const COVERAGE: readonly CoverageRow[]` (the six rows of the §4.4 window table, evidence verbatim); `export function windowStart(stage: CalStage, level: 'pooled' | 'pathway'): Day`; `export function coverageGuard(spells: Spell[], stage: CalStage, from: Day, asOf: Day, on: boolean): { perYear: Record<number, number> }` — throws `CalibrationError('coverage gap: <stage> <year>')` when `on` and a year in [from-year, asOf-year] has zero entries (an entry counts in the year of max(e, from)).
  - Day conversions: import `isoToDay` from `pipeline/project-records/multiphase.ts` and `isoOf` from `pipeline/project-records/parse.ts`.
- `provenance.ts`: `export const DATASETS = { planningProjects: 'qvu5-m3a2', planningRecords: 'y673-d69b', planningReview: 'd4jk-jw33', permits: 'i98e-djp9', unitCompletions: 'j67f-aayr', housingProduction: 'xdht-4php', assessorRoll: 'wv5m-vpq2', devPipeline: '6jgi-cpb4' } as const`; `export function datasf(id: keyof typeof DATASETS): { label: string; url: string }` → `https://data.sf.gov/d/<id>`; literature sources as named constants with the URLs from `docs/superpowers/research/2026-10-16-fzp-calibration-literature.md` (HCD policy review, KQED 12075520, 2025 Housing Inventory, eyeonhousing 2026-09, Housing Element appendix B, Planning Director Bulletin 11).

- [ ] **Step 1: Failing tests.** `sc-rules.test.ts`: for each of the five ids, `QUALITY_RULES.filter(r => r.id === id)` has length 1 and `toEqual` the expected literal row (all fields from §4.4a); `QUALITY_RULES.filter(r => r.owner === 'stage-calibration').map(r => r.id).sort()` equals the five ids exactly (no pathway, pooling or size rule); no `sc.*` rule has `kind 'missing'`; `kindDefaultDepartures(SC_RULES)` is `[]`. A test that `DATASETS` ids each appear in a URL of `pipeline/sources.lock.json`. `window.test.ts`: `windowStart('permitIssued','pooled') === isoToDay('2007-01-01')`, `windowStart('construction','pathway') === isoToDay('2015-01-01')`, `windowStart('filed','pooled') === isoToDay('2015-01-01')`; `LIVE_CAL.coverageGuard === true`, `FIXTURE_CAL.coverageGuard === false`; `coverageGuard` with spells in 2015 and 2017 only throws `/coverage gap: filed 2016/` when on and returns `perYear` `{2015: n, 2016: 0, 2017: n, …}` when off.
- [ ] **Step 2–4:** Run `npm --prefix <wt> run test:pipeline -- pipeline/test/fzp-cal pipeline/test/quality.test.ts` (FAIL, then PASS after implementing). Also run the whole `pipeline/test/quality.test.ts` (the doc-section test compares `docs/dev/pipeline.md` with the registry: regenerate the section with `npm --prefix <wt> run pipeline -- quality-doc` and commit the doc change).
- [ ] **Step 5:** Commit `feat(pipeline): register the sc.* data-quality rules and the calibration windows`.

### Task 7: spells — qualifying predicate, normalisation steps 1–5, spell building

**Files:** Create `pipeline/lib/fzp-cal/spells.ts`; Test `pipeline/test/fzp-cal/spells.test.ts`, extend `pipeline/test/fzp-cal/window.test.ts`

**Interfaces (Produces):**
- `export function qualifies(h: ProjectHistory): boolean` — first recorded `unitsAt` in `STAGE_ORDER` order minus `existingUnits` ≥ 1.
- `export function normalise(hs: ProjectHistory[], asOf: Day): { norm: NormHistory[]; tallies: Pick<Tallies, 'sc.stages.gap-impute' | 'sc.stages.running-max' | 'sc.exit.last-stage'>; method: { permitOnlyPre2015: { fired: number; of: number }; ppaPooled: number /* filled by buildSpells */ }; perStage: Record<ScRuleId, Partial<Record<Stage, number>>> }` — input: qualifying histories sorted by id; steps 1–4 of spec §4.4 in order. Stages used: `pathwayStages(pathway)` for a non-null pathway, `STAGE_ORDER` for null (Review Focus 1: other stage keys are ignored). Step 3 places an exit at the last entered stage (by `STAGE_ORDER` index among used stages with an `eff`), clamps its day to ≥ `eff[last]`, and fires when stage or day changed. Samples: `<id>` for the history-level rules plus nothing else (per-stage breakdown goes in `perStage`). `of` = qualifying histories (gap-impute, running-max) / qualifying histories ending in an exit (last-stage). Step 4 counts `permitOnlyPre2015` (`of` = qualifying permitOnly histories).
- `export function buildSpells(norm: NormHistory[], asOf: Day): Spell[]` — every entered non-terminal stage: e = `eff[s]`, z per spec §4.4 "Spells" (`min(lastObserved, asOf)` censored for open; a purge-censored history is `censored` at its `end` day). `a` and `x` are filled for window V = the stage's pooled start (`a = max(0, V − e)`, `x = z − e`); spells with z < V or e ≥ asOf are dropped. Sorted by (pathway with null last, stage index, projectId). The 2015 pathway-level subset is derived later by `cutSpells`.
- `export function cutSpells(spells: Spell[], from: Day): Spell[]` — re-cuts to a later window (drop z < from; recompute `a`).
- `export function preRollCount(norm: NormHistory[]): number` — histories with no spell ending on/after 2007-01-01 (`calibration.window.preRoll`).
- preApplication pooling (step 5) is a property of transitions (Task 11 always pools preApplication); `buildSpells` returns preApplication spells with their pathway, and `calibration.method.ppaPooled` = number of preApplication spells after the window cut (counted in Task 11/16 from these spells).

- [ ] **Step 1: Failing tests** (`spells.test.ts`, hand-made histories with `isoToDay` dates): qualifying: `unitsAt {filed: 5}`, existing 4 → true; existing 5 → false; `unitsAt {}` → false. Imputation: a discretionary history with filed, entitled, permitFiled, construction (no permitIssued) gets `eff.permitIssued = eff.construction`, `tallies['sc.stages.gap-impute']` `{ fired: 1, of: <qualifying count>, sample: [id] }`, `perStage` `{ permitIssued: 1 }`. Running max: a hand-broken history with `entitled` earlier than `filed` fires `sc.stages.running-max` once and `eff.entitled === eff.filed`. Exit placement: `{kind:'exit', stage:'filed', day: d}` with a later entered `entitled` moves to stage `entitled` with day ≥ `eff.entitled`, fires `sc.exit.last-stage` with `of` = exiting histories. Defensive rule: a 2010 permitOnly history becomes pathway null and adds 1 to `method.permitOnlyPre2015.fired` (and is not a `quality.*` tally). Review Focus 1: a permitOnly history with an `entered.filed` key gets no `filed` spell. Delayed entry: a spell entered 2004-03-01 still open → `a = isoToDay('2007-01-01') − e` for `permitIssued`. Zero duration: `eff.entitled === eff.permitFiled` gives an `entitled` spell with x = 0, outcome advance. `window.test.ts` additions (spec §6 `window.test.ts`): Planning-side spells cut at 2015-01-01; `permitFiled`/`permitIssued`/`construction` cut at 2007-01-01; a 2004 permit still in `permitIssued` in 2008 enters left-truncated; a history whose spells all end in 2005 counts once in `preRollCount`, one with a spell ending exactly 2007-01-01 does not.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5:** Commit `feat(pipeline): calibration spells with registered normalisation (sc.stages.*, sc.exit.last-stage)`.

### Task 8: purge censoring (step 6)

**Files:** Create `pipeline/lib/fzp-cal/purge.ts`; Test `pipeline/test/fzp-cal/purge.test.ts`

**Interfaces:**
- Produces `export function purgeCensor(norm: NormHistory[], cal: CalProfile): { norm: NormHistory[]; tally: RuleTally; windows: PurgeWindow[] }` with `interface PurgeWindow { first: Day; last: Day; exits: number; censored: number; byReason: Partial<Record<ExitReason, number>>; byStage: Partial<Record<Stage, number>>; medianDays: number }` (exported from `fzp-cal/types.ts`). Detection exactly spec §4.4 step 6 (median of x = exit day − `eff[stage]`; mean of the 365 days before D floored at 1/365). A censored history gets `end = { kind: 'open', lastObserved: max(eff[stage], first − 1) }` and `purgeCensored = true`. `tally.of` = exits of qualifying histories after step 3; `fired` = censored exits; `sample` = `<id>:<stage>`.

- [ ] **Step 1: Failing tests** (spec §6 `purge.test.ts`): background of ~1 exit/week over 2020–2026 plus 40 exits of median duration 1,200 days on 2026-09-15 and 40 on 2026-10-01 → exactly one window `[2026-09-15, 2026-10-01]`; its long-duration exits are censored with `lastObserved === isoToDay('2026-09-14')`, its short-duration (< 730 days) exits stay exits; `tally.fired` equals the censored count, `tally.of` the qualifying exits; a burst of 40 short-duration exits on one day is not a purge; two bursts 45 days apart are two windows.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5:** Commit `feat(pipeline): administrative-purge censoring as rule sc.exit.purge-censor`.

### Task 9: Aalen–Johansen and the tail

**Files:** Create `pipeline/lib/fzp-cal/aalen-johansen.ts`, `pipeline/lib/fzp-cal/tail.ts`; Test `pipeline/test/fzp-cal/aalen-johansen.test.ts`, `aj-recovery.test.ts`, `tail.test.ts`

**Interfaces (Produces):**
- `export interface AjSweep { d: number[] /* distinct event durations, ascending */; n: number[] /* at risk at d */; e: Record<'advance' | ExitReason, number[]> /* events at d */; spells: number; events: Record<'advance' | ExitReason, number> }`.
- `export function ajSweep(spells: Spell[]): AjSweep` — risk set n(d) = #(a ≤ d) − #(x < d) (events precede censoring at ties).
- `export function ajTable(sw: AjSweep, hazard: (j, i) => number /* default e_j/n */, kMax: number, nRiskMin: number, spellsAll: Spell[]): { months: number; advance: number[]; exit: Partial<Record<ExitReason, number[]>>; S: number }` — the recursion F_j += S·h_j; S *= 1 − Σh_j; table values at month k = F after every event with d < k·M; `months` = largest k ≤ kMax with n(k·M) ≥ nRiskMin (n at a non-event duration computed from spells); floored to 1e-6. The `hazard` hook is what Task 10 uses for θ scaling (with the step cap applied by the caller).
- `export function tailFit(spells: Spell[], months: number, cal: CalProfile, scale?: Partial<Record<'advance' | ExitReason, number>>): { k0: number; events: number; personMonths: number; lambda: Record<'advance'|ExitReason, number>; tail: Transition['tail'] }` — spec §4.4 Tail; p_j = (λ_j/λ)(1 − exp(−λ)) via `math.ts`; 6 significant digits; reasons with no events in table or tail omitted by the caller.
- `export function rejects(advance, exit, tail): boolean` — C(K) > 1 − 1e-6 or ρ ≤ 0 (spec §4.4 Rejection).

- [ ] **Step 1: Failing tests.** Golden 7-spell example (spec §6): spells (a, x, outcome) = (0, 40, advance), (0, 70, censored), (0, 70, withdrawn) [event-censor tie at 70], (10, 100, advance) [delayed entry], (0, 120, expired), (0, 150, censored), (0, 200, censored). Expected `d = [40, 70, 100, 120]`, `n = [7, 6, 4, 3]`; with `kMax 240, nRiskMin 1`: `months = 6`; month 1 all 0; month 2 advance 1/7; month 3 advance 1/7, withdrawn 1/7; months 4–6 advance 9/28, withdrawn 1/7, expired 5/28 (each floored to 1e-6; assert the exact floored values). Put this derivation in a comment in the test. Also: no censoring → equals the empirical incidence; all censored → zeros; random spells → monotone and Σ ≤ 1. Review Focus 2: an advance at x = 0 lands in `advance[0]`. `aj-recovery.test.ts`: 20,000 spells sampled with `sampleTransition` from a known Transition (use `calibration-small.json` discretionary permitFiled), entries uniform over 2005–2026, censoring at asOf, window 2015 (left truncation); estimate within 0.02 of `cumulativeIncidence` at every month 1..12 and of eventual shares; a naive "dead among ended" estimator (exits ÷ ended spells) misses by > 0.02 on the same data. `tail.test.ts`: p_j formula on hand counts; k₀ extends earlier until ≥ `tailMinEvents`; `rejects` on ρ = 0 and on C(K) = 1.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5:** Commit `feat(pipeline): Aalen–Johansen cumulative incidence with delayed entry and constant-hazard tails`.

### Task 10: proportional-hazards pathway scaling (permit side)

**Files:** Create `pipeline/lib/fzp-cal/ph-pool.ts`; Test `pipeline/test/fzp-cal/ph-pool.test.ts`

**Interfaces:**
- Consumes `ajSweep`, `ajTable`, `tailFit`, `cutSpells`, `windowStart`.
- Produces `export function phScale(pooled: Spell[], pathwaySpells2015: Spell[], cal: CalProfile): { theta: Record<'advance'|ExitReason, number>; thin: boolean; months: number; advance: number[]; exit: Partial<Record<ExitReason, number[]>>; tail: Transition['tail']; capped: number; maxDiff: number /* vs the pathway's own 2015+ AJ, for the >0.05 warning */ }` — spec §4.5 permit-side: O, E (Σ_d nₚ(d)·ĥ_j(d) + pathway tail-span person-months·λ_j), θ = (O + κ)/(E + κ); thin (< `nSpellsMin` 2015+ spells) → θ = 1; re-run the AJ recursion on the pooled grid with θ·ĥ, scaling all h_j down when Σ > 1 (count in `capped`); tail λ_{p,j} = θ·λ_j; `months` = the pooled table's.

- [ ] **Step 1: Failing tests** (spec §6 `ph-pool.test.ts`): identical pathway and pooled hazards → every θ within 0.05 of 1 and the table within 0.01 of pooled; a pathway with doubled exit hazard over 2015+ (5,000 spells, simulated with constant hazards using `mulberry32`) recovers θ_exit within 0.15 and its table within 0.02 of the truth; a pathway with no 2015+ events → θ_j = κ/(E_j + κ) exactly; forcing h sums above 1 (θ = 50 on a high-hazard grid) engages the cap and `capped > 0`; the scaled table, wrapped as a Transition and substituted for `discretionary.permitFiled` in a copy of `calibration-small.json`, passes `parseCalibration`, and 20,000 `sampleTransition` draws match its `cumulativeIncidence` within 0.01 at every month.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5:** Commit `feat(pipeline): permit-side pathway levels by proportional-hazards scaling of the pooled table`.

### Task 11: the fallback ladder and every transition cell

**Files:** Create `pipeline/lib/fzp-cal/fallback.ts`, `pipeline/lib/fzp-cal/transitions.ts`; Test `pipeline/test/fzp-cal/fallback.test.ts`

**Interfaces:**
- `fallback.ts`: `export const LITERATURE: Record<CalStage, { D: Partial<Record<Pathway | 'all', { months: number; tier: 1|2|3|4; source: string }>>; A: { value: number; tier: 1|2|3|4; source: string }; primary: ExitReason }>` — exactly the §4.5 rung-3 table (filed: discretionary 17.2 tier 1, streamlined 3.42 tier 1; permitOnly has no filed cell). `export function rung3(stage, pathway, observedExitShares: Partial<Record<ExitReason, number>> | null): Transition` — `months 1`, q = 1 − 2^{−1/D} computed as `1 − exp(−log(2)/D)` via `math.ts`; tier = worst of D, A, E; `tailProvenance` copies the Transition's tier and sources (spec §4.4 "For rung 3").
- `transitions.ts`: `export function fitTransitions(spells: Spell[], asOf: Day, cal: CalProfile): { transitions: Calibration['transitions']; cells: CellReport[]; warnings: string[]; rung3: number; ppaPooled: number; spellsCount: Record<string, number> /* 'calibration.spells.<pathway>.<stage>' */ }` with `interface CellReport { pathway: Pathway; stage: CalStage; rung: 1 | 2 | 3 | 'ph'; tier; n: number; events: number; window: [string, string]; theta?: …; maxDiff?: number; capped?: number }`. Rules (spec §4.5): filed/entitled → rung 1 (pathway AJ over 2015+, tier 0) else rung 2 (pooled AJ 2015+, tier 2) else rung 3; preApplication → always pooled over 2015+ (tier 2) for all three pathways, counted in `ppaPooled`; permitFiled/permitIssued/construction → `phScale` over [2007, asOf] (tier 2) else rung 3. A rung passes with spells ≥ `nSpellsMin`, events ≥ `nEventsMin` and `!rejects`. Provenance label/method text per spec §4.5 and §4.4 (construction completion-dating sentence; purge sentence when that cell's spells include censored purge exits; `permitOnlyPre2015` sentence on permit-side cells). Warnings: each rung-3 cell; θ diagnostic > 0.05. Coverage guard per pooled window per stage.

- [ ] **Step 1: Failing tests** (`fallback.test.ts`): rung 3 with D = 6 has its median month at 6 (`typicalMonths` on a one-cell calibration, or directly C(k) ≥ 0.5 first at k = 6) and `advance[0] = A·q`; rung-3 tier for entitled is 4 (D tier 4); with no observed exits, exit is all on the primary reason at tier 4; rung selection: 40 discretionary filed spells with 25 events → rung 1 tier 0; 10 → rung 2 tier 2; 1 pooled → rung 3; Review Focus 3: a cell with 50 all-censored spells routes to rung 3 without throwing; permit-side provenance label is `SF permit records 2007–2026, pooled across pathways before 2015, scaled to discretionary 2015–2026 (tier 2)` and the method contains `since 2007-01-01, the first assessor roll` and `θ=`; every returned Transition has `tailProvenance` with tier 2 except rung 3.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5:** Commit `feat(pipeline): transition cells with the fallback ladder and provenance`.

### Task 12: initiation panel (risk timeline, aggregation, masks)

**Files:** Create `pipeline/lib/fzp-cal/panel.ts`; Test `pipeline/test/fzp-cal/initiation-panel.test.ts`, `pipeline/test/fzp-cal/initiation-basis.test.ts` (basis part)

**Interfaces:**
- `export const PANEL_MONTHS = 228` (2007-01..2025-12); `export function monthIndex(d: Day): number` (calendar month of a UTC day minus 2007-01; may be out of range).
- `export interface PanelYearRow { mapblklot: string; hostableBase: boolean; imputed: number; features: Record<FeatureId, number> }` and `export type PanelSource = { years: number[]; read(rollYear: number): Promise<PanelYearRow[]> /* sorted by mapblklot */ }`.
- `export function initiationEvents(norm: NormHistory[], firstFiled: Map<string, Day>): { timeline: Map<ParcelId, Int8Array /* PANEL_MONTHS: -1 not at risk, 0 at risk, 1 event basis record, 2 event basis permit */>; noPermit: number }` — spec §4.6 "Detection basis", "Event", "At risk": basis record if F ≥ 2015-01-01 (event F), else basis permit with P = `firstFiled.get(id)` (min non-null `filed_day` over all of the project's permit rows, superseded included); no P → no event, no coverage (`noPermit`); P before the panel → covered from month 0; event on the primary parcel (largest `lotAreaM2` from the panel/parcels, ties smaller id — pass a `lotArea(id)` callback as third parameter); covered months of every `parcelIds` parcel from the event month + 1 through the end month (exit: at risk from the next month; purge-censored: open through asOf; complete: never again). An event on a month already covered by another history is not counted (Review Focus 4 count `eventsCovered`).
- `export function firstFiledDays(permits: PermitRow[]): Map<string, Day>`.
- `export interface FitCell { bins: number[]; basis: 0 | 1; exposure: number; events: number }` and `export interface PanelResult { cells: Map<string, FitCell> /* key = year|bins|basis, raw (initial) bin indices */; years: number[]; parcelYears: number; exposureMonths: number; events: { record: number; permit: number }; eventsOffPanel: number; eventsCovered: number; maxAtRisk: { potentialRatio: number; storiesGap: number }; mask: { exposure: number[] /* bits 0..6 */; events: number[]; anyExposure: number; anyEvents: number } }`.
- `export async function aggregatePanel(src: PanelSource, timeline, edges: Record<FeatureId, number[]>): Promise<PanelResult>` — per roll year (months of year Y use roll Y), per parcel row with `hostableBase`: months with timeline value −1 skipped; parcels absent from the timeline are at risk all 12 months; non-event months take basis 1 before 2015-01, else 0; event months take their event basis. Bit 7 set → `CalibrationError('panel imputed bit 7 set: <mapblklot> <year>')`. Events whose parcel-year has no panel row or `hostableBase` false → `eventsOffPanel`.
- Step adapter (Task 16) builds `PanelSource` from `SELECT mapblklot, hostable_base, imputed, potential_ratio_base, existing_units, lot_area_m2, year_built, stories_gap_base, improvement_share, CAST(rent_control_likely AS INTEGER) AS rcl, land_use_class FROM scenario_panel WHERE roll_year = <y> ORDER BY mapblklot`, mapping columns exactly per the §4.6 table.

- [ ] **Step 1: Failing tests** (spec §6 `initiation-panel.test.ts`, a fake `PanelSource` over hand rows): not at risk while in flight; the event month counted once with event 1; at risk again the month after an exit; never after completion; the primary parcel is the largest lot, ties smaller id; no month after 2025-12; a parcel-year with `hostableBase false` contributes no exposure; features pass through unchanged (assert a FitCell's raw bins equal `binIndex(edges[f], value)` of the row's values); mask shares: hand rows carrying bits 0..6 give the hand-counted exposure and event counts per bit; a row with bit 7 throws `CalibrationError`. Also one test that runs `aggregatePanel` over a real DuckDB `scenario_panel` table created with `createTableFromRows` (the A6 table name) via `export async function duckPanelSource(db: Duck): Promise<PanelSource>` in `panel.ts` (years from `SELECT DISTINCT roll_year FROM scenario_panel WHERE roll_year BETWEEN 2007 AND 2025 ORDER BY 1`). `initiation-basis.test.ts` (basis part): F < 2015 → basis permit; the IA-11 case (two permit rows filed 2011-03-01 and 2012-06-01, `entered.permitFiled` clamped to 2012-09-01) has its event in 2011-03; a superseded refile filed earliest still sets P; no permit row → no event, no coverage.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5:** Commit `feat(pipeline): initiation panel at-risk timeline, detection basis and mask shares`.

### Task 13: ridge IRLS and the initiation model

**Files:** Create `pipeline/lib/fzp-cal/irls.ts`, `pipeline/lib/fzp-cal/initiation.ts`; Test `pipeline/test/fzp-cal/irls.test.ts`, extend `initiation-basis.test.ts`

**Interfaces:**
- `irls.ts`: `export function fitLogit(cells: FitCell[] /* sorted */, nBins: number[] /* per term */, lambda: number): { intercept: number; coef: number[][]; basis: number; iterations: number }` — binomial logit on (events, exposure), design = intercept + full one-hot per term + `basis` column; ridge ½λΣβ² on bin coefficients only; start intercept = logit(Σevents/Σexposure); stop max|Δ| < 1e-9; ≤ 100 iterations else `CalibrationError('IRLS did not converge')`; dense Cholesky in fixed order; uses `math.ts` `exp`/`log` only.
- `initiation.ts`:
  - `export const INITIAL_EDGES: Record<FeatureId, number[]>` (the §4.6 Bins table) and `export const TERM_ORDER: FeatureId[]` = `['potentialRatio','existingUnits','lotAreaM2','yearBuilt','storiesGap','improvementShare','rentControlLikely','landUseClass']`.
  - `export function mergeBins(edges: number[], eventsPerBin: number[], minEvents: number, categorical: boolean): { edges: number[]; map: number[] /* initial → merged */ }` — numeric only (`rentControlLikely` and `landUseClass` never merge): highest bin under `minEvents` merges downward repeatedly, then the same upward from the bottom.
  - `export function fitInitiation(panel: PanelResult, cal: CalProfile, fzp: FzpApplication): { model: InitiationModel; report: InitiationReport }` where `FzpApplication = { features(i): Record<FeatureId, number>; hostable: number[] /* indices of hostable parcels with no in-flight project */ }` and `InitiationReport` holds: merged bins with exposure/events/coef, `basis` coefficient, back-cast per year and per basis (predicted Σ hazard with each year's basis vs observed), per-bin observed/predicted, hold-out (fit on 2007–2022 cells, predict 2023–2025), FZP expected filings per year (12·Σ hazard over `hostable`) vs historical mean (observed events ÷ 19) with the [0.5, 20] warning band, extrapolation share (hostable parcels and FZP expected filings with FZP `potentialRatio` or `storiesGap` above `maxAtRisk`), mask shares. Published model = intercept + bin coefficients (basis = 0), 6 significant digits; provenance tier 2, window `['2007-01-01','2025-12-31']`, method with the §4.6 sentence and the basis coefficient and the extrapolation share.
  - Live: total events < `initMinEvents` → `CalibrationError`. Fixture (`fixtureInitiation`): model `{ kind: 'logit-monthly', intercept: logit(0.05), terms: [], provenance: tier 4, label 'fixture: high hazard so simulated starts appear within the e2e horizon' }`; report still printed from the panel counts.
  - `export function backcastGate(r: InitiationReport): { ok: boolean; detail: string }` — per basis |predicted − observed| ≤ 0.02·observed (V28).

- [ ] **Step 1: Failing tests** (spec §6 `irls.test.ts`): one binary feature with λ = 0 recovers the closed-form log-odds (logit of each group's rate) within 1e-9; known coefficients recovered from 2M simulated parcel-months (aggregate into FitCells directly, sampled with `mulberry32`) within 0.05; full one-hot plus ridge solves (finite coefficients) where λ = 0 would be singular; `fitLogit` with `maxIter` forced via a cells set that diverges (perfect separation and λ = 0) throws `CalibrationError`; shuffled input cells (after the documented sort) give byte-identical `JSON.stringify` output. `initiation-basis.test.ts` additions: the `basis` coefficient is absent from the published model; simulated panels with a known basis offset (+0.7 for permit-era months) recover the feature coefficients within 0.05; `backcastGate` passes per basis on the fitted data. `mergeBins([0,1,2,3], [20,15,3,2], 10, false)` → `{ edges: [0, 1], map: [0, 1, 1, 1] }`; `mergeBins([0,1,2], [3,20,20], 10, false)` → `{ edges: [0, 2], map: [0, 0, 1] }` (upward pass from the bottom); categorical input is returned unchanged.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5:** Commit `feat(pipeline): ridge IRLS initiation hazard with a measurement-basis term`.

### Task 14: pathway mix, ppaShare, Local Program provenance, phaseGap

**Files:** Create `pipeline/lib/fzp-cal/pathway-mix.ts`, `pipeline/lib/fzp-cal/phase-gap.ts`; Test `pipeline/test/fzp-cal/pathway-ppa.test.ts`, `pipeline/test/fzp-cal/phase-gap.test.ts`

**Interfaces:**
- `pathway-mix.ts`:
  - `export function pathwayForNew(norm: NormHistory[], inFlight: { pathway: Pathway }[], asOf: Day, cal: CalProfile): Calibration['pathwayForNew']` — spec §4.7 (first record in [2015-01-01, asOf], non-null pathway; fallback T3 in-flight mix tier 0); shares sum to 1 exactly (round to 6 decimals, residual to the largest).
  - `export function ppaShare(norm, asOf): Calibration['ppaShare']` — first non-PPA entry in [2023-07-08, asOf]; zero filings → 0, tier 4, "not measured".
  - `export function streamlinedForLocalProgram(streamlinedSpells: number, asOf: Day, lpDiag: { filings: number; medianFiledToEntitled: number | null }): Provenance` — spec §4.7 text verbatim, window `['2015-01-01', isoOf(asOf)]`, sources: Bulletin 11 URL + `datasf('planningProjects')`.
- `phase-gap.ts`: `export function phaseGap(permits: PermitRow[], asOf: Day, cal: CalProfile): { phaseGap: Calibration['phaseGap']; rung: 1 | 2 | 3; groups: number }` — spec §4.7a exactly (DA key `coalesce(prx_case_no, dva_record_id, da)`; `proposed_units ≥ phaseMinUnits`, non-null `filed_day` ≥ 1989-01-01, not `superseded`; same-day = one phase; rung 2 by `project_id`; rung 3 `[730]` tier 4); rung-1 method contains the sentence "window 1989-01-01 on, decoupled from the transition windows (2007-01-01 on, set by the first assessor roll): phase gaps use permit filing days only, not existing units".

- [ ] **Step 1: Failing tests** (spec §6): shares and fallback; `ppaShare` window starts 2023-07-08 (a filing on 2023-07-07 is excluded); `phase-gap.test.ts`: one DA spread over two `project_id`s forms one group; < 10 units, superseded and same-day permits are excluded or merged; gaps ascending; ladder 1 → 2 (tier 2, "not DA-specific") → 3 (`[730]`, tier 4); a 1995 permit contributes a gap and the rung-1 method contains "decoupled from the transition windows"; Review Focus 5: `phaseGap([], …)` gives rung 3.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5:** Commit `feat(pipeline): new-project pathway mix, ppaShare, Local Program proxy and phase gaps`.

### Task 15: size and revision models

**Files:** Create `pipeline/lib/fzp-cal/size.ts`, `pipeline/lib/fzp-cal/revision.ts`; Test `pipeline/test/fzp-cal/size.test.ts`, `pipeline/test/fzp-cal/revision.test.ts`

**Interfaces:**
- `export function sizeModel(norm: NormHistory[], asOf: Day, cal: CalProfile, fillLevels: readonly number[]): { size: SizeModel; overEnvelope: { fired: number; of: number } }` — spec §4.8 (snap to nearest fill level, ties up; r > 1 → 1 counted in `overEnvelope` → `calibration.method.sizeOverEnvelope`; bucket edges 4, 6, 8, 12, 999; merge below `sizeMinN`; fallback point mass at fill 1 tier 3). `fillLevels` is passed in (the caller imports `FILL_LEVELS` from `src/lib/data/scenario-codec.ts`).
- `export const REVISION_EDGES = [0.25, 0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3]`; `export function revisionModel(norm: NormHistory[], asOf: Day, cal: CalProfile): { revision: RevisionModel; clamp: RuleTally }` — spec §4.9 (two pairs, both counts ≥ 1, later stage entered in [2015-01-01, asOf]; ratio clamped to [0.25, 3] via `sc.revision.ratio-clamp`, `of` = revised pairs, sample `<id>:<stage>`; exactly 3 in the last bin; fallback pooled then probability 0 tier 4).

- [ ] **Step 1: Failing tests** (spec §6): snapping on the F = 5 grid (r = 0.6 → 0.5; r = 0.625 → 0.75 tie up; r = 1.4 → 1 and counted in `overEnvelope`, and the size method states "r > 1, mostly density-bonus projects, counted as fill 1: 1 of n"); bucket merge; fallback point mass tier 3; revision: the two pair types; a 10-to-1 resize fires the clamp and lands in [0.25, 0.5); a 1-to-5 resize lands in the last bin [2, 3]; pooling below `revMinN`; `probs` sum to 1.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5:** Commit `feat(pipeline): size and revision models (sc.revision.ratio-clamp)`.

### Task 16: the pure core, the report and the build step

**Files:**
- Create: `pipeline/lib/fzp-cal/calibrate.ts`, `pipeline/lib/fzp-cal/report.ts`, `pipeline/steps/calibration.ts`
- Modify: `pipeline/steps/build.ts`
- Test: `pipeline/test/fzp-cal/calibrate.test.ts`, `pipeline/test/fzp-cal/calibration-step.test.ts`

**Interfaces:**
- `calibrate.ts`:
  - `export interface CalInput { asOf: Day; histories: ProjectHistory[]; permits: PermitRow[]; panel: PanelSource; parcels: ScenarioParcels; inFlight: InFlightProject[]; fillLevels: readonly number[]; datasetVersion: string }`.
  - `export interface CalOutput { calibration: Calibration; json: string; reportMd: string; tallies: Tallies; counts: Record<string, number> /* calibration.* only */; warnings: string[]; backcast: { ok: boolean; detail: string } }`.
  - `export async function calibrate(input: CalInput, cal: CalProfile): Promise<CalOutput>` — order: qualify → normalise → purge → spells (then `tallies['sc.stages.gap-impute'] = gapImputeTally(normResult.imputed, <buildSpells output, before any cutSpells>)`, conductor ruling C1; running-max and last-stage come from `normalise`'s `tallies`, purge-censor from `purgeCensor`) → transitions → panel/initiation → pathway mix/ppaShare/Local Program → size → revision → phaseGap → assemble in T4 key order → `parseCalibration` (failure → `CalibrationError`) → report. `counts` keys exactly spec §4.10 "report.json counts" minus `.bytes` (the step adds it): `calibration.histories`, `.qualifying`, `.pathwayNull`, `.window.preRoll`, `.method.permitOnlyPre2015`, `.method.ppaPooled`, `.method.sizeOverEnvelope`, `.spells.<pathway>.<stage>`, `.rung3`, `.panel.parcelYears`, `.panel.exposureMonths`, `.panel.events`, `.purge.windows`, plus `calibration.panel.eventsOffPanel` and `calibration.panel.eventsCovered`. No `quality.*`, `calibration.adjust.*` or `calibration.purge.censored` key. FZP application: features via `featureValue(parcels, i, f, 'fzp')`; hostable = `parcels.hostable[i] === 1` and parcel id not in any in-flight project's `parcelIds`; `lotArea` for the primary parcel from `parcels.lotAreaM2` via `parcels.index`.
- `report.ts`: `export function calibrationReport(x: ReportInput): string` — the ten sections of spec §4.10 in order, deterministic Markdown (no timestamps), including the `sc.*` rules section (id, label, tier, action, fired, of, share from the tallies + `qualityRule(id)`), `calibration.method.*` counts, the purge windows, `calibration.window.preRoll`, the TCO-versus-`completed_date` construction diagnostic (over completed histories with permit rows: median of `entered.complete − eff.construction` vs median of `min(complete_day of the project's permit rows) − eff.construction`; "not measurable" when no history has both), the mask shares (bits 0–6), the parameter index (every Provenance path with tier and first source) and the method constants of the profile.
- `pipeline/steps/calibration.ts`:
  ```ts
  export const CALIBRATION_JSON = 'scenarios/fzp/calibration.json';
  export const CALIBRATION_REPORT_MD = 'calibration-report.md';
  export async function writeCalibration(o: {
    db: Duck; outDir: string; derivedDir: string; datasetVersion: string; asOf: Day;
    histories?: ProjectHistoriesFile; cal: CalProfile; counts: Record<string, number>;
  }): Promise<{ warnings: string[]; checks: InvariantResult[] /* V28, V29 */ }>
  ```
  Reads `<outDir>/scenarios/fzp/projects.json` (`parseProjectsFile`), `<outDir>/scenarios/fzp/parcels.bin` (`readParcelsBin` from `pipeline/steps/scenario.ts`), histories from `o.histories` or `<derivedDir>/project-histories.json`, permits via `SELECT … FROM read_parquet('<derivedDir>/permits.parquet') ORDER BY permit_number` (escape with a local `sqlStr`), the panel through `duckPanelSource(db)`; if the `scenario_panel` table does not exist, `CREATE TABLE scenario_panel AS SELECT * FROM read_parquet('<derivedDir>/parcel-panel.parquet')`. Throws `CalibrationError` when histories `asOf`, projects `asOf` and `o.asOf` differ. Runs `calibrate` twice; V29 = `json`, `reportMd`, `counts` and `tallies` all equal. Records the FIRST run's tallies with `recordQuality(o.counts, id, tally)` for all five ids in `SC_RULE_IDS` order, writes the first run's `counts` plus `calibration.bytes` into `o.counts`, writes both files (mkdir). V28 = `backcastGate` when `cal.backcastGate`, else `{ ok: true, detail: 'fixture: back-cast gate is live-only' }`. Warnings: the core's.
- `build.ts`: after the projects step and before `writeQualityReport` (which moves below it), `const calibration = await report.time('calibration', () => writeCalibration({ db, outDir, derivedDir, datasetVersion, asOf, histories: { schema: 1, asOf, histories: projects.histories }, cal: fixtureMode ? FIXTURE_CAL : LIVE_CAL, counts }))`; push its warnings; pass `calibrationChecks: calibration.checks` to `checkDataset` (wired in Task 17). `CalibrationError` propagates (aborts the build).

- [ ] **Step 1: Failing tests.** `calibrate.test.ts` over a small synthetic `CalInput` (hand histories covering every stage, a fake `PanelSource`, a 3-parcel `ScenarioParcels` built by decoding fixture-0's `e2e/fixtures/data/fixture-0/scenarios/fzp/parcels.bin` with `readParcelsBin`): output passes `parseCalibration`; `Object.keys(calibration)` equals the T4 order; `json` has no whitespace between tokens; two calls give identical `json` and `reportMd`; counts contain every key listed above and none starting with `quality.`; the report contains the ten section headings in order and `calibration.window.preRoll`. `calibration-step.test.ts`: run `fixture({ outDir, skipTiles: true, derivedRoot })` once in `beforeAll` (as `golden.test.ts` does); assert `<outDir>/fixture-0/scenarios/fzp/calibration.json` parses, `<derivedRoot>/fixture-0/calibration-report.md` exists, `report.json` counts have `quality.<id>.fired` and `.of` for all five `sc.*` ids (zero-firing ones included), `calibration.method.permitOnlyPre2015`, `.ppaPooled`, `.sizeOverEnvelope`, `calibration.window.preRoll`, and no key matching `/^calibration\.(adjust|purge\.censored)/`; a source scan of `pipeline/steps/calibration.ts` and `pipeline/lib/fzp-cal/*.ts` finds no `'quality.` string literal (writes only through `recordQuality`). (These counts are pinned in Task 18's golden.)
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5:** Commit `feat(pipeline): calibration build step writing calibration.json and its report`.

### Task 17: invariants V25–V29 in check

**Files:**
- Create: `pipeline/lib/fzp-cal/invariants.ts`
- Modify: `pipeline/steps/check.ts`, `pipeline/cli.ts`, `pipeline/steps/build.ts` (pass `calibrationChecks`)
- Test: `pipeline/test/fzp-cal/calibration-invariants.test.ts`

**Interfaces:**
- `invariants.ts`: `export function checkV25(json: string, fileBytes: number, fillLevels: readonly number[], projectsAsOf: Day | undefined, historiesAsOf?: Day): string[]` (problems; `parseCalibration`, element-wise `fillLevels` equality with `FILL_LEVELS`, `asOf` equality, ≤ 262,144 bytes); `export function checkV26(cal: Calibration, inFlight: { pathway: Pathway; stage: Stage }[]): string[]` (every `pathwayStages` pair present, every in-flight non-complete (pathway, stage) has a cell, every cell passes §4.4 rejection); `export function checkV27(cal: Calibration, n: number, tol: number): string[]` (per Transition, `mulberry32(0x5eed)` stream re-seeded per cell in `PATHWAYS` × `STAGE_ORDER` order, `n` draws from m = 0, empirical incidence by `monthsIn(0, days) + 1` vs `cumulativeIncidence(t, k)` for k = 1..months and eventual shares vs `eventualProbabilities(t, 0)`); V28/V29 come from the step.
- `check.ts`: `export const CALIBRATION_CHECK_IDS = ['V28', 'V29'] as const`; `CheckExtras.calibrationChecks?: InvariantResult[]`; after V24 and before V30, add V25–V27 (file-based: read `scenarios/fzp/calibration.json` and `projects.json` from `outDir`; a missing file is `ok: false` "calibration.json missing"), then copy V28/V29 from `extras.calibrationChecks` by id ("not measured" `ok: false` when absent). `cli.ts` `check`: re-feed V28/V29 from report.json `invariants` filtered by `CALIBRATION_CHECK_IDS`.

- [ ] **Step 1: Failing tests** (spec §6 `calibration-invariants.test.ts`): on fixture-0 output (one shared `fixture()` build in `beforeAll`), V25–V29 all `ok`; V25 fails on a copy with a sum > 1, on a copy whose `fillLevels` are `[0.5, 1]` with length-2 `probs` (parses, but differs from `FILL_LEVELS`), on an `asOf` mismatch and on a 300 KB file; V26 fails when `permitOnly.construction` is deleted and when an in-flight project's (pathway, stage) cell is missing; V27 passes on fixture-0 and on `calibration-small.json`, and `checkV27` called directly (no parse) on a copy whose `discretionary.permitFiled.advance` is made non-monotone reports that cell; V29: `sameRuns(a: CalOutput, b: CalOutput): string[]` (exported from `pipeline/steps/calibration.ts`, used by the step for V29) returns `[]` for two fixture runs and names `json` when one run's `json` is altered.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS). Run the existing `pipeline/test/invariants.test.ts` and update any test that enumerates the V ids (V25–V29 now present).
- [ ] **Step 5:** Commit `feat(pipeline): calibration invariants V25–V29`.

### Task 18: fixture-0 calibration, goldens, docs

**Files:**
- Modify: `pipeline/steps/fixture.ts` (GOLDEN_FILES += `CALIBRATION_JSON`; GOLDEN_DERIVED += `calibrationReport: CALIBRATION_REPORT_MD`), `pipeline/test/golden.test.ts` (`COMPARED` += calibration.json; derived report compared; the "keeps scenarios out of the manifest until calibration.json exists" test becomes "names the three scenario files in the manifest"), `pipeline/test/fzp-cal/calibration-invariants.test.ts` (pin fixture counts), `docs/dev/pipeline.md`
- Regenerate: `e2e/fixtures/data/fixture-0/**` and `pipeline/test/fixtures/mini/golden/**` via `npm --prefix <wt> run pipeline -- fixture --update-golden`
- Test: `src/lib/timelapse/model.test.ts` (accepts fixture-0's file)

- [ ] **Step 1: Failing tests:** golden test expects `scenarios/fzp/calibration.json` and `golden/derived/calibration-report.md` and `manifest.scenarios.fzp.calibration === '/data/fixture-0/scenarios/fzp/calibration.json'`; `model.test.ts` `parseCalibration` accepts `e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json`; `calibration-invariants.test.ts` pins fixture-0's `quality.sc.*` `fired`/`of` and `calibration.method.*` and `calibration.window.preRoll` values (literal goldens copied from the first green run; for `sc.stages.running-max` and `sc.exit.last-stage` assert `fired === 0` and `of > 0`, per spec §4.4a "Fixture cases").
- [ ] **Step 2:** Run (FAIL).
- [ ] **Step 3:** Wire the fixture/golden lists, run `fixture --update-golden`, inspect `calibration.json` (rung 3 and the fixed initiation model expected; size ≤ 256 KB) and the report by eye, then update `docs/dev/pipeline.md`: Invariants paragraph "V1 to V24 and V30" → "V1 to V30" and append the spec §4.10 sentence verbatim; "Where things land" gains `pipeline/out/<v>/scenarios/fzp/calibration.json` (shipped, named in the manifest) and `pipeline/.cache/derived/<v>/calibration-report.md` (not uploaded); the Fixture paragraph's golden list gains both.
- [ ] **Step 4:** Run `npm --prefix <wt> run test:pipeline`, `npm --prefix <wt> run test:unit`, `npm --prefix <wt> run check`, `npm --prefix <wt> run lint`. Expected: all PASS. Then `SFH_E2E_PORT=4204 npm --prefix <wt> run test:e2e` (the fixture manifest now names `scenarios`); expected PASS.
- [ ] **Step 5:** Commit `feat(pipeline): fixture-0 calibration and goldens; docs for V25–V29`.

### Task 19: cross-engine model golden (AC-11)

**Files:** Create `src/lib/timelapse/fixtures/model-golden.json`, `src/lib/timelapse/model.golden.test.ts`, `src/lib/timelapse/model.golden.svelte.spec.ts`, `scripts/model-golden.ts` (generator, tsx)

**Interfaces:** `model-golden.json` = `{ cases: { fn: string; input: string /* description */; bits: string[] /* 16-hex IEEE-754 per output number, flattened in key order */ }[] }` over `calibration-small.json`: `sampleTransition` at 50 fixed (u, m) pairs (both `days` and the kind index), `initiationHazard` at 20 feature vectors, every `chanceTable` entry of 2 cells (Float32 widened to double), `typicalMonths` whole result, `cumulativeIncidence` for k = 0..40 on 2 cells. The generator writes it from Node; both tests recompute and compare bit patterns (reuse the `bits` helper pattern of `math.golden.svelte.spec.ts`).

- [ ] **Step 1:** Write the two tests (FAIL: no golden). **Step 2:** Generate with `npx --prefix <wt> tsx scripts/model-golden.ts`; run the server test (PASS) and the client project in Chromium (PASS).
- [ ] **Step 3:** `npx playwright install webkit firefox`; run both `math.golden.svelte.spec.ts` and `model.golden.svelte.spec.ts` with `--browser.name=webkit` and `--browser.name=firefox` (client project); record the commands and results in `.superpowers/sdd/2026-10-18-stage-calibration/ac11-engines.md`.
- [ ] **Step 4:** Commit `test(timelapse): cross-engine golden for the T12 model (AC-11)`.

### Task 20 (operator): first live dry run and share measurement

Not an implementer task. The operator: clones the raw cache (`cp -c -R` from `fzp-scenario-data/pipeline/.cache/raw` into this worktree's `pipeline/.cache/raw`), runs `npm --prefix <wt> run pipeline -- build --skip-tiles`, and records into `.superpowers/sdd/2026-10-18-stage-calibration/live-dry-run.md`: every `sc.*` share (fired ÷ of), the V25–V30 results, rung per cell, θ diagnostics, initiation events per basis and back-cast, FZP filings band, `calibration.json` bytes, warnings. Any `sc.*` share above 0.01 → message main for a DQ-4 override ruling (do not set overrides). Any failure of a live-only gate → systematic debugging, then fix-tasks.

### Task 21 (operator, on relay): merge project-records F2

When main relays the project-records F2 integration sha: `git -C <wt> merge <sha>`; resolve `build.ts` (PR F2 makes `writeProjectRecords` take `counts` and drops `...projects.counts`; keep the calibration step after projects and `writeQualityReport` after calibration); regenerate the fixture goldens; run the full suites; re-run Task 20's live dry run on the merged code.
