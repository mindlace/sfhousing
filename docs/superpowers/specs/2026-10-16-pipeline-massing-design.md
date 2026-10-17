# Pipeline massing: subsystem spec

Status: derived from [the FZP timelapse design](../design/2026-10-16-1903-fzp-timelapse.md) (approved with partner rulings, 2026-10-16). Owner of T10.

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

- Choosing which projects get massed, when, how often, and memoising the results. That is `timelapse-sim`. Per the reconciliation ("Multi-phase projects"), `multiPhase` rows are never massed: their card shows massing `none`.
- Stamping `source: 'scenario'` on simulated projects' buildings. T5 assigns this to the sim.
- Ghost, stage and colour rendering, and per-slot packing. That is `timelapse-render`.
- The yield table in `parcels.bin` (T11). That is `scenario-data`, using the existing `generate`.
- Parsing stories or units out of records. That is `project-records`.
- Real footprints and renderings (R10), and DA phasing.
- Any change to `generate` (I8), its outputs, or the editor (`/`, `/p/:id`).

## 2. Interfaces

### Owned (verbatim)

| # | interface | owner → consumers | mark |
|---|---|---|---|
| T10 | `GeneratedBuilding.source: 'user' \| 'pipeline' \| 'scenario'` (amends I9). `generateForUnits(parcel: ParcelRecord \| ParcelRecord[], units: number, maxStories: number, seed: number, stories?: number): GeneratedBuilding \| null` | pipeline-massing → timelapse-sim, map-view | DC |

### Consumed (verbatim, from the source design)

| # | interface | owner → consumers | mark |
|---|---|---|---|
| I6 | `interface ParcelRecord { id: ParcelId; polygon: [x: number, y: number][][] /* local metres, exactly EPSG:7131 (NAD83(2011) / San Francisco CS13, metres), origin at label point */; labelPoint: [lng, lat]; areaM2: number; existingUnits: number; existingFloorAreaM2: number; existingHeightM: number; landUse: string; eligible: boolean; neighborhood: string }` | data-pipeline → plan-model, generator, scoreboard | DC |
| I8 | `generate(parcel: ParcelRecord, env: Envelope, seed: number, mode: BuildoutMode): GeneratedBuilding \| null`. Returns `null` for a replacement when its floor area ≤ `existingFloorAreaM2` **or** its units ≤ `existingUnits`: nobody rebuilds smaller or to fewer homes. (An `adu` keeps the existing building and is exempt) | generator → map-view, scoreboard | DC |
| I9 | `interface GeneratedBuilding { parcelId: ParcelId; source: 'user'; /* widens to 'pipeline' \| 'scenario' later */ typology: TypologyId; parts: { footprint: [lng, lat][] /* single outer ring; parcel holes dropped in M1 */; baseM: number; topM: number }[] /* nested: each part's footprint ⊆ the part below; rendered ground-to-topM */; stories: number; units: number; floorAreaM2: number; replacesExisting: boolean }` | generator → map-view, scoreboard | DC |
| I10 | `type TypologyId = 'adu' \| 'plex' \| 'walkup' \| 'podium' \| 'midrise' \| 'tower'` | generator | DC |
| I14 | Seed: `seed = fnv1a32(parcelId)`. Variety is a pure function of parcel and envelope, so the same plan always renders identically for everyone | generator | DC |

The code's `GeneratedBuilding` (`src/lib/generator/types.ts:11-27`) also carries `composition`, `role` and `tone`, which the source-design I9 row lacks (IC-2). This spec follows the code.

### Internal types and functions (new; they alter no T- or I-row)

- `massedUnits(b: GeneratedBuilding): number` = `unitsFor(b.typology, b.floorAreaM2)`: the units the drawn volume holds under the generator's rules.
- `unitsTolerance(units: number): number` = `Math.max(1, Math.round(0.1 * units))`.
- `massingApproximate(b: GeneratedBuilding): boolean` = `Math.abs(massedUnits(b) − b.units) > unitsTolerance(b.units)`. This is always `false` for `source: 'user'`, because there `units` is computed from `floorAreaM2`.
- `frameOffset(from: [lng, lat], to: [lng, lat]): [x: number, y: number]`: the EPSG:7131 grid position of `to` in the local frame whose origin is `from`, in metres (§4.2).
- `generateForUnitsWith(parcels, units, maxStories, draws: VarietyDraws, compositionDraws: CompositionDraws, stories?)`: a test seam, in the same pattern as `generateWith` (`generate.ts:174-182`).
- `massTypology` and `referenceComposition` gain an optional last argument `opts?: { coverageScale?: number; fallbackStories?: number }`. When it is omitted, behaviour is byte-identical to today: scale 1, and fall back to midrise at 12 (`massing.ts:181`, `compositions.ts:53`).

