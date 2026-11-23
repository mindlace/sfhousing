# The game

The incremental game's rules and saved games live in `src/lib/game/`: levels and results
(`levels.ts`), progress and banking (`progress.ts`), saved games and their default names
(`saves.ts`), the store that keeps them in `localStorage` under `sfhousing:saves:v1` and
`sfhousing:save:<id>` (`store.svelte.ts`), what each level allows and the playable document
(`allowed.ts`), the player's standing (`standing.ts`), the game's words (`copy.ts`), the win card
(`WinCard.svelte`) and the level panel (`LevelPanel.svelte`). For the current game the plan and
policy records under `sfhousing:plan:v1` and `sfhousing:sim:v2` are the truth. On a `VITE_E2E=1`
build a page with no `sfhousing:e2e:game` key gets the open game (level 5, every control, nothing
stored); an e2e spec switches the real game on with `seedGame` or `newVisitor` from
`e2e/helpers/game.ts`, and sets the goal's amount with `seedGoalAmount`.
