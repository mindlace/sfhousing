# Ruling game-shell-1-1
Package commit: 5bc853c4
Changes design: yes
Changes contract: no
## Ruling
`game-shell` owns the one line of `src/routes/about/page.svelte.spec.ts` that lists the parts' sections on `/about`. That list leaves out the sub-sections of Using it (`ABOUT_ID.shortcuts`, `ABOUT_ID.levels`, `ABOUT_ID.savedGames`) and still expects the four parts in order, exactly as `src/lib/about/AboutDialog.svelte.spec.ts` does. The test's intent is unchanged: it checks the parts, and the sub-sections that `game-shell` adds under Using it are not parts. No other unit writes that file. The selector is not widened to a structural rule; the explicit exclusion list matches the dialog spec. The design doc's write-sets row, the `game-shell` spec's write set, files and tests, and the build graph's `game-shell` row name the file. No interface row changes.
## Re-read
- docs/superpowers/specs/2026-11-22-game-shell-design.html § sec-write-set, sec-write-set-files, sec-tests-component
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-write-sets (tbl-write-sets row game-shell)
## Affected units
- game-shell: clarification
## Build graph
- game-shell
