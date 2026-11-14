# Results from the step engine

The score numbers for `/sim`, read from the step engine's world events: a per-world series by calendar month, chunk statistics across worlds, the page's `TimelineView`, and the project card. Design: `docs/superpowers/specs/` (world-score; rule numbers are its rules). Pure TypeScript, worker-safe. Policy frames come from [policy-timeline.md](policy-timeline.md).

Money, tiers and limit statements are built; the funded card fields are not yet. See Tiers, Money, Funded worlds and Known gaps.

## Files

| Where                                | What                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `src/lib/sim/world/score/types.ts`   | `WorldSeries`, `WorldSeriesData`, `SeriesChunk`, `ScoreStatics`, `TimelineView`, `CardDeps` |
| `src/lib/sim/world/score/series.ts`  | `createWorldSeries(statics, from?)`                                                         |
| `src/lib/sim/world/score/statics.ts` | `scoreStaticsOf`, `horizonOf`, `finalTable`, `planFinanceOf`                                |
| `src/lib/sim/world/score/chunk.ts`   | `chunkOf(plan, twin, money, from, through)`                                                 |
| `src/lib/sim/world/score/view.ts`    | `viewOf`, `chunksBefore`, `BAND_Z`                                                          |
| `src/lib/sim/world/score/card.ts`    | `cardAt(world, statics, frame, deps, parcelId, day, projectId?)`                            |
| `src/lib/sim/world/score/test/`      | `feed.ts`: `feedWorld`, `feedFunded`, `testStatics`, `timelineStatics` for the specs        |

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

`chunkOf(plan, twin, money, from, through)` takes W plan worlds and their W paired twins (same seed, base policy), all final through `through`. Per calendar month it gives:

- `mean`, `sd`: across-world mean and sample sd (divide by W - 1) of every `MonthRow` field, `inProgress` stages included. W = 1 gives sd 0.
- `shown`: world 1's own rows ("this city").
- `planEffect`: mean and sd of the paired differences, world k's plan minus world k's twin, for `entitledNew` and `completedNetNew`. Not a difference of means.

- `money`, `tiers`: world 1's, with a `money` feed (rule 9); null without one.

It throws for no worlds, mismatched counts, or a month not final.

## Tiers

