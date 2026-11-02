# /lesscars Plan 1 of 3: Plan Format, Engine Regimes and Paired Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dataset build that reads a fixed fewer-cars plan, checks it (dependencies, the Fillmore rule, construction capacity), carves freed land from street right-of-way, recomputes SB 79 against the transit network as it stands each year, runs the engine in Node over paired plan/baseline seeds, and publishes the summary, the representative future's timeline and the plan under `data/<v>/scenarios/lesscars/`; plus a research document drafting the real plan, ending at an owner review.

**Architecture:** Shared pure code lives in `src/lib/data/lesscars/` (plan types and parser, scheduler and checks, network snapshots, output codec), so the pipeline and the Plan 2 page read one definition and it is inside the `datasetVersion` hash. The engine gains a general form of its retired law switch: `SimInput.regimes` (a list of dated parcel views with a piecewise initiation hazard; a project keeps the regime of its initiation month) and `SimInput.reservedFrom` (a dated reservation per parcel: kept only if no project is under way or built there on its day, then no new initiation from that day; the engine reports which reservations held in each run). A new pipeline step `writeLessCars` runs after the policy step, inside `build`, so it has DuckDB, the chunk records, `parcels.bin` and `policy.bin`. Infrastructure is built and tested against a small fixture plan; the real plan is researched in Task 1 and wired in Plan 3 after the owner approves it.

**Tech Stack:** TypeScript, Vitest (server and pipeline projects), DuckDB spatial (`@duckdb/node-api`), tsx, the existing engine (`src/lib/sim/scenario/`) and generator.

**Spec:** `docs/superpowers/specs/2026-11-01-lesscars-design.md` (approved, binding). Read it before each task. The plan sequence: this plan (data and runs), `2026-11-01-lesscars-2-page.md` (the `/lesscars` route), `2026-11-01-lesscars-3-plan-content.md` (wiring the owner-approved plan into the live build).

## Global Constraints

