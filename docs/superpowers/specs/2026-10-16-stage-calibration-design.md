# stage-calibration: design spec

Status: derived 2026-10-16 from [the FZP timelapse composition design](../design/2026-10-16-1903-fzp-timelapse.md) (approved with partner rulings OD-T1..T5). Research inputs: [literature survey](../research/2026-10-16-fzp-calibration-literature.md) and [dataset probe](../research/2026-10-16-sf-stage-datasets.md). Slug `stage-calibration`. It owns T2, T4, T4a, T4b and T4c. It consumes T1, T3 (`asOf`), T4d (from project-records) and T11 plus scenario-data's parcel and assessor tables.

## 1. Scope

From the design:

> **`stage-calibration`** (data pipeline). Builds `scenarios/fzp/calibration.json` from the histories:
> - competing-risks transition tables per pathway and stage, with censoring;
> - the **initiation model**: a discrete-time hazard that a parcel with no project files one in a given month. It is fitted to SF parcel-years using pre-FZP envelopes and features, then applied with FZP envelopes (tier 2);
> - the **size model**: what fraction of the allowed envelope a project proposes, measured from proposed stories against allowed height (tier 0→2);
> - the **revision model**: the chance, timing and magnitude of a change in unit count, measured by comparing the PRJ proposal, the permit's `proposed_units` and the completed units of linked records (tier 0→2).
> Every parameter carries its provenance (T4). **Fitting window (partner ruling OD-T3):** the longest window available across the majority of stages, with no weighting toward recent years. For each stage, take the earliest year with reliable tier-0 coverage. The common window starts at the latest of those years that still keeps a majority of stages fully covered, and ends at the snapshot. A stage whose coverage starts later uses its own span, and its provenance says so. Initiation is fitted over all available parcel-years with no calendar-year term.

**In scope**
- The shared module `src/lib/data/fzp-calibration.ts`. It holds the T2 and T4–T4c types, `STAGE_ORDER`, `MONTH_DAYS`, the Zod schema and `parseCalibration`, and the pure helpers `binIndex`, `initiationHazard`, `eventualProbabilities` and `sampleTransition`. `sampleTransition` is the reference implementation of the T4 sampling semantics. The module lives in `src/lib/data/` because format code there is hashed into `datasetVersion` (`docs/dev/pipeline.md`, "Lock and `datasetVersion`"). It follows the dependency-free codec pattern of `src/lib/data/transit-codec.ts:1-5`.
- The pipeline step `pipeline/steps/calibration.ts` and its libraries under `pipeline/lib/fzp-cal/`: window, spells, the Aalen–Johansen estimator, tails, fallbacks, the initiation panel and IRLS fit, size, revision, pathway mix, provenance and the report writer.
- The outputs `out/<v>/scenarios/fzp/calibration.json` and `out/<v>/scenarios/fzp/calibration-report.md`, the new invariants, the new `report.json` counts and the fixture calibration.
- One line in `pipeline/lib/r2.ts:29-34`: `.md` is stored as `text/markdown; charset=utf-8`.

**Out of scope**
- Producing histories, `projects.json`, the parcel features, `parcels.bin` or the manifest entry. Those belong to project-records and scenario-data (T4d, T3, T11).
- Sampling inside `simulate`, `chanceTable` (T12), and applying revisions and caps. Those belong to timelapse-sim; this spec only provides `sampleTransition`.
- The provenance panel UI (fzp-mode).
- Policy levers (T9), addenda sub-stages and DA phasing (see §5).
- Any runtime computation. Calibration happens only at pipeline build time.

## 2. Interfaces

Verbatim rows this subsystem owns (T2, T4, T4a, T4b, T4c) or consumes (T1, T3, T4d, T11):

