# Question game-sim-2 — from incremental-game-game-sim
## Question
Three points in how `/sim` drives G2's save hooks, which the spec text doesn't decide:
(a) Does `game.touched()` run on every autosave `saving` → `saved` step, or only when a record key is written?
(b) Does "registers its autosave's flush" with `game.beforeLeave` mean the bare `Autosave.flush`, or a function that first schedules the current document and then flushes?
(c) May `SimRoute` take a `storage` test seam, so the component tests run `/sim`'s autosave and the `GameStore` on one memory storage?

## What the package says
- `#sec-design-playable`: the page calls `game.touched()` on each `saving` → `saved` step, and registers its autosave's flush with `beforeLeave`. An edit still waiting is in the record keys when the game changes.
- G2 row (`#sec-interfaces`): the page calls `touched()` "after its autosave writes a record key".
- `#sec-tests-component`: `/sim` runs under a `GameStore` on memory storage. Test: an edit, then at once `game.newGame()`, lands in the old game's save.

## What I found
- (a) `Autosave.schedule` steps `saving` → `saved` with no write when an edit returns to the written text inside the debounce (verified-at `src/lib/sharing/autosave.svelte.ts:159-163`). Following `#sec-design-playable` bumps `savedAt` with nothing written. Following G2 does not. The two texts disagree.
- (b) SimPage hands each change to autosave in an effect (verified-at `src/lib/sim-page/SimPage.svelte:305-312`). `flush` writes only what is pending (verified-at `src/lib/sharing/autosave.svelte.ts:179-183`). So an edit followed in the same task by `newGame()` is not yet pending, and a bare `flush` writes nothing. The spec's own test then fails.
- (c) `/sim`'s autosave uses `localStorage` (verified-at `src/lib/sim-page/SimPage.svelte:147`). `SimRoute` passes no storage. The store copies the old game out of its own storage (verified-at `src/lib/game/store.svelte.ts:126-132`). With memory storage for the store and `localStorage` for autosave, the hand-off test can't observe the save.

## Options I see
- (a) 1: call `touched()` on each `saving` → `saved` step, as `#sec-design-playable` says (it only moves `savedAt`). 2: call it only when a write happened, as G2 says; the spec text gets aligned.
- (b) 1: register `() => { autosave.schedule(current document); autosave.flush() }`. This meets the spec's stated guarantee. 2: register bare `flush`; the spec's test changes.
- (c) 1: add an optional `storage` prop to `SimRoute` (default `localStorage`), passed through to SimPage's autosave. `GameSimHost` renders `SimRoute`. 2: the test host stubs `localStorage` instead.
My recommendation: (a) 1, (b) 1, (c) 1. The amended plan at 9aa7f278 is written that way.

## Blocking
Plan Task 8 (the game on the `/sim` page). Tasks 1–7 and 9 go on.
