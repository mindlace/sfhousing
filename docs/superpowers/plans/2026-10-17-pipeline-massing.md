# Pipeline Massing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `generateForUnits` (T10), which masses a real pipeline project from its recorded unit count (and stories, where known) on one parcel or an assembly of parcels, and widen `GeneratedBuilding.source` to `'user' | 'pipeline' | 'scenario'`.

**Architecture:** A new `src/lib/generator/assemble.ts` re-frames several parcels into the anchor parcel's local frame (transcendental-free `frameOffset`), unions and heals them into one polygon. A new `src/lib/generator/units.ts` normalises inputs, builds story/typology candidates from the existing `selectTypology`/`referenceComposition`, picks the one whose capacity best matches the target, walks the existing composition families, and scales the footprint down (`coverageScale`) when even the best candidate overshoots. `generate` (I8) is untouched; `massTypology`/`referenceComposition` gain an optional `opts` argument that is byte-identical when omitted.

**Tech Stack:** TypeScript, clipper2-ts, Vitest (server + pipeline projects), fast-check, proj4 (fixtures/tests only).

**Spec:** `docs/superpowers/specs/2026-10-16-pipeline-massing-design.md` (design: `docs/superpowers/design/2026-10-16-1903-fzp-timelapse.md`). Executors read the spec; section numbers (§) below refer to it.

## Global Constraints

Copied verbatim from spec §3, plus the operator assignment and project rules.

- **Evidence hierarchy** (above). No number reaches the simulation without a tier and a source. A tier-3 or tier-4 number is never presented as data.
- **Determinism.** The same `datasetVersion` and seed always give the same future, on every machine. The representative seed is chosen deterministically: the run whose final `completedNet` is the median of the N band runs.
- **Honesty of numbers.** The mode is labelled a *simulation*. The scoreboard shows the shown run and the p10–p90 band. Pipeline and new-FZP units are separate lines. Actual completions since the RHNA period start are counted and labelled as actual. Units lost to dead projects are shown.
- **Time scrubbing performance.** At 60 fps on a 2022-era laptop with the whole city's timeline loaded, per-frame JS during scrub or playback is O(1) in project count. A reroll reaches a full new timeline (the shown run, to 2050) within 3 s off the main thread. The p10–p90 band may fill in progressively afterwards; the UI marks it as provisional until it is complete.
- **First paint.** `/fzp` must not require loading every parcel chunk. The whole-city score comes from `parcels.bin`, `projects.json` and `calibration.json`. Geometry streams with the viewport, as on `/`.
- **The editor is unchanged.** `/` and `/p/:id` behave exactly as before. FZP mode is additive. The one intended exception is the shared header, which gains the mode links ("Paint" / "Timelapse").
- **Map budgets in FZP mode.** Two deck layers per cell are allowed for timeline cells: translucency needs them. This is an exception to map-view's one-layer-per-cell rule, so a `bench:map` timeline scenario must pass the same p95 frame bar. The existing-building catch-up stays within 2,000 feature-state changes per frame.
- **Accessibility.** WCAG 2.2 AA as in `docs/dev/accessibility.md`. The scrubber is a labelled slider: arrow keys step a month, Page Up/Down a year. Reduced motion stops autoplay, but scrubbing still works.
- Ruling A1: `OPEN_DAY` is `Math.fround(3.0e38)`; compare with the exported constant, never a literal. (Not expected to be touched here.)
- AC4: no `Math.sin|cos|atan2|pow|exp` in any `src/lib/generator/**` file except `geo.ts` (guarded by `determinism.spec.ts`; this includes fixture builders under `fixtures/`).
- `generate` (I8), its outputs, `golden.spec.ts`, `generator.property.spec.ts`, `generator.perf.spec.ts`, `golden-seeded.json` and the editor are unchanged.
- Vitest runs with `expect.requireAssertions`: every test calls `expect`. Server tests are `src/**/*.spec.ts`; pipeline tests are `pipeline/test/*.test.ts`.
- Code style: 2-space indent, single quotes, no trailing commas, 100 columns. Conventional Commits. Never compound `cd` with another command in shell calls.
- Before reporting done: `npm run check`, `npm run lint`, `npm run test:unit`, `npm run test:pipeline` all green.

## Review Focus

Inputs the spec implies but its listed tests do not pin; each has a test in the owning task.

