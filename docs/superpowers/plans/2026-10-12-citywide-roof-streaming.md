# Citywide Roof Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a resumable citywide roof run possible with a total 50 GB local working set, using streamed sources and the coarsest demonstrated adequate aerial vegetation evidence.

**Architecture:** Stream and archive frozen source objects before computing one dataset version, then process complete buildings in bounded spatial groups backed by those remote archives. A disk-backed journal, budget manager and selective archive catalog allow verified batches to leave disk. Stream imagery one tile at a time; finalize public artifacts independently of processing group boundaries.

**Tech Stack:** Existing TypeScript/tsx pipeline, better-sqlite3, Node streams, Python 3.14.8/numpy/scipy/Pillow/pyproj, pinned roofer, and a persistent S3-compatible R2 transport using `@aws-sdk/client-s3` and `@aws-sdk/lib-storage` (exact versions resolved and locked during implementation).

**Spec:** [Citywide streaming design](../specs/2026-10-12-citywide-roof-streaming-design.md), supplementing the [approved product design](../specs/2026-10-11-existing-building-rooflines-design.md). Read both before implementation. This is future work; none of the new commands/interfaces below exists yet.

## Global Constraints

- Total run-owned local storage: 50,000,000,000 bytes; admission ceiling 45,000,000,000 bytes; additional host free-space reserve 10,000,000,000 bytes. Count every scratch/cache/transfer/restore/base-output copy and WAL.
- Defaults: cache 12 GB, active processing 18 GB, transfers 6 GB, metadata/finalization 9 GB, emergency 5 GB (decimal). One global reservation manager owns all categories.
- Start with four source HTTP streams, at most two remote archive operations, one decoded image and one fitter. RAM admission requires measured process bounds plus 2 GiB host headroom independently of disk.
- Full-density EPT, full buildings and physical 50 m support; source SHA/original ordinal, whole-node transforms, float64/signed zero and held-out identities remain exact. No resource-induced geometry fallback.
- roofer 1.1.0-beta.1 commit `1c06fb1aed9096f4b16f894c2da12bc2d785b71b`; existing dependency/codec pins and all roof QA stay in force. Preserve flat ground, simulation/save schemas and public roof schema 1.
- Private catalog schema 2: root ≤1 MiB, leaf target ≤16 MiB, absolute leaf cap 32 MiB. Legacy private schema-1 reads/rebuilds remain supported.
- Aerial derivation/archive rights and registration must be recorded; pin exact source/year/bands/transform/bytes. Optional invalid imagery is disabled explicitly; corrupt required frozen sources abort.
- Verified remote readback precedes eviction; all batch commits precede root-manifest publication; production promotion is a separate operation.
- This plan authorizes no citywide execution or cloud spend. First implement and run the bounded pilot; then review the measured remote budget and remaining release gates.

## Review Focus

1. A building straddling a scheduling cell or imagery seam gets complete support and one owner; output matches an unsplit run (Tasks 3, 5, 6).
2. A restart after upload but before journal commit adopts only hash-verified objects; a corrupt receipt stops rather than skipping work (Tasks 1, 2, 7).
3. Unknown-length responses, native scratch growth and restore readbacks share the same budget; insufficient RAM pauses without weakening QA (Tasks 1, 2, 5, 7).
4. Coarse pixels, shadows, green roofs and wrong band order cannot turn uncertain vegetation evidence into destructive roof filtering (Task 4).
5. A one-building cold rebuild from a city-sized archive restores only its closure and rejects missing/cyclic/oversized descriptors (Tasks 2, 7).

## File map and shared contracts

New files belong under `pipeline/roofs/city/` to keep offline scheduling separate from the existing product pipeline. Each task names its tests; use the existing Vitest `pipeline` project and Python unittest conventions. Do not rewrite the map renderer.

