# /sim Data Layers (Plan 1 of 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the per-lot data the `/sim` policy levers need in the dataset: the zoning use district, the historic resource status, the FZP yield cap, an SB 79 stock layer (envelope, yields, `hostable`), the current-law combination of FZP and SB 79, and street frontage (segments, class, name, one lot deep). All of it is precomputed by the pipeline, so the worker only has to recompute the lots a user touches.

**Architecture:** Two new column files sit next to `parcels.bin`, in the same row order: `scenarios/fzp/policy.bin` (codec `sfh-policy/1`) and `scenarios/fzp/frontage.bin` (codec `sfh-frontage/1`). Each header carries a hash of the parcel ids, so a file cannot be paired with the wrong `parcels.bin`. Both files are named by new optional manifest keys, `scenarios.fzp.policy` and `scenarios.fzp.frontage`. `parcels.bin` and `sfh-scenario/1` are not touched, so `/fzp` and the dataset now in production keep working unchanged. New pipeline steps (`policy`, `frontage`) run after transit. Two new DataSF sources are added to the lock: street centerlines `3psu-pn9h` and historic resource status `3tsw-4idn`. The SB 79 parameters live in a cited config, `pipeline/sb79-config.ts`. New invariants V31–V34 check the new files.

**Tech Stack:** TypeScript pipeline (tsx), DuckDB spatial (`@duckdb/node-api`), shared codecs in `src/lib/data/` (worker-safe, zod-free), Vitest (`pipeline`, `server` and `client` projects), Playwright, SvelteKit 2 / Svelte 5.

**Spec:** `docs/superpowers/specs/2026-10-28-sim-policy-levers-design.md`, approved 2026-10-28, including "Partner rulings" and "Calls made after the builder check". Read it together with `docs/superpowers/specs/2026-10-16-scenario-data-design.md` §4.4–§4.12 (the T11 file, invariants and T14 rules that this plan extends) and `docs/dev/pipeline.md`.

## Plan sequence

This is plan 1 of 5. The partner asked for the data work to come first. Later plans, each written after the previous one lands:

1. **Data layers (this plan).** Pipeline, lock, invariants, fixture, and client decoders for `policy.bin` and `frontage.bin`.
2. **Policy engine.** `PolicyOp`s for stock layers, the user layer, protections and timers. In-flight versus new-project scope. The current-law twin. The worker lookups seam (`chanceTable`, `typicalMonths`). Background recompute of touched lots.
3. **`/sim` page, zoning layers and brush UI.** Covers `/fzp` → `/sim` routing, layer toggles, and the transit, street, area, freehand and protection brushes.
4. **Permitting timeline UI and presets.**
5. **Publishing `/sim` policies.** The plan schema version, server validation and the read-only shared view.

Nothing in this plan builds UI or simulation behaviour. The decoders here are the contract plans 2 and 3 consume.

## Findings this plan rests on (verified 2026-10-28)

- **Use district per lot is already in the lock.** `datasf-parcel-attrs` (`acdm-wktn`, PDDL-1.0) selects `zoning_code`. `80_scenario.sql` resolves it per parcel into `sc_zoning(id, zoning_code)`, and `scenario.ts` already uses it for density caps. No new source is needed. (`acdm-wktn` is the parcels dataset, not a separate zoning dataset.) Split codes such as `RH-1|RM-1` occur.
- **Street centerlines.** DataSF "Streets – Active and Retired", `3psu-pn9h`. Licence PDDL (Socrata metadata `license.name` = "Open Data Commons Public Domain Dedication and License"), refreshed daily. Fields: `cnn` (segment id), `streetname` ("MISSION ST"), `street`, `st_type`, `classcode` (0 Other (private/paper), 1 Freeway, 2 Major street/Highway, 3 Arterial, 4 Collector, 5 Residential, 6 Freeway ramp), `layer` (STREETS, PAPER, PAPER_WATER, PRIVATE, FREEWAYS, UPROW, PARKS, STREETS_PEDESTRI, …), `active`, and `line` (geometry). Active segments by class on 2026-10-28: 0: 1,145, 1: 110, 2: 202, 3: 1,530, 4: 2,376, 5: 10,906, 6: 109 (16,378 in all, under u16).
- **Historic status.** DataSF "Historic Resource Status by Parcel", `3tsw-4idn`. Licence PDDL, updated daily. Fields: `apn` (the blklot), `ceqacode` (A/B/C) and `ceqacodea10a11` (A, A* = listed in Article 10 or 11 or in an Article 10/11 district, B = unknown status, C = not a historical resource). There are 163,288 distinct apns. The `ceqacodea10a11` counts are A 21,931, A* 2,551, B 119,301 and C 19,505. This is a source, so historic protection is **not** deferred.
- **SB 79 standards** (ABAG/MTC "Senate Bill 79 (2025) Summary", updated 2026-07-01, Table 1, p. 7; Gov. Code §65912.157(a)(3)–(6), (e)). Tier 1 (heavy rail, or very-high-frequency commuter rail with ≥ 72 trains/day): adjacent (≤ 200 ft of a pedestrian access point) 95 ft, 160 du/ac, FAR 4.5; ≤ ¼ mi 75 ft, 120 du/ac, 3.5; ¼–½ mi 65 ft, 100 du/ac, 3.0. Tier 2 (light rail incl. streetcar/trolley/tramway, high-frequency commuter rail with ≥ 48/day, BRT): 85 / 140 / 4.0; 65 / 100 / 3.0; 55 / 80 / 2.5. The ½-mile band applies in cities of ≥ 35,000 residents. Distance runs from the nearest edge of the parcel to a pedestrian access point (§65912.157(b)). Site conditions: zoned residential, mixed-use or commercial; ≥ 5 units; not a site with > 2 rent-controlled units occupied by tenants in the last 7 years (§65912.157(h)). Effective 2026-07-01.
- **San Francisco has adopted an SB 79 Alternative Plan.** Ordinance No. 082-26 (File 260132) was finally passed 2026-05-05, approved by the Mayor 2026-05-08 and is effective 31 days after enactment. It permanently exempts sites in industrial employment hubs (zones M, SALI, PDR, WMUO, P) and sites more than a 1-mile walk from a stop (§3). It temporarily exempts low-resource parcels until one year after the 7th-cycle Housing Element (§4). It adds Planning Code §207.11: within ½ mi of a TOD stop, in a district that principally permits residential, outside R-4, not an Article 10/11 historic building, and where the permitted density is below the SB 79 minimum, density rises to 50% of the SB 79 density and a height limit under 40 ft becomes 40 ft (§5). It adopts the Alternative Plan, which "prevents the state-mandated zoning provisions of SB 79 … from taking effect in the City" until the next Housing Element cycle (§6). The parcel tables are in Board File 260132, not on DataSF. **This conflicts with the spec's "current law = FZP + SB 79"; see Open question 1.**
- **Size budget.** The production `parcels.bin` for dataset `2026-10-19-bf89390d` is 2,109,264 B (155,020 parcels, payload 8,741,160 B). Deflating each column on its own: `yield` 147 KB, `baseYield` 113 KB, `envelopeStories` 12 KB, `baseCap` 20 KB, `district` 13 KB, `flags` 25 KB. V19 warns at 3.0 MB and fails at 3.5 MB.

## Budget decision: separate files, not new `parcels.bin` columns

The policy columns would deflate to about 0.3–0.5 MB: SB 79 and current-law yields at about 150 KB each, stories, caps, codes and flags. They would fit under V19's warn line on their own. Frontage (about 200k–400k lot–segment entries) adds an estimated 0.3–0.7 MB more, which would put `parcels.bin` at or over the 3.0 MB warning. Separate files win for four reasons:

1. **Deployed code meets the promoted dataset.** Code ships on every merge to `main`, while `PUBLIC_DATASET_VERSION` moves later (`docs/dev/deploy.md`). `decodeScenarioPayload` fails on any missing column, so a `sfh-scenario` column change would break `/fzp` in production until the new dataset is promoted. Optional manifest keys degrade cleanly.
2. **First paint.** `/fzp` must not download lever data it never uses.
3. **Budget headroom.** It stays with `parcels.bin`, whose 3.5 MB V19 limit and 3.0 MB warning are unchanged.
4. **`sfh-scenario/1` is declared fixed.** The header comment in `scenario-codec.ts` says "step 0 and fixed".

The new files get their own budgets (`policyMaxBytes`, `frontageMaxBytes`, 1.0 MB each, warning at 0.75 MB). Task 11 measures them on a live build.

## Global Constraints

- Same stack and conventions as the repo: Svelte 5 runes, Tailwind 4, colocated Vitest, Playwright e2e, WCAG 2.2 AA, `expect.requireAssertions` (every test calls `expect`). 2-space indent, single quotes, no trailing commas, 100 columns.
- "The simulation stays client-side in the worker. It is deterministic in `(dataset, levers, seed)`." The new files are byte-deterministic payloads. The golden compares their decoded dumps, as it does for `parcels.bin`.
- "New static data (street-frontage matching, SB 79 inputs) goes through the pipeline into an immutable dataset version, with its sources in the lock and attribution. The scenario file size budget (V19, 3.5 MB) applies."
- "CSP changes are interface changes (`kit.csp`)." This plan changes no CSP: the new files are same-origin under `/data/`.
- `parcels.bin`, `sfh-scenario/1` and `src/lib/data/scenario-codec.ts` are **not modified**. `/fzp` must behave identically on the current production dataset and on the new one.
- `scenarios.fzp.policy` and `scenarios.fzp.frontage` are **optional** manifest keys. Client code must parse a manifest without them, as `2026-10-19-bf89390d` has none.
- Evidence hierarchy: "per-record data, then official aggregates, then inferences, then literature, then invented values." Every numeric parameter carries a comment (or a `Cite`) naming its tier (0 per-record … 4 invented) and source. A parameter that cannot be sourced is listed in `UNSOURCED` in `pipeline/sb79-config.ts` and in `docs/dev/pipeline.md`. It is never silently invented.
- "SB 79 lots are form-based (no cap)". The SB 79 layer's yields are uncapped (spec call; see Open question 2).
- Stock-layer blend: "each lot gets the most permissive allowance among them". For a pair of layers this means the layer with the larger full-fill yield (`mostPermissive`, Task 2). A tie keeps the first layer (FZP). A project uses one regime, so stories, cap and yields always come from the same layer.
- Geometry for TOD distance and frontage is `parcels.geom_orig` (the DataSF outline, PDDL), not the OSM-clipped `geom`. `DERIVED_LICENSE` in `pipeline/steps/build.ts` stays unchanged.
- Every rule that defaults, replaces or drops a value, and every observation count, is a registered T14 rule in `pipeline/lib/quality-rules/sd.ts`. After adding rules, regenerate the Data quality section with `npm run pipeline -- quality-doc`.
- Never compound `cd … && cmd`: run `cd` as its own command. Work only in this worktree (`.claude/worktrees/sim-policy-levers`).
- Do not push and do not upload. `npm run signoff` runs once, after the last task of this plan, and only when the controller asks for it. Uploading or promoting a dataset version needs the user's go-ahead.
- Dated specs and plans under `docs/superpowers/` are historical: document changes in `docs/dev/pipeline.md`.
- Commits use Conventional Commits and end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pass it as a second `-m`.

