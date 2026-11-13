# ensemble-runner: many worlds, filled ahead of the viewer

Part of the step-engine package. Design: [2026-11-12-2305-sim-step-engine.md](../design/2026-11-12-2305-sim-step-engine.md), approved 2026-11-13. Release B. Depends on `world-core`, `world-funding`, `policy-timeline`; built beside `world-score` and `map-stream`, which it calls.

## Purpose

Today the worker runs 101 whole futures for one policy, then a shown run, and starts all of it again when a lever changes. This subsystem is the worker side of the new `/sim`: it advances 48 worlds, and 48 more under the comparison, one month at a time ahead of the viewer, posts what is final as it goes, and after an edit resumes from the edit's month.

## Scope

- The worker host for the timeline: opening, policy edits, slicing, posting.
- Advancing both ensembles in step, feeding each world's events to its `WorldSeries` (`world-score`) and world 1's to the `MapStream` (`map-stream`).
- Kept copies and resuming after an edit.
- The page-side client for the new messages.

Not in scope: what a series row contains or how the band is formed (`world-score`); geometry and packing (`map-stream`); compiling policies (`policy-timeline`); the page (`timeline-ui`).

The host lives in `src/lib/sim/world/host.ts`, the messages in `src/lib/sim/timeline-protocol.ts`, the client in `src/lib/sim/timeline-client.ts`. `src/lib/sim/router.ts`, `protocol.ts` and `worker.ts` are not hashed and may change. `scenario/types.ts` is hashed and does not change: the new messages and their error codes are new types.

## Interfaces

{{ROW S14}}

{{ROW S16}}

Used, owned elsewhere:

{{ROW S2}}

{{ROW S6}}

{{ROW S11}}

{{ROW S13}}

{{ROW S15}}

{{ROW S17}}

Constants exported from the client: `WORLDS = 48` and `WINDOW_MONTHS = 480`. The client sends them in `openTimeline`; nothing else in the package states those numbers.

## Rules

### The dataset and the old host

1. The new host needs what `createScenarioHost` already builds and keeps to itself: the loaded manifest and chunks, the base `SimInput`, the lever context (`LayerCtx`), geometry, and the handlers for `parcelSummary`, `resolveBrush`, `brushCatalog`, `lotOutlines`, `previewBuildings`, `heightLids`, `lotAt`, `prefetch` and `retryChunks`. This is the one place the package may change a hashed file (global constraints). The builder moves or exports those parts of `scenario-host.ts` so both hosts use one copy, changes no behaviour of the old host, and proves it: every existing test of the old host and every golden passes unchanged. The branch then follows the dataset-change procedure.
2. `/lesscars` and the old messages keep working. `/sim` stops sending `initScenario`, `reroll` and `setLevers` only when `timeline-ui` switches it. `openTimeline` is routed as `initScenario` is: it disposes the editor host's state, and shared requests go to the host of the latest init.

### Opening

3. On `openTimeline`: load the dataset as today, post `ready`, `chunks` and `heights` as today; build `Statics` (`staticsOf`); start two compiles, `compileTimeline(policy, lots, ctx, 'plan')` and, for `c = comparisonOf(policy)`, `compileTimeline(c.doc, lots, ctx, c.base)`, posting `compiling` from `progress()`. When month 1's frame of each exists, create worlds 1..`worlds` for each (seeds 1..`worlds`) with `withFunding(createFundingSystem())`, one `WorldSeries` per world, the `MapStream` for world 1 of the plan ensemble, and begin filling. When the plan compile has finished, post `compiled` with `scoreStaticsOf(…)`. Post `lookups` for month 1 as soon as its frame exists.
4. First task: measure, on the live city when a local copy is present (else the bench city, marked so): creating 96 worlds; the heap after a full fill with every copy kept; and the time from `openTimeline` to the first `cells` and to the first `filled`. Report to the conductor. If 96 worlds take over 1.5 s to create, `planDue` runs through 60 months first and is extended as filling approaches. If the heap passes S16's bound, stop and report: the spacing of copies is a table row, not the builder's to change.

### Filling

5. One unit of work is one world advanced one model month. A slice does units until 45 ms have passed, then yields (`setTimeout`), as today's host does. No unit may itself exceed 50 ms; a month in which the policy changes is the worst case and is measured.
6. Order: month by month; inside a month every world of the plan ensemble, then every world of the comparison ensemble. So every world is within one month of every other.
7. Each world's `StepSink.event` feeds that world's `WorldSeries`, and `stepped(month)` follows each step. World 1 of the plan ensemble also feeds the `MapStream` and passes a `ledger` sink, kept for the money series. Other worlds pass no `ledger`.
8. A calendar month is final when every world of both ensembles has stepped through the model month holding its last day. After each model month, if new calendar months became final, post `filled` with `chunkOf(…)` for them. At most one `filled` per slice.
9. The runner calls `MapStream.flush(world1, statics, 20)` at most four times a second, between slices, and posts each non-null result as `cells` as it is. Updates are never merged: each carries the stream's next revision number. When filling ends it calls `flush` until it returns null.
10. Filling stops at model month `months`. The world and the step know nothing of that number.
11. When the next month's frame is not compiled yet (`readyThrough()`), the slice calls the compile's `step(20)` instead of stepping.

