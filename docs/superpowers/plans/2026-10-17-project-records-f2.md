# project-records wave F2 (reappraisal 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring project-records to the reappraisal-1 spec. That means its T14 rules with record-level `quality`, DQ-2 linking of no-date pipeline rows, the capacity rule, shared-parcel existing units, DA netting, DQ-3 score-only masters, and the `onInvalid` validator. The T3/T4d type edits are part of this wave.

**Architecture:** The modules in `pipeline/project-records/` already exist and keep their shape. Each project carries a set of rule ids while it is assessed, and those ids become T3/T4d `quality`. `deriveProjects` records every `pr.*` rule through T14's `recordQuality` into a caller-supplied `counts` object, and the build passes its single shared `counts` into that call.

**Tech Stack:** TypeScript, Vitest (the `pipeline` and `server` projects), DuckDB.

**Spec:** `docs/superpowers/specs/2026-10-16-project-records-design.md`, the reappraisal-1 text, folded at commit `docs(spec): fold project-records doc debt…`. Design: `/Users/mindlace/Projects/sfhousing/.claude/worktrees/fzp-timelapse/docs/superpowers/design/2026-10-16-1903-fzp-timelapse.md` §"Reappraisal 1". The spec is binding; every task cites its sections.

## Global Constraints

- Data quality: every pipeline rule that nulls, replaces, defaults or drops a source value is a registered T14 rule with a tier, a label and counts in every build. A changed record carries the rule's id in `quality`. A value a rule wrote is never presented as a record.
- T14 API: use only `pipeline/lib/quality.ts` (`recordQuality`, `qualityRule`, `QUALITY_RULES`, `MIN_GROSS_M2_PER_UNIT`). Never edit `quality.ts`, `sd.ts` or `sc.ts`. `recordQuality` is the only writer of `quality.*` keys. It throws when a rule is recorded twice against one `counts` object and keys rows by object, so record on the build's single `counts` object and never on a local object that is merged in later.
- Every `pr.*` rule reports in every build, zeros included, with `sample` set to the sorted ids of the affected records.
- The step-0 type edits to `src/lib/timelapse/projects.ts` and `types.ts` are authorised for this wave and no other. `parseProjectsFile` stays worker-safe and zod-free (A4).
- Determinism: the same lock and code give byte-identical outputs; iteration runs over sorted keys; masters are netted and phased in id order.
- `OPEN_DAY` is compared through its export, never as a literal (A1).
- Conventions: Conventional Commits; 2-space indent, single quotes, no trailing commas, 100 columns; every test calls `expect`.
- Commands: never chain `cd` with another command. Use `git -C <wt>` and `npm --prefix <wt> run test:pipeline -- <files>`, `npm --prefix <wt> run test:unit -- <files>`, `npm --prefix <wt> run check`, `npm --prefix <wt> run pipeline -- <cmd>`. No bare `git stash`. Playwright, if it is ever run, uses `SFH_E2E_PORT=4203`.
- Never write to `fzp-integration` or `fzp-timelapse/.superpowers/superconductor`. No R2 or Cloudflare changes. No signoff. No merge into integration.

## Review Focus

1. **Double recording.** The determinism rerun of `deriveProjects` must not record into the build's `counts`, or `recordQuality` throws. Pinned in Task F2-2 (`projects-step.test.ts`, "rerun uses a fresh counts").
2. **Score-only masters reaching consumers.** An empty `parcelIds` must pass `parseProjectsFile` only when `multiPhase` is true and `phases` is null; every other project with empty `parcelIds` fails. Pinned in Task F2-1.
3. **One project netting two masters.** A project nets only the first master in id order. Pinned in Task F2-6.
4. **A DQ-2 row on a project that already holds a pipeline row.** The row is dropped and both rows are named in the warning, not merged. Pinned in Task F2-4.
5. **Generic labels.** No `pr.*` label names a record (no permit number, `PRJ`, `PRX` or block-lot pattern). Pinned in Task F2-2.

---

