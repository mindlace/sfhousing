# Pipeline massing: subsystem spec

Status: derived from [the FZP timelapse design](../design/2026-10-16-1903-fzp-timelapse.md) (approved with partner rulings, 2026-10-16). Owner of T10. Implemented and merged (`fzp/pipeline-massing` a6530f3..7de1c74, merged into `superconductor/fzp-timelapse` @ 1e53d6c). Revised 2026-10-17 to the design's Reappraisal 1 (DQ-1..DQ-4, IA-1..IA-28). For this spec the revision is doc debt only: the text now describes the accepted as-built behaviour (ledger A14 and the pipeline-massing final review). No behaviour changes.

## 1. Scope

From the design (verbatim):

> **`pipeline-massing`** (typology generator). Adds `generateForUnits(parcel, units, maxStories, seed, stories?)` (T10). It inverts the existing generator to mass a real project from its unit count and, where known, its stories. It also supports multi-parcel projects by massing on the union of their parcels. `GeneratedBuilding.source` widens to `'user' | 'pipeline' | 'scenario'`, which design-doc I9 already reserved.


**In scope**

- `generateForUnits` (T10) in `src/lib/generator/units.ts`, exported from `src/lib/generator/index.ts`. That covers: the inverse search over stories and typology; scaling the footprint down when the target is smaller than the lot's massing; the approximate-massing rule; and the null rules.
- Assembling multi-parcel sites in `src/lib/generator/assemble.ts`: re-framing parcels into one local frame without transcendental functions, polygon union, and seam healing.
- Widening `GeneratedBuilding.source` (T10 amends I9), with the change to its only exhaustive consumer, `colorFor` (`src/lib/map/palette.ts:103-110`).
- Helpers that derive "massing approximate" from a T10 result without a new field: `massedUnits`, `massingApproximate`, `unitsTolerance`.
- A per-call performance budget, plus unit, property, golden and perf tests.

**Out of scope**

- Choosing which projects get massed, when, how often, and memoising the results. That is `timelapse-sim`. ~~Unphased multi-phase rows are not massed.~~ Superseded 2026-10-19: masters without phases are massed on their free DA parcels, usually as districts ([large-site massing](2026-10-19-large-site-massing-design.md) §4.7). Phase sub-projects are massed like any pipeline project (timelapse-sim §4.8).
- Stamping `source: 'scenario'` on simulated projects' buildings. T5 assigns this to the sim.
- Ghost, stage and colour rendering, and per-slot packing. That is `timelapse-render`.
- The yield table in `parcels.bin` (T11). That is `scenario-data`, using the existing `generate`.
- Parsing stories or units out of records. That is `project-records`.
- Real footprints and renderings (R10).
- DA phasing logic: splitting rows into phases, phase counts, and gaps. DA phasing itself is in scope for this package (reconciliation round 4, N6), but timelapse-sim and project-records own it. This subsystem only masses each phase sub-project: one `generateForUnits` call on that phase's parcels and units.
- Any change to `generate` (I8), its outputs, or the editor (`/`, `/p/:id`).

## 2. Interfaces

### Owned (verbatim)

| # | interface | owner → consumers | mark |
|---|---|---|---|
| T10 | `GeneratedBuilding.source: 'user' \| 'pipeline' \| 'scenario'` (amends I9). `generateForUnits(parcel: ParcelRecord \| ParcelRecord[], units: number, maxStories: number, seed: number, stories?: number, opts?: DistrictOpts): GeneratedBuilding \| null`, where `DistrictOpts = { storyLimit?: number; curatedStories?: number; openSpaceShare?: number }` (amended 2026-10-19 by [large-site massing](2026-10-19-large-site-massing-design.md) §4.5; ignored on sites under `DISTRICT_MIN_M2`) | pipeline-massing → timelapse-sim, map-view | DC |

### Consumed (verbatim, from the source design)

| # | interface | owner → consumers | mark |
|---|---|---|---|
| I6 | `interface ParcelRecord { id: ParcelId; polygon: [x: number, y: number][][] /* local metres, exactly EPSG:7131 (NAD83(2011) / San Francisco CS13, metres), origin at label point */; labelPoint: [lng, lat]; areaM2: number; existingUnits: number; existingFloorAreaM2: number; existingHeightM: number; landUse: string; eligible: boolean; neighborhood: string }` | data-pipeline → plan-model, generator, scoreboard | DC |
| I8 | `generate(parcel: ParcelRecord, env: Envelope, seed: number, mode: BuildoutMode): GeneratedBuilding \| null`. Returns `null` for a replacement when its floor area ≤ `existingFloorAreaM2` **or** its units ≤ `existingUnits`: nobody rebuilds smaller or to fewer homes. (An `adu` keeps the existing building and is exempt) | generator → map-view, scoreboard | DC |
| I9 | `interface GeneratedBuilding { parcelId: ParcelId; source: 'user'; /* widens to 'pipeline' \| 'scenario' later */ typology: TypologyId; parts: { footprint: [lng, lat][] /* single outer ring; parcel holes dropped in M1 */; baseM: number; topM: number }[] /* nested: each part's footprint ⊆ the part below; rendered ground-to-topM */; stories: number; units: number; floorAreaM2: number; replacesExisting: boolean }` | generator → map-view, scoreboard | DC |
| I10 | `type TypologyId = 'adu' \| 'plex' \| 'walkup' \| 'podium' \| 'midrise' \| 'tower'` | generator | DC |
| I14 | Seed: `seed = fnv1a32(parcelId)`. Variety is a pure function of parcel and envelope, so the same plan always renders identically for everyone | generator | DC |

The code's `GeneratedBuilding` (`src/lib/generator/types.ts:11-27`) also carries `composition`, `role` and `tone`, which the source-design I9 row lacks. This is source-design doc debt (N18). This spec follows the code.

### Internal types and functions (new; they alter no T- or I-row)

- `massedUnits(b: GeneratedBuilding): number` = `unitsFor(b.typology, b.floorAreaM2)`: the units the drawn volume holds under the generator's rules.
- `unitsTolerance(units: number): number` = `Math.max(1, Math.round(0.1 * units))`.
- `massingApproximate(b: GeneratedBuilding): boolean` = `Math.abs(massedUnits(b) − b.units) > unitsTolerance(b.units)`. This is always `false` for `source: 'user'`, because there `units` is computed from `floorAreaM2`. It is also `false` for a `generateForUnits` result with `units` 1 and `massedUnits` 0 (|0 − 1| ≤ 1); §4.9 states what consumers do with that case.
- `frameOffset(from: [lng, lat], to: [lng, lat]): [x: number, y: number]`: the EPSG:7131 grid position of `to` in the local frame whose origin is `from`, in metres (§4.2).
- `generateForUnitsWith(parcels, units, maxStories, draws: VarietyDraws, compositionDraws: CompositionDraws, stories?)`: a test seam, in the same pattern as `generateWith` (`generate.ts:174-182`).
- `massingCandidates(site, U, draws, bound: { stories } | { maxStories })` and `withinTolerance(massed, U)`: test seams exported from `units.ts` only (not from `index.ts`). `massingCandidates` returns the §4.3 candidates with their capacities, which P1–P3 and the perf fixture use for `c_min`/`c_max`. `withinTolerance` is the §4.4 acceptance test.
- `assembleSite(parcels)` in `assemble.ts`: §4.2 steps 4–6, returning `{ anchor, polygon }` or `null`.
- `massTypology` and `referenceComposition` gain an optional last argument `opts?: { coverageScale?: number; fallbackStories?: number }`. When it is omitted, behaviour is byte-identical to today: scale 1, and fall back to midrise at 12 (`massing.ts:181`, `compositions.ts:53`).

