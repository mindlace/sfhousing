# stage-calibration: design spec

Status: derived 2026-10-16 from [the FZP timelapse composition design](../design/2026-10-16-1903-fzp-timelapse.md). Updated the same day to its "Interface reconciliation" section. Research inputs: [literature survey](../research/2026-10-16-fzp-calibration-literature.md) and [dataset probe](../research/2026-10-16-sf-stage-datasets.md). Slug `stage-calibration`.
- **Owns:** T1, T2, T4, T4a, T4b, T4c, T12.
- **Consumes:** T3 (`asOf`, `pathway`), T4d (project-records), T11 and T13 (scenario-data).

## 1. Scope

From the design:

> **`stage-calibration`** (data pipeline). Builds `scenarios/fzp/calibration.json` from the histories:
> - competing-risks transition tables per pathway and stage, with censoring;
> - the **initiation model**: a discrete-time hazard that a parcel with no project files one in a given month. It is fitted to SF parcel-years using pre-FZP envelopes and features, then applied with FZP envelopes (tier 2);
> - the **size model**: what fraction of the allowed envelope a project proposes, measured from proposed stories against allowed height (tier 0→2);
> - the **revision model**: the chance, timing and magnitude of a change in unit count, measured by comparing the PRJ proposal, the permit's `proposed_units` and the completed units of linked records (tier 0→2).
> Every parameter carries its provenance (T4). **Fitting window (partner ruling OD-T3):** the longest window available across the majority of stages, with no weighting toward recent years. For each stage, take the earliest year with reliable tier-0 coverage. The common window starts at the latest of those years that still keeps a majority of stages fully covered, and ends at the snapshot. A stage whose coverage starts later uses its own span, and its provenance says so. Initiation is fitted over all available parcel-years with no calendar-year term.

