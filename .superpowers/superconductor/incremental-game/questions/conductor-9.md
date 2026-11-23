# Question conductor-9 — from incremental-game-conductor
## Question
Comprehension-gate finding gate-8: a game deleted on one device discards unsent edits on another (minor). Does the package stand as written on this point, or is it amended? If two specs disagree, which one states the system? If the finding sets the package against the owner's words, rule from the owner's words and their reasons as the ledger records them.
## What the package says
The finding below quotes the package with path and anchor; read those passages on disk.
## What I found
From a fresh reader who explained the system from the package alone and then compared that with the sources (`surveys/gate-explain.md`, `surveys/gate-findings.md`). The reader's claims are testimony, not verified by the conductor.

- **Source.** D8: "When saved games meet (a sign-in on a device with its own games, two accounts joined, two devices changing one game), every one is kept as its own saved game. Nothing is merged and nothing is picked over another." (`L:106`; `D#sec-rulings-review`)
- **Package.**
  - "A 410 to the send of a save that is not the current game removes it here" (`S/game-save:617`).
  - A pull: "changed here, send it, which answers 410 and follows the 410 rule" (`S/game-save:639`). Only the current game is kept under a new id.
- **Drift.** If device A deletes a game while device B has changed it, B's changes are thrown away for any game that is not current there. The delete wins over the edit. "Deleted on the others the next time they sync" (`D#sec-model-accounts`) covers an unchanged copy, but D8's keep-everything rule suggests a changed copy should survive as "{name} (this device)", as it does for the current game.
## Options I see
- The package stands as written, and the ruling says why the source is met.
- The package is amended so the specs agree with each other and with the source.
## Blocking
No task yet: no operator has a plan. Units whose specs the finding touches: game-save, game-core.