- `types.ts`, `journal.ts`: run IDs, typed receipts, SQLite state/transactions and indexes.
- `budget.ts`: global disk reservations, leases, process admission and accounted paths.
- `store.ts`: persistent remote streaming and verified archival; adapts to existing `R2Target`.
- `catalog.ts`: bounded private lock/archive parts, lookup and closure traversal.
- `inventory.ts`: spatial ownership, streamed EPT traversal and immutable freeze.
- `runner.ts`: resumable bounded scheduling and per-group subprocess orchestration.
- `finalize.ts`: external ordering, complete audit and root-last finalization.
- `pipeline/roofs/imagery.py`: bounded tile windows and physically defined mask sampling.
- `pipeline/roofs/geometry.py`, `point_archives.py`, `filter.py`, `process.py`: compact exact point identity, bounded cloud lifetime and incremental results.
- Existing `sources.ts`, `inputs.ts`, `run.ts`, `archives.ts`, `rebuild.ts`, `export.ts`, `audit.ts`, `check.ts`, `pipeline/lib/version.ts`, `pipeline/lib/lock.ts`, `pipeline/steps/{fetch,build,upload,verify}.ts` and `pipeline/cli.ts`: compatibility and explicit opt-in integration.

Define these shared types in Task 1; serialize no absolute local paths into archived inputs:

```ts
type ByteCount = number; // nonnegative safe integer, bytes
type RunPhase = 'inventory' | 'frozen' | 'processing' | 'finalizing' | 'complete' | 'paused';
type BatchPhase = 'planned' | 'sources_verified' | 'processed' |
  'archives_verified' | 'committed' | 'evicted';
type ObjectRef = { key: string; sha256: string; bytes: ByteCount };
type VerifiedReceipt = ObjectRef & { verifiedAt: string };
type BatchPlan = { id: string; buildingIds: string[]; sourceRefs: ObjectRef[];
  reservedBytes: ByteCount; estimatedPeakRssBytes: ByteCount };
type RunOptions = { workspace: string; runId: string; maxLocalBytes: ByteCount;
  admissionBytes: ByteCount; hostReserveBytes: ByteCount };
```

`RunJournal` owns `runs`, `buildings`, `source_objects`, `batches`, `receipts`, `result_parts` and `leases` tables. Building ID is unique within a run; object key has one SHA/length. Store frozen roots/version on `runs`; state changes are transactions. Scheduling timestamps and telemetry never enter logical dataset identity. Batch lists and metadata are bounded; large city inventories are cursor streams, not arrays.

### Task 1: Accounted workspace and durable run journal

**Files:** Create `pipeline/roofs/city/{types,journal,budget}.ts`; tests `pipeline/test/roof-city-budget.test.ts`, `pipeline/test/roof-city-journal.test.ts`.

**Interfaces:** Produce `openRunJournal(options: RunOptions): RunJournal`, `transitionBatch(id: string, expected: BatchPhase, next: BatchPhase): void`, and `openBudget(options: RunOptions): WorkspaceBudget`. Budget methods: `reserve(category: string, bytes: ByteCount): Promise<Lease>`, `release(lease: Lease): Promise<void>`, `snapshot(): Promise<BudgetSnapshot>`; define `Lease` and `BudgetSnapshot` in `types.ts`. Snapshot reports allocated/reserved/peak bytes and host free bytes. `admitProcess(peakRssBytes: ByteCount): Promise<Lease>` applies independent RAM admission. Journal closes explicitly and supports cursor iteration.

- [ ] **1. Write failing tests** for 45 GB admission/50 GB ceiling, 10 GB host reserve, reservation double release, shared cache leases, WAL/partial/verification accounting, symlink escape, restart state recovery and transaction rollback. Assert a 45 GB reservation followed by one additional byte refuses admission; a resource refusal never creates a completed/fallback result.
- [ ] **2. Run RED:** `npm run test:pipeline -- pipeline/test/roof-city-budget.test.ts pipeline/test/roof-city-journal.test.ts`; expect missing interfaces or failing assertions.
- [ ] **3. Implement** the journal and budget interfaces. Derive all run paths from the validated workspace; route child-process temporary paths there. Reserve before writes and audit actual allocation. Provide a native-stage capacity enforcement adapter; reject capacity certification on hosts where strict bounds cannot be enforced. Use injectable filesystem/memory probes for deterministic tests.
- [ ] **4. Run GREEN** with the Step 2 command; include fault injection of temp growth, lost leases and rollback before/after fsync. Expect every assertion to pass without real 50 GB fixtures (sparse/accounting fixtures plus the later real pilot).
- [ ] **5. Commit:** `feat(pipeline): add bounded roof run workspace and journal`.

