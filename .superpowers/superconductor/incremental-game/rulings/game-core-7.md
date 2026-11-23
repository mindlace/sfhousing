# Ruling game-core-7
Package commit: 47e545f5
Changes design: yes
Changes contract: no
## Ruling
In the store's reactive `saves`, the current game's entry carries its played time as `savedAt`: the latest of its save's `savedAt` and the `savedAt` of each of the two record keys whose text parses, the same value `read` of the current game returns. Every other entry carries its save's own `savedAt`. The stored index under `sfhousing:saves:v1` keeps each save's own `savedAt`; only the reactive list substitutes the played time. `saves` is ordered by those values, latest first, equal times by id. G2's `SaveEntry` and "most recently changed first" are unchanged.

The level panel's current row reads "Level N · Playing" and never calls `playedText`, so the panel's words do not change; the rule makes the reactive entry agree with `read(current)` and with the `savedAt` the game gets when it is copied out, so any reader of `saves` (the order, a future caller) sees one value for the current game. The store's `saves` derivation sets the current entry's `savedAt` to the played time, and `store.svelte.spec.ts` asserts it.
## Re-read
- docs/superpowers/specs/2026-11-22-game-core-design.html § sec-design-store-read
## Affected units
- game-core: clarification
## Build graph
- game-core
