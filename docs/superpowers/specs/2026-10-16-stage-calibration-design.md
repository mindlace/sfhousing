# stage-calibration: design spec

Status: derived 2026-10-16 from [the FZP timelapse composition design](../design/2026-10-16-1903-fzp-timelapse.md). Updated the same day to its "Interface reconciliation" section. Revised 2026-10-17 to the design's Reappraisal 1 (DQ-1..DQ-4, IA-1..IA-28). Research inputs: [literature survey](../research/2026-10-16-fzp-calibration-literature.md) and [dataset probe](../research/2026-10-16-sf-stage-datasets.md). Slug `stage-calibration`.
- **Owns:** T1, T2, T4, T4a, T4b, T4c, T12, and the `sc.*` rules in the T14 registry (§4.4a).
- **Consumes:** T3 (`asOf`, `pathway`), T4d and `permits.parquet` (project-records), T11, T13 and T14 (scenario-data).
- **Implementation state.** Only the step-0 declarations exist (`src/lib/timelapse/time.ts`, `math.ts`, `types.ts`, and `model.ts` with stub bodies). Everything else here is step 2.

## 1. Scope

From the design:

> **`stage-calibration`** (data pipeline). Builds `scenarios/fzp/calibration.json` from the histories:
> - competing-risks transition tables per pathway and stage, with censoring;
> - the **initiation model**: a discrete-time hazard that a parcel with no project files one in a given month. It is fitted to SF parcel-years using pre-FZP envelopes and features, then applied with FZP envelopes (tier 2);
> - the **size model**: what fraction of the allowed envelope a project proposes, measured from proposed stories against allowed height (tier 0→2);
> - the **revision model**: the chance, timing and magnitude of a change in unit count, measured by comparing the PRJ proposal, the permit's `proposed_units` and the completed units of linked records (tier 0→2).
> Every parameter carries its provenance (T4). **Fitting window (partner ruling OD-T3):** the longest window available across the majority of stages, with no weighting toward recent years. For each stage, take the earliest year with reliable tier-0 coverage. The common window starts at the latest of those years that still keeps a majority of stages fully covered, and ends at the snapshot. A stage whose coverage starts later uses its own span, and its provenance says so. Initiation is fitted over all available parcel-years with no calendar-year term (a measurement-basis term for pre-2015 permit-filing events is allowed: see round-3 addenda).

**In scope**
- **Step 0** (round 2: "a step 0 lands the shared types and time modules"). Four files land first, before any other subsystem's code (round 4 N5 adds the `model.ts` stubs; project-records lands `src/lib/timelapse/projects.ts` with the T3 types in the same step):
  - **`src/lib/timelapse/time.ts` (T1).** `Day`, `MONTH_DAYS`, `monthsIn`, `OPEN_DAY = Math.fround(3.0e38)` (ruling A1), and `DYING_DAYS = 270` (display only, tier 4, read by timelapse-render's uniforms and timelapse-sim's card visibility).
  - **`src/lib/timelapse/math.ts` (T12).** Deterministic fdlibm ports of `exp` and `log`. Step 0 landed the full bodies and the golden test; step 2 makes the licence notice survive minification and credits fdlibm (§4.1a, ruling A5).
  - **`src/lib/timelapse/types.ts`.**
    - The T2 types and constants: `Stage`, `Pathway`, `ExitReason`, `STAGE_ORDER`, `PATHWAYS`, `EXIT_ORDER`, `pathwayStages`.
    - The T4 types `Provenance`, `Transition`, `Calibration`; the T4a types `FeatureId`, `InitiationModel`; T4b `SizeModel`; T4c `RevisionModel`; T4d `ProjectHistory`.
  - **`src/lib/timelapse/model.ts` stubs.** Every T12 export of the step-0 row (`sampleTransition`, `initiationHazard`, `chanceTable`, `typicalMonths`, `parseCalibration`) with its exact T12 signature, each throwing `new Error('not implemented')`. Consumers compile against it from day one, and step 2 replaces the bodies.
- **`src/lib/timelapse/model.ts` (T12, full implementation, step 2)**, which imports `types.ts`, `time.ts` and `math.ts`. It is pure, zod-free and worker-safe. It exports `sampleTransition`, `initiationHazard`, `chanceTable`, `typicalMonths`, `parseCalibration` and `cumulativeIncidence`, plus the helpers `binIndex` and `eventualProbabilities`. `cumulativeIncidence` is new in the amended T12 row (IA-13) and has no step-0 stub: step 2 adds it with its row signature.
- **`src/lib/attribution.ts`.** Step 2 adds fdlibm to `SOFTWARE` (ruling A5).

  `src/lib/timelapse` is in the dataset-version hash (T11).
- **The pipeline step `pipeline/steps/calibration.ts`** and its libraries under `pipeline/lib/fzp-cal/`: window, spells, Aalen–Johansen, tails, fallbacks, initiation panel and IRLS, size, revision, pathway mix, provenance and the report writer.
- **The `sc.*` entries of the T14 registry** in `pipeline/lib/quality.ts` (§4.4a). scenario-data owns and ships the module and V30; this subsystem declares its own rules in the per-owner file `pipeline/lib/quality-rules/sc.ts` (T14), which `quality.ts` collects into `QUALITY_RULES`, with `owner: 'stage-calibration'`, and reports their counts.
- **Outputs:**
  - `out/<v>/scenarios/fzp/calibration.json` (shipped);
  - `pipeline/.cache/derived/<datasetVersion>/calibration-report.md`, a build artifact that is **not uploaded or linked** (reconciliation, "Page");
  - invariants V25–V29, `report.json` counts (including `quality.sc.*`) and the fixture calibration;
  - the `docs/dev/pipeline.md` update for V25–V29 (round 2; text in §4.10).

**Out of scope**
- Histories, `projects.json`, `parcels.bin`, the T13 panel, `parcel-lineage.parquet` and the manifest entry (project-records, scenario-data). Lineage is not read here: T4d `parcelIds` are already current mapblklots.
- `simulate`, clamping sampled days to the snapshot, applying revisions and caps, and the pathway rule for Local Program parcels (timelapse-sim).
- Rendering and UI.
- The T14 module itself, V30, `quality-report.md` and the generated "Data quality" section of `docs/dev/pipeline.md` (scenario-data). This subsystem only registers and counts its `sc.*` rules.
- The ESLint scope edit that adds `src/lib/sim/scenario/**` to the determinism rule (T12): timelapse-sim makes it (ruling A3, IA-7).
- Policy levers and addenda sub-stages (§5). DA phasing **is** in scope (design "Out of scope", round 3). This subsystem's part is `phaseGap` (§4.7a). The phase split itself belongs to project-records and timelapse-sim.
- Any runtime fitting.

## 2. Interfaces

Verbatim rows this subsystem owns (T1, T2, T4, T4a, T4b, T4c, T12) or consumes (T3, T4d, T11, T13, T14):

