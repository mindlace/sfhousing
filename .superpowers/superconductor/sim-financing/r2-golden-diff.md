# Release 2 golden and fixture-0 diff (sim-financing)

Branch `superconductor/sim-financing-r2`, worktree `.claude/worktrees/sim-financing-r2`.

- Merge of `origin/main` (233aa269). Main had moved past 7b6e7c3c by one commit: 7f6616d0, "feat(sim): run slider to show the best, worst and any run of the band" (#99). Five conflicts, all of the "both sides added" kind, resolved as a union:
  - `FzpMode.svelte` imports;
  - `FzpMode.svelte.spec.ts`: imports, the funding-card tests, and main's renamed "re-requests on a run switch answer" test;
  - the `scenario-host.ts` header comment: the finance warm-up (0) plus the swap reroll's packing note;
  - `scenario-host.levers.spec.ts`: the funding-levers describe plus main's lever-ranks describe;
  - `docs/dev/fzp-mode.md`: the "Funded by" line plus main's "Map side of a switch" bullet and its "run switch" card-refresh wording.

  `npm run check` passed with 0 errors, and the scenario-host, FzpMode and RunSlider specs passed (311 tests).
- Golden commit: b1ce401d, `test(pipeline): regenerate the fixture goldens for sim-financing Release 2`.

## Commands, run once

1. `env -C <wt> node_modules/.bin/tsx src/lib/sim/scenario/fixtures/build-golden.ts` wrote `golden-seed1.json` (37 schedules). It is **byte-identical**.
2. `env -C <wt> node_modules/.bin/tsx scripts/model-golden.ts` wrote `model-golden.json`. It is **byte-identical**.
3. `env -C <wt> node_modules/.bin/tsx src/lib/sim/scenario/fixtures/build-finance-golden.ts` wrote `golden-finance-seed1.json`. It is **byte-identical**:
   - seed 1: 53 schedules, 30 funded, ledger in 26 / commit 60 / spend 60;
   - seed 4: 66 schedules, 41 funded, ledger in 26 / commit 78 / spend 74 / release 4;
   - respells 0.

   The file is new on this branch (a9521cc8), and finance-engine already wrote it with purposes 7 and 10 in place. The regeneration confirms that it matches the final engine, so finance-engine's draws give no diff at release time.
4. `npm run pipeline -- fixture --update-golden` writes `pipeline/test/fixtures/mini/golden/` and `e2e/fixtures/data/fixture-0/`. V1 to V36 were all OK, with V17's usual fixture warning.

**Unchanged:**
- lesscars `plan.json` (finance-engine flagged it as unverified; it is unchanged) and `sites.json`. finance-engine's spec said `sites.json` was "expected to change", but the freed sites come from the carve, not the runs, so no change is consistent;
- `projects.json`, `manifest.json`, `project-histories.json`;
- the parcels, policy and gross decoded goldens, chunks, tiles, neighborhoods and transit.

## Files that changed (9)

The fixture-0 copies of `report.json`, `calibration.json` and `summary.json` are byte-identical to their golden counterparts.

| File | What changed | Cause |
| --- | --- | --- |
| `scenarios/fzp/calibration.json` (golden + fixture-0) | Only `baselineFunding.provenance` changed. For the six City pools ([0]–[5]), `method` is reworded into "Recorded (tier 1): Exhibit E …; Exhibit F … the City pays $300,027 …" and "Inferred (tier 2): … taken to pay in proportion to its FY2024-25 spending …", plus "held level from the first inflow, with no end (an assumption, not a forecast)". For federal ([7]), `method` now states "Of the 2 new-construction awards of 2024–2025, 2 used the 4% credit (50 of 50 homes)" and drops the "uncapped: no ceiling binds … design's evidence digest" sentence; `n` goes from 2 to 1; `sources` goes from 1 entry to 2; `window` goes from [2024-01-01, 2025-12-31] to [2026-01-01, 2026-01-01]. No number, pool, programme, share or check changed. Size 55,437 → 57,060 B. | Item 2a (provenance text, sources, federal n/window) |
| `derived/calibration-report.md` | Header "calibration.json bytes" goes from 55437 to 57060. Nothing else changed. | Item 2a, calibration bytes |
| `report.json` (golden + fixture-0) | `calibration.bytes` goes from 55437 to 57060, and V25's detail byte count changes to match. `lesscars.extra_2068.mean` goes from 287 to 284. `lesscars.bytes.timeline_payload` goes from 4217 to 3603. | Item 2a bytes; lesscars with baseline funding |
| `scenarios/lesscars/summary.json` (golden + fixture-0) | The baseline and plan series both rise from year 1. For example, baseline at year 10 goes from 378.8 to 406.8. Both plateau from about year 15: baseline 425.8, plan 709.8. `extra` is now 0 before the freed-land year and exactly 284 at every percentile after it. Before, the mean was −1.2 / 3.4 early and 287.4 later, and p10 was 278. `bySource.parking` goes from −1.2 / 3.4 to 0. `representativeSeed` goes from 4 to 3. | The lesscars runs carry the baseline funding at the private-starts level (6292061d, through `src/lib/sim/scenario/input.ts`). Funded affordable starts add homes to both runs, and the mini city reaches its capacity in both. The extra is then only the freed land (284), and Release 1's early negative extra (noted there as unexplained) disappears. |
| `scenarios/lesscars/timeline.decoded.json` (golden) and `timeline.bin` (fixture-0, 1382 → 1230 B) | The representative run's builds now follow the funded runs (seed 3). The payload is smaller. | Same cause as `summary.json` |

Not visible in the fixture goldens:
- **finance-score's tiers**: tiers are computed at run time and posted in `TimelineScore`, and no pipeline file carries them. They are covered by unit and e2e tests.
- **finance-engine's purposes 7 and 10**: already in the finance golden, which is unchanged.

## Verdict

Every change traces to a known cause: item 2a's provenance and bytes, and the lesscars runs carrying baseline funding. No change has an unknown cause, and `plan.json` is unchanged.

## Knock-on: one unit test

`src/lib/lesscars/summary-view.spec.ts:106`, "extraChartModel reaches below zero only when a value does", fails after the regeneration.

- **Why:** the test asserts that fixture-0's lesscars `extra` has a negative mean or p10 value. The regenerated fixture no longer has one: `extra` is 0, then 284.
- **Cause:** the lesscars runs carry the baseline funding.
- **Scope:** this is the only `test:unit` failure (5,854 pass and 1 fails).
- **Status:** the test is not edited. The question is with main.

**Resolution (the conductor's ruling).** In 212f6e4d the assertion now checks the converse on fixture-0: it has no negative mean or p10, and `yMin` is 0. The synthetic negative case stays. `test:unit` now passes 5,855 of 5,855 at 30b04b0e.
