# Task 2 report: Census and DMV sources

Commit: `2e9133d8 feat(pipeline): census and DMV sources for car ownership`. Status: DONE_WITH_CONCERNS.

## What was built

- `pipeline/census-config.ts`: ids, specs, URLs, licences. Exports `CENSUS_IDS`, `CENSUS_SOURCES`, `CensusId` (a string), `DMV_ID = 'ca-dmv-vehicles-zip'`, `acsBgVintage`, `ACS_TABLES`, `ACS_END_YEARS`, `CENSUS_TABLES`.
- `pipeline/sources/census.ts`: `fetchCensus(id, rawDir, http, now?)`, `fetchDmv(rawDir, http, now?)`, `normaliseCensus`, `loadCensus`.
- `pipeline/steps/fetch.ts`: `FETCH_IDS` gains `...CENSUS_IDS, DMV_ID` (so `DEFAULT_FETCH_IDS` does too); two dispatch branches. Names unchanged (P10).
- `pipeline/sources/normalise.ts`: `normaliseAll` calls `normaliseCensus` and merges its counts into the result under the table names; `loadNormalised` calls `loadCensus`.
- `pipeline/sources.lock.json`: 17 new entries (45 sources). Census entries are public domain (U.S. Census Bureau); the DMV one is "No restrictions on public use (California DMV, via data.ca.gov)". No key anywhere (the data API is not used).
- `docs/dev/pipeline.md`: new "Car-ownership sources" section.
- `pipeline/test/census-source.test.ts`: 18 tests.

## Lock ids (17)

ACS `census-acs5-bg-{2009,2013,2019,2020,2021,2022,2023,2024}` (2021 on table-based files, earlier sequence-based via the lookup file), `census-pums5-{2013,2024}`, `census-sf3-2000-bg`, `census-tiger-bg-{2000,2010,2020}`, `census-xwalk-2000-2010`, `census-xwalk-2010-2020`, `ca-dmv-vehicles-zip`.

## Tables (a table exists only when its lock entries do; none in the fixture lock, P7)

| Table | Columns |
| --- | --- |
| `src_acs_bg` | release (end year), geoid (12 digits), variable (`B25044_001`), estimate. Tables B25044, B25046, B25009, B19001, B25002, B08301. Sentinels (-666666666 etc.) dropped. |
| `src_pums_hh` | release, puma, serialno, wgtp, veh, mv, np, workers, hincp_adj, ten, ybl, **puma_vintage, ybl_src** (extra, trailing) |
| `src_sf3_bg` | geoid, variable (H044001..015), value |
| `src_bg_geom` | vintage, geoid, **geom** (EPSG:7131) |
| `src_bg_xwalk` | from_vintage, from_geoid, to_vintage, to_geoid, weight |
| `src_dmv_zip` | year, zip, light_duty |

## TDD

RED (`npx vitest run --project pipeline pipeline/test/census-source.test.ts`, before `pipeline/sources/census.ts` existed): the file failed to load on its import of `../sources/census` ("Test Files 1 failed, no tests").
GREEN: `Tests 18 passed (18)`. Live checks then found four bugs that the synthetic tests had agreed with (all fixed, tests updated): table-based GEO_ID prefix (`1500000US`, not `15000US`); 2009 sequence numbers unpadded in the lookup (`98` vs file `0098`); SF3 tract/block-group offsets (55 and 61, not 54 and 60); `-666666666` sentinels in 2021+ files. Also a streaming-zip OOM on the 590 MB PUMS file (retained substrings pointed into 6 MB chunks; fixed by copying retained strings and pushing the zip in 1 MB slices).
Suite: `npm run test:pipeline` 121 files passed, 1 skipped (2318 tests passed, 10 skipped); eslint on `pipeline` and prettier on changed files clean; `tsc --noEmit` shows nothing in the touched files.

## Live verification (fetched all 17, normalised from the real lock and cache)

- PUMS 2020-2024: 17,071 SF records, weighted 364,046, vehicles 382,419: exactly cars-data.md's figures. PUMS 2009-2013: 15,901 occupied records (9,436 on PUMA00, 6,465 on PUMA10).
- ACS: 575 / 581 / 681 block groups by vintage; B25044 totals 324,185 (2005-2009) to 363,970 (2020-2024).
- SF3 H044: 575 block groups, 329,700 homes (matches cars-data.md).
- TIGER 575 / 581 / 681 block groups, EPSG:7131; crosswalk weights sum to 1 per from block group (575 and 581 froms).
- DMV: 2026 light-duty 410,813 (matches cars-data.md); 2019-2026.
- Raw cache added about 65 MB (lock files total 64,706,578 bytes).

## Concerns / decisions the next tasks should know

1. **Lock changes `datasetVersion`** (whole lock is hashed; newest `retrievedAt` is now today). The branch must build and upload a dataset before signoff (pipeline.md "Finishing a branch"); that is for the closing unit. A plain `fetch` now also refreshes all 17 (large downloads); `--only` is the cheap path.
2. **Derived raw files.** Each entry's raw file is the SF rows as a small CSV (TIGER keeps the upstream zip), so the lock `url` is the primary upstream URL and the sha pins the derived bytes, not the Census files. Reproducing needs the fetch code.
3. **Releases chosen** (builder's call): ACS 2009, 2013, 2019, 2020, 2021-2024 (earliest, held-out, both sides of the 2020 vintage change, latest). Task 14's "every ACS release" needs more `ACS_END_YEARS` entries (one line each; layouts for 2010-2018 are the same sequence-based path, not run live except 2009, 2013, 2019, 2020).
4. **Column additions/naming**: `puma_vintage` and `ybl_src` added to `src_pums_hh` (PUMA codes repeat across vintages, `YBL` is a category code but `YRBLT` a year); geometry column named `geom` (the pipeline's convention). `release` is the end year as an integer.
5. **Crosswalk weight is land-area share**, not housing units (no decennial block counts fetched). 2010-2020 uses the Census block-group file (829 pairs), 2000-2010 aggregates the block file (632 pairs).
6. **DMV `year`** is the as-of year in the resource name (`1/1/2026` is 2026), not the Date column (12/31/2025, and 10/1/2018 for the 2019 file).
7. `normaliseAll`'s return type is still `Record<SourceId, number>`; census counts are merged in under table names at runtime (the type does not show them).
8. 2013 PUMS workers use the person file's `ESR` (1, 2, 4, 5); the 2013 person zip is 298 MB, held in memory while parsing.

## Fix round 1: empty fetches throw

Change: `pipeline/sources/census.ts` now throws, naming the source, instead of writing a lock entry when: ACS finds no SF rows (overall, and per table for table-based files); SF3 finds no SF block groups or cells; PUMS lacks a required household or person column (SERIALNO, WGTP, VEH, NP, HINCP, ADJINC, TEN; person SERIALNO, ESR) or finds no occupied SF households; a crosswalk finds no SF rows; a DMV file lacks `zip code`, `duty` or `vehicles`, or has no light-duty rows in 941xx ZIPs.

Tests (4 new in `pipeline/test/census-source.test.ts`: ACS, SF3, PUMS (two cases), DMV (two cases)). Command: `npx vitest run --project pipeline pipeline/test/census-source.test.ts`. Output: `Tests 22 passed (22)`. eslint clean.
