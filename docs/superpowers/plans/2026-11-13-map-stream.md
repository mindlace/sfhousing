# map-stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `MapStream` (S17) in `src/lib/sim/world/map-stream.ts` that turns world 1's events into today's whole-cell `TimelineUpdate`s as the world fills, plus the one map change it needs (T13): the timeline controller applies `demolish` after revision 0 and a new `restore`.

**Architecture:** `onEvent` only marks the event's project cell dirty (and records construction days). `flush` packs dirty cells oldest first within a time budget, each cell whole, from `scheduleAt(world, statics, row, lastDay)` of its projects through `massingFor` (memoised per revision, LRU 60,000) and `packTimedCell`. `rewind` diffs what was sent against the restored world; `snapshot` repacks everything as revision 0. The demolish pump gains `amend(add, restore)`, which the controller calls for revisions after 0.

**Tech Stack:** TypeScript, Vitest (server, perf, client-perf projects), `tsx` scripts. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-13-map-stream-design.md` (S17; S7 and S8 consumed; rules 1 to 12). Design: `docs/superpowers/design/2026-11-12-2305-sim-step-engine.md` (T13, S17).

Working directory for every task: `/Users/mindlace/Projects/sfhousing/.claude/worktrees/sim-step-engine/.claude/worktrees/step-map-stream` (below: `W`). Branch `step-engine/map-stream`.

## Global Constraints

From the spec's Global constraints, verbatim:

- The calibration file, the dataset and the pipeline do not change. No file under the folders hashed into the dataset version (`pipeline`, `src/lib/data`, `src/lib/generator`, `src/lib/timelapse`, `src/lib/plan/{geometry,types}.ts`, `src/lib/sim/{scenario,levers,finance}`, `src/lib/scoreboard`) is added, changed or removed in Release A. In Release B the one exception is `src/lib/sim/scenario/scenario-host.ts`, which `ensemble-runner` may change or move so that the new host can use the dataset it loads, without changing any result of the old engine; that branch then follows "Finishing a branch that changes the dataset" in `docs/dev/pipeline.md`. New code imports from the hashed folders. A builder who finds any other change necessary stops and reports.
- The step and everything it calls may read the policy of the month being stepped and of earlier months, never of a later one.
- Agreement with today's engine (OD-2). Without public money and under one frame: for every seed tested, `scheduleAt` and `masterAt` over every row at the horizon day equal `simulateDetailed`'s schedules and masters, and each world's calendar-month series equals `shownSeries`. With public money, over seeds 1 to 200 on the bench city and on the live city with baseline funding, at years 5, 10, 20 and 40: the mean of completed net homes within 1% of today's mean, its standard deviation within 15% of today's, and the mean number of awards and of funded homes within 3%. The ledger identities hold after every step in every world. A miss is reported with its numbers; no rule is changed to meet it.
- `exp` and `log` only from `src/lib/timelapse/math.ts`. `Math.exp`, `Math.log`, `Math.pow`, `Math.log1p`, `Math.expm1` and the `**` operator are never used under `src/lib/sim/world/`, and the determinism ESLint rule's `files` gains `src/lib/sim/world/**` (`world-core` adds it; `eslint.config.js` is not hashed).
- The same inputs give the same world, in Node and in the browser.
- No slice of worker work longer than 50 ms.
- `step`, the world and every function they call take no horizon, read no end date and keep nothing laid out to one. Only the runner and the page hold the window.
- One month for every world of both ensembles, scoring included, on the live city: at most 9 ms on the reference machine. (Playback at its fastest covers 36 months a second; the forecast must fill at least three times faster.) The spike measured 0.31 ms for 48 worlds without public money; the funded path is unmeasured, and `world-funding` measures it first.
- No user setting may decide directly how much gets built (levers spec anti-goal, kept).
- A lever that changes only timing never changes any project's outcome, and moves its days in one direction (paired-draw fix, kept). This holds exactly without public money. With public money a timer can still change which applications are awarded and when, because releases and repayments fall on stage days; that is an effect of the money and is not to be "fixed".
- Tests that run in signoff assert behaviour and order, never wall-clock time. Every timing bar lives in `test:perf`.
- WCAG 2.2 AA for the timeline, including keyboard control of every bar.
- Explanation waits for interest (OD-12). At rest the page shows numbers, short labels and controls. Sentences that explain a number, a caveat or a method appear only when the reader points at, focuses or taps the thing they explain. What appears on pointing also appears on keyboard focus and on tap, stays while pointed at, and can be dismissed (WCAG 1.4.13). An explanation is itself short: it says what the reader cannot infer and stops (partner, 2026-11-13: "A forecast if nothing changes" is sufficiently unambiguous; "if you can infer it don't belabor it"). No new standing paragraph is added to `/sim`, and the specs for `timeline-ui` and `world-score` list each text they carry over from today's page with where it goes.

### Standing rules (every implementer and reviewer leaf gets this block)

- Run every command in the FOREGROUND with a long Bash timeout (up to 600000 ms; split longer work). Never end a turn with anything still running.
- Never `cd <dir> && <command>`: `cd W` on its own line, then the command; or use absolute paths.
- No Claude attribution anywhere (commits, code, docs, comments). Conventional Commits. Multi-line messages: write a temp file, `git commit -F <file>`, delete it. No heredocs.
- Do not push, open a PR or run `npm run signoff`.
- Files we may change: `src/lib/sim/world/map-stream.ts` and its specs, map-stream-owned test helpers named `src/lib/sim/world/test/map-stream-*.ts`, `src/lib/map/timeline-controller.ts` (+ spec), `src/lib/map/types.ts`, `src/lib/map/timelapse/demolish.ts` (+ spec), `scripts/map-stream-*.ts`, `docs/dev/map-stream.md`, `docs/dev/map-interfaces.md`, one line in `CLAUDE.md`. Every other file under `src/lib/sim/world/` belongs to world-core (`policy/` to policy-timeline): import, never edit. No file under the hashed folders is added, changed or removed. A needed change elsewhere is a question for `main`: stop and report.
- No `Math.exp`, `Math.log`, `Math.pow`, `Math.log1p`, `Math.expm1` or `**` under `src/lib/sim/world/`.
- Vitest runs with `expect.requireAssertions`. No raised per-test timeout, no fixed wait, no unconditional skip (signoff's `timing` step). Slow work goes in `beforeAll` or is split per case; live-city blocks use `describe.skipIf`.
- Say in every report which dataset a number came from (live `2026-11-10-6ee5a23d`, bench city `fixture-18`, or `fixture-0`).
- **L1, lock check (before any heavy command: a test file run, `npm run check`, `npm run lint`, a build, `npm install`):** `ls /Users/mindlace/Projects/sfhousing/.claude/worktrees/sim-step-engine/.superpowers/sdd/measure.lock/owner`. If it exists and `cat` of it is not `map-stream`, `sleep 60` (foreground) and check again. Same owner for over 30 minutes: message `main`; never remove another's lock.
- **L2, taking the lock (any timing: Task 2, Task 7, `test:perf`, `bench:map`):** `mkdir /Users/mindlace/Projects/sfhousing/.claude/worktrees/sim-step-engine/.superpowers/sdd/measure.lock` (on failure `sleep 60` and retry, up to 30 minutes, then message `main`); write `map-stream` into `measure.lock/owner`; `sleep 30`; run the timings (at most 15 minutes held); `rm -r` the lock directory at once. Mark the numbers "quiet (lock held)".

## Review Focus

1. **A rewind removes a project whose cell was dirtied but never sent** (the budget left it queued): the cell must not appear in `removedCells` (the map never had it) and must not be packed with the removed id. Test in Task 5 (`a rewind drops a never-sent cell silently`).
2. **Two projects on one lot** (a pipeline project and a later simulated start, or a restart after an exit): the lot's demolition is the earliest construction day; a rewind that removes only the later project must not restore the lot. Test in Task 3 (`two projects on one lot: the earliest construction day only`) and Task 5 (`removing the later project keeps the lot demolished`).
3. **A multi-parcel project whose parcels span two cells, one of them not loaded:** its anchor cell waits whole (no partial cell is sent) and goes out on the first flush after the other cell is ready. Test in Task 1 (`a cell needing an unloaded chunk waits and keeps its place`).
4. **A cell emptied by a rewind that a refill fills again before the next flush:** it is sent once as a replacement and is not also in `removedCells`. Test in Task 5 (`an emptied cell refilled before the flush is replaced, not removed`).
5. **One update naming a parcel in both `restore` and `demolish`** (a construction day moved later by a slower timer after a rewind): the controller applies `restore` first, so the lot is hidden from the new day only. Test in Task 3 (pump and controller) and Task 5 (stream emits both).

## Decisions left to the builder (made here)

- **Own small packer, not `createGeometry`** (builder's call): `createGeometry` is built once over a fixed schedule list and indexes all of it (`geometry.ts:80-135`); the stream's schedules change every month. `map-stream.ts` repeats `pack`'s item building and `packSafely`'s drop-one-bad-item fallback (`geometry.ts:166-182, 203-223`) in about 40 lines; Task 4's equality test against `createGeometry` holds them equal.
- **Cell and pick parcel** use `cellAnchorParcel` and `footprintParcel` from `scenario/massing.ts:41-54` on the row's parcel ids (rule 2). A parcel absent from T11 is `warnOnce`d and ignored, a row with no T11 parcel gets no cell (as `geometry.ts:103-120`).
- **A row's parcel ids come from statics, not from `scheduleAt`** (builder's call: does not depend on the order in which world-core writes columns and sends `'start'`): simulated `[statics.parcelId[p.src[row]]]` (`read.ts:67`), pipeline `statics.projects[p.src[row]].parcelIds` (`read.ts:105, 119`), phase `ip.phases[p.sub[row] - 1].parcelIds` (`read.ts:126-135`), master none (masters have no slot: `scheduleAt` is null for them, `read.ts:99`). Computed once per row.
- **Queue:** a `Map<cellId, true>` in first-dirtied order (re-dirtying keeps the place; a packed cell leaves it). A cell is packable when `deps.cellReady(c)` holds for every cell of every project in it; otherwise it is skipped and keeps its place (rule 6).
- **Budget clock:** `deps.now` (default `performance.now`) is read once at the start of `flush` and once before each cell after the first; packing stops when `now() - start >= budgetMs`. At least one ready cell is packed per call, so a flush always makes progress.
- **Massing memo** (rule 11) is built in Task 1, not later (builder's call: Task 2 must time the packer as designed). `createLru<string, Massing>` from `src/lib/sim/lru.ts` (not hashed, not world-owned), cap `deps.massingCap ?? MASSING_CAP` (`MASSING_CAP = 60_000`, today's `MEMO_CAP`, `scenario-host.ts:253`). Key: `` `${projectId}|${k}|${day}|${units}|${stories}` `` of revision `k`, so a changed row never hits a stale entry; entries of removed projects are left to LRU eviction (a key that can never be hit again costs only its slot).
- **Demolitions** are kept as `parcel → earliest construction day` over the rows that have entered construction (as `geometry.ts:112-118`), only for parcels present in T11. Pending changes go out on the next non-null update; an update is sent when any cell is packed or removed or any demolish or restore is pending (demolitions need no geometry, as revision 0 today).
- **`complete`** is true when `world.month >= windowMonths` and no dirty cell is ready to pack (today's T6 meaning, `geometry.ts:42-43, 224`); see Open question 2.
- **`snapshot`** packs every ready cell that has a project (no budget); cells waiting on chunks stay dirty (rule 6 over rule 10's "clearing the dirty set"; see Open question 3).
- **Events from `createWorld`** arrive before the world exists. The test sink (and the docs, for `ensemble-runner`) buffers them and replays them to `onEvent` once `createWorld` returns.
- **The live city copy** goes to `W/.superpowers/sdd/map-stream/live/2026-11-10-6ee5a23d/` (git-ignored by `.git/info/exclude:9`, `.superpowers/sdd/`) and is named with `SFH_WORLD_LIVE` explicitly. Builder's call over `pipeline/out/` (also ignored, `.gitignore:15`): `liveDir()` picks up any dataset under `pipeline/out/` by itself (`test/cities.node.ts:89-105`), which would switch on world-core's live referee blocks in every `test:unit` of this worktree.
- **The equality reference day** is `H' = monthLastDay(asOf, horizonMonth(asOf))`, the day rule 4 packs at, with `simulateDetailed(oldInputOf(input), seed, H')`. See Open question 4.

## File Structure

- Create `src/lib/sim/world/map-stream.ts`: `createMapStream`, `MapStream`, `MapStreamDeps`, `MASSING_CAP`. One responsibility: events to whole-cell updates.
- Create `src/lib/sim/world/map-stream.spec.ts` (server): rules 2 to 7, 11, 12 (Task 1), demolitions (Task 3).
- Create `src/lib/sim/world/map-stream.rewind.spec.ts` (server): rules 8 to 10 after edits, with the real controller (Tasks 5, 6).
- Create `src/lib/sim/world/map-stream.equality.spec.ts` (server): the signoff equality against `simulateDetailed` (Task 4).
- Create `src/lib/sim/world/map-stream.perf.spec.ts` (perf): `flush(…, 20)` bar (Task 7).
- Create `src/lib/sim/world/test/map-stream-deps.ts` (browser-safe): deps from an input and records, a counting massing memo.
- Create `src/lib/sim/world/test/map-stream-run.ts` (browser-safe): sink that buffers `createWorld` events, `fill`, `rewindTo`, the fake controller.
- Create `src/lib/sim/world/test/map-stream-cities.node.ts` (Node): parcel records for the bench city, the fixture and a dataset directory.
- Create `scripts/map-stream-live.ts` (+ `scripts/map-stream-live.spec.ts`): fetches the live files into a directory.
- Create `scripts/map-stream-measure.ts`: the Task 2 measurement.
- Modify `src/lib/map/types.ts:59-67` (`TimelineUpdate`), `src/lib/map/timelapse/demolish.ts` (`amend`), `src/lib/map/timeline-controller.ts:182-202` (`apply`), and their specs.
- Create `docs/dev/map-stream.md`; modify `docs/dev/map-interfaces.md` and `CLAUDE.md` (one scoped-doc line).

---

### Task 1: The minimum stream: `onEvent`, `flush`, deps

**Files:**
- Create: `src/lib/sim/world/map-stream.ts`
- Create: `src/lib/sim/world/test/map-stream-deps.ts`, `src/lib/sim/world/test/map-stream-run.ts`, `src/lib/sim/world/test/map-stream-cities.node.ts`
- Test: `src/lib/sim/world/map-stream.spec.ts`

**Interfaces:**
- Consumes: `WorldEvent`, `World`, `StepSink`, `ORIGIN_*` (`world/types.ts:7-12, 128-150`); `scheduleAt`, `monthLastDay`, `createWorld`, `step`, `planDue`, `staticsOf`, `Statics` (`world/index.ts`); `massingFor`, `cellAnchorParcel`, `footprintParcel`, `MassingCtx` (`scenario/massing.ts:26-54, 185`); `packTimedCell`, `TimedPackInput` (`map/pack-timed.ts:11-17, 44`); `validateTimedCell` (`map/timelapse/encode.ts:30`); `createLru`, `Lru` (`sim/lru.ts`); `TimelineUpdate`, `TimedPackedCell` (`map/types.ts:50-67`). Test support: `benchInput`, `fixtureInput`, `liveInput` (`world/test/cities.node.ts`), `Recorder`, `runWorld`, `readAll` (`world/test/run.ts`), `frameOf`, `oneFrame` (`world/test/timeline.ts`).
- Produces (`map-stream.ts`):
  ```ts
  export const MASSING_CAP = 60_000;
  export interface MapStreamDeps {
    /** `records` answers for every parcel of every ready cell; `input.parcels` places cells. */
    massing: MassingCtx;
    /** True once the cell's chunk records answer `massing.records`. */
    cellReady(cellId: string): boolean;
    /** Logs once per key (a parcel absent from T11, an unpackable item). */
    warnOnce(key: string, msg: string): void;
    /** Budget clock in ms; default `performance.now`. */
    now?(): number;
    /** Test seam; default MASSING_CAP. */
    massingCap?: number;
  }
  export interface MapStream {
    onEvent(e: WorldEvent, world: World, statics: Statics): void;
    flush(world: World, statics: Statics, budgetMs: number): TimelineUpdate | null;
    rewind(world: World, statics: Statics): void;
    snapshot(world: World, statics: Statics): TimelineUpdate;
  }
  export function createMapStream(deps: MapStreamDeps, windowMonths: number): MapStream;
  ```
  `rewind` and `snapshot` throw `new Error('map-stream: not built yet')` until Tasks 5 and 6. `demolish` is `[]` until Task 3.
- Produces (test support):
  ```ts
  // test/map-stream-deps.ts
  export function streamDeps(
    input: SimInput,
    records: Iterable<ParcelRecord>,
    o?: { ready?: (cellId: string) => boolean; now?: () => number; massingCap?: number }
  ): MapStreamDeps & { massingCalls(): number; warnings: string[] };
  // `massingCalls` counts `massing.memo.get` calls (one per massingFor call that reaches the
  // generator memo, massing.ts:119-129). Generator memo: createLru(60_000); gen/genForUnits from
  // $lib/generator.
  // test/map-stream-run.ts
  export class StreamSink implements StepSink { /* buffers until attach(world) */ }
  export function startStream(statics: Statics, timeline: PolicyTimeline, seed: number,
    stream: MapStream): { world: World; sink: StreamSink };
  export function fill(o: { world: World; statics: Statics; timeline: PolicyTimeline; seed: number;
    stream: MapStream; sink: StreamSink; through: number; flushEvery?: number; budgetMs?: number;
    due?: Due }): TimelineUpdate[]; // every update also passes validateTimedCell
  // test/map-stream-cities.node.ts
  export function benchRecords(): ParcelRecord[];          // synthCity().chunks, decodeParcelChunk
  export function fixtureRecords(): ParcelRecord[];        // e2e/fixtures/data/fixture-0 chunks
  export function dirRecords(dir: string): ParcelRecord[]; // manifest.chunks[].url files
  ```

- [ ] **Step 1: Write the failing tests** in `map-stream.spec.ts` (server; bench city unless named; seed 1; flush once per month with `Infinity` budget unless named):
  - `onEvent marks dirty and packs nothing`: after `createWorld` events replayed, `deps.massingCalls() === 0`; the first `flush` is non-null.
  - `pipeline at the dataset date goes out first (rule 12)`: the first `flush(…, Infinity)` after `createWorld` holds a slot for every row with `scheduleAt(world, statics, row, statics.asOf) !== null` and a T11 parcel (compare sets of `slotProjectIds`).
  - `a start, its construction and its completion` (spec test 2, without the demolish part): from a `Recorder` pre-run, pick the first `ORIGIN_SIM` row with start month s, construction month c and complete month e, `1 < s < c < e`. Then with the stream: the update after month s has its slot with `slotEnd` `[NaN, 0]` and `slotStages` NaN at `construction` and `complete`; the update after month e has `slotEnd[0] === completeDay` and kind 1. Assert the row was found.
  - `the cell is the smallest parcel's, the pick parcel the largest (rule 2)`: the first schedule (fixture, else bench) with two or more T11 parcels: its slot sits in `cellOf(cellAnchorParcel(ids))` and `parcelIds[slot] === footprintParcel(recs).id`. Assert one was found.
  - `a cell goes whole`: a cell whose second project changes holds both slots in the update.
  - `null when nothing changed`: two flushes with no step between; the second is `null`.
  - `the budget packs oldest first and keeps the rest`: fake `now` returning `10 * calls`; with 5 dirty cells, `flush(…, 20)` packs exactly the 2 dirtied first; the next flush the next 2; `flush(…, 0)` packs 1.
  - `a cell needing an unloaded chunk waits and keeps its place` (Review Focus 3): `ready` false for one cell of a two-cell project; its anchor cell is absent from updates while others go; after `ready` turns true the next flush sends it first.
  - `revisions count from 0 and complete is set (rule 7)`: revisions are 0, 1, 2, … in order; `complete` is false before month `windowMonths` (use `windowMonths = 24`) and true on the first update after month 24 with no ready dirty cell.
  - `massingFor runs once per revision (rule 11)`: pack one cell three times through events that add no revision; `massingCalls()` equals the cell's total revision count. With `massingCap: 1` and two revisions, a repack calls it again.
  - `every update passes validateTimedCell` (done inside `fill`; one test asserts the count of validated cells > 0).

