# project-records: design spec

Status: derived 2026-10-16 from the approved composition design `docs/superpowers/design/2026-10-16-1903-fzp-timelapse.md`. Slug `project-records`. Data pipeline subsystem.

## 1. Scope

From the design:

> **`project-records`** (data pipeline). Ingests the tier-0 project datasets (`i98e-djp9`, `d4jk-jw33`, `qvu5-m3a2`, `y673-d69b`, `j67f-aayr`, `xdht-4php`, `6jgi-cpb4`) and links them into one record per project: PRJ ↔ permits via `building_permits`, plus parcel joins. It emits two things:
>   - (a) **historical project histories**, as input to calibration only, kept in the pipeline cache and not shipped;
>   - (b) **`scenarios/fzp/projects.json`**: every project in flight at the snapshot date, with pathway, stage, dated stage history, units, stories where known, parcels, and source ids.
>   It also computes **net units completed since the RHNA period start** up to the snapshot, from completion records (tier 0), cross-checked against the Housing Inventory (tier 1).

**In:**
- Eight new lock sources: the seven datasets above, plus the parcel id history `acdm-wktn` without geometry, which maps condo and retired lots (§4.1).
- A linker that builds one project from PRJ, child, review-metric, permit, completion and pipeline records (§4.2).
- Classification of the population and the pathway (§4.3, §4.4).
- Stage entry dates, exits, the open and stale-open rule, and `lastObserved` (§4.5–4.7).
- `ProjectHistory[]` written to the pipeline cache (T4d).
- `out/<v>/scenarios/fzp/projects.json` (T3), including `rhnaCompletedNet`.
- Invariants V20–V24, the mini fixture records, golden files and report counts.

**Out:**
- Transition tables, `ppaShare` and every other fitted parameter. They belong to `stage-calibration`, which only reads the histories.
- The `scenarios` manifest entry. `scenario-data` owns T11; this spec only writes the file the entry names.
- Addenda routing (`87xy-gk8d`), HCD APR tables, past pipeline snapshots, MOHCD `aaxw-2cb8`, and DA phase schedules (R10).
- Alteration-only projects: ADUs, conversions and legalizations. They count in `rhnaCompletedNet` but are never `InFlightProject`s (§4.3).
- All worker, render and UI code.

## 2. Interfaces

These rows are copied verbatim from the design. This subsystem owns T3 and T4d. It consumes T1, T2, T4 (`Provenance` inside T3), T11 (the `projects` url) and I1 and I12 from the source design.

From the composition design (`2026-10-16-1903-fzp-timelapse.md`):

| # | interface | owner → consumers | mark |
|---|---|---|---|
| T1 | `type Day = number` is integer days since 1970-01-01 UTC. All schedule times use it. It is exact in Float32 | timelapse-sim → all | DC |
| T2 | `type Stage = 'preApplication' \| 'filed' \| 'entitled' \| 'permitFiled' \| 'permitIssued' \| 'construction' \| 'complete'`; `type Pathway = 'discretionary' \| 'streamlined' \| 'permitOnly'`; `type ExitReason = 'withdrawn' \| 'disapproved' \| 'cancelled' \| 'expired'`. `STAGE_ORDER` lists the stages in this order. `preApplication` is optional on every pathway. `permitOnly` projects never enter `filed` or `entitled`. A ghost is visible from the project's first entered stage | stage-calibration → project-records, timelapse-sim, timelapse-render, fzp-mode | MC (stage sequence and exits follow real records), DC (names) |
| T3 | `interface InFlightProject { id: string /* PRJ record id, else permit number */; parcelIds: ParcelId[]; pathway: Pathway; stage: Stage; history: Partial<Record<Stage, Day>> /* observed entry days */; units: number; existingUnits: number; stories: number \| null; sources: { dataset: string; id: string }[] }`. `scenarios/fzp/projects.json` = `{ schema: 1; asOf: Day; rhnaCompletedNet: { units: number; since: Day; provenance: Provenance }; projects: InFlightProject[] }` | project-records → timelapse-sim, fzp-mode | MC (real pipeline is the starting state), DC (shape) |
| T4 | `interface Provenance { tier: 0 \| 1 \| 2 \| 3 \| 4; label: string; sources: { label: string; url: string }[]; method: string; n?: number; window?: [from: string, to: string] }`. `interface Transition { months: number; advance: number[] /* cumulative incidence by month 1..months */; exit: Partial<Record<ExitReason, number[]>>; tail: { advance: number; exit: Partial<Record<ExitReason, number>> } /* constant monthly hazards beyond months */; provenance: Provenance }`. `scenarios/fzp/calibration.json` = `{ schema: 1; asOf: Day; transitions: Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Transition>>>; initiation: InitiationModel; pathwayForNew: Record<Pathway, number> & { provenance: Provenance }; size: SizeModel; revision: RevisionModel }`. The calibration also carries `ppaShare: Record<Pathway, number> & { provenance: Provenance }`, the share of new projects that start at `preApplication`. `InitiationModel`, `SizeModel` and `RevisionModel` are rows T4a–c. Everything is plain JSON, so future policy levers can transform it (the T9 seam). **Sampling semantics:** a project entering stage *s* at day *d* draws one uniform. The month of advance or exit comes from the cumulative tables (`advance` + Σ`exit` ≤ 1 at every month), with the tail hazards beyond `months`. An in-flight project already *m* months into *s* draws conditionally on having survived *m* months. Day within the month is uniform | stage-calibration → timelapse-sim, fzp-mode | MC (every parameter carries tier + source), DC (encoding) |
| T4d | `interface ProjectHistory { id: string; pathway: Pathway; parcelIds: ParcelId[]; entered: Partial<Record<Stage, Day>>; end: { kind: 'complete'; day: Day } \| { kind: 'exit'; stage: Stage; reason: ExitReason; day: Day } \| { kind: 'open'; lastObserved: Day }; unitsAt: Partial<Record<Stage, number>> /* proposed units as recorded at each stage */; existingUnits: number; storiesProposed: number \| null; baseStoriesAtFiling: number \| null; sources: { dataset: string; id: string }[] }`. Pipeline-internal: `pipeline/.cache/derived/project-histories.json`, never shipped | project-records → stage-calibration | DC |
| T11 | `scenarios/fzp/parcels.bin` (codec `sfh-scenario/1`, in `src/lib/data/`): per eligible parcel `id`, `labelPoint`, `cellId`, `envelope: Envelope` (FZP Local Program stories), the base (pre-FZP) stories, the T4a feature values (with base-envelope and FZP-envelope variants of `potentialRatio` and `storiesGap`), a `localProgram: boolean` flag (false when the parcel is excluded from the Local Program, in which case `envelope` is the base height) and `yield: Uint16[F]`, the units at each quantised fill level of the envelope. Named in the manifest as `scenarios?: { fzp: { parcels: url; projects: url; calibration: url } }` (amends I12; optional, so older datasets load) | scenario-data → timelapse-sim | DC |

