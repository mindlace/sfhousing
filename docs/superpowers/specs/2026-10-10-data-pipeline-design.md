# data-pipeline — Spec (M1)

Source of truth: `docs/superpowers/design/2026-10-10-1749-sf-housing-sim.md`.
Evidence marks: **(V: …)** = verified at the cited source on 2026-10-10; **(I)** = inferred.
All DataSF censuses below were run against the live SODA API on 2026-10-10.

## 1. Scope

> | `data-pipeline` | Reproducible offline build in `pipeline/` that turns public sources into versioned static artifacts. Uses DuckDB (spatial extension) SQL, tippecanoe and a small Node orchestrator. Fetches sources, joins buildings and land use to parcels, classifies eligibility, writes `buildings.pmtiles`, parcel chunks, `neighborhoods.geojson` and `manifest.json`, then uploads them to R2 under a new `datasetVersion`. Owns invariant checks such as existing-unit totals and join coverage. |

**In:**
- `pipeline/`: the CLI, source adapters, DuckDB SQL, the lockfile and the fixtures.
- The **parcel chunk codec** `src/lib/data/parcel-chunk.ts`, a pure TS module with `encodeParcelChunk` and `decodeParcelChunk`. The pipeline uses it to write chunks, and the worker host uses it to read them. This spec owns the format.
- The `Manifest` type and its validator, `src/lib/data/manifest.ts`.
- Artifacts: `manifest.json`, `parcels/<cellId>.json`, `buildings.pmtiles`, `basemap.pmtiles`, `fonts/**`, `neighborhoods.geojson` and `report.json`.
- Archiving raw source snapshots to R2. Uploading datasets to R2. Printing the `PUBLIC_DATASET_VERSION` bump line.
- The invariants and the build report.
- Generating the e2e fixture dataset that `platform` and `map-view` use.

**Out:**
- Serving `/data/*`, the cache headers and range handling (`platform` §4.4).
- The basemap style and flavour (`map-view`).
- Fetching chunks at runtime and building `ParcelIndex` (`brush-tool` worker host, `plan-model`).
- Typology and unit yield (`typology-generator`).
- Zoning, the Development Pipeline and Building Permits sources (M3–M5).
- Scheduled or CI full runs. M1 runs are manual. CI runs the fixture build only.

## 2. Interfaces

Owned:

| # | interface | owner → consumers | mark |
|---|---|---|---|
| I1 | `type ParcelId = string` — SF `mapblklot` (block+lot, e.g. `"3512008"`), the single join key across all data | data-pipeline → all | DC |
| I6 | `interface ParcelRecord { id: ParcelId; polygon: [x: number, y: number][][] /* local metres, EPSG:7131 or equivalent, origin at label point */; labelPoint: [lng, lat]; areaM2: number; existingUnits: number; existingFloorAreaM2: number; existingHeightM: number; landUse: string; eligible: boolean; neighborhood: string }` | data-pipeline → plan-model, generator, scoreboard | DC |
| I12 | Data manifest: `/data/<datasetVersion>/manifest.json` → `{ datasetVersion, builtAt, sources: { id, url, retrievedAt, license }[], chunks: { cellId, bbox, url, parcelCount }[], buildingsTiles: url, neighborhoods: url }` | data-pipeline → map-view, generator, platform | DC |

Consumed: none of the I-rows. The pipeline's only dependency is platform's key layout (`data/<v>/<path>`), its bucket `sfhousing` and `DATASET_VERSION_RE` (platform §4.2–4.4).

### Internal types

```ts
// src/lib/data/parcel-chunk.ts — wire format "sfh-parcels/1"
interface ParcelChunkV1 {
  format: 'sfh-parcels/1';
  datasetVersion: string;
  cellId: string;
  count: number;                        // N
  dict: { landUse: string[]; neighborhood: string[] };  // each sorted ascending
  id: string[];                         // N ParcelIds, ascending (JS `<`)
  label: number[];                      // 2N ints: round(lng·1e7), round(lat·1e7)
  units: number[];                      // N ints
  floorArea: number[];                  // N, m², 1 decimal
  height: number[];                     // N, m, 1 decimal
  lu: number[];                         // N indexes into dict.landUse
  nh: number[];                         // N indexes into dict.neighborhood
  elig: (0 | 1)[];                      // N
  rings: number[][];                    // N arrays of vertex counts per ring
  xy: number[];                         // all vertices, interleaved int centimetres
}
function encodeParcelChunk(datasetVersion: string, cellId: string, recs: ParcelRecord[]): string;
function decodeParcelChunk(json: unknown): ParcelRecord[];   // throws ChunkFormatError
class ChunkFormatError extends Error {}

// src/lib/data/manifest.ts
interface Manifest {
  datasetVersion: string; builtAt: string;
  sources: { id: string; url: string; retrievedAt: string; license: string }[];
  chunks: { cellId: string; bbox: [w: number, s: number, e: number, n: number]; url: string; parcelCount: number }[];
  buildingsTiles: string; neighborhoods: string;
}
function parseManifest(json: unknown): Manifest;              // throws ManifestError
```

