# world-core: the world, the draws and the step

Part of the step-engine package. Design: [2026-11-12-2305-sim-step-engine.md](../design/2026-11-12-2305-sim-step-engine.md), approved 2026-11-13. Release A. Depends on nothing in the package; `policy-timeline` supplies the timeline it reads (rows S4 to S6), and tests here build timelines by hand.

## Purpose

Today's engine works out a project's whole life when the project begins, for one policy, to a fixed end date. This subsystem is the same model run one month at a time: a world is a set of tables, and `step` moves it forward one month under whatever policy is in force that month. It covers everything that needs no public money. `world-funding` plugs into it for the rest.

The test of this subsystem is today's engine. Under a policy that never changes and without public money, a world must give the same projects on the same days as `simulateDetailed`, seed for seed.

## Scope

- The world's tables and how they are made at the dataset date.
- Draws (reused, unchanged).
- The due list.
- The step: its systems, their order, and every rule that needs no money.
- The readers that turn a world's rows back into today's `Schedule` and `Master`.
- The hook `world-funding` plugs into.

Not in scope: applications, the line, pools, awards, money events (`world-funding`); what a frame contains and how it is compiled (`policy-timeline`); running many worlds, slicing, copies (`ensemble-runner`); series and scores (`world-score`); reservations and freed land (out of the package).

Code lives in `src/lib/sim/world/`. It imports the pure functions it needs from the old folders: `draw`, `drawOn`, `streamOf` and `P` (`rng.ts`), `piecewiseMonth` and `precomputeOf` (`input.ts`), `sampleTransition`, `sampleKind`, `sampleTime`, `sampleAdvance` (`timelapse/model.ts`), `exp` and `log` (`timelapse/math.ts`). It changes no file there. The old engine's own steps (`pipelineRow`, `pipelinePass`, `masterOf`, `multiPhasePass`, `phaseSchedule`, `stageStep`, `runStages`, `initiationMonth`, `initiationDay`, `newPathway`, `simulatedPass`, `simulatedProject`, `startSimulated`, `ordinaryDay`) are either not exported or take a `Run` that carries an end date: write them again here, and let the referee tests hold the two equal. Do not add an export to an old file.

## Interfaces

**S1** (model commitment; owner `world-core`). `interface World { month: number; frame: number; lots: LotColumns; projects: ProjectColumns; line: LineColumns; pools: PoolColumns }`. Every column is a typed array or a plain array of numbers or strings; the world holds no functions, no generator and no reference to its inputs, so `structuredClone(world)` is a full copy. `month` is the last model month stepped (0 = the dataset date). `frame` is the `PolicyFrame.id` of that step. `lots` has rows only for lots that have left their starting state (section 3.1). `line` and `pools` are empty until `world-funding` fills them; between steps a world names a pool or a programme by its id, never by an index.

**S2** (model commitment; owner `world-core`). `function createWorld(statics: Statics, timeline: PolicyTimeline, seed: number, out: StepSink): World` makes the world at month 0 under `timeline.frameAt(1)` and sends the events already true at the dataset date. `function step(world: World, due: Due, statics: Statics, timeline: PolicyTimeline, seed: number, out: StepSink): void` advances `world` in place by one model month (to `world.month + 1`), running the systems of section 3.3 in that order over the entities due that month. Both are pure in their arguments and take no end date. `step` reads `timeline` only for months up to the one it is stepping: the past is known, the future is not.

**S3** (model commitment; owner `world-core`). `interface Statics { asOf: Day; parcelId: ParcelId[]; rank: Uint32Array; projects: InFlightProject[]; districtMaxStories: number | null }`: what no policy can change. Row i of `parcelId` is row i of every `ZoningView`. `function staticsOf(input: SimInput): Statics` builds it from the loaded dataset.