| # | interface | owner → consumers | mark |
|---|---|---|---|
| T1 | `type Day = number` is integer days since 1970-01-01 UTC. All schedule times use it. It is exact in Float32. `MONTH_DAYS = 30.436875` (365.2425 / 12). `monthsIn(enteredDay, day) = floor((day − enteredDay) / MONTH_DAYS)` is the single months-in-stage rule, used by every table index (T4, T12, the bar, the card). `OPEN_DAY = Math.fround(3.0e38)` encodes an open-ended window end (exact in Float32; consumers compare with the exported constant, never a literal: A1). `DYING_DAYS = 270` is the display window of a death (90 days red, then a 180-day fade; tier 4), read by timelapse-render's uniforms and by timelapse-sim's card visibility. These live in `src/lib/timelapse/time.ts` | stage-calibration → all | DC |
| T2 | `type Stage = 'preApplication' \| 'filed' \| 'entitled' \| 'permitFiled' \| 'permitIssued' \| 'construction' \| 'complete'`; `type Pathway = 'discretionary' \| 'streamlined' \| 'permitOnly'`; `type ExitReason = 'withdrawn' \| 'disapproved' \| 'cancelled' \| 'expired'`. `STAGE_ORDER` lists the stages in this order. `preApplication` is optional on every pathway. `permitOnly` projects never enter `filed` or `entitled`. A ghost is visible from the project's first entered stage | stage-calibration → project-records, timelapse-sim, timelapse-render, fzp-mode | MC (stage sequence and exits follow real records), DC (names) |
| T3 | `interface InFlightProject { id: string /* 'PRJ:<record_id>', 'BP:<permit>', 'PRJ:<record_id>:BP:<permit>' for split pipeline rows, 'CASE:<case_no>' for PRX rows, 'PPA:<record_id>' for PPA-only; unique */; label: string \| null /* street address from the records, if any */; parcelIds: ParcelId[] /* current mapblklot, mapped through retired-parcel lineage; [] only for a score-only last-resort master (multiPhase, phases null, quality includes 'pr.multiphase.score-only'): no free DA parcel (DQ-3) */; pathway: Pathway; stage: Stage; history: Partial<Record<Stage, Day>> /* observed entry days */; units: number; existingUnits: number; stories: number \| null; storiesTier: 0 \| 3 \| null /* 0 = recorded field, 3 = parsed from description text */; multiPhase: boolean /* PRX/DA remaining-phase row */; phases: { units: number; parcelIds: ParcelId[]; plannedPermitFiled: Day \| null /* from the DA phasing schedule, if enriched */; source: { label: string; url: string; retrieved: string } \| null }[] \| null /* multi-phase only: null until enriched, then each phase is simulated as its own sub-project */; sources: { dataset: string; id: string; key?: string /* field to query, e.g. 'case_no'; absent = the dataset's record-id field */ }[]; quality: string[] /* sorted T14 rule ids that changed or estimated a value of this project; [] if none */ }`. `existingUnits` counts each parcel's assessor units once across in-flight projects (rule `pr.parcels.shared-existing`). `scenarios/fzp/projects.json` = `{ schema: 1; asOf: Day; rhnaCompletedNet: { units: number /* net units added since `since` up to `asOf`, Housing Inventory definition: completions plus alteration gains, minus demolitions and alteration losses */; since: Day /* 2022-06-30, RHNA projection period start */; provenance: Provenance }; qualityRules: { id: string; label: string /* generic, about the rule, never naming a record */; tier: 2 \| 3 \| 4 /* of the rule */; valueTier: 0 \| 1 \| 2 \| 3 \| 4 \| null /* of the value it writes; null if it writes none */ }[] /* every id used in any project's quality, sorted by id */; projects: InFlightProject[] }`. Projects are new construction only (alterations adding units are out of scope). The shared validator is `parseProjectsFile(json, opts?: { asOf?; parcelIds?; onInvalid?: (path: string, message: string) => void })` in `src/lib/timelapse/projects.ts`: without `onInvalid` it throws at the first violation (V20); with it, an invalid project is reported and left out of the returned file, and a file-level violation still throws | project-records → timelapse-sim, fzp-mode, stage-calibration (`asOf`, pathway mix) | MC (real pipeline is the starting state), DC (shape) |
| T4 | `interface Provenance { tier: 0 \| 1 \| 2 \| 3 \| 4; label: string; sources: { label: string; url: string }[]; method: string; n?: number; window?: [from: string, to: string] }`. `interface Transition { months: number; advance: number[] /* cumulative incidence by month 1..months */; exit: Partial<Record<ExitReason, number[]>>; tail: { advance: number; exit: Partial<Record<ExitReason, number>> } /* constant monthly hazards beyond months */; provenance: Provenance; tailProvenance: Provenance /* tier 2: extrapolation beyond the observed months */ }`. `scenarios/fzp/calibration.json` = `{ schema: 1; asOf: Day; transitions: Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Transition>>>; initiation: InitiationModel; pathwayForNew: Record<Pathway, number> & { provenance: Provenance }; size: SizeModel; revision: RevisionModel; streamlinedForLocalProgram: Provenance /* tier 2: Local Program projects use the streamlined tables */; phaseGap: { days: number[] /* empirical gaps between successive phases' permitFiled */; provenance: Provenance } }`. The calibration also carries `ppaShare: Record<Pathway, number> & { provenance: Provenance }`, the share of new projects that start at `preApplication`. `InitiationModel`, `SizeModel` and `RevisionModel` are rows T4a–c. Everything is plain JSON, so future policy levers can transform it (the T9 seam). **Sampling semantics:** a project entering stage *s* at day *d* draws one uniform. The month of advance or exit comes from the cumulative tables (`advance` + Σ`exit` ≤ 1 at every month), with the tail hazards beyond `months`. An in-flight project already *m* months into *s* draws conditionally on having survived *m* months. Day within the month is uniform | stage-calibration → timelapse-sim, fzp-mode | MC (every parameter carries tier + source), DC (encoding) |
| T4a | `type FeatureId = 'potentialRatio' /* yield units at full envelope ÷ max(existingUnits, 1); base variant uses the density-capped base yield (T13), FZP variant the Local Program yield (T11) — this is how density decontrol is seen */ \| 'existingUnits' \| 'lotAreaM2' \| 'yearBuilt' \| 'storiesGap' /* envelope stories − existing stories */ \| 'improvementShare' /* improvement ÷ (land + improvement) assessed value */ \| 'rentControlLikely' /* 0/1: ≥ 2 units and built < 1979 */ \| 'landUseClass' /* categorical: residential, mixed, commercial, pdr, vacant, other */`. `interface InitiationModel { kind: 'logit-monthly'; intercept: number; terms: { feature: FeatureId; bins: number[] /* ascending edges; categorical features use category index */; coef: number[] /* one per bin */ }[]; provenance: Provenance }`. Monthly hazard = `1 / (1 + exp(−(intercept + Σ coef[bin(feature)])))`. It is fitted on pre-FZP (base) envelopes and evaluated on FZP envelopes. Parcels with an in-flight project are not at risk until that project ends | stage-calibration → timelapse-sim, scenario-data (feature list) | DC |
| T4b | `interface SizeModel { fillLevels: number[] /* ascending fractions of envelope stories; last = 1; length F matches T11 yield */; byEnvelope: { maxStoriesUpTo: number; probs: number[] /* length F, sums to 1 */ }[]; provenance: Provenance }`. A new project proposes `stories = max(1, round(fill × envelope.maxStories))` | stage-calibration → timelapse-sim, scenario-data (F) | DC |
| T4c | `interface RevisionModel { at: { stage: Stage /* applied on entering this stage */; probability: number; ratio: { edges: number[]; probs: number[] } /* histogram of new units ÷ previous units; edges include 1, so shrink and grow shares are separable */ }[]; provenance: Provenance }`. No revision on or after `construction`. Upsizing is capped at the parcel's envelope. A revision changes units, and stories follow from the yield table (simulated) or scale proportionally (pipeline) | stage-calibration → timelapse-sim | MC (projects can resize before construction), DC (shape) |
| T4d | `interface ProjectHistory { id: string; pathway: Pathway \| null /* null = unclassifiable: excluded from per-pathway tables, included in pooled ones */; parcelIds: ParcelId[]; entered: Partial<Record<Stage, Day>>; end: { kind: 'complete'; day: Day } \| { kind: 'exit'; stage: Stage; reason: ExitReason; day: Day } \| { kind: 'open'; lastObserved: Day }; unitsAt: Partial<Record<Stage, number>> /* current proposed units from the record that represents each stage: PRJ → 'filed', site/full permit → 'permitFiled', TCO/CFC certified → 'complete'; cross-record, not snapshots (tier 2) */; existingUnits: number /* assessor units at filing: the roll year of the first entered day, clamped to 2007..latest */; storiesProposed: number \| null; baseStoriesAtFiling: number \| null /* current base height proxy, tier 3: no pre-FZP height map exists */; sources: { dataset: string; id: string; key?: string /* field to query, e.g. 'case_no'; absent = the dataset's record-id field */ }[]; quality: string[] /* sorted T14 rule ids that changed or estimated a value of this history; [] if none */ }`. Pipeline-internal file `pipeline/.cache/derived/<datasetVersion>/project-histories.json` = `{ schema: 1; asOf: Day; histories: ProjectHistory[] }`, never shipped. The history population and the in-flight population (T3) come from the same linkage. `entered` days are clamped forward (`pr.stages.forward-clamp`); a consumer that needs a raw filing day reads `permits.parquet`. Pipeline-internal `pipeline/.cache/derived/<datasetVersion>/permits.parquet`: one row per linked type 1/2 permit, columns `permit_number`, `project_id`, `prj_record_id`, `dva_record_id`, `prx_case_no`, `da`, `parcel_ids`, `proposed_units`, `site_permit`, `status`, `live`, `superseded`, `filed_day`, `issued_day`, `construction_day`, `complete_day`, `status_day` (raw valid days, T1, no project-level clamp) | project-records → stage-calibration, timelapse-sim (replay test fixtures) | DC |
| T12 | In `src/lib/timelapse/model.ts` (pure, zod-free, worker-safe): `sampleTransition(t: Transition, u: number, monthsElapsed: number): { kind: 'advance' \| ExitReason; days: number }`, `initiationHazard(m: InitiationModel, f: Record<FeatureId, number>): number`, `chanceTable(cal: Calibration): Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Float32Array>>>` (per month in a stage, the probability of eventually reaching `complete`; the table is 241 months long, and the tail is used beyond it), `typicalMonths(cal: Calibration): Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, number>>>` (median months to leave each stage, used for the bar's within-stage fill), and `parseCalibration(json: unknown): Calibration` (throws on schema mismatch), and `cumulativeIncidence(t: Transition, k: number): { advance: number; exit: Partial<Record<ExitReason, number>> }` (the cumulative incidence by month k ≥ 0, tail included). `sampleTransition`'s `days` counts from stage entry and is ≥ ⌈monthsElapsed · MONTH_DAYS⌉; placing a draw that falls before the snapshot is the caller's job. Every function here, and timelapse-sim's schedule code, computes `exp` and `log` with `src/lib/timelapse/math.ts` (fdlibm ports), never `Math.exp`/`Math.log`/`Math.pow`/`**`; an ESLint rule over `src/lib/timelapse/**`, `pipeline/lib/fzp-cal/**` and `src/lib/sim/scenario/**` enforces it. The pipeline's validation, the worker, the renderer (lookups uploaded once) and the card all use these, and nothing re-implements them. The bar colour and the card's "chance of finishing" both come from `chanceTable` | stage-calibration → timelapse-sim, timelapse-render, fzp-mode | MC (health = chance of finishing, OD-T2; one sampling semantics everywhere) |
| T11 | `scenarios/fzp/parcels.bin` (codec `sfh-scenario/1`, in `src/lib/data/`; deflate inside the file, async decode). It holds **every** parcel: `id`, `labelPoint`, `cellId`, a `hostable` flag (eligible and able to host a new project), `envelope: Envelope` (FZP stories: Local Program height if `localProgram`, else base height; clamped to `MAX_STORIES`), base stories, the base-zoning density cap in units (null = none), `localProgram: boolean`, `existingUnits` (latest assessor roll, post-T14) and `existingFloorAreaM2` (u32, whole m²: the value the yield used), the T4a feature values (base and FZP variants of `potentialRatio` and `storiesGap`) with an imputation mask (`imputed`, a bit set exactly when that field's value is not the source's own value: bit 0 `yearBuilt`, 1 `existingStories`, 2 `improvementShare`, 3 `existingUnits`, 4 no roll row, 5 row carried from the previous roll year, 6 `existingFloorAreaM2` (fallback to the chunk record), 7 reserved; each T14 rule that writes a parcel feature names its bit; rules that write no feature (e.g. zoning caps) have none), `hostable_base` (hostable under the old zoning), `baseYield: Uint16[F]` (gross units at each fill level of the base envelope, density-capped), and `yield: Uint16[F]`, the gross units at each fill level of the envelope, replacement typologies only (no ADU outcomes), with no density cap under the Local Program. `FILL_LEVELS = [0.25, 0.5, 0.75, 0.9, 1]` (F = 5, tier-4 quantisation grid) is owned here, and stage-calibration imports it. Named in the manifest as `scenarios?: { fzp: { parcels: url; projects: url; calibration: url } }` (amends I12 and `ManifestBaseSchema`; optional, so older datasets load). `scenarioRecordOf(p: ScenarioParcels, i: number, rec: ParcelRecord): ParcelRecord` (worker-safe, in the codec module) returns the chunk record with `existingUnits`, `existingFloorAreaM2` and `existingHeightM` (= existing stories × 3.1) replaced from row i. The pipeline's yield and timelapse-sim's simulated massing both use it, so the worker reproduces the building the yield was sized from. Because the yield uses the generator, `src/lib/generator` and `src/lib/timelapse` join the dataset-version hash | scenario-data → timelapse-sim, stage-calibration (`FILL_LEVELS`, `featureValue`, `hostable`), project-records and fzp-mode (manifest `scenarios`) | DC |
| T13 | Pipeline-internal parcel panel `pipeline/.cache/derived/<datasetVersion>/parcel-panel.parquet`. Per parcel × assessor roll year (2007..latest): `mapblklot`, roll year, assessor units, stories, year built, land and improvement value, use code → `landUseClass`, the zoning code (`acdm-wktn`), base stories, the base density cap, and the base-envelope yield (gross units at full base envelope, density-capped), and the T11 `imputed` mask. Every value is post-T14 (rules applied, interior roll-year gaps carried, bit 5). The base cap and everything derived from it are evaluated at `min(lien_day, 2026-01-11)`: base always means the zoning before the FZP. Contract columns (DuckDB table `scenario_panel` in the build): `mapblklot`, `roll_year`, `lien_day`, `existing_units`, `existing_stories`, `year_built`, `land_value`, `improvement_value`, `use_code`, `land_use_class` (INTEGER index into `LAND_USE_CLASSES`), `zoning_code`, `base_stories`, `base_density_cap`, `base_yield`, `lot_area_m2`, `improvement_share`, `rent_control_likely` (BOOLEAN; read as 0/1), `imputed`, `potential_ratio_base`, `stories_gap_base`, `hostable_base`. Never shipped. Retired-parcel lineage is `parcel-lineage.parquet` in the same folder (DuckDB table `parcel_lineage`) | scenario-data → project-records, stage-calibration | DC |
| T14 | Data-quality registry `pipeline/lib/quality.ts` (pipeline-internal). `interface QualityRule { id: string /* '<sd\|pr\|sc>.<area>.<rule>', kebab-case, unique */; owner: 'scenario-data' \| 'project-records' \| 'stage-calibration'; source: string /* lock id, raw table or derived table */; field: string; kind: 'bound' \| 'outlier' \| 'shape' \| 'gap' \| 'missing' \| 'observe'; action: 'null' \| 'replace' \| 'default' \| 'drop' \| 'none'; tier: 2 \| 3 \| 4 /* of the rule's predicate and thresholds */; valueTier: 0 \| 1 \| 2 \| 3 \| 4 \| null /* of a value the rule writes; null unless action is 'replace' or 'default' */; maskBit: number \| null /* T11/T13 imputed bit it sets; scenario-data rules only */; label: string /* plain English, shown to users */; denominator: string; warnShare: number /* default 0.01 */; failShare: number /* default 0.10 */; unitsWeighted: boolean }`. `QUALITY_RULES: readonly QualityRule[]` is the only place a pipeline rule may null, replace, default or drop a source value; observation rules (`action: 'none'`) only count. Each build reports `quality.<id>.fired` and `quality.<id>.of` (plus `.units` and `.unitsOf` when `unitsWeighted`) in `report.json` and writes `pipeline/.cache/derived/<datasetVersion>/quality-report.md` (one row per rule plus the first 25 affected record ids in sort order; never shipped). Invariant V30: every rule reports; on a live build no rule's share exceeds `failShare` (exit 1); a share above `warnShare` warns. `MIN_GROSS_M2_PER_UNIT = 10` (tier 4) is exported here for the capacity rules, with `recordQuality(counts: Record<string, number>, id: string, c: { fired: number; of: number; units?: number; unitsOf?: number; sample?: string[] /* affected record ids; sorted, the first 25 go to quality-report.md */ }): void`, the only writer of `quality.*` report keys and of `quality-report.md` rows (it throws on an unregistered id). Rules are declared in per-owner files `pipeline/lib/quality-rules/{sd,pr,sc}.ts` and collected into `QUALITY_RULES`; rules counted in SQL report through `recordSqlQuality`; every owner records into the build's single `counts` object, and `writeQualityReport` and V30 (`checkQuality`) run once after the last pipeline step. Routine missing-value imputations (`kind: 'missing'`) default to `warnShare` 0.05. T14 rules rewrite **source values**; a model choice that reclassifies or pools records (a pathway rule, a pooling rule, a density-bonus mapping) is not a T14 rule and is stated in its provenance instead | scenario-data → project-records, stage-calibration | DC |

**Internal types and exports** (none of them alters a T-row):
- From `types.ts` and `model.ts` (shared, additive):
  - `PATHWAYS = ['discretionary','streamlined','permitOnly'] as const`.
  - `EXIT_ORDER: ExitReason[] = ['withdrawn','disapproved','cancelled','expired']`. Within a month, outcomes are ordered advance first, then `EXIT_ORDER`.
  - `pathwayStages(p: Pathway): Stage[]`. Discretionary and streamlined get all of `STAGE_ORDER`. permitOnly gets `preApplication, permitFiled, permitIssued, construction, complete`.
  - `type Calibration`.
  - `binIndex(edges: number[], x: number): number`.
  - `eventualProbabilities(t: Transition, monthsElapsed: number): { advance: number; exit: Partial<Record<ExitReason, number>> }`.
- Pipeline-internal:
  - `Spell = { pathway: Pathway | null; stage: Exclude<Stage,'complete'>; a: number /* delayed-entry duration, days */; x: number /* end duration, days */; outcome: 'advance' | ExitReason | 'censored'; projectId: string }`.
  - `CoverageRow = { stage; startYear: number; entryEnd?: string; evidence: string }`.
  - `CalProfile` (`LIVE_CAL`, `FIXTURE_CAL`; the same pattern as `InvariantProfile`, `pipeline/config.ts:44-127`).
  - `PanelRow = { mapblklot; rollYear; exposureMonths; events; features: Record<FeatureId, number> }`.
  - `FitCell = { bins: number[]; exposure: number; events: number }`.
- File shape: T4 now carries `Transition.tailProvenance`, `streamlinedForLocalProgram` and `phaseGap` (round 3), so no keys are added beyond the row. `ppaShare` is the top-level key after `pathwayForNew` (T4: "the calibration also carries"). Keys are emitted in T4 order: `schema, asOf, transitions, initiation, pathwayForNew, ppaShare, size, revision, streamlinedForLocalProgram, phaseGap`.

### Interface concerns (all resolved by the reconciliation sections and round-3 addenda)

| # | concern | resolution |
|---|---|---|
| IC-1 | T4 did not define a month length | **Resolved**, T1. `MONTH_DAYS = 30.436875` and `monthsIn` are the single rule, specified here (§4.1) |
| IC-2 | Sampling was implemented in two places | **Resolved**, T12. One module, owned here |
| IC-3 | T4d had no `asOf` | **Resolved**, T4d file envelope `{ schema, asOf, histories }` |
| IC-4 | Some pathways are unknowable | **Resolved**, T4d `pathway: Pathway \| null`. PPA-only records take `discretionary` |
| IC-5 | No row covered the scenario-data panel inputs | **Resolved**, T13 parcel panel |
| IC-6 | Blind spot on density decontrol | **Resolved**, "Density decontrol" ruling and T4a/T13: the base yield is density-capped |
| IC-7 | Source of `landUseClass` | **Resolved**, T13. scenario-data maps the use code; this spec no longer defines the mapping |
| IC-8 | One population | **Resolved**, T4d "same linkage"; net ≥ 1 ruling |
| IC-9 | PRJs closed without a decision | **Resolved**: `withdrawn` at the stage they were in, dated by `close_date` |
| IC-10 | Revision at a project's first stage | **Resolved**: the first stage carries `revisions[0]`; revisions apply only on later entries |
| IC-11 | Content type for `.md` | **Resolved** by removal: the report is not uploaded or linked |
| IC-12 | Invariant numbering | **Resolved**: stage-calibration V25–V29 |
| IC-13 | Mini assessor panel | **Resolved**: scenario-data's fixture panel has two roll years |
| IC-14 | Bias from completion dating | **Resolved**: documented in provenance (§4.4, `construction` method text) |
| IC-15 | The round-3 permit-side start of "about 1989" assumes first-construction-document dates from 1989. They are sparse until 2000 | **Superseded** by partner ruling DQ-1: every pooled permit-side window starts on 2007-01-01, the first assessor roll's lien day (§4.4) |
| IC-16 | `phaseGap` needs per-permit filed days, but T4d merges a past DA's phase permits into one history and carries only permit ids in `sources` | **Resolved**: `permits.parquet` is now named, with its columns, in the T4d row (IA-18). §4.6 and §4.7a read it |

## 3. Global constraints

### Evidence hierarchy (partner ruling; global)

Every number the simulation uses comes from the highest tier available. It carries that tier and its source, and the UI can show both.

| tier | kind | example here |
|---|---|---|
| 0 | per-record time series | DBI permit dates, Planning approval dates, TCO/CFC dates |
| 1 | published first-party aggregates | Housing Inventory production tables, quarterly pipeline report |
| 2 | researched inferences from observations | a redevelopment hazard fitted to SF parcel history; resize ratios measured across linked records |
| 3 | research models / literature | NAHB construction durations, statutory review clocks used as duration proxies |
| 4 | made up | anything else, labelled as such |

Consequence: calibration is **computed by the data pipeline from DataSF records**, and literature figures are used only where the records can't answer. The dataset probe found tier-0 coverage for almost every stage. There is no tier-0 figure for deaths before any filing, or for the new Local Program's own durations (it has been in force only since 2026-01-12).

### Global constraints

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

## 4. Behaviour

### 4.1 Time (T1, `src/lib/timelapse/time.ts`)

- `MONTH_DAYS = 30.436875`. `monthsIn(enteredDay, day) = Math.floor((day − enteredDay) / MONTH_DAYS)`.
- Table month *k* (1-based, `advance[k−1]`) holds exactly the durations *d* (integer days since entry) with `monthsIn(0, d) = k − 1`. That is, *d* < k·`MONTH_DAYS`, so the integer days in month *k* are ⌈(k−1)·M⌉ … ⌈k·M⌉ − 1, where M = `MONTH_DAYS`.
- `OPEN_DAY = Math.fround(3.0e38)`: finite and exact in Float32 (the bare literal does not survive a Float32 round-trip; ruling A1). Every consumer compares with the exported constant, never a literal.
- `DYING_DAYS = 270`: the display window of a death, 90 days red then 180 days fade. It is tier 4 and display only. timelapse-render's uniforms and timelapse-sim's card visibility read it (T1). Nothing in calibration reads it.
- The module has no dependencies.

### 4.1a Deterministic math (`src/lib/timelapse/math.ts`)

**What it is.** The module exports `exp(x: number): number` and `log(x: number): number`. They are line-for-line TypeScript ports of fdlibm 5.3:
- `e_exp.c`: argument reduction by ln2 hi/lo, then the Remez polynomial P1..P5;
- `e_log.c`: reduction to [√2/2, √2], then the polynomial Lg1..Lg7.

**How it reads bits.** The high and low words are read and written through one module-level `DataView` over an 8-byte `ArrayBuffer`, never through `Math.*`. It uses only IEEE-754 `+ − × ÷` and integer bit operations. JS never fuses multiply-add, so the results are bit-identical on every engine (V8, JavaScriptCore, SpiderMonkey). Special cases follow fdlibm:
- `exp`: overflow → `Infinity`, underflow → 0, NaN propagates;
- `log`: `log(0) = −Infinity`, negative → NaN.

**Who uses it.**
- Every T12 function: `initiationHazard`, and the closed-form tails in `sampleTransition`, `cumulativeIncidence`, `chanceTable` and `typicalMonths`.
- The pipeline's tail probability p_j (§4.4) and its IRLS (§4.6).
- timelapse-sim's schedule code (T12).

`Math.exp` and `Math.log` (and `Math.pow`, `Math.log1p`, `Math.expm1` and the `**` operator) never appear on a determinism path. In the T12 tail, (1 − ρ)^n is computed as `exp(n · log(1 − ρ))`. The ESLint rule (T12) bans those `Math` members through `no-restricted-properties`, and `**` and `**=` through `no-restricted-syntax`. Math members with an exact IEEE-754 specification (`sqrt`, `fround`, `floor`, `ceil`, `round`, `trunc`, `abs`, `min`, `max`, `sign`, `imul`, `clz32`) stay allowed.

**Lint scope.** The T12 row sets the scope to `src/lib/timelapse/**`, `pipeline/lib/fzp-cal/**` and `src/lib/sim/scenario/**`. Step 0 landed the first two globs in `eslint.config.js`. timelapse-sim adds `src/lib/sim/scenario/**` in its step 3 (ruling A3, IA-7); this subsystem does not edit that line.

**Accuracy.** Error is below 1 ulp, as in fdlibm. Accuracy is not the goal; reproducibility is.

**License** (ruling A5). fdlibm's permissive Sun notice is kept in the file header as a `/*! … */` comment, so minifiers keep it in the shipped bundle (step 0 wrote it as `/** … */`; step 2 changes the opener). The module is source we ship, not a dependency, but it ships in the bundle, so step 2 also adds it to `SOFTWARE` in `src/lib/attribution.ts` (CLAUDE.md convention), rendered at `/attribution`: `{ name: 'fdlibm (exp, log)', license: 'Sun Microsystems permissive notice', url: 'https://www.netlib.org/fdlibm/' }`.

### 4.2 Shared model module (T12, `src/lib/timelapse/model.ts`)

Below, M = `MONTH_DAYS`. Write C(k) = advance[k−1] + Σ exit[k−1] for 1 ≤ k ≤ K = `months`, with C(0) = 0, and ρ = tail.advance + Σ tail.exit. For k > K, C(k) = 1 − (1 − C(K))(1 − ρ)^{k−K}. `parseCalibration` guarantees ρ > 0 and C(K) < 1.

**`sampleTransition(t, u, monthsElapsed)`**, with u ∈ [0, 1) and m = `monthsElapsed`:
1. The target is c = C(m) + (1 − C(m))·u.
2. The event month *k* is the least *k* > *m* with C(k) > c. Beyond K it is solved in closed form: k = K + ⌈`log`((1 − c)/(1 − C(K))) / `log`(1 − ρ)⌉, using `math.ts` `log`. It is then adjusted by ±1 so that the inequality holds exactly, with C(k) evaluated through `math.ts` `exp`/`log`.
3. Month *k*'s mass [C(k−1), C(k)) is split in the order advance, then `EXIT_ORDER`. Table months use the increments of F_j; tail months use proportions p_j/ρ. `kind` is the sub-interval [lo, hi) that contains c.
4. φ = (c − lo)/(hi − lo). Then `days` = ⌈(k−1)·M⌉ + ⌊φ·(⌈k·M⌉ − ⌈(k−1)·M⌉)⌋. This is the T4 "one uniform; day within the month is uniform", and `monthsIn(0, days) = k − 1` always holds.

`days` counts from stage entry and is ≥ ⌈m·M⌉. An in-flight project's month *m*+1 is partly in the past, so placing a past result at the snapshot day is timelapse-sim's job.

**`cumulativeIncidence(t, k)`** (T12, IA-13) gives the cumulative incidence of each outcome by the end of month *k* since stage entry, unconditional (from m = 0), tail included. Write F_j(k) for outcome *j* (advance, or an exit reason) and p_j for its tail value (`tail.advance` or `tail.exit[j]`, 0 if absent):
- *k* must be a non-negative integer; anything else throws `RangeError`. Callers derive *k* from `monthsIn`, which is always an integer.
- k = 0: every F_j = 0.
- 1 ≤ k ≤ K: F_advance(k) = `advance[k−1]` and F_j(k) = `exit[j][k−1]`; a reason with no table array but a tail value has F_j(k) = 0 here.
- k > K: F_j(k) = F_j(K) + (1 − C(K)) · (p_j/ρ) · (1 − (1 − ρ)^{k−K}), with (1 − ρ)^{k−K} = `exp((k−K) · log(1 − ρ))` from `math.ts`. Summed over *j* this is exactly the C(k) defined above.
- The result has `advance` and one `exit` key for each reason present in `exit` or `tail.exit`, in `EXIT_ORDER`, and no others.

It is the one implementation of "the share that has advanced or died by month *k*". fzp-mode uses it wherever it shows a cumulative share for a stage (IA-13), and V27 reads the table side through it, so the check and the UI cannot drift.

**`eventualProbabilities(t, m)`** gives P(eventually *j*) given survival to *m* months: (F_j(∞) − F_j(m)) ÷ (1 − C(m)), where F_j(∞) = F_j(K) + (1 − C(K))·p_j/ρ. For m ≥ K it equals p_j/ρ (memoryless).

**`chanceTable(cal)`**: for each pathway and each stage *s* of `pathwayStages(p)` other than `complete`, a `Float32Array(241)`. The entry at index *m* = 0..240 is `chance(p, s, m)`:
- `chance(p, s, m) = eventualProbabilities(T[p][s], m).advance × chance(p, next(p, s), 0)`;
- `chance(p, 'complete', ·) = 1`;
- `next` steps along `pathwayStages(p)`. preApplication advances to `filed` on discretionary and streamlined, and to `permitFiled` on permitOnly. This matches T2, where advancing means entering the next stage.

Beyond index 240, callers use index 240, which equals the tail value because K ≤ 240.

**`typicalMonths(cal)`**: for each pathway and stage, the least *k* ≥ 1 with C(k) ≥ 0.5. That is the median month of leaving the stage, by any outcome. Beyond K it is solved in closed form. The result is finite: when the tail cannot reach 0.5 before the sampler's event-month cap (`floor(2^24 / MONTH_DAYS)` = 551,213), it is that cap, which is the median under `sampleTransition`'s own semantics (ruling R12).

**`initiationHazard(m, f)`** = 1 / (1 + exp(−(intercept + Σ_terms coef[binIndex(bins, f[feature])]))). Here `exp` is `math.ts` `exp`, and the terms are summed in array order.

All of `typicalMonths` and `chanceTable`, including their tail evaluation, use `math.ts` only.

**`binIndex(edges, x)`** = (the number of edges ≤ x) − 1, clamped to [0, len − 1]. Bin *i* is [edges[i], edges[i+1]), and the last bin is open above. Categorical features use category indices as edges.

**`parseCalibration(json)`** is a hand-written validator with no Zod. It throws a `CalibrationFormatError` naming the path on any violation of the T4 shape or of the rules below, and returns the typed value:
- `schema === 1`; `asOf` is an integer.
- Every pathway has every stage of `pathwayStages(p)` except `complete`, and no other stage. This is the reconciliation's "every pathway × stage pair is present", read as the pairs a project can occupy (T2: permitOnly never enters `filed` or `entitled`).
- Arrays have length `months` (1 ≤ `months` ≤ 240), are non-decreasing and lie in [0, 1].
- `advance + Σexit ≤ 1 + 1e-9` at every month, and C(K) ≤ 1 − 1e-6.
- Tail values are ≥ 0 and 0 < ρ ≤ 1.
- `fillLevels` is non-empty, strictly ascending, lies in (0, 1] and ends at exactly 1; F = `fillLevels.length`. Every `byEnvelope` entry's `probs` has length F, lies in [0, 1] and sums to 1 within 1e-9. `byEnvelope` is non-empty with non-decreasing `maxStoriesUpTo` (ties accepted, ruling R15).
- **F is checked internally only** (ruling A2). `parseCalibration` does not import T11's `FILL_LEVELS`, because `model.ts` imports nothing outside `src/lib/timelapse` (AC-7) and the T12 signature `parseCalibration(json)` is unchanged. Equality of `fillLevels` with `FILL_LEVELS` (AC-8) is enforced in two other places: by this subsystem's V25 check in the pipeline, which may import `src/lib/data`, and by timelapse-sim when it assembles `SimInput` (a mismatch there is `scenario-invalid`).
- Revision `edges` are strictly ascending and include 1 (T4c, IA-28: shrink and grow shares are separable), `probs.length = edges.length − 1`, `probs` sum to 1 within 1e-9 when non-empty, and each `probability` lies in [0, 1]. No `at.stage` is `construction` or later (T4c), and no two `at` entries name the same stage: a repeat is rejected at `revision.at[i].stage` of the later entry (timelapse-sim applies a revision on entering a stage, so two would be ambiguous).
- `pathwayForNew` sums to 1 within 1e-9, and each `ppaShare` value lies in [0, 1].
- Every `Provenance` has tier 0..4, a non-empty label and method, and ≥ 1 source with an `https:` URL. Tiers 0–2 also have `n` and `window`. This includes `streamlinedForLocalProgram`, `phaseGap.provenance` and every `tailProvenance`.
- Every Transition has a `tailProvenance`. `streamlinedForLocalProgram` is present. `phaseGap.days` is a non-empty, non-decreasing array of positive integers (empirical ties accepted, ruling R15).

### 4.3 Placement in the build

`build()` (`pipeline/steps/build.ts`) gains a timed `calibration` step. It runs after the `scenario` and `projects` steps and before `buildManifest`. Paths follow ruling A6: `BuildOpts.derivedRoot` (default `pipeline/.cache/derived`; fixture and test builds pass a temporary root so parallel builds don't race) and `derivedDir = <derivedRoot>/<datasetVersion>`, the same `derivedDir` the build already passes to `writeScenario` and `writeProjectRecords`. The step takes `derivedDir` as an option and never hard-codes `pipeline/.cache/derived`. It reads:
- `<derivedDir>/project-histories.json` (T4d), whose `asOf` must equal `projects.json` `asOf` (T3); the build may pass the histories in memory instead, and the step then checks the same `asOf`;
- `<derivedDir>/permits.parquet` (T4d row), through DuckDB `read_parquet`, for the initiation basis "permit" (§4.6) and `phaseGap` (§4.7a);
- the T13 panel through the in-build DuckDB table **`scenario_panel`** (ruling A6), with the T13 contract columns; outside a build (tests, a standalone run) the same columns are read from `<derivedDir>/parcel-panel.parquet`. Lineage (`parcel_lineage`) is not read (§1);
- the decoded T11 parcels, for `hostable`, `lotAreaM2`, the FZP-variant features (`featureValue`) and `FILL_LEVELS`.

It writes `calibration.json`, the report and its `quality.sc.*` counts (§4.4a). It does no network access. There is no new CLI command. **No statistics dependency is added**: Aalen–Johansen is one sorted sweep, and the logit fit is IRLS with a dense Cholesky solve of about 50 parameters.

### 4.4 Population, normalisation, window, estimator

**Qualifying project.** A T4d history whose first recorded `unitsAt` minus `existingUnits` is ≥ 1 net unit (reconciliation: single-unit new construction is included). The same predicate defines the transition cohort, the initiation event, `pathwayForNew`, `ppaShare`, size and revision.

**Normalisation.** These steps run in order on the qualifying histories. Steps 1–3 and 6 rewrite source values, so each is a registered T14 rule (step 1 is two: `sc.stages.gap-impute` and its no-FCD amendment `sc.stages.no-fcd-duration`) (§4.4a, orchestrator ruling "stage-calibration: residue after declarations"), counted as `quality.<id>.fired` and `quality.<id>.of`. Steps 4 and 5 reclassify or pool records; they are model choices, not T14 rules (T14: "T14 rules rewrite source values"), so they stay method steps, counted under `calibration.method.*` and stated in the affected provenance. The changed values live only in the step's memory; `project-histories.json` is never rewritten.
1. **Imputation** (`sc.stages.gap-impute`). On `pathwayStages(pathway)`, a missing stage with a later stage present gets the next present stage's day. This preserves incidence, and the bias toward zero-duration spells is reported.
   - **No-FCD completions** (`sc.stages.no-fcd-duration`; partner ruling P1, 2026-10-18, amending this step for one case). A *completed* history whose `entered.construction` is missing, or equals its completion day (no first-construction-document date), is a "no-FCD completion". For it:
     - step 1 does NOT impute construction = completion day (it skips `construction` for it; other gaps of the same history are still imputed as above, e.g. a missing `entitled` between `filed` and a permit);
     - it stays in the stage-transition incidence: it passed permitIssued → construction → complete;
     - it is excluded from the duration estimates of its `permitIssued` and `construction` spells: those spells are unobserved; they are never censored at a fake day. `buildSpells` omits the two spells and returns them as `unobserved` advances (`NormHistory.noFcd`). A completion that never entered `permitIssued` but entered `construction` on its completion day (a null-pathway history first seen at construction; R7 forbids back-filling) is a no-FCD completion too: its 0-day construction spell is dropped and only its `construction` advance is unobserved. A history that entered neither stage (seen only at completion) has no permit-side spell to leave out;
     - it is counted as its own registered rule, `sc.stages.no-fcd-duration` (§4.4a), with the reason "construction start unobserved; incidence kept, durations fitted from histories with an FCD", stated in provenance (§4.5).
   - **Estimation (controller ruling R13).** Missing at random among advancers: in each fitted (window, pathway-subset) cell of `permitIssued` and `construction`, the cell's observed *advance* spells are up-weighted so their total weight equals observed advances + the no-FCD completions that belong to that cell. Each advance spell gets weight `w = 1 + X / A` (X = no-FCD completions in the cell's spell set, A = observed advance spells in it; if A = 0, X is dropped and the cell fits without them, counted in the report). Weights apply to the spell's at-risk contribution and its event, in the AJ sweep, the tail fit (person-months and events) and the PH scaling (O, E, nₚ). Exit and censored spells keep weight 1. Equivalent reading: each no-FCD completion is a clone, split evenly, of the cell's observed advancers (`weightAdvances`, `pipeline/lib/fzp-cal/no-fcd.ts`). With every weight 1 the estimators are bit-identical to the unweighted ones.
     - Cell membership of a no-FCD completion: the `construction` cell iff its completion day ≥ the window start V; the `permitIssued` cell iff it entered permitIssued, its completion day ≥ V and `eff.permitIssued` < asOf. Pathway subsets as for any spell (its pathway, after the defensive rule; the 2015 pathway level uses V = 2015-01-01 the same way).
     - **Guard** (conductor, accepted 2026-10-18). Each cell reports X, A, w and `flagged = w > 1.5 || A < N_EVENTS_MIN`; the report lists every cell's X, A, w, and so does the cell's provenance `method`. Pooling comes before weighting for a flagged cell: a flagged pathway-level (2015+) subset with X > 0 takes the pooled cell's w (its advance spells are weighted with the pooled X/A, not its own); a flagged subset with X = 0 keeps w = 1 (controller ruling R19). A flagged pooled cell with X > 0 stops the live build for escalation: `CalibrationError('no-FCD weighting flagged at pooled level: <stage> X=… A=… w=…')` (ruling R29). With X = 0 the weighting is a no-op, so a flagged pooled cell with X = 0 is not escalated and its `flagged` is reported unchanged (ruling R24). The fixture build (`FIXTURE_CAL`) warns with the same text instead and counts the cell in `calibration.noFcd.flaggedPooled`, which is therefore 0 in every live build that completes.
2. **Running maximum** (`sc.stages.running-max`). `eff[s]` is the maximum of the observed entry days of *s* and of every earlier entered stage. Example: a site permit filed before approval gives a zero-duration `entitled` spell. T4d `entered` is already clamped forward by `pr.stages.forward-clamp`, so on a valid file this rule fires 0 times; it re-checks the input after step 1 and counts anything that slipped through.
3. **Exit reconciliation** (`sc.exit.last-stage`). An exit applies at the last entered stage, and its day is clamped to `≥ eff[last]`. project-records already places an exit at the latest entered stage on or before its day and clamps its day (project-records spec, as corrected by L1), so on a valid file this rule, too, is expected to fire 0 times.
4. **Defensive pathway rule** (method step; count `calibration.method.permitOnlyPre2015`). A `permitOnly` history with `eff.permitFiled` < 2015-01-01 is treated as `pathway = null`, in addition to T4d's nulls. Before PRJ coverage, a missing PRJ link does not prove there was no entitlement. The permit-side `method` text states it ("permit-only histories before 2015 count as pathway unknown: n = …").
5. **preApplication pooling** (method step; count `calibration.method.ppaPooled`, the preApplication spells pooled). Every preApplication spell is pooled across pathways, because a PPA-only record's pathway is assigned, not observed. The preApplication `method` text states it.
6. **Administrative-purge censoring** (`sc.exit.purge-censor`; round 2). Exits from bulk administrative actions, such as DBI's Sept–Oct 2026 batch withdrawal, are not project decisions. Detection runs over the exits of all qualifying histories after step 3, using the duration in stage *x* = exit day − `eff[stage]`:
   - **Purge day.** A calendar day *D* is a purge day iff all three hold:
     - c(*D*) ≥ `PURGE_MIN_EXITS`, where c(*D*) is the number of exits dated *D*, any reason and stage;
     - c(*D*) ≥ `PURGE_RATIO` × the mean daily exit count over the 365 days before *D*, with that mean floored at 1/365;
     - the median *x* of *D*'s exits is ≥ `PURGE_MIN_DAYS`.
   - **Purge window.** Purge days less than `PURGE_GAP_DAYS` apart merge into one window [first, last].
   - **Censoring.** Every exit dated inside a window with *x* ≥ `PURGE_MIN_DAYS` becomes **censored at its last non-purge activity**, which is the day before the window starts. T4d carries no activity dates, so that is the last day the record is known to have been open; it is never earlier than `eff[stage]`. Shorter-duration exits inside the window stay exits.
   - **Tier.** The thresholds are tier 4 (§4.11). The detection is a tier-2 inference. The registered rule's `tier` is therefore 4 (T14: the tier of the predicate and its thresholds, so the worse of the two). Every affected Transition's `method` says "k exits in administrative purge windows [dates] censored (rule sc.exit.purge-censor: tier 2 detection, tier-4 thresholds)". The report prints each window: dates, exits by reason and stage, how many were censored, and the median durations.
   - **Counting** (conductor ruling C3, 2026-10-18). Detection and censoring run over all qualifying exits, as above; the rule is counted over the exits of windowed histories (§4.4a), and the unwindowed counts (all qualifying exits, all censored exits) and every window are reported in provenance and the report.
   - **Scope.** The rule runs in live and fixture builds alike.
   - **Effect on initiation.** A censored exit does not end the project for the initiation panel; the project stays open (§4.6).

Tables are **project-weighted**. Unit-weighted shares appear only in the report.

**Fitting windows (OD-T3 as refined by partner rulings round 3 and DQ-1).** A configured constant in `pipeline/lib/fzp-cal/window.ts`. Its evidence comes from probes verified 2026-10-16 (URLs at the end of §4.10) and from partner ruling DQ-1 (2026-10-17).

| stage | side | pooled window start Wₛ | pathway window start | evidence |
|---|---|---|---|---|
| preApplication | Planning | 2015-01-01 | 2015-01-01 | PPA records `y673-d69b`, 2011-02-11 to **2023-07-07** (`entryEnd`); Planning span from 2015 (ruling) |
| filed | Planning | 2015-01-01 | 2015-01-01 | PRJs with net units ≥ 1: 71 (2013), 158 (2014), 398 (2015) |
| entitled | Planning | 2015-01-01 | 2015-01-01 | approvals `d4jk-jw33`: 182 (2014), 1,328 (2015) |
| permitFiled | permit | **2007-01-01** | 2015-01-01 | first assessor roll's lien day (DQ-1); `filed_date` dense from 1981 |
| permitIssued | permit | **2007-01-01** | 2015-01-01 | first assessor roll's lien day (DQ-1); `issued_date` dense from 1981 |
| construction | permit | **2007-01-01** | 2015-01-01 | first assessor roll's lien day (DQ-1); `first_construction_document_date` dense from 2000 |

**Why 2007 for every permit-side stage (partner ruling DQ-1).** The permit dates themselves reach back much further. The window is set instead by the qualifying predicate, which needs existing units at filing:
- **Existing units come from the assessor roll** at the year of the project's first record, clamped to the first roll year, 2007 (T4d `existingUnits`). A project filed before 2007 therefore reads the 2007 roll, which often already shows the finished building. Example: BP:7910790S was filed in 1984 and finished in 1987 with 590 units, and the 2007 roll shows 1,587 units on its parcels, so it nets below 1 and leaves the population.
- **That loss is a bias, not just a loss.** Live, 4,901 pre-2007 histories fall out (histories drop from 10,212 to 4,716; project-records COMPLETION.md item 5). The pre-2007 spells that survive are the slow ones, still running in 2007, so a window that reached back to 1989 or 2000 would bias the pooled permit-side tables toward long durations.
- **From 2007-01-01 the measurement is sound.** A spell that started earlier but is still running then enters by left truncation at 2007-01-01, as every pooled spell already does at its window start. Its existing units come from the 2007 roll, which shows the building before demolition whenever construction starts on or after 2007-01-01.

This replaces round 3's 1989 (`permitFiled`) and 2000 (`permitIssued`, `construction`). The Planning-side window (2015+), the pathway levels (2015+) and initiation (2007+) are unchanged. `phaseGap` keeps its own 1989 window (§4.7a): it reads `permits.parquet` and does not use existing units, so it is decoupled from these windows.

**Excluded volume.** A qualifying history whose spells all end before 2007-01-01 contributes no permit-side spell (and, since the Planning side starts in 2015, no spell at all). The step counts these as `calibration.window.preRoll`, and the report prints the count beside the table so the excluded volume is visible. A history with any spell ending on or after 2007-01-01 is not counted there.

**Guard.** `COVERAGE_GUARD` is a method constant: **on in `LIVE_CAL`, off in `FIXTURE_CAL`** (round 2). When on, any **full calendar year** inside [Wₛ, entry end] with zero qualifying entries raises `CalibrationError: coverage gap`; the entry end is `PPA_SERIES_END` (2023-07-07) for preApplication and `asOf` for every other stage, and a year is full when its Jan 1 ≥ Wₛ and its Dec 31 ≤ the entry end (conductor ruling C4, 2026-10-18). A partial first or last year is not asserted: its entry count is still returned, stated in every affected Transition's `method` ("partial year 2023 (to 2023-07-07): 0 entries, not asserted") and printed in the report's window section. The same rule applies to every stage: preApplication checks 2015..2022, and with asOf 2026-10-17 every other stage checks through 2025. The ruling was motivated by the live data: 0 qualifying PPA entries in 2023-01-01..2023-07-07 (6 in 2022), a partial year the previous wording turned into a coverage gap. When off, the per-year counts are still reported.

**What is recorded.**
- Planning-side Transitions have `window` = [2015-01-01, asOf].
- Permit-side Transitions have `window` = [2007-01-01, asOf], and their `method` gives both windows (§4.5).
- The report reprints this table, with `calibration.window.preRoll`.

**Spells.** For each entered non-terminal stage *s*:
- entry *e* = `eff[s]`;
- end *z* = `eff[next entered]` with outcome `advance`; or the exit day with its reason; or `min(lastObserved, asOf)`, censored.

For a window start V (either Wₛ or 2015-01-01, §4.5), a spell is kept iff *z* ≥ V and *e* < asOf. Then *a* = max(0, V − *e*) (left truncation, delayed entry) and *x* = *z* − *e*. preApplication entries end on 2023-07-07, and their spells are still followed to `asOf`.

**Aalen–Johansen.** For each (pathway, stage) cell, take the distinct event durations *d* in ascending order. All reasons at *d* are applied before S is updated. The sweep starts with S = 1 and F_j = 0.

```
n(d) = #{ i : aᵢ ≤ d ≤ xᵢ }   // #(aᵢ ≤ d) − #(xᵢ < d); events precede censoring at ties
F_j += S · e_j(d) / n(d);   S *= 1 − e(d) / n(d)
```

- **Table values.** `advance[k−1]` is F_advance after every event with *d* < k·M, and likewise for each exit reason. A reason with no events in either the table or the tail is omitted.
- **Table length.** `months` is the largest *k* ≤ `K_MAX` with n(k·M) ≥ `N_RISK_MIN`, counting observed records (unweighted; controller ruling R18: weights from §4.4 step 1 enter only the estimates, never a threshold).
- **Tail.**
  - The span starts at k₀ = max(1, `months` − `TAIL_SPAN` + 1). k₀ moves earlier until the span holds ≥ `TAIL_MIN_EVENTS` observed (unweighted, R18) events. The span runs to the end of observation.
  - Person-months E = Σᵢ |[max(aᵢ, (k₀−1)·M), xᵢ]| ÷ M.
  - λ_j = events_j ÷ E.
  - p_j = (λ_j/λ)(1 − `exp`(−λ)), using `math.ts`.
  - **Tail provenance** (T4 `Transition.tailProvenance`). It is written for every Transition, with tier **2** ("extrapolation beyond the observed months"):
    - `method`: "constant competing hazards, occurrence/exposure over months k₀+ (k₀ = …), applied beyond month `months`";
    - `n`: the events in the span;
    - `window`: the Transition's window;
    - `sources`: the Transition's sources.

    For rung 3 it copies the Transition's own tier and sources, because there the tail is the table.
- **Rounding.** Table values are floored to 1e-6, which keeps them monotone and keeps Σ ≤ 1. Tail values are rounded to 6 significant digits. Rung-3 values (§4.5) are the one exception: they are rounded *up* to 1e-6 (controller ruling R25), so the synthetic median is never later than ⌈D⌉ (exactly D for an integer D); a one-month table with q ≤ 0.5 is trivially monotone with Σ ≤ 1, and a value on the 1e-6 grid already has at most 6 significant digits, so the tail equals the table value.
- **Rejection.** A cell is rejected, and goes to §4.5, unless C(K) ≤ 1 − 1e-6 and ρ > 0.
- **Construction provenance.** The `construction` cells' `method` states: "completion = first TCO/CFC, else permit `completed_date`; TCO data start in 2018, so earlier completions are dated later (bias toward longer durations)".

### 4.4a Registered data-quality rules (T14, `sc.*`)

Seven rules rewrite, drop or set aside source values, so they are entries in `QUALITY_RULES` (`pipeline/lib/quality.ts`, T14): §4.4 step 1 (two rules: the imputation and its no-FCD amendment, partner ruling P1), steps 2, 3 and 6, the §4.9 revision clamp, and the §4.9 exclusion of revision pairs whose earlier count was carried back (partner ruling via conductor, 2026-10-18, "Exclude from resize estimate"). This subsystem declares them in step 2 in its per-owner file `pipeline/lib/quality-rules/sc.ts` (T14: "Rules are declared in per-owner files `pipeline/lib/quality-rules/{sd,pr,sc}.ts` and collected into `QUALITY_RULES`"), with `owner: 'stage-calibration'`; it does not edit `quality.ts` or another owner's file. scenario-data owns and ships the module, `recordQuality`, V30, `quality-report.md` and the generated "Data quality" section of `docs/dev/pipeline.md`. Not rules: the estimators, the windows (§4.4), the qualifying predicate, the fallback ladder (§4.5), and the three model choices that reclassify or pool records: the defensive pathway rule and preApplication pooling (§4.4 steps 4–5) and the size r > 1 → 1 mapping (§4.8). Those stay hand-written method steps, counted under `calibration.method.*` and stated in their provenance.

| id | step | `field` | `kind` | `action` | tier (rule / value) | `denominator` (`.of`) |
|---|---|---|---|---|---|---|
| `sc.stages.gap-impute` | §4.4 step 1 | `entered` | `gap` | `default` | 2 / 2 | qualifying histories that contribute a spell in a pooled window |
| `sc.stages.no-fcd-duration` | §4.4 step 1 (P1) | `entered` | `missing` | `drop` | 2 / — | qualifying histories that contribute a spell in a pooled window |
| `sc.stages.running-max` | §4.4 step 2 | `entered` | `shape` | `replace` | 2 / 2 | qualifying histories |
| `sc.exit.last-stage` | §4.4 step 3 | `end` | `shape` | `replace` | 2 / 2 | qualifying histories that end in an exit |
| `sc.exit.purge-censor` | §4.4 step 6 | `end` | `outlier` | `replace` | 4 / 2 | exits of qualifying histories that contribute a spell in a pooled window (after step 3; conductor ruling C3) |
| `sc.revision.ratio-clamp` | §4.9 | `unitsAt` (new ÷ previous) | `bound` | `replace` | 4 / 4 | revised pairs |
| `sc.revision.carried-excluded` | §4.9 (partner ruling via conductor, 2026-10-18) | `unitsAt` (a carried-back `filed` count) | `observe` | `none` | 2 / — | revision pairs in the window, before the exclusion |

Fields common to every `sc.*` entry: `owner: 'stage-calibration'`; `source: 'project-histories'` (the T4d derived table); `maskBit: null` (masks are scenario-data's; T14); `unitsWeighted: false`, because every table is project-weighted (§4.4); `warnShare` 0.01 and `failShare` 0.10, the T14 defaults, except as the next sentences state. One `sc.*` rule is of `kind: 'missing'`: `sc.stages.no-fcd-duration` (a construction start missing from the record, whose two durations are dropped; `valueTier` null, as it writes no value), and it takes that kind's defaults, `warnShare` 0.05 and `failShare` 0.10 (if its measured share exceeds them, that is reported for a ruling, not overridden in frame). `sc.stages.gap-impute` fills a stage between two recorded stages, a `gap`. Two `sc.*` rules override the defaults. `sc.stages.gap-impute` takes `warnShare` 0.1 and `failShare` 0.2 (conductor ruling C1 / partner DQ-4, 2026-10-18), because the stage model fills unrecorded intermediate stages and construction-start (FCD) dates are sparse. `sc.revision.ratio-clamp` takes `warnShare` 0.1 and `failShare` 0.2 (partner ruling via conductor, 2026-10-18 (DQ-4)), because permit and completion unit counts come from different records (phased completions, unit-mix changes); split-row artefacts are removed at source. `sc.revision.carried-excluded` (kind `observe`, action `none`, `valueTier` null: it writes no value, it leaves a pair out of the revision fits) takes the defaults 0.01 / 0.10 (partner ruling via conductor, 2026-10-18). Each reason is a comment at its entry in `pipeline/lib/quality-rules/sc.ts`, and `kindDefaultDepartures(SC_RULES)` is `['sc.stages.gap-impute', 'sc.revision.ratio-clamp']` (input order). Its denominator is the qualifying histories that contribute a spell inside the pooled windows (DQ-1: 2007-01-01 on the permit side, 2015-01-01 on the Planning side), that is, after `buildSpells`' window cut: `normalise` returns the ids step 1 changed and `gapImputeTally(imputed, spells, unobserved)` counts `of` as the distinct `projectId` among the spells and the unobserved advances (§4.4 step 1) and `fired` as the imputed ids among them. `sc.stages.no-fcd-duration` counts over the same windowed denominator: `noFcdTally(norm, spells, unobserved)` gives `of` = the distinct `projectId` among the spells plus the unobserved advances' ids (the same set `gapImputeTally` counts), `fired` = the no-FCD completions with an advance in at least one permit-side pooled cell, and `sample` their ids. The other three rules, and `sc.revision.carried-excluded`, keep the defaults. `sc.exit.purge-censor` counts over windowed exits by the same precedent (conductor ruling C3, 2026-10-18): `purgeCensorTally(windowedIds(spells, unobserved), purge)` gives `of` = the exits whose history is in that windowed set, `fired` = the censored ones among them; `purgeCensor`'s own tally (all qualifying exits) and every detected window stay in the report and provenance. The remaining three count over all qualifying histories (or their exits or pairs); `sc.revision.carried-excluded` counts over the revision pairs that pass every §4.9 measurement filter (both counts ≥ 1, later stage entered in the window, not a first stage), before the exclusion.

**Labels** (T14 `label`, plain English and generic, never naming a record):
- `sc.stages.gap-impute`: "A missing stage between two recorded stages takes the next recorded stage's date".
- `sc.stages.no-fcd-duration`: "A completed project with no recorded construction start counts as finished, but not in the time spent in permit and construction".
- `sc.stages.running-max`: "Stage dates made non-decreasing (re-check of the project records' clamp)".
- `sc.exit.last-stage`: "An exit is placed at the last stage the project entered, no earlier than that stage's start".
- `sc.exit.purge-censor`: "An exit inside an administrative purge window counts as still open, not as a project decision".
- `sc.revision.ratio-clamp`: "A resize outside 0.25× to 3× is clamped to that range".
- `sc.revision.carried-excluded`: "A revision pair whose earlier home count was carried back from a later record is left out of the resize estimate".

**Shares on live data.** All six shares were measured on the live build `2026-10-17-1149782a` (`fired ÷ of`, as V30 reads them): `sc.stages.gap-impute` 73/1,991 = 3.67% and `sc.stages.no-fcd-duration` 87/1,991 = 4.37% (both over windowed histories); `sc.stages.running-max` 0/3,753 and `sc.exit.last-stage` 0/1,025 (all qualifying histories; both rules re-check project-records' clamps and fire 0 times on a valid file); `sc.exit.purge-censor` 0/406 over windowed exits (conductor ruling C3), while unwindowed it censors 12 of 1,025 qualifying exits in one purge window, 1996-05-21 (12 `permitFiled` withdrawals, median 1,376 days in stage), before 2007-01-01 and so outside every fitted window; `sc.revision.ratio-clamp` 16/176 = 9.09% (40/209 = 19.14% before the split-row producer fix). Every share is under its warn share: 0.1 for `sc.stages.gap-impute` and `sc.revision.ratio-clamp` (partner ruling via conductor, 2026-10-18 (DQ-4)), the kind defaults for the rest (0.05 for `sc.stages.no-fcd-duration`, kind `missing`; 0.01 for the other three). (The earlier wave-1 probe of `sc.stages.gap-impute`, before the P1 amendment, gave 447/3,738 = 11.96% unwindowed and 125/1,987 = 6.29% windowed; the earlier purge probe gave 21/1,025 unwindowed in two pre-2007 windows.) On the live build `2026-10-19-844f8c99` (after project-records' combined pass carried 908 filing sizes back, Ruling U1) the seventh rule, `sc.revision.carried-excluded`, is 134/1,143 = 11.72% (all 134 excluded pairs are `permitFiled` pairs that would have counted as unrevised; the `permitFiled` probability moves from 149/755 = 0.197351 to 149/621 = 0.239936 and the ratio bins are unchanged), above its fail share 0.10, so V30 fails that build pending a share ruling (reported, not overridden); `sc.revision.ratio-clamp` is 14/198 = 7.07% there. A later live build re-measures every share in its completion report. A share above the defaults needs an override ruling before the live build: that is a DQ-4 escalation, not an in-frame change. Without a ruling, V30 warns above 0.01 and fails a live build above 0.10 (for `sc.stages.gap-impute` and `sc.revision.ratio-clamp`, the ruled 0.1 and 0.2).

**Counting.**
- `fired` counts the records the rule changed: histories for the four stage and exit-placement rules (for `sc.stages.no-fcd-duration`, the windowed no-FCD completions), exits for `sc.exit.purge-censor`, pairs for `sc.revision.ratio-clamp` (clamped pairs) and `sc.revision.carried-excluded` (excluded pairs, `sample` `<history id>:<at stage>`). `of` counts the denominator above (`sc.stages.gap-impute` and `sc.stages.no-fcd-duration` count both over windowed histories, `sc.exit.purge-censor` over their exits; see the table). A history that one rule changes at several stages counts once in `fired`; the per-stage breakdown is printed in the calibration report.
- The step reports each rule by calling `recordQuality(counts, id, { fired, of, sample })` (T14) on the build's single `counts` object (the `report.json` counts). `recordQuality` is the only writer of `quality.*` keys, and it throws on an unregistered id. The step writes no `quality.*` key itself.
- `sample` is the rule's affected record ids, `<history id>` or `<history id>:<stage>` where a stage applies, sorted in code-unit order. `recordQuality` dedups them and sends the first 25 to `quality-report.md` (T14 `sample`; IC-R5 resolved).
- Counts are taken on the first of the two in-run computations (V29). Both computations apply the same rules, and the second must give the same counts.
- Every rule reports, including a rule that fires 0 times (V30).
- The `sc.*` rules change values only in the calibration step's memory. They add nothing to T4d `quality`, which stays project-records' record of its own rules.

**Method counts** (not T14): `calibration.method.permitOnlyPre2015` (histories nulled by §4.4 step 4, of qualifying `permitOnly` histories), `calibration.method.ppaPooled` (preApplication spells pooled by step 5) and `calibration.method.sizeOverEnvelope` (size histories with r > 1 mapped to fill 1, §4.8). Each also appears in the `method` text of the provenance it affects. They have no warn or fail shares.

**Fixture cases.** Each `sc.*` rule gets a fixture case that fires it at least once on the hand-made histories of its unit test (§6), and `calibration-invariants.test.ts` asserts each rule's `fired` and `of` on fixture-0 (golden computed at implementation). Where fixture-0's mini histories do not exercise a rule (expected for `sc.stages.running-max` and `sc.exit.last-stage`, which fire 0 on valid T4d input), the assertion is `fired = 0` with `of` > 0.

### 4.5 Fallback ladder (every applicable cell is always filled)

A rung passes when the cell has spells ≥ `N_SPELLS_MIN` and events ≥ `N_EVENTS_MIN` in its window, and §4.4's rejection checks pass. Both count observed, unweighted records (controller ruling R18; `AjSweep.observed`), never the weighted mass of §4.4 step 1.

**Planning-side stages** (filed, entitled):
1. **Pathway-specific AJ** over [2015-01-01, asOf]. Tier 0. Method: "Aalen–Johansen cumulative incidence, right-censored at last observation, left-truncated at window start". The tail is covered by `tailProvenance`.
2. **Pooled AJ.** All pathways plus null-pathway spells, copied into the cell. Tier 2, "pooled across pathways". preApplication always uses this rung, over 2015+.

**Permit-side stages** (permitFiled, permitIssued, construction): **pooled shape, pathway level** (round 3). The rule is a stratified proportional-hazards scaling of the pooled Aalen–Johansen table.
- **Pooled component.** AJ over every qualifying spell, of any pathway including null, in [Wₛ, asOf]. At each pooled event duration *d* it gives the cause-specific hazard increments ĥ_j(d) = e_j(d)/n(d) and the pooled tail rates λ_j.
- **Pathway level.** For pathway *p* and outcome *j* (advance or each exit reason), take *p*'s spells in [2015-01-01, asOf], left-truncated at 2015-01-01, with at-risk counts nₚ(d).
  - O_{p,j} = *p*'s observed *j* events;
  - E_{p,j} = Σ_d nₚ(d)·ĥ_j(d) + (*p*'s tail-span person-months)·λ_j;
  - θ_{p,j} = (O_{p,j} + κ) / (E_{p,j} + κ), with κ = `PH_PRIOR` = 5 (tier 4). This is a gamma-prior shrinkage toward 1, the pooled level.
  - Every *p* event is also a pooled event, so E is defined at every *p* event time.
- **Pathway table.** The AJ recursion re-run on the pooled event grid with h_j(d) = θ_{p,j}·ĥ_j(d). If Σ_j h_j(d) > 1, all of them are scaled down so the sum is 1, and the count goes in the report. The tail is λ_{p,j} = θ_{p,j}·λ_j through the §4.4 tail formula. `months` is the pooled table's.
- **Why this rule.**
  - Durations in permit review and construction are set mostly by administrative queues and building physics. They are estimated far more precisely from about 19 years of records (2007 on) than from about 11 (2015 on).
  - Pathways differ mainly in level, for example in how often a streamlined permit is abandoned. One constant ratio per outcome is the smallest model that keeps each pathway's own 2015+ level, and κ keeps thin pathways near the pooled table instead of at 0 or ∞.
  - Unlike multiplying the cumulative incidence by a constant, this keeps advance + Σ exit ≤ 1, monotonicity and competing-risk consistency by construction.
  - **Diagnostic.** The report prints, for each pathway and stage, the maximum absolute difference between the scaled table and *p*'s own 2015+ AJ. The build warns if it exceeds 0.05.
- **Thin pathways.** If *p* has fewer than `N_SPELLS_MIN` spells in 2015+, θ = 1 (pure pooled), and the method says so.
- **Provenance.**
  - Tier 2.
  - `label`: "SF permit records 2007–<asOf year>, pooled across pathways before 2015, scaled to <pathway> 2015–<asOf year> (tier 2)".
  - `method`: "Pooled Aalen–Johansen over all spells since 2007-01-01, the first assessor roll (existing homes at filing are known only from then; pooled across pathways before 2015; pathway unknowable); cause-specific hazards scaled by θ = (O+5)/(E+5) from <pathway> spells since 2015-01-01 (proportional hazards): advance θ=…, <reason> θ=…".
  - `n`: pooled spells. `method` also gives the pathway's 2015+ spells.
  - For `permitIssued` and `construction` the `method` also states "k completions without a construction start (no FCD) kept in incidence, durations from histories with an FCD (rule sc.stages.no-fcd-duration)", with the cell's X, A and w (ruling R13 and its guard, §4.4 step 1).
  - `window`: [Wₛ, asOf].
- **Fallback.** If the pooled component fails the thresholds, rung 3.
3. **Literature synthetic.** A constant-hazard table with `months = 1`:
   - q = 1 − 2^{−1/D};
   - `advance[0]` = tail.advance = A·q;
   - exit_j = E_j·q, where E_j = (1 − A) × the stage's observed exit-reason shares across all spells in the window (tier 2), or all of it on the primary reason if no exits are observed (tier 4);
   - the tier is the worst of D, A and E;
   - every value is rounded up to 1e-6 (controller ruling R25; §4.4 "Rounding"), which keeps C(k) ≥ 1 − 2^{−k/D}, so the median month (`typicalMonths`) is never later than ⌈D⌉ (exactly D for an integer D).

| stage | D (months) — tier, source | A — tier, source | primary exit (tier 4) |
|---|---|---|---|
| preApplication | 6 — tier 3, lit. "0–12 mo" midpoint | 0.862 — tier 2, 650 of 754 PPAs have a parent PRJ (probe) | withdrawn |
| filed | discretionary 17.2 (523-day average, 2022 APR, HCD review) — tier 1; streamlined 3.42 (SB 35 median, HCD) — tier 1 | 0.82 — tier 1, Housing Element conversion "PL filed" | withdrawn |
| entitled | 12 — **tier 4** | 0.66 — tier 1, HE "PL approved" | expired |
| permitFiled | 19.9 (605-day average, 2022 APR) — tier 1 | 0.70 — tier 1, HE "BP filed" | expired |
| permitIssued | 3 ("usually within 90 days", 2025 Housing Inventory) — tier 1 | 0.74 — tier 2, probe cohort 196 of 266 | expired |
| construction | 21.7 (US 20+ units, Census/NAHB 2025) — tier 3 | 0.98 — **tier 4** | cancelled |

The build warns for each rung-3 cell. In live mode none is expected.

### 4.6 Initiation model (T4a)

**Features: read, never computed or imputed here** (round 2, "Initiation features. One definition"). scenario-data computes every feature, its imputation, its T14 rules and the `imputed` mask. Every panel value is post-T14 (T13).

- **Historical panel.** Each value is read from the `scenario_panel` row (T13 `parcel-panel.parquet`) for that roll year:

  | FeatureId | column |
  |---|---|
  | `potentialRatio` | `potential_ratio_base` |
  | `existingUnits` | `existing_units` |
  | `lotAreaM2` | `lot_area_m2` |
  | `yearBuilt` | `year_built` |
  | `storiesGap` | `stories_gap_base` |
  | `improvementShare` | `improvement_share` |
  | `rentControlLikely` | `rent_control_likely` |
  | `landUseClass` | `land_use_class` |

- **FZP application.** It reads T11 through scenario-data's `featureValue(p, i, f, 'fzp')`.

No value is altered. The `imputed` mask (T11/T13 mask convention) is not a model input. The report prints, for each mask bit, the share of at-risk exposure (parcel-months) whose panel row has that bit set, plus the share with any bit set:
- bit 0 `yearBuilt` (feature `yearBuilt`; also `rentControlLikely`);
- bit 1 `existingStories` (feature `storiesGap`);
- bit 2 `improvementShare`;
- bit 3 `existingUnits` (features `existingUnits`, `potentialRatio`, `rentControlLikely`), set by `sd.roll.units-capacity` and `sd.roll.units-spike`;
- bit 4 no roll row (every feature imputed);
- bit 5 row carried from the previous roll year (`sd.roll.year-gap`; mostly the 2011 roll's shortfall);
- bit 6 `existingFloorAreaM2` taken from the chunk record (`sd.roll.floor-area-missing`; the value the yields used, T11).

Bit 7 is reserved; a set bit 7 is a `CalibrationError` (the panel broke T13). The same shares are printed for event months, so a rule that concentrates on events is visible.

**Panel, at-risk set and event.**
- **Months.** Calendar months **2007-01** through 2025-12: every assessor roll year (round 3). The end is the last full month on pre-FZP zoning (FZP effective 2026-01-12). Months of year Y use roll Y.
- **Detection basis.** Planning records are reliable from 2015-01-01, the Planning-side window. For each qualifying history let F = the earliest of `entered.preApplication`, `filed` and `permitFiled`, and P = the **raw** first new-construction (type 1/2) site or full permit filing day: the minimum non-null `filed_day` over the `permits.parquet` rows whose `project_id` equals the history's `id` (IA-11). All of the project's rows count, superseded refiles included, because a refile's filing is still a filing. P is not `entered.permitFiled`: that day is clamped forward by `pr.stages.forward-clamp` (T4d) and can sit later than the first filing. F is the first entered day, which the forward clamp never moves.
  - **Basis "record"** if F ≥ 2015-01-01. The event day is F, and coverage starts at F. Tier 0.
  - **Basis "permit"** if F < 2015-01-01. The event day is P, if present, in whatever year it falls, and coverage starts at P. In this era only permit filings are reliably visible, so a project that never filed a permit (no `permits.parquet` row with a `filed_day`) is invisible: no event and no coverage. The months between F and P count as at risk. A P before 2007-01 falls outside the panel: no event month in the panel, and the parcel is covered from the panel start.
  - The event date is tier 0. Using it as the event is a **tier 2** proxy, because it misses projects that died before filing a permit and dates the rest later. The initiation `method` states this.
  - Each event month carries its basis.
- **Parcels.** A parcel-year is in the panel iff its `scenario_panel` row has **`hostable_base`** true (round 2). That column is eligible ∧ base stories ≥ 1 ∧ base yield > 0, evaluated for that roll year. Parcel-years with no panel row are excluded and counted. T11's `hostable` applies only to the FZP application.
- **Event.** The month of the event day under its basis, assigned to the history's primary parcel: the largest `lotAreaM2`, ties broken by the smaller id.
- **At risk.** The event month is at risk with event = 1. From the next month the parcel is not at risk while any qualifying history covers it (any of its `parcelIds`), from coverage start through the end month.
  - After an **exit**, it is at risk again from the next month. An exit censored as a purge (§4.4 step 6) is treated as still open through `asOf`.
  - After a **completion**, it never returns to risk.
  
  Both match the sim's rules in the reconciliation ("open questions answered"). The panel's base heights are the tier-3 proxy from the "Pre-FZP heights" ruling, and the initiation `method` says so.

**Bins.** Initial edges, tier 4 (binning choice):

| feature | edges |
|---|---|
| potentialRatio | 0, 1, 1.5, 2, 3, 5, 10, 20 |
| existingUnits | 0, 1, 2, 3, 5, 10, 20, 50 |
| lotAreaM2 | 0, 150, 250, 400, 800, 2000, 5000 |
| yearBuilt | 0, 1800, 1906, 1930, 1950, 1979, 2000 |
| storiesGap | −100, 0, 1, 2, 3, 5, 10 |
| improvementShare | 0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85 |
| rentControlLikely | 0, 1 |
| landUseClass | 0, 1, 2, 3, 4, 5 |

There are no "unknown" bins. scenario-data imputes every missing value; a 0 is a value, never a missing marker. The vacant-lot rule gives `yearBuilt` 0 and `improvementShare` 0, which fall in bin 0 by that rule, not by the mask. `potentialRatio` 0 is common: once `hostable_base` was decoupled from the density cap (partner ruling via conductor, 2026-10-18), the density cap still shapes the base yield, so a hostable parcel whose density-capped base envelope yields no units has ratio 0 (on the live panel, about 62% of at-risk parcel-years before 2023 and 5% from 2023 on). It is a value in the bottom `potentialRatio` bin [0, first inner edge) and takes that bin's fitted hazard (small and positive on live data); it is never dropped, and the initiation `method` states this treatment.

A numeric feature's highest bin with fewer than `MIN_BIN_EVENTS` events merges downward, repeatedly, and then the same runs upward from the bottom. The published `bins` are the merged edges.

**Extrapolation.**
- An FZP value above the top edge lands in the top bin (the clamp), so it gets the top bin's historical hazard.
- The report gives the share of hostable parcels, and of FZP expected filings, whose `potentialRatio` or `storiesGap` exceeds the maximum at-risk value seen in the panel. For those parcels the hazard is "tier 2, applied beyond historical support (top-bin clamp)" and probably understates the FZP response.
- `method` repeats the share. The tier stays 2.

**Fit.**
1. Rows are binned with the shared `binIndex`, aggregated into `FitCell`s, and sorted lexicographically by bin tuple.
2. The model is a binomial logit on (events, exposure): one Bernoulli trial per parcel-month, which is the discrete-time hazard likelihood.
3. The design is the intercept, a full one-hot over bins, and one **nuisance column** `basis`. It follows each event's own detection basis (round 4 N13): 1 for an event month whose event has basis "permit", 0 for basis "record". Non-event parcel-months take the basis in force for their month (1 before 2015-01-01, else 0), which is the basis an event in that month would have had. Ridge ½·`RIDGE_LAMBDA`·Σβ² applies to the bin coefficients only; the intercept and `basis` are unpenalised.
4. IRLS starts from the intercept = logit(Σevents/Σexposure), with `basis` and the bins at 0. Each iteration solves the Newton system by a dense Cholesky in fixed column order. It stops when the full Newton step has max|Δ| < 1e-9 (that step is applied), with at most 100 iterations; non-convergence is a `CalibrationError` ("IRLS did not converge"). A larger step is **step-halved**: the step taken is the largest t = 2^−k (k = 0..30, `MAX_HALVINGS` 30) for which the penalised log-likelihood Σ(events·z − exposure·log(1 + e^z)) − ½λΣ_bins β² does not decrease by more than `OBJ_TOL`·(1 + |objective|), `OBJ_TOL` = 1e-12 (summation rounding). A full step that does not lower the objective is taken unchanged, so a fit that plain Newton handles gives the same bits. With rare events and a thin high-hazard bin the undamped step overshoots (the live panel after the `hostable_base` decoupling diverged to hazard 0 in every cell without it).
   - A Cholesky pivot at or below `PIVOT_TOL` = 1e-10 of its diagonal is an aliased column: its step is fixed at 0 (the column is dropped for that iteration). Dropping the intercept pivot, or the `basis` pivot while basis-1 exposure exists (no weight, or aliased with the intercept), is a `CalibrationError` ("IRLS: degenerate fit (…)").
   - No step with t ≥ 2^−30 that keeps the objective from decreasing is a `CalibrationError` ("IRLS: no Newton step … improves the fit").
   - A converged fit is checked: every column's penalised score Σ(events − exposure·μ) − λβ (intercept, each bin, `basis`; the −λβ term on bins only) must be finite and at most `SCORE_TOL`·(1 + Σevents) in absolute value, `SCORE_TOL` = 1e-6; otherwise it is a `CalibrationError` ("IRLS: degenerate fit (…)"). At the optimum every score is 0, and the intercept and `basis` scores are the per-basis back-cast identity (V28). There is no bound on the coefficients' size.
   - `MAX_HALVINGS`, `OBJ_TOL`, `PIVOT_TOL` and `SCORE_TOL`, like 1e-9 and 100, are numerical tolerances of the solver, not §4.11 method constants: they decide how the solver reaches the optimum and when a fit is rejected, not the optimum itself, and the report does not print them.
5. The published `InitiationModel` is the intercept and bin coefficients with `basis` = 0. The `basis` coefficient is printed in the report and in `method`, never shipped, so the T4a shape is unchanged. Coefficients are rounded to 6 significant digits.

**Why the term: it is a measurement-definition term** (round-3 addenda). Before 2015 the event is a permit-filing proxy, not the first Planning record, so its level differs by construction. The `basis` term absorbs that difference. It is **not** a market adjustment. Any market difference between eras that it happens to absorb is a side effect, and the report states that. The level that matches the simulation's event (first record) is therefore set by 2015+ data, while 2007–2014 parcel-years sharpen the feature coefficients. This mirrors the permit-side pooling in §4.5: long record for shape, reliable era for level.

It is **not** a calendar-year term: it is constant within each era and stands for a change in measurement, not market time. That keeps faith with OD-T3's "no calendar-year term".

The initiation provenance `method` says: "pre-2015 events detected by first new-construction permit filing (tier 2 proxy); a measurement-definition term (permit-filing proxy vs first Planning record) is fitted and not shipped, so the published level is set by 2015+ first-record events; this is not a market adjustment; basis coefficient = …".

**Back-cast.** Predicted events per year 2007–2025 (Σ hazard over at-risk parcel-months, with each year's basis) beside observed events, labelled by basis.
- **Gate (V28):** the predicted total is within 2% of the observed total, checked separately for each basis.
- **Report only:**
  - per-year ratios;
  - per-bin observed and predicted;
  - a hold-out fit on 2007–2022 predicting 2023–2025;
  - FZP expected filings per year (12·Σ hazard over hostable parcels with no in-flight project) against the historical mean, with a warning outside [0.5, 20] (tier-4 sanity band).

**Fallback.**
- **Live mode:** fewer than `INIT_MIN_EVENTS` events is a `CalibrationError`.
- **Fixture mode:** a fixed model with `terms = []` and intercept = logit(0.05). This is **tier 4**, labelled "fixture: high hazard so simulated starts appear within the e2e horizon" (reconciliation, "Fixture-0 contents").

### 4.7 `pathwayForNew` and `ppaShare`

- **`pathwayForNew`.** The pathway shares among qualifying, non-null-pathway histories whose first record falls in [2015-01-01, asOf] (Planning-reliable, since pathway is known only then). Tier 0. timelapse-sim applies it only to new projects on non-`localProgram` parcels; Local Program parcels take `streamlined` by the reconciliation's rule. If fewer than `N_SPELLS_MIN` histories qualify, the fallback is the pathway mix of T3 in-flight projects (tier 0).
- **`ppaShare[p]`.** The share of pathway-*p* qualifying filings (first non-PPA entry in [2023-07-08, asOf]) that have a preApplication entry. Tier 0. The method reads: "measured after the PPA record series ended (2023-07-07)". This follows the reconciliation, and the value is expected to be 0. With no filings in the window the value is 0, tier 4, "not measured".
- **`streamlinedForLocalProgram: Provenance`** (round 2). This entry documents that new projects on `localProgram` parcels use the `streamlined` tables. fzp-mode cites it for Local Program projects.
  - **Tier 2.** The streamlined tables (SB 35, SB 423, AB 2011, AB 2162, HSD ministerial) stand in for the Local Program, which has no recorded history of its own.
  - **`label`:** "Local Program projects use streamlined-pathway rates (tier 2 proxy)".
  - **`method`:** "Local Program = administrative approval, 180-day clock, no DR or appeal (rule, tier 1: Planning Director Bulletin 11); durations and attrition taken from the streamlined tables, n = <streamlined spells>".
  - **`n`:** the streamlined spells across all stages.
  - **`window`:** [2015-01-01, asOf].
  - **`sources`:** the Planning Director Bulletin No. 11 URL (literature §1) plus the DataSF pages.
  - **Diagnostic.** The report also prints the count of Local Program-era filings (since 2026-01-12) and their median days from `filed` to `entitled`, if any, against the 180-day clock. Nothing uses those numbers.

### 4.7a `phaseGap` (T4, partner rulings round 3)

`phaseGap.days` holds the empirical gaps in days between successive phases' permit filings in past multi-phase projects. timelapse-sim draws from it uniformly by index for phases with no published schedule.

**Identifying past multi-phase projects in the records** (round 4 N1). The input is project-records' `permits.parquet` (T4d row), one row per linked type 1/2 permit. Its column names are used as-is, and they are a subset of the T4d row's column list:
- `permit_number`, `project_id`;
- `prx_case_no`, `dva_record_id`, `da`;
- `proposed_units`, `site_permit`, `superseded`, `filed_day`.

The **DA key** is `coalesce(prx_case_no, dva_record_id, da)`. Permits with a non-null DA key form one **DA group** per key. Grouping is by DA key, not by history id: one DA's phases may sit in several histories.

**Phases of a group.**
- **Which permits.** The group's rows with `proposed_units` ≥ `PHASE_MIN_UNITS` = 10 (tier 4) and non-null `filed_day`. Every row is already type 1/2. Both site and full permits count.
- **Refiles.** Rows with `superseded` true are dropped, because a refile is not a new phase.
- **Same day.** Permits filed on the same day count as one phase.
- **Gaps.** Phases are sorted by filed day. The gaps are the differences between successive filed days, in days and always > 0.
- **Window.** Permits filed from 1989-01-01. This is `phaseGap`'s own window and is **decoupled** from the transition windows (DQ-1): those start on 2007-01-01 because the qualifying predicate needs existing units from the assessor roll, and phase gaps use only permit filing days, never existing units.

**Output and ladder.** `days` is all gaps across groups, sorted ascending.
1. **DA groups.** Every DA group with ≥ 2 phases contributes its gaps. The rung passes with ≥ `PHASE_MIN_GAPS` = 10 gaps in total (tier 4 threshold).
   - Tier 2.
   - `label`: "Gaps between phase permit filings in past SF Development Agreement projects (tier 2)".
   - `method`: the group count, the gap count, the median and the IQR, and the sentence "window 1989-01-01 on, decoupled from the transition windows (2007-01-01 on, set by the first assessor roll): phase gaps use permit filing days only, not existing units".
   - `n`: the gap count; `window`: [1989-01-01, asOf].
2. **Fallback, tier 2.** Group all rows by `project_id`, and keep projects with ≥ 2 qualifying permits (≥ 10 units, not superseded). These are large multi-building projects, DA or not. The same gap rule applies. `method` says "not DA-specific". The "≥ 2 qualifying permits per project" condition exists only on this rung.
3. **Last resort.** `days = [730]`, **tier 4**, "made up: no multi-phase history found". This is expected only in fixture builds.

### 4.8 SizeModel (T4b)

- **Fill levels.** `fillLevels` = `FILL_LEVELS` imported from T11 ([0.25, 0.5, 0.75, 0.9, 1], F = 5).
- **Measurement.** Qualifying histories with first record in [2015-01-01, asOf] and with `storiesProposed` and `baseStoriesAtFiling` both ≥ 1. The ratio r = storiesProposed ÷ baseStoriesAtFiling is snapped to the nearest fill level, ties going up. r > 1 (density bonus) maps to 1. This is a model choice, not a T14 rule (§4.4a): it is counted as `calibration.method.sizeOverEnvelope`, its share is printed in the size section, and the size `method` states it ("r > 1, mostly density-bonus projects, counted as fill 1: k of n").
- **Buckets.** `maxStoriesUpTo` edges are 4, 6, 8, 12, 999 (999 = any; tier 4). A history goes to the first bucket with base stories ≤ edge.
  - A bucket with fewer than `SIZE_MIN_N` histories merges into its lower neighbour, or its upper one for the first bucket.
  - `probs` are rounded to 6 decimals, with the residual added to the largest so they sum to 1.
- **Tier.** 2. `method` notes that `baseStoriesAtFiling` is a tier-3 proxy (T4d).
- **Fallback.** If n < `SIZE_MIN_N`, a point mass at fill 1, tier 3 (the Housing Element site-yield method).

### 4.9 RevisionModel (T4c)

- **Pairs.** T4d records units only for `filed` (PRJ), `permitFiled` (permit) and `complete` (TCO/CFC), so there are two `at` entries, in this order:
  - `permitFiled`: previous = `unitsAt.filed`, new = `unitsAt.permitFiled`;
  - `permitIssued`: previous = `unitsAt.permitFiled`, new = `unitsAt.complete`, completed projects only. T4c forbids revisions on or after construction, so the permit-to-completion change is placed on entering `permitIssued`. That attribution is tier 2, and `method` says so.
- **Measurement.** A pair counts when both counts are ≥ 1 and the later stage was entered in [2015-01-01, asOf] (PRJ units, needed for the `permitFiled` pair, exist only then; both pairs use one window). A revision means the counts differ. `probability` = revised ÷ pairs.
- **Carried-back counts** (partner ruling via conductor, 2026-10-18, "Exclude from resize estimate"). project-records' Ruling U1 writes `unitsAt.filed` of a history whose `quality` includes `pr.units.filed-zero` or `pr.units.split-filed` from its next recorded count (`permitFiled`, else `complete`; `carriedFiledUnits`), so that count was copied, not observed. A pair whose previous or new count is such a carried value (the `permitFiled` pair; the `permitIssued` pair reads no `filed` count and is kept) is left out of the probability and ratio fits and of `n`, after the filters above and before the ratio clamp; it is counted by the registered observation rule `sc.revision.carried-excluded` (§4.4a), and `method` states "k pairs with a carried-back earlier home count excluded (partner ruling; rule sc.revision.carried-excluded)". Every other estimate (incidence, durations, exits, size) keeps the history.
- **Ratios.** Among revised pairs, new ÷ previous is clamped to [0.25, 3] through the registered rule `sc.revision.ratio-clamp` (§4.4a) and binned with `edges` [0.25, 0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3] (tier 4). The edges include 1, so the shrink and grow shares are separable (T4c). A clamped ratio of exactly 3 falls in the last bin [2, 3], which is closed above for this purpose. Sampling within a bin is uniform.
- **Exclusions.** A project's first stage is never revised; its proposal is `revisions[0]` (reconciliation). Pipeline projects are counted only for entries after their first stage.
- **Fallback.** Fewer than `REV_MIN_N` pairs uses all pairs pooled (tier 2). If the pooled pairs are also fewer, `probability` = 0 (tier 4, "no revision evidence").
- **Tier.** 2: `unitsAt` is cross-record (T4d).

### 4.10 Provenance, outputs, invariants

**Provenance.** These entries each carry a T4 `Provenance`:
- every Transition, and its `tailProvenance` entry;
- `initiation`, `size`, `revision`, `pathwayForNew` and `ppaShare`;
- `streamlinedForLocalProgram` and `phaseGap.provenance`.

The initiation provenance has `window` [2007-01-01, 2025-12-31], and its `method` names the detection basis (tier 2 before 2015).

Each `Provenance` has these fields:
- `label`, e.g. "SF permit & Planning records 2015–2026 (tier 0)";
- `sources`: `https://data.sf.gov/d/<id>` for tiers 0–2, or the research doc's URLs for tiers 1/3;
- `method`, naming the estimator, rung, the `sc.*` rule counts and `calibration.method.*` steps that touched the entry's spells or pairs, proxies and any own span;
- `n` and `window`, mandatory for tiers 0–2.

