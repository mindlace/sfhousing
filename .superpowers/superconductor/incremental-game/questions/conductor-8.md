# Question conductor-8 — from incremental-game-conductor
## Question
Comprehension-gate finding gate-7: deleting an account now deletes its saved games (minor). Does the package stand as written on this point, or is it amended? If two specs disagree, which one states the system? If the finding sets the package against the owner's words, rule from the owner's words and their reasons as the ledger records them.
## What the package says
The finding below quotes the package with path and anchor; read those passages on disk.
## What I found
From a fresh reader who explained the system from the package alone and then compared that with the sources (`surveys/gate-explain.md`, `surveys/gate-findings.md`). The reader's claims are testimony, not verified by the conductor.

- **Source.** "When a design choice trades durability of sims, links or history against deletion or data minimisation, choose durability and say so, unless real personal data is involved" (`M/sims-are-public-keep-them.md:15`). The owner: "deletion shouldn't kill any shared links", "a deleted person's commits stay" (`:11`).
- **Package.**
  - "Deleting the account deletes its saved games. Published plans and policies stay." (`D:262`)
  - `deleteGamesOf` runs in `closeAccountRows` (`S/game-save#sec-design-deletion`).
  - `remove-multiuser` drops the e2e case "deleting the account signs out and keeps both sims" (`S/remove-multiuser#sec-tests-e2e`).
- **Drift.** Saved games are not personal data and not shared, so either choice is defensible. Still, the package picks deletion against a standing preference for durability, without a ruling and without saying so.
## Options I see
- The package stands as written, and the ruling says why the source is met.
- The package is amended so the specs agree with each other and with the source.
## Blocking
No task yet: no operator has a plan. Units whose specs the finding touches: game-save, remove-multiuser.