**In scope**
- **Step 0** (round 2: "a step 0 lands the shared types and time modules"). Three dependency-free files land first, before any other subsystem's code:
  - **`src/lib/timelapse/time.ts` (T1).** `Day`, `MONTH_DAYS`, `monthsIn`, `OPEN_DAY`, and `DYING_DAYS = 270` (display only, tier 4, read by render's uniforms).
  - **`src/lib/timelapse/math.ts`.** Deterministic fdlibm ports of `exp` and `log`.
  - **`src/lib/timelapse/types.ts`.**
    - The T2 types and constants: `Stage`, `Pathway`, `ExitReason`, `STAGE_ORDER`, `PATHWAYS`, `EXIT_ORDER`, `pathwayStages`.
    - The T4 types `Provenance`, `Transition`, `Calibration`; the T4a types `FeatureId`, `InitiationModel`; T4b `SizeModel`; T4c `RevisionModel`; T4d `ProjectHistory`.
- **`src/lib/timelapse/model.ts` (T12)**, which imports `types.ts`, `time.ts` and `math.ts`. It is pure, zod-free and worker-safe. It exports `sampleTransition`, `initiationHazard`, `chanceTable`, `typicalMonths` and `parseCalibration`, plus the helpers `binIndex` and `eventualProbabilities`.

  `src/lib/timelapse` is in the dataset-version hash (T11).
- **The pipeline step `pipeline/steps/calibration.ts`** and its libraries under `pipeline/lib/fzp-cal/`: window, spells, Aalen–Johansen, tails, fallbacks, initiation panel and IRLS, size, revision, pathway mix, provenance and the report writer.
- **Outputs:**
  - `out/<v>/scenarios/fzp/calibration.json` (shipped);
  - `pipeline/.cache/derived/<datasetVersion>/calibration-report.md`, a build artifact that is **not uploaded or linked** (reconciliation, "Page");
  - invariants V25–V29, `report.json` counts and the fixture calibration;
  - the `docs/dev/pipeline.md` update for V25–V29 (round 2; text in §4.10).

**Out of scope**
- Histories, `projects.json`, `parcels.bin`, the T13 panel, `parcel-lineage.parquet` and the manifest entry (project-records, scenario-data). Lineage is not read here: T4d `parcelIds` are already current mapblklots.
- `simulate`, clamping sampled days to the snapshot, applying revisions and caps, and the pathway rule for Local Program parcels (timelapse-sim).
- Rendering and UI.
- Policy levers, addenda sub-stages, DA phasing (§5).
- Any runtime fitting.

## 2. Interfaces

Verbatim rows this subsystem owns (T1, T2, T4, T4a, T4b, T4c, T12) or consumes (T3, T4d, T11, T13):

| # | interface | owner → consumers | mark |
|---|---|---|---|
| T1 | `type Day = number` is integer days since 1970-01-01 UTC. All schedule times use it. It is exact in Float32. `MONTH_DAYS = 30.436875` (365.2425 / 12). `monthsIn(enteredDay, day) = floor((day − enteredDay) / MONTH_DAYS)` is the single months-in-stage rule, used by every table index (T4, T12, the bar, the card). `OPEN_DAY = 3.0e38` encodes an open-ended window end. These live in `src/lib/timelapse/time.ts` | stage-calibration → all | DC |
| T2 | `type Stage = 'preApplication' \| 'filed' \| 'entitled' \| 'permitFiled' \| 'permitIssued' \| 'construction' \| 'complete'`; `type Pathway = 'discretionary' \| 'streamlined' \| 'permitOnly'`; `type ExitReason = 'withdrawn' \| 'disapproved' \| 'cancelled' \| 'expired'`. `STAGE_ORDER` lists the stages in this order. `preApplication` is optional on every pathway. `permitOnly` projects never enter `filed` or `entitled`. A ghost is visible from the project's first entered stage | stage-calibration → project-records, timelapse-sim, timelapse-render, fzp-mode | MC (stage sequence and exits follow real records), DC (names) |
| T3 | `interface InFlightProject { id: string /* 'PRJ:<record_id>', 'BP:<permit>', 'PRJ:<record_id>:BP:<permit>' for split pipeline rows, 'CASE:<case_no>' for PRX rows, 'PPA:<record_id>' for PPA-only; unique */; label: string \| null /* street address from the records, if any */; parcelIds: ParcelId[] /* current mapblklot, mapped through retired-parcel lineage */; pathway: Pathway; stage: Stage; history: Partial<Record<Stage, Day>> /* observed entry days */; units: number; existingUnits: number; stories: number \| null; storiesTier: 0 \| 3 \| null /* 0 = recorded field, 3 = parsed from description text */; multiPhase: boolean /* PRX/DA remaining-phase row */; phases: { units: number; parcelIds: ParcelId[]; plannedPermitFiled: Day \| null /* from the DA phasing schedule, if enriched */; source: { label: string; url: string; retrieved: string } \| null }[] \| null /* multi-phase only: null until enriched, then each phase is simulated as its own sub-project */; sources: { dataset: string; id: string; key?: string /* field to query, e.g. 'case_no'; absent = the dataset's record-id field */ }[] }`. `scenarios/fzp/projects.json` = `{ schema: 1; asOf: Day; rhnaCompletedNet: { units: number /* net units added since `since` up to `asOf`, Housing Inventory definition: completions plus alteration gains, minus demolitions and alteration losses */; since: Day /* 2022-06-30, RHNA projection period start */; provenance: Provenance }; projects: InFlightProject[] }`. Projects are new construction only (alterations adding units are out of scope) | project-records → timelapse-sim, fzp-mode | MC (real pipeline is the starting state), DC (shape) |
| T4 | `interface Provenance { tier: 0 \| 1 \| 2 \| 3 \| 4; label: string; sources: { label: string; url: string }[]; method: string; n?: number; window?: [from: string, to: string] }`. `interface Transition { months: number; advance: number[] /* cumulative incidence by month 1..months */; exit: Partial<Record<ExitReason, number[]>>; tail: { advance: number; exit: Partial<Record<ExitReason, number>> } /* constant monthly hazards beyond months */; provenance: Provenance; tailProvenance: Provenance /* tier 2: extrapolation beyond the observed months */ }`. `scenarios/fzp/calibration.json` = `{ schema: 1; asOf: Day; transitions: Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Transition>>>; initiation: InitiationModel; pathwayForNew: Record<Pathway, number> & { provenance: Provenance }; size: SizeModel; revision: RevisionModel; streamlinedForLocalProgram: Provenance /* tier 2: Local Program projects use the streamlined tables */; phaseGap: { days: number[] /* empirical gaps between successive phases' permitFiled */; provenance: Provenance } }`. The calibration also carries `ppaShare: Record<Pathway, number> & { provenance: Provenance }`, the share of new projects that start at `preApplication`. `InitiationModel`, `SizeModel` and `RevisionModel` are rows T4a–c. Everything is plain JSON, so future policy levers can transform it (the T9 seam). **Sampling semantics:** a project entering stage *s* at day *d* draws one uniform. The month of advance or exit comes from the cumulative tables (`advance` + Σ`exit` ≤ 1 at every month), with the tail hazards beyond `months`. An in-flight project already *m* months into *s* draws conditionally on having survived *m* months. Day within the month is uniform | stage-calibration → timelapse-sim, fzp-mode | MC (every parameter carries tier + source), DC (encoding) |
| T4a | `type FeatureId = 'potentialRatio' /* yield units at full envelope ÷ max(existingUnits, 1); base variant uses the density-capped base yield (T13), FZP variant the Local Program yield (T11) — this is how density decontrol is seen */ \| 'existingUnits' \| 'lotAreaM2' \| 'yearBuilt' \| 'storiesGap' /* envelope stories − existing stories */ \| 'improvementShare' /* improvement ÷ (land + improvement) assessed value */ \| 'rentControlLikely' /* 0/1: ≥ 2 units and built < 1979 */ \| 'landUseClass' /* categorical: residential, mixed, commercial, pdr, vacant, other */`. `interface InitiationModel { kind: 'logit-monthly'; intercept: number; terms: { feature: FeatureId; bins: number[] /* ascending edges; categorical features use category index */; coef: number[] /* one per bin */ }[]; provenance: Provenance }`. Monthly hazard = `1 / (1 + exp(−(intercept + Σ coef[bin(feature)])))`. It is fitted on pre-FZP (base) envelopes and evaluated on FZP envelopes. Parcels with an in-flight project are not at risk until that project ends | stage-calibration → timelapse-sim, scenario-data (feature list) | DC |
| T4b | `interface SizeModel { fillLevels: number[] /* ascending fractions of envelope stories; last = 1; length F matches T11 yield */; byEnvelope: { maxStoriesUpTo: number; probs: number[] /* length F, sums to 1 */ }[]; provenance: Provenance }`. A new project proposes `stories = max(1, round(fill × envelope.maxStories))` | stage-calibration → timelapse-sim, scenario-data (F) | DC |
| T4c | `interface RevisionModel { at: { stage: Stage /* applied on entering this stage */; probability: number; ratio: { edges: number[]; probs: number[] } /* histogram of new units ÷ previous units */ }[]; provenance: Provenance }`. No revision on or after `construction`. Upsizing is capped at the parcel's envelope. A revision changes units, and stories follow from the yield table (simulated) or scale proportionally (pipeline) | stage-calibration → timelapse-sim | MC (projects can resize before construction), DC (shape) |
| T4d | `interface ProjectHistory { id: string; pathway: Pathway \| null /* null = unclassifiable: excluded from per-pathway tables, included in pooled ones */; parcelIds: ParcelId[]; entered: Partial<Record<Stage, Day>>; end: { kind: 'complete'; day: Day } \| { kind: 'exit'; stage: Stage; reason: ExitReason; day: Day } \| { kind: 'open'; lastObserved: Day }; unitsAt: Partial<Record<Stage, number>> /* current proposed units from the record that represents each stage: PRJ → 'filed', site/full permit → 'permitFiled', TCO/CFC certified → 'complete'; cross-record, not snapshots (tier 2) */; existingUnits: number; storiesProposed: number \| null; baseStoriesAtFiling: number \| null /* current base height proxy, tier 3: no pre-FZP height map exists */; sources: { dataset: string; id: string; key?: string /* field to query, e.g. 'case_no'; absent = the dataset's record-id field */ }[] }`. Pipeline-internal file `pipeline/.cache/derived/<datasetVersion>/project-histories.json` = `{ schema: 1; asOf: Day; histories: ProjectHistory[] }`, never shipped. The history population and the in-flight population (T3) come from the same linkage | project-records → stage-calibration | DC |
| T12 | In `src/lib/timelapse/model.ts` (pure, zod-free, worker-safe): `sampleTransition(t: Transition, u: number, monthsElapsed: number): { kind: 'advance' \| ExitReason; days: number }`, `initiationHazard(m: InitiationModel, f: Record<FeatureId, number>): number`, `chanceTable(cal: Calibration): Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Float32Array>>>` (per month in a stage, the probability of eventually reaching `complete`; the table is 241 months long, and the tail is used beyond it), `typicalMonths(cal: Calibration): Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, number>>>` (median months to leave each stage, used for the bar's within-stage fill), and `parseCalibration(json: unknown): Calibration` (throws on schema mismatch). The pipeline's validation, the worker, the renderer (lookups uploaded once) and the card all use these, and nothing re-implements them. The bar colour and the card's "chance of finishing" both come from `chanceTable` | stage-calibration → timelapse-sim, timelapse-render, fzp-mode | MC (health = chance of finishing, OD-T2; one sampling semantics everywhere) |
| T11 | `scenarios/fzp/parcels.bin` (codec `sfh-scenario/1`, in `src/lib/data/`; deflate inside the file, async decode). It holds **every** parcel: `id`, `labelPoint`, `cellId`, a `hostable` flag (eligible and able to host a new project), `envelope: Envelope` (FZP stories: Local Program height if `localProgram`, else base height; clamped to `MAX_STORIES`), base stories, the base-zoning density cap in units (null = none), `localProgram: boolean`, `existingUnits` (latest assessor roll), the T4a feature values (base and FZP variants of `potentialRatio` and `storiesGap`) with an imputation mask, `hostable_base` (hostable under the old zoning), `baseYield: Uint16[F]` (gross units at each fill level of the base envelope, density-capped), and `yield: Uint16[F]`, the gross units at each fill level of the envelope, replacement typologies only (no ADU outcomes), with no density cap under the Local Program. `FILL_LEVELS = [0.25, 0.5, 0.75, 0.9, 1]` (F = 5, tier-4 quantisation grid) is owned here, and stage-calibration imports it. Named in the manifest as `scenarios?: { fzp: { parcels: url; projects: url; calibration: url } }` (amends I12 and `ManifestBaseSchema`; optional, so older datasets load). Because the yield uses the generator, `src/lib/generator` and `src/lib/timelapse` join the dataset-version hash | scenario-data → timelapse-sim | DC |
| T13 | Pipeline-internal parcel panel `pipeline/.cache/derived/<datasetVersion>/parcel-panel.parquet`. Per parcel × assessor roll year (2007..latest): `mapblklot`, roll year, assessor units, stories, year built, land and improvement value, use code → `landUseClass`, the zoning code (`acdm-wktn`), base stories, the base density cap, and the base-envelope yield (gross units at full base envelope, density-capped). Never shipped. Retired-parcel lineage is `parcel-lineage.parquet` in the same folder | scenario-data → project-records, stage-calibration | DC |

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
| IC-15 | The round-3 permit-side start of "about 1989" assumes first-construction-document dates from 1989. They are sparse until 2000 (verified counts in §4.4) | **Resolved**, round-3 addenda: data-driven starts, `permitFiled` 1989, `permitIssued` and `construction` 2000 |
| IC-16 | `phaseGap` needs per-permit filed days, but T4d merges a past DA's phase permits into one history and carries only permit ids in `sources` | **Resolved**, round-3 addenda: project-records emits `pipeline/.cache/derived/<datasetVersion>/permits.parquet`. Columns needed are listed in §4.7a |

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
- `OPEN_DAY = 3.0e38` (finite in Float32).
- `DYING_DAYS = 270`: the display window of a death, 90 days red then 180 days fade. It is tier 4, display only, and named in round 2. Nothing in calibration reads it.
- The module has no dependencies.

### 4.1a Deterministic math (`src/lib/timelapse/math.ts`)

**What it is.** The module exports `exp(x: number): number` and `log(x: number): number`. They are line-for-line TypeScript ports of fdlibm 5.3:
- `e_exp.c`: argument reduction by ln2 hi/lo, then the Remez polynomial P1..P5;
- `e_log.c`: reduction to [√2/2, √2], then the polynomial Lg1..Lg7.

**How it reads bits.** The high and low words are read and written through one module-level `DataView` over an 8-byte `ArrayBuffer`, never through `Math.*`. It uses only IEEE-754 `+ − × ÷` and integer bit operations. JS never fuses multiply-add, so the results are bit-identical on every engine (V8, JavaScriptCore, SpiderMonkey). Special cases follow fdlibm:
- `exp`: overflow → `Infinity`, underflow → 0, NaN propagates;
- `log`: `log(0) = −Infinity`, negative → NaN.

**Who uses it.**
- Every T12 function: `initiationHazard`, and the closed-form tails in `sampleTransition` and `typicalMonths`.
- The pipeline's tail probability p_j (§4.4) and its IRLS (§4.6).
- timelapse-sim (reconciliation).

`Math.exp` and `Math.log` (and `Math.pow`, `Math.log1p`, `Math.expm1`) never appear on a determinism path. In the T12 tail, (1 − ρ)^n is computed as `exp(n · log(1 − ρ))`. An ESLint `no-restricted-properties` rule scoped to `src/lib/timelapse/**` and `pipeline/lib/fzp-cal/**` bans those `Math` members.

**Accuracy.** Error is below 1 ulp, as in fdlibm. Accuracy is not the goal; reproducibility is.

**License.** fdlibm's permissive Sun notice is kept in the file header. The module is source we ship, not a dependency.

### 4.2 Shared model module (T12, `src/lib/timelapse/model.ts`)

Below, M = `MONTH_DAYS`. Write C(k) = advance[k−1] + Σ exit[k−1] for 1 ≤ k ≤ K = `months`, with C(0) = 0, and ρ = tail.advance + Σ tail.exit. For k > K, C(k) = 1 − (1 − C(K))(1 − ρ)^{k−K}. `parseCalibration` guarantees ρ > 0 and C(K) < 1.

**`sampleTransition(t, u, monthsElapsed)`**, with u ∈ [0, 1) and m = `monthsElapsed`:
1. The target is c = C(m) + (1 − C(m))·u.
2. The event month *k* is the least *k* > *m* with C(k) > c. Beyond K it is solved in closed form: k = K + ⌈`log`((1 − c)/(1 − C(K))) / `log`(1 − ρ)⌉, using `math.ts` `log`. It is then adjusted by ±1 so that the inequality holds exactly, with C(k) evaluated through `math.ts` `exp`/`log`.
3. Month *k*'s mass [C(k−1), C(k)) is split in the order advance, then `EXIT_ORDER`. Table months use the increments of F_j; tail months use proportions p_j/ρ. `kind` is the sub-interval [lo, hi) that contains c.
4. φ = (c − lo)/(hi − lo). Then `days` = ⌈(k−1)·M⌉ + ⌊φ·(⌈k·M⌉ − ⌈(k−1)·M⌉)⌋. This is the T4 "one uniform; day within the month is uniform", and `monthsIn(0, days) = k − 1` always holds.

`days` counts from stage entry and is ≥ ⌈m·M⌉. An in-flight project's month *m*+1 is partly in the past, so placing a past result at the snapshot day is timelapse-sim's job.

**`eventualProbabilities(t, m)`** gives P(eventually *j*) given survival to *m* months: (F_j(∞) − F_j(m)) ÷ (1 − C(m)), where F_j(∞) = F_j(K) + (1 − C(K))·p_j/ρ. For m ≥ K it equals p_j/ρ (memoryless).

**`chanceTable(cal)`**: for each pathway and each stage *s* of `pathwayStages(p)` other than `complete`, a `Float32Array(241)`. The entry at index *m* = 0..240 is `chance(p, s, m)`:
- `chance(p, s, m) = eventualProbabilities(T[p][s], m).advance × chance(p, next(p, s), 0)`;
- `chance(p, 'complete', ·) = 1`;
- `next` steps along `pathwayStages(p)`. preApplication advances to `filed` on discretionary and streamlined, and to `permitFiled` on permitOnly. This matches T2, where advancing means entering the next stage.

Beyond index 240, callers use index 240, which equals the tail value because K ≤ 240.

**`typicalMonths(cal)`**: for each pathway and stage, the least *k* ≥ 1 with C(k) ≥ 0.5. That is the median month of leaving the stage, by any outcome. Beyond K it is solved in closed form.

**`initiationHazard(m, f)`** = 1 / (1 + exp(−(intercept + Σ_terms coef[binIndex(bins, f[feature])]))). Here `exp` is `math.ts` `exp`, and the terms are summed in array order.

All of `typicalMonths` and `chanceTable`, including their tail evaluation, use `math.ts` only.

**`binIndex(edges, x)`** = (the number of edges ≤ x) − 1, clamped to [0, len − 1]. Bin *i* is [edges[i], edges[i+1]), and the last bin is open above. Categorical features use category indices as edges.

**`parseCalibration(json)`** is a hand-written validator with no Zod. It throws a `CalibrationFormatError` naming the path on any violation of the T4 shape or of the rules below, and returns the typed value:
- `schema === 1`; `asOf` is an integer.
- Every pathway has every stage of `pathwayStages(p)` except `complete`, and no other stage. This is the reconciliation's "every pathway × stage pair is present", read as the pairs a project can occupy (T2: permitOnly never enters `filed` or `entitled`).
- Arrays have length `months` (1 ≤ `months` ≤ 240), are non-decreasing and lie in [0, 1].
- `advance + Σexit ≤ 1 + 1e-9` at every month, and C(K) ≤ 1 − 1e-6.
- Tail values are ≥ 0 and 0 < ρ ≤ 1.
- `fillLevels` equals `FILL_LEVELS` (T11), and each `probs` has length F and sums to 1 within 1e-9.
- Revision `edges` are ascending, `probs.length = edges.length − 1`, and each `probability` lies in [0, 1].
- `pathwayForNew` sums to 1 within 1e-9, and each `ppaShare` value lies in [0, 1].
- Every `Provenance` has tier 0..4, a non-empty label and method, and ≥ 1 source with an `https:` URL. Tiers 0–2 also have `n` and `window`. This includes `streamlinedForLocalProgram`, `phaseGap.provenance` and every `tailProvenance`.
- Every Transition has a `tailProvenance`. `streamlinedForLocalProgram` is present. `phaseGap.days` is a non-empty, ascending array of positive integers.

### 4.3 Placement in the build

`build()` (`pipeline/steps/build.ts:116-233`) gains a timed `calibration` step. It runs after the project-records and scenario-data steps and before `buildManifest` (`build.ts:181`). It reads:
- `pipeline/.cache/derived/<datasetVersion>/project-histories.json` (T4d), whose `asOf` must equal `projects.json` `asOf` (T3);
- `parcel-panel.parquet` (T13);
- the decoded T11 parcels, for `hostable`, `lotAreaM2`, the FZP-variant features and `FILL_LEVELS`.

It writes `calibration.json` and the report. It does no network access. There is no new CLI command. **No statistics dependency is added**: Aalen–Johansen is one sorted sweep, and the logit fit is IRLS with a dense Cholesky solve of about 50 parameters.

### 4.4 Population, normalisation, window, estimator

**Qualifying project.** A T4d history whose first recorded `unitsAt` minus `existingUnits` is ≥ 1 net unit (reconciliation: single-unit new construction is included). The same predicate defines the transition cohort, the initiation event, `pathwayForNew`, `ppaShare`, size and revision.

**Normalisation.** These steps run in order, and each is counted under `calibration.adjust.*`:
1. **Imputation.** On `pathwayStages(pathway)`, a missing stage with a later stage present gets the next present stage's day. This preserves incidence, and the bias toward zero-duration spells is reported.
2. **Running maximum.** `eff[s]` is the maximum of the observed entry days of *s* and of every earlier entered stage. Example: a site permit filed before approval gives a zero-duration `entitled` spell.
3. **Exit reconciliation.** An exit applies at the last entered stage, and its day is clamped to `≥ eff[last]`.
4. **Defensive pathway rule.** A `permitOnly` history with `eff.permitFiled` < 2015-01-01 is treated as `pathway = null`, in addition to T4d's nulls. Before PRJ coverage, a missing PRJ link does not prove there was no entitlement.
5. **preApplication pooling.** Every preApplication spell is pooled across pathways, because a PPA-only record's pathway is assigned, not observed.
6. **Administrative-purge censoring** (round 2). Exits from bulk administrative actions, such as DBI's Sept–Oct 2026 batch withdrawal, are not project decisions. Detection runs over the exits of all qualifying histories after step 3, using the duration in stage *x* = exit day − `eff[stage]`:
   - **Purge day.** A calendar day *D* is a purge day iff all three hold:
     - c(*D*) ≥ `PURGE_MIN_EXITS`, where c(*D*) is the number of exits dated *D*, any reason and stage;
     - c(*D*) ≥ `PURGE_RATIO` × the mean daily exit count over the 365 days before *D*, with that mean floored at 1/365;
     - the median *x* of *D*'s exits is ≥ `PURGE_MIN_DAYS`.
   - **Purge window.** Purge days less than `PURGE_GAP_DAYS` apart merge into one window [first, last].
   - **Censoring.** Every exit dated inside a window with *x* ≥ `PURGE_MIN_DAYS` becomes **censored at its last non-purge activity**, which is the day before the window starts. T4d carries no activity dates, so that is the last day the record is known to have been open; it is never earlier than `eff[stage]`. Shorter-duration exits inside the window stay exits.
   - **Tier.** The thresholds are tier 4 (§4.11). The detection is a tier-2 inference. Every affected Transition's `method` says "k exits in administrative purge windows [dates] censored (tier 2 detection, tier-4 thresholds)". The report prints each window: dates, exits by reason and stage, how many were censored, and the median durations.
   - **Scope.** The rule runs in live and fixture builds alike.
   - **Effect on initiation.** A censored exit does not end the project for the initiation panel; the project stays open (§4.6).

Tables are **project-weighted**. Unit-weighted shares appear only in the report.

**Fitting windows (OD-T3 as refined by partner rulings round 3).** A configured constant in `pipeline/lib/fzp-cal/window.ts`. Its evidence comes from probes verified 2026-10-16 (URLs at the end of §4.10).

| stage | side | pooled window start Wₛ | pathway window start | evidence |
|---|---|---|---|---|
| preApplication | Planning | 2015-01-01 | 2015-01-01 | PPA records `y673-d69b`, 2011-02-11 to **2023-07-07** (`entryEnd`); Planning span from 2015 (ruling) |
| filed | Planning | 2015-01-01 | 2015-01-01 | PRJs with net units ≥ 1: 71 (2013), 158 (2014), 398 (2015) |
| entitled | Planning | 2015-01-01 | 2015-01-01 | approvals `d4jk-jw33`: 182 (2014), 1,328 (2015) |
| permitFiled | permit | **1989-01-01** | 2015-01-01 | `filed_date` dense from 1981; ruling "about 1989" |
| permitIssued | permit | **2000-01-01** | 2015-01-01 | see below |
| construction | permit | **2000-01-01** | 2015-01-01 | see below |

**Why 2000 and not 1989 for two stages.** The ruling ties the permit-side start to the first-construction-document date. Verified per-year counts of `first_construction_document_date` (types 1/2, primary address) are:
- 1 in 1989;
- 0 in 1990–91;
- 46 and 47 in 1992–93;
- ≤ 3 per year in 1994–99;
- 183 in 2000, and dense after.

Before 2000, site permits would fall back to `issued_date` as the construction start. That would fabricate zero-length `permitIssued` spells. So the two stages that use the date start in 2000. `permitFiled`, whose transition needs only `filed_date`, `issued_date` and status, starts in 1989. The round-3 addenda confirm these data-driven starts.

**Guard.** `COVERAGE_GUARD` is a method constant: **on in `LIVE_CAL`, off in `FIXTURE_CAL`** (round 2). When on, any year in a pooled window with zero qualifying entries raises `CalibrationError: coverage gap`. When off, the per-year counts are still reported.

**What is recorded.**
- Planning-side Transitions have `window` = [2015-01-01, asOf].
- Permit-side Transitions have `window` = [Wₛ, asOf], and their `method` gives both windows (§4.5).
- The report reprints this table.

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
- **Table length.** `months` is the largest *k* ≤ `K_MAX` with n(k·M) ≥ `N_RISK_MIN`.
- **Tail.**
  - The span starts at k₀ = max(1, `months` − `TAIL_SPAN` + 1). k₀ moves earlier until the span holds ≥ `TAIL_MIN_EVENTS` events. The span runs to the end of observation.
  - Person-months E = Σᵢ |[max(aᵢ, (k₀−1)·M), xᵢ]| ÷ M.
  - λ_j = events_j ÷ E.
  - p_j = (λ_j/λ)(1 − `exp`(−λ)), using `math.ts`.
  - **Tail provenance** (T4 `Transition.tailProvenance`). It is written for every Transition, with tier **2** ("extrapolation beyond the observed months"):
    - `method`: "constant competing hazards, occurrence/exposure over months k₀+ (k₀ = …), applied beyond month `months`";
    - `n`: the events in the span;
    - `window`: the Transition's window;
    - `sources`: the Transition's sources.

    For rung 3 it copies the Transition's own tier and sources, because there the tail is the table.
- **Rounding.** Table values are floored to 1e-6, which keeps them monotone and keeps Σ ≤ 1. Tail values are rounded to 6 significant digits.
- **Rejection.** A cell is rejected, and goes to §4.5, unless C(K) ≤ 1 − 1e-6 and ρ > 0.
- **Construction provenance.** The `construction` cells' `method` states: "completion = first TCO/CFC, else permit `completed_date`; TCO data start in 2018, so earlier completions are dated later (bias toward longer durations)".

### 4.5 Fallback ladder (every applicable cell is always filled)

A rung passes when the cell has spells ≥ `N_SPELLS_MIN` and events ≥ `N_EVENTS_MIN` in its window, and §4.4's rejection checks pass.

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
  - Durations in permit review and construction are set mostly by administrative queues and building physics. They are estimated far more precisely from about 25 years of records than from 11.
  - Pathways differ mainly in level, for example in how often a streamlined permit is abandoned. One constant ratio per outcome is the smallest model that keeps each pathway's own 2015+ level, and κ keeps thin pathways near the pooled table instead of at 0 or ∞.
  - Unlike multiplying the cumulative incidence by a constant, this keeps advance + Σ exit ≤ 1, monotonicity and competing-risk consistency by construction.
  - **Diagnostic.** The report prints, for each pathway and stage, the maximum absolute difference between the scaled table and *p*'s own 2015+ AJ. The build warns if it exceeds 0.05.
- **Thin pathways.** If *p* has fewer than `N_SPELLS_MIN` spells in 2015+, θ = 1 (pure pooled), and the method says so.
- **Provenance.**
  - Tier 2.
  - `label`: "SF permit records <Wₛ year>–<asOf year>, pooled across pathways before 2015, scaled to <pathway> 2015–<asOf year> (tier 2)".
  - `method`: "Pooled Aalen–Johansen over all spells since <Wₛ> (pooled across pathways before 2015; pathway unknowable); cause-specific hazards scaled by θ = (O+5)/(E+5) from <pathway> spells since 2015-01-01 (proportional hazards): advance θ=…, <reason> θ=…".
  - `n`: pooled spells. `method` also gives the pathway's 2015+ spells.
  - `window`: [Wₛ, asOf].
- **Fallback.** If the pooled component fails the thresholds, rung 3.
3. **Literature synthetic.** A constant-hazard table with `months = 1`:
   - q = 1 − 2^{−1/D};
   - `advance[0]` = tail.advance = A·q;
   - exit_j = E_j·q, where E_j = (1 − A) × the stage's observed exit-reason shares across all spells in the window (tier 2), or all of it on the primary reason if no exits are observed (tier 4);
   - the tier is the worst of D, A and E.

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

**Features: read, never computed or imputed here** (round 2, "Initiation features. One definition"). scenario-data computes every feature, its imputation and the `imputed` mask.

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

No value is altered. The `imputed` mask is not a model input. The report prints, for each feature, the share of at-risk exposure with that mask bit set.

**Panel, at-risk set and event.**
- **Months.** Calendar months **2007-01** through 2025-12: every assessor roll year (round 3). The end is the last full month on pre-FZP zoning (FZP effective 2026-01-12). Months of year Y use roll Y.
- **Detection basis.** Planning records are reliable from 2015-01-01, the Planning-side window. For each qualifying history let F = the earliest of `entered.preApplication`, `filed` and `permitFiled`, and P = `entered.permitFiled`, the first new-construction (type 1/2) site or full permit filing.
  - **Basis "record"** if F ≥ 2015-01-01. The event day is F, and coverage starts at F. Tier 0.
  - **Basis "permit"** if F < 2015-01-01. The event day is P, if present, in whatever year it falls, and coverage starts at P. In this era only permit filings are reliably visible, so a project that never filed a permit is invisible: no event and no coverage. The months between F and P count as at risk.
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

There are no "unknown" bins. scenario-data imputes every missing value, so the only 0 values are its own vacant-lot rule (vacant lots: `yearBuilt` 0, `improvementShare` 0). Those fall in bin 0 by that rule, not by the mask.

A numeric feature's highest bin with fewer than `MIN_BIN_EVENTS` events merges downward, repeatedly, and then the same runs upward from the bottom. The published `bins` are the merged edges.

**Extrapolation.**
- An FZP value above the top edge lands in the top bin (the clamp), so it gets the top bin's historical hazard.
- The report gives the share of hostable parcels, and of FZP expected filings, whose `potentialRatio` or `storiesGap` exceeds the maximum at-risk value seen in the panel. For those parcels the hazard is "tier 2, applied beyond historical support (top-bin clamp)" and probably understates the FZP response.
- `method` repeats the share. The tier stays 2.

**Fit.**
1. Rows are binned with the shared `binIndex`, aggregated into `FitCell`s, and sorted lexicographically by bin tuple.
2. The model is a binomial logit on (events, exposure): one Bernoulli trial per parcel-month, which is the discrete-time hazard likelihood.
3. The design is the intercept, a full one-hot over bins, and one **nuisance column** `basis` (1 for parcel-months before 2015-01-01, else 0). Ridge ½·`RIDGE_LAMBDA`·Σβ² applies to the bin coefficients only; the intercept and `basis` are unpenalised.
4. IRLS starts from the intercept = logit(Σevents/Σexposure), with `basis` and the bins at 0. It stops when max|Δ| < 1e-9, with at most 100 iterations. Non-convergence is a `CalibrationError`.
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

**Identifying past multi-phase projects in the records.** Phases of one Development Agreement project are the separate new-construction site or full permits of one linked project. project-records' linkage puts them in one T4d history; only current pipeline rows are split. A history is a **DA group** iff at least one of these holds:
- its `sources` include a `y673-d69b` child record whose id ends in `DVA` (optionally followed by `-NN`; DVA is Planning's Development Agreement record type, verified present in `y673-d69b`);
- its `sources` include a `6jgi-cpb4` case ending in `PRX`;
- its PRJ or case id appears in `pipeline/enrichment/multiphase.json`.

**Phases of a group.**
- **Which permits.** The group's distinct type-1/2 site or full permits that each propose ≥ `PHASE_MIN_UNITS` = 10 units (tier 4). They come from project-records' `permits.parquet` (round-3 addenda). This spec reads these columns:
  - `permit_number`, `project_id` (the T4d history id);
  - `filed_day` (Day), `proposed_units`, `permit_type` (1 or 2), `site_permit` (bool);
  - `superseded` (bool, project-records' rule);
  - the DA links `dva_record_ids`, `prx_case`, `case_no`.

  If the landed project-records spec names them differently, its names win and this list maps one-to-one.
- **Refiles.** Superseded permits, under project-records' superseded rule, are dropped, because a refile is not a new phase.
- **Same day.** Permits filed on the same day count as one phase.
- **Gaps.** Phases are sorted by filed day. The gaps are the differences between successive filed days, in days and always > 0.
- **Window.** Permit records from 1989-01-01 (the permit-side window).

**Output and ladder.** `days` is all gaps across groups, sorted ascending.
1. **DA groups** with ≥ `PHASE_MIN_GAPS` = 10 gaps (tier 4 threshold).
   - Tier 2.
   - `label`: "Gaps between phase permit filings in past SF Development Agreement projects (tier 2)".
   - `method`: the group count, the gap count, the median and the IQR.
   - `n`: the gap count; `window`: [1989-01-01, asOf].
2. **Fallback, tier 2.** The same rule over every history with ≥ 2 qualifying permits of ≥ 10 units each: large multi-building projects, DA or not. `method` says "not DA-specific".
3. **Last resort.** `days = [730]`, **tier 4**, "made up: no multi-phase history found". This is expected only in fixture builds.

### 4.8 SizeModel (T4b)

- **Fill levels.** `fillLevels` = `FILL_LEVELS` imported from T11 ([0.25, 0.5, 0.75, 0.9, 1], F = 5).
- **Measurement.** Qualifying histories with first record in [2015-01-01, asOf] and with `storiesProposed` and `baseStoriesAtFiling` both ≥ 1. The ratio r = storiesProposed ÷ baseStoriesAtFiling is snapped to the nearest fill level, ties going up. r > 1 (density bonus) maps to 1, and that share is reported.
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
- **Ratios.** Among revised pairs, new ÷ previous is clamped to [0.25, 3] and binned with `edges` [0.25, 0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3] (tier 4). Sampling within a bin is uniform.
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
- `method`, naming the estimator, rung, imputation counts, proxies and any own span;
- `n` and `window`, mandatory for tiers 0–2.

Any tier-3/4 component is named in `method`, e.g. "D = 12 mo (tier 4, made up)". fzp-mode's dialog reads these from `calibration.json`.

**`calibration.json`.**
- Keys follow T4 order, with `PATHWAYS` order and `STAGE_ORDER`. `JSON.stringify` with no whitespace.
- Expected 40–120 KB; limit **256 KB** (tier 4 budget).

**`calibration-report.md`** (not shipped) is deterministic, with no wall-clock times. Its sections:
1. header;
2. the window rule;
3. per-pathway transition tables: rung, tier, n, events, window, `months`, eventual shares (project- and unit-weighted), `typicalMonths`, imputation counts;
4. the TCO-versus-`completed_date` construction-duration diagnostic;
5. initiation: bins with exposure, events and coefficient; the back-cast; the extrapolation share; the FZP expected filings;
6. size and revision;
7. `pathwayForNew` and `ppaShare`;
8. a parameter index with tier and source;
9. the method constants.

`fixture --update-golden` copies the fixture report to `pipeline/test/fixtures/mini/golden/calibration-report.md`.

**Determinism.**
- Inputs are sorted (spells by pathway, stage, project id; panel rows by key), and every sum runs in that fixed order.
- The only randomness is V27's `mulberry32(0x5eed)`.
- The step runs twice in-run, and the outputs must be byte-identical.

**`report.json` counts.** `calibration.histories`, `.qualifying`, `.adjust.*`, `.pathwayNull`, `.spells.<pathway>.<stage>`, `.rung3`, `.panel.parcelYears`, `.panel.exposureMonths`, `.panel.events`, `.purge.windows`, `.purge.censored`, `.bytes`.

**Invariants.** Run by `build` and `check`.

| id | check |
|---|---|
| V25 | `parseCalibration` accepts `calibration.json`; `asOf` equals T3 and T4d `asOf`; size ≤ 256 KB |
| V26 | Every pair a project can occupy is present (`pathwayStages`). Every T3 in-flight project's (pathway, stage) has a cell. Every cell passes the §4.4 rejection checks |
| V27 | **Reproduction.** For every Transition, 100,000 seeded `sampleTransition` draws (from m = 0) give an empirical cumulative incidence, by `monthsIn(0, days) + 1`, within **0.005** of the table at every month for advance and each exit reason, and the eventual shares within 0.005 |
| V28 | Initiation back-cast total is within 2% for each detection basis (live mode only) |
| V29 | Determinism: two in-run computations are byte-identical |

**V27 and the purge rule under pooled tables** (round 3, re-checked).
- **V27 still holds.** It tests sampler-to-table consistency, which does not depend on how a table was estimated. A θ-scaled permit-side table has the same structure as any AJ table: monotone, Σ ≤ 1 (after the step cap), and ρ > 0. A synthetic test (below) checks that scaled tables pass V27, and V26 rejects any that do not.
- **The purge rule still holds.** Detection runs on all qualifying exits over the full record. The pre-2015 permit era is now included, and so are any historical DBI batch expirations in it. The trailing 365-day baseline adapts to each era's exit volume. Because censoring is applied once, in normalisation (step 6), both the pooled component and every pathway's 2015+ component see the same censored spells, so O and E in θ are consistent. The report lists purge windows from every era.

**`docs/dev/pipeline.md` update** (round 2; owned here).
- The Invariants paragraph's range "V1 to V14" grows to cover the new invariants. project-records edits the V20–V24 part, and stage-calibration appends this sentence:

  > V25 `calibration.json` parses (`parseCalibration`), its `asOf` matches `projects.json`, and it is ≤ 256 KB; V26 every occupiable pathway × stage table is present; V27 sampling reproduces each table's cumulative incidence within 0.005; V28 the initiation back-cast total is within 2% of observed filings; V29 calibration is deterministic. Method constants live in `pipeline/lib/fzp-cal/` (`LIVE_CAL`, `FIXTURE_CAL`); the full table is the stage-calibration spec §4.10–4.11.

- The "Where things land" list gains `pipeline/.cache/derived/<datasetVersion>/calibration-report.md` (not uploaded).

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
- non-convergent IRLS;
- live initiation events below the minimum;
- a `parseCalibration` failure of the output.

**Warnings** (in `report.json`): rung-3 cells, the FZP filings band, `storiesGap` imputation counts.

## 5. Seams

- **Policy levers (T9).** Every behavioural number is in `calibration.json`, as plain JSON with `schema: 1`. `parseCalibration` validates any transformed calibration too. Nothing else is done now.
- **Addenda sub-stages.** Spells, the estimator, the ladder, `chanceTable`, `typicalMonths` and the validator all iterate `pathwayStages`/`STAGE_ORDER`, with no per-stage code. A future split edits T2 and the coverage table. Nothing else is done now.
- **DA phasing.** `multiPhase` histories run through the ordinary tables, and the report counts them. Nothing else is done now.
- **Renderings.** Not applicable.

## 6. Testing

**Server project (`npm run test:unit`), `src/lib/timelapse/`**
- `time.test.ts`: `monthsIn` at the boundaries ⌈k·M⌉ − 1 and ⌈k·M⌉; `OPEN_DAY` survives a Float32 round-trip.
- `math.golden.test.ts` (**cross-engine golden**). The fixture is `src/lib/timelapse/fixtures/math-golden.json`. It holds about 200 fixed inputs per function, each paired with the expected IEEE-754 bit pattern as a 16-hex-digit string. The expected patterns are generated once by the C fdlibm reference and committed.
  - **Inputs:** ±0, subnormals, 1, ln2 multiples, the overflow and underflow thresholds, values near 1 for `log`, the logit range [−30, 5], (1 − ρ) for ρ in [1e-6, 0.5], and NaN and ±Infinity.
  - **Check:** the test compares bits through a `DataView` and requires exact equality for every input.
  - **Where it runs:** in the server project (Node/V8) and, as `math.golden.svelte.spec.ts`, in the client project's Playwright Chromium. The client test must also pass under WebKit and Firefox when run with `--browser`.
  - It also asserts that `math.ts` source contains no `Math.exp|Math.log|Math.pow`.
- `model.test.ts`:
  - `parseCalibration` accepts `calibration-small.json` and fixture-0's file, and rejects each rule violation (sum > 1, non-monotone, wrong length, ρ = 0, missing pair, F ≠ 5, missing provenance), with the path in the error.
  - `binIndex` edges and clamping; `initiationHazard` matches the T4a formula.
  - `sampleTransition`: u = 0, u → 1, m ≥ `months`; `monthsIn(0, days) = k − 1`; days ≥ ⌈m·M⌉.
  - `eventualProbabilities` sums to 1.
  - `chanceTable`: hand-computed products along a permitOnly path and a discretionary path; length 241; index 240 equals the tail value.
  - `typicalMonths`: inside the table and in the tail.
- `reproduce.test.ts` (**AC-1**): 200,000 seeded draws from `calibration-small.json` discretionary `permitFiled` give expired by month 12 = 0.10 ± 0.005 and every month within 0.005. Conditional draws from m = 6 match `eventualProbabilities(t, 6)` within 0.005. The tail is geometric.

**Pipeline project (`npm run test:pipeline`), `pipeline/test/fzp-cal/`**
- `aalen-johansen.test.ts`:
  - **golden** hand-computed 7-spell example: 2 advance, 1 withdrawn, 1 expired, 3 censored, a tie of event and censoring, one delayed entry;
  - with no censoring it equals the empirical incidence;
  - all spells censored gives zeros;
  - monotone, Σ ≤ 1.
- `aj-recovery.test.ts` (property): 20,000 synthetic spells from a known Transition, with entries over 2005–2026, censoring at `asOf` and window 2015. The estimate recovers the truth within 0.02 at every month and for the eventual shares. A naive "dead among ended" estimator fails the same check.
- `spells.test.ts`: imputation, running maximum, exit clamp, null pathway and the defensive rule, preApplication pooling, delayed entry.
- `tail.test.ts`, `fallback.test.ts`: the probability formula, extending k₀, rejection; rung selection, a rung-3 median of D, tiers and method text.
- `irls.test.ts`:
  - closed-form log-odds for one binary feature with no ridge;
  - known coefficients recovered from 2M simulated parcel-months within 0.05;
  - full one-hot plus ridge is identifiable;
  - non-convergence throws;
  - shuffled input gives byte-identical output.
- `initiation-panel.test.ts` (DuckDB, hand-made T13 and histories): not at risk while in flight, the event month counted, at risk again after an exit, never after a completion, the primary parcel, the 2025-12 cutoff, panel membership by `hostable_base`, and features read from the columns unchanged (no imputation code path exists).
- `ph-pool.test.ts`:
  - with identical pathway and pooled hazards, θ ≈ 1 and the table equals the pooled one;
  - a pathway with a doubled exit hazard over 2015+ recovers θ_exit within 0.15 at n = 5,000, and its scaled table is within 0.02 of the truth;
  - no 2015+ events gives θ = κ/(E+κ);
  - the step cap engages and is counted;
  - scaled tables pass `parseCalibration` and the V27 check;
  - provenance label and method wording.
- `window.test.ts` (rewritten): Planning-side spells are cut at 2015-01-01; permit-side pooled spells start at 1989-01-01 / 2000-01-01; the coverage guard is on for live and off for fixture.
- `initiation-basis.test.ts`:
  - basis "record" versus "permit" by the F < 2015 rule;
  - a pre-2015 project with no permit gives no event and no coverage;
  - the `basis` coefficient is excluded from the published model;
  - simulated panels with a known basis offset recover the feature coefficients within 0.05;
  - the back-cast holds per basis.
- `phase-gap.test.ts`:
  - DA detection by a `DVA` child, a `PRX` case, and a `multiphase.json` entry;
  - permits under 10 units, superseded refiles and same-day phases are excluded or merged;
  - gaps sorted ascending;
  - the ladder falls back to rung 2 (tier 2) and then to [730] (tier 4).
- `purge.test.ts`:
  - a synthetic history set with background exits plus 40 exits of median duration 1,200 days on 2026-09-15 and 2026-10-01 gives one window [2026-09-15, 2026-10-01];
  - the long-duration exits in it are censored on 2026-09-14, and the short-duration ones stay exits;
  - a burst of 40 short-duration exits is not a purge;
  - the report section lists the window.
- `pathway-ppa.test.ts`, `size.test.ts`, `revision.test.ts`: shares and the fallback; the `ppaShare` window starts 2023-07-08; snapping on the F = 5 grid, r > 1, bucket merge; the two pair types, clamp, pooling.
- `calibration-invariants.test.ts`: V25–V29 pass on fixture-0, and each fails on a corrupted copy.
- `golden.test.ts` (existing): extended to `scenarios/fzp/calibration.json` and the golden `calibration-report.md`.

There are no DOM, e2e or axe tests, because this subsystem has no page and the report is not served. The client project runs only the browser-engine math golden. Every test calls `expect`.

## 7. Acceptance criteria

- **AC-1 ("if 10% die at stage z, ours do too").** For every Transition in the live and fixture calibrations, a seeded simulation of 100,000 entrants through `sampleTransition` recovers the table's cumulative incidence of advance and of each exit reason at every month, and the eventual shares, within 0.005 (V27). `calibration-small.json`'s `permitFiled` gives expired = 0.10 ± 0.005 by month 12.
- **AC-2.** Censored, left-truncated synthetic histories recover a known truth within 0.02.
- **AC-3.** The report and provenance state the refined OD-T3 windows: Planning-side 2015-01-01; permit-side pooled from 1989-01-01 (`permitFiled`) and 2000-01-01 (`permitIssued`, `construction`), with pathway level from 2015. Permit-side provenance says "pooled across pathways before 2015".
- **AC-4.** Every parameter has a tier, label, method and source, plus n and window for tiers 0–2. The report indexes them all.
- **AC-5.** The initiation back-cast total is within 2%. The report shows per-year values, the hold-out, the extrapolation share and the FZP expected filings.
- **AC-6.** `calibration.json` is ≤ 256 KB and byte-identical across in-run repeats and fixture regenerations.
- **AC-7.** No statistics dependency is added, and `model.ts` imports neither Zod nor anything outside `src/lib/timelapse`.
- **AC-8.** `size.fillLevels` equals T11's `FILL_LEVELS` (F = 5).
- **AC-9.** Every pathway × stage pair a project can occupy is present (V26). A live build warns for each rung-3 cell.
- **AC-10.** The worker, renderer, card and pipeline V-check all import T12's functions. A repo search finds no second implementation of the sampling or chance logic.
- **AC-12 (round 3).**
  - Permit-side Transitions are θ-scaled pooled tables, and their provenance says "pooled across pathways before 2015".
  - Initiation is fitted over 2007–2025 with the detection basis stated as tier 2.
  - `phaseGap` has ≥ 10 DA gaps (tier 2) in a live build, or is labelled with its fallback tier.
- **AC-11 (deterministic math).**
  - `math.ts` `exp` and `log` return the committed fdlibm bit patterns for every golden input, on Node and in the browser test engines.
  - No `Math.exp`, `Math.log`, `Math.pow`, `Math.log1p` or `Math.expm1` appears under `src/lib/timelapse/` or `pipeline/lib/fzp-cal/`; the ESLint rule enforces this.
  - Fixed inputs to `sampleTransition`, `initiationHazard`, `chanceTable` and `typicalMonths` give bit-identical outputs across those engines.

## 8. Open questions

None remain from the original spec: the reconciliation answered all three (the window question is now settled by partner rulings round 3, §4.4; `ppaShare` measured after 2023-07-07; Local Program parcels take `streamlined`).

The 16-pair reading of "every pathway × stage pair" is **confirmed** by the orchestrator's clarification in the reconciliation section.
