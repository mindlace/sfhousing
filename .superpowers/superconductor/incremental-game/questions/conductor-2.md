# Question conductor-2 — from incremental-game-conductor
## Question
Comprehension-gate finding gate-2: what a level up does after the round is complete (minor; two specs disagree). Does the package stand as written on this point, or is it amended? If two specs disagree, which one states the system? If the finding sets the package against the owner's words, rule from the owner's words and their reasons as the ledger records them.
## What the package says
The finding below quotes the package with path and anchor; read those passages on disk.
## What I found
From a fresh reader who explained the system from the package alone and then compared that with the sources (`surveys/gate-explain.md`, `surveys/gate-findings.md`). The reader's claims are testimony, not verified by the conductor.

- **game-core.** The pure `levelUp` table: "Level 5, round complete | Anything | `p` itself" (`S/game-core:485`). The store's table: "5, round complete | Anything | Progress unchanged; offer null" (`S/game-core:699`).
- **game-sim.** "A later level up at level 5 changes neither the level nor roundComplete, so it banks the new result and the clock stays where it is." (`S/game-sim:608`, `#sec-design-levelup`)
- **Drift.** The two specs would build, or test, different behaviour. No button calls a level up after the round is complete (the win card, the panel and the level cell hide it by `roundComplete`), so a player sees no difference. A `game-sim` test written from its spec would still fail against `game-core`.
## Options I see
- The package stands as written, and the ruling says why the source is met.
- The package is amended so the specs agree with each other and with the source.
## Blocking
No task yet: no operator has a plan. Units whose specs the finding touches: game-core, game-sim.
