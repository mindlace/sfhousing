# Data pipeline

`pipeline/` turns open sources (DataSF parcels, land use and footprints; Overture buildings; a Protomaps basemap extract; Noto Sans glyphs; Muni, BART and Caltrain GTFS) into one immutable, versioned dataset: parcel chunks, the FZP scenario parcel file `scenarios/fzp/parcels.bin`, `buildings.pmtiles`, `basemap.pmtiles`, fonts, neighborhoods, `transit.json` and `manifest.json`. The Worker serves it from R2 (see [data-serving.md](data-serving.md)). Design: `docs/superpowers/specs/2026-10-10-data-pipeline-design.md`.

Project records (`scenarios/fzp/projects.json`: in-flight projects with their stage histories and multi-phase phasing) add seven DataSF sources to the lock, all fetched as paged JSON by `fetch`: `datasf-permits-newcon` (`i98e-djp9`, PDDL-1.0), `datasf-planning-projects` (`qvu5-m3a2`, public-domain), `datasf-planning-records` (`y673-d69b`, public-domain), `datasf-planning-review` (`d4jk-jw33`, PDDL-1.0), `datasf-unit-completions` (`j67f-aayr`, PDDL-1.0), `datasf-housing-production` (`xdht-4php`, public-domain) and `datasf-dev-pipeline` (`6jgi-cpb4`, CC0-1.0). Design: `docs/superpowers/specs/2026-10-16-project-records-design.md`. Refresh just these with `npm run pipeline -- fetch --only datasf-permits-newcon,datasf-planning-projects,datasf-planning-records,datasf-planning-review,datasf-unit-completions,datasf-housing-production,datasf-dev-pipeline`.

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
| `quality-doc`                                                   | Rewrites the generated Data quality section below from `QUALITY_RULES`.                                                                                            | none    |
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
- `pipeline/.cache/derived/<v>/project-histories.json` and `permits.parquet`: the project-records outputs (per-project stage histories and the parsed new-construction permits), consumed by stage-calibration in the same build. Build-internal, never uploaded (gitignored).
- `pipeline/out/<v>/scenarios/fzp/projects.json`: the in-flight project file (validated by V20, at most 2 MB). It is uploaded with the dataset and listed in the manifest.
- `pipeline/enrichment/multiphase.json`: committed, hand-curated; see Multi-phase enrichment below.
- `pipeline/sources.lock.json`: committed; one entry per raw file with `sha256`, `bytes`, `archiveKey`, `upstreamVersion`, `license`.
- R2 bucket `sfhousing`: key `data/<v>/<path>`, served at `/data/<v>/<path>`; raw archives under `sources/<sha256>`.

## Lock and `datasetVersion`

The lock pins every input by sha256. `build` refuses to run if a cached file does not match it. `datasetVersion` is `<YYYY-MM-DD>-<h8>`: the date is the newest `retrievedAt` in the lock, `h8` hashes the canonical lock, the committed code under `pipeline/`, `src/lib/data/`, `src/lib/generator/`, `src/lib/timelapse/`, `src/lib/plan/geometry.ts` and `src/lib/plan/types.ts` (a `git ls-tree` listing that excludes `sources.lock.json`, `.cache` and `out`, plus any uncommitted changes there), and the pinned tool versions. It is derived from inputs, so the same lock and code give the same version, and any change to pipeline code, the shared codec, the generator or the timelapse code gives a new version (the yields in `parcels.bin` come from the generator, so a generator change changes the data). A published version is immutable; fixtures use `fixture-<n>`.

## Fixture

`pipeline fixture` builds hand-made sources in `pipeline/test/fixtures/mini/` into `e2e/fixtures/data/fixture-0/` and compares against `pipeline/test/fixtures/mini/golden/`. After an intentional change to the pipeline or the mini sources, run `npm run pipeline -- fixture --update-golden`, review the diff and commit both directories. `fixture-0` is generated: never hand-edit it. CI loads it (`npm run data:fixture` in `.github/workflows/ci.yml`) but does not regenerate it. Drift is caught by `pipeline/test/golden.test.ts` under `npm run test:pipeline`, which compares a fresh build against `pipeline/test/fixtures/mini/golden/` (excluding `buildings.pmtiles`, whose tippecanoe bytes may differ between platforms; its feature attributes are tested in `tiles.test.ts`). `scenarios/fzp/parcels.bin` is compared decoded, against `golden/scenarios/fzp/parcels.decoded.json`, because deflate bytes can differ between zlib builds. chreode runs `test:pipeline` for changes under `pipeline/`, `src/lib/generator`, `src/lib/timelapse`, `src/lib/plan/types.ts`, `src/lib/plan/geometry.ts`, `src/lib/data` and `e2e/fixtures/data`, so the golden is checked at signoff, not in `ci.yml`.

