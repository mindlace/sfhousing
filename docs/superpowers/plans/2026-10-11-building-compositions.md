# Generated Building Compositions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate varied, parcel-fitted building compositions that make dense neighborhoods and tall skylines understandable from the simulator's elevated view.

**Architecture:** Normalize a hole-aware buildable domain, construct a simple reference, and select a deterministic compatible composition whose occupied floor bands satisfy support and capacity constraints. Add bounded roof geometry and flat tones, then pack the same supported solids through the existing generated-layer renderer. Keep generation and accounting pure and worker-safe.

**Tech Stack:** TypeScript, clipper2-ts 2.0.1, Svelte 5, deck.gl SolidPolygonLayer, Vitest/fast-check, Playwright. No new runtime dependencies or texture assets.

**Spec:** [Approved design](../specs/2026-10-11-building-compositions-design.md), commit `1b91509`.

## Global Constraints

- The painted value remains an allowed-story ceiling.
- Existing parcel-size caps, floor heights, typology rules, efficiency, average unit areas, maximum-unit rules, and replacement-gain checks remain in force.
- Paired towers share the existing total upper-plate area budget; each tower does not receive a separate 900 m² allowance.
- Each upper volume must have at least 150 m² of floor plate, retain a six-metre-wide core after fitting, and be separated from its sibling by at least six metres.
- Every occupied component must survive a 1.5 m inward offset.
- A richer candidate must retain at least 90% of the validated simple reference's gross floor area and at least 90% of its unit count, rounded up.
- At most eight occupied solids and two roof accents.
- At most 128 footprint vertices across all emitted solids.
- At most four fitted parameter candidates per family before falling back.
- A validated simple reference may exceed the vertex or component budget when its parcel boundary requires it; retain that reference without accents and record this case in the benchmark.
- Roof accents stay within the existing building-specific parapet allowance above `floorTop(typology, stories)`.
- Keep the existing six geometry draws untouched.
- Keep one settled generated layer per cell and the existing transient rising layers.
- Retain revision ordering, hide/restore behavior, reduced-motion behavior, and the 400 ms rise animation.
- First rising frame within 30 ms of receiving a 500-parcel update; no main-thread long task above 50 ms during a whole-city update; real-GPU p95 pan frame time at or below 16.7 ms on the documented M2-class target.
- The existing 150 ms pointer-up-to-display target for at most 500 loaded parcels remains the end-to-end target, including composition candidate evaluation.
- There is no parcel-data schema, database, brush-plan, or shared-plan payload change.
- As-built rendering is independent. Do not modify the pipeline, existing-building tiles, or the other agent's rendering implementation.

## Review Focus

1. Concave parcels can contain all candidate vertices while an edge crosses excluded land: test full polygon difference, not vertex containment (Tasks 1 and 5).
2. Rounding lng/lat can collapse a part or invalidate support: validate final rings and never retain housing totals for discarded occupied geometry (Task 5).
3. A retained-floor-area candidate can still fail unit retention because of rounding or existing development: validate the actual unit formula and gain checks before choosing it (Tasks 2 and 5).
4. Two touching ground-up solids with different tones can produce coincident faces: avoid conflicting tones on shared exterior faces and test the rendered result (Task 6).
5. New typed-array fields can disappear during transfer or animation finalization: test the actual worker transfer, concatenation, revision reset, and reduced-motion paths (Task 6).

## File and dependency map

All paths below are repository-relative within the attached `building-compositions` worktree. Reuse that worktree; do not create another. Tasks 1–6 depend on their predecessors; Task 7 validates the integrated result.