- Window: the plan runs **2028-01-01 to 2068-12-31** (owner). The engine still starts at `projects.asOf`; both arms share everything before the plan's first effect.
- Law: from 2028 to the switch day, FZP as written; from the switch day, per lot **the larger of FZP and SB 79** where SB 79's status is `applies`, the lot is not `exemptPermanent`, and SB 79 is more permissive (`mostPermissive`, `src/lib/data/stock-layers.ts:8`; a tie keeps FZP). This is the retired `CURRENT_LAW_SWITCH` rule (`git show 53e8d5f:docs/dev/sim-levers.md`, "The law switch"). The temporary exemptions are not applied after the switch.
- Switch day: **2032-01-31** (accepted by the owner in plan review; the retired switch's day). One constant, `LC.switchDay` in `pipeline/lesscars-config.ts`, tier 4 (an assumption, not a sourced lapse date).
- Parking converts in step with transit (owner; spec "The initiative builds", commit cf8b078): every `parking-conversion` depends directly on a transit project that serves its site (a stop of that project within ½ mile, `SQL_VARS.tod_half_m` = 804.672 m, of the parcel outline) and starts after it opens. Until its start the site is an ordinary lot in both arms; if in a given seed a project there began before the start and had not exited by it, the conversion does not happen in that seed. An `edge-garage` on an existing parcel follows the same dated reservation from its start.
- "Transit-unlocked" counts any change of a lot's engine row caused by plan transit, a closer stop of the same tier included (owner, plan review).
- SB 79 is recomputed against the network as it stands at each plan opening day. Subway stops are tier 1 (mode `heavy-rail`); tram stops tier 2 (mode `light-rail`); BRT and bus-lane corridor stops tier 2 through the tier-2 id set; frequency on a mixed-traffic bus line alone changes nothing.
- The baseline uses the same law and switch day on today's `transit.json`, with no plan.
- Amenities add zero homes: `street-change`, `tram-priority`, `bus-lane`, `car-shuttle` and `transit-line` projects never create a site and appear in no housing number.
- Freed land and converted parking are built by scheduled builds (start, duration, full fill of the envelope in force at the build's start day), never by the engine's initiation draw. Every other lot is built by the engine.
- No plan project takes existing homes: parking and garage parcels must have `existingUnits` 0 in `parcels.bin`; freed land excludes every parcel by construction.
- Fillmore rule: a car-closing project (`street-removal`, `highway-truncation`, a `street-change` whose lanes include no `car`) must depend on at least one transit project, and its car closure (its start day) is on or after the latest open day of every transit project it depends on. A violation fails the build.
- Every plan parameter is a `Param` carrying a `Provenance` (`src/lib/timelapse/types.ts:53`); unsourced values are tier 4 with "invented" in the label, never hidden.
- Evidence hierarchy for every number: per-record data > official aggregates > inferences > literature > invented (tiers 0 to 4 as the project uses them).
- Heavy work stays off CI: the full paired run happens in the local `npm run pipeline -- build`; the fixture and `test:pipeline` use `FIXTURE_PROFILE.lesscarsSeeds` (5).
- No change to `/sim`, its levers, or `DEFAULT_LEVERS`; an engine input without `regimes` and `reservedFrom` gives byte-identical results (the goldens).
- `fixture-0` and `pipeline/test/fixtures/mini/golden/` are regenerated by the real pipeline only (`npm run pipeline -- fixture --update-golden`); never hand-edit them.
- Code style: 2-space indent, single quotes, no trailing commas, 100 columns. Vitest `expect.requireAssertions`: every test calls `expect`.
- Conventional Commits. No Claude attribution anywhere (no `Co-Authored-By`, no generated-with footers). Multi-line commit messages through a temp file and `git commit -F`, never heredocs. Never compound `cd … && cmd`.
- No new runtime dependency. No upload, no `wrangler.jsonc` change.

## Review Focus

1. Two transit projects opening on the same day, or one opening exactly on the switch day, give one regime at that day, never two equal days (the engine throws on non-ascending days). Test: Task 7 Step 1 (`regimeDays merges equal days`).
2. A plan whose transit all opens before the switch has exactly one plan regime, at the switch day, with every pre-switch opening already in its network; no regime is dated before the switch. Test: Task 7 Step 1 (`pre-switch openings fold into the switch regime`).
3. A seed where the market reaches a parking site first: a project initiated there before the conversion's start and not exited by it voids the conversion in that seed only (no build, no reservation, the lot runs as in the baseline), while a project that exited before the start leaves the conversion in place. A pair whose plan arm has fewer homes than its baseline (a garage on a lot the baseline later builds on) gives a negative difference; the four sources still sum to the total exactly, per seed and in the means, and the band may go below 0. Tests: Task 4 Step 1 (`reservedFrom: kept, voided by an active project, kept after an exit`), Task 8 Step 1 (`a voided conversion has no build in that seed`, `negative difference: parts still sum`).
4. A freed piece too thin for any building is kept as a site with 0 homes and counted in `lesscars.sites.zero_yield`, not an error; a freed piece with no parcel within `LC.neighbourM` takes the nearest parcel's zoning. Test: Task 6 Step 1.
5. A plan naming a CNN, stop id or parcel the data lacks, a parking parcel with homes, or a parking conversion no transit dependency serves, fails the build naming the project and field, with nothing written under `scenarios/lesscars/`. Test: Task 9 Step 1 (`bad plan data fails the build`).

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `docs/lesscars/plan-v1.md` | Drafted plan content with sources and tiers; owner gate | 1 |
| `src/lib/data/lesscars/plan.ts` (+ `plan.test.ts`) | Plan types, constants, `parseLessCarsPlan`, kind helpers | 2 |
| `src/lib/data/lesscars/fixtures/tiny-plan.ts` | In-code plans for unit tests | 2 |
| `src/lib/data/lesscars/schedule.ts` (+ test) | `schedulePlan`, `checkPlan`, window constants | 3 |
| `src/lib/sim/scenario/types.ts`, `input.ts`, `engine.ts` (+ `engine-regimes.spec.ts`) | `regimes`, `reservedFrom`, `Sink.reservation`, `Schedule.regime` | 4 |
| `pipeline/lib/version.ts`, `chreode.config.ts`, `.github/workflows/pipeline.yml`, `pipeline/test/engine-node.test.ts`, `pipeline/test/fixtures/engine-node-smoke.ts` | Engine in Node, hash coverage | 4 |
| `pipeline/sources/datasf.ts`, `pipeline/sources/normalise.ts`, `pipeline/steps/fetch.ts`, mini `make-fixture.ts`, README | `datasf-streets` back as a page-only source | 5 |
| `pipeline/lesscars-config.ts` | `LC` parameters with cites | 6 |
| `pipeline/sql/84_lesscars_sites.sql`, `pipeline/steps/lesscars-sql.ts`, `pipeline/lib/lesscars/sites.ts` (+ tests), `pipeline/test/lesscars-helpers.ts` | Freed-land carving, freed records, neighbour zoning; shared mini-build test helper | 6 |
| `pipeline/test/fixtures/mini/enrichment/lesscars-plan.json` | The fixture plan | 6 |
| `src/lib/data/lesscars/network.ts` (+ test), `pipeline/lib/sb79.ts` | Network snapshots; `stopTiers` tier-2 set argument | 7 |
| `pipeline/sql/85_lesscars_reach.sql`, `pipeline/lib/lesscars/regimes.ts` (+ test) | Reach of changed stops, per-day SB 79 rows, regime views, site rows | 7 |
| `src/lib/data/lesscars/codec.ts` (+ test), `pipeline/lib/lesscars/runs.ts` (+ test) | Output files; paired runs, attribution, summary, representative timeline | 8 |
| `pipeline/steps/lesscars.ts`, `pipeline/steps/build.ts`, `pipeline/steps/manifest.ts`, `src/lib/data/manifest.ts`, `pipeline/steps/upload.ts`, `pipeline/steps/verify.ts`, `pipeline/config.ts`, goldens, `fixture-0`, `docs/dev/lesscars.md`, `CLAUDE.md` | Step wiring, manifest keys, fixture outputs, developer doc | 9 |
| `pipeline/steps/check-lesscars.ts`, `pipeline/steps/check.ts`, `docs/dev/pipeline.md` | V35, CI cost check | 10 |

---

### Task 1: Draft the v1 fewer-cars plan (research; owner gate)

Research, not code. Independent of Tasks 2 to 10, which run against the fixture plan; only Plan 3 waits on this task's gate.

**Files:**
- Create: `docs/lesscars/plan-v1.md`

**Interfaces:**
- Consumes: the spec's "Drafting the plan", "Candidate places", "The scenario" and References; the plan format of Task 2 (field names below) so the appendix maps one-to-one onto `plan.json`.
- Produces: an owner-reviewed document that Plan 3 transcribes into `pipeline/enrichment/lesscars/plan.json`.

Builder's call: parking sites enter the build as parcels the plan names (found here from per-record assessor data), not as a new pipeline source, so every site the build converts was reviewed by the owner.

- [ ] **Step 1: Gather the data questions the plan needs answered from the repo's own data**

Answer each with a recorded query (DuckDB over `pipeline/.cache/norm/*.parquet` or the live `out/<v>/` files when present; if no live cache exists, say so and use the DataSF API directly, recording the URL):
- Parking sites: which `datasf-assessor-roll` `use_code` / `property_class_code` values mean surface lot or parking garage, and the candidate parcels (id, area, existing homes, zoning, in-flight project if any). Exclude any parcel with homes; note any in-flight `projects.json` row on a candidate (it may void the conversion in some futures). For each candidate, name the plan transit project that serves it (a stop within ½ mile).
- Whether DataSF Streets `3psu-pn9h` carries the freeway segments needed (I-280 spur north of 16th, Central Freeway stub, US-101 on Van Ness and Lombard): list the CNNs or say they are missing (Plan format then uses `{ line, provenance }`).
- Existing Muni stop ids on each candidate BRT corridor, from `transit.json`.

- [ ] **Step 2: Evaluate the candidate places and draft the projects**

For each of the spec's six candidates (Geary subway and expressway trench; I-280 spur; Central Freeway stub and Fell/Oak; US-101 on Van Ness/Lombard; Central Subway north; 19th Avenue/M-line) and the owner's starting ideas (edge garages and the car-shuttle line; sidewalks restored; bus lanes; tram priority; pedestrian and service-only streets; parking conversions), write: kind, geometry reference, stops and mode, peak trips per hour, start year, duration, dependencies, `rowHalfWidthM` for removals, build start and duration for sites, and the reason it is in or out. Every number gets a tier and a source; rank by the hierarchy; an unsourced number is tier 4 and says "invented". Never cite a source you did not open.

- [ ] **Step 3: Draft construction capacity and the schedule**

One `maxConcurrent` per capacity kind (`transit`, `street`, `garage`, `housing`) with evidence; a year-by-year table showing every closure follows its replacing transit (Fillmore rule) and capacity is never exceeded.

- [ ] **Step 4: Write the document**

Sections: Intent (one paragraph); Method and evidence hierarchy; Data findings (Step 1, with queries); Projects (one subsection each); Capacity; Schedule table; What is left out and why; Open questions for the owner (at least the switch year, spec open question 1); Appendix A: a table per project with exactly the Task 2 field names; Appendix B: sources. End with the line `Owner review: pending`.

- [ ] **Step 5: Format and commit**

Run: `npx prettier --write docs/lesscars/plan-v1.md`
Expected: file formatted.

```bash
git add docs/lesscars/plan-v1.md
git commit -m "docs(lesscars): draft v1 fewer-cars plan for owner review"
```

- [ ] **Step 6: Owner gate**

Hand the document to the owner. Do not start Plan 3 until the owner has replaced `Owner review: pending` with an approval line (date and any changes). Tasks 2 to 10 do not wait on this step.

---

### Task 2: Plan format and parser

**Files:**
- Create: `src/lib/data/lesscars/plan.ts`, `src/lib/data/lesscars/plan.test.ts`, `src/lib/data/lesscars/fixtures/tiny-plan.ts`

**Interfaces:**
- Consumes: `Provenance` (`src/lib/timelapse/types.ts:53`); `ParcelId` (`src/lib/data/parcel.ts`). Imports nothing from `$lib` at runtime (relative imports only, like the rest of `src/lib/data`).
- Produces:

```ts
export const LESSCARS_PLAN_SCHEMA = 1;
export const PROJECT_KINDS = ['transit-line', 'tram-priority', 'bus-lane', 'street-change',
  'highway-truncation', 'street-removal', 'parking-conversion', 'edge-garage', 'car-shuttle'] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];
export const TRANSIT_KINDS: readonly ProjectKind[]; // transit-line, tram-priority, bus-lane
export const TRANSIT_MODES = ['subway', 'tram', 'brt'] as const; export type TransitMode;
export const LANE_USES = ['car', 'bus', 'bike', 'pedestrian', 'sidewalk', 'service', 'tram'] as const;
export type LaneUse;
export const CAPACITY_KINDS = ['transit', 'street', 'garage', 'housing'] as const;
export type CapacityKind;
export interface Param { value: number; provenance: Provenance }
export type SegmentRef = { cnn: string[] } | { line: [number, number][]; provenance: Provenance };
export interface PlanStop { id: string; name: string; lngLat: [number, number] | null } // null = existing transit.json stop
export interface SiteBuild { startYear: number; durationMonths: Param }
interface ProjectBase { id: string; label: string; startYear: number; durationMonths: Param; dependsOn: string[] }
export type PlanProject =
  | (ProjectBase & { kind: 'transit-line'; mode: TransitMode; stops: PlanStop[]; peakTph: Param; alignment: [number, number][] })
  | (ProjectBase & { kind: 'tram-priority'; routeIds: string[]; segments: SegmentRef[]; peakTph: Param })
  | (ProjectBase & { kind: 'bus-lane'; routeIds: string[]; stopIds: string[]; segments: SegmentRef[]; peakTph: Param })
  | (ProjectBase & { kind: 'street-change'; segments: SegmentRef[]; lanes: LaneUse[] })
  | (ProjectBase & { kind: 'highway-truncation' | 'street-removal'; segments: SegmentRef[]; rowHalfWidthM: Param; build: SiteBuild | null })
  | (ProjectBase & { kind: 'parking-conversion'; parcel: ParcelId; build: SiteBuild })
  | (ProjectBase & { kind: 'edge-garage'; site: { project: string } | { parcel: ParcelId }; spaces: Param })
  | (ProjectBase & { kind: 'car-shuttle'; garages: string[]; alignment: [number, number][]; peakTph: Param });
export interface CapacityRule { kind: CapacityKind; maxConcurrent: number; provenance: Provenance }
export interface LessCarsPlan { schema: 1; id: string; label: string; capacity: CapacityRule[]; projects: PlanProject[] }
export class PlanFormatError extends Error { readonly path: string }
export function parseLessCarsPlan(json: unknown): LessCarsPlan;
export function capacityKindOf(p: PlanProject): CapacityKind;
export function closesToCars(p: PlanProject): boolean;
export const NEW_STOP_PREFIX = 'lc:';
export const TINY_PLAN: LessCarsPlan; // fixtures/tiny-plan.ts
export function tinyPlan(edit?: (p: LessCarsPlan) => void): LessCarsPlan; // deep copy, then edit
```

Builder's calls (state them in the module comment): a project's start is 1 January of `startYear` (the spec gives "a start year"); a parking conversion's own start and duration are its clearance, and its `build` is the housing; a garage is always an `edge-garage` project referencing a site, so a freed project whose land holds a garage has `build: null`; a parking conversion or garage names exactly one parcel (a multi-lot site is several conversions on one schedule), because the engine keeps or voids each dated reservation per parcel and a half-voided multi-lot site would leave lots idle.

- [ ] **Step 1: Write the failing tests** (`plan.test.ts`)

```ts
it('parses TINY_PLAN and round-trips through JSON', () => {
  expect(parseLessCarsPlan(JSON.parse(JSON.stringify(TINY_PLAN)))).toEqual(TINY_PLAN);
});
it('rejects schema 2, an unknown kind and an unknown key with the path', () => {
  expect(() => parseLessCarsPlan({ ...TINY_PLAN, schema: 2 })).toThrow(/schema/);
  const bad = tinyPlan((p) => ((p.projects[0] as { kind: string }).kind = 'tunnel'));
  expect(() => parseLessCarsPlan(bad)).toThrowError(expect.objectContaining({ path: 'projects.0.kind' }));
  expect(() => parseLessCarsPlan({ ...TINY_PLAN, extra: 1 })).toThrow(/extra/);
});
it('rejects a Param without provenance, a non-integer startYear and a new stop without lngLat', () => { /* three expects, each on the path */ });
it('rejects a new stop id without the lc: prefix and an existing stop with lngLat', () => { /* two expects */ });
it('closesToCars', () => {
  expect(closesToCars(project('street-removal'))).toBe(true);
  expect(closesToCars(project('highway-truncation'))).toBe(true);
  expect(closesToCars(streetChange(['bus', 'bike', 'sidewalk']))).toBe(true);
  expect(closesToCars(streetChange(['car', 'bus']))).toBe(false);
  expect(closesToCars(project('bus-lane'))).toBe(false);
});
it('capacityKindOf', () => {
  expect(capacityKindOf(project('transit-line'))).toBe('transit');
  expect(capacityKindOf(project('street-removal'))).toBe('street');
  expect(capacityKindOf(project('edge-garage'))).toBe('garage');
  expect(capacityKindOf(project('parking-conversion'))).toBe('street'); // clearance; its build counts as housing in checkPlan
});
```

`TINY_PLAN` holds one project of every kind (ids `subway`, `tram`, `buslane`, `ped`, `hwy`, `removal`, `parking`, `garage`, `shuttle`), capacity rules for all four kinds, `hwy` depending on `subway`, `ped`, `removal` and `parking` on `buslane`, `garage` on `hwy` with `site: { project: 'hwy' }` and `hwy.build` null.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest --run --project server src/lib/data/lesscars/plan.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `plan.ts` and `fixtures/tiny-plan.ts`**

Hand-written guards in the style of `parseSimLevers` (`src/lib/sim/levers/types.ts:186`): the first bad field throws `PlanFormatError` with a dotted path; unknown keys fail.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest --run --project server src/lib/data/lesscars/plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/lesscars
git commit -m "feat(lesscars): plan format and parser"
```

---

### Task 3: Scheduler and plan checks (Fillmore, dependencies, capacity)

**Files:**
- Create: `src/lib/data/lesscars/schedule.ts`, `src/lib/data/lesscars/schedule.test.ts`

**Interfaces:**
- Consumes: Task 2's types; `MONTH_DAYS`, `Day` (`src/lib/timelapse/time.ts:7,10`).
- Produces:

```ts
export const LESSCARS_START: Day;   // 2028-01-01
export const LESSCARS_HORIZON: Day; // 2068-12-31
export function yearStart(year: number): Day; // Date.UTC(year, 0, 1) / 86400000
export interface ProjectTimes {
  id: string;
  startDay: Day;                 // yearStart(startYear)
  openDay: Day;                  // startDay + Math.round(durationMonths.value * MONTH_DAYS)
  closeDay: Day | null;          // car closure: startDay when closesToCars, else null
  availableDay: Day | null;      // site ready: openDay for removals/truncations/parking, else null
  build: { startDay: Day; completeDay: Day } | null;
}
export interface PlanSchedule { times: Map<string, ProjectTimes> }
export function schedulePlan(plan: LessCarsPlan): PlanSchedule;
export type PlanProblemCode = 'duplicate-id' | 'unknown-dependency' | 'cycle' | 'outside-window'
  | 'starts-before-dependency' | 'no-transit-dependency' | 'fillmore' | 'build-before-available'
  | 'garage-site' | 'site-reused' | 'duplicate-stop' | 'capacity' | 'parking-no-transit';
export interface PlanProblem { code: PlanProblemCode; project: string; message: string }
export function checkPlan(plan: LessCarsPlan, s: PlanSchedule): PlanProblem[]; // sorted by project, then code
export function inProgress(plan: LessCarsPlan, s: PlanSchedule, kind: CapacityKind, day: Day): number;
```

Rules `checkPlan` applies (each one problem per offending project): ids unique; every `dependsOn` and `garages` id exists; no dependency cycle; every start, open, build start and build completion inside `[LESSCARS_START, LESSCARS_HORIZON]`; start on or after every dependency's `openDay`; every `parking-conversion` depends directly on at least one `TRANSIT_KINDS` project (`parking-no-transit`; that the dependency serves the site is a data check, Task 9); car-closing projects depend on at least one `TRANSIT_KINDS` project (`no-transit-dependency`) and `closeDay` ≥ each transit dependency's `openDay` (`fillmore`); `build.startDay` ≥ `availableDay`; an `edge-garage` on `{ project }` names a removal or truncation with `build: null` and starts on or after its `availableDay` (`garage-site`); no parcel or freed project is used by two sites (`site-reused`); new stop ids unique across the plan (`duplicate-stop`); for each `CapacityRule`, `inProgress` never exceeds `maxConcurrent` on any start day (`capacity`; a project is in progress on `[startDay, openDay)`, a build on `[startDay, completeDay)` and counts as `housing`). Builder's call: the Fillmore check is a hard failure on the start day, because the spec says closure must follow opening and construction is when the street closes.

- [ ] **Step 1: Write the failing tests**

```ts
it('schedules TINY_PLAN: open = start + round(months × MONTH_DAYS)', () => {
  const t = schedulePlan(TINY_PLAN).times.get('subway')!;
  expect(t.startDay).toBe(yearStart(TINY_PLAN.projects[0].startYear));
  expect(t.openDay).toBe(t.startDay + Math.round(TINY_PLAN.projects[0].durationMonths.value * MONTH_DAYS));
  expect(t.closeDay).toBeNull();
});
it('TINY_PLAN has no problems', () => expect(checkPlan(TINY_PLAN, schedulePlan(TINY_PLAN))).toEqual([]));
it('fillmore: a removal starting the year before its transit opens', () => {
  const p = tinyPlan((q) => (byId(q, 'hwy').startYear = byId(q, 'subway').startYear));
  expect(codes(p)).toContainEqual({ code: 'fillmore', project: 'hwy' });
});
it('no-transit-dependency: a pedestrian street depending only on a street change', () => { /* expect code */ });
it('parking-no-transit: a parking conversion depending only on a street removal', () => { /* expect code */ });
it('cycle, unknown-dependency, duplicate-id, duplicate-stop, site-reused', () => { /* one expect each */ });
it('outside-window: a start in 2027 and a build completing in 2069', () => { /* two expects */ });
it('build-before-available and garage-site', () => { /* two expects */ });
it('capacity: three transit projects overlapping with maxConcurrent 2', () => {
  expect(codes(threeOverlapping)).toContainEqual({ code: 'capacity', project: expect.any(String) });
  expect(inProgress(threeOverlapping, schedulePlan(threeOverlapping), 'transit', overlapDay)).toBe(3);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest --run --project server src/lib/data/lesscars/schedule.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `schedule.ts`**

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest --run --project server src/lib/data/lesscars`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/lesscars
git commit -m "feat(lesscars): plan scheduler and checks (Fillmore rule, capacity)"
```

---

### Task 4: Engine regimes (the restored law switch) and dated reservations; the engine in Node

**Files:**
- Modify: `src/lib/sim/scenario/types.ts:22-60` (`Schedule`, `SimInput`), `src/lib/sim/scenario/input.ts:73-273` (`Precompute`, `skipBounds`, `precomputeOf`), `src/lib/sim/scenario/engine.ts:191-239` (`Run`, `runOf`), `:808-932` (`initiationMonth`, `initiationDay`, `simulatedProject`, `simulatedPass`)
- Create: `src/lib/sim/scenario/engine-regimes.spec.ts`, `pipeline/test/engine-node.test.ts`, `pipeline/test/fixtures/engine-node-smoke.ts`
- Modify: `pipeline/lib/version.ts:37-44` (`PATHS`), `pipeline/test/version.test.ts`, `chreode.config.ts` (the `src/lib/generator/**` rule), `.github/workflows/pipeline.yml` (`paths`)

**Interfaces:**
- Consumes: the retired two-period law switch, which this task **restores, then generalises** (owner: restore rather than rewrite): `git show 3a90362^:src/lib/sim/scenario/engine.ts` (lines 818-975: piecewise `initiationMonth`, `simulatedProject(…, after)`, the `sw` field of `Run`), `git show 3a90362^:src/lib/sim/scenario/input.ts` (`afterInputOf`, `switchMonth`, two-segment `skipBounds`, the candidate union), `git show 3a90362^:src/lib/sim/scenario/types.ts` (`lawSwitch`, `afterSwitch`) and its tests `git show 3a90362^:src/lib/sim/scenario/engine-switch.spec.ts`. `git diff 3a90362^ 3a90362 -- src/lib/sim/scenario` shows exactly what was removed. Restore those hunks first (re-run the restored `engine-switch.spec.ts` green), then generalise the single `lawSwitch` to `regimes`.
- Produces:

```ts
// types.ts
Schedule.regime?: number; // simulated schedules on a run with regimes: 0 = input.parcels, k = regimes[k - 1]
SimInput.regimes?: { day: Day; parcels: ScenarioParcels }[]; // strictly ascending, every day > asOf;
  // each view has the same count, id array contents and existingUnits as `parcels`; absent or [] = none
SimInput.reservedFrom?: Int32Array; // per T11 row: the reservation day, 0 = none
Sink.reservation?(row: number, kept: boolean): void; // once per reserved row per run (engine.ts Sink)
// input.ts
export function regimeInputsOf(input: SimInput): SimInput[]; // memoised; one input per regime, no regimes of its own
export function regimeMonths(r: Day, days: readonly Day[]): number[]; // T_k = lastInitiationMonth(r, days[k] - 1)
export function piecewiseMonth(L: number, bounds: readonly number[], rates: readonly number[]): number; // 0 = never
Precompute.regimes: Precompute[]; // [] without regimes
```

Rules (from the retired switch, generalised to K regimes): month T from `r` runs on view `j` when `bounds[j-1] < T ≤ bounds[j]` (`bounds` = `regimeMonths(r, days)`, view 0 before the first bound, the last view after it); `piecewiseMonth` walks segments with `acc` = Σ months·rate so far, returning `a + max(1, ceil((L − acc)/l))` for the first segment with `l < 0` where that is ≤ its end; an empty segment adds nothing (no `0 · −Infinity`); with no regimes it is exactly `max(1, ceil(L / l0))`, so unswitched draws are unchanged. `skipAbove` uses u* = 1 − exp(Σ n_j·l_j) over the months from `asOf` to `Tmax`. Candidates are the union of every view's candidates. A simulated project takes size row, yields, envelope and Local Program from the view of its initiation month (vesting, retired ruling 1) and records `regime`. `runOf` throws `RangeError` on a non-ascending day, a day ≤ `asOf`, a view of another length, `reservedFrom` of another length, or a reservation day ≤ `asOf`.

Reservation rule, for a row with day d = `reservedFrom[i]` > 0: the reservation is **kept** in the run unless some project on the row began before d and had not exited before d (a pipeline or phase holder that is `blocked`, or whose `lastExit` ≥ d; a skipped row on it; a simulated project initiated before d that completes, stays open, or exits on or after d). When kept, the simulated pass draws no initiation on or after d on that row (the loop stops at the first initiation day ≥ d); when voided, the row runs exactly as with no reservation. Either way the engine calls `sink.reservation(i, kept)` once, non-candidate rows included. A Sink without `reservation` ignores it. Builder's call: the cut is by initiation day, not month, because the conversion start is a day.

- [ ] **Step 1: Write the failing engine tests** (`engine-regimes.spec.ts`, on `goldenInput()` from `simulate.golden.cases.ts`)

```ts
it('no regimes, no reservedFrom: equals the golden', () => {
  expect(simulateDetailed(goldenInput(), 1, GOLDEN_HORIZON)).toEqual(golden);
});
it('one regime whose view is the base parcels: same schedules, each simulated one with regime 0 or 1', () => {
  const base = simulate(goldenInput(), 7, H);
  const r = simulate({ ...goldenInput(), regimes: [{ day: mid, parcels: { ...goldenInput().parcels } }] }, 7, H);
  expect(r.map(({ regime: _, ...s }) => s)).toEqual(base);
  expect(r.filter((s) => s.origin === 'simulated').every((s) => s.regime === (s.entered[firstStage(s)]! >= monthStartOn(mid) ? 1 : 0))).toBe(true);
});
it('a regime with every hazard 0 stops initiations from its first month, seeds 1-20', () => { /* no simulated initiation day >= that month start */ });
it('two regimes reduce to one when the second view equals the first', () => { /* deep equal ignoring regime numbers */ });
it('piecewiseMonth: single segment equals max(1, ceil(L/l)); empty segment with l = -Infinity adds nothing; all-zero rates give 0', () => { /* three expects */ });
it('skipAbove never skips a parcel that initiates by the horizon, 3 regimes, seeds 1-50', () => { /* compare with skipAbove forced to Infinity */ });
it('reservedFrom: kept, voided by an active project, kept after an exit', () => {
  // goldenInput, seeds 1-50, a reservation day d on several candidate rows:
  // kept => no simulated schedule on the row initiates on or after d, and reservation(i, true) was called;
  // voided (a schedule initiated before d did not exit before d) => the row's schedules equal the unreserved run's;
  // a schedule that exited before d with nothing else active => kept;
  // every other row's schedules equal the unreserved run's; each reserved row reported exactly once
});
it('a pipeline-held row with lastExit >= d is voided; a blocked row is voided', () => { /* expects */ });
it('throws RangeError on a day <= asOf, unsorted days and a short view', () => { /* three expects */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest --run --project server src/lib/sim/scenario/engine-regimes.spec.ts`
Expected: FAIL (`regimes` ignored, `piecewiseMonth` not exported).

- [ ] **Step 3: Implement the engine changes**

- [ ] **Step 4: Run the engine suites**

Run: `npx vitest --run --project server src/lib/sim`
Expected: PASS, including `simulate.golden.test.ts` and `engine-levers.spec.ts` unchanged.

- [ ] **Step 5: Write the failing Node test** (`pipeline/test/engine-node.test.ts`)

```ts
it('tsx runs the engine from pipeline code', async () => {
  const r = await run('npx', ['tsx', 'pipeline/test/fixtures/engine-node-smoke.ts']);
  expect(r.code).toBe(0);
  expect(JSON.parse(r.stdout)).toEqual({ schedules: expect.any(Number), regime1: expect.any(Number) });
});
```

`engine-node-smoke.ts` imports `simulate` and `miniCity` by relative path (as `pipeline/test/simulate-replay.test.ts` does), runs seed 1 with one regime and prints the counts. `run` is `pipeline/lib/exec.ts`. Fallbacks, in order, each only if the previous fails: (1) `$lib` resolves under tsx through the root `tsconfig.json` paths from `.svelte-kit/tsconfig.json` (`scripts/bench-levers.ts` already depends on it); (2) a resolve hook in `pipeline/lib/src-lib-hook.ts`, registered first thing in `pipeline/cli.ts`; (3) owner-accepted: run the engine in headless Chromium through Playwright (already a dev dependency) from the pipeline, a bundled entry evaluated in the page with inputs passed in and results returned as JSON. Record which one was needed in `docs/dev/lesscars.md`.

- [ ] **Step 6: Hash the engine with the dataset**

Add `'src/lib/sim/scenario'`, `'src/lib/sim/levers'` and `'src/lib/scoreboard'` to `PATHS` (`pipeline/lib/version.ts:37`), with the comment updated: the lesscars step runs the engine, so its code shapes the published data. Add a `version.test.ts` case that a change under each new path changes the hash. Add the three globs to the chreode rule at `chreode.config.ts` that triggers `pipeline`, and to both `paths` lists in `.github/workflows/pipeline.yml`. Builder's call: the whole directories, not the import closure, because over-hashing only costs a new version on the next build.

- [ ] **Step 7: Run and commit**

Run: `npx vitest --run --project pipeline pipeline/test/engine-node.test.ts pipeline/test/version.test.ts`
Expected: PASS.

```bash
git add src/lib/sim/scenario pipeline/test/engine-node.test.ts pipeline/test/fixtures/engine-node-smoke.ts pipeline/lib/version.ts pipeline/test/version.test.ts chreode.config.ts .github/workflows/pipeline.yml
git commit -m "feat(sim): restore the law switch as dated regimes; dated reservations; run in Node"
```

---

### Task 5: DataSF Streets back as a page-only source

**Files:**
- Modify: `pipeline/sources/datasf.ts` (restore the `datasf-streets` entry as in `git show 693c837^:pipeline/sources/datasf.ts:183-191`), `pipeline/steps/fetch.ts:18` (`FETCH_IDS`), `pipeline/sources/normalise.ts` (restore the streets normaliser from `693c837^`, writing `src_streets(cnn VARCHAR, streetname VARCHAR, classcode VARCHAR, layer VARCHAR, geom GEOMETRY /* EPSG:7131 */)`), `pipeline/test/fetch.test.ts:548`, `pipeline/test/normalise.test.ts`, `pipeline/test/fixtures/mini/make-fixture.ts` and `README.md` (restore the five fixture streets and the "Streets" section from `693c837^`), `pipeline/test/fixtures/mini/sources.lock.json`, `e2e/attribution.spec.ts` if it lists the sources

**Interfaces:**
- Produces: DuckDB table `src_streets`, present only when the lock has `datasf-streets` (the live lock gets it in Plan 3); when absent, `normaliseAll` creates it empty. Not in `AS_OF_SOURCE_IDS` or `TRANSIT_DATE_SOURCE_IDS`, so it moves neither date.

Builder's call: the centreline dataset rather than the Right of Way Polygons: it is current, was already locked and normalised in this pipeline, gives CNNs for plan references and street-state drawing, and the right-of-way itself is carved as land minus parcels (Task 6), which is exact against the current parcels where the 2014 polygons are not.

- [ ] **Step 1: Write the failing tests**

```ts
it('FETCH_IDS includes datasf-streets', () => expect(FETCH_IDS).toContain('datasf-streets')); // replaces the not.toContain at fetch.test.ts:548
it('normalises the mini streets: 5 rows, cnn as string, geometry in EPSG:7131', async () => { /* expects on src_streets */ });
it('a lock without datasf-streets gives an empty src_streets', async () => { /* expect count 0 */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest --run --project pipeline pipeline/test/fetch.test.ts pipeline/test/normalise.test.ts`
Expected: FAIL.

- [ ] **Step 3: Restore the source, normaliser and fixture streets; regenerate the mini raw files**

Run: `npx tsx pipeline/test/fixtures/mini/make-fixture.ts`
Expected: `raw/datasf-streets.page-000.geojson` and the lock entry written.

- [ ] **Step 4: Regenerate goldens and fixture-0, run the pipeline suite**

Run: `npm run pipeline -- fixture --update-golden`, then `npm run test:pipeline`
Expected: only `manifest.json` sources and `report.json` source counts change in the goldens; suite PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline e2e
git commit -m "feat(pipeline): restore DataSF street centrelines as a page-only source"
```

---

### Task 6: Freed land: carving, freed records and their zoning

**Files:**
- Create: `pipeline/lesscars-config.ts`, `pipeline/sql/84_lesscars_sites.sql`, `pipeline/steps/lesscars-sql.ts`, `pipeline/lib/lesscars/sites.ts`, `pipeline/test/lesscars-sites.test.ts`, `pipeline/test/fixtures/mini/enrichment/lesscars-plan.json`

**Interfaces:**
- Consumes: `src_streets` (Task 5), `land_mask`, `parcels.geom_orig`, `sc_zoning`, `sc_district` (`pipeline/sql/45_land.sql`, `80_scenario.sql`); `toLocalRings` (`pipeline/steps/chunks.ts`); `fzpYieldCapOf` (`pipeline/lib/density-caps.ts`); `envelopeRow` (`src/lib/data/envelope-row.ts:17`); `scenarioYield` (`src/lib/data/scenario-yield.ts`); Task 2's `LessCarsPlan`.
- Produces:

```ts
// pipeline/lesscars-config.ts — every value with a Cite and tier
export const LC: {
  switchDay: string;      // '2032-01-31', tier 4 (owner-accepted assumption; retired CURRENT_LAW_SWITCH day)
  keepHalfM: number;      // 10: kept centrelines' half-width removed from freed land, tier 4
  accessM: number;        // 6: service strip kept along every parcel edge, tier 4
  lotMaxM: number;        // 60: freed pieces cut across the line at this spacing, tier 4
  minPieceM2: number;     // 100: smaller pieces dropped, tier 4
  neighbourM: number;     // 40: neighbour search radius, tier 4
};
export const LESSCARS_PLAN_JSON: { live: string; fixture: string };
  // live: pipeline/enrichment/lesscars/plan.json (absent until Plan 3); fixture: the mini plan
// pipeline/steps/lesscars-sql.ts
export async function carveFreedLand(db: Duck, removed: { projectId: string; cnns: string[]; lines: [number, number][][]; rowHalfWidthM: number }[]): Promise<void>;
  // fills lc_site(site_id, project_id, k, area_m2, x0, y0, lng, lat, geojson7131, geojson4326)
  //   and lc_site_neighbour(site_id, parcel_id, dist_m)
// pipeline/lib/lesscars/sites.ts
export interface NeighbourZoning { parcelId: string; distM: number; zoningCode: string | null; r4: boolean; baseFt: number | null; lpFt: number | null; localProgram: boolean; fzpStories: number; neighborhood: string }
export function chooseZoning(ns: readonly NeighbourZoning[]): NeighbourZoning; // most permissive: fzpStories, then no cap over cap, then smaller parcelId
export interface FreedSite { siteId: string /* 'lc:<projectId>:<k>' */; projectId: string; rec: ParcelRecord; outline: [number, number][][]; zoning: NeighbourZoning }
export async function readFreedSites(db: Duck, capDay: Day): Promise<FreedSite[]>; // sorted by siteId
export function freedFzpRow(site: FreedSite, capDay: Day, grossAt: (stories: number) => number): EnvelopeRow;
```

Carving (builder's call, reason in the SQL header: exact against current parcels and the land mask, no extra source): for each removal or truncation, freed = (`land_mask` − ∪ parcels buffered by `accessM`) ∩ buffer(removed lines, `rowHalfWidthM`) − buffer(every other active centreline, `keepHalfM`); keep connected parts that intersect a removed line; cut across the line every `lotMaxM` along it; drop parts under `minPieceM2`. A freed record has `existingUnits` 0, `eligible` true, `landUse` `'VACANT'`, zero floor area and height, the chosen neighbour's `neighborhood`. Neighbours are parcels within `neighbourM`; with none, the nearest parcel. Zoning (spec "Freed land", builder picks "the more permissive neighbour"): the chosen neighbour's zoning code, height district and FZP stories; the cap is `fzpYieldCapOf(zoningCode, rec.areaM2, r4, localProgram, capDay)` on the freed piece's own area.

The mini plan (`lesscars-plan.json`, one project of every kind, built on the restored fixture streets): `subway` (2 new `lc:` stops near lots 5 and 10, opening after the switch), `buslane` (Mission St CNNs 1000 and 1001, one existing mini Muni stop id), `ped` (Mission St 1001 to bus, bike, sidewalk; depends on `buslane`), `hwy` (`highway-truncation` of I-80 CNN 4000, `rowHalfWidthM` 15, depends on `subway`, with a housing build), `parking` (lot 17, `3512017`, housing build, depending on `subway`, one of whose stops is placed within ½ mile of lot 17), `garage` (`edge-garage` on lot 15, `3512015`), `shuttle` (`car-shuttle` serving `garage`), `tram` (`tram-priority` on the mini light-rail route if the mini feed has one, else omitted and noted). Stop coordinates are computed in `make-fixture.ts`'s frame and written with seven decimals.

- [ ] **Step 1: Write the failing tests** (`lesscars-sites.test.ts`, on the mini DuckDB set up by a new shared helper `lesscarsMini(): Promise<{ db; outDir; records; capDay; parcels; policy; transit }>` in `pipeline/test/lesscars-helpers.ts`, memoised, which runs `miniDuck()` (`pipeline/test/helpers.ts:29`) and the step chain the way `pipeline/test/policy-step.test.ts:50` does, plus the transit step; Tasks 7 to 10 reuse it)

```ts
it('carves I-80 into pieces no wider than the ROW and overlapping no parcel', async () => {
  const sites = await readFreedSites(db, capDay);
  expect(sites.length).toBeGreaterThan(0);
  expect(sites.every((s) => s.siteId.startsWith('lc:hwy:'))).toBe(true);
  expect(await overlapM2(db, 'lc_site', 'parcels')).toBeLessThan(0.01);
  expect(Math.max(...sites.map(spanAcrossLineM))).toBeLessThanOrEqual(2 * 15 + 0.01);
});
it('no piece is longer than lotMaxM along the line or smaller than minPieceM2', async () => { /* expects */ });
it('kept Fixture Ave keeps its keepHalfM corridor', async () => { /* area within 10 m of CNN 2000 is 0 */ });
it('chooseZoning prefers more stories, then no cap, then the smaller id', () => { /* three expects */ });
it('a piece with no parcel within neighbourM takes the nearest parcel', async () => { /* using a one-off removed line far from lots */ });
it('a sliver yields 0 homes and is still a site', () => { /* freedFzpRow(...).yield all 0, site kept */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest --run --project pipeline pipeline/test/lesscars-sites.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement config, SQL, carving and zoning; write the mini plan**

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest --run --project pipeline pipeline/test/lesscars-sites.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/lesscars-config.ts pipeline/sql/84_lesscars_sites.sql pipeline/steps/lesscars-sql.ts pipeline/lib/lesscars pipeline/test/lesscars-sites.test.ts pipeline/test/lesscars-helpers.ts pipeline/test/fixtures/mini/enrichment/lesscars-plan.json
git commit -m "feat(lesscars): carve freed land from removed street right-of-way"
```

---

### Task 7: Network snapshots, per-day SB 79 and regime views

**Files:**
- Create: `src/lib/data/lesscars/network.ts`, `src/lib/data/lesscars/network.test.ts`, `pipeline/sql/85_lesscars_reach.sql`, `pipeline/lib/lesscars/regimes.ts`, `pipeline/test/lesscars-regimes.test.ts`
- Modify: `pipeline/lib/sb79.ts:35` (`stopTiers`), `pipeline/steps/lesscars-sql.ts`

**Interfaces:**
- Consumes: `TransitNetwork` (`src/lib/data/transit.ts`); `stopTiers`, `bestStandard`, `sb79Row`, `zoneClassOf` (`pipeline/lib/sb79.ts`); `mostPermissive`; `parcelsView` (`src/lib/sim/levers/view.ts:24`); `stockTable` (`src/lib/sim/levers/layers.ts:24`); `PolicyParcels` columns (`sb79Status`, `sb79Stories`, `sb79Cap`, `sb79Yield`, `hostableSb79`, `exemptPermanent`, `fzpYieldCap`); `pol_tod` (`pipeline/sql/82_policy.sql`); Tasks 3 and 6.
- Produces:

```ts
// pipeline/lib/sb79.ts
export function stopTiers(net: TransitNetwork, tier2Ids: ReadonlySet<string> = MUNI_TIER2_STOP_IDS): Map<number, Sb79Tier>;
// src/lib/data/lesscars/network.ts
export const PLAN_MODE: Record<TransitMode, ModeId>; // subway: heavy-rail, tram: light-rail, brt: bus
export function networkAt(base: TransitNetwork, plan: LessCarsPlan, s: PlanSchedule, day: Day): { net: TransitNetwork; tier2Ids: Set<string> };
  // adds, for each transit-line open by `day`, its new stops and one pattern per direction at peakTph
  // (tpd = 0: plan lines are never commuter rail); tier2Ids = bus-lane stopIds and BRT stops open by `day`
  // (the caller unions MUNI_TIER2_STOP_IDS); tram-priority raises tph on its routes, tier unchanged
export function transitOpenDays(plan: LessCarsPlan, s: PlanSchedule): Day[]; // sorted, unique
// pipeline/lib/lesscars/regimes.ts
export interface TierChange { stopId: string; lngLat: [number, number]; from: Day; tier: Sb79Tier }
export function tierChanges(base: TransitNetwork, plan: LessCarsPlan, s: PlanSchedule): TierChange[];
  // every stop whose tier at some open day is better than today's; throws if any tier worsens
export function regimeDays(switchDay: Day, openDays: readonly Day[], asOf: Day, horizon: Day): Day[];
  // [switchDay, ...openDays.filter(d => d > switchDay && d <= horizon)], unique, ascending, all > asOf
export function afterSwitchRow(fzp: EnvelopeRow, sb: EnvelopeRow & { status: Sb79Status }, exemptPermanent: boolean): EnvelopeRow & { fromSb79: boolean };
export interface RegimeSet {
  baseline: { day: Day; parcels: ScenarioParcels }[];  // one entry: the switch, today's network (policy.bin sb79 columns)
  plan: { day: Day; parcels: ScenarioParcels }[];      // the switch with the network at that day, then each later open day
  unlocked: Uint8Array;                                // T11 rows whose last plan row differs from the baseline after-switch row
  siteRowAt(siteId: string, day: Day): EnvelopeRow;    // freed sites: FZP before the switch, after it afterSwitchRow on the site's own reach
  parcelRowAt(row: number, day: Day): EnvelopeRow;     // existing parcels in the plan arm (parking builds)
}
export async function buildRegimes(a: { db: Duck; parcels: ScenarioParcels; policy: PolicyParcels; records: Map<ParcelId, ParcelRecord>; sites: FreedSite[]; base: TransitNetwork; plan: LessCarsPlan; schedule: PlanSchedule; switchDay: Day; asOf: Day; horizon: Day; capDay: Day }): Promise<RegimeSet>;
```

Method: `85_lesscars_reach.sql` takes `lc_stops(id, tier, lng, lat)` (the `TierChange` stops, plus, for freed sites only, every stop tiered at any open day) and writes `lc_reach(id, stop_id, dist_m)` for parcels (`geom_orig`) and `lc_site` pieces within `SQL_VARS.tod_half_m`. A lot's reach at day d is the per-tier minimum of its `pol_tod` distance and the changed stops whose `from` ≤ d. SB 79 rows are recomputed (`sb79Row` with the generator's `grossAt`) only for lots whose `bestStandard` differs from `policy.bin`'s `todTier`/`todBand`; every other lot reuses `policy.bin`'s SB 79 columns. A regime view is `parcelsView(parcels, table, parcels.localProgram)` (builder's call: the Local Program stays in force after the switch, as `DEFAULT_LEVERS` keeps it). A plan regime whose table equals the previous one row for row is dropped. Builder's call for network snapshots: none are stored; `transit.json` plus `plan.json` rebuild any snapshot through `networkAt`, on the pipeline and the page alike. Builder's call for "transit-unlocked": any change of a lot's engine row caused by plan transit counts (a closer stop of the same tier included), since that is what changes its homes.

- [ ] **Step 1: Write the failing tests**

`network.test.ts`:
```ts
it('a subway opens as heavy-rail patterns on its open day and not the day before', () => { /* expects on net.patterns */ });
it('bus-lane stop ids join tier2Ids on the open day; tram-priority changes tph, not tier', () => { /* expects */ });
it('transitOpenDays is sorted and unique', () => { /* expect */ });
```
`lesscars-regimes.test.ts` (fixture build DuckDB):
```ts
it('stopTiers default is unchanged; a tier-2 set argument tiers a bus stop', () => { /* two expects */ });
it('regimeDays merges equal days', () => {
  expect(regimeDays(sw, [sw, sw + 400, sw + 400], asOf, hz)).toEqual([sw, sw + 400]);
});
it('pre-switch openings fold into the switch regime', () => {
  expect(regimeDays(sw, [sw - 900, sw - 10], asOf, hz)).toEqual([sw]);
});
it('afterSwitchRow: exemptPermanent keeps FZP; a tie keeps FZP; min-units keeps FZP', () => { /* three expects */ });
it('baseline after-switch equals the retired rule on every fixture row', async () => { /* recompute from policy.bin columns */ });
it('the mini subway unlocks lots near its stops after it opens, and only those', async () => { /* expect unlocked rows within ½ mile of the lc: stops */ });
it('tierChanges throws when a plan would worsen a stop tier', () => { /* expect toThrow */ });
it('siteRowAt is FZP before the switch and at least FZP after', async () => { /* expects on the hwy sites */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest --run --project server src/lib/data/lesscars/network.test.ts` and `npx vitest --run --project pipeline pipeline/test/lesscars-regimes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run to verify pass, and that the policy step is unchanged**

Run: `npx vitest --run --project server src/lib/data/lesscars` and `npx vitest --run --project pipeline pipeline/test/lesscars-regimes.test.ts pipeline/test/sb79.test.ts pipeline/test/policy-step.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/lesscars pipeline/sql/85_lesscars_reach.sql pipeline/lib/lesscars pipeline/lib/sb79.ts pipeline/steps/lesscars-sql.ts pipeline/test/lesscars-regimes.test.ts
git commit -m "feat(lesscars): per-year SB 79 on the growing network and regime views"
```

---

### Task 8: Paired runs, attribution and the output codec

**Files:**
- Create: `src/lib/data/lesscars/codec.ts`, `src/lib/data/lesscars/codec.test.ts`, `pipeline/lib/lesscars/runs.ts`, `pipeline/test/lesscars-runs.test.ts`

**Interfaces:**
- Consumes: `runEngine`, `Sink` (`src/lib/sim/scenario/engine.ts:41,938`); `buildSimInput` (`input.ts`); `bandSeed`, `nearestRank`, `representativeIndex` (`src/lib/sim/scenario/band.ts`); `idsHash` (`src/lib/data/column-file.ts:217`, as `policy.bin` binds itself); Tasks 3, 4, 6, 7.
- Produces:

```ts
// src/lib/data/lesscars/codec.ts
export const LESSCARS_FORMAT = 'sfh-lesscars/1';
export const SOURCES = ['freed', 'parking', 'transitUnlocked', 'other'] as const; export type Source;
export interface InitiativeBuild { siteId: string; projectId: string; parcelRow: number | null /* T11 row for parking, null for freed; a build with a row happens only in seeds where its reservation was kept */; units: number; stories: number; existing: number; startDay: Day; completeDay: Day }
export interface LessCarsSummary {
  format: typeof LESSCARS_FORMAT; datasetVersion: string; planId: string;
  seeds: number; representativeSeed: number; switchDay: Day; regimeDays: Day[];
  yearEnds: Day[];                              // 31 Dec 2028 … 31 Dec 2068 (41)
  extra: { mean: number[]; p10: number[]; p50: number[]; p90: number[] }; // plan − baseline net homes, per year end
  bySource: Record<Source, number[]>;           // mean per year end; Σ sources = extra.mean exactly (integers ÷ seeds, see rule)
  plan: number[]; baseline: number[];           // mean cumulative net homes since asOf
  provenance: Provenance;
}
export interface LessCarsTimeline { format; datasetVersion; count: number; idsHash: number; seed: number; schedules: Schedule[]; builds: InitiativeBuild[] }
export function encodeTimelinePayload(t: LessCarsTimeline, parcelIds: readonly ParcelId[]): Uint8Array; // columnar JSON, ids as T11 rows
export function decodeTimelinePayload(bytes: Uint8Array, parcels: { count: number; id: readonly ParcelId[] }): LessCarsTimeline; // throws on count/idsHash mismatch
export function parseSummary(json: unknown): LessCarsSummary;
export interface LessCarsSitesFile { format; datasetVersion; sites: { siteId: string; projectId: string; rec: ParcelRecord; outline: [number, number][][] }[] }
export interface LessCarsPlanFile { format; datasetVersion; plan: LessCarsPlan; times: ProjectTimes[]; segments: Record<string, [number, number][][]> /* cnn → lng/lat lines */ }
export function parseSitesFile(json: unknown): LessCarsSitesFile; export function parsePlanFile(json: unknown): LessCarsPlanFile;
// pipeline/lib/lesscars/runs.ts
export function reservationsOf(plan: LessCarsPlan, s: PlanSchedule, parcels: ScenarioParcels): Int32Array; // reservedFrom: parking build start or garage start per row, 0 elsewhere
export function sourceOfRows(count: number, reservedFrom: Int32Array, unlocked: Uint8Array): Uint8Array; // index into SOURCES; a reserved row is parking in both arms, kept or not; parking beats transitUnlocked
export function initiativeBuilds(plan: LessCarsPlan, s: PlanSchedule, sites: FreedSite[], parcels: ScenarioParcels, rows: Pick<RegimeSet, 'siteRowAt' | 'parcelRowAt'>): InitiativeBuild[];
  // housing builds only; units = top fill yield of the row at build.startDay; stories = that row's stories
export function runPairs(a: { base: SimInput; regimes: RegimeSet; reservedFrom: Int32Array; builds: InitiativeBuild[]; source: Uint8Array; seeds: number; yearEnds: Day[]; horizon: Day }): { perSeed: { seed: number; plan: Int32Array[]; baseline: Int32Array[] }[] /* [source][year] */ };
export function summarise(r: ReturnType<typeof runPairs>, meta: Pick<LessCarsSummary, 'datasetVersion' | 'planId' | 'switchDay' | 'regimeDays' | 'yearEnds'>): LessCarsSummary;
export function representativeTimeline(a: { base: SimInput; regimes: RegimeSet; reservedFrom: Int32Array; builds: InitiativeBuild[]; seed: number; horizon: Day; datasetVersion: string }): LessCarsTimeline;
  // the plan arm of `seed` (representativeSeed): simulateDetailed's schedules plus the builds kept in that seed
```

Rules: a schedule adds `units − existingUnits` on its completion day (as `addNet`, `src/lib/sim/scenario/score.ts:129`) to the source of its first parcel's row (sorted id); an initiative build adds `units − existing` on `completeDay` to `freed` or `parking`. The plan arm is `{ ...base, regimes: regimes.plan, reservedFrom }`, its Sink collecting `reservation(row, kept)`; a build with a `parcelRow` counts in a seed only when its row was kept there (a voided garage likewise does not appear); the baseline arm `{ ...base, regimes: regimes.baseline }`; both on seed `bandSeed(i)`, `i < seeds`. Means: `bySource[k][y]` is the integer sum over seeds divided by `seeds`, and `extra.mean[y]` is the sum of the four source sums divided by `seeds`, so the parts sum to the whole up to float rounding (the test compares the integer sums exactly). `p10/p50/p90` by `nearestRank` over per-seed differences. `representativeSeed` is `bandSeed(representativeIndex(final differences))`. Builder's calls: seeds `LIVE_PROFILE.lesscarsSeeds` = 101 (odd, as `BAND_RUNS`, so the representative is one run; the live cost is measured in Plan 3 and reduced only if the build exceeds 30 minutes); "homes by 2068" is cumulative net completions since `asOf`, the engine's own measure.

- [ ] **Step 1: Write the failing tests**

`codec.test.ts`:
```ts
it('timeline round-trips and is bound to parcels.bin', () => {
  const bytes = encodeTimelinePayload(t, ids);
  expect(decodeTimelinePayload(bytes, { count: ids.length, id: ids })).toEqual(t);
  expect(() => decodeTimelinePayload(bytes, { count: ids.length, id: [...ids].reverse() })).toThrow(/idsHash/);
});
it('parseSummary rejects bySource whose integer sums do not add to extra', () => { /* expect toThrow */ });
```
`lesscars-runs.test.ts` (mini city from `src/lib/sim/scenario/fixtures/mini-parcels.ts`, small hand-built regimes):
```ts
it('identical arms give zero difference in every source and year', () => { /* expects */ });
it('parts sum to the total exactly per seed', () => { /* Σ_k (plan[k][y] − baseline[k][y]) === plan total − baseline total */ });
it('negative difference: parts still sum', () => {
  // a garage reservation on a row the baseline builds on after the garage start; no housing build there
  expect(Math.min(...summary.extra.p10)).toBeLessThan(0);
  expect(sumOfSources(summary)).toEqual(summary.extra.mean.map(close));
});
it('an initiative build counts on its completion year end and not before', () => { /* expects */ });
it('a voided conversion has no build in that seed', () => {
  // a reserved row with a project initiated before the start in some seeds: in those seeds no build and
  // row schedules equal to the unreserved plan run; a build in the others; parts sum per seed in both
});
it('amenities add nothing: a plan with only street changes and bus lanes before the switch gives 0', () => { /* expect all zeros */ });
it('runPairs is deterministic', () => { /* two runs deep-equal */ });
it('representativeSeed is the median-difference pair', () => { /* expect */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest --run --project server src/lib/data/lesscars/codec.test.ts` and `npx vitest --run --project pipeline pipeline/test/lesscars-runs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement codec and runs**

- [ ] **Step 4: Run to verify pass**

Same commands. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/lesscars pipeline/lib/lesscars pipeline/test/lesscars-runs.test.ts
git commit -m "feat(lesscars): paired plan/baseline runs with source attribution"
```

---

### Task 9: The pipeline step, manifest keys and fixture outputs

**Files:**
- Create: `pipeline/steps/lesscars.ts`, `pipeline/test/lesscars-step.test.ts`, `docs/dev/lesscars.md`
- Modify: `pipeline/steps/build.ts:283-287` (call after `writePolicy`), `:293-301` (manifest flag), `pipeline/steps/manifest.ts:26-81`, `src/lib/data/manifest.ts:56-84` (schema and URL prefix list), `src/lib/data/manifest.test.ts`, `pipeline/steps/upload.ts`, `pipeline/steps/verify.ts` (manifest-named files), `pipeline/config.ts:62,136,206` (`lesscarsSeeds`), `pipeline/lib/scenario-files.ts`, goldens and `fixture-0` (regenerated), `CLAUDE.md` (link the new doc), `docs/dev/sim-levers.md` (one line: the engine's `regimes` input exists for `/lesscars` only)

**Interfaces:**
- Consumes: everything above.
- Produces:

```ts
export const LESSCARS_FILES = { plan: 'scenarios/lesscars/plan.json', sites: 'scenarios/lesscars/sites.json',
  summary: 'scenarios/lesscars/summary.json', timeline: 'scenarios/lesscars/timeline.bin' } as const; // scenario-files.ts
export async function writeLessCars(a: { db: Duck; outDir: string; datasetVersion: string; records: { rec: ParcelRecord; cellId: string }[]; planPath: string | null; profile: InvariantProfile; capDay: Day }): Promise<{ written: boolean; counts: Record<string, number>; warnings: string[] }>;
// manifest (app schema): scenarios.lesscars?: { plan, sites, summary, timeline } — optional, sibling of fzp
InvariantProfile.lesscarsSeeds: number; // LIVE 101, FIXTURE 5
```

Behaviour: `planPath` null or missing file → `written: false`, nothing written, no manifest key (the live build until Plan 3). Otherwise: parse, schedule, `checkPlan`, then data checks (every CNN in `src_streets`; every existing stop id in `transit.json`; every parking and garage parcel in `parcels.bin` with `existingUnits` 0; every parking conversion served by one of its direct transit dependencies: some stop of it (transit-line `stops`, bus-lane `stopIds`, tram-priority stops on its `routeIds` in `transit.json`) within `SQL_VARS.tod_half_m` of the parcel's `geom_orig` (`ST_Distance` in EPSG:7131, as `pol_tod` measures); every `routeIds` entry in `transit.json`) — any problem throws `BuildError` listing `project.field: message` lines before any file is written. Then carve, regimes, builds, pairs; write the four files (`timeline.bin` deflate-raw at level 9, as `policy.bin`); counts `lesscars.projects`, `lesscars.sites`, `lesscars.sites.zero_yield`, `lesscars.regimes`, `lesscars.seeds`, `lesscars.extra_2068.mean` (rounded), `lesscars.unlocked_lots`, `lesscars.bytes.timeline_payload` (and `.timeline` on live builds only). Golden decoded dumps: `golden/scenarios/lesscars/{plan,sites,summary}.json` byte-compared and `timeline.decoded.json` compared decoded (deflate bytes vary by zlib, as `parcels.bin`).

- [ ] **Step 1: Write the failing tests** (`lesscars-step.test.ts` and `manifest.test.ts`)

```ts
it('no plan file: nothing written, no manifest key', async () => { /* expects */ });
it('the mini plan writes four files that decode and bind to parcels.bin', async () => { /* expects */ });
it('bad plan data fails the build', async () => {
  for (const [edit, needle] of [[unknownCnn, 'ped.segments'], [unknownStop, 'buslane.stopIds'],
    [parkingWithHomes, 'parking.parcel'], [parkingUnserved, 'parking.dependsOn']] as const) {
    await expect(writeLessCars(withPlan(edit))).rejects.toThrow(needle);
    expect(existsSync(join(outDir, 'scenarios/lesscars'))).toBe(false);
  }
});
it('a Fillmore violation fails the build', async () => { /* rejects.toThrow('fillmore') */ });
// manifest.test.ts
it('accepts scenarios.lesscars and checks its url prefix', () => { /* two expects */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest --run --project pipeline pipeline/test/lesscars-step.test.ts` and `npx vitest --run --project server src/lib/data/manifest.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the step, wiring, manifest, upload/verify lists**

- [ ] **Step 4: Regenerate goldens and fixture-0; run the suites**

Run: `npm run pipeline -- fixture --update-golden`, then `npm run test:pipeline` and `npm run test:unit`
Expected: PASS; the golden diff adds `scenarios/lesscars/*` and the new counts only.

- [ ] **Step 5: Write `docs/dev/lesscars.md` and link it from `CLAUDE.md`**

Sections: plan format (fields, builder's calls from Tasks 2 and 3); checks; engine regimes and dated reservations; the step (inputs, carving parameters, regimes, paired runs, attribution rules, seeds); output files; running it (`npm run pipeline -- fixture`, live after Plan 3). `docs-index.spec.ts` requires the CLAUDE.md link.

- [ ] **Step 6: Run the docs index test and commit**

Run: `npx vitest --run --project server scripts/docs-index.spec.ts`
Expected: PASS.

```bash
git add pipeline src/lib/data e2e/fixtures docs/dev CLAUDE.md
git commit -m "feat(lesscars): pipeline step writing plan, sites, summary and timeline"
```

---

### Task 10: V35 and the CI cost check

**Files:**
- Create: `pipeline/steps/check-lesscars.ts`
- Modify: `pipeline/steps/check.ts:341` (`checkDataset`), `pipeline/test/invariants.test.ts`, `docs/dev/pipeline.md` (Invariants paragraph, Where things land, Commands note), and, only if Step 5 says so, `chreode.config.ts` and `.github/workflows/pipeline.yml`

**Interfaces:**
- Consumes: Tasks 8 and 9.
- Produces: `checkV35(outDir: string, counts: Record<string, number>): InvariantResult` — OK with detail "no plan" when the manifest has no `scenarios.lesscars`; otherwise every named file exists and decodes; `timeline.bin` binds to `parcels.bin`; `checkPlan` on the decoded plan and times is empty and the times equal `schedulePlan(plan)`; no site's project kind is an amenity; parking and garage parcels have `existingUnits` 0 and every parking conversion has a direct transit dependency; the summary's integer source sums equal its differences at every year end; `summary.yearEnds` has 41 entries ending 2068-12-31; `timeline.bin` ≤ 3 MB (warn above 2 MB; tier 4 budget, as V19's).

- [ ] **Step 1: Write the failing tests** (`invariants.test.ts`)

```ts
it('V35 passes on the fixture build', () => { /* expect ok */ });
it('V35 fails when a source sum is edited', () => { /* rewrite summary.json, expect ok false and detail naming the year */ });
it('V35 fails when plan times disagree with schedulePlan', () => { /* expect ok false */ });
it('V35 is OK with "no plan" when the manifest has no lesscars key', () => { /* expect */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest --run --project pipeline pipeline/test/invariants.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement V35 and call it from `checkDataset`**

- [ ] **Step 4: Run to verify pass; regenerate goldens (report.json gains V35)**

Run: `npm run pipeline -- fixture --update-golden`, then `npm run test:pipeline`
Expected: PASS.

- [ ] **Step 5: Measure CI cost**

Run `npm run test:pipeline` on this branch and on `origin/main` (a temporary worktree), three times each, and record the medians in `docs/dev/lesscars.md`. If the branch adds more than 60 s (builder's threshold: about 10% of the workflow's run), move the lesscars tests to signoff: give them a `pipeline/test/lesscars-*.test.ts` exclude in the CI command of `.github/workflows/pipeline.yml` and keep them in `npm run test:pipeline` (chreode runs it at signoff). Otherwise change nothing and record that.

- [ ] **Step 6: Update `docs/dev/pipeline.md` and commit**

Invariants: V1 to V35 (V34 retired); V35 as above. Where things land: the four `scenarios/lesscars/` files and the optional manifest key. Then:

Run: `npx vitest --run --project pipeline pipeline/test/quality.test.ts` and `npx prettier --check docs`
Expected: PASS.

```bash
git add pipeline docs/dev e2e/fixtures chreode.config.ts .github/workflows/pipeline.yml
git commit -m "feat(lesscars): V35 checks the published plan and summary"
```

---

## Owner rulings embedded (plan review, 2026-11-01)

1. Switch day 2032-01-31: accepted.
2. "Transit-unlocked" counts any engine-row change caused by plan transit: accepted.
3. Parking converts in step with transit, voided per seed when the market got there first (spec commit cf8b078): Tasks 2, 3, 4, 8, 9 and 10.
4. The "Instant city" anti-goal now matches scheduled builds (spec commit 9352d2c): no plan change.
5. Task 4 restores the retired law-switch code from `3a90362^` and generalises it; a headless-browser run through Playwright is the accepted last fallback for running the engine from the pipeline.

## Open questions for the owner

None.
