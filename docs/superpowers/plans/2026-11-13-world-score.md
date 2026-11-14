# world-score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build each world's calendar-month series from `WorldEvent`s, the across-world chunks (mean, sample sd, "this city", plan effect, money, tiers), the page's `TimelineView`, and the world-1 project card, in `src/lib/sim/world/score/`.

**Architecture:** One `WorldSeries` per world files every event as a per-calendar-month delta, with the same rules `shownSeries` applies to a finished run (`score.ts:82-225`). A month becomes final when the world has stepped through the model month holding its last day. Final months stay fixed, so prefix sums are built incrementally. `chunkOf` reduces the plan and comparison ensembles' rows month by month. `viewOf` joins chunks into what the page reads. `cardAt` reads world 1 through world-core's readers and reuses `chooseProject` and `projectCard` unchanged. Money and tiers come last, after world-funding merges.

**Tech Stack:** TypeScript (pure, worker-safe), Vitest (`server` project for specs, `perf` project for the timing bar).

**Spec:** `docs/superpowers/specs/2026-11-13-world-score-design.md` (binding). Design: `docs/superpowers/design/2026-11-12-2305-sim-step-engine.md` (sections 3.5, 3.6, 5.3 T1, 7). Ledger findings F10, F13 and T1 in the conductor's `.superpowers/superconductor/sim-step-engine/ledger.md`.

**Worktree:** `/Users/mindlace/Projects/sfhousing/.claude/worktrees/sim-step-engine/.claude/worktrees/step-world-score`, branch `step-engine/world-score`. `cd` into it on its own line, and never compound `cd … && …`.

## Global Constraints

Copied verbatim from the spec:

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

Operator rules for this build (from the dispatch and `operator-standing-rules.md`):

- Code goes only in `src/lib/sim/world/score/`. Do not change any hashed folder or any other spec's files: the world-core top-level files and `test/`, `policy/`, `funding/`, `map-stream.ts`. If a change is needed elsewhere, ask `main` (see Open questions). Do not build around it.
- Add no new exports to old files. `Math.exp`/`log`/`pow`/`log1p`/`expm1` and `**` are forbidden here; `Math.sqrt` is allowed.
- **Measurement lock.** Before any heavy command (a test file over the bench city, `npm run check`, `npm run lint`, a full `test:unit`), check `/Users/mindlace/Projects/sfhousing/.claude/worktrees/sim-step-engine/.superpowers/sdd/measure.lock`. If it exists and its `owner` is not `world-score`, run `sleep 60` in the foreground and retry. The perf test (Task 13) runs only while you hold the lock: `mkdir` the directory, write `world-score` to `owner`, wait 30 s, run, then `rm -r` it at once (hold it 15 min at most).
- Run everything in the foreground. Do not push, open a PR or run signoff.
- Commits use Conventional Commits, with the message written to a temp file in the scratchpad and committed with `git commit -F <file>`. No Claude attribution anywhere.
- Every test calls `expect` (`expect.requireAssertions`).

**S15 interface text (verbatim from the spec; these shapes do not change without asking `main`):**

> **S15** (decomposition choice; owner `world-score`). `interface SeriesChunk { from: number; mean: MonthRow[]; sd: MonthRow[]; shown: MonthRow[]; planEffect: { mean: PlanRow; sd: PlanRow }[]; money: MoneyRow[] | null; tiers: TierUnits[] | null }`: one entry per calendar month from index `from`. `MonthRow` has today's `TimelineScore['shown'][number]` fields; `shown` is world 1 ("this city"). `PlanRow` is `{ entitledNew: number; completedNetNew: number }`. `MoneyRow` is one month's entry of every series in today's `TimelineScore['money']`. `interface WorldSeries { add(e: WorldEvent, world: World, statics: Statics): void; stepped(month: number): void; finalThrough(): number; rows(from: number, through: number): MonthRow[]; data(): WorldSeriesData }`, one per world, which the runner feeds (`stepped` after each step, with the model month just stepped); `WorldSeriesData` is plain data that `structuredClone` copies. `function createWorldSeries(s: ScoreStatics, from?: WorldSeriesData): WorldSeries`. `function chunkOf(plan: WorldSeries[], twin: WorldSeries[], money: MoneyFeed | null, from: number, through: number): SeriesChunk`. `interface MoneyFeed { ledger: LedgerEvent[]; finance: FinanceFrame; world: World; statics: Statics }` is world 1's. `function scoreStaticsOf(input: SimInput, timeline: PolicyTimeline, base: 'plan' | 'preFzp', windowMonths: number): ScoreStatics`, called once the plan timeline is fully compiled. `function viewOf(chunks: SeriesChunk[], statics: ScoreStatics): TimelineView` builds what the page reads. `function cardAt(world: World, statics: Statics, frame: PolicyFrame, deps: CardDeps, parcelId: ParcelId, day: Day, projectId?: string): { summary: ParcelSummary; lookups: Lookups | null }`, which the runner calls to answer `parcelSummary` from world 1.

The "Defined here" block of the spec (`ScoreStatics`, `TimelineView`, `MoneyRow`, `MoneyView`) is binding as written. Task 1 transcribes it.

## What world-core provides today (read at source, commit 946a379a)

