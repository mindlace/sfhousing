# map-stream: buildings on the map as they come to exist

Part of the step-engine package. Design: [2026-11-12-2305-sim-step-engine.md](../design/2026-11-12-2305-sim-step-engine.md), approved 2026-11-13. Release B. Depends on `world-core` (events and readers); called by `ensemble-runner`.

## Purpose

Today the worker packs every building of a finished run, with every stage day of its whole life, and the map's shader decides what is visible on the playhead's day. This subsystem feeds the same map from one world (world 1, "this city") as it is filled: a project's building is packed when the project starts, and its cell is packed again when a later stage day, a revision or its end becomes known.

The map's shaders, bars and cell handling do not change: it already takes whole-cell updates (`TimelineUpdate`, `SimMap.applyTimeline`). One thing does change (design ruling T13): the map's timeline controller learns to add and take back demolitions after the first install.

## Scope

- `MapStream`: from world 1's events to `TimelineUpdate`s.
- What is replaced or removed after an edit throws part of the future away.
- The demolition change in `src/lib/map/timeline-controller.ts` and `src/lib/map/types.ts` (neither is hashed).

Not in scope: the shaders, the bars and their lookups, the declutter (unchanged); posting and its rate (`ensemble-runner`); cards (`world-score`).

Code lives in `src/lib/sim/world/map-stream.ts`. It imports `massingFor`, `massingsFor` and the cell helpers of `scenario/massing.ts`, `createGeometry` from `scenario/geometry.ts` where it fits, `packTimedCell` from `src/lib/map/pack-timed.ts` and `validateTimedCell` from `src/lib/map/timelapse/encode.ts`, and changes no hashed file.

## Interfaces

{{ROW S17}}

{{ROW S7}}

{{ROW S8}}

`MapStreamDeps` is what packing needs from the host: the parcel records of loaded cells, the massing context (`MassingCtx`), and whether a cell's chunks are loaded.

## Rules

1. First task: on the live city when a local copy is present (else the bench city, marked so), measure for one world filled to forty years: how many cells are packed more than once; the total packing time; the worst single `flush`; and, on the page with playback running during a fill, the main-thread time the map spends applying one update (the bar rebuild and declutter run once per update, about 52 to 56 ms at 30,000 projects in the timelapse-render spec). Report to the conductor before building rule 4's queue any further than needed.
2. A slot on the map is a project, as today. A project's cell is the cell of its smallest `ParcelId`; its slot's pick parcel is its largest-area parcel (both as `createGeometry` does today).
3. `onEvent` marks the project's cell dirty for every event with a `row`. It does no packing.
4. `flush(world, statics, budgetMs)` packs dirty cells until about `budgetMs` has passed and returns one `TimelineUpdate` with those cells whole, or null when nothing changed. A cell is packed from `scheduleAt(world, statics, row, lastDay)` of every project in it, where `lastDay` is the last day of `world.month`, with `massingsFor` giving one massing per revision. Cells left dirty stay for the next flush, oldest first.
5. What a packed slot holds for a project still alive: the stage days known so far, `NaN` for stages not yet entered, and an open end, exactly as an `'open'` schedule packs today. The map then shows it in its latest known stage until a later update arrives. The runner fills well ahead of the playhead, so the playhead does not normally reach a day the map has not been told about; when it does (a refill in progress), `timeline-ui` marks the map stale.
6. A cell whose projects need chunks not yet loaded waits, as today (`chunks`, `retryChunks`); it stays dirty.
7. Revisions: the first update of a stream, and every `snapshot`, is revision 0; every other update has the next number, across rewinds. `complete` is true on an update when the world has stepped month `windowMonths` and no cell is dirty.
8. Demolitions (changed, T13). A demolition is a lot and the day a project enters construction on it. Revision 0 carries every demolition known so far. Each later update carries in `demolish` the demolitions that became known since the last update, and in `restore` the lots whose demolition no longer holds after a rewind. The controller is changed to apply both after revision 0 (today it logs an error and ignores `demolish` there, `timeline-controller.ts:191-194`): an added entry behaves as one in the revision 0 list does, and a restored lot shows its existing building on every day again. An update with no `restore` field and an empty `demolish` behaves exactly as today, so `/lesscars` is unaffected.
9. `rewind(world, statics)`: the stream compares the projects it has packed with the restored world. A project that no longer exists has its cell marked dirty, and a cell left with no project goes into `removedCells` of the next update. A project whose row differs (stage days or end now unknown again) has its cell marked dirty. A demolition whose project is gone or has not yet entered construction goes into `restore`. Cells whose projects are unchanged are not sent again.
10. `snapshot(world, statics)` packs every cell that has a project and returns it as revision 0 with the whole demolish list, clearing the dirty set. The runner uses it to answer `resyncMap`.
11. `massingFor` is called once per project revision and its result kept until the project's row changes or a rewind removes the project. At most 60,000 massings are kept (today's `MEMO_CAP`); past that the least recently used go.
12. Pipeline projects at the dataset date are packed in the first updates, so the map is never emptier than today's first paint.

## Tests that must pass

Assert, in signoff:

- For a world stepped to the horizon with no edit, the set of cells last sent, taken together, equals `packTimedCell` over the schedules `simulateDetailed` gives for the same seed (bench city and fixture; without public money, under one frame), cell for cell and array for array; and the demolitions sent, taken together, equal today's revision 0 list.
- A project that starts in month 30, enters construction in month 50 and completes in month 90: an update after month 30 carries its slot with an open end; one after month 50 carries its lot in `demolish`; one after month 90 carries its completion day.
- With the real controller: the existing building on that lot is hidden from the construction day, and shown again after a `rewind` to month 40 and a refill under a policy that removes the project (`restore`).
- After `rewind` to month 60 and a refill under a policy that removes a project: the next updates remove or replace its cell, and no cell holds its id.
- After `rewind` and a refill under the same policy: the cells sent are only those dirtied by months after the restore point.
- `snapshot` after any of the above equals a fresh stream's cells for the same world.
- Every update passes `validateTimedCell`, and a fake controller that enforces "revision must be the last plus one" accepts every update in order.
- The existing controller tests pass unchanged apart from the one that pins "demolish after revision 0 is ignored", which is replaced by rule 8's cases.

`test:perf`: `flush(…, 20)` never exceeds 30 ms on the bench city; `npm run bench:map` meets its bar while a fill is streaming (a new bench case).

Docs: a "The map feed" section in `docs/dev/sim-timeline.md`; `docs/dev/map-interfaces.md` records the `demolish` and `restore` change.

## Left to the builder

- How dirty cells are queued and how packed inputs are cached.
- Whether to reuse `createGeometry` or write a smaller packer around `packTimedCell`.

Decided here, not left: whole-cell updates through the map's existing message (rule 4), which parcel places a cell (rule 2), what an unfinished project packs as (rule 5), how demolitions travel and that the controller changes for them (rule 8), what a rewind sends (rule 9), and the massing cap (rule 11).

## Global constraints

{{CONSTRAINTS}}
