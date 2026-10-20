# Large-Site Massing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sites of 2 ha or more render as districts (streets, blocks, open space, many buildings) on `/` and `/fzp`. DA phases use curated heights. Masters with no phases are massed instead of drawn as a 1 m sheet.

**Architecture:**
- A pure layout module splits a large site into lots.
- A district module masses each lot with today's per-lot generator. `generate` and `generateForUnits` dispatch to it only when the summed site area is at least `DISTRICT_MIN_M2`, so every smaller site keeps its exact output.
- The result stays one `GeneratedBuilding`, with an additive `lots` field and a per-part `lot` index. The packers colour each lot by its own typology.
- The pipeline adds curated heights to `multiphase.json` and `districtMaxStories` to `projects.json`. The sim passes `{ storyLimit, curatedStories, openSpaceShare }` to `generateForUnits`.

**Tech Stack:** TypeScript, clipper2-ts, Vitest (server, client and pipeline projects), fast-check, Playwright, zod (pipeline only).

**Spec:** `docs/superpowers/specs/2026-10-19-large-site-massing-design.md` (approved 2026-10-19, partner rulings in §8). Read it alongside this plan.

## Global Constraints

- **Byte-identical below the threshold.** Any site whose summed area is under `DISTRICT_MIN_M2 = 20_000` m² gives output byte-identical to `main`. `golden.spec.ts`, G1–G9, P1–P7, `generator.property.spec.ts` and the editor e2e suite stay unchanged and green.
- **Determinism (AC4).**
  - No `Math.sin/cos/atan2/pow/exp` outside `geo.ts`. `determinism.spec.ts` walks the generator directory automatically.
  - Output is pure, and independent of parcel order and duplicates.
  - All randomness comes from `fnv1a32` and `mulberry32` (`seed.ts`).
- **`drawVariety` is frozen at exactly six draws** (`variety.ts`). District draws come from a separate stream, `mulberry32(fnv1a32(`${seed >>> 0}|district`))`, never from new `VarietyDraws` fields. This intentionally departs from the spec's "new variety draws" wording, keeping the frozen stream intact.
- **Evidence tiers.** Every new constant carries its tier in its doc comment:

  | constant | value | tier |
  |---|---|---|
  | `DISTRICT_MIN_M2` | 20000 | 2 |
  | `BLOCK_U_M` | 167 | 2 |
  | `BLOCK_V_M` | 73 | 2 |
  | `STREET_M` | 19.5 | 3 |
  | `LOT_FRONTAGE_M` | 45 | 4 |
  | `LOT_DEPTH_MIN_M` | 20 | 4 |
  | `LOT_MIN_M2` | 400 | 4 |
  | `BLOCK_MIN_M2` | 1000 | 4 |
  | `OPEN_SPACE_SHARE` | 0.15 | 4 |
  | `DISTRICT_DEFAULT_MIN_UNITS` | 100 | 4 |
  | `DISTRICT_MIN_STORIES` | 3 | partner ruling |
  | `DISTRICT_FALLBACK_LIMIT` | 8 | 4 |
- **No invented data.** No curated height is entered without a `Fact` (`url`, `retrieved`, `locator`).
- **Record wins.** A tier-0 stated `stories` is never changed. `units` on every `generateForUnits` result equals `Math.floor(units)`.
- **Code style:** 2-space indent, single quotes, no trailing commas, 100 columns. Every Vitest test calls `expect`.
- **Commits:** Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Use `-m` flags, never heredocs. Never `cd X && cmd`.
- **Dataset version.** `src/lib/generator`, `src/lib/timelapse` and `pipeline/` are in the dataset hash. A new `datasetVersion` and a refreshed fixture golden (`npm run pipeline -- fixture --update-golden`) are expected.

## Review Focus

1. **Threshold boundary.** A 19,999 m² site must equal `main`'s output exactly. A 20,000 m² site must be a district. Pinned in Task 2.
2. **Layout produces no lots.** On a long, thin site of 2 ha or more (a pier 25 m wide by 900 m long), no block passes the width test. The site must still draw, falling back to today's non-district path, not return `null`. Pinned in Tasks 1 and 2.
3. **Paint over a big existing building.** A district parcel whose `existingUnits` exceed the district's total units must give `null`. The I8 rule applies to the whole district, as on parcel 7296004, which has 1,272 existing units on 74,580 m². Pinned in Task 2.
4. **Tiny `U` on a huge site.** `U = 1` and `U = 3` on 40 ha must give a non-null result with `units === U` and one built lot. Pinned in Task 3.
5. **Memo key collisions.** Two schedules with the same parcels and units but a different `storyLimit` or `curatedStories` must not share a memo entry. Pinned in Task 6.