| # | interface | owner → consumers | mark |
|---|---|---|---|
| T1 | `type Day = number` is integer days since 1970-01-01 UTC. All schedule times use it. It is exact in Float32 | timelapse-sim → all | DC |
| T2 | `type Stage = 'preApplication' \| 'filed' \| 'entitled' \| 'permitFiled' \| 'permitIssued' \| 'construction' \| 'complete'`; `type Pathway = 'discretionary' \| 'streamlined' \| 'permitOnly'`; `type ExitReason = 'withdrawn' \| 'disapproved' \| 'cancelled' \| 'expired'`. `STAGE_ORDER` lists the stages in this order. `preApplication` is optional on every pathway. `permitOnly` projects never enter `filed` or `entitled`. A ghost is visible from the project's first entered stage | stage-calibration → project-records, timelapse-sim, timelapse-render, fzp-mode | MC (stage sequence and exits follow real records), DC (names) |
| T3 | `interface InFlightProject { id: string /* PRJ record id, else permit number */; parcelIds: ParcelId[]; pathway: Pathway; stage: Stage; history: Partial<Record<Stage, Day>> /* observed entry days */; units: number; existingUnits: number; stories: number \| null; sources: { dataset: string; id: string }[] }`. `scenarios/fzp/projects.json` = `{ schema: 1; asOf: Day; rhnaCompletedNet: { units: number; since: Day; provenance: Provenance }; projects: InFlightProject[] }` | project-records → timelapse-sim, fzp-mode | MC (real pipeline is the starting state), DC (shape) |
| T4 | `interface Provenance { tier: 0 \| 1 \| 2 \| 3 \| 4; label: string; sources: { label: string; url: string }[]; method: string; n?: number; window?: [from: string, to: string] }`. `interface Transition { months: number; advance: number[] /* cumulative incidence by month 1..months */; exit: Partial<Record<ExitReason, number[]>>; tail: { advance: number; exit: Partial<Record<ExitReason, number>> } /* constant monthly hazards beyond months */; provenance: Provenance }`. `scenarios/fzp/calibration.json` = `{ schema: 1; asOf: Day; transitions: Record<Pathway, Partial<Record<Exclude<Stage, 'complete'>, Transition>>>; initiation: InitiationModel; pathwayForNew: Record<Pathway, number> & { provenance: Provenance }; size: SizeModel; revision: RevisionModel }`. The calibration also carries `ppaShare: Record<Pathway, number> & { provenance: Provenance }`, the share of new projects that start at `preApplication`. `InitiationModel`, `SizeModel` and `RevisionModel` are rows T4a–c. Everything is plain JSON, so future policy levers can transform it (the T9 seam). **Sampling semantics:** a project entering stage *s* at day *d* draws one uniform. The month of advance or exit comes from the cumulative tables (`advance` + Σ`exit` ≤ 1 at every month), with the tail hazards beyond `months`. An in-flight project already *m* months into *s* draws conditionally on having survived *m* months. Day within the month is uniform | stage-calibration → timelapse-sim, fzp-mode | MC (every parameter carries tier + source), DC (encoding) |
| T4a | `type FeatureId = 'potentialRatio' /* yield units at envelope ÷ max(existingUnits, 1) */ \| 'existingUnits' \| 'lotAreaM2' \| 'yearBuilt' \| 'storiesGap' /* envelope stories − existing stories */ \| 'improvementShare' /* improvement ÷ (land + improvement) assessed value */ \| 'rentControlLikely' /* 0/1: ≥ 2 units and built < 1979 */ \| 'landUseClass' /* categorical: residential, mixed, commercial, pdr, vacant, other */`. `interface InitiationModel { kind: 'logit-monthly'; intercept: number; terms: { feature: FeatureId; bins: number[] /* ascending edges; categorical features use category index */; coef: number[] /* one per bin */ }[]; provenance: Provenance }`. Monthly hazard = `1 / (1 + exp(−(intercept + Σ coef[bin(feature)])))`. It is fitted on pre-FZP (base) envelopes and evaluated on FZP envelopes. Parcels with an in-flight project are not at risk until that project ends | stage-calibration → timelapse-sim, scenario-data (feature list) | DC |
| T4b | `interface SizeModel { fillLevels: number[] /* ascending fractions of envelope stories; last = 1; length F matches T11 yield */; byEnvelope: { maxStoriesUpTo: number; probs: number[] /* length F, sums to 1 */ }[]; provenance: Provenance }`. A new project proposes `stories = max(1, round(fill × envelope.maxStories))` | stage-calibration → timelapse-sim, scenario-data (F) | DC |
| T4c | `interface RevisionModel { at: { stage: Stage /* applied on entering this stage */; probability: number; ratio: { edges: number[]; probs: number[] } /* histogram of new units ÷ previous units */ }[]; provenance: Provenance }`. No revision on or after `construction`. Upsizing is capped at the parcel's envelope. A revision changes units, and stories follow from the yield table (simulated) or scale proportionally (pipeline) | stage-calibration → timelapse-sim | MC (projects can resize before construction), DC (shape) |
| T4d | `interface ProjectHistory { id: string; pathway: Pathway; parcelIds: ParcelId[]; entered: Partial<Record<Stage, Day>>; end: { kind: 'complete'; day: Day } \| { kind: 'exit'; stage: Stage; reason: ExitReason; day: Day } \| { kind: 'open'; lastObserved: Day }; unitsAt: Partial<Record<Stage, number>> /* proposed units as recorded at each stage */; existingUnits: number; storiesProposed: number \| null; baseStoriesAtFiling: number \| null; sources: { dataset: string; id: string }[] }`. Pipeline-internal: `pipeline/.cache/derived/project-histories.json`, never shipped | project-records → stage-calibration | DC |
| T11 | `scenarios/fzp/parcels.bin` (codec `sfh-scenario/1`, in `src/lib/data/`): per eligible parcel `id`, `labelPoint`, `cellId`, `envelope: Envelope` (FZP Local Program stories), the base (pre-FZP) stories, the T4a feature values (with base-envelope and FZP-envelope variants of `potentialRatio` and `storiesGap`), a `localProgram: boolean` flag (false when the parcel is excluded from the Local Program, in which case `envelope` is the base height) and `yield: Uint16[F]`, the units at each quantised fill level of the envelope. Named in the manifest as `scenarios?: { fzp: { parcels: url; projects: url; calibration: url } }` (amends I12; optional, so older datasets load) | scenario-data → timelapse-sim | DC |

**Internal types and exports** (pipeline-internal unless marked shared; none of them alters a T-row):
- Shared, in `src/lib/data/fzp-calibration.ts`:
  - `MONTH_DAYS = 30.4375` (365.25 ÷ 12). Month *k* of a stage is the duration interval [(k−1)·MONTH_DAYS, k·MONTH_DAYS) days since entry.
  - `EXIT_ORDER: ExitReason[] = ['withdrawn','disapproved','cancelled','expired']`. Outcome order within a month is advance first, then `EXIT_ORDER`.
  - `type Calibration` (the T4 file shape).
  - `binIndex(edges: number[], x: number): number`.
  - `initiationHazard(m: InitiationModel, f: Record<FeatureId, number>): number`.
  - `eventualProbabilities(t: Transition, survivedMonths?: number): { advance: number; exit: Partial<Record<ExitReason, number>> }`.
  - `sampleTransition(t: Transition, u: number, survivedMonths?: number): { month: number; outcome: 'advance' | ExitReason }`.
- `Spell = { pathway: Pathway | null /* null = pathway unknown */; stage: Exclude<Stage,'complete'>; a: number /* delayed-entry duration, days */; x: number /* end duration, days */; outcome: 'advance' | ExitReason | 'censored'; projectId: string }`.
- `CoverageRow = { stage; startYear: number; entryEnd?: string /* ISO date entries stop */; evidence: string }`.
- `CalProfile`: the method thresholds of §4.12, with `LIVE_CAL` and `FIXTURE_CAL` values (the same pattern as `InvariantProfile`, `pipeline/config.ts:44-127`).
- `PanelRow = { parcelId; rollYear; exposureMonths: number; events: number; features: Record<FeatureId, number> }`.
- `FitCell = { bins: number[]; exposure: number; events: number }`.
- File shape note: T4's file literal leaves out `ppaShare` but says "the calibration also carries" it. It is emitted as the top-level key `ppaShare`, after `pathwayForNew`.

### Interface concerns (for the orchestrator)