`massedUnits`, `massingApproximate` and `unitsTolerance` are exported from `src/lib/generator/index.ts` with exactly these signatures. All three are pure and total:

- `export function unitsTolerance(units: number): number`
- `export function massingApproximate(b: GeneratedBuilding): boolean`
- `export function massedUnits(b: GeneratedBuilding): number`

timelapse-sim owns the card's `massing` rule (reconciliation round 2) and builds it on these helpers:

- pipeline buildings: `massingApproximate(b)`;
- simulated buildings: `Math.abs(b.units − revision.units) > unitsTolerance(revision.units)`.

The other three functions are internal.

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
- **Determinism.** The same `datasetVersion` and seed always give the same future, on every machine. The representative seed is chosen deterministically: the run whose final `completedNet` is the median of the N band runs.
- **Honesty of numbers.** The mode is labelled a *simulation*. The scoreboard shows the shown run and the p10–p90 band. Pipeline and new-FZP units are separate lines. Actual completions since the RHNA period start are counted and labelled as actual. Units lost to dead projects are shown.
- **Time scrubbing performance.** At 60 fps on a 2022-era laptop with the whole city's timeline loaded, per-frame JS during scrub or playback is O(1) in project count. A reroll reaches a full new timeline (the shown run, to 2050) within 3 s off the main thread. The p10–p90 band may fill in progressively afterwards; the UI marks it as provisional until it is complete.
- **First paint.** `/fzp` must not require loading every parcel chunk. The whole-city score comes from `parcels.bin`, `projects.json` and `calibration.json`. Geometry streams with the viewport, as on `/`.
- **The editor is unchanged.** `/` and `/p/:id` behave exactly as before. FZP mode is additive. The one intended exception is the shared header, which gains the mode links ("Paint" / "Timelapse").
- **Map budgets in FZP mode.** Two deck layers per cell are allowed for timeline cells: translucency needs them. This is an exception to map-view's one-layer-per-cell rule, so a `bench:map` timeline scenario must pass the same p95 frame bar. The existing-building catch-up stays within 2,000 feature-state changes per frame.
- **Accessibility.** WCAG 2.2 AA as in `docs/dev/accessibility.md`. The scrubber is a labelled slider: arrow keys step a month, Page Up/Down a year. Reduced motion stops autoplay, but scrubbing still works.

## 4. Behaviour

### 4.1 Contract summary

- **Units come from the record.** The result's `units` always equals `U = Math.floor(units)`, the caller's number. The massing only draws a volume for those units. `floorAreaM2` is the drawn volume's area. Scores (T8) count schedule/record units (tier 0) and never `massedUnits`.
- **`source` is `'pipeline'`** on every result. Per T5, the sim re-stamps simulated projects' buildings as `'scenario'`. `replacesExisting` is always `true`: the result is never an `adu`, which matches T3 ("new construction only").
- **`parcelId`** is the anchor parcel (§4.2). Callers that need every parcel use `Schedule.parcelIds`.
- **`stories`**: if a valid `stories` is given, the result's `stories` equals `Math.floor(stories)` exactly (§4.4). Otherwise it is the story count the search chose.
- **No I8 null rule.** A real project may be smaller than what it replaces, in floor area or in units. `existingUnits`, `existingFloorAreaM2`, `existingHeightM`, `landUse` and `eligible` are **ignored**: the record is ground truth (tier 0) over the generator's "nobody rebuilds smaller" assumption.
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
     4. Heal the seams with a morphological closing: `inset(inset(U, −SIMPLIFY_EPS_M), +SIMPLIFY_EPS_M)` (an outset, then an inset of 0.10 m, miter joins). This bridges gaps narrower than 0.20 m.
   - **Why closing is needed.** The pipeline quantises every ring to centimetres relative to its own origin (`pipeline/lib/rings.ts:7`). Neighbouring parcels' shared edges can therefore disagree by about 1 cm per axis, plus the frame-offset error (below). 0.10 m is the existing `SIMPLIFY_EPS_M` (tier 4, typology-generator §4.1), reused rather than introducing a new number.
7. **Site.** `normaliseSite(polygon, draws.edgeInsetM)` (`site.ts:66`).
   - If the union has several components (non-adjacent parcels, e.g. across a street), only the largest is massed, as for multipart parcels (`site.ts:86-90`). The reconciliation ("Massing") confirms this. The others get no geometry, and the units are not split.
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

**Composition (k = 1).** This is the same loop as `generateDetailed` (`generate.ts:89-107`), with the same draws, except that the `gains`/anchor logic and the N6/N7 checks (`generate.ts:113-156`) are removed.