Any tier-3/4 component is named in `method`, e.g. "D = 12 mo (tier 4, made up)". fzp-mode's dialog reads these from `calibration.json`.

**`calibration.json`.**
- Keys follow T4 order, with `PATHWAYS` order and `STAGE_ORDER`. `JSON.stringify` with no whitespace.
- Expected 40–120 KB; limit **256 KB** (tier 4 budget).

**`calibration-report.md`** (not shipped) is deterministic, with no wall-clock times. Its sections:
1. header;
2. the window rule;
3. per-pathway transition tables: rung, tier, n, events, window, `months`, eventual shares (project- and unit-weighted), `typicalMonths`, and the per-stage `sc.*` rule counts; the window section also prints `calibration.window.preRoll`;
4. the TCO-versus-`completed_date` construction-duration diagnostic;
5. initiation: bins with exposure, events and coefficient; the back-cast; the extrapolation share; the FZP expected filings; the exposure and event shares per `imputed` bit (bits 0–6, §4.6);
6. size and revision;
7. `pathwayForNew` and `ppaShare`;
8. a parameter index with tier and source;
9. the method constants;
10. the `sc.*` rules: id, label, tier, action, `fired`, `of` and share (the same counts `recordQuality` writes; the top-25 record lists are in `quality-report.md`, not here), then the `calibration.method.*` counts.

