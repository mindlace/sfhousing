# project-records: design spec

Status: derived 2026-10-16 from `docs/superpowers/design/2026-10-16-1903-fzp-timelapse.md` (approved), then updated to the design's "Interface reconciliation (2026-10-16, after spec derivation)". Slug `project-records`. Data-pipeline subsystem.

## 1. Scope

From the design:

> **`project-records`** (data pipeline). Ingests the tier-0 project datasets (`i98e-djp9`, `d4jk-jw33`, `qvu5-m3a2`, `y673-d69b`, `j67f-aayr`, `xdht-4php`, `6jgi-cpb4`) and links them into one record per project: PRJ ↔ permits via `building_permits`, plus parcel joins. It emits two things:
>   - (a) **historical project histories**, as input to calibration only, kept in the pipeline cache and not shipped;
>   - (b) **`scenarios/fzp/projects.json`**: every project in flight at the snapshot date, with pathway, stage, dated stage history, units, stories where known, parcels, and source ids.
>   It also computes **net units completed since the RHNA period start** up to the snapshot, from completion records (tier 0), cross-checked against the Housing Inventory (tier 1).

**In:**
- Seven new lock sources (§4.1).
- A linker that joins PRJ, child, review-metric, permit, completion and pipeline records into projects (§4.2).
- Population, pathway, stage entry dates, exits, the stale-open rule and `lastObserved` (§4.3–4.7).
- The T4d histories file, written to the derived cache.
- `out/<v>/scenarios/fzp/projects.json` (T3), including `rhnaCompletedNet`.
- Invariants V20–V24, the mini fixture records, golden files and report counts.
- The `docs/dev/pipeline.md` update for V20–V24 and the seven new sources (round 2, "Nits adopted"). stage-calibration owns V25–V29.

**Out:**
- Transition tables, `ppaShare` and every fitted parameter. Those belong to `stage-calibration`.
- The `scenarios` manifest entry, owned by `scenario-data` (T11). Retired-parcel lineage, assessor units and base stories, owned by `scenario-data` (T13): this spec consumes them.
- Addenda (`87xy-gk8d`), HCD APR, past pipeline snapshots, MOHCD `aaxw-2cb8`, and DA phase schedules.
- Alteration-only projects (ADUs, conversions, legalizations). They are never `InFlightProject`s (T3: "Projects are new construction only").
- Worker, render and UI code.

## 2. Interfaces

These rows are copied verbatim from the current design. This subsystem owns T3 and T4d. It consumes T1, T2, T4 (`Provenance`), T11 (the `projects` url) and T13, plus I1 and I12 from the source design.

From the composition design (`2026-10-16-1903-fzp-timelapse.md`):

