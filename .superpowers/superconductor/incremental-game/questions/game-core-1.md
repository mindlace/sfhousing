# Question game-core-1 — from incremental-game-game-core
## Question
When `adopt(saves)` replaces the current game (same id) and writes its plan and policy to the two record keys, does the `sfhousing:sim:v1` rule (remove v1, first copying it to `sfhousing:sim:corrupt:<ISO time>` when v2 was absent) apply to that write?

## What the package says
- game-core spec §sec-design-store-change (`docs/superpowers/specs/2026-11-22-game-core-design.html:657`): "When the store writes the records of a game that becomes current and `sfhousing:sim:v1` holds a value, it removes that key in the same change."
- tbl-transitions row `adopt(saves)` (`:676`): "Each save; the current game's records when one of them is current; the index".
- `:728`: "`adopt` of the current game's id replaces its progress in memory and writes its plan and policy to the two record keys. The current id does not change."

## What I found
- The v1 rule is worded for "a game that becomes current"; adopt keeps the same current id, so a literal reading excludes it (verified at spec `:657`, `:728`).
- If adopt writes a null policy (removes `sfhousing:sim:v2`) and v1 still holds a value, `migrateSimAutosave` (`src/lib/timeline/sim-doc4.ts:342`, per the plan drafter, unverified by me) brings the old schema 3 policy back on the next `/sim` load — the exact failure `:657` says the rule exists to prevent.

## Options I see
1. Apply the v1 rule to adopt's write of the current game's records (same as a game becoming current). Recommended.
2. Literal reading: adopt never touches v1.

## Blocking
Task 6 of `docs/superpowers/plans/2026-11-22-game-core.html` (one assertion on adopt of the current game).