- Walk `compositionOptions(site, ref, compositionDraws)` in family order. Skip a candidate when `serializeComposition` returns `null`, or when a non-simple family fails `retainsCapacityAcrossHeights`.
- Accept the first remaining candidate whose massed units `unitsFor(typology, round1(area))` lie within `unitsTolerance(U)` of `U`.
- If none qualifies and the choice was case 3 (undershoot), accept the candidate with the most massed units, ties to family order.
- If none qualifies and the choice was case 2, or case 1 drifted out of tolerance, go to scaling.

**Footprint scaling (k < 1).** This applies only when the composition above overshoots `U`.

- The reference is rebuilt with `coverageScale: k`. The base-footprint target becomes `k·COVERAGE[typ]·A` (`massing.ts:133`). For a tower, the plate area becomes `k·min(TOWER_PLATE_MAX_M2, TOWER_COVERAGE·A)`.
- Bisection on `k ∈ (0, 1)` runs for at most 20 iterations (internal numerical setting) and stops early when massed units equal `U`. It searches for the smallest `k` whose massed units are ≥ `U`.
- A scaled reference counts as too small (move up) in either case:
  - it is `null` (pieces under 10 m², a strip failing the 1.5 m width test, a tower plate under `MIN_TOWER_PLATE_M2`);
  - its typology differs from the unscaled one.
- The output is the evaluated `k` with the smallest `|massed − U|`, ties to the smaller `k`. It is used if it beats the k = 1 composition; otherwise the k = 1 composition is used.
- A scaled massing is always composition `'simple'`. Tower recipes re-fit full-size plates (`compositions.ts:180`), so other families are not used. Roof accents follow `capEnabled` as usual.

**Result.** The result has `typology`, `composition`, `parts`, `stories` and `floorAreaM2 = round1(area)` from the chosen massing. `units = U`, `source: 'pipeline'`, `replacesExisting: true`, and `parcelId = anchor.id`. Serialisation goes through `serializeComposition` with a record carrying `anchor.labelPoint` and the assembled polygon, so parts are open CCW lng/lat rings rounded to 1e-7° and the I9 nesting holds.

**Undershoot.** The target does not fit on the site within the story bound. The result is the largest massing, and `massingApproximate(b)` is `true`. Example (golden G4): 20 units on a 25×100 ft lot with no stories gives a 5-story walkup holding 9 units (computed with golden draws, `golden.spec.ts:53-57`). `timelapse-sim` maps this flag to T6 `ProjectCard.massing`:
- `'approximate'` when `massingApproximate(b)` is true;
- `'matched'` otherwise;
- `'none'` when the result is `null` or the project is `multiPhase`.

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

**What this means for `timelapse-sim`.** 1,000 massings cost ≤ 0.4 s. Massing only the projects in loaded chunks, once per revision, fits the 3 s reroll budget. `multiPhase` rows cost nothing, because they are not massed.

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

## 5. Seams

- **T9 policy levers.** Nothing. Levers transform `Calibration`/`ScenarioParcels`, not massing. `generateForUnits` reads the existing `rulesFor` table, so a future lever on coverage or unit size flows through without change.
- **Addenda sub-stages.** Nothing. Massing is stage-independent.
- **DA phasing.** Nothing new. `multiPhase` rows are not massed (reconciliation). The API already takes any subset of parcels and any unit count, so a later phasing spec can mass each phase as its own call.
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

**`units.spec.ts`** (unit + golden; `generateForUnitsWith` with `GOLDEN`/`SIMPLE` draws as in `golden.spec.ts:23-27`)

- G1: `std-25x100`, U 9, stories 5 → walkup, 5 stories, FA 812.9 ± 2, not approximate.
- G2: `lot-1000`, U 59, stories 6 → podium, FA 4800 ± 2.
- G3 (no I8): `std-over-apartment`, U 3, stories 3 → plex, 3 stories, FA 418.1 ± 2, `replacesExisting` true. `generate` returns `null` here.
- G4 (undershoot): `std-25x100`, U 20, maxStories 80 → walkup 5, `units` 20, `massedUnits` 9, `massingApproximate` true.
- G5 (scaling): `lot-1000`, U 30, stories 6 → podium 6, composition `'simple'`, `massedUnits ∈ [30, 33]`, FA < 4800.
- G6 (promotion): `std-25x100`, U 5, stories 3 → walkup 3 (`massedUnits` 5).
- G7 (uncapped stories): `std-25x100`, U 17, stories 8 → midrise 8.
- G8 (fallback): `tower-fallback`, stories 20 → midrise 20.
- G9 (FZP height): `lot-3000`, U 754, stories 65 → tower 65, top part `topM` 202.9 + parapet.
- Nulls:
  - units `NaN`, 0 and 0.9;
  - empty array;
  - every parcel with a bad `labelPoint`;
  - `tiny`/`sliver` sites;
  - stories absent with maxStories 0.
