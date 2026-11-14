# The ensemble runner: the /sim timeline worker host

`createTimelineHost` (`src/lib/sim/world/host.ts`) runs the step engine for `/sim`: 48 worlds under the policy and 48 under its comparison, advanced one month at a time ahead of the viewer, posting what is final, and resuming from an edit's month. Spec `docs/superpowers/specs/2026-11-13-ensemble-runner-design.md`; plan `docs/superpowers/plans/2026-11-13-ensemble-runner.md`.

| File                                   | Holds                                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/lib/sim/timeline-protocol.ts`     | S14 messages, `openTimelineProblem`, `setPolicyProblem`, `TimelineErrorCode` (today's codes plus `'timeline'`) |
| `src/lib/sim/timeline-client.ts`       | `TimelineClient`, `WORLDS = 48`, `WINDOW_MONTHS = 480`                                                         |
| `src/lib/sim/lookup-requests.ts`       | The lookup promises `ScenarioClient` and `TimelineClient` share                                                |
| `src/lib/sim/world/host.ts`            | Sessions, checks, the shared requests                                                                          |
| `src/lib/sim/world/runner/runner.ts`   | Compiles, ensembles, slices, posts, edits, heights                                                             |
| `src/lib/sim/world/runner/ensemble.ts` | One ensemble: units, feed logs, copies (`COPY_MONTHS`)                                                         |
| `src/lib/sim/world/runner/dataset.ts`  | Chunk set, load, `MassingCtx`, `CompileCtx` and its `YieldSource`                                              |
| `src/lib/sim/world/runner/lookups.ts`  | Brushes, outlines, preview, `lotAt`, lid lots, card deps                                                       |
| `src/lib/sim/world/runner/warm.ts`     | Warm-ahead queue: one (row, revision) massing per unit (D12)                                                   |
| `src/lib/sim/router.ts`                | Routes `openTimeline`, `setPolicy`, `viewMonth`, `resyncMap` to the timeline host                              |

## The worker

### Messages

To the worker: `openTimeline { rev, manifest, policy, lots, worlds, months }`, `setPolicy { rev, policy, lots }`, `viewMonth { month }`, `resyncMap`. From it: `compiling`, `compiled { capacity, unknownLots, statics }`, `filled { through, series }`, `refill { from }`, `cells { render }`, `lookups { month, lookups }`, plus today's `ready`, `chunks`, `heights`, `error`. Every other message of the scenario protocol keeps its shape and is answered for the plan frame at the last `viewMonth` (month 1 before any). `parcelSummary` reads world 1 of the plan on the requested day (clamped to the last day stepped) and adds `lookups`.

`lots` holds the lots of every brush query the document needs (`queriesOf4`), resolved by the page with `resolveBrush`. The page reconciles the document (`openSimDoc4` with the dataset's calibration and `asOf`); an unreconciled one is `bad-request`.

The router treats `openTimeline` as `initScenario`: it disposes the editor host's state, and shared requests go to the host of the latest init. A new `openTimeline` or `dispose` ends the session: timers cancelled, nothing more posted, waiting requests answered `no-session`.

### Slicing

A unit is one world one month (`step`), or one of `create`, `restore`, `copy`, `feed`, `quiet`, a compile `step(20)`, a `warm` massing of one (row, revision), a `cityInput` or a `heights` build step. A slice runs units until `SLICE_PLAN_MS` (45 ms); a unit of a kind runs only when the time used plus the largest of that kind's last 4 costs fits; the first unit always runs (D7). Then `setTimeout`.

A flush (`MapStream.flush(world1, statics, 20)`) is a task of its own, at most every 250 ms (D6). Warm units mass world 1's started and revised rows, one (row, revision) per unit, just before it, in slices of their own (D12). When filling ends the stream is drained until an update says `complete` (D5).

### Order

Heights first: the city build of the zoning at the last `viewMonth`, then a wanted lid view. Then, for the ensemble with the lower month (the plan on a tie), a compile step when its next frame is not ready (rule 11), else its next unit; a world steps only while its ensemble is not ahead of the other (rules 6, 16). While a compile is unfinished it also gets one step in every slice with room; one that does not fit is owed and is the first unit of the next slice, never of two in a row.

A compile is stalled (it waits for `chunkArrived`) only when `step` returned false within its budget with neither `readyThrough()` nor `progress().done` moved. This supersedes plan Appendix A row 22 ("done did not move"): the view job's twin, resolve, apply and precompute units move neither count and can each spend the whole budget.

### Finality and posting

A calendar month is final when every world of both ensembles has stepped the model month holding its last day. After a slice: `compiling` if the progress changed; `compiled` when the plan's compile finished; at most one `filled` for the months final in both ensembles and not yet posted (`chunkOf`); `lookups` if the permitting in view changed; a city build if the zoning or limit attribution in view changed.

### The series gate (D2, D3)

`createWorldSeries` needs `ScoreStatics`, which `scoreStaticsOf` gives only for a fully compiled timeline. Each world keeps a feed log (events and `stepped` marks); `feed` units drain it into the series once its ensemble's statics exist. Each ensemble uses its own statics (the comparison's tier table matches its frames). An edit closes the gate (`setStatics(null)`), and the new statics reopen it, re-creating every series from its `data()`.

### `MoneyFeed` (D9)

Null when the plan's `frameAt(1).finance` is null or has no pools. Otherwise world 1's ledger, world 1, the statics and `frameAt(month holding the last day of through).finance` from the timeline in use.

### Copies and restore

`COPY_MONTHS = [0]` (`runner/ensemble.ts`) is the one place the schedule lives. After each listed month every world of both ensembles is `structuredClone`d with its series `data()`, its unfed log and the ledger length, one world per unit. A restore takes the last complete copy at or before m - 1, drops later ones, cuts the ledger, rebuilds each due list with `planDue` and re-steps quietly to m - 1. With m = 1, or no copy, the worlds are created again, quietly.

Why `[0]`: copies every 60 months add 2,322.7 MB funded on the live city against 546.2 MB for month 0 alone (+427.7 with none), and denser copies save only the quiet replay (about 1 s of a resume; `planDue` dominates). A second entry (240) works with no other change.

### Edits

`setPolicy` checks at once that every query of the document and of its comparison is in `lots` (else `bad-request`); then it compiles the plan and, unless `comparisonOf` gives the same document and base (D4), the comparison. It replaces any edit not yet accepted: nothing more is posted for that rev. A rejected document posts `bad-request` at its rev and filling resumes under the timelines in use; it also drops an earlier pending edit (rule 12 "replaces").

While an edit compiles nothing steps; map flushes and height units go on. It is accepted once each new timeline is ready through its ensemble's last month stepped: `m = firstDifference(old, new)` keeps the ensemble (null or past it) or restores it. The rev becomes the edit's. The plan's quiet re-step ends its slice; the next task rewinds the map stream (and answers a `resyncMap` that came meanwhile). One `refill` goes out from the first calendar month not final at min(m) - 1; no `filled` goes out between acceptance and it. After a throw, the next accepted edit re-creates every world.

An edit from a document with nothing in force changes the comparison from the pre-plan base to the default on the plan, so the comparison is re-created and `refill` is from 0.

### Lookups, heights and the map

`lookups` carries `lookupsAt(frame)` as a new object when the frame at the last `viewMonth` has a different `calibration`, `newCalibration`, `speed` or `speedNew` than last posted, and once after every accepted edit (D10).

`heights` and `heightLids` follow the zoning in force at the last `viewMonth`: a `cityInput` unit reads `cityInputAt` on the plan frame in view, then the city build runs in slices and posts `heights`; the same view with equal inputs posts nothing. A wanted lid view builds on the latest city. A throw in either is rule 21's.

`resyncMap` posts `MapStream.snapshot(world1)` (revision 0), unbudgeted; during a quiet re-step it waits for the rewind. `MapStream.cellsFor` runs after each non-null flush and on a viewport change; its cells go to the chunk loader.

### Failure

A throw in a unit posts `error` `'timeline'` at the current rev and stops filling until the next `setPolicy` or `openTimeline`; the lookups keep answering. A compile throw other than `LeverFormatError` is the same (D11). A rejected load is `internal`. Chunk failures go out as `compiling.failedCells` and `chunks`; `retryChunks` works as today.

## The client

`TimelineClient` drops `compiling`, `compiled`, `filled` and `refill` older than its floor and never drops `cells`, `lookups` or `heights`. The floor is the rev of the last `open` / `setPolicy` sent, except that `error` `bad-request` at the floor's rev lowers it to the last rev seen accepted (the last `compiled`, or the open's rev before any): the worker keeps filling at that rev. A `bad-request` for an older rev changes nothing. A `refill` before its rev's `compiled` is kept. This amends rule 22's "older than the last `setPolicy` it sent". `restart(worker)` re-opens with the last policy.

## Decisions

- **D1** No hashed file changed: `runner/dataset.ts` and `runner/lookups.ts` compose exported functions; the old host's copy goes when `timeline-ui` switches `/sim`.
- **D2** Series wait for their `ScoreStatics` (buffered feed logs).
- **D3** Each ensemble's series use its own `ScoreStatics`; `compiled` carries the plan's.
- **D4** A comparison `comparisonOf` gives unchanged is not recompiled; its worlds stay.
- **D5** Drain until `complete: true`, never "until null".
- **D6** A flush is a task of its own.
- **D7** Unit estimates: largest of the kind's last 4; the first unit of a slice always runs.
- **D8** Copies: worlds by `structuredClone`, series `data()`, unfed logs, ledger length; one world per unit.
- **D9** `MoneyFeed` null without pools, else world 1's ledger and the frame of `through`.
- **D10** `lookups` on a change of permitting objects at the last `viewMonth`, and after every edit.
- **D11** A compile throw other than `LeverFormatError` is `'timeline'`, as rule 21.
- **D12** Warm world 1's massings before each flush, one (row, revision) per unit (`runner/warm.ts`); a cold massing over 50 ms is reported, not split.

## What the old host supplied

Lines of `src/lib/sim/scenario/scenario-host.ts` each new file mirrors, so `timeline-ui` can retire it (full inventory: plan Appendix A).

| New file             | Mirrors                                                                                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host.ts`            | 474-483, 530-534 (memo and log keys per dataset version); 518-583 (checks, `ready`); 630-664 (load); 1144-1156 (a `heightLids` before the load waits); 1704-1712 (`parcelSummary` throw); 1739-1747 (`handle`)          |
| `runner/runner.ts`   | 235-246, 800-853 (scheduler, estimates); 325-335, 416 (limits state); 861-866 (heights before a pending revision); 960-962 (stall); 966-970 (missing lots); 1025-1156 (city and lid builds)                             |
| `runner/dataset.ts`  | 555-574, 588-591, 602-603, 616-627 (chunk loader, prefetch); 630-664 (load); 681-687 (`MassingCtx`); 702-704, 935-947, 955 (layers, yields)                                                                             |
| `runner/lookups.ts`  | 372-392, 501-505, 1462-1485, 1565-1694 (brushes); 1501-1509 (outlines); 1533-1562 (preview); 1445-1457 (`lotAt`); 1111-1133, 432-466 (lid lots, transfers); 1391-1405 (buildable); 255-256, 1330-1342, 1356 (card deps) |
| `timeline-client.ts` | `scenario-client.ts` crash handling and lookups (left unchanged)                                                                                                                                                        |

