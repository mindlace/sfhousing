# Ruling remove-lesscars-1
Package commit: e4098219
Changes design: yes
Changes contract: no
## Ruling
`remove-lesscars` owns `scripts/data-transit.ts` and `scripts/data-transit.spec.ts`. `npm run data:transit` writes the local dataset's raw manifest JSON back with only its `transit` key set. It parses the manifest to check it and to build that entry, and never writes the parsed value. So an older manifest keeps its `scenarios.lesscars` object after the script runs, and every later parse still derives `splitRoads: true` from it, as L1 requires. L1's rules stand as written: `splitRoads` is derived at parse, a raw `splitRoads` key is ignored, and no build or script writes the mark.

`scripts/data-transit.spec.ts` proves it on an older manifest: the written JSON keeps `scenarios.lesscars`, has no `splitRoads` key, carries the new `transit`, and parses again with `splitRoads: true`.

`closing`'s final sweep treats that spec's older-manifest case as compatibility test code, beside `scripts/data-local.spec.ts`'s `lesscars` block, and leaves it alone.

Reason: before this unit the round trip kept `scenarios.lesscars`, so dropping it would be a regression this unit introduces. The file is used only for local development and no other unit writes it, so the fix belongs with the change that made it necessary. The interface row L1 does not change; the design doc's write-sets table, the build graph row and the spec now list the two files.
## Re-read
- docs/superpowers/specs/2026-11-22-remove-lesscars-design.html § sec-design-manifest
- docs/superpowers/specs/2026-11-22-remove-lesscars-design.html § sec-write-set, sec-write-edit
- docs/superpowers/specs/2026-11-22-remove-lesscars-design.html § sec-tests-added
- docs/superpowers/specs/2026-11-22-closing-design.html § sec-design-sweep
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-write-sets (tbl-write-sets row remove-lesscars)
## Affected units
- remove-lesscars: clarification
- closing: clarification
## Build graph
- remove-lesscars
