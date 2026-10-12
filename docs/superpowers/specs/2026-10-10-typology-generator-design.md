# Typology generator — subsystem spec

Derived from `docs/superpowers/design/2026-10-10-1749-sf-housing-sim.md` (approved 2026-10-10).
Milestone 1.

## 1. Scope

Design row (verbatim):

| slug | scope |
|---|---|
| `typology-generator` | Pure TypeScript, run in a web worker. Given a `ParcelRecord`, an `Envelope` and a seed, it returns a `GeneratedBuilding` or `null`. It holds the typology table, the massing rules (lot coverage, setbacks, stepbacks, floor-to-floor heights), the unit-yield formula and the seeded variety. Deterministic. |

**In scope**

- `generate()` (I8) and every rule it applies: typology selection, the cap chain, footprint derivation, yards, stepbacks, tower placement, the ADU rule, floor heights, unit yield, null rules, and seeded variety (I14).
- `fnv1a32` and the named PRNG (`mulberry32`).
- Conversion of local metres to `[lng, lat]` for I9 `parts`.
- Handling of degenerate parcels.
- `createGeneratorCache()`, a memo the worker host may use (§4.12).
- The 150k-parcel performance budget for generation.
- Golden fixtures.

**Out of scope**

- Envelope resolution (`plan-model`, I5).
- The worker host, the `SimRequest`/`SimResponse` protocol (I15), chunk fetching and batching. All of these belong to the brush-tool spec §4.9, which calls `generate(record, env, fnv1a32(id), 'max')`. The generator's only part in I15 is that call (plus the optional cache); its `GeneratedBuilding`s never leave the worker, being packed by map-view's `packCell`.
- Rendering and animation (`map-view`).
- Score maths and its UI (`scoreboard`).
- `'likely'` mode, `generateForUnits` (M5), FAR/setback envelope fields (M3) and building status (M4).

## 2. Interfaces

### Owned or consumed I-rows (verbatim)