## Review Focus

1. **Code deployed before the dataset is promoted.** The new client code must parse the `2026-10-19-bf89390d` manifest (no `policy`/`frontage` keys), and `/fzp` must not touch the new decoders. Task 5 parses `manifest.golden.json` (which has no new keys) and a copy with them. Task 11 runs `e2e/fzp.spec.ts` and `e2e/fzp-sim.spec.ts` on the regenerated fixture.
2. **A policy or frontage file paired with the wrong `parcels.bin`.** This can happen with a stale cache, rows in another order, or another dataset. The expected behaviour is a decode error, never misaligned rows. Tasks 3 and 4 test that a one-id change, a reordered id list and a count mismatch all throw.
3. **Commuter rail counted per platform.** A Caltrain station has one platform per direction, and each platform alone is under 72 trains/day, so tier assignment must sum trips over the station (`stationId`). Lots in reach of stops of different tiers take the highest height. A distance exactly at 200 ft, ¼ mi or ½ mi falls in the nearer band. Task 8's `stopTiers` and `bandOf` tests pin all three. The mini fixture's Caltrain station (80/day, 40 per platform) pins the first one end to end.
4. **Rear, through, corner and set-back lots.** A rear lot behind a fronting lot is one lot deep, not fronting. A through lot fronts both streets. A corner lot fronts both streets. A lot across a 30 m half-width boulevard still fronts it. A lot behind a park parcel is one deep behind the park. Freeways and paper streets are never fronted. Task 10's `frontage-sql.test.ts` builds each case from synthetic geometry.
5. **Zoning codes the SB 79 table does not list, and split codes.** A split code takes its most permissive component (as `densityCapRule` does). An unlisted code is excluded and counted under `sd.sb79.zone-unlisted`, never silently treated as residential. Task 8's `zoneClassOf` tests pin `RH-1|PDR-1-G` → residential, `PDR-1-G` → excluded, `XYZ` → unlisted.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `pipeline/sb79-config.ts` (new) | SB 79 statute parameters, stop-tier rules, zone classes, SF ordinance facts, current-law rule, each with a `Cite` and tier; `UNSOURCED` list |
| `src/lib/data/column-file.ts` (new) | Shared column-file prelude/header/column machinery, raw inflate, `idsHash` |
| `src/lib/data/stock-layers.ts` (new) | `mostPermissive` (shared by the pipeline now and plan 2's layer blend later) |
| `src/lib/data/policy-codec.ts` (new) | `sfh-policy/1` encode/decode/read |
| `src/lib/data/frontage-codec.ts` (new) | `sfh-frontage/1` encode/decode/read, `frontingRows` |
| `src/lib/data/fixtures/policy-tiny.ts`, `frontage-tiny.ts` (new) | Codec test fixtures over `scenario-tiny.ts`'s rows |
| `src/lib/data/manifest.ts` | Optional `scenarios.fzp.policy` / `.frontage` |
| `pipeline/steps/manifest.ts`, `upload.ts`, `verify.ts` | Emit, existence-check and HEAD-check the new URLs (and the existing `scenarios.fzp.*`) |
| `src/routes/attribution/+page.svelte` | Credit line for streets, historic status and the SB 79 statute |
| `pipeline/sources/datasf.ts`, `normalise.ts` | `datasf-streets` → `src_streets`, `datasf-historic-status` → `src_historic` |
| `pipeline/test/fixtures/mini/make-fixture.ts`, `README.md`, `sources.lock.json` | Lot 18, street centerlines, historic rows |
| `pipeline/config.ts` | New `SQL_VARS`, new profile fields, fixture known answers |
| `pipeline/lib/density-caps.ts` | `fzpYieldCapOf` (shared by `scenario.ts` and `policy.ts`) |
| `pipeline/lib/scenario-files.ts` | `POLICY_BIN`, `FRONTAGE_BIN` |
| `pipeline/sql/82_policy.sql` (new) | `pol_historic`, `pol_tod` |
| `pipeline/sql/83_frontage.sql` (new) | `fr_seg`, `fr_front` |
| `pipeline/steps/policy-sql.ts` (new) | Load `pol_stops`, run `82_policy.sql`, check tallies |
| `pipeline/lib/sb79.ts` (new) | Pure SB 79 rules: `stopTiers`, `bandOf`, `zoneClassOf`, `bestStandard`, `sb79Row` |
| `pipeline/lib/current-law.ts` (new) | `currentLawRow` |
| `pipeline/steps/policy.ts` (new) | `writePolicy`, `POLICY_DUMP`, `formatPolicyDump`, `readPolicyBin` |
| `pipeline/steps/frontage.ts` (new) | `writeFrontage`, `FRONTAGE_DUMP`, `formatFrontageDump`, `readFrontageBin` |
| `pipeline/steps/check-policy.ts` (new) | V31–V34 |
| `pipeline/steps/build.ts`, `check.ts`, `fixture.ts` | Wiring, invariants, golden dumps |
| `pipeline/lib/quality-rules/sd.ts` | `sd.historic.no-row`, `sd.sb79.zone-unlisted`, `sd.streets.no-frontage` |
| `docs/dev/pipeline.md` | "Policy parcels" and "Street frontage" sections, V31–V34 in the invariant summary, generated Data quality section |

---

### Task 1: SB 79 research and `pipeline/sb79-config.ts`

**Files:**
- Create: `pipeline/sb79-config.ts`
- Test: `pipeline/test/sb79-config.test.ts`

**Interfaces:**
- Consumes: `Cite` from `pipeline/transit-config.ts`; `ModeId` from `src/lib/data/transit.ts`.
- Produces:
  - `export type Sb79Tier = 1 | 2;`
  - `export type TodBand = 1 | 2 | 3; // adjacent, quarter, half`
  - `export interface TieredCite extends Cite { tier: 0 | 1 | 2 | 3 | 4 }`
  - `export const BAND_MAX_M: Record<TodBand, number>`, set to `{ 1: 60.96, 2: 402.336, 3: 804.672 }`
  - `export const STANDARDS: Record<Sb79Tier, Record<TodBand, { heightFt: number; duPerAcre: number; residentialFar: number }>> & { cite: TieredCite }`, with the values from the Findings section
  - `export const VHF_TPD = 72; export const HF_TPD = 48; export const MIN_UNITS = 5;`
  - `export const LIGHT_RAIL_MODES: readonly ModeId[]` (at least `'light-rail'` and `'streetcar'`; `'cable-car'` only if the research below supports it)
  - `export const BRT_STOP_IDS: ReadonlySet<string>` (transit.json stop ids, `muni:<stop_id>`)
  - `export type ZoneClass = 'residential' | 'mixed' | 'commercial' | 'excluded';`
  - `export const ZONE_CLASS_RULES: readonly { pattern: RegExp; zoneClass: ZoneClass; cite: TieredCite }[]`
  - `export const SF_PERMANENT_EXEMPT: { pattern: RegExp; cite: TieredCite }`, for the Ord. 082-26 §3 zones M, SALI, PDR, WMUO and P
  - `export const CURRENT_LAW_RULE: 'fzp+sb79' | 'fzp+s207.11'` (default `'fzp+sb79'`, the spec; see Open question 1)
  - `export const SB79_EFFECTIVE = '2026-07-01';`
  - `export const UNSOURCED: readonly string[]`

- [ ] **Step 1: Pin the statute against its text.** Read SB 79 (2025) as chaptered at `https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB79`, Gov. Code §§65912.155–65912.162. Confirm every Table 1 value in the Findings section against §65912.157(a)(3)–(6) and (e), the band distances and the measurement rule (§65912.157(b)), the 5-unit minimum (§65912.157(a)(1)), the rent-control site condition (§65912.157(h)), and the tier definitions (§65912.156(d), (e), (h), (n), (o), (r)). Cite the statute (tier 1) where it confirms ABAG. Where the two differ, the statute wins. Record the difference in the commit body and stop for the controller.

- [ ] **Step 2: Resolve the stop set.**
  - (a) Check whether MTC's SB 79 TOD stop map (the Plan Bay Area attachment "Preliminary Draft Map: Senate Bill 79 Stops and Zones" and its ArcGIS webmap) publishes stops as downloadable data, and under what licence.
  - (b) Decide whether `cable-car` counts as light rail ("streetcar, trolley, and tramway service", §65912.156(h)). Use MTC's map if it settles the question. Otherwise exclude cable cars, and list the choice in `UNSOURCED`.
  - (c) List the Van Ness BRT stops as transit.json stop ids. They must meet PRC §21060.2(a)(1): full-time dedicated lanes and ≤ 15 min peak. Get the ids from SFMTA's Van Ness BRT pages or MTC's map, and the stop ids from the live `gtfs-muni` feed's `stops.txt`. Any other SF corridor that MTC counts as BRT goes in only with a source.

  If MTC data exists with an open licence, do not switch sources. Record it under Open question 6 in the commit body.

- [ ] **Step 3: Zone classes.** Map every SF use-district family that `sc_zoning` can hold (RH, RM, RC, RTO, NC*, NCT*, named NCDs, C-2, C-3-*, MUG/MUO/MUR/UMU/WMUG/WMUO/SPD/RED/RSD/SLR/SLI/SSO, PDR-*, M-1/M-2, SALI, P, and so on) to `residential | mixed | commercial | excluded`. Source each mapping from the Planning Code article that defines the district (tier 1). Industrial (PDR, M, SALI) and Public (P) are `excluded` under SB 79's "zoned for residential, mixed-use, or commercial development". `SF_PERMANENT_EXEMPT` copies Ord. 082-26's title list (tier 1). Its parcel table is not modelled: note this in `UNSOURCED`.

- [ ] **Step 4: SF ordinance status.** Record two facts with dated sources: (a) whether HCD has approved or found compliant San Francisco's Alternative Plan (Ord. 082-26), and (b) the status of the litigation over SF's SB 79 implementation. Also record where the Board File 260132 parcel tables can be fetched (permanent, temporary low-resource, capacity), if anywhere. These go into the config's header comment and are reported to the controller with the commit. They feed Open question 1. Do not change `CURRENT_LAW_RULE` yourself.

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
});
it('cites every parameter with a tier', () => {
  for (const r of ZONE_CLASS_RULES) expect(r.cite.source.length).toBeGreaterThan(0);
  expect(STANDARDS.cite.tier).toBeLessThanOrEqual(1);
});
it('classifies no SF use district family twice', () => { /* each sample code matches exactly one rule */ });
```

  Use the values the statute confirms. If Step 1 changed one, change the test to match and say so in the commit.

- [ ] **Step 6:** Run `npx vitest --run --project pipeline pipeline/test/sb79-config.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 7:** Write `pipeline/sb79-config.ts` with the Step 1–4 findings. Name the tier on every entry. Leave `CURRENT_LAW_RULE = 'fzp+sb79'`.
- [ ] **Step 8:** Run the test again. Expected: PASS.
- [ ] **Step 9: Commit.**

