# Release 2 live acceptance (sim-financing)

## Build

- **Dataset:** `2026-11-10-fdc69172`, built on 2026-11-12.
- **Where:** worktree `.claude/worktrees/sim-financing-r2` at b1ce401d. The later commit 56005ab4 is docs only, and `pipeline -- version` still gives `fdc69172`.
- **Commands:** `npm run pipeline -- fetch --restore` (archive only: 123 pages downloaded, 0 already present, no live fetch), then `npm run pipeline -- build` with no `--skip-tiles`. `tilesSkipped` is false.
- **lockSha256:** `5fdd4459…2e31e`.
- **Invariants:** V1 to V36 all OK. The only warning on an invariant is V30 `sd.parcels.clip-yield-loss`, share 1.56% > warnShare. It is pre-existing and was the same in Release 1.
- **Build warnings:** 85, the same set as Release 1's (none new, none gone).
- **Build timings (ms):** scenario 77,412 (sql 43,002, t11 18,453, base_yield 15,096); gross 26,887; sql 27,153; policy 24,257; calibration 15,496; tiles 12,830; lesscars 9,886; normalise 8,995; projects 6,663; check 4,145; basemap 2,084; chunks 1,789; reencode 1,742; transit 784; verify 451. Release 1 took a comparable time, step for step. The machine was busy: other agents' work and this release's own e2e had just finished, with the 1-minute load at 5 to 19.
- **Files kept in place:** the build is in `pipeline/out/2026-11-10-fdc69172/`, and the derived cache is in `pipeline/.cache/derived/2026-11-10-fdc69172/`.

## Counts that differ from Release 1 (`2026-11-10-3532a348`)

Every other count in `report.json` is identical.

| Count | Release 1 | Release 2 | Why |
| --- | --- | --- | --- |
| `calibration.bytes` | 109,376 | 112,720 | provenance text (item 2a) |
| `lesscars.bytes.timeline_payload` | 262,281 | 283,555 | lesscars runs with baseline funding |
| `lesscars.bytes.timeline` | 63,591 | 68,175 | lesscars runs with baseline funding |
| `lesscars.extra_2068.mean` | 29,349 | 29,241 | lesscars runs with baseline funding |
| `scenario.bytes.file` | 2,106,140 | 2,106,141 | the embedded `datasetVersion` string only |
| `policy.bytes.file` | 436,841 | 436,839 | the embedded `datasetVersion` string only |

For `parcels.bin`, decoded and compared field by field, `datasetVersion` is the only difference.

