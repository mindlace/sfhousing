# Ruling game-core-3
Package commit: 216723b7
Changes design: yes
Changes contract: no
## Ruling
When the store rebuilds from `sfhousing:save:*` keys after finding an invalid index (construction step 4), a value becomes an entry only when it parses as a `GameSave` and its `id` equals the rest of its key after `sfhousing:save:`. A value that will not parse, or whose `id` differs from its key's, is moved aside exactly as in step 5: its raw text is copied to a `sfhousing:save:corrupt:<ISO time>` key and its key is removed. Since each key holds one save and an entry's id is its key's suffix, the rebuilt entries' ids are always distinct, so the rebuilt index is valid. This is the same rule step 5 applies against an index entry's id, applied against the key; no save is ever rewritten or moved to another key.
## Re-read
- docs/superpowers/specs/2026-11-22-game-core-design.html § sec-design-store-construct (step 4)
## Affected units
- game-core: clarification
## Build graph
- game-core
