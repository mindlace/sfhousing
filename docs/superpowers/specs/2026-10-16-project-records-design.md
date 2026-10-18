# project-records: design spec

Status: derived 2026-10-16 from `docs/superpowers/design/2026-10-16-1903-fzp-timelapse.md` (approved), then updated to the design's "Interface reconciliation (2026-10-16, after spec derivation)". Revised 2026-10-17 to the design's Reappraisal 1 (DQ-1..DQ-4, IA-1..IA-28). Slug `project-records`. Data-pipeline subsystem.

## 1. Scope

From the design:

> **`project-records`** (data pipeline). Ingests the tier-0 project datasets (`i98e-djp9`, `d4jk-jw33`, `qvu5-m3a2`, `y673-d69b`, `j67f-aayr`, `xdht-4php`, `6jgi-cpb4`) and links them into one record per project: PRJ ↔ permits via `building_permits`, plus parcel joins. It emits two things:
>   - (a) **historical project histories**, as input to calibration only, kept in the pipeline cache and not shipped;
>   - (b) **`scenarios/fzp/projects.json`**: every project in flight at the snapshot date, with pathway, stage, dated stage history, units, stories where known, parcels, and source ids.
>   It also computes **net units completed since the RHNA period start** up to the snapshot, from completion records (tier 0), cross-checked against the Housing Inventory (tier 1).

**In:**
- `src/lib/timelapse/projects.ts`: the T3 types, the `projects.json` file type and the shared validator `parseProjectsFile` (round 4, N5). Step 0 shipped the file. The reappraisal-1 type edits to it (`quality`, `qualityRules`, `onInvalid`) and to the T4d `ProjectHistory` type in `src/lib/timelapse/types.ts` (`quality`) belong to **this spec's fix round** (wave F2), not to a new step 0 (§4.9).
- Seven new lock sources (§4.1).
- A linker that joins PRJ, child, review-metric, permit, completion and pipeline records into projects (§4.2), including the parcel link for pipeline rows with no status date (DQ-2).
- Population, pathway, stage entry dates, exits, the stale-open rule and `lastObserved` (§4.3–4.7).
- The project-records rules of the T14 data-quality registry, the `quality` field on every T3 project and T4d history, and the `qualityRules` list in `projects.json` (§4.11).
- Shared-parcel existing units (§4.8) and DA netting of master remaining units (§4.10.2).
- The T4d histories file and `permits.parquet`, written to the derived cache.
- `out/<v>/scenarios/fzp/projects.json` (T3), including `rhnaCompletedNet`.
- Invariants V20–V24, the mini fixture records, golden files and report counts.
- The `docs/dev/pipeline.md` update for V20–V24 and the seven new sources (round 2, "Nits adopted"). stage-calibration owns V25–V29; scenario-data owns V30 and the generated "Data quality" section.
- Multi-phase phasing enrichment (round 3), in §4.10:
  - the committed `pipeline/enrichment/multiphase.json`;
  - its curation for every PRX row;
  - the fallback phasing;
  - the last resort, including score-only masters (DQ-3);
  - the T3 `phases` field.

**Out:**
- Transition tables, `ppaShare` and every fitted parameter. Those belong to `stage-calibration`, including the permit-side window (DQ-1) and `calibration.window.preRoll`.
- The T14 module itself (`pipeline/lib/quality.ts`: the `QualityRule` type, `QUALITY_RULES`, `recordQuality`, `quality-report.md`, V30 and the generated doc section). scenario-data ships it; this spec declares its own entries in the per-owner file `pipeline/lib/quality-rules/pr.ts` (T14), which `quality.ts` collects into `QUALITY_RULES`, and reports through `recordQuality` (§4.11).
- The `scenarios` manifest entry, owned by `scenario-data` (T11). Retired-parcel lineage, assessor units, lot areas and base stories, owned by `scenario-data` (T13): this spec consumes them.
- Addenda (`87xy-gk8d`), HCD APR, past pipeline snapshots and MOHCD `aaxw-2cb8`. DA phasing is in scope (§4.10).
- Alteration-only projects (ADUs, conversions, legalizations). They are never `InFlightProject`s (T3: "Projects are new construction only").
- Worker, render and UI code.

## 2. Interfaces

These rows are copied verbatim from the current design. This subsystem owns T3 and T4d. It consumes T1, T2, T4 (`Provenance`), T11 (the `projects` url), T13 and T14, plus I1 and I12 from the source design.

From the composition design (`2026-10-16-1903-fzp-timelapse.md`):

| # | interface | owner → consumers | mark |
|---|---|---|---|
| T1 | `type Day = number` is integer days since 1970-01-01 UTC. All schedule times use it. It is exact in Float32. `MONTH_DAYS = 30.436875` (365.2425 / 12). `monthsIn(enteredDay, day) = floor((day − enteredDay) / MONTH_DAYS)` is the single months-in-stage rule, used by every table index (T4, T12, the bar, the card). `OPEN_DAY = Math.fround(3.0e38)` encodes an open-ended window end (exact in Float32; consumers compare with the exported constant, never a literal: A1). `DYING_DAYS = 270` is the display window of a death (90 days red, then a 180-day fade; tier 4), read by timelapse-render's uniforms and by timelapse-sim's card visibility. These live in `src/lib/timelapse/time.ts` | stage-calibration → all | DC |
| T2 | `type Stage = 'preApplication' \| 'filed' \| 'entitled' \| 'permitFiled' \| 'permitIssued' \| 'construction' \| 'complete'`; `type Pathway = 'discretionary' \| 'streamlined' \| 'permitOnly'`; `type ExitReason = 'withdrawn' \| 'disapproved' \| 'cancelled' \| 'expired'`. `STAGE_ORDER` lists the stages in this order. `preApplication` is optional on every pathway. `permitOnly` projects never enter `filed` or `entitled`. A ghost is visible from the project's first entered stage | stage-calibration → project-records, timelapse-sim, timelapse-render, fzp-mode | MC (stage sequence and exits follow real records), DC (names) |
| T3 | `interface InFlightProject { id: string /* 'PRJ:<record_id>', 'BP:<permit>', 'PRJ:<record_id>:BP:<permit>' for split pipeline rows, 'CASE:<case_no>' for PRX rows, 'PPA:<record_id>' for PPA-only; unique */; label: string \| null /* street address from the records, if any */; parcelIds: ParcelId[] /* current mapblklot, mapped through retired-parcel lineage; [] only for a score-only last-resort master (multiPhase, phases null, quality includes 'pr.multiphase.score-only'): no free DA parcel (DQ-3) */; pathway: Pathway; stage: Stage; history: Partial<Record<Stage, Day>> /* observed entry days */; units: number; existingUnits: number; stories: number \| null; storiesTier: 0 \| 3 \| null /* 0 = recorded field, 3 = parsed from description text */; multiPhase: boolean /* PRX/DA remaining-phase row */; phases: { units: number; parcelIds: ParcelId[]; plannedPermitFiled: Day \| null /* from the DA phasing schedule, if enriched */; source: { label: string; url: string; retrieved: string } \| null }[] \| null /* multi-phase only: null until enriched, then each phase is simulated as its own sub-project */; sources: { dataset: string; id: string; key?: string /* field to query, e.g. 'case_no'; absent = the dataset's record-id field */ }[]; quality: string[] /* sorted T14 rule ids that changed or estimated a value of this project; [] if none */ }`. `existingUnits` counts each parcel's assessor units once across in-flight projects (rule `pr.parcels.shared-existing`). `scenarios/fzp/projects.json` = `{ schema: 1; asOf: Day; rhnaCompletedNet: { units: number /* net units added since `since` up to `asOf`, Housing Inventory definition: completions plus alteration gains, minus demolitions and alteration losses */; since: Day /* 2022-06-30, RHNA projection period start */; provenance: Provenance }; qualityRules: { id: string; label: string /* generic, about the rule, never naming a record */; tier: 2 \| 3 \| 4 /* of the rule */; valueTier: 0 \| 1 \| 2 \| 3 \| 4 \| null /* of the value it writes; null if it writes none */ }[] /* every id used in any project's quality, sorted by id */; projects: InFlightProject[] }`. Projects are new construction only (alterations adding units are out of scope). The shared validator is `parseProjectsFile(json, opts?: { asOf?; parcelIds?; onInvalid?: (path: string, message: string) => void })` in `src/lib/timelapse/projects.ts`: without `onInvalid` it throws at the first violation (V20); with it, an invalid project is reported and left out of the returned file, and a file-level violation still throws | project-records → timelapse-sim, fzp-mode, stage-calibration (`asOf`, pathway mix) | MC (real pipeline is the starting state), DC (shape) |
| T4 | `interface Provenance { tier: 0 \| 1 \| 2 \| 3 \| 4; label: string; sources: { label: string; url: string }[]; method: string; n?: number; window?: [from: string, to: string] }`. `interface Transition { months: number; advance: number[] /* cumulative incidence by month 1..months */; exit: Partial<Record<ExitReason, number[]>>; tail: { advance: number; exit: Partial<Record<ExitReason, number>> } /* constant monthly hazards beyond months */; provenance: Provenance; tailProvenance: Provenance /* tier 2: extrapolation beyond the observed months */ }`. `scenarios/fzp/calibration.json` = `{ schema: 1; asOf: Day; transitions: Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Transition>>>; initiation: InitiationModel; pathwayForNew: Record<Pathway, number> & { provenance: Provenance }; size: SizeModel; revision: RevisionModel; streamlinedForLocalProgram: Provenance /* tier 2: Local Program projects use the streamlined tables */; phaseGap: { days: number[] /* empirical gaps between successive phases' permitFiled */; provenance: Provenance } }`. The calibration also carries `ppaShare: Record<Pathway, number> & { provenance: Provenance }`, the share of new projects that start at `preApplication`. `InitiationModel`, `SizeModel` and `RevisionModel` are rows T4a–c. Everything is plain JSON, so future policy levers can transform it (the T9 seam). **Sampling semantics:** a project entering stage *s* at day *d* draws one uniform. The month of advance or exit comes from the cumulative tables (`advance` + Σ`exit` ≤ 1 at every month), with the tail hazards beyond `months`. An in-flight project already *m* months into *s* draws conditionally on having survived *m* months. Day within the month is uniform | stage-calibration → timelapse-sim, fzp-mode | MC (every parameter carries tier + source), DC (encoding) |
| T4d | `interface ProjectHistory { id: string; pathway: Pathway \| null /* null = unclassifiable: excluded from per-pathway tables, included in pooled ones */; parcelIds: ParcelId[]; entered: Partial<Record<Stage, Day>>; end: { kind: 'complete'; day: Day } \| { kind: 'exit'; stage: Stage; reason: ExitReason; day: Day } \| { kind: 'open'; lastObserved: Day }; unitsAt: Partial<Record<Stage, number>> /* current proposed units from the record that represents each stage: PRJ → 'filed', site/full permit → 'permitFiled', TCO/CFC certified → 'complete'; cross-record, not snapshots (tier 2) */; existingUnits: number /* assessor units at filing: the roll year of the first entered day, clamped to 2007..latest */; storiesProposed: number \| null; baseStoriesAtFiling: number \| null /* current base height proxy, tier 3: no pre-FZP height map exists */; sources: { dataset: string; id: string; key?: string /* field to query, e.g. 'case_no'; absent = the dataset's record-id field */ }[]; quality: string[] /* sorted T14 rule ids that changed or estimated a value of this history; [] if none */ }`. Pipeline-internal file `pipeline/.cache/derived/<datasetVersion>/project-histories.json` = `{ schema: 1; asOf: Day; histories: ProjectHistory[] }`, never shipped. The history population and the in-flight population (T3) come from the same linkage. `entered` days are clamped forward (`pr.stages.forward-clamp`); a consumer that needs a raw filing day reads `permits.parquet`. Pipeline-internal `pipeline/.cache/derived/<datasetVersion>/permits.parquet`: one row per linked type 1/2 permit, columns `permit_number`, `project_id`, `prj_record_id`, `dva_record_id`, `prx_case_no`, `da`, `parcel_ids`, `proposed_units`, `site_permit`, `status`, `live`, `superseded`, `filed_day`, `issued_day`, `construction_day`, `complete_day`, `status_day` (raw valid days, T1, no project-level clamp) | project-records → stage-calibration, timelapse-sim (replay test fixtures) | DC |
| T11 | `scenarios/fzp/parcels.bin` (codec `sfh-scenario/1`, in `src/lib/data/`; deflate inside the file, async decode). It holds **every** parcel: `id`, `labelPoint`, `cellId`, a `hostable` flag (eligible and able to host a new project), `envelope: Envelope` (FZP stories: Local Program height if `localProgram`, else base height; clamped to `MAX_STORIES`), base stories, the base-zoning density cap in units (null = none), `localProgram: boolean`, `existingUnits` (latest assessor roll, post-T14) and `existingFloorAreaM2` (u32, whole m²: the value the yield used), the T4a feature values (base and FZP variants of `potentialRatio` and `storiesGap`) with an imputation mask (`imputed`, a bit set exactly when that field's value is not the source's own value: bit 0 `yearBuilt`, 1 `existingStories`, 2 `improvementShare`, 3 `existingUnits`, 4 no roll row, 5 row carried from the previous roll year, 6 `existingFloorAreaM2` (fallback to the chunk record), 7 reserved; each T14 rule that writes a parcel feature names its bit; rules that write no feature (e.g. zoning caps) have none), `hostable_base` (hostable under the old zoning), `baseYield: Uint16[F]` (gross units at each fill level of the base envelope, density-capped), and `yield: Uint16[F]`, the gross units at each fill level of the envelope, replacement typologies only (no ADU outcomes), with no density cap under the Local Program. `FILL_LEVELS = [0.25, 0.5, 0.75, 0.9, 1]` (F = 5, tier-4 quantisation grid) is owned here, and stage-calibration imports it. Named in the manifest as `scenarios?: { fzp: { parcels: url; projects: url; calibration: url } }` (amends I12 and `ManifestBaseSchema`; optional, so older datasets load). `scenarioRecordOf(p: ScenarioParcels, i: number, rec: ParcelRecord): ParcelRecord` (worker-safe, in the codec module) returns the chunk record with `existingUnits`, `existingFloorAreaM2` and `existingHeightM` (= existing stories × 3.1) replaced from row i. The pipeline's yield and timelapse-sim's simulated massing both use it, so the worker reproduces the building the yield was sized from. Because the yield uses the generator, `src/lib/generator` and `src/lib/timelapse` join the dataset-version hash | scenario-data → timelapse-sim, stage-calibration (`FILL_LEVELS`, `featureValue`, `hostable`), project-records and fzp-mode (manifest `scenarios`) | DC |
| T13 | Pipeline-internal parcel panel `pipeline/.cache/derived/<datasetVersion>/parcel-panel.parquet`. Per parcel × assessor roll year (2007..latest): `mapblklot`, roll year, assessor units, stories, year built, land and improvement value, use code → `landUseClass`, the zoning code (`acdm-wktn`), base stories, the base density cap, and the base-envelope yield (gross units at full base envelope, density-capped), and the T11 `imputed` mask. Every value is post-T14 (rules applied, interior roll-year gaps carried, bit 5). The base cap and everything derived from it are evaluated at `min(lien_day, 2026-01-11)`: base always means the zoning before the FZP. Contract columns (DuckDB table `scenario_panel` in the build): `mapblklot`, `roll_year`, `lien_day`, `existing_units`, `existing_stories`, `year_built`, `land_value`, `improvement_value`, `use_code`, `land_use_class` (INTEGER index into `LAND_USE_CLASSES`), `zoning_code`, `base_stories`, `base_density_cap`, `base_yield`, `lot_area_m2`, `improvement_share`, `rent_control_likely` (BOOLEAN; read as 0/1), `imputed`, `potential_ratio_base`, `stories_gap_base`, `hostable_base`. Never shipped. Retired-parcel lineage is `parcel-lineage.parquet` in the same folder (DuckDB table `parcel_lineage`) | scenario-data → project-records, stage-calibration | DC |
| T14 | Data-quality registry `pipeline/lib/quality.ts` (pipeline-internal). `interface QualityRule { id: string /* '<sd\|pr\|sc>.<area>.<rule>', kebab-case, unique */; owner: 'scenario-data' \| 'project-records' \| 'stage-calibration'; source: string /* lock id, raw table or derived table */; field: string; kind: 'bound' \| 'outlier' \| 'shape' \| 'gap' \| 'missing' \| 'observe'; action: 'null' \| 'replace' \| 'default' \| 'drop' \| 'none'; tier: 2 \| 3 \| 4 /* of the rule's predicate and thresholds */; valueTier: 0 \| 1 \| 2 \| 3 \| 4 \| null /* of a value the rule writes; null unless action is 'replace' or 'default' */; maskBit: number \| null /* T11/T13 imputed bit it sets; scenario-data rules only */; label: string /* plain English, shown to users */; denominator: string; warnShare: number /* default 0.01 */; failShare: number /* default 0.10 */; unitsWeighted: boolean }`. `QUALITY_RULES: readonly QualityRule[]` is the only place a pipeline rule may null, replace, default or drop a source value; observation rules (`action: 'none'`) only count. Each build reports `quality.<id>.fired` and `quality.<id>.of` (plus `.units` and `.unitsOf` when `unitsWeighted`) in `report.json` and writes `pipeline/.cache/derived/<datasetVersion>/quality-report.md` (one row per rule plus the first 25 affected record ids in sort order; never shipped). Invariant V30: every rule reports; on a live build no rule's share exceeds `failShare` (exit 1); a share above `warnShare` warns. `MIN_GROSS_M2_PER_UNIT = 10` (tier 4) is exported here for the capacity rules, with `recordQuality(counts: Record<string, number>, id: string, c: { fired: number; of: number; units?: number; unitsOf?: number; sample?: string[] /* affected record ids; sorted, the first 25 go to quality-report.md */ }): void`, the only writer of `quality.*` report keys and of `quality-report.md` rows (it throws on an unregistered id). Rules are declared in per-owner files `pipeline/lib/quality-rules/{sd,pr,sc}.ts` and collected into `QUALITY_RULES`; rules counted in SQL report through `recordSqlQuality`; every owner records into the build's single `counts` object, and `writeQualityReport` and V30 (`checkQuality`) run once after the last pipeline step. Routine missing-value imputations (`kind: 'missing'`) default to `warnShare` 0.05. T14 rules rewrite **source values**; a model choice that reclassifies or pools records (a pathway rule, a pooling rule, a density-bonus mapping) is not a T14 rule and is stated in its provenance instead | scenario-data → project-records, stage-calibration | DC |

From the source design (`2026-10-10-1749-sf-housing-sim.md`):

| # | interface | owner → consumers | mark |
|---|---|---|---|
| I1 | `type ParcelId = string` — SF `mapblklot` (block+lot, e.g. `"3512008"`), the single join key across all data | data-pipeline → all | DC |
| I12 | Data manifest: `/data/<datasetVersion>/manifest.json` → `{ datasetVersion, builtAt, sources: { id, label?, url, retrievedAt, license }[], chunks: { cellId, bbox, url, parcelCount }[], buildingsTiles: url, basemapTiles: url, glyphs: url /* MapLibre `{fontstack}/{range}.pbf` template */, sprite?: url, neighborhoods: url }`. All `url`s are root-relative (`/data/<v>/…`). Every eligible-or-not parcel appears in **exactly one** chunk. `buildingsTiles` has one source-layer `buildings` with properties `parcelId`, `heightM`, `baseM`, at minzoom ≤ 12, with buildings clipped to parcels. Published versions are immutable and retained indefinitely. `datasetVersion` matches `^(\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\|fixture-\d+)$` (build date + 8-hex input hash) everywhere it is validated. R2 key = `data/<datasetVersion>/<path>`, served at `/data/<datasetVersion>/<path>` | data-pipeline → platform, plan-model, brush-tool (worker host), typology-generator, map-view | DC |

**Internal types** (pipeline-only; they do not alter any row):
- `deriveProjects(input: ProjectRecordsInput): { histories: ProjectHistory[]; file: ProjectsFile; permits: PermitOut[]; counts: Record<string, number>; warnings: string[]; checks: V2xInputs }`. It is pure and deterministic. `ProjectsFile` is the T3 file object. `PermitOut` is one `permits.parquet` row. `checks` carries the V21–V24 inputs.
- `ProjectRecordsInput = { asOf: Day; raw: Record<ProjectSourceId, unknown[]>; parcelIds: Set<ParcelId>; lineage(blklot: string): ParcelId | null; descendants(blklot: string): ParcelId[]; assessorUnits(id: ParcelId, rollYear: number): number | null; latestRollYear: number; baseStories(id: ParcelId, rollYear: number): number | null; areaM2(id: ParcelId): number; hiNet: Record<number, number>; multiphase: MultiphaseFile }`. The callbacks are served from DuckDB tables in the same build (§4.9). `areaM2` and `multiphase` were added during implementation (ruling P1); `areaM2` reads `lot_area_m2`. `descendants` (§4.10.2) was added in wave F2 (main's ruling 3) and reads `src_parcel_attrs`.
- `deriveProjects` reports every project-records rule through T14's `recordQuality(counts, id, { fired, of, units?, unitsOf?, sample })` into its `counts`, zeros included; `sample` is the sorted ids of the affected records (project ids, or source record ids for rules that act before linking). `recordQuality` is the only writer of `quality.*` keys and `quality-report.md` rows (orchestrator ruling on IC-PR2).

## 3. Global constraints

### Global constraints (verbatim from the design)

The source design's constraints still apply (free and open, determinism, overshoot meaningful, honesty of numbers, performance, mobile, static versioned data, conventions). In addition:

- **Evidence hierarchy** (above). No number reaches the simulation without a tier and a source. A tier-3 or tier-4 number is never presented as data.
- **Data quality** (reappraisal 1). Live sources are not assumed clean. Every pipeline rule that nulls, replaces, defaults or drops a source value is a registered T14 rule with a tier, a label and counts in every build. A replaced parcel value sets its `imputed` bit, and a changed record carries the rule's id in `quality`. A value a rule wrote is never presented as a record.
- **Determinism.** The same `datasetVersion` and seed always give the same future, on every machine. The representative seed is chosen deterministically: the run whose final `completedNet` is the median of the N band runs.
- **Honesty of numbers.** The mode is labelled a *simulation*. The scoreboard shows the shown run and the p10–p90 band. Pipeline and new-FZP units are separate lines. Actual completions since the RHNA period start are counted and labelled as actual. Units lost to dead projects are shown.
- **Time scrubbing performance.** At 60 fps on a 2022-era laptop with the whole city's timeline loaded, per-frame JS during scrub or playback is O(1) in project count. A reroll reaches a full new timeline (the shown run, to 2050) within 3 s off the main thread. The p10–p90 band may fill in progressively afterwards; the UI marks it as provisional until it is complete.
- **First paint.** `/fzp` must not require loading every parcel chunk. The whole-city score comes from `parcels.bin`, `projects.json` and `calibration.json`. Geometry streams with the viewport, as on `/`.
- **The editor is unchanged.** `/` and `/p/:id` behave exactly as before. FZP mode is additive. The one intended exception is the shared header, which gains the mode links ("Paint" / "Timelapse") and shortens the brand to "SF Housing" below 640 px so the links fit at 375 px.
- **Map budgets in FZP mode.** Two deck layers per cell are allowed for timeline cells: translucency needs them. This is an exception to map-view's one-layer-per-cell rule, so a `bench:map` timeline scenario must pass the same p95 frame bar. The existing-building catch-up stays within 2,000 feature-state changes per frame.
- **Accessibility.** WCAG 2.2 AA as in `docs/dev/accessibility.md`. The scrubber is a labelled slider: arrow keys step a month, Page Up/Down a year. Reduced motion stops autoplay, but scrubbing still works.

### Evidence hierarchy (partner ruling; global) (verbatim from the design)

Every number the simulation uses comes from the highest tier available. It carries that tier and its source, and the UI can show both.

| tier | kind | example here |
|---|---|---|
| 0 | per-record time series | DBI permit dates, Planning approval dates, TCO/CFC dates |
| 1 | published first-party aggregates | Housing Inventory production tables, quarterly pipeline report |
| 2 | researched inferences from observations | a redevelopment hazard fitted to SF parcel history; resize ratios measured across linked records |
| 3 | research models / literature | NAHB construction durations, statutory review clocks used as duration proxies |
| 4 | made up | anything else, labelled as such |

Consequence: calibration is **computed by the data pipeline from DataSF records**, and literature figures are used only where the records can't answer. The dataset probe found tier-0 coverage for almost every stage. There is no tier-0 figure for deaths before any filing, or for the new Local Program's own durations (it has been in force only since 2026-01-12).

## 4. Behaviour

Every rule in this section that nulls, replaces, defaults or drops a source value, or only counts an observation, is a registered T14 rule. Its id is named where the rule is stated, and §4.11 lists them all. No project-records code rewrites a source value outside a registered rule.

### 4.1 Sources, fetch and lock

Each source is a new `DATASF` entry (`pipeline/sources/datasf.ts:10-50`). The entry gains a field `format: 'geojson' | 'json'`. The four existing entries stay `geojson`. The new entries use `https://data.sf.gov/resource/<id>.json`, and `fetchDatasf` counts rows as the length of the array. Paging is unchanged: `$order=:id`, `$limit=50000`, `$offset=k` until a short page arrives, with one lock file per page named `<lockId>.page-NNN.json` (`datasf.ts:52-97`). `FETCH_IDS` picks the entries up from `Object.keys(DATASF)` (`pipeline/steps/fetch.ts:17-23`). Fields and licences were verified live on 2026-10-16 from `https://data.sf.gov/api/views/<id>.json`.