### Task F2-1: T3/T4d type edits and the `onInvalid` validator (spec §4.9 "Delivery order" 1, "`parseProjectsFile` with `onInvalid`", V20; T3 row)

**Files:** Modify `src/lib/timelapse/projects.ts` and `src/lib/timelapse/types.ts`. Test in `src/lib/timelapse/projects.test.ts` (server project). Update the pipeline assembly (`pipeline/project-records/assemble.ts` and `derive.ts`) so that it emits `quality: []` on every T3 project and T4d history, and `qualityRules: []`. Regenerate the goldens.

**Interfaces (produces):**
```ts
// projects.ts
interface InFlightProject { /* …existing… */ quality: string[] } // key order: after sources
type ProjectsFile = { schema: 1; asOf: Day; rhnaCompletedNet: …; qualityRules: QualityRuleRef[]; projects: InFlightProject[] };
export interface QualityRuleRef { id: string; label: string; tier: 2 | 3 | 4; valueTier: 0 | 1 | 2 | 3 | 4 | null }
export function parseProjectsFile(json: unknown, opts?: { asOf?: Day; parcelIds?: ReadonlySet<ParcelId>;
  onInvalid?: (path: string, message: string) => void }): ProjectsFile;
// types.ts
interface ProjectHistory { /* …existing… */ quality: string[] } // after sources; existingUnits comment per T4d row
```
These are exactly the spec's §4.9 semantics:
- **File-level checks** (always throw): `schema`, `asOf`, `rhnaCompletedNet`, `projects` is an array, and `qualityRules`. The `qualityRules` checks are shape, sorted by id, unique, `label` non-empty, `tier` in {2, 3, 4}, `valueTier` in 0..4 or null, and every listed id used by at least one project of the input array.
- **Project-level checks:** everything about one element. A duplicate id makes the later element invalid. `quality` must be a sorted, unique string array whose ids are all in `qualityRules`. `parcelIds` may be `[]` only when `multiPhase` is true and `phases` is null.
- **With `onInvalid`:** each invalid project is reported once, with its first violation, and left out. The function returns a shallow copy of the file; the input is not mutated.
- The serialiser key order follows T3: `quality` comes after `sources` on a project, and `qualityRules` comes after `rhnaCompletedNet` in the file.

- [ ] **Step 1: write the failing tests.** Every bullet in spec §6 `src/lib/timelapse/projects.test.ts`:
  - without `onInvalid`, the first violation throws;
  - with `onInvalid`, one invalid project is reported once with its path and left out, the rest are returned, and the input is not mutated;
  - a file-level violation (bad `schema`, unsorted `qualityRules`, a listed rule that no project uses) still throws;
  - for a duplicate id, the later element is the invalid one;
  - a `quality` array that is unsorted, duplicated, or names an id absent from `qualityRules` is invalid;
  - a score-only master passes; empty `parcelIds` on any other project fails.
  Update existing tests whose fixtures lack the new fields.
- [ ] **Step 2:** Run `npm --prefix <wt> run test:unit -- src/lib/timelapse/projects.test.ts`. It must FAIL.
- [ ] **Step 3:** Implement the change. Then emit `quality: []` and `qualityRules: []` from the pipeline, regenerate the fixture (`npm --prefix <wt> run pipeline -- fixture --update-golden`), and confirm that the only golden change is the added fields.
- [ ] **Step 4:** Run the whole pipeline project, the server unit test above, and `npm --prefix <wt> run check`. All must PASS.
- [ ] **Step 5:** Commit: `feat(timelapse): quality fields and onInvalid in the projects validator`.

### Task F2-2: Register the `pr.*` rules, record them, attribute them to records, emit `qualityRules` (spec §4.11, §4.1 valid-range, §4.5 forward-clamp, §4.7 records-win, §4.8 stories parse-range; V23 quality checks)

