# Ruling game-sim-3
Package commit: 1a991821
Changes design: yes
Changes contract: no
## Ruling
A policy that `addPolicy` makes from a funding preset takes the preset's label (G3). The housing bond's policy is therefore labelled "A housing bond", and its span bar's accessible name carries that label, not the pool's label "Housing bond".
`game-sim` writes the one locator line of `e2e/sim-funding.spec.ts` test 8 that finds the housing bond's bar. That line finds the bar by the policy's label, "A housing bond", either as a literal or read from the document.
The rest of `e2e/sim-funding.spec.ts` stays `funding-measures`' file, including the rest of test 8. The two units can run together. Whichever merges second keeps `game-sim`'s locator and `funding-measures`' additions to test 8.
The spec's label rule stands.
## Re-read
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-write-sets (game-sim row; the ordering note after the e2e/sim-funding.spec.ts note)
- docs/superpowers/specs/2026-11-22-game-sim-design.html § sec-write-set-files, § sec-tests-existing
- docs/superpowers/specs/2026-11-22-funding-measures-design.html § sec-write-set, § sec-tests-e2e
## Affected units
- game-sim: clarification
- funding-measures: clarification
## Build graph
- game-sim
- funding-measures
