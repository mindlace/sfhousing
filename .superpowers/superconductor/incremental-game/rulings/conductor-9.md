# Ruling conductor-9
Package commit: c6439104
Changes design: yes
Changes contract: yes
## Ruling
The package is amended to meet D8 ("every one is kept as its own saved game. Nothing is merged and nothing is picked over another"). A delete made on one device never discards a change made on another.

- A saved game deleted on one device is deleted on the others the next time they sync, where it is unchanged. A device that changed it before learning of the delete keeps its version as its own saved game, under the same name.
- S2: a 410 keeps the saved game in this browser under a new id and sends it again. This holds for the current game and for every other saved game alike.
- `game-save`: the sync sends a save only when it changed here, so a 410 to a send always means the account removed a game this browser still changed. The sync calls `store.rekey(oldId, newId())`, which keeps the save's name and, for the current game, its offer, with no page load. It drops `seen[oldId]` and sends the save under the new id with `baseRev: null`.
- In a pull, a save listed under `removed` that is unchanged here is removed when it is not current. When it is current, it is kept under a new id. A changed one is sent, answers 410, and is kept under a new id.
- The kept copy keeps its name, not "{name} (this device)", because no other version holds the old name.
- G2's `rekey` already covers a game that is not current, so the store needs no change. The cap of 12 is not reached, because a rekey adds no game.
## Re-read
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-model-accounts
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-if-s2
- docs/superpowers/specs/2026-11-22-game-save-design.html § sec-design-sync-removed, sec-design-sync-pull, sec-tests (browser)
- docs/superpowers/specs/2026-11-22-contracts-design.html § sec-interfaces (S2)
- docs/superpowers/specs/2026-11-22-game-core-design.html § sec-interfaces (S2)
## Affected units
- contracts: clarification
## Build graph
- game-save
