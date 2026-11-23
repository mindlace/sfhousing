# Ruling conductor-3
Package commit: 5f20bf6c
Changes design: yes
Changes contract: no
## Ruling
`reach-check` owns the level 2 check (G4's build check, D1): it writes `scripts/level2-check.ts` and its test, and runs the check once on a dataset built after `remove-lesscars`, `finite-funding` and `pool-closing` have merged. `closing` runs the same script again on the dataset it builds, before the upload, and never changes it. The design doc (`sec-if-g4`, `sec-model-money`, `tbl-write-sets`), the build graph, the `reach-check` spec and the `closing` spec already say this and state the system. The five sentences in `finite-funding`, `pool-closing`, `game-core` and `game-sim` that named `closing` as the check's owner now say the same, and `finite-funding`'s handback of first-year dollars and the impact-fee block goes to the check that `reach-check` runs. No interface row and no behaviour changes; the owner's D1 ("There shouldn't be a case where it's unachievable") is met by the check running mid-build and again before the upload.
## Re-read
- docs/superpowers/specs/2026-11-22-finite-funding-design.html § sec-design-data-state, sec-design-reach, sec-out-of-scope
- docs/superpowers/specs/2026-11-22-pool-closing-design.html § sec-out-of-scope
- docs/superpowers/specs/2026-11-22-game-core-design.html § sec-out-of-scope
- docs/superpowers/specs/2026-11-22-game-sim-design.html § sec-out-of-scope
## Affected units
- finite-funding: clarification
- pool-closing: clarification
- game-core: clarification
- game-sim: clarification
## Build graph
- finite-funding
- pool-closing
- game-core
- game-sim
