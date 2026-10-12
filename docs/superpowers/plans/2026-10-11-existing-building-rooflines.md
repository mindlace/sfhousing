# Existing-building Rooflines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display plausible measured exterior rooflines on flat ground, with existing footprint extrusions and actionable audit metadata wherever models are unavailable or unsuitable.

**Architecture:** Extend the offline dataset pipeline with locked LiDAR/aerial inputs, conservative reconstruction, parcel clipping, and versioned indexed meshes. Add optional lazy roof rendering to the existing MapLibre/deck overlay while preserving parcel replacement, legacy datasets, and every simulation input. Footprint extrusions remain the immediate and failure representation.

**Tech Stack:** Existing Node/TypeScript, DuckDB, Svelte, MapLibre, deck.gl/luma.gl; pinned Python geometry/point-cloud tools and roofer 1.0.0 for offline processing only.

**Spec:** [2026-10-11-existing-building-rooflines-design.md](../specs/2026-10-11-existing-building-rooflines-design.md), approved by the user on 2026-10-11.

## Global Constraints

- Flat ground is a requirement. Roof models are display data only: they do not alter housing totals, existing units, eligibility, zoning, generated massing, or saved-plan calculations.
- The fallback is the existing footprint extrusion and existing height-selection rules. There is no minimum citywide percentage of accepted roof models.
- Preserve the public `SimMapHandle`, simulation protocol, parcel records, generator contracts, and plan storage schema. No D1 migration.
- Reconstruct full buildings before clipping to existing parcel pieces; never hide a whole multi-parcel building for an edit to one parcel.
- Use roofer **1.0.0**, complexity **0.4**, plane support **50** for simplified/retry candidates, LoD2.2 and `--no-clip-terrain`; reference complexity **0.888** with pinned default plane support **15**; spike retry **0.6**.
- Ground reference: fifth percentile of class-2 returns within **4 m**, nearest-ground fallback within **50 m**. Only negatives within **0.1 m** may be clamped.
- Vegetation configuration: RGB/PCA rules from spec §4.3; **0.5 m** cells, up to **48** PCA neighbors, **0.06 m** roughness or **1.5 m** spread, more than **2 m** above up to **32** smooth support returns with median distance below **6 m**, smooth roughness below **0.025 m**.
- Acceptance: roof coverage **98%**, validation coverage **95%**, at least **50** retained training returns and **20** validation samples; maximum height **2.5–340 m**; ordinary height disagreement at most `max(5 m, 0.5 × fallback height)`.
- Detail guard: pitched area above **35%** at slope above **8°**; preserve valid reference if flattening worsens validation MAE by more than **0.25 m**. Spike retry permits MAE increase at most **0.05 m**.
- Full-building triangle limits before parcel clipping: **512** ordinary, **16,384** reviewed landmark. Salesforce is the only initial landmark override.
- Optional roof schema **1**, same-version `/data/<datasetVersion>/` URLs, immutable datasets, root manifest uploaded last; main manifest stays within **64 KB**.
- Roofs load at zoom **15 and above**, at most **4** concurrent chunk jobs, at most one extra viewport margin, **30-second** failure backoff.
- Roof chunks: **4 MiB decoded payload**, **1 MiB gzip-9**. Combined resident decoded mesh and GPU-buffer storage: **64 MiB**; fall back when visible demand exceeds it.
- Preserve existing first-paint limits, generated-update latency, **50 ms** long-task ceiling, and headed real-GPU pan target p95 **16.7 ms** on M2-class hardware.
- No upstream network during `build`; lock/archive all inputs, processing config, dependencies and overrides. No raw aerial/point-cloud browser downloads, terrain, Three.js, named-template catalogue, or Google/Apple reconstruction.
- Use the existing isolated branch/worktree for these changes; Conventional Commits. Run `npm run signoff` before pushing a PR branch. Do not publish a dataset as part of merely writing/reviewing this plan.

## Review Focus

1. Hostile or truncated mesh headers must fail before allocation and leave footprints visible — Tasks 1, 8 and 9.
2. Partial aerial coverage or unavailable reuse rights must never borrow edge pixels or erase a building's audit outcome — Tasks 2, 3 and 5.
3. A roof download completed after a parcel edit must not resurrect the replaced piece — Tasks 6, 8 and 9.
4. Source retry and revision-0 resync must preserve roof readiness independently of replacement state — Tasks 6 and 9.
5. Fast pan/zoom, eviction and over-budget visible sets must neither grow memory without bound nor leave holes or duplicate solids — Tasks 8, 9 and 10.

## File structure and decisions shared across tasks

| Unit | Files | Responsibility |
| --- | --- | --- |
| Data contracts | `src/lib/data/building-roofs.ts`, `roof-codec.ts`, `roof-audit.ts`; extend `manifest.ts` | Versioned index/header/audit types, bounded binary codec, optional manifest descriptor. |
| Acquisition/toolchain | `pipeline/roofs/source-config.json`, `sources.ts`, `inputs.ts`, `job.ts`, `requirements.txt`, `toolchain.json`, `geometry.py` | Coverage, provenance, locked downloads, stable point identity, offline job inputs and tool pins. |
| Reconstruction | `pipeline/roofs/config.json`, `types.py`, `filter.py`, `fit.py`, `quality.py`, `process.py`, `run.ts`, `overrides/salesforce.json` | Training-only vegetation evidence, candidates, selection, validation and processing archive. |
| Export | `pipeline/roofs/clip.py`, `export.ts`, `audit.ts`; extend pipeline SQL/build/tiles/manifest | Closed parcel-piece meshes, piece identities, chunks, comprehensive audits and reports. |
| Publication | `src/lib/data/roof-paths.ts`, `pipeline/roofs/check.ts`; extend check/upload/verify/local-copy/fixtures | Artifact closure, hashes, invariant gates, processing archive and source restoration. |
| Map visibility | `src/lib/map/existing-buildings.ts`; extend style/pick | Per-piece readiness and per-parcel replacement, legacy promotion, source reload replay. |
| Rendering | `src/lib/map/roof-layer.ts`, `roof-shaders.ts`, `layer-composer.ts` | One indexed-triangle layer per chunk, per-piece hiding/picking, one overlay composition point. |
| Streaming | `src/lib/map/roof-controller.ts`, `roof-worker.ts`, `roof-worker-client.ts`, `roof-cache.ts` | Viewport jobs, bounded fetch/decoding, memory accounting, atomic installation and eviction. |
| Integration | Extend `SimMap.svelte`, `debug.ts`, browser/e2e/bench tests and developer docs | Lifecycle, themes, picking, generated edits, failure behavior and release evidence. |

Artifacts are `roofs/index.json`, `roofs/audit.json`, `roofs/report.json`, and `roofs/<chunkId>.json` plus `.bin`. Large build-only intermediates live in `pipeline/.cache/roof-artifacts/<sha256>` and archive under `roof-processing/<sha256>.<ext>`, not public runtime URLs. Per-building audit records link these archive keys and the source lock entries.

