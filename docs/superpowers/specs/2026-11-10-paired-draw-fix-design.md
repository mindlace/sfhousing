# Paired-draw fix: draw the exit kind apart from the timing

Status: draft for review, 2026-11-10. Partner ruling R17 (`.superpowers/superconductor/sim-financing/ledger.md`) asks for this fix to land as its own feature before sim-financing Release 2. Hand-off brief: `.superpowers/superconductor/sim-financing/handoff-before-r2.md`, item 1.

## Why

`/sim` reports a plan's effect as plan − twin, two runs that share random draws seed for seed, so that a difference comes from the levers and not from luck. Today one uniform sets both the month a project leaves a stage and the kind of exit (advance, withdrawn, disapproved, cancelled, expired). It does this through a month-major inverse CDF (`sampleTransition`, `src/lib/timelapse/model.ts:344-388`). A timer lever (`rescaleTransition`, `src/lib/sim/levers/timers.ts:73-148`) moves the cumulative curve, so the same uniform can land in another month's slice and a different kind. One example: seed 1, lot 3600010 completes 240 homes in the twin and is disapproved at `filed` in the plan.

The result is unbiased on average but noisy for each seed. On the mini city, a single timer cut from 23 to 12 months gives plan − twin < 0 in 37–40 of 40 seeds, worst −1,033 homes in a month (evidence: `.superpowers/superconductor/sim-financing/sdd-archive/market-baseline/2026-11-10-market-baseline/r1-pairing-evidence.md`). The partner has seen the same thing on `/sim`: making permitting faster often shows fewer homes than the baseline. That reads as a broken tool, and the coupling undermines every paired delta that Release 2's funding engine will report.

## Goals

1. A lever that changes only timing never changes any project's kind of exit, at any stage, for fresh or in-flight projects.
2. Under a pure speed-up (every timer scale ≤ 1, everything else equal), every advance happens on the same day or earlier in the plan than in the twin. Plan − twin `completedNet` is then ≥ 0 in every month of every seed.
3. The sampled distribution is unchanged: for each transition, the joint law of (month, kind) is exactly the table's, so calibration, replay and V27 results move only by sampling noise.
4. Release 2's `sampleAdvance` (design row F9 (i)) has an obvious place to sit: it is the new timing-given-kind sampler with the kind fixed to advance.

## Non-goals

- Changing any calibration table, the tail model or `rescaleTransition`'s formulas. Issue #90 (per-pathway permit tables) is a separate change; see Sequencing.
- Pairing across levers that change a lot's pathway (route share, law switch: `P.PATHWAY`). There the two arms use different tables, so a different kind is a real effect, not noise. (Inferred bonus: with advance first in kind order, a pathway with a higher advance share flips kinds only toward advance.)
- Pairing under dated regimes (`/lesscars`), where entering a stage earlier can select a different table. These are real effects too.
- Changing initiation, size, revision or phase-gap draws.

## Anti-goals

- Any change to the marginals. If the sampler's distribution moves, the fix has failed even if pairing improves.
- A lot whose draws depend on another lot or on processing order (global constraint "Deterministic and paired").
- Measurable slowdown on the perf budgets (`scenario.bench.spec.ts`).

## The design

### Sampling one stage step

For a transition t and a project that has already spent m months in the stage (m = 0 when fresh), use two independent uniforms:

1. **Kind**, from `uKind`. Take the eventual shares conditional on surviving m months, P_j(m) (`eventualProbabilities(t, m)`, including the tail), in the fixed order advance, then `EXIT_ORDER`. The kind is the j whose cumulative slice holds `uKind`.
2. **Timing given the kind**, from `uTime`. The time to the event is the inverse of kind j's conditional CDF from m, G_j(x) = (F_j(x) − F_j(m)) / (F_j(∞) − F_j(m)) for x ≥ m, where F_j(∞) = P_j(0). That is the share of kind j's remaining mass reached by time x. Use F_j piecewise-linear within table months (the day is then continuous and monotone in `uTime`), and past K the kind's share of the geometric tail, in closed form, as the model does today (memorylessness as in `relativeTail`, so precision holds for large m).

The pair (kind, time) has exactly the joint law the table defines, so goal 3 holds by construction. The builder proves it in a test (see Acceptance).

**Why the timing is monotone under a speed-up.** `rescaleTransition` keeps P_j(0) and sets F'_j(k) = F_j(k/s) at integer months. For s ≤ 1, F'_j(k) ≥ F_j(k) at every integer k. Both curves are linear between integer months, so F'_j ≥ F_j everywhere, and the inverse at the same `uTime` is no later. (The tail and the `max(0, …)` clamp need the same check in code; see Acceptance.)

### The API (`src/lib/timelapse/model.ts`)

- `sampleTransition(t, uKind, uTime, m)` replaces today's `(t, u, m)` and returns `{ kind, days }` as now. One sampler, used by the engine and by V27 (`pipeline/lib/fzp-cal/invariants.ts:231`), so the check validates the sampler the engine runs.
- `sampleKind(t, uKind, m)` and `sampleTime(t, kind, uTime, m)` are exported as the two halves. Release 2's F9 (i) `sampleAdvance(t, u)` is `sampleTime(t, 'advance', u, 0)`, using the stage's timing draw. A funded, certain project then advances on the same day as its ordinary twin whenever the twin advances.
- Per-transition constants (per-kind cumulative arrays, tail shares) are memoised per `Transition` object, as today (`model.test.ts:427`).

### Draw purposes (`src/lib/sim/scenario/rng.ts`)

