# Question conductor-11 — from incremental-game-conductor
## Question
game-shell's e2e tests seed published plans through `/api/e2e/plans` (`seedPlanRow`), which is in `remove-multiuser`'s write set (`src/routes/api/e2e/**`). Does that route and helper survive `remove-multiuser` in the form game-shell's spec assumes, and which interface row carries it?
## What the package says
Build graph: `remove-multiuser` writes `src/routes/api/{sims,invites,operator,account,e2e}/**` and `src/lib/server/e2e/**`; `game-shell` needs G1–G5, X1, L1 and names no row from `remove-multiuser`.
## What I found
Reported by incremental-game-game-shell (testimony): tasks 6 and 8 of `docs/superpowers/plans/2026-11-22-game-shell.html` use `/api/e2e/plans` (`seedPlanRow`). Not verified by the conductor.
## Options I see
- The seam stands unchanged through remove-multiuser, and the specs say so.
- game-shell needs a row from remove-multiuser (an edge in the build graph).
## Blocking
game-shell plan tasks 6 and 8, if the seam changes.