Decoding rules:
- `labelPoint = [label[2i]/1e7, label[2i+1]/1e7]`.
- Each polygon vertex is `[xy[k]/100, xy[k+1]/100]`, in metres.
- `areaM2` is **computed** with the shoelace formula from the decoded rings: outer rings positive, holes negative. It is rounded to 0.01. It is not stored.
- `landUse = dict.landUse[lu[i]]`, `neighborhood = dict.neighborhood[nh[i]]`, `eligible = elig[i] === 1`.
- Unknown top-level keys are ignored, so adding columns is non-breaking. An unknown `format` value, or any column length ≠ `count` (or ≠ `2·count` for `label`, or `Σrings·2` for `xy`), throws `ChunkFormatError`.

## 3. Global constraints

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

## 4. Behaviour

### 4.1 Sources (verified 2026-10-10)

DataSF moved from `data.sfgov.org` to **`data.sf.gov`**; the old host answers with a 301 (V: `curl` of `data.sfgov.org/api/views/acdm-wktn.json`). Adapters use `data.sf.gov` directly.

| source id | endpoint / columns used | rows (2026-10-10) | licence |
|---|---|---|---|
| `datasf-parcels` | `acdm-wktn` "Parcels – Active and Retired": `mapblklot, blklot, active, analysis_neighborhood, shape` | 227,967 active rows → 155,020 distinct `mapblklot` (72,678 condo sub-lots) | PDDL (V: `/api/views/acdm-wktn.json`) |
| `datasf-landuse-2023` | `fdfd-xptc` "[ARCHIVED] San Francisco Land Use – 2023": `mapblklot, landuse, resunits, res, totalcomm, the_geom` | 154,476 | "Public Domain U.S. Government" (V) |
| `datasf-footprints` | `ynuv-fyni` Building Footprints: `mblr, hgt_median_m, shape` | 177,023 (172,698 with `SF` prefix) | PDDL (V) |
| `datasf-neighborhoods` | `j2bu-swwd` Analysis Neighborhoods: `nhood, the_geom` | 41 | PDDL (V) |
| `overture-buildings` | `s3://overturemaps-us-west-2/release/<rel>/theme=buildings/type=building/*` | 177,940 in the bbox (release `2026-09-23.1`) | ODbL-1.0 (V: docs.overturemaps.org/attribution) |
| `protomaps-basemap` | `https://build.protomaps.com/<YYYYMMDD>.pmtiles` | — | ODbL-1.0 data (V: docs.protomaps.com) |
| `protomaps-fonts` | `github.com/protomaps/basemaps-assets` `fonts/` at a pinned commit | 4 stacks | OFL (V: repo `fonts/OFL.txt`) |

Fetch method:
- **DataSF:** SODA 2 paging, `GET /resource/<id>.geojson?$select=…&$order=:id&$limit=50000&$offset=k`, run until a page comes back short. Parcels add `$where=active=true`. This form returned `X-SODA2-Truth-Last-Modified` and `ETag` headers (V).
- **Overture:** DuckDB `read_parquet(…, hive_partitioning=1)` with `WHERE bbox.xmin >= -122.53 AND bbox.xmax <= -122.34 AND bbox.ymin >= 37.69 AND bbox.ymax <= 37.84`, after `INSTALL/LOAD spatial, httpfs; SET s3_region='us-west-2'`. Access is anonymous (V: docs.overturemaps.org/getting-data/duckdb). Run here on 2026-10-10, it took **15 s** (V).
- **Basemap:** `pmtiles extract https://build.protomaps.com/<date>.pmtiles basemap.pmtiles --bbox=-122.53,37.69,-122.34,37.84 --maxzoom=15` (V: docs.protomaps.com/guide/getting-started).

**Upstream retention forces archiving.** Overture keeps a release public for about 60 days, roughly two releases (V: Overture 2025-09-24 release notes). Protomaps daily builds disappear within about a week: `20261001.pmtiles` already returned 404 on 2026-10-10 (V). Every raw snapshot is therefore archived to R2 as `sources/<sha256>.<ext>`, a private key prefix that `/data/*` never serves. `fetch --restore` rebuilds the cache from the lockfile using those archives.

**Land Use 2023 is archived.** DataSF now points to `c5ge-t6pj` "San Francisco Land Use" (CC0, `data_as_of` 2026-08-17, Σresunits 423,007). That dataset has **no `landuse` category and no residential square footage**. Its schema is `open_space`, `geography_type ∈ {parcel, multiple_parcels, analytical}`, a list-valued `mapblklot`, and others (V). OD-6 and `existingFloorAreaM2` both depend on fields that only `fdfd-xptc` has, so M1 uses `fdfd-xptc`. See §8 OQ-1.

### 4.2 `pipeline/` layout and commands