| # | interface | owner → consumers | mark |
|---|---|---|---|
| T1 | `type Day = number` is integer days since 1970-01-01 UTC. All schedule times use it. It is exact in Float32. `MONTH_DAYS = 30.436875` (365.2425 / 12). `monthsIn(enteredDay, day) = floor((day − enteredDay) / MONTH_DAYS)` is the single months-in-stage rule, used by every table index (T4, T12, the bar, the card). `OPEN_DAY = 3.0e38` encodes an open-ended window end. These live in `src/lib/timelapse/time.ts` | stage-calibration → all | DC |
| T2 | `type Stage = 'preApplication' \| 'filed' \| 'entitled' \| 'permitFiled' \| 'permitIssued' \| 'construction' \| 'complete'`; `type Pathway = 'discretionary' \| 'streamlined' \| 'permitOnly'`; `type ExitReason = 'withdrawn' \| 'disapproved' \| 'cancelled' \| 'expired'`. `STAGE_ORDER` lists the stages in this order. `preApplication` is optional on every pathway. `permitOnly` projects never enter `filed` or `entitled`. A ghost is visible from the project's first entered stage | stage-calibration → project-records, timelapse-sim, timelapse-render, fzp-mode | MC (stage sequence and exits follow real records), DC (names) |
| T3 | `interface InFlightProject { id: string /* 'PRJ:<record_id>', 'BP:<permit>', 'PRJ:<record_id>:BP:<permit>' for split pipeline rows, 'CASE:<case_no>' for PRX rows, 'PPA:<record_id>' for PPA-only; unique */; label: string \| null /* street address from the records, if any */; parcelIds: ParcelId[] /* current mapblklot, mapped through retired-parcel lineage */; pathway: Pathway; stage: Stage; history: Partial<Record<Stage, Day>> /* observed entry days */; units: number; existingUnits: number; stories: number \| null; storiesTier: 0 \| 3 \| null /* 0 = recorded field, 3 = parsed from description text */; multiPhase: boolean /* PRX/DA remaining-phase row */; phases: { units: number; parcelIds: ParcelId[]; plannedPermitFiled: Day \| null /* from the DA phasing schedule, if enriched */; source: { label: string; url: string; retrieved: string } \| null }[] \| null /* multi-phase only: null until enriched, then each phase is simulated as its own sub-project */; sources: { dataset: string; id: string; key?: string /* field to query, e.g. 'case_no'; absent = the dataset's record-id field */ }[] }`. `scenarios/fzp/projects.json` = `{ schema: 1; asOf: Day; rhnaCompletedNet: { units: number /* net units added since `since` up to `asOf`, Housing Inventory definition: completions plus alteration gains, minus demolitions and alteration losses */; since: Day /* 2022-06-30, RHNA projection period start */; provenance: Provenance }; projects: InFlightProject[] }`. Projects are new construction only (alterations adding units are out of scope) | project-records → timelapse-sim, fzp-mode | MC (real pipeline is the starting state), DC (shape) |
| T4 | `interface Provenance { tier: 0 \| 1 \| 2 \| 3 \| 4; label: string; sources: { label: string; url: string }[]; method: string; n?: number; window?: [from: string, to: string] }`. `interface Transition { months: number; advance: number[] /* cumulative incidence by month 1..months */; exit: Partial<Record<ExitReason, number[]>>; tail: { advance: number; exit: Partial<Record<ExitReason, number>> } /* constant monthly hazards beyond months */; provenance: Provenance; tailProvenance: Provenance /* tier 2: extrapolation beyond the observed months */ }`. `scenarios/fzp/calibration.json` = `{ schema: 1; asOf: Day; transitions: Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Transition>>>; initiation: InitiationModel; pathwayForNew: Record<Pathway, number> & { provenance: Provenance }; size: SizeModel; revision: RevisionModel; streamlinedForLocalProgram: Provenance /* tier 2: Local Program projects use the streamlined tables */; phaseGap: { days: number[] /* empirical gaps between successive phases' permitFiled */; provenance: Provenance } }`. The calibration also carries `ppaShare: Record<Pathway, number> & { provenance: Provenance }`, the share of new projects that start at `preApplication`. `InitiationModel`, `SizeModel` and `RevisionModel` are rows T4a–c. Everything is plain JSON, so future policy levers can transform it (the T9 seam). **Sampling semantics:** a project entering stage *s* at day *d* draws one uniform. The month of advance or exit comes from the cumulative tables (`advance` + Σ`exit` ≤ 1 at every month), with the tail hazards beyond `months`. An in-flight project already *m* months into *s* draws conditionally on having survived *m* months. Day within the month is uniform | stage-calibration → timelapse-sim, fzp-mode | MC (every parameter carries tier + source), DC (encoding) |
| T4d | `interface ProjectHistory { id: string; pathway: Pathway \| null /* null = unclassifiable: excluded from per-pathway tables, included in pooled ones */; parcelIds: ParcelId[]; entered: Partial<Record<Stage, Day>>; end: { kind: 'complete'; day: Day } \| { kind: 'exit'; stage: Stage; reason: ExitReason; day: Day } \| { kind: 'open'; lastObserved: Day }; unitsAt: Partial<Record<Stage, number>> /* current proposed units from the record that represents each stage: PRJ → 'filed', site/full permit → 'permitFiled', TCO/CFC certified → 'complete'; cross-record, not snapshots (tier 2) */; existingUnits: number; storiesProposed: number \| null; baseStoriesAtFiling: number \| null /* current base height proxy, tier 3: no pre-FZP height map exists */; sources: { dataset: string; id: string; key?: string /* field to query, e.g. 'case_no'; absent = the dataset's record-id field */ }[] }`. Pipeline-internal file `pipeline/.cache/derived/<datasetVersion>/project-histories.json` = `{ schema: 1; asOf: Day; histories: ProjectHistory[] }`, never shipped. The history population and the in-flight population (T3) come from the same linkage | project-records → stage-calibration | DC |
| T11 | `scenarios/fzp/parcels.bin` (codec `sfh-scenario/1`, in `src/lib/data/`; deflate inside the file, async decode). It holds **every** parcel: `id`, `labelPoint`, `cellId`, a `hostable` flag (eligible and able to host a new project), `envelope: Envelope` (FZP stories: Local Program height if `localProgram`, else base height; clamped to `MAX_STORIES`), base stories, the base-zoning density cap in units (null = none), `localProgram: boolean`, `existingUnits` (latest assessor roll), the T4a feature values (base and FZP variants of `potentialRatio` and `storiesGap`) with an imputation mask, `hostable_base` (hostable under the old zoning), `baseYield: Uint16[F]` (gross units at each fill level of the base envelope, density-capped), and `yield: Uint16[F]`, the gross units at each fill level of the envelope, replacement typologies only (no ADU outcomes), with no density cap under the Local Program. `FILL_LEVELS = [0.25, 0.5, 0.75, 0.9, 1]` (F = 5, tier-4 quantisation grid) is owned here, and stage-calibration imports it. Named in the manifest as `scenarios?: { fzp: { parcels: url; projects: url; calibration: url } }` (amends I12 and `ManifestBaseSchema`; optional, so older datasets load). Because the yield uses the generator, `src/lib/generator` and `src/lib/timelapse` join the dataset-version hash | scenario-data → timelapse-sim | DC |
| T13 | Pipeline-internal parcel panel `pipeline/.cache/derived/<datasetVersion>/parcel-panel.parquet`. Per parcel × assessor roll year (2007..latest): `mapblklot`, roll year, assessor units, stories, year built, land and improvement value, use code → `landUseClass`, the zoning code (`acdm-wktn`), base stories, the base density cap, and the base-envelope yield (gross units at full base envelope, density-capped). Never shipped. Retired-parcel lineage is `parcel-lineage.parquet` in the same folder | scenario-data → project-records, stage-calibration | DC |

