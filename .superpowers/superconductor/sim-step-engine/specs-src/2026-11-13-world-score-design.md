# world-score: from events to what the page shows

Part of the step-engine package. Design: [2026-11-12-2305-sim-step-engine.md](../design/2026-11-12-2305-sim-step-engine.md), approved 2026-11-13. Release B. Depends on `world-core` (events and readers); called by `ensemble-runner`; read by `timeline-ui`.

## Purpose

Today the score is built from one finished run's schedules, and the band from 101 finished runs by ranking them. This subsystem builds the same numbers from events as they happen: each world keeps a running series by calendar month, and the page's figures are the average and spread across worlds for the months every world has reached.

## Scope

- `WorldSeries`: one world's series by calendar month, built from `WorldEvent`s.
- `SeriesChunk`: the average, the spread, "this city", the plan effect, money and tiers for a run of final months.
- `ScoreStatics` and `TimelineView`: what the page needs once, and what it reads.
- The project card for a lot on a day, from world 1.

Not in scope: stepping and posting (`ensemble-runner`); drawing (`timeline-ui`); the map (`map-stream`).

Code lives in `src/lib/sim/world/score/`. It imports `monthsOf`, `monthIndexer`, `targetsOf`, `tierTargetsOf`, `phasingOf`, `REFERENCES`, `RHNA_DEADLINE` from `scenario/score.ts`, `poolSeries`, `addedBorrowing`, `limitStatements` and the tier functions from `scenario/finance-score.ts` where their inputs fit, and `chooseProject`, `projectCard`, `revisionAt` from `scenario/card.ts`, and changes none of them. `shownSeries`, `addMaster`, `tierSeries` and `moneyOf` take a finished run and an end date: their filing rules are written again here for events, and rule 5's referee holds them. Do not add an export to an old file.

## Interfaces

{{ROW S15}}

{{ROW S7}}

{{ROW S8}}

Defined here:

- `interface ScoreStatics { asOf: Day; months: Day[]; lastIndex: number; baseline: ProjectsFile['rhnaCompletedNet']; tierBaseline: TierUnits | null; phasing: TimelineScore['phasing']; references: TimelineScore['references']; compare: 'plan' | 'preFzp'; limits: ReturnType<typeof limitStatements> | null }`. `months[i]` is the first day of calendar month i, from the dataset date's month. `lastIndex` is the last calendar month whose last day is at or before the last day of model month `windowMonths`; `months` has `lastIndex + 1` entries. `references` is all of `REFERENCES` when `compare` is `'preFzp'` and only the `completedNet` ones otherwise (`levers/apply.ts:157-160`).
- `interface TimelineView { months: Day[]; lastIndex: number; filledThrough: number; mean: MonthRow[]; band: { lo: number; hi: number }[]; shown: MonthRow[]; planEffect: PlanRow[]; planEffectBand: { lo: PlanRow; hi: PlanRow }[]; targets: TargetProgressAt[]; tierTargets: TargetProgressAt[] | null; money: MoneyView | null; tiers: TierUnits[] | null; baseline: TimelineScore['baseline']; phasing: TimelineScore['phasing']; references: TimelineScore['references']; compare: 'plan' | 'preFzp' }`. Every series has `filledThrough + 1` entries; `filledThrough` is -1 before the first chunk.
- `MoneyRow` is one month's entry of every per-month series in today's `TimelineScore['money']` (each pool's `received`, `committed`, `spent`, `out`, `lostCredit`; `fundedHomes`; `displacedHomes`; `publicSpent`). `MoneyView` is today's `TimelineScore['money']` with those series cut at `filledThrough` and with `owed`, `perAddedHome` and `limits` as rule 12 gives them.

## Rules

### One world's series

1. `WorldSeries.add` files each event exactly as `shownSeries` files a schedule's parts today (`score.ts:82-225`): a stage entered adds the project's current homes to that stage from that day and removes them from the stage before; a revision moves the difference; a construction start after the dataset date takes away the existing homes; a completion adds the final homes, to the pipeline or the new series by origin (phases count as pipeline); a drop-out after the dataset date adds to `exitedUnits`; `entitledNew` counts simulated projects only, net of existing homes; a master's phases sit at its planning stage until each files or the master ends (`addMaster`). An event dated before `months[0]` counts in month 0. It reads the project's origin, existing homes and current size from the world's row at the time of the event.
2. It also counts, per calendar month, for tiers and money: homes completed by income tier (as `tiersOf` assigns them), homes completed by funded projects (`fundedHomes`), and homes in `'displaced'` events by the event's own day (`displacedHomes`; changed from today, which counts them when the funded project completes: design section 3.5).
3. `finalThrough()` is the last calendar month i such that the world has stepped through the model month holding the last day of month i, as told by `stepped`.
4. `data()` returns the series' whole state as plain data; `createWorldSeries(s, from)` restores it.
5. Referee: for a world without public money under one frame, `rows(0, n)` equals `shownSeries(simulateDetailed(…), asOf, horizon, months)` field for field, for every month final at the horizon.

### Across worlds

6. `chunkOf`: `mean` and `sd` of a month are taken over the plan ensemble's worlds, field by field of `MonthRow` (every count, including each stage of `inProgress`). `sd` is the sample standard deviation (divide by W - 1). Neither is rounded in the chunk.
7. `shown` is world 1 of the plan ensemble, whole numbers.
8. The plan effect of a month is, for each seed, the plan world's `entitledNew` and `completedNetNew` minus the comparison world's with the same seed; `planEffect.mean` and `.sd` are over those differences.
9. `money` and `tiers` in a chunk describe world 1 only ("this city"): `tiers` from rule 2; the pools' series from its ledger filed by calendar month as `poolSeries` files them; `fundedHomes` and `displacedHomes` from rule 2. They are null when `MoneyFeed` is null (no finance).

### The view

10. `viewOf` joins chunks in order. `band[i]` is `mean.completedNet ± 1.2816 × sd.completedNet`; `planEffectBand` likewise on the differences. The page adds `baseline.completedNet` where today's page does (the headline, the band's label, the targets); the view's series do not include it, as today's `shown` does not.
11. Targets use `mean.completedNet` (`targetsOf`, unchanged); tier targets use world 1's tiers, so on one screen the tier rows describe this city and the total row the average. `timeline-ui` labels them so.
12. Money in the view: `owed` and `perAddedHome` are today's quantities read as of `filledThrough` in place of "the end of the run"; `perAddedHome` uses the plan effect's mean. `limits` are `ScoreStatics.limits`: `scoreStaticsOf` computes `limitStatements(addedBorrowing(…))` from the timeline's pools and every arrival in the window, not from the ledger, so they are the same in every world and do not change as the forecast fills (null without finance).
13. A `refill` from index k (the page drops chunks from k on) leaves the view at `filledThrough = k - 1`; refilled chunks then extend it.