```
pipeline/
  cli.ts                 # entry: npx tsx pipeline/cli.ts <cmd>  (npm run pipeline -- <cmd>)
  config.ts              # bbox, grid, thresholds, release pins, tool versions
  sources.lock.json      # committed: one entry per raw file (below)
  sources/{datasf,overture,protomaps}.ts   # fetch + normalise to GeoParquet
  sql/10_parcels.sql 20_landuse.sql 30_buildings.sql 40_heights.sql
      50_clip.sql 60_attributes.sql 70_export.sql      # run in order
  steps/{doctor,fetch,build,tiles,chunks,manifest,check,upload,verify}.ts
  test/fixtures/mini/    # hand-made sources (§6)
  .cache/  out/          # gitignored
src/lib/data/parcel-chunk.ts, manifest.ts   # shared codec (pure TS)
```

Runtime deps: `@duckdb/node-api@1.5.6-r.1` (V: npm). This repo used it with the spatial and httpfs extensions for the Overture probe. System tools are pinned in `config.ts` and checked by `doctor`: `tippecanoe 2.79.0` and `pmtiles 1.31.2`, both available from Homebrew (V: `brew info`), plus `wrangler` from devDeps. All shell-outs use `execFile` with argument arrays.

| command | does | network |
|---|---|---|
| `doctor` | Checks Node ≥ 22, the tool versions and that DuckDB extensions load. Exits 1 with an install hint for anything missing. | extension download |
| `fetch [--only <id>] [--release <ov>] [--basemap-date <d>]` | Downloads raw files to `.cache/raw/<sha256>`, normalises them to `.cache/norm/<id>.parquet` and rewrites `sources.lock.json`. With no pin, it takes the latest Overture release from `stac.overturemaps.org/catalog.json` `latest` (V) and yesterday's Protomaps build. | yes |
| `fetch --restore` | Rebuilds `.cache` from the R2 `sources/` archive, using the lock. | R2 only |
| `build` | Verifies every cached file's sha256 against the lock and refuses to run on a mismatch. Then runs SQL, tiles, chunks, manifest and `check`, writing `out/<v>/`. Offline. | none |
| `check [<v>]` | Re-runs the §4.9 invariants on `out/<v>/`. | none |
| `upload <v> [--local]` | Archives sources, uploads artifacts with `manifest.json` last, then prints the bump line. | R2 |
| `verify <v> --origin <url>` | Fetches the manifest and HEADs every URL it names. Range-reads both PMTiles and expects 206. | yes |
| `fixture` | Builds `test/fixtures/mini` and writes `e2e/fixtures/data/fixture-0001/`. | none |
| `all` | Runs `fetch` (only if the lock is missing), then `build`. Never uploads. | — |

Lock entry: `{ id, files: [{ url, sha256, bytes, archiveKey }], retrievedAt, upstreamVersion, rowCount, license }`. `upstreamVersion` is the SODA truth-last-modified, the Overture release id, the Protomaps build date or the fonts commit sha.

### 4.3 `datasetVersion`

The format is `<YYYYMMDD>-<h8>`, for example `20261010-3fa9c2d1`:
- `YYYYMMDD` is the UTC date of the newest `retrievedAt` in the lock.
- `h8` is the first 8 hex digits of sha256 over: the canonical lock JSON (keys sorted), the git tree hash of `pipeline/` plus `src/lib/data/`, and the pinned tool versions.

The version is derived from inputs, so it is known before the build. It matches platform's `DATASET_VERSION_RE` (`/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/`). The same lock and the same code give the same version string.

### 4.4 Parcels (I1, label point, polygon)

1. Load active rows where `mapblklot IS NOT NULL`. On 2026-10-10, 272 rows had a null `mapblklot`; they are dropped and counted.
2. **Condo and multi-lot handling.** Condominium sub-lots (`blklot ≠ mapblklot`) share their map lot's polygon. Two samples, `1649034` and `0026T001A`, had byte-identical shapes across 4 and 3 sub-lots (V). One record is emitted per `mapblklot`. Its geometry comes from the row where `blklot = mapblklot` if one exists; otherwise from the row with the smallest `blklot`. If sub-lot geometries differ, that is counted as a warning, not a failure. `ParcelId` is the `mapblklot` string as published. 7-, 8- and 9-character ids exist (126,892 / 27,133 / 995), for example `8711023C` and `0026T001A`. Ids are opaque strings, so nothing may parse them as numbers.
3. `ST_MakeValid`, then `ST_Transform(geom, 'EPSG:4326', 'EPSG:7131', always_xy := true)` (V: duckdb.org spatial functions). EPSG:7131 is "NAD83(2011) / San Francisco CS13", a transverse Mercator with `lat_0=37.75 lon_0=-122.45 k=1.000007`, in metres (V: epsg.io/7131).
4. **Label point** = `ST_PointOnSurface` of the largest polygon part, in 7131, transformed back to 4326 and rounded to 1e-7°. If that point does not lie strictly inside the polygon (in local coordinates, at cm precision), the pipeline uses `ST_PointOnSurface(ST_Buffer(part, -0.05))`. If that also fails, it keeps the original point and records a warning. DataSF's `centroid_*` columns are not used, because a centroid can fall outside an L-shaped lot.
5. **Local polygon (I6).** Each vertex is stored as `(X − X₀, Y − Y₀)`. `(X₀, Y₀)` is the *rounded* label point projected to 7131. Values are quantised to integer centimetres. This is exactly the frame the typology-generator §4.10 inverts. Rings are **open**, consecutive duplicates are removed, and rings with fewer than 3 vertices are dropped. Outer rings are counter-clockwise and holes clockwise, in x-east / y-north.
6. **Multipart parcels** keep all their parts. Ring order: parts by area, descending, and within each part the outer ring first, then its holes. typology-generator unions the rings with even-odd fill and uses the largest part. The report counts multipart parcels and holed parcels (generator IC-2).
7. **Neighborhood** = the parcel's `analysis_neighborhood`. Its 41 values equal `j2bu-swwd.nhood` exactly (V: set comparison). If the attribute is null, the pipeline uses the neighborhood polygon that contains the label point. A parcel left without a neighborhood fails the build.

