# scenario-data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the FZP scenario parcel data: the `sfh-scenario/1` codec bodies, the `scenarios/fzp/parcels.bin` artifact (T11), the pipeline-internal parcel panel and lineage (T13), invariants V15–V19, the fixture-0 mini scenario, and the housekeeping edits the spec assigns (manifest `scenarios`, version hash, chreode, docs).

**Architecture:** Three new DataSF sources (height/bulk districts, parcel attributes incl. retired, assessor roll) are fetched, locked and normalised like the existing ones. A new build step `pipeline/steps/scenario.ts` runs after `writeChunks`: TypeScript parses height strings and computes density caps, SQL (`80_scenario.sql`, `81_scenario_features.sql`) does the district join, lineage, roll aggregation and per-year features, TypeScript runs the generator for yields, writes the T13 parquet files to the derived cache and encodes T11 with the shared codec. `checkDataset` gains V15–V19.

**Tech Stack:** TypeScript (Node ≥ 22), DuckDB (`@duckdb/node-api` + spatial), Vitest (server, client, pipeline projects), Playwright, `node:zlib` (`deflateRawSync`), `DecompressionStream('deflate-raw')`, fast-check.

**Spec:** `docs/superpowers/specs/2026-10-16-scenario-data-design.md` (cited below as "spec §N"). Design: `docs/superpowers/design/2026-10-16-1903-fzp-timelapse.md`. Executors read the spec sections their task names; the values there are binding.

## Global Constraints

- Evidence hierarchy: every number the simulation uses carries a tier (0 per-record, 1 first-party aggregate, 2 inference from observations, 3 model/literature, 4 made up) and a source. A tier-3 or tier-4 number is never presented as data. AC 11: every numeric parameter in this subsystem's code has a comment giving its tier and source as in the spec.
- Determinism: the same `datasetVersion` and seed give the same output on every machine. The payload is byte-deterministic; deflate bytes may differ across zlib builds, so goldens compare the decoded payload.
- Interfaces are fixed: T11, T13, T4a `FeatureId`, T4 `Provenance`, I1, I2, I6, I8, I12, I14 rows in spec §2 are verbatim and must not change. Step-0 declarations in `src/lib/data/scenario-codec.ts` (constants, `LandUseClass`, `ScenarioParcels`, `ScenarioFormatError`, `fillStories`, function signatures) are implemented, never redeclared or altered.
- `OPEN_DAY` is `Math.fround(3.0e38)`; compare with the exported constant from `src/lib/timelapse/time.ts`, never a literal (ruling A1).
- T13 column names are exactly those in spec §4.6 (a concurrent consumer, project-records, reads them). DuckDB tables `scenario_panel` and `parcel_lineage` stay in the build's database for consumers in the same build.
- `FILL_LEVELS = [0.25, 0.5, 0.75, 0.9, 1]` (tier-4 quantisation grid), `stories(ft) = min(80, floor(ft / 10))` (tier 3, orchestrator), `MAX_STORIES = 80`.
- Code style: 2-space indent, single quotes, no trailing commas, 100 columns. Conventional Commits, each ending with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Vitest runs with `expect.requireAssertions`: every test calls `expect`.
- Never compound `cd` with another command. Never run `npm run signoff`, never merge, never upload to R2 or touch remote Cloudflare resources. Live DataSF reads (curl against data.sf.gov) are allowed.
- Pipeline code imports `src/lib/**` by relative path (no `$lib`).
- After any change that alters fixture outputs, regenerate with `npm run pipeline -- fixture --update-golden`, inspect the diff, and commit both `pipeline/test/fixtures/mini/golden/` and `e2e/fixtures/data/fixture-0/`.

## Review Focus

1. **Real zoning-code shapes.** Live `acdm-wktn` has split codes (`RH-2|RM-1`, ~1.5k parcels), generic `NCD`/`NCT` codes that do not name the district, and ~1k null codes. `densityCap` must be total and deterministic over them (Task 5 tests each shape).
2. **Roll CSV values as SODA writes them.** Numbers arrive as `"3.0"`, `"0.0"`, empty fields, and years like `"0"`. Normalise must turn `"3.0"` units into 3 and `"0"` years into NULL, never drop the row (Task 6 test).
3. **Parcels with no district or degenerate geometry.** A parcel outside every height polygon gets district `''`, envelope 0, not hostable, and the build does not fail (Task 7 test on a synthetic table).
4. **Codec bounds.** An id whose suffix exceeds 255 bytes, a yield above 65,535, or an index past a dictionary must raise `ScenarioFormatError` (encode) or be clamped and counted (pipeline), never wrap silently in a typed array (Tasks 1, 8).
5. **Corrupt `parcels.bin`.** A truncated or non-deflate body passed to `readScenarioParcels` rejects with `ScenarioFormatError`, not a hang or a bare `TypeError` (Task 1 client spec).

---

### Task 1: `sfh-scenario/1` codec bodies

**Files:**
- Modify: `src/lib/data/scenario-codec.ts` (bodies only)
- Modify: `src/lib/data/scenario-codec.step0.test.ts` (drop the two "not implemented" cases; keep the rest)
- Create: `src/lib/data/fixtures/scenario-tiny.ts`
- Create: `src/lib/data/scenario-codec.test.ts`
- Create: `src/lib/data/scenario-codec.svelte.spec.ts`

**Interfaces:**
- Consumes: step-0 declarations in `scenario-codec.ts`; `FeatureId`, `Provenance` from `src/lib/timelapse/types.ts`; `Envelope` from `src/lib/plan/types.ts`.
- Produces: `encodeScenarioPayload(p: ScenarioParcels): Uint8Array`, `decodeScenarioPayload(bytes: Uint8Array): ScenarioParcels`, `readScenarioParcels(body: ReadableStream<Uint8Array> | Uint8Array): Promise<ScenarioParcels>`, `featureValue(p, i, f, env): number`, `envelopeOf(p, i): Envelope`; fixture export `scenarioTiny(): ScenarioParcels` (6 rows, 2 cells). Tasks 8 and 9 rely on these exact names.

Layout, flag bits, quantisation and every error case are spec §4.8 verbatim (magic `"SFHS"`, u16 major 1, u16 reserved 0, u32 headerLen; header JSON keys in the stated order, zero-padded to 8; columns 8-aligned in the stated order; flags bit 0 localProgram, 1 rentControlLikely, 2 hostable, 3 split, 4 hostableBase; `improvementShare` u8 = round(share × 200); `baseCap` 0xFFFF = null; ids front-coded against the previous row; label points as i32 degrees × 1e7).

