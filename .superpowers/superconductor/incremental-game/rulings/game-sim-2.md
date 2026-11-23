# Ruling game-sim-2
Package commit: bc1ad851
Changes design: yes
Changes contract: yes
## Ruling
- (a) G2: the page calls `touched()` each time its autosave's status goes from `saving` to `saved`. That covers a write to a record key, and also an edit inside the debounce that brings the document back to the text already written. The page specs already say this. Paint does it today, and `/sim` does it the same way. A game edited and undone within the debounce therefore counts as played. That follows D14's "last played is the last change", since the player did change it.
- (b) On `/sim`, the function `SimPage` registers with `game.beforeLeave` first hands its autosave the current document (`schedule`) and then calls `flush`. An edit therefore reaches the policy record before the game changes, even when the page's effect has not yet handed it to the autosave. The spec's test "an edit, then at once `game.newGame()`" holds as written.
- (c) `SimRoute` takes an optional `storage` prop (`() => Storage | null`, default `getStorage`) and passes it to `SimPage`'s existing `storage` prop. It is a test seam. `GameSimHost` renders the page through `SimRoute` and gives it the same memory storage as the provided `GameStore`.
## Re-read
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-if-g2
- docs/superpowers/specs/2026-11-22-game-sim-design.html § sec-interfaces (G2), sec-design-game, sec-design-playable, sec-tests-component
- docs/superpowers/specs/2026-11-22-{contracts,game-core,game-save,game-shell}-design.html § sec-interfaces (G2)
## Affected units
- game-sim: clarification
## Build graph
- game-sim
- game-core
- game-shell