### 4.5 Land use join and eligibility (OD-6)

The join is an exact string match on `mapblklot`. On 2026-10-10 the census was (V):
- **154,182 of 155,020** active map lots have a Land Use 2023 row (99.46%).
- **838** have none. These are mostly lots mapped after March 2023, for example Treasure Island lots added in 2024–26.
- **294** land-use rows point at lots that are no longer active. 284 of those are retired, and together they carry 1,709 units.

The 294 orphan rows are reassigned spatially. The `ST_PointOnSurface` of the row's `the_geom` is matched to the active parcel that contains it, but **only if** that parcel has no land-use row of its own. Otherwise the row is dropped and counted, so no unit is counted twice. If a `mapblklot` has duplicate rows, their units and square footage are summed, and `landUse` comes from the row with the largest `res + totalcomm`.

**Census of `landuse`** (rows, Σresunits) (V):

| `landuse` | rows | units | eligible |
|---|---|---|---|
| `RESIDENT` | 107,725 | 207,789 | yes |
| `MIXRES` | 22,448 | 157,022 | yes |
| `VACANT` | 8,512 | 11,241 | yes |
| *(null)* → `UNKNOWN` | 8,455 | 18,358 | yes |
| `MIXED` | 1,858 | 10,467 | yes |
| `MIPS` | 1,616 | 4,409 | yes |
| `RETAIL/ENT` | 1,465 | 1,240 | yes |
| `OPENSPACE` | 907 | 306 | **no** |
| `CIE` | 766 | 1,148 | yes |
| `PDR` | 431 | 415 | yes |
| `MED` | 177 | 84 | yes |
| `VISITOR` | 116 | 761 | yes |
| *(no row)* → `NONE` | 838 parcels | 0 | **no** |

**Eligibility rule:** `eligible = landUse ∉ {'OPENSPACE', 'NONE'}`. The rule is closed-world: any `landuse` value outside the 12 above fails the build, so a schema drift cannot silently change eligibility.

Notes on OD-6:
- *Right-of-way* has no land-use class and is not represented as parcels. In `ynuv-fyni`, right-of-way carries separate `CN…` keys (V: `mblr` column description). The ROW clause of OD-6 is therefore satisfied structurally, with no rule needed.
- A null `landuse` is **not** "no land-use row". Those rows hold 18,358 units, for example 1,272 units at `7296004`, and are kept eligible as `UNKNOWN`.
- `VACANT` rows can carry units (11,241). The class reflects square-footage coding, not occupancy (I). Units are taken as published.
- Following OD-6's "nothing protected", the one `MIXRES` and one `PDR` lot inside Golden Gate Park are eligible.

**Attributes:**
- `existingUnits = resunits`, or 0 when there is no row.
- `existingFloorAreaM2` is computed in this order:
  1. `(res + totalcomm) × 0.09290304`, when greater than 0.
  2. Otherwise, Σ over the building pieces on the parcel of `pieceAreaM2 × max(1, round(heightM / 3.1))`.
  3. Otherwise, `resunits × 80`.
  4. Otherwise 0.

  Rule 1 alone would leave **8,718 parcels with units but zero square feet** (28,522 units) (V). Those parcels would otherwise read as rebuildable "for free" under I8's null rule. The report counts each rule's use.
- `existingHeightM` = the maximum `heightM` of the building pieces assigned to the parcel, or 0. It is rounded to 0.1.

### 4.6 Buildings: render source and height fill (OD-1)

The render source is Overture `building`. `building_part` is not used in M1. Rows with `is_underground = true` are dropped (6 in SF). A building is kept if its `ST_PointOnSurface` falls inside the union of the 41 neighborhood polygons; this drops Marin and Daly City.

Measured on release `2026-09-23.1` (V, DuckDB probe):

| count | value |
|---|---|
| buildings | 177,940 |
| with `height` | 164,959 (92.7%) |
| `num_floors` only | 418 |
| neither | 12,563 |

Height contributors: OSM, then USGS LiDAR (12,942), then Microsoft ML (8,075). The maximum `height` is 326 m, Salesforce Tower.