## Invariants

`build` and `check` evaluate V1 to V24 and V30 and exit 1 on any failure, so nothing is uploaded. In short: V1 unit total within 2% of 413,208; V2 parcel count equals distinct active ids and lies in [140k, 170k]; V3 land-use match >= 99%; V4 known land-use values; V5 height coverage >= 95%; V6 piece area with a parcel >= 95%; V7 neighborhoods and label points; V8 each parcel in exactly one chunk, chunks round-trip; V9 chunk size limits; V10 tallest building 300 to 340 m; V11 first-paint budget; V12 determinism; V13 published versions are never altered; V14 `transit.json` decodes, has >= 3,000 stops and heavy-rail service at the 8 SF BART stations (it warns above 400 KB); V15 `parcels.bin` inflates and decodes, its header matches the manifest, `count` equals the emitted parcels, each id is in exactly one chunk and in that chunk's cell, and re-encoding is byte-identical; V16 no height string fails to parse and at least `heightJoinMin` of eligible parcels have a height district; V17 fill levels equal `FILL_LEVELS`, no yield was clamped to 16 bits, the `hostable` and `hostableBase` masks agree with eligibility and yield, non-Local-Program parcels have `baseYield = yield`, at least half of eligible parcels are hostable, and it warns when the FZP net capacity is outside 0.25x to 4x of Planning's ~780,000; V18 the panel covers every roll year, at least `rollJoinMin` of eligible parcels have a latest-year roll row, the roll's unit total lies in `scenarioUnitsRange`, and the panel's latest-year features equal `parcels.bin`'s; V19 `parcels.bin` is at most `scenarioMaxBytes` (3.5 MB) and warns above 3.0 MB; V20 `projects.json` passes the shared validator in `src/lib/timelapse/projects.ts` against the chunk parcels, and is at most `projectsMaxBytes` (2 MB; warns above `projectsWarnBytes`, 1 MB); V21 the in-flight units matched to population pipeline rows are at least `pipelineCoverageMin` (0.90) of those rows' `new_pipeline_units`, ended rows excluded; V22 `rhnaCompletedNet` is within `rhnaYearTol` (10%) of the Housing Inventory net units `hiNet` (2023: 2,544, 2024: 1,603, 2025: 2,669) for each year and within `rhnaTotalTol` (5%) in total, and fails if no year can be compared; V23 project histories are consistent (entered days non-decreasing, `end.day` not before the last entered day, `complete` end matches `entered.complete`, `exit.stage` was entered) and two derivations give byte-identical output; V24 every in-flight multi-phase project has phases (or is counted as a last resort) that sum to its units, with disjoint parcels, every `multiphase.json` entry and fact checked (see below), and the enriched scale factor within [0.8, 1.25]; V30 every registered data-quality rule reports its counts, no `quality.*` count names an unregistered rule, and on a live build (`qualityShares`) no rule's share exceeds its fail share (see Data quality below). Thresholds live in `pipeline/config.ts`; the full table is spec section 4.9 (V14: transit spec section 4.3; V15 to V19: `docs/superpowers/specs/2026-10-16-scenario-data-design.md` section 4.10; V20 to V24: `docs/superpowers/specs/2026-10-16-project-records-design.md` section 4.9; V30: the scenario-data spec sections 4.10 and 4.12).

<!-- quality:begin -->

## Data quality

Every pipeline rule that nulls, replaces, defaults or drops a source value is a registered T14 rule, and so is an observation rule that only counts (action `none`). The registry is `QUALITY_RULES` in `pipeline/lib/quality.ts`; each owner declares its rules in `pipeline/lib/quality-rules/` (`sd.ts`, `pr.ts`, `sc.ts`). The tiers are those of the rule (its predicate and thresholds) and of the value it writes; the mask bit is the T11/T13 `imputed` bit the rule sets. This section is generated from the registry by `npm run pipeline -- quality-doc`: do not edit it by hand.