## Timings

Live 2026-11-10-6ee5a23d (155,020 parcels, gross table, baseline money 8 pools), 48 + 48 worlds, 480 months, Apple M5 Pro, Node 24.2. All quiet (lock held). "Task 1" rows are the prototype bundled (minified, no keepNames) after the planning memo (`measure-1.md` §§11, 12); "host" rows go through `createTimelineHost`, under Vitest (`host.perf.spec.ts`) and bundled (`ensemble-measure.ts --case host`).

| Figure                                                        | Bar           | Task 1 (bundled)  | Host, Vitest                                            | Host, bundled                                      |
| ------------------------------------------------------------- | ------------- | ----------------- | ------------------------------------------------------- | -------------------------------------------------- |
| Create 96 funded worlds                                       | 1,500 ms      | 669 ms            |                                                         |                                                    |
| `planDue` per world, median / max                             | 50 ms         | 5.5 / 32.8 ms     | max 38.5 ms                                             |                                                    |
| Fill per month, median, no copies                             | 9 ms          | 1.97 ms           | 8.4 ms whole-window mean (5.6 in slices)                |                                                    |
| Whole-window fill, first unit to last `filled`, less compiles | 4,320 ms      |                   | 4,011.7 ms (slices 2,679.9, warm 1,148.3, flushes 32.3) | 3,798.6 to 3,841.9 ms (from the first `compiling`) |
| First `cells` / first `filled`                                | 3,000 ms      | 1,287 / 1,600 ms  | 1,003.8 / 2,471.1 ms                                    | 963.1 to 964.0 / 2,123.5 to 2,128.8 ms             |
| Warm tasks before the first `cells`                           |               |                   | 2 tasks, 82.7 ms                                        |                                                    |
| Edit (metro rule from month 120) settled                      |               |                   | 3,914.8 ms                                              | 2,973.2 to 2,997.2 ms                              |
| Change month per world unit, zoning, max                      | 50 ms         | 34.9 ms           |                                                         |                                                    |
| `precomputeOf` (compile seam)                                 | accepted      | 46.4 ms           | 54.9 to 66.8 ms                                         |                                                    |
| Longest compile step                                          | accepted      | 52.6 ms           | 77.6 ms                                                 | (tasks posting `compiling`: 67.2 to 86.7 ms)       |
| Cold massing `CASE:2007.0946PRX:phase:3`                      | accepted      | 636.1 ms          | 614.6 ms (task 642.3)                                   | task 651.0 to 655.2 ms                             |
| `resyncMap` snapshot, warm (after the fill / after the edit)  | none          | 6.4 to 6.6 ms     | 9.1 / 11.1 ms                                           |                                                    |
| `resyncMap` snapshot, cold (fresh stream and memo)            | none          | 1,166 to 1,182 ms |                                                         |                                                    |
| `cityInputAt`, first per attribution                          |               |                   | 6.0, 9.0 ms                                             |                                                    |
| `scoreStaticsOf`, max / 96 series re-created from `data()`    |               | 2.9 / 4.0 ms      | 3.2 ms / `setStatics` 0.9 ms                            |                                                    |
| `chunkOf`, max                                                |               |                   | 2.5 ms                                                  |                                                    |
| Heap, funded, no copies (heapUsed + buffers)                  | S16: none set | +427.7 MB         | +394.0 MB                                               |                                                    |
| Heap, `COPY_MONTHS` [0]                                       | S16: none set | +546.2 MB         | +526.1 MB                                               |                                                    |
| Heap, every 60 months                                         |               | +2,322.7 MB       |                                                         |                                                    |
| Heap after an edit and editing back (leak check)              | 52.6 MB       |                   | +6.3 MB over the fill                                   |                                                    |
| Heap after 20 edits each adding a zoning policy               |               |                   | +880.1 MB (+868.3 for that document opened afresh)      |                                                    |