1. **Seeds outside uint32** (negative, > 2³², fractional such as `-1`, `1.5`) → normalised by `>>> 0`, never throw, same output as the normalised seed (Task 4).
2. **`maxStories` non-finite or > 80 with stories absent** (`Infinity`, `NaN` → `null`; `500` → result `stories ≤ 80`) (Task 4).
3. **Out-of-range or fractional `stories`** (`0.5`, `-3`, `NaN`, `81` → treated as absent and `maxStories` governs; `5.7` → exactly 5) (Task 4).
4. **One malformed member in a multi-parcel array** (empty polygon, or bad `labelPoint`) → the remaining parcels still mass; no throw (Tasks 3 and 4).
5. **Huge targets** (`units: 1e9` on a 25×100 lot) → undershoot result in normal time, `units === 1e9`, `massingApproximate` true; `units: Infinity` → `null` (Task 4).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/generator/types.ts` (modify) | `source` union widening |
| `src/lib/map/palette.ts`, `palette.spec.ts` (modify) | `colorFor` accepts all three sources |
| `src/lib/generator/units.ts` (create) | helpers, candidates, choice, composition, scaling, `generateForUnits(With)` |
| `src/lib/generator/assemble.ts` (create) | `frameOffset`, `assembleSite` (spec §4.2 steps 4–6) |
| `src/lib/generator/massing.ts`, `compositions.ts` (modify) | optional `opts` (`coverageScale`, `fallbackStories`) |
| `src/lib/generator/index.ts` (modify) | exports |
| `src/lib/generator/fixtures/build-assembly.ts`, `assembly-*.json`, `tower-fallback.json`, `pipeline-synth.ts` (create) | fixtures |
| `src/lib/generator/units.spec.ts`, `assemble.spec.ts`, `units.property.spec.ts`, `units.perf.spec.ts` (create) | tests |
| `pipeline/test/assembly.test.ts` (create) | real-quantisation seam test |

---

### Task 1: Widen `source`, `colorFor`, and the massing-approximate helpers

**Files:**
- Modify: `src/lib/generator/types.ts:13`, `src/lib/map/palette.ts:103-110`, `src/lib/map/palette.spec.ts:53-55`, `src/lib/generator/index.ts`
- Create: `src/lib/generator/units.ts`, `src/lib/generator/units.spec.ts`

**Interfaces:**
- Produces: `GeneratedBuilding.source: 'user' | 'pipeline' | 'scenario'`; in `units.ts`, exported from `index.ts`:
  `export function unitsTolerance(units: number): number` (= `Math.max(1, Math.round(0.1 * units))`),
  `export function massedUnits(b: GeneratedBuilding): number` (= `unitsFor(b.typology, b.floorAreaM2)`),
  `export function massingApproximate(b: GeneratedBuilding): boolean` (= `Math.abs(massedUnits(b) - b.units) > unitsTolerance(b.units)`).

- [ ] **Step 1: Write failing tests.** In `palette.spec.ts` replace the "non-user source throws" test with `'all three sources share the typology colour; unknown throws'`: `colorFor('pipeline','plex','light')` and `colorFor('scenario','plex','light')` `toEqual(colorFor('user','plex','light'))`; `colorFor('bogus' as never,'plex','light')` throws `/unsupported source/`. In `units.spec.ts` (describe `'massing helpers'`): `unitsTolerance(1)===1`, `(9)===1`, `(15)===2`, `(20)===2`, `(100)===10`, `(0)===1`; for a `'user'` building from `generate(std-25x100, {maxStories:5}, …)` `massingApproximate` is false and `massedUnits === b.units`; a hand-built `{...b, units: 20}` (walkup, FA 812.9 → massed 9) is approximate; `{...b, units: 10}` is not.
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/map/palette.spec.ts src/lib/generator/units.spec.ts` — expect FAIL (missing module / throws for pipeline).
- [ ] **Step 3: Implement.** Widen the type (drop the "widens later" comment). `colorFor` returns `GEN_RGBA[theme][TYPOLOGY_ORDER.indexOf(typology)]` when `source` is one of the three, else throws `colorFor: unsupported source ${String(source)}`. Add the three helpers to `units.ts` and export them from `index.ts`.
- [ ] **Step 4: Run** the two spec files plus `npm run check` — PASS.
- [ ] **Step 5: Commit** `feat(generator): widen GeneratedBuilding.source and add massing helpers`.

### Task 2: Optional `opts` on `massTypology` and `referenceComposition`; tower-fallback fixture

**Files:**
- Modify: `src/lib/generator/massing.ts:127-191`, `src/lib/generator/compositions.ts:29-56`
- Create: `src/lib/generator/fixtures/tower-fallback.json`
- Test: `src/lib/generator/massing.spec.ts`, `src/lib/generator/compositions.spec.ts`

**Interfaces:**
- Produces: `export interface MassOpts { coverageScale?: number; fallbackStories?: number }` (in `massing.ts`);
  `massTypology(site, typology, stories, draws, opts?: MassOpts): Massing | null`;
  `referenceComposition(site, typology, stories, draws, opts?: MassOpts): OccupiedComposition | null`.

