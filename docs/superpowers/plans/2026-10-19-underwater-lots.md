# Underwater Lots (Clip Lots to Land) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clip every lot to a land mask (Protomaps `earth` ∪ `landuse kind=pier` polygons ∪ existing buildings) once in the pipeline. Only the dry part counts as buildable, and lots that are fully underwater stay visible but are flagged and build nothing.

**Architecture:** A new normaliser decodes the basemap's z15 vector tiles in TypeScript into `src_land`. A new SQL stage, `45_land.sql`, runs after `40_heights.sql` (where `buildings` is made) and before `50_clip.sql`. It builds the mask and rewrites `parcels` with the clipped geometry, recomputed label points, an `underwater` flag and `geom_orig`, the original polygon, which lineage uses. Everything downstream (pieces, area, chunks, scenario, projects, generator) reads the clipped `parcels.geom` unchanged. The chunk record gains an optional `underwater` flag in a sparse `uw` column. Painting reports "in the Bay".

**Tech Stack:** TypeScript pipeline (tsx), DuckDB spatial (`@duckdb/node-api` 1.5.6), `pmtiles` 4 (already a dependency), new devDependencies `@mapbox/vector-tile` and `pbf`, Vitest (`pipeline`, `server` and `client` projects), SvelteKit 2 / Svelte 5.

**Spec:** `docs/superpowers/specs/2026-10-19-underwater-lots-design.md`. Its "Spike findings" and "Decisions from the findings" sections override the earlier "Land source" builder's call. The throwaway spike (`mask.py`, `clip.py`, `make_clipped_db.py`, `run-steps.mts`) is in the session scratchpad under `landmask-spike/`. This plan pins every detail the executor needs, so they do not have to read the spike.

## Global Constraints

- Mask = Protomaps layer `earth` features with `kind = 'earth'` ∪ layer `landuse` features with `kind = 'pier'`, **polygons only** (MVT geometry type 3), at **z15 only**, ∪ the `buildings` table. Pier lines (any LineString, including `roads` `kind_detail = 'pier'`) are excluded, because they make marina water buildable.
- Each tile feature is clipped to its own tile's bounds before the tiles are unioned. The union is snapped to a 0.01 m grid, and seams are closed with a buffer of +0.05 m then −0.05 m (`land_seam_m`). The mask is then simplified at 0.5 m (`land_simplify_m`) before any lot is cut.
- A lot whose removed area is below **5 m²** (`land_min_removed_m2`) keeps its original geometry exactly. Dry pieces below **2 m²** (`min_piece_m2`, existing) are dropped. A lot with no dry piece left is **underwater**. Every other affected lot keeps **all** its dry pieces.
- Underwater lots keep their original outline, original area and original label. Their chunk `eligible` is false, their `underwater` flag is true, and their scenario eligibility is false. Their existing roll homes and projects are untouched.
- The original polygon (`parcels.geom_orig`) feeds spatial lineage (`80_scenario.sql` `s_map_b`). `20_landuse.sql`'s orphan reassignment already runs before the clip. Everything else uses the clipped geometry, and that includes area checks (`inflight.ts`, `sd.roll.units-capacity`), so there is no second area field.
- Label points of clipped lots are recomputed on the clipped geometry with the existing label algorithm.
- The worker does no geo computation, and there is no user toggle for the clip.
- New packages are pipeline-only `devDependencies`, with no `SOFTWARE` credit. OSM is already credited through the `protomaps-basemap` lock entry. No new lock source.
- The chunk format string stays `'sfh-parcels/1'`. The new optional column `uw` is omitted when a chunk has no underwater lot, so chunks from older datasets still decode.
- User-facing copy: the painting message says "`N in the Bay`" and the tooltip says "`in the Bay`".
- The change ships as a new `datasetVersion`. **Uploading and promoting it need the user's go-ahead.**
- Dated specs and plans under `docs/superpowers/` are historical, so do not edit them. Document the change in `docs/dev/pipeline.md`.
- Commits use Conventional Commits and end with the trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Pass the trailer as a second `-m`.

## Review Focus

1. **A lot outside the basemap's tile coverage reads as water.** A missing tile has no `earth`, so the lot comes out underwater. The live extract covers `BBOX`, so a live build should report `land.outside_tiles = 0`. Task 3 counts it, and Task 9 requires 0 on the live build. The fixture deliberately has 3 such lots, because the edge of its extract coverage stands in for the shoreline.
2. **Tile seams nicking inland lots.** Adjacent tiles must union to a single polygon. Task 3 tests a 2 cm seam gap.
3. **Determinism.** Union order must not change the mask or the lot vertices between runs (V12, golden). Task 3 runs the stage twice and compares the WKB.
4. **Old datasets keep loading.** A chunk without `uw` decodes with no record flagged, and a chunk with no underwater lot encodes byte-identically to before. Task 5 tests both.
5. **A stroke that covers both underwater and ordinary lots.** The message must count both, and must not count underwater lots as "not eligible". Task 7 tests this.

---

## File Structure