- **The bench city** is `synthCity()` (`src/lib/sim/scenario/fixtures/synth-city`), a 150k-lot synthetic city with `finance` stripped: `benchInput()` in `src/lib/sim/world/test/cities.node.ts:22-35`. `fixtureInput()` (`:101-103`) loads `e2e/fixtures/data/fixture-0` through `loadScenario`. `liveDir()` (`:106-123`) returns `SFH_WORLD_LIVE` or the newest `pipeline/out/` dataset, or null. These are Node only. `miniInput()` (`test/mini.ts`) is browser-safe.
- **One frame:** `oneFrame(frameOf(input))` (`test/timeline.ts:42-63`). The old engine's matching input is `oldInputOf(input)` (`:116`). The referee pattern is `referee.spec.ts:14-28`: `simulateDetailed(oldInputOf(input), seed, HORIZON)` against a world run to `horizonMonth(input.asOf)` (`test/run.ts:19-21`), with `HORIZON` = 2066-12-31 (`src/lib/fzp/time.ts:21`).
- **Driving a world:** `createWorld(statics, timeline, seed, sink)`, then `planDue(w, statics, timeline, seed, through)`, then `step(w, due, statics, timeline, seed, sink)` once per month (`index.ts:24-28`; loop in `test/run.ts:41-63`). `Recorder` (`test/run.ts:24-31`) tags each event with the month of the call that sent it, 0 for `createWorld`.
- **`createWorld` sends events before it returns the world** (`world.ts:101-125` → `pipeline.ts:194-292`). So a sink cannot call `series.add(e, world, …)` live for month 0, and the creation events have to be buffered and added once `createWorld` returns. The series therefore reads only per-row facts that never change (origin, `src`, existing homes, the first revision, `funded`). It carries everything else in its own state (Task 2).
- **Events world-core emits** (from `grep event(` over `src/lib/sim/world/*.ts`):
  - Pipeline row at creation: `'start'` on its first entered day, then one `'enter'` per entered stage in `STAGE_ORDER` (`pipeline.ts:241-242`, `sendEntered` at `:171-177`). History days are clamped to `asOf` (`:222`).
  - Master at creation: `'start'`, the `'enter'`s, and for one entitled by `asOf` an `'end'` `'entitled'` (`:273-276`, `:289-290`). A `permitOnly` master has no `entered.entitled` (`:268`), so its entitlement appears only as the `'end'`.
  - Phase filing: `'phaseFiled'` with `row` = the master and `phase` = i, then the phase row's `'start'` and `'enter'` `permitFiled` (`:379-391`).
  - A stage move: `'enter'` (`:440`, `:448`). It is followed on the same day by `'revise'` when the entry revises (`:456-466`; the new units are in the event). Then `'end'` `'complete'` after `'enter'` `complete` (`:450-452`), `'end'` `'exit'` with no `'enter'` (`:430-431`), and a master's `'end'` `'entitled'` (`:443`).
  - Ordinary start: `'start'` then `'enter'` of the first stage (`world.ts:370-371`).
  - `'displaced'` only through `StepCtx.displace`, which only a funding system calls (`world.ts:414-424`).
  - `'award'` is never sent by world-core. world-funding sends it.
- **Revisions:** `pushRev` merges a revision dated on the last entry's day into that entry, and the first entry is never removed (`columns.ts:151-190`). `reviseOnEntry` can fire on any stage before construction, `entitled` included (`stage.ts:112-126`).
- **Readers:** `scheduleAt` returns null for master rows and for a row with no entered day ≤ `day` (`read.ts:96-100`). It sets `inFlight: true` on every phase row (`:143`) and on a pipeline row with `isNew` 0 (`:123`), and never sets `regime`. `funding.displaced` is `displacedOf(p, row, day)` (`:88`). `masterAt` (`:148-168`) does not check the first day.
- **Policy:** `PolicyFrame`, `FinanceFrame`, `PolicyTimeline` are in `policy/frame.ts`. `lookupsAt(frame): LeverLookups` is in `policy/lookups.ts:36`. `newScale(frame)` (`:11`) is private. Compiled frames carry no per-lot rule attribution (`docs/dev/policy-timeline.md`).
- **Old code reused:** `monthsOf`, `monthIndexer`, `shownSeries`, `targetsOf`, `tierTargetsOf`, `phasingOf`, `REFERENCES`, `RHNA_DEADLINE` (`scenario/score.ts:25, 37, 183, 296, 312, 261, 341, 293`). `poolSeries`, `addedBorrowing`, `tiersOf`, `tierContext`, `tierBaselineOf`, `perAddedHome` (`finance-score.ts:382, 468, 215, 137, 277, 560`). `limitStatements` (`src/lib/sim/finance/debt.ts:183`). `chooseProject`, `projectCard`, `revisionAt`, `CardCtx` (`card.ts:57, 151, 76, 14`). `Lookups` (`levers/apply.ts:37`). `ParcelSummary` (`src/lib/sim/protocol.ts:72-87`). The references filter is `levers/apply.ts:157-160`.

## Review Focus