Semantics (§2, §4.4): with `k = opts?.coverageScale ?? 1` the base-footprint target is `k * rulesFor(typology).coverage * site.A` and the tower plate area `At = k * Math.min(TOWER_PLATE_MAX_M2, TOWER_COVERAGE * site.A)`. Both tower fallbacks (`massing.ts:181`, `compositions.ts:53`) become midrise at `opts?.fallbackStories ?? 12`, passing the same `opts` on. Omitted `opts` must be byte-identical to today: do not multiply by `1` in a way that changes floating results — e.g. branch `k === 1 ? target : k * target` is unnecessary since `1 * x === x` exactly; just keep expressions in the same order. `validTowerBands` still checks against the unscaled maximum (a scaled plate is smaller, so it passes).

- [ ] **Step 1: Find and freeze `tower-fallback.json`.** Write a throwaway script (scratch dir, not committed) that searches rectangles/rotated rectangles (via `fixtures/geom.ts`) with A ≥ 1500 m² for one where `referenceComposition(normaliseSite(poly, GOLDEN.edgeInsetM)!, 'tower', 20, GOLDEN)` returns `typology: 'midrise'` (GOLDEN = `varietyFromUniforms([0.5,0.5,0.5,0.5,0,0.25])`). A long thin lot (e.g. 12 × 140 m) is the likely hit. Save it in the `std-25x100.json` record shape (`id: '0000099'`, vacant, eligible).
- [ ] **Step 2: Write failing tests.**
  - `massing.spec.ts` `'opts omitted is identical'`: for std-25x100, lot-1000, lot-3000 and every replacement typology at stories 3, 6, 12, 20, `massTypology(site,t,s,GOLDEN)` `toStrictEqual` `massTypology(site,t,s,GOLDEN,{})`.
  - `'coverageScale scales the base footprint'`: lot-1000 podium 6 with `{coverageScale: 0.5}` → base part area within 0.01 m² of `0.5 * 0.8 * site.A`; lot-3000 tower 20 with `{coverageScale: 0.5}` → plate area (parts with `baseM > 0`) ≤ `0.5 * Math.min(900, 0.35 * site.A) + 0.01`.
  - `compositions.spec.ts` `'fallbackStories sets the midrise fallback height'`: tower-fallback, `referenceComposition(site,'tower',20,GOLDEN)` → `{typology:'midrise', stories:12}`; with `{fallbackStories: 20}` → `{typology:'midrise', stories:20}`.
- [ ] **Step 3: Run** `npx vitest --run --project server src/lib/generator/massing.spec.ts src/lib/generator/compositions.spec.ts` — FAIL.
- [ ] **Step 4: Implement** the optional argument as specified.
- [ ] **Step 5: Run** all generator specs: `npx vitest --run --project server src/lib/generator` — PASS, including `golden.spec.ts`, `seeded.spec.ts` (golden-seeded byte equality) and property specs, unchanged.
- [ ] **Step 6: Commit** `feat(generator): add coverageScale and fallbackStories massing options`.

### Task 3: `assemble.ts` — `frameOffset`, `assembleSite`, assembly fixtures

**Files:**
- Create: `src/lib/generator/assemble.ts`, `src/lib/generator/assemble.spec.ts`, `src/lib/generator/fixtures/build-assembly.ts`, `fixtures/assembly-pair.json`, `assembly-row.json`, `assembly-street.json`, `assembly-courtyard.json`

**Interfaces:**
- Produces:
  `export function frameOffset(from: readonly [number, number], to: readonly [number, number]): [x: number, y: number]`;
  `export function assembleSite(parcels: readonly ParcelRecord[]): { anchor: ParcelRecord; records: ParcelRecord[]; polygon: [number, number][][] } | null` — performs §4.2 steps 4–6: drop records with a bad `labelPoint` (not an array of two finite numbers), de-duplicate by `id` (keep the first after sorting), sort by `id` ascending (plain `<` string compare), pick the anchor (largest `areaM2`, ties smallest `id`), build the site polygon. `records` is the cleaned, sorted list. Returns `null` when no record remains. One record → its `polygon` unchanged (same array reference is fine). Several → re-frame by `frameOffset(anchor.labelPoint, r.labelPoint)`, resolve each record with `unionD(rings, FillRule.EvenOdd)`, union all with `unionD(all, [], FillRule.NonZero, CLIPPER_PRECISION)`, close with `inset(inset(U, -SIMPLIFY_EPS_M), SIMPLIFY_EPS_M)` (poly.ts `inset`, miter joins), convert back to `[x,y][][]`. Records whose rings are empty/malformed contribute nothing (skip rings with non-finite points or < 3 points); if the union is empty return `{ anchor, records, polygon: [] }` (normaliseSite then returns null).