```bash
git add pipeline/sb79-config.ts pipeline/test/sb79-config.test.ts
git commit -m "feat(pipeline): cite SB 79 standards, stop tiers and zone classes" -m "<findings of steps 1-4, incl. HCD/litigation status and UNSOURCED>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Shared column file and `mostPermissive`

**Files:**
- Create: `src/lib/data/column-file.ts`, `src/lib/data/stock-layers.ts`
- Test: `src/lib/data/column-file.test.ts`, `src/lib/data/stock-layers.test.ts`

**Interfaces:**
- Produces (`column-file.ts`; imports only `fnv1a32` from `../generator/seed`):
  - `export type ColType = 'u8' | 'u16' | 'u32' | 'i32';`
  - `export interface ColumnIn { name: string; type: ColType; values: ArrayLike<number> }`
  - `export function encodeColumnFile(magic: string, major: number, header: Record<string, unknown>, columns: readonly ColumnIn[], fail: (msg: string) => never): Uint8Array`. The layout is the same as `sfh-scenario/1`: a 4-byte ASCII magic, then u16 major, u16 reserved 0, u32 header length H, the header JSON (with a `columns: [{ name, type, offset, byteLength }]` array appended, offsets absolute and multiples of 8), then the columns in the given order. Values are range-checked per type.
  - `export interface ColumnFile { header: Record<string, unknown>; read(name: string, type: ColType, length: number): Uint8Array | Uint16Array | Uint32Array | Int32Array }`
  - `export function openColumnFile(bytes: Uint8Array, magic: string, major: number, names: readonly string[], fail: (msg: string) => never): ColumnFile`. It checks the magic and major, that the header is JSON, that the `columns` listed match `names` exactly once each in order, that each is 8-aligned, non-overlapping and inside the payload, and that `read`'s `length × size === byteLength`.
  - `export async function inflateRawBody(body: ReadableStream<Uint8Array> | Uint8Array): Promise<Uint8Array>`, the `DecompressionStream('deflate-raw')` pattern of `readScenarioParcels`.
  - `export function idsHash(ids: readonly string[]): number`, which is `fnv1a32(ids.join('\n'))`.
- Produces (`stock-layers.ts`):
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
it('rejects a value outside its type, a wrong magic, a missing column and a wrong length', () => {
  expect(() => encodeColumnFile('TEST', 1, {}, [{ name: 'a', type: 'u8', values: [256] }], fail)).toThrow(/does not fit u8/);
  expect(() => openColumnFile(ok, 'NOPE', 1, ['a'], fail)).toThrow(/bad magic/);
  expect(() => openColumnFile(ok, 'TEST', 1, ['a', 'z'], fail)).toThrow(/column z is missing/);
  expect(() => openColumnFile(ok, 'TEST', 1, ['a'], fail).read('a', 'u8', 3)).toThrow(/bytes, want/);
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

- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/data/column-file.test.ts src/lib/data/stock-layers.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement both modules. `column-file.ts` must stay worker-safe: no zod, no DOM-only APIs beyond `DecompressionStream`, no `node:` imports.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/lib/data/column-file.ts src/lib/data/column-file.test.ts src/lib/data/stock-layers.ts src/lib/data/stock-layers.test.ts`, then `git commit -m "feat(data): shared column-file codec helpers and the stock-layer blend rule" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 3: `sfh-policy/1` codec

**Files:**
- Create: `src/lib/data/policy-codec.ts`, `src/lib/data/fixtures/policy-tiny.ts`
- Test: `src/lib/data/policy-codec.test.ts`

**Interfaces:**
- Consumes: Task 2's `encodeColumnFile`, `openColumnFile`, `inflateRawBody` and `idsHash`; `ScenarioParcels` and `FILL_LEVELS`; `Provenance` from `../timelapse/types`.
- Produces:

```ts
export const POLICY_FORMAT = 'sfh-policy/1';
export const NULL_CAP = 0xffff;
export const HISTORIC_CODES = ['', 'A', 'A*', 'B', 'C'] as const; // '' = no status row
export const TOD_BANDS = ['none', 'adjacent', 'quarter', 'half'] as const;
export const SB79_STATUSES = ['outside', 'applies', 'not-eligible', 'zone', 'rent-control', 'min-units'] as const;
export const CURRENT_LAW_RULES = ['fzp+sb79', 'fzp+s207.11'] as const;
export type Sb79Status = (typeof SB79_STATUSES)[number];
export type CurrentLawRule = (typeof CURRENT_LAW_RULES)[number];
export interface PolicyParcels {
  format: 'sfh-policy/1';
  datasetVersion: string;
  count: number;
  idsHash: number;
  fillLevels: number[];
  currentLawRule: CurrentLawRule;
  useDistricts: string[]; // zoning codes as in sc_zoning ('' = none), sorted
  provenance: Record<'useDistrict' | 'historic' | 'sb79' | 'currentLaw', Provenance>;
  useDistrict: Uint16Array; // index into useDistricts
  historic: Uint8Array; // index into HISTORIC_CODES
  fzpYieldCap: Uint16Array; // the cap parcels.bin `yield` used: NULL_CAP on Local Program / uncapped
  todTier: Uint8Array; // 0 none, 1, 2: the tier of the standard sb79Stories comes from
  todBand: Uint8Array; // index into TOD_BANDS
  sb79Status: Uint8Array; // index into SB79_STATUSES
  sb79Stories: Uint8Array; // 0 unless status 'applies'
  sb79Yield: Uint16Array; // count × F, uncapped, each 0 or ≥ MIN_UNITS
  hostableSb79: Uint8Array; // flags bit 0
  hostableCurrent: Uint8Array; // flags bit 1
  currentFromSb79: Uint8Array; // flags bit 2
  sfPermanentExempt: Uint8Array; // flags bit 3 (Ord. 082-26 §3 zones; recorded, not applied by 'fzp+sb79')
  currentStories: Uint8Array;
  currentCap: Uint16Array; // NULL_CAP = no cap
  currentYield: Uint16Array; // count × F
}
export function encodePolicyPayload(p: PolicyParcels): Uint8Array;
export function decodePolicyPayload(
  bytes: Uint8Array,
  parcels: Pick<ScenarioParcels, 'count' | 'id' | 'datasetVersion' | 'fillLevels'>
): PolicyParcels;
export async function readPolicyParcels(
  body: ReadableStream<Uint8Array> | Uint8Array,
  parcels: Pick<ScenarioParcels, 'count' | 'id' | 'datasetVersion' | 'fillLevels'>
): Promise<PolicyParcels>;
export class PolicyFormatError extends Error { name = 'PolicyFormatError'; }
```

  Magic is `"SFHP"`, major 1. Columns, in order: `useDistrict` u16, `historic` u8, `fzpYieldCap` u16, `todTier` u8, `todBand` u8, `sb79Status` u8, `sb79Stories` u8, `flags` u8, `currentStories` u8, `currentCap` u16, `sb79Yield` u16 ×F, `currentYield` u16 ×F. The header keys are `format, datasetVersion, count, idsHash, fillLevels, currentLawRule, useDistricts, historicCodes, todBands, sb79Statuses, provenance`. The decoder rejects code lists that differ from the constants. Flags bits 4–7 are reserved and must be 0.

- [ ] **Step 1: Write the fixture** `policy-tiny.ts`. Export `policyTiny(parcels: ScenarioParcels): PolicyParcels` over `scenario-tiny.ts`'s rows. Include one row of each `SB79_STATUSES` value that the tiny row count allows, one with `currentFromSb79 = 1`, one `fzpYieldCap = NULL_CAP`, one `historic = 'A*'` and one `''`. The values are tier 4, made up, and the file says so.
- [ ] **Step 2: Write the failing tests** in `policy-codec.test.ts`:

```ts
it('round-trips the tiny policy file byte-identically', () => {
  const bytes = encodePolicyPayload(policyTiny(tiny));
  const d = decodePolicyPayload(bytes, tiny);
  expect(encodePolicyPayload(d)).toEqual(bytes);
  expect(d.idsHash).toBe(idsHash(tiny.id));
});
it('refuses a parcels.bin it was not built for', () => {
  const bytes = encodePolicyPayload(policyTiny(tiny));
  expect(() => decodePolicyPayload(bytes, { ...tiny, count: tiny.count - 1 })).toThrow(PolicyFormatError);
  expect(() => decodePolicyPayload(bytes, { ...tiny, id: [...tiny.id].reverse() })).toThrow(/idsHash/);
  expect(() => decodePolicyPayload(bytes, { ...tiny, id: tiny.id.map((x, i) => (i ? x : x + 'X')) })).toThrow(/idsHash/);
  expect(() => decodePolicyPayload(bytes, { ...tiny, datasetVersion: 'fixture-9' })).toThrow(/datasetVersion/);
});
it('rejects reserved flag bits, out-of-range codes and an unknown current-law rule', () => { /* three expects */ });
it('readPolicyParcels inflates a deflate-raw body', async () => {
  expect((await readPolicyParcels(deflateRawSync(bytes), tiny)).count).toBe(tiny.count);
});
```

- [ ] **Step 3:** Run `npx vitest --run --project server src/lib/data/policy-codec.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement `policy-codec.ts` on Task 2's helpers. The encoder validates array lengths (`count`, `count × F`), checks that 0/1 columns hold only 0/1, and that every dictionary index is in range.
- [ ] **Step 5:** Run the tests again. Expected: PASS.
- [ ] **Step 6: Commit.** `git add src/lib/data/policy-codec.ts src/lib/data/policy-codec.test.ts src/lib/data/fixtures/policy-tiny.ts`, then `git commit -m "feat(data): sfh-policy/1 codec for per-lot policy inputs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

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
  names: string[]; // streetname dictionary, sorted ('MISSION ST')
  segCnn: Uint32Array; // per segment, ascending
  segName: Uint16Array; // index into names
  segClass: Uint8Array; // index into STREET_CLASSES
  rowStart: Uint32Array; // count + 1 offsets into the entry columns (derived from frontCount)
  frontSeg: Uint16Array; // per entry: segment index
  frontDepth: Uint8Array; // per entry: 0 fronting, 1 one lot deep
}
export function encodeFrontagePayload(f: Frontage): Uint8Array;
export function decodeFrontagePayload(bytes: Uint8Array, parcels: Pick<ScenarioParcels, 'count' | 'id' | 'datasetVersion'>): Frontage;
export async function readFrontage(body: ReadableStream<Uint8Array> | Uint8Array, parcels: Pick<ScenarioParcels, 'count' | 'id' | 'datasetVersion'>): Promise<Frontage>;
/** Rows (ascending, unique) with an entry on a segment where `seg(s)` is true at depth ≤ maxDepth. */
export function frontingRows(f: Frontage, seg: (s: number) => boolean, maxDepth: 0 | 1): number[];
export class FrontageFormatError extends Error { name = 'FrontageFormatError'; }
```

  Magic is `"SFHF"`, major 1. Columns: `segCnn` u32, `segName` u16, `segClass` u8 (per segment), `frontCount` u8 (per row), `frontSeg` u16, `frontDepth` u8 (per entry). Entries within a row are sorted by `(depth, seg)` and unique per seg (one row may not hold the same seg at both depths). The decoder checks all of this, plus that `segCnn` is strictly ascending and that the entry total equals Σ `frontCount`.

