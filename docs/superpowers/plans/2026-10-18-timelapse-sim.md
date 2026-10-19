# timelapse-sim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The FZP timelapse worker: a pure, deterministic schedule simulator (`simulate`, T5), its old-zoning twin (`baseZoning`, T9), the time-aware score and bands (T8), the project card (T6), lazy geometry, the scenario host and router behind the existing Worker, and the main-thread `ScenarioClient` (T6).

**Architecture:** Everything lives in `src/lib/sim/scenario/` (worker-safe: no zod, no DOM, no `$app`) plus a router in `src/lib/sim/router.ts`, a thin `worker.ts` and `src/lib/sim/scenario-client.ts`. One shared event engine drives both `simulateDetailed` (Schedules + masters) and the allocation-light `simulateNet` (per-month series), so they cannot drift. Draws are counter-based (stateless hash of seed, entity, k, purpose, stage), so every schedule depends only on its own entity and the FZP run and its `baseZoning` twin share random numbers. The scenario host loads the three scenario files, runs band runs in ≤ 50 ms slices on `setTimeout(0)`, and packs timeline cells with timelapse-render's `packTimedCell` only for viewport-wanted chunks.

**Tech Stack:** TypeScript, Vitest (server project for `*.spec.ts`/`*.test.ts`, client/browser project for `*.svelte.spec.ts`, pipeline project for `pipeline/test/**/*.test.ts`), ESLint, Node `zlib` in tests.

**Spec:** `docs/superpowers/specs/2026-10-16-timelapse-sim-design.md` (read it; this plan argues from it, and section numbers below are its sections). Design: `docs/superpowers/design/2026-10-16-1903-fzp-timelapse.md` (§Reappraisal 1, consumer audit, Execution amendments 2026-10-18). Both paths are relative to the worktree root `/Users/mindlace/Projects/sfhousing/.claude/worktrees/fzp-timelapse/.claude/worktrees/fzp-timelapse-sim`. If the spec copy in this worktree predates commit 43c348d, read the spec at `/Users/mindlace/Projects/sfhousing/.claude/worktrees/fzp-timelapse/docs/superpowers/specs/2026-10-16-timelapse-sim-design.md`.

## Global Constraints

Design global constraints (verbatim, spec §3):

- **Evidence hierarchy** (above). No number reaches the simulation without a tier and a source. A tier-3 or tier-4 number is never presented as data.
- **Data quality** (reappraisal 1). Live sources are not assumed clean. Every pipeline rule that nulls, replaces, defaults or drops a source value is a registered T14 rule with a tier, a label and counts in every build. A replaced parcel value sets its `imputed` bit, and a changed record carries the rule's id in `quality`. A value a rule wrote is never presented as a record.
- **Determinism.** The same `datasetVersion` and seed always give the same future, on every machine. The representative seed is chosen deterministically: the run whose final `completedNet` is the median of the N band runs.
- **Honesty of numbers.** The mode is labelled a *simulation*. The scoreboard shows the shown run and the p10–p90 band. Pipeline and new-FZP units are separate lines. Actual completions since the RHNA period start are counted and labelled as actual. Units lost to dead projects are shown.
- **Time scrubbing performance.** At 60 fps on a 2022-era laptop with the whole city's timeline loaded, per-frame JS during scrub or playback is O(1) in project count. A reroll reaches a full new timeline (the shown run, to 2050) within 3 s off the main thread. The p10–p90 band may fill in progressively afterwards; the UI marks it as provisional until it is complete.
- **First paint.** `/fzp` must not require loading every parcel chunk. The whole-city score comes from `parcels.bin`, `projects.json` and `calibration.json`. Geometry streams with the viewport, as on `/`.
- **The editor is unchanged.** `/` and `/p/:id` behave exactly as before. FZP mode is additive. The one intended exception is the shared header, which gains the mode links ("Paint" / "Timelapse") and shortens the brand to "SF Housing" below 640 px so the links fit at 375 px.
- **Map budgets in FZP mode.** Two deck layers per cell are allowed for timeline cells: translucency needs them. This is an exception to map-view's one-layer-per-cell rule, so a `bench:map` timeline scenario must pass the same p95 frame bar. The existing-building catch-up stays within 2,000 feature-state changes per frame.
- **Accessibility.** WCAG 2.2 AA as in `docs/dev/accessibility.md`. The scrubber is a labelled slider: arrow keys step a month, Page Up/Down a year. Reduced motion stops autoplay, but scrubbing still works.

Rulings and carry-forwards in force (from the conductor):

- A1: `OPEN_DAY` is `Math.fround(3.0e38)`. Compare against the exported constant from `src/lib/timelapse/time.ts`, never a literal.
- A2: check `cal.size.fillLevels` equals `FILL_LEVELS` element by element when assembling SimInput. A mismatch is `scenario-invalid`.
- A3: `src/lib/sim/scenario/**` is on the determinism ESLint rule. Use `exp`/`log` from `src/lib/timelapse/math.ts`; never `Math.exp`/`Math.log`/`Math.pow`/`**` (write 2³² as `4294967296`).
- A4: validate `projects.json` only with `parseProjectsFile` from `src/lib/timelapse/projects.ts`. No `projects-shape.ts`. Never re-validate an `onInvalid`-filtered file strictly.
- `readScenarioParcels` reports any stream failure as `ScenarioFormatError('inflate failed…')`. Read bytes fully through `fetchBytes` first: body-read failures are retried; decode failures are `scenario-invalid`, never retried.
- Hostable is decoupled from the density cap. T11 `flags` bit 5 is `eligible`. Build every simulated generator record through `scenarioRecordOf(parcels, i, rec)` (replaces units, floor area, height and eligible).
- `massedUnits(b) === 0` is approximate on the card. Pipeline memo key: seed, units, stories, sorted de-duplicated parcel ids. `b.parcelId` is the massing anchor (largest `areaM2`, ties smallest id), not the cell-anchor parcel (smallest `ParcelId`).
- `packTimedCell` throws on revision days that are not strictly ascending: merge same-day revisions in `simulate`.
- The worker never sends T12 lookups. Rings are passed as stored (packing closes them); tests count vertices from packed `startIndices`.
- `typicalMonths` can return 551,213 (never Infinity). `Transition.exit` can be `{}`. `initiationHazard` does not validate features: pass only finite ones. `parseCalibration` rejects duplicate revision stages.
- Known model limitation (partner: ship as is): the initiation hazard has no market-level term. Implement the spec faithfully; do not compensate.
- `host.ts`, `display.ts`, `client.ts` get **no diff**; their tests pass untouched (AC 11).
- Code style: 2-space indent, single quotes, no trailing commas, 100 columns. Conventional Commits. Every Vitest test calls `expect` (`expect.requireAssertions`).
- Commands: never `cd … && …`; use `npm --prefix <worktree>` and `git -C <worktree>`. Never bare `git stash`. No push, no signoff, no R2. Playwright/bench port: `SFH_E2E_PORT=4205`.
- Vitest single file: `npm --prefix <worktree> exec -- vitest run --project server <path>`; browser: `--project client`; pipeline: `--project pipeline`. Lint: `npm --prefix <worktree> run lint`. Types: `npm --prefix <worktree> run check`.

## Review Focus

