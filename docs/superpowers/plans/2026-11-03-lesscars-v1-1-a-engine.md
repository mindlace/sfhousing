# /lesscars v1.1 Plan A of 2: Freeway Land Engine and the Draft for Owner Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every mechanism v1.1 needs exists and is tested on the mini fixture and synthetic plans: freeway land is unbuildable in every simulator run while its freeway stands, a removal frees its parcels as freed land, a garage may stand on unfreed freeway land, removed freeways leave the basemap on their removal day, the build reports what the rule takes from `/sim` and FZP, and the dated v1.1 section of `docs/lesscars/plan-v1.md` is drafted for the owner. Plan B wires the approved section in.

**Architecture:** One curated catalog, `pipeline/enrichment/lesscars/freeway-land.json`, lists every SF freeway segment and its freeway-land parcels. The scenario step reads it and marks those rows scenario-ineligible, the same lever the land mask uses for underwater lots (`pipeline/lib/scenario-eligibility.ts:14-20`), so `parcels.bin`, `policy.bin`, the levers and both /lesscars arms all see unbuildable land and the Paint editor's chunk records do not change. A `highway-truncation` gains an optional `freewayLand` parcel list; the carve (`84_lesscars_sites.sql`) turns those parcels into freed sites (`lc:` ids, never parcel rows), so a parcel row never builds and a freed site never counts twice. Basemap hiding goes by a curated id list per removal phase, checked against the dataset's `basemap.pmtiles`; Task 1 decides whether the page can filter by id or the tiles step must split the removed stretches into their own source layer.

**Tech Stack:** TypeScript, Vitest (server, client, pipeline projects), DuckDB spatial (`@duckdb/node-api`), `pmtiles` + `@mapbox/vector-tile` + `pbf` (already used by `pipeline/sources/land.ts`), tsx, SvelteKit 2 + Svelte 5 runes, MapLibre GL 6, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-11-03-lesscars-v1-1-design.md` (binding; amends `docs/superpowers/specs/2026-11-01-lesscars-design.md` and `docs/lesscars/plan-v1.md`). Implementation docs: `docs/dev/lesscars.md`, `docs/dev/pipeline.md`, `docs/dev/sim-page.md`, `docs/dev/fzp-mode.md`. Models for shape: `docs/superpowers/plans/2026-11-01-lesscars-{1-pipeline,2-page,3-plan-content}.md`.

## Global Constraints

- The spec is binding: a value it fixes (8,000 sq ft / 743.2 m² and 65 ft from `pipeline/lib/local-program.ts:9-11`, the 60 m candidate band, "at least half within", PV-hwy 30 months, footprint × 5 levels ÷ 30 m² per space) is used as written.
- **Never demolish homes.** A freeway-land parcel, a freed parcel and a garage parcel hold 0 homes in `parcels.bin`; the build refuses any other (Tasks 2, 3).
- **Never free a real park.** A named open space, playground, community garden, school, rail yard or Port facility is an exclusion with a reason, never freeway land (Task 9 curates; the candidate rule only proposes).
- **Never count homes twice.** A parcel the plan frees is scenario-ineligible in `parcels.bin` in both arms; its homes come only from its freed site (Tasks 2-4).
- Plan A changes no live number: the live catalog, basemap id list and plan changes are Plan B's. With no live `freeway-land.json` the scenario step applies no freeway rule, so a live build from this plan's code differs from today's only by the `datasetVersion` hash.
- New code must read the current published dataset (`2026-11-02-39fbf039`) unchanged: every new key in `plan.json`, `sites.json`, `summary.json` and the manifest is optional, and staging runs the merged code on the old dataset until Plan B's staging bump.
- `fixture-0` and `pipeline/test/fixtures/mini/golden/` change only through `npm run pipeline -- fixture --update-golden`; mini raw sources only through `npx tsx pipeline/test/fixtures/mini/make-fixture.ts`. Never hand-edit either, nor a migration.
- JSON under `pipeline/enrichment/` and `pipeline/test/fixtures/mini/enrichment/` is prettier-checked: run `npx prettier --write <file>` on every authored or generated JSON file.
- Tests: Vitest with `expect.requireAssertions` (every test calls `expect`); e2e in both Playwright projects (`chromium`, `mobile` 375 px) on `fixture-0`, every expected value read from fixture-0 on disk.
- CSP (`kit.csp` in `svelte.config.js`) is unchanged; a change would be an interface change to raise, not make.
- No new runtime dependency in the bundle. A pipeline-only devDependency (Task 7b) needs no `SOFTWARE` credit.
- WCAG 2.2 AA (`docs/dev/accessibility.md`): new page text passes `expectNoA11yViolations` in light and dark.
- Code style: 2-space indent, single quotes, no trailing commas, 100 columns. Conventional Commits. No Claude attribution anywhere (no `Co-Authored-By`, no generated-with footers, no session links). Multi-line commit messages through a temp file and `git commit -F <file>`, never heredocs. Never compound `cd … && cmd`. Never bare `git stash`.
- Finishing is `npm run signoff` (never `git push` first); Plan B owns the PRs. This plan commits on `feat/lesscars-v1-1` only.

## Review Focus

1. **A freed parcel counted twice.** A plan lists a parcel in `freewayLand` that the catalog does not mark unbuildable: the baseline builds on the row and the plan builds a freed site on the same land. Expected: the build fails naming the parcel, and V35 fails a published plan whose freed parcels are eligible in `parcels.bin`. Test: Task 3 (`a freewayLand parcel outside the catalog fails as counted twice`), Task 4 (`V35 fails when a freed parcel row is scenario-eligible`).
2. **A kept freeway erased at low zoom.** At z11-13 the basemap merges US-101 into lines that cross the Alemany cut (measured while drafting this plan: feature `35184377160410` spans lat 37.708-37.767 at z11 to z13; at z14-15 no US-101 feature crosses it). Hiding by id there would erase US-101 south of Alemany. Expected: Task 1's report names those zooms and the page never hides a kept stretch nor keeps a removed one. Test: Task 1 (`a merged line across the cut is mixed`), Task 7b (`a merged line is clipped at the corridor: the kept part stays in roads`).
3. **Homes on a garage.** A garage stands on a removal phase's freeway-land parcel; the carve makes that parcel a freed site, and an unguarded `initiativeBuilds` would build homes on the garage. Expected: the held site gets no build, is not counted as zero-yield, and its would-be homes are reported as the garage's cost. Test: Task 4 (`a site held by a garage gets no build and its homes are the garage's cost`).
4. **The old dataset on the new code.** Staging serves the merged code against `2026-11-02-39fbf039` until Plan B's staging bump. Expected: `parsePlanFile`, `parseSitesFile` and `parseSummary` accept files without the new keys and the page renders as today. Test: Task 4 (`the v1 sites and summary files still parse`), Task 7a/7b (`a plan file with no basemap ids hides nothing`).
5. **A multipart freed parcel.** A clipped or multipart freeway-land parcel becomes a MultiPolygon site; `siteFeatures` draws `outline` as one Polygon, so a second part would draw as a hole. Expected: each polygon part is its own site, with its own `parcelM2`. Test: Task 4 (`a two-part freed parcel becomes two sites`).

Also pinned: a basemap rebuild that renumbers ids fails the build (Task 6 `an id missing from basemap.pmtiles fails the build`); a theme switch keeps the hide filters (Task 7a/7b `the filter survives a theme switch`); a catalog parcel with homes fails the build (Task 2).

---

## Decisions (builder's calls; the owner may revisit any)