| lock id | dataset | `$select` | `$where` | licence | rows 2026-10-16 |
|---|---|---|---|---|---|
| `datasf-permits-newcon` | `i98e-djp9` | `permit_number,permit_type,block,lot,street_number,street_name,street_suffix,status,status_date,filed_date,permit_creation_date,issued_date,first_construction_document_date,completed_date,last_permit_activity_date,number_of_proposed_stories,existing_units,proposed_units,site_permit,primary_address_flag` | `permit_type in('1','2')` | PDDL-1.0 | 15,654 rows, 12,858 permits |
| `datasf-planning-projects` | `qvu5-m3a2` | `record_id,record_status,project_address,block,lot,open_date,close_date,building_permits,project_decision,project_decision_date,number_of_units_prop,number_of_units_exist,new_construction,sb35,housing_sustainability_dist,ab2162,description` | none | public-domain | 54,640 |
| `datasf-planning-records` | `y673-d69b` | `record_id,record_type,record_status,block,lot,parent_id,open_date,close_date` | `record_type in('PPA','ENV','CUA','VAR','DNX','ENX','OFA','AHB','PHA','DVA','COA','PTA','MAP','PCA','GPA','CTZ','DRP','DRM')` | public-domain | ≈49,700 (from per-type counts) |
| `datasf-planning-review` | `d4jk-jw33` | `b1_alt_id,start_event_type,start_event_date,end_event_type,end_event_date` | `project_stage='accepted to approved'` | PDDL-1.0 | 16,141 |
| `datasf-unit-completions` | `j67f-aayr` | `building_permit_application,date_issued,document_type,number_of_units_certified` | none | PDDL-1.0 | 2,559 |
| `datasf-housing-production` | `xdht-4php` | `bpa,blocklot,form_no,net_units_completed,first_completion_date` | none | public-domain | 6,157 |
| `datasf-dev-pipeline` | `6jgi-cpb4` | `blklot,nameaddr,current_status,current_status_date,approved_date_planning,case_no,bpa_no,new_pipeline_units,existing_units,proposed_units,completed_new_units,net_pipeline_units,description_planning,da` | none | CC0-1.0 | 1,917 |

Parcel lineage comes from `scenario-data`'s `parcel-lineage.parquet`, which is built from its `datasf-parcel-attrs` source (`acdm-wktn`, active and retired). This spec adds no parcel source.

The new entries need no further change elsewhere:
- `fetch --restore` and `upload` archiving cover them.
- Manifest `sources` and `/attribution` map every lock entry (`pipeline/steps/manifest.ts:30-38`).

A build whose lock lacks one of the seven ids throws `BuildError('lock has no entry for <id>')`.

**Parsing.**
- **Day.** Take the leading `YYYY-MM-DD` of a SODA floating timestamp and compute `Date.UTC(y, m-1, d) / 86400000`, with no time-zone conversion (T1).
- **Valid date** (rule `pr.date.valid-range`). A date is valid only if `1970-01-01 ≤ d ≤ asOf`. Anything else counts as missing. This clips junk such as `completed_date` 1909-06-02 and `j67f` `date_issued` 2205-03-13, both verified live. The rule counts every non-empty date value it clips, and every project holding a record with a clipped date carries the rule id in `quality`.
- **Numbers.** SODA numbers are strings; parse them with `Number()`. A non-finite result is null.
- **`building_permits`** splits on `/[,;\s]+/`.
- **`document_type`** matches case-insensitively, since live data has both `CFc` and `CFC`.

**`asOf`** is the UTC day of the newest `retrievedAt` in the lock. That is the date part of `datasetVersion` (`docs/dev/pipeline.md:45`).

### 4.2 Linking

The graph has four node kinds:
- **R**: PRJ records.
- **P**: new-construction permits. There is one node per `permit_number`, carrying all of that permit's address rows.
- **C**: child records.
- **L**: pipeline rows.

1. **PRJ ↔ permit.** Each `building_permits` entry that is a P node is a candidate edge. A permit named by several PRJs (739 of 4,503 linked permits, live) is **assigned** to the PRJ with the latest `open_date` on or before the permit's filed day. The filed day is `filed_date`, else `permit_creation_date`. If no PRJ opened on or before it, the permit goes to the earliest-opened PRJ. A PRJ that gets an assigned edge is an **anchor**. A PRJ whose permits all went to other PRJs is a **satellite** (typically a modification record). A satellite joins that component but contributes only `sources`.
2. **Children** join their `parent_id` PRJ. Some PPAs have no parent, or a parent absent from `qvu5-m3a2` (124 of 754, live). Such a PPA joins the project that meets both conditions:
   - its parcels contain the PPA's resolved `block`+`lot`;
   - its filing-evidence day (§4.5 `filed` evidence, computed for every pathway; implementation ruling, Task 5) lies in `[PPA open, PPA open + ppaLag]`.

   If several projects qualify, the one with the earliest such day wins. If none does, the PPA is a PPA-only project. `ppaLag` is the nearest-rank 90th percentile of (filed day − PPA open day) over parented PPAs, computed each build. It is tier 2 and its `n` is in the report. The live value was 369 days on 2026-10-16 and 358 days (n = 581) on the 2026-10-17 lock. With n = 0, `ppaLag` = ∞.
