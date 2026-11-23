# Ruling game-core-2
Package commit: 84820370
Changes design: yes
Changes contract: no
## Ruling
Construction treats a refused write in steps 4 to 7 as step 3 treats one: the store puts back every key construction had already set or removed (ignoring throws while it does), so storage holds what it held before construction. The store is then in memory mode with the saved games it read and made, the current one as steps 4 to 6 chose it, with its plan and policy as read. In memory mode it writes nothing, and newGame, switchTo of another id, remix, rekey, remove and adopt answer `storage`, as § sec-design-store-change already says. A later page load runs construction again on the untouched storage. This agrees with G2 ("A write that the browser refuses answers storage and leaves the stored games as they were"); no interface row changes.
## Re-read
- docs/superpowers/specs/2026-11-22-game-core-design.html § sec-design-store-construct (new step 8)
## Affected units
- game-core: clarification
## Build graph
- game-core
