# Ruling conductor-2
Package commit: f7506ffd
Changes design: yes
Changes contract: no
## Ruling
`game-core` states the system. Once the round is complete (level 5 with `banked[5]`), the pure `levelUp` returns its progress unchanged, and the store's `levelUp()` changes no progress, banks nothing, writes nothing and calls no sync method; it only clears the offer. No control offers "Level up" then: the win card has `unlocks` null and no "Level up" button, and the level panel and the header's level cell hide it by `roundComplete`. On `/sim` the page reacts only to `game.progress.level` rising or `roundComplete` turning true, so a `levelUp()` call after the round is complete changes nothing on the page and the clock stays where it is. The first level-5 bank is final: it is the result banked on leaving level 5, consistent with D2 (levelling up banks the result once, at the moment the player levels up) and G2 ("`levelUp` at level 5 stores `banked[5]` and keeps the level at 5"). The `game-sim` passage that said a later level up banks the new result is amended to agree; G2 and `game-core` stand as written.
## Re-read
- docs/superpowers/specs/2026-11-22-game-sim-design.html § sec-design-levelup
- docs/superpowers/specs/2026-11-22-game-core-design.html § sec-design-progress (tbl-levelup)
- docs/superpowers/specs/2026-11-22-game-core-design.html § sec-design-store-change (tbl-store-levelup)
## Affected units
- game-sim: clarification
## Build graph
- game-sim