Runtime types use local **east, north, up** metre offsets from a WGS84 anchor. Offline export converts EPSG:7131 positions to that convention; do not pass projected-grid offsets directly to deck. Buffers are four contiguous 4-byte-aligned little-endian sections: `positions` Float32 xyz, `normals` Float32 xyz, `indices` Uint32 triangles, `pieceSlots` Uint32 per vertex. No vertex is shared across piece slots. A piece's contiguous range is `[firstIndex, indexCount]`, measured in indices, not bytes or triangles. Roof and wall classification remains in audit/candidate data; normals supply runtime shading.

`RoofIndex` contains `{schemaVersion:1,datasetVersion,chunks:RoofChunkRef[]}`. Each ref has `chunkId`, actual geographic `bbox`, `headerUrl`, `meshUrl`, `headerSha256`, `meshSha256`, `headerBytes`, `meshBytes`, `gzipBytes`, `pieceCount`, `modelCount`. `RoofHeader` has schema/version/chunk identity, projected origin, WGS84 anchor, buffer descriptors, byte length, and a piece table `{pieceId,buildingId,parcelId,method,firstIndex,indexCount}` for modelled pieces only. Fallback pieces are in the complete audit and PMTiles, not empty GPU slots. Index/header JSON plus binary count toward the decoded chunk limit.

For shared readers, bound index/header JSON to **8 MiB / 256 KiB** and require declared chunk lengths before reading large bodies. The worker also bounds actual streamed body bytes; Content-Length is evidence, not the safety boundary. Hash verification operates on decoded HTTP response bytes. These are decoder safety limits, not new first-paint allowances.

A supported manifest descriptor activates pieceId promotion even if its index cannot load. Unknown descriptor schema versions retain their URLs for validation/local-copy but use legacy parcelId promotion at runtime. Every new tile keeps parcelId, so that downgrade works.

Execution setup: read `CLAUDE.md` and linked area docs, confirm the existing isolated worktree is clean, then install dependencies and establish the normal baseline. Do not reset unrelated work. This plan contains ten deliverables; finish and verify each before its commit. No subagents are needed to review the plan itself. The mini fixture remains generated and committed; ordinary app/unit/e2e CI reads those committed artifacts and does not need the Python toolchain. Pipeline CI runs setup/reconstruction/regeneration. Signoff still uses the existing checks; run the explicit roof/pipeline suites before signoff because signoff does not include them.

---

### Task 1: Backward-compatible roof data contract and bounded codec

**Files:** Create `src/lib/data/building-roofs.ts`, `roof-codec.ts`, `roof-audit.ts`, `building-roofs.spec.ts`, `roof-codec.spec.ts`, `roof-audit.spec.ts`; modify `src/lib/data/manifest.ts`, `manifest.spec.ts`.

**Interfaces:**

- `BuildingRoofsDescriptor = {schemaVersion:number;indexUrl:string;auditUrl:string;reportUrl:string}`; add optional `Manifest.buildingRoofs`. Preserve positive unknown versions rather than rejecting the whole manifest.
- `parseRoofIndex(raw:unknown, datasetVersion:string): RoofIndex` and `parseRoofHeader(raw:unknown, ref:RoofChunkRef, datasetVersion:string): RoofHeader` validate supported schema 1, identity, counts, finite bbox/origins, and same-version URLs.
- `DecodedRoofChunk = {header:RoofHeader;positions:Float32Array;normals:Float32Array;indices:Uint32Array;pieceSlots:Uint32Array}`.
- `encodeRoofChunk(chunk:DecodedRoofChunk): {header:RoofHeader;buffer:ArrayBuffer}` and `decodeRoofChunk(header:RoofHeader, buffer:ArrayBuffer): DecodedRoofChunk`; encoding canonicalizes offsets, decoding validates before constructing views. No Node imports in shared modules.
- `RoofReason` is the exact reason-code union in spec §5.3; `RoofAudit` contains schema/version plus full building and piece records with the identity/source/processing/quality/follow-up groups listed there. `parseRoofAudit(raw:unknown,datasetVersion:string): RoofAudit` rejects duplicate ids, missing fallback reasons, non-null accepted reasons and invalid parent summaries. Nullable metrics carry an unavailable-reason field.

- [ ] **1. Write failing contract/codec tests.** Old golden manifest parses unchanged; schema 1 survives parse; schema 99 survives manifest parse but fails the supported index parser; cross-version URLs fail. Add a two-piece indexed mesh fixture with distinct slots and contiguous ranges. Assert:

  ```ts
  expect(decodeRoofChunk(encoded.header, encoded.buffer).indices).toEqual(chunk.indices);
  expect(() => decodeRoofChunk(header, truncatedBuffer)).toThrow();
  expect(() => parseRoofAudit(missingFallbackReason, version)).toThrow();
  ```

  Also reject oversized/overlapping/misaligned buffers, integer overflow, out-of-range vertex/slot indices, mixed-slot triangles, NaN/Infinity, duplicate pieces and invalid index ranges without allocating declared sizes.
- [ ] **2. Run the new tests and confirm missing exports fail.** `npx vitest --run --project server src/lib/data/building-roofs.spec.ts src/lib/data/roof-codec.spec.ts src/lib/data/roof-audit.spec.ts src/lib/data/manifest.spec.ts`.
- [ ] **3. Implement the interfaces and wire layout above.** Manifest schema validates descriptor paths using the existing same-version refinement; shared codec validates actual buffer size against the 4 MiB total limit and the expected counts. Keep existing fixtures unchanged in this task.
- [ ] **4. Re-run that command; require all new and legacy assertions to pass.** Run `npm run check` for the extended manifest type.
- [ ] **5. Commit:** `feat(data): add optional roof mesh and audit contracts`.

### Task 2: Locked coverage acquisition and reproducible processing inputs

**Files:** Create `pipeline/roofs/source-config.json`, `sources.ts`, `inputs.ts`, `job.ts`, `geometry.py`, `requirements.txt`, `toolchain.json`, `setup.ts`; `pipeline/test/roof-sources.test.ts`, `roof-inputs.test.ts`; `pipeline/roofs/tests/test_inputs.py`, `pipeline/test/fixtures/roofs/README.md`, small synthetic input fixtures. Modify `.gitignore`, `pipeline/lib/lock.ts`, `steps/fetch.ts`, `steps/doctor.ts`, `cli.ts`, `config.ts`, `lib/version.ts`, `sources/normalise.ts`, `package.json`, `.github/workflows/pipeline.yml` and relevant tests.

**Interfaces:**