`fixture --update-golden` copies the fixture report to `pipeline/test/fixtures/mini/golden/calibration-report.md`.

**Determinism.**
- Inputs are sorted (spells by pathway, stage, project id; panel rows by key), and every sum runs in that fixed order.
- The only randomness is V27's `mulberry32(0x5eed)`.
- The step runs twice in-run, and the outputs must be byte-identical.

**`report.json` counts.**
- `calibration.histories`, `.qualifying`, `.pathwayNull`, `.window.preRoll` (DQ-1), `.method.permitOnlyPre2015`, `.method.ppaPooled`, `.method.sizeOverEnvelope`, `.spells.<pathway>.<stage>`, `.rung3`, `.panel.parcelYears`, `.panel.exposureMonths`, `.panel.events`, `.purge.windows`, `.bytes`.
- `quality.<id>.fired` and `quality.<id>.of` for every `sc.*` rule (§4.4a), written through `recordQuality`. These replace the former `calibration.adjust.*` counts and `calibration.purge.censored` (now `quality.sc.exit.purge-censor.fired`).

**Invariants.** Run by `build` and `check`.

| id | check |
|---|---|
| V25 | `parseCalibration` accepts `calibration.json`; `size.fillLevels` equals T11's `FILL_LEVELS` element for element (AC-8; ruling A2: `parseCalibration` checks F only internally, so this check imports `FILL_LEVELS` from `src/lib/data`); `asOf` equals T3 and T4d `asOf`; size ≤ 256 KB |
| V26 | Every pair a project can occupy is present (`pathwayStages`). Every T3 in-flight project's (pathway, stage) has a cell. Every cell passes the §4.4 rejection checks |
| V27 | **Reproduction.** For every Transition, 100,000 seeded `sampleTransition` draws (from m = 0) give an empirical cumulative incidence, by `monthsIn(0, days) + 1`, within **0.005** of `cumulativeIncidence(t, k)` at every month k = 1..`months` for advance and each exit reason, and the eventual shares within 0.005 |
| V28 | Initiation back-cast total is within 2% for each detection basis (live mode only) |
| V29 | Determinism: two in-run computations are byte-identical |