### Edits

12. On `setPolicy`: filling stops. Compile the new document and its comparison (a `LeverFormatError` posts `error` `bad-request` at that `rev`, and filling resumes under the previous timelines). A `setPolicy` that arrives during a compile replaces it; nothing is posted for the superseded `rev`.
13. For each ensemble, once the new timeline is ready through the last month stepped (or through its end), find `m = firstDifference(old, new)`. If `m` is null or beyond the last month stepped, the ensemble keeps its worlds and carries on under the new timeline.
14. Otherwise: restore every world of that ensemble, and its `WorldSeries`, from the last kept copy at or before month m - 1 (S16); rebuild each due list with `planDue`; cut world 1's ledger back to its length at that copy (plan ensemble only); step every world quietly to month m - 1, feeding the series and the ledger but posting nothing (those months are unchanged); post `refill` with the index of the first calendar month not final at month m - 1; call `MapStream.rewind` with world 1 as it then stands (plan ensemble only); then fill on from month m. Months before the edit are not withdrawn and not posted again.
15. Copies are taken after months 0, 60, 120 and so on, for every world of both ensembles, with the length of world 1's ledger at that moment. Copies later than a restore point are discarded on restore.
16. If one ensemble restores and the other does not, the other waits at its month until the first catches up; `filled` is posted only for months final in both.
17. `filled` and `refill` after an edit carry the new `rev`, including for an ensemble that kept its worlds.

### Lookups and the map

18. `parcelSummary` is answered with `cardAt` on world 1 of the plan ensemble as it stands, the requested day, and the frame of the model month holding that day. A request for a day past the last month stepped is answered for the last day stepped. The other lookups are answered by the shared handlers of rule 1, for the zoning of the frame at the last `viewMonth`.
19. `lookups` carries `lookupsAt(frame)` (`policy-timeline`) for the frame at the last `viewMonth`, as a new object, whenever that frame's calibrations or scales differ from those last posted.
20. `resyncMap`: `MapStream.rewind` is not used; the runner posts `MapStream.snapshot(world1, statics)` as `cells`.

### Failure

21. Any throw inside a unit posts `error` at the current `rev` with code `'timeline'` and stops filling until the next `setPolicy` or `openTimeline`. Chunk failures are reported through `compiling.failedCells` and `chunks`, and `retryChunks` works as today.

## The client

22. `TimelineClient` wraps the worker like `ScenarioClient` does: `open(manifest, policy, lots)`, `setPolicy(policy, lots): Rev`, `viewMonth(month)`, `resyncMap()`, the lookups of today's client unchanged, and callbacks `onFilled`, `onRefill`, `onCells`, `onLookups`, `onCompiling`, `onCompiled`, `onError`, `onChunks`, `onHeights`, `onCrash`. It drops `compiling`, `compiled`, `filled` and `refill` whose `rev` is older than the last `setPolicy` it sent, and never drops `cells` or `lookups`. `restart(worker)` re-opens with the last policy, as today's client does after a crash.

## Tests that must pass

Assert, in signoff, with the fixture dataset and fake timers, as today's host tests do:

- Open: `ready`, `compiled`, `lookups`, then `filled` messages whose months are contiguous from 0 and end at `ScoreStatics.lastIndex`.
- The series posted equal what stepping the same 96 worlds in a plain loop gives.
- An edit dated after the fill point: no `refill`; later months reflect the new policy.
- An edit dated at month 100 after filling to 300: one `refill`, whose `from` is the first calendar month not final at month 99; no month before it is posted again; the final series, money included, equal a fresh open with the edited policy.
- An edit that changes only a label, or adds a policy that is off: no `refill`, no change.
- Two `setPolicy` in a row: only the second is reflected; nothing is posted for the first after the second arrives; every `cells` update still applies in order on a fake map controller (no revision gap).
- `resyncMap` is answered with a revision 0 holding every cell.
- A document the compiler rejects: `bad-request`, and the previous timeline's months keep arriving.
- A comparison that does not change keeps its worlds (rule 16).
- `viewMonth` into a frame with different zoning posts `heights` again; into one with different permitting posts `lookups`.
- The old host's tests and goldens pass unchanged (rule 1).

`test:perf` (print; assert the bar only there): no slice over 50 ms on the bench city; whole-window fill on the live city when present against 480 × 9 ms; first `cells` and first `filled` within 3 s of `openTimeline` (today's first-paint bar); the heap bound of S16, checked after a full fill and again after 20 edits that each add a zoning policy.

Docs: a "The worker" section in `docs/dev/sim-timeline.md` (created by `timeline-ui`; if this lands first, create the file with this section).

## Left to the builder

- How `scenario-host.ts` is split or exported (rule 1), within its limits.
- How copies are stored.
- The shape of the host's internal queue.

Decided here, not left: the unit and order of work (rules 5 and 6), when a month is final and posted (rule 8), how often `cells` is posted (rule 9), that filling stops during a compile (rule 12), what an edit restores and reposts (rules 13 to 17), and where copies are taken (rule 15).

## Global constraints

{{CONSTRAINTS}}
