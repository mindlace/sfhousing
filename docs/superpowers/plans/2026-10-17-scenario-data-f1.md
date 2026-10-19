# scenario-data fix round F1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement design Reappraisal 1, wave F1, for scenario-data. That covers the T14 data-quality registry and V30 (first, alone), the registered scenario-data rules, mask bits 3/5/6, the base cap date, the T11 `existingFloorAreaM2` column with `scenarioRecordOf`, the fixture cases and the generated Data-quality doc.

**Architecture:**
- `pipeline/lib/quality.ts` is the single registry and report writer. Owners declare rules in `pipeline/lib/quality-rules/{sd,pr,sc}.ts`.
- SQL rules tally into the `quality_tally`/`quality_sample` DuckDB tables and report through `recordSqlQuality`. TS rules call `recordQuality`.
- `build` creates the tables first and writes `quality-report.md` once, after the last reporting step. `checkDataset` evaluates V30 from `report.json` counts.
- The codec gains one column and the shared scenario-record helpers, which the pipeline then uses.

**Tech Stack:** TypeScript, DuckDB (`@duckdb/node-api`), Vitest (server, client, pipeline), Playwright (run with `SFH_E2E_PORT=4201`).

**Spec:** the REVISED spec at `/Users/mindlace/Projects/sfhousing/.claude/worktrees/fzp-timelapse/docs/superpowers/specs/2026-10-16-scenario-data-design.md`, cited below as "spec §N". The copy inside this worktree is stale; do not read it. Design: `/Users/mindlace/Projects/sfhousing/.claude/worktrees/fzp-timelapse/docs/superpowers/design/2026-10-16-1903-fzp-timelapse.md`, section "Reappraisal 1", plus rows T11, T13 and T14.

## Global Constraints

- The T14 row, the T11 row and the T13 row are verbatim interfaces. Implement them; never change them. Any change beyond spec §2 "Internal types" (which authorises `existingFloorAreaM2`, `scenarioRecordFrom` and `scenarioRecordOf`) is an interface request to the operator.
- No pipeline code nulls, replaces, defaults or drops a source value outside a registered T14 rule. `recordQuality` is the only writer of `quality.*` keys and of `quality-report.md` rows.
- The mask convention for T11/T13 `imputed`:

  | bit | meaning |
  |---|---|
  | 0 | `yearBuilt` |
  | 1 | `existingStories` |
  | 2 | `improvementShare` |
  | 3 | `existingUnits` |
  | 4 | no roll row, implying bits 0–3 and 6, so the no-row mask is 95 |
  | 5 | row carried from the previous year |
  | 6 | `existingFloorAreaM2` (fallback to the chunk record) |
  | 7 | reserved; the decoder rejects it |

- `MIN_GROSS_M2_PER_UNIT = 10` (tier 4). Default shares: `warnShare` 0.01, or 0.05 for `kind: 'missing'`; `failShare` 0.10.
- The base cap and everything derived from it in the panel use `min(lien_day, 2026-01-11)`.
- The T13 contract columns are exactly the spec §4.6 list, with names, order and types unchanged. project-records reads them.
- Evidence hierarchy and AC 11: every numeric parameter carries a tier and source comment.
- Determinism: payload bytes are deterministic, and the goldens compare decoded payloads.
- Code style: 2-space indent, single quotes, no trailing commas, 100 columns. Commits follow Conventional Commits and end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Every test calls `expect`.
- Shell rules:
  - Never compound `cd` with another command; use `git -C` and `npm --prefix`.
  - No bare `git stash`.
  - Never write under `fzp-integration` or `fzp-timelapse/.superpowers/superconductor`.
  - No R2 uploads and no remote Cloudflare.
  - No signoff, no merge.
  - Run Playwright with `SFH_E2E_PORT=4201`.
- NEW live data-quality findings are reported with counts, never patched ad hoc (DQ-4 governs registered rules).
- Regenerate fixture goldens with `npm run pipeline -- fixture --update-golden` whenever outputs change. Commit `pipeline/test/fixtures/mini/golden/` and `e2e/fixtures/data/fixture-0/` together. project-records goldens and assertions on lots 3 and 4 follow this spec ("PR goldens follow SD").