---

### Task 1: District layout (streets, blocks, open space, lots, fill order)

**Files:**
- Create: `src/lib/generator/district-layout.ts`
- Modify: `src/lib/generator/constants.ts` (append the district constants from Global Constraints, each with a tier doc comment)
- Test: `src/lib/generator/district-layout.spec.ts`
- Create: `src/lib/generator/fixtures/district.ts` (synthetic local-metre sites: `rect(w, h)`, `lshape`, `holed40ha`, `twoPieces`, `pier`)

**Interfaces:**
- Produces:
  ```ts
  export interface DistrictLot {
    key: string;                 // `${piece}:${i}:${j}:${side}:${k}`, stable
    polygon: [number, number][][]; // anchor-frame local metres, outer ring first, holes after
    areaM2: number;
  }
  export interface DistrictLayout {
    areaM2: number;              // summed domain area over all pieces
    lots: DistrictLot[];         // in fill order (spec §4.2 step 5)
    openSpace: [number, number][][][]; // the open-space blocks, for tests and debugging
  }
  export function districtArea(polygon: [number, number][][]): number;
  export function layoutDistrict(
    polygon: [number, number][][],
    seed: number,
    openSpaceShare?: number // default OPEN_SPACE_SHARE
  ): DistrictLayout;
  ```
- `districtArea` is the dispatch test used by Tasks 2 and 3. It unions the rings with `FillRule.EvenOdd` (as `normaliseSite` does) and sums the outer areas minus the hole areas over **every** piece.