3. **`d4jk-jw33`** rows join on `b1_alt_id` = `record_id`. Verified: 14,923 approval rows, 0 duplicates.
4. **Pipeline rows** join by `case_no` (PRJ) and `bpa_no` (permit).
5. **`j67f-aayr`** rows join permits on `building_permit_application`.
6. **A project** is a connected component of the graph from steps 1–4 (union-find).
7. **Each pipeline row is a project.** A component with two or more pipeline rows (8 components, 48 rows live, all DA phases) is split. Each row becomes a project holding the permit its `bpa_no` names, any superseded permits on the same parcels, and a copy of the anchor PRJ's planning records. Any remaining permits form one more project with the anchor PRJ. The split projects share planning dates and pathway.
8. **`id`** (T3 prefixes):
   - `PRJ:<record_id>` when only one project uses the anchor PRJ.
   - `PRJ:<record_id>:BP:<leadPermit>` for a split.
   - `BP:<leadPermit>` when there is no PRJ.
   - `CASE:<case_no>` for a PRX row.
   - `PPA:<record_id>` for a PPA-only project.

   The **lead permit** is picked from the live set by these keys in order: `site_permit='Y'`; most `proposed_units`; earliest filed day; lowest number. Every type 1/2 permit is a site or full permit; addenda live only in `87xy-gk8d`.