**S7** (model commitment; owner `world-core`). `interface StepSink { event(e: WorldEvent): void; ledger?(e: LedgerEvent): void }`. `type WorldEvent = { kind: 'start'; row: number; day: Day } | { kind: 'enter'; row: number; day: Day; stage: Stage } | { kind: 'revise'; row: number; day: Day; units: number; stories: number | null } | { kind: 'end'; row: number; day: Day; how: 'complete' | 'exit' | 'entitled' } | { kind: 'phaseFiled'; row: number; day: Day; phase: number } | { kind: 'award'; row: number; day: Day } | { kind: 'displaced'; row: number; lot: number; day: Day; units: number }`. `row` indexes `world.projects` (masters have rows too) and never changes for a project. Events of one step arrive in the order the systems made them. `'start'` is sent once per row when it comes to exist, before any other event of that row; `'entitled'` ends a master; `'displaced'` names the funded project's row. `LedgerEvent` is today's (`money.ts`).

**S8** (model commitment; owner `world-core`). Readers of a world: `function scheduleAt(world: World, statics: Statics, row: number, day: Day): Schedule | null` and `function masterAt(world: World, statics: Statics, row: number, day: Day): Master | null` give the row as today's types, as a reader standing on `day` sees it (nothing dated after `day`; `end.kind` is `'open'` when it has not ended by then). One of the two is non-null for every row.

**S9** (model commitment; owner `world-core`). Draws: `draw(seed, entity, k, purpose, stageIdx)` and the purposes in `rng.ts`, imported unchanged.

**S11** (decomposition choice; owner `world-core`). `interface Due { take(month: number): Int32Array; put(entity: number, month: number): void; drop(entity: number): void }` and `function planDue(world: World, statics: Statics, timeline: PolicyTimeline, seed: number, through: number): Due`, which works out from scratch what is due in months `world.month + 1 .. through`, reading `timeline` for months up to `world.month + 1` only. An entity is a lot (its row in `Statics.parcelId`) or a project (`-1 - row`). `take` returns that month's entities in ascending order and forgets them. An entity due after `through` is planned when the runner extends the window.

**S12** (decomposition choice; owner `world-core`). The hook `world-funding` plugs into `world-core`: `interface FundingSystem { create(world: World, statics: Statics, frame: PolicyFrame): void; policyChanged(ctx: StepCtx): void; moneyIn(ctx: StepCtx): void; onProjectEvent(ctx: StepCtx, e: WorldEvent): void; apply(ctx: StepCtx, lots: Int32Array): void; serve(ctx: StepCtx): void; shadow(ctx: StepCtx): void; planLot(ctx: StepCtx, lot: number): number }`, called at systems 1, 2, 3, 4, 5 and 7 of section 3.3 and whenever the due list plans a free lot (`planLot` returns the first model month in which the lot will apply, or 0). `interface StepCtx { world: World; due: Due; statics: Statics; timeline: PolicyTimeline; frame: PolicyFrame; month: number; seed: number; out: StepSink; firstDay: Day; lastDay: Day; startProject(lot: number, day: Day, funded: FundedStart | null): number; displace(row: number, lot: number, day: Day, units: number): void }`. `frame` is `timeline.frameAt(month)`. `displace` records the homes on the funded project's row and sends `'displaced'`. `world-core` exports `function withFunding(f: FundingSystem | null): { createWorld: typeof createWorld; step: typeof step; planDue: typeof planDue }`; with null, and whenever `frame.finance` is null, no hook is called and the world is the unfunded one. `interface FundedStart { kind: ProjectKind; view: ZoningView; f: number; units: number; stories: number; applied: Day; programmes: string[]; granted: number; lent: number; guaranteed: number; certain: boolean; pathway: Pathway | null }` (`pathway` null means the route is drawn as for any start). `world-funding` exports `function createFundingSystem(): FundingSystem`.

Read from other owners, repeated here so the builder has them:

**S4** (model commitment; owner `policy-timeline`). `interface PolicyFrame { id: number; view: ZoningView; calibration: Calibration; newCalibration: Calibration; speed: StageScale; speedNew: { from: Day; scale: StageScale }[]; market: number; finance: FinanceFrame | null }`: everything the step reads for one month. `interface ZoningView { parcels: ScenarioParcels; pre: Precompute }` is the lot table and start rates under the zoning in force. `calibration` serves rows in flight, masters and phases; `newCalibration` (route shares, the Local Program switch) serves a project at the moment its route is drawn. A project's time in a stage is scaled by `speed` times every `speedNew[i].scale` whose `from` is before the day the project filed (or which finds it not yet filed), the product clamped to `[MIN_SCALE, MAX_SCALE]` of `levers/timers.ts`. `market` is the shift in the log-odds of starting. `id` is the same for two frames, from any compile in one worker, exactly when their content is equal, `finance.arrivals` apart.