From the source design (`2026-10-10-1749-sf-housing-sim.md`):

| # | interface | owner → consumers | mark |
|---|---|---|---|
| I1 | `type ParcelId = string` — SF `mapblklot` (block+lot, e.g. `"3512008"`), the single join key across all data | data-pipeline → all | DC |
| I12 | Data manifest: `/data/<datasetVersion>/manifest.json` → `{ datasetVersion, builtAt, sources: { id, label?, url, retrievedAt, license }[], chunks: { cellId, bbox, url, parcelCount }[], buildingsTiles: url, basemapTiles: url, glyphs: url /* MapLibre `{fontstack}/{range}.pbf` template */, sprite?: url, neighborhoods: url }`. All `url`s are root-relative (`/data/<v>/…`). Every eligible-or-not parcel appears in **exactly one** chunk. `buildingsTiles` has one source-layer `buildings` with properties `parcelId`, `heightM`, `baseM`, at minzoom ≤ 12, with buildings clipped to parcels. Published versions are immutable and retained indefinitely. `datasetVersion` matches `^(\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\|fixture-\d+)$` (build date + 8-hex input hash) everywhere it is validated. R2 key = `data/<datasetVersion>/<path>`, served at `/data/<datasetVersion>/<path>` | data-pipeline → platform, plan-model, brush-tool (worker host), typology-generator, map-view | DC |

**Internal types** (pipeline-only; they do not alter any row):
- `HistoriesFile = { schema: 1; asOf: Day; histories: ProjectHistory[] }` is the JSON layout of `pipeline/.cache/derived/project-histories.json`. Histories are sorted by `id`. Read by `stage-calibration`.
- `deriveProjects(input: ProjectRecordsInput): { histories: ProjectHistory[]; file: ProjectsFile; counts: Record<string, number>; warnings: string[] }`. It is pure and deterministic. `ProjectsFile` is the T3 file object.
- `ProjectRecordsInput = { asOf: Day; raw: Record<ProjectSourceId, unknown[]>; parcelIds: Set<ParcelId>; resolveRetired(blklot): ParcelId[]; existingUnits(id): number; baseStories(id): number | null; hiNet: Record<number, number> }`. The callbacks are served from the build's DuckDB tables (§4.9).

## 3. Global constraints

### Global constraints (verbatim from the design)

The source design's constraints still apply (free and open, determinism, overshoot meaningful, honesty of numbers, performance, mobile, static versioned data, conventions). In addition:

- **Evidence hierarchy** (above). No number reaches the simulation without a tier and a source. A tier-3 or tier-4 number is never presented as data.
- **Determinism.** The same `datasetVersion` and seed always give the same future, on every machine. The representative seed is chosen deterministically: the run whose final `completedNet` is the median of the N band runs.
- **Honesty of numbers.** The mode is labelled a *simulation*. The scoreboard shows the shown run and the p10–p90 band. Pipeline and new-FZP units are separate lines. Actual completions since the RHNA period start are counted and labelled as actual. Units lost to dead projects are shown.
- **Time scrubbing performance.** At 60 fps on a 2022-era laptop with the whole city's timeline loaded, per-frame JS during scrub or playback is O(1) in project count. A reroll reaches a full new timeline (the shown run, to 2050) within 3 s off the main thread. The p10–p90 band may fill in progressively afterwards; the UI marks it as provisional until it is complete.
- **First paint.** `/fzp` must not require loading every parcel chunk. The whole-city score comes from `parcels.bin`, `projects.json` and `calibration.json`. Geometry streams with the viewport, as on `/`.
- **The editor is unchanged.** `/` and `/p/:id` behave exactly as before. FZP mode is additive.
- **Accessibility.** WCAG 2.2 AA as in `docs/dev/accessibility.md`. The scrubber is a labelled slider: arrow keys step a month, Page Up/Down a year. Reduced motion stops autoplay, but scrubbing still works.

### Evidence hierarchy (verbatim from the design)

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

Each source is a new `DATASF` entry (`pipeline/sources/datasf.ts:10-50`). The entry gains a field `format: 'geojson' | 'json'`. The four existing entries stay `geojson`. The new entries use `https://data.sf.gov/resource/<id>.json`, and `fetchDatasf` counts rows as the length of the array. Paging is unchanged: `$order=:id`, `$limit=50000`, `$offset=k` until a short page arrives, with one lock file per page named `<lockId>.page-NNN.json` (`datasf.ts:52-97`). `FETCH_IDS` picks the entries up from `Object.keys(DATASF)` (`pipeline/steps/fetch.ts:17-23`). Licences and fields were verified live on 2026-10-16 from `https://data.sf.gov/api/views/<id>.json`.