- [ ] **Step 1: Fixture** `frontage-tiny.ts` over `scenario-tiny.ts` (tier 4, made up). Three segments, two named `MISSION ST` (class arterial) and one `FIXTURE AVE` (residential). Rows: a corner row (both names, depth 0), a depth-1 row, and a row with no entries.
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
it('refuses another parcels.bin, unsorted entries and a seg at both depths', () => { /* idsHash, order, duplicate */ });
```

- [ ] **Step 3:** Run `npx vitest --run --project server src/lib/data/frontage-codec.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement `frontage-codec.ts`.
- [ ] **Step 5:** Run the tests again. Expected: PASS.
- [ ] **Step 6: Commit.** `git add src/lib/data/frontage-codec.ts src/lib/data/frontage-codec.test.ts src/lib/data/fixtures/frontage-tiny.ts`, then `git commit -m "feat(data): sfh-frontage/1 codec for lot-to-street frontage" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 5: Manifest keys, upload/verify coverage, attribution

**Files:**
- Modify: `src/lib/data/manifest.ts:56-79` (schema and `superRefine` URL list)
- Modify: `pipeline/steps/manifest.ts` (`buildManifest` gains `policy?: boolean; frontage?: boolean`)
- Modify: `pipeline/steps/upload.ts:105-116` and `pipeline/steps/verify.ts:48-56` (also list `scenarios.fzp.*`, the new keys included)
- Modify: `src/routes/attribution/+page.svelte`
- Test: `src/lib/data/manifest.test.ts`, `pipeline/test/manifest.test.ts`, `pipeline/test/upload.test.ts`, `pipeline/test/verify.test.ts`, `src/routes/attribution/page.svelte.spec.ts`

**Interfaces:**
- Produces: `Manifest['scenarios']['fzp']` gains `policy?: RootRelativeUrl; frontage?: RootRelativeUrl`. `buildManifest({ …, scenarios, policy, frontage })` emits `${base}/scenarios/fzp/policy.bin` and `${base}/scenarios/fzp/frontage.bin` only when `scenarios` and the flag are both true.

- [ ] **Step 1: Failing tests.**
  - `manifest.test.ts`: the existing `manifest.golden.json` (no new keys) still parses and has no `policy` key. A copy with both keys under its own `/data/<v>/` prefix parses. A `policy` URL under another version is rejected with `url must start with`.
  - `pipeline/test/manifest.test.ts`: `buildManifest({ …, scenarios: true, policy: true, frontage: false })` names `policy` and not `frontage`.
  - `upload.test.ts`: a manifest naming `scenarios.fzp.policy` with the file absent reports `manifest names … policy.bin but … is missing`.
  - `verify.test.ts`: the new URL is HEAD-checked.
  - `page.svelte.spec.ts`: with `scenarios.fzp.policy` set, the page shows the text `Street centerlines and historic resource status from DataSF`. Without it, the text is absent.
- [ ] **Step 2:** Run `npx vitest --run --project server src/lib/data/manifest.test.ts`, then `npx vitest --run --project pipeline pipeline/test/manifest.test.ts pipeline/test/upload.test.ts pipeline/test/verify.test.ts`, then `npx vitest --run --project client src/routes/attribution/page.svelte.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add one `{#if hasPolicy}` list item to the attribution page, after the transit item, with this exact copy:

  > Street centerlines and historic resource status from DataSF, under PDDL. SB 79 stock-layer heights follow California Government Code §§65912.155–65912.162 (SB 79, 2025), as summarised by ABAG/MTC.

- [ ] **Step 4:** Run the same tests again. Expected: PASS. Also run `npx vitest --run --project server scripts/data-transit.spec.ts` (it reads `manifest.golden.json`). Expected: PASS.
- [ ] **Step 5: Commit.** `git add` the files above, then `git commit -m "feat(data): optional policy and frontage manifest keys" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 6: New sources, mini fixture lot 18, streets and historic rows

**Files:**
- Modify: `pipeline/sources/datasf.ts` (`DatasfId`, `DATASF`), `pipeline/sources/normalise.ts` (`SourceId`, `SOURCE_IDS`, `TABLES`, `buildSelect`)
- Modify: `pipeline/test/fixtures/mini/make-fixture.ts`, `README.md`; regenerate `pipeline/test/fixtures/mini/sources.lock.json` and `raw/*`
- Modify: `pipeline/config.ts` (`FIXTURE_PROFILE`)
- Modify (lot count 17 → 18): `pipeline/test/sql.test.ts:25,212`, `pipeline/test/scenario-sql.test.ts:163,230`, `pipeline/test/scenario-features.test.ts:109`, `e2e/scenario-data.spec.ts:52`. Grep `toHaveLength(17)`, `toBe(17)` and `17 parcels` under `pipeline/test` and `e2e` for any others.
- Regenerate: `pipeline/test/fixtures/mini/golden/`, `e2e/fixtures/data/fixture-0/`
- Test: `pipeline/test/normalise.test.ts`

**Interfaces:**
- Produces:
  - Lock id `datasf-streets`: `{ dataset: '3psu-pn9h', format: 'geojson', select: 'cnn,streetname,classcode,layer,active,line', where: 'active=true', license: 'PDDL-1.0', homepage: 'https://data.sf.gov/d/3psu-pn9h', label: 'DataSF Streets – Active and Retired (centerlines)' }`. It normalises to `src_streets(cnn BIGINT, streetname VARCHAR, classcode INTEGER, layer VARCHAR, geom GEOMETRY)` ordered by `cnn`.
  - Lock id `datasf-historic-status`: `{ dataset: '3tsw-4idn', format: 'csv', select: 'apn,ceqacode,ceqacodea10a11', license: 'PDDL-1.0', homepage: 'https://data.sf.gov/d/3tsw-4idn', label: 'DataSF Historic Resource Status by Parcel' }`. It normalises to `src_historic(apn VARCHAR /* upper, trimmed */, ceqacode VARCHAR, ceqacodea10a11 VARCHAR)` with `ORDER BY ALL`.
  - Mini lot 18 `3512018`: x[120, 130], y[30, 60]. It sits directly behind lot 13, in Noe Valley, in height district `120/400-R-2  //  140/520-R-2`, zoning `RM-1`. Its parcel row is in Noe Valley. It has a land-use row `RESIDENT` with resunits 2 and res 1600, no building, and roll rows 2025 and 2024 of `MRES/A` built 2001, 2 stories, 2 units, 1600 sf, 300k/400k.
  - Mini streets (local metres, `line` MultiLineString, SODA properties as strings):

    | cnn | streetname | classcode | layer | line |
    | --- | --- | --- | --- | --- |
    | 1000 | MISSION ST | 3 | STREETS | y = −8, x −60 → 95 |
    | 1001 | MISSION ST | 3 | STREETS | y = −8, x 95 → 148 |
    | 2000 | FIXTURE AVE | 5 | STREETS | x = 148, y −60 → 28 (it ends below lot 18, so lot 18 does not face it) |
    | 3000 | PAPER ST | 0 | PAPER_WATER | y = −8, x E−60 → E+60 |
    | 4000 | I-80 | 1 | FREEWAYS | y = 75, x 0 → 140 |

  - Mini historic rows (`apn`, `ceqacode`, `ceqacodea10a11`): `3512001` A/A; `3512101` C/C; `3512102` A/A; `3512103` C/C; `8711023C` B/B; `0026T001A` C/C; `3512013` A/A*; retired `3512099` A/A. Every other lot of 4–17 gets C/C. Lot 18 has **no row**.
  - `FIXTURE_PROFILE`: `unitsTarget` 90, `parcelRange` [18, 18], `scenarioUnitsRange` [74, 74]. Update the comments with the arithmetic (+2 for lot 18). The `rollJoinMin` comment becomes 13 of 15.

