# Survey: what the engine gives the page today

Read-only survey, 2026-11-24, branch `worktree-incremental-feel`. Nothing was run: no tests, no
server, no measurement. Every figure quoted is from a doc or a code comment.

All paths are relative to `/Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-feel/`.

Marks: **V** = verified at the file:line cited, which I read. **I** = inferred (the reasoning is
stated). Docs are testimony: a claim cited to a `.md` file is V only as "the doc says so".

Note on scope: `src/lib/sim/host.ts` (in the scope list) is the Paint editor's host. The timeline
host that `/sim` uses is `src/lib/sim/world/host.ts` (`worker.ts:8`, `:36-45`). I read the second
in full and the first only to line 110.

## Headline findings

1. **V** No per-project event is posted to the main thread. `WorldEvent` (`src/lib/sim/world/types.ts:143-150`)
   stays in the worker; the message union has no member carrying it (`src/lib/sim/timeline-protocol.ts:127-147`).
2. **V** A per-project record does reach the page, citywide: the `CityDelta` marker in
   `cells.render.city` (`src/lib/map/types.ts:70-83`). It carries the world's row index, the anchor
   lot's label point, three days (approved, started, completed) and the homes. It carries no
   project id, no parcel id, no existing homes and no income tiers.
3. **V** Homes by tier per project are computed only inside the worker (`tiersOf` at
   `src/lib/sim/world/score/series.ts:345`), added straight into per-month sums, never stored per
   row and never sent. The page gets cumulative tiers per month only (`SeriesChunk.tiers`,
   `src/lib/sim/world/score/types.ts:85`).
4. **V** The funding line exists only as columns of the worker's world (`FundLine`,
   `src/lib/sim/world/funding/columns.ts:13-60`). No non-test code outside
   `src/lib/sim/world/funding/` reads it (by grep); the series has no field for it; nothing
   about it is posted.
5. **V** The twin's own rows are not sent. A chunk carries only plan minus twin for two fields
   (`src/lib/sim/world/score/chunk.ts:29-32`). And the twin is current law only while the
   document has something in force (`src/lib/sim/world/policy/compare.ts:39-44`).
6. **V** The whole window is computed ahead of the playhead, once per open or edit, and the page
   replays it. `viewMonth` changes only the permitting lookups and the height limits
   (`src/lib/sim/world/runner/runner.ts:1310-1316`).

---

## (a) The timeline protocol

Types in `src/lib/sim/timeline-protocol.ts`. `Rev = number`, "strictly increasing per client,
starting at 1" (`src/lib/sim/protocol.ts:12`).

### Page to worker

`TimelineRequest` (`timeline-protocol.ts:100-106`), **V**:

| `type` | Fields | Lines |
| --- | --- | --- |
| `openTimeline` | `rev: Rev`, `manifest: Manifest`, `policy: SimPolicy4`, `lots: Record<string, ParcelId[]>`, `months: number` | 42-49 |
| `setPolicy` | `rev: Rev`, `policy: SimPolicy4`, `lots: Record<string, ParcelId[]>` | 93-98 |
| `viewMonth` | `month: number` ("The model month the playhead is in.") | 103-104 |
| `resyncMap` | none ("Answered by a `cells` whose update is revision 0 with every cell and the whole demolish list.") | 105-106 |

`SharedRequest` (`timeline-protocol.ts:109-123`), **V**: the scenario protocol's requests the
timeline host also answers, shapes unchanged (`src/lib/sim/scenario/types.ts:136-175`,
`src/lib/sim/protocol.ts:20-21`):

| `type` | Fields |
| --- | --- |
| `parcelSummary` | `reqId: number`, `parcelId: ParcelId`, `day: Day`, `projectId?: string` |
| `resolveBrush` | `reqId`, `query: BrushQuery` |
| `brushCatalog` | `reqId` |
| `lotOutlines` | `reqId`, `lots: ParcelId[]` |
| `previewBuildings` | `reqId`, `lots: ParcelId[]`, `stories: number` |
| `heightLids` | `reqId`, `bbox: [number, number, number, number]` |
| `lotAt` | `reqId`, `point: [number, number]` |
| `prefetch` | `bbox: BBox` |
| `retryChunks` | none |

`TimelineHostRequest = TimelineRequest | SharedRequest` (`timeline-protocol.ts:125`). **V**

Request checks, **V**: `openTimelineProblem` (`:168-177`: `rev` integer, `manifest` and `policy`
objects, `lots` an object of string arrays, `months` an integer >= 1) and `setPolicyProblem`
(`:180-185`).

### Worker to page

`TimelineResponse` (`timeline-protocol.ts:127-147`), **V**:

| `type` | Fields | Notes as written |
| --- | --- | --- |
| `compiling` | `rev`, `done: number`, `total: number`, `failedCells: string[]` | |
| `compiled` | `rev`, `capacity: LeverCapacity`, `unknownLots: number`, `statics: ScoreStatics` | |
| `filled` | `rev`, `through: number`, `series: SeriesChunk` | "`through` is the last final calendar-month index; `series.from` the first index carried." |
| `refill` | `rev`, `from: number` | "Every calendar month from index `from` on is withdrawn until filled again." |
| `cells` | `render: TimelineUpdate` | "No `rev`: never dropped." |
| `lookups` | `month: number`, `lookups: LeverLookups` | "No `rev`: never dropped. A new object each time the permitting in view changes." |
| `error` | `rev`, `code: TimelineErrorCode`, `message: string` | |

`TimelineErrorCode = ScenarioErrorCode | 'timeline'` (`timeline-protocol.ts:15`);
`ScenarioErrorCode = 'manifest-invalid' | 'scenario-missing' | 'scenario-invalid' | 'bad-request' | 'internal'`
(`scenario/types.ts:230-231`). **V**

`TimelineHostResponse = TimelineResponse | Exclude<ScenarioResponse, { type: 'error' | 'timeline' | 'ranks' | 'levers' }>`
(`timeline-protocol.ts:150-151`). **V** What that leaves of `ScenarioResponse`
(`scenario/types.ts:232-250`, `protocol.ts:39`, `:49`):

| `type` | Fields |
| --- | --- |
| `ready` | `rev`, `datasetVersion: string`, `chunkCount: number` |
| `chunks` | `status: Record<string, ChunkStatus>`, `pending: number`, `failed: string[]` |
| `parcelSummary` | `reqId`, `summary: ParcelSummary \| null` |
| `brushLots` | `reqId`, `result: BrushLotsResult` |
| `brushCatalog` | `reqId`, `catalog: BrushCatalog \| null` |
| `lotOutlines` | `reqId`, `result: LotOutlinesResult` |
| `previewBuildings` | `reqId`, `result: PreviewResult` |
| `heights` | `rev`, `city: HeightCity` |
| `heightLids` | `reqId`, `result: HeightLidsResult` |
| `lotAt` | `reqId`, `result: LotAtResult` |

### Rules of the exchange

- **V** `months` is "the window length in model months; each side runs one world, on seed 1"
  (`timeline-protocol.ts:36-37`); `SEED = 1` (`src/lib/sim/world/runner/ensemble.ts:26`). The
  client always sends `months: WINDOW_MONTHS` (`src/lib/sim/timeline-client.ts:107-114`).
- **V** `open` is rev 1 of a session and each `setPolicy` the next (`timeline-protocol.ts:21-22`).
- **V** Client drops (`timeline-client.ts:236-256`): `compiling` when `rev < #policyRev`;
  `compiled`, `filled`, `refill` when `rev < #openRev`; `cells`, `lookups`, `error`, `chunks`,
  `heights` never.