| Area | Files | Responsibility |
| --- | --- | --- |
| Domain | Modify `src/lib/generator/site.ts`, `poly.ts`, `massing.ts`; create `domain.ts` | Hole-aware largest component, area, simple-ring fitting, full containment |
| Internal model | Create `composition-types.ts`, `bands.ts`, `composition-variety.ts` | Occupied bands, accounting/support, independent deterministic draws |
| Recipes | Create `compositions.ts`, `roof.ts`; modify `constants.ts` | Family candidates, fitting, validation, roof accents |
| Generator integration | Modify `generate.ts`, `types.ts`, `index.ts`, `geo.ts` | Candidate selection, safe serialization, capacity output |
| Appearance/rendering | Create `src/lib/map/appearance.ts`; modify `types.ts`, `pack.ts`, `palette.ts`, `generated-controller.ts` | Appearance byte, palette lookup, existing layer lifecycle |
| Fixtures/validation | Modify colocated tests, fixture builders, `src/lib/sim/test/harness.ts`, `src/lib/map/test/synthetic-city.ts`, `e2e/map.spec.ts`, `e2e/bench/map-pan.bench.ts` | Updated contracts, real compositions, regression and performance evidence |
| Copy/contracts | Modify `README.md`, `src/routes/about/+page.svelte`, relevant generator/map spec sections, `docs/dev/map-perf.md` | Accurate model assumptions, internal interfaces, measured results |

The tree currently has no installed dependencies. At execution, use Node 24 and `npm ci` in this worktree, then run the existing baseline checks before changing product code. Run focused tests for each task; reserve the full gate for integration. Do not install dependencies or run application tests just to review this plan.

## Task 1: Preserve the parcel domain and fit safe simple reference footprints

**Files:** Create `src/lib/generator/domain.ts`, `domain.spec.ts`; modify `site.ts`, `site.spec.ts`, `poly.ts`, `poly.spec.ts`, `massing.ts`, `massing.spec.ts`, and the holed case in `golden.spec.ts`.

**Interfaces:** Keep `normaliseSite(polygon: [number, number][][], edgeInsetM: number): Site | null`. Extend `Site` with `originalDomain: PathsD` and `domain: PathsD`; preserve `P`, `c`, `u`, `v`, and `Q`. Domain contours use positive outers and negative holes; `A` excludes holes. Export `domainArea(domain: PathsD): number`, `insideDomain(region: PathsD, domain: PathsD): boolean`, and `fitSimpleRegions(region: PathsD, site: Site): PathsD` from `domain.ts`. Returned simple regions have disjoint interiors, positive area, and no holes. Keep existing `totalArea` for hole-free region lists; do not use its absolute-contour sum for domain area.

- [ ] **Step 1: Add failing tests for domain preservation and full containment.** In `domain.spec.ts` use `rectRing(20, 20)` with a central `rectRing(4, 4)` exclusion. A rectangle straddling that hole must fail `insideDomain`; a bridge across the notch of `uRing(20, 20, 8, 12)` must fail even when its four vertices are inside. Reverse/rotate contour starts and assert identical normalized domains. In `site.spec.ts`, replace “holes are dropped” with exclusion preservation; keep malformed-ring, multipart, tiny, and sliver assertions.

```ts
it('subtracts holes from parcel area', () => {
  const site = normaliseSite([rectRing(20, 20), rectRing(4, 4)], 0.4)!;
  expect(domainArea(site.originalDomain)).toBeCloseTo(384, 2);
});
```

- [ ] **Step 2: Run `npx vitest --run --project server src/lib/generator/domain.spec.ts src/lib/generator/site.spec.ts`.** Expect the new domain/API assertions to fail before implementation.
- [ ] **Step 3: Implement the interfaces above.** Use existing Clipper even-odd resolution and polygon boolean operations. Select the largest connected component with its holes. Intersect the simplified domain with the original before insetting. Measure net signed contour area. For an unrepresentable holed candidate, try slab cuts through each hole's projected min/max on `u` then `v`, in canonical hole order, keeping valid simple pieces. Bound this reference fitting to four cuts per hole and one pass over the resulting components; reject unresolved holes safely. Canonicalize and sort components by area then canonical vertices. Update `baseFootprint` to use signed domain intersections instead of hole-blind slab area, and ADU clipping to use the actual domain. Preserve existing ADU declared-gross-area accounting.
- [ ] **Step 4: Run `npx vitest --run --project server src/lib/generator/domain.spec.ts src/lib/generator/site.spec.ts src/lib/generator/poly.spec.ts src/lib/generator/massing.spec.ts src/lib/generator/golden.spec.ts`.** Expect PASS; change only the explicitly superseded holed golden assertion. Add a multiple-hole case proving the fitter terminates and emits no filled exclusions. Non-holed hand-calculated references must remain within their existing tolerances.
- [ ] **Step 5: Commit the domain/reference deliverable.** `git add` only the files above; commit `feat: preserve parcel exclusions in generated footprints`.