**Algorithm** (spec §4.1–4.2; the geometric choices below are this plan's):

```
pieces = union(polygon, EvenOdd) as PolyTree → each top-level outer + its holes, sorted by area desc
draw   = mulberry32(fnv1a32(`${seed>>>0}|district`))
for each piece p (index pi):
  P = canonical outer; c = centroid(P); u = principalAxis(P, c); v = rot90(u)
  if area(p) <= BLOCK_U_M * BLOCK_V_M: blocks = [p] (no synthetic street, spec §4.1)
  else:
    offU = draw(), offV = draw()
    pitchU = BLOCK_U_M + STREET_M; pitchV = BLOCK_V_M + STREET_M
    range of i, j from project([P], c, u|v) with origin c + (offU·pitchU)u + (offV·pitchV)v
    cell(i,j) = orientedRect(c, u, v, …) shrunk by STREET_M/2 on each side
    blocks = intersectD(p, cell) per cell → every resulting polygon (with holes)
  drop blocks with area < BLOCK_MIN_M2 or inset(block, MIN_WIDTH_INSET_M) empty
open space: rank all blocks by fnv1a32(`${seed>>>0}|os|${pi}|${i}|${j}|${n}`) ascending
            take whole blocks while openArea < openSpaceShare · ΣblockArea
lots per remaining block (in the piece's u/v frame):
  depth_v ≥ 2·LOT_DEPTH_MIN_M → split at the v mid-line into side 0 / side 1, else one side 0
  each side: n = ceil(len_u / LOT_FRONTAGE_M) equal cuts along u (orientedRect ∩ side)
  a cut under LOT_MIN_M2 is unioned into its u-neighbour (previous, else next)
fill order: pieces by area desc; within a piece sort by (i, j, side, k);
            reverse the piece's order when draw() < 0.5 (the seeded sweep end)
```

- [ ] **Step 1: Write the failing tests** in `district-layout.spec.ts`:
  - `districtArea sums every piece`: `districtArea(twoPieces)` ≈ the sum of both rectangles' areas ± 0.01.
  - `districtArea subtracts holes`: for `holed40ha`, outer minus hole ± 0.01.
  - `lots stay inside the site and out of holes`: for `rect(800, 500)`, `lshape` and `holed40ha` with seeds 1, 2 and 3, every lot is inside the domain (`insideDomain`, tolerance 0.02 m) and intersects no hole (≤ 0.01 m²).
  - `no lot under LOT_MIN_M2`: for each fixture, `lots.every(l => l.areaM2 >= 400)`.
  - `streets are at least STREET_M wide`: in `rect(800, 500)`, the minimum distance between lots of different blocks is ≥ 19.5 − 0.05 m.
  - `open space within one block of target`: `|openArea − 0.15·ΣblockArea| ≤ max block area`; with `openSpaceShare` 0, `openSpace` is `[]`.
  - `a one-block piece gets no synthetic street`: in `twoPieces`, where one piece is 160 × 70 m, every lot of that piece has its `key` `j` equal to 0 and its `i` equal to 0.
  - `pier yields no lots`: `layoutDistrict(pier(25, 900), 1).lots` is `[]`.
  - `deterministic and order-independent`: two calls are `toStrictEqual`, and so is a call with the rings reversed.
  - `median block splits into 2 × 4 lots`: `layoutDistrict(rect(167, 73), 1, 0)` (one block, so no synthetic street, and no open space) gives 8 lots of about 1,524 m² ± 5 m².
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/generator/district-layout.spec.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the constants and `district-layout.ts` per the algorithm above, reusing `poly.ts` (`orientedRect`, `principalAxis`, `centroid`, `canonicalRing`, `inset`, `project`, `signedArea`) and `domain.ts` (`domainArea`, `insideDomain`). Use Clipper `intersectD` and `unionD` at `CLIPPER_PRECISION`.
- [ ] **Step 4: Run** the same command, plus `npx vitest --run --project server src/lib/generator/determinism.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(generator): district layout of streets, blocks, open space and lots`.

### Task 2: District massing for `generate` (paint and T11 yields)

**Files:**
- Create: `src/lib/generator/district.ts`
- Modify: `src/lib/generator/types.ts`, adding the I9 fields:
  - `lot?: number` on each part;
  - `lots?: { typology: TypologyId; stories: number; floorAreaM2: number }[]` on the building.
- Modify: `src/lib/generator/generate.ts` (`generate` only; `generateWith` and `generateDetailed` stay untouched as non-district seams)
- Modify: `src/lib/generator/units.ts` (`massedUnits` sums over `lots`)
- Modify: `src/lib/generator/index.ts` (export `generateDistrict`)
- Test: `src/lib/generator/district.spec.ts`; `src/lib/generator/golden.spec.ts` (one added assertion only)

**Interfaces:**
- Consumes: `layoutDistrict`, `districtArea` (Task 1).
- Produces:
  ```ts
  /** Lot seed: fnv1a32(`${seed >>> 0}|${lot.key}`). */
  export function lotSeed(seed: number, key: string): number;
  /** The lot as a site record: anchor id and labelPoint, the lot polygon, no existing development, eligible. */
  export function lotRecord(anchor: ParcelRecord, lot: DistrictLot): ParcelRecord;
  /** Combines per-lot buildings in fill order into one I9 building (spec §4.4). Null if lots is empty. */
  export function combineLots(
    anchor: ParcelRecord,
    lots: GeneratedBuilding[],
    source: GeneratedBuilding['source'],
    units: number
  ): GeneratedBuilding | null;
  /** Paint and yields: every non-open-space lot at env.maxStories, max buildout. */
  export function generateDistrict(
    parcel: ParcelRecord,
    env: Envelope,
    seed: number
  ): GeneratedBuilding | 'not-district' | null;
  ```
- `generate` becomes:
  - if `districtArea(parcel.polygon) >= DISTRICT_MIN_M2`, call `generateDistrict`;
  - on `'not-district'` (the layout yielded no lots: Review Focus 2), fall through to today's `generateWith(…)` unchanged.
- `combineLots` rules (spec §4.4):
  - `parts` are concatenated in fill order, each stamped `lot: index`;
  - `lots[index]` is `{ typology, stories, floorAreaM2 }`;
  - `typology` is the one with the most total floor area, ties to the later typology in I10 order;
  - `composition` comes from the lot holding the most floor area;
  - `stories` is the maximum over lots;
  - `floorAreaM2` is `round1(Σ)`;
  - `replacesExisting` is `true`;
  - `parcelId` is `anchor.id`.
- `generateDistrict`:
  - returns `null` when `!parcel.eligible`, when the label point is bad, or when `Math.floor(env.maxStories) < 1`;
  - clamps `S` to `MAX_STORIES`;
  - masses each lot with `generate(lotRecord(…), { maxStories: S }, lotSeed(seed, key), 'max')`. Lots are under the threshold, so there is no recursion;
  - applies the I8 rule to the district total: `null` unless `floorAreaM2 > parcel.existingFloorAreaM2` and `units > parcel.existingUnits`;
  - sets `units` to `Σ lot units`;
  - never takes the ADU path: `lotRecord` sets `existingUnits` to 0.
- `massedUnits(b)`: when `b.lots` is present, `Σ unitsFor(l.typology, l.floorAreaM2)`. Otherwise unchanged.

- [ ] **Step 1: Write the failing tests** in `district.spec.ts` (fixtures from Task 1 wrapped as `ParcelRecord`, with `labelPoint` `[-122.39, 37.73]`):
  - `under the threshold equals main`: a `rect(141.4, 141.4)` parcel (19,994 m²) at S 6 and seed 7 gives `generate` output `toStrictEqual` to `generateWith(p, {maxStories: 6}, drawVariety(7), 'max', drawComposition(7))`, with no `lots` key.
  - `at the threshold it is a district`: `rect(200, 100)` at S 6 gives `lots.length > 1`.
  - `paint fills every non-open-space lot`: a 40 ha `rect(800, 500)` at S 8: `lots.length` equals `layoutDistrict(...).lots.length` (every lot builds at S 8 on a lot of at least 400 m²), every `lots[i].stories === 8`, and `units === Σ unitsFor(lots)`.
  - `parts carry lot indices in fill order`: `parts.map(p => p.lot)` is non-decreasing and covers `0..lots.length − 1`.
  - `district I8 rule`: the 40 ha parcel with `existingUnits` 1e6 gives `null`; with `existingUnits` 1,272 and a big district total, it gives non-null.
  - `pier falls back to the single-building path`: `pier(25, 900)` at S 6 gives `toStrictEqual` to `generateWith(...)` with the same draws.
  - `massedUnits sums lots`: on a mixed district, `massedUnits(b) === Σ unitsFor(l.typology, l.floorAreaM2)`.
  - `deterministic`: two calls are `toStrictEqual`.
- [ ] **Step 2: Add to `golden.spec.ts`:** `every golden and named fixture is below DISTRICT_MIN_M2`, which asserts `districtArea(f.polygon) < 20000` for every fixture in `src/lib/generator/fixtures/*.json` and for the property arbitraries' maximum (90 × 90 m).
- [ ] **Step 3: Run** `npx vitest --run --project server src/lib/generator`. Expected: the new tests FAIL and the existing tests PASS.
- [ ] **Step 4: Implement** the types, `district.ts`, the dispatch in `generate`, and `massedUnits`.
- [ ] **Step 5: Run** `npx vitest --run --project server src/lib/generator src/lib/data src/lib/scoreboard` and `npm run check`. Expected: PASS, with every pre-existing generator test unchanged.
- [ ] **Step 6: Commit** `feat(generator): mass sites of 2 ha or more as districts in generate`.

### Task 3: District massing for `generateForUnits`

**Files:**
- Modify: `src/lib/generator/units.ts` (`generateForUnits` signature and dispatch; `generateForUnitsWith` unchanged)
- Modify: `src/lib/generator/district.ts` (add `generateDistrictForUnits`)
- Test: `src/lib/generator/district-units.spec.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2 (`layoutDistrict`, `districtArea`, `lotRecord`, `lotSeed`, `combineLots`).
- Produces:
  ```ts
  export interface DistrictOpts {
    storyLimit?: number;      // L before clamping; absent → DISTRICT_FALLBACK_LIMIT
    curatedStories?: number;  // tier-1 DA height; every lot uses it
    openSpaceShare?: number;  // curated; absent → OPEN_SPACE_SHARE
  }
  export function generateForUnits(
    parcel: ParcelRecord | ParcelRecord[], units: number, maxStories: number, seed: number,
    stories?: number, opts?: DistrictOpts
  ): GeneratedBuilding | null;
  export function generateDistrictForUnits(
    assembled: AssembledSite, U: number, seed: number, stated: number | null, opts: DistrictOpts
  ): GeneratedBuilding | 'not-district' | null;
  ```
- Dispatch in `generateForUnits`:
  - It validates `units` and `stories` exactly as the §4.2 steps of `generateForUnitsWith` do.
  - Then it calls `assembleSite`. If `districtArea(assembled.polygon) >= DISTRICT_MIN_M2`, it calls `generateDistrictForUnits`.
  - On `'not-district'`, or below the threshold, it returns today's `generateForUnitsWith(…)`, ignoring `opts`.
- Rules (spec §4.3, partner ruling):
  - `L = clamp(floor(opts.storyLimit ?? DISTRICT_FALLBACK_LIMIT), DISTRICT_MIN_STORIES, MAX_STORIES)`.
  - `S_ℓ`:
    - when `stated` is valid, `S_ℓ = stated`;
    - otherwise, when `curatedStories` is valid, `S_ℓ = floor(curatedStories)`;
    - otherwise `S_ℓ = 3 + floor(mulberry32(lotSeed(seed, key))() · (L − 3 + 1))`.
  - **Fill:** in fill order, mass each lot with `generate(lotRecord, {maxStories: S_ℓ}, lotSeed, 'max')`.
    - At the first lot whose units are ≥ `remaining`, replace it with `generateForUnitsWith(lotRecord, remaining, L, drawVariety(ls), drawComposition(ls), S_ℓ)` and stop.
    - A lot that masses `null` is skipped.
  - **Run-out:** if the lots end with units remaining, walk the built lots again in fill order and re-mass each at `L`, unless `stated` is valid. The lot that reaches `U` gets the `generateForUnitsWith` remainder treatment.
  - **Still short:** keep everything at `L`. The building is approximate and `units` is still `U`.
  - Result: `combineLots(anchor, built, 'pipeline', U)`, with `stories` the maximum of `S_ℓ` over the built lots.

- [ ] **Step 1: Write the failing tests** in `district-units.spec.ts`, using the 40 ha `rect(800, 500)` site (single parcel, seed 11):
  - `no evidence: heights drawn in [3, L]`: `U` 3,454, `opts {storyLimit: 12}`. Every `lots[i].stories` is in `[3, 12]`, `units === 3454`, `massingApproximate(b)` is false, `lots.length > 1` and `lots.length < layout lots` (some lots stay empty).
  - `same seed, same district`: two calls are `toStrictEqual`; seed 12 differs.
  - `curated height: every lot at 8`: `opts {curatedStories: 8, storyLimit: 12}`, `U` 3,454. Every `lots[i].stories === 8`.
  - `stated stories win`: `stories` 5 with `curatedStories` 8. Every lot is at 5 and no lot is raised.
  - `few units leave lots empty`: `U` 300 gives `lots.length` well below the layout's lot count.
  - `tiny U` (Review Focus 4): `U` 1 and `U` 3 give non-null results, `units === U` and `lots.length === 1`.
  - `run-out raises to L`: `U` 200,000 with `storyLimit` 12. Every lot is at 12, `units === 200000` and `massingApproximate(b)` is true.
  - `opts ignored below the threshold`: on `lot-1000.json`, the result with `opts {curatedStories: 9}` is `toStrictEqual` to the result without `opts`.
  - `L clamps`: `storyLimit` 1 gives every lot 3 stories; `storyLimit` 500 is clamped to 80.
  - `multi-parcel assembly of 2 ha or more uses every piece`: two disjoint 120 × 100 m parcels 40 m apart give built lots in both pieces when `U` needs both.
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/generator/district-units.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** `npx vitest --run --project server src/lib/generator`. Expected: PASS, with `units.spec.ts` and `units.property.spec.ts` unchanged.
- [ ] **Step 5: Commit** `feat(generator): generateForUnits masses districts lot by lot until the units are used`.

### Task 4: Per-lot typology colour in the packers

**Files:**
- Modify: `src/lib/map/pack.ts` (`renderParts`, `packCell`)
- Modify: `src/lib/map/pack-timed.ts` (the building branch, around lines 95–105)
- Test: `src/lib/map/pack.spec.ts`, `src/lib/map/pack-timed.spec.ts`

**Interfaces:**
- Consumes: the I9 `lot` and `lots` fields (Task 2).
- Produces: `renderParts(b)` returns `{ ring, topM, appearance, typology: TypologyId }[]`.
  - Each entry's `typology` is `b.lots?.[part.lot!]?.typology ?? b.typology`.
  - Runs are merged only when `part.lot` is equal as well.
  - Both packers push `TYPOLOGY_ORDER.indexOf(part.typology)` into `typ`.
  - `parcelMeta` keeps the headline `b.typology`.

- [ ] **Step 1: Write the failing tests:**
  - `pack.spec.ts`: `a district colours each lot by its own typology`. Build a 2-lot building (lot 0 podium, lot 1 tower), pack it, and assert that `partTypology` holds both indices in part order. Also assert `identical stacked parts of different lots are not merged`.
  - `pack-timed.spec.ts`: the same two assertions through `packTimedCell`.
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/map`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS. Existing pack tests are unchanged, because a building without `lots` packs exactly as before.
- [ ] **Step 5: Commit** `feat(map): colour each district lot by its own typology`.

### Task 5: Pipeline heights in `multiphase.json`, `projects.json` and T3

**Files:**
- Modify: `pipeline/enrichment/schema.ts` (`MultiphaseEntry.heights?`, `MultiphasePhase.stories?` and `facts.stories?`; zod: integers 1..80, `openSpaceShare` in [0, 0.9], a fact required for each value given)
- Modify: `src/lib/timelapse/projects.ts`:
  - `phases[].stories?: number | null` and `phases[].storiesTier?: 1 | null`;
  - `InFlightProject.daHeights?: { stories: number | null; maxStories: number | null; openSpaceShare: number | null } | null`;
  - `ProjectsFile.districtMaxStories?: { stories: number; n: number; provenance: Provenance }`;
  - validator checks: absent means `null`; when present, integers 1..80 and a share in [0, 0.9].
- Modify: `pipeline/project-records/multiphase.ts`:
  - `enriched` copies a phase's curated `stories` into `Phase.stories` and `storiesTier: 1`;
  - a merged phase keeps `stories` only when every merged draft agrees, else `null`;
  - fallback and last-resort phases get `null`.
- Modify: `pipeline/project-records/assemble.ts` (`daHeights` from the entry's `heights` onto the master row)
- Modify: `pipeline/project-records/derive.ts` (`districtMaxStories`: the 90th percentile, nearest rank, of tier-0 `stories` over in-flight and completed records with `units >= DISTRICT_DEFAULT_MIN_UNITS`; `n` and a tier-2 `Provenance`; omitted when `n === 0`). `DISTRICT_DEFAULT_MIN_UNITS` is imported from `src/lib/generator/constants.ts`.
- Modify: the `orderProjectsFile` key ordering for the new fields (`pipeline/project-records/derive.ts` imports it).
- Modify: `pipeline/test/fixtures/mini/enrichment/multiphase.json`, adding one `heights` entry with facts and one phase `stories`.
- Test: `pipeline/test/project-records/multiphase-file.test.ts`, `multiphase.test.ts`, `derive.test.ts`; `src/lib/timelapse/projects.spec.ts`, or the existing validator spec beside it.

**Interfaces:**
- Produces, for Task 6:
  - `InFlightProject.daHeights`;
  - `phases[i].stories`;
  - `ProjectsFile.districtMaxStories.stories`.

- [ ] **Step 1: Write the failing tests:**
  - `schema accepts heights with facts and rejects heights without a fact, stories 0 or 81, and openSpaceShare 0.95`.
  - `enriched phases carry curated stories with tier 1; merged phases with differing stories carry null; fallback phases carry null`.
  - `master rows carry daHeights from the entry; entries without heights give null`.
  - `districtMaxStories is the nearest-rank p90 of tier-0 stories over records with ≥ 100 units`: a synthetic list `[4, 5, 6, 7, 8, 9, 10, 12, 20, 40]` gives 20 with `n` 10; records under 100 units or with tier-3 stories are excluded.
  - Validator: `parseProjectsFile accepts files without the new fields and rejects phases[].stories 0`.
- [ ] **Step 2: Run** `npm run test:pipeline` and `npx vitest --run --project server src/lib/timelapse`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run pipeline -- fixture --update-golden`. Review the golden diff: only the new fields, plus geometry-derived yields for mini parcels of 2 ha or more (if any). Then run `npm run test:pipeline` and `npx vitest --run --project server src/lib/timelapse`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pipeline): curated DA heights and districtMaxStories in projects.json`, including the updated `pipeline/test/fixtures/mini/golden/` and `e2e/fixtures/data/fixture-0/`.

### Task 6: Sim — pass district options, mass masters without phases, card tier 1

**Files:**
- Modify: `src/lib/sim/scenario/types.ts`:
  - `SimInput` gains `districtMaxStories: number | null`;
  - `ProjectCard.storiesTier` becomes `0 | 1 | 3 | 4 | null`, with the comment amended.
- Modify: `src/lib/sim/scenario/load.ts` (fill `districtMaxStories` from the parsed `ProjectsFile`)
- Modify: `src/lib/sim/scenario/massing.ts` (`districtOptsFor`, `pipeKey`, `building()`; remove the early return at line 132)
- Modify: `src/lib/sim/scenario/card.ts` (remove the `FOOTPRINT_ONLY` short-circuit at line 131; add the tier-1 rule)
- Modify: `src/lib/fzp/card.ts` (`storiesText`: tier 1 → `` `${count}, from the development plan` ``)
- Modify: every fixture or `SimInput` literal that `npm run check` flags (`src/lib/sim/scenario/fixtures/*`, `src/lib/sim/scenario/simulate.golden.cases.ts`, `src/lib/sim/test/*`)
- Test: `src/lib/sim/scenario/footprint.spec.ts`, `card.spec.ts`, `scenario-host.spec.ts`, `src/lib/fzp/card.spec.ts`

**Interfaces:**
- Consumes: `generateForUnits(…, opts: DistrictOpts)` (Task 3); `InFlightProject.daHeights`, `phases[].stories` and `ProjectsFile.districtMaxStories` (Task 5).
- Produces:
  ```ts
  export function districtOptsFor(schedule: Schedule, ctx: MassingCtx): DistrictOpts;
  export const pipeKey: (seed: number, units: number, stories: number | null,
    ids: ParcelId[], opts: DistrictOpts) => string; // appends `|${storyLimit ?? '-'}|${curatedStories ?? '-'}|${openSpaceShare ?? '-'}`
  ```
- `districtOptsFor` (spec §4.3, "Story limit `L`"):
  - The row is `ctx.input.projects` looked up by `schedule.phase?.masterId ?? schedule.projectId`. Build the id map once per `SimInput` and memoise it in a `WeakMap` keyed by `input`.
  - `storyLimit` is the first that applies:
    1. the maximum of `ctx.input.parcels.envelopeStories[index.get(id)]` over `schedule.parcelIds`, when > 0;
    2. else `row.daHeights?.maxStories`;
    3. else `ctx.input.districtMaxStories`;
    4. else `undefined`.
  - `curatedStories`: `row.phases?.[phase.index − 1]?.stories ?? row.daHeights?.stories ?? undefined`.
  - `openSpaceShare`: `row.daHeights?.openSpaceShare ?? undefined`.
  - Simulated schedules get no opts.
- Card tier 1: when `rev.stories === null`, `b.lots` is present, and every `l.stories === curatedStories`, then `storiesTier = 1`. Otherwise the current rule applies.

- [ ] **Step 1: Write the failing tests:**
  - `footprint.spec.ts`: `a master without phases with free parcels is massed`. A `multiPhase`, `phase: null` schedule on a 40 ha parcel gives an entry with `parts` and `source: 'pipeline'`, not `footprint`. `a null generator still gives the footprint` is kept.
  - `scenario-host.spec.ts` (or a new `massing.spec.ts`):
    - `districtOptsFor takes the zoned limit first`: parcel envelopes 0 and 9 with `daHeights.maxStories` 20 give `storyLimit` 9;
    - `then the curated max`: envelopes all 0 give 20;
    - `then districtMaxStories`: no `daHeights` and `districtMaxStories` 14 give 14;
    - `curatedStories prefers the phase over the master`.
  - `pipeKey separates opts` (Review Focus 5): the same ids and units with `storyLimit` 9 and 12 give different keys.
  - `card.spec.ts`:
    - `a district built at the curated height reports tier 1`;
    - `a drawn-height district reports tier 4`;
    - `a master without phases reports massing matched or approximate, not none`.
  - `src/lib/fzp/card.spec.ts`: `storiesText tier 1 reads "8 stories, from the development plan"`.
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/sim src/lib/fzp`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run check`, then `npx vitest --run --project server --project client src/lib/sim src/lib/fzp`. If a sim golden case moves because the mini fixture has a master without phases or a district site, inspect the diff, confirm the change is only in massing or the card, and update the golden with its documented update flag. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sim): mass large sites and masters without phases with district options`.

### Task 7: Curate DA heights in `pipeline/enrichment/multiphase.json`

**Files:**
- Modify: `pipeline/enrichment/multiphase.json`
- Modify: `docs/dev/pipeline.md` (the multiphase enrichment section: the `heights` and phase `stories` fields, and the rule that each value needs a `Fact`)

**Interfaces:**
- Consumes: the schema from Task 5.

Research order (spec §4.6):

1. CP/HPS Phase 2 (2007.0946PRX)
2. HPS Phase 1 (2013.0196PRX)
3. Treasure Island (2007.0903PRX)
4. Mission Rock (2013.0208PRX)
5. Parkmerced (2014.1370PRX)
6. Pier 70 (2014-001272PRX)
7. Potrero Power Station (2017-011878PRX)
8. India Basin (2023-007906PRX)
9. Balboa Reservoir (2018-007883PRX)
10. Stonestown (2023-007912PRX)
11. Schlage Lock (2006.1308PRX)
12. the rest

Sources are each project's Design for Development, Design Standards and Guidelines, or SUD height map: official sfplanning.org, sfport.com or sfocii.org PDFs.

- `stories` is the prevailing residential height.
- `maxStories` is the tallest permitted height.
- `openSpaceShare` is park and open-space acres over site acres.
- Feet are converted with `storiesFromFt` (`pipeline/lib/heights.ts:78`), and the conversion is noted in the `locator`.

- [ ] **Step 1:** For each entry in order, find the document and record `heights` (and per-phase `stories` where the document gives them by phase), each with a `Fact` `{ url, retrieved: '2026-10-19' or the actual date, locator }`. **Do not enter a value you cannot cite.** Leave the entry without `heights` instead.
- [ ] **Step 2:** Run `npm run test:pipeline`. Expected: PASS. If `multiphase-file.test.ts` does not already parse the real `pipeline/enrichment/multiphase.json` with `parseMultiphase`, add the test `parses the curated multiphase.json` there first.
- [ ] **Step 3:** In the commit body, list each entry as `sourced` (with document titles) or `unsourced`.
- [ ] **Step 4: Commit** `feat(pipeline): curate DA heights and open space from design documents`.

### Task 8: Performance, end-to-end verification and spec cross-references

**Files:**
- Create: `src/lib/generator/district.perf.spec.ts`
- Modify:
  - `docs/superpowers/specs/2026-10-16-pipeline-massing-design.md`: §1 out-of-scope bullet "Unphased multi-phase rows are not massed" now points to the large-site spec §4.7; T10 now has the `opts` argument; §4.2 step 7 gets a district exception note.
  - `docs/superpowers/specs/2026-10-16-timelapse-sim-design.md`: the §4.9 `massing` and `storiesTier` rows.
  - `docs/superpowers/specs/2026-10-16-project-records-design.md`: §4.10, with `daHeights`, phase `stories` and `districtMaxStories`.
  - `docs/superpowers/specs/2026-10-10-typology-generator-design.md`: §4.6, a district note.
  - `docs/dev/fzp-mode.md`: wherever it describes the footprint ghost for masters without phases.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the perf tests** (Node, after 20 warm-up calls), using `rect(1000, 500)` (50 ha) and `rect(1630, 1630)` (about 265 ha):
  - `generateForUnits` on 50 ha with `U` 3,454: p99 ≤ 50 ms over 50 seeds;
  - `generateForUnits` on 265 ha with `U` 3,454: max ≤ 250 ms over 10 seeds;
  - `generate` on 265 ha at S 8: max ≤ 500 ms over 5 seeds. This is the plan's call for the paint brush, since the spec budgets only `generateForUnits`; the gate stays `bench:map` in Step 3.
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/generator/district.perf.spec.ts`. Expected: PASS. If it fails, profile before loosening any budget: cache the layout per site and seed, and reuse per-lot `generate` results between the fill and run-out passes.
- [ ] **Step 3: Run** `npm run test:unit`, `npm run test:pipeline`, `npm run lint`, `npm run check`, `npm run test:e2e` and `npm run bench:map`. Expected: all PASS, and `bench:map` within its p95 bar (docs/dev/map-perf.md).
- [ ] **Step 4: Visual check.** Build a real dataset locally (`npm run pipeline -- all` per docs/dev/pipeline.md, or `npm run data:local` plus the new build), run `npm run dev`, and capture screenshots:
  - on `/fzp`, Hunters Point Shipyard, Candlestick Point and Mission Rock at a scrub date after their phases complete;
  - on `/`, a 2 ha+ parcel (for example 7299006, SFSU) painted at 8 stories.

  Each must show streets, several buildings and heights at or above 3 stories. Save the screenshots for the PR body.
- [ ] **Step 5: Update the cross-referenced specs and `docs/dev/fzp-mode.md`.**
- [ ] **Step 6: Commit** `test(generator): district perf budgets` and `docs: cross-reference large-site massing`.

## Self-review notes

- **Spec coverage:**
  - §4.1–4.2 → Task 1.
  - §4.3 paint, §4.4 and §3 (subtracting non-building land) → Task 2.
  - §4.3 pipeline and the story limit (generator side) → Task 3.
  - §4.4 per-part colour → Task 4.
  - §4.6 schema, T3 and `districtMaxStories` → Task 5; the data → Task 7.
  - §4.5 opts routing, the story-limit order (sim side), §4.7 and the T6 tier → Task 6.
  - §6 perf and AC1–AC6 → Task 8.
  - AC3, byte-identity → Task 2 Steps 1–2 and every task's "unchanged" run.
- **Departures from the spec, deliberate:**
  - District randomness uses a separate seeded stream, not new `VarietyDraws`, because `drawVariety` is frozen.
  - A layout that yields no lots falls back to today's path (Review Focus 2). The spec is silent on this case.
  - The 500 ms `generate` budget on 265 ha is this plan's addition.