From the source design (`2026-10-10-1749-sf-housing-sim.md`):

| # | interface | owner → consumers | mark |
|---|---|---|---|
| I1 | `type ParcelId = string` — SF `mapblklot` (block+lot, e.g. `"3512008"`), the single join key across all data | data-pipeline → all | DC |
| I12 | Data manifest: `/data/<datasetVersion>/manifest.json` → `{ datasetVersion, builtAt, sources: { id, label?, url, retrievedAt, license }[], chunks: { cellId, bbox, url, parcelCount }[], buildingsTiles: url, basemapTiles: url, glyphs: url /* MapLibre `{fontstack}/{range}.pbf` template */, sprite?: url, neighborhoods: url }`. All `url`s are root-relative (`/data/<v>/…`). Every eligible-or-not parcel appears in **exactly one** chunk. `buildingsTiles` has one source-layer `buildings` with properties `parcelId`, `heightM`, `baseM`, at minzoom ≤ 12, with buildings clipped to parcels. Published versions are immutable and retained indefinitely. `datasetVersion` matches `^(\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\|fixture-\d+)$` (build date + 8-hex input hash) everywhere it is validated. R2 key = `data/<datasetVersion>/<path>`, served at `/data/<datasetVersion>/<path>` | data-pipeline → platform, plan-model, brush-tool (worker host), typology-generator, map-view | DC |

**Internal types** (pipeline-only; they do not alter any row):
- `deriveProjects(input: ProjectRecordsInput): { histories: ProjectHistory[]; file: ProjectsFile; counts: Record<string, number>; warnings: string[] }`. It is pure and deterministic. `ProjectsFile` is the T3 file object.
- `ProjectRecordsInput = { asOf: Day; raw: Record<ProjectSourceId, unknown[]>; parcelIds: Set<ParcelId>; lineage(blklot: string): ParcelId | null; assessorUnits(id: ParcelId, rollYear: number): number | null; latestRollYear: number; baseStories(id: ParcelId, rollYear: number): number | null; hiNet: Record<number, number> }`. The callbacks are served from DuckDB tables in the same build (§4.9).

## 3. Global constraints

### Global constraints (verbatim from the design)

The source design's constraints still apply (free and open, determinism, overshoot meaningful, honesty of numbers, performance, mobile, static versioned data, conventions). In addition:

- **Evidence hierarchy** (above). No number reaches the simulation without a tier and a source. A tier-3 or tier-4 number is never presented as data.
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
| `datasf-dev-pipeline` | `6jgi-cpb4` | `blklot,nameaddr,current_status,current_status_date,approved_date_planning,case_no,bpa_no,new_pipeline_units,existing_units,net_pipeline_units,description_planning` | none | CC0-1.0 | 1,917 |

Parcel lineage comes from `scenario-data`'s `parcel-lineage.parquet`, which is built from its `datasf-parcel-attrs` source (`acdm-wktn`, active and retired). This spec adds no parcel source.

The new entries need no further change elsewhere:
- `fetch --restore` and `upload` archiving cover them.
- Manifest `sources` and `/attribution` map every lock entry (`pipeline/steps/manifest.ts:30-38`).

A build whose lock lacks one of the seven ids throws `BuildError('lock has no entry for <id>')`.

**Parsing.**
- **Day.** Take the leading `YYYY-MM-DD` of a SODA floating timestamp and compute `Date.UTC(y, m-1, d) / 86400000`, with no time-zone conversion (T1).
- **Valid date.** A date is valid only if `1970-01-01 ≤ d ≤ asOf`. Anything else counts as missing. This clips junk such as `completed_date` 1909-06-02 and `j67f` `date_issued` 2205-03-13, both verified live.
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
   - its `filed` day lies in `[PPA open, PPA open + ppaLag]`.

   If several projects qualify, the one with the earliest `filed` wins. If none does, the PPA is a PPA-only project. `ppaLag` is the nearest-rank 90th percentile of (filed day − PPA open day) over parented PPAs, computed each build. It is tier 2 and its `n` is in the report. The live value is 369 days. With n = 0, `ppaLag` = ∞.
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
9. **Pipeline-only rows.** A row whose `case_no` and `bpa_no` resolve to no fetched record is pipeline-only. There are 22 rows live, mostly `…PRX` multi-phase tracking rows carrying about 40.9k units; Candlestick `2007.0946PRX` alone has 9,637. Such a row is in flight when `new_pipeline_units ≥ 1`, with `multiPhase = true` for `…PRX` case numbers. It never becomes a `ProjectHistory`, because it has no dated history.

