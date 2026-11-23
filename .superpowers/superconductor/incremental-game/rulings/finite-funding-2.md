# Ruling finite-funding-2
Package commit: f45e47eb
Changes design: yes
Changes contract: yes
## Ruling
- `LEGACY_UNCAPPED_DOLLARS` is 10_000_000_000_000: ten trillion dollars a year. `parseCalibration` reads an older dataset's `uncapped: true` federal pool as one yearly inflow of that amount from the dataset date with no end, and never refuses the calibration (F2).
- That amount pays the federal part ($443,108 a home) of about 22.6 million affordable homes a year, more than fifty times San Francisco's housing stock. The pool binds only when a year's federal asks pass it, which no policy on a San Francisco dataset reaches, so a policy published on an older dataset plays as it did. Published datasets are San Francisco datasets only; the synthetic test city is not one.
- The amount is above `MAX_DOLLARS` (100 billion, the most an added pool's inflow may hold), so `isNoCeiling` is true only for an older dataset's federal pool and no added pool ever reads "No ceiling".
- At the largest baseline scale an editor offers (1,000%), 480 months of arrivals stay below 2^53 dollars, so pool sums stay exact whole numbers.
- Tests that need money that does not bind use `LEGACY_UNCAPPED_DOLLARS`, which no test on fixture-0 or the mini city reaches. A test on a synthetic city large enough to reach it (the "unlimited money" case of `src/lib/sim/scenario/engine-finance.spec.ts`) gives its pool a larger yearly amount of its own, below 2^53 ÷ 40, with a comment that says why.
- `bounds.spec.ts` on the older-format fixture asserts the federal pool is never short and its available money never falls below 99% of `LEGACY_UNCAPPED_DOLLARS`. The page tests use the constant (a pool of `LEGACY_UNCAPPED_DOLLARS` reads "No ceiling" and has no level; a yearly pool of `MAX_DOLLARS` names its amount).
- Reason: option 1 rests on a live-data check nobody can run here, and option 3 breaks D5 and the global constraint that every earlier published policy keeps working. Raising the amount keeps "plays as it did" true on physical grounds, keeps sums exact, and separates the legacy marker from `MAX_DOLLARS`.
## Re-read
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-if-f2
- docs/superpowers/specs/2026-11-22-finite-funding-design.html § sec-design-pool-types
- docs/superpowers/specs/2026-11-22-finite-funding-design.html § sec-design-reach
- docs/superpowers/specs/2026-11-22-finite-funding-design.html § sec-tests
## Affected units
- finite-funding: clarification (Task 3's constant becomes 10_000_000_000_000; tests and docs that name 100 billion read the constant; the synthCity "unlimited money" test keeps its own larger amount with a comment)
- funding-measures: clarification (F2 row text only; `isNoCeiling` use unchanged)
- pool-closing: clarification (F2 row text only)
## Build graph
- finite-funding
- funding-measures
- pool-closing
