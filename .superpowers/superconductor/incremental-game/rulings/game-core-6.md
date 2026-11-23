# Ruling game-core-6
Package commit: 83d857d0
Changes design: yes
Changes contract: no
## Ruling
Any read of storage that throws during construction is treated as step 1 treats a throwing first read: the store is in memory mode with one fresh game at `NEW_GAME` (a new id, the default new name, null plan and policy, `savedAt` now). This covers a `getItem` of the index, of a save, of a record key or of a key in the step 4 rebuild, and the key listing of step 4. When the throw comes after construction has already set or removed a key (for example the corrupt copy of an invalid index in step 4), the store first puts back every such key as in step 8, ignoring throws while it does, so storage holds exactly what it held before construction. After that the store writes nothing, and a later page load tries construction again. A throwing key is never read as absent or unparseable: that would move it aside or rewrite the index without a game the player still has. Showing only the games read before the throw is not done either, because a storage that failed one read is not trusted for the rest. G2's rule that a refused storage operation leaves the stored games as they were holds; no interface row changes.
## Re-read
- docs/superpowers/specs/2026-11-22-game-core-design.html § sec-design-store-construct (step 1)
## Affected units
- game-core: clarification
## Build graph
- game-core