| lock id | dataset | `$select` | `$where` | licence | rows 2026-10-16 |
|---|---|---|---|---|---|
| `datasf-permits-newcon` | `i98e-djp9` | `permit_number,permit_type,block,lot,street_number,street_name,street_suffix,description,status,status_date,filed_date,permit_creation_date,approved_date,issued_date,first_construction_document_date,completed_date,last_permit_activity_date,number_of_proposed_stories,existing_units,proposed_units,site_permit,primary_address_flag` | `permit_type in('1','2')` | PDDL-1.0 | 15,654 rows, 12,858 permits |
| `datasf-planning-projects` | `qvu5-m3a2` | `record_id,record_status,project_address,block,lot,open_date,close_date,building_permits,project_decision,project_decision_date,number_of_units_prop,number_of_units_exist,new_construction,sb35,housing_sustainability_dist,ab2162,description` | none | public-domain | 54,640 |
| `datasf-planning-records` | `y673-d69b` | `record_id,record_type,record_status,block,lot,parent_id,open_date,close_date` | `record_type in('PPA','ENV','CUA','VAR','DNX','ENX','OFA','AHB','PHA','DVA','COA','PTA','MAP','PCA','GPA','CTZ','DRP','DRM')` | public-domain | ≈49,700 (from per-type counts) |
| `datasf-planning-review` | `d4jk-jw33` | `b1_alt_id,start_event_type,start_event_date,end_event_type,end_event_date` | `project_stage='accepted to approved'` | PDDL-1.0 | 16,141 |
| `datasf-unit-completions` | `j67f-aayr` | `building_permit_application,date_issued,document_type,number_of_units_certified` | none | PDDL-1.0 | 2,559 |
| `datasf-housing-production` | `xdht-4php` | `bpa,blocklot,form_no,pts_existing_units,net_units_completed,first_completion_date,latest_completion_date` | none | public-domain | 6,157 |
| `datasf-dev-pipeline` | `6jgi-cpb4` | `blklot,nameaddr,current_status,current_status_date,approved_date_planning,case_no,bpa_no,new_pipeline_units,existing_units,net_pipeline_units,description_planning` | none | CC0-1.0 | 1,917 |
| `datasf-parcel-history` | `acdm-wktn` | `blklot,mapblklot,active,date_rec_add,date_rec_drop,centroid_latitude,centroid_longitude` | none | PDDL-1.0 | 236,573 (5 pages) |

`fetch --restore`, `upload` archiving, manifest `sources` and `/attribution` cover the new entries with no further change, because `buildManifest` maps every lock entry (`pipeline/steps/manifest.ts:30-38`). A build whose lock lacks any of the eight ids throws `BuildError('lock has no entry for <id>')`.

**Parsing rules.** Each is visible in the outputs.
- **Day.** Take the leading `YYYY-MM-DD` of a SODA floating timestamp, then `Date.UTC(y, m-1, d) / 86400000`, with no time-zone conversion.
- **Valid date.** A date is valid only if `1970-01-01 ≤ d ≤ asOf`. Otherwise it counts as missing. This clips junk such as `completed_date` 1909-06-02 and `j67f` `date_issued` 2205-03-13 (both verified in the live data).
- **Numbers.** SODA numbers arrive as strings; `Number()` them, and anything non-finite is null.
- **`building_permits`** splits on `/[,;\s]+/` (live value `"202512242616, 202610028990"`).
- **`document_type`** is matched case-insensitively (live data has both `CFc` and `CFC`).

**`asOf`** is the UTC day of the newest `retrievedAt` in the lock. That is also the date part of `datasetVersion` (`docs/dev/pipeline.md:45`), so one snapshot day serves every artifact and `stage-calibration` uses the same value.

### 4.2 Linking

Node kinds:
- **R**: PRJ records.
- **P**: new-construction permits. One node per `permit_number`, carrying every address row.
- **C**: child records.
- **L**: pipeline rows.

Steps:

1. **PRJ to permit.** For each PRJ, every `building_permits` entry that is a P node is a candidate edge. A permit named by several PRJs (739 of 4,503 linked permits, live) is **assigned** to the PRJ with the latest `open_date` on or before the permit's filed day (`filed_date`, else `permit_creation_date`). If there is none, it goes to the earliest-opened PRJ. Assigned edges make the PRJ an **anchor**. A PRJ whose permits all went to another PRJ is a **satellite**, typically a modification record. It joins that component but contributes only `sources`, never dates or a pathway.
2. **Children.** A child joins its `parent_id` PRJ.
   - **PPA linking.** A PPA with no parent, or whose parent is absent from `qvu5-m3a2` (124 of 754, live), links by place and time. It joins the project whose resolved parcels contain the PPA's resolved `block`+`lot` and whose `filed` day lies in `[PPA open, PPA open + ppaLag]`. If several projects qualify, the earliest `filed` wins. Otherwise the PPA is its own PPA-only project.
   - **`ppaLag`** is the 90th percentile, across parented PPAs, of (filed day − PPA open day). It is computed every build (tier 2, `n` in the report). The live value was 369 days on 2026-10-16.
3. **Review metrics.** `d4jk-jw33` rows join by `b1_alt_id` = PRJ `record_id`. There is at most one row per PRJ (verified: 14,923 approval rows, 0 duplicates).
4. **Pipeline rows.** A pipeline row joins the PRJ named by `case_no` and the permit named by `bpa_no`.
5. **Completions.** `j67f-aayr` and `xdht-4php` rows attach to permits by `building_permit_application` and `bpa`.
6. **Components.** A project is a connected component of the graph built in steps 1–4 (union-find).
7. **Each pipeline row is a project.** A component holding two or more pipeline rows is split: 8 components and 48 rows live, all DA phases such as Parkmerced and Hunters View.
   - Each row becomes its own project. It holds the permit its `bpa_no` names, any superseded permit on the same parcels, and a copy of the component's anchor-PRJ planning records.
   - Any remaining permits form one more project with the anchor PRJ.
   - The split projects share planning-stage dates and pathway.
8. **`id`.** Rules in order:
   1. the anchor PRJ's `record_id`, when only one project uses that PRJ;
   2. `${prj}:${leadPermit}`, when a split left several projects on one PRJ;
   3. the lead permit number, when the project has no PRJ;
   4. the `case_no`, for a pipeline-only row (below);
   5. `PPA:${record_id}`, for a PPA-only project.

   The **lead permit** is chosen from the live permits by these keys in order: `site_permit='Y'` first, then most `proposed_units`, then earliest filed day, then lowest `permit_number`. It is the "site/full permit". Every type 1/2 permit is a site or full permit, and addenda live only in `87xy-gk8d`. The `${prj}:` form and the `case_no` form go beyond T3's id comment; see Interface concerns.
9. **Pipeline-only rows.** A pipeline row whose `case_no` and `bpa_no` both resolve to no fetched record is a pipeline-only project. These are 22 rows live, mostly `…PRX` multi-phase tracking rows ("remaining phases", about 40.9k net units, e.g. Candlestick `2007.0946PRX` with 9,637 units).
   - It becomes an in-flight project when `new_pipeline_units ≥ 1`.
   - It never becomes a `ProjectHistory`, because it has no dated record history.

