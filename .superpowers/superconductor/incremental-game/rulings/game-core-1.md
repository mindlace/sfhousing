# Ruling game-core-1
Package commit: 5bde42a0
Changes design: yes
Changes contract: no
## Ruling
The `sfhousing:sim:v1` rule applies to every change that writes the two record keys: a game that becomes current (newGame, switchTo, remix, remove of the current game) and `adopt` of the current game's id. When `sfhousing:sim:v1` holds a value, the store removes it in the same change; when `sfhousing:sim:v2` was absent before the change, it first copies the v1 text to `sfhousing:sim:corrupt:<ISO time>`. So an adopt that writes a null policy for the current game never lets `migrateSimAutosave` (`src/lib/timeline/sim-doc4.ts:342`, verified: it copies v1 into v2 whenever v2 is absent) bring the old schema 3 policy back on the next `/sim` load. `adopt` of the current id still keeps the current id and calls no sync method. `store.svelte.spec.ts` asserts the v1 removal for adopt of the current id as well. G2 is unchanged: this is store-internal storage behaviour.
## Re-read
- docs/superpowers/specs/2026-11-22-game-core-design.html § sec-design-store-change
- docs/superpowers/specs/2026-11-22-game-core-design.html § sec-tests (store.svelte.spec.ts, changes)
## Affected units
- game-core: clarification
## Build graph
- game-core
