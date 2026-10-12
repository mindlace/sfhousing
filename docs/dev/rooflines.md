# Existing-building roof operations

Roofs are optional, versioned display data on flat ground. They do not change parcel records,
units, eligibility, zoning, generated massing, scores, the simulation protocol, saved plans or
`SimMapHandle`. Full buildings are reconstructed before parcel clipping; replacing one parcel
does not replace another parcel's roof piece. The existing footprint and height rules remain
the fallback. See [pipeline.md](pipeline.md), [map-perf.md](map-perf.md) and
[deploy.md](deploy.md) for their surrounding workflows.

## Current checkpoint and coverage

The local checkpoint is validated within the scopes below. **Whole Task 10, full SF roof
coverage, release readiness and M2-class execution remain unmet.** The pending coverage question
does not remove the full-coverage requirement. There is no citywide acceptance quota or approved
lower-density default.

The preview at <http://localhost:4190> uses `2026-10-12-c9b71965`, in worktree
`/Users/mindlace/.codex/worktrees/roofline-spec/sfhousing`, branch `codex/roofline-spec`.
It is the retained **roofer 1.0.0** sample, used for runtime/backward-compatibility review;
it is not a rebuild with the current beta. Preview availability is local and temporary.

`pipeline/roofs/source-config.json` covers only these nominal WGS84 rectangles, plus 50 m
ground support:

| Area     | West, south, east, north               |
| -------- | -------------------------------------- |
| downtown | -122.3975, 37.789, -122.3957, 37.7905  |
| mission  | -122.414, 37.7537, -122.4124, 37.755   |
| hillside | -122.4313, 37.7511, -122.4297, 37.7524 |

The ignored sample lock is `pipeline/.cache/sample-sources.lock.json`: roof source release
`2023`, retrieved `2026-10-12T00:53:11.010Z`, 663 original LiDAR metadata/hierarchy/LAZ objects,
and an explicit aerial descriptor with zero tiles. It retains Overture `2026-09-23.1` retrieved
`2026-10-11T03:52:58.496Z`, basemap `20261010` and fonts commit
`028c18f713baecad011301ff7a69acc39bcc2ae7`. The ordinary committed lock is not this sample lock.
LiDAR uses the USGS `CA_SanFrancisco_1_B23` EPT source, EPSG:3857 horizontally; acquisition dates
and vertical CRS in the sample lock are explicitly null. Do not replace nulls with guessed dates
or a datum. Available broader EPT coverage is not evidence that SF coverage was acquired/built.

The historical sample build passed V1–V16: 162,733 parents / 337,455 pieces, 42 `fully_modelled`, 8
`partly_modelled`, 162,683 `all_fallback`; 98 `lidar_only` pieces / 337,357 fallback pieces.
Most fallbacks are outside the three areas. Its 2,194,663,210-byte audit requires streaming.

| Known building                                     | Sample outcome                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Whole Foods `3016508c-f86a-46dd-b8b9-869ee552395f` | Both pieces `spike_unresolved`; no claimed upper/lower reconstruction                                    |
| Salesforce `626a57f8-ccf3-497d-a764-266e91e9253d`  | Both pieces `roof_coverage_low`; authored override retained but inactive                                 |
| `a96b2333-08e3-4167-b7d6-6b21ba3ad017`             | `p-6c541e4e10e7ce8b8c863a4f` modelled; `p-87db11fc77cda6d5dbd0378f` `invalid_geometry` fallback          |
| Hillside `6b033538-2e77-468c-8f21-9c7ee6bbd2d6`    | Modelled pitched roof                                                                                    |
| Mission `3a56e932-d9d8-49dd-b05e-5662ec65b7b5`     | Three modelled pieces, including two parcels and one unmatched piece; single-parcel editing/Undo checked |

Courtyard evidence uses `fixture-0`, not the real sample. Painting proves the unmatched piece
is not replaced; the unchanged generator drops parcel holes, so generated mass can occlude
the courtyard. The before/Undo images show the hole. State preservation alone does not prove
visible courtyard pixels beneath generated geometry.