- **IC-1. T4 does not define a month.** This spec defines `MONTH_DAYS = 30.4375` and the month-*k* interval in the shared module. timelapse-sim and T12 must use the same constant. Calendar months would shift every table.
- **IC-2. Sampling.** T4 owns the sampling semantics, and `sampleTransition` implements them. timelapse-sim should call it, not write its own, so that AC-1 also holds for the simulation.
- **IC-3. T4d has no file envelope or `asOf`.** `asOf` is taken from T3 `projects.json`, and calibration requires every `lastObserved ≤ asOf`. Recommend project-records write `{ asOf: Day; histories: ProjectHistory[] }`.
- **IC-4. T4d requires a `pathway` that is sometimes unknowable.** Two cases: PPA-only records, and permits from before PRJ coverage (2015) with no PRJ link. §4.2 rules 4–5 work around this. An explicit "pathway unknown" marker would be cleaner.
- **IC-5. No T-row covers the scenario-data inputs.** These are `fzp_parcel` (including `yield_base_units` at fill 1) and `assessor_lot_year` for **all roll years 2007..latest**. scenario-data's `wv5m-vpq2` source must fetch every roll year, not only the latest. The feature formulas (§4.6.1) must live in one shared `pipeline/sql/fzp/features.sql`. Recommend adding a T11a pipeline-internal row.
- **IC-6. Blind spot on density decontrol (important).** If `potentialRatio` under the base envelope is a height-only yield, the fit cannot see pre-FZP density caps such as RH-1 = 1 unit and RH-2 = 2. Yet 77% of FZP-affected parcels get density decontrol only, with no height change (literature §1). For them, the base and FZP features would be identical, and the model would predict no FZP effect. Recommend that scenario-data cap `yield_base_units` at the pre-FZP density limit of the parcel's zoning district. Also confirm that the `base` in `h9wh-cg3m` is the pre-FZP height and not a revised FZP base.
- **IC-7. `landUseClass` source.** It is defined here from assessor use and class codes, which avoids leakage. scenario-data must compute T11's values the same way, not from the 2023 land-use survey (`fdfd-xptc`).
- **IC-8. One population.** The qualifying predicate is new construction with net units ≥ 1. It should also define which projects go into `projects.json` (T3). Otherwise the tables are applied to a different population from the one they were fitted on.
- **IC-9. PRJs closed without a decision.** The probe found 1,394 of 1,729 PRJs (5+ units, opened 2014–2020) "Closed" with no decision. Whether project-records reads these as exits, advances or censoring drives filed-stage attrition directly. The rule needs to be explicit in their spec.
- **IC-10. T4c revisions.** A project's first stage has no earlier proposal (for example permitOnly's `permitFiled`), so timelapse-sim must skip an `at` entry for the project's first stage. Separately, the change between permit and completion is placed on entering `permitIssued` (§4.9).
- **IC-11. Content type for `.md`.**
  - The route maps content types by extension and has no `md` entry (`src/routes/data/[version]/[...path]/+server.ts:5-11`).
  - The local R2 loader stores no type (`scripts/r2-put-local.ts`).
  - So the report would be served as octet-stream.
  - The route needs `md: 'text/markdown; charset=utf-8'`, which changes the data-serving contract (`docs/dev/data-serving.md:38`). That needs the owner's sign-off.
- **IC-12. Invariant numbering.** project-records, scenario-data and stage-calibration all add invariants, and `InvariantResult.id` is `V${number}` (`pipeline/steps/check.ts:13`). V20–V24 are provisional. The orchestrator should allocate the numbers.
- **IC-13. Mini fixture.** scenario-data's mini assessor source needs at least two roll years.
- **IC-14. Completion dating.** The design's `complete` date (TCO/CFC, else `completed_date`) mixes sources: TCO data exists only from 2018, and `completed_date` falls later. This biases pre-2018 construction durations upward. It is reported as a diagnostic and not corrected.

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
- **The editor is unchanged.** `/` and `/p/:id` behave exactly as before. FZP mode is additive.
- **Accessibility.** WCAG 2.2 AA as in `docs/dev/accessibility.md`. The scrubber is a labelled slider: arrow keys step a month, Page Up/Down a year. Reduced motion stops autoplay, but scrubbing still works.

## 4. Behaviour

### 4.1 Placement in the build

`build()` (`pipeline/steps/build.ts:116-233`) gains one timed step, `calibration`. It runs after the project-records and scenario-data steps and before `buildManifest` (`build.ts:181`). It reads:
- the in-memory histories that project-records also caches at `pipeline/.cache/derived/project-histories.json` (T4d);
- `asOf` from the T3 object project-records writes;
- the DuckDB tables listed in §4.6.1.

It writes the two files in §4.11. It never fetches anything. `fixture` runs it with `FIXTURE_CAL` (§4.13). There is no new CLI command.

No statistics dependency is added. Aalen–Johansen is a single sorted sweep (§4.4), and the logit fit is IRLS with a dense Cholesky solve of about 60 parameters (§4.6.5). Both are under 150 lines of TypeScript.

### 4.2 Population and history normalisation

**Qualifying project.** A T4d history qualifies when its first recorded units, `unitsAt` at its first entered stage, minus `existingUnits` is **≥ 1 net unit**. T4d holds new-construction projects only. Net ≥ 1 is chosen over ≥ 2 because a 1-unit house replaced by a 2-unit building (net +1) is the core FZP "plex" case, and the scoreboard counts net units. The same predicate defines the transition cohort, the initiation event, `pathwayForNew`, `ppaShare`, size and revision. Histories that do not qualify are dropped, and the drop is counted.

**Normalisation.** These steps are applied in order. Each adjustment is counted in `report.json` under `calibration.adjust.*`.
1. **Imputation of skipped stages.** On the history's pathway path (see the stage sequence in T2), a stage that is missing but has a later stage present gets the next present stage's day. This preserves incidence, since an advance is never dropped. Its cost is a bias toward zero-duration spells, which is reported per stage.
2. **Running maximum.** Effective entry day `eff[s]` is the maximum of the observed entry days of `s` and of every earlier entered stage in `STAGE_ORDER`. Example: a site permit filed before Planning approval enters `permitFiled` on the approval day, which gives a zero-duration `entitled` spell.
3. **Exit reconciliation.** An exit is applied at the last entered stage. Its day is clamped to `≥ eff[last]`.
4. **Pathway unknown.** A `permitOnly` history whose `eff.permitFiled` is before the `filed` coverage start (§4.3, 2015-01-01) gets `pathway = null`. Before Planning's PRJ records are complete, a missing PRJ link does not prove there was no entitlement.
5. **`preApplication` ignores pathway.** A PPA that never led to a PRJ has no knowable pathway, so every preApplication spell is pooled.

Tables are **project-weighted**: one spell per project per stage. Unit-weighted eventual shares appear in the report only as a diagnostic.

### 4.3 Fitting window (OD-T3, exact)

**Coverage table.** This is a configured constant in `pipeline/lib/fzp-cal/window.ts`, with each row's evidence from the 2026-10-16 probes (verified, URLs in §4.14). A stage's coverage year is the earliest year in which every input of its per-pathway table is reliably recorded: the entry date, the dates of the end events, and the pathway classification.

| stage | startYear | binding input | evidence (verified 2026-10-16) |
|---|---|---|---|
| preApplication | 2011 | PPA records, `y673-d69b` | 754 PPA records, first 2011-02-11; **entries stop 2023-07-07** (`entryEnd`) |
| filed | 2015 | PRJ `open_date` with unit fields, `qvu5-m3a2` | PRJs with net units ≥ 1 per year: 71 (2013), 158 (2014), 398 (2015), then 586, 634, … |
| entitled | 2015 | approval dates, `d4jk-jw33` | approvals per year: 3 (2013), 182 (2014), 1,328 (2015), then 1,456, … |
| permitFiled | 2015 | pathway classification (PRJ link) | permit `filed_date` exists from 1981, but pathway cannot be identified before PRJ coverage |
| permitIssued | 2015 | pathway classification | `first_construction_document_date` exists from 2000 |
| construction | 2015 | pathway classification | TCO/CFC (`j67f-aayr`) from 2018; permit `completed_date` from 1983 is used as the fallback (design stage table) |