- [ ] **Step 1: Write the tiny fixture.** `scenarioTiny()` returns a fully populated `ScenarioParcels` (derived `potentialRatio`/`storiesGap` filled consistently, `index` built) with 6 rows over 2 cells, ids including `0026T001A`, `8711023C`, `3512001`, `3512002`, rows sorted by (cellId, id), at least one row with `localProgram = 1` and `baseYield ≠ yield`, one `baseCap = 0xFFFF`, one row with every imputed bit set (bits 0, 1, 2, 4), one `landUseClass = vacant`, and `improvementShare` values that are multiples of 1/200.
- [ ] **Step 2: Write the failing server tests** in `scenario-codec.test.ts`:
  - `round-trips the tiny fixture` — `decodeScenarioPayload(encodeScenarioPayload(t))` deep-equals `t` (including derived arrays and `index`).
  - `encodes deterministically` — two encodes are byte-equal.
  - `front-codes ids across a cell boundary` — decode gives the exact id list; additionally assert the `idPrefix` byte of the first row of the second cell equals the shared-prefix length with the last id of the first cell.
  - `derives potentialRatio and storiesGap` — for each row `potentialRatio.fzp[i] === Math.fround(yield[i*F+F-1] / Math.max(existingUnits[i], 1))`, `.base` likewise with `baseYield`, `storiesGap.fzp[i] === envelopeStories[i] - existingStories[i]`, `.base` with `baseStories`.
  - `rejects bad input with ScenarioFormatError` — one `it` each: bad magic, major 2, header not JSON, header missing `columns`, a column byteLength shorter than N (truncated column), a `district` index ≥ `districts.length`, `fillLevels` `[0.5, 0.25, 1]`, `fillLevels` ending at 0.9.
  - `encode rejects an id suffix over 255 bytes` — throws `ScenarioFormatError`.
  - `featureValue covers every FeatureId × env` — table over the 8 ids × `'fzp' | 'base'` for row 0 with the expected values from the fixture (`landUseClass` returns the class index; `potentialRatio`/`storiesGap` return the env variant; the rest ignore env).
  - `envelopeOf returns { maxStories: envelopeStories[i] }`.
  - `fillStories table` — 4 → [1,2,3,4,4]; 8 → [2,4,6,7,8]; 24 → [6,12,18,22,24]; 1 → [1,1,1,1,1]; `FILL_LEVELS` ascending, last 1.
- [ ] **Step 3: Run** `npx vitest --run --project server src/lib/data/scenario-codec.test.ts` — expect FAIL ("not implemented").
- [ ] **Step 4: Implement the bodies.** `decodeScenarioPayload` takes F from `header.fillLevels.length`; it validates every column's offset/byteLength against the buffer and expected length (N or N×F, or Σ idSuffixLen), every dictionary index, and builds `index`. `readScenarioParcels` pipes the body (a `Uint8Array` is wrapped in a `Blob(...).stream()` or a one-chunk `ReadableStream`) through `new DecompressionStream('deflate-raw')`, collects the bytes, and decodes; any inflate error is rethrown as `ScenarioFormatError('inflate failed: …')`.
- [ ] **Step 5: Run** the server test file — expect PASS. Update `scenario-codec.step0.test.ts` (remove the two not-implemented tests) and run it — PASS.
- [ ] **Step 6: Write the client spec** `scenario-codec.svelte.spec.ts`: compress `encodeScenarioPayload(scenarioTiny())` with `new CompressionStream('deflate-raw')` in Chromium, pass the resulting `ReadableStream` to `readScenarioParcels`, assert deep equality with the fixture; second test: a truncated compressed buffer rejects with `ScenarioFormatError`.
- [ ] **Step 7: Run** `npx vitest --run --project client src/lib/data/scenario-codec.svelte.spec.ts` — PASS. Then `npm run check` and `npm run lint` — clean.
- [ ] **Step 8: Commit** `feat(scenario): implement the sfh-scenario/1 codec`.

### Task 2: Shared yield function

**Files:**
- Create: `src/lib/data/scenario-yield.ts`
- Create: `src/lib/data/scenario-yield.test.ts`, `src/lib/data/scenario-yield.property.spec.ts`

**Interfaces:**
- Consumes: `generate`, `fnv1a32` from `src/lib/generator`; `ParcelRecord`.
- Produces: `scenarioYield(rec: ParcelRecord, stories: number, cap: number | null): number` (gross units, integer ≥ 0). Task 8 calls it.

Rules (spec §4.7): `stories ≤ 0` returns 0 without calling `generate`; else `b = generate(rec, { maxStories: stories }, fnv1a32(rec.id), 'max')`; `null` → 0; `b.replacesExisting === false` (ADU) → 0; else `g = b.units`; if `cap !== null`: `g = min(g, cap)`, then 0 if `cap ≤ rec.existingUnits`.