**V27 and the purge rule under pooled tables** (round 3, re-checked).
- **V27 still holds.** It tests sampler-to-table consistency, which does not depend on how a table was estimated. A θ-scaled permit-side table has the same structure as any AJ table: monotone, Σ ≤ 1 (after the step cap), and ρ > 0. A synthetic test (below) checks that scaled tables pass V27, and V26 rejects any that do not.
- **The purge rule still holds.** Detection runs on all qualifying exits over the full record. The pre-2015 permit era is now included, and so are any historical DBI batch expirations in it. The trailing 365-day baseline adapts to each era's exit volume. Because censoring is applied once, in normalisation (step 6), both the pooled component and every pathway's 2015+ component see the same censored spells, so O and E in θ are consistent. The report lists purge windows from every era.

**`docs/dev/pipeline.md` update** (round 2; owned here).
- The Invariants paragraph's range "V1 to V14" grows to cover the new invariants. project-records edits the V20–V24 part, and stage-calibration appends this sentence:

  > V25 `calibration.json` parses (`parseCalibration`), its fill levels equal `FILL_LEVELS`, its `asOf` matches `projects.json`, and it is ≤ 256 KB; V26 every occupiable pathway × stage table is present; V27 sampling reproduces each table's cumulative incidence within 0.005; V28 the initiation back-cast total is within 2% of observed filings; V29 calibration is deterministic. Method constants live in `pipeline/lib/fzp-cal/` (`LIVE_CAL`, `FIXTURE_CAL`); the full table is the stage-calibration spec §4.10–4.11.