1. **Feeding order.** Events can be added live during a step, buffered and added after `createWorld` or a step returns, or all added after the run against the final world. All three must give identical rows. Task 2 pins this.
2. **Same-day revisions.** A `'revise'` on the day a row enters a stage, its start day included, or its `entitled` day, must give exactly what `unitsOn`/`addStage` give. That covers `entitledNew` taking the revised units and a zero-length span adding nothing. Task 2 pins this with a hand-fed event sequence on a real world row.
3. **A delta landing in a final month** would silently change a number the page already shows. The series throws instead. Task 2 pins it.
4. **Ensemble edge cases.** W = 1 gives `sd` 0, not NaN (builder's call). Plan and twin of different lengths, or `through` past any world's `finalThrough`, throw. Task 4 pins these.
5. **A refill that cuts through the middle of a chunk** must leave the view exactly as a fresh fill would. Task 5 pins this with a cut inside a chunk.

---

## File Structure

All new, all under `src/lib/sim/world/score/`:

| File | Responsibility |
| --- | --- |
| `types.ts` | `MonthRow`, `PlanRow`, `MoneyRow`, `SeriesChunk`, `WorldSeries`, `WorldSeriesData`, `MoneyFeed`, `ScoreStatics`, `TimelineView`, `MoneyView`, `CardDeps` |
| `statics.ts` | `scoreStaticsOf`; `horizonOf(s)` (last day of month `lastIndex`); `finalTable(s)` (calendar month → model month that finalises it) |
| `series.ts` | `createWorldSeries`: event filing (rules 1-4), the private extras accessor used by `chunkOf` after the gate |
| `chunk.ts` | `chunkOf` (rules 6-9) |
| `view.ts` | `viewOf`, `chunksBefore` (rules 10-13) |
| `card.ts` | `cardAt` (rules 14-15) |
| `money.ts` | after the gate: the ledger filed by calendar month, `MoneyView` (rules 9, 12) |
| `index.ts` | the public surface |
| `test/feed.ts` | test support: run a world and feed series in three modes; ScoreStatics for a test input |
| `*.spec.ts` | one per task below; `chunk.perf.spec.ts` for the 1 ms bar |

Docs: `docs/dev/world-score.md` (new), one line in `CLAUDE.md`'s scoped-doc list, and a note in `docs/dev/finance-score.md` (after the gate).

Test command pattern (server project): `npx vitest --run --project server <file>`. Perf: `npx vitest --run --project perf <file>`. Both are run from the worktree root after `cd`.

---

## Task 1: Types, `scoreStaticsOf` without money, public surface

**Files:**
- Create: `src/lib/sim/world/score/types.ts`, `src/lib/sim/world/score/statics.ts`, `src/lib/sim/world/score/index.ts`
- Test: `src/lib/sim/world/score/statics.spec.ts`

**Interfaces:**
- Consumes: `monthsOf`, `phasingOf`, `REFERENCES` (`scenario/score.ts`); `firstOfMonth`, `addMonths` (`scenario/dates.ts`); `monthLastDay`, `monthOfDay` (`../months`); `tierBaselineOf` (`finance-score.ts`); `limitStatements` type (`$lib/sim/finance`); `LedgerEvent` (`$lib/sim/scenario/money`, the same import world-core's `types.ts:1` uses); `FinanceFrame`, `PolicyTimeline`, `PolicyFrame` (`../policy/frame`).
- Produces:
  - Every type in the spec's S15 and "Defined here" blocks, exactly as written. `type MonthRow = TimelineScore['shown'][number]`. `interface PlanRow { entitledNew: number; completedNetNew: number }`.
  - `interface MoneyRow { pools: { id: string; label: string; kind: PoolKind; received: number; committed: number; out: number; spent: number; repaid: number; lost: number; lostCredit: number }[]; fundedHomes: number; displacedHomes: number; publicSpent: number }`. Builder's call: `repaid` and `lost` are included because "every per-month series" governs the spec's shorter parenthetical, and `money-view.ts:73-78` reads both. `id`, `label` and `kind` ride along because `viewOf` has no other source for them.
  - `interface CardDeps { qualityRules: Map<string, QualityRuleRef>; building(s: Schedule, k: number): Massing; logOnce(key: string, msg: string): void; record(parcelId: ParcelId): { neighborhood: string; landUse: string; eligible: boolean; underwater?: true; existingUnits: number } | null }`. `record` is a builder's call (see Q3).
  - `scoreStaticsOf(input, timeline, base, windowMonths, rhna)`. The trailing `rhna: ProjectsFile['rhnaCompletedNet']` is pending Q1. If `main` rules otherwise, adapt only this signature.
  - `horizonOf(s: ScoreStatics): Day`. `finalTable(s: ScoreStatics): Int32Array`, where `[i]` = `monthOfDay(s.asOf, last day of calendar month i)`.

- [ ] **Step 1: Write the failing tests** in `statics.spec.ts`. Use `fixtureInput()` with `oneFrame(frameOf(input))`, and a test `rhna` of `{ units: 1000, since: dayOf(2022, 6, 30), provenance: <any valid Provenance> }`.
  - `it('months run from the dataset month to lastIndex')`: with `W = horizonMonth(asOf)`, `s.months` `toEqual(monthsOf(asOf, HORIZON))` and `s.lastIndex === s.months.length - 1`.
  - `it('lastIndex is the last calendar month ending by model month W')`: for W in {1, 2, 12, 13, 480}, `horizonOf(s) <= monthLastDay(asOf, W)` and `addMonths(s.months[s.lastIndex], 2) - 1 > monthLastDay(asOf, W)`.
  - `it('references follow compare')`: `'preFzp'` → `toEqual(REFERENCES)`; `'plan'` → `toEqual(REFERENCES.filter(r => r.measure === 'completedNet'))`.
  - `it('without finance in any frame, limits and tierBaseline are null')`: both `toBeNull()`. Also `s.phasing` `toEqual(phasingOf(input.projects, asOf))`, and `s.baseline` is the passed `rhna`.
  - `it('finalTable maps each month to the model month holding its last day')`: for each i, `finalTable(s)[i] === monthOfDay(asOf, lastDay(i))`, non-decreasing.
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/sim/world/score/statics.spec.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `types.ts` and `statics.ts`. `months` = `monthsOf(asOf, H)`, where `H` is the last day of the last calendar month whose last day ≤ `monthLastDay(asOf, windowMonths)`. `finance` presence is read from `timeline.frameAt(1)` and `frameAt(m)` for each `m` in `timeline.changes()` with `m <= windowMonths`. If no frame has finance, `limits` and `tierBaseline` are null. With finance, Task 9 and Task 11 fill them, and until then this task throws `Error('world-score: money before the world-funding merge')`. Create `index.ts` exporting the types, `scoreStaticsOf`, and nothing private.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(world-score): score statics and the S15 types`.

## Task 2: `WorldSeries` filing and the rule 5 referee

**Files:**
- Create: `src/lib/sim/world/score/series.ts`, `src/lib/sim/world/score/test/feed.ts`
- Test: `src/lib/sim/world/score/series.referee.spec.ts`, `src/lib/sim/world/score/series.spec.ts`

**Interfaces:**
- Consumes: Task 1's types, `horizonOf`, `finalTable`; `monthIndexer`; `createWorld`, `step`, `planDue` (`../index`); `ORIGIN_*`, `NO_DAY`, `World`, `WorldEvent` (`../types`); `Statics` (`../statics`).
- Produces:
  - `createWorldSeries(s: ScoreStatics, from?: WorldSeriesData): WorldSeries`.
  - `rows(from, through)` returns fresh `MonthRow` objects and throws a `RangeError` unless `0 <= from <= through <= finalThrough()`.
  - In `test/feed.ts`: `type FeedMode = 'live' | 'buffered' | 'after'`, `feedWorld(statics: Statics, timeline: PolicyTimeline, seed: number, through: number, series: WorldSeries, mode: FeedMode, opts?: { saveAt?: number; onSave?: (d: WorldSeriesData) => void }): World`, and `testStatics(input: SimInput, windowMonths: number): ScoreStatics`.
  - Feed modes. `live`: the creation events are buffered and added after `createWorld` returns, then each step's events are added inside the sink. `buffered`: each step's events are collected and added after the step. `after`: every event is recorded with its month, then all are added against the final world, with `stepped(m)` after month m's events. Every mode calls `stepped(m)` after month m.

Filing rules. The builder writes this; the plan fixes the algorithm because the signature doesn't determine it. All deltas go to `monthOf(day)` = `day < months[0] ? 0 : idx(day)`. Events dated after `horizonOf(s)` file nothing, except that a span opened at or before the horizon and closed after it keeps its +.

- Per-row state in the series. Builder's call: growable typed arrays indexed by `row`: `stage` (LIVE index, or -1), `since` (span start day), `units` (current), `entitled` (sim row's entitled day, or `NO_DAY`), and for masters `pending` (units of unfiled phases) plus a per-phase filed bitset. The reason for keeping this state here is that `createWorld` sends events before the world exists, so row state must not be read at event time.
- **Spans** (`addSpan` exactly). Opening `(s, a, u)` adds `+u` at `monthOf(a)` if `a <= H`. Closing at `b` adds `-u` at `monthOf(b)` if `a < b` and `b <= H`. If `a >= b` it undoes the open (`-u` at `monthOf(a)`, if `a <= H`).
- `'start'`: record the row. For a non-master, `units` is the row's first revision (walk `revPrev` from `revLast` to the root, `columns.ts:157-190`) and `stage` is -1. For a master, `pending` is Σ `statics.projects[src].phases[j].units`.
- `'enter'` of a LIVE stage on a schedule row: close the open span at `e.day`, then open `(stage, e.day, units)`. If the stage is `entitled` on an `ORIGIN_SIM` row and `e.day > asOf`, record `entitled = e.day` and add `units - existing` to entitledNew. If it is `construction` and `e.day > asOf`, add `-existing` to pipeline (origin pipeline/phase) or new (origin sim). `'enter'` `complete` files nothing.
- `'revise'`: close and reopen the span at `e.day` with `e.units`. If `e.day === entitled[row]`, add `e.units - units` to entitledNew. Then set `units = e.units`.
- `'end'` `'complete'`: close the span at `e.day`, then add `units` to pipeline/new by origin. `'exit'`: close the span, and add `units` to `exitedUnits` if `e.day > asOf`.
- Master `'enter'` (PLANNING): move `pending` the same way, as one span. Master `'end'` `'entitled'`: if `stage` is not `entitled`, move `pending` to `entitled` at `e.day`. Master `'end'` `'exit'`: close the span, and add Σ all phase units to `exitedUnits` if `e.day > asOf`. `'phaseFiled'`: close that phase's units alone at `e.day` (the span-close rule applied to `u` = the phase's units, start `since`), subtract them from `pending`, and leave the rest of the span open from the same `since`.
- `'award'` files nothing. `'displaced'` throws `Error('world-score: displaced before the world-funding merge')` until Task 9.
- **Guard:** any delta to a month `<= finalThrough()` throws an `Error` naming the row, the event and the month.
- `stepped(m)`: `m` must be `lastStepped + 1`, otherwise throw. Then `finalThrough()` is the largest i with `finalTable[i] <= m`, capped at `lastIndex`, or -1. Before any `stepped` the month stepped counts as 0. `rows` materialises prefix sums incrementally through `finalThrough()`.

- [ ] **Step 1: Write the failing referee** in `series.referee.spec.ts`, modelled on `referee.spec.ts:14-45`. Run `describe.each([['bench', benchInput], ['fixture', fixtureInput]])` with `it.each([1..10])`:

```ts
const old = simulateDetailed(oldInputOf(input), seed, HORIZON);
const want = shownSeries(old, input.asOf, HORIZON, monthsOf(input.asOf, HORIZON));
const s = testStatics(input, horizonMonth(input.asOf));
const series = createWorldSeries(s);
feedWorld(statics, oneFrame(frameOf(input)), seed, horizonMonth(input.asOf), series, 'live');
expect(series.finalThrough()).toBe(s.lastIndex);
expect(series.rows(0, s.lastIndex)).toEqual(want);
```

  Add `it('is not degenerate')`: over seeds 1-10, at least one month has `exitedUnits > 0`, `entitledNew > 0`, `completedNetPipeline !== 0`, `completedNetNew !== 0` and `inProgress.entitled > 0`. Add `describe.skipIf(liveDir() === null)` with `LIVE_SEEDS`.
- [ ] **Step 2: Write the failing unit tests** in `series.spec.ts` (fixture):
  - `it('live, buffered and after feeds give equal rows')` for seeds 1-3.
  - `it('a same-day revise on entitled day counts the revised units in entitledNew')`: run a fixture world, find in a `Recorder` trace a sim row with a `'revise'` on its `entitled` day, and assert the row's month delta equals `unitsOn(revisions, ent) - existing` from `scheduleAt`. If none occurs within 10 seeds, use `frameOf(input, { speed: everyStage(0.05) })` (`test/timeline.ts:130`) to find one, and `expect(found).toBeGreaterThan(0)`.
  - `it('throws when a delta lands in a final month')`: feed a world through month 20 in `'live'` mode, then `add` a synthetic `{ kind: 'exit' … }` `'end'` event for a live row dated in month 0, and `expect(...).toThrow(/final/)`.
  - `it('rows outside 0..finalThrough throw')`.
- [ ] **Step 3: Run** `npx vitest --run --project server src/lib/sim/world/score/series.spec.ts src/lib/sim/world/score/series.referee.spec.ts` (check the lock first: this runs bench worlds). Expected: FAIL.
- [ ] **Step 4: Implement** `series.ts` and `test/feed.ts`.
- [ ] **Step 5: Run** the same command. Expected: PASS for bench and fixture, all 10 seeds.
- [ ] **Step 6: Commit** `feat(world-score): one world's calendar-month series from events`.

## Task 3: `finalThrough` and `data()`/restore

**Files:**
- Modify: `src/lib/sim/world/score/series.ts`
- Test: `src/lib/sim/world/score/series.state.spec.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces: `data(): WorldSeriesData`, plain data only (typed arrays, numbers, arrays). `createWorldSeries(s, data)` restores from it. Restoring copies the arrays, so the restored series and the original never share state.

- [ ] **Step 1: Write the failing tests:**
  - `it('finalThrough never runs ahead of the steps')`, on the fixture with W = 480. After each `stepped(m)`, with `f = finalThrough()`: if `f >= 0`, then `monthOfDay(asOf, lastDay(f)) <= m`. If `f < lastIndex`, then `monthOfDay(asOf, lastDay(f + 1)) > m`. After `stepped(480)`, `f === s.lastIndex`.
  - `it('saved at month 100 and restored equals one fed straight through')`, on fixture seeds 1-3 and bench seed 1. Feed with `saveAt: 100`, `structuredClone` the data, `createWorldSeries(s, clone)`, then feed the rest (months 101..W) to both the restored series and a straight one. Assert `restored.rows(0, last)` `toEqual(straight.rows(0, last))` and `restored.data()` `toEqual(straight.data())`.
  - `it('stepped out of order throws')`.
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/sim/world/score/series.state.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `data()` and restore. `feedWorld`'s `saveAt` hook calls `onSave(series.data())` right after `stepped(saveAt)`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(world-score): finalThrough and the series' saved state`.

## Task 4: `chunkOf` without money (rules 6-8)

**Files:**
- Create: `src/lib/sim/world/score/chunk.ts`
- Test: `src/lib/sim/world/score/chunk.spec.ts`

**Interfaces:**
- Consumes: `WorldSeries`, `MonthRow`, `PlanRow`, `SeriesChunk`, `MoneyFeed` (Task 1).
- Produces: `chunkOf(plan: WorldSeries[], twin: WorldSeries[], money: MoneyFeed | null, from: number, through: number): SeriesChunk`.
  - `mean` and `sd` go field by field over every `MonthRow` count, including each `inProgress` stage. `sd` is the sample sd (W - 1), with `Math.sqrt`. Nothing is rounded.
  - `shown = plan[0].rows(from, through)`.
  - `planEffect[i]` is the mean and sd over seeds of `plan[w] − twin[w]` for `entitledNew` and `completedNetNew`.
  - Builder's call: W = 1 gives `sd` 0, because NaN would poison the band.
  - It throws if `plan.length !== twin.length`, if `plan.length === 0`, or if any series has `finalThrough() < through`.
  - With `money` non-null, it throws `Error('world-score: money before the world-funding merge')` until Task 9. `money` and `tiers` are null when `money` is null.

- [ ] **Step 1: Write the failing tests** with stub `WorldSeries` objects. A stub's `rows` slices hand-built `MonthRow[]` and its `finalThrough` returns their last index; the other methods throw.
  - `it('mean and sample sd over four worlds, every field')`: four worlds × 3 months with hand-picked values (e.g. completedNet `[10, 20, 30, 40]` → mean 25, sd `Math.sqrt(500 / 3)`), the same for one `inProgress` stage and `exitedUnits`. `toBeCloseTo(…, 12)`.
  - `it('shown is world 1')`.
  - `it('plan effect is the mean and sd of paired differences')`: plan and twin of four with differences `[1, 2, 3, 6]` → mean 3, sd `Math.sqrt(14 / 3)`.
  - `it('identical plan and twin give 0 plan effect')`: every `mean` and `sd` field `=== 0`.
  - `it('one world has sd 0')`, `it('mismatched ensembles throw')`, `it('a month past a world's finalThrough throws')`.
  - `it('money and tiers are null without a feed')`.
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/sim/world/score/chunk.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `chunk.ts` and export `chunkOf` from `index.ts`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(world-score): chunks of the ensemble's average, spread and plan effect`.

## Task 5: `viewOf` and refill (rules 10, 11 totals, 13)

**Files:**
- Create: `src/lib/sim/world/score/view.ts`
- Test: `src/lib/sim/world/score/view.spec.ts`

**Interfaces:**
- Consumes: `SeriesChunk`, `ScoreStatics`, `TimelineView` (Task 1); `chunkOf` (Task 4); `targetsOf`, `tierTargetsOf` (`score.ts`).
- Produces:
  - `viewOf(chunks: SeriesChunk[], statics: ScoreStatics): TimelineView`.
  - `chunksBefore(chunks: SeriesChunk[], k: number): SeriesChunk[]` keeps months `< k` and trims a chunk that straddles `k` (rule 13; builder's call that the cut lives here so that the page and the runner agree).
  - Constant: `BAND_Z = 1.2816`.
- Rules:
  - `viewOf` requires `chunks[0].from === 0` and each chunk's `from` to equal the previous chunk's last index + 1, and throws otherwise. `filledThrough = -1` with no chunks.
  - `band[i] = { lo: m - BAND_Z * sd, hi: m + BAND_Z * sd }` on `completedNet`. `planEffectBand` is the same per `PlanRow` field.
  - `targets = targetsOf(statics.baseline.units, mean)`.
  - `tierTargets`: `tierTargetsOf(statics.tierBaseline, tiers)` when both are non-null, else null.
  - `baseline = { completedNet: units, since, provenance }` (as `assembleScore`, `score.ts:417-424`).
  - `money` is null until Task 11.
  - `months` is `statics.months` (all `lastIndex + 1`). Every series has `filledThrough + 1` entries.

- [ ] **Step 1: Write the failing tests**, using chunks from Task 4's stub worlds over 12 months:
  - `it('joins chunks and builds the band')`: `band[i].lo === mean[i].completedNet - 1.2816 * sd[i].completedNet`, the same for `hi`. `planEffectBand` the same. `targets[t].fraction[i] === (baseline.units + mean[i].completedNet) / target.units`.
  - `it('empty view has filledThrough -1 and empty series')`.
  - `it('a refill equals a fresh fill')`: build `fresh = [c(0..3), c(4..7), c(8..11)]`. `chunksBefore(fresh, 6)` has its last entry trimmed to 4..5, and `viewOf(…)` has `filledThrough === 5`. Appending refilled `c(6..11)` makes `viewOf` `toEqual(viewOf(fresh))`.
  - `it('gaps and overlaps throw')`.
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/sim/world/score/view.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** and export `viewOf` and `chunksBefore`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(world-score): the timeline view, its band and refill`.

## Task 6: `cardAt` without money (rule 14)

**Files:**
- Create: `src/lib/sim/world/score/card.ts`
- Test: `src/lib/sim/world/score/card.spec.ts`

**Interfaces:**
- Consumes: `scheduleAt`, `masterAt` (`../read`); `chooseProject`, `projectCard`, `revisionAt`, `CardCtx` (`scenario/card.ts`); `lookupsAt` (`../policy/lookups`); `envelopeOf` (`$lib/data/scenario-codec`); `CardDeps` (Task 1).
- Produces: `cardAt(world, statics, frame, deps, parcelId, day, projectId?): { summary: ParcelSummary; lookups: Lookups | null }`. The caller passes `frame = timeline.frameAt(max(1, monthOfDay(asOf, day)))`.
  - Builder's call: rows on the parcel come from a linear scan of `world.projects`. A sim row matches when `statics.parcelId[src] === parcelId`. A pipeline row matches when its `statics.projects[src].parcelIds` includes it, and a phase row when that phase's `parcelIds` does. Each match is read with `scheduleAt(…, day)` and nulls are dropped. The scan runs only on a card request.
  - `CardCtx`: `asOf`; `rows` is a map of `statics.projects` by id, memoised per `statics` in a `WeakMap`. `masters` comes from `masterAt(…, day)` over the master rows of the chosen phase. `qualityRules`, `building` and `logOnce` come from `deps`.
  - `input` is `{ parcels: frame.view.parcels, projects: statics.projects, asOf, districtMaxStories, calibration: frame.calibration, inFlightScale: frame.speed, newProjects: { calibration: frame.newCalibration, scale: newScale(frame) } }`, memoised per `frame.id`. `newScale` is pending Q4.
  - The summary's record fields come from `deps.record(parcelId)`, and cardAt throws if that is null (the runner checks first). `existingUnits` and `envelope` are as in `scenario-host.ts:1360-1371`. `generated` comes from `deps.building(chosen, revisionAt(chosen, day))` unless it is a footprint. `project` is `projectCard(chosen, day, ctx)`. `limits` is never set (Q3).
  - `lookups = chosen ? lookupsAt(frame)[card.lookups] : null`.

- [ ] **Step 1: Write the failing tests** (fixture, one frame, seed 1, run to `horizonMonth`). Stub deps: `building` returns `{ footprint: true }`-style footprint entry (copy the shape the host uses for `NOT_DRAWN`), `record` returns fixed strings.
  - `it('a later stage appears only after its day')`: find a sim row with two entered stages `a < b`. `cardAt` at `b - 1` has `project.stages` without stage b. At `b` it includes b, with `project.projectId === 'sim:<parcel>:<k>'`.
  - `it('the card equals projectCard of the schedule read on that day')`: `toEqual(projectCard(chooseProject([scheduleAt(...)], day)!, day, ctx))` for a pipeline row and a phase row.
  - `it('lookups are the frame's tables for the cohort')`: `toBe(lookupsAt(frame).fresh)` for a sim card, and `null` on a parcel with no project.
- [ ] **Step 2: Run** `npx vitest --run --project server src/lib/sim/world/score/card.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** and export `cardAt` and `CardDeps`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(world-score): the project card from world 1`.

## Task 7: Docs for the unfunded surface

**Files:**
- Create: `docs/dev/world-score.md`
- Modify: `CLAUDE.md` (scoped reference docs list: one line after the policy-timeline or finance lines)

- [ ] **Step 1: Write `docs/dev/world-score.md`:** files table; how to feed a series (all three modes are equal, and creation events are added after `createWorld` returns); calendar months and when a month is final; `data()`/restore; chunk statistics (sample sd, W = 1 → 0, `BAND_Z`); `viewOf`/`chunksBefore` and refill; `cardAt` and `CardDeps`; known gaps (the open questions below, money pending). Keep it short.
- [ ] **Step 2: Add the CLAUDE.md line:** `- **Results from the step engine (WorldSeries, chunks, TimelineView, cardAt)** — [docs/dev/world-score.md](docs/dev/world-score.md)`.
- [ ] **Step 3:** After checking the lock, run `npx prettier --check docs/dev/world-score.md CLAUDE.md src/lib/sim/world/score`, then `npx eslint src/lib/sim/world/score`, then `npm run check`. Expected: clean.
- [ ] **Step 4: Commit** `docs(world-score): results from the step engine`.

---

## GATE: wait for main's world-funding merge sha

Stop here and report to `main`. Tasks 8-14 need world-funding (`createFundingSystem`, real ledgers, awards, funding fields on rows, the `LedgerEvent` stream through `StepSink.ledger`, `FinanceFrame` on a world). Do not hand-build ledgers or funded stand-ins. When `main` sends a sha, merge it into `step-engine/world-score` and continue.

---

## Task 8: Merge world-funding and reread its surface

- [ ] **Step 1:** `git merge <sha>` (message via `-F`, `merge: world-funding <sha> into world-score`).
- [ ] **Step 2: Read:**
  - `src/lib/sim/world/funding/` (its `index.ts`, the system factory, which events it sends, and when `'award'` and `'displaced'` fire);
  - `docs/dev/world-funding.md` (or its equivalent);
  - the world-funding spec `docs/superpowers/specs/2026-11-13-world-funding-design.md`;
  - how its tests build a funded bench and live world (baseline funding).

  Record in `docs/dev/world-score.md` which `LedgerEvent` fields and which row columns (`funded`, `kind`, `programmes`, `dispDay`/`dispUnits`) money and tiers read.
- [ ] **Step 3:** Rerun Tasks 2-6's specs (lock check first). Expected: PASS. A world-funding change that breaks the unfunded referee is reported to `main`, not patched here.
- [ ] **Step 4:** Settle with `main` what `MoneyFeed.ledger` holds (Q6). The plan assumes all of world 1's ledger events since month 0.

## Task 9: Money rows and displaced homes (rules 2, 9)

> **Ordering (main, from world-funding's plan):** a project's ledger `'award'` arrives AFTER the stage events of the chain `startProject` begins (`startProject` is synchronous). Tasks 9-12 read an award by its project row, never by its position relative to stage events.

**Files:**
- Create: `src/lib/sim/world/score/money.ts`
- Modify: `series.ts` (`'displaced'` filing, `fundedHomes`, private extras), `chunk.ts` (money branch)
- Test: `src/lib/sim/world/score/money.spec.ts`

**Interfaces:**
- Produces:
  - `series.ts` keeps per-month deltas `funded` (at `'end'` `'complete'` of a row with `funded === 1`: `units - existing`) and `displaced` (at `'displaced'`: `e.units` at `monthOf(e.day)`, the event's own day).
  - These reach `chunkOf` through a module-private accessor (builder's call: a `WeakMap<WorldSeries, Extras>` in `series.ts`, with `extrasOf(series)` exported only to sibling files and not from `index.ts`). The reason is that the frozen `WorldSeries` interface has no channel for them (Q5).
  - `money.ts`: `moneyRowsOf(feed: MoneyFeed, extras: Extras, from: number, through: number): MoneyRow[]`. It calls `poolSeries(feed.ledger, { pools, programmes, off: [], slope, terms } from feed.finance, monthsOf(asOf, lastDay(through)), lastDay(through))`, sliced to `from..through`. `fundedHomes` and `displacedHomes` are cumulative from world 1's extras. `publicSpent` is `spent + lostCredit` over pools (`finance-score.ts:521-523`).
- [ ] **Step 1: Write the failing tests:**
  - `it('a displaced event counts in its own month whether or not the funded project has completed')`, on a funded world from world-funding's test setup. Find a `'displaced'` event whose row completes in a later calendar month, or has not completed at the horizon. `displacedHomes` steps up by `e.units` at `monthOf(e.day)` and nowhere else for that event.
  - `it('pool series equal poolSeries of the same ledger')`, field for field, for months `0..finalThrough`.
  - `it('fundedHomes equals moneyOf's at every month')`, with `moneyOf` over `readAll(world, statics, lastDay)` and the same ledger.
  - `it('money and tiers in a chunk describe world 1')`.
- [ ] **Step 2 → 4:** fail, implement, pass, using `npx vitest --run --project server src/lib/sim/world/score/money.spec.ts`.
- [ ] **Step 5: Commit** `feat(world-score): world 1's money by calendar month`.

## Task 10: Income tiers (rules 2, 9, 11)

**Files:** Modify `series.ts`, `chunk.ts`, `view.ts`. Test: `src/lib/sim/world/score/tiers.spec.ts`.

- [ ] **Step 1: Read Q2's answer** (where the `TierCtx` comes from). The plan's default is that `scoreStaticsOf` builds `tierContext({ projects: input.projects, finance })` from the timeline's finance programmes and keeps it in a module-private `WeakMap<ScoreStatics, TierCtx>` that `createWorldSeries` reads.
- [ ] **Step 2: Failing tests:**
  - `it('tiers equal tierSeries of the schedules read at the horizon')` on the funded bench and the fixture.
  - `it('each month's tiers sum to that month's completedNet')`.
  - `it('tierTargets use world 1's tiers, targets the mean')` in `viewOf`.

  The series files `-existing` from `aboveModerate` at a construction start after `asOf`, and `tiersOf(scheduleAt(world, statics, row, e.day), ctx)` at completion (rule 2, `finance-score.ts:239-274`).
- [ ] **Step 3 → 4:** implement, pass.
- [ ] **Step 5: Commit** `feat(world-score): homes by income tier for this city`.

## Task 11: Limits and the money view (rule 12)

**Files:** Modify `statics.ts`, `view.ts`, `money.ts`. Test: `src/lib/sim/world/score/limits.spec.ts`.

- [ ] **Step 1: Q7 is ruled** (main, 2026-11-13; rule 12 amended at b6c16c04): `perAddedHome` keeps today's meaning, public money gone (`publicSpent`, or the City pools' share for `'city'`) over world 1's `fundedHomes - displacedHomes`, read at `filledThrough`; a denominator of 0 or less gives null. The plan effect is not the denominator. Add `it('perAddedHome divides by world 1's funded minus displaced homes at filledThrough')`.
- [ ] **Step 2: Failing tests:**
  - `it('limits at filledThrough 10 equal limits at lastIndex')`: `viewOf(chunks through 10).money.limits` `toEqual(viewOf(all).money.limits)`, both `toEqual(statics.limits)`.
  - `it('limits are equal for two seeds')`: ScoreStatics are seed-free, and two runners with world 1 = seed 1 vs seed 2 give the same `limits`.
  - `it('owed is read at filledThrough')`: principal = the pool's `received[filledThrough]`, repayment = `debtService(principal, debt).total`.
- [ ] **Step 3:** `scoreStaticsOf` computes `limits = limitStatements(addedBorrowing(planFinance, baselinePools, asOf, horizonOf(s)))`.
  - `planFinance` is built from the timeline: pools and programmes from the window's frames, and `off` derived from the months whose frame drops a pool's arrivals. Before relying on `addedBorrowing`'s `inflowArrivals`, check whether summing `frame.finance.arrivals` over months 1..W per debt pool equals it.
  - The baseline pools are the default document's.
  - Then `MoneyView` is today's money cut at `filledThrough`, plus `owed`, `perAddedHome` and `limits`.
- [ ] **Step 4 → 5:** pass, then commit `feat(world-score): limits and money owed as of the filled month`.

## Task 12: Funded card fields (rules 14-15, funding parts)

**Files:** Modify `card.ts`. Test: extend `card.spec.ts`.

- [ ] **Step 1: Failing tests** on a funded world:
  - `it('funding.programmes are programme ids')`: equal to `p.programmes[row].split(',')`.
  - `it('funding.displaced is 0 before the displaced event and the shadow's homes from its day')`, asserted on `scheduleAt(…, day).funding.displaced` (and on the card if Q8 adds the field).
  - `it('an affordable funded project carries kind affordable')`.
- [ ] **Step 2 → 4:** implement and pass. Expected: no code change beyond reading what `scheduleAt` already gives (`read.ts:80-91`). If a test fails, report it rather than patching world-core.
- [ ] **Step 5: Commit** `test(world-score): funded fields on the card`.

## Task 13: The 1 ms bar (test:perf, under the lock)

**Files:** Create `src/lib/sim/world/score/chunk.perf.spec.ts` (`*.perf.spec.ts` goes to project `perf`, `vite.config.ts:10-11, 57-66`).

- [ ] **Step 1: Write the test.** Setup is untimed: bench city (`benchInput()`), 96 worlds = 48 plan (seeds 1-48) + 48 twin (the same seeds under `oneFrame(frameOf(input))`, the twin under the same frame). Builder's call: "96 worlds" counts both ensembles of 48, the spike's W, and matches the 9 ms bar's "every world of both ensembles". Each world is run to month 150 with a `Recorder`.

  Timed: for each model month m in 101..150, add month m's events and `stepped(m)` to all 96 series, then `chunkOf(plan, twin, null, prevFinal + 1, newFinal)` when a calendar month became final. Assert the median per-month time `<= 1` ms and log `[perf] … quiet (lock held), dataset: bench (synthCity)`.
- [ ] **Step 2:** Take the lock (`mkdir`, `owner` = `world-score`, wait 30 s). Run `npx vitest --run --project perf src/lib/sim/world/score/chunk.perf.spec.ts`, then `rm -r` the lock. Expected: PASS. A miss is reported with its numbers.
- [ ] **Step 3: Commit** `test(world-score): one month's scoring for 96 worlds within 1 ms`.

## Task 14: Docs for money

- [ ] **Step 1:** In `docs/dev/finance-score.md`, add a short note:
  - Rule 2: displaced homes now count on the `'displaced'` event's own day, not at the funded project's completion (design 3.5).
  - Rule 12: `owed`/`perAddedHome` are read at `filledThrough`; `limits` come from `scoreStaticsOf`, are independent of the ledger, the same in every world and fixed as the forecast fills. Link `world-score.md`.
- [ ] **Step 2:** Add money, tiers and the perf result to `docs/dev/world-score.md`.
- [ ] **Step 3:** Check the lock, then run `npx prettier --check docs/dev` and `npm run check`. Then commit `docs(world-score): money, tiers and the timing`.

---

## Open questions for main (each with a recommendation)

1. **`scoreStaticsOf` has no source for `baseline`/`tierBaseline`.** `ScoreStatics.baseline` is `ProjectsFile['rhnaCompletedNet']`, but `SimInput` carries no `rhnaCompletedNet` (`scenario/types.ts:95-133`). Today the host reads it from `w.loaded.projects` (`scenario-host.ts:1189, 1299`). *Recommend* adding a trailing parameter `rhna: ProjectsFile['rhnaCompletedNet']` to `scoreStaticsOf` (an S15 signature change). Task 1 is written that way.
2. **Where the `TierCtx` lives.** `tiersOf` needs programme tiers (`finance-score.ts:137-168`), and `ScoreStatics`' frozen shape has no field for them. *Recommend* a module-private `WeakMap<ScoreStatics, TierCtx>` filled by `scoreStaticsOf` (no shape change). The alternative is a `tierCtx` field on `ScoreStatics`. Also: when programme definitions change between frames, which frame's `tiers` apply: the frame of the completion month? *Recommend* that one.
3. **What `cardAt` puts in the summary beyond the card.** `ParcelSummary` needs `neighborhood`, `landUse`, `eligible` and `underwater` from the chunk record (`protocol.ts:72-87`, `scenario-host.ts:1356-1371`). The spec's `CardDeps` lists only what `CardCtx` needs. `limits.owner` needs per-lot rule attribution (`scenario-host.ts:1376-1378`), which compiled frames do not carry. *Recommend* `CardDeps.record(parcelId)` (Task 1) and no `limits` from `cardAt`. If `/sim` needs `limits`, policy-timeline should expose attribution, or the runner should add `limits` itself.
4. **`newScale` is private in `policy/lookups.ts:11`.** `projectCard`'s chance shift reads `input.newProjects.scale` (`card.ts:138`). *Recommend* that policy-timeline export `newScale(frame)`. If `main` declines, Task 6 copies the 15-line function with a pointer comment.
5. **`WorldSeries` has no channel for world 1's tiers, `fundedHomes` and `displacedHomes` to reach `chunkOf`** (rule 9). *Recommend* the module-private accessor of Task 9 (no shape change).
6. **`MoneyFeed.ledger`'s extent.** Is it all of world 1's ledger since month 0, or only events since the last chunk? *Recommend* all of it, because `poolSeries` is cumulative and `chunkOf` stays pure. ensemble-runner must hold it across copies (S16).
7. **`perAddedHome` "uses the plan effect's mean"** (spec rule 12). Today it is `publicSpent / (fundedHomes − displacedHomes)` (`finance-score.ts:560-565`, read by `money-view.ts:66-67`). It is unclear whether the denominator should become `planEffect.mean.completedNetNew` at `filledThrough`, or whether the "added homes" stay funded minus displaced. *Recommend* asking the spec's author. Task 11 waits on it.
8. **Rule 15 versus the card type.** `ProjectCard.funding` is `{ programmes, certain }` (`scenario/types.ts:295`), and `projectCard` copies only those (`card.ts:258-260`). So `funding.displaced` exists only on the `Schedule` (`read.ts:88`). *Recommend* reading rule 15 as the schedule's field, which holds today. Adding it to the card would change a hashed type.

## Spec/code contradictions noted (no action unless main says)

- The spec's Docs line says "a 'Results' section in `docs/dev/sim-timeline.md`". The standing rules and the dispatch override it to `docs/dev/world-score.md`.
- `REFERENCES.filter(r => r.measure === 'completedNet')` is empty: all three references measure `planEffect.*` (`score.ts:341-396`). So `compare: 'plan'` has no references. That is faithful to `levers/apply.ts:157-160` and kept.
- The spec's `MoneyRow` list omits `repaid` and `lost`. This plan includes them (Task 1).
- Rule 1 says the series reads "current size from the world's row at the time of the event". It cannot do that for creation events (the world is not returned yet), so the series tracks size from `'start'` and `'revise'`, which gives the same numbers in all feed modes (Task 2).

## Not examined

- Whether the bench city (`synthCity`) has phased masters. If it does not, rule 5's master filing is refereed only on the fixture (and the live city when `pipeline/out` has one).
- world-funding's actual API (pending its merge), and the ensemble-runner and timeline-ui specs beyond their mentions in this spec.
- `massing.ts`'s `rowsOf` memo key: if it memoises on the `SimInput` object, Task 6's per-frame memo of the card input matters for speed.