- [ ] **Step 1: Write failing tests** (`scenario-yield.test.ts`, `vi.mock('../generator', …)` stubbing `generate`): `ADU outcome gives 0`; `null gives 0`; `cap clips gross units` (stub returns 10 units, cap 6 → 6); `cap at or below existing gives 0` (cap 3, existingUnits 3 → 0); `no cap passes gross through`; `stories 0 gives 0 and never calls generate`; `passes fnv1a32(id) as the seed and { maxStories: stories }` (assert the stub's call arguments).
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/data/scenario-yield.test.ts` — FAIL.
- [ ] **Step 3: Implement** `scenarioYield`.
- [ ] **Step 4: Write** `scenario-yield.property.spec.ts` (real generator; parcels from `src/lib/generator/fixtures/*.json`, stories 0..80, cap null or 0..500): result is an integer in [0, 65535] and two calls return the same value.
- [ ] **Step 5: Run** both files — PASS. `npm run lint` clean.
- [ ] **Step 6: Commit** `feat(scenario): add the shared scenarioYield function`.

### Task 3: Manifest `scenarios`, version hash, chreode rule

**Files:**
- Modify: `src/lib/data/manifest.ts:43-73` (schema + superRefine), `src/lib/data/manifest.test.ts`
- Modify: `pipeline/steps/manifest.ts:18` (`buildManifest`), `pipeline/test/manifest.test.ts`
- Modify: `pipeline/lib/version.ts:33` (`PATHS`), `pipeline/test/version.test.ts`
- Modify: `chreode.config.ts`
- Regenerate if the schema change touches it: `src/lib/data/fixtures/manifest.golden.json`

**Interfaces:**
- Produces: `Manifest['scenarios']?: { fzp: { parcels: string; projects: string; calibration: string } }`; `buildManifest({ …, scenarios?: boolean })` emitting `${base}/scenarios/fzp/{parcels.bin,projects.json,calibration.json}` when true. Task 8 passes `scenarios` (true only when all three files exist in `outDir`).

- [ ] **Step 1: Failing tests.** `src/lib/data/manifest.test.ts`: `scenarios is optional`; `a full scenarios object parses`; `a partial fzp object is rejected` (missing `calibration`); `a scenarios url with another version prefix is rejected`; `the golden manifest still validates`. `pipeline/test/manifest.test.ts`: `buildManifest omits scenarios by default` and `emits the three urls under /data/<v>/scenarios/fzp/ when scenarios is true`. `pipeline/test/version.test.ts`: `codeTreeHash changes when a file under src/lib/generator changes` and the same for `src/lib/timelapse` and `src/lib/plan/types.ts` (follow the file's existing temp-repo pattern).
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/data/manifest.test.ts` and `npx vitest --run --project pipeline pipeline/test/manifest.test.ts pipeline/test/version.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Schema field exactly as spec §4.9 (`z.object({ fzp: z.object({ parcels, projects, calibration }) }).optional()` of `RootRelativeUrl`); add the three URLs to the superRefine prefix list as `scenarios.fzp.parcels` etc. `PATHS` gains `src/lib/generator`, `src/lib/timelapse`, `src/lib/plan/types.ts`; update the `codeTreeHash` doc comment. chreode: add step `{ label: 'test:pipeline', run: 'npm run test:pipeline', when: ['pipeline'] }` and rule `{ match: ['src/lib/generator/**', 'src/lib/timelapse/**', 'src/lib/data/**'], triggers: ['lint', 'check', 'unit', 'e2e', 'pipeline'] }` placed before the `src/**` rule. Do not run signoff.
- [ ] **Step 4: Run** the three test files — PASS; `npm run check`, `npm run lint` clean.
- [ ] **Step 5: Commit** `feat(scenario): add manifest scenarios field and hash generator/timelapse`.

### Task 4: Height strings and Local Program envelope

**Files:**
- Create: `pipeline/lib/heights.ts`, `pipeline/lib/local-program.ts`
- Create: `pipeline/test/fixtures/height-strings-2026-10-16.json`
- Create: `pipeline/test/heights.test.ts`, `pipeline/test/local-program.test.ts`

**Interfaces:**
- Produces:
  - `type HeightDistrict = { kind: 'none' } | { kind: 'height'; baseFt: number; lpFt: number | null; r4: boolean; normalised: string }`
  - `normaliseHeight(s: string): string` (step 1 only; used for `none` strings too, so `districts[]` holds normalised strings)
  - `parseHeightDistrict(s: string): HeightDistrict` — throws `HeightParseError` on more than one `//`
  - `storiesFromFt(ft: number): number` = `min(MAX_STORIES, floor(ft / 10))` (tier 3)
  - `localProgramEnvelope(a: { district: HeightDistrict; lotAreaM2: number; excluded: boolean }): { baseStories: number; envelopeStories: number; localProgram: boolean; largeLot65: boolean }`
  Task 7/8 use these names.

Rules: spec §4.2 steps 1–5 and §4.4 (large-lot: `r4 ∧ lotAreaM2 ≥ 743.2 ∧ lpFt' < 65` → 65, tier 1, Bulletin 11 §206.10(d)(1)(C); `lpFt' = max(baseFt, lpFt)`; R-4 with no `//` has `lpFt = baseFt`; `envelopeStories = localProgram ? stories(lpFt') : baseStories`, 0 for `none`; `localProgram = r4 ∧ ¬excluded`).

- [ ] **Step 1: Snapshot the live strings.** `curl -s 'https://data.sf.gov/resource/h9wh-cg3m.json?$select=height,gen_hght&$group=height,gen_hght&$limit=1000'` → write the 269 rows to the JSON fixture as `[{ height, gen_hght }]` sorted by `height`, each extended by hand-checked expected `{ kind, baseFt, lpFt, r4 }` (computed by the rules, then spot-checked against spec §4.2's worked examples). Commit it with the tests.
- [ ] **Step 2: Failing tests.** `heights.test.ts`: `parses every live string` (table over the snapshot: result equals the expected fields); `max height equals gen_hght for every non-sentinel` (`max(lpFt ?? -∞, baseFt) === Number(gen_hght)`); `sentinels are none` (the nine listed in spec §4.2 step 2); worked examples `40//65-R-4` → 40/65/r4, `140/400//140/450-R-4` → 400/450, `55/65-X` → 65/null, `80-T-130-T` → 130, `65-TI/240 Flex Zone-TI` → 240; `the four non-R-4 // strings are not r4` and `120/400//120/650-R4 normalises to -R-4 and is r4`; `two // throws HeightParseError`; fast-check: arbitrary strings never throw anything but `HeightParseError`. `local-program.test.ts`: `large-lot bump` (800 m², `40//40-R-4`, not excluded → envelope 6, `largeLot65` true); `no bump below 743.2 m²`; `lpFt below baseFt takes the max` (synthetic `{ kind:'height', baseFt: 85, lpFt: 65, r4: true }` → envelope 8); `excluded R-4 parcel takes base stories`; `none gives 0/0/false`; `stories clamp at 80` (900 ft → 80).
- [ ] **Step 3: Run** `npx vitest --run --project pipeline pipeline/test/heights.test.ts pipeline/test/local-program.test.ts` — FAIL.
- [ ] **Step 4: Implement** both modules with tier/source comments.
- [ ] **Step 5: Run** — PASS; `npm run lint` clean.
- [ ] **Step 6: Commit** `feat(pipeline): parse FZP height districts and Local Program envelopes`.

### Task 5: Base-zoning density caps (with official-Code re-verification)

**Files:**
- Create: `pipeline/lib/density-caps.ts`, `pipeline/test/density-caps.test.ts`

**Interfaces:**
- Produces: `DENSITY_CAP_CHANGE_DAY` (Day of 2022-11-27); `densityCap(zoning: string | null, lotAreaM2: number, inR4: boolean, day: Day): number | null`; `DENSITY_CAP_TABLE` entries `{ codes: string[]; section: string; url: string; verified: 'official' | 'mirror'; note?: string }`; `UNVERIFIED_DISTRICTS: string[]`. Task 8 calls `densityCap`.

Formulas: spec §4.4 table (A = `floor(lotAreaM2 / 0.09290304)` sf, min 1). Live code shapes (verified 2026-10-16 by `$group` on `acdm-wktn`): split codes joined by `|` (e.g. `RH-2|RM-1`), generic `NCD` and `NCT` (the specific named district is not in the data), null. Rules for these (ruling, see ledger): a split code takes the **most permissive** component — null if any component is null, else the max of the component caps; `NCD` (named district unknown) and every unlisted code → null; null code → null.

- [ ] **Step 1: Re-verify against the official Code (AC 10).** Try `https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_planning/` sections §209.1, §209.2, §710–§713 with curl (and `https://sfplanning.org` / `https://sfplanning.s3.amazonaws.com` PDFs of Table 209.1/209.2) and Director Bulletin 11 (find its official URL; used for Local Program provenance in Task 8 — record it in `density-caps.ts` as `BULLETIN_11_URL`). For each entry record `verified: 'official'` with the official URL when the text was read, else keep `'mirror'` with the gocodebook URL from spec §4.4 and add the district to `UNVERIFIED_DISTRICTS`. If an official value disagrees with the spec table, stop and report it (do not change the value).
- [ ] **Step 2: Failing tests** (spec §6): `RH-2 on 1,000 sf → 2 before and 4 after 2022-11-27`; `RH-3 on 8,000 sf → 8`; `RM-1 on 3,229 sf → 4`; `NC-3 on 6,000 sf outside R-4 → 10, inside R-4 → null`; `RH-1(D)`, `RH-1`, `RH-1(S)`, `RM-2..4`, `NC-1`, `NC-2`, `NC-S` one case each; `NCT, NCT-3, NCD, UMU, C-3-G, P and null → null`; `split RH-2|RM-1 takes the larger cap`; `split RH-2|UMU is null`; `every entry has a section and an https url`; `UNVERIFIED_DISTRICTS lists every 'mirror' entry`.
- [ ] **Step 3: Run** `npx vitest --run --project pipeline pipeline/test/density-caps.test.ts` — FAIL.
- [ ] **Step 4: Implement** with one cited section + URL per entry and tier-1 comments.
- [ ] **Step 5: Run** — PASS; lint clean.
- [ ] **Step 6: Commit** `feat(pipeline): add base-zoning density caps from the Planning Code`.

### Task 6: Three new sources: fetch, normalise, mini fixture

**Files:**
- Modify: `pipeline/sources/datasf.ts`, `pipeline/sources/normalise.ts`, `pipeline/test/fetch.test.ts`, `pipeline/test/normalise.test.ts`
- Modify: `pipeline/test/fixtures/mini/make-fixture.ts`, `pipeline/test/fixtures/mini/README.md`, `pipeline/test/fixtures/mini/sources.lock.json` (generated)
- Create (generated): `pipeline/test/fixtures/mini/raw/datasf-height-bulk.page-000.geojson`, `…/datasf-parcel-attrs.page-000.csv`, `…/datasf-assessor-roll.page-000.csv`
- Regenerate: golden + `e2e/fixtures/data/fixture-0/` (manifest `sources` gains three entries)

**Interfaces:**
- Produces: `DatasfId` gains `'datasf-height-bulk' | 'datasf-parcel-attrs' | 'datasf-assessor-roll'`; `DATASF[id].format?: 'geojson' | 'csv'`; `SourceId`/`TABLES` gain them → `src_height_bulk(height VARCHAR, gen_hght VARCHAR, geom GEOMETRY)`, `src_parcel_attrs(mapblklot VARCHAR, blklot VARCHAR, active BOOLEAN, zoning_code VARCHAR, date_rec_add DATE, date_rec_drop DATE, centroid_latitude DOUBLE, centroid_longitude DOUBLE)`, `src_roll(closed_roll_year INTEGER, parcel_number VARCHAR, use_code VARCHAR, property_class_code VARCHAR, year_property_built INTEGER, number_of_stories INTEGER, number_of_units INTEGER, property_area DOUBLE, assessed_land_value DOUBLE, assessed_improvement_value DOUBLE, status_code VARCHAR)`. Tasks 7–8 read these tables.

Source table, labels, licences and normalise rules: spec §4.1 verbatim (`$where` for the roll is `closed_roll_year >= 2007`; CSV paging via `/resource/<id>.csv`, same `$order=:id`, `$limit`, `$offset`, row count = data rows minus the header, counting quoted newlines correctly; lock file names `<id>.page-NNN.csv`; normalise with `read_csv(…, all_varchar=true)` then `TRY_CAST` — numeric strings like `"3.0"` cast through DOUBLE before INTEGER; ids upper-cased and trimmed; `year_property_built` outside [1850, closed_roll_year] → NULL; `zoning_code`, `use_code`, `property_class_code`, `status_code` trimmed).

Mini fixture content (local metres, lot *i* at x ∈ [10(i−1), 10i]; ids per the README: lot 3 is `8711023C`, lot 4 is `0026T001A`, others `35120NN`):
- Height polygons (y ∈ [−100, 100]), SODA properties `height`, `gen_hght` as strings: x [−60,44) `40//65-R-4` `"65"`; [44,97) `65-X` `"65"`; [97,110) `85//120-R-4` `"120"`; [110,120) `Special Height District` `"4444"`; [120,130) `120/400-R-2  //  140/520-R-2` `"520"`; [130,140) `120/400//120/650-R4` `"650"`.
- Parcel attrs CSV (header `mapblklot,blklot,active,zoning_code,date_rec_add,date_rec_drop,centroid_latitude,centroid_longitude`, SODA quoting, empty for null): one row per mini parcel row — lots 1–14 (lot 2 as `3512101/102/103` under `3512002`), retired `3512099` (centroid of its polygon, `date_rec_drop` `2024-06-30T00:00:00.000`), retired `3512098` (dropped `2019-03-01T00:00:00.000`), null-id active `3512097`. Zoning: lots 1, 2, 8 `RH-2`; 4, 10, 11 `RH-3`; 5 `RH-1`; 6 `RM-1`; 3 `NCT`; 13 `C-3-O`; 14 `C-3-G`; 7, 9, 12 `P`; retired rows `RH-2`; null-id `P`. Centroids are the polygon centroids converted with the fixture's `ll()`.
- Assessor roll CSV, years 2025 and 2024 (header = the spec §4.1 `$select` list; SODA number style `"2.0"`; `status_code` `NA` unless stated):

| parcel_number | use / class | built | stories | units | area sf | land / impr | 2025 | 2024 |
|---|---|---|---|---|---|---|---|---|
| 3512001 | SRES / F | 1912 | 2 | 2 | 2000 | 400000 / 300000 | ✓ | ✓ |
| 3512101, 3512102, 3512103 | SRES / Z | 1975 | 3 | 1 each | 800 each | 200000 / 300000 each | ✓ | ✓ |
| 8711023C | COMH / H1 | 1920 | 3 | 0 | 3000 | 500000 / 500000 | ✓ | ✓ |
| 0026T001A | MRES / A | 1925 | 3 | 3 | 3000 | 300000 / 600000 | ✓ | ✓ |
| 3512005 | SRES / D | 1950 (2024: `"0"`) | 1 | 1 | 1000 | 300000 / 100000 | ✓ | ✓ |
| 3512006 | MRES / F | 1940 | 2 | 2 | 2200 | 350000 / 250000 | ✓ | ✓ |
| 3512007 | MISC / V | empty | 0 | 0 | 0 | 100000 / 0 | ✓ | ✓ |
| 3512008 | MRES / A | 1960 | 4 | 12 | 10000 | 800000 / 1200000 | ✓ | ✓ |
| 3512010 | MRES / F | 1930 | 2 | 3 | 3000 | 400000 / 400000 | ✓ | ✓ |
| 3512011 | GOVT / X, status `N` | 1955 | 3 | 0 | 6000 | 0 / 0 | ✓ | ✓ |
| 3512013 | MRES / A | 1970 | 3 | 5 | 5000 | 500000 / 500000 | — | ✓ |
| 3512014 | MRES / A | 2015 | 6 | 40 | 30000 | 3000000 / 9000000 | ✓ | ✓ |
| 3512099 (retired) | MRES / A | 1910 | 2 | 7 | 5600 | 300000 / 200000 | — | ✓ |

  (Spec §4.11 deviation, ruled: lot 2 is built 1975 instead of 1985, so the "condo units do not count toward the rent-control exclusion" rule is actually exercised; lot 2 then has `rentControlLikely` 1 and is still Local Program.)
- Lock entries use `retrievedAt: "2026-10-10T00:00:00.000Z"`, `upstreamVersion: "fixture"`, urls `https://fixture.invalid/<name>`, labels/licences/homepages from spec §4.1.

- [ ] **Step 1: Failing tests.** `fetch.test.ts`: `CSV paging locks pages until a short page` (mock `Http` returning a 3-row CSV with a header then a 1-row page for a page size patched or exported for the test; rowCount excludes headers; file names `.csv`; url uses `.csv`); `a trailing empty CSV page (header only) is not locked`; `a quoted newline inside a field counts as one row`. `normalise.test.ts`: `the three new tables have the documented column types` (DESCRIBE on miniDuck tables); `"3.0" units cast to 3`; `year 0 and years after the roll year become NULL`; `parcel_number is upper-cased and trimmed`.
- [ ] **Step 2: Run** `npx vitest --run --project pipeline pipeline/test/fetch.test.ts pipeline/test/normalise.test.ts` — FAIL.
- [ ] **Step 3: Implement** the DATASF entries, CSV fetch path and normalise selects; extend `make-fixture.ts` (CSV writer with SODA quoting) and the README tables (lot table gains zoning/district/roll columns; derived row counts gain the three tables); run `npx tsx pipeline/test/fixtures/mini/make-fixture.ts`.
- [ ] **Step 4: Run** the two test files — PASS. Run `npm run pipeline -- fixture --update-golden`; review the diff (manifest/report gain only the three sources); run `npm run test:pipeline` — PASS.
- [ ] **Step 5: Commit** `feat(pipeline): fetch and normalise height districts, parcel attributes and the assessor roll`.

### Task 7: Scenario SQL: district join, lineage, roll aggregation, features

**Files:**
- Modify: `pipeline/lib/duck.ts` (add a row loader), `pipeline/steps/chunks.ts` (extract record reading)
- Create: `pipeline/sql/80_scenario.sql`, `pipeline/sql/81_scenario_features.sql`, `pipeline/steps/scenario-sql.ts`
- Create: `pipeline/test/scenario-sql.test.ts`

**Interfaces:**
- Consumes: Task 4 `parseHeightDistrict`, `normaliseHeight`; Task 6 `src_*` tables; existing `parcels`, `parcel_out`.
- Produces:
  - `createTableFromRows(db: Duck, table: string, columns: [name: string, type: string][], rows: (string | number | boolean | null)[][]): Promise<void>` in `duck.ts` (any number of rows; deterministic).
  - `readParcelRecords(db: Duck): Promise<{ rec: ParcelRecord; cellId: string }[]>` in `chunks.ts`, sorted by id, the exact records `writeChunks` encodes (`writeChunks` now uses it; chunks stay byte-identical).
  - `runScenarioSql(db: Duck, records: { rec: ParcelRecord; cellId: string }[]): Promise<{ parseFailures: string[] }>` in `pipeline/steps/scenario-sql.ts`, which runs, in order: (1) TS creates `sc_height_parse(height VARCHAR, normalised VARCHAR, kind VARCHAR, base_ft INTEGER, lp_ft INTEGER, r4 BOOLEAN)`, one row per distinct `src_height_bulk.height` (a `HeightParseError` string is recorded, gets kind `none`, and is returned; count `scenario.height.parse_fail`); (2) `80_scenario.sql`; (3) TS creates `sc_parcel(id VARCHAR, lot_area_m2 INTEGER, eligible BOOLEAN, base_stories INTEGER, cap_pre INTEGER, cap_post INTEGER)` from the records, `sc_district` and `sc_zoning`: `lot_area_m2 = round(rec.areaM2)`, `base_stories = storiesFromFt(base_ft)` (0 for none), `cap_pre`/`cap_post` = `densityCap(zoning, lot_area_m2, r4, day)` for a day before / on `DENSITY_CAP_CHANGE_DAY` (NULL = none); (4) `81_scenario_features.sql`. Task 8 calls it.
  - `80_scenario.sql` outputs: `sc_district(id, district VARCHAR /* normalised, '' none */, kind, base_ft, lp_ft, r4, overlap_frac DOUBLE, split BOOLEAN)` for every `parcels` row; `sc_zoning(id, zoning_code)`; `parcel_lineage(blklot VARCHAR, retired_mapblklot VARCHAR, current_mapblklot VARCHAR /* NULL = unmatched */, date_rec_drop DATE)` one row per retired attrs row with a blklot; `sc_roll_agg(id, roll_year, units, stories, year_built, land, impr, floor_area_m2, use_code, land_use_class INTEGER /* index into LAND_USE_CLASSES */, noncondo_units, hotel BOOLEAN, status_n BOOLEAN)`; report counts `scenario.height.*` (from the SQL side: `none`, `no_district`, `split`, `split_units` (Σ `parcel_out.units` on split parcels), `dbl_non_r4`), `scenario.roll.years`, `scenario.roll.latest`, `scenario.roll.matched_parcels`, `scenario.roll.unmatched.<y>`, `scenario.roll.unmatched_units.<y>`, `scenario.roll.lineage_retired`.
  - `81_scenario_features.sql` output: `sc_features(mapblklot, roll_year, lien_day INTEGER, existing_units, existing_stories, year_built, land_value, improvement_value, use_code, land_use_class INTEGER, zoning_code, base_stories, base_density_cap, lot_area_m2, improvement_share FLOAT, rent_control_likely BOOLEAN, imputed UTINYINT, existing_floor_area_m2 DOUBLE, eligible BOOLEAN, noncondo_units, hotel, status_n)` one row per `sc_roll_agg` row, and `sc_medians(roll_year, land_use_class, year_built, improvement_share)` used for no-roll parcels in Task 8.

Rules: spec §4.3 (largest overlap in EPSG:7131, ties ≤ 0.01 m² → district containing the label point → smaller normalised string; `split` when overlap < 90% of parcel area; no overlap → `''`/`none`), §4.5 (mapping (a)/(b)/(c); per-blklot pick: (a) if any attrs row for the blklot has a current mapblklot — the smallest such; else (b) over its retired rows' centroids, smallest containing id; else unmatched), aggregation and `landUseClass` mapping (largest `property_area` row, ties by smallest `parcel_number` then `use_code`; class code starting `V` → vacant; unmapped use codes → other), zoning pick like `10_parcels.sql:13` over active attrs rows, condo class list and hotel class list from §4.4. Features (§4.5): `existing_stories` = agg stories if > 0, else `max(1, round(parcel_out.height_m / 3.1))` if `height_m > 0` (imputed bit 1), else 0; `year_built` NULL → `quantile_disc(year_built, 0.5)` of the same (class, year) over non-vacant rows with a value (bit 0), vacant → 0 with no bit; `improvement_share` = `impr / (land + impr)` rounded to 1/200, `land + impr = 0` → the (class, year) `quantile_disc` median of the unrounded shares, then rounded (bit 2), vacant → 0; `rent_control_likely = existing_units ≥ 2 ∧ year_built < 1979` on the imputed year; `lien_day` = Day of 1 January `roll_year`; `base_density_cap` = `cap_pre` if `lien_day` < Day(2022-11-27) else `cap_post`; `existing_floor_area_m2` = Σ `property_area` × 0.09290304 when > 0 else `parcel_out.floor_area_m2`. `gov_zero_units` is counted in Task 8.

- [ ] **Step 1: Failing tests** (`scenario-sql.test.ts` on `miniDuck()` after `runSql`, `readParcelRecords` and `runScenarioSql`): `lot 5 takes 65-X by largest overlap, split 0`; `lot 10 takes 65-X with split 1 and overlap 0.7`; `lot 12 district is Special Height District, kind none`; `lot 14 district is normalised 120/400//120/650-R-4`; `lineage maps retired 3512099 to 3512012 (date 2024-06-30) and 3512098 to 3512001`; `lot 12 has a 2024 roll row with 7 units and no 2025 row`; `lot 2 aggregates three condos: 3 units, noncondo_units 0`; `lot 11 has 0 units and status_n`; `lot 3 is a hotel and lot 4 has 3 non-condo units built 1925`; `the features table has exactly roll years 2024 and 2025` and every T13 column name of spec §4.6 present in `sc_features` (minus `base_yield`, `potential_ratio_base`, `stories_gap_base`, `hostable_base`, which Task 8 adds); `lot 5 2024 year_built is imputed with bit 0`; `lot 11 improvement_share is imputed with bit 2`; `lot 7 is vacant with year 0 and share 0, no imputed bits`; `a parcel outside every height polygon gets district '' and kind none` (insert a synthetic far-away parcel into a copy of the tables, Review Focus 3); `writeChunks output is unchanged` (covered by the golden test).
- [ ] **Step 2: Run** `npx vitest --run --project pipeline pipeline/test/scenario-sql.test.ts` — FAIL.
- [ ] **Step 3: Implement** the loader, the `readParcelRecords` extraction, and both SQL files (comment header in the style of the existing SQL files; every numeric constant with its tier/source comment).
- [ ] **Step 4: Run** the new test and `npx vitest --run --project pipeline pipeline/test/chunks.test.ts pipeline/test/golden.test.ts` — PASS.
- [ ] **Step 5: Commit** `feat(pipeline): scenario SQL for district join, lineage, roll aggregation and features`.