1. **A project parcel absent from T11** (or a project whose every parcel is absent): logged once, the project is still simulated and scored, gets no geometry and no cell, and never throws. Test in Task 4 (`simulate`) and Task 15 (host packing).
2. **A hostable parcel with a non-finite feature value** (NaN `improvementShare`, say): `initiationHazard` would silently use bin 0. Expected: that parcel gets hazard 0, and one aggregated warning names the count and the first parcel id. Test in Task 3.
3. **Requests interleaved with long work**: `parcelSummary`/`prefetch` during band slices are answered between slices; `reroll(null)` during a seeded init's band waits for the 101 FZP runs before posting; a second `initScenario` mid-load cancels the first's fetches and timers so no stale `timeline` is ever posted under the old rev. Test in Task 14.
4. **A generator that throws or returns null for every revision of a pipeline project**: every revision gets a footprint entry, the project is packed and pickable, the card says `massing: 'none'`, and the error is logged once per project (not once per revision or per reroll). Test in Task 11.
5. **In-flight history days after `asOf`** (and a current-stage day missing): clamped to `asOf`; the first future event is still strictly after `asOf`. Test in Task 4.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/sim/scenario/types.ts` (modify) | T5/T6/T8 types amended to Reappraisal 1 |
| `src/lib/sim/scenario/dates.ts` | `dayOf`, `isoOf` |
| `src/lib/sim/scenario/rng.ts` | `fmix32`, `draw`, purpose constants, entity hashes |
| `src/lib/sim/scenario/input.ts` | `buildSimInput(files)`, `ScenarioInputError`, per-input precompute (`precomputeOf`) |
| `src/lib/sim/scenario/engine.ts` | the shared event engine: stage steps, redraw, revisions + merge, pipeline rows, masters/phases, initiation and risk set, demolished-once |
| `src/lib/sim/scenario/simulate.ts` | `simulate`, `simulateDetailed`, `simulateNet` (thin sinks over the engine), `Master` |
| `src/lib/sim/scenario/policy.ts` | `PolicyOp`, `baseZoning`, `applyPolicies` |
| `src/lib/sim/scenario/score.ts` | months, shown series, net series, planEffect, phasing, targets, references, `assembleScore` |
| `src/lib/sim/scenario/band.ts` | nearest-rank quantiles, representative seed, band state |
| `src/lib/sim/scenario/massing.ts` | `massingFor`, footprints, anchors, memo keys |
| `src/lib/sim/scenario/card.ts` | `ProjectCard` construction and project choice |
| `src/lib/sim/scenario/load.ts` | request validation, manifest URLs, fetch with retries, decode and validate files |
| `src/lib/sim/scenario/geometry.ts` | per-shown-run cell packing state, `demolish` list |
| `src/lib/sim/scenario/scenario-host.ts` | `createScenarioHost`: scheduling, timelines, reroll, chunks, summaries |
| `src/lib/sim/router.ts` | `createWorkerRouter`: editor host vs scenario host |
| `src/lib/sim/worker.ts` (modify) | thin shell over the router |
| `src/lib/sim/scenario-client.ts` | `ScenarioClient` |
| `src/lib/sim/scenario/fixtures/` | `mini-parcels.ts`, `mini-projects.ts`, `mini-calibration.json`, `synth-city.ts`, `golden-seed1.json` |
| `eslint.config.js` (modify) | determinism rule scope |
| `pipeline/test/simulate-replay.test.ts` | historical replay |

Extra internal files beyond the spec's table (`input.ts`, `engine.ts`, `massing.ts`, `load.ts`, `geometry.ts`, `router.ts`) are module-internal splits; they change no T-row.

---

### Task 1: Step-0 types to Reappraisal 1, lint scope

**Files:**
- Modify: `src/lib/sim/scenario/types.ts`, `src/lib/sim/scenario/types.spec.ts`, `eslint.config.js:70`

**Interfaces:**
- Produces (types every later task uses):
  - `Schedule.phase: { masterId: string; index: number /* 1-based */; of: number; start: 'scheduled' | 'estimated' } | null`; `revisions` comment: strictly ascending days, same-day merged (last wins), none on or after `entered.construction`.
  - `ProjectCard.storiesTier: 0 | 3 | 4 | null`; `ProjectCard.quality: { label: string; tier: 2 | 3 | 4; valueTier: 0 | 1 | 2 | 3 | 4 | null }[]`; `existingUnits` comment = the T6 row's source rule (pipeline: T3; phase: T11 sum of its own parcels; simulated: T11 sum of its parcels not already demolished earlier in the run).
  - `TimelineScore.phasing.unenriched: { projectId: string; label: string | null; units: number; drawn: boolean }[]`; the `planEffect`/`planEffectBand` comment gains "[] until computed: always [] in revision 0, filled by later band-only updates".
  - Every other declaration stays byte-identical. Copy comments from the T5/T6/T8 rows in spec §2.

- [ ] **Step 1: Write the failing compile-time assertions** in `types.spec.ts` (extend the existing file's `Assert`/`Equals` pattern): `Schedule['phase']` equals the 4-field shape above with `start: 'scheduled' | 'estimated'`; `ProjectCard['storiesTier']` equals `0 | 3 | 4 | null`; `ProjectCard['quality'][number]` equals `{ label: string; tier: 2 | 3 | 4; valueTier: 0 | 1 | 2 | 3 | 4 | null }`; `TimelineScore['phasing']['unenriched'][number]['drawn']` is `boolean`. Keep a runtime `expect(true).toBe(true)` per test so `requireAssertions` holds.
- [ ] **Step 2: Run** `npm --prefix <wt> run check` — Expected: type errors on the new assertions.
- [ ] **Step 3: Amend `types.ts`** as in Interfaces. Grep for consumers of `phase`/`storiesTier` (`src/lib/map/**` fixtures, `pack-timed.spec.ts`, `timeline-small.ts`) and add `start: 'estimated'` (or the fixture's intended value) wherever a fixture builds a `phase` object; no behaviour change there.
- [ ] **Step 4: Add `'src/lib/sim/scenario/**'`** to the `files` of the determinism block in `eslint.config.js` (beside `'src/lib/timelapse/**'`, `'pipeline/lib/fzp-cal/**'`).
- [ ] **Step 5: Verify the lint scope (one-off, AC 19).** Create a scratch `src/lib/sim/scenario/_lint-probe.ts` containing `export const x = Math.log(2);`, run `npm --prefix <wt> exec -- eslint src/lib/sim/scenario/_lint-probe.ts`, expect a `no-restricted-properties` error naming `math.ts`; delete the file; record the command and output in the task report.
- [ ] **Step 6: Run** `npm --prefix <wt> run check` and `npm --prefix <wt> exec -- vitest run --project server src/lib/sim/scenario/types.spec.ts src/lib/map` — Expected: PASS.
- [ ] **Step 7: Commit** `feat(sim): scenario types to reappraisal 1; determinism lint covers src/lib/sim/scenario`

### Task 2: Dates and counter-based RNG

**Files:**
- Create: `src/lib/sim/scenario/dates.ts`, `dates.spec.ts`, `rng.ts`, `rng.spec.ts`

**Interfaces:**
- Produces:
  - `dayOf(y: number, m: number, d: number): Day` (= `Date.UTC(y, m − 1, d) / 86400000`), `isoOf(day: Day): string` (`'YYYY-MM-DD'`), `firstOfMonth(day: Day): Day`, `addMonths(firstDay: Day, n: number): Day`.
  - `fmix32(h: number): number` (MurmurHash3 finalizer with `Math.imul`/`>>>`, returns uint32 via `>>> 0`).
  - `const P = { INIT: 1, INIT_DAY: 2, PATHWAY: 3, PPA: 4, SIZE: 5, STAGE: 6, REV: 8, REV_RATIO: 9, PHASE_GAP: 11 } as const`; `stageRedraw(j: 1..7): number` = `16 + j`.
  - `simEntity(parcelId: ParcelId): number` = `fnv1a32('p:' + parcelId)`; `jobEntity(projectId: string): number` = `fnv1a32('j:' + projectId)`.
  - `draw(seed: number, entity: number, k: number, purpose: number, stageIdx: number): number` in (0, 1): `H = fmix32(seed ^ 0x5bd1e995); H = fmix32(H ^ entity); H = fmix32(H ^ Math.imul(k + 1, 0x9e3779b1)); H = fmix32(H ^ ((purpose << 8) | stageIdx)); return (H + 0.5) / 4294967296`.

- [ ] **Step 1: Write failing tests.**
  - `dates.spec.ts`: `dayOf(1970,1,1) === 0`; `isoOf(dayOf(2026,10,16)) === '2026-10-16'`; `isoOf(dayOf(2050,12,31)) === '2050-12-31'`; `addMonths(dayOf(2026,10,1), 3) === dayOf(2027,1,1)`; `firstOfMonth(dayOf(2026,10,16)) === dayOf(2026,10,1)`.
  - `rng.spec.ts` goldens (computed by an independent Python reference; uint32 then u):
    - `draw(1, 3371792748, 0, 1, 0)` → H 2853239561, u `0.6643216036027297` (`simEntity('3512008') === 3371792748`)
    - `draw(1, 1793439947, 0, 6, 5)` → `0.018687303294427693` (`jobEntity('PRJ:2019-000001PRJ') === 1793439947`)
    - `draw(0, 0, 0, 0, 0)` → `0.00713810499291867`
    - `draw(4294967295, 1226906279, 3, 9, 4)` → `0.468825304065831` (`simEntity('0026T001A') === 1226906279`)
    - `draw(42, 1217645751, 2, 11, 0)` → `0.747285291668959` (`jobEntity('CASE:2007.0001PRX') === 1217645751`)
  - Chi-square: 10⁶ draws over entities `0..999999` (seed 7, purpose STAGE) into 100 equal bins, p > 0.001 (critical χ²₉₉ at 0.001 = 148.23: assert statistic < 148.23).
  - Cross-purpose correlation: for 10⁵ entities, Pearson |r| < 0.005 between `draw(…, P.INIT, 0)` and each of `P.SIZE`, `P.STAGE`, `P.REV`, and between `k = 0` and `k = 1`.
- [ ] **Step 2: Run** `vitest run --project server src/lib/sim/scenario/dates.spec.ts src/lib/sim/scenario/rng.spec.ts` — FAIL (modules missing).
- [ ] **Step 3: Implement** both modules (no `Math.pow`/`**`).
- [ ] **Step 4: Run** — PASS; `npm --prefix <wt> run lint` clean for these files.
- [ ] **Step 5: Commit** `feat(sim): scenario dates and counter-based draws`

### Task 3: Mini fixtures, `buildSimInput`, per-input precompute

**Files:**
- Create: `src/lib/sim/scenario/fixtures/mini-parcels.ts`, `fixtures/mini-bin.ts`, `fixtures/mini-projects.ts`, `fixtures/mini-calibration.json`, `src/lib/sim/scenario/input.ts`, `input.spec.ts`

**Interfaces:**
- Consumes: `encodeScenarioPayload`, `readScenarioParcels`, `FILL_LEVELS`, `featureValue` (`src/lib/data/scenario-codec.ts`); `parseCalibration` (`model.ts`); `parseProjectsFile` (`projects.ts`); `initiationHazard`; `log` (`math.ts`). Model `fixtures/mini-parcels.ts` on `src/lib/data/fixtures/scenario-tiny.ts`.
- Produces:
  - `mini-parcels.ts` must stay browser-safe (the Task 8 golden runs in Chromium): no `node:` imports. The deflated bytes come from a separate Node-only helper `fixtures/mini-bin.ts`: `miniBin(): Uint8Array` = `deflateRawSync(encodeScenarioPayload(miniCity().parcels))`.
  - `miniCity(): { parcels: ScenarioParcels; manifest: Manifest /* datasetVersion 'mini-1', 4 chunks, scenarios.fzp URLs under /data/mini-1/ */; chunks: Record<string /* url */, unknown /* parcel-chunk JSON as served */>; records: Map<ParcelId, ParcelRecord> }` — 60 parcels in 4 cells (15 each); ids include `0026T001A`, `2999A019`, `3512008`; mixes `localProgram` 0/1, `hostable` vs `hostableBase` differences, a density-capped parcel, an uncapped parcel, a parcel with `yield[F−1] ≤ existingUnits`, multi-parcel neighbours in two different cells, and polygons valid for the generator (reuse `src/lib/generator/fixtures/geom.ts` shapes).
  - `miniProjectsJson(): unknown` (a full `projects.json` value with `asOf = dayOf(2026,10,16)`, `qualityRules`) covering every case listed in spec §6 "Fixtures" (`mini-projects.ts` bullets), including one invalid project (rejected per project by `parseProjectsFile` with `onInvalid`, e.g. negative `units`) and a project parcel id not in `miniCity()`.
  - `mini-calibration.json`: passes `parseCalibration`; `asOf = dayOf(2026,10,16)`; all 16 pathway × stage transitions; non-zero revision probabilities at `permitFiled` and `permitIssued` with ratio edges including 1; `phaseGap.days` with ≥ 3 values; initiation terms on `potentialRatio`, `storiesGap` and `landUseClass`, intercept high enough that the mini city yields simulated starts by 2050 for most seeds; `size.byEnvelope` with ≥ 2 buckets.
  - In `input.ts`:
    - `class ScenarioInputError extends Error { file: 'parcels.bin' | 'projects.json' | 'calibration.json' }` (message = first problem).
    - `buildSimInput(files: { parcels: ScenarioParcels; projects: ProjectsFile; calibration: Calibration }, log?: (msg: string) => void): SimInput` — throws `ScenarioInputError` (`calibration.json`) when `calibration.size.fillLevels` differs from `FILL_LEVELS` element by element (A2); `asOf = projects.asOf`; logs one warning when `calibration.asOf !== projects.asOf`.
    - `interface Precompute { hazard: Float64Array; log1mh: Float64Array; sizeCum: Float32Array /* count × F cumulative renormalised probs over levels with yield[f] > existingUnits; row all 0 when none */; parcelIndexOf(id: ParcelId): number /* -1 if absent */ }` and `precomputeOf(input: SimInput, log?: (msg: string) => void): Precompute` — memoised in a module `WeakMap<SimInput, Precompute>` (identity key; no other module state). Only `hostable` parcels get `hazard > 0`. Hazard is forced to 0 when no size level qualifies, and when any term's feature value is non-finite (one aggregated warning: `parcels.bin: hazard 0 for <n> parcel(s) with a non-finite feature; first: <id> <feature>`). Features read `featureValue(p, i, f, 'fzp')` (the twin's view supplies the base columns). Size bucket: first `byEnvelope` entry with `envelopeStories[i] ≤ maxStoriesUpTo`, else the last.

- [ ] **Step 1: Write failing tests** in `input.spec.ts`:
  - `readScenarioParcels(miniBin())` decodes 60 rows equal to `miniCity().parcels` ids.
  - `parseProjectsFile(miniProjectsJson(), { onInvalid })` calls `onInvalid` exactly once and returns every other project; without `onInvalid` it throws.
  - `parseCalibration(miniCalibration)` succeeds.
  - `buildSimInput` with `fillLevels` `[0.25,0.5,0.75,0.9,0.95]` throws `ScenarioInputError` with `file === 'calibration.json'`; with a calibration `asOf` one day off it logs exactly one warning.
  - `precomputeOf(input) === precomputeOf(input)`; a different SimInput object gives a different Precompute.
  - Non-hostable parcels have hazard 0; the parcel with `yield[F−1] ≤ existingUnits` has hazard 0; `log1mh[i]` equals `log(1 − hazard[i])` from `math.ts` bit-for-bit.
  - Review Focus 2: a copy of the mini parcels with `improvementShare[i] = NaN` on one hostable parcel gives `hazard[i] === 0` and exactly one warning naming that id.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Build the fixtures and implement `input.ts`.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(sim): scenario mini fixtures, buildSimInput and per-input precompute`