| id                              | label                                                                                                                                                                                                                                               | tier (rule / value) | kind    | action  | mask bit | warn / fail share |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------- | ------- | -------- | ----------------- |
| `sd.features.median-fallback`   | When a land-use class has no value in a roll year, its median falls back to the median of all non-vacant parcels that year, then to 0                                                                                                               | 4 / 4               | missing | default | —        | 0.05 / 0.1        |
| `sd.features.share-median`      | A parcel-year with no assessed value takes the median improvement share of the same land-use class and roll year                                                                                                                                    | 2 / 2               | missing | default | 2        | 0.05 / 0.1        |
| `sd.features.stories-height`    | Parcel-years without assessor stories take round(building height / 3.1 m), at least 1, when the building has a height                                                                                                                               | 2 / 3               | missing | default | 1        | 0.05 / 0.1        |
| `sd.features.year-built-median` | A missing assessor year built takes the median of the same land-use class and roll year                                                                                                                                                             | 2 / 2               | missing | default | 0        | 0.05 / 0.1        |
| `sd.roll.floor-area-missing`    | A parcel-year with no assessor floor area takes the floor area of the map parcel record (land-use data, else the building footprints), rounded to whole m²                                                                                          | 2 / 3               | missing | default | 6        | 0.05 / 0.1        |
| `sd.roll.no-row`                | A parcel with no latest-year assessor row has 0 homes, stories from the building height, land-use class other, the latest year’s "other" medians for year built and improvement share, no rent control, and the floor area of the map parcel record | 4 / 4               | missing | default | 4        | 0.05 / 0.1        |
| `sd.roll.no-year`               | Assessor rows without a roll year are dropped                                                                                                                                                                                                       | 4 / —               | shape   | drop    | —        | 0.01 / 0.1        |
| `sd.roll.stories-max`           | Assessor stories above 80 (the generator maximum; the tallest SF building has 61) are treated as missing, so the stories come from the other rows or the building height                                                                            | 4 / 2               | bound   | replace | 1        | 0.01 / 0.1        |
| `sd.roll.units-capacity`        | Assessor units that would leave under 10 m² of lot area times stories per home take the units of the nearest plausible roll year, else the city land-use count if plausible, else the most homes that fit                                           | 4 / 2               | outlier | replace | 3        | 0.01 / 0.1        |
| `sd.roll.units-large`           | Counts parcel-years with more than 500 units that no units rule replaced and that were not carried; changes nothing                                                                                                                                 | 4 / —               | outlier | none    | —        | 0.01 / 0.1        |
| `sd.roll.units-latest-jump`     | Counts parcels whose latest-year units are at least 100 and more than 10 times the previous year (usually a new building); changes nothing                                                                                                          | 4 / —               | outlier | none    | —        | 0.01 / 0.1        |
| `sd.roll.units-missing`         | A parcel-year whose assessor rows all lack a unit count has 0 units                                                                                                                                                                                 | 4 / 4               | missing | default | 3        | 0.05 / 0.1        |
| `sd.roll.units-spike`           | A run of roll years whose units (at least 100) are more than 10 times the years on both sides takes the units of the year before the run                                                                                                            | 4 / 2               | outlier | replace | 3        | 0.01 / 0.1        |
| `sd.roll.unmatched`             | Assessor rows whose parcel number maps to no current parcel (directly, through a condo lot, or through a retired lot inside a current one) are dropped                                                                                              | 2 / —               | shape   | drop    | —        | 0.01 / 0.1        |
| `sd.roll.year-built-range`      | Assessor year built before 1850 or after the roll year (including 0) is treated as missing and takes the median of the same land-use class and roll year                                                                                            | 4 / 2               | bound   | replace | 0        | 0.01 / 0.1        |
| `sd.roll.year-gap`              | A roll year missing between two years in which a parcel appears copies the latest earlier year                                                                                                                                                      | 2 / 2               | gap     | default | 5        | 0.01 / 0.1        |
| `sd.yield.nonmonotone`          | Counts parcels whose units by fill level fall at some higher fill level; changes nothing                                                                                                                                                            | 4 / —               | shape   | none    | —        | 0.01 / 0.1        |
| `sd.yield.zero-hostable`        | Counts eligible parcels with an envelope of at least one story whose top-fill yield is 0; changes nothing                                                                                                                                           | 4 / —               | shape   | none    | —        | 0.01 / 0.1        |
| `sd.zoning.generic-nc`          | A generic NCD or NCT zoning code names no district, so the parcel has no density cap                                                                                                                                                                | 4 / 4               | shape   | default | —        | 0.01 / 0.1        |
| `sd.zoning.split-code`          | A split zoning code (two districts on one parcel) takes the density cap of its most permissive component, or no cap when a component has none                                                                                                       | 4 / 4               | shape   | replace | —        | 0.01 / 0.1        |

Each build reports `quality.<id>.fired` and `quality.<id>.of` (plus `.units` and `.unitsOf` for a unit-weighted rule) in `report.json` and writes `pipeline/.cache/derived/<v>/quality-report.md` with one row per rule and its first 25 affected ids. V30 fails when a rule does not report or a `quality.*` key names no registered rule, and on a live build when a share exceeds its fail share; a share above its warn share warns.