### Task 8: Scenario build step: yields, T13 parquet, T11 file, fixture goldens

**Files:**
- Create: `pipeline/steps/scenario.ts`, `pipeline/test/scenario-features.test.ts`
- Modify: `pipeline/steps/build.ts` (call the step after `writeChunks`/re-encode; `BuildOpts.derivedRoot?: string`, default `<repo>/pipeline/.cache/derived`; pass `scenarios` to `buildManifest`; merge counts; `report.time('scenario', …)`), `pipeline/steps/fixture.ts` (use a temp `derivedRoot` inside its `outRoot`; `GOLDEN_FILES` gains the decoded dump), `pipeline/test/golden.test.ts`, `pipeline/config.ts` (nothing yet besides comments; profile fields come in Task 9)
- Regenerate: golden (`report.json`, new `scenarios/fzp/parcels.decoded.json`) and `e2e/fixtures/data/fixture-0/` (new `scenarios/fzp/parcels.bin`)

**Interfaces:**
- Consumes: Tasks 1, 2, 4, 5, 7 exports.
- Produces: `writeScenario(a: { db: Duck; outDir: string; derivedDir: string; datasetVersion: string; records: { rec: ParcelRecord; cellId: string }[]; capDay: Day; report: Report }): Promise<{ counts: Record<string, number>; warnings: string[] }>`; `scenarioDump(p: ScenarioParcels): unknown` (canonical JSON: typed arrays as plain arrays, `index` omitted, keys in a fixed order); DuckDB tables `scenario_panel` (spec §4.6 columns, sorted by `mapblklot, roll_year`) and `parcel_lineage`; files `<derivedDir>/parcel-panel.parquet`, `<derivedDir>/parcel-lineage.parquet`, `<outDir>/scenarios/fzp/parcels.bin`.