`massedUnits`, `massingApproximate` and `unitsTolerance` are exported from `src/lib/generator/index.ts` with exactly these signatures. All three are pure and total:

- `export function unitsTolerance(units: number): number`
- `export function massingApproximate(b: GeneratedBuilding): boolean`
- `export function massedUnits(b: GeneratedBuilding): number`

timelapse-sim owns the card's `massing` rule (its §4.9) and builds it on these helpers. This spec does not restate that rule, but §4.9 below states the producer obligations it must honour (the `massedUnits === 0` case, the memo key and the anchor).

The other functions are internal.

## 3. Global constraints

Copied verbatim from the design.

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

### 4.1 Contract summary

- **Units come from the record.** The result's `units` always equals `U = Math.floor(units)`, the caller's number. The massing only draws a volume for those units. `floorAreaM2` is the drawn volume's area. Scores (T8) count schedule/record units (tier 0) and never `massedUnits`.
- **`source` is `'pipeline'`** on every result. Per T5, the sim re-stamps simulated projects' buildings as `'scenario'`. `replacesExisting` is always `true`: the result is never an `adu`, which matches T3 ("new construction only").
- **`parcelId`** is the anchor parcel (§4.2). Callers that need every parcel use `Schedule.parcelIds`.
- **`stories`**: if a valid `stories` is given, the result's `stories` equals `Math.floor(stories)` exactly (§4.4). Otherwise it is the story count the search chose.
- **No I8 null rule.** A real project may be smaller than what it replaces, in floor area or in units. `existingUnits`, `existingFloorAreaM2`, `existingHeightM`, `landUse` and `eligible` are **ignored**: the record is ground truth (tier 0) over the generator's "nobody rebuilds smaller" assumption.
- **Data quality (T14).** This subsystem is runtime code, not a pipeline step, so it registers no T14 rule and rewrites no source value. Its input rules (§4.2: invalid `stories` treated as absent; bad `labelPoint` records dropped) choose what to draw from values the caller passes; they never change a record or a counted number. Values the pipeline's rules changed reach it already carrying their `quality` ids on T3; the massing does not read `quality`.
- **Never throws on data.** A Clipper exception means a bug. `timelapse-sim` catches it the way `createGeneratorCache` does (`cache.ts:35-41`): log once per project and treat the result as `null`.

### 4.2 Input normalisation and multi-parcel sites

Steps run in order. The first failure returns `null`.

1. **Units.** If `units` is not finite → `null`. `U = Math.floor(units)`. If `U < 1` → `null`.
2. **Stories.** A given `stories` is *valid* when it is finite and `1 ≤ Math.floor(stories) ≤ MAX_STORIES` (80, `constants.ts:27`). An invalid `stories` is treated as absent, not clamped. DBI's `number_of_proposed_stories` holds junk such as 300, 670 and 920 on old permits (verified by live query of `i98e-djp9`, 2026-10-16), and clamping a 920 to 80 would draw a spurious tower. If `stories` is absent, `maxStories` must be finite with `Math.floor(maxStories) ≥ 1`, or the result is `null`. Then `Smax = Math.min(Math.floor(maxStories), MAX_STORIES)`. If `stories` is valid, `maxStories` is not read (the record wins). The reconciliation rules that `generateForUnits` caps at `MAX_STORIES` when stories are unknown. So `timelapse-sim` passes `maxStories = MAX_STORIES` for pipeline projects whose `stories` is null, and the `min` keeps 80 as the hard cap for any caller.
3. **Seed.** `seed = seed >>> 0`. The draws are `drawVariety(seed)` and `drawComposition(seed)`, exactly as `generate` uses them (`generate.ts:192`).
4. **Parcels.** Wrap a single record in an array. Drop records whose `labelPoint` is not two finite numbers (the same test as `generate.ts:59-61`). De-duplicate by `id` and sort by `id` ascending, so the output does not depend on input order. If none remain → `null`.
5. **Anchor.** The record with the largest `areaM2`, ties broken by the smallest `id`. Its `labelPoint` is the output frame's origin, and its `id` is the output `parcelId`. This matches the slot's pick parcel and the failed-massing footprint parcel (both the largest `areaM2`) in reconciliation round 2. It is deliberately not the cell-placement parcel: timelapse-sim places the slot in the cell of the smallest `ParcelId`. Callers must not assume `b.parcelId` equals that cell-placement parcel.
6. **Site polygon.**
   - **One parcel:** its `polygon` is used unchanged. The site is therefore exactly the one `generate` builds, which property P7 relies on.
   - **Several parcels:**
     1. Re-frame each record's rings by adding `frameOffset(anchor.labelPoint, record.labelPoint)` to every vertex.
     2. Resolve each record's own rings with `unionD(rings, FillRule.EvenOdd)`. This is the existing rule (`site.ts:84`): it does not trust ring orientation.
     3. Union all the resolved records with `FillRule.NonZero` at `CLIPPER_PRECISION` (cm).
     4. Heal the seams with a morphological closing: `inset(inset(U, −SIMPLIFY_EPS_M), +SIMPLIFY_EPS_M)` (an outset, then an inset of 0.10 m, miter joins). This bridges gaps narrower than 0.20 m. The closing applies whenever more than one record survives step 4, even if only one of them has usable rings; the polygon can then differ from the single-record path by about an ulp or a mitred corner (final review, Minor 5, accepted). P7's parity with `generate` is claimed for single-record input only.
   - **Why closing is needed.** The pipeline quantises every ring to centimetres relative to its own origin (`pipeline/lib/rings.ts:7`). Neighbouring parcels' shared edges can therefore disagree by about 1 cm per axis, plus the frame-offset error (below). 0.10 m is the existing `SIMPLIFY_EPS_M` (tier 4, typology-generator §4.1), reused rather than introducing a new number.