- The "Where things land" list gains `pipeline/.cache/derived/<datasetVersion>/calibration-report.md` (not uploaded).
- The `sc.*` rules reach the doc's "Data quality" section through scenario-data's generator, which reads the registry. This subsystem writes no rule text into the doc by hand.

Probe URLs (verified 2026-10-16), base `https://data.sf.gov/resource/`:
- `y673-d69b.json?$select=max(open_date),min(open_date),count(*)&$where=record_type='PPA'`
- `qvu5-m3a2.json?$select=date_extract_y(open_date) as y,count(*)&$where=number_of_units_net>=1&$group=y`
- `d4jk-jw33.json?$select=date_extract_y(end_event_date) as y,count(*)&$where=project_stage='accepted to approved' AND end_event_type='approval'&$group=y`
- `i98e-djp9.json?…date_extract_y(filed_date|first_construction_document_date|completed_date|status_date)…`
- `j67f-aayr.json?$select=date_extract_y(date_issued)…`
- `wv5m-vpq2.json?$select=closed_roll_year,count(*)&$group=closed_roll_year`

### 4.11 Method constants (tier 4 unless noted; printed in the report)

| constant | LIVE | FIXTURE |
|---|---|---|
| `N_SPELLS_MIN` / `N_EVENTS_MIN` | 30 / 20 | 3 / 2 |
| `N_RISK_MIN` | 20 | 2 |
| `K_MAX` (months) | 240 | 240 |
| `TAIL_SPAN` / `TAIL_MIN_EVENTS` | 24 / 5 | 24 / 1 |
| `MIN_BIN_EVENTS` | 10 | 1 |
| `RIDGE_LAMBDA` | 1.0 | 1.0 |
| `INIT_MIN_EVENTS` | 100 (else fail) | n/a (fixture model, §4.6) |
| `SIZE_MIN_N` / `REV_MIN_N` | 30 / 30 | 2 / 2 |
| V27 tolerance | 0.005 at N = 100k | same |
| `COVERAGE_GUARD` | on | off |
| `PURGE_MIN_EXITS` / `PURGE_RATIO` | 10 / 10 | same |
| `PURGE_MIN_DAYS` (median duration in stage) | 730 | same |
| `PURGE_GAP_DAYS` | 30 | same |
| `PH_PRIOR` κ (θ shrinkage) | 5 | 5 |
| `PHASE_MIN_UNITS` / `PHASE_MIN_GAPS` | 10 / 10 | 10 / 1 |