## Task 2: Add occupied floor bands and independent composition draws

**Files:** Create `src/lib/generator/composition-types.ts`, `bands.ts`, `bands.spec.ts`, `composition-variety.ts`, `composition-variety.spec.ts`; add numeric guardrails to `constants.ts`. Public `GeneratedBuilding` stays unchanged in this task.

**Interfaces:** Define `CompositionId = 'simple' | 'terrace' | 'divided' | 'slab' | 'shouldered' | 'offset' | 'paired'`; `FloorBand = { firstFloor: number; floors: number; regions: PathsD }`; `OccupiedComposition = { family: CompositionId; typology: TypologyId; stories: number; bands: FloorBand[] }`. Regions are hole-free; floor numbering starts at one. Export `occupiedArea(bands: readonly FloorBand[]): number`, `bandsSupported(bands: readonly FloorBand[]): boolean`, `unitsFor(typology: TypologyId, floorAreaM2: number): number`, and `retainsCapacity(candidate: OccupiedComposition, reference: OccupiedComposition): boolean` from `bands.ts`.

Define `CompositionDraws = { familyOrder: CompositionId[]; splitFraction: number; setbackM: number; shoulderFloors: 1 | 2; offsetSign: 1 | -1; capEnabled: boolean; tone: 0 | 1 | 2 }`; export `drawComposition(seed: number): CompositionDraws` from `composition-variety.ts`. Numeric seed is the caller's existing parcel-derived seed. Named stream hashes are `fnv1a32('composition:' + name + ':' + seed)`; stream names are `family`, `proportions`, `roof`, and `tone`.

- [ ] **Step 1: Write failing accounting/seed tests.** A 100 m² base for two floors plus disjoint 20 m² and 30 m² siblings for three floors gives `expect(occupiedArea(bands)).toBe(350)`. An overlapping sibling input must not double-count area; unsupported upper geometry fails `bandsSupported`. For a six-floor 100 m² podium reference, a final-floor 20 m² cut retains 580/600 m² and seven units and passes; a 40 m² cut retains sufficient area but drops to six units and fails the rounded-up seven-unit minimum; a 70 m² cut fails the area bound. Verify named streams repeat exactly and existing `drawVariety(seed)` values remain unchanged.

```ts
it('uses the existing rounded-area podium yield', () => {
  expect(unitsFor('podium', 600)).toBe(7);
  expect(unitsFor('podium', 580)).toBe(7);
  expect(unitsFor('podium', 560)).toBe(6);
});
```

- [ ] **Step 2: Run `npx vitest --run --project server src/lib/generator/bands.spec.ts src/lib/generator/composition-variety.spec.ts src/lib/generator/variety.spec.ts`.** Expect new tests to fail for missing exports.
- [ ] **Step 3: Implement the interfaces.** Union regions per band for accounting, split support validation at every floor boundary, and reject same-floor overlap in candidate validation even though the area utility defensively unions it. Round gross area to one decimal before `unitsFor`, matching current yield behavior. Apply both 90% guards and preserve ADU/plex unit caps. Use seeded Fisher–Yates for a uniform family permutation. Map proportions to split fraction 0.4–0.6 and setback 1.5–3.0 m; use integer operations/`sqrt` rather than transcendental math. Add the approved budgets and tower guardrails as named constants.
- [ ] **Step 4: Rerun the focused command; expect PASS.** Add exact-boundary cases around unit rounding, a missing intermediate supporting band, and unequal sibling heights. Verify a roof-only change cannot enter occupied accounting.
- [ ] **Step 5: Commit `feat: model supported floor bands and stable composition choices` with only this task's files.**

## Task 3: Implement low-rise and midrise composition candidates