- **V** "a `filled` chunk belongs to the statics of the last `compiled` delivered before it" and
  a consumer "does not assume `rev` rises" (`timeline-protocol.ts:27-29`).
- **V** Every accepted edit is answered by exactly one `refill` at its rev; a rejected one by
  `error` `bad-request` and no `refill` (`timeline-protocol.ts:57-63`). A rev can get more than
  one `compiled` and `refill`: "never dedupe them by `rev`" (`:73-75`).
- **V** Router: `openTimeline` disposes the editor and scenario hosts (`src/lib/sim/router.ts:78-85`);
  `setPolicy` outside timeline mode is answered `bad-request` (`:86-92`); `viewMonth` and
  `resyncMap` outside timeline mode are ignored (`:93-96`).
- **V** `openTimeline` posts `ready` at once, before the dataset loads (`src/lib/sim/world/host.ts:237`).
- **V** A `setPolicy` before the load replaces the opening document (`host.ts:295-300`).

---

## (b) What identifies individual projects on the main thread

### The engine's events (worker only)

`WorldEvent` (`src/lib/sim/world/types.ts:143-150`), **V**:

```ts
| { kind: 'start'; row: number; day: Day }
| { kind: 'enter'; row: number; day: Day; stage: Stage }
| { kind: 'revise'; row: number; day: Day; units: number; stories: number | null }
| { kind: 'end'; row: number; day: Day; how: 'complete' | 'exit' | 'entitled' }
| { kind: 'phaseFiled'; row: number; day: Day; phase: number }
| { kind: 'award'; row: number; day: Day }
| { kind: 'displaced'; row: number; lot: number; day: Day; units: number }
```

- **V** A completion is `{ kind: 'end', row, day, how: 'complete' }`. It carries the row and the
  day; not the homes, the lot or the tiers.
- **V** Where events go: the ensemble's sink pushes each to a feed log, and for the plan's world
  outside quiet steps also to `MapStream.onEvent` and the runner's `onEvent`
  (`ensemble.ts:132-143`). The runner's `onEvent` only sets `dirty` and queues warm massings for
  `'start'` and `'revise'` (`runner.ts:739-742`). `feed` units drain the log into the
  `WorldSeries` (`ensemble.ts:223-239`).
- **V** No message posts an event (`timeline-protocol.ts:127-147`).
- **V** `row` indexes `World.projects` ("One row per project, master and phase; a row never
  moves", `world/types.ts:64`).

### `TimelineUpdate` (the `cells` message)

`src/lib/map/types.ts:86-96`, **V**:

```ts
export interface TimelineUpdate {
  revision: number; // 0 = snapshot
  cells: TimedPackedCell[];
  removedCells: string[];
  demolish: { parcelId: ParcelId; day: Day }[];
  restore?: ParcelId[];
  swap?: true;
  complete?: boolean;
  city?: CityDelta;
}
```

It carries two separate per-project records.

#### 1. `city: CityDelta`, citywide, no chunk needed

`src/lib/map/types.ts:63-83`, **V**:

```ts
export const CITY_DAY = { approved: 0, started: 1, completed: 2 } as const;
export interface CityDelta {
  rows: number;          // the world's row count now: markers at rows >= this are dropped
  from?: number;         // the drop floor after a rewind
  row: Int32Array;       // changed rows, strictly ascending, each < rows
  lngLat: Float32Array;  // 2 per changed row: the anchor lot's label point
  days: Float32Array;    // 3 per changed row (CITY_DAY): NaN = not (yet)
  homes: Uint16Array;    // per changed row: the final revision's units, capped at 65535
  flags: Uint8Array;     // per changed row: SLOT_FLAG bits
}
```

How each field is made (`src/lib/sim/world/city-feed.ts:86-112`), **V**:

- `lngLat`: `P.labelPoint` of the row's anchor lot (`:89-92`). The anchor is the stream's
  `place(...).anchor` = `cellAnchorParcel(present, P)` over the row's parcels that are in
  `parcels.bin` (`src/lib/sim/world/map-stream.ts:166-195`).
- `days[approved]`: the earlier of `entered.entitled` and `entered.permitIssued` (`:98-105`).
- `days[started]`: `entered.construction` (`:106`).
- `days[completed]`: `s.end.day` when `s.end.kind === 'complete'` (`:107`). A day, as float32.
- `homes`: `min(65535, max(0, units))` of the last revision in `scheduleAt(...).revisions`
  (`:108-109`). These are the project's own units, not net of existing homes.
- `flags`: `slotFlags` (section e) (`:110`).
- All read through `scheduleAt(world, statics, row, day)` with `day` = the last day of
  `world.month` at the flush (`map-stream.ts:338`, `:381`).

Coverage, **V**:

- One marker "per project row of the plan world that has a T11 lot, loaded cell or not"
  (`city-feed.ts:1-2`).
- No marker for a master row or a row with no parcel in `parcels.bin` (`city-feed.ts:10-11`,
  `:87-88`; `map-stream.ts:162`, `:179-194`). Masters never complete (`series.ts:372` throws on
  it), so the gap is rows whose parcels are all absent from T11. How many such rows the live
  dataset has: not examined.
- A phase is its own row with its own marker (`map-stream.ts:159-161`).
- The plan's world only (`runner.ts:734`: `map: s.isPlan ? { stream, onEvent } : undefined`).

Delivery, **V**:

- Revision 0 (the first flush, every `snapshot`) carries every marker (`map-stream.ts:393`,
  `:513-514`); later updates carry only touched rows whose marker changed
  (`city-feed.ts:150-177`). An update can go out for city rows alone (`map-stream.ts:382-392`).
- Flushes are at least `FLUSH_EVERY_MS = 250` apart (`runner.ts:104`, `:865`), never while the
  plan re-steps quietly (`runner.ts:861`).
- A marker's completed day appears only once the world has stepped the model month holding it:
  `endOf` returns `open` while `endDay > day` (`src/lib/sim/world/read.ts:50`).
- "Days are the world's as of `lastDay`, ahead of the playhead too: the page and its shaders hide
  what the clock has not reached" (`docs/dev/map-stream.md:35`, testimony).
- After an edit restores the plan's world, `from` tells the page to forget every marker at or
  past that row (`map/types.ts:72-77`, `city-feed.ts:179-197`). A later row of the same index "is
  a new project, placed afresh" (`map-stream.ts:419-420`). **I** So a row index identifies a
  project only between rewinds; it is not a stable id across edits.
- 27 bytes a row, transferred (`docs/dev/map-interfaces.md:143`, testimony).

An existing page-side reader, **V** (`src/lib/timeline/activity.ts:16-24`, `:94-105`):
`ActivityIndex` keeps a `CityStore` and gives

```ts
export interface ActivityEvent {
  row: number; kind: 'approved' | 'started' | 'completed'; day: Day;
  homes: number; lngLat: [number, number]; policy: boolean;
}
recent(after: Day, through: Day, limit = ACTIVITY_LIMIT): ActivityEvent[]
```

`CityStore` itself (`src/lib/map/timelapse/city.ts`) was not read.

#### 2. `cells: TimedPackedCell[]`, only for loaded chunks

`src/lib/map/types.ts:33-61`, **V**:

```ts
export interface PackedCell {
  cellId: string;
  parcelIds: ParcelId[];        // dense table; index = parcel slot
  parcelMeta: Uint32Array;      // per parcel slot: [units, existingUnits, stories, typologyIdx]
  partCount: number; startIndices: Uint32Array; positions: Float64Array;
  partTopM: Float32Array; partSlot: Uint32Array; partAppearance: Uint8Array; partTypology: Uint8Array;
}
export interface TimedPackedCell extends PackedCell {
  slotProjectIds: string[];   // render slots are keyed by project
  partWindow: Float32Array;   // per part: [fromDay, toDay)
  slotStages: Float32Array;   // per slot: STAGE_ORDER.length entry days, NaN = never
  slotEnd: Float32Array;      // per slot: [endDay, endKind] (0 open, 1 complete, 2 exit)
  slotPathway: Uint8Array;
  slotCohort: Uint8Array;     // 0 = fresh, 1 = in flight
  slotFlags?: Uint8Array;     // SLOT_FLAG bits
}
```

- **V** "`parcelMeta` rows describe the slot's final revision" (`map/types.ts:51`).
- **V** A cell is packed only when every cell of every project anchored in it has its chunk
  loaded (`map-stream.ts:198-203`, `:358`); `cellReady` is `ds.chunks.byCell.has(cellId)`
  (`runner.ts:1263`). Chunks load for viewport cells (`prefetch`, `host.ts:429-435`) and for
  cells the stream or a compile asks for (`runner.ts:873-875`, `runner/dataset.ts:164-165`).
  **I** So `cells` is citywide only if every chunk is wanted, as `level2-check` does.
- **V** A cell is packed whole from every project in it; a slot is a project
  (`map-stream.ts:8-9`, `:254-298`).
- `packTimedCell` (`src/lib/map/pack-timed.ts`), which writes these arrays, was not read.

#### 3. `demolish`

**V** `{ parcelId, day }` per T11 lot: "the earliest day a project entered construction on it"
(`map-stream.ts:13-16`, `:327-334`, `:395-400`). Sent whether or not the lot's cell is loaded
(`docs/dev/map-stream.md:21`, testimony).

### Snapshots

- **V** `MapStream.snapshot(world, statics): TimelineUpdate` (`map-stream.ts:466-515`): revision
  0, every ready cell with a project, the whole demolish list, every city marker. It answers
  `resyncMap` (`runner.ts:1243-1249`).
- **V** The ensemble's copy (`ensemble.ts:95-100`, `:213-220`) is `{ month, world, feed, ledgerLength }`,
  taken only at `COPY_MONTHS = [0]` (`ensemble.ts:23`). It stays in the worker.

### "Project X completed in month M with N homes"

- **V** From `CityDelta`: row X has `days[3k + CITY_DAY.completed] = D` (not NaN) and
  `homes[k] = N`. M is the month holding D; the page's helper for a calendar index is
  `indexOfDay(months, day)` (`src/lib/timeline/playhead.ts:18-20`), with `months` from
  `ScoreStatics.months` (`score/types.ts:156-157`).
- **V** From a `TimedPackedCell` (loaded cells only): slot s has `slotEnd = [endDay, 1]`,
  `slotProjectIds[s]`, and `parcelMeta` giving `[units, existingUnits, ...]`.
- **V** From `parcelSummary` on a lot (one request per lot): `summary.project: ProjectCard` with
  `projectId`, `units`, `existingUnits`, `end`, `stages`, `kind?`, `funding?`
  (`scenario/types.ts:279-308`).
- **I** `CityDelta.homes` is not what the series counts. The series adds the row's units at
  completion and takes `existing` off at the construction start after `asOf`
  (`series.ts:506-507`, `:542`); the marker carries units only. Summed marker homes over
  completions therefore exceed `completedNet` wherever existing homes are above 0, and differ
  again for rows with no marker and for projects above 65,535 homes.

### Homes by tier per project

- **V** `tiersOf(sc: Schedule, ctx: TierCtx): TierUnits` (`src/lib/sim/scenario/finance-score.ts:215-231`).
  Its only non-test callers are `series.ts:345` and the old engine's `tierSeries`
  (`finance-score.ts:254`).
- **V** In the step engine it runs inside `fileTiers` at a row's completion (`series.ts:332-348`,
  called at `:554`, and at `:447-448` to re-file after a late award). The five results are bumped
  into the completion month's delta fields (`:347`) and discarded. No per-row tier column exists
  in `WorldSeriesData` (`score/types.ts:96-133`).