**Superseded permits.** A dead permit is superseded when another permit in the same project was filed after it. Dead means `status` is `withdrawn`, `cancelled`, `expired`, `disapproved` or `revoked`. Live data has 57 same-lot refiles, e.g. `2019-020818PRJ`. A superseded permit counts only toward `permitFiled`. The **live set** is the permits that are neither dead nor superseded.

**Parcels.** Candidate block-lots come from:
- every address row of the project's permits;
- the anchor PRJ `block`+`lot`;
- the pipeline `blklot`;
- for a PPA-only project, the PPA's `block`+`lot`.

Each candidate maps to a current parcel:
- **Active `blklot`.** It maps to its `mapblklot` via the active rows of `src_parcels`. Condo sub-lots map to their `mapblklot`, e.g. pipeline `0708023` → `0708021`.
- **Retired `blklot`.** It maps via `scenario-data`'s `pipeline/.cache/derived/<datasetVersion>/parcel-lineage.parquet`: the row whose `blklot` matches gives `current_mapblklot` (T13; round-2 "Table names"). scenario-data assigns a retired lot to the current parcel containing its centroid.

`parcelIds` is the sorted, de-duplicated set of mapped ids that exist in the build's parcel set (I1). Unmapped and absent ids are counted and dropped. Live probe of pipeline `blklot`s on 2026-10-16: 1,823 map to the same id, 18 condo, 76 retired.

### 4.3 Population

A component is a **new-construction residential project** when both conditions hold:
- It holds a type 1/2 permit, or an anchor PRJ has `new_construction = 'CHECKED'` and `number_of_units_prop ≥ 1`.
- Its **net units** are ≥ 1 (reconciliation: "the event is net units ≥ 1"). Net units are `units − existingUnits` (§4.8). For histories, `existingUnits` is the assessor value at filing.

PPA-only projects are in the population, but they cannot be in flight because they have no units (§4.7).

Verified live:
- Pipeline rows whose PRJ meets neither condition (258 rows with units) are alterations.
- Rows whose `bpa_no` names a non-type-1/2 permit (926 rows, 2,826 net units) are ADUs and conversions.

Both groups are excluded and their units are counted in `projects.excludedAlterationUnits`.

### 4.4 Pathway

1. **`streamlined`** when an anchor PRJ meets any of these:
   - `sb35`, `housing_sustainability_dist` or `ab2162` is `'CHECKED'` (76, 4 and 11 PRJs live). The reconciliation counts AB 2162 as streamlined.
   - Its `description` matches `/\bSB[\s-]?35\b|\bSB[\s-]?423\b|\bAB[\s-]?2011\b|\bAB[\s-]?2162\b|Housing[\s-]+Choice\s*[-–—]?\s*(SF|San Francisco)|\bHCSF\b|Section\s+206\.10|Housing Sustainability District/i` and does not match `/\b(not|ineligible)\b[^.]{0,40}\b(SB[\s-]?35|SB[\s-]?423|AB[\s-]?2011)/i`.

   SB 423 and AB 2011 have no field; text is the only indicator. "Local Program" alone is **not** an indicator, because pre-2026 records use it for the ADU Local Program (verified, e.g. `2022-013049PRJ`).
2. **`discretionary`** when an anchor PRJ has a `d4jk-jw33` row, or a child of type `CUA, VAR, DNX, ENX, OFA, AHB, PHA, DVA, MAP, PCA, GPA, CTZ, COA, PTA, DRP, DRM` or `PPA`. Pipeline-only rows and PPA-only projects are `discretionary` (reconciliation).
3. **`permitOnly`** when there is no anchor PRJ, or every anchor PRJ is a **referral**. A referral has no streamlined or discretionary evidence and opened on or after the earliest permit's filed day minus 30 days. Live data has 1,301 such evidence-free PRJs opened after their permit.

   **The 30-day referral tolerance is tier 4 and made up.** It covers intake routing, where Planning opens the referral PRJ shortly before DBI records the permit's filing. One month is a round figure, chosen because only 15.8% of linked PRJ–permit pairs fall within ±30 days of each other (verified live). That makes the result insensitive to the exact value. The report prints it as `params.referralToleranceDays`.
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
| `entitled` (not `permitOnly`) | `d4jk` `end_event_date` where `end_event_type='approval'` (2013-05-06 onwards); else `project_decision_date` when the decision is `Approved`; else pipeline `approved_date_planning`; else max `close_date` of rule-2 children whose `record_status` matches `/Approved/` | |
| `permitFiled` | min filed day over **all** of the project's permits | discretionary/streamlined: kept only if `entitled` or `permitIssued` exists. A permit filed in parallel with Planning review leaves the project at `filed` |
| `permitIssued` | min `issued_date` over the live set | |
| `construction` | min over the live set of `first_construction_document_date` (site permits), else `issued_date` (full permits) | a site permit without an FCD has not started |
| `complete` | set when every live permit has a completion day; the value is the max of those days. A permit's completion day is its first `j67f` TCO or CFC with units > 0, else `completed_date` when `status='complete'` | reconciliation: "first TCO, otherwise the permit's `completed_date`". `j67f` starts in 2018, so earlier completions are CFC-dated; stage-calibration documents the bias |

