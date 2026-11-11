# Paired-draw fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw a stage's exit kind and its timing from two independent uniforms, and make a timer lever scale each project's sampled time instead of swapping its table, so a timing-only lever never changes any project's outcome and moves every event monotonically.

**Architecture:** `src/lib/timelapse/model.ts` gains the two halves of one sampler: `sampleKind` (the kind from the eventual shares conditional on τ real months survived) and `sampleTime` (the day from the kind's own conditional CDF, piecewise-linear within months, closed-form tail). `sampleTransition(t, uKind, uTime, τ)` composes them and replaces the one-uniform sampler. The engine draws `P.STAGE` (kind) and `P.STAGE_TIME` (time) per (lot, stage), always samples the unscaled transition, conditions in-flight stages on the exact days survived (no redraw loop), and multiplies the remaining time by the stage's scale. `applyLevers` passes the unscaled calibration plus the scales; `rescaleTransition` survives only for the lookups people see.

**Tech Stack:** TypeScript, SvelteKit 2 / Svelte 5, Vitest (server, client, pipeline, perf projects), fast-check, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-10-paired-draw-fix-design.md` (approved; binding). Partner rulings R17 (`.superpowers/superconductor/sim-financing/ledger.md` in the main checkout) and spec ruling 1 (`model-golden.json` may move; one sampler).

Line references were checked at this worktree's HEAD (`eebbe47e`, main `8a0dbe89` plus the spec).

## Global Constraints

- **Deterministic and paired.** A run is a pure function of (dataset, levers, seed). A lot's draws never depend on another lot or on processing order.
- **No change to the marginals of an unscaled run.** For an unscaled transition the joint law of (time, kind) is the table's; calibration, replay and V27 move only by sampling noise.
- **Goal 1, exact.** A lever that changes only timing never changes any project's kind of exit, at any stage, fresh or in flight, by construction and not up to rounding.
- **Goal 2, exact.** Under a pure speed-up (every scale ≤ 1) each stage event is on the same day or earlier than in the twin; under a pure slow-down, the same day or later.
- **The engine samples only unscaled transitions.** Event time in stage = τ + s·(x − τ); s = 1 for the twin and for any stage the timers do not name. `rescaleTransition` (`src/lib/sim/levers/timers.ts:73-148`) stays unchanged, for chance tables, typical months, the timeline and the card only.
- **Draw purposes** (`src/lib/sim/scenario/rng.ts:15-25`): `STAGE` = 6 is the kind uniform, one per (lot, stage); `STAGE_TIME` = 12 (new) is the time uniform, one per (lot, stage); `stageRedraw(j)` 17–23 is retired: no longer drawn, numbers reserved and never reused. 7 and 10 stay reserved for Release 2 (F11). Free after this: 13–16, 24+.
- **One sampler** (spec ruling 1). `sampleTransition(t, uKind, uTime, τ)` → `{ kind, days }` replaces `(t, u, m)`; the old one-uniform sampler is removed. `sampleKind(t, uKind, τ)` and `sampleTime(t, kind, uTime, τ)` are exported. V27 (`pipeline/lib/fzp-cal/invariants.ts:231`) uses `sampleTransition`, so it checks what the engine runs.
- **Goldens move once, by their documented commands:** `golden-seed1.json` (`src/lib/sim/scenario/fixtures/build-golden.ts`), `model-golden.json` (`scripts/model-golden.ts`), the pipeline fixture goldens `pipeline/test/fixtures/mini/golden/**` (lesscars included) and `fixture-0` (`npm run pipeline -- fixture --update-golden`). Each is reviewed as an engine change. Never hand-edit them.
- **No measurable slowdown** on `src/lib/sim/scenario/scenario.bench.spec.ts` budgets (`npm run test:perf`, quiet machine only).
- **Hashed paths.** `src/lib/timelapse`, `src/lib/sim/scenario`, `src/lib/sim/levers` and `pipeline/` are in the dataset version (`pipeline/lib/version.ts:42-53`). The branch needs its own dataset build; the plan stops before upload (see Task 6).
- **House rules.** Work only in `/Users/mindlace/Projects/sfhousing/.claude/worktrees/paired-draw-fix` (branch `worktree-paired-draw-fix`). Never `cd ... && cmd`. Conventional Commits with `git commit -m`; no Claude attribution of any kind. Colocated Vitest; `expect.requireAssertions` is on (wrap `fc.assert` in `expect(() => ...).not.toThrow()`). Signoff's timing check rejects added `waitForTimeout`/sleeps, raised test timeouts and retries above 1: heavy statistical tests are split into many `it`s that each fit the default timeout, never given a longer one. Everything runs in the foreground; leave nothing running.

## Review Focus

1. **An in-flight row whose current stage has no history day or was entered on `asOf`** (`engine.ts:648-653` sets e = asOf; survived = 1 day). Its event must be strictly after `asOf` and the step must not throw. Test in Task 2.
2. **A kind with no remaining mass at τ** (a table-only reason whose column is flat by τ; a tail share of exactly 0 such as `expired: 0`). `sampleKind` must never return it; `sampleTime` on it throws a `RangeError`, never returns NaN. Test in Task 1.
3. **Degenerate tails** (ρ = 1e-20 so log(1 − ρ) = 0; ρ = 1; ρ = 1e-6). Days stay finite integers below 2^24 at τ < K and τ ≥ K, and the kind split is kept. Test in Task 1.
4. **A clamped scale of 10 on an in-flight row in a slow tail.** Scaled days can pass 2^24; the schedule must end `open` (nothing past the horizon is recorded), with no throw, and the kind is the twin's. Test in Task 2.
5. **`'new'` and `'all'` timers stacked on one stage, with route shares.** The fresh and in-flight lookups must not be shared when their scales differ, and an in-flight card under a timer must show the twin's eventual chance within the grid. Tests in Task 3.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/lib/timelapse/time.ts`, `time.test.ts` | `stageDay` / `stageMonths`: the day-within-month rule and its inverse | 1 |
| `src/lib/timelapse/model.ts`, `model.test.ts` | `sampleKind`, `sampleTime` (Task 1); `sampleTransition` swap, dead-code removal (Task 4) | 1, 4 |
| `src/lib/timelapse/test/arbitraries.ts` (new) | `arbTransition()` fast-check arbitrary | 1 |
| `src/lib/timelapse/sampler.marginals.test.ts` (new) | acceptance 1 and 6 (400k draws per cell) | 1 |
| `src/lib/sim/scenario/rng.ts`, `rng.spec.ts` | `P.STAGE_TIME`, retire `stageRedraw` | 2 |
| `src/lib/sim/scenario/engine.ts` | `scaledTransition`, `stageStep` rewrite, every job reads its scale | 2, 4 |
| `src/lib/sim/scenario/card.ts`, `card.spec.ts` | `inFlightMonths` moves here (Task 2); card agrees with the engine (Task 3) | 2, 3 |
| `src/lib/sim/scenario/types.ts` | `SimInput` lever-field contract comment | 2 |
| `src/lib/sim/scenario/pairing.property.spec.ts` (new) | acceptance 2 | 2 |
| `engine-levers.spec.ts`, `simulate.spec.ts`, `multiphase.spec.ts` | rewritten in-flight and draw-sequence tests | 2 |
| `src/lib/sim/scenario/fixtures/golden-seed1.json` | regenerated | 2 |
| `src/lib/sim/levers/apply.ts`, `apply.spec.ts` | unscaled calibrations + scales; display lookups | 3 |
| `src/lib/sim/levers/timers.ts`, `timers.spec.ts` | `sameScale` | 3 |
| `src/lib/sim/levers/pairing.spec.ts` (new) | acceptance 3 | 3 |
| `src/lib/sim/levers/display-engine.spec.ts` (new) | acceptance 7 | 3 |
| `docs/dev/sim-levers.md`, `docs/dev/sim-timers.md` | timers scale time, never outcomes | 3 |
| `pipeline/lib/fzp-cal/invariants.ts` | V27 on the new sampler | 4 |
| `src/lib/timelapse/model.golden.cases.ts`, `fixtures/model-golden.json`, `types.test.ts`, `reproduce.test.ts` | new signature, regenerated golden, type lock | 4 |
| `pipeline/test/simulate-replay.test.ts`, `pipeline/test/fzp-cal/ph-pool.test.ts`, `aj-recovery.test.ts` | new signature | 4 |
| `pipeline/test/fixtures/mini/golden/**`, `e2e/fixtures/data/fixture-0/**` | regenerated | 5 |

---

### Task 1: The sampler's two halves

Additive: the old `sampleTransition` and the engine are untouched until Tasks 2 and 4.

**Files:**
- Modify: `src/lib/timelapse/time.ts` (after `monthsIn`, :16-18); Test: `src/lib/timelapse/time.test.ts`
- Modify: `src/lib/timelapse/model.ts` (constants `:78-145`, new exports after `eventualProbabilities` `:224`); Test: `src/lib/timelapse/model.test.ts`
- Create: `src/lib/timelapse/test/arbitraries.ts`, `src/lib/timelapse/sampler.marginals.test.ts`

**Interfaces:**
- Consumes: `cumulativeIncidence`, `eventualProbabilities`, `tailOf`/`sumsOf`/`constantsOf` (memoised per `Transition`, `model.ts:108-145`), `MAX_EVENT_MONTH` (`model.ts:243`), `exp`/`log` from `./math`.
- Produces:
  - `stageDay(months: number): number` (time.ts): integer day offset from stage entry for x real months. With k = floor(x) + 1, first = ceil((k − 1)·MONTH_DAYS), end = ceil(k·MONTH_DAYS): first + min(floor((x − (k − 1))·(end − first)), end − first − 1). Non-decreasing; `monthsIn(0, stageDay(x)) === Math.floor(x)`. This is today's day rule (`model.ts:388-390`) as a function of x.
  - `stageMonths(day: number): number` (time.ts): for an integer day ≥ 0, (k − 1) + (day − first)/(end − first) with k = monthsIn(0, day) + 1. Contract: `stageDay(stageMonths(d)) === d` for every integer d in [0, 2^24).
  - `sampleKind(t: Transition, uKind: number, monthsElapsed: number): 'advance' | ExitReason` (model.ts)
  - `sampleTime(t: Transition, kind: 'advance' | ExitReason, uTime: number, monthsElapsed: number): number` (model.ts): integer days from stage entry, ≥ `stageDay(monthsElapsed)`, < 2^24.
  - `arbTransition(): fc.Arbitrary<Transition>` (test/arbitraries.ts).

The law (spec "Sampling one stage step"). F_j at real x is linear between table months, and past K it is F_j(K) + (1 − C(K))·π_j·H(x − K), π_j = tail share, H linear between integer months with H(n) = 1 − (1 − ρ)^n. τ = `monthsElapsed`, real-valued, finite, 0 ≤ τ < MAX_EVENT_MONTH − 1, else `RangeError`. u outside [0, 1) or non-finite: `RangeError`.

- **Kind:** remaining masses R_j = F_j(∞) − F_j(τ), in the order advance then `EXIT_ORDER` (`tailOf(t).kinds`). Return the j whose cumulative slice of R holds uKind·(1 − C(τ)); the last kind with R_j > 0 takes any rounding remainder. For τ ≥ K use the tail shares directly (memoryless; `TailConstants.acc`/`last` already hold them).
- **Time, τ < K:** f = F_j(τ) + uTime·R_j. If f < F_j(K): the least table month k with F_j(k) > f, x = (k − 1) + (f − F_j(k − 1))/(F_j(k) − F_j(k − 1)), clamped to ≥ τ. Otherwise v = (f − F_j(K))/((1 − C(K))·π_j) and the tail inverse from K.
- **Time, tail inverse from τ' ≥ K with uniform v** (kind-independent: every kind shares H). Algorithm, since the signature does not determine it: n0 = floor(τ' − K), f0 = τ' − K − n0, R = (1 − f0·ρ)(1 − v). If R > 1 − ρ the event is in the same month: f = (1 − R)/ρ, x = K + n0 + f. Otherwise m = the least m ≥ 1 with (1 − ρ)^(m+1) < R ≤ (1 − ρ)^m (closed form floor(log R / log(1 − ρ)), then stepped by one, as `relativeTail` does at `model.ts:294-305`), f = (1 − R/(1 − ρ)^m)/ρ, x = K + n0 + m + f. Working relative to n0 keeps a large τ precise. If log(1 − ρ) = 0 or x would pass the cap, x is the cap month (MAX_EVENT_MONTH − 1 plus the position of v in the unreached mass, as `relativeTail`'s fallback does). ρ = 1: every event falls in the next month.
- **Days:** `Math.max(stageDay(x), stageDay(τ))` (the max only guards float rounding).
- Memoise per `Transition` (builder's call: add one lazily-filled `cols` entry to `Constants`, holding per kind F_j(0..K) and F_j(∞); `boundsOf` and friends stay until Task 4).

- [ ] **Step 1: Write the failing `stageDay`/`stageMonths` tests** in `time.test.ts`:
  - `'stageDay puts month k on its own days'`: for k = 1..240, `stageDay(k - 1) === Math.ceil((k - 1) * MONTH_DAYS)` and `stageDay(k - 1e-9) === Math.ceil(k * MONTH_DAYS) - 1`; for 10,000 mulberry32 x in [0, 600), `monthsIn(0, stageDay(x)) === Math.floor(x)`.
  - `'stageMonths inverts stageDay on every day below 2^24'`: one loop over d = 0..16777215 counting `stageDay(stageMonths(d)) !== d` and `!(stageMonths(d + 1) > stageMonths(d))`; `expect(bad).toBe(0)`. `stageMonths(0) === 0`.

- [ ] **Step 2: Write `arbTransition` and the failing sampler tests** in `model.test.ts` (new `describe('sampleKind')`, `describe('sampleTime')`), with `t` = small `discretionary.permitFiled` (K = 12, C(K) = 0.7, tail advance 0.05 / expired 0.01; `model.test.ts:34-45`):
  - `arbTransition`: K in 1..48; a random subset of `EXIT_ORDER` in the table and another in the tail (so table-only and tail-only reasons occur); non-decreasing columns with C(K) in [0.05, 1 − 1e-5]; tail hazards each 0 or in [1e-6, 0.3], at least one > 0, ρ ≤ 1. Self-test: 200 samples wrapped by the existing `withTransition`-style helper pass `parseCalibration`.
  - sampleKind at τ = 0: with P = `eventualProbabilities(t, 0).advance`, `sampleKind(t, P - 1e-12, 0) === 'advance'` and `sampleKind(t, P + 1e-12, 0) === 'expired'`.
  - sampleKind at τ = 6.4: threshold (F_adv(∞) − F_adv(6.4))/(1 − C(6.4)), F at 6.4 interpolated from `cumulativeIncidence(t, 6)` and `(t, 7)`; ±1e-12 either side gives advance / expired.
  - sampleKind at τ ∈ {12, 20.5, 140}: `advance` iff uKind < 0.05/0.06 (±1e-12).
  - Review Focus 2: a transition with table reason `withdrawn` flat from month 3 and absent from the tail, plus tail `expired: 0`: over 10,000 uniforms at τ = 4.5, sampleKind never returns `withdrawn` or `expired`; `sampleTime(tt, 'withdrawn', 0.5, 4.5)` and `sampleTime(t, 'cancelled', 0.5, 0)` throw `RangeError`.
  - Property (fc, `arbTransition`, τ in [0, K + 30], uKind, uTime in [0, 1)): kind = `sampleKind(...)`; d = `sampleTime(t, kind, uTime, τ)` is an integer, `d >= stageDay(τ)`, `d < 16777216`; `sampleTime` is non-decreasing in uTime (two uniforms, ordered).
  - At τ ≥ K the time ignores the kind: `sampleTime(t, 'advance', u, τ) === sampleTime(t, 'expired', u, τ)` for 1,000 u and τ ∈ {12, 13.7, 60}.
  - `sampleTime(t, 'advance', 0, 0) === 0`.
  - Review Focus 3: flat tail (`tail: { advance: 1e-20, exit: {} }`): for τ ∈ {0, 13}, `sampleTime(flat, 'advance', 0.9, τ)` is finite, `< 16777216`, `Math.fround(d) === d`. ρ = 1 (`tail: { advance: 0.75, exit: { expired: 0.25 } }`): at τ = 20, `monthsIn(0, d) === 20` for u ∈ {0, 0.5, 1 − 1e-12}, and sampleKind splits at 0.75. ρ = 1e-6 slow tail (advance 0.8e-6, expired 0.2e-6): 100,000 draws at τ ∈ {0, 12}, the kind share among draws landing in the cap month is 0.8 ± 0.02.
  - Deep tail (R8 analogue), probe tail advance 0.2 / expired 0.05: at τ ∈ {120, 140}, 100,000 `sampleTime` draws put 0.25 ± 0.01 of events in month floor(τ) + 1 and use ≥ 25 distinct days there.
  - `RangeError` for u ∈ {−0.1, 1, NaN, Infinity} on both functions, and τ ∈ {−1, NaN, Infinity, 551213}.
  - Memoised: 12,000 (uKind, uTime, τ) draws over the small and mini cells give identical results on used transitions and on `structuredClone`d ones.

- [ ] **Step 3: Write the failing marginals file** `src/lib/timelapse/sampler.marginals.test.ts` (acceptance 1 and 6). Cells: every transition of `src/lib/timelapse/fixtures/calibration-small.json` and of `e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json` (read with `readFileSync`, parsed with `parseCalibration`). One `it` per (cell, τ), τ ∈ {0, 6, 6.4, K + 1}, each drawing N = 400,000 pairs (kind, time) from `mulberry32(0x5eed)` (uKind then uTime per draw). The reference is built only from `cumulativeIncidence` and `eventualProbabilities(t, 0)` (F_j(τ) by linear interpolation between floor τ and ceil τ):
  - for every kind j and month k = 1..36: |#(kind = j and monthsIn(0, d) + 1 ≤ k)/N − max(0, F_j(k) − F_j(τ))/(1 − C(τ))| ≤ tol(F), where F is that expected value and tol(F) = 5·sqrt(F(1 − F)/N) + 1e-4 (conductor ruling: a noise-scaled bound, not a fixed 0.002);
  - eventual shares: |#(kind = j)/N − (F_j(∞) − F_j(τ))/(1 − C(τ))| ≤ tol(F).
  - Acceptance 6, one `it` per cell: 400,000 `sampleTime(t, 'advance', u, 0)` draws; for k = 1..36, |#(month ≤ k)/N − F_adv(k)/F_adv(∞)| ≤ tol(F) (cells with F_adv(∞) = 0 are skipped and counted; expect at least one cell checked).
  - If a check fails, do not change the seed, N or the tolerance: report the failing (cell, τ, kind, month) and its deviation in units of sqrt(F(1 − F)/N) to the conductor: at 5σ a failure is a real finding, not noise.

- [ ] **Step 4: Run them to verify they fail**

Run: `npx vitest --run --project server src/lib/timelapse/time.test.ts src/lib/timelapse/model.test.ts src/lib/timelapse/sampler.marginals.test.ts`
Expected: FAIL (`stageDay`, `stageMonths`, `sampleKind`, `sampleTime` are not exported).

- [ ] **Step 5: Implement `stageDay` and `stageMonths` in `time.ts`, and `sampleKind` and `sampleTime` in `model.ts`**, as specified above. Use `exp`/`log` from `./math` only (bit-reproducibility, `model.ts:1-6`).

- [ ] **Step 6: Run the tests to verify they pass, then the timelapse suite and the type check**

Run: `npx vitest --run --project server src/lib/timelapse`
Expected: PASS (the old `sampleTransition` tests are untouched and still pass).
Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/timelapse
git commit -m "feat: add sampleKind and sampleTime, the paired sampler's two halves"
```

---

### Task 2: The engine samples unscaled transitions and scales time

**Files:**
- Modify: `src/lib/sim/scenario/rng.ts:14-30`; Test: `src/lib/sim/scenario/rng.spec.ts:37-42`
- Modify: `src/lib/sim/scenario/engine.ts` (header comment `:16-19`, imports `:23-25`, `:46`, `REDRAWS` `:83-84`, `Run`/`Job` comments `:218-226`, `:340-342`, `inFlightMonths` + `stageStep` `:463-513`, `job.scale` `:966` comment)
- Modify: `src/lib/sim/scenario/card.ts:9` (import) and `src/lib/sim/scenario/card.spec.ts:14`: `inFlightMonths` moves into `card.ts` unchanged (builder's call: the engine no longer uses it, the card still does; see Task 3)
- Modify: `src/lib/sim/scenario/types.ts:101-106` (contract comment)
- Create: `src/lib/sim/scenario/pairing.property.spec.ts`
- Modify tests: `engine-levers.spec.ts` (`:1-30`, `:65-75`, `:158-245`), `simulate.spec.ts:565-640`, `multiphase.spec.ts:450-475`
- Regenerate: `src/lib/sim/scenario/fixtures/golden-seed1.json`

**Interfaces:**
- Consumes: Task 1's `sampleKind`, `sampleTime`, `stageMonths`.
- Produces:
  - `P.STAGE_TIME = 12` in `rng.ts`; `stageRedraw` deleted. `rng.ts`'s comment names 7, 10 (Release 2) and 17–23 (retired) as reserved.
  - `export function scaledTransition(t: Transition, uKind: number, uTime: number, survived: number, s: number): { kind: 'advance' | ExitReason; days: number }` in `engine.ts`. `survived` = whole days already spent in the stage (0 when fresh; `asOf + 1 − e` in flight, ≥ 1 because `e ≤ asOf`). With τ = `stageMonths(survived)`, kind = `sampleKind(t, uKind, τ)`, d = `sampleTime(t, kind, uTime, τ)`, and days = survived + Math.floor(s·(d − survived)). With s = 1 it is exactly d. (Builder's call: the scale is applied in days rather than real months, so the engine keeps the sampler's integer day; floor(s·k) is monotone in s for k ≥ 0, so goals 1 and 2 still hold exactly. Task 4 makes it call `sampleTransition`.)
  - `stageStep` (`engine.ts:482`): uKind = `drawOn(job.stream, P.STAGE, idx)`, uTime = `drawOn(job.stream, P.STAGE_TIME, idx)`, s = `job.scale?.[job.pathway]?.[s] ?? 1` for **every** step, fresh or in flight; `step.day = e + days`. No redraw loop, no `asOf + 1` fallback.
  - `SimInput` contract (types.ts comment): `calibration` and `newProjects.calibration` are **unscaled**; `inFlightScale` and `newProjects.scale` multiply time in stage for every stage of the cohort's jobs (in-flight rows, masters, phases on `inFlightScale`; simulated projects and rows at `preApplication` on `newProjects.scale`, as `engine.ts:658-659, 753-754, 843-844, 965-966` already assign).

Between this task and Task 3, `applyLevers` still hands the engine rescaled transitions, so a /sim timer is applied twice. Task 3 removes that; do not ship between them.

- [ ] **Step 1: Write the failing property test** `src/lib/sim/scenario/pairing.property.spec.ts` (acceptance 2). Transitions: `arbTransition()` and every mini and fixture-0 cell (`fc.constantFrom`). survived: 0 or an integer in 1..1860; s in [0.25, 4]; uKind, uTime in [0, 1). With r1 = `scaledTransition(t, uK, uT, survived, 1)` and rs at s:
  - `rs.kind === r1.kind`;
  - s < 1 ⇒ `rs.days <= r1.days`; s > 1 ⇒ `rs.days >= r1.days`;
  - `rs.days >= survived`, `Number.isInteger(rs.days)`;
  - r1 equals `{ kind: sampleKind(t, uK, τ), days: sampleTime(t, kind, uT, τ) }` with τ = `stageMonths(survived)`.

- [ ] **Step 2: Rewrite the draw-sequence tests to the new step** (they fail until Step 4):
  - `rng.spec.ts` `'keeps purpose ids distinct'`: `P.STAGE === 6`, `P.STAGE_TIME === 12`, `P.INIT === 1`, `P.PHASE_GAP === 11`; the values of `P` are distinct; none is 7, 10 or in 17..23.
  - `engine-levers.spec.ts`: inputs keep `base.calibration` and set only the scale (`withScale(s)` = `{ ...base, inFlightScale: scale }`; `newProjects: { calibration: base.calibration, scale }`); drop `timed()` from the engine inputs. Replace the window-caveat test (`:177-205`) with `'scale 0.5: every in-flight row leaves no later, with the same outcome, seeds 1-20'` (per row: leave day ≤ base leave day, same end kind/stage/reason, leave day > asOf; at least 20 rows strictly earlier). Replace `:207-235` with `'the in-flight step is scaledTransition on P.STAGE, P.STAGE_TIME and asOf + 1 − e'`, recomputing each row's leave day from `scaledTransition(t, drawOn(stream, P.STAGE, idx), drawOn(stream, P.STAGE_TIME, idx), base.asOf + 1 - e, 0.5)` on the unscaled `t`. Move the `inFlightMonths` unit test (`:159-163`) to `card.spec.ts`. Keep `'scale 1 is the base run'` and the median speed-up test.
  - `simulate.spec.ts` `describe('simulate: in-flight redraw (§4.4.2)')` becomes `'simulate: in-flight conditioning (§4.4.2)'`: replace the two redraw tests (`:568-608`) with
    - `'conditions on the exact days survived'`: for filedPair (e = 2025-11-20) and seeds 1..200, the filed event equals `e + scaledTransition(t, draw(seed, ent, 0, P.STAGE, FILED), draw(seed, ent, 0, P.STAGE_TIME, FILED), AS_OF + 1 - e, 1)` in kind and day, and its day is > AS_OF.
    - `'a stage whose table mass lies before asOf draws from the tail, after asOf'`: the `MONTH_ONE` setup at e = AS_OF − 30; every seed's entitled day is > AS_OF and is not always AS_OF + 1 (the old fallback).
    - Review Focus 1: `'a row with no history day for its stage leaves after asOf'`: filedPair with `history: {}` (e = AS_OF, survived 1); for seeds 1..50 the first event day is > AS_OF and nothing throws.
    - Review Focus 4: `'scale 10 in a slow tail ends open'`: filedPair at e = AS_OF − 330 with the filed transition's tail set to `advance: 1e-7` and `inFlightScale` discretionary filed = 10; for seeds 1..20 the schedule's end is `open` or its every recorded day is an integer ≤ H, and its end kind equals the scale-1 run's whenever both close.
    - Keep `'20,000 in-flight projects match the incidence conditioned on survival to asOf'` (`:610`); it now holds exactly.
  - `multiphase.spec.ts:460-467`: the phase's first step is `scaledTransition(t, draw(..., P.STAGE, i), draw(..., P.STAGE_TIME, i), 0, 1)`.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest --run --project server src/lib/sim/scenario/pairing.property.spec.ts src/lib/sim/scenario/rng.spec.ts src/lib/sim/scenario/engine-levers.spec.ts src/lib/sim/scenario/simulate.spec.ts src/lib/sim/scenario/multiphase.spec.ts`
Expected: FAIL (`scaledTransition`, `P.STAGE_TIME` missing).

- [ ] **Step 4: Implement** `P.STAGE_TIME`, delete `stageRedraw` and `REDRAWS`, add `scaledTransition`, rewrite `stageStep`, move `inFlightMonths` to `card.ts`, and update the engine header, `Run`/`Job` and `SimInput` comments to the contract above.

- [ ] **Step 5: Run the scenario tests; the golden comparisons fail as expected**

Run: `npx vitest --run --project server src/lib/sim`
Expected: only the golden-seed1 comparisons fail (`simulate.golden.test.ts`, `engine-levers.spec.ts` `'simulateDetailed equals the golden'`, and any `engine-regimes.spec.ts` golden case).

- [ ] **Step 6: Regenerate golden-seed1 and review it**

Run: `npx tsx src/lib/sim/scenario/fixtures/build-golden.ts`
Expected: `wrote …golden-seed1.json: <n> schedules`. Review `git diff --stat` and a sample of schedules: kinds and days move (new draws), the schedule count and project ids stay plausible; no NaN or non-integer day.

- [ ] **Step 7: Run the unit suite and the type check**

Run: `npm run test:unit`
Expected: PASS (the client `simulate.golden.svelte.spec.ts` reads the same regenerated file).
Run: `npm run check`
Expected: 0 errors.
Expected to fail until Task 5, and only these: the pipeline fixture golden comparisons under `npm run test:pipeline` (`pipeline/test/golden.test.ts`, lesscars outputs included). Run `npm run test:pipeline` once and record the failing test names in the commit body; any other failure is a bug in this task.

- [ ] **Step 8: Commit**

```bash
git add src/lib/sim/scenario
git commit -m "feat: draw a stage's kind and time apart and scale time in the engine" -m "Retires stageRedraw (17-23 reserved). golden-seed1 regenerated. Fixture goldens move in a later commit."
```

---

### Task 3: Levers pass the unscaled calibration; display lookups and the card agree with the engine

**Files:**
- Modify: `src/lib/sim/levers/apply.ts:1-8` (header), `:54-70` (`planOf`), `:102-112` (`lookupsFor`, `lookupsOf`); Test: `src/lib/sim/levers/apply.spec.ts:44-169`
- Modify: `src/lib/sim/levers/timers.ts` (add `sameScale` beside `isIdentity` `:55-57`); Test: `timers.spec.ts`
- Modify: `src/lib/sim/scenario/card.ts:116-133` (`shiftOf` comment); Test: `card.spec.ts:803-867`
- Create: `src/lib/sim/levers/pairing.spec.ts`, `src/lib/sim/levers/display-engine.spec.ts`
- Modify: `docs/dev/sim-levers.md:51-60`, `:228`; `docs/dev/sim-timers.md` ("The timing model", `:10-30`)

**Interfaces:**
- Consumes: Task 2's engine contract and `scaledTransition`; `timersOp`, `scaleTable`, `isIdentity`, `rescaleTransition` (`timers.ts`).
- Produces:
  - `planOf`: plan = `bare(applyPolicies([envelopeOp(filled.plan.table, lp)], base))` (no `timersOp`); `newProjects = { calibration: applyPolicies([routeSharesOp(levers.routeShares)], plan).calibration, scale: scaleTable(levers.timers, 'new') }`; `inFlightScale` set when `scaleTable(levers.timers, 'inFlight')` is not identity (as today). Hence `plan.calibration === base.calibration` and `plan.newProjects.calibration.transitions === base.calibration.transitions`.
  - `export function sameScale(a: StageScale, b: StageScale): boolean` (timers.ts): equal factors on every (pathway, stage), an absent entry counting as 1.
  - `lookupsOf(plan: SimInput): LeverLookups` (signature unchanged): inFlight = `lookupsFor(timersOp(plan.inFlightScale ?? identity)(plan.calibration, plan.parcels).cal)`; fresh is the same object when `newProjects` is absent, or when its calibration's transitions are `plan.calibration`'s and `sameScale(newProjects.scale, plan.inFlightScale ?? identity)`; otherwise `lookupsFor` of `timersOp(newProjects.scale)` on `newProjects.calibration`. These are the display view; the engine never reads them.
  - `ProjectCard.chanceShift` keeps its type and value (`inFlightMonths(m, x) − m`); see the builder's call below.

Builder's call (card): the spec expects the shift to vanish, but it is what makes the card agree with the engine, the spec's own rule ("the card must agree with the engine"). The card reads the **rescaled** display table (`fzp/card.ts:106-108`). The engine now draws an in-flight kind from the unscaled table at τ ≈ m. The rescaled table at round(m·s) months equals the unscaled curve at round(m·s)/s ≈ m (`rescaleTransition` samples C_j(k/s) exactly, `timers.ts:118-128`). So keeping `chanceShift` shows the twin's eventual chance. Dropping it would show the unscaled chance at m/s, which differs from the engine's. The same arithmetic gives the date shift after asOf: the rescaled index is s·τ0 + (m − τ0). Only comments change in `card.ts`. Accepted: conductor ruling 1.

- [ ] **Step 1: Write the failing pairing test** `src/lib/sim/levers/pairing.spec.ts` (acceptance 3), ported from the archived harness (`r1-pairing-scratch.spec.ts.txt`, main checkout). Base: mini city, mini projects, mini calibration with `market: miniMarket()` (`src/lib/sim/scenario/fixtures/mini-market.ts`; builder's call: the mini calibration has no market, so the spec's "today's market steps on" needs one), `buildSimInput`; ctx `{ parcels, policy: miniPolicy(city) }`. For every (pathway, TimedStage) with a mini transition (13 cells; `TimedStage` excludes construction, `levers/types.ts:10`), scale ∈ {12/23, 0.5}, reach ∈ {'new', 'all'}: levers = `DEFAULT_LEVERS` with `compare: 'fzp'` and the one timer. One `it` per (cell, scale, reach); the twin's `simulateNet` per seed is computed once for the file. For seeds 1..40 and every month m: `plan.completedNet[m] - twin.completedNet[m] >= 0`. Allowed exceptions: none are listed up front. If one appears, trace it (see Step 6) before adding it to an explicit, commented allow-list keyed by (cell, scale, reach, seed), with its mechanism and file:line, and asserted to be the only exception.

- [ ] **Step 2: Write the failing apply, lookups and card tests**
  - `apply.spec.ts`: `'the plan runs on the unscaled calibration'`: with an `'all'` timer and route shares, `plan.calibration).toBe(base.calibration)`, `plan.newProjects!.calibration.transitions).toBe(base.calibration.transitions)`, `plan.newProjects!.calibration.pathwayForNew` normalised to the shares. Update `"gives new projects their own lookup set with a 'new' timer"` (`:157-168`): `lookups.fresh.chance` equals `chanceTable(timersOp(scaleTable(levers.timers, 'new'))(plan.newProjects!.calibration, plan.parcels).cal)`.
  - Review Focus 5: `'stacked new and all timers on one stage with route shares'`: timers `{discretionary, filed, 0.5, 'all'}` and `{discretionary, filed, 0.8, 'new'}` plus route shares: `lookups.fresh).not.toBe(lookups.inFlight)`, and inFlight.chance equals the chance table of `timersOp(scaleTable(timers, 'inFlight'))(base.calibration, …)`. With only the `'all'` timer and route shares, `lookups.fresh).toBe(lookups.inFlight)`.
  - `timers.spec.ts`: `sameScale` true for `scaleTable([], 'new')` vs an all-1 table, false when one factor differs.
  - `card.spec.ts`: keep the shift cases (`:826-866`, import `inFlightMonths` from `./card`); add Review Focus 5 `'an in-flight card under a timer shows the twin's eventual chance within the grid'`. For the entitled row at m = 7 and s ∈ {0.5, 2}, `cardStatus(card, AS_OF, chance)` with the plan's display lookups is within `g` of `chanceTable(base.calibration)` at month 7, where g = max |chance(k + 1) − chance(k)| over k in 5..9 of the base table (the rounding of m·s moves the index by at most 0.5/s months).

- [ ] **Step 3: Write the failing display-versus-engine test** `src/lib/sim/levers/display-engine.spec.ts` (acceptance 7). For every fixture-0 cell (`e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json`) and s ∈ {0.5, 2}, one `it`. Draw N = 100,000 `scaledTransition(t, u1, u2, 0, s)` from `mulberry32(0x5eed)`. Let r = `rescaleTransition(t, s)`. For every kind j and month k = 1..r.months: |empirical P(kind = j, month ≤ k) − F_j^r(k)| ≤ tol, and the eventual shares are within 4·sqrt(0.25/N). The bound, stated in the file's header: tol = 4·sqrt(0.25/N) (sampling) + ((s + 1)/30)·maxInc_j (day rounding: the engine floors s·d with d an integer day, so the month boundary can move by up to s + 1 days; maxInc_j is the largest monthly increment of r's column j). r's tail past K′ is not compared, since that is where `rescaleTransition`'s K′ truncation lives. If the builder derives a tighter bound, they state it there.

- [ ] **Step 4: Run them to verify they fail**

Run: `npx vitest --run --project server src/lib/sim/levers src/lib/sim/scenario/card.spec.ts`
Expected: FAIL on the apply assertions, `sameScale`, and the pairing test for cells with in-flight rows. (Record which pairing cases fail before the change; if all pass, say so in the commit body. The apply assertions are the failing test in that case.)

- [ ] **Step 5: Implement** `planOf`, `sameScale`, `lookupsOf` and the `card.ts`/`apply.ts` comments as specified.

- [ ] **Step 6: Run the tests; trace any pairing exception**

Run: `npx vitest --run --project server src/lib/sim/levers src/lib/sim/scenario/card.spec.ts`
Expected: PASS. If a pairing month is negative, trace it with the harness's per-lot trace (plan versus twin schedules on that lot and seed). It may stay only if it comes from a mechanism outside stage sampling (for example a freed lot re-initiating against dated market segments) and never from a kind flip. Put the measurement, the mechanism and file:line in the allow-list comment, and report it so the PR can list it.

- [ ] **Step 7: Update the docs**
  - `sim-levers.md`: rename "In-flight remaining-time rule" to "Timers scale time, never outcomes". The engine samples every stage from the unscaled transition: kind from `P.STAGE`, time from `P.STAGE_TIME`, the time in stage multiplied by s (in flight, the remaining time from the exact days survived). So a timing-only lever never changes an outcome, and every event moves monotonically, **per row**. Delete the "statistical, not per-row" paragraph. Add that `rescaleTransition` is the display view (lookups, typical months, timeline, card) and agrees with the engine within the month grid. Line 228: the card shift is unchanged, and why.
  - `sim-timers.md` "The timing model": one bullet saying a timer scales each project's time and never its outcome, with a link to the sim-levers section.
  - `fzp-mode.md:102` still describes the card correctly; leave it.

- [ ] **Step 8: Run the unit suite and the type check**

Run: `npm run test:unit`
Expected: PASS.
Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/sim docs/dev/sim-levers.md docs/dev/sim-timers.md
git commit -m "feat: run levers on the unscaled calibration; timers scale time, never outcomes"
```

---

### Task 4: One sampler

**Files:**
- Modify: `src/lib/timelapse/model.ts` (replace `:236-391`: `sampleTransition`, `literalDraw`, `tableSlice`, `tailSlice`, `relativeTail`, `tableMonth`, `Slice`/`Draw`, `boundsOf` `:147-171`, `Constants.bounds` `:85-86`; keep `tailMonth` `:270-282`, which `typicalMonths` uses)
- Modify: `src/lib/sim/scenario/engine.ts` (`scaledTransition` calls `sampleTransition`; header comment `:16-17`)
- Modify: `pipeline/lib/fzp-cal/invariants.ts:193-231`
- Modify: `src/lib/timelapse/model.golden.cases.ts:135-163`; regenerate `src/lib/timelapse/fixtures/model-golden.json`
- Modify tests: `src/lib/timelapse/model.test.ts:224-466`, `reproduce.test.ts`, `types.test.ts:150-154, 181`, `pipeline/test/simulate-replay.test.ts:396`, `pipeline/test/fzp-cal/ph-pool.test.ts:189`, `pipeline/test/fzp-cal/aj-recovery.test.ts:60`

**Interfaces:**
- Consumes: Task 1's halves; Task 2's `scaledTransition`.
- Produces: `sampleTransition(t: Transition, uKind: number, uTime: number, monthsElapsed: number): { kind: 'advance' | ExitReason; days: number }`, which is `{ kind, days: sampleTime(t, kind, uTime, monthsElapsed) }` with kind = `sampleKind(t, uKind, monthsElapsed)`. Its doc comment states the law, the memoisation contract (`model.ts:362-375` today) and that it is the engine's and V27's sampler. V27 draws uKind then uTime from one `mulberry32(V27_SEED)` stream per cell, at τ = 0.

- [ ] **Step 1: Update the locks and callers' tests first** (they fail until Step 3):
  - `types.test.ts`: `RowSampleTransition = (t: RowTransition, uKind: number, uTime: number, monthsElapsed: number) => { kind: 'advance' | RowExitReason; days: number }`, plus `RowSampleKind` and `RowSampleTime` rows locked the same way (builder's call: they are Release 2's interface).
  - `model.test.ts` `describe('sampleTransition')`: keep the still-meaningful cases on the new signature: uKind = uTime = 0 at τ = 0 advances in month 1; days ≥ `stageDay(τ)` for τ ∈ {0, 30, 30.5}; `sampleTransition(t, uK, uT, τ)` deep-equals the composition of the halves over 10,000 draws; rejects bad u on either uniform; memoised constants (the 12,000-draw identity test, with fractional τ). Delete the cases that pin the old month-major mapping (`:244-299`, `:355-367` literal §4.2 path, `:279-285` slice split); their replacements live in Task 1's tests and the marginals file.
  - `reproduce.test.ts`: `sampleTransition(t, rng(), rng(), monthsElapsed)`; tolerances unchanged.
  - `pipeline/test/*`: the three call sites draw `(t, rand(), rand(), 0)`.
  - `model.golden.cases.ts`: the 50 cases per calibration take uKind from the current grid and uTime from a second grid (`uniform(i, grid.step2, grid.mod, grid.off2)`, builder picks step2 coprime to mod and off2 ≠ off), and τ from `[0, 0, 1, 2, 5.5, 11, 12, 12.25, 20, 60]`; input label `u=… v=… tau=…`. `model.golden.shared.ts` keeps its count of 100.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest --run --project server src/lib/timelapse`
Expected: FAIL (old signature; model-golden bits differ).

- [ ] **Step 3: Implement** the new `sampleTransition`, delete the old internals listed above, point `scaledTransition` and `checkV27` at the new sampler, and update the V27 doc comment (`invariants.ts:193-198`).

- [ ] **Step 4: Regenerate model-golden and verify**

Run: `npx tsx scripts/model-golden.ts`
Expected: `wrote …model-golden.json`. The diff touches only `sampleTransition` cases (100); `initiationHazard`, `chanceTable`, `typicalMonths` and the other cases are byte-identical. If anything else moves, stop: that is a regression.
Run: `npx vitest --run --project server src/lib/timelapse src/lib/sim`
Expected: PASS.
Run: `npx vitest --run --project client src/lib/timelapse/model.golden.svelte.spec.ts`
Expected: PASS.
Run: `npx vitest --run --project pipeline pipeline/test/fzp-cal pipeline/test/simulate-replay.test.ts`
Expected: PASS (V27 on the small fixture; the replay's synthetic block; the live block skips without a build).
Run: `rg -n "sampleTransition\(" src pipeline scripts`
Expected: every call has four arguments.
Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/timelapse src/lib/sim/scenario/engine.ts pipeline/lib/fzp-cal/invariants.ts pipeline/test
git commit -m "refactor: make sampleTransition the one two-uniform sampler" -m "Removes the one-uniform month-major sampler. V27 and model-golden use the new signature."
```

---

### Task 5: Fixture goldens and the full suites

**Files:**
- Regenerate: `pipeline/test/fixtures/mini/golden/**`, `e2e/fixtures/data/fixture-0/**`
- Modify (only if their pinned values came from the engine): `src/lib/lesscars/*.spec.ts` and `e2e/*.spec.ts` that read fixture-0 outputs

- [ ] **Step 1: Regenerate the fixture**

Run: `npm run pipeline -- fixture --update-golden`
Expected: completes with every invariant passing.

- [ ] **Step 2: Review the diff as an engine change**

Run: `git diff --stat pipeline/test/fixtures/mini/golden e2e/fixtures/data/fixture-0`
Expected: changes only in engine outputs (`scenarios/lesscars/{plan,sites,summary}.json`, `timeline.bin` and their golden twins, and any report count derived from engine runs). `scenarios/fzp/calibration.json`, `golden/derived/calibration-report.md`, `parcels.bin`, `policy.bin` and `gross.bin` must be unchanged, because the sampler does not fit the calibration. If any of them changed, stop and report.

- [ ] **Step 3: Run every suite and fix only engine-derived pins**

Run: `npm run test:unit`, then `npm run test:pipeline`, then `npm run lint`, then `npm run check`, then `npm run test:e2e -- --project=chromium --project=mobile`
Expected: all PASS. A spec that pins a value read from the regenerated fixture (for example lesscars headline numbers) is updated to the new value, with the old and new values listed in the commit body. A failure that is not such a pin is a bug: diagnose it, do not re-pin it.

- [ ] **Step 4: Commit**

```bash
git add pipeline/test/fixtures/mini/golden e2e/fixtures/data/fixture-0 src e2e
git commit -m "test: regenerate the fixture goldens for the paired sampler"
```

---

### Task 6: Dataset build, live checks, performance (stop before upload)

Per `docs/dev/pipeline.md` "Finishing a branch that changes the dataset" (`:40-53`). This task runs steps 1–2 and the checks below. **Stop before step 3:** the conductor runs `npm run pipeline -- upload <v>`, `verify`, `npm run signoff`, the PR and the merge. Do not upload, verify, push, sign off or open a PR.

- [ ] **Step 1: Merge main and restore the cache**

Run: `git fetch origin`, then `git merge origin/main` (resolve conflicts; rerun `npm run test:unit` if anything merged), then `npm run pipeline -- fetch --restore`.
Expected: clean merge; cache restored.

- [ ] **Step 2: Build**

Run: `npm run pipeline -- build` (about 8 minutes, estimated). Use the maximum foreground timeout. If that is too short, run it in the background and wait for its exit notification; never finish the task with it still running.
Expected: every invariant passes, V27 included (acceptance 1, "V27 passes on the live build"), with tiles built. Record `<v>` from `npm run pipeline -- version`.

- [ ] **Step 3: Replay against main on the same data** (acceptance 4)

Run: `npm run test:pipeline -- pipeline/test/simulate-replay.test.ts` (the live block picks the new build).
Then the same file on main against this build. Make a temporary detached worktree at `origin/main` under `.claude/worktrees/replay-main` and run `npm ci` there. Run the file with `SFH_REPLAY_PIPELINE_DIR=/Users/mindlace/Projects/sfhousing/.claude/worktrees/paired-draw-fix/pipeline SFH_REPLAY_VERSION=<v>`, then remove that worktree.
Expected: the branch's failing cohorts are a subset of main's (main has one known pre-existing failure, ruling R15). Record both lists for the PR.

- [ ] **Step 4: Performance** (acceptance 5)

Only on a quiet machine (no other test runs, builds or preview servers): `npm run test:perf`.
Expected: every `scenario.bench.spec.ts` budget holds. If the machine is not quiet, do not run it: say so in the report and give ballpark single-run timings of `simulateNet` on the bench city instead.

- [ ] **Step 5: Report and stop**

Report: `<v>`, the invariant summary, the replay comparison, the perf result (or why it was deferred), any pairing exceptions from Task 3, and the commits. Commit only if the merge produced a merge commit (no other changes are expected here).

---

## Conductor rulings (2026-11-10)

1. **Card shift: accepted as planned.** `chanceShift` stays, because it is what makes the card agree with the engine (the spec's governing rule). The spec line expecting no shift is superseded.
2. **Acceptance 1 and 6 tolerance:** tol(F) = 5·sqrt(F(1 − F)/N) + 1e-4 per comparison (≈0.004 at F = 0.5, N = 400,000). A fixed 0.002 over ~23k comparisons would fail on noise. At 5σ the family-wide false-alarm chance is about 1%, and a real sampler defect is far larger. Do not reseed or change N.
