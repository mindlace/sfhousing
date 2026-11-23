# Question closing-2 — from incremental-game-closing
## Question
Signoff fails at `test:pipeline` on the live-build block of `pipeline/test/simulate-replay.test.ts`, which runs only when a built dataset exists locally. Who owns the failure, and what unblocks signoff? The test is outside closing's write set, so closing does not change it, rerun around it or raise a tolerance.

## What the package says
- Closing spec #sec-design-tree: "A failure is a defect of a merged unit. The operator reports it with the failing test and its file, and fixes it only when the file is in this unit's write set." "A test that passes only on retry counts as a failure."
- #sec-design-finish step 12: signoff once, after the upload; the hand-back carries the signoff result.
- #sec-out-of-scope: fixing code or test code in another unit's file is not closing's.

## What I found
- Dataset 2026-11-14-09ca30c8 was built from this branch (every invariant OK), checked, passed level2-check (exit 0: "Goal: 82,069 homes by Oct 2066 / Reached: Apr 2065, 18 months before the window's end"), uploaded (924 objects), verified on staging, and `dataset-version.ts --check` exits 0.
- Task 6's `npm run test:pipeline`, run before the build, passed 2284 tests with 10 skipped. With `pipeline/out/2026-11-14-09ca30c8` and `pipeline/.cache/derived/2026-11-14-09ca30c8` on disk, signoff ran 2294 tests and this one failed. Verified at `pipeline/test/simulate-replay.test.ts:644-660` and `:699-716`: the live block picks the newest local non-fixture build, and skips when there is none.
- The failure is in the signoff output at `/private/tmp/claude-501/-Users-mindlace-Projects-sfhousing--claude-worktrees-incremental-game-closing/07cb9db2-4f0e-4a66-b906-f1d393cb4ad2/tasks/bs6p6ry7n.output:1888-1921`. One cohort is out of eleven:
  `pooled permitIssued  n 1225  94 months  max |Δ| 0.0354  bar 0.0362  FAIL (11)  worst: advance by month 9: simulated 0.6434 vs observed 0.6789`.
  The failing months run from 11 to 21, with |Δ| between 0.0309 and 0.0349 against per-month bars between 0.0300 and 0.0337. The simulation is under the observed curve. Every other live cohort is ok.
- The cohort is stage calibration (permit issued → construction start), not funding. I have not established which unit's change moved it, or whether the dataset on `main` fails the same way. Reach-check's earlier live build (2026-11-14-3a25a7ad) would answer that, but whether anyone ran `test:pipeline` with it on disk is unverified. Running the test against another build needs `SFH_REPLAY_PIPELINE_DIR`/`SFH_REPLAY_VERSION` set in the environment, and my command list cannot set it.
- My branch's last commit is b9581ee9. Every other check passed in Task 6: lint, check, unit 9244, pipeline 2284 with the live block skipped, and e2e 782 with 0 flaky. Signoff posted no status. The dataset is already published, and it is immutable.

## Options I see
A. The unit that owns stage calibration or the replay check (pipeline: stage-calibration / project-records; not obviously any unit of this build) fixes the calibration or the test. closing then runs signoff again with `<v>` unchanged if the fix is outside `PATHS`, or with a new build, level 2 check and upload if it is inside.
B. The owner rules that the live replay block is not a signoff gate for this dataset. The ruling would be given as a spec change that closing follows, and someone outside closing's write set changes the test or the chreode config.
C. Find out first whether `main`'s dataset fails the same block, by running it with `SFH_REPLAY_VERSION` set to that build. If it does, the defect is older than this build, and the owner decides between A and B.

## Blocking
Task 8 step t8-s4, signoff, and the hand-back's signoff result. Nothing else is held: Tasks 1–7 and the final review are done.

## Conductor's provenance check (2026-11-23, investigator agent, read-only)
The failure is older than the integration branch. Logs: the conductor session scratchpad, `e1.log`–`e5.log`.
- `main`'s code (merge base e2405d34) on `main`'s own dataset 2026-11-14-1a31d026 (build in the `building-steps` worktree): pooled permitIssued max |Δ| 0.0354, bar 0.0362, FAIL (11). Identical to the branch.
- closing's code (b9581ee9) on 09ca30c8, on reach-check's 3a25a7ad and on 1a31d026: the same line each time.
- `main`'s code on an older build 2026-11-04-04ef7e4b: n 1224, max |Δ| 0.0349, bar 0.0343, FAIL (14). The block already failed in early November.
- `project-histories.json` is byte-identical across every 2026-11-14 derived cache. `scenarios/fzp/calibration.json` differs between the branch builds and `main`'s, with no effect on this cohort.
- Not examined: why the permit-issued fit is off; whether any earlier build ever passed the block; the history of the test's tolerance.
So no unit of this build caused it; the block skips when no local build exists, which is why no signoff met it before a dataset-changing branch.