**Rule.** Let *c₍₁₎ ≤ … ≤ c₍₆₎* be the six coverage years in ascending order, and let the majority be *m* = ⌊6/2⌋ + 1 = 4. The common start is **W = 1 January of c₍ₘ₎**. This is the earliest start year that still covers a majority of the stages, so it gives the longest such window. Every stage with `startYear ≤ c₍ₘ₎` uses [W, asOf]. A stage with a later `startYear` uses [1 January of its `startYear`, asOf], and its provenance `method` says "own span: coverage starts <year> (common window starts <W>)". With today's table, W = 2015-01-01 and every stage uses [2015-01-01, asOf]. There is no recency weighting.

**Guards.** For each stage and each calendar year from `startYear` to the last complete year, the build counts the stage entries in the qualifying cohort. If any year has zero entries, the build fails (`CalibrationError: coverage gap <stage> <year>`), because that means a source broke. The counts table is written to the report. `entryEnd` (preApplication) does not truncate the transition: those spells are followed to `asOf`. It does bound the `ppaShare` window (§4.7).

**Recorded.** Every Transition's `provenance.window` is its [start, asOf] as ISO dates. The report reprints the coverage table, the sorted years, *m*, W and each stage's span.

### 4.4 Competing-risks estimator (Aalen–Johansen)

**Spells.** For each normalised history and each entered non-terminal stage *s* on its path:
- entry day *e* = `eff[s]`;
- end day *z* = `eff[next entered stage]` with outcome `advance`; or the exit day with its reason; or `min(lastObserved, asOf)` with outcome `censored`.

For the stage's window [Wₛ, asOf], the spell is kept iff *z* ≥ Wₛ and *e* < asOf. Then *a* = max(0, Wₛ − *e*) is the delayed entry (left truncation for spells that entered before the window), and *x* = *z* − *e*. All values are integer days (T1).

**Estimator.** For each (pathway, stage) cell, process the distinct event durations *d* in ascending order:

```
n(d)   = #{ i : aᵢ ≤ d ≤ xᵢ }                          // at risk; events precede censoring at ties
e_j(d) = #{ i : xᵢ = d, outcomeᵢ = j },  e(d) = Σ_j e_j(d)
F_j   += S · e_j(d) / n(d)                             // S is the survival just before d
S     *= 1 − e(d) / n(d)
```

The order is S₀ = 1 and F_j = 0, then all reasons at *d* are applied before S is updated. `n(d)` comes from two sorted arrays: #(aᵢ ≤ d) − #(xᵢ < d). The table value is **`advance[k−1]` = F_advance after every event with *d* < k·MONTH_DAYS**, and the same for each exit reason.

**Table length.** `months` = the largest *k* ≤ `K_MAX` such that n(k·MONTH_DAYS) ≥ `N_RISK_MIN`. An exit reason with no events in either the table or the tail is omitted, since `exit` is `Partial`.

**Tail.** Let the span start at k₀ = max(1, months − `TAIL_SPAN` + 1), and move k₀ earlier until the span contains ≥ `TAIL_MIN_EVENTS` events (or k₀ = 1). The span runs from (k₀−1)·MONTH_DAYS to the end of observation, past `months`. Then:
- person-months *E* = Σᵢ |[max(aᵢ, (k₀−1)·MONTH_DAYS), xᵢ]| ÷ MONTH_DAYS;
- λ_j = events_j ÷ *E*, and λ = Σλ_j;
- tail p_j = (λ_j/λ)(1 − e^{−λ}). This is the exact monthly probability under constant competing hazards.

**Rounding and guarantees.**
- Table values are **floored** to 1e-6. Flooring keeps them monotone and keeps `advance + Σexit ≤ 1`.
- Tail values are rounded to 6 significant digits.
- A cell is rejected, and falls to §4.5, unless both of these hold: S at `months` ≥ 1e-6, and Σ tail > 0. The second means every project eventually resolves.

**Eventual probabilities.** `eventualProbabilities(t, m)` returns P(eventually *j*) given survival to month *m*: (F_j(∞) − F_j(m)) ÷ S(m), where F_j(∞) = F_j(K) + S(K)·p_j/Σp. The report uses it, `ppaShare` uses it, and T12 can use it.

**`sampleTransition(t, u, m=0)`** is the reference implementation of the T4 sampling semantics:
- Inputs: u ∈ [0, 1).
- Let C(k) = advance[k−1] + Σ exit[k−1] for 1 ≤ k ≤ K, with C(0) = 0. For k > K, C(k) = 1 − (1 − C(K))(1 − ρ)^{k−K}, where ρ = Σ tail.
- The target is c = C(m) + (1 − C(m))·u.
- The event month is the least *k* > *m* with C(k) > c. In the tail it is found in closed form with `Math.log`.
- The outcome is the first entry, in the order advance then `EXIT_ORDER`, whose running sum from C(k−1) over that month's increments exceeds c. Table months use the increments of F_j. Tail months split the month's mass in proportion p_j/ρ.

`month` counts from stage entry. The day within the month is left to the caller (T4: uniform). timelapse-sim should call this function rather than re-implement it (see Interface concerns).

### 4.5 Minimum-n fallback ladder

Each (pathway, stage) cell takes the first rung that passes. A rung passes when the cell has spells ≥ `N_SPELLS_MIN` and events ≥ `N_EVENTS_MIN` in the window, and §4.4's guarantees hold.

1. **Pathway-specific AJ.** Tier 0. Provenance method: "Aalen–Johansen cumulative incidence, right-censored at last observation, left-truncated at window start; tail: constant hazards over months k₀+ (extrapolation)".
2. **Pooled AJ.** All pathways plus pathway-unknown spells for that stage, copied into the cell. Tier 2 (an inference that the pathways share the table), method "pooled across pathways". `preApplication` always uses this rung (§4.2), and its label says so.
3. **Literature synthetic.** A constant-hazard table with `months = 1`:
   - q = 1 − 2^{−1/D}, so the median time to any event is D months;
   - `advance[0]` = A·q and `exit_j[0]` = E_j·q;
   - the tail is A·q and E_j·q;
   - the exit shares E_j = (1 − A) × the stage's observed exit-reason shares across all spells in the window if any exits are observed (tier 2), else all of it on the stage's primary reason (tier 4);
   - the transition tier is the worst (highest) tier among D, A and E.

