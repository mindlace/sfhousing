# F1 handback (finite-funding → reach-check) at 40c419e5, branch incremental-game-finite-funding

Full suite at 40c419e5: check, lint (0 errors), test:unit (8965 passed), test:pipeline (2284 passed) per Task 3's report; test:e2e 752 passed, 130 skipped (operator run, 8.2 m).

## First-year dollars by source (live funding.json, asOf 2026-11-10)
| Source | First year | Bound |
|---|---|---|
| city-debt | 80,500,000 | remaining 260,310,000 (once 80.5M ×3, 18,810,000 on anniversary 3) |
| city-ocoh | 48,600,000 | none |
| city-general-fund | 21,800,000 | none |
| city-housing-stability-fund | 0 | remaining 0 (no programme) |
| city-impact-fees | 34,800,000 | remaining 45,158,744 (once 34.8M, then 10,358,744 on anniversary 1) |
| city-housing-trust-fund | 27,400,000 | ends 2043-06-30 (last arrival 2042-11-10) |
| city-redevelopment | 0 | remaining 0 (no programme) |
| state | 150,000,000 | none |
| federal-tax-credits | 564,519,592 | none (ceiling = 1,274 × 443,108) |

Check: 780 implied against 980 observed homes a year; no warning.

## Impact-fee block
`remaining` 45,158,744, tier 2, MOHCD FY2024-25 Annual Report, Table 2 "Affordable Housing Fund Summary", p. 21 (Inclusionary $28,865,155 + Jobs-Housing Linkage $16,293,589 at 30 June 2025), retrieved 2026-11-22. Owner note: impact fees pay $34.8M and then $10.36M, then stop.

## Primary reads and differences from the spec as first written
See primaries-city.md and primaries-state-federal.md in this directory. Ruled in finite-funding-1: impact fees as above; PASS row [2] ($47,464,550) not counted; HTF 2043-06-30 (Charter: through FY2042-43); state `none`; city-ocoh cite p. 44. Other notes: the federal method's $2,861,626 SF 9% credit figure is in CTCAC's 2026 credit estimates, not the CDLAC Exhibit A the bound cites; BLA p. 42 states ">$1.2 billion since 2018", not $150M a year. Dataset version moved with funding.json: upload pending before signoff.