### Task 4: Engine part 1: stage steps, pipeline rows, revisions; `simulate`

**Files:**
- Create: `src/lib/sim/scenario/engine.ts`, `simulate.ts`, `simulate.spec.ts`, `simulate.incidence.property.spec.ts`

**Interfaces:**
- Consumes: Task 2 `draw`, `P`, `stageRedraw`, `jobEntity`; Task 3 `precomputeOf`; T12 `sampleTransition`, `cumulativeIncidence`, `eventualProbabilities` is NOT to be used for checks (spec: compare with `cumulativeIncidence` only); T1 `monthsIn`, `MONTH_DAYS`.
- Produces:
  - `engine.ts`: `interface Sink { schedule(s: Schedule): void; master(m: Master): void }` and `runEngine(input: SimInput, seed: number, horizon: Day, sink: Sink): void`. (Task 8 may optimise allocation inside the engine; the Sink contract stays.) `nextStage(p: Pathway, s: Stage): Stage` per §4.4.2.
  - `simulate.ts`: `export interface Master` exactly as spec §2 "Internal types"; `simulateDetailed(input, seed, horizon): { schedules: Schedule[]; masters: Master[] }`; `simulate(input, seed, horizon): Schedule[]` (`=== simulateDetailed(...).schedules`, satisfies the step-0 `Simulate` type). Output order: pipeline (origin 'pipeline', phases included) first, then simulated, each sorted by `projectId` (string `<`). Masters sorted by `masterId`.

Behaviour to implement in this task (spec section is authoritative):