9. **Pipeline-only rows.** A row whose `case_no` and `bpa_no` resolve to no fetched record is pipeline-only. There are 22 rows live, mostly `…PRX` multi-phase tracking rows carrying about 40.9k units; Candlestick `2007.0946PRX` alone has 9,637. Such a row with a valid `current_status_date` is in flight when `new_pipeline_units ≥ 1`, with `multiPhase = true` for `…PRX` case numbers. It never becomes a `ProjectHistory`, because it has no dated history. A PRX row whose `bpa_no` names a fetched permit is not pipeline-only: it joins the graph through step 4 as an ordinary project, is not multi-phase, and its `multiphase.json` entry, if any, is unused and named in a build warning (implementation ruling F1; live, 750 Golden Gate and 850 Turk).
10. **Pipeline-only rows with no status date** (DQ-2; rules `pr.pipeline.status-date-linked` and `pr.pipeline.no-status-date`). A pipeline-only row whose `current_status_date` is not valid (§4.1) is linked by parcel to its real Planning record:
    - **Candidates.** The anchor PRJs of graph projects whose own `block`+`lot`, or the `block`+`lot` of one of their children, resolves (§4.2 Parcels) to a parcel the row's `blklot` resolves to, and whose project's §4.6 end, computed without the row, is `open`.
    - **Pick.** The winner is chosen only among candidates whose project holds no pipeline row (including a row linked earlier in this pass; rows go in canonical order): the latest `open_date` wins; ties go to the smallest `record_id` (main's ruling 2, wave F2).
    - **Join.** The row joins the winner's project after steps 1–9. The project keeps its id, dates, stages, pathway, label and parcels. The row contributes only its `sources` entry and the pipeline match of §4.7 (the project is not stale). It contributes no date, no units and no label: §4.5 and §4.8 read the PRJ's records as if the row were absent, and §4.8 `units` stops at precedence rule 2 (the pipeline's `new_pipeline_units` is not used). The project is not multi-phase, and a `multiphase.json` entry for the row is unused and named in a build warning.
    - **No units.** If the joined project has no units from §4.8 rules 1–2, or is otherwise outside the population (§4.3), it is not in flight. The row's units count in `projects.excludedNoUnits` (not in `projects.excludedAlterationUnits`), and the build warning names the row's `case_no` and the PRJ.
    - **Dropped.** The row is dropped and counted under `pr.pipeline.no-status-date` when it finds no candidate (warning `'<caseNo>: no status date and no open Planning record on its lot; dropped'`), or when every candidate's project already holds a pipeline row (the row would be a second row on one project). The second warning names the latest-opened candidate and its row: `'<caseNo>: no status date and every open Planning record on its lot already holds a pipeline row (<recordId> holds <otherKey>); dropped'`. A dropped row has no project and is left out of V21.
    - Every project that holds a linked row carries `pr.pipeline.status-date-linked` in `quality`, in T3 and in T4d.

    Live (queries 2026-10-17): Freedom West (2023-007911PRX, lot 0770027) passes over the newer `2024-003742PRJ`, which holds its own pipeline row, joins `2020-006887PRJ` and is in flight as `PRJ:2020-006887PRJ` at `filed` on 2020-07-24 with 2,387 units. Flower Mart (2026-000246PRX, lot 3778047) joins `2025-008569PRJ`, whose base proposal has 0 units, so it is out: `projects.excludedNoUnits` = 3,532, named. `pr.pipeline.no-status-date` is expected to fire on 0 rows live.

**Superseded permits.** A dead permit is superseded when another permit in the same project was filed after it. Dead means `status` is `withdrawn`, `cancelled`, `expired`, `disapproved` or `revoked`. Live data has 57 same-lot refiles, e.g. `2019-020818PRJ`. A superseded permit counts only toward `permitFiled`. The **live set** is the permits that are neither dead nor superseded. The **unit-bearing set** is the live set, or, when the live set is empty, the permits that are not superseded (implementation ruling, Task 7): a dead project's sizes then still reach the calibration fits.

**Parcels.** Candidate block-lots come from:
- every address row of the project's permits;
- the anchor PRJ `block`+`lot`;
- the pipeline `blklot`;
- for a PPA-only project, the PPA's `block`+`lot`.

Each candidate maps to a current parcel:
- **Active `blklot`.** It maps to its `mapblklot` via the active rows of `src_parcels`. Condo sub-lots map to their `mapblklot`, e.g. pipeline `0708023` → `0708021`.
- **Retired `blklot`.** It maps via `scenario-data`'s lineage table (`parcel-lineage.parquet`, DuckDB table `parcel_lineage`): the row whose `blklot` matches gives `current_mapblklot` (T13; round-2 "Table names"; ruling P3). scenario-data assigns a retired lot to the current parcel containing its centroid.

`parcelIds` is the sorted, de-duplicated set of mapped ids that exist in the build's parcel set (I1). Unmapped and absent ids are counted and dropped. Live probe of pipeline `blklot`s on 2026-10-16: 1,823 map to the same id, 18 condo, 76 retired. The real lineage maps 5 of 39,207 candidate block-lots differently from the earlier centroid approximation, with no effect on any count (COMPLETION.md, live round 4).

### 4.3 Population

A component is a **new-construction residential project** when both conditions hold:
- It holds a type 1/2 permit, or an anchor PRJ has `new_construction = 'CHECKED'` and `number_of_units_prop ≥ 1`.
- Its **net units** are ≥ 1 (reconciliation: "the event is net units ≥ 1"). Net units are `units − existingUnits` (§4.8). For histories, `existingUnits` is the assessor value at filing: the roll year of the first entered day, clamped to 2007..latest (T4d). For the in-flight test it is the project's own latest-roll count, before the shared-parcel rule (§4.8).

PPA-only projects are in the population, but they cannot be in flight because they have no units (§4.7).

Verified live:
- Pipeline rows whose PRJ meets neither condition (258 rows with units) are alterations.
- Rows whose `bpa_no` names a non-type-1/2 permit (926 rows, 2,826 net units) are ADUs and conversions.

Both groups are excluded and their units are counted in `projects.excludedAlterationUnits` (4,860 live on the 2026-10-17 lock). Rows linked under §4.2 step 10 whose project has no units are counted in `projects.excludedNoUnits` instead.

**Pre-2007 histories (DQ-1).** The 2007 clamp stays. A pre-2007 project reads the 2007 roll, which often already shows the finished building, so it fails the net test and leaves the histories: live, histories fall from 10,212 to 4,716 with real assessor units, and 4,901 of the 5,496 dropped histories were filed before 2007 (COMPLETION.md item 5). DQ-1 handles this in stage-calibration, by starting the pooled permit-side windows on 2007-01-01. T4d `existingUnits` stays `number`, and this spec changes nothing here.

### 4.4 Pathway

1. **`streamlined`** when an anchor PRJ meets any of these:
   - `sb35`, `housing_sustainability_dist` or `ab2162` is `'CHECKED'` (76, 4 and 11 PRJs live). The reconciliation counts AB 2162 as streamlined.
   - Its `description` matches `/\bSB[\s-]?35\b|\bSB[\s-]?423\b|\bAB[\s-]?2011\b|\bAB[\s-]?2162\b|Housing[\s-]+Choice\s*[-–—]?\s*(SF|San Francisco)|\bHCSF\b|Section\s+206\.10|Housing Sustainability District/i` and does not match `/\b(not|ineligible)\b[^.]{0,40}\b(SB[\s-]?35|SB[\s-]?423|AB[\s-]?2011)/i`.

   SB 423 and AB 2011 have no field; text is the only indicator. "Local Program" alone is **not** an indicator, because pre-2026 records use it for the ADU Local Program (verified, e.g. `2022-013049PRJ`).
2. **`discretionary`** when an anchor PRJ has a `d4jk-jw33` row, or a child of type `CUA, VAR, DNX, ENX, OFA, AHB, PHA, DVA, MAP, PCA, GPA, CTZ, COA, PTA, DRP, DRM` or `PPA`. Pipeline-only rows and PPA-only projects are `discretionary` (reconciliation).
3. **`permitOnly`** when there is no anchor PRJ, or every anchor PRJ is a **referral**. A referral has no streamlined or discretionary evidence and opened on or after the earliest permit's filed day minus 30 days. Live data has 1,301 such evidence-free PRJs opened after their permit.

   **The 30-day referral tolerance is tier 4 and made up.** It covers intake routing, where Planning opens the referral PRJ shortly before DBI records the permit's filing. One month is a round figure, chosen because only 15.8% of linked PRJ–permit pairs fall within ±30 days of each other (verified live). That makes the result insensitive to the exact value. The report prints it as `params.referralToleranceDays`. It is a model parameter, not a T14 rule: it rewrites no source value.
4. **Unclassifiable** otherwise: an anchor PRJ with no evidence and no permit to judge it by.
   - The history gets `pathway: null` (T4d).
   - The in-flight project defaults to `discretionary`, because T3 needs a pathway. The default is counted as `projects.pathwayDefaulted`.

The meanings of child types `DRM` and `PHA` are inferred from samples.

### 4.5 Stage entry dates

`raw[s]` uses valid dates only.

| stage | `raw` (first that exists) | notes |
|---|---|---|
| `preApplication` | min `open_date` of the project's PPAs | dropped unless before `raw.filed` |
| `filed` (not `permitOnly`) | min of the **filing evidence**: (a) anchor PRJ `open_date`, unless a PPA opened within 7 days of it; (b) `open_date` of children of type `ENV, CUA, VAR, DNX, ENX, OFA, AHB, PHA, DVA, COA, PTA, MAP, PCA, GPA, CTZ`; (c) `d4jk` `start_event_date`; (d) the filed day of any permit in the project | (a) exists because 43% of parented PPAs share the PRJ's `open_date`: the PRJ is created as the PPA's umbrella (verified). **The 7-day window is tier 4 and made up:** one working week of intake lag around the exact-match case. The report prints it as `params.ppaUmbrellaDays` |
| `entitled` (not `permitOnly`) | `d4jk` `end_event_date` where `end_event_type='approval'` (2013-05-06 onwards); else `project_decision_date` when the decision is `Approved`; else pipeline `approved_date_planning` (not from a row linked under §4.2 step 10); else max `close_date` of rule-2 children whose `record_status` matches `/Approved/` | |
| `permitFiled` | min filed day over **all** of the project's permits | discretionary/streamlined: kept only if `entitled` or `permitIssued` exists. A permit filed in parallel with Planning review leaves the project at `filed` |
| `permitIssued` | min `issued_date` over the live set | |
| `construction` | min over the live set of `first_construction_document_date` (site permits), else `issued_date` (full permits) | a site permit without an FCD has not started |
| `complete` | set when every live permit has a completion day; the value is the max of those days. A permit's completion day is its first `j67f` TCO or CFC with units > 0, else `completed_date` when `status='complete'` | reconciliation: "first TCO, otherwise the permit's `completed_date`". `j67f` starts in 2018, so earlier completions are CFC-dated; stage-calibration documents the bias |

**Out-of-order dates** (rule `pr.stages.forward-clamp`). Walk `STAGE_ORDER` and set `entered[s] = max(raw[s], max earlier entered)`. This is common live: 22 site permits have FCD before issuance, and 1,764 entitled PRJs opened after their permit was filed. On the 2026-10-16 smoke lock the clamp moved 1,697 stage days across 10,212 histories (1,463 of them `permitFiled`). The rule's counts replace the former `histories.clamped.*` keys: `fired` is the number of histories with at least one clamped stage, and `of` is `histories.total`. A clamped history, and the T3 project built from the same linkage, carry the rule id in `quality`. Consumers that need a raw filing day read `permits.parquet` (T4d; IA-11).

**Pipeline-only rows.**
- Stage from `current_status`:
  - `PL Filed` → `filed`;
  - `PL Approved` → `entitled`;
  - `BP Filed` and `BP Approved` → `permitFiled`;
  - `BP Issued` and `BP BP Issued` (a live typo) → `permitIssued`;
  - `Construction` → `construction`.
- `history[stage] = current_status_date`. `history.entitled = approved_date_planning` when present and not later.
- If `current_status_date` is invalid, the row goes through §4.2 step 10: it is linked to its PRJ, or dropped and counted.

### 4.6 Ends and exits

Rules are applied in order; the first that matches decides the end.

1. **Complete.** If `entered.complete` exists, `end = { kind: 'complete', day: entered.complete }`. A later cancel does not undo it.
2. **Permit exit.** The live set is empty and every permit is dead. The last-dead permit decides (latest `status_date`, then highest number). Status maps to reason: `withdrawn`→`withdrawn`, `cancelled`/`revoked`→`cancelled`, `expired`→`expired`, `disapproved`→`disapproved`. The day is its `status_date`.
3. **Planning exit.** Applies only when the project has no permits.
   - `withdrawn`: an anchor PRJ `record_status` of `Closed - Withdrawn`, `Withdrawn` or `Project Withdrawn`, or a `project_decision` of `Withdawn` [sic] or `Withdrawn`.
   - `cancelled`: `Closed - Cancelled` or `Cancelled`, or the decision `Cancelled`.
   - `disapproved`: `Disapproved`, `Closed - Disapproved` or `Denied`, or the decision `Disapproved`.
   - The day is `project_decision_date`, else `close_date`, else `lastObserved`.

   All values were verified live.
4. **Closed without a decision** (reconciliation). The project has no permits, and every anchor PRJ has `record_status = 'Closed'`, no `project_decision` and no `entitled` date. The end is `withdrawn` at the stage it was in, dated by the latest anchor `close_date`.
   - A PRJ with approval evidence was decided, so this rule does not apply to it. It stays open with `close_date` feeding `lastObserved`.
   - Live: pipeline rows whose PRJ is `Closed` almost all carry approval evidence, so this rule removes few in-flight rows.
5. **PPA-only.**
   - `Closed - Withdrawn` → `withdrawn`; `Closed - Cancelled` → `cancelled`; both at `close_date`.
   - Otherwise, a PPA opened more than `ppaLag` days before `asOf` is `withdrawn` at `close_date`, else at `open_date`.
   - Otherwise the PPA is open.
6. **Open.** Otherwise `{ kind: 'open', lastObserved }`.

**Exit stage and day** (ruling L1). `exit.stage` is the last entered stage. The exit day is `max(exit day, entered[exit.stage])`: an exit dated before a later entered stage moves to that last stage, at its entry day. This keeps V23's `end.day ≥ the last entered day`. Live, 21 histories get a zero-duration exit at the later stage. A PRJ withdrawal never ends a project that still has a live permit.

### 4.7 `lastObserved` and the stale-open rule

`lastObserved` is the latest valid date across the project's records, clamped to `[first entered day, asOf]`. It draws on:
- PRJ open, close and decision dates;
- child open and close dates;
- `d4jk` start and end dates;
- the permit's `filed_date`, `issued_date`, `first_construction_document_date`, `completed_date`, `status_date` and `last_permit_activity_date`;
- the pipeline `current_status_date`.

It is the last day on which the records show the project alive. A history never dies of age; censoring is `stage-calibration`'s job.

**In flight at the snapshot.** A project is in flight when all of the following hold:
- **Open or pipeline-only.** The project is in the population and its history ends `open`, or it is a pipeline-only row with a valid status date.
- **Not stale.** It matches at least one pipeline row (including a row linked under §4.2 step 10), **or** its first entered day is after `pipelineCutoff − 92`.
  - `pipelineCutoff` is the max valid `current_status_date`. The live value is 2026-07-28.
  - 92 days is one quarter, the dataset's published refresh cadence (tier 1, from dataset metadata).
- **Has units.** `units ≥ 1`. For a PRX master, after DA netting (§4.10.2): a master netted to 0 is not in flight.
- **Has parcels.** The resolved candidate parcels (§4.2 Parcels) are non-empty. A score-only master (§4.10.2, DQ-3) passes this test, and its T3 `parcelIds` is then empty.

PPA-linked projects at `preApplication` take their units from the umbrella PRJ. PPA-only projects have no units and are counted, not shipped. The PPA series ends 2023-07-07, so live builds may have none.

An open project that fails the pipeline/recency test is **stale-open**. It stays open in histories and is counted in `projects.staleOpen` and `projects.staleOpenUnits` (490 projects, 27,158 units on the 2026-10-17 lock).
- Live, 825 open-permit components were absent from the pipeline on 2026-10-16. Most are permits still `filed` from 1981–2015.
- DBI batch-withdrew such permits in Sept–Oct 2026, visible in their `status_date`.

**Records win** (rule `pr.pipeline.records-win`, observe). When daily records conflict with the quarterly pipeline, the records win. A conflict is a population project matching a pipeline row whose history ends `complete` or `exit`, or whose last entered stage differs from the row's `current_status` stage. The rule only counts: `fired` is the conflicting projects (24 on the 2026-10-16 smoke lock), `of` is the population projects matching at least one pipeline row. It writes no value, so no record carries it in `quality`. Its counts replace the former `projects.pipelineConflicts` key.

### 4.8 In-flight fields

- **`stage`** is the last `history` key in `STAGE_ORDER`.
- **`label`** is the first that exists:
  0. for a PRX row, the curated `multiphase.json` entry's `label`, which the phase card also uses (round 4, N19);
  1. the lead permit's primary address row, `street_number street_name street_suffix`, title-cased;
  2. anchor PRJ `project_address`;
  3. pipeline `nameaddr` (not from a row linked under §4.2 step 10);
  4. `null`.
- **`units`** (gross) is the first that exists:
  1. Σ `proposed_units` over the unit-bearing set (§4.2), counting only permits whose units are not missing;
  2. anchor PRJ `number_of_units_prop` when > 0;
  3. pipeline `new_pipeline_units`, except for a project whose only pipeline rows were linked under §4.2 step 10.

  Pipeline-only rows use `new_pipeline_units`; a PRX master then nets it (§4.10.2).

  **Capacity** (rule `pr.units.capacity`). A permit's `proposed_units` is physically impossible when it exceeds `Σ areaM2(parcelIds of the permit's project) × max(number_of_proposed_stories, 1) / MIN_GROSS_M2_PER_UNIT` (T14, 10 m², tier 4). The check runs only when `number_of_proposed_stories` is recorded (non-null) and the project has at least one parcel. A failing permit's units are missing everywhere downstream: in rule 1 above (which then falls through to rule 2 if no unit-bearing permit has units), in `unitsAt.permitFiled`, in the phase-size medians of §4.10.2 and in `permits.parquet` `proposed_units` (null). Its project carries the rule id in `quality`, in T3 and T4d. The live case is permit `8500988` (filed 1985, 5,540 units on 3 stories; query 2026-10-17).
- **`existingUnits`** (reconciliation: latest assessor roll; shared parcels, rule `pr.parcels.shared-existing`). For a T3 project it is Σ over `parcelIds` of the parcel's **allocated** units: `assessorUnits(id, latestRollYear)` from the T13 panel (null treated as 0) when the project is the parcel's holder, else 0.
  - A parcel's holder is the in-flight project on it whose `history` has the earliest first day, ties to the smallest id. A parcel with one in-flight project is held by it.
  - The rule is applied once, after the in-flight set, DA netting and phasing are final (§4.10). It only lowers values, so the net test already passed (§4.3) and V20 still hold.
  - Every in-flight project on a parcel that has two or more in-flight projects and assessor units > 0 carries the rule id in `quality`, the holder included.
  - Live, 81 in-flight projects shared 38 parcels (8,735 units) before the rule (COMPLETION.md item 6).
  - The card says "existing homes (assessor)".
  - For a `ProjectHistory`, `existingUnits` is the unallocated value at filing: the roll year is that of the first entered day, clamped to 2007..latest (T4d). Histories that share a parcel over time are mostly sequential, so the rule does not apply to them.
- **`stories`** and **`storiesTier`**:
  1. Max `number_of_proposed_stories` > 0 over the unit-bearing set, with tier `0`. Live, 505 of 12,858 are null and 84 are zero.
  2. Else parse the anchor PRJ `description`, falling back to pipeline `description_planning`. Take the first `/(\d{1,2}|one|two|…|twenty)[\s-]*stor(?:y|ies)/i` after the first `/\b(construct|erect|new|build)\b/i`. The keyword guard skips the existing building's stories. Tier `3`.
  3. Else the first `/(\d{2,3})[\s-]*(?:foot|feet|ft)\b/i` after that keyword, converted with `floor(ft / 10)`. Tier `3`; this is the design's height-to-stories rule.
  4. Else `null` and `null`.

  Parsed values outside 1–80 are discarded (`MAX_STORIES` = 80, reconciliation; rule `pr.stories.parse-range`), and the next step of the precedence applies. A project whose parsed value was discarded carries the rule id in `quality`.
- **`multiPhase`** is `true` only for `…PRX` pipeline-only rows.
- **`phases`** is `null` for every project that is not multi-phase. Multi-phase projects follow §4.10.
- **`sources`** lists every record that set a date, a number, the pathway or the label, plus every pipeline row the project holds (including a row linked under §4.2 step 10), as `{ dataset: <DataSF id>, id }`. The id is:
  - `record_id` for PRJ and child records;
  - `b1_alt_id` for `d4jk`;
  - `permit_number` for permits and `j67f`;
  - `case_no ?? bpa_no` for pipeline rows.

  `key` names the field that holds the id. It is omitted only when that field is the dataset's `record_id` (round 2, "DataSF links"):

  | dataset | id field | `key` |
  |---|---|---|
  | `qvu5-m3a2`, `y673-d69b` | `record_id` | absent |
  | `i98e-djp9` | `permit_number` (its `record_id` is per address row) | `'permit_number'` |
  | `d4jk-jw33` | `b1_alt_id` | `'b1_alt_id'` |
  | `j67f-aayr` | `building_permit_application` | `'building_permit_application'` |
  | `xdht-4php` | `bpa` | `'bpa'` |
  | `6jgi-cpb4` (no record-id field) | `case_no` (PRJ and PRX rows), else `bpa_no` | `'case_no'` or `'bpa_no'` |

  Sorted by `(dataset, id, key)`.
- **`quality`** is the sorted, de-duplicated list of the T14 rule ids that changed or estimated a value of the project (§4.11); `[]` when none did.

**`ProjectHistory` extras (T4d).**
- **`unitsAt`.** Tier 2: these are current values across records, not snapshots.
  - `filed` is PRJ `number_of_units_prop`.
  - `permitFiled` is Σ `proposed_units` over the unit-bearing set, without units nulled by `pr.units.capacity`; absent when none remain.
  - `complete` is Σ per permit of `max(Σ TCO units, max CFC units)` from `j67f`. The CFC-restates-the-total reading is inferred from live rows, e.g. TCO 2 units then CFC 120. It is present only when `entered.complete` is.
- **`storiesProposed`** follows the `stories` rule.
- **`baseStoriesAtFiling`** is the max over `parcelIds` of the base stories in `scenario_panel` (T13), taken at the roll year of the first entered day, clamped to 2007..latest; else `null`. Tier 3: the current base height proxy (reconciliation, "Pre-FZP heights"; round 2, "Table names").
- **`quality`** follows the T3 rule, without `pr.parcels.shared-existing` and `pr.multiphase.da-netting`, which act only on T3.

### 4.9 Pipeline wiring

**Delivery order** (round 4, N5 and N17; reappraisal 1, fix-round order):
- Step 0 shipped `src/lib/timelapse/projects.ts`: the T3 types (`InFlightProject` and the `projects.json` file type) and a zod-free validator that V20 and the consumers share. This spec owns the file.
- The pipeline work integrated in step 1, after scenario-data's panel (`scenario_panel`, `parcel_lineage`) and its fixture landed.
- **Wave F2, this spec's fix round**, runs after scenario-data's T14 module, V30 and panel changes merge. Its first commit folds this spec's doc debt (Reappraisal 1 changes, below). It then makes, in this order:
  1. **The step-0 type edits**, which belong to this fix round. In `src/lib/timelapse/projects.ts`: `InFlightProject.quality: string[]`; `ProjectsFile.qualityRules: { id; label; tier; valueTier }[]`; the `parcelIds` check (`projects.ts:201`) accepting `[]` only when `multiPhase` is true and `phases` is null; and `parseProjectsFile(json, opts?: { asOf?; parcelIds?; onInvalid?: (path: string, message: string) => void })` (IA-5). In `src/lib/timelapse/types.ts`: `ProjectHistory.quality: string[]` and the `existingUnits` comment of the T4d row. The validator changes are listed under V20.
  2. The project-records entries in `pipeline/lib/quality-rules/pr.ts` (§4.11), collected into `QUALITY_RULES`, and their `recordQuality` calls.
  3. DQ-2 (§4.2 step 10), the capacity rule, shared parcels, DA netting and DQ-3 (§4.10.2), and V24's extension.
  4. The fixture cases and regenerated goldens.

**`parseProjectsFile` with `onInvalid`** (T3; IA-5).
- Without `onInvalid` it throws `ProjectsFormatError` at the first violation, file-level or project-level, and returns the input typed. V20 calls it this way.
- With `onInvalid`, a project-level violation calls `onInvalid(path, message)` once for that project, with its first violation, and leaves the project out of the returned file, which is then a shallow copy with the remaining `projects`. A file-level violation still throws.
- File-level checks: `schema`, `asOf` (and `opts.asOf`), `rhnaCompletedNet`, `projects` being an array, and every `qualityRules` check (shape, sorted by `id`, unique, and every listed id used by at least one project of the input array).
- Project-level checks: every check on one element of `projects`, including a duplicate `id` (the later element is invalid) and a `quality` id missing from `qualityRules`.

**Step placement.** `build` (`pipeline/steps/build.ts:140-147`) runs `projectRecords` after `runSql` and the `scenario-data` step, and before `stage-calibration`. It is pure TS, like `writeTransit`. It reads these DuckDB tables:
- `parcelIds` from `parcel_out`;
- `assessorUnits`, `baseStories` and `areaM2` (`lot_area_m2`) from `scenario_panel` (T13; post-T14 values);
- `lineage` from active `src_parcels` rows and `parcel_lineage` (T13).

The derived folder comes from scenario-data's `derivedRoot` build option (ruling A6/P3; default `pipeline/.cache/derived`; fixture builds use a temp root).

**Outputs.**
- `out/<v>/scenarios/fzp/projects.json`, minified, with `schema: 1`. Keys follow T3 declaration order, `history` keys follow `STAGE_ORDER`, projects are sorted by `id`, `parcelIds` and `quality` are sorted, and `qualityRules` is sorted by `id`. `qualityRules` holds one entry per id used in any project's `quality`, copied from the `QUALITY_RULES` entry: its `id`, `label` (generic, about the rule, never naming a record), `tier` and `valueTier`.
- `pipeline/.cache/derived/<datasetVersion>/project-histories.json` (T4d layout), sorted by `id`. The histories are also passed in memory to `stage-calibration`.
- Fixture builds write `derived/<fixture-n>/`. `--update-golden` copies the histories to `pipeline/test/fixtures/mini/golden/derived/project-histories.json` and the permits rows to `golden/derived/permits.json`.
- `pipeline/.cache/derived/<datasetVersion>/permits.parquet` (round-3 addenda; now in the T4d row, IA-18). It is input to stage-calibration's `phaseGap` and its initiation event day (IA-11), and is never shipped. There is one row per linked type 1/2 permit, written with DuckDB `COPY … (FORMAT parquet)`. Rows are sorted by `(prx_case_no, dva_record_id, filed_day, permit_number)`, with nulls last. Columns:
  - `permit_number` VARCHAR.
  - `project_id` VARCHAR: the T3/T4d id of the permit's project.
  - `prj_record_id` VARCHAR NULL: the anchor PRJ.
  - `dva_record_id` VARCHAR NULL: the anchor PRJ's `DVA` child (Development Agreement), with the lowest id if several.
  - `prx_case_no` VARCHAR NULL: the PRX row whose base-case PRJ (§4.10.2: the case without its trailing `PRX`, or that plus `PRJ`; Ruling B1) equals `prj_record_id`, or whose `da` equals this permit's pipeline row `da`.
  - `da` VARCHAR NULL: the pipeline `da` of the row naming this permit.
  - `parcel_ids` VARCHAR[]: resolved per §4.2.
  - `proposed_units` INTEGER NULL: null when missing or nulled by `pr.units.capacity`.
  - `site_permit` BOOLEAN.
  - `status` VARCHAR.
  - `live` BOOLEAN.
  - `superseded` BOOLEAN.
  - `filed_day`, `issued_day`, `construction_day`, `complete_day`, `status_day` INTEGER NULL: valid dates as T1 `Day`, from the same rules as §4.5 applied to this permit alone, without the project-level clamp.
  - The fixture copy is checked by `golden.test.ts` as row values, not bytes. It holds M14's completed permit with `prx_case_no` `2010.0002PRX`.
- `GOLDEN_FILES` (`pipeline/steps/fixture.ts:25-31`) gains `scenarios/fzp/projects.json`.
- The `report.json` counts gain the `projects.*`, `histories.*`, `multiphase.*` and `rhna.*` keys named here, and the T14 `quality.<id>.*` keys of §4.11.

**`rhnaCompletedNet`** (the Housing Inventory's net: units completed in new construction, plus units gained or lost through alterations, minus units demolished).
- **`since`** is Day(2022-06-30). HCD's determination to ABAG (2020-06-09) gives the "projection period beginning June 30, 2022" (https://www.hcd.ca.gov/community-development/housing-element/docs/abagrhna-final060920(r).pdf, verified).
- **`units`** is Σ `net_units_completed` over `xdht-4php` rows whose `first_completion_date` is in `[since, asOf]`:
  - forms 1 and 2 (new construction);
  - forms 3 and 8 (alterations, net);
  - form 6 (demolitions, negative; 1,187 negative rows live).

  This follows the Housing Inventory's definition of units certified complete, which "include[s] units gained or lost from new construction, alterations, and demolitions". The HI also counts TCO units as completed (2025 HI p.16, verified).
- **`provenance`**:
  - tier `0`;
  - `label: 'Net homes completed since 30 Jun 2022 (actual)'`;
  - `sources`: DataSF `xdht-4php` and the HCD letter;
  - `method`: the rule above and the cross-check;
  - `n`: rows counted;
  - `window`: `['2022-06-30', asOfIso]`.
- **Cross-check (tier 1).** Each calendar year wholly inside the window with a `hiNet` entry is compared with 2025 HI Table 2 "Net Change in Number of Units". The published values are 2023 2,544, 2024 1,603 and 2025 2,669 (verified, https://sfplanning.org/sites/default/files/resources/2026-04/2025_Housing_Inventory.pdf p.17).
  - `hiNet` lives in `InvariantProfile` (`pipeline/config.ts:44-67`).
  - Live records give 2,517, 1,610 and 2,813: Σ 6,940 against 6,816, or +1.8%.
- **`rhna.xdhtLagDays`** is `asOf` − max `first_completion_date` (8 days live). Above 120 days the build warns.

**Invariants.** These ids are allocated to this spec by the reconciliation. They run in `checkDataset` (`pipeline/steps/check.ts:90`). Thresholds live in `InvariantProfile` and are tier-4 check bounds, not model numbers.

| id | check | live | fixture |
|---|---|---|---|
| V20 | `projects.json` passes the T3 validator without `onInvalid`: `schema` 1; `asOf` = snapshot day; ids unique and prefixed per T3; `parcelIds` sorted and in the parcel set, and non-empty except for a score-only master (`multiPhase` true, `phases` null; §4.10.2, DQ-3; orchestrator ruling on the encoding), which also carries `pr.multiphase.score-only` in `quality`; `stage` = last `history` key; `history` non-decreasing in `STAGE_ORDER` and ≤ `asOf`; `permitOnly` has no `filed`/`entitled`; `units` ≥ 1; `units − existingUnits` ≥ 1 except `multiPhase`; `stories` null or 1–80; `storiesTier` null iff `stories` null; `sources` non-empty; `quality` a sorted, unique string array whose ids are all in `qualityRules`; `qualityRules` sorted by `id`, unique, each `label` non-empty, `tier` in {2, 3, 4}, `valueTier` in {0..4} or null, and exactly the ids used. The pipeline side adds: each `qualityRules` entry equals its `QUALITY_RULES` entry (`label`, `tier`, `valueTier`) with owner `project-records`; `projects.json` ≤ 2 MB, with a warning above 1 MB (engineering budget) | same | same |
| V21 | Pipeline coverage: Σ `units` of in-flight projects matched to population pipeline rows ≥ 0.90 × Σ `new_pipeline_units` of those rows, excluding rows the records show ended. A PRX master contributes its R **before** DA netting, whether or not netting took it out of flight, because the netted units are in flight as other projects. A row linked under §4.2 step 10 counts when its project is in the population. A row dropped under §4.2 step 10 (`pr.pipeline.no-status-date`) has no project and is left out of both the rows and the units; its T14 rule counts it (Ruling V1, wave F2) | ≥ 0.90 (0.9175 on the 2026-10-17 lock, before reappraisal 1) | ≥ 0.90; golden 0.9722 (699 of 719 units, 11 rows): below 1.0, since M16's row and record disagree; M18's dropped 20 units are not in it |
| V22 | `rhnaCompletedNet`: each cross-check year within ±10% of `hiNet`; the total within ±5%. The check fails when no cross-check year is compared (implementation ruling, Task 9) | 2023–2025 | fixture `hiNet` |
| V23 | Histories: entered days non-decreasing; `end.day` ≥ the last entered day; `complete` ⇒ `entered.complete = end.day`; `exit.stage` is the last entered stage (L1); `lastObserved` in [first entered day, `asOf`]; each non-null pathway has ≥ 1 history; `quality` sorted, unique, every id a `project-records` entry of `QUALITY_RULES` and neither `pr.parcels.shared-existing` nor `pr.multiphase.da-netting`; `deriveProjects` run twice gives byte-identical `projects.json` and histories | same | same |
| V24 | Multi-phase phasing (§4.10). Every in-flight `multiPhase` project has non-null `phases`, unless it is a last resort (counted). `Σ phases.units = units`. Each phase has `units ≥ 1`, non-empty `parcelIds` drawn from the parcel set. Phase parcels are disjoint from each other within the master, and disjoint from every other in-flight project's parcels other than the master's own. **Extended to last-resort masters (DQ-3):** a last-resort master's `parcelIds` are DA parcels and are disjoint from every other in-flight project's parcels and phase parcels; a score-only master has empty `parcelIds` and every one of its DA parcels is held (§4.10.2). `plannedPermitFiled` is null or later than `history.entitled`. Enriched phases carry `source`; fallback phases carry `source: null` and `plannedPermitFiled: null`. Every `multiphase.json` entry names an existing PRX row, every fact carries a URL and a retrieval date ≤ `asOf`, and every PRX row with units has an entry (§4.10.1). The enriched scale factor R / Σ, with R before netting, is in [0.8, 1.25] | same; live checks the AC-11 coverage | 1 enriched (M9), 1 fallback (M14), 1 score-only last resort (M20) |

**Fixture.** `make-fixture.ts` gains seven `raw/<lockId>.page-000.json` files in SODA shape: lower-case keys, numbers as strings, nulls omitted. Their lock entries have `retrievedAt` ≤ 2026-10-10, which keeps the fixture `asOf` at Day(2026-10-10). The records live in `pipeline/test/fixtures/mini/projects-raw.ts`. The mini lineage, assessor units, lot areas and base stories come from `scenario-data`'s fixture. That fixture maps retired `3512099` to lot 12 (scenario-data spec mini table). Every lot is 300 m² (10 m × 30 m) unless the mini README says otherwise.

The fixture covers every in-flight stage, a PPA, a multi-phase row (reconciliation "Fixture-0 contents"), and one case per new T14 rule and per DQ-2/DQ-3 branch (M15–M20). Values for M1–M14 are the accepted as-built goldens (`e2e/fixtures/data/fixture-0/scenarios/fzp/projects.json` on `superconductor/fzp-timelapse` @ dda6252) unless a new case changes them; M15–M20 values are qualitative, with goldens computed at implementation.

| mini project | records | expected |
|---|---|---|
| M1 `PRJ:2019-000001PRJ` | PPA `2018-000001PPA` (parent M1); ENV child; d4jk approval 2020-03-02; permit `201906010001` (type 2, site, filed 2019-06-01, issued 2021-02-01, FCD 2021-05-03, `completed_date` 1909-06-02, 24 units, 6 stories, address rows on lots 010 and 011); pipeline `Construction` | in flight, `discretionary`, `construction`, parcels [3512010, 3512011], existing 3, `permitFiled` forced to 2020-03-02, `storiesTier` 0; `quality` [`pr.date.valid-range`, `pr.stages.forward-clamp`] |
| M2 `PRJ:2026-000002PRJ` | `sb35` CHECKED, opened 2026-05-01, 40 units, "construct a new 8-story building", lot 013; pipeline `PL Filed` | in flight, `streamlined`, `filed`, stories 8, `storiesTier` 3, existing 0 |
| M3 `BP:202403150003` | type 1 permit filed 2024-03-15, no PRJ, 2 units, lot 005; pipeline `BP Filed` | in flight, `permitOnly`, history only `permitFiled`, existing 1 |
| M4 `PPA:2021-000004PPA` | PPA, no parent, closed 2021-06-30 | history only: exit `withdrawn` at `preApplication` |
| M5 `PRJ:2017-000005PRJ` | `Closed - Withdrawn` 2018-04-02, 9 units, new construction | history only: exit `withdrawn` at `filed` |
| M6 `PRJ:2016-000006PRJ` | permit `201605010006` complete; `j67f` Initial TCO 2019-08-01 (12 units) | history `complete` 2019-08-01, `unitsAt.complete` 12 |
| M7 `BP:201410070008` | type 2 permit `filed` 2014-10-07, not in pipeline | history open, `lastObserved` 2014-10-07; `projects.staleOpen` = 1 |
| M8 `PRJ:2020-000008PRJ` | referral PRJ (opened after its permit, no evidence); permit on retired lot `3512099`, issued, 4 units; pipeline `BP Issued` | in flight, `permitOnly`, `permitIssued`, parcels [3512012], existing 0 |
| M9 `CASE:2007.0001PRX` | pipeline-only, lot 014, `PL Approved`, status date 2008-06-12, 300 new units, `da` "Fixture Shipyard". The mini `multiphase.json` lists three phases: A (120 units, lot 014, `plannedPermitFiled` null), B (180 units, lot 002, 2027-03-01) and C (40 units, lot 007, `status: 'built'`). Each fact carries a `https://example.invalid/fixture-da.pdf` URL retrieved 2026-10-01 | in flight, `discretionary`, `entitled`, `multiPhase` true, no history. Parcels [3512002, 3512014], existing 43 (lot 14's 40 and lot 2's 3). `phases` = [A 120 [3512014] null, B 180 [3512002] Day(2027-03-01)], each with `source`. C is excluded; scale factor 1.0; netted 0 |
| M14 `CASE:2010.0002PRX` | pipeline-only, lot 009, `PL Approved`, status date 2012-04-02, 100 new units, `da` "Fixture Village". Its `multiphase.json` entry has `schedule: null` and one `searched` URL. PRJ `2010.0002` (base case) has completed permit `201501150014`: 40 units, lot 007, `j67f` CFC 2017-03-01 | in flight, `multiPhase` true, existing 0. Fallback with u = 40 (project median, n = 1): round(100/40) = 3, capped at P = 1 (lot 007 is excluded as built), so `phases` = [100 on [3512009]], with `plannedPermitFiled` null and `source` null. The completed permit is the history `PRJ:2010.0002` (`complete`) |
| M10 `PRJ:2020-000010PRJ` | permit A `202001100010` withdrawn 2021-01-01; permit B `202203010010` filed (6 units), lot 001; d4jk approval 2021-11-01; pipeline `BP Filed` (bpa B) | in flight, `permitFiled` = 2021-11-01 (raw 2020-01-10 forced up), units 6, existing 2 (it holds lot 1: see M19); `quality` [`pr.parcels.shared-existing`, `pr.stages.forward-clamp`] |
| M11 `PRJ:2026-000011PRJ` | `new_construction` CHECKED, opened 2026-09-20, 3 units, lot 006, no evidence, not in pipeline | in flight (after cutoff), `filed`, existing 2; history `pathway: null`; T3 `discretionary`; `projects.pathwayDefaulted` = 1. It nets M20 (below) |
| M12 `PRJ:2026-000012PRJ` | umbrella PRJ `Open`, opened 2026-08-03, `new_construction` CHECKED, 24 units, lot 008; PPA `2026-000012PPA` (parent M12, opened the same day) | in flight, `discretionary`, `preApplication`, units 24, existing 12, parcels [3512008] |
| M13 `PRJ:2015-000013PRJ` | `Closed`, no decision, no approval, no permit, closed 2016-05-02 | history only: exit `withdrawn` at `filed` 2016-05-02 |
| M15 `PRJ:2025-000015PRJ` (capacity) | referral PRJ `2025-000015PRJ` (`new_construction` CHECKED, 10 units, opened 2025-03-20, no evidence) on lot 3 (`8711023C`, 300 m²); type 2 site permit `202504010015` filed 2025-04-01, 5,540 proposed units, 3 stories; pipeline `BP Filed` (bpa the permit, status date 2026-06-01, 10 new units). Modelled on live `8500988` | in flight, `permitOnly`, `permitFiled`; the permit's 5,540 units exceed 300 × 3 / 10 = 90 and are missing, so `units` = 10 from the PRJ; stories 3, tier 0; existing 4 (lot 3's 2025 roll units after scenario-data's `sd.roll.units-capacity`, which replaces 5,000 with the LUDB value 4), so net 6; the history's `existingUnits` at filing (roll year 2025) is also 4; `quality` [`pr.units.capacity`]; `permits.parquet` `proposed_units` null; the history has no `unitsAt.permitFiled`. The PRJ opened before the permit was filed, so the permit is assigned to it and the PRJ is an anchor (§4.2 step 1); the id is `PRJ:<record_id>` (§4.2 step 8), as for the referral M8 |
| M16 (DQ-2 linked) | pipeline-only `2024-000016PRX`, `PL Filed`, no `current_status_date`, 220 new units, lot 4 (`0026T001A`); PRJ `2024-000016PRJ` `Under Review`, opened 2024-02-01, `new_construction` CHECKED, 200 units, lot 4, ENV child opened 2024-03-01, no pipeline row of its own. Mini `multiphase.json` entry with `schedule: null` and one `searched` URL | in flight as `PRJ:2024-000016PRJ`, `discretionary`, `filed` 2024-02-01, units 200 (not 220), existing 3 (lot 4's 2025 roll units), `multiPhase` false; `sources` include `6jgi-cpb4` `2024-000016PRX` with `key` `'case_no'`; `quality` [`pr.pipeline.status-date-linked`]; the history carries the same id, and its `existingUnits` at filing (roll year 2024) is 3, scenario-data's `sd.roll.units-capacity` replacement of lot 4's 900; a warning names the unused multiphase entry |
| M17 (DQ-2, no units) | pipeline-only `2025-000017PRX`, `PL Filed`, no status date, 900 new units, lot 007; PRJ `2025-000017PRJ` `Under Review`, opened 2025-09-12, lot 007, `number_of_units_prop` 0, `new_construction` not checked. Lot 7's other PRJ (`2010.0002`) is complete, so it is not a candidate. Mini `multiphase.json` entry with `schedule: null` | not in flight, no history; `projects.excludedNoUnits` = 900, the warning names `2025-000017PRX` and `2025-000017PRJ`; `pr.pipeline.status-date-linked` fires (2 rows with M16) |
| M18 (no status date, no PRJ) | pipeline-only `2026-000018PRJ` (no such record), `PL Filed`, no status date, 20 new units, lot 009, no `da` | dropped: `quality.pr.pipeline.no-status-date.fired` = 1, `.units` = 20. It is not one of M14's DA rows (no `da`) |
| M19 `BP:202501150019` (shared parcel) | type 1 permit filed 2025-01-15, 3 units, lot 001; pipeline `BP Filed` (bpa the permit, status date 2026-05-01, 3 new units) | in flight, `permitOnly`, `permitFiled`; existing 0, because M10 entered lot 1 earlier and holds its 2 units; `quality` [`pr.parcels.shared-existing`]; its history's `existingUnits` is 2 (unallocated, at filing) |
| M20 `CASE:2012-000020PRX` (DA netting, score-only) | pipeline-only, lot 006, `PL Approved`, status date 2013-05-01, 10 new units, `da` "Fixture Yards", no base-case PRJ, no other row with that `da`. Mini `multiphase.json` entry with `schedule: null` and one `searched` URL | DA parcels [3512006]. M11 (3 units, on lot 6, no pipeline row) nets it: R = 10 − 3 = 7, `multiphase.netted.2012-000020PRX` = 3. No project or citywide u exists in the fixture, so it is a last resort; lot 6 is held by M11 (and by M6's completed history), so it is **score-only**: in flight, `multiPhase` true, `phases` null, `parcelIds` [], existing 0, units 7, `history` {`entitled`: 2013-05-01}; `quality` [`pr.multiphase.da-netting`, `pr.multiphase.score-only`]; `multiphase.lastResort` = 1, `multiphase.scoreOnly` = 1 |
| xdht extras | `202101050007` (form 2, +3, 2023-05-10); form 3 (+2, 2024-02-01); form 6 (−1, 2025-01-15) | `rhnaCompletedNet.units` = 4, `n` = 3 |

Remaining fixture settings:
- The pipeline `current_status_date` max is 2026-07-28; the new rows (M15 2026-06-01, M19 2026-05-01, M20 2013-05-01) do not move it.
- Fixture `hiNet` = {2023: 3, 2024: 2, 2025: −1}.
- Assessor units come from scenario-data's fixture roll (round 2, "Fixture-0"; ruling A13). Latest-roll (2025) units by lot: 1 → 2, 2 → 3 (three condo rows of 1), 3 (`8711023C`) → 4 (5,000 replaced by `sd.roll.units-capacity` with the LUDB value 4), 4 (`0026T001A`) → 3 (its 2024 row's 900 is replaced by 3), 5 → 1, 6 → 2, 7 → 0, 8 → 12, 10 → 3, 11 → 0, 14 → 40. Lots 9 and 12 have no roll rows, and lot 13 has no 2025 row, so they count 0. Lot 12's 7 lineage units are in 2024 only.
- `qualityRules` in the fixture file is exactly the ids carried above: `pr.date.valid-range`, `pr.multiphase.da-netting`, `pr.multiphase.score-only`, `pr.parcels.shared-existing`, `pr.pipeline.status-date-linked`, `pr.stages.forward-clamp` and `pr.units.capacity`. `qualityRules` covers only the ids carried by in-flight projects (T3: "for every id that appears" in `projects.json`); history-only records (M4–M7, M13) are not in `projects.json`, and their `quality` ids live only in `project-histories.json`.
- If scenario-data's golden changes these numbers, this spec's goldens follow it (ledger, SD rulings 2026-10-17: "PR goldens follow SD"). M15 (lot 3) and M16 (lot 4) sit on scenario-data's RA1 lots, so they carry scenario-data's rule effects in their values. They carry no `sd.*` id in `quality`: scenario-data rules are not client-visible, and V23 admits only `project-records` ids.

**Determinism.**
- No wall-clock time: `asOf` comes from the lock.
- Iteration is over sorted keys, with the explicit tie-breaks above. Masters are netted and phased in id order.
- `ppaLag` uses nearest-rank ⌈0.9·n⌉.

### 4.10 Multi-phase phasing enrichment (round 3)

Each PRX master is entitled once. Its phases are separate permitting sub-projects, each simulated from `permitFiled` onwards by timelapse-sim. This spec supplies T3 `phases`; the master itself never draws as a building.

#### 4.10.1 `pipeline/enrichment/multiphase.json`

The file is committed and hand-curated. It is under `pipeline/`, so it is part of the dataset-version hash (`docs/dev/pipeline.md:45`). Builds read it directly: it is not fetched and not in the lock. Fixture builds read `pipeline/test/fixtures/mini/enrichment/multiphase.json`. The schema is a zod schema (`pipeline/enrichment/schema.ts`), and a parse failure is a `BuildError`.

```ts
type IsoDate = string; // YYYY-MM-DD
interface Fact { url: string; retrieved: IsoDate; locator: string /* page, table or exhibit */ }
interface MultiphaseFile {
  schema: 1;
  projects: {
    caseNo: string;               // 6jgi-cpb4 case_no, e.g. '2007.0946PRX'
    label: string;                // e.g. 'Candlestick Point / Hunters Point Shipyard Phase 2'
    schedule: { label: string; url: string; retrieved: IsoDate } | null; // the DA phasing exhibit
    searched: { url: string; retrieved: IsoDate }[];  // required, non-empty when schedule is null
    phases: {
      name: string;               // the DA's own phase name, e.g. 'CP Major Phase 2, Sub-Phase 1'
      units: number;              // gross units in the published schedule
      blklots: string[];          // block-lots named for the phase (resolved per §4.2 Parcels)
      plannedPermitFiled: IsoDate | null; // from the schedule of performance, if it gives one
      status: 'remaining' | 'built' | 'separate';
      separateRef?: { dataset: string; id: string; key?: string }; // required when status = 'separate'
      facts: { units: Fact; blklots: Fact; plannedPermitFiled?: Fact };
    }[];                          // empty when schedule is null
  }[];
}
```

**Curation rules.** Curation is tier 1, from each DA's published phasing schedule.
- Use the Development Agreement or DDA phasing exhibit, the schedule of performance, or approved major-phase and sub-phase applications.
- Record each phase's unit count, its block-lots, and the planned permit-filed date. The planned date is the schedule's site-permit or vertical-application deadline for that phase.
- Every fact cites its own URL, retrieval date and locator.
- A phase the records show as completed, or as its own pipeline or permit row, gets status `built` or `separate` (§4.10.3) and keeps its citation.
- Where no schedule can be found, the entry has `schedule: null`, `phases: []`, and the URLs that were searched. The fallback (§4.10.2) is then a recorded decision, not an omission.
- Thin facts stay disclosed in the locators (reappraisal 1, "Thin DA curation": no change).

**Scope and status.** Curating all PRX rows is an **implementation task** with acceptance criterion AC-11. A PRX row counts when `new_pipeline_units ≥ 1`. Live on 2026-10-16 there were 24 PRX rows, 21 of them with units. The build covers whatever the pinned pipeline holds. As built (COMPLETION.md): all 21 rows have entries; 5 are enriched (Candlestick / HPS II, Treasure Island, Parkmerced, Mission Rock, 5M) and 16 have `schedule: null`. No schedule gives a `plannedPermitFiled`. Entries for rows that link under §4.2 step 9 (F1) or step 10 (DQ-2) stay in the file and are reported as unused.

#### 4.10.2 Building `phases` for a master

The **DA parcels** are the resolved parcels of:
- the tracking `blklot`;
- every pipeline row with the same non-null `da`;
- every project holding the **base-case PRJ**, and that PRJ's permits. The base-case PRJ is the anchor PRJ whose `record_id` is the case number without its trailing `PRX`, or that value plus `PRJ` (Ruling B1): `2007.0946PRX` → `2007.0946`, `2018-007883PRX` → `2018-007883PRJ`;
- every `blklots` entry in the file;
- for a master whose `multiphase.json` entry has `schedule: null`, or that has no entry, every current parcel descended from the tracking `blklot` (main's ruling 3 and Ruling D1, revised, wave F2). Masters with an enriched schedule keep the four sources above.

**Descendants.** The `ProjectRecordsInput` callback `descendants(blklot): ParcelId[]` (sorted, unique, every element in `parcelIds`) follows the subdivision chain in scenario-data's `src_parcel_attrs` (`acdm-wktn`, the source `parcel_lineage` is built from). `parcel_lineage` maps each retired lot to one parcel, so it cannot list a subdivision's children.
- A retired lot X with `date_rec_drop` d yields every lot on the same block whose `date_rec_add` = d. The chain recurses into the yielded lots that are themselves retired, and collects the `mapblklot` of every active lot reached. X's `parcel_lineage.current_mapblklot` is included when it is non-null.
- An active tracking lot yields only its own `mapblklot`.
- The block is the `^\d{4}[A-Z]?` prefix of the block-lot; the lot is the remaining `\d{3}[A-Z]?`.
- A lot with no dates, or with no attrs row, yields only its lineage mapping.
- The build reads the table with one query and walks the chain in TS (sorted keys, cycle guard). Live: 3180190 (dropped 2022-12-20) yields 3180199–3180203 (added 2022-12-20); 3180204–3180214 (added 2025-07-02) come in only if a lot dropped on 2025-07-02 is itself a descendant.
- The report gives `multiphase.descendants.<caseNo>`, the number of descendant parcels, for every in-flight master. A build warning `'<caseNo>: descendant parcel <id> is held by <projectId>, which is not a DA project'` flags each descendant parcel held by an in-flight project that is not a master, holds none of the DA's pipeline rows (same `da`), is not a base-case PRJ project, and did not net this master. The flag is emitted after DA netting (Ruling B2): a master's own netting projects are DA-related by construction. The flag does not change netting.

**DA netting** (rule `pr.multiphase.da-netting`). Planning's remaining count, the PRX row's `new_pipeline_units`, already nets the DA's other **pipeline rows**, including rows with no `da` (DQ-3 identities; Balboa's 438 = 128 + 151 + 159). It cannot net projects that entered the daily records after the quarterly snapshot. So, before phasing and in master id order:
- The **netting projects** of a master are the in-flight projects that are not PRX masters, match no pipeline row, have at least one parcel among the master's DA parcels, and have not already netted an earlier master. Each netting project nets at most one master.
- R = max(0, `new_pipeline_units` − Σ `units` of its netting projects). The reduction is reported as `multiphase.netted.<caseNo>` for every master (0 when none), and a master with a reduction > 0 carries the rule id in `quality`.
- A master with R = 0 is not in flight. It is counted in `multiphase.nettedOut` and named in a build warning.
- Live: Balboa Reservoir (2018-007883PRX, 662; `schedule: null`) is expected to be netted by its two 2026-07 site permits, 202607094805 (243 units) and 202607084737 (174 units), which sit on parcels descended from its tracking lot. Treasure Island's IC4.3 (bpa 202506209120, 150 units, no `da`) is a pipeline row, so it nets nothing; TI's 745-versus-495 mismatch stays visible as the scale factor.

The **free DA parcels** are the DA parcels minus the parcels of every other in-flight project (non-master projects, and the tracking and final parcels of every other master) and of every completed history.

The remaining units R below are the netted R.

1. **Enriched** (the entry has a schedule and at least one `remaining` phase):
   - The remaining phases, in file order, become `phases`. Each phase takes `parcelIds` from its resolved `blklots`, minus parcels that are not free and minus parcels already taken by an earlier phase.
   - A phase left with no parcels is merged into the nearest earlier phase, or into the next phase if it is first. Its units and its earliest `plannedPermitFiled` go with it, and the merge is counted in `multiphase.merged`.
   - If every phase is left with no parcels, a single phase of R units on the free tracking parcels remains. If the tracking parcels are not free either, the master is a last resort (step 3; ruling L2). The §4.10.3 curation problem still fails V24 in that case, and planned-date problems are moot.
   - `plannedPermitFiled` = Day(date).
   - `source` = `{ label: schedule.label, url: facts.units.url, retrieved: facts.units.retrieved }`.
   - If Σ units ≠ R, units are scaled by R / Σ, using largest-remainder rounding with ties to the earlier phase; a phase scaled to 0 merges as above. Planning's remaining count is the tier-1 control total. The curation check uses the factor with R **before** netting: it goes in `multiphase.scale.<caseNo>`, and V24 fails outside [0.8, 1.25] (tier-4 check bound). Netting is reported separately, so a netted master does not fail the curation bound.
2. **Fallback** (no schedule):
   - **Phase size u.** u is the median `proposed_units` of the project's completed buildings (tier 0 → 2), where those are completed type 1/2 permits in the components of the base-case PRJ (as in the DA parcels above, either id form) or of pipeline rows sharing the `da`, with n ≥ 1. If there are none, u is the median `proposed_units` of all completed type 1/2 permits with ≥ 50 units and a completion day on or after 2015-01-01 (tier 2). Both are computed every build and reported as `multiphase.u.<caseNo>` with `n`. Units nulled by `pr.units.capacity` are left out.
   - **Phases** (round 4, N8 option (a)). Let P be the number of free DA parcels. Then k = min(P, max(1, round-half-up(R / u))). Units split evenly across k phases, with the first `R mod k` phases getting +1, so the units beyond P phases are spread over the existing ones.
   - **Parcels.** Sort the free DA parcels by `areaM2` descending, then by id. Phase i gets parcel i, so each phase is its own lot and no parcel draws twice. When P = 1 the row has a single phase on that parcel. timelapse-sim still staggers it after entitlement with the first-phase `phaseGap` proxy, and the disclosure names it.
   - `plannedPermitFiled` = null, because stage-calibration's `phaseGap` drives the stagger (round 3). `source` = null.
   - The report counts `multiphase.enriched`, `multiphase.fallback` and `multiphase.phases.{enriched,fallback}`, which the scoreboard and sources dialog cite.
3. **Last resort** (DQ-3): when no u exists, when P = 0, or under L2, `phases` = null and the project stays single, counted in `multiphase.lastResort`.
   - With free DA parcels, the master draws its footprint ghost on them: `parcelIds` = the free DA parcels.
   - With none, the master is **score-only**: it is simulated and counted, with no geometry. Its T3 row holds `multiPhase: true`, `phases: null`, `parcelIds: []` and therefore `existingUnits: 0`. Its `quality` includes `pr.multiphase.score-only`. It is counted in `multiphase.scoreOnly` and named in a build warning. timelapse-sim recognises it by its empty `parcelIds` and lists it in T8 `phasing.unenriched`. Empty `parcelIds` is allowed on no other project (orchestrator ruling on the DQ-3 encoding; T3).
   - Live, before reappraisal 1, 7 masters fell to last resort, and 4 of them (2006.1308PRX Schlage Lock, 2010.0305PRX Sunnydale, 2014-001272PRX Pier 70, 2018-007883PRX Balboa Reservoir; 4,668 units) shared their tracking lot with one of the DA's own phase permits. Under DQ-3 these draw only on free DA parcels, or are score-only.

For a phased master (enriched or fallback), `units` = R = Σ `phases.units`, its `history` (`entitled`) is unchanged, and `parcelIds` = the free DA parcels plus the phase parcels (the free tracking parcels when that set is empty). `existingUnits` follows §4.8.

#### 4.10.3 No double counting

A phase that is already built, or in flight as its own record, must not be counted again.
- **Planning's control total already nets pipeline rows.** Verified live on 2026-10-16 for 7 of 10 DAs that have other pipeline rows: `proposed_units − completed_new_units − new_pipeline_units` equals Σ `new_pipeline_units` of the DA's other rows exactly. Examples: Candlestick 699, Parkmerced 1,903, Pier 70 516. Re-checked on 2026-10-17 (DQ-3): Pier 70 516 = 241 + 275, Schlage Lock 556 = 152 + 146 + 258, Sunnydale 184 = 89 + 95, Balboa 438 = 128 + 151 + 159 (the 159 has no `da`). So R excludes built phases and separate rows. Projects newer than the snapshot are removed by DA netting (§4.10.2).
- **Curated phases.** Phases whose block-lots or ids match a completed history, an in-flight project, or another pipeline row with the same `da` must carry status `built` or `separate`. The build checks this: any `remaining` phase whose resolved parcels all belong to another in-flight or completed project fails V24.
- **Rendering.** Phase parcels, and a last-resort master's parcels, are disjoint from other in-flight projects (V24), so no parcel draws twice.
- **Mismatched DAs.** Treasure Island (745 vs 495), Balboa Reservoir (438 vs 279) and HPS I (628 vs 599) do not reconcile in Planning's own numbers. R is still the control total, and the gap shows only as the scale factor.

### 4.11 Data quality (T14)

This spec consumes T14 (`pipeline/lib/quality.ts`, owned by scenario-data). In its fix round it declares the entries below in its per-owner file `pipeline/lib/quality-rules/pr.ts` (T14: "Rules are declared in per-owner files `pipeline/lib/quality-rules/{sd,pr,sc}.ts` and collected into `QUALITY_RULES`"), all with `owner: 'project-records'` and `maskBit: null`. It does not edit `quality.ts` or another owner's file. Records carry rule ids in `quality` instead of mask bits (reappraisal 1, mask convention).

| id | source | field | kind | action | tier | valueTier | unitsWeighted | `of` (denominator) | shares (warn / fail) | label |
|---|---|---|---|---|---|---|---|---|---|---|
| `pr.date.valid-range` | the seven lock ids | every date field | `bound` | `null` | 4 | null | no | non-empty date values parsed | 0.01 / 0.10 | "A date outside 1970 to the snapshot day was treated as missing" |
| `pr.stories.parse-range` | `datasf-planning-projects`, `datasf-dev-pipeline` | stories parsed from `description` / `description_planning` | `bound` | `null` | 4 | null | no | stories values parsed from text | 0.01 / 0.10 | "A story count read from the project description was outside 1 to 80 and was not used" |
| `pr.stages.forward-clamp` | derived stage entry days | `entered` | `shape` | `replace` | 2 | 2 | no | histories | 0.25 / 0.50 | "A stage date earlier than the stage before it was moved up to that stage's date" |
| `pr.units.capacity` | `datasf-permits-newcon` | `proposed_units` | `outlier` | `null` | 4 | null | yes (permit `proposed_units`) | permits with recorded stories and units on a project with parcels | 0.01 / 0.10 | "A permit's unit count was more than its lot could physically hold and was not used" |
| `pr.pipeline.status-date-linked` | `datasf-dev-pipeline` | `current_status_date` | `shape` | `replace` | 2 | 0 | yes (`new_pipeline_units`) | pipeline rows | 0.01 / 0.10 | "Dates taken from the Planning record on this lot" |
| `pr.pipeline.no-status-date` | `datasf-dev-pipeline` | `current_status_date` | `shape` | `drop` | 4 | null | yes (`new_pipeline_units`) | pipeline rows | 0.01 / 0.10 | "A pipeline row with no status date and no Planning record on its lot was left out" |
| `pr.pipeline.records-win` | `datasf-dev-pipeline` | `current_status` | `observe` | `none` | 4 | null | no | population projects matching a pipeline row | 0.01 / 0.10 | "The daily permit and Planning records disagree with the quarterly pipeline; the daily records are used" |
| `pr.parcels.shared-existing` | `scenario_panel` | `existing_units` | `shape` | `replace` | 2 | 2 | no | in-flight projects | 0.25 / 0.50 | "Existing homes counted once on a shared lot" |
| `pr.multiphase.score-only` | derived master parcels | `parcelIds` | `shape` | `none` | 2 | null | yes (master R after netting) | in-flight PRX masters after netting | 0.25 / 0.50 | "Counted in the score but not drawn: no free lot in the plan area" |
| `pr.multiphase.da-netting` | `datasf-dev-pipeline` | `new_pipeline_units` (master R) | `shape` | `replace` | 2 | 2 | yes (units netted / Σ R before netting) | in-flight PRX masters before netting | 0.10 / 0.50 | "Remaining Development Agreement homes reduced by projects filed after Planning's quarterly count" |

**Kinds and default shares.** No `pr.*` rule is of `kind: 'missing'`, so the T14 default for routine missing-value imputations (`warnShare` 0.05) applies to none of them. `pr.pipeline.no-status-date` handles a missing field, but it drops the unusable row rather than imputing the value, so it is `shape` at the 0.01 default (scenario-data §4.12, "Default shares, by kind"); `pr.date.valid-range` and `pr.stories.parse-range` treat out-of-range values as missing and are `bound`. Every rule not listed under the overrides below has `warnShare` 0.01 and `failShare` 0.10.

**Share overrides** (tier-4 check bounds; approved in the design's "Share overrides approved in this reappraisal", Reappraisal 1 orchestrator rulings; the reason is stated in each rule):
- `pr.stages.forward-clamp`: a declared normalisation of cross-record dates, which are routinely out of order. On the 2026-10-16 smoke lock it moved 1,697 stage days across 10,212 histories (at most 16.6% of histories), above the 0.10 default.
- `pr.parcels.shared-existing`: an allocation, not an error rate. Live, 81 of 438 in-flight projects (18.5%) share a parcel.
- `pr.multiphase.da-netting`: about 17 in-flight masters live, so one firing is about 6% and two would pass the default fail share. Netting is expected wherever a DA has post-snapshot permits.
- `pr.multiphase.score-only`: the same small denominator; live, up to 4 of about 17 masters could be score-only (the 4 overlaps of DQ-3), about 24%.
- `pr.pipeline.status-date-linked` keeps the defaults. Live it fires on 2 of 1,917 rows; by units (6,069 of the pipeline's new units) it is expected to warn, which surfaces DQ-2 in every build.

**Counting.** Every build reports every rule, zeros included. `fired` and `of` follow the table; for unit-weighted rules `units` is the units of the affected rows or permits and `unitsOf` the units of the denominator. `deriveProjects` calls T14's `recordQuality(counts, id, { fired, of, units?, unitsOf?, sample })` once per rule, with `units`/`unitsOf` for unit-weighted rules and `sample` = the sorted ids of the affected records. `recordQuality` is the only writer of `quality.<id>.fired`, `.of`, `.units` and `.unitsOf` in `report.json` and of the rule's row (with its top 25 records) in `quality-report.md`; this spec writes no `quality.*` key itself. These counts replace the report keys `histories.clamped.*` and `projects.pipelineConflicts`.

**On records.** A T3 project or T4d history carries a rule id in `quality` when the rule changed or estimated one of its values, as stated at each rule (§4.1, §4.2 step 10, §4.5, §4.8, §4.10.2). Rules that drop a record are never carried. Observation rules (`action: 'none'`) are not carried, with one exception: `pr.multiphase.score-only` writes no source value but changes how the record is shown (no geometry), so the score-only master carries it and fzp-mode can say why it is not drawn. `projects.json` `qualityRules` lists every carried id, with the registry's generic `label`, `tier` and `valueTier` (§4.9 Outputs), so fzp-mode can show the labels without the registry (T6 `ProjectCard.quality`).

**In-frame rules (DQ-4).** A later operator may add a `pr.*` rule without a ruling only under DQ-4's conditions, and lists it in the completion report as a "registered rule". Anything else escalates.

## 5. Seams

- **T9 policy levers.** `projects.json` is plain JSON. No other change.
- **Addenda.** Permit numbers stay in `sources`, so `87xy-gk8d` can join later. No addenda are fetched.
- **DA phasing.** This spec delivers it as T3 `phases` (§4.10), as round 3 now requires. The phases' own stage sampling is timelapse-sim's job, and `phaseGap` is stage-calibration's.
- **Renderings.** PRJ and permit ids in `sources` are the future join key.
- **Data quality.** New project-records rules join `QUALITY_RULES` and the `quality` lists without any interface change (DQ-4).

## 6. Testing

All in `npm run test:pipeline`, except the validator tests, which run in the Vitest server project. Every test calls `expect`.

- **`fetch.test.ts`**:
  - a `format: 'json'` entry pages and counts array rows;
  - URLs carry the §4.1 `$select`/`$where`;
  - an exactly-full page followed by an empty page does not lock the empty one.
- **`src/lib/timelapse/projects.test.ts`** (validator, IA-5):
  - without `onInvalid`, the first violation throws, file-level or project-level;
  - with `onInvalid`, one invalid project is reported once with its path and left out, the rest are returned, and the input is not mutated;
  - with `onInvalid`, a file-level violation (bad `schema`, unsorted `qualityRules`, a listed rule no project uses) still throws;
  - a duplicate id: the later project is the invalid one;
  - `quality` unsorted, duplicated, or naming an id absent from `qualityRules` is invalid;
  - a score-only master (`multiPhase`, `phases` null, `parcelIds` []) passes; empty `parcelIds` on any other project fails.
- **`project-records/parse.test.ts`**:
  - Day from floating timestamps;
  - clipping of 1909, 2205 and post-`asOf` dates, and the `pr.date.valid-range` tally (`fired`, `of`) and record attribution;
  - `building_permits` splitting;
  - `CFc` matching.
- **`project-records/link.test.ts`**:
  - a permit is assigned to the latest PRJ opened before filing;
  - a satellite adds no dates;
  - a PPA links by `parent_id`, and by block/lot inside `ppaLag`;
  - a two-row component splits;
  - all five id forms;
  - superseded refiles;
  - a PRX row whose `bpa_no` names a fetched permit joins the graph (F1);
  - **DQ-2:** a no-date row joins the open PRJ on its lot; a child's block/lot qualifies; the latest-opened PRJ wins and ties go to the smallest id; a PRJ whose project ended is not a candidate; a candidate whose project already holds a pipeline row is skipped, and the row drops only when no candidate qualifies (there is none, or every one holds a row); the linked project keeps its id, dates and units (not the row's); a no-units winner counts `projects.excludedNoUnits` and is named; both rule tallies.
- **`project-records/parcels.test.ts`**:
  - condo `blklot` → `mapblklot`;
  - a retired lot maps via lineage;
  - ids outside the parcel set are dropped.
- **`project-records/classify.test.ts`**:
  - each streamlined flag and regex term, including AB 2162;
  - the "not eligible for SB 423" negation;
  - ADU "Local Program" text is not streamlined;
  - referral → `permitOnly`;
  - no evidence and no permit → `null`, and T3 `discretionary`;
  - population excludes an alteration row and a net-zero replacement.
- **`project-records/stages.test.ts`**:
  - one case per §4.5 row;
  - the PPA-umbrella exception;
  - a parallel permit stays at `filed`;
  - the forward clamp, the `pr.stages.forward-clamp` tally (histories with ≥ 1 clamp over `histories.total`) and the id on the clamped record;
  - completion from first TCO, then the `completed_date` fallback;
  - multi-permit completion is the max, and absent while any permit is open.
- **`project-records/ends.test.ts`**:
  - each reason mapping;
  - a live permit beats a PRJ withdrawal;
  - complete beats a later cancel;
  - closed without a decision → `withdrawn` at `close_date`, but a closed PRJ with approval stays open;
  - PPA-only before and after `ppaLag`;
  - exit-stage clamping: an exit dated before a later entered stage moves to that last stage at its entry day (L1).
- **`project-records/inflight.test.ts`**:
  - pipeline match (including a DQ-2 linked row), the after-cutoff window, stale-open, and the `pr.pipeline.records-win` tally (no record carries it);
  - `sources[].key` per dataset (absent for `record_id`; `'case_no'` for PRX/PRJ pipeline ids);
  - label precedence;
  - assessor `existingUnits`;
  - **shared parcels:** the earliest-entered project holds the parcel's units and the other gets 0; ties go to the smallest id; every project on a shared parcel with units > 0 carries the id; a shared parcel with 0 units marks nobody; histories keep their at-filing value; the in-flight net test uses the unallocated value;
  - **capacity:** a permit above lot area × max(stories, 1) / 10 has missing units, and units fall through to the PRJ; no check without recorded stories or without parcels; `unitsAt.permitFiled` and `permits.parquet` `proposed_units` follow; the tally is unit-weighted;
  - stories precedence and `storiesTier`; the regex skips "existing two-story"; the feet fallback; a parsed 120 is discarded with `pr.stories.parse-range`;
  - `multiPhase`;
  - `quality` is sorted and de-duplicated, and `qualityRules` is exactly the ids used, with registry labels, tiers and value tiers.
- **`project-records/multiphase.test.ts`**:
  - schema parse accepts the mini file and rejects a fact without `url` or `retrieved`;
  - an entry whose `caseNo` is not in the pipeline fails;
  - `schedule: null` without `searched` fails;
  - enriched phases in file order, with the `built` and `separate` phases excluded;
  - largest-remainder scaling, with the factor (R before netting) reported and V24 failing at 0.79 and 1.26;
  - fallback u from the project median, then the citywide ≥ 50-unit median since 2015;
  - k with round-half-up, capped at P; the even split; largest-first, one parcel per phase; P = 1 gives a single phase;
  - an enriched phase with no parcels left merges into the earlier phase;
  - every enriched phase parcel-less and the tracking parcel held → last resort (L2);
  - **DA netting:** a non-pipeline in-flight project on a DA parcel reduces R; a project matching any pipeline row does not; one project nets only the first master in id order; R floors at 0 and a netted-out master is not in flight (`multiphase.nettedOut`); `multiphase.netted.<caseNo>` and the tally;
  - **last resort (DQ-3):** with free DA parcels, `parcelIds` are exactly those; with none, the master is score-only (`parcelIds` [], `existingUnits` 0, `quality` includes `pr.multiphase.score-only`, `multiphase.scoreOnly` and the rule tally);
  - phase parcels and last-resort parcels disjoint from other in-flight projects;
  - Σ `phases.units` = `units`.
- **`project-records/quality.test.ts`**:
  - every `pr.*` id named in this spec has a `QUALITY_RULES` entry with owner `project-records`, `maskBit` null, and the kind, action, tiers, `unitsWeighted` and shares of §4.11, and no other `pr.*` entry exists;
  - every label is generic: it contains no record id pattern (permit number, `PRJ`, `PRX`, block-lot);
  - `deriveProjects` calls `recordQuality` once for every `pr.*` rule, zeros included, with `sample` sorted, and writes no `quality.*` key directly;
  - the report carries `quality.<id>.fired` and `.of` (and `.units`/`.unitsOf` for unit-weighted rules) for every `pr.*` rule, and no `histories.clamped.*` or `projects.pipelineConflicts` key.
- **`project-records/rhna.test.ts`**:
  - inclusive window bounds;
  - demolitions are negative;
  - V22 at the ±5% and ±10% edges, and failing with no cross-check year.
- **Golden** (`golden.test.ts`): `fixture-0` `scenarios/fzp/projects.json` and `golden/derived/project-histories.json` match byte for byte, and `golden/derived/permits.json` matches by row values, with the per-project values in §4.9. The report-count assertions of the fixture: `quality.pr.units.capacity.fired` = 1 (M15), `quality.pr.pipeline.status-date-linked.fired` = 2 (M16, M17), `quality.pr.pipeline.no-status-date.fired` = 1 (M18), `quality.pr.parcels.shared-existing.fired` = 2 (M10, M19), `quality.pr.multiphase.da-netting.fired` = 1 (M20), `quality.pr.multiphase.score-only.fired` = 1 (M20), `quality.pr.stages.forward-clamp.fired` ≥ 2 (M1, M10), `quality.pr.date.valid-range.fired` ≥ 1 (M1's 1909 date), `quality.pr.stories.parse-range.fired` = 0 and `quality.pr.pipeline.records-win.fired` as computed; `projects.excludedNoUnits` = 900; `multiphase.netted.2012-000020PRX` = 3; `multiphase.lastResort` = 1 and `multiphase.scoreOnly` = 1. Values marked "≥" or "as computed" are golden computed at implementation.
- **Invariants**: V20–V24 each fail on a hand-broken copy of the fixture and pass on the real fixture. V24 also fails when a drawing last-resort master shares a parcel with another in-flight project, and when a score-only master has a free DA parcel.
- **Property**: permuting input row order leaves the output byte-identical.
- **Live, opt-in** (the `live-raw.test.ts` pattern, skipped without `pipeline/.cache`):
  - V21 ≥ 0.90;
  - V22;
  - in-flight units in [40k, 100k]. This is a sanity band around the 2026-Q2 pipeline total of 75,853, which includes alterations (tier 1, Planning pipeline report);
  - Freedom West in flight as `PRJ:2020-006887PRJ` at `filed` 2020-07-24 with 2,387 units; Flower Mart counted in `projects.excludedNoUnits` and named;
  - no T14 rule above its `failShare` (V30, scenario-data's invariant, on this spec's rules).

No browser, e2e or axe tests apply. `timelapse-sim` and `fzp-mode` e2e exercise `projects.json` from `fixture-0`.

## 7. Acceptance criteria

1. `fetch` writes seven new lock entries with the §4.1 URLs and licences, and `fetch --restore` restores them.
2. `build` writes `out/<v>/scenarios/fzp/projects.json`. It matches T3 exactly, including `quality` and `qualityRules`, and passes V20–V24; the build exits 1 on any failure.
3. `pipeline/.cache/derived/<v>/project-histories.json` matches the T4d file layout, including `quality`, and `permits.parquet` has the T4d columns.
4. `fixture` reproduces the goldens, with these values:
   - In flight: M1, M2, M3, M8, M9, M10, M11, M12, M14, M15, M16, M19 and M20. Together they cover every non-complete stage.
   - Histories only: M4–M7, M13 and `PRJ:2010.0002`.
   - Neither: M17 (no units) and M18 (dropped).
   - `rhnaCompletedNet.units` = 4.
5. No in-flight project ends complete or exit at `asOf`, and none is stale-open.
6. `rhnaCompletedNet.since` = Day(2022-06-30), with tier-0 provenance, both sources and the window.
7. `report.json` carries these counts:
   - `projects.inFlight` and `projects.inFlightUnits`;
   - `projects.byPathway.*`, `projects.byStage.*` and `projects.status.*`;
   - `projects.staleOpen` and `projects.staleOpenUnits`;
   - `projects.pathwayDefaulted`, `projects.excludedAlterationUnits` and `projects.excludedNoUnits`;
   - `projects.stories.{tier0,tier3,null}`;
   - `projects.parcels.{mapped,unmapped}`;
   - `histories.total` and `histories.ppaLagDays`;
   - `multiphase.{enriched,fallback,lastResort,scoreOnly,nettedOut,merged}`, `multiphase.phases.{enriched,fallback}`, `multiphase.u.<caseNo>`, `multiphase.scale.<caseNo>` and `multiphase.netted.<caseNo>`;
   - `rhna.units`, `rhna.crossCheck.<year>` and `rhna.xdhtLagDays`;
   - `params.ppaUmbrellaDays` (7) and `params.referralToleranceDays` (30), both labelled tier 4;
   - `quality.<id>.fired` and `.of` (and `.units`, `.unitsOf` when unit-weighted) for every `pr.*` rule of §4.11, and `quality-report.md` has a row for each.
8. Two builds from the same lock and code give byte-identical `projects.json`.
9. Every `sources` entry follows the §4.8 `key` table.
10. `docs/dev/pipeline.md` lists V20–V24, the seven new lock sources and `pipeline/enrichment/multiphase.json`, with how to curate it, and states DQ-2 linking, DA netting and score-only masters. The "Data quality" section, generated by scenario-data from the registry, includes every `pr.*` rule.
11. **Curation (implementation task).** `pipeline/enrichment/multiphase.json` has an entry for every PRX row with `new_pipeline_units ≥ 1` in the pinned pipeline.
    - Each entry either cites the DA's published phasing schedule, with a URL, retrieval date and locator for every units, block-lot and date fact, or records `schedule: null` with the URLs searched.
    - At a minimum, Candlestick / HPS II, Treasure Island and Parkmerced are enriched.
    - V24 passes live, and the report's `multiphase.enriched`, `multiphase.fallback`, `multiphase.lastResort` and `multiphase.scoreOnly` counts and each `multiphase.netted.<caseNo>` > 0 are stated in the PR.
12. In the fixture, M9 is enriched (2 phases, 120 + 180). M14 is fallback with 1 phase of 100 on [3512009], because k is capped at P = 1. M20 is a netted, score-only last resort.
13. `parseProjectsFile` with `onInvalid` skips an invalid project and reports it; without it, it throws (V20).
14. Live: Freedom West is in flight from its Planning record, Flower Mart is excluded and named, and no `pr.*` rule exceeds its `failShare`.

## 8. Open questions

None remain. The reconciliation answered all four: RHNA `since` (T3: 2022-06-30), the PPA-only pathway (`discretionary`), single-unit construction (net ≥ 1), and AB 2162 (`streamlined`). Reappraisal 1 answered the record's items: pre-2007 histories (DQ-1), no-date pipeline rows (DQ-2), last-resort masters on held lots (DQ-3), shared parcels and DA netting (orchestrator rulings).

## Interface concerns

**Resolved by the reconciliation:**
1. `permitOnly` never enters `filed`. Resolved by T2, which this spec follows.
2. Unique ids. Resolved by the T3 prefixed ids ("Ids and labels").
3. Address for cards. Resolved by T3 `label`.
4. Multi-phase rows. Resolved by T3 `multiPhase` and "Multi-phase projects".
5. `baseStoriesAtFiling`. Resolved by T4d's tier-3 note ("Pre-FZP heights"), with the value read from `scenario_panel` (round 2, "Table names").
6. `unitsAt` semantics. Resolved by the T4d comment ("cross-record, not snapshots").
7. Per-project stories tier. Resolved by T3 `storiesTier`.
8. Invariant ids. Resolved as V20–V24 ("Pipeline housekeeping").
9. Histories file layout and path. Resolved by T4d and "Derived caches go under `pipeline/.cache/derived/<datasetVersion>/`".
10. `rhnaCompletedNet` scope. Resolved in round 2: the value is the Housing Inventory net, with alterations included (§4.9).
11. Lineage table name. Resolved in round 2 ("Table names"): `parcel-lineage.parquet`, per T13.
12. Validator granularity (IA-5). Resolved by T3's `onInvalid`.
13. `existingUnits` overlap across projects (IA-10). Resolved by the shared-parcel rule in T3.
14. `permits.parquet` contract (IA-18). Resolved by T4d.
15. Score-only encoding (DQ-3). Resolved by the orchestrator's ruling, now in the T3 row: `parcelIds: []` only when `multiPhase` is true and `phases` is null, with `pr.multiphase.score-only` in `quality`. This replaces the IC-PR1 draft.
16. T14 reporting API (IC-PR2). Resolved by the orchestrator: T14 exports `recordQuality(counts, id, { fired, of, units?, unitsOf?, sample? })`, the only writer of `quality.*` keys and `quality-report.md` rows; this spec calls it (§2, §4.11).

## Interface concerns (reappraisal 1)

None open. IC-PR1 (score-only encoding) and IC-PR2 (T14 reporting API) are resolved by orchestrator rulings: see items 15 and 16 above.

## Reappraisal 1 changes

- Status line updated to Reappraisal 1.
- §2: rows T1, T2, T3, T4, T4d, T11 and T13 re-copied verbatim from the current design; T14 added (consumed). Internal types: `ProjectRecordsInput` gains `areaM2` and `multiphase` (ruling P1), `deriveProjects` returns `permits` and `checks` and reports rules through `recordQuality`. (T14 orchestrator ruling; IA-18; IA-19.)
- §3: global constraints re-copied, with the new "Data quality" bullet. (Reappraisal 1.)
- §1, §4.9 delivery order: the step-0 type edits to `src/lib/timelapse/projects.ts` (`quality`, `qualityRules` with `valueTier`, `onInvalid`) and to the T4d type in `src/lib/timelapse/types.ts` (`quality`) are this spec's fix round (wave F2), after scenario-data's T14 module merges. (Fix-round order; IA-5.)
- §4 preamble, §4.11 (new): the ten `pr.*` T14 rules with full registry entries, generic labels, share overrides with reasons, counting, record attribution and `qualityRules`. `histories.clamped.*` and `projects.pipelineConflicts` become `quality.pr.stages.forward-clamp.*` and `quality.pr.pipeline.records-win.*`. (T14; "project-records rules" table; "Quality on records"; coordinator note on `qualityRules` `valueTier` and generic labels; DQ-4.)
- §4.1: `pr.date.valid-range`. §4.5: `pr.stages.forward-clamp`; raw filing days are read from `permits.parquet` (IA-11). §4.7: `pr.pipeline.records-win` defined. §4.8: `pr.stories.parse-range`. (project-records rules table.)
- §4.2 step 10, §4.5, §4.7, §4.8: DQ-2 linking of no-date pipeline rows to the open PRJ on the lot (latest-opened, ties smallest id), PRJ dates and §4.8 units rules 1–2 only, `projects.excludedNoUnits` with the row named, `pr.pipeline.status-date-linked` and `pr.pipeline.no-status-date`; Freedom West and Flower Mart live expectations. (DQ-2.)
- §4.8: `pr.units.capacity` with `MIN_GROSS_M2_PER_UNIT` from T14, fall-through of units, effect on `unitsAt`, medians and `permits.parquet`. (project-records rules table.)
- §4.8: shared-parcel `existingUnits` (earliest-entered holder, ties smallest id; histories unchanged), `pr.parcels.shared-existing`. (Shared parcels ruling; IA-10.)
- §4.10.2: DA netting before phasing (non-pipeline in-flight projects on DA parcels, floor 0, `multiphase.netted.<caseNo>`, R = 0 not in flight, `multiphase.nettedOut`), with the scale bound on R before netting; `pr.multiphase.da-netting`. (DA netting ruling.)
- §4.10.2 step 3, §4.7, §4.11, V20, V24: last-resort masters draw only on free DA parcels; score-only otherwise (`parcelIds` [], `quality` `pr.multiphase.score-only`, registered as a T14 rule, `multiphase.scoreOnly`); V20 and `parseProjectsFile` (the step-0 validator edit at `projects.ts:201`) accept empty `parcelIds` only there; V24 disjointness extended to last-resort masters. (DQ-3; orchestrator ruling on the encoding.)
- §4.3: DQ-1 stated: T4d `existingUnits` unchanged, the 2007 clamp kept; the window moves in stage-calibration. (DQ-1; IA-12.)
- §4.9: `parseProjectsFile` `onInvalid` semantics and file-level versus project-level checks; V20 and V23 gain the `quality`/`qualityRules` checks; V21 states how masters and linked rows count. (IA-5; Quality on records.)
- §4.9, AC-3: `permits.parquet` named as a T4d contract, `proposed_units` post-rule. (IA-18; IA-11.)
- Fixture: M15 (capacity), M16 (DQ-2 linked), M17 (DQ-2 no units), M18 (no status date), M19 (shared parcel), M20 (DA netting and score-only master) added, with qualitative expectations and goldens computed at implementation; new report-count assertions in §6 Golden. (Brief item 7; spec-fixture-slip ruling.)
- Doc debt (defect record 1, project-records list; ruling A13): M12 has 24 units (existing 12); M1's existing units are 3; M3's are 1; M9's are 43 (lot 14's 40 plus phase-B lot 2's 3, per the as-built golden and COMPLETION.md Task 11; the defect record's "40" is lot 14 alone); the fixture lot-units list is corrected to the scenario-data roll.
- Doc debt, ruling L1: §4.6 now says the exit stage is the last entered stage, at no earlier than its entry day (21 live zero-duration exits); V23 states it.
- Doc debt, COMPLETION.md rulings: P1 (`multiphase` and `areaM2` in the input), P3 (`derivedRoot`, DuckDB tables `parcel_lineage` and `scenario_panel`), L2 (all-parcel-less enriched master with a held tracking parcel → last resort), F1 (a PRX row whose `bpa_no` names a fetched permit joins the graph), Task 5 (pathway-agnostic filing-evidence day for PPA attachment), Task 7 (the unit-bearing set for units, stories and `unitsAt.permitFiled`) and Task 9 (V22 fails with no cross-check year). P2 (exported names) is an internal rename and needs no spec text.
- §2, §4.11, §6: the assumed tally hand-off is replaced by calls to T14's `recordQuality` (sample = sorted affected record ids); T14 re-copied verbatim; share overrides cite the design's approval. (Orchestrator rulings on IC-PR2 and share overrides.)
- Live figures refreshed from COMPLETION.md where they changed: `ppaLag` 358 (n 581), stale-open 490 / 27,158, excluded alteration units 4,860, V21 0.9175, curation 5 enriched / 16 schedule null.
- Residue removed: `histories.clamped.*`, `projects.pipelineConflicts`, "parcelIds (the DA parcels) are unchanged", and the M1–M14 fixture values superseded by the as-built goldens.
- Fidelity pass 3 (2026-10-17): `pr.pipeline.no-status-date` is `shape`, not `missing` (a drop, not an imputation), and no `pr.*` rule takes the `missing` default (F3-2); the fixture lot table gives lot 3 → 4 and M15 existing 4, with M16's at-filing value stated, following scenario-data's goldens (F3-8); M15 is `PRJ:2025-000015PRJ` (an anchor referral, as M8), and `qualityRules` is stated to cover in-flight ids only (F3-12); rules are declared in `pipeline/lib/quality-rules/pr.ts` (F3-13).
- Wave F2 rulings (2026-10-18): §4.2 step 10, the DQ-2 winner is chosen only among candidates whose project holds no pipeline row, and a row whose every candidate holds one is dropped with its own warning (main's ruling 2). §4.10.2, a schedule-null or uncurated master's DA parcels add the current parcels descended from its tracking lot through the `src_parcel_attrs` subdivision chain, served by the new input callback `descendants`; the report adds `multiphase.descendants.<caseNo>` and a warning for a descendant parcel held by a non-DA project (main's ruling 3; Ruling D1, revised). §4.11, `pr.multiphase.score-only` is tier 2, as in the design (main's ruling 5; Ruling Q1 overturned). V21, rows dropped under `pr.pipeline.no-status-date` leave V21 (Ruling V1).
