# Ruling game-shell-1
Package commit: 0b187d7c
Changes design: yes
Changes contract: no
## Ruling
Paint is won while the simulation is locked and the latest `complete` score has `paintWon(net, goal.amount)`. A score that is not `complete` (during a stroke, or while the worker is still filling) leaves the won state as it is: whether Paint is won changes only when a new complete score arrives. So "Keep playing" (the kept state), the closed card and the offer all hold through a stroke that keeps the room at or above the goal, and the level cell's "Level up" does not flicker during a stroke. Paint stops being won only when a complete score falls below the goal (or the page unmounts, or the simulation unlocks); only then is the offer cleared and the kept state reset, so a later complete score that crosses the goal again reopens the card. This is the reading the rest of the section already gives ("Paint's win is judged on complete scores"; "The offer stays, so the level cell keeps 'Level up'"). `page.game.svelte.spec.ts` gains a case: after "Keep playing", a stroke whose incomplete scores come before a complete score still at or above the goal leaves the card closed and the offer set throughout. No interface row changes.
## Re-read
- docs/superpowers/specs/2026-11-22-game-shell-design.html § sec-design-paint
- docs/superpowers/specs/2026-11-22-game-shell-design.html § sec-tests-component
## Affected units
- game-shell: first task that no longer holds: Task 4 (Paint's win)
## Build graph
- game-shell