### Task 2: Streaming remote archives and bounded private catalogs

**Files:** Create `pipeline/roofs/city/{store,catalog}.ts`; modify `pipeline/lib/r2.ts`, `pipeline/roofs/archives.ts`, `package.json`, `package-lock.json`; tests `pipeline/test/roof-city-store.test.ts`, `pipeline/test/roof-city-catalog.test.ts`.

**Interfaces:** Consume `ObjectRef`, `VerifiedReceipt`, `WorkspaceBudget`. Produce `openArchiveStore(options: { budget: WorkspaceBudget; endpoint: string; bucket: string }): ArchiveStore` with `archive(file: string, ref: ObjectRef): Promise<VerifiedReceipt>`, `restore(ref: ObjectRef, path: string): Promise<void>`, `verify(ref: ObjectRef): Promise<VerifiedReceipt>`, and `dispose(): Promise<void>`. Credentials use the SDK credential provider/environment, never a committed file. Produce `writeCatalog(records: AsyncIterable<CatalogRecord>, store: ArchiveStore): Promise<ObjectRef>` and `walkBuildingClosure(root: ObjectRef, buildingId: string, store: ArchiveStore): AsyncIterable<ObjectRef>`; define the strict schema-2 `CatalogRecord` discriminated union here (source, processing, building-input, output, dependency) with role/identity/ref/dependency refs.

- [ ] **1. Write failing tests** for streaming unknown-length input, 404 versus permission failure, truncated/reordered readback, SHA versus multipart ETag, throttling/Retry-After, abort cleanup, two-operation backpressure, oversized/cyclic/duplicate catalog parts and a million-record synthetic cursor that is never materialized as one array. Assert local deletion is forbidden before a successful streamed SHA/length readback.
- [ ] **2. Run RED:** `npm run test:pipeline -- pipeline/test/roof-city-store.test.ts pipeline/test/roof-city-catalog.test.ts`.
- [ ] **3. Implement** persistent SDK transport with bounded multipart buffers and explicit disposal, strict catalog parsing and sorted part/index generation. HEAD is an efficient probe, not integrity proof. Reuse immutable objects only after verifying their exact bytes; cache the verified receipt transactionally. Preserve the existing Wrangler/local adapters and schema-1 archive parser.
- [ ] **4. Run GREEN** with the Step 2 command. Use an injected S3-compatible test transport for unit faults; no external credentials/spend required. Assert ≤1 MiB root, ≤16 MiB target parts and refusal above 32 MiB; single-building traversal must not fetch unrelated leaves.
- [ ] **5. Commit:** `feat(pipeline): stream verified roof archives and catalog parts`.

### Task 3: Exact spatial inventory, source freeze and one global version

**Files:** Create `pipeline/roofs/city/inventory.ts`; modify `pipeline/roofs/sources.ts`, `pipeline/lib/{lock,version}.ts`; tests `pipeline/test/roof-city-inventory.test.ts`, `pipeline/test/roof-city-version.test.ts`.

**Interfaces:** Consume Task 1 journal/budget and Task 2 store/catalog. Produce `freezeRoofInputs(options: { journal: RunJournal; budget: WorkspaceBudget; store: ArchiveStore; sourceConfigPath: string; baseLockPath: string; dbPath: string }): Promise<{ lockRoot: ObjectRef; datasetVersion: string }>` and `planRoofBatches(journal: RunJournal, budget: WorkspaceBudget): AsyncIterable<BatchPlan>`. Produce `computeDatasetVersionStream(input: { lockBytes: AsyncIterable<Uint8Array>; newestRetrievedAt: string; codeHash: string; toolVersions: Record<string,string> }): Promise<string>` matching the legacy canonical logical-lock formula exactly.