- **V** What `tiersOf` needs: the schedule's `kind`, `funding.programmes`, `origin`, `projectId`
  and last revision's units, and a `TierCtx` (`affordable` map from the dataset's projects,
  `programmes`, `terms`; `finance-score.ts:53-62`). A funded row uses the context of its award
  month (`series.ts:322-326`). The three cases (`finance-score.ts:217-230`): funded affordable by
  programme shares; any other simulated project `inclusionaryUnits(u)` with the rest above
  moderate; a pipeline project `unrecorded = min(affordable homes recorded, u)`, the rest above
  moderate.
- **V** Tiers are filed only when the tier table exists (`series.ts:554`), which needs finance
  in some frame of the window (`score/statics.ts:82`, `:195`).
- **V** A chunk's `tiers` is null whenever the runner's `MoneyFeed` is null (`chunk.ts:23-25`),
  and that is whenever the plan's `frameAt(1).finance` is null or has no pools
  (`runner.ts:757-758`, `:787-788`).
- **V** Tiers are gross per project; existing homes come off `aboveModerate` at the construction
  start (`series.ts:508`), "so `aboveModerate` can be negative in a month"
  (`docs/dev/finance-score.md:73-75`, testimony).

---

## (c) The score series

### Stages

**V** `STAGE_ORDER` (`src/lib/timelapse/types.ts:24-32`): `preApplication`, `filed`, `entitled`,
`permitFiled`, `permitIssued`, `construction`, `complete`. `permitOnly` projects skip `filed` and
`entitled` (`:44-49`). The in-progress stages are the six other than `complete`
(`series.ts:25`).

### Per month, the plan's world: `MonthRow`

`MonthRow = TimelineScore['shown'][number]` (`score/types.ts:13`; `scenario/types.ts:313-320`),
built by `rowAt` (`series.ts:580-594`), **V**:

| Field | As written | How filed |
| --- | --- | --- |
| `completedNet` | "cumulative since asOf, simulation only, excludes baseline" | `pipeline + fresh` (`series.ts:587`) |
| `completedNetPipeline` | | `+units` at completion of a non-simulated row (`:542`); `-existing` at its construction start after `asOf` (`:507`) |
| `completedNetNew` | | the same for `ORIGIN_SIM` rows (`:507`, `:542`) |
| `entitledNew` | "cumulative net units of new (simulated) projects reaching entitled" | `units - existing` on a simulated row's entitled day after `asOf` (`:503-505`), adjusted by a revision on that day (`:526`) |
| `inProgress` | "current proposed units of projects in each stage at that month": `Record<Exclude<Stage, 'complete'>, number>` | open and close deltas per stage (`:279-302`); a master's unfiled phase units count in its stage, up to `entitled` (`:353-359`) |
| `exitedUnits` | "cumulative" | units of a row that exits after `asOf` (`:556`); a master's total phase units (`:367-370`) |

**V** Each value is the state at the end of calendar month i (`scenario/types.ts:312`). Deltas
after the horizon are dropped (`series.ts:274-276`).

### Per month, plan minus twin: `PlanRow`

**V** `{ entitledNew: number; completedNetNew: number }` (`score/types.ts:15-18`), each the
plan's row minus the twin's (`chunk.ts:29-32`).

### Per month, money: `MoneyRow`

`score/types.ts:21-51`, **V**:

