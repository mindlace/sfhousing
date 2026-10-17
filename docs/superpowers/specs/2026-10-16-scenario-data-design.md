# scenario-data: spec (fzp-timelapse)

Status: derived from [the FZP timelapse design](../design/2026-10-16-1903-fzp-timelapse.md) (approved with partner rulings). Owns T11 and the `sfh-scenario/1` codec. Consumes T4a (feature list), T4b (F) and T4 (`Provenance`).

Evidence marks: **(V)** means verified, with a file:line or a URL I fetched or queried live on 2026-10-16. **(I)** means inferred.

## 1. Scope

> **`scenario-data`** (data pipeline). Ingests the adopted FZP heights from DataSF `h9wh-cg3m` (`base//localProgram-R-4` strings, verified 2026-10-16) and the assessor's secured roll `wv5m-vpq2` (year built, units, stories, land and improvement value; PDDL). It joins both to parcels. For every eligible parcel it writes the FZP envelope, the redevelopment features, and a small yield table (units at each quantised fill level of the envelope, computed with the existing generator). Output is a compact columnar `scenarios/fzp/parcels.bin` under the dataset version. With it the worker can score the whole city without loading every parcel chunk. Height-to-stories rule: `stories = floor(heightFt / 10)`, so 40 ft gives 4 stories, matching Planning's framing (orchestrator call, tier 3). New simulated projects use the **Local Program** height (orchestrator call).

**In:**
- New lock sources `datasf-height-bulk`, `datasf-parcel-attrs` and `datasf-assessor-roll`, with fetch and normalise support (CSV paging for the roll).
- `parseHeightDistrict`, the parcel ↔ district join, base and Local Program stories, and the `localProgram` flag.
- Roll ingest for 2007–latest, lineage of retired parcel numbers onto current parcels, and the T4a feature values.
- Base density caps, the yield step (generator inside the pipeline) and `FILL_LEVELS`.
- The codec `src/lib/data/scenario-codec.ts` (`sfh-scenario/1`) and the types in `src/lib/data/scenario.ts`.
- The manifest `scenarios` field (I12 amendment).
- Two in-build tables for downstream pipeline subsystems: `scenario_envelopes` and `scenario_panel`.
- Invariants V15–V19, the fixture-0 mini scenario parcels, and report counts.

**Out:**
- `projects.json` (project-records) and `calibration.json` (stage-calibration).
- Fitting anything, choosing the fitting window, and the size-model probabilities.
- Runtime decoding policy in the worker (timelapse-sim calls the codec).
- Corner-lot height bonuses, historic-register data, and Neighborhood Commercial (NC) density limits (§8).

## 2. Interfaces

Rows copied verbatim from the design.

| # | interface | owner → consumers | mark |
|---|---|---|---|
| T4 | `interface Provenance { tier: 0 \| 1 \| 2 \| 3 \| 4; label: string; sources: { label: string; url: string }[]; method: string; n?: number; window?: [from: string, to: string] }`. `interface Transition { months: number; advance: number[] /* cumulative incidence by month 1..months */; exit: Partial<Record<ExitReason, number[]>>; tail: { advance: number; exit: Partial<Record<ExitReason, number>> } /* constant monthly hazards beyond months */; provenance: Provenance }`. `scenarios/fzp/calibration.json` = `{ schema: 1; asOf: Day; transitions: Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Transition>>>; initiation: InitiationModel; pathwayForNew: Record<Pathway, number> & { provenance: Provenance }; size: SizeModel; revision: RevisionModel }`. The calibration also carries `ppaShare: Record<Pathway, number> & { provenance: Provenance }`, the share of new projects that start at `preApplication`. `InitiationModel`, `SizeModel` and `RevisionModel` are rows T4a–c. Everything is plain JSON, so future policy levers can transform it (the T9 seam). **Sampling semantics:** a project entering stage *s* at day *d* draws one uniform. The month of advance or exit comes from the cumulative tables (`advance` + Σ`exit` ≤ 1 at every month), with the tail hazards beyond `months`. An in-flight project already *m* months into *s* draws conditionally on having survived *m* months. Day within the month is uniform | stage-calibration → timelapse-sim, fzp-mode | MC (every parameter carries tier + source), DC (encoding) |
| T4a | `type FeatureId = 'potentialRatio' /* yield units at envelope ÷ max(existingUnits, 1) */ \| 'existingUnits' \| 'lotAreaM2' \| 'yearBuilt' \| 'storiesGap' /* envelope stories − existing stories */ \| 'improvementShare' /* improvement ÷ (land + improvement) assessed value */ \| 'rentControlLikely' /* 0/1: ≥ 2 units and built < 1979 */ \| 'landUseClass' /* categorical: residential, mixed, commercial, pdr, vacant, other */`. `interface InitiationModel { kind: 'logit-monthly'; intercept: number; terms: { feature: FeatureId; bins: number[] /* ascending edges; categorical features use category index */; coef: number[] /* one per bin */ }[]; provenance: Provenance }`. Monthly hazard = `1 / (1 + exp(−(intercept + Σ coef[bin(feature)])))`. It is fitted on pre-FZP (base) envelopes and evaluated on FZP envelopes. Parcels with an in-flight project are not at risk until that project ends | stage-calibration → timelapse-sim, scenario-data (feature list) | DC |
| T4b | `interface SizeModel { fillLevels: number[] /* ascending fractions of envelope stories; last = 1; length F matches T11 yield */; byEnvelope: { maxStoriesUpTo: number; probs: number[] /* length F, sums to 1 */ }[]; provenance: Provenance }`. A new project proposes `stories = max(1, round(fill × envelope.maxStories))` | stage-calibration → timelapse-sim, scenario-data (F) | DC |
| T11 | `scenarios/fzp/parcels.bin` (codec `sfh-scenario/1`, in `src/lib/data/`): per eligible parcel `id`, `labelPoint`, `cellId`, `envelope: Envelope` (FZP Local Program stories), the base (pre-FZP) stories, the T4a feature values (with base-envelope and FZP-envelope variants of `potentialRatio` and `storiesGap`), a `localProgram: boolean` flag (false when the parcel is excluded from the Local Program, in which case `envelope` is the base height) and `yield: Uint16[F]`, the units at each quantised fill level of the envelope. Named in the manifest as `scenarios?: { fzp: { parcels: url; projects: url; calibration: url } }` (amends I12; optional, so older datasets load) | scenario-data → timelapse-sim | DC |
| I1 | `type ParcelId = string` — SF `mapblklot` (block+lot, e.g. `"3512008"`), the single join key across all data | data-pipeline → all | DC |
| I2 | `interface Envelope { maxStories: number }` — the per-parcel allowed envelope. The **only** thing manipulation writes. Later milestones add optional fields; M1 code must ignore unknown fields | plan-model → generator, scoreboard | MC (envelope-as-common-currency), DC (field set) |
| I6 | `interface ParcelRecord { id: ParcelId; polygon: [x: number, y: number][][] /* local metres, exactly EPSG:7131 (NAD83(2011) / San Francisco CS13, metres), origin at label point */; labelPoint: [lng, lat]; areaM2: number; existingUnits: number; existingFloorAreaM2: number; existingHeightM: number; landUse: string; eligible: boolean; neighborhood: string }` | data-pipeline → plan-model, generator, scoreboard | DC |
| I8 | `generate(parcel: ParcelRecord, env: Envelope, seed: number, mode: BuildoutMode): GeneratedBuilding \| null`. Returns `null` for a replacement when its floor area ≤ `existingFloorAreaM2` **or** its units ≤ `existingUnits`: nobody rebuilds smaller or to fewer homes. (An `adu` keeps the existing building and is exempt) | generator → map-view, scoreboard | DC |
| I12 | Data manifest: `/data/<datasetVersion>/manifest.json` → `{ datasetVersion, builtAt, sources: { id, label?, url, retrievedAt, license }[], chunks: { cellId, bbox, url, parcelCount }[], buildingsTiles: url, basemapTiles: url, glyphs: url /* MapLibre `{fontstack}/{range}.pbf` template */, sprite?: url, neighborhoods: url }`. All `url`s are root-relative (`/data/<v>/…`). Every eligible-or-not parcel appears in **exactly one** chunk. `buildingsTiles` has one source-layer `buildings` with properties `parcelId`, `heightM`, `baseM`, at minzoom ≤ 12, with buildings clipped to parcels. Published versions are immutable and retained indefinitely. `datasetVersion` matches `^(\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\|fixture-\d+)$` (build date + 8-hex input hash) everywhere it is validated. R2 key = `data/<datasetVersion>/<path>`, served at `/data/<datasetVersion>/<path>` | data-pipeline → platform, plan-model, brush-tool (worker host), typology-generator, map-view | DC |
| I14 | Seed: `seed = fnv1a32(parcelId)`. Variety is a pure function of parcel and envelope, so the same plan always renders identically for everyone | generator | DC |

