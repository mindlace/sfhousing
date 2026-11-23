# Ruling game-core-8
Package commit: d2432bd6
Changes design: yes
Changes contract: yes
## Ruling
The store is the one place a game change happens, so the store also makes the page's pending autosave land first. G2 gains `beforeLeave(fn: () => void): () => void`.

- A page that autosaves a record key (Paint for `sfhousing:plan:v1`, `SimPage` with a game for `sfhousing:sim:v2`) registers its autosave's `flush` with `game.beforeLeave` when it mounts, and calls the returned remover when it unmounts.
- `newGame`, `switchTo` of another game, `remix` and `remove` of the current game call every registered function after their own checks pass (`full`, an unknown id, memory mode) and before they read or write a record key. Functions run in the order they were added. One that throws is skipped and the rest still run. No other change calls the list (not `switchTo` of the current game, `remove` of another game, `rename`, `rekey` or `adopt`).
- So an edit still inside the autosave's 500 ms debounce reaches the record key and is copied out with the old game, and the autosave has nothing pending to write over the new game's records when the page unloads.
- After one of those four changes answers `ok`, `touched()` does nothing for the rest of the store's life. The caller is about to do a full page load, and any write the page makes while it unloads was already copied out with the old game. Storing it would count it as a change to the new game.
- In memory mode and in the open game, `beforeLeave` adds and removes functions as it does elsewhere. The changes that would call the list refuse first.
- `game-core` builds the method, its rules and tests. The merged contracts stub lacks `beforeLeave`, and `game-core` adds it when it writes the real `store.svelte.ts`. `game-shell` (Paint) and `game-sim` (`SimPage`) register their flush. Each tests that an edit followed at once by `game.newGame()` lands in the old game's save and leaves the new game's record untouched when the page unmounts.

Why option 1: the level panel (`game-core`) is what calls these changes, not the pages, so a flush owned by the pages (option 2) could not run at the right moment. Deferring the problem (option 3) would leave a path where a change is lost from one game and written into another, against D8.
## Re-read
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-if-g2
- docs/superpowers/specs/2026-11-22-game-core-design.html § sec-interfaces (G2), sec-design-store-change, sec-tests, sec-docs
- docs/superpowers/specs/2026-11-22-game-shell-design.html § sec-interfaces (G2), sec-design-paint, sec-tests-component
- docs/superpowers/specs/2026-11-22-game-sim-design.html § sec-interfaces (G2), sec-design-playable, sec-tests-component
- docs/superpowers/specs/2026-11-22-game-save-design.html § sec-interfaces (G2)
- docs/superpowers/specs/2026-11-22-contracts-design.html § sec-interfaces (G2), sec-design-files
## Affected units
- game-core: clarification
- game-shell: clarification
- game-sim: clarification
- game-save: clarification
## Build graph
- game-core
- game-shell
- game-sim
