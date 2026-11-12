# Funded starts, the queue and the pools (`finance-engine`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task (a fresh implementer and a fresh reviewer per task). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the engine public money: per-attempt funded latent starts, the application line and its award rule, pool accounting with a ledger, certain projects that never exit, the schedule and card funding fields, `buildSimInput` running the baseline funding on the private-starts level, and the same results on the net fast path, within F18's budgets.

**Architecture:** `runEngine` keeps its pipeline and multi-phase passes and branches once in the simulated pass: without `input.finance` it runs today's `simulatedPass` untouched; with it, `fundedPass` (new `funded.ts`) walks each lot eagerly while its ordinary start comes first, parks the rest, and runs a day loop over inflows, money events, re-pricing, applications, the line and ordinary starts. Pure pieces live apart: `funding.ts` (arrivals, validation, the finance index, coverage levels, the award rule), `money.ts` (pool state and the ledger), `line.ts` (the line: a single scan, then grouped bisection). `engine.ts` gains `Job.certain` and the certain stage step on `sampleAdvance`.

**Tech Stack:** TypeScript (worker-safe, no `Math.exp`/`Math.log` in the engine: `src/lib/timelapse/math.ts`), Vitest (server, client, perf, pipeline projects), Playwright (one assertion updated).

**Spec:** `docs/superpowers/specs/2026-11-09-finance-engine-design.md` (binding; includes reappraisal 2, section 11). Design: `docs/superpowers/design/2026-11-09-1911-sim-financing.md` ("Dependency order", "How a release is built", "Global constraints", "Reappraisal 1", "Reappraisal 2"). The spec's `file:line` anchors predate Release 1 and the paired-draw fix: find code by symbol. Anchors below are at base `1e74b191`.

## Escalations needed

None. No interface row (F1 to F12, F18) needs a change to build this. Every F9/F10 declaration this plan fills already exists: `SimInput.finance?` (`src/lib/sim/scenario/types.ts`, `SimInput`), `Schedule.kind?`/`funding?`, `ProjectCard.kind?`/`funding?` (same file) and `Sink.ledger?`, which lives in `src/lib/sim/scenario/engine.ts:53-75`, not in `types.ts` as the spec's section 1 item 4 says. Internal discrepancies are resolved below as builder's calls, and the partner questions are under "Open questions".

## Global Constraints

From spec section 3 and the dispatch. Every task is bound by all of them.

- **Interfaces.** This branch produces F9, F10, F11, F18, `inflowArrivals` of F5, and F3's `marketLevel` body. It consumes F1 to F8 and F12 unchanged. A needed change to a shared row is an escalation, not a task.
- **No public money means no change.** With `finance` absent, the engine's output is identical, schedule for schedule, to its output before `finance-engine` under the same `market`. `golden-seed1.json` and `model-golden.json` are not regenerated. They are the lock.
- **Deterministic and paired.** A run is a pure function of (dataset, levers, seed). No draw purpose changes from what the paired-draw fix leaves (`STAGE` 6, `STAGE_TIME` 12; 17 to 23 retired). This branch adds only `INIT_AFFORDABLE: 7` and `INIT_DAY_AFFORDABLE: 10`. A lot's draws never depend on lot order. Nothing draws a kind and a time from one number. A certain project's stage time comes from `P.STAGE_TIME`.
- **Release boundary.** The branch may change fixture inputs. It must NOT regenerate `golden-seed1.json`, `model-golden.json`, `pipeline/test/fixtures/mini/golden/**`, the lesscars goldens or `e2e/fixtures/data/fixture-0`. It must not run `npm run pipeline -- fixture`, `build`, `upload` or `verify`. `src/lib/sim/scenario/fixtures/golden-finance-seed1.json` is NEW and is written on this branch by its builder (Task 11). `pipeline/test/fixture-funding.test.ts` is written here (Task 10). The final task lists every golden or fixture comparison that fails because of this change, with its reason.
- **Lock tests.** An `Assert<Equals>` lock or value lock (`rng.spec.ts`) that fails on a field or purpose this spec adds is edited by exactly that change, in the same commit.
- **Hashed paths.** Every new file is under `src/lib/sim/scenario` or `src/lib/timelapse`, which are already in `PATHS` (`pipeline/lib/version.ts:42-53`). No new path. If one is ever added, it also goes in `chreode.config.ts` and `.github/workflows/pipeline.yml`.
- **Terms.** `lossOnExit` and every `ResolvedTerms` term are `number | null`. A null `lossOnExit` fails `checkFinance`.
- **Validation text.** The messages of spec 4.2 are exact (Task 2 lists them).
- **Vitest.** `expect.requireAssertions` is on: every test calls `expect`.
- **Perf (F18).** Bench cases live in `scenario.bench.spec.ts` and run with `npm run test:perf`, only on a quiet machine. Otherwise record ballpark numbers. Perf never blocks a task.
- **Commits.** Conventional Commits. Multi-line messages go in a file, committed with `git commit -F <file>`, then the file is deleted. NO Claude attribution anywhere (no `Co-Authored-By`, no generated-with footers). No push, no PR, no signoff.
- **Shell.** Run every command from the worktree root `/Users/mindlace/Projects/sfhousing/.claude/worktrees/finance-engine`. Never `cd X && cmd`.
- **Style.** 2-space indent, single quotes, no trailing commas, 100 columns.
- **Engine arithmetic.** Use `exp`/`log` from `src/lib/timelapse/math.ts` only (`logistic(x) = 1 / (1 + exp(-x))`). Use `projectDollars` (`Math.round`) for every per-home to project-dollar conversion. Use `CERTAIN_TOLERANCE` (1e-9) as the only tolerance.
- **Docs.** Spec section 8 (Task 14).

## Review Focus

These are the five inputs the spec implies but no spec test reaches, most likely to bite first. Each has a test in its owning task.

1. **A lot's next attempt after a funded project demolished it.** Attempt k + 1 must size against 0 existing units (`sizeCumAgainst`), in every view, exactly as `simulatedProject` would. A stale per-view size from attempt k would price the wrong prototype. Test in Task 7.
2. **Coincident change days.** A programme's `to + 1`, an `off` entry's `from` and a regime day can fall on one day D. The waiting line must be re-made once on D, against the bundle just before D, not twice, and the segment list must hold D once. Test in Task 8.
3. **Available money exactly equal to the ask.** A pool is short only when `available < ask`, so equality is awarded. A `<=` slip would starve exact-fit fixtures. Test in Task 3.
4. **Zero-day stages.** A project can enter construction, or exit, on its award day. Commit, spend, loss and release must then come out in spec 4.7's within-day order on that day, and a same-day release must re-serve the line. Test in Task 4 (treasury) and Task 7 (engine).
5. **A lot with hazard 0 in view 0 that is a candidate only through a regime view.** Its `logit` is `−Infinity`, so `z + m + shift` must give rate 0 there and never NaN. Its funded latents must start only in the regime's months, and a `T_ref` of 0 must give the capped `keyDay` (2^28). Test in Task 5.

---

## Builder's calls (made here; each has a one-line reason)

- **`Precompute.logit` is the unshifted linear predictor** `z = initiationLogit(model, features)` per row, `−Infinity` where `hazard` is 0. The spec's "`ln(h) − ln(1 − h)`" would include the `asOf` market shift `s0` that `precomputeOf` folds into `hazard` (`src/lib/sim/scenario/input.ts:355-356`), and spec 4.4 then adds `m_j` again. Reason: `z + m_j` is then exact and never double-counts.
- **The ordinary start is always computed by today's code path**, `initiationMonth` on `Precompute.segments` (`engine.ts:903-923`). It is never recomputed on the finer finance segments. The market kind's funded rate per finance segment is `min(ordinaryRate_j, log(1 − logistic((z + m_j) + shift)))`, and `ordinaryRate_j` is used as-is when the bundle is empty. Reason: summing a segment's months in more pieces can move `acc` by an ulp, which would break "eager attempts give exactly today's schedules". The `min` keeps the market latent "never later" bit for bit.
- **The market kind's `keyDay` is `start(T_O)`**, with `T_O` the ordinary month from today's path, not cut by the horizon. Reason: spec 4.4 defines it as "the ordinary start's month".
- **The `engine.ts` ↔ `funded.ts` import cycle is allowed.** `funded.ts` reads no `engine.ts` binding at module evaluation time, only inside functions. Reason: today's engine code stays where it is, so the no-change lock is easy to review.
- **`checkFinance` memoises the finance-only checks by `input.finance` identity.** The `affordableRoutes` check runs on every call. Reason: that check reads the calibration, which the finance identity does not fix.
- **Test-only engine entry:** `runEngineWith(input, seed, horizon, sink, opts)` in `engine.ts`, with `opts.serving: 'scan' | 'grouped'` and `opts.probe` (see Task 7). Reason: Sink is row F10 and gains no member.
- **`fundedRunStats()`** in `funded.ts` returns the last run's `{ firstDayApplications, awards }`, from module-level counters overwritten each run. Reason: bench case 6 counts applications, and no schedule shows one that waits.
- **Spec 6's `engine-finance.spec.ts` is split into three files:** `engine-finance.spec.ts` (Task 7), `engine-finance-repricing.spec.ts` (Task 8) and `engine-finance-stack.spec.ts` (Task 9). Reason: each reviewer reads one file.
- **`tiny-queue.ts` builds its own five-row `ScenarioParcels`.** It copies five hostable rows of `miniCity().parcels` column by column, then overwrites the yields, envelope and one feature column. The spec says "with `mini-bin.ts`'s helpers", but `mini-bin.ts` exports only `miniBin()`. Reason: no helper exists to reuse.

## Open questions (partner)