## Review Focus

1. **Rule ordering.** The capacity rule must run before the spike rule. Carried rows must never feed the medians. A wrong order changes values silently (Tasks 3–4).
2. **Double reporting.** A rule recorded twice against one `counts` object, or one that never reports, must fail loudly. The latter is V30 (Task 1).
3. **Units-weighted shares.** The capacity rule's units share can exceed `failShare` on live data even when its row share is low. V30 must evaluate both (Tasks 1, 6).
4. **Floor-area rounding.** The panel, T11 and the worker rebuild must all use the same whole-m² value, or V18 and the rebuild test diverge (Task 2).
5. **Stale counts.** Superseded `scenario.*` keys and the old 10% warning must be gone, so consumers do not read two sources of truth (Task 4).

---

### Task 1: T14 module and V30 (first commit, alone)

**Files:**
- Create: `pipeline/lib/quality.ts`
- Create: `pipeline/lib/quality-rules/sd.ts`, `pipeline/lib/quality-rules/pr.ts`, `pipeline/lib/quality-rules/sc.ts`. All three hold `[]`.
- Create: `pipeline/test/quality.test.ts`
- Modify: `pipeline/steps/check.ts` (V30), `pipeline/config.ts` (`InvariantProfile.qualityShares`: live `true`, fixture `false`)
- Modify: `pipeline/steps/build.ts`. Call `createQualityTables(db)` before the first SQL file. Call `writeQualityReport(<derivedDir>/quality-report.md, datasetVersion, counts)` once, after the last reporting step (today the projects step) and before `checkDataset`.
- Modify: `pipeline/cli.ts`. Add a `quality-doc` command that rewrites the `docs/dev/pipeline.md` section between `<!-- quality:begin -->` and `<!-- quality:end -->` with `qualityDocSection()`.
- Modify: `docs/dev/pipeline.md`. Add the markers and the generated (empty-registry) section. Keep the existing hand-written "Tier-4 data rules" subsection for now; Task 5 replaces it.
- Modify: `pipeline/test/invariants.test.ts` (V30 cases)
- Regenerate goldens. `report.json` gains V30; the counts should be unchanged.

**Interfaces:**
- Produces exactly the API in spec §4.12 "Module" and "Report helper", with every error case in its bullet list:
  - `QualityRule`, `QUALITY_RULES` (sorted by id, validated at module load), `MIN_GROSS_M2_PER_UNIT`;
  - `recordQuality`, `qualityRule`;
  - `createQualityTables` (tables `quality_tally(rule_id, fired, of, units, units_of)` and `quality_sample(rule_id, record_id)`);
  - `recordSqlQuality`, `writeQualityReport`;
  - `checkQuality(counts, { shares })`;
  - `qualityDocSection`.
- project-records builds on this API in wave F2, so its names and signatures are frozen once committed.