`MONTH_DAYS` and `OPEN_DAY` are definitional and have no tier. `DYING_DAYS` is display-only, tier 4, and unused here.

### 4.12 Fixture calibration

- **fixture-0.** `pipeline fixture` runs the step with `FIXTURE_CAL` on project-records' mini histories (at least one in-flight project per stage, one PPA, one multi-phase row) and scenario-data's two-roll-year mini panel. It writes `e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json` and adds it to the golden set (`pipeline/steps/fixture.ts:25-31`). Rung 3 and the fixed high-hazard initiation model are expected here.
- **`src/lib/timelapse/fixtures/calibration-small.json`.** A hand-made, round-number calibration labelled tier 4 "test fixture", with these properties:
  - discretionary `permitFiled`, `months` = 12: `advance` linear to 0.60, `exit.expired` linear to **0.10**, tail advance 0.05, tail expired 0.01;
  - other cells: constant-hazard tables;
  - initiation: one term, `potentialRatio` [0, 2, 5] with coefficients [0, 0.5, 1];
  - F = 5.

  It is **stage-calibration's own** unit fixture, used by `model.test.ts` and `reproduce.test.ts`. Other subsystems keep their own fixtures, and this spec does not supply them:
  - timelapse-sim: `src/lib/sim/scenario/fixtures/mini-calibration.json`, which must pass `parseCalibration`;
  - timelapse-render: hand-made lookups in `src/lib/map/fixtures/timeline-lookups.ts`;
  - fzp-mode: reads fixture-0's `calibration.json`.

### 4.13 Error states

**`CalibrationError`** aborts `build`, so nothing is uploaded. It fires on:
- a coverage gap;
- an `asOf` mismatch;
- non-convergent IRLS, and a degenerate IRLS fit (§4.6 Fit step 4: a dropped intercept or `basis` pivot, no ascent, or a converged fit whose penalised score exceeds `SCORE_TOL`);
- a flagged pooled no-FCD cell with X > 0 in the live build (§4.4 step 1, ruling R29);
- live initiation events below the minimum;
- a `parseCalibration` failure of the output.

**Warnings** (in `report.json`): rung-3 cells, the FZP filings band, the permit-side θ diagnostic above 0.05 (§4.5). A `sc.*` rule above its `warnShare` warns, and above its `failShare` fails a live build, through V30 (scenario-data), not through this step.

## 5. Seams

- **Policy levers (T9).** Every behavioural number is in `calibration.json`, as plain JSON with `schema: 1`. `parseCalibration` validates any transformed calibration too. Nothing else is done now.
- **Addenda sub-stages.** Spells, the estimator, the ladder, `chanceTable`, `typicalMonths` and the validator all iterate `pathwayStages`/`STAGE_ORDER`, with no per-stage code. A future split edits T2 and the coverage table. Nothing else is done now.
- **DA phasing (in scope, round 3).** `phaseGap` (§4.7a) is computed here. `multiPhase` histories run through the ordinary tables, and the report counts them. Phase splitting and scheduling belong to project-records and timelapse-sim.
- **Renderings.** Not applicable.

## 6. Testing

**Server project (`npm run test:unit`), `src/lib/timelapse/`**
- `time.test.ts`: `monthsIn` at the boundaries ⌈k·M⌉ − 1 and ⌈k·M⌉; `OPEN_DAY` survives a Float32 round-trip.
- `math.golden.test.ts` (**cross-engine golden**). The fixture is `src/lib/timelapse/fixtures/math-golden.json`. It holds about 200 fixed inputs per function, each paired with the expected IEEE-754 bit pattern as a 16-hex-digit string. The expected patterns are generated once by the C fdlibm reference and committed.
  - **Inputs:** ±0, subnormals, 1, ln2 multiples, the overflow and underflow thresholds, values near 1 for `log`, the logit range [−30, 5], (1 − ρ) for ρ in [1e-6, 0.5], and NaN and ±Infinity.
  - **Check:** the test compares bits through a `DataView` and requires exact equality for every input.
  - **Where it runs:** in the server project (Node/V8) and, as `math.golden.svelte.spec.ts`, in the client project's Playwright Chromium. The client test must also pass under WebKit and Firefox when run with `--browser`. **Before AC-11 is signed off**, the operator runs it under both (`npx playwright install webkit firefox` first) and records the result in the completion report (step-0 carry-forward). Regenerating the golden needs `SDKROOT` set for `scripts/math-golden/generate.sh` on macOS.
  - It also asserts that `math.ts` source contains no `Math.exp|Math.log|Math.pow` and no `**`.
- `attribution.test.ts` (or the existing attribution test, extended; ruling A5): `math.ts` source begins its licence block with `/*!`, and `SOFTWARE` has an entry named `fdlibm (exp, log)`.
- `model.test.ts`:
  - `parseCalibration` accepts `calibration-small.json` and fixture-0's file, and rejects each rule violation (sum > 1, non-monotone, wrong length, ρ = 0, missing pair, `fillLevels` not ending at 1 or not ascending, a `probs` length ≠ `fillLevels.length`, revision `edges` without 1, a revision at `construction`, missing provenance), with the path in the error.
  - **A2.** A calibration whose `fillLevels` are valid but differ from `FILL_LEVELS` (for example `[0.5, 1]` with length-2 `probs`) is **accepted** by `parseCalibration`, because the F check is internal only. `calibration-invariants.test.ts` shows V25 rejects the same file. `model.ts` imports nothing outside `src/lib/timelapse` (AC-7, a source-scan assertion).
  - `binIndex` edges and clamping; `initiationHazard` matches the T4a formula.
  - `sampleTransition`: u = 0, u → 1, m ≥ `months`; `monthsIn(0, days) = k − 1`; days ≥ ⌈m·M⌉.
  - `eventualProbabilities` sums to 1.
  - `cumulativeIncidence` (IA-13): k = 0 gives all zeros; 1 ≤ k ≤ `months` returns the table values exactly; k > `months` matches the tail formula, hand-computed on `calibration-small.json` discretionary `permitFiled` at k = 13 and k = 24 (golden computed at implementation); advance + Σ exit equals C(k) at every k; each F_j is non-decreasing in k and stays below F_j(∞) from `eventualProbabilities(t, 0)`, approaching it as k grows; a reason present only in the tail has 0 in the table months; keys follow `EXIT_ORDER`; a negative or non-integer k throws `RangeError`.
  - `chanceTable`: hand-computed products along a permitOnly path and a discretionary path; length 241; index 240 equals the tail value.
  - `typicalMonths`: inside the table and in the tail.
- `reproduce.test.ts` (**AC-1**): 200,000 seeded draws from `calibration-small.json` discretionary `permitFiled` give expired by month 12 = 0.10 ± 0.005 and every month within 0.005 of `cumulativeIncidence`, including tail months 13–36. Conditional draws from m = 6 match `eventualProbabilities(t, 6)` within 0.005. The tail is geometric.

**Pipeline project (`npm run test:pipeline`), `pipeline/test/fzp-cal/`**
- `aalen-johansen.test.ts`:
  - **golden** hand-computed 7-spell example: 2 advance, 1 withdrawn, 1 expired, 3 censored, a tie of event and censoring, one delayed entry;
  - with no censoring it equals the empirical incidence;
  - all spells censored gives zeros;
  - monotone, Σ ≤ 1.
- `aj-recovery.test.ts` (property): 20,000 synthetic spells from a known Transition, with entries over 2005–2026, censoring at `asOf` and window 2015. The estimate recovers the truth within 0.02 at every month and for the eventual shares. A naive "dead among ended" estimator fails the same check.
- `spells.test.ts`: imputation, running maximum, exit clamp, null pathway and the defensive rule, preApplication pooling, delayed entry. Each normalisation case also asserts its count (for example: one history missing `permitIssued` between `permitFiled` and `construction` is in `normalise`'s `imputed` set once, and `gapImputeTally(imputed, spells, unobserved)` gives `fired` 1 with `of` = the distinct histories with a spell or an unobserved advance in a pooled window (an imputed history whose spells all end before the window is in neither `of` nor `fired`; a non-imputed windowed history adds to `of` only); a hand-broken unclamped history fires `sc.stages.running-max`; an exit dated before a later entered stage fires `sc.exit.last-stage`; a 2010 permit-only history adds 1 to `calibration.method.permitOnlyPre2015` and is not a `quality.*` key; every preApplication spell counts in `calibration.method.ppaPooled`). No-FCD completions (P1): a completed history with permitIssued 2010-03-01, no construction and complete 2012-05-01 gets no `sc.stages.gap-impute` for construction, `noFcd` true, no permitIssued or construction spell and two `unobserved` advances; the same with `entered.construction` on the completion day gives the same; a completion with a real FCD is unaffected; a no-FCD completion that also lacks `entitled` (discretionary) still imputes `entitled`; a null-pathway completion first seen at construction on its completion day drops its 0-day construction spell and has one `construction` unobserved advance; `noFcdTally` counts `fired` over windowed no-FCD completions with `of` = histories with a spell or an unobserved advance.
- `no-fcd.test.ts` (ruling R13 and guard): 10 advance spells with 5 unobserved give every advance w = 1.5; a cell of 10 advances, 10 exits and 5 unobserved has eventual advance share 15/25 (no censoring); A = 0 drops X and reports it; a pooled cell with A = 40, X = 10 (w 1.25, not flagged) and a pathway subset with A = 4, X = 3 (flagged) gives the subset's advances w = 1.25. With every w = 1 the AJ, tail and ph-pool goldens are bit-identical (`aalen-johansen.test.ts`, `tail.test.ts`, `ph-pool.test.ts`), and pathway spells identical to the pooled ones give every θ_j = 1 within 1e-12, with unit and non-unit weights (R14 identity). A flagged subset with X = 0 keeps w = 1 (R19); weights never lengthen a table or move k₀ (R18: `tableMonths` and the tail's k₀ count observed records).
- `sc-rules.test.ts` (T14 registration, §4.4a):
  - every `sc.*` id in the §4.4a table is in `QUALITY_RULES` once, with exactly the table's `owner`, `source`, `field`, `kind`, `action`, `tier`, `valueTier`, `maskBit: null`, `unitsWeighted: false`, label and shares (`sc.stages.gap-impute` at 0.1 / 0.2, the others at their kind's defaults — `sc.stages.no-fcd-duration`, the one `kind: 'missing'` rule, at 0.05 / 0.10 — so `kindDefaultDepartures(SC_RULES)` is `['sc.stages.gap-impute', 'sc.revision.ratio-clamp']`, `sc.revision.ratio-clamp` at 0.1 / 0.2 under partner ruling via conductor, 2026-10-18 (DQ-4)); there are seven;
  - no other rule has `owner: 'stage-calibration'` (in particular no pathway, pooling or size rule), and every `sc.*` id matches the T14 id pattern;
  - a calibration run on fixture-0 writes `quality.<id>.fired` and `quality.<id>.of` for every `sc.*` rule, including the zero-firing ones, plus the three `calibration.method.*` counts, and writes no `calibration.adjust.*` or `calibration.purge.censored` key;
  - the step source contains no write to a `quality.*` report key except through `recordQuality`.
- `tail.test.ts`, `fallback.test.ts`: the probability formula, extending k₀, rejection; rung selection, a rung-3 median of D, tiers and method text.
- `irls.test.ts`:
  - closed-form log-odds for one binary feature with no ridge;
  - known coefficients recovered from 2M simulated parcel-months within 0.05;
  - full one-hot plus ridge is identifiable;
  - non-convergence throws;
  - shuffled input gives byte-identical output.
- `initiation-panel.test.ts` (DuckDB, hand-made T13 and histories): not at risk while in flight, the event month counted, at risk again after an exit, never after a completion, the primary parcel, the 2025-12 cutoff, panel membership by `hostable_base`, and features read from the columns unchanged (no imputation code path exists). **Mask shares:** a hand-made panel with rows carrying bits 0, 1, 2, 3, 4, 5 and 6 gives the expected exposure and event share for each bit (counted by hand from the fixture rows), and a row with bit 7 set raises `CalibrationError`. The panel is read from the DuckDB table `scenario_panel` (ruling A6).
- `ph-pool.test.ts`:
  - with identical pathway and pooled hazards, θ ≈ 1 and the table equals the pooled one;
  - a pathway with a doubled exit hazard over 2015+ recovers θ_exit within 0.15 at n = 5,000, and its scaled table is within 0.02 of the truth;
  - no 2015+ events gives θ = κ/(E+κ);
  - the step cap engages and is counted;
  - scaled tables pass `parseCalibration` and the V27 check;
  - provenance label and method wording.
- `window.test.ts` (rewritten for DQ-1): Planning-side spells are cut at 2015-01-01; permit-side pooled spells of `permitFiled`, `permitIssued` and `construction` are all cut at 2007-01-01; a permit filed in 2004 and still in `permitIssued` in 2008 enters that stage's pooled table left-truncated at 2007-01-01 (a = 2007-01-01 − e); a history whose spells all end in 2005 contributes no spell and counts once in `calibration.window.preRoll`, while one with a spell ending on 2007-01-01 does not count there; permit-side provenance has `window` [2007-01-01, asOf] and the label "SF permit records 2007–…"; the coverage guard is on for live and off for fixture.
- `initiation-basis.test.ts`:
  - basis "record" versus "permit" by the F < 2015 rule;
  - **P from `permits.parquet` (IA-11):** a pre-2015 history with two permit rows filed 2011-03-01 and 2012-06-01, whose `entered.permitFiled` was clamped forward to 2012-09-01 by a later `entitled`, has its event in 2011-03, not 2012-09; a superseded refile filed earliest still sets P; a history with no `permits.parquet` row has no event and no coverage;
  - a pre-2015 project with no permit gives no event and no coverage;
  - the `basis` coefficient is excluded from the published model;
  - simulated panels with a known basis offset recover the feature coefficients within 0.05;
  - the back-cast holds per basis.