**Files:** Create `src/lib/generator/compositions.ts`, `compositions.spec.ts`, `fixtures/composition-parcel.ts`; use Tasks 1–2 interfaces. Do not enable recipes in `generate()` yet.

**Interfaces:** Export `referenceComposition(site: Site, typology: ReplacementTypology, stories: number, draws: VarietyDraws): OccupiedComposition | null`; convert validated legacy massing to floor bands, retaining a fallback's actual typology/stories. Export `compositionCandidates(site: Site, reference: OccupiedComposition, draws: CompositionDraws): OccupiedComposition[]`; initially handles simple/terrace/divided. Export `validComposition(site: Site, candidate: OccupiedComposition, reference: OccupiedComposition): boolean`. Create test helper `compositionParcel(id: string, widthM: number, depthM: number, holes?: [number, number][][]): ParcelRecord` with zero existing units/floor area, eligible true, label point `[-122.4194, 37.7749]`, and geometry-derived net area.

- [ ] **Step 1: Write failing forced-family tests.** On a 30×30 m parcel at six floors, assert simple/terrace/divided all produce valid candidates, reach floor six, and retain at least 90% of reference area and rounded units. Force divided on a 7.62×30.48 m five-story parcel: assert a valid fitted candidate or an explicit simple fallback, with no component failing the 1.5 m inward-offset test. Test an L-shaped parcel using the same full-domain check as Task 1.

```ts
it('fits a six-floor terrace while retaining capacity', () => {
  const parcel = compositionParcel('terrace', 30, 30);
  const site = normaliseSite(parcel.polygon, 0.4)!;
  const reference = referenceComposition(site, 'podium', 6, drawVariety(1))!;
  const draws = { ...drawComposition(1), familyOrder: ['terrace' as const] };
  const candidate = compositionCandidates(site, reference, draws)[0];
  expect(candidate.family).toBe('terrace');
  expect(candidate.stories).toBe(6);
  expect(validComposition(site, candidate, reference)).toBe(true);
});
```

- [ ] **Step 2: Run `npx vitest --run --project server src/lib/generator/compositions.spec.ts`; expect FAIL for missing recipe exports.**
- [ ] **Step 3: Implement simple, terrace, and divided recipes.** For five-to-seven-story walkup/podium buildings, change only the last floor: an end slab cut creates terrace; a centered recessed strip splits a broad final floor into two supported regions. At four stories keep simple; three-story plex and ADU massing are unchanged. For eight-to-twelve-story midrises preserve the reference lower six floors, redistribute its upper region into at most two stages, and use one or two final floors for partial setbacks. Try four parameter sizes per family, largest detail first, reducing cut depth/width deterministically before fallback. Never increase reference coverage to make a decorative recipe fit. Canonicalize bands and reject excess solids/vertices, narrow pieces, domain violations, unsupported regions, sibling overlaps, height errors, or failed retention.
- [ ] **Step 4: Rerun the recipe tests and Tasks 1–2 tests; expect PASS.** Add same-typology height sweeps at 5/6/7 and 8–12 floors: with unchanged compatibility, extra allowance extends occupied capacity. Reuse the same family order at each height. Correct the recipe if it introduces a capacity regression; do not delete the existing monotonicity property test.
- [ ] **Step 5: Commit `feat: add parcel-fitted terrace and divided building compositions`.**

## Task 4: Add skyline compositions and restrained roof geometry

**Files:** Modify `compositions.ts`, `compositions.spec.ts`; create `src/lib/generator/roof.ts`, `roof.spec.ts`; extend `composition-types.ts`.

**Interfaces:** Extend `compositionCandidates` with slab/shouldered/offset/paired. Define `RoofAccent = { ring: PathD; baseM: number; topM: number; tone: 0 | 1 | 2 }`. Export `roofAccents(site: Site, composition: OccupiedComposition, draws: CompositionDraws, parapetM: number): RoofAccent[]` from `roof.ts`.