| # | interface | owner → consumers | mark |
|---|---|---|---|
| I1 | `type ParcelId = string` — SF `mapblklot` (block+lot, e.g. `"3512008"`), the single join key across all data | data-pipeline → all | DC |
| I2 | `interface Envelope { maxStories: number }` — the per-parcel allowed envelope. The **only** thing manipulation writes. Later milestones add optional fields; M1 code must ignore unknown fields | plan-model → generator, scoreboard | MC (envelope-as-common-currency), DC (field set) |
| I6 | `interface ParcelRecord { id: ParcelId; polygon: [x: number, y: number][][] /* local metres, exactly EPSG:7131 (NAD83(2011) / San Francisco CS13, metres), origin at label point */; labelPoint: [lng, lat]; areaM2: number; existingUnits: number; existingFloorAreaM2: number; existingHeightM: number; landUse: string; eligible: boolean; neighborhood: string }` | data-pipeline → plan-model, generator, scoreboard | DC |
| I7 | `type BuildoutMode = 'max'` (M1). `'likely'` is reserved for M2 | generator, scoreboard | MC (sequence) |
| I8 | `generate(parcel: ParcelRecord, env: Envelope, seed: number, mode: BuildoutMode): GeneratedBuilding \| null`. Returns `null` for a replacement when its floor area ≤ `existingFloorAreaM2` **or** its units ≤ `existingUnits`: nobody rebuilds smaller or to fewer homes. (An `adu` keeps the existing building and is exempt) | generator → map-view, scoreboard | DC |
| I9 | `interface GeneratedBuilding { parcelId: ParcelId; source: 'user'; /* widens to 'pipeline' \| 'scenario' later */ typology: TypologyId; composition: CompositionId; parts: { footprint: [lng, lat][] /* simple outer ring; exclusions remain empty */; baseM: number; topM: number; role: 'occupied' \| 'roof'; tone: 0 \| 1 \| 2 }[] /* supported floor bands and siblings; rendered ground-to-topM */; stories: number; units: number; floorAreaM2: number; replacesExisting: boolean }` | generator → map-view, scoreboard | DC |
| I10 | `type TypologyId = 'adu' \| 'plex' \| 'walkup' \| 'podium' \| 'midrise' \| 'tower'` | generator | DC |
| I12 | Data manifest: `/data/<datasetVersion>/manifest.json` → `{ datasetVersion, builtAt, sources: { id, label?, url, retrievedAt, license }[], chunks: { cellId, bbox, url, parcelCount }[], buildingsTiles: url, basemapTiles: url, glyphs: url /* MapLibre `{fontstack}/{range}.pbf` template */, sprite?: url, neighborhoods: url }`. All `url`s are root-relative (`/data/<v>/…`). Every eligible-or-not parcel appears in **exactly one** chunk. `buildingsTiles` has one source-layer `buildings` with properties `parcelId`, `heightM`, `baseM`, at minzoom ≤ 12, with buildings clipped to parcels. Published versions are immutable and retained indefinitely. `datasetVersion` matches `^(\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\|fixture-\d+)$` (build date + 8-hex input hash) everywhere it is validated. R2 key = `data/<datasetVersion>/<path>`, served at `/data/<datasetVersion>/<path>` | data-pipeline → platform, plan-model, brush-tool (worker host), typology-generator, map-view | DC |
| I14 | Seed: `seed = fnv1a32(parcelId)`. Variety is a pure function of parcel and envelope, so the same plan always renders identically for everyone | generator | DC |
| I15 | **The one main↔worker protocol** (`src/lib/sim/protocol.ts`, owned by brush-tool's worker host): `SimRequest` as in the brush-tool spec, and `SimResponse = { type: 'ready'; rev; datasetVersion; chunkCount } \| { type: 'diff'; rev; phase: DiffPhase; render: GeneratedUpdate; stats?: OpStats; complete: boolean; score: Score } \| { type: 'chunks'; status: Record<cellId, ChunkStatus>; pending: number; failed: string[] } \| { type: 'parcelSummary'; reqId: number; summary: ParcelSummary \| null } \| { type: 'error'; rev; code; message }`, with matching request `{ type: 'parcelSummary'; reqId: number; parcelId: ParcelId }` (no rev). `ParcelSummary = { parcelId; neighborhood; landUse; eligible; existingUnits; envelope: Envelope \| null; generated: { typology; stories; units } \| null }`, used by map-view's tooltip. `GeneratedUpdate` and `PackedCell` are owned by map-view (the worker imports the pure `packCell`). `Score` is owned by scoreboard (the worker calls its pure `score()`). The main thread never receives `GeneratedBuilding[]` | brush-tool ↔ map-view, scoreboard, typology-generator | DC |

### Internal types (new; they do not alter any I-row)

```ts
// src/lib/generator/variety.ts
interface VarietyDraws { edgeInsetM: number; stepbackM: number; parapetM: number;
  towerSlide: number /* -1..1 */; towerAspect: number /* 1..1.5 */; aduEnd: 1 | -1 }
function drawVariety(seed: number): VarietyDraws;
// Test-only: generateWith(parcel, env, draws: VarietyDraws, mode) — same rules, injected draws.

// src/lib/generator/cache.ts — optional memo for the worker host
interface GeneratorCache { get(parcel: ParcelRecord, env: Envelope): GeneratedBuilding | null; clear(): void }
function createGeneratorCache(datasetVersion: string): GeneratorCache;
```

The generator exports no worker or message protocol. Brush-tool's worker host imports `generate`, `fnv1a32` and optionally `createGeneratorCache` (see brush-tool spec §4.9).

## 3. Global constraints (verbatim from design)

- **Free and open source.** No paid APIs and no vendor keys are needed to run
  or build it. Licence: MIT for code (OD-3). Data attribution is shown in-app
  (ODbL for the OSM/Protomaps basemap and Overture, PDDL/public domain for
  DataSF).
- **Determinism.** The same `Plan` + `datasetVersion` gives the same buildings
  and the same score, on every machine.
- **Overshoot is meaningful.** No readout caps at 100% of a target.
- **Honesty of numbers.** Every unit count is labelled with what it is (M1:
  *theoretical max buildout*). Net counts are shown, not gross. Sources and
  vintages are visible.
- **Performance targets.** Existing-city view pans at 60 fps on a 2022-era
  laptop. Generated buildings appear within 150 ms of pointer-up for strokes
  covering ≤ 500 parcels. A whole-city repaint (≈150k parcels) finishes within
  5 s, off the main thread. The first meaningful paint transfers ≤ 5 MB (parcel
  chunks load lazily under the brush).
- **Mobile works.** Touch painting uses an explicit mode switch. Layout works
  at 375 px.
- **Data is static and versioned.** The worker does no geo computation at
  runtime.
- **Cross-project conventions apply:** Conventional Commits, worktrees for all
  work, bare-name Cloudflare resources (`sfhousing`), and the migration
  workflow via Drizzle.

("The worker" in the static-data bullet means the Cloudflare Worker. The browser web worker is where generation is meant to run.)

## 4. Behaviour

### 4.1 Constants (exported from `src/lib/generator/constants.ts`)

| name | value | origin |
|---|---|---|
| `FTF_M` | 3.1 | OD-7 |
| `GROUND_FTF_M` | 4.5 (`podium`, `midrise`, `tower` ground floor only) | OD-7 ("4.5 m ground floor"), extended to midrise/tower, see OQ-2 |
| `EFFICIENCY` | 0.80 | OD-7 |
| `AVG_UNIT_M2` | adu 55, plex 85, walkup 70, podium 65, midrise 65, tower 70 | OD-7 |
| `COVERAGE` | plex 0.60, walkup 0.70, podium 0.80, midrise 0.75, tower podium 0.80 | OD-7 |
| `TOWER_COVERAGE` / `TOWER_PLATE_MAX_M2` | 0.35 / 900 | OD-7 |
| `TOWER_PODIUM_STORIES` | 5 | this spec |
| `MIDRISE_STEPBACK_ABOVE` | 6 floors | OD-7 |
| `MAX_STORIES` | 80 (painted values above this are clamped; I3 already bounds stories to 1..80) | I3 |
| `MIN_SITE_M2` | 40 | this spec |
| `MIN_WIDTH_INSET_M` | 1.5 (the footprint must survive a further 1.5 m inward offset, i.e. it is ≥ ~3 m wide) | this spec |
| `ADU_MIN_OPEN_M2` | 60 | OD-7 |
| `ADU_MAX_WIDTH_M`, `ADU_EDGE_GAP_M` | 6.0, 1.0 | this spec |
| `PLEX_MAX_UNITS` | 4 | OD-7 ("3–4 units") |
| `SIMPLIFY_EPS_M`, `CLIPPER_PRECISION` | 0.10, 2 (cm) | this spec |

### 4.2 Seed and variety (I14)

- `fnv1a32(s)` works on the UTF-8 bytes of `s`. It starts from `h = 0x811c9dc5`, and for each byte does `h ^= b; h = Math.imul(h, 0x01000193)`, then returns `h >>> 0`.
- PRNG: **mulberry32**, seeded with `seed`:
  `a = (a + 0x6D2B79F5) | 0; t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296`.
  It uses integer ops only, so it is bit-identical in every engine.
- `drawVariety` always takes exactly six draws, in this order and whatever the typology, so the stream never shifts:
  1. `edgeInsetM = 0.2 + 0.4·r1`
  2. `stepbackM = 1.5 + 1.5·r2`
  3. `parapetM = 0.3 + 0.9·r3`
  4. `towerSlide = 2·r4 − 1`
  5. `towerAspect = 1 + 0.5·r5`
  6. `aduEnd = r6 < 0.5 ? 1 : −1`
- Variety depends only on `parcelId`. The envelope picks the typology. Together they meet I14's "pure function of parcel and envelope".

### 4.3 Numeric determinism

Every quantity that affects `typology`, `stories`, `units`, `floorAreaM2`, `baseM` or `topM` is computed with `+ − × ÷`, `Math.sqrt` (correctly rounded in IEEE-754 engines, *inferred*), integer ops and `clipper2-ts` (which snaps to an integer grid at `CLIPPER_PRECISION`). No transcendental functions are used on those paths. `Math.sin`/`Math.cos` appear only in the lng/lat conversion (§4.10), and its output is rounded to 1e-7°. Output rounding:

- `floorAreaM2`: `Math.round(x·10)/10`
- `baseM`/`topM`: `Math.round(x·100)/100`
- `units` is computed from the **rounded** `floorAreaM2`, so anyone can recompute it from the output.

### 4.4 Site normalisation and degenerate parcels

Steps run in order. The first one that fails returns `null`.

1. `mode !== 'max'` → **throw** `Error('unsupported BuildoutMode')`. This is a programming error, not data.
2. `!parcel.eligible` → `null`. This is defensive, since I5 never gives ineligible parcels an envelope.
3. `S = Math.floor(env.maxStories)`. If it is not finite or `S < 1` → `null`. Clamp `S` to `MAX_STORIES`. Unknown envelope fields are ignored (I2).
4. Rings: drop rings with fewer than 3 distinct vertices.
   - None left → `null`.
   - One ring: use it as-is.
   - More than one ring: `unionD(rings, FillRule.EvenOdd)`. This resolves holes and **disjoint parts** (multipolygon parcels) without trusting ring orientation.
5. **Site** `P` = the largest outer polygon by area. Other parts get no building and are not counted. Holes inside `P` are **dropped**: the footprint uses the outer ring only, because I9 `footprint` is a single outer ring with parcel holes dropped in M1. `simplifyPathsD(P, SIMPLIFY_EPS_M)`. `A = areaD(P)`. If `A < MIN_SITE_M2` → `null`.
6. **Base region** `Q = inflatePathsD(P, −edgeInsetM, JoinType.Miter, EndType.Polygon, 2, CLIPPER_PRECISION)`. Drop pieces under 10 m².
   - Empty → `null`.
   - Width test: `inflatePathsD(Q, −MIN_WIDTH_INSET_M, …)` empty → `null`. This removes slivers.

Inset is the gap to the property line, and it keeps neighbouring generated masses visually distinct. Front and side setbacks are otherwise zero (SF street-wall pattern). The yard comes from §4.6.

### 4.5 Typology selection and the cap chain

The function `select(S, A, existingUnits)` resolves the typology, with `A` from §4.4.5:

| painted `S` | condition | result |
|---|---|---|
| ≥ 13 | `A ≥ 1500` | `tower`, `S` stories |
| ≥ 13 | otherwise | re-select with `S = 12` |
| 8–12 | `A ≥ 600` | `midrise`, `S` |
| 8–12 | otherwise | re-select with `S = 7` |
| 5–7 | `A ≥ 400` | `podium`, `S` |
| 5–7 | otherwise | `walkup`, `min(S, 5)` |
| 4 | — | `walkup`, 4 |
| 3 | — | `plex`, 3 |
| 1–2 | `existingUnits ≥ 1` | `adu`, `S` (§4.8) |
| 1–2 | `existingUnits = 0` | `plex`, `S` (replacement on a non-residential or vacant lot; OQ-1) |

"Capped at" in OD-7 is read as a cap on **both** typology and stories. A painted 12 on a standard 25×100 ft lot (≈232 m²) therefore yields a 5-story walkup. `GeneratedBuilding.stories` is the **built** story count after capping, not the painted one.

### 4.6 Base footprint, yards and coverage

1. Target area: `T = COVERAGE[typ] · A`.
2. If `area(Q) ≤ T`, the footprint is `F = Q`.
3. Otherwise `F = Q ∩ slab(h)`. The slab is `{p : |(p − c)·u| ≤ h}`:
   - `c` is the area centroid of `P`.
   - `u` is the long principal axis of `P`. It is the eigenvector of the larger eigenvalue of the second-moment matrix `[[Sxx, Sxy],[Sxy, Syy]]`, computed with the closed-form 2×2 formula using `sqrt`.
     - Tie (`|λ1−λ2| ≤ 1e-9·(λ1+λ2)`) → `u = (1,0)`.
     - Sign is normalised so `u.x > 0`, or `u.x = 0` and `u.y > 0`.
   - `h` is found by bisection on `[0, half-extent of P along u]`. It runs 30 iterations, or stops when `|area − T| ≤ 0.25 m²`.
   - The slab clip uses in-house Sutherland–Hodgman against the slab's two half-planes, not Clipper. It is convex, and this keeps bisection cheap (§4.12).

**Yard rule.** The band removed along the long axis is the lot's yard. M1 cannot tell the street side from the rear (I6 carries no frontage, by design ruling), so it splits the band **equally between both ends**. For a 25×100 ft lot at plex coverage this leaves ≈5.3 m at each end.

Coverage is the binding yard rule, and there is no separate rear-yard minimum. The OD-7 coverages already leave ≥ 25% of lot depth open for plex and walkup.

If `F` comes out in several pieces (concave sites), every piece ≥ 10 m² becomes its own part.

### 4.7 Massing per typology

Ground-floor height `g` is `GROUND_FTF_M` for `podium`, `midrise` and `tower`, and `FTF_M` otherwise. The top of floor `k` is `g + (k−1)·FTF_M`.

- **plex, walkup, podium**: one part per piece of `F`, from `baseM 0` to `top(S)`.
- **midrise**:
  - Floors 1–6 are `F`.
  - Floors 7–S are `U = inflatePathsD(F, −stepbackM, …)`. If `area(U) < 0.4·area(F)`, then `U = F` (no stepback).
  - Parts: `F` from 0 to `top(6)`, and `U` from `top(6)` to `top(S)`.
- **tower**:
  - Podium: floors 1–5 on `F`.
  - Tower plate: `At = min(TOWER_PLATE_MAX_M2, TOWER_COVERAGE·A)`. It is a rectangle aligned to `u`/`v`, with depth along `u` of `sqrt(At·towerAspect)` and width `sqrt(At/towerAspect)`.
  - The rectangle's centre is `c + towerSlide·s·u`, where `s = max(0, (extent of F along u − depth)/2 − 1.0)`.
  - `R = intersectD(rect, inflatePathsD(F, −1.0))`.
    - If `area(R) < 0.9·At`, retry with `towerSlide = 0`.
    - If it is still under, use the largest piece of `R` when that piece is `≥ 0.5·At`.
    - Otherwise re-run as `midrise` with `S = 12`.
  - Tower floors 6–S on `R`.
- **Parapet**: `parapetM` is added to `topM` of the parts that reach the top floor only. It never counts as floor area.
- **Nesting (I9), guaranteed by construction.** Every part is a single outer ring with no holes (`P` has its holes dropped, and inward offsets and intersections of a hole-free region stay hole-free). Every part with `baseM > 0` lies within a part whose `topM` (before parapet) equals its `baseM`: midrise `U` is an inward offset of `F` (or `F` itself); tower `R` is an intersection with `inflatePathsD(F, −1.0)`, so each piece of `R` lies inside one piece of `F`. Ground-level parts (`baseM 0`) have nothing beneath them. This is what lets map-view render each part ground-to-`topM`. If a future rule could break nesting, it must clip the upper part to the part below rather than emit it.
- `floorAreaM2 = Σ over parts of area(piece) × floors(part)`. Areas are measured in local metres before conversion.

### 4.8 ADU rule (keeps the existing building)

This applies only when `select` returns `adu`.

- Existing-footprint estimate:
  - `estStories = existingHeightM > 0 ? max(1, round(existingHeightM / FTF_M)) : 2`
  - `estFootprint = existingFloorAreaM2 / estStories`
  - `open = A − estFootprint`
  - `open < ADU_MIN_OPEN_M2` → `null`.
- Size:
  - Gross area `G = 55 / EFFICIENCY = 68.75 m²`
  - Stories `= S` (1 or 2)
  - Plate `Ap = G / S`
  - Rectangle width along `v` is `min(ADU_MAX_WIDTH_M, extent of Q along v − 2)`, and depth is `Ap / width`.
  - It sits on the `aduEnd·u` end, with its outer edge `ADU_EDGE_GAP_M` inside `P`'s extreme along `u`, centred on `c` along `v`.
- Fit: footprint `= intersectD(rect, inflatePathsD(P, −1.0))`. If its area is `< 0.9·Ap` → `null`.
- Output:
  - `typology 'adu'`, `units 1`, `stories S`
  - `floorAreaM2` = the ADU's own floor area (new construction only)
  - `replacesExisting: false`
  - one part from 0 to `S·FTF_M + parapetM`
- **Counting:**
  - An ADU demolishes nothing.
  - Its `units` (1) are all net-new.
  - `floorAreaM2` excludes the kept building.
  - Map-view must **not** hide the existing building on `replacesExisting: false` parcels.

### 4.9 Unit yield and null rules

- `units = floor(floorAreaM2 · EFFICIENCY / AVG_UNIT_M2[typ])`, using the rounded `floorAreaM2`. For `plex`, `units = min(units, 4)`. For `adu`, units is 1.
- **N5** `units < 1` → `null`.
- **N6 (I8, floor area)** is checked on the post-build total, `after = replacesExisting ? floorAreaM2 : existingFloorAreaM2 + floorAreaM2`. If `after ≤ existingFloorAreaM2` → `null`. For an ADU this is `floorAreaM2 ≤ 0`, which never happens.
- **N7 (I8, units)** For a replacement, `units ≤ existingUnits` → `null`. A replacement that nets zero or negative homes is not a "max buildout", and SF limits such demolitions (*inferred*). I8 states this rule and exempts the ADU, which keeps the existing building.
- `replacesExisting = (typology !== 'adu')`. On a vacant or non-residential parcel the flag is still `true`, with zero existing units.
- **Downzoning (OD-2)** needs no special handling. A lower envelope simply regenerates a smaller building or `null`. The existing building is never touched by the generator.

### 4.10 Local metres → `[lng, lat]`

Verified at https://epsg.io/7131.proj4: I6's frame is EPSG:7131, a transverse Mercator with `lat_0=37.75`, `lon_0=-122.45` and `k=1.000007` on GRS80, translated so the label point is `(0,0)`. For each vertex `(x, y)`, with `(λ0, φ0) = labelPoint`:

1. Grid convergence: `γ = (λ0 + 122.45)·sin φ0`, in degrees. Rotate grid to true: `e = x cos γ + y sin γ`, `n = −x sin γ + y cos γ`.
2. GRS80 (`a = 6378137`, `e² = 0.00669438002290`): `W = 1 − e² sin² φ0`, `M = a(1−e²)/W^1.5`, `N = a/√W`.
3. `lat = φ0 + n / (M·π/180)` and `lng = λ0 + e / (N cos φ0 · π/180)`. Round both to 1e-7°.

Rings are emitted **open** (first vertex not repeated) and **counter-clockwise** in lng/lat.

The error budget is ≤ 0.05 m for offsets up to 500 m anywhere in SF. The test is against `proj4` (dev dependency only).

### 4.11 Library choice: `clipper2-ts@2.0.1`

Verified: npm registry, published 2025-12-21, BSL-1.0, ESM, no runtime dependencies. It exports `inflatePathsD`, `intersectD`, `unionD`, `simplifyPathsD` and `areaD` (`dist/index.d.ts`).

Why this library:

- It is a direct port of Angus Johnson's Clipper2, so offsetting is first-class and robust. Negative-delta inset is orientation-independent and collapsing slivers return `[]`. Both were verified locally with a 10×30 rectangle in both orientations and a 1.5 m sliver.
- Integer-grid snapping gives cross-engine determinism.

Rejected alternatives:

- `polygon-clipping` / `polyclip-ts`: boolean operations only, no offset.
- `@turf/buffer`: geodesic and JSTS-based, heavier, and float-sensitive.
- `clipper2-js@1.2.4`: has peer dependencies on `@angular/core@^15`, which npm 7+ installs automatically.
- `js-angusj-clipper`: WASM loading in a worker plus async init.
- `clipper-lib`: Clipper 1, unmaintained since 2022.

BSL-1.0 is permissive and compatible with MIT distribution. It is listed on the LICENSE/attribution page (`platform`).

### 4.12 Caching and performance

- **Where it runs:** `generate` runs inside brush-tool's worker host, a module worker in the same pattern as `interplanetary/src/lib/game.svelte.ts:50` (verified). It has no DOM and no `postMessage` dependency.
- **Memo:** `createGeneratorCache` keys by `parcelId + '|' + S` (after floor and clamp). The host creates a new cache when `datasetVersion` changes.
- **Errors:** an exception from `generate` (other than an unsupported mode) indicates a bug or bad data. The cache catches it, logs `[generator] <parcelId>: <message>` once per parcel, and returns `null`, so the parcel contributes nothing and generation continues.
- **Budget:**
  - `generate` averages ≤ 15 µs per parcel in Node on CI hardware, so 150k parcels finish in ≤ 2.5 s. That leaves ≥ 2.5 s of the 5 s global for the host's resolution, packing (map-view `packCell`) and transfer.
  - Basis (*verified locally, 2026-10-10*): 150k × (one `inflatePathsD` + one `intersectD`) took 0.40 s in Node on Apple Silicon.
  - The per-parcel work is ≤ 3 offsets, a Sutherland–Hodgman bisection (no Clipper inside the loop) and ≤ 1 intersection.
- **Small strokes:** ≤ 500 parcels must finish generating in ≤ 30 ms, part of the 150 ms pointer-up budget.

## 5. Seams

- **M2 `buildout-likelihood`:** `mode` stays a parameter, and anything other than `'max'` throws. No likelihood code is written.
- **M3 `policy-levers`:** I2 extra fields are ignored. The coverage and setback rules live in a `rulesFor(typ)` table, so M3 can override per-envelope values without restructuring. No such fields are read now.
- **M4 `time-permitting`:** nothing. `status` is not emitted.
- **M5 `pipeline-overlay`:** `source` is always `'user'`. Selection (§4.5) and massing (§4.6–4.7) are separate exported functions, `selectTypology` and `massTypology`, so `generateForUnits` can invert them later. No inversion is written now.

## 6. Testing

All pure-TS tests are in the Vitest **server** project (`src/lib/generator/*.spec.ts`). Fixtures are in `src/lib/generator/fixtures/`.

**Unit**

- `fnv1a32` against published vectors: `''` → `0x811c9dc5`, `'a'` → `0xe40c292c`, plus three `mapblklot` values frozen in `seeds.json`.
- `mulberry32` first five outputs for seed 1, frozen.
- `drawVariety` ranges, with the draw order frozen.
- Selection table: every row of §4.5, plus boundaries at A = 399.99/400, 599.99/600 and 1499.99/1500.
- The width test, the slab bisection reaching T ± 0.25 m², and principal axis on rotated rectangles.
- Unsupported mode throws.

**Golden (hand-calculated)**

These run through `generateWith` with draws `r = [0.5, 0.5, 0.5, 0.5, 0, x]`: edge inset 0.4, stepback 2.25, parapet 0.75, slide 0, aspect 1. Areas are checked to ±0.5 m², FA to ±2 m², and units exactly. The default existing building is a 2-story single-family house: `existingUnits 1`, FA 180, 7 m.

| fixture | input | expected |
|---|---|---|
| `std-25x100.json` | 7.62×30.48 m (232.3 m²), S=3 | plex, footprint 139.4, FA 418.1, units 3, stories 3, replaces |
| same | S=5 | walkup, FA 812.9, units 9 |
| same | S=12 | walkup (cap chain), stories 5, units 9 |
| same | S=2 | adu, FA 68.75, units 1, `replacesExisting false` |
| `shallow-adu-fail.json` | 7.62×15 m, FA 160, 6.2 m, S=2 | `null` (open 34 m² < 60) |
| `lot-1000.json` | 25×40 m, S=6 | podium, FA 4800, units 59, top 20.0 + 0.75 |
| same | S=10 | midrise, FA 6587.4, units 81, parts tops 20.0 / 32.4 + 0.75 |
| `lot-3000.json` | 60×50 m, S=30 | tower, podium plate 2400, tower plate 900, units 394, tops 16.9 / 94.4 + 0.75 |
| `lot-1200.json` | 40×30 m, S=30 | midrise, stories 12 |
| `std-over-apartment.json` | std lot, existing 8 units / FA 700, S=3 | `null` (N6) |
| `std-over-10units.json` | std lot, existing 10 units / FA 600, S=5 | `null` (N7) |
| `vacant-std.json` | std lot, 0 units / FA 0, S=2 | plex, stories 2, FA 278.7, units 2 |
| `sliver.json` | 1.5×60 m | `null` |
| `tiny.json` | 6×6 m | `null` |
| `multipart.json` | std lot + disjoint 50 m² part | identical to the std-lot S=3 result |
| `holed.json` | std lot with a 2×2 m hole | outer ring used, same as std S=3 |
| `lshape.json` | 20×20 m L with a 10×10 notch, S=5 | ≥ 1 part, footprint ≤ 0.7·A·1.001 (walkup, A=300) |

**Property** (fast-check, 1,000 runs)

- **Determinism:** the same input gives deep-equal output.
- **Rotation invariance:** rotating a fixture by any angle changes `units` and `stories` by none and `floorAreaM2` by ≤ 0.5%.
- **Monotonicity:** raising `S` never lowers `floorAreaM2`, except across a cap-chain or N6/N7 boundary.
- **Containment:** every footprint vertex lies within `P` (local frame), within 0.02 m.
- **Nesting (I9):** over the fixtures and random parcels (rectangles, L-shapes, concave and multipart sites) at `S` in 1..80, every part's `footprint` is a single open ring of ≥ 3 vertices, and every part with `baseM > 0` lies within some part whose pre-parapet `topM` equals its `baseM`. Checked both in the local frame and after the lng/lat conversion (tolerance 0.02 m). map-view's U6 re-asserts the same property on its fixtures.
- **Coverage:** base footprint area ≤ `COVERAGE·A + 0.25`.

**Conversion**

- Against `proj4` EPSG:7131: 500 seeded points across SF's bbox with offsets ≤ 500 m. Max error ≤ 0.05 m.
- Ring orientation is CCW.

**Seeded snapshot**

- `golden-seeded.json`: 200 synthetic SF-like parcels at mixed `S`, generated through `generate` with real `fnv1a32` seeds. The full output is frozen.
- A change requires regenerating it in a deliberate commit with a reason.

**Performance**

- `generator.perf.spec.ts`: 150k synthetic parcels (`fixtures/synth.ts`, a seeded mix: 70% 25×100 ft lots, 25% 400–3,000 m² lots, 5% irregular) at mixed `S`. It asserts ≤ 2,500 ms on CI.
- Also asserts ≤ 30 ms for 500 parcels.

**Cache**

- `cache.spec.ts`: the same key returns the identical object, and a changed `S` recomputes.
- A throwing parcel (injected) yields `null` and logs once.

**Cross-engine** (client project, Chromium)

- `generator.svelte.spec.ts` runs the seeded snapshot in the browser and deep-equals `golden-seeded.json`.

Worker-host and e2e coverage belong to brush-tool and map-view. There is no page of its own here.

## 7. Acceptance criteria

1. `generate` matches I8 exactly. It is exported from `src/lib/generator/index.ts` together with `fnv1a32`, `selectTypology` and `massTypology`.
2. Every golden fixture in §6 passes with the stated tolerances.
3. Two runs in different processes, Node and Chromium, give identical seeded-snapshot output.
4. No `Math.sin`, `Math.cos`, `Math.atan2`, `Math.pow` or `Math.exp` appear outside `geo.ts`. A lint/grep test checks this.
5. The perf spec passes within budget on CI.
6. The only new runtime dependency is `clipper2-ts@2.0.1`. It is pinned exactly and listed on the attribution page.
7. An ADU never sets `replacesExisting`. A replacement never has `units ≤ existingUnits` or `floorAreaM2 ≤ existingFloorAreaM2` (I8).
8. Every output satisfies I9's nesting: single-ring parts, each upper part inside the part below (property test).

## 8. Interface concerns (for the orchestrator)

- ~~**IC-1:**~~ *Resolved:* I8's null rule now covers units (N7), with the ADU exempt. N5 (`units < 1`) remains this spec's own rule.
- ~~**IC-2:**~~ *Resolved:* I9 states parts are a single outer ring with parcel holes dropped in M1. data-pipeline's report counts holed parcels, which informs any later `holes` field.
- ~~**IC-3:**~~ *Resolved (declined):* no frontage field; the yard is split across both ends of the long axis.
- **IC-4:** *Partly resolved:* I6 now says exactly EPSG:7131 with the label point as origin. Still not in I6: valid polygons (`ST_MakeValid`) and OGC ring order. data-pipeline §4.4 provides both, and §4.4 here does not trust ring orientation.
- ~~**IC-5:**~~ *Resolved by I15.* The generator's contribution is only the I8 call and `createGeneratorCache`.
- **IC-6:** The I14 seed ignores the envelope. This satisfies I14 but means a parcel's jitter stays fixed as its height changes, which is the intended visual stability.

## 9. Open questions

- **OQ-1:** What does painting 1–2 stories on a lot with no homes do? *Recommend:* a `plex` replacement at `S` stories (as specced). The alternative, `null`, makes low paint over parking lots silently do nothing.
- **OQ-2:** Should the 4.5 m ground floor apply to `midrise` and `tower` too, and does it count toward residential yield? *Recommend:* yes, and it counts. This follows OD-7's single-formula yield. Recalibrate against FZP capacity later.
- **OQ-3:** Should painting ≥ 3 stories fall back to an ADU when the replacement returns `null`? *Recommend:* no. Painted 1–2 means ADU and ≥ 3 means replacement, which is easier to explain.
- **OQ-4:** Small lots (< 400 m², most of SF) cap at 5 stories via the cap chain. *Recommend:* accept for M1 (no lot merging). Flag in calibration against the FZP 19k–64k range.
- ~~**OQ-5:**~~ *Resolved:* I3 bounds stories to 1..80, matching `MAX_STORIES`.

The building-compositions extension uses supported floor bands and parcel exclusions. Occupied tops exclude cosmetic parapet height; optional roof accents occupy that allowance and contribute no housing. Scores use serialized occupied geometry, with the established declared-gross-area exception for ADUs. See [building compositions](2026-10-11-building-compositions-design.md).