```ts
pools: { id; label; kind: PoolKind; received; committed; out; spent; repaid; lost; lostCredit;
         closed?: Day | null; shut?: boolean }[];
fundedHomes: number;
displacedHomes: number;           // homes in 'displaced' events by each event's own day
displacedHomesCompleted: number;  // displaced homes of funded projects completed by this month
publicSpent: number;
```

**V** `fundedHomes` is `units - existing` of funded rows at completion (`series.ts:544-545`).
`publicSpent` is `spent + lostCredit` over every pool (`score/money.ts:51-52`). The pool figures
are dollars.

### Per month, tiers

**V** `TierUnits = Record<IncomeTier, number> & { unrecorded: number }`, tiers `veryLow`, `low`,
`moderate`, `aboveModerate` (`timelapse/types.ts:185-193`). Cumulative per month
(`series.ts:648-663`). "each month's five tiers sum to that world's `completedNet`"
(`docs/dev/world-score.md:59`, testimony; not checked in code).

### The chunk, the statics and the view

**V** `SeriesChunk` (`score/types.ts:78-86`): `{ from: number; rows: MonthRow[]; planEffect: PlanRow[]; money: MoneyRow[] | null; tiers: TierUnits[] | null }`.

**V** `ScoreStatics` (`score/types.ts:154-168`): `asOf`, `months: Day[]` (first day of each
calendar month from the dataset date's month), `lastIndex`, `baseline` (`rhnaCompletedNet`),
`tierBaseline: TierUnits | null`, `phasing`, `references`, `compare: 'plan' | 'preFzp'`,
`limits`, `debts`.

**V** `TimelineView` (`score/types.ts:171-186`), made on the page by `viewOf(chunks, statics)`
(`score/view.ts:97-135`): `months`, `lastIndex`, `filledThrough`, `rows`, `planEffect`,
`targets`, `tierTargets`, `money: MoneyView | null`, `tiers`, `baseline`, `phasing`,
`references`, `compare`. `MoneyView` (`score/types.ts:57-75`) is `TimelineScore['money']`
(per-pool arrays, `fundedHomes[]`, `displacedHomes[]`, `publicSpent[]`, `owed`, `limits`;
`scenario/types.ts:349-367`) plus `displacedHomesCompleted[]`, `perAddedHome`, `displacedShare`,
their `ByMonth` series, `closed` and `shut`.

**V** The worker's own per-month layout (`series.ts:35-51`): `PIPELINE`, `FRESH`,
`ENTITLED_NEW`, `EXITED`, six stage fields, `FUNDED`, `DISPLACED`, `DISPLACED_DONE`, five tier
fields. **I** That is 18 fields a month.

### The twin

- **V** The comparison ensemble keeps a full `WorldSeries` of its own with its own statics
  (`runner.ts:728-736`, `:772-784`; `ensemble.ts:19`, `:145-146`). Its `rows(from, through)`
  give the same `MonthRow` fields (`series.ts:624-630`).
- **V** `chunkOf` reads the twin's rows only to subtract two fields (`chunk.ts:28-32`). Money and
  tiers are the plan's (`chunk.ts:21-25`). The twin's rows are never posted.
- **V** What the twin runs: "with nothing in force, the same document on the zoning before the
  plan; otherwise the default document on the plan" (`policy/compare.ts:39-44`). The default
  document is what `level2-check` calls current law (`scripts/level2-check.ts:1-3`, `:158`).
- **I** So, on the page:
  - With nothing in force, the plan is current law and `rows[i].completedNet` is the total
    completed under current law.
  - With a policy in force, the twin is current law, and only its new-project completions can be
    derived: `rows[i].completedNetNew - planEffect[i].completedNetNew`. Its
    `completedNetPipeline`, `completedNet`, `inProgress`, `exitedUnits`, tiers and money are not
    available. The plan's pipeline figure is not a proven stand-in: `speedOf` applies
    `frame.speed` to every row and `speedNew` to rows not yet filed
    (`src/lib/sim/world/stage.ts:36-42`). Whether a player's permitting policy sets either for
    pipeline rows was not read (`policy/compile.ts`).
- **V** A total of homes completed by month under current law exists in the worker in both
  cases (the series of whichever side runs the default document), and is sent only in the first.

---

## (d) The funding line

### Structure

`FundLine` (`src/lib/sim/world/funding/columns.ts:13-60`), held as `World.line`
(`world/types.ts:138`), **V**. Per row: `lot`, `kind` (0 market, 1 affordable; `:7-8`), `month`
(model month applied), `applied` (day), `keyDay`, `key`, `bundle` (programme ids joined with
`,`), `f`, `units`, `stories`, `level`, `viewMonth`, `gone` (1 = removed this step), `seq`.
Scalars: `n`, `nextSeq`, `version`, `appliedThrough`. Side tables: spells (`spellLot`,
`spellKind`, `spellK`, `spellR`) and shadows (`shadowLot`, `shadowRow`, `shadowK`, `shadowR`,
`shadowExisting`, `shadowMonth`).

What the docs say of it (testimony):

- "Line rows (one per waiting application, in line order)" (`docs/dev/world-funding.md:38`).
- "The line holds the applications waiting for money, across all lots and both kinds"
  (`docs/dev/finance-engine.md:123`); a lot can have two applications, one per kind (`:138`).
- "An application is not a project row: only an award starts a row and sends one `'award'`"
  (`docs/dev/world-score.md:123`).
- `gone` rows "may survive a step on a long line; every reader skips them"
  (`docs/dev/world-funding.md:136-138`).
- A lot no longer free "has its rows dropped only when one of them would be awarded"
  (`docs/dev/world-funding.md:112-114`).
- The line is served once a month (`docs/dev/world-funding.md:81-86`).
- An application can wait to the horizon on a spent pool (`docs/dev/finance-engine.md:242-253`);
  in the step engine a spent pool that has had its last arrival is closed instead and its
  waiting rows are re-made or lapse (`docs/dev/world-funding.md:143`, `:185-186`; lines 141-215
  seen only through a grep).

### Is the number waiting recorded or sent?

- **V** No. A grep of `src/` and `scripts/` for `fundOf(`, `world.line`, `FundLine` outside
  `funding/`, tests and specs finds one reader, `score/money.ts:42`, and it reads
  `fundOf(feed.world).pools` (the shut rows), not the line.
- **V** The series has no field for waiting applications or homes (`series.ts:35-51`).
- **V** No event marks an application joining, leaving or lapsing; of the funding side only
  `'award'` and `'displaced'` are events (`world/types.ts:143-150`; `'award'` sent at
  `funding/serve.ts:249`, `'displaced'` at `world/world.ts:464`).
- **V** No message carries the line (`timeline-protocol.ts:127-147`).
- **I** The line is state of the world at the month it has stepped to. With one copy at month 0
  (`ensemble.ts:23`), the line at an earlier month is gone once the world steps on.
- **V** What is sent about money running short: per pool per month `committed`, `closed` and
  `shut` (`score/types.ts:22-40`).
- **I** `units` per row would give homes waiting, with three cautions from the points above:
  skip `gone` rows, a lot may hold two rows, and rows of lots that started another way can linger.
- The design doc agrees: "Homes waiting for money are in the funding line and have to be added
  to the series" (`docs/superpowers/specs/2026-11-24-incremental-feel-design.html:214`).

---

## (e) The policy mark's rule

`slotFlags(world, statics, row, src): number` (`src/lib/sim/world/runner/flags.ts:40-65`), **V**.
`SLOT_FLAG = { zoning: 1, money: 2 }` (`src/lib/map/types.ts:47`).

1. A master row gives 0 (`:43`).
2. `first` = the earliest entered stage day of the row. None entered gives 0 (`:44-49`).
3. `frame = src.frameAt(max(1, monthOfDay(asOf, first)))`: the plan's frame of the model month of
   that first day (`:50`).
4. **zoning** bit: `origin === ORIGIN_SIM` and `limitsAt(frame, p.src[row]).owner.kind !== 'fzp'`
   (`:52-54`). The owner kinds are `'fzp'`, `'paint'`, `'rule'`
   (`src/lib/sim/world/policy/limits.ts:24-29`).
5. **money** bit: `p.funded[row] === 1`, `frame.finance !== null`, `p.programmes[row] !== ''`,
   and some id in `programmes[row]` names, in that frame's `finance.programmes`, a programme
   whose pool id is not in `src.basePools` (`:55-63`).

Wiring, **V** (`runner.ts:1259-1271`): `basePools` is the ids of `ds.loaded.fzp.finance?.pools`,
taken once per `open`; `frameAt` is the plan side's timeline in use; 0 before it has a timeline.

Where the bits go, **V**: `TimedPackedCell.slotFlags` (`map-stream.ts:266`, `:296`) and
`CityDelta.flags` (`city-feed.ts:110`). They are part of a row's sent key (`map-stream.ts:215-224`).

What sets no bit, **I** from the rule: a permitting change; any pipeline or phase row for
zoning; a funded row paid only through baseline pools.

The doc's reading (`docs/dev/map-interfaces.md:119-122`, testimony): the zoning bit
"over-counts (some would have started under current law) and never means 'because of'"; "The
bits do not sum to '+N from your policy'".

The drawing rule (`docs/dev/map-interfaces.md:126-128`, testimony; `halos.ts` not read): one
diamond per slot with a `SLOT_FLAG` bit and a first stage day after `from`, where the page
passes the dataset date.

---

## (f) `src/lib/goal`

All in `src/lib/goal/goal.ts`, **V**.

```ts
export const TODAY = -1;                                             // :16
export interface GoalMeasure {                                       // :18-28
  id: 'homesCompleted'; unit: string;
  valueAt(view: TimelineView, i: number): number;
}
export interface Goal {                                              // :30-39
  id: string; name: string; measure: GoalMeasure;
  amount: number; deadline: Day; countsFrom: Day;
}
export type GoalBase = Omit<Goal, 'deadline'>;                       // :51
```

- Measure: `HOMES_COMPLETED.valueAt = view.baseline.completedNet + (i === TODAY ? 0 : view.rows[i].completedNet)` (`:42-46`).
- Amount: `RHNA_UNITS = M1_TARGETS.find((t) => t.id === 'rhna')!.units` (`:48`), 82,069 in
  `src/lib/scoreboard/targets.ts:12` (seen by grep).
- `GOAL_BASE = { id: 'goal', name: 'Goal', measure: HOMES_COMPLETED, amount: RHNA_UNITS, countsFrom: dayFromUtc(2022, 6, 30) }` (`:54-60`).
- Deadline: `defaultGoal(asOf: Day): Goal` returns `{ ...GOAL_BASE, deadline: windowHorizon(asOf, WINDOW_MONTHS) }` (`:63-65`).
  `windowHorizon(asOf: Day, windowMonths: number): Day` is "the last day of the last calendar
  month whose last day is at or before `monthLastDay(asOf, windowMonths)`"
  (`src/lib/sim/world/months.ts:30-40`).
- The deadline is read by its calendar month: `readMonth` uses
  `monthOffset(goal.deadline, view.months[0])` and reads month `min(i, deadline, view.lastIndex)`,
  or `TODAY` when the deadline is before `months[0]` (`:77-88`).

Signatures that take a goal:

```ts
defaultGoal(asOf: Day): Goal
readGoal(goal: Goal, view: TimelineView, i: number): GoalReading | null
  // GoalReading = { fraction: number; reachedOn: Day | null }  (:67-74)
goalText(r: GoalReading): string
goalAmountName(goal: GoalBase): string
goalName(goal: Goal): string
goalStep(goal: Goal, view: TimelineView): { deadlineIndex: number; units: number } | null
bufferAmount(goal: GoalBase): number
goalRowNote(goal: Goal, index: number, deadlineIndex: number | null, atToday: boolean): string | null
goalRows(goal: Goal, view: TimelineView, at: { index: number; atToday: boolean }, reachedMonth: number): GoalRowData[] | null
goalTrackMax(rows: readonly GoalRowData[]): number
capacityRows(net: number, goal: GoalBase = GOAL_BASE): GoalRowData[]
```

A goal with another deadline:

- **V** `Goal` is a plain object, so `{ ...GOAL_BASE, deadline: d }` or
  `{ ...defaultGoal(asOf), deadline: d }` is one. `readLevel2` builds a variant the same way for
  the amount (`scripts/level2-check.ts:232-233`).
- **V** `windowHorizon(asOf, k)` gives the horizon of a k-month window (`months.ts:34-40`).
- **V** `readGoal` returns `reachedOn` only for months up to the deadline's month (`:91-103`),
  and `goalStep` returns null when the deadline's month is outside `[0, view.lastIndex]` (`:132`).
- **V** `TimelineMode` takes a goal through a test seam, else builds
  `goalAmount !== null ? { ...defaultGoal(asOf), amount: goalAmount } : defaultGoal(asOf)`
  (`src/lib/timeline/TimelineMode.svelte:402-409`). It has no deadline prop other than the seam.

The e2e amount override:

- **V** `E2E_GOAL_KEY = 'sfhousing:e2e:goal'`; `e2eGoalAmount(storage: Storage | null): number | null`
  returns the stored value only when `import.meta.env.VITE_E2E === '1'`, the value is all digits
  and a safe integer >= 1 (`src/lib/game/e2e.ts:2`, `:15-27`).
- **V** Read at `src/lib/sim-page/SimPage.svelte:219` and passed on as `goalAmount` (`:1273`);
  also at `src/lib/sim-page/SimRoute.svelte:61`.
- **V** (grep hit) Set by `e2e/helpers/game.ts:97`; `docs/dev/game.md:292` names the helper
  `seedGoalAmount(page, amount)`.
- **V** It overrides the amount only; the deadline stays `defaultGoal`'s
  (`TimelineMode.svelte:406-409`).

`GoalRow.svelte` (`src/lib/goal/GoalRow.svelte:11-16`) renders one `GoalRowData` with props
`row`, `max`, `primary`. **V**

---

## (g) `scripts/level2-check.ts`

**V** throughout (`scripts/level2-check.ts`).

- Usage: `npx tsx scripts/level2-check.ts <datasetDir> [--amount <homes>]` (`:1`, `:269-290`).
- Inputs: a built dataset directory holding `manifest.json` (`:49-55`) and the files the manifest
  names, served from disk as `/data/<datasetVersion>/<path>` (`:58-90`); optionally a positive
  integer `--amount`.
- What it runs (`runEmptyDocument`, `:131-220`):
  1. `loadScenario` to get `calibration` and `asOf` (`:151-157`).
  2. `policy = reconcilePolicy4(DEFAULT_POLICY4, calibration, asOf).doc` (`:158`).
  3. `createTimelineHost` with real timers (`:190-199`).
  4. `openTimeline { rev: 1, manifest, policy, lots: {}, months: WINDOW_MONTHS }`, then
     `prefetch` of the bbox of every chunk (`:201-209`).
  5. Keeps `compiled.statics` and every `filled.series` at rev 1; when
     `through === statics.lastIndex` it resolves `viewOf(chunks, statics)` (`:169-183`). `cells`
     and all else are dropped (`:184`).
  6. Fails on any `error` message (`:171`) or after `DEFAULT_TIMEOUT_MS = 600_000` (`:43`, `:186-189`).
- What it reads (`readLevel2`, `:230-247`): `defaultGoal(run.asOf)` with `amount` replaced when
  given; `readGoal(goal, view, view.lastIndex)`; `homesAtDeadline = goal.measure.valueAt(view, d)`
  at the deadline's month; `marginMonths` = calendar months from `reachedOn` to the deadline.
- Prints three lines on stdout (`level2Lines`, `:252-261`):
  - `Dataset <datasetVersion>`
  - `Goal: <amount> homes by <Mon YYYY>`
  - `Reached: <Mon YYYY>, <n> month(s) before the window's end` or
    `Missed: <homes> homes by <Mon YYYY>, <short> short`
- Exit: 0 reached, 1 missed (`:264-266`), 2 when it could not run, with one stderr line
  `level2-check: <reason>` (`:292-308`).
- Exports: `runEmptyDocument(dir, opts?)`, `readLevel2(run, amount?)`, `level2Lines(r)`,
  `level2Exit(r)`, types `EmptyRun` (`{ datasetVersion, asOf, view: TimelineView }`) and
  `Level2Result` (`:24-41`).

`scripts/ensemble-measure.ts` (read in part): a measurement script with cases `ensemble`,
`replan`, `compile`, `first`, `flush`, `flush-warm`, `sizes`, `resume`, `host`
(`scripts/ensemble-measure.ts:1-20`), default `--months 480` and `--worlds 1` (`:1421-1422`),
printing one JSON object (`:1490`). **V** Its `host` case opens the default document with every
chunk wanted and reports `firstCellsMs`, `firstFilledMs`,
`fillFromFirstCompilingToLastFilledMs`, `editSettledMs` and the tasks over 50 ms
(`:1262-1404`). **V**

---

## (h) Timings on record, and the window

### The window

- **V** `WINDOW_MONTHS = 480`, "The window, in model months (40 years)"
  (`src/lib/sim/timeline-client.ts:28-29`).
- **V** A model month is 30.436875 days (`MONTH_DAYS`, `src/lib/timelapse/time.ts:10`; month m
  covers `asOf + floor((m - 1) × 30.436875) + 1` to `asOf + floor(m × 30.436875)`,
  `src/lib/sim/world/months.ts:9-17`).
- **V** The series are by calendar month: `months` runs from the dataset date's month to the last
  calendar month whose last day is at or before the last day of model month `windowMonths`
  (`score/statics.ts:171-193`). The count of calendar months was not computed.

### Filling the window

All figures are testimony. None was re-measured.

`docs/dev/ensemble-runner.md:127-159`: taken 2026-11-10 "with 48 + 48 worlds; `/sim` now steps
one world per side. The figures below are that run's." Live dataset 2026-11-10-6ee5a23d (155,020
parcels, 8 baseline pools), Apple M5 Pro, Node 24.2, quiet.

