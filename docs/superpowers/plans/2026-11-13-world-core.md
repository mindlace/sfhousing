# world-core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A month-step world (`createWorld`, `step`, `planDue`, the readers and the funding hook) under `src/lib/sim/world/` that, under a policy that never changes and without public money, gives the same projects on the same days as `simulateDetailed`, seed for seed.

**Architecture:** A world is plain typed columns (lots that have left their starting state, project rows, empty line and pools). `step` reads the timeline's frames for months up to the one it steps and visits only what the due list says is due; a free lot's start is worked out from its draw and the frames it has lived through, never stored. Readers rebuild today's `Schedule` and `Master` from the rows, so the referee tests compare against the old engine with deep equality.

**Tech Stack:** TypeScript, Vitest (server, client and perf projects), ESLint flat config. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-13-world-core-design.md` (interfaces S1 to S12, rules 1 to 22). Design: `docs/superpowers/design/2026-11-12-2305-sim-step-engine.md`. Reference only: the spike at `.superpowers/superconductor/sim-step-engine/spike/world.ts.txt` (one frame, dense lots; read it for the hold and master mechanics, do not copy it in).

## Global Constraints

From the spec's Global constraints, verbatim:

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
- Explanation waits for interest (OD-12). (Page-side; nothing in this plan writes page text.)

From the dispatch:

- Do not add an export to an old file. Non-exported old steps (`pipelineRow`, `masterOf`, `phaseFiledDay`, `runStages`, `stageStep`, `revise`, `initiationDay`, `simulatedProject`, `startSimulated`, the `Holds` logic, `entityOf`) are written again under `src/lib/sim/world/`; the referee tests hold the two equal. Already-exported pure helpers may be imported: `nextStage`, `pathwayFrom`, `revisionRatio`, `pushRevision`, `isSkipped`, `scaledTransition`, `ordinaryMonth` (`engine.ts`), `piecewiseMonth`, `precomputeOf`, `lastInitiationMonth`, `regimeMonths`, `skipBounds`, `sizeCumAgainst`, `parcelRankOf`, `regimeInputsOf` (`input.ts`), and everything in `rng.ts`. (Builder's call: the spec's import list names the core ones; these are the same kind, pure and already exported.)
- `src/lib/sim/world/policy/frame.ts` is owned by `policy-timeline`: import from it, never edit it. `Statics`'s shape in `statics.ts` does not change; `staticsOf` is added beside it.
- Vitest runs with `expect.requireAssertions`. No raised per-test timeout, no fixed wait, no unconditional skip (signoff's `timing` step rejects them, `docs/dev/testing.md` "Accessibility"/signoff paragraph): split slow cases per seed with `it.each`, and skip the live block only conditionally (`describe.skipIf`).
- Conventional Commits; no Claude attribution anywhere; multi-line commit messages through a temp file and `git commit -F`.
- Never `cd <dir> && cmd`; run from the worktree root.

## Review Focus

1. **A timeline compiled only one month ahead** (`readyThrough() === world.month + 1`, the way `policy-timeline` hands frames over in slices): `step` and `planDue` must never call `frameAt` beyond it. Test in Task 10 (`never reads a frame past readyThrough`).
2. **A start whose day falls in the model month after its lot-month began, across a zoning change at that month boundary**: the project takes the view of the lot-month (today's regime rule), not the new one. Test in Task 9 (`a start straddling the change takes its lot-month's view`).
3. **A lot freed on the last day of a model month** (its first lot-month begins next month) when the frame changes next month: it is planned on the current frame and planned again by rule 7, with no read of a future frame. Test in Task 9 (`a lot freed on a month's last day is planned again at the next change`).
4. **A start rate of exactly 0 or of -Infinity** (hazard rounding to 0 or 1) in one frame and not the next: no NaN, no start in a zero segment, start in month 1 of a -Infinity segment. Test in Task 4 (`zero and infinite rates across segments`).
5. **A speed change whose carried end lands before the change day by rounding**, and that end then chaining into the next stage in the same month. Test in Task 5 (`reanchor clamps to the change day`) and Task 9 (`a re-anchored stage ending this month is stepped this month`).

## Decisions the spec left to the builder

Each is marked "builder's call" where it is used; collected here.

- **Files** (`src/lib/sim/world/`): `months.ts` (rule 1; names fixed by the conductor, policy-timeline imports them), `types.ts` (S1, S7, S11, S12 types and the column constants), `statics.ts` (+ `staticsOf`), `columns.ts` (making and growing columns, lot lookup), `due.ts` (`DueList`, `planDue`), `rates.ts` (start rates, lot entities, the ordinary clock, the skip bound), `stage.ts` (speed, stage clock, revisions), `pipeline.ts` (pipeline rows, masters, phases at the dataset date and as they file), `holds.ts` (rule 9), `world.ts` (`createWorld`, `step`, `withFunding`, `StepCtx`), `read.ts` (`scheduleAt`, `masterAt`), `index.ts` (the public surface). Test support in `src/lib/sim/world/test/` (no `.spec` in their names), goldens in `src/lib/sim/world/fixtures/`.
- **Columns.** Plain objects of typed arrays with a row count `n` and capacity = array length, grown by doubling; module functions operate on them (no classes in the world, so `structuredClone` keeps everything). Column list in Task 3.
- **Lot lookup.** `lots.lot` holds the statics row of each lot row, kept ascending; a lot is found by binary search, and a new lot row is inserted in place (`copyWithin` on every column). Lot rows are not referenced from anywhere else, so moving them is safe; project rows never move (S7).
- **Due.** `DueList implements Due`: a `Map<entity, month>` plus a `Map<month, number[]>` bucket with lazy deletion; `put` past `through` deletes the entity's entry and records nothing (rule 21); `take` filters the bucket by the entity map, sorts ascending, forgets them. It carries `readonly through`.
- **Skip shortcut.** Kept, for lots with no row only (free since the dataset date on attempt 0): `skipBounds` over the start-rate arrays of the frames of months 1 to `world.month + 1`, the last continuing, with `Tmax = lastInitiationMonth(asOf, monthLastDay(asOf, through))`, memoised per (timeline, `world.month + 1`, `through`). Used by `planDue`, and by `step`'s whole-city replan (rule 7, `touched` null or `market` changed) when `due` is a `DueList`. A test proves it changes no event (Task 10).
- **Start rates.** `startRates(view, market)` is `log(1 - 1 / (1 + exp(-(z + market))))` per row from `view.pre.logit` (0 where the logit is -Infinity), the same expression `precomputeOf` uses (`input.ts:408-411`), memoised per (`view.pre`, `market`). It never reads `pre.log1mh`, whose market shift is the compiler's business.
- **Equal neighbouring rates are merged** before `piecewiseMonth`, so a frame change that leaves a lot's rate alone gives exactly the plan it had (rules 7 and 20 hold to the bit). See Open question 3.
- **Pipeline rows, masters and phases take their parcel rows, revision caps and existing homes from month 1's view** (`timeline.frameAt(1).view`, memoised per view), as today's engine takes them from `input.parcels` (`engine.ts:171-215`).
- **A phase gets its row when it files**, not at entitlement: the master row carries `phaseNext` and `phaseDay` and is due in the month of the next filing. Until then the phase's lots are held (counted against the master's spawn).
- **Revisions and displacements** live in flat side tables of the project columns (a `prev` link per revision entry, a `revLast` per row), so every column stays a typed array.
- **Live city.** `SFH_WORLD_LIVE` names a dataset directory (`manifest.json`, `scenarios/fzp/*`); without it, the newest non-`fixture-N` directory under `pipeline/out/` that has a `manifest.json`; without either, the live blocks skip (conditional `describe.skipIf`).
- **Node and browser.** The bench city (`synthCity`) and the fixture loader are Node-only (`node:zlib`, `node:fs`), so the cross-engine golden runs on the mini city (`goldenInput()`, browser-safe).

## Open questions (main's or the partner's; recommendation given, the plan follows it)