**Files:**
- `pipeline/lib/quality-rules/pr.ts`: all ten entries, exactly as in the §4.11 table, with owner `project-records` and maskBit null. A comment at each share override gives its reason. Labels are verbatim.
- `pipeline/project-records/{parse,stages,inflight,derive,assemble,invariants}.ts` and `pipeline/steps/projects.ts`.
- `pipeline/steps/build.ts`: pass the build's single `counts` into the project-records step, and stop merging `projects.counts`.
- Test: `pipeline/test/project-records/quality.test.ts`. Also update the existing tests.

**Interfaces:**
- `deriveProjects(input: ProjectRecordsInput, opts?: { counts?: Record<string, number> }): DeriveResult`.
  - It records every `pr.*` rule through `recordQuality(opts.counts ?? {}, …)` exactly once.
  - It also writes its own non-quality counts into the same object.
  - `DeriveResult.counts` is that object.
- `writeProjectRecords({ …, counts })`:
  - The first run gets the build's `counts`.
  - The determinism rerun gets a fresh `{}`.
  - It returns no `counts` of its own. build.ts reads the counts from the shared object.
- Attribution. Every assessed project carries `quality: Set<string>`.
  - T3 `quality` is the sorted set.
  - T4d `quality` is the same set without `pr.parcels.shared-existing` and `pr.multiphase.da-netting`.
  - `qualityRules` has one entry for each id used in T3, copied from `qualityRule(id)` (`id`, `label`, `tier`, `valueTier`) and sorted by id.

Rules recorded in this task, with the semantics in spec §4.11's `of` column and on-records text:
- **`pr.date.valid-range`** (§4.1).
  - `of` = non-empty date values parsed; `fired` = values clipped.
  - `parseAll` marks each parsed record that had a clipped date. A project holding such a record carries the id.
  - `sample` = the affected source record ids.
- **`pr.stories.parse-range`** (§4.8).
  - `of` = stories values parsed from text; `fired` = values outside 1..80 that were discarded.
  - The project whose value was discarded carries the id.
- **`pr.stages.forward-clamp`** (§4.5).
  - `fired` = histories with at least one clamped stage; `of` = `histories.total`.
  - The clamped history and its T3 project carry the id.
  - Remove the `histories.clamped.*` keys.
- **`pr.pipeline.records-win`** (§4.7, observe).
  - A conflict is one of: a population project matching a pipeline row whose history ends `complete` or `exit`; or a project whose last entered stage differs from the row's `current_status` stage.
  - `fired` = conflicting projects; `of` = population projects matching at least one pipeline row.
  - No record carries this id. Remove `projects.pipelineConflicts`.
- **`pr.pipeline.no-status-date`.** Keep today's behaviour, which drops a no-date pipeline-only row; Task F2-4 changes it.
  - `fired` = dropped rows; `of` = pipeline rows.
  - `units` = Σ `newUnits` of the dropped rows; `unitsOf` = Σ `newUnits` of all rows.
- **The other five** (`pr.units.capacity`, `pr.pipeline.status-date-linked`, `pr.parcels.shared-existing`, `pr.multiphase.score-only`, `pr.multiphase.da-netting`) record `fired: 0` with their correct denominators (`of`, and `unitsOf` where unit-weighted) until their tasks land. Each of those tasks replaces its zero.
- **V23:** `quality` is sorted and unique. Every id is a `project-records` entry of `QUALITY_RULES`, and neither `pr.parcels.shared-existing` nor `pr.multiphase.da-netting`.
- **V20 pipeline side:** each `qualityRules` entry equals its `QUALITY_RULES` entry and has owner `project-records`.

- [ ] **Step 1: write the failing tests** (`quality.test.ts`, spec §6):
  - Registry: every `pr.*` id named in the spec has an entry whose fields match the §4.11 table; no other `pr.*` entry exists; labels are generic (no `/\d{6,}|PRJ|PRX|\b\d{4}[A-Z]?\d{3}[A-Z]?\b/`).
  - `deriveProjects` records every `pr.*` rule once, zeros included, with `sample` sorted, and writes no `quality.*` key directly. Spy on, or wrap, `recordQuality`.
  - `report.json` has no `histories.clamped.*` and no `projects.pipelineConflicts`.
  - Attribution tests:
    - a clipped 1909 date gives the project `pr.date.valid-range`;
    - a forward clamp gives `pr.stages.forward-clamp` on both the history and the T3 project;
    - a discarded parsed story count of 120 gives `pr.stories.parse-range`;
    - records-win counts a stage-mismatch conflict.
  - `projects-step.test.ts`, "rerun uses a fresh counts": the build's `counts` holds each `quality.pr.*` key exactly once.