- Extend `LockEntry` with optional `spatial` metadata: CRS/units, acquisition dates or explicit nulls, coverage, source-object identities, and imagery permission/alignment status. Existing entries remain valid. Normalisation must explicitly skip roof entries, not try to interpret them as parcels/buildings.
- `fetchRoofSources(opts:{rawDir:string;config:RoofSourceConfig;http:Http}): Promise<LockEntry[]>` produces `roof-lidar` and optional `roof-aerial` entries using existing `storeBytes/storeFile` and archive conventions. Config initially includes the three spike bounding boxes; its committed coverage controls fetch scope.
- `RoofJob = {schemaVersion:1;datasetVersion:string;buildings:RoofInputBuilding[];sources:RoofInputSource[];configPath:string;toolchainHash:string;workDir:string}` in `job.ts`. Each input building has `buildingId`, canonical EPSG:7131 footprint/hash, fallback `heightM/baseM/hs`, bbox, neighborhood and nullable source dates. Input sources identify local verified file paths, file SHA, original source URL, CRS and coverage/permission flags.
- `prepareRoofJob(db:Duck,lock:Lock,opts:{rawDir:string;rawByName:boolean;datasetVersion:string;workDir:string}): Promise<RoofJob>` reads full `buildings` after SQL 40, not clipped `pieces`.
- Python `load_points(job:dict) -> dict[str, numpy.ndarray]` retains source SHA + original point ordinal alongside XYZ/class; `canonical_geometry(geojson:dict) -> dict` normalizes 1 mm snapped rings, winding, start vertices, holes and multipolygon order; `footprint_hash(geojson:dict) -> str` hashes canonical UTF-8 JSON. Normalise negative zero.

- [ ] **1. Write acquisition/input tests.** Fake EPT hierarchy with external pages and nodes at multiple depths: download every intersecting node exactly once, preserve point ordinals before cropping, include 50 m ground-support buffers, and perform no upstream HTTP on restore/build. Missing optional aerial coverage produces explicit metadata; a listed download failing or a SHA mismatch is fatal. Reordered node completion yields identical extracted records. Add CLI `--lock-path` and `--raw-dir` options for fetch/restore and build test-cache injection; validate them before use. Extend version tests: config/Python/toolchain/override changes change the version; old locks still build.
- [ ] **2. Run and confirm failures:** `npx vitest --run --project pipeline pipeline/test/roof-sources.test.ts pipeline/test/roof-inputs.test.ts pipeline/test/lock.test.ts pipeline/test/version.test.ts`.
- [ ] **3. Implement acquisition and setup.** Traverse the source EPT hierarchy and download relevant LAZ objects plus hierarchy/CRS metadata, retaining their bytes in the lock. Acquire 2023 zoom-19 aerial tiles with exact tile transforms; a coverage descriptor records disabled/unconfirmed imagery rather than fetching it into a distributable build. Restore uses existing source archive paths. Add `pipeline setup-roofs` to require the pinned Python interpreter, create `pipeline/.venv` and install pinned dependencies/tooling into that venv and `pipeline/.cache/tools`, and `doctor --roofs` to check them; neither command runs implicitly during a browser/app build. Ignore `pipeline/.venv/` and `pipeline/roofs/**/__pycache__/`; no environment or binary enters Git. Missing Python gets an installation hint rather than a system-wide installer.

  Use Python **3.14.8** (the successful spike runtime), roofer **1.0.0**, and the spike's exact NumPy/SciPy/Shapely/laspy/lazrs/Pillow/pyproj versions from its archived requirements. Add build-only **manifold3d 3.4.1** for closed-solid clipping and record the resolved wheels/source hashes in `toolchain.json`; verify macOS arm64 and Linux x64 setup. Use the 1.0.0 roofer release/source with recorded artifact/commit hashes; no floating installation. Write exact versions and file hashes for all transitive dependencies into `requirements.txt` using pip's hash-checking format; setup installs with `--require-hashes`. The local spike requirements are at `/Users/mindlace/.codex/visualizations/2026/10/11/01a12ccf-6253-7143-8537-38268dcb36f4/roofline-spike/reproduction/requirements.txt`; core versions are NumPy 2.5.4, SciPy 1.18.1, Shapely 2.2.0, laspy 2.7.0, lazrs 0.8.2, Pillow 12.3.0 and pyproj 3.8.0. Copy only needed pinned packages, not plotting dependencies. Add `test:roofs` using Python `unittest` discovery, and run it in pipeline CI with `doctor --roofs`. Include actual toolchain digest/versions in dataset hashing; do not make old no-roof datasets require Python. Keep setup downloads separate from offline processing.
- [ ] **4. Verify input and restore tests pass.** `npm run pipeline -- setup-roofs`, `npm run pipeline -- doctor --roofs`, `npm run test:roofs`, then the Task 2 Vitest command. Require stable input hashes and explicit absence/permission statuses, not live-provider assertions in unit tests.
- [ ] **5. Commit:** `feat(pipeline): lock roof sources and processing toolchain`.

### Task 3: Conservative roof candidates, selection and complete building outcomes

**Files:** Create `pipeline/roofs/config.json`, `types.py`, `filter.py`, `fit.py`, `quality.py`, `process.py`, `run.ts`, `overrides/salesforce.json`; `pipeline/roofs/tests/test_filter.py`, `test_fit.py`, `test_quality.py`, `test_process.py`; `pipeline/test/roof-run.test.ts`. Extend `pipeline/test/fixtures/roofs/` and its attribution README.

**Interfaces:**

- `ProcessedBuilding` in `job.ts`/`types.py` contains building identity/footprint hash, selected method, nullable closed indexed mesh in EPSG:7131 with relative Z, candidate metrics/attempts, ground method, reasons/flags, and content-addressed intermediate archive descriptors. No accepted mesh means a footprint outcome with a reason, not a roofer extrusion.
- Python `validation_partition(source_sha:str, ordinals:numpy.ndarray) -> numpy.ndarray`; `estimate_ground(points,footprint) -> GroundResult`; `vegetation_mask(training_points,image,raster_transform,config) -> MaskResult`; `fit_candidates(building,training_points,ground,config) -> list[Candidate]`; `select_candidate(candidates,validation_points,building,config) -> ProcessedBuilding`.
- `runRoofJob(job:RoofJob): Promise<{buildings:ProcessedBuilding[];archives:RoofArchive[]}>` writes a job file, invokes the pinned Python executable with `process.py --job <path>`, and validates the complete result. `RoofArchive = LockFile` stored in the roof-artifact cache. Missing output/building ids, unavailable tools and corrupt results fail the job; an isolated building fit failure records `fit_failed`.