- **Q-A. A page sentence becomes false.** After Task 10 the sources dialog's "All starts" line still ends "Not in force until public funding is modelled." (`src/lib/fzp/provenance.ts:230-238`), which is false once funding is modelled. The spec changes only `marketLevel`'s body. **Recommendation:** `funding-ui` owns the wording. This plan updates the tests to the new level and leaves the copy alone.
- **Q-B. Host bench cases 4 and 5 need a plan input with the bench funding set.** Only `finance-levers` can produce one, through the host. **Recommendation:** on this branch, run cases 4 and 5 with plan and twin both on `benchBaseline()` (through the bench calibration's `baselineFunding`). Rerun them with `benchFunding()` on the plan once `finance-levers` lands. Record both in `docs/dev/finance-engine.md`.
- **Q-C. A partly covered latent month can straddle a change day.** Its application day `r + 1 + floor((T − 1 + v) × MONTH_DAYS)` can fall after a programme end or an `off` start inside the month. It then joins with its month's bundle (spec 4.3: "a month's bundle is the bundle of its first day"), without being re-made. **Recommendation:** keep the spec's letter. This plan does that. A later ruling could re-make such an application on joining.

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/lib/sim/scenario/rng.ts`, `rng.spec.ts` | purposes 7 and 10 | 1 |
| `src/lib/timelapse/model.ts`, `model.test.ts` | `sampleAdvance` | 1 |
| `src/lib/sim/scenario/funding.ts` (new), `funding.spec.ts` (new) | `inflowArrivals`, `PIPELINE_FUNDED`, `checkFinance`, `FinanceIndex`, `isOff`, levels, `PoolState`, `available`, pricing memo, `leaveOut`, `awardSet` | 2, 3 |
| `src/lib/sim/scenario/fixtures/tiny-queue.ts` (new) | `tinyStack` (Task 3); the five-lot city `tinyQueue` (Task 7) | 3, 7 |
| `src/lib/sim/scenario/money.ts` (new), `money.spec.ts` (new) | `Treasury`: pool state, inflows, award commits, project money events, ledger order | 4 |
| `src/lib/sim/scenario/test/finance-harness.ts` (new) | `checkLedger` (Task 4), `runCollect` (Task 7) | 4, 7 |
| `src/lib/sim/scenario/input.ts`, `input.spec.ts` | `Precompute.logit`, `parcelRankOf` (Task 5); `finance` in `buildSimInput` (Task 10) | 5, 10 |
| `src/lib/sim/scenario/funded.ts` (new), `funded.spec.ts` (new) | `financePreOf`, `attemptLatents`, `lineKey` (Task 5); `fundedPass` (Tasks 7, 8, 12, 13) | 5, 7, 8 |
| `src/lib/sim/scenario/fixtures/mini-finance.ts` (new) | `miniFinance()`, `miniCalibrationWithRoutes()` | 5 |
| `src/lib/sim/scenario/line.ts` (new), `line.spec.ts` (new) | the `Line` interface, `scanLine` (Task 6), `groupedLine` (Task 12) | 6, 12 |
| `src/lib/sim/scenario/engine.ts` | `Job.certain`, certain stage step, `pathwayFrom`, `startSimulated`, `runEngine` branch, `runEngineWith` | 7 |
| `src/lib/sim/scenario/engine-finance*.spec.ts` (new) | engine behaviour | 7, 8, 9 |
| `src/lib/sim/scenario/fixtures/bench-finance.ts` (new) | `benchRoutes` (Task 7); `benchBaseline`, `benchFunding` (Task 13) | 7, 13 |
| `src/lib/sim/scenario/card.ts`, `card.spec.ts` | `kind`, `funding` on simulated cards | 9 |
| `src/lib/sim/scenario/market.ts`, `market.spec.ts` | `marketLevel` body | 10 |
| `src/lib/fzp/provenance.spec.ts`, `e2e/fzp.spec.ts` | assertions on the level now in force | 10 |
| `pipeline/test/fixture-funding.test.ts` (new) | fixture-0 makes a funded start | 10 |
| `src/lib/sim/scenario/simulate.property.spec.ts` | `simulateNet` with finance | 11 |
| `src/lib/sim/scenario/simulate.finance.golden.{cases,shared}.ts`, `.golden.test.ts`, `.golden.svelte.spec.ts`, `fixtures/build-finance-golden.ts`, `fixtures/golden-finance-seed1.json` (all new) | the finance golden | 11 |
| `src/lib/sim/scenario/scenario.bench.spec.ts` | F18 cases | 13 |
| `docs/dev/finance-engine.md` (new), `CLAUDE.md`, `docs/dev/{lesscars,testing,sim-levers,market}.md` | docs | 14 |

---

### Task 1: Draw purposes and `sampleAdvance`

**Files:**
- Modify: `src/lib/sim/scenario/rng.ts:15-30` (comment and `P`)
- Modify: `src/lib/sim/scenario/rng.spec.ts:26-35` ("keeps purpose ids distinct")
- Modify: `src/lib/timelapse/model.ts` (beside `sampleTime`, around line 294)
- Test: `src/lib/timelapse/model.test.ts` (new `describe('sampleAdvance')` after `describe('sampleTime')`)

**Interfaces:**
- Produces: `P.INIT_AFFORDABLE = 7`, `P.INIT_DAY_AFFORDABLE = 10`; `export function sampleAdvance(t: Transition, u: number): { days: number }`.

- [ ] **Step 1: Write the failing tests.**
  - `rng.spec.ts` "keeps purpose ids distinct": keep the existing `STAGE` 6, `STAGE_TIME` 12, `INIT` 1 and `PHASE_GAP` 11 expectations. Add `expect(P.INIT_AFFORDABLE).toBe(7)`, `expect(P.INIT_DAY_AFFORDABLE).toBe(10)`, and the remaining unchanged values (`INIT_DAY` 2, `PATHWAY` 3, `PPA` 4, `SIZE` 5, `REV` 8, `REV_RATIO` 9). The distinctness check stays. Change the loop to reject only `id >= 17 && id <= 23`, and drop the "7 and 10 are reserved" comment. This is the one lock edit.
  - `model.test.ts` `describe('sampleAdvance')`:
    - (a) For every transition of `fixtures/calibration-small.json` and 10,000 seeded `(uKind, u)` pairs (`mulberry32`), `sampleAdvance(t, u).days === sampleTime(t, 'advance', u, 0)` wherever `sampleTime` does not throw. Also `=== sampleTransition(t, uKind, u, 0).days` whenever that call's kind is `'advance'`. Assert the "advance" branch was hit more than 1,000 times.
    - (b) A hand-built transition with `advance` all 0 in the table and `tail.advance: 0` (exits only) returns `{ days: Math.ceil(MAX_EVENT_MONTH * MONTH_DAYS) - 1 }` for u = 0 and u = 0.999. `MAX_EVENT_MONTH` is not exported: recompute it in the test as `Math.floor(16777216 / MONTH_DAYS)`.
    - (c) `u = -0.1` and `u = 1` throw `RangeError('u must be in [0, 1), got -0.1')` (and `got 1`), on one transition of (a) and on (b).
    - (d) `Number.isInteger(days)` for every call in (a) and (b).

- [ ] **Step 2: Run them and see them fail.**
Run: `npx vitest run --project server src/lib/sim/scenario/rng.spec.ts src/lib/timelapse/model.test.ts`
Expected: FAIL (`P.INIT_AFFORDABLE` undefined; `sampleAdvance` not exported).

- [ ] **Step 3: Implement.** Add the two purposes to `P`. Reword the comment: 17 to 23 are retired and never reused, and 7 and 10 are the affordable latent's (F11). Implement `sampleAdvance` per spec 4.18:
  1. `checkUniform(u, 'u')` first.
  2. Then the no-mass test, exactly the condition under which `sampleTime(t, 'advance', u, 0)` throws: `advance` is `kinds[0]` of `tailOf`. With `t.months === 0`, test `tc.shares[0] > 0`. Otherwise test `colsOf(t, c).inf[0] > 0` (the column starts at 0). No mass returns `{ days: Math.ceil(MAX_EVENT_MONTH * MONTH_DAYS) - 1 }`.
  3. Otherwise return `{ days: sampleTime(t, 'advance', u, 0) }`. Never call `sampleTime` and catch its error.
  - Do not add `sampleAdvance` to `model.golden.shared.ts`. `src/lib/timelapse/types.test.ts` needs no edit: it is a new export and changes no locked signature.

- [ ] **Step 4: Run the tests and see them pass, then the lock suites.**
Run: `npx vitest run --project server src/lib/sim/scenario/rng.spec.ts src/lib/timelapse/model.test.ts src/lib/timelapse/model.golden.test.ts src/lib/timelapse/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.** `git add` the four files, then `git commit -m "feat(sim): affordable draw purposes and sampleAdvance"`

---

### Task 2: Arrivals, `PIPELINE_FUNDED` and validation

**Files:**
- Create: `src/lib/sim/scenario/funding.ts`, `src/lib/sim/scenario/funding.spec.ts`
- Modify: `src/lib/sim/scenario/engine.ts:297-299` (`runOf`: call `checkFinance` after `checkInput` when `input.finance` is present)

**Interfaces:**
- Consumes: `Inflow`, `Pool`, `Programme`, `Provenance` (`src/lib/timelapse/types.ts`); `validateInstrument`, `missingTerms` (`src/lib/sim/finance`); `isoOf` (`./dates`).
- Produces:
  - `export function inflowArrivals(inflow: Inflow, asOf: Day, horizon: Day): Day[]`, ascending.
  - `export const PIPELINE_FUNDED: Provenance` (the spec 4.13 literal).
  - `export function checkFinance(input: SimInput): void`, which throws `RangeError`.

- [ ] **Step 1: Write the failing tests in `funding.spec.ts`.**
  - `inflowArrivals`:
    - A `once` inflow on `asOf` gives `[asOf]`. One on `asOf - 1` gives `[]`. One on `horizon + 1` gives `[]`.
    - `yearly` from `dayOf(2024, 2, 29)`, `to: null`, asOf `dayOf(2024, 1, 1)`, horizon `dayOf(2028, 3, 1)` gives the days of 2024-02-29, 2025-02-28, 2026-02-28, 2027-02-28 and 2028-02-29.
    - `yearly` from `dayOf(2020, 7, 1)` with asOf `dayOf(2022, 1, 1)` starts at 2022-07-01.
    - `to` is inclusive: from 2026-07-01, to 2028-07-01, gives 3 arrivals.
    - `to` before the next anniversary gives 1.
  - `PIPELINE_FUNDED` is `toEqual` to the spec 4.13 literal, verbatim. Write the literal in the test, including `’` in "simulation’s".
  - `checkFinance`: one `it` per row of spec 4.2. Each builds a valid finance from `tinyFinanceValid()`, a local helper (two capped pools, one uncapped `federal`, one grant per pool reaching `market`, `slope: 3`, `terms: resolveTerms()`, `off: []`). Then it breaks exactly one thing and asserts `toThrow(new RangeError(<exact text>))`. The exact texts, with `<…>` filled from the broken value:
    - `finance.slope must be a finite number of 0 or more; got -1` (also `got NaN`)
    - `finance.pools[1].id p-a is repeated` (the second occurrence's index)
    - `finance.programmes[1].id g-a is repeated`
    - `finance.programmes[0].pool nope names no pool`
    - `finance.pools[2] (fed): an uncapped pool has no inflows`
    - `finance.pools[0] (p-a): leverage must be a finite number above 0; got 0`
    - `finance.pools[0].inflows[0]: dollars must be a whole number of 0 or more` (for `dollars: 1.5`, and for `dollarsPerYear: -1` on a yearly inflow)
    - `finance.pools[0].inflows[0]: to is before from`
    - `finance.programmes[0] (g-a): to 2026-01-01 is before from 2026-01-02` (dates via `isoOf`)
    - `finance.pools[0] (p-a): debt is required for a goBond or cop pool`
    - `finance.pools[0] (p-a): debt must be null for a generalRevenue pool`
    - `finance.pools[0] (p-a): debt.rate must be above 0 and at most 0.25; got 0.3`
    - `finance.pools[0] (p-a): debt.termYears must be a whole number from 1 to 40; got 41`
    - `finance.programmes[0] (g-a): minHomes must be a whole number from 0 to 10000` (for 10001 and for 2.5)
    - `finance.programmes[0] (g-a): A grant pays more than 0% and at most 100% of the uncovered cost.` (share 0, using `validateInstrument`'s text)
    - `finance.programmes[0] (g-a): guarantee needs guaranteeRateCut, which is not sourced` (a guarantee with `resolveTerms()`, where `guaranteeRateCut` is null)
    - `finance.terms.lossOnExit must be between 0 and 1; got null` (also `got 1.5`)
    - `finance.off[0].pool nope names no pool`
    - `finance.off[0] (p-a): to 2026-01-01 is before from 2026-01-02`
    - `finance: the calibration has no affordableRoutes, but programme g-a reaches affordable projects`. Check this one on `newProjects.calibration` when present (a routes-less `newProjects.calibration` beside a routed `calibration` throws), else on `calibration`.
  - Engine wiring: `runEngine(goldenInput() + bad finance, 1, GOLDEN_HORIZON, sink)` throws the slope message, and the sink's `schedule`, `master` and `ledger` were never called. Also `checkFinance` called twice on one input does the finance checks once: spy on `validateInstrument` through `vi.spyOn` on the module namespace, or assert with a counter in a wrapped finance getter.

- [ ] **Step 2: Run them and see them fail.**
Run: `npx vitest run --project server src/lib/sim/scenario/funding.spec.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement.**
  - `inflowArrivals`: UTC month and day stepping by year. Use `dayOf`/`isoOf` arithmetic from `./dates`, or `Date.UTC` with the day of month clamped to 28 for Feb 29 in common years. Filter to `asOf ≤ d ≤ horizon` (and `≤ to`).
  - `checkFinance`: checks run in spec 4.2's table order, and within a check by index. Pool and debt bounds are F5's. `minHomes` uses `Number.isInteger` and the range 0 to 10,000. The instrument check is `validateInstrument`. The term check is `missingTerms(inst, terms)[0]`. `lossOnExit` must be `typeof === 'number'` and in [0, 1]. Memoise with a `WeakSet` keyed by the `finance` object, and run the routes check on every call.
  - In `runOf`, after `checkInput(input)`: `if (input.finance) checkFinance(input)`.

- [ ] **Step 4: Run them and see them pass, and confirm the golden is untouched.**
Run: `npx vitest run --project server src/lib/sim/scenario/funding.spec.ts src/lib/sim/scenario/simulate.golden.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(sim): inflow arrivals, PIPELINE_FUNDED and the finance input check"`

---

### Task 3: The finance index, coverage levels and the award rule

**Files:**
- Modify: `src/lib/sim/scenario/funding.ts`, `src/lib/sim/scenario/funding.spec.ts`
- Create: `src/lib/sim/scenario/fixtures/tiny-queue.ts` (finance part: `tinyStack`)

**Interfaces:**
- Consumes: `fundBundle`, `isCertain`, `CERTAIN_TOLERANCE`, `projectDollars`, `prototypeFor`, `PROTOTYPES`, `type BundleFunding`, `type PrototypeId` (`src/lib/sim/finance`).
- Produces (all exported from `funding.ts`):
  - `interface FinanceIndex { finance: NonNullable<SimInput['finance']>; poolOf: Map<string, number>; progPool: Int32Array; progPoolKind: PoolKind[]; capped: Uint8Array /* by pool */; offSpans: [Day, Day][][] /* by pool, sorted by from; to null → Infinity */; price(kind: ProjectKind, set: readonly number[], protoId: PrototypeId): BundleFunding }`
  - `financeIndexOf(finance): FinanceIndex`, memoised by finance identity. `price` is memoised per (kind, set, prototype id), and the affordable kind ignores the prototype. Key: a string of kind, prototype id (market only) and the programme indices joined by `,`. That is a builder's call: a 64-bit bitset is the spec's optional speed-up, and `finance-model` allows at most 24 added programmes plus the baseline.
  - `isOff(f: FinanceIndex, pool: number, d: Day): boolean`
  - `isOffered(f: FinanceIndex, prog: number, d: Day): boolean`: active (`from ≤ d`, `to` null or `d ≤ to`) and its pool not off.
  - `coverageLevel(c: number): number` (`isCertain(c) ? 1 : c`) and `below(x: number, y: number): boolean` (`x < y - CERTAIN_TOLERANCE`).
  - `interface PoolState { received: number; committed: number; spentGrant: number; outLoan: number; lostLoan: number; lostGuarantee: number }`; `newPoolState(): PoolState`; `available(pool: Pool, s: PoolState): number` (`Infinity` when `pool.uncapped`).
  - `interface Award { set: number[]; priced: BundleFunding; asks: Map<number, number> }` (asks for capped pools only, whole dollars).
  - `asksOf(f, kind, set, protoId, units): Map<number, number>`. Each item contributes `projectDollars(granted) + projectDollars(lent) + projectDollars(reserve)` to its pool, and a pool asked 0 is omitted.
  - `leaveOut(bundle: readonly number[], kind: ProjectKind, protoId: PrototypeId, units: number, avail: (pool: number) => number, f: FinanceIndex): { set: number[]; rounds: number }`. `rounds` counts the rounds that removed pools.
  - `awardSet(bundle, kind, protoId, units, avail, f): Award | null`, the spec's signature.
- `tiny-queue.ts`:
  - `export function tinyStack(o: TinyStackOpts): NonNullable<SimInput['finance']>`.
  - `TinyStackOpts`: `{ asOf: Day; state?: Inflow[]; city?: Inflow[]; cityTo?: Day | null; bond?: { share: number; from: Day; to?: Day | null; inflows: Inflow[] }; off?: { pool: string; from: Day; to: Day | null }[]; minHomes?: number; slope?: number }`.
  - Pools: `t-fed` (`federal`, uncapped), `t-state` (`state`), `t-city` (`generalRevenue`), and `t-bond` (`goBond`, `debt { rate: 0.04, termYears: 30 }`) when `bond` is set.
  - Programmes, in this order: `t-fed`, `t-state`, `t-city`, `t-bond-grant`. All are affordable grants with shares `443108 / 861525`, `118390 / 861525` and `300027 / 861525` (test values, tier 1 dollars over the tier 2 total). `tiers` is `{ veryLow: 0.5, low: 0.5, moderate: 0, aboveModerate: 0 }`. `minHomes` defaults to 1.
  - `terms: resolveTerms()`, default `slope: 3`. Default inflows are ample: `yearly` 10^12 from `asOf`.

- [ ] **Step 1: Write the failing tests (`funding.spec.ts`).** Let U = `uncoveredPerHome('affordable', PROTOTYPES[0])` = 861,525 and u = 10 homes. `idx(id)` is the programme index.
  - Levels: `coverageLevel(1 - 5e-10) === 1`, `coverageLevel(0.5) === 0.5`. `below(0.5, 0.5 + 5e-10)` is false, and `below(0.5, 0.5 + 2e-9)` is true.
  - `isOff`: two overlapping entries of one pool mean their union. `to` is inclusive, and `to: null` means forever. A pool with no entry is never off.
  - `available`: `leverage × received − committed − spentGrant − outLoan − lostLoan − lostGuarantee` on a hand state with leverage 0.8. An uncapped pool gives `Infinity`.
  - **Bond in the City tier.** `price('affordable', [fed, state, city, bond])` with bond share 0.5 has coverage within 1e-9 of 1. City `granted` is close to 123176.65 and bond `granted` close to 176850.35 (`toBeCloseTo(_, 2)`). City plus bond is close to 300027.
  - **City short, bond 0.5.** `t-city`'s avail is `asks.get(city) - 1` and the others are ample. `awardSet` gives set `[fed, state, bond]` and `priced.certain === true`. The bond item's `granted` is close to 300027, and `asks.get(bondPool) === projectDollars(300027, 10)` within the per-item rounding.
  - **City short, bond 0.2.** `awardSet` returns `null`. `leaveOut` gives set `[fed, state, bond]`, whose coverage is close to 0.852 (`(443108 + 118390 + 172305) / 861525`).
  - **Bond short.** Set `[fed, state, city]`, certain.
  - **Exact fit (Review Focus 3).** With every capped pool's avail exactly equal to its ask, `awardSet` returns the whole bundle. With one dollar less on `t-city`, `t-city` leaves.
  - **Cascade across tiers.** A local finance with shares federal 0.5, state 0.3 and City 0.5. City pays 0.2 U. `t-state` is short. `t-city`'s avail lies between `projectDollars(0.2U, u)` and `projectDollars(0.5U, u) - 1`. `leaveOut` gives `{ set: [fed], rounds: 2 }`, and `awardSet` gives `null`.
  - **Cascade within a tier.** Federal and state together cover 0.652. Two City pools have share 0.4 each, so each pays 0.174 U pro rata. One has avail below 0.174 U·u; the other has avail between 0.174 U·u and 0.348 U·u. `leaveOut` gives `{ set: [fed, state], rounds: 2 }`, and `awardSet` gives `null`.
  - **Loan short while coverage is above 1.** Add a City-tier loan `{ costShare: 1, rate: 0, requiredReturn: 0.01 }` on a capped `t-loan` pool with avail 0. B's coverage is above 1. `awardSet` gives set `[fed, state, city]`, certain.
  - **All short.** B = `[state, city]`, both short: `null`.
  - **Empty or zero.** `awardSet([], …)` is `null`. B = `[zero-coverage loan]` (rate 0.25, no `requiredReturn`) on a short pool is `null`.
  - **Monotone property** (500 seeded random bundles over `tinyStack` pools plus a random loan and guarantee, random money and units 1 to 200). If `awardSet` is null at money a, it is null at every a′ ≤ a, pool by pool. The set at a′ is a subset of the set at a. A larger size never passes where a smaller one fails. Re-pricing `fundBundle` on the set gives the same `priced` bit for bit, so the memo order is sound.

- [ ] **Step 2: Run them and see them fail.** `npx vitest run --project server src/lib/sim/scenario/funding.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** per spec 4.6:
  - S₀ = B. Each round prices S, finds every capped pool with `avail(q) < ask_S(q)`, and removes every programme of every short pool at once. It stops when none is short, or when S is empty.
  - Award when S is non-empty and `!below(coverageLevel(S.coverage), coverageLevel(B.coverage))`.
  - Always pass items to `fundBundle` in `finance.programmes` order.

- [ ] **Step 4: Run them and see them pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(sim): finance index, coverage levels and the award rule"`

---

### Task 4: Pool state, money events and the ledger (`money.ts`)

**Files:**
- Create: `src/lib/sim/scenario/money.ts`, `src/lib/sim/scenario/money.spec.ts`, `src/lib/sim/scenario/test/finance-harness.ts`

**Interfaces:**
- Consumes: Task 2's `inflowArrivals`; Task 3's `FinanceIndex`, `PoolState`, `available`, `Award`, `isOff`.
- Produces:
  - `export type LedgerEvent = Parameters<NonNullable<Sink['ledger']>>[0]`.
  - `export class Treasury`:
    - `constructor(f: FinanceIndex, asOf: Day, horizon: Day, lossOnExit: number, emit: ((e: LedgerEvent) => void) | null, wake: (day: Day) => void)`. It precomputes the arrivals of capped pools, drops those on off days, and calls `wake` for each arrival day.
    - `readonly state: PoolState[]`
    - `available(pool: number): number`
    - `receive(day: Day): boolean`: step 1. It returns true when any dollars arrived.
    - `award(day: Day, a: Award, units: number, s: Schedule): void`: step 3. It emits the `commit`s in programme order, takes the asks, and schedules the project's later events, calling `wake` for each event day.
    - `settle(day: Day): { any: boolean; returned: boolean }`: step 2. It processes the events dated `day` of projects awarded so far, in award order, and within a project `spend`, `repay`, `loss`, `release`, each by programme order. `returned` is true when a `release` or `repay` raised `available`.
- `test/finance-harness.ts`: `checkLedger(events: LedgerEvent[], finance, probe?: { after: number; available: number[] }[]): void`. It asserts E1 to E7 of spec 4.7 after every event. When `probe` is given, it also asserts that E4's recomputed `available` equals the engine's value after each event.

- [ ] **Step 1: Write the failing tests (`money.spec.ts`).** Build hand schedules, `Schedule` literals with `entered`, `end` and `revisions[0].units = 10`, and awards from `awardSet` on a finance with one grant pool, one loan pool (`costShare: 0.6, rate: 0.04`) and one guarantee pool (`costShare: 0.5, reserve: 0.1`; terms typed `guaranteeRateCut: 0.01`).
  - **Event table.** For each instrument × {completion, exit before construction, exit after construction} × λ ∈ {1, 0.5}, assert the full event list (`day`, `pool`, `programme`, `kind`, `dollars`) against spec 4.7's table:
    - A grant loss is `Math.round(λG)`.
    - A loan exiting after construction gives `loss round(λP)` and then `repay P − round(λP)`.
    - A guarantee's loss is `min(round(λQ), H)` with Q = `projectDollars(item.guaranteed, 10)`, followed by `release H`.
    - Nothing is emitted after the horizon, and no event has 0 dollars.
  - **Within-day order.** One day has two arrivals, on pools in `finance.pools` order, then two projects' events, then a new award's commits: `in`, `in`, A's `spend`/`repay`/`loss`/`release`, B's events, then the commits.
  - **Zero-day stages (Review Focus 4).** The schedule enters construction on its award day and exits that day. The events are `commit`, then `spend`, then `loss`, then `release`, all on that day. `settle` after the award returns `returned: true` when a release happened.
  - **Off days.** An arrival on an off day emits nothing and leaves `received` unchanged.
  - **Optional emit.** With `emit: null`, the pool states equal the emitting run's, step for step.
  - **The harness.** `checkLedger` passes on all of the above and fails on a hand-broken list (a `release` larger than the `commit`).

- [ ] **Step 2: Run them and see them fail.** `npx vitest run --project server src/lib/sim/scenario/money.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `money.ts` and the harness.
- [ ] **Step 4: Run them and see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(sim): pool state and the funding ledger"`

---

### Task 5: The latents of an attempt

**Files:**
- Modify: `src/lib/sim/scenario/input.ts` (`Precompute` interface 77-124, `precomputeOf` 313-413; new `parcelRankOf`)
- Create: `src/lib/sim/scenario/funded.ts`, `src/lib/sim/scenario/funded.spec.ts`, `src/lib/sim/scenario/fixtures/mini-finance.ts`
- Test: `src/lib/sim/scenario/input.spec.ts` (logit, rank)

**Interfaces:**
- Consumes: `piecewiseMonth`, `regimeMonths`, `lastInitiationMonth`, `sizeCumAgainst`, `precomputeOf`, `regimeInputsOf` (`input.ts`); `P`, `drawOn`, `streamOf`, `seedHash` (`rng.ts`); Task 3's `FinanceIndex`, `coverageLevel`, `isOffered`; `oddsShift`, `uncoveredPerHome`, `costPerHome`, `prototypeFor` (finance); `FILL_LEVELS`, `fillStories`.
- Produces:
  - `Precompute.logit: Float64Array`: the unshifted `z` per row, `−Infinity` where `hazard` is 0 (builder's call above). Per view through `pre.regimes[v - 1].logit`.
  - `export function parcelRankOf(ids: readonly ParcelId[]): Uint32Array`, memoised by the id array (a `WeakMap`, as `entityOf`), using JS `<` order.
  - In `funded.ts`:
    - `interface FinancePre`, memoised per input. It holds:
      - `days: Day[]`: the merged change days greater than `asOf`. These are the precompute segment days plus every programme's `from` and `to + 1` and every `off` entry's `from` and `to + 1`, deduplicated and ascending.
      - Per finance segment j: `view[j]`, `ordSeg[j]` (index into `Precompute.segments`), `m[j]` (the market step's log-odds in force on the segment's start day), and `offered[κ][j]: number[]` (the programmes of kind κ offered on the segment's start day: `asOf + 1` for j = 0, else `days[j − 1]`).
      - `reached: ProjectKind[]`, the kinds some programme reaches.
      - `rank: Uint32Array`.
    - `financePreOf(input: SimInput): FinancePre`.
    - `interface KindLatent { kind: ProjectKind; T: number; day: Day | null; keyDay: Day; view: number; f: number; units: number; stories: number; protoId: PrototypeId; bundle: number[]; level: number }`. `day` is null for "no application".
    - `interface AttemptLatents { uO: number; vO: number; uA: number; vA: number; uS: number; TO: number; O: Day | null; Oview: number; size: ({ f: number; units: number; stories: number; protoId: PrototypeId } | null)[] /* by view */; market: KindLatent | null; affordable: KindLatent | null }`
    - `export function attemptLatents(input: SimInput, seed: number, horizon: Day, row: number, k: number, r: Day, existing: number): AttemptLatents`: the test-facing form. Internally `latentsOf(run, fp, row, entity, k, r, existing, stream)` does the work. `O` is cut by the horizon only. The reservation cut is the pass's.
    - `respell(…, kind, D): KindLatent | null`: the new spell after a lapse (Task 8 calls it). It uses r′ = D − 1 and the same u and v.
    - `export function lineKey(keyDay: Day, rank: number, kind: ProjectKind): number` = `min(keyDay, 2^28) × 2^20 + rank × 2 + (kind === 'affordable' ? 1 : 0)`. It throws `RangeError` if `rank ≥ 2^19`. Applications compare `applied` first, then `lineKey`.
  - `mini-finance.ts`: `miniFinance()` and `miniCalibrationWithRoutes()`, exactly as spec 6 "Fixtures" (`m-city`, `m-bank`, `federal`; affordable stack `m-city` 0.35 plus `federal` 0.65 with `minHomes: 2`; the market loan; the market guarantee; `resolveTerms(MARKET_TERMS, { guaranteeRateCut: 0.01 })`; `slope: 3`; `off` on `m-bank` from `asOf + 2000` to `asOf + 2400`). The routes are `{ discretionary: 0.3, streamlined: 0.67, permitOnly: 0.03 }` with a tier 4 provenance. All are test values. The file stays browser-safe: no `node:` imports.

**Algorithm (spec 4.4, with the builder's calls above):**
- Draws are on `s = streamOf(sh, entity, k)`: `uO = P.INIT`, `vO = P.INIT_DAY`, `uA = P.INIT_AFFORDABLE`, `vA = P.INIT_DAY_AFFORDABLE`, `uS = P.SIZE`, all at index 0.
- Size per view v: the first f with `uS < cum_v[f]`, where `cum_v` is the view's `sizeCum` row, or `sizeCumAgainst(viewInput, i, existing)` when `existing !== parcels.existingUnits[i]` (as `simulatedProject`). Then `units = yield_v[i·F + f]`, `stories = fillStories(FILL_LEVELS[f], envelopeStories_v[i])`, and the prototype is `prototypeFor(stories, units)`.
- Per finance segment j and kind κ: the bundle is `offered[κ][j]` filtered by `minHomes ≤ units_v`. It is empty when the view has no size or `hazard_v[i] === 0`.
- Funded rate: `−Infinity` when the bundle is certain; 0 when there is no size or no hazard. Otherwise:
  - market: `min(ordRate_j, log(1 − logistic((z_v + m_j) + shift)))`, with `ordRate_j` itself when the bundle is empty;
  - affordable: `log(1 − logistic(z_v + m_j − slope × (uncovered('affordable', p) − uncovered('market', p)) ÷ cost('affordable', p) + shift))`;
  - where `shift = bundle empty ? 0 : oddsShift(priced.grantEquivalent, κ, p, slope)`.
- `T_κ = piecewiseMonth(log(1 − u), regimeMonths(r, fp.days), rates)`, with `u = uO` for market and `uA` for affordable.
- The day is `start(T) = r + 1 + floor((T − 1) × MONTH_DAYS)` in a certain month, else `r + 1 + floor((T − 1 + v) × MONTH_DAYS)`. It is an application when T ≠ 0, the day ≤ horizon, and the month's bundle is non-empty.
- `keyDay`: market uses `start(T_O)`; affordable uses `start(T_ref)` on the unshifted affordable rates. T = 0 caps at 2^28.
- `O` and `Oview` come from today's `initiationMonth`/`initiationDay` arithmetic on `Precompute.segments`, without the `skipAbove` shortcut.

- [ ] **Step 1: Write the failing tests.**
  - `input.spec.ts`:
    - `logit[i]` equals `initiationLogit` of the row's features for every hostable sized row, and `−Infinity` where `hazard` is 0.
    - With `market: [{ from: asOf, logOdds: -0.7 }]`, `logit` is unchanged while `hazard` moves.
    - `parcelRankOf(ids)` sorts like `[...ids].sort()` and returns the same array object for the same `ids` array.
  - `funded.spec.ts` (on `goldenInput()` with `finance: miniFinance(asOf)`, seeds 1 to 20, every candidate row, k = 0, r = `asOf`):
    - **Ordinary unchanged.** `O` equals the first-attempt start day in today's `simulate(goldenInput())` for every unheld candidate that starts, and is null for the rest.
    - **Market never later.** `market.T === 0 || (TO !== 0 && market.T <= TO)`, and `market.day <= O` whenever both exist.
    - **Certain month on its first day.** Every affordable latent with `level === 1` has `day === r + 1 + Math.floor((T - 1) * MONTH_DAYS)`.
    - **No bundle, no application.** With every programme's `to < asOf`, every latent has `day === null`.
    - **Purposes.** Shifting `uA` (a copy of `P` is not possible, so instead compare `attemptLatents` on seeds 1 and 2): `market` depends only on `uO`/`vO`, and `affordable` changes while `O` does not.
    - **`lineKey`.** It orders by keyDay, then rank, then market before affordable. A `keyDay` of `2 ** 28 + 5` equals one of `2 ** 28`. Rank `2 ** 19` throws.
  - **Review Focus 5.** Build a regime view in which one row has hazard 0 in view 0 but a finite logit in the regime (from `engine-regimes.spec.ts`'s pattern), with the regime from `asOf + 400`. Its affordable latent has `day > asOf + 400` or null, and no field of the latent is NaN. A row whose unshifted affordable rates are all 0 has `keyDay === 2 ** 28`.

- [ ] **Step 2: Run them and see them fail.** `npx vitest run --project server src/lib/sim/scenario/funded.spec.ts src/lib/sim/scenario/input.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Expose `initiationMonth`/`initiationDay`'s arithmetic for reuse without changing them. Export `Run`, `newJob`, and a `runOf` variant from `engine.ts` as needed, all marked `@internal`.
- [ ] **Step 4: Run them and see them pass, and the golden too.** `npx vitest run --project server src/lib/sim/scenario/funded.spec.ts src/lib/sim/scenario/input.spec.ts src/lib/sim/scenario/simulate.golden.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(sim): funded latent starts of an attempt"`

---

### Task 6: The line, by single scan (`line.ts`)

**Files:**
- Create: `src/lib/sim/scenario/line.ts`, `src/lib/sim/scenario/line.spec.ts`

**Interfaces:**
- Consumes: Task 3's `Award`; Task 5's `lineKey`.
- Produces:
  - `export interface App { lot: number; kind: ProjectKind; applied: Day; key: number; bundle: number[]; bundleKey: string; protoId: PrototypeId; units: number; level: number; view: number; f: number; stories: number; keyDay: Day; seq: number /* internal */ }`
  - `export type AwardTest = (g: { kind: ProjectKind; bundle: readonly number[]; protoId: PrototypeId }, units: number) => Award | null`
  - `export interface Line { readonly size: number; add(app: App): void; remove(app: App): void; regroup(app: App): void; apps(): App[]; serve(test: AwardTest, take: (app: App, a: Award) => void): number }`
    - `add` requires non-decreasing `(applied, key)` and throws otherwise.
    - `apps()` returns the waiting applications in key order.
    - `serve` does one pass and returns the number of awards.
  - `export function scanLine(): Line`: the definition (spec 4.6 "Serving"). It walks in key order, tests each application against the money at that moment, calls `take` at once for a pass (which removes it, and the caller removes the lot's other application), skips a failure, and ends at the end of the line.

- [ ] **Step 1: Write the failing tests (`line.spec.ts`).** Use a fake `AwardTest` over a mutable money map: pass when `units × perHome ≤ money[pool]`, and `take` deducts.
  - Applications are served in (applied, key) order.
  - A head that does not fit is skipped, and a later, smaller one is awarded in the same pass.
  - A later application whose bundle leans on another pool is awarded past a waiting head.
  - `take` removing a lot's second application mid-pass does not award it.
  - `remove` and `regroup` keep the order.
  - `add` out of order throws.
  - `serve` returns the award count.
- [ ] **Step 2: Run them and see them fail.** `npx vitest run --project server src/lib/sim/scenario/line.spec.ts`
- [ ] **Step 3: Implement** `scanLine`: an array in key order with lazy deletion, compacted when more than half of it is deleted.
- [ ] **Step 4: Run them and see them pass.** Same command.
- [ ] **Step 5: Commit.** `git commit -m "feat(sim): the application line, served by a single scan"`

---

### Task 7: `fundedPass`: eager phase, day loop, awards, money and reservations

**Files:**
- Modify: `src/lib/sim/scenario/engine.ts`. The `Job` interface (342-363) and `newJob` (365-380) get `certain`. `stageStep` (499-514) gets the certain branch. `newPathway` (878-893) becomes `pathwayFrom(w, stream)`. `simulatedProject` (933-995) is split. `runEngine` (1093-1099) branches. Add `runEngineWith`.
- Modify: `src/lib/sim/scenario/funded.ts` (`fundedPass`)
- Modify: `src/lib/sim/scenario/fixtures/tiny-queue.ts` (the city: `tinyQueue`)
- Create: `src/lib/sim/scenario/fixtures/bench-finance.ts` (`benchRoutes()` only)
- Modify: `src/lib/sim/scenario/test/finance-harness.ts` (`runCollect`)
- Create: `src/lib/sim/scenario/engine-finance.spec.ts`

**Interfaces:**
- Consumes: Tasks 2 to 6.
- Produces:
  - `Job.certain: boolean`, false in `newJob`. Every project set-up assigns it explicitly: `simulatedProject` sets false, a certain funded project sets true.
  - `stageStep` when `job.certain`: `step.kind = 'advance'` and `step.day = e + Math.floor(x × sampleAdvance(t, drawOn(job.stream, P.STAGE_TIME, idx)).days)`, with the same `t` and `x` as today. `P.STAGE` is not read. A certain job's `rule` is `NONE` (no revisions).
  - `function pathwayFrom(w: Record<Pathway, number>, stream: number): Pathway`, with `newPathway(cal, s) = pathwayFrom(cal.pathwayForNew, s)` and the same arithmetic.
  - `function startSimulated(run, job, i, stream, k, day, existing, view, f, pathway: Pathway | null, certain: boolean): Schedule`. `pathway` null means draw it as today. `simulatedProject` = its size draw plus `startSimulated`, value-identical.
  - `export function runEngineWith(input, seed, horizon, sink: Sink, opts: { serving?: 'scan' | 'grouped'; probe?: (e: LedgerEvent, available: readonly number[]) => void }): void` (test-only). `runEngine` uses the default serving: `'scan'` until Task 12, then `'grouped'`.
  - `export function fundedPass(run: Run, holds: Holds, sink: Sink, opts): void`, and `export function fundedRunStats(): { firstDayApplications: number; awards: number }`.
  - Schedule fields for funded starts (spec 4.12): `kind: 'affordable'` when κ is affordable. `funding: { programmes, applied, granted, lent, guaranteed, displaced, certain }`:
    - `programmes`: S's programmes with exact per-home `granted`, `lent` or `guaranteed` above 0, in `finance.programmes` order.
    - The dollars: Σ `projectDollars` over S's items at the start units, where `guaranteed` is the private principal.
    - `certain`: `coverageLevel(S.coverage) === 1`.
    - `displaced`: the ordinary start O's units in O's view minus e, when O exists, is ≤ horizon, is before a kept reservation day, and its size gives a level; else 0.
    - Ordinary starts in a finance run carry neither field.
  - `tinyQueue(o?: { logOdds?: number[]; units?: number[]; existing?: number[]; reservedFrom?: Day[] }): SimInput`: five rows with ids `TINY_IDS` (in parcel-id order, so rank equals index), no pipeline projects, and a calibration that is the mini calibration with `initiation = { intercept: 0, terms: [one term on a feature whose bins give each row its log-odds] }`. Set the yields so each row has one gaining level (units by row).
  - `benchRoutes()`: `{ discretionary: 16/53, streamlined: 36/53, permitOnly: 1/53 }` plus a tier 4 provenance.
  - `runCollect(input, seed, horizon, opts?)`: returns `{ schedules (sorted by projectId), ledger: LedgerEvent[], reservations: Map<number, boolean>, probes }`.

**Algorithm sketch (spec 4.1, 4.5, 4.8, 4.9, 4.10, 4.11 "Reservations").** The day loop is a calendar of days (a binary heap with deduplication). Each day's bucket holds application lots, ordinary-start lots, attempt lots and reservation lots, and the bucket also wakes for treasury days.

```
eager: per candidate as simulatedPass (holds, blocked, reservation void by holdVoids, at-risk r, demolished)
  attempt k: lat = latentsOf(...); drop app days >= d while kept; A = earliest app day
    if A == null or (O != null and A > O): today's attempt on O (simulatedProject, sink, void/demolish, exit → k+1)
    else park lot (state: k, r, e, demolished, d, reserved, stream, lat) → calendar(A_market, A_affordable, O, d)
loop, day D ascending (asOf..horizon):
  1 treasury.receive(D)   2 treasury.settle(D)
  3 (Task 8: re-pricing) ; reservation day D of a parked lot: its waiting apps leave for good
  4 day-D applications of unstarted lots, sorted by (applied, key) → line.add
  5 if 1–4 did anything: repeat { line.serve(test, take); r = treasury.settle(D) } while r.returned
     take: lot leaves every line; build project (stream s, id sim:<id>:<k>, pathway: LP lot → streamlined,
       certain affordable → pathwayFrom(newCal.affordableRoutes), else newPathway; size of app's view/f;
       job.certain = level(S) === 1) ; set kind/funding ; treasury.award ; sink.schedule ; post-start
  6 ordinary starts dated D of unstarted parked lots, by parcel rank: leave every line; simulatedProject; post-start
  7 attempts dated D (exits): latents k+1 from r = D (apps and O are > D) → calendar
  post-start(s): if d > 0 and (s.end not exit or exit day >= d) d = 0; demolished if construction entered;
                 exit on x → attempt k+1 at x; else lot done
close: sink.reservation for every reserved candidate exactly once; reservationsOff(run, holds, sink, candidates)
```

Reservations are kept as today (`engine.ts:1067-1073`). While a reservation is kept, no application is made on or after d and no award happens on or after d. On day d every waiting application of the lot lapses with no new spell.

- [ ] **Step 1: Write the failing tests (`engine-finance.spec.ts`).** Use `runCollect` throughout, and run `checkLedger` on every run with a ledger.
  - **No public money means no change.** For `goldenInput()` and seeds 1 to 50, compare variants with regimes (`engine-regimes.spec.ts`'s builder), with `reservedFrom`, and with `newProjects` timers (scale 0.5 on two stages). Let R be the run with `finance` absent. These all deep-equal R:
    - `finance: { pools: [], programmes: [], off: [], slope: 3, terms: resolveTerms() }`;
    - `miniFinance` with every programme's `to = asOf - 1`;
    - `miniFinance` with every pool off from `asOf`, `to` null.
    - No schedule has `kind` or `funding`, and with every pool off the ledger has no `in` event.
  - **Moneyless pools change nothing.** `tinyStack` with `state`, `city` and `bond` inflows `[]`, and the `t-fed` programme removed so that no award can pass: schedules deep-equal the no-finance run on `tinyQueue()` and on the mini city, seeds 1 to 20. This exercises parking and the day loop's ordinary starts.
  - **Conservation** (property: 200 seeded random finances on the mini city and on `tinyQueue`). `checkLedger(ledger, finance, probes)` holds after every event, `available ≥ 0` after every `commit`, and E4 equals the probe's value.
  - **Determinism and lot order.** Two runs are identical. The mini city with its parcel rows permuted (same ids; reuse `simulate.property.spec.ts`'s "reordering the parcel rows" helper) gives the same schedules, sorted by `projectId`, and the same ledger.
  - **The plan and the twin share draws.** `miniFinance` plus a capped pool with no inflows and a grant on it (City tier, affordable) gives schedules identical to `miniFinance` alone.
  - **Certain projects keep their counterpart's stage times.** This is spec 6 test 4's case, verbatim:
    - Mini city, `market: []`, seeds 1 to 20, horizon 2050-12-31.
    - Run B: one uncapped `federal` pool, a market grant of share 1, `minHomes: 1`, from `asOf`.
    - The compared stages are those with the same pathway and first stage in both runs whose A-project advances within the horizon. Equal days in each.
    - The test fails if there is no compared stage.
    - Repeated with `newProjects: { calibration, scale }`, scale 0.5 on each compared (pathway, stage): equal again, and B's days are `Math.floor(0.5 * d)`.
  - **Unlimited money, a 100% grant.** `synthCity()` with its calibration given `affordableRoutes: benchRoutes()`, `market: []`, one uncapped pool and an affordable grant of share 1 with `minHomes: 1`, seeds 1 to 5, horizon 2050-12-31.
    - Every lot that is at risk at `asOf` and whose drawn size qualifies is awarded on its application day.
    - Commit order equals line-key order.
    - None of these projects exits.
    - Over the certain affordable applicants not on Local Program lots, each pathway's share is within 3 standard errors of its route share.
  - **Queue cases on `tinyQueue` with `tinyStack`** (exact days and orders; derive the expected keys with `attemptLatents`):
    - Applications are served by applied day, then `keyDay`, then parcel id.
    - A smaller later application is awarded past a head that does not fit.
    - On a day where a lot's ordinary start equals its market application, the funded start wins when the money suffices (a funded schedule, no ordinary schedule for that k), and the ordinary start wins when it does not.
    - A waiting lot's ordinary start removes it from the line with no `commit`.
    - A release on an exit before construction is re-served the same day: the next commit is on that day.
    - A kept reservation lapses its applications on its day, and no `commit` falls on or after it.
  - **Ledger and certainty.** Over 20 seeds of `miniFinance`, no schedule with `funding.certain` exits or has more than one revision.
  - **`displaced`.** On `tinyQueue`:
    - a lot whose ordinary start is before the horizon reports units − existing;
    - one whose ordinary start is after the horizon reports 0;
    - a reserved lot whose ordinary start is after the reservation day reports 0.
  - **Pipeline rows.** No pipeline schedule carries `funding`, and every `commit`'s project is simulated (map `commit` days to awards through `funding.applied`/`entered`).
  - **Review Focus 1.** On `tinyQueue`, a funded market project with λ = 1 enters construction and then exits (choose the seed by search in the test and assert one exists). Attempt k + 1's size equals what `simulatedProject` draws with existing 0, and its `existingUnits` is 0.
  - **Review Focus 4 (engine).** A certain project whose first stage takes 0 days (a hand transition with all advance mass at month 0) has `commit` then `spend` on its award day in the ledger.
- [ ] **Step 2: Run them and see them fail.** `npx vitest run --project server src/lib/sim/scenario/engine-finance.spec.ts`
- [ ] **Step 3: Implement** the engine hooks first. Then run `npx vitest run --project server src/lib/sim/scenario/simulate.golden.test.ts src/lib/sim/scenario/engine-regimes.spec.ts src/lib/sim/scenario/engine-market.spec.ts src/lib/sim/scenario/pairing.property.spec.ts` and confirm it passes before writing `fundedPass`.
- [ ] **Step 4: Run the task's tests and the whole scenario folder.** `npx vitest run --project server src/lib/sim/scenario src/lib/timelapse`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(sim): funded starts, the line and the pools in the engine"`

---

### Task 8: Re-pricing, lapse and regimes

**Files:**
- Modify: `src/lib/sim/scenario/funded.ts` (step 3 of the day loop; `respell`)
- Create: `src/lib/sim/scenario/engine-finance-repricing.spec.ts`

**Interfaces:**
- Consumes: Task 5's `respell` and `FinancePre.days`; Task 6's `Line.apps`/`regroup`/`remove`.
- Produces: the re-pricing days. These are the days after `asOf`, up to the horizon, in `{ programme from, to + 1 } ∪ { off from, to + 1 } ∪ regime days`, computed once per input in `FinancePre.repricing`.

**Rule (spec 4.11).** On re-pricing day D, walk the line in key order. Re-make each application under day D's rules:
- the view in force on D;
- the attempt's size draw in that view (with e);
- B′ = the offered programmes of its kind with `minHomes ≤ units`;
- priced with `f.price`.

It lapses when B′ is empty, when the view has no size or zero hazard, or when `below(level(B′), level(B))`. B is the bundle just before D. A lapsed application leaves the line, and `respell(lot, kind, D)` may give a new application on a day ≥ D (on D it joins in step 4). Otherwise it keeps `applied` and `keyDay`, takes B′, its view, size and prototype, and is `regroup`ed. Serving runs on re-pricing days.

- [ ] **Step 1: Write the failing tests.**
  - **A programme opening later.** `tinyStack` with `t-city` spent (inflow `[]`, no inflow for two years) and `t-bond-grant` from `asOf + 365`, share 0.5, ample money.
    - The first-day applications wait.
    - On `asOf + 365` their `applied` and `keyDay` are unchanged and their order is unchanged (snapshot `line.apps()` through a probe, or compare `funding.applied === asOf + 1` on the funded schedules).
    - The first ones in line get a `commit` that day, with `t-bond-grant` in `funding.programmes`.
  - **A programme ending.** Ending `t-city`'s programme (`cityTo`) lapses its waiting applications on `to + 1`. Each re-spells (a new `applied ≥ to + 1`), on the federal and state shares.
  - **A pool switched off.** `off: [{ pool: 't-state', from: asOf + 200, to: asOf + 600 }]`, with `t-city` short so the line waits.
    - On `asOf + 200` every waiting application lapses (level from 1 to about 0.863).
    - Each is drawn again from that day on its same u and v, with a new `applied` and `keyDay`.
    - No new application is certain before `asOf + 601`, and no `t-state` `in` is dated within the span.
    - After `asOf + 601`, waiting applications whose level rises keep their place.
  - **Bond off, nothing lapses.** Switching off `t-bond` while `t-bond-grant` shares the City tier pro rata lapses nothing: the level stays 1.
  - **The known limit.** `t-city` has one `once` inflow that the first award spends.
    - The second application is never awarded, never lapses, and stays in line to the horizon (`fundedRunStats` or a probe shows it waiting).
    - Ending `t-city`'s programme on a later day lapses it on `to + 1` and redraws it as a new spell.
  - **Regimes.** With one regime day, a waiting application is re-made on that day: its `view` changes, and its funded schedule has `regime` equal to the view of its award day.
  - **Review Focus 2.** Put a programme's `to + 1`, an `off` entry's `from` and a regime day on the same day D. `FinancePre.days` holds D once, each waiting application is re-made once, and a lapse compares with the bundle just before D. Assert the count of `respell` calls through `fundedRunStats`, extended with `respells`.
- [ ] **Step 2: Run them and see them fail.** `npx vitest run --project server src/lib/sim/scenario/engine-finance-repricing.spec.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass, with Task 7's file.** `npx vitest run --project server src/lib/sim/scenario/engine-finance-repricing.spec.ts src/lib/sim/scenario/engine-finance.spec.ts`
- [ ] **Step 5: Commit.** `git commit -m "feat(sim): re-pricing and lapse of waiting applications"`

---

### Task 9: Stacked money in the engine, `funding.programmes`, and the card

**Files:**
- Modify: `src/lib/sim/scenario/card.ts:140-257` (`projectCard` return)
- Test: `src/lib/sim/scenario/card.spec.ts`; create `src/lib/sim/scenario/engine-finance-stack.spec.ts`

**Interfaces:**
- Produces: `projectCard` adds `kind: 'affordable'` when `s.kind === 'affordable'`, and `funding: { programmes: [...s.funding.programmes], certain: s.funding.certain }` when `s.funding` is present. It adds neither key otherwise. No pricing.

- [ ] **Step 1: Write the failing tests.**
  - `engine-finance-stack.spec.ts`:
    - **A bond adds homes.** `tinyStack` on `tinyQueue` and on the mini city with a baseline-shaped stack, 20 seeds, `t-state` ample, more applicants than money. B_d and C are the bond's and the City pool's total inflows. The funded homes H satisfy `H * 300027 <= C + B_d` and `C + B_d - H * 300027 < 2 * maxCityTierDollars`; without the bond, the same with C alone, and H is larger with the bond.
      - While both pools pay, each award lists `t-city` and `t-bond-grant`. City `granted` per home is close to 123176.65 and the bond's close to 176850.35, rounded per project.
      - Once `t-city` is short, awards list `t-bond-grant` without `t-city` and the bond pays 300,027 a home.
      - No project's `granted` exceeds `projectDollars(861525, units)`.
    - **A short pool is made up only as far as the share allows.** With `t-city` short:
      - bond share 0.2: the application waits and no pool has a `commit` that day;
      - bond share 0.5: it is awarded the same day, certain, with `funding.programmes` `['t-fed', 't-state', 't-bond-grant']`, and the bond's commit is `projectDollars(300027, units)`.
    - **`funding.programmes` re-prices to the same dollars.** Over 20 seeds of `miniFinance()` (with `miniCalibrationWithRoutes()`) and of `tinyStack` with a bond, for every funded schedule:
      - `programmes` follows `finance.programmes` order;
      - `fundBundle` on those programmes at `prototypeFor(revisions[0].stories, revisions[0].units)` gives exactly `granted`, `lent` and `guaranteed` after `projectDollars`;
      - `isCertain` of its coverage equals `funding.certain`;
      - `certain` means it never exits and has one revision.
  - `card.spec.ts`, on a run of `miniFinance()`:
    - a certain affordable funded schedule's card has `kind: 'affordable'` and `funding: { programmes, certain: true }`, with programmes equal to the schedule's;
    - a partly covered market funded card has no `kind` and `certain: false`;
    - an ordinary start's card and every pipeline card have neither key (`'funding' in card === false`);
    - a hand-built schedule with `funding.certain: true` gives `certain: true` whatever `ctx.input.finance` holds;
    - the existing card tests pass untouched.
- [ ] **Step 2: Run them and see them fail.** `npx vitest run --project server src/lib/sim/scenario/engine-finance-stack.spec.ts src/lib/sim/scenario/card.spec.ts`
- [ ] **Step 3: Implement** the card copy. Engine fixes, if the stack tests expose any, belong to this task's diff.
- [ ] **Step 4: Run them and see them pass.** Same command.
- [ ] **Step 5: Commit.** `git commit -m "feat(sim): funding fields on the project card"`

---

### Task 10: `buildSimInput` runs the baseline funding; `marketLevel`

**Files:**
- Modify: `src/lib/sim/scenario/market.ts:15-23`, `src/lib/sim/scenario/input.ts:52-75`
- Test: `src/lib/sim/scenario/market.spec.ts:31-41`, `src/lib/sim/scenario/input.spec.ts:257-313`
- Modify (assertions on the level now in force): `src/lib/fzp/provenance.spec.ts:473-485`, `e2e/fzp.spec.ts:930-948`
- Create: `pipeline/test/fixture-funding.test.ts`

**Interfaces:**
- Produces:
  - `marketLevel(cal)` returns `cal.market !== undefined && cal.baselineFunding !== undefined ? 'private' : 'all'` (spec 4.14, verbatim).
  - `buildSimInput` sets `finance` per the table of spec 4.14. In the both-present row: `{ pools: structuredClone(bf.pools), programmes: structuredClone(bf.programmes), off: [], slope: m.slope.perCostShare, terms: resolveTerms(MARKET_TERMS) }`.
  - `export const FUNDING_WITHOUT_MARKET_WARNING = 'calibration.json: baselineFunding without a market model; the run has no funding'`, emitted after `NO_MARKET_WARNING` in the third row.

- [ ] **Step 1: Write the failing tests.**
  - `market.spec.ts`: market plus `baselineFunding` gives `'private'`. Without `baselineFunding`, or without `market`, it gives `'all'`. For each of the four calibrations, `buildSimInput(...).market` deep-equals `marketSteps(cal.market, asOf, marketLevel(cal))`, or the key is absent when that is `[]`.
  - `input.spec.ts`:
    - Each of the four rows checks `market`, `finance` (or `'finance' in input === false`) and `warnings` deep-equal to the row's list, in order.
    - In the first row, `finance.pools` is not the calibration's array (a deep copy) and `finance.terms` equals `resolveTerms(MARKET_TERMS)`.
    - `goldenInput()` has neither `market` nor `finance`.
    - Edit the existing "applies today's market…" case: with `miniFunding()` the step's `logOdds` is now `market.today.private`.
  - `provenance.spec.ts` "states both levels…": `liveMarketCalibration()` carries fixture-0's `baselineFunding`, so the private line now ends `In force.`. Assert `'Private starts only: 47% of the average (log-odds −0.75). In force.'`, recomputing the log-odds text from `LIVE_MARKET.today.private` with the file's `coefText`. Assert that the "All starts: 52% …" line ends with `Not in force until public funding is modelled.`. That is current copy; see Q-A.
  - `e2e/fzp.spec.ts` "Results' Sources state today's market": `observed.all` becomes `observed.private`. The `implied` and percentage assertions use the private share `formatPercent(observed.private / implied)`.
  - `pipeline/test/fixture-funding.test.ts`:
    - Decode `e2e/fixtures/data/fixture-0/scenarios/fzp/{parcels.bin,projects.json,calibration.json}` with `inflateRawSync` plus `decodeScenarioPayload`, `parseProjectsFile` and `parseCalibration`, imported by relative path as `pipeline/steps/lesscars.ts:48` does.
    - `buildSimInput(...)`, then `simulateDetailed(input, 1, HORIZON)` with `HORIZON` from `src/lib/fzp/time.ts` (the page's default).
    - Assert that `input.finance` is defined and that some simulated schedule has `funding`.
    - **Expectation:** fixture-0 already carries `market`, `baselineFunding` and `affordableRoutes` (Release 1), so this may already pass here. If it fails, do not change the engine to pass it. Record it in Task 15's inventory as a Release 2 item, where it runs after the regeneration (spec 6).
- [ ] **Step 2: Run them and see them fail.** `npx vitest run --project server src/lib/sim/scenario/market.spec.ts src/lib/sim/scenario/input.spec.ts src/lib/fzp/provenance.spec.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass, then the pipeline test and the one e2e test.**
  - `npx vitest run --project server src/lib/sim/scenario/market.spec.ts src/lib/sim/scenario/input.spec.ts src/lib/fzp/provenance.spec.ts`
  - `npx vitest run --project pipeline pipeline/test/fixture-funding.test.ts` (record the outcome)
  - `npx playwright test e2e/fzp.spec.ts -g "state today's market"`
- [ ] **Step 5: Commit.** `git commit -m "feat(sim): run the baseline funding on the private-starts level"`

---

### Task 11: The net fast path and the finance golden

**Files:**
- Modify: `src/lib/sim/scenario/simulate.property.spec.ts`
- Create: `src/lib/sim/scenario/simulate.finance.golden.cases.ts`, `simulate.finance.golden.shared.ts`, `simulate.finance.golden.test.ts`, `simulate.finance.golden.svelte.spec.ts`, `fixtures/build-finance-golden.ts`, `fixtures/golden-finance-seed1.json`

**Interfaces:**
- Produces:
  - `financeGoldenInput(): SimInput`: `goldenInput()` with `calibration: miniCalibrationWithRoutes()` and `finance: miniFinance(asOf)`.
  - `financeGoldenRun(): { seed: 1; horizon: Day; schedules: Schedule[]; ledger: LedgerEvent[] }`: a JSON round trip, with schedules collected and sorted as in `simulateDetailed` and the ledger collected through `runEngine`'s `ledger` sink.
  - `describeFinanceGolden(where: string)`, run from Node and from the browser.
  - The builder follows `fixtures/build-golden.ts`: Prettier-formatted, run deliberately with `node_modules/.bin/tsx src/lib/sim/scenario/fixtures/build-finance-golden.ts` from the worktree root.

- [ ] **Step 1: Write the failing tests.**
  - `simulate.property.spec.ts`, new `describe`: `simulateNet` equals `netOf(shownSeries(simulateDetailed(...)))` on all three series, every month, seeds 1 to 50:
    - with `financeGoldenInput()`;
    - with a small synth city (the rig's existing small-city builder, or `synthCity()` restricted to 4 cells) carrying `benchBaseline()`-shaped funding. Use `tinyStack`-style baseline pools if Task 13's fixture does not exist yet; swap to `benchBaseline()` in Task 13.
  - `simulate.finance.golden.shared.ts`: the run is not degenerate. It has funded schedules of both kinds, at least one certain and one partly covered, at least one `in`, `commit`, `spend` and `release`, and the `off` span changes at least one bundle (at least one lapse, through `fundedRunStats().respells > 0` when run in Node). It reproduces every schedule and ledger event exactly.
- [ ] **Step 2: Run them and see them fail** (the golden file is missing). `npx vitest run --project server src/lib/sim/scenario/simulate.finance.golden.test.ts`
- [ ] **Step 3: Write the golden:** `node_modules/.bin/tsx src/lib/sim/scenario/fixtures/build-finance-golden.ts`. Read the file's diff summary (counts of schedules, funded, events) and check the non-degeneracy before committing. This is the one golden this branch writes.
- [ ] **Step 4: Run Node, the browser and the property tests.**
  - `npx vitest run --project server src/lib/sim/scenario/simulate.finance.golden.test.ts src/lib/sim/scenario/simulate.property.spec.ts`
  - `npx vitest run --project client src/lib/sim/scenario/simulate.finance.golden.svelte.spec.ts`
  - Expected: PASS. The browser equals the Node run bit for bit.
- [ ] **Step 5: Commit.** `git commit -m "test(sim): finance golden and the net fast path with funding"`

---

### Task 12: Grouped bisection serving

**Files:**
- Modify: `src/lib/sim/scenario/line.ts` (`groupedLine`), `src/lib/sim/scenario/funded.ts` (default serving `'grouped'`)
- Test: `src/lib/sim/scenario/line.spec.ts`, `src/lib/sim/scenario/engine-finance.spec.ts`

**Interfaces:**
- Produces: `export function groupedLine(poolsOf: (bundle: readonly number[]) => readonly number[]): Line`, the same `Line` contract as `scanLine`.

**Algorithm (spec 4.17 item 5).**
- Groups are keyed by (kind, `bundleKey`, prototype id for market).
- Each group keeps its applications in (applied, key) order, with a min-segment-tree of units in which removed entries hold `+Infinity`.
- H is the group's largest passing size: a bisection over whole units from 1 to the group's largest size, at most `ceil(log2(4096)) = 12` steps, each one `test(g, units)` call. 4,096 is a bisection bound, not a model number.
- `serve` repeats, while any group has a passing application:
  1. take each group's first application with units ≤ H (the leftmost leaf ≤ H);
  2. award the one with the least (applied, key) at its own units through `test`;
  3. `take` it;
  4. recompute H for every group sharing a pool with the award.
- `regroup` moves an application between groups, keeping its key. A re-pricing day may rebuild every group in key order.

- [ ] **Step 1: Write the failing tests.**
  - `line.spec.ts`: every Task 6 case also holds for `groupedLine`. On 500 seeded random lines over `tinyStack`'s pools, with random money and sizes, `test = awardSet` and `take` deducting the asks, `scanLine` and `groupedLine` give the same awards in the same order with the same sets.
  - `engine-finance.spec.ts`: for `miniFinance()` and the `tinyStack` cases of Tasks 7 to 9, seeds 1 to 20, `runEngineWith(..., { serving: 'scan' })` and `{ serving: 'grouped' }` give deep-equal schedules and ledgers.
- [ ] **Step 2: Run them and see them fail.** `npx vitest run --project server src/lib/sim/scenario/line.spec.ts src/lib/sim/scenario/engine-finance.spec.ts`
- [ ] **Step 3: Implement.** Switch `runEngine`'s default to `'grouped'`.
- [ ] **Step 4: Run them and see them pass, then the finance golden (unchanged) and the scenario folder.** `npx vitest run --project server src/lib/sim/scenario`
- [ ] **Step 5: Commit.** `git commit -m "perf(sim): serve the line by grouped bisection"`

---

### Task 13: Per-input shortcuts, the bench and F18

**Files:**
- Modify: `src/lib/sim/scenario/funded.ts` (the eligibility list and the market skip bound), `src/lib/sim/scenario/input.ts` (export `skipBounds` unchanged)
- Modify: `src/lib/sim/scenario/fixtures/bench-finance.ts` (`benchBaseline`, `benchFunding`)
- Modify: `src/lib/sim/scenario/scenario.bench.spec.ts`
- Test: `src/lib/sim/scenario/funded.spec.ts`

**Interfaces:**
- Produces:
  - `FinancePre.eligible[κ]: Uint8Array` by candidate: the lot's largest level in some view meets the least `minHomes` of the kind's programmes. A lot not eligible for any reached kind takes today's path in the eager phase, with the one-draw `skipAbove` skip.
  - `FinancePre.marketSkip(horizon): Float64Array`: per candidate, built like `skipAbove` from the per-segment rates `min(ordinary, the most-shifted market bundle any level of the lot can get in the segment's view)`, or `Infinity` where some such bundle is certain.
  - `benchBaseline(asOf)` and `benchFunding(asOf)`, verbatim from spec 4.17. `benchBaseline` has six City pools at 80.5, 48.6, 36.7, 34.8, 27.4 and 6.0 million a year, `state` at 150 million a year, and an uncapped `federal` pool. There is one grant per pool, City 300,027 split by Exhibit E, state 118,390 and federal 443,108, all over 861,525, with `minHomes: 70` and the spec's tiers. `slope: 3.0`. `benchFunding` has `bench-bond`, `bench-fund`, `bench-certain`, `bench-loan` and `bench-afford`, as spec 4.17 lists them. Both are labelled tier 4 bench values in comments.

- [ ] **Step 1: Write the failing tests.**
  - `funded.spec.ts`: the shortcuts are exact. For `miniFinance` and `benchBaseline` on the mini city, seeds 1 to 20, runs with the shortcuts (default) and with `opts.noShortcuts: true` (test-only) give deep-equal schedules and ledgers.
  - `scenario.bench.spec.ts`, per spec 4.17 "Bench cases":
    1. Existing budgets unchanged (finance absent).
    2. `simulateNet` with the bench baseline (input `{ ...inputOf(city), market: [], finance: benchBaseline }`, `calibration.affordableRoutes = benchRoutes()`): median ≤ 30 ms.
    3. Plus `benchFunding()`: median ≤ 45 ms.
    4. Host: all 101 band pairs ≤ 9 s after revision 0 (Q-B: plan and twin on the bench baseline through the bench calibration's `baselineFunding`, `affordableRoutes` and a market model whose `today.private` is 0 and `slope.perCostShare` is 3.0).
    5. Longest macrotask ≤ 50 ms with that host.
    6. Seed 1 with the bench funding set: `fundedRunStats().firstDayApplications >= 10000` and `awards >= 100`.
    7. Reported, no budget: plus `off` on the bench baseline's `state` pool from `asOf + 1826`, to null. Print its median.
- [ ] **Step 2: Run the exactness test and see it fail.** `npx vitest run --project server src/lib/sim/scenario/funded.spec.ts`
- [ ] **Step 3: Implement** the shortcuts and the fixtures.
- [ ] **Step 4: Run.**
  - `npx vitest run --project server src/lib/sim/scenario/funded.spec.ts` must PASS.
  - Then, only if the machine is quiet (no other test, build or agent work running; check with `uptime` that load is under 2): `npm run test:perf`. Record each median.
  - On a busy machine, run case 6 alone (`npx vitest run --project perf src/lib/sim/scenario/scenario.bench.spec.ts -t "fixture check"`) and record ballpark numbers from one run, labelled as such.
  - If a median misses its budget on a quiet machine, apply spec 4.17's fallback 1 (per-input `Float32Array` rate tables for eligible lots), measure again, and if it still misses, record measured median + 20% as the proposed budget for the conductor. Perf never blocks the task.
- [ ] **Step 5: Commit.** `git commit -m "perf(sim): exact shortcuts and F18 bench cases for funding"`

---

### Task 14: Developer documentation

**Files:**
- Create: `docs/dev/finance-engine.md`
- Modify: `CLAUDE.md` ("Scoped reference docs" list), `docs/dev/lesscars.md`, `docs/dev/testing.md`, `docs/dev/sim-levers.md`, `docs/dev/market.md` (builder's call: its `marketLevel` "returns 'all' until finance-engine" text is now stale)

- [ ] **Step 1: Write `docs/dev/finance-engine.md`** covering every bullet of spec section 8, in that order. Include:
  - the two worked examples of 4.6 (bond share 0.5 awarded; 0.2 waits);
  - the event table of 4.7;
  - E1 to E7 with `finance-score`'s I1 to I6;
  - the `PIPELINE_FUNDED` text;
  - `buildSimInput`'s table;
  - the bench counts and the bench funding set;
  - the measured medians from Task 13 (or "ballpark, busy machine"), including case 7's;
  - the known limit, with a pointer to its test in `engine-finance-repricing.spec.ts`;
  - the builder's calls of this plan that a reader would hit: `logit` unshifted, the ordinary start on today's path, and the min-rate rule.
- [ ] **Step 2: Add the `CLAUDE.md` link line, verbatim:** "**Funded starts, the funding queue and the pools in the engine (`SimInput.finance`, `off`, latents, the line and its order, the award rule, re-pricing and lapse, the ledger protocol, the card's funding fields, `sampleAdvance`, budgets)** — [docs/dev/finance-engine.md](docs/dev/finance-engine.md)". Put it after the finance-data line.
- [ ] **Step 3: Update the other docs.**
  - `lesscars.md`: one paragraph. From Release 2 the build step's runs carry the dataset's baseline funding on the private-starts level, both arms alike.
  - `testing.md`: the finance golden and its builder, the `tiny-queue` and `mini-finance` fixtures, and the bench cases.
  - `sim-levers.md`: one sentence. `finance` and `market` pass through every `PolicyOp` and `bare()`, with a link to the new doc.
  - `market.md`: `marketLevel` now returns `'private'` with both `market` and `baselineFunding`.
- [ ] **Step 4: Check formatting.** `npx prettier --check docs/dev/finance-engine.md docs/dev/lesscars.md docs/dev/testing.md docs/dev/sim-levers.md docs/dev/market.md CLAUDE.md`. Expected: clean (run `--write` on these files if not).
- [ ] **Step 5: Commit.** `git commit -m "docs: the finance engine"`

---

### Task 15: Verification and the golden-failure inventory

**Files:** none, beyond fixes a failing check demands (each fix is committed with its own message).

- [ ] **Step 1: Run the whole check.** Run `npm run check`, `npm run lint`, `npm run test:unit` and `npm run test:pipeline`.
  - Expected PASS: everything except the comparisons this release moves.
  - `golden-seed1.json`, `model-golden.json`, `golden-finance-seed1.json` and the paired-draw fix's tests (`timelapse/sampler.marginals.test.ts`, `scenario/pairing.property.spec.ts`, `levers/pairing.spec.ts`, `levers/display-engine.spec.ts`) must PASS.
- [ ] **Step 2: Run e2e.** `npm run test:e2e` on the committed fixture-0. Its calibration already has market and funding, so the default run now funds. An assertion on a number the default run changes is updated in the commit that changed it and listed. Do not regenerate fixture-0.
- [ ] **Step 3: Write the inventory** into the task's report, not into a file. Name every failing comparison with its reason. Expected entries:
  - `pipeline/test` fixture/lesscars golden comparisons under `pipeline/test/fixtures/mini/golden/scenarios/lesscars/` (`timeline.decoded.json`, `summary.json`, `sites.json`): the build step's runs now carry the fixture baseline funding on the private level. `plan.json` must NOT differ, and a diff there is a finding.
  - Any `fixture-0` `/lesscars` output comparison: same reason.
  - The `treeDatasetVersion`-dependent checks, if any: hashed engine files changed.
  - `pipeline/test/fixture-funding.test.ts`, if it failed in Task 10.
  - Every other failure is a defect to fix, not to list.
- [ ] **Step 4: Confirm the release boundary.** `git status --short` and `git diff --stat 1e74b191 -- pipeline/test/fixtures/mini/golden e2e/fixtures/data/fixture-0 src/lib/sim/scenario/fixtures/golden-seed1.json src/lib/timelapse/fixtures` show no change.
- [ ] **Step 5: Hand back to the operator.** No push, no PR, no signoff.

---

## Self-review

- **Spec coverage.** Section 1's "In" items: 1 (Tasks 5, 7, 8), 2 (Task 7), 3 (Tasks 4, 7), 4 (Task 9), 5 (Task 1), 6 (Task 2), 7 (Task 1), 8 (Task 10), 9 (Task 11), 10 (Tasks 12, 13), 11 (Task 15). Section 4.2 is Task 2; 4.3 is Tasks 2, 4 and 5; 4.4 is Task 5; 4.5 and 4.8 to 4.10 are Task 7; 4.6 is Tasks 3, 6 and 12; 4.7 is Task 4; 4.11 is Tasks 7 and 8; 4.12 is Tasks 7 and 9; 4.13 is Task 2; 4.14 is Task 10; 4.15 is Task 11; 4.16 is Task 7; 4.17 is Tasks 12 and 13; 4.18 is Task 1. Section 6's tests 1, 2 and 4 to 9 are distributed as above, and section 8 is Task 14.
- **Acceptance criteria.** 1 and 2 (Task 7), 3 (Task 5), 4 and 5 (Tasks 4, 5, 8), 6 (Tasks 3, 6), 7 (Tasks 8, 9), 8 to 10 (Tasks 4, 7), 11 (Tasks 1, 7), 12 (Tasks 7, 8), 13 and 14 (Task 2), 15 (Task 10), 16 and 17 (Tasks 7, 9), 18 (Task 11), 19 (Task 7), 20 (Task 13), 21 (Task 1), 22 and 23 (Tasks 10, 15; regeneration is Release 2's), 24 (Task 2).
- **Types.** `FinanceIndex`, `Award`, `App`, `AwardTest`, `KindLatent`, `AttemptLatents`, `LedgerEvent` and `Treasury` are each defined once and used under those names. `runEngineWith`'s `opts.serving` values (`'scan'`/`'grouped'`) are the same in Tasks 7 and 12.