| Figure | Bar | Host under Vitest | Host bundled |
| --- | --- | --- | --- |
| First `cells` / first `filled` | 3,000 ms | 1,003.8 / 2,471.1 ms | 963.1 to 964.0 / 2,123.5 to 2,128.8 ms |
| Whole-window fill, first unit to last `filled`, less compiles | 4,320 ms | 4,011.7 ms | 3,798.6 to 3,841.9 ms (from the first `compiling`) |
| Fill per month, median | 9 ms | 8.4 ms whole-window mean (5.6 in slices) | |
| Edit (metro rule from month 120) settled | | 3,914.8 ms | 2,973.2 to 2,997.2 ms |
| `resyncMap` snapshot, warm (after the fill / after the edit) | none | 9.1 / 11.1 ms | |
| `chunkOf`, max | | 2.5 ms | |

The same table's "Task 1 (bundled)" column, a prototype and not the host, gives the cold
`resyncMap` snapshot (fresh stream and memo) as 1,166 to 1,182 ms.

After warming per (row, revision) (`ensemble-runner.md:159`): first `cells` / first `filled`
1,031.2 / 2,523.9 ms under Vitest, 939.0 to 1,012.0 / 2,083.2 to 2,207.9 ms bundled; fill
4,067.3 ms (Vitest), 3,720.5 to 3,818.7 ms bundled.