- [ ] **1. Write failing Python behavior tests.** Assert the first-four-SHA-bytes modulo-5 split from spec §4.2 against a fixed digest vector; batch order cannot change it. Changing validation Z must not change a training mask. For missing imagery, out-of-raster points, fewer than 3 PCA neighbors, and absent smooth support, assert no invented green evidence. Test RGB/roughness/height conjunction, preservation of ground, 4 m/50 m ground fallbacks and no roof when ground is absent.

  For selection, assert accepted simplified pitched/stepped roofs, preservation of a valid reference at MAE increase `0.251` versus `0.249`, bounded spike retry at `0.05`, rejection at `0.051`, sparse validation fallback, source-height disagreement, negative correction `-0.11`, roof coverage below `0.98`, and complexity above 512. The Salesforce override must match both id and footprint hash, report approximate ranges, and respect 16,384 triangles.
- [ ] **2. Run `npm run test:roofs` and `npx vitest --run --project pipeline pipeline/test/roof-run.test.ts`; confirm the new modules/interfaces are absent.**
- [ ] **3. Implement the versioned heuristic, roofer adapter, QA and selection.** Read spec §4.2–4.5 for all numeric inequalities and reason codes; save simplified/reference/retry candidates, masks, retained source identities and metrics as deterministic archive files. Archive one portable input job per building using lock references rather than expired absolute scratch paths; set derived archive keys to `roof-processing/<sha256>.<ext>` instead of the raw-input `sources/` prefix. Evaluate candidates on the same highest validation returns within 0.05 m of each 0.5 m cell maximum inside the 0.5 m inset footprint. Use up to 5,000 samples chosen by stable source identity, not RNG batch order. Fit the reference on the same filtered cloud with complexity 0.888 and the 1.0.0 default plane support 15; simplified/retry use plane support 50. Pass `--bld-class 1 --grnd-class 2 --id-attribute buildingId --h-terrain-attribute groundM --h-terrain-strategy user --h-roof-attribute fallbackRoofZ --lod22 --no-clip-terrain` explicitly, with `fallbackRoofZ = groundM + heightM` in the input properties. Validate that supplied ground is present before invoking roofer so its tile-minimum fallback cannot sneak in. Use face semantics/normals for roof coverage and spike adjacency; reject invalid meshes and extrusions reported by roofer. Implement all low-support/empty-data branches without NaN diagnostics. Bound retries to one per spike candidate building.

  Extract small USGS-derived real-case fixtures from the research archive for Whole Foods, a96b2333 and the protected pitched roof. Include source SHA/ordinal identities and credits. Where aerial reuse is unconfirmed, use a clearly labelled synthetic RGB/transform fixture for algorithm tests; do not pass it off as independent imagery ground truth. Keep a separate local research regression using original cached aerials. The original LiDAR fixtures/loft inputs are in the sibling `exterior-spike/reproduction/inputs` and the roof-specific archive is `roofline-spike/reproduction/inputs` at the research path in Task 2. For a derived fixture LAZ, use its own locked SHA/ordinal as the split identity and retain upstream provenance; do not fabricate original EPT ordinals that the spike did not preserve. The Salesforce file stores the approved loft parameters/mesh and provenance, with its production footprint hash explicitly verified from the current input.
- [ ] **4. Run the Task 3 commands to green.** The real local Whole Foods comparison must retain lower roof area above 800 m² and upper rear roof above 150 m², masked maximum below 13 m, unmasked diagnostic above 18 m. Require pitched-roof and cap regressions plus a fallback record for every rejected fixture. These are fixture tolerances, not exact-coordinate expectations or citywide guarantees.
- [ ] **5. Commit:** `feat(pipeline): reconstruct and audit conservative roof candidates`.

### Task 4: Parcel-piece clipping, deterministic chunks and dataset build integration

**Files:** Create `pipeline/roofs/clip.py`, `export.ts`, `audit.ts`, `pipeline/roofs/tests/test_clip.py`; `pipeline/test/roof-export.test.ts`, `roof-build.test.ts`. Modify `pipeline/roofs/geometry.py`, `job.ts`, `run.ts`, `process.py`, `pipeline/lib/sql.ts`, `sql/70_export.sql`, `steps/build.ts`, `steps/tiles.ts`, `steps/manifest.ts`; extend relevant existing tests.

**Interfaces:**

- `runSqlRange(db:Duck,range:{from:string;to:string;resetCounts:boolean}): Promise<void>` runs only that inclusive SQL range. Preserve existing `runSql(db,upTo?)` by delegation; continuation must not clear `report_counts` or rerun SQL 40.
- `RoofInputPiece = {pieceId:string;buildingId:string;parcelId:string|null;geometry:GeoJSON.MultiPolygon|GeoJSON.Polygon}` and `ClippedRoofPiece = RoofInputPiece & {mesh:ProcessedBuilding['mesh'];reason:RoofReason|null}` live in `job.ts`. `clipRoofPieces(buildings:ProcessedBuilding[],pieces:RoofInputPiece[],workDir:string): Promise<ClippedRoofPiece[]>` in `run.ts` invokes `process.py --clip-job <path>`. Python `clip_building(mesh:dict,pieces:list[dict]) -> list[dict]` returns one clipped mesh or `parcel_clip_failed` per retained piece. `make_piece_id(building_id:str,parcel_id:str|None,geometry:dict) -> str` is `p-` plus the first 24 SHA-256 hex digits of canonical JSON `[buildingId,parcelId,canonicalGeometry]`.
- `RoofBuildResult = {descriptor:BuildingRoofsDescriptor;index:RoofIndex;audit:RoofAudit;archives:RoofArchive[];counts:Record<string,number>}`.
- `writeRoofArtifacts(db:Duck,processed:ProcessedBuilding[],opts:{outDir:string;datasetVersion:string;archiveDir:string}): Promise<RoofBuildResult>` writes all runtime/audit artifacts and attaches pieceId/buildingId to `buildings_export`; fallback height/base/hs are unchanged.

- [ ] **1. Write failing clip/export/build tests.** A sloped roof crossing two parcels retains matching cut heights and closed positive-volume solids, and each parcel gets a distinct pieceId. Cover courtyard prisms, multi-polygons, unmatched remainders, coplanar cuts and isolated clipping failure with partial parent success. Rotated/reversed ring and reordered input representations yield identical identities. Assert one audit outcome for every building/piece, even when all are fallback.

  Encode/redecode every chunk, assert little-endian layout/slot ranges and actual bbox, force small test budgets to create stable numbered subchunks, and compare two builds byte-for-byte excluding timing fields. An east/north 100 m fixture projected to the map must have the right orientation and length within 0.01 m; all Z values remain relative to a zero ground reference. Compare parcel chunk bytes, heights and totals with roof processing disabled versus enabled.