| Purpose | Value | Use |
|---|---|---|
| `STAGE` | 6 (unchanged number) | now the **kind** uniform, one per (lot, stage) |
| `STAGE_TIME` | 12 (new) | the **timing** uniform, one per (lot, stage) |
| `stageRedraw(j)` | 17–23 (unchanged numbers) | now redraws of the **timing** only |

7 and 10 stay reserved for Release 2 (F11). Free numbers after this: 13–16, 24+.

### In-flight projects (`stageStep`, `engine.ts:475-513`)

- The kind is drawn once from `STAGE`, conditioned on the real m months in the stage, using the **unscaled** transition. A timer then cannot change an in-flight project's kind; today's rounding `inFlightMonths(m, s) = round(m·s)` would otherwise flip a few. (My call: this keeps goal 1 exact. It also matches the meaning of a timing lever.)
- The timing is drawn from the rescaled transition conditional on m2 = `inFlightMonths(m, x)` and mapped back as today. The up-to-8-attempt redraw loop for days on or before `asOf` redraws only `uTime` (`STAGE_TIME`, then `stageRedraw(j)`). The fallback to `asOf + 1` stays.
- Builder's option: if conditioning on the exact elapsed days (not whole months) removes the need for the redraw loop and keeps the marginals, the builder may do that instead, and should say so in the plan.

### What moves (allowed by R17, once)

- Draw purposes as above. `rng.spec.ts` locks extend to `STAGE_TIME`.
- `golden-seed1.json`, the pipeline fixture goldens (`pipeline/test/fixtures/mini/golden/**`), the lesscars goldens and `fixture-0`, regenerated by their documented commands and reviewed as an engine change.
- `model-golden.json`'s 100 `sampleTransition` cases: **open question for the partner**, below.
- Tests that hard-code the draw sequence: `engine-levers.spec.ts:215-232`, `simulate.spec.ts:576-578`, `rng.spec.ts`, plus every `sampleTransition` caller listed by the recon (`model.test.ts`, `reproduce.test.ts`, `types.test.ts` type lock, `multiphase.spec.ts`, `simulate-replay.test.ts`, `ph-pool.test.ts`, `aj-recovery.test.ts`).
- Its own dataset build and upload: `model.ts`, `rng.ts` and `engine.ts` are hashed (`pipeline/lib/version.ts` `PATHS`). Follow `docs/dev/pipeline.md` "Finishing a branch that changes the dataset".
- Docs: `docs/dev/sim-levers.md` and `docs/dev/sim-timers.md` say what a timing lever does and does not change; `docs/dev/fzp-mode.md` if it describes the draws.

## Acceptance

1. **Marginals unchanged (committed sampler test).** For every transition cell in the small calibration and the fixture calibration, at m ∈ {0, 6, a month past K}: N = 400,000 draws per cell match the table's cumulative incidence per kind within 0.002 at every month to 36, plus the eventual shares. This also commits the `statistical-correction` 400k check, which today exists only as a one-off. V27 passes on the live build.
2. **Kind never flips (property test).** For random transitions (and every fixture cell), random m, s ∈ [0.25, 4] and random uniform pairs, the kind under `rescaleTransition(t, s)` equals the kind under t. For s ≤ 1 the time is no later; for s ≥ 1 it is no earlier. Fresh and in-flight paths are both covered.
3. **Paired runs.** Rerun the evidence harness (`r1-pairing-scratch.spec.ts.txt`, archived beside the evidence) as a committed test on the mini city, 40 seeds, every timer cell at 12/23 and 0.5: plan − twin `completedNet` ≥ 0 in every month of every seed. Any exception is measured, explained by mechanism and listed in the PR, and none comes from a kind flip.
4. **Replay.** `simulate-replay.test.ts` is no worse than on main for the same data (it has one known pre-existing failure on live data, ruling R15). If the replay-validation spec has landed first, its conformance mode passes.
5. **Performance.** All `scenario.bench.spec.ts` budgets hold (`npm run test:perf` on a quiet machine).
6. Release-2 hook: `sampleTime(t, 'advance', u, 0)` exists and is tested to match the advance column's conditional law.

## Sequencing and coordination

- **Release 2 (sim-financing).** Its design must be rebased on this fix by the supercomposer amendment (hand-off item 2): "no existing draw purpose changes" and "golden-seed1 / model-golden never change" become "as of the paired-draw fix". F11's 7 and 10 do not collide with 12. F9 (a) is unaffected: a funded market start reuses the ordinary start's draws. F9 (i) uses `sampleTime` as above.
- **Issue #90.** Independent of this fix: it changes tables, not sampling. My recommendation: land this fix first, then #90, with #90's dataset folded into Release 2's build so the goldens move once more, not twice. #90's text "do not change draw purposes or golden-seed1" needs the same rebase.
- **Replay-validation spec** (branch `worktree-replay-validation`, not implemented). Its non-goal "changing draw purposes, the one-uniform-per-step sampling, or golden-seed1" needs amending; its conformance mode is the long-run guard on goal 3. Whichever lands second runs the other's checks.

## Left to the builder

- How to compute the per-kind tail inverse in closed form and keep precision for large m.
- Test file names and structure, within `docs/dev/testing.md`.
- Whether `sampleKind`/`sampleTime` share memoised constants with the existing helpers or build their own.
- The in-flight exact-days option above.

## Open questions for the partner

1. `model-golden.json` is one of the two "no public money means no change" locks. R17 lists `golden-seed1.json` and the goldens but not this file. Either (a) regenerate its 100 `sampleTransition` cases with the new signature (one sampler; my recommendation), or (b) keep the old one-uniform `sampleTransition` beside the new one so the file does not move, at the cost of a second sampler that only the golden uses.