- **Freeway land is scenario eligibility, not the chunk record.** `scenarioEligible(rec, units, freewayLand)` returns false for a catalog parcel, beside the underwater rule. Reason: `parcels.bin`'s `eligible` already feeds `hostable` (`pipeline/steps/scenario.ts:718-800`), SB 79 in `policy.bin` (`pipeline/steps/policy.ts:400,435,451`), the levers (`src/lib/sim/levers/recompute.ts:78`) and the /lesscars regimes (`pipeline/lib/lesscars/regimes.ts:196`), so one flag covers `/sim`, FZP and both arms, and the Paint editor (chunk records) is untouched, as the spec's list of runs implies.
- **The rule applies to today's rows (T11), not the calibration panel.** The T13 panel (`scenario.ts:161`) keeps `scenarioEligible(rec, units)` without the catalog. Reason: calibration describes the past market; leaving it unchanged keeps `calibration.json` byte-identical, so the delta report isolates the rule.
- **One catalog file for kept and removed freeways.** `freeway-land.json` holds every segment (CNNs, `removedBy`, curated parcels, exclusions with reasons); the candidate command reads its segments and writes `freeway-land.candidates.json`, never the catalog. Reason: the catalog is the source of truth (spec "The curated list is the source of truth, not the rule").
- **The delta report is static net capacity.** Counts `scenario.freeway_land.lots`, `scenario.freeway_land.net_removed` and `scenario.freeway_land.net_removed.<freeway>`: over catalog rows the rule turns unhostable, Σ max(0, FZP full-fill yield − existing homes), the measure of `/sim`'s `netCapacity` (`src/lib/sim/levers/resolve.ts:186-193`). Reason: deterministic, in-build, by freeway; Plan B adds the simulated before/after.
- **A check run outside a build reads the current catalog.** `check [<v>]` passes the catalog of the version's kind to V17. Reason: V17 compares `eligible` with `scenarioEligible`, which now needs the set; an older out dir checked against a newer catalog can fail, and the docs say so.
- **Freed parcels become freed sites.** Each `freewayLand` parcel is one site with its own boundary (each polygon part, if multipart); a carved right-of-way piece touching a non-held freed parcel of the same project merges into the parcel it shares the most boundary with (smaller id on a tie); pieces touching none stay v1 pieces. ROW pieces never overlap freed parcels (the carve subtracts them) and freed parcels get no access strip. Site ids stay `lc:<project>:<k>`: parcel sites first by smallest parcel id, then v1 pieces in v1 order, so a project with no freed parcels numbers as today. The spec leaves the combination to the builder ("as long as one piece of land is never counted twice").
- **A freed site's neighbours exclude freeway land.** Catalog parcels and freed parcels are never a freed site's zoning neighbour. Reason: the spec's zoning is "the adjacent zoning", the city around the freeway, not the P zoning of the freeway land itself.
- **A garage on a phase's land holds that site.** A garage `{ parcel }` may also be in one truncation's `freewayLand` (`checkPlan` allows exactly that overlap); the carve marks the site `heldBy` the garage, `initiativeBuilds` skips it, and `summary.garageCost` reports its would-be homes at the phase's build start. A carved piece never merges into a held site. Reason: spec "That part never gets homes. The breakdown reports the homes the garage footprint costs."
- **No new plan check code for the garage exception.** A garage `{ parcel }` on catalog freeway land passes (it holds 0 homes); a parking conversion on catalog freeway land fails (`parcel`). That is the spec's "accepts this only for garage projects".
- **Phases name freeway CNNs.** Task 9 writes each phase's geometry as `{ cnn }` lists of `src_streets` FREEWAYS-layer segments, not a drawn line, and the v1 stub's line is kept only if the owner prefers it. Reason: a drawn line leaves the freeway's own centrelines "kept", and their `keepHalfM` corridors erase the strip (`84_lesscars_sites.sql:22-23,87-97`); see Open questions.
- **Basemap mechanism follows Task 1.** Verdict `ids`: Task 7a filters the protomaps `roads` layers by id per day. Verdict `split`: Task 7b, the spec's fallback, moves the removed stretches into source layer `roads_lc` at build time. Exactly one of 7a and 7b runs.
- **Every `roads` layer is filtered, not just highways.** The id filter (7a) and the clones (7b) cover every protomaps layer with `source-layer: 'roads'` (roads_shields has an icon and is already dropped, `src/lib/map/style.ts:176-180`). Reason: a removed ramp tagged as a major road must go too, and the fixture's test feature is a plain street.
- **Freed-land disclosure is land area.** The details panel says how many hectares of freed land came from freeway-land parcels and how many from right-of-way, from `sites.json`. Reason: per-site homes live only in the worker's timeline; area is on the main thread.
- **Mini lot 19.** The mini fixture gains `3512019`, zoned P, VACANT, 0 homes, x[-40, 40] y[62, 72] (800 m², over 743.2), under the fixture I-80 band, so the golden exercises the rule and a freed parcel merged with a ROW piece. The large-lot lift is not exercised by the fixture (every mini R-4 district already allows 65 ft or more); `localProgramEnvelope`'s own tests cover it.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `pipeline/lib/lesscars/basemap-roads.ts` (+ `pipeline/test/lesscars-basemap-roads.test.ts`) | decode `roads` features near lines per zoom; id verdict; ids-present check | 1, 6 |
| `pipeline/steps/lesscars-basemap.ts`, `pipeline/cli.ts` | `lesscars-basemap` command (`--report`, candidates) | 1, 6 |
| `pipeline/lib/lesscars/freeway-land.ts` (+ `pipeline/test/lesscars-freeway-land.test.ts`) | catalog format, parser, parcel set | 2 |
| `pipeline/lib/scenario-eligibility.ts`, `pipeline/steps/scenario.ts`, `pipeline/steps/check.ts`, `pipeline/steps/build.ts`, `pipeline/lesscars-config.ts` | the unbuildable rule, delta counts, V17 | 2 |
| `pipeline/test/fixtures/mini/make-fixture.ts`, `README.md`, `enrichment/lesscars-freeway-land.json`, `enrichment/lesscars-plan.json` | lot 19, fixture catalog, mini plan `freewayLand` | 2, 4 |
| `src/lib/data/lesscars/plan.ts`, `schedule.ts` (+ tests) | `freewayLand`; site keys and the garage overlap | 3 |
| `pipeline/steps/lesscars.ts`, `pipeline/steps/check-lesscars.ts` (+ `lesscars-step.test.ts`) | dataset checks, V35 | 3, 4, 6 |
| `pipeline/sql/84_lesscars_sites.sql`, `pipeline/steps/lesscars-sql.ts`, `pipeline/lib/lesscars/sites.ts`, `runs.ts` (+ tests) | freed parcels, held sites, garage cost | 4 |
| `src/lib/data/lesscars/codec.ts` (+ test) | optional `parcels`, `parcelM2`, `heldBy`, `garageCost`, `basemapHide` | 4, 7a |
| `pipeline/steps/lesscars-freeway-land.ts`, `pipeline/lib/lesscars/streets.ts` | candidate command; locked-streets loader shared with `lesscars-cnns` | 5 |
| `pipeline/lib/lesscars/basemap-ids.ts` | `basemap-ids.json` format | 6 |
| `src/lib/map/filter-expr.ts`, `src/lib/lesscars/basemap-hide.ts` (+ specs), `LessCarsMode.svelte` | per-day id filter (7a) or clone filter (7b) | 7a / 7b |
| `pipeline/lib/pmtiles-rewrite.ts`, `pipeline/lib/lesscars/basemap-split.ts`, `pipeline/steps/tiles.ts`, `src/lib/map/style.ts` | the tiles-step split and style clones | 7b |
| `src/lib/lesscars/features.ts`, `summary-view.ts`, `copy.ts`, `DetailsPanel.svelte`, `e2e/lesscars.spec.ts` | held sites, freed-land disclosure, garage cost | 8 |
| `docs/dev/lesscars.md`, `docs/dev/pipeline.md`, `CLAUDE.md` | docs for each change | each |
| `pipeline/enrichment/lesscars/freeway-land.json` (segments only), `freeway-land.candidates.json`, `basemap-ids.candidates.json`, `docs/lesscars/plan-v1.md` | the draft for owner review | 9 |

---

### Task 1: Can the basemap's removed stretches be picked out by id?

The spec's first check. The result decides Task 7a or 7b.

**Files:**
- Create: `pipeline/lib/lesscars/basemap-roads.ts`, `pipeline/steps/lesscars-basemap.ts`
- Modify: `pipeline/cli.ts:193-196` (new entry beside `lesscars-cnns`)
- Test: `pipeline/test/lesscars-basemap-roads.test.ts`
- Modify: `docs/dev/lesscars.md` (new section "Basemap ids")

**Interfaces:**
- Consumes: `NodeFileSource` (`pipeline/lib/pmtiles-file.ts:5`); `PMTiles`, `VectorTile`, `Pbf` as `pipeline/sources/land.ts:1-3,111-140` uses them; SimMap's zoom range 11-18 (`src/lib/map/camera.ts:6-7`), basemap maxzoom 15.
- Produces:

```ts
// pipeline/lib/lesscars/basemap-roads.ts
export const BASEMAP_ZOOMS = [11, 12, 13, 14, 15] as const;
export interface RoadPiece {
  id: number; // the feature id as the tile stores it (OSM-derived, up to ~3.6e13)
  z: number;
  kind: string; // protomaps `kind`: highway, major_road, …
  isLink: boolean;
  ref: string | null;
  name: string | null;
  /** Length of the feature with this id at this zoom over every tile of the archive, m. */
  lengthM: number;
  /** Of that, the length within bandM of the lines, m. */
  inBandM: number;
}
/** Features of the `roads` layer coming within bandM of `lines` ([lng, lat]), per zoom. */
export function roadsNear(a: {
  pmtiles: string;
  lines: [number, number][][];
  bandM: number;
  zooms?: readonly number[]; // default BASEMAP_ZOOMS
}): Promise<RoadPiece[]>;
export interface ZoomVerdict { z: number; ok: boolean; mixed: RoadPiece[] }
/** Per zoom: ok when no `highway` piece has an in-band share in [lo, hi) (defaults 0.1, 0.9). */
export function idVerdict(pieces: readonly RoadPiece[], lo?: number, hi?: number): ZoomVerdict[];
```

```ts
// pipeline/steps/lesscars-basemap.ts
export async function lesscarsBasemap(a: {
  mode: 'report' | 'candidates'; // 'candidates' is Task 6
  pmtiles: string;
  linesPath?: string; // GeoJSON FeatureCollection of LineStrings, report mode
  bandM?: number; // default LC.basemapBandM
}): Promise<number>; // exit code
```

`roadsNear` builder's calls: two passes per zoom (tiles meeting the lines' bbox plus `bandM` give the candidate ids; then every tile of the zoom in the header bounds sums those ids' full lengths, so a merged line's length outside the bbox counts); lengths are measured on the decoded lng/lat with an equirectangular projection at the lines' mean latitude, sampling each segment every 5 m against the lines' distance. CLI: `lesscars-basemap [--report --lines <file>] [--band <m>]`, help `inspect or propose the basemap road ids of the /lesscars freeway removals`; the archive is `pipeline/out/<newest>/basemap.pmtiles` unless `--pmtiles <file>`.

- [ ] **Step 1: Write the failing tests**

Synthetic archives are not needed: the tests feed `idVerdict` pieces directly and run `roadsNear` on the mini fixture's committed basemap (`pipeline/test/fixtures/mini/raw/`, the `protomaps-basemap` lock entry).

```ts
it('a merged line across the cut is mixed; a line wholly inside or outside is not', () => {
  const v = idVerdict([
    piece({ id: 1, z: 11, kind: 'highway', lengthM: 6000, inBandM: 3000 }),
    piece({ id: 2, z: 14, kind: 'highway', lengthM: 800, inBandM: 800 }),
    piece({ id: 3, z: 14, kind: 'highway', lengthM: 500, inBandM: 10 })
  ]);
  expect(v.find((x) => x.z === 11)).toMatchObject({ ok: false, mixed: [expect.objectContaining({ id: 1 })] });
  expect(v.find((x) => x.z === 14)?.ok).toBe(true);
});
it('a mixed street does not fail the verdict; only highways do', () => {
  expect(idVerdict([piece({ z: 12, kind: 'major_road', lengthM: 100, inBandM: 50 })])[0].ok).toBe(true);
});
it('roadsNear finds the fixture street under the mini I-80 at every zoom the extract has', async () => {
  // the mini I-80 (src_streets 4000) runs y = 75 m from O = (-122.4195, 37.7600), on a real street
  const pieces = await roadsNear({ pmtiles: MINI_BASEMAP, lines: [MINI_I80_LNGLAT], bandM: 15 });
  expect(pieces.length).toBeGreaterThan(0);
  for (const p of pieces) {
    expect(p.inBandM).toBeLessThanOrEqual(p.lengthM + 1e-6);
    expect(Number.isSafeInteger(p.id)).toBe(true);
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project pipeline pipeline/test/lesscars-basemap-roads.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `roadsNear`, `idVerdict`, `lesscarsBasemap` report mode and the CLI entry**

Report mode prints one line per zoom: `z<z>: <n> highway ids, <m> mixed` and each mixed piece as `  <id> <ref|name> <inBandM>/<lengthM> m`, then `verdict: ids` when every zoom is ok, else `verdict: split (zooms <list>)`. Exit 0 either way (it is a report).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest --run --project pipeline pipeline/test/lesscars-basemap-roads.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the check on the real basemap**

Build the provisional removed lines in the scratchpad (not committed): from the locked `datasf-streets` raw files (as `lesscarsCnns` normalises them, `pipeline/steps/lesscars-cnns.ts:107-130`), every `layer = 'FREEWAYS'` segment whose `streetname` starts `HWY 101` with every vertex north of lat 37.7335 (the Alemany interchange) and every `I-80` segment with every vertex west of lng -122.3925 (the Rincon Hill touchdown), in EPSG:4326, as a GeoJSON FeatureCollection. The scratch DuckDB at `/private/tmp/claude-501/-Users-mindlace-Projects-sfhousing/cbd9459b-a89f-4e8e-be76-c01cdaf2d559/scratchpad/hwy/hwy.duckdb` (table `st`, EPSG:7131) holds these streets already.

Run: `npm run pipeline -- lesscars-basemap --report --lines <scratch>/removed.geojson --pmtiles pipeline/out/2026-11-02-39fbf039/basemap.pmtiles`
Expected (from the probe while drafting): ids present at every zoom; US-101 mixed at z11, z12, z13 (`35184377160410` and its neighbours), so `verdict: split (zooms 11,12,13)`. Whatever it prints is the verdict; record it.

- [ ] **Step 6: Record the verdict and commit**

`docs/dev/lesscars.md` "Basemap ids": the command, the provisional lines' rule, the per-zoom table, the verdict, the mixed zooms and which of Task 7a or 7b runs. Task 5 sets `LC.basemapClipZooms` to these mixed zooms.

```bash
git add pipeline/lib/lesscars/basemap-roads.ts pipeline/steps/lesscars-basemap.ts pipeline/cli.ts pipeline/test/lesscars-basemap-roads.test.ts docs/dev/lesscars.md
git commit -m "feat(lesscars): basemap road id report for the freeway removals"
```

**Stop and report** the verdict to the controller before Task 6.

---

### Task 2: Freeway land is unbuildable while its freeway stands

**Files:**
- Create: `pipeline/lib/lesscars/freeway-land.ts`, `pipeline/test/lesscars-freeway-land.test.ts`, `pipeline/test/fixtures/mini/enrichment/lesscars-freeway-land.json`
- Modify: `pipeline/lib/scenario-eligibility.ts:14-20`, `pipeline/steps/scenario.ts:482-491` (args), `:718` (rule), the counts block `:610-631`, the provenance text near `:342-396`
- Modify: `pipeline/steps/check.ts:38-60` (`CheckExtras`), `:676-690` (V17), `pipeline/cli.ts:110-123` (`check`), `pipeline/steps/build.ts:210-221` (scenario args), `:339-348` (check args)
- Modify: `pipeline/lesscars-config.ts:46-52` (catalog paths)
- Modify: `pipeline/test/fixtures/mini/make-fixture.ts`, `pipeline/test/fixtures/mini/README.md` (lot 19)
- Test: `pipeline/test/scenario-quality.test.ts:1814-1820` (`scenarioEligible`), `pipeline/test/lesscars-freeway-land.test.ts`
- Regenerate: `pipeline/test/fixtures/mini/raw/`, `sources.lock.json`, golden, `e2e/fixtures/data/fixture-0/`
- Modify: `docs/dev/pipeline.md` (a "Freeway land" paragraph after "Land mask"), `docs/dev/lesscars.md`, `docs/dev/sim-page.md` and `docs/dev/fzp-mode.md` (one line each: freeway land never builds)

**Interfaces:**
- Consumes: `ParcelId` (`src/lib/data/parcel.ts`), `scenarioEligible` (`pipeline/lib/scenario-eligibility.ts:14`).
- Produces:

```ts
// pipeline/lib/lesscars/freeway-land.ts
export interface FreewaySegment {
  id: string; // e.g. 'us101-james-lick'
  freeway: string; // 'US-101' | 'I-80' | 'I-280' (free text; the count key lower-cases it)
  label: string;
  ref: string | null; // the basemap `ref` token, e.g. 'US 101'
  cnn: string[]; // src_streets FREEWAYS-layer CNNs of the segment
  /** The highway-truncation that removes it; null for a freeway that stays. */
  removedBy: string | null;
  /** 'hand': every parcel checked by hand; 'rule': candidates accepted after a spot check. */
  curated: 'hand' | 'rule';
  parcels: ParcelId[]; // sorted, unique
  excluded: { parcel: ParcelId; reason: string }[];
}
export interface FreewayLandFile { schema: 1; segments: FreewaySegment[] }
/** Throws naming the first bad field; a parcel in two segments, or both listed and excluded, fails. */
export function parseFreewayLand(json: unknown): FreewayLandFile;
/** Every catalog parcel; empty when the file does not exist. */
export function readFreewayLandSet(path: string): ReadonlySet<ParcelId>;
export function readFreewayLand(path: string): FreewayLandFile | null;