`docs/dev/timeline-ui.md:121-134` (outside my scope list, read in part): Apple M5 Pro,
2026-11-14, live city, cold cache, median of 3.

| Measure | Value |
| --- | --- |
| Live city, empty document: first results / whole window | 1.83 s / 3.21 s |
| Live city, painted document: first results (stripped open) / full document first results and whole window | 1.96 s / 3.66 s |
| Apply a `cells` update, 22 cells (install only / with demolish) | 155 ms / 161 ms |
| Apply a `cells` update, 121 cells | 889 ms / 1,002 ms |

Others:

- `docs/dev/map-stream.md:51-54`: live, 124 cells, total packing 1.37 s, p95 flush 3.8 ms, p95
  22 cells per update; longest flush 631 ms (month 9); snapshot cold 1,165 ms, warm 6.3 ms.
- `docs/dev/world-score.md:115`: `chunkOf` median 0.728 ms per month unfunded (96 worlds), 0.767
  to 0.771 ms funded (32 worlds). `:117`: `viewOf` over a full window in 480 one-month chunks,
  median 0.208 ms per call.
- `docs/dev/world-core.md:205-211`: live `createWorld` + `planDue` to 480, 2.6 ms; live, 48
  worlds, one month, median 0.35 ms.
- `docs/dev/ensemble-runner.md:163-166`: heap 427.7 MB live set, 546.2 MB with the month-0 copy;
  one cold massing about 636 ms.
- The design doc's "waits about 2 to 4 seconds for 'Updating'" is marked an estimate
  (`docs/superpowers/specs/2026-11-24-incremental-feel-design.html:68`).
- No phone timing was found in the files I read.

### Constants in code

**V**: `COMPILE_STEP_MS = 20`, `FLUSH_EVERY_MS = 250`, `FLUSH_BUDGET_MS = 20`
(`runner.ts:101-106`); `SLICE_PLAN_MS = SLICE_MS - 5` (`src/lib/sim/scenario/scenario-host.ts:243`,
grep hit; the doc says 45 ms, `ensemble-runner.md:30`; `SLICE_MS` not read); `MASSING_CAP = 60_000`
(`map-stream.ts:66`). Perf bars in `src/lib/sim/world/host.perf.spec.ts:54-59` (grep hits):
`SLICE_BAR_MS = 50`, `FIRST_BAR_MS = 3000`, `MONTH_BAR_MS = 9`, `MONTHS = 480`.

---

## (i) The page's lookup APIs

### `TimelineClient` (`src/lib/sim/timeline-client.ts`), **V**

| Method | Returns | Lines |
| --- | --- | --- |
| `open(manifest: Manifest, policy: SimPolicy4, lots: Record<string, ParcelId[]>)` | `Rev` | 119-124 |
| `setPolicy(policy: SimPolicy4, lots: Record<string, ParcelId[]>)` | `Rev` (throws before `open`) | 127-135 |
| `viewMonth(month: number)` | `void` | 138-140 |
| `resyncMap()` | `void` | 143-145 |
| `prefetch(bbox: BBox)` | `void` | 147-149 |
| `retryChunks()` | `void` | 151-153 |
| `parcelSummary(parcelId: ParcelId, day: Day, projectId?: string)` | `Promise<ParcelSummary \| null>` | 155-157 |
| `resolveBrush(query: BrushQuery)` | `Promise<BrushLotsResult>` | 159-161 |
| `lotOutlines(lots: ParcelId[])` | `Promise<LotOutlinesResult>` | 163-165 |
| `lotAt(point: [number, number])` | `Promise<LotAtResult>` | 167-169 |
| `previewBuildings(lots: ParcelId[], stories: number)` | `Promise<PreviewResult>` | 171-173 |
| `heightLids(bbox: [number, number, number, number])` | `Promise<HeightLidsResult>` | 175-177 |
| `brushCatalog()` | `Promise<BrushCatalog \| null>` | 179-181 |
| `restart(worker)`, `dispose()` | `void` | 187-202 |