7. **Site.** `normaliseSite(polygon, draws.edgeInsetM)` (`site.ts:66`).
   - If the union has several components (non-adjacent parcels, e.g. across a street), only the largest is massed, as for multipart parcels (`site.ts:86-90`). The reconciliation ("Massing") confirms this. The others get no geometry, and the units are not split.
   - **District exception (2026-10-19).** When the union's area summed over all its components is at least `DISTRICT_MIN_M2` (2 ha), the site is a district: every component of at least `LOT_MIN_M2` is laid out in streets and lots and massed lot by lot, not just the largest ([large-site massing](2026-10-19-large-site-massing-design.md) §4.1, §4.3). Below the threshold this step is unchanged and byte-identical.
   - A non-project parcel enclosed by the assembly becomes an exclusion (a hole). The existing `fitSimpleRegions` handles it.
   - The edge inset applies to the union's outline only, so the massing spans the internal lot lines.
   - `null` site → `null`.

**`frameOffset`, and why no new pipeline data is needed.** I6 polygons are exactly EPSG:7131 minus the projected label point. The label point is rounded to 1e-7° and then projected back (`pipeline/sql/10_parcels.sql:44-50`), and rings are `geom − (x0, y0)` (`pipeline/steps/chunks.ts:60`). So the offset between two parcels' frames is the 7131 grid difference between their label points, and `labelPoint` (I6) is enough. The pipeline must provide only that T3 `parcelIds` are current mapblklots present in the dataset's chunks. T3 now states this: "current mapblklot, mapped through retired-parcel lineage".

`frameOffset` evaluates the same tangent-plane formula as `localFrame(from).from(...to)` (`geo.ts:32-36`): grid convergence γ, GRS80 `M` and `N` at `from`'s latitude. It uses only `+ − × ÷` and `Math.sqrt`, so it is bit-identical in every engine. This keeps typology-generator §4.3 and the AC4 guard (`determinism.spec.ts:7-9`), since multi-parcel offsets feed floor area:

- `sin φ` and `cos φ` come from literal `sin 37.75°` and `cos 37.75°` with a third-order expansion in δ = (φ − 37.75)·π/180. Across SF, |δ| ≤ 0.0016 rad, so the truncation error is ≤ 3e-13.
- `cos γ` and `sin γ` come from second- and third-order series (|γ| ≤ 0.0013 rad).
- `W^1.5` is computed as `W·√W`.

Accuracy: it agrees with `localFrame` to ≤ 1e-6 m. Against exact EPSG:7131 (proj4), it is within ≤ 0.02 m up to 200 m and ≤ 0.05 m up to 500 m. That is the existing §4.10 budget, and the error grows with the square of distance. There is no cap on assembly extent: beyond 500 m the error keeps growing but stays far below the healing distance for adjacent lots.

### 4.3 Typology for a story count

- **`promote(t, U)`:** if `t.typology` is `plex` and `U > PLEX_MAX_UNITS` (4), use `walkup` at the same story count. `walkup` is the uncapped low-rise typology (coverage 0.70, 70 m² units). This is a modelling rule built on existing OD-7 constants, with no new number. Otherwise `t` is returned unchanged.
- **Unknown stories:** for each `S` in `1..Smax`, take `promote(selectTypology(S, site.A, 0), U)` (`select.ts:7-26`). Passing `existingUnits = 0` means `adu` is never selected. The lot-area cap chain applies, so the typical buildings of the editor's model are the candidates. Each candidate's reference is `referenceComposition(site, typ, s, draws)`, with the standard midrise-12 tower fallback. Candidates are de-duplicated by the reference's resulting `(typology, stories)`.
- **Known stories `S`:**
  - Let `t = selectTypology(S, site.A, 0)`. If `t.stories === S`, use `promote(t, U)`.
  - Otherwise the cap chain would cut the record's height, so use the uncapped typology for `S`: `S ≥ 13` → `tower` if `A ≥ 1500`, else `midrise`; `8–12` → `midrise`; `5–7` → `podium`.
  - The reference uses `fallbackStories: S`, so a tower whose plate does not fit becomes a midrise of `S` stories, not 12.
  - If that reference is `null`, try `walkup` at `S`. If that is also `null`, the result is `null`.
  - Rationale: stated stories are tier 0. The cap chain's lot-area thresholds are modelling assumptions for "max buildout", not physical limits. A real 8-story building on a 25×100 ft lot must not be drawn as 5 stories next to a card that says 8.

### 4.4 Choosing the massing

Each candidate `c` has a capacity `cap(c) = unitsFor(ref.typology, round1(occupiedArea(ref.bands)))` (`bands.ts:81-87`).

1. **Matched:** if some candidate has `|cap − U| ≤ unitsTolerance(U)`, choose the one with the smallest `|cap − U|`. Ties go to fewer stories, then to the earlier typology in I10 order.
2. **Overshoot:** otherwise, if some candidate has `cap > U`, choose the one with the fewest stories among them.
3. **Undershoot:** otherwise, choose the candidate with the largest `cap`, ties to fewer stories.

The known-stories path has one candidate, and the same three cases apply to it.

**Massed units and acceptance.** An option's massed units are `unitsFor(typology, round1(area))`, where `area` is the area `serializeComposition` reports for the serialised parts. A candidate's `cap` is measured on the reference bands, so the two can differ by one unit (1e-7° rounding and repair insets; see "Known limitations"). An option is *within tolerance* when its massed units are ≥ 1 **and** within `unitsTolerance(U)` of `U` (`withinTolerance`, `units.ts:145-147`). An option that holds no unit (massed < 1) never counts as within tolerance, as in `generate`, which skips buildings of fewer than 1 unit (ledger ruling, PM progress "U = 1").

**Composition (k = 1).** This is the same loop as `generateDetailed` (`generate.ts:89-107`), with the same draws, except that the `gains`/anchor logic and the N6/N7 checks (`generate.ts:113-156`) are removed.

- Walk `compositionOptions(site, ref, compositionDraws)` in family order. Skip a candidate when `serializeComposition` returns `null` or no parts, or when a non-simple family fails `retainsCapacityAcrossHeights`.
- Accept the first remaining option that is within tolerance.
- If none qualifies, the **k = 1 fallback** is the remaining option with the smallest `|massed − U|`, ties to family order. Options with massed < 1 are skipped while any remaining option holds ≥ 1 unit. If every remaining option masses < 1, the closest of them is the fallback. There may be no fallback at all (no option serialised).
  - On case 3 (undershoot) the fallback is the result. This is §4.4's former "most massed units" whenever no family exceeds `U`; when a family masses far above `U` (one tower family massed 520 against `U` 410, 27% over the record), the family closest to `U` is drawn instead (ledger ruling, final-review "closest family on undershoot").
  - On case 1 or 2, go to scaling. This includes case 1 drifting out of tolerance (in either direction) and the case where no k = 1 option serialised.
- If neither the fallback nor scaling yields an option, the result is `null` (see "Known limitations").

**Footprint scaling (k < 1).** This runs only for cases 1 and 2, when no k = 1 option is within tolerance. It never runs on case 3.

