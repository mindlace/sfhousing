# Before sim-financing Release 2: two hand-offs

Written by the sim-financing conductor, 2026-11-10. Release 1 is on `main` as 8a0dbe89 (PR #89, dataset 2026-11-10-3532a348). Release 2 (`finance-engine` → `finance-score` → `finance-levers` → `funding-ui`) is held until both items below land (partner rulings R16 and R17; see `ledger.md`).

## 1. Paired-draw fix: a new single-spec feature (`superpowers:brainstorming`)

**Problem.** Plan and twin share draws per (lot, purpose, stage) (`src/lib/sim/scenario/engine.ts:457-490`, `input.ts:148`), but one uniform sets both the month a project leaves a stage and the kind of exit, through a month-major inverse CDF (`src/lib/timelapse/model.ts` ~300-385: `tableSlice`, `literalDraw`, `sampleTransition`). Any change to a transition (`rescaleTransition`, `src/lib/sim/levers/timers.ts:73-148`; and in Release 2, funding's `sampleAdvance`) moves the cumulative curve, so the same uniform can turn a completion in the twin into an exit in the plan. The result is unbiased in expectation, but heavy signed noise per seed. On the mini city, a single timer change (23 → 12) gives plan − twin < 0 in 37–40 of 40 seeds, worst −1,033 homes in a month. The partner has seen the same effect on `/sim`.

**Evidence.** `.claude/worktrees/market-baseline/.superpowers/sdd/2026-11-10-market-baseline/r1-pairing-evidence.md` (raw data `r1-pairing-main-mini.json`, script `r1-pairing-scratch.spec.ts.txt`); also archived in `sdd-archive/market-baseline/`. The sampler itself is correct: `statistical-correction` measured 400k draws matching the tables within 0.0012.

**Likely direction (not a design).** Separate uniforms for the exit kind and for the timing given the kind, so that a change to timing alone keeps every project's outcome. New draw purposes (`rng.ts` `P`) are needed.

**What it is allowed to move (partner ruling R17).** Draw purposes, `golden-seed1.json`, the pipeline and lesscars goldens, and `fixture-0`, once. It ships its own dataset build (the engine is hashed).

**Must coordinate with.**
- sim-financing Release 2's design (`docs/superpowers/design/2026-11-09-1911-sim-financing.md`): row F9 (a) and (i) (a funded start reuses the ordinary start's draws; `sampleAdvance` renormalises the advance column), row F11 (draw purposes 7 and 10 reserved), and the global constraints "Deterministic and paired" and "Goldens change only at the two releases". Whatever the fix does to stage sampling, F9 (i)'s `sampleAdvance` must sit on it naturally. Say how in the spec.
- Issue #90 (per-pathway permit-side tables, from `statistical-correction`): it changes calibration output. Sequence it with this fix and with Release 2.
- The replay-validation spec (`.claude/worktrees/replay-validation/docs/superpowers/specs/2026-11-10-replay-validation-design.md`): its conformance mode should confirm the fix keeps the marginals.

**Acceptance it should carry.** The marginals are unchanged (replay conformance, plus a sampler test like `statistical-correction`'s); a timing-only lever never flips a project's exit kind; plan − twin under a pure speed-up is ≥ 0 for every seed (or a stated, measured exception); the performance budgets hold.

## 2. Supercomposer amendment of the sim-financing package (`supersonic:supercomposer`, reappraisal)

Once item 1's spec exists (it need not have landed):
- **R14:** `finance-data` spec 4.6. Give the City pools' shares tier 2 (inferred split of Exhibit F $300,027 by Exhibit E spending), with the debt terms' tier 2 cite in its own entry. Code: `pipeline/lib/fzp-cal/funding.ts:302-324`.
- The federal pool's "uncapped" claim has no source in its provenance (`funding.ts:338-355`). Source it or label it.
- Deferred to R2: an unparseable `market.json` escapes as a bare `SyntaxError` (`pipeline/steps/calibration.ts`), while `docs/dev/market.md:205-208` promises a `CalibrationError`.
- **Rebase the global constraints on the fixed engine:** "no existing draw purpose changes" and "golden-seed1.json / model-golden.json never change" now mean "as of the paired-draw fix". Check F9 (a), F9 (i) and F11 against the fix's new draw purposes (purpose numbers must not collide).
- Spec prose fixes found during Release 1: `finance-model` §6's worked example uses the rounded loan value; spec §2 `lossOnExit: number` vs F8's nullable form; `finance-data` §6 test file names (`.test.ts`).
- Frame-defect classes seen in Release 1 that the package could absorb: `shape-lock-tests` (item 0 should say the type-lock tests gain the new fields); `hashed-path-consumers-unlisted` (adding to PATHS also means updating `chreode.config.ts` and `pipeline.yml`); `release-boundary` (where release-branch live inputs come from: the raw cache is not carried by the lock until upload).

Then resume the conductor (`supersonic:superconductor`, design sim-financing). Its ledger has the resume point.
