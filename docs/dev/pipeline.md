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

`build` and `check` evaluate V1 to V14 and exit 1 on any failure, so nothing is uploaded. In short: V1 unit total within 2% of 413,208; V2 parcel count equals distinct active ids and lies in [140k, 170k]; V3 land-use match >= 99%; V4 known land-use values; V5 height coverage >= 95%; V6 piece area with a parcel >= 95%; V7 neighborhoods and label points; V8 each parcel in exactly one chunk, chunks round-trip; V9 chunk size limits; V10 tallest building 300 to 340 m; V11 first-paint budget; V12 determinism; V13 published versions are never altered; V14 `transit.json` decodes, has >= 3,000 stops and heavy-rail service at the 8 SF BART stations (it warns above 400 KB). Thresholds live in `pipeline/config.ts`; the full table is spec section 4.9 (V14: transit spec section 4.3).

## ODbL obligations

`buildings.pmtiles`, `basemap.pmtiles` and the parcel chunks are Derivative Databases of ODbL data (OpenStreetMap, Overture), published under **ODbL-1.0**. The manifest `sources` carry each licence, with Overture expanded per contributing dataset, and `/attribution` renders the notice from them. Do not add a source without recording its licence in the lock. DataSF sources are PDDL or public domain (credit is courtesy). Spec section 4.12 has the visible-attribution wording.

## Partner actions

These need credentials the pipeline never holds and are not done by CI:

1. Create the R2 bucket `sfhousing` (shared by staging and production).
2. `wrangler login`, or provide CI credentials (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) with R2 write access.
3. Run the first real `npm run pipeline -- upload <v>` (remote), then `verify <v> --origin <staging>`.
4. Bump `PUBLIC_DATASET_VERSION` in `wrangler.jsonc`: staging first, then production via a release.
5. After the pinned Overture release expires upstream, prove the archive works: on a clean checkout run `npm run pipeline -- fetch --restore`, then `build` (AC-7).
