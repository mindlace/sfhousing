# Paired-draw fix: draw the exit kind apart from the timing

Status: approved by the partner, 2026-11-10. Partner ruling R17 (`.superpowers/superconductor/sim-financing/ledger.md`) asks for this fix to land as its own feature before sim-financing Release 2. Hand-off brief: `.superpowers/superconductor/sim-financing/handoff-before-r2.md`, item 1.

## Why

`/sim` reports a plan's effect as plan − twin. The two runs share random draws seed for seed, so that a difference comes from the levers and not from luck. Today one uniform sets both the month a project leaves a stage and the kind of exit (advance, withdrawn, disapproved, cancelled, expired), through a month-major inverse CDF (`sampleTransition`, `src/lib/timelapse/model.ts:344-388`). A timer lever gives the engine a rescaled table (`rescaleTransition`, `src/lib/sim/levers/timers.ts:73-148`) whose cumulative curve differs. The same uniform then lands in another month's slice and often a different kind. One example: seed 1, lot 3600010 completes 240 homes in the twin and is disapproved at `filed` in the plan.

The result is unbiased on average but noisy for each seed. On the mini city, a single timer cut from 23 to 12 months gives plan − twin < 0 in 37–40 of 40 seeds, worst −1,033 homes in a month (evidence: `.superpowers/superconductor/sim-financing/sdd-archive/market-baseline/2026-11-10-market-baseline/r1-pairing-evidence.md`). The partner has seen the same on `/sim`: making permitting faster often shows fewer homes than the baseline. That reads as a broken tool. It also undermines every paired delta Release 2's funding engine will report.

## Goals

1. A lever that changes only timing never changes any project's kind of exit, at any stage, for fresh or in-flight projects. This holds exactly, by construction, not up to rounding.
2. Under a pure speed-up (every timer scale ≤ 1, everything else equal), each stage event happens on the same day or earlier in the plan than in the twin. Under a pure slow-down, the same day or later.
3. The sampler draws exactly the table's law. For an unscaled transition, the joint law of (time, kind) is the table's, so calibration, replay and V27 results move only by sampling noise.
4. Release 2's `sampleAdvance` (design row F9 (i)) has an obvious place: it is the new timing-given-kind sampler with the kind fixed to advance.

## Non-goals

- Changing any calibration table or the tail model. Issue #90 (per-pathway permit tables) is separate; see Sequencing.
- Pairing across levers that change a lot's pathway (route share, law switch: `P.PATHWAY`). There the two arms use different tables, so a different kind is a real effect. (Inferred bonus: with advance first in kind order, a pathway with a higher advance share flips kinds only toward advance.)
- Pairing under dated regimes (`/lesscars`), where entering a stage earlier can select a different table: also a real effect.
- Changing initiation, size, revision or phase-gap draws.

## Anti-goals

- Any change to the marginals of an unscaled run.
- A lot whose draws depend on another lot or on processing order (global constraint "Deterministic and paired").
- Measurable slowdown on the perf budgets (`scenario.bench.spec.ts`).

## The design

### A timer scales each project's time; it no longer swaps the table

Today the engine samples a timer's plan from a rescaled monthly table. That table is a month-grid approximation of the stretched curve F_j(x/s). It is inexact where `round(K·s)` rounds down or the mass limit truncates it (for example K = 23, s = 0.45: some advances come later under a speed-up). From now on the engine samples **every** stage from the unscaled transition and multiplies the time by the stage's scale s. For an in-flight project it multiplies the remaining time, which is ruling 3's "Remaining-time rescale" with the rounding gone. The plan and the twin then differ only by s on the same sampled time: goals 1 and 2 hold exactly.

- `SimInput` carries the base calibration plus the scales (`inFlight` and `new`, as `scaleTable` already builds them in `levers/apply.ts:56-68`). The engine stops reading rescaled transitions. `Run.newScale` and `job.scale` already exist (`engine.ts:314`, `:341`, `:659`); fresh projects now read their scale too.
- `rescaleTransition` stays, unchanged, for what people **see**: chance tables, typical months, the timeline and the project card (`levers/apply.ts` `lookupsFor`, `scenario/card.ts`). Those are month-grid views of the same stretch, and they agree with the engine to within the grid's interpolation.
- My call: this is the clean way to get goals 1–2 exactly. The alternative, keeping the rescaled table and fixing its K′ rounding, still leaves interpolation-level flips and a 0/0 case for in-flight kinds.