| File                                                                    | Responsibility                                                                                                                                                                      |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pipeline/lib/pmtiles-file.ts` (new)                                    | A Node file `Source` for the `pmtiles` reader                                                                                                                                       |
| `pipeline/sources/land.ts` (new)                                        | Decode z15 tiles to land features: `landFeaturesFromTile` (pure) and `normaliseLand` (pmtiles → parquet)                                                                            |
| `pipeline/sources/normalise.ts`                                         | Registers `protomaps-basemap` → `src_land`                                                                                                                                          |
| `pipeline/sql/05_macros.sql` (new)                                      | `round_trip` and the table macro `sfh_label`, moved out of `10_parcels.sql`                                                                                                         |
| `pipeline/sql/45_land.sql` (new)                                        | Mask, clip, `parcel_land`, the `parcels` rewrite, `land.*` counts and T14 tallies                                                                                                   |
| `pipeline/lib/sql.ts`, `pipeline/config.ts`                             | `SQL_FILES` order, `SQL_VARS` thresholds, `FIXTURE_PROFILE`                                                                                                                         |
| `pipeline/sql/60_attributes.sql`, `80_scenario.sql`                     | `eligible AND NOT underwater`, `underwater` and `geojson7131_orig` columns, lineage on `geom_orig`                                                                                  |
| `pipeline/lib/quality-rules/sd.ts`                                      | Rules `sd.parcels.land-clip`, `sd.parcels.underwater`, `sd.parcels.clip-yield-loss`                                                                                                 |
| `pipeline/lib/land-report.ts` (new)                                     | `clipYieldLoss` (pure) and `landClipSection` (the quality-report section)                                                                                                           |
| `src/lib/data/parcel.ts`, `parcel-chunk.ts`                             | `ParcelRecord.underwater?`, `uw` column                                                                                                                                             |
| `pipeline/steps/chunks.ts`, `pipeline/lib/scenario-eligibility.ts`      | Carry `underwater`; underwater is never scenario-eligible                                                                                                                           |
| `src/lib/plan/resolve.ts`, `src/lib/sim/{protocol,host}.ts`             | Underwater coverage and stats                                                                                                                                                       |
| `src/lib/brush/messages.ts`, `src/lib/map/{tooltip,types}.ts`           | "in the Bay" copy                                                                                                                                                                   |
| `pipeline/test/fixtures/mini/make-fixture.ts`, `README.md`              | Lots 15–17, retired `3512096`, building `bbay`, neighbourhood and district                                                                                                          |
| Tests (new)                                                             | `pipeline/test/land-source.test.ts`, `land-helpers.ts`, `land-clip.test.ts`, `land-fixture.test.ts`, `land-report.test.ts`; `src/lib/sim/underwater.spec.ts`                        |

---

### Task 1: Decode land features from the basemap into `src_land`

**Files:**
- Modify: `package.json` / `package-lock.json`. Add the devDependencies `@mapbox/vector-tile` (^2, which ships its own types) and `pbf` (^4). Check that both versions exist with `npm view` before pinning them, and do not touch the drizzle pins.
- Create: `pipeline/lib/pmtiles-file.ts`, `pipeline/sources/land.ts`
- Modify: `pipeline/sources/normalise.ts`
- Test: `pipeline/test/land-source.test.ts`

**Interfaces:**
- Produces: `class NodeFileSource implements Source` (from `pmtiles`), built as `new NodeFileSource(path: string)`. `getBytes(offset, length)` reads with `fs.promises` `FileHandle.read` and returns `{ data: ArrayBuffer }`, and `getKey()` returns the path.
- Produces: `type LandLayer = 'earth' | 'pier'` and `interface LandFeature { layer: LandLayer; z: number; x: number; y: number; fid: number; w: number; s: number; e: number; n: number; geojson: string }`. Here `w, s, e, n` are the tile's lon/lat bounds, `fid` is the feature's index within its layer, and `geojson` is the feature geometry in EPSG:4326.
- Produces: `tileBounds(z: number, x: number, y: number): [w: number, s: number, e: number, n: number]`, the Web-Mercator inverse of the tile corners.
- Produces: `landFeaturesFromTile(tile: Pick<VectorTile, 'layers'>, z: number, x: number, y: number): LandFeature[]`. It is pure. It keeps `earth` with `kind === 'earth'` and `landuse` with `kind === 'pier'`, both only where `feature.type === 3`, and uses `feature.toGeoJSON(x, y, z).geometry`.
- Produces: `normaliseLand(db: Duck, pmtilesPath: string, outParquet: string): Promise<number>`. It reads the header bounds, enumerates z15 `x` then `y` over the tile range that covers them, skips tiles `getZxy` returns as `undefined`, and writes table `src_land(layer VARCHAR, z INTEGER, x INTEGER, y INTEGER, fid INTEGER, w DOUBLE, s DOUBLE, e DOUBLE, n DOUBLE, geojson VARCHAR)` via `createTableFromRows`, then `COPY … TO parquet`. The return value is the row count.
- Produces: `SourceId` gains `'protomaps-basemap'`, `TABLES['protomaps-basemap'] = 'src_land'`, and `normalise()` sends that id to `normaliseLand(db, rawFiles[0], outParquet)`. `miniDuck()` and `build` therefore both get `src_land`.

- [ ] **Step 1: Write the failing tests** in `pipeline/test/land-source.test.ts`

```ts
// fake tile: layers { earth: [earth polygon, water polygon (kind 'water')], landuse: [pier polygon
// (kind 'pier', type 3), pier line (kind 'pier', type 2), park polygon], roads: [kind_detail 'pier' line] }
it('keeps earth and pier polygons and nothing else', () => {
  const f = landFeaturesFromTile(fake, 15, 5241, 12663);
  expect(f.map((x) => `${x.layer}:${x.fid}`)).toEqual(['earth:0', 'pier:0']);
  expect(JSON.parse(f[0].geojson).type).toMatch(/Polygon/);
});
it('gives tile bounds in lon/lat', () => {
  const [w, , e] = tileBounds(15, 5241, 12663);
  expect(w).toBeCloseTo(-122.420654296875, 12);
  expect(e).toBeCloseTo(-122.40966796875, 12);
});
it('loads the mini basemap as z15 earth over two tile columns', async () => {
  const db = await miniDuck();
  const rows = await db.all<{ x: number; n: number }>(
    "SELECT x, count(*) n FROM src_land WHERE layer = 'earth' GROUP BY x ORDER BY x");
  expect(rows.map((r) => r.x)).toEqual([5240, 5241]);
  expect((await db.all("SELECT * FROM src_land WHERE z <> 15")).length).toBe(0);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest --run --project pipeline pipeline/test/land-source.test.ts`
Expected: FAIL, because `landFeaturesFromTile` is not defined.

- [ ] **Step 3: Install the deps and implement** `NodeFileSource`, `tileBounds`, `landFeaturesFromTile` and `normaliseLand`, and register the source in `normalise.ts`. Tile data from `getZxy` comes back already decompressed by `pmtiles`. Decode it with `new VectorTile(new Pbf(new Uint8Array(data)))`.

- [ ] **Step 4: Run the pipeline tests**

Run: `npm run test:pipeline`
Expected: `land-source.test.ts` passes. `normalise.test.ts` and anything that lists `SOURCE_IDS` may need the new id added; fix them. `golden.test.ts` still passes, because no SQL reads `src_land` yet.

- [ ] **Step 5: Type check, lint, commit**

Run `npm run check`, then `npm run lint`.
```bash
git add package.json package-lock.json pipeline/lib/pmtiles-file.ts pipeline/sources/land.ts pipeline/sources/normalise.ts pipeline/test/land-source.test.ts
git commit -m "feat(pipeline): decode basemap earth and pier polygons into src_land" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Move the label-point algorithm into a reusable macro

This is a pure refactor, and the golden test proves it changes nothing. `45_land.sql` needs the same label logic.

**Files:**
- Create: `pipeline/sql/05_macros.sql`
- Modify: `pipeline/sql/10_parcels.sql:23-74` (`p_parts` … `p_label`), `pipeline/lib/sql.ts` (`SQL_FILES` starts with `'05_macros.sql'`)

**Interfaces:**
- Produces: `TEMP MACRO round_trip(pt)`, moved unchanged.
- Produces: `TEMP MACRO sfh_label(src) AS TABLE …` over `query_table(src)`. It takes columns `(id, geom)` and returns `(id, lp GEOMETRY, label_fallback INTEGER)`. The body is the current `p_parts → p_largest → p_label0..3 → p_label` chain written as CTEs: same largest part (area desc, `part_path` tie-break), same `ST_PointOnSurface`, same round trip and the same −0.05 m buffer fallback. `10_parcels.sql` keeps `p_parts` for its `n_holes` count and gets `lp` and `label_fallback` from `sfh_label('p_valid')`.

- [ ] **Step 1: Make the change.** Existing tests are the safety net, so nothing new is written first. If DuckDB 1.5.6 rejects `query_table` inside a table macro, fall back to a scalar macro `sfh_label_point(geom) → STRUCT(lp GEOMETRY, label_fallback INTEGER)` with the same semantics. Record which form you used in the `05_macros.sql` header comment.

- [ ] **Step 2: Run the pipeline tests**

Run: `npm run test:pipeline`
Expected: PASS with **no golden update**. `golden.test.ts` byte-compares `parcels/`, and `sql.test.ts` "puts every label point strictly inside its polygon" and "labels a holed parcel outside its hole" still pass.

- [ ] **Step 3: Commit**
```bash
git add pipeline/sql/05_macros.sql pipeline/sql/10_parcels.sql pipeline/lib/sql.ts
git commit -m "refactor(pipeline): move parcel label points into the sfh_label macro" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `45_land.sql`: build the mask and clip the lots

**Files:**
- Create: `pipeline/sql/45_land.sql`, `pipeline/test/land-helpers.ts`, `pipeline/test/land-clip.test.ts`
- Modify: `pipeline/lib/sql.ts` (insert `'45_land.sql'` between `'40_heights.sql'` and `'50_clip.sql'`), `pipeline/config.ts` (`SQL_VARS`), `pipeline/lib/quality-rules/sd.ts`, `docs/dev/pipeline.md` (new section "Land mask", plus the generated quality section)

**Interfaces:**
- Consumes: `src_land` (Task 1), `sfh_label` (Task 2), `parcels` (from 10), `buildings` (from 40).
- Produces: `SQL_VARS.land_min_removed_m2 = 5.0`, `land_simplify_m = 0.5`, `land_seam_m = 0.05`, `land_cell_m = 250`. Each gets a comment: "tier 4, from the 2026-10-19 spike".
- Produces: table `land_mask(geom)`, one row in EPSG:7131.
- Produces: table `parcel_land(id VARCHAR, status VARCHAR, orig_m2 DOUBLE, dry_m2 DOUBLE, removed_m2 DOUBLE, n_pieces INTEGER)`. `status` is one of `'unchanged' | 'jitter' | 'clipped' | 'underwater'`. Here `jitter` means 0.01 m² ≤ land removal < 5 m², with the lot kept as it was. The table is ordered by id.
- Produces: `parcels` rebuilt with the same columns plus `geom_orig GEOMETRY` and `underwater BOOLEAN`. For `clipped` lots, `geom`, `geom4326`, `label_lng`, `label_lat`, `x0`, `y0` and `label_fallback` come from the dry geometry. Every other lot's row is unchanged. The primary key is kept.
- Produces: `report_counts` keys `land.tiles`, `land.mask_area_m2`, `land.clipped`, `land.underwater`, `land.jitter_kept`, `land.removed_m2` (clipped lots only), `land.underwater_m2`, `land.building_kept_m2` and `land.outside_tiles` (lots not covered by the union of present z15 tile envelopes). Areas are rounded to 3 decimals.
- Produces: one `quality_tally` row plus `quality_sample` ids (owner `scenario-data`) for each of:
  - `sd.parcels.land-clip`: `source 'datasf-parcels'`, `field 'geom'`, `kind 'shape'`, `action 'replace'`, `tier 4`, `valueTier 0` (the written value is the source polygon ∩ OSM land, both per record), `maskBit null`. Fired = clipped, of = parcels.
  - `sd.parcels.underwater`: `kind 'observe'`, `action 'none'`, `tier 4`, `valueTier null`. Fired = underwater, of = parcels.
  - Both use the default shares. Labels are plain English, e.g. "Cuts a lot back to its dry land (OpenStreetMap shoreline, piers and existing buildings)" and "Counts lots with no dry land; they stay on the map but cannot be built on".
- Produces: `landDb(o: { lots: { id: string; rect: Rect }[]; land: { layer: LandLayer; tile: Rect; rect: Rect }[]; buildings?: Rect[] }): Promise<Duck>` in `land-helpers.ts`. `Rect = [x0, y0, x1, y1]` in local metres from O = (−122.4195, 37.76), as in the mini fixture. The helper creates minimal `parcels` (via `10_parcels.sql`'s columns, with labels from `sfh_label`), `buildings`, `src_land` (tile w/s/e/n = the 4326 bbox of `tile`, z 15, x/y = the list index), `report_counts` and the quality tables. It then runs `05_macros.sql` and `45_land.sql`.

Algorithm. The tests do not determine it, so follow it:

```
l_feat   = per src_land row (z = 15): ST_Intersection(ST_MakeValid(ST_GeomFromGeoJSON(geojson)),
           ST_MakeEnvelope(w, s, e, n)) → CollectionExtract 3 → ST_Transform 4326→7131 (always_xy)
           → ST_ReducePrecision(·, 0.01); drop empties
land_mask = ST_SimplifyPreserveTopology(
             ST_Buffer(ST_Buffer(ST_Union_Agg(geom ORDER BY layer, x, y, fid), +seam), −seam),
             land_simplify_m)        -- ORDER BY in the aggregate: determinism (V12), as list_sum elsewhere
l_cells  = land_mask ∩ each land_cell_m grid square over its extent (non-empty pieces, cid in row-major order)
l_area   = per parcel: land_m2 = list_sum(list(ST_Area(ST_Intersection(p.geom, c.geom)) ORDER BY cid))
           over intersecting cells; removed_land = ST_Area(p.geom) − land_m2
candidates = removed_land ≥ land_min_removed_m2
l_dry    = per candidate: union (ordered) of p ∩ cells and p ∩ intersecting buildings → CollectionExtract 3
           → parts with area ≥ min_piece_m2, ST_Collect in (area desc, path) order
status   = dry empty → underwater; ST_Area(p) − ST_Area(dry) < land_min_removed_m2 → unchanged/jitter;
           else clipped (geom := dry)
labels   = sfh_label over the clipped rows only
```

If DuckDB's `ST_Buffer` has no mitre join, use the default join. At ±5 cm the difference stays below the cm grid.

- [ ] **Step 1: Write the failing tests** in `pipeline/test/land-clip.test.ts`. They share one earth tile `T = [0, 0, 100, 100]` unless the test says otherwise.

```ts
it('leaves an inland lot byte-identical', …)            // lot [10,10,40,40]: hex(geom) = hex(geom_orig), status 'unchanged', label unchanged
it('clips a shoreline lot to its dry part and relabels it', …) // lot [80,10,120,40]: dry_m2 ≈ 600 (±0.5), status 'clipped',
                                                       // ST_Contains(geom, label point), ST_Area(geom_orig) ≈ 1200
it('clips each feature to its own tile', …)             // feature rect [0,0,115,100] in tile T: same lot, dry_m2 ≈ 600 (±0.5)
it('closes the seam between adjacent tiles', …)         // tiles [0,0,50,100] and [50.02,0,100,100], each feature = its tile:
                                                       // SELECT ST_NumGeometries(geom) FROM land_mask → 1
it('keeps a lot that loses less than 5 m² exactly as it was', …) // lot [70,50,100.1,80] (~3 m² out):
                                                       // status 'jitter', hex(geom) = hex(geom_orig), land.jitter_kept = 1
it('flags a lot with no dry land as underwater and keeps its outline', …) // lot [120,10,140,40]:
                                                       // underwater true, hex(geom) = hex(geom_orig), land.underwater = 1
it('counts land under an existing building as dry and keeps every dry piece', …)
                                                       // + building [105,15,111,25]: dry_m2 ≈ 660, n_pieces = 2
it('counts a pier polygon as land', …)                  // pier feature [100,50,110,60] in tile [100,0,200,100];
                                                       // lot [100,50,110,60] → status 'unchanged'
it('treats dry pieces under 2 m² as water', …)          // lot [99.5,10,120,12] (1 m² dry) → status 'underwater'
it('builds the same mask and lots twice', …)            // run 45 twice: hex(land_mask.geom) and hex(parcels.geom) identical
it('counts lots outside the tile coverage', …)          // lot [300,0,320,20] → land.outside_tiles = 1
it('tallies the land-clip and underwater rules', …)     // quality_tally rows (fired, of) and their quality_sample ids
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest --run --project pipeline pipeline/test/land-clip.test.ts`
Expected: FAIL, because `45_land.sql` is missing.

- [ ] **Step 3: Implement** `45_land.sql`, `SQL_VARS`, the `SQL_FILES` entry and the two rules in `sd.ts`. The `45_land.sql` header comment lists what it reads and writes, as the other files do. Do not touch `60` or `80` yet: `parcels` keeps its columns, and the new ones are only added.

- [ ] **Step 4: Run the pipeline tests, update the golden, regenerate the quality doc**

Run: `npx vitest --run --project pipeline pipeline/test/land-clip.test.ts`. Expected: PASS.
Run: `npm run pipeline -- quality-doc`, then `npm run pipeline -- fixture --update-golden`.
Expected: the golden diff touches only `report.json`: new `land.*` keys and `quality.sd.parcels.*` keys, with mini values `land.clipped 0`, `land.underwater 0`. No geometry changes, because the mini lots are all inland.
Run: `npm run test:pipeline`. Expected: PASS. `quality.test.ts` passes once the doc is regenerated.

- [ ] **Step 5: Document.** Add a `## Land mask` section to `docs/dev/pipeline.md` after "Fixture". It covers the source and layers, the order (after `40_heights`, before `50_clip`), the thresholds and their names, `geom_orig` for lineage, the underwater representation, and the `land.*` keys.

- [ ] **Step 6: Commit**
```bash
git add pipeline/sql/45_land.sql pipeline/lib/sql.ts pipeline/config.ts pipeline/lib/quality-rules/sd.ts pipeline/test/land-helpers.ts pipeline/test/land-clip.test.ts pipeline/test/fixtures/mini/golden docs/dev/pipeline.md e2e/fixtures/data/fixture-0
git commit -m "feat(pipeline): clip lots to the land mask in 45_land.sql" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Shoreline lots in the mini fixture, and the downstream wiring

The fixture extract (`pmtiles extract` of build 20261009) has z15 tiles in columns 5240 and 5241 only. East of tile 5241's east edge, at `TILE_EAST_LNG = (5242 / 2 ** 15) * 360 - 180` = −122.40966796875, there is no `earth`, so that edge serves as the fixture's shoreline. Call `E` the local x of that meridian at y = 15 m, computed in `make-fixture.ts` through its own projection (≈ 865 m). Do not hard-code it. The tile columns come from the extract's header bounds (−122.4215 to −122.417). Task 1's test pins the columns that are actually present. If they differ, take `E` from the east edge of the easternmost column that is present.

**Files:**
- Modify: `pipeline/test/fixtures/mini/make-fixture.ts`, `pipeline/test/fixtures/mini/README.md` (lots table rows 15–17, extras, the derived row counts table, a sentence on the coverage-edge shoreline), regenerated `raw/*` and `sources.lock.json`
- Modify: `pipeline/sql/60_attributes.sql` (`a_rule` and `parcel_out`), `pipeline/sql/80_scenario.sql:179` (`s_map_b` uses `p.geom_orig`)
- Modify: `pipeline/config.ts` `FIXTURE_PROFILE` and its doc comment
- Modify: `docs/dev/pipeline.md` "Fixture" (lots 15–17)
- Test: `pipeline/test/land-fixture.test.ts` (new); update the counts in `pipeline/test/sql.test.ts` and anything else that pins 14 lots

**Interfaces:**
- Produces, as fixture data (all zoning `RH-2`; land use `VACANT`, resunits 0):

| lot | id | rect (local m) | roll 2025 + 2024 | exercises |
| --- | --- | --- | --- | --- |
| 15 | `3512015` | x[E−30, E+10] y[0, 30] | MISC/V, 0 st, 0 u | shoreline crossing; 2 dry pieces with `bbay` |
| 16 | `3512016` | x[E+20, E+40] y[0, 30] | SRES/D 1950, 1 st, 2 u | fully underwater; existing homes kept |
| 17 | `3512017` | x[E−30, E+0.1] y[40, 70] | MISC/V, 0 st, 0 u | removal under 5 m² → unchanged |

  Plus:
  - Overture `bbay` at x[E+2, E+8] y[10, 20], h=6, on lot 15's water side.
  - Retired parcel `3512096` at x[E+3, E+7] y[22, 28], `active=false`, attrs row with `date_rec_drop` 2024-06-30. Its centroid lies in lot 15's water part.
  - Neighbourhood `Bayview Hunters Point` at x[E−50, E+50] y[−100, 100].
  - Height district `65-X` (`"65"`) at x[E−50, E+50) y[−100, 100].
- Produces: `FIXTURE_PROFILE.parcelRange = [17, 17]`, `neighborhoodCount = 3`, `scenarioUnitsRange = [72, 72]` (70 + lot 16's 2). `unitsTarget` stays 88, because the LUDB units do not change. `rollJoinMin` stays 0.8 (12 of the 14 eligible lots have a 2025 roll row).
- Produces: `parcel_out` gains `underwater BOOLEAN` and `geojson7131_orig VARCHAR`. The latter is non-null only for `parcel_land.status = 'clipped'` and is `ST_AsGeoJSON(geom_orig)`. `parcel_out.eligible = l.eligible AND NOT p.underwater`, and `area_m2 = ST_Area(geom)`, which is clipped area for clipped lots and the original area for underwater ones.

- [ ] **Step 1: Write the failing tests** in `pipeline/test/land-fixture.test.ts`. Use `miniDuck()` + `createQualityTables` + `runSql`, as `sql.test.ts` does.

```ts
it('cuts the shoreline lot to its dry part', …)   // 3512015: parcel_land.status 'clipped', dry_m2 ≈ 960 (±2), n_pieces 2,
                                                  // parcel_out.area_m2 ≈ 960, label point inside geom, eligible true
it('flags the lot in the water and keeps its outline and area', …)
                                                  // 3512016: underwater true, eligible false, area_m2 ≈ 600 (±0.5),
                                                  // hex(geom) = hex(geom_orig)
it('keeps a lot that only grazes the shoreline', …) // 3512017: status 'jitter', hex(geom) = hex(geom_orig)
it('leaves every inland lot unchanged', …)        // every parcel id except 3512015–3512017 (the 14 original lots):
                                                  // status 'unchanged', hex(geom) = hex(geom_orig)
it('matches retired lineage on the original polygon', …) // parcel_lineage: 3512096 → current_mapblklot '3512015'
it('reports the clip counts', …)                  // land.clipped 1, land.underwater 1, land.jitter_kept 1, land.outside_tiles 3
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest --run --project pipeline pipeline/test/land-fixture.test.ts`
Expected: FAIL, because lot `3512015` does not exist yet.

- [ ] **Step 3: Implement** the fixture additions (then run `npx tsx pipeline/test/fixtures/mini/make-fixture.ts`), the `60`/`80` wiring and `FIXTURE_PROFILE`.

- [ ] **Step 4: Regenerate and run**

Run: `npm run pipeline -- fixture --update-golden`. Expected: exit 0, with every invariant passing.
Run: `git diff --stat pipeline/test/fixtures/mini/golden/scenarios/fzp/projects.json pipeline/test/fixtures/mini/golden/derived/project-histories.json`. Expected: **no change**, because projects are untouched.
Run: `npm run test:pipeline`. Expected: PASS once the lot counts in existing tests are updated, e.g. `sql.test.ts` "emits one record per distinct active non-null mapblklot".

- [ ] **Step 5: Commit**
```bash
git add pipeline/test/fixtures/mini pipeline/sql/60_attributes.sql pipeline/sql/80_scenario.sql pipeline/config.ts pipeline/test docs/dev/pipeline.md e2e/fixtures/data/fixture-0
git commit -m "test(pipeline): shoreline, underwater and grazing lots in the mini fixture" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Carry `underwater` in the chunk record; underwater is never scenario-eligible

**Files:**
- Modify: `src/lib/data/parcel.ts`. The header comment says the shapes are fixed. Amend it to "extended by the 2026-10-19 underwater-lots spec".
- Modify: `src/lib/data/parcel-chunk.ts`, `pipeline/steps/chunks.ts` (`Row` and the query gain `underwater`), `pipeline/lib/scenario-eligibility.ts`
- Test: `src/lib/data/parcel-chunk.test.ts`, `pipeline/test/land-fixture.test.ts`

**Interfaces:**
- Produces: `ParcelRecord.underwater?: true`. It is set only when true, so records without it stay `toEqual` to existing test fixtures.
- Produces: `ParcelChunkV1.uw?: number[]`, the strictly increasing row indices (in the chunk's sorted order) of underwater records. The encoder omits the key when the list is empty. The decoder treats a missing `uw` as none, and throws `ChunkFormatError` on non-integer, out-of-range or non-increasing entries, or on an underwater row whose `elig` is 1.
- Produces: `scenarioEligible(rec: Pick<ParcelRecord, 'eligible' | 'landUse' | 'underwater'>, existingUnits)` returns `false` whenever `rec.underwater`, even under `sd.landuse.none-with-units`.

- [ ] **Step 1: Write the failing tests**

`src/lib/data/parcel-chunk.test.ts`:
```ts
it('round-trips an underwater record', …)   // decode(encode([a, {...b, eligible: false, underwater: true}]))[1].underwater === true; [0] has no key
it('omits uw when no record is underwater', …) // JSON.parse(encode(recs)).uw === undefined; bytes equal the pre-change encoding of the same recs
it('decodes a chunk without uw', …)         // a stored v1 chunk string (no uw) decodes with no record flagged
it('rejects a bad uw column', …)            // [1, 1], [-1], [count], and an underwater row with elig 1 → ChunkFormatError
```
`pipeline/test/land-fixture.test.ts` (reads `e2e/fixtures/data/fixture-0`):
```ts
it('ships the underwater flag in the chunk', …) // decoded 3512016: underwater true, eligible false, areaM2 ≈ 600;
                                                 // 3512015: no flag, areaM2 ≈ 960
it('gives the underwater lot no yield and keeps its homes', …) // readParcelsBin: 3512016 eligible 0, every yield and baseYield 0,
                                                 // existingUnits 2; 3512015 eligible 1, top-fill yield > 0
```
In `pipeline/test/scenario-*.test.ts` (wherever `scenarioEligible` is tested), add a case: `scenarioEligible({ eligible: false, landUse: 'NONE', underwater: true }, 5)` is `false`.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest --run --project server src/lib/data/parcel-chunk.test.ts` and `npx vitest --run --project pipeline pipeline/test/land-fixture.test.ts`.
Expected: FAIL, because `underwater` is undefined.

- [ ] **Step 3: Implement**, then run `npm run pipeline -- fixture --update-golden`. Expected: only the chunk holding 3512016 changes in `golden/parcels`.

- [ ] **Step 4: Run everything that reads records**

Run: `npm run test:unit`, then `npm run test:pipeline`, then `npm run check`, then `npm run lint`. Expected: PASS. `check.ts` V17 compares against `scenarioEligible`, so it follows the change.

- [ ] **Step 5: Commit**
```bash
git add src/lib/data pipeline/steps/chunks.ts pipeline/lib/scenario-eligibility.ts pipeline/test pipeline/test/fixtures/mini/golden e2e/fixtures/data/fixture-0
git commit -m "feat(data): flag underwater lots in parcel chunks" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Yield-loss check and the land section of the quality report

**Files:**
- Create: `pipeline/lib/land-report.ts`, `pipeline/test/land-report.test.ts`
- Modify: `pipeline/lib/quality-rules/sd.ts`, `pipeline/lib/quality.ts` (`writeQualityReport` gains an optional `sections: string[]` that is appended after the Samples), `pipeline/steps/chunks.ts` (`readClippedOriginals`), `pipeline/steps/scenario.ts` (calls `clipYieldLoss` after the main loop and records the rule), `pipeline/steps/build.ts` (passes `landClipSection`), `docs/dev/pipeline.md` (regenerated quality section; "Where things land" notes the land section)

**Interfaces:**
- Consumes: `parcel_land`, `parcel_out.geojson7131_orig` (Tasks 3–4), `scenarioYield`, `fillStories`, `FILL_LEVELS`.
- Produces: `readClippedOriginals(db: Duck): Promise<Map<ParcelId, { polygon: [number, number][][]; keptShare: number }>>`. These are the original rings in the same local frame (`x0, y0`), for `status = 'clipped'` lots, with `keptShare = dry_m2 / orig_m2`.
- Produces: `clipYieldLoss(rows: { id: ParcelId; keptShare: number; clippedTop: number; originalTop: number }[]): { fired: number; of: number; sample: ParcelId[] }`. Here `of` counts rows with `keptShare > 0.95`, and a row fires when it is in `of`, `originalTop > 0` and `clippedTop === 0`. In `writeScenario`, `clippedTop = grossTop[i]` and `originalTop = scenarioYield({ ...view, polygon, areaM2: ringsAreaM2(polygon) }, fillStories(full, envelopeStories), null)`.
- Produces: rule `sd.parcels.clip-yield-loss`: `kind 'outlier'`, `action 'none'`, `tier 4`, `valueTier null`, **`warnShare 0`** (any firing warns; departure comment: "the spike's 9900019H case must never pass silently"), `failShare 0.1`, denominator "clipped lots that keep more than 95% of their area". Label: "Counts lots the land clip barely shrank but left with no buildable yield; changes nothing".
- Produces: `landClipSection(db: Duck): Promise<string>`. It returns a `## Land clip` markdown section with the counts (clipped, underwater with area, total removed in ha, grazing lots kept, buildings kept m², lots outside tile coverage) and a table of the 20 largest removals (`id`, neighbourhood, land use, status, original m², dry m², removed m², removed %), using `mdTable`. Underwater lots count by their full area. Rows are ordered by removed area desc, then id.

- [ ] **Step 1: Write the failing tests** in `pipeline/test/land-report.test.ts`

```ts
it('fires when a lot keeps most of its area but loses all yield', () => {
  expect(clipYieldLoss([
    { id: 'a', keptShare: 0.99, clippedTop: 0, originalTop: 48 },
    { id: 'b', keptShare: 0.99, clippedTop: 40, originalTop: 48 },
    { id: 'c', keptShare: 0.5, clippedTop: 0, originalTop: 48 }
  ])).toEqual({ fired: 1, of: 2, sample: ['a'] });
});
it('writes the land section with the largest removals first', async () => {
  // landDb, tile T = [0,0,100,100]: 's1' [80,10,120,40] (clipped, removes 600 m²),
  // 'u1' [120,10,150,40] (underwater, 900 m²), 'i1' [10,10,40,40] (inland)
  const md = await landClipSection(db);
  expect(md).toMatch(/^## Land clip/);
  expect(md.indexOf('| u1 ')).toBeLessThan(md.indexOf('| s1 '));
  expect(md).not.toContain('| i1 ');
});
it('reports clip-yield-loss on the mini build', …) // build counts: quality.sd.parcels.clip-yield-loss.fired 0, .of 0
                                                   // (lot 15 keeps 80%)
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest --run --project pipeline pipeline/test/land-report.test.ts`
Expected: FAIL, because `clipYieldLoss` is not defined.

- [ ] **Step 3: Implement**, then run `npm run pipeline -- quality-doc` and `npm run pipeline -- fixture --update-golden`. Expected: only `report.json` gains the `quality.sd.parcels.clip-yield-loss.*` keys.

- [ ] **Step 4: Run the tests**

Run: `npm run test:pipeline`, then `npm run check`, then `npm run lint`. Expected: PASS. If `quality.test.ts` pins the kind-default departures, add this rule there.

- [ ] **Step 5: Commit**
```bash
git add pipeline/lib pipeline/steps pipeline/test docs/dev/pipeline.md pipeline/test/fixtures/mini/golden e2e/fixtures/data/fixture-0
git commit -m "feat(pipeline): report the land clip and lots it leaves without yield" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Painting and the tooltip say "in the Bay"

**Files:**
- Modify: `src/lib/plan/resolve.ts` (`OpCoverage`, `applyOp`), `src/lib/sim/protocol.ts` (`OpStats`, `ParcelSummary`), `src/lib/sim/host.ts` (`computeStats`, `parcelSummary`), `src/lib/map/types.ts` (`ParcelSummaryLike`), `src/lib/map/tooltip.ts`, `src/lib/brush/messages.ts`, `src/lib/fzp/FzpMode.svelte:467` (pass `underwater` through)
- Test: `src/lib/brush/messages.spec.ts`, `src/lib/map/tooltip.spec.ts`, `src/lib/sim/underwater.spec.ts` (new, server project); update the `toEqual` coverage and stats literals in existing specs

**Interfaces:**
- Consumes: `ParcelRecord.underwater` (Task 5) and the fixture-0 chunks (Tasks 4–5).
- Produces: `OpCoverage { eligible: ParcelId[]; ineligible: ParcelId[]; underwater: ParcelId[] }`. An ineligible record with `underwater` goes to `underwater`, not to `ineligible`.
- Produces: `OpStats.underwater: number`.
- Produces: `ParcelSummary.underwater?: true` and `ParcelSummaryLike.underwater?: boolean`. `parcelSummary` sets the key only when the record is underwater.
- Produces: `strokeMessage` appends `` ` · ${n(s.underwater)} in the Bay` `` when `s.underwater > 0`, after the not-eligible segment. When `covered === 0`, the head is "No eligible parcels under that stroke" if `ineligible + underwater > 0`.
- Produces: in `tooltipLines`, when `s.underwater` is set, the line is `` `${base} · in the Bay` `` in place of `` `${base} · not eligible for change` ``.

- [ ] **Step 1: Write the failing tests**

`messages.spec.ts`:
```ts
it('counts lots in the Bay apart from ineligible ones', () => {
  expect(strokeMessage({ ...base, covered: 2, built: 1, notBigger: 1, ineligible: 1, underwater: 3, stories: 4 }))
    .toBe('Painted 4 stories on 2 parcels · 1 new building · 1 already as big or bigger · 1 not eligible (open space or unmapped lots) · 3 in the Bay');
});
it('says no eligible parcels when the stroke is all water', () => {
  expect(strokeMessage({ ...base, covered: 0, built: 0, notBigger: 0, underwater: 2 }))
    .toBe('No eligible parcels under that stroke · 2 in the Bay');
});
```
`tooltip.spec.ts`: add a case with `summary: { eligible: false, underwater: true, n: 0 }` → `[`Parcel ${P}`, 'Existing building · 0 units · in the Bay']`.

`src/lib/sim/underwater.spec.ts` (decodes the fixture-0 chunks from disk with `decodeParcelChunk`, builds a `createParcelIndex()` from them):
```ts
it('builds nothing on the lot in the Bay', …)   // generate(rec3512016, { maxStories: 6 }, fnv1a32(id), 'max') === null;
                                                // generate(rec3512015, …) !== null
it('reports the lot in the Bay as underwater coverage', …) // applyOp(new Map(), paint 6 over both lots' label points, index)
                                                // .coverage: underwater ['3512016'], eligible includes '3512015', ineligible []
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest --run --project server src/lib/brush/messages.spec.ts src/lib/map/tooltip.spec.ts src/lib/sim/underwater.spec.ts`
Expected: FAIL, because the "in the Bay" segment and `coverage.underwater` are missing.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests and checks**

Run: `npm run test:unit`, then `npm run check`, then `npm run lint`. Expected: PASS once the coverage/stats `toEqual` literals in `resolve`, `host` and `BrushController` specs gain `underwater`.

- [ ] **Step 5: Commit**
```bash
git add src/lib
git commit -m "feat(brush): say when painted lots are in the Bay" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Docs pass and full local verification

**Files:**
- Modify: `docs/dev/pipeline.md`. The "Scenario parcels" **Eligible** bullet says an underwater lot is never eligible. The Invariants paragraph needs no new V-number, but add a sentence there that `land.outside_tiles` must be 0 on a live build (Task 9 checks it). Also check that the Land mask section (Task 3) documents the chunk `uw` column.
- Modify: `docs/dev/testing.md` "Fixture dataset", only if it lists the lot count.

- [ ] **Step 1: Make the doc edits**

- [ ] **Step 2: Run the full suite**

Run: `npm run lint`, `npm run check`, `npm run test:unit`, `npm run test:pipeline`, then `npm run test:e2e`. The e2e run loads the regenerated fixture-0.
Expected: all PASS.

- [ ] **Step 3: Commit**
```bash
git add docs/dev
git commit -m "docs(pipeline): document underwater lots and the land mask" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Live build, acceptance and release (the upload waits for the user)

No code changes. Each step's result goes in the PR description.

- [ ] **Step 1: Build on the committed lock.** Do not refresh sources: the change should be attributable to the clip alone. Run `npm run pipeline -- fetch --restore`, then `npm run pipeline -- build`.
Expected: every invariant passes, and a new `<v>` is printed.

- [ ] **Step 2: Check the counts against the spike.** In `pipeline/out/<v>/report.json`:
  - `land.clipped + land.underwater` should be ≈ 970 (spike: 972).
  - `land.underwater` should be ≈ 750 (spike: 752).
  - `land.jitter_kept` should be ≈ 10.
  - `land.outside_tiles` must be **0**.
  - `quality.sd.parcels.clip-yield-loss.fired` should be 0. If it is not, investigate each id; the first lever is raising `land_simplify_m` toward 1.0.
  - Compare Σ top-fill `yield` in `parcels.bin` (`readParcelsBin`) and `scenario.yield.fzp_net_total` with the current staging dataset, `2026-10-19-547e741b`. If its `report.json` is not on disk, build `main` on the same lock into a temp out root. Expect a full-fill drop of ≈ 0.5% (spike: −10,551, −0.54%), concentrated in clipped or underwater lots. Confirm that `scenarios/fzp/projects.json` is byte-identical to the baseline.
  - Any large departure from these numbers means investigating before going further (spec "Acceptance numbers").

- [ ] **Step 3: Read the quality report's `## Land clip` section** (`pipeline/.cache/derived/<v>/quality-report.md`). Expect Treasure Island's submerged lots and Hunters Point Shipyard `4591A090` at the top, and no inland lots.

- [ ] **Step 4: Visual check.** Run `npx tsx scripts/r2-load-local.ts pipeline/out/<v> <v>`, set `PUBLIC_DATASET_VERSION=<v>` in `.dev.vars`, then `npm run dev`. Look at Hunters Point, Treasure Island / Yerba Buena, Mission Bay, Pier 70 and the Embarcadero piers. Expect dry land kept, water removed, and standing piers and pier sheds intact. Paint across a fully underwater lot and expect "in the Bay". Take screenshots for the PR.

- [ ] **Step 5: Sign off and open the PR.** Run `npm run signoff` (do not `git push` first), then `gh pr create --body-file <tmp>`, with the counts, the comparison and the screenshots in the body.

- [ ] **Step 6: STOP and ask the user** before running `npm run pipeline -- upload <v>`, which is irreversible (V13). Also ask before the follow-up PR that bumps `env.staging.vars.PUBLIC_DATASET_VERSION` in `wrangler.jsonc` per `docs/dev/deploy.md` "Promoting a datasetVersion". The upload is followed by `npm run pipeline -- verify <v> --origin https://sfhousing-staging.mindlace.net`. The production bump is a later PR and release.