**S5** (model commitment; owner `policy-timeline`). `interface FinanceFrame { pools: Pool[]; programmes: Programme[]; offered: Uint8Array; slope: number; terms: ResolvedTerms; arrivals: { pool: number; day: Day; dollars: number }[] }`. `pools` and `programmes` list the same ids in the same order in every frame of one timeline, and an entry's definition is the one in force that month; `offered[g]` is 1 when programme g is in force on the first day of this month and its pool is not switched off that day. `arrivals` is the money reaching each pool on a day of this month, and month 1's list also holds what arrives on the dataset date itself; the step reads inflows from it and never from `pools[q].inflows`.

**S6** (model commitment; owner `policy-timeline`). `interface PolicyTimeline { frameAt(month: number): PolicyFrame; changes(): number[]; touched(month: number): Int32Array | null; readyThrough(): number }`. `frameAt` is synchronous for 1 <= month <= `readyThrough()`. `changes()` lists, ascending, the months whose frame id differs from the month before. `touched(month)` gives, for a month in `changes()`, the lot rows whose row of the zoning view differs from the month before (empty when the zoning did not change; null when every lot may differ). `function firstDifference(a: PolicyTimeline, b: PolicyTimeline): number | null` is the first month at which the two give frames with different ids or different `finance.arrivals`, or null.

## Rules

Each rule below is today's rule unless it says "new". Today's rules are defined by the code named; the referee tests are what holds this subsystem to them. The spike's code (`.superpowers/superconductor/sim-step-engine/spike/world.ts.txt`) passed the referee for rules 1 to 14 under one frame and may be read as a worked example. It is not to be copied in as is: it kept a dense per-lot table and has no events, no readers and no hook.

### Months and days

1. Model month m (m >= 1) covers days `asOf + floor((m - 1) × 30.436875) + 1` to `asOf + floor(m × 30.436875)`. `StepCtx.firstDay` and `lastDay` are those two days for the month being stepped; `StepCtx.month` is m.
2. Every event keeps its day. Days do not order anything between entities. Within a system, lots are handled in the order of `Statics.rank` and projects in the order of their rows, unless a rule here gives another key. Permuting the rows of the lot table (same ids, same ranks) must give the same events.

### The world at the dataset date

3. `createWorld` makes one row in `projects` for every pipeline project, master and phase that exists at the dataset date, as `pipelinePass` and `multiPhasePass` treat them (`engine.ts:661-704, 714-898`), and sends for each a `'start'` event followed by an `'enter'` event for every stage already entered, with their real (past) days. A pipeline row already in a stage has that stage's outcome and length drawn given the time it has already spent there (`engine.ts:490-534`).
4. `lots` starts empty. A lot gets a row the first time something happens to it that its draws and the timeline alone do not say: a project starts on it, a pipeline project holds it, or it is freed.

### Starts (the ordinary clock)