- [ ] **1. Write failing tests** for all-depth EPT selection around complete footprints/50 m support, shared node reuse, a building spanning multiple cells, uniqueness of owner IDs, unknown metadata retained as null, changed source bytes during freeze and resume against frozen receipts. Compare streamed and existing version/lock hashes on small fixture locks; shuffled scheduling and physical catalog-part boundaries must not change them.
- [ ] **2. Run RED:** `npm run test:pipeline -- pipeline/test/roof-city-inventory.test.ts pipeline/test/roof-city-version.test.ts`.
- [ ] **3. Implement** SQLite-backed inventory cursors, deterministic spatial owner ordering and cost-based group splitting. Stream/hash/archive originals one bounded object at a time, with the four-stream acquisition limit. Freeze only when every required original/config/tool/base dependency is verified. Represent physical lock parts explicitly with a versioned root; never fabricate a flat lock or use a batch-specific dataset version. Refuse mutated frozen inputs.
- [ ] **4. Run GREEN** with the Step 2 command; assert a cross-cell building has identical ordered source identities to an unsplit fixture, no coarser EPT substitute, and frozen processing performs zero live-source requests.
- [ ] **5. Commit:** `feat(pipeline): freeze city roof inputs without full local acquisition`.

### Task 4: Stream lower-resolution imagery with conservative mask support

**Files:** Create `pipeline/roofs/imagery.py`; modify `pipeline/roofs/sources.ts`, `pipeline/roofs/filter.py`, `pipeline/roofs/config.json`; tests `pipeline/test/roof-imagery-source.test.ts`, `pipeline/roofs/tests/test_imagery.py`, `pipeline/roofs/tests/test_filter.py`.

**Interfaces:** Produce `iter_mask_windows(tile_records, bounds, pixel_m=0.12)` in `imagery.py`, yielding bounded `(affine, vegetation, valid, uncertain)` numpy windows; tile records identify exact archived RGB bytes, CRS, transform, dimensions and neighbor support. The caller supplies one decoded tile plus halo at a time. Extend source configuration with an explicit provider discriminator (`sf-wmts` or `naip-image-server`), advertised matrix metadata or bounded export parameters; validate exact band order and permissions before freezing. Keep the legacy algorithm readable; name the new optional mask algorithm `rooflines-rgb-pca-2` and pin its 0.12 m grid/validity behavior.

- [ ] **1. Write failing tests** for matrix 17/18/19 affine computation from 512-pixel capabilities, a different 256-pixel matrix, bounded year-specific NAIP exports, CIR supplied as RGB, disabled/unlicensed imagery, green roofs, shadows, unknown/missing neighbor pixels and a canopy crossing tile boundaries. Assert stitched versus untiled masks agree; uncertain-only support never rejects a return; current legacy mask fixtures still replay unchanged.
- [ ] **2. Run RED:** `npm run test:pipeline -- pipeline/test/roof-imagery-source.test.ts` and `pipeline/.venv/bin/python -m unittest discover -s pipeline/roofs/tests -p 'test_imagery.py' -v`.
- [ ] **3. Implement** provider parsing and streamed windows. Derive actual physical sampling from transforms, nearest-neighbor sample RGB classes onto the pinned ground grid, propagate validity/uncertainty and apply 0.24 m closing/0.60 m dilation only with sufficient halo. Keep the existing PCA/support requirements. Decode at most one image at once; never fetch “latest” imagery after freeze. Record algorithm change rather than silently altering version 1 morphology.
- [ ] **4. Run GREEN** with Step 2 and `pipeline/.venv/bin/python -m unittest discover -s pipeline/roofs/tests -p 'test_filter.py' -v`. Assert peak decoded image count 1 and bounded mask-window allocation, including neighboring tiles. Source age/registration flags survive into results.
- [ ] **5. Commit:** `feat(roofs): stream versioned aerial vegetation windows`.

### Task 5: Compact exact point identity and incremental processing

