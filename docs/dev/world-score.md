# Scores from the step engine

The score numbers for the simulation, read from the step engine's world events: a per-world series by calendar month, chunks for the plan's world against its twin, the page's `TimelineView`, and the project card. Design: `docs/superpowers/specs/` (world-score; rule numbers are its rules). Pure TypeScript, worker-safe. Policy frames come from [policy-timeline.md](policy-timeline.md).

Money, tiers and limit statements are built; the funded card fields are not yet. See Tiers, Money, Funded worlds and Known gaps.

## Files

| Where                                  | What                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/lib/sim/world/score/types.ts`     | `WorldSeries`, `WorldSeriesData`, `SeriesChunk`, `ScoreStatics`, `TimelineView`, `CardDeps` |
| `src/lib/sim/world/score/series.ts`    | `createWorldSeries(statics, from?)`                                                         |
| `src/lib/sim/world/score/statics.ts`   | `scoreStaticsOf`, `horizonOf`, `finalTable`, `planFinanceOf`                                |
| `src/lib/sim/world/score/chunk.ts`     | `chunkOf(plan, twin, money, from, through)`                                                 |
| `src/lib/sim/world/score/view.ts`      | `viewOf`, `chunksBefore`                                                                    |
| `src/lib/sim/world/score/card.ts`      | `cardAt(world, statics, frame, deps, parcelId, day, projectId?)`                            |
| `src/lib/sim/world/score/test/`        | `feed.ts`: `feedWorld`, `feedFunded`, `testStatics`, `timelineStatics` for the specs        |
| `src/lib/sim/world/funding/system.ts`  | `waitingHomes`, `recordWaiting`: the count and its record at the end of system 7            |
| `src/lib/sim/world/funding/columns.ts` | `waitingAt`: the recorded count at a model month, read by `Extras.waiting`                  |

## Feeding a series

`series.add(event, world, statics)` takes each `WorldEvent`; `series.stepped(month)` is called after each model month's events, in order (`month` must be the last plus one). Three feeds give the same series, tested against each other and against today's `shownSeries`:

- `live`: events added inside the step's sink.
- `buffered`: each step's events added after the step.
- `after`: every event added against the final world, month by month.

Creation events (the `'start'` of every row at world creation) are emitted inside `createWorld`, before it returns. Add them after it returns, then feed the steps. A row needs its `'start'` before any other event (`known` throws).

The series keeps its own per-row state (stage, open span start, units, entitled day, a master's pending and filed phases), so it never reads rows back from the world: a restored series needs only its `WorldSeriesData`. `'award'` records the row's award day (for tiers); `'displaced'` adds its units to `displacedHomes` in the calendar month of its own day (rule 2), whether or not the funded project has completed. For rule 12 the series also keeps `displacedHomesCompleted`: a funded row's displaced homes so far are filed at its completion, and a later `'displaced'` event of a completed row in the event's month (never before the completion's month). It reads only the events, so every feed order gives the same.

## Calendar months

`ScoreStatics.months[i]` is the first day of calendar month i, from the dataset date's month. `lastIndex` is the last calendar month whose last day is at or before the last day of model month `windowMonths`. Every delta files into the calendar month holding its day (days before the first month go to month 0; days after the horizon are dropped).

Calendar month i is final once the model month holding its last day has been stepped (`finalTable[i]`). `finalThrough()` is the last final month. `rows(from, through)` needs `0 <= from <= through <= finalThrough()` (`RangeError` otherwise) and sums prefixes lazily.

The final-month guard: an event that would change a final month throws, naming the row, the event and the month. An event's deltas apply only after all pass, so a throwing event files nothing; its per-row state may have moved, and a series that threw is not used again.

## `data()` and restore

`data()` returns a `WorldSeriesData` copy (typed arrays, `structuredClone`-safe); `createWorldSeries(statics, data)` copies it back, checking `version` and the array length against the statics. The restored series then gives the same chunks as one that never stopped. Per-row columns are indexed by the world's project row.

## Chunks

`chunkOf(plan, twin, money, from, through)` takes the plan's world series and its twin's (same seed, base policy), both final through `through`. Per calendar month it gives:

- `rows`: the plan world's own `MonthRow`s, `inProgress` stages included.
- `planEffect`: the plan's `entitledNew` and `completedNetNew` minus the twin's, month by month.
- `money`, `tiers`: the plan world's, with a `money` feed (rule 9); null without one.
- `cars`: the plan world's cars by calendar month (`CarRow`: households, cars, carless, `spacesPerHome` (null when no project started), cars per household by zone); null when the series was never given a snapshot. `stepped(month, cars?)` files a `CarSnapshot` in the calendar month holding model month `month`'s last day (a later model month in the same calendar month overwrites it); a calendar month no model month ends in carries the previous one (zeros before the first). `created(cars)`, before any `stepped`, files the world's car state at creation (model month 0) in the calendar month holding the dataset date, so today's month has today's households; the timeline host feeds it for the plan world only. `TimelineView.cars` (`CarsView`) joins the chunks with `perHousehold = cars / households`; chunks that mix null and non-null `cars` throw. `WorldSeriesData` is version 6 (`carRows`, `carZones`, `carZoneCount`); version 5 data is rejected.
- `waiting`: the homes waiting for money at each calendar month's end, read from the plan world with a `money` feed (the feed's `world`); null without one. See Homes waiting for money. It and `cars` are independent: neither reads the other, and `chunksBefore` trims both.

It throws for a month not final.

## Tiers

With finance in the window (month 1's frame or a change up to `windowMonths` has `finance`), `scoreStaticsOf` sets `tierBaseline = tierBaselineOf(rhna)` and builds a tier table: for each model month 1..`windowMonths`, the `tierContext` of that month's programme definitions (one per distinct finance state; null in a month without finance). Without finance `tierBaseline` is null and the series files no tiers.

The series files tiers as `tierSeries` does (rule 2): `-existing` from `aboveModerate` at a construction start after `asOf`; at completion, `tiersOf(scheduleAt(world, statics, row, day))`. A funded row is split by the programme definitions in force in the month of its award (design 3.4), not of its completion: the series records each row's `'award'` day (`WorldSeriesData.award`, so restore keeps it).

The series assumes no order between a row's `'award'` and its stage events. World-funding sends `'award'` after the chain `startProject` began, so a funded project that passes every stage inside its award step (short stages, fast `speed`) sends its `'end'` `'complete'` first (`score/award-order.spec.ts` forces this). Such a row's tiers are filed at its completion by the definitions of its completion's model month, and its `award` reads `AWAITING` (`NO_DAY + 1`). The award comes in the same step, so its month is the completion's and nothing more is filed. An award from another month re-files the row's tiers (out by the provisional definitions, in by the award month's) in the completion's calendar month. That month cannot be final yet within the step; a later step's award into a final month throws, as any late event does. A row still `AWAITING` when its step is `stepped` is a feed bug: it is set `UNAWARDED` (`NO_DAY + 2`) and counted in `WorldSeriesData.unawarded` (`extrasOf(series).unawarded()`). Its tiers stay filed by the completion month's definitions, and nothing throws. Funded homes and `displacedHomesCompleted` read `funded` from the row at completion, which `startProject` sets before the chain, so they do not depend on the order. Every funded world files tiers; each month's five tiers sum to that world's `completedNet`. Chunks carry the plan world's.

Runner rule: pass `createWorldSeries` the very `ScoreStatics` object `scoreStaticsOf` returned. The tier table lives in a module-private `WeakMap` keyed by that object, so a copy (a `structuredClone`, a spread) of a ScoreStatics with finance throws `world-score: ScoreStatics without its tier context; pass the object scoreStaticsOf returned`. A worker that receives ScoreStatics by message calls `scoreStaticsOf` itself. `viewOf` never reads the table, so the page may build the view from a copy.

## Money

`viewOf` gives `money` as today's `TimelineScore['money']` for the plan's world (rule 12), with every series cut at `filledThrough`. `owed` is each debt pool's `received[filledThrough]` with `debtService(principal, debt).total`. `money` is null when a chunk has none.

`MoneyView` adds five fields to today's money: `displacedHomesCompleted` (per month, cut at `filledThrough`); `perAddedHome: { all, city }` and `displacedShare`, read at `filledThrough`; and the same two figures by month, `perAddedHomeByMonth: { all: (number | null)[]; city: (number | null)[] }` and `displacedShareByMonth: (number | null)[]`. The page reads those figures from the view and does not call `finance-score`'s functions on `money` for them: they are today's `perAddedHome` and `displacedShare` computed over a money whose `displacedHomes` is `displacedHomesCompleted`.

The `ByMonth` series (for timeline-ui's rule 26: Details rows for the playhead's month) have `filledThrough + 1` entries like the other money series. Entry i is today's function applied at month i over that paired money, which reads only month i of each series, so it is the figure a view filled through month i gives: a partial view (`chunksBefore`) gives the prefix. An entry is null where today's function gives null: `perAddedHome` when `fundedHomes - displacedHomesCompleted <= 0` (no added homes), `displacedShare` when `fundedHomes <= 0`. Entry `filledThrough` is the scalar exactly (`perAddedHomeByMonth.all[filledThrough] === perAddedHome.all`, and so on), and the page reads the playhead's month by index. They are plain arrays, so the view stays structured-cloneable.

The shown `displacedHomes` series and the ratio's displaced term differ in timing on purpose (partner ruling, rule 12). The series shows displacement when it happens (rule 2). The ratio pairs it with `fundedHomes`, which counts at completion, so its denominator is homes added by completed funded projects, less what those projects displaced. At `filledThrough` it equals the fold `moneyOf`'s (`score/test/oracles.ts`) `displacedHomes` over the schedules read on that month's last day (`money.spec.ts`). `owedAt` and `cityOf` read the series as before.

`limits` and `debts` live in `ScoreStatics` as plain data, both null without finance. `scoreStaticsOf` gives `limits = limitStatements(addedBorrowing(planFinanceOf(timeline, asOf, W), input.finance.pools, asOf, horizonOf(s)))`, so they are seed-free, independent of any ledger and fixed as the forecast fills. `planFinanceOf` turns each month's pool definition into one-off inflows and sets `off` to the days a frame drops them, so it counts exactly the frames' arrivals. A pool's label, kind and debt terms are month W's definition, a decided simplification: were two spans to give one pool different debt terms, all its borrowing in the window would be priced on month W's. `debts` lists each debt pool's terms from that same definition.

`viewOf` and `chunksBefore` read only the chunks and the plain fields of `ScoreStatics`, never the tier `WeakMap`. They therefore run on a copy (a `structuredClone` posted to the page), and give the same view as on the original.

## Homes waiting for money

The count is the homes in the applications waiting in the funding line (`waitingHomes`, `funding/system.ts`). A row marked `gone` is not counted, nor is a row whose lot is no longer free (`LOT_DONE`, `LOT_LIVE`, `LOT_HELD`; the same lazy guard as the serve step's). A lot with two applications counts once, by the larger. A row whose lot has no lot row is counted. A world without funding columns counts 0.

The funding system's `shadow` hook (system 7) calls `recordWaiting` after `stepShadows`, once per funded step, so the count is the one the month ends with: nothing in the step changes the line after it. It is kept in the world's line (`waitHomes` by model month, `waitThrough` the last month recorded), not in the series: the series reads events, and a waiting application is not a row and sends none. A month with no funded step (the core calls no hook in a month whose frame has no `finance`) keeps the last value, and `waitingAt(world, m)` (`funding/columns.ts`, reads only the columns) gives `waitHomes[min(m, waitThrough)]`; it throws `RangeError` for a month that is not whole or past `world.month`, and is 0 for a world without funding columns.

`Extras.waiting(world, from, through)` (`series.ts`) gives, for final calendar months `from..through`, entry k = `waitingAt(world, finalTable[from + k])`: the count at the end of the model month that holds the calendar month's last day. A model month is 30.44 days, so that model month ends up to 30 days after the calendar month's last day (a month's count is read at the end of the model month, not on the day). It needs no statics: it reads the series' own table. Every calendar month in a chunk is final, so `finalTable[i] <= stepped <= world.month` and the read never throws in the runner. The twin does not move it: it reads the plan's world only.

## The view

`viewOf(chunks, statics)` joins contiguous chunks into a `TimelineView` (it throws on a gap, an overlap or a late first chunk). `rows` and `planEffect` are the chunks' rows joined. `targets` from `targetsOf` over `rows`. Every series has `filledThrough + 1` entries.

`waitingMoney` joins the chunks' `waiting`. It is null whenever the view's `money` is null, and also when any chunk lacks `waiting` (absent or null); otherwise it has `filledThrough + 1` entries.

`chunksBefore(chunks, k)` keeps the months before `k`: whole chunks kept, the one straddling `k` trimmed (its `waiting` with the rest), none from `k` on. A refill (the plan changed from month k) keeps `chunksBefore(chunks, k)` and computes new chunks from `k`.

## `cardAt`

The plan world's answer to `parcelSummary`: the lot's record, envelope and limits under `frame`, then the project chosen on `day` with its card (today's `chooseProject` and `projectCard`) and the frame's stage tables for its cohort (`lookupsAt(frame)`).

`CardDeps` the host builds:

| Field                                         | What                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `qualityRules`, `building`, `logOnce`         | as today's `CardCtx`                                                                           |
| `record(parcelId)`                            | neighborhood, land use, eligible, underwater, existing units; `null` throws, so check it first |
| `buildable(parcelId, allowed, existingUnits)` | stories the lot can build under `allowed`: the host's typology generate call (`g               | <id> | <allowed>`memo), else`lotBuildableStories`; `null`where neither builds, passed through to`limits.buildable` |

The lot-limits line comes from `limitsOf(frame, parcelId)` (owner and protection from the frame's attribution; a protected lot reads FZP with nothing buildable). So `frame` must be `timeline.frameAt(max(1, monthOfDay(asOf, day)))` of a compiled timeline: a hand-built frame throws for an eligible lot. The `SimInput` the card reads is memoised per statics and per frame object, with `newScale` from `policy/lookups`.

## Funded worlds

What money and tiers read, from world-funding as merged (shadows and `'displaced'` events, policy-change remake and lapse included). Paths under `src/lib/sim/`.

- **Ledger.** `StepSink.ledger?(e)` (`world/types.ts:152-155`) gets a `LedgerEvent` (`world/types.ts`): `{ day, pool, programme, kind, dollars }`, kind `in | commit | spend | repay | loss | release`. No project row. `createWorld` sends none (`funding/system.ts:26-31`); a month whose frame has `finance` null calls no hook (`world/world.ts:220`). So the plan world's ledger since month 0 is every step's entries from month 1, in order.
  - `in` (programme null): system 2, from `frame.finance.arrivals`, 0 dollars skipped (`funding/pools.ts:32-45`). Month 1 holds the dataset date.
  - `commit`: on the award day, before `startProject` (`funding/serve.ts:60-62`, `funding/pools.ts:61-101`). The `'award'` world event comes after the chain `startProject` began (`funding/serve.ts:67`).
  - `spend` on entering construction; `repay`, `release`, `loss` at `'end'`, on the event's day, sorted within the event as today (`funding/pools.ts:118-193`).
  - Days do not ascend within a month (system order). `poolSeries` takes the ledger as is (`funding/funded.spec.ts:231-266`).
- **Row columns** (`world/types.ts:109-117`, written by `startProject`, `world/world.ts:382-390`): `funded` (1 on a funded start), `kind` (0 market, 1 affordable), `applied`, `granted`, `lent`, `guaranteed` (project dollars), `programmes` (ids joined with `,`, paying ones only). `certain` (`world/world.ts:363`). Size from `units`/`stories` and the revision table: a simulated row's units and stories are its chosen option's (building-choice, [building-choice.md](building-choice.md)), and `level` (the option index, the latest after a revision), `btype` and `optCap` say which. `dispN`, `dispRow`, `dispDay`, `dispUnits` (`world/types.ts:125-129`): one entry per shadow that displaced homes, on its `'displaced'` event's day. `scheduleAt` reads them into `Schedule.funding` (`world/read.ts:80-90`).
- **Pools** (`funding/columns.ts:48-72`, through `fundOf(world)`): per pool id `received`, `committed`, `spentGrant`, `outLoan`, `lostLoan`, `lostGuarantee`; money rows `mRow`… for awards with events to come.
- **`FinanceFrame`**: `timeline.frameAt(m).finance` (`world/policy/frame.ts:32-43`), null without money; `frameMoney(timeline, frame)` indexes it (`funding/frame-money.ts`). `scoreStaticsOf` builds the tier table from it (see Tiers).
- **Building one in a test** (`funding/test/fixtures.ts`): `fundedMini()` (:33), `benchFunded(benchInput())` (:47, Node), the live city's `liveInput(dir)` already carries baseline `finance` when its calibration has `market` and `baselineFunding` (`input/build.ts`). Then `oneMoneyTimeline(input, input.finance!)` (:104) and `runFunded(staticsOf(input), timeline, seed, through, { afterStep })` (:230) for `{ world, events, ledger }`; `withFunding(createFundingSystem())` for your own feed. `randomFinance(seed)` (:155) for loans, guarantees, losses; `checkStep` (`funding/test/identities.ts:45`) for E1-E7.

## Timing

History: the chunk figures were taken 2026-11-13 with 48 + 48 worlds; `chunkOf` now takes one plan world and its twin.

Bench `synthCity`, quiet machine, lock held, 2026-11-13, after the perf pass and the rule 12 fix. Unfunded, 96 worlds: median 0.728 ms, p90 0.897 ms per month (bar 1 ms, read at the median). Funded, 32 worlds: median 0.767 ms (months 101-150, ledger 763 events) and 0.771 ms (months 400-450, ledger 2394 events), so no growth with ledger length. `chunk.perf.spec.ts` labels a run quiet only with `SFH_PERF_QUIET=1`: set it when holding the lock. `npm run test:perf`, not in signoff.

`viewOf` (`view.perf.spec.ts`, no bar): bench `synthCity`, 4 funded worlds, a full 480-month window in 480 one-month chunks, 1000 calls, quiet machine, lock held, 2026-11-14. Before the `ByMonth` series: median 0.183 ms, p90 0.199 ms. With them: median 0.208 ms, p90 0.324 ms per call.

## Known gaps

- The funded card fields are not built.
- `perAddedHome` uses the plan world's money, not the plan effect (ruled 2026-11-13). Its denominator is `fundedHomes - displacedHomesCompleted` (see Money), not the shown `displacedHomes`, which also holds funded projects still building or that dropped out.
- A money change mid-window re-makes or lapses waiting applications; none of that reaches the series. An application is not a project row: only an award starts a row and sends one `'award'`, so funded homes, tiers and the award day the tiers read are per funded row (`score/lapse.spec.ts`).
- A project's `'award'` world event arrives after the stage events of the chain `startProject` begins (it runs synchronously). Read awards by project row, never by position relative to stage events.