- §4.4.2 one stage step, including the in-flight redraw: attempts 0…7 (`draw(seed, entity, 0, P.STAGE, stageIdx)` then `stageRedraw(j)`), each `sampleTransition(t, u_j, monthsIn(e, asOf))`, accept the first with `e + floor(days) > asOf`, else keep the last outcome at `asOf + 1`. `stageIdx` = `STAGE_ORDER` index of the stage being left. `day > horizon` → `{ kind: 'open' }`.
- §4.4.3 pipeline rows (non-multi-phase, and multi-phase rows with `phases === null`, including the score-only master with `parcelIds: []`): skip `stage === 'complete'` and `permitOnly` at `filed`/`entitled` (log the count once per input); `entered` = copy of history with days > `asOf` clamped to `asOf`; `e = history[stage] ?? asOf`; `revisions[0] = { day: min(entered), units, stories }`; `existingUnits`, `multiPhase` copied from T3; `phase: null`; entity `jobEntity(id)`, `k = 0`.
- §4.4.5 revisions on every later future stage entry before `construction` (entering `construction` or `complete` never revises): `draw(…, P.REV, idx(n))` vs `probability` of the first `revision.at` entry for `n`; ratio from `draw(…, P.REV_RATIO, idx(n))`: bin `i` = the slot of u in the cumulative `probs`, ratio = `edges[i] + residual × (edges[i+1] − edges[i])` where residual = u's position within bin i's probability mass. Pipeline units' = `max(1, round(ratio × units))` capped at `max(units, Σ yield[F−1] over its T11 parcels)`; stories per step 4 (null stays null; known: `max(1, round(stories × units'/units))`, upsizing capped at `max(stories, max envelopeStories of its parcels)`). Record only if `units' ≠ units`. Same-day merge per step 6 (replace last entry's units/stories, keep its day; drop it if it then equals its predecessor in both fields).
- A project parcel id absent from T11 contributes 0 to caps and is ignored (Review Focus 1); no throw.

- [ ] **Step 1: Write failing tests** in `simulate.spec.ts` (mini fixtures, horizon `dayOf(2050,12,31)`; pipeline-only assertions here, initiation in Task 5, phases in Task 6):
  - same output across two runs and after `JSON.parse(JSON.stringify(input-files))` re-parsed through `buildSimInput`;
  - every Schedule: future stage days and end days in `(asOf, horizon]`; history days preserved; the project with a missing current-stage day has `entered[stage] === asOf`; the invalid project is absent;
  - revisions: `revisions[0].day === min(entered)`, later ones only on a future stage-entry day, never `≥ entered.construction`, days strictly ascending, units ≥ 1;
  - `permitOnly` schedules never have `entered.filed`/`entered.entitled`;
  - caps: a pipeline upsize never exceeds `max(units, Σ yield[F−1])`; null stories stay null;
  - **same-day merge** (IA-4): with a calibration copy rigged so every transition advances on day 0 of month 1 (`advance[0] = 1`) and revision `probability: 1` with a ratio histogram that maps to a known ratio, every Schedule's revision days are strictly ascending, the merged entry holds the last revision's units and stories, a merge back to the predecessor's values removes the entry, and `packTimedCell(cellId, items)` with footprint massings accepts every Schedule;
  - **in-flight redraw**: a fixture project whose attempt-0 draw lands on or before `asOf` (find a seed where it does, assert that precondition) is accepted at a day > `asOf`; a calibration rigged so the in-flight stage's whole mass sits in the current month before `asOf` (e.g. `months: 1`, `advance: [1]`, project `m = 0` with entry day `asOf − 1`) gives `day === asOf + 1` for every seed; 20,000 synthetic in-flight projects `m` months in match the incidence conditioned on survival to `asOf` within 4·SE (derive the conditional from `cumulativeIncidence`: `(F_j(k) − F_j(m)) / (1 − C(m))`);
  - Review Focus 1: the project with a parcel id absent from T11 is present in the output with its `parcelIds` unchanged;
  - Review Focus 5: a project whose `history.filed` is `asOf + 30` gets `entered.filed === asOf` and its first future event `> asOf`.
  - `simulate.incidence.property.spec.ts`: for each Transition in `mini-calibration.json`, 20,000 synthetic pipeline projects (distinct ids) entering that stage on day `asOf` (history day = `asOf`, `monthsElapsed` 0) with horizon far out (e.g. `asOf + 400 × 365`): simulated cumulative incidence of advance and each exit at months 1, 3, 6, 12, 24, `months`, `months + 12` is within 4·SE of `cumulativeIncidence(t, k)`; and the in-flight cohort `m = 6` months in against the survival-conditional incidence above. No second incidence implementation (use only `cumulativeIncidence`).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `engine.ts` (pipeline path + stage steps + revisions; leave hooks for initiation and phases) and `simulate.ts`.
- [ ] **Step 4: Run** both specs — PASS; lint clean.
- [ ] **Step 5: Commit** `feat(sim): simulate pipeline projects with conditioned stage draws and merged revisions`

### Task 5: Engine part 2: initiation, risk set, demolished once

**Files:**
- Modify: `src/lib/sim/scenario/engine.ts`, `simulate.spec.ts`
- Create: `src/lib/sim/scenario/initiation.property.spec.ts`

**Interfaces:**
- Consumes: Task 3 `Precompute` (`hazard`, `log1mh`, `sizeCum`), `fillStories` (codec), Task 2 `simEntity`.
- Produces: simulated Schedules with `projectId = 'sim:<parcelId>:<k>'`, `origin: 'simulated'`, `multiPhase: false`, `phase: null`, `parcelIds: [parcelId]`.

Behaviour (§4.4.4, §4.4.5 simulated, §4.4.6):

- Risk start per hostable parcel: free at `asOf` → `r = asOf, k = 0`. Held by in-flight projects (pipeline rows, phases, masters; never the score-only master, which holds no parcel) → not at risk until the last holder ends; if any holder completes or stays open (or a master parcel belongs to no phase and the master entitles, or a phase never files) → never at risk; if all holders exit → at risk from the last exit day with `k = 0`. After a simulated exit on day `x` → at risk from `x` with `k + 1`. After a simulated completion or an open end → done.
- Geometric inverse: `T = max(1, ceil(log(1 − u) / log1mh))`, `u = draw(seed, simEntity(id), k, P.INIT, 0)`; day = `r + 1 + floor((T − 1 + v) × MONTH_DAYS)`, `v = draw(…, k, P.INIT_DAY, 0)`; none if day > horizon or hazard 0.
- Pathway: `localProgram` → `'streamlined'`; else `draw(P.PATHWAY)` over normalised `pathwayForNew` in `PATHWAYS` order. First stage: `'preApplication'` if `draw(P.PPA) < ppaShare[pathway]`, else `'filed'` (`'permitFiled'` for `permitOnly`). Size: `draw(P.SIZE)` against the row's `sizeCum`; `units = yield[f]`, `stories = fillStories(FILL_LEVELS[f], envelopeStories)`.
- Simulated revision: `units' = min(yield[F−1], max(existingUnits + 1, round(ratio × units)))`, stories = those of the smallest level with `yield[f] ≥ units'`.
- Demolished once: a parcel is demolished at the first `entered.construction` (any day, also ≤ `asOf`) of any project on it in the run. A later simulated project on it has `existingUnits` 0, and its size rule and downsize floor use 0; the hazard is unchanged.
- Simulated `existingUnits` = T11 `existingUnits[i]` unless demolished.