- [ ] **2. Run `npm run test:roofs` and `npx vitest --run --project pipeline pipeline/test/roof-export.test.ts pipeline/test/roof-build.test.ts pipeline/test/sql.test.ts pipeline/test/tiles.test.ts`; confirm the new export/range interfaces fail.**
- [ ] **3. Implement closed-solid intersection and deterministic export.** Convert accepted roof solids to manifold meshes, intersect each with its parcel polygon extruded through the complete candidate Z range using manifold3d, and validate/close cut walls through the Boolean result. Reject non-manifold inputs or failed intersections for that piece; do not invent repair geometry. Triangulate offline, preserve holes, separate normals at sharp edges, and deterministically order vertices/triangles/pieces after the Boolean. Keep ordinary/landmark limits on pre-clip candidates and chunk limits after clipping.

  Assign each piece to a 1 km cell by a point on its geometry; sort by pieceId and greedily split at 4 MiB decoded/1 MiB gzip limits, naming chunks `<cellId>-<zero-padded-part>`. Reproject to local east/north metre offsets anchored at the cell center. Emit complete audits/report with counts by neighborhood/method/reason, no calibrated confidence scores, and null metrics with unavailable reasons. Omit wall-clock timings for fixture versions and use the fixture build timestamp; live reports record timings. Content-address processing archives outside the public out directory.

  Build order becomes SQL 10–40 → roof job → SQL 50–70 → clip/export/piece identity → existing tile/chunk writers → manifest/invariants. Legacy locks without roof coverage skip the new stage and descriptor. New roof-enabled tiles include pieceId/buildingId plus existing parcelId/heightM/baseM/hs properties, including on fallback pieces. Do not change `60_attributes.sql` or parcel records. `buildManifest` accepts optional `buildingRoofs` and includes only used source attribution; the derivative-license artifact list includes `roofs/*`.
- [ ] **4. Re-run the Task 4 commands and Task 1 codec tests; require all conservation, identity, closure and determinism assertions to pass.** Check main manifest below 64 KB and all-fallback roof builds still valid.
- [ ] **5. Commit:** `feat(pipeline): export parcel-aware roof meshes and fallback audits`.

### Task 5: Artifact closure, publication checks, restoration and local fixtures

**Files:** Create `src/lib/data/roof-paths.ts`, `roof-paths.spec.ts`, `pipeline/roofs/check.ts`, `pipeline/roofs/rebuild.ts`, `pipeline/test/roof-artifacts.test.ts`. Modify `pipeline/steps/check.ts`, `upload.ts`, `verify.ts`, `fetch.ts`, `fixture.ts`, `cli.ts`, corresponding pipeline tests, `scripts/data-local.ts`, `data-local.spec.ts`, `r2-load-local.spec.ts`, fixture sources/goldens, `.github/workflows/pipeline.yml`, `docs/dev/pipeline.md`, `docs/dev/data-serving.md`.

**Interfaces:**

- `roofArtifactUrls(descriptor:BuildingRoofsDescriptor,index:RoofIndex|undefined): string[]` yields top-level and supported index child URLs; all are validated before filesystem/network use.
- `checkRoofArtifacts(outDir:string,manifest:Manifest): Promise<{ok:boolean;failures:string[];counts:Record<string,number>}>` verifies hashes, counts, lengths, full audit coverage and geometry/chunk limits. Add invariant ids **V14** (roof artifact/identity integrity), **V15** (roof sizes/geometry acceptance), **V16** (audit completeness/determinism); legacy manifests pass as explicitly not enabled.
- Extend build report with `roofArchives:RoofArchive[]`; extend upload args with `roofArchiveDir?:string`, using `pipeline/.cache/roof-artifacts`. `restoreRoofArtifacts(report:unknown,archiveDir:string,r2:R2Target): Promise<void>` restores and verifies candidate/mask archives. Wire `fetch --restore --roof-run <datasetVersion>` to fetch the public report from R2 and restore its archive refs alongside raw sources.
- Add `rebuildRoofBuilding(opts:{datasetVersion:string;buildingId:string;rawDir:string;archiveDir:string;outDir:string;r2:R2Target}): Promise<void>` in `pipeline/roofs/rebuild.ts`, invoked by `pipeline roof-rebuild <version> --building <id> --out <dir> [--local]`. Restore the archived portable job and referenced inputs, check current config/toolchain hashes match the recorded run, then process only that building into a separate output; refuse mismatch with an actionable checkout/setup instruction, without changing a published dataset.
- Extend `collectDataPaths`/local-copy orchestration to fetch/parse the roof index before discovering nested chunk/header URLs. Keep all original URLs and sprite/font behavior.

- [ ] **1. Write failing lifecycle tests.** Missing/hash-altered mesh, cross-version nested URL, duplicate piece, missing fallback audit, excessive chunk, and missing processing archive must reject upload before the first `put`. Failed archive/artifact uploads must never publish the root manifest. Verify must discover every child header/bin and check decoded-body hashes; local copy must copy them and purge its existing local cache. Restoring raw/candidate archives with upstream HTTP disabled must reproduce meshes. Unknown schema descriptors copy/check only top-level URLs without following an unsupported index layout.
- [ ] **2. Run `npx vitest --run --project pipeline pipeline/test/roof-artifacts.test.ts pipeline/test/upload.test.ts pipeline/test/verify.test.ts` and `npx vitest --run --project server scripts/data-local.spec.ts src/lib/data/roof-paths.spec.ts`; confirm the new behaviors fail.**
- [ ] **3. Implement artifact closure and publication gates.** Add archive checks and archive-before-runtime upload using existing R2 concurrency/retries/immutability rules. Preserve binary Content-Type and normal immutable caching. Roof-enabled reports must include V14–V16; old reports stay compatible with no-roof datasets. Do not trust an earlier report alone: recheck file identity/bounds before upload. A missing required input/tool is fatal; normal per-building no-data fallback is not.

  Test single-building rebuild from restored archives: only the requested id is processed, mismatched toolchain fails, and the published version stays unchanged. Extend the generated mini fixture with synthetic closed roof pieces, a multi-parcel building and explicit fallback outcomes. Generate actual processing results using the pinned toolchain, not hand-written production artifacts. Include roof directories in `GOLDEN_FILES`, cross-run CI checks and fixture upload/local-load tests; preserve a frozen legacy manifest fixture for compatibility tests. Do not hand-edit `fixture-0` or publish raw aerials. Document imagery permission evidence/status in source config; unconfirmed sources are excluded from distributable derived data and become audit flags/fallbacks.
- [ ] **4. Run both Task 5 commands, `npm run pipeline -- fixture --update-golden`, then `npm run test:pipeline` and `npm run test:roofs`.** Review intentional generated diffs; repeat plain `pipeline fixture` and require no further output changes. Check raw-plus-processing restore offline from a temporary cache.
- [ ] **5. Commit:** `feat(pipeline): verify and publish complete roof datasets`.

### Task 6: Per-piece existing-building visibility with legacy compatibility

**Files:** Create `src/lib/map/existing-buildings.ts`, `existing-buildings.spec.ts`; modify `style.ts`, `style.spec.ts`, `pick.ts`, `pick.spec.ts`. No SimMap lifecycle wiring yet.

