# Ruling closing-2
Package commit: 56fc7650
Changes design: yes
Changes contract: no
## Ruling
The live block of `pipeline/test/simulate-replay.test.ts` judges the stage calibration (permit issued to construction start) against `project-histories.json`, which no unit of this build writes. Its pooled `permitIssued` cohort fails by the same margin (max |Δ| 0.0354 against a bar of 0.0362, eleven months) on every live dataset of November 2026: with `main`'s code on `main`'s dataset, and with this build's code on this build's datasets. The block already failed on 2026-11-04. The failure is older than this build and is no merged unit's defect. Closing changes nothing for it and reports its cohort line in the hand-back for the owner. The calibration fit and the test's bars are the owner's, after this build.

The block runs only while a non-fixture build is on disk under `pipeline/out` and `pipeline/.cache/derived`, and skips otherwise. That is how every signoff on `main` has met it. So the finish has a step between proving the upload and signoff: closing removes `pipeline/out/<v>` and `pipeline/.cache/derived/<v>`, then runs signoff. These are gitignored build output of a version that is published, immutable and verified, and a new build makes them again. If signoff's merge of `origin/main` changes `<v>`, the finish goes back to step 4 as before and passes the clearing step again.

Option B is not taken: no test is edited and the chreode config is not changed. The block stays a gate whenever a live build is on disk.

For the conductor: closing's command list (npm, npx, lsof, ls, cat, grep, ...) has no `rm`. Either relaunch closing with `rm -rf` allowed for exactly those two paths, or remove the two directories in closing's worktree yourself, then let closing run step 13 (signoff). Its branch head b9581ee9 stands: no task is cut.
## Re-read
- docs/superpowers/specs/2026-11-22-closing-design.html § sec-design-finish
- docs/superpowers/specs/2026-11-22-closing-design.html § sec-design-tree
- docs/superpowers/specs/2026-11-22-closing-design.html § sec-out-of-scope
## Affected units
- closing: clarification
## Build graph
- closing