**Height rule.** First match wins. `hs` records the source.
1. `height > 0` → `heightM = height` (`hs=0`, overture).
2. A DataSF footprint `f` with `mblr LIKE 'SF%'` and IoU(b, f) ≥ 0.5 in 7131 → `heightM = f.hgt_median_m` (`hs=1`, datasf). The best IoU wins; ties go to the smaller `sf16_bldgid`. `hgt_median_m` is the zonal median height above ground (V: column description). The pipeline uses it rather than `peak_1st_m`, which includes antennas and parapets.
3. `num_floors > 0` → `heightM = num_floors × 3.1` (`hs=2`, floors).
4. Otherwise `heightM = 7.0` (`hs=3`, default, two SF storeys).

`baseM = min_height`, or 0. Heights are clamped to [2.5, 340] and rounded to 0.1.

**Fallback.** If fewer than 95% of buildings end with `hs ∈ {0, 1, 2}`, `check` fails with: `"height coverage X% < 95%: set config.renderSource='datasf'"`. With `renderSource='datasf'`, the pipeline renders `ynuv-fyni` footprints using `hgt_median_m`, and `parcelId` comes directly from `mblr` without the `SF` prefix. That source matched 168,790 of 172,698 footprints to active map lots (V). Everything downstream is unchanged.

### 4.7 Parcel ↔ building join (footprints spanning parcels)

Buildings are **clipped to parcels**. For each building `b` and each parcel `p` whose polygon intersects it in 7131, the pipeline emits the piece `ST_Intersection(b, p)` with `parcelId = p.id`.
- Pieces under 2 m² are dropped and counted.
- The parts of `b` outside every parcel (piers over water, encroachments on right-of-way) are emitted once, **without** `parcelId`.

Every tile feature therefore belongs to at most one parcel. Hiding by `parcelId` removes exactly the mass that stood on the replaced lot and nothing on its neighbours. Because the condo map lot is the only polygon, a condo tower is one parcel.

This meets map-view's requirement of "a single parcel per feature; absent if unmatched". Where a building spans lots, map-view sees one feature per lot rather than one feature per building. Adjacent pieces have equal heights, so an unedited city looks the same. Shared walls may show faint seams (I).

### 4.8 Artifacts

All URLs in the manifest are **root-relative** (`/data/<v>/…`), so `new URL(u, manifestUrl)` and `pmtiles://` + `u` both work. R2 key = URL path without the leading `/`, as platform §4.4 requires.

**Parcel chunks.**
- Grid: **1 km × 1 km cells in EPSG:7131**. `cellId = "<floor(X₀/1000)>_<floor(Y₀/1000)>"`, for example `48_24`. Each parcel is assigned by its label point, so every parcel is in exactly one chunk (plan-model IC-3).
- URL: `/data/<v>/parcels/<cellId>.json`.
- Manifest `bbox`: the lng/lat extent of the chunk's parcel **polygons**, not the cell square. It is rounded outward to 1e-6. A brush near a cell edge therefore loads every chunk whose parcels it could touch.
- Chunks are sorted by `cellId`, and parcels by `id`. Output is `JSON.stringify` with no whitespace, so it is byte-deterministic.
- Includes ineligible parcels.

Expected sizes (I): about 150 non-empty cells, ≤ 4,000 parcels per cell, about 150 B per parcel raw. That gives about 23 MB raw for the whole city, or about 5 MB once compressed. Cloudflare compresses `application/json` by default (zstd on the Free plan, brotli on Pro) (V: developers.cloudflare.com/speed/optimization/content/compression).

**Why columnar JSON rather than FlatGeobuf or custom binary:**
- (a) I6 needs a per-parcel local origin. FlatGeobuf stores one CRS per file, so the client would reproject every vertex anyway.
- (b) `application/octet-stream` and FlatGeobuf are not on Cloudflare's auto-compress list (V, same page), so binary would ship uncompressed unless platform added pre-compression.
- (c) Each chunk is read whole. FlatGeobuf's spatial index and range reads buy nothing.
- (d) The codec is about 80 lines with no dependencies, and fixtures stay human-readable.

A 1 km cell keeps a 500-parcel stroke to 1–4 chunk requests, which the worker host prefetches at zoom ≥ 14 (brush-tool §4.9). A whole-city repaint needs every chunk, about 5 MB.

**`buildings.pmtiles`** is built from `70_export.sql` → GeoJSONSeq, ordered by `(parcelId NULLS LAST, overtureId)`:

```
tippecanoe -o buildings.pmtiles -l buildings -Z 12 -z 15 \
  -y parcelId -y heightM -y baseM -y hs \
  -T parcelId:string -T heightM:float -T baseM:float -T hs:int \
  --drop-smallest-as-needed --maximum-tile-bytes=400000 \
  --no-simplification-of-shared-nodes --force buildings.geojsonseq
```

All flags are verified at tippecanoe 2.79.0 (V: README lines 425, 484, 503, 548). `parcelId` is **not** used as the MVT feature id: `--use-attribute-for-id` needs a numeric value (V: README:425), and ids such as `0026T001A` are not numeric. map-view promotes it instead (`promoteId: {buildings: 'parcelId'}`). `-P` is omitted so the read order stays fixed. Tile bytes are not required to be deterministic; feature attributes are.