**Interfaces:**

- `ExistingBuildings` constructed with `{mode:'parcel'|'piece';setState(id,state):void;clearState(id,key):void;onReplacementChange(change:{hidden:ReadonlySet<ParcelId>;changed:readonly ParcelId[]}):void}`.
- Methods `transaction(fn:()=>void):void`, `observePieces(pieces:{pieceId:string;parcelId:ParcelId|null}[]):void`, `setReplaced(id:ParcelId):void`, `clearReplaced(id:ParcelId):void`, `clearAllReplaced():void`, `setRoofReady(ids:readonly string[],ready:boolean):void`, `replay():void`, `destroy():void`; readonly `hidden:ReadonlySet<ParcelId>` and `roofReady:ReadonlySet<string>` mirrors. Repeated tile observations must be idempotent. Transactions batch changed parcel ids and issue one replacement notification after all mutations, without copying the full hidden set per id.
- `buildingsSource(manifest)` chooses pieceId only for supported schema 1. `existingBuildingsLayer(theme)` independently suppresses solid height/base when `replaced` or `roofReady`, preserving the current replaced-footprint styling and leaving unmatched pieces visible.

- [ ] **1. Write tests for replacement before and after observations, two parcels sharing a building, multiple pieces sharing one parcel, unmatched/null parcels, duplicate tile features, roof readiness independent of replacement, and legacy parcel-id mode.** A 2,000-id transaction must issue one roof notification, not 2,000. Assert:

  ```ts
  existing.setRoofReady(['piece-a'], true);
  existing.setReplaced('parcel-a');
  existing.clearAllReplaced();
  expect(existing.roofReady.has('piece-a')).toBe(true);
  ```

  Replay after source removal/re-add must emit both states; late observed pieces inherit current hidden state. Unknown roof schema chooses parcelId. Picking remains keyed by parcelId property, never assumes feature id is a parcel id.
- [ ] **2. Run `npx vitest --run --project server src/lib/map/existing-buildings.spec.ts src/lib/map/style.spec.ts src/lib/map/pick.spec.ts`; confirm missing adapter tests fail.**
- [ ] **3. Implement the adapter, style promotion and independent state expressions.** `clearAllReplaced` removes only the replacement key; retain readiness until explicit deactivation. Memory stores piece mappings needed for observed/loaded data and deduplicates observations; unmount clears it. Keep generated callback signatures unchanged.
- [ ] **4. Re-run the command to green, including existing picking and theme tests.**
- [ ] **5. Commit:** `feat(map): track roof readiness and parcel replacement independently`.

### Task 7: Batched indexed roof layer and overlay composition

**Files:** Create `src/lib/map/roof-layer.ts`, `roof-shaders.ts`, `layer-composer.ts`, `layer-composer.spec.ts`, `roof-layer.svelte.spec.ts`; modify `deck-loader.ts`, `generated-controller.ts`, `generated-controller.svelte.spec.ts`, `test/fake-deps.ts`, `package.json`, `package-lock.json`, `src/lib/attribution.ts` and its tests.

**Interfaces:**

- `RoofMeshLayer extends Layer<RoofMeshLayerProps>` with `{chunk:DecodedRoofChunk;hidden:ReadonlySet<ParcelId>;visibilityRevision:number;theme:Theme;active:boolean;onReady():void;onFailure(error:Error):void}` and deck id `existing-roof-<chunkId>`. Use non-instanced indexed triangles and a per-vertex slot for picking. `getPickingInfo` maps encoded slot to its header piece and ignores hidden pieces.
- `LayerComposer` constructed with `(setLayers:(layers:Layer[])=>void)`; methods `setRoofs(layers:Layer[]):void`, `setGenerated(layers:Layer[]):void`, `setBrush(layers:Layer[]):void`, `transaction(fn:()=>void):void`, `destroy():void`. Order is roofs → generated/rising → brush; a transaction emits one composed update.
- Keep `GeneratedController.setOverlayLayers` externally compatible; add optional `ControllerDeps.withRepresentationTransaction(fn:()=>void):void` wrapping each applied slice and synchronous snapshot reset (default executes immediately), plus an injected brush-slot callback so its generated output excludes brush layers when a composer owns that slot. Legacy standalone controller tests/deps retain their current behavior.

- [ ] **1. Write composition and GPU browser tests.** Updating generated or brush layers never drops roofs; atomic transactions emit one update. Prepare an inactive layer and assert it acknowledges GPU readiness without drawing/picking; activate it for rendering. Render a sloped roof with vertical walls in a test deck/map, verify normal shading and per-piece pick identity, then hide one of two parcel slots without changing geometry buffers. Assert draw topology is triangles, index count matches the codec, hidden pixels do not render or pick, theme changes reuse mesh buffers, and finalization destroys owned GPU resources exactly once. No per-building layers.
- [ ] **2. Run `npx vitest --run --project server src/lib/map/layer-composer.spec.ts` and `npx vitest --run --project client src/lib/map/roof-layer.svelte.spec.ts src/lib/map/generated-controller.svelte.spec.ts`; confirm the new behavior fails.**
- [ ] **3. Implement the layer using deck `Layer`, projection/picking modules and luma `Model`.** Add direct runtime `@luma.gl/engine` at **~9.4.0**, matching the existing luma family, for the indexed model; credit luma.gl in SOFTWARE. Do not add Three.js, loaders or a polygon tessellator. Keep the module lazy with the deck chunk. Use `COORDINATE_SYSTEM.METER_OFFSETS` and the exported WGS84 anchor; normals are in that same local frame. Generate slot picking colors and a lightweight visibility buffer keyed by `visibilityRevision` so mutations of the hidden mirror update GPU state even when Set identity is unchanged; discard hidden fragments in both render and picking passes. Normals shade the existing theme color consistently with generated buildings. Use the current pinned APIs and verify with the browser test, not shader-string assertions.

  Track buffer byte sizes explicitly for the cache task. Layer initialization/render errors call `onFailure` and leave suppression to the controller; a constructor alone does not prove the layer rendered successfully. `LayerComposer` is the sole caller of overlay.setProps once integrated.
- [ ] **4. Re-run both commands to green and run `npm run check`.** Existing generated-update latency tests must still pass without roof data.
- [ ] **5. Commit:** `feat(map): render batched roof meshes in the shared overlay`.

### Task 8: Off-thread streaming, bounded cache and atomic representation changes

**Files:** Create `src/lib/map/roof-controller.ts`, `roof-cache.ts`, `roof-worker.ts`, `roof-worker-client.ts`, `roof-controller.spec.ts`, `roof-cache.spec.ts`, `roof-worker-client.spec.ts`, `roof-worker.svelte.spec.ts`.

**Interfaces:**