- [ ] **Step 1: Write failing skyline tests on 60×50 m lots at 20/40 stories.** Force each family to the front of `familyOrder`, and assert four recognizably different canonical band geometries. For paired towers assert two upper regions, each area ≥150 m², nonempty inward offset by 3 m, and polygon distance ≥6 m; aggregate upper area stays ≤`min(900, 0.35 × site.A)`. Force paired on a narrow tower-eligible site and expect a different valid family/reference. Roof accents must number ≤2, be supported, and end at or below `floorTop(typology, stories) + parapetM`.

```ts
it('fits a paired skyline on a broad parcel', () => {
  const parcel = compositionParcel('paired', 60, 50);
  const site = normaliseSite(parcel.polygon, 0.4)!;
  const reference = referenceComposition(site, 'tower', 40, drawVariety(1))!;
  const draws = { ...drawComposition(1), familyOrder: ['paired' as const] };
  const candidate = compositionCandidates(site, reference, draws)[0];
  expect(candidate.family).toBe('paired');
  expect(candidate.bands.find((b) => b.firstFloor === 6)!.regions).toHaveLength(2);
  expect(validComposition(site, candidate, reference)).toBe(true);
});
```

- [ ] **Step 2: Run `npx vitest --run --project server src/lib/generator/compositions.spec.ts src/lib/generator/roof.spec.ts`; expect the new family/roof assertions to fail.**
- [ ] **Step 3: Implement the tower recipes.** Keep the five-floor reference base. Fit slab aspect ratios 1.5/1.75/2/2.25; fit the offset recipe toward the seeded end of the long axis; create shoulders by narrowing only the final one or two floors. For paired, split the shared upper-area target by `splitFraction`, place the plates along the long axis with a six-metre gap, and optionally stop the smaller plate one or two floors early. Intersect with the supporting base inset and validate the actual resulting plates, not desired rectangles. Share the four-attempt limit per family and the existing tower fallback to actual midrise massing.
- [ ] **Step 4: Implement `roofAccents` and rerun both tests; expect PASS.** Add at most one inward cap per highest occupied roof until the two-accent/geometry budget is reached. Require a 0.2 m inset from its supporting roof edge; omit failed accents. Give all accents zero occupied floors and exclude them from retention and yields. Test several highest roofs, no room for a cap, and optional-detail removal leaving occupied area exactly unchanged.
- [ ] **Step 5: Commit `feat: add varied skyline compositions and lightweight roof caps`.**

## Task 5: Integrate validated compositions into generator output and scores

**Files:** Modify `src/lib/generator/generate.ts`, `types.ts`, `index.ts`, `geo.ts`, `geo.spec.ts`, `golden.spec.ts`, `generator.property.spec.ts`, `determinism.spec.ts`, `cache.spec.ts`, `generator.svelte.spec.ts`; create `composition-integration.spec.ts`. Update `src/lib/map/containment.spec.ts`, fixture JSON/builders, `src/lib/map/test/synthetic-city.ts`, `src/lib/map/pack.spec.ts`, `src/lib/sim/test/harness.ts`, `src/lib/sim/display.spec.ts`, and `src/lib/scoreboard/score-fixtures.ts` for required output fields. Update generator/map spec interface descriptions in the same commit.

**Interfaces:** Add required `composition: CompositionId` to `GeneratedBuilding` and required `role: 'occupied' | 'roof'`, `tone: 0 | 1 | 2` to each part. Public `generate(parcel, env, seed, mode)` remains unchanged. Append optional `compositionDraws?: CompositionDraws` to `generateDetailed` and `generateWith`; default it to `drawComposition(fnv1a32(parcel.id))`, and have `generate` supply `drawComposition(seed)` explicitly. Keep `LocalPart` index-aligned and add matching role/tone fields. In `geo.ts` export `fromLngLat(ring: readonly (readonly [number, number])[], labelPoint: readonly [number, number]): [number, number][]`, the unrounded inverse of the existing local affine transform.