**`basemap.pmtiles`**: the Protomaps extract described in §4.1, at z0–15.

**`fonts/<fontstack>/<range>.pbf`**: copied from basemaps-assets at the pinned commit (stacks `Noto Sans Regular`, `Noto Sans Medium`, `Noto Sans Italic`). Stack names contain spaces; see IC-4.

**`neighborhoods.geojson`**: `j2bu-swwd` simplified with `ST_SimplifyPreserveTopology` at 3 m in 7131, coordinates rounded to 6 decimals, properties `{ "name": nhood }`, features sorted by name. Budget ≤ 150 KB.

**`manifest.json`** (I12):
- `builtAt` is ISO-8601 UTC. It is the only field that is not deterministic.
- `sources[]` lists one entry per lock source. In addition, Overture is expanded into one entry per contributing `sources[].dataset` found in the SF extract: `overture:OpenStreetMap`, `overture:USGS Lidar`, `overture:Microsoft ML Buildings` and `overture:Esri Community Maps`, observed counts 176,325 / 12,942 / 9,638 / 52 (V). The platform attribution page can therefore render the obligations from data.
- `license` uses SPDX ids where they exist: `PDDL-1.0`, `ODbL-1.0`, `CC-BY-4.0`, `OFL-1.1`; otherwise `public-domain`.

**`report.json`**: all counts and percentages from §4.4–4.7 and §4.9, per-step timings and tool versions. It is public, which serves *Honesty of numbers*.

### 4.9 Invariants (`check`; any failure → exit 1, nothing uploaded)

| # | invariant | 2026-10-10 expectation |
|---|---|---|
| V1 | \|Σ existingUnits − 413,208\| ≤ 2%. 413,208 is SF's housing stock at end-2022 (2023 Housing Inventory, Table 1 and its "CHANGE FROM 2022 {413,208}" callout). End-2023 is 415,803 (V: sfplanning.org 2023_Housing_Inventory.pdf). End-2022 is the right comparator because LUDB 2023 is a March-2023 snapshot (V: dataset description). Both figures go in the report. | 411,531 direct + ≤ 1,709 reassigned → −0.4% to 0.0% |
| V2 | parcels emitted = distinct active non-null `mapblklot` in the source, and lies in [140k, 170k] | 155,020 |
| V3 | land-use match ≥ 99.0% of parcels | 99.46% |
| V4 | `landuse` values ⊆ the 12 known values (§4.5) | ✓ |
| V5 | height coverage (`hs ≠ 3`) ≥ 95% of buildings | ≥ 92.7% before fill |
| V6 | ≥ 95% of building piece area carries a `parcelId` | (I) |
| V7 | every parcel has a neighborhood in the 41-name set; the label point is strictly inside its polygon for ≥ 99.99% of parcels | |
| V8 | each parcel appears in exactly one chunk; Σ `parcelCount` = V2; `cellId` is unique; chunks round-trip through `decodeParcelChunk` | |
| V9 | per chunk: ≤ 6,000 parcels, ≤ 1.5 MB raw, ≤ 350 KB gzip-9 | |
| V10 | `max(existingHeightM)` lies in [300, 340] (Salesforce Tower 326 m present) | 326 |
| V11 | first-paint budget: z12 `buildings.pmtiles` tiles covering the SF bbox Σ ≤ 2.0 MB; z12 basemap tiles Σ ≤ 1.2 MB; manifest ≤ 64 KB; neighborhoods ≤ 150 KB | (I) |
| V12 | determinism: re-encoding the chunks from the SQL output is byte-identical (in-run); the fixture build is byte-identical across two runs (CI) | |
| V13 | a published version is never altered: `upload` aborts if `data/<v>/manifest.json` already exists in R2 | |

### 4.10 Upload

The bucket is `sfhousing`, shared by staging and prod (platform §4.2). `upload` runs these steps:
1. `wrangler r2 object get sfhousing/data/<v>/manifest.json --remote` must fail with "not found". Otherwise it aborts with `version <v> already published` (V13). Wrangler has no list or head command (V: developers.cloudflare.com/workers/wrangler/commands/r2).
2. It puts each `sources/<sha256>` archive object that is missing.
3. It puts every artifact with `wrangler r2 object put sfhousing/data/<v>/<path> --file … --content-type … --cache-control "public, max-age=31536000, immutable" --remote` (V: same page), running 8 concurrently. Retries are 3 per object, with backoff.
4. It puts `manifest.json` **last**.
5. It prints `"PUBLIC_DATASET_VERSION": "<v>"` and the `verify` command. The human edits `wrangler.jsonc`: staging first, then prod via release (platform §4.3).

If upload is interrupted, the version has no manifest and is invisible to clients. Re-running `upload <v>` re-puts everything; this is safe because no client has learned `<v>` yet. `--local` targets Miniflare R2 for dev and e2e. Old versions are **never deleted** in M1, so plans from older datasets keep loading.

