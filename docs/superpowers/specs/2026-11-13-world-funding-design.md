# world-funding: public money in the step engine

Part of the step-engine package. Design: [2026-11-12-2305-sim-step-engine.md](../design/2026-11-12-2305-sim-step-engine.md), approved 2026-11-13. Release A. Depends on `world-core` (it implements that spec's `FundingSystem` hook).

## Purpose

Today's funded pass runs day by day over a calendar that holds every project's whole future, with pool inflows laid out to the end date. This subsystem is the same funding model run once a month: lots apply for money in the month their funded clock passes its threshold, the line is served once a month, and each money event of an awarded project is made when the project's own stage event happens.

It cannot match today's engine project for project, because two applications in one month can be served in a different order (partner ruling R5). Its test is that the totals agree within the tolerance in the global constraints, and that the ledger identities hold after every step.

## Scope

- The market and affordable start clocks of a free lot, and when a lot applies.
- The line: its rows, its order, serving.
- The award rule (reused), pool state, inflows, and every money event.
- What a change of policy does to waiting applications.
- The shadow start behind `displaced`.

Not in scope: the ordinary clock, stages, holds, `startProject`, the certain-project stage rule (`world-core`); what a `FinanceFrame` contains (`policy-timeline`); money series and limit statements for the page (`world-score`).

Code lives in `src/lib/sim/world/funding/`. It imports `awardSet`, `awardPasses`, `asksOf`, `available`, `coverageLevel`, `below`, `financeIndexOf` from `scenario/funding.ts`, `lineKey` and `NEVER_KEY_DAY` from `scenario/funded.ts`, `pathwayFrom` and the pricing functions of `src/lib/sim/finance/`, and changes none of them. Rules below that are defined by code which is not exported (`segValue`, and `fundingOf`, `remake` and `take`, which are closures inside the funded pass) or which takes a `Run` (`respell`) are written again here; the tolerance and ledger tests hold them. Do not add an export to an old file.

## Interfaces

**S12** (decomposition choice; owner `world-core`). The hook `world-funding` plugs into `world-core`: `interface FundingSystem { create(world: World, statics: Statics, frame: PolicyFrame): void; policyChanged(ctx: StepCtx): void; moneyIn(ctx: StepCtx): void; onProjectEvent(ctx: StepCtx, e: WorldEvent): void; apply(ctx: StepCtx, lots: Int32Array): void; serve(ctx: StepCtx): void; shadow(ctx: StepCtx): void; planLot(ctx: StepCtx, lot: number): number }`, called at systems 1, 2, 3, 4, 5 and 7 of section 3.3 and whenever the due list plans a free lot (`planLot` returns the first model month in which the lot will apply, or 0). `interface StepCtx { world: World; due: Due; statics: Statics; timeline: PolicyTimeline; frame: PolicyFrame; month: number; seed: number; out: StepSink; firstDay: Day; lastDay: Day; startProject(lot: number, day: Day, funded: FundedStart | null): number; displace(row: number, lot: number, day: Day, units: number): void }`. `frame` is `timeline.frameAt(month)`. `displace` records the homes on the funded project's row and sends `'displaced'`. `world-core` exports `function withFunding(f: FundingSystem | null): { createWorld: typeof createWorld; step: typeof step; planDue: typeof planDue }`; with null, and whenever `frame.finance` is null, no hook is called and the world is the unfunded one. `interface FundedStart { kind: ProjectKind; view: ZoningView; f: number; units: number; stories: number; applied: Day; programmes: string[]; granted: number; lent: number; guaranteed: number; certain: boolean; pathway: Pathway | null }` (`pathway` null means the route is drawn as for any start). `world-funding` exports `function createFundingSystem(): FundingSystem`.

**S5** (model commitment; owner `policy-timeline`). `interface FinanceFrame { pools: Pool[]; programmes: Programme[]; offered: Uint8Array; slope: number; terms: ResolvedTerms; arrivals: { pool: number; day: Day; dollars: number }[] }`. `pools` and `programmes` list the same ids in the same order in every frame of one timeline, and an entry's definition is the one in force that month; `offered[g]` is 1 when programme g is in force on the first day of this month and its pool is not switched off that day. `arrivals` is the money reaching each pool on a day of this month, and month 1's list also holds what arrives on the dataset date itself; the step reads inflows from it and never from `pools[q].inflows`.

**S7** (model commitment; owner `world-core`). `interface StepSink { event(e: WorldEvent): void; ledger?(e: LedgerEvent): void }`. `type WorldEvent = { kind: 'start'; row: number; day: Day } | { kind: 'enter'; row: number; day: Day; stage: Stage } | { kind: 'revise'; row: number; day: Day; units: number; stories: number | null } | { kind: 'end'; row: number; day: Day; how: 'complete' | 'exit' | 'entitled' } | { kind: 'phaseFiled'; row: number; day: Day; phase: number } | { kind: 'award'; row: number; day: Day } | { kind: 'displaced'; row: number; lot: number; day: Day; units: number }`. `row` indexes `world.projects` (masters have rows too) and never changes for a project. Events of one step arrive in the order the systems made them. `'start'` is sent once per row when it comes to exist, before any other event of that row; `'entitled'` ends a master; `'displaced'` names the funded project's row. `LedgerEvent` is today's (`money.ts`).

**S1** (model commitment; owner `world-core`). `interface World { month: number; frame: number; lots: LotColumns; projects: ProjectColumns; line: LineColumns; pools: PoolColumns }`. Every column is a typed array or a plain array of numbers or strings; the world holds no functions, no generator and no reference to its inputs, so `structuredClone(world)` is a full copy. `month` is the last model month stepped (0 = the dataset date). `frame` is the `PolicyFrame.id` of that step. `lots` has rows only for lots that have left their starting state (section 3.1). `line` and `pools` are empty until `world-funding` fills them; between steps a world names a pool or a programme by its id, never by an index.

This subsystem defines the columns of `World.line` and `World.pools`. `pools` holds one row per pool id with its counters (`received`, `committed`, `spentGrant`, `outLoan`, `lostLoan`, `lostGuarantee`), and one row per awarded project that still has money events to come (its row in `projects`, the pool ids asked and the dollars granted, lent, guaranteed and reserved). Between steps nothing in the world is a pool index or a programme index: an application's bundle is a list of programme ids, mapped through the frame's arrays when it is priced.

## Rules

Today's rules are defined by `funded.ts`, `line.ts`, `funding.ts`, `money.ts` and the finance-engine spec (`2026-11-09-finance-engine-design.md`, sections 4.3 to 4.13). Each rule below says what it keeps and what it changes. "Month" below always means a model month unless it says lot-month.

### First task: measure

1. Before building the rest, measure on the bench city and (when a local copy is present) the live city with baseline funding: how many lots apply per month, how long the line is, and what one funded month costs for one world with a direct build of rules 2 to 13. Report to the conductor against the 9 ms constraint (96 worlds per month, so about 90 µs a world). If the direct build misses it, the grouped line (`line.ts:194-415`) and the per-lot rate tables (`funded.ts:480-557`) are the known remedies; say which is needed.

### Clocks and applying

2. Kept: per attempt, the draws `INIT`, `INIT_DAY`, `INIT_AFFORDABLE`, `INIT_DAY_AFFORDABLE`, `SIZE` on the attempt's stream (`funded.ts:984-992`). The size is the `SIZE` draw read in the frame's view.
3. Kept: the market rate of a lot-month is the lower of the ordinary rate and the rate shifted by the bundle on offer to a lot of that size; the affordable rate is the unshifted affordable rate where the bundle is empty and the shifted one where it is not; a certain bundle makes the rate certain (`segValue`, `funded.ts:452-478`). The bundle is the programmes with `offered[g] = 1` whose kind reaches the lot and whose `minHomes` the size meets, ascending.
4. Changed in form only: the two funded totals are evaluated as `world-core` rule 6 evaluates the ordinary one: over the frames the lot has lived through since it became free, then the current frame continuing, with the same lot-months. Nothing is stored. The market total never passes later than the ordinary one; where no lot-month so far had a lower rate, the two are the same clock (`funded.ts:836-850`).
5. Kept (finance-engine 4.4, `funded.ts:855`): a funded total that passes its threshold in a lot-month whose bundle is empty makes no application, and that spell of that kind is spent: planning it again never makes it apply later. Otherwise the lot applies on the day the kind's day draw gives inside that lot-month (the lot-month's first day for a certain bundle). `planLot` returns the model month that holds the earliest such day of the two kinds, or 0.
6. An application records: lot, kind, the day (`applied`), bundle, size, level, and its key.
7. Changed (design section 3.5): the key's second part, `keyDay`, is the first day of the lot-month in which the lot's ordinary total (market) or its unshifted affordable total (affordable) passes its threshold, evaluated when it applies as rule 4 evaluates a total; `NEVER_KEY_DAY` when it never does. The key is `lineKey(keyDay, rank, kind)`, unchanged.
8. A lot can hold one application of each kind. Both leave the line when either is awarded, when the lot's ordinary start happens (`onProjectEvent` with that `'start'`), or when both lapse.