- [ ] **Step 1: Write failing integration tests.** Force each family on suitable parcels; assert reported floor area equals occupied-band area rounded to one decimal and reported units equal the existing formula. For each candidate, also require the existing replacement-gain checks; a reference that adds units must not become `null` merely because the preferred terrace fails a gain check. Add `fromLngLat(toLngLat(...))` round-trip tests within 0.02 m and a rounding-collapse occupied fragment test proving stale capacity is never reported. Test standard ADU/plex yields unchanged with caps disabled.

```ts
it('reports one total for sibling towers', () => {
  const parcel = compositionParcel('paired', 60, 50);
  const draws = { ...drawComposition(1), familyOrder: ['paired' as const] };
  const detailed = generateDetailed(parcel, { maxStories: 40 }, drawVariety(1), 'max', draws)!;
  expect(detailed.building.composition).toBe('paired');
  expect(detailed.building.units).toBe(unitsFor('tower', detailed.building.floorAreaM2));
  expect(detailed.building.stories).toBe(40);
});
```

- [ ] **Step 2: Run `npx vitest --run --project server src/lib/generator/composition-integration.spec.ts src/lib/generator/geo.spec.ts`; expect FAIL before integration.**
- [ ] **Step 3: Implement selection and serialization.** Try compatible families in the named seeded order, then the validated reference. Apply capacity/gain checks to each candidate before selection. For ADU/plex use the existing occupied reference and accounting exception. Convert floor bands to true vertical intervals with `floorTop`; occupied tops exclude decorative parapet height, which is supplied only by roof accents. Serialize rings with the existing 1e-7° precision, inverse-transform them for full-domain/support validation, and use at most two deterministic 0.02 m inward-repair attempts before rejecting a candidate. Recompute occupied areas after any vertex/region removal; never silently drop an occupied part while keeping old totals. Ground boundary validation is strict against the original parcel; allow the existing 0.02 m numeric tolerance only for coincident support boundaries.
- [ ] **Step 4: Update property tests and fixtures, then run `npx vitest --run --project server src/lib/generator src/lib/map/containment.spec.ts src/lib/sim/display.spec.ts` and `npm run check`.** Replace sequential nesting with union support and whole-region containment. Keep deterministic, rotation, cap-chain, same-typology monotonicity, and gain checks meaningful. Inject simple/no-cap draws into hand-calculated reference tests; update old parapet expectations to the new explicit roof model. Regenerate seeded/map fixture JSON using `npx tsx src/lib/generator/fixtures/build-golden-seeded.ts` and `npx tsx src/lib/map/fixtures/build-fixtures.ts`; inspect changed yields rather than blindly approving snapshots. Run `npx vitest --run --project client src/lib/generator/generator.svelte.spec.ts` to verify server/browser agreement. Expect PASS.
- [ ] **Step 5: Commit `feat: integrate parcel compositions with accurate housing yields`.** Include all typed literal/fixture consumers changed by the new required fields; run `rg -n 'GeneratedBuilding|parts:' src` to find the existing construction sites listed above.

## Task 6: Carry appearance through packing and the generated renderer

**Files:** Create `src/lib/map/appearance.ts`, `appearance.spec.ts`; modify `types.ts`, `pack.ts`, `pack.spec.ts`, `palette.ts`, `palette.spec.ts`, `generated-controller.ts`, `generated-controller.svelte.spec.ts`, `SimMap.svelte.spec.ts`, `src/lib/sim/display.spec.ts`, `src/lib/sim/test/harness.ts`. Update packed-cell interface descriptions in the map spec.

**Interfaces:** Add `partAppearance: Uint8Array` to `PackedCell`. Export `encodeAppearance(role: 'occupied' | 'roof', tone: 0 | 1 | 2): number` and `appearanceColor(theme: Theme, typology: TypologyId, code: number): RGBA` from `appearance.ts`. Byte encoding is `tone + (role === 'roof' ? 4 : 0)`; reject unknown codes in development/tests. Keep `partSlot`, `parcelMeta`, and all public map handles unchanged. Transferable count becomes seven.

- [ ] **Step 1: Write failing pack/appearance tests.** Assert appearance bytes exactly match source roles/tones, survive `concatPacks`, and appear in transfer lists. A paired building's towers and caps share the same parcel slot/summary. Repeat/reordered input must give byte-identical buffers. Extend palette tests across all appearance codes: existing-vs-generated ΔE2000 ≥20 and every lower typology tone's ground contrast below every higher typology tone's contrast, in both themes.