### Internal types (do not alter any row above)

All live in `src/lib/data/scenario.ts`; the codec is in `src/lib/data/scenario-codec.ts`.

```ts
export const SCENARIO_FORMAT = 'sfh-scenario/1';
/** T4b fill levels; F = FILL_LEVELS.length = 5. stage-calibration imports this constant. */
export const FILL_LEVELS = [0.25, 0.5, 0.75, 0.9, 1] as const;
/** The T4b proposal rule, shared so the pipeline and the worker round identically. */
export const fillStories = (fill: number, maxStories: number) =>
  Math.max(1, Math.round(fill * maxStories));
export const LAND_USE_CLASSES = ['residential', 'mixed', 'commercial', 'pdr', 'vacant', 'other'] as const;
export type LandUseClass = (typeof LAND_USE_CLASSES)[number];

/** Decoded T11. Struct of arrays; row i is one parcel; rows sorted by (cellId, id). */
export interface ScenarioParcels {
  format: 'sfh-scenario/1'; datasetVersion: string; scenario: 'fzp';
  rollYear: number;                 // latest closed_roll_year the features come from
  count: number; fillLevels: number[];
  cells: { cellId: string; start: number; count: number }[];
  districts: string[];              // normalised height strings; '' = no district
  provenance: Record<'envelope' | 'localProgram' | 'features' | 'existingUnits' | 'yield', Provenance>;
  id: string[]; index: Map<ParcelId, number>;
  labelPoint: Float64Array;         // 2 per row, lng/lat, exact to 1e-7
  cell: Uint16Array;                // index into cells
  district: Uint16Array;            // index into districts
  envelopeStories: Uint8Array;      // T11 envelope.maxStories (0 = no envelope)
  baseStories: Uint8Array;
  localProgram: Uint8Array;         // 0/1
  hostable: Uint8Array;             // 0/1: may receive a simulated project
  split: Uint8Array;                // 0/1: largest district overlap < 90% of parcel area
  imputed: Uint8Array;              // bit 0 yearBuilt, 1 existingStories, 2 improvementShare, 3 existingUnits, 4 no roll row
  existingUnits: Uint16Array; existingStories: Uint8Array; lotAreaM2: Uint32Array;
  yearBuilt: Uint16Array; improvementShare: Float32Array; rentControlLikely: Uint8Array;
  landUseClass: Uint8Array;         // index into LAND_USE_CLASSES
  baseYield: Uint16Array;           // gross units at full base envelope (base density cap applied)
  yield: Uint16Array;               // count × F, row-major: yield[i * F + k]
  potentialRatio: { fzp: Float32Array; base: Float32Array };   // derived at decode
  storiesGap: { fzp: Int16Array; base: Int16Array };            // derived at decode
}
export function encodeScenarioPayload(p: ScenarioParcels): Uint8Array;          // deterministic
export function decodeScenarioPayload(bytes: Uint8Array): ScenarioParcels;      // sync; throws ScenarioFormatError
export async function readScenarioParcels(body: ReadableStream<Uint8Array> | Uint8Array): Promise<ScenarioParcels>; // inflate + decode
export function featureValue(p: ScenarioParcels, i: number, f: FeatureId, env: 'fzp' | 'base'): number;
export function envelopeOf(p: ScenarioParcels, i: number): Envelope;            // { maxStories: envelopeStories[i] }
```

The pipeline-only tables (DuckDB, in-build) are also exported as parquet to `pipeline/.cache/derived/<datasetVersion>/`. They are never shipped:
- `scenario_envelopes(parcel_id, district, base_ft, lp_ft, base_stories, lp_stories, envelope_stories, local_program, lp_exclusion, split, zoning_code, hostable)`, one row per parcel. project-records reads `base_stories` for T4d `baseStoriesAtFiling`.
- `scenario_panel`, defined in §4.6. stage-calibration fits T4a on it.