// pipeline/lesscars-config.ts
export const LESSCARS_FREEWAY_LAND_JSON: { live: string; fixture: string };
// live: pipeline/enrichment/lesscars/freeway-land.json; fixture: test/fixtures/mini/enrichment/lesscars-freeway-land.json

// pipeline/lib/scenario-eligibility.ts
export function scenarioEligible(
  rec: Pick<ParcelRecord, 'eligible' | 'landUse' | 'underwater'>,
  existingUnits: number,
  freewayLand?: boolean // true: unbuildable while its freeway stands
): boolean;

// writeScenario gains `freewayLand?: FreewayLandFile | null` (absent or null: no rule).
// CheckExtras gains `freewayLand?: ReadonlySet<ParcelId>`.
```

Counts (always present, 0 without a catalog): `scenario.freeway_land.lots` (catalog rows in parcels.bin), `scenario.freeway_land.net_removed`, and `scenario.freeway_land.net_removed.<freeway lower-cased>` per segment freeway. A row counts toward `net_removed` when the rule changed it: `scenarioEligible` without the flag is true, the FZP envelope is at least 1 story and the uncapped full-fill yield is above 0 (the `hostable` test at `scenario.ts:799` without the rule); it adds max(0, `yield` full fill − existing). writeScenario throws `scenario: freeway-land parcel <id> has <n> existing homes` for a catalog parcel with homes, and warns `scenario: freeway-land parcel(s) <ids> are not in parcels.bin` for missing ones. One warning line names the totals: `scenario: freeway land makes <lots> lots unbuildable, <net> net homes of static capacity (<freeway> <n>, …)`.

Mini lot 19 (`make-fixture.ts`, and a README Lots row): `3512019`, one parcel row x[-40, 40] y[62, 72] (local metres), Mission; land use VACANT 0 units; zoning P; height district `40//65-R-4` (it lies in x[-60, 44)); roll `MISC/V` built empty, 0 st, 0 u, 0 sf, 100k/0, 2025+2024 (as lot 7); historic `C`. Its README "exercises" cell: `freeway land: unbuildable in every run; freed by hwy as one site with the I-80 ROW piece it touches (Task 4)`. The README derived row counts (`src_parcels`, `src_landuse`, `src_parcel_attrs`, `src_roll`, `src_historic`) each gain one.

Fixture catalog `lesscars-freeway-land.json`: one segment `{ id: 'fx-i80', freeway: 'I-80', label: 'Fixture I-80', ref: null, cnn: ['4000'], removedBy: 'hwy', curated: 'hand', parcels: ['3512019'], excluded: [{ parcel: '3512018', reason: '2 homes: freeway land holds none' }] }`.

- [ ] **Step 1: Write the failing tests**

```ts
// scenario-quality.test.ts, in describe('scenarioEligible')
it('freeway land is never eligible, whatever its land use or roll', () => {
  expect(scenarioEligible({ eligible: true, landUse: 'VACANT' }, 0, true)).toBe(false);
  expect(scenarioEligible({ eligible: true, landUse: 'VACANT' }, 0)).toBe(true);
});
// lesscars-freeway-land.test.ts
it('parses the fixture catalog and gives its parcel set', () => {
  expect([...readFreewayLandSet(LESSCARS_FREEWAY_LAND_JSON.fixture)]).toEqual(['3512019']);
});
it('a missing catalog is an empty set', () => {
  expect(readFreewayLandSet('/nonexistent/freeway-land.json').size).toBe(0);
});
it('rejects a parcel in two segments, a parcel both listed and excluded, an empty reason', () => {
  expect(() => parseFreewayLand(twoSegments)).toThrow(/3512019.*two segments|twice/);
  expect(() => parseFreewayLand(listedAndExcluded)).toThrow(/3512019.*excluded/);
  expect(() => parseFreewayLand(noReason)).toThrow(/excluded\.0\.reason/);
});
it('the mini build marks lot 19 unbuildable and reports what it removed', async () => {
  // lesscarsMini() (pipeline/test/lesscars-helpers.ts) after this task passes the fixture catalog
  const i = mini.parcels.index.get('3512019')!;
  expect(mini.parcels.eligible[i]).toBe(0);
  expect(mini.parcels.hostable[i]).toBe(0);
  expect(mini.counts['scenario.freeway_land.lots']).toBe(1);
  expect(mini.counts['scenario.freeway_land.net_removed']).toBeGreaterThan(0);
  expect(mini.counts['scenario.freeway_land.net_removed.i-80']).toBe(mini.counts['scenario.freeway_land.net_removed']);
});
it('a catalog parcel with homes fails the scenario step', async () => {
  await expect(scenarioWithCatalog(['3512018'])).rejects.toThrow(/3512018 has 2 existing homes/);
});
it('V17 accepts a catalog row the rule made ineligible and fails it without the catalog', async () => {
  expect(v17(fixtureOut, { freewayLand: new Set(['3512019']) }).ok).toBe(true);
  expect(v17(fixtureOut, { freewayLand: new Set() }).detail).toMatch(/1 eligible flag/);
});
```

`lesscarsMini` returns the build counts it already has from `writeScenario`/`writePolicy` (add `counts` to `LessCarsMini` if absent). Existing tests that count the mini's lots (grep `pipeline/test` for `18` lot counts, `parcels.emitted`, `src_parcels`) are updated to the new count with the lot named in the assertion message.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project pipeline pipeline/test/lesscars-freeway-land.test.ts pipeline/test/scenario-quality.test.ts`
Expected: FAIL (module missing; third parameter ignored).

- [ ] **Step 3: Implement the catalog, the rule, the counts, V17 and the build wiring**

`build.ts` passes `readFreewayLand(LESSCARS_FREEWAY_LAND_JSON[fixtureMode ? 'fixture' : 'live'])` to `writeScenario` and its parcel set to `checkDataset`; `cli.ts check` reads the set for the version's kind. The panel call (`scenario.ts:161`) is unchanged. The parcels.bin provenance method (`scenario.ts:394-396`) adds: `Freeway land (pipeline/enrichment/lesscars/freeway-land.json: vacant or public parcels under or fronting a freeway, curated) is ineligible while its freeway stands.`

- [ ] **Step 4: Add lot 19 and regenerate the mini sources**

Run: `npx tsx pipeline/test/fixtures/mini/make-fixture.ts`, then `git diff --stat pipeline/test/fixtures/mini/`
Expected: raw parcel, land use, attrs, roll and historic files and `sources.lock.json` change; no other raw file.

- [ ] **Step 5: Run the tests to verify they pass, then regenerate the goldens**

Run: `npx vitest --run --project pipeline pipeline/test/lesscars-freeway-land.test.ts pipeline/test/scenario-quality.test.ts`, then `npm run pipeline -- fixture --update-golden`, then `npm run test:pipeline`
Expected: PASS. The golden diff: lot 19 in chunks, `parcels.decoded.json` (eligible 0, hostable 0), `policy.decoded.json`, `report.json` counts (`scenario.freeway_land.*`, parcel counts), the lesscars files only where lot 19 is a neighbour or reached. `calibration.json` and `calibration-report.md` unchanged (the panel is untouched); a change there means the panel picked up the rule: fix it.

- [ ] **Step 6: Run the unit and e2e suites on the regenerated fixture**

Run: `npm run test:unit`, then `SFH_E2E_PORT=4207 SFH_E2E_WORKERS=1 npx playwright test`
Expected: PASS (every e2e value is read from fixture-0 on disk).

- [ ] **Step 7: Docs and commit**

`docs/dev/pipeline.md` "Freeway land": the catalog, the rule (T11 only, not the panel), the counts, the homes check, and that `check` on an older out dir reads today's catalog. `docs/dev/lesscars.md`: the rule applies to both arms. `docs/dev/sim-page.md`, `docs/dev/fzp-mode.md`: freeway land never builds on `/sim` or FZP; nothing new is drawn.

```bash
git add pipeline docs/dev e2e/fixtures/data/fixture-0
git commit -m "feat(lesscars): freeway land is unbuildable in every simulator run"
```

---

### Task 3: `freewayLand` in the plan and its checks

**Files:**
- Modify: `src/lib/data/lesscars/plan.ts:94-99` (truncation type), `:297-313` (`parseProject`)
- Modify: `src/lib/data/lesscars/schedule.ts:132-137` (`siteKeys`), `:246-252` (site loop)
- Modify: `pipeline/steps/lesscars.ts:137-206` (`dataProblems`), `:293-301` (args), `:308-320`
- Modify: `pipeline/steps/build.ts:281-291` (pass the catalog set)
- Test: `src/lib/data/lesscars/plan.test.ts`, `src/lib/data/lesscars/schedule.test.ts`, `pipeline/test/lesscars-step.test.ts`
- Modify: `docs/dev/lesscars.md` ("The plan format", "Checks")