### 4.11 Run time (cold → warm)

- `fetch`: DataSF about 5–10 min (≈ 400 MB GeoJSON over 4 sources) (I). Overture 15 s (V). Basemap extract 1–3 min (I).
- `build`: DuckDB joins, IoU and clipping 2–5 min; tippecanoe 1–3 min; chunks under 1 min (I).
- `upload`: about 150 chunks + about 770 font files + 4 large files at 8-way concurrency, 3–6 min (I).

Totals: cold end-to-end ≈ **15–25 min**; a warm rebuild ≈ **5–8 min**. Actual timings go into `report.json`.

### 4.12 Attribution obligations (ODbL)

- `buildings.pmtiles`, `basemap.pmtiles` and the **parcel chunks** are Derivative Databases of ODbL data. Chunk `existingHeightM` and the fallback floor area are derived from Overture heights. Publishing them at public URLs is public use, so they are offered under **ODbL-1.0** (ODbL §4.4 share-alike) (I: reading of ODbL). The manifest `sources` licences and `report.json` state this. platform's data page must say "Derived data © OpenStreetMap contributors, Overture Maps Foundation, available under ODbL".
- **Produced Work** (the rendered map) must carry visible attribution: "© OpenStreetMap contributors", "Overture Maps Foundation", plus the contributors present in the extract: "USGS 3D Elevation Program", "Microsoft Global ML Building Footprints (ODbL)" and "Esri Community Maps contributors (CC BY 4.0)" (V: docs.overturemaps.org/attribution). Protomaps recommends "Protomaps © OpenStreetMap" (map-view §, V).
- DataSF sources are PDDL, CC0 or public domain. Credit is courtesy, not obligation.

## 5. Seams

- **M2 `area-select`:** `neighborhoods.geojson` and per-parcel `neighborhood` already ship. Corridors and transit buffers would be new sources. Nothing more is done now.
- **M2 `buildout-likelihood` / `consequences`:** these will need new per-parcel columns, such as year built or rent-control exposure. The chunk format ignores unknown keys, so they can be added as columns in `sfh-parcels/1` without bumping the format. Nothing is added now.
- **M3 `scenario-loader`:** `h9wh-cg3m` and zoning become new `sources/` adapters under the same lock and versioning. `zoning_code` is in the parcels source but is **not** emitted.
- **M5 `pipeline-overlay`:** Development Pipeline rows key on `blklot`, which may be a condo sub-lot (I). The normalised parcels parquet keeps `blklot → mapblklot` for every active row, so M5 can resolve it. M1 does not publish that map.
- **Land Use successor `c5ge-t6pj`:** it is a source swap behind `datasf-landuse` that produces a new `datasetVersion` (OQ-1).

## 6. Testing

Fixture `pipeline/test/fixtures/mini/` holds hand-made GeoJSON for every source plus a lock. Its 14 parcels near the Mission cover:
- a condo map lot with 3 sub-lots;
- `8711023C`-style and `0026T001A`-style ids;
- a two-part parcel and a holed parcel;
- an `OPENSPACE` lot, a null-`landuse` lot with units, and a no-row lot;
- an orphan land-use row on a retired lot, once reassignable and once colliding;
- a building spanning two lots;
- buildings needing each height rule 0–3;
- a building on a pier outside all parcels;
- an `is_underground` building.

Server project (Vitest, Node):
1. `parcel-chunk.test.ts`: encode/decode round-trip on `grid-20x20` (the plan-model fixture). A property test (fast-check) on random polygons and ids checks `decode(encode(r))` equals `r`, with coordinates quantised to cm and `areaM2` within 0.01. Malformed inputs (length mismatch, unknown `format`) throw `ChunkFormatError`. Unknown keys are ignored.
2. `manifest.test.ts`: `parseManifest` accepts the golden and rejects a missing field, a bad `datasetVersion` or a non-relative `url`.
3. `sql.test.ts`, one test per rule against the mini fixture:
   - condo dedupe;
   - eligibility table;
   - orphan reassignment and collision;
   - height rules 0–3 with the expected `hs`;
   - clipping (the spanning building gives 2 pieces with the right `parcelId`s, and the pier has no `parcelId`);
   - label point inside;
   - multipart ring order;
   - floor-area fallback rules 1–4.
4. `golden.test.ts`: `pipeline fixture` output (chunks, manifest without `builtAt`, neighborhoods, report counts) is byte-equal to `test/fixtures/mini/golden/`. Building twice gives identical bytes (V12).
5. `invariants.test.ts`: each of V1–V13 fails on a mutated fixture (for example, an injected unknown `landuse` fails V4).
6. `version.test.ts`: `datasetVersion` is stable for the same lock and code, changes when any sha changes, and matches `DATASET_VERSION_RE`.
7. `local-frame.test.ts`: chunk polygons inverted with typology-generator §4.10 match the source lng/lat to ≤ 0.05 m (proj4 is a dev dependency).
8. `tiles.test.ts`, tagged `tools`: on the fixture, the tile features carry `parcelId`/`heightM`/`baseM`/`hs` with the right types. It is skipped, with a message, when `tippecanoe` is absent.