## 3. Global constraints

Copied verbatim from the design.

**Evidence hierarchy (partner ruling; global)**

Every number the simulation uses comes from the highest tier available. It carries that tier and its source, and the UI can show both.

| tier | kind | example here |
|---|---|---|
| 0 | per-record time series | DBI permit dates, Planning approval dates, TCO/CFC dates |
| 1 | published first-party aggregates | Housing Inventory production tables, quarterly pipeline report |
| 2 | researched inferences from observations | a redevelopment hazard fitted to SF parcel history; resize ratios measured across linked records |
| 3 | research models / literature | NAHB construction durations, statutory review clocks used as duration proxies |
| 4 | made up | anything else, labelled as such |

Consequence: calibration is **computed by the data pipeline from DataSF records**, and literature figures are used only where the records can't answer. The dataset probe found tier-0 coverage for almost every stage. There is no tier-0 figure for deaths before any filing, or for the new Local Program's own durations (it has been in force only since 2026-01-12).

**Global constraints**

The source design's constraints still apply (free and open, determinism, overshoot meaningful, honesty of numbers, performance, mobile, static versioned data, conventions). In addition:

- **Evidence hierarchy** (above). No number reaches the simulation without a tier and a source. A tier-3 or tier-4 number is never presented as data.
- **Determinism.** The same `datasetVersion` and seed always give the same future, on every machine. The representative seed is chosen deterministically: the run whose final `completedNet` is the median of the N band runs.
- **Honesty of numbers.** The mode is labelled a *simulation*. The scoreboard shows the shown run and the p10–p90 band. Pipeline and new-FZP units are separate lines. Actual completions since the RHNA period start are counted and labelled as actual. Units lost to dead projects are shown.
- **Time scrubbing performance.** At 60 fps on a 2022-era laptop with the whole city's timeline loaded, per-frame JS during scrub or playback is O(1) in project count. A reroll reaches a full new timeline (the shown run, to 2050) within 3 s off the main thread. The p10–p90 band may fill in progressively afterwards; the UI marks it as provisional until it is complete.
- **First paint.** `/fzp` must not require loading every parcel chunk. The whole-city score comes from `parcels.bin`, `projects.json` and `calibration.json`. Geometry streams with the viewport, as on `/`.
- **The editor is unchanged.** `/` and `/p/:id` behave exactly as before. FZP mode is additive.
- **Accessibility.** WCAG 2.2 AA as in `docs/dev/accessibility.md`. The scrubber is a labelled slider: arrow keys step a month, Page Up/Down a year. Reduced motion stops autoplay, but scrubbing still works.

## 4. Behaviour

### 4.1 Sources and lock entries

Each entry is added to `DATASF` (`pipeline/sources/datasf.ts:10`), so `FETCH_IDS` (`pipeline/steps/fetch.ts:17`) picks it up. Each also goes into `SourceId`/`TABLES` (`pipeline/sources/normalise.ts:6`). `DATASF` gains an optional `format: 'geojson' | 'csv'` (default `'geojson'`). The CSV path uses the same SODA paging as `fetchDatasf` (`datasf.ts:58`) against `/resource/<id>.csv`, counting data rows minus the header.

| lock id → table | dataset, `$select`, `$where` | rows 2026-10-16 | licence |
|---|---|---|---|
| `datasf-height-bulk` → `src_height_bulk` | `h9wh-cg3m` geojson; `height,gen_hght,the_geom` | 5,292 polygons, 269 distinct strings (V, `$group=height`) | `public-domain` (V: metadata "Public Domain U.S. Government") |
| `datasf-parcel-attrs` → `src_parcel_attrs` | `acdm-wktn` csv; `mapblklot,blklot,active,zoning_code,date_rec_add,date_rec_drop,centroid_latitude,centroid_longitude`; no `$where` | 227,967 active + 8,606 retired (V); drops dated 1977-03-11..2026-06-03 (V) | PDDL-1.0 (V) |
| `datasf-assessor-roll` → `src_roll` | `wv5m-vpq2` csv; `closed_roll_year,parcel_number,use_code,property_class_code,year_property_built,number_of_stories,number_of_units,property_area,assessed_land_value,assessed_improvement_value,status_code`; `closed_roll_year >= 2007` | 19 years 2007–2025, 197,778–213,531 rows per year, about 3.97 M in all (V, `$group=closed_roll_year`) | PDDL-1.0 (V) |

- Labels are "DataSF Zoning Map – Height and Bulk Districts", "DataSF Parcels (attributes, active and retired)" and "DataSF Assessor Historical Secured Property Tax Rolls".
- Homepages are `https://data.sf.gov/d/<id>`. They flow into manifest `sources` and `/attribution` (`pipeline/steps/manifest.ts:32`).
- The roll is about 80 CSV pages. Each page is a lock file, archived to R2 like every raw file.
- The existing `datasf-parcels` entry is unchanged.
- Normalise: `read_csv(all_varchar=true)`, then `TRY_CAST`. `parcel_number`, `blklot` and `mapblklot` are upper-cased and trimmed. `year_property_built` outside [1850, roll year] becomes NULL.

### 4.2 Height strings: `parseHeightDistrict(s)` (pure, `pipeline/lib/heights.ts`)

Output: `{ kind: 'none' } | { kind: 'height'; baseFt: number; lpFt: number | null; r4: boolean; normalised: string }`.

