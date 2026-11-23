# Ruling game-core-5
Package commit: f4d1f349
Changes design: yes
Changes contract: no
## Ruling
`levelNeeded` follows G3's definition: the lowest level whose `allowedAt` runs every policy of the document, 6 when none does. A money policy that is not given (`isGiven` false: its `preset` is null, or its selector is not `fund`, `baseline` or `terms`) needs 6, whatever its `preset` holds. A given money policy needs 5. So `levelNeeded` and `runs` never disagree: at or above `levelNeeded(doc)`, `playable` removes nothing, and `needsHigher` names a level whenever `playable` would drop a policy at the game's level. In `game-core`, the rule list, the `tbl-runs` rows and the `tbl-level-needed` rows say "given" and "not given" in place of "preset a string" and "preset null". In `game-sim`, the "Unlocks in a later round" line marks at level 5 every money policy that is not given. G3's interface row is unchanged. Whether `game-sim`'s parser admits a money policy on a non-money selector does not matter to this rule.
## Re-read
- docs/superpowers/specs/2026-11-22-game-core-design.html § sec-design-allowed (rule list, tbl-runs, tbl-level-needed)
- docs/superpowers/specs/2026-11-22-game-sim-design.html § sec-design-locks
## Affected units
- game-core: clarification
- game-sim: clarification
## Build graph
- game-core
- game-sim
