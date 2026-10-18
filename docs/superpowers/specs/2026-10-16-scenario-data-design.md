# scenario-data: spec (fzp-timelapse)

Status: derived from [the FZP timelapse design](../design/2026-10-16-1903-fzp-timelapse.md) (approved with partner rulings). Updated to the design's "Interface reconciliation (2026-10-16, after spec derivation)", cited below as **R**. Revised 2026-10-17 to the design's Reappraisal 1 (DQ-1..DQ-4, IA-1..IA-28), cited below as **RA1**. Owns T11, T13, T14 (the data-quality registry), invariant V30 and the `sfh-scenario/1` codec. Consumes T1 (`Day`), T4 (`Provenance`), T4a (feature list) and T4b (F).

Evidence marks: **(V)** means verified, with a file:line or a URL I fetched or queried live on 2026-10-16 or 2026-10-17. **(I)** means inferred. "As built" cites the integration branch `superconductor/fzp-timelapse` (the `fzp-integration` worktree), which carries scenario-data @ 57f7416.

## 1. Scope

> **`scenario-data`** (data pipeline). Ingests the adopted FZP heights from DataSF `h9wh-cg3m` (`base//localProgram-R-4` strings, verified 2026-10-16) and the assessor's secured roll `wv5m-vpq2` (year built, units, stories, land and improvement value; PDDL). It joins both to parcels. For every eligible parcel it writes the FZP envelope, the redevelopment features, and a small yield table (units at each quantised fill level of the envelope, computed with the existing generator). Output is a compact columnar `scenarios/fzp/parcels.bin` under the dataset version. With it the worker can score the whole city without loading every parcel chunk. Height-to-stories rule: `stories = floor(heightFt / 10)`, so 40 ft gives 4 stories, matching Planning's framing (orchestrator call, tier 3). New simulated projects use the **Local Program** height (orchestrator call).

**In:**
- New lock sources `datasf-height-bulk`, `datasf-parcel-attrs` and `datasf-assessor-roll`, with fetch and normalise support (CSV paging for the roll).
- `parseHeightDistrict`, the parcel ↔ district join, base and Local Program stories, and the `localProgram` flag.
- Roll ingest for 2007–latest, lineage of retired parcel numbers onto current parcels, and the T4a feature values.
- Base density caps, the yield step (generator inside the pipeline) and `FILL_LEVELS`.
- The codec module `src/lib/data/scenario-codec.ts` (`sfh-scenario/1`), which also holds the `ScenarioParcels` type, the constants and `scenarioRecordOf`. Their declarations ship first, in Dependency-order step 0.
- Single ownership of every T4a feature computation, imputation and mask, in both T13 and T11 (R round 2: "one definition").
- The manifest `scenarios` field (I12 amendment).
- The T13 parcel panel and the retired-parcel lineage file, for project-records and stage-calibration.
- **The T14 data-quality registry** `pipeline/lib/quality.ts` (RA1): the `QualityRule` type, `QUALITY_RULES`, `MIN_GROSS_M2_PER_UNIT`, the report helper that writes `quality.<id>.*` counts and `quality-report.md`, and invariant **V30**. project-records and stage-calibration register their own rules in it.
- Every scenario-data rule, registered in T14 (§4.12), and the generated "Data quality" section of `docs/dev/pipeline.md`, with a test that it matches the registry.
- Invariants V15–V19 and V30, the fixture-0 mini scenario parcels, and report counts.
- Two edits R assigns to this subsystem:
  - the `chreode.config.ts` rule plus a `test:pipeline` step;
  - correcting the fixture claim in `docs/dev/pipeline.md`.

**Out:**
- `projects.json` (project-records) and `calibration.json` (stage-calibration).
- The `pr.*` and `sc.*` rules. Their owners write them into the registry.
- Fitting anything, choosing the fitting window, and the size-model probabilities.
- Runtime decoding policy in the worker (timelapse-sim calls the codec).
- Corner-lot height bonuses (deferred, R) and historic-register data (assumed eligible, R).

**Delivery order (RA1, Fix-round order).** The fix round's **first commit** is the T14 module and V30 alone: `pipeline/lib/quality.ts` with its types, `MIN_GROSS_M2_PER_UNIT`, the report helper, an empty `QUALITY_RULES`, the V30 check, the doc-section generator and their tests. Its sha is sent to the conductor for relay to project-records, which then registers its rules on top of it. The scenario-data rules, mask bit 5, the base cap date, `existingFloorAreaM2` and `scenarioRecordOf`, the fixture cases and the regenerated goldens follow in later commits.

## 2. Interfaces

Rows copied verbatim from the design.

| # | interface | owner → consumers | mark |
|---|---|---|---|
| T1 | `type Day = number` is integer days since 1970-01-01 UTC. All schedule times use it. It is exact in Float32. `MONTH_DAYS = 30.436875` (365.2425 / 12). `monthsIn(enteredDay, day) = floor((day − enteredDay) / MONTH_DAYS)` is the single months-in-stage rule, used by every table index (T4, T12, the bar, the card). `OPEN_DAY = Math.fround(3.0e38)` encodes an open-ended window end (exact in Float32; consumers compare with the exported constant, never a literal: A1). `DYING_DAYS = 270` is the display window of a death (90 days red, then a 180-day fade; tier 4), read by timelapse-render's uniforms and by timelapse-sim's card visibility. These live in `src/lib/timelapse/time.ts` | stage-calibration → all | DC |
| T4 | `interface Provenance { tier: 0 \| 1 \| 2 \| 3 \| 4; label: string; sources: { label: string; url: string }[]; method: string; n?: number; window?: [from: string, to: string] }`. `interface Transition { months: number; advance: number[] /* cumulative incidence by month 1..months */; exit: Partial<Record<ExitReason, number[]>>; tail: { advance: number; exit: Partial<Record<ExitReason, number>> } /* constant monthly hazards beyond months */; provenance: Provenance; tailProvenance: Provenance /* tier 2: extrapolation beyond the observed months */ }`. `scenarios/fzp/calibration.json` = `{ schema: 1; asOf: Day; transitions: Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Transition>>>; initiation: InitiationModel; pathwayForNew: Record<Pathway, number> & { provenance: Provenance }; size: SizeModel; revision: RevisionModel; streamlinedForLocalProgram: Provenance /* tier 2: Local Program projects use the streamlined tables */; phaseGap: { days: number[] /* empirical gaps between successive phases' permitFiled */; provenance: Provenance } }`. The calibration also carries `ppaShare: Record<Pathway, number> & { provenance: Provenance }`, the share of new projects that start at `preApplication`. `InitiationModel`, `SizeModel` and `RevisionModel` are rows T4a–c. Everything is plain JSON, so future policy levers can transform it (the T9 seam). **Sampling semantics:** a project entering stage *s* at day *d* draws one uniform. The month of advance or exit comes from the cumulative tables (`advance` + Σ`exit` ≤ 1 at every month), with the tail hazards beyond `months`. An in-flight project already *m* months into *s* draws conditionally on having survived *m* months. Day within the month is uniform | stage-calibration → timelapse-sim, fzp-mode | MC (every parameter carries tier + source), DC (encoding) |
| T4a | `type FeatureId = 'potentialRatio' /* yield units at full envelope ÷ max(existingUnits, 1); base variant uses the density-capped base yield (T13), FZP variant the Local Program yield (T11) — this is how density decontrol is seen */ \| 'existingUnits' \| 'lotAreaM2' \| 'yearBuilt' \| 'storiesGap' /* envelope stories − existing stories */ \| 'improvementShare' /* improvement ÷ (land + improvement) assessed value */ \| 'rentControlLikely' /* 0/1: ≥ 2 units and built < 1979 */ \| 'landUseClass' /* categorical: residential, mixed, commercial, pdr, vacant, other */`. `interface InitiationModel { kind: 'logit-monthly'; intercept: number; terms: { feature: FeatureId; bins: number[] /* ascending edges; categorical features use category index */; coef: number[] /* one per bin */ }[]; provenance: Provenance }`. Monthly hazard = `1 / (1 + exp(−(intercept + Σ coef[bin(feature)])))`. It is fitted on pre-FZP (base) envelopes and evaluated on FZP envelopes. Parcels with an in-flight project are not at risk until that project ends | stage-calibration → timelapse-sim, scenario-data (feature list) | DC |
| T4b | `interface SizeModel { fillLevels: number[] /* ascending fractions of envelope stories; last = 1; length F matches T11 yield */; byEnvelope: { maxStoriesUpTo: number; probs: number[] /* length F, sums to 1 */ }[]; provenance: Provenance }`. A new project proposes `stories = max(1, round(fill × envelope.maxStories))` | stage-calibration → timelapse-sim, scenario-data (F) | DC |
| T11 | `scenarios/fzp/parcels.bin` (codec `sfh-scenario/1`, in `src/lib/data/`; deflate inside the file, async decode). It holds **every** parcel: `id`, `labelPoint`, `cellId`, a `hostable` flag (eligible and able to host a new project), `envelope: Envelope` (FZP stories: Local Program height if `localProgram`, else base height; clamped to `MAX_STORIES`), base stories, the base-zoning density cap in units (null = none), `localProgram: boolean`, `existingUnits` (latest assessor roll, post-T14) and `existingFloorAreaM2` (u32, whole m²: the value the yield used), the T4a feature values (base and FZP variants of `potentialRatio` and `storiesGap`) with an imputation mask (`imputed`, a bit set exactly when that field's value is not the source's own value: bit 0 `yearBuilt`, 1 `existingStories`, 2 `improvementShare`, 3 `existingUnits`, 4 no roll row, 5 row carried from the previous roll year, 6 `existingFloorAreaM2` (fallback to the chunk record), 7 reserved; each T14 rule that writes a parcel feature names its bit; rules that write no feature (e.g. zoning caps) have none), `hostable_base` (hostable under the old zoning), `baseYield: Uint16[F]` (gross units at each fill level of the base envelope, density-capped), and `yield: Uint16[F]`, the gross units at each fill level of the envelope, replacement typologies only (no ADU outcomes), with no density cap under the Local Program. `FILL_LEVELS = [0.25, 0.5, 0.75, 0.9, 1]` (F = 5, tier-4 quantisation grid) is owned here, and stage-calibration imports it. Named in the manifest as `scenarios?: { fzp: { parcels: url; projects: url; calibration: url } }` (amends I12 and `ManifestBaseSchema`; optional, so older datasets load). `scenarioRecordOf(p: ScenarioParcels, i: number, rec: ParcelRecord): ParcelRecord` (worker-safe, in the codec module) returns the chunk record with `existingUnits`, `existingFloorAreaM2` and `existingHeightM` (= existing stories × 3.1) replaced from row i. The pipeline's yield and timelapse-sim's simulated massing both use it, so the worker reproduces the building the yield was sized from. Because the yield uses the generator, `src/lib/generator` and `src/lib/timelapse` join the dataset-version hash | scenario-data → timelapse-sim, stage-calibration (`FILL_LEVELS`, `featureValue`, `hostable`), project-records and fzp-mode (manifest `scenarios`) | DC |
| T13 | Pipeline-internal parcel panel `pipeline/.cache/derived/<datasetVersion>/parcel-panel.parquet`. Per parcel × assessor roll year (2007..latest): `mapblklot`, roll year, assessor units, stories, year built, land and improvement value, use code → `landUseClass`, the zoning code (`acdm-wktn`), base stories, the base density cap, and the base-envelope yield (gross units at full base envelope, density-capped), and the T11 `imputed` mask. Every value is post-T14 (rules applied, interior roll-year gaps carried, bit 5). The base cap and everything derived from it are evaluated at `min(lien_day, 2026-01-11)`: base always means the zoning before the FZP. Contract columns (DuckDB table `scenario_panel` in the build): `mapblklot`, `roll_year`, `lien_day`, `existing_units`, `existing_stories`, `year_built`, `land_value`, `improvement_value`, `use_code`, `land_use_class` (INTEGER index into `LAND_USE_CLASSES`), `zoning_code`, `base_stories`, `base_density_cap`, `base_yield`, `lot_area_m2`, `improvement_share`, `rent_control_likely` (BOOLEAN; read as 0/1), `imputed`, `potential_ratio_base`, `stories_gap_base`, `hostable_base`. Never shipped. Retired-parcel lineage is `parcel-lineage.parquet` in the same folder (DuckDB table `parcel_lineage`) | scenario-data → project-records, stage-calibration | DC |
| T14 | Data-quality registry `pipeline/lib/quality.ts` (pipeline-internal). `interface QualityRule { id: string /* '<sd\|pr\|sc>.<area>.<rule>', kebab-case, unique */; owner: 'scenario-data' \| 'project-records' \| 'stage-calibration'; source: string /* lock id, raw table or derived table */; field: string; kind: 'bound' \| 'outlier' \| 'shape' \| 'gap' \| 'missing' \| 'observe'; action: 'null' \| 'replace' \| 'default' \| 'drop' \| 'none'; tier: 2 \| 3 \| 4 /* of the rule's predicate and thresholds */; valueTier: 0 \| 1 \| 2 \| 3 \| 4 \| null /* of a value the rule writes; null unless action is 'replace' or 'default' */; maskBit: number \| null /* T11/T13 imputed bit it sets; scenario-data rules only */; label: string /* plain English, shown to users */; denominator: string; warnShare: number /* default 0.01 */; failShare: number /* default 0.10 */; unitsWeighted: boolean }`. `QUALITY_RULES: readonly QualityRule[]` is the only place a pipeline rule may null, replace, default or drop a source value; observation rules (`action: 'none'`) only count. Each build reports `quality.<id>.fired` and `quality.<id>.of` (plus `.units` and `.unitsOf` when `unitsWeighted`) in `report.json` and writes `pipeline/.cache/derived/<datasetVersion>/quality-report.md` (one row per rule plus the first 25 affected record ids in sort order; never shipped). Invariant V30: every rule reports; on a live build no rule's share exceeds `failShare` (exit 1); a share above `warnShare` warns. `MIN_GROSS_M2_PER_UNIT = 10` (tier 4) is exported here for the capacity rules, with `recordQuality(counts: Record<string, number>, id: string, c: { fired: number; of: number; units?: number; unitsOf?: number; sample?: string[] /* affected record ids; sorted, the first 25 go to quality-report.md */ }): void`, the only writer of `quality.*` report keys and of `quality-report.md` rows (it throws on an unregistered id). Rules are declared in per-owner files `pipeline/lib/quality-rules/{sd,pr,sc}.ts` and collected into `QUALITY_RULES`; rules counted in SQL report through `recordSqlQuality`; every owner records into the build's single `counts` object, and `writeQualityReport` and V30 (`checkQuality`) run once after the last pipeline step. Routine missing-value imputations (`kind: 'missing'`) default to `warnShare` 0.05. T14 rules rewrite **source values**; a model choice that reclassifies or pools records (a pathway rule, a pooling rule, a density-bonus mapping) is not a T14 rule and is stated in its provenance instead | scenario-data → project-records, stage-calibration | DC |
| I1 | `type ParcelId = string` — SF `mapblklot` (block+lot, e.g. `"3512008"`), the single join key across all data | data-pipeline → all | DC |
| I2 | `interface Envelope { maxStories: number }` — the per-parcel allowed envelope. The **only** thing manipulation writes. Later milestones add optional fields; M1 code must ignore unknown fields | plan-model → generator, scoreboard | MC (envelope-as-common-currency), DC (field set) |
| I6 | `interface ParcelRecord { id: ParcelId; polygon: [x: number, y: number][][] /* local metres, exactly EPSG:7131 (NAD83(2011) / San Francisco CS13, metres), origin at label point */; labelPoint: [lng, lat]; areaM2: number; existingUnits: number; existingFloorAreaM2: number; existingHeightM: number; landUse: string; eligible: boolean; neighborhood: string }` | data-pipeline → plan-model, generator, scoreboard | DC |
| I8 | `generate(parcel: ParcelRecord, env: Envelope, seed: number, mode: BuildoutMode): GeneratedBuilding \| null`. Returns `null` for a replacement when its floor area ≤ `existingFloorAreaM2` **or** its units ≤ `existingUnits`: nobody rebuilds smaller or to fewer homes. (An `adu` keeps the existing building and is exempt) | generator → map-view, scoreboard | DC |
| I12 | Data manifest: `/data/<datasetVersion>/manifest.json` → `{ datasetVersion, builtAt, sources: { id, label?, url, retrievedAt, license }[], chunks: { cellId, bbox, url, parcelCount }[], buildingsTiles: url, basemapTiles: url, glyphs: url /* MapLibre `{fontstack}/{range}.pbf` template */, sprite?: url, neighborhoods: url }`. All `url`s are root-relative (`/data/<v>/…`). Every eligible-or-not parcel appears in **exactly one** chunk. `buildingsTiles` has one source-layer `buildings` with properties `parcelId`, `heightM`, `baseM`, at minzoom ≤ 12, with buildings clipped to parcels. Published versions are immutable and retained indefinitely. `datasetVersion` matches `^(\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\|fixture-\d+)$` (build date + 8-hex input hash) everywhere it is validated. R2 key = `data/<datasetVersion>/<path>`, served at `/data/<datasetVersion>/<path>` | data-pipeline → platform, plan-model, brush-tool (worker host), typology-generator, map-view | DC |
| I14 | Seed: `seed = fnv1a32(parcelId)`. Variety is a pure function of parcel and envelope, so the same plan always renders identically for everyone | generator | DC |