5. A free lot's attempt k has threshold `-log(1 - u)`, u its `INIT` draw on the stream of (seed, lot entity, k). Each lot-month the lot is at risk adds `-log(1 - h)`, h being the chance of starting in the view of the frame in force, shifted by that frame's `market`. The lot's months count from the day it became free (the dataset date for a lot never held), 30.436875 days each, and a lot-month takes the frame of the model month that holds the lot-month's first day. The lot starts in the first lot-month whose total passes the threshold; the day inside it comes from `INIT_DAY` (`engine.ts:934-975`, `input.ts:243-263`, `funded.ts:391-395` for the day). The lot is due in the model month that holds that day.
6. Nothing is added up month by month and no total is stored (design ruling T10). To plan a lot, the engine evaluates `piecewiseMonth` over the frames the lot has lived through since it became free (read from `timeline` for months up to the one being stepped) followed by the current frame continuing without end. A lot with no chance of starting under the current frame is not planned.
7. New: when the frame changes in month m, the lots in `timeline.touched(m)` are planned again; when `touched(m)` is null, or `market` differs, every free lot is. A lot already due in a month before m is not affected. Because rule 6 reads the past frames, a lot's chance built up before m is kept without being stored.
8. At the start: the route is drawn on the frame's `newCalibration` (a Local Program lot in the frame's view is streamlined), the size on the frame's view (`SIZE`, against the lot's existing homes, or 0 once its building has been demolished), as `simulatedProject` and `newPathway` do (`engine.ts:901-1005`). The project's row stores what it needs from the view it started under and never holds the view: level, homes, stories, existing homes, and the lot's yield at every level, which later revisions are capped by.
9. Holds: a lot is free only when every project holding it has dropped out. It is blocked for good if any holder completes, is skipped, or is still alive. A master passes its holds to its phases at entitlement. A lot freed by a drop-out is at risk again from the drop-out day on attempt k + 1; once a project has entered construction on it, its existing homes count as 0 (`funded.ts:1595-1602`, `engine.ts` `Holds`).

### Stages

10. On entering a stage a project's outcome and its length at normal speed come from its `STAGE` and `STAGE_TIME` draws (`sampleTransition`, `sampleKind`, `sampleTime`), on the frame's `newCalibration` if the project had not filed at the dataset date and on its `calibration` otherwise (`scenario/types.ts:101-108`). Rule 15 is the exception.
11. The speed s of a project in a stage is the frame's `speed` for its route and stage, times every `speedNew[i].scale` for that route and stage whose `from` is before the day the project filed, or which finds it not yet filed; the product is clamped to `[MIN_SCALE, MAX_SCALE]` (`levers/timers.ts:37-50`). While s does not change, the stage ends on `entered + floor(s × length)`; for a pipeline row already in the stage at the dataset date, on `survived + floor(s × (length - survived))` counted from the stage's entry, as today.
12. New: when a frame change alters s for a project in a stage, on the first day c of that month: `used += (c - anchor) / s_old`, `anchor = c`, and the end becomes `c + floor(s_new × (length - used))`. The outcome never changes. If the new end is before c, the stage ends on c.
13. Entering a stage may revise the size (`REV`, `REV_RATIO`), with today's merge rules for revisions on one day and today's cap by the start view's yields. Phases file after their master's entitlement by the plan date or the `PHASE_GAP` draw, as today.
14. A chain inside one month is followed to its end in that step: a project that enters a stage and leaves it the same month, or a lot that is freed and starts again in the same month.
15. A project started with `FundedStart.certain` true (finance-engine spec 4.9, `engine.ts:509-523`): every stage's outcome is advance; `STAGE` is not read; its length at normal speed is `sampleAdvance(t, STAGE_TIME draw).days`; rules 11 and 12 scale it like any other; it has no revisions.

### The step

16. Systems, in order: (1) policy, when `frame.id !== world.frame`: rules 7 and 12, then `FundingSystem.policyChanged`; (2) `moneyIn`; (3) stages due this month, with `onProjectEvent` called for each event sent; (4) lots whose funded application falls this month go to `apply`, and lots whose ordinary start falls this month are set aside; (5) `serve`; (6) the lots set aside start, unless a project started on them in (5), and `onProjectEvent` is called for each `'start'`; (7) `shadow`. A project started in (5) or (6) that enters or leaves a stage in the same month has each of those stage events (`'enter'`, `'revise'`, `'end'`, `'phaseFiled'`) passed to `onProjectEvent` too, since every stage event moves money (`world-funding` rule 13); the `'start'` of a project the funding system itself started in (5) is not passed back (conductor ruling, 2026-11-13). Then `world.month += 1` and `world.frame = frame.id`.
17. `StepCtx.startProject(lot, day, funded)` is the one way a project begins, for system 6 (`funded` null) and for `world-funding`'s awards. It makes the row, draws the route by rule 8 unless `funded.pathway` is set, takes the size from `funded` when given, stores `funded`'s programmes and dollars on the row, sends `'start'` then `'enter'`, plans the project's first stage end, follows rule 14, and returns the row. `StepCtx.displace(row, lot, day, units)` adds `units` to the row's displaced homes and sends `'displaced'`.
18. With no `FundingSystem`, or when the frame's `finance` is null, the step calls no hook and behaves as rules 1 to 16 without systems 2, 5 and 7.
19. `step` asserts `timeline.readyThrough() >= world.month + 1` and never calls `frameAt` for a later month.