| stage | D (months), tier, source | A (eventual advance), tier, source | primary exit (tier 4) |
|---|---|---|---|
| preApplication | 6 — tier 3, lit. §4/§7 "0–12 mo" midpoint | 0.862 — tier 2, 650 of 754 PPA records have a parent PRJ (probe 2026-10-16) | withdrawn |
| filed | discretionary 17.2 (523-day average, 2022 APR, via HCD SF review) — tier 1; streamlined 3.42 (SB 35 median, HCD) — tier 1 | 0.82 — tier 1, Housing Element pipeline conversion "PL filed" (unit-weighted) | withdrawn |
| entitled | 12 — **tier 4** | 0.66 — tier 1, HE conversion "PL approved" | expired |
| permitFiled | 19.9 (605-day average, 2022 APR) — tier 1 | 0.70 — tier 1, HE conversion "BP filed" | expired |
| permitIssued | 3 ("usually within 90 days", 2025 Housing Inventory) — tier 1 | 0.74 — tier 2, probe cohort 196 of 266 issued reached a first construction document (uncensored) | expired |
| construction | 21.7 (US 20+ units, Census/NAHB 2025) — tier 3 | 0.98 — **tier 4** | cancelled |

Averages stand in for medians where no median is published, and the method text says so. With live data, rung 3 is expected to fire nowhere. The report lists every cell and its rung, and the build warns for each rung-3 cell.

### 4.6 Initiation model (T4a)

#### 4.6.1 Inputs (from scenario-data; see Interface concerns)

- `fzp_parcel` has one row per T11 parcel: `parcel_id`, `lot_area_m2` (= `ParcelRecord.areaM2`), `base_stories`, `fzp_stories`, `yield_base_units` and `yield_fzp_units` (the generator's yield at fill 1 of each envelope), and the T11 feature values for FZP application.
- `assessor_lot_year` has one row per parcel × closed roll year 2007..latest, built from `wv5m-vpq2` (verified: roll years 2007–2025, about 200k rows per year). Its columns are aggregated to the map lot: `units` Σ, `stories` max, `year_built` = minimum non-zero (0 if none), `land_value` Σ, `impr_value` Σ, and `use_class` (below).

**Feature definitions.** These are authoritative: scenario-data must compute T11's values with the same SQL macros, `pipeline/sql/fzp/features.sql`. Each is evaluated for roll year Y.

| FeatureId | definition |
|---|---|
| `potentialRatio` | `yield_<env>_units ÷ max(units_Y, 1)` |
| `existingUnits` | `units_Y` |
| `lotAreaM2` | `lot_area_m2` |
| `yearBuilt` | `year_built_Y` (0 = unknown) |
| `storiesGap` | `<env>_stories − stories_Y` (if `stories_Y` is null, use `round(existingHeightM / 3.1)`, 3.1 = `SQL_VARS.floors_m`, `pipeline/config.ts:12`) |
| `improvementShare` | `impr ÷ (land + impr)`; −1 when the sum is 0 or null |
| `rentControlLikely` | 1 iff `units_Y ≥ 2` and `0 < year_built_Y < 1979` |
| `landUseClass` | 0 residential, 1 mixed, 2 commercial, 3 pdr, 4 vacant, 5 other (rules below) |

`<env>` is base for the historical panel and FZP for application.

**`landUseClass` rules.** Every assessor row of the lot has a `property_class_code` starting with `V` → vacant. Otherwise:
- any `MISC` row, or both residential (`SRES`, `MRES`) and commercial (`COMM`, `COMR`, `COMO`, `COMH`) rows → mixed;
- residential only → residential;
- commercial only → commercial;
- `IND` → pdr;
- anything else → other.

The use codes were verified on roll 2025: SRES, MRES, MISC, COMM, COMR, IND, COMO, COMH, GOVT; the vacant class codes are V, VR, VCI, VA15, VPUB, VG, VSP, VRX. Assessor roll features are used rather than the 2023 land-use survey, because a later snapshot would leak the redevelopment outcome into the features.

#### 4.6.2 Panel, at-risk set and event

- **Months.** Calendar months 2015-01 through 2025-12. The start is event coverage: the earliest year in which `filed`, `permitFiled` and `preApplication` entries are all recorded, which is W. The end is the last full month on pre-FZP zoning (the FZP took effect 2026-01-12). Months in roll year Y use roll Y's features. A parcel-year with no roll row is excluded and counted.
- **Parcels.** The T11 parcel set (FZP-eligible).
- **Event.** For each qualifying history, the event month is the month of `min(entered.preApplication, entered.filed, entered.permitFiled)`. The event is assigned to the history's **primary parcel**: the largest `lot_area_m2` among its `parcelIds`, ties broken by the smaller id. This matches the simulation, which starts one project per triggering parcel.
- **At risk.** A parcel-month is at risk unless a qualifying history covers the parcel (any of its `parcelIds`) from the month after its first record through its end month: complete or exit day, or `asOf` if still open. The event month itself is at risk with event = 1. The parcel is at risk again from the month after the project ends. This matches T4a: "not at risk until that project ends".
- **Rows.** SQL emits one `PanelRow` per parcel-year (at-risk months and events in that year) in `ORDER BY parcel_id, roll_year`.

#### 4.6.3 Bins

Bin edges are tier 4 (binning choice). `binIndex(edges, x)` = (the number of edges ≤ x) − 1, clamped to [0, len−1]. Bin *i* is [edges[i], edges[i+1]), and the last bin is open above. Initial edges:

| feature | edges |
|---|---|
| potentialRatio | 0, 1, 1.5, 2, 3, 5, 10, 20 |
| existingUnits | 0, 1, 2, 3, 5, 10, 20, 50 |
| lotAreaM2 | 0, 150, 250, 400, 800, 2000, 5000 |
| yearBuilt | 0 (unknown), 1800, 1906, 1930, 1950, 1979, 2000 |
| storiesGap | −100, 0, 1, 2, 3, 5, 10 |
| improvementShare | −1 (unknown), 0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85 |
| rentControlLikely | 0, 1 (categorical) |
| landUseClass | 0, 1, 2, 3, 4, 5 (categorical) |

**Merge rule.** Before fitting, a numeric feature's highest bin with fewer than `MIN_BIN_EVENTS` events is merged into the bin below. This repeats until every bin qualifies or one bin is left. The merge then runs upward from the bottom. A categorical bin with too few events keeps its own coefficient, which ridge shrinks. The published `bins` are the merged edges.

#### 4.6.4 Extrapolation

FZP values above the top edge fall in the top bin (the clamp), so the top bin's historical hazard is used. The report states:
- the share of FZP parcels, and of FZP expected events, whose `potentialRatio` or `storiesGap` exceeds the **maximum at-risk value observed in the panel**;
- that for those parcels the hazard is "tier 2, applied beyond historical support (top-bin clamp)". The clamp probably understates the FZP response.

`provenance.method` repeats the share. The tier stays 2 and is not relabelled.

#### 4.6.5 Fit

1. Rows are binned in TypeScript with the shared `binIndex`, so the worker and the pipeline bin identically.
2. Rows are aggregated into `FitCell`s keyed by the bin tuple and sorted lexicographically.
3. The model is a binomial logit on (events, exposure): one Bernoulli trial per parcel-month. That is the discrete-time hazard likelihood exactly.
4. The design is the intercept plus full one-hot bins, with ridge penalty ½·`RIDGE_LAMBDA`·Σβ² on the bin coefficients (not the intercept). Ridge makes the one-hot design identifiable.
5. IRLS starts from intercept = logit(Σevents/Σexposure) and bin coefficients = 0. Each step solves (XᵀWX + Λ)Δ = score by Cholesky.
6. It stops when max|Δ| < 1e-9, with at most 100 iterations. Failure to converge is a `CalibrationError` in live mode.
7. Coefficients are rounded to 6 significant digits.

#### 4.6.6 Back-cast validation

For each year 2015–2025, predicted filings = Σ over at-risk parcel-months of the hazard; the report puts them beside observed filings.

- **Gate (invariant):** predicted total within 2% of observed total. With an unpenalised intercept the score equation makes this nearly exact, so a failure means a bug.
- **Report only:**
  - per-year ratios (no calendar term, so market cycles show);
  - per-bin observed and predicted;
  - a temporal hold-out: fit 2015–2022, then predict 2023–2025;
  - FZP application: expected filings per year = 12·Σ hazard over T11 parcels without an in-flight project, compared with the 2015–2025 historical mean. The build warns if the ratio is outside [0.5, 20] (a tier-4 sanity band).

#### 4.6.7 Fallback

The initiation model falls back if the panel has fewer than `INIT_MIN_EVENTS` events. In live mode that fails the build instead, because a fallback there would hide a broken join. The fallback has `terms = []` and intercept = logit(1 − 0.98^{1/120}). The source is the observed decade rate in Housing Element Appendix B: 2% of parcels with existing units were approved for 2+ net units in a decade. It is labelled **tier 1**.

### 4.7 `pathwayForNew` and `ppaShare`

- **`pathwayForNew`.** Among qualifying histories with a known pathway whose first record falls in [W, asOf], each pathway's share of projects. Tier 0, window [W, asOf].
  - If fewer than `N_SPELLS_MIN` such histories exist, the fallback is the pathway mix of T3 in-flight projects (tier 0, "current pipeline mix").
  - The report also prints the shares since 2026-01-12 (Local Program era) and since 2024-01-01 (SB 423) for comparison. They are not used (OD-T3).
- **`ppaShare[p]`.** The window is [max(W, PPA start), `entryEnd` = 2023-07-07]. In it, measure *f*ₚ = the share of pathway-*p* filers (first non-PPA entry in the window) whose history has a preApplication entry before that filing.
  - PPA-only projects have no pathway, so their effect enters through the pooled preApplication table. Let *w* = 1 − `eventualProbabilities(T_pre).advance`.
  - The share of new projects starting at preApplication, which reproduces *f*ₚ among filers once the simulated cohort passes through T_pre, is **sₚ = fₚ ÷ ((1−w)(1−fₚ) + fₚ)**.
  - Tier 2 (it combines two measurements). The window is stated in provenance.
  - If fewer than `N_SPELLS_MIN` filers exist, sₚ = 0, tier 4, labelled "not measured".

### 4.8 SizeModel (T4b)

- **Fill levels.** `fillLevels` = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1], so **F = 8**. scenario-data's yield table must use these exact fractions.
- **Measurement.** Use qualifying histories with first record in [W, asOf] and both `storiesProposed` and `baseStoriesAtFiling` non-null and ≥ 1. Compute r = storiesProposed ÷ baseStoriesAtFiling. Snap r to the nearest fill level, with ties going up. r > 1 (density bonus) maps to 1, and the share with r > 1 is reported.
- **Buckets.** Initial `maxStoriesUpTo` edges are 4, 6, 8, 12, 999 (999 is the sentinel for "any"; tier 4 binning). A history goes to the first bucket with baseStoriesAtFiling ≤ edge.
  - A bucket with fewer than `SIZE_MIN_N` histories merges into the next lower bucket, or the next higher bucket for the first one.
  - `probs` are empirical shares, rounded to 6 decimals, with the residual added to the largest share so the sum is exactly 1 within 1e-9.
  - T4b says the timelapse-sim applies a bucket to the FZP envelope's `maxStories`.
