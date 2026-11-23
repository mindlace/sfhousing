# Question conductor-3 — from incremental-game-conductor
## Question
Comprehension-gate finding gate-3: who writes the level 2 check (minor; specs disagree on ownership). Does the package stand as written on this point, or is it amended? If two specs disagree, which one states the system? If the finding sets the package against the owner's words, rule from the owner's words and their reasons as the ledger records them.
## What the package says
The finding below quotes the package with path and anchor; read those passages on disk.
## What I found
From a fresh reader who explained the system from the package alone and then compared that with the sources (`surveys/gate-explain.md`, `surveys/gate-findings.md`). The reader's claims are testimony, not verified by the conductor.

- **Five places name `closing`.**
  - `S/finite-funding:678`: "is closing's scripts/level2-check.ts"
  - `S/finite-funding:898`: out of scope, "closing"
  - `S/pool-closing:461`: "closing's scripts/level2-check.ts"
  - `S/game-core:1073`: "The build check that current law reaches the goal: closing."
  - `S/game-sim:864`: the same
- **The rest of the package names `reach-check`.** The build graph row for `reach-check`, `S/reach-check#sec-goal` and `S/closing#sec-write-set` ("scripts/level2-check.ts and its test are reach-check's; this unit runs the script and never changes it"), and `D#sec-if-g4`.
- **Drift.** These are stale references. They change no behaviour, but an operator of `finite-funding` or `pool-closing` reading its own spec is told the wrong unit owns the D1 check.
## Options I see
- The package stands as written, and the ruling says why the source is met.
- The package is amended so the specs agree with each other and with the source.
## Blocking
No task yet: no operator has a plan. Units whose specs the finding touches: reach-check, closing and the two other specs the finding names.