1. **`speedNew` and masters and phases (rule 11 vs today).** Rule 11 applies `speedNew` to a project "whose `from` is before the day the project filed, or which finds it not yet filed". Today's `newProjects.scale` never reaches masters or phases (`engine.ts:776-777`, `engine.ts:866-868`); phases file after the dataset date (bench city: 5 phased masters, `fixtures/synth-city.ts:318`). Read literally, the referee case "a `speedNew` entry from `asOf + 1` equals today's `newProjects.scale`" fails on every phase. **Recommendation, followed by the plan:** masters and phases count as filed before the dataset date (S4 already groups them with rows in flight for `calibration`), so `speedNew` reaches only simulated starts and pipeline rows at `preApplication` on the dataset date. Escalated.
2. **"From before the day the project filed" and the equal day.** A simulated start entering `filed` on `asOf + 1` with `from = asOf + 1` must take the entry (today's `newProjects.scale` reaches every simulated project). **Recommendation, followed:** a `speedNew` entry applies when the project's filing day is not before `from` (filed on `from` counts as not yet filed on it). Escalated with 1.
3. **Rule 8's "the frame".** Today a start keeps the view of its initiation month, the lot-month in which the threshold passed (`engine.ts:1132-1136`), even when the start day falls in the next model month. The dated-zoning referee needs that. **Recommendation, followed:** route shares, the Local Program column (`view.parcels.localProgram`, conductor ruling) and size come from the frame of the model month holding the lot-month's first day; the stage draws and speeds come from the step's frame. Merging equal rates (Decisions) can differ from today's split arithmetic only when `L / l` lies within about one ulp of an integer for a lot the zoning change leaves alone (order 1e-5 chance over the whole referee suite); a miss would be reported, not tuned. Escalated.
4. **Reader fields that depend on the old input's shape.** `Schedule.inFlight` appears only when the input has `newProjects`, and `Schedule.regime` only when it has `regimes` (`types.ts:69-76`, `engine.ts:702, 896, 1064`). **Recommendation, followed:** `scheduleAt` always sets `inFlight: true` on rows that run on `calibration` (pipeline rows not at `preApplication` on the dataset date, and phases), never sets `regime`; the referee always gives the old input a `newProjects` (identity scale when the case has none, which changes no value) and deletes `regime` from old schedules in the dated-zoning case. Escalated.
5. **S8 "one of the two is non-null for every row".** A reader standing before a row began cannot see it ("nothing dated after `day`"). **Recommendation, followed:** each row is either a Schedule row (pipeline, phase, simulated) or a Master row; `scheduleAt` is null for master rows and before the row's first day, `masterAt` is null for every other row.
6. **`funding` on ordinary starts in a funded run.** Today every simulated schedule of a finance run carries `funding` (`types.ts:80-93`). The core sets it only on rows started with a `FundedStart`. `world-funding` may need it on every simulated row of a funded frame. **Recommendation:** leave it to `world-funding`'s referee; no change here.
7. **`LineColumns` and `PoolColumns`.** The spec leaves their columns to `world-funding`. The core declares `{ n: number; [column: string]: Column | number }` with `Column` a typed array or a plain number/string array, and makes them `{ n: 0 }`. **Recommendation:** `world-funding` narrows them with its own interface; it does not need a change here.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `eslint.config.js` (modify, line 69) | determinism rule's `files` gains `src/lib/sim/world/**` |
| `src/lib/sim/world/months.ts` | rule 1: `monthFirstDay`, `monthLastDay`, `monthOfDay` (conductor ruling) |
| `src/lib/sim/world/types.ts` | S1, S7, S11, S12 types; column code constants |
| `src/lib/sim/world/statics.ts` (modify) | `staticsOf` |
| `src/lib/sim/world/columns.ts` | empty world, grow, add project row, lot lookup and insert |
| `src/lib/sim/world/due.ts` | `DueList`; `planDue` (Task 6 on) |
| `src/lib/sim/world/rates.ts` | start rates, lot entity, the ordinary clock, the skip bound |
| `src/lib/sim/world/stage.ts` | speed, stage clock and re-anchor, certain stages, revisions |
| `src/lib/sim/world/pipeline.ts` | row statics from month 1's view; pipeline rows, masters, phases |
| `src/lib/sim/world/holds.ts` | holding, releasing, freeing and demolishing lots |
| `src/lib/sim/world/world.ts` | `createWorld`, `step`, `withFunding`, `StepCtx` |
| `src/lib/sim/world/read.ts` | `scheduleAt`, `masterAt` |
| `src/lib/sim/world/index.ts` | public surface |
| `src/lib/sim/world/test/mini.ts` | browser-safe mini city input |
| `src/lib/sim/world/test/cities.node.ts` | bench, fixture and live inputs (Node) |
| `src/lib/sim/world/test/timeline.ts` | frames and timelines from a `SimInput`; matching old inputs |
| `src/lib/sim/world/test/run.ts` | recorder sink, `runWorld`, `readAll`, `oldRun` |
| `src/lib/sim/world/fixtures/` | event golden and its builder |
| `docs/dev/world-core.md`, `CLAUDE.md` (modify) | the doc and its link |

---

### Task 1: Determinism rule, model months, `staticsOf`, shared types

**Files:**
- Modify: `eslint.config.js:69` (the `files` array of the determinism block, `eslint.config.js:65-123`)
- Create: `src/lib/sim/world/months.ts`, `src/lib/sim/world/types.ts`
- Modify: `src/lib/sim/world/statics.ts`
- Test: `src/lib/sim/world/determinism.lint.spec.ts`, `src/lib/sim/world/months.spec.ts`, `src/lib/sim/world/statics.spec.ts`

**Interfaces:**
- Consumes: `MONTH_DAYS` (`timelapse/time.ts:10`), `parcelRankOf` (`input.ts:198`), `PolicyFrame`, `PolicyTimeline`, `ZoningView` (`world/policy/frame.ts`), `LedgerEvent` (`scenario/money.ts:20`).
- Produces:
  - `monthFirstDay(asOf: Day, m: number): Day`, `monthLastDay(asOf: Day, m: number): Day`, `monthOfDay(asOf: Day, day: Day): number` (0 for `day <= asOf`).
  - `staticsOf(input: SimInput): Statics`.
  - In `types.ts`, word for word from S1, S7, S11, S12: `World`, `StepSink`, `WorldEvent`, `Due`, `FundingSystem`, `StepCtx`, `FundedStart`; plus `LotColumns`, `ProjectColumns` (columns in Task 3), `type Column = Int32Array | Uint32Array | Uint8Array | Float64Array | number[] | string[]`, `interface LineColumns { n: number; [column: string]: Column | number }`, same for `PoolColumns` (Open question 7), and the code constants `NO_DAY = -0x80000000`, `ORIGIN_PIPELINE = 0, ORIGIN_PHASE = 1, ORIGIN_MASTER = 2, ORIGIN_SIM = 3`, `LOT_HELD = 0, LOT_FREE = 1, LOT_LIVE = 2, LOT_DONE = 3`, `END_ALIVE = 0, END_COMPLETE = 1, END_EXIT = 2, END_ENTITLED = 3`, `RULE_NONE = 0, RULE_PIPELINE = 1, RULE_SIM = 2`, `NO_STOP = 255`.

- [ ] **Step 1: Write the failing tests**

`determinism.lint.spec.ts` (behaviour, not config inspection):

```ts
it('rejects Math.exp, Math.log and ** under src/lib/sim/world', async () => {
  const [r] = await new ESLint({ cwd: ROOT }).lintText(
    'export const a = Math.exp(1) + Math.log(2) + 2 ** 3;\n',
    { filePath: join(ROOT, 'src/lib/sim/world/probe.ts') }
  );
  const ids = r.messages.map((m) => m.ruleId);
  expect(ids.filter((x) => x === 'no-restricted-properties')).toHaveLength(2);
  expect(ids).toContain('no-restricted-syntax');
});
```

`months.spec.ts`, with `asOf = 0` and `asOf = SYNTH_AS_OF`:

```ts
expect([monthFirstDay(0, 1), monthLastDay(0, 1)]).toEqual([1, 30]);
expect([monthFirstDay(0, 2), monthLastDay(0, 2)]).toEqual([31, 60]);
expect([monthFirstDay(0, 3), monthLastDay(0, 3)]).toEqual([61, 91]);
expect(monthLastDay(0, 12)).toBe(365);
expect(monthLastDay(0, 480)).toBe(14609);
expect([0, 1, 30, 31, 365, 366].map((d) => monthOfDay(0, d))).toEqual([0, 1, 1, 2, 12, 13]);
// for m in 1..1000: monthOfDay(asOf, monthFirstDay(asOf, m)) === m,
// monthOfDay(asOf, monthLastDay(asOf, m)) === m, monthLastDay(asOf, m) + 1 === monthFirstDay(asOf, m + 1)
```

`statics.spec.ts` on `miniInput()` (Task 2's helper is not there yet: build it inline with `goldenInput()` from `scenario/simulate.golden.cases.ts`): `parcelId` is `input.parcels.id` (same array), `rank` equals `parcelRankOf(input.parcels.id)`, `projects` is `input.projects`, `asOf` and `districtMaxStories` copied.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/sim/world/determinism.lint.spec.ts src/lib/sim/world/months.spec.ts src/lib/sim/world/statics.spec.ts`
Expected: FAIL (no messages for the probe; modules missing).

- [ ] **Step 3: Implement**

Add `'src/lib/sim/world/**'` to the determinism block's `files`. `months.ts` exports exactly `monthFirstDay`, `monthLastDay`, `monthOfDay` (conductor ruling: `policy-timeline` imports these names): rule 1's formulas; `monthOfDay` from `Math.ceil((day - asOf) / MONTH_DAYS)` corrected by at most one step each way against `monthLastDay` (floating division). `staticsOf` as tested. `types.ts` as listed (columns typed in Task 3; declare them here with the Task 3 column list so later tasks compile).

- [ ] **Step 4: Run the tests, then `npm run lint` and `npm run check`**

Expected: PASS; lint and check clean.

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js src/lib/sim/world
git commit -m "feat(world): model months, staticsOf, shared types and the determinism rule"
```

---

### Task 2: Test support: cities, frames and timelines

**Files:**
- Create: `src/lib/sim/world/test/mini.ts`, `src/lib/sim/world/test/cities.node.ts`, `src/lib/sim/world/test/timeline.ts`
- Test: `src/lib/sim/world/test/timeline.spec.ts`

**Interfaces:**
- Consumes: `goldenInput` (`scenario/simulate.golden.cases.ts:23`), `synthCity` (`scenario/fixtures/synth-city.ts:377`), `buildSimInput` (`input.ts:58`), `loadScenario`, `scenarioUrls` (`scenario/load.ts:262, 118`), `parseManifest`, `precomputeOf`, `regimeInputsOf`, `MIN_SCALE`/`MAX_SCALE` (`levers/types.ts:83-84`), Task 1's `monthFirstDay`.
- Produces:
  - `miniInput(): SimInput` (browser-safe, `finance` removed).
  - `benchInput(): SimInput`, `fixtureInput(): Promise<SimInput>` (reads `e2e/fixtures/data/fixture-0` through `loadScenario` with file-backed fetches, as the spike's `liveInput` does), `liveDir(): string | null`, `liveInput(dir: string): Promise<SimInput>`. All return inputs without `finance`; each is memoised per process.
  - `IDENTITY: StageScale` (`{ discretionary: {}, streamlined: {}, permitOnly: {} }`).
  - `viewOf(input: SimInput): ZoningView` (`{ parcels: input.parcels, pre: precomputeOf(input) }`, memoised by input).
  - `marketAt(input: SimInput, day: Day): number` (the `logOdds` of the last `input.market` step with `from <= day`, 0 without).
  - `interface FrameOpts { id?: number; view?: ZoningView; market?: number; speed?: StageScale; speedNew?: { from: Day; scale: StageScale }[]; newCalibration?: Calibration; finance?: FinanceFrame | null }`; `frameOf(input: SimInput, o?: FrameOpts): PolicyFrame` (defaults: id 0, `viewOf(input)`, `calibration` and `newCalibration` = `input.calibration`, `speed` `IDENTITY`, `speedNew` [], `market` `marketAt(input, input.asOf)`, `finance` null).
  - `oneFrame(f: PolicyFrame): PolicyTimeline` (`changes()` [], `touched()` empty, `readyThrough()` `Number.MAX_SAFE_INTEGER`).
  - `changingAt(m: number, before: PolicyFrame, after: PolicyFrame, touched: Int32Array | null): PolicyTimeline` (`changes()` `[m]` when the ids differ, `touched(m)` as given).
  - `limited(t: PolicyTimeline, through: () => number): PolicyTimeline` (same frames; `readyThrough()` is `through()`, and `frameAt` throws `RangeError` above it).
  - `scaleProduct(a: StageScale, b: StageScale): StageScale` (per stage `clamp((a ?? 1) * (b ?? 1))` in that order, the old `newProjects.scale` matching `speed` times one `speedNew`).
  - `interface OldOpts { inFlightScale?: StageScale; newScale?: StageScale; newCalibration?: Calibration; market?: MarketStep[]; regimes?: { day: Day; parcels: ScenarioParcels }[] }`; `oldInputOf(base: SimInput, o?: OldOpts): SimInput` (always sets `newProjects` = `{ calibration: o.newCalibration ?? base.calibration, scale: o.newScale ?? IDENTITY }`; Open question 4).
  - `upzoned(input: SimInput, rows: Int32Array): ScenarioParcels` (a copy of `input.parcels` sharing `id` and `index`, with, on `rows`: `yield` doubled capped at 65535, `envelopeStories` + 2 capped at 255, `potentialRatio.fzp` × 1.5, `localProgram` flipped; every other column shared).
  - `touchedRows(a: ScenarioParcels, b: ScenarioParcels): Int32Array` (rows where any column used above differs).

- [ ] **Step 1: Write the failing test** (`timeline.spec.ts`, mini city; the Node cities are exercised by the referee tasks)

```ts
const input = miniInput();
const f = frameOf(input);
expect(f.view.pre).toBe(precomputeOf(input));
expect(oneFrame(f).frameAt(480)).toBe(f);
const g = frameOf(input, { id: 1, market: 0.4 });
const t = changingAt(13, f, g, null);
expect([t.frameAt(12), t.frameAt(13)]).toEqual([f, g]);
expect(t.changes()).toEqual([13]);
expect(() => limited(t, () => 12).frameAt(13)).toThrow(RangeError);
expect(scaleProduct({ ...IDENTITY, discretionary: { filed: 0.5 } }, { ...IDENTITY, discretionary: { filed: 0.5 } }).discretionary.filed).toBe(0.25);
expect(oldInputOf(input).newProjects).toEqual({ calibration: input.calibration, scale: IDENTITY });
const rows = Int32Array.of(...precomputeOf(input).candidates.slice(0, 3));
expect(Array.from(touchedRows(input.parcels, upzoned(input, rows)))).toEqual(Array.from(rows));
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest --run --project server src/lib/sim/world/test/timeline.spec.ts` — Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the helpers** (`live` lookup: `SFH_WORLD_LIVE`, else newest non-`fixture-N` dir with `manifest.json` under `pipeline/out/`, else null)

- [ ] **Step 4: Run it to see it pass**, then `npm run check`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sim/world/test
git commit -m "test(world): frames, timelines and cities for the referee tests"
```

---

### Task 3: World columns and the due list

**Files:**
- Create: `src/lib/sim/world/columns.ts`, `src/lib/sim/world/due.ts` (`DueList` only)
- Modify: `src/lib/sim/world/types.ts` (column interfaces final)
- Test: `src/lib/sim/world/columns.spec.ts`, `src/lib/sim/world/due.spec.ts`

**Interfaces:**
- Produces:
  - `LotColumns { n; lot: Int32Array (statics row, ascending); state: Uint8Array (LOT_*); k: Int32Array (attempt); r: Int32Array (day it became free); holders: Int32Array; lastExit: Int32Array (latest holder exit; asOf when none); blocked: Uint8Array; demolished: Uint8Array; project: Int32Array (live simulated row, -1) }`.
  - `ProjectColumns { n; origin: Uint8Array; src: Int32Array (statics.projects index, or the lot for a simulated row); sub: Int32Array (phase index 1-based, or attempt k); stream: Uint32Array; pathway: Uint8Array (PATHWAYS index); isNew: Uint8Array; filed: Int32Array (filing day, NO_DAY = not yet); certain: Uint8Array; rule: Uint8Array; stage: Uint8Array (STAGE_ORDER index); stopAt: Uint8Array; outcome: Uint8Array (0 advance, 1 + EXIT_ORDER index); length: Float64Array; used: Float64Array; anchor: Int32Array; speed: Float64Array; leave: Int32Array; endKind: Uint8Array; endDay: Int32Array; endStage: Uint8Array; entered: Int32Array (7 per row, NO_DAY); units: Int32Array; stories: Float64Array (NaN = null); existing: Int32Array; yieldCap: Int32Array; envelope: Int32Array; level: Uint8Array; env: Int32Array; top: Int32Array; yields: Int32Array (FILL_LEVELS.length per row); phaseNext: Int32Array (0 = none); phaseDay: Int32Array; kind: Uint8Array (0 market, 1 affordable); funded: Uint8Array; applied: Int32Array; granted: Float64Array; lent: Float64Array; guaranteed: Float64Array; programmes: string[] (ids joined with ','); revLast: Int32Array; revN; revDay: Int32Array; revUnits: Int32Array; revStories: Float64Array; revPrev: Int32Array; dispN; dispRow: Int32Array; dispDay: Int32Array; dispUnits: Int32Array }`.
  - `emptyWorld(frameId: number): World` (`month` 0, empty columns, `line` and `pools` `{ n: 0 }`).
  - `addProject(p: ProjectColumns): number` (new row: `entered` NO_DAY, `stories` NaN, `endKind` END_ALIVE, `stopAt` NO_STOP, `revLast` -1, `project`-side defaults).
  - `pushRev(p: ProjectColumns, row: number, day: Day, units: number, stories: number | null): void` (today's `pushRevision` merge, `engine.ts:424-444`, on the linked entries; the first entry is never removed).
  - `revisionsOf(p: ProjectColumns, row: number, upTo: Day): Schedule['revisions']`.
  - `lotRow(l: LotColumns, lot: number): number` (-1 when absent), `ensureLot(l: LotColumns, lot: number, asOf: Day): number` (inserts a row in place if absent: state LOT_FREE, k 0, r and lastExit `asOf`, project -1).
  - `class DueList implements Due { constructor(readonly through: number) }`.

- [ ] **Step 1: Write the failing tests**

`columns.spec.ts`:

```ts
it('keeps lot rows ascending and their columns with them', () => {
  const w = emptyWorld(0);
  for (const lot of shuffled(1000)) w.lots.k[ensureLot(w.lots, lot * 7, 100)] = lot;
  expect(w.lots.n).toBe(1000);
  for (let i = 1; i < w.lots.n; i++) expect(w.lots.lot[i]).toBeGreaterThan(w.lots.lot[i - 1]);
  for (let lot = 0; lot < 1000; lot++) expect(w.lots.k[lotRow(w.lots, lot * 7)]).toBe(lot);
  expect(lotRow(w.lots, 3)).toBe(-1);
});
it('merges revisions as today', () => {
  // pushRev(…, 10, 5, 2); pushRev(…, 20, 7, 3); pushRev(…, 20, 5, 2) → [{10,5,2}] (merge then pop)
  // pushRev(…, 30, 9, null) → [{10,5,2},{30,9,null}]; revisionsOf(…, 29) → [{10,5,2}]
});
it('is a full copy under structuredClone', () => {
  // a world with 3000 project rows and 500 lot rows (growth past the first capacity)
  expect(structuredClone(w)).toEqual(w);
});
```

`due.spec.ts`:

```ts
const d = new DueList(10);
d.put(5, 3); d.put(-2, 3); d.put(1, 3);
expect(Array.from(d.take(3))).toEqual([-2, 1, 5]);
expect(d.take(3)).toHaveLength(0);
d.put(7, 4); d.drop(7); expect(d.take(4)).toHaveLength(0);
d.put(7, 4); d.put(7, 6); expect(d.take(4)).toHaveLength(0); expect(Array.from(d.take(6))).toEqual([7]);
d.put(8, 5); d.put(8, 11); expect(d.take(5)).toHaveLength(0); expect(d.take(11)).toHaveLength(0);
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/sim/world/columns.spec.ts src/lib/sim/world/due.spec.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** (grow by doubling every typed column of the object; `entered` and `yields` grow by their stride)

- [ ] **Step 4: Run them to see them pass**

- [ ] **Step 5: Commit**

```bash
git add src/lib/sim/world
git commit -m "feat(world): world columns, lot lookup and the due list"
```

---

### Task 4: The ordinary clock (rules 5, 6)

**Files:**
- Create: `src/lib/sim/world/rates.ts`
- Test: `src/lib/sim/world/rates.spec.ts`

**Interfaces:**
- Consumes: `exp`, `log` (`timelapse/math.ts`), `piecewiseMonth`, `lastInitiationMonth` (`input.ts:243, 216`), `simEntity`, `drawOn`, `streamOf`, `P` (`rng.ts`), Task 1's month functions.
- Produces:
  - `startRates(view: ZoningView, market: number): Float64Array` (Decisions).
  - `lotEntity(statics: Statics, lot: number): number` (`simEntity(parcelId[lot])`, memoised per `statics.parcelId` array).
  - `interface OrdinaryStart { day: Day; month: number; frameMonth: number }` (`frameMonth`: the model month holding the first day of the lot-month in which the threshold passes).
  - `ordinaryStart(statics: Statics, timeline: PolicyTimeline, month: number, sh: number, lot: number, r: Day, k: number): OrdinaryStart | null` — the lot free since `r` on attempt `k`, evaluated when `month` is the latest month whose frame may be read: frames for the months from `monthOfDay(r + 1)` (capped at `month`) and each `timeline.changes()` entry `c` with `monthOfDay(r + 1) < c <= month`; bounds `lastInitiationMonth(r, monthFirstDay(c) - 1)`; rates `startRates(frame.view, frame.market)[lot]`; equal neighbours merged; `L = log(1 - drawOn(stream, P.INIT, 0))`; `T = piecewiseMonth(L, bounds, rates)`; null when T is 0; the day `r + 1 + floor((T - 1 + drawOn(stream, P.INIT_DAY, 0)) * MONTH_DAYS)` (`engine.ts:961-966`). Never calls `frameAt` above `month`.

- [ ] **Step 1: Write the failing tests** (mini and bench city; `const pre = precomputeOf(input)`)

```ts
it('startRates is precompute log1mh at the market in force at asOf', () => {
  expect(Array.from(startRates(viewOf(input), marketAt(input, input.asOf)))).toEqual(Array.from(pre.log1mh));
});
it('one frame: the day of today’s first initiation, every candidate, seeds 1..3', () => {
  // for c of pre.candidates, i = candidates[c], stream = streamOf(seedHash(s), pre.entity[c], 0):
  //   T = ordinaryMonth(drawOn(stream, P.INIT, 0), pre.log1mh[i], null, [])
  //   want = T === 0 ? null : asOf + 1 + floor((T - 1 + drawOn(stream, P.INIT_DAY, 0)) * MONTH_DAYS)
  expect(ordinaryStart(statics, oneFrame(frameOf(input)), 1, seedHash(s), i, asOf, 0)?.day ?? null).toBe(want);
});
it('two frames: piecewiseMonth over regimeMonths bounds', () => {
  // market change at m = 37, rates l0 = startRates(view, s0), l1 = startRates(view, s0 + 0.4);
  // for r in {asOf, asOf + 1000}, k = 2, month = 60:
  //   T = piecewiseMonth(log(1 - u), regimeMonths(r, [monthFirstDay(asOf, 37)]), [l0[i], l1[i]])
  //   expect day and frameMonth = monthOfDay(asOf, r + 1 + floor((T - 1) * MONTH_DAYS))
});
it('a change that leaves the rate alone gives exactly the one-frame plan', () => {
  // changingAt(37, f, { ...f, id: 1, speed: halfFiled }) vs oneFrame(f): equal for every candidate, seed 1
});
it('reads no frame past `month`', () => {
  // limited(t, () => 12): ordinaryStart(…, month 12, r = monthLastDay(asOf, 12), …) does not throw
});
it('zero and infinite rates across segments', () => {
  // fake views whose pre.logit is Float64Array.of(-Infinity, 40, -2) (40 gives h = 1, rate -Infinity):
  // lot 0: rate 0 then -Infinity at change month 5, r = asOf → frameMonth 5, lot-month 5
  // lot 1: -Infinity from the start → lot-month 1; no result is NaN
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/sim/world/rates.spec.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** (merging: drop a bound whose two sides have `rates[j] === rates[j + 1]`)

- [ ] **Step 4: Run them to see them pass**

- [ ] **Step 5: Commit**

```bash
git add src/lib/sim/world/rates.ts src/lib/sim/world/rates.spec.ts
git commit -m "feat(world): the ordinary start clock over the frames a lot has lived through"
```

---

### Task 5: The stage clock (rules 10 to 13, 15)

**Files:**
- Create: `src/lib/sim/world/stage.ts`
- Test: `src/lib/sim/world/stage.spec.ts`

**Interfaces:**
- Consumes: `sampleTransition`, `sampleAdvance` (`model.ts:442, 350`), `stageMonths` (`time.ts:48`), `revisionRatio`, `scaledTransition` (`engine.ts:401, 490`), `MIN_SCALE`, `MAX_SCALE`, `fillStories`, `FILL_LEVELS`, Task 3's columns and `pushRev`.
- Produces:
  - `speedOf(frame: PolicyFrame, pathway: Pathway, stage: Stage, filed: Day): number` — `frame.speed[pathway][stage] ?? 1`, times each `speedNew[i].scale[pathway][stage] ?? 1` with `filed === NO_DAY || filed >= from` (Open question 2), in list order, then clamped to `[MIN_SCALE, MAX_SCALE]`.
  - `rowSpeed(w: World, row: number, frame: PolicyFrame): number` (`filed` = `w.projects.filed[row]`; masters and phases, and pipeline rows not at `preApplication` on the dataset date, have `filed` set to the dataset date or earlier, Open question 1).
  - `enterStage(w: World, row: number, stage: number, entered: Day, survived: number, frame: PolicyFrame): void` — draws on `frame.newCalibration` when `isNew`, else `frame.calibration` (rule 10); a certain row takes `sampleAdvance(t, drawOn(stream, P.STAGE_TIME, stage)).days` as its length with outcome advance and never reads `P.STAGE` (rule 15); else `sampleTransition(t, drawOn(stream, P.STAGE, stage), drawOn(stream, P.STAGE_TIME, stage), stageMonths(survived))`; sets `outcome`, `length`, `used = survived`, `anchor = entered + survived`, `speed = rowSpeed`, `leave = anchor + floor(speed * (length - used))` (rule 11).
  - `reanchor(w: World, row: number, c: Day, speed: number): void` — rule 12: `used += (c - anchor) / speedOld`, `anchor = c`, `leave = max(c, c + floor(speed * (length - used)))`.
  - `reviseOnEntry(w: World, row: number, stage: number, day: Day, frame: PolicyFrame): boolean` — rule 13 with `frame.calibration.revision.at` (first entry per stage, memoised per calibration), none from construction on and none for `RULE_NONE` (masters, certain rows); pipeline and simulated formulas of `engine.ts:453-480` on the row's stored caps and yields; records through `pushRev`; true when the units changed (the caller sends `'revise'`).

- [ ] **Step 1: Write the failing tests** (mini calibration transitions; 200 streams `streamOf(seedHash(1), e, 0)`)

```ts
it('speed: product of speed and the speedNew entries that reach the row, clamped', () => {
  const half = { ...IDENTITY, discretionary: { filed: 0.5 } };
  const f = { ...frame, speed: half, speedNew: [{ from: 500, scale: half }] };
  expect(speedOf(f, 'discretionary', 'filed', NO_DAY)).toBe(0.25);
  expect(speedOf(f, 'discretionary', 'filed', 500)).toBe(0.25);
  expect(speedOf(f, 'discretionary', 'filed', 499)).toBe(0.5);
  expect(speedOf(f, 'discretionary', 'entitled', NO_DAY)).toBe(1);
  // speed 0.1 × speedNew 0.1 → MIN_SCALE (0.05); 5 × 5 → MAX_SCALE (10)
});
it('a fresh stage ends where today’s stage step does', () => {
  // for s in {1, 0.5, 1.7}: leave === entered + scaledTransition(t, uK, uT, 0, s).days, outcome matches the kind
});
it('a stage in flight on the dataset date is drawn given the days survived', () => {
  // entered e = asOf - 40, survived = asOf + 1 - e: leave === e + scaledTransition(t, uK, uT, survived, s).days
});
it('a certain row advances on sampleAdvance', () => {
  // streams whose ordinary kind is an exit: outcome 0, leave === e + floor(s * sampleAdvance(t, uT).days)
});
it('reanchor carries the used length', () => {
  // anchor 100, used 0, length 60, speed 1 (leave 160): reanchor(c 130, 0.5) → used 30, leave 145;
  // reanchor(c 140, 2) → used 50, leave 160
});
it('reanchor clamps to the change day', () => {
  // anchor 0, used 0, length 0.3, speed 10 (leave 3): reanchor(c 3, 1) → leave 3
});
it('revisions follow today’s pipeline and simulated rules', () => {
  // a stream where REV fires: pipeline units 100, yieldCap 150, stories 10, envelope 12 →
  // units min(max(1, round(r * 100)), 150), stories capped at max(10, 12) when upsizing (engine.ts:465-471);
  // simulated: min(top, max(existing + 1, round(r * units))), stories fillStories(FILL_LEVELS[f], env) (:473-478);
  // no revision at construction, none for RULE_NONE
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/sim/world/stage.spec.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run them to see them pass**

- [ ] **Step 5: Commit**

```bash
git add src/lib/sim/world/stage.ts src/lib/sim/world/stage.spec.ts
git commit -m "feat(world): stage clock, speed, re-anchoring and revisions"
```

---

### Task 6: Pipeline rows, masters and phases; the step for projects; their readers

The pipeline's schedules and masters never depend on simulated lots (`engine.ts:714-848` run before the simulated pass), so this task gets its own exact referee before lots exist.

**Files:**
- Create: `src/lib/sim/world/pipeline.ts`, `src/lib/sim/world/world.ts`, `src/lib/sim/world/read.ts`, `src/lib/sim/world/index.ts`, `src/lib/sim/world/test/run.ts`
- Modify: `src/lib/sim/world/due.ts` (`planDue`, projects only)
- Test: `src/lib/sim/world/pipeline.referee.spec.ts`

**Interfaces:**
- Consumes: Tasks 1 to 5; `isSkipped`, `nextStage` (`engine.ts:644, 93`); `jobEntity`, `streamOf`, `seedHash`, `drawOn`, `P` (`rng.ts`).
- Produces:
  - `rowStaticsOf(statics: Statics, view: ZoningView): RowStatics` (per `statics.projects` row: its view rows, `yieldCap`, `envelope`, and for a phased row `all`, `rest` and per phase rows, caps and existing homes; memoised per (statics, view); the old `staticOf`, `engine.ts:171-215`).
  - `createWorld(statics, timeline, seed, out): World` (S2): every non-skipped row of `statics.projects` in order gets a row (rule 3; `pipelineRow`, `masterOf`, `engine.ts:661-704, 742-786`): entered days clamped to `asOf`, the current stage entered on its history day or `asOf`, `filed` = its filing day or the dataset date (NO_DAY for a row at `preApplication`), `isNew` for an unphased row at `preApplication`, the current stage drawn with `survived = asOf + 1 - e`, `'start'` (day = earliest entered) then `'enter'` for each entered stage in `STAGE_ORDER`. A master entitled on the dataset date ends `'entitled'` at E and plans its phases; `world.frame = timeline.frameAt(1).id`.
  - Phases (`phaseFiledDay`, `phaseSchedule`, `engine.ts:792-805, 855-898`): at entitlement on E the master stores `phaseNext = 1`, `phaseDay = F_1`; when due, each phase filing in the month is filed in order: `'phaseFiled'` (row = the master, phase = i), a new row (origin PHASE, `rule` pipeline, caps from month 1's view, `filed` = dataset date), `'start'` then `'enter' permitFiled`, its stage drawn fresh; then `phaseDay = F_{i+1}` (gap draws on `streamOf(sh, masterEntity, i)` and `frame.calibration.phaseGap`).
  - `step(world, due, statics, timeline, seed, out): void` (S2) with systems 3 and the month update for now: `month = world.month + 1`, `frame = timeline.frameAt(month)`; `due.take(month)`; project entities (`-1 - row`) processed in ascending row order (the reverse of `take`'s order), each followed to the end of the month (rule 14): leave, `'end' exit`; or `'enter'` next stage (an unentitled master stops on entering `entitled`: `'enter' entitled` when that stage is the stop, `'end' entitled`, phases planned), `'end' complete` after `'enter' complete`, `'revise'` after `'enter'` when it changes; a row still alive is `put` at `monthOfDay(leave)`; a master with a phase to file at `monthOfDay(phaseDay)`. Then `world.month = month`, `world.frame = frame.id`.
  - `planDue(world, statics, timeline, seed, through): DueList` (S11; projects only in this task).
  - `scheduleAt(world, statics, row, day): Schedule | null` and `masterAt(world, statics, row, day): Master | null` (S8, rule 22) for pipeline, phase and master rows: `projectId`, `parcelIds` (copies), `pathway`, `entered` (days `<= day`), `end` (`'open'` unless it ended by `day`), `revisions` (`<= day`), `existingUnits` (pipeline: `existingUnits` of the row; phase: the row's `existing`), `multiPhase`, `phase` (`start` `'scheduled'` when the plan date is after `asOf` and equals the filing day), `inFlight: true` on rows that run on `calibration` (Open question 4); masters: Planning-side `entered`, `end`, `phaseUnits`, `phaseFiled` from the phase rows filed by `day`.
  - Test support (`test/run.ts`): `class Recorder implements StepSink { events: (WorldEvent & { month: number })[]; month: number }` (the step's month is set by `runWorld` before each call, 0 during `createWorld`); `runWorld(statics: Statics, timeline: PolicyTimeline, seed: number, through: number, out?: StepSink, opts?: { rebuildEvery?: number; plan?: typeof planDue; step?: typeof step; create?: typeof createWorld }): World`; `readAll(world: World, statics: Statics, day: Day): { schedules: Schedule[]; masters: Master[] }` (ordered as `simulateDetailed` orders them, `simulate.ts:49-52`); `SEEDS = [1..20]`, `LIVE_SEEDS = [1..5]`, `horizonMonth(asOf) = monthOfDay(asOf, HORIZON)` (`fzp/time.ts:21`).

- [ ] **Step 1: Write the failing referee** (`pipeline.referee.spec.ts`, bench and fixture cities, `it.each(SEEDS)`)

```ts
it.each(SEEDS)('bench seed %i: pipeline schedules and masters equal today’s', (seed) => {
  const old = simulateDetailed(oldInputOf(bench), seed, HORIZON);
  const w = runWorld(statics, oneFrame(frameOf(bench)), seed, horizonMonth(bench.asOf));
  const mine = readAll(w, statics, HORIZON);
  expect(mine.schedules.filter((s) => s.origin === 'pipeline')).toEqual(
    old.schedules.filter((s) => s.origin === 'pipeline')
  );
  expect(mine.masters).toEqual(old.masters);
});
// the same for the fixture city; and one non-degeneracy check per city:
// some phase schedules, some masters entitled, some exits, completes and opens, some revisions
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest --run --project server src/lib/sim/world/pipeline.referee.spec.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** (no lots, holds or starts yet: system 3 only)

- [ ] **Step 4: Run it to see it pass**; then `npm run lint` and `npm run check`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sim/world
git commit -m "feat(world): pipeline rows, masters and phases stepped month by month"
```

---

### Task 7: Lots, holds and ordinary starts; the one-frame referee

**Files:**
- Create: `src/lib/sim/world/holds.ts`, `src/lib/sim/world/referee.spec.ts`
- Modify: `src/lib/sim/world/world.ts`, `src/lib/sim/world/pipeline.ts`, `src/lib/sim/world/due.ts`, `src/lib/sim/world/read.ts`

**Interfaces:**
- Consumes: Tasks 3 to 6; `pathwayFrom` (`engine.ts:910`), `sizeCumAgainst` (`input.ts:346`), `FILL_LEVELS`, `fillStories`.
- Produces:
  - Holds (rule 9; `engine.ts:593-627, 706-729, 814-848`; `funded.ts:1595-1602`): `createWorld` gives a lot row to every lot a non-skipped row holds (an unphased row its own lots; a phased master `all`) and to every lot a skipped row names (its own lots only, blocked; `engine.ts:720-722`), marks a lot demolished when a holder's history has `construction`, and sets LOT_HELD or LOT_DONE. `holdEnd(world, lots: Int32Array, exitDay: Day | null)`: an exit raises `lastExit`, and the last holder's exit frees a lot that is not blocked (LOT_FREE, `r = lastExit`, k 0, planned); a completion or anything else blocks it. At entitlement a master blocks `rest`, passes holds to its phases' lots, then releases `all`. Entering construction demolishes every lot the row holds.
  - `StepCtx` (S12) built once per step: `firstDay`, `lastDay` (rule 1), `frame`, `month`, `startProject`, `displace`.
  - `startProject(lot, day, funded)` (rule 17; `simulatedProject`, `startSimulated`, `engine.ts:976-1066`): with `funded` null, the start frame is `frameAt(min(frameMonth, month))` from `ordinaryStart` (Open question 3); size from `SIZE` on that view's `pre.sizeCum`, or `sizeCumAgainst` with 0 existing homes on a demolished lot whose own homes are not 0 (the `SimInput` passed is `{ parcels: view.parcels, projects: statics.projects, calibration: frame.calibration, asOf: statics.asOf, districtMaxStories: statics.districtMaxStories }`); no level gains a home → the lot is LOT_DONE and no row is made; route `streamlined` when the start frame's `view.parcels.localProgram[lot]` is 1 (conductor ruling: the switch is the view's column; `newCalibration` carries the route shares only), else `pathwayFrom(frame.newCalibration.pathwayForNew, stream)`; first stage by `P.PPA` on `ppaShare`; the row stores level, units, stories, existing, env, top and the view's yields at every level; `filed` = start day unless the first stage is `preApplication`; `'start'`, `'enter'`; the stage chain to the month's end; the lot LOT_LIVE with `project` set. With `funded`: size, view and route from it (`pathway` null draws the route as above), `certain`, `kind`, `applied`, dollars and programmes stored, `funded = 1`.
  - `displace(row, lot, day, units)`: appends to the displacement table and sends `'displaced'`.
  - `step` systems 4 and 6 for the unfunded world (rule 16, 18): free lots due this month (from `take`, plus those freed by system 3 whose start falls this month) are set aside, sorted by `statics.rank` (rule 2), and each starts, its chain followed (rule 14: an exit frees the lot from the exit day on attempt k + 1 and a start inside the month is made at once; a start in a later month is `put`). A due lot whose start is not in this month throws (`'due list out of step'`).
  - `planDue` adds every free lot: lots with no row (free since `asOf`, k 0) and lot rows in LOT_FREE, each `put` at `ordinaryStart(…, world.month + 1, …).month`.
  - Readers for simulated rows: `projectId` `sim:<parcelId>:<k>`, `origin` simulated, `parcelIds` `[parcelId]`, `existingUnits` the row's `existing`, `multiPhase` false, `phase` null; `kind: 'affordable'` and `funding` only on funded rows (`funding.displaced` sums displacements dated `<= day`).

- [ ] **Step 1: Write the failing referee** (`referee.spec.ts`)

```ts
describe.each(['bench', 'fixture'])('%s, one frame, no money', (city) => {
  it.each(SEEDS)('seed %i equals simulateDetailed at the horizon', (seed) => {
    const old = simulateDetailed(oldInputOf(input), seed, HORIZON);
    const w = runWorld(statics, oneFrame(frameOf(input)), seed, horizonMonth(input.asOf));
    const mine = readAll(w, statics, HORIZON);
    expect(mine.schedules.map((s) => s.projectId)).toEqual(old.schedules.map((s) => s.projectId));
    for (let i = 0; i < old.schedules.length; i++)
      expect(mine.schedules[i], old.schedules[i].projectId).toEqual(old.schedules[i]);
    expect(mine.masters).toEqual(old.masters);
  });
  it('is not degenerate', () => {
    // seed 1: simulated schedules > 0; some lot starts again after an exit (k ≥ 1);
    // some start on a demolished lot (existingUnits 0 where the parcel has homes);
    // some row enters and leaves a stage inside one step (Recorder months), and some lot is freed
    // and starts again in the same step
  });
});
describe.skipIf(liveDir() === null)('live, one frame, no money', () => {
  it.each(LIVE_SEEDS)('seed %i equals simulateDetailed at the horizon', /* as above */);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest --run --project server src/lib/sim/world/referee.spec.ts` — Expected: FAIL (no simulated schedules).

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run it, and Task 6's referee, to see them pass**

Run: `npx vitest --run --project server src/lib/sim/world` — Expected: PASS (live block skipped without a local copy; run it once with `SFH_WORLD_LIVE` set when a copy exists and say which in the report).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sim/world
git commit -m "feat(world): lots, holds and ordinary starts; one-frame referee against simulateDetailed"
```

---

### Task 8: One-frame referee variants

**Files:**
- Test: `src/lib/sim/world/referee.variants.spec.ts`
- Modify (only if a variant fails for a reason in this plan's scope): `stage.ts`, `world.ts`

**Interfaces:**
- Consumes: Task 2's `frameOf`, `oldInputOf`, `scaleProduct`; `routeSharesOp` (`levers/timers.ts:175`); Task 6's `runWorld`, `readAll`.

- [ ] **Step 1: Write the referee cases** (bench and fixture, `it.each(SEEDS)`, each as Task 7's comparison)

| Case | Frame | Old input |
| --- | --- | --- |
| market shifted | `market: marketAt(input, asOf) + 0.5` | `market: [{ from: input.asOf, logOdds: marketAt(input, input.asOf) + 0.5 }]` |
| speed not 1 | `speed: A` with `A = { discretionary: { filed: 0.6, entitled: 1.4 }, streamlined: { permitFiled: 0.5 }, permitOnly: { permitIssued: 1.3 } }` | `inFlightScale: A`, `newScale: A` |
| `speedNew` from `asOf + 1` | `speed: A`, `speedNew: [{ from: asOf + 1, scale: N }]`, `N = { discretionary: { filed: 0.5, permitFiled: 0.7 }, streamlined: {}, permitOnly: { permitFiled: 2 } }` | `inFlightScale: A`, `newScale: scaleProduct(A, N)` |
| route shares | `newCalibration: routeSharesOp({ discretionary: 1, streamlined: 2, permitOnly: 1 })(cal, parcels).cal` | `newCalibration` the same object |

- [ ] **Step 2: Run them**

Run: `npx vitest --run --project server src/lib/sim/world/referee.variants.spec.ts`
Expected: PASS when Open questions 1 and 2 are ruled as recommended. A failure on phases or masters in the `speedNew` case means the ruling went the other way: stop and report.

- [ ] **Step 3: Commit**

```bash
git add src/lib/sim/world
git commit -m "test(world): referee under market, speed, speedNew and route-share frames"
```

---

### Task 9: Frame changes (system 1; rules 7, 12)

**Files:**
- Modify: `src/lib/sim/world/world.ts`
- Test: `src/lib/sim/world/frames.referee.spec.ts`, `src/lib/sim/world/frames.property.spec.ts`

**Interfaces:**
- Produces: system 1 of `step` when `frame.id !== world.frame`: (a) lots: when `touched(month)` is null or `frame.market !== frameAt(month - 1).market`, every free lot; else the free lots among `touched(month)`; each `drop`ped then `put` at its new `ordinaryStart(…, month, …)` month (none when null); (b) projects: every alive row in a stage whose `rowSpeed` under `frame` differs from its `speed` is re-anchored on `firstDay` (rule 12) and `drop`ped and `put` at `monthOfDay(leave)`. `due.take(month)` runs after system 1.

- [ ] **Step 1: Write the failing tests**

`frames.referee.spec.ts` (bench and fixture, `it.each(SEEDS)`, m = 121):

```ts
it.each(SEEDS)('a zoning change at month m equals today’s dated regime (seed %i)', (seed) => {
  const rows = everyTenth(precomputeOf(input).candidates);
  const p2 = upzoned(input, rows);
  const old = simulateDetailed(oldInputOf(input, { regimes: [{ day: monthFirstDay(asOf, 121), parcels: p2 }] }), seed, HORIZON);
  const after = frameOf(input, { id: 1, view: { parcels: p2, pre: precomputeOf({ ...input, parcels: p2 }) } });
  const w = runWorld(statics, changingAt(121, frameOf(input), after, touchedRows(input.parcels, p2)), seed, horizonMonth(asOf));
  expect(readAll(w, statics, HORIZON)).toEqual(withoutRegime(old)); // `regime` deleted (Open question 4)
});
it.each(SEEDS)('a market change at month m equals today’s market step (seed %i)', /* old market [s0 at asOf, s0 + 0.4 from monthFirstDay(asOf, 121)]; frames market s0 then s0 + 0.4, touched null */);
```

`frames.property.spec.ts` (bench, seeds 1 to 5; Recorder events keyed by `projectId` through the readers, not by row):

```ts
it('a speed change moves days one way and changes no outcome', () => {
  // frame B = A with speed { discretionary: { filed: 0.5, entitled: 0.5 }, … } from month 121:
  // events of createWorld and steps 1..120 identical (deep, rows included);
  // for every projectId ended in both runs: same end kind, stage and reason;
  // for every projectId in both: each entered day in B <= in A; with scale 1.5 instead, >=
});
it('a zoning change leaves events before it and untouched lots alone', () => {
  // events of steps < 121 identical; every pipeline, master and phase event identical for the whole run;
  // every event of a simulated project on a lot not in touched(121) identical;
  // and some project on a touched lot differs (not degenerate)
});
it('a start straddling the change takes its lot-month’s view', () => {
  // find (search seeds 1..20) a simulated project whose start day is in month 121 and whose lot-month
  // began in month 120 on a touched lot: its revisions[0].units is the old view's yield at its level
});
it('a lot freed on a month’s last day is planned again at the next change', () => {
  // a hand-built world (Task 3 columns) with a lot freed on monthLastDay(asOf, 120); limited(t, () => 120)
  // allows planning at 120; stepping 121 under a market change replans it; its start equals
  // ordinaryStart computed at month 121
});
it('a re-anchored stage ending this month is stepped this month', () => {
  // a speed cut at month m makes some row's new leave fall inside month m: its next 'enter' has month m
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/sim/world/frames.referee.spec.ts src/lib/sim/world/frames.property.spec.ts` — Expected: FAIL.

- [ ] **Step 3: Implement system 1**

- [ ] **Step 4: Run every world spec to see them pass**

Run: `npx vitest --run --project server src/lib/sim/world` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sim/world
git commit -m "feat(world): frame changes replan touched lots and re-anchor stage clocks"
```

---

### Task 10: The due list rebuilt, the window extended, the skip shortcut, copies

**Files:**
- Modify: `src/lib/sim/world/due.ts`, `src/lib/sim/world/rates.ts`, `src/lib/sim/world/world.ts`
- Test: `src/lib/sim/world/due.property.spec.ts`

**Interfaces:**
- Produces: `skipBound(statics: Statics, timeline: PolicyTimeline, month: number, through: number): Float64Array` (per statics row; Decisions); `planDue` and `step`'s whole-city replan skip a row-less lot whose `INIT` draw on attempt 0 is above it; `planDueWith(world, statics, timeline, seed, through, opts: { skip: boolean }): DueList` (test seam; `planDue` is `skip: true`). `step` throws `RangeError` when `timeline.readyThrough() < world.month + 1` (rule 19).

- [ ] **Step 1: Write the failing tests** (bench; frame change at month 121 with a market shift and a speed change; seeds 1 to 5)

```ts
it('a carried due list and one rebuilt every 12 months give the same events', () => {
  expect(run({ rebuildEvery: 12 }).events).toEqual(run({}).events);
});
it('a window extended in steps misses nothing', () => {
  // runWorld with planDue(…, through 60) then, at month 60, planDue(…, 480): events equal the 480 run
});
it('a copy stepped with a rebuilt due list gives the same events', () => {
  // at months 60 and 120 (before the change) and 180 (after): structuredClone(world), planDue for the copy,
  // step both to 240: identical events after the copy point, and expect(copyWorld).toEqual(world)
});
it('the skip shortcut changes no event', () => {
  expect(run({ plan: (…) => planDueWith(…, { skip: false }) }).events).toEqual(run({}).events);
});
it('never reads a frame past readyThrough', () => {
  // let ready = 1; t = limited(base, () => ready); before each step ready = world.month + 1, and planDue
  // is called with through = horizon: no RangeError, events equal the unlimited run
});
it('step refuses a month the timeline has not reached', () => {
  expect(() => step(w, due, statics, limited(t, () => 0), 1, sink)).toThrow(RangeError);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/sim/world/due.property.spec.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run every world spec to see them pass**

- [ ] **Step 5: Commit**

```bash
git add src/lib/sim/world
git commit -m "feat(world): planDue agrees with the carried due list; the skip shortcut"
```

---

### Task 11: The funding hook (S12; rules 15 to 18)

**Files:**
- Modify: `src/lib/sim/world/world.ts`, `src/lib/sim/world/due.ts`, `src/lib/sim/world/index.ts`
- Test: `src/lib/sim/world/funding-hook.spec.ts`

**Interfaces:**
- Consumes: `resolveTerms`, `MARKET_TERMS` (`src/lib/sim/finance`) for a test `FinanceFrame`.
- Produces: `withFunding(f: FundingSystem | null): { createWorld; step; planDue }` (S12); `index.ts` exports `createWorld`, `step`, `planDue` as `withFunding(null)`'s. With `f` and `frame.finance` non-null: `create(world, statics, frameAt(1))` at the end of `createWorld`; system 1 ends with `policyChanged(ctx)`; system 2 `moneyIn(ctx)`; every event sent in system 3 is passed to `onProjectEvent(ctx, e)` after it is sent; system 4 calls `apply(ctx, lots)` with the due free lots (rank order) for which `planLot(ctx, lot) === month`, and sets aside those whose ordinary start falls this month; system 5 `serve(ctx)`; system 6 starts each set-aside lot that is still free with no project started on it this month, passing each `'start'` to `onProjectEvent`; system 7 `shadow(ctx)`. A free lot is planned at `min(ordinary month, planLot || Infinity)`. In `planDue`, `planLot` gets a ctx for month `world.month + 1` with a sink that drops events and `startProject`/`displace` that throw.

- [ ] **Step 1: Write the failing tests** (mini city; a `FinanceFrame` with no pools, `offered` empty, `arrivals` [])

```ts
it('calls the hooks in system order', () => {
  // a recording stub over 24 months with a frame change at month 13: per month
  // ['moneyIn', ('onProjectEvent')*, 'apply', 'serve', ('onProjectEvent' for each start)*, 'shadow'],
  // with 'policyChanged' first in month 13; 'create' once after createWorld's events
});
it('calls no hook without a FundingSystem or when the frame has no finance', () => {
  // withFunding(stub) under frames with finance null: no call; events equal withFunding(null)'s
});
it('a certain funded start advances on sampleAdvance with no revision', () => {
  // stub.serve starts lots chosen in rank order with startProject(lot, ctx.firstDay, { certain: true, pathway: null, … }):
  // every stage of those rows has leave - entered === floor(speed * sampleAdvance(t, drawOn(stream, P.STAGE_TIME, s)).days);
  // no 'revise' event for them; no 'end' exit; scheduleAt shows funding.certain true and the stored dollars
});
it('a lot taken by a funded start this month is not started again by system 6', () => {
  // stub serves a lot whose ordinary start falls this month: one 'start' for that lot this month
});
it('displace records homes on the funded row', () => {
  // stub.shadow calls ctx.displace(row, lot, ctx.lastDay, 12): one 'displaced' event; scheduleAt(…, lastDay).funding.displaced === 12,
  // scheduleAt(…, lastDay - 1) sees 0
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/sim/world/funding-hook.spec.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run every world spec to see them pass**

- [ ] **Step 5: Commit**

```bash
git add src/lib/sim/world
git commit -m "feat(world): the funding hook and funded starts"
```

---

### Task 12: Order, permutation and cross-engine determinism

**Files:**
- Create: `src/lib/sim/world/world.golden.cases.ts`, `src/lib/sim/world/world.golden.shared.ts`, `src/lib/sim/world/world.golden.test.ts`, `src/lib/sim/world/world.golden.svelte.spec.ts`, `src/lib/sim/world/fixtures/build-world-golden.ts`, `src/lib/sim/world/fixtures/world-events-mini-seed1.json`
- Test: `src/lib/sim/world/order.property.spec.ts`

**Interfaces:**
- Produces: `goldenWorldEvents(): (WorldEvent & { month: number })[]` (mini city, seed 1, through month 300, a frame change at month 121 with a market shift and a speed change), as a JSON round trip; the builder writes it (`env -C <worktree> node_modules/.bin/tsx src/lib/sim/world/fixtures/build-world-golden.ts`, run deliberately, never from signoff).

- [ ] **Step 1: Write the failing tests**

`order.property.spec.ts` (bench and fixture, seeds 1 to 3, with Task 9's change):

```ts
it('start comes first and every event lies in its month', () => {
  // per row: the first event is 'start', and there is one 'start' (a 'phaseFiled' names the master row,
  // which started earlier); every event with month > 0 has monthFirstDay(asOf, month) <= day <= monthLastDay(asOf, month)
});
it('permuting the lot table gives the same events (rule 2)', () => {
  // perm = a seeded shuffle of rows; p' = every per-row column of input.parcels permuted (stride from
  // length / count), index rebuilt; statics' from the permuted input (same ids, same ranks per id);
  // events equal after mapping 'displaced'.lot through perm; readAll equal
});
```

`world.golden.shared.ts`: `describeWorldGolden(where)` asserts the golden is not degenerate (starts, exits, completes, revisions, phases filed, events in months after 121) and `expect(goldenWorldEvents()).toEqual(golden)`; `world.golden.test.ts` calls it with `'server / V8'`, `world.golden.svelte.spec.ts` with `'client / browser engine'`.

- [ ] **Step 2: Build the golden, then run the tests**

Run: `env -C . node_modules/.bin/tsx src/lib/sim/world/fixtures/build-world-golden.ts`, then `npx vitest --run --project server src/lib/sim/world/order.property.spec.ts src/lib/sim/world/world.golden.test.ts` and `npx vitest --run --project client src/lib/sim/world/world.golden.svelte.spec.ts`
Expected: PASS in both projects.

- [ ] **Step 3: Commit**

```bash
git add src/lib/sim/world
git commit -m "test(world): event order, lot-table permutation and a Node/browser golden"
```

---

### Task 13: Cost bench and the doc

**Files:**
- Create: `src/lib/sim/world/world.bench.spec.ts`, `docs/dev/world-core.md`
- Modify: `CLAUDE.md` (scoped-docs list, after the finance entries)

**Interfaces:** none new.

- [ ] **Step 1: Write the bench** (perf project only; prints every number)

```ts
it('48 worlds, one month, no money, bench city: at most 3 ms', () => {
  // 48 worlds (seeds 1..48) with planDue through 480; step all 48 for months 1..24 (warm), then time
  // months 25..120, one sample per month; print the median and p90
  expect(median).toBeLessThanOrEqual(3);
});
describe.skipIf(liveDir() === null)('live city', () => {
  it('createWorld plus planDue through month 480, one world: printed', () => {
    // median of 5 (after 1 warm-up); print it; expect(ms).toBeGreaterThan(0)
  });
});
```

- [ ] **Step 2: Run it on an idle machine**

Run: `npx vitest --run --project perf src/lib/sim/world/world.bench.spec.ts`
Expected: PASS, with the numbers in the report; a busy machine's numbers are marked ballpark.

- [ ] **Step 3: Write `docs/dev/world-core.md`**: the world and its columns (and that lots have rows only once something happens to them); the step and its seven systems in order; how a free lot's start is worked out from past frames (nothing stored), and what a frame change replans; the due list (`planDue`, `through`, rebuilding, the skip shortcut); the readers; the funding hook and when each method is called; the referee and property tests and where they live; the live-city switch `SFH_WORLD_LIVE`; the golden builder. Add to `CLAUDE.md`'s scoped-docs list: `- **World core (the world, the step and its systems, the due list, the readers, the funding hook)** — [docs/dev/world-core.md](docs/dev/world-core.md)`.

- [ ] **Step 4: Full verification**

Run: `npm run lint`, `npm run check`, `npx vitest --run --project server src/lib/sim/world`, `npx vitest --run --project client src/lib/sim/world`
Expected: all clean and passing. `git diff --stat origin/main -- pipeline src/lib/data src/lib/generator src/lib/timelapse src/lib/plan src/lib/sim/scenario src/lib/sim/levers src/lib/sim/finance src/lib/scoreboard` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sim/world/world.bench.spec.ts docs/dev/world-core.md CLAUDE.md
git commit -m "docs(world): world-core developer doc and the world cost bench"
```

---

## Coverage map

| Spec item | Task |
| --- | --- |
| S1 world, columns, `structuredClone` | 3, 10 |
| S2 `createWorld`, `step` | 6, 7, 9 |
| S3 `staticsOf` | 1 |
| S7 events and order | 6, 7, 12 |
| S8 readers | 6, 7, 11 |
| S9 draws | 4, 5 (imported) |
| S11 `Due`, `planDue` | 3, 6, 7, 10 |
| S12 hook, `StepCtx`, `FundedStart`, `withFunding` | 7, 11 |
| Rules 1, 2 | 1; 7, 12 |
| Rules 3, 4 | 6; 7 |
| Rules 5 to 9 | 4, 7, 9 |
| Rules 10 to 15 | 5, 6, 7, 9, 11 |
| Rules 16 to 19 | 7, 9, 10, 11 |
| Rules 20, 21 | 10 |
| Rule 22 | 6, 7, 11 |
| Referee: one frame (bench, fixture 1-20; live 1-5) | 7 |
| Referee: market, speed, `speedNew`, route shares | 8 |
| Referee: zoning change, market change | 9 |
| Properties: speed change, zoning change | 9 |
| Properties: copy, two-way due list | 10 |
| Properties: permutation, Node/browser, event order | 12 |
| Property: certain funded start | 11 |
| ESLint rule covers `src/lib/sim/world/**` | 1 |
| Cost: 48 worlds ≤ 3 ms; live create + plan printed | 13 |
| Doc and CLAUDE.md link | 13 |