- [ ] **Step 2:** The tests must FAIL. **Step 3:** Implement. **Step 4:** Regenerate the goldens. Run the whole pipeline project, which must PASS. Fixture V30 must pass as well: every rule reports.
- [ ] **Step 5:** Commit: `feat(project-records): register pr.* T14 rules and carry quality on records`.

### Task F2-3: `pr.units.capacity` (spec §4.8 "Capacity", §4.9 permits `proposed_units`, §4.10.2 medians)

**Files:** `pipeline/project-records/inflight.ts` (or a new `capacity.ts`), `derive.ts`, `assemble.ts`. Tests go in `inflight.test.ts`.

**Behaviour:**
- A permit's units are missing everywhere when all three conditions hold:
  - `number_of_proposed_stories` is non-null;
  - the project has at least one parcel;
  - `proposedUnits > Σ areaM2(project parcelIds) × max(stories, 1) / MIN_GROSS_M2_PER_UNIT`.
- "Everywhere" covers units rule 1 (which falls through to rule 2), `unitsAt.permitFiled`, the §4.10.2 u medians, and `permits.parquet` `proposed_units` (null).
- The project carries the id in T3 and T4d.
- Tally:
  - `of` = permits with recorded stories and units on a project with parcels; `fired` = failing permits;
  - `units` = Σ failing `proposedUnits`; `unitsOf` = Σ `proposedUnits` of the `of` permits;
  - `sample` = permit numbers.
- Import `MIN_GROSS_M2_PER_UNIT` from `pipeline/lib/quality.ts`.

- [ ] **Step 1:** Write the failing tests, from the §6 inflight "capacity" bullets:
  - 5,540 units on 3 stories over 300 m² are missing (limit 90), and units fall through to the PRJ;
  - with no recorded stories, there is no check;
  - with no parcels, there is no check;
  - `unitsAt.permitFiled` and the permits row follow;
  - the tally is unit-weighted.
- [ ] **Step 2:** The tests must FAIL. **Step 3:** Implement. **Step 4:** The whole pipeline project must PASS (the goldens should not change; if they do, explain why). **Step 5:** Commit: `feat(project-records): pr.units.capacity`.

### Task F2-4: DQ-2, linking no-date pipeline rows by parcel (spec §4.2 step 10, §4.5 entitled exclusion, §4.7, §4.8 label/units exclusions, §4.3 `excludedNoUnits`)

**Files:** `pipeline/project-records/link.ts` (or a new `nodate.ts`), `derive.ts`, `inflight.ts`, `stages.ts`. Tests go in `link.test.ts`.

**Interfaces:**
- `PipelineRow` gains `linkedNoDate?: true` once linked.
- Linking runs after every project's end has been computed, because candidates are projects whose §4.6 end is `open` without the row.
- **Candidates and pick:**
  - Candidates are anchor PRJs whose own blklot, or a child's blklot, resolves to a parcel that the row's blklot resolves to.
  - The latest `openDay` wins; ties go to the smallest `recordId`.
- **Join:** the row is appended to the winner's `pipelineRows` with `linkedNoDate`. It then contributes only:
  - its source;
  - the pipeline match (the project is not stale).
  It contributes no dates, no `approvedDay`, no label (`nameaddr`) and no units: the units rule stops at rule 2.
- **Dropped:** the row is dropped under `pr.pipeline.no-status-date` when:
  - there is no candidate; or
  - the winner already holds a pipeline row. The warning names both rows.