**Interfaces:**
- Consumes: `readFreewayLandSet`, `LESSCARS_FREEWAY_LAND_JSON` (Task 2).
- Produces:

```ts
// plan.ts: the truncation variant gains an optional key (absent from the object when omitted)
freewayLand?: { parcels: ParcelId[]; excluded: { parcel: ParcelId; reason: string }[] };
// only on 'highway-truncation'; any other kind with the key fails as `unknown key`

// writeLessCars gains `freewayLand: ReadonlySet<ParcelId>` (the catalog's parcels)
```

Rules:
- `checkPlan` `site-reused`: a parcel appears at most once across parking conversions, garages `{ parcel }` and every truncation's `freewayLand.parcels`, except that one garage may share its parcel with one truncation's `freewayLand` (the garage stands on that phase's land). Message as today: `${p.id} reuses site parcel:<id>`.
- `dataProblems` (field `freewayLand` unless stated): every `freewayLand` parcel is in parcels.bin (`parcel <id> is not in parcels.bin`), has 0 homes (`parcel <id> has <n> existing homes; the plan takes none`) and is in the catalog (`parcel <id> is not freeway land in freeway-land.json; freeing it would count its homes twice`); every `excluded` parcel is in parcels.bin; a parking conversion on a catalog parcel fails (field `parcel`: `parcel <id> is freeway land; only a garage may stand on it`). A garage `{ parcel }` on catalog land passes.

- [ ] **Step 1: Write the failing tests**

```ts
// plan.test.ts
it('freewayLand parses on a truncation and is absent when omitted', () => {
  expect(parseLessCarsPlan(withFreewayLand).projects[6]).toMatchObject({ freewayLand: { parcels: ['3512019'], excluded: [] } });
  expect('freewayLand' in parseLessCarsPlan(tiny).projects.find((p) => p.kind === 'highway-truncation')!).toBe(false);
});
it('freewayLand on a street removal is an unknown key; an empty reason fails', () => {
  expect(() => parseLessCarsPlan(onRemoval)).toThrow(/projects\.\d+\.freewayLand: unknown key/);
  expect(() => parseLessCarsPlan(emptyReason)).toThrow(/freewayLand\.excluded\.0\.reason/);
});
// schedule.test.ts
it('a parcel freed by two truncations, or freed and converted, is site-reused', () => {
  expect(codes(check(twoPhasesOneParcel))).toContain('hwy2:site-reused');
  expect(codes(check(freedAndParking))).toContain('parking:site-reused');
});
it('a garage may stand on one truncation’s freeway land; two garages on it may not', () => {
  expect(codes(check(garageOnPhaseLand))).not.toContain('garage:site-reused');
  expect(codes(check(twoGaragesOnPhaseLand))).toContain('garage2:site-reused');
});
// lesscars-step.test.ts (mini data; plans built from miniLessCarsPlan())
it('a freewayLand parcel outside the catalog fails as counted twice', async () => {
  await expect(step(withFreed('3512017'), { freewayLand: new Set(['3512019']) })).rejects.toThrow(/hwy\.freewayLand: parcel 3512017 is not freeway land/);
});
it('a freewayLand parcel with homes fails', async () => {
  await expect(step(withFreed('3512018'), { freewayLand: new Set(['3512018']) })).rejects.toThrow(/parcel 3512018 has 2 existing homes/);
});
it('a parking conversion on freeway land fails; a garage there passes', async () => {
  await expect(step(parkingOn('3512019'), catalog)).rejects.toThrow(/parking\.parcel: parcel 3512019 is freeway land/);
  await expect(step(garageOn('3512019'), catalog)).resolves.toMatchObject({ written: true });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project server src/lib/data/lesscars`, `npx vitest --run --project pipeline pipeline/test/lesscars-step.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the key, the site keys and the dataset checks**

`parseProject` passes `['opensAfter', 'freewayLand']` as optional keys for `highway-truncation` only (others keep `['opensAfter']`). `build.ts` passes `readFreewayLandSet(...)` (the same file as Task 2) to `writeLessCars`.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest --run --project server src/lib/data/lesscars`, `npx vitest --run --project pipeline pipeline/test/lesscars-step.test.ts`, then `npm run test:pipeline`
Expected: PASS; goldens unchanged (the mini plan has no `freewayLand` yet).

- [ ] **Step 5: Docs and commit**

`docs/dev/lesscars.md`: the `freewayLand` field in the kinds table and format notes; the new checks under "Checks" (plan alone, and against the dataset).

```bash
git add src/lib/data/lesscars pipeline/steps pipeline/test docs/dev/lesscars.md
git commit -m "feat(lesscars): freewayLand parcel lists on truncations, with the garage exception"
```

---

### Task 4: Freed land from parcels, held sites and the garage's cost

**Files:**
- Modify: `pipeline/sql/84_lesscars_sites.sql` (inputs, `lc_access` `:81-85`, `lc_free` `:99-114`, pieces `:190-214`, `lc_site` `:218-227`, neighbours `:229-241`)
- Modify: `pipeline/steps/lesscars-sql.ts:10-31` (`FreedRemoval`, `removalsOf`), `:43-101` (`carveFreedLand`)
- Modify: `pipeline/lib/lesscars/sites.ts:35-42,61-71,102-166` (`FreedSite`, `readFreedSites`)
- Modify: `pipeline/lib/lesscars/runs.ts:111-162` (`initiativeBuilds`), new `garageCosts`; `summarise` meta
- Modify: `pipeline/steps/lesscars.ts:80-87` (`zeroYieldSites`), `:322-449` (wiring, counts, sites file)
- Modify: `src/lib/data/lesscars/codec.ts:56-74` (`LessCarsSummary`), `:92-102` (`LessCarsSite`), `:193` (`parseSummary`), `:625-640` (`parseSitesFile`)
- Modify: `pipeline/steps/check-lesscars.ts:140-165` (V35)
- Modify: `pipeline/test/fixtures/mini/enrichment/lesscars-plan.json` (hwy gets `freewayLand`)
- Test: `pipeline/test/lesscars-sites.test.ts`, `pipeline/test/lesscars-runs.test.ts`, `pipeline/test/lesscars-step.test.ts`, `src/lib/data/lesscars/codec.test.ts`
- Regenerate: goldens and fixture-0
- Modify: `docs/dev/lesscars.md` ("Streets and freed land", "Builds and reservations", "Output files", "Invariant V35")

**Interfaces:**
- Consumes: Task 3's `freewayLand`; the catalog set (Task 2); `siteRowAt` (`regimes.ts:449`).
- Produces:

```ts
// lesscars-sql.ts
export interface FreedRemoval {
  projectId: string;
  cnns: string[];
  lines: [number, number][][];
  rowHalfWidthM: number;
  /** freewayLand parcels; heldBy is the garage standing on it, else null. */
  parcels: { id: ParcelId; heldBy: string | null }[];
}
export function carveFreedLand(db: Duck, removed: FreedRemoval[], notNeighbours: ReadonlySet<ParcelId>): Promise<void>;
// lc_site gains parcels VARCHAR[] (sorted), parcel_m2 DOUBLE, held_by VARCHAR

// sites.ts: FreedSite gains
parcels: ParcelId[]; parcelM2: number; heldBy: string | null;

// codec.ts (all optional; the writer omits a key that is empty, 0 or null)
interface LessCarsSite { …; parcels?: ParcelId[]; parcelM2?: number; heldBy?: string }
interface LessCarsSummary { …; garageCost?: { projectId: string; homes: number }[] }

// runs.ts
/** Per garage holding sites: the top fill yield its held sites would have had at their project's
 *  build start (the open day when the project has no build), summed. Garages holding none are absent. */
export function garageCosts(
  plan: LessCarsPlan,
  s: PlanSchedule,
  sites: readonly Pick<FreedSite, 'siteId' | 'projectId' | 'heldBy'>[],
  rows: Pick<RegimeSet, 'siteRowAt'>
): { projectId: string; homes: number }[];
// initiativeBuilds skips sites with heldBy !== null.
```

Carve rules (the SQL does what Decisions says; these pin what the tests do not):
1. Input tables `lc_in_parcel(project_id, parcel_id, held_by)` and `lc_in_not_neighbour(parcel_id)` (the catalog plus every freed parcel).
2. `lc_access` skips parcels in `lc_in_parcel`; `lc_free` also subtracts ∪ `parcels.geom` of `lc_in_parcel`.
3. v1 pieces as today. Then per freed parcel: its `geom` dumped to polygon parts; each part is a site seed. A v1 piece within 0.05 m of a seed of a non-held parcel of the same project merges into the seed whose `ST_Area(ST_Intersection(piece, ST_Buffer(seed, 0.05)))` is largest (smaller parcel id, then part index, on a tie). Unmerged pieces stay sites.
4. `parcel_m2` = area of the site that lies in freed parcels; `parcels` = freed parcels the site overlaps by more than 1 m².
5. `k`: seeds in (smallest parcel id, part) order, then unmerged pieces in v1 order. `minPieceM2` drops only unmerged pieces.
6. Neighbours (`near`, `lone`) exclude `lc_in_not_neighbour`.

Counts: `lesscars.sites.parcels` (sites with `parcelM2 > 0`), `lesscars.sites.held`, `lesscars.freed_m2.parcels`, `lesscars.freed_m2.row` (rounded m², held sites excluded). `zeroYieldSites` ignores held sites. V35 adds: every site's `heldBy` names an `edge-garage` whose `site.parcel` is in `parcels`; every `freewayLand` parcel is in exactly one site's `parcels` (`freed parcel <id> is in <n> sites`); every row of a site's `parcels` has `eligible` 0 in parcels.bin (`freed parcel <id> is scenario-eligible: its homes would count twice`); no timeline build is on a held site.

Mini plan: `hwy` gains `"freewayLand": { "parcels": ["3512019"], "excluded": [{ "parcel": "3512018", "reason": "2 homes: freeway land holds none" }] }`.

- [ ] **Step 1: Write the failing tests**

```ts
// lesscars-sites.test.ts (mini data; after this task lesscarsMini carves with the fixture catalog)
it('lot 19 becomes one site merged with the ROW piece it touches', () => {
  const s = sites.find((x) => x.parcels.includes('3512019'))!;
  expect(s.siteId).toBe('lc:hwy:1');
  expect(s.parcelM2).toBeCloseTo(800, 0);
  expect(s.rec.areaM2).toBeCloseTo(1800, 0); // 800 m² parcel + the 1,000 m² rest of the first 46.7 m stretch
  expect(s.heldBy).toBeNull();
});
it('no ROW piece overlaps a freed parcel and the sites cover the band once', async () => {
  expect(await overlapM2(db, 'lc_site', '3512019')).toBeCloseTo(800, 0); // only site 1 overlaps it
  expect(totalSiteArea(sites, 'hwy')).toBeCloseTo(4084 + 400, 0); // v1's 4,084 m² band, plus lot 19's 400 m² outside it
});
it('a freed site never takes freeway land as its zoning neighbour', () => {
  for (const s of sites) expect(s.zoning.parcelId).not.toBe('3512019');
});
it('lot 19’s site takes the zoning of its most permissive neighbour that is not freeway land', () => {
  expect(site1.zoning).toEqual(chooseZoning(neighboursOf(site1).filter((n) => n.parcelId !== '3512019')));
});
it('a two-part freed parcel becomes two sites', async () => {
  // carveFreedLand on a synthetic parcels table holding one MultiPolygon freed parcel
  expect(twoPart.map((s) => s.parcels)).toEqual([['p2'], ['p2']]);
  expect(twoPart[0].parcelM2 + twoPart[1].parcelM2).toBeCloseTo(areaOf('p2'), 0);
});
// lesscars-runs.test.ts
it('a site held by a garage gets no build and its homes are the garage’s cost', () => {
  const builds = initiativeBuilds(plan, s, [freed, held], parcels, rows);
  expect(builds.map((b) => b.siteId)).toEqual([freed.siteId]);
  expect(garageCosts(plan, s, [freed, held], rows)).toEqual([{ projectId: 'garage', homes: topYield(held) }]);
});
// lesscars-step.test.ts
it('V35 fails when a freed parcel row is scenario-eligible', async () => {
  expect((await v35(withEligibleRow('3512019'))).detail).toMatch(/freed parcel 3512019 is scenario-eligible/);
});
it('a held site is not zero-yield and its garage cost is in summary.json', async () => {
  expect(r.counts['lesscars.sites.held']).toBe(1);
  expect(r.counts['lesscars.sites.zero_yield']).toBe(zeroYieldWithoutHeld);
  expect(summary.garageCost).toEqual([{ projectId: 'garage', homes: expect.any(Number) }]);
});
// codec.test.ts
it('the v1 sites and summary files still parse', () => {
  expect(parseSitesFile(V1_SITES).sites[0]).not.toHaveProperty('parcels');
  expect(parseSummary(V1_SUMMARY)).not.toHaveProperty('garageCost');
});
it('rejects a negative parcelM2 or a garage cost that is not a whole number', () => {
  expect(() => parseSitesFile(negativeParcelM2)).toThrow(/sites\.0\.parcelM2/);
  expect(() => parseSummary(fractionalCost)).toThrow(/garageCost\.0\.homes/);
});
```

`V1_SITES` and `V1_SUMMARY` are copies of today's `fixture-0` files, committed under `src/lib/data/lesscars/fixtures/` before the regeneration (they are test inputs, not fixture-0). The held-garage step test uses a variant mini plan whose `garage` site is `{ parcel: '3512019' }`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project pipeline pipeline/test/lesscars-sites.test.ts pipeline/test/lesscars-runs.test.ts pipeline/test/lesscars-step.test.ts`, `npx vitest --run --project server src/lib/data/lesscars/codec.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the carve, the site fields, held sites, `garageCosts`, the codec keys, the counts and V35**

`removalsOf` fills `parcels` from `freewayLand.parcels`, `heldBy` from the garage whose `site.parcel` is that id. `writeLessCars` passes the catalog set ∪ freed parcels as `notNeighbours`, adds `garageCost` to the summary only when non-empty, and writes the optional site keys only when non-empty. The 1 m² and 0.05 m tolerances are builder's (projection noise).

- [ ] **Step 4: Run them to verify they pass, then regenerate**

Run: the Step 2 commands; then `npm run pipeline -- fixture --update-golden`; then `npm run test:pipeline`, `npm run test:unit`, `SFH_E2E_PORT=4207 SFH_E2E_WORKERS=1 npx playwright test e2e/lesscars.spec.ts`
Expected: PASS. Golden diff: `sites.json` site 1 grows with `parcels`/`parcelM2`, numbering otherwise as before; summary freed series and timeline builds change with site 1's yield; report counts gain the new keys. The e2e "freed land appears when available" still passes (it reads sites from disk).

- [ ] **Step 5: Docs and commit**

`docs/dev/lesscars.md`: the carve formula with freed parcels, the merge and numbering rules, held sites and `garageCost`, the new site keys and counts, V35's new checks.

```bash
git add pipeline src/lib/data/lesscars e2e/fixtures/data/fixture-0 docs/dev/lesscars.md
git commit -m "feat(lesscars): freed freeway parcels become freed sites; garages hold theirs"
```

---

### Task 5: The candidate command `lesscars-freeway-land`

**Files:**
- Create: `pipeline/lib/lesscars/streets.ts` (the locked-streets loader, moved out of `lesscars-cnns.ts:89-134`), `pipeline/steps/lesscars-freeway-land.ts`, `pipeline/sql/86_freeway_land.sql`
- Modify: `pipeline/steps/lesscars-cnns.ts` (use the loader), `pipeline/cli.ts`, `pipeline/lesscars-config.ts` (`LC` additions)
- Test: `pipeline/test/lesscars-freeway-land.test.ts` (extend), `pipeline/test/lesscars-corridors.test.ts` (unchanged, must still pass)
- Modify: `docs/dev/lesscars.md` ("Freeway land"), `docs/dev/pipeline.md` (Commands table), `CLAUDE.md` (pipeline command list)

**Interfaces:**
- Consumes: `normaliseAll`, `loadNormalised`, `createQualityTables`, `runSql` as `build.ts:178-187` calls them; `readFreewayLand` (Task 2); `readParcelsBin` (`pipeline/steps/scenario.ts`), `parseProjectsFile` for annotations.
- Produces:

```ts
// pipeline/lib/lesscars/streets.ts
export function loadLockedStreets(a: {
  lockPath: string; rawDir: string; byName?: boolean; crs: 'EPSG:7131' | 'EPSG:4326';
}): Promise<StreetSeg[] & { sha256: string[] }>; // throws Error with the lesscars-cnns messages

// pipeline/lesscars-config.ts, LC (tier 4, builder's unless the spec fixes it)
freewayBandM: 60,       // spec "My call": the candidate band
freewayMinShare: 0.5,   // spec: "at least half within"
basemapBandM: 25,       // Task 6: basemap id band
basemapMinShare: 0.9,   // Task 6: a feature this much in band is the removed stretch's
basemapClipZooms: [11, 12, 13] as number[], // the mixed zooms docs/dev/lesscars.md "Basemap ids" records (Task 1); 7b clips there
// with LC_CITE rows for each

// pipeline/steps/lesscars-freeway-land.ts
export const FREEWAY_LAND_CANDIDATES_JSON: string; // pipeline/enrichment/lesscars/freeway-land.candidates.json
export interface FreewayCandidate {
  parcel: ParcelId; areaM2: number; inBandShare: number; distM: number;
  landUse: string; zoning: string | null; units: number; heightM: number;
  labelLngLat: [number, number];
  fzpTopYield: number | null; hostable: boolean | null; inFlight: string[] | null; // null without --dataset
  status: 'listed' | 'excluded' | 'new';  // against the segment's current catalog entry
}
export interface FreewayCandidatesFile {
  schema: 1;
  source: { lockSha256: string; dataset: string | null };
  rule: { bandM: number; minShare: number };
  segments: { id: string; candidates: FreewayCandidate[]; rowM2: number }[];
}
export function lesscarsFreewayLand(a: {
  lockPath: string; rawDir: string; byName?: boolean;
  catalogPath?: string; outPath?: string; datasetDir?: string | null;
}): Promise<number>;
```

Candidate rule (`86_freeway_land.sql`, reading `parcel_out`, `parcels`, `src_parcel_attrs` zoning as `80_scenario.sql:98-110` picks it, and an input table `fl_seg(segment_id, cnn)` joined to `src_streets`): a parcel is a candidate of a segment when `units = 0`, (`land_use = 'VACANT'` or (zoning `P` and `height_m = 0` and `floor_area_m2 = 0`)), and `ST_Area(ST_Intersection(geom, ST_Buffer(segment lines, freewayBandM))) / ST_Area(geom) >= freewayMinShare`. A parcel in several segments' bands goes to the nearest segment (smaller id on a tie). `rowM2` is the unparcelled land-mask area within the band (`land_mask − ∪ parcels`), a size for the drafter, not a list. Sorted by segment order, then `inBandShare` descending, then parcel id. `--dataset <v>` (default: newest `pipeline/out/<v>` with a `parcels.bin`) fills `fzpTopYield`, `hostable` and `inFlight` (ids of `projects.json` projects naming the parcel). CLI help: `propose freeway-land parcels for each segment of freeway-land.json from the locked sources`.

- [ ] **Step 1: Write the failing tests**

```ts
it('proposes lot 19 for the fixture I-80 and not lot 18 (2 homes) or lot 7 (open space)', async () => {
  const out = await runOnMini(); // lesscarsFreewayLand on the mini lock (byName), to a temp outPath
  const c = out.segments[0].candidates;
  expect(c.map((x) => x.parcel)).toContain('3512019');
  expect(c.map((x) => x.parcel)).not.toContain('3512018');
  expect(c.find((x) => x.parcel === '3512019')).toMatchObject({ status: 'listed', units: 0, landUse: 'VACANT', zoning: 'P' });
  expect(c.find((x) => x.parcel === '3512019')!.inBandShare).toBeGreaterThanOrEqual(0.5);
});
it('a parcel under half in the band is not proposed', async () => {
  expect(await shareOf('3512001')).toBeLessThan(0.5); // lot 1, y[0,30], 45-75 m from the line
  expect(c.map((x) => x.parcel)).not.toContain('3512001');
});
it('writes nothing and exits 1 when a segment names a CNN src_streets lacks', async () => {
  expect(await runWithCatalog(badCnn)).toBe(1);
  expect(existsSync(tmpOut)).toBe(false);
});
it('lesscars-cnns still resolves through the shared loader', async () => {
  expect(await lesscarsCnns(miniArgs)).toBe(0);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project pipeline pipeline/test/lesscars-freeway-land.test.ts pipeline/test/lesscars-corridors.test.ts`
Expected: FAIL (command missing).

- [ ] **Step 3: Implement the loader, the SQL, the command and the CLI entry**

The command normalises and runs the SQL stage on a fresh DuckDB (no chunks, no tiles), then `86_freeway_land.sql`. It prints one line per segment (`<id>: <n> candidates (<listed> listed, <excluded> excluded, <new> new), <ha> ha; ROW <ha> ha`) and writes the file through the prettier layout `lesscars-cnns` uses (`formatJson`, `lesscars-cnns.ts:70-77`).

- [ ] **Step 4: Run them to verify they pass**

Run: the Step 2 command, then `npm run test:pipeline`
Expected: PASS.

- [ ] **Step 5: Docs and commit**

`docs/dev/lesscars.md` "Freeway land": the catalog format, the candidate rule and `LC` values, "the curated list is the source of truth, not the rule". `docs/dev/pipeline.md` and `CLAUDE.md`: the new command.

```bash
git add pipeline docs/dev CLAUDE.md
git commit -m "feat(lesscars): lesscars-freeway-land proposes freeway-land parcels per segment"
```

---

### Task 6: The basemap id list and its build check

**Files:**
- Create: `pipeline/lib/lesscars/basemap-ids.ts`, `pipeline/test/fixtures/mini/enrichment/lesscars-basemap-ids.json`
- Modify: `pipeline/lib/lesscars/basemap-roads.ts` (`basemapIdsMissing`), `pipeline/steps/lesscars-basemap.ts` (candidates mode), `pipeline/lesscars-config.ts` (paths)
- Modify: `pipeline/steps/lesscars.ts` (args, check), `pipeline/steps/build.ts:281-302` (basemap raw path before `copyBasemap`)
- Test: `pipeline/test/lesscars-basemap-roads.test.ts`, `pipeline/test/lesscars-step.test.ts`
- Modify: `docs/dev/lesscars.md` ("Basemap ids")

**Interfaces:**
- Consumes: `roadsNear`, `BASEMAP_ZOOMS` (Task 1); `loadLockedStreets` (Task 5); `readFreewayLand` (Task 2); `LC.basemapBandM`, `LC.basemapMinShare` (Task 5).
- Produces:

```ts
// pipeline/lib/lesscars/basemap-ids.ts
export interface BasemapIdsFile {
  schema: 1;
  /** sha256 of the protomaps-basemap lock file the ids were read from. */
  source: { sha256: string };
  phases: { project: string; ref: string | null; ids: number[] }[]; // ids sorted, unique
}
export function parseBasemapIds(json: unknown): BasemapIdsFile;
export function readBasemapIds(path: string): BasemapIdsFile | null;
export const BASEMAP_IDS_CANDIDATES_JSON: string; // pipeline/enrichment/lesscars/basemap-ids.candidates.json

// pipeline/lesscars-config.ts
export const LESSCARS_BASEMAP_IDS_JSON: { live: string; fixture: string };

// basemap-roads.ts
/** The listed ids found in no `roads` tile at any of BASEMAP_ZOOMS within `bbox` ([w, s, e, n]). */
export function basemapIdsMissing(pmtiles: string, ids: readonly number[], bbox: [number, number, number, number]): Promise<number[]>;

// writeLessCars gains `basemap: { pmtiles: string; ids: BasemapIdsFile | null }` and returns
// `basemapPhases: { project: string; ref: string | null; ids: number[]; lines: [number, number][][] }[]`
// (lines: the phase's CNN centrelines in [lng, lat], for 7b); [] without ids or plan.
```

Candidates mode (`lesscars-basemap`, default): for each catalog segment with `removedBy`, the segment's CNN lines from `loadLockedStreets(…, crs: 'EPSG:4326')`, `roadsNear` at `LC.basemapBandM`, keeping every piece whose `inBandM / lengthM >= LC.basemapMinShare` at any zoom; grouped by `removedBy` into phases (`ref`: the segment's `ref`); writes `basemap-ids.candidates.json` with the lock's basemap sha256. Build check in `writeLessCars`: every phase's `project` is a `highway-truncation` of the plan (`basemap-ids.json: <project> is not a highway truncation of the plan`); `basemapIdsMissing` over the phases' lines' bbox plus 500 m is empty (`basemap-ids.json: ids <ids> are not in basemap.pmtiles; was the basemap rebuilt?`); a `source.sha256` different from the lock's basemap is a warning, not a failure (the ids are what is checked).

