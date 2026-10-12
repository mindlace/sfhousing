# Existing-building rooflines design

Date: 2026-10-11

Status: Approved by the user on 2026-10-11. Local implementation and scoped validation are complete; citywide processing and release gates remain open. See the [current checkpoint](../../dev/rooflines.md#current-checkpoint-and-coverage) and [bounded citywide follow-up](2026-10-12-citywide-roof-streaming-design.md).

## 1. Intent and decisions

Make the simulator's existing buildings look less homogeneous and show recognizable roof slopes, height changes, and occasional landmark silhouettes. The target is a plausible map-scale exterior, not an accurate survey, photorealistic city, or architectural inventory.

The user approved the local LiDAR-plus-aerial spike. Keep its useful approach: footprints constrain buildings, LiDAR supplies roof geometry, and aerial imagery provides evidence for excluding vegetation. Prefer simple measured roof sections over numerous small planes. Use the existing footprint extrusion whenever a usable model cannot be produced or displayed. Preserve enough provenance and failure information to revisit those buildings later.

**Flat ground is a requirement.** Elevation data may establish relative building heights during processing, but must not introduce terrain into the map. Roof models are display data only: they do not alter housing totals, existing units, eligibility, zoning, generated massing, or saved-plan calculations.

“Untested blocks” means neighborhoods outside the spike samples, not specifically buildings constructed after 2023. Additional sampling informs quality and fallback rates; it is not a requirement to model every neighborhood successfully before shipping. Post-capture construction and changed footprints are separate reasons to retain a fallback.

### Scope

- Offline reconstruction and quality checks for the existing-building dataset.
- Versioned roof meshes, compact runtime metadata, and detailed audit records.
- Integration with MapLibre/deck.gl, including loading, parcel replacement, picking, themes, and graceful fallback.
- One explicit landmark override for the previously approved Salesforce silhouette.
- Repeatable local review, fixtures, reporting, and normal dataset publication.

### Non-goals

Terrain; interiors; facade textures, windows, or materials; aerial photogrammetry; a trained vision model; automatic reconstruction from Google or Apple Maps; a complete catalogue of named roof templates; a general landmark editor; changes to the typology generator or simulation model. Overture building parts are not a new mandatory source: the spike showed too little benefit to justify that dependency.

## 2. Evidence and selected approach

The spike contains 45 low-rise buildings in Mission/Noe Valley and Salesforce Tower. Its combined result reduced low-rise roof polygons from 216 to 102. At Whole Foods, 3950 24th Street (`3016508c-f86a-46dd-b8b9-869ee552395f`), the result went from 27 roof polygons to 3 and retained the real raised rear roof. Maximum above-base height fell from 19.59 m to 11.191 m. The same simplification without the vegetation mask remained 19.698 m high. Two major pitched roofs needed a detail-preservation guard. The earlier corner-spike case, `a96b2333-08e3-4167-b7d6-6b21ba3ad017`, remains a regression example.

These are observed sample results, not citywide accuracy or vegetation-classification claims. The filter was tuned on the samples, and validation returns were also used for model selection. Some minor roof detail was intentionally lost.

| Approach | Assessment |
| --- | --- |
| Simplified LiDAR roofs with aerial-assisted vegetation rejection | Selected. Demonstrated roof variety and removal of the observed tree protrusions; fits an offline static-data architecture. |
| LiDAR alone | Supported when imagery is unavailable and the model passes conservative checks. Simplification alone did not fix Whole Foods. |
| Imagery-based roof reconstruction or a full roof-template fitter | Deferred. Consider only if measured failure reports identify a worthwhile improvement; neither is necessary for the approved visual result. |

The throwaway viewer is not production code. Implementation must extract small reproducible regression fixtures and reimplement its behavior within the repository's pipeline and map boundaries. The local research archive is `roofline-spike/reproduction` beside the earlier `exterior-spike` artifact; the spike README records inputs, parameters, and limitations.

## 3. Fit into the existing system

The current pipeline builds Overture footprints, fills heights, clips buildings to parcels, and exports `buildings.pmtiles`. MapLibre renders the extrusions. `GeneratedController` replaces existing geometry by parcel id, and parcel chunks feed simulation calculations. All geographic artifacts are immutable under `/data/<datasetVersion>/`.

Add a roof-processing stage after full-building footprints and fallback heights are available, before parcel clipping. Reconstruct each full building once; then split its visual mesh at the same parcel boundaries as the existing footprint pieces. Publish roof artifacts alongside the unchanged fallback geometry. Do not change parcel chunk records or the simulation protocol to carry roofs.

```text
locked footprints + fallback heights + LiDAR + optional aerials
                       ↓
             full-building roof candidates
                       ↓
            validation / selection / fallback
                       ↓
       parcel-clipped meshes + per-building audit records
                       ↓
           immutable roof chunks and index
                       ↓
   existing map overlay, using the same parcel replacement state
```

Separate responsibilities:

- Pipeline acquisition: locked, archived inputs and source metadata.
- Roof processing: vegetation evidence, reconstruction, selection, geometry checks.
- Export/shared codec: piece identity, clipping, chunking, deterministic encoding.
- Map roof controller: viewport loading, cache, render installation and eviction.
- Existing-building visibility adapter: consistent parcel replacement and roof readiness for tiles and meshes.

Initial processing uses Python geometry/point-cloud tools plus **roofer 1.1.0-beta.1**, called from the existing TypeScript pipeline. Python dependencies and the executable/toolchain are pinned; they never ship in the Worker or browser. The production renderer uses the existing deck.gl/luma.gl stack and offline-triangulated meshes, not the spike's Three.js viewer.

Pin amendment (2026-10-12, controller ruling): official prerelease 1.1.0-beta.1,
commit `1c06fb1aed9096f4b16f894c2da12bc2d785b71b`, supersedes only the initial 1.0.0
tool pin to address measured native reconstruction nondeterminism under §7. The committed [toolchain and evidence summary](../../dev/rooflines.md#toolchain-and-rights) records three-repeat sampled Mac decoded candidate/selection reproducibility. Raw native
ordering and surface metadata still vary; Linux execution and citywide determinism remain
unproved. Explicit CLI policy is `--cj-scale .0001 .0001 .0001`,
`--min-building-density 1`, `--unit-scale 1`, and `--jobs 1`. All flat-ground,
source-coverage, support, complexity, QA and fallback requirements below remain in force.

## 4. Sources, versions, and reconstruction

### 4.1 Inputs and reproducibility

Use the current Overture building source and fallback height rules. Initial measured geometry uses USGS `CA_SanFrancisco_1_B23` LiDAR, acquired in spring 2023. Initial aerial filtering uses SF Planning's 2023 `p2023_rgb8cm` RGB service, matching the year of the LiDAR. Matching years do not prove matching capture dates or exact image alignment.

Extend `pipeline/sources.lock.json` with the precise LiDAR objects/extractions and aerial tiles needed by the selected coverage. Record SHA-256, original URL, acquisition/release dates where known, retrieval time, horizontal/vertical CRS, units, license/attribution, and archive keys. Preserve source tile identity and point ordinal when extracting LiDAR. Do not use an unpinned live service during `build`.

Fetch and archive only the required coverage, including a support buffer; never download the whole point cloud unnecessarily. Restore must be able to rebuild without the upstream services. Record explicit unavailable coverage rather than silently treating it as a measured building. Newly fetched sources, processing parameters, tool versions, and overrides must affect `datasetVersion`; roof processing code and configuration live under the already-hashed `pipeline/` and shared codecs under `src/lib/data/`.

The public SF imagery service's metadata did not establish redistribution/derivation terms during the spike. Record confirmed permissions before including that source in a published roof build. If unavailable, use conservative LiDAR-only reconstruction or footprint fallback and record the reason. Do not replace this with Google/Apple imagery extraction. Aerial pixels and raw point clouds are not browser runtime assets. Exported roof data follows the dataset's existing ODbL derivative-database obligations, with source-specific credits preserved in the manifest and attribution page.

### 4.2 Relative heights and support

Process horizontal geometry in EPSG:7131 and preserve the LiDAR vertical datum in the audit inputs. Determine a building's ground reference from class-2 ground returns: fifth percentile within a 4 m footprint buffer, or a documented nearest-ground estimate within 50 m. If neither is available, fall back. Exclude noise classes 7 and 18. For this source, class 1 includes both building and vegetation returns; it is not a reliable building label.

Subtract the measured ground reference from roof/wall elevations and place the building on the flat map. Existing fallback `heightM`, `baseM`, and `hs` retain their current meaning; a source's explicit structural `baseM` is not terrain. Clamp only numerical negative values within 0.1 m to zero. A candidate requiring a larger below-ground correction fails validation instead of burying a building or silently changing its height.

Use a stable 80/20 training/validation split: hash the ASCII string `<source-file-sha256>:<original-point-ordinal>` with SHA-256; interpret its first four bytes as an unsigned big-endian integer and reserve points where that integer modulo 5 is zero for validation. Canopy decisions and roof fitting use training returns only. Validation points may choose between candidates; report them as selection diagnostics, not an independent test set. The exact split rule is versioned and invariant to batch order.

### 4.3 Aerial-assisted vegetation rejection

Start with the demonstrated heuristic, in versioned configuration:

1. RGB candidates: `2G-R-B > 15`, `G > 0.85R`, `G > 1.15B`, `G > 25`, and `(max(R,G,B)-min(R,G,B))/max(max(R,G,B),1) > 0.28`.
2. At the spike's zoom-19 raster sampling, close by 2 pixels and dilate by 5 pixels (approximately 0.6 m on the ground). Store actual raster transforms and use equivalent ground distances if sampling changes.
3. Evaluate 0.5 m XY cells using training-only local PCA roughness from up to 48 nearest 3D returns. A green cell must have 90th-percentile roughness above 0.06 m or vertical spread above 1.5 m.
4. Also require its 90th-percentile elevation to exceed nearby smooth roof support by more than 2 m. Support is the median elevation of up to 32 nearest smooth nongreen returns, with median XY distance below 6 m; smooth means PCA roughness below 0.025 m. If fewer than 32 nongreen smooth returns exist, use smooth returns regardless of colour. With no usable support, reject no returns from that cell.
5. Reject class-1 returns in accepted canopy cells. Retain ground returns. Apply the derived mask to validation points only for comparable diagnostics.

Sparse neighborhoods, empty inputs, and raster boundaries must be handled explicitly: no PCA with fewer than 3 neighbors, no out-of-image clamping that borrows edge pixels, and no invented canopy decisions where imagery has no coverage. Record those limitations. Green roofs, shadows, parallax, roof equipment, and date differences remain known confounders. The algorithm must remain replaceable without changing runtime mesh consumers.

### 4.4 Candidates and selection

Fit planar pitched/stepped roofs with roofer LoD2.2, supplied ground references, `--no-clip-terrain`, complexity factor **0.4**, and minimum plane support **50**. Produce a higher-detail reference from the same filtered training cloud using roofer's pinned 1.1.0-beta.1 reference settings (complexity factor **0.888**, plane support **15**) for detail preservation. Any defaults relied upon are captured explicitly in the processing configuration/tool report.

Prefer the simpler valid candidate. Preserve the reference when a substantial pitched roof is flattened and validation roof MAE worsens by more than **0.25 m**, provided the reference passes the same artifact checks. For this guard, “substantial pitched” means more than 35% of plan-projected roof area has slope above 8°. This is a processing diagnostic, not a verified architectural label. Evaluate both candidates on the same retained highest validation returns in 0.5 m cells inside a 0.5 m inset footprint; record sample size and coverage, and never treat missing diagnostics as zero error.

Reject unstable high caps rather than smoothing every roof indiscriminately. A roof patch whose projected area is below `max(0.25 m², 0.005 × footprint area)` and whose top is more than 2 m above an adjacent larger roof patch is a spike candidate. For this check, adjacency means projected boundaries within 0.1 m, and compare the patches' maximum heights. Try a bounded reconstruction retry with complexity factor **0.6**; accept only if the cap is removed, geometry remains valid, and validation MAE worsens by no more than **0.05 m**. Otherwise retain another valid candidate or fall back. Record the detection and attempted remedy. This intentionally sacrifices uncertain small chimneys/equipment in favor of stable rooflines.

Minimum acceptance checks:

- Finite coordinates and positive-area triangles; valid indices and outward-consistent faces.
- At least 98% of the retained footprint area covered by roof projection; courtyard holes remain holes.
- At least 50 retained training roof returns and 20 retained validation samples; roof validation coverage at least 95%. With fewer samples, record insufficient support and fall back. Explicit landmark overrides instead use their recorded authoring evidence and all applicable mesh/footprint checks.
- No unresolved spike candidate or below-ground correction beyond the permitted tolerance.
- Maximum height between 2.5 m and 340 m; additionally, an ordinary model differing from the source fallback height by more than `max(5 m, 0.5 × fallback height)` is treated as a source disagreement and falls back, unless an explicit reviewed override explains it.
- At most 512 triangles per ordinary full-building model, before parcel clipping. More complex models must be simplified without losing the checks, or fall back. Allow up to 16,384 triangles for an explicit landmark override.

These are initial conservative product thresholds, not survey guarantees. Record their version and observed rejection counts; parameter changes require new fixtures/review and a new dataset version. There is no minimum citywide percentage of accepted roof models.

### 4.5 Landmarks and fallback

Salesforce (`626a57f8-ccf3-497d-a764-266e91e9253d`) may use the approved LiDAR-fitted taper as an explicit, versioned override. Record the authoring method, source references, footprint hash, measured versus approximate ranges, and override version. The crown and base remain approximate. An override applies only when its building identity and footprint hash match; stale overrides fall back. Do not infer equivalent landmark treatment for unrelated buildings.

Failure to reconstruct an individual building is a normal result. The fallback is the **existing footprint extrusion and existing height-selection rules**, not an arbitrary new roof or an unvalidated roofer extrusion. Missing imagery may yield a valid LiDAR-only model; unresolved vegetation or source disagreement yields fallback. A newer footprint is not automatically evidence of post-2023 construction: record a known date mismatch when documented, and geometric/data disagreement otherwise.

Separate normal per-building fallback from build integrity failures. A failed required-source download, corrupt locked input, unavailable required tool, broken codec, invalid index, or inconsistent artifact references fails the build/upload; it must not silently turn the entire city into “successful” fallbacks.

## 5. Parcel pieces and artifact contract

### 5.1 Identity and clipping

Give every exported footprint piece a deterministic **pieceId**, derived from building id, parcel id (or an explicit unmatched marker), and canonical retained piece geometry. The same id appears in tiles, roof meshes, and audit records. Keep the original building id and nullable parcel id separately. Tile clipping at different zooms must not create different ids.

Reconstruct the full building first. Clip its roof/walls to each existing parcel piece using vertical parcel boundaries and close the resulting cut walls. Preserve slopes and heights at cuts. Validate the clipped mesh against that piece. If clipping fails, only that piece falls back; the parent record reports partial success. Unmatched pieces remain visible and are never hidden by a parcel edit. Do not hide an entire multi-parcel building when only one parcel is replaced.

### 5.2 Optional manifest extension

Add optional `buildingRoofs` to the shared manifest (I12), containing:

- `schemaVersion: 1`.
- `indexUrl`: version-relative roof index URL.
- `auditUrl`: version-relative detailed building audit URL.
- `reportUrl`: version-relative aggregate processing report URL.

All URLs use `/data/<same datasetVersion>/...` and are checked by existing upload/verify logic. Existing manifests without this field keep their current behavior. Unknown roof schema versions are ignored by the client with a diagnostic; footprint rendering and parcelId promotion still work. Only supported roof schemas activate pieceId promotion.

Use a separate roof index so the main manifest remains within its existing 64 KB limit. Index entries contain chunk id, geographic bbox, geometry/header URLs, SHA-256 and byte counts, and piece/model counts. Group pieces on the existing 1 km EPSG:7131 grid; assign each piece to one chunk by a point on its geometry, and use actual piece extents for viewport intersection. Split oversized cells into deterministic numbered subchunks without duplicating pieces. A roof chunk is independent of simulation parcel-chunk loading.

Runtime geometry is an offline-triangulated, indexed binary mesh with a versioned JSON header: projected cell origin, corresponding WGS84 anchor, local XYZ offsets in metres, normals, triangle indices, piece slots and contiguous piece index ranges. Use little-endian Float32 vertex/normal buffers and Uint32 indices/slots; ground reference is zero, not NAVD88. The header declares buffer offsets/counts and bounded byte lengths. The decoder validates all ranges/counts before allocation or rendering. Reproject projected XY offsets into deck's local map coordinate convention during offline export; a horizontal orientation/scale regression fixture must verify this transformation. No polygon triangulation or CRS dependency belongs on the runtime main thread.

The header's piece table includes pieceId, buildingId, parcelId, selected method, and the information needed for picking/visibility. Detailed quality and source records stay in the audit artifact rather than inflating every vertex or tooltip.

### 5.3 Audit metadata

Publish a machine-readable, schema-versioned audit record for **every retained source building and every exported piece**, including buildings with no model. An empty roof result must never erase the evidence that the building was considered. Parent records summarize fully modelled, partly modelled, or all-fallback pieces.

Required fields:

| Group | Required information |
| --- | --- |
| Identity | Building id, source release, footprint hash, piece ids, nullable parcel ids, bbox, dataset version. |
| Outcome | Per-piece `modelled` or `footprint_fallback`; selected method (`lidar_aerial`, `lidar_only`, `landmark`, or `footprint`); primary reason (null on accepted pieces; a stable code on fallback pieces) and additional flags. |
| Sources | Lock-entry/file references, acquisition dates or explicit unknowns, imagery coverage/alignment status, ground reference and estimation method. |
| Processing | Algorithm/configuration hash, tool versions, attempt/retry outcomes, selected candidate, detail guard and override identifiers. |
| Quality | Return counts before/after rejection, rejected fraction, validation sample count/coverage/MAE, roof coverage, maximum relative height, roof section and triangle counts, detected spikes and source-height disagreement. Unavailable metrics are null with a reason. |
| Follow-up | Whether a later effort should revisit it, stable reason codes, and candidate/input artifact references sufficient to rerun the relevant building. |

Initial reason codes: `not_in_coverage`, `lidar_missing`, `lidar_sparse`, `ground_missing`, `aerial_missing`, `aerial_alignment_uncertain`, `aerial_rights_unconfirmed`, `vegetation_ambiguous`, `capture_mismatch`, `source_height_disagreement`, `fit_failed`, `validation_insufficient`, `invalid_geometry`, `roof_coverage_low`, `spike_unresolved`, `complexity_limit`, `parcel_clip_failed`, and `override_stale`. Aerial limitations may be flags on an accepted LiDAR-only model rather than a fallback's primary reason. Derived models are estimates; do not invent a calibrated confidence percentage.

Per-building candidates, masks, and source extracts are content-addressed archived processing artifacts, not mandatory browser downloads. Publish a report with counts by method/reason/neighborhood, partial successes, timings, source availability, size distributions, and accepted/fallback coverage. A later effort must be able to select buildings by reason without reprocessing the whole city.

## 6. Runtime rendering and failure behavior

### Loading and rendering

Keep the existing PMTiles extrusions as the first render and low-zoom representation. At zoom **15 and above**, lazily load the roof index and intersecting chunks. Do not fetch roofs at the default low-zoom overview. Prefetch at most one adjacent viewport margin; limit concurrent chunk fetches to **4**. No runtime request goes directly to a LiDAR or imagery provider.

Render accepted meshes through a batched indexed-triangle deck layer in the existing interleaved overlay: at most one roof layer per visible chunk, with no layer created per building. Include a per-piece slot for visibility and picking. Use existing-building theme colors and consistent normal-based shading; avoid a separate selection/color system. The layer is passive and shares the existing depth buffer. Generated buildings and brush overlays retain their ordering and behavior.

The map owns one composition point for roof, generated, rising, and brush layers. `GeneratedController` must not overwrite roof layers when it updates its own layers. Preserve the public `SimMapHandle` and worker revision protocol.

Install a valid roof layer and suppress its matching tile extrusion in the same render update. Failed, pending, rejected, or absent pieces continue displaying their extrusion. On eviction, zoom-out, decode/render failure, or teardown, restore the extrusion in the same update that removes the roof. A failed fetch must not blank the footprint map. Allow retry on a later viewport revisit with a 30-second failure backoff; no persistent warning banner is needed while fallback remains usable.

### Piece and parcel visibility

For new manifests with roof support, tiles promote **pieceId** as their feature id and retain parcelId as a property. Old manifests continue promoting parcelId. An existing-building visibility adapter maps parcel replacement state to known piece ids, applies it to newly loaded tile pieces, and independently tracks `roofReady` per piece. Remember parcel state across tile reloads and roof downloads.

`GeneratedController` continues requesting replacement by parcel id. Its callbacks update both fallback tile pieces and roof-piece visibility within the existing revision/slice boundaries. Undo, erase, and revision-0 resync restore the appropriate existing representation. Clearing replacement state must clear only `replaced`, preserving `roofReady`; retrying the buildings source must reapply both states. Late roof loads must not resurrect a parcel whose generated replacement is already visible.

Mesh picking returns the same existing-building parcel identity used by current tooltips. Ignore hidden/replaced pieces and map unmatched pieces to parcelId null. Generated picking remains first priority. Roof status and raw source details are developer/audit metadata, not new mandatory user-facing flows.

### Budgets and degradation

Preserve existing first-paint limits, generated-update latency, and the p95 **16.7 ms** headed GPU pan benchmark target on an M2-class machine. Roof loading must not delay map readiness, brush input, or simulation startup. Add benchmark routes through roof-heavy areas with and without generated replacements; do not claim GPU performance from headless software rendering.

Initial chunk limits: **4 MiB decoded payload** and **1 MiB gzip-9** per chunk. Split a chunk before publication if needed. Bound combined resident decoded mesh and GPU-buffer storage to **64 MiB** with least-recently-used eviction outside the visible viewport. If the visible set itself exceeds the limit, keep the closest chunks within budget and leave the remaining footprints visible. Decode away from the main thread; install work in bounded slices, preserving the existing 50 ms long-task ceiling. Budget pressure is a transient runtime fallback, not a change to the published per-building reconstruction outcome.

## 7. Verification and release criteria

### Pipeline and codec

- Deterministic source extraction, point split, candidate selection, piece ids, chunk ordering, and encoded meshes for the same pinned inputs/toolchain. Rebuild from archives without upstream network access.
- Missing/sparse LiDAR, missing/partial imagery, invalid ground support, source disagreement, ambiguous vegetation, tool failure, oversized meshes, and parcel-clipping failure produce the specified outcome and audit reason; integrity failures abort the build.
- Courtyard and multi-polygon footprints, vertical cut walls, multi-parcel buildings, and unmatched pieces preserve coverage and identity. Every retained piece has exactly one model/fallback audit outcome.
- Malformed headers, excessive counts, invalid indices, non-finite coordinates, wrong dataset versions, and unknown schema versions cannot create unbounded allocations or hide fallback buildings.
- Extend `build`, `check`, `upload`, `verify`, fixture generation, source restoration, and attribution for roof artifacts. Upload the root manifest last; never mutate a published version.

### Regression and map behavior

Use small redistributable fixtures derived from the spike; keep bulk clouds and aerials out of Git. Include Whole Foods' real upper/lower roof and tree rejection; the `a96b2333` corner cap; a major pitched roof protected from flattening; an ordinary simple flat roof; a courtyard; a building crossing parcel boundaries; a no-data fallback; and the Salesforce override identity check.

The production Whole Foods regression must retain both major roof levels and avoid the approximately 20 m tree protrusions. It need not reproduce each coordinate or exactly three roof polygons. The masked/unmasked comparison must show that filtering, rather than simplification alone, explains the observed correction. Every case stays on the flat ground reference.

Browser checks cover loading/failure/eviction and zoom transitions without holes or doubled solids, late downloads after a parcel edit, independent replacement of multi-parcel pieces, undo/erase/resync, source retry, old manifests, themes, mesh picking, mobile input, and brush overlays. Verify that scores and saved-plan results are identical with roof rendering enabled or unavailable.

### Rollout

Start with the approved sample area in a new local dataset, then run the same configuration across the available SF coverage. Inspect a small additional sample across different roof, vegetation, shadow, and height conditions and report defects and fallback rates. This is a calibration check, not a demand for universal modelling or a separate research project. Known failures may ship as documented footprint fallbacks; no global roof-coverage quota blocks release.

Before enabling roofs in a published dataset, require passing artifact invariants, runtime behavior checks, existing regression suites, the transfer/memory budgets, and the real-GPU benchmark. Confirm source permissions and attribution for sources actually used. Publish and verify a new immutable dataset, stage it, then promote using the existing release flow. Older datasets remain loadable. Rolling back selects the prior dataset version; no plan migration is required.

## 8. Repository impact and planning handoff

Expected changes are confined to roof processing under `pipeline/`, shared manifest/roof codecs in `src/lib/data/`, map loading/rendering/visibility in `src/lib/map/`, fixture and regression coverage, source attribution, and relevant developer documentation. No changes to housing formulas, parcel records, generator contracts, plan storage schema, or D1 are required.

The implementation plan follows review of this spec. It should sequence a backward-compatible data contract, reproducible processing and audits, parcel-piece export, runtime integration, and local/full-coverage verification into independently testable deliverables. It must explicitly cover the piece-id migration and overlay composition rather than treating roof rendering as a standalone viewer.

## References

- Existing contracts: [data pipeline design](2026-10-10-data-pipeline-design.md), [map-view design](2026-10-10-map-view-design.md), [pipeline workflow](../../dev/pipeline.md), [map performance](../../dev/map-perf.md), and [data serving](../../dev/data-serving.md).
- [USGS LiDAR EPT metadata](https://s3-us-west-2.amazonaws.com/usgs-lidar-public/CA_SanFrancisco_1_B23/ept.json) and [NOAA collection record](https://www.fisheries.noaa.gov/inport/item/73386).
- [SF Planning aerial map](https://sfplanninggis.org/1938/), [WMTS capabilities](https://tile.sf.gov/api/WMTSCapabilities.xml), and [2023 TileJSON](https://tile.sf.gov/api/tiles/p2023_rgb8cm/tiles.json).
- [roofer reconstruction parameters](https://innovation.3dbag.nl/roofer/reconstruct_params.html).
- [CEC Whole Foods case study](https://www.energy.ca.gov/sites/default/files/2021-11/CEC-500-2021-050_1.pdf), Appendix C, Figure C-2-1, supports the real split roof/upper rear level.