- **Tier.** 2. Fallback when total n < `SIZE_MIN_N`: a point mass at fill 1, tier 3 (the Housing Element site-yield method assumes the full envelope).

### 4.9 RevisionModel (T4c)

- **Pairs.** One per qualifying history and stage. Each pair has a previous count and a new count:

  | `at.stage` | previous count | new count |
  |---|---|---|
  | `entitled` | `unitsAt.filed` | `unitsAt.entitled` |
  | `permitFiled` | the latest known of `unitsAt.entitled` and `unitsAt.filed` | `unitsAt.permitFiled` |
  | `permitIssued` | `unitsAt.permitFiled` | `unitsAt.complete` (completed projects only) |

  The `permitIssued` row exists because T4c forbids revisions on or after construction. A change between the permit and completion is therefore placed on entering `permitIssued`. That is a tier-2 attribution, and `method` says so.
- **Measurement.** A pair counts when both counts are ≥ 1 and the new stage was entered in [W, asOf]. A revision means the counts differ. `probability` = revised ÷ pairs. Among revised pairs, the ratio new ÷ previous is clamped to [0.25, 3] and binned with `edges` = [0.25, 0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3] (tier 4 binning). `probs` has length `edges.length − 1`. Within a bin, sampling is uniform: this is the stated semantics for timelapse-sim.
- **Fallback.** A stage with fewer than `REV_MIN_N` pairs uses all pairs pooled (tier 2, "pooled across stages"). If the pooled pairs are also fewer than `REV_MIN_N`, `probability` = 0 (tier 4, "no revision evidence"). The `at` entries are always in the order entitled, permitFiled, permitIssued.

### 4.10 Provenance

Every Transition, `initiation`, `size`, `revision`, `pathwayForNew` and `ppaShare` carries a T4 `Provenance`:
- `tier`;
- `label`, short and readable, e.g. "SF permit & Planning records 2015–2026 (tier 0)";
- `sources`: DataSF pages `https://data.sf.gov/d/<id>` for tier 0–2, or the literature URLs from the research doc for tier 1/3;
- `method`, naming the estimator, the rung, the imputation counts and any own-span note;
- `n` (projects, spells or pairs; for initiation, events, with exposure given in `method`);
- `window` as [ISO from, ISO to].

`n` and `window` are mandatory for tiers 0–2. A tier-3/4 component inside a rung-3 table is named in `method`, e.g. "D = 12 mo (tier 4, made up)".

### 4.11 Outputs, determinism, invariants

