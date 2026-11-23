# Ruling conductor-7
Package commit: ccca1eee
Changes design: yes
Changes contract: no
## Ruling
The package stands, and now says so outright. The federal ceiling ($564,519,592, the best award year) is the most the federal tax-credit pool receives in a year: one yearly inflow of that amount (F2). Like every pool, it pays from all it has received less what is committed, so credits not awarded in their year stay in the pool and can be awarded later. No yearly limit on awards is added.

Why this meets the owner's words:
- R2 asked that "federal tax credits get a yearly ceiling". The ceiling is yearly and it bounds the money: the pool can never pay more over any span of years than the ceilings of those years. That is what removed "can always pay", the thing R2 was about.
- Carrying unused credits forward is how the source works: California's private-activity bond ceiling for rental housing, which backs the 4% credits that are nearly all of San Francisco's awards, is set "with carryforward" (`surveys/funding-bounds.md`, the CDLAC row). San Francisco's award is not a fixed share of a use-it-or-lose-it allocation, so a hard yearly cap on awards would be an invented rule, against the evidence ranking (R7).
- Pools are stocks in the engine and money arrives in yearly lumps on purpose (R7). A per-year award cap would add a second accounting rule to one pool only, with no source for its size.
- It does not move D1: the ceiling never binds for current law in the measured runs.
## Re-read
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-model-money
- docs/superpowers/specs/2026-11-22-finite-funding-design.html § sec-design-data-federal
## Affected units
- finite-funding: clarification
## Build graph
- finite-funding