### The line

9. Changed (R5): the line's order is (the model month applied, then the key). `applied` is recorded and shown, and orders nothing. New applications of a month join after everything already waiting, in key order.
10. Kept: serving is one scan in line order; each application is tested with `awardSet` against the pools as they stand; an award takes it (`line.ts:70-131`). Changed: `serve` runs once per month, after the month's applications have joined. There is no second scan in the same month, and money that moves after it waits for next month's scan.
11. An award calls `startProject(lot, day, funded)`. `day` is the latest of: the application's `applied` day if it applied this month, else the month's first day; and the day of the latest money that reached, this month, any pool the award draws on (an arrival, a release, a repayment) (design ruling T17). `funded` carries the kind, the view, the size, `applied`, the ids of the programmes that pay, the project's dollars granted, lent and guaranteed as `fundingOf` computes them (`funded.ts:1657-1675`), `certain`, and `pathway`: `'streamlined'` for a Local Program lot, the `affordableRoutes` draw (`pathwayFrom` on the attempt's stream) for a certain affordable award, else null (`funded.ts:1741-1745`). The award sends `'award'` and commits the asks to their pools on `day`.

### Money

12. `moneyIn` receives every entry of the frame's `finance.arrivals` on its day. Month 1's list includes what arrives on the dataset date (today's first baseline inflow). Nothing is laid out ahead, and `pools[q].inflows` is never read.
13. Changed (design section 3.5): today `Treasury.award` books every later money event from the finished schedule (`money.ts:97-163`). Here each is made in `onProjectEvent` when the project's event happens: spend and lend on entering construction, repayment on completion, release or loss on dropping out, with today's amounts and today's `LedgerEvent`s. The builder reads `money.ts:20-213` and keeps every event kind and amount; only the moment it is written changes.
14. Pool state is kept whether or not the sink has a `ledger`; with none, no event object is built and every decision is the same.
15. The ledger identities E1 to E7 of the finance-engine spec hold after every step.
16. Kept (finance-engine "known limit"): the engine never looks ahead at inflows to decide an award.

### Change of policy

17. `policyChanged` is called by `world-core`'s system 1, that is, when the frame's id differs from the last step's. If the money in force (the frame's identity, rule 16 of the `policy-timeline` spec) and the view are both unchanged, it does nothing. Otherwise, in line order, each waiting application is re-made under the new frame as `remake` does (`funded.ts:1684-1720`): the size in the new view, the new bundle; it keeps its place and its key. It lapses when it has no size or no chance in the new view, its new bundle is empty, or its new level is below its old one.
18. A lapsed kind starts a new spell from the first day of this month on the same draws, as `respell` does (`funded.ts:1033-1051`), and is planned again.
19. Free lots that have not applied are planned again only when the change can alter their rates: `offered`, a programme's definition, `terms`, `slope`, or the lot's row in the view (`timeline.touched`). A change to arrivals alone replans nothing.

