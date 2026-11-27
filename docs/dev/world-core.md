# World core

The month-step engine's core: `src/lib/sim/world/`. A world is a set of typed columns; `step`
moves it one model month under the policy frame in force that month. No public money here: that is
`world-funding`, through the hook below. Spec:
[2026-11-13-world-core-design.md](../superpowers/specs/2026-11-13-world-core-design.md) (S1 to
S12, rules 1 to 22). Public surface: `src/lib/sim/world/index.ts`.

## The world

`World { month, frame, lots, projects, line, pools }` (`types.ts`). `month` is the last model month
stepped (0 = the dataset date), `frame` that step's `PolicyFrame.id`. Every column is a typed array
or a plain array; `structuredClone(world)` is a full copy. Model month m covers days
`asOf + floor((m - 1) × 30.436875) + 1` to `asOf + floor(m × 30.436875)` (`months.ts`:
`monthFirstDay`, `monthLastDay`, `monthOfDay`).

- **`lots`** (`LotColumns`): a row only for a lot that has left its starting state (a pipeline
  project holds it, a project started on it, or it was freed). Rows are appended in the order lots
  first leave their starting state and never move; `lot` is the row's statics row. `rowOf` is
  indexed by lot, not by row: the lot's row + 1, 0 for none (lots past its length have none), so
  `lotRow` and `ensureLot` are O(1). Within a system lots are still handled in `statics.rank` order,
  never in row order. The columns reallocate on growth: read them through `world.lots` after an
  `ensureLot`. A lot with no row is free since the dataset date on attempt 0.
- **`projects`** (`ProjectColumns`): one row per pipeline project, master, phase and start. A row
  never moves; `row` in every event indexes it. A phase gets its row when it files. Revisions and
  displaced homes live in side tables (`revN`, `dispN` are their row counts, like `n`).
- **`line`, `pools`**: `{ n: 0 }` until `world-funding` fills them. Declared in `types.ts` as:

  ```ts
  export type Column = Int32Array | Uint32Array | Uint8Array | Float64Array | number[] | string[];

  export interface LineColumns {
    n: number;
    [column: string]: Column | number;
  }

  export interface PoolColumns {
    n: number;
    [column: string]: Column | number;
  }
  ```

  `world-funding` narrows them to its own columns. Between steps a pool or programme is named by
  its id, never an index.

`createWorld(statics, timeline, seed, out)` makes month 0 under `timeline.frameAt(1)` and sends the
events already true at the dataset date (`'start'`, then each `'enter'`, with their past days).
`Statics` (`staticsOf(input)`) is what no policy changes.

## The step

`step(world, due, statics, timeline, seed, out)` steps month `world.month + 1`, reading frames up
to that month only (it asserts `readyThrough() >= month`). Systems, in order (rule 16):

1. **Policy**, when `frame.id !== world.frame`: replan free lots (below), re-anchor every live
   row whose stage speed changed (rule 12), then `policyChanged`.
2. `moneyIn`.
3. **Stages due** this month, in row order; each chain is followed to the month's end (rule 14).
4. **Lots due** (taken plus those system 3 freed), in `statics.rank` order: those whose `planLot`
   is this month go to `apply`; those whose ordinary start falls this month are set aside; the rest
   are planned again after `apply`.
5. `serve`.
6. **Starts**: each lot set aside that nothing started on this month starts (`startProject`).
7. `shadow`.

Then `world.month += 1`, `world.frame = frame.id`. Without a funding system, or in a month whose
`frame.finance` is null, systems 2, 5 and 7 and every hook call are skipped.

At a start the route shares (`newCalibration`), Local Program (`frame.view.parcels.localProgram`)
and size come from the frame of the model month holding the lot-month's first day, not the start
day's. Stage outcomes and lengths are drawn on the step's frame: `newCalibration` for a project not
filed at the dataset date, `calibration` otherwise.

Pipeline phases filed after the dataset date take their caps and existing homes from month 1's view
(`world.ts:228`, `pipeline.ts:395-404`), not the view in force when they file; dated regimes reach
only simulated projects.

**Speed.** A stage's scale is `speed` times each `speedNew` entry that reaches the project, clamped
to `[MIN_SCALE, MAX_SCALE]` (`stage.ts` `speedOf`). An entry reaches it when its filing day is
`>= from`, or it has not filed. Masters and phases count as filed before the dataset date, so
`speedNew` reaches only simulated starts and pipeline rows still at `preApplication` on `asOf`.