### Internal types (do not alter any row above)

All live in one module, `src/lib/data/scenario-codec.ts`.

**Step 0** (R round 2, Dependency order) landed this file with only the declarations below: the constants, `LandUseClass`, `ScenarioParcels`, `ScenarioFormatError`, and the function signatures throwing `'not implemented'`. Reappraisal 1 adds `existingFloorAreaM2`, `scenarioRecordFrom` and `scenarioRecordOf` (T11 row, IA-8). That is a change to a step-0 declaration that the amended T11 row authorises. `Provenance` and `FeatureId` are imported from stage-calibration's step-0 `src/lib/timelapse/types.ts`. `ParcelRecord` is a type import from `src/lib/data/parcel.ts`. `FTF_M` (3.1 m, the generator's floor-to-floor height, tier 3) is imported from `src/lib/generator/constants.ts`, a constants-only module, so the codec stays worker-safe.

```ts
export const SCENARIO_FORMAT = 'sfh-scenario/1';
/** T4b fill levels; F = FILL_LEVELS.length = 5. stage-calibration imports this constant. */
export const FILL_LEVELS = [0.25, 0.5, 0.75, 0.9, 1] as const;
/** The T4b proposal rule, shared so the pipeline and the worker round identically. */
export const fillStories = (fill: number, maxStories: number) =>
  Math.max(1, Math.round(fill * maxStories));
export const LAND_USE_CLASSES = ['residential', 'mixed', 'commercial', 'pdr', 'vacant', 'other'] as const;
export type LandUseClass = (typeof LAND_USE_CLASSES)[number];

/** Decoded T11 (T5's `ScenarioParcels`). Struct of arrays; row i is one parcel; rows sorted by (cellId, id). */
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
  // T11/T13 mask (RA1 mask convention): a bit is set exactly when that field's value is not the
  // source's own value (imputed, replaced by a T14 rule, or carried). bit 0 yearBuilt,
  // 1 existingStories, 2 improvementShare, 3 existingUnits, 4 no roll row (implies bits 0-3 and 6),
  // 5 row carried from the previous roll year (interior gap), 6 existingFloorAreaM2 (chunk-record
  // fallback), 7 reserved (always 0).
  imputed: Uint8Array;
  baseCap: Uint16Array;             // T11 base-zoning density cap in units; 0xFFFF = null (no cap)
  existingUnits: Uint16Array;       // latest roll, post-T14
  existingFloorAreaM2: Uint32Array; // whole m²: the value the yields used (RA1, IA-8)
  existingStories: Uint8Array; lotAreaM2: Uint32Array;
  yearBuilt: Uint16Array; improvementShare: Float32Array; rentControlLikely: Uint8Array;
  landUseClass: Uint8Array;         // index into LAND_USE_CLASSES
  hostableBase: Uint8Array;         // 0/1: T11 hostable_base (eligible, baseStories ≥ 1, baseYield[F−1] > 0)
  baseYield: Uint16Array;           // count × F: gross units at each fill level of the base envelope, density-capped
  yield: Uint16Array;               // count × F, row-major: yield[i * F + k]
  potentialRatio: { fzp: Float32Array; base: Float32Array };   // derived at decode
  storiesGap: { fzp: Int16Array; base: Int16Array };            // derived at decode
}
export function encodeScenarioPayload(p: ScenarioParcels): Uint8Array;          // deterministic
export function decodeScenarioPayload(bytes: Uint8Array): ScenarioParcels;      // sync; throws ScenarioFormatError
export async function readScenarioParcels(body: ReadableStream<Uint8Array> | Uint8Array): Promise<ScenarioParcels>; // inflate + decode
export function featureValue(p: ScenarioParcels, i: number, f: FeatureId, env: 'fzp' | 'base'): number;
export function envelopeOf(p: ScenarioParcels, i: number): Envelope;            // { maxStories: envelopeStories[i] }
/** The scenario view of a chunk record (§4.5): units, floor area and height replaced. Pure. */
export function scenarioRecordFrom(
  rec: ParcelRecord,
  v: { existingUnits: number; existingFloorAreaM2: number; existingStories: number }
): ParcelRecord; // { ...rec, existingUnits, existingFloorAreaM2, existingHeightM: existingStories × FTF_M }
/** T11: scenarioRecordFrom(rec, row i of p). Worker-safe. Throws RangeError if p.id[i] !== rec.id. */
export function scenarioRecordOf(p: ScenarioParcels, i: number, rec: ParcelRecord): ParcelRecord;
```

Pipeline-only files under `pipeline/.cache/derived/<datasetVersion>/` (R: derived-cache path), never shipped:
- `parcel-panel.parquet`, the T13 panel; contract columns in §4.6. In the build it is also the DuckDB table `scenario_panel`. project-records reads `existing_units` and `base_stories` from it (T3/T4d `existingUnits`, T4d `baseStoriesAtFiling`), and stage-calibration fits T4a on it.
- `parcel-lineage.parquet`: `(blklot, retired_mapblklot, current_mapblklot, date_rec_drop)`, the retired-parcel lineage (T13; DuckDB table `parcel_lineage`). project-records uses it to map T3 `parcelIds` to current parcels.
- `quality-report.md` (T14): one row per registered rule, with its counts and the first 25 of its sorted affected record ids, all written by `recordQuality` (§4.12).

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
- **Data quality** (reappraisal 1). Live sources are not assumed clean. Every pipeline rule that nulls, replaces, defaults or drops a source value is a registered T14 rule with a tier, a label and counts in every build. A replaced parcel value sets its `imputed` bit, and a changed record carries the rule's id in `quality`. A value a rule wrote is never presented as a record.
- **Determinism.** The same `datasetVersion` and seed always give the same future, on every machine. The representative seed is chosen deterministically: the run whose final `completedNet` is the median of the N band runs.
- **Honesty of numbers.** The mode is labelled a *simulation*. The scoreboard shows the shown run and the p10–p90 band. Pipeline and new-FZP units are separate lines. Actual completions since the RHNA period start are counted and labelled as actual. Units lost to dead projects are shown.
- **Time scrubbing performance.** At 60 fps on a 2022-era laptop with the whole city's timeline loaded, per-frame JS during scrub or playback is O(1) in project count. A reroll reaches a full new timeline (the shown run, to 2050) within 3 s off the main thread. The p10–p90 band may fill in progressively afterwards; the UI marks it as provisional until it is complete.
- **First paint.** `/fzp` must not require loading every parcel chunk. The whole-city score comes from `parcels.bin`, `projects.json` and `calibration.json`. Geometry streams with the viewport, as on `/`.
- **The editor is unchanged.** `/` and `/p/:id` behave exactly as before. FZP mode is additive. The one intended exception is the shared header, which gains the mode links ("Paint" / "Timelapse") and shortens the brand to "SF Housing" below 640 px so the links fit at 375 px.
- **Map budgets in FZP mode.** Two deck layers per cell are allowed for timeline cells: translucency needs them. This is an exception to map-view's one-layer-per-cell rule, so a `bench:map` timeline scenario must pass the same p95 frame bar. The existing-building catch-up stays within 2,000 feature-state changes per frame.
- **Accessibility.** WCAG 2.2 AA as in `docs/dev/accessibility.md`. The scrubber is a labelled slider: arrow keys step a month, Page Up/Down a year. Reduced motion stops autoplay, but scrubbing still works.

## 4. Behaviour

### 4.1 Sources and lock entries

Each entry is added to `DATASF` (`pipeline/sources/datasf.ts:10`), so `FETCH_IDS` (`pipeline/steps/fetch.ts:17`) picks it up. Each also goes into `SourceId`/`TABLES` (`pipeline/sources/normalise.ts:6`). `DATASF` gains an optional `format: 'geojson' | 'csv'` (default `'geojson'`). The CSV path uses the same SODA paging as `fetchDatasf` (`datasf.ts:58`) against `/resource/<id>.csv`, counting data rows minus the header.

| lock id → table | dataset, `$select`, `$where` | rows 2026-10-16 | licence |
|---|---|---|---|
| `datasf-height-bulk` → `src_height_bulk` | `h9wh-cg3m` geojson; `height,gen_hght,the_geom` | 5,292 polygons, 269 distinct strings (V, `$group=height`) | `public-domain` (V: metadata "Public Domain U.S. Government") |
| `datasf-parcel-attrs` → `src_parcel_attrs` | `acdm-wktn` csv; `mapblklot,blklot,active,zoning_code,date_rec_add,date_rec_drop,centroid_latitude,centroid_longitude`; no `$where` | 227,967 active + 8,606 retired (V); drops dated 1977-03-11..2026-06-03 (V) | PDDL-1.0 (V) |
| `datasf-assessor-roll` → `src_roll` | `wv5m-vpq2` csv; `closed_roll_year,parcel_number,use_code,property_class_code,year_property_built,number_of_stories,number_of_units,property_area,assessed_land_value,assessed_improvement_value,status_code`; `closed_roll_year >= 2007` | 19 years 2007–2025, 197,778–213,531 rows per year, about 3.97 M in all (V, `$group=closed_roll_year`); 3,934,467 rows locked on 2026-10-17 (V, ledger) | PDDL-1.0 (V) |

- Labels are "DataSF Zoning Map – Height and Bulk Districts", "DataSF Parcels (attributes, active and retired)" and "DataSF Assessor Historical Secured Property Tax Rolls".
- Homepages are `https://data.sf.gov/d/<id>`. They flow into manifest `sources` and `/attribution` (`pipeline/steps/manifest.ts:32`).
- The roll is about 80 CSV pages (79 locked, V). Each page is a lock file, archived to R2 like every raw file.
- The existing `datasf-parcels` entry is unchanged.
- Normalise: `read_csv(all_varchar=true)`, then `TRY_CAST`. `parcel_number`, `blklot` and `mapblklot` are upper-cased and trimmed. Normalise no longer rewrites any value: the year-built range check moves out of normalise into the registered rule `sd.roll.year-built-range` (§4.12), so its firings can be counted. As built, normalise nulls out-of-range years itself; that line is removed.

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
   - The first four are **not** Local Program: the program is "R-4 Height and Bulk District" only (V: Director Bulletin 11, §206.10(b)(3)). Their envelope is the base side. They are counted in `scenario.height.dbl_non_r4`.
   - The fifth, `…-R4`, normalises to `-R-4` in step 1 and **is** Local Program. This matches R round 2 ("a typo for `-R-4` and is Local Program").

**Stories** (tier 3, orchestrator): `stories(ft) = min(80, floor(ft / 10))`. 80 is `MAX_STORIES` (`src/lib/generator/constants.ts:27`; R: "Envelopes are clamped to `MAX_STORIES`"). Overshoot of floor heights against the height limit, up to about 5% on towers, is accepted (R).

### 4.3 Parcel ↔ district join