## Toolchain and rights

Install the ordinary [pipeline prerequisites](pipeline.md#requirements) first. Roof setup needs
Python **3.14.8** and a supported platform, `darwin-arm64` or `linux-x64`:

```sh
ROOF_PYTHON=/path/to/python3.14 npm run pipeline -- setup-roofs
npm run pipeline -- doctor --roofs
```

Setup is explicitly networked; it creates `pipeline/.venv`, installs the complete hash-checked
binary wheel set, verifies roofer archives, installs bin/share together, chmods the executable
without changing bytes, and caches all platform distributions for archival closure. It is not
called by build. `doctor --roofs` includes ordinary tool/extension checks plus exact roof package,
full fitter version/commit and installed executable receipt checks. Missing or corrupt required
sources/tools/codecs abort processing or publication; they are not ordinary building fallbacks.

The effective fitter is official prerelease **1.1.0-beta.1**, source commit
`1c06fb1aed9096f4b16f894c2da12bc2d785b71b`. Verified distribution pins in
`pipeline/roofs/toolchain.json` are:

| Distribution |      Bytes | SHA-256                                                            |
| ------------ | ---------: | ------------------------------------------------------------------ |
| Source tar   |  3,174,121 | `a08b13898c8e75f85f08c5c0454278c6153529b2382f863f090db0276b8b869c` |
| macOS ARM64  | 15,793,454 | `88cb6a9cd775f59b230f961c0a9fc9f6f01106bff0b3715ce8c32bf90f390ba1` |
| Linux x64    | 20,526,294 | `12096b4bc2f96d9134aba4b9a5d9268c06c69b873619a742b08c6f22ba2c2e99` |

Installed Mac executable SHA is
`c8e616be2eb0f44334c6a3a0db9a69f8da3996170b065dba31a87535d0208c00`.
Mac execution is measured; Linux archive verification is not Linux execution. This is verified
binary provenance, not a reproducible source build or proof of other Mac/M2 compatibility.
Python packages remain numpy 2.5.4, scipy 1.18.1, shapely 2.2.0, laspy 2.7.0, lazrs 0.8.2,
pillow 12.3.0, pyproj 3.8.0, manifold3d 3.4.1 and certifi 2026.7.22.

Algorithm `rooflines-rgb-pca-1` is pinned by `pipeline/roofs/config.json`. Every fit supplies
`--cj-scale .0001 .0001 .0001 --min-building-density 1 --unit-scale 1 --jobs 1`, classes 1/2,
LoD2.2, supplied flat ground and `--no-clip-terrain`. Simplified/reference/retry complexity and
plane support remain `.4/50`, `.888/15`, `.6/50`. Supported deprecated
`--plane-detect-min-points` and `--h-terrain-strategy` aliases remain; native warnings name future
TOML paths and removal in 2.0. Do not invent replacement flags. Ground uses class-2 fifth
percentile within 4 m, then nearest support within 50 m; acceptance remains 98% roof coverage,
95% validation coverage, 50 roof-training returns, 20 validation samples and the pinned geometry
checks. No source-density or QA relaxation was approved.

Three-repeat bounded Mac beta characterization matched decoded candidates and complete selector
results, including triggered retries. Native CityJSON vertex/face order and unused azimuth/slope
metadata still vary; decoding consumes surface types. This does not establish global, citywide,
cross-platform or raw-output determinism, nor isolate one upstream repair as the cause.

USGS LiDAR is recorded public domain; preserve source credits and Overture/OSM-derived ODbL
notices in the lock, manifest and `/attribution`. SF Planning 2023 imagery is disabled:
[official catalog metadata](https://data.sfgov.org/api/views/3keh-kpm9.json), reviewed 2026-10-11,
does not establish derivation/redistribution permission. Confirm and record terms before enabling
it; same-year captures do not establish alignment. Missing/unpermitted imagery permits a valid
LiDAR-only result, with limitations recorded as flags. Research-only imagery comparisons do not
establish publication rights. Raw imagery/clouds never become browser assets.

## Fetch, build, check and local preview

Run from the recorded checkout. An acquisition refresh rewrites the selected lock and requires
source/network budget authorization; it is different from replaying an existing lock:

```sh
# Refresh only the configured roof coverage; preserves other entries in this copied lock.
npm run pipeline -- fetch --only roof-lidar --lock-path pipeline/.cache/sample-sources.lock.json --raw-dir pipeline/.cache/raw
# Offline locked build; requires all matching original bytes and installed tools.
npm run pipeline -- build --lock-path pipeline/.cache/sample-sources.lock.json --raw-dir pipeline/.cache/raw
npm run pipeline -- check <new-version>
# Runtime files only, into this checkout's local Wrangler R2; also clears local Cache API state.
npx tsx scripts/r2-load-local.ts pipeline/out/<new-version> <new-version>
```

Use a local `.dev.vars` dataset override as described in [developing.md](developing.md), then
`npm run dev`; do not commit that override or change production variables for local review.
The loader copies every file beneath its input directory; it does not archive private processing
objects or original sources and is not a release upload. A beta rebuild derives a new version;
it must not overwrite/relabel the historical sample. A committed source-coverage expansion must
describe exactly what was fetched. There is no full-SF coverage switch in the CLI; changing
coverage requires a reviewed configuration/lock change and a capacity-approved fetch/build/check.

## Private archives, empty restore and one-building replay

Private originals use `sources/<sha256>.<ext>` and processing evidence uses
`roof-processing/<sha256>.<ext>`; `report.json.roofArchives` closes dependencies, portable input,
masks, all candidates, source references and clipping evidence. Upload validates hashes, closure,
V14–V16 and the building/piece outcomes before any write, archives private objects first, runtime
files next and **root `manifest.json` last**. Runtime audit URLs contain provenance, not raw clouds.

```sh
# Existing CLI workflow uses the checkout's default lock/raw/processing caches.
npm run pipeline -- upload <version> --local
npm run pipeline -- fetch --restore --local --roof-run <version> --lock-path <copied-lock> --raw-dir <empty-raw-dir>
npm run pipeline -- roof-rebuild <version> --building <building-id> --out <empty-output-dir> --raw-dir <raw-dir> --local
```

**Cache isolation caveat:** `--raw-dir` does not isolate processing evidence. CLI restore/rebuild
still use `pipeline/.cache/roof-artifacts`. CLI upload uses the default committed lock and caches;
it does not implement `--lock-path`/`--raw-dir` overrides. Do not add those flags expecting them to
work. Use a clean isolated checkout at the recorded revision, or existing APIs with explicit cache
paths. The following small local-only harness controls both empty restore directories and R2
storage. Save as `pipeline/.cache/roof-restore.ts` in the matching checkout:

```ts
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readLock } from '../lib/lock';
import { localR2Target } from '../lib/r2';
import { upload } from '../steps/upload';
import { fetchAll } from '../steps/fetch';
import { rebuildRoofBuilding } from '../roofs/rebuild';

const [version, lockFile, dataset, rawCache, processingCache, scratch, buildingId] =
  process.argv.slice(2);
assert(version && lockFile && dataset && rawCache && processingCache && scratch && buildingId);
const root = resolve(scratch);
mkdirSync(root, { recursive: true });
assert.equal(readdirSync(root).length, 0, 'scratch must initially be empty');
const rawDir = join(root, 'restored-raw');
const archiveDir = join(root, 'restored-processing');
assert(!existsSync(rawDir) && !existsSync(archiveDir));
const r2 = await localR2Target({ projectRoot: join(root, 'local-r2') });
try {
  assert.equal(
    await upload({
      datasetVersion: version,
      outDir: resolve(dataset),
      lock: readLock(resolve(lockFile)),
      rawDir: resolve(rawCache),
      roofArchiveDir: resolve(processingCache),
      rawByName: version.startsWith('fixture-'),
      target: r2
    }),
    0
  );
  assert.equal(
    await fetchAll({
      restore: true,
      lockPath: resolve(lockFile),
      rawDir,
      roofRun: version,
      roofArchiveDir: archiveDir,
      r2
    }),
    0
  );
  await rebuildRoofBuilding({
    datasetVersion: version,
    buildingId,
    rawDir,
    archiveDir,
    outDir: join(root, 'rebuilt-building'),
    r2
  });
} finally {
  await r2.dispose();
}
```

```sh
npx tsx pipeline/.cache/roof-restore.ts <version> <matching-lock> <dataset-dir> <original-raw-cache> <original-processing-cache> <empty-scratch-dir> <building-id>
```

Budget this operation before running it: retained originals, local R2, restored caches and native
replay can consume several physical copies. Never delete sole copies of historical evidence.
The API workflow was exercised with tiny current-beta sources, empty raw/processing restore and
real native rebuild/export parity. Installed tools already existed; this is not fresh-machine
offline installation. Single-building replay writes `result.json` into a separate empty directory,
restores the report's archive closure, verifies exact code/config/toolchain dependencies and
processes only the requested full building; it does not publish or parcel-export that result.

Historical 1.0.0 jobs require their recorded code and pins. Current beta code intentionally refuses
their toolchain/dependency mismatch. Check out the recorded revision and run its `setup-roofs`
before native replay. Dynamic negative testing covered toolchain mismatch; the unchanged
processing-code mismatch gate was statically reviewed, not dynamically exercised in the upgrade.

Reference/subset schema 1 private archives regenerate float64 XYZ/class/SHA/ordinal rows from
verified original LAZ, without re-cropping/quantization. Legacy expanded NPY/gzip archives remain
readable with strict dtypes and `allow_pickle=False`. `read_evidence` defaults to a 2 GiB per-array/
node allocation limit; it returns expanded arrays and is not a bounded-memory whole-city reader.
Unknown private versions, corrupt sources or codec data fail; runtime/audit schema stays 1.

## Bounded audit queries

Use `roofs/report.json` for compact aggregate counts. It contains `counts` keys
`roofs.building_outcome.<fully_modelled|partly_modelled|all_fallback>`,
`roofs.neighborhood.<name>.<outcome>`, `roofs.reason.<reason>`, `roofs.modelled` and
`roofs.fallback`. Neighborhood is not an audit-record field. For example:

```sh
node - pipeline/out/<version>/roofs/report.json <<'JS'
const fs = require('node:fs');
const { counts } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const [key, value] of Object.entries(counts)) {
  if (/^roofs\.(building_outcome|neighborhood|reason)\./.test(key)) console.log(key, value);
}
JS
```

The complete audit has `buildings[]` and `pieces[]`. Parent outcomes differ from piece outcomes
(`modelled` / `footprint_fallback`); selected candidate is `processing.selectedCandidate`, primary
piece rejection is `reason`, additional limitations are `flags`, and revisits use
`followUp.reasons`. Unavailable metrics use `{value: null, unavailableReason: ...}`. Aerial flags
on accepted LiDAR-only pieces do not mean the piece fell back.

Save this bounded query as `pipeline/.cache/roof-query.ts`, then pass audit path, exact version
and a reason. It validates each record via the existing 64 KiB streaming reader (8 MiB record
limit) and retains only small aggregate maps; do not `JSON.parse`/slurp the multi-gigabyte audit:

```ts
import assert from 'node:assert/strict';
import { streamRoofAudit } from '../roofs/audit-reader';
const [path, version, reason] = process.argv.slice(2);
assert(path && version && reason);
const counts = new Map<string, number>();
await streamRoofAudit(path, version, (kind, record) => {
  const key = `${kind}.${record.outcome}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
  if (kind === 'pieces' && 'reason' in record && record.reason === reason) {
    console.log(
      JSON.stringify({
        buildingId: record.buildingId,
        pieceId: record.pieceId,
        parcelId: record.parcelId,
        reason: record.reason,
        flags: record.flags
      })
    );
  }
});
console.error(Object.fromEntries(counts));
```

```sh
npx tsx pipeline/.cache/roof-query.ts pipeline/out/<version>/roofs/audit.json <version> invalid_geometry
```

For neighborhood-specific record lists, join against the matching archived building metadata or
the same retained source geometry used by export; do not invent an audit `.neighborhood` field.
Report counts already apply export's largest-intersection neighborhood assignment.

## Footprint changes and landmark updates

Use `footprint_hash` in `pipeline/roofs/geometry.py` on the retained EPSG:7131 footprint: it snaps
identity to 1 mm, normalizes ring direction/start and polygon ordering, then hashes canonical JSON.
Exact source geometry is retained for Boolean clipping; the identity encoding is not replacement
geometry. A changed source/footprint produces new identities and dataset version. Compare the
old/new footprint, source release, parcel intersections and audit before accepting the change.

Salesforce is the only initial authored override. Identity/hash mismatch yields `override_stale`.
Do not merely replace its hash to bypass that guard. Re-author/review against the new retained
footprint and source evidence; update `overrideVersion`, production footprint/source, measured
versus approximate ranges, limitations and validation together in
`pipeline/roofs/overrides/salesforce.json`. Rebuild/check the new immutable dataset and inspect the
actual clipped/Float32 result. A matching hash still must pass coverage/geometry checks; the current
sample's override fails coverage and remains a footprint.

## Runtime fallback and required verification

At zoom 15+, the browser lazily loads schema-1 roof chunks, at most four jobs and one viewport
margin, with 30-second failure backoff. Active chunk layers and matching per-piece extrusion
suppression switch together; failure/eviction/zoom-out restores footprints. Combined accounted
CPU/GPU ownership and reservations are capped at 64 MiB. Accounting includes a conservative
2 MiB opaque program reservation per layer, not measured physical GPU program memory.

Missing `KHR_parallel_shader_compile` deliberately retains footprints without roof compilation/
allocation. Ordinary software tests prove this fallback; they do not prove positive roof rendering.
Run the separate required supported-hardware gate in addition to ordinary suites:

```sh
npm run test:roofs
npm run test:pipeline
npm run test:unit
npm run test:e2e
npm run test:roofs:gpu
npm run check
npm run lint
npm run bench:map
BENCH_DATASET_VERSION=2026-10-12-c9b71965 npm run bench:map -- --grep 'actual roofs'
```

`ROOF_GPU_HEADED=1 npm run test:roofs:gpu` selects headed execution; the gate asserts actual
hardware capability (native Metal on macOS). Unsupported descriptor versions retain validated
same-version URLs for copying/verification but use legacy parcelId promotion and footprints;
old no-roof datasets continue to load. Supported-schema data-load failures retain pieceId
promotion while leaving affected footprints visible. These runtime outcomes do not rewrite the
archived reconstruction audit. A bad source/tool/integrity failure is fatal offline, whereas an
individual unusable candidate/piece receives its explicit conservative reconstruction fallback.

The reviewed [map benchmark evidence](map-perf.md#explicit-real-roof-sample-benchmark) is M5 Pro,
Chromium 156.0.8078.4/Metal/KHR, 1280×800 CSS px, DPR 2, observed ~120 Hz, historical sample index
SHA `49384f5d1e8954bdd28ada6de1a6e2e0686e3bfa04029f962de46d357bc47faf`.
Four 1,200-frame paths measured p95 8.6–8.9 ms; synthetic regression p95 9.9 ms; real first-idle
2,344,875 encoded bytes; zero observed longtasks through activation/disposal. Transition peak
8,388,608 accounted bytes, two jobs/layers does not establish 64 MiB pressure, four-job saturation,
full-city tails or M2 execution. rAF cadence is not GPU-only timing.

Final local verification on product commit `4bdbeff5d152b56d1a0e6561deb52171a6c00351`,
2026-10-12, was run sequentially by the controller:

| Command / check                 | Observed result and scope                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm run test:unit`             | 132 files / 1,279 passed                                                                                    |
| `npm run test:e2e`              | 120 passed / 34 device-specific skips; default first-idle and generated latency checks included             |
| `npm run test:roofs:gpu`        | 32 native unit/integration and 14 E2E passed; M5 Metal/KHR asserted                                         |
| `npm run check`                 | Zero errors / warnings                                                                                      |
| `env -u VITE_E2E npm run build` | Production build passed                                                                                     |
| Production client scan          | 35 JS files hashed; debug APIs and observation calculations/calls absent; inert private placeholders remain |