Behaviour:
- `capDay` = Day of the newest lock `retrievedAt` (the build's snapshot day; fixture 2026-10-10) — "today" in spec §4.4/§4.7.
- Base yields (spec §4.7): for every `sc_features` row, `base_yield = scenarioYield(rec', base_stories, base_density_cap)` with `rec' = scenarioRecord(rec, row)` (`existingUnits` = row units, `existingFloorAreaM2` = row floor area, `existingHeightM = existing_stories × 3.1`), memoised on (id, existing_units, existing_floor_area_m2, existing_stories, base_stories, cap); stream by roll year to bound memory; load results with `createTableFromRows` and join. Then `potential_ratio_base FLOAT = base_yield / max(existing_units, 1)`, `stories_gap_base = base_stories − existing_stories`, `hostable_base = eligible ∧ base_stories ≥ 1 ∧ base_yield > 0`. `scenario_panel` keeps exactly the spec §4.6 columns (T13's plus the listed additions); `land_use_class` INTEGER index.
- T11 rows: one per record, sorted by (cellId, id). Latest-year panel row if present, else no-roll defaults: `existingUnits` 0, `existingStories` fallback (bit 1 when used), `landUseClass` `other` (ruling), `yearBuilt`/`improvementShare` = latest-year `sc_medians` of `other` (bits 0, 2), bit 4 set, `rentControlLikely` 0. Exclusions on the latest roll year: rent control = `noncondo_units ≥ 3 ∧ year_built < 1979`; hotel = `hotel`. `localProgramEnvelope(...)` gives base/envelope stories and the flag. `baseCap` = `densityCap(…, capDay)`. `yield[k] = scenarioYield(rec', fillStories(FILL_LEVELS[k], envelopeStories), localProgram ? null : baseCap)` and `baseYield[k]` with `baseStories` and `baseCap`; envelope (or base) stories 0 → all zeros; generate each distinct story count once per parcel; values > 65,535 are clamped and counted in `scenario.yield.clamped`. `hostable`, `hostableBase` per spec §4.4/§4.7. Provenance (five keys, spec §2 header): `envelope` tier 3 (stories rule; base height = current left side for every year), `localProgram` tier 2 with the method text of spec §4.4 and `BULLETIN_11_URL`, `features` tier 0 (method states imputations are tier 2 and the Prop 13 caveat), `existingUnits` tier 0 (latest assessor roll), `yield` tier 3 (the project's typology generator; method states `FILL_LEVELS` is a tier-4 quantisation grid); sources are the DataSF homepages.
- File: `deflateRawSync(encodeScenarioPayload(p), { level: 9 })`.
- Counts (spec §4.10, all prefixed `scenario.`): the TS-side ones plus the SQL ones, `roll.gov_zero_units` (latest-roll `status_n` ∧ units 0 ∧ `rec.existingUnits` > 0) and `roll.gov_zero_units_ludb_units`, `density_cap.<zoning>`/`density_cap.none` over T11 `baseCap`, `imputed.year_built|existing_stories|improvement_share|no_roll`, `units.total`, `yield.fzp_net_total`, `yield.zero_hostable_eligible`, `yield.nonmonotone`, `yield.clamped`, `bytes.payload`; `bytes.file` only when not a fixture build. Also `scenario.panel.years` (distinct panel years), `scenario.roll.latest_eligible_matched` (eligible parcels with a latest-year panel row), `scenario.panel.feature_mismatch` (parcels whose decoded T11 features — every T4a feature in the base variant, plus `imputed` — differ from their latest-year panel row; computed by decoding the written payload).
- Fixture: `fixture()` builds with `derivedRoot = join(outRoot, 'derived')`. Golden: `golden.test.ts` excludes `scenarios/fzp/parcels.bin` from the byte comparison and instead compares `scenarioDump(decode(inflate(parcels.bin)))` of builds a and b with `golden/scenarios/fzp/parcels.decoded.json`; the e2e copy is checked the same way.

- [ ] **Step 1: Failing tests.** `scenario-features.test.ts` (build the mini fixture into a temp dir once, read `parcel-panel.parquet` from its derived dir): `every parcel's 2025 panel row equals its T11 features and mask` (the single-definition rule, spec §6); `the panel has roll years 2024 and 2025 and every T13 column`; `parcel-lineage.parquet has the retired rows`. `golden.test.ts` known answers (spec §4.11, with rulings): lot 1 `3512001` LP, base 4, envelope 6, `rentControlLikely` 1, `baseYield` ≠ `yield`, every `baseYield[k] ≤ 4`; lot 2 `3512002` existingUnits 3, LP; lot 3 `8711023C` not LP (hotel), envelope 4; lot 4 `0026T001A` not LP (rent control), envelope 4; lot 5 district `65-X`, not LP, `baseCap` 4, `baseYield` equals `yield`; lot 6 `baseCap` 3 (ruling: the lot's 40 m² courtyard hole gives 260 m² = 2,798 sf, ⌊2798/800⌋ = 3; spec §4.11 said 4 from 300 m²); lot 10 district `65-X`, split 1; lot 11 existingUnits 0, envelope 12, `report.counts['scenario.roll.gov_zero_units'] === 1`; lot 12 district `Special Height District`, envelope 0, not hostable; lots 3, 13, 14 `baseCap` null (0xFFFF); lot 13 not LP, `baseStories` 40, envelope 40, imputed bit 4; lot 14 district `120/400//120/650-R-4`, LP, envelope 65; lots 7, 9 not hostable; `count` 14; `scenario.units.total` 66; `scenario.height.dbl_non_r4` 1; `scenario.excluded.hotel` 1; `scenario.excluded.rent_control` 1. Two builds give identical decoded dumps.
- [ ] **Step 2: Run** `npx vitest --run --project pipeline pipeline/test/scenario-features.test.ts pipeline/test/golden.test.ts` — FAIL.
- [ ] **Step 3: Implement** `scenario.ts` and the build/fixture wiring.
- [ ] **Step 4: Regenerate** goldens (`npm run pipeline -- fixture --update-golden`), review `report.json` counts against the known answers, run `npm run test:pipeline` — PASS. Run `npm run lint` and `npm run check`.
- [ ] **Step 5: Commit** `feat(pipeline): build scenarios/fzp/parcels.bin and the T13 parcel panel`.

### Task 9: Invariants V15–V19

**Files:**
- Modify: `pipeline/config.ts` (`InvariantProfile` + both profiles), `pipeline/steps/check.ts`, `pipeline/test/invariants.test.ts`
- Regenerate: golden `report.json` (invariant results gain V15–V19)

**Interfaces:**
- Consumes: Task 1 codec, Task 8 counts and file.
- Produces: `InvariantProfile` fields `heightJoinMin`, `rollJoinMin`, `scenarioUnitsRange: [number, number]`, `scenarioMaxBytes`. Live: 0.99, 0.97, `[0.90 * 413208, 1.02 * 413208]`, 3.5e6. Fixture: 1, 0.8 (ruling: 10 of the 12 eligible mini parcels have a 2025 row — lots 12 and 13 deliberately do not), `[66, 66]`, 3.5e6. Each value carries its source comment (413,208 = `HOUSING_STOCK.end2022`, 2023 Housing Inventory Table 1).

V15–V19 exactly as spec §4.10's table; inputs: the decoded `parcels.bin` (via manifest-independent path `scenarios/fzp/parcels.bin`, inflated with `inflateRawSync`), the decoded chunks already loaded by `checkDataset` (eligibility, cell ids), and `extras.counts` (`parcels.emitted`, `scenario.height.parse_fail`, `scenario.yield.clamped`, `scenario.roll.years`, `scenario.panel.years`, `scenario.roll.latest_eligible_matched`, `scenario.units.total`, `scenario.panel.feature_mismatch`, `scenario.yield.fzp_net_total`). V17's capacity warning ([0.25×, 4×] of 780,000, tier 1 cross-check) and V19's > 3.0e6 warning go in `detail` with `ok` true; with `stableDetail` the byte numbers are omitted. `checkDataset` still never throws (a missing file fails V15–V19 with a message).

- [ ] **Step 1: Failing tests** in `invariants.test.ts`: `V15 fails on a wrong count` (counts `parcels.emitted` + 1), `V15 fails when parcels.bin is corrupt` (overwrite bytes); `V16 fails on a parse failure` (count 1); `V17 fails on a clamped yield` (count 1) and `V17 fails when a hostable flag disagrees` (re-encode a mutated decoded payload into the copy); `V18 fails on a missing roll year` (`scenario.panel.years` − 1) and `V18 fails on a feature mismatch`; `V19 fails on an oversize file` (append random bytes past 3.5e6 to a copy — it must then also not decode, so assert only `V19` is in the failed set by giving V15 a valid file and patching the profile `scenarioMaxBytes` to 10 instead); `all pass on the unmutated fixture` keeps passing.
- [ ] **Step 2: Run** `npx vitest --run --project pipeline pipeline/test/invariants.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Regenerate** goldens, run `npm run test:pipeline` — PASS; lint, check clean.
- [ ] **Step 5: Commit** `feat(pipeline): add scenario invariants V15-V19`.

### Task 10: e2e: parcels.bin is served and decodes in the browser

**Files:**
- Create: `e2e/scenario-data.spec.ts`

- [ ] **Step 1: Write the spec.** Test 1: `GET /data/fixture-0/scenarios/fzp/parcels.bin` → 200, `content-type` contains `application/octet-stream`, `cache-control` `public, max-age=31536000, immutable`. Test 2 (`test.use({ bypassCSP: true })`): bundle `src/lib/data/scenario-codec.ts` to an IIFE global with `esbuild` (`build({ bundle: true, write: false, format: 'iife', globalName: 'sfhScenario' })`), go to any app page, `page.addScriptTag({ content })`, then in `page.evaluate` fetch the file, `await sfhScenario.readScenarioParcels(res.body)`, and return `count` and the envelope of `3512014`; assert 14 and 65.
- [ ] **Step 2: Run** `npm run data:fixture`, `npm run db:migrate`, then `npx playwright test e2e/scenario-data.spec.ts --project chromium` — PASS. `npm run lint` clean.
- [ ] **Step 3: Commit** `test(e2e): serve and decode the fixture scenario parcels`.

### Task 11: Docs

**Files:**
- Modify: `docs/dev/pipeline.md`, `CLAUDE.md` (pipeline row of the Commands table)

- [ ] **Step 1: Edit `docs/dev/pipeline.md`:** intro and Commands mention `scenarios/fzp/parcels.bin`; "Lock and `datasetVersion`" names `src/lib/generator`, `src/lib/timelapse` and `src/lib/plan/types.ts` in the code hash (the yields depend on the generator, so a generator change gives a new version); "Fixture" replaces "CI regenerates it and fails on any diff …" with: CI loads fixture-0 (`.github/workflows/ci.yml`, `npm run data:fixture`) but does not regenerate it; drift is caught by `pipeline/test/golden.test.ts` under `npm run test:pipeline`, which chreode runs for pipeline, generator, timelapse and `src/lib/data` changes; `parcels.bin` is compared decoded (`golden/scenarios/fzp/parcels.decoded.json`); "Where things land" gains `pipeline/.cache/derived/<v>/parcel-panel.parquet` and `parcel-lineage.parquet` (never uploaded); "Invariants" gains V15–V19 one-liners. Add a short "Scenario parcels" section: sources, what T11/T13 hold, the density-cap verification status (`UNVERIFIED_DISTRICTS`).
- [ ] **Step 2: Edit CLAUDE.md** pipeline description if it lists outputs (keep the table format). Run `npx prettier --check docs/dev/pipeline.md CLAUDE.md` and `npx vitest --run --project server scripts/docs-index.spec.ts` — PASS.
- [ ] **Step 3: Commit** `docs(pipeline): document scenario parcels and correct the fixture CI claim`.

### Task 12: Live fetch and build

**Files:**
- Modify: `pipeline/sources.lock.json` (three new entries, others unchanged)

- [ ] **Step 1: Seed the raw cache** without refetching existing sources: hard-link (`ln`) or copy each file named by the current lock's sha256 from `/Users/mindlace/Projects/sfhousing/.claude/worktrees/transit-dataset/pipeline/.cache/raw/` into this worktree's `pipeline/.cache/raw/` (all 20 are present there; verify with the lock).
- [ ] **Step 2: Fetch** `npm run pipeline -- fetch --only datasf-height-bulk,datasf-parcel-attrs,datasf-assessor-roll` (long: ~80 roll pages). Confirm the three entries, licences `public-domain`, `PDDL-1.0`, `PDDL-1.0`, and that the other entries are byte-identical in the lock diff.
- [ ] **Step 3: Build** `npm run pipeline -- build` (no `--skip-tiles`). Expect V1–V19 OK, `out/<v>/scenarios/fzp/parcels.bin` ≤ 3.5 MB, `report.json` `scenario.roll.latest` 2025, `pipeline/.cache/derived/<v>/parcel-panel.parquet` with roll years 2007–2025 and `parcel-lineage.parquet`. Record the counts (`scenario.*`), timings and V15–V19 details in the report file. If an invariant fails, stop and report the numbers; do not loosen thresholds.
- [ ] **Step 4: Commit** `chore(pipeline): lock height districts, parcel attributes and the assessor roll`.
