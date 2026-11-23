# Question conductor-4 — from incremental-game-conductor
## Question
Comprehension-gate finding gate-9: closing's final sweep reports code that other units keep on purpose as defects (minor; specs disagree). Does the package stand as written on this point, or is it amended? If two specs disagree, which one states the system? If the finding sets the package against the owner's words, rule from the owner's words and their reasons as the ledger records them.
## What the package says
The finding below quotes the package with path and anchor; read those passages on disk.
## What I found
From a fresh reader who explained the system from the package alone and then compared that with the sources (`surveys/gate-explain.md`, `surveys/gate-findings.md`). The reader's claims are testimony, not verified by the conductor.

- **Kept by design.**
  - `S/remove-lesscars:221`: "style.ts keeps LC_ROADS_SOURCE_LAYER ('roads_lc') …"
  - `manifest.ts` still parses `scenarios.lesscars` and derives `splitRoads` (`S/remove-lesscars#sec-design-manifest`).
  - `scripts/data-local.spec.ts` "keeps its lesscars block".
  - `parseCalibration` reads `uncapped` from older datasets, and `parsePool` accepts and ignores it (`S/finite-funding:605`, `#sec-design-pool-types`).
  - The reserved handles `lesscars` and `fzp` stay.
- **Closing.** Its sweep greps `lesscars`, `roads_lc` and `'uncapped'`/`.uncapped`. Its allowed places cover only tests that assert a 404 or the F2 load rule in a Vitest file. "A hit in code or test code anywhere else is a defect of the unit that removed the name: it is reported" (`S/closing:263`).
- **Drift.** Closing will report L1's and F2's compatibility code as defects owned by `remove-lesscars` and `finite-funding`, and its verification line cannot read "finds nothing". Code stays untouched, but the handback is wrong and a conductor may send fixes that break older datasets. The allowed list should name those files.
## Options I see
- The package stands as written, and the ruling says why the source is met.
- The package is amended so the specs agree with each other and with the source.
## Blocking
No task yet: no operator has a plan. Units whose specs the finding touches: closing, remove-lesscars, finite-funding.
