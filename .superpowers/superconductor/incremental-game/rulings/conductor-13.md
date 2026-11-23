# Ruling conductor-13
Package commit: 0e072e98
Changes design: yes
Changes contract: yes
## Ruling
The gap is real, and the package closes it in the store and in the sync. The pull judges the current game "unchanged here" from `store.read(id).savedAt`. An edit still inside a page's 500 ms autosave debounce has not reached the record keys, so it is not counted. `adopt` would then write the account's version into the record keys, and the page's autosave would write its older document plus the edit over them when it flushes or unloads. The next send would then overwrite the other device's version on the account, against D8.

- G2: `adopt` of saves that hold the current game's id runs the registered `beforeLeave` functions once its own checks pass and before it reads or writes a record key. It runs them in registration order, as `newGame`, `switchTo` of another game, `remix` and `remove` of the current game do. `adopt` of saves that do not hold the current game's id runs none.
- G2: when a function that `adopt` called writes a record key, the current game's played time moves, which means an edit was still waiting. `adopt` then changes nothing, keeps the offer and answers `{ ok: false, reason: 'changed' }`. `StoreChange`'s reasons are `'full' | 'storage' | 'changed'`, and only this case answers `changed`.
- G2: after `adopt` of the current game's id answers `ok`, `touched()` does nothing for the rest of the document's life, as after a switch. The page still holds the document it loaded with, and nothing it writes belongs to the adopted game.
- S2 and `game-save`: a pull adopts the current game last, after every other step. Just before the call the sync checks again that the current game is unchanged here. If it changed, the sync sends it with `baseRev: seen[id].rev` and does not adopt it.
- An adopt that answers `changed` is handled the same way: the sync sends the game, the send answers 409, and the keep-both rule keeps both versions. Nothing is merged and nothing is chosen over the other (D8).
- An adopt of the current game that answers `ok` reloads the page at once (`location.reload()`), not at the end of the pull. Any pull step it cuts short runs again on the next load's pull, because the waiting saves and `deleting` persist.
- The pages (`game-shell`'s Paint and `game-sim`'s `SimPage`) already register their flush and change nothing.

Work this adds to units that have sent `complete`:
- `game-core` (the store, `src/lib/game/store.svelte.ts`): the adopt flush, the `changed` answer and the `touched()` rule, with the `store.svelte.spec.ts` cases in its Tests section.
- `game-save` (`src/lib/game/save-sync.svelte.ts`): current-last adopt, the re-check, handling of `changed`, and the immediate reload, with the `save-sync.svelte.spec.ts` case in its Tests section.
- Neither unit's earlier work is undone.
## Re-read
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-if-g2, sec-if-s2
- docs/superpowers/specs/2026-11-22-game-core-design.html § sec-interfaces (G2, S2), sec-design-store-change, sec-tests
- docs/superpowers/specs/2026-11-22-game-save-design.html § sec-interfaces (G2, S2), sec-design-sync-setup, sec-design-sync-pull, sec-tests-client
- docs/superpowers/specs/2026-11-22-contracts-design.html § sec-interfaces (G2, S2)
- docs/superpowers/specs/2026-11-22-game-shell-design.html § sec-interfaces (G2)
- docs/superpowers/specs/2026-11-22-game-sim-design.html § sec-interfaces (G2)
## Affected units
- game-core: clarification
- game-save: clarification
- game-shell: clarification
- game-sim: clarification
## Build graph
- game-core
- game-save
