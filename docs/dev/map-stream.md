# The map feed from a stepped world

`createMapStream(deps, windowMonths)` (`src/lib/sim/world/map-stream.ts`) turns world 1's events into the map's whole-cell `TimelineUpdate`s (spec `docs/superpowers/specs/2026-11-13-map-stream-design.md`, S17). It is worker-safe and under the determinism rule (no transcendental `Math`).

`MapStreamDeps`: `massing` (a `MassingCtx`: `records` answer for every parcel of every ready cell, `input.parcels` places cells), `cellReady(cellId)` (the cell's chunk records are loaded), `warnOnce(key, msg)`, `now?()` (budget clock, default `performance.now`), `massingCap?` (test seam, default 60,000).

## Host calls

- Buffer `createWorld`'s events and replay them to `onEvent` once it returns. `onEvent(e, world, statics)` for every event of world 1; it marks the project's cell dirty and packs nothing.
- `flush(world, statics, budgetMs)` between steps: packs dirty cells, oldest first, until about `budgetMs` has passed. Returns one update, or null when nothing changed.
- `rewind(world, statics)` after restoring world 1.
- `snapshot(world, statics)` for `resyncMap`.

## Rules

- A slot is a project. Its cell is the cell of its smallest `ParcelId`; its pick parcel is its largest-area parcel.
- A cell is packed whole from `scheduleAt(world, statics, row, lastDay)` of every project in it (`lastDay` = last day of `world.month`). A live project has the stage days known so far, `NaN` for stages not entered, and an open end.
- A cell whose chunks are not loaded waits and stays dirty.
- Revision 0 is the first update and every `snapshot`; every other update is the next number, across rewinds.
- Demolitions: a lot and the day a project enters construction on it. Revision 0 carries all known; later updates carry those new or changed in `demolish`. Sent as soon as known, even while the lot's cell waits for its chunk, so the old building can disappear before the new one is drawn (revision 0 already does). A lot can appear in `demolish` more than once; the pump keeps the earliest ([map-interfaces.md](map-interfaces.md), "Timeline demolitions after revision 0").
- `rewind` compares the projects last sent with the restored world. A project gone or with a changed row dirties its cell; a cell left with no project goes into `removedCells`. A lot whose demolition no longer holds goes in `restore`; a lot whose day changed goes in `restore` and then `demolish`. Unchanged cells are not sent again.
- `snapshot` is unbudgeted. Cells waiting on chunks stay dirty. Pending restore and removals are superseded.
- Pipeline projects at the dataset date go out in the first updates.

## Massing memo

One massing per project revision, keyed by the revision's content, so never stale. Kept to 60,000, then LRU. After a rewind, massings of removed projects stay until evicted.

## Draining and `complete`

The slicing unit is one project's massing work: a cell's massings are spread over several flushes and the cell is sent only whole. So with a finite budget `flush` can return null while a cell is part-done. Drain with an `Infinity` budget, or until an update has `complete: true`; never until null.

Exactly one update has `complete: true` once `world.month >= windowMonths` and no ready dirty cell is left (a cell waiting on chunks does not block it). A rewind re-arms it.

On the live city one project costs up to about 635 ms cold (`CASE:2007.0946PRX:phase:3`), past the 50 ms slice limit. Open item for `ensemble-runner`, for example warming massings ahead of time.

## Numbers

Seed 1, 480 months, quiet machine (lock held), Apple M5 Pro.

- Measurement 1 (`.superpowers/sdd/map-stream/measurement-1.md`). Live `2026-11-10-6ee5a23d`: 124 cells, every cell packed more than once, total packing 1.37 s, p95 flush 3.8 ms, p95 cells per update 22. Bench city: 256 cells, total 4.7 s, p95 cells per update 121.
- `map-stream.perf.spec.ts`. Bench city: worst flush 22.5 ms, p95 20.1 ms (bar met); snapshot cold 532 ms, warm 62 ms. Live `2026-11-10-6ee5a23d`: longest flush 631 ms (month 9); snapshot cold 1,165 ms, warm 6.3 ms.
- Still owed (ensemble-runner, timeline-ui): the controller's cost to apply one update of 22 (live) and 121 (bench) cells, and `npm run bench:map` while a fill streams (plan Task 9).

## Tests

`map-stream.spec.ts`, `map-stream.rewind.spec.ts`, `map-stream.equality.spec.ts` (also on the live city under `SFH_WORLD_LIVE`: 1,931 schedules equal `simulateDetailed`). Timing: `map-stream.perf.spec.ts` (`npm run test:perf`), `scripts/map-stream-measure.ts`, `scripts/map-stream-live.ts`.