### The due list

20. `planDue` and the planning inside `step` must agree: for any world reached by stepping, `planDue(world, …, through)` gives the same months for the same entities as the due list that was carried along, including after frame changes. A test steps one world two ways (carried list, and a list rebuilt every 12 months) and compares every event.
21. Nothing is planned past `through`. When the runner extends the window it calls `planDue` again; an entity due inside the new window is never missed.

### Readers

22. `scheduleAt` and `masterAt` build today's types from the row. Fields that today's engine fixes when the project begins and this engine learns later (a stage day, the end, a revision, `funding.displaced`) appear only once their day is at or before `day`. `funding` is built from what rule 17 stored.

## Tests that must pass

Referee (exact; these assert, and run in signoff on the bench city and the fixture). Cities: the bench city (`synthCity`), the fixture dataset, and the live city when a local copy is present (skipped, not failed, when it is not). Seeds 1 to 20 on the first two, 1 to 5 on live.

- One frame, no money: after stepping through the month that holds the horizon day, `scheduleAt` and `masterAt` over every row at the horizon equal `simulateDetailed(input, seed, horizon)`'s schedules and masters, compared as sorted lists with deep equality. Repeat with `market` shifted; with `speed` not 1 (today's `inFlightScale`); with a `speedNew` entry from `asOf + 1` (today's `newProjects.scale`); and with `newCalibration` carrying route shares.
- A zoning change in mid-run equals today's dated zoning: a timeline whose view changes at month m gives the same schedules as `simulateDetailed` on an input with one `regimes` entry dated the first day of month m.
- A market change in mid-run equals today's `market` step dated the first day of month m.

Properties (assert, in signoff).

- A change of speed in mid-run, without money: every event before the change is identical to the unchanged run; no project's outcome differs; with a scale below 1 no day moves later, above 1 none earlier.
- A zoning change at month m: every event dated before month m is identical; every lot not in `touched(m)` has identical events for the whole run.
- `structuredClone(world)` then stepping the copy with a rebuilt due list gives the same events as stepping the original, including across a frame change.
- Rule 20's two-way test, with a frame change inside the run.
- Rule 2's permutation test.
- The same inputs give byte-identical event streams in Node and in the browser test project.
- Events: `'start'` precedes every other event of its row; no event has a day outside the month being stepped, except those `createWorld` sends.
- A certain funded start (through a stub `FundingSystem`) has `sampleAdvance` lengths, no revisions and no drop-out.
- The ESLint determinism rule covers `src/lib/sim/world/**` (global constraints).

Cost (`test:perf`; each prints its number and asserts the bar only there; ballpark numbers on a busy machine are marked so).

- 48 worlds, one month, no money, bench city: at most 3 ms.
- `createWorld` plus `planDue` through month 480, live city, one world: printed, no bar. The conductor reads the runner's measurement of 96 worlds for the decision.

Docs: a new `docs/dev/step-engine.md` (the world, the step, the due list, the hook), linked from `CLAUDE.md`.

## Left to the builder

- The columns of `LotColumns` and `ProjectColumns`, and how rows are found by lot or by project id.
- The data structure behind `Due`.
- How the files are split inside `src/lib/sim/world/`.
- Whether to keep the shortcut that skips a lot whose draw cannot pass within `through` (today's `skipAbove`); it must not change any event inside the window.

Decided here, not left: that no start total is stored (rule 6), the system order (rule 16), which calibration serves which project (rule 10), the speed rule and its clamp (rules 11 and 12), what `touched` means for planning (rule 7), the certain-project rule (rule 15), the order inside a system (rule 2), and the event order (S7).

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