- The reference is rebuilt as **its own typology and stories** (`ref.typology`, `ref.stories`), with the candidate's own `opts` (for known stories, `fallbackStories: S`) plus `coverageScale: k`. A tower that fell back to midrise is therefore rebuilt as that midrise at k, not from the tower inputs: rebuilt from the tower inputs, a smaller plate fits again at k < 1 and every scaled reference would become a tower, a typology change that counts as too small (ledger A14, "fallen-back reference scaled as its own typology").
- The base-footprint target becomes `k·COVERAGE[typ]·A` (`massing.ts:133`). For a tower, the plate area becomes `k·min(TOWER_PLATE_MAX_M2, TOWER_COVERAGE·A)`.
- Bisection on `k ∈ (0, 1)`: start `lo = 0`, `hi = 1`; each step evaluates `k = (lo + hi)/2`, for at most 20 iterations (internal numerical setting). It searches for the smallest `k` whose massed units are ≥ `U`. During the bisection massed units are measured on the scaled reference's bands (`cap`).
  - A scaled reference counts as too small (`lo = k`) when it is `null` (pieces under 10 m², a strip failing the 1.5 m width test, a tower plate under `MIN_TOWER_PLATE_M2`) or when its typology differs from the unscaled reference's.
  - Otherwise `massed > U` → `hi = k`; `massed < U` → `lo = k`; `massed = U` stops early.
- The scaled pick is the evaluated `k` with massed ≥ 1 and the smallest `|massed − U|`, ties to the smaller `k`. A scaled reference that holds no unit is never the pick (ledger ruling).
- The pick is serialised (as its own reference). It replaces the k = 1 fallback only when its serialised massed units are ≥ 1 and strictly closer to `U` than the fallback's; with no fallback, it is used if it holds ≥ 1 unit.
- A scaled massing is always composition `'simple'`. Tower recipes re-fit full-size plates (`compositions.ts:180`), so other families are not used. Roof accents follow `capEnabled` as usual.

**Result.** The result has `typology`, `composition`, `parts`, `stories` and `floorAreaM2 = round1(area)` from the chosen massing. `units = U`, `source: 'pipeline'`, `replacesExisting: true`, and `parcelId = anchor.id`. Serialisation goes through `serializeComposition` with a record carrying `anchor.labelPoint` and the assembled polygon, so parts are open CCW lng/lat rings rounded to 1e-7° and the I9 nesting holds.

**Undershoot.** The target does not fit on the site within the story bound. The result is the case-3 candidate (largest `cap`, ties to fewer stories) drawn with the family closest to `U`, and `massingApproximate(b)` is `true` unless a family happens to mass within tolerance. Example (golden G4): 20 units on a 25×100 ft lot with no stories gives a 5-story walkup holding 9 units (computed with golden draws, `golden.spec.ts:53-57`). The card's `massing` value is derived by timelapse-sim (§4.9 of its spec), under the obligations in §4.9 here.

**Known limitations (accepted).** These follow from §4.4's own rules and the fixed algorithm and budget. Items 1 and 2 are pinned by named tests in `units.spec.ts`, so a change to either rule is noticed; item 3 is the stated exclusion of P1–P3 (§6), with parity to `generate` pinned by P7; item 4 has no reachable fixture. They never change a counted number: `units` is always `U`.

1. **±1 serialised-area drift.** A candidate matched on `cap` can serialise one unit short (or over), and scaling only shrinks, so the result can be approximate by one unit beyond tolerance. Pinned: "a matched cap can serialise one unit short (walkup 2, U 5)": case 1 ties walkup 2 (cap 4) and walkup 3 (cap 6) and takes fewer stories; the serialised area is 349.6 m² against bands ≥ 350 m², so it masses 3. About 4 in 45,000 reachable unknown-stories cases (PM progress, Task 6 round 3).
2. **Midrise non-monotonicity under bisection.** `massing.ts` puts midrise upper floors on the footprint inset by the stepback, or on the footprint itself when that inset is under 0.4 of it, so massed units are non-monotone in k (e.g. 80 at k 0.225, 45 at 0.25, 124 at 0.35). The plain bisection can land below `U`. Pinned: "midrise scaling can land below U (U-lot 1171 m², stories 33)": `U` 90 masses 61, where k ≈ 0.23 would hold about 90. About 0.03% of midrise cases (ledger A14).
3. **Null on unserialisable sites.** When the chosen candidate has no composition that serialises and scaling yields nothing, the result is `null`; the next candidate is not tried. This matches `generate` on the same site (e.g. every midrise on a narrow star lot). About 4e-5 of undershoot cases (PM progress, P3 ruling).
4. **Zero-unit volume for U = 1.** When every k = 1 option masses < 1 and scaling yields no pick holding a unit, the result has `massedUnits` 0, and `massingApproximate` is `false` (|0 − 1| ≤ 1). No fixture or probe produced this case (final-fix report, fix 2); §4.9 states how consumers treat it.

**`unitsTolerance` (tier 4, made up, labelled as such).** The reconciliation sets ±10% of units. This spec adds a floor of ±1 unit, so that small projects (U < 10) are not flagged for a one-unit rounding difference. It is a display threshold for "the drawn volume roughly holds the record's units", and it never changes a counted number.

### 4.5 Heights and the 80-story cap

There is no `STORIES_MAX` in the code. The cap is `MAX_STORIES = 80` (`constants.ts:27`), applied by `generate` (`generate.ts:62-64`) and by tower height ranges (`bands.ts:109`).

- **FZP Local Program heights** reach 650 ft (`260//650-R-4`, the maximum over 2,356 Local Program polygons in `h9wh-cg3m`, verified 2026-10-16). By the design's rule that is 65 stories, which is inside 80.
- **The generator handles 65 stories.** `generate` on a 50×60 m lot gives a 65-story tower with 752 units, top 202.9 m before parapet. `referenceComposition` on `lot-3000` gives 754 units at 65 stories and 826 at 72 (local probe, 2026-10-16).
- **The tallest in-flight record seen** is 72 stories (permit `202311170986`, status filed, 672 units; verified live), also inside 80.
- **Base (non-Local-Program) heights** reach 1000 ft (`1000-S-2`), so a T11 envelope can exceed 80 stories. The reconciliation rules that envelopes are clamped to `MAX_STORIES` (80), and `generate` already does this.
- **Drawn height vs the height limit.** Floor-to-floor is 3.1 m with a 4.5 m ground floor, so a 65-story massing is about 666 ft against a 650 ft limit (+2.4%, plus a parapet of up to 1.2 m). The reconciliation accepts this overshoot and asks for it to be documented: it is a visual effect of the tier-3 rule `stories = floor(ft/10)`.

### 4.6 Determinism and the seed contract