### Sampling one stage step (`src/lib/timelapse/model.ts`)

For transition t and a project that has spent τ months in the stage (τ = 0 when fresh; **real-valued**, from exact days, for in-flight), use two independent uniforms:

1. **Kind**, from `uKind`: the eventual shares conditional on surviving τ, P_j(τ), tail included, in the fixed order advance, then `EXIT_ORDER`. The kind is the j whose cumulative slice holds `uKind`.
2. **Time given the kind**, from `uTime`: the inverse of kind j's conditional CDF from τ, G_j(x) = (F_j(x) − F_j(τ)) / (F_j(∞) − F_j(τ)) for x ≥ τ. F_j is piecewise-linear within table months (as the day is today), with kind j's share of the geometric tail past K in closed form. Memorylessness keeps large τ precise, as in `relativeTail`.

Conditioning on exact elapsed time means the event is always after `asOf`. The up-to-8-attempt redraw loop and its `asOf + 1` fallback go away. That loop was rejection sampling on the joint draw, an approximation of exactly this conditioning, so the in-flight law becomes more exact, not less.

The engine's step: event time in stage = τ + s·(x − τ), where x is the sampled time from the unscaled table and s the stage's scale (1 for the twin and for any stage the timers don't name).

API:
- `sampleTransition(t, uKind, uTime, τ)` replaces `(t, u, m)` and returns `{ kind, days }`. It is the one sampler, used by the engine and by V27 (`pipeline/lib/fzp-cal/invariants.ts:231`), so the check validates what the engine runs.
- `sampleKind(t, uKind, τ)` and `sampleTime(t, kind, uTime, τ)` are exported as the two halves. Release 2's F9 (i) `sampleAdvance(t, u)` is `sampleTime(t, 'advance', u, 0)` on the stage's timing draw. A funded, certain project then advances on the same day as its ordinary twin whenever the twin advances.
- Per-transition constants (per-kind cumulative arrays, tail shares) are memoised per `Transition` object, as today (`model.test.ts:427`).
- A kind with no remaining mass at τ is never drawn, because its share P_j(τ) is 0. So G_j's 0/0 cannot arise.

### Draw purposes (`src/lib/sim/scenario/rng.ts`)

| Purpose | Value | Use |
|---|---|---|
| `STAGE` | 6 (same number) | the **kind** uniform, one per (lot, stage) |
| `STAGE_TIME` | 12 (new) | the **time** uniform, one per (lot, stage) |
| `stageRedraw(j)` | 17–23 | retired: no longer drawn, numbers stay reserved and are not reused |

7 and 10 stay reserved for Release 2 (F11). Free numbers after this: 13–16, 24+.

### The project card and chance lookups

A timer no longer changes an in-flight project's eventual completion chance. The card's chance shift (`card.ts` `shiftOf`, which reads the rescaled table at `inFlightMonths(m, x)`) shows no shift for timing-only levers on eventual chances. Within-horizon chances and dates still move. `lookupsFor` and the `card.spec.ts` cases (around lines 829–867) change to match. `inFlightMonths` is deleted if nothing else uses it. My call: the card must agree with the engine.

### What moves (allowed by R17, once)

- Draw purposes as above. `rng.spec.ts` locks extend to `STAGE_TIME`.
- `golden-seed1.json`, the pipeline fixture goldens (`pipeline/test/fixtures/mini/golden/**`), the lesscars goldens and `fixture-0`, regenerated by their documented commands and reviewed as an engine change.
- `model-golden.json`'s 100 `sampleTransition` cases, regenerated by `scripts/model-golden.ts` (partner ruling 1).
- Tests that hard-code the draw sequence or the old sampler: `engine-levers.spec.ts:215-232`, `simulate.spec.ts:576-578`, `rng.spec.ts`, `model.test.ts`, `reproduce.test.ts`, `types.test.ts` (type lock), `multiphase.spec.ts`, `simulate-replay.test.ts`, `ph-pool.test.ts`, `aj-recovery.test.ts`, `card.spec.ts`.
- Its own dataset build and upload: `model.ts`, `rng.ts`, `engine.ts` and `levers/` are hashed (`pipeline/lib/version.ts` `PATHS`). Follow `docs/dev/pipeline.md` "Finishing a branch that changes the dataset".
- Docs: `docs/dev/sim-levers.md` and `docs/dev/sim-timers.md` say that a timer scales each project's time and never its outcome, and that `rescaleTransition` is the display view. `docs/dev/fzp-mode.md` changes if it describes the draws or the redraw loop.

## Acceptance

1. **Marginals unchanged (committed sampler test).** For every transition cell in the small calibration and the fixture calibration, at τ ∈ {0, 6, 6.4, a month past K}, N = 400,000 draws per cell match the table's per-kind conditional cumulative incidence within 0.002 at every month to 36, and match the eventual shares. This also commits the `statistical-correction` 400k check, which today exists only as a one-off. V27 passes on the live build.
2. **Kind never flips; time is monotone (property test).** For random transitions (and every fixture cell), random τ, s ∈ [0.25, 4] and random uniform pairs: the kind is the same for every s. The event time is non-increasing in s for s < 1 and non-decreasing for s > 1, measured against s = 1. Fresh and in-flight paths are both covered.
3. **Paired runs.** Turn the evidence harness (`r1-pairing-scratch.spec.ts.txt`, archived beside the evidence) into a committed test. Run it on the mini city with default levers (today's market steps on), 40 seeds, every timer cell at 12/23 and at 0.5, with reach both `new` and `all`. Cumulative plan − twin `completedNet` must be ≥ 0 in every month of every seed. An exception is allowed only from a mechanism outside stage sampling, such as a freed lot re-initiating against dated market segments. Any exception is measured, traced to its mechanism with file:line and listed in the PR. None may come from a kind flip.
4. **Replay.** `simulate-replay.test.ts` is no worse than on main for the same data (it has one known pre-existing failure on live data, ruling R15). If the replay-validation spec has landed first, its conformance mode passes.
5. **Performance.** All `scenario.bench.spec.ts` budgets hold (`npm run test:perf` on a quiet machine).
6. **Release-2 hook.** `sampleTime(t, 'advance', u, 0)` exists and is tested to match the advance column's conditional law.
7. **Display vs engine.** For each fixture cell and s ∈ {0.5, 2}, the engine's sampled per-kind incidence under scale s matches `rescaleTransition(t, s)`'s table within the grid interpolation error plus sampling noise. The builder states the bound it uses.

## Sequencing and coordination

- **Release 2 (sim-financing).** The supercomposer amendment (hand-off item 2) rebases its design on this fix. "No existing draw purpose changes" and "golden-seed1 / model-golden never change" become "as of the paired-draw fix". F11's 7 and 10 do not collide with 12. F9 (a) is unaffected: a funded market start reuses the ordinary start's draws. F9 (i) uses `sampleTime` as above.
- **Issue #90.** Independent of this fix: it changes tables, not sampling. Recommendation: land this fix first, then #90, with #90's dataset folded into Release 2's build, so the goldens move once more, not twice. #90's text "do not change draw purposes or golden-seed1" needs the same rebase.
- **Replay-validation spec** (branch `worktree-replay-validation`, not implemented). Its non-goal excluding "changing draw purposes, the one-uniform-per-step sampling, or golden-seed1" needs amending. Its conformance mode is the long-run guard on goal 3. Whichever lands second runs the other's checks.

## Left to the builder

- The per-kind tail inverse in closed form, and its precision for large τ.
- How `SimInput` carries the base calibration and scales (new fields, or reuse of `newProjects`), within the rule that the engine samples only unscaled transitions.
- Test file names and structure, within `docs/dev/testing.md`.
- Whether `sampleKind`/`sampleTime` share memoised constants with the existing helpers.

## Partner rulings

1. 2026-11-10: `model-golden.json` may move. Its 100 `sampleTransition` cases are regenerated with the new signature by `scripts/model-golden.ts`; there is one sampler. The old one-uniform `sampleTransition` is removed.