**Files:** Modify `pipeline/roofs/{geometry,point_archives,filter,process}.py`, `pipeline/roofs/{inputs,run}.ts`; create `pipeline/roofs/city/runner.ts`; tests `pipeline/roofs/tests/test_city_process.py`, existing `test_point_archives.py`, `test_process.py`; `pipeline/test/roof-city-runner.test.ts`.

**Interfaces:** Consume `BatchPlan`, frozen version/catalog and Task 4 mask windows. Produce `runRoofBatch(options: { batch: BatchPlan; datasetVersion: string; journal: RunJournal; budget: WorkspaceBudget; store: ArchiveStore }): Promise<ObjectRef>` returning the committed result-part reference. Define `iter_building_results(job)` in `process.py` as a generator of existing result records; retain the current CLI output contract through a streaming writer. Internal points use a 37-byte structured row and immutable sorted SHA dictionary; archive logical digests remain the existing 97-byte records.

- [ ] **1. Write failing tests** comparing compact/legacy source ordering, held-out split, logical digest, signed zero and coordinates at difficult CRS points. Compare decoded candidates, selectors and normalized outcomes for boundary buildings and shuffled group orders. Inject memory refusal, source corruption and an oversized single building; assert pause/fatal source error rather than a QA fallback. Assert previous clouds/results become releasable before the next group.
- [ ] **2. Run RED:** `pipeline/.venv/bin/python -m unittest discover -s pipeline/roofs/tests -p 'test_city_process.py' -v` and `npm run test:pipeline -- pipeline/test/roof-city-runner.test.ts`.
- [ ] **3. Implement** dictionary/index point identity without changing original whole-node transforms, f64 values or ordinal identity. Replace four simultaneous clouds with one bounded neighborhood; chunk PCA neighborhood temporary allocations without changing neighbor/tie semantics. Yield results immediately; archive candidate/evidence/result parts and checkpoint only after verification. Keep all candidate diagnostics and complete building outcomes. Do not add point thinning or relax fit/acceptance parameters.
- [ ] **4. Run GREEN** with Step 2 plus `npm run test:roofs` and the existing roof input/run pipeline tests. Compare legacy and compact decoded candidate/selection fixtures; separately measure the largest real cases in Task 9 rather than extrapolating a 37-byte row into a RAM claim.
- [ ] **5. Commit:** `perf(roofs): bound point clouds and stream exact building results`.

### Task 6: External finalization independent of processing batches

**Files:** Create `pipeline/roofs/city/finalize.ts`; modify `pipeline/roofs/{export,audit,check}.ts`, `pipeline/steps/build.ts`; tests `pipeline/test/roof-city-finalize.test.ts` and existing roof export/check tests.

**Interfaces:** Consume committed result parts and frozen base inputs. Produce `finalizeRoofRun(options: { journal: RunJournal; budget: WorkspaceBudget; store: ArchiveStore; datasetVersion: string }): Promise<ObjectRef>` returning the private final artifact-inventory root; do not publish the dataset root manifest in this function. Refactor existing encoders/audit writers to accept cursor/async record streams without changing public schema-1 bytes for the same ordered records and fixed volatile metadata.

- [ ] **1. Write failing tests** for one building across processing cells, multiple parcels, holes, unmatched pieces, zero-piece parents and all-fallback parents. Compare one batch, many batches, reverse completion and resumed runs: sorted mesh/index/audit outputs and stable IDs must match. Inject output overflow and assert flush/partition or capacity pause, never omission.
- [ ] **2. Run RED:** `npm run test:pipeline -- pipeline/test/roof-city-finalize.test.ts`.
- [ ] **3. Implement** external disk-backed sort keyed by existing chunk/building/piece ordering, globally complete audit joins and incremental artifact archival. Split final public chunks by the existing 4 MiB decoded/1 MiB gzip limits, independent of work-cell grouping. Apply the same manager to base PMTiles and other build intermediates; stream/re-fetch those outputs as needed. If a base-data native stage cannot satisfy the workspace cap, report a capacity blocker instead of ignoring its disk use.
- [ ] **4. Run GREEN** with Step 2 and existing roof export/audit/check tests. Assert complete parent/piece counts and unchanged public headers, coordinate encodings, hashes and same-version URLs with fixed timestamps. No final root manifest exists yet.
- [ ] **5. Commit:** `feat(pipeline): finalize city roof artifacts from bounded result streams`.