- **Pure.** `generateForUnits` depends only on its arguments. The output is bit-identical across engines: §4.2 is transcendental-free, and lng/lat comes from the existing `geo.ts` with rounding to 1e-7°.
- **Seed contract (owner's semantics for T10's `seed`).** Callers pass `seed = fnv1a32(projectId)`, where `projectId` is T3 `id` or the simulated project's id.
  - The seed is independent of the realisation seed and of the revision. A project therefore looks the same in every possible future.
  - Across a revision (T5) the edge inset, stepback, tower slide and family preference stay fixed, so only the size changes.
- **Input order.** Permuting or duplicating `parcel` entries does not change the output.
- **Dataset hash.** Per the reconciliation, `src/lib/generator` joins the dataset-version hash (T11), because the yield table depends on it. Any change to `units.ts` or `assemble.ts` therefore changes `datasetVersion` and triggers `test:pipeline` through `chreode.config.ts` (scenario-data owns that edit). Massing results are not stored in any dataset file.

### 4.7 Performance

Calls run in the simulation worker, with no DOM.

**Budget.** Over the perf fixture (§6), measured in Node on CI after warm-up:

- mean ≤ 0.4 ms per call;
- p99 ≤ 4 ms;
- 2,000 calls ≤ 1,000 ms in total.

**Basis.** Tier 0, measured locally on 2026-10-16 on Apple Silicon against the current generator:

- `generate` averages 24 µs per call;
- a prototype of §4.3–4.4 over 20,000 synthetic lots (without serialisation) ran at p50 0.03 ms, p95 0.21 ms, p99 1.14 ms, max 1.9 ms;
- the CI allowance is about 3×.

**As built.** `units.perf.spec.ts` measured mean 0.068 ms, p99 0.43 ms and total 136 ms alone, and mean 0.087 ms, p99 0.56 ms and total 173 ms inside the full generator run (arm64, 2026-10-17; PM `task-7-report.md`), with 100% non-null. The margin is about 5× on the mean and 6× on the total.

**What this means for `timelapse-sim`.** 1,000 massings cost ≤ 0.4 s. Massing only the projects in loaded chunks, once per revision, fits the 3 s reroll budget. Multi-phase projects add about one call per phase revision in loaded cells. ~~Unphased multi-phase rows add none.~~ Since 2026-10-19 a master without phases adds one call per revision, usually a district costing ≤ 250 ms for the largest real site, memoised by `pipeKey` ([large-site massing](2026-10-19-large-site-massing-design.md) §4.7, §6).

**Internal.** Candidate capacities within one typology may be extrapolated linearly in stories: reference area is affine in stories for every typology (`bands.ts:100-113`). The chosen candidate is always rebuilt directly before output.

### 4.8 `source` widening: every consumer

The whole-repo search for `.source`, `source ===`/`!==` and `'user'` over `src/`, `pipeline/` and `e2e/` (2026-10-16) found exactly one exhaustive switch.

| site | today | change |
|---|---|---|
| `src/lib/generator/types.ts:13` | `source: 'user'` | `source: 'user' \| 'pipeline' \| 'scenario'` |
| `src/lib/generator/generate.ts:159` | sets `'user'` | unchanged |
| `src/lib/map/palette.ts:103-110` `colorFor` | throws for any source other than `'user'`; it has **no production caller**, only `palette.spec.ts` | returns `GEN_RGBA[theme][typology]` for all three sources. It still throws `unsupported source` for any other runtime value. Ghost and stage tints are `timelapse-render`'s. A distinct completed colour per source, if wanted, is that spec's change to make |
| `src/lib/map/palette.spec.ts:53-55` | expects `'pipeline'` to throw | expects `'pipeline'` and `'scenario'` to equal `'user'`, and `'bogus' as never` to throw |
| `golden.spec.ts:50`, test fixtures (`map/test/worst-composition.ts:76`, `scoreboard/score-fixtures.ts:40`, `sim/test/harness.ts:71`, `sim/display.spec.ts:72`) | literal `'user'` | unchanged (still valid) |
| `scoreboard/accumulator.ts`, `sim/host.ts`, `sim/display.ts`, `map/pack.ts` | never read `source` | unchanged |

The editor only ever builds `'user'` buildings, so its behaviour is identical. Map-view spec §seam (line 343) planned "a per-part source byte when a second source exists". This spec adds none: T7's `TimedPackedCell` governs the timelapse layer.

### 4.9 Consumer contract (binds timelapse-sim)

These are part of T10's contract as this subsystem owns it. timelapse-sim's spec carries them too (IA-22); this section is the producer's statement.

1. **`massedUnits(b) === 0` is approximate.** A non-null result can hold no unit when `U` is 1 (§4.4 known limitation 4). `massingApproximate(b)` returns `false` for it, and its formula is fixed (§2). A consumer that labels the massing must therefore treat `massedUnits(b) === 0` as approximate in addition to `massingApproximate(b)`: for the card, a `generateForUnits` result (pipeline projects and phases) gives `'approximate'` when `massingApproximate(b) || massedUnits(b) === 0`, else `'matched'`. A `null` result gives a footprint entry and `'none'`, as timelapse-sim already states.
2. **Memo key.** The output is a pure function of its arguments (§4.6) and independent of parcel order and duplicates (§4.2 step 4). Within one `datasetVersion` (which fixes each parcel record), a result may be memoised on `(seed, units, stories, sorted de-duplicated parcel ids)`. `maxStories` is read only when `stories` is absent or invalid; timelapse-sim always passes `MAX_STORIES` there, so it need not be in the key. A caller that varies `maxStories` adds it to the key.
3. **Anchor.** `b.parcelId` is the massing anchor: the parcel with the largest `areaM2`, ties to the smallest `id` (§4.2 step 5). It is not the cell-placement parcel (the smallest `ParcelId`). Consumers use `Schedule.parcelIds` for every parcel and must not key slots or cells on `b.parcelId`.
4. **`source` stamping.** Every result carries `'pipeline'`. timelapse-sim re-stamps simulated projects' buildings as `'scenario'` (T5).
5. **Exceptions.** The function never throws on data; a thrown Clipper error is a bug, caught and logged once per project as `null` (§4.1).

## 5. Seams

- **T9 policy levers.** Nothing. Levers transform `Calibration`/`ScenarioParcels`, not massing. `generateForUnits` reads the existing `rulesFor` table, so a future lever on coverage or unit size flows through without change.
- **Addenda sub-stages.** Nothing. Massing is stage-independent.
- **DA phasing (in scope, owned by timelapse-sim §4.8).** Each phase sub-project is massed like any pipeline project, with one call on its own parcels (each phase is its own lot, N8) and its own units. This needs no new API. ~~Unphased multi-phase rows are not massed.~~ Superseded: see §1 and [large-site massing](2026-10-19-large-site-massing-design.md) §4.7.
- **Renderings / R10 enrichment.** `stories` already carries stated facts. A future stated footprint or height is a new function. No hook is added now.

## 6. Testing