- [ ] **Step 1: Failing test.** `normalise.test.ts`:
  - `normalise(db, 'datasf-streets', [miniRaw('datasf-streets.page-000.geojson')], out)` returns 5, and `src_streets` row 1 is `{ cnn: 1000n, streetname: 'MISSION ST', classcode: 3, layer: 'STREETS' }`.
  - `datasf-historic-status` returns 15 rows, and apn `0026T001A` is kept verbatim and upper-cased.
- [ ] **Step 2:** Run `npx vitest --run --project pipeline pipeline/test/normalise.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add the two `DATASF` entries and their `buildSelect` cases.
  - Extend `make-fixture.ts` with lot 18, the streets raw, the historic CSV (SODA CSV conventions as the README describes), and their lock entries.
  - Run `npx tsx pipeline/test/fixtures/mini/make-fixture.ts`.
  - Add lot 18, a "Streets" table and a "Historic status" list to the README, and update the derived row counts (`src_parcels` 24, `src_parcel_attrs` 24, `src_landuse` 19, `src_roll` 37, `src_streets` 5, `src_historic` 15).
- [ ] **Step 4:** Run `npx vitest --run --project pipeline pipeline/test/normalise.test.ts`. Expected: PASS.
- [ ] **Step 5:** Run `npm run pipeline -- fixture --update-golden`. Expected: exit 0, V1–V30 OK. Review `git diff --stat pipeline/test/fixtures/mini/golden e2e/fixtures/data/fixture-0`. Expected changes:
  - lot 18 in parcels, chunks, `parcels.decoded.json` and the report counts;
  - the two new sources in `manifest.json` `sources`;
  - possibly the calibration golden, if its initiation inputs see lot 18.

  Any other change: stop and report.
- [ ] **Step 6:** Update the lot-count tests listed under Files. Run `npm run test:pipeline`, then `npx playwright test e2e/scenario-data.spec.ts e2e/fzp.spec.ts e2e/fzp-sim.spec.ts`. Expected: PASS.
- [ ] **Step 7: Commit.** `git add pipeline/sources pipeline/config.ts pipeline/test e2e`, then `git commit -m "feat(pipeline): lock street centerlines and historic status; mini lot 18" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

  The live lock does not get these entries until Task 11. A live `build` fails until then with `lock has no entry for datasf-streets`, which is expected.

### Task 7: Policy step: use district, historic status, FZP cap, `policy.bin`, V31

**Files:**
- Create: `pipeline/sql/82_policy.sql`, `pipeline/steps/policy-sql.ts`, `pipeline/steps/policy.ts`, `pipeline/steps/check-policy.ts`
- Modify: `pipeline/lib/density-caps.ts` (add `fzpYieldCapOf`), `pipeline/steps/scenario.ts:750-768` (use it), `pipeline/lib/scenario-files.ts`, `pipeline/steps/build.ts`, `pipeline/steps/check.ts`, `pipeline/steps/fixture.ts` (`GOLDEN_FILES`, dump), `pipeline/test/golden.test.ts`, `pipeline/config.ts` (profile fields), `pipeline/lib/quality-rules/sd.ts`, `docs/dev/pipeline.md`
- Test: `pipeline/test/policy-step.test.ts`, `pipeline/test/density-caps.test.ts`, `pipeline/test/invariants.test.ts`

**Interfaces:**
- Consumes: Task 3's codec; `readParcelsBin`; `readParcelRecords`; `sc_zoning`, `sc_district`, `src_historic`, `src_parcel_attrs`.
- Produces:
  - `export function fzpYieldCapOf(zoning: string | null, lotAreaM2: number, r4: boolean, localProgram: boolean, capDay: Day): number | null`. This is `localProgram ? null : densityCap(zoning, lotAreaM2, r4, capDay)`. `scenario.ts`'s `fzpYieldCap` must come from it, and `parcels.decoded.json` must not change.
  - `export const POLICY_BIN = 'scenarios/fzp/policy.bin'`, `FRONTAGE_BIN = 'scenarios/fzp/frontage.bin'` (in `scenario-files.ts`).
  - `export async function runPolicySql(db: Duck, stops: { id: string; tier: 1 | 2; lng: number; lat: number }[]): Promise<void>`. In this task it is called with `[]`. It writes `pol_stops`, then runs `82_policy.sql`, which writes `pol_historic(id VARCHAR, code VARCHAR)` (one row per parcel; `''` = no row) and `pol_tod(id, tier, dist_m)` (empty here, filled in Task 8). It tallies `sd.historic.no-row`. For each parcel, the code is the most protective of its rows, with rank A* > A > B > C. The match goes apn → active `src_parcel_attrs.blklot` → `mapblklot` = `parcels.id`.
  - `export const POLICY_DUMP = 'scenarios/fzp/policy.decoded.json'`, `export function formatPolicyDump(p: PolicyParcels): string`, `export function readPolicyBin(file: string, parcels: ScenarioParcels): PolicyParcels`.
  - `export async function writePolicy(a: { db: Duck; outDir: string; datasetVersion: string; records: { rec: ParcelRecord; cellId: string }[]; capDay: Day; buildCounts: Record<string, number> }): Promise<{ counts: Record<string, number>; warnings: string[] }>`. In this task it writes `useDistrict`, `historic` and `fzpYieldCap`, with SB 79 status `outside` everywhere (stories 0, yields 0). The current-law columns are a copy of FZP: `currentStories = envelopeStories`, `currentCap = fzpYieldCap`, `currentYield = yield`, `hostableCurrent = hostable`, `currentFromSb79 = 0`. Counts: `policy.bytes.payload`, `policy.bytes.file` (non-fixture only), `policy.historic.<A|A*|B|C|none>`, `policy.use_district_mismatch` (rows whose decoded `useDistricts[useDistrict[i]]` ≠ `coalesce(sc_zoning.zoning_code, '')`; must be 0).
  - `export function checkPolicy(outDir: string, profile: InvariantProfile, counts: Record<string, number>, p: ScenarioParcels | null, m: Manifest | null, stableDetail: boolean): InvariantResult[]`. In this task it returns V31.
  - `InvariantProfile` gains `historicJoinMin: number` (live 0.95, fixture 17/18), `policyMaxBytes: number` (both 1.0e6) and `frontageMaxBytes: number` (both 1.0e6). `check-policy.ts` defines the constants `POLICY_WARN_BYTES = 0.75e6` and `FRONTAGE_WARN_BYTES = 0.75e6` (tier 4 engineering budgets, Budget decision above).
  - T14 rule `sd.historic.no-row`: source `datasf-historic-status`, field `historic`, kind `missing`, action `default`, tier 4, valueTier 4, denominator `parcels`, `MISSING_SHARES`.
- **Build placement:** in `build.ts`, after `writeCalibration`, move `writeNeighborhoods` and `writeTransit` up so they run *before* `writeQualityReport`. Then call `writePolicy` (records hoisted into a `const records = await readParcelRecords(db)` shared with `writeScenario`). Merge its counts and warnings. `buildManifest` gets `policy: existsSync(join(outDir, POLICY_BIN))`. `checkDataset` calls `checkPolicy` after V30.

- [ ] **Step 1: Failing tests.**
  - `density-caps.test.ts`: `fzpYieldCapOf('RH-1', 300, false, true, day)` is `null`, and `fzpYieldCapOf('RH-1', 300, false, false, day)` equals `densityCap('RH-1', 300, false, day)`.
  - `policy-step.test.ts` builds the mini fixture database (the `helpers.ts` pattern the other step tests use), runs the scenario step and then `writePolicy`, and asserts:
    - lot 18 has `historic` `''`, lot 2 has `'A'` (the most protective condo row), lot 13 has `'A*'` and lot 3 has `'B'`;
    - lot 18's use district is `'RM-1'`;
    - `counts['policy.use_district_mismatch']` is 0;
    - every row has `currentYield` equal to `parcels.yield` and `fzpYieldCap` equal to `NULL_CAP` on Local Program rows.
  - `invariants.test.ts`: on a fixture out dir, V31 is OK. Re-pointing `policy.bin` at a `parcels.bin` with one id changed makes V31 fail with `does not decode`.
- [ ] **Step 2:** Run `npx vitest --run --project pipeline pipeline/test/density-caps.test.ts pipeline/test/policy-step.test.ts pipeline/test/invariants.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** V31 fails on any of these:
  - `policy.bin` is missing, or the manifest names it and the file is missing (or the reverse);
  - it does not inflate or decode against the decoded `parcels.bin`;
  - `datasetVersion` differs from the manifest's;
  - re-encoding the decoded payload is not byte-identical;
  - `fillLevels` differs from `FILL_LEVELS`;
  - `counts['policy.use_district_mismatch']` is not 0;
  - the share of rows with `historic` ≠ `''` is below `historicJoinMin`;
  - the file is larger than `policyMaxBytes`.

  It warns above `POLICY_WARN_BYTES`. `stableDetail` omits byte numbers. Add `sd.historic.no-row` to `sd.ts`, then run `npm run pipeline -- quality-doc`.
- [ ] **Step 4: Docs.** In `docs/dev/pipeline.md`, add a "## Policy parcels" section after "## Scenario parcels". It covers:
  - the two new sources (ids, licences, fields) and that the use district comes from `datasf-parcel-attrs`;
  - the Budget decision, with the measured numbers;
  - the `policy.bin` columns;
  - the historic join rule;
  - V31.

  Append V31 to the invariant summary paragraph ("`build` and `check` evaluate V1 to V31…" — the paragraph is updated again in Tasks 8–10). Add `scenarios/fzp/policy.bin` to "Where things land".
- [ ] **Step 5:** Run the Step 2 tests again. Expected: PASS. Then run `npm run pipeline -- fixture --update-golden`. Expected: V1–V31 OK; a new `golden/scenarios/fzp/policy.decoded.json`; an unchanged `parcels.decoded.json`; `report.json` changed only by `policy.*` / `quality.sd.historic.*` counts and the V31 entry. Finally run `npm run test:pipeline`. Expected: PASS.
- [ ] **Step 6: Commit.** `git add pipeline docs/dev/pipeline.md e2e/fixtures/data/fixture-0`, then `git commit -m "feat(pipeline): policy.bin with use district, historic status and FZP cap (V31)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 8: SB 79 stock layer (V32)