**Out-of-order dates.** Walk `STAGE_ORDER` and set `entered[s] = max(raw[s], max earlier entered)`. The count goes in `histories.clamped.<stage>`. This is common live: 22 site permits have FCD before issuance, and 1,764 entitled PRJs opened after their permit was filed.

**Pipeline-only rows.**
- Stage from `current_status`:
  - `PL Filed` → `filed`;
  - `PL Approved` → `entitled`;
  - `BP Filed` and `BP Approved` → `permitFiled`;
  - `BP Issued` and `BP BP Issued` (a live typo) → `permitIssued`;
  - `Construction` → `construction`.
- `history[stage] = current_status_date`. `history.entitled = approved_date_planning` when present and not later.
- If `current_status_date` is invalid, the row is dropped and counted.

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

`exit.stage` is the latest entered stage on or before the exit day. The exit day is clamped to no earlier than that stage's entry day. A PRJ withdrawal never ends a project that still has a live permit.

### 4.7 `lastObserved` and the stale-open rule

`lastObserved` is the latest valid date across the project's records, clamped to `[first entered day, asOf]`. It draws on:
- PRJ open, close and decision dates;
- child open and close dates;
- `d4jk` start and end dates;
- the permit's `filed_date`, `issued_date`, `first_construction_document_date`, `completed_date`, `status_date` and `last_permit_activity_date`;
- the pipeline `current_status_date`.

It is the last day on which the records show the project alive. A history never dies of age; censoring is `stage-calibration`'s job.

**In flight at the snapshot.** A project is in flight when all of the following hold:
- **Open or pipeline-only.** The project is in the population and its history ends `open`, or it is a pipeline-only row.
- **Not stale.** It matches at least one pipeline row, **or** its first entered day is after `pipelineCutoff − 92`.
  - `pipelineCutoff` is the max valid `current_status_date`. The live value is 2026-07-28.
  - 92 days is one quarter, the dataset's published refresh cadence (tier 1, from dataset metadata).
- **Has units.** `units ≥ 1`.
- **Has parcels.** `parcelIds` is non-empty.

PPA-linked projects at `preApplication` take their units from the umbrella PRJ. PPA-only projects have no units and are counted, not shipped. The PPA series ends 2023-07-07, so live builds may have none.

An open project that fails the pipeline/recency test is **stale-open**. It stays open in histories and is counted in `projects.staleOpen` and `projects.staleOpenUnits`.
- Live, 825 open-permit components are absent from the pipeline. Most are permits still `filed` from 1981–2015.
- DBI batch-withdrew such permits in Sept–Oct 2026, visible in their `status_date`.

When daily records conflict with the quarterly pipeline, the records win. The count goes in `projects.pipelineConflicts` (17 live).

### 4.8 In-flight fields

- **`stage`** is the last `history` key in `STAGE_ORDER`.
- **`label`** is the first that exists:
  1. the lead permit's primary address row, `street_number street_name street_suffix`, title-cased;
  2. anchor PRJ `project_address`;
  3. pipeline `nameaddr`;
  4. `null`.
- **`units`** (gross) is the first that exists:
  1. Σ live-set `proposed_units`;
  2. anchor PRJ `number_of_units_prop` when > 0;
  3. pipeline `new_pipeline_units`.

  Pipeline-only rows use `new_pipeline_units`.
- **`existingUnits`** (reconciliation: latest assessor roll) is Σ over `parcelIds` of `assessorUnits(id, latestRollYear)` from the T13 panel, with null treated as 0.
  - The card says "existing homes (assessor)".
  - For a `ProjectHistory`, the roll year is that of the first entered day, clamped to 2007..latest.