CI: the `pipeline.yml` workflow runs on changes to `pipeline/**` or `src/lib/data/**`. It installs tippecanoe 2.79.0 and runs 1–8.

E2E seam (Playwright, local R2): `pipeline fixture` → `npm run data:fixture` → the test requests `/data/fixture-0001/manifest.json` and every chunk URL (200, `application/json`) and a `buildings.pmtiles` range (206). These requests are owned jointly with platform E-tests. The axe gate does not apply, since the pipeline adds no pages.

Manual acceptance run: `pipeline all` on live data, then `upload`, then `verify <v> --origin https://sfhousing-staging.mindlace.net`.

## 7. Acceptance criteria

1. `npm run pipeline -- doctor` passes on a fresh macOS machine after `brew install tippecanoe pmtiles`.
2. `pipeline all` on live sources completes with every V1–V13 passing and writes `out/<v>/` containing a manifest that `parseManifest` accepts.
3. Σ existingUnits is reported, and is within ±2% of 413,208.
4. Every eligible/ineligible outcome follows §4.5's table exactly. There are 2 ineligible classes, and an unknown `landuse` fails the build.
5. A second `build` from the same lock yields the same `datasetVersion` and byte-identical chunks, manifest (except `builtAt`) and neighborhoods.
6. `upload` refuses an already published version. After upload, `verify` against staging succeeds: every manifest URL returns 200 and both PMTiles answer a range with 206.
7. `fetch --restore` on a clean checkout reproduces `.cache` from R2 alone, after the Overture release has expired upstream.
8. The fixture dataset in `e2e/fixtures/data/fixture-0001/` is generated by `pipeline fixture` and decodes with `decodeParcelChunk`.
9. `report.json` lists counts for: dropped null ids, condo sub-lots, orphan land-use rows (reassigned and dropped), no-row parcels, each height-rule source, each floor-area rule, multipart and holed parcels, and dropped slivers.
10. Manifest `sources` include each Overture contributing dataset with its licence.

## 8. Open questions

- **OQ-1 Land Use source.** `fdfd-xptc` is archived (March-2023 vintage). `c5ge-t6pj` is current (2026-08) but lacks the `landuse` class and residential square footage. **Recommend:** use `fdfd-xptc` in M1. Revisit at M2 with a mapping from `c5ge-t6pj` (`open_space` → ineligible; floor area from `total_comm` plus the building-derived estimate) and its multi-parcel rows. The orchestrator should note in the design's data-sources table that the dataset is archived.
- **OQ-2 Default height for unknown buildings** (`hs=3`, 7.0 m). **Recommend:** keep it, and render `hs=3` identically. Honesty is served by `report.json`, not by the map.
- **OQ-3 Sprites.** map-view lists only fonts. If its flavour needs sprites, the pipeline will copy `basemaps-assets/sprites/v4/<flavour>*` at the same commit. **Recommend:** map-view confirms whether it needs them; the cost here is trivial.

## 9. Interface concerns (for the orchestrator)

- **IC-1 I12 lacks basemap and fonts.** This spec publishes `/data/<v>/basemap.pmtiles` and `/data/<v>/fonts/<stack>/<range>.pbf` at fixed paths, matching map-view's assumption. **Recommend:** add `basemap` and `glyphs` to I12. They are additive, and I12's text is unchanged here.
- **IC-2 Building-tile contract has no I-row.** The fields are source-layer `buildings` and properties `parcelId?: string`, `heightM`, `baseM` and `hs`, at minzoom 12 and maxzoom 15. Pieces are clipped per parcel (§4.7). map-view's IC-2 asks for the same contract. **Recommend:** a new I-row.
- **IC-3 I12 `url` semantics** are unstated. This spec emits root-relative URLs. brush-tool resolves "relative to the manifest URL", and both work. **Recommend:** state "root-relative" in I12.
- **IC-4 Font stack names contain spaces** (`Noto Sans Regular`, V: repo listing). platform's segment regex `^[A-Za-z0-9._-]+$` would return 404 for `/data/<v>/fonts/Noto%20Sans%20Regular/0-255.pbf`. **Recommend:** platform allows a space (decoded `%20`) within `fonts/` segments. The alternative is for the pipeline to slugify the directory names and for map-view to use slugged `text-font` names.
- **IC-5 Licence of derived artifacts.** Parcel chunks become ODbL (§4.12), but the design's constraint text implies that only the basemap and Overture are ODbL. **Recommend:** the attribution page states that derived datasets are ODbL.
- **IC-6 I12 consumers** should add brush-tool (the worker host) and plan-model (`opBBox` vs `chunks[].bbox`), as plan-model IC-2 and brush-tool IC-6 also note.
- **IC-7 Data sources table:** the DataSF host is now `data.sf.gov`; `fdfd-xptc` is archived; Analysis Neighborhoods is `j2bu-swwd` (V).