```ts
it('encodes the finite appearance choices', () => {
  expect(encodeAppearance('occupied', 0)).toBe(0);
  expect(encodeAppearance('occupied', 2)).toBe(2);
  expect(encodeAppearance('roof', 0)).toBe(4);
  expect(encodeAppearance('roof', 2)).toBe(6);
});
```

- [ ] **Step 2: Run `npx vitest --run --project server src/lib/map/appearance.spec.ts src/lib/map/pack.spec.ts src/lib/map/palette.spec.ts src/lib/sim/display.spec.ts`; expect FAIL for missing field/appearance behavior.**
- [ ] **Step 3: Implement binary appearance and cached accessors.** Start from fixed ±2% RGB tone adjustments to each existing palette entry, preserve alpha, and use unmodified colors wherever the full contrast checks fail. Do not change typology tokens or add runtime color libraries. Keep accessor identity stable per pack/theme. Use one occupied tone per building initially, with a separate roof-cap tone behind its 0.2 m clearance. Coalesce identical-footprint consecutive bands for rendering where possible without changing occupied accounting. Shared exterior faces therefore cannot have conflicting tones in the ground-up extrusion path; no mesh/base-height buffers are added.
- [ ] **Step 4: Add browser regressions and run the server command plus `npx vitest --run --project client src/lib/map/generated-controller.svelte.spec.ts src/lib/map/SimMap.svelte.spec.ts`.** Verify attached roof/towers through intermediate rise scale, final merge, interrupted animation, revision-0 reset, both themes, and reduced motion. Test a shared-side composition in rendered attributes/screenshots. Assert layer count stays per-cell and metadata totals remain per parcel. Expect PASS; the existing first-frame/update budget assertions remain enabled.
- [ ] **Step 5: Commit `feat: render generated composition tones through binary packs`.**

## Task 7: Validate districts, performance, and model explanations

**Files:** Create `src/lib/map/fixtures/composition-district.ts`, `composition-district.spec.ts`, `e2e/compositions.spec.ts`; modify `src/lib/map/test/synthetic-city.ts`, its new `synthetic-city.spec.ts`, `src/lib/map/debug.ts`, `src/lib/map/SimMap.svelte` only for the existing development-only debug hook, `src/lib/generator/generator.perf.spec.ts`, `src/lib/sim/host.bench.spec.ts`, `e2e/bench/map-pan.bench.ts`, `e2e/map.spec.ts`, `docs/dev/map-perf.md`, `README.md`, `src/routes/about/+page.svelte`, and relevant screenshot baselines.

**Interfaces:** Export `compositionDistrict(seed: number, stories: number): { parcels: ParcelRecord[]; buildings: GeneratedBuilding[] }`, using real `generate` on a translated grid of standard, broad, and irregular local-metre parcels. Add development-only `loadCompositionDistrict(seed: number, stories: number): Promise<{ parcels: number; cells: number }>` to `SfhMapDebug`, installed through the existing `applyGenerated` mechanism. Extend `makeSyntheticCity(seed: number, n?: number, perCell?: number, complexity?: 'representative' | 'worst'): GeneratedUpdate[]`; keep the existing three-argument signature compatible. Extend existing `loadSyntheticCity` with optional third `complexity` argument and pass it to the fixture builder, preserving its `Promise<{ parcels: number; cells: number }>` return. Build benchmark populations by translating cached real generated exemplars, preserving their parts/roles/tones. A separate worst-case exemplar must exercise eight occupied solids, two accents, and up to 128 vertices; assert those counts rather than calling it worst-case by name alone.

- [ ] **Step 1: Write failing district/benchmark tests.** With a fixed seed and sufficiently broad fitting lots, assert all three low-rise families appear at six stories and all four tower families at twenty/forty stories. Verify finite totals, per-parcel support, and deterministic output. Assert representative benchmark population contains every family, caps, and disjoint sibling towers, while worst-case fixtures reach the stated geometry budgets. Reuse these fixtures for the existing 500-parcel update and whole-city long-task checks.