- [ ] **Step 2: Run, expect FAIL** (L1 first): `npx vitest --run --project server src/lib/sim/world/map-stream.spec.ts` → fails: module `./map-stream` not found.

- [ ] **Step 3: Implement** `map-stream.ts` and the three helpers per the Interfaces and Decisions. `lastDay = monthLastDay(statics.asOf, world.month)` (`months.ts:9`). Item per project: `{ schedule, massings: schedule.revisions.map((_, k) => memoised massingFor(schedule, k, deps.massing)), pickParcelId: footprintParcel(loadedRecs).id }`; a project with no loaded record is `warnOnce`d and left out (`geometry.ts:207-212`). A cell whose projects all left (cannot happen before Task 5) is not packed.

- [ ] **Step 4: Run, expect PASS** (L1): same command.

- [ ] **Step 5: Lint and types** (L1): `npx eslint src/lib/sim/world/map-stream.ts src/lib/sim/world/test` then `npm run check` → no errors.

- [ ] **Step 6: Commit**
  ```bash
  git add src/lib/sim/world/map-stream.ts src/lib/sim/world/map-stream.spec.ts src/lib/sim/world/test/map-stream-deps.ts src/lib/sim/world/test/map-stream-run.ts src/lib/sim/world/test/map-stream-cities.node.ts
  git commit -m "feat(map-stream): onEvent marks cells dirty, flush packs them whole within a budget"
  ```

