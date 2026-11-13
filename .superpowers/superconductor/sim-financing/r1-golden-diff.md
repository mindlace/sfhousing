# Release 1 golden and fixture-0 diff (sim-financing)

Branch `superconductor/sim-financing` at 77f16560 (merge of `origin/main` 5d62260b was a no-op), worktree
`.claude/worktrees/sim-financing-r1`. Command: `npm run pipeline -- fixture --update-golden` (the one documented
command; it writes both `pipeline/test/fixtures/mini/golden/` and `e2e/fixtures/data/fixture-0/`). Every invariant
V1 to V36 passed on the fixture build.

**Unchanged (locks):** `src/lib/sim/scenario/fixtures/golden-seed1.json`, `src/lib/timelapse/fixtures/model-golden.json`,
`mini-projects.ts`, `src/lib/fzp/fixtures/projects.ts`. Also unchanged: parcels/policy/gross decoded goldens, chunks,
tiles, neighborhoods, transit, lesscars `plan.json` and `sites.json`.

## Files that moved (14; the fixture-0 copies are byte-identical to their golden counterparts)

| File (golden, and fixture-0 where it has one) | What changed | Why (spec) |
| --- | --- | --- |
| `scenarios/fzp/calibration.json` | three new keys after `phaseGap`: `market` (`today.all` −0.693147, `today.private` −0.798508, years [2023, 2025], observed {10, 9}, implied 20, crossCheck −1.28933, slope 1.77601 with equal-weights path on 2 binned private starts), `affordableRoutes` (fallback, tier 4, 0 histories), `baselineFunding` (6 City pools + capped `state` + uncapped `federal`, one grant programme each, `minHomes` 2, shares 1,000,000 millionths, `check`). Every pre-existing key byte-identical. 37,750 → 55,437 B | market-baseline §6; finance-data §4.6, AC 10/14 |
| `derived/calibration-report.md` | header byte count; section 8 gains 16 parameter-index rows (market.*, affordableRoutes, baselineFunding.provenance[0..8], check); section 10 gains `sc.funding.ami-undeclared` (1 of 8); new sections 11 (Today's market), 12 (routes, stages and baseline funding), 13 (where publicly funded housing starts) | market-baseline §6; finance-data §4.9 and golden item 2 |
| `derived/project-histories.json` | every history gains `planningProposed` ({units, affordable} or null); nothing else in any of the 38 histories changed | market-baseline (history field) |
| `scenarios/fzp/projects.json` | every project gains `affordableHomes` (all 15 null on the fixture); `rhnaCompletedNet.byTier` {veryLow 0, low 0, moderate 0, aboveModerate 3, unrecorded 1} and the by-tier provenance text; units still 4 | finance-data §4.2, F12 |
| `manifest.json` | one new source entry `datasf-mohcd-pipeline` (DataSF aaxw-2cb8, PDDL-1.0); rest identical | finance-data |
| `report.json` | new counts `calibration.market.*`, `calibration.funding.*`, `calibration.affordable.*`, `calibration.siteChoice.*`; quality rows `pr.affordable.over-units` (0/0), `pr.rhna.tier-unrecorded` (1/1), `sc.funding.ami-undeclared` (1/8); V11/V20/V22/V25 detail text; byte counts; `lesscars.extra_2068.mean` 284 → 287, `lesscars.bytes.timeline_payload` 4034 → 4434; `lockSha256` (the mini `sources.lock.json` gained the MOHCD page on finance-data) | both specs |
| `scenarios/lesscars/summary.json`, `timeline.decoded.json` (fixture-0 `timeline.bin`) | base, plan and baseline runs now carry the market shift: representative seed 3 → 4; `extra.mean` at 2068 284 → 287.4; the seeds now differ (p10 278 at 2068, previously every seed 284) | market-baseline §6 ("the base runs now shift by −0.693147") |

## Not explained by the specs (for review, none blocking)

1. **lesscars `extra` goes negative in early years on the fixture**: `extra.mean` is −1.2 for years 5 to 8 and p10 −6, then 8, before the freed-land jump to ~287. Before the shift every seed was 0 until the jump. This is consistent with paired runs whose random streams no longer align once the base hazard is lower (the plan run differs from the baseline before any freed land opens), but no spec predicts a negative extra. Worth a look by the lesscars owner; the live published plan is where it would matter.
2. **`affordableHomes` is null on all 15 fixture projects**, so the fixture never exercises a non-null or a clamped `affordableHomes` in `projects.json` (only histories carry Planning affordable counts: 6, 1 and 0, on projects that are not in flight). Matches the derivation rule, but it is a coverage gap rather than a diff problem.

Verdict: the diff is exactly the set both specs list, plus the expected byte-count and `lockSha256` knock-ons; the protected engine goldens did not move.