**Files:**
- Create: `pipeline/lib/sb79.ts`
- Modify: `pipeline/sql/82_policy.sql` (`pol_tod`), `pipeline/steps/policy-sql.ts`, `pipeline/steps/policy.ts`, `pipeline/steps/check-policy.ts`, `pipeline/config.ts` (`SQL_VARS.tod_half_m = 804.672`; profile fields), `pipeline/lib/quality-rules/sd.ts`, `docs/dev/pipeline.md`
- Test: `pipeline/test/sb79.test.ts`, `pipeline/test/policy-step.test.ts`, `pipeline/test/invariants.test.ts`

**Interfaces:**
- Consumes: Task 1's config; `TransitNetwork` and `decodeTransit` (reads `<outDir>/transit.json`); `storiesFromFt` from `pipeline/lib/heights.ts`; `fillStories` and `FILL_LEVELS`; `scenarioYield` and `scenarioRecordOf`.
- Produces (`pipeline/lib/sb79.ts`, all pure):
  - `export function stopTiers(net: TransitNetwork): Map<number, Sb79Tier>`. Keys are stop indices.
    - A stop on any `heavy-rail` pattern → 1.
    - A stop on a `commuter-rail` pattern → its station's daily trains: Σ `tpd` over the commuter-rail pattern stops whose stop has the same `stationId` (the stop's own id when null). ≥ `VHF_TPD` → 1; else ≥ `HF_TPD` → 2.
    - A stop on a `LIGHT_RAIL_MODES` pattern → 2.
    - A stop whose id is in `BRT_STOP_IDS` → 2.
    - Otherwise absent.
    - The lowest tier number wins.
  - `export function bandOf(distanceM: number): TodBand | 0`. Bands are inclusive at their upper edge: `≤ 60.96` → 1, `≤ 402.336` → 2, `≤ 804.672` → 3, else 0.
  - `export function zoneClassOf(code: string | null): ZoneClass | 'unlisted'`. It splits on `|`, takes the most permissive component (residential = mixed = commercial > excluded), and returns `'unlisted'` only when no component matches a rule. `null` → `'unlisted'`.
  - `export function bestStandard(minDist: Partial<Record<Sb79Tier, number>>): { tier: Sb79Tier; band: TodBand } | null`. This is the (tier, band) with the highest `heightFt`; a tie goes to tier 1.
  - `export function sb79Row(a: { best: { tier: Sb79Tier; band: TodBand } | null; eligible: boolean; zone: ZoneClass | 'unlisted'; rentControlLikely: boolean; grossAt: (stories: number) => number }): { status: Sb79Status; stories: number; yield: number[] }`. Statuses, in precedence order:
    1. `outside` (best null);
    2. `not-eligible`;
    3. `zone` (`excluded` or `unlisted`);
    4. `rent-control`;
    5. `min-units`: `grossAt(fillStories(1, s)) < MIN_UNITS` with `s = storiesFromFt(STANDARDS[tier][band].heightFt)`;
    6. `applies`.

    For `applies`, `yield[k] = g ≥ MIN_UNITS ? g : 0` with `g = grossAt(fillStories(FILL_LEVELS[k], s))`, uncapped. Every other status gives stories 0 and all-zero yields.
  - `82_policy.sql` `pol_tod`: `SELECT p.id, s.tier, min(ST_Distance(p.geom_orig, s.geom)) AS dist_m FROM parcels p JOIN pol_stops s ON ST_DWithin(p.geom_orig, s.geom, getvariable('tod_half_m')) GROUP BY ALL ORDER BY ALL`. `pol_stops.geom` is the stop lng/lat transformed to EPSG:7131 as `10_parcels.sql` does it.
  - `writePolicy` now:
    - takes the stops from `stopTiers(decodeTransit(transit.json))`;
    - sets `todTier`, `todBand`, `sb79Status`, `sb79Stories`, `sb79Yield` and `hostableSb79 = status === 'applies'`;
    - sets `sfPermanentExempt` from `SF_PERMANENT_EXEMPT` on the zoning code;
    - adds the counts `policy.sb79.<status>`, `policy.sb79.stops.tier1`, `policy.sb79.stops.tier2`, `policy.sb79.net_capacity` (Σ max(0, top − existingUnits) over `applies`), `policy.sb79.density_would_bind` (`applies` rows whose top yield exceeds `floor(duPerAcre × lotAreaM2 / 4046.8564224)`; report only, Open question 2) and `policy.sb79.tod_share` (rows with `todBand > 0` / count, as a ×1e4 integer).
  - Profile fields: `sb79MinT1Stops` (live 8, fixture 3: FX-1, 70011, 70012), `sb79MinT2Stops` (live 50, fixture 2: m4, m5), and `todShareWarn: [number, number] | null` (live [0.6, 0.95], warn only, around Planning's "> 75% of the assessor's parcels" in Ord. 082-26 §2(e); fixture null).
  - T14 rule `sd.sb79.zone-unlisted`: source `datasf-parcel-attrs`, field `zoning_code`, kind `shape`, action `none` (the parcel is counted as not R/MU/C), tier 4, denominator `parcels within ½ mile of a TOD stop`, `SHARES`.

- [ ] **Step 1: Failing unit tests** `pipeline/test/sb79.test.ts`. Use a synthetic `TransitNetwork` built with the `pipeline/test/gtfs-builder.ts` style, or literal objects:

```ts
it('sums commuter-rail trains over the station, not the platform', () => {
  // two platforms of one station, 40 tpd each → 80 ≥ 72 → tier 1; one platform alone 60 → tier 2; 40 → none
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
  expect(bestStandard({ 1: 500, 2: 50 })).toEqual({ tier: 2, band: 1 }); // 85 ft > 65 ft
  expect(bestStandard({ 1: 300, 2: 50 })).toEqual({ tier: 2, band: 1 }); // 85 > 75
  expect(bestStandard({ 1: 50, 2: 50 })).toEqual({ tier: 1, band: 1 });
  expect(bestStandard({ 1: 700, 2: 300 })).toEqual({ tier: 1, band: 3 }); // 65 = 65 → tier 1
});
it('classifies split and unlisted zoning codes', () => {
  expect(zoneClassOf('RH-1|PDR-1-G')).toBe('residential');
  expect(zoneClassOf('PDR-1-G')).toBe('excluded');
  expect(zoneClassOf('XYZ')).toBe('unlisted');
  expect(zoneClassOf(null)).toBe('unlisted');
});
it('sb79Row: status precedence, the 5-unit minimum per fill level, no cap', () => {
  const grossAt = (s: number) => s; // 1 unit per story
  expect(sb79Row({ best: { tier: 1, band: 2 }, eligible: true, zone: 'residential', rentControlLikely: false, grossAt }))
    .toEqual({ status: 'applies', stories: 7, yield: [0, 0, 5, 6, 7] });
  expect(sb79Row({ ...base, rentControlLikely: true }).status).toBe('rent-control');
  expect(sb79Row({ ...base, eligible: false, rentControlLikely: true }).status).toBe('not-eligible');
  expect(sb79Row({ ...base, grossAt: () => 4 })).toEqual({ status: 'min-units', stories: 0, yield: [0, 0, 0, 0, 0] });
});
```

  (`fillStories(f, 7)` for `[0.25, 0.5, 0.75, 0.9, 1]` is `[2, 4, 5, 6, 7]`; check this against `FILL_LEVELS` when writing the test.)

- [ ] **Step 2: Failing fixture assertions** in `policy-step.test.ts`. These are the mini known answers, from the README stop positions (FX-1 (120, 110) tier 1, Caltrain station (−40, −80) 80/day tier 1, N light rail m4 (100, 100) / m5 (300, 300) tier 2):
  - lot 18: band adjacent (50 m to FX-1), tier 1, 9 stories, status `applies`;
  - lot 1: band quarter (≈ 89 m to Caltrain), tier 1, 7 stories;
  - lots 15 and 17: band half (≈ 721 m and ≈ 718 m to FX-1), tier 1, 6 stories;
  - lot 16: `not-eligible` (underwater), lot 7: `not-eligible` (open space), lot 12: `zone` (`P`);
  - `policy.sb79.stops.tier1` 3 and `.tier2` 2.

  If the generator gives lot 1 fewer than 5 units at 7 stories, the golden shows `min-units`. Record that in the README rather than changing `MIN_UNITS`.
- [ ] **Step 3:** Run `npx vitest --run --project pipeline pipeline/test/sb79.test.ts pipeline/test/policy-step.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `sb79.ts`, `pol_tod`, the `writePolicy` changes and V32. V32 fails on any of these:
  - an `applies` row whose `sb79Stories ≠ storiesFromFt(STANDARDS[todTier][todBand].heightFt)`;
  - a non-`applies` row with stories or yields ≠ 0;
  - an `applies` yield in 1..4;
  - `hostableSb79 ≠ (status === 'applies')`;
  - `todBand = 0` with status ≠ `outside`, or the reverse;
  - fewer tier 1 or tier 2 stops than the profile minimum;
  - a `profile.transitHeavyRailStations` name without a tier 1 stop whose name contains it (case-insensitive).

  It warns when `tod_share` is outside `todShareWarn`. Add the rule to `sd.ts` and run `npm run pipeline -- quality-doc`.
- [ ] **Step 5: Docs.** Add "### SB 79 stock layer" under "Policy parcels": tiers, bands, distance from `geom_orig` to the stop point (stop points stand in for "pedestrian access points", tier 4), statuses, no density cap (spec call), the counts, V32, `UNSOURCED`, and the Ord. 082-26 facts from Task 1. Extend the invariant summary to V32.
- [ ] **Step 6:** Run the Step 3 tests again. Expected: PASS. Then run `npm run pipeline -- fixture --update-golden` (V1–V32 OK; review the `policy.decoded.json` diff against Step 2), then `npm run test:pipeline` (PASS).
- [ ] **Step 7: Commit.** `git add pipeline docs/dev/pipeline.md e2e/fixtures/data/fixture-0`, then `git commit -m "feat(pipeline): SB 79 stock layer from transit stops (V32)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 9: Current-law combination (V33)

**Gate:** check with the controller for a ruling on Open question 1 before starting. With no ruling, implement `'fzp+sb79'` (the spec). The `'fzp+s207.11'` branch below is built only if the partner rules for it.

**Files:**
- Create: `pipeline/lib/current-law.ts`
- Modify: `pipeline/steps/policy.ts`, `pipeline/steps/check-policy.ts`, `pipeline/sb79-config.ts` (type `CURRENT_LAW_RULE` with `CurrentLawRule` imported from `src/lib/data/policy-codec.ts`), `docs/dev/pipeline.md`
- Test: `pipeline/test/current-law.test.ts`, `pipeline/test/policy-step.test.ts`, `pipeline/test/invariants.test.ts`

**Interfaces:**
- Consumes: `mostPermissive` (Task 2), `CURRENT_LAW_RULE` (Task 1), and the policy columns from Task 8.
- Produces: `export function currentLawRow(rule: CurrentLawRule, fzp: { stories: number; cap: number | null; yield: number[]; hostable: boolean }, sb79: { stories: number; yield: number[]; hostable: boolean }): { stories: number; cap: number | null; yield: number[]; hostable: boolean; fromSb79: boolean }`.
  - `'fzp+sb79'`: `mostPermissive({ yieldTop: fzp.yield[F-1], hostable: fzp.hostable }, { yieldTop: sb79.yield[F-1], hostable: sb79.hostable })`. On `'b'` it returns SB 79's stories, `cap: null` and SB 79's yields and hostable with `fromSb79: true`. Otherwise it returns the FZP row.
  - `'fzp+s207.11'` (only if ruled): it needs the regenerated yield, so it takes an extra `grossAt` argument in that branch. Stories are `max(fzp.stories, 4)` when the FZP height is under 40 ft. The cap is `max(fzp.cap, floor(0.5 × duPerAcre × acres))`. It applies only on rows meeting Ord. 082-26 §5(b): `todBand > 0`, zone class residential or mixed, not R-4, `historic !== 'A*'`, and the FZP cap below the SB 79 minimum.
  - `writePolicy` sets the current columns from `currentLawRow`, writes `currentLawRule` and its provenance into the header, and adds the counts `policy.current.from_sb79` and `policy.current.net_capacity`.

- [ ] **Step 1: Failing tests.** `current-law.test.ts`:
  - SB 79 wins with a larger hostable top, and its cap is null;
  - an equal top keeps FZP and its cap;
  - a non-hostable SB 79 keeps FZP;
  - a non-hostable FZP with a hostable SB 79 takes SB 79.

  `policy-step.test.ts`: on the mini fixture, lot 14 (C-3-G) keeps FZP, and lot 18's current stories equal its FZP stories (its height district far exceeds 95 ft). Lots 15 and 17 (RH-2, capped) take SB 79 when their SB 79 top exceeds their capped FZP top: assert `currentFromSb79[i] === (sb79Top > fzpTop && hostableSb79 ? 1 : 0)` for every row. `invariants.test.ts`: V33 passes on the fixture and fails when one row's `currentYield` is altered (re-encode the mutated payload into a temp out dir).
- [ ] **Step 2:** Run `npx vitest --run --project pipeline pipeline/test/current-law.test.ts pipeline/test/policy-step.test.ts pipeline/test/invariants.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** V33 recomputes `currentLawRow(header.currentLawRule, …)` for every decoded row from the decoded `parcels.bin` (`envelopeStories`, `yield`, `hostable`), `fzpYieldCap` and the SB 79 columns. It fails on any difference. Under `'fzp+sb79'` it also fails if `hostableCurrent` is missing a row that has `hostable` or `hostableSb79`.
- [ ] **Step 4: Docs.** Add "### Current law" with the rule, the tie rule, why a single layer supplies the whole row, the provenance label, V33, and a pointer to Open question 1's facts. Extend the summary to V33.
- [ ] **Step 5:** Run the Step 2 tests again (PASS), then `npm run pipeline -- fixture --update-golden` (V1–V33 OK), then `npm run test:pipeline` (PASS).
- [ ] **Step 6: Commit.** `git add pipeline docs/dev/pipeline.md e2e/fixtures/data/fixture-0`, then `git commit -m "feat(pipeline): current-law envelope per lot, most permissive of FZP and SB 79 (V33)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 10: Street frontage (`frontage.bin`, V34)

**Files:**
- Create: `pipeline/sql/83_frontage.sql`, `pipeline/steps/frontage.ts`
- Modify: `pipeline/config.ts` (`SQL_VARS`, profile `frontageMin`), `pipeline/steps/build.ts`, `pipeline/steps/check-policy.ts`, `pipeline/steps/fixture.ts`, `pipeline/test/golden.test.ts`, `pipeline/lib/quality-rules/sd.ts`, `docs/dev/pipeline.md`
- Test: `pipeline/test/frontage-sql.test.ts`, `pipeline/test/frontage-step.test.ts`, `pipeline/test/invariants.test.ts`

**Interfaces:**
- Consumes: `parcels(id, geom_orig)`, `src_streets`, Task 4's codec, `readParcelsBin`.
- Produces:
  - `SQL_VARS`. Each is tier 4, chosen for SF rights of way and lot widths, and pinned by the fixture and the synthetic test:
    - `front_max_m: 40`: candidate search. The widest common ROW is 125 ft (≈ 38 m), so half is ≈ 19 m, plus setbacks and plazas.
    - `front_tol_m: 2`: a lot edge within the lot's own nearest distance + 2 m counts as facing.
    - `front_min_m: 5`: facing length needed. A 25 ft (7.6 m) lot plus up to 2 × 2 m of side edges always passes; a corner touch (≤ 4 m) does not.
    - `occlude_min_m: 0.5`: a sight line crossing another parcel by more than this is blocked.
    - `adjacent_min_m: 3`: shared boundary for "directly behind".
  - `83_frontage.sql`:
    1. `fr_seg(seg_idx, cnn, name, class, geom)`: `src_streets` rows with `classcode IN (2, 3, 4, 5)` and `layer NOT IN ('PAPER', 'PAPER_FWYS', 'PAPER_WATER', 'PRIVATE', 'PRIVATE_PARKING', 'PSEUDO', 'UPROW')`, geometry to EPSG:7131, `seg_idx` = row number by `cnn` − 1.
    2. **Depth 0:** for each `(lot, seg)` with `ST_DWithin(geom_orig, seg.geom, front_max_m)`, take `d = ST_Distance`. `facing = ST_Intersection(ST_Boundary(geom_orig), ST_Buffer(seg.geom, d + front_tol_m, 'endcap=flat'))`. `frontage_m = ST_Length(facing)`. The pair fronts when `frontage_m ≥ front_min_m` and the shortest line from the midpoint of `facing`'s longest part to `seg.geom` crosses no other parcel's `geom_orig` by more than `occlude_min_m`.
    3. **Depth 1:** lot B, seg s, where B has no depth-0 entry on s, and B shares ≥ `adjacent_min_m` of boundary with a lot A that has a depth-0 entry on s. The shortest line from B to s must cross A by more than `occlude_min_m` and cross no parcel other than A by more than `occlude_min_m`.
    4. `fr_front(id, seg_idx, depth)`, ordered by `(id, depth, seg_idx)`.

    Count `frontage.segments`, `frontage.entries.depth0`, `frontage.entries.depth1`, `frontage.no_frontage` (parcels with no depth-0 entry) and `frontage.corner` (parcels with depth-0 entries on ≥ 2 distinct names).
  - `export const FRONTAGE_DUMP = 'scenarios/fzp/frontage.decoded.json'`, `formatFrontageDump(f: Frontage): string`, `readFrontageBin(file: string, parcels: ScenarioParcels): Frontage`.
  - `export async function writeFrontage(a: { db: Duck; outDir: string; datasetVersion: string; buildCounts: Record<string, number> }): Promise<{ counts: Record<string, number>; warnings: string[] }>`. It runs `83_frontage.sql`, orders rows as `parcels.bin` does, and fails when segments exceed 65,535 or a row has more than 255 entries.
  - `InvariantProfile.frontageMin: number`: live 0.90, fixture 0.8 (known answer: 12 of the 15 eligible lots front a street; 15, 17 and 18 do not).
  - T14 rule `sd.streets.no-frontage`: source `datasf-streets`, field `frontage`, kind `missing`, action `none`, tier 4, valueTier null, denominator `eligible parcels`, `MISSING_SHARES`.
  - Build: `writeFrontage` runs after `writePolicy` and before `writeQualityReport`. `buildManifest` gets `frontage: existsSync(join(outDir, FRONTAGE_BIN))`.

- [ ] **Step 1: Failing synthetic SQL test** `pipeline/test/frontage-sql.test.ts`. On an empty DuckDB, create `parcels(id, geom_orig)` and `src_streets` in EPSG:7131 metres (the streets go into `src_streets` already projected, through a test-only `fr_seg` override if that is simpler), set the `SQL_VARS`, and run `83_frontage.sql`. Cases:
  - **Corner lot** `C` x[0, 20] y[0, 30] with a street at y = −8 and one at x = −8: two depth-0 entries.
  - **Interior lot** `I` x[20, 30] y[0, 30]: one entry (the y = −8 street).
  - **Rear lot** `R` x[20, 30] y[30, 60]: depth 1 on the y = −8 street, no depth 0.
  - **Through lot** `T` x[40, 50] y[0, 60] with a second street at y = 68: depth 0 on both.
  - **Boulevard lot** `B` 30 m from a centerline with no parcel between: depth 0.
  - **Far lot** `F` 45 m from any street: no entry.
  - **Park and behind:** park parcel `P` x[60, 100] y[0, 60] fronting y = −8, and lot `Q` x[60, 100] y[60, 90] directly behind it: `P` depth 0, `Q` depth 1.
  - **Freeway** (classcode 1) and **paper** (layer `PAPER`) segments next to lot `I`: never matched.

  Assert the exact `fr_front` rows.
- [ ] **Step 2: Failing step test** `frontage-step.test.ts`, on the mini fixture:
  - lots 1–9 have depth 0 on cnn 1000 only;
  - lot 10 has depth 0 on both 1000 and 1001 (split at x = 95);
  - lots 11–13 have 1001 at depth 0;
  - lot 13 also has 2000 at depth 1 (behind corner lot 14 along Fixture Ave);
  - lot 14 has 1001 and 2000 at depth 0 (corner);
  - lot 18 has depth 1 on 1001 and nothing else (the I-80 segment is excluded);
  - lots 15–17 have no entries (paper street excluded);
  - `frontage.corner` is 1.
- [ ] **Step 3:** Run `npx vitest --run --project pipeline pipeline/test/frontage-sql.test.ts pipeline/test/frontage-step.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** the SQL, the step, V34 and the rule (`npm run pipeline -- quality-doc`). V34 fails on any of these:
  - a missing file, or a manifest/file mismatch;
  - a decode failure against `parcels.bin` (the codec checks ordering, uniqueness and `idsHash`);
  - a re-encode that is not byte-identical;
  - a depth-1 entry with no depth-0 entry on the same segment in another lot (counted in the step as `frontage.depth1_orphan`, must be 0);
  - an eligible depth-0 share below `frontageMin`;
  - a file larger than `frontageMaxBytes`.

  It warns above `FRONTAGE_WARN_BYTES`.
- [ ] **Step 5: Docs.** Add "## Street frontage" after "Policy parcels":
  - the source (`3psu-pn9h`, PDDL, the classcode meanings, the filters);
  - the matching method and why: nearest distance + tolerance for facing edges, occlusion for rear lots, and adjacency + occlusion for "one lot deep";
  - each `SQL_VARS` value with its tier;
  - corner, through and ROW-gap behaviour (a plaza or freeway ROW with no parcel counts as fronting within 40 m; freeway/ramp/paper/private segments are never fronted);
  - what is not shipped: segment geometry, which plan 3 can take from the basemap or request later;
  - V34.

  Extend the summary to V34 and add `frontage.bin` to "Where things land".
- [ ] **Step 6:** Run the Step 3 tests again (PASS), then `npm run pipeline -- fixture --update-golden` (V1–V34 OK, new `frontage.decoded.json`), then `npm run test:pipeline` (PASS).
- [ ] **Step 7: Commit.** `git add pipeline docs/dev/pipeline.md e2e/fixtures/data/fixture-0`, then `git commit -m "feat(pipeline): lot-to-street frontage with one-lot-deep matches (V34)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 11: Live fetch, build and measurement (no upload)

**Files:**
- Modify: `pipeline/sources.lock.json`, `docs/dev/pipeline.md` (measured numbers), `pipeline/config.ts` (only if a check bound was wrong; see Step 4)

- [ ] **Step 1:** Run `npm run pipeline -- fetch --only datasf-streets,datasf-historic-status`. Expected: two new lock entries; `datasf-streets` has 1 page (about 16k rows) and `datasf-historic-status` has 4 pages (about 163k rows).
- [ ] **Step 2:** Run `npm run pipeline -- build` (no `--skip-tiles`, about 15–25 min). Expected: V1–V34 OK.
- [ ] **Step 3: Record from `out/<v>/report.json`.**
  - `scenario.bytes.file` (V19 unchanged, ≈ 2.1 MB), `policy.bytes.file`, `frontage.bytes.file`;
  - `policy.historic.*`;
  - `policy.sb79.*`, including `tod_share` against Planning's "> 75%", `net_capacity` and `density_would_bind`;
  - `policy.current.from_sb79` and `net_capacity`;
  - `frontage.*`, and `quality.sd.streets.no-frontage.*`, `quality.sd.sb79.zone-unlisted.*`, `quality.sd.historic.no-row.*`.

  Add the numbers, dated, to the matching `docs/dev/pipeline.md` sections.
- [ ] **Step 4: Bounds.** If a V31–V34 bound fails or warns on live data, stop and report the measured value. Do not retune silently: the controller decides whether the bound or the method is wrong. In particular, eligible parcels with no frontage above 10% means the matching method needs revisiting.
- [ ] **Step 5:** Run `npm run test:unit`, then `npm run test:pipeline`, then `npm run test:e2e`. Expected: PASS. `/fzp` (`e2e/fzp.spec.ts`, `e2e/fzp-sim.spec.ts`) is unchanged.
- [ ] **Step 6: Commit.** Run `git add pipeline/sources.lock.json docs/dev/pipeline.md`, then `git commit -m "chore(data): lock street centerlines and historic status for the policy layers" -m "<measured sizes and counts>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`. Do not push and do not upload. Report `<v>` and the Step 3 numbers to the controller. Signoff (`npm run signoff`) and any upload or promotion are the controller's call, with the user's go-ahead.

---

## Self-review

- **Spec coverage.** "Area brush by zoning district" → Tasks 6–7 (`useDistrict`). Street brush data: class, named street, one lot deep → Tasks 4 and 10. SB 79 stock layer generated from `transit.json` stops → Tasks 1 and 8. "Pipeline precomputes yields and `hostable` for … SB 79, and the current-law combination" → Tasks 8–9. FZP and base are already in `parcels.bin`, and `fzpYieldCap` (Task 7) gives plan 2 the "keeps each lot's current-law cap" input. Historic category → Tasks 6–7 (source found, not deferred). `yearBuilt` and `rentControlLikely` are already in `parcels.bin`. Lock and attribution → Tasks 5–6. The V19 budget → Budget decision and Task 11. `/fzp` keeps working → Global Constraints, Review Focus 1, Tasks 6 and 11. Out of scope for this plan: presets, timers, the UI and publishing (plans 2–5).
- **Type consistency.** `PolicyParcels` field names are used the same way in Tasks 3 and 7–9 (`fzpYieldCap`, `sb79Status`, `hostableSb79`, `currentFromSb79`). `Sb79Tier` and `TodBand` come from Task 1 and are used in Task 8. `CurrentLawRule` appears in Task 1 and in Task 3. Task 1 types `CURRENT_LAW_RULE` with the literal union `'fzp+sb79' | 'fzp+s207.11'` because Task 3 does not exist yet. Task 3's `CURRENT_LAW_RULES` holds the same two strings. Task 9 makes `pipeline/sb79-config.ts` import `CurrentLawRule` from `src/lib/data/policy-codec.ts` (add `pipeline/sb79-config.ts` to Task 9's commit), so a later rename fails to compile.
- **Known overlap.** `scenarioYield` runs once more per SB 79 row in `writePolicy`. It is memoised by stories per row, as `scenario.ts` does it.