| Criterion | Result | Numbers |
| --- | --- | --- |
| finance-data AC 20: every pool entry of live `baselineFunding.provenance` is tier 2; each City entry names Recorded (tier 1) then Inferred (tier 2); no entry is tier 1 | PASS | Entries 0–7 (the 8 pools) are all tier 2. City entries 0–5 each contain `Recorded (tier 1): ` before `Inferred (tier 2): `. The ninth entry (MOHCD income mix and `minHomes`) is tier 0. No entry is tier 1. |
| finance-data AC 21: the federal entry lists the three allocation records after Exhibit F; `n`/`window` describe them; the method states the limit; no text rests on an unlisted source | PASS | Sources are BLA Exhibit F, then the CDLAC 2026 Exhibit A (2026-09-14), the CTCAC 2026 credit estimates (2026-09-02) and the CTCAC 2026 R1 9% recommendations (2026-06-22). `n` 3, window [2026-01-01, 2026-09-14]. The method has a "Limits: …" passage, ending "…could meet the bond ceiling, and the simulation does not show that". No method contains "digest", "rests on" or "not listed". |
| finance-data AC 22: `pools`, `programmes`, `check` unchanged against `2026-11-10-3532a348`; the only `baselineFunding` differences are in `provenance` | PASS | A key-by-key compare of the whole `calibration.json` shows that `baselineFunding.provenance` is the only differing key. `pools`, `programmes`, `check`, `market`, `affordableRoutes` and every other top-level key are identical, and the key order is unchanged. Every pool, programme, share and check value equals Release 1's (check: implied 780, observed 980, 45 MOHCD rows). |
| finance-data AC 23: in fixture-0 the amendment changes only the method text and pool sources, and federal `n` 2→1 and window → [2026-01-01, 2026-01-01]; every entry stays tier 4 | PASS | See `r2-golden-diff.md`: only the six City methods and the federal entry's method, sources (1→2), `n` and `window` changed. |
| market-baseline amendment of 2026-11-10: an unparseable `market.json` fails with a `CalibrationError` naming the file; no dataset value changes | PASS | `pipeline/test/fzp-cal/calibration-step.test.ts` passes in `test:pipeline`. Live `market` is byte-for-byte equal to Release 1's (`today.all` −0.64196, `today.private` −0.714281, observed 129/120, implied 245.126). |
| finance-engine AC 15 (live): `marketLevel` is `'private'` when the calibration has `market` and `baselineFunding`; `buildSimInput` follows 4.14 | PASS | On the live build, `marketLevel` is `'private'`. `buildSimInput` gives `market` [{from: asOf, logOdds −0.714281}] and `finance` present, with no warnings. |
| finance-engine AC 20: bench cases pass on an idle machine (F18) | see Performance | See the Performance section. |
| finance-engine AC 22: `/lesscars` and fixture goldens regenerated only by `fixture --update-golden` on the release branch; `plan.json` unchanged | PASS | Regenerated once (b1ce401d), and `plan.json` is unchanged. `sites.json` is also unchanged, although the spec listed it as "expected to change": the freed sites come from the carve, not the runs. |
| finance-engine AC 23: a seed-1 run of regenerated fixture-0 makes at least one funded start | PASS | `pipeline/test/fixture-funding.test.ts` passes ("runs with finance and funds at least one start on seed 1"). |
| funding-ui AC 15 (live): the page reads the level from `marketLevel`; Release 2 shows the private form | PASS (live input) | The live calibration gives `'private'`, so `fzp-market` and `src-market` take the private form. The e2e covers the copy on fixture-0 (`sim-funding.spec.ts`, `fzp.spec.ts` pass). |
| finance-data AC 1 / byTier carry-over (sanity) | PASS | `projects.json` count and V22 are unchanged: byTier sums to 8,723 (veryLow 2,203, low 1,352, moderate 559, aboveModerate 4,609, unrecorded 0). |
| `calibration.json` ≤ 256 KB | PASS | 112,720 B (V25) |
| Replay bar (ruling R23) | PASS under R23 (known failure, identical) | See the Replay section. |

## Replay (ruling R23)

The live block of `pipeline/test/simulate-replay.test.ts` was run with `SFH_REPLAY_PIPELINE_DIR=<wt>/pipeline SFH_REPLAY_VERSION=2026-11-10-fdc69172`.

**One cohort fails: pooled permitIssued** (n 1,225, 94 months, max |Δ| 0.0354 against a bar of 0.0362). 11 cells fail, all "advance by month m", with the simulated value low:

| Month | Simulated | Observed | \|Δ\| | Bar | Over by |
| --- | --- | --- | --- | --- | --- |
| 11 | 0.6887 | 0.7233 | 0.0345 | 0.0337 | 0.0008 |
| 12 | 0.7094 | 0.7429 | 0.0335 | 0.0321 | 0.0014 |
| 13 | 0.7211 | 0.7554 | 0.0343 | 0.0315 | 0.0028 |
| 14 | 0.7339 | 0.7688 | 0.0349 | 0.0300 | 0.0049 |
| 15 | 0.7449 | 0.7796 | 0.0347 | 0.0300 | 0.0047 |
| 16 | 0.7596 | 0.7922 | 0.0326 | 0.0300 | 0.0026 |
| 17 | 0.7688 | 0.8004 | 0.0315 | 0.0300 | 0.0015 |
| 18 | 0.7763 | 0.8076 | 0.0313 | 0.0300 | 0.0013 |
| 19 | 0.7854 | 0.8168 | 0.0313 | 0.0300 | 0.0013 |
| 20 | 0.7940 | 0.8250 | 0.0310 | 0.0300 | 0.0010 |
| 21 | 0.8005 | 0.8314 | 0.0309 | 0.0300 | 0.0009 |

