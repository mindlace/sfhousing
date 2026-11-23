# Ruling conductor-10
Package commit: 464b4eca
Changes design: yes
Changes contract: no
## Ruling
`src/routes/+layout.svelte` is written by `game-core` alone: its script's imports, `makeGame` and the `provideGame` call. No other unit changes the layout, and the rest of it stays as it is in this build. `game-shell` needs no layout change: `SiteHeader`, `LevelCell` and the account entry read the game themselves with `useGame()`, and the layout keeps rendering `SiteHeader` with the props it passes today. The design doc (`tbl-write-sets` and its ordering note), the build graph's `game-shell` row and the `game-shell` spec already say this; the three `game-core` passages that named `game-shell` as writing "the rest of the layout" now say the same. G2 is unchanged.
## Re-read
- docs/superpowers/specs/2026-11-22-game-core-design.html § sec-design-layout
- docs/superpowers/specs/2026-11-22-game-core-design.html § sec-write-set
- docs/superpowers/specs/2026-11-22-game-core-design.html § sec-out-of-scope
## Affected units
- game-core: clarification
## Build graph
- game-core
