# /sim Data Layers (Plan 1 of 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the per-lot data the `/sim` policy levers need in the dataset:

- the zoning use district;
- the historic resource status, with a derived A/A\* protection flag;
- the FZP yield cap;
- the City's SB 79 exemptions;
- an **SB 79 as written** stock layer (envelope, density-capped yields, `hostable`);
- the **current-law** envelope, FZP + Planning Code §207.11 (Ord. 082-26);
- street frontage (segments, class, name, one lot deep).

All of it is precomputed by the pipeline, so the worker only recomputes the lots a user touches.

**Architecture:** Two new column files sit next to `parcels.bin`, in the same row order: `scenarios/fzp/policy.bin` (codec `sfh-policy/1`) and `scenarios/fzp/frontage.bin` (codec `sfh-frontage/1`). Each header carries a hash of the parcel ids, so a file cannot be paired with the wrong `parcels.bin`. New optional manifest keys name them: `scenarios.fzp.policy` and `scenarios.fzp.frontage`. `parcels.bin` and `sfh-scenario/1` are untouched, so `/fzp` and the dataset now in production keep working unchanged.

New pipeline steps (`policy`, `frontage`) run after transit. The lock gains three non-optional sources: DataSF street centerlines (`3psu-pn9h`), DataSF historic resource status (`3tsw-4idn`), and the Board File 260132 exemption tables. A fourth, MTC's SB 79 TOD stop map, is added only if it is open data. The SB 79 and §207.11 parameters live in a cited config, `pipeline/sb79-config.ts`. New invariants V31–V34 check the new files.

**Tech Stack:** TypeScript pipeline (tsx), DuckDB spatial (`@duckdb/node-api`), shared codecs in `src/lib/data/` (worker-safe, zod-free), Vitest (`pipeline`, `server` and `client` projects), Playwright, SvelteKit 2 / Svelte 5.

**Spec:** `docs/superpowers/specs/2026-10-28-sim-policy-levers-design.md`, approved 2026-10-28. It includes "Partner rulings", **"Partner rulings, round 2"** (current law = FZP + §207.11; SB 79 as written capped at statute density; exemptions; historic A/A\*; commercial corridor; MTC tiers), and "Calls made after the builder check". Read it together with `docs/superpowers/specs/2026-10-16-scenario-data-design.md` §4.4–§4.12 (the T11 file, invariants and T14 rules extended here) and `docs/dev/pipeline.md`.

## Plan sequence

This is plan 1 of 5. The partner asked for the data work to come first. Later plans, each written after the previous one lands:

1. **Data layers** (this plan). Pipeline, lock, invariants, fixture, and client decoders for `policy.bin` and `frontage.bin`.
2. **Policy engine.** `PolicyOp`s for stock layers (FZP, SB 79 as written, base), the user layer, protections and timers; in-flight versus new-project scope; the current-law twin; the worker lookups seam (`chanceTable`, `typicalMonths`); background recompute of touched lots. Plan 2 consumes `historicProtected` (ruling 4) and the current-law columns. It also owns Open question 1 (time-varying current law).
3. **`/sim` page, zoning layers and brush UI.** Covers `/fzp` → `/sim` routing, layer toggles, and the transit, street, area, freehand and protection brushes. Plan 3 composes "commercial corridor" from `frontingRows` (street class) and `isNeighborhoodCommercial` (use district) (ruling 5).
4. **Permitting timeline UI and presets.**
5. **Publishing `/sim` policies.**

Nothing in this plan builds UI or simulation behaviour. The decoders here are the contract plans 2 and 3 consume.

## Findings this plan rests on (verified 2026-10-28)

- **Use district per lot is already in the lock.** `datasf-parcel-attrs` (`acdm-wktn`, PDDL-1.0) selects `zoning_code`. `80_scenario.sql` resolves it per parcel into `sc_zoning(id, zoning_code)`, and `scenario.ts` already uses it for density caps. `acdm-wktn` is the parcels dataset, not a separate zoning dataset. Split codes such as `RH-1|RM-1` occur.
- **Street centerlines:** DataSF "Streets – Active and Retired", `3psu-pn9h`, licence PDDL, refreshed daily.
  - Fields: `cnn`, `streetname` ("MISSION ST"), `classcode`, `layer` (STREETS, PAPER, PAPER_WATER, PRIVATE, FREEWAYS, UPROW, PARKS, STREETS_PEDESTRI, …), `active`, `line`.
  - `classcode` values: 0 Other (private/paper), 1 Freeway, 2 Major street/Highway, 3 Arterial, 4 Collector, 5 Residential, 6 Freeway ramp.
  - Active segments by class: 0: 1,145; 1: 110; 2: 202; 3: 1,530; 4: 2,376; 5: 10,906; 6: 109. That is 16,378 in all, which fits in a u16.
- **Historic status:** DataSF "Historic Resource Status by Parcel", `3tsw-4idn`, licence PDDL, updated daily.
  - Fields: `apn` (= blklot), `ceqacode`, `ceqacodea10a11`.
  - `ceqacodea10a11` codes, by count: A 21,931; A\* 2,551 (Article 10/11 listed, or in an Article 10/11 district); B 119,301 (unknown, mostly "45 years or older"); C 19,505.
  - Ruling 4: protection = A or A\*.
- **SB 79 standards** (ABAG/MTC "Senate Bill 79 (2025) Summary", updated 2026-07-01, Table 1, p. 7; Gov. Code §65912.157(a)(3)–(6), (e)).
  - Tier 1 (heavy rail, or very-high-frequency commuter rail at 72 or more trains a day): adjacent (within 200 ft of a pedestrian access point) 95 ft, 160 du/ac, FAR 4.5; within ¼ mi 75 ft, 120 du/ac, FAR 3.5; ¼ to ½ mi 65 ft, 100 du/ac, FAR 3.0.
  - Tier 2 (light rail, including streetcar, trolley and tramway; high-frequency commuter rail at 48 or more a day; BRT): adjacent 85 ft, 140 du/ac, FAR 4.0; within ¼ mi 65 ft, 100 du/ac, FAR 3.0; ¼ to ½ mi 55 ft, 80 du/ac, FAR 2.5.
  - The ½-mile band applies in cities of at least 35,000 people. Distances run from the nearest edge of the parcel (§65912.157(b)).
  - Site conditions: zoned residential, mixed-use or commercial; at least 5 units; not a site with more than 2 rent-controlled units occupied in the last 7 years (§65912.157(h)).
  - Effective 2026-07-01.
- **SF Ordinance No. 082-26** (File 260132; finally passed 2026-05-05; approved 2026-05-08; effective 31 days after enactment).
  - §3 permanently exempts the parcels in the "Table of Permanent Exclusions": industrial employment hubs (zones M, SALI, PDR, WMUO, P), and sites more than a 1-mile walk from a stop.
  - §4 temporarily exempts the parcels in the "Table of Temporary Exemptions-Low Resource Parcels" (substituted 2026-04-13), until one year after the 7th-cycle Housing Element.
  - §5 adds Planning Code §207.11. (b) It applies to a parcel that:
    - (1) lies partly or wholly within ½ mi of a TOD stop (§65912.156);
    - (2) is in a district that principally permits residential uses;
    - (3) has a numeric density limit, or a height limit under 40 ft;
    - (4) is outside R-4;
    - (5) is not seeking a §206.6 bonus;
    - (6) is not exempted by the ordinance's tables;
    - (7) is not an Article 10 landmark or contributor, or an Article 11 Category I–IV building;
    - (8) has a permitted density below the §65912.157 minimum.
  - §207.11(c)(1): density up to 50% of the §65912.157 density on that parcel. (c)(2): a height limit under 40 ft becomes 40 ft.
  - §6 adopts the Alternative Plan, which keeps §65912.157 from taking effect in SF until the next Housing Element cycle. §10 lets the Planning Director remove parcels from the tables.
  - The tables are on file in Board File 260132. They are not on DataSF.
- **Size budget.** The production `parcels.bin` for dataset `2026-10-19-bf89390d` is 2,109,264 B, with 155,020 parcels and a payload of 8,741,160 B. Deflated sizes per column: `yield` 147 KB, `baseYield` 113 KB, `envelopeStories` 12 KB, `baseCap` 20 KB, `district` 13 KB, `flags` 25 KB. V19 warns at 3.0 MB and fails at 3.5 MB.

## Budget decision: separate files, not new `parcels.bin` columns

The policy columns would deflate to about 0.35–0.55 MB: two yield tables at about 150 KB each, plus stories, caps, codes and flags. On their own they would fit under V19's warn line. Frontage, at roughly 200k–400k lot–segment entries, adds an estimated 0.3–0.7 MB more, which would push `parcels.bin` to or past the 3.0 MB warning. Separate files win for four reasons:

1. **Deployed code meets the promoted dataset.** Code ships on every merge to `main`, while `PUBLIC_DATASET_VERSION` moves later (`docs/dev/deploy.md`). `decodeScenarioPayload` fails on any missing column, so a `sfh-scenario` column change would break `/fzp` in production until the new dataset is promoted. Optional manifest keys degrade cleanly.
2. **First paint.** `/fzp` does not download lever data it never uses.
3. **Headroom.** `parcels.bin` keeps its V19 headroom (3.5 MB limit, 3.0 MB warning), unchanged.
4. **A fixed codec.** The header of `scenario-codec.ts` declares `sfh-scenario/1` "step 0 and fixed".

The new files get their own budgets, `policyMaxBytes` and `frontageMaxBytes`: 1.0 MB each, warning at 0.75 MB. Task 11 measures them on a live build.

## Global Constraints

- **Stack and style.** Same stack and conventions as the repo: Svelte 5 runes, Tailwind 4, colocated Vitest, Playwright e2e, WCAG 2.2 AA, `expect.requireAssertions` (every test calls `expect`). 2-space indent, single quotes, no trailing commas, 100 columns.
- **Determinism.** Spec: "The simulation stays client-side in the worker. It is deterministic in `(dataset, levers, seed)`." The new files are byte-deterministic payloads. The golden compares their decoded dumps, as it does for `parcels.bin`.
- **New data goes through the pipeline.** Spec: "New static data (street-frontage matching, SB 79 inputs) goes through the pipeline into an immutable dataset version, with its sources in the lock and attribution. The scenario file size budget (V19, 3.5 MB) applies."
- **No CSP change.** Spec: "CSP changes are interface changes (`kit.csp`)." This plan changes no CSP.
- **`parcels.bin` is frozen.** `parcels.bin`, `sfh-scenario/1` and `src/lib/data/scenario-codec.ts` are not modified. `/fzp` behaves identically on the current production dataset and on the new one.
- **Optional manifest keys.** `scenarios.fzp.policy` and `scenarios.fzp.frontage` are optional. Client code must parse a manifest that lacks them.
- **Evidence hierarchy.** Per-record data, then official aggregates, then inferences, then literature, then invented values. Every numeric parameter carries a comment or a `Cite` naming its tier (0 per-record … 4 invented) and its source. Unsourced parameters go in `UNSOURCED` (in `pipeline/sb79-config.ts`) and in `docs/dev/pipeline.md`. Never invent one silently.
- **Current law (ruling 1).** Current law is FZP + §207.11 with the City's permanent and temporary exemptions applied. SB 79 as written is a separate stock layer. `CURRENT_LAW_RULE = 'fzp+s207.11'`.
- **SB 79 density (ruling 2).** SB 79 as written is capped at the statute's du/ac for its tier and band, `ceil` or `floor` as Task 1 pins. It ignores City exemptions (ruling 3). The State Density Bonus Law is not modelled.
- **Stock-layer blend.** "Most permissive" between two layers means the layer with the larger full-fill yield (`mostPermissive`, Task 2). A tie keeps the first layer (FZP). A project uses one regime, so a row's stories, cap and yields always come from one layer.
- **Geometry.** TOD distance and frontage use `parcels.geom_orig` (the DataSF outline, PDDL), not the OSM-clipped `geom`. `DERIVED_LICENSE` in `pipeline/steps/build.ts` stays unchanged.
- **T14 rules.** Every rule that defaults, replaces or drops a value, and every observation count, is a registered T14 rule in `pipeline/lib/quality-rules/sd.ts`. After adding one, run `npm run pipeline -- quality-doc`.
- **Shell and worktree.** Never compound `cd … && cmd`. Work only in this worktree (`.claude/worktrees/sim-policy-levers`).
- **No push, no upload.** `npm run signoff` runs once, after the last task, when the controller asks. Uploading or promoting a dataset version needs the user's go-ahead.
- **Historical docs.** Dated specs and plans under `docs/superpowers/` are historical, so document changes in `docs/dev/pipeline.md`.
- **Commits.** Conventional Commits, ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, passed as a second `-m`.