**Superseded permits.** A dead permit is superseded when another permit in the same project was filed after it. Dead means `status` is `withdrawn`, `cancelled`, `expired`, `disapproved` or `revoked`. Superseded permits are refiles (57 same-lot cases live, e.g. `2019-020818PRJ`: withdrawn 2019, refiled 2021). They count toward `permitFiled` but are otherwise excluded. The **live set** is every permit that is neither dead nor superseded. If all permits are dead, the live set is empty.

**Parcels.**
- **Inputs.** Each project's candidate block-lots are:
  - every address row of every permit in the project (non-primary rows can name adjacent lots);
  - the anchor PRJ `block`+`lot`;
  - the pipeline `blklot`;
  - for a PPA-only project, the PPA's `block`+`lot`.
- **Resolution.** Each `blklot` resolves through `datasf-parcel-history`. The first rule that matches wins:
  1. **Active row:** its `mapblklot`. This covers condo lots: pipeline `0708023` resolves to `0708021`, matching the parcels SQL's dedupe in `pipeline/sql/10_parcels.sql:13-20`.
  2. **Retired, by successor:** the active rows on the same block whose `date_rec_add` equals the retired row's `date_rec_drop`. All of them are taken (a split yields several).
  3. **Retired, spatially:** the active parcel containing the retired row's centroid, via `resolveRetired` (§4.9).
  4. **Unresolved.**
- **Live resolution, pipeline rows:** 1,823 same, 18 condo, 69 by successor, 7 without a successor.
- **Live resolution, open permits:** 1,424 same, 39 condo, 238 by successor, 21 without a successor, 48 unknown.
- `parcelIds` is the sorted, de-duplicated set of resolved ids that exist in the build's parcel set (I1). Unresolved and absent ids are counted and dropped.

### 4.3 Population

A component is a **new-construction residential project** when either:
- it holds a type 1/2 permit, or
- an anchor PRJ has `new_construction = 'CHECKED'` and `number_of_units_prop ≥ 1`.

PPA-only projects are in the population. Pipeline-only rows qualify by the `new_pipeline_units ≥ 1` rule in §4.2.

This rule is verified against live data. Pipeline rows with a PRJ but neither condition (258 rows with units) are alterations, legalizations and remodels. Rows whose `bpa_no` names a non-type-1/2 permit (926 rows, 2,826 net units) are ADUs and conversions. Both groups are excluded. The report counts their units as `projects.excludedAlterationUnits`, because they still reach `rhnaCompletedNet`.

### 4.4 Pathway

Rules in order:

1. **`streamlined`** if any anchor PRJ meets any of these:
   - `sb35`, `housing_sustainability_dist` or `ab2162` is `'CHECKED'` (76, 4 and 11 PRJs live);
   - its `description` matches `/\bSB[\s-]?35\b|\bSB[\s-]?423\b|\bAB[\s-]?2011\b|\bAB[\s-]?2162\b|Housing[\s-]+Choice\s*[-–—]?\s*(SF|San Francisco)|\bHCSF\b|Section\s+206\.10|Housing Sustainability District/i`;
   - it does not match `/\b(not|ineligible)\b[^.]{0,40}\b(SB[\s-]?35|SB[\s-]?423|AB[\s-]?2011)/i`.

   There is no SB 423 or AB 2011 field; the text is the only indicator (21 and 12 PRJs live). "Local Program" alone is **not** an indicator, because pre-2026 records use it for the ADU Local Program (verified, e.g. `2022-013049PRJ`).
2. **`discretionary`** if any of these holds:
   - an anchor PRJ has a `d4jk-jw33` row;
   - it has a child of type `CUA, VAR, DNX, ENX, OFA, AHB, PHA, DVA, MAP, PCA, GPA, CTZ, COA, PTA, DRP, DRM` or `PPA`;
   - it is not a referral (below).

   Pipeline-only rows and PPA-only projects are `discretionary`.
3. **`permitOnly`** otherwise. This means no anchor PRJ, or every anchor PRJ is a **referral**. A referral PRJ has no streamlined or discretionary evidence and its `open_date` falls on or after the earliest component permit's filed day minus 30 days. In live data, 1,301 linked PRJs without entitlement evidence opened after their permit.

Child-type meanings for `DRM` and `PHA` are inferred from samples. `PHA` rows are Treasure Island, India Basin and HOPE SF phase approvals.

### 4.5 Stage entry dates

The `raw[s]` values are computed only from valid dates (§4.1). If a value is absent, the stage is absent.

| stage | `raw` (first that exists) | notes |
|---|---|---|
| `preApplication` | min `open_date` of the project's PPA children | dropped if not strictly before `raw.filed` |
| `filed` (not `permitOnly`) | min of the **filing evidence**: (a) anchor PRJ `open_date`, unless a PPA child opened within 7 days of it; (b) `open_date` of children of type `ENV, CUA, VAR, DNX, ENX, OFA, AHB, PHA, DVA, COA, PTA, MAP, PCA, GPA, CTZ`; (c) `d4jk` `start_event_date`; (d) filed day of any permit in the project | rule (a)'s exception exists because 43% of parented PPAs share their PRJ's `open_date`: the PRJ is created as the PPA's umbrella (verified) |
| `entitled` (not `permitOnly`) | `d4jk` `end_event_date` where `end_event_type='approval'` (coverage 2013-05-06 to the present); else PRJ `project_decision_date` when `project_decision='Approved'`; else pipeline `approved_date_planning`; else max `close_date` of children of the types in §4.4 rule 2 whose `record_status` matches `/Approved/` | |
| `permitFiled` | min filed day over **all** permits in the project, superseded ones included | for discretionary or streamlined projects this is kept only when `entitled` or `permitIssued` exists; a permit filed in parallel with Planning review leaves the project at `filed` |
| `permitIssued` | min `issued_date` over the live set | |
| `construction` | min over the live set of `first_construction_document_date` (site permits), else `issued_date` (full permits) | a site permit without an FCD has not started |
| `complete` | when every live permit has a completion day: the max of those days. A permit's completion day is the min of: its first `j67f` document date with units > 0, its `xdht` `first_completion_date`, and `completed_date` when `status='complete'` | completion is first TCO or CFC, as the Housing Inventory counts it |