- **No units:** a winner with no units from rules 1–2, or outside the population, is not in flight.
  - Its row's `newUnits` goes to `projects.excludedNoUnits`, not to `excludedAlterationUnits`.
  - The warning is `'<caseNo>: linked to <recordId> with no units; excluded'`.
- A PRX row linked this way is not a master, and its `multiphase.json` entry produces the "entry unused" warning.
- **Tallies:**
  - `pr.pipeline.status-date-linked`: `fired` = linked rows, including those whose project has no units; units are their `newUnits`.
  - `pr.pipeline.no-status-date`: `fired` = dropped rows.
  - Both use `of` = pipeline rows and `unitsOf` = Σ `newUnits` of all rows.
- Every project holding a linked row carries `pr.pipeline.status-date-linked` in T3 and T4d.

- [ ] **Step 1:** Write the failing tests. These are the §6 link "DQ-2" bullets plus a derive-level test for the Freedom West shape:
  - a PRJ opened 2020-07-24 with 2,387 units → in flight as `PRJ:…` at `filed` 2020-07-24 with 2,387 units, and the row's 2,537 units are ignored.
- [ ] **Step 2:** The tests must FAIL. **Step 3:** Implement. **Step 4:** The whole pipeline project must PASS. **Step 5:** Commit: `feat(project-records): DQ-2 links no-date pipeline rows to the Planning record on the lot`.

### Task F2-5: Shared-parcel existing units (spec §4.8 `existingUnits`, `pr.parcels.shared-existing`)

**Files:** `pipeline/project-records/assemble.ts` (or a new `shared.ts`), `derive.ts`. Tests go in `inflight.test.ts`.

**Behaviour:**
- Apply this once, after the in-flight set, DA netting and phasing are final. Until Task F2-6 lands, run it after phasing.
- The holder of each parcel is the in-flight project on it with the earliest first `history` day; ties go to the smallest id.
- A non-holder gets 0 from that parcel.
- Every project on a parcel that has two or more in-flight projects and assessor units > 0 carries the id. The holder carries it too.
- Score-only masters have no parcels and are not involved.
- The in-flight net test keeps the unallocated value. Histories are unchanged and never carry the id.
- Tally: `of` = in-flight projects; `fired` = projects carrying the id; `sample` = their ids.

- [ ] **Step 1:** Write the failing tests (the §6 "shared parcels" bullets). **Step 2:** They must FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit: `feat(project-records): count shared-parcel existing homes once`.

### Task F2-6: DA netting, DQ-3 last resort and score-only, V24/V21/V20 extensions (spec §4.10.2, §4.10.3, §4.7 has-units/has-parcels, V20, V21, V24)

**Files:** `pipeline/project-records/multiphase.ts`, `assemble.ts`, `derive.ts`, `invariants.ts`. Tests go in `multiphase.test.ts` and `invariants.test.ts`.

**Behaviour:**
- **Netting** runs before phasing, master by master in id order.
  - A master's netting projects are in-flight non-master projects that match no pipeline row, have a parcel among the master's DA parcels, and have not netted an earlier master.
  - R = max(0, newUnits − Σ their units).
  - Report `multiphase.netted.<caseNo>` for every master.
  - A master with reduction > 0 carries `pr.multiphase.da-netting`, on T3 only.
  - A master with R = 0 is not in flight: count `multiphase.nettedOut` and add a warning.
- **Free DA parcels** = DA parcels minus the parcels of other in-flight projects and of completed histories, where "other in-flight projects" means:
  - non-masters;
  - every other master's tracking parcels and final parcels.
- **Phasing** uses the netted R. The scale check uses R before netting (`multiphase.scale.<caseNo>`).
- **Last resort**, which applies when there is no u, when P = 0, or under L2:
  - With free DA parcels: `parcelIds` = those parcels.
  - With none: score-only, meaning `parcelIds` [], `existingUnits` 0, and `quality` includes `pr.multiphase.score-only`. Count `multiphase.scoreOnly` and add a warning.