### Task 7: Selective cold rebuild, remote verification and root-last publication

**Files:** Modify `pipeline/roofs/{archives,rebuild,check}.ts`, `pipeline/steps/{fetch,upload,verify}.ts`; tests `pipeline/test/roof-city-restore.test.ts`, `pipeline/test/roof-city-publish.test.ts`.

**Interfaces:** Consume Task 2 catalog/store and Task 6 inventory root. Extend `rebuildRoofBuilding` with optional `workspaceBudget: WorkspaceBudget` and schema-2 selective closure while retaining legacy arguments. Produce `verifyFrozenRun(journal: RunJournal, store: ArchiveStore, budget: WorkspaceBudget): Promise<void>` and `publishFrozenRun(options: { journal: RunJournal; store: ArchiveStore; budget: WorkspaceBudget; artifactRoot: ObjectRef }): Promise<void>`. Both use streamed inventories and existing invariant validators; only the latter writes the final root manifest after verification.

- [ ] **1. Write failing tests** for cold rebuild from a city-sized synthetic catalog, missing/cyclic closure, mismatched tool/code hashes, interruption at every journal transition, object uploaded without receipt, receipt with corrupt bytes, and publication failure on the final artifact. Assert no unrelated closure is downloaded, no full local mirror appears and root manifest is the last successful PUT.
- [ ] **2. Run RED:** `npm run test:pipeline -- pipeline/test/roof-city-restore.test.ts pipeline/test/roof-city-publish.test.ts`.
- [ ] **3. Implement** selective source/processing restoration and lazy remote invariant passes, with schema-1 compatibility. Verify/restore under shared reservations; reuse frozen receipt evidence only with the same immutable SHA/length. Preserve source/tool/codec failure semantics and stage-only behavior. Final publication requires complete global counts, successful invariants and all verified output/archive receipts.
- [ ] **4. Run GREEN** with Step 2 and existing fetch/upload/verify/rebuild tests. A fresh empty workspace must rebuild one selected building and match its archived normalized mesh/outcome; a failed run must remain unpublished and resumable.
- [ ] **5. Commit:** `feat(pipeline): verify and restore city roofs without full local copies`.

### Task 8: Explicit resumable CLI and operator controls

**Files:** Modify `pipeline/cli.ts`, `docs/dev/rooflines.md`, `docs/dev/pipeline.md`; tests `pipeline/test/roof-city-cli.test.ts`.

**Interfaces:** Compose previous tasks behind new commands: `roof-city plan`, `roof-city freeze`, `roof-city run`, `roof-city finalize`, `roof-city verify`, `roof-city publish`, and `roof-city status`. All require `--workspace <path> --run-id <id>`; `plan` additionally requires source/base-lock/database paths. Default local budget is 50,000,000,000 bytes; accept an explicit smaller cap, never silently increase it. `publish` is separate from `run/finalize`; no command changes `PUBLIC_DATASET_VERSION`.

- [ ] **1. Write failing tests** for each dispatch, missing workspace, invalid budget, configuration mutation after freeze, resource-paused exit, resume, dry-run estimates and status without credentials. Assert `plan/status` make no network writes, `run` requires frozen inputs and only `publish` can write the root manifest.
- [ ] **2. Run RED:** `npm run test:pipeline -- pipeline/test/roof-city-cli.test.ts`.
- [ ] **3. Implement** command validation/orchestration and operator examples for inventory → freeze → run/resume → finalize → verify → explicit publish. Document credentials without values, disk/RAM monitors, interrupted transfer cleanup, receipt adoption, source outages, private remote retention/cost, and single-building rebuild. Preserve existing local commands and sample source config; do not change default coverage to citywide in this task.
- [ ] **4. Run GREEN** with Step 2; execute a tiny fixture end-to-end with an injected/local streaming archive backend and a deliberately small cap. Assert byte-accounted pause/resume and complete outputs, not just CLI success status.
- [ ] **5. Commit:** `feat(pipeline): expose resumable bounded city roof commands`.