**Out-of-order dates.** After `raw`, entry days are forced to be non-decreasing: walk `STAGE_ORDER` and set `entered[s] = max(raw[s], max entered[t] for earlier t)`. The forced stage still enters, with zero time in the earlier stage. Live data shows this is common: 22 site permits have FCD < issued, and 1,764 entitled PRJs opened after their permit was filed. The count goes in the report (`histories.clamped.<stage>`).

**Pipeline-only rows.**
- **Stage.** Map `current_status` as follows:
  - `PL Filed` → `filed`;
  - `PL Approved` → `entitled`;
  - `BP Filed` and `BP Approved` → `permitFiled`;
  - `BP Issued` and `BP BP Issued` (a live typo, 6 rows) → `permitIssued`;
  - `Construction` → `construction`.
- **Entry days.** `history[stage] = current_status_date`. Also `history.entitled = approved_date_planning` when that is present and not later.
- **Invalid date.** If `current_status_date` is invalid, the row is dropped and counted.

### 4.6 Ends and exits

Evaluate in this order:

1. **`complete`.** If `entered.complete` exists, then `end = { kind: 'complete', day: entered.complete }`.
2. **Exit by permit.** If the live set is empty and every permit is dead, the deciding permit is the last-dead one (latest `status_date`, then highest number).
   - **Reason:** `withdrawn` → `withdrawn`; `cancelled` and `revoked` → `cancelled`; `expired` → `expired`; `disapproved` → `disapproved`.
   - **Day:** its `status_date`.
3. **Exit by Planning.** This applies only when the project has no permits.
   - **Reasons:**
     - `withdrawn` if any anchor PRJ `record_status` is `Closed - Withdrawn`, `Withdrawn` or `Project Withdrawn`, or `project_decision` is `Withdawn` [sic] or `Withdrawn`;
     - `cancelled` if the status is `Closed - Cancelled` or `Cancelled`, or the decision is `Cancelled`;
     - `disapproved` if the status is `Disapproved`, `Closed - Disapproved` or `Denied`, or the decision is `Disapproved`.
   - **Day:** `project_decision_date`, else `close_date`, else `lastObserved`.

   All status and decision values were verified live.
4. **PPA-only.**
   - `Closed - Withdrawn` → `withdrawn`, and `Closed - Cancelled` → `cancelled`, each at `close_date`.
   - Any other PPA-only project whose PPA opened more than `ppaLag` days before `asOf` is `withdrawn` at its `close_date`, else its `open_date`. This is the design's rule that PPAs which never became a PRJ count as `withdrawn` exits.
   - Otherwise the project is open.
5. **Open.** Otherwise `{ kind: 'open', lastObserved }`.

`exit.stage` is the latest entered stage whose day is ≤ the exit day. The exit day is clamped to be ≥ that stage's day. A PRJ withdrawal never ends a project that still has a live permit. A project that is complete but whose permit was later cancelled stays complete.

A plain `Closed` PRJ with no permit and no decision is **open**. In live data, 1,394 of the 1,729 PRJs with 5+ units opened 2014–2020 are like this. Its `close_date` feeds `lastObserved`.

### 4.7 `lastObserved` and the stale-open rule

`lastObserved` is the latest valid date in any record of the project, clamped to `[first entered day, asOf]`. It draws on:
- PRJ `open_date`, `close_date` and `project_decision_date`;
- child `open_date` and `close_date`;
- `d4jk` start and end dates;
- permit `filed_date`, `issued_date`, `first_construction_document_date`, `completed_date`, `status_date` and `last_permit_activity_date`;
- pipeline `current_status_date`.

It is the last day on which the records show the project alive. A history never turns from open to dead because of age: censoring is `stage-calibration`'s job. A project untouched for years keeps `end.kind = 'open'`.

**In flight at the snapshot.** A project enters `projects.json` when all of these hold:
- it is in the population and its history ends `open` at `asOf`, or it is a pipeline-only row;
- it is matched to at least one pipeline row, **or** its first entered day is > `pipelineCutoff − 92`;
- its `units` ≥ 1;
- its `parcelIds` is non-empty.

`pipelineCutoff` is the max valid `current_status_date` in the pipeline (2026-07-28 live). The 92-day margin is one quarter, the dataset's published refresh cadence (tier 1: dataset metadata "quarterly"), so a filing made after the snapshot's quarter closed still counts.

Planning curates pipeline membership and drops lapsed projects. That makes it the first-party test of staleness. Live data shows why it is needed: 825 open-permit components are absent from the pipeline. Most are permits still `filed` from 1981–2015, and DBI was batch-withdrawing such permits in Sept–Oct 2026 (seen in `status_date`). Open projects that fail the test are **stale-open**. They stay open in histories and are counted in the report (`projects.staleOpen`, `projects.staleOpenUnits`), but are not in flight.

When daily records conflict with the quarterly pipeline, the records win. If the records show completion or exit after `pipelineCutoff`, or before it while the row is still listed, the project is not in flight. The conflicts are counted (`projects.pipelineConflicts`; 17 rows live).

### 4.8 In-flight fields

- **`stage`** is the latest key of `history` in `STAGE_ORDER`.
- **`units`** is gross proposed units. The first source that exists wins:
  1. Σ `proposed_units` over the live set (tier 0, `i98e`);
  2. anchor PRJ `number_of_units_prop` when > 0;
  3. pipeline `new_pipeline_units`.

  Pipeline-only rows use `new_pipeline_units`.
- **`existingUnits`** follows this order:
  1. pipeline `existing_units`, or for pipeline-only rows `max(0, new_pipeline_units − net_pipeline_units)`, so that units − existing equals Planning's net (live: `net = proposed − existing` holds on 1,892 of 1,917 rows);
  2. anchor PRJ `number_of_units_exist`;
  3. Σ live-set `existing_units` when > 0;
  4. Σ parcel `existingUnits` over `parcelIds` (2023 land use; I6).
