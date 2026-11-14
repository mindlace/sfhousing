# ensemble-runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The worker side of the new `/sim`: a timeline host that advances 48 worlds and 48 comparison worlds month by month ahead of the viewer, posts final months and map cells as it goes, and resumes from an edit's month.

**Architecture:** `src/lib/sim/world/host.ts` handles messages and composes three new modules under `src/lib/sim/world/runner/`: `dataset.ts` (load, chunks, yields), `lookups.ts` (the shared lookups: brushes, outlines, preview, lot-at, card deps) and `runner.ts` (compiles, the two `Ensemble`s of `ensemble.ts`, slicing, posting, edits). The page talks to it through `timeline-protocol.ts` and `timeline-client.ts`; `router.ts` puts it beside today's hosts. No hashed file changes (decision D1).

**Tech Stack:** TypeScript (worker bundle: zod-free, DOM-free, `$app`-free), Vitest (server project for signoff, perf project for timings), fixture-0 dataset, live dataset 2026-11-10-6ee5a23d for measurements.

**Spec:** `docs/superpowers/specs/2026-11-13-ensemble-runner-design.md` (binding). Also read: `docs/dev/world-core.md`, `policy-timeline.md`, `world-funding.md`, `world-score.md`, `map-stream.md`, `testing.md`; the inventory `.superpowers/sdd/2026-11-13-ensemble-runner/host-inventory.md` (Appendix A).

## Global Constraints

Copied verbatim from the spec:

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

From the operator standing rules (bind every task and every leaf brief):

- Measurement lock `/Users/mindlace/Projects/sfhousing/.claude/worktrees/sim-step-engine/.superpowers/sdd/measure.lock`: "Immediately before EVERY test, check, build or script run, look at the lock directory; if it exists and its `owner` is not ours, wait. Never remove a lock you did not create. Report any slip at once." Our owner string is `ensemble-runner`. Timings: `mkdir` the lock, write `ensemble-runner` into `owner`, wait 30 s, run, `rm -r` it at once; at most 15 minutes; mark numbers "quiet (lock held)"; name the dataset of every number.
- Files this spec owns: `src/lib/sim/world/host.ts`, `src/lib/sim/world/host*.spec.ts`, everything under `src/lib/sim/world/runner/`, `src/lib/sim/timeline-protocol.ts`, `src/lib/sim/timeline-client.ts`, `src/lib/sim/lookup-requests.ts`, and changes to `router.ts`, `protocol.ts`, `worker.ts`, `scenario-client.ts`, `worker-router.spec.ts`. Every other file under `src/lib/sim/world/` belongs to another spec: a needed change there is a request to `main`. world-core's hot modules (`world.ts`, `pipeline.ts`, `stage.ts`, `rates.ts`, `due.ts`, `holds.ts`, `columns.ts`, `months.ts`) are not edited.
- Our own hot loop (`runner/ensemble.ts`, `runner/runner.ts`) imports modules as namespaces and binds the names it uses once at the top, as world-core's do (`docs/dev/world-core.md`, Cost): a plain import costs a getter call per use under Vite's module runner.
- Signoff tests are cheap: chreode rejects raised per-test timeouts (`chreode.config.ts:97-99`), so no test sets a timeout; keep each under about 1 s alone on fixture-0 by choosing small `worlds` and `months` where the assertion allows.
- Vitest runs with `expect.requireAssertions`: every test calls `expect`.
- No Claude attribution; Conventional Commits; multi-line messages via `git commit -F <file>`; never `cd x && y` (use `env -C <worktree>`); do not push, open a PR or run signoff.

## Review Focus

1. **A `setPolicy` (or several) before the dataset has loaded or before month 1's frame exists.** Expected: the latest policy is the one compiled once the load finishes; nothing is posted for an older `rev`. Test in Task 6 (`setPolicy during load: only the latest rev is compiled and posted`).
2. **`parcelSummary` for a day before the dataset date, past the last stepped month, or before any month is stepped.** Expected: month clamped to `[1, last stepped]` (frame month 1 before any step), the day to the last day stepped; never a throw to the page. Test in Task 5 (`parcelSummary clamps the day and the frame month`).
3. **A needed chunk that fails while a compile waits on chunk yields (no gross table).** Expected: `compiling.failedCells` names it, filling of what is ready continues, the runner idles rather than spinning, and `retryChunks` finishes the compile. Test in Task 5 (`a failed needed chunk is reported and retryChunks completes the compile`).
4. **`openTimeline` or `dispose` while a slice, a load or a brush-file fetch is in flight.** Expected: nothing from the old session is posted afterwards; waiting lookups are answered `no-session`. Test in Task 5 (`a second openTimeline silences the first session`).
5. **`viewMonth` outside `1..months` or past `readyThrough()`.** Expected: clamped to the frames that exist; no throw; `lookups` posted only when the frame's permitting changes. Test in Task 5 (`viewMonth clamps out-of-range months`).

## Decisions