- Both layers are in EPSG:7131, as in `10_parcels.sql:6`. For each parcel, compute the intersection area with every district (`ST_Intersects`, then `ST_Area(ST_Intersection)`). Polygons that carry the same normalised string are one district: their overlaps are summed (as built, `80_scenario.sql:33-40`). The parcel takes the district with the **largest overlap**.
- Ties within 0.01 m² go to the district containing the label point, then to the smaller normalised string.
- Label-point-only assignment is rejected: a label point in a sliver district would mis-assign a lot that is mostly in another.
- `split = 1` when the winning overlap is < 90% of the parcel area. This is a reporting threshold only, and the whole parcel still takes one envelope (DC: the generator has one envelope per parcel). The count goes in `scenario.height.split`, and the units on split parcels in `scenario.height.split_units`.
- A parcel with no overlap gets district `''` and `kind: 'none'`.

### 4.4 Base and Local Program stories and `localProgram`

- `baseStories = stories(baseFt)`.
- For `r4` parcels, `lpFt' = max(baseFt, lpFt)`. Then, if `lotAreaM2 ≥ 743.2` (8,000 sf) and `lpFt' < 65`, `lpFt' = 65`.
  - Source for the large-lot rule (V, tier 1): Bulletin 11 citing §206.10(d)(1)(C). The same rule covers corner lots, which are deferred (R). `localProgram` provenance says corner lots are understated.
- `localProgram = r4 ∧ ¬excluded`, where `excluded` is any of:

| exclusion (V: Bulletin 11) | data and approximation | tier |
|---|---|---|
| demolition on a site with > 2 rent-controlled units, §206.10(b)(9) | latest roll year: Σ `number_of_units` over **non-condo** rows ≥ 3 **and** `yearBuilt < 1979`. The Rent Ordinance covers pre-1979-06-13 buildings (I). Condo classes (`Z, ZBM, ZEU, LZ, LZBM, CZ, OZ, PZ, IZ, GZ, BZ, OZEU`) are excluded: Costa-Hawkins (I). Every simulated project replaces the existing building, so any project on such a site demolishes. The non-condo sum is post-T14: where `sd.roll.units-capacity` replaced a parcel-year's units, its non-condo sum is capped at the replacement (§4.12). | 2 |
| demolition or conversion of a Hotel, §206.10(b)(10); motels may be eligible | any latest-roll row with `property_class_code ∈ {H, H1, H2, HC, HG, RH, RH1, RHG}` (codes V from a `$group` of 2025; RH = residential hotel/SRO counts as a Hotel (I)). `M`/`MG` motels are not excluded (V: Bulletin footnote 4). | 2 |
| Article 10/11 listed properties | mapped outside R-4 (V: Bulletin footnote 1), so the height string already excludes them | 0 |
| demolition of California/National Register buildings, Article 10 district contributors | no ingested dataset: **assumed eligible** (R), labelled tier 4 in provenance | 4 |
| Development-Agreement SUDs, §206.10(b)(8) | DA areas carry non-R-4 strings (Mission Rock, HP, CP, TI) (V: string list), so they are excluded by the map | 0 |

- `envelopeStories = localProgram ? stories(lpFt') : baseStories`. It is 0 when `kind = 'none'`.
- `hostable = (ParcelRecord.eligible) ∧ envelopeStories ≥ 1 ∧ yield[F−1] > 0`.
- Provenance `localProgram`: tier 2, method "R-4 bulk from h9wh-cg3m; exclusions approximated from wv5m-vpq2; register listings not modelled".

**Base density cap.** R: the base envelope is the base height **and** the base zoning's density cap; the Local Program envelope has no cap. The cap comes from `zoning_code` of the parcel's chosen `acdm-wktn` row, picked like `10_parcels.sql:13`. `densityCap(zoning, lotAreaM2, inR4, day)` (`pipeline/lib/density-caps.ts`) gives a cap in units on a day. Per-area ratios use `lotAreaM2 / 0.09290304` square feet, floored, with a minimum of 1. The days asked for (ruling A11, and RA1 "Base cap date"):

| value | day |
|---|---|
| T11 `baseCap` and `baseYield` | 2026-01-11 (`FZP_EFFECTIVE_DAY − 1`): the zoning in force before the FZP |
| T11 `yield` on a non-Local-Program parcel | the build's snapshot day (`capDay`) |
| T11 `yield` on a Local Program parcel | none: no cap |
| panel `base_density_cap`, `base_yield`, `potential_ratio_base`, `hostable_base` | `min(lien_day, 2026-01-11)` |

So "base" always means the zoning in force before the FZP. For roll years up to 2026 the panel is unchanged. A post-FZP roll year (lien day 2027-01-01 or later) keeps the pre-FZP base, and V18's latest-year equality holds when the first post-FZP roll is ingested. As built, `81_scenario_features.sql` picks `cap_fzp` for a lien day ≥ 2026-01-12; that branch is removed, and `sc_parcel` drops its `cap_fzp` column (the T11 `yield` cap is computed in the TS step, as today).

`A` = lot area in square feet. "max(a, b)" reads the Code's "X per lot, or one unit per N sf of lot area" as whichever allows more. There are three periods (ruling A11, coordinator ruling C2): before 2022-11-27 (`DENSITY_CAP_CHANGE_DAY`, Ord. 210-22, the four-unit RH exception); 2022-11-27 to 2026-01-11 (the fourplex period); and from 2026-01-12 (`FZP_EFFECTIVE_DAY`, Ord. 245-25). Under the base cap date above, only the panel's pre-2022-11-27 rows and the fourplex period are ever used as base; the third period is reached only by the T11 FZP `yield` on non-Local-Program parcels.

| zoning | before 2022-11-27 (as of right) | 2022-11-27 to 2026-01-11 | from 2026-01-12 | Code section |
|---|---|---|---|---|
| RH-1(D) | 1 | max(4, min(3, max(1, ⌊A/3000⌋))) | same as fourplex | §209.1, Table 209.1 |
| RH-1 | 1 | max(4, max(1, ⌊A/3000⌋)) | same | §209.1 |
| RH-1(S) | 2 | max(4, min(3, max(2, ⌊A/3000⌋))) | same | §209.1 |
| RH-2 | 2 | max(4, max(2, ⌊A/1500⌋)) | same | §209.1 |
| RH-3 | 3 | max(4, max(3, ⌊A/1000⌋)) | same | §209.1 |
| RM-1 / RM-2 / RM-3 / RM-4 | max(1, ⌊A/800⌋ / ⌊A/600⌋ / ⌊A/400⌋ / ⌊A/200⌋) | same | same | §209.2, Table 209.2 |
| NC-1, NC-2, NC-S | max(1, ⌊A/800⌋) | same | outside R-4: same; inside R-4: null ("Form-Based Density applies within the R-4 Height and Bulk District") | §710, §711, §713 |
| NC-3 | max(1, ⌊A/600⌋) | same | outside R-4: same; inside R-4: null | §712 |
| NCT-1…NCT-3 | null ("Form-Based Density") | null | null | §750–§752 |
| a split code `A\|B` | registered rule `sd.zoning.split-code` (A9): the most permissive component; null if any component is null | | | — |
| generic `NCD` / `NCT` | registered rule `sd.zoning.generic-nc` (A9): null | | | — |
| anything else (named NCDs and NCTs, RTO, UMU, C-3, PDR, P…) | null | null | null | — |

**Verification status** (doc debt: rulings A10/C1 and A11/C2, as built in `density-caps.ts:1-20`).
- **Official sources, tier 1.** Current values were read from the enacted text of Ordinance No. 245-25 (`https://www.sfbos.org/sites/default/files/o0245-25.pdf`, the FZP Planning Code ordinance), which reprints the amended rows of Tables 209.1, 209.2 and 710–713 and 750–752 with strike/underline markup. Every table row in the code carries its section and a page-anchored URL, and every row is `verified: 'official'`.
- **Pre-2022-11-27 RH values** are the as-of-right per-lot counts in the official Planning code summary 2021-010762PCA ("The Way It Was"). The per-area alternatives then needed a conditional use authorisation, so they are not a by-right cap (ruling A10/C1). This replaces the spec's earlier unverified formulas.
- **The R-4 NC rule** arrived with Ord. 245-25, not on 2022-11-27 (ruling A11/C2). `FZP_EFFECTIVE_DAY` = 2026-01-12 is tier 2 (I): the ordinance was signed 2025-12-12 and takes effect 30 days later; the date is the coordinator's ruling, not an official effective-date notice.
- **Not reachable:** the consolidated Code on `codelibrary.amlegal.com` returned HTTP 403, so amendments after Ord. 245-25 were not checked there. The gocodebook mirror (text as of 2026-09-23, Ord. 37-26) agrees with every current value.
- **Not verified, and not modelled:** the NC phrase "or the density permitted in the nearest R District, whichever is greater" (its R-district term is not modelled, so NC caps may be understated, I); named NCDs (§714–§746) and named NCTs (§751–§764), which `acdm-wktn` codes do not name in the generic case. `UNVERIFIED_DISTRICTS` is the generic `NCD` and `NCT` codes; they default to no cap, and every build warns with their parcel counts.
- Corner-lot six-unit allowances are not modelled (deferred, as with corner heights).

### 4.5 Roll ingest, lineage, data-quality rules and features

**Join.** Roll `parcel_number` = `acdm-wktn` `blklot` (V: 2025 rows `3512005` etc. match the blklot form). Mapping to a current parcel:
- (a) a `blklot` whose `mapblklot` is a current parcel id goes to that parcel. Condo sub-lots map to their `mapblklot`, exactly as chunks do.
- (b) a retired `mapblklot` goes to the current parcel whose polygon contains the retired row's centroid. Ties go to the smallest id.
- (c) anything else is unmatched and dropped: rule `sd.roll.unmatched`. It is also counted per year in `scenario.roll.unmatched.<year>` and `…_units`.

So the history of lots merged for a project lands on the merged lot. Without this, the parcel-years that preceded a redevelopment would vanish from the panel.

**Rule order.** Every step that nulls, replaces, defaults or drops a roll value is a registered T14 rule (§4.12), applied in this order. "Observed" parcel-years are those with at least one mapped roll row.

1. **Row level, in `80_scenario.sql`, on `src_roll`:**
   1. `sd.roll.year-built-range`: `year_property_built` outside [1850, `closed_roll_year`] is set to NULL and later imputed (bit 0).
   2. `sd.roll.stories-max`: `number_of_stories` > `MAX_STORIES` (80) is set to NULL (as built, `80_scenario.sql:132-142`). The parcel-year then records that a row's stories were nulled.
   3. `sd.roll.unmatched` (join rule (c) above).
2. **Aggregation per (current parcel, roll year)** over all mapped rows, in `80_scenario.sql` (`sc_roll_agg`, observed parcel-years only):
   - `units` = Σ `number_of_units`; `noncondo_units` = Σ over non-condo rows.
   - `stories` = max `number_of_stories`.
   - `yearBuilt` = the min valid year over rows with units > 0, else over all rows.
   - `land` and `impr` = Σ assessed values.
   - `floorAreaM2` = Σ `property_area` × 0.09290304.
   - `landUseClass` from the row with the largest `property_area`: `SRES`/`MRES` → residential, `MISC` → mixed, `COMM`/`COMR`/`COMO`/`COMH` → commercial, `IND` → pdr, `GOVT` → other. A `property_class_code` starting `V` overrides to vacant (codes V from the 2025 `$group`; the mapping is mine (I)).
   - `hotel`, `status_n` as built.
3. **Existing stories, then the units rules, then the gap carry**, at the head of `81_scenario_features.sql`. They need `sc_parcel.lot_area_m2`, which the TS step writes after `80_scenario.sql`, so the as-built units-spike tables (`s_units_seq`, `s_units_run`, `s_units_fix`, `80_scenario.sql:200-226`) move from `80_scenario.sql` to here.
   1. `existing_stories` = `stories` when > 0. Else `max(1, round(heightM / 3.1))` when the chunk's existing height is > 0: rule `sd.features.stories-height` (bit 1). Else 0, which reads as "no building" and sets no bit.
   2. `sd.roll.units-capacity` (§4.12), on observed parcel-years.
   3. `sd.roll.units-spike` (the A12 bracketed-run rule, as built), on the series that step 2 produced.
   4. `sd.roll.year-gap` (§4.12): interior missing roll years are carried from the previous observed year.
   5. The observation rules `sd.roll.units-latest-jump` and `sd.roll.units-large`, on the final series. They change nothing.
