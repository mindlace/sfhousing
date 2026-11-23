# Ruling game-sim-1
Package commit: 70f0bc16
Changes design: yes
Changes contract: no
## Ruling
`/sim` takes no Remix hand-off, so the component case in `src/routes/s/[id]/page.view.svelte.spec.ts` "after Remix, /sim shows the remixed document over the earlier v2 autosave" tests behaviour that no longer exists. `game-sim` deletes that one case, in the same change that removes the hand-off, and nothing else in the file. The rest of the file is `game-shell`'s, which rewrites the Remix tests: Remix makes a saved game and calls `loadPage`, and no case mounts `/sim` after Remix. The two units can run together. Whichever merges second resolves a conflict in that file by keeping `game-shell`'s Remix tests and no hand-off case. Every unit's branch passes `npm run test:unit`. Only the e2e remix tests stay red between the two merges, as before. The `sfhSimRemix` type in `src/app.d.ts` stays for `closing`, which owns unused types. How `game-sim`'s e2e seeds published policies (through the page rather than `/api/e2e/plans`) is left to the operator, because the spec fixes no seeding mechanism.
## Re-read
- docs/superpowers/specs/2026-11-22-game-sim-design.html § sec-write-set-files
- docs/superpowers/specs/2026-11-22-game-sim-design.html § sec-tests-existing
- docs/superpowers/specs/2026-11-22-game-shell-design.html § sec-tests-component
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-write-sets (tbl-write-sets row game-sim, ordering notes)
## Affected units
- game-sim: clarification
- game-shell: clarification
## Build graph
- game-sim
- game-shell
