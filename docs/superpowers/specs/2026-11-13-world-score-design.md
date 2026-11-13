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

**S15** (decomposition choice; owner `world-score`). `interface SeriesChunk { from: number; mean: MonthRow[]; sd: MonthRow[]; shown: MonthRow[]; planEffect: { mean: PlanRow; sd: PlanRow }[]; money: MoneyRow[] | null; tiers: TierUnits[] | null }`: one entry per calendar month from index `from`. `MonthRow` has today's `TimelineScore['shown'][number]` fields; `shown` is world 1 ("this city"). `PlanRow` is `{ entitledNew: number; completedNetNew: number }`. `MoneyRow` is one month's entry of every series in today's `TimelineScore['money']`. `interface WorldSeries { add(e: WorldEvent, world: World, statics: Statics): void; stepped(month: number): void; finalThrough(): number; rows(from: number, through: number): MonthRow[]; data(): WorldSeriesData }`, one per world, which the runner feeds (`stepped` after each step, with the model month just stepped); `WorldSeriesData` is plain data that `structuredClone` copies. `function createWorldSeries(s: ScoreStatics, from?: WorldSeriesData): WorldSeries`. `function chunkOf(plan: WorldSeries[], twin: WorldSeries[], money: MoneyFeed | null, from: number, through: number): SeriesChunk`. `interface MoneyFeed { ledger: LedgerEvent[]; finance: FinanceFrame; world: World; statics: Statics }` is world 1's. `function scoreStaticsOf(input: SimInput, timeline: PolicyTimeline, base: 'plan' | 'preFzp', windowMonths: number): ScoreStatics`, called once the plan timeline is fully compiled. `function viewOf(chunks: SeriesChunk[], statics: ScoreStatics): TimelineView` builds what the page reads. `function cardAt(world: World, statics: Statics, frame: PolicyFrame, deps: CardDeps, parcelId: ParcelId, day: Day, projectId?: string): { summary: ParcelSummary; lookups: Lookups | null }`, which the runner calls to answer `parcelSummary` from world 1.

**S7** (model commitment; owner `world-core`). `interface StepSink { event(e: WorldEvent): void; ledger?(e: LedgerEvent): void }`. `type WorldEvent = { kind: 'start'; row: number; day: Day } | { kind: 'enter'; row: number; day: Day; stage: Stage } | { kind: 'revise'; row: number; day: Day; units: number; stories: number | null } | { kind: 'end'; row: number; day: Day; how: 'complete' | 'exit' | 'entitled' } | { kind: 'phaseFiled'; row: number; day: Day; phase: number } | { kind: 'award'; row: number; day: Day } | { kind: 'displaced'; row: number; lot: number; day: Day; units: number }`. `row` indexes `world.projects` (masters have rows too) and never changes for a project. Events of one step arrive in the order the systems made them. `'start'` is sent once per row when it comes to exist, before any other event of that row; `'entitled'` ends a master; `'displaced'` names the funded project's row. `LedgerEvent` is today's (`money.ts`).

**S8** (model commitment; owner `world-core`). Readers of a world: `function scheduleAt(world: World, statics: Statics, row: number, day: Day): Schedule | null` and `function masterAt(world: World, statics: Statics, row: number, day: Day): Master | null` give the row as today's types, as a reader standing on `day` sees it (nothing dated after `day`; `end.kind` is `'open'` when it has not ended by then). One of the two is non-null for every row.

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

- The calibration file, the dataset and the pipeline do not change. No file under the folders hashed into the dataset version (`pipeline`, `src/lib/data`, `src/lib/generator`, `src/lib/timelapse`, `src/lib/plan/{geometry,types}.ts`, `src/lib/sim/{scenario,levers,finance}`, `src/lib/scoreboard`) is added, changed or removed in Release A. In Release B the one exception is `src/lib/sim/scenario/scenario-host.ts`, which `ensemble-runner` may change or move so that the new host can use the dataset it loads, without changing any result of the old engine; that branch then follows "Finishing a branch that changes the dataset" in `docs/dev/pipeline.md`. New code imports from the hashed folders. A builder who finds any other change necessary stops and reports.
- The step and everything it calls may read the policy of the month being stepped and of earlier months, never of a later one.
- Agreement with today's engine (OD-2). Without public money and under one frame: for every seed tested, `scheduleAt` and `masterAt` over every row at the horizon day equal `simulateDetailed`'s schedules and masters, and each world's calendar-month series equals `shownSeries`. With public money, over seeds 1 to 200 on the bench city and on the live city with baseline funding, at years 5, 10, 20 and 40: the mean of completed net homes within 1% of today's mean, its standard deviation within 15% of today's, and the mean number of awards and of funded homes within 3%. The ledger identities hold after every step in every world. A miss is reported with its numbers; no rule is changed to meet it.
- `exp` and `log` only from `src/lib/timelapse/math.ts`. `Math.exp`, `Math.log`, `Math.pow`, `Math.log1p`, `Math.expm1` and the `**` operator are never used under `src/lib/sim/world/`, and the determinism ESLint rule's `files` gains `src/lib/sim/world/**` (`world-core` adds it; `eslint.config.js` is not hashed).
- The same inputs give the same world, in Node and in the browser.
- No slice of worker work longer than 50 ms.
- `step`, the world and every function they call take no horizon, read no end date and keep nothing laid out to one. Only the runner and the page hold the window.
- One month for every world of both ensembles, scoring included, on the live city: at most 9 ms on the reference machine. (Playback at its fastest covers 36 months a second; the forecast must fill at least three times faster.) The spike measured 0.31 ms for 48 worlds without public money; the funded path is unmeasured, and `world-funding` measures it first.
- No user setting may decide directly how much gets built (levers spec anti-goal, kept).
- A lever that changes only timing never changes any project's outcome, and moves its days in one direction (paired-draw fix, kept). This holds exactly without public money. With public money a timer can still change which applications are awarded and when, because releases and repayments fall on stage days; that is an effect of the money and is not to be "fixed".
- Tests that run in signoff assert behaviour and order, never wall-clock time. Every timing bar lives in `test:perf`.
- WCAG 2.2 AA for the timeline, including keyboard control of every bar.
- Explanation waits for interest (OD-12). At rest the page shows numbers, short labels and controls. Sentences that explain a number, a caveat or a method appear only when the reader points at, focuses or taps the thing they explain. What appears on pointing also appears on keyboard focus and on tap, stays while pointed at, and can be dismissed (WCAG 1.4.13). An explanation is itself short: it says what the reader cannot infer and stops (partner, 2026-11-13: "A forecast if nothing changes" is sufficiently unambiguous; "if you can infer it don't belabor it"). No new standing paragraph is added to `/sim`, and the specs for `timeline-ui` and `world-score` list each text they carry over from today's page with where it goes.
