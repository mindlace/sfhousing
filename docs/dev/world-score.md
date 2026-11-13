# Results from the step engine

The score numbers for `/sim`, read from the step engine's world events: a per-world series by calendar month, chunk statistics across worlds, the page's `TimelineView`, and the project card. Design: `docs/superpowers/specs/` (world-score; rule numbers are its rules). Pure TypeScript, worker-safe. Policy frames come from [policy-timeline.md](policy-timeline.md).

Money, tiers and the funded card fields are not built yet: they wait for world-funding. See Known gaps.

## Files

| Where                                | What                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `src/lib/sim/world/score/types.ts`   | `WorldSeries`, `WorldSeriesData`, `SeriesChunk`, `ScoreStatics`, `TimelineView`, `CardDeps` |
| `src/lib/sim/world/score/series.ts`  | `createWorldSeries(statics, from?)`                                                         |
| `src/lib/sim/world/score/statics.ts` | `scoreStaticsOf`, `horizonOf`, `finalTable`                                                 |
| `src/lib/sim/world/score/chunk.ts`   | `chunkOf(plan, twin, money, from, through)`                                                 |
| `src/lib/sim/world/score/view.ts`    | `viewOf`, `chunksBefore`, `BAND_Z`                                                          |
| `src/lib/sim/world/score/card.ts`    | `cardAt(world, statics, frame, deps, parcelId, day, projectId?)`                            |
| `src/lib/sim/world/score/test/`      | `feed.ts`: `feedWorld`, `testStatics` for the specs                                         |

## Feeding a series

`series.add(event, world, statics)` takes each `WorldEvent`; `series.stepped(month)` is called after each model month's events, in order (`month` must be the last plus one). Three feeds give the same series, tested against each other and against today's `shownSeries`:

- `live`: events added inside the step's sink.
- `buffered`: each step's events added after the step.
- `after`: every event added against the final world, month by month.

Creation events (the `'start'` of every row at world creation) are emitted inside `createWorld`, before it returns. Add them after it returns, then feed the steps. A row needs its `'start'` before any other event (`known` throws).

The series keeps its own per-row state (stage, open span start, units, entitled day, a master's pending and filed phases), so it never reads rows back from the world: a restored series needs only its `WorldSeriesData`. `'award'` is ignored; `'displaced'` throws until world-funding.

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

It throws for no worlds, mismatched counts, a month not final, or a non-null `money`.

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

## Known gaps

- Money, tiers, `MoneyView`, limit statements and the funded card fields wait for world-funding. `scoreStaticsOf` throws if any frame up to the window carries finance; `chunkOf` throws on a `money` feed; `tierBaseline`, `limits`, `money` and `tiers` are null.
- `perAddedHome` keeps today's denominator: world 1's `fundedHomes - displacedHomes` at `filledThrough` (ruled 2026-11-13), not the plan effect.
- A project's `'award'` ledger event arrives after the stage events of the chain `startProject` begins (it runs synchronously). Read awards by project row, never by position relative to stage events.