4. **Features**, in `81_scenario_features.sql`, on every panel parcel-year (observed and carried):
   - `lotAreaM2` = `round(rec.areaM2)` (tier 0 geometry; the roll's `lot_area` repeats on condo rows).
   - `yearBuilt`: a missing year (NULL in the source, or nulled by `sd.roll.year-built-range`) becomes the median of the same `landUseClass` in that roll year. A source NULL is rule `sd.features.year-built-median`. Either way bit 0 is set. Vacant lots get 0 and no imputation.
   - `improvementShare` = `impr / (land + impr)`, rounded to 1/200. When `land + impr = 0` (for example status N rows, `3512008`, V), it is the class median: rule `sd.features.share-median` (bit 2). Vacant is 0.
   - When the class has no observed value that roll year, the median falls back to the year-wide non-vacant median, then to 0: rule `sd.features.median-fallback` (tier 4; the field's own bit is already set).
   - `existingFloorAreaM2` = `round(floorAreaM2)` when `floorAreaM2 > 0`, else `round(rec.existingFloorAreaM2)` (the chunk record's value): rule `sd.roll.floor-area-missing`, which sets bit 6. It is stored as an INTEGER of whole m² (RA1, IA-8), and every yield uses this rounded value.
   - `rentControlLikely` = T4a verbatim: `existingUnits ≥ 2 ∧ yearBuilt < 1979`, on the post-rule units and the imputed year.
   - Medians are taken per (`land_use_class`, `roll_year`) over **observed** rows only. Carried rows (bit 5) are imputed with their own year's medians but never contribute to them.
5. **T11 only, in the TS step.** A parcel with no latest-year roll row gets the no-row defaults: `existingUnits` 0, `existingStories` from the chunk height as in step 3.1 (else 0), `landUseClass` `other`, `yearBuilt` and `improvementShare` the latest year's `other` medians, `rentControlLikely` 0, `existingFloorAreaM2` = `round(rec.existingFloorAreaM2)`. This is rule `sd.roll.no-row`. It sets bit 4 and, by the mask convention ("every feature imputed"), bits 0–3; the floor area always comes from the chunk record, so `sd.roll.floor-area-missing` also fires and sets bit 6: `imputed` = 0b1011111 = 95. As built, the no-row mask is 0b10101 plus bit 1 only when a height exists; RA1's convention (with bit 6, ledger SD ruling 2026-10-17) changes it to 95.

**Mask bits** (RA1 mask convention, T11/T13). A bit is set exactly when that field's value is not the source's own value for that parcel-year:
- bit 0 `yearBuilt`: out of range or missing, then imputed.
- bit 1 `existingStories`: taken from the height fallback, or the parcel-year had a row nulled by `sd.roll.stories-max`. The second case is new: as built, bit 1 is set only for the fallback, which misses a nulled row whose sibling rows still carry stories.
- bit 2 `improvementShare`: imputed.
- bit 3 `existingUnits`: replaced by `sd.roll.units-capacity` or `sd.roll.units-spike`. A carried row copies bit 3 from the row it was carried from.
- bit 4: no roll row (T11 only; implies bits 0–3 and 6).
- bit 5: the row was carried from the previous roll year (`sd.roll.year-gap`).
- bit 6 `existingFloorAreaM2`: taken from the chunk record because the roll has no floor area (`sd.roll.floor-area-missing`). Set on every no-row parcel (bit 4).
- bit 7: reserved, always 0. The decoder rejects a set bit 7 (§4.8).

**One scenario view of a parcel, used for both the panel and parcels.bin.** `scenarioRecordFrom(rec, v)` (codec, §2) is the chunk `ParcelRecord` with these fields replaced:
- `existingUnits` = the post-rule roll units (R: "`existingUnits` in FZP mode comes from the latest assessor roll"). There is no general LUDB fallback. The one exception is `sd.roll.units-capacity`'s second step, which applies only where the roll's own value is physically impossible in every year (RA1). Government parcels with roll units 0 and LUDB units > 0 (for example public housing) are counted in `scenario.roll.gov_zero_units` and `…_ludb_units`, so the gap is visible.
- `existingFloorAreaM2` = the rounded value of step 4.
- `existingHeightM` = `existingStories × 3.1` (`FTF_M`).

For a T11 row the pipeline first fills `existingUnits`, `existingFloorAreaM2` and `existingStories` of row i, then takes `scenarioRecordOf(p, i, rec)`, the same function timelapse-sim calls (IA-8). The pipeline's private `scenarioRecord` (`pipeline/steps/scenario.ts:93`, as built) is deleted. Panel rows of earlier roll years call `scenarioRecordFrom` with that year's values.

Tiers: features 0 (roll), imputations 2, the rules' own tiers as registered (§4.12). Prop 13 caveat in provenance: assessed values reflect the acquisition basis, not market value. The `features` and `existingUnits` provenance methods name the units rules, the gap carry and the no-row defaults, with their tiers.

The features reflect the roll year as of its lien date, 1 January of `closed_roll_year` (I: CA lien date). The current features use the **latest** roll year in the lock (2025 on 2026-10-17), and the header records it.

**Why the roll and not LUDB for units.** LUDB (`fdfd-xptc`) is a single 2023 snapshot. The initiation hazard must be fitted and applied on the same definition, so both use the roll. project-records uses the same roll, via the panel, for T3 `existingUnits` (R). The roll's 2025 Σ units was 388,773 on the 2026-10-17 build, after the spike rule and before the capacity rule (V: task-12 report, `scenario.units.total`), against LUDB's ~411,500 (data-pipeline spec §4.9). V18 bounds the gap. The editor keeps LUDB, and the card says "existing homes (assessor)" (R).

### 4.6 T13 panel (`parcel-panel.parquet`, table `scenario_panel`)

One row per (current parcel, roll year) for **every** roll year in the lock (2007..latest) in which the parcel has a mapped roll row, plus the carried rows of interior gaps (`sd.roll.year-gap`, bit 5). The fitting windows are stage-calibration's (§4.4); initiation uses every roll year from 2007. Every value is post-T14.

The **contract columns** are exactly the T13 row's list, in this order, sorted by (`mapblklot`, `roll_year`). Types are DuckDB's:

| column | type | value |
|---|---|---|
| `mapblklot` | VARCHAR | current parcel id |
| `roll_year` | INTEGER | `closed_roll_year` |
| `lien_day` | INTEGER | T1 Day of 1 January `roll_year` |
| `existing_units` | INTEGER | post-rule assessor units (§4.5, §4.12) |
| `existing_stories` | INTEGER | §4.5 step 3.1 |
| `year_built` | INTEGER | imputed; vacant 0 |
| `land_value`, `improvement_value` | DOUBLE | Σ assessed values |
| `use_code` | VARCHAR | of the largest-area row |
| `land_use_class` | INTEGER | index into `LAND_USE_CLASSES` |
| `zoning_code` | VARCHAR | the chosen `acdm-wktn` row's code (NULL if none) |
| `base_stories` | INTEGER | §4.4 |
| `base_density_cap` | INTEGER NULL | the cap at `min(lien_day, 2026-01-11)`; NULL = none |
| `base_yield` | INTEGER | gross units at full base envelope, density-capped (§4.7) |
| `lot_area_m2` | INTEGER | `round(rec.areaM2)` |
| `improvement_share` | FLOAT | rounded to 1/200, as T11 ships it |
| `rent_control_likely` | BOOLEAN | T4a; consumers read it as 0/1 |
| `imputed` | UTINYINT | the T11 mask (§4.5) |
| `potential_ratio_base` | FLOAT | `base_yield / max(existing_units, 1)`, rounded as T11's Float32 |
| `stories_gap_base` | INTEGER | `base_stories − existing_stories` |
| `hostable_base` | BOOLEAN | eligible ∧ `base_stories ≥ 1` ∧ `base_yield > 0` |

**What stage-calibration reads.** R round 2 makes one definition of the features: scenario-data computes every feature value, its imputation and the mask, and stage-calibration does no second imputation. The column names above are the contract. Values are final, already imputed and quantised exactly as T11 ships them.

| T4a `FeatureId` | panel column (base variant, for the fit) | T11 value (FZP variant, for evaluation) |
|---|---|---|
| `potentialRatio` | `potential_ratio_base` | `featureValue(p, i, 'potentialRatio', 'fzp')` |
| `existingUnits` | `existing_units` | `existingUnits[i]` |
| `lotAreaM2` | `lot_area_m2` | `lotAreaM2[i]` |
| `yearBuilt` | `year_built` (imputed; vacant 0) | `yearBuilt[i]` |
| `storiesGap` | `stories_gap_base` | `featureValue(…, 'storiesGap', 'fzp')` |
| `improvementShare` | `improvement_share` | `improvementShare[i]` |
| `rentControlLikely` | `rent_control_likely` (BOOLEAN, read as 0/1) | `rentControlLikely[i]` |
| `landUseClass` | `land_use_class` as the index into `LAND_USE_CLASSES` (INTEGER) | `landUseClass[i]` |

- **At-risk set and timing.** `hostable_base` defines the at-risk set for the pre-FZP fit (R round 2). `mapblklot`, `roll_year` and `lien_day` key the parcel-years. `imputed` is the same bitmask as T11, now with bits 3, 5 and 6 (stage-calibration reports per-bit exposure shares for bits 0–6, RA1).
- **Imputation basis.** Medians are taken per (`land_use_class`, `roll_year`) over the panel's own observed rows. The latest year's medians are exactly those used for T11, so both files agree by construction. The V18 check asserts this: the panel's latest-year rows equal T11's feature values parcel by parcel.
- **Carried rows** fill interior gaps only. A parcel's years before its first or after its last observed year are not carried: such a parcel has no row there, and if the latest year is missing, T11 uses the no-row defaults (lot 13 in the fixture).

The base height is the **left side of the current string**, used as the height in force for every year. **Tier 3** (R: "No pre-FZP height map exists"), and provenance says so. The only Wayback copy before FZP, 2023-08-16, is truncated at SODA's default 1,000 rows (V). A Planning export would be an enrichment, not a blocker (R).

### 4.7 Yield table

Computed in the pipeline with the shared function `scenarioYield(rec, stories, cap)` in `src/lib/data/scenario-yield.ts`. It is pure and imports `generate` from `src/lib/generator`, so the worker can recompute under a future lever (T9).

- `b = generate(rec, { maxStories: stories }, fnv1a32(rec.id), 'max')`, with I14's seed.
- `null` gives 0.
- An ADU outcome (`replacesExisting = false`) gives 0: the yield table has replacement typologies only (T11; R "The yield table excludes ADU outcomes"). Otherwise `b.units`. Yield is **gross units on the parcel after the project**, so net = yield − `existingUnits`.
- If `cap` is set and the gross exceeds it, it becomes `cap`. Then 0 if `cap ≤ rec.existingUnits` (I8's "fewer homes" rule applied after the cap).

Per parcel, with `rec' = scenarioRecordOf(p, i, rec)` (§4.5; its `existingFloorAreaM2` is the shipped whole-m² value):
- `yield[k] = scenarioYield(rec', fillStories(FILL_LEVELS[k], envelopeStories), localProgram ? null : cap(capDay))`.
- `baseYield[k] = scenarioYield(rec', fillStories(FILL_LEVELS[k], baseStories), cap(2026-01-11))` (T11, round 3, ruling A11). This serves the T9 `baseZoning` twin run. `baseYield[F−1]` is the full-base-envelope yield behind `potentialRatio.base`.
- `hostable_base = eligible ∧ baseStories ≥ 1 ∧ baseYield[F−1] > 0`. It uses the same rule as the panel's `hostable_base`, evaluated on the latest roll year.
- Distinct story counts are generated once per parcel.
- Panel `base_yield` uses `scenarioRecordFrom(rec, that year's values)` and `cap(min(lien_day, 2026-01-11))`. It is memoised on (parcel, existingUnits, existingFloorAreaM2, existingStories, base stories, cap), with the integer floor area.
- Because the panel and T11 use the same rounded floor area, the panel's latest-year `potential_ratio_base` equals T11's `potentialRatio.base` exactly (V18).
- Values > 65,535 are clamped and counted (`scenario.yield.clamped`), and V17 fails on any. Yields may be non-monotone in k, because typology steps change with stories (`select.ts:7`). They are stored raw, and the observation rule `sd.yield.nonmonotone` counts them.
- `FILL_LEVELS = [0.25, 0.5, 0.75, 0.9, 1]` is a **tier-4 quantisation grid**, not a measured number. The measured part is stage-calibration's `probs` over it. For a 4-story envelope it gives 1, 2, 3, 4, 4 stories; for 8, it gives 2, 4, 6, 7, 8; for 24, it gives 6, 12, 18, 22, 24. The resolution near full fill reflects that most new SF projects build close to the limit (I).
- Run time on the 2026-10-17 live build: `scenario` 69.6 s in all, of which `scenario.base_yield` 13.2 s (309,091 memoised inputs) and `scenario.t11` 16.8 s (V: task-12 report). It is reported as `timings.scenario.*`.

**Reproducibility in the worker (IA-8).** The worker has the chunk record (LUDB values) and row i of `parcels.bin`. `scenarioRecordOf(p, i, rec)` rebuilds exactly the record the yield was sized from, because `existingUnits`, `existingFloorAreaM2` and `existingStories` are shipped as the values the pipeline used. timelapse-sim masses simulated projects on it (T11 row; TS spec).

`src/lib/generator`, `src/lib/timelapse`, `src/lib/plan/types.ts` and `src/lib/plan/geometry.ts` are in `PATHS` in `pipeline/lib/version.ts:33` (T11; as built). The yields depend on the generator, so a generator change must give a new `datasetVersion`. `pipeline/lib/quality.ts` is under `pipeline/`, which is already hashed, so a rule change gives a new `datasetVersion` too (I: `version.ts` hashes `pipeline/`).

R assigns two edits here:
- **chreode.** `chreode.config.ts` gains a step `{ label: 'test:pipeline', run: 'npm run test:pipeline', when: ['pipeline'] }` and a rule `{ match: ['src/lib/generator/**', 'src/lib/timelapse/**', 'src/lib/data/**'], triggers: ['lint', 'check', 'unit', 'e2e', 'pipeline'] }`, placed before the `src/**` rule (`chreode.config.ts:10`). The rule's `pipeline` trigger fires on changes to those paths. Paths no rule matches already run every step, and `test:pipeline` then joins them. As built the match list also carries `src/lib/plan/types.ts`, `src/lib/plan/geometry.ts` and `e2e/fixtures/data` (`docs/dev/pipeline.md`, Fixture). `docs/dev/pipeline.md` joins the `pipeline` trigger, because the Data-quality section test (§6) runs under `test:pipeline`.
- **Docs.** `docs/dev/pipeline.md` (Fixture) is corrected: CI loads fixture-0 (`.github/workflows/ci.yml:30`) but does not regenerate it. Drift is caught by `pipeline/test/golden.test.ts` under `test:pipeline`. The doc also gains the generator/timelapse hash note. (Done as built.)

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
    existingUnits u16[N]   existingFloorAreaM2 u32[N]   existingStories u8[N]
    lotAreaM2 u32[N]  yearBuilt u16[N]
    improvementShare u8[N] (round(share × 200); /200 on decode)  landUseClass u8[N]
    baseCap u16[N] (0xFFFF = null)  baseYield u16[N×F]  yield u16[N×F]
```

- `existingFloorAreaM2` (RA1, IA-8) is new. It follows `existingUnits` in the column list (`COLUMNS` in `scenario-codec.ts`). The encoder range-checks it to 0..2³²−1 like every integer column.
- `flags`: bit 0 localProgram, bit 1 rentControlLikely, bit 2 hostable, bit 3 split, bit 4 hostableBase; bits 5–7 are 0.
- `imputed`: §4.5. Bits 0–6 are defined; the decoder throws on a set bit 7.
- Ids are front-coded against the previous row in file order (`idPrefix` = shared prefix length, ≤ 255).
- Rows are sorted by `cellId` (the chunk's cell, `pipeline/lib/rings.ts` `cellIdFor`), then by id. That is the same comparator as chunks (`parcel-chunk.ts:32`).
- **Every parcel in the chunks has a row**, with `count` = V2's `parcels.emitted`. Non-hostable rows carry zeros in their yields, so the worker can map any T3 `parcelIds` to a cell and a label point.
- `decodeScenarioPayload` derives:
  - `potentialRatio.fzp = yield[F−1] / max(existingUnits, 1)` and `.base = baseYield[F−1] / max(existingUnits, 1)`;
  - `storiesGap.fzp = envelopeStories − existingStories` and `.base = baseStories − existingStories`.
  - `featureValue` returns these, or the stored column, or the class index for `landUseClass`.
- Errors throw `ScenarioFormatError` with a message:
  - bad magic or major;
  - header not JSON, or a missing key;
  - a column missing, out of bounds, of the wrong type or of the wrong length (the column list must equal `COLUMNS` exactly);
  - an index out of a dictionary's range;
  - a set reserved bit in `flags` or `imputed`;
  - `fillLevels` not ascending or not ending at 1.

**Format version.** The format stays `sfh-scenario/1`, major 1. The codec is unreleased: no published dataset version carries `scenarios/fzp/*` (builds omit the manifest `scenarios` field until project-records and stage-calibration land, §4.9), so no reader of the old column list exists. A file written before this change fails to decode with "column missing" rather than misreading. Fixture-0 and its goldens are regenerated in the same commit.

**Size budget** (engineering, not a simulation parameter). It serves the design's first-paint rule, "`/fzp` must not require loading every parcel chunk", and does not rest on a 5 MB transfer claim. Measured on the 2026-10-17 live build: 155,020 parcels, payload 8,118,136 B (52.4 B/parcel) and file 1,876,413 B (V: task-12 report, `scenario.bytes.*`). `existingFloorAreaM2` adds 4 B/parcel raw, about 0.62 MB, so the payload is about 8.74 MB. Floor areas vary more than the other columns, so the compressed file grows by about 0.3–0.5 MB to about 2.2–2.4 MB (I). V19 keeps its thresholds: fail above 3.5 MB compressed, warn above 3.0 MB. That keeps the whole-city file well below the ≈ 5 MB compressed all-chunk load it replaces (data-pipeline spec §4.8).

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

Step `pipeline/steps/scenario.ts`, called from `build` (`pipeline/steps/build.ts:146`) after `writeChunks`, before project-records, calibration and the manifest. SQL lives in `pipeline/sql/80_scenario.sql` (district join, zoning, lineage, row-level rules, roll aggregation) and `81_scenario_features.sql` (existing stories, the units rules, the gap carry, features, imputation). The TS step does the base yields, the T11 rows, the zoning and yield rules, and the encoding.

The build creates the quality tables before the first SQL file (§4.12) and writes `quality-report.md` once, after the last step that reports (stage-calibration's), so the report covers every owner's rules.

Report counts (`scenario.*`):
- `parcels`, `hostable`, `local_program`, `excluded.rent_control`, `excluded.hotel`, `large_lot_65`
- `height.parse_fail`, `height.none`, `height.no_district`, `height.split`, `height.split_units`, `height.dbl_non_r4`, `height.overlap_gt1`
- `roll.years`, `roll.latest`, `roll.matched_parcels`, `roll.latest_eligible_matched`, `roll.unmatched.<y>`, `roll.unmatched_units.<y>`, `roll.lineage_retired`, `roll.gov_zero_units`, `roll.gov_zero_units_ludb_units`
- `density_cap.<zoning>` (parcels per capped district), `density_cap.none`, `density_cap.fzp_differs`, `density_cap.rule.unlisted`
- `imputed.<field>` on T11 rows: `year_built`, `existing_stories`, `improvement_share`, `existing_units` (bit 3, new), `no_roll`, `carried` (bit 5, new), `floor_area` (bit 6, new)
- `units.total`, `yield.fzp_net_total` (Σ max(0, yield[F−1] − existingUnits) over hostable LP parcels), `yield.clamped`, `yield.nonlp_base_mismatch`
- `panel.years`, `panel.base_yield_memo`, `panel.feature_mismatch`
- `bytes.payload`, `bytes.file` (fixture reports omit `bytes.file`)

Superseded by T14 counts (removed): `roll.stories_implausible` → `quality.sd.roll.stories-max.*`; `roll.units_implausible` → `quality.sd.roll.units-spike.*`; `density_cap.rule.split[_hostable]` → `quality.sd.zoning.split-code.*`; `density_cap.rule.generic_nc[_hostable]` → `quality.sd.zoning.generic-nc.*`; `yield.nonmonotone` → `quality.sd.yield.nonmonotone.*`; `yield.zero_hostable_eligible` → `quality.sd.yield.zero-hostable.*`. The ad hoc "split or generic-NC parcels exceed 10% of hostable" warning (`scenario.ts:55-58`, `:728-737`) is removed; V30's shares replace it (RA1: "the 10% fail share generalises ruling A9"). The unverified-districts warning stays.

| # | invariant (fail → exit 1) | live expectation |
|---|---|---|
| V15 | `parcels.bin` inflates and decodes. `format`, `datasetVersion` and `scenario` match. `count` = `parcels.emitted`. Ids are unique, each is in exactly one chunk, and its `cell` equals that chunk's `cellId`. Re-encoding the decoded payload is byte-identical. | ✓ (155,020 parcels, 2026-10-17, V) |
| V16 | `height.parse_fail = 0`. ≥ `heightJoinMin` (live 0.99, fixture 1) of `eligible` parcels have a district. | 152,762 / 153,509 (V) |
| V17 | `fillLevels` deep-equal `FILL_LEVELS`. `yield.clamped = 0`. `hostable ⇔ (eligible ∧ envelopeStories ≥ 1 ∧ yield[F−1] > 0)`. `hostableBase ⇔ (eligible ∧ baseStories ≥ 1 ∧ baseYield[F−1] > 0)`. `scenario.yield.nonlp_base_mismatch = 0`: on non-Local-Program parcels whose pre-FZP cap equals their FZP cap, `baseYield = yield` (ruling A11/C2: an NC parcel inside R-4 has a pre-FZP cap and no FZP cap, so its two yields may differ). ≥ 50% of eligible parcels are hostable. **Warn** (not fail) if `yield.fzp_net_total` lies outside [0.25×, 4×] of Planning's ~780,000 net added capacity (tier 1 cross-check, literature §1 [A]). | hostable 140,528 / 153,509; nonlp_base_mismatch 0; fzp_net_total 839,841 (V) |
| V18 | The panel covers every roll year in the lock. In the latest year ≥ `rollJoinMin` (live 0.97, fixture 0.8) of eligible parcels have a roll row. `scenario.units.total` lies in `scenarioUnitsRange`: live [0.90, 1.02] × 413,208, fixture exact. 413,208 is the pipeline's V1 source, SF housing stock at end-2022 from the 2023 Housing Inventory, Table 1 (`pipeline/steps/build.ts:43` `HOUSING_STOCK.end2022`, `pipeline/config.ts:71` `unitsTarget`; data-pipeline spec §4.9 V1). The panel's latest-year features equal T11's for every parcel, `existingFloorAreaM2` and the mask included (`scenario.panel.feature_mismatch = 0`). | 388,773 ≈ 0.941 × (V, before the capacity rule); latest-year match 152,772 / 153,509 (V) |
| V19 | `bytes.file` ≤ `scenarioMaxBytes` (3.5e6). Warn > 3.0e6. | 1,876,413 B before `existingFloorAreaM2` (V); ≈ 2.2–2.4 MB after (I) |
| V30 | Every rule in `QUALITY_RULES` reports `quality.<id>.fired` and `quality.<id>.of` (plus `.units` and `.unitsOf` when `unitsWeighted`) in `report.json`. No `quality.*` key names an unregistered rule. On a profile with `qualityShares` (live), no rule's `fired / of`, nor `units / unitsOf` for a unit-weighted rule, exceeds its `failShare`; one above `warnShare` warns. A rule with `of = 0` has share 0. | warnings expected on some rules (I); no failure expected (I) |

`InvariantProfile` (`pipeline/config.ts:44`) has `heightJoinMin`, `rollJoinMin`, `scenarioUnitsRange` and `scenarioMaxBytes` (as built) and gains `qualityShares: boolean` (live `true`, fixture `false`: the mini fixture fires rules on a handful of rows by design, so its shares mean nothing). `checkDataset` evaluates V30 from `report.json` with `checkQuality` (§4.12). `docs/dev/pipeline.md` (Invariants, Fixture, Where things land, Data quality) and the CLAUDE.md pipeline row are updated.

### 4.11 Fixture-0 mini scenario

`make-fixture.ts` adds three raw files, keeping the SODA conventions of `pipeline/test/fixtures/mini/README.md`:
- `datasf-height-bulk.page-000.geojson`;
- `datasf-parcel-attrs.page-000.csv`, one row per parcel row incl. retired, condo and null-id;
- `datasf-assessor-roll.page-000.csv`, roll years 2023, 2024 and 2025. R asks for at least two roll years in the panel. Roll year 2023 has rows for lots 3 and 4 only (RA1 fixture cases, below).

Districts (local x ranges, y [−100, 100]):

| x range | string | covers |
|---|---|---|
| [−60, 44) | `40//65-R-4` | lots 1–4, 40% of lot 5 |
| [44, 97) | `65-X` | 60% of lot 5, lots 6–9, 70% of lot 10 |
| [97, 110) | `85//120-R-4` | 30% of lot 10, lot 11 |
| [110, 120) | `Special Height District` | lot 12 |
| [120, 130) | `120/400-R-2  //  140/520-R-2` | lot 13 |
| [130, 140) | `120/400//120/650-R4` | lot 14 |

Zoning: lots 1, 2, 8 `RH-2`; 10, 11 `RH-3`; 4 `NC-1` (ruling A11/C2: an NC lot inside R-4 that is not Local Program); 5 `RH-1`; 6 `RM-1`; 3 `NCT`; 13 `C-3-O`; 14 `C-3-G`; others `P`.

Roll highlights:
- lot 1: `F`, 2 units, 1912;
- lot 2: three `Z` condo rows, 1 unit each, built 1975 (ruling A8: with 1985 the condo rule of the rent-control exclusion is never exercised);
- lot 3 (`8711023C`): `H1` hotel, 3 stories, rows in 2023 and 2025 only, 5,000 units in both (RA1: every year is physically impossible; its chunk record's LUDB units are 4);
- lot 4 (`0026T001A`): `A`, 3 units, 1925, 3 stories, plus a 2023 row with 3 units; its 2024 row has 900 units (RA1: one impossible year between two plausible ones);
- lot 6: `RM-1`, 2 units, so the per-area cap is exercised;
- lot 11: status `N`, 0 units (LUDB has 3);
- lot 13: no 2025 row;
- retired `3512099` (centroid in lot 12, dropped 2024-06-30): 7 units in 2024 only.

Lots 3 and 4 carry the RA1 cases. project-records' M1–M14 sit on lots 1, 2 and 5–14, but its reappraisal cases M15 (lot 3) and M16 (lot 4) use these two lots, and project-records reads the panel at a parcel's exact roll year (`pipeline/project-records/inflight.ts:207`, as built). So the RA1 rules here reach its fixture: M15's T3 `existingUnits` is lot 3's post-rule 2025 value 4, and M16's at-filing history (roll year 2024) reads lot 4's replaced 2024 value 3. project-records' goldens follow this spec (ledger, SD rulings 2026-10-17: "PR goldens follow SD"). scenario-data rules are not client-visible, so those records carry no `sd.*` id in `quality`.

Known answers (golden test assertions). Rows marked (A8) are the operator's executed corrections (ruling A8, defect record 1 "Doc debt"). Rows marked (RA1) are new: the case and the expected effect are stated, and the golden values are computed at implementation.

| lot | result |
|---|---|
| 1 | LP, base 4, envelope 6, rentControlLikely 1 (2 units < 3, so not excluded) |
| 2 | existingUnits 3, LP (condos do not count toward the rent-control exclusion), rentControlLikely 1 (built 1975) (A8) |
| 3 | `excluded.hotel`, envelope = base 4, `baseCap` null |
| 3 (RA1) | `sd.roll.units-capacity` fires on both observed rows: no year passes and the LUDB value 4 does, so both become 4 (bit 3). The 2024 row is carried from 2023 (`sd.roll.year-gap`, bits 3 and 5). T11 `existingUnits` 4, bit 3 set |
| 4 | `excluded.rent_control`, envelope 4. NC-1: `baseCap` 4 (pre-FZP, ⌊3,226 sf / 800⌋) while its FZP cap is null, so `report.counts['scenario.density_cap.fzp_differs'] = 1` and every `baseYield[k] ≤ 4` (A8, ruling A11/C2) |
| 4 (RA1) | `sd.roll.units-capacity` fires on 2024 only: the nearest passing years 2023 and 2025 tie, the earlier wins, so 2024 becomes 2023's 3 (bit 3). `sd.roll.units-spike` does not fire on lot 4, because the capacity rule runs first. T11 is unchanged (2025 = 3) |
| 5 | district `65-X` (largest overlap, 60%), split 1 (A8), not LP, `baseCap` 4 (RH-1 in the fourplex period), `baseYield` = `yield` |
| 6 | `baseCap` 3: the lot has a 40 m² courtyard hole, so 259.93 m² = 2,797 sf and ⌊2,797 / 800⌋ = 3 (A8; was 4) |
| 10 | `65-X`, split 1 |
| 11 | existingUnits 0 (roll only), counted in `roll.gov_zero_units`; envelope 12 |
| 12 | `none`, not hostable; its 2024 panel row has 7 units via lineage |
| 3, 13, 14 | `baseCap` null |
| 13 | not LP (`dbl_non_r4`), base 40 stories, `sd.roll.no-row`: imputed = 95 (bits 0–4 and 6; RA1, was bit 4 plus 0/2) |
| 14 | `R4` normalised, LP, envelope 65 |
| 7, 9 | not hostable (ineligible) |
| all | `count` 14; `scenario.height.dbl_non_r4` 1; `excluded.hotel` 1; `excluded.rent_control` 1; panel roll years 2023–2025 (RA1); `scenario.units.total` 70: 66 as built plus lot 3's 4 (RA1; confirm at implementation) |

Other RA1 rules get a report-count assertion on the mini build (each `quality.sd.*.fired` and `.of` present, `.fired` as the golden records it) and a synthetic case in `scenario-quality.test.ts` (§6), because the mini fixture cannot carry them without disturbing project-records' lots. The synthetic cases follow the as-built precedent of `scenario-sql.test.ts`, which inserts a synthetic parcel into a copy of the mini tables.

The three new fixture lock entries in `pipeline/test/fixtures/mini/sources.lock.json` use `retrievedAt: "2026-10-10T00:00:00.000Z"` and `upstreamVersion: "fixture"`, like the existing entries. Every fixture `retrievedAt` stays ≤ 2026-10-10 (R round 2), so the transit target date (README: Tuesday 2026-10-13) does not move. `make-fixture.ts` writes them. `FIXTURE_PROFILE` (`config.ts:107`) carries these thresholds: `rollJoinMin` 0.8 (A8: lots 12 and 13, both eligible, deliberately have no 2025 row, so 10 of 12 eligible parcels match), `scenarioUnitsRange` [70, 70] (RA1; confirm at implementation) and `qualityShares` false. `fixture-0` gains `scenarios/fzp/parcels.bin`. The golden directory gains `scenarios/fzp/parcels.decoded.json` (a canonical JSON dump of the decoded payload, now with `existingFloorAreaM2`). `parcels.bin` itself is excluded from the byte comparison in `pipeline/test/golden.test.ts:19`. `quality-report.md` is in the derived cache, not in fixture-0, so it is not golden-compared; its rows are asserted in `quality.test.ts`.

### 4.12 Data-quality registry (T14) and the scenario-data rules

**Module.** `pipeline/lib/quality.ts` exports the T14 row's `QualityRule`, `QUALITY_RULES` and `MIN_GROSS_M2_PER_UNIT = 10` (tier 4: SF's smallest legal rooms are about 6.5 m² before any circulation; design RA1). Each owner declares its rules in its own file, `pipeline/lib/quality-rules/{sd,pr,sc}.ts`, as a `readonly QualityRule[]`. `quality.ts` concatenates them and exports `QUALITY_RULES` sorted by id, so the export stays the one place every rule is declared and the three owners do not edit one array. At module load it throws if an id repeats, does not match `^(sd|pr|sc)\.[a-z0-9]+(-[a-z0-9]+)*\.[a-z0-9]+(-[a-z0-9]+)*$`, or has a prefix that disagrees with its `owner`; if `valueTier` is non-null for an action other than `replace` or `default`, or null for one of them; if `maskBit` is set on a non-scenario-data rule or lies outside 0–6; or if `warnShare ≥ failShare`. In the fix round's first commit, all three files hold `[]`.

**Default shares, by kind** (T14 row). A rule of `kind: 'missing'` (a routine missing-value imputation: the field had no value and the rule fills it) defaults to `warnShare` 0.05; every other kind defaults to `warnShare` 0.01. `failShare` defaults to 0.10 for every kind. A rule that departs from its kind's default states the reason in a comment at its entry in its owner's rule file. A drop of an unusable row is not `missing` even when the row lacks a field: the field is not imputed, the row is removed, so such a rule takes another kind (here `shape`) and the 0.01 default.

**Report helper** (pipeline-internal; project-records and stage-calibration call it). `recordQuality` is the T14 row's function, and the only writer of `quality.*` report keys and of `quality-report.md` rows:

```ts
/** T14. Writes quality.<id>.fired and .of (and .units, .unitsOf) into `counts`, and records the
 *  rule's report row (its counts and the first 25 of `sample`) against this `counts` object. */
export function recordQuality(
  counts: Record<string, number>,
  id: string,
  c: { fired: number; of: number; units?: number; unitsOf?: number; sample?: string[] }
): void;
/** The registered rule; throws on an unknown id. */
export function qualityRule(id: string): QualityRule;
/** Creates the DuckDB tables quality_tally(rule_id, fired, of, units, units_of) and
 *  quality_sample(rule_id, record_id). A SQL rule inserts one tally row and its sample rows. */
export function createQualityTables(db: Duck): Promise<void>;
/** Calls recordQuality once for every tally row of one owner, with its sample sorted. */
export function recordSqlQuality(db: Duck, owner: QualityRule['owner'], counts: Record<string, number>): Promise<void>;
/** Writes quality-report.md from the rows recordQuality recorded against `counts`, one per
 *  registered rule in id order; it writes no row of its own (a rule with none is listed as
 *  "not reported", and V30 fails on it). Deterministic. */
export function writeQualityReport(file: string, datasetVersion: string, counts: Record<string, number>): void;
/** V30 over report.json counts. */
export function checkQuality(counts: Record<string, number>, opts: { shares: boolean }): { ok: boolean; failures: string[]; warnings: string[] };
/** The "Data quality" section of docs/dev/pipeline.md, generated from QUALITY_RULES. */
export function qualityDocSection(): string;
```

- `recordQuality` throws when the id is unregistered; when `fired`, `of`, `units` or `unitsOf` is not a non-negative integer, or `fired > of` (or `units > unitsOf`); when `units` and `unitsOf` are missing on a unit-weighted rule or present on another; when `sample` is longer than `fired`; and when the same id is recorded twice against one `counts` object.
- `sample` holds affected record ids, for example `0872002:2015` for a parcel-year or `0872002` for a parcel. `recordQuality` sorts a copy in code-unit order and drops duplicates. The first 25 go to `quality-report.md`. A caller passes every affected id, or at least the first 25 in sorted order.
- The report rows are kept in a `WeakMap` keyed by the `counts` object, so two builds in one process (the fixture tests) never mix rows.
- Counts are integers. A share is `fired / of`, and `units / unitsOf` for a unit-weighted rule; a zero denominator gives share 0.
- No other code writes a key starting `quality.`; `quality.test.ts` checks the report path, and a grep test over `pipeline/` finds no other writer.
- Each owner's step calls `recordQuality` (directly, or via `recordSqlQuality`) for every one of its rules, including those with `fired = 0`.
- **What is a rule.** T14 rules rewrite **source values**. A model choice that reclassifies or pools records is not a T14 rule; it is stated in its provenance (T14 row). In scenario-data that covers the use-code → `landUseClass` mapping, the height-to-stories rule, the largest-overlap district choice, the Local Program exclusion approximations and the density-cap table itself. They stay in the provenance texts of §4.4–§4.5.
- **The Data quality section.** `docs/dev/pipeline.md` gets a section between the markers `<!-- quality:begin -->` and `<!-- quality:end -->`: one table row per rule with id, label, tier (rule / value), kind, action, mask bit and the warn/fail shares, plus one line on the report keys and V30. `npm run pipeline -- quality-doc` rewrites it. A test (§6) fails when the committed section differs from `qualityDocSection()`. It replaces the hand-written "Tier-4 data rules" subsection (as built, `docs/dev/pipeline.md:92-99`).

**The scenario-data rules.** The design's table (RA1 "scenario-data rules"), as registered. Every rule has `owner: 'scenario-data'`, the default `warnShare` 0.01 and `failShare` 0.10. Live counts are from the 2026-10-17 build (task-12 report) or the orchestrator's live queries (design RA1). Each new or moved rule's live count is measured at implementation.

| id | source · field | kind · action | tier (rule / value) | bit | denominator (`of`) | units-weighted | live |
|---|---|---|---|---|---|---|---|
| `sd.roll.year-built-range` | `datasf-assessor-roll` · `year_property_built` | bound · replace | 4 / 2 | 0 | roll rows with a year | no | to measure (normalise nulled them uncounted) |
| `sd.roll.stories-max` | `datasf-assessor-roll` · `number_of_stories` | bound · replace | 4 / 2 | 1 | roll rows with stories | no | 688 rows, max 999 |
| `sd.roll.units-capacity` | `sc_roll_agg` · `number_of_units` (aggregated) | outlier · replace | 4 / 2 | 3 | observed parcel-years | yes | ≈ 116 parcel-years on 10 parcels, counting units ≥ 20 (design RA1 query) |
| `sd.roll.units-spike` | `sc_roll_agg` · `number_of_units` | outlier · replace | 4 / 2 | 3 | observed parcel-years | yes | 52 |
| `sd.roll.units-latest-jump` | `scenario_panel` · `existing_units` | outlier · none | 4 / — | — | parcels with rows in the latest and the previous roll year | no | to measure |
| `sd.roll.units-large` | `scenario_panel` · `existing_units` | outlier · none | 4 / — | — | panel parcel-years | no | 408 rows > 500 before the capacity rule |
| `sd.roll.year-gap` | `sc_roll_agg` · every roll column | gap · default | 2 / 2 | 5 | panel parcel-years (observed and carried) | no | 7,229 parcel-years; 7,145 of them in 2011 |
| `sd.zoning.split-code` | `datasf-parcel-attrs` · `zoning_code` | shape · replace | 4 / 4 | — | hostable parcels | no | 545 hostable (746 in all) |
| `sd.zoning.generic-nc` | `datasf-parcel-attrs` · `zoning_code` | shape · default | 4 / 4 | — | hostable parcels | no | 5,945 hostable (6,648 in all) |
| `sd.yield.nonmonotone` | `parcels.bin` · `yield` | shape · none | 4 / — | — | parcels | no | 645 |
| `sd.yield.zero-hostable` | `parcels.bin` · `yield` | shape · none | 4 / — | — | eligible parcels with `envelopeStories ≥ 1` | no | 11,585 |

The zoning rules' denominator is hostable parcels, because ruling A9's escalation ("> 10% of hostable parcels") is what the default `failShare` generalises (RA1). The two yield observation rules have tier 4 because `QualityRule.tier` admits only 2–4; the design's table gives "—" (ruled: observation rules take tier 4, ledger SD rulings 2026-10-17). No rule in this table is of kind `missing`, so all take the 0.01 default.

**Rules registered by this spec** (as-built steps that default or drop a source value, which the global constraint "Data quality" requires to be registered; the design's table does not list them; ratified as T14 rules by the orchestrator, ledger SD rulings 2026-10-17, "kind missing → warnShare 0.05"). The six `missing` rules take the kind default 0.05; `sd.roll.unmatched` drops an unusable row, so it is `shape` at the 0.01 default:

| id | source · field | kind · action | tier (rule / value) | bit | denominator | units-weighted | shares (warn / fail) | as built |
|---|---|---|---|---|---|---|---|---|
| `sd.roll.unmatched` | `datasf-assessor-roll` · `parcel_number` | shape · drop | 2 / — | — | roll rows | yes | 0.01 / 0.10 | §4.5 (c); 246–1,333 rows per year (V) |
| `sd.features.year-built-median` | `sc_roll_agg` · `year_built` | missing · default | 2 / 2 | 0 | non-vacant parcel-years | no | 0.05 / 0.10 | `imputed.year_built` 2,998 T11 rows (V) |
| `sd.features.stories-height` | `sc_roll_agg` · `stories` | missing · default | 2 / 3 | 1 | parcel-years | no | 0.05 / 0.10 | `imputed.existing_stories` 6,569 T11 rows (V) |
| `sd.features.share-median` | `sc_roll_agg` · `land`, `impr` | missing · default | 2 / 2 | 2 | non-vacant parcel-years | no | 0.05 / 0.10 | `imputed.improvement_share` 2,526 T11 rows (V) |
| `sd.features.median-fallback` | `sc_medians` · `year_built`, `improvement_share` | missing · default | 4 / 4 | — | values imputed by the two median rules | no | 0.05 / 0.10 | operator ruling, Task 7 (`81_scenario_features.sql:17-19`) |
| `sd.roll.floor-area-missing` | `sc_roll_agg` · `property_area` | missing · default | 2 / 3 | 6 | parcel-years | no | 0.05 / 0.10 | `81_scenario_features.sql:92-93` |
| `sd.roll.no-row` | `datasf-assessor-roll` · every roll column | missing · default | 4 / 4 | 4 | T11 parcels | no | 0.05 / 0.10 | `imputed.no_roll` 855 (V) |

**`sd.roll.units-capacity`, exactly.** For each observed parcel-year (p, y), with `lotAreaM2(p) = round(rec.areaM2)` and `s(p, y)` = `existing_stories` of §4.5 step 3.1:
- `capacity(p, y) = lotAreaM2(p) × max(s(p, y), 1) / MIN_GROSS_M2_PER_UNIT`, a real number.
- (p, y) **fails** when `units(p, y) > capacity(p, y)`, on the aggregated units after the row-level rules. Every other observed year of p **passes**.
- A failing (p, y) takes the first of:
  1. `units(p, y*)`, where y* is the passing observed year of p nearest to y. On a tie the earlier year wins. Candidates are observed years only; carried rows do not exist yet.
  2. Else the chunk record's `existingUnits` (LUDB), if it is ≤ `capacity(p, y)`.
  3. Else `floor(capacity(p, y))`.
- The parcel-year's `noncondo_units` becomes `min(noncondo_units, replacement)`, so the rent-control exclusion (§4.4) cannot read the impossible value.
- `units_replaced` is set (bit 3). `fired` counts replaced parcel-years. `units` is the Σ of their original units, and `unitsOf` the Σ of the original units over all observed parcel-years. Its `sample` is the sorted `<mapblklot>:<year>` ids of the replaced parcel-years.
- The rule reads no other parcel and no other rule's output, except the row-level rules' and the stories fallback's. It runs before `sd.roll.units-spike`, so the spike rule sees the post-capacity series. The live query found these parcels: 0872002 (4,000 on a 2-story office), 6594021 (2,135, then 2), 0306026 (2,389, then 97), 0715015 (3,146 on 7 stories) (design RA1).
- **0715015 / 0715016** (3,146 units every year; fidelity F3-11, composer ruling in the design and ledger 2026-10-17). They are replaced by this rule like any other failing parcel, with no exception: 3,146 homes on a 1,937 m² lot of 7 stories is 4.3 m² per home, and the same count repeats on the neighbouring lot, which suggests one lumped record. Both appear in the rule's `sample`. No year passes, so the chain takes the LUDB value if it passes, else `floor(capacity)`. If a later source shows a real complex, its lot area is the thing to correct, not this rule.
- The LUDB step is a narrow exception to R's "no LUDB fallback" (Units semantics). It applies only where the roll's own value is physically impossible in every year (RA1).

**`sd.roll.units-spike`** is the as-built A12 rule, unchanged except for its input: over each parcel's post-capacity units series by roll year, a maximal run of equal values v with a bracketing observed year on both sides (prev and next), `v ≥ 100` and `v > 10 × max(1, prev, next)`, takes prev in every year of the run (bit 3). It leaves `noncondo_units` as is: a bracketed run is never the latest year, which is the only year the exclusions read. `fired` counts replaced parcel-years, and `units` the Σ of their original units.

**`sd.roll.year-gap`.** For each parcel p with observed roll years Y, every roll year y in the lock with `min(Y) < y < max(Y)` and y ∉ Y gets a carried row. It is a copy of the post-rule `sc_roll_agg` row of the latest observed year before y: units, stories, `existing_stories`, raw year built, land and improvement values, floor area, use code, land-use class, `noncondo_units`, hotel, status and `units_replaced`. Its `roll_year` and `lien_day` are y's own. Features are then computed as for any row (§4.5 step 4), with y's medians, and bit 5 is set. A gap of several years copies the same observed row into each. `fired` counts carried parcel-years, and `of` all panel parcel-years.

**Observation rules.** `sd.roll.units-latest-jump` fires on a parcel whose latest-year `existing_units` is ≥ 100 and more than 10× its previous-year value (the previous year's row, observed or carried). A new building explains most such jumps, and scenario-data can't see permits (RA1). `sd.roll.units-large` fires on a panel parcel-year with `existing_units > 500` and neither bit 3 nor bit 5 set. `sd.yield.nonmonotone` fires on a parcel with `yield[k] < yield[k−1]` for some k. `sd.yield.zero-hostable` fires on an eligible parcel with `envelopeStories ≥ 1` and `yield[F−1] = 0`. All four pass their affected ids as `sample` (parcel-years as `<mapblklot>:<year>`, parcels as `<mapblklot>`) and change nothing.

## 5. Seams

- **Policy levers (T9).** `ScenarioParcels` is plain typed arrays, copyable by a `PolicyOp`. `baseStories`, `baseCap`, `localProgram`, `district`, `hostableBase` and `baseYield[F]` are shipped. The first PolicyOp, T9 `baseZoning` (the old-zoning twin, round 3), therefore needs no runtime generation: it swaps `envelopeStories` → `baseStories`, `yield` → `baseYield` and `hostable` → `hostableBase`, and evaluates `potentialRatio`/`storiesGap` with the base variants. A lever that changes an envelope recomputes yields with the shared `scenarioYield` on `scenarioRecordOf(p, i, rec)` and I14's seed, for parcels whose chunk is loaded. Nothing more is built now.
- **Data quality.** A new rule is a `QualityRule` entry plus its `recordQuality` call; the registry, the counts, the report, V30 and the doc section follow from the entry. DQ-4 sets when an operator may add one without a ruling (design, partner ruling DQ-4): "An operator may add a T14 rule without a ruling when all of these hold: it changes one field of one source; its action is `null`, `replace`, `default`, `drop` or `none`; it fires below `warnShare` on rows and, if unit-weighted, on units; and it changes no interface row and no model commitment. The operator lists it in the completion report as a "registered rule"." Anything else escalates, and a live build fails (V30) above any rule's `failShare`.
- **Addenda sub-stages.** None here.
- **DA phasing.** DA areas resolve to `kind: 'none'` with their district string kept in `districts`, so a later DA-phasing source can find its parcels. No other change.
- **Renderings.** None.
- **Size-model granularity.** `FILL_LEVELS` lives in shared code and is written into the header. Changing F is a codec-compatible change, because `yield` is N×F with F taken from the header.

## 6. Testing

Vitest server project (`src/lib/data`, pure TS):
- `scenario-codec.test.ts`, fixture `src/lib/data/fixtures/scenario-tiny.ts` (6 rows over 2 cells, incl. ids `0026T001A`, `8711023C`, `3512001`, `3512002`):
  - encode → decode round trip, deep equality, including derived `potentialRatio`/`storiesGap` values and `existingFloorAreaM2` (0, a typical value, and 2³²−1);
  - encode twice gives identical bytes;
  - front-coding across a cell boundary;
  - each `ScenarioFormatError` case in §4.8 (bad magic, truncated column, missing `existingFloorAreaM2` column, dictionary index out of range, reserved `imputed` bit 7 set, bad `fillLevels`); a row with bit 6 set decodes;
  - the encoder rejects a negative or non-integer `existingFloorAreaM2`;
  - `featureValue` for every `FeatureId` × env.
- `scenario-codec.test.ts` (continued): `fillStories` table (4 → 1, 2, 3, 4, 4; 8 → 2, 4, 6, 7, 8; 1 → 1 ×5); `FILL_LEVELS` ascending with last 1.
- `scenario-record.test.ts`: `scenarioRecordOf(p, i, rec)` replaces exactly `existingUnits`, `existingFloorAreaM2` and `existingHeightM` (= `existingStories[i] × FTF_M`) and keeps every other field of `rec` by identity; it throws `RangeError` when `p.id[i] !== rec.id`; it does not mutate `rec`. `scenarioRecordFrom` agrees with it on row i.
- `scenario-yield.test.ts` (stub generator via `vi.mock`): an ADU outcome gives 0; cap clips; `cap ≤ existing` gives 0; `null` gives 0; the seed passed is `fnv1a32(id)`.
- `scenario-yield.property.spec.ts` (fast-check, real generator on generator fixtures): never negative, ≤ 65,535, deterministic.
- `manifest.test.ts` additions: `scenarios` optional; full object parses; partial `fzp` rejected; wrong-version prefix rejected; golden manifest re-validated.

Vitest client project:
- `scenario-codec.svelte.spec.ts`: `readScenarioParcels` inflates a deflate-raw buffer in Chromium via `DecompressionStream`.

`npm run test:pipeline`:
- `quality.test.ts` (T14):
  - the registry checks of §4.12 each throw on a crafted bad rule (duplicate id, bad pattern, owner/prefix mismatch, `valueTier` with `action: 'none'`, `maskBit` 7, `maskBit` on a `pr` rule, `warnShare ≥ failShare`), `maskBit` 6 is accepted, and the real `QUALITY_RULES` passes;
  - kind defaults: every `sd.*` rule of `kind: 'missing'` has `warnShare` 0.05 and every other `sd.*` rule 0.01, all with `failShare` 0.10 (the two tables of §4.12);
  - `recordQuality` writes the four keys for a unit-weighted rule and two otherwise; it throws on an unregistered id, a missing or extra `units`, a negative or non-integer count, `fired > of`, a sample longer than `fired`, and a second call for one id on the same `counts`; it sorts and dedups `sample`; two `counts` objects keep separate report rows;
  - no file under `pipeline/` other than `pipeline/lib/quality.ts` writes a key starting `'quality.'` (a grep test);
  - `checkQuality`: a missing count fails; an unregistered `quality.*` key fails; a share above `failShare` fails with `shares: true` and passes with `shares: false`; a share above `warnShare` warns; `of = 0` gives share 0; a unit-weighted rule fails on its units share alone;
  - `writeQualityReport` is byte-identical across two calls, lists the first 25 of a 30-id sample in sorted order, has one row per registered rule in id order, and lists a rule that `recordQuality` never saw as "not reported";
  - `recordSqlQuality` turns `quality_tally` and `quality_sample` rows into the same counts and report rows as direct calls;
  - the committed section of `docs/dev/pipeline.md` between the markers equals `qualityDocSection()`.
- `scenario-quality.test.ts` (synthetic parcels inserted into a copy of the mini tables, as `scenario-sql.test.ts` does as built). Each case asserts the written value, the mask bit and the rule's `fired`/`of` and `sample` as passed to `recordQuality`:
  - `sd.roll.year-built-range`: years 1700 and roll year + 1 are replaced by the class median (bit 0); 1850 and the roll year itself are kept;
  - `sd.roll.stories-max`: a 999-story row is nulled, the height fallback applies, bit 1 is set; a sibling row with 4 stories gives existing stories 4 and still bit 1;
  - `sd.roll.units-capacity`, each step of the chain: a nearest passing year (and the earlier-first tie); the LUDB value when no year passes; `floor(capacity)` when the LUDB value fails too; `noncondo_units` capped at the replacement; a parcel exactly at capacity (units = capacity) does not fire;
  - capacity before spike: a 5, 5,000, 5 series on a small lot is replaced by the capacity rule, and the spike rule's `fired` does not count it;
  - `sd.roll.units-spike`: 50, 1,500, 50 on a lot whose capacity exceeds 1,500 is replaced by the spike rule only;
  - `sd.roll.year-gap`: a parcel observed in 2007, 2009 and 2012 gets carried rows in 2008 (from 2007) and 2010–2011 (from 2009), each with bit 5 and its own `lien_day`; a parcel whose rows stop in 2020 gets no 2021+ rows; carried rows are left out of the medians;
  - `sd.roll.floor-area-missing`: a parcel-year with `property_area` 0 takes the rounded chunk floor area and sets bit 6, and one with a roll floor area leaves bit 6 clear; a no-row parcel gets `imputed` 95;
  - `sd.roll.units-latest-jump` and `sd.roll.units-large` count and change nothing;
  - the base cap date: a synthetic 2027 roll row on an NC-1 lot inside R-4 gets `base_density_cap` equal to its 2026-01-11 cap (not null), and the latest-year V18 equality holds.
- `heights.test.ts`: table over a committed snapshot of all 269 live strings (`pipeline/test/fixtures/height-strings-2026-10-16.json`, with expected `baseFt`/`lpFt`/`r4`/kind and `gen_hght`), asserting max = `gen_hght` for each non-sentinel; fast-check never throws.
- `scenario-sql.test.ts` on mini:
  - largest-overlap and split (lots 5 and 10, both split 1; `scenario.height.split` = 2);
  - lineage (lot 12, 2024), and `parcel-lineage.parquet` rows;
  - condo aggregation (lot 2);
  - roll-only units and the `gov_zero_units` count (lot 11);
  - exclusions (lots 3, 4);
  - the RA1 cases of lots 3 and 4 (§4.11);
  - the panel has exactly roll years 2023–2025, with every T13 contract column present, in order, with its §4.6 type.
- `density-caps.test.ts`:
  - each formula in the §4.4 table in each period: RH-2 on 1,000 sf → 2 before 2022-11-27 and 4 after; RH-1(D) → 1 before; RH-3 on 8,000 sf → 8; RM-1 on 3,229 sf → 4; NC-3 on 6,000 sf outside R-4 → 10 in every period, and inside R-4 → 10 up to 2026-01-11 and null from 2026-01-12;
  - split and generic-NC codes; unlisted districts give null;
  - every entry carries a section and a URL.
- `scenario-features.test.ts` on mini: for every parcel, the panel's 2025 row equals T11's feature values, `existingFloorAreaM2` and mask included (the single-definition rule).
- `scenario-rebuild.test.ts` on mini (IA-8): for every parcel, recomputing `yield` and `baseYield` from the decoded `parcels.bin` with `scenarioYield(scenarioRecordOf(p, i, rec), …)`, the chunk record and the caps of §4.4 equals the stored arrays. `pipeline/steps/scenario.ts` defines no function of its own that builds the scenario record.
- `local-program.test.ts`: large-lot 65-ft bump on a synthetic 800 m² R-4 record at `40//40-R-4`; `lpFt < baseFt` takes the max.
- `fetch.test.ts` addition: CSV paging with a mock `Http` (header row not counted; short page stops; the trailing empty page is not locked).
- `normalise.test.ts` addition: the three new tables' column types; an out-of-range year survives normalise unchanged (the rule moved to §4.5).
- `invariants.test.ts` additions: V15–V19 and V30 each fail on a crafted out-dir (wrong count, parse failure, clamped yield, missing roll year, oversize file, a missing `quality.*` count, a live share above `failShare`) and pass on mini.
- `version.test.ts` addition: `codeTreeHash` changes when a file under `src/lib/generator` or `src/lib/timelapse` changes.
- `golden.test.ts`: decoded payload equals `parcels.decoded.json` (which includes `baseYield[F]`, `hostableBase` and `existingFloorAreaM2`) and is identical across two builds; known answers of §4.11. Lot 1 (Local Program, base 4 / envelope 6) has `baseYield` ≠ `yield` and `baseYield[k]` capped at 4 (RH-2). Lot 5 (not Local Program) has `baseYield` = `yield`. `report.json` carries `quality.<id>.fired` and `.of` for every `sd.*` rule, with the golden's values.

Playwright e2e (`e2e/scenario-data.spec.ts`), after `npm run data:fixture`:
- `GET /data/fixture-0/scenarios/fzp/parcels.bin` returns 200 `application/octet-stream` with the immutable cache header.
- In page context, `readScenarioParcels(res.body)` gives `count === 14` and lot `3512014` envelope 65.

No page is added, so there is no axe gate here. fzp-mode owns it.

## 7. Acceptance criteria

1. `npm run pipeline -- fetch` writes lock entries `datasf-height-bulk`, `datasf-parcel-attrs` and `datasf-assessor-roll`, with licences `public-domain`, `PDDL-1.0` and `PDDL-1.0`. They appear in manifest `sources` and on `/attribution`.
2. A live `build` passes every invariant, V15–V19 and V30 included, and `out/<v>/scenarios/fzp/parcels.bin` is ≤ 3.5 MB.
3. `report.json` carries every `scenario.*` count of §4.10, including `roll.latest = 2025` on a 2026-10 fetch, and `quality.<id>.fired` and `.of` (plus `.units` and `.unitsOf` where unit-weighted) for every registered rule.
4. Every one of the 269 live height strings parses. The max-height rule equals `gen_hght` for all non-sentinels.
5. `decodeScenarioPayload` round-trips, and its header `fillLevels` equals `FILL_LEVELS`. stage-calibration's `size.fillLevels` imports the same constant.
6. After `build`, `pipeline/.cache/derived/<v>/parcel-panel.parquet` (the T13 contract columns of §4.6, 2007–2025, with carried rows) and `parcel-lineage.parquet` exist.
7. The fixture known answers in §4.11 hold, and `npm run pipeline -- fixture` is stable across two runs (decoded payload).
8. A manifest without `scenarios` still parses. `parseManifest` of fixture-0 passes with or without the field.
9. Changing any file in `src/lib/generator` or `src/lib/timelapse` changes `datasetVersion`, and `npm run signoff -- --dry-run` on such a change lists `test:pipeline`.
10. Every RH, RM and NC entry of the density-cap table cites its Planning Code section and URL and is verified against official text (Ord. 245-25 and 2021-010762PCA; done as built, rulings A10/A11). Districts that cannot be verified stay null and are listed in `density-caps.ts`.
11. Every numeric parameter in this subsystem's code has a comment giving its tier and source as in this spec, `MIN_GROSS_M2_PER_UNIT` included.
12. `docs/dev/pipeline.md` no longer claims CI regenerates fixture-0.
13. **T14 first.** The fix round's first commit contains `pipeline/lib/quality.ts` (types, `MIN_GROSS_M2_PER_UNIT`, helper, empty per-owner rule files), V30 and their tests, and nothing else of the fix round. Its sha is reported to the conductor for project-records.
14. Every rule in the two tables of §4.12 is registered with the listed fields, reports its counts on every build, and appears in `quality-report.md` with the first 25 of its sorted sample, written by `recordQuality`. No code other than `recordQuality` writes a `quality.*` key. No code under `pipeline/` nulls, replaces, defaults or drops a source value outside a registered rule.
15. `docs/dev/pipeline.md` has a generated "Data quality" section, and the test that it equals `qualityDocSection()` passes.
16. The mask follows the RA1 convention: bit 3 reaches T11 when the latest year is replaced, bit 5 marks carried rows, bit 6 marks a chunk-record floor area, a no-row parcel has `imputed = 95`, and the decoder accepts bit 6 and rejects bit 7.
17. `parcels.bin` carries `existingFloorAreaM2`, the codec exports `scenarioRecordOf`, the pipeline's private `scenarioRecord` is gone, and the rebuild test (§6) passes on mini.
18. The panel's base values use the cap at `min(lien_day, 2026-01-11)`; the synthetic 2027-row test passes.

## 8. Open questions

None remain from R:
- corner-lot 65 ft: deferred;
- register-listed buildings: assumed eligible (tier 4);
- pre-FZP heights: the base side, tier 3, with an export as later enrichment;
- NC density caps: included;
- the four non-R-4 `//` strings: non-Local-Program; the `-R4` typo is Local Program.

Reappraisal 1's open points are listed under "Interface concerns (reappraisal 1)".

## Interface concerns

All resolved by the design's "Interface reconciliation" (R) and the amended rows:

1. Every parcel shipped, with `hostable`: resolved by **T11** ("holds **every** parcel … a `hostable` flag").
2. `ScenarioParcels` undefined: resolved by **T5** (`ScenarioParcels /* decoded T11 */`). The decoded shape is in this spec's internal types.
3. Missing values: resolved by **T11** ("with an imputation mask"), and since RA1 by the mask convention.
4. `existingUnits` source: resolved by R, Units semantics (latest assessor roll in both files; the editor keeps LUDB). The government fallback I had proposed is removed. RA1 adds the narrow LUDB step of `sd.roll.units-capacity`.
5. Yield semantics and density cap: resolved by **T4a/T11/T13** and R, Density decontrol (gross, replacement only, capped on the base path, uncapped under the Local Program, NC included).
6. Extra `acdm-wktn` source: resolved by R ("Zoning codes come from `acdm-wktn`") and **T13**.
7. Version hash and chreode: resolved by **T11** and R, Pipeline housekeeping. This spec owns the chreode edit (§4.7).
8. Compression inside `.bin`: resolved by **T11** ("deflate inside the file, async decode").
9. Invariant numbering: resolved by R (V15–V19 here), and RA1 (V30 here).
10. Derived cache path: resolved by R and **T4d/T13** (`<datasetVersion>/`).
11. Doc vs code on fixture regeneration: resolved by R. This spec corrects the doc (§4.7, AC 12).
12. `FILL_LEVELS` ownership: resolved by **T11** ("owned here, and stage-calibration imports it").

## Interface concerns (reappraisal 1)

Raised to the orchestrator during the spec revision. All but item 3 are ruled (ledger, "SD + PR specs revised", 2026-10-17) and the rows are amended; the rulings are applied in this spec.

1. **Rules the design's table does not list.** **Resolved** (orchestrator: "as-built defaults/imputations ratified as T14 rules (kind missing → warnShare 0.05)"; T14 row: "Routine missing-value imputations (`kind: 'missing'`) default to `warnShare` 0.05"). §4.12 registers the seven as-built rules. The six `missing` rules take `warnShare` 0.05, so year built (1.9%) and stories (4.2% of T11 rows) no longer warn. `sd.roll.unmatched` drops an unusable row rather than imputing a value, so it is `shape` at the 0.01 default. `sd.zoning.generic-nc` (4.2% of hostable, `shape`) and `sd.yield.zero-hostable` (≈ 7.5% of eligible, observe) are not `missing` and are still expected to warn, below `failShare`.
2. **`existingFloorAreaM2` has no mask bit.** **Resolved** (orchestrator: "bit 6 = existingFloorAreaM2 fallback (7 reserved)"; T11 and T13 rows amended). `sd.roll.floor-area-missing` sets bit 6, the registry accepts `maskBit` 0–6, the decoder rejects bit 7 only, and the no-row mask is 95 (§4.5, §4.8, §4.12, AC 16). stage-calibration reports bits 0–6.
3. **The capacity rule's live count** (open; measured at implementation under DQ-4). The design's ≈ 116 parcel-years came from a query that counted units ≥ 20 only. The rule as written has no minimum, so small lots with a few units (slivers, or `lotAreaM2` near 0) may fire too, and the count may be higher. It is measured at implementation. If it exceeds `warnShare` on rows, or on units (the four named parcels alone hold tens of thousands of unit-years, I), the build warns. If it exceeds `failShare`, V30 fails and this comes back to you. 0715015/0715016 are replaced with no exception (composer ruling on fidelity F3-11; §4.12).
4. **Helpers beyond `recordQuality`.** **Resolved** (orchestrator; T14 row amended): T14 now names the per-owner files `pipeline/lib/quality-rules/{sd,pr,sc}.ts` and `recordSqlQuality`, and says every owner records into the build's single `counts` object. `createQualityTables` and the `WeakMap` keyed by `counts` stay internal to this module (§4.12).
5. **Who writes `quality-report.md`.** **Resolved** (orchestrator; T14 row amended: "`writeQualityReport` and V30 (`checkQuality`) run once after the last pipeline step"). project-records and stage-calibration only call `recordQuality` on the build's one `counts` object (§4.10).
6. **Shared fixture.** **Resolved** (orchestrator: "Shared fixture effects (roll 2023, lot 3 units 4; 2011 carried rows) → PR goldens follow SD"). The mini roll gains roll year 2023 (lots 3 and 4 only), and lot 3's latest units change from 0 to 4. project-records' M15 (lot 3) and M16 (lot 4) see these values, and its goldens follow this spec (§4.11). stage-calibration's fixture fit will see three roll years and the carried row.
7. **Carried rows reach project-records.** **Resolved** (same ruling). project-records reads `existing_units` from the panel at a project's roll year. With `sd.roll.year-gap`, a 2011-filed project on a parcel missing from the 2011 roll now reads the carried 2010 value instead of null (0). That is what T13 says ("Every value is post-T14"), and it changes project-records' live histories slightly.

Contradictions found in the design, each ruled (ledger, SD rulings 2026-10-17):
- The RA1 rule table gives `sd.yield.nonmonotone` and `sd.yield.zero-hostable` a tier of "—", but `QualityRule.tier` is `2 | 3 | 4`. **Ruled:** observation rules take tier 4, as registered here.
- The mask convention says "every scenario-data rule that writes a value names its bit", but `sd.zoning.split-code` and `sd.zoning.generic-nc` write a cap, which has no bit. **Ruled:** zoning rules have `maskBit: null`; the T11 row now says "rules that write no feature (e.g. zoning caps) have none". The cap rules are disclosed in the `yield` and `features` provenance.
- The table's `sd.roll.year-built-range` reads "→ null, then the class-median imputation" with a value tier of 2. T14 allows `valueTier` only for `replace`/`default`. **Ruled:** null-then-impute is `action: 'replace'` (one step), as registered here; `sd.roll.stories-max` likewise.

## Reappraisal 1 changes

- Status line and header: revised to RA1; owns T14 and V30 (orchestrator ruling "The layer: T14").
- §2: rows T1, T4, T4a, T4b, T11, T13 replaced with the design's current text, and T14 added (rows verbatim; T1: IA-16/IA-27; T11: IA-8, IA-19, mask convention; T13: IA-17, base cap date).
- §2 internal types: `existingFloorAreaM2`, `scenarioRecordFrom`, `scenarioRecordOf` (IA-8); the `imputed` comment now states the mask convention, bits 0–6, and drops "bit 3 unused" (IA-26, mask convention); T14's `quality-report.md` listed with the derived files.
- §3: global constraints re-copied, with the new "Data quality" bullet.
- §1 and delivery: T14 module and V30 are the fix round's first commit, sha relayed to project-records (Fix-round order).
- §4.1: the year-built range check moves out of normalise into `sd.roll.year-built-range` (T14: the only place a rule may null a value).
- §4.4: density-cap table rewritten to the three periods with the official values (doc debt: rulings A10/C1, A11/C2); base cap date `min(lien_day, 2026-01-11)` for every panel base value, `cap_fzp` removed from the panel path (RA1 "Base cap date"); non-condo units capped by the capacity rule.
- §4.5: rule order; `sd.roll.units-capacity` before `sd.roll.units-spike`; `sd.roll.year-gap` with bit 5; medians over observed rows only; floor area rounded to whole m²; bit 1 also set when a row's stories were nulled; bit 6 for the chunk-record floor area; no-row mask = 95; private `scenarioRecord` replaced by the codec's `scenarioRecordOf` (mask convention, scenario-data rules, IA-8). Live units total updated to 388,773 (doc debt, task-12 report).
- §4.6: the panel's T13 contract columns with types, carried rows, `rent_control_likely` as BOOLEAN read as 0/1 (IA-17).
- §4.7: yields built on `scenarioRecordOf` with the rounded floor area; reproducibility note; measured run times (IA-8; doc debt).
- §4.8: new `existingFloorAreaM2 u32` column; reserved-bit errors; measured size and the new estimate; format stays `sfh-scenario/1` because the codec is unreleased (IA-8).
- §4.10: quality tables and report placement; superseded `scenario.*` counts removed and the ad hoc 10% warning replaced by V30; V17 restated as `nonlp_base_mismatch = 0` (doc debt, A11/C2); V18 adds floor area and the mask; live expectations from the 2026-10-17 build; new **V30** and `qualityShares` (orchestrator ruling "The layer: T14").
- §4.11: fixture doc debt folded in: lot 2 built 1975, lot 4 NC-1 with `baseCap` 4 and `fzp_differs` 1, lot 5 split 1, lot 6 `baseCap` 3, fixture `rollJoinMin` 0.8 (ruling A8, defect record "Doc debt"); new RA1 cases on lots 3 and 4 and roll year 2023; lot 13 mask 95 (scenario-data rules, mask convention, bit 6 ruling).
- §4.12: `recordQuality` (amended T14 row) as the only writer of `quality.*` keys and `quality-report.md` rows, with `sample` (sorted ids, first 25 to the report), its errors and tests; model choices (land-use mapping, stories rule, district choice, exclusions, cap table) not registered and kept in provenance (orchestrator amendment of T14, 2026-10-17).
- §4.12 (new): T14 module, per-owner rule files, report helper API, generated Data-quality doc section, the registered scenario-data rules (the design's eleven plus seven as-built defaults), and the exact definitions of `sd.roll.units-capacity`, `sd.roll.units-spike`, `sd.roll.year-gap` and the observation rules (DQ-4, orchestrator rulings "The layer: T14", "scenario-data rules", "Mask convention").
- §5: data-quality seam; levers use `scenarioRecordOf` (IA-8).
- §6: new `quality.test.ts`, `scenario-quality.test.ts`, `scenario-record.test.ts`, `scenario-rebuild.test.ts`; codec, density-cap, normalise, invariants and golden tests updated (T14, IA-8, base cap date, doc debt).
- §7: AC 2, 3, 6, 10 updated; AC 13–18 added (T14 first commit, registry, doc section, mask, `existingFloorAreaM2`/`scenarioRecordOf`, base cap date).
- New section "Interface concerns (reappraisal 1)".
- Fidelity pass 3 (2026-10-17): bit 6 = `existingFloorAreaM2` applied throughout (comment, mask list, decoder rejects bit 7 only, registry `maskBit` 0–6, `sd.roll.floor-area-missing` bit 6, no-row mask 95, tests, AC 16; F3-1); kind defaults (`missing` → `warnShare` 0.05) stated and tested, shares column on the as-built rules, `sd.roll.unmatched` reclassified `shape` (a drop, not an imputation; F3-2); §4.11 lots 3/4 rationale reworded for project-records' M15/M16 (F3-8); 0715015/0715016 replaced with no exception (F3-11); DQ-4's conditions quoted in §5 (F3-17); every ruled reappraisal-1 interface concern marked resolved with its ruling (F3-9).