- **`stories`**. The report counts each tier:
  1. max `number_of_proposed_stories` > 0 over the live set (tier 0; 505 of 12,858 null and 84 zero, live);
  2. parsed from the anchor PRJ `description`, else the pipeline `description_planning`. Take the first match of `/(\d{1,2}|one|two|…|twenty)[\s-]*stor(?:y|ies)/i` after the first match of `/\b(construct|erect|new|build)\b/i`, so the existing building's stories are skipped (tier 0 text, parsed);
  3. else the first `/(\d{2,3})[\s-]*(?:foot|feet|ft)\b/i` after that keyword, converted as `floor(ft / 10)`. This is the design's height-to-stories rule (tier 3, design §scenario-data);
  4. else `null`.

  A parsed value outside 1–80 is discarded (tier 4 sanity bound, labelled).
- **`sources`** lists every record that set a date, a number or the pathway, as `{ dataset, id }`. The dataset is the DataSF id. The id is: `record_id` for PRJ and child records; `b1_alt_id` for `d4jk`; `permit_number` for permits; the permit for `j67f` and `xdht`; `case_no ?? bpa_no` for pipeline rows. The list is sorted by `(dataset, id)`.

**`ProjectHistory` extras (T4d).**
- **`unitsAt`.** Each value is the units as currently recorded by that record type:
  - `filed` comes from PRJ `number_of_units_prop`;
  - `permitFiled` is Σ live-set `proposed_units`;
  - `complete` is Σ `xdht` (`net_units_completed + pts_existing_units`).

  The sources overwrite these values rather than keeping snapshots, so `entitled` is never present.
- **`storiesProposed`** follows the `stories` rule.
- **`baseStoriesAtFiling`** is the max `baseStories(id)` over `parcelIds`, else `null`. Both this and `unitsAt` fall short of the T4d wording; see Interface concerns.

### 4.9 Pipeline wiring

**Build order.** `build` (`pipeline/steps/build.ts:140-147`) adds the step `projectRecords` after `runSql` and after the `scenario-data` step, and before `stage-calibration`. It runs in pure TypeScript, as `writeTransit` does (`pipeline/steps/transit.ts`). Its inputs come from DuckDB tables:
- `parcelIds` and `existingUnits` from `parcel_out`;
- `baseStories` from `scenario-data`'s per-parcel table (name is an interface concern);
- `resolveRetired` from a point-in-polygon query on `parcels` (EPSG:7131), with the retired centroids reprojected from 4326.

**Outputs.**
- `out/<v>/scenarios/fzp/projects.json`. Minified, `schema: 1`. Keys are written in T3 declaration order, `history` keys in `STAGE_ORDER`, projects sorted by `id`, and `parcelIds` sorted, so the bytes are stable.
- `pipeline/.cache/derived/project-histories.json` (`HistoriesFile`) for live builds. The build also passes the histories in memory to `stage-calibration`.
- Fixture builds write the histories under the temporary work dir, and `--update-golden` copies them to `pipeline/test/fixtures/mini/golden/derived/project-histories.json`.
- `GOLDEN_FILES` (`pipeline/steps/fixture.ts:25-31`) gains `scenarios/fzp/projects.json`.
- `report.json` `counts` gains the `projects.*`, `histories.*` and `rhna.*` counts named in this spec.

**`rhnaCompletedNet`.**
- **`since`** is Day(2022-06-30). That is the start of the 6th-cycle RHNA projection period, verified in HCD's final determination to ABAG (2020-06-09): "projection period beginning June 30, 2022 and ending December 31, 2030", https://www.hcd.ca.gov/community-development/housing-element/docs/abagrhna-final060920(r).pdf. The 2023–2031 label on the existing target is the planning period (`src/lib/scoreboard/targets.ts:12`).
- **`units`** is Σ `net_units_completed` over `xdht-4php` rows whose `first_completion_date` lies in `[since, asOf]`. The rows cover new construction (forms 1 and 2), alterations (3 and 8) and demolitions (6, negative; 1,187 negative rows live). Dating by first completion matches the Housing Inventory, which counts TCO units as completed (2025 HI p.16, verified).
- **`provenance`**:
  - `tier: 0`;
  - `label: 'Net homes completed since 30 Jun 2022 (actual)'`;
  - `sources`: DataSF `xdht-4php` and the HCD letter;
  - `method` states the rule and the cross-check;
  - `n` is the number of rows counted;
  - `window` is `['2022-06-30', asOfIso]`.
- **Cross-check (tier 1).** For each calendar year wholly inside `[since, asOf]` that has a `hiNet` entry, compare the records' net for that year with 2025 Housing Inventory Table 2 "Net Change in Number of Units". The table gives 2023 2,544, 2024 1,603 and 2025 2,669 (verified from https://sfplanning.org/sites/default/files/resources/2026-04/2025_Housing_Inventory.pdf, p.17). `hiNet` lives in `InvariantProfile` (`pipeline/config.ts:44-67`). The live records on 2026-10-16 give 2,517, 1,610 and 2,813, so Σ is 6,940 against 6,816 (+1.8%). Tolerances are in V22.
- **Lag warning.** `rhna.xdhtLagDays` = `asOf` − max `first_completion_date` (8 days live). Above 120 days it is a warning, not a failure.

**Invariants.** They are added to `checkDataset` (`pipeline/steps/check.ts:90`) and use ids V20–V24, pending allocation (Interface concerns). Thresholds go in `InvariantProfile`. Every threshold below is a tier-4 check bound, not a model number.

| id | check | live | fixture |
|---|---|---|---|
| V20 | `projects.json` passes the validator. Checks: `schema` 1; `asOf` equals the snapshot day; ids unique; each project's `parcelIds` non-empty, sorted and in the parcel set; `stage` is the last key of `history`; `history` days non-decreasing in `STAGE_ORDER` and ≤ `asOf`; `permitOnly` projects have no `filed` or `entitled`; `units` ≥ 1; `existingUnits` ≥ 0; `stories` null or 1–80; `sources` non-empty | same | same |
| V21 | Pipeline coverage: Σ `units` of in-flight projects matched to population pipeline rows is ≥ 0.90 × Σ `new_pipeline_units` of those rows, excluding rows that the records show ended | ≥ 0.90 | = 1.0 |
| V22 | `rhnaCompletedNet`: each cross-check year within ±10% of `hiNet`, and the total within ±5% | 2023–2025 | the fixture's own `hiNet` |
| V23 | Histories: entry days non-decreasing; `end.day` ≥ the last entered day; `complete` implies `entered.complete = end.day`; `exit.stage` was entered; `lastObserved` in [first entered day, `asOf`]; each pathway has ≥ 1 history | same | same |
| V24 | Determinism and size: `deriveProjects` run twice gives byte-identical `projects.json` and histories; `projects.json` ≤ 2 MB (warning above 1 MB; engineering budget) | same | same |

