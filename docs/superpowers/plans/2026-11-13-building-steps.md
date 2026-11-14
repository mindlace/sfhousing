# Building Steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task (never superpowers:executing-plans). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Existing buildings render from z14 as a few boxes per building (base, false-front strips, steps) derived from footprint-registered 2023 LiDAR, and from OSM building parts where they exist, while every model input stays byte-identical.

**Architecture:** Three stages, each with its own inputs:
1. **LiDAR fetch.** A fetch-time Python tool (uv-pinned, laspy) turns the USGS EPT cloud into 500 m raster tiles (height above ground, ground, vegetation). The tiles are locked in their own `pipeline/lidar.lock.json` and archived to R2.
2. **`npm run pipeline -- boxes`.** A separate TypeScript command, run only when boxes must change. It reads the tiles, the locked Overture buildings and parts, and the parcels and streets it needs. It registers footprint clusters to the LiDAR, derives per-building boxes and roof records, and writes a compact parquet artifact `building-boxes`. The artifact is locked in `sources.lock.json` like any source, together with the hashes of the inputs and code it came from.
3. **`build`.** Build never touches LiDAR. When the lock has the artifact, build composes the render-only table `render_boxes` (never `pieces`), clips it to parcels with a 50_clip-style SQL file, and the tiles step writes the boxes at z14–15 beside today's single boxes at z12–13 in the same `buildings` layer. Without the artifact, build output is today's.

**Tech Stack:** TypeScript (tsx, Vitest pipeline project), DuckDB spatial, clipper2-ts 2.0.1 (already a dependency), tippecanoe 2.79.0, pmtiles 1.31.2, Python 3.14 under uv (numpy 2.5.4, scipy 1.18.1, laspy 2.7.0, lazrs 0.8.2, pyproj 3.8.0, pytest) for the LiDAR fetch only, Playwright for the review script.

**Spec:** `docs/superpowers/specs/2026-11-13-building-steps-design.md`. Spike records: `docs/superpowers/design/2026-11-13-offset-spike/` (`scripts/ept.py`, `fitlib.py`, `rowhouse.py`, `models.json`). Port what is reused into `pipeline/`; never import from `docs/`.

## Global Constraints

