# project-records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest the seven DataSF project datasets, link them into projects, and emit `scenarios/fzp/projects.json` (T3, with `rhnaCompletedNet` and DA `phases`), the T4d histories file and `permits.parquet`, guarded by invariants V20–V24.

**Architecture:** A pure, deterministic TS module `pipeline/project-records/` (`deriveProjects(input)`) does all linking and classification over raw SODA rows plus parcel callbacks. A thin step `pipeline/steps/projects.ts` reads the raw pages from the lock, serves the callbacks from DuckDB tables (`parcel_out`, `src_parcels`, scenario-data's `scenario_panel` and `parcel-lineage.parquet`), writes the outputs and hands V21–V24 results to `checkDataset`. The curated enrichment `pipeline/enrichment/multiphase.json` (zod-validated) drives DA phasing.

**Tech Stack:** TypeScript (tsx), Vitest `pipeline` project, DuckDB (`@duckdb/node-api`), zod 4 (pipeline only).

**Spec:** `docs/superpowers/specs/2026-10-16-project-records-design.md` (design: `docs/superpowers/design/2026-10-16-1903-fzp-timelapse.md`). Executors read the spec section each task cites; the plan records the decisions the spec leaves open.

## Global Constraints

Verbatim from the design (spec §3):
- **Evidence hierarchy.** No number reaches the simulation without a tier and a source. A tier-3 or tier-4 number is never presented as data.
- **Determinism.** The same `datasetVersion` and seed always give the same future, on every machine.
- **Honesty of numbers.** Actual completions since the RHNA period start are counted and labelled as actual.
- **First paint.** The whole-city score comes from `parcels.bin`, `projects.json` and `calibration.json`.

Interface and ruling constraints:
- T3 types and `parseProjectsFile` / `ProjectsFormatError` live in `src/lib/timelapse/projects.ts` (step 0, f53b68e). Import them; never redeclare. Any change to a step-0 declaration is an interface request to `main`, not a local edit.
- A4: `parseProjectsFile` stays worker-safe and zod-free (timelapse-sim uses it as the shared validator). zod is allowed only under `pipeline/`.
- A1: `OPEN_DAY` is `Math.fround(3.0e38)`; compare with the exported constant, never a literal.
- T13 names, exactly: table `scenario_panel` (`mapblklot`, `roll_year`, `existing_units`, `base_stories`), file `pipeline/.cache/derived/<datasetVersion>/parcel-lineage.parquet` (`blklot`, `retired_mapblklot`, `current_mapblklot`, `date_rec_drop`).
- `src/lib/timelapse/*` is imported by relative path from `pipeline/` (`../../src/lib/timelapse/projects`).
- Day = `Date.UTC(y, m-1, d) / 86400000` from the leading `YYYY-MM-DD`; valid only in `[0, asOf]` (spec §4.1).
- Repo conventions: Conventional Commits; 2-space indent, single quotes, no trailing commas, 100 columns; every Vitest test calls `expect` (`expect.requireAssertions`). Never compound `cd` with another command: run tests with `npm --prefix <worktree> run test:pipeline -- <file>` or `npx vitest --run --project pipeline <file>` from the worktree root.
- Do not run `npm run signoff`, do not merge, do not upload to R2 or touch remote Cloudflare resources.

## Review Focus

1. **Sparse SODA rows** (fields omitted rather than null, numbers as strings, `"None"`-like junk): every accessor treats a missing key as null and never throws. Pinned in Task 2 (`parse.test.ts` "omitted keys").
2. **Permit address rows that disagree** (status/date fields differing across a permit's rows): permit-level fields come from the primary-address row, else the first row in sorted order, so output never depends on row order. Pinned in Task 2 and the Task 10 permutation property.
3. **A non-PRX pipeline row whose `bpa_no` names an unfetched (non-type-1/2) permit**: it is an excluded alteration, never pipeline-only in flight. Pinned in Task 3 (`link.test.ts` "unresolved bpa_no is an alteration").
4. **Dead projects with an empty live set** still get units for the population test, from their non-superseded permits; otherwise every permit exit would silently vanish from the histories. Pinned in Task 7 (`inflight.test.ts` "dead permit units").
5. **In-flight net check on the latest roll**: a project in the population (net ≥ 1 at filing) whose latest-roll `existingUnits` makes `units − existingUnits < 1` is dropped and counted (`projects.netDropped`), so V20 never fails on real data. Pinned in Task 7.

---

## File map

| file | responsibility |
|---|---|
| `pipeline/sources/datasf.ts` (modify) | `format` field; seven new `DATASF` entries; JSON paging |
| `pipeline/project-records/types.ts` | source ids, dataset ids, parsed record types, `LinkedProject`, `ProjectRecordsInput`, `DeriveResult` |
| `pipeline/project-records/parse.ts` | SODA → typed records (`parseAll`), `dayOf`, `num`, `splitPermits`, `docKind` |
| `pipeline/project-records/parcels.ts` | candidate block-lots of a project → current `ParcelId`s |
| `pipeline/project-records/link.ts` | graph, permit assignment, satellites, children, PPA attach, `ppaLag`, splits, ids, lead permit, live set |
| `pipeline/project-records/classify.ts` | population and pathway |
| `pipeline/project-records/stages.ts` | per-permit days, raw stage days, forward clamp |
| `pipeline/project-records/ends.ts` | end/exit rules, `lastObserved` |
| `pipeline/project-records/inflight.ts` | T3 field rules (label, units, existing, stories, sources), in-flight/stale test, T4d extras |
| `pipeline/enrichment/schema.ts` | zod `MultiphaseFile` schema + `parseMultiphase` |
| `pipeline/project-records/multiphase.ts` | §4.10.2 phases for each PRX master + V24 phase problems |
| `pipeline/project-records/rhna.ts` | `rhnaCompletedNet` + cross-check |
| `pipeline/project-records/derive.ts` | `deriveProjects`, ordered serialisation, counts |
| `pipeline/project-records/invariants.ts` | V20 (file), V21–V24 |
| `pipeline/steps/projects.ts` | raw reading, DuckDB callbacks, outputs, permits.parquet |
| `pipeline/steps/check.ts`, `build.ts`, `fixture.ts`, `config.ts`, `cli.ts` (modify) | wiring |
| `pipeline/enrichment/multiphase.json` | curated live enrichment (AC-11) |
| `pipeline/test/fixtures/mini/projects-raw.ts`, `.../mini/enrichment/multiphase.json` | mini project records (spec §4.9 table) |
| `pipeline/test/project-records/*.test.ts` | unit tests per module |

All `ParcelId`, `Day`, `Stage`, `Pathway`, `ExitReason`, `Provenance`, `ProjectHistory`, `ProjectHistoriesFile`, `STAGE_ORDER` imports come from `src/lib/timelapse/{types,time}.ts` and `src/lib/data/parcel.ts`; `InFlightProject`, `ProjectsFile`, `parseProjectsFile`, `PROJECT_ID_RE` from `src/lib/timelapse/projects.ts`.

---

### Task 1: Lock sources (spec §4.1)

**Files:**
- Modify: `pipeline/sources/datasf.ts`
- Test: `pipeline/test/fetch.test.ts`

**Interfaces:**
- Produces: `DatasfId` gains the seven ids; each `DATASF[id]` gains `format: 'geojson' | 'json'`. `fetchDatasf` requests `…/resource/<dataset>.<format>`, counts `features.length` for geojson and `array.length` for json, and names pages `<id>.page-NNN.<format>`. `FETCH_IDS` picks them up unchanged.

- [ ] **Step 1: Write the failing tests** in `fetch.test.ts` (reuse its fake `Http` pattern):
  - `'json entry pages and counts array rows'`: fake returns 50000 rows then 3 rows for `datasf-planning-projects`; expect `rowCount` 50003, two files named `datasf-planning-projects.page-000.json` / `page-001.json`, URLs start `https://data.sf.gov/resource/qvu5-m3a2.json?`.
  - `'urls carry the §4.1 select and where'`: for every one of the seven ids, the decoded first URL's `$select` equals the spec table's column list exactly and `$where` equals the table's filter (absent where the table says none). Assert the literal strings for `datasf-permits-newcon` (`permit_type in('1','2')`), `datasf-planning-records` (the 18-type list in spec order), `datasf-planning-review` (`project_stage='accepted to approved'`).
  - `'exactly-full json page then empty page locks only the full page'`: 50000 then 0 rows → one file, `rowCount` 50000.
  - `'licences and homepages'`: licences per the spec table (`PDDL-1.0`, `public-domain`, `public-domain`, `PDDL-1.0`, `PDDL-1.0`, `public-domain`, `CC0-1.0`), homepage `https://data.sf.gov/d/<dataset>`.
  - the four existing entries keep `format: 'geojson'` and their existing URLs.
- [ ] **Step 2:** Run `npx vitest --run --project pipeline pipeline/test/fetch.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Lock ids/datasets: `datasf-permits-newcon` `i98e-djp9`, `datasf-planning-projects` `qvu5-m3a2`, `datasf-planning-records` `y673-d69b`, `datasf-planning-review` `d4jk-jw33`, `datasf-unit-completions` `j67f-aayr`, `datasf-housing-production` `xdht-4php`, `datasf-dev-pipeline` `6jgi-cpb4`. Labels: `DataSF Building Permits (new construction)`, `DataSF Planning Projects`, `DataSF Planning Records`, `DataSF Planning Review Time Metrics`, `DataSF Dwelling Unit Completions`, `DataSF Housing Production`, `DataSF SF Development Pipeline`. `$select`/`$where` strings copied from the spec table character for character.
- [ ] **Step 4:** Run the fetch tests, then the whole pipeline project (`npx vitest --run --project pipeline`) → PASS (fixture lock is unchanged, so goldens still pass).
- [ ] **Step 5:** Commit `feat(pipeline): lock the seven project-records DataSF sources`.

---

### Task 2: Types, parsing and parcels (spec §4.1 Parsing, §4.2 Parcels)

**Files:**
- Create: `pipeline/project-records/types.ts`, `parse.ts`, `parcels.ts`
- Test: `pipeline/test/project-records/parse.test.ts`, `parcels.test.ts`

**Interfaces (produces, used by every later task):**

```ts
// types.ts
export type ProjectSourceId = 'datasf-permits-newcon' | 'datasf-planning-projects'
  | 'datasf-planning-records' | 'datasf-planning-review' | 'datasf-unit-completions'
  | 'datasf-housing-production' | 'datasf-dev-pipeline';
export const PROJECT_SOURCE_IDS: readonly ProjectSourceId[]; // in that order
export const DATASET: Record<ProjectSourceId, string>;       // lock id → DataSF id
export type RawRow = Record<string, unknown>;
export interface AddressRow { blklot: string; streetNumber: string | null; streetName: string | null;
  streetSuffix: string | null; primary: boolean }
export interface Permit { number: string; sitePermit: boolean; status: string /* lower-case, '' if absent */;
  statusDay: Day | null; filedDay: Day | null /* filed_date, else permit_creation_date */;
  issuedDay: Day | null; fcdDay: Day | null; completedDateDay: Day | null; lastActivityDay: Day | null;
  stories: number | null; existingUnits: number | null; proposedUnits: number | null; rows: AddressRow[] }
export interface Prj { recordId: string; status: string | null; address: string | null; blklot: string | null;
  openDay: Day | null; closeDay: Day | null; permits: string[]; decision: string | null;
  decisionDay: Day | null; unitsProp: number | null; unitsExist: number | null; newConstruction: boolean;
  sb35: boolean; hsd: boolean; ab2162: boolean; description: string | null }
export interface Child { recordId: string; type: string; status: string | null; blklot: string | null;
  parentId: string | null; openDay: Day | null; closeDay: Day | null }
export interface Review { recordId: string; startType: string | null; startDay: Day | null;
  endType: string | null; endDay: Day | null }
export interface Completion { permit: string; day: Day | null; kind: 'TCO' | 'CFC' | null; units: number | null }
export interface HousingRow { bpa: string | null; form: string | null; netUnits: number | null;
  firstCompletionDay: Day | null }
export interface PipelineRow { idx: number /* position after canonical sort */; blklot: string | null;
  nameaddr: string | null; status: string | null; statusDay: Day | null; approvedDay: Day | null;
  caseNo: string | null; bpaNo: string | null; newUnits: number | null; existingUnits: number | null;
  proposedUnits: number | null; completedNewUnits: number | null; netUnits: number | null;
  description: string | null; da: string | null; prx: boolean /* caseNo ends with 'PRX' */ }
export interface Parsed { asOf: Day; permits: Map<string, Permit> /* key order = ascending number */;
  prjs: Map<string, Prj>; children: Child[]; reviews: Review[]; completions: Completion[];
  housing: HousingRow[]; pipeline: PipelineRow[]; counts: Record<string, number> }
export interface ProjectRecordsInput { asOf: Day; raw: Record<ProjectSourceId, RawRow[]>;
  parcelIds: ReadonlySet<ParcelId>; lineage(blklot: string): ParcelId | null;
  assessorUnits(id: ParcelId, rollYear: number): number | null; latestRollYear: number;
  baseStories(id: ParcelId, rollYear: number): number | null; hiNet: Record<number, number>;
  multiphase: MultiphaseFile /* Task 8 */; areaM2(id: ParcelId): number }
```

(`ProjectRecordsInput` extends the spec's internal type with `multiphase` and `areaM2`, both needed by §4.10.2; internal, not a shared interface.)

```ts
// parse.ts
export function dayOf(v: unknown, asOf: Day): Day | null;   // leading YYYY-MM-DD; null if invalid or outside [0, asOf]
export function isoOf(d: Day): string;                       // 'YYYY-MM-DD'
export function num(v: unknown): number | null;              // Number(v), non-finite / missing / '' → null
export function splitPermits(v: unknown): string[];          // split /[,;\s]+/, drop empties
export function docKind(v: unknown): 'TCO' | 'CFC' | null;  // /tco/i → TCO; /^\s*cfc\s*$/i → CFC
export function asOfFromLock(lock: Lock): Day;               // UTC day of the newest retrievedAt
export function parseAll(raw: Record<ProjectSourceId, RawRow[]>, asOf: Day): Parsed;
// parcels.ts
export function resolveParcels(blklots: Iterable<string | null>, input: Pick<ProjectRecordsInput,
  'parcelIds' | 'lineage'>): { ids: ParcelId[] /* sorted, unique */; mapped: number; unmapped: number };
```

Decisions:
- `parseAll` first sorts each raw array by `canonicalJson(row)` (`pipeline/lib/lock.ts`), so every later step is row-order invariant; `PipelineRow.idx` is the index after that sort.
- Permits group by `permit_number`; permit-level fields come from the row with `primary_address_flag='Y'`, else the first row in sorted order. `rows` keeps every address row, sorted by (`blklot`, street number, name). `blklot` = `block + lot` (both trimmed; null if either missing). Booleans: `site_permit === 'Y'`; PRJ flags `=== 'CHECKED'`.
- Pipeline `status` is trimmed; PRJ `status`/`decision` kept verbatim (trimmed).
- `resolveParcels` maps each candidate: `lineage(b)` (which serves active `src_parcels` blklot→mapblklot first, then parcel-lineage); if that is null and `b` itself is in `parcelIds`, use `b`. Mapped ids not in `parcelIds` count as unmapped. Counts are per distinct non-null candidate.

- [ ] **Step 1: Write failing tests** (`parse.test.ts`):
  - `dayOf('2019-06-01T10:37:18.000', asOf)` = `Date.UTC(2019,5,1)/864e5` (= 18048); `dayOf('2019-06-01', …)` same.
  - clipping: `completed_date` `'1909-06-02T00:00:00.000'` → null; `'2205-03-13T…'` → null; asOf + 1 → null; asOf itself → asOf.
  - `splitPermits('202604229887, 202610139344;201906010001 x')` → `['202604229887','202610139344','201906010001','x']`; `splitPermits(undefined)` → `[]`.
  - `docKind('CFc')` and `docKind('CFC')` → `'CFC'`; `'Initial TCO'`, `'Amended TCO'` → `'TCO'`; `'other'` → null.
  - `num('12')` 12, `num('')` null, `num('abc')` null, `num(undefined)` null.
  - "omitted keys": `parseAll` over one row per source containing only its id field returns records with every other field null/false/`[]` and does not throw.
  - "primary row wins": two rows of one permit, primary row `status: 'issued'`, other `status: 'filed'`; parse in both input orders → `status` `'issued'`, `rows.length` 2.
  - `asOfFromLock` over entries with retrievedAt `2026-10-09T23:00:00.000Z` and `2026-10-10T00:00:00.000Z` → Day(2026-10-10).
- [ ] **Step 2: Write failing tests** (`parcels.test.ts`): condo `0708023` with `lineage` serving `0708023→0708021` → `['0708021']`; retired `3512099` via lineage → `3512012`; an id in neither lineage nor set → dropped, `unmapped` 1; duplicates and nulls collapse; output sorted.
- [ ] **Step 3:** Run both → FAIL. **Step 4:** implement. **Step 5:** run → PASS.
- [ ] **Step 6:** Commit `feat(project-records): parse SODA project rows and resolve parcels`.

---

### Task 3: Linking (spec §4.2)

**Files:** Create `pipeline/project-records/link.ts`; Test `pipeline/test/project-records/link.test.ts`

**Interfaces:**
- Consumes: Task 2 types; `resolveParcels`.
- Produces:

```ts
export const DEAD_STATUSES: ReadonlySet<string>; // withdrawn, cancelled, expired, disapproved, revoked
export interface LinkedProject {
  id: string;
  kind: 'graph' | 'pipelineOnly' | 'ppaOnly';
  anchors: Prj[];            // non-satellite PRJs, by recordId
  primary: Prj | null;       // anchor whose building_permits names the lead permit, else earliest open (tie: lowest id)
  satellites: Prj[];         // sources only
  children: Child[];         // children of anchors, incl. PPAs (attached PPAs too)
  sourceOnlyChildren: Child[]; // children of satellites
  reviews: Review[];         // d4jk rows of anchors
  permits: Permit[];         // all, ascending number
  live: Permit[];            // not dead (and so not superseded)
  superseded: Set<string>;   // dead permits with a later-filed permit in the project
  lead: Permit | null;
  completions: Completion[]; // j67f rows of the project's permits
  pipelineRows: PipelineRow[];
  blklots: string[];         // candidate block-lots (§4.2 Parcels), sorted unique
  parcelIds: ParcelId[];     // resolveParcels(blklots)
}
export function linkProjects(p: Parsed, opts: {
  resolve(blklots: string[]): ParcelId[];
  filedDay(proj: LinkedProject): Day | null;  // Task 5's filedEvidenceDay, injected
}): { projects: LinkedProject[] /* sorted by id */; ppaLag: { days: number; n: number };
      excludedRows: PipelineRow[]; counts: Record<string, number> };
```

Decisions (where the spec leaves a choice):
- **Anchors vs satellites:** a PRJ with ≥ 1 candidate edge (a `building_permits` entry that is a fetched permit) and 0 assigned edges is a satellite; every other PRJ in a component is an anchor (including PRJs naming no permits).
- **Pipeline row joins:** `caseNo` = PRJ `recordId`, `bpaNo` = permit number. **PRX rows never join the graph**: each is its own `pipelineOnly` project `CASE:<caseNo>`. A non-PRX row whose `bpaNo` is set but resolves to no fetched permit, and whose `caseNo` resolves to no PRJ, is an **excluded alteration** (`excludedRows`, units counted later). A non-PRX row with neither id resolving and no `bpaNo` is `pipelineOnly` with id `CASE:<caseNo>` (it always has a case: verified live, no row lacks both).
- **ppaLag:** nearest-rank ⌈0.9·n⌉ over parented PPAs whose project has a `filedDay`, of `filedDay − PPA open`; values < 0 are included as-is; n = 0 → `Infinity`. Computed after parented children join; unparented PPAs then attach (block-lot ∈ project's `blklots`, filed day in `[open, open + ppaLag]`, earliest filed wins, tie lowest id), else become `ppaOnly` (`PPA:<recordId>`, `blklots` = PPA's).
- **Split** (component with ≥ 2 pipeline rows): each row whose `bpaNo` names a permit of the component becomes a project with that permit, the dead permits sharing a resolved parcel with it, and copies of the anchors/children/reviews; rows naming no component permit stay with the remainder project (anchor PRJ + remaining permits; created only if it has permits or rows). All split projects get `PRJ:<primary.recordId>:BP:<leadPermit>`; a remainder without permits keeps `PRJ:<recordId>`.
- **Lead permit:** from `live` (else all permits) by `sitePermit` desc, `proposedUnits` desc (null last), `filedDay` asc (null last), number asc.
- **Ids:** `PRJ:<primary.recordId>` / split form / `BP:<lead>` when no PRJ / `CASE:` / `PPA:`; assert uniqueness and throw `Error('duplicate project id …')`.
- Counts: `link.permitsMultiPrj` (permits named by > 1 PRJ), `link.satellites`, `link.ppaAttached`, `link.ppaOnly`, `link.splitComponents`, `link.pipelineOnly`, `link.excludedRows`.

- [ ] **Step 1: Write failing tests** with hand-made `Parsed` fixtures (helper `parsedOf({...})` in the test file):
  - permit named by PRJ A (open 2018-01-01) and PRJ B (open 2019-03-01), filed 2019-04-01 → assigned to B; filed 2017-06-01 → assigned to the earliest-opened (A).
  - satellite: A loses its only permit to B → A in `satellites`, not `anchors`; one project.
  - PPA by `parent_id`; unparented PPA on the project's lot opened within `ppaLag` before filing attaches; one outside the lag becomes `PPA:<id>`.
  - `ppaLag` over filed−open values `[10, 20, …, 100]` (n = 10) → 90; n = 0 → `Infinity`.
  - two pipeline rows naming permits P1, P2 of one PRJ, plus a third permit P3 → three projects `PRJ:X:BP:P1`, `PRJ:X:BP:P2`, `PRJ:X:BP:P3`; dead P0 on P1's parcel goes with P1.
  - all five id forms appear: `PRJ:`, `PRJ:…:BP:`, `BP:`, `CASE:`, `PPA:`.
  - superseded refile: permit A withdrawn (filed 2020-01-10), B filed 2022-03-01 → `superseded` = {A}, `live` = [B], `lead` = B.
  - "unresolved bpa_no is an alteration": non-PRX row with `bpaNo` 'X999' and no case → in `excludedRows`, not a project.
  - PRX row with a `caseNo` equal to a PRJ id + 'PRX' still yields its own `CASE:` project.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement with union-find over node keys `R:<id>`, `P:<n>`, `C:<id>`, `L:<idx>`, iterating sorted keys. **Step 4:** run → PASS.
- [ ] **Step 5:** Commit `feat(project-records): link PRJ, permits, children and pipeline rows into projects`.

---

### Task 4: Population and pathway (spec §4.3, §4.4)

**Files:** Create `pipeline/project-records/classify.ts`; Test `pipeline/test/project-records/classify.test.ts`

**Interfaces:**
```ts
export const STREAMLINED_RE: RegExp; // spec §4.4 regex, verbatim
export const STREAMLINED_NEGATION_RE: RegExp; // spec §4.4 negation, verbatim
export const DISCRETIONARY_CHILD_TYPES: ReadonlySet<string>; // CUA VAR DNX ENX OFA AHB PHA DVA MAP PCA GPA CTZ COA PTA DRP DRM PPA
export const REFERRAL_TOLERANCE_DAYS = 30; // tier 4, made up (spec §4.4)
export function streamlinedByText(desc: string | null): boolean;
export function pathwayOf(proj: LinkedProject): Pathway | null;
export function isNewConstruction(proj: LinkedProject): boolean; // §4.3 first condition
```
Rules: §4.4 1→4 in order. `pipelineOnly` and `ppaOnly` → `'discretionary'`. Referral: anchor with no streamlined or discretionary evidence and `openDay ≥ earliestPermitFiled − 30` (a null `openDay` is not a referral). Unclassifiable → `null`. Net-unit population is decided in Task 7 (needs units and assessor values).

- [ ] **Step 1: Failing tests:** each of `sb35`, `hsd`, `ab2162` CHECKED → streamlined; text cases `'SB 35'`, `'SB-423'`, `'AB2011'`, `'AB 2162'`, `'Housing Choice - San Francisco'`, `'HCSF'`, `'Section 206.10'`, `'Housing Sustainability District'` → true; `'project is not eligible for SB 423'` → false; `'ADU Local Program'` → false; d4jk row → discretionary; child `DRM` → discretionary; referral PRJ opened 10 days before its permit's filing → permitOnly; opened 40 days before → null (unclassifiable); no PRJ → permitOnly; anchor without evidence and without permits → null; `isNewConstruction` false for a PRJ with `newConstruction` false and no permit, true for `newConstruction` and `unitsProp` 1.
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(project-records): classify pathway and new construction`.

---

### Task 5: Stage entry dates (spec §4.5)

**Files:** Create `pipeline/project-records/stages.ts`; Test `pipeline/test/project-records/stages.test.ts`

**Interfaces:**
```ts
export const PPA_UMBRELLA_DAYS = 7; // tier 4, made up (spec §4.5)
export function permitCompletionDay(p: Permit, completions: Completion[]): Day | null;
export function permitDays(p: Permit, completions: Completion[]): { filed: Day | null;
  issued: Day | null; construction: Day | null; complete: Day | null }; // one permit, no clamp
export function filedEvidenceDay(proj: LinkedProject): Day | null;    // min of §4.5 filed (a)–(d)
export function rawStages(proj: LinkedProject, pathway: Pathway | null): Partial<Record<Stage, Day>>;
export function clampStages(raw: Partial<Record<Stage, Day>>): { entered: Partial<Record<Stage, Day>>;
  clamped: Stage[] };
export function pipelineOnlyHistory(row: PipelineRow): Partial<Record<Stage, Day>> | null; // null = drop
```
Notes: `pathway === null` is treated as discretionary for stage rules (filed/entitled allowed). `permitOnly` never gets `filed`/`entitled`. `permitDays.construction` = FCD for site permits, `issuedDay` for full permits. Completion = first j67f TCO/CFC with units > 0 by day (ties: CFC after TCO), else `completedDateDay` when `status === 'complete'`. Project `complete` only when `live` is non-empty and every live permit has a completion day (max). Pipeline status map from §4.5 (`BP BP Issued` included); unknown status → null (drop).

- [ ] **Step 1: Failing tests:** one per §4.5 row; PPA-umbrella (PPA open 2026-08-03, PRJ open same day, nothing else → no `filed`, `preApplication` 2026-08-03); PPA opened 8 days off keeps PRJ open as filed; parallel permit (discretionary, permit filed, no entitled, no issued) → no `permitFiled`; forward clamp (M1: permit filed 2019-06-01, entitled 2020-03-02 → `permitFiled` 2020-03-02, `clamped` includes `'permitFiled'`); site permit FCD before issuance → construction clamped to issued; completion from first TCO (2019-08-01 TCO 12 units, 2019-11-01 CFC) → 2019-08-01; fallback `completed_date` when no j67f; a two-permit project completes at the max day, and has no `complete` while one live permit lacks a completion; pipeline-only `PL Approved` status 2008-06-12 with approved 2008-05-01 → `{ entitled: 2008-05-01 }` … and approved later than status → `{ entitled: 2008-06-12 }`; invalid status day → null.
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(project-records): stage entry dates with forward clamp`.

---

### Task 6: Ends, exits and lastObserved (spec §4.6, §4.7 first half)

**Files:** Create `pipeline/project-records/ends.ts`; Test `pipeline/test/project-records/ends.test.ts`

**Interfaces:**
```ts
export function lastObserved(proj: LinkedProject, entered: Partial<Record<Stage, Day>>, asOf: Day): Day;
export function endOf(proj: LinkedProject, entered: Partial<Record<Stage, Day>>,
  ctx: { asOf: Day; ppaLag: number }): ProjectHistory['end'];
```
Rules exactly §4.6 1–6. Exit stage = latest entered stage with day ≤ exit day, else the first entered stage; exit day = max(exit day, that stage's entry day). Rule 2's last-dead permit: latest `statusDay`, then highest number; a null `statusDay` uses `lastObserved`. `PPA-only` rule 5 uses `ppaLag`. `lastObserved` = max valid date over the §4.7 list, clamped to `[min entered, asOf]`.

- [ ] **Step 1: Failing tests:** each permit status → reason (`revoked` → `cancelled`); each planning status/decision string in §4.6 (incl. `Withdawn`, `Project Withdrawn`, `Denied`); a live permit beats a PRJ `Closed - Withdrawn` (end open); complete beats a later cancelled permit; `Closed` + no decision + no entitled → withdrawn at latest close (M13: 2016-05-02, stage `filed`); `Closed` with an approval date → open; PPA-only `Closed - Withdrawn` → withdrawn at close; PPA-only open older than `ppaLag` → withdrawn at close else open day; younger → open; exit day earlier than the stage entry is clamped to the entry; `lastObserved` clamps to asOf.
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(project-records): project ends, exits and lastObserved`.

---

### Task 7: In-flight fields, staleness and T4d extras (spec §4.3 net units, §4.7, §4.8)

**Files:** Create `pipeline/project-records/inflight.ts`; Test `pipeline/test/project-records/inflight.test.ts`

**Interfaces:**
```ts
export const STALE_WINDOW_DAYS = 92; // tier 1: dataset refresh cadence
export const MAX_STORIES = 80;
export type SourceRef = InFlightProject['sources'][number];
export function titleCase(s: string): string;                     // '123 MAIN ST' → '123 Main St'; '16TH' → '16th'
export function labelOf(proj: LinkedProject, curated: string | null): string | null;
export function grossUnits(proj: LinkedProject): number | null;   // §4.8 units, see decision
export function unitBearingPermits(proj: LinkedProject): Permit[]; // live, else non-superseded
export function storiesOf(proj: LinkedProject): { stories: number | null; tier: 0 | 3 | null };
export function parseStories(text: string | null): number | null; // rules 2–3, 1..80 else null
export function sourcesOf(proj: LinkedProject): SourceRef[];      // sorted (dataset, id, key), unique
export function existingUnitsAt(ids: ParcelId[], rollYear: number,
  f: ProjectRecordsInput['assessorUnits']): number;               // Σ, null → 0
export function rollYearOf(day: Day, latest: number): number;     // UTC year clamped to [2007, latest]
export function unitsAt(proj: LinkedProject): Partial<Record<Stage, number>>;
export function baseStoriesAt(ids: ParcelId[], rollYear: number, f: ProjectRecordsInput['baseStories']): number | null;
```
Decisions:
- `grossUnits`: Σ `proposedUnits` over `unitBearingPermits` when any is non-null; else primary `unitsProp` when > 0; else first pipeline row `newUnits`. For `pipelineOnly`: the row's `newUnits`. (Using the non-superseded dead permits when the live set is empty keeps permit exits in the population.)
- Population (§4.3): `isNewConstruction` ∧ `grossUnits − existingUnitsAt(parcelIds, rollYearOf(firstEntered))` ≥ 1; `ppaOnly` always in; `pipelineOnly` in when `newUnits ≥ 1`.
- In flight (§4.7): population ∧ (end open ∨ pipelineOnly) ∧ (has a pipeline row ∨ first entered > `pipelineCutoff − 92`) ∧ units ≥ 1 ∧ parcels non-empty ∧ (multiPhase ∨ `units − existingUnits(latest) ≥ 1`, else counted `projects.netDropped`).
- `sourcesOf` lists every linked record (anchors, satellites, children incl. source-only, reviews, permits, completions, pipeline rows) with the §4.8 key table: `i98e-djp9`/`permit_number`, `d4jk-jw33`/`b1_alt_id`, `j67f-aayr`/`building_permit_application`, `6jgi-cpb4`/`case_no` (when `caseNo`) else `bpa_no`; `qvu5-m3a2` and `y673-d69b` omit `key`.
- Stories regex: number words one…twenty; the keyword guard `/\b(construct|erect|new|build)\b/i` must match first and the stories/feet search starts after it; feet → `floor(ft / 10)`.
- `unitsAt`: `filed` = primary `unitsProp` (when non-null); `permitFiled` = Σ unit-bearing `proposedUnits`; `complete` = Σ per permit `max(Σ TCO units, max CFC units)` when the project is complete.

- [ ] **Step 1: Failing tests:** pipeline match, after-cutoff window (first entered 2026-04-28 with cutoff 2026-07-28 → in; 2026-04-27 → stale), stale-open counted, conflict (pipeline row on a project ending `exit`); `sources[].key` per dataset (absent for `record_id`; `'case_no'` for PRX/PRJ pipeline ids; `'bpa_no'` for bpa-only rows); label precedence 0→4 (curated label wins for PRX; `'123 MAIN ST'` title-cased; then `project_address`; then `nameaddr`; then null); assessor `existingUnits` sums parcels with null → 0; stories precedence (field 6 → tier 0; field 0 → parse); `'demolish existing two-story building and construct a new 8-story building'` → 8; `'construct a 65-foot building'` → 6; `'new eighty-one-story'` style out of range → null; `multiPhase` only for PRX; "dead permit units" (all permits withdrawn, 24 proposed → grossUnits 24); "net on latest roll" (units 3, existing 3 latest → dropped, counted).
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(project-records): in-flight fields, staleness and history extras`.

---

### Task 8: Multi-phase enrichment (spec §4.10)

**Files:**
- Create: `pipeline/enrichment/schema.ts`, `pipeline/project-records/multiphase.ts`, `pipeline/test/fixtures/mini/enrichment/multiphase.json`
- Create (placeholder, replaced in Task 13): `pipeline/enrichment/multiphase.json` = `{"schema":1,"projects":[]}`
- Test: `pipeline/test/project-records/multiphase.test.ts`

**Interfaces:**
```ts
// schema.ts — zod; IsoDate = /^\d{4}-\d{2}-\d{2}$/; url = z.url(); searched non-empty when schedule null;
// phases empty when schedule null; separateRef required iff status 'separate'.
export const MultiphaseFileSchema: z.ZodType<MultiphaseFile>;
export type MultiphaseFile = { schema: 1; projects: MultiphaseEntry[] }; // spec §4.10.1 shape exactly
export class MultiphaseFormatError extends Error {}
export function parseMultiphase(json: unknown): MultiphaseFile;   // throws MultiphaseFormatError
// multiphase.ts
export const SCALE_BOUNDS: readonly [0.8, 1.25];
export interface PhaseContext { master: PipelineRow; entry: MultiphaseEntry | null; masterEntitled: Day | null;
  daParcels: ParcelId[] /* before exclusion */; excluded: ReadonlySet<ParcelId>; trackingParcels: ParcelId[];
  projectU: { u: number; n: number } | null; citywideU: { u: number; n: number } | null;
  resolve(blklots: string[]): ParcelId[]; areaM2(id: ParcelId): number }
export function buildPhases(ctx: PhaseContext): { phases: InFlightProject['phases']; parcelIds: ParcelId[];
  mode: 'enriched' | 'fallback' | 'lastResort'; scale: number | null; merged: number; problems: string[] };
export function largestRemainder(units: number[], total: number): number[];
export function median(xs: number[]): number | null;               // mean of the two middles for even n
export function checkMultiphaseFile(f: MultiphaseFile, prxRows: PipelineRow[], asOf: Day): string[]; // V24 file problems
```
Algorithms are spec §4.10.2 verbatim. Decisions: masters are processed in id order and each master's final parcels join `excluded` for later masters; `parcelIds` (master) = sorted (DA parcels − excluded) ∪ phase parcels, else the tracking parcels; a phase whose units scale to 0 merges like a parcel-less phase; P = 0 in the fallback → `lastResort`; round-half-up = `Math.floor(x + 0.5)`. `problems` covers: a `remaining` phase whose resolved parcels are non-empty and all in `excluded`; a scale outside `SCALE_BOUNDS`. `checkMultiphaseFile` covers: unknown `caseNo`; PRX row with `newUnits ≥ 1` lacking an entry; any fact or `retrieved` later than asOf.

Mini enrichment file (spec §4.9 M9/M14): `2007.0001PRX` label `'Fixture Shipyard'`, schedule `{ label: 'Fixture Shipyard DA phasing schedule', url: 'https://example.invalid/fixture-da.pdf', retrieved: '2026-10-01' }`, `searched: []`, phases A (`'Phase A'`, 120, `['3512014']`, null, remaining), B (`'Phase B'`, 180, `['3512002']`, `'2027-03-01'`, remaining), C (`'Phase C'`, 40, `['3512007']`, null, built); every fact `{ url: 'https://example.invalid/fixture-da.pdf', retrieved: '2026-10-01', locator: 'Exhibit B' }`. `2010.0002PRX` label `'Fixture Village'`, `schedule: null`, `searched: [{ url: 'https://example.invalid/fixture-village-search', retrieved: '2026-10-01' }]`, `phases: []`.

- [ ] **Step 1: Failing tests:** schema accepts the mini file; rejects a fact without `url`, without `retrieved`; `schedule: null` with empty `searched` fails; `checkMultiphaseFile` flags a `caseNo` absent from the pipeline and a missing PRX entry; enriched phases in file order with `built`/`separate` excluded (M9 → A 120 [3512014] null, B 180 [3512002] Day(2027-03-01), scale 1); `largestRemainder([1,1,1], 100)` → `[34,33,33]`; scaling R 300 over Σ 240 → factor 1.25 passes, 237.5/300-style factor 0.79 and 1.26 produce a problem; fallback u from project median (u 40, n 1) and the citywide median when none; k = min(P, max(1, round-half-up(R/u))): R 100, u 40, P 1 → one phase of 100 on the lone parcel; R 100, u 40, P 5 → 3 phases 34/33/33 on the three largest parcels by `areaM2`; an enriched phase with no parcels left merges into the earlier phase (units summed, `merged` 1); last resort (no u) → `phases: null`; phase parcels disjoint from `excluded`; Σ phase units = R.
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(project-records): DA multi-phase enrichment and phasing`.

---

### Task 9: rhnaCompletedNet (spec §4.9)

**Files:** Create `pipeline/project-records/rhna.ts`; Test `pipeline/test/project-records/rhna.test.ts`

**Interfaces:**
```ts
export const RHNA_SINCE: Day; // Day(2022-06-30)
export const RHNA_FORMS: ReadonlySet<string>; // '1','2','3','8','6'
export function rhnaCompletedNet(rows: HousingRow[], asOf: Day): { value: ProjectsFile['rhnaCompletedNet'];
  byYear: Record<number, number> /* calendar years wholly inside [since, asOf] */; lagDays: number | null };
export function checkRhna(byYear: Record<number, number>, total: number, hiNet: Record<number, number>,
  tol: { year: number; total: number }): { ok: boolean; detail: string };
```
Provenance exactly: tier 0; label `'Net homes completed since 30 Jun 2022 (actual)'`; sources `[{ label: 'DataSF Housing Production (xdht-4php)', url: 'https://data.sf.gov/d/xdht-4php' }, { label: 'HCD Final RHNA determination for ABAG (2020-06-09)', url: 'https://www.hcd.ca.gov/community-development/housing-element/docs/abagrhna-final060920(r).pdf' }]`; method `'Sum of net_units_completed over xdht-4php rows with first_completion_date in [2022-06-30, asOf], forms 1-2 (new construction), 3 and 8 (alterations, net) and 6 (demolitions, negative), the Housing Inventory definition; cross-checked per calendar year against the Housing Inventory Table 2 net change (tier 1).'`; `n` rows counted; `window` `['2022-06-30', isoOf(asOf)]`. Tolerances: year ±10% of `|hiNet|`, total (over the cross-check years) ±5%.

- [ ] **Step 1: Failing tests:** rows on 2022-06-30 and on asOf count, 2022-06-29 and asOf+1 do not; form 6 −1 subtracts; form `'5'` excluded; fixture extras → units 4, n 3; `byYear` only for years wholly inside; `checkRhna` passes at exactly +10% per year and +5% total, fails just beyond each; `lagDays` = asOf − max first completion.
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(project-records): RHNA net completions with Housing Inventory cross-check`.

---

### Task 10: deriveProjects, serialisation, counts and V20–V24 (spec §2 internal types, §4.9)

**Files:**
- Create: `pipeline/project-records/derive.ts`, `pipeline/project-records/invariants.ts`
- Test: `pipeline/test/project-records/derive.test.ts`, `pipeline/test/project-records/invariants.test.ts`

**Interfaces:**
```ts
// derive.ts
export interface PermitOut { permit_number: string; project_id: string; prj_record_id: string | null;
  dva_record_id: string | null; prx_case_no: string | null; da: string | null; parcel_ids: string[];
  proposed_units: number | null; site_permit: boolean; status: string; live: boolean; superseded: boolean;
  filed_day: number | null; issued_day: number | null; construction_day: number | null;
  complete_day: number | null; status_day: number | null } // sorted per spec §4.9, nulls last
export interface DeriveResult { histories: ProjectHistory[]; file: ProjectsFile; permits: PermitOut[];
  counts: Record<string, number>; warnings: string[]; checks: V2xInputs }
export function deriveProjects(input: ProjectRecordsInput): DeriveResult;
export function serializeProjects(f: ProjectsFile): string;              // minified, T3 key order
export function serializeHistories(f: ProjectHistoriesFile): string;     // minified, T4d key order
// invariants.ts
export interface V2xInputs { asOf: Day; file: ProjectsFile; histories: ProjectHistory[];
  coverage: { matchedUnits: number; rowUnits: number; rows: number }; // V21, rows the records show ended excluded
  rhna: { byYear: Record<number, number>; total: number };            // V22
  multiphase: { problems: string[] /* buildPhases */; fileProblems: string[] /* checkMultiphaseFile */;
    lastResort: string[] /* master ids */; scales: Record<string, number> } } // V24 recomputes sums/disjointness from `file`
export function checkV20(bytes: Buffer, opts: { asOf: Day; parcelIds: ReadonlySet<ParcelId>;
  maxBytes: number; warnBytes: number }): InvariantResult;   // parseProjectsFile + size budget
export function checkV21(i: V2xInputs, min: number): InvariantResult;
export function checkV22(i: V2xInputs, hiNet: Record<number, number>, tol: { year: number; total: number }): InvariantResult;
export function checkV23(i: V2xInputs, rerunIdentical: boolean): InvariantResult;
export function checkV24(i: V2xInputs): InvariantResult;
```
Orchestration order: `parseAll` → `linkProjects` (with `filedEvidenceDay`) → per project: pathway, raw stages + clamp, end, units, population → in-flight set (non-masters) → masters via `buildPhases` → rhna → assemble, sort by id, emit counts. Key order: T3 declaration order (`id, label, parcelIds, pathway, stage, history, units, existingUnits, stories, storiesTier, multiPhase, phases, sources`; phase `units, parcelIds, plannedPermitFiled, source{label,url,retrieved}`; source `dataset, id, key`), `history`/`entered`/`unitsAt` keys in `STAGE_ORDER`, end `kind` first. `permitOnly` T3 `pathway`: unclassifiable histories become `'discretionary'` in T3 and count `projects.pathwayDefaulted`. V23 "each non-null pathway has ≥ 1 history" applies to pathways present in T3 projects. Histories exclude `pipelineOnly` projects.

Counts (keys exactly, AC-7 plus): `projects.inFlight`, `projects.inFlightUnits`, `projects.byPathway.<p>`, `projects.byStage.<s>` (all values present, 0 when none), `projects.staleOpen`, `projects.staleOpenUnits`, `projects.pipelineConflicts`, `projects.pathwayDefaulted`, `projects.excludedAlterationUnits`, `projects.netDropped`, `projects.stories.tier0|tier3|null`, `projects.parcels.mapped|unmapped`, `histories.total`, `histories.clamped.<stage>`, `histories.ppaLagDays`, `histories.ppaLagN`, `rhna.units`, `rhna.crossCheck.<year>`, `rhna.xdhtLagDays`, `params.ppaUmbrellaDays` (7), `params.ppaUmbrellaDays.tier` (4), `params.referralToleranceDays` (30), `params.referralToleranceDays.tier` (4), `multiphase.enriched|fallback|lastResort|merged`, `multiphase.phases.enriched|fallback`, `multiphase.scale.<caseNo>`, `multiphase.u.<caseNo>`, `multiphase.u.<caseNo>.n`, `pipeline.cutoffDay`, plus `link.*` from Task 3. Warning when `rhna.xdhtLagDays > 120`. `ppaLag = Infinity` is reported as −1.

- [ ] **Step 1: Failing tests (`derive.test.ts`)**, using a small hand-made input (3–4 projects, stub callbacks): output passes `parseProjectsFile`; projects sorted by id with T3 key order (`Object.keys` of the first project equals the declaration list); `serializeProjects` contains no whitespace; "permutation property": reversing and rotating every raw array gives byte-identical `serializeProjects` and `serializeHistories` and `JSON.stringify(permits)`; counts contain every key above.
- [ ] **Step 2: Failing tests (`invariants.test.ts`)**, each check failing on a hand-broken input and passing on a good one: V20 duplicate id, unsorted `parcelIds`, `stage` ≠ last history key, permitOnly with `filed`, size over `maxBytes` (and the warn note above `warnBytes`); V21 at 0.89 vs 0.90; V22 edges via `checkRhna`; V23 entered decreasing, `complete` with mismatched day, `exit.stage` not entered, `lastObserved` > asOf, rerun not identical; V24 phase-units sum ≠ units, phase parcels overlapping another in-flight project, `plannedPermitFiled` ≤ entitled, enriched phase without `source`, file problems non-empty, scale 0.79.
- [ ] **Steps 3–4:** implement → PASS (all project-records tests).
- [ ] **Step 5:** Commit `feat(project-records): deriveProjects with ordered output and V20-V24`.

---

### Task 11: Mini project records and expected values (spec §4.9 fixture table)

Runs `deriveProjects` on the mini records with stub callbacks that mirror scenario-data's fixture (until Task 12 swaps in the real panel): parcel set = the 14 mini ids (`3512001`, `3512002`, `8711023C`, `0026T001A`, `3512005`…`3512014`); lineage `3512099 → 3512012`, condo `3512101/102/103 → 3512002`, active blklot = itself; latest roll 2025; assessor units 2025: lot 1 → 2, lot 2 → 3, lot 4 → 3, lot 6 → 2, others null; base stories null; `areaM2` 300.

**Files:**
- Create: `pipeline/test/fixtures/mini/projects-raw.ts` (exports `PROJECT_RAW: Record<ProjectSourceId, RawRow[]>`, SODA shape: lower-case keys, strings, nulls omitted, timestamps `YYYY-MM-DDT00:00:00.000`)
- Test: `pipeline/test/project-records/mini.test.ts`

Record details beyond the spec table (block `3512`, lot `0NN`; the spec table's dates and units are binding, these fill its gaps):
- M1: PRJ lot 010 opened 2019-01-15, `building_permits` `201906010001`; PPA `2018-000001PPA` (parent M1) opened 2018-11-01; ENV child opened 2019-02-01; d4jk start 2019-01-20, end `approval` 2020-03-02; permit status `issued`, rows on lots 010 and 011 (010 primary, `100 FIXTURE ST`); pipeline `Construction` 2021-05-03, `case_no` M1, `bpa_no` the permit, 24 units.
- M2: `new_construction` CHECKED, `number_of_units_prop` 40, description `'Demolish the existing two-story building and construct a new 8-story building with 40 homes'`; pipeline `PL Filed` 2026-05-15, 40 units.
- M3: permit status `filed`; pipeline `BP Filed` 2026-07-28 (this row sets `pipelineCutoff`), `bpa_no` only, 2 units.
- M4: PPA lot 013 opened 2021-03-01, status `Closed`, closed 2021-06-30 (ppaLag from M1 is 75 days, so M4 attaches to nothing).
- M5: lot 013, opened 2017-02-01, `new_construction` CHECKED, 9 units, CUA child opened 2017-02-01 (`Closed - Withdrawn`), PRJ status `Closed - Withdrawn`, close 2018-04-02.
- M6: PRJ lot 006 opened 2016-03-01, d4jk approval 2016-04-15; permit `201605010006` filed 2016-05-01, issued 2017-01-10, FCD 2017-03-01, status `complete`, completed_date 2019-09-15, 12 units; j67f `Initial TCO` 2019-08-01, 12 units.
- M7: permit lot 005, status `filed`, status_date 2014-10-07, 3 units, no PRJ, no pipeline row.
- M8: PRJ `2020-000008PRJ` opened 2020-07-01 naming permit `202006010008` (filed 2020-06-01, issued 2021-03-01, status `issued`, block 3512 lot 099, 4 units); pipeline `BP Issued` 2021-03-01, bpa only, 4 units.
- M9: pipeline-only `2007.0001PRX`, blklot `3512014`, `PL Approved` 2008-06-12, 300 units, `da` `'Fixture Shipyard'`.
- M10: PRJ lot 001 opened 2019-12-01 naming both permits; d4jk start 2020-02-01, end approval 2021-11-01; permit A `202001100010` filed 2020-01-10, status `withdrawn` 2021-01-01; permit B `202203010010` filed 2022-03-01, status `filed`, 6 units; pipeline `BP Filed` 2022-03-01, `case_no` M10, `bpa_no` B, 6 units.
- M11: lot 006; M12: lot 008, PPA `2026-000012PPA` (parent M12) opened 2026-08-03.
- M13: lot 012 opened 2015-04-01, `new_construction` CHECKED, 5 units, status `Closed`, close 2016-05-02.
- M14: pipeline-only `2010.0002PRX`, blklot `3512009`, `PL Approved` 2012-04-02, 100 units, `da` `'Fixture Village'`; PRJ `2010.0002` lot 007 opened 2010-01-05, d4jk approval 2012-03-01, naming permit `201501150014` (lot 007, filed 2015-01-15, issued 2015-06-01, FCD 2015-08-01, status `complete`, completed_date 2017-04-01, 40 units; j67f `CFC` 2017-03-01, 40 units).
- Every pipeline row's `new_pipeline_units` equals its project's expected units (V21 = 1.0). xdht rows exactly the spec's "xdht extras".

- [ ] **Step 1: Write the failing test** asserting the spec table exactly: in-flight ids = `BP:202403150003`, `CASE:2007.0001PRX`, `CASE:2010.0002PRX`, `PRJ:2019-000001PRJ`, `PRJ:2020-000008PRJ`, `PRJ:2020-000010PRJ`, `PRJ:2026-000002PRJ`, `PRJ:2026-000011PRJ`, `PRJ:2026-000012PRJ`; histories-only include `PPA:2021-000004PPA`, `PRJ:2017-000005PRJ`, `PRJ:2016-000006PRJ`, `BP:201410070008`, `PRJ:2015-000013PRJ`, `PRJ:2010.0002`; per-project values from the table (M1 parcels `['3512010','3512011']`, `permitFiled` Day(2020-03-02), `storiesTier` 0; M2 streamlined, stories 8, tier 3; M3 history keys `['permitFiled']`; M4 exit withdrawn at `preApplication`; M5 exit withdrawn at `filed`; M6 complete Day(2019-08-01), `unitsAt.complete` 12; M7 `lastObserved` Day(2014-10-07), `projects.staleOpen` 1; M8 permitOnly, `permitIssued`, parcels `['3512012']`; M9 phases A/B as Task 8; M10 `permitFiled` Day(2021-11-01), units 6, existing 2; M11 history pathway null, T3 discretionary, existing 2, `projects.pathwayDefaulted` 1; M12 `preApplication`, units 12, parcels `['3512008']`; M13 exit withdrawn at `filed` Day(2016-05-02); M14 phases `[{ units: 100, parcelIds: ['3512009'], plannedPermitFiled: null, source: null }]`; `rhnaCompletedNet.units` 4, `n` 3; every non-complete stage is the `stage` of some in-flight project; V20–V24 all ok with fixture thresholds (`pipelineCoverageMin` 1).
- [ ] **Step 2:** Run → FAIL; **Step 3:** write `projects-raw.ts` until it passes (fix data, not code, unless a test exposes a code bug — then fix the code with a unit test in the owning module).
- [ ] **Step 4:** Commit `test(project-records): mini project records with the spec's expected values`.

---

### Task 12: Build step, outputs, invariants wiring and fixture goldens  **[needs scenario-data's panel and fixture on the base]**

Before starting: confirm `main` has sent the scenario-data sha; merge it into `fzp/project-records` (`git merge <sha>`), resolve conflicts (likely `datasf.ts`, `make-fixture.ts`, `sources.lock.json`, `build.ts`, `config.ts`), rerun `npx vitest --run --project pipeline` green before any new code. Re-read scenario-data's actual `scenario_panel` / lineage column names and derived-dir option from its code; if they differ from the T13 names above, stop and message `main`.

**Files:**
- Create: `pipeline/steps/projects.ts`; Test: `pipeline/test/projects-step.test.ts`
- Modify: `pipeline/steps/build.ts` (call after the scenario step, before calibration/manifest), `pipeline/steps/check.ts` (V20 from file + `extras.projectChecks`), `pipeline/config.ts` (`InvariantProfile` gains `pipelineCoverageMin` live 0.9 / fixture 1, `hiNet` live `{2023: 2544, 2024: 1603, 2025: 2669}` / fixture `{2023: 3, 2024: 2, 2025: -1}`, `rhnaYearTol` 0.1, `rhnaTotalTol` 0.05, `projectsMaxBytes` 2e6, `projectsWarnBytes` 1e6), `pipeline/cli.ts` (`check` carries V21–V24 from `report.invariants` like V12), `pipeline/steps/fixture.ts` (`GOLDEN_FILES` += `scenarios/fzp/projects.json`; `--update-golden` copies `derived/<v>/project-histories.json` → `golden/derived/project-histories.json` and the permits rows → `golden/derived/permits.json`), `pipeline/test/fixtures/mini/make-fixture.ts` (writes `raw/<lockId>.page-000.json` from `PROJECT_RAW`, lock entries with `retrievedAt: '2026-10-10T00:00:00.000Z'`, `upstreamVersion: 'fixture'`), `pipeline/test/golden.test.ts` (compare `scenarios/fzp/projects.json`, `derived/project-histories.json` byte for byte, permits rows by value), `pipeline/test/invariants.test.ts` (V20–V24 fail on hand-broken fixture copies).

**Interfaces:**
```ts
export async function writeProjectRecords(o: { db: Duck; lock: Lock; rawDir: string; byName: boolean;
  outDir: string; derivedDir: string; multiphasePath: string; profile: InvariantProfile; asOf: Day })
  : Promise<{ counts: Record<string, number>; warnings: string[]; histories: ProjectHistory[];
              checks: InvariantResult[] /* V21–V24 */ }>;
```
Behaviour: throws `BuildError('lock has no entry for <id>')` for a missing source; reads pages as JSON arrays; builds callbacks into `Map`s from `SELECT id, area_m2 FROM parcel_out`, `SELECT blklot, mapblklot FROM src_parcels WHERE active`, `read_parquet('<derivedDir>/parcel-lineage.parquet')`, `SELECT mapblklot, roll_year, existing_units, base_stories FROM scenario_panel`; `latestRollYear` = max `roll_year`; `parseMultiphase` failure → `BuildError`; runs `deriveProjects` twice (V23 rerun identity); writes `outDir/scenarios/fzp/projects.json`, `derivedDir/project-histories.json`, and `derivedDir/permits.parquet` via a temp NDJSON + `COPY (SELECT … typed columns …) TO … (FORMAT parquet)` with the spec's column types and sort. Live multiphase path `pipeline/enrichment/multiphase.json`; fixture `pipeline/test/fixtures/mini/enrichment/multiphase.json`. `BuildOpts` gains `derivedRoot?` (default `pipeline/.cache/derived`) unless scenario-data already added an equivalent; reuse theirs.

- [ ] **Step 1:** `projects-step.test.ts` with stub DuckDB tables (`parcel_out`, `src_parcels`, `scenario_panel`, a lineage parquet written by the test): writes all three outputs; permits.parquet columns and types read back via DuckDB `DESCRIBE`; missing lock entry → `BuildError`; bad multiphase JSON → `BuildError`. FAIL → implement → PASS.
- [ ] **Step 2:** Wire build/check/config/cli/fixture; regenerate the mini fixture (`npx tsx pipeline/test/fixtures/mini/make-fixture.ts`) and goldens (`npm run pipeline -- fixture --update-golden`); inspect `scenarios/fzp/projects.json` and the histories by eye against the Task 11 values (they must now come from the real panel; if scenario-data's numbers differ, the goldens follow theirs per spec §4.9). Point `mini.test.ts` at the built output or keep its stubs if they match the panel exactly.
- [ ] **Step 3:** Golden + invariants tests: all-pass on the real fixture; V20–V24 each fail on a hand-broken copy (edit `projects.json` for V20; pass mutated `projectChecks` inputs for V21–V24). Golden permits row for M14's completed permit has `prx_case_no` `'2010.0002PRX'`.
- [ ] **Step 4:** Run `npx vitest --run --project pipeline` and `npm run check` → PASS.
- [ ] **Step 5:** Commit `feat(pipeline): build projects.json, histories and permits.parquet with V20-V24`.

---

### Task 13: Curated live enrichment, docs and live checks (AC-10, AC-11)

**Files:**
- Replace: `pipeline/enrichment/multiphase.json` (from the curation research draft; every PRX row with units)
- Modify: `docs/dev/pipeline.md` (V20–V24 in Invariants; the seven new sources in the intro/Commands; `pipeline/enrichment/multiphase.json` and how to curate it — rules from spec §4.10.1; derived files in "Where things land"); `CLAUDE.md` only if its pipeline row needs a new doc pointer
- Create: `pipeline/test/project-records/live.test.ts` (skipped unless a non-fixture `pipeline/out/<v>/report.json` exists: V21 and V22 ok, `projects.inFlightUnits` in [40000, 100000])

- [ ] **Step 1:** Validate the curated file: `parseMultiphase` passes; a unit test asserts the committed file names exactly the PRX case numbers given by the curation report with units, and that `2007.0946PRX`, `2007.0903PRX`, `2014.1370PRX` have a schedule and ≥ 1 remaining phase.
- [ ] **Step 2:** Live smoke (scratchpad only, not committed): fetch the seven sources and `acdm-wktn` `mapblklot,blklot,active` live, run `deriveProjects` with assessor/base callbacks returning null, record in-flight count/units, V21, V22, V24 and `multiphase.enriched|fallback` for the PR text. Fix curation where V24 flags a phase.
- [ ] **Step 3:** Docs; run `npx prettier --check` on changed files and the pipeline tests.
- [ ] **Step 4:** Commit `feat(pipeline): curate DA multiphase enrichment and document V20-V24`.
