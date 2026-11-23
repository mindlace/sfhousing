# Question conductor-13 — from incremental-game-conductor
## Question
When the save sync's pull adopts a newer copy of the current game (`store.adopt` of the current game's id, then a page reload), can an edit still inside a page's 500 ms autosave debounce overwrite the adopted game? If so, does `adopt` of the current game run the `beforeLeave` flushes, or does something else close the gap?
## What the package says
G2 (as amended for question game-core-8): `newGame`, `switchTo` of another game, `remix` and `remove` of the current game call every registered `beforeLeave` function; "No other change calls the list (not `switchTo` of the current game, `remove` of another game, `rename`, `rekey` or `adopt`)".
## What I found
Reported by incremental-game-game-save in its completion report (testimony, not verified by the conductor): "an edit still in a page's 500 ms autosave can overwrite an adopted current game on the pull's reload (store.adopt of the current game should run beforeLeave flushes)". game-save's unit is complete at 8a71ea14 and does not change the store.
## Options I see
- `adopt` of the current game runs the registered flushes first (and what then happens to the flushed local edit against the adopted copy is stated: D8 keeps both, nothing is merged).
- The gap is closed elsewhere (the sync, or `touched()` after an adopt), and the ruling says where.
- The package stands, with the reason the overwrite cannot happen.
## Blocking
No task now. Units: game-core (store), game-save (sync), game-shell and game-sim (pages that register a flush).
