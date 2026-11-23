# Question conductor-10 — from incremental-game-conductor
## Question
Which unit writes the rest of `src/routes/+layout.svelte` beyond game-core's store script: `game-shell`, or no unit?
## What the package says
Reported by incremental-game-game-shell (testimony, not verified by the conductor): `docs/superpowers/specs/2026-11-22-game-core-design.html:768`, `:968`, `:1069` say game-shell writes "the rest" of `src/routes/+layout.svelte`; `docs/superpowers/specs/2026-11-22-game-shell-design.html:407`, `:592`, the design doc and the build graph's game-shell row ("Not `src/routes/+layout.svelte`") say it does not.
## What I found
game-shell's plan (`docs/superpowers/plans/2026-11-22-game-shell.html` on branch incremental-game-game-shell) follows the game-shell spec and defines no layout change.
## Options I see
- game-shell does not write the layout; game-core's spec is brought into line.
- Some layout change is needed that no unit owns; the ruling names it and its owner.
## Blocking
No task. Units: game-core, game-shell.