## Open questions for the partner

1. **What is "current law" in San Francisco?** The spec defines it as "the FZP map, SB 79 and 'SF as observed' permitting". But SF Ordinance No. 082-26 (File 260132, finally passed 2026-05-05, approved 2026-05-08) adopts an SB 79 Alternative Plan, which "prevents the state-mandated zoning provisions of SB 79 … from taking effect in the City" until the next Housing Element cycle. What it puts in place is Planning Code §207.11: near TOD stops, outside R-4, on non-landmark lots below SB 79's minimum density, density rises to 50% of the SB 79 density and a height under 40 ft becomes 40 ft. It also exempts industrial and public zones permanently and low-resource parcels temporarily. Whether HCD has approved the plan, and how the pending lawsuits stand, is for Task 1 to record. The options:
   - (a) keep the spec's FZP + SB 79 statute as current law (the plan's default);
   - (b) current law = FZP + §207.11, with SB 79 "as written" as a separate stock layer users can toggle (the comparison twin then reads "versus the City's actual rules");
   - (c) ship both and let the twin choose.

   This changes the `planEffect` baseline and the pitch of the default view.
2. **SB 79 density.** The statute's Table 1 sets permitted densities (160/120/100 du/ac for tier 1, 140/100/80 for tier 2), and the State Density Bonus Law builds on them. The spec's call treats SB 79 lots as form-based (no cap), "since SB 79 sets density minimums, not maximums". The plan follows the spec and reports `policy.sb79.density_would_bind` so the effect is visible. Should the layer cap at the statute's du/ac instead?
3. **Local exemptions in the SB 79 layer.** Ord. 082-26's permanent exemptions (M, SALI, PDR, WMUO and P zones, and sites over a 1-mile walk from a stop) and its temporary low-resource exemptions are parcel tables in Board File 260132, not on DataSF. The plan's SB 79 layer is the statute "as written": it records `sfPermanentExempt` by zone but does not apply it, and does not model the low-resource exemption. Should the SB 79 stock layer apply the City's exemptions? If so, should we source the Board File tables (a new, non-DataSF source)?
4. **Which historic codes protect?** `3tsw-4idn` has A (CEQA historical resource, 21,931), A* (Article 10/11 listed or in an Article 10/11 district, 2,551), B (status unknown, mostly "45 years or older", 119,301) and C (19,505). The plan ships the raw code. Plan 2 needs to know whether "historic buildings" means A* only, A and A*, or also B.
5. **"Commercial corridors."** DataSF's street classes are freeway, major, arterial, collector, residential, ramp and other. "Commercial corridor" is not a street class. Should plan 3 compose it from street + NC/NCT zoning on fronting lots, or should we find a source (for example Planning's NCD boundaries)?
6. **TOD stop source.** The spec says SB 79 is "generated by us from its rules and `transit.json` stops". If MTC publishes its official SB 79 TOD stop/tier map as open data (Task 1 checks), it is a higher evidence tier than our classification of GTFS modes. Should it replace our tiering, or only cross-check it?