`frameOffset` algorithm (§4.2, no transcendental `Math`; `Math.sqrt` and `Math.PI` allowed): same constants as `geo.ts` (`A_GRS80 = 6378137`, `E2_GRS80 = 0.0066943800229`, `LON0 = -122.45`, `D2R = Math.PI / 180`). With φ = from.lat, δ = (φ − 37.75)·D2R, literals `S0 = sin 37.75°`, `C0 = cos 37.75°` (full double precision, computed once offline and pasted with a comment):
```
sinP = S0*(1 - δ²/2) + C0*(δ - δ³/6);   cosP = C0*(1 - δ²/2) - S0*(δ - δ³/6)
g = (from.lng - LON0)*sinP*D2R;          cg = 1 - g²/2;   sg = g - g³/6
W = 1 - E2*sinP²;  M = A*(1-E2)/(W*√W);  N = A/√W
e = (to.lng - from.lng)*N*cosP*D2R;  n = (to.lat - from.lat)*M*D2R
return [e*cg - n*sg, e*sg + n*cg]
```
(This mirrors `localFrame(from).from(...to)`, `geo.ts:13-36`.)

- [ ] **Step 1: Fixture builder.** `fixtures/build-assembly.ts` (run with `npx tsx src/lib/generator/fixtures/build-assembly.ts`, header comment like `build-golden-seeded.ts`). For each fixture: define lots as polygons in absolute EPSG:7131 metres near (6000, 11000)-ish grid offsets around the label area used by other fixtures (any SF location); for each lot compute its label point as the polygon's interior point, convert to lng/lat with proj4 (EPSG:7131 def as in `pipeline/test/local-frame.test.ts:25-28`), round to 1e-7°, project the rounded point back to 7131 `(x0, y0)`, and store rings as `Math.round((v - (x0,y0)) * 100) / 100` (cm, like `pipeline/lib/rings.ts:7`). No `Math.sin/cos/...` in the file (proj4 does it). Fixtures: `assembly-pair` (two adjacent 7.62 × 30.48 m lots sharing a long edge, different ids, one slightly larger), `assembly-row` (four adjacent lots, one L-shaped), `assembly-street` (two lots 20 m apart), `assembly-courtyard` (three project lots forming a U around a fourth lot; the fourth lot is stored in the JSON under `excluded`, the three under `parcels`). Each JSON: `{ parcels: ParcelRecord[], excluded?: ParcelRecord }`, records vacant and eligible, `areaM2` = ring area.
- [ ] **Step 2: Write failing tests** in `assemble.spec.ts`:
  - `'frameOffset matches localFrame within 1e-6 m'`: 1,000 pairs from `mulberry32(1)`; `from` uniform in lng [−122.52, −122.35], lat [37.70, 37.83]; `to` within 2 km (offset in degrees); compare to `localFrame(from).from(...to)` component-wise ≤ 1e-6.
  - `'frameOffset matches EPSG:7131 differences'`: 500 pairs; 7131 grid difference via proj4 of `to` minus proj4 of `from`; error ≤ 0.02 m when distance ≤ 200 m, ≤ 0.05 m when ≤ 500 m.
  - `'pair → one component, area = Σ areaM2 ± 0.5, anchor larger lot'`: `assembleSite(pair.parcels)` → `normaliseSite(polygon, 0.4)` non-null, `polygon.filter(r => signedArea>0)` has one outer ring, `domainArea(site.originalDomain)` within 0.5 m² of the sum, `anchor.id` is the larger lot; with equal-area copies (same `areaM2` overridden) the anchor is the smaller id.
  - `'row → one component'` (one outer ring, area within 1 m² of the sum).
  - `'street → two components; normaliseSite keeps the larger'`: the union has two outer rings; `site.A` within 0.5 m² of the larger lot's area (minus nothing — the closing does not bridge 20 m).
  - `'courtyard → the excluded lot is a hole'`: `site.originalDomain` has a negative ring; `domainArea` of the intersection of `site.domain` with the excluded lot (re-framed via `frameOffset`) ≤ 0.01 m².
  - `'input order and duplicates do not matter'`: reversed + duplicated input gives `toStrictEqual` output.
  - Review focus 4: `'a malformed member is skipped'`: pair plus a record with `labelPoint: [NaN, 0]` and one with `polygon: []` → same polygon as the pair alone (records list excludes the bad-labelPoint one).
  - `'bad labelPoints everywhere → null'`; `'[] → null'`.
- [ ] **Step 3: Run** `npx vitest --run --project server src/lib/generator/assemble.spec.ts` — FAIL.
- [ ] **Step 4: Implement** `assemble.ts`.
- [ ] **Step 5: Run** `assemble.spec.ts` and `determinism.spec.ts` — PASS. If the proj4 accuracy bound fails, stop and report the measured error (it is a spec claim, not a tunable).
- [ ] **Step 6: Commit** `feat(generator): assemble multi-parcel sites in one local frame`.