**`scenarios/fzp/calibration.json`**
- `schema: 1`, `asOf` = T3 `asOf`.
- `transitions` covers exactly the applicable cells: discretionary and streamlined have all six non-terminal stages; permitOnly has preApplication, permitFiled, permitIssued and construction.
- Keys are emitted in T4 order, with `STAGE_ORDER` and pathway order `['discretionary','streamlined','permitOnly']`.
- `JSON.stringify` with no whitespace.
- Expected size is 40–120 KB. Hard limit **256 KB raw** (tier 4 budget). The worker loads it once (first-paint constraint).

**`scenarios/fzp/calibration-report.md`** is deterministic: no wall-clock times, and only dates from `asOf` and the data. Its sections:
1. a header with the dataset version and `asOf`;
2. the window rule (coverage table, sorted years, majority, W, per-stage spans);
3. a per-pathway table of every Transition: rung, tier, n spells, events, window, `months`, eventual advance and exit shares (project- and unit-weighted), median months to advance, and imputation counts;
4. the construction-duration diagnostic for completions dated by TCO/CFC (2018+) versus by `completed_date`;
5. initiation: bins with exposure, events and coefficient; the back-cast table; the extrapolation share; the FZP expected filings;
6. size and revision tables;
7. `pathwayForNew` (with era comparisons) and `ppaShare` (with *f*, *w*, *s*);
8. a parameter index listing every parameter with its tier and source;
9. method constants (§4.12) with their tiers.

fzp-mode may link it as `/data/<v>/scenarios/fzp/calibration-report.md`.

**Determinism**
- Every input set is sorted before use: spells by (pathway, stage, projectId), panel rows by key.
- Floating-point sums run in that fixed order.
- No randomness, except the build-time reproduction check, which uses the seeded PRNG `mulberry32(0x5eed)`.
- The step runs twice in-run and the two outputs must be byte-identical.

**`report.json` counts** (added under `calibration.*`): `histories`, `qualifying`, `adjust.imputed.<stage>`, `adjust.runningMax`, `adjust.exitClamped`, `pathwayUnknown`, `spells.<pathway>.<stage>`, `rung3`, `panel.parcelYears`, `panel.exposureMonths`, `panel.events`, `bytes`.

**Invariants.** Provisional numbers V20–V24; see the concern about numbering. All run in `build` and `check`.

| id | check |
|---|---|
| V20 | `calibration.json` parses with `CalibrationSchema`; `asOf` equals `projects.json` `asOf`; size ≤ 256 KB |
| V21 | Every applicable cell is present and none other. Arrays have length `months`, are non-decreasing and lie in [0, 1]. `advance + Σexit` ≤ 1 at every month and ≤ 1 − 1e-6 at `months`. Tail values are ≥ 0, with 0 < Σ ≤ 1. Every in-flight project's (pathway, stage) has a cell. Size, revision, `pathwayForNew` and `ppaShare` probabilities sum to 1 (or lie in [0, 1]) within 1e-9. `fillLevels.length` equals T11's F |
| V22 | Provenance is complete as §4.10 requires |
| V23 | **Reproduction**: for every Transition, 100,000 draws of `sampleTransition` give an empirical cumulative incidence within **0.005** of the table at every month and for the eventual shares (§6, AC-1) |
| V24 | Initiation back-cast total is within 2%; determinism (two runs byte-identical) |

### 4.12 Method constants

These are tier 4 unless noted. Every row is printed in the report.

| constant | LIVE | FIXTURE |
|---|---|---|
| `N_SPELLS_MIN` / `N_EVENTS_MIN` | 30 / 20 | 3 / 2 |
| `N_RISK_MIN` (table length) | 20 | 2 |
| `K_MAX` (months) | 240 | 240 |
| `TAIL_SPAN` / `TAIL_MIN_EVENTS` | 24 / 5 | 24 / 1 |
| `MIN_BIN_EVENTS` | 10 | 1 |
| `RIDGE_LAMBDA` | 1.0 | 1.0 |
| `INIT_MIN_EVENTS` | 100 (else fail) | 1 (else fallback) |
| `SIZE_MIN_N` / `REV_MIN_N` | 30 / 30 | 2 / 2 |
| reproduction tolerance (V23) | 0.005 at N = 100k (about 4.5 standard errors at p = 0.5) | same |

`MONTH_DAYS` is definitional and has no tier.

### 4.13 Fixture calibration

- **fixture-0.** `pipeline fixture` runs the step with `FIXTURE_CAL` on the mini histories from project-records' mini sources and the mini assessor rolls from scenario-data's mini sources. The mini rolls must hold **at least two roll years** for the 14 parcels; see concerns. That writes `e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json` and `calibration-report.md`. Both are added to the golden set (`pipeline/steps/fixture.ts:25-31`, via the `scenarios` directory). Rung 3 and the initiation fallback are expected to fire here, which exercises them end to end.
- **Hand-made unit fixture.** `src/lib/data/fixtures/fzp-calibration-small.json` is a schema-valid calibration with round numbers, labelled tier 4 "test fixture". It has these properties:
  - discretionary `permitFiled`, `months` = 12: `advance` rises linearly to 0.60 and `exit.expired` to **0.10** by month 12, tail advance 0.05, tail expired 0.01;
  - every other cell is a constant-hazard table;
  - initiation has one term (`potentialRatio`, edges [0, 2, 5], coefficients [0, 0.5, 1]);
  - F = 8.

  timelapse-sim and fzp-mode unit tests import it.

### 4.14 Error states

`CalibrationError` aborts `build`, so nothing is uploaded. It fires on:
- a coverage gap (§4.3);
- missing or mismatched `asOf`;
- non-convergent IRLS;
- live-mode initiation events below `INIT_MIN_EVENTS`;
- an applicable cell where even rung 3 cannot be built (impossible unless the table in §4.5 is edited).

Warnings, which go to `report.json` `warnings`, fire on: rung-3 cells, the FZP filings sanity band, and an empty Local Program-era sample.

Probe URLs (verified 2026-10-16), base `https://data.sf.gov/resource/`:
- `y673-d69b.json?$select=max(open_date),min(open_date),count(*)&$where=record_type='PPA'`
- `qvu5-m3a2.json?$select=date_extract_y(open_date) as y,count(*)&$where=number_of_units_net>=1&$group=y`
- `d4jk-jw33.json?$select=date_extract_y(end_event_date) as y,count(*)&$where=project_stage='accepted to approved' AND end_event_type='approval'&$group=y`
- `i98e-djp9.json?…date_extract_y(filed_date|first_construction_document_date|completed_date|status_date)…`
- `j67f-aayr.json?$select=date_extract_y(date_issued)…`
- `wv5m-vpq2.json?$select=closed_roll_year,count(*)&$group=closed_roll_year`

## 5. Seams

