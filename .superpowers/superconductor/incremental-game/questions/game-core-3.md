# Question game-core-3 — from incremental-game-game-core
## Question
When the store rebuilds from `sfhousing:save:*` keys (construction step 4, invalid index), what happens to a value that parses as a `GameSave` but whose `id` differs from the id in its key?

## What the package says
- game-core spec §sec-design-store-construct step 4 (`docs/superpowers/specs/2026-11-22-game-core-design.html:641`): "Those that parse become entries; those that do not are moved aside as in step 5."
- Step 5 (`:642`), for a valid index: "A save that is absent, will not parse, or has a different `id` is left out of the list. Its raw text ... is copied to a corrupt key, and its key is removed."

## What I found
Step 4 only names "parse / do not parse". Step 5's "different id" test compares against the index entry, which does not exist in step 4; whether the key's suffix counts as the id to compare is not stated. Two found saves could also carry the same `id` under different keys, which would break the index's "distinct ids" validity (`:625`).

## Options I see
1. Treat id ≠ key suffix as not parsing: move it aside as in step 5 (also settles duplicates). Recommended.
2. Accept it as an entry under its own `id` (moving the save to `saveKey(id)`), and move aside any later duplicate.
3. Accept it under its key's id, rewriting the save's `id` field.

## Blocking
Task 5 of `docs/superpowers/plans/2026-11-22-game-core.html` (one rebuild case).