The host's heap baseline is the dataset, every chunk and the compiles with 1 + 1 worlds; Task 1's is after load and compiles. Task 1's are the trustworthy absolute figures; the host's confirm them and add the edits. Each added zoning state costs about 16 MB (its zoning view); the 20 edits held 11.8 MB more than a fresh open of the same document.

Tasks over 50 ms on the live city, host under Vitest (bundled the same, 100 to 103 ms for the first), measured before the post-Task-8 fix: a warm task of 99.2 ms (one warm unit then massed every revision of a row: `CASE:2014.1370PRX:phase:1`, 42.6 + 40.3 ms; fixed since: one unit per revision); a warm task of 62.1 ms and slices of 51.6, 52.9 and 57.9 ms with `create` units (`planDue` up to 38.5 ms): a unit costlier than its kind's estimate. On the bench city (no money) only compile seams pass 50 ms (51.1, 51.2 ms).

## Known limits

- **Heap**: S16's 300 MB is not met (427.7 MB live set, 546.2 MB with the month-0 copy); the partner re-sets it. `HEAP_BOUND_MB` in `host.perf.spec.ts` is null until then and the heap case asserts only the leak margin.
- **Rich money**: on the live city with world-funding's bench money set, `planDue` is 77.6 / 111.4 ms per world (median / max), the change month 154 to 188 ms per world unit, 96 creates 4.3 s: over the 50 ms unit bar. A bound inside the step (`StepCtx`) is world-core's, deferred.
- **Cold massing**: `CASE:2007.0946PRX:phase:3` is one generator call of about 636 ms, accepted; warm-ahead moves it out of the flush.
- **Estimates**: a unit costlier than its kind's last 4 can push a slice a few ms past 50 (`create`, `warm`).
- **`resyncMap`**: the snapshot is unbudgeted (rule 20): about 10 ms warm, 1.2 s with a cold memo.
- **Load**: `loadScenario` precomputes the input outside any slice (`precomputeOf` 61 to 67 ms, as the old host's load).
- **Edits**: a rejected `setPolicy` drops an earlier pending valid edit.
- **Heights rev**: `heights` carries the rev in use when posted; `city.rev` and lid `limitsRev` are the build's, and can differ after an edit accepted mid-build. Nothing compares them.
- **`cityInputAt`**: runs on every frame-id change at the last `viewMonth`, not only on zoning changes; its first call per attribution resolves every lot's envelope (6 to 9 ms live).

## Tests and measurement

Signoff: `host.spec.ts`, `host.edit.spec.ts`, `host.heights.spec.ts`, `runner/*.spec.ts`, `timeline-client.spec.ts`, `timeline-protocol.spec.ts`, `worker-router.spec.ts` (fixture-0, fake clock; behaviour and order only).

`npm run test:perf` runs `host.perf.spec.ts`: on the bench city no task over 50 ms except a compile seam or the accepted massing; live (`SFH_WORLD_LIVE=<dataset dir>`, else the newest under `pipeline/out/`, else the bench city) first `cells` and `filled` within 3 s and the whole-window fill within 4,320 ms; the heap reported, and the leak margin asserted. Every task's contents are printed for the longest and those over 50 ms.

Bundled: `node scripts/bundle-measure.mjs`, then `node --expose-gc scratch/ensemble-measure.bundle.mjs --dir <live> --case host` (or the Task 1 cases, `measure-1.md`).