- Model inputs never move: `30_buildings`, `40_heights`, `50_clip`, `55_road_lots`, `60_attributes`, `70_export`, `81_scenario_features` and `SQL_FILES` (`pipeline/lib/sql.ts:7-18`) are unchanged; `pieces`, `parcel_out`, the chunks, `parcels.bin`, `policy.bin`, `gross.bin`, `projects.json` and `calibration.json` stay byte-identical. Boxes live in a render-only table beside `pieces`.
- `build` never reads the LiDAR tiles, never needs Python and never derives boxes. It consumes only the locked `building-boxes` artifact. A lock without the artifact builds today's single boxes: `buildings.pmtiles` and its tippecanoe input are byte-identical to main's.
- The LiDAR tiles are listed only in `pipeline/lidar.lock.json`, never in `sources.lock.json`. So `fetch --restore` and `build` never download or verify them. Only `fetch --restore --lidar` and `boxes` need them.
- `build` fails loudly when the artifact's recorded `overture-buildings` or `overture-building-parts` hash differs from the current lock (stale boxes would sit on the wrong footprints). The message names `npm run pipeline -- boxes`.
- Footprints and parcels never move. Registration shifts only where the LiDAR is sampled.
- No LiDAR-derived box pokes outside its building footprint. Only `part` boxes may (parts are curated; Sutro's legs).
- One MapLibre `fill-extrusion` layer (`existing-buildings`), source-layer `buildings`, `promoteId: { buildings: 'parcelId' }`, unchanged in `src/lib/map/style.ts:217-243`. z12–13 carry today's single boxes with today's four properties only (`parcelId`, `heightM`, `baseM`, `hs`), so `z12BuildingsMax` (`pipeline/config.ts:177`, 2.0e6 B) holds; z14+ carry the new boxes with `src`, `groundM`, `groundMinM` added.
- `src` values are exactly `box` (fallback single box), `base`, `front`, `step`, `part`. Per-building roof record: `roof` ∈ `flat` | `pitched` | `unknown`, `eaveM`, `ridgeM`, `ridgeDeg`, the registration shift and its confidence; `groundM` (median ground under the footprint) and `groundMinM` (lowest), NAVD88 metres.
- Spec starting thresholds, named in `BOXES` (`pipeline/boxes-config.ts`): margin 0.3 m; false-front band to 2 m in, rise 1 m, strip depth 0.5 m; step min area 20 m², step gap 2.5 m, cap 4 per building; registration search ±3 m at 0.1 m, cluster touch tolerance 1.5 m; landmark roof tiers 5 (spec 4–6). OSM frames (0.0, +0.24) m and (+1.24, −0.32) m.
- LiDAR: USGS 3DEP `CA_SanFrancisco_1_B23`, EPT `https://s3-us-west-2.amazonaws.com/usgs-lidar-public/CA_SanFrancisco_1_B23/ept.json`, points converted to EPSG:7131 (NAD83(2011) / SF CS13, NAVD88 Geoid18 heights). Licence `public-domain`. Overture `building_part`: licence `ODbL-1.0`, same release as `overture-buildings`.
- `npm run bench:map` p95 ≤ 16.7 ms (`docs/dev/map-perf.md` Pass bar).
- This changes the dataset version: finish per `docs/dev/pipeline.md` "Finishing a branch that changes the dataset".
- Repo rules: Conventional Commits; no Claude attribution anywhere; never `cd X && cmd`; 2-space indent, single quotes, no trailing commas, 100 columns; Vitest `expect.requireAssertions` (every test calls `expect`); the pipeline never imports `$lib`; imports on the Vite version chain need `.js` extensions (do not import `boxes-config.ts` from `pipeline/config.ts`).

## Review Focus

1. **Inputs out of step.** Two cases: Overture refreshed without re-running `boxes`, or parts from another Overture release than the footprints. Either way the boxes or parts would silently land on the wrong footprints or miss their buildings. Expect `build` to stop with a message that names the fix (`npm run pipeline -- boxes`, or refetching both with `--release`). Tests in Task 4 (releases) and Task 10 (stale artifact).
2. **A building or cluster that straddles two raster tiles**: its window must read as one seamless raster, not a nodata seam that triggers a fallback or a fake edge. Test in Task 5.
3. **A dense z14 tile over tippecanoe's 400 KB limit**: `--drop-smallest-as-needed` silently deletes small buildings downtown. Expect the drop to be detected and V37 to fail. Test in Task 11.
4. **Unusual footprints: holed (courtyard), MultiPolygon, elevated (`base_m` > 0, skybridges and canopies)**: boxes stay inside the footprint, holes stay open, and an elevated building keeps its single box. Test in Task 7.
5. **A rebuilt parcel at z16 with several boxes**: the `replaced` feature-state must hide every one of them (base, front, step, part), not just one. Tested by the shared-`parcelId` assertion in Task 11 and by the existing `e2e/map.spec.ts` replaced checks at z16–17, which Task 11 re-runs.

## Decisions (builder's calls made here)

- **LiDAR tooling: Python under uv, fetch time only.** The spike's working reader is laspy + lazrs + pyproj (`scripts/ept.py`), not PDAL, and PDAL is not installed; uv pins Python and wheels in one `uv.lock` with one install (`brew install uv`). Build, fixture and `test:pipeline` never need Python.
- **Two derived artifacts.**
  - **LiDAR raster tiles (`usgs-lidar-sf`), in `pipeline/lidar.lock.json`.** Format `sfhl/1`: 500 m tiles in EPSG:7131, height above ground (Int16 cm, 0.25 m), ground (Int16 cm, 1 m), vegetation (one bit per 0.25 m cell). 0.25 m is the resolution the spike's edge fit was validated on. The tiles do not depend on footprints or thresholds, so a tuning round never refetches LiDAR. A separate lock keeps the 1–3 GB of tiles out of every `fetch --restore` and `build`. `upload` archives the tiles; `fetch --restore --lidar` restores them.
  - **The `building-boxes` artifact, in `sources.lock.json`.** Three files: `boxes.parquet` (LiDAR and part boxes, WKB in EPSG:7131; a full-footprint base box stores no geometry), `roofs.parquet` (one roof record per building) and `inputs.json`. Each recorded input is a full sha256 hash. The lock entry's `upstreamVersion` carries 12-hex prefixes of the same hashes, so the stale check needs only the lock, not the raw cache.
- **Derivation in TypeScript, in the `boxes` command.** Registration, roof, false-front and step derivation run on clipper2-ts and plain typed arrays, so they are tested in Vitest on synthetic rasters. Build only composes, clips and tiles. The codebase is TS + DuckDB.
- **Recorded inputs and what they gate.** The artifact records:
  - `overture-buildings` and `overture-building-parts`, which gate: a mismatch is a `BuildError`;
  - `usgs-lidar-sf` (from the LiDAR lock), `datasf-parcels`, `datasf-streets` and `datasf-neighborhoods`, which only warn: they move clustering, fronts or the kept set, never the footprints a box sits on;
  - the BOXES config hash (`sha256(canonicalJson(BOXES))`) and the boxes code hash, which also only warn, on live builds.
  A fixture build skips the code and config warnings so the golden `report.json` stays stable. A test that re-derives the mini artifact catches drift there instead.
- **Boxes code stays under `pipeline/`, inside the dataset-version hash.** Its own hash, `boxesCodeHash` over `BOXES_CODE_PATHS`, is recorded in the artifact as well. The rule "everything under `pipeline/` is hashed" needs no exclusion list. A misfiled exclusion could let code that `build` reads change without a version change, and `upload` would then refuse the rebuilt version (V13) while staging served the old bytes. The cost: a boxes-only code edit needs a dataset upload. That is already the convention for any pipeline edit, and in the tuning loop such an edit comes with a new artifact anyway. `pipeline/lidar.lock.json` is hashed for the same reason; it changes about once.
- **The stale-artifact check lives in `build` and `doctor`, not `version`.** `doctor` gets a required `boxes-lock` check, so a machine sees the problem before a long build. `version` (`scripts/dataset-version.ts`) stays a light hash printer for CI and chreode. A tree with a stale artifact cannot build, so it can never publish, and signoff's `dataset` step already fails for it.
- **`usgs-lidar-sf` is not in the default `fetch` list.** A 2023 flight never changes and fetching takes hours. Only `fetch --only usgs-lidar-sf` fetches it, writing `pipeline/lidar.lock.json`.
- **Optional sources.** A lock without `building-boxes` builds today's boxes. A lock without `overture-building-parts` gives an empty `src_overture_parts`. The same pattern as `datasf-streets` (`pipeline/sources/normalise.ts:49-56`). `boxes` without a LiDAR lock still runs: every building falls back (`no_lidar`), and only parts get boxes.
- **Cluster "split at streets" = same assessor block.** Two footprints join when they lie within 1.5 m of each other and their main parcels share a block (`SQL_BLOCK_OF`, `pipeline/lib/road-lots.ts:62`). Assessor blocks are bounded by streets, and the data is already in `pieces`.
- **Street-facing faces from `src_streets`.** A face is street-facing when a public centreline (the R2s layer exclusions in `docs/dev/pipeline.md` Road-like lots) lies within 30 m along its outward side (cosine ≥ 0.7). The lock already has `datasf-streets`.
- **Main roof = lowest roof level covering ≥ 25% of the interior** (see Spec ambiguities). False-front rise and step gap are measured against the base box's rendered top.
- **Fronts and steps start at the base box's top**, so their walls never coincide with the base box's walls below the roof (no z-fighting on facades).
- **Render clip minimum piece 0.25 m²** (`render_min_piece_m2`), not 50_clip's 2 m², which would drop 0.5 m-deep false-front strips on short faces.
- **Trees:** LiDAR vegetation classes 3–5 when present, plus the spike's multi-return share (> 0.35 of first returns from multi-return pulses, HAG > 1 m), plus a roughness filter in the step search. No street-tree source: it adds a source, and phantom steps are judged in review.
- **DataSF footprint cross-check: not built.** Revisit only if a review round shows a high fallback share.
- **No style change by `src`** (YAGNI; the spec makes it optional).
- **No `/attribution` change.** The page already credits OpenStreetMap under ODbL and Overture (`src/routes/attribution/+page.svelte:55-63`), which covers OSM-derived parts. It lists every manifest source (`:33-46`), so `overture-building-parts` and `building-boxes` (labelled `Building boxes (USGS 3DEP LiDAR 2023 and Overture)`, licence `ODbL-1.0` because it derives from Overture) appear without code. That label is where the USGS credit shows.
- **Fallback buildings carry no geometry in the artifact.** `build` draws their single box from its own `buildings` table (`height_m` from `40_heights.sql`). The artifact therefore does not depend on DataSF heights, and missing or extra bids are harmless.

## Spec ambiguities resolved here

- "Main roof" for the false-front comparison is the base box's rendered top (mid-roof on a pitched roof). Comparing with the ridge would miss most Victorian fronts.
- "Dominant roof level" is read as the lowest level that covers ≥ 25% of the interior. Taking the largest level would turn a tower that covers 60% of its podium into today's full-footprint prism.
- "Flagged unreliable": interior LiDAR coverage below 50%, an interior under 4 m² after the margin, or a cluster whose registration found no positive score anywhere (`source: 'none'`).
- An elevated building (`base_m` > 0) keeps today's single box: the LiDAR under it is street.
- Footprint area that no counted part covers and that has no usable LiDAR is dropped and counted (`boxes.parts.uncovered_dropped`). It never becomes a `height_m` box.
- A tiered roof shape (`pyramidal`, `dome`, `cone`, `onion`) with a null `roof_height` renders flat at `height`.
- The spec says the spike used "PDAL via Python". The spike's code uses laspy + lazrs + pyproj, and this plan does too.

## Open questions

None.

## File Structure

| Path | Responsibility |
| --- | --- |
| `pipeline/boxes-config.ts` (new) | `BOXES` thresholds and raster parameters |
| `pipeline/lib/lidar/tile.ts` (new) | `sfhl/1` tile codec, tile grid, tile file names |
| `pipeline/lib/lidar/python.ts` (new) | `uvRun` helper: pinned project, venv under `.cache`, no bytecode |
| `pipeline/lidar-raster/` (new uv project) | `pyproject.toml`, `uv.lock`, `sfh_lidar/{ept,rasterize}.py`, `tests/test_rasterize.py` |
| `pipeline/sources/lidar.ts` (new) | `fetchLidar`: runs the rasterizer, encodes tiles, returns the LiDAR lock entry; `lidarTilesOf` |
| `pipeline/lidar.lock.json` (new, committed) | the LiDAR tiles' lock, apart from `sources.lock.json` |
| `pipeline/sources/overture.ts` | `fetchOvertureParts`, `overtureReleaseProblem` |
| `pipeline/sources/normalise.ts` | `overture-building-parts` → `src_overture_parts` (optional) |
| `pipeline/steps/fetch.ts`, `pipeline/cli.ts` | new ids and flags, default list without LiDAR, `--restore --lidar`, the `boxes` command |
| `pipeline/steps/upload.ts` | also archives the LiDAR lock's tiles |
| `pipeline/steps/doctor.ts` | optional `uv` and `lidar-python` checks; required `boxes-lock` check |
| `pipeline/lib/version.ts` | `treeHash` refactor, `BOXES_CODE_PATHS`, `boxesCodeHash` |
| `pipeline/lib/lidar/mosaic.ts` (new) | lazy tile cache; `window(bbox)` → `RasterWindow` |
| `pipeline/lib/lidar/raster.ts` (new) | cell mask, bilinear, gaussian, gradient, 4-connected labels |
| `pipeline/lib/lidar/geom.ts` (new) | clipper2-ts wrappers: inset, union, intersect, difference, area, cell runs → polygons |
| `pipeline/lib/lidar/clusters.ts` (new) | registration clusters (SQL pairs + `UnionFind`) |
| `pipeline/lib/lidar/register.ts` (new) | edge-gradient score grid, peak analysis, fallback |
| `pipeline/lib/lidar/streets.ts` (new) | `StreetIndex` for street-facing faces |
| `pipeline/lib/lidar/derive.ts` (new) | per-building ground reference, roof form, fronts, steps, fallbacks |
| `pipeline/lib/lidar/parts.ts` (new) | counted parts, part boxes, roof tiers, uncovered area |
| `pipeline/lib/lidar/artifact.ts` (new) | `building-boxes` lock entry: recorded inputs, `boxesLockProblem`, stale warnings, parquet write/load, counts |
| `pipeline/steps/boxes.ts` (new) | the `boxes` command: derivation (`bx_boxes`, `bx_roofs`) and writing and locking the artifact |
| `pipeline/steps/render-boxes.ts` (new) | build step: load the artifact, compose `render_boxes`, clip, counts, derived files |
| `pipeline/sql/76_render_boxes.sql` (new, not in `SQL_FILES`) | compose `render_boxes` with today's box for fallbacks; clip to parcels → `render_pieces`, `render_export` |
| `pipeline/steps/build.ts`, `tiles.ts`, `check.ts` | stale check, wire the step, zoom split, V37 |
| `pipeline/test/lidar-synth.ts` (new) | synthetic scenes → `LidarTile` / `RasterWindow` for tests and the mini fixture |
| `pipeline/test/fixtures/mini/make-fixture.ts`, `README.md`, `lidar.lock.json` | parts, synthetic LiDAR tiles, the mini LiDAR lock; the mini `building-boxes` artifact comes from `boxes --fixture` |
| `scripts/building-review.ts` (+ `.spec.ts`) (new) | before/after street-level captures and stats page |
| `docs/dev/building-boxes.md` (new), `docs/dev/pipeline.md`, `CLAUDE.md`, `docs/dev/map-perf.md` | docs |

Shared types (defined in the task named, used by later tasks):

```ts
// pipeline/lib/lidar/geom.ts (Task 5)
export type Ring = [number, number][]; // EPSG:7131 metres, closed implicitly
export type Poly = Ring[]; // outer ring first, then holes
export type MultiPoly = Poly[];
export interface Bbox7131 { x0: number; y0: number; x1: number; y1: number }
```

---

### Task 0: Record the base dataset version

- [ ] **Step 1:** Run `npm run pipeline -- version` in the worktree before any pipeline change and note the printed `<v>` in the PR draft notes as `base`. It is main's version, used as a fallback "before" if staging is unreachable in Task 14. No commit.

### Task 1: `BOXES` config, the `sfhl/1` tile codec, synthetic scenes

**Files:**
- Create: `pipeline/boxes-config.ts`, `pipeline/lib/lidar/tile.ts`, `pipeline/test/lidar-synth.ts`
- Test: `pipeline/test/lidar-tile.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // boxes-config.ts: every threshold, with a tier/source comment as config.ts does
  export const BOXES = {
    rasterResM: 0.25, groundResM: 1, tileSizeM: 500, tilePadM: 20, vegFracMin: 0.35,
    regSearchM: 3, regStepM: 0.1, regTouchM: 1.5, regSampleStepM: 0.2, regMaxSamples: 2000,
    regAmbiguousRatio: 0.85, regSecondPeakM: 1.0,
    regFrames: { 'frame-nad83': [0.0, 0.24], 'frame-wgs84': [1.24, -0.32] },
    marginM: 0.3, frontBandM: 2.0, frontRiseM: 1.0, frontDepthM: 0.5, frontPct: 0.9,
    frontMinFaceM: 3, frontFaceAngleDeg: 15, frontStreetM: 30, frontFacingCos: 0.7,
    stepMinAreaM2: 20, stepGapM: 2.5, stepCap: 4, treeRoughM: 1.0,
    roofBinM: 0.5, roofMainShareMin: 0.25, raisedHagM: 1.5,
    pitchMinRiseM: 1.0, pitchMinSlope: 0.18, pitchMinR2: 0.6,
    groundShareMin: 0.8, coverageMin: 0.5, minInteriorM2: 4,
    partTiers: 5, partTierShapes: ['pyramidal', 'dome', 'cone', 'onion'],
    splitZoom: 14, heightRangeM: [2.5, 340]
  } as const;
  // tile.ts
  export const LIDAR_NODATA = -32768;
  export interface LidarTile {
    tx: number; ty: number; sizeM: number; res: number; groundRes: number;
    hagCm: Int16Array; // (sizeM/res)², row 0 = south edge, LIDAR_NODATA = no data
    groundCm: Int16Array; // (sizeM/groundRes)², NAVD88 cm
    veg: Uint8Array; // one byte per hag cell, 0 | 1 (packed to bits on disk)
  }
  export function tileIndexOf(x: number, y: number, sizeM?: number): [number, number]; // floor(x/sizeM)
  export function tilesForBbox(b: Bbox7131, sizeM?: number): [number, number][]; // sorted tx, then ty
  export function lidarTileName(tx: number, ty: number): string; // `usgs-lidar-sf/${tx}_${ty}.sfhl`
  export function parseLidarTileName(name: string): [number, number] | null;
  export function encodeLidarTile(t: LidarTile): Uint8Array;
  export function decodeLidarTile(b: Uint8Array): LidarTile;
  // lidar-synth.ts (test helper, also used by make-fixture.ts)
  export interface SynthScene {
    ground: (x: number, y: number) => number; // NAVD88 m
    boxes: { ring: Ring; top: number | ((x: number, y: number) => number) }[]; // above local ground
    veg?: { ring: Ring; top: number }[];
    nodata?: Ring[];
    shift?: [number, number]; // the LiDAR sits at footprint + shift
  }
  export function synthTile(tx: number, ty: number, scene: SynthScene): LidarTile;
  ```
  `Ring` and `Bbox7131` come from `geom.ts` (Task 5). Create `geom.ts` with just those type exports now; Task 5 adds its functions.

On-disk layout: `SFHL` magic, u8 version 1, u32-LE header length, UTF-8 JSON header `{tx, ty, sizeM, res, groundRes, crs: 'EPSG:7131'}`, then three sections, each a u32-LE length plus `deflateRawSync` bytes: `hagCm` Int16LE, `groundCm` Int16LE, `veg` bit-packed (LSB first). Encoding is deterministic (fixed zlib level 9).

- [ ] **Step 1: Write the failing tests** in `pipeline/test/lidar-tile.test.ts`:
  - `round-trips a tile byte for byte`: `encodeLidarTile(decodeLidarTile(encodeLidarTile(t)))` equals the first encoding; decoded arrays equal the input arrays.
  - `rejects a bad magic, version 2 and a truncated section` (three `toThrow(/sfhl/)` cases).
  - `tileIndexOf floors negatives`: `tileIndexOf(-0.01, 499.99)` → `[-1, 0]`; `tilesForBbox({x0: 499, y0: 0, x1: 1001, y1: 10})` → `[[0,0],[1,0],[2,0]]`.
  - `names round-trip`: `parseLidarTileName(lidarTileName(-3, 12))` → `[-3, 12]`; `parseLidarTileName('x.sfhl')` → `null`.
  - `synthTile draws a 10 m box on 20 m ground`: cells inside the ring read `hagCm` 1000 and `groundCm` 2000; outside, `hagCm` 0; `veg` is 1 only inside `veg` rings; `nodata` rings read `LIDAR_NODATA`.
- [ ] **Step 2:** Run `npx vitest --run --project pipeline pipeline/test/lidar-tile.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `boxes-config.ts`, `tile.ts` and `lidar-synth.ts` with the signatures above (`node:zlib` `deflateRawSync`/`inflateRawSync`).
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pipeline): add the sfhl tile codec and box thresholds`.

### Task 2: The LiDAR rasterizer (Python, uv) and its doctor checks

**Files:**
- Create: `pipeline/lidar-raster/pyproject.toml`, `pipeline/lidar-raster/uv.lock`, `pipeline/lidar-raster/sfh_lidar/__init__.py`, `ept.py`, `rasterize.py`, `pipeline/lidar-raster/tests/test_rasterize.py`, `pipeline/lib/lidar/python.ts`, `pipeline/test/lidar-python.test.ts`
- Modify: `pipeline/steps/doctor.ts:87-102` (append two checks), `pipeline/test/doctor.test.ts`, `.gitignore` (`pipeline/lidar-raster/**/__pycache__/`, `pipeline/lidar-raster/.pytest_cache/`)

**Interfaces:**
- Produces:
  ```ts
  // python.ts
  export const LIDAR_PROJECT: string; // <repo>/pipeline/lidar-raster
  export const LIDAR_VENV: string; // <repo>/pipeline/.cache/lidar-venv (excluded from the code hash, version.ts:55-57)
  /** `uv run --project LIDAR_PROJECT --frozen <args>` with UV_PROJECT_ENVIRONMENT=LIDAR_VENV, PYTHONDONTWRITEBYTECODE=1. */
  export function uvRun(args: string[], opts?: { cwd?: string }, deps?: { run: typeof run }): Promise<ExecResult>;
  ```
  Python CLI (consumed by Task 3):
  `python -m sfh_lidar.rasterize --out <dir> --tiles <tx_ty,...> --size 500 --res 0.25 --ground-res 1 --pad 20 --veg-frac 0.35 [--ept <url>] [--cache <dir>] [--las <file> ...] [--jobs 16] [--dry-run]`.
  For each tile with points it writes `<out>/<tx>_<ty>/{hag.i16, ground.i16, veg.u8, tile.json}`: raw little-endian arrays, row 0 south, `veg` one byte per cell. `tile.json` is `{tx, ty, sizeM, res, groundRes, nx, ny, gnx, gny, points}`. A tile without points writes only `tile.json` with `points: 0`. A finished tile directory is skipped on rerun, so the command resumes. `--dry-run` prints one line per tile, `tile tx_ty nodes <n> points <n>`, from the hierarchy only. `--las` replaces the EPT (tests).
- pyproject: `requires-python = ">=3.14,<3.15"`; dependencies pinned exactly: `numpy==2.5.4`, `scipy==1.18.1`, `laspy==2.7.0`, `lazrs==0.8.2`, `pyproj==3.8.0`; dev group `pytest` (pin the version `uv lock` resolves). Commit `uv.lock`.

Algorithm (ported from `scripts/ept.py` and `fitlib.hag_raster`): read the EPT nodes that intersect the tile plus `pad` (`ept.py` `nodes_for`, cache nodes under `--cache`). Transform EPSG:3857 → EPSG:7131 with `pyproj.Transformer.from_crs('EPSG:3857', 'EPSG:7131', always_xy=True)` and drop classes 7 and 18. DSM is the max Z per 0.25 m cell. Holes within 1 m of data take the nearest value; larger holes are nodata. DTM is the class-2 min per 1 m cell, linearly interpolated over the padded tile (nearest outside the hull). `hag = DSM − DTM(0.25 m)`; the ground array is the DTM at 1 m. `veg` is classes 3–5 if present, OR (the multi-return share of first returns in a 5×5 window > `veg-frac` AND hag > 1 m), then one binary opening. Crop the pad before writing. Values are cm, rounded half away from zero, clamped to ±32767.

- [ ] **Step 1: Write the failing pytest** `tests/test_rasterize.py`, using laspy to write a synthetic LAS into `tmp_path`, then `rasterize --las`:
  - `test_flat_roof_box`: ground points (class 2) at z 20.0 on a 0.25 m lattice over 60×60 m; a 10×10 m roof at z 30.0. Expect `hag` 1000 ± 5 cm inside the roof (0.5 m from its edges), `ground` 2000 ± 5 cm, `veg` 0.
  - `test_tree_flags_veg`: a 4 m disc of first-of-three returns at z 28 over bare ground. Expect `veg` 1 at the disc centre and 0 on the roof.
  - `test_nodata_beyond_one_metre`: a 5 m square with no points. Expect its centre to be `-32768`, and a cell 0.5 m inside its edge to be filled.
  - `test_crs_matches_duckdb`: `Transformer.from_crs('EPSG:4326','EPSG:7131',always_xy=True).transform(-122.4194, 37.7749)` is within 0.01 m of `(50695.887, 26764.161)`, the value DuckDB's `ST_Transform(..., 'EPSG:4326', 'EPSG:7131', always_xy := true)` gives. The 3857 path (4326→3857→7131) is within 0.01 m of the same point.
- [ ] **Step 2: Write the failing Vitest wrapper** `pipeline/test/lidar-python.test.ts`. `describe.skipIf(!hasUv)('lidar rasterizer [tools]')` runs `uvRun(['pytest', '-q', '-p', 'no:cacheprovider', 'tests'], { cwd: LIDAR_PROJECT })` and expects `code` 0; without uv it prints `[tools] uv not found: skipping lidar rasterizer tests`. Add a DuckDB twin of the CRS constant test (not skipped): `ST_Transform(ST_Point(-122.4194, 37.7749), …)` → x 50695.887 ± 0.01, y 26764.161 ± 0.01.
- [ ] **Step 3:** Add doctor tests in `pipeline/test/doctor.test.ts`: `uv` missing → check `{ name: 'uv', ok: false, optional: true, hint: 'brew install uv (only for fetch --only usgs-lidar-sf)' }`; `uv` present but the import probe exits 1 → `{ name: 'lidar-python', ok: false, optional: true }` with hint `uv sync --project pipeline/lidar-raster (needs network once)`; and a run where only optional checks fail → doctor exits 0 and prints them as warnings. Add `optional?: boolean` to the check type: build, fixture and `test:pipeline` never need Python, so a machine without `uv` must still pass doctor.
- [ ] **Step 4:** Run `npx vitest --run --project pipeline pipeline/test/lidar-python.test.ts pipeline/test/doctor.test.ts`. Expected: FAIL.
- [ ] **Step 5:** Implement `rasterize.py`, `ept.py` (port), `python.ts` and the two doctor checks. The `lidar-python` probe runs `uvRun(['python', '-c', 'import laspy, lazrs, numpy, scipy, pyproj'])`.
- [ ] **Step 6:** Run the step 4 command again. Expected: PASS, with the four pytest cases passing inside the wrapper. Run `npm run pipeline -- doctor`. Expected: every line OK, including `uv` and `lidar-python`.
- [ ] **Step 7:** Run `git status --porcelain pipeline/`. Expected: no `__pycache__`, `.pytest_cache` or `.venv` paths. They would change the code hash (`pipeline/lib/version.ts:96-110`).
- [ ] **Step 8: Commit** `feat(pipeline): add the uv-pinned LiDAR rasterizer`.

### Task 3: The `usgs-lidar-sf` source

**Files:**
- Create: `pipeline/sources/lidar.ts`, `pipeline/test/lidar-source.test.ts`
- Modify: `pipeline/steps/fetch.ts:18-25,27-37,80-131`, `pipeline/cli.ts` (fetch flags `--tiles`, `--jobs`, `--dry-run`, `--lidar`), `pipeline/steps/upload.ts:125-190` (archive the LiDAR lock's files), `pipeline/test/upload.test.ts`, `docs/dev/pipeline.md` (Requirements, the Commands table row for `fetch`, the Lock section)

**Interfaces:**
- Consumes: `uvRun` (Task 2), `encodeLidarTile`, `lidarTileName`, `tilesForBbox` (Task 1), `storeFile` (`pipeline/lib/raw.ts`), `LockEntry` (`pipeline/lib/lock.ts:14-23`).
- Produces:
  ```ts
  export const LIDAR_ID = 'usgs-lidar-sf';
  export const EPT_URL = 'https://s3-us-west-2.amazonaws.com/usgs-lidar-public/CA_SanFrancisco_1_B23/ept.json';
  /** 'CA_SanFrancisco_1_B23 sfhl/1 res=0.25 ground=1 tile=500 pad=20 veg=0.35' from BOXES. */
  export function lidarUpstreamVersion(): string;
  /** Tiles covering BBOX (pipeline/config.ts:4) in EPSG:7131. */
  export function cityTiles(db: Duck): Promise<[number, number][]>;
  export function fetchLidar(
    rawDir: string,
    opts: { tiles?: [number, number][]; jobs?: number; dryRun?: boolean; workDir?: string },
    deps?: { run: typeof run; db?: Duck }
  ): Promise<LockEntry | null>; // null on --dry-run
  /** <repo>/pipeline/lidar.lock.json; the mini fixture's is pipeline/test/fixtures/mini/lidar.lock.json. */
  export const LIDAR_LOCK = { live: string, fixture: string };
  /** The LiDAR lock, or null when the file is absent. */
  export function readLidarLock(path: string): Lock | null;
  /** "tx_ty" -> raw file path of each locked tile; empty map for a null lock or one without LIDAR_ID. */
  export function lidarTilesOf(lidarLock: Lock | null, rawDir: string, byName: boolean): Map<string, string>;
  ```
  Lock entry, written to `LIDAR_LOCK.live` with `writeLock` and never to `sources.lock.json`:
  - `id: 'usgs-lidar-sf'`, `upstreamVersion: lidarUpstreamVersion()`;
  - one file per tile with points, named `lidarTileName(tx, ty)` and sorted by name; `rowCount` = number of tiles;
  - `license: 'public-domain'`, `label: 'USGS 3DEP LiDAR, San Francisco 2023'`, `homepage: 'https://www.usgs.gov/3d-elevation-program'`.
  The default work dir is `pipeline/.cache/lidar-work/<upstreamVersion hash8>/` (resumable) and the default EPT node cache is `pipeline/.cache/ept/`.
  `fetch.ts`: `FETCH_IDS` gains `'overture-building-parts'` (Task 4) and `LIDAR_ID`. A new `DEFAULT_FETCH_IDS` (`FETCH_IDS` minus `LIDAR_ID`) applies when `--only` is absent. `fetch --restore --lidar` runs `restoreRaw` (`fetch.ts:43-77`) on the LiDAR lock; plain `--restore` never reads it.
  `upload.ts`: after the main lock's archives, every file of the LiDAR lock (when the file exists) is archived the same way: skipped when R2 has the key, uploaded from the raw cache when present. A tile that is in neither place refuses the upload with nothing sent: `usgs-lidar-sf: <name> is neither archived nor in the raw cache`. Fixture versions archive nothing, as today.

- [ ] **Step 1: Write the failing tests.** A fake `run` writes stub raw arrays for tiles `0_0` (points 10) and `1_0` (points 0) into the `--out` dir it is given:
  - `fetchLidar encodes tiles with points into lock files`: one file `usgs-lidar-sf/0_0.sfhl`; its sha256 equals `sha256File` of the stored raw; `upstreamVersion` equals `'CA_SanFrancisco_1_B23 sfhl/1 res=0.25 ground=1 tile=500 pad=20 veg=0.35'`; `license` `'public-domain'`; `rowCount` 1.
  - `fetchLidar passes the BOXES raster parameters`: the fake sees `--size 500 --res 0.25 --ground-res 1 --pad 20 --veg-frac 0.35`.
  - `a nonzero exit throws with the rasterizer's stderr` (`toThrow(/rasterize/)`).
  - `--dry-run returns null and writes nothing`.
  - `default fetch excludes the LiDAR` (`DEFAULT_FETCH_IDS` lacks `usgs-lidar-sf`; `FETCH_IDS` has it).
  - `the LiDAR goes to its own lock`: `fetchAll({ only: 'usgs-lidar-sf', lidarLockPath, lockPath })` with the fake writes the entry to `lidarLockPath` and leaves `lockPath` byte-identical.
  - `plain restore never touches the tiles; --lidar restores them`: with a fake R2 target, `fetchAll({ restore: true })` requests no `.sfhl` key, and `fetchAll({ restore: true, lidar: true })` restores the LiDAR lock's files.
  - `lidarTilesOf maps tile keys to raw paths`, by sha and by name; an empty map for a null lock.
  - In `upload.test.ts`: `upload archives the LiDAR lock's tiles` (a tile absent from the fake R2 and present locally is put; one already in R2 is skipped), and `upload refuses a tile in neither place` (nothing put, the message names the tile).
- [ ] **Step 2:** Run `npx vitest --run --project pipeline pipeline/test/lidar-source.test.ts pipeline/test/fetch.test.ts pipeline/test/upload.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `lidar.ts`, the fetch/restore/cli wiring and the upload change. `--only usgs-lidar-sf` dispatches to `fetchLidar` with the parsed flags.
- [ ] **Step 4:** Run the step 2 command again. Expected: PASS.
- [ ] **Step 5:** Update `docs/dev/pipeline.md`:
  - Requirements: `uv` (`brew install uv`), needed only for `fetch --only usgs-lidar-sf`.
  - Commands: the `fetch` row notes `--only usgs-lidar-sf [--tiles a_b,…] [--jobs n] [--dry-run]`, that the default fetch skips it, and `--restore --lidar`.
  - Lock: `pipeline/lidar.lock.json` holds only the tiles. `fetch --restore` and `build` never read it; `upload` archives its files.
  - A short paragraph on the source: format `sfhl/1`, the cache dirs, not an as-of source.
- [ ] **Step 6: Commit** `feat(pipeline): add the usgs-lidar-sf raster source`.

### Task 4: Overture building parts and the mini fixture's parts and LiDAR

**Files:**
- Modify: `pipeline/sources/overture.ts:27-63`, `pipeline/sources/normalise.ts:14-73,174-186,285-291`, `pipeline/steps/fetch.ts:101-119`, `pipeline/steps/build.ts:172-190`, `pipeline/test/fixtures/mini/make-fixture.ts:512-551,770-790,898-1001`, `pipeline/test/fixtures/mini/README.md`
- Create: `pipeline/test/fixtures/mini/lidar.lock.json` (generated)
- Regenerate: `pipeline/test/fixtures/mini/raw/*`, `sources.lock.json`, `golden/`, `e2e/fixtures/data/fixture-0/`
- Test: `pipeline/test/overture-parts.test.ts`, `pipeline/test/normalise.test.ts`

**Interfaces:**
- Consumes: `synthTile`, `encodeLidarTile`, `lidarTileName`, `tilesForBbox` (Task 1); `LIDAR_ID`, `lidarUpstreamVersion` (Task 3).
- Produces:
  ```ts
  export function fetchOvertureParts(release: string, rawDir: string, db: Duck): Promise<LockEntry>;
  // id 'overture-building-parts', s3 glob theme=buildings/type=building_part, same bbox filter,
  // columns: id, building_id, height, min_height, roof_shape, roof_height, num_floors, min_floor,
  // datasets (list_transform(sources, s -> s.dataset)), geom; license 'ODbL-1.0',
  // label 'Overture Maps Building Parts'; upstreamVersion = release.
  /** null when consistent or parts are absent; else `overture-building-parts release <a> differs from overture-buildings <b>; refetch both with --release`. */
  export function overtureReleaseProblem(lock: Lock): string | null;
  ```
  `src_overture_parts(id VARCHAR, building_id VARCHAR, height DOUBLE, min_height DOUBLE, roof_shape VARCHAR, roof_height DOUBLE, num_floors INTEGER, min_floor INTEGER, datasets VARCHAR[], geom GEOMETRY)` is ordered by id. It is optional (`OPTIONAL_SOURCE_IDS`, `EMPTY_SELECT`). `fetch` resolves the Overture release once. `--only overture-buildings` also fetches the parts with the same release, and `--only overture-building-parts --release <r>` fetches the parts alone. `build` throws `BuildError(overtureReleaseProblem(lock))` before normalising.
- Mini fixture additions (local metres; the README table gains a Parts and a LiDAR section):
  - Parts on `b14` (footprint x[132,138] y[5,25], 60 m): `p14a` podium covering the whole footprint, height 20; `p14b` x[133,137] y[15,24], height 60, `roof_shape` `pyramidal`, `roof_height` 8, `min_height` 20; `p14c` x[132,134] y[5,7] with no height (not counted); `p14leg` x[139,140] y[26,27], height 10, outside the footprint and inside lot 14.
  - A part on `b10` (x[95,105] y[5,25], 18 m): `p10` x[95,100] y[5,25], height 18, so x[100,105] is uncovered.
  - LiDAR: `synthTile` tiles over `tilesForBbox` of x[−70, 300] y[−110, 120] around origin O, except the tile holding the shoreline lots. That leaves `bbay` (x[E+2,E+8]) without LiDAR and on the `no_lidar` fallback. The scene, shifted (+1.0, −0.3) m:
    - ground 20.00 m, except a 1:10 slope over x[130,140] (rising east, under `b14`, whose part heights do not read the LiDAR);
    - `b01` flat 12 m;
    - `b02` 15 m with its Mission-St face (y = 5, Mission St at y = −8) standing 1.5 m higher over a 1.2 m band;
    - `b03` with hag 0 (a building newer than the flight);
    - `b04` 4 floors (12 m) with a 3 m tree (veg) overhanging its roof by 2 m at +5 m;
    - `b06` 9 m courtyard;
    - `b10` 18 m with a 4×9 m region (36 m²) at 26 m over x[100.5,104.5] y[10,19], inside the uncovered half;
    - `b13` gable, eave 6, ridge 10, ridge along y;
    - `b14` drawn as its parts;
    - `broad` 4 m.

- [ ] **Step 1: Write the failing tests:**
  - `normalise reads the mini parts`: `src_overture_parts` has 5 rows ordered by id; `p14b` has `roof_shape` `pyramidal`, `roof_height` 8, `building_id` `b14`.
  - `a lock without parts gives an empty src_overture_parts` with the ten columns above.
  - `overtureReleaseProblem`: matching releases → `null`; buildings `2026-09-23.1` and parts `2026-10-21.0` → the message naming both; no parts entry → `null`.
  - `build refuses mismatched releases`: `build()` on a copy of the mini lock whose parts `upstreamVersion` differs rejects with `BuildError` matching `/release/`.
- [ ] **Step 2:** Run `npx vitest --run --project pipeline pipeline/test/overture-parts.test.ts pipeline/test/normalise.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the source, normalise, fetch and build check. Extend `make-fixture.ts`:
  - parts features and an `overture-building-parts` entry in the mini `sources.lock.json`;
  - LiDAR tiles written with `encodeLidarTile(synthTile(...))` under `raw/usgs-lidar-sf/`, with a `binaryEntry` for `usgs-lidar-sf` (upstreamVersion `lidarUpstreamVersion()`) written to `pipeline/test/fixtures/mini/lidar.lock.json`, never to the mini `sources.lock.json`;
  - `make-fixture.ts` writes the mini `sources.lock.json` from scratch, so it drops any `building-boxes` entry. When it drops one, it prints `run npm run pipeline -- boxes --fixture, then fixture --update-golden` (Task 9 adds that command).
  Update the README.
- [ ] **Step 4:** Run `npx tsx pipeline/test/fixtures/mini/make-fixture.ts`, then `npm run pipeline -- fixture --update-golden`. Expected: the fixture builds with every invariant OK.
- [ ] **Step 5:** Run `git diff --stat pipeline/test/fixtures/mini/golden e2e/fixtures/data/fixture-0`. Expected: only `manifest.json` (one new source, `overture-building-parts`) and `report.json` change. `parcels/`, `scenarios/` and the derived goldens are unchanged. Nothing reads the new inputs yet, so any other change is a bug.
- [ ] **Step 6:** Run `npm run test:pipeline`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(pipeline): add Overture building parts and the mini fixture's LiDAR`.

  Note: the mini fixture has no `building-boxes` artifact until Task 9, so fixture builds still draw today's boxes.

### Task 5: Raster mosaic, windows and raster primitives

**Files:**
- Create: `pipeline/lib/lidar/mosaic.ts`, `pipeline/lib/lidar/raster.ts`
- Modify: `pipeline/lib/lidar/geom.ts` (functions), `pipeline/test/lidar-synth.ts` (add `synthWindow(scene: SynthScene, b: Bbox7131): RasterWindow`, the in-memory window Tasks 6–7 test on)
- Test: `pipeline/test/lidar-raster.test.ts`

**Interfaces:**
- Consumes: `decodeLidarTile`, `LidarTile`, `BOXES` (Task 1); `lidarTilesOf` (Task 3).
- Produces:
  ```ts
  // mosaic.ts
  export interface RasterWindow {
    x0: number; y0: number; res: number; nx: number; ny: number; // cell (i,j) centre = x0+(i+.5)res, y0+(j+.5)res
    hag: Float32Array; // metres, NaN = no data or no tile
    ground: Float32Array; // NAVD88 metres, bilinear from the 1 m grid, NaN = none
    veg: Uint8Array;
  }
  export class LidarMosaic {
    constructor(load: (tx: number, ty: number) => LidarTile | null, maxTiles?: number); // LRU, default 16
    /** Cells snapped to the global 0.25 m grid; null when no tile intersects b. */
    window(b: Bbox7131): RasterWindow | null;
  }
  /** Lazy file-backed mosaic over lidarTilesOf(...); Error when a tile header's sizeM/res/groundRes differ from BOXES. null when tiles is empty. */
  export function openLidarMosaic(tiles: Map<string, string>): LidarMosaic | null;
  // raster.ts
  export function cellMask(w: RasterWindow, shape: MultiPoly, dx?: number, dy?: number): Uint8Array; // centre-in, even-odd
  export function bilinear(a: Float32Array, w: RasterWindow, x: number, y: number): number;
  export function gaussian(a: Float32Array, nx: number, ny: number, sigmaCells: number): Float32Array;
  export function gradient(a: Float32Array, nx: number, ny: number, res: number): { gx: Float32Array; gy: Float32Array };
  export function label4(mask: Uint8Array, nx: number, ny: number): { labels: Int32Array; n: number };
  // geom.ts (clipper2-ts PathsD, precision 3 = mm, deterministic)
  export function inset(p: MultiPoly, d: number): MultiPoly; // negative buffer, miter joins
  export function grow(p: MultiPoly, d: number): MultiPoly;
  export function union(a: MultiPoly[]): MultiPoly;
  export function intersect(a: MultiPoly, b: MultiPoly): MultiPoly;
  export function difference(a: MultiPoly, b: MultiPoly): MultiPoly;
  export function area(p: MultiPoly): number;
  export function translate(p: MultiPoly, dx: number, dy: number): MultiPoly;
  export function cellsToPoly(w: RasterWindow, mask: Uint8Array, dx?: number, dy?: number): MultiPoly; // row runs → rectangles → union, then translated by (-dx,-dy)
  export function fromGeoJson(g: string): MultiPoly; // DuckDB ST_AsGeoJSON (Polygon | MultiPolygon)
  export function toGeoJson(p: MultiPoly): string;
  ```

- [ ] **Step 1: Write the failing tests:**
  - `a window across a tile seam equals the single-raster scene` (Review Focus 2): one scene's 10 m box straddles x = 500. `window()` over two `synthTile` tiles equals `synthWindow` of the same bbox cell for cell, with no NaN on the seam.
  - `a missing tile reads NaN`, and `a window touching no tile is null`.
  - `openLidarMosaic rejects a tile at res 0.5` (`toThrow(/res/)`).
  - `cellMask honours holes and multipolygons`: the courtyard ring (outer x[51,59] y[5,25], hole x[54,56] y[12,18]) masks 8·20 − 2·6 = 148 m² ± 1 cell row; a two-part MultiPolygon masks the sum.
  - `cellMask with a shift samples the shifted place`: the scene shifted (+1.0, −0.3); the mean hag under the mask at d = (1.0, −0.3) is 10 ± 0.05, and at d = 0 it is below 9.
  - `label4 counts components` (two blobs touching diagonally → 2).
  - `cellsToPoly then intersect stays inside`: area(difference(result, footprint)) < 0.01.
  - `the LRU evicts`: with `maxTiles` 2, reading three tiles calls `load` 4 times across a revisit.
- [ ] **Step 2:** Run `npx vitest --run --project pipeline pipeline/test/lidar-raster.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. `ground` is bilinear from the 1 m grid at 0.25 m cell centres.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pipeline): add the LiDAR mosaic and raster primitives`.

### Task 6: Registration clusters and the edge-gradient fit

**Files:**
- Create: `pipeline/lib/lidar/clusters.ts`, `pipeline/lib/lidar/register.ts`
- Test: `pipeline/test/lidar-register.test.ts`

**Interfaces:**
- Consumes: `RasterWindow`, `gaussian`, `gradient`, `bilinear`, `cellMask` (Task 5); `UnionFind` (`pipeline/project-records/union-find.ts:5`); `SQL_BLOCK_OF` (`pipeline/lib/road-lots.ts:62`).
- Produces:
  ```ts
  export interface Footprint { bid: string; shape: MultiPoly; heightM: number; baseM: number; hs: number }
  /** bid -> cluster id (its smallest member bid). Reads buildings and pieces (read only). */
  export function clusterBuildings(db: Duck): Promise<Map<string, string>>;
  export type ShiftSource = 'fit' | 'frame-nad83' | 'frame-wgs84' | 'none';
  export interface Shift {
    dx: number; dy: number; source: ShiftSource; score: number; ratio: number; // second/best
    sharpX: number; sharpY: number; atEdge: boolean; flagged: boolean;
  }
  export function scoreGrid(w: RasterWindow, members: Footprint[], href: number): { shifts: Float64Array; S: Float64Array };
  export function analysePeak(shifts: Float64Array, S: Float64Array): Omit<Shift, 'source' | 'flagged'>;
  export function registerCluster(w: RasterWindow, members: Footprint[]): Shift;
  ```
  Cluster SQL: `main_parcel(bid)` is the parcel with the building's largest piece (ties by parcel id). It is NULL when the building has no parcel piece, and such a building is its own cluster. Pairs: `a.bid < b.bid AND ST_DWithin(a.geom, b.geom, BOXES.regTouchM) AND block(main_parcel(a)) = block(main_parcel(b))`.

Algorithm (from `fitlib.py` `prepare`, `score_grid`, `analyse_peak`):

```
href   = median hag over the members' unshifted masks (non-veg, finite)
h      = hag with veg → 0 and NaN → 0
hn     = gaussian(clip((h − 0.5) / max(0.6·href, 1.5), 0, 1), σ = 1 cell); (gx, gy) = gradient(hn)
P, N   = boundary samples every regSampleStepM along every ring of every member, outward normals
         (outer rings CCW, holes CW); stride-subsample to ≤ regMaxSamples
S(d)   = mean over samples of −(gx(P+d)·Nx + gy(P+d)·Ny), d on the grid −3..3 step 0.1 (61×61)
peak   = argmax S, sub-cell parabolic refinement in x and y; second = max S farther than
         regSecondPeakM from the peak; ratio = second/best; sharpX/Y = weighted spread of cells
         within 10% of best; atEdge = |peak| on the grid border
confident = !atEdge && best > 0 && ratio < regAmbiguousRatio  →  source 'fit'
else: score the two frames and (0,0) by bilinear interpolation on S; the best positive one wins
      ('frame-nad83' | 'frame-wgs84', or 'none' = (0,0)); flagged = true
```

- [ ] **Step 1: Write the failing tests** (synthetic windows from `synthWindow`):
  - `recovers a detached building's shift`: a 12×20 m box at 9 m shifted (+1.24, −0.32). Expect `source` `'fit'`, dx 1.24 ± 0.1, dy −0.32 ± 0.1, `flagged` false.
  - `tolerates eaves`: the LiDAR box is 0.4 m larger on every side, true shift (0.6, 0.2). Expect dx 0.6 ± 0.15 and dy 0.2 ± 0.15.
  - `a rowhouse block fits as one`: six abutting 6×25 m houses of equal height shifted (1.1, −0.3). Each house alone gives `ratio ≥ 0.85` or `atEdge` (ambiguous). The cluster gives `'fit'` within 0.1 m.
  - `a shift beyond the search falls back flagged`: true shift (3.6, 0) → `atEdge` true, `flagged` true, `source` ≠ `'fit'`.
  - `bare ground gives none`: no box → `source` `'none'`, dx = dy = 0, `flagged` true.
  - `a tree beside the building does not pull the fit`: a veg disc 1 m off one wall; the fit is still within 0.1 m.
  - `clusters on the mini fixture`: after `runSql`, every kept building is its own cluster. The mini footprints are ≥ 4 m apart, except `besri`, which lies 1.0 m from `b06` but has no piece (its 1.44 m² sliver is dropped) and so no block.
  - `clusters on hand rows`: a DuckDB table with footprints 1.0 m apart on parcels `3512001`/`3512002` (one cluster), 1.0 m apart on `3512001`/`3513001` (two clusters, other block), and 2.0 m apart on one block (two clusters).
- [ ] **Step 2:** Run `npx vitest --run --project pipeline pipeline/test/lidar-register.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as sketched.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pipeline): register footprint clusters to the LiDAR`.

### Task 7: Per-building boxes: ground, roof form, false fronts, steps, fallbacks

**Files:**
- Create: `pipeline/lib/lidar/streets.ts`, `pipeline/lib/lidar/derive.ts`
- Test: `pipeline/test/lidar-derive.test.ts`

**Interfaces:**
- Consumes: Tasks 5 and 6 (`RasterWindow`, `cellMask`, `label4`, `geom.ts`, `Footprint`, `Shift`).
- Produces:
  ```ts
  // streets.ts
  export class StreetIndex {
    constructor(lines: Ring[]); // public centrelines, EPSG:7131
    /** A centreline within maxDist of mid whose direction from mid has cosine ≥ minCos with n. */
    facing(mid: [number, number], n: [number, number], maxDist: number, minCos: number): boolean;
  }
  // derive.ts
  export type BoxSrc = 'box' | 'base' | 'front' | 'step' | 'part';
  export interface RenderBox { bid: string; k: number; src: BoxSrc; shape: MultiPoly; baseM: number; heightM: number }
  export type Fallback = 'no_lidar' | 'new_building' | 'unreliable' | 'elevated';
  export interface RoofRecord {
    bid: string; roof: 'flat' | 'pitched' | 'unknown';
    eaveM: number | null; ridgeM: number | null; ridgeDeg: number | null; // ridgeDeg: [0,180) clockwise from grid north
    groundM: number | null; groundMinM: number | null; fallback: Fallback | null;
    nFront: number; nStep: number; stepsCapped: boolean;
  }
  export interface DeriveInput {
    fp: Footprint; shift: Shift; streets: StreetIndex;
    area?: MultiPoly; // restrict to this part of the footprint (parts' uncovered area)
    kStart?: number;
  }
  export function deriveBoxes(w: RasterWindow | null, inp: DeriveInput): { boxes: RenderBox[]; roof: RoofRecord };
  ```
  Heights in `RenderBox` are metres above the building's ground reference, rounded to 0.1, clamped to `BOXES.heightRangeM`. On a fallback, `deriveBoxes` returns exactly one `box` with `fp.baseM`/`fp.heightM` over `area ?? fp.shape`, and `roof: 'unknown'`.

Algorithm sketch (cells are sampled at footprint + shift; output polygons are in the footprint's frame):

```
shape     = area ?? fp.shape;  interior = inset(shape, marginM)
fallbacks, in order: fp.baseM > 0 → elevated; w null or all cells NaN → no_lidar;
           area(interior) < minInteriorM2 or finite share of interior cells < coverageMin
           or shift.source = 'none' → unreliable;
           share of interior cells with hag < raisedHagM ≥ groundShareMin → new_building
groundM   = median(ground) over the shape's cells; groundMinM = min(ground)
h(cell)   = hag + ground − groundM                   (height above the reference)
C         = interior cells, finite, ¬veg, hag ≥ raisedHagM
roof form: for the two axes of the interior's minimum rotated rectangle, fit
           h = r − k·|u − u0| (gable, u ⟂ ridge) and h = a + b·u (shed) by least squares on C;
           take the best R². Pitched when R² ≥ pitchMinR2, slope ≥ pitchMinSlope and
           rise ≥ pitchMinRiseM: model(x,y) = the fit, eave = min, ridge = max over the interior,
           top = (eave + ridge)/2. Otherwise flat: 0.5 m histogram of h over C, smoothed [1,2,1];
           levels = local maxima holding ≥ 10% of C, merged when < stepGapM apart (larger kept);
           main = the lowest level with share ≥ roofMainShareMin (else the largest);
           top = median h of C within ±1 m of main; model ≡ top
base box  = shape, baseM = fp.baseM (0), heightM = top
steps     = cells of C with h − model ≥ stepGapM, minus rough cells (3×3 std of h > treeRoughM),
           opened by 1 cell; label4; components ≥ stepMinAreaM2; split a component once at its
           own median + stepGapM; level = median h; keep the stepCap largest by area×(level−top)
           (stepsCapped when more). Polygon = intersect(cellsToPoly(component) ∪
           (grow(component, marginM + res) ∩ difference(shape, interior)), shape)
           [the second term grows a component that reaches the margin out to the real edge: flush];
           baseM = top, heightM = level
fronts    = faces = runs of consecutive exterior edges turning < frontFaceAngleDeg, length ≥
           frontMinFaceM, streets.facing(mid, outward n, frontStreetM, frontFacingCos);
           band = shape cells between marginM and frontBandM from the face, minus step cells;
           value = frontPct quantile of h over the band; if value − top ≥ frontRiseM:
           strip = intersect(face offset inward by frontDepthM, shape), baseM = top, heightM = value
```

- [ ] **Step 1: Write the failing tests** (synthetic, with the mini streets pattern: a centreline 12 m in front of the street face):
  - `flat roof → one base`: a 10 m box gives exactly one `base`, heightM 10.0 ± 0.1, `roof` `'flat'`, no fronts or steps.
  - `gable is pitched, not a staircase`: eave 6, ridge 10, ridge along the long axis. Expect `roof` `'pitched'`, eaveM 6 ± 0.3, ridgeM 10 ± 0.3, ridgeDeg within 5° of the long axis, one `base` at 8 ± 0.3, and zero `step` boxes.
  - `Victorian false front`: main roof 9, the 0.3–2 m street band at 11. Expect one `front`, heightM 11 ± 0.1, baseM 9.0 ± 0.1, area = face length × 0.5 ± 2%. With rise 0.8 m there is no front. A rear face (centreline 45 m behind) at +2 m gives no front.
  - `corner gets two fronts`: centrelines in front and to one side, both bands +2 m → `nFront` 2.
  - `tower over podium with a flush face`: the podium at 12 covers 70%; a tower at 40 covers 30% (≥ 20 m²) and touches the street edge. Expect `base` 12 and one `step` (baseM 12, heightM 40). The step's street side lies on the footprint edge: the Hausdorff distance from that edge segment to the step is < 0.01 m. The street band inside the tower gives no `front`.
  - `small or low regions are dropped`: 15 m² at +3 m → no step; 30 m² at +2.0 m → no step; 30 m² at +3 m → one step.
  - `the step cap`: six separated 30 m² regions at +3…+8 m → 4 steps, `stepsCapped` true, the kept four being the four tallest (equal areas).
  - `trees are not penthouses`: a veg disc at +6 m over the roof → no step; an unflagged region with 3×3 std 2 m → no step.
  - `boxes stay inside` (Review Focus 4): for every case above plus the courtyard footprint and a two-part MultiPolygon, every box gives area(difference(box, grow(fp.shape, 0.005))) < 0.01 m², and the courtyard hole holds no box (area(intersect(box, hole)) < 0.01).
  - `fallbacks`: `w` null → one `box` at `fp.heightM`, fallback `'no_lidar'`. 90% of the interior at hag 0.2 → `'new_building'`. 60% NaN → `'unreliable'`. `fp.baseM` 5 → `'elevated'` with the box baseM 5. A 2×2 m footprint → `'unreliable'`. `shift.source` `'none'` → `'unreliable'`.
  - `hillside reference`: ground rising 20→26 across the footprint, a roof at 33 m absolute. Expect groundM 23 ± 0.1, groundMinM 20 ± 0.1, base heightM 10 ± 0.1.
  - `samples at the shift, draws at the footprint`: the LiDAR is offset (1.0, −0.3) and the shift given. Expect base heightM 10 ± 0.1 and the base shape to equal `fp.shape` (area within 0.01 m²).
  - `area restricts the derivation`: with `area` = the east half, every box lies inside that half.
- [ ] **Step 2:** Run `npx vitest --run --project pipeline pipeline/test/lidar-derive.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as sketched.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pipeline): derive base, false-front and step boxes per building`.

### Task 8: Mapped parts

**Files:**
- Create: `pipeline/lib/lidar/parts.ts`
- Test: `pipeline/test/lidar-parts.test.ts`

**Interfaces:**
- Consumes: `RenderBox`, `geom.ts`.
- Produces:
  ```ts
  export interface Part {
    id: string; buildingId: string; shape: MultiPoly;
    heightM: number | null; minHeightM: number | null; roofShape: string | null; roofHeightM: number | null;
  }
  export function countedParts(parts: Part[]): Part[]; // heightM !== null, ordered by id
  export function partBoxes(bid: string, counted: Part[], kStart: number): RenderBox[];
  /** fp minus the union of counted parts; pieces under min_piece_m2 (2 m²) dropped. */
  export function uncoveredArea(fp: MultiPoly, counted: Part[]): MultiPoly;
  export function partCoverage(fp: MultiPoly, counted: Part[]): number; // area(fp ∩ ∪parts)/area(fp)
  ```
  Tiers: for `roofShape ∈ BOXES.partTierShapes` with `roofHeightM > 0`, eave = heightM − roofHeightM. Emit one block [minHeightM ?? 0, eave], then `partTiers` tiers. Tier i spans [eave + i·rh/N, eave + (i+1)·rh/N], and its shape is the part scaled about its centroid by f(i/N), then intersected with the part: `pyramidal`/`cone` f(t) = 1 − t; `dome`/`onion` f(t) = √(1 − t²). Other shapes, or a tiered shape without `roofHeightM`: one box to eave + roofHeightM/2 (to heightM when null). Parts are never shifted.

- [ ] **Step 1: Write the failing tests:**
  - `a plain part`: heightM 20, minHeightM null → one `part` box, baseM 0, heightM 20.
  - `pyramidal tiers`: `p14b` (height 60, roof 8, min 20) → a block 20→52, then 5 tiers. Tier i is [52 + 1.6i, 52 + 1.6(i+1)] ± 0.05; tier areas strictly decrease; every tier ⊂ the part.
  - `dome tiers shrink by √(1−t²)`: tier 2's area ratio to the part is (√(1 − 0.4²))² ± 2%.
  - `gabled goes flat at eave + half`: height 12, roof 4, `gabled` → one box, heightM 10.
  - `tiered shape without roof height is flat at height`.
  - `uncounted parts are ignored`: `p14c` is absent from `countedParts`.
  - `parts outside the footprint are kept`: `p14leg` gets a box whose shape is the leg's.
  - `uncovered area`: b10 with `p10` → area 100 ± 0.01 m², x ∈ [100, 105]; `partCoverage` 0.5.
- [ ] **Step 2:** Run `npx vitest --run --project pipeline pipeline/test/lidar-parts.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pipeline): render mapped building parts with roof tiers`.

### Task 9: The `boxes` command and its locked artifact

**Files:**
- Create: `pipeline/lib/lidar/artifact.ts`, `pipeline/steps/boxes.ts`
- Modify: `pipeline/lib/version.ts:79-112` (extract `treeHash(repoRoot, paths, excludes)` from `codeTreeHash`, which keeps its output byte for byte; add `BOXES_CODE_PATHS` and `boxesCodeHash`), `pipeline/cli.ts` (command `boxes [--fixture]`), `pipeline/steps/doctor.ts` (required `boxes-lock` check), `pipeline/test/fixtures/mini/README.md` (the fixture regeneration sequence)
- Regenerate: `pipeline/test/fixtures/mini/raw/building-boxes/*`, `pipeline/test/fixtures/mini/sources.lock.json`, `golden/manifest.json`, `e2e/fixtures/data/fixture-0/manifest.json`
- Test: `pipeline/test/boxes-command.test.ts`, `pipeline/test/version.test.ts`, `pipeline/test/doctor.test.ts`, `pipeline/test/manifest.test.ts`

**Interfaces:**
- Consumes:
  - Tasks 3–8: `readLidarLock`, `lidarTilesOf`, `LIDAR_LOCK`, `openLidarMosaic`, `clusterBuildings`, `registerCluster`, `StreetIndex`, `deriveBoxes`, `countedParts`, `partBoxes`, `uncoveredArea`, `partCoverage`, `overtureReleaseProblem`;
  - `normaliseAll`, `loadNormalised` (`pipeline/sources/normalise.ts`);
  - `runSql(db, '50_clip.sql')` (`pipeline/lib/sql.ts:28`, which stops after 50_clip and leaves the model SQL untouched);
  - `verifyRaw`, `writeLock`, `canonicalJson` (`pipeline/lib/lock.ts`); `storeFile` (`pipeline/lib/raw.ts`).
- Produces:
  ```ts
  // artifact.ts
  export const BOXES_ID = 'building-boxes';
  export const BOXES_FILES = {
    boxes: 'building-boxes/boxes.parquet', roofs: 'building-boxes/roofs.parquet', inputs: 'building-boxes/inputs.json'
  } as const;
  export const BOXES_GATED = ['overture-buildings', 'overture-building-parts'] as const;
  export const BOXES_RECORDED = [...BOXES_GATED, 'usgs-lidar-sf', 'datasf-parcels', 'datasf-streets', 'datasf-neighborhoods'] as const;
  export interface BoxesInputs { schema: 1; code: string; config: string; sources: Record<string, string> } // full sha256 hex; '' = source absent
  export function entryHash(e: LockEntry | undefined): string; // sha256 of the entry's file sha256s joined by ','; '' when absent
  export function configHash(): string; // sha256(canonicalJson(BOXES))
  export function boxesInputsOf(lock: Lock, lidarLock: Lock | null, code: string): BoxesInputs;
  /** 'boxes/1 code=<12> config=<12> overture-buildings=<12> overture-building-parts=<12> usgs-lidar-sf=<12> datasf-parcels=<12> datasf-streets=<12> datasf-neighborhoods=<12>' ('-' when absent). */
  export function boxesUpstreamVersion(i: BoxesInputs): string;
  export function parseBoxesUpstreamVersion(s: string): { code: string; config: string; sources: Record<string, string> };
  /** null without a building-boxes entry or when every BOXES_GATED prefix matches the lock; else
   *  `building-boxes were derived from overture-buildings <a>, the lock has <b>: run npm run pipeline -- boxes` (one clause per gated source). Lock-only: needs no raw files. */
  export function boxesLockProblem(lock: Lock): string | null;
  /** One warning per differing non-gated source, code or config, each ending `: run npm run pipeline -- boxes to refresh`. */
  export function boxesStaleWarnings(lock: Lock, lidarLock: Lock | null, code: string): string[];
  export function boxesFilesOf(lock: Lock, rawDir: string, byName: boolean): { boxes: string; roofs: string } | null;
  /** The boxes.* counts (Task 10's list) from tables bx_boxes and bx_roofs. */
  export function boxesCounts(db: Duck): Promise<Record<string, number>>;
  // steps/boxes.ts
  /** Reads buildings, pieces, src_overture_parts, src_streets of a db where runSql(db, '50_clip.sql') ran; leaves bx_boxes and bx_roofs. */
  export async function deriveBuildingBoxes(a: { db: Duck; lidar: LidarMosaic | null; workDir: string }): Promise<void>;
  export async function boxesCommand(o: {
    lockPath: string; lidarLockPath: string; rawDir: string; byName: boolean; repoRoot: string; now?: Date
  }): Promise<number>;
  // version.ts
  export const BOXES_CODE_PATHS = ['pipeline/lib/lidar', 'pipeline/steps/boxes.ts', 'pipeline/boxes-config.ts', 'pipeline/project-records/union-find.ts'];
  export function boxesCodeHash(repoRoot: string): Promise<string>; // treeHash over BOXES_CODE_PATHS, uncommitted changes included
  ```
  Artifact tables:
  - `bx_boxes` → `boxes.parquet`: `bid VARCHAR, k INTEGER, src VARCHAR ('base'|'front'|'step'|'part'), base_m DOUBLE, height_m DOUBLE, geom BLOB` (WKB, EPSG:7131; NULL = the building's full footprint, used for an unrestricted `base`), ordered by bid, k. Fallback buildings have no rows: `build` draws their box.
  - `bx_roofs` → `roofs.parquet`: one row per kept building. Columns: `bid, roof, eave_m, ridge_m, ridge_deg, ground_m, ground_min_m, shift_dx, shift_dy, shift_source, reg_score, reg_ratio, reg_sharp_x, reg_sharp_y, reg_flagged, cluster_id, fallback, n_front, n_step, steps_capped, n_parts, parts_coverage, uncovered_dropped, lng, lat` (`lng`/`lat` = the 4326 point on surface of the footprint).
  - `inputs.json` = `canonicalJson(BoxesInputs)` + newline.
  - Parquet written with `SET threads = 1` and `ORDER BY`, so rerunning on the same inputs gives the same bytes.
  Lock entry, replacing any previous one in `sources.lock.json`:
  - `id: 'building-boxes'`, `files` the three above, `upstreamVersion: boxesUpstreamVersion(inputs)`;
  - `retrievedAt`: the derivation time;
  - `rowCount`: the `bx_roofs` rows;
  - `license: 'ODbL-1.0'`, `label: 'Building boxes (USGS 3DEP LiDAR 2023 and Overture)'`, `homepage: 'https://www.usgs.gov/3d-elevation-program'`.
  Live, the files go to `rawDir` by sha (`storeFile`); with `--fixture`, they go by name into `pipeline/test/fixtures/mini/raw/building-boxes/`, and the lock and LiDAR lock are the mini ones. `upload` archives the artifact through the existing main-lock path.

`boxesCommand` order:
1. Read both locks.
2. `verifyRaw` the main lock minus `building-boxes`, and the LiDAR lock. A missing file exits 1 with a hint: `run npm run pipeline -- fetch --restore`, plus `--lidar` when a tile is missing.
3. Check `overtureReleaseProblem`.
4. Normalise and load into a fresh DuckDB, then `runSql(db, '50_clip.sql')`.
5. `openLidarMosaic(lidarTilesOf(...))`, then `deriveBuildingBoxes`.
6. Write the parquets and `inputs.json`, store them, write the lock entry.
7. Print the `boxesCounts` summary and the artifact's total bytes.
`deriveBuildingBoxes` order:
1. Read `buildings` (`ST_AsGeoJSON`, ordered by bid), the `src_overture_parts` of kept buildings (to 7131 as `30_buildings.sql:10-12` does) and the public `src_streets`.
2. Compute clusters.
3. For each cluster in order of its smallest bid, take one window over the members' bbox + `regSearchM` + 2 m and register.
4. For each building: with counted parts, emit `partBoxes` plus `deriveBoxes` restricted to `uncoveredArea` (a fallback there sets `uncovered_dropped` and emits nothing); otherwise emit `deriveBoxes`, whose `box` fallback becomes a `bx_roofs` row with `fallback` set and no `bx_boxes` row.
5. Write NDJSON to `workDir` and load it with `read_json`.
Heights are clamped to `BOXES.heightRangeM` and rounded to 0.1.

- [ ] **Step 1: Write the failing tests** in `boxes-command.test.ts`. Derivation cases run `deriveBuildingBoxes` on the mini fixture (via `openMiniDuck`, `runSql(db, '50_clip.sql')`, and the mini LiDAR lock):
  - `the mini buildings get their boxes`:
    - `b01` has one `base` with NULL geom, height_m 12 ± 0.2, `shift_source` `'fit'` with dx 1.0 ± 0.1 and dy −0.3 ± 0.1;
    - `b02` has a `front` at 16.5 ± 0.2;
    - `b03` falls back `new_building`, `b04` has no `step` (the tree), `b13` is `pitched` with ridge_m 10 ± 0.3;
    - `bbay` falls back `no_lidar` with no `bx_boxes` row;
    - `b10` has a `part` over x[95,100] plus LiDAR boxes inside x[100,105], including a `step` at 26 ± 0.3;
    - `b14` has 8 `part` rows (podium, tower block, 5 tiers, leg), no LiDAR box, and `ground_min_m` < `ground_m` − 0.2 (the slope).
  - `bx_roofs has one row per kept building` (12).
  - `without a LiDAR lock every building falls back`: `deriveBuildingBoxes` with `lidar: null` gives `fallback` `'no_lidar'` everywhere except the part-covered `b14`. `bx_boxes` then holds only `part` rows.
  - `deterministic`: two runs give equal `bx_boxes` and `bx_roofs` rows (ordered fingerprint).
  - `recorded inputs`: on the mini lock, `boxesInputsOf(...).sources['overture-buildings']` equals `entryHash` of that entry, and `usgs-lidar-sf` that of the mini LiDAR lock's. `parseBoxesUpstreamVersion(boxesUpstreamVersion(i))` round-trips the 12-hex prefixes, with `'-'` for an absent parts entry.
  - `boxesLockProblem`: `null` without the entry and when consistent. With the `overture-buildings` sha changed in a lock copy, the message contains both prefixes and `npm run pipeline -- boxes`. The same holds for parts.
  - `boxesStaleWarnings`: `[]` when everything matches; one warning each for a changed `datasf-streets`, a changed code hash and a changed config hash, each ending `run npm run pipeline -- boxes to refresh`.
  - `boxesCommand on a copy of the mini fixture` (tmp dir, by name): exit 0; the copy's lock gains a `building-boxes` entry whose files exist with matching sha256 and whose `rowCount` is 12; rerunning leaves the lock byte-identical except `retrievedAt`.
  - `boxesCommand without the LiDAR tiles` (tiles deleted from the copy): exit 1, and the stderr names `fetch --restore --lidar`.
  - `the committed mini artifact is current`: rows of the committed `raw/building-boxes/*.parquet` equal a fresh `deriveBuildingBoxes`. On failure the message says `run npm run pipeline -- boxes --fixture`. The golden test is how fixture drift is caught here.
  - In `version.test.ts`, `codeTreeHash is unchanged by the refactor` (equal to the pre-refactor value at the test's fixed repo state) and `boxesCodeHash changes with an uncommitted edit under pipeline/lib/lidar and not with one under pipeline/sql`.
  - In `doctor.test.ts`, `boxes-lock`: `ok` without a lock or entry; a required failure carrying the `boxesLockProblem` message when stale.
  - In `manifest.test.ts`, `the manifest lists building-boxes`: `{ id: 'building-boxes', license: 'ODbL-1.0', label: 'Building boxes (USGS 3DEP LiDAR 2023 and Overture)' }` in `sources`.
- [ ] **Step 2:** Run `npx vitest --run --project pipeline pipeline/test/boxes-command.test.ts pipeline/test/version.test.ts pipeline/test/doctor.test.ts pipeline/test/manifest.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `artifact.ts`, `boxes.ts`, the version refactor, the CLI command and the doctor check.
- [ ] **Step 4:** Generate the mini artifact: `npm run pipeline -- boxes --fixture`, then `npm run pipeline -- fixture --update-golden`. Expected: `boxes` prints its counts with `boxes.outside_footprint 0`. The golden diff is `manifest.json` (one new source, `building-boxes`) and `report.json` only; `build` does not read the artifact until Task 10.
- [ ] **Step 5:** Run the step 2 command, then `npm run test:pipeline`. Expected: PASS.
- [ ] **Step 6:** Document the regeneration sequence in the mini README: `make-fixture.ts` → `pipeline -- boxes --fixture` → `pipeline -- fixture --update-golden`.
- [ ] **Step 7: Commit** `feat(pipeline): add the boxes command and its locked building-boxes artifact`.

### Task 10: `build` consumes the artifact

**Files:**
- Create: `pipeline/steps/render-boxes.ts`, `pipeline/sql/76_render_boxes.sql`
- Modify: `pipeline/config.ts:12-54` (add `render_min_piece_m2: 0.25` to `SQL_VARS`, with a comment), `pipeline/steps/build.ts:172-190` (stale check before normalising), `:218-226` (the step after `roadLotProblems`), `:397-411` (merge counts)
- Test: `pipeline/test/render-boxes.test.ts`

**Interfaces:**
- Consumes:
  - `boxesLockProblem`, `boxesStaleWarnings`, `boxesFilesOf`, `boxesCounts` (Task 9);
  - `boxesCodeHash` (Task 9); `readLidarLock`, `LIDAR_LOCK` (Task 3);
  - `runSqlFile` (`pipeline/lib/duck.ts`).
- Produces:
  ```ts
  export const BUILDING_ROOFS_PARQUET = 'building-roofs.parquet'; // copy of the artifact's roofs, for review
  export const RENDER_PIECES_PARQUET = 'render-pieces.parquet';
  export async function writeRenderBoxes(a: {
    db: Duck; files: { boxes: string; roofs: string } | null; derivedDir: string;
  }): Promise<{ written: boolean; counts: Record<string, number> }>; // written false (and nothing created) when files is null
  ```
  `76_render_boxes.sql` (run by `writeRenderBoxes` after it loads `bx_boxes`/`bx_roofs` with `ST_GeomFromWKB`; not in `SQL_FILES`):
  - `render_boxes(bid, k, src, base_m, height_m, hs, ground_m, ground_min_m, geom)` (EPSG:7131, ordered by bid, k). It is the union of:
    - (a) the artifact rows of bids in `buildings`, with NULL geom → the building's footprint, `hs` from `buildings`, and ground from `bx_roofs`;
    - (b) one `src = 'box'` row (k 0) for every building with no (a) row, carrying `buildings.base_m`/`height_m`/`hs`/`geom` (today's box) and its `bx_roofs` ground when present.
  - The clip mirrors `50_clip.sql:6-39` with `render_min_piece_m2` in place of `min_piece_m2`, giving `render_pieces(bid, k, src, parcel_id, geom, area_m2, base_m, height_m, hs, ground_m, ground_min_m)` (ordered by bid, k, parcel_id NULLS LAST).
  - `render_export(parcel_id, bid, k, src, height_m, base_m, hs, ground_m, ground_min_m, geojson4326)` is ordered by parcel_id NULLS LAST, bid, k. `70_export.sql` stays as it is.
  Counts: `boxesCounts` (all present, 0 when empty):
  - buildings: `boxes.buildings`, `boxes.buildings.{lidar,box,parts}`, `boxes.fallback.{no_lidar,new_building,unreliable,elevated}`;
  - boxes: `boxes.src.{box,base,front,step,part}`;
  - roof: `boxes.roof.{flat,pitched,unknown}`;
  - fronts and steps: `boxes.front.buildings`, `boxes.step.buildings`, `boxes.step.capped`, `boxes.step.max_per_building`;
  - registration: `boxes.reg.clusters`, `boxes.reg.{fit,frame_nad83,frame_wgs84,none}`, `boxes.reg.flagged`, `boxes.reg.ratio_p50`, `boxes.reg.ratio_p90`, `boxes.reg.shift_p50_m`, `boxes.reg.shift_p90_m`;
  - parts: `boxes.parts.buildings`, `boxes.parts.count`, `boxes.parts.coverage_p50`, `boxes.parts.uncovered_dropped`.
  Build-side counts:
  - `boxes.outside_footprint`: non-`part` render boxes whose area outside `ST_Buffer(footprint, 0.01)` exceeds 0.01 m²;
  - `boxes.missing_buildings`: buildings with no `render_boxes` row;
  - `boxes.artifact_unknown_bids`: artifact bids not in `buildings`, ignored;
  - `render.pieces`, `render.outside_parcels`.
  Shares and percentiles are rounded to 3 decimals. `build.ts`:
  - before normalising, throw `new BuildError(boxesLockProblem(lock))` when non-null;
  - off fixture builds, push `boxesStaleWarnings(lock, readLidarLock(LIDAR_LOCK.live), await boxesCodeHash(REPO_ROOT))` into `report.warnings`;
  - after `roadLotProblems`, run `report.time('render-boxes', () => writeRenderBoxes({ db, files: boxesFilesOf(lock, opts.rawDir, byName), derivedDir }))` and keep `written` for the tiles step (Task 11).

- [ ] **Step 1: Write the failing tests** (mini fixture with its committed artifact, `runSql`, then `writeRenderBoxes`):
  - `model tables are untouched`: before and after `writeRenderBoxes`, three fingerprints are equal:
    - `pieces`: `SELECT md5(string_agg(concat_ws('|', bid, parcel_id, ST_AsHEXWKB(geom), area_m2, height_m, base_m, hs), ';' ORDER BY bid, parcel_id NULLS LAST)) FROM pieces`;
    - `parcel_out`: the same, over every column but geom as text, plus `geojson7131`;
    - `buildings_export`: the same.
  - `composition`:
    - `b01`'s `base` covers its footprint (area within 0.01 m²);
    - `bbay` has one `box` at height_m 6 with ground NULL; `b03` has one `box` at its `buildings.height_m`;
    - `p14leg`'s `render_pieces` row has parcel_id `3512014` (the spec's Sutro check, in miniature);
    - `boxes.outside_footprint` 0, `boxes.missing_buildings` 0, `boxes.step.max_per_building` ≤ 4.
  - `without an artifact nothing is created`: `files: null` → `written` false, and no `render_boxes`, `render_export` or `bx_*` tables exist.
  - `a stale artifact stops the build` (Review Focus 1): copy the mini fixture to a tmp dir and add one feature to its `overture-buildings` raw file. Update that lock entry's `sha256`/`bytes`, so `verifyRaw` (`build.ts:174`) passes but the artifact's record no longer matches. `build()` on the copy then rejects with `BuildError` matching `/npm run pipeline -- boxes/`. This happens before normalising: no step output in `out/<v>`.
  - `derived files`: `building-roofs.parquet` has 12 rows; `render-pieces.parquet` has one row per `render_pieces` row.
  - `deterministic`: two runs give equal `render_export` fingerprints.
- [ ] **Step 2:** Run `npx vitest --run --project pipeline pipeline/test/render-boxes.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the step, the SQL file and the build wiring.
- [ ] **Step 4:** Run the test. Expected: PASS. Then run `npm run test:pipeline`. Expected: PASS except `golden.test.ts`, because `report.json` gains the `boxes.*` and `render.*` counts. Task 11 regenerates the golden.
- [ ] **Step 5: Commit** `feat(pipeline): build render boxes from the locked artifact`.

### Task 11: Tiles zoom split, V37, the fixture and docs

**Files:**
- Modify: `pipeline/steps/tiles.ts:14-85`, `pipeline/steps/check.ts` (add V37 after V36), `pipeline/steps/build.ts:356-358` (pass `written` and the drop count), `pipeline/test/tiles.test.ts:36-66`, `pipeline/test/invariants.test.ts`
- Create: `docs/dev/building-boxes.md`
- Modify: `CLAUDE.md` (Scoped reference docs: link `building-boxes.md`), `docs/dev/pipeline.md` (Commands: `boxes`; Lock: the `building-boxes` entry and its recorded inputs; Finishing a branch that changes the dataset: an Overture refresh needs `boxes` before `build`; Where things land: the two derived parquets; Invariants: V37; Fixture: the regeneration sequence)
- Regenerate: `pipeline/test/fixtures/mini/golden/`, `e2e/fixtures/data/fixture-0/`

**Interfaces:**
- Consumes: `render_export` (Task 10), `buildings_export` (`70_export.sql:4-8`).
- Produces:
  ```ts
  export async function writeBuildingsTiles(
    db: Duck, outDir: string, workDir: string,
    opts?: { split?: boolean; maxTileBytes?: number } // split default false; maxTileBytes default 400000
  ): Promise<{ dropsAtSplit: number }>; // tippecanoe stderr reports of dropped/kept-smallest features at z ≥ BOXES.splitZoom; 0 without split
  ```
  - **Without `split`:** today's code path exactly: the same `buildings.geojsonseq` bytes and the same tippecanoe arguments as `tiles.ts:28-78`.
  - **With `split`:** the `buildings_export` features carry `"tippecanoe": {"minzoom": 12, "maxzoom": 13}` and today's four properties only. Then come the `render_export` features with `"tippecanoe": {"minzoom": 14, "maxzoom": 15}` and properties `parcelId` (when not null), `heightM`, `baseM`, `hs`, `src`, `groundM` and `groundMinM` (each omitted when null). Add `-y src -y groundM -y groundMinM -T src:string -T groundM:float -T groundMinM:float`.
  - Counts: `tiles.buildings.drops_z14plus`, plus `tiles.buildings.bytes` (file size; live only, since tippecanoe bytes vary by platform).
  V37 "render boxes":
  - Without an artifact: OK, detail `no boxes artifact`.
  - Otherwise it passes iff `boxes.outside_footprint` = 0, `boxes.missing_buildings` = 0, `boxes.step.max_per_building` ≤ `BOXES.stepCap`, and, unless tiles were skipped, `tiles.buildings.drops_z14plus` = 0.
  - Detail: `src box/base/front/step/part <n>/<n>/<n>/<n>/<n>; fallback <share>; reg fit <share>`.

- [ ] **Step 1: Write the failing tests:**
  - In `tiles.test.ts`, `without an artifact the tiles input is today's`: on a mini lock copy without `building-boxes`, `writeBuildingsTiles(db, out, out)` writes a `buildings.geojsonseq` byte-identical to today's formula over `buildings_export` (computed in the test as `tiles.ts:31-38` does). The spawned tippecanoe argv (captured through an injected `run`) equals today's list.
  - `z12-13 keep today's boxes`: every feature of the z13 tile over lot 14 has property keys ⊆ {`parcelId`, `heightM`, `baseM`, `hs`}, and the `heightM` set of its features with `parcelId` `3512014` is {60}.
  - `z14+ carry the new boxes`: in the z15 tile over lot 14, the features with `parcelId` `3512014` have `src` values = {`part`} and 8 distinct (heightM, baseM) pairs. The features with `parcelId` `3512001` have `src` `base` and `groundM` 20 ± 0.1. The `bbay` features (`parcelId` `3512015`) have `src` `box`.
  - `every z14+ feature of a parcel carries its parcelId` (Review Focus 5): in the z15 tile over lot 10, every feature intersecting lot 10 has `parcelId` `3512010`. The `replaced` feature-state (keyed by `promoteId`) therefore hides them all.
  - `drop detection works` (Review Focus 3): `writeBuildingsTiles(db, out, out, { split: true, maxTileBytes: 200 })` returns `dropsAtSplit > 0`, and the default returns 0 on the mini fixture.
  - In `invariants.test.ts`: `V37 is OK without an artifact`; `V37 fails on a box outside its footprint, on a missing building, on 5 steps and on z14+ drops`; `V37 passes on the fixture build`.
- [ ] **Step 2:** Run `npx vitest --run --project pipeline pipeline/test/tiles.test.ts pipeline/test/invariants.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the tiles change, V37 and the build plumbing: `split: renderBoxes.written`.
- [ ] **Step 4:** Run `npm run pipeline -- fixture --update-golden`, then `git diff --stat pipeline/test/fixtures/mini/golden`. Expected: only `report.json` changes, with the new counts and V37 OK. Any change under `parcels/`, `scenarios/`, `derived/`, `neighborhoods.geojson` or `transit.json` means a model input moved: stop and fix.
- [ ] **Step 5:** Run `npm run test:pipeline`. Expected: PASS.
- [ ] **Step 6:** Run `npm run test:e2e -- --project=chromium --project=mobile`. Expected: PASS, including:
  - `e2e/map.spec.ts`: the z13 goldens at `:694-699` are unchanged because z13 is unchanged, and the replaced checks at z16–17 cover the multi-box parcel 3512014;
  - `e2e/timelapse-render.spec.ts`.
  A z13 golden diff means the zoom split leaked: investigate, never regenerate.
- [ ] **Step 7:** Write `docs/dev/building-boxes.md`:
  - the three stages (LiDAR fetch → `boxes` → `build`), and what each reads and locks;
  - every `BOXES` value with what it controls;
  - the `src` values and fallbacks;
  - the artifact's files and recorded inputs, which inputs gate and which warn, and why boxes code stays in the version hash;
  - the derived files and how to query them (DuckDB `read_parquet`);
  - the counts and V37;
  - the record of the spike's frames.
  Then the **tuning loop**:
  1. Once per machine: `npm run pipeline -- fetch --restore` and `npm run pipeline -- fetch --restore --lidar`.
  2. Edit `BOXES` in `pipeline/boxes-config.ts`.
  3. Run `npm run pipeline -- boxes`. The `building-boxes` entry in `sources.lock.json` changes.
  4. Commit the config and the lock.
  5. Run `npm run pipeline -- build`, then the review script (Task 12).
  6. Run `npm run pipeline -- upload <v>`, then `npm run signoff`, open the PR and merge. Staging deploys; the owner reviews there.
  Also: after any Overture refresh, run `boxes` before `build` (build refuses otherwise).
  Link the page from `CLAUDE.md`, then update `pipeline.md` as listed under Files. Run `npm run lint` and `npx vitest --run --project server scripts/docs-index.spec.ts`. Expected: PASS.
- [ ] **Step 8: Commit** `feat(pipeline): tile building boxes from z14 and check them (V37)`.

### Task 12: The review script

**Files:**
- Create: `scripts/building-review.ts`, `scripts/building-review.spec.ts`
- Modify: `docs/dev/building-boxes.md` (a "Review a round" section)

**Interfaces:**
- Consumes: `pipeline/.cache/derived/<v>/building-roofs.parquet` (Task 10), `pipeline/out/<v>/report.json`, a VITE_E2E preview build, and `window.__sfhMap.map` (`src/lib/map/debug.ts:17-18`).
- Produces:
  ```ts
  export interface ReviewView { id: string; name: string; center: [number, number]; zoom: number; pitch: number; bearing: number }
  export const REVIEW_VIEWS: ReviewView[];
  export function reviewStats(report: { counts: Record<string, number> }): ReviewStats; // src shares, reg distribution, fallback share, step/front counts
  export function sampleBuildings(roofs: RoofRow[], version: string, n: number): RoofRow[]; // seeded by md5(bid + version)
  export function renderReviewHtml(r: { before: string; after: string; views: ReviewView[]; sample: RoofRow[]; stats: ReviewStats; tiles: { before: number; after: number } }): string;
  ```
  CLI: `npx tsx scripts/building-review.ts --before <v> --after <v> [--out <dir>] [--sample 20]`. Both versions must already be in local R2 (`npm run data:local -- <before> --from <staging>` and `npm run pipeline -- upload <after> --local`).
  1. Build once with `VITE_E2E=1 npm run build`.
  2. For each version, start `npx wrangler dev --port 4174 --var ENVIRONMENT:development --var PUBLIC_DATASET_VERSION:<v>`, the way `playwright.bench.config.ts:26-34` swaps the version.
  3. Drive Chromium at 1280×800, DPR 2. For each view: `jumpTo` and wait for `idle`, as `e2e/map.spec.ts` `jumpAndIdle` does, then screenshot `[data-testid=map-root]`.
  4. Shoot the same for the `--sample` step buildings and 10 front buildings from the after version's `building-roofs.parquet` (zoom 17, pitch 65).
  5. Read both versions' `buildings.pmtiles` byte sizes from the server's `content-length`.
  6. Write `<out>/index.html` (before | after pairs per view, then the sample with a phantom-step checkbox column, then the stats table) and `<out>/stats.json`.
  The default `--out` is `pipeline/.cache/review/<after>/`. Stop each server on exit and on error.
  Views (approximate centres; the implementer nudges each so the named buildings are in frame; zoom 16–17, pitch 60–70):
  - `downtown-rincon`: Salesforce, 181 Fremont, Millennium, [-122.3955, 37.7895];
  - `transamerica-fidi`: [-122.4028, 37.7952];
  - `sutro`: [-122.4528, 37.7552];
  - `civic-center`: City Hall, [-122.4193, 37.7793];
  - `ferry-building`: [-122.3937, 37.7955];
  - `ucsf-parnassus`: [-122.4580, 37.7631];
  - `noe-false-fronts`: 24th–25th St / Noe–Sanchez, [-122.4310, 37.7505];
  - `outer-sunset-rows`: [-122.49858, 37.7542];
  - `presidio-heights-trees`: [-122.4490, 37.7895];
  - `russian-hill-slope`: [-122.4187, 37.8015].

- [ ] **Step 1: Write the failing spec** `scripts/building-review.spec.ts` (server project):
  - `REVIEW_VIEWS covers the spec's ten areas` (ids above, each pitch in [60, 70], zoom in [16, 17]);
  - `reviewStats` on a hand report: `src` shares sum to 1 ± 1e-9, fallback share = Σ `boxes.fallback.*` / `boxes.buildings`;
  - `sampleBuildings is stable per version and takes only step buildings`;
  - `renderReviewHtml` names both image paths per view, escapes `<` in names, and includes the tile bytes change as a percentage.
- [ ] **Step 2:** Run `npx vitest --run --project server scripts/building-review.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec. Expected: PASS. Smoke-run it on fixtures: `npx tsx scripts/building-review.ts --before fixture-0 --after fixture-0 --out <scratch>/review-smoke`. Expected: 10 view pairs written (fixture views mostly show empty map; this checks plumbing only) and the server stopped (`lsof -ti :4174` empty).
- [ ] **Step 5: Commit** `feat(scripts): add the building review capture script`.

### Task 13: Live LiDAR, parts, the first `boxes` run, build and measurements

This is the "see it work once" run. It is a long-running operator task: run everything in the foreground or wait on it, and do not hand back while a command runs.

- [ ] **Step 1:** Run `npm run pipeline -- doctor`. Expected: all required checks OK. `uv` and `lidar-python` must be OK here too, because this task fetches LiDAR.
- [ ] **Step 2: Fetch the LiDAR.**
  1. Run `npm run pipeline -- fetch --only usgs-lidar-sf --dry-run`. Record the tile count, node count and total points in `docs/dev/building-boxes.md`.
  2. Run `npm run pipeline -- fetch --only usgs-lidar-sf --jobs 16`. It takes hours and resumes on rerun. Expected: `usgs-lidar-sf: <n> file(s)`; `pipeline/lidar.lock.json` is written and `pipeline/sources.lock.json` is unchanged (`git diff --quiet pipeline/sources.lock.json`).
  3. Record the tile count, the total `bytes` and the wall time.
- [ ] **Step 3:** Run `npm run pipeline -- fetch --only overture-building-parts --release 2026-09-23.1`. That is the locked buildings release (`pipeline/sources.lock.json`, `overture-buildings` `upstreamVersion`), so footprints do not change. Expected: the `overture-building-parts` entry with that `upstreamVersion`.
- [ ] **Step 4:** Run `git merge origin/main` (if it changes `overture-buildings` in the lock, refetch the parts with the new release). Then run `npm run pipeline -- boxes`. Expected: the counts summary with `boxes.outside_footprint 0`, and a `building-boxes` entry in `sources.lock.json`. Record the wall time and the artifact's total bytes (the sum of the entry's `bytes`: this is what `fetch --restore` adds for everyone). If `boxes` takes over 60 minutes, move cluster batches onto worker threads (single-threaded on `--fixture`), the way `pipeline/steps/gross.ts:194` / `gross-worker.ts` use `availableParallelism() - 1`. Add a test that worker and single-thread artifacts have equal rows, then rerun.
- [ ] **Step 5:** Commit `pipeline/lidar.lock.json` and `pipeline/sources.lock.json`: `chore(pipeline): lock LiDAR rasters, building parts and the first building-boxes artifact`.
- [ ] **Step 6:** Run `npm run pipeline -- build`. Expected:
  - every invariant OK, V37 included, and no `boxes:` warnings in `report.json`;
  - V11's z12 bytes equal to main's within 1%;
  - `timings.render-boxes` in seconds, not minutes.
  Record `timings.render-boxes` and `timings.tiles`.
- [ ] **Step 7: Check that restore stays small.** `jq '.sources[] | select(.id == "usgs-lidar-sf")' pipeline/sources.lock.json` prints nothing. Record the artifact bytes from Step 4 as the whole addition to `fetch --restore`.
- [ ] **Step 8: Measure parts first** (spec "Measure first"). Query `pipeline/.cache/derived/<v>/building-roofs.parquet` with DuckDB:
  - buildings with `n_parts > 0`;
  - the share of those with `parts_coverage < 0.5`;
  - the `parts_coverage` p10/p50/p90.
  Find Sutro's bid as the nearest building to (-122.4528, 37.7552), then check in `render-pieces.parquet` that ≥ 90% of its `part` pieces carry its parcel id; record the result. Write all numbers into `docs/dev/building-boxes.md` "Live build".
- [ ] **Step 9:** Record the review stats from `report.json`:
  - share by `src`;
  - the registration distribution and the fallback share;
  - step and front building counts;
  - `tiles.buildings.bytes` against main's.
  Commit the docs: `docs: building boxes live build measurements`.

### Task 14: First round on staging

- [ ] **Step 1:** Run `npm run pipeline -- upload <v>`. On this first upload it also archives the LiDAR tiles, which takes a while. Then run `npm run pipeline -- verify <v> --origin https://sfhousing-staging.mindlace.net`. Expected: verify OK.
- [ ] **Step 2: Before/after review.**
  1. Get `before` from `curl -s https://sfhousing-staging.mindlace.net/attribution` (`Dataset version <code>…</code>`); fall back to Task 0's `base`.
  2. Run `npm run data:local -- <before> --from https://sfhousing-staging.mindlace.net` and `npm run data:local -- <v> --from https://sfhousing-staging.mindlace.net`.
  3. Run `npx tsx scripts/building-review.ts --before <before> --after <v>`.
  4. Open `index.html` and inspect every view and the sample, not the counts. Note phantom steps found in the sample and any anti-goal seen: a box outside its footprint, a cut-off facade, a phantom penthouse, confetti, a staircased pitched roof.
  Do not tune in this round; list the findings for the owner.
- [ ] **Step 3: Bench.** On a quiet machine run `SFH_BENCH_DATASET=<before> npm run bench:map`, then `SFH_BENCH_DATASET=<v> npm run bench:map` (`docs/dev/map-perf.md`; kill a stale :4173 first). Expected: p95 ≤ 16.7 ms on both. Add both rows to the Results table in `docs/dev/map-perf.md`. If the machine is busy, record ballpark numbers marked as such and keep going.
- [ ] **Step 4:** Commit `docs: building steps round 1 bench`. Then run `npm run signoff`. Expected: every step passes, `dataset` included. If `origin/main` moved, signoff's merge changes `<v>`: go back to Task 13 step 6 (and to step 4 first if the merge changed `overture-buildings`; `build` will say so).
- [ ] **Step 5:** Open the PR with `gh pr create --body-file <scratch>/pr-body.md`. The body holds:
  - the stats table and the bench rows;
  - the review findings and the review page (publish it as a private Artifact and link it);
  - the tuning loop from `docs/dev/building-boxes.md`.
  No attribution lines. Squash-merge after the signoff status is green.
- [ ] **Step 6:** Watch `deploy-staging.yml` succeed (`gh run list --workflow deploy-staging.yml --limit 1`). Then confirm that `https://sfhousing-staging.mindlace.net/attribution` shows `<v>` and that `/` at zoom 16 renders the new boxes downtown. Hand back to the owner for review on staging. Production moves only when the owner merges the release PR. Tuning rounds after this follow the documented loop and are owner-driven iterations, not plan tasks.