At a speed change on day `c` (`stage.ts` `reanchor`), `used += (c - anchor) / old speed` and the
new leave is `c + floor(new speed * (length - used))`, clamped to `c`. The clamp never binds in
exact arithmetic; it guards against rounding: `used` can round one ulp past `length`, the leave
would fall in the month before, already taken, and the row would be lost.

## A free lot's start

Nothing is accumulated or stored (rule 6). `ordinaryStart` (`rates.ts`) evaluates `piecewiseMonth`
over the start rates of the frames the lot has lived through since it became free (month by month
from `timeline.changes()`, up to the month being stepped), the last continuing without end, against
the lot's `INIT` threshold on attempt k. A lot with no chance under every frame it reads is not
planned.

A frame change in month m replans (rule 7): the lots in `timeline.touched(m)`; every free lot when
`touched(m)` is null or `market` changed; and, with a funding system plugged in, every free lot
when this month's frame or last month's has `finance`. The whole-city replan is the costly month
(see Cost). Live rows whose speed changed are re-anchored on the month's first day.

## The due list

`Due { take, put, drop }`; the implementation is `DueList` (`due.ts`). An entity is a lot (its
statics row) or a project (`-1 - row`); `take(m)` returns ascending and forgets; `put` refuses a
month before 1. The due list is not part of the world. `DueList` keeps each entity's month in a
typed array (lots by lot, projects by row; 0 = none) and each month's entities in a growable
`Int32Array` bucket. Moving or dropping an entity leaves its old bucket entry behind; `take` keeps
only the entries still due that month.

- `planDue(world, statics, timeline, seed, through)` works out from scratch what is due in months
  `world.month + 1 .. through`, reading frames up to `world.month + 1`. Nothing is put past
  `through`: when the runner extends the window it calls `planDue` again. A carried list and one
  rebuilt at any month give the same events (rule 20).
- **Skip shortcut.** A lot with no row whose `INIT` draw is above
  `skipBound(statics, timeline, month, through)` starts after `through` and is not planned. Used by
  `planDue`, and by system 1's whole-city replan only when the due list is a `DueList` (it knows
  its `through`). `skipBound` is memoised per (timeline, statics, last change `<= month`,
  `through`). `planDueWith(…, { skip })` turns it off for tests.

## Readers

`scheduleAt(world, statics, row, day)` and `masterAt(…)` (`read.ts`) give a row as its
`Schedule` or `Master`, as seen on `day`: nothing dated after `day`, `end.kind` `'open'` until it
ends. A phase row read before its filing day gives null from both. `funding` comes from what
`startProject` stored.

`scheduleAt` sets `inFlight: true` on every row that runs on `calibration` (pipeline rows filed at
the dataset date, and phases) and never sets `regime`.

## The funding hook

`withFunding(f)` returns `{ createWorld, step, planDue }` with `f: FundingSystem` plugged in;
`index.ts` exports `withFunding(null)`'s. Calls (`world.ts` `withFunding` comment, `types.ts`):

