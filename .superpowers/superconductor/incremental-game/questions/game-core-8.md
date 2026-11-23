# Question game-core-8 — from incremental-game-game-core
## Question
Who flushes a page's pending autosave before the store changes the current game, and how? Without it, an edit made less than 500 ms before New game / switch / Delete-of-current / Remix is lost from the old game and then written into the new one.

## What the package says
- game-core spec §sec-design-store-change (`docs/superpowers/specs/2026-11-22-game-core-design.html:657`): before the current game stops being current, the store "copies it out" by reading the two record keys.
- G2 (contracts row): "The page calls `touched()` after its autosave writes a record key"; after `newGame`/`switchTo`/`remove` answers ok "the caller loads the new current game's page with a full page load".
- No spec section (game-core, game-shell, game-sim) says a page's pending autosave is flushed before a game change.

## What I found
Final whole-branch review (opus), unverified by me beyond its citations:
- Paint's and `/sim`'s autosave debounces 500 ms and flushes on `pagehide` (`src/lib/sharing/autosave.svelte.ts:150-209`).
- Sequence: edit → within 500 ms press New game / another game's name / Delete on the current game in the level panel (`src/lib/game/LevelPanel.svelte:53-57, :160-171`) → store copies out the record keys *without* the pending edit (old game loses it) and writes the new game's records (`src/lib/game/store.svelte.ts:508-540`) → `loadPage` fires `pagehide` → the autosave writes the OLD document over the new game's record key → the page's `touched()` stores it in the new game's save, and the sync sends it.
- This is the leak Review Focus #2 (`switching to a game with no records removes both record keys`) guards against, reached by timing.

## Options I see
1. Add to G2 a hook pages register their autosave flush with (e.g. `game.beforeLeave(fn: () => void): () => void`); the store calls every registered fn before copying out in `newGame`, `switchTo` of another game, `remix` and `remove` of the current game. game-core builds the hook; game-shell and game-sim register their autosave flush. Recommended — small, and it keeps the store the one place a game change happens.
2. The pages (game-shell, game-sim) flush their autosave before calling any store change; no G2 change. Fragile: the level panel (game-core) is what calls the store, not the page.
3. Defer: record the gap in `docs/dev/game.md`.

## Blocking
Nothing in game-core's current plan; option 1 adds one store method + tests and changes row G2 (consumers game-shell, game-sim).
