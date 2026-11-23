# Question game-core-7 — from incremental-game-game-core
## Question
In the store's reactive `saves` list, does the current game's entry carry its played time as `savedAt`, or only sort by it?

## What the package says
- game-core spec `docs/superpowers/specs/2026-11-22-game-core-design.html:746`: "`saves` is ordered by `savedAt`, latest first, with the current game's played time in place of its `savedAt`. Equal times order by id."
- `:626`: each stored index entry repeats its save's `savedAt` (so the stored index must keep the save's own value).
- `:631`: played time is the latest of the save's `savedAt` and the records' `savedAt` for the current game.
- The level panel lists saved games with a played-time line (§sec-design-panel / copy `playedText`).

## What I found
Task 5 (`226bb0e1`, `src/lib/game/store.svelte.ts`) uses played time only to sort; the current entry's `savedAt` in `store.saves` stays the save's own value (reviewer's reading, verified against the diff). Then the panel would show "last played" for the current game as of its last store change, not its last autosave — e.g. an hour of painting reads as "2 hours ago".

## Options I see
1. `store.saves` entries show played time as `savedAt` for the current game (the stored index still keeps the save's own `savedAt`). Recommended: the panel's played line is then right.
2. Played time is for ordering only; the entry keeps the save's `savedAt` (as built).

## Blocking
Nothing now; a ruling for option 1 changes one line of the store's `saves` derivation and one test (in Task 6 or 10).
