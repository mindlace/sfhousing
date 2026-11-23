# Measurement: when current law reaches the goal, by funding assumption

Agent run, 2026-11-22, on the live dataset `2026-11-14-1a31d026` (asOf 2026-11-10, `baseline.completedNet` 8,723, window's last month Oct 2066). The empty document (`DEFAULT_POLICY4`) through the real timeline host (`createTimelineHost`, 480 months, seed 1), with only the calibration object changed in memory. Goal read with `readGoal(defaultGoal(asOf), view, 479)`, checked against a month-by-month scan. Script and outputs are in the session scratchpad (`measure/`), not in the repository. Numbers are the agent's; the composer has not re-run them.

| Variant | Goal first met | Homes 2031-01 | 2040-01 | 2050-01 | 2060-01 | Oct 2066 | Income-restricted homes, Oct 2066 |
|---|---|---|---|---|---|---|---|
| A, as published (endless money) | Sep 2057 | 16,711 | 50,187 | 70,814 | 84,718 | 94,458 | 30,303 |
| B, no `market` and no `baselineFunding` (no money, 2007 to 2025 average market) | May 2061 | 16,596 | 46,225 | 68,443 | 80,445 | 87,629 | n/a |
| B2, today's market model, money removed | not met, short 12,253 | 16,376 | 42,971 | 58,031 | 64,944 | 69,816 | n/a |
| C, City programmes end: bonds after 3 years, impact fees after 2, Redevelopment now, Housing Trust Fund 2043 | Nov 2064 | 16,371 | 48,402 | 67,146 | 76,836 | 84,112 | 19,317 |
| D, C plus a federal ceiling of $434,245,840 a year | Nov 2064 (identical to C) | 16,371 | 48,402 | 67,146 | 76,836 | 84,112 | 19,317 |
| E, D plus the state source ending after 5 years | not met, short 761 | 16,371 | 48,285 | 65,536 | 75,813 | 81,308 | 16,387 |

How the variants were made: each ended source had its baseline programme's `to` and its pool's yearly inflow `to` set to the same day (Redevelopment: programme `to` = asOf and the inflow dropped). Ending one day earlier changed no goal month.

Checks the agent reports:

- A agrees with the app: Sep 2057. Two runs of A were identical.
- Every ended pool's last ledger inflow is its last anniversary on or before `to`; no programme commits after its `to`; no waiting application holds an ended programme from the month containing `to + 1`.
- One waiting application was observed at a programme's end: with the end on an inflow day it was awarded that day; with the end one day earlier it left the line on `to + 1` without an award (the documented lapse) and its lot was awarded later.
- The federal ceiling never binds: the capped federal pool's balance never fell below $247M.
- In A the line is long (2,240 waiting in month 1, some waiting in all 480 months); in C to E it is nearly empty.

## Second run, 2026-11-22: the bounds the `finite-funding` spec writes

Agent run on the same dataset and commit `8125e557`, 480 months, seed 1. A and C reproduced with identical series. Bounds: city debt $80.5M a year until $260.31M is used; Our City, Our Home no end; General Fund $21.8M no end, the $14.9M housing stability fund dropped; Housing Trust Fund last arrival by 2043-06-30; Redevelopment dropped; state $150M no end; federal one yearly inflow of $564,519,592; programmes keep `to: null`. Impact fees three ways: no end at $34.8M (F-none, the spec's fallback), two years left (F-2y), nothing left (F-0). G is F-2y with the state source ending after five years. Numbers are the agent's; the composer has not re-run them. Script `measure2.mts` and outputs are in the session scratchpad (`measure/`).

| Variant | No closing (today's engine) | Closing rule emulated | Programmes end on the last money day |
|---|---|---|---|
| F-none | not met, short 11,603 | Mar 2064 (31 months to spare; 84,897 homes by Oct 2066) | May 2064 |
| F-2y | not met, short 12,467 | Jul 2065 (15 months; 83,046) | May 2065 |
| F-0 | not met, short 11,487 | Apr 2065 (18 months; 83,539) | May 2065 |
| G | not met, short 12,467 | not met, short 1,244 (80,825) | not met, short 757 |

- Without closing, every affordable application waits on the first pool to run dry (impact fees from month 27 in F-2y; city debt from months 38 and 39 in the others): 13 awards in 40 years against 137 with closing, and the state and federal pools end with $5.8B and $21.9B unspent.
- Closing was emulated by ending a pool's programme on the last day of the first month, after its last arrival, in which the engine's own `asksOf` and `availableOf` find it short, by repeated passes. It is not the engine rule of F3.
- The federal ceiling never binds (lowest balance $446M). F-0 landing before F-2y is path noise on one seed.
- Income-restricted homes by Oct 2066: about 18,400 to 20,200 with closing, against 30,303 as published.

What the second run means for the design: D1 holds only with pool closing (D13), with 15 to 31 months to spare, and fails if the state source ends. Between the merges of `finite-funding` and `pool-closing`, current law misses on the live data.

What the first run means for the design:

- With the City bounds the research found and the state source continuing, current law still reaches the goal inside the window, in Nov 2064, about two years before the window's end.
- If the state source also ended, current law would miss by 761 homes. The margin is thin, and the state source's bound is the one the research could not settle.
- The variants ended programmes on dates. Pool closing (F3) ends a source when it runs dry instead; the result on the built dataset is what the build check judges.