### Task 9: Imagery/capacity pilot and citywide execution handoff

**Files:** Create `pipeline/roofs/city/pilot.ts`, `pipeline/roofs/city/pilot-cases.json`, `docs/dev/roof-city-pilot.md`; modify `pipeline/cli.ts`, `docs/dev/rooflines.md`, `docs/dev/map-perf.md`; tests `pipeline/test/roof-city-pilot.test.ts`.

**Interfaces:** Produce `runRoofPilot(options: { journal: RunJournal; store: ArchiveStore; budget: WorkspaceBudget; casesPath: string }): Promise<PilotReport>` and CLI `roof-city pilot` using Task 8 workspace/run options. Define a bounded report containing per-case source/algorithm/labels/mask/QA outcomes, actual byte/object/request counts, retransfers, throughput, process RSS and workspace high-water; retain full evidence remotely with verified references.

- [ ] **1. Write failing report/gate tests** for absent SF permission, unavailable image levels, no passing coarse imagery candidate, baseline-unavailable absolute criteria, new spikes/lost protected pitches, resource overruns and an unschedulable giant building. Assert incomplete pilot evidence cannot label citywide execution or release ready.
- [ ] **2. Run RED:** `npm run test:pipeline -- pipeline/test/roof-city-pilot.test.ts`.
- [ ] **3. Implement** pilot orchestration with predeclared labels/cases and the spec's exact resolution-selection thresholds. Include the 12 retained cases, eight additional negative/seam/change cases, three adjacent cells and largest vegetated/waterfront buildings. Measure full freeze/live fit/cold rebuild/finalize/interrupt-resume, not captured-candidate replay alone. Generate stratified city estimates from exact-footprint inventory, including uncertainties, storage/request cost and tail cases. Do not run the full city as a pilot.
- [ ] **4. Run GREEN and bounded pilot:** Step 2, `npm run test:roofs`, `npm run test:pipeline`, then the new `roof-city pilot` command on a declared workspace with an approved remote pilot budget. Record actual maximum local allocation <50,000,000,000 bytes and successful independent RAM admission. Compare batch/order/resume variants on the same frozen inputs. Run ordinary check/lint/unit/E2E/native-GPU signoff after code changes; retain actual M2-class headed performance as a distinct release gate if unavailable. Document whether imagery is enabled, which resolution passed and which cases remain fallback.
- [ ] **5. Commit:** `test(pipeline): characterize bounded city roof streaming and imagery`.

## Execution and rollout decisions

Tasks 1–3 establish the bounded backing store, freeze and deterministic identity. Task 4 can then test imagery independently of the compact point implementation in Task 5; Tasks 6–8 integrate only reviewed interfaces. Task 9 decides whether to execute the citywide run, whether smaller imagery suffices, and whether remote storage or giant-building memory needs another change. A successful pilot is not dataset promotion.

After the pilot, freeze a citywide source configuration and explicit remote storage/request budget, process/resume all batches under the same local cap, verify global results and cold restoration, then follow staging and dataset-promotion review. No new citywide acceptance quota, QA relaxation or terrain work is implied. The previously selected subagent-driven implementation method may be reused when this follow-up plan is approved for execution; opening the current PR does not execute it.

## Self-review

Design coverage: working-set/journal/RAM → Tasks 1/5/9; streaming transport/catalog/closure → Tasks 2/7; all-depth acquisition/version/ownership → Task 3; imagery rights/resolution/morphology → Tasks 4/9; exact identity and bounded fitting → Task 5; complete audits/deterministic output/base-data costs → Task 6; resume/root-last checks → Tasks 1/7/8; estimates/operator/pilot/release gates → Tasks 8/9. Each Review Focus failure has an explicit owning test. Types and producers/consumers are named above; new private schemas do not change public schema 1. This plan was self-reviewed for coverage, step specificity, interface consistency and proportionality. All execution checkboxes intentionally remain open.