The unchanged backend's reviewed evidence at `0ee85a7` is `npm run test:roofs` (47 passed,
one optional aerial-rights skip), `npm run test:pipeline -- --maxWorkers=1` (245 passed), and
the four shared roof-contract files (47 passed). Backend suites were not redundantly repeated
after benchmark/docs-only work. The native fresh-program probe took 161.4 ms over 10 nonblocking
polls with no observed longtasks; asynchronous preparation duration is separate from main-thread
task duration. Full lint and documentation validation are recorded in the final operator report.

## Capacity and release handoff

Current archive representation reduces stored point evidence but retains 289-byte expanded rows
in memory and batch-four/retained-result costs. A frozen stage-B ordinary captured-candidate replay
(940,778 points, original-source decoding, no native fit) proved exact logical-role/candidate/
outcome and actual clipping/Float32 parity, plus isolated local R2 empty restore/read. Whole owned
archives fell 22,944,441 → 1,962,515 bytes (11.691×); sampled tree RSS 1.040 GiB and scratch
1.361 GiB stayed within separately authorized 3 GiB/6 GiB caps. This is representation evidence,
not a current-beta native rebuild or a city forecast.

The original large preflight refusal is retained: 8.052 GiB uncompressed headroom versus 14 GiB
required; no large worker started. Vegetated/waterfront cases remain unexecuted. Historical
4.10–7.77 TB per-copy and 19–40 day scenarios concern legacy expanded archives at full density;
they are not measured current reference-archive forecasts. Do not project the ordinary ratio
citywide. Current large-case bytes/RSS/capacity, four-cloud memory, retained results, unknown
footprint/height tails and the 32 MiB metadata gate remain unresolved. Compact in-memory identity,
recipe and source-part proposals are future work, not implemented capacity solutions.