All in the Vitest **server** project (`src/**/*.spec.ts`), except as marked. Every test calls `expect`.

**Fixtures (new, under `src/lib/generator/fixtures/`)**

- `build-assembly.ts` makes the assembly fixtures. Like `build-golden-seeded.ts`, it projects with proj4, rounds label points to 1e-7° and quantises rings to cm like `pipeline/lib/rings.ts`, so each record has its own origin. It contains no transcendental `Math` (AC4). The fixtures:
  - `assembly-pair.json`: two adjacent 25×100 ft lots.
  - `assembly-row.json`: four adjacent lots, one of them L-shaped.
  - `assembly-street.json`: two lots 20 m apart.
  - `assembly-courtyard.json`: three lots wrapping an excluded fourth.
- `tower-fallback.json`: a lot of A ≥ 1500 m² where `referenceComposition(site, 'tower', 20)` falls back to midrise. The implementer finds it by search and freezes it.
- `pipeline-synth.ts`: a seeded perf/property mix.
  - 1,800 single lots from `synthParcels`, with targets split 60/30/10:
    - 60%: known stories `S ∈ 1..40` and `U ∈ [0.4, 1.0]·cap(S)`;
    - 30%: unknown stories with `U ∈ [c_min, c_max]`;
    - 10%: undershoot, `U > c_max`.
  - 200 assemblies of 2–4 adjacent synthetic lots.

**`units.spec.ts`** (unit + golden; `generateForUnitsWith` with `GOLDEN`/`SIMPLE` draws as in `golden.spec.ts:23-27`, except where a test names a seed for `generateForUnits`)

