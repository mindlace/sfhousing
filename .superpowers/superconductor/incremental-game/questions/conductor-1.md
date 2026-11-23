# Question conductor-1 — from incremental-game-conductor
## Question
Comprehension-gate finding gate-1: a policy already saved in the browser becomes a level-1 game, and every kind in it is locked (major). Does the package stand as written on this point, or is it amended? If two specs disagree, which one states the system? If the finding sets the package against the owner's words, rule from the owner's words and their reasons as the ledger records them.
## What the package says
The finding below quotes the package with path and anchor; read those passages on disk.
## What I found
From a fresh reader who explained the system from the package alone and then compared that with the sources (`surveys/gate-explain.md`, `surveys/gate-findings.md`). The reader's claims are testimony, not verified by the conductor.

- **Sources.**
  - The owner's D5 ruling: "Playback of a shared sim should preserve all its settings and behavior ...; only remix-ing should shift to only-unlocked." (`L:114`)
  - The earlier design's open question on progress: "In the browser, with the account when signed in. A saved or shared policy that already uses a kind keeps it usable." (`IDR:500`)
- **Package.**
  - "A plan or policy saved in this browser before the game existed becomes the first saved game, at level 1." (`D:198`, `D#sec-model-saves`; built by `S/game-core#sec-design-store-construct`)
  - At level 1, `/sim` is the locked page (`S/game-sim#sec-design-locked-page`).
  - Above level 1, "a saved game ... runs only the policies its level has unlocked" (`D#d5`, `D:163`). Every money policy stored before the build has `preset: null`, so it is "Unlocks in a later round" at every level (`D#sec-if-g3`).
- **Drift.** The owner limited the shift to unlocked-only to remix. The package also applies it to the existing autosave. A returning visitor who opens `/sim` sees a locked page in place of the policy they built, must win Paint to reach it, and then gets back their zoning only at level 4 and their own money never in this round. No source asks for this, and the one source that speaks to saved work asks for the opposite. A builder of `game-core` and `game-sim` will build it as written, so the owner should confirm it or give the migrated game a level that runs its document (for example `levelNeeded`, capped at 5).
## Options I see
- The package stands as written, and the ruling says why the source is met.
- The package is amended so the specs agree with each other and with the source.
## Blocking
No task yet: no operator has a plan. Units whose specs the finding touches: game-core, game-sim, game-shell, contracts.