- Worker request `{type:'load';requestId:number;datasetVersion:string;ref:RoofChunkRef}` or `{type:'cancel';requestId:number}`. Response `{type:'loaded';requestId:number;chunk:DecodedRoofChunk}` with all mesh buffers transferred, or `{type:'failed';requestId:number;message:string}`. Worker validates streamed lengths, hashes, index/header identity and codec bounds.
- `RoofWorkerClient.load(ref:RoofChunkRef,datasetVersion:string,signal:AbortSignal): Promise<DecodedRoofChunk>`; `destroy():void`. Worker creation uses Vite's `new URL('./roof-worker.ts', import.meta.url)` module-worker pattern; no simulation worker protocol change.
- `RoofCache` constructed with `{onEvict(id:string):void}`; methods `setVisible(ids:readonly string[]):void`, `reserve(id:string,decodedBytes:number,gpuBytes:number):boolean`, `install(id:string,chunk:DecodedRoofChunk):void`, `touch(id:string):void`, `evict(id:string):void`, `destroy():void`; tracks reservations, decoded/GPU owned bytes and visible pinned entries. Failed/cancelled work releases reservations. Eviction synchronously calls the controller to restore/remove the active representation before subtracting its owned memory; nearest visible admission is chosen by the controller, not accidental request completion order.
- `RoofController` constructed with `{manifest;existing:ExistingBuildings;composer:LayerComposer;worker:RoofWorkerClient;fetch;now;raf;cancelRaf;createLayer(props:RoofMeshLayerProps):Layer;onDiagnostic(message):void}`. Methods `updateViewport(bbox:BBox,zoom:number,center:[number,number]):void`, `setHidden(hidden:ReadonlySet<ParcelId>,changed?:readonly ParcelId[]):void`, `setTheme(theme:Theme):void`, `destroy():void`; `snapshot()` gives index/chunk statuses, active piece ids, owned/reserved bytes and in-flight count for tests/debug only.

- [ ] **1. Write fake-clock/worker/cache tests.** At zoom 14.99 expect no index/fetch; at 15 fetch intersecting chunks with at most 4 jobs and one viewport margin. Fail index/header/hash/truncated body and expect no readiness. Promise completion after destroy or dataset change must have no effects. Enforce 30,000 ms backoff, deduplicated requests, cancellation, sorted nearest-first admission, 64 MiB including reservations/CPU/GPU, and bounded over-budget visible behavior. Reject streams exceeding declared or safety length even without Content-Length. Worker errors reject every pending promise and release reservations.

  Replace a parcel during a delayed load and assert it remains hidden after successful activation. A fake layer is not ready until its first successful render acknowledgment: before that, the extrusion stays visible. On ready or failure/eviction, assert mesh and feature-state changes occur inside one composer transaction. Simulate pan/zoom thrash and require every uninstalled/evicted buffer disposed with no residual suppression.
- [ ] **2. Run `npx vitest --run --project server src/lib/map/roof-controller.spec.ts src/lib/map/roof-cache.spec.ts src/lib/map/roof-worker-client.spec.ts` and `npx vitest --run --project client src/lib/map/roof-worker.svelte.spec.ts`; confirm failures for the missing implementation.**
- [ ] **3. Implement worker decoding and controller/cache scheduling.** Worker owns bounded streaming fetch plus SHA-256 and codec validation. Main thread fetches the small index lazily and validates it, then transfers no raw polygon processing to the browser. Limit 4 active chunk loads including their two URL fetches, and release decoded staging copies promptly. Account GPU normals/positions/indices/visibility/picking buffers and JSON/header storage; reserve worst-case resident bytes before decoding. Pause admissions when the visible set exhausts capacity, rather than retrying on every frame.

  Install an initially prepared roof layer, wait for successful draw acknowledgment, and atomically make it visible/suppress matching extrusions. Use the Task 7 `active`/`onReady` handshake: `active:false` prepares GPU resources without drawing/picking roof fragments. Restore feature state before deleting an active representation within the same transaction. Apply hidden state to new layers from the adapter's current mirror. Maintain parcel-to-resident-chunk membership and update only chunks containing changed parcels; bump their visibilityRevision once per adapter transaction, without rebuilding geometry. On zoom-out clear readiness even if decoded caches are retained. Slice installation at one chunk per rAF; bound any single chunk's work with the browser long-task test.
- [ ] **4. Re-run both commands and Task 7 layer tests to green.** Worker integration test must use a real module worker and transferred buffers; cache tests inspect actual retained byte accounting, not only entry counts.
- [ ] **5. Commit:** `feat(map): stream roof chunks with bounded memory and fallback`.

### Task 9: Wire roof lifecycle into SimMap and exercise real parcel editing

**Files:** Modify `src/lib/map/SimMap.svelte`, `debug.ts`, `pick.ts`, `test/fake-deps.ts`, relevant existing map tests; create `src/lib/map/SimMap.roofs.svelte.spec.ts`, `e2e/roofs.spec.ts`; extend `e2e/data-fixture.spec.ts`, `e2e/brush.spec.ts`, `e2e/share-roundtrip.spec.ts`, map snapshots only where justified.

**Interfaces:** Preserve `SimMapProps` and `SimMapHandle`. Extend the e2e-only debug hook with `roofSnapshot(): RoofControllerSnapshot|null` and existing adapter state; production builds expose neither. `RoofControllerSnapshot` is the return type of Task 8 `snapshot()`; export that type there.

- [ ] **1. Write integration tests using the generated roof-enabled mini dataset.** Observe newly loaded building-source features and verify piece ids survive tile clipping. Exercise a parcel edit before a delayed chunk arrives, editing just one half of a two-parcel building, erase/undo and revision-0 replacement, source remove/re-add/retry, remount onto a legacy dataset, unknown schema, themes and teardown. Assert `roofReady` survives clearAllReplaced, and replaced state survives source/roof reload. Existing mesh picking resolves the same tooltip parcel and unmatched pieces remain visible; pick generated layers first, even when roofs overlap the query radius.

  Route-abort index/header/bin in Playwright and verify footprints, brush interaction, score and sharing still work without a new warning flow. Compare identical saved-plan/score outputs with roofs loaded and requests blocked. At zoom-out or eviction, use screenshots plus state assertions to check no holes or doubled solids. Test mobile/touch and brush overlay visibility. Record main-thread long tasks during chunk activation and require none above 50 ms.