- **Policy levers (T9).** Every behavioural number is in `calibration.json` as plain JSON. Nothing is baked into other artifacts. The schema carries `schema: 1`. This spec adds nothing else: no lever fields and no provenance-override field.
- **Addenda sub-stages.** Spell building, the estimator, the fallback ladder and V21's applicability come from `STAGE_ORDER` and the pathway paths. They are not hard-coded per stage. A future split edits T2 and the coverage table only. Nothing else is done now.
- **DA phasing.** Multi-phase projects run through the ordinary tables. The report prints the count of histories whose `sources` contain a DA case. Nothing else is done.
- **Renderings.** Not applicable.

## 6. Testing

**Pipeline project (`npm run test:pipeline`, `pipeline/test/fzp-cal/`)**
- `aalen-johansen.test.ts`
  - **Golden:** hand-computed 7-spell example (2 advance, 1 withdrawn, 1 expired, 3 censored, one tie of an event and a censoring on the same day, one delayed entry), with exact F and S at each event time.
  - With no censoring, AJ equals the empirical cumulative incidence.
  - All spells censored gives zeros.
  - Monotone, and Σ ≤ 1.
- `aj-recovery.test.ts` (property). From a known ground-truth Transition, generate 20,000 spells with entries uniform over 2005–2026, administrative censoring at `asOf`, window 2015, and therefore left truncation. The estimate recovers the truth within 0.02 at every month and for the eventual shares. A naive "share dead among spells ended" estimator fails the same check, which shows the test is sensitive.
- `reproduce.test.ts`: **"10% die at stage z"** (AC-1).
  - The fixture `permitFiled` table has `exit.expired[11] = 0.10`. 200,000 seeded `sampleTransition` draws give an empirical expired-by-month-12 of 0.10 ± 0.005, and every month matches within 0.005.
  - With `survivedMonths = 6`, the conditional shares match `eventualProbabilities(t, 6)` within 0.005.
  - The tail region matches the geometric tail.
- `window.test.ts`: the OD-T3 rule.
  - Today's table gives W = 2015-01-01.
  - The synthetic table [2000, 2001, 2002, 2003, 2010, 2012] gives W = 2003, and the 2010 and 2012 stages use their own spans with the own-span method text.
  - Ties are handled.
  - A coverage-gap year throws.
- `spells.test.ts`: imputation, running max (site permit filed before approval), exit clamp, the pathway-unknown rule, preApplication pooling, window filtering and delayed entry.
- `tail.test.ts`: the probability formula, extending k₀ until 5 events are reached, and rejection when Σ tail = 0.
- `fallback.test.ts`: rungs 1 → 2 → 3 are chosen by thresholds; the median of a rung-3 table equals D; tiers and method text are correct.
- `irls.test.ts`:
  - one binary feature, no ridge: matches the closed-form log-odds;
  - recovers known coefficients from 2M simulated parcel-months within 0.05;
  - ridge identifiability with full one-hot;
  - non-convergence throws;
  - shuffled input gives byte-identical output.
- `bins.test.ts`: `binIndex` edges and clamping; the merge rule.
- `initiation-panel.test.ts` (DuckDB, hand-made tables): not at risk during an in-flight project, the event month counted, the primary parcel of a multi-parcel project, roll-year features, the 2025-12 cutoff, and the `landUseClass` rules.
- `pathway-ppa.test.ts`: `pathwayForNew` shares. For `ppaShare`, simulating a cohort with *s* through T_pre reproduces *f* within 0.005.
- `size.test.ts`, `revision.test.ts`: snapping, r > 1, bucket merge, sums to 1; the three pair types, clamping, pooling fallback.
- `calibration-invariants.test.ts`: V20–V24 pass on fixture-0, and each fails on a corrupted copy (sum > 1, non-monotone, missing provenance, wrong length, Σ tail = 0, F mismatch).
- `golden.test.ts` (existing): extended to `scenarios/fzp/calibration.json` and `calibration-report.md`.

**Server project (`npm run test:unit`)**
- `src/lib/data/fzp-calibration.test.ts`: the schema accepts `fzp-calibration-small.json` and fixture-0's file and rejects each V21 violation; `binIndex`; `initiationHazard` matches the T4a formula; `sampleTransition` boundaries (u = 0, u → 1, m beyond `months`); `eventualProbabilities` sums to 1.

**e2e (Playwright)**
- `data-route.spec.ts` (extended): `GET /data/fixture-0/scenarios/fzp/calibration.json` returns 200 `application/json`, and `…/calibration-report.md` returns 200 `text/markdown`. The second needs the route mapping; see concerns.

No client or DOM tests, and no axe gate: this subsystem has no page. Every test calls `expect`.

## 7. Acceptance criteria

- **AC-1 ("if 10% die at stage z, ours do too").** For every Transition in the live and fixture calibrations, a seeded simulation of 100,000 entrants through `sampleTransition` recovers the table's cumulative incidence of advance and of every exit reason at every month 1..`months`, and the eventual shares, within 0.005 (V23). The fixture's `permitFiled` cell recovers expired = 0.10 ± 0.005 by month 12.
- **AC-2.** The estimator recovers a known ground truth from censored, left-truncated synthetic histories within 0.02 (`aj-recovery.test.ts`).
- **AC-3.** The report and every Transition's provenance state the OD-T3 coverage table, majority, W and spans. With today's sources, W = 2015-01-01.
- **AC-4.** Every parameter in `calibration.json` has a tier, label, method and at least one source; tiers 0–2 also have n and window (V22). The report's parameter index lists each one.
- **AC-5.** The initiation back-cast total is within 2% of observed filings. The report shows per-year back-casts, the hold-out, the extrapolation share and the FZP expected filings.
- **AC-6.** `calibration.json` is ≤ 256 KB and byte-identical across two in-run builds and across fixture regenerations (golden).
- **AC-7.** No statistics dependency is added to `package.json`.
- **AC-8.** `fillLevels.length` = 8, and it equals T11's yield length (V21).
- **AC-9.** A live build with no rung-3 cell for any (pathway, stage) where the window holds ≥ 30 spells. Rung-3 cells are listed as warnings.

## 8. Open questions

1. **Should the permit-stage coverage ignore pathway identifiability?** If the permit-stage tables were pooled before 2015, the coverage years would be 1981, 2000, 2000, 2011, 2015, 2015. That gives W = 2011. *Recommend no.* The design asks for separate per-pathway tables "where the data can separate them", and pathway is only knowable from 2015. Pre-2015 permits still alive in 2015 enter the pooled tables through left truncation.
2. **`ppaShare` after July 2023.** The PPA record type stops on 2023-07-07, when PPAs became optional. Real post-2023 projects therefore never show a preApplication stage. *Recommend* the measured 2015–2023 share (the design's rule), with the window in provenance. A T9 lever can set it to 0 later.
3. **`pathwayForNew` under the Local Program.** The 2015–2026 shares understate streamlined filings under the FZP. *Recommend* keeping the full-window shares (OD-T3), printing the Local Program-era share beside them, and leaving any shift to a T9 lever.