- [ ] **Step 1: Write failing tests** (append to `simulate.spec.ts`):
  - a `localProgram` parcel's simulated projects are all `'streamlined'`; only `hostable` parcels initiate;
  - risk rules: no simulated project on a parcel after a completion on it; after a simulated exit, the next has id `…:<k+1>` and first day ≥ the exit day + 1; none while an in-flight project holds the parcel (first simulated day > the holder's exit day, or none if it completes/stays open);
  - the size draw never gives `revisions[0].units ≤ existingUnits`; a simulated downsize never goes below `existingUnits + 1`; upsizes never exceed `yield[F−1]`;
  - **demolished once**: a rigged calibration (construction stage exits ~always; high hazard) where a parcel's simulated project exits from `construction` and is re-initiated: the new project's `existingUnits === 0`, and Task 7's `completedNet` (when available; until then assert via the schedules) subtracts the parcel's units once;
  - **score-only master**: it has a Schedule with `parcelIds: []` and blocks no parcel.
  - `initiation.property.spec.ts`: one hostable parcel replicated across 20,000 synthetic parcel ids with a fixed hazard h (bench-style ScenarioParcels built in the test), horizon far out: the first-initiation month distribution `P(T = t) = (1 − h)^(t−1) h` matches within 4·SE for t = 1..12 and the tail `T > 12` (use `exp`/`log` from `math.ts` for the expected values).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS, lint clean.
- [ ] **Step 5: Commit** `feat(sim): simulated initiation, risk set and demolished-once rule`

### Task 6: Engine part 3: multi-phase masters and phases

**Files:**
- Modify: `src/lib/sim/scenario/engine.ts`
- Create: `src/lib/sim/scenario/multiphase.spec.ts`

**Interfaces:**
- Produces: `Master` values from `simulateDetailed` (`entered` holds the Planning-side days including `entitled = E` once entitled, history or drawn or fallback; `phaseUnits`, `phaseFiled` aligned with `phases`); phase Schedules `'<masterId>:phase:<i>'` with `phase: { masterId, index: i, of, start }`.

Behaviour: spec §4.4.3a exactly (master already-entitled rule and `E` fallback; unentitled master runs §4.4.2 steps with `jobEntity(masterId)` and stops on entering `entitled`; exit → no phases; open → none file; `F_i` rules with `g_i = phaseGap.days[floor(u × length)]`, `u = draw(seed, jobEntity(masterId), i, P.PHASE_GAP, 0)`; `F_i > horizon` → no Schedule, `phaseFiled[i−1] = null`; phase `entered` only from `permitFiled`; phase runs fresh steps with `jobEntity(phaseId)`; `existingUnits` = Σ T11 `existingUnits` of its parcels; revisions by the pipeline rule on its own parcels; `revisions[0] = { day: F_i, units, stories: null }`; `phase.start` = `'scheduled'` iff `plannedPermitFiled !== null && plannedPermitFiled > asOf && F_i === plannedPermitFiled`). Risk-set blocking of master and phase parcels as in Task 5.

- [ ] **Step 1: Write failing tests** per spec §6 `multiphase.spec.ts` bullets (all eight), using the mini fixture's entitled 3-phase master (planned after `asOf`, overdue, null), the unentitled 2-phase master (find seeds where its drawn E pushes the planned phase to `E + 1` and assert `start === 'estimated'` there), and a rigged calibration where the unentitled master exits (assert no phase Schedules and `master.end.kind === 'exit'`). Phases "stall and die independently": across 50 seeds, phase end kinds of one master are not all equal in at least one seed.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(sim): multi-phase masters and phase sub-projects`

### Task 7: Score (T8)

**Files:**
- Create: `src/lib/sim/scenario/score.ts`, `score.spec.ts`

**Interfaces:**
- Consumes: Task 4/6 `simulateDetailed` output; `M1_TARGETS`, `Target` (`src/lib/scoreboard`); `ProjectsFile`.
- Produces:
  - `monthsOf(asOf: Day, horizon: Day): Day[]`; `monthIndexer(months: Day[], horizon: Day): (d: Day) => number` (O(1) day→index table for `months[0] ≤ d ≤ horizon`; `idx(d)` per §4.3).
  - `type NetSeries = { completedNet: Int32Array; completedNetNew: Int32Array; entitledNew: Int32Array }`.
  - `shownSeries(run: { schedules: Schedule[]; masters: Master[] }, asOf: Day, horizon: Day, months: Day[]): TimelineScore['shown']` and `netOf(shown: TimelineScore['shown']): NetSeries`.
  - `planEffectOf(fzp: NetSeries, twin: NetSeries): TimelineScore['planEffect']`.
  - `phasingOf(projects: InFlightProject[], asOf: Day): TimelineScore['phasing']` (seed-independent; table in §4.5; `drawn = parcelIds.length > 0`).
  - `RHNA_DEADLINE = dayOf(2031, 1, 31)`; `targetsOf(baselineUnits: number, shown, targets = M1_TARGETS): TargetProgressAt[]`.
  - `REFERENCES: TimelineScore['references']` (the three rows of §4.5 verbatim: ids, labels, units 39000/14646/8504, `from`/`by`, `measure`, tier-1 provenance with the URLs and `method` carrying the source wording "beyond what existing zoning might produce" / "over the next 20 years", and stating the inferred dates for the Controller rows).
  - `assembleScore(p: { months; shown; planEffect; planEffectBand; band; baseline: ProjectsFile['rhnaCompletedNet']; phasing; targets?: readonly Target[] }): TimelineScore` (baseline passed through as `{ completedNet: units, since, provenance }`).

Series rules: §4.5 tables (completed split by origin, phases are pipeline; −existingUnits at `idx(construction)` only when construction > `asOf`; `entitledNew` net, simulated only, after `asOf`, units of the revision current on the entitled day; `inProgress[s]` at snapshot instant `T_i`; `exitedUnits` exits after `asOf`; master bucket rules incl. unfiled phases in `inProgress.entitled` and master-exit units to `exitedUnits`).

- [ ] **Step 1: Write failing tests** per spec §6 `score.spec.ts` bullets: hand-built Schedules/Masters with known days give exact per-month deltas for every series (including net `entitledNew`, `planEffect`, the master bucket's `inProgress` and `exitedUnits`, no double count master vs phases); `monthsOf(dayOf(2026,10,16), dayOf(2050,12,31))` has length 291, first `dayOf(2026,10,1)`, last `dayOf(2050,12,1)`; an event on 2026-10-20 counts at i = 0, on 2026-11-01 at i = 1, on 2050-12-31 in the last entry; no subtraction for construction ≤ `asOf`; target fractions `(baseline + completedNet) / units` uncapped with deadline `dayOf(2031,1,31)`; `REFERENCES` deep-equals the §4.5 table; `phasingOf(mini projects)` counts and `unenriched` order (units desc, then id), score-only master `drawn: false`, others `true`, identical for seeds 1 and 2 (it takes no seed); `completedNet[i] === completedNetPipeline[i] + completedNetNew[i]` on the mini run; the demolished-once case from Task 5 subtracts once.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(sim): time-aware TimelineScore`

### Task 8: `simulateNet`, determinism properties, cross-engine golden

**Files:**
- Modify: `src/lib/sim/scenario/simulate.ts` (and `engine.ts` if needed for allocation)
- Create: `src/lib/sim/scenario/simulate.property.spec.ts`, `simulate.golden.shared.ts`, `simulate.golden.test.ts`, `simulate.golden.svelte.spec.ts`, `fixtures/golden-seed1.json`, `fixtures/build-golden.ts`

**Interfaces:**
- Produces: `simulateNet(input: SimInput, seed: number, horizon: Day, months: Day[]): NetSeries` — a net sink over the same `runEngine`, allocation-light (no Schedule arrays retained; reuse scratch buffers), applying the same merge and demolished-once rule.

- [ ] **Step 1: Write failing tests** in `simulate.property.spec.ts`: for seeds 1..50 on both the FZP mini input and its `baseZoning` twin (Task 9 not yet present: build the twin view inline in the test as `{ ...input, parcels: { ...parcels, envelopeStories: parcels.baseStories, yield: parcels.baseYield, hostable: parcels.hostableBase, localProgram: new Uint8Array(parcels.count), potentialRatio: { fzp: parcels.potentialRatio.base, base: parcels.potentialRatio.base }, storiesGap: { fzp: parcels.storiesGap.base, base: parcels.storiesGap.base } } }`; replace with `baseZoning` in Task 9), `simulateNet` equals `netOf(shownSeries(simulateDetailed(...)))` element-wise on all three series, including the rigged same-day-merge and demolished-once calibrations; adding an unrelated parcel (new id, own cell) or an unrelated project, removing one, and shuffling `projects` order leave every other Schedule deep-equal.
- Golden: `fixtures/build-golden.ts` (run with `npm --prefix <wt> exec -- tsx …`) writes `golden-seed1.json` = `simulate(miniInput, 1, dayOf(2050,12,31))` serialised; `simulate.golden.shared.ts` exports `describeSimulateGolden(where)` asserting deep equality (pattern: `src/lib/timelapse/model.golden.shared.ts`); `.test.ts` runs it in Node, `.svelte.spec.ts` in the browser project. The shared file must build the input without `node:zlib` (use `miniCity().parcels` directly).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**, generate the golden. **Step 4: Run** server + client projects on these files — PASS.
- [ ] **Step 5: Commit** `feat(sim): simulateNet fast path; determinism and cross-engine golden`

### Task 9: `baseZoning` and `applyPolicies` (T9)

**Files:**
- Create: `src/lib/sim/scenario/policy.ts`, `policy.spec.ts`; Modify: `simulate.property.spec.ts` (use `baseZoning`)

**Interfaces:**
- Produces: `type PolicyOp = (cal: Calibration, parcels: ScenarioParcels) => { cal: Calibration; parcels: ScenarioParcels }`; `const baseZoning: PolicyOp` (calibration returned as the same object; parcels view as in the Task 8 inline twin: same typed-array objects, a fresh zero `localProgram` array is the only new buffer); `applyPolicies(ops: readonly PolicyOp[], input: SimInput): SimInput` (a new SimInput object, so precompute keys differ).

- [ ] **Step 1: Write failing tests** per spec §6 `policy.spec.ts`: the view's `envelopeStories === parcels.baseStories`, `yield === parcels.baseYield`, `hostable === parcels.hostableBase`, `potentialRatio.fzp === parcels.potentialRatio.base`, `storiesGap.fzp === parcels.storiesGap.base`, `localProgram` all 0, `cal` is the same object and deep-equal to a pre-call clone; common random numbers: for seeds 1..20 every pipeline and phase Schedule has deep-equal `entered` and `end` in the FZP run and its twin; with base columns set equal to the FZP columns (a test-made parcels copy), `planEffectOf(simulateNet(fzp), simulateNet(twin))` is all 0; calibration edits alone change outcomes: zeroed exit tables (all `exit` arrays 0, tails 0) give no `exit` ends; `initiation.intercept = -1000` gives no simulated projects.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(sim): baseZoning policy op and applyPolicies seam`

### Task 10: Bands and the representative seed

**Files:**
- Create: `src/lib/sim/scenario/band.ts`, `band.spec.ts`

**Interfaces:**
- Produces: `BAND_RUNS = 101`; `bandSeed(i: number): number` = `i + 1`; `nearestRank(sorted: ArrayLike<number>, q: number): number` (= `sorted[ceil(q·n) − 1]`); `quantiles(runs: Int32Array[]): { p10: number; p50: number; p90: number }[]` (per month over the runs given; `[]` when none); `representativeIndex(finals: readonly number[]): number` (sort indices by final value, ties lower index first, take rank `ceil(0.5·n) − 1`, i.e. 50 for n = 101); `createBandState(total = BAND_RUNS)` with `setFzp(i, completedNet)`, `setPair(i, planEffectCompletedNetNew)` (marks pair i done), `fzpCount`, `pairs` (= `bandRuns`), `band()`, `planEffectBand()`, `finals()`.

- [ ] **Step 1: Write failing tests** per spec §6 `band.spec.ts`: hand-made runs give p10 = sorted[10], p50 = [50], p90 = [90] at n = 101 and the nearest-rank values at partial n (n = 16: indices 1, 7, 14); representative with a tie at rank 50 picks the lower index; it uses FZP finals only; `pairs` counts only `setPair` calls; `planEffectBand()` is `[]` before any pair.
- [ ] **Step 2–4:** FAIL, implement, PASS. **Step 5: Commit** `feat(sim): band quantiles and representative seed`

### Task 11: Massing per revision, footprints, memo

**Files:**
- Create: `src/lib/sim/scenario/massing.ts`, `footprint.spec.ts`

**Interfaces:**
- Consumes: `generate`, `generateForUnits`, `fnv1a32` (`$lib/generator`), `MAX_STORIES` (`src/lib/generator/constants.ts`), `localFrame` (`src/lib/generator/geo.ts`), `scenarioRecordOf`, `createLru`, `packTimedCell`, `normaliseRing` (`src/lib/map/pack.ts`).
- Produces:
  - `cellAnchorParcel(ids: ParcelId[], parcels: ScenarioParcels): ParcelId | null` (smallest id present in T11), `footprintParcel(recs: ParcelRecord[]): ParcelRecord` (largest `areaM2`, ties smallest id).
  - `footprintOf(rec: ParcelRecord): { footprint: [number, number][] }` (`polygon[0]` through `localFrame(rec.labelPoint).to`, passed as stored, never closed).
  - `simKey(parcelId, stories)` = `` `s|${parcelId}|${stories}` ``; `pipeKey(seed, units, stories: number | null, ids: ParcelId[])` = `` `p|${seed}|${units}|${stories ?? '-'}|${sortedUniqueIds.join(',')}` ``.
  - `interface MassingCtx { input: SimInput; records: (id: ParcelId) => ParcelRecord | undefined; memo: Lru<string, GeneratedBuilding | null>; gen: typeof generate; genForUnits: typeof generateForUnits; logOnce(projectId: string, msg: string): void }`.
  - `massingFor(schedule: Schedule, k: number, ctx: MassingCtx): Massing` (the one rendering seam, §5): simulated → `{ ...gen(scenarioRecordOf(parcels, i, rec), { maxStories: stories_k }, fnv1a32(rec.id), 'max'), source: 'scenario' }`; pipeline and phase → `{ ...genForUnits(records sorted by id, units_k, stories_k ?? MAX_STORIES, fnv1a32(projectId), stories_k ?? undefined), source: 'pipeline' }`; unphased multi-phase rows (`multiPhase && phase === null`) → footprint, no generator call; null/throw → footprint and `logOnce`. Memoise the generator result (null included) under the key.
  - `massingsFor(schedule, ctx): Massing[]` (index-aligned with revisions).

- [ ] **Step 1: Write failing tests** per spec §6 `footprint.spec.ts` (all bullets) plus Review Focus 4: a `genForUnits` stub that always throws gives footprint entries for every revision of a pipeline project, `packTimedCell` accepts them, and `logOnce` is called once for that project across two `massingsFor` calls and a second memo-cleared ctx with the same logger. The IA-8 bullet: for each simulated revision-0 on an uncapped mini parcel with the real generator, `building.units === revisions[0].units` and `building.stories === revisions[0].stories`; a `gen` spy sees `existingUnits === parcels.existingUnits[i]`. Vertex counts are read from packed `startIndices` and compared with `normaliseRing(ring).length`.
- [ ] **Step 2–4:** FAIL, implement, PASS. **Step 5: Commit** `feat(sim): per-revision massing with footprint fallback and content memo`

### Task 12: Project card (T6)

**Files:**
- Create: `src/lib/sim/scenario/card.ts`, `card.spec.ts`

**Interfaces:**
- Consumes: `DYING_DAYS`; Task 11 `massingFor`; `massingApproximate`, `massedUnits`, `unitsTolerance`.
- Produces:
  - `blockLot(parcelId: ParcelId): string` (`'0026T001A'` → `'Block 0026T, Lot 001A'`, `'2999A019'` → `'Block 2999A, Lot 019'`, `'3512008'` → `'Block 3512, Lot 008'`).
  - `firstDay(s: Schedule): Day`; `isVisible(s: Schedule, day: Day): boolean` (`firstDay ≤ day` and not `end.kind === 'exit' && day − end.day > DYING_DAYS`).
  - `chooseProject(onParcel: Schedule[], day: Day, projectId?: string): Schedule | null` (§4.9 selection).
  - `interface CardCtx { asOf: Day; input: SimInput; rows: Map<string, InFlightProject> /* by id */; masters: Map<string, Master>; qualityRules: Map<string, QualityRuleRef>; building(s: Schedule, k: number): Massing; logOnce(key: string, msg: string): void }`.
  - `projectCard(s: Schedule, day: Day, ctx: CardCtx): ProjectCard` — every field per the §4.9 table (label, units/stories from the latest revision ≤ day with building fallback, `existingUnits = s.existingUnits`, `storiesTier`, `massing`, `stages` with `actual`, phase cards prefixed by the master's Planning-side stages, `revisions` ≤ day, `end` or null, `localProgram`, `sources`, `quality` mapped in id order with unknown ids dropped and logged once).

- [ ] **Step 1: Write failing tests** per spec §6 `card.spec.ts` (all bullets), with exact expected `storiesTier` cases: record stories at revisions[0] → T3 tier; a later scaled revision → 4; null revision stories with a building → 4 and `stories = building.stories`; footprint → `stories: null`, tier `null`, `massing: 'none'`; simulated → tier `null`. Massing rule cases include a hand-made pipeline building with `massedUnits === 0` and units 1 (→ `'approximate'`).
- [ ] **Step 2–4:** FAIL, implement, PASS. **Step 5: Commit** `feat(sim): ProjectCard construction and day-based project choice`

### Task 13: Scenario loading and the error table

**Files:**
- Create: `src/lib/sim/scenario/load.ts`, `src/lib/sim/scenario/scenario-host.ts` (init path only), `src/lib/sim/scenario/test/host-harness.ts`, `scenario-host.load.spec.ts`

**Interfaces:**
- Consumes: `checkManifestShape`, `FetchLike` (`chunks.ts`), `readScenarioParcels`, `ScenarioFormatError`, `parseCalibration`, `parseProjectsFile`, Task 3 `buildSimInput`, Task 9 `applyPolicies`, `baseZoning`.
- Produces:
  - `load.ts`: `validateInitRequest(req): string | null` (seed null or integer in [0, 4294967296), horizon integer, scenario `'fzp'`); `scenarioUrls(m: Manifest): { parcels; projects; calibration } | null` (each must start with `/data/${m.datasetVersion}/`); `fetchWithRetry(...)`, `loadScenario(deps, urls, cancelled: () => boolean): Promise<Loaded | LoadFailure>` where `Loaded = { fzp: SimInput; twin: SimInput; projects: ProjectsFile }` and `LoadFailure = { code: ScenarioErrorCode; message: string }`. Messages exactly: `dataset <v> has no fzp scenario`; `scenario fetch failed: <url> (HTTP <status>)` / `(network)`; `scenario <file>: <first problem>`; one warning `projects.json: skipped <n> invalid project(s); first: <path>: <message>`.
  - `ScenarioHostDeps` exactly as spec §2 (plus optional `warn?(msg: string): void`, default `console.warn`), `createScenarioHost(deps): { handle(req: ScenarioRequest): void; dispose(): void }`.
  - `host-harness.ts`: `makeScenarioHarness(opts?)` with a fake clock (`now`, `setTimeout`, `runAll()`, `advance(ms)`), in-memory `fetch`/`fetchBytes` serving `miniCity()` files and chunks with per-URL failure injection, collected `posts`, and a `warnings` array (model it on `src/lib/sim/test/harness.ts`).

- [ ] **Step 1: Write failing tests** covering every row of the §4.10 table that is about loading, with the exact codes and messages above: bad seed (−1, 1.5, 2³²), non-integer horizon, `scenario: 'x'` → `bad-request`; shape failure → `manifest-invalid`; no `scenarios.fzp` or a URL outside `/data/<v>/` → `scenario-missing`; `ready { rev, datasetVersion, chunkCount }` posted before fetching; the three files fetched concurrently once per init and never on reroll; a `fetchBytes` whose `arrayBuffer()` rejects is retried on `retryDelaysMs` and after the retries gives `internal` with `(network)`; HTTP 404 after retries gives `(HTTP 404)`; corrupt `parcels.bin` bytes give `scenario-invalid` with exactly one fetch; a file-level `projects.json` violation gives `scenario-invalid`; invalid projects are skipped with exactly one warning; a `fillLevels` mismatch gives `scenario-invalid`; `projects.asOf ≥ horizon` gives `bad-request`; `reroll` before loading finished gives `bad-request` `'not initialised'`; after every error the host still accepts a fresh `initScenario`.
- [ ] **Step 2–4:** FAIL, implement (the host posts `ready` and, on success, keeps `Loaded` in its state; timeline posting is Task 14), PASS.
- [ ] **Step 5: Commit** `feat(sim): scenario host loading, validation and error codes`

### Task 14: Timeline delivery, bands, reroll

**Files:**
- Modify: `src/lib/sim/scenario/scenario-host.ts`
- Create: `scenario-host.spec.ts`

**Interfaces:**
- Consumes: Tasks 7–10 (`simulateDetailed`, `simulateNet`, `shownSeries`, `netOf`, `planEffectOf`, `assembleScore`, `phasingOf`, band state). Geometry (Task 15) plugs in through an internal `geometry` object; in this task revision 0 carries `cells: []` and the complete `demolish` list (every parcel of every shown Schedule with `entered.construction`, earliest day per parcel, sorted by parcel id).
- Produces: the §4.7 delivery order, exactly:
  - slices of ≤ 50 ms (by `deps.now()`), separated by `deps.setTimeout(fn, 0)`; other requests are handled between slices;
  - `seed: null`: 101 FZP `simulateNet` runs (seeds `bandSeed(i)`), representative via `representativeIndex`, then revision 0 (band complete, `planEffect`/`planEffectBand` `[]`, `bandRuns` 0), then the shown twin band-only update with `planEffect`, then band twins with a band-only update every 16 pairs and after the last;
  - given seed: revision 0 first (band folded so far or `[]`), then shown twin update, then pairs (FZP + twin per seed);
  - `reroll(seed)`: cancel old seed's geometry and twin work, keep band work; revision 0 under the reroll's rev with the reused band, `planEffect`/`planEffectBand` `[]`, then the twin update with `planEffect` and the reused `planEffectBand`; `reroll(null)` waits until all 101 FZP band runs exist (finishing them first if a seeded init's band is still running) before posting;
  - band-only update `render = { revision: last + 1, cells: [], removedCells: [], demolish: [] }`; `bandRunsTotal = 101` (or `deps.bandRuns`) on every timeline; revisions count per `(rev, seed)`; twin Schedules are never packed or retained.
  - A new `initScenario` or `dispose` cancels everything of the previous one (no post under an old rev afterwards).

- [ ] **Step 1: Write failing tests** per spec §6 `scenario-host.spec.ts` bullets 1–9 and 16 (`deps.bandRuns` may be lowered to 17 in tests to keep them fast, except one test that runs the full 101 and asserts `bandRunsTotal === 101` and the final `bandRuns === 101`), plus Review Focus 3: a `parcelSummary` sent during band slices is answered before the band finishes; `reroll(null)` sent while a seeded init's FZP band runs are incomplete posts its revision 0 only after all of them, and its seed equals `bandSeed(representativeIndex(finals))`; an `initScenario` sent mid-load cancels the first (no `timeline` with the first rev is ever posted). With a null seed, the shown run's final `completedNet` equals the final band p50 (AC 7). Every slice measured with the fake clock is ≤ 50 ms of simulated time (charge each `simulateNet` call a fixed fake cost via the harness clock).
- [ ] **Step 2–4:** FAIL, implement, PASS. **Step 5: Commit** `feat(sim): scenario timelines, progressive bands and reroll`

### Task 15: Geometry streaming, chunks, `parcelSummary`

**Files:**
- Create: `src/lib/sim/scenario/geometry.ts`; Modify: `scenario-host.ts`, `scenario-host.spec.ts`

**Interfaces:**
- Consumes: `createChunkLoader`, `cellsIntersecting`, Task 11 `massingsFor`, `footprintParcel`, `cellAnchorParcel`, `packTimedCell`, `packTimedTransferables`, Task 12 `chooseProject`, `projectCard`.
- Produces: `createGeometry({ input, schedules, records, massingCtx })` with `anchoredCells(): Set<string>`, `cellsFor(cellIds: Iterable<string>): Set<string>` (the extra cells of multi-parcel projects anchored there), `onRecords(cellId, recs)`, `packable(): string[]` (ready anchor cells with new or newly complete projects), `pack(cellId): TimedPackedCell` (every project anchored there whose parcels' cells are all ready; full replacement on repack), `complete(): boolean`, `demolish(): { parcelId; day }[]`, and `schedulesOn(parcelId): Schedule[]`.
  - Host: its own chunk loader per init (`prefetch` → `want(cellsIntersecting(bbox))` plus `cellsFor`); `chunks` responses as the editor's; `retryChunks` → `retryFailed()`; revision 0 packs every ready anchored cell within 2.5 s of the request, the rest follow in later revisions, one message per 50 ms packing slice; `complete` per T6; transfers `packTimedTransferables` of every cell; memo `createLru(deps.memoCap ?? 60_000)` lives across inits and is cleared when an `initScenario` names a different `datasetVersion`; score-only and T11-less projects never packed, no demolish entry.
  - `parcelSummary` (§4.9): `null` when the record is not loaded; else `{ parcelId, neighborhood, landUse, eligible (record), existingUnits (T11), envelope (T11 FZP envelope, null when 0 stories or absent), generated (chosen project's building at the shown revision, else null), project? }`. Errors inside are caught and answered with `summary: null`.

- [ ] **Step 1: Write failing tests** per spec §6 `scenario-host.spec.ts` bullets 10–15 and 17–18 (`complete` tracks packing only; revision 0 has the full `demolish` list, later none; a multi-parcel project waits for all its cells and its anchor cell is repacked in full; the memo hits on reroll (a `generate` spy sees no second call for a pipeline key); memo cleared by a different `datasetVersion`; score-only project never packed and no demolish entry; geometry only for anchors in ready cells; `parcelSummary` with and without `projectId`, and `null` for an unloaded parcel), plus Review Focus 1: a project whose only parcel is absent from T11 is scored but never packed and the host logs it once.
- [ ] **Step 2–4:** FAIL, implement, PASS. **Step 5: Commit** `feat(sim): viewport-driven timeline geometry and project summaries`

### Task 16: Worker router

**Files:**
- Create: `src/lib/sim/router.ts`, `src/lib/sim/worker-router.spec.ts`; Modify: `src/lib/sim/worker.ts`

**Interfaces:**
- Produces: `createWorkerRouter(deps: { editor: { handle(r: SimRequest): void; dispose(): void }; createScenario: () => { handle(r: ScenarioRequest): void; dispose(): void } }): { handle(req: WorkerRequest): void }` — §4.1 routing: `init/load/preview/cancelPreview/commit/undo` → editor; `initScenario/reroll` → scenario (created on first `initScenario`; a `reroll` with no scenario host answers through a lazily created one, which reports `bad-request 'not initialised'`); `prefetch/retryChunks/parcelSummary` → whichever host received the latest `init`/`initScenario` (editor before either); `init` disposes the scenario host's state, `initScenario` disposes the editor's. `worker.ts` builds the editor with `createSimHost` exactly as today and the scenario host with `createScenarioHost({ fetch, fetchBytes: (u) => fetch(u), post, setTimeout, clearTimeout, now: () => performance.now(), retryDelaysMs: same e2e rule })`.

- [ ] **Step 1: Write failing tests** with fake hosts recording calls: each routing rule above, including dispose calls on mode switches and parcelSummary routing before any init.
- [ ] **Step 2–4:** FAIL, implement, PASS; `git -C <wt> diff --stat main...HEAD -- src/lib/sim/host.ts src/lib/sim/display.ts src/lib/sim/client.ts` is empty; existing `host*.spec.ts`, `client.spec.ts`, `display.spec.ts` pass.
- [ ] **Step 5: Commit** `feat(sim): worker router between editor and scenario hosts`

### Task 17: `ScenarioClient`

**Files:**
- Create: `src/lib/sim/scenario-client.ts`, `src/lib/sim/scenario-client.spec.ts`

**Interfaces:**
- Produces: `interface ScenarioWorkerLike` (as `WorkerLike` but `postMessage(msg: WorkerRequest)` and `onmessage: ((e: { data: ScenarioResponse }) => void) | null`) such that `spawnSimWorker()`'s result is accepted by the constructor and `restart` without a cast at the call site (assert with a type-level test); `class ScenarioClient` with `constructor(worker, events: { onReady?; onTimeline?(t: TimelineResponse); onChunks?; onError?(e: Extract<ScenarioResponse, { type: 'error' }>); onCrash?(e: Event) })`, `initScenario(manifest, horizon, seed: number | null = null): Rev` (barrier), `reroll(seed: number | null): Rev` (barrier), `isStale(t: TimelineResponse): boolean` (`t.rev < barrier`), `resync(): void` (one `reroll(currentSeed)` per episode; `currentSeed` = seed of the latest non-stale timeline; no-op without one; the episode ends on a non-stale revision-0 timeline with `rev ≥` the resync rev or an error answering it), `parcelSummary(parcelId, day, projectId?): Promise<ParcelSummary | null>`, `prefetch(bbox)`, `retryChunks()`, `restart(worker)`, `dispose()`, `crashed`, `datasetVersion`. Never resyncs on `error`.

- [ ] **Step 1: Write failing tests** per spec §6 `scenario-client.spec.ts` bullets with a fake worker (pattern: `src/lib/sim/client.spec.ts`).
- [ ] **Step 2–4:** FAIL, implement, PASS. **Step 5: Commit** `feat(sim): ScenarioClient`

### Task 18: Bench and budgets

**Files:**
- Create: `src/lib/sim/scenario/fixtures/synth-city.ts`, `src/lib/sim/scenario/scenario.bench.spec.ts`

**Interfaces:**
- Consumes: `synthParcels` (`src/lib/generator/fixtures/synth.ts`), host bench layout (`src/lib/sim/host.bench.spec.ts`: 150,360 parcels in 16×16 cells).
- Produces: `synthCity(): { parcels: ScenarioParcels; projects: ProjectsFile /* 2,000 synthetic pipeline projects across stages, incl. multi-parcel and 5 phased masters */; calibration: Calibration /* tuned to ≈ 8,000 initiations by 2050; assert 6,000–10,000 at seed 1 */; manifest; chunks }`.

- [ ] **Step 1: Write the bench** asserting each §4.11 budget: `simulateNet` median ≤ 15 ms (over 21 runs after 3 warm-ups); `simulateDetailed` + `shownSeries` ≤ 80 ms median; `initScenario(null)` from fetched files to the first timeline with no chunks ready ≤ 3 s; `reroll` → revision 0 ≤ 3 s (warm and cold, all 256 cells ready); shown twin update ≤ 200 ms after revision 0; all 101 pairs ≤ 4 s after revision 0; longest macrotask (host handler or timeout callback, wall clock) ≤ 50 ms during band, twin and geometry work; heap growth (`process.memoryUsage().heapUsed` delta after `global.gc` when available) ≤ 300 MB with 256 cells loaded after 3 rerolls. Use real timers (`setTimeout`, `performance.now`).
- [ ] **Step 2: Run** `vitest run --project server src/lib/sim/scenario/scenario.bench.spec.ts`. Profile and optimise the engine/host (allocation, typed arrays, avoiding per-month closures) until every budget passes. Record the measured numbers in the task report.
- [ ] **Step 3: Commit** `test(sim): scenario bench budgets`

### Task 19: Historical replay (pipeline)

**Files:**
- Create: `pipeline/test/simulate-replay.test.ts`

**Interfaces:**
- Consumes: `simulate`; `ProjectHistory` (T4d); `pipeline/lib/fzp-cal/aalen-johansen.ts` (`ajSweep`/`ajTable`) and `spells.ts` (`buildSpells`, window rules) for the observed side.

- [ ] **Step 1: Write the test** per spec §6 "Pipeline": cohorts (Planning-side per `(pathway, stage)` with n ≥ 50 entered ≥ 2015-01-01; permit-side pooled per stage from 2007-01-01 with left truncation), each history converted to an in-flight starting state at stage entry, 20 seeds, simulated projects censored at their own `lastObserved` or the snapshot, Aalen–Johansen comparison, pass bar max |Δ| ≤ max(0.03, 2.5·SE). Two describe blocks: (a) **live**: reads `pipeline/.cache/derived/<datasetVersion>/project-histories.json` and the matching `calibration.json` from the pipeline build output; `describe.skipIf(!exists)` with the reason printed; (b) **synthetic**, always runs: histories sampled from `mini-calibration.json`'s own tables (n = 2,000 per cohort, random censoring), so the replay machinery itself is exercised in CI.
- [ ] **Step 2: Run** `vitest run --project pipeline pipeline/test/simulate-replay.test.ts` — the synthetic block PASSes; report whether the live block ran.
- [ ] **Step 3: Commit** `test(pipeline): historical replay through simulate`

---

**Deferred, by design:** `e2e/fzp-sim.spec.ts` is "with fzp-mode" (spec §6) and needs the `/fzp` page, which fzp-mode (wave 4) builds. It is reported to the conductor as fzp-mode's to add, with this module's acceptance items listed. The Chromium half of AC 1 is covered here by `simulate.golden.svelte.spec.ts`.