- **`stories`** and **`storiesTier`**:
  1. Max `number_of_proposed_stories` > 0 over the live set, with tier `0`. Live, 505 of 12,858 are null and 84 are zero.
  2. Else parse the anchor PRJ `description`, falling back to pipeline `description_planning`. Take the first `/(\d{1,2}|one|two|…|twenty)[\s-]*stor(?:y|ies)/i` after the first `/\b(construct|erect|new|build)\b/i`. The keyword guard skips the existing building's stories. Tier `3`.
  3. Else the first `/(\d{2,3})[\s-]*(?:foot|feet|ft)\b/i` after that keyword, converted with `floor(ft / 10)`. Tier `3`; this is the design's height-to-stories rule.
  4. Else `null` and `null`.

  Parsed values outside 1–80 are discarded (`MAX_STORIES` = 80, reconciliation).
- **`multiPhase`** is `true` only for `…PRX` pipeline rows.
- **`sources`** lists every record that set a date, a number, the pathway or the label, as `{ dataset: <DataSF id>, id }`. The id is:
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

**`ProjectHistory` extras (T4d).**
- **`unitsAt`.** Tier 2: these are current values across records, not snapshots.
  - `filed` is PRJ `number_of_units_prop`.
  - `permitFiled` is Σ live-set `proposed_units`.
  - `complete` is Σ per permit of `max(Σ TCO units, max CFC units)` from `j67f`. The CFC-restates-the-total reading is inferred from live rows, e.g. TCO 2 units then CFC 120.
- **`storiesProposed`** follows the `stories` rule.
- **`baseStoriesAtFiling`** is the max over `parcelIds` of the base stories in `scenario_panel` (T13), taken at the roll year of the first entered day, clamped to 2007..latest; else `null`. Tier 3: the current base height proxy (reconciliation, "Pre-FZP heights"; round 2, "Table names").

### 4.9 Pipeline wiring

**Step placement.** `build` (`pipeline/steps/build.ts:140-147`) runs `projectRecords` after `runSql` and the `scenario-data` step, and before `stage-calibration`. It is pure TS, like `writeTransit`. It reads these DuckDB tables:
- `parcelIds` from `parcel_out`;
- `assessorUnits` and `baseStories` from `scenario_panel` (T13);
- `lineage` from active `src_parcels` rows and `parcel-lineage.parquet` (T13).

**Outputs.**
- `out/<v>/scenarios/fzp/projects.json`, minified, with `schema: 1`. Keys follow T3 declaration order, `history` keys follow `STAGE_ORDER`, projects are sorted by `id`, and `parcelIds` are sorted.
- `pipeline/.cache/derived/<datasetVersion>/project-histories.json` (T4d layout), sorted by `id`. The histories are also passed in memory to `stage-calibration`.
- Fixture builds write `derived/<fixture-n>/`. `--update-golden` copies the histories to `pipeline/test/fixtures/mini/golden/derived/project-histories.json`.
- `GOLDEN_FILES` (`pipeline/steps/fixture.ts:25-31`) gains `scenarios/fzp/projects.json`.
- The `report.json` counts gain the `projects.*`, `histories.*` and `rhna.*` keys named here.

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
| V20 | `projects.json` passes the T3 validator: `schema` 1; `asOf` = snapshot day; ids unique and prefixed per T3; `parcelIds` non-empty, sorted, in the parcel set; `stage` = last `history` key; `history` non-decreasing in `STAGE_ORDER` and ≤ `asOf`; `permitOnly` has no `filed`/`entitled`; `units` ≥ 1; `units − existingUnits` ≥ 1 except `multiPhase`; `stories` null or 1–80; `storiesTier` null iff `stories` null; `sources` non-empty | same | same |
| V21 | Pipeline coverage: Σ `units` of in-flight projects matched to population pipeline rows ≥ 0.90 × Σ `new_pipeline_units` of those rows, excluding rows the records show ended | ≥ 0.90 | = 1.0 |
| V22 | `rhnaCompletedNet`: each cross-check year within ±10% of `hiNet`; the total within ±5% | 2023–2025 | fixture `hiNet` |
| V23 | Histories: entered days non-decreasing; `end.day` ≥ the last entered day; `complete` ⇒ `entered.complete = end.day`; `exit.stage` was entered; `lastObserved` in [first entered day, `asOf`]; each non-null pathway has ≥ 1 history | same | same |
| V24 | Determinism and size: `deriveProjects` run twice gives byte-identical outputs; `projects.json` ≤ 2 MB, with a warning above 1 MB (engineering budget) | same | same |

**Fixture.** `make-fixture.ts` gains seven `raw/<lockId>.page-000.json` files in SODA shape: lower-case keys, numbers as strings, nulls omitted. Their lock entries have `retrievedAt` ≤ 2026-10-10, which keeps the fixture `asOf` at Day(2026-10-10). The mini lineage, assessor units and base stories come from `scenario-data`'s fixture. That fixture maps retired `3512099` to lot 12 (scenario-data spec mini table).

The fixture covers every in-flight stage, a PPA, and a multi-phase row (reconciliation "Fixture-0 contents"):