### Task 2: Measurement 1 (spec rule 1), then stop and report to `main`

**Files:**
- Create: `scripts/map-stream-live.ts`, `scripts/map-stream-live.spec.ts`
- Create: `scripts/map-stream-measure.ts`
- Optional (only if cheap, see Step 7): `src/lib/map/map-stream-apply.perf.svelte.spec.ts`
- Report (git-ignored, not committed): `W/.superpowers/sdd/map-stream/measurement-1.md`

**Interfaces:**
- Consumes: Task 1's `createMapStream`, `streamDeps`, `StreamSink`, `startStream`, `dirRecords`, `benchRecords`; `liveInput`, `benchInput` (`world/test/cities.node.ts:25-49`); `scenarioUrls` (`scenario/load.ts:118-129`); `parseManifest` (`data/manifest`).
- Produces:
  ```ts
  // scripts/map-stream-live.ts
  /** Paths relative to /data/<version>/: manifest.json, scenarioUrls' parcels, projects and
   *  calibration (and policy, gross when present), and every manifest.chunks[].url. Throws on a
   *  URL outside the version. */
  export function liveFiles(manifest: Manifest): string[];
  // CLI: npx tsx scripts/map-stream-live.ts <version> <outDir> [--from <origin>]
  //   default origin https://sfhousing.mindlace.net; skips files already present.
  // CLI: npx tsx scripts/map-stream-measure.ts (<datasetDir> | --bench)
  //   [--seed 1] [--months 480] [--budget 20] [--every 1]   → prints one JSON object
  ```