1. **Normalise.** Trim, collapse runs of whitespace to one space, and rewrite a trailing `-?R-?4` as `-R-4`. The live string `120/400//120/650-R4` (V) needs this.
2. **Sentinels.** A string with no 2–4-digit token is `none`. Live sentinels (V; `gen_hght` 1111–9999): `OS`, `CP`, `HP`, `HP-RA`, `MB-RA`, `Special Height District`, `None Stated`, `USCG/Caltrans`, `Job Corps`.
3. **Sides.** Split on `//`. More than one `//` is a parse failure, so V16 fails. Left is base, right is Local Program.
4. **Height of a side** = the maximum token matching `^\d{2,4}$` after splitting the side on `[-/ ]`. Bulk suffix digits (`R-4`, `S-2`, `A-1`, `X-2`) are one digit and are never heights. Bulk names such as `2Y YBI` are not pure digits.
   - So `40//65-R-4` gives 40 and 65. `140/400//140/450-R-4` gives 400 and 450 (podium/tower: the generator's tower typology models the podium, `select.ts:12`). `55/65-X` gives 65. `80-T-130-T` gives 130. `65-TI/240 Flex Zone-TI` gives 240.
   - Checked against all 269 live strings: the maximum on the Local Program side, else the base side, equals `gen_hght` for every non-sentinel string (V). Semantics of multi-number forms: max is the permitted ceiling (I).
5. **`r4`** = the normalised string ends `-R-4`. An R-4 string with no `//` has `lpFt = baseFt`.
   - Five live strings have `//` without R-4: `120/400-R-2  //  140/590-R-2`, `120/400-R-2 / 120-R-2  //  140/590-R-2`, `120/400-R-2  //  140/520-R-2`, `85-X // 120/400-R-2` and, before normalisation, `120/400//120/650-R4` (V).
   - The first four are **not** Local Program: the program is "R-4 Height and Bulk District" only (V: Director Bulletin 11, §206.10(b)(3)). Their envelope is the base side. They are counted in `scenario.height.dbl_non_r4` (§8 OQ-5).

**Stories** (tier 3, orchestrator): `stories(ft) = min(80, floor(ft / 10))`. 80 is `MAX_STORIES` (`src/lib/generator/constants.ts:27`), which the generator clamps to anyway (`generate.ts:64`).

### 4.3 Parcel ↔ district join

- Both layers are in EPSG:7131, as in `10_parcels.sql:6`. For each parcel, compute the intersection area with every district polygon (`ST_Intersects`, then `ST_Area(ST_Intersection)`). The parcel takes the district with the **largest overlap**.
- Ties within 0.01 m² go to the district containing the label point, then to the smaller normalised string.
- Label-point-only assignment is rejected: a label point in a sliver district would mis-assign a lot that is mostly in another.
- `split = 1` when the winning overlap is < 90% of the parcel area. This is a reporting threshold only, and the whole parcel still takes one envelope (DC: the generator has one envelope per parcel). The count goes in `scenario.height.split`, and the units on split parcels in `scenario.height.split_units`.
- A parcel with no overlap gets district `''` and `kind: 'none'`.

### 4.4 Base and Local Program stories and `localProgram`

- `baseStories = stories(baseFt)`.
- For `r4` parcels, `lpFt' = max(baseFt, lpFt)`. Then, if `lotAreaM2 ≥ 743.2` (8,000 sf) and `lpFt' < 65`, `lpFt' = 65`.
  - Source for the large-lot rule (V, tier 1): Bulletin 11 citing §206.10(d)(1)(C). The same rule covers corner lots, which are not modelled (§8 OQ-1).
- `localProgram = r4 ∧ ¬excluded`, where `excluded` is any of:

| exclusion (V: Bulletin 11) | data and approximation | tier |
|---|---|---|
| demolition on a site with > 2 rent-controlled units, §206.10(b)(9) | latest roll year: Σ `number_of_units` over **non-condo** rows ≥ 3 **and** `yearBuilt < 1979`. The Rent Ordinance covers pre-1979-06-13 buildings (I). Condo classes (`Z, ZBM, ZEU, LZ, LZBM, CZ, OZ, PZ, IZ, GZ, BZ, OZEU`) are excluded: Costa-Hawkins (I). Every simulated project replaces the existing building, so any project on such a site demolishes. | 2 |
| demolition or conversion of a Hotel, §206.10(b)(10); motels may be eligible | any latest-roll row with `property_class_code ∈ {H, H1, H2, HC, HG, RH, RH1, RHG}` (codes V from a `$group` of 2025; RH = residential hotel/SRO counts as a Hotel (I)). `M`/`MG` motels are not excluded (V: Bulletin footnote 4). | 2 |
| Article 10/11 listed properties | mapped outside R-4 (V: Bulletin footnote 1), so the height string already excludes them | 0 |
| demolition of California/National Register buildings, Article 10 district contributors | no ingested dataset: **assumed eligible** (§8 OQ-2) | 4 |
| Development-Agreement SUDs, §206.10(b)(8) | DA areas carry non-R-4 strings (Mission Rock, HP, CP, TI) (V: string list), so they are excluded by the map | 0 |

- `envelopeStories = localProgram ? stories(lpFt') : baseStories`. It is 0 when `kind = 'none'`.
- `hostable = (ParcelRecord.eligible) ∧ envelopeStories ≥ 1 ∧ yield[F−1] > 0`.
- Provenance `localProgram`: tier 2, method "R-4 bulk from h9wh-cg3m; exclusions approximated from wv5m-vpq2; register listings not modelled".

**Base density cap** (applies to the base path only; the Local Program decontrols density, per the literature survey §1 [A]). The rule comes from `zoning_code` of the parcel's chosen `acdm-wktn` row, picked like `10_parcels.sql:13`:

| zoning | before 2022-11-27 | from 2022-11-27 |
|---|---|---|
| RH-1, RH-1(D) | 1 per lot | 4 per lot (V: fourplex exception, effective 2022-11-27, sfplanning.org code summary 2021-010762PCA) |
| RH-1(S) | 2 | 4 |
| RH-2 | 2 | 4 |
| RH-3 | 3 | 4 |
| RM-1 / RM-2 / RM-3 / RM-4 | 1 per 800 / 600 / 400 / 200 sf of lot area (I, must be verified against §209.2) | same |
| anything else | no cap | no cap |

- Tier 1 (first-party code text). The implementer must cite §209.1/§209.2 next to the table, and the AC requires it.
- Corner-lot six-unit allowances are not modelled. Neither are NC district caps (§8 OQ-4).

### 4.5 Roll ingest, lineage and features

**Join.** Roll `parcel_number` = `acdm-wktn` `blklot` (V: 2025 rows `3512005` etc. match the blklot form). Mapping to a current parcel:
- (a) a `blklot` whose `mapblklot` is a current parcel id goes to that parcel. Condo sub-lots map to their `mapblklot`, exactly as chunks do.
- (b) a retired `mapblklot` goes to the current parcel whose polygon contains the retired row's centroid. Ties go to the smallest id.
- (c) anything else is unmatched. It is counted per year in `scenario.roll.unmatched.<year>` and `…_units`.

So the history of lots merged for a project lands on the merged lot. Without this, the parcel-years that preceded a redevelopment would vanish from the panel.

**Aggregation per (current parcel, roll year)** over all mapped rows:
- `units` = Σ `number_of_units`.
- `stories` = max `number_of_stories`.
- `yearBuilt` = the min valid year over rows with units > 0, else over all rows.
- `land` and `impr` = Σ assessed values.
- `floorAreaM2` = Σ `property_area` × 0.09290304.
- `landUseClass` from the row with the largest `property_area`: `SRES`/`MRES` → residential, `MISC` → mixed, `COMM`/`COMR`/`COMO`/`COMH` → commercial, `IND` → pdr, `GOVT` → other. A `property_class_code` starting `V` overrides to vacant (codes V from the 2025 `$group`; the mapping is mine (I)).

**One scenario view of a parcel, used for both the panel and parcels.bin.** `scenarioRecord(rec, agg)` is the chunk `ParcelRecord` with these fields replaced:
- `existingUnits`:
  - `agg.units` when > 0;
  - else the LUDB units (`rec.existingUnits`) when every mapped row has `status_code = 'N'` (government, where public housing carries 0 units on the roll; bit 3);
  - else 0.
- `existingFloorAreaM2` = `agg.floorAreaM2` when > 0, else `rec.existingFloorAreaM2`.
- `existingHeightM` = `existingStories × 3.1`.

Features:
- `existingStories` = `agg.stories` when > 0. Else `max(1, round(rec.existingHeightM / 3.1))` when `rec.existingHeightM > 0` (bit 1), else 0.
- `lotAreaM2` = `round(rec.areaM2)` (tier 0 geometry; the roll's `lot_area` repeats on condo rows).
- `yearBuilt`: missing becomes the median of the same `landUseClass` in that roll year (bit 0). Vacant lots get 0 and no imputation.
- `improvementShare` = `impr / (land + impr)`. When `land + impr = 0` (for example status N rows, `3512008`, V), it is the class median (bit 2). Vacant is 0.
- `rentControlLikely` = T4a verbatim: `existingUnits ≥ 2 ∧ yearBuilt < 1979`.
- A parcel with no roll row gets every feature imputed, plus bit 4.
- Tiers: features 0 (roll), imputations 2. Prop 13 caveat in provenance: assessed values reflect the acquisition basis, not market value.

The features reflect the roll year as of its lien date, 1 January of `closed_roll_year` (I: CA lien date). The current features use the **latest** roll year in the lock (2025 on 2026-10-16), and the header records it.

**Why the roll and not LUDB for units.** LUDB (`fdfd-xptc`) is a single 2023 snapshot. The initiation hazard must be fitted and applied on the same definition, so both use the roll. The roll's 2025 Σ units is 389,527 against LUDB's ~411,500 (V: `sum(number_of_units)` query; data-pipeline spec §4.9). The government fallback recovers part of the gap, and V18 bounds the rest.

### 4.6 Panel emitted for stage-calibration (`scenario_panel`)

One row per (current parcel, roll year) that has ≥ 1 mapped roll row, for **every** roll year in the lock (2007–2025). The fitting window is stage-calibration's (OD-T3).

Columns:
- `parcel_id`, `roll_year`, `lien_day` (T1 Day of 1 January `roll_year`)
- `existing_units`, `existing_stories`, `year_built`, `lot_area_m2`, `improvement_share`, `rent_control_likely`, `land_use_class`, `imputed`
- `base_stories`, `base_density_cap` (NULL = none, evaluated at `lien_day`), `base_yield`, `potential_ratio_base` = `base_yield / max(existing_units, 1)`, `stories_gap_base`
- `hostable_base` = eligible ∧ `base_stories ≥ 1` ∧ `base_yield > 0`

The base height is the **left side of the current string**, used as the pre-FZP height for every year. Tier 2. There is no historical DataSF height layer: the only Wayback copy before FZP, 2023-08-16, is truncated at SODA's default 1,000 rows (V). Provenance says so (§8 OQ-3).

### 4.7 Yield table

Computed in the pipeline with the shared function `scenarioYield(rec, stories, cap)` in `src/lib/data/scenario-yield.ts`. It is pure and imports `generate` from `src/lib/generator`, so the worker can recompute under a future lever (T9).

- `b = generate(rec, { maxStories: stories }, fnv1a32(rec.id), 'max')`, with I14's seed.
- `null` gives 0.
- An ADU (`replacesExisting = false`) gives `rec.existingUnits + b.units`. Otherwise `b.units`. Yield is **gross units on the parcel after the project**, so net = yield − `existingUnits` for every row.
- If `cap` is set and the gross exceeds it, it becomes `cap`. Then 0 if `cap ≤ rec.existingUnits` (I8's "fewer homes" rule applied after the cap).

Per parcel, with `rec' = scenarioRecord(rec, latest)`:
- `yield[k] = scenarioYield(rec', fillStories(FILL_LEVELS[k], envelopeStories), localProgram ? null : cap(today))`.
- `baseYield = scenarioYield(rec', baseStories, cap(today))`.
- Distinct story counts are generated once per parcel.
- Panel `base_yield` uses `scenarioRecord(rec, agg_y)` and `cap(lien_day)`. It is memoised on (parcel, existingUnits, existingFloorAreaM2, existingStories).
- Values > 65,535 fail V17. Yields may be non-monotone in k, because typology steps change with stories (`select.ts:7`). They are stored raw.
- `FILL_LEVELS = [0.25, 0.5, 0.75, 0.9, 1]` is a **tier-4 quantisation grid**, not a measured number. The measured part is stage-calibration's `probs` over it. For a 4-story envelope it gives 1, 2, 3, 4, 4 stories; for 8, it gives 2, 4, 6, 7, 8; for 24, it gives 6, 12, 18, 22, 24. The resolution near full fill reflects that most new SF projects build close to the limit (I).
- Run time: about 155k × 4 distinct + panel memo misses. At the perf spec's ≤ 2.5 s per 150k synthetic parcels (`generator.perf.spec.ts:7`) that is ≈ 1–3 min (I). It is reported as `timings.scenario`.

`src/lib/generator` (and `src/lib/plan/types.ts`) are added to `PATHS` in `pipeline/lib/version.ts:33`. The yields depend on the generator, so a generator change must give a new `datasetVersion`.

### 4.8 Codec `sfh-scenario/1` and file

**File** `/data/<v>/scenarios/fzp/parcels.bin` is `deflateRaw(payload, level 9)`. Cloudflare does not compress `application/octet-stream`, which is what the route sends for `.bin` (V: data-pipeline spec §4.8; `src/routes/data/[version]/[...path]/+server.ts:10`). `readScenarioParcels` inflates with `DecompressionStream('deflate-raw')`, which exists in Node ≥ 22 and current browsers (I), then decodes synchronously.

**Payload** (little-endian):

```
0   "SFHS" magic | u16 major=1 | u16 reserved=0 | u32 headerLen H
12  header: UTF-8 JSON, H bytes, then zero padding to a multiple of 8
    { format, datasetVersion, scenario:'fzp', rollYear, count, fillLevels,
      cells:[{cellId,start,count}], districts:[...], landUseClasses:[...],
      provenance:{...}, columns:[{name,type,offset,byteLength}] }   // keys in this order
…   columns, each starting at an offset that is a multiple of 8, in this order:
    idPrefix u8[N]   idSuffixLen u8[N]   idSuffix bytes (ASCII, concatenated)
    labelLng i32[N]  labelLat i32[N]     (degrees × 1e7, exact)
    cell u16[N]      district u16[N]
    envelopeStories u8[N]  baseStories u8[N]  flags u8[N]  imputed u8[N]
    existingUnits u16[N]   existingStories u8[N]  lotAreaM2 u32[N]  yearBuilt u16[N]
    improvementShare u8[N] (round(share × 200); /200 on decode)  landUseClass u8[N]
    baseYield u16[N]       yield u16[N×F]
```

- `flags`: bit 0 localProgram, bit 1 rentControlLikely, bit 2 hostable, bit 3 split.
- Ids are front-coded against the previous row in file order (`idPrefix` = shared prefix length, ≤ 255).
- Rows are sorted by `cellId` (the chunk's cell, `pipeline/lib/rings.ts` `cellIdFor`), then by id. That is the same comparator as chunks (`parcel-chunk.ts:32`).
- **Every parcel in the chunks has a row**, with `count` = V2's `parcels.emitted`. Non-hostable rows carry zeros, so the worker can map any T3 `parcelIds` to a cell and a label point (see Interface concerns).
- `decodeScenarioPayload` derives:
  - `potentialRatio.fzp = yield[F−1] / max(existingUnits, 1)` and `.base = baseYield / max(existingUnits, 1)`;
  - `storiesGap.fzp = envelopeStories − existingStories` and `.base = baseStories − existingStories`.
  - `featureValue` returns these, or the stored column, or the class index for `landUseClass`.
- Errors throw `ScenarioFormatError` with a message:
  - bad magic or major;
  - header not JSON, or a missing key;
  - a column out of bounds or of the wrong length;
  - an index out of a dictionary's range;
  - `fillLevels` not ascending or not ending at 1.

**Size budget** (engineering, derived from the 5 MB first-paint rule; not a simulation parameter): payload ≈ 38 B/parcel ≈ 5.9 MB, compressed ≈ 2–2.5 MB (I). V19 fails above 3.0 MB compressed and warns above 2.5 MB.

**Determinism.** The payload is byte-deterministic (V12-style re-encode check). The deflate bytes may differ across zlib builds and CPUs (I). The golden therefore compares the decoded payload, as `buildings.pmtiles` is handled today (`docs/dev/pipeline.md`, Fixture).

### 4.9 Manifest (amends I12)

`src/lib/data/manifest.ts:43` gains:

```ts
scenarios: z.object({ fzp: z.object({ parcels: RootRelativeUrl, projects: RootRelativeUrl,
  calibration: RootRelativeUrl }) }).optional()
```

All three URLs are added to the `superRefine` prefix check (`manifest.ts:59`). A manifest without `scenarios` still parses. A partial `fzp` object is rejected.

`buildManifest` (`pipeline/steps/manifest.ts:18`) gains `scenarios?: boolean`. The build sets it only when all of `scenarios/fzp/{parcels.bin,projects.json,calibration.json}` exist in `outDir`, and the URLs are `${base}/scenarios/fzp/<file>`. Until project-records and stage-calibration land, builds omit `scenarios`. `src/lib/data/fixtures/manifest.golden.json` is regenerated.

### 4.10 Build placement, report and invariants

New step `pipeline/steps/scenario.ts`, called from `build` (`pipeline/steps/build.ts:146`) after `writeChunks`, before project-records, calibration and the manifest. SQL lives in `pipeline/sql/80_scenario.sql` (district join, roll aggregation, lineage), and the TS step does the yields and encoding.

Report counts (`scenario.*`):
- `parcels`, `hostable`, `local_program`, `excluded.rent_control`, `excluded.hotel`, `large_lot_65`
- `height.parse_fail`, `height.none`, `height.no_district`, `height.split`, `height.split_units`, `height.dbl_non_r4`
- `roll.years`, `roll.latest`, `roll.matched_parcels`, `roll.unmatched.<y>`, `roll.unmatched_units.<y>`, `roll.lineage_retired`
- `imputed.<field>`
- `units.total`, `yield.fzp_net_total` (Σ max(0, yield[F−1] − existingUnits) over hostable LP parcels), `yield.zero_hostable_eligible`, `yield.nonmonotone`
- `bytes.payload`, `bytes.file`

| # | invariant (fail → exit 1) | live expectation |
|---|---|---|
| V15 | `parcels.bin` inflates and decodes. `format`, `datasetVersion` and `scenario` match. `count` = `parcels.emitted`. Ids are unique, each is in exactly one chunk, and its `cell` equals that chunk's `cellId`. Re-encoding the decoded payload is byte-identical. | ✓ |
| V16 | `height.parse_fail = 0`. ≥ `heightJoinMin` (live 0.99, fixture 1) of `eligible` parcels have a district. | (I) |
| V17 | `fillLevels` deep-equal `FILL_LEVELS`. No clamped `u16`. `hostable ⇒ yield[F−1] > 0`. ≥ 50% of eligible parcels are hostable. **Warn** (not fail) if `yield.fzp_net_total` lies outside [0.25×, 4×] of Planning's ~780,000 net added capacity (tier 1 cross-check, literature §1 [A]). | (I) |
| V18 | The panel covers every roll year in the lock. In the latest year ≥ `rollJoinMin` (live 0.97, fixture 1) of eligible parcels have a roll row. `scenario.units.total` lies in `scenarioUnitsRange` (live [0.90, 1.02] × 413,208, fixture exact). | roll Σ 389,527 + gov fallback (V/I) |
| V19 | `bytes.file` ≤ `scenarioMaxBytes` (3.0e6). Warn > 2.5e6. | ≈ 2–2.5 MB (I) |

`InvariantProfile` (`pipeline/config.ts:44`) gains `heightJoinMin`, `rollJoinMin`, `scenarioUnitsRange` and `scenarioMaxBytes`. `docs/dev/pipeline.md` (Invariants, Fixture, Where things land) and the CLAUDE.md pipeline row are updated.

### 4.11 Fixture-0 mini scenario

`make-fixture.ts` adds three raw files, keeping the SODA conventions of `pipeline/test/fixtures/mini/README.md`:
- `datasf-height-bulk.page-000.geojson`;
- `datasf-parcel-attrs.page-000.csv`, one row per parcel row incl. retired, condo and null-id;
- `datasf-assessor-roll.page-000.csv`, roll years 2023–2025.

Districts (local x ranges, y [−100, 100]):

| x range | string | covers |
|---|---|---|
| [−60, 44) | `40//65-R-4` | lots 1–4, 40% of lot 5 |
| [44, 97) | `65-X` | 60% of lot 5, lots 6–9, 70% of lot 10 |
| [97, 110) | `85//120-R-4` | 30% of lot 10, lot 11 |
| [110, 120) | `Special Height District` | lot 12 |
| [120, 130) | `120/400-R-2  //  140/520-R-2` | lot 13 |
| [130, 140) | `120/400//120/650-R4` | lot 14 |

Zoning: lots 1, 2, 8 `RH-2`; 4, 10, 11 `RH-3`; 5 `RH-1`; 6 `RM-1`; 3 `NCT`; 13 `C-3-O`; 14 `C-3-G`; others `P`.

Roll highlights:
- lot 1: `F`, 2 units, 1912;
- lot 2: three `Z` condo rows, 1 unit each, 1985;
- lot 3: `H1` hotel;
- lot 4: `A`, 3 units, 1925;
- lot 11: status `N`, 0 units;
- lot 13: no 2025 row;
- retired `3512099` (centroid in lot 12, dropped 2023-06-30): 7 units in 2023 only.

Known answers (golden test assertions):

| lot | result |
|---|---|
| 1 | LP, base 4, envelope 6, rentControlLikely 1 (2 units < 3, so not excluded) |
| 2 | existingUnits 3, LP (condos are not counted as rent-controlled) |
| 3 | `excluded.hotel`, envelope = base 4 |
| 4 | `excluded.rent_control`, envelope 4 |
| 5 | district `65-X` (largest overlap), not LP |
| 10 | `65-X`, split 1 |
| 11 | existingUnits 3 (government fallback), envelope 12 |
| 12 | `none`, not hostable; 2023 panel row has 7 units via lineage |
| 13 | not LP (`dbl_non_r4`), base 40 stories, imputed bit 4 |
| 14 | `R4` normalised, LP, envelope 65 |
| 7, 9 | not hostable (ineligible) |

`FIXTURE_PROFILE` (`config.ts:107`) carries these thresholds. `fixture-0` gains `scenarios/fzp/parcels.bin`. The golden directory gains `scenarios/fzp/parcels.decoded.json` (a canonical JSON dump of the decoded payload). `parcels.bin` itself is excluded from the byte comparison in `pipeline/test/golden.test.ts:19`.

## 5. Seams

- **Policy levers (T9).** `ScenarioParcels` is plain typed arrays, copyable by a `PolicyOp`. `baseStories`, `localProgram`, `district` and `baseYield` are shipped so a lever can switch the program off or change eligibility. A lever that changes an envelope recomputes yields with the shared `scenarioYield` and I14's seed. Nothing more is built now.
- **Addenda sub-stages.** None here.
- **DA phasing.** DA areas resolve to `kind: 'none'` with their district string kept in `districts`, so a later DA-phasing source can find its parcels. No other change.
- **Renderings.** None.
- **Size-model granularity.** `FILL_LEVELS` lives in shared code and is written into the header. Changing F is a codec-compatible change, because `yield` is N×F with F taken from the header.

## 6. Testing

Vitest server project (`src/lib/data`, pure TS):
- `scenario-codec.test.ts`, fixture `src/lib/data/fixtures/scenario-tiny.ts` (6 rows over 2 cells, incl. ids `0026T001A`, `8711023C`, `3512001`, `3512002`):
  - encode → decode round trip, deep equality, including derived `potentialRatio`/`storiesGap` values;
  - encode twice gives identical bytes;
  - front-coding across a cell boundary;
  - each `ScenarioFormatError` case in §4.8 (bad magic, truncated column, dictionary index out of range, bad `fillLevels`);
  - `featureValue` for every `FeatureId` × env.
- `scenario.test.ts`: `fillStories` table (4 → 1, 2, 3, 4, 4; 8 → 2, 4, 6, 7, 8; 1 → 1 ×5); `FILL_LEVELS` ascending with last 1.
- `scenario-yield.test.ts` (stub generator via `vi.mock`): ADU gross rule; cap clips; `cap ≤ existing` gives 0; `null` gives 0; the seed passed is `fnv1a32(id)`.
- `scenario-yield.property.spec.ts` (fast-check, real generator on generator fixtures): never negative, ≤ 65,535, deterministic.
- `manifest.test.ts` additions: `scenarios` optional; full object parses; partial `fzp` rejected; wrong-version prefix rejected; golden manifest re-validated.

Vitest client project:
- `scenario-codec.svelte.spec.ts`: `readScenarioParcels` inflates a deflate-raw buffer in Chromium via `DecompressionStream`.

`npm run test:pipeline`:
- `heights.test.ts`: table over a committed snapshot of all 269 live strings (`pipeline/test/fixtures/height-strings-2026-10-16.json`, with expected `baseFt`/`lpFt`/`r4`/kind and `gen_hght`), asserting max = `gen_hght` for each non-sentinel; fast-check never throws.
- `scenario-sql.test.ts` on mini:
  - largest-overlap and split (lots 5, 10);
  - lineage (lot 12, 2023);
  - condo aggregation (lot 2);
  - government fallback (lot 11);
  - exclusions (lots 3, 4);
  - density cap table at 2022-11-26 vs 2022-11-27.
- `local-program.test.ts`: large-lot 65-ft bump on a synthetic 800 m² R-4 record at `40//40-R-4`; `lpFt < baseFt` takes the max.
- `fetch.test.ts` addition: CSV paging with a mock `Http` (header row not counted; short page stops; the trailing empty page is not locked).
- `normalise.test.ts` addition: the three new tables' column types; bad years become NULL.
- `invariants.test.ts` additions: V15–V19 each fail on a crafted out-dir (wrong count, parse failure, clamped yield, missing roll year, oversize file) and pass on mini.
- `version.test.ts` addition: `codeTreeHash` changes when a file under `src/lib/generator` changes.
- `golden.test.ts`: decoded payload equals `parcels.decoded.json` and is identical across two builds; known answers of §4.11.

Playwright e2e (`e2e/scenario-data.spec.ts`), after `npm run data:fixture`:
- `GET /data/fixture-0/scenarios/fzp/parcels.bin` returns 200 `application/octet-stream` with the immutable cache header.
- In page context, `readScenarioParcels(res.body)` gives `count === 14` and lot `3512014` envelope 65.

No page is added, so there is no axe gate here. fzp-mode owns it.

## 7. Acceptance criteria

1. `npm run pipeline -- fetch` writes lock entries `datasf-height-bulk`, `datasf-parcel-attrs` and `datasf-assessor-roll`, with licences `public-domain`, `PDDL-1.0` and `PDDL-1.0`. They appear in manifest `sources` and on `/attribution`.
2. A live `build` passes V1–V19, and `out/<v>/scenarios/fzp/parcels.bin` is ≤ 3.0 MB.
3. `report.json` carries every `scenario.*` count of §4.10, including `roll.latest = 2025` on a 2026-10 fetch.
4. Every one of the 269 live height strings parses. The max-height rule equals `gen_hght` for all non-sentinels.
5. `decodeScenarioPayload` round-trips, and its header `fillLevels` equals `FILL_LEVELS`. stage-calibration's `size.fillLevels` imports the same constant.
6. `scenario_envelopes` and `scenario_panel` exist after `build`, the panel covers 2007–2025, and both are exported under `pipeline/.cache/derived/<v>/`.
7. The fixture known answers in §4.11 hold, and `npm run pipeline -- fixture` is stable across two runs (decoded payload).
8. A manifest without `scenarios` still parses. `parseManifest` of fixture-0 passes with or without the field.
9. Changing any file in `src/lib/generator` changes `datasetVersion`.
10. The density-cap table cites Planning Code §209.1/§209.2 in a code comment, and the RM values are verified against the code text before merge.
11. Every numeric parameter in this subsystem's code has a comment giving its tier and source as in this spec.

## 8. Open questions

1. **Corner lots.** §206.10(d)(1)(C) also lifts corner lots to 65 ft. Corners need street centerlines, which the pipeline does not ingest. *Recommend:* defer, and record in `localProgram` provenance that corner lots are understated.
2. **Register-listed historic buildings in R-4.** *Recommend:* keep "assumed eligible" (tier 4, labelled), and add a historic-resources source in a later package.
3. **Pre-FZP heights for 2007–2025.** The panel uses today's base side. *Recommend:* ask Planning for a pre-2026 height-and-bulk export. Until then, stage-calibration should prefer recent roll years when the window rule allows, and say so in provenance.
4. **NC and other district density limits** are not capped, so base potential is overstated on NC parcels. *Recommend:* accept for this package and report the hostable NC count.
5. **The five non-R-4 `//` strings.** *Recommend:* treat them as non-Local-Program per Bulletin 11, as specified, and confirm with the partner.

## Interface concerns (for the orchestrator)

1. **T11 "per eligible parcel".** I ship **every** parcel, with a `hostable` flag. T3 `InFlightProject` carries only `parcelIds`, and without full coverage the worker cannot place pipeline projects (cell, label point) before chunks load.
2. **`ScenarioParcels`** is used by T5 `SimInput` but defined by no row. It is defined here as an internal type. Promote it to a row, or confirm it is internal to scenario-data → timelapse-sim.
3. **T4a has no missing-value rule.** I impute in the pipeline, the same way for the panel and the current values, and ship an `imputed` mask.
4. **`existingUnits` source.** The T4a feature and the net baseline in parcels.bin come from the roll (with a government fallback), not LUDB `ParcelRecord.existingUnits`. Numbers in FZP mode will differ from the editor's existing-unit counts, and possibly from project-records' T3 `existingUnits`. timelapse-sim should take net = yield − parcels.bin `existingUnits` for simulated projects.
5. **"Yield units at envelope" (T4a/T11)** is specified as gross units after the project, with the base density cap applied on the base path. The cap is new and needs the zoning code. Without it, a `40//40-R-4` parcel (77% of affected parcels keep their height) shows zero FZP effect.
6. **Sources added beyond the design's two:** `acdm-wktn` attributes (zoning code, retired lineage). The parcels source itself is untouched.
7. **Version hash** must include `src/lib/generator`. Every generator change then yields a new `datasetVersion` and needs `fixture --update-golden`. chreode's `src/**` rule does not run `test:pipeline` (`chreode.config.ts:10`), so only CI or a full signoff catches a stale golden.
8. **Compression inside `.bin`.** The decode is async. `docs/dev/data-serving.md` claims a stored `contentEncoding` "passes through"; that is unverified, so it is not relied on.
9. **Invariant numbering.** I claim V15–V19. project-records and stage-calibration should start at V20.
10. **Derived cache path.** T4d says `pipeline/.cache/derived/project-histories.json`. I recommend `pipeline/.cache/derived/<datasetVersion>/` for all derived files, so a fixture build never clobbers live ones.
11. **Doc vs code.** `docs/dev/pipeline.md` (Fixture) says CI regenerates fixture-0 and fails on diff. `.github/workflows/ci.yml:30` only loads it (`data:fixture`), and the golden comparison is in `pipeline/test/golden.test.ts`.
12. **T4b `fillLevels`** values are owned here (`FILL_LEVELS`). The row says only "length F matches T11 yield". stage-calibration must import the constant, not choose its own.
