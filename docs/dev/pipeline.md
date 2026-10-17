# Data pipeline

`pipeline/` turns open sources (DataSF parcels, land use and footprints; Overture buildings; a Protomaps basemap extract; Noto Sans glyphs; Muni, BART and Caltrain GTFS) into one immutable, versioned dataset: parcel chunks, the FZP scenario parcel file `scenarios/fzp/parcels.bin`, `buildings.pmtiles`, `basemap.pmtiles`, fonts, neighborhoods, `transit.json` and `manifest.json`. The Worker serves it from R2 (see [data-serving.md](data-serving.md)). Design: `docs/superpowers/specs/2026-10-10-data-pipeline-design.md`.

## Requirements

Node >= 22, `tippecanoe 2.79.0` and `pmtiles 1.31.2` on `PATH` (macOS: `brew install tippecanoe pmtiles`; Homebrew's pmtiles prints `dev`, so `doctor` falls back to `brew list --versions pmtiles`). DuckDB (`@duckdb/node-api`, a devDependency that never ships in the worker) downloads its `spatial` and `httpfs` extensions on first use. `npm run pipeline -- doctor` checks all of this and prints an install hint for anything missing.

## Commands

All run as `npm run pipeline -- <cmd>`.

| Command                                                         | Does                                                                                                                                                               | Network |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `doctor`                                                        | Checks Node, tool versions and that DuckDB extensions load. Exit 1 with a hint on any failure.                                                                     | ext.    |
| `fetch [--only a,b] [--release <ov>] [--basemap-date <d>]`      | Downloads raw files to `.cache/raw/<sha256>`, normalises them, rewrites `sources.lock.json`.                                                                       | yes     |
| `fetch --restore [--local]`                                     | Rebuilds `.cache` from the R2 `sources/` archive using the lock (works after upstream releases expire).                                                            | R2      |
| `build [--skip-tiles]`                                          | Verifies cached files against the lock, runs SQL, tiles, chunks, the scenario step (`scenarios/fzp/parcels.bin`), manifest and the invariants, writing `out/<v>/`. | none    |
| `check [<v>]`                                                   | Re-runs the invariants on `out/<v>/` (default: newest).                                                                                                            | none    |
| `upload <v> [--local]`                                          | Archives sources, uploads artifacts with `manifest.json` last, prints the bump line. Never edits `wrangler.jsonc`.                                                 | R2      |
| `verify <v> --origin <url>`                                     | Fetches the manifest, checks every URL it names, range-reads both PMTiles expecting 206.                                                                           | yes     |
| `fixture [--out <dir> --version fixture-<n>] [--update-golden]` | Builds `pipeline/test/fixtures/mini` into `e2e/fixtures/data/fixture-0/`.                                                                                          | none    |
| `all [--release <ov>] [--basemap-date <d>]`                     | `fetch` (only if the lock is missing) then `build`. Never uploads.                                                                                                 | yes     |

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
- `pipeline/.cache/derived/<v>/parcel-panel.parquet` and `parcel-lineage.parquet`: the T13 files, the parcel-by-roll-year panel and the retired-to-current parcel lineage, read by consumers in the same build and by project-records. They are build-internal and never uploaded (gitignored). `BuildOpts.derivedRoot` in `pipeline/steps/build.ts` sets the root: the default is `pipeline/.cache/derived` and the folder is `<derivedRoot>/<datasetVersion>/`. Fixture builds (`pipeline fixture`) pass a per-run temp folder, so they never touch the real cache and parallel fixture builds never share one.
- `pipeline/sources.lock.json`: committed; one entry per raw file with `sha256`, `bytes`, `archiveKey`, `upstreamVersion`, `license`.
- R2 bucket `sfhousing`: key `data/<v>/<path>`, served at `/data/<v>/<path>`; raw archives under `sources/<sha256>`.

## Lock and `datasetVersion`

The lock pins every input by sha256. `build` refuses to run if a cached file does not match it. `datasetVersion` is `<YYYY-MM-DD>-<h8>`: the date is the newest `retrievedAt` in the lock, `h8` hashes the canonical lock, the committed code under `pipeline/`, `src/lib/data/`, `src/lib/generator/`, `src/lib/timelapse/`, `src/lib/plan/geometry.ts` and `src/lib/plan/types.ts` (a `git ls-tree` listing that excludes `sources.lock.json`, `.cache` and `out`, plus any uncommitted changes there), and the pinned tool versions. It is derived from inputs, so the same lock and code give the same version, and any change to pipeline code, the shared codec, the generator or the timelapse code gives a new version (the yields in `parcels.bin` come from the generator, so a generator change changes the data). A published version is immutable; fixtures use `fixture-<n>`.

## Fixture

`pipeline fixture` builds hand-made sources in `pipeline/test/fixtures/mini/` into `e2e/fixtures/data/fixture-0/` and compares against `pipeline/test/fixtures/mini/golden/`. After an intentional change to the pipeline or the mini sources, run `npm run pipeline -- fixture --update-golden`, review the diff and commit both directories. `fixture-0` is generated: never hand-edit it. CI loads it (`npm run data:fixture` in `.github/workflows/ci.yml`) but does not regenerate it. Drift is caught by `pipeline/test/golden.test.ts` under `npm run test:pipeline`, which compares a fresh build against `pipeline/test/fixtures/mini/golden/` (excluding `buildings.pmtiles`, whose tippecanoe bytes may differ between platforms; its feature attributes are tested in `tiles.test.ts`). `scenarios/fzp/parcels.bin` is compared decoded, against `golden/scenarios/fzp/parcels.decoded.json`, because deflate bytes can differ between zlib builds. chreode runs `test:pipeline` for changes under `pipeline/`, `src/lib/generator`, `src/lib/timelapse`, `src/lib/plan/types.ts`, `src/lib/plan/geometry.ts`, `src/lib/data` and `e2e/fixtures/data`, so the golden is checked at signoff, not in `ci.yml`.

## Invariants

`build` and `check` evaluate V1 to V19 and exit 1 on any failure, so nothing is uploaded. In short: V1 unit total within 2% of 413,208; V2 parcel count equals distinct active ids and lies in [140k, 170k]; V3 land-use match >= 99%; V4 known land-use values; V5 height coverage >= 95%; V6 piece area with a parcel >= 95%; V7 neighborhoods and label points; V8 each parcel in exactly one chunk, chunks round-trip; V9 chunk size limits; V10 tallest building 300 to 340 m; V11 first-paint budget; V12 determinism; V13 published versions are never altered; V14 `transit.json` decodes, has >= 3,000 stops and heavy-rail service at the 8 SF BART stations (it warns above 400 KB); V15 `parcels.bin` inflates and decodes, its header matches the manifest, `count` equals the emitted parcels, each id is in exactly one chunk and in that chunk's cell, and re-encoding is byte-identical; V16 no height string fails to parse and at least `heightJoinMin` of eligible parcels have a height district; V17 fill levels equal `FILL_LEVELS`, no yield was clamped to 16 bits, the `hostable` and `hostableBase` masks agree with eligibility and yield, non-Local-Program parcels have `baseYield = yield`, at least half of eligible parcels are hostable, and it warns when the FZP net capacity is outside 0.25x to 4x of Planning's ~780,000; V18 the panel covers every roll year, at least `rollJoinMin` of eligible parcels have a latest-year roll row, the roll's unit total lies in `scenarioUnitsRange`, and the panel's latest-year features equal `parcels.bin`'s; V19 `parcels.bin` is at most `scenarioMaxBytes` (3.5 MB) and warns above 3.0 MB. Thresholds live in `pipeline/config.ts`; the full table is spec section 4.9 (V14: transit spec section 4.3; V15 to V19: `docs/superpowers/specs/2026-10-16-scenario-data-design.md` section 4.10).

## Scenario parcels

`build` runs `pipeline/steps/scenario.ts` after the parcel chunks are written. It produces one T11 file the client reads and two T13 files for pipeline consumers; design in `docs/superpowers/specs/2026-10-16-scenario-data-design.md`.

- **Sources** (DataSF, pinned in the lock): the height and bulk districts `h9wh-cg3m`, the parcel attributes `acdm-wktn` (zoning code; active and retired parcels) and the assessor historical secured rolls `wv5m-vpq2`. Planning Director Bulletin No. 11 and the Planning Code give the Local Program rules and density caps. SQL is `pipeline/sql/80_scenario.sql` and `81_scenario_features.sql`; the TS step does yields and encoding.
- **T11** `scenarios/fzp/parcels.bin` (codec `sfh-scenario/1`, `src/lib/data/scenario-codec.ts`): a deflate-raw column file with one row per emitted parcel: height district, base and FZP envelope in stories, Local Program flag, base density cap, latest-roll features, an imputed-field bitmask, and the yield and base yield at each of the `FILL_LEVELS`. Fixture reports omit its deflate size.
- **T13** `parcel-panel.parquet` (one row per parcel and roll year, with that year's base yield and the cap in force on its lien date) and `parcel-lineage.parquet` (retired parcel to current parcel). They live in the derived cache (see Where things land) and are never uploaded. The DuckDB tables `scenario_panel` and `parcel_lineage` stay in the build's database for later steps of the same build.
- **Evidence tiers.** Roll features are tier 0 with tier 2 imputation; the envelope, yields and fill grid are tier 3 or 4. `parcels.bin` carries a `provenance` block for each, and every numeric parameter in the scenario code has a comment naming its tier and source.

### Tier-4 data rules

Rules the live data needed, made up rather than measured. The report counts below are in `report.json` under `scenario.*`.

- **Split zoning codes** (`RH-2|RM-1`) take the most permissive component's cap (no cap if any component has none). Counted by `density_cap.rule.split`, and by `density_cap.rule.split_hostable` for hostable parcels.
- **Generic `NCD` and `NCT` codes** name no district and have no cap. Counted by `density_cap.rule.generic_nc` and `density_cap.rule.generic_nc_hostable`. Codes missing from the cap table also have no cap, counted by `density_cap.rule.unlisted`. The build warns when split or generic parcels exceed 10% of hostable parcels.
- **Roll stories above 80** (the generator's `MAX_STORIES`; live rows reach 999) are treated as missing, so existing stories fall back to the building height. Counted by `roll.stories_implausible`.
- **Implausible unit runs.** A run of equal unit counts that has a roll year on each side, is at least 100 units and is more than 10x both neighbours is replaced by the previous year's units, and imputed bit 3 (value 8) is set on those parcel-years. Counted by `roll.units_implausible` (parcel-years replaced). A one-sided change is never touched.

### Density caps

`pipeline/lib/density-caps.ts` gives base-zoning units per lot in three periods, chosen by the day asked for:

1. Before 2022-11-27: the as-of-right per-lot counts for RH districts (the per-area alternatives then needed a conditional use authorisation). Source: Planning code summary 2021-010762PCA (the four-unit density exception).
2. 2022-11-27 to 2026-01-11, the fourplex period: the current RH tables with a floor of four units per lot.
3. From 2026-01-12, the Family Zoning Plan date: as in 2, except that NC lots inside the R-4 height and bulk district have form-based density and no cap (Ordinance 245-25).

The panel uses the period of each roll year's lien date (1 January). In `parcels.bin`, `baseCap` and `baseYield` use the cap on the day before 2026-01-12; the FZP `yield` has no cap on Local Program parcels and the cap on the build's snapshot day elsewhere. The 2026-01-12 date is a coordinator ruling (the ordinance was signed 2025-12-12), not an official effective-date notice.

Sources are the official ones: Planning code summary 2021-010762PCA on sfplanning.org, and Ordinance No. 245-25 (`o0245-25.pdf`) on sfbos.org. The consolidated Code on amlegal blocks automated access (HTTP 403), so amendments after Ord. 245-25 were not checked there; a gocodebook mirror dated 2026-09-23 agrees with every current value. Each row of `DENSITY_CAP_TABLE` carries its section and a page-anchored URL.

Verification status: every table row is `official`. `UNVERIFIED_DISTRICTS` is the generic `NCD` and `NCT` codes (plus any `mirror` row, currently none): they default to no cap, and every build prints a warning with the parcel counts.

## Transit

`transit.json` (codec `sfh-transit/1`) is the reduced transit network the capacity features read; design in the transit spec (`docs/superpowers/specs/2026-10-14-transit-capacity-design.md`).

- Feeds come only from the agencies' own GTFS URLs (`pipeline/transit-config.ts`), never 511. They are pinned in the lock as `gtfs-muni`, `gtfs-bart` and `gtfs-caltrain`.
- Vehicles and route-to-vehicle assignments live in `pipeline/transit-config.ts`, each citing its source and an as-of date (or `null`). Every `url` is currently `null`: the spec supplies none, so add one when a row is re-sourced. Update them when SFMTA reassigns fleets, then run `npm run pipeline -- build`: a non-fixture build is strict (`strict: !fixtureMode` in `pipeline/steps/build.ts`; there is no CLI flag) and fails when an assigned line is missing from a feed, which catches renamed lines. Fixture builds and `npm run data:transit` skip that check.
- The service day is chosen per feed. A feed whose calendar has expired is a warning, not a failure.
- `npm run data:transit` exists for local use: it builds `transit.json` from live feeds into the local dataset (see [developing.md](developing.md)). It clips to the loaded dataset's neighborhoods, so it needs a real dataset from `npm run data:local`; `fixture-0` yields only a handful of stops.

## ODbL obligations

`buildings.pmtiles`, `basemap.pmtiles` and the parcel chunks are Derivative Databases of ODbL data (OpenStreetMap, Overture), published under **ODbL-1.0**. The manifest `sources` carry each licence, with Overture expanded per contributing dataset, and `/attribution` renders the notice from them. Do not add a source without recording its licence in the lock. DataSF sources are PDDL or public domain (credit is courtesy). Spec section 4.12 has the visible-attribution wording.

## Partner actions

These need credentials the pipeline never holds and are not done by CI:

1. Create the R2 bucket `sfhousing` (shared by staging and production).
2. `wrangler login`, or provide CI credentials (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) with R2 write access.
3. Run the first real `npm run pipeline -- upload <v>` (remote), then `verify <v> --origin <staging>`.
4. Bump `PUBLIC_DATASET_VERSION` in `wrangler.jsonc`: staging first, then production via a release.
5. After the pinned Overture release expires upstream, prove the archive works: on a clean checkout run `npm run pipeline -- fetch --restore`, then `build` (AC-7).