Fixture list: `{ schema: 1, source: { sha256: <mini lock basemap sha256> }, phases: [{ project: 'hwy', ref: null, ids: [<the id(s) Task 1's test found under the mini I-80 at z15>] }] }`; the implementer reads the ids from `roadsNear` on the mini basemap and records them.

- [ ] **Step 1: Write the failing tests**

```ts
it('basemapIdsMissing finds the fixture ids and reports an unknown one', async () => {
  expect(await basemapIdsMissing(MINI_BASEMAP, FIXTURE_IDS, MINI_BBOX)).toEqual([]);
  expect(await basemapIdsMissing(MINI_BASEMAP, [...FIXTURE_IDS, 1], MINI_BBOX)).toEqual([1]);
});
it('an id missing from basemap.pmtiles fails the build', async () => {
  await expect(step(miniPlan, { ids: withIds([...FIXTURE_IDS, 1]) })).rejects.toThrow(/ids 1 are not in basemap\.pmtiles/);
});
it('a phase naming a project that is not a truncation fails', async () => {
  await expect(step(miniPlan, { ids: phaseFor('subway') })).rejects.toThrow(/subway is not a highway truncation/);
});
it('the step returns each phase with its lines', async () => {
  expect(r.basemapPhases).toEqual([expect.objectContaining({ project: 'hwy', ids: FIXTURE_IDS })]);
  expect(r.basemapPhases[0].lines[0].length).toBeGreaterThanOrEqual(2);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project pipeline pipeline/test/lesscars-basemap-roads.test.ts pipeline/test/lesscars-step.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the format, the check, candidates mode and the build wiring**

`build.ts` resolves the basemap raw path (`build.ts:300-302`) before the lesscars step and passes it with `readBasemapIds(LESSCARS_BASEMAP_IDS_JSON[kind])`.

- [ ] **Step 4: Run them to verify they pass**

Run: the Step 2 command, then `npm run test:pipeline`
Expected: PASS; goldens unchanged (nothing is published yet).

- [ ] **Step 5: Docs and commit**

```bash
git add pipeline docs/dev/lesscars.md
git commit -m "feat(lesscars): curated basemap ids per removal phase, checked against basemap.pmtiles"
```

---

### Task 7a: Hide removed freeways by id on their removal day (verdict `ids` only)

Skip when Task 1's verdict is `split`; run Task 7b instead.

**Files:**
- Create: `src/lib/map/filter-expr.ts` (+ `filter-expr.spec.ts`), `src/lib/lesscars/basemap-hide.ts` (+ `basemap-hide.spec.ts`)
- Modify: `src/lib/data/lesscars/codec.ts:104-111,663-680` (`basemapHide`), `pipeline/steps/lesscars.ts:385-391` (plan file), `pipeline/steps/check-lesscars.ts` (V35)
- Modify: `src/lib/lesscars/LessCarsMode.svelte:209,295` (install, `setDay`)
- Test: `e2e/lesscars.spec.ts`, `src/lib/data/lesscars/codec.test.ts`
- Regenerate: goldens and fixture-0 (plan.json gains `basemapHide`)
- Modify: `docs/dev/lesscars.md` ("Street states and layers", "Output files")

**Interfaces:**
- Consumes: `LessCarsPlanFile.times` (`openDay`); `basemapPhases` (Task 6); `epochOf` (`src/lib/lesscars/features.ts:281`).
- Produces:

```ts
// codec.ts
interface LessCarsPlanFile { …; basemapHide?: { projectId: string; ids: number[] }[] }