- `phase-gap.test.ts`:
  - grouping by `coalesce(prx_case_no, dva_record_id, da)`, including one DA spread over two `project_id`s that still forms one group;
  - permits under 10 units, superseded refiles and same-day phases are excluded or merged;
  - gaps sorted ascending;
  - the ladder falls back to rung 2 (tier 2) and then to [730] (tier 4);
  - a permit filed in 1995 contributes a gap (the 1989 window, decoupled from the 2007 transition windows), and the rung-1 `method` contains the "decoupled from the transition windows" sentence.
- `purge.test.ts`:
  - a synthetic history set with background exits plus 40 exits of median duration 1,200 days on 2026-09-15 and 2026-10-01 gives one window [2026-09-15, 2026-10-01];
  - the long-duration exits in it are censored on 2026-09-14, and the short-duration ones stay exits; `quality.sc.exit.purge-censor.fired` equals the censored count and `.of` the exits of windowed histories (C3), while `purgeCensor`'s unwindowed tally keeps all qualifying exits;
  - a purge window entirely before 2007 whose histories contribute no windowed spell gives `purgeCensorTally` `fired` 0 with `of` = the windowed exits, and the unwindowed tally keeps its counts;
  - a burst of 40 short-duration exits is not a purge;
  - the report section lists the window.
- `pathway-ppa.test.ts`, `size.test.ts`, `revision.test.ts`: shares and the fallback; the `ppaShare` window starts 2023-07-08; snapping on the F = 5 grid, r > 1 (counted in `calibration.method.sizeOverEnvelope` and stated in the size `method`), bucket merge; the two pair types, the clamp (a 10-to-1 resize fires `sc.revision.ratio-clamp` and lands in the [0.25, 0.5) bin; a 1-to-5 resize lands in the last bin), pooling; a history with `quality` `['pr.units.split-filed']` is left out of its `permitFiled` pair (not counted as unrevised) while the same history without the id counts, the probability and ratio histogram are computed without it, its `permitIssued` pair is kept, and `sc.revision.carried-excluded` reports `fired` and `of`.
- `calibration-invariants.test.ts`: V25–V29 pass on fixture-0, and each fails on a corrupted copy (V25 also on a file whose `fillLevels` parse but differ from `FILL_LEVELS`). fixture-0's `report.json` has `calibration.window.preRoll`, the `calibration.method.*` counts and every `quality.sc.*` pair, with values pinned in the golden (computed at implementation).
- `golden.test.ts` (existing): extended to `scenarios/fzp/calibration.json` and the golden `calibration-report.md`.

There are no DOM, e2e or axe tests, because this subsystem has no page and the report is not served. The client project runs only the browser-engine math golden. Every test calls `expect`.

## 7. Acceptance criteria

- **AC-1 ("if 10% die at stage z, ours do too").** For every Transition in the live and fixture calibrations, a seeded simulation of 100,000 entrants through `sampleTransition` recovers the table's cumulative incidence of advance and of each exit reason at every month, and the eventual shares, within 0.005 (V27). `calibration-small.json`'s `permitFiled` gives expired = 0.10 ± 0.005 by month 12.
- **AC-2.** Censored, left-truncated synthetic histories recover a known truth within 0.02.
- **AC-3 (DQ-1).** The report and provenance state the windows: Planning-side 2015-01-01; permit-side pooled from **2007-01-01** for `permitFiled`, `permitIssued` and `construction` alike, with pathway level from 2015. Permit-side provenance has `window` [2007-01-01, asOf], says "pooled across pathways before 2015", and names the first assessor roll as the reason for 2007. `report.json` has `calibration.window.preRoll`, and the report prints it. No Transition window starts before 2007-01-01.
- **AC-4.** Every parameter has a tier, label, method and source, plus n and window for tiers 0–2. The report indexes them all.
- **AC-5.** The initiation back-cast total is within 2%. The report shows per-year values, the hold-out, the extrapolation share and the FZP expected filings.
- **AC-6.** `calibration.json` is ≤ 256 KB and byte-identical across in-run repeats and fixture regenerations.
- **AC-7.** No statistics dependency is added, and `model.ts` imports neither Zod nor anything outside `src/lib/timelapse`.
- **AC-8 (ruling A2).** `size.fillLevels` equals T11's `FILL_LEVELS` (F = 5). V25 enforces the equality; `parseCalibration` checks the fill levels only internally (ascending, last = 1, every `probs` of length F), and timelapse-sim checks equality again when it assembles `SimInput`.
- **AC-9.** Every pathway × stage pair a project can occupy is present (V26). A live build warns for each rung-3 cell.
- **AC-10 (IA-13).** The worker, renderer, card and pipeline V-check all import T12's functions, and fzp-mode takes every cumulative share it shows from `cumulativeIncidence`. A repo search finds no second implementation of the sampling, chance or cumulative-incidence logic. (The fzp-mode half is verified when fzp-mode lands; this subsystem's half is that V27 reads the table through `cumulativeIncidence`.)
- **AC-12 (round 3, as amended by DQ-1 and IA-11).**
  - Permit-side Transitions are θ-scaled pooled tables over [2007-01-01, asOf], and their provenance says "pooled across pathways before 2015".
  - Initiation is fitted over 2007–2025 with the detection basis stated as tier 2. A basis-"permit" event is dated by the raw first `filed_day` in `permits.parquet`, never by the clamped `entered.permitFiled`.
  - `phaseGap` has ≥ 10 DA gaps (tier 2) in a live build, or is labelled with its fallback tier. Its window is [1989-01-01, asOf], and its `method` says it is decoupled from the transition windows.
- **AC-11 (deterministic math).**
  - `math.ts` `exp` and `log` return the committed fdlibm bit patterns for every golden input, on Node and in the browser test engines.
  - No `Math.exp`, `Math.log`, `Math.pow`, `Math.log1p` or `Math.expm1` appears under `src/lib/timelapse/` or `pipeline/lib/fzp-cal/`; the ESLint rule enforces this.
  - Fixed inputs to `sampleTransition`, `initiationHazard`, `chanceTable`, `typicalMonths` and `cumulativeIncidence` give bit-identical outputs across those engines.
  - Sign-off requires the client golden to have passed under WebKit and Firefox, recorded in the completion report (step-0 carry-forward).
- **AC-13 (data quality; orchestrator ruling "stage-calibration: residue after declarations").** The seven `sc.*` rules of §4.4a (`sc.stages.gap-impute`, `sc.stages.no-fcd-duration`, `sc.stages.running-max`, `sc.exit.last-stage`, `sc.exit.purge-censor`, `sc.revision.ratio-clamp`, `sc.revision.carried-excluded`) are registered in `QUALITY_RULES` with the stated fields and shares (the T14 kind defaults, except `sc.stages.gap-impute` at `warnShare` 0.1 / `failShare` 0.2 under conductor ruling C1 / partner DQ-4, and `sc.revision.ratio-clamp` at 0.1 / 0.2 under partner ruling via conductor, 2026-10-18 (DQ-4); `sc.stages.gap-impute` counted over windowed histories via `gapImputeTally`; `sc.stages.no-fcd-duration`, partner ruling P1, at the `missing` defaults 0.05 / 0.10, counted over the same windowed histories via `noFcdTally`), and reported through `recordQuality`. Every build reports `quality.<id>.fired` and `.of` for each of them, and no `calibration.adjust.*` key exists. Each rule has a fixture case that fires it, or a stated reason it fires 0 on valid input. No code in `pipeline/steps/calibration.ts` or `pipeline/lib/fzp-cal/` rewrites a history value outside a registered rule. The three model choices (pathway rule, preApplication pooling, size r > 1) are `calibration.method.*` counts stated in provenance. The completion report records every `sc.*` share measured on the first live dry run, and any share above the defaults carries an override ruling.
- **AC-14 (masks).** The report prints the at-risk exposure share and the event share for each `imputed` bit 0–6, including bit 3 (`existingUnits`), bit 5 (carried roll year) and bit 6 (`existingFloorAreaM2`); a set bit 7 is a `CalibrationError`. The mask is still not a model input.
- **AC-15 (ruling A5).** The shipped bundle keeps fdlibm's Sun notice (`/*! … */` in `math.ts`), and `/attribution` lists fdlibm.

## 8. Open questions

None remain from the original spec: the reconciliation answered all three (the window question is settled by partner rulings round 3 as amended by DQ-1, §4.4; `ppaShare` measured after 2023-07-07; Local Program parcels take `streamlined`).

The 16-pair reading of "every pathway × stage pair" is **confirmed** by the orchestrator's clarification in the reconciliation section.

## 9. Carry-forwards absorbed

From `.superpowers/superconductor/fzp-timelapse/wave1-assignments.md`, "Carry-forward for stage-calibration":
- **A2** (fill-level check split): §4.2 `parseCalibration`, V25, AC-8, tests.
- **A5** (fdlibm `/*! */` notice and `SOFTWARE` credit): §1, §4.1a, AC-15, tests.
- **A6** (`derivedRoot`/`derivedDir`; DuckDB tables `scenario_panel`, `parcel_lineage`): §4.3, `initiation-panel.test.ts`. `parcel_lineage` is not read (§1).
- **`permits.parquet` columns (round 4 N1)**: now in the T4d row; §4.6 (P) and §4.7a read only columns that row lists.
- **WebKit/Firefox math golden before AC-11 sign-off**: §6 `math.golden.test.ts`, AC-11.

The same file's "TR consumer notes" under that heading (R17 same-day revisions, R18 eager handle validation, `setTimelineLookups` identity, R8 `typicalDays` flooring) bind **timelapse-sim**, which builds schedules and sends the lookups, not this subsystem. IA-22 folds them into the timelapse-sim spec. Nothing here depends on them: T12's `chanceTable` and `typicalMonths` return fresh objects on every call, which is all the identity note needs from this side.

## Interface concerns (reappraisal 1)

- **IC-R1. T14 had no counting API.** **Resolved** (orchestrator): T14 exports `recordQuality(counts: Record<string, number>, id: string, c: { fired: number; of: number; units?: number; unitsOf?: number; sample?: string[] }): void`, the only writer of `quality.*` keys and `quality-report.md` rows. §4.4a calls it with `sample`.
- **IC-R2. `sc.*` share thresholds are unmeasured.** **Resolved** (orchestrator): the operator measures every `sc.*` share on the first live dry run; a share above the defaults needs an override ruling (DQ-4 escalation). `sc.stages.gap-impute` received one (C1 / DQ-4) and `sc.revision.ratio-clamp` received one (partner ruling via conductor, 2026-10-18 (DQ-4)); the other three remain unmeasured. Stated in §4.4a and AC-13.
- **IC-R3. Model choices registered as rules.** **Resolved** (orchestrator, accepted): the pathway rule, preApplication pooling and the size r > 1 mapping are removed from the registry and stay method steps (`calibration.method.*`, stated in provenance). T14 rules rewrite source values only. The seven `sc.*` rules (the seventh, `sc.revision.carried-excluded`, added by partner ruling via conductor, 2026-10-18) keep default shares, except `sc.stages.gap-impute` (conductor ruling C1 / partner DQ-4, 2026-10-18: 0.1 / 0.2, counted over windowed histories) and `sc.revision.ratio-clamp` (partner ruling via conductor, 2026-10-18 (DQ-4): 0.1 / 0.2).
- **IC-R4. `cumulativeIncidence` has no step-0 stub.** **Resolved** (accepted as written): SC adds it in step 2 with the row's signature and extends the compile-time Equals check of the T12 signatures (`src/lib/timelapse/types.test.ts`) in the same commit.
- **IC-R5. Top-25 affected records.** **Resolved** (ledger, "SC rulings applied by SC agent", 2026-10-17; T14 amended): `recordQuality` gains `sample?: string[]` (sorted affected ids; the first 25 go to `quality-report.md`). §4.4a passes each rule's sorted `<history id>[:<stage>]` ids as `sample`.

## Reappraisal 1 changes

- **Rows and constraints.** §2 rows T1, T2, T3, T4, T4a, T4b, T4c, T4d, T11, T12 and T13 replaced with the current design text; T14 added as a consumed row. §3 Evidence hierarchy and Global constraints replaced with the current text (adds the "Data quality" bullet). (Brief items 1–2; design Delta "Rows amended".)
- **Status, owns/consumes, scope.** Status line; owns the `sc.*` rules; consumes T14 and `permits.parquet`; out of scope: the T14 module, V30 and the eslint scope edit. (Orchestrator ruling "stage-calibration: residue after declarations"; IA-7.)
- **Windows (DQ-1, IA-12).** §4.4 window table: every pooled permit-side window starts 2007-01-01. "Why 2000" replaced by "Why 2007". Excluded volume counted as `calibration.window.preRoll`. Left truncation at 2007-01-01 stated. §4.5 "why this rule", label and method text use 2007. IC-15 marked superseded. `window.test.ts`, AC-3 and AC-12 rewritten.
- **phaseGap (DQ-1).** Keeps 1989-01-01; §4.7a, its `method` and a test say it is decoupled from the transition windows.
- **Normalisation into T14.** §4.4 steps 1, 2, 3 and 6 and the revision clamp ([0.25, 3]) are five registered `sc.*` rules with id, kind, action, rule/value tiers and denominator, at the default shares, except `sc.stages.gap-impute` (0.1 / 0.2, windowed denominator; §4.4a) and `sc.revision.ratio-clamp` (0.1 / 0.2), reported through `recordQuality`. Steps 4 and 5 and the size r > 1 mapping stay model-choice method steps under `calibration.method.*`, stated in provenance. Counts move from `calibration.adjust.*` and `calibration.purge.censored` to `quality.sc.*`. The operator measures every share on the first live dry run, and any share above the defaults needs an override ruling. Fixture cases and report-count assertions in `spells.test.ts`, `purge.test.ts`, `size.test.ts`, `revision.test.ts`, the new `sc-rules.test.ts` and `calibration-invariants.test.ts`; AC-13. (Orchestrator ruling "stage-calibration: residue after declarations", amended by the rulings on IC-R1..IC-R3; DQ-4; C1.)
- **Initiation basis P (IA-11).** P = min raw `filed_day` per `project_id` from `permits.parquet`, not the clamped `entered.permitFiled`. §4.6, `initiation-basis.test.ts`, AC-12.
- **Mask shares.** §4.6 reports exposure and event shares for each `imputed` bit 0–6, including bits 3, 5 and 6; a set bit 7 is an error. AC-14, `initiation-panel.test.ts`. (Mask convention ruling.)
- **`cumulativeIncidence` (IA-13).** Specified in §4.2 with the C(k) notation; used by V27; tests in `model.test.ts` and `reproduce.test.ts`; AC-10 now names fzp-mode's use; AC-11 covers it.
- **T12 contracts in rows (IA-15, IA-16).** The `days` contract, `math.ts` and the lint scope are now in T12; §4.1a states the three-glob scope and the `**` ban, and that timelapse-sim makes the `src/lib/sim/scenario/**` edit (IA-7, A3). `DYING_DAYS` readers per T1.
- **`parseCalibration` F check (IA-25, A2).** Internal check only; equality with `FILL_LEVELS` in V25 and timelapse-sim. §4.2, V25, AC-8, tests.
- **Revision edges include 1 (IA-28).** Added to the validator and §4.9.
- **`OPEN_DAY` (IA-27, A1).** `Math.fround(3.0e38)`, compared via the export.
- **fdlibm attribution (A5).** `/*! */` notice and `SOFTWARE` credit; AC-15 and a test.
- **Build plumbing (A6).** `derivedRoot`/`derivedDir`, the `scenario_panel` DuckDB table, `permits.parquet` via `read_parquet`. §4.3.
- **WebKit/Firefox golden (step-0 carry-forward).** Required before AC-11 sign-off.
- **Carry-forwards (§9).** SC's items absorbed; the TR consumer notes reassigned to timelapse-sim (IA-22).
- **Interface concerns.** IC-R1..IC-R4 marked resolved per the orchestrator's rulings; T14 row re-copied (adds `recordQuality` and the "source values only" sentence). IC-R5 (top-25 ids versus `recordQuality`) raised.
- **Doc debt.** Defect record 1 lists no stage-calibration corrections (the subsystem had not been dispatched); none folded.
- **Residue removed.** The 1989/2000 permit windows, the `storiesGap` imputation warning (features are never imputed here), "F ≠ 5" as a `parseCalibration` rejection, and `calibration.adjust.*`.
- **Fidelity pass 3 (2026-10-17).** Bit 6 = `existingFloorAreaM2` (ledger SD ruling; T11/T13 rows): §4.6 reports bits 0–6 and rejects bit 7 only, `initiation-panel.test.ts` and AC-14 follow (F3-1). §4.4a calls `recordQuality` with `sample`, IC-R1's signature carries it, and IC-R5 is resolved (F3-3, F3-9). Rules are declared in `pipeline/lib/quality-rules/sc.ts` (F3-13); no `sc.*` rule is `missing` (F3-2).
