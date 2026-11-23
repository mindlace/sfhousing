# Question game-core-6 — from incremental-game-game-core
## Question
During construction, what does the store do when a `getItem` throws after the first one succeeded (reading a save, a record key, or a key during the step 4 rebuild)?

## What the package says
- game-core spec §sec-design-store-construct (`docs/superpowers/specs/2026-11-22-game-core-design.html:638`) step 1: "With `storage` null, or when the first `getItem` throws, the store is in memory mode: one game, at `NEW_GAME`, with a new id ..." 
- Step 8 (`:645`) covers a refused *write* in steps 4–7 (put back, memory mode with the games read and made).
- `:749`: for `read(id)` after construction, "When reading a record key throws, the stored copy is used."
- Nothing covers a later *read* throwing during construction.

## What I found
Task 5's implementer (commit `226bb0e1`, `src/lib/game/store.svelte.ts`) treats it like step 1: memory mode with a fresh level 1 game. Unverified by me beyond the implementer's report; no test covers it. The player's stored games are untouched in storage either way, but this session would show a blank level 1 game.

## Options I see
1. As step 1: memory mode, one fresh game (built now).
2. As step 8: put back anything written, memory mode with whatever games were read so far.
3. Treat the throwing key as absent/unparseable and continue (a save that throws is left out, a record key that throws reads as null).

## Blocking
Nothing: Task 5 proceeds with option 1; a different ruling changes one construction branch and adds one test.
