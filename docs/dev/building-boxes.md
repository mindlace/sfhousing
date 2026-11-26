# Building boxes

From z14 the existing-buildings layer draws each building as a few boxes taken from the 2023 USGS LiDAR: a base at the main roof, false fronts along street faces, steps (a tower over a podium, a penthouse), and mapped parts for landmarks. z12–13 keep the single box per building that the model uses, except that a building with `part` boxes draws them there too. The boxes are render-only: `pieces`, `parcel_out`, the chunks and every scenario file never see them. Design: `docs/superpowers/specs/2026-11-13-building-steps-design.md`; plan: `docs/superpowers/plans/2026-11-13-building-steps.md`.

## Three stages

| Stage                               | Reads                                                                                                                             | Writes and locks                                                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetch --only usgs-lidar-sf` (`uv`) | The EPT `CA_SanFrancisco_1_B23` point cloud                                                                                       | sfhl/1 tiles (0.25 m height above ground, 1 m ground, vegetation mask) in the raw cache, locked in `pipeline/lidar.lock.json` only. `fetch --restore --lidar` restores them from R2.          |
| `boxes`                             | The raw cache of `sources.lock.json` (footprints, `overture-building-parts`, parcels, streets, neighborhoods) and the LiDAR tiles | `boxes.parquet`, `roofs.parquet` and `inputs.json`, stored in the raw cache and locked as the `building-boxes` entry of `sources.lock.json`. Never writes it when a box leaves its footprint. |
| `build`                             | The `building-boxes` artifact only (never the tiles, never Python)                                                                | `render_boxes`, `render_pieces`, `render_export` beside `pieces`, and the z14+ tiles. See [pipeline.md](pipeline.md) "Building boxes in build".                                               |

`upload` archives the artifact under `sources/<sha256>` like any locked file, so `fetch --restore` brings it back on another machine; only `boxes` needs the LiDAR tiles. `npm run pipeline -- boxes --fixture` derives the mini fixture's artifact (see `pipeline/test/fixtures/mini/README.md`).

## `src` values and fallbacks

Each render box has a `src`:

- `base`: the main roof over the whole footprint, at mid-roof for a pitched roof (halfway from eave to ridge), at its level for a flat one.
- `front`: a false-front strip, `frontDepthM` deep along a street face, at the band's height.
- `step`: an interior region at least a storey above the main roof, from the base top up. A terrace of a sliced building is also a `step`, stacked on the level below: its `base_m` is that level's top, not the base top.
- `part`: a mapped Overture `building_part` with a height, from `min_height` to `height`, never shifted, unless the LiDAR disputes the building's parts (below: then none are drawn); a pyramidal, dome, cone or onion roof becomes `partTiers` inset tiers. Parts may leave the footprint (Sutro's legs).
- `box`: today's single box (`buildings.height_m`), drawn by `build` for every building the artifact has no box row for.

A building falls back to `box` (recorded in `roofs.parquet` `fallback`) when it is `elevated` (`base_m > 0`, e.g. a skybridge), has `no_lidar` (no tile or no finite cell under it), is a `new_building` (the interior reads as ground: built after the 2023 flight) or is `unreliable` (interior under `minInteriorM2`, or LiDAR coverage under `coverageMin`). In a parts building the area no counted part covers gets the LiDAR derivation; if that falls back, the area is dropped (`uncovered_dropped`), never drawn at `height_m`.

Every box of a parcel carries the parcel's `parcelId`, so the `replaced` feature-state (keyed by `promoteId`) hides all of them when a generated building replaces the lot.

## Parts the LiDAR disputes

Overture parts are mapped by hand and sometimes wrong (a skillion drawn at the wrong height, a part left from a demolished wing). `checkParts` (`pipeline/lib/lidar/dispute.ts`) compares each counted part's drawn top with the LiDAR before the parts are kept:

- A part is checked when it is at least `stepMinAreaM2`, not a tiered roof shape (`partTierShapes`), and still shows at least `stepMinAreaM2` once every taller part is subtracted. Its cells are the raster under that region at part + shift (parts stay unshifted; the mask samples at the registration shift).
- At least `coverageMin` of those cells must be raised (`raisedHagM`, not vegetation), else the part is not compared. The LiDAR height is their median above the footprint's ground.
- The part is disputed when its top differs from that height by more than `max(partTolM, partTolFrac × top)`.
- The building's parts are rejected when the disputed parts' union covers `partRejectShare` of the union of all counted parts. A rejected building takes the plain LiDAR derivation and draws no part boxes (none at all when that falls back, so `build` draws today's box); one disputed part among several good ones leaves the parts alone.
- Anything that cannot be compared is trusted: no registration (`none`), no ground, a tiered or small part, no raised cells.

The record is `parts_checked`, `parts_disputed` and `parts_rejected` in `roofs.parquet`; `boxes --probe` prints each part's verdict (see the tuning loop).

## Terraces

A building is sliced when its raised cells' p95 minus p5 is at least `taperMinRiseM`. It skips the main-roof stage (`flatRoof`, the pitched fit) and the step stage: the base box runs to the p5 and `terraceStage` (`derive.ts`) stacks terraces on it.

- Levels start at the base top and are `max(stepGapM, (p99 − base) / taperTiers)` apart, up to the p99.
- A level's regions are the cells at least `taperSampleFrac` of a band above the level, without rough cells (`taperRoughM`), opened, shaped as steps are and cut to the region of the level below they stand on.
- A region is a terrace from its level to the next; one with nothing on it ends at its cells' median.
- Merge: a region that is its parent's only child and keeps `taperMergeShare` of the area of the terrace being extended (where that terrace started, so 2% losses do not chain) extends that terrace instead of starting a new one. A smooth taper stays a few tall prisms, not `taperTiers` thin rings.
- The cap is `taperTiers × 2` terraces, largest area first; it is the building's `step_cap` (with `sliced`) in `roofs.parquet`. Fronts lose to terraces as they lose to steps.
- A terrace ring narrower than about 1.25 m does not survive the rough mask plus the opening, which is why the synthetic test scenes use 2 m setbacks.

## `BOXES` (`pipeline/boxes-config.ts`)

Starting thresholds, tier 4 (invented, tuned on the spike) unless noted. Metres unless the name says otherwise.

| Value                                                     | Controls                                                                                                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rasterResM` 0.25, `groundResM` 1                         | The tiles' height-above-ground and ground cell sizes.                                                                                                                |
| `tileSizeM` 500, `tilePadM` 20                            | Tile edge and the overlap rasterized around it. Raster values are in the LiDAR lock's `upstreamVersion`: changing them means re-fetching the tiles.                  |
| `vegFracMin` 0.35                                         | A cell over 1 m is vegetation when this share of first returns in its 5 × 5 window come from multi-return pulses (classes 3–5 always are).                           |
| `regSearchM` 3, `regStepM` 0.1                            | Registration search window (±) and grid step per footprint cluster.                                                                                                  |
| `regTouchM` 1.5                                           | Footprints this close join one cluster (one rigid shift per cluster).                                                                                                |
| `regSampleStepM` 0.2, `regMaxSamples` 2000                | Edge samples along each cluster's rings, and their cap (larger clusters are strided).                                                                                |
| `regAmbiguousRatio` 0.85, `regSecondPeakM` 1              | A fit is ambiguous when the best score farther than `regSecondPeakM` from the peak reaches this share of the best.                                                   |
| `regPeakFloor` 0.75                                       | A fit is also ambiguous when the refined peak scores under this share of the best cell (the peak fell between two maxima).                                           |
| `regFrames`                                               | The two OSM frame offsets tried when a fit is ambiguous, tier 2 (measured on the spike): `frame-nad83` (0.0, +0.24), `frame-wgs84` (+1.24, −0.32).                   |
| `marginM` 0.3                                             | Inset of the footprint before sampling: the outline error left after registration.                                                                                   |
| `frontBandM` 2, `frontPct` 0.9                            | False-front band depth from the street face, and the quantile of its heights compared with the base top.                                                             |
| `frontRiseM` 1                                            | How far that quantile must stand above the base top to make a front (also the trimmed roof refit's tolerance).                                                       |
| `frontDepthM` 0.5                                         | The front strip's depth.                                                                                                                                             |
| `frontMinFaceM` 3, `frontFaceAngleDeg` 15                 | A street face: a run of edges turning less than this, at least this long.                                                                                            |
| `frontStreetM` 30, `frontFacingCos` 0.7                   | A face counts as street-facing when a public centreline lies within this distance along its outward normal (cosine at least this).                                   |
| `stepMinAreaM2` 20, `stepGapM` 2.5                        | A step must be this large and this far above the main roof.                                                                                                          |
| `stepCap` 4                                               | Steps kept per building (largest area × rise first); more sets `steps_capped`. V37 fails above it (a sliced building's cap is `taperTiers` × 2).                     |
| `treeRoughM` 1                                            | Height roughness that marks tree-like cells, never steps or fronts.                                                                                                  |
| `roofBinM` 0.5, `roofMainShareMin` 0.25                   | The roof histogram's bin, and the share a level needs to be the main roof (else the largest).                                                                        |
| `raisedHagM` 1.5                                          | Cells at least this high above ground count as building.                                                                                                             |
| `pitchMinRiseM` 1, `pitchMinSlope` 0.18, `pitchMinR2` 0.6 | A roof is pitched when its plane fit rises this much, this steeply, with this fit.                                                                                   |
| `pitchSlopeSigmaCells` 2, `pitchSlopeShareMin` 0.5        | And when the median local slope (Gaussian-smoothed) is at least this share of the fitted one: a stepped roof fits a plane but is flat almost everywhere.             |
| `groundShareMin` 0.8                                      | Interior cells reading as ground at this share make a `new_building`.                                                                                                |
| `coverageMin` 0.5                                         | Finite LiDAR cells needed under the interior (else `unreliable`) and in a front band (else no front).                                                                |
| `minInteriorM2` 4                                         | Smallest interior (and raised area) worth deriving.                                                                                                                  |
| `partTiers` 5, `partTierShapes`                           | Tiers per tiered part roof (spec 4–6) and the roof shapes that get them.                                                                                             |
| `partSliverM` 0.05                                        | The uncovered area of a parts building loses slivers under twice this wide (part and footprint edges differ by mm after the lng/lat round trip).                     |
| `taperMinRiseM` 40, `taperTiers` 16                       | A building is sliced into terraces when its raised cells' p95 − p5 reaches the rise; the levels' band is max(`stepGapM`, rise / tiers) and the cap `taperTiers` × 2. |
| `taperMergeShare` 0.98                                    | A lone child keeping this share of its parent terrace's area extends the terrace instead of starting a new one.                                                      |
| `taperRoughM` 1, `taperSampleFrac` 0.5                    | The roughness that excludes cells from a terrace level, and how far into a band above a level a cell must stand to belong to it.                                     |
| `partTolM` 5, `partTolFrac` 0.1                           | A part is disputed when its top differs from the LiDAR's median by more than `max(partTolM, partTolFrac × top)`.                                                     |
| `partRejectShare` 0.25                                    | The parts are rejected when the disputed ones cover this share of all parts' area.                                                                                   |
| `splitZoom` 14                                            | The first zoom of the render boxes in `buildings.pmtiles`.                                                                                                           |
| `heightRangeM` [2.5, 340]                                 | Box heights are clamped to it and rounded to 0.1 m.                                                                                                                  |

## The artifact and its recorded inputs

`building-boxes` is a `sources.lock.json` entry with three files, `derived:` URLs and licence ODbL-1.0:

- `boxes.parquet`: `bid, k, src, base_m, height_m, geom` (WKB, EPSG:7131; NULL for a base over the whole footprint), ordered by bid, k. Fallback buildings have no rows.
- `roofs.parquet`: one row per building: `roof` (`flat`, `pitched`, `unknown`), `eave_m`, `ridge_m`, `ridge_deg`, `ground_m` (median ground under the footprint) and `ground_min_m` (lowest), NAVD88; the registration `shift_dx`, `shift_dy`, `shift_source` (`fit`, `zero`, `frame-nad83`, `frame-wgs84`, `none`), `reg_score`, `reg_ratio`, `reg_sharp_x`, `reg_sharp_y`, `reg_flagged`, `cluster_id`; `fallback`, `n_front`, `n_step`, `steps_capped`, `n_parts`, `parts_coverage`, `uncovered_dropped`; the parts check `parts_checked`, `parts_disputed`, `parts_rejected`; the terraces `sliced` and `step_cap` (this building's cap: `stepCap`, or `taperTiers` × 2 when sliced); and `lng`, `lat`.
- `inputs.json`: the full sha256 of every recorded input.

The entry's `upstreamVersion` (`boxes/2 code=… config=… overture-buildings=… …`) carries 12-hex prefixes of the same inputs, so `build` checks them from the lock alone:

- **Gate** (`build` stops before writing anything, naming `npm run pipeline -- boxes`): `overture-buildings` and `overture-building-parts`. Boxes from other footprints would sit on the wrong buildings.
- **Warn** (live builds only, in `report.warnings`): `usgs-lidar-sf` (from the LiDAR lock), `datasf-parcels`, `datasf-streets`, `datasf-neighborhoods`, the boxes code hash (`boxesCodeHash` over `BOXES_CODE_PATHS` in `pipeline/lib/version.ts`) and the `BOXES` config hash. The boxes are still valid footprint for footprint; they are just not the newest derivation.

The boxes code stays under `pipeline/`, inside the dataset-version hash, although `build` never runs it. "Everything under `pipeline/` is hashed" needs no exclusion list; a misfiled exclusion could let code that `build` reads change without a version change, and `upload` would then refuse the rebuilt version (V13) while staging served the old bytes. The cost is that a boxes-only edit needs a dataset upload, which the tuning loop does anyway.

## Derived files

`build` writes two review files to `pipeline/.cache/derived/<v>/` (build-internal, never uploaded):

- `building-roofs.parquet`: a copy of the artifact's `roofs.parquet`.
- `render-pieces.parquet`: `render_pieces` (GeoParquet, EPSG:7131): `bid, k, src, parcel_id, geom, area_m2, base_m, height_m, hs, ground_m, ground_min_m`.

Query them with DuckDB, for example in `duckdb` (load `spatial` for the geometry):

```sql
SELECT fallback, count(*) FROM read_parquet('pipeline/.cache/derived/<v>/building-roofs.parquet') GROUP BY 1;
SELECT bid, n_step, steps_capped FROM read_parquet('pipeline/.cache/derived/<v>/building-roofs.parquet') WHERE n_step > 0 ORDER BY n_step DESC LIMIT 20;
SELECT src, count(*), round(sum(area_m2)) FROM read_parquet('pipeline/.cache/derived/<v>/render-pieces.parquet') GROUP BY 1;
```

## Tiles

`writeBuildingsTiles` (`pipeline/steps/tiles.ts`) writes one `buildings` layer. With the artifact it runs tippecanoe twice and joins the two archives with `tile-join -pk`: `buildings.geojsonseq` holds the `low_export` features (a building with `part` render boxes as those boxes, every other building as its `buildings_export` row; `76_render_boxes.sql`) with `"tippecanoe": {"minzoom": 12, "maxzoom": 13}` and today's four properties (`parcelId`, `heightM`, `baseM`, `hs`), so `z12BuildingsMax` holds and a building without parts is unchanged at z12–13 (the input is ordered by `parcel_id, bid, k`); `boxes.geojsonseq` holds the `render_export` features with minzoom 14, maxzoom 15, adding `src`, `groundM` and `groundMinM` (each left out when null). z16 and up overzoom z15. Without the artifact the tiles input and arguments are exactly as before, and `buildings.pmtiles` is byte-identical (`tiles.test.ts` checks it against `pipeline/test/fixtures/mini/tiles-no-boxes/`). The style is unchanged: one `existing-buildings` fill-extrusion layer, source layer `buildings`, `promoteId` `parcelId`; nothing styles by `src`.

`--drop-smallest-as-needed` silently drops the smallest features of a tile over the byte limit. The two runs exist because the zooms need different limits. z12–13 keep main's 400 KB: main's downtown z12 tiles already exceed it and drop their smallest buildings, and a 1 MB limit there doubled the z12 bytes (1.57 MB against 0.78 MB, V11's first paint). The z14+ run uses `SPLIT_MAX_TILE_BYTES` (1 MB): the first live build put 13 of 52 z14 tiles over 400 KB (largest 680 KB, downtown; z15 at most 209 KB). The step counts tippecanoe's tile-too-big reports at z14 and up (`tiles.buildings.drops_z14plus`); any such drop fails V37. If z14 tiles outgrow 1 MB, move `splitZoom` to 15 rather than raising the limit again.

Drawing parts at z12–13 costs bytes and could cost buildings, so it is gated: against the before archive, z12 bytes may grow by at most 60,000 and the parcels still drawn at z12 may fall by at most 1% (`scripts/low-zoom-gate.ts`, see Review a round). `tiles.buildings.z12_parcels` and `z13_parcels` are the report's two counts; V37 does not read them.

## Counts and V37

The report's `boxes.*` and `render.*` counts are listed in [pipeline.md](pipeline.md) "Building boxes in build"; the parts check adds `boxes.parts.checked`, `boxes.parts.disputed` (parts) and `boxes.parts.rejected` (buildings), and the terraces `boxes.step.sliced` and `boxes.step.over_cap`. The tiles step adds `tiles.buildings.drops_z14plus`, `tiles.buildings.z12_parcels` and `tiles.buildings.z13_parcels` (distinct `parcelId`s decoded at those zooms, `parcelIdsAtZoom`; with the artifact) and, on live builds, `tiles.buildings.bytes` (tippecanoe's bytes vary by platform, so the fixture report leaves it out).

V37 "render boxes": without the artifact it is OK with `no boxes artifact`. Otherwise it passes iff `boxes.outside_footprint` is 0, `boxes.missing_buildings` is 0, `boxes.step.over_cap` is 0 (each building's `n_step` is at most its `step_cap`: 4, or 32 when sliced) and, unless tiles were skipped, `tiles.buildings.drops_z14plus` is 0. Its detail is `src box/base/front/step/part <n>/<n>/<n>/<n>/<n>; fallback <share of buildings>; reg fit <share of clusters>`, after any problems.

## Tuning loop

1. Once per machine: `npm run pipeline -- fetch --restore`, then `npm run pipeline -- fetch --restore --lidar`.
2. Edit `BOXES` in `pipeline/boxes-config.ts`.
   - 2b. Try the values on named buildings first: `npm run pipeline -- boxes --probe <bid,bid,…|@file>` derives only the clusters holding those buildings, prints one JSON line each (`fallback`, `nParts`, `partsChecked`, `partsDisputed`, `partsRejected`, `sliced`, `nStep`, `topM` and each part's verdict) and writes nothing, neither the artifact nor the lock. Unknown ids are named on stderr and skipped; `@file` reads one id per line.
3. `npm run pipeline -- boxes`. The `building-boxes` entry in `sources.lock.json` changes.
4. Commit the config and the lock.
5. `npm run pipeline -- build`, then the review script ([Review a round](#review-a-round)).
6. `npm run pipeline -- upload <v>`, then `npm run signoff`, open the PR and merge. Staging deploys; the owner reviews there.

After any Overture refresh (`fetch` of `overture-buildings`), run `boxes` before `build`: `build` refuses a stale artifact.

## Review a round

`npx tsx scripts/building-review.ts --before <v> --after <v> [--out <dir>] [--sample 20] [--roofs <parquet>]` builds once with `VITE_E2E=1`, serves each version with `wrangler dev` on port 4174 (stopped on exit and on error) and captures the map canvas alone (1280x800, DPR 2) for the ten review areas and for a seeded sample of step and false-front buildings from `building-roofs.parquet`. Both versions must be in local R2 (`npm run data:local -- <before> --from <staging>`; `npm run pipeline -- upload <after> --local`). It writes `index.html` (before | after pairs, the sample with a phantom-step checkbox column, the stats) and `stats.json` to `pipeline/.cache/review/<after>/` (gitignored). Nudge a view's centre in `REVIEW_VIEWS` when its named buildings are out of frame.

- `--bids a,b,c` captures those buildings first (zoom 17, pitch 65, as the sample; an id not in `roofs` fails the run) and drops them from the random sample.
- `npx tsx scripts/low-zoom-gate.ts --before <pmtiles> --after <pmtiles> [--inspect <lng,lat>]` compares two built `buildings.pmtiles` files: z12 stored bytes may grow by at most 60,000 and the z12 parcels may fall by at most 1% (exit 1 otherwise; z13 parcels are shown for information). `--inspect` lists the after archive's z13 features of the tile holding the point (`parcelId heightM baseM`) and their count.
- The roofer spike's `profile.py` (`docs/superpowers/design/2026-11-26-roofer-spike/scripts/`) profiles any artifact: `SFH_BOXES=<boxes.parquet> SFH_ROOFS=<roofs.parquet>` point it at the files (for example `pipeline/.cache/raw/<sha>`); unset, it reads the spike's own copies.

## Live build

The first city run, 2026-11-14, on one machine (15 cores). The build is dataset `2026-11-14-0135312a`, on Overture `2026-09-23.1`.

**LiDAR fetch.** `fetch --only usgs-lidar-sf --dry-run` covers BBOX with 1,190 tiles. 1,056 of them touch EPT nodes over their padded area. Together they read 319,021 distinct nodes and 13,081,261,467 points, almost the whole EPT (13,088,433,078 points). Summed per tile, the padding counts shared nodes twice: 437,186 nodes and 17.9 billion points. The full fetch with `--jobs 16` took 68.5 minutes. It started from the spike's node cache, which held 3.4% of the points. It downloaded about 57 GB of EPT nodes (`pipeline/.cache/ept`, 59 GB in all). It wrote 648 tiles with points, 2,334,955,420 bytes in all (`pipeline/lidar.lock.json`). The rasterizer's work dir is 7.6 GB.

**Parts and boxes.** `overture-building-parts` at `2026-09-23.1` has 1,647 rows (345 KB). `boxes` took 54 minutes (3,240 s) on a busy machine, single-threaded, under the 60-minute bar for worker threads. The artifact is 21,507,477 bytes: `boxes.parquet` 11,887,785, `roofs.parquet` 9,618,995 and `inputs.json` 697. That is the whole addition to `fetch --restore`, since the LiDAR tiles stay out of `sources.lock.json`.

**Build.** `render-boxes` took 11.5 s and `tiles` 28.2 s (the whole build 4.4 minutes). Every invariant passes:

- V11's z12 buildings bytes are 783,877, equal to main's (`2026-11-10-6ee5a23d`).
- V37: `src box/base/front/step/part 1365/161301/38903/15405/994; fallback 0.8%; reg fit 89.3%`, and no z14+ tile drops.
- `buildings.pmtiles` is 27,140,298 bytes, against main's 16,421,419 (+65%).
- Without a limit, the 52 z14 tiles measure p50 194 KB and at most 680 KB, with 13 over 400 KB. The 169 z15 tiles reach at most 209 KB.

**Counts.** There are 162,733 buildings: 161,301 with LiDAR boxes, 1,365 drawn as today's box and 210 with parts. Fallback buildings are 0.84% (1,371): 976 `new_building`, 374 `unreliable`, 12 `elevated` and 9 `no_lidar`. Six parts buildings dropped an uncovered area. By rendered box, `src` is base 74.0%, front 17.9%, step 7.1%, box 0.6% and part 0.5% (217,968 boxes; 450,346 pieces after the parcel clip). Steps are on 12,823 buildings (15,405 boxes; 214 capped at 4). Fronts are on 29,930 buildings (38,903 boxes). Roofs are 137,210 flat, 24,091 pitched and 1,432 unknown.

**Registration.** 33,671 clusters have LiDAR:

- outcomes: `fit` 89.3% (30,059), `frame-wgs84` 5.5% (1,842), `frame-nad83` 2.9% (961), `zero` 2.4% (803), `none` 6;
- 10.7% are flagged (ambiguous fits that fell back to a frame, zero or none);
- fitted shifts: p10 0.23 m, p50 0.65 m, p90 1.81 m, max 4.06 m (a corner of the ±3 m window);
- over all clusters with a shift: p50 0.65 m, p90 1.76 m; `reg_ratio` p50 0.626, p90 0.846.

**Parts first.** 210 buildings have counted parts. 70 of them (33.3%) have `parts_coverage` under 0.5. Coverage is p10 0.185, p50 0.730 and p90 1.0. Sutro Tower is bid `c5cbfced-fe3d-43ce-9d7a-63302127f0f9`: its footprint holds the point (-122.4528, 37.7552), with 34 parts and coverage 0.993. All 34 of its `part` pieces (100%) carry parcel `2724003`, and its top is 298 m. Its uncovered sliver fell back `unreliable` and is dropped. The building whose point-on-surface is nearest that point is a different, 14 m² shed (`f13e7d30-…`). So find landmarks by footprint distance, not by `lng`/`lat`.

## The spike's frames

The registration design comes from a spike on 2026-11-13 (462 detached buildings and 3 rowhouse blocks; scripts, `models.json` and figures in `docs/superpowers/design/2026-11-13-offset-spike/`):

- OSM footprints, most of Overture's SF geometry, sit in two frames interleaved building by building: about NAD83, offset (0.0, +0.24) m, and about true WGS84, offset (+1.24, −0.32) m (roughly the NAD83→WGS84 datum shift), with about 0.5 m of tracing noise on top. These are `regFrames`.
- Height and position explain none of the offset: the best footprint-only predictor puts 37–50% of buildings within 0.3 m. So each cluster gets its own fit.
- Per-house fits are ambiguous on rowhouse blocks (about 66% of houses in one block); one rigid fit per block is clear, with the median edge gap falling to 0.25–0.30 m. Hence clusters and `marginM`.
- DataSF footprints (`ynuv-fyni`) sit in one tight low-rise frame, about (+1.11, −0.33) m; not used.