### Shadow starts

20. Changed (design section 3.5): when an award pre-empts an ordinary start, the lot keeps a shadow: the attempt and the day it became free. Each month `shadow` evaluates the ordinary total as `world-core` rule 6 does. In the month that holds the ordinary start day it gives (from `INIT_DAY`), it calls `displace(row, lot, day, units)` with that day, the funded project's row, and the homes that ordinary start would have added (its size in the view then, less the lot's existing homes), and the shadow ends. Nothing later cancels a shadow.

### No money

21. With the frame's `finance` null, or with no programme offered in any month, every world is the unfunded world exactly.

## Tests that must pass

Assert, in signoff:

- The tolerance test of the global constraints on the bench city with baseline funding and with the bench funding set (`bench-bond`, `bench-loan`, `bench-certain`, `bench-afford`), seeds 1 to 200. It prints its numbers and the count of starts that were funded here and ordinary in the old engine in the same month (design T3). A miss fails the test and is reported to the conductor with the numbers; no rule is changed to meet it. The same test on the live city runs when a local copy is present. Ruled by the partner 2026-11-13 after the measurement: with the bench funding set the mean number of awards differs from today's engine by 0.275, 0.18, 0.09 and 0.035 at years 5, 10, 20 and 40, because the line is served once a month in rule 9's order and not by application day (homes agree within tolerance). Rule 9 is kept: funders consider applications in batches, and day-order parity is not a goal. For the bench funding set the test asserts net mean, net sd and funded homes at the tolerance, prints the awards ratios, and asserts only that they stay within 0.03 of the recorded values. The full test runs behind `SFH_WORLD_FUNDING_REFEREE=1`; signoff runs the ledger identities on a few seeds.
- Ledger identities E1 to E7 after every step: on every seed of the tolerance test, and on 200 seeded random finances on the mini city (as the finance-engine spec's conservation property does).
- The calendar-month money series of world 1 (built by today's `poolSeries` from the ledger) satisfies I1 to I6 of the finance-score spec.
- Rule 12: under the default baseline, after month 1 every capped baseline pool has received its first year's inflow.
- Rule 21: a timeline whose finance offers nothing gives the same events as no finance, seed for seed.
- Rule 14: one world stepped with and without a `ledger` gives the same events.
- Rule 5: a programme that opens at month m does not make lots whose funded total passed earlier apply in month m.
- A pool switched off from month m: no award from that pool on or after month m; applications whose bundle becomes empty lapse and are planned again.
- An arrival raised from month m: every event before month m is identical.
- Rule 16: the finance-engine spec's known-limit case, carried over.
- A certain affordable award: route from `affordableRoutes`, within 3 standard errors over 500 seeds, as today's test.
- `structuredClone` round trip: stepping a copied world (line and pools included) gives the same events and the same ledger.
- Line order: for a hand-built month with three applications, the scan order is (month applied, key day, parcel rank, market before affordable).
- Permuting the lot table's rows gives the same events and ledger.

`test:perf` (prints; asserts the bar only there): one funded month for one world on the bench city, bar 90 µs.

Docs: a "Public money" section in `docs/dev/step-engine.md`.

## Left to the builder

- The columns of `line` and `pools`.
- Whether the line is scanned directly or grouped, and whether rate tables are kept, as rule 1's measurement decides. Either way the scan order is rule 9's.
- How the shadow is stored.

Decided here, not left: when a spell is spent (rule 5), the key day (rule 7), the line's order (rule 9), the award day and the route (rule 11), when money events are written (rule 13), when lots are replanned (rule 19), and the day and permanence of a shadow (rule 20).

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
