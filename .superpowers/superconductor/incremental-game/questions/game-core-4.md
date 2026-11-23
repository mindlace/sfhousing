# Question game-core-4 — from incremental-game-game-core
## Question
Does `remove` of the current game copy it out (write its save with the records) before removing that save?

## What the package says
- game-core spec §sec-design-store-change, `docs/superpowers/specs/2026-11-22-game-core-design.html:657`: "Before the current game stops being current (`newGame`, `switchTo`, `remix`, `remove` of the current game), the store 'copies it out'".
- tbl-transitions row `remove(current)` (`:676`): "Remove its save; the next game's records, or a new save and its records; the index" — no copy out.

## What I found
The two disagree. The end state of storage is the same either way (the save is removed in the same change); the difference is only the write sequence (and so which write a quota error can land on) and the wording in `docs/dev/game.md`.

## Options I see
1. Follow the table: no copy out for `remove(current)`; drop `remove` from the `:657` list. Recommended (the plan builds this).
2. Follow `:657`: copy out, then remove.

## Blocking
Nothing: the plan builds option 1; a ruling for option 2 changes one write-order assertion in Task 6 and one line of docs.