- **Phased master** `parcelIds` = the free DA parcels plus the phase parcels (the free tracking parcels when that set is empty).
- **Tallies:**
  - `pr.multiphase.da-netting`: `of` = in-flight masters before netting; `fired` = masters with reduction > 0; `units` = units netted; `unitsOf` = Σ R before netting.
  - `pr.multiphase.score-only`: `of` = in-flight masters after netting; `fired` = score-only masters; `units` = their R; `unitsOf` = Σ R after netting.
- **V24 additions:**
  - a drawing last-resort master's `parcelIds` are disjoint from every other in-flight project's parcels and phase parcels;
  - a score-only master has empty `parcelIds`, and every one of its DA parcels is held;
  - the scale factor is checked on R before netting.
- **V21:** a master contributes its R before netting, whether or not netting took it out of flight. A DQ-2-linked row counts when its project is in the population.
- **V20:** the validator from Task F2-1 already accepts score-only masters.

- [ ] **Step 1:** Write the failing tests: the §6 multiphase "DA netting" and "last resort (DQ-3)" bullets, plus the §6 invariants bullets (V24 fails for a drawing last-resort master on another project's parcel, and for a score-only master with a free DA parcel).
- [ ] **Step 2:** They must FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit: `feat(project-records): DA netting and score-only last-resort masters (DQ-3)`.

### Task F2-7: Fixture M15–M20, goldens, report assertions, docs **[merge scenario-data's F1 sha first]**

**Before starting:** `main` must have sent scenario-data's F1 sha. Merge it (`git -C <wt> merge --no-ff <sha>`, keeping the history) and resolve any conflicts. The relayed changes include lot 3 units of 4 for 2023–2025, lot 4's 2024 value of 3, an `RA1_PANEL_UNITS` overlay in `projects-raw.ts`, and a golden guard in `golden.test.ts`. The whole pipeline project must be green before any new fixture data is added.

**Files:**
- `pipeline/test/fixtures/mini/projects-raw.ts`: M15–M20 records exactly as in the spec §4.9 table, keeping scenario-data's overlay.
- `pipeline/test/fixtures/mini/enrichment/multiphase.json`: entries for `2024-000016PRX`, `2025-000017PRX` and `2012-000020PRX`, each with schedule null and one searched URL.
- `make-fixture.ts` rerun, and regenerated goldens.
- `pipeline/test/project-records/mini.test.ts`: the spec's per-project expectations for M1–M20.
- `pipeline/test/golden.test.ts`: the §6 Golden report-count assertions.
- `pipeline/test/invariants.test.ts`.
- `pipeline/test/project-records/live.test.ts`: Freedom West and Flower Mart expectations, and V30 on `pr.*` rules.
- `docs/dev/pipeline.md`: DQ-2 linking, DA netting, score-only masters, and the quality fields. Regenerate the Data quality section with `npm --prefix <wt> run pipeline -- quality-doc`.

**Expectations:** spec §4.9 fixture table, AC-4 and AC-12. These include:
- the in-flight set M1, M2, M3, M8, M9, M10, M11, M12, M14, M15, M16, M19 and M20;
- M17 and M18 in neither in-flight nor history-only;
- `qualityRules` ids exactly as the spec lists;
- `projects.excludedNoUnits` 900;
- `multiphase.netted.2012-000020PRX` 3;
- lastResort 1 and scoreOnly 1.

If a spec value cannot be reached honestly, report it rather than editing the assertion.

- [ ] **Steps:** RED (mini.test and golden assertions) → records → GREEN → regenerate → full pipeline project, `check` and `lint` → commit `test(project-records): fixture cases M15–M20 and reappraisal-1 goldens`.

### Task F2-8: Live verification (scratchpad only, not committed)

Re-run the live smoke harness from rounds 4–5: locked pages, real lineage, real assessor units and areas, HEAD code. Report:
- V20–V24;
- every `quality.pr.*` fired/of share, flagging WARN and FAIL against each rule's shares;
- the in-flight totals;
- Freedom West and Flower Mart;
- `multiphase.netted.*` > 0;
- the score-only masters;
- `excludedNoUnits`.
