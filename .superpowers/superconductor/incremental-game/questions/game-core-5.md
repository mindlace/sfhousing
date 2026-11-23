# Question game-core-5 — from incremental-game-game-core
## Question
What is `levelNeeded` for a document holding a money policy whose `preset` is a string but whose `where.tag` is not `fund`, `baseline` or `terms` (so `isGiven` is false and `playable` drops it at level 5)? 5 or 6?

## What the package says
- G3 interface row (contracts spec, copied in plan `sec-if-g3`): "`levelNeeded` — The lowest level whose `allowedAt` runs every policy of `doc`; 6 when none does." → 6 for this policy.
- game-core spec `docs/superpowers/specs/2026-11-22-game-core-design.html:500`: `isGiven(p)` is true when `p.preset` is a string **and** `p.where.tag` is `fund`, `baseline` or `terms`.
- `:507`: levelNeeded is the largest of "... 5 for a given money policy, 6 for a money policy whose `preset` is null" — silent on a non-given policy with a string preset.
- `:535` (tbl-level-needed): "Any money policy with a string `preset`, and none with null → 5" → 5 for this policy.
- `:501`: `game-sim`'s parser and `addPolicy` decide what reaches `preset`.

## What I found
- `SimPolicy4.kinds.money` is `Policy[]` (verified at `src/lib/timeline/policy4.ts:52`), and `Policy.where` is the general selector union, so the type admits a money policy on a non-money selector; whether `game-sim`'s parser rejects one is unverified.
- With the table's answer (5), `needsHigher(doc, level 5)` returns null while `playable` silently drops the policy at level 5 (task review finding, Important).
- Built code (`f9d69dd5`, `src/lib/game/allowed.ts:250`) follows `:535` (`preset === null` → 6).

## Options I see
1. Follow G3's definition: 6 whenever any money policy is not `isGiven`; amend `:507`/`:535` to say "not given" instead of "preset null". Recommended — levelNeeded and runs can never disagree.
2. Follow the table: 5; accept that the case is unreachable once `game-sim`'s parser only admits money selectors on money policies.

## Blocking
Task 3's fix round (row G3 is held from "passed review" until this is ruled). Tasks 4+ continue.
