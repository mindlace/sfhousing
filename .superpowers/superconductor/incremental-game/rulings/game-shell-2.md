# Ruling game-shell-2
Package commit: 1c59c0bc
Changes design: yes
Changes contract: yes
## Ruling
G2 says when a page clears the offer, and that rule now matches § sec-design-paint: the page calls `setOffer` with the win while its seen result wins the level, and with null as soon as that result stops winning, and when the page unmounts. G2's wording covers both pages. On `/sim` every edit clears the seen result (`game-sim` § sec-design-seen), so an edit clears the offer, as `game-sim` already builds it. On Paint the result is the latest complete score, so a stroke leaves the offer as it is, and a complete score below the goal clears it. The header's "Level up" therefore never flickers during a stroke that keeps the room at or above the goal. § sec-design-paint stands as written. The offer is still kept in memory only.
## Re-read
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-if-g2
- docs/superpowers/specs/2026-11-22-game-shell-design.html § sec-interfaces (G2), sec-design-paint
- docs/superpowers/specs/2026-11-22-game-sim-design.html § sec-interfaces (G2), sec-design-seen
- docs/superpowers/specs/2026-11-22-{contracts,game-core,game-save}-design.html § sec-interfaces (G2)
## Affected units
- game-shell: clarification
- game-sim: clarification
- game-core: clarification
- game-save: clarification
## Build graph
- game-shell
- game-sim