- [ ] **Step 1: Failing test** `scripts/map-stream-live.spec.ts`: `liveFiles(fixture-0 manifest)` contains `manifest.json`, the three scenario files of `scenarioUrls(manifest)` with the `/data/fixture-0/` prefix removed, and one entry per `manifest.chunks` entry; a manifest whose chunk URL names another version throws.

- [ ] **Step 2: Run, expect FAIL** (L1): `npx vitest --run --project server scripts/map-stream-live.spec.ts`.

- [ ] **Step 3: Implement `liveFiles` and the CLI** (global `fetch`, write under `<outDir>/<path>`, mkdir parents). Run it, from `W`:
  `npx tsx scripts/map-stream-live.ts 2026-11-10-6ee5a23d .superpowers/sdd/map-stream/live/2026-11-10-6ee5a23d`
  Then `git check-ignore -v .superpowers/sdd/map-stream/live/2026-11-10-6ee5a23d/manifest.json` → names `.git/info/exclude`. Then check that the loader reads it: the measurement's first line (Step 5) loads it through `liveInput`; a missing file there means `liveFiles` missed one (fix `liveFiles`, not the loader).

- [ ] **Step 4: Run, expect PASS** (L1), then commit:
  ```bash
  git add scripts/map-stream-live.ts scripts/map-stream-live.spec.ts
  git commit -m "chore(map-stream): fetch a published dataset's scenario files and chunks into a directory"
  ```

