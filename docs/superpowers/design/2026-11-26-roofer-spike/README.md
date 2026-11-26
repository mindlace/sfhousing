# roofer LoD2.2 spike (2026-11-26)

Question: does TU Delft's [roofer](https://github.com/3DBAG/roofer) (the 3DBAG engine; footprints + aerial point cloud → LoD1.2/1.3/2.2 meshes) give visibly better buildings than our LiDAR boxes ([building-boxes.md](../../../dev/building-boxes.md)), and what would adopting it cost?

**Short answer:** yes for ordinary buildings: houses and rowhouses get real gables and hips, and the roof error to the LiDAR roughly halves. No for landmarks: Sutro fails and Salesforce is messy. Tall glass towers get spiky walls. The compute and the licence are cheap. The real cost is leaving `fill-extrusion` for a custom mesh layer. Recommendation at the end.

## Setup

- **roofer v1.0.0**: the GitHub release has a prebuilt macOS arm64 binary (`roofer-macOS-arm64-v1.0.0.tar.gz`, with PROJ/GDAL data). It needed `chmod +x` and ran first time, so there was no build. There is no PyPI wheel (`roofer` on PyPI is an unrelated package) and no Homebrew formula. Set `PROJ_DATA`/`GDAL_DATA` to its `share/`.
- **Points**: `scripts/common.py` reuses the offset spike's EPT reader, reading the pipeline's node cache (`building-steps/pipeline/.cache/ept`) without writing to it. It writes per-set LAZ (EPSG:7131, 12 m pad).
- **Footprints**: Overture, projected to EPSG:7131 and moved by `shift_dx/dy` from `roofs.parquet`, written as GPKG with `bid`. A multipolygon is reduced to its largest polygon.
- **Gotcha:** the USGS `CA_SanFrancisco_1_B23` cloud has **no class 6**. Buildings are class 1 (unclassified, mixed with vegetation, cars and so on), so roofer runs with `--bld-class 1`. Classes present: 1, 2, 7, 17, 18.
- **Command:** `roofer --bld-class 1 --id-attribute bid --srs EPSG:7131 --lod12 --lod13 --lod22 pc/ footprints.gpkg out/` (`scripts/run_roofer.sh`). Output is CityJSONSeq.
- **`*_top` variant** (`scripts/topfilter.py`): keeps a class-1 point only if it is within 1.5 m of the highest class-1 point in its 1 m cell. It removes facade points, which break roofer's 2.5D roof assumption on towers. Default roofer is the plain set name.
- **Comparison** (`scripts/compare.py`):
  - Both models are put in the LiDAR frame. Our boxes are shifted; Overture parts stay unshifted, as in the pipeline.
  - **DSM fit**: the highest class-1 point per 0.5 m cell inside the footprint, at least 1 m above roofer's ground. Each cell is cast down onto the model, and we report RMSE and the share within 1 m.
  - **Triangles**: ours are counted as `fill-extrusion` draws them (top + walls). Roofer's are its full LoD2.2 solid.
  - **glb bytes**: plain trimesh export, float32, no quantisation or compression.
- Scripts are run in order: `prep.py` → `run_roofer.sh` → `topfilter.py` → `compare.py` → `zoom.py` → `profile.py` → `summarize.py` → `cost.py`. Numbers are in `results.json` and `cost.json`.

## Results

| set | bldgs | roofer outcome | roofer ms/bldg p50 / max | DSM RMSE m, median (roofer / ours) | DSM cells within 1 m (roofer / ours) | tris/bldg: roofer LoD2.2 (LoD1.3) / ours |
|---|---|---|---|---|---|---|
| Salesforce Tower | 1 | standard | 3462 | 31.6 / 73.7 | 21% / 6% | 5448 (4580) / 481 |
| Salesforce, `_top` | 1 | standard | 598 | 46.8 / 72.6 | 28% / 9% | 827 (651) / 481 |
| Sutro Tower | 1 | **LoD1.1 fallback** (flagged a glass roof) | 1 | 63.4 / 113.2 | 3% / 12% | 276 / 923 |
| Downtown (Fremont/Mission, 13) | 13 | standard 13 | 660 / 2213 | 3.52 / 4.53 | 73% / 52% | 871 (515) / 1370 |
| Downtown `_top` | 13 | standard 13 | 623 / 1863 | 2.57 / 4.49 | 80% / 54% | 736 (402) / 1370 |
| Noe Valley rowhouse block | 51 | standard 50, skip 1 (`pointcloud_unusable`) | 34 / 65 | 0.62 / 1.16 | 94% / 83% | 103 (61) / 52 |
| Rowhouse `_top` | 51 | same | 31 / 57 | **0.48 / 1.02** | 96% / 83% | 99 (55) / 52 |
| 20 detached pitched houses | 20 | standard 20 | 42 / 83 | 0.61 / 1.00 | 96% / 60% | 113 (52) / 28 |
| Detached `_top` | 20 | standard 20 | 38 / 81 | **0.34 / 1.00** | 97% / 61% | 107 (47) / 28 |