### Task 4: `generateForUnits` — normalisation, candidates, choice, composition (k = 1)

**Files:**
- Modify: `src/lib/generator/units.ts`, `src/lib/generator/index.ts`
- Create: tests in `src/lib/generator/units.spec.ts`

**Interfaces:**
- Consumes: Task 2 `referenceComposition(..., opts?)`, Task 3 `assembleSite`, existing `selectTypology`, `compositionOptions`, `serializeComposition`, `roofAccents`, `retainsCapacityAcrossHeights`, `occupiedArea`, `unitsFor`, `drawVariety`, `drawComposition`, `normaliseSite`.
- Produces (in `units.ts`):
  `export interface MassingCandidate { ref: OccupiedComposition; cap: number }` (`cap = unitsFor(ref.typology, round1(occupiedArea(ref.bands)))`);
  `export function massingCandidates(site: Site, U: number, draws: VarietyDraws, bound: { stories: number } | { maxStories: number }): MassingCandidate[]` (internal, not in index; tests use it for c_min/c_max/cap(S));
  `export function generateForUnitsWith(parcels: ParcelRecord | ParcelRecord[], units: number, maxStories: number, draws: VarietyDraws, compositionDraws: CompositionDraws, stories?: number): GeneratedBuilding | null`;
  `export function generateForUnits(parcel: ParcelRecord | ParcelRecord[], units: number, maxStories: number, seed: number, stories?: number): GeneratedBuilding | null` — `s = seed >>> 0`, then `generateForUnitsWith(parcel, units, maxStories, drawVariety(s), drawComposition(s), stories)`. Exported from `index.ts`.