The promises live in `LookupRequests` (`src/lib/sim/lookup-requests.ts:28-190`); every pending one
resolves null or `no-session` when the session ends (`:173-189`). **V**

Result shapes, **V** (`scenario/types.ts:182-218`):

- `BrushLotsResult`: `{ ok: true; lots: ParcelId[]; points: Float64Array }` or
  `{ ok: false; reason: 'no-session' | 'data-missing' | 'bad-request'; message }`.
- `LotOutlinesResult`: `LotOutlines & { ok: true; missing: number }` or `no-session`.
- `LotAtResult`: `{ ok: true; parcelId: ParcelId | null; owner: LimitOwner | null }` or `no-session`.
- `PreviewResult`: `{ ok: true; pack: PackedCell | null; built: number; missing: number }` or `no-session`.
- `HeightLidsResult`: `{ ok: true; lids: HeightLids; missing: number }` or
  `{ ok: false; reason: 'no-session' | 'superseded' | 'too-large'; message }`.

### `parcelSummary` and `cardAt`

```ts
cardAt(world: World, statics: Statics, frame: PolicyFrame, deps: CardDeps,
       parcelId: ParcelId, day: Day, projectId?: string
): { summary: ParcelSummary; lookups: Lookups | null }      // score/card.ts:97-105
```

- **V** Worker-side only. The host calls it for `parcelSummary` and puts `lookups` on the
  summary (`world/host.ts:315-335`).
- **V** It reads "The plan's world as it stands" with the requested day clamped to the last day
  stepped, and the frame of the model month holding it (`runner.ts:1362-1370`).
- **V** Null when the lot's chunk record is not loaded or no world exists yet
  (`world/host.ts:321-323`); a throw also gives null (`:371-378`).
- **V** The project is chosen from the schedules on that lot read on `day`
  (`score/card.ts:57-75`, `:139`).

`ParcelSummary` (`src/lib/sim/protocol.ts:78-98`), **V**: `parcelId`, `neighborhood`, `landUse`,
`eligible`, `underwater?`, `existingUnits`, `envelope`, `generated`, `project?: ProjectCard`,
`limits?: LotLimits`, `lookups?: Lookups`.

`ProjectCard` (`scenario/types.ts:279-308`), **V**: `projectId`, `origin`, `label`, `pathway`,
`units`, `existingUnits`, `stories`, `storiesTier`, `massing`, `multiPhase`, `phase`, `kind?`,
`funding?: { programmes: string[]; certain: boolean }`, `localProgram`, `lookups`, `chanceShift`,
`stages: { stage; day; actual }[]` ("only stages entered <= day"), `revisions`, `end`
("null if the end is after day"), `sources`, `quality`. No tiers.

### What there is not

**V** (from the request union, `timeline-protocol.ts:100-125`): no lookup by project row or
project id alone, no lookup returning tiers, no lookup of the funding line, no request for the
twin's rows. The series the page reads is what it has kept from `filled`.

### The Paint editor's client

**V** `SimClient` (`src/lib/sim/client.ts:110-130`): `parcelSummary(parcelId): Promise<ParcelSummary | null>`
and `heightLots(outlineOf: number | null): Promise<HeightLotsResult | null>`.

---

## (j) Playback position and engine output

- **V** The worker fills the whole window regardless of the playhead. An ensemble offers a step
  while `month < months` and the next frame is ready (`ensemble.ts:168-175`); the runner picks
  units by which side is behind (`runner.ts:399-415`). Nothing in `pick` reads `view`.
- **V** `viewMonth` stores the month, posts `lookups` if the permitting in view changed, and
  queues a height build (`runner.ts:1310-1316`, `:827-848`, `:908-918`).
- **V** Results are posted as they become final: at most one `filled` per slice, for the months
  final in both ensembles and not yet posted (`runner.ts:810-822`). A calendar month is final
  once the model month holding its last day has been stepped (`series.ts:560-566`,
  `score/statics.ts:220-225`).
- **V** The page applies `compiled`, `filled` and `refill` in arrival order to a `ChunkLog` and
  reads a view from it (`src/lib/timeline/session.svelte.ts:1-7`, `:205-207`, `:638`). It sends
  `viewMonth` when the playhead's model month changes (`:322-327`). `chunk-log.ts` not read.
- Playback can catch the fill: "'Updating' shows ... while Play waits at the computed edge for
  the forecast" (`docs/dev/timeline-ui.md:39`, testimony).
- **V** The map gets each project's schedule as known at the fill edge, with stage days that may
  be ahead of the playhead (`map-stream.ts:338`, `:362`); the page hides what the clock has not
  reached (`docs/dev/map-stream.md:35`, testimony).

Computed on demand or tied to the playhead, **V**:

| What | When | Where |
| --- | --- | --- |
| `lookups` (permitting tables) | the frame at the last `viewMonth` has different permitting objects; once after each accepted edit | `runner.ts:827-848`, `:620` |
| `heights` (city build) | the zoning or limit attribution at the last `viewMonth` changed | `runner.ts:908-918`, `:966-1000` |
| `heightLids` | on request, for a bbox | `runner.ts:1317-1331` |
| `parcelSummary` | on request, for a lot and day | `world/host.ts:315-335` |
| Map cells | only for loaded chunks; chunks load for wanted cells | `map-stream.ts:198-203`, `world/host.ts:429-435` |
| Massings | per project revision, warmed before a flush or made in it | `runner.ts:349-357`, `map-stream.ts:280-294` |
| Brush lots, outlines, previews, `lotAt` | on request | `world/host.ts:380-411` |

An edit, **V**:

- While an edit compiles nothing steps (`runner.ts:27-31`, `:1163`).
- On acceptance each side either keeps its world (first difference after the last month stepped)
  or restores (`runner.ts:628-656`).
- A restore starts from the last copy at or before m - 1 and re-steps quietly to m - 1
  (`ensemble.ts:298-329`). With `COPY_MONTHS = [0]` that copy is month 0 (`ensemble.ts:23`).
- The page is told by `refill { from }`, which withdraws every calendar month from `from`
  (`runner.ts:688-700`).
- **I** So an edit dated at month m re-runs the plan's world from month 0, quietly before m and
  posting from m.

One world per side, **V**: the worker holds the plan's world and the comparison's, each at the
month it has stepped to, plus the month-0 copy. There is no per-month world to read back; a read
"on day D" is the current world filtered to facts dated at or before D (`read.ts:25-33`, `:46-62`).

---

## Where docs and code disagree, or a doc describes another engine

1. **The city feed's purpose.** Code comment: the markers are "for the page's citywide rings and
   edge glows" (`src/lib/sim/world/city-feed.ts:1-2`). Docs: "The page reads it for Activity and
   the controller for its debug counts; no layer draws it" (`docs/dev/map-stream.md:29`), and the
   halo layer "once drew rings too" (`docs/dev/map-interfaces.md:126`). The layer code was not read.