The detached houses are random pitched, isolated ones (nearest footprint over 2 m away, 70–400 m², registration `fit`), seed 20261126. The offset spike's own sample lives in its uncommitted `out/`.

### Per case

- **Detached houses** (`fig/detached_top.png`): clearly better. Gables, hips, cross-gables and dormers come through; ours are flat boxes at mid-roof. The `_top` RMSE is 0.34 m against our 1.00 m, and roofer wins on 17 of 20. One failure (#10, `fb7be4f5`): a tall spike from a tree over the house. Class 1 carries vegetation, and roofer has no mask like our `vegFracMin`.
- **Rowhouses** (`fig/zoom_rowhouse.png`, `fig/rowhouse_top.png`): better. Each house gets its own pitched or stepped roof, and rear stepping shows. False fronts come out as separate wall planes when the points support them, but not as cleanly as our `front` strips. Some tiny facets and slivers appear between houses. One house is skipped (unusable points).
- **Downtown podiums and towers** (`fig/downtown_top.png`, `fig/zoom_downtown.png`): mixed. Rooftop mechanical and setbacks are richer and the DSM fit is better (2.6 m against 4.5 m). But tall buildings get **spiky vertical slivers**: facade points from the oblique scan sit inside the footprint, and points from a neighbouring tower also reach into it. The top filter reduces this but does not remove it. On the map these would read worse than our clean boxes.
- **Salesforce Tower** (`fig/zoom_salesforce_raw.png`, `fig/salesforce.png`): a different failure from ours.
  - **The taper, measured** (`fig/salesforce_profile.png`): side elevations at one scale, plus plan area by height. For the LiDAR, plan area is the convex hull of the facade ring in each 4 m band. For a model, it is the cells whose top reaches that height.
    - **The LiDAR**: plan area is ~2,650 m² up to ~130 m. It then narrows smoothly: 2,480 m² at 200 m, 2,180 at 250, 1,850 at 280, 1,480 at 300 and 1,040 at 320.
    - **Ours**: 2,650 m² to 203.5 m, then a step down to ~640 m² up to 326 m. This is Overture's 8 `skillion` parts (height 326, roof_height 245), each drawn at mid-roof. Mean |area − LiDAR| is 544 m² over the whole height and 852 m² above 130 m.
    - **roofer, all points**: a full prism to ~250 m, then a taper from 250 to 325 m that follows the LiDAR well (ragged crown; roofer's own `rmse_lod22` is 22 m). It misses the gentle 130–250 m narrowing: the facade there is near-vertical, so the 2.5D top surface stays at the shoulder. Error is 183 m² over the whole height and 262 m² above 130 m, **a third of ours**.
    - **roofer, top-filtered** (`fig/zoom_salesforce.png`): a prism to ~290 m and only a crown. Error is 234 and 352 m².
  - **Verdict on the taper:** LiDAR-only reconstruction does better than our parts-at-mid-roof rendering. roofer gets the upper third of the taper; nothing gets the gentle lower part. In principle a 2.5D model can show a taper: seen from above, the tapered facade is a sloped "roof" ring. But roofer's plane fitting rounds the subtle part to vertical walls.
  - **The better fix is parts-driven.** The 8 skillion parts already encode the shape, sloping from 245 m at the outside to 326 m. Drawing each skillion as its true sloped surface (a mesh), or as `partTiers` inset tiers in `fill-extrusion` (add `skillion` to `partTierShapes`, with the tiers following the slope), would beat both. It costs nothing in LiDAR and needs no new renderer for the tiered version. Fixing `parts.ts` is cheaper and more faithful than adopting roofer for this building.
- **Sutro Tower** (`fig/sutro.png`): **fails as expected**. roofer flags `is_glass_roof`, forces LoD1.1, and extrudes the whole footprint triangle as a solid 127 m block. Our Overture parts (legs, decks, masts) are far better. Keep parts for lattices.

### Runtime and failures

- roofer is fast. Every set ran in 0–6 s wall time on 7 threads (`-j 8`); Salesforce took 3.5 s of reconstruction.
- Out of 87 buildings: 1 skipped (unusable points) and 1 forced to LoD1.1 (Sutro). The rest ran `standard` with `success=true`.
- The logs show repeated `skipping a hole for which no polygon exists` on downtown footprints with courtyards. It is harmless here.
- Points are dense: 60–480 pts/m² (towers count facade points). roofer thins to 20 pts/m² by default.

## Citywide cost (`scripts/cost.py`, `cost.json`)

Measured per m² of footprint in three area bins (<300, 300–1500, >1500 m²; samples 71/5/8), then applied to all 162,733 buildings (32.4 km² of footprint). The large bins rest on few samples: treat these as ±2× estimates.

- **Reconstruction**: ≈ 2.8 CPU-hours, about **12 minutes wall time on 14 threads**.
- **Point preparation**: a full pass over the EPT (13.1 G points) to make 7131 LAZ tiles. This spike's reader did ~1.3 M pts/s per thread, so about 2.8 CPU-hours, ~15 min on 15 cores, plus ~60 GB of LAZ. The `lidar-raster` fetch already does an equivalent pass (68 min including downloads), and roofer could share it.
- **Pipeline total**: well under the 54 min `boxes` already takes.
- **Triangles**: ≈ **21 M** for LoD2.2, about 130 per building on average (houses ~100, large buildings 700–5000).
- **Bytes**:
  - Naive glb: ≈ **525 MB raw / 210 MB gzip** (unindexed, float32).
  - With quantised positions + meshopt/Draco and per-tile merging, expect roughly 4–8× less, so **~60–130 MB** for the city.
  - Today's whole `buildings.pmtiles` is 27 MB.
  - As 3D Tiles (glTF/b3dm with a batch table carrying `parcelId`), a similar size plus the tileset JSON.
- **Licences**:
  - roofer is **GPL-3.0**. We would run it as a separate pipeline binary (subprocess, never linked or bundled), so our MIT code is unaffected. It would not go in `SOFTWARE` (`attribution.ts`), since that list is for bundle dependencies.
  - GPL does not cover a program's output.
  - The meshes derive from USGS LiDAR (public domain) and Overture footprints (ODbL), so they are an ODbL derived database, like `building-boxes` today. Credit roofer/3DBAG in the docs as a courtesy.

## Rendering on our MapLibre map (assessment, not built)

- **MapLibre `fill-extrusion`** (today) cannot draw sloped roofs. Only roofer's **LoD1.3** (flat, stepped roof parts) would fit the current layer, feature-state and tiles unchanged. That is close to what our boxes already are, so the gain is small. Its fit was not measured here (the table has triangle counts only).
- **MapLibre native model/mesh layer**: MapLibre GL JS has none. Mapbox GL JS v3's `model` layer is proprietary and not an option.
- **deck.gl** (`MapboxOverlay`, interleaved):
  - `Tile3DLayer` streams 3D Tiles. `SimpleMeshLayer`/`ScenegraphLayer` draw glTF.
  - It works and handles tiling, but adds a large dependency and a second render loop.
  - Hiding one building needs a custom shader hook or rebuilding per-tile meshes. There is no built-in per-feature visibility for meshes.
- **MapLibre custom layer (WebGL2; three.js or raw)**: the realistic option. Meshes are prebuilt per z14/z15 tile as glb, quantised in tile-local coordinates, with a per-vertex `parcelIdx` attribute. It shares MapLibre's depth buffer, so the generated buildings (still `fill-extrusion`) occlude correctly.
- **The `replaced` feature-state equivalent**: a small data texture (or uniform buffer) of hidden flags indexed by `parcelIdx`, updated when parcels are replaced. The vertex shader collapses or discards hidden vertices. That is one texture upload per change, with no re-tessellation.
- **Also needed**: picking (a colour-ID pass or CPU ray test), lighting to match the extrusion layer, a z12–13 fallback (keep today's boxes), CSP review for any worker/wasm decoder (meshopt is wasm), and `bench:map` budgets for ~21 M triangles. Only a few tiles are in view at z15+, but downtown tiles are dense.

## Recommendation

1. Do **not** adopt roofer as a drop-in replacement now. Its gains are real for ordinary buildings (~92% of buildings are under 300 m²). But it is worse for glass towers (spikes) and lattices (Sutro). For Salesforce it beats today's rendering (a third of the plan-area error) but still misses the lower taper, and drawing Overture's skillion parts properly is the cheaper fix. And it needs a new mesh rendering path. That rendering path is the expensive and risky part, not roofer.
2. If pitched roofs matter to the product, the next spike should be **rendering, not reconstruction**: a MapLibre custom layer drawing roofer LoD2.2 for one z15 tile of houses, with the parcel-hide texture and `bench:map` numbers. Pipeline adoption is cheap after that.
3. The pipeline shape, if adopted:
   - roofer runs after `fetch --lidar`, on registered footprints, with the top filter and a vegetation mask taken from our raster (`vegFracMin`).
   - Use roofer meshes only for buildings under ~1,500 m² that are not parts buildings, have `extrusion_mode=standard`, and have `rmse_lod22` under a threshold. Keep boxes and parts for towers, lattices and fallbacks.
   - It would add ~30 min to the artifact build and ~60–130 MB of compressed mesh tiles.

## Files

- Committed: `scripts/` (`common.py`, `prep.py`, `run_roofer.sh`, `topfilter.py`, `compare.py`, `zoom.py`, `profile.py`, `summarize.py`, `cost.py`), `fig/*.png`, `results.json`, `cost.json`.
- Not committed (scratchpad; large or regenerable): `…/scratchpad/work/<set>/{pc/*.laz, footprints.gpkg, out/*.city.jsonl, roofer.glb, ours.glb, compare.json, roofer.log}`, and the roofer binary in `…/scratchpad/roofer-dl/`. The scratchpad is `/private/tmp/claude-501/-Users-mindlace-Projects-sfhousing/4a870fac-1a89-4e85-ac67-87da80271fe0/scratchpad`.