Every other cohort is OK. Streamlined entitled is too thin (max at-risk 13): it is reported, not compared.

**Comparison.** I ran the same test, from the same worktree code, against Release 1's build (`.claude/worktrees/sim-financing-r1/pipeline`, `2026-11-10-3532a348`). Every cohort line and all 11 failing cells are **identical**, to 4 decimals. This also matches what PR #99 reports for main: "pooled permitIssued, months 11–21, up to 0.0049 over the limit".

The paired-draw dataset `2026-11-10-b6205143` has no derived cache locally (`project-histories.json` is build-internal and never uploaded), so the replay could not be run on it directly. The replay reads only the histories and `calibration.json` timing tables, and Release 2's tables equal Release 1's.

**Verdict:** the failure is identical to the known one and no worse, so Release 2 may ship under R23. One correction to the brief's description: the failing months are 11–21, not 12–22, and the simulated value is about 0.031–0.035 low against a bar of 0.030–0.034.

## /lesscars at 2068

101 seeds in each dataset.

| | Release 2 `fdc69172` | Release 1 `3532a348` | Paired-draw `b6205143` (staging) |
| --- | --- | --- | --- |
| extra mean | **+29,241** | +29,349 | +29,372 |
| p10 / p50 / p90 | 28,724 / 29,212 / 29,916 | 28,912 / 29,428 / 29,647 | 29,038 / 29,441 / 29,663 |
| plan / baseline | 119,399 / 90,158 | 94,287 / 64,938 | 94,356 / 64,984 |
| by source: freed / parking / transit-unlocked / other | 22,959 / 5,814 / 57 / **411** | 22,959 / 6,333 / 57 / 0 | 22,959 / 6,358 / 55 / 0 |
| representative seed | 75 | 55 | 39 |
| lowest yearly mean extra; lowest p10 | −0.03; 0 | −0.01; 0 | 0; 0 |

The extra is −108 against Release 1 and −131 against the paired-draw dataset. Both arms build about 25,200 more homes by 2068 on the baseline funding, and the difference between them barely moves.

"other" becomes non-zero (411) for the first time. **The conductor explained this, and it is expected.**
- With the baseline funding, every lot competes for one shared pool treasury and one waiting line (`src/lib/sim/scenario/funded.ts`, the `Treasury` and the line).
- The plan arm's reservations and regimes change which lots apply and when. That moves funded affordable awards onto ordinary lots, which `sourceOfRows` and `sourceOf` (`pipeline/lib/lesscars/runs.ts`) count as other.
- `docs/dev/lesscars.md` now says so, under "Paired runs and attribution" and "Release 2: baseline funding".

## Other live values (for the docs)

- **Funded starts on the live default:** the baseline funding, on the private level, run to 2050-12-31.

  | Seed | Funded starts | Homes | Ledger |
  | --- | --- | --- | --- |
  | 1 | 104 | 19,432 | in 175, commit 832, spend 672 |
  | 2 | 100 | 19,452 | |
  | 3 | 97 | 19,432 | |

  All funded starts are affordable and certain (fully funded). That is about 800 funded affordable homes a year, in line with the check's implied 780 a year. One `simulateDetailed` call took about 20 ms once warm (110 ms cold).
- **Calibration values unchanged from Release 1:**
  - `affordableRoutes`: tier 0, 53 histories;
  - MOHCD income mix and `minHomes` 70 (45 rows);
  - market `slope` and `crossCheck`;
  - check: implied 780, observed 980, no warning.
