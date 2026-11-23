# Ruling conductor-4
Package commit: d39a83b4
Changes design: yes
Changes contract: no
## Ruling
The package is amended in `closing` only; `remove-lesscars` and `finite-funding` state the system and stand as written. Their older-dataset handling is compatibility code that the global constraint ("every policy published before this build" keeps working) and D5 require, so the closing sweep treats it as an allowed place, not as a defect.

Closing's final sweep allows, besides the places it already names:
- The code that keeps older datasets loading, with its comments and tests: `manifest.ts`'s parse of `scenarios.lesscars` and the derived `splitRoads`; `style.ts`'s `LC_ROADS_SOURCE_LAYER`, `LC_CLONE_SUFFIX`, `isRoadsLayer`, `roadsClone` and their comment; `parseCalibration`'s reading of `uncapped` in `model.ts`; `parsePool`'s ignored `uncapped` in `levers/finance.ts`; and the tests and fixtures that prove those rules (`manifest.test.ts`, `style.spec.ts`'s `roads_lc` cases, `scripts/data-local.spec.ts`'s `lesscars` block, `model.test.ts`, `fixtures/calibration-uncapped.json`, `levers/finance.spec.ts`). Nobody removes or rewrites them.
- The reserved handle words `lesscars` and `fzp` in `handle-normalize.ts` and their tests.
- `docs/dev` sentences that state current behaviour about a removed name: the 404s of `/fzp` and `/lesscars`, how older datasets' `scenarios.lesscars`, `roads_lc` and `uncapped` pools load (`finance-data.md` "Older datasets", `finance-levers.md` parse rules), and the dated measurement record in `road-lots.md` that names the deleted plan file.
Only hits outside these places are fixed (docs, config, comments) or reported as the removing unit's defect. Closing's Leftovers rule leaves comments on that compatibility code as they are.
## Re-read
- docs/superpowers/specs/2026-11-22-closing-design.html § sec-design-sweep
- docs/superpowers/specs/2026-11-22-closing-design.html § sec-design-leftovers
## Affected units
- closing: clarification
## Build graph
- closing