- **D1 (rule 1, builder's call within the spec's limits, flagged as Open question 1): no hashed file changes.** `createScenarioHost` keeps all its state in closures (`scenario-host.ts:468-1752`; it exports only `createScenarioHost`, `createToken`, `SLICE_MS`, `SLICE_PLAN_MS`, `BAND_POST_EVERY`, `REVISION0_CAP_MS`, `MEMO_CAP`), so a wrapper cannot reach its dataset; wrapping a second instance would load the dataset twice (against S16's heap bound) and its `awaitLevers` mode holds `prefetch` until a lever revision (`:617-620`). Everything the new host needs is reachable through functions the hashed folders already export (`loadScenario`, `createChunkLoader`, `cellsIntersecting`, `resolveBrushRows`, `brushCatalog`, `createLotIndex`, `fetchWithRetry`, `datasetUrl`, `decodeTransit`, `parseNeighborhoods`, `packOutlines`, `lotAtPoint`, `packCell`, `massingFor`, `simKey`, `scenarioRecordOf`, `createTableRecompute`, `createYieldRecompute`). The new host composes those in `runner/dataset.ts` and `runner/lookups.ts`, about 250 lines of glue that today live privately in `scenario-host.ts`. Changing `scenario-host.ts` would change the dataset version and need a full pipeline build and upload (`docs/dev/pipeline.md:40-53`). The old host retires when `timeline-ui` switches `/sim` (`/fzp` already redirects there), leaving one copy. **Hashed files changed: none.**
- **D2 (builder's call): series wait for their `ScoreStatics`.** `createWorldSeries` needs a `ScoreStatics`, which `scoreStaticsOf` gives only for a fully compiled timeline (S15), while rule 3 creates worlds at month 1's frame. Each world keeps a feed log (its events and `stepped` marks) that is applied to its series once its ensemble's compile has finished; world-score.md ("Feeding a series") shows a buffered feed gives the same series. On an edit the gate closes and reopens with the new statics; every series is re-created from its `data()` with the new object.
- **D3 (builder's call): each ensemble's series use that ensemble's own `ScoreStatics`.** The plan's series get `scoreStaticsOf(input, planTimeline, 'plan', months, rhna)`; the comparison's get `scoreStaticsOf(input, compTimeline, c.base, months, rhna)`. Reason: the tier table must match the frames the world stepped under. `compiled` carries the plan's. Both pass the object `scoreStaticsOf` returned (a clone throws).
- **D4 (builder's call): a comparison that `comparisonOf` gives unchanged (same `canonicalJson` of `doc`, same `base`) is not recompiled**; the ensemble keeps its timeline and worlds. Reason: saves a compile and is rule 16's case directly.
- **D5 (rule 9 vs map-stream): drain until an update has `complete: true`, never "until null".** Rule 9 says "until it returns null"; map-stream's doc and ledger line 268 say a finite-budget `flush` can return null while a cell is part-warm. Flushes stay 20 ms and at most four a second.
- **D6 (builder's call): a flush is a macrotask of its own.** A slice of units may run to about 45 ms; a 20 ms flush in the same task would pass 50 ms.
- **D7 (builder's call): unit estimates.** As today's scheduler: a unit of a kind runs only if elapsed time plus the largest of that kind's last 4 costs fits in `SLICE_PLAN_MS`; the first unit of a slice always runs. Kinds: `create`, `step`, `quiet`, `feed`, `compile`, `warm`, `copy`, `restore`.
- **D8 (builder's call): copies.** `Copy = { month, worlds: World[] (structuredClone), feeds: { data: WorldSeriesData | null; log: FeedEntry[] }[], ledgerLength: number }`, one array per ensemble, in a `Map<month, Copy>`; taking a copy is units of one world each.
- **D9 (builder's call): `MoneyFeed`.** Null when the plan's `frameAt(1).finance` is null or has no pools (policy-timeline rule 15: either every frame has finance or none). Otherwise `{ ledger: world 1's ledger, finance: plan.frameAt(model month holding the last day of through).finance!, world: world 1, statics }`.
- **D10 (builder's call): `lookups` is re-posted when the frame object at the last `viewMonth` has a different `calibration`, `newCalibration`, `speed` or `speedNew` object than the last posted** (shared objects within one compile, `compile.ts:139-144`), and once after every edit that replaces the plan timeline. It always carries `lookupsAt(frame)` copied to a new object.
- **D11 (builder's call): a compile throw that is not `LeverFormatError` posts `error` `'timeline'` and stops filling, like rule 21.**
- **D12 (builder's call): warm massings ahead.** World 1's `'start'` and `'revise'` events queue `(row, revision)`; `warm` units call `massingFor(scheduleAt(world1, statics, row, lastDay), k, massing)` on the shared generator memo before the next flush, so the flush finds them warm. Rows of pipeline projects are queued at world creation. A cold massing that alone exceeds 50 ms is reported (Task 1, Open question 6), not split.

## File Structure

| File                                              | Responsibility                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `scripts/ensemble-measure.ts` (create)            | Task 1 prototype loop and measurements; never imported by production                                   |
| `src/lib/sim/timeline-protocol.ts` (create)       | S14 message types, `TimelineErrorCode`, `openTimelineProblem`, `setPolicyProblem`                      |
| `src/lib/sim/lookup-requests.ts` (create)         | Request ids, pending promises and their `no-session` answers for the shared lookups, used by both clients |
| `src/lib/sim/timeline-client.ts` (create)         | `TimelineClient`, `WORLDS`, `WINDOW_MONTHS`                                                            |
| `src/lib/sim/scenario-client.ts` (modify)         | Use `lookup-requests.ts`; behaviour unchanged                                                          |
| `src/lib/sim/protocol.ts` (modify)                | `ParcelSummary.lookups?: Lookups`                                                                      |
| `src/lib/sim/world/runner/dataset.ts` (create)    | Load, chunk set, generator memo, `yieldSourceOf`, `CompileCtx`, `Statics`, `MassingCtx`                |
| `src/lib/sim/world/runner/lookups.ts` (create)    | Brush service, outlines, preview, lot-at, buildable stories, `CardDeps`                                |
| `src/lib/sim/world/runner/ensemble.ts` (create)   | One ensemble: worlds, due lists, feeds and series, world 1's ledger, copies, restore, quiet stepping   |
| `src/lib/sim/world/runner/runner.ts` (create)     | Two ensembles, compiles, slicing, finality, `filled`/`refill`/`cells`/`lookups` posts, edits           |
| `src/lib/sim/world/runner/test/harness.ts` (create) | File-backed dataset fetch (fixture-0 or a live dir), fake clock, posts, a plain-loop reference       |
| `src/lib/sim/world/host.ts` (create)              | `createTimelineHost`: messages, validation, session lifecycle, wiring dataset, lookups and runner      |
| `src/lib/sim/router.ts`, `worker.ts` (modify)     | `openTimeline` mode and routing                                                                        |
| `src/lib/sim/world/host.perf.spec.ts` (create)    | `test:perf` cases                                                                                      |
| `docs/dev/ensemble-runner.md` (create), `CLAUDE.md` (one line) | "The worker" section                                                                    |

---

### Task 1: Measure before building (rule 4 and the carried measurements)

**Files:**
- Create: `scripts/ensemble-measure.ts`
- Create (report, not committed as docs): `.superpowers/sdd/2026-11-13-ensemble-runner/measure-1.md`

**Interfaces:**
- Consumes: `loadScenario` (`scenario/load.ts:262`), `staticsOf`, `withFunding`, `createFundingSystem`, `compileTimeline`, `comparisonOf`, `DEFAULT_POLICY4`, `createWorldSeries`, `scoreStaticsOf`, `chunkOf`, `createMapStream`, `createTableRecompute`, `createYieldRecompute`, `precomputeView`, `recomputeStep`, `dirRecords` (`world/test/map-stream-cities.node.ts:24`), `transitPolicy`/`paintedPolicy`/`miniDoc`-style builders from `world/policy/test/fixtures.ts` adapted to the live `asOf`.
- Produces: numbers that set two constants used in Task 5: `PLAN_THROUGH` (`months`, or 60 if creating 96 worlds takes over 1.5 s) and whether D12's warm-ahead is needed beyond the one outlier. A STOP if the heap passes 300 MB.

Live dataset (read-only): `SFH_WORLD_LIVE=/Users/mindlace/Projects/sfhousing/.claude/worktrees/sim-step-engine/.claude/worktrees/step-map-stream/.superpowers/sdd/map-stream/live/2026-11-10-6ee5a23d` (manifest names `gross.bin`; chunks present for `dirRecords`). If it is absent, use the bench city and mark every number "bench".

- [ ] **Step 1: Write `scripts/ensemble-measure.ts`** (run with `node --expose-gc node_modules/.bin/tsx scripts/ensemble-measure.ts --dir <live> [--case <name>]`). A file-backed `loadScenario` as `cities.node.ts:51-83` does; `CompileCtx` from the loaded `fzp`, `{ parcels, policy }` and a `YieldSource` from the gross table (`createTableRecompute`) or, with `--no-gross`, from `dirRecords` (`createYieldRecompute`). Prototype fill loop: rule 6 order, `withFunding(createFundingSystem())`, one series per world fed in the sink, world 1 also to a `MapStream` and a ledger, copies every 60 months (`structuredClone` of each world plus `series.data()`). Each case prints median, p90 and max.
- [ ] **Step 2: Take the lock** (`mkdir`, `owner` = `ensemble-runner`, `sleep 30`).
- [ ] **Step 3: Run the cases** and record each in the report:
  1. `create`: 96 `createWorld` + `planDue(…, 480)` (48 plan on the default document, 48 comparison on `comparisonOf(DEFAULT_POLICY4)`), total ms. Gate: over 1500 ms → `PLAN_THROUGH = 60`.
  2. `heap`: `gc()` then `heapUsed` after load and compile (baseline), and after a full 480-month fill of both ensembles with every copy kept (0, 60, …, 480), `gc()` first. Report the delta in MB against 300. Over 300 → STOP: release the lock, write the report, message `main`; build nothing further.
  3. `fill`: ms per model month for all 96 worlds, scoring and `MapStream.onEvent` included, months 2 to 480, live with baseline funding; worlds per second; against 9 ms. Also the same without money.
  4. `burst`: month 1 per world, funded (largest single unit).
  5. `replan`: a document with a dated change that replans every free lot (a market step or a zoning policy from month 120); the change month per world, max against 50 ms. A miss is reported with numbers (the `StepCtx` bound is world-core's S12 change, not ours).
  6. `compile`: longest `step(20)` and time to first and to all frames for (a) one metro transit rule from month 1 and (b) 500 painted lots, with the gross table and with `--no-gross`; time inside the `precomputeView` and `recomputeStep` seams.
  7. `first`: open to first flushed cells and to the first final calendar month, prototype (load, both compiles, create, step, flush). Mark "prototype"; Task 8 re-measures through the host.
  8. `flush`: live flushes at budget 20 ms with and without D12's warm-ahead (cold memo each), longest flush and longest warm unit; `snapshot` cold and warm.
  9. `statics`: `scoreStaticsOf` once, and re-creating 96 series from `data()` (D2).
- [ ] **Step 4: Release the lock at once** (`rm -r` the directory) and confirm it is gone.
- [ ] **Step 5: Write the report** `.superpowers/sdd/2026-11-13-ensemble-runner/measure-1.md`: every number with "quiet (lock held)", the dataset, the machine; the two gate outcomes; misses against 9 ms, 50 ms and 3 s with numbers. Send it to `main` before Task 2 starts if any gate trips.
- [ ] **Step 6: Commit** `scripts/ensemble-measure.ts` (`chore: ensemble-runner measurement script`).

### Task 2: Timeline protocol and client

**Files:**
- Create: `src/lib/sim/timeline-protocol.ts`, `src/lib/sim/lookup-requests.ts`, `src/lib/sim/timeline-client.ts`
- Modify: `src/lib/sim/protocol.ts` (`ParcelSummary`), `src/lib/sim/scenario-client.ts` (adopt `lookup-requests.ts`)
- Test: `src/lib/sim/timeline-client.spec.ts`, `src/lib/sim/timeline-protocol.spec.ts`; `src/lib/sim/scenario-client.spec.ts` unchanged and passing

**Interfaces:**
- Produces (exact; later tasks use these names):

```ts
// timeline-protocol.ts
export type TimelineErrorCode = ScenarioErrorCode | 'timeline';
export type OpenTimelineRequest = { type: 'openTimeline'; rev: Rev; manifest: Manifest; policy: SimPolicy4;
  lots: Record<string, ParcelId[]>; worlds: number; months: number };
export type SetPolicyRequest = { type: 'setPolicy'; rev: Rev; policy: SimPolicy4; lots: Record<string, ParcelId[]> };
export type TimelineRequest = OpenTimelineRequest | SetPolicyRequest
  | { type: 'viewMonth'; month: number } | { type: 'resyncMap' };
/** Today's requests the timeline host also answers (shapes unchanged). */
export type SharedRequest = Extract<ScenarioRequest, { type: 'parcelSummary' | 'resolveBrush' | 'brushCatalog'
  | 'lotOutlines' | 'previewBuildings' | 'heightLids' | 'lotAt' | 'prefetch' | 'retryChunks' }>;
export type TimelineHostRequest = TimelineRequest | SharedRequest;
export type TimelineResponse =
  | { type: 'compiling'; rev: Rev; done: number; total: number; failedCells: string[] }
  | { type: 'compiled'; rev: Rev; capacity: LeverCapacity; unknownLots: number; statics: ScoreStatics }
  | { type: 'filled'; rev: Rev; through: number; series: SeriesChunk }
  | { type: 'refill'; rev: Rev; from: number }
  | { type: 'cells'; render: TimelineUpdate }
  | { type: 'lookups'; month: number; lookups: LeverLookups }
  | { type: 'error'; rev: Rev; code: TimelineErrorCode; message: string };
/** Everything the timeline host posts: its own messages and today's shared answers. */
export type TimelineHostResponse = TimelineResponse | Exclude<ScenarioResponse, { type: 'error' | 'timeline' | 'ranks' | 'levers' }>;
export function openTimelineProblem(req: unknown): string | null; // manifest object, policy object, lots record of string arrays, worlds and months integers >= 1, rev integer
export function setPolicyProblem(req: unknown): string | null;
// protocol.ts: ParcelSummary gains `lookups?: Lookups` (from $lib/sim/levers/apply)
// lookup-requests.ts
export class LookupRequests { constructor(post: (msg: WorkerRequest) => void);
  parcelSummary(parcelId: ParcelId, day: Day, projectId?: string): Promise<ParcelSummary | null>;
  resolveBrush(q: BrushQuery): Promise<BrushLotsResult>; lotOutlines(lots: ParcelId[]): Promise<LotOutlinesResult>;
  lotAt(point: [number, number]): Promise<LotAtResult>; previewBuildings(lots: ParcelId[], stories: number): Promise<PreviewResult>;
  heightLids(bbox: [number, number, number, number]): Promise<HeightLidsResult>; brushCatalog(): Promise<BrushCatalog | null>;
  /** True when `msg` answered a pending request. */ receive(msg: { type: string }): boolean;
  /** Every pending request answered as today's `#resolvePending` answers it. */ resolveAll(): void }
// timeline-client.ts
export const WORLDS = 48; export const WINDOW_MONTHS = 480;
export interface TimelineClientEvents { onReady?; onFilled?(m); onRefill?(m); onCells?(m); onLookups?(m); onCompiling?(m);
  onCompiled?(m); onError?(m); onChunks?(m); onHeights?(m); onCrash?(e: Event) }
export class TimelineClient { constructor(worker: ScenarioWorkerInput, events: TimelineClientEvents);
  open(manifest: Manifest, policy: SimPolicy4, lots: Record<string, ParcelId[]>): Rev;
  setPolicy(policy: SimPolicy4, lots: Record<string, ParcelId[]>): Rev; viewMonth(month: number): void; resyncMap(): void;
  prefetch(bbox: BBox): void; retryChunks(): void; /* the seven lookups of LookupRequests, same signatures */
  readonly crashed: boolean; restart(worker: ScenarioWorkerInput): void; dispose(): void }
```

- [ ] **Step 1: Write the failing tests** in `timeline-client.spec.ts` with a fake worker (as `scenario-client.spec.ts` does):
  - `open posts openTimeline with WORLDS and WINDOW_MONTHS`: `expect(sent[0]).toMatchObject({ type: 'openTimeline', rev: 1, worlds: 48, months: 480 })`.
  - `drops compiling, compiled, filled and refill older than the last setPolicy`: after `open` (rev 1) and `setPolicy` (rev 2), deliver `filled` rev 1 and rev 2: `expect(onFilled).toHaveBeenCalledTimes(1)` with rev 2; same for the other three.
  - `never drops cells or lookups`: deliver `cells` and `lookups` after a `setPolicy`: both callbacks called.
  - `restart re-opens with the last policy and lots`: after `setPolicy(p2, l2)` and a crash, `restart(w2)` posts `openTimeline` with `policy: p2, lots: l2` and a new rev; `crashed` false.
  - `lookups answer no-session on crash`: a pending `resolveBrush` resolves `{ ok: false, reason: 'no-session' }` on crash.
  - In `timeline-protocol.spec.ts`: `openTimelineProblem` returns null for a valid request and a message for `worlds: 0`, `months: 1.5`, a missing `lots`, `policy: null`.
- [ ] **Step 2: Run** `env -C <worktree> npx vitest --run --project server src/lib/sim/timeline-client.spec.ts src/lib/sim/timeline-protocol.spec.ts` (lock check first). Expected: FAIL, modules not found.
- [ ] **Step 3: Implement** the three new files and the two modifications. `LookupRequests` is `scenario-client.ts:211-305` and `:359-374` moved; `ScenarioClient` delegates to it. `TimelineClient` mirrors `ScenarioClient`'s crash handling (`:310-389`). `scenario/types.ts` is not touched.
- [ ] **Step 4: Run** the two new specs and `src/lib/sim/scenario-client.spec.ts` (unchanged). Expected: PASS. Then `npm run check` (lock check first): 0 errors.
- [ ] **Step 5: Commit** `feat: timeline worker protocol and client`.

### Task 3: Dataset and shared lookups

**Files:**
- Create: `src/lib/sim/world/runner/dataset.ts`, `src/lib/sim/world/runner/lookups.ts`, `src/lib/sim/world/runner/test/harness.ts`
- Test: `src/lib/sim/world/runner/lookups.spec.ts`, `src/lib/sim/world/runner/dataset.spec.ts`

**Interfaces:**
- Consumes: Appendix A rows 1, 4, 8, 14, 17 to 22, 43 to 47, 50 to 54 (the exported hashed functions named in D1).
- Produces:

```ts
// dataset.ts
export interface DatasetDeps { fetch: FetchLike; fetchBytes: FetchBytesLike; later(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void; now(): number; warn(msg: string): void; retryDelaysMs: readonly number[];
  maxConcurrent: number; stopped(): boolean; onChunk(cellId: string): void; onChunksReport(r: ChunksResponse): void;
  decodeParcels?; decodePolicy?; decodeGross?; load?(urls: ScenarioUrls): Promise<Loaded | LoadFailure> }
export interface ChunkSet { byCell: Map<string, ParcelRecord[]>; records: Map<ParcelId, ParcelRecord>; failed: string[];
  want(cells: Iterable<string>): void; prefetch(bbox: readonly number[]): void; retryFailed(): void; dispose(): void }
export interface Dataset { manifest: Manifest; urls: ScenarioUrls; loaded: Loaded; layers: LayerCtx; statics: Statics;
  chunks: ChunkSet; memo: Lru<string, GeneratedBuilding | null>; massing: MassingCtx; ctx(windowMonths: number): CompileCtx }
export function createChunkSet(manifest: Manifest, deps: DatasetDeps): ChunkSet;
export function loadDataset(manifest: Manifest, urls: ScenarioUrls, chunks: ChunkSet, deps: DatasetDeps,
  memo: Lru<string, GeneratedBuilding | null>, gen: GenDeps): Promise<Dataset | LoadFailure>;
/** S13 YieldSource: the gross table when loaded, else chunk records; wants each recompute's cellsNeeded(). */
export function yieldSourceOf(loaded: Loaded, chunks: ChunkSet, gross: GrossCache, now: () => number): YieldSource;
// lookups.ts
export function createBrushService(o: { manifest: Manifest; parcels: ScenarioParcels; policy: PolicyParcels;
  fetch: FetchLike; later(fn: () => void, ms: number): unknown; retryDelaysMs: readonly number[];
  stopped(): boolean; warn(msg: string): void; post(msg: TimelineHostResponse, transfer: ArrayBuffer[]): void }):
  { request(reqId: number, query: unknown | null): void; end(): void }; // query null = catalog
export function lotOutlinesResult(records: Map<ParcelId, ParcelRecord>, lots: readonly ParcelId[]): { result: LotOutlinesResult; transfer: ArrayBuffer[] };
export function previewResult(o: { parcels: ScenarioParcels; protectedRow(row: number): boolean; records: Map<ParcelId, ParcelRecord>;
  memo: Lru<string, GeneratedBuilding | null>; gen: typeof generate; lots: readonly ParcelId[]; stories: number; maxLots: number }): { result: PreviewResult; transfer: ArrayBuffer[] };
export function lotAtResult(manifest: Manifest, byCell: Map<string, ParcelRecord[]>, point: [number, number],
  owner: (id: ParcelId) => LimitOwner | null): LotAtResult;
export function buildableStories(o: { parcels: ScenarioParcels; records: Map<ParcelId, ParcelRecord>;
  memo: Lru<string, GeneratedBuilding | null>; gen: typeof generate }, parcelId: ParcelId, allowed: number, existingUnits: number): number;
export function cardDepsOf(ds: Dataset, parcels: () => ScenarioParcels, logOnce: (k: string, m: string) => void): CardDeps;
// test/harness.ts
export function datasetFetch(dir: string): { manifest: Manifest; fetch: FetchLike; fetchBytes: FetchBytesLike };
export interface FakeClock { now(): number; setTimeout(fn: () => void, ms: number): number; clearTimeout(h: unknown): void;
  tick(ms: number): void; runNext(): Promise<boolean>; runUntil(pred: () => boolean, max?: number): Promise<void> }
export function fakeClock(): FakeClock;
```

- [ ] **Step 1: Write the failing tests.** Differential against the old host on the mini city (`makeScenarioHarness({ policy: true })` from `scenario/test/host-harness.ts`, before any `setLevers`, so the old host answers on the base parcels, nothing protected):
  - `brush answers equal the old host's`: for a freehand, a transit and an area query and the catalog, `expect(newPost).toEqual(oldPost)` (same `lots`, same `points`, same catalog).
  - `a 4xx brush file is permanent, a 5xx retried and not cached`: as `scenario-host.brushes.spec.ts` does; `expect(fetchesOf(MINI_TRANSIT_URL)).toHaveLength(n)`.
  - `lotOutlinesResult equals the old host's lotOutlines`, `lotAtResult equals the old host's lotAt` (owner function returning the old owner).
  - `previewResult equals the old host's previewBuildings` for the same lots and stories, `protectedRow` all false, and `skips a protected row` with one row true.
  - `buildableStories equals the old host's limits.buildable` for an eligible lot (generator path and `lotBuildableStories` fallback with a null-returning `gen`).
  - In `dataset.spec.ts` on fixture-0 (`datasetFetch('e2e/fixtures/data/fixture-0')`): `loadDataset gives the CompileCtx a compile accepts` (`compileTimeline(DEFAULT_POLICY4, {}, ds.ctx(24), 'plan').step(Infinity)` is true); `yieldSourceOf uses the gross table when the manifest names one` (`recompute(...).cellsNeeded()` is `[]`); `without gross it wants the needed cells` (the chunk set's `want` spy received them).
- [ ] **Step 2: Run** `env -C <worktree> npx vitest --run --project server src/lib/sim/world/runner` (lock check first). Expected: FAIL.
- [ ] **Step 3: Implement** `dataset.ts`, `lookups.ts`, `test/harness.ts`. Glue follows `scenario-host.ts` line for line where Appendix A names it (rows 1, 4, 18 to 21, 46, 50 to 54); the parcels and the protection come from parameters, not from levers. `cardDepsOf.building(sc, k)`: `massingFor(sc, k, { ...ds.massing, records })` when every cell of the schedule's parcels is loaded, else `{ footprint: [] }` (`scenario-host.ts:255-256, 1340`).
- [ ] **Step 4: Run** the folder again. Expected: PASS. Run `src/lib/sim/scenario/` (unchanged): PASS.
- [ ] **Step 5: Commit** `feat: timeline host dataset and shared lookups`.

### Task 4: One ensemble

**Files:**
- Create: `src/lib/sim/world/runner/ensemble.ts`
- Test: `src/lib/sim/world/runner/ensemble.spec.ts`

**Interfaces:**
- Consumes: `withFunding`, `createFundingSystem` (one shared instance: it holds no state, `funding/system.ts:84-129`), `Statics`, `PolicyTimeline`, `createWorldSeries`, `WorldSeriesData`, `MapStream`, `LedgerEvent`.
- Produces:

```ts
export type FeedEntry = { e: WorldEvent } | { stepped: number };
export interface EnsembleOpts { statics: Statics; timeline: PolicyTimeline; worlds: number; planThrough: number;
  months: number; copyEvery: number; /** world 1 keeps a ledger and feeds this stream */ world1?: { stream: MapStream | null;
  onEvent?(e: WorldEvent): void } }
export interface Ensemble {
  /** Every world has stepped this month; -1 until every world exists. */ readonly month: number;
  readonly timeline: PolicyTimeline; readonly worlds: readonly World[]; readonly ledger: LedgerEvent[] | null;
  readonly series: readonly (WorldSeries | null)[];
  /** Next unit kind, or null when the ensemble waits (all at `months`, or the next frame not ready). */
  next(): 'create' | 'step' | 'quiet' | 'feed' | 'copy' | null;
  unit(): void;                       // runs one unit of the kind `next()` gives
  /** Opens the series gate with `s` (re-creating each series from data()), or closes it (null). */
  setStatics(s: ScoreStatics | null): void;
  finalThrough(): number;             // min over series finalThrough(); -1 while the gate is closed or a log is unfed
  keep(t: PolicyTimeline): void;      // rule 13: carry on under t
  /** Rule 14: restore from the last copy at or before m - 1, drop later copies, rebuild dues with planDue,
   *  cut the ledger; then `next()` gives 'quiet' until month m - 1. */
  restore(t: PolicyTimeline, m: number): void;
  readonly quiet: boolean;            // quiet steps remain
}
export function createEnsemble(o: EnsembleOpts): Ensemble;
```

Rules this module holds: worlds are created one per `create` unit with seed k (1..`worlds`), `planDue(world, statics, timeline, k, planThrough)`; a `step` unit advances the lowest-index world still at `month` (rule 6 within the ensemble); the sink feeds the world's log, world 1's ledger and, outside quiet steps, `world1.stream.onEvent` and `world1.onEvent` (D12); `createWorld`'s events are buffered and replayed once it returns (map-stream.md "Host calls"); after each step the log gets `{ stepped: month }`; when `month` reaches a multiple of `copyEvery` (0 included) `copy` units clone each world, its feed and the ledger length (D8); with the gate open, `feed` units drain logs into series (D2). If Task 1 set `planThrough` below `months`, `planDue` is re-run through `min(months, month + planThrough)` when `month` reaches `planThrough - 12` (one world per unit).

- [ ] **Step 1: Write the failing tests** on fixture-0 (`fixtureInput()` plus a compiled `DEFAULT_POLICY4`; 4 worlds, 130 months unless stated):
  - `series equal a plain loop`: for 8 worlds over 130 months, every `series[k].rows(0, final)` equals that of a plain `createWorld`/`step` loop with a fresh series per world fed live: `expect(rows).toEqual(reference)`.
  - `copies are taken after months 0, 60 and 120`: `expect([...copyMonths]).toEqual([0, 60, 120])`.
  - `restore to month 100 and re-step equals never stopping`: fill to 130; `restore(sameTimeline, 101)`; run to 130 again; worlds (`structuredClone` compare), ledger and series rows equal the uninterrupted run's; `quiet` was true for months 61 to 100 only.
  - `restore cuts world 1's ledger to its length at the copy`: after `restore(t, 61)` before any step, `expect(e.ledger!.length).toBe(lengthAtCopy60)`.
  - `quiet steps do not reach the map stream`: a recording stream's `onEvent` count does not change during quiet units.
  - `the gate buffers and replays exactly`: gate opened at month 0 versus opened at month 50 give equal rows.
  - `a step throws when the next frame is not ready`: `next()` is null while `readyThrough() === month` (a stub timeline).
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/sim/world/runner/ensemble.spec.ts` (lock check first). Expected: FAIL.
- [ ] **Step 3: Implement** `ensemble.ts` (namespace imports bound once at the top).
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `feat: ensemble of worlds with copies and restore`.

### Task 5: Host, opening and filling

**Files:**
- Create: `src/lib/sim/world/runner/runner.ts`, `src/lib/sim/world/host.ts`
- Test: `src/lib/sim/world/host.spec.ts`

**Interfaces:**
- Consumes: Tasks 2 to 4; `compileTimeline`, `comparisonOf`, `firstDifference`, `lookupsAt`, `limitsAt`, `limitsOf`, `scoreStaticsOf`, `finalTable`, `chunkOf`, `cardAt`, `createMapStream`, `monthOfDay`, `monthLastDay`, `SLICE_PLAN_MS` (`scenario-host.ts:242`), `packTimedTransferables`.
- Produces:

```ts
// runner.ts
export const COMPILE_STEP_MS = 20; export const FLUSH_EVERY_MS = 250; export const FLUSH_BUDGET_MS = 20; export const COPY_EVERY = 60;
export interface RunnerDeps { dataset: Dataset; post(msg: TimelineResponse, transfer: ArrayBuffer[]): void; now(): number;
  later(fn: () => void, ms: number): unknown; warn(msg: string): void; logOnce(k: string, m: string): void; planThrough?: number }
export interface Runner { open(rev: Rev, policy: SimPolicy4, lots: Record<string, ParcelId[]>, worlds: number, months: number): void;
  setPolicy(rev: Rev, policy: SimPolicy4, lots: Record<string, ParcelId[]>): void; viewMonth(month: number): void;
  resyncMap(): void; chunkArrived(): void;
  /** Plan frame at the last viewMonth (clamped to 1..readyThrough), or null before month 1's frame. */ viewFrame(): PolicyFrame | null;
  /** World 1 of the plan as it stands and the frame of the model month holding `day` (clamped, rule 18). */
  card(day: Day): { world: World; frame: PolicyFrame; day: Day } | null; dispose(): void }
export function createRunner(deps: RunnerDeps): Runner;
// host.ts
export interface TimelineHostDeps { fetch: FetchLike; fetchBytes: FetchBytesLike; post(msg: TimelineHostResponse, transfer: ArrayBuffer[]): void;
  setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void; now(): number; retryDelaysMs?: readonly number[];
  maxConcurrent?: number; memoCap?: number; previewMaxLots?: number; warn?(msg: string): void; generate?: typeof generate;
  generateForUnits?: typeof generateForUnits; decodeParcels?; decodePolicy?; decodeGross?; load?(urls: ScenarioUrls): Promise<Loaded | LoadFailure> }
export interface TimelineHost { handle(req: TimelineHostRequest): void; dispose(): void }
export function createTimelineHost(deps: TimelineHostDeps): TimelineHost;
```

The slice loop (runner.ts), in priority order per unit: a pending edit's compiles (Task 6); for the ensemble with the lower `month` (plan first on a tie, rules 6 and 16), `compile.step(COMPILE_STEP_MS)` when its next frame is not ready (rule 11; idle until `chunkArrived()` when `progress().done` did not move, Appendix A row 22), else its `next()` unit; `warm` units (D12) when a flush is due. After the loop: post one `compiling` if progress changed; when a compile has just finished, `setStatics` on its ensemble (`scoreStaticsOf`, D2, D3) and, for the plan, post `compiled` and log `missingLots()` once as `compile: N lots changed zoning with no yield record; their yield is 0`; then at most one `filled` (rule 8) from `chunkOf(planSeries, compSeries, moneyFeed (D9), posted + 1, min of both ensembles' finalThrough())`. A flush (D5, D6) is its own task, no more than every `FLUSH_EVERY_MS`, never while a restore is quiet-stepping. `lookups` for month 1 as soon as the plan's frame 1 exists, then per D10. Any throw in a unit: `error` `'timeline'` at the current rev, filling stops (rule 21); lookups keep answering.

- [ ] **Step 1: Write the failing tests** in `host.spec.ts` (fixture-0 through `datasetFetch`, the harness's fake clock, `worlds: 4`, `months: 130` unless stated):
  - `open posts ready, compiled, lookups, then contiguous filled from 0 to lastIndex`: order of first occurrences `['ready', 'compiled', 'lookups', 'filled']` (`lookups` may precede `compiled`: assert `ready` first and `filled` after both); `filled` months contiguous: `expect(froms).toEqual(throughsShiftedByOne)`, first `series.from` 0, last `through === statics.lastIndex`.
  - `the posted series equal stepping the same worlds in a plain loop`: `worlds: 96`, `months: 24`; `viewOf(chunks, statics)` equals `viewOf([chunkOf(plain plan series, plain comparison series, money, 0, lastIndex)], statics)`.
  - `filled carries money and tiers with baseline funding`: fixture-0 has `baselineFunding`; `expect(last.series.money).not.toBeNull()`.
  - `cells revisions are contiguous and a fake controller applies them`: `FakeController` (`world/test/map-stream-run.ts:110`) applies every `cells.render` without throwing; the last has `complete: true`.
  - `at most one filled per slice and no flush inside a unit slice` (harness records the task each post ran in).
  - `resyncMap answers a revision 0 holding every cell`: `expect(render.revision).toBe(0)` and its cell ids equal the controller's.
  - `viewMonth into a frame with different permitting posts lookups; same permitting posts none`: a `timingPolicy` from month 13 (`world/policy/test/fixtures.ts:59`).
  - `parcelSummary answers from world 1 with the frame's lookups` and `parcelSummary clamps the day and the frame month` (day before `asOf`, day past the last stepped month, before any step).
  - `shared lookups answer in timeline mode`: `resolveBrush`, `brushCatalog`, `lotOutlines`, `lotAt`, `previewBuildings` give `ok: true`.
  - `heightLids answers not available` (until Task 9): `{ ok: false, reason: 'no-session' }`.
  - `a throw inside a unit posts error timeline and stops filling` (a `step` spy that throws once): no `filled` after it; `parcelSummary` still answers.
  - Review Focus 3: `a failed needed chunk is reported and retryChunks completes the compile` (manifest without `gross`, a painted policy, the needed chunk failing twice).
  - Review Focus 4: `a second openTimeline silences the first session`.
  - Review Focus 5: `viewMonth clamps out-of-range months` (0, -3, 10,000).
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/sim/world/host.spec.ts` (lock check first). Expected: FAIL.
- [ ] **Step 3: Implement** `runner.ts` and `host.ts`. The host validates with `openTimelineProblem`, `checkManifestShape` and `scenarioUrls` (codes as `scenario-host.ts:520-529`), posts `ready`, loads (`loadDataset`), then `runner.open`. Policy edits that arrive before the load are kept, latest wins. Shared requests: brush service, `lotOutlinesResult`, `previewResult` and `lotAtResult` with `runner.viewFrame()` (`limitsAt(frame, row).protected`, `limitsOf(frame, id)`), `parcelSummary` via `cardAt(card.world, ds.statics, card.frame, cardDepsOf(…), id, card.day, projectId)` with `summary.lookups = lookups ?? undefined`; a record not loaded answers null; a throw warns and answers null.
- [ ] **Step 4: Run** the spec, then the `src/lib/sim/world` folder and `src/lib/sim/scenario` folder (lock check first). Expected: PASS.
- [ ] **Step 5: Commit** `feat: timeline host opens and fills two ensembles`.

### Task 6: Edits

**Files:**
- Modify: `src/lib/sim/world/runner/runner.ts`
- Test: `src/lib/sim/world/host.edit.spec.ts`

**Interfaces:**
- Consumes: `Ensemble.keep`, `Ensemble.restore`, `firstDifference`, `comparisonOf`, `canonicalJson` (`$lib/sim-page/policy`), `MapStream.rewind`, `finalTable`.
- Produces: `Runner.setPolicy` behaviour per rules 12 to 17. No new exports.

Edit state machine: `setPolicy` replaces any pending edit (nothing posted for the superseded rev), stops filling, starts `compileTimeline(policy, lots, ctx, 'plan')` and, unless D4 applies, the comparison's. `LeverFormatError` (thrown by `compileTimeline` or `step`) posts `error` `bad-request` at that rev and filling resumes under the previous timelines (rule 12). For each ensemble, once its new timeline is ready through `min(ensemble.month, months)` or complete: `m = firstDifference(old, new)`; null or `m > ensemble.month` → `keep`; else `restore(new, m)`. Gates close (D2) and reopen when each new compile finishes. When every restoring ensemble has quiet-stepped to `m - 1`: post one `refill` with `from` = the first calendar month `i` with `finalTable(statics)[i] > min(m) - 1`, set the posted mark to `from - 1`, then `MapStream.rewind(world1, statics)` if the plan restored. Rule 16 falls out of the lower-month-first order. Every `filled`, `refill` and `compiling` after acceptance carries the new rev (rule 17).

- [ ] **Step 1: Write the failing tests** (fixture-0, `worlds: 4`, `months: 320` for the month-100 case, else 130):
  - `an edit dated after the fill point posts no refill and later months reflect it`: fill to 60, `setPolicy` with a `paintedPolicy` from month 121 (fixture lots); no `refill`; final view equals a fresh open with that policy.
  - `an edit at month 100 after filling to 300: one refill from the first month not final at 99, no earlier month reposted, money included, equal to a fresh open`: `expect(refills).toEqual([{ type: 'refill', rev: 2, from: expected }])` with `expected = finalTable(statics).findIndex((mm) => mm > 99)`; every `filled.series.from` after it `>= expected`; `viewOf` of `chunksBefore(old, expected)` plus the new chunks equals a fresh open's view, `money` included.
  - `a label-only edit or an added policy that is off: no refill, no change` (`off(...)`, fixtures `:84`).
  - `two setPolicy in a row: only the second is reflected, nothing for the first after the second, and every cells update applies in order on a FakeController`.
  - `a rejected document: bad-request at its rev and the previous timeline's months keep arriving` (a zoning policy under `preFzp` is rejected only for the comparison; use a document `compileTimeline` rejects: a brush query missing from `lots`).
  - `a comparison that does not change keeps its worlds`: edit adds a zoning policy (comparison stays `DEFAULT_POLICY4` on `plan`); the comparison ensemble's world objects are the same objects (`toBe`) after the edit.
  - `an edit at month 1 restores the month-0 copy and refills from 0`.
  - Review Focus 1: `setPolicy during load: only the latest rev is compiled and posted`.
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/sim/world/host.edit.spec.ts` (lock check first). Expected: FAIL.
- [ ] **Step 3: Implement** the edit path in `runner.ts`.
- [ ] **Step 4: Run** it and `host.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: timeline host resumes after an edit`.

### Task 7: Router and worker

**Files:**
- Modify: `src/lib/sim/router.ts`, `src/lib/sim/worker.ts`
- Test: `src/lib/sim/worker-router.spec.ts` (add cases; existing ones unchanged)

**Interfaces:**
- Consumes: `createTimelineHost`, `TimelineHostRequest`.
- Produces: `RouterDeps.createTimeline: () => { handle(r: TimelineHostRequest): void; dispose(): void }`; the router's `handle` accepts `WorkerRequest | TimelineRequest`; mode gains `'timeline'`.

Routing: `openTimeline` sets mode `'timeline'`, disposes the editor, playback and scenario hosts (one dataset in memory, S16's bound), and hands it to the timeline host (created lazily). `initScenario`, `init` and `initPlayback` dispose the timeline host. In timeline mode every shared request (`SharedRequest`) goes to the timeline host. `setPolicy` outside timeline mode answers `error` `bad-request`; `viewMonth` and `resyncMap` outside it are dropped.

- [ ] **Step 1: Write the failing tests**: `openTimeline disposes the editor and scenario hosts`, `shared requests go to the host of the latest init` (after `openTimeline` then `initScenario`, `resolveBrush` reaches the scenario host; and the reverse), `setPolicy outside timeline mode is bad-request`, `viewMonth outside timeline mode posts nothing`.
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/sim/worker-router.spec.ts` (lock check first). Expected: the new cases FAIL.
- [ ] **Step 3: Implement**; `worker.ts` builds `createTimelineHost` with the same deps as the scenario host.
- [ ] **Step 4: Run** the router spec, the `src/lib/sim/scenario` folder (every old host test and the `simulate.golden*` and `simulate.finance.golden*` specs, unchanged), then `npm run check` and `npm run lint` (lock check first). Expected: PASS, 0 errors.
- [ ] **Step 5: Commit** `feat: route openTimeline to the timeline host`.

### Task 8: Timings in test:perf, and the docs

**Files:**
- Create: `src/lib/sim/world/host.perf.spec.ts`, `docs/dev/ensemble-runner.md`
- Modify: `CLAUDE.md` (one scoped-doc line)

**Interfaces:**
- Consumes: `createTimelineHost` with the `load` seam (bench city: `benchInput()` plus `benchRecords()`), `datasetFetch(liveDir)`.

- [ ] **Step 1: Write the perf cases** (print every number; assert bars only here; live cases `describe.skipIf(!liveDir())`):
  - `no slice over 50 ms on the bench city`: real clock; the longest task the host ran (units, compile steps, flushes) over a full fill and one edit; `expect(max).toBeLessThanOrEqual(50)`.
  - `whole-window fill on the live city within 480 x 9 ms`: wall time from first unit to last `filled`, minus compile and load, `<= 4320`.
  - `first cells and first filled within 3 s of openTimeline`: live when present, else bench.
  - `heap under 300 MB after a full fill and after 20 edits that each add a zoning policy`: `gc()` (`--expose-gc` via `poolOptions` or `NODE_OPTIONS`), `heapUsed` delta over the loaded dataset baseline.
- [ ] **Step 2: Take the lock, run** `npx vitest --run --project perf src/lib/sim/world/host.perf.spec.ts` with `SFH_WORLD_LIVE=<live dir>`, **release the lock at once**. Record numbers "quiet (lock held)" with the dataset. A missed bar is reported to `main` with numbers; no bar is changed.
- [ ] **Step 3: Write `docs/dev/ensemble-runner.md`**: the spec's "The worker" section content (messages, slicing, order, finality, copies and restore, edits, the series gate, `MoneyFeed`, lookups and the map, failure), the decisions D1 to D12 in one line each, the timings table from Task 1 and Step 2, known gaps (Open questions still open). Add one line to `CLAUDE.md`'s scoped docs: `- **Ensemble runner (the /sim timeline worker host: openTimeline, setPolicy, filling, copies and refill, lookups)** — [docs/dev/ensemble-runner.md](docs/dev/ensemble-runner.md)`.
- [ ] **Step 4: Run** `npm run test:unit` and `npm run lint` (lock check first). Expected: PASS.
- [ ] **Step 5: Commit** `test: timeline host timings` and `docs: ensemble-runner worker doc`.

### Task 9 (gated): Heights, height lids and the viewport's extra cells

Starts only when `main` gives the sha that carries Open questions 2 and 3 (rule 13: not hand-built here).

**Files:**
- Modify: `src/lib/sim/world/runner/runner.ts`, `src/lib/sim/world/runner/lookups.ts`, `src/lib/sim/world/host.ts`
- Test: `src/lib/sim/world/host.heights.spec.ts`

**Interfaces:**
- Consumes: the carriers as landed (recommended shapes: `cityInputAt(frame): { stories: Uint8Array; countable: Uint8Array; sources: LimitSources }` in `policy/limits.ts`; `MapStream.cellsFor(cellIds: Iterable<string>, world: World, statics: Statics): Set<string>`), `createCityBuild`, `createLidBuild`, `LID_PAD_M`.

- [ ] **Step 1: Write the failing tests**: `heights posts on open for month 1's zoning`; `viewMonth into a frame with different zoning posts heights again, same zoning posts none` (compare `frame.view` identity; views are interned, `compile.ts` rule 17); `heightLids answers for the zoning at the last viewMonth and is superseded by a newer one`; `prefetch wants the extra cells of multi-parcel projects anchored in view`.
- [ ] **Step 2: Run**; expected FAIL.
- [ ] **Step 3: Implement**: city and lid builds as staged units (`StagedBuild.step(sliceLeft, clock)`), lid glue moved from `scenario-host.ts:1072-1156` behaviour into `lookups.ts`, the "not available" answer of Task 5 removed.
- [ ] **Step 4: Run** the spec and the host specs. Expected: PASS.
- [ ] **Step 5: Commit** `feat: timeline host heights and lids by frame`.

---

## Self-review

- Spec coverage: rules 1, 2 (Tasks 3, 7; D1), 3 (Task 5), 4 (Task 1), 5 to 11 (Tasks 4, 5), 12 to 17 (Task 6), 18 to 20 (Task 5; heights in Task 9), 21 (Task 5), 22 (Task 2); S14 messages (Task 2), S16 (Tasks 4, 6, 8); every "Tests that must pass" line maps to a named test in Tasks 5 to 7 except the `heights` half of the `viewMonth` test (Task 9, gated); `test:perf` lines in Task 8; docs in Task 8.
- Types: `Ensemble`, `Runner`, `TimelineHostDeps`, `TimelineHostRequest`/`Response`, `FeedEntry`, `COPY_EVERY` are used with the same names in every task.
- Proportion: signatures and test assertions only; no bodies.

## Open questions

1. **Rule 1: one copy by changing `scenario-host.ts`, or none changed (D1)?** Rule 1 asks the builder to move or export the shared parts so both hosts use one copy, then follow the dataset-change procedure (`docs/dev/pipeline.md:40-53`: build about 8 minutes, upload to R2, verify on staging). The parts are closures (`scenario-host.ts:1462-1694` brushes, `:1491-1510` outlines, `:1521-1563` preview, `:1111-1133` lid lots, `:1390-1405` buildable). This plan writes them once more in `runner/lookups.ts` and `runner/dataset.ts` from exported functions (about 250 lines) and changes no hashed file. **Recommendation: accept D1**; the old host's copy goes when `timeline-ui` switches `/sim`. Alternative, if the partner wants one copy now: Task 3 instead exports those parts from `scenario-host.ts` as parameterised functions (export only, no behaviour change) and the branch follows the dataset procedure.
2. **NO CARRIER: city inputs per frame for `heights` and `heightLids`** (Appendix A rows 31 to 33, 66; `scenario-host.ts:1035-1066, 1068-1156`). `heights` needs effective stories, `countableMask(table, eligible, needs, protectedRows)` and `LimitSources`; a `PolicyFrame` exposes none; `policy/limits.ts:39-46` keeps `sources` and `mask` private. S14 and rule 3 require `heights` on open and on a zoning change. **Recommendation:** a policy-timeline S13 addition `cityInputAt(frame): { stories; countable; sources }`, keyed on the frame object like `limitsAt`. Until then the host posts no `heights` and answers `heightLids` `no-session` (Task 5), and Task 9 waits.
3. **NO CARRIER: the extra cells of multi-parcel projects anchored in view** (row 7; `scenario-host.ts:625-627, 1224`; `geometry.ts:186-193`). `MapStream` rows wait on every one of their cells (`map-stream.ts:170`) and nothing asks for the ones outside the viewport, so such a cell can stay unsent. **Recommendation:** a map-stream S17 addition `cellsFor(cellIds, world, statics)` as `Geometry.cellsFor`.
4. **NO CARRIER: viewport-first packing** (row 40; `scenario-host.ts:1228-1255`). `MapStream.flush` packs oldest first. **Recommendation:** measure first `cells` through the host in Task 8 first; only if it misses 3 s on the live city, an S17 addition `flush(world, statics, budgetMs, first?: ReadonlySet<string>)`.
5. **Controller apply cost (K = 22 live, K = 121 bench) on the real SimMap** (ledger lines 257, 268). **Recommendation: `timeline-ui` owns it**: it needs the page's map in a browser, and map-stream's Task 9 (`bench:map` while a fill streams) already waits on `timeline-ui`. Not in this plan.
6. **A cold massing longer than 50 ms** (`CASE:2007.0946PRX:phase:3`, 634.5 ms, map-stream.md "Numbers"): it is one generator call in a hashed folder and cannot be split. D12 moves it out of the flush, not under 50 ms. **Recommendation:** the partner accepts it as a known exception like policy-timeline's Q7(a), reported by Task 8's slice case; Task 1 says whether other live cold massings pass 50 ms.
7. **Who reconciles the document.** The compiler accepts only a document reconciled against the loaded calibration and `asOf` (`compile.ts:165-166`); `openSimDoc4(text, { asOf, calibration })` does that on the page, but S14 sends the page neither the calibration nor (before `compiled`) `asOf`. **Recommendation:** `timeline-ui` reads `calibration.json` and `projects.json`'s `asOf` from the manifest URLs before `openTimeline`; the worker keeps rejecting an unreconciled document with `bad-request`. Tests here build documents with `reconcilePolicy4(doc, input.calibration, input.asOf)`.

**Hashed files changed: none** (D1). If Open question 1 is ruled the other way, exactly one: `src/lib/sim/scenario/scenario-host.ts`.

## Spec and code contradictions found

- Rule 3 creates each world's `WorldSeries` at month 1's frame; S15's `createWorldSeries` needs `ScoreStatics`, which needs the fully compiled timeline. Resolved by D2 (buffered feed).
- Rule 9 drains "until it returns null"; map-stream (as built) says never until null. Followed map-stream (D5).
- Docs: the spec puts "The worker" in `docs/dev/sim-timeline.md`; standing rule 14 puts it in our own file. Followed the standing rule.

## Appendix A: what the old host supplies (inventory)

Also at `.superpowers/sdd/2026-11-13-ensemble-runner/host-inventory.md`.

| #   | Item                                                                                                                                              | scenario-host.ts                       | Feeds                       | Carrier in the timeline host                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Generator memo (LRU `MEMO_CAP`), cleared on a new dataset version; once-only log keys                                                             | 253, 474-483, 530-534                  | massing, card, preview      | `runner/dataset.ts` owns it; reaches `MapStreamDeps.massing.memo`, `CardDeps.building` and `.buildable`, `previewResult`                                                                           |
| 2   | Request checks: `validateInitRequest`, `checkManifestShape`, `scenarioUrls` (codes `bad-request`, `manifest-invalid`, `scenario-missing`)         | 518-529                                | open                        | `openTimelineProblem` (`timeline-protocol.ts`) plus the exported `checkManifestShape` (`../manifest-shape`) and `scenarioUrls` (`./load`)                                                          |
| 3   | `ready` post                                                                                                                                      | 576-581                                | page                        | host, same shape                                                                                                                                                                                   |
| 4   | Chunk loader (`createChunkLoader`, 4 concurrent, retry delays), `byCell`, `records`, `wanted`, `view`, `failed`; `chunks` post                    | 555-574, 588-596                       | map, card, yields           | `ChunkSet` in `runner/dataset.ts`; reaches `MapStreamDeps.massing.records` and `.cellReady`, `CardDeps.record`, `YieldSource`                                                                       |
| 5   | Failed cells re-post `resolving` for a pending revision                                                                                           | 602-613                                | compile progress            | `YieldSource.failedCells()` (S13) → `TimelineCompile.progress().failedCells` → `compiling`                                                                                                         |
| 6   | `prefetch`: viewport cells into `wanted` and `view`                                                                                               | 616-624                                | chunks                      | host `prefetch`, same                                                                                                                                                                              |
| 7   | `prefetch` and the shown run's geometry want the extra cells of multi-parcel projects anchored in view (`Geometry.cellsFor`)                      | 625-627, 1224; `geometry.ts:186-193`   | map                         | **NO CARRIER**: `MapStream` (S17, `map-stream.ts:74-79`) has no `cellsFor`; its rows wait on every cell (`map-stream.ts:170`)                                                                      |
| 8   | `loadScenario(…, { policy: true })`: `fzp`, `twin`, `projects`, `policy`, `gross`                                                                 | 630-664                                | everything                  | `runner/dataset.ts` calls the exported `loadScenario` (`load.ts:262`)                                                                                                                              |
| 9   | Horizon after `projects.asOf` check                                                                                                               | 649-656                                | open                        | n/a: no horizon; `months` checked by `openTimelineProblem`                                                                                                                                         |
| 10  | `tierContext(loaded.fzp)` per input                                                                                                               | 672, 996                               | tiers                       | `scoreStaticsOf` builds the tier table (`score/statics.ts:177-214`)                                                                                                                                |
| 11  | `monthsOf(asOf, horizon)`                                                                                                                         | 674                                    | score                       | `ScoreStatics.months` (`scoreStaticsOf`)                                                                                                                                                           |
| 12  | `phasingOf(projects, asOf)`                                                                                                                       | 675                                    | score                       | `ScoreStatics.phasing`                                                                                                                                                                             |
| 13  | Band state, `BAND_RUNS`, `bandSeed`, ranks                                                                                                        | 676, 1158-1180                         | band                        | replaced: two ensembles of seeds 1..`worlds`; `chunkOf` mean and sd                                                                                                                                |
| 14  | `MassingCtx { input: loaded.fzp, memo, gen, genForUnits, logOnce }`                                                                               | 681-687                                | map                         | `MapStreamDeps.massing` (`map-stream.ts:61-72`), `input` = `loaded.fzp`                                                                                                                            |
| 15  | Massing input swapped to the lever-applied plan per revision                                                                                      | 1002                                   | map heights                 | carrier exists (`MapStreamDeps.massing.input`, fixed); behaviour differs as map-stream recorded (ledger line 269, to the partner)                                                                  |
| 16  | Finance warm (`financeWarm`, `WARM_CHUNK`), a slice each                                                                                          | 190-194, 696, 719-734, 995             | old engine precompute       | n/a (old engine only). The new engine's month-1 burst is measured in Task 1                                                                                                                       |
| 17  | `LayerCtx { parcels: fzp.parcels, policy }`                                                                                                       | 702                                    | compile, brushes            | `CompileCtx.layers` (S13)                                                                                                                                                                          |
| 18  | `GrossCache`, one per session, kept across revisions                                                                                              | 316, 703                               | yields                      | `yieldSourceOf(…, gross)` in `runner/dataset.ts` → `CompileCtx.yields`                                                                                                                             |
| 19  | Gross table → `createTableRecompute(parcels, needs, table, { now })`                                                                              | 704, 935-936                           | yields                      | `CompileCtx.yields` (table branch)                                                                                                                                                                 |
| 20  | Chunk recompute → `createYieldRecompute(parcels, needs, { record, cellLoaded, now }, gross)`                                                      | 937-946                                | yields                      | `CompileCtx.yields` (chunk branch)                                                                                                                                                                 |
| 21  | `loader.want(recompute.cellsNeeded())`                                                                                                            | 947, 955                               | yields                      | `yieldSourceOf` wants the `cellsNeeded()` of each `YieldRecompute` it returns                                                                                                                      |
| 22  | `stalled`: idle until a needed chunk arrives                                                                                                      | 309, 594, 867, 962                     | scheduler                   | runner: a compile `step` whose `progress().done` did not move idles until the host reports a chunk                                                                                                 |
| 23  | `levers resolving` post (`done`, `total`, `failedCells`)                                                                                          | 1013-1023                              | page                        | `compiling` from `TimelineCompile.progress()`                                                                                                                                                      |
| 24  | Missing-record log, one line per lot id                                                                                                           | 966-970                                | log                         | `TimelineCompile.missingLots()`: a count (ruled, ledger line 225); one `warn` per compile                                                                                                          |
| 25  | `fillNeeds` + `applyLevers`; `LeverFormatError` → `bad-request` `'levers …'`, previous revision stays                                             | 971-980                                | edits                       | `compileTimeline` / `step` throw `LeverFormatError` (`compile.ts:56-58`) → `error` `bad-request` at that `rev`                                                                                     |
| 26  | `protectedMask` from `filled.protectedRows`                                                                                                       | 323, 983-985                           | preview, card               | `limitsAt(frame, row).protected` (S13); `cardAt` reads `limitsOf`                                                                                                                                  |
| 27  | `levers current`: `lookups`, `capacity`, `unknownLots`                                                                                            | 986-993                                | page                        | `compiled` (`capacity()`, `unknownLots()`) and `lookups` (`lookupsAt(frame)`)                                                                                                                      |
| 28  | `references` from `applyLevers`                                                                                                                   | 997, 1301                              | score                       | `ScoreStatics.references` (`scoreStaticsOf`, by base)                                                                                                                                              |
| 29  | `awaitLevers`, `holding`, `heldPrefetch`                                                                                                          | 417-422, 551-553, 617-620, 1004-1010   | /sim boot                   | n/a: `openTimeline` always carries a policy                                                                                                                                                        |
| 30  | `reroll`, seeds, representative seed, swap                                                                                                        | 760-777, 1183                          | shown run                   | n/a: world k has seed k; world 1 is "this city"                                                                                                                                                    |
| 31  | `cityOf`: effective stories (`plan.table.stories`), `countableMask(table, eligible, needs, protectedRows)`, `limitSources(ctx, levers, protected)` | 1035-1055                              | heights                     | **NO CARRIER**: a `PolicyFrame` exposes none of the three; `policy/limits.ts:39-46` keeps `sources` and `mask` private; `countable` needs the resolution's needs and table                         |
| 32  | `cityStep` → `heights` post and session `limits`                                                                                                  | 1058-1066                              | map                         | **NO CARRIER** (needs 31). S14 asks for `heights` on open and on a zoning change at `viewMonth`                                                                                                   |
| 33  | Lid builds: `lidStep`, `lidLots`, `createLidBuild({ sourceIds, stories, sources, model })`, superseded and no-session answers                     | 1068-1156                              | `heightLids`                | **NO CARRIER** (needs 31's limits and the city `model`)                                                                                                                                            |
| 34  | `simulateDetailed` + `shownSeries`                                                                                                                | 1182-1206                              | score                       | `createWorld` / `step` (S2) + `WorldSeries` (S15), world 1 shown                                                                                                                                  |
| 35  | `tierBaselineOf(projects.rhnaCompletedNet)`                                                                                                       | 1187-1190                              | tiers                       | `scoreStaticsOf(…, rhna)` with `rhna = loaded.projects.rhnaCompletedNet`                                                                                                                           |
| 36  | `moneyOf({ ledger, schedules, finance, baseline: twin.finance.pools })` when `finance.pools.length > 0`                                           | 1191-1203                              | money                       | `MoneyFeed { ledger, finance, world, statics }` (S15); null when `frameAt(1).finance` is null or has no pools; baseline pools via `scoreStaticsOf` (`input.finance.pools`)                         |
| 37  | Shown twin (`simulateNet`), `planEffectOf`                                                                                                        | 1267-1271                              | plan effect                 | comparison ensemble + `chunkOf` `planEffect`                                                                                                                                                       |
| 38  | `assembleScore` with `baseline: rhnaCompletedNet`, `phasing`, `references`, `tiers`, `money`                                                      | 1284-1320                              | score                       | `ScoreStatics.baseline` (`rhna`), `.phasing`, `.references`; `SeriesChunk.tiers`, `.money`                                                                                                         |
| 39  | `createGeometry({ input, schedules, records, recordOf, massingCtx, warnOnce })`                                                                   | 1213-1226                              | map                         | `createMapStream(MapStreamDeps, months)` (S17)                                                                                                                                                     |
| 40  | Viewport-first packing (`packable(view)`), revision 0 held up to `REVISION0_CAP_MS` (2.5 s)                                                       | 248, 1228-1255                         | first paint                 | **NO CARRIER**: `MapStream.flush` packs dirty cells oldest first (`map-stream.ts:2`) and takes no viewport                                                                                        |
| 41  | `packTimedTransferables` on posted cells                                                                                                          | 906, 1262                              | posting                     | host posts `cells` with `packTimedTransferables` of `render.cells`                                                                                                                                 |
| 42  | `geometry.complete()` → `render.complete`                                                                                                         | 1305                                   | map                         | `TimelineUpdate.complete` from `MapStream` (map-stream.md "Draining")                                                                                                                              |
| 43  | Card context: `asOf`, `input`, `rows`, `masters`, `qualityRules`, `building` (`allReady ? massingFor : NOT_DRAWN`), `logOnce('card:')`            | 255-256, 1330-1344                     | card                        | `cardAt` builds `asOf`, `input`, `rows`, `masters` (`score/card.ts:140-148`); host builds `CardDeps.qualityRules` (`loaded.projects.qualityRules`), `.building`, `.logOnce`                        |
| 44  | `parcelSummary` null when the record is not loaded                                                                                                | 1352-1357                              | card                        | `CardDeps.record`; host returns a null summary before calling `cardAt` (it throws on null, `card.ts:107`)                                                                                         |
| 45  | Envelope from the lever-applied parcels                                                                                                           | 1358-1361                              | card                        | `cardAt` reads `frame.view.parcels`                                                                                                                                                                |
| 46  | Buildable stories: `simKey` memo, `gen(scenarioRecordOf(plan, i, rec), { maxStories }, fnv1a32(id), 'max')`, else `lotBuildableStories`           | 1390-1405                              | card                        | `CardDeps.buildable` = `buildableStories` in `runner/lookups.ts`, on `frame.view.parcels`                                                                                                          |
| 47  | Limit owner (`limitSources` / `ownerOf` / `limitOwnerAt`)                                                                                         | 1381, 1426-1429, 1455-1456             | card, `lotAt`               | `limitsOf(frame, parcelId)` (S13; `PolicyLimitOwner` is assignable to `LimitOwner`, `levers/source.ts:62`)                                                                                         |
| 48  | Project chosen: `schedulesOn`, `chooseProject`, `projectCard`, `revisionAt`                                                                       | 1411-1423                              | card                        | `cardAt` on world 1 with `timeline.frameAt(max(1, monthOfDay(asOf, day)))`                                                                                                                         |
| 49  | `parcelSummary` throw → warn, null summary                                                                                                        | 1704-1712                              | card                        | host, same                                                                                                                                                                                         |
| 50  | `lotAt`: records within `LID_PAD_M`, `lotAtPoint`, owner                                                                                          | 1438-1458                              | page                        | `lotAtResult` in `runner/lookups.ts`, owner from `limitsOf(frame at the last viewMonth)`                                                                                                           |
| 51  | Brushes: waiters, `LotIndex` on the base parcels, `brushCatalog`, `resolveBrushRows`, points                                                      | 386-392, 1462-1486, 1565-1635          | page                        | `createBrushService` in `runner/lookups.ts`, `BrushData.parcels = loaded.fzp.parcels`, `policy = loaded.policy`                                                                                   |
| 52  | Brush files: `datasetUrl`, `fetchWithRetry`, `decodeTransit`, `parseNeighborhoods`; 4xx permanent, transient not cached                           | 372-378, 1637-1694                     | brushes                     | `createBrushService`                                                                                                                                                                               |
| 53  | `lotOutlines` via `packOutlines` over loaded records                                                                                              | 1491-1510                              | page                        | `lotOutlinesResult` in `runner/lookups.ts`                                                                                                                                                         |
| 54  | `previewBuildings`: first `previewMaxLots`, protected skipped, `missing`, `simKey` memo, `packCell('preview', …)`                                 | 180-181, 1521-1563                     | page                        | `previewResult` in `runner/lookups.ts` with `parcels = frame.view.parcels`, `protectedRow = limitsAt(frame, row).protected`                                                                       |
| 55  | `retryChunks` → `loader.retryFailed()`                                                                                                            | 1729-1731                              | chunks                      | host, same                                                                                                                                                                                         |
| 56  | `end()`: cancel token, dispose loader, answer waiters `no-session`                                                                                | 495-511                                | lifecycle                   | host `dispose` and a new `openTimeline`                                                                                                                                                            |
| 57  | Scheduler: `SLICE_PLAN_MS` 45, estimate = largest of the last 4 costs per kind, `setTimeout(0)`, own-slice jobs                                   | 235-246, 800-853                       | slicing                     | runner slice loop; imports `SLICE_PLAN_MS`; own estimator per unit kind                                                                                                                            |
| 58  | Slice throw → `end()` + `error internal`                                                                                                          | 801-816                                | failure                     | rule 21: `error` code `'timeline'` at the current `rev`, filling stops, lookups still answered                                                                                                     |
| 59  | `handle`: `latestRev`, catch → `internal`                                                                                                         | 1739-1747                              | failure                     | host, same                                                                                                                                                                                         |
| 60  | `warn` default with `[sim]` prefix                                                                                                                | 470                                    | log                         | host, same                                                                                                                                                                                         |
| 61  | Decode seams (`decodeParcels`, `decodePolicy`, `decodeGross`)                                                                                     | 183-189                                | tests                       | `TimelineHostDeps`, same seams, plus a `load` seam for the bench city                                                                                                                              |
| 62  | `asOf`, `calibration`, `market`, `finance`, `projects`, `districtMaxStories` (in `loaded.fzp`)                                                   | 649, 669, 1185                         | engine                      | `CompileCtx.input` (reconcile check `compile.ts:165-166`, market `:177`, money track `:176`); `staticsOf(input)`; `scoreStaticsOf(input, …)`                                                       |
| 63  | Debt terms (old: inside `moneyOf` from `finance.pools`)                                                                                           | 1194-1202                              | money `owed`                | `ScoreStatics.debts` (`scoreStaticsOf`, from the timeline)                                                                                                                                         |
| 64  | New-project scale (old: `input.newProjects.scale` from `applyLevers`)                                                                             | 994, 1336                              | card                        | `newScale(frame)` inside `cardAt` (`score/card.ts:50`)                                                                                                                                             |
| 65  | Transit network                                                                                                                                   | 374, 1688                              | brushes only                | `createBrushService`                                                                                                                                                                               |
| 66  | `heights` re-posted when the zoning at the last `viewMonth` changes (new in S14)                                                                  | n/a                                    | map                         | **NO CARRIER** (needs 31)                                                                                                                                                                          |
| 67  | Lever-applied `twin` input (`applyPolicies([baseZoning], fzp)`)                                                                                   | 41 of `load.ts`; 994                   | comparison                  | n/a: `compileTimeline(…, 'preFzp')` builds it (`zoning-view.ts` imports `twinInput`)                                                                                                               |

## NO CARRIER, for the plan's open questions

- Rows 31, 32, 33, 66: the city build's inputs per frame (effective stories, countable mask, `LimitSources`), so `heights` and `heightLids` cannot be answered for a frame. `scenario-host.ts:1035-1066, 1068-1156`; `policy/limits.ts:39-46`.
- Row 7: the extra cells of multi-parcel projects in view. `scenario-host.ts:625-627, 1224`; `scenario/geometry.ts:186-193`; `map-stream.ts:74-79, 170`.
- Row 40: viewport-first packing. `scenario-host.ts:1228-1255`; `map-stream.ts:2`.

The seven earlier gaps (yields for the compiler, missing-lot count, completed-homes baseline, limit attribution, buildable stories, debt terms, `newScale`) all have carriers now: rows 18 to 21, 24, 35, 47, 46, 63, 64.