<!-- quality:end -->

## Multi-phase enrichment

`pipeline/enrichment/multiphase.json` is the hand-curated list of Development Agreement (DA) phasings behind the "PRX" master rows of `datasf-dev-pipeline` (`6jgi-cpb4`, `case_no` ending `PRX`). A master is entitled once; its phases are separate permitting sub-projects, so `projects.json` carries them as `phases`. Only a PRX row whose `bpa_no` names no fetched permit is a master (`CASE:<case_no>`, `multiPhase` true); one whose `bpa_no` names a fetched permit joins that permit's project like any pipeline row (`multiPhase` false, spec section 4.2 steps 4 and 9), and its entry stays valid but unused, with the warning `<caseNo>: PRX row joins permit <bpa>; multiphase entry unused`. The file is committed, read directly by `build` (not fetched, not in the lock) and part of the dataset-version hash. Its zod schema is `pipeline/enrichment/schema.ts` and a parse failure is a `BuildError`. Fixture builds read `pipeline/test/fixtures/mini/enrichment/multiphase.json`.

Curation rules (spec section 4.10.1):

- Every PRX row with `new_pipeline_units >= 1` needs an entry (V24). Live on 2026-10-16 that is 21 of 24 rows; `pipeline/test/project-records/multiphase-file.test.ts` pins the list.
- With a published phasing (DA or DDA phasing exhibit, schedule of performance, approved major-phase or sub-phase applications), fill `schedule` and `phases`: the DA's own phase name, gross `units`, `blklots`, `plannedPermitFiled` (the schedule's site-permit or vertical-application deadline, else null; never turn a horizontal or infrastructure date into one) and a `status`.
- `status` is `remaining`, `built` or `separate`. A phase the records show as completed is `built`. A phase that is its own pipeline or permit row is `separate` and needs `separateRef` (`{ dataset, id, key? }`, e.g. `6jgi-cpb4` / `bpa_no`). Only `remaining` phases are drawn; the build fails V24 on a `remaining` phase whose parcels all belong to another in-flight or completed project.
- Every fact (`units`, `blklots`, and `plannedPermitFiled` when set) carries a URL, a `retrieved` date and a `locator` (page, table or exhibit). A count derived by subtraction or a block-lot mapped by the curator (area match, geometry overlay) must say so in the locator.
- Without a published phasing, set `schedule: null`, `phases: []` and list every URL searched in `searched` (non-empty). The build then uses its fallback; that is a recorded decision, not an omission. Do not invent a phase split from arithmetic alone.
- Prefer active `blklot`s from `acdm-wktn`. A retired lot is replaced by the active lots that replaced it, and condominium lots stacked on the same footprint are not listed.
- `units` is at least 1 for every phase, built and separate phases included. Units are gross schedule units. Where a separately tracked building sits inside a phase, either mark it `separate` or net it out of the `remaining` phase (and say so in the locator), so it is not drawn twice.
- Retrieval dates cannot be after the build's `asOf`.

How the build uses it (spec section 4.10.2): an entry with a schedule and at least one `remaining` phase is **enriched**. The `remaining` phases in file order become `phases`, with parcels resolved from `blklots` minus parcels owned by other in-flight or completed projects. A phase with no parcels left merges into its neighbour. If Planning's remaining count R (the PRX row's `new_pipeline_units`) differs from the phase total, units are scaled to R by largest remainder and the factor is reported as `multiphase.scale.<caseNo>`; V24 fails outside [0.8, 1.25]. An entry without a schedule is **fallback**: k phases of about the median size of the project's completed buildings, at most one per DA parcel. If neither exists the master is a **last resort** (`phases` null, a footprint ghost). Unresolvable `blklots` and a schedule with no `remaining` phase do not fail the build; they come back as warnings in `report.json`. The report counts `multiphase.enriched`, `multiphase.fallback` and `multiphase.lastResort`.

Rule notes (amendments to spec sections 4.6 and 4.10.2 found on the live data):

- L1, exit after later entered stages: the spec's "latest entered stage on or before the exit day" contradicts V23 (`end.day` not before the last entered day) when stages were entered after the exit day. Then `exit.stage` is the last entered stage and `exit.day` is its entry day.
- L2, fully excluded enriched master: when every phase of an enriched master is left with no parcels and the tracking parcels are all excluded as well, the master is a last resort (`phases` null) instead of a single phase on the tracking parcel, which would draw a parcel twice (spec 4.10.3, V24 disjointness).

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
