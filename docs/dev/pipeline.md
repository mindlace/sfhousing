# Data pipeline

`pipeline/` turns open sources (DataSF parcels, land use and footprints; Overture buildings; a Protomaps basemap extract; Noto Sans glyphs) into one immutable, versioned dataset: parcel chunks, `buildings.pmtiles`, `basemap.pmtiles`, fonts, neighborhoods and `manifest.json`. The Worker serves it from R2 (see [data-serving.md](data-serving.md)). Design: `docs/superpowers/specs/2026-10-10-data-pipeline-design.md`.

## Requirements

Node >= 22, `tippecanoe 2.79.0` and `pmtiles 1.31.2` on `PATH` (macOS: `brew install tippecanoe pmtiles`; Homebrew's pmtiles prints `dev`, so `doctor` falls back to `brew list --versions pmtiles`). DuckDB (`@duckdb/node-api`, a devDependency that never ships in the worker) downloads its `spatial` and `httpfs` extensions on first use. `npm run pipeline -- doctor` checks all of this and prints an install hint for anything missing.

## Commands

All run as `npm run pipeline -- <cmd>`.

| Command                                                         | Does                                                                                                               | Network |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------- |
| `doctor`                                                        | Checks Node, tool versions and that DuckDB extensions load. Exit 1 with a hint on any failure.                     | ext.    |
| `fetch [--only a,b] [--release <ov>] [--basemap-date <d>]`      | Downloads raw files to `.cache/raw/<sha256>`, normalises them, rewrites `sources.lock.json`.                       | yes     |
| `fetch --restore [--local]`                                     | Rebuilds `.cache` from the R2 `sources/` archive using the lock (works after upstream releases expire).            | R2      |
| `build [--skip-tiles]`                                          | Verifies cached files against the lock, runs SQL, tiles, chunks, manifest and the invariants, writing `out/<v>/`.  | none    |
| `check [<v>]`                                                   | Re-runs the invariants on `out/<v>/` (default: newest).                                                            | none    |
| `upload <v> [--local]`                                          | Archives sources, uploads artifacts with `manifest.json` last, prints the bump line. Never edits `wrangler.jsonc`. | R2      |
| `verify <v> --origin <url>`                                     | Fetches the manifest, checks every URL it names, range-reads both PMTiles expecting 206.                           | yes     |
| `fixture [--out <dir> --version fixture-<n>] [--update-golden]` | Builds `pipeline/test/fixtures/mini` into `e2e/fixtures/data/fixture-0/`.                                          | none    |
| `all [--release <ov>] [--basemap-date <d>]`                     | `fetch` (only if the lock is missing) then `build`. Never uploads.                                                 | yes     |

`npm run test:pipeline` runs the pipeline Vitest project; the shared codec in `src/lib/data/` is covered by `npm run test:unit`.

## Release run order

1. `npm run pipeline -- fetch` to refresh the sources and rewrite `pipeline/sources.lock.json` (`all` only fetches when the lock is missing, so it never refreshes an existing lock).
2. `npm run pipeline -- build` (cold about 15 to 25 minutes, warm rebuild 5 to 8). Every invariant must pass, without `--skip-tiles`.
3. Commit `pipeline/sources.lock.json`. The lock is not part of the code hash, so committing it does not change `<v>`: the commit that holds the lock rebuilds the same version.
4. `npm run pipeline -- upload <v>`. It refuses, with nothing uploaded, unless `out/<v>/report.json` shows every invariant passing and tiles built, every file the manifest names exists, and the current lock is the one that built `<v>` (its canonical sha256 is recorded in `report.json` as `lockSha256`; fixture versions skip this check because they archive nothing). It aborts if `data/<v>/manifest.json` already exists (V13).
5. `npm run pipeline -- verify <v> --origin https://<staging-origin>`.
6. Edit `PUBLIC_DATASET_VERSION` in `wrangler.jsonc` to `<v>` for staging, then for production via the normal release (see [deploy.md](deploy.md)). Old versions are never deleted, so saved plans keep loading.

## Where things land

- `pipeline/.cache/raw/<sha256>`, `pipeline/.cache/norm/<id>.parquet`: downloads and normalised inputs (gitignored).
- `pipeline/out/<v>/`: the dataset, plus `report.json` with all counts, timings and tool versions (gitignored).
- `pipeline/sources.lock.json`: committed; one entry per raw file with `sha256`, `bytes`, `archiveKey`, `upstreamVersion`, `license`.
- R2 bucket `sfhousing`: key `data/<v>/<path>`, served at `/data/<v>/<path>`; raw archives under `sources/<sha256>`.

## Lock and `datasetVersion`

The lock pins every input by sha256. `build` refuses to run if a cached file does not match it. `datasetVersion` is `<YYYY-MM-DD>-<h8>`: the date is the newest `retrievedAt` in the lock, `h8` hashes the canonical lock, the committed code under `pipeline/` plus `src/lib/data/` (a `git ls-tree` listing that excludes `sources.lock.json`, `.cache` and `out`, plus any uncommitted changes there), and the pinned tool versions. It is derived from inputs, so the same lock and code give the same version, and any change to pipeline code or the shared codec gives a new version. A published version is immutable; fixtures use `fixture-<n>`.

## Fixture

`pipeline fixture` builds hand-made sources in `pipeline/test/fixtures/mini/` into `e2e/fixtures/data/fixture-0/` and compares against `pipeline/test/fixtures/mini/golden/`. After an intentional change to the pipeline or the mini sources, run `npm run pipeline -- fixture --update-golden`, review the diff and commit both directories. `fixture-0` is generated: never hand-edit it. CI regenerates it and fails on any diff (excluding `buildings.pmtiles`, whose tippecanoe bytes may differ between platforms; its feature attributes are tested in `tiles.test.ts`).

## Invariants

`build` and `check` evaluate V1 to V13 and exit 1 on any failure, so nothing is uploaded. In short: V1 unit total within 2% of 413,208; V2 parcel count equals distinct active ids and lies in [140k, 170k]; V3 land-use match >= 99%; V4 known land-use values; V5 height coverage >= 95%; V6 piece area with a parcel >= 95%; V7 neighborhoods and label points; V8 each parcel in exactly one chunk, chunks round-trip; V9 chunk size limits; V10 tallest building 300 to 340 m; V11 first-paint budget; V12 determinism; V13 published versions are never altered. Thresholds live in `pipeline/config.ts`; the full table is spec section 4.9.

## ODbL obligations

`buildings.pmtiles`, `basemap.pmtiles` and the parcel chunks are Derivative Databases of ODbL data (OpenStreetMap, Overture), published under **ODbL-1.0**. The manifest `sources` carry each licence, with Overture expanded per contributing dataset, and `/attribution` renders the notice from them. Do not add a source without recording its licence in the lock. DataSF sources are PDDL or public domain (credit is courtesy). Spec section 4.12 has the visible-attribution wording.

## Partner actions

These need credentials the pipeline never holds and are not done by CI:

1. Create the R2 bucket `sfhousing` (shared by staging and production).
2. `wrangler login`, or provide CI credentials (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) with R2 write access.
3. Run the first real `npm run pipeline -- upload <v>` (remote), then `verify <v> --origin <staging>`.
4. Bump `PUBLIC_DATASET_VERSION` in `wrangler.jsonc`: staging first, then production via a release.
5. After the pinned Overture release expires upstream, prove the archive works: on a clean checkout run `npm run pipeline -- fetch --restore`, then `build` (AC-7).

## Optional roof inputs and tools

`npm run pipeline -- setup-roofs` is an explicit networked setup step. It requires Python
3.14.8 (`ROOF_PYTHON=/path/to/python` selects an interpreter), creates `pipeline/.venv`,
installs the complete hash-checked `pipeline/roofs/requirements.txt` wheel set, and verifies
roofer 1.0.0 before installing it under `pipeline/.cache/tools`. `doctor --roofs` checks
this environment; `npm run test:roofs` runs the offline Python input tests. Neither setup
nor Python is required by ordinary application builds or old no-roof datasets. Linux x64
and macOS arm64 artifacts are pinned in `toolchain.json`; pipeline CI exercises Linux.

`fetch --only roof-lidar` locks original intersecting EPT hierarchy pages and LAZ objects
for the three committed sample coverages, including 50 m ground support. Roof fetches
also record an explicit aerial descriptor, even when there are no permitted tiles.
2023 SF Planning imagery remains disabled with unconfirmed derivation permission. Enabling
it requires confirmed permission and recorded license terms; individual tile coverage and
EPSG:3857 pixel transforms are archived. Matching acquisition years do not establish
alignment. Unknown acquisition dates and vertical CRS remain explicit nulls rather than
invented precision; the archived EPT SRS supplies the vertical CRS when available.

`fetch`, `fetch --restore`, and `build` accept `--lock-path <path>` and `--raw-dir <path>`
for isolated caches. Restore verifies existing as well as downloaded bytes and reads only
R2 archive keys. Offline jobs verify all locked roof bytes before reading the full
`buildings` table after SQL 40, preserve EPSG:7131 footprints and fallback heights, and
retain original source SHA plus point ordinal through cropping. Processing inputs never
fetch upstream URLs. Roof configuration, Python code, toolchain and overrides participate
in the dataset code hash, and roof-bearing datasets include toolchain/package digests.

Permission evidence: the [official aerial catalog metadata](https://data.sfgov.org/api/views/3keh-kpm9.json)
attributes SF Planning but supplies no permission terms. Its title/description lag current
imagery years, so it does not establish 2023 imagery rights. This absence is recorded as
unconfirmed permission, never as permission to derive distributable geometry.

`runRoofJob` is the offline reconstruction boundary. Every building receives an accepted
mesh or a footprint fallback; nominal source coverage must contain its complete footprint
before point loading. Spatially indexed batches verify all locked inputs once and load
only intersecting nodes. Ground, training-only vegetation evidence, simplified/reference
candidates, bounded spike retry and common validation samples are audited separately.
An absent or unpermitted aerial can leave a valid LiDAR-only result; corrupt required
images, unavailable tools and incomplete runner results fail the job.

Build-only evidence is content-addressed under `roof-processing/<sha256>.<ext>` and cached
in `pipeline/.cache/roof-artifacts/<sha256>`. Each building's portable input record points
to complete source lock references, processing config/code/toolchain/override descriptors,
source extracts and candidates. Structured arrays use deterministic gzip-compressed
`.npy.gz` with original source SHA/ordinal identity; read with gzip then NumPy with
`allow_pickle=False`. Scratch paths and timing fields are excluded from portable evidence.

The real LiDAR regression fixtures and their provenance are documented in
`pipeline/test/fixtures/roofs/README.md`. `npm run test:roofs` runs the complete pinned
Python reconstruction suite. `ROOF_LOCAL_AERIAL_RESEARCH=1 npm run test:roofs` additionally
uses locally cached original aerials for the Whole Foods research comparison; no real
imagery is redistributed, and this opt-in does not establish published derivation rights.
The Salesforce authored loft is retained with exact production identity/hash and evidence,
but its current coverage fails the unchanged product checks and therefore falls back.

Roof-enabled builds pause SQL after `40_heights.sql`, reconstruct complete buildings from
locked inputs, then resume `50_clip.sql` through `70_export.sql` without clearing counts.
Roof solids intersect the retained parcel polygons with manifold3d; each resulting piece
has a stable `pieceId` shared by tiles, meshes and the complete audit. Unmatched pieces
keep `parcelId: null`. Failed pieces retain the existing fallback height/base/height source,
and parents whose pieces were all dropped by the existing area cutoff remain in the audit.
Parcel records, eligibility, unit totals and generated massing do not use roof data.

`roofs/index.json` points to numbered cell chunks. `gzipBytes` is the exact sum of gzip-9
header and mesh body sizes; admission also includes the uncompressed index-entry bytes.
The decoded budget counts actual header, binary and index-entry bytes. Exported XY is the
offline inverse of the pinned deck METER_OFFSETS projection, including second-order scale;
Z remains the relative height above zero ground. Every chunk is decoded again before writing.
`roofs/audit.json` and `roofs/report.json` carry outcomes and quality evidence. Processing
artifacts stay in `.cache/roof-artifacts/<sha256>` and their `roof-processing/<sha256>.<ext>`
references are retained as `roofArchives` in the build report for archival publication.
Legacy locks without roof coverage skip this stage and retain their original tile schema.

At city scale, the complete audit exceeds Node's maximum string size. The writer validates
one parent family at a time and streams individual records into the same JSON schema.
Reconstruction and clipping use internal NDJSON exchanges with terminal counts and
cross-record archive validation; the public runner interfaces and archived JSON remain
unchanged. Complete source metadata occurs once per job, with each file descriptor carrying
only its own object and imagery transform. Consumers of the city audit must use streaming
JSON parsing rather than reading the entire artifact into one JavaScript string.

### Roof publication and recovery

Roof-enabled reports require V14 (artifact/identity integrity), V15 (size and geometry
acceptance), and V16 (complete deterministic audit). Upload rechecks current bytes, decoded
hashes, closed solids, measured chunk budgets, parent/piece outcomes, processing references,
and original sources before the first R2 write. Legacy reports remain publishable for
no-roof datasets. An unsupported descriptor schema validates/copies its three top-level
URLs without interpreting its index.

`setup-roofs` also caches all pinned platform wheels and roofer source/release archives in
`pipeline/.cache/roof-dependencies/<sha256>`. Offline builds reverify and retain these in
`roof-artifacts`; missing required dependencies fail the build. `report.json.roofArchives`
closes portable jobs, masks, candidates, configuration/code and tool distributions. Private
archives upload first using bounded concurrency/retries, runtime artifacts follow, and the
root manifest is last. `upload --local`, fixture loading and `data:local` reuse a single
Miniflare instance with Wrangler's `.wrangler/state/v3` storage; local archive existence
uses HEAD rather than downloading each object. Remote uploads retain Wrangler's existing
credential and transport behavior. That remote transport still starts a process per object
and downloads existing objects for existence checks; full-city publication can contain over
a million archives and requires a reusable remote backend before release validation. The
local backend and local tests do not establish remote publication throughput.

`fetch --restore --roof-run <datasetVersion> [--local]` downloads that version's public
build report, restores and verifies its processing archives, and restores original roof
source references alongside the lock's raw sources. It does not contact upstream HTTP.
`roof-rebuild <datasetVersion> --building <buildingId> --out <empty-directory> [--local]`
restores the portable job, checks the recorded configuration, processing code and toolchain
against the checkout, and processes only the requested full building into `result.json`.
A mismatch requires checking out the recorded processing revision and running `setup-roofs`.
The published dataset is never modified. `--raw-dir` can isolate the restored source cache.

The mini fixture includes deterministic synthetic original LAZ returns for b01 and the
multi-parcel b10. Roofer and the production clip/export path generate three closed display
pieces; other buildings retain explicit fallbacks, including a retained parent with no pieces.
Run `npx tsx pipeline/test/fixtures/mini/make-fixture.ts` to regenerate original sources and
then `pipeline fixture --update-golden`. Roof JSON and binary outputs participate in
cross-run golden comparisons. Ordinary app CI consumes committed output without Python.
A frozen no-roof manifest remains under `pipeline/test/fixtures/legacy`.

Audit validation streams bounded records using the development-only `@streamparser/json`
parser, retaining compact identity/completeness state rather than a city-sized JSON string.
The geometry config currently supports the exact approved schema-1 values; changing a value
without implementing its behavior fails explicitly. Complete imagery coverage is reported
only after measured point/cell raster coverage; image presence alone remains unknown.
Source config records the official catalog review and absent permission terms; 2023 imagery
remains disabled and unconfirmed, and no original imagery is included in runtime artifacts.

Readers can measure an exact index-entry contribution only after comparing the original
index bytes against the canonical `JSON.stringify(parseRoofIndex(raw, version))` bytes.
The current exporter uses that same key order. On an exact byte match, the UTF-8 size of
`JSON.stringify(ref)` is the verified entry contribution; otherwise use the whole measured
index byte length conservatively. Whitespace or unknown fields must fail the exact-match
path before schema parsing strips fields. Browser readers can use `TextEncoder` for the
same comparison and measurement; the pipeline implementation is in `roofs/check.ts`.