| mini project | records | expected |
|---|---|---|
| M1 `PRJ:2019-000001PRJ` | PPA `2018-000001PPA` (parent M1); ENV child; d4jk approval 2020-03-02; permit `201906010001` (type 2, site, filed 2019-06-01, issued 2021-02-01, FCD 2021-05-03, `completed_date` 1909-06-02, 24 units, 6 stories, address rows on lots 010 and 011); pipeline `Construction` | in flight, `discretionary`, `construction`, parcels [3512010, 3512011], `permitFiled` forced to 2020-03-02, `storiesTier` 0 |
| M2 `PRJ:2026-000002PRJ` | `sb35` CHECKED, opened 2026-05-01, 40 units, "construct a new 8-story building", lot 013; pipeline `PL Filed` | in flight, `streamlined`, `filed`, stories 8, `storiesTier` 3 |
| M3 `BP:202403150003` | type 1 permit filed 2024-03-15, no PRJ, 2 units, lot 005; pipeline `BP Filed` | in flight, `permitOnly`, history only `permitFiled` |
| M4 `PPA:2021-000004PPA` | PPA, no parent, closed 2021-06-30 | history only: exit `withdrawn` at `preApplication` |
| M5 `PRJ:2017-000005PRJ` | `Closed - Withdrawn` 2018-04-02, 9 units, new construction | history only: exit `withdrawn` at `filed` |
| M6 `PRJ:2016-000006PRJ` | permit `201605010006` complete; `j67f` Initial TCO 2019-08-01 (12 units) | history `complete` 2019-08-01, `unitsAt.complete` 12 |
| M7 `BP:201410070008` | type 2 permit `filed` 2014-10-07, not in pipeline | history open, `lastObserved` 2014-10-07; `projects.staleOpen` = 1 |
| M8 `PRJ:2020-000008PRJ` | referral PRJ (opened after its permit, no evidence); permit on retired lot `3512099`, issued, 4 units; pipeline `BP Issued` | in flight, `permitOnly`, `permitIssued`, parcels [3512012] |
| M9 `CASE:2007.0001PRX` | pipeline-only, lot 014, `PL Approved`, status date 2008-06-12, 300 new units | in flight, `discretionary`, `entitled`, `multiPhase` true, no history |
| M10 `PRJ:2020-000010PRJ` | permit A `202001100010` withdrawn 2021-01-01; permit B `202203010010` filed (6 units), lot 001; d4jk approval 2021-11-01; pipeline `BP Filed` (bpa B) | in flight, `permitFiled` = 2021-11-01 (raw 2020-01-10 forced up), units 6, existing 2 |
| M11 `PRJ:2026-000011PRJ` | `new_construction` CHECKED, opened 2026-09-20, 3 units, lot 006, no evidence, not in pipeline | in flight (after cutoff), `filed`, existing 2; history `pathway: null`; T3 `discretionary`; `projects.pathwayDefaulted` = 1 |
| M12 `PRJ:2026-000012PRJ` | umbrella PRJ `Open`, opened 2026-08-03, `new_construction` CHECKED, 12 units, lot 008; PPA `2026-000012PPA` (parent M12, opened the same day) | in flight, `discretionary`, `preApplication`, units 12, parcels [3512008] |
| M13 `PRJ:2015-000013PRJ` | `Closed`, no decision, no approval, no permit, closed 2016-05-02 | history only: exit `withdrawn` at `filed` 2016-05-02 |
| xdht extras | `202101050007` (form 2, +3, 2023-05-10); form 3 (+2, 2024-02-01); form 6 (−1, 2025-01-15) | `rhnaCompletedNet.units` = 4, `n` = 3 |

Remaining fixture settings:
- The pipeline `current_status_date` max is 2026-07-28.
- Fixture `hiNet` = {2023: 3, 2024: 2, 2025: −1}.
- Assessor units come from scenario-data's fixture roll (round 2, "Fixture-0"). Lot 1 has 2, which gives M10 existing 2. Lot 6 has 2, which gives M11 existing 2.
- Every other project lot (5, 8, 10, 11, 12, 13, 14) has no units in the latest fixture roll, so its existing count is 0. Lot 12's 7 lineage units are in 2024 only.
- If scenario-data's golden changes these numbers, this spec's goldens follow it.

**Determinism.**
- No wall-clock time: `asOf` comes from the lock.
- Iteration is over sorted keys, with the explicit tie-breaks above.
- `ppaLag` uses nearest-rank ⌈0.9·n⌉.

## 5. Seams

- **T9 policy levers.** `projects.json` is plain JSON. No other change.
- **Addenda.** Permit numbers stay in `sources`, so `87xy-gk8d` can join later. No addenda are fetched.
- **DA phasing.** PRX rows carry `multiPhase` and their `CASE:` id. No phase schedule is inferred.
- **Renderings.** PRJ and permit ids in `sources` are the future join key.