| Method           | When                                                                                                                                                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create`         | End of `createWorld`, with `frameAt(1)`.                                                                                                                                                                                                                                                     |
| `policyChanged`  | System 1, after the core's replanning and re-anchoring.                                                                                                                                                                                                                                      |
| `moneyIn`        | System 2.                                                                                                                                                                                                                                                                                    |
| `onProjectEvent` | Just after each event is sent: every event of system 3; every event of systems 5 and 6 (a start and its chain to the month's end), except the `'start'` of a project the hook started itself through `ctx.startProject` (funded or not). A start the core makes inside that chain is passed. |
| `apply`          | System 4, every funded month, with the due free lots whose `planLot` is this month, in rank order.                                                                                                                                                                                           |
| `serve`          | System 5.                                                                                                                                                                                                                                                                                    |
| `shadow`         | System 7.                                                                                                                                                                                                                                                                                    |
| `planLot`        | Whenever the core plans a free lot in a funded month (in `planDue` with a context for `world.month + 1` whose `startProject` and `displace` throw), and in system 4 for each due lot.                                                                                                        |

A free lot is put at the earlier of its ordinary month and `planLot`'s answer. An answer before the
first month in which the lot can still apply (`ctx.month` before system 4, `ctx.month + 1` after)
counts as 0, as does an answer for an already-applied month.

`StepCtx.startProject(lot, day, funded)` is the one way a project begins. It throws unless the lot
has no row or is `LOT_FREE`, and throws during system 3. With `funded` null, `day` must be the lot's
ordinary start, and it returns -1 when no size level gains a home (the lot becomes `LOT_DONE`, no
row). With `funded`, `day` must fall in this month and a programme id that is empty or holds `','`
throws (ids are stored joined with `','`). `StepCtx.displace(row, lot, day, units)` throws unless
`row` is a funded start on `lot` and `day` is in this month. `StepCtx.due` is guarded: hooks cannot
`take`, nor `put` into a month already taken. A `certain` funded start advances through every
stage on `sampleAdvance` lengths with no revisions (rule 15).

## The car hook

The subsystem as a whole: [cars.md](cars.md).

`withFunding(f, cars)` also plugs in a `CarSystem` (`types.ts`; `world/cars/`, built by
`createCarSystem(data, model)`; for a loaded dataset by `carSystemOf(loaded, { off })` in
`world/cars/dataset.ts`, which the timeline host's `loadDataset` calls once per load). `createWorld` ends with `cars.create` (after `f.create`); `step`
wraps `out` once at its top, so every event of systems 1 to 7 reaches `cars.onEvent` just after it
is sent, and runs `cars.step` between systems 3 and 4 every month, funded or not. Both `step` and
`planDue` lay `cars.timelineOf` over the base timeline first and funding's view over that, so a
rebuilt plan reads what the world steps under (rule 20).

**Parking into start odds** (`world/cars/parking.ts`, owner rulings R1 and R2). The spaces table
is refreshed once in a refresh month (month 13, 25, …), at the first thing that reads it: a start
in system 3 or the car step, so every start of the month reads one table. Each refresh compares a
zone's predicted spaces per new market home with month 0's in whole steps of `SPACES_STEP` (0.01)
and, where the step count moved, records an entry `(zone, month + 1, delta)` in `CarColumns.shift*`.
`timelineOf` is then `parkingTimeline(base, …)`: from an entry's month on, the frame is the base
frame with `parking`, a `ParkingShift` (`policy/frame.ts`), and an id of its own. A lot's shift is
`lotShift`: `signedOddsShift(-delta × cost per space)` of the parking type of the prototype at the
lot's top qualifying fill level, on the frame's slope (`finance.slope`, else
`calibration.market.slope.perCostShare`). Entry months are frame changes: system 1 replans the
changed zones' lots (`touched`; the union with the base's when both change in one month), and a
funded month replans every lot as before. `ordinaryStart`, `eachFreeLot` and the funded market
clock (`ord` and `x0`) read a parked frame lot by lot through `rateOf`; `skipBound` builds its
arrays through `startRates(view, market, parking)` and drops them. Affordable odds and every price
are unchanged. With `costPerSpace` null or `{ link: false }` there are no entries and `timelineOf`
returns its argument: every event equals the run without cars (`cars.property.spec.ts`,
`parking.property.spec.ts`).

Memory: a parking state is per zone only (each zone's steps, the zones changed, a zones ×
prototypes table per slope): O(zones × refreshes) per world, asserted in `parking.property.spec.ts`.
Rates of a zone with a shift are memoised per (`view.pre`, market, zone key) over the zone's lots,
shared across worlds, and cleared when the memo holds 8 times the city's lots. `skipBound` keeps
only its two latest bounds per (timeline, statics): a funded world asks for one at every frame
change (a parking-only change no longer triggers a whole-city replan: below). Funding's
eligibility (`fundableAny` and the rowless memo's key, `funding/apply.ts` `fundingChanges`) skips changes that move neither the view nor the money, so a
parking-only change does not refill the rowless memo. Live city (155k lots, 580 zones, baseline
money, link on, 480 entries), one world at month 480: +14.7 MB with the link on against +19.0 MB
off, 2.2 s against 0.7 s for plan and 480 steps (busy machine); before these bounds the link on
held +64.1 MB and took 12 to 25 s.

Speed: a month whose frame differs from the month before only in `parking`
(`PolicyTimeline.parkingOnly`; funding's closing view keeps it when no pool opens or closes that
month) replans only `touched(month)`, the changed zones' lots, even in a funded month, and calls no
whole-city `skipBound`. Every other lot's clocks are unchanged. On the live build, `reach-check`'s
fill line (two funded worlds) takes 3.9-4.0 s with cars on, 3.5 s with the link off and 2.3 s without
cars (`docs/dev/cars.md`, Measured cost); it was 8.7 s with cars on before.

## Tests

All colocated in `src/lib/sim/world/`. Server project (signoff) unless noted.

- **Properties**: `frames.property.spec.ts` (speed and zoning changes), `due.property.spec.ts`
  (carried vs rebuilt list, window extension, `structuredClone` copies, skip shortcut, no frame
  past `readyThrough`), `order.property.spec.ts` (event order, rule 2's lot-table permutation),
  `funding-hook.spec.ts` (the hook with a stub `FundingSystem`, certain starts),
  `determinism.lint.spec.ts` (the ESLint rule covers the folder).
- **Node/browser golden**: `world.golden.test.ts` (server) and `world.golden.svelte.spec.ts`
  (client) both run `world.golden.shared.ts` against `fixtures/world-events-mini-seed1.json`.
  Regenerate deliberately, never from signoff:
  `env -C <worktree> node_modules/.bin/tsx src/lib/sim/world/fixtures/build-world-golden.ts`. A
  changed golden is an engine change to review.
- **Live city**: `SFH_WORLD_LIVE=<dataset dir>` (a directory with `manifest.json` and
  `scenarios/fzp/*`); without it, the newest non-`fixture-N` directory under `pipeline/out/`. With
  neither, the live blocks skip.
- Helpers: `test/cities.node.ts` (bench, fixture, live inputs; Node only), `test/timeline.ts`
  (hand-built timelines, `oldInputOf`), `test/run.ts` (`runWorld`, `Recorder`, `readAll`),
  `test/mini.ts`, `test/same.node.ts` (`expectEqual`: `toEqual` with Node's native deep
  comparison first; Node only).
- Whole-city loops collect mismatches and assert once (`expect({ count, first })`), and big
  comparisons use `expectEqual`: a per-item `expect`, or `toEqual` over a world's typed columns,
  is most of such a test's time.

## Cost

`world.bench.spec.ts`, perf project
(`npx vitest --run --project perf src/lib/sim/world/world.bench.spec.ts`; take the measurement
lock). Bar: 48 worlds stepping one month on the bench city without money, median at most 3 ms over
months 25 to 120. The timeline has a market change at month 72; that month replans every free lot
of every world and is printed apart. The asserted median excludes it by design: the bar is for an
ordinary month. The bench also prints the one-frame median and, with a live city, `createWorld`
plus `planDue` through month 480 for one world and one live month for 48 worlds (no bars).

Measured 2026-11-13, quiet (measurement lock held), two runs each. The bench's 48 worlds are its own set; the simulation runs one world per side.

| Case                                     | Before (Task 13)   | After (Task 14)     |
| ---------------------------------------- | ------------------ | ------------------- |
| Bar case, median / p90                   | 8.3–8.4 / 9.4–9.7  | 2.6 / 2.9–3.3 ms    |
| One frame, median / p90                  | 7.2–7.4 / 7.8–8.6  | 2.1–2.2 / 2.6–2.7   |
| Market-change month 72 (48 worlds)       | 650–654 ms         | 254–257 ms          |
| Live `createWorld` + `planDue` to 480    | 6.0–6.2 ms         | 2.6 ms              |
| Live, 48 worlds, one month, median / p90 | (not printed then) | 0.35 / 0.43–0.45 ms |

The live rows use dataset 2026-11-10-6ee5a23d. The bar case bundled with esbuild and run in plain
Node gives a median of 2.50 ms (p90 3.0 ms, month 72 252 ms): the tests now pay almost nothing for
the Vite module runner. That runner turns every use of an imported name into a getter call, which
cost about a third of a month's step; each hot module of the folder (`world.ts`, `pipeline.ts`,
`stage.ts`, `rates.ts`, `due.ts`, `holds.ts`, `columns.ts`, `months.ts`) imports modules as
namespaces and binds the names it uses once, at the top. Keep that pattern when adding a value
import to them. The change month is the whole-city replan of rule 7: every free lot's `INIT` draw is
checked against the skip bound, and the ordinary clock is read for the lots that pass.
