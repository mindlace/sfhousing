# Ruling game-core-4
Package commit: ea38eb64
Changes design: yes
Changes contract: yes
## Ruling
`remove` of the current game does not copy it out. It removes the current game's save, then writes the next game's records (or a new game's save and records), then the index, as `tbl-transitions` gives it. Copying out applies to `newGame`, `switchTo` and `remix` only. G2 says so: "`newGame`, `switchTo` and `remix` first copy the two record keys into the current game's stored save, then write the new current game's plan and policy into the two record keys. `remove` of the current game removes its save without copying it out, then writes the new current game's plan and policy into the two record keys." The end state of storage is the same either way; the reason for the order is that a delete never needs a write that storage could refuse for want of space, so a player whose browser storage is full can always delete a game. Every other rule of `remove` (the next current game, `removed(old)`, `changed(new)` when a new game is made, the offer cleared) stands.
## Re-read
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-if-g2
- docs/superpowers/specs/2026-11-22-game-core-design.html § sec-design-store-change
- docs/superpowers/specs/2026-11-22-{contracts,game-core,game-save,game-shell,game-sim}-design.html § sec-interfaces (G2)
## Affected units
- game-core: clarification
- game-save: clarification
- game-shell: clarification
- game-sim: clarification
## Build graph
- game-core
