# Ruling funding-measures-2
Package commit: 916acbdc
Changes design: yes
Changes contract: no
## Ruling
src/lib/timeline/Inspector.svelte.spec.ts belongs to game-sim, with one exception: in the case "a given measure at level 5", the assertion on the text of the What section belongs to funding-measures. That section shows PolicySummary's money-only summary, and funding-measures owns the summary. In that case the What section contains "Public money" and does not contain "No transit layers". funding-measures makes the one-line edit on its own branch: the `toContain('No transit layers')` line becomes `not.toContain('No transit layers')`. Whichever of game-sim and funding-measures merges second keeps that assertion and all of game-sim's other lines. The money-only rule of funding-measures § sec-design-summary stands as written.
## Re-read
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-write-sets (the funding-measures and game-sim rows, and the ordering note on Inspector.svelte.spec.ts)
- docs/superpowers/specs/2026-11-22-funding-measures-design.html § sec-write-set
- docs/superpowers/specs/2026-11-22-game-sim-design.html § sec-write-set, § sec-tests-component
## Affected units
- funding-measures: clarification
- game-sim: clarification
## Build graph
- funding-measures
- game-sim