Behaviour — follow §4.1–4.4 exactly; the decisions the spec leaves open are fixed here:
- Step order and null rules: §4.2 steps 1–7 (units, stories validity, seed, parcels via `assembleSite`, site via `normaliseSite(polygon, draws.edgeInsetM)`). `existingUnits`, `existingFloorAreaM2`, `existingHeightM`, `landUse`, `eligible` are never read.
- `massingCandidates` implements §4.3 (`promote`, unknown-stories loop over `S = 1..Smax` with dedupe by the reference's `(typology, stories)`, keeping the first; known-stories uncapped typology table with `fallbackStories: S` and the walkup retry). Null references are dropped. Order: ascending stories, then I10 order.
- Choice: §4.4 cases 1–3 over the candidates. No candidates → `null`.
- Composition walk (k = 1): `compositionOptions(site, ref, compositionDraws)`; serialise each with `serializeComposition(record, site, candidate, roofAccents(site, candidate, compositionDraws, draws.parapetM), compositionDraws.tone, ref)` where `record = { ...anchor, polygon }`; skip `null`/empty parts, and non-simple families failing `retainsCapacityAcrossHeights(candidate, ref, output.area, output.growth)`. Massed units of an option = `unitsFor(candidate.typology, round1(output.area))`. Accept the first option within `unitsTolerance(U)` of `U`. Else: case 3 → the option with the most massed units (ties family order); cases 1/2 → hand off to scaling (Task 5). Until Task 5 lands, cases 1/2 without a tolerant option use the **k = 1 fallback option**: the option with the smallest `|massed − U|`, ties family order. No options at all → `null`.
- Result: §4.4 "Result" (`floorAreaM2 = round1(output.area)`, `units = U`, `source: 'pipeline'`, `replacesExisting: true`, `parcelId = anchor.id`, `stories = candidate.stories`, `composition = candidate.family`, `parts = output.parts`).
- Add a JSDoc block on `generateForUnits` documenting the accepted floor-height overshoot (§4.5: 65 stories ≈ 666 ft vs a 650 ft limit, +2.4% plus parapet, a visual effect of the tier-3 `stories = floor(ft/10)` rule) and that `unitsTolerance` is tier 4.

- [ ] **Step 1: Write failing tests** in `units.spec.ts` (describe `'generateForUnits'`), using `generateForUnitsWith(P(fixture), U, maxS, GOLDEN, SIMPLE, stories?)` with `GOLDEN`/`SIMPLE` exactly as `golden.spec.ts:23-24`:
  - G1 `std`, U 9, stories 5 → `{typology:'walkup', stories:5}`, `|FA − 812.9| ≤ 2`, not approximate.
  - G2 `lot-1000`, U 59, stories 6 → podium, `|FA − 4800| ≤ 2`.
  - G3 `std-over-apartment`, U 3, stories 3 → plex 3, `|FA − 418.1| ≤ 2`, `replacesExisting` true; and `generate(overApt, {maxStories:3}, fnv1a32(overApt.id), 'max')` is `null`.
  - G4 `std`, U 20, maxStories 80, no stories → walkup 5, `units` 20, `massedUnits` 9, `massingApproximate` true.
  - G6 `std`, U 5, stories 3 → walkup 3, `massedUnits` 5.
  - G7 `std`, U 17, stories 8 → midrise 8.
  - G8 `tower-fallback`, U = its midrise-20 cap (compute via `massingCandidates(site, 1, GOLDEN, {stories:20})[0].cap`), stories 20 → midrise 20.
  - G9 `lot-3000`, U 754, stories 65 → tower 65; the highest `role:'occupied'` part has `topM` 202.9 (`4.5 + 64*3.1 = 202.9`), and with a cap-enabled draw a roof part's `topM` is `202.9 + parapetM` rounded to cm.
  - Nulls: units `NaN`, `0`, `0.9`, `Infinity`; `[]`; every parcel with a bad `labelPoint`; `tiny` and `sliver`; stories absent with maxStories `0`.
  - Stories 920 → treated as absent (result `stories ≤ 80`, and equals the no-stories result).
  - `eligible: false` and `existingUnits: 50` (U 9, stories 5) still return walkup 5.
  - `source === 'pipeline'`; units 12.7 → `units === 12`; `typology !== 'adu'` for U 1 stories 1 on `std` (plex 1).
  - Review focus 1: `generateForUnits(std, 9, 80, s, 5)` for `s ∈ {-1, 1.5, 2**32 + 7}` equals the call with `s >>> 0`; none throw.
  - Review focus 2: stories absent with maxStories `Infinity` or `NaN` → `null`; maxStories `500` on `lot-3000`, U 2000 → `stories ≤ 80`.
  - Review focus 3: stories `0.5`, `-3`, `NaN`, `81` → same as stories absent; stories `5.7` on `std` U 9 → `stories === 5`.
  - Review focus 4: `[std, {...std, id:'x', labelPoint:[NaN,0]}]` gives the same building as `std` alone.
  - Review focus 5: `std`, units `1e9`, maxStories 80 → non-null, `units === 1e9`, approximate, and the call takes < 50 ms.
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/generator/units.spec.ts` — FAIL.
- [ ] **Step 3: Implement** as specified above.
- [ ] **Step 4: Run** `units.spec.ts`, `determinism.spec.ts`, and `npm run check` — PASS.
- [ ] **Step 5: Commit** `feat(generator): mass pipeline projects from units with generateForUnits`.

### Task 5: Footprint scaling (k < 1) and assembly massing tests

**Files:**
- Modify: `src/lib/generator/units.ts`
- Test: `src/lib/generator/units.spec.ts`, `src/lib/generator/assemble.spec.ts`

**Interfaces:**
- Consumes: Task 2 `referenceComposition(site, typ, stories, draws, { coverageScale: k, fallbackStories })`, Task 4 internals.
- Produces: no new exports; replaces Task 4's interim "k = 1 fallback option" for cases 1/2 with §4.4 "Footprint scaling".

Fixed decisions (§4.4 leaves these open):
- Bisection on `k` over `(lo, hi) = (0, 1)`, at most 20 iterations (`const SCALE_ITERATIONS = 20`, commented "internal numerical setting"), midpoint `k = (lo + hi) / 2`. A scaled reference is *too small* when it is `null` or its `typology` differs from the unscaled reference's; then `lo = k`. Otherwise its massed units are `unitsFor(typ, round1(occupiedArea(scaled.bands)))`; record `(k, massed)`; if `massed === U` stop; if `massed > U` then `hi = k` else `lo = k`.
- Pick the recorded `k` with the smallest `|massed − U|`, ties to the smaller `k`. Serialise it as composition `'simple'` (`roofAccents` per `capEnabled` as usual) and measure its massed units from the serialised area. Use it only if serialisation succeeds and its `|massed − U|` is strictly smaller than the k = 1 fallback option's (Task 4's definition); otherwise use the k = 1 fallback option.
- `fallbackStories` passed when rebuilding is the same value the unscaled reference used (`S` on the known-stories path, otherwise omitted).

- [ ] **Step 1: Write failing tests** in `units.spec.ts`:
  - G5 `lot-1000`, U 30, stories 6 → podium 6, `composition === 'simple'`, `massedUnits ∈ [30, 33]`, `FA < 4800`.
  - `'scaling only shrinks'`: `std`, stories 5, U 6 → walkup 5, `massedUnits ∈ [6, 7]`, base footprint area < the U 9 result's.
  - `'tower scaling below the minimum plate stays a tower or falls back to k=1'`: `lot-3000`, stories 20, U 50 → result non-null, `typology === 'tower'`, `stories === 20`.
  - In `assemble.spec.ts` (needs `generateForUnits`): `'street → parts lie inside the larger lot'` (every part's footprint, via `fromLngLat(part.footprint, anchor.labelPoint)`, is inside the larger lot's ring re-framed, tolerance 0.02 m — use `insideDomain` with the lot inset by −0.02); `'courtyard → no part intersects the excluded lot'` (intersection area ≤ 0.01 m²); `'pair → parcelId is the anchor and the massing spans the lot line'` (base footprint area > the larger single lot's area).
- [ ] **Step 2: Run** both spec files — the new tests FAIL.
- [ ] **Step 3: Implement** scaling as specified.
- [ ] **Step 4: Run** `npx vitest --run --project server src/lib/generator` — PASS.
- [ ] **Step 5: Commit** `feat(generator): scale pipeline footprints down to the recorded units`.

### Task 6: Property tests P1–P7

**Files:**
- Create: `src/lib/generator/units.property.spec.ts`

**Interfaces:**
- Consumes: `generateForUnits`, `generateForUnitsWith`, `massingCandidates`, `massedUnits`, `massingApproximate`, `unitsTolerance`, `generate`, `normaliseSite`; reuse the site arbitraries of `generator.property.spec.ts:36-80` (copy `arbSite` and `parcel()` locally, or move them to `fixtures/arbitraries.ts` and import from both files without changing their values).

All with `fc.assert(..., { numRuns: 1000 })`, vacant parcels (`existingUnits: 0`, `existingFloorAreaM2: 0`), seeds `fc.integer({min: 0, max: 0xffffffff})` and real draws via `generateForUnits` unless noted. Candidate capacities come from `massingCandidates(site, U, drawVariety(seed), bound)` with `site = normaliseSite(polygon, drawVariety(seed).edgeInsetM)`; discard cases with `fc.pre` when the site or candidates are empty.

- [ ] **Step 1: Write the tests.**
  - P1 unknown stories: draw `f ∈ [0,1]`; compute `c_min/c_max` from candidates at `U0 = 5` (promotion fixed); `U = Math.round(max(5, c_min) + f * (c_max − max(5, c_min)))`; `fc.pre(c_max ≥ 5)`; recompute candidates at `U` and `fc.pre(U ≥ max(1, c_min(U)) && U ≤ c_max(U))`; result with maxStories 80 is non-null and not `massingApproximate`.
  - P2 known stories: `S ∈ 1..40`, `cap(S)` from `massingCandidates(…, {stories:S})` at `U0 = 1`; `fc.pre(cap ≥ 1)`; `U = max(1, round((0.4 + 0.6 f) * cap))`; recompute `cap(S)` at `U` and `fc.pre` that its typology equals the `U0` one (promotion can switch plex→walkup); result `stories === S` and not approximate.
  - P3 undershoot: `U = c_max + unitsTolerance(c_max) + 1 + d`, `d ∈ 0..50` (candidates recomputed at `U`; c_max for that U). Result approximate and `massedUnits(b) === c_max(U)`. (Plan note: the spec's literal "U > c_max" would include `U = c_max + 1`, which §4.4 case 1 classifies as matched; the margin keeps P3 consistent with §4.4.)
  - P4 order: for each of the four assembly fixtures and every permutation of its parcels (≤ 24), with and without one duplicated entry, `generateForUnits(perm, U, 80, seed)` `toStrictEqual` the sorted-input result, for U ∈ {5, 20, 60} (a plain `it` loop is fine; still ≥ 1 `expect`).
  - P5 determinism: same args twice `toStrictEqual`; seed `s` vs `s + 2**32` `toStrictEqual`.
  - P6 geometry: every part's footprint is an open ring (first ≠ last) of ≥ 3 vertices; every upper occupied part (`baseM > 0`) lies inside some occupied part whose `topM === baseM` (pre-parapet; occupied parts only), checked in local metres via `fromLngLat(fp, parcel.labelPoint)` and `insideDomain(..., inset(below, -0.02))`; every part lies inside `inset(site.originalDomain, -0.02)`. Mirror the existing checks in `generator.property.spec.ts` for the same assertions.
  - P7 editor compatibility: `S ∈ 1..80`, `b = generate(p, {maxStories: S}, seed, 'max')`, `fc.pre(b !== null)`; `generateForUnits(p, b.units, 80, seed, b.stories)` `toStrictEqual({ ...b, source: 'pipeline' })`.
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/generator/units.property.spec.ts`. Expected PASS. Any failing counterexample is a defect in Tasks 4–5 (fix there, add the counterexample as a unit test in `units.spec.ts`), unless it contradicts the spec text, in which case stop and report it with the counterexample.
- [ ] **Step 3: Commit** `test(generator): property tests for generateForUnits`.

### Task 7: Perf fixture and budget

**Files:**
- Create: `src/lib/generator/fixtures/pipeline-synth.ts`, `src/lib/generator/units.perf.spec.ts`
- Modify (only if the budget fails): `src/lib/generator/units.ts`

**Interfaces:**
- Produces: `export interface PipelineCase { parcels: ParcelRecord | ParcelRecord[]; units: number; maxStories: number; stories?: number; seed: number }` and `export function pipelineSynth(seed: number): PipelineCase[]` (2,000 cases).

`pipelineSynth` (no transcendental Math; `mulberry32(seed)`): 1,800 single lots from `synthParcels(1800, seed)` made vacant, targets split by `r()`: 60% known stories `S = 1 + floor(r()*40)`, `U = max(1, round((0.4 + 0.6 r()) * cap(S)))` (cap from `massingCandidates` at `U0 = 1` with `drawVariety(fnv1a32(id))`; skip to the next mode if no candidate); 30% unknown stories with `U` uniform in `[max(1, c_min), c_max]` (candidates at `U0 = 5`, maxStories 80); 10% undershoot `U = c_max + 1 + floor(r()*100)`. Plus 200 assemblies: 2–4 adjacent 7.62 × 30.48 m lots in a row, each with its own label point and cm-quantised rings — build them from one absolute row using `frameOffset`'s inverse is not available, so instead construct each lot's local ring as the absolute lot minus the lot's own centre and set label points by `localFrame(anchorLabel).to(centre)` (geo.ts, allowed) rounded to 1e-7°, then re-derive each ring as absolute minus `frameOffset(anchorLabel, labelPoint)` quantised to cm. Seeds `fnv1a32('proj-' + i)`.

- [ ] **Step 1: Write the perf spec** (`describe('generateForUnits performance budget (§4.7)')`, timeout 120 s): build cases with `pipelineSynth(20261016)`; warm up with one pass over the first 200; time each of the 2,000 calls individually with `performance.now()`; log mean/p99/total like `generator.perf.spec.ts`; assert `mean ≤ 0.4`, `p99 ≤ 4`, `total ≤ 1000` (ms), and that ≥ 90% of results are non-null.
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/generator/units.perf.spec.ts`.
- [ ] **Step 3: If it fails,** optimise `massingCandidates` per §4.7 "Internal": within one typology run of the unknown-stories loop, build references directly at the run's first two story counts and extrapolate `occupiedArea` linearly for the rest (`area(S) = a0 + (S − S0)·(a1 − a0)/(S1 − S0)`), computing `cap` from the extrapolated area; the chosen candidate is always rebuilt directly before composition. Add a unit test in `units.spec.ts` that for std, lot-1000, lot-3000 and tower-fallback the extrapolated caps equal directly computed caps for every S in 1..80 (if any differ, extrapolation is not exact for that typology — build those directly instead). Re-run Task 6's property spec and Task 4/5 specs.
- [ ] **Step 4: Run** the perf spec — PASS.
- [ ] **Step 5: Commit** `test(generator): perf budget for generateForUnits` (plus `perf(generator): …` if Step 3 ran, as a separate commit).

### Task 8: Pipeline quantisation seam test and final verification

**Files:**
- Create: `pipeline/test/assembly.test.ts`

**Interfaces:**
- Consumes: `generateForUnits` and `assembleSite`/`normaliseSite` from `src/lib/generator`; the mini fixture via `miniDuck()` + `runSql(db)` + `writeChunks(db, dir, 'fixture-1', new Report())` and `decodeParcelChunk` as in `pipeline/test/chunks.test.ts:1-27`.

- [ ] **Step 1: Find two adjacent parcels** in the mini fixture's chunk output: decode every chunk, and for pairs in the same block (same first 4 characters of `id`) whose re-framed rings (via `frameOffset`) have a shared edge (some vertex of one within 0.05 m of the other's boundary, at ≥ 2 vertices). Freeze the chosen two ids as constants in the test with a comment saying how they were found. If no adjacent pair exists in the mini fixture, stop and report (the fixture is owned by data-pipeline).
- [ ] **Step 2: Write the test** `'two adjacent mini-fixture parcels assemble into one component'`: `assembleSite([a, b])` polygon has exactly one outer ring; `normaliseSite(polygon, 0.4)` non-null with `domainArea(site.originalDomain)` within 0.5 m² of `a.areaM2 + b.areaM2`; `generateForUnits([a, b], 4, 80, fnv1a32('mini-assembly'))` non-null with `parcelId` equal to the larger-area id.
- [ ] **Step 3: Run** `npm run test:pipeline` — PASS (the whole pipeline project, since `src/lib/generator` joins the dataset hash).
- [ ] **Step 4: Full verification:** `npm run check`, `npm run lint` (run `npm run format` first if only Prettier complains), `npm run test:unit` — all green. Confirm `git diff a6530f3 -- src/lib/generator/generate.ts src/lib/generator/golden.spec.ts src/lib/generator/fixtures/golden-seeded.json` is empty.
- [ ] **Step 5: Commit** `test(pipeline): assemble adjacent mini-fixture parcels with generateForUnits`.
