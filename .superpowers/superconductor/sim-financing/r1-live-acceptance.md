# Release 1 live acceptance (sim-financing)

Dataset `2026-11-10-3532a348`, built 2026-11-10 in `.claude/worktrees/sim-financing-r1` at bbf2f82c
(`npm run pipeline -- build`, no `--skip-tiles`; `tilesSkipped` false). Invariants V1 to V36: all OK.
Only warning on an invariant: V30 `sd.parcels.clip-yield-loss` share 1.56% > warnShare (pre-existing, not a failure).
Sources: `pipeline/out/2026-11-10-3532a348/` and `pipeline/.cache/derived/2026-11-10-3532a348/calibration-report.md`.

| Criterion | Result | Numbers |
| --- | --- | --- |
| market-baseline AC 3: `|today.all − (−0.643571)| ≤ 0.10` | PASS | `today.all` −0.64196 (difference 0.00161); `today.private` −0.714281; observed 129 (private 120), implied 245.126 (spec 245.521) |
| market-baseline AC 4: reproduction X within 2% of `observed.all`, no warning | PASS | X 129.019 vs 129 (+0.015%); "Market warnings: none" |
| market-baseline AC 13: existing perf budgets hold | PASS | `npm run test:perf`: 11 files, 35 tests passed. simulateNet median 12.4 ms (≤ 15), simulate + score 16.6 ms, 101 band pairs 1,028 ms (≤ 4 s), longest band/twin macrotask 46.7 ms (≤ 50), initScenario 1,454.5 ms (≤ 3 s), whole-city load 2,677 ms (≤ 5 s), heap growth 198 MB (≤ 300) |
| finance-data AC 1: `affordableHomes` on every project, null exactly for split parts, multi-phase masters, no-primary-Planning; never > units | PASS | 438 projects, 0 missing the key; 349 non-null (sum 6,044), 89 null = 35 split parts + 17 multi-phase + 37 non-PRJ (BP/CASE/PPA); 0 non-split, non-multi-phase PRJ projects null; 0 above `units` |
| finance-data AC 3: lock has `datasf-mohcd-pipeline`, PDDL-1.0; `/attribution` lists it | PASS | lock entry PDDL-1.0, 1 page (`295f8809…`); `manifest.json` carries "DataSF MOHCD Affordable Housing Pipeline", and `/attribution` renders the manifest's sources (it shows on the live site once uploaded) |
| finance-data AC 5: `affordableRoutes` sums to 1, tier 0 (≥ 30 histories) | PASS | discretionary 0.301887, streamlined 0.679245, permitOnly 0.018868 (sum 1.000000); tier 0; n 53 (expected about 54) |
| finance-data AC 10: fixture-0 `market` + `baselineFunding` (6 City, capped state, uncapped federal, shares 1, `minHomes` 2 ≤ 11) | PASS | from bbf2f82c; see r1-golden-diff.md |
| finance-data AC 12: `check` by the 4.6 formulas; warning iff differ by > half; 19 award rows → observed 980 | PASS | implied 780, observed 980 (19 award rows), ratio 0.80; "check warning: none" |
| finance-data AC 13: report sections 12 and 13; V29 holds | PASS | sections 11, 12, 13 present in order; V29 "two in-run computations are byte-identical" |
| finance-data AC 19: built, uploaded and signed off once, on the Release 1 branch | PARTIAL (by design) | built once here; upload, verify and signoff are waiting on the conductor |
| live `byTier`: every tier but aboveModerate ≥ 0 | PASS | veryLow 2,203, low 1,352, moderate 559, aboveModerate 4,609, unrecorded 0; sum 8,723 = `units` (V22 checks it) |
| `calibration.json` ≤ 256 KB | PASS | 109,376 B (V25) |

## Other live values (for the docs)

- MOHCD income mix: veryLow 0.483439, low 0.433384, moderate 0.076402, aboveModerate 0.006775; `minHomes` 70; 45 rows; 1,023 of 6,304 homes undeclared (16.2%). These match the expectations exactly.
- Pool shares match the expectations exactly (federal 0.51433 … redevelopment 0.00893).
- `slope.perCostShare` 1.65118 (typicalUncoveredShare 0.432588; private starts 2021-25 binned A 3, B 15, C 2, D 10, E 179; 10 unbinned); `crossCheck.logOdds` −1.28933; hold-out ln(129 ÷ 386.22) = −1.09659 (report only).
- Recent starts by cohort: affordable 9, private 114, no Planning record 4, counts not recorded 2. Per year: 2023 33 (2 / 31), implied 81.4854; 2024 40 (3 / 37), implied 81.5714; 2025 56 (4 / 52), implied 82.0688.
- `/lesscars` at 2068 versus production `2026-11-08-3b7fa918`: extra +29,349 (p10 28,912, p50 29,428, p90 29,647), up from +29,096 (28,381 / 29,184 / 29,526). Plan 94,287 vs baseline 64,938 (was 116,212 vs 87,116). By source: freed 22,959 (unchanged), parking 6,333 (was 6,018), transit-unlocked 57 (was 119). Representative seed 55 (was 91). The live summary's lowest `extra.mean` in any year is −0.0099 (one seed's −1), and `p10` never drops below 0, so the fixture's early-year dip shows up only as noise on the live plan.
- `byTier` cannot be compared directly with the doc's expected row (1,670 / 1,252 / 557), because that row counts from 2023-01-01 and `rhnaCompletedNet` counts from 2022-06-30.
- Build timings: scenario 71.0 s, policy 24.0 s, gross 22.8 s, sql 26.8 s, calibration 15.0 s, tiles 12.5 s, lesscars 7.4 s.