2. **Funded card fields.** `docs/dev/world-score.md:5` and `:121` say "the funded card fields are
   not built". The types have them: `ProjectCard.kind?` and `funding?`, "copied from the schedule"
   (`scenario/types.ts:291-294`), and `scheduleAt` fills `Schedule.funding`
   (`world/read.ts:80-91`). Whether `projectCard` copies them (`src/lib/sim/scenario/card.ts`)
   was not read, so this is unresolved.
3. **Which runs carry tiers.** `docs/dev/finance-score.md:283-287` says the twin has no tiers and
   names `shownRun` and `simulateNet`: that is the older scenario host. In the step engine each
   ensemble's series files tiers when its tier table exists (`series.ts:554`), and only the
   plan's are sent (`chunk.ts:21-25`), as `docs/dev/world-score.md:59` says.
4. **Displaced homes.** `docs/dev/finance-score.md:156-164` describes both rules and says its
   text below that point is the old `shownSeries`. Code for the step engine: on the event's own
   day (`series.ts:451-462`).
5. **Timings.** The tables in `docs/dev/ensemble-runner.md` were taken with 48 + 48 worlds; the
   code runs 1 + 1 (`ensemble.ts:26`, `runner.ts:728-736`). The doc says so itself (`:129`).
6. **Design doc against code.** "Homes in each stage are in the series today" (design `:214`):
   yes, `inProgress`, in units of homes, gross. "The engine already splits a completing
   project's homes by tier (`tiersOf`)" (design `:232`): yes inside the worker, summed by month,
   not kept or sent per project, and only when the window has finance.

No disagreement found between `timeline-protocol.ts` and the message list in
`docs/dev/ensemble-runner.md:22`.

---

## Appendix: what was and was not examined

### Read in full

- `docs/superpowers/specs/2026-11-24-incremental-feel-design.html`
- `src/lib/sim/timeline-protocol.ts`, `timeline-client.ts`, `client.ts`, `worker.ts`, `router.ts`,
  `lookup-requests.ts`, `protocol.ts`
- `src/lib/sim/world/host.ts`, `map-stream.ts`, `city-feed.ts`, `read.ts`, `types.ts`, `stage.ts`,
  `months.ts`
- `src/lib/sim/world/runner/runner.ts`, `ensemble.ts`, `flags.ts`, `lookups.ts`, `warm.ts`,
  `dataset.ts`
- `src/lib/sim/world/score/types.ts`, `series.ts`, `chunk.ts`, `view.ts`, `card.ts`, `money.ts`,
  `statics.ts`, `index.ts`
- `src/lib/sim/world/funding/columns.ts`
- `src/lib/goal/goal.ts`, `GoalRow.svelte`
- `src/lib/game/e2e.ts`
- `scripts/level2-check.ts`
- `docs/dev/map-stream.md`, `world-score.md`, `ensemble-runner.md`, `finance-score.md`,
  `world-core.md`

### Read in part

- `src/lib/sim/host.ts`: lines 1-110 of 530 (the Paint editor's host).
- `scripts/ensemble-measure.ts`: lines 1-140 and 1250-1501 of 1,501, plus a grep of function
  names and cases.
- `docs/dev/world-funding.md`: lines 1-140 of 472; the rest only through a grep for line and
  queue terms.
- `docs/dev/finance-engine.md`: lines 119-148 and 211-305 of 780, plus a grep of headings.
- `docs/dev/map-interfaces.md`: lines 106-135, and grep hits at 136-152.
- `docs/dev/timeline-ui.md`: lines 116-135, and grep hits (25, 36, 37, 39).
- `src/lib/sim/scenario/types.ts`: lines 40-374.
- `src/lib/sim/scenario/finance-score.ts`: lines 1-235.
- `src/lib/timelapse/types.ts`: lines 8-52, 180-199.
- `src/lib/map/types.ts`: lines 28-112.
- `src/lib/timeline/session.svelte.ts`: lines 1-120, 316-345, plus a grep.
- `src/lib/timeline/activity.ts`: lines 1-110. `src/lib/timeline/playhead.ts`: lines 14-38.
- `src/lib/timeline/TimelineMode.svelte`: lines 395-414.
- `src/lib/sim/world/policy/limits.ts`: lines 20-49, plus a grep. `policy/compare.ts`: a grep of
  its comments and signatures (45 lines).
- Grep hits only: `src/lib/sim/world/columns.ts` (`revisionsOf`, `displacedOf`, `pushRev`),
  `world.ts` and `pipeline.ts` (event emit sites), `funding/serve.ts`, `apply.ts`, `system.ts`
  (line and award sites), `host.perf.spec.ts` (bar constants), `scenario/scenario-host.ts`
  (`SLICE_PLAN_MS`, `MEMO_CAP`), `levers/source.ts` (`LimitOwner`), `timelapse/time.ts`
  (`MONTH_DAYS`), `scoreboard/targets.ts` (the RHNA row), `sim-page/SimPage.svelte` and
  `SimRoute.svelte` (the e2e amount), `e2e/helpers/game.ts`, `docs/dev/game.md:292`.

### Directories listed

`src/lib/sim/`, `src/lib/sim/world/`, `src/lib/sim/world/runner/`, `src/lib/sim/world/score/`,
`src/lib/sim/world/funding/`, `src/lib/goal/`.

### In scope and NOT examined

- Every spec and test helper under `src/lib/sim/world/runner/` (`ensemble.spec.ts`,
  `flags.spec.ts`, `lookups.spec.ts`, `dataset.spec.ts`, `warm.spec.ts`, `test/harness.ts`) and
  under `src/lib/sim/world/score/` (all `*.spec.ts`, `test/feed.ts`).
- `src/lib/goal/goal.spec.ts`, `src/lib/goal/GoalRow.svelte.spec.ts`.
- `src/lib/sim/host.ts` lines 111-530.
- `scripts/ensemble-measure.ts` lines 141-1249 (the `ensemble`, `replan`, `compile`, `first`,
  `flush`, `sizes`, `resume` cases).
- `docs/dev/finance-engine.md` outside the two ranges above; `docs/dev/world-funding.md` lines
  141-472 (pool closing, cost, tolerance referee, known differences).

### Out of scope, relied on by name only, NOT read

- `src/lib/map/pack-timed.ts` (how the slot arrays are written), `src/lib/map/timelapse/city.ts`
  (`CityStore`), `halos.ts`, `halo-layer.ts`.
- `src/lib/sim/scenario/card.ts` (`projectCard`, `chooseProject`), `scenario/score.ts`
  (`targetsOf`, `monthsOf`), `scenario/massing.ts`.
- `src/lib/sim/levers/apply.ts` (`LeverLookups`, `Lookups`), `levers/resolve.ts`
  (`LeverCapacity`): the shapes of `compiled.capacity` and `lookups.lookups` are not reported.
- `src/lib/timeline/chunk-log.ts`, `fill.ts`; `src/lib/timeline/policy4.ts`
  (`SimPolicy4`, `DEFAULT_POLICY4`, `nothingInForce`).
- `src/lib/sim/world/world.ts`, `pipeline.ts`, `policy/compile.ts`, `policy/frame.ts`, and the
  bodies of `funding/apply.ts`, `serve.ts`, `policy.ts`, `shadow.ts`, `line-index.ts`,
  `closing.ts`.

### Not measured or counted

- Nothing was run. No timing here is mine.
- How many project rows have no T11 lot (so no marker), how many projects complete in a window,
  how many rows the funding line holds, the number of calendar months in a window: none counted.
- Whether each month's tiers sum to `completedNet` in the step engine: stated by the doc, not
  checked.