### The card

14. `cardAt` builds the lot's schedules with `scheduleAt(…, day)`, chooses one with `chooseProject`, and builds the card with `projectCard`, unchanged. A project's stage days after `day` are unknown to the card; the card shows today's "typical months" from `lookups`, the stage tables of `frame` for that project's cohort. `CardDeps` is what `CardCtx` needs beyond the world (quality rules, the massing function, `logOnce`). `funding.programmes` on the card are programme ids.
15. `funding.displaced` on a card is what the row holds on `day`: the shadow's homes once its `'displaced'` event has happened, else 0.

### Text

16. This subsystem renders nothing. The labels and methods it passes through (`references`, provenance) are shown by `timeline-ui` under the explanation rule of the global constraints, and it carries over no standing text.

## Tests that must pass

Assert, in signoff:

- Rule 5 on the bench city and the fixture, seeds 1 to 10.
- A series fed the events of a stepped world, saved with `data()` at month 100, restored and fed the rest, equals one fed straight through.
- Rules 6 to 8 on a hand-built set of four worlds' rows; with identical plan and comparison every plan-effect mean and sd is 0.
- `finalThrough` never includes a calendar month whose last day falls in a model month not yet stepped; after stepping model month `windowMonths` it equals `lastIndex`.
- `viewOf` after a refill and refilled chunks equals `viewOf` of a fresh fill.
- Rule 12: `limits` computed at `filledThrough = 10` and at `lastIndex` are equal; equal for two seeds.
- Rule 2: a `'displaced'` event counts in its own month, whether or not the funded project has completed.
- `cardAt` for a project at a day before and after one of its stage entries: the later stage appears only in the second.

`test:perf`: adding one month's events for 96 worlds and building its chunk, bench city: at most 1 ms.

Docs: a "Results" section in `docs/dev/sim-timeline.md`; `docs/dev/finance-score.md` gains a note on rules 2 and 12.

## Left to the builder

- The arrays behind `WorldSeries`.
- How `CardDeps` is assembled from the host.

Decided here, not left: calendar months as the index (rule 1), when displaced homes count (rule 2), when a month is final (rule 3), sample standard deviation and the 1.2816 factor (rules 6 and 10), the plan effect as a mean of paired differences (rule 8), that money and tiers are world 1's (rule 9), what the money view reads at `filledThrough` and that limits do not depend on the ledger (rule 12).

## Global constraints

{{CONSTRAINTS}}