// src/lib/map/filter-expr.ts
/** A MapLibre filter as an expression; legacy filters (==, !=, <, <=, >, >=, in, !in, has, !has,
 *  all, any, none, with $type / $id keys) are converted; an expression is returned as is.
 *  Throws on an operator it does not know. */
export function toExpressionFilter(f: unknown): ExpressionSpecification;

// src/lib/lesscars/basemap-hide.ts
/** Ids of every phase whose openDay <= day, ascending. */
export function hiddenIds(f: LessCarsPlanFile, day: Day): number[];
/** Every style layer on source 'protomaps' with source-layer 'roads'. */
export function roadLayerIds(style: Pick<StyleSpecification, 'layers'>): string[];
export function installBasemapHide(
  map: Pick<MapLibreMap, 'getStyle' | 'setFilter'>,
  f: LessCarsPlanFile,
  day: Day
): { setDay(day: Day): void };
```

`installBasemapHide` reads each road layer's filter from `getStyle()` once, then sets `['all', toExpressionFilter(own), ['!', ['in', ['id'], ['literal', ids]]]]` (or own alone when `ids` is empty), only when the hidden set changes (epoch-gated on the phases' open days). Mixing a legacy filter into an expression `all` silently misreads it (`['==', 'kind', 'highway']` as an expression compares two strings), hence the converter.

- [ ] **Step 1: Write the failing tests**

```ts
// filter-expr.spec.ts (server project); featureFilter is imported from
// '@maplibre/maplibre-gl-style-spec' in this test only, to compare on sample features
it('every protomaps roads filter converts to an expression that selects the same features', () => {
  for (const l of protomapsRoadLayers())
    for (const feat of SAMPLE_FEATURES)
      expect(evalExpr(toExpressionFilter(l.filter), feat), l.id).toBe(evalLegacy(l.filter, feat));
});
it('an unknown legacy operator throws', () => {
  expect(() => toExpressionFilter(['within', 'x'])).toThrow(/within/);
});
// basemap-hide.spec.ts
it('hides a phase’s ids from its open day, not before', () => {
  expect(hiddenIds(planFile, openDay('hwy') - 1)).toEqual([]);
  expect(hiddenIds(planFile, openDay('hwy'))).toEqual(FIXTURE_IDS);
});
it('a plan file with no basemap ids hides nothing and sets no filter', () => {
  const map = fakeMap(style);
  installBasemapHide(map, v1PlanFile, LESSCARS_HORIZON).setDay(LESSCARS_HORIZON);
  expect(map.setFilter).not.toHaveBeenCalled();
});
it('sets filters only when the hidden set changes', () => {
  h.setDay(openDay('hwy')); h.setDay(openDay('hwy') + 30);
  expect(map.setFilter).toHaveBeenCalledTimes(roadLayerIds(style).length);
});
// codec.test.ts
it('basemapHide parses when present and is absent when omitted', () => {
  expect(parsePlanFile(withHide).basemapHide).toEqual([{ projectId: 'hwy', ids: [5] }]);
  expect(parsePlanFile(V1_PLAN)).not.toHaveProperty('basemapHide');
});
```

```ts
// e2e/lesscars.spec.ts
test('the removed street leaves the basemap on its removal day and returns when scrubbing back', async ({ page }) => {
  // FIXTURE ids and hwy's openDay read from fixture-0's plan.json; queryRenderedFeatures on roadLayerIds
  // with zoom 15 over the mini I-80, after a repaint and idle
  expect(await renderedIds(page, before)).toEqual(expect.arrayContaining(ids));
  expect(await renderedIds(page, after)).not.toEqual(expect.arrayContaining(ids));
});
test('the filter survives a theme switch', async ({ page }) => { /* scrub after, emulate dark, still hidden */ });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project server src/lib/map/filter-expr.spec.ts src/lib/lesscars/basemap-hide.spec.ts src/lib/data/lesscars/codec.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the converter, the hide module, the plan-file key, V35 and the page wiring**

`writeLessCars` writes `basemapHide` from `basemapPhases` only when non-empty. V35: each `basemapHide` project is a `highway-truncation`. `LessCarsMode` installs it beside `installLessCarsLayers` in `onMapReady` and calls its `setDay` where `layers?.setDay(d)` is called.

- [ ] **Step 4: Run them to verify they pass, regenerate and run e2e**

Run: the Step 2 command; `npm run pipeline -- fixture --update-golden`; `npm run test:pipeline`; `SFH_E2E_PORT=4207 SFH_E2E_WORKERS=1 npx playwright test e2e/lesscars.spec.ts`
Expected: PASS in both projects; golden diff only `plan.json`'s `basemapHide`.

- [ ] **Step 5: Docs and commit**

```bash
git add src/lib pipeline e2e docs/dev/lesscars.md
git commit -m "feat(lesscars): removed freeways leave the basemap on their removal day"
```

---

### Task 7b: Split the removed stretches into their own source layer (verdict `split` only)

The spec's fallback. Skip when Task 1's verdict is `ids`.