**Fixture.** `make-fixture.ts` gains eight `raw/<lockId>.page-000.json` files (SODA shape: lower-case keys, numbers as strings, nulls omitted). It also gains matching lock entries, with `retrievedAt` ≤ 2026-10-10 so the fixture `asOf` stays Day(2026-10-10). The README gains a table of the mini projects. They sit on the existing lots of block 3512 in Mission:

| mini project | records | exercises | expected |
|---|---|---|---|
| M1 `2019-000001PRJ` | PPA `2018-000001PPA` (parent M1); ENV child; d4jk approval 2020-03-02; permit `201906010001` (type 2, site, filed 2019-06-01, issued 2021-02-01, FCD 2021-05-03, `completed_date` 1909-06-02, 24 units, 6 stories, address rows on lots 010 and 011); pipeline `Construction` | PPA, multi-parcel, junk date, parallel permit clamp | in flight, `discretionary`, `construction`, parcels [3512010, 3512011], `permitFiled` = 2020-03-02 |
| M2 `2026-000002PRJ` | `sb35` CHECKED, opened 2026-05-01, 40 units, "construct a new 8-story building", lot 013; pipeline `PL Filed` | streamlined flag, parsed stories | in flight, `streamlined`, `filed`, stories 8 |
| M3 `202403150003` | type 1 permit, filed 2024-03-15, no PRJ, 2 units, lot 005; pipeline `BP Filed` (bpa only) | permitOnly | in flight, `permitOnly`, history has only `permitFiled` |
| M4 `PPA:2021-000004PPA` | PPA with no parent, closed 2021-06-30 | PPA-only exit | history only: exit `withdrawn` at `preApplication` |
| M5 `2017-000005PRJ` | `Closed - Withdrawn`, closed 2018-04-02, 9 units, new construction | Planning exit | history only: exit `withdrawn` at `filed` |
| M6 `2016-000006PRJ` + `201605010006` | permit complete; `j67f` Initial TCO 2019-08-01 (12 units); `xdht` row with first completion 2019-08-01 | completion via TCO | history `complete` 2019-08-01; not in `rhnaCompletedNet` |
| M7 `201410070008` | type 2 permit `filed` 2014-10-07, not in pipeline | stale-open | history open, `lastObserved` 2014-10-07; `projects.staleOpen` = 1 |
| M8 `2020-000008PRJ` | permit on retired lot `3512099` (dropped 2020-01-01; lot 012 added 2020-01-01), issued; pipeline `BP Issued` | retired-lot successor; referral PRJ (opened after the permit, no evidence) | in flight, `permitOnly`, parcels [3512012] |
| M9 `2007.0001PRX` | pipeline-only, lot 014, `PL Approved`, status date 2008-06-12, 300 new units, 300 net | multi-phase row | in flight, `discretionary`, `entitled`, units 300, no history |
| M10 `2020-000010PRJ` | permit A `202001100010` withdrawn 2021-01-01, permit B `202203010010` filed (6 units), lot 001; d4jk approval 2021-11-01; pipeline `BP Filed` (bpa B) | superseded refile | in flight, `permitFiled` = 2021-11-01 (raw 2020-01-10 forced up to `entitled`), units 6 |
| M11 `2026-000011PRJ` | `new_construction` CHECKED, opened 2026-09-20, 3 units, lot 006, not in pipeline | after-cutoff filing | in flight, `discretionary` (not a referral, because it has no permit), `filed`, parcels [3512006] |
| xdht extras | `202101050007` (form 2, +3, first completion 2023-05-10); a form 3 row (+2, 2024-02-01); a form 6 row (−1, 2025-01-15) | net and demolitions | `rhnaCompletedNet.units` = 4, `n` = 3 |

The pipeline `current_status_date` max in the fixture is 2026-07-28. The fixture `hiNet` is {2023: 3, 2024: 2, 2025: −1}.

**Determinism.**
- No wall-clock time is used: `asOf` comes from the lock.
- All iteration is over sorted keys, and ties have the explicit tie-breaks above.
- `ppaLag` is computed with a stated percentile rule: nearest-rank, ⌈0.9·n⌉.
- With no qualifying PPAs (n = 0), `ppaLag` = ∞, so every PPA-only project stays open.

## 5. Seams

- **T9 policy levers.** `projects.json` is plain JSON read by `simulate`. Nothing more.
- **Addenda sub-stages.** Every permit number is kept in `sources`, so `87xy-gk8d` can join later by `application_number`. No addenda are fetched.
- **DA phasing.** Multi-phase rows are their own projects, recognisable by a `6jgi-cpb4` source id ending `PRX`. No phase schedule is inferred.
- **Renderings.** None. The PRJ and permit ids in `sources` are the future join key.

## 6. Testing

All tests run in `npm run test:pipeline`. Each test calls `expect`.

- **`fetch.test.ts`**:
  - a `format: 'json'` entry pages and counts array rows;
  - URLs carry the exact `$select` and `$where` of §4.1;
  - an exactly-full last page is followed by an empty page that is not locked.
- **`project-records/parse.test.ts`**:
  - Day from floating timestamps;
  - valid-date clipping (1909, 2205, after `asOf`);
  - `building_permits` splitting;
  - `CFc` matching.
- **`project-records/link.test.ts`**:
  - permit assigned to the latest PRJ opened on or before filing; a satellite PRJ adds no dates;
  - PPA by `parent_id`, and by block/lot inside `ppaLag`;
  - a component with two pipeline rows splits, and ids follow §4.2 step 8;
  - superseded refile detection.
- **`project-records/parcels.test.ts`**:
  - condo `blklot` → `mapblklot`;
  - retired → successors by date, including a three-way split;
  - centroid fallback;
  - ids outside the parcel set are dropped.
- **`project-records/classify.test.ts`**:
  - each streamlined indicator (flags, each regex term) and the "not eligible for SB 423" negation;
  - ADU "Local Program" text is not streamlined;
  - referral PRJ gives `permitOnly`;
  - the population rule excludes an alteration pipeline row.