- [ ] **Step 5: Write `scripts/map-stream-measure.ts`** (modelled on `scripts/measure-policy-compile.ts`: header comment with the command, prints machine info `cpus()[0].model`, `loadavg()`). Input: `liveInput(dir)` with `dirRecords(dir)`, or `benchInput()` with `benchRecords()`; `SFH_WORLD_LIVE` is read when no directory argument is given. One unfunded world: `oneFrame(frameOf(input))`, `createWorld`/`planDue`/`step` from `src/lib/sim/world/index.ts`, `windowMonths = months`, all cells ready, `streamDeps` with the real `performance.now`. Per stepped month (every `--every` months): `flush(world, statics, budget)` timed with `performance.now()`; after the last month, flush until null. Then one `snapshot` timed (Task 6 not built: skip it with `snapshot: "not built"`). Output JSON fields:
  - `dataset` (`datasetVersion`), `seed`, `months`, `budgetMs`, `every`
  - `projects` (rows with a cell), `cells` (distinct cells sent)
  - `packsPerCell`: counts of cells packed exactly 1, 2, 3–5, 6–10, 11–50, >50 times; `maxPacks` and its cell
  - `cellsPackedMoreThanOnce`
  - `flushes`, `nonNullUpdates`, `cellsPerUpdate` `{p50, p95, max}`
  - `packMsTotal` (sum of flush times), `flushMsWorst` (and the month it happened), `flushMsP95`
  - `drainFlushes` (flushes needed after the last month)
  - `stepMsTotal` (the world's own steps, for scale)

- [ ] **Step 6: Run the measurement under L2** (lock held for both runs, under 15 minutes; split if longer), from `W`:
  - `SFH_WORLD_LIVE=.superpowers/sdd/map-stream/live/2026-11-10-6ee5a23d npx tsx scripts/map-stream-measure.ts --budget 20 --every 1`
  - `npx tsx scripts/map-stream-measure.ts --bench --budget 20 --every 1`
  - and once each with `--every 12` (a coarser posting rate, for comparison).
  If `tsx` cannot resolve `$lib`, run `npx svelte-kit sync` once and retry; if it still fails, move the body into `src/lib/sim/world/map-stream.measure.perf.spec.ts` under `describe.skipIf(!process.env.SFH_MAP_STREAM_MEASURE)` printing the same JSON, and run it with `npx vitest --run --project perf <file>`.

- [ ] **Step 7: The controller's cost to apply one update, only if cheap.** Cheap means: one new case in a copy of `src/lib/map/timeline.perf.svelte.spec.ts`'s setup (real `SimMap`, fixture manifest, `loadSyntheticTimeline(seed, 30_000)` through the debug hook, `src/lib/map/debug.ts:170-175`), applying a revision-1 update of K synthetic cells, K = the live run's `cellsPerUpdate.p95`, and recording the main-thread time from `applyTimeline` until `debugSnapshot().pending === 0` (bar rebuild and declutter included). If that case cannot be written in about an hour from the existing harness, do not build it: record it as owed to `ensemble-runner`/`timeline-ui`. Either way no stand-in page. If built, run it under L2: `npx vitest --run --project client-perf src/lib/map/map-stream-apply.perf.svelte.spec.ts`, and commit it (`test(map-stream): time one streamed update's apply on the real controller`).

- [ ] **Step 8: Write `.superpowers/sdd/map-stream/measurement-1.md`**: the commands, the machine line, both datasets named, every JSON field as a table per dataset and cadence, numbers marked "quiet (lock held)", the controller apply cost or "owed to ensemble-runner/timeline-ui", and three lines of reading: whether repacking is a problem at this cadence, whether `flush(…, 20)` overshoots (worst single cell), and what the posting rate implies for the controller.

- [ ] **Step 9: Commit the measure script**
  ```bash
  git add scripts/map-stream-measure.ts
  git commit -m "chore(map-stream): measure packing for one world filled to forty years"
  ```

- [ ] **Step 10: STOP.** The operator sends `main` the report path and its headline numbers (spec rule 1) and waits for `main`'s go-ahead before Task 3. Do not start Task 3 without it.

### Task 3: Demolitions after revision 0, in the stream and on the map (rule 8, T13)

**Files:**
- Modify: `src/lib/map/types.ts:59-67`
- Modify: `src/lib/map/timelapse/demolish.ts` (add `amend`; share `swap`'s diff)
- Modify: `src/lib/map/timeline-controller.ts:182-202`
- Modify: `src/lib/sim/world/map-stream.ts`
- Test: `src/lib/map/timelapse/demolish.spec.ts`, `src/lib/map/timeline-controller.spec.ts:190-203` (replaced), `src/lib/sim/world/map-stream.spec.ts`, `src/lib/sim/world/map-stream.rewind.spec.ts` (create; real controller cases)

**Interfaces:**
- Consumes: Task 1's stream and helpers; `DemolishPump` (`demolish.ts:23-`), `TimelineController` (`timeline-controller.ts:127`), `makeFakeTimelineDeps` (`map/test/fake-timeline-deps.ts`), `timelineSmall`, `timelineSmallRev1`, `SLOT`, `DAYS` (`map/fixtures/timeline-small.ts`).
- Produces:
  ```ts
  // map/types.ts, TimelineUpdate
  demolish: { parcelId: ParcelId; day: Day }[]; // revision 0: the complete list; later: entries newly known
  /** After revision 0: lots whose demolition no longer holds (applied before `demolish`). Ignored in revision 0. */
  restore?: ParcelId[];
  // demolish.ts
  /** Removes every entry of each `restore` parcel, then adds `add`; the applied set is at once
   *  the new list's prefix at the target, feature-state follows by swap's diff. */
  amend(add: readonly { parcelId: ParcelId; day: Day }[], restore: readonly ParcelId[]): void;
  ```
  Controller `apply`, revision > 0 in order: `if (u.restore?.length || u.demolish.length) this.pump.amend(u.demolish, u.restore ?? [])`; the `console.error` at `:191-195` goes. A rejected revision (gap) touches nothing, as today (`:184-187`).
  Stream: revision 0 carries every demolition known (sorted by `parcelId`, as `geometry.ts:225-229`); later updates carry the parcels whose earliest day is new or changed since the last update.

- [ ] **Step 1: Failing tests.**
  `demolish.spec.ts`:
  - `amend adds entries that apply as revision-0 entries do`: after `replace(list)`, `amend([{x, d}], [])`; `setTarget(d - 1)` then a frame: `has(x)` false; `setTarget(d)`, frame: `has(x)` true and `setReplaced(x)` called once.
  - `amend restore removes every entry of a parcel`: a parcel with two entries, applied; `amend([], [x])`, frame: `has(x)` false, `clearReplaced(x)` called, `total` down by 2.
  - `restore and add of one parcel hides it from the new day only` (Review Focus 5): entry `(x, d1)` applied; `amend([{x, d2}], [x])`, `d2 > d1`, target between: `has(x)` false; target `d2`: true.
  - `amend while a swap diff is owed converges`: as the existing swap-diff test, an `amend` before the diff drains; after frames, the fake's replaced set equals the applied set.
  `timeline-controller.spec.ts` (replace `ignores a non-empty demolish list after revision 0, with one console.error`):
  - `applies demolish after revision 0 like revision-0 entries`: rev 0 `timelineSmall`, rev 1 with `demolish: [{ parcelId: SLOT.b.parcelId, day: DAYS.start }]`; `setTime(DAYS.horizon)`, `flushFrame()`: `deps.replaced.has(SLOT.b.parcelId)` true; `demolish.total` is `timelineSmall.demolish.length + 1`; `error` not called.
  - `restore shows the existing building again on every day`: a parcel of `timelineSmall.demolish`, applied at the horizon; rev 1 `restore: [it]`; after a frame `deps.replaced.has(it)` false, and false again after `setTime(DAYS.start)` and `setTime(DAYS.horizon)`.
  - `an update with no restore and empty demolish leaves the pump as it was`: snapshot of `demolish` and `deps.replaced` equal before and after `timelineSmallRev1`; no `error`.
  - `a revision gap with demolish changes nothing and asks for resync`: rev 2 after rev 0: `onResyncNeeded` called, `demolish.total` unchanged.
  `map-stream.spec.ts`:
  - `a construction month carries the lot in demolish once` (spec test 2, demolish part): with Task 1's row, the update after month c holds `{ parcelId, day: constructionDay }`, no other update holds that parcel.
  - `revision 0 carries every demolition known so far`: stream created after a world stepped to month 60 with events buffered: first update's `demolish` equals, as a set, the earliest construction day per T11 parcel over `readAll(world, statics, lastDay)`.
  - `two projects on one lot: the earliest construction day only` (Review Focus 2): find (bench, seeds 1..20) a lot with two rows that entered construction; the demolitions sent for it total one entry with the earlier day.
  `map-stream.rewind.spec.ts` (create):
  - `with the real controller, the existing building is hidden from the construction day` (spec test 3, first half): feed every update of a fill through month c + 1 to a `TimelineController` on `makeFakeTimelineDeps`; `setTime(constructionDay - 1)` + `flushFrame()`: `controller.demolished.has(lot)` false; `setTime(constructionDay)` + `flushFrame()`: true.

- [ ] **Step 2: Run, expect FAIL** (L1): `npx vitest --run --project server src/lib/map/timelapse/demolish.spec.ts src/lib/map/timeline-controller.spec.ts src/lib/sim/world/map-stream.spec.ts src/lib/sim/world/map-stream.rewind.spec.ts`.

- [ ] **Step 3: Implement** `amend` (keep `days`/`ids` sorted by `(day, parcelId)`: filter out restored parcels, merge the sorted additions, then run the diff path `swap` uses at `demolish.ts:76-104`, factored into one private method both call), the controller change, the types change, and the stream's demolition tracking (on `'enter'` with `stage === 'construction'`, for each T11 parcel of the row).

- [ ] **Step 4: Run, expect PASS** (L1): same command, plus the rest of the map's controller specs unchanged: `npx vitest --run --project server src/lib/map`.

- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/map/types.ts src/lib/map/timelapse/demolish.ts src/lib/map/timelapse/demolish.spec.ts src/lib/map/timeline-controller.ts src/lib/map/timeline-controller.spec.ts src/lib/sim/world/map-stream.ts src/lib/sim/world/map-stream.spec.ts src/lib/sim/world/map-stream.rewind.spec.ts
  git commit -m "feat(map): demolitions added and restored after revision 0; map-stream sends them"
  ```

### Task 4: Signoff equality with today's packing

**Files:**
- Test: `src/lib/sim/world/map-stream.equality.spec.ts`

**Interfaces:**
- Consumes: Tasks 1 and 3; `createGeometry` (`scenario/geometry.ts:80`), `simulateDetailed` (`scenario/simulate.ts:26`), `oldInputOf` (`world/test/timeline.ts:116`), `horizonMonth`, `readAll` (`world/test/run.ts:19, 70`), `monthLastDay`.
- Produces: nothing new.

- [ ] **Step 1: Write the test** (`describe.each([['bench', benchInput, benchRecords], ['fixture', fixtureInput, fixtureRecords]])`, seed 1, one frame, no money). In `beforeAll`: `H = horizonMonth(asOf)`, `H' = monthLastDay(asOf, H)`; fill a stream to month `H` flushing every 12 months with `Infinity` budget, then until null; keep `last: Map<cellId, TimedPackedCell>` (later updates overwrite, `removedCells` delete) and the demolitions folded in order (restore deletes, demolish sets). Reference: `old = simulateDetailed(oldInputOf(input), 1, H')`; `g = createGeometry({ input, schedules: old.schedules, records: all cells, recordOf, massingCtx, warnOnce })`.
  - `the world agrees with simulateDetailed at H' (precondition)`: `readAll(world, statics, H').schedules` equals `old.schedules`. A failure here is world-core's, reported to `main` with the seed and first differing project, not fixed here.
  - `the cells last sent equal packTimedCell over simulateDetailed's schedules`: `[...last.keys()].sort()` equals `[...g.anchoredCells()].sort()`, and for each cell `expect(last.get(c)).toEqual(g.pack(c))` (typed arrays compared element-wise by `toEqual`; NaN equals NaN).
  - `the demolitions sent equal today's revision 0 list`: folded map as a sorted list equals `g.demolish()`.

- [ ] **Step 2: Run** (L1): `npx vitest --run --project server src/lib/sim/world/map-stream.equality.spec.ts`. Expected PASS once Tasks 1 and 3 are right; a failure is a packer difference to fix in `map-stream.ts`. If the bench `beforeAll` exceeds the default hook timeout, flush every 60 months instead (the assertion reads only the last cells); never raise the timeout.

- [ ] **Step 3: Commit**
  ```bash
  git add src/lib/sim/world/map-stream.equality.spec.ts
  git commit -m "test(map-stream): cells and demolitions equal today's packing at the horizon"
  ```

### Task 5: `rewind` (rule 9) and `restore`

**Files:**
- Modify: `src/lib/sim/world/map-stream.ts`
- Modify: `src/lib/sim/world/test/map-stream-run.ts` (add `rewindTo`)
- Test: `src/lib/sim/world/map-stream.rewind.spec.ts`

**Interfaces:**
- Consumes: Tasks 1 and 3; `structuredClone(world)` is a full copy (`columns.spec.ts:85-99`); `planDue` accepts a world mid-run (`due.ts:68-104`); `changingAt`, `everyStage`, `frameOf` (`world/test/timeline.ts:42, 66, 130`).
- Produces:
  ```ts
  // test/map-stream-run.ts
  /** A copy of `saved` as world 1 after an edit: stream.rewind(copy, statics), then a due list
   *  for `timeline` through `through`. */
  export function rewindTo(saved: World, o: { statics: Statics; timeline: PolicyTimeline; seed: number;
    stream: MapStream; through: number }): { world: World; due: Due; sink: StreamSink };
  ```
  `rewind(world, statics)`: per row the stream has sent, compare the sent schedule's key (`entered`, `end`, `revisions`) with `scheduleAt(world, statics, row, lastDay)`: gone (row `>= world.projects.n` or null) or different → its cell dirty; a cell with no project left goes into the next update's `removedCells` only if it was sent (otherwise it is dropped from the queue); demolitions recomputed from the restored world and diffed against those sent: lost or changed → `restore`, new or changed → `demolish`. Unchanged cells are not re-sent. Revision numbers continue (rule 7).
  The "removes a project" policy: `NO_STARTS = frameOf(input, { id: 1, market: -1000 })` (frame change with a different `market` replans every free lot, world-core rule 7, `world.ts:483-485`; the start rate is then 0).

- [ ] **Step 1: Failing tests** (bench, seed 1, flush every month):
  - `rewind to month 60 and a refill without new starts removes the projects started after it` (spec test 4): fill to 120 saving a clone at 60; rewind to it under `changingAt(61, base, NO_STARTS, null)`; refill to 120. Precondition: at least one row started after 60 in the first fill (assert). After the refill's flushes: every such project id is absent from the folded last cells; each cell that held one was sent again or is in `removedCells`.
  - `a refill under the same policy sends only cells dirtied after the restore point` (spec test 5): fill to 120 saving at 60 and recording, per cell, the months its projects had events; rewind under the same timeline; the first update after rewind is null (nothing differs); the cells sent by the refill are exactly those with an event in months 61..120 (a `Recorder` alongside gives them).
  - `rewind to month 40 restores the lot of a project entering construction at 50; the real controller shows the building again` (spec test 3, second half, see Open question 1): Task 1's row with `s <= 40 < c`; fill to `c + 1`, save at 40 (pick 40 as `s` to `c - 1`, the spec's numbers are illustrative); rewind; the next update has `restore` with the lot; the real controller after it: `setTime(constructionDay)` + frame → `demolished.has(lot)` false. Refill under `changingAt(41, base, frameOf(input, { id: 1, speed: everyStage(2) }), new Int32Array(0))`: the lot comes back in `demolish` with a day later than the old one, and the controller hides it from that day only.
  - `a project started after the rewind point and absent from the refill never demolishes` (spec test 3's "a policy that removes the project", in the only form an unfunded world allows): a row with `40 < s` and `c` known; rewind to 40 under `NO_STARTS` from 41: after the refill the lot was restored (if it had been sent) and no later update names it in `demolish`; the controller shows the building on every day.
  - `a rewind drops a never-sent cell silently` (Review Focus 1): a fake clock so that a cell stays queued; rewind to before its project began: the next updates neither carry it in `cells` nor in `removedCells`.
  - `removing the later project keeps the lot demolished` (Review Focus 2): the two-project lot of Task 3, rewind between the two construction days: no `restore` for it.
  - `an emptied cell refilled before the flush is replaced, not removed` (Review Focus 4): refill under `changingAt(61, base, frameOf(input, { id: 1, market: 2 }), null)` (start days move), stepping 12 months before the first flush; search seeds 1..20 for a cell whose only project in the first fill started after 60 and which holds a different project after those 12 months (assert one was found): it is in `cells`, not in `removedCells`.
  - `the restore and the new day of one lot travel in one update` (Review Focus 5, stream side): with the slower-timer refill, if the new construction day is known by the first update after rewind's next flush, that update holds the parcel in both `restore` and `demolish`; else in separate updates; both orders fold to the new day.

- [ ] **Step 2: Run, expect FAIL** (L1): `npx vitest --run --project server src/lib/sim/world/map-stream.rewind.spec.ts`.

- [ ] **Step 3: Implement `rewind`** and `rewindTo` per the Interfaces.

- [ ] **Step 4: Run, expect PASS** (L1): same command, then the whole map-stream set: `npx vitest --run --project server src/lib/sim/world/map-stream`.

- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/sim/world/map-stream.ts src/lib/sim/world/test/map-stream-run.ts src/lib/sim/world/map-stream.rewind.spec.ts
  git commit -m "feat(map-stream): rewind replaces or removes changed cells and restores lost demolitions"
  ```

### Task 6: `snapshot` (rule 10) and the revision sequence

**Files:**
- Modify: `src/lib/sim/world/map-stream.ts`, `src/lib/sim/world/test/map-stream-run.ts` (add `FakeController`)
- Test: `src/lib/sim/world/map-stream.rewind.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // test/map-stream-run.ts
  /** Accepts revision 0 at any time, else only last + 1; throws otherwise. Folds cells, removals,
   *  demolish and restore into `cells` and `demolished` (parcel → day). */
  export class FakeController { apply(u: TimelineUpdate): void; cells: Map<string, TimedPackedCell>;
    demolished: Map<ParcelId, Day>; revision: number }
  ```
  `snapshot(world, statics)`: every ready cell with a project packed, revision 0, `demolish` the whole list, the queue cleared of those cells; the next update is revision 1.

- [ ] **Step 1: Failing tests:**
  - `snapshot after a plain fill equals a fresh stream's cells` (spec test 6): `snapshot` of the filled world vs a new stream's `snapshot` of a `structuredClone` of it: same cell ids, `toEqual` per cell, same demolish list.
  - `snapshot after a rewind and refill equals a fresh stream's cells`: the month-60 scenario of Task 5, then the same comparison.
  - `snapshot restarts the count`: revision 0, then the next non-null flush is revision 1.
  - `every update is accepted in order by a controller that needs last plus one` (spec test 7): `FakeController` fed every update of: fill to 120, rewind to 60 with `NO_STARTS`, refill, `snapshot`, step 12 more months; no throw; at the end `fake.cells` and `fake.demolished` equal a fresh `snapshot`'s.
  - `every update passes validateTimedCell` (spec test 7): asserted in `fill` already; here over the sequence above.

- [ ] **Step 2: Run, expect FAIL** (L1): `npx vitest --run --project server src/lib/sim/world/map-stream.rewind.spec.ts`.

- [ ] **Step 3: Implement `snapshot` and `FakeController`.**

- [ ] **Step 4: Run, expect PASS** (L1), then `npx vitest --run --project server src/lib/sim/world src/lib/map` (nothing of world-core's or the map's changes).

- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/sim/world/map-stream.ts src/lib/sim/world/test/map-stream-run.ts src/lib/sim/world/map-stream.rewind.spec.ts
  git commit -m "feat(map-stream): snapshot answers a resync with revision 0"
  ```

### Task 7: `test:perf` bar: `flush(…, 20)` ≤ 30 ms on the bench city

**Files:**
- Test: `src/lib/sim/world/map-stream.perf.spec.ts`

- [ ] **Step 1: Write the perf spec:** bench city, seed 1, one frame, `windowMonths = 480`, real `now`, flush after every month with `budgetMs = 20`, then until null; `expect(worst).toBeLessThanOrEqual(30)` with the month and cell count in the message; also prints worst, p95 and total. A fixture check first: the run sent at least 1,000 cells (so the bar is not met by an empty city). A second case times one `snapshot` at month 480 and prints it with no assertion (Open question 6).

- [ ] **Step 2: Run under L2:** `npx vitest --run --project perf src/lib/sim/world/map-stream.perf.spec.ts`. Expected PASS; a miss is reported with its numbers (one cell larger than the budget is the likely cause: report the cell and its project count, do not change the bar).

- [ ] **Step 3: Commit**
  ```bash
  git add src/lib/sim/world/map-stream.perf.spec.ts
  git commit -m "test(map-stream): flush(…, 20) stays within 30 ms on the bench city"
  ```

### Task 8: Docs

**Files:**
- Create: `docs/dev/map-stream.md`
- Modify: `docs/dev/map-interfaces.md` (new section after "Timeline lookups and cohorts", line 81)
- Modify: `CLAUDE.md` (one line in "Scoped reference docs")

- [ ] **Step 1: Write `docs/dev/map-stream.md`** ("The map feed", the section the spec places in `sim-timeline.md`, here in our own file per the standing rules): what `createMapStream` takes (`MapStreamDeps`), the call pattern for the host (replay `createWorld`'s events after it returns; `onEvent` for every event of world 1; `flush(world, statics, budgetMs)` between steps; `rewind` after restoring world 1; `snapshot` for `resyncMap`), rules 2 to 12 in one line each, the massing memo, what `complete` means, Task 2's headline numbers with dataset names, the tests and the perf spec, and the open questions still open.
- [ ] **Step 2: Add to `map-interfaces.md`** a section "Timeline demolitions after revision 0": `demolish` after revision 0 adds entries applied as revision 0's are; `restore?: ParcelId[]` takes back every entry of a lot, applied before `demolish`; revision 0 ignores `restore`; an update with no `restore` and an empty `demolish` changes nothing (so `/lesscars` and `/fzp` are unaffected); `DemolishPump.amend`.
- [ ] **Step 3: Add the CLAUDE.md line** after the "Policy levers engine" entry: `- **Map feed from a stepped world (\`MapStream\`, events to \`TimelineUpdate\`, rewind, snapshot, \`restore\`)** — [docs/dev/map-stream.md](docs/dev/map-stream.md)`.
- [ ] **Step 4: Check** (L1): `npx prettier --check docs/dev/map-stream.md docs/dev/map-interfaces.md CLAUDE.md` and `npx vitest --run --project server scripts/docs-index.spec.ts` → pass.
- [ ] **Step 5: Commit**
  ```bash
  git add docs/dev/map-stream.md docs/dev/map-interfaces.md CLAUDE.md
  git commit -m "docs: map-stream feed and the demolish/restore change"
  ```

### Task 9 (LAST, BLOCKED): `npm run bench:map` while a fill is streaming

Blocked on `ensemble-runner` (the worker that fills and posts `cells`) and `timeline-ui` (the page that receives them); message `main` when reached, and do not build it before. Reason: the bench drives the real page through `window.__sfhMap` (`docs/dev/map-perf.md`, "What the bench does"); what loads the main thread during a fill is the runner's posting (rate, size, transfer), which a replay of recorded updates through the debug hook would only guess at, and a page wired to a stand-in feed is the duplicated effort the standing rules forbid. When `main` merges those specs in: add a case to `e2e/bench/map-timeline.bench.ts` that opens `/sim` on the live dataset, starts playback while the first fill streams, and records p50/p95 frame time against the 16.7 ms bar; run under L2; record the row in `docs/dev/map-perf.md` "Results".

---

## Open questions for `main` (recommendation given; the plan follows it)

1. **Spec test 3, "a refill under a policy that removes the project"** for a project that started in month 30, with a rewind to month 40, cannot happen in an unfunded world: a started row keeps its row and its outcome under any later policy (world-core rule 12, "The outcome never changes"; rows never move, `world/types.ts:59`; a frame change only replans free lots, `world.ts:447-492`). **Recommendation, followed in Task 5:** test the restore at the rewind itself (the construction day is not yet known at month 40, so rule 9 restores the lot), then (a) a slower-timer refill that re-sends the lot at a later day, and (b) a separate project started after the rewind point under a no-new-starts policy, which never demolishes. If `main` wants the literal case, it needs a funded world (out of scope; it would go last, "message main").
2. **`complete` and cells waiting on chunks.** Rule 7 says "no cell is dirty", rule 6 keeps a waiting cell dirty; a far cell the viewport never loads would then keep `complete` false forever, and the controller drops a swap's leftovers only on a `complete` update (`timeline-controller.ts:365-368, 387-391`). **Recommendation, followed:** today's T6 meaning, no *ready* dirty cell (`geometry.ts:224`).
3. **`snapshot` and cells waiting on chunks.** Rule 10 says it clears the dirty set; rule 6 says such a cell waits. **Recommendation, followed:** `snapshot` packs every ready cell; waiting cells stay dirty and go out on a later flush (as today's revision 0 packs only ready cells).
4. **The equality day.** Rule 4 packs at the last day of `world.month`; the referee reads at `HORIZON` (`referee.spec.ts:14-27`). A world stepped to `horizonMonth` can hold days in `(HORIZON, monthLastDay]`. **Recommendation, followed in Task 4:** compare against `simulateDetailed(…, monthLastDay(asOf, horizonMonth))`, after a precondition that the world agrees with it at that day (world-core's referee covers `HORIZON` only; a miss there is world-core's).
5. **Events from `createWorld` precede the world** (`createWorld` takes the sink and returns the world, `world.ts:43-50`), while `onEvent` takes the world. **Recommendation, followed:** the host buffers `createWorld`'s events and replays them once it returns (our test sink does; `docs/dev/map-stream.md` tells `ensemble-runner`). No change to S17.
6. **`snapshot` and the 50 ms slice limit.** `snapshot` is unbudgeted (rule 10) and on the live city at 40 years may exceed 50 ms. Task 2 cannot time it (built in Task 6); Task 7 prints it on the bench city. If it exceeds 50 ms, `ensemble-runner` needs to post the resync in slices (e.g. `snapshot` then cells by `flush`); flagged now so it is not a surprise.
7. **Docs location.** The spec asks for a section in `docs/dev/sim-timeline.md`; the standing rules put it in our own `docs/dev/map-stream.md` (Task 8). The conductor unions CLAUDE.md lines at the merge.
