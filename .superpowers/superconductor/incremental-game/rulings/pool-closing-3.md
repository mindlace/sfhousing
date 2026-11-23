# Ruling pool-closing-3
Package commit: a91f3877
Changes design: yes
Changes contract: no
## Ruling
Option A. F3 stands as written: `MoneyView.closed` and `MoneyView.shut` are required. `pool-closing` adds `closed: {}` and `shut: {}` to the `MoneyView` literal returned by the `money()` helper in `src/lib/timeline/pool-level.spec.ts` (line 55 on the integration branch), and changes nothing else in that file. That literal is in `pool-closing`'s write set. `src/lib/timeline/pool-level.spec.ts` is the one file `pool-closing` and `funding-measures` both write: `pool-closing` writes it first, and `funding-measures`, which runs after `pool-closing`, writes it afterwards. No other `MoneyView` literal outside `pool-closing`'s write set lacks the two fields: a grep of `src` finds only this one and a cast inside `src/lib/fzp/money-view.ts`, which is `pool-closing`'s file.
## Re-read
- docs/superpowers/specs/2026-11-22-pool-closing-design.html § sec-write-set
- docs/superpowers/specs/2026-11-22-pool-closing-design.html § sec-write-set-files
- docs/superpowers/specs/2026-11-22-funding-measures-design.html § sec-write-set
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-write-sets
## Affected units
- pool-closing: clarification
- funding-measures: clarification
## Build graph
- pool-closing
- funding-measures