- Stories 920 is treated as absent (the result's `stories ≤ Smax`).
- `eligible: false` and `existingUnits > U` still return a building.
- `source` is `'pipeline'`; `units === Math.floor(units)` for units 12.7.

**`assemble.spec.ts`**

- `frameOffset` agrees with `localFrame(from).from(...to)` to ≤ 1e-6 m over 1,000 seeded pairs within 2 km in SF's bbox.
- `frameOffset` agrees with proj4 EPSG:7131 differences to ≤ 0.02 m within 200 m and ≤ 0.05 m within 500 m.
- `assembly-pair` → one component, area = Σ`areaM2` ± 0.5 m², and the anchor is the larger lot (or the smaller id on a tie).
- `assembly-row` → one component.
- `assembly-street` → largest component only; parts lie inside that lot.
- `assembly-courtyard` → no part intersects the excluded lot.

**`units.property.spec.ts`** (fast-check, `numRuns: 1000`, the arbitraries of `generator.property.spec.ts:36-80`)

- P1 (reachable, unknown stories): `U` uniform in `[max(1, c_min), c_max]` → not `massingApproximate`.
- P2 (reachable, known stories): `S ∈ 1..40`, `U ∈ [0.4, 1.0]·cap(S)` → `stories === S`, and not approximate.
- P3 (undershoot): `U > c_max` → approximate, and `massedUnits` equals the largest candidate capacity.
- P4 (order): every permutation of an assembly, with and without a duplicate entry, gives `toStrictEqual` output.
- P5 (determinism): two calls give `toStrictEqual` output; seeds `s` and `s + 2³²` give equal output.
- P6 (geometry): every part is a single open ring of ≥ 3 vertices. Each upper part lies inside a part whose pre-parapet `topM` equals its `baseM`, and every part is inside the site domain (tolerance 0.02 m). These are the same checks as typology-generator §6.
- P7 (editor compatibility):
  - Setup: a vacant parcel (`existingUnits 0`, FA 0), `S ∈ 1..80`, and `b = generate(p, {maxStories: S}, seed, 'max')` non-null.
  - Claim: `generateForUnits(p, b.units, 80, seed, b.stories)` is `toStrictEqual({ ...b, source: 'pipeline' })`.
  - The local prototype found 0 approximate results in 20,000 P1 cases and 8,000 P2 cases (2026-10-16).

**`units.perf.spec.ts`**: over `pipeline-synth`, asserts the §4.7 budget (mean, p99, total).

**Changed**: `src/lib/map/palette.spec.ts` (§4.8).

**Unchanged and required green**: `golden.spec.ts`, `generator.property.spec.ts`, `generator.perf.spec.ts`, `determinism.spec.ts` (AC4 now also covers `units.ts`/`assemble.ts`), and the full editor e2e suite as the regression gate for "editor unchanged".

**`npm run test:pipeline`**: `pipeline/test/assembly.test.ts`. It takes two adjacent parcels from the mini fixture's chunk output, assembles them with `generateForUnits`, and asserts one component with area = the sum ± 0.5 m². This covers the real pipeline's quantisation seam.

**No e2e, axe or client tests.** This subsystem has no UI or page.

## 7. Acceptance criteria

1. `generateForUnits` matches T10's signature and is exported from `src/lib/generator/index.ts`, together with `massedUnits`, `massingApproximate` and `unitsTolerance`.
2. For every non-null result: `units === Math.floor(units)`, `source === 'pipeline'`, `replacesExisting === true`, and `typology !== 'adu'`.
3. With a valid `stories`, the result's `stories === Math.floor(stories)`.
4. No result is `null` because of `existingUnits`, `existingFloorAreaM2`, `landUse` or `eligible`.
5. P1–P7 pass. G1–G9 pass.
6. Output is independent of parcel order and duplicates, and is bit-identical across runs. `determinism.spec.ts` passes with the new files.
7. The perf spec meets mean ≤ 0.4 ms, p99 ≤ 4 ms, and 2,000 calls ≤ 1,000 ms on CI.
8. `GeneratedBuilding.source` is `'user' | 'pipeline' | 'scenario'`. `colorFor` returns the typology colour for all three. `npm run check` passes.
9. `generate`, `golden.spec.ts` and the editor e2e suite are unchanged and green.

## 8. Interface concerns (for the orchestrator)

### Open

- **IC-2 (doc vs code).** The source-design I9 row lacks `composition`, `parts[].role` and `parts[].tone`, which the code has (`types.ts:15-22`; also map-view spec line 47). The code governs. The I9 row should be refreshed alongside T10's amendment.

### Resolved by the 2026-10-16 interface reconciliation

- ~~IC-1~~ The design paragraph now includes `seed` (reconciliation round 2).
- ~~IC-3~~ `'scenario'` stamping: T5 now says "the sim stamps them" (§4.1).
- ~~IC-4~~ Card flag: T6 `ProjectCard.massing: 'matched' | 'approximate' | 'none'` (§4.4).
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