- [ ] **2. Run `npx vitest --run --project client src/lib/map/SimMap.roofs.svelte.spec.ts` and `npx playwright test e2e/roofs.spec.ts`; confirm the unwired lifecycle fails.**
- [ ] **3. Integrate into existing lifecycle boundaries.** On map/deck readiness construct the adapter, composer and optional supported-schema roof controller without delaying `onready`. Route generated callbacks through adapter methods and composer slots. Inject `withRepresentationTransaction(fn)` as `composer.transaction(() => existing.transaction(fn))` so each existing hide slice and its generated/roof updates commit together. Observe `sourcedata` for the building source and query/deduplicate loaded source features so late tiles inherit state. On `moveend`/zoom and after activation schedule viewport updates using actual chunk bbox; share the existing map camera, not a second canvas. Replay the adapter on retryBuildings. Apply theme to both controllers; destroy streaming work and release readiness before overlay/map teardown.

  In picking, query generated layers and roof layers separately using deck layer filters so a roof hit cannot mask a generated hit; then fall back to MapLibre footprint hits. Feed the existing tooltip summary path with parcel id. Keep all new status/debug detail out of normal product flows and compile test hooks only for VITE_E2E. Preserve legacy error states and public map handle.
- [ ] **4. Run the Task 9 commands, `npm run test:unit`, `npm run test:e2e`, `npm run check` and `npm run lint`.** All generated-controller, source-retry, sharing, brush, SSR and unsupported-WebGL regressions must pass. No live upstream imagery/LiDAR URL should appear in browser request logs.
- [ ] **5. Commit:** `feat(map): integrate roof display with parcel edits and legacy fallback`.

### Task 10: Local full-coverage validation, performance evidence and release handoff

2026-10-12 checkpoint: local implementation/validation is complete within the
[recorded scope](../../dev/rooflines.md#current-checkpoint-and-coverage); full-city and M2 release
gates remain open. The [50 GB streaming follow-up plan](2026-10-12-citywide-roof-streaming.md)
supplies the capacity work required before the citywide portion below. Historical checkboxes
are not evidence that the full-city run happened.

**Files:** Modify `e2e/bench/map-pan.bench.ts`, `docs/dev/map-perf.md`, `docs/dev/pipeline.md`, `docs/dev/deploy.md`; add `docs/dev/rooflines.md` and link it from `CLAUDE.md`. Modify `pipeline/roofs/source-config.json` and `pipeline/sources.lock.json` only when recording the expanded source coverage actually fetched. Generated data/reports remain outside Git except fixtures.

**Interfaces:** Use existing `pipeline fetch/build/check/upload/verify`, source/artifact restore, `scripts/r2-load-local.ts`, and map benchmark. Do not add a second release system or a citywide success quota.

- [ ] **1. Extend benchmark assertions before claiming performance.** Run the existing synthetic whole-city generated-plan benchmark unchanged as a regression, then pan through roof-heavy local data at zoom 15+ with no generated edits and with generated replacements. Assert memory/reservations at most 64 MiB, at most four chunk jobs, one layer per active chunk, readiness symmetry after eviction, no long task above 50 ms, and GPU frame p95 at most 16.7 ms. Preserve the default first-idle transfer test at at most 5 MB and existing generated-update latency checks. A test against a no-roof fixture is not roof-performance evidence.
- [ ] **2. Build/review the approved sample in the real app.** Run `pipeline setup-roofs`, `doctor --roofs`, locked fetch for configured sample coverage, `pipeline build`, and `pipeline check <version>`. Load `pipeline/out/<version>` with `npx tsx scripts/r2-load-local.ts pipeline/out/<version> <version>`, set local `PUBLIC_DATASET_VERSION`, then run `npm run dev`. Inspect Whole Foods, a96b2333, retained pitched roofs, Salesforce, courtyard and multi-parcel editing; compare imagery-filter on/off using archived pipeline candidates, not a product toggle. Record defects as audit reasons/fallbacks or fix the owning task and rerun its checks.
- [ ] **3. Expand the committed coverage configuration to available SF coverage and fetch/build/check with the same parameters.** Report accepted/partial/fallback counts by reason/neighborhood, payload distribution, elapsed time and source/permission availability. Inspect 12 additional buildings chosen across pitched/flat roofs, trees, shadows, industrial footprints and taller buildings; record their ids/outcomes and defects. Known failures may remain explicit fallbacks. Do not claim an imagery-assisted result if permission limitations selected LiDAR-only or footprint methods.
- [ ] **4. Run archive restoration and complete verification.** In an empty temporary cache, restore source and processing archives through a local R2 upload (`pipeline upload <version> --local`, then `pipeline fetch --restore --local --roof-run <version>` with `--lock-path <copied-lock> --raw-dir <empty-cache>/raw` from Task 2 and its sibling roof-artifacts cache), rebuild and compare indexed meshes, identities and outcome records excluding wall-clock fields. Run `npm run test:roofs`, `npm run test:pipeline`, `npm run test:unit`, `npm run test:e2e`, `npm run check`, `npm run lint` and `npm run bench:map` with the real local roof dataset. Keep dataset override/local state out of committed production configuration during verification.
- [ ] **5. Write evidence and operator instructions.** In `rooflines.md` document setup, locked sample/full-coverage commands, source permission evidence, reason-code querying via audit JSON, `pipeline roof-rebuild <version> --building <id> --out <dir>` for one archived building, landmark hash updates, and runtime/pipeline fallback distinctions. In map-perf record machine/browser/DPR and measured roof and generated benchmarks, explicitly distinguishing M2 measurements from other hardware. Document staging verification, normal dataset promotion and rollback to the previous immutable version in deploy docs. Remote upload/promotion follows the existing release workflow after implementation verification; this task prepares that handoff rather than silently changing production during local review.
- [ ] **6. Commit:** `test: verify roofline rollout and document fallback operations`. Before a PR push use `npm run signoff`; inspect its result and attach any created PR through the app tool. Do not run signoff or create a PR while only writing this plan.

## Self-review and handoff

Spec coverage: §1–3 boundaries → Tasks 1/4/6–9; §4.1 sources/rights/versioning → Tasks 2/5/10; §4.2–4.5 geometry/filter/selection/override → Tasks 2–4; §5 identity/artifacts/audits → Tasks 1/4/5; §6 rendering/visibility/budgets → Tasks 6–10; §7 checks/rollout → Tasks 3–5/9/10; §8 repository impact → file map and constraints above. All five Review Focus cases have explicit assertions in their owning tasks.

Historical handoff: the user subsequently approved this implementation plan and selected subagent-driven execution. See the checkpoint above for remaining work. The original execution recommendation was: **Recommended execution: subagent-driven**, because the Python data pipeline, binary codec and GPU/parcel state boundaries have independently testable deliverables and benefit from review before dependent work builds on them. Native execution remains available with one whole-branch independent review after implementation. Neither approach changes the required local verification or fallback behavior.

Technical references: [deck custom-layer lifecycle](https://deck.gl/docs/developer-guide/custom-layers/layer-lifecycle), [deck custom picking](https://deck.gl/docs/developer-guide/custom-layers/picking), [luma Model](https://luma.gl/docs/api-reference/engine/model), and [Manifold's closed-mesh Boolean contract](https://github.com/elalish/manifold#manifold-library). These guide implementation of the pinned versions; browser/geometry tests establish behavior here.