## Review Focus

1. **Code deployed before the dataset is promoted.** The new client code must parse the `2026-10-19-bf89390d` manifest, which has no `policy` or `frontage` keys. `/fzp` must never touch the new decoders. Task 5 tests `manifest.golden.json` without the keys and a copy with them. Task 11 runs `e2e/fzp.spec.ts` and `e2e/fzp-sim.spec.ts`.
2. **A policy or frontage file paired with the wrong `parcels.bin`** (stale cache, reordered rows, another dataset). This must be a decode error, never misaligned rows. Tasks 3 and 4 test a one-id change, a reordered list and a count mismatch.
3. **Commuter rail counted per platform.** A Caltrain station has one platform per direction, each under 72 trains a day, so trains must be summed over the station (`stationId`). Lots in reach of several tiers take the tallest standard. A distance exactly at 200 ft, ¼ mi or ½ mi falls in the nearer band. Task 8's `stopTiers` and `bandOf` tests pin all three, and so does the mini Caltrain station (80 trains a day, 40 per platform).
4. **Rear, through, corner and set-back lots.** A rear lot is one lot deep, not fronting. A through lot and a corner lot each front two streets. A lot across a 30 m half-width boulevard fronts it. A lot behind a park parcel is one lot deep. Freeways and paper streets are never fronted. Task 10's `frontage-sql.test.ts` covers each case.
5. **A parcel the City exempts, or one whose zoning the table does not list.** An exempt parcel never gets §207.11, but it still gets SB 79 as written (ruling 3). A split zoning code takes its most permissive component. An unlisted code is excluded and counted, never treated as residential. Task 8 (`zoneClassOf`) and Task 9 (`s207Row`) test these, and so do mini lots 12 (permanent exemption) and 15 (temporary exemption, SB 79 still applies).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `pipeline/sb79-config.ts` (new) | SB 79 statute parameters, stop-tier rules, zone classes, §207.11 rules, the current-law rule, each with a `Cite` and tier; `UNSOURCED` |
| `pipeline/sources/sfbos.ts` (new) | Fetch and normalise the Board File 260132 exemption tables (`sfbos-sb79-exemptions`) |
| `pipeline/sources/mtc.ts` (new, branch A only) | Fetch MTC's SB 79 TOD stops (`mtc-sb79-stops`) |
| `src/lib/data/column-file.ts` (new) | Shared column-file machinery, raw inflate, `idsHash` |
| `src/lib/data/stock-layers.ts` (new) | `mostPermissive` (pipeline now; plan 2's layer blend later) |
| `src/lib/data/policy-codec.ts` (new) | `sfh-policy/1` encode, decode, read; `isNeighborhoodCommercial` |
| `src/lib/data/frontage-codec.ts` (new) | `sfh-frontage/1` encode, decode, read; `frontingRows` |
| `src/lib/data/fixtures/policy-tiny.ts`, `frontage-tiny.ts` (new) | Codec fixtures over `scenario-tiny.ts` |
| `src/lib/data/manifest.ts` | Optional `scenarios.fzp.policy` / `.frontage` |
| `pipeline/steps/manifest.ts`, `upload.ts`, `verify.ts` | Emit, existence-check and HEAD-check the new URLs and the existing `scenarios.fzp.*` |
| `src/routes/attribution/+page.svelte` | Credit line for the new sources |
| `pipeline/sources/datasf.ts`, `normalise.ts`, `pipeline/steps/fetch.ts` | `datasf-streets`, `datasf-historic-status`, `sfbos-sb79-exemptions` (and `mtc-sb79-stops`) → `src_*` |
| `pipeline/test/fixtures/mini/make-fixture.ts`, `README.md`, `sources.lock.json` | Lot 18; lot 17's 30 ft district; streets, historic and exemption rows |
| `pipeline/config.ts` | `SQL_VARS`, profile fields, fixture known answers |
| `pipeline/lib/density-caps.ts` | `fzpYieldCapOf` (`scenario.ts` and `policy.ts`) |
| `pipeline/lib/scenario-files.ts` | `POLICY_BIN`, `FRONTAGE_BIN` |
| `pipeline/sql/82_policy.sql`, `83_frontage.sql` (new) | `pol_historic`, `pol_exempt`, `pol_tod`; `fr_seg`, `fr_front` |
| `pipeline/steps/policy-sql.ts` (new) | Load `pol_stops`, run `82_policy.sql` |
| `pipeline/lib/sb79.ts` (new) | Pure SB 79 rules |
| `pipeline/lib/current-law.ts` (new) | Pure §207.11 rule and `currentLawRow` |
| `pipeline/steps/policy.ts`, `frontage.ts` (new) | Write `policy.bin` and `frontage.bin`, plus their dumps |
| `pipeline/steps/check-policy.ts` (new) | V31–V34 |
| `pipeline/steps/build.ts`, `check.ts`, `fixture.ts` | Wiring, invariants, golden dumps |
| `pipeline/lib/quality-rules/sd.ts` | `sd.historic.no-row`, `sd.sb79.zone-unlisted`, `sd.exempt.unmatched`, `sd.streets.no-frontage` |
| `docs/dev/pipeline.md` | "Policy parcels" and "Street frontage" sections, V31–V34, the generated Data quality section |

---

### Task 1: Research and `pipeline/sb79-config.ts`

**Files:**
- Create: `pipeline/sb79-config.ts`
- Test: `pipeline/test/sb79-config.test.ts`

**Interfaces:**
- Consumes: `Cite` from `pipeline/transit-config.ts`; `ModeId` from `src/lib/data/transit.ts`.
- Produces:
  - `export type Sb79Tier = 1 | 2; export type TodBand = 1 | 2 | 3; // adjacent, quarter, half`
  - `export interface TieredCite extends Cite { tier: 0 | 1 | 2 | 3 | 4 }`
  - `export const BAND_MAX_M: Record<TodBand, number>`, which is `{ 1: 60.96, 2: 402.336, 3: 804.672 }`.
  - `export const STANDARDS: Record<Sb79Tier, Record<TodBand, { heightFt: number; duPerAcre: number; residentialFar: number }>>` and `export const STANDARDS_CITE: TieredCite`.
  - `export const UNITS_ROUNDING: 'ceil' | 'floor'`. This is the rounding of `duPerAcre × acres`, sourced from §65912.157. If the statute is silent, use `'ceil'` per the State Density Bonus Law §65915(q), tier 2, and add it to `UNSOURCED`.
  - `export const VHF_TPD = 72; export const HF_TPD = 48; export const MIN_UNITS = 5;`
  - `export const LIGHT_RAIL_MODES: readonly ModeId[]`. At least `'light-rail'` and `'streetcar'`; `'cable-car'` only if sourced.
  - `export const BRT_STOP_IDS: ReadonlySet<string>`, as `muni:<stop_id>`.
  - `export const TIER_SOURCE: 'mtc' | 'gtfs'`, set by Step 2.
  - `export type ZoneClass = 'residential' | 'mixed' | 'commercial' | 'excluded';`
  - `export const ZONE_CLASS_RULES: readonly { pattern: RegExp; zoneClass: ZoneClass; principallyResidential: boolean; cite: TieredCite }[]`. `principallyResidential` is §207.11(b)(2), taken from the Planning Code use tables.
  - `export const S207: { heightFloorFt: 40; densityShare: 0.5; minDensityDuPerAcre: number; minDensityCite: TieredCite; historicCodes: readonly string[]; cite: TieredCite }`. `minDensityDuPerAcre` is §207.11(b)(8)'s "minimum density required by §65912.157", pinned in Step 4. `historicCodes` is the DataSF proxy for (b)(7), default `['A*']`, tier 2.
  - `export const CURRENT_LAW_RULE = 'fzp+s207.11';`
  - `export const SB79_EFFECTIVE = '2026-07-01';`
  - `export const UNSOURCED: readonly string[]`.

- [ ] **Step 1: Pin the statute.** Read SB 79 as chaptered (`https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB79`), Gov. Code §§65912.155–65912.162. Confirm:
  - every Table 1 value in Findings;
  - the bands and the measurement rule (§65912.157(b));
  - the 5-unit minimum and the 30 du/ac minimum density (§65912.157(a)(1));
  - the rent-control site condition (§65912.157(h));
  - the tier definitions (§65912.156(d), (e), (h), (n), (o), (r));
  - any rounding rule for fractional units.

  The statute is tier 1. Where it differs from ABAG, the statute wins: record the difference and stop for the controller.

- [ ] **Step 2: Choose the stop source (ruling 6).** Determine whether MTC publishes its SB 79 TOD stop/tier map as data (the Plan Bay Area "Preliminary Draft Map: Senate Bill 79 Stops and Zones" and its ArcGIS webmap or feature service), its licence, whether it is final or draft, and its stop fields.
  - **Branch A (open data, licence allows redistribution):** set `TIER_SOURCE = 'mtc'`. Record the query URL, fields, licence and as-of date. Tasks 6 and 8 add the lock source `mtc-sb79-stops`.
  - **Branch B (otherwise):** set `TIER_SOURCE = 'gtfs'`. Record why.

  Either way, pin the GTFS rules, which are primary in B and the cross-check in A:
  - cable cars count as light rail only if MTC's map or an official source says so;
  - the Van Ness BRT stop ids, from SFMTA or MTC sources and the live `gtfs-muni` `stops.txt`, meeting PRC §21060.2(a)(1).

- [ ] **Step 3: Zone classes.** Map every SF use-district family `sc_zoning` can hold (RH, RM, RC, RTO, NC\*, NCT\*, named NCDs, C-2, C-3-\*, MUG/MUO/MUR/UMU/WMUG/WMUO/SPD/RED/RSD/SLR/SLI/SSO, PDR-\*, M-1/M-2, SALI, P, …) to two things:
  - its `ZoneClass`, for SB 79 §65912.157(a);
  - `principallyResidential`, for §207.11(b)(2): residential uses are principally permitted in the district's Planning Code use table.

  Each mapping cites its Planning Code article (tier 1).

- [ ] **Step 4: Pin §207.11 and the exemption tables (ruling 3).**
  - (a) From the ordinance text (`https://media.api.sf.gov/documents/o0082-26.pdf`, §5), pin each §207.11(b) condition, how this plan evaluates it, and its tier:
    - (1) `todBand > 0`;
    - (2) `principallyResidential`;
    - (3) `fzpYieldCap !== null` or FZP base height < 40 ft;
    - (4) not `sc_district.r4`;
    - (5) not modelled (a project choice);
    - (6) not in either exemption table;
    - (7) `historic` code in `S207.historicCodes`;
    - (8) the permitted density is below the §65912.157 minimum. Its comparison is `fzpYieldCap / acres < minDensityDuPerAcre`; uncapped never qualifies.

    Pin (c)(1), the cap: `round(densityShare × duPerAcre × acres)` using `UNITS_ROUNDING`, where `duPerAcre` is the SB 79 standard for the lot's tier and band. Pin (c)(2), the height: 40 ft → `storiesFromFt(40)` = 4 when the FZP height is under 40 ft. Interpretations other than the plain reading go in `UNSOURCED`, for example whether (c)(1) raises or replaces a higher existing cap. Default: the cap is `max(fzpCap, s207Cap)`.
  - (b) Find the three tables in Board File 260132 on the Board's Legistar (`sfgov.legistar.com`, File 260132; attachments "Table of Permanent Exclusions", "Table of Temporary Exemptions-Low Resource Parcels" as substituted 2026-04-13, "Table Demonstrating Housing Capacity for Alternative Plan"). For each, record: the attachment URL; its format; the parcel key (blklot, APN or address); row counts; any terms of use; and whether Planning publishes the same lists (§6(c) directs online maps). Use the licence string the source states. If none is stated, use `SF public record (Board File 260132)`, list the source in `UNSOURCED`, and flag it to the controller.
  - (c) Pick the fetch path:
    - **Path 1, machine-readable** (CSV or XLSX): `fetch` downloads the attachment by URL into the raw store.
    - **Path 2, PDF or a web map:** commit a vendored transcription `pipeline/enrichment/sb79-exemptions.csv` (`apn,table`, `table` ∈ `permanent|temporary`). Its header comment names the source URL, the sha256 of the original and the transcription method. `fetch` downloads the original into the raw store, so the lock archives it, and normalise reads the vendored CSV, after checking that the original's sha256 matches the header.

    Record which path applies.
  - (d) Record HCD's review status of Ord. 082-26 and the status of the litigation over SF's SB 79 implementation.

- [ ] **Step 5: Write the failing test** `pipeline/test/sb79-config.test.ts`:

```ts
it('pins SB 79 Table 1', () => {
  expect(STANDARDS[1][1]).toEqual({ heightFt: 95, duPerAcre: 160, residentialFar: 4.5 });
  expect(STANDARDS[1][2]).toEqual({ heightFt: 75, duPerAcre: 120, residentialFar: 3.5 });
  expect(STANDARDS[1][3]).toEqual({ heightFt: 65, duPerAcre: 100, residentialFar: 3.0 });
  expect(STANDARDS[2][1]).toEqual({ heightFt: 85, duPerAcre: 140, residentialFar: 4.0 });
  expect(STANDARDS[2][2]).toEqual({ heightFt: 65, duPerAcre: 100, residentialFar: 3.0 });
  expect(STANDARDS[2][3]).toEqual({ heightFt: 55, duPerAcre: 80, residentialFar: 2.5 });
  expect(BAND_MAX_M).toEqual({ 1: 60.96, 2: 402.336, 3: 804.672 });
  expect([VHF_TPD, HF_TPD, MIN_UNITS]).toEqual([72, 48, 5]);
  expect(S207.heightFloorFt).toBe(40);
  expect(S207.densityShare).toBe(0.5);
  expect(CURRENT_LAW_RULE).toBe('fzp+s207.11');
});
it('cites every rule with a tier', () => {
  for (const r of ZONE_CLASS_RULES) expect(r.cite.source.length).toBeGreaterThan(0);
  expect(STANDARDS_CITE.tier).toBeLessThanOrEqual(1);
  expect(S207.cite.tier).toBeLessThanOrEqual(1);
});
it('maps each sample SF use district to exactly one rule', () => {
  for (const code of ['RH-1', 'RM-1', 'NCT', 'NC-1', 'C-3-O', 'PDR-1-G', 'P', 'SALI'])
    expect(ZONE_CLASS_RULES.filter((r) => r.pattern.test(code))).toHaveLength(1);
});
```

  Use the values the statute confirms.
- [ ] **Step 6:** Run `npx vitest --run --project pipeline pipeline/test/sb79-config.test.ts`. Expected: FAIL.
- [ ] **Step 7:** Write `pipeline/sb79-config.ts` from Steps 1–4. Name the tier on every entry.
- [ ] **Step 8:** Run the test again. Expected: PASS.
- [ ] **Step 9: Commit.** Run `git add pipeline/sb79-config.ts pipeline/test/sb79-config.test.ts`, then `git commit -m "feat(pipeline): cite SB 79, §207.11 and exemption-table sources" -m "<Step 1-4 findings: branch A/B, path 1/2, licences, HCD/litigation, UNSOURCED>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.

### Task 2: Shared column file and `mostPermissive`

**Files:**
- Create: `src/lib/data/column-file.ts`, `src/lib/data/stock-layers.ts`
- Test: `src/lib/data/column-file.test.ts`, `src/lib/data/stock-layers.test.ts`

**Interfaces:**
- Produces, in `column-file.ts`. It imports only `fnv1a32` from `../generator/seed`.
  - `export type ColType = 'u8' | 'u16' | 'u32' | 'i32';`
  - `export interface ColumnIn { name: string; type: ColType; values: ArrayLike<number> }`
  - `export function encodeColumnFile(magic: string, major: number, header: Record<string, unknown>, columns: readonly ColumnIn[], fail: (msg: string) => never): Uint8Array`. The layout is that of `sfh-scenario/1`: a 4-byte ASCII magic, then a u16 major, a u16 reserved (0), a u32 header length H, the header JSON (with `columns: [{ name, type, offset, byteLength }]` appended, offsets absolute and 8-aligned), then the columns in order. Values are range-checked against their type.
  - `export interface ColumnFile { header: Record<string, unknown>; read(name: string, type: ColType, length: number): Uint8Array | Uint16Array | Uint32Array | Int32Array }`
  - `export function openColumnFile(bytes: Uint8Array, magic: string, major: number, names: readonly string[], fail: (msg: string) => never): ColumnFile`. It checks the magic and major, that the header parses as JSON, that the columns match `names` exactly once each and in order, that they are 8-aligned, non-overlapping and in bounds, and in `read` that `length × size === byteLength`.
  - `export async function inflateRawBody(body: ReadableStream<Uint8Array> | Uint8Array): Promise<Uint8Array>`
  - `export function idsHash(ids: readonly string[]): number`. This is `fnv1a32(ids.join('\n'))`.
- Produces, in `stock-layers.ts`:
  - `export interface LayerTop { yieldTop: number; hostable: boolean }`
  - `export function mostPermissive(a: LayerTop, b: LayerTop): 'a' | 'b'`. It returns `'b'` iff `b.hostable && (!a.hostable || b.yieldTop > a.yieldTop)`.

- [ ] **Step 1: Write the failing tests.**

```ts
// column-file.test.ts
it('round-trips columns of every type with 8-aligned offsets', () => {
  const bytes = encodeColumnFile('TEST', 1, { k: 'v' }, [
    { name: 'a', type: 'u8', values: [0, 255] },
    { name: 'b', type: 'u16', values: [65535, 1] },
    { name: 'c', type: 'u32', values: [4294967295, 0] },
    { name: 'd', type: 'i32', values: [-2147483648, 7] }
  ], fail);
  const f = openColumnFile(bytes, 'TEST', 1, ['a', 'b', 'c', 'd'], fail);
  expect(f.header.k).toBe('v');
  expect(Array.from(f.read('d', 'i32', 2))).toEqual([-2147483648, 7]);
  for (const c of f.header.columns as { offset: number }[]) expect(c.offset % 8).toBe(0);
});
it('rejects an out-of-range value, a wrong magic, a missing column and a wrong length', () => {
  expect(() => encodeColumnFile('TEST', 1, {}, [{ name: 'a', type: 'u8', values: [256] }], fail)).toThrow(/does not fit u8/);
  expect(() => openColumnFile(bytes, 'NOPE', 1, ['a'], fail)).toThrow(/bad magic/);
  expect(() => openColumnFile(bytes, 'TEST', 1, ['a', 'z'], fail)).toThrow(/column z is missing/);
  expect(() => openColumnFile(bytes, 'TEST', 1, ['a'], fail).read('a', 'u8', 3)).toThrow(/bytes, want/);
});
it('idsHash depends on order and content', () => {
  expect(idsHash(['a', 'b'])).not.toBe(idsHash(['b', 'a']));
  expect(idsHash(['a', 'b'])).toBe(idsHash(['a', 'b']));
});
// stock-layers.test.ts
it('picks the larger hostable layer; a tie or a non-hostable b keeps a', () => {
  expect(mostPermissive({ yieldTop: 10, hostable: true }, { yieldTop: 11, hostable: true })).toBe('b');
  expect(mostPermissive({ yieldTop: 10, hostable: true }, { yieldTop: 10, hostable: true })).toBe('a');
  expect(mostPermissive({ yieldTop: 0, hostable: false }, { yieldTop: 5, hostable: true })).toBe('b');
  expect(mostPermissive({ yieldTop: 3, hostable: true }, { yieldTop: 99, hostable: false })).toBe('a');
});
```

- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/data/column-file.test.ts src/lib/data/stock-layers.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement both modules. They must be worker-safe: no zod, no `node:` imports.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5: Commit.** Run `git add src/lib/data/column-file.ts src/lib/data/column-file.test.ts src/lib/data/stock-layers.ts src/lib/data/stock-layers.test.ts`, then `git commit -m "feat(data): shared column-file codec helpers and the stock-layer blend rule" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.

### Task 3: `sfh-policy/1` codec

**Files:**
- Create: `src/lib/data/policy-codec.ts`, `src/lib/data/fixtures/policy-tiny.ts`
- Test: `src/lib/data/policy-codec.test.ts`

**Interfaces:**
- Consumes: Task 2's helpers; `ScenarioParcels`, `FILL_LEVELS`; `Provenance`.
- Produces:

```ts
export const POLICY_FORMAT = 'sfh-policy/1';
export const NULL_CAP = 0xffff;
export const HISTORIC_CODES = ['', 'A', 'A*', 'B', 'C'] as const; // '' = no status row
/** Ruling 4 (spec round 2): historic protection covers A and A*. */
export const HISTORIC_PROTECTED = ['A', 'A*'] as const;
export const TOD_BANDS = ['none', 'adjacent', 'quarter', 'half'] as const;
export const SB79_STATUSES = ['outside', 'applies', 'not-eligible', 'zone', 'rent-control', 'min-units'] as const;
export const S207_STATUSES = [
  'outside', 'applies', 'exempt', 'not-residential', 'no-limit', 'r4', 'historic', 'meets-minimum', 'not-eligible'
] as const;
export type Sb79Status = (typeof SB79_STATUSES)[number];
export type S207Status = (typeof S207_STATUSES)[number];
export interface PolicyParcels {
  format: 'sfh-policy/1';
  datasetVersion: string;
  count: number;
  idsHash: number;
  fillLevels: number[];
  currentLawRule: 'fzp+s207.11';
  tierSource: 'mtc' | 'gtfs';
  useDistricts: string[]; // sc_zoning codes ('' = none), sorted
  provenance: Record<'useDistrict' | 'historic' | 'exemptions' | 'sb79' | 'currentLaw', Provenance>;
  useDistrict: Uint16Array; // index into useDistricts
  historic: Uint8Array; // index into HISTORIC_CODES
  fzpYieldCap: Uint16Array; // the cap parcels.bin `yield` used; NULL_CAP = none
  todTier: Uint8Array; // 0 none, 1, 2: the tier of the standard used
  todBand: Uint8Array; // index into TOD_BANDS
  sb79Status: Uint8Array; // index into SB79_STATUSES
  sb79Stories: Uint8Array; // 0 unless 'applies'
  sb79Cap: Uint16Array; // statute du/ac × acres; NULL_CAP unless 'applies'
  sb79Yield: Uint16Array; // count × F, capped by sb79Cap; each 0 or ≥ MIN_UNITS
  s207Status: Uint8Array; // index into S207_STATUSES
  currentStories: Uint8Array;
  currentCap: Uint16Array; // NULL_CAP = no cap
  currentYield: Uint16Array; // count × F
  hostableSb79: Uint8Array; // flags bit 0
  hostableCurrent: Uint8Array; // flags bit 1
  currentFromS207: Uint8Array; // flags bit 2
  exemptPermanent: Uint8Array; // flags bit 3: Ord. 082-26 §3 table
  exemptTemporary: Uint8Array; // flags bit 4: Ord. 082-26 §4 table
  historicProtected: Uint8Array; // flags bit 5: historic ∈ HISTORIC_PROTECTED
}
export function encodePolicyPayload(p: PolicyParcels): Uint8Array;
export function decodePolicyPayload(bytes: Uint8Array, parcels: Pick<ScenarioParcels, 'count' | 'id' | 'datasetVersion' | 'fillLevels'>): PolicyParcels;
export async function readPolicyParcels(body: ReadableStream<Uint8Array> | Uint8Array, parcels: Pick<ScenarioParcels, 'count' | 'id' | 'datasetVersion' | 'fillLevels'>): Promise<PolicyParcels>;
/** Ruling 5: NC/NCT and named neighborhood-commercial districts; a split code matches if any component does. */
export function isNeighborhoodCommercial(code: string): boolean;
export class PolicyFormatError extends Error { name = 'PolicyFormatError'; }
```

  - Magic `"SFHP"`, major 1.
  - Columns in order: `useDistrict` u16, `historic` u8, `fzpYieldCap` u16, `todTier` u8, `todBand` u8, `sb79Status` u8, `sb79Stories` u8, `sb79Cap` u16, `s207Status` u8, `flags` u8, `currentStories` u8, `currentCap` u16, `sb79Yield` u16×F, `currentYield` u16×F.
  - Header keys: `format, datasetVersion, count, idsHash, fillLevels, currentLawRule, tierSource, useDistricts, historicCodes, todBands, sb79Statuses, s207Statuses, provenance`. The decoder rejects code lists that differ from the constants.
  - Flags bits 6–7 are reserved and must be 0. The decoder also rejects `historicProtected` that disagrees with `historic`.
  - `isNeighborhoodCommercial` uses `NC_PATTERN = /^(NC-[1-3S]|NCD|NCT(-[1-3])?|.+ NCD|.+ NCT)$/`. Task 1's Step 3 must confirm this pattern against the Planning Code's NC district list. If it changes, update it here and in the test.

- [ ] **Step 1: Fixture** `policy-tiny.ts`, built over `scenario-tiny.ts`. Its values are tier 4 (made up) and it says so. It must hold a row of each `SB79_STATUSES` value and each `S207_STATUSES` value the row count allows, plus one row each of: `currentFromS207 = 1`, `fzpYieldCap = NULL_CAP`, `historic = 'A*'` (protected), `historic = 'B'` (not protected), and both exemption bits.
- [ ] **Step 2: Failing tests** in `policy-codec.test.ts`:

```ts
it('round-trips the tiny policy file byte-identically', () => {
  const bytes = encodePolicyPayload(policyTiny(tiny));
  const d = decodePolicyPayload(bytes, tiny);
  expect(encodePolicyPayload(d)).toEqual(bytes);
  expect(d.idsHash).toBe(idsHash(tiny.id));
});
it('refuses a parcels.bin it was not built for', () => {
  expect(() => decodePolicyPayload(bytes, { ...tiny, count: tiny.count - 1 })).toThrow(PolicyFormatError);
  expect(() => decodePolicyPayload(bytes, { ...tiny, id: [...tiny.id].reverse() })).toThrow(/idsHash/);
  expect(() => decodePolicyPayload(bytes, { ...tiny, id: tiny.id.map((x, i) => (i ? x : x + 'X')) })).toThrow(/idsHash/);
  expect(() => decodePolicyPayload(bytes, { ...tiny, datasetVersion: 'fixture-9' })).toThrow(/datasetVersion/);
});
it('rejects reserved flag bits, out-of-range codes and historicProtected that disagrees with historic', () => {
  /* three expects */
});
it('isNeighborhoodCommercial reads split codes', () => {
  expect(['NC-1', 'NCT', 'NCT-3', 'RH-2|NC-2'].map(isNeighborhoodCommercial)).toEqual([true, true, true, true]);
  expect(['RH-1', 'C-3-O', 'RC-4', ''].map(isNeighborhoodCommercial)).toEqual([false, false, false, false]);
});
it('readPolicyParcels inflates a deflate-raw body', async () => {
  expect((await readPolicyParcels(deflateRawSync(bytes), tiny)).count).toBe(tiny.count);
});
```

- [ ] **Step 3:** Run `npx vitest --run --project server src/lib/data/policy-codec.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement on Task 2's helpers. The encoder validates array lengths, that 0/1 columns hold only 0 or 1, and that every dictionary index is in range.
- [ ] **Step 5:** Run the tests again. Expected: PASS.
- [ ] **Step 6: Commit.** Run `git add src/lib/data/policy-codec.ts src/lib/data/policy-codec.test.ts src/lib/data/fixtures/policy-tiny.ts`, then `git commit -m "feat(data): sfh-policy/1 codec for per-lot policy inputs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.

### Task 4: `sfh-frontage/1` codec

**Files:**
- Create: `src/lib/data/frontage-codec.ts`, `src/lib/data/fixtures/frontage-tiny.ts`
- Test: `src/lib/data/frontage-codec.test.ts`

**Interfaces:**
- Consumes: Task 2's helpers; `ScenarioParcels`; `Provenance`.
- Produces:

```ts
export const FRONTAGE_FORMAT = 'sfh-frontage/1';
/** Index = DataSF 3psu-pn9h classcode. */
export const STREET_CLASSES = ['other', 'freeway', 'major', 'arterial', 'collector', 'residential', 'ramp'] as const;
export interface Frontage {
  format: 'sfh-frontage/1';
  datasetVersion: string;
  count: number;
  idsHash: number;
  provenance: Provenance;
  names: string[]; // streetname dictionary, sorted
  segCnn: Uint32Array; // per segment, strictly ascending
  segName: Uint16Array;
  segClass: Uint8Array; // index into STREET_CLASSES
  rowStart: Uint32Array; // count + 1 offsets (derived from frontCount)
  frontSeg: Uint16Array; // per entry
  frontDepth: Uint8Array; // per entry: 0 fronting, 1 one lot deep
}
export function encodeFrontagePayload(f: Frontage): Uint8Array;
export function decodeFrontagePayload(bytes: Uint8Array, parcels: Pick<ScenarioParcels, 'count' | 'id' | 'datasetVersion'>): Frontage;
export async function readFrontage(body: ReadableStream<Uint8Array> | Uint8Array, parcels: Pick<ScenarioParcels, 'count' | 'id' | 'datasetVersion'>): Promise<Frontage>;
/** Rows (ascending, unique) with an entry on a segment where `seg(s)` holds, at depth ≤ maxDepth. */
export function frontingRows(f: Frontage, seg: (s: number) => boolean, maxDepth: 0 | 1): number[];
export class FrontageFormatError extends Error { name = 'FrontageFormatError'; }
```

  - Magic `"SFHF"`, major 1.
  - Columns: `segCnn` u32, `segName` u16, `segClass` u8 (per segment); `frontCount` u8 (per row); `frontSeg` u16, `frontDepth` u8 (per entry).
  - Within a row, entries are sorted by `(depth, seg)`, and no segment appears at both depths. The decoder checks this, plus that `segCnn` is ascending and that the entry total equals Σ `frontCount`.

- [ ] **Step 1: Fixture** `frontage-tiny.ts`, tier 4, made up. Three segments: two named `MISSION ST` (arterial) and one `FIXTURE AVE` (residential). Rows: one corner row (both names, depth 0), one depth-1 row, one row with no entries.
- [ ] **Step 2: Failing tests:**

```ts
it('round-trips and derives rowStart', () => {
  const d = decodeFrontagePayload(encodeFrontagePayload(frontageTiny(tiny)), tiny);
  expect(d.rowStart[d.count]).toBe(d.frontSeg.length);
});
it('frontingRows selects by class or by name, with or without depth 1', () => {
  const byName = (n: string) => (s: number) => d.names[d.segName[s]] === n;
  expect(frontingRows(d, byName('MISSION ST'), 0)).toEqual([CORNER_ROW]);
  expect(frontingRows(d, byName('MISSION ST'), 1)).toEqual([CORNER_ROW, DEEP_ROW]);
  expect(frontingRows(d, (s) => STREET_CLASSES[d.segClass[s]] === 'residential', 0)).toEqual([CORNER_ROW]);
});
it('refuses another parcels.bin, unsorted entries and a segment at both depths', () => {
  /* idsHash, order, duplicate */
});
```

- [ ] **Step 3:** Run `npx vitest --run --project server src/lib/data/frontage-codec.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run the tests again. Expected: PASS.
- [ ] **Step 6: Commit.** Run `git add src/lib/data/frontage-codec.ts src/lib/data/frontage-codec.test.ts src/lib/data/fixtures/frontage-tiny.ts`, then `git commit -m "feat(data): sfh-frontage/1 codec for lot-to-street frontage" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.

### Task 5: Manifest keys, upload/verify coverage, attribution

**Files:**
- Modify: `src/lib/data/manifest.ts:56-79`, `pipeline/steps/manifest.ts` (`buildManifest` gains `policy?: boolean; frontage?: boolean`), `pipeline/steps/upload.ts:105-116`, `pipeline/steps/verify.ts:48-56` (both also list `scenarios.fzp.*`), `src/routes/attribution/+page.svelte`
- Test: `src/lib/data/manifest.test.ts`, `pipeline/test/manifest.test.ts`, `pipeline/test/upload.test.ts`, `pipeline/test/verify.test.ts`, `src/routes/attribution/page.svelte.spec.ts`

**Interfaces:**
- Produces:
  - `Manifest['scenarios']['fzp']` gains `policy?: RootRelativeUrl; frontage?: RootRelativeUrl`.
  - `buildManifest` emits `${base}/scenarios/fzp/policy.bin` and `${base}/scenarios/fzp/frontage.bin` only when `scenarios` and the matching flag are both true.

- [ ] **Step 1: Failing tests.**
  - `manifest.test.ts`:
    - `manifest.golden.json`, which has no new keys, parses and has no `policy`;
    - a copy with both keys parses;
    - a `policy` URL under another version is rejected with `url must start with`.
  - `pipeline/test/manifest.test.ts`: `buildManifest({ …, scenarios: true, policy: true, frontage: false })` names `policy` and not `frontage`.
  - `upload.test.ts`: when the manifest names `policy.bin` and the file is missing, it reports `manifest names … policy.bin but … is missing`.
  - `verify.test.ts`: the policy URL is HEAD-checked.
  - `page.svelte.spec.ts`: with `scenarios.fzp.policy` set, the page shows `Street centerlines and historic resource status from DataSF`; without it, that text is absent.
- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/data/manifest.test.ts`, then `npx vitest --run --project pipeline pipeline/test/manifest.test.ts pipeline/test/upload.test.ts pipeline/test/verify.test.ts`, then `npx vitest --run --project client src/routes/attribution/page.svelte.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add one `{#if hasPolicy}` item after the transit item, with this exact copy, filling the bracket from Task 1 Step 4(b):

  > Street centerlines and historic resource status from DataSF, under PDDL. SB 79 exemption parcel tables from San Francisco Board of Supervisors File No. 260132 (Ordinance No. 082-26), [licence string from Task 1]. Zoning rules follow California Government Code §§65912.155–65912.162 (SB 79, 2025) and San Francisco Planning Code §207.11.

  On branch A, append: `SB 79 transit stop tiers from MTC, [licence].`
- [ ] **Step 4:** Run the Step 2 tests again, plus `npx vitest --run --project server scripts/data-transit.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** Run `git add` on the files above, then `git commit -m "feat(data): optional policy and frontage manifest keys" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.

### Task 6: New sources, mini fixture lot 18, streets, historic and exemption rows

**Files:**
- Create: `pipeline/sources/sfbos.ts`; on branch A, `pipeline/sources/mtc.ts`; on path 2, `pipeline/enrichment/sb79-exemptions.csv`.
- Modify:
  - `pipeline/sources/datasf.ts`, `pipeline/sources/normalise.ts` (`SourceId`, `SOURCE_IDS`, `TABLES`, `buildSelect`), `pipeline/steps/fetch.ts` (dispatch for the new ids);
  - `pipeline/test/fixtures/mini/make-fixture.ts` and `README.md`; regenerate `sources.lock.json` and `raw/*`;
  - `pipeline/config.ts` (`FIXTURE_PROFILE`);
  - the lot-count tests (17 → 18): `pipeline/test/sql.test.ts:25,212`, `pipeline/test/scenario-sql.test.ts:163,230`, `pipeline/test/scenario-features.test.ts:109`, `e2e/scenario-data.spec.ts:52`. Grep `toHaveLength(17)`, `toBe(17)` and `17 parcels` under `pipeline/test` and `e2e` for more.
- Regenerate: `pipeline/test/fixtures/mini/golden/`, `e2e/fixtures/data/fixture-0/`.
- Test: `pipeline/test/normalise.test.ts`, `pipeline/test/fetch.test.ts`.

**Interfaces:**
- Produces:
  - **`datasf-streets`**: `{ dataset: '3psu-pn9h', format: 'geojson', select: 'cnn,streetname,classcode,layer,active,line', where: 'active=true', license: 'PDDL-1.0', homepage: 'https://data.sf.gov/d/3psu-pn9h', label: 'DataSF Streets – Active and Retired (centerlines)' }` → `src_streets(cnn BIGINT, streetname VARCHAR, classcode INTEGER, layer VARCHAR, geom GEOMETRY)`, ordered by `cnn`.
  - **`datasf-historic-status`**: `{ dataset: '3tsw-4idn', format: 'csv', select: 'apn,ceqacode,ceqacodea10a11', license: 'PDDL-1.0', homepage: 'https://data.sf.gov/d/3tsw-4idn', label: 'DataSF Historic Resource Status by Parcel' }` → `src_historic(apn VARCHAR /* upper, trimmed */, ceqacode VARCHAR, ceqacodea10a11 VARCHAR)`.
  - **`sfbos-sb79-exemptions`**, in `pipeline/sources/sfbos.ts`:
    - `export async function fetchSfbosExemptions(rawDir: string, http: Http): Promise<LockEntry>` downloads the Task 1 attachment URL(s), one lock file each, with `license`, `homepage` (the Legistar file page) and `label: 'SF Board File 260132 – SB 79 exemption tables (Ord. 082-26)'`.
    - Normalise yields `src_sb79_exempt(apn VARCHAR, tbl VARCHAR /* 'permanent' | 'temporary' */)`, ordered by all columns. On path 1 the raw files are parsed: DuckDB `read_csv`, or `read_xlsx` from the `excel` extension (load it the way `duck.ts` loads `spatial`). On path 2 normalise reads `pipeline/enrichment/sb79-exemptions.csv`, after checking that each raw file's sha256 equals the one in that CSV's header. A mismatch throws `exemption transcription is stale`.
  - **`mtc-sb79-stops`** (branch A only), in `pipeline/sources/mtc.ts`: fetch the feature service as GeoJSON into `src_mtc_stops(stop_name VARCHAR, tier INTEGER, geom GEOMETRY)`, ordered by all columns.
  - **Mini lot 18** `3512018`: x[120, 130], y[30, 60], directly behind lot 13, in Noe Valley. District `120/400-R-2  //  140/520-R-2`, zoning `RM-1`. Land use `RESIDENT`, resunits 2, res 1600. No building. Roll rows for 2025 and 2024: `MRES/A`, built 2001, 2 stories, 2 units, 1600 sf, 300k/400k.
  - **Mini lot 17's height district becomes `30-X`** (gen_hght `"30"`) over x[E−50, E+50), y[35, 100). The existing `65-X` shoreline district shrinks to y[−100, 35). This gives the fixture a height-limit-under-40 ft case for §207.11.
  - **Mini streets** (local metres, `line` MultiLineString, properties as strings):

    | cnn | streetname | classcode | layer | line |
    | --- | --- | --- | --- | --- |
    | 1000 | MISSION ST | 3 | STREETS | y = −8, x −60 → 95 |
    | 1001 | MISSION ST | 3 | STREETS | y = −8, x 95 → 148 |
    | 2000 | FIXTURE AVE | 5 | STREETS | x = 148, y −60 → 28 (ends below lot 18) |
    | 3000 | PAPER ST | 0 | PAPER_WATER | y = −8, x E−60 → E+60 |
    | 4000 | I-80 | 1 | FREEWAYS | y = 75, x 0 → 140 |

  - **Mini historic rows** (`apn`, `ceqacode`, `ceqacodea10a11`):
    - `3512001` A/A
    - `3512101` C/C, `3512102` A/A, `3512103` C/C
    - `8711023C` B/B
    - `0026T001A` C/C
    - `3512013` A/A\*
    - retired `3512099` A/A
    - lots 4–17 not listed above: C/C
    - lot 18: no row
  - **Mini exemption rows**, in the Task 1 format (path 1: a raw CSV/XLSX shaped like the real attachment; path 2: the vendored-CSV layout plus a stand-in original): `3512012` permanent (lot 12, zoned P), `3512015` temporary (lot 15).
  - **Mini MTC stops** (branch A only): one tier-1 stop at FX-1 (120, 110), one tier-1 stop at the Caltrain station (−40, −80), one tier-2 stop at m4 (100, 100).
  - **`FIXTURE_PROFILE`**: `unitsTarget` 90, `parcelRange` [18, 18], `scenarioUnitsRange` [74, 74]. Update the comments (+2 for lot 18). The `rollJoinMin` comment becomes 13 of 15.

- [ ] **Step 1: Failing tests.**
  - `normalise.test.ts`:
    - `datasf-streets` → 5 rows, first `{ cnn: 1000n, streetname: 'MISSION ST', classcode: 3, layer: 'STREETS' }`;
    - `datasf-historic-status` → 15 rows, with `0026T001A` verbatim;
    - `sfbos-sb79-exemptions` → `[{ apn: '3512012', tbl: 'permanent' }, { apn: '3512015', tbl: 'temporary' }]`;
    - on path 2, a raw file whose sha256 differs from the CSV header throws `exemption transcription is stale`.
  - `fetch.test.ts`, with a stub `Http`: `fetchSfbosExemptions` locks one file per attachment, with the Task 1 licence string.
- [ ] **Step 2:** Run `npx vitest --run --project pipeline pipeline/test/normalise.test.ts pipeline/test/fetch.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Write the sources and their normalise cases.
  - Extend `make-fixture.ts` (lot 18, lot 17's district, streets, historic, exemptions, and MTC on branch A), then run `npx tsx pipeline/test/fixtures/mini/make-fixture.ts`.
  - Update the README: add lot 18 and lot 17's district, plus "Streets", "Historic status" and "Exemptions" tables. Update the derived row counts: `src_parcels` 24, `src_parcel_attrs` 24, `src_landuse` 19, `src_roll` 37, `src_height_bulk` 8, `src_streets` 5, `src_historic` 15, `src_sb79_exempt` 2.
- [ ] **Step 4:** Run the Step 2 tests again. Expected: PASS.
- [ ] **Step 5:** Run `npm run pipeline -- fixture --update-golden`. Expected: exit 0, V1–V30 OK.
  - The diff should show: lot 18 everywhere; lot 17's envelope from the 30 ft district; the new sources in `manifest.json`; possibly the calibration golden.
  - Anything else: stop and report.
- [ ] **Step 6:** Update the lot-count tests. Run `npm run test:pipeline`, then `npx playwright test e2e/scenario-data.spec.ts e2e/fzp.spec.ts e2e/fzp-sim.spec.ts`. Expected: PASS.
- [ ] **Step 7: Commit.** Run `git add pipeline e2e`, then `git commit -m "feat(pipeline): lock street centerlines, historic status and SB 79 exemption tables; mini lot 18" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.

  The live lock lacks these entries until Task 11, so a live `build` fails until then with `lock has no entry for …`. That is expected.

### Task 7: Policy step: use district, historic, exemptions, FZP cap, `policy.bin`, V31

**Files:**
- Create: `pipeline/sql/82_policy.sql`, `pipeline/steps/policy-sql.ts`, `pipeline/steps/policy.ts`, `pipeline/steps/check-policy.ts`
- Modify:
  - `pipeline/lib/density-caps.ts` (add `fzpYieldCapOf`) and `pipeline/steps/scenario.ts:750-768` (use it);
  - `pipeline/lib/scenario-files.ts`, `pipeline/steps/build.ts`, `pipeline/steps/check.ts`, `pipeline/steps/fixture.ts` (`GOLDEN_FILES`, the dump), `pipeline/test/golden.test.ts`;
  - `pipeline/config.ts` (profile fields), `pipeline/lib/quality-rules/sd.ts`, `docs/dev/pipeline.md`.
- Test: `pipeline/test/policy-step.test.ts`, `pipeline/test/density-caps.test.ts`, `pipeline/test/invariants.test.ts`

**Interfaces:**
- Consumes: Task 3's codec; `readParcelsBin`; `readParcelRecords`; `sc_zoning`, `sc_district`, `src_historic`, `src_sb79_exempt`, `src_parcel_attrs`.
- Produces:
  - `export function fzpYieldCapOf(zoning: string | null, lotAreaM2: number, r4: boolean, localProgram: boolean, capDay: Day): number | null`, which is `localProgram ? null : densityCap(zoning, lotAreaM2, r4, capDay)`. `scenario.ts` must use it, and `parcels.decoded.json` must come out unchanged.
  - `export const POLICY_BIN = 'scenarios/fzp/policy.bin'` and `FRONTAGE_BIN = 'scenarios/fzp/frontage.bin'`, in `scenario-files.ts`.
  - `export async function runPolicySql(db: Duck, stops: { id: string; tier: 1 | 2; lng: number; lat: number }[]): Promise<void>`. This task calls it with `[]`. It writes `pol_stops` and runs `82_policy.sql`, which writes:
    - `pol_historic(id, code)`: one row per parcel, `''` when it has no row. The code is the most protective of the parcel's rows, ranked A\* > A > B > C. Rows join by apn → active `src_parcel_attrs.blklot` → `mapblklot` = `parcels.id`.
    - `pol_exempt(id, permanent BOOLEAN, temporary BOOLEAN)`, with the same apn join. Apns that match no active parcel are tallied as `sd.exempt.unmatched`.
    - `pol_tod(id, tier, dist_m)`: empty until Task 8.
    - It also tallies `sd.historic.no-row`.
  - `export const POLICY_DUMP = 'scenarios/fzp/policy.decoded.json'`, `formatPolicyDump(p: PolicyParcels): string` and `readPolicyBin(file: string, parcels: ScenarioParcels): PolicyParcels`.
  - `export async function writePolicy(a: { db: Duck; outDir: string; datasetVersion: string; records: { rec: ParcelRecord; cellId: string }[]; capDay: Day; buildCounts: Record<string, number> }): Promise<{ counts: Record<string, number>; warnings: string[] }>`.
    - This task writes `useDistrict`, `historic`, `historicProtected`, `exemptPermanent`, `exemptTemporary` and `fzpYieldCap`.
    - It sets `sb79Status` to `outside` and `s207Status` to `outside` everywhere, with stories 0, caps `NULL_CAP` and yields 0.
    - The current columns are a copy of FZP (`envelopeStories`, `fzpYieldCap`, `yield`, `hostable`), with `currentFromS207 = 0`.
    - Counts:
      - `policy.bytes.payload`;
      - `policy.bytes.file`, non-fixture only;
      - `policy.historic.<A|A*|B|C|none>`;
      - `policy.historic.protected`;
      - `policy.exempt.permanent`, `policy.exempt.temporary`;
      - `policy.use_district_mismatch`: decoded code ≠ `coalesce(sc_zoning.zoning_code, '')`, must be 0.
  - `export function checkPolicy(outDir: string, profile: InvariantProfile, counts: Record<string, number>, p: ScenarioParcels | null, m: Manifest | null, stableDetail: boolean): InvariantResult[]` returns V31 for now.
  - `InvariantProfile` gains:
    - `historicJoinMin`: live 0.95, fixture 17/18;
    - `exemptJoinMin`: matched apns over table rows; live 0.95, fixture 1;
    - `policyMaxBytes` and `frontageMaxBytes`: 1.0e6 each.

    `check-policy.ts` defines `POLICY_WARN_BYTES = FRONTAGE_WARN_BYTES = 0.75e6` (tier 4, see the Budget decision).
  - T14 rules:
    - `sd.historic.no-row`: source `datasf-historic-status`, field `historic`, kind `missing`, action `default`, tier 4, valueTier 4, denominator `parcels`, `MISSING_SHARES`.
    - `sd.exempt.unmatched`: source `sfbos-sb79-exemptions`, field `apn`, kind `missing`, action `drop`, tier 4, valueTier null, denominator `exemption table rows`, `MISSING_SHARES`.
- Build placement, in `build.ts`:
  - after `writeCalibration`, move `writeNeighborhoods` and `writeTransit` before `writeQualityReport`;
  - call `writePolicy`, sharing a hoisted `records` with `writeScenario`, and merge its counts and warnings;
  - `buildManifest({ …, policy: existsSync(join(outDir, POLICY_BIN)) })`;
  - `checkDataset` calls `checkPolicy` after V30.

- [ ] **Step 1: Failing tests.**
  - `density-caps.test.ts`: `fzpYieldCapOf('RH-1', 300, false, true, day)` is null. With `localProgram` false it equals `densityCap('RH-1', 300, false, day)`.
  - `policy-step.test.ts`, on the mini database (the helpers.ts pattern):
    - lot 18 `historic` is `''`;
    - lot 2 is `'A'` (the most protective condo row) with `historicProtected` 1;
    - lot 13 is `'A*'` and protected;
    - lot 3 is `'B'` and not protected;
    - lot 12 has `exemptPermanent` 1 and lot 15 has `exemptTemporary` 1;
    - lot 18's use district is `'RM-1'`;
    - `policy.use_district_mismatch` is 0;
    - `currentYield` equals `parcels.yield` on every row;
    - `fzpYieldCap` is `NULL_CAP` on Local Program rows.
  - `invariants.test.ts`: V31 is OK on a fixture out dir. Pointing `policy.bin` at a `parcels.bin` with one id changed fails with `does not decode`.
- [ ] **Step 2:** Run `npx vitest --run --project pipeline pipeline/test/density-caps.test.ts pipeline/test/policy-step.test.ts pipeline/test/invariants.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** V31 fails when any of these holds:
  - the file is missing, or present but not named in the manifest (or named but absent);
  - it fails to inflate or decode against the decoded `parcels.bin`;
  - `datasetVersion` ≠ the manifest's;
  - re-encoding is not byte-identical;
  - `fillLevels` ≠ `FILL_LEVELS`;
  - `policy.use_district_mismatch` ≠ 0;
  - the share of rows with a historic code is below `historicJoinMin`;
  - the matched share of exemption rows is below `exemptJoinMin`;
  - the file exceeds `policyMaxBytes`.

  V31 warns above `POLICY_WARN_BYTES`. `stableDetail` omits byte counts. Register the two rules, then run `npm run pipeline -- quality-doc`.
- [ ] **Step 4: Docs.** In `docs/dev/pipeline.md`, add "## Policy parcels" after "## Scenario parcels", covering:
  - the new sources (ids, licences, fields, and Task 1's fetch path for the exemption tables);
  - that the use district comes from `datasf-parcel-attrs`;
  - the Budget decision with measured numbers;
  - the `policy.bin` columns;
  - the historic join and ruling 4 ("historic protection = A or A\*; `historicProtected` is that flag; plan 2 reads it");
  - the exemption join;
  - V31.

  Append V31 to the invariant summary, and add `policy.bin` to "Where things land".
- [ ] **Step 5:** Run the Step 2 tests again (PASS). Then run `npm run pipeline -- fixture --update-golden`: V1–V31 OK, a new `policy.decoded.json`, `parcels.decoded.json` unchanged. Then run `npm run test:pipeline` (PASS).
- [ ] **Step 6: Commit.** Run `git add pipeline docs/dev/pipeline.md e2e/fixtures/data/fixture-0`, then `git commit -m "feat(pipeline): policy.bin with use district, historic status, exemptions and FZP cap (V31)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.

### Task 8: SB 79 as written (V32)

**Files:**
- Create: `pipeline/lib/sb79.ts`
- Modify: `pipeline/sql/82_policy.sql` (`pol_tod`; on branch A, also `pol_mtc_match`), `pipeline/steps/policy-sql.ts`, `pipeline/steps/policy.ts`, `pipeline/steps/check-policy.ts`, `pipeline/config.ts` (`SQL_VARS.tod_half_m = 804.672`, `SQL_VARS.stop_match_m = 100`, profile fields), `pipeline/lib/quality-rules/sd.ts`, `docs/dev/pipeline.md`
- Test: `pipeline/test/sb79.test.ts`, `pipeline/test/policy-step.test.ts`, `pipeline/test/invariants.test.ts`

**Interfaces:**
- Consumes: Task 1's config; `TransitNetwork` and `decodeTransit` (`<outDir>/transit.json`); `storiesFromFt`; `fillStories`; `FILL_LEVELS`; `scenarioYield`; `capScenarioYield`; `scenarioRecordOf`; `src_mtc_stops` (branch A).
- Produces, in `pipeline/lib/sb79.ts` (all pure):
  - `export function stopTiers(net: TransitNetwork): Map<number, Sb79Tier>`, keyed by stop index:
    - a stop on a `heavy-rail` pattern → 1;
    - a stop on a `commuter-rail` pattern → its station's daily trains (Σ `tpd` over commuter-rail pattern stops sharing the stop's `stationId`, or the stop's own id when null): ≥ `VHF_TPD` → 1, else ≥ `HF_TPD` → 2;
    - a stop on a `LIGHT_RAIL_MODES` pattern → 2;
    - a stop in `BRT_STOP_IDS` → 2;
    - otherwise absent. The lowest tier wins.
  - `export function bandOf(distanceM: number): TodBand | 0`. Bands are inclusive at their upper edge.
  - `export function zoneClassOf(code: string | null): { zoneClass: ZoneClass | 'unlisted'; principallyResidential: boolean }`. It splits on `|` and takes the most permissive component; `null` → `unlisted`.
  - `export function bestStandard(minDist: Partial<Record<Sb79Tier, number>>): { tier: Sb79Tier; band: TodBand } | null`. It picks the highest `heightFt`; a tie goes to tier 1.
  - `export function unitsFor(duPerAcre: number, lotAreaM2: number, share = 1): number` is `UNITS_ROUNDING` applied to `share × duPerAcre × lotAreaM2 / 4046.8564224`.
  - `export function sb79Row(a: { best: { tier: Sb79Tier; band: TodBand } | null; eligible: boolean; zone: ZoneClass | 'unlisted'; rentControlLikely: boolean; lotAreaM2: number; existingUnits: number; grossAt: (stories: number) => number }): { status: Sb79Status; stories: number; cap: number | null; yield: number[]; uncappedTop: number }`. Its statuses, in precedence order:
    - `outside` (best is null);
    - `not-eligible`;
    - `zone` (`excluded` or `unlisted`);
    - `rent-control`;
    - otherwise `s = storiesFromFt(STANDARDS[tier][band].heightFt)` and `cap = unitsFor(STANDARDS[tier][band].duPerAcre, lotAreaM2)`. For each fill level k, `yield[k] = capScenarioYield(grossAt(fillStories(FILL_LEVELS[k], s)), cap, existingUnits)`, then zeroed when it is below `MIN_UNITS`. A top yield below `MIN_UNITS` gives `min-units`; otherwise the status is `applies`.

    Every status other than `applies` gives stories 0, cap null and all-zero yields.
  - SQL `pol_tod`: `SELECT p.id, s.tier, min(ST_Distance(p.geom_orig, s.geom)) dist_m FROM parcels p JOIN pol_stops s ON ST_DWithin(p.geom_orig, s.geom, getvariable('tod_half_m')) GROUP BY ALL ORDER BY ALL`. `pol_stops` is filled as follows:
    - **Branch B:** from `stopTiers`.
    - **Branch A:** from `src_mtc_stops` (the tier source). `stopTiers` stops go to `pol_gtfs_stops`, and `pol_mtc_match` counts how many stops of each source have a stop of the same tier in the other within `stop_match_m`.
  - `writePolicy` now sets `todTier`, `todBand`, `sb79Status`, `sb79Stories`, `sb79Cap`, `sb79Yield` and `hostableSb79 = status === 'applies'`. The SB 79 layer ignores the exemption flags (ruling 3). Counts:
    - `policy.sb79.<status>`;
    - `policy.sb79.stops.tier1`, `.tier2`;
    - `policy.sb79.cap_binds`: `applies` rows with `uncappedTop > yield[F-1]`;
    - `policy.sb79.net_capacity`;
    - `policy.sb79.tod_share`: rows with `todBand > 0`, over the count, ×1e4;
    - on branch A, `policy.sb79.tier_agreement`: matched stops over the union, ×1e4.
  - Profile fields:
    - `sb79MinT1Stops`: live 8; fixture 3 on branch B (FX-1, 70011, 70012), 2 on branch A (the MTC fixture stops);
    - `sb79MinT2Stops`: live 50; fixture 2 on branch B (m4, m5), 1 on branch A;
    - `todShareWarn: [number, number] | null`: live [0.6, 0.95], warn only, around Planning's "> 75%" (Ord. 082-26 §2(e)); fixture null;
    - `tierAgreementMin: number | null`: branch A live 0.9, fixture 1; branch B null.
  - T14 rule `sd.sb79.zone-unlisted`: source `datasf-parcel-attrs`, field `zoning_code`, kind `shape`, action `none`, tier 4, denominator `parcels within ½ mile of a TOD stop`, `SHARES`.

- [ ] **Step 1: Failing unit tests** `pipeline/test/sb79.test.ts`:

```ts
it('sums commuter-rail trains over the station, not the platform', () => {
  // two platforms of one station at 40 tpd each → 80 ≥ 72 → tier 1; one platform alone at 60 → tier 2; 40 → none
  expect(tiers.get(platformA)).toBe(1);
  expect(tiers.get(lonely60)).toBe(2);
  expect(tiers.has(lonely40)).toBe(false);
});
it('heavy rail is tier 1, light rail and streetcar tier 2, plain bus none, a listed BRT stop tier 2', () => {
  /* one expect per mode */
});
it('bands are inclusive at 200 ft, ¼ mi and ½ mi', () => {
  expect([bandOf(60.96), bandOf(60.97), bandOf(402.336), bandOf(804.672), bandOf(804.673)]).toEqual([1, 2, 2, 3, 0]);
});
it('takes the tallest standard across tiers; a tie goes to tier 1', () => {
  expect(bestStandard({ 1: 500, 2: 50 })).toEqual({ tier: 2, band: 1 });
  expect(bestStandard({ 1: 50, 2: 50 })).toEqual({ tier: 1, band: 1 });
  expect(bestStandard({ 1: 700, 2: 300 })).toEqual({ tier: 1, band: 3 });
});
it('classifies split and unlisted zoning codes', () => {
  expect(zoneClassOf('RH-1|PDR-1-G').zoneClass).toBe('residential');
  expect(zoneClassOf('PDR-1-G').zoneClass).toBe('excluded');
  expect(zoneClassOf('XYZ').zoneClass).toBe('unlisted');
});
it('sb79Row caps at the statute density and applies the 5-unit minimum per fill level', () => {
  const base = { best: { tier: 1, band: 2 }, eligible: true, zone: 'residential', rentControlLikely: false, existingUnits: 0 } as const;
  // 4046.8564224 m² = 1 acre → tier 1 quarter cap 120; grossAt = 20 per story
  expect(sb79Row({ ...base, lotAreaM2: 4046.8564224, grossAt: (s) => 20 * s }))
    .toMatchObject({ status: 'applies', stories: 7, cap: 120, yield: [40, 80, 100, 120, 120], uncappedTop: 140 });
  expect(sb79Row({ ...base, lotAreaM2: 100, grossAt: (s) => s }).status).toBe('min-units'); // cap ≤ 3
  expect(sb79Row({ ...base, rentControlLikely: true, lotAreaM2: 4046.8564224, grossAt: (s) => s }).status).toBe('rent-control');
  expect(sb79Row({ ...base, eligible: false, rentControlLikely: true, lotAreaM2: 1, grossAt: (s) => s }).status).toBe('not-eligible');
});
```

  `fillStories(f, 7)` over `FILL_LEVELS` gives [2, 4, 5, 6, 7]. 100 m² at 120 du/ac is 2.97 units: ceil gives 3, floor gives 2, both below 5.

- [ ] **Step 2: Failing fixture assertions** in `policy-step.test.ts`. These are the mini known answers, using the README stop positions:
  - lot 18: adjacent band, tier 1, 9 stories, `applies`, `sb79Cap = unitsFor(160, lotAreaM2)`;
  - lot 1: quarter band (≈ 89 m to Caltrain), tier 1, 7 stories;
  - lots 15 and 17: half band (≈ 721 m and ≈ 718 m to FX-1), tier 1, 6 stories. Lot 15 is `applies` even though it is exempt (ruling 3), unless the generator puts it at `min-units`;
  - lots 16 and 7: `not-eligible`;
  - lot 12: `zone` (P);
  - stop counts as in the profile.

  If the generator puts lot 1 at `min-units`, record it in the README; do not change the rules.
- [ ] **Step 3:** Run `npx vitest --run --project pipeline pipeline/test/sb79.test.ts pipeline/test/policy-step.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement**, including V32. V32 fails on:
  - an `applies` row with `sb79Stories ≠ storiesFromFt(STANDARDS[todTier][todBand].heightFt)` or `sb79Cap ≠ unitsFor(STANDARDS[todTier][todBand].duPerAcre, lotAreaM2)`;
  - an `applies` yield above `sb79Cap`, or in 1..4;
  - a non-`applies` row with nonzero stories or yields, or a cap ≠ `NULL_CAP`;
  - `hostableSb79 ≠ (status === 'applies')`;
  - `todBand = 0` with status ≠ `outside`, or the reverse;
  - stop counts below the profile minimums;
  - a `profile.transitHeavyRailStations` name with no tier-1 stop;
  - on branch A, `tier_agreement` below `tierAgreementMin`.

  V32 warns when `tod_share` falls outside `todShareWarn`. Register the rule, then run `quality-doc`.
- [ ] **Step 5: Docs.** Add "### SB 79 as written" covering:
  - the tier source (branch A or B) and the cross-check;
  - the bands; distances measured from `geom_orig` to stop points (a stand-in for "pedestrian access points", tier 4);
  - the statuses and the statute density cap with its rounding (ruling 2; Density Bonus Law not modelled);
  - that City exemptions are ignored (ruling 3);
  - the counts, V32 and `UNSOURCED`.

  Extend the invariant summary to V32.
- [ ] **Step 6:** Run the Step 3 tests again (PASS), then `npm run pipeline -- fixture --update-golden` (V1–V32 OK; review the diff against Step 2), then `npm run test:pipeline` (PASS).
- [ ] **Step 7: Commit.** Run `git add pipeline docs/dev/pipeline.md e2e/fixtures/data/fixture-0`, then `git commit -m "feat(pipeline): SB 79 as-written stock layer, capped at statute density (V32)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.

### Task 9: Current law = FZP + §207.11 (V33)

**Files:**
- Create: `pipeline/lib/current-law.ts`
- Modify: `pipeline/steps/policy.ts`, `pipeline/steps/check-policy.ts`, `docs/dev/pipeline.md`
- Test: `pipeline/test/current-law.test.ts`, `pipeline/test/policy-step.test.ts`, `pipeline/test/invariants.test.ts`

**Interfaces:**
- Consumes: `mostPermissive`; `S207`, `STANDARDS`, `unitsFor`, `zoneClassOf`; the Task 7 and Task 8 columns; `sc_district.base_ft` and `.r4`.
- Produces:
  - `export function s207Row(a: { best: { tier: Sb79Tier; band: TodBand } | null; eligible: boolean; principallyResidential: boolean; r4: boolean; historic: string; exempt: boolean; fzpStories: number; fzpBaseFt: number | null; fzpCap: number | null; lotAreaM2: number; existingUnits: number; grossAt: (stories: number) => number }): { status: S207Status; stories: number; cap: number | null; yield: number[]; hostable: boolean }`. Statuses, in precedence order:
    - `outside`;
    - `not-eligible`;
    - `exempt`: either table (§207.11(b)(6));
    - `not-residential`: (b)(2);
    - `no-limit`: (b)(3) fails, meaning `fzpCap === null` and the height is ≥ 40 ft;
    - `r4`: (b)(4);
    - `historic`: `historic` ∈ `S207.historicCodes`, (b)(7);
    - `meets-minimum`: (b)(8), where `fzpCap !== null` and `fzpCap ≥ unitsFor(S207.minDensityDuPerAcre, lotAreaM2)`;
    - `applies`.

    For `applies`: `stories = fzpBaseFt !== null && fzpBaseFt < 40 ? max(fzpStories, storiesFromFt(40)) : fzpStories` and `cap = max(fzpCap ?? 0, unitsFor(STANDARDS[tier][band].duPerAcre, lotAreaM2, S207.densityShare))`. Yields are `capScenarioYield(grossAt(fillStories(f, stories)), cap, existingUnits)`. `hostable` is `eligible && stories ≥ 1 && uncapped full-fill gross > 0`, the same rule as `parcels.bin`. Every status other than `applies` returns the FZP row.

    These details follow Task 1 Step 4(a). If Task 1 pinned something different, use Task 1's version and update this block and the tests.
  - `export function currentLawRow(fzp: { stories: number; cap: number | null; yield: number[]; hostable: boolean }, s207: ReturnType<typeof s207Row>): { stories: number; cap: number | null; yield: number[]; hostable: boolean; fromS207: boolean }`. It takes §207.11 when `s207.status === 'applies'` and `mostPermissive(fzp, s207) === 'b'`; otherwise FZP.
  - `writePolicy` sets `s207Status`, the current columns and `currentFromS207`. The header gets `currentLawRule: 'fzp+s207.11'` and a `currentLaw` provenance naming Ord. 082-26 §5 and the Board File tables. New counts: `policy.s207.<status>`, `policy.current.from_s207`, `policy.current.net_capacity`.

- [ ] **Step 1: Failing tests.**
  - `current-law.test.ts`, with `s207Row` cases for:
    - each status, using a minimal input that fails exactly one condition;
    - an RH lot at 30 ft with cap 2 on 1 acre in tier 1, half band → `applies`, stories 4, cap `unitsFor(100, 4046.86, 0.5)` = 50;
    - an exempt lot inside the TOD zone → `exempt`, returning the FZP row;
    - `currentLawRow`: §207.11 wins only with a larger hostable top.
  - `policy-step.test.ts`, mini fixture:
    - lot 17 (RH-2, 30 ft district, tier 1 half band, not exempt) is `applies` with `currentStories` 4 and `currentFromS207` 1, unless Task 1's (b)(8) reading makes it `meets-minimum` (then assert that, and record it in the README);
    - lot 15 is `exempt` and its current row equals FZP;
    - lot 12 is `exempt`;
    - lots 1–4 (`40//65-R-4`) are `r4`;
    - lot 13 is `no-limit`: C-3-O has no numeric density and is taller than 40 ft, and `no-limit` comes before `historic`;
    - lot 18 is `meets-minimum`: RM-1's cap of 1 unit per 800 sf is about 54 du/ac, above the 30 du/ac minimum. Use another status only if Task 1 pinned (b)(8) differently, and record it in the README.
  - `invariants.test.ts`: V33 passes on the fixture and fails when one row's `currentCap` is altered.
- [ ] **Step 2:** Run `npx vitest --run --project pipeline pipeline/test/current-law.test.ts pipeline/test/policy-step.test.ts pipeline/test/invariants.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, including V33. V33 recomputes, for every row, `s207Status`, the §207.11 stories and the §207.11 cap. Its inputs are the decoded `parcels.bin`, the policy columns, `zoneClassOf(useDistrict)` and the base height, which the step passes as count `policy.s207.base_ft_mismatch` (must be 0). It fails on:
  - any status, stories or cap difference;
  - `currentFromS207 = 1` on a row that is not `applies`;
  - current columns that do not equal the FZP row when `currentFromS207 = 0`;
  - with `currentFromS207 = 1`, a current top yield not greater than the FZP top, or `hostableCurrent` = 0.

  Yields are not regenerated in `check`. The step compares its own two computations and records the result as `policy.current.yield_mismatch`, which V33 requires to be 0.
- [ ] **Step 4: Docs.** Add "### Current law (FZP + §207.11)" covering:
  - ruling 1;
  - each (b) condition with its data proxy and tier (the historic A\* proxy for Article 10/11 categories; (b)(5) not modelled);
  - the cap and height rules;
  - the exemption tables;
  - the tie rule;
  - V33.

  Extend the invariant summary to V33.
- [ ] **Step 5:** Run the Step 2 tests again (PASS), then `npm run pipeline -- fixture --update-golden` (V1–V33 OK), then `npm run test:pipeline` (PASS).
- [ ] **Step 6: Commit.** Run `git add pipeline docs/dev/pipeline.md e2e/fixtures/data/fixture-0`, then `git commit -m "feat(pipeline): current law per lot, FZP plus Planning Code §207.11 with City exemptions (V33)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.

### Task 10: Street frontage (`frontage.bin`, V34)

**Files:**
- Create: `pipeline/sql/83_frontage.sql`, `pipeline/steps/frontage.ts`
- Modify: `pipeline/config.ts` (`SQL_VARS`, `frontageMin`), `pipeline/steps/build.ts`, `pipeline/steps/check-policy.ts`, `pipeline/steps/fixture.ts`, `pipeline/test/golden.test.ts`, `pipeline/lib/quality-rules/sd.ts`, `docs/dev/pipeline.md`
- Test: `pipeline/test/frontage-sql.test.ts`, `pipeline/test/frontage-step.test.ts`, `pipeline/test/invariants.test.ts`

**Interfaces:**
- Consumes: `parcels(id, geom_orig)`, `src_streets`, Task 4's codec, `readParcelsBin`, `readPolicyBin` and `isNeighborhoodCommercial` (for the corridor test).
- Produces:
  - `SQL_VARS`, all tier 4, chosen for SF rights of way and lot widths and pinned by the tests:
    - `front_max_m: 40`. The widest common right of way is 125 ft (≈ 38 m), so half is about 19 m; the rest covers setbacks and plazas.
    - `front_tol_m: 2`.
    - `front_min_m: 5`. A 25 ft lot plus up to 2 × 2 m of side edges passes; a corner touch (≤ 4 m) does not.
    - `occlude_min_m: 0.5`.
    - `adjacent_min_m: 3`.
  - `83_frontage.sql` does this:
    1. **`fr_seg(seg_idx, cnn, name, class, geom)`**: the `src_streets` rows with `classcode IN (2,3,4,5)` and `layer NOT IN ('PAPER','PAPER_FWYS','PAPER_WATER','PRIVATE','PRIVATE_PARKING','PSEUDO','UPROW')`, reprojected to EPSG:7131. `seg_idx` is the row number by `cnn`, minus 1.
    2. **Depth 0**: for each `(lot, seg)` with `ST_DWithin(geom_orig, seg.geom, front_max_m)`:
       - `d = ST_Distance`;
       - `facing = ST_Intersection(ST_Boundary(geom_orig), ST_Buffer(seg.geom, d + front_tol_m, 'endcap=flat'))`;
       - the pair fronts when `ST_Length(facing) ≥ front_min_m`, and the shortest line from the midpoint of `facing`'s longest part to `seg.geom` crosses no other parcel's `geom_orig` by more than `occlude_min_m`.
    3. **Depth 1**: lot B, segment s, where:
       - B has no depth-0 entry on s;
       - B shares at least `adjacent_min_m` of boundary with a lot A that has a depth-0 entry on s;
       - B's shortest line to s crosses A by more than `occlude_min_m`, and crosses no other parcel by more than that.
    4. **`fr_front(id, seg_idx, depth)`**, ordered by id, depth, seg_idx.

    Counts: `frontage.segments`, `.entries.depth0`, `.entries.depth1`, `.no_frontage`, `.corner` (depth-0 entries on two or more names), and `.depth1_orphan` (must be 0).
  - `export const FRONTAGE_DUMP = 'scenarios/fzp/frontage.decoded.json'`, `formatFrontageDump(f: Frontage): string` and `readFrontageBin(file: string, parcels: ScenarioParcels): Frontage`.
  - `export async function writeFrontage(a: { db: Duck; outDir: string; datasetVersion: string; buildCounts: Record<string, number> }): Promise<{ counts: Record<string, number>; warnings: string[] }>`. It fails when there are more than 65,535 segments or a row has more than 255 entries.
  - `InvariantProfile.frontageMin`: live 0.90; fixture 0.8, a known answer (12 of 15 eligible lots front a street; lots 15, 17 and 18 do not).
  - T14 rule `sd.streets.no-frontage`: source `datasf-streets`, field `frontage`, kind `missing`, action `none`, tier 4, valueTier null, denominator `eligible parcels`, `MISSING_SHARES`.
  - Build: `writeFrontage` runs after `writePolicy` and before `writeQualityReport`. `buildManifest` gets `frontage: existsSync(join(outDir, FRONTAGE_BIN))`.

- [ ] **Step 1: Failing synthetic SQL test** `pipeline/test/frontage-sql.test.ts`. Use an empty DuckDB with `parcels(id, geom_orig)` and `src_streets` in EPSG:7131 metres (pre-projected `fr_seg` input if that is simpler), set `SQL_VARS`, and run `83_frontage.sql`. Cases, each asserted as exact `fr_front` rows:
  - corner `C` x[0,20] y[0,30] with streets at y = −8 and x = −8: two depth-0 entries;
  - interior `I` x[20,30] y[0,30]: one;
  - rear `R` x[20,30] y[30,60]: depth 1 on the y = −8 street;
  - through lot `T` x[40,50] y[0,60] with a second street at y = 68: depth 0 on both;
  - boulevard `B`, 30 m from a centerline with no parcel between: depth 0;
  - far `F`, 45 m away: nothing;
  - park `P` x[60,100] y[0,60]: depth 0, and `Q` behind it at y[60,90]: depth 1;
  - a freeway (classcode 1) segment and a `PAPER` segment beside `I`: never matched.
- [ ] **Step 2: Failing step test** `frontage-step.test.ts`, mini fixture:
  - lots 1–9: depth 0 on cnn 1000 only;
  - lot 10: depth 0 on 1000 and 1001 (the split at x = 95);
  - lots 11–13: depth 0 on 1001;
  - lot 13 also: depth 1 on 2000 (behind corner lot 14);
  - lot 14: 1001 and 2000 at depth 0;
  - lot 18: depth 1 on 1001 and nothing else (I-80 is excluded; Fixture Ave ends below it);
  - lots 15–17: none;
  - `frontage.corner` = 1.

  **Commercial corridor (ruling 5):** `frontingRows` on arterial segments, intersected with the rows where `isNeighborhoodCommercial(useDistricts[useDistrict[i]])`, gives exactly lots 3 (NCT) and 4 (NC-1).
- [ ] **Step 3:** Run `npx vitest --run --project pipeline pipeline/test/frontage-sql.test.ts pipeline/test/frontage-step.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement**, including the rule (then `quality-doc`) and V34. V34 fails on:
  - a missing file, or a mismatch between the manifest and the file;
  - a decode failure against `parcels.bin`;
  - a re-encode that is not byte-identical;
  - `frontage.depth1_orphan ≠ 0`;
  - an eligible depth-0 share below `frontageMin`;
  - more than `frontageMaxBytes`.

  It warns above `FRONTAGE_WARN_BYTES`.
- [ ] **Step 5: Docs.** Add "## Street frontage" after "Policy parcels", covering:
  - the source and its classcode meanings and filters;
  - the matching method and why: facing edges by nearest distance plus a tolerance, occlusion for rear lots, adjacency plus occlusion for one lot deep;
  - each `SQL_VARS` value with its tier;
  - corner, through and right-of-way-gap behaviour: a plaza or freeway right of way with no parcel counts as fronting within 40 m;
  - the commercial-corridor composition for plan 3 (ruling 5);
  - that no segment geometry ships, so plan 3 can use the basemap or ask for it;
  - V34.

  Extend the invariant summary to V34, and add `frontage.bin` to "Where things land".
- [ ] **Step 6:** Run the Step 3 tests again (PASS), then `npm run pipeline -- fixture --update-golden` (V1–V34 OK), then `npm run test:pipeline` (PASS).
- [ ] **Step 7: Commit.** Run `git add pipeline docs/dev/pipeline.md e2e/fixtures/data/fixture-0`, then `git commit -m "feat(pipeline): lot-to-street frontage with one-lot-deep matches (V34)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.

### Task 11: Live fetch, build and measurement (no upload)

**Files:**
- Modify: `pipeline/sources.lock.json`, `docs/dev/pipeline.md`; path 2 only, `pipeline/enrichment/sb79-exemptions.csv` (the full transcription).

- [ ] **Step 1:** On path 2, complete the transcription of the full Board File tables into `pipeline/enrichment/sb79-exemptions.csv`, with the original's sha256 in its header. Spot-check 20 random rows against the original, and record the check in the commit body.
- [ ] **Step 2:** Run `npm run pipeline -- fetch --only datasf-streets,datasf-historic-status,sfbos-sb79-exemptions`, adding `,mtc-sb79-stops` on branch A. Expected: one new lock entry per source.
- [ ] **Step 3:** Run `npm run pipeline -- build`, without `--skip-tiles`. Expected: V1–V34 OK.
- [ ] **Step 4: Record**, from `out/<v>/report.json`, adding the dated numbers to `docs/dev/pipeline.md`:
  - `scenario.bytes.file` (≈ 2.1 MB, unchanged), `policy.bytes.file`, `frontage.bytes.file`;
  - `policy.historic.*`, `policy.exempt.*`;
  - `policy.sb79.*`, including `tod_share` against "> 75%", `cap_binds`, `net_capacity` and, on branch A, `tier_agreement`;
  - `policy.s207.*`, `policy.current.*`;
  - `frontage.*`;
  - every new `quality.sd.*` count.
- [ ] **Step 5: Bounds.** If a V31–V34 bound fails or warns on live data, stop and report the measured value. Do not retune silently. In particular, report an exemption match below 95%, or more than 10% of eligible parcels with no frontage.
- [ ] **Step 6:** Run `npm run test:unit`, then `npm run test:pipeline`, then `npm run test:e2e`. Expected: PASS, with `/fzp` (`e2e/fzp.spec.ts`, `e2e/fzp-sim.spec.ts`) unchanged.
- [ ] **Step 7: Commit.** Run `git add pipeline/sources.lock.json pipeline/enrichment docs/dev/pipeline.md`, then `git commit -m "chore(data): lock the policy-layer sources" -m "<measured sizes and counts>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`. Do not push or upload. Report `<v>` and the Step 4 numbers to the controller. Signoff, upload and promotion are the controller's call, with the user's go-ahead.

---

## Self-review

- **Spec coverage (round 2 included).**
  - Area brush by use district: Tasks 6–7 (`useDistrict`).
  - Street brush (class, named street, one lot deep): Tasks 4 and 10.
  - Commercial corridor (ruling 5): `isNeighborhoodCommercial` (Task 3) plus `frontingRows`, pinned in Task 10 Step 2 and documented for plan 3.
  - SB 79 as written, from stops (ruling 6 branches): Tasks 1 and 8.
  - Statute density cap and its binding count (ruling 2): Task 8.
  - Current law = FZP + §207.11 with City exemptions (rulings 1 and 3): Tasks 1, 6, 7 and 9.
  - Yields and `hostable` precomputed for SB 79 and current law: Tasks 8–9. FZP and base already live in `parcels.bin`. `fzpYieldCap` (Task 7) gives plan 2 the "keeps each lot's current-law cap" input.
  - Historic A/A\* (ruling 4): the raw code plus `historicProtected`, in Tasks 3 and 7, documented for plan 2.
  - Lock and attribution: Tasks 5–6.
  - V19: the Budget decision and Task 11.
  - `/fzp`: Global Constraints, Review Focus 1, Tasks 6 and 11.
  - Out of scope here: presets, timers, the UI, publishing, and switching the current law over time (Open question 1, plan 2).
- **Step scan.** Steps whose exact values depend on Task 1 (rounding, the (b)(8) reading, the branch and path, licence strings) name the Task 1 output they take and say what to do if it differs.
- **Type consistency.** These names are used identically in Tasks 3 and 7–10: `PolicyParcels` (`currentFromS207`, `s207Status`, `sb79Cap`, `historicProtected`, `exemptPermanent`, `exemptTemporary`), `S207_STATUSES`, `CURRENT_LAW_RULE` (`'fzp+s207.11'`) and `tierSource` (`TIER_SOURCE`). `unitsFor` is defined in Task 8 and used in Tasks 8 and 9 and in V32/V33. `zoneClassOf` returns `{ zoneClass, principallyResidential }` in both Task 8 and Task 9.
- **Proportion.** Code blocks are signatures and test assertions only.

## Open questions for the partner

1. **When does current law change during the simulation?** Ord. 082-26's Alternative Plan holds §65912.157 off "until its next Housing Element cycle". SF's 7th-cycle Housing Element is due around 2031. The temporary low-resource exemptions end one year after that element is adopted. The timelapse runs to 2066. This plan ships today's current law (FZP + §207.11 with both exemption tables) and SB 79 as written as separate columns, so plan 2 can switch between them at a date. Should current law become "FZP + SB 79 as written, minus the permanent exemptions" from a date such as one year after the 7th-cycle adoption? And which date should we use while that adoption date is unknown?