## 6. Testing

All in `npm run test:pipeline`. Every test calls `expect`.

- **`fetch.test.ts`**:
  - a `format: 'json'` entry pages and counts array rows;
  - URLs carry the §4.1 `$select`/`$where`;
  - an exactly-full page followed by an empty page does not lock the empty one.
- **`project-records/parse.test.ts`**:
  - Day from floating timestamps;
  - clipping of 1909, 2205 and post-`asOf` dates;
  - `building_permits` splitting;
  - `CFc` matching.
- **`project-records/link.test.ts`**:
  - a permit is assigned to the latest PRJ opened before filing;
  - a satellite adds no dates;
  - a PPA links by `parent_id`, and by block/lot inside `ppaLag`;
  - a two-row component splits;
  - all five id forms;
  - superseded refiles.
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
  - the forward clamp and its counts;
  - completion from first TCO, then the `completed_date` fallback;
  - multi-permit completion is the max, and absent while any permit is open.
- **`project-records/ends.test.ts`**:
  - each reason mapping;
  - a live permit beats a PRJ withdrawal;
  - complete beats a later cancel;
  - closed without a decision → `withdrawn` at `close_date`, but a closed PRJ with approval stays open;
  - PPA-only before and after `ppaLag`;
  - exit-stage clamping.
- **`project-records/inflight.test.ts`**:
  - pipeline match, the after-cutoff window, stale-open and conflicts;
  - `sources[].key` per dataset (absent for `record_id`; `'case_no'` for PRX/PRJ pipeline ids);
  - label precedence;
  - assessor `existingUnits`;
  - stories precedence and `storiesTier`;
  - the regex skips "existing two-story";
  - the feet fallback;
  - `multiPhase`.
- **`project-records/rhna.test.ts`**:
  - inclusive window bounds;
  - demolitions are negative;
  - V22 at the ±5% and ±10% edges.
- **Golden** (`golden.test.ts`): `fixture-0` `scenarios/fzp/projects.json` and `golden/derived/project-histories.json` match byte for byte, with the per-project values in §4.9.
- **Invariants**: V20–V24 each fail on a hand-broken copy of the fixture and pass on the real fixture.
- **Property**: permuting input row order leaves the output byte-identical.
- **Live, opt-in** (the `live-raw.test.ts` pattern, skipped without `pipeline/.cache`):
  - V21 ≥ 0.90;
  - V22;
  - in-flight units in [40k, 100k]. This is a sanity band around the 2026-Q2 pipeline total of 75,853, which includes alterations (tier 1, Planning pipeline report).

No browser, e2e or axe tests apply. `timelapse-sim` and `fzp-mode` e2e exercise `projects.json` from `fixture-0`.

## 7. Acceptance criteria

1. `fetch` writes seven new lock entries with the §4.1 URLs and licences, and `fetch --restore` restores them.
2. `build` writes `out/<v>/scenarios/fzp/projects.json`. It matches T3 exactly and passes V20–V24; the build exits 1 on any failure.
3. `pipeline/.cache/derived/<v>/project-histories.json` matches the T4d file layout.
4. `fixture` reproduces the goldens, with these values:
   - In flight: M1, M2, M3, M8, M9, M10, M11 and M12. Together they cover every non-complete stage.
   - Histories only: M4–M7 and M13.
   - `rhnaCompletedNet.units` = 4.
5. No in-flight project ends complete or exit at `asOf`, and none is stale-open.
6. `rhnaCompletedNet.since` = Day(2022-06-30), with tier-0 provenance, both sources and the window.
7. `report.json` carries these counts:
   - `projects.inFlight` and `projects.inFlightUnits`;
   - `projects.byPathway.*` and `projects.byStage.*`;
   - `projects.staleOpen` and `projects.staleOpenUnits`;
   - `projects.pipelineConflicts`, `projects.pathwayDefaulted` and `projects.excludedAlterationUnits`;
   - `projects.stories.{tier0,tier3,null}`;
   - `projects.parcels.{mapped,unmapped}`;
   - `histories.total`, `histories.clamped.*` and `histories.ppaLagDays`;
   - `rhna.units`, `rhna.crossCheck.<year>` and `rhna.xdhtLagDays`;
   - `params.ppaUmbrellaDays` (7) and `params.referralToleranceDays` (30), both labelled tier 4.
8. Two builds from the same lock and code give byte-identical `projects.json`.
9. Every `sources` entry follows the §4.8 `key` table.
10. `docs/dev/pipeline.md` lists V20–V24 and the seven new lock sources.

## 8. Open questions

None remain. The reconciliation answered all four: RHNA `since` (T3: 2022-06-30), the PPA-only pathway (`discretionary`), single-unit construction (net ≥ 1), and AB 2162 (`streamlined`).

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

None remain open.