- **Federal provenance text (live):**
  - "Of the 15 new-construction awards of 2024–2025, 14 used the 4% credit (1,925 of 1,960 homes)."
  - Bay Area region bond use, round 1: $75.2M of $128.6M.
  - Bay Area region bond use, round 2: $170.1M of $181.9M.
  - 9% SF share: $2,861,626 a year, with $3,437,486 left.

## Performance (F18 and host cases): BALLPARK, busy machine

**These numbers are ballpark, not quiet-machine measurements.**

- **Machine state:** the 1-minute load never went below 2 in 20 minutes of checks (03:55 to 04:14: 2.85 to 7.8). Another worktree's dependency-update vitest runs were using about 150% CPU. The load was 4.40 when `npm run test:perf` started and 13.60 when it ended (04:17).
- **Result:** 11 files; 40 tests passed and 4 failed. No budget or code was changed.

| Case | Measured | Budget | Status |
| --- | --- | --- | --- |
| F18 case 2: `simulateNet` with the bench baseline | median 39.5 ms | ≤ 30 ms | over (busy) |
| F18 case 3: plus `benchFunding()` | median 111.9 ms | ≤ 45 ms | over (busy) |
| finance-score: tierSeries + moneyOf | median 3.3 ms | ≤ 15 ms | ok |
| F18 case 6: fixture check, seed 1 | 61,239 first-day applications, 231 awards, 0 respells | ≥ 10,000, ≥ 100 | ok |
| F18 case 7, reported: plus `state` off | median 193.8 ms (150 awards) | none | reported |
| Host case 4: 101 band pairs, bench funding as levers | 4,878.9 ms (initScenario → revision 0: 13,604.6 ms) | ≤ 9 s | ok |
| Host case 5: longest band/twin macrotask, funded | 192.2 ms (next: 150.9, 149.1, 143.7, 139.6, 138.5; 203 tasks) | ≤ 50 ms | over (and in finance-engine.md's busy run: 165 to 180 ms) |
| Existing: `simulateNet` | 12.1 ms | ≤ 15 ms | ok |
| Existing: simulate + score | 16.2 ms | ≤ 80 ms | ok |
| Existing: initScenario(null) | 1,554.3 ms | ≤ 3 s | ok |
| Existing: shown twin | 12.7 ms | ≤ 200 ms | ok |
| Existing: 101 band pairs | 1,116.8 ms | ≤ 4 s | ok |
| Existing: longest band/twin macrotask | 46.9 ms | ≤ 50 ms | ok |
| Existing: whole-city geometry, longest macrotask | 26.8 ms | ≤ 50 ms | ok |
| Existing: reroll, cold / warm | 296.1 / 64.8 ms | ≤ 3 s | ok |
| Existing: heap growth | 200 MB | ≤ 300 MB | ok |
| Existing: swap reroll, Best ↔ Worst (from main #99) | p50 63.9 ms; longest 46.9 ms | baseline | ok |
| Existing: host commit diff / whole-city load | 16.5 ms / 2,931 ms | ≤ 100 ms / ≤ 5 s | ok |
| Existing: height, plan, generator, transit, declutter benches | all within budget | | ok |
| Existing: client-perf timeline (setTime, pump, lookups, per-frame, declutter) and the C5 generated-controller cases | all within budget | | ok |
| Main #99's `timeline perf (run swap)`: swap install cadence at 30k | p95 387.5 ms (1 frame) | ≤ 50 ms | over. The test is from main's run slider, not this package. #99 calls `SWAP_CELLS_PER_SLICE` provisional and expects about 70–80 ms per swap frame. |

**What needs a quiet machine:**
- **Cases 2, 3 and 5** need a quiet-machine run before the conductor re-sets the F18 budgets, as `docs/dev/finance-engine.md` already says.
- **Case 5** is roughly 4× over its budget even allowing for load. It is the most likely to stay over on a quiet machine: the first funded band tasks on a cold input are the longest. Spec section 4.17's fallback (Q2) applies.