With finance in the window (month 1's frame or a change up to `windowMonths` has `finance`), `scoreStaticsOf` sets `tierBaseline = tierBaselineOf(rhna)` and builds a tier table: for each model month 1..`windowMonths`, the `tierContext` of that month's programme definitions (one per distinct finance state; null in a month without finance). Without finance `tierBaseline` is null and the series files no tiers.

The series files tiers as `tierSeries` does (rule 2): `-existing` from `aboveModerate` at a construction start after `asOf`; at completion, `tiersOf(scheduleAt(world, statics, row, day))`. A funded row is split by the programme definitions in force in the month of its award (design 3.4), not of its completion: the series records each row's `'award'` day (`WorldSeriesData.award`, so restore keeps it). A funded row that completes without an `'award'` throws (a feed bug). Every funded world files tiers; each month's five tiers sum to that world's `completedNet`. Chunks carry world 1's.

Runner rule: pass `createWorldSeries` the very `ScoreStatics` object `scoreStaticsOf` returned. The tier table lives in a module-private `WeakMap` keyed by that object, so a copy (a `structuredClone`, a spread) of a ScoreStatics with finance throws `world-score: ScoreStatics without its tier context; pass the object scoreStaticsOf returned`. A worker that receives ScoreStatics by message calls `scoreStaticsOf` itself. `viewOf` never reads the table, so the page may build the view from a copy.

## Money

`viewOf` gives `money` as today's `TimelineScore['money']` for world 1 (rule 12), with every series cut at `filledThrough`. `owed` is each debt pool's `received[filledThrough]` with `debtService(principal, debt).total`. `money` is null when a chunk has none.

`MoneyView` adds three fields to today's money: `displacedHomesCompleted` (per month, cut at `filledThrough`), and `perAddedHome: { all, city }` and `displacedShare`, read at `filledThrough`. The page reads those two figures from the view and does not call `finance-score`'s functions on `money` for them: they are today's `perAddedHome` and `displacedShare` computed over a money whose `displacedHomes` is `displacedHomesCompleted`.

The shown `displacedHomes` series and the ratio's displaced term differ in timing on purpose (partner ruling, rule 12). The series shows displacement when it happens (rule 2). The ratio pairs it with `fundedHomes`, which counts at completion, so its denominator keeps today's meaning: homes added by completed funded projects, less what those projects displaced. At `filledThrough` it equals `moneyOf`'s `displacedHomes` over the schedules read on that month's last day, and on funded mini (480 months) `perAddedHome` and `displacedShare` at the horizon equal the old engine's in all 49 of seeds 1-50 whose money matches (`money.spec.ts`). `owedAt` and `cityOf` read the series as before.

`limits` and `debts` live in `ScoreStatics` as plain data, both null without finance. `scoreStaticsOf` gives `limits = limitStatements(addedBorrowing(planFinanceOf(timeline, asOf, W), input.finance.pools, asOf, horizonOf(s)))`, so they are seed-free, independent of any ledger and fixed as the forecast fills. `planFinanceOf` turns each month's pool definition into one-off inflows and sets `off` to the days a frame drops them, so it counts exactly the frames' arrivals. A pool's label, kind and debt terms are month W's definition, a decided simplification: were two spans to give one pool different debt terms, all its borrowing in the window would be priced on month W's. `debts` lists each debt pool's terms from that same definition.

`viewOf` and `chunksBefore` read only the chunks and the plain fields of `ScoreStatics`, never the tier `WeakMap`. They therefore run on a copy (a `structuredClone` posted to the page), and give the same view as on the original.

## The view

`viewOf(chunks, statics)` joins contiguous chunks into a `TimelineView` (it throws on a gap, an overlap or a late first chunk). `band` is `mean.completedNet` plus or minus `BAND_Z` (1.2816, the 80% central band) times the sd; `planEffectBand` the same for the plan effect. `targets` from `targetsOf` over the mean. Every series has `filledThrough + 1` entries.

`chunksBefore(chunks, k)` keeps the months before `k`: whole chunks kept, the one straddling `k` trimmed, none from `k` on. A refill (the plan changed from month k) keeps `chunksBefore(chunks, k)` and computes new chunks from `k`.

## `cardAt`

World 1's answer to `parcelSummary`: the lot's record, envelope and limits under `frame`, then the project chosen on `day` with its card (today's `chooseProject` and `projectCard`) and the frame's stage tables for its cohort (`lookupsAt(frame)`).

`CardDeps` the host builds:

| Field                                         | What                                                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `qualityRules`, `building`, `logOnce`         | as today's `CardCtx`                                                                                            |
| `record(parcelId)`                            | neighborhood, land use, eligible, underwater, existing units; `null` throws, so check it first                  |
| `buildable(parcelId, allowed, existingUnits)` | stories the lot can build under `allowed`: the host's generate call (`simKey` memo), else `lotBuildableStories` |

The lot-limits line comes from `limitsOf(frame, parcelId)` (owner and protection from the frame's attribution; a protected lot reads FZP with nothing buildable). So `frame` must be `timeline.frameAt(max(1, monthOfDay(asOf, day)))` of a compiled timeline: a hand-built frame throws for an eligible lot. The `SimInput` the card reads is memoised per statics and per frame object, with `newScale` from `policy/lookups`.

## Funded worlds

What money and tiers read, from world-funding as merged (shadows and `'displaced'` events, policy-change remake and lapse included). Paths under `src/lib/sim/`.

- **Ledger.** `StepSink.ledger?(e)` (`world/types.ts:152-155`) gets today's `LedgerEvent` (`scenario/money.ts:20`, shape `scenario/engine.ts:72-78`): `{ day, pool, programme, kind, dollars }`, kind `in | commit | spend | repay | loss | release`. No project row. `createWorld` sends none (`funding/system.ts:26-31`); a month whose frame has `finance` null calls no hook (`world/world.ts:220`). So world 1's ledger since month 0 is every step's entries from month 1, in order.
  - `in` (programme null): system 2, from `frame.finance.arrivals`, 0 dollars skipped (`funding/pools.ts:32-45`). Month 1 holds the dataset date.
  - `commit`: on the award day, before `startProject` (`funding/serve.ts:60-62`, `funding/pools.ts:61-101`). The `'award'` world event comes after the chain `startProject` began (`funding/serve.ts:67`).
  - `spend` on entering construction; `repay`, `release`, `loss` at `'end'`, on the event's day, sorted within the event as today (`funding/pools.ts:118-193`).
  - Days do not ascend within a month (system order). `poolSeries` takes the ledger as is (`funding/funded.spec.ts:231-266`).
- **Row columns** (`world/types.ts:109-117`, written by `startProject`, `world/world.ts:382-390`): `funded` (1 on a funded start), `kind` (0 market, 1 affordable), `applied`, `granted`, `lent`, `guaranteed` (project dollars), `programmes` (ids joined with `,`, paying ones only). `certain` (`world/world.ts:363`). Size from `units`/`stories` and the revision table. `dispN`, `dispRow`, `dispDay`, `dispUnits` (`world/types.ts:125-129`): one entry per shadow that displaced homes, on its `'displaced'` event's day. `scheduleAt` reads them into `Schedule.funding` (`world/read.ts:80-90`).
- **Pools** (`funding/columns.ts:48-72`, through `fundOf(world)`): per pool id `received`, `committed`, `spentGrant`, `outLoan`, `lostLoan`, `lostGuarantee`; money rows `mRow`… for awards with events to come.
- **`FinanceFrame`**: `timeline.frameAt(m).finance` (`world/policy/frame.ts:32-43`), null without money; `frameMoney(timeline, frame)` indexes it (`funding/frame-money.ts`). `scoreStaticsOf` builds the tier table from it (see Tiers).
- **Building one in a test** (`funding/test/fixtures.ts`): `fundedMini()` (:33), `benchFunded(benchInput())` (:47, Node), the live city's `liveInput(dir)` already carries baseline `finance` when its calibration has `market` and `baselineFunding` (`scenario/input.ts:76-94`). Then `oneMoneyTimeline(input, input.finance!)` (:104) and `runFunded(staticsOf(input), timeline, seed, through, { afterStep })` (:230) for `{ world, events, ledger }`; `withFunding(createFundingSystem())` for your own feed. `randomFinance(seed)` (:155) for loans, guarantees, losses; `checkStep` (`funding/test/identities.ts:45`) for E1-E7.

## Timing

Bench `synthCity`, quiet machine, lock held, 2026-11-13, after the perf pass. Unfunded, 96 worlds: median 0.684 ms, p90 0.948 ms per month (bar 1 ms). Funded, 32 worlds: median 0.786 ms (months 101-150, ledger 763 events) and 0.779 ms (months 400-450, ledger 2394 events), so no growth with ledger length. `chunk.perf.spec.ts` labels a run quiet only with `SFH_PERF_QUIET=1`: set it when holding the lock. `npm run test:perf`, not in signoff.

## Known gaps

- The funded card fields are not built.
- `perAddedHome` uses world 1's money, not the plan effect (ruled 2026-11-13). Its denominator is `fundedHomes - displacedHomesCompleted` (see Money), not the shown `displacedHomes`, which also holds funded projects still building or that dropped out.
- A money change mid-window re-makes or lapses waiting applications; none of that reaches the series. An application is not a project row: only an award starts a row and sends one `'award'`, so funded homes, tiers and the award day the tiers read are per funded row (`score/lapse.spec.ts`).
- A project's `'award'` world event arrives after the stage events of the chain `startProject` begins (it runs synchronously). Read awards by project row, never by position relative to stage events.