- [ ] **Step 1: Failing tests.** `quality.test.ts` gets every bullet of spec §6 "`quality.test.ts` (T14)". The registry-validation and kind-default checks run against crafted rule arrays, through an exported pure `validateRules(rules)` that module load also calls. The grep test asserts that no file under `pipeline/` other than `pipeline/lib/quality.ts` contains a string literal starting `'quality.` or `` `quality. ``. `invariants.test.ts` gets these V30 cases:
  - passes on mini;
  - fails when a registered rule's count is missing (use a one-rule test registry via `checkQuality` directly, since the real registry is empty);
  - fails on an unregistered `quality.*` key in counts;
  - with `qualityShares: true`, fails on a share above `failShare`;
  - warns above `warnShare`.
- [ ] **Step 2: Run** `npm --prefix <wt> run test:pipeline -- pipeline/test/quality.test.ts pipeline/test/invariants.test.ts` and confirm it FAILS.
- [ ] **Step 3: Implement.** `writeQualityReport` output is deterministic markdown: a header with the datasetVersion, then one table row per registered rule (id, label, tier/valueTier, action, fired/of, units/unitsOf, share), then each rule's first 25 sample ids. Report rows live in a `WeakMap<object, Map<id, row>>`. V30's `detail` lists failures and warnings. The fixture detail stays stable.
- [ ] **Step 4: Run** the whole `test:pipeline`, then `lint` and `check`, and confirm PASS. Run `npm --prefix <wt> run pipeline -- quality-doc` and confirm it is idempotent.
- [ ] **Step 5: Commit** `feat(pipeline): add the T14 data-quality registry and V30`. This commit contains nothing else.

### Task 2: `existingFloorAreaM2` column and the shared scenario record

**Files:**
- Modify: `src/lib/data/scenario-codec.ts`. Add the column after `existingUnits` (u32), `scenarioRecordFrom`, `scenarioRecordOf`, and the reserved-bit checks: `flags` bits 5–7 must be 0, and `imputed` bit 7 must be 0. Update the mask comment per spec §2. Import `FTF_M` from `src/lib/generator/constants.ts`.
- Modify: `src/lib/data/fixtures/scenario-tiny.ts`, `src/lib/data/scenario-codec.test.ts`
- Create: `src/lib/data/scenario-record.test.ts`
- Modify: `pipeline/sql/81_scenario_features.sql`. `existing_floor_area_m2` becomes an INTEGER of whole m²: `round(floorAreaM2)` if > 0, else `round(chunk floor area)`. The mask bit for that fallback comes in Task 3.
- Modify: `pipeline/steps/scenario.ts`:
  - delete the private `scenarioRecord`;
  - the panel base yields call `scenarioRecordFrom` with the integer floor area;
  - T11 rows fill `existingUnits`, `existingFloorAreaM2` and `existingStories`, then take `scenarioRecordOf(p, i, rec)` for the yields;
  - the dump and `feature_mismatch` include `existingFloorAreaM2`.
- Modify: `pipeline/steps/check.ts`. If V15–V18 need the new field, wire it in; V18's mismatch includes floor area through the step's count.
- Create: `pipeline/test/scenario-rebuild.test.ts`
- Regenerate goldens (the decoded dump gains `existingFloorAreaM2`).

**Interfaces:**
- Consumes: Task 1 has no dependency here.
- Produces: spec §2 signatures `scenarioRecordFrom(rec, v)` and `scenarioRecordOf(p, i, rec)`, which throws `RangeError` on an id mismatch, and `ScenarioParcels.existingFloorAreaM2: Uint32Array`.

- [ ] **Step 1: Failing tests.**
  - The spec §6 codec additions: `existingFloorAreaM2` round-trips 0, a typical value and 2³²−1; a missing-column error; a set bit 7 in `imputed` throws; a set bit 6 decodes; set bits 5–7 in `flags` throw; the encoder rejects a negative or non-integer floor area.
  - `scenario-record.test.ts` per spec §6.
  - `scenario-rebuild.test.ts`: for every mini parcel, recomputing `yield` and `baseYield` from the decoded file, the chunk record, `scenarioRecordOf` and the caps (`densityCap` at `FZP_EFFECTIVE_DAY − 1` for base, and at `capDay` for non-LP FZP) equals the stored arrays. It also asserts by grep that `pipeline/steps/scenario.ts` contains no `function scenarioRecord`.
- [ ] **Step 2: Run** them and confirm they FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Regenerate goldens.** Then run `test:pipeline`, the server project for `src/lib/data`, the client spec `scenario-codec.svelte.spec.ts`, `lint` and `check`, and confirm PASS.
- [ ] **Step 5: Commit** `feat(scenario): ship existingFloorAreaM2 and the shared scenarioRecordOf`.

### Task 3: SQL-side scenario-data rules, mask bits, base cap date

**Files:**
- Modify: `pipeline/lib/quality-rules/sd.ts`. Register every SQL-side rule from both spec §4.12 tables with the listed fields:
  - `sd.roll.year-built-range`, `sd.roll.stories-max`, `sd.roll.unmatched`, `sd.roll.units-capacity`, `sd.roll.units-spike`, `sd.roll.year-gap`;
  - `sd.roll.units-latest-jump`, `sd.roll.units-large`;
  - `sd.features.year-built-median`, `sd.features.stories-height`, `sd.features.share-median`, `sd.features.median-fallback`;
  - `sd.roll.floor-area-missing`.
- Modify: `pipeline/sources/normalise.ts`. The year range check leaves normalise, so years survive unchanged. Update `pipeline/test/normalise.test.ts` to match.
- Modify: `pipeline/sql/80_scenario.sql`:
  - year-built-range (row level, null) and stories-max (row level, null), each tallied into `quality_tally`/`quality_sample`;
  - the unmatched tally;
  - record per parcel-year whether a stories value was nulled (for bit 1);
  - move the units-spike tables out to 81.
- Modify: `pipeline/sql/81_scenario_features.sql`. Implement spec §4.5 rule order step 3 exactly:
  - stories fallback (`sd.features.stories-height`; bit 1 also set when a row was nulled);
  - `sd.roll.units-capacity` (spec §4.12 "exactly": nearest passing observed year with earlier-first ties, then LUDB from the chunk record if it is ≤ capacity, then `floor(capacity)`; `noncondo_units` capped at the replacement; bit 3; units-weighted tally; sample `<mapblklot>:<year>`);
  - `sd.roll.units-spike` on the post-capacity series;
  - `sd.roll.year-gap` (carried rows per spec §4.12, bit 5, copies `units_replaced`/bit 3);
  - the observation rules;
  - features: medians over observed rows only, the median rules and the fallback, `sd.roll.floor-area-missing` (bit 6).
  - Base cap: `base_density_cap` = the cap at `min(lien_day, 2026-01-11)`. `sc_parcel` drops the panel-path `cap_fzp`, so the panel uses at most two periods. T11's own FZP cap stays in TS.
  - The SQL needs the chunk record's LUDB units and floor area. Add them to `sc_parcel` (`ludb_units`, `rec_floor_area_m2`) from the records in `pipeline/steps/scenario-sql.ts`.
- Modify: `pipeline/steps/scenario-sql.ts` and `pipeline/steps/scenario.ts`. Call `recordSqlQuality(db, 'scenario-data', counts)` after the SQL. Remove the superseded `scenario.roll.stories_implausible` and `scenario.roll.units_implausible` counts.
- Create: `pipeline/test/scenario-quality.test.ts`, with every SQL-side case in spec §6 "`scenario-quality.test.ts`", the base-cap-date 2027 case included.
- Modify: the `scenario-sql.test.ts` assertions affected by the moves.
- Regenerate goldens.

**Interfaces:**
- Consumes: Task 1 (`createQualityTables` tables, `recordSqlQuality`); Task 2 (the integer floor area).
- Produces: the post-rule `sc_features`/`scenario_panel` with the new mask bits and carried rows. T13 contract columns are unchanged.

- [ ] **Step 1: Failing tests** (scenario-quality cases, normalise change).
- [ ] **Step 2: Run** them and confirm they FAIL.
- [ ] **Step 3: Implement.** Every SQL rule writes exactly one `quality_tally` row (fired may be 0) plus its sample rows.
- [ ] **Step 4: Regenerate goldens.** Then run `test:pipeline`, `lint` and `check`, and confirm PASS.
- [ ] **Step 5: Commit** `feat(pipeline): register the scenario-data roll rules (T14) and carry roll-year gaps`.

### Task 4: TS-side rules, the no-row mask, removed counts

**Files:**
- Modify: `pipeline/lib/quality-rules/sd.ts`. Register `sd.roll.no-row`, `sd.zoning.split-code`, `sd.zoning.generic-nc`, `sd.yield.nonmonotone` and `sd.yield.zero-hostable` with the spec §4.12 fields. Observation rules take tier 4. Denominators: zoning rules use hostable parcels; `sd.yield.zero-hostable` uses eligible parcels with `envelopeStories ≥ 1`.
- Modify: `pipeline/steps/scenario.ts`:
  - no-row parcels get `imputed = 95`, with `existingFloorAreaM2 = round(rec.existingFloorAreaM2)`;
  - report each rule through `recordQuality` with samples;
  - remove `density_cap.rule.split[_hostable]`, `density_cap.rule.generic_nc[_hostable]`, `yield.nonmonotone` and `yield.zero_hostable_eligible`, plus the ad hoc 10% warning (keep the unverified-districts warning and `density_cap.rule.unlisted`);
  - add `scenario.imputed.existing_units`, `scenario.imputed.carried` and `scenario.imputed.floor_area`;
  - update the provenance methods per spec §4.5 (units rules, gap carry, no-row defaults, with tiers).
- Modify: `pipeline/test/golden.test.ts` and `pipeline/test/scenario-features.test.ts` (lot 13 mask 95).
- Regenerate goldens.

- [ ] **Step 1: Failing tests.** Golden known answers updated for the lot 13 mask, the new counts and the removed keys. Add assertions that the removed keys are absent from `report.json`.
- [ ] **Step 2: Run** and confirm they FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Regenerate goldens.** Then run `test:pipeline`, `lint` and `check`, and confirm PASS.
- [ ] **Step 5: Commit** `feat(pipeline): register the scenario-data T11 rules and the RA1 no-row mask`.

### Task 5: Fixture cases, project-records goldens, generated Data-quality doc

**Files:**
- Modify: `pipeline/test/fixtures/mini/make-fixture.ts` and `README.md`, then regenerate the raw files and lock. Spec §4.11 cases:
  - roll year 2023 gains rows for lots 3 and 4 only;
  - lot 3 `8711023C` (`H1`, 3 stories) has 5,000 units in 2023 and 2025, and no 2024 row;
  - lot 4 `0026T001A` has 3 units in 2023, 900 in 2024 and 3 in 2025.
- Modify: `pipeline/config.ts`. `FIXTURE_PROFILE.scenarioUnitsRange` is [70, 70]; confirm the value from the build.
- Modify: `pipeline/test/golden.test.ts`.
  - Spec §4.11 known answers: the lot 3 and lot 4 RA1 rows, panel years 2023–2025, `units.total` 70.
  - Every `sd.*` rule has `quality.<id>.fired`/`.of` in `report.json`, with the golden's values.
- Modify: the project-records tests and goldens that read lots 3 and 4. For example, `pipeline/test/project-records/mini.test.ts` expects `8711023C` to change from 0 to 4. Regenerate `projects.json` in the fixture outputs. Change only expectations that follow from the scenario fixture, and list each one in the report.
- Modify: `docs/dev/pipeline.md`. Replace the hand-written "Tier-4 data rules" subsection with the generated section (`npm run pipeline -- quality-doc`). Update the Invariants paragraph with V30 and the Fixture paragraph. Add `docs/dev/pipeline.md` to the chreode rule that triggers `pipeline` (spec §4.7). Update the CLAUDE.md pipeline Commands row with `quality-doc`.
- Add the doc-section test from Task 1 to the run here; it must pass with the full registry.

- [ ] **Step 1: Failing tests** (golden known answers, PR expectation changes).
- [ ] **Step 2: Run** and confirm they FAIL.
- [ ] **Step 3: Implement the fixture.** Run make-fixture, regenerate goldens, and regenerate the doc section.
- [ ] **Step 4: Run** `test:pipeline`, `test:unit`, the e2e `scenario-data.spec.ts` (with `SFH_E2E_PORT=4201`), `lint` and `check`, and confirm PASS.
- [ ] **Step 5: Commit** `test(pipeline): RA1 fixture cases and the generated data-quality doc`.

### Task 6: Live build and T14 measurements

**Files:** none expected. If the lock must change, stop and report.

- [ ] **Step 1: Build.** Run `npm --prefix <wt> run pipeline -- build` (tiles on; the raw cache is present).
- [ ] **Step 2: Report.** From `report.json`, report every `quality.sd.*` count with its row share and units share, V15–V19 and V30 details, `bytes.file` (it must stay ≤ 3.5e6), `units.total` and `timings.scenario`. Also report the first rows of `quality-report.md` for `sd.roll.units-capacity`.
- [ ] **Step 3: Check thresholds.** Do not change thresholds or rules.
  - If any rule is above `failShare` (V30 fails), stop and report.
  - If any rule is above `warnShare`, list it.
  - The capacity rule's live count is spec open concern 3: report it whatever it is.