**Files:**
- Create: `pipeline/lib/pmtiles-rewrite.ts`, `pipeline/lib/lesscars/basemap-split.ts` (+ `pipeline/test/lesscars-basemap-split.test.ts`, `pipeline/test/pmtiles-rewrite.test.ts`)
- Create: `src/lib/map/filter-expr.ts` (+ spec), `src/lib/lesscars/basemap-hide.ts` (+ spec), as in Task 7a's interface but for the clones
- Modify: `pipeline/steps/tiles.ts:81-84` (`writeBasemap` replaces `copyBasemap`), `pipeline/steps/build.ts:297-304`, `pipeline/steps/doctor.ts` (`node:sqlite` loads)
- Modify: `src/lib/map/style.ts:170-193` (clones), `src/lib/map/style.spec.ts`
- Modify: `src/lib/lesscars/LessCarsMode.svelte:209,295`
- Modify: `package.json` (devDependency `@maplibre/vt-pbf` `4.3.2`, the version already in the lockfile)
- Test: `e2e/lesscars.spec.ts`, `e2e/` `/sim` smoke (the freeway clone draws there)
- Regenerate: goldens and fixture-0 (fixture-0's `basemap.pmtiles` is rewritten)
- Modify: `docs/dev/lesscars.md` ("Basemap ids"), `docs/dev/pipeline.md` (Where things land: `basemap.pmtiles` may carry `roads_lc`), `docs/dev/map-interfaces.md` (the `__lc` clone layers)

**Interfaces:**
- Consumes: `basemapPhases` (Task 6), `LC.basemapClipZooms`, `LC.basemapBandM` (Task 5); `toExpressionFilter`.
- Produces:

```ts
// pipeline/lib/pmtiles-rewrite.ts
/** Copy every tile of `input` (all zooms over its header bounds) through `transform` into
 *  `output`: an MBTiles file written with node:sqlite in workDir, then `pmtiles convert`.
 *  Metadata is carried over, `vector_layers` gaining `extraLayers`. */
export function rewritePmtiles(a: {
  input: string; output: string; workDir: string;
  transform: (z: number, x: number, y: number, mvt: Uint8Array) => Uint8Array | null; // null: unchanged
  extraLayers: { id: string; fields: Record<string, string> }[];
}): Promise<{ tiles: number; changed: number }>;

// pipeline/lib/lesscars/basemap-split.ts
export const LC_ROADS_LAYER = 'roads_lc';
export interface SplitPhase {
  projectId: string;
  ids: ReadonlySet<number>;
  ref: string | null;
  corridor: [number, number][][]; // polygon ring(s), [lng, lat]: the phase's lines buffered by basemapBandM
}
/** Moves the phases' features from `roads` to `roads_lc` (property lc_project): listed ids whole at
 *  every zoom; on clip zooms, the part inside a corridor of every `highway` feature whose ref has the
 *  phase's ref token. Other layers and features are re-encoded unchanged. null when nothing moved. */
export function splitRoadsTile(
  mvt: Uint8Array, z: number, x: number, y: number,
  phases: readonly SplitPhase[], clip: boolean
): Uint8Array | null;

// pipeline/steps/tiles.ts
export function writeBasemap(rawFile: string, outDir: string,
  split: { phases: SplitPhase[]; clipZooms: readonly number[]; workDir: string } | null): Promise<void>;

// src/lib/map/style.ts: each protomaps layer with source-layer 'roads' gets a clone, id `${id}__lc`,
// source-layer 'roads_lc', placed right after it. Always present (an archive without the layer draws nothing).
export const LC_ROADS_SOURCE_LAYER = 'roads_lc';

// src/lib/lesscars/basemap-hide.ts
/** Projects whose openDay <= day (their roads_lc features stop drawing). */
export function removedProjects(f: LessCarsPlanFile, day: Day): string[];
export function installBasemapHide(map: Pick<MapLibreMap, 'getStyle' | 'setFilter'>, f: LessCarsPlanFile, day: Day): { setDay(day: Day): void };
// filters each `__lc` clone with ['all', toExpressionFilter(own), ['!', ['in', ['get', 'lc_project'], ['literal', removed]]]]
```

Builder's calls: the corridor is the phase's `lines` buffered by `LC.basemapBandM` with flat caps (DuckDB `ST_Buffer(…, 'CAP_FLAT')` in EPSG:7131, then to EPSG:4326), computed in `build.ts` from `basemapPhases`; clipping in tile units: walk each line, split where it crosses a corridor edge, and keep a part inside when its midpoint is (point in polygon after transforming the corridor to tile units); only `kind = 'highway'` features are clipped; a `ref` matches when any `;`-separated token equals the phase's `ref`. MBTiles rows use TMS y (`2^z − 1 − y`) and gzip the MVT, as `pmtiles convert` expects. `/sim` and FZP draw the clones unfiltered, so they look as today.

- [ ] **Step 1: Write the failing tests**

```ts
// lesscars-basemap-split.test.ts (synthetic tiles encoded with @maplibre/vt-pbf)
it('a listed id moves whole to roads_lc with lc_project; other features stay', () => {
  const out = decode(splitRoadsTile(tile([road(7, 'highway'), road(8, 'minor_road')]), 14, x, y, [phase({ ids: [7] })], false)!);
  expect(out.roads.map((f) => f.id)).toEqual([8]);
  expect(out.roads_lc.map((f) => [f.id, f.properties.lc_project])).toEqual([[7, 'p1']]);
});
it('a merged line is clipped at the corridor: the kept part stays in roads', () => {
  // a highway with ref 'US 101' crossing the corridor's flat end at mid-tile
  const out = decode(splitRoadsTile(tile([longHighway]), 12, x, y, [phase({ ref: 'US 101', corridor })], true)!);
  expect(lengthOf(out.roads_lc)).toBeCloseTo(insideLength, -1);
  expect(lengthOf(out.roads)).toBeCloseTo(outsideLength, -1);
  expect(out.roads[0].id).toBe(longHighway.id);
});
it('a crossing freeway with another ref is not clipped', () => {
  expect(splitRoadsTile(tile([i280Across]), 12, x, y, [phase({ ref: 'US 101', corridor })], true)).toBeNull();
});
it('on a zoom that is not a clip zoom nothing unlisted moves', () => {
  expect(splitRoadsTile(tile([longHighway]), 14, x, y, [phase({ ref: 'US 101', corridor })], false)).toBeNull();
});
// pmtiles-rewrite.test.ts
it('an identity rewrite of the mini basemap reads back tile for tile', async () => {
  const r = await rewritePmtiles({ input: MINI_BASEMAP, output: tmp, workDir, transform: () => null, extraLayers: [] });
  expect(r.changed).toBe(0);
  expect(await allTiles(tmp)).toEqual(await allTiles(MINI_BASEMAP));
});
// style.spec.ts
it('every roads layer has a roads_lc clone right after it', () => {
  for (const id of roadIds) expect(ids[ids.indexOf(id) + 1]).toBe(`${id}__lc`);
});
```

```ts
// e2e/lesscars.spec.ts: on fixture-0 the hwy phase's ids are in roads_lc
test('the removed street draws from roads_lc until its removal day, never from roads', async ({ page }) => {
  expect(await renderedIds(page, before, cloneIds)).toEqual(expect.arrayContaining(ids));
  expect(await renderedIds(page, before, roadIds)).not.toEqual(expect.arrayContaining(ids));
  expect(await renderedIds(page, after, cloneIds)).not.toEqual(expect.arrayContaining(ids));
});
test('the filter survives a theme switch', async ({ page }) => { /* scrub after, emulate dark, still hidden */ });
test('/sim still draws the moved street, from the clone layers', async ({ page }) => {
  expect(await renderedIds(simPage, anyDay, cloneIds)).toEqual(expect.arrayContaining(ids));
});
```

```ts
// basemap-hide.spec.ts
it('a plan file with no basemap ids hides nothing and sets no filter', () => {
  installBasemapHide(map, v1PlanFile, LESSCARS_HORIZON).setDay(LESSCARS_HORIZON);
  expect(map.setFilter).not.toHaveBeenCalled();
});
it('a clone stops drawing a project’s features from its open day', () => {
  expect(removedProjects(planFile, openDay('hwy') - 1)).toEqual([]);
  expect(removedProjects(planFile, openDay('hwy'))).toEqual(['hwy']);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project pipeline pipeline/test/lesscars-basemap-split.test.ts pipeline/test/pmtiles-rewrite.test.ts`, `npx vitest --run --project server src/lib/map`
Expected: FAIL.

- [ ] **Step 3: Implement the rewrite, the split, `writeBasemap`, the clones and the page filter**

`build.ts` calls `writeBasemap(raw, outDir, phases.length ? { phases, clipZooms: LC.basemapClipZooms, workDir: work } : null)`; without phases the archive is copied byte for byte as today. Count `tiles.basemap_split_changed`.

- [ ] **Step 4: Run them to verify they pass, regenerate and run e2e**

Run: the Step 2 commands; `npm run pipeline -- fixture --update-golden`; `npm run test:pipeline`; `npm run test:unit`; `SFH_E2E_PORT=4207 SFH_E2E_WORKERS=1 npx playwright test`
Expected: PASS. If the golden test compares `basemap.pmtiles` bytes and they differ between runs, compare it decoded (tile for tile) as `parcels.bin` is, in this task.

- [ ] **Step 5: Docs and commit**

```bash
git add pipeline src/lib e2e package.json package-lock.json docs/dev
git commit -m "feat(lesscars): the tiles step moves removed freeways into roads_lc, filtered by day"
```

---

### Task 8: Freed-land disclosure, held sites and the garage's cost on the page

**Files:**
- Modify: `src/lib/lesscars/features.ts:204-220` (`siteFeatures` skips held sites)
- Modify: `src/lib/lesscars/summary-view.ts` (`freedLandSplit`), `src/lib/lesscars/copy.ts` (copy), `src/lib/lesscars/DetailsPanel.svelte:18-23` (props, a paragraph under the breakdown), `src/lib/lesscars/LessCarsMode.svelte:343` (pass `sites`)
- Test: `src/lib/lesscars/features.spec.ts`, `src/lib/lesscars/summary-view.spec.ts`, `src/lib/lesscars/DetailsPanel.svelte.spec.ts`, `e2e/lesscars.spec.ts`
- Modify: `docs/dev/lesscars.md` ("Header" / details)

**Interfaces:**
- Consumes: `LessCarsSite.parcels/parcelM2/heldBy`, `LessCarsSummary.garageCost` (Task 4).
- Produces:

```ts
// summary-view.ts
/** Freed land in m²: parcelM2 summed, and the rest of each site's area; held sites excluded. */
export function freedLandSplit(s: LessCarsSitesFile): { parcelM2: number; rowM2: number };
// copy.ts
export function freedLandCopy(parcelHa: string, rowHa: string): string;
// 'Freed land: 12.3 ha of former freeway land and 4.5 ha of former roadway.'
// with no parcel land: 'Freed land: 4.5 ha of former roadway.'
export function garageCostCopy(homes: number): string;
// 'Edge garages on freed land take the place of 1,234 homes.' (formatCount)
// DetailsPanel gains `sites: LessCarsSitesFile`; hectares to one decimal.
```

- [ ] **Step 1: Write the failing tests**

```ts
it('a held site is not drawn as freed land', () => {
  expect(siteFeatures(planFile, withHeld).features.map((f) => f.properties.siteId)).not.toContain('lc:hwy:1');
});
it('freedLandSplit sums parcel land and the rest, without held sites', () => {
  expect(freedLandSplit(fixtureSites)).toEqual({ parcelM2: expect.closeTo(800, 0), rowM2: expect.closeTo(3684, 0) });
  expect(freedLandSplit(withHeld).parcelM2).toBe(0);
});
it('the details say how much freed land came from freeway parcels and from roadway', async () => {
  render(DetailsPanel, { summary, sites: fixtureSites, day, onevidence });
  await expect.element(page.getByText(/Freed land: 0\.1 ha of former freeway land and 0\.4 ha of former roadway\./)).toBeVisible();
});
it('a garage cost line shows only when summary.garageCost is present', async () => {
  await expect.element(page.getByText(/take the place of/)).not.toBeInTheDocument(); // fixture summary
  // with garageCost [{ projectId: 'garage', homes: 1234 }]
  await expect.element(page.getByText('Edge garages on freed land take the place of 1,234 homes.')).toBeVisible();
});
```

e2e: in the existing "the details show a breakdown that adds to the headline" test, the disclosure text equals the one computed from fixture-0's `sites.json`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project client src/lib/lesscars`, `npx vitest --run --project server src/lib/lesscars`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run them, the lesscars e2e and axe**

Run: the Step 2 commands, then `SFH_E2E_PORT=4207 SFH_E2E_WORKERS=1 npx playwright test e2e/lesscars.spec.ts`
Expected: PASS in both projects, axe clean in light and dark (the existing dark-mode test covers the details).

- [ ] **Step 5: Docs and commit**

```bash
git add src/lib/lesscars e2e/lesscars.spec.ts docs/dev/lesscars.md
git commit -m "feat(lesscars): freed-land disclosure and the garage cost in the details"
```

---

### Task 9: Draft the dated v1.1 section of `plan-v1.md` for owner review

Run by the controller, in this session, on the owner's laptop (needs `pipeline/.cache` restored and a built `pipeline/out/<v>/`; `npm run pipeline -- fetch --restore` if the cache is missing). This task writes the plan content; it wires nothing into `plan.json`.

**Files:**
- Create: `pipeline/enrichment/lesscars/freeway-land.json` (segments with CNNs and `removedBy`; `parcels` and `excluded` empty), `pipeline/enrichment/lesscars/freeway-land.candidates.json`, `pipeline/enrichment/lesscars/basemap-ids.candidates.json`
- Modify: `docs/lesscars/plan-v1.md` (a new top-level section `## v1.1 (2026-11-03): freeway removal and freeway land`, before Appendix A; v1 text unchanged)

**Interfaces:**
- Consumes: `lesscars-freeway-land` (Task 5), `lesscars-basemap` (Tasks 1, 6), `checkPlan`/`schedulePlan` (`src/lib/data/lesscars/schedule.ts`), the live dataset `pipeline/out/2026-11-02-39fbf039/`.
- Produces: the section Plan B transcribes. Its tables use Appendix A's column layouts so `lesscars-live-plan.test.ts` can parse them.

Section layout (headings exact; Plan B's tests parse them):

1. `### What changes` — the owner's three problems and decisions, in two paragraphs, and what v1.1 does not model (traffic: where US-101 traffic goes is not modelled).
2. `### Freeway segments` — one table: `Segment id | Freeway | Stretch | removedBy | CNNs | Curated`, every SF freeway segment (US-101 north of Alemany in the phases below; US-101 south of Alemany; I-280 including the Southern Embarcadero Freeway and the King St stretch; I-80 west of the Rincon cut; the Bay Bridge approach east of it). CNNs are `src_streets` FREEWAYS-layer segments (classcode 1 and 6), with the query used.
3. `### Freeway land` — per segment a `#### <segment id>` with a table `Parcel | Area m² | In band | Land use | Zoning | FZP yield today | Decision | Reason`; removed segments curated by hand (every candidate checked on satellite and basemap imagery and decided `in` or `out`), kept segments `rule` with the spot check written up (at least 10 candidates per segment checked, the sample listed). Required rows: `3502112`, `3503002`, `3513071`, `3513074` (the stub); the 14 P/VACANT parcels of the owner's example (US-101, 18th to 22nd St, Potrero Ave to Vermont St), each confirmed; `3179011`, `3179010`, `4012031`, `4154001`, each decided with a reason, and `4154001`'s 60,882 m² and baseline yield of 2,721 explained whichever way it goes. A totals line per segment (parcels, ha, FZP yield removed).
4. `### Phases` — one subsection per project with Appendix A's field table: `central-freeway-stub` kept as the first phase on its v1 dates; then north to south, the US-101/I-80 interchange with the rest of the Central Freeway, the James Lick Freeway with the Hairball, the Bayshore Freeway to the Alemany interchange; and `i80-rincon` (I-80 west of Rincon Hill). Each: `segments` as `{ cnn }` lists of the segment CNNs (or the stub's v1 line, per the owner's answer below), `rowHalfWidthM` with a PV id, `durationMonths` 30 (PV-hwy) unless better evidence is cited, `dependsOn` (its garage, and the transit carrying the corridor's trips, by the Fillmore rule), `build`, and `freewayLand` (`parcels` from §3, `excluded` with reasons). No two phases of one freeway overlap in [start, open). Which Rincon Hill ramps stay so the Bay Bridge reaches city streets, with the reason.
5. `### Garages` — `garage-alemany` and `garage-rincon` with the field table: `site: { parcel }` on interchange land off the mainline deck (the loops and green between ramps), the footprint's area and why it was chosen, `spaces` = footprint × 5 ÷ 30 (a PV id each), start and duration (PV-garage), opening before the closures they serve; or, where no such footprint exists, the nearest 0-home parcel and why. `garage-south` retired (its row removed; parcel `3901004` an ordinary lot). Garage capacity: three garages against `maxConcurrent` 2; stagger the starts or raise the cap, with the reason.
6. `### Appendix A changes` — tables Plan B transcribes verbatim: `#### Projects added`, `#### Projects changed` (field, v1 value, v1.1 value), `#### Projects removed`, `#### Provenances added` (Appendix A's Provenances layout), `#### Capacity changed` (if any).
7. `### Schedule` — the full dated table in v1's Schedule layout with the v1.1 projects.
8. `### Basemap ids` — per phase, the ids from `basemap-ids.candidates.json` kept or dropped with a reason (a kept-stretch feature never kept), and Task 1's verdict.
9. `### Evidence` — PV-hwy (tier 2, Central Freeway, March 2003 to 9 September 2005); frontage band, phase boundaries and garage spaces tier 4 unless better found; the "20+ years without a public builder" note.
10. `### Open questions for the owner (v1.1)` and an approval line `Approved by the owner on ____.`

- [ ] **Step 1: Write the segment definitions**

From the locked `datasf-streets` raw files (the scratch DuckDB `hwy.duckdb` table `st` holds them), list every `layer = 'FREEWAYS'` CNN and assign each to one segment by the owner's cut points (US-101 at the Alemany interchange; I-80 at the Rincon Hill touchdown; I-280 kept). Write `freeway-land.json` with `parcels: []`, `excluded: []`, `curated` per §3, `ref` per freeway (`US 101`, `I 80`, `I 280`), `removedBy` the phase id or null. `npx prettier --write` it.
Check: every FREEWAYS CNN is in exactly one segment (a one-off query; list any left over and assign it).

- [ ] **Step 2: Generate the candidates**

Run: `npm run pipeline -- lesscars-freeway-land --dataset 2026-11-02-39fbf039`, then `npm run pipeline -- lesscars-basemap`, then `npx prettier --write pipeline/enrichment/lesscars/freeway-land.candidates.json pipeline/enrichment/lesscars/basemap-ids.candidates.json`
Expected: per-segment counts near the recon's P+VACANT areas within 60 m (Central 2.4 ha, James Lick 19.4, Bayshore 17.3, I-280 57.4, I-80 14.8 ha); the four stub parcels and the 14 example parcels among the candidates. A large miss: stop and report.

- [ ] **Step 3: Curate and write §2-§3**

Every candidate of a removed segment checked by hand; kept segments spot-checked. Exclusion reasons name what the land is (park name, school, rail yard, Port), never "looks like".

- [ ] **Step 4: Draft §4-§7 and check the schedule**

Assemble a scratch plan JSON (the scratchpad, not committed) from v1's `plan.json` with §6's changes, and run `checkPlan(plan, schedulePlan(plan))` with a short tsx script.
Expected: `[]`. A problem: change the draft's dates or capacity (it is a draft), and say so in the section.

- [ ] **Step 5: Draft §8-§10**

- [ ] **Step 6: Commit**

```bash
git add docs/lesscars/plan-v1.md pipeline/enrichment/lesscars/freeway-land.json pipeline/enrichment/lesscars/freeway-land.candidates.json pipeline/enrichment/lesscars/basemap-ids.candidates.json
git commit -m "docs(lesscars): draft v1.1 plan section for owner review"
```

`freeway-land.json` with empty parcel lists changes no number: no parcel is marked.

- [ ] **Step 7: Stop for owner review**

Report to the controller: the section's path, totals by segment (parcels, ha, FZP yield removed), the phases with dates, the garages, the open questions. Plan B starts only after the owner approves the section.

---

## Rulings and owner decisions embedded

1. Freeway land is unbuildable everywhere while its freeway stands (owner, 2026-11-03): Task 2 (all runs through `parcels.bin`), reported as counts (Task 2) before anything ships (Plan B).
2. Every SF freeway has a freeway-land list; kept segments may be `rule`-curated after a spot check (spec): Task 9 §3.
3. Structure (dispatch): two plans with the owner's review of the drafted section between them; Task 9 ends this plan.
4. Basemap: check first (Task 1), fallback is the tiles step (Task 7b); ids checked against the dataset's basemap (Task 6).
5. `garage-south` retired: no code names it (`rg` over `src`, `pipeline/lib`, `pipeline/steps`, `pipeline/test`, `e2e`); it is plan content, removed in Plan B.

## Resolved questions

All four recommendations below were accepted as rulings on 2026-11-03 and are recorded in the spec
("Rulings while planning"). Task 9 drafts them as decided, not as questions: phases name CNNs (the
stub moves to `19204001`/`19264001`), the stub depends on `garage-alemany`, the large-lot lift stays
R-4-only and the section says so, and the basemap fallback (Task 7b) is accepted if Task 1 confirms
it.

1. **Phase geometry: CNNs, not drawn lines.** A drawn line leaves the freeway's own `src_streets` centrelines in place, and their 10 m corridors erase most of the freed strip; this is part of why v1's stub freed 0 m². Recommendation: phases name the FREEWAYS-layer CNNs, and the stub moves from its drawn line to CNNs `19204001`/`19264001` (plan-v1's worry about 13th St is handled by 13th St's own kept corridor). Task 9 drafts it that way and asks.
2. **The stub's v1 dependency on `garage-south`.** The spec keeps the stub's v1 dates and dependencies but retires `garage-south`. Recommendation: the stub depends on `garage-alemany` instead, which takes `garage-south`'s 2031 start and 24 months, so the stub still starts in 2033.
3. **The large-lot rule lifts only in R-4 districts.** `localProgramEnvelope` applies 65 ft only to Local Program (R-4) lots (`pipeline/lib/local-program.ts:40-49`); a freed site takes its neighbour's district, so freeway land beside a non-R-4 district does not lift. The spec says "as it already does for freed sites", which is this behaviour. Recommendation: keep it, and say so in the v1.1 section.
4. **The basemap fallback is likely.** The probe while drafting found US-101 merged across the Alemany cut at z11-13. If Task 1 confirms it, Task 7b rewrites `basemap.pmtiles` at build time (a pipeline-only devDependency, `@maplibre/vt-pbf`). Recommendation: accept; the alternative (hiding kept US-101 at low zoom) breaks the spec's "never keep drawing a removed freeway" or its converse.
