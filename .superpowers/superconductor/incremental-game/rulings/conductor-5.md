# Ruling conductor-5
Package commit: ecff0f5f
Changes design: yes
Changes contract: yes
## Ruling
The package is amended. The owner decided "Pools should be seen to drain as their money is allocated" (information design review, Decided: public money), and the design's traceability row says the package carries it. The package as written did not: the baseline bar, which every player sees, still refilled each year, and a closed pool could show as partly full.

- Every pool's bar on the timeline shows what is left of all the money the pool receives in the window. It starts full and drains as its money is allocated, and a yearly payment never refills it. A pool with no end counts its payments up to the window's last month, so "Current funding" drains like any other pool. Yearly lumps still arrive (R7); the bar counts each one from the start.
- A closed pool's bar reads empty from the month it ran out until an arrival opens it again, because what it still holds is never awarded (D13). Money returned to a closed pool does not raise its bar.
- F3 gains `MoneyView.shut: Record<string, boolean[]>`: per pool id, by calendar month, true from the month the pool ran out through the last month before it opens again. `pool-closing` builds it (MoneyRow pool entries gain `shut?: boolean`). `funding-measures` reads it in `poolLevel`. `MoneyView.closed` and Details' "ran out" line are unchanged.
- `funding-measures`' level: month i's level is Σ(shut ? 0 : leverage × lifetime − used) ÷ Σ(leverage × lifetime), over the pools whose lifetime is not null. `lifetimes` is null only for an older dataset's no-ceiling pool (`isNoCeiling`) and when the money track throws. Such a pool has no level and stays out of every sum.
- `funding-measures` now runs after `pool-closing` (it needs F3). The two still write different files. The longest chain stays five units.
## Re-read
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-model-money
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-if-f3
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-subsystems (funding-measures)
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-write-sets (ordering notes, tbl-write-sets row funding-measures)
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § tbl-traceability (pool's bar drains)
- docs/superpowers/specs/2026-11-22-funding-measures-design.html § sec-goal, sec-interfaces (F3 added), sec-design-level, sec-write-set, sec-tests-unit, sec-docs, sec-out-of-scope
- docs/superpowers/specs/2026-11-22-pool-closing-design.html § sec-goal, sec-interfaces (F3), sec-design-shapes, sec-design-money, sec-write-set, sec-tests-money, sec-docs, sec-out-of-scope
- docs/superpowers/specs/2026-11-22-closing-design.html § sec-docs (timeline-ui.md :32)
- docs/superpowers/design/2026-11-22-1216-incremental-game-build-graph.md (rows funding-measures, pool-closing; longest chains)
## Affected units
- pool-closing: clarification
- funding-measures: clarification
- closing: clarification
## Build graph
- pool-closing
- funding-measures
- closing