```ts
it('represents every skyline family in a broad-lot district', () => {
  const district = compositionDistrict(42, 40);
  const families = new Set(district.buildings.map((b) => b.composition));
  for (const family of ['slab', 'shouldered', 'offset', 'paired']) {
    expect(families.has(family)).toBe(true);
  }
  expect(district).toEqual(compositionDistrict(42, 40));
});
```

- [ ] **Step 2: Run `npx vitest --run --project server src/lib/map/fixtures/composition-district.spec.ts src/lib/map/test/synthetic-city.spec.ts`; expect FAIL before fixtures/debug integration.**
- [ ] **Step 3: Implement fixtures, debug integration, and visual tests.** Keep generated debug paths behind `VITE_E2E`, after the worker's initial revision-0 snapshot. Capture elevated light/dark views at 5/6/8/12/20/40 stories for desktop and mobile viewports, plus boundary overlays on irregular/holed cases. Test picking either sibling/cap returns the same parcel totals, and paint/erase/undo restores as-built visibility. Add the worst/representative complexity selector to the existing real-GPU benchmark; do not replace the production dataset or hand-edit pipeline fixture data.
- [ ] **Step 4: Run focused tests and measurements.** Run `npx vitest --run --project server src/lib/map/fixtures/composition-district.spec.ts src/lib/map/test/synthetic-city.spec.ts src/lib/generator/generator.perf.spec.ts src/lib/sim/host.bench.spec.ts`, `npx playwright test e2e/compositions.spec.ts e2e/map.spec.ts --project=chromium --project=mobile`, then headed `npm run bench:map`. Parameterize the benchmark as two Playwright cases (`representative` and `worst`) so that command runs both populations. Preserve the existing 150k-generation ≤2,500 ms and worker-host benchmark bars; a failure is evidence to optimize/fall back, not permission to loosen them. Record hardware, renderer, DPR, composition/vertex counts, generation and update times, p50/p95, and pass/fail. Measure the loaded 500-parcel pointer-up-to-display path against 150 ms separately; renderer-only synthetic loading cannot establish that result.
- [ ] **Step 5: Inspect the actual screenshots and document results.** Review roofscape and skyline at normal camera angles, both themes, 375 px and desktop. Expected: coherent five/six-floor neighborhoods, visibly different tower silhouettes, no filled holes, no flickering shared faces, no roof detachment, and no visual detail falsely counted as housing. If real target hardware is unavailable, record that limitation and leave its acceptance check open; do not substitute a fast desktop result for an M2/mobile claim. Update README/About copy to “Estimated housing capacity under the modeled building forms, not a forecast.” Add “Reopening a saved plan uses the current building model, so its appearance and estimated totals can change.” Keep model explanations out of painting controls.
- [ ] **Step 6: Run `npm run signoff -- --verify-only`.** Expect the repository's complete check/lint/unit/e2e gate to pass; do not push or post signoff during this task. Update snapshots only after inspecting the intended visual change. Run `git diff --check` and inspect scope before commit.
- [ ] **Step 7: Commit `test: validate varied building districts and document model estimates`.** Record unresolved hardware acceptance explicitly if applicable. Integration, pushing, or PR creation follows the execution workflow chosen by the user; this planning task does not perform them.

## Self-review and execution boundary

Coverage: spec sections 1–4 are implemented by Tasks 3–4 and explained in Task 7; section 5 by Task 1; sections 6–7 by Tasks 2 and 5; section 8 by Tasks 5–6; sections 9–10 by Tasks 6–7; section 11 by Tasks 5–7. The five Review Focus conditions each have an owning task with explicit assertions.

No product code, dependencies, data, or schemas are changed by writing this plan. Review the plan and choose native execution or subagent-driven execution before implementation. Native execution is recommended: the seven tasks share geometry, capacity, and binary-rendering contracts, so keeping one implementer across them avoids repeated handoffs. Independent review should assess the integrated branch before delivery.