Remote transport still uses a process per object and downloads existing objects for existence
checks. A city closure may exceed a million objects; local Miniflare throughput does not establish
remote release throughput. A reusable remote backend and measured complete closure/capacity are
open prerequisites. No source-density reduction or swap-dependent guard relaxation follows from
these observations.

Completed evidence covers the historical sample V1–V16, reviewed current beta tiny reconstruction/
restore, ordinary representation checkpoint, named local runtime review and M5 benchmark. Final
controller verification results are recorded in the operator task report. Accepted output includes
known NO_COLOR/FORCE_COLOR, bundle-size, devalue ignored-import, favicon 404 and laspy ctypes
warnings; passing assertions do not mean pristine logs. Corrected covering reruns do not erase
earlier failed full-suite attempts.

Release actions require explicit authorization after the open gates are resolved. Follow
[deployment](deploy.md#promoting-a-datasetversion): `npm run signoff` before pushing the PR branch;
authorized `npm run pipeline -- upload <new-version>` (remote write), then
`npm run pipeline -- verify <new-version> --origin https://sfhousing-staging.mindlace.net`, stage
the dataset variable and inspect map/attribution, then promote in a later production PR/release.
No new release system is introduced. The current prior production/staging version is
`2026-10-11-697b4599`; rollback selects that retained immutable version through the same release
flow, without editing published data or migrating plans. Reconfirm the deployed prior version
when actually releasing. This local handoff neither publishes nor authorizes publication.