- Helpers: `unitsTolerance` is `max(1, round(10%))`; a `'user'` building is not approximate and masses to its own units; a unit count far from what the floor area supports is flagged.
- G1: `std-25x100`, U 9, stories 5 → walkup, 5 stories, FA 812.9 ± 2, not approximate.
- G2: `lot-1000`, U 59, stories 6 → podium, FA 4800 ± 2.
- G3 (no I8): `std-over-apartment`, U 3, stories 3 → plex, 3 stories, FA 418.1 ± 2, `replacesExisting` true. `generate` returns `null` here.
- G4 (undershoot): `std-25x100`, U 20, maxStories 80 → walkup 5, `units` 20, `massedUnits` 9, `massingApproximate` true.
- G5 (scaling): `lot-1000`, U 30, stories 6 → podium 6, composition `'simple'`, `massedUnits ∈ [30, 33]`, FA < 4800.
- G6 (promotion): `std-25x100`, U 5, stories 3 → walkup 3 (`massedUnits` 5).
- G7 (uncapped stories): `std-25x100`, U 17, stories 8 → midrise 8.
- G8 (fallback): `tower-fallback`, stories 20 → the candidate's reference is midrise 20; with U = that candidate's `cap`, the result is midrise 20, `units` = cap, not approximate.
- G9 (FZP height): `lot-3000`, U 754, stories 65, `capEnabled` → tower 65; every roof part's `topM` is 202.9 + `parapetM` (rounded to cm).
- Footprint scaling: "scaling only shrinks" (`std`, U 6, stories 5 → walkup 5, massed 6–7, base area below U 9's); a tower scaled below the minimum plate stays a tower 20 (`lot-3000`, U 50, stories 20).
- Fallen-back reference scaled as its own typology (ledger A14): `tower-fallback`, stories 20, U = round(0.4·cap) → midrise 20, `'simple'`, not approximate; and the A 3476 m² L-lot property counterexample (U 286, stories 25, seed 22) → midrise 25, not approximate (the unscaled terrace massed 713).
- Known limitations (§4.4), pinned: "a matched cap can serialise one unit short (walkup 2, U 5)" → walkup 2, `'simple'`, `massedUnits` 3; "midrise scaling can land below U (U-lot 1171 m², stories 33)" → midrise 33, `'simple'`, `massedUnits` 61 for U 90 (seed 3490931901).
- Ledger rulings, pinned: `withinTolerance(0, 1)` and `(0.5, 1)` are false, `(1, 1)` and `(2, 1)` true, `(3, 1)` false, `(18, 20)` true, `(17, 20)` false; a scaled massing holding no unit never replaces the k = 1 fallback (plex 1 for U 1 masses 4, seed 3455185796).
- Undershoot takes the family closest to U: with `familyOrder` terrace, divided, simple on `lot-1000` podium 6, U 58 → terrace (58) and U 100 → simple (59, approximate); on `lot-1200` podium 6, terrace and simple tie at 70 and terrace wins by family order. The tower counterexample (U 410, seed 4220030817) → tower 80 `'paired'` massing 339, approximate, not the offset family's 520.
- Nulls:
  - units `NaN`, 0, 0.9 and `Infinity`;
  - empty array;
  - every parcel with a bad `labelPoint`;
  - `tiny`/`sliver` sites, with and without stories;
  - stories absent with maxStories 0.
- Stories 920 is treated as absent: the result equals the stories-absent result, and its `stories ≤ Smax`.
- A valid `stories` ignores `maxStories` (`NaN` and 0 give the same result).
- Invalid stories are treated as absent and valid ones floored; a finite `maxStories` is required when stories are absent and is capped at 80; a record with a bad label point is dropped.
- `eligible: false` and `existingUnits > U` still return a building.
- `source` is `'pipeline'`; `units === Math.floor(units)` for units 12.7; never an `adu`; the seed is normalised with `>>> 0`.
- A huge undershoot (U 1e9 on `std`) is approximate and takes < 50 ms after warm-up.

**`assemble.spec.ts`**

- `frameOffset` agrees with `localFrame(from).from(...to)` to ≤ 1e-6 m over 1,000 seeded pairs within 2 km in SF's bbox.
- `frameOffset` agrees with proj4 EPSG:7131 differences to ≤ 0.02 m within 200 m and ≤ 0.05 m within 500 m.
- `assembly-pair` → one component, area = Σ`areaM2` ± 0.5 m², and the anchor is the larger lot; with equal areas, the smaller id, in either input order.
- `assembly-row` → one component, domain area = Σ`areaM2` ± 1 m².
- `assembly-street` → two components; `normaliseSite` keeps the larger (area = its `areaM2` ± 0.5 m²); `generateForUnits` parts lie inside that lot.
- `assembly-courtyard` → the excluded lot is a hole; no `generateForUnits` part intersects it (≤ 0.01 m²). The site domain's overlap with the excluded lot is bounded by 0.02 m × that lot's perimeter (realistic per-record cm quantisation; PM progress, Task 3 ruling).
- One record → its polygon unchanged; input order and duplicates do not matter; a malformed member is skipped; records with no usable rings leave an empty polygon; bad label points everywhere and `[]` → `null`.
- `assembly-pair` through `generateForUnits` → `parcelId` is the anchor and the massing spans the lot line.

**`units.property.spec.ts`** (fast-check, `numRuns: 1000`, the arbitraries of `generator.property.spec.ts:36-80`; P1–P3 use `endOnFailure: true` and a 30 s timeout)

P1–P3 exclude `null` results with `fc.pre(b !== null)`: a chosen candidate none of whose compositions serialise returns `null`, exactly as `generate` does on that site (§4.4 known limitation 3). P7 still pins non-null parity with `generate`. P1–P3 are restated from the original claims, which did not hold against §4.4's own measurement rule (ledger A14).

- P1 (reachable, unknown stories): `U` uniform in `[max(5, c_min), c_max]` (U ≥ 5 fixes plex promotion), and `U` inside the capacity range of its own candidates → `!massingApproximate(b) || |massedUnits(b) − U| ≤ unitsTolerance(U) + 1`. The +1 is the ±1 serialised-area drift (§4.4 known limitation 1).
- P2 (reachable, known stories): `S ∈ 1..40`, `U = max(1, round((0.4 + 0.6f)·cap(S)))`, with the candidate's typology unchanged between U 1 and U (promotion) → `stories === S` always; an approximate result has `massedUnits(b) > U` (an overshoot at a §4.4 scaling floor) unless it is a midrise (§4.4 known limitation 2); and approximate results are ≤ 3% of non-null runs. The floors that make P2 approximate are explicit in §4.4: pieces under 10 m² or 1.5 m wide, a tower plate under `MIN_TOWER_PLATE_M2`, plex saturation at `PLEX_MAX_UNITS`.
- P3 (undershoot): precondition `U − c_max > unitsTolerance(U) + 1` (case 3 by construction, beyond the drift) → the result's `(typology, stories)` is the max-`cap` candidate's (ties to fewer stories); `massedUnits(b) ≥ c_max − 1`; `|massedUnits(b) − U| ≤ U − c_max + 1` (the closest family is never farther from U than the largest candidate itself, ±1); and `massingApproximate(b) || composition !== 'simple'` (a non-simple family may mass within tolerance).
- P4 (order): every permutation of each assembly fixture, with and without a duplicate entry, gives `toStrictEqual` output.
- P5 (determinism): two calls give `toStrictEqual` output; seeds `s` and `s + 2³²` give equal output.
- P6 (geometry): every part is a single open ring of ≥ 3 vertices with no repeated consecutive vertex. Each upper occupied part lies inside the occupied parts whose `topM` equals its `baseM`, and every part is inside the site domain (tolerance 0.02 m). These are the same checks as typology-generator §6.
- P7 (editor compatibility):
  - Setup: a vacant parcel (`existingUnits 0`, FA 0), `S ∈ 1..80`, and `b = generate(p, {maxStories: S}, seed, 'max')` non-null.
  - Claim: `generateForUnits(p, b.units, 80, seed, b.stories)` is `toStrictEqual({ ...b, source: 'pipeline' })`.

The 2026-10-16 local prototype's "0 approximate" figures (20,000 P1 and 8,000 P2 cases, measured without serialisation); they do not hold on the property arbitraries and are withdrawn (ledger A14).

**`units.perf.spec.ts`**: over `pipeline-synth(20261016)` (2,000 cases; project `i` has seed `fnv1a32('proj-' + i)`, which also seeds the draws its targets are measured with; assemblies use the same 60/30/10 split), after 200 warm-up calls, asserts the §4.7 budget (mean, p99 by nearest rank, total) and that ≥ 90% of cases are non-null.

**Changed**: `src/lib/map/palette.spec.ts` (§4.8).

**Unchanged and required green**: `golden.spec.ts`, `generator.property.spec.ts`, `generator.perf.spec.ts`, `determinism.spec.ts` (AC4 now also covers `units.ts`/`assemble.ts`), and the full editor e2e suite as the regression gate for "editor unchanged". `generator.property.spec.ts`'s "rotation invariance on the golden fixtures" has a pre-existing flake (fast-check seed −810817726; reproduces on base aad4a6b; ledger "preexisting-code-defect"); it is not a pipeline-massing regression and is owned by typology-generator. The partner ruled a test-only fix: PR #22 (`fix/generator-rotation-flake`), merged to `main` as 34e83ce, allows ±1 unit for `[lot3000, 30]` only, still checks stories and floor area to 0.5%, and pins the counterexample; `golden-seeded.json` and the generator output are unchanged (ledger, "rotationfix COMPLETE" and "main: … #22 → 34e83ce", 2026-10-17).

**`npm run test:pipeline`**: `pipeline/test/assembly.test.ts`. It takes two adjacent parcels from the mini fixture's chunk output, assembles them with `generateForUnits`, and asserts one component with area = the sum ± 0.5 m². This covers the real pipeline's quantisation seam.

**No e2e, axe or client tests.** This subsystem has no UI or page.

## 7. Acceptance criteria

1. `generateForUnits` matches T10's signature and is exported from `src/lib/generator/index.ts`, together with `massedUnits`, `massingApproximate` and `unitsTolerance`.
2. For every non-null result: `units === Math.floor(units)`, `source === 'pipeline'`, `replacesExisting === true`, and `typology !== 'adu'`.
3. With a valid `stories`, the result's `stories === Math.floor(stories)`.
4. No result is `null` because of `existingUnits`, `existingFloorAreaM2`, `landUse` or `eligible`.
5. P1–P7 pass as stated in §6 (P1 within tolerance + 1; P2 stories exact and ≤ 3% approximate; P3 restated). G1–G9 pass.
6. Output is independent of parcel order and duplicates, and is bit-identical across runs. `determinism.spec.ts` passes with the new files.
7. The perf spec meets mean ≤ 0.4 ms, p99 ≤ 4 ms, and 2,000 calls ≤ 1,000 ms on CI.
8. `GeneratedBuilding.source` is `'user' | 'pipeline' | 'scenario'`. `colorFor` returns the typology colour for all three. `npm run check` passes.
9. `generate`, `golden.spec.ts` and the editor e2e suite are unchanged and green.
10. §4.4's rules hold as written: a massing holding no unit never counts as within tolerance; the case-3 fallback is the family closest to `U`; scaling rebuilds a fallen-back reference as its own typology and also runs when no k = 1 option serialised. Each has a named test in `units.spec.ts`.
11. Known limitations 1 and 2 (§4.4) are pinned by named tests, so a change to the drift or the midrise rule fails a test.
12. `unitsTolerance`'s own doc comment labels it tier 4, made up (evidence hierarchy).

## 8. Interface concerns (for the orchestrator)

None open from the original derivation. Reappraisal 1's concerns are listed under "Interface concerns (reappraisal 1)" at the end.

### Resolved by the 2026-10-16 interface reconciliation

- ~~IC-2~~ The I9 row lags the code (`composition`, `role`, `tone`). Closed as source-design doc debt (round 4, N18): the code is truth, and nothing here depends on the stale row.
- ~~IC-1~~ The design paragraph now includes `seed` (reconciliation round 2).
- ~~IC-3~~ `'scenario'` stamping: T5 now says "the sim stamps them" (§4.1).
- ~~IC-4~~ Card flag: T6 `ProjectCard.massing: 'matched' | 'approximate' | 'none'`. timelapse-sim §4.9 derives it (N2).
- ~~IC-5~~ Unknown stories: T5 `revisions[].stories: number | null /* null = unknown until massed */`. Reconciliation, "Massing".
- ~~IC-6~~ Projects that keep the existing building: T3 "Projects are new construction only".
- ~~IC-7~~ Over-80 envelopes and the floor-height overshoot: "Envelopes are clamped to `MAX_STORIES`" and "Floor-height overshoot … is accepted and documented" (§4.5).
- ~~IC-8~~ Shared anchor parcels: "Render slots are keyed by project (T7)".
- ~~IC-9~~ Naming: the code's `MAX_STORIES` governs. No change is needed.

## 9. Open questions

Each of these was answered by the reconciliation and has been applied above:

- ~~OQ-1~~ The cap when stories are unknown is `MAX_STORIES`, passed as `maxStories` by the sim (§4.2 step 2).
- ~~OQ-2~~ The tolerance is ±10% of units (tier 4). This spec keeps its own ±1-unit floor (§4.4).
- ~~OQ-3~~ Non-adjacent parcels mass on the largest connected component (§4.2 step 7).

None remain open.

## Interface concerns (reappraisal 1)

- **RC-1 (for the timelapse-sim revision; IA-22).** **Resolved:** relayed to timelapse-sim (ledger, "PM spec revised", 2026-10-17), whose §4.9 `massing` row now gives `'approximate'` when `massedUnits === 0`. The original note: timelapse-sim's card rule (its §4.9 table, `massing` row) reads "pipeline gives `massingApproximate(b) ? 'approximate' : 'matched'`". Under §4.9 item 1 here it must also give `'approximate'` when `massedUnits(b) === 0`. IA-22 lands this in the timelapse-sim text; this spec states the producer side and changes no helper.
- **RC-2 (outside the package; owner typology-generator).** **Resolved** (partner ruling, 2026-10-17: test-only fix, no generator output change): PR #22, merged to `main` as 34e83ce, allows ±1 unit for `[lot3000, 30]` only, keeps the stories and 0.5% floor-area checks, and pins the counterexample; `golden-seeded.json`, the generator hash, `datasetVersion` and yields are unchanged. The original note: the pre-existing "rotation invariance on the golden fixtures" flake in `generator.property.spec.ts` (ledger `preexisting-code-defect`, PM fix-round result 2026-10-17) needs an owner decision: a test-only exclusion or ±1-unit allowance, or a `serialize.ts` repair change that alters `golden-seeded.json` and the generator hash (hence `datasetVersion` and yields). It does not affect T10 (±1 is within P1).

No T-row change is needed: T10 is unchanged and byte-identical to the design.

## Reappraisal 1 changes

Every item is doc debt (design "Doc debt" orchestrator ruling; defect record 1 "pipeline-massing" and "pipeline-massing, final" items 1–9; ledger A14). No behaviour changed.

- **Status line** updated to Reappraisal 1, with the merged range (brief step 6).
- **§2 T10 row** re-checked: byte-identical to the design. No other T-row is copied or consumed as a row. The I-rows come from the source design and are unchanged.
- **§3 Global constraints** replaced verbatim from the design: adds the "Data quality" bullet and the header-brand text in "The editor is unchanged" (DQ rulings, T14).
- **§4.1** adds a data-quality bullet: this subsystem registers no T14 rule and rewrites no source value (global constraint "Data quality").
- **§4.4 acceptance**: an option with massed < 1 never counts as within tolerance (defect "final" item 3; PM ledger U = 1 ruling).
- **§4.4 k = 1 fallback**: the option closest to `U`, ties to family order, skipping zero-unit options while any holds a unit; on case 3 this replaces "most massed units" (final item 2; final-review "closest family on undershoot"; final-fix report fix 2).
- **§4.4 scaling trigger**: runs for cases 1 and 2 whenever no k = 1 option is within tolerance, including when no k = 1 option serialised; never on case 3 (final item 4).
- **§4.4 scaled reference**: rebuilt as its own typology and stories, so a fallen-back tower is scaled as its own midrise at k (defect "pipeline-massing" item 4; final item 1; A14).
- **§4.4 scaled pick**: massed ≥ 1 required; replaces the fallback only when strictly closer on serialised massed units (PM ledger Task 5/7 rulings).
- **§4.4 known limitations** added: the ±1 serialised-area drift, midrise non-monotonicity under bisection, null on unserialisable sites, and the U = 1 zero-unit volume (final item 9; A14; final-review Important 1 and Minor 2).
- **§4.4 undershoot** paragraph restated to the closest-family rule.
- **§4.7** adds the as-built perf measurement (PM task-7 report).
- **§4.9 (new) consumer contract** binding timelapse-sim: `massedUnits === 0` is approximate; the memo key; the anchor (largest `areaM2`, ties smallest id) is not the cell-placement parcel; source stamping; exceptions (IA-22; wave1-assignments PM consumer notes; final-review recommendation 3).
- **§2 internals** list `massingCandidates`, `withinTolerance` and `assembleSite` as built; `massingApproximate` notes the U = 1, massed 0 case.
- **§6 G8/G9** restated to the as-built assertions (G8 at U = the candidate's cap; G9 on roof parts with `capEnabled`).
- **§4.2 step 6** notes that the closing also applies when only one record has usable rings (final review, Minor 5, accepted).
- **§6 P1** allows tolerance + 1 and uses U ≥ 5 (defect "pipeline-massing" item 3; final item 5).
- **§6 P2** requires `stories === S` and an approximate rate ≤ 3%, with overshoot-or-midrise per case (defect item 2; final item 6).
- **§6 P3** gets the `U − c_max > tol(U) + 1` precondition and the restated assertions (defect item 1; final item 7).
- **§6 P1–P3** exclude null results (final item 8); `endOnFailure` and a 30 s timeout (final-fix report).
- **§6** withdraws the prototype's "0 approximate" claim (A14); lists the as-built unit, ruling and limitation tests, the as-built assembly assertions (row ± 1 m², street two components, courtyard perimeter bound) and the perf fixture's seeding and non-null floor; records the pre-existing rotation-invariance flake as outside this subsystem.
- **§7** AC5 restated; AC10–AC12 added for the §4.4 rulings, the pinned limitations and the tier-4 label on `unitsTolerance`.
- **Fidelity pass 3 (2026-10-17).** RC-1 marked resolved (landed in timelapse-sim §4.9); RC-2 marked resolved by the partner's test-only ruling, PR #22 merged as 34e83ce, cited in §6 and here (F3-9, F3-16).