- **`project-records/stages.test.ts`**:
  - one case per row of the §4.5 table;
  - the PPA-umbrella exception;
  - a parallel permit while Planning is open stays at `filed`;
  - the forward clamp and its counts;
  - multi-permit completion is the max over the live set, and is absent while one permit is open.
- **`project-records/ends.test.ts`**:
  - each permit and Planning reason mapping;
  - a live permit beats a PRJ withdrawal;
  - complete beats a later cancel;
  - PPA-only before and after `ppaLag`;
  - exit-stage selection and clamp.
- **`project-records/inflight.test.ts`**:
  - pipeline match, the after-cutoff window, stale-open exclusion and conflict counting;
  - units, existing units and stories precedence;
  - stories regex skips "existing two-story";
  - the feet fallback.
- **`project-records/rhna.test.ts`**:
  - window bounds are inclusive;
  - negative demolitions are included;
  - V22 passes and fails at the ±5% and ±10% edges.
- **Golden** (`golden.test.ts`): `fixture-0` `scenarios/fzp/projects.json` and `golden/derived/project-histories.json` match byte for byte. The expected values per mini project are in §4.9.
- **Invariants** (`invariants.test.ts`): V20–V24 each fail on a hand-broken copy of the fixture output, and pass on the real fixture output.
- **Property test**: for random permutations of input row order, `deriveProjects` output is byte-identical (V24).
- **Live, opt-in** (`live-raw.test.ts` pattern, skipped without `pipeline/.cache`):
  - V21 ≥ 0.90;
  - V22 holds;
  - in-flight units fall in [40k, 100k], a sanity band around the 2026-Q2 pipeline total of 75,853 that includes alterations (tier 1, Planning pipeline report).

No browser, e2e or axe tests apply: this subsystem has no UI. `fixture-0` loading of `projects.json` is exercised by `timelapse-sim` and `fzp-mode` e2e tests.

## 7. Acceptance criteria

1. `npm run pipeline -- fetch` writes eight new lock entries with the §4.1 URLs and licences, and `fetch --restore` restores them.
2. `npm run pipeline -- build` writes `out/<v>/scenarios/fzp/projects.json`, which matches T3 exactly and passes V20–V24. The build exits 1 if any of them fails.
3. `pipeline/.cache/derived/project-histories.json` exists after a live build and every element matches T4d.
4. `npm run pipeline -- fixture` reproduces the golden `projects.json` and histories. The in-flight mini projects are M1, M2, M3, M8, M9, M10 and M11. M4–M7 appear only in histories. `rhnaCompletedNet.units` is 4.
5. `projects.json` has no project whose history ends complete or exit at `asOf`, and no stale-open project.
6. `rhnaCompletedNet.since` is Day(2022-06-30) and its provenance carries tier 0, the xdht and HCD sources, and the window.
7. `report.json` carries:
   - `projects.inFlight` and `projects.inFlightUnits`;
   - `projects.byPathway.*` and `projects.byStage.*`;
   - `projects.staleOpen` and `projects.staleOpenUnits`;
   - `projects.pipelineConflicts` and `projects.excludedAlterationUnits`;
   - `projects.stories.{permit,parsedStories,parsedFeet,null}`;
   - `projects.parcels.{active,condo,successor,spatial,unresolved}`;
   - `histories.total`, `histories.clamped.*` and `histories.ppaLagDays`;
   - `rhna.units`, `rhna.crossCheck.<year>` and `rhna.xdhtLagDays`.
8. Two builds from the same lock and code produce byte-identical `projects.json` (V12 still holds with the new file).

## 8. Open questions

1. **RHNA `since`.** The projection period starts 2022-06-30; the planning period starts 2023-01-31. *Recommend 2022-06-30*: it is the period whose need the RHNA figure measures, verified from HCD. Note that HCD's progress reports count permits issued, whereas this counts completions, as the design asks. Both the label and the provenance say "completed".
2. **PPA-only pathway.** PPA descriptions are not fetched, so a PPA-only project defaults to `discretionary`. *Recommend keeping the default* and revisiting once PPA descriptions are needed. There were only 9 PPAs in 2023 and none after.
3. **Single-unit new construction.** It is in the population (units ≥ 1). *Recommend including it*: single-family replacement is a real building change and part of the initiation history.
4. **AB 2162 as streamlined.** It is a ministerial supportive-housing path that the design's list omits. *Recommend including it* (11 PRJs flagged).

## Interface concerns

1. **Design stage table vs T2.** The table says `filed` for `permitOnly` is the permit `filed_date`, but T2 says `permitOnly` never enters `filed`. This spec follows T2.
2. **T3 `id` comment.** The comment "PRJ record id, else permit number" cannot keep ids unique once pipeline rows split a PRJ, or for `…PRX` rows. The spec uses `${prj}:${permit}`, `case_no` and `PPA:${id}` (§4.2).
3. **No address in T3.** T6 `ProjectCard.label` wants "address if known", but T3 has no address. *Suggest adding `address: string | null`* (from permit address rows or PRJ `project_address`). Without it, the card always shows "Block B Lot L".
4. **Multi-phase rows.** `…PRX` rows put thousands of units on one tracking parcel: Candlestick has 9,637 units on `4884025`. T3 has no flag for this, and `generateForUnits` cannot mass it truthfully. *Suggest `multiPhase?: boolean`*, or have consumers detect the `PRX` source.
5. **`baseStoriesAtFiling` (T4d).** No historical height maps are ingested, so the value is the current base (pre-FZP) height, not the height at filing. It also needs a per-parcel base-stories table from `scenario-data`, which no T-row names.
6. **`unitsAt` (T4d).** "As recorded at each stage" overstates the sources: they keep current values, not snapshots, and `entitled` units are never recorded. The revision model therefore compares record types, not a time series.
7. **Per-project stories tier.** `stories` mixes tier 0 and tier 3 values with no per-project field to tell them apart, so only aggregate counts can reach the provenance panel.
8. **Invariant ids.** Three pipeline specs add invariants. This spec assumes V20–V24, and the orchestrator should allocate the ranges.
9. **`HistoriesFile` wrapper.** The wrapper (`schema`, `asOf`) is internal and must match what `stage-calibration` reads.
