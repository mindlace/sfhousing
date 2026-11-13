# Finance Engine Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task by task. Do not use executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the F18 bench cases 2, 3 and 5 under their budgets with byte-identical engine output: per-run cost down, the cold precompute moved into bounded warm chunks, and funded runs resumable across the host's macrotasks.

**Architecture:** The profile (`.superpowers/sdd/finance-engine-perf-profile.md` in the main checkout) shows four things. The cold skip rates defeat the price memo by identity. Lazy table fills persist for many runs. The grouped line keeps a `Map<App, …>`. About 530,000 objects are allocated per run. Separately, a host band task is one whole funded run (about 118 ms). Tasks 1 to 3 cut the per-run cost, measured by prototype at 85 → 58 ms for case 3. Task 4 makes a funded run a generator that the host advances one slice at a time, so case 5 no longer depends on the per-run cost.

**Tech Stack:** TypeScript, Vitest (`server`, `perf`, `client` projects), SvelteKit worker host, Node 24.

**Spec:** `docs/superpowers/specs/2026-11-09-finance-engine-design.md` sections 4.17 (performance, fallback) and 3 (global constraints); F18 row; `docs/dev/finance-engine.md` "Performance: the bench and its budgets (F18)"; `docs/dev/finance-levers.md` "The finance warm task".

## Global Constraints

- **Byte-identical outputs.** `src/lib/sim/scenario/fixtures/golden-seed1.json`, `src/lib/timelapse/fixtures/model-golden.json`, `src/lib/sim/scenario/fixtures/golden-finance-seed1.json`, the pipeline fixture goldens and the lesscars goldens (`pipeline/test/fixtures/mini/golden/**`) pass UNCHANGED. Never regenerate a golden. A speed-up that needs an output change goes to Open questions with its measured gain.
- **No budget changes.** F18 belongs to the conductor. Do not edit any number in `expect(...).toBeLessThanOrEqual(...)` in `scenario.bench.spec.ts`. Changing how the bench's probe recognises a run (Task 4) is allowed.
- **Foreground only.** Every command runs in the foreground (timeouts up to 600000 ms). No background processes.
- **No compound `cd`.** Use absolute paths and `npm --prefix <dir> run …` / `git -C <dir> …`. Never write `cd X && cmd`.
- **`exp` and `log` from `$lib/timelapse/math` only** (never `Math.exp` or `Math.log`) in engine code.
- **Vitest runs with `expect.requireAssertions`:** every new test calls `expect`.
- **Conventional Commits.** Write multi-line messages to a file, commit with `git commit -F <file>`, then delete the file.
- **NO Claude attribution anywhere:** no `Co-Authored-By`, no "Generated with" footers, no mention in code, comments or docs.
- **No push, no dataset upload, no signoff.** The conductor runs build, upload, verify and signoff.
- House style: 2-space indent, single quotes, no trailing commas, 100 columns; Svelte 5 runes where Svelte is touched (it is not here).

## Review Focus

1. **Session churn while work is in flight.** A reroll, a lever revision or `dispose` arrives while a resumable run (Task 4) or a warm chunk sequence (Task 1) is part-way through. Expected: the stale generator is dropped (`return()`), nothing from the old revision is posted, and the new revision's outputs equal a fresh session's. Test: Task 4, `drops an in-flight run on reroll`.
2. **Two runs interleaved step by step.** The plan's band run pauses while the twin or another band run executes. Module state (`scratch` in `kindLatent`, `stats`, the shared memos) must not leak between them. Expected: each run's output equals the same run done alone. Test: Task 4, `interleaved engineSteps give each run its solo output`.
3. **Inputs with several finance segments** (a regime day, a programme `to`, an `off` span). Warm chunks and the eager tables must cover every segment and view. Expected: warmed and unwarmed runs are identical. Test: Task 1, `warmed and unwarmed runs are identical` over the deep shortcut cases.
4. **A run that starts before the warm finished,** or with no warm at all: `simulateNet` called directly (pipeline, lesscars, tests), or a reroll mid-warm. Expected: the run completes the remaining warm synchronously and gives the same output. Test: Task 1, `a run completes an unfinished warm and gives the same output`.
5. **Many distinct (bundle, level) values in one segment** (at least 255), which overflows the `Uint8Array` index. Expected: the segment's index is promoted, not wrapped. Test: Task 1, `a segment with 300 values keeps every index`.

## Timing protocol (every task's before/after step)

The machine is shared, so compare old and new in the same session, interleaved.

1. `uptime`. If the 1-minute load is below 2, label the numbers "quiet"; otherwise "ballpark", and rely on the ratio.
2. Once, before Task 1: create a baseline tree under the repo's worktree folder. `git -C /Users/mindlace/Projects/sfhousing/.claude/worktrees/finance-engine-perf worktree add --detach /Users/mindlace/Projects/sfhousing/.claude/worktrees/finance-engine-perf-base 736be467`, then `ln -s /Users/mindlace/Projects/sfhousing/.claude/worktrees/finance-engine-perf/node_modules /Users/mindlace/Projects/sfhousing/.claude/worktrees/finance-engine-perf-base/node_modules`, then `npm --prefix /Users/mindlace/Projects/sfhousing/.claude/worktrees/finance-engine-perf-base run prepare`. At the start of each task, move it to the previous task's commit: `git -C <base> checkout --detach <sha>`.
3. Run A (base), B (branch), A, B, A, B:
   `npm --prefix <tree> run test:perf -- src/lib/sim/scenario/scenario.bench.spec.ts -t "case 2|case 3"`
   (Task 1 and Task 4 also: `-t "case 4|case 5"`). Record each `[perf]` median.
4. Report each case's three medians per side, the median ratio B/A, the load, and the label. The final task removes the baseline tree (`git -C … worktree remove --force <base>`).

Profile numbers to beat (ballpark, load 1.2 to 2.3): case 2 34.9 ms, case 3 95.5 ms, case 4 4.0 s, case 5 161.1 ms (then about 118 ms per funded band task).

## File Structure

- `src/lib/sim/scenario/funded.ts`: warm (fused skip rates and tables), compact table index, sort key, structure-of-arrays walk, `fundedSteps` generator.
- `src/lib/sim/scenario/line.ts`: location fields on `App`, the `passes` probe in `threshold`.
- `src/lib/sim/scenario/funding.ts`: `awardPasses`, a non-allocating twin of `awardSet(...) !== null`.
- `src/lib/sim/scenario/engine.ts`: `engineSteps` generator; `runEngineWith` drains it.
- `src/lib/sim/scenario/simulate.ts`: `simulateNetSteps`, `simulateDetailedSteps`; the existing functions drain them.
- `src/lib/sim/scenario/scenario-host.ts`: chunked `'warm'` job; resumable `'net'` and `'shown'` jobs.
- Tests next to each: `funded.spec.ts`, `line.spec.ts`, `funding.spec.ts`, `engine-finance.spec.ts`, `scenario-host.finance.spec.ts`; the bench probe in `scenario.bench.spec.ts`.
- Docs: `docs/dev/finance-engine.md`, `docs/dev/finance-levers.md`.

---

### Task 1: Fused, chunked warm that fills the skip rates and the tables together

Cold today (funded input): `marketSkip` 209 to 219 ms and `affordableSkip` 220 to 237 ms in one warm task. The first band task pays the lazy table fill on top (161 ms). Lazy fills still run in steady state. Expected gain: case 3 about −18 to −20 ms (prototype: 78 → 58 after Task 2's changes); the first band task loses its +25 to +45 ms cold fill; the warm becomes chunks of at most about 25 ms each, quiet; table memory 19.6 → 15.9 MB.

**Files:**
- Modify: `src/lib/sim/scenario/funded.ts:186-199` (`skips`), `:262-317` (`skipRatesOf`; the per-level `filter` at `:297` is the memo-defeating allocation), `:521-559` (`KindTables`, `tablesOf`), `:620-642` (the table branch of `kindLatent`), `:384-413` (`sizeIn`, `sizeMemo`)
- Modify: `src/lib/sim/scenario/scenario-host.ts:364-365` (`Work.warm`), `:715-729` (`warmOf`, `warmStep`), `:867` (`nextJob`'s warm job)
- Test: `src/lib/sim/scenario/funded.spec.ts`, `src/lib/sim/scenario/scenario-host.finance.spec.ts`

**Interfaces:**
- Consumes: `financePreOf(input)` (`funded.ts:129`), `bundleOf` (`funded.ts:446`), `segValue` (`funded.ts:487`), `skipBounds`, `lastInitiationMonth`, `regimeMonths` (`input.ts:275`, `:231`), `viewsOf` (`funded.ts:224`).
- Produces:
  - `export interface FinanceWarm { /** Does the next `maxCandidates` candidates of the fused pass (both kinds); true once everything, bounds for `horizon` included, is built. */ step(maxCandidates: number): boolean; }`
  - `export function financeWarm(input: SimInput, horizon: Day): FinanceWarm`, memoised per (`FinancePre`, horizon). The pass progresses per input, so a second horizon only adds its `skipBounds`.
  - `export const WARM_CHUNK = 16_384` (candidates per host warm step; builder's call: 2 × 16,384 × about 0.7 µs ≈ 23 ms quiet).
  - `FinancePre.marketSkip(h)` / `affordableSkip(h)` and `tablesOf(fp)` keep their signatures. Called before the warm is done, they finish it synchronously (`financeWarm(input, h).step(Infinity)`).

- [ ] **Step 1: Write the failing tests** (`funded.spec.ts`, new `describe('the finance warm (perf Task 1)')`):
  - `financeWarm steps in chunks and finishes`: on `withFinance(withBenchFunding(benchBaseline(asOf), asOf))` (the mini city), `step(1)` returns `false` until the last candidate, then `true`, and every later call returns `true`.
  - `the warmed skip bounds equal the unwarmed ones`: for each input of the existing `cases` and `deep` arrays, `expect(Array.from(warmed.marketSkip(H))).toEqual(Array.from(cold.marketSkip(H)))`, and the same for `affordableSkip`. `warmed` is one `structuredClone`d input warmed with `step(1)` until done; `cold` is another that calls `marketSkip` directly.
  - `warmed and unwarmed runs are identical`: for the same inputs and seeds 1 to 5, `runCollect(warmedInput, seed, H)` `toEqual` `runCollect(coldInput, seed, H)` (order, schedules, ledger, reservations).
  - `a run completes an unfinished warm and gives the same output`: `step(3)` once, then `runCollect`; equal to a fully warmed copy's.
  - `a segment with 300 values keeps every index`: a finance with 300 market programmes of distinct `minHomes` 1 to 300 on one pool. After the warm, every eligible (slot, level) entry's `(bundle, level)` equals `segValue`'s. Expose the read through an `@internal` export `tableEntry(fp, kind, j, c, f): { rate: number; ref: number; bundle: number[]; level: number } | null` (builder's call: the narrowest seam that lets the test read the table).
- [ ] **Step 2: Run them and see them fail**
  Run: `npm --prefix /Users/mindlace/Projects/sfhousing/.claude/worktrees/finance-engine-perf run test:unit -- src/lib/sim/scenario/funded.spec.ts -t "finance warm"`
  Expected: FAIL, `financeWarm` is not exported.
- [ ] **Step 3: Implement `financeWarm` and the eager tables in `funded.ts`.** The fused pass, per candidate c and segment j, computes the segment's ordinary rate once. When the lot is eligible and has a hazard in the view, it calls `segValue` once per level with `units > 0`, using the canonical `bundleOf` arrays (never `filter`). It writes the table entry, and also the per-segment skip rate as the minimum over levels, as `skipRatesOf` does today (`certain` where a rate is `−Infinity`, stored as 0). `skipRatesOf` disappears. Look up the (bundle, level) index by array identity (`Map<number[], Map<level, index>>` per segment), not by a joined string. `at` becomes `Uint8Array` with 255 meaning "not filled"; a segment whose values reach 255 is promoted to `Uint16Array` (65,535 = not filled). Keep the lazy branch of `kindLatent` for an entry the warm did not fill (a level with 0 units). Lift `sizeIn`'s memo body into `sizeAt(parcels, i, f): LatentSize` so the warm and the run share it.
- [ ] **Step 4: Make the host step the warm.** `Work.warm` becomes a queue of `FinanceWarm`s (`financeWarm(input, w.horizon)` for each `warmOf` input). `warmStep` calls `step(deps.warmChunk ?? WARM_CHUNK)` and shifts the queue when it returns `true`. Each step keeps its own slice, as today. In `scenario-host.finance.spec.ts`, update the "warmed in its own task before the first band task" test: every warm step's task precedes the first `net` event, and with `deps.warmChunk: 1` on the mini city there is more than one warm task per input. "warming changes no output" stays as it is.
- [ ] **Step 5: Run the tests and the exactness guards**
  Run: `npm --prefix … run test:unit -- src/lib/sim/scenario/funded.spec.ts src/lib/sim/scenario/scenario-host.finance.spec.ts src/lib/sim/scenario/simulate.golden.test.ts src/lib/sim/scenario/simulate.finance.golden.test.ts src/lib/timelapse`
  Expected: PASS; the goldens unchanged (`git -C … status --porcelain` shows no fixture change), the shortcut on/off tests (`the per-input shortcuts`) pass.
- [ ] **Step 6: Time it** by the timing protocol (cases 2, 3, 4 and 5). Case 5's window starts after the warm, so time the warm separately. Use a one-off script in the session scratchpad, never committed, that builds the bench funding input as `scenario.bench.spec.ts` does and calls `financeWarm(input, HORIZON).step(WARM_CHUNK)` until it returns `true`. Report each step's ms and the total; before the change, the same input's `marketSkip` + `affordableSkip` took about 440 ms.
- [ ] **Step 7: Commit:** `perf(sim): warm the finance tables with the skip rates, in chunks`.

### Task 2: The line keeps its places on the application; serving probes without allocating

Measured by prototype: the location fields −9.5 ms on case 3 (84.0 → 74.6), the sort key by subtraction about −1 to −2 ms. The non-allocating probe is estimated at −2 to −3 ms: the bisection's `awardSet` allocates a `Map` per call, and `threshold` and `awardSet` together are 7 ms a run.

**Files:**
- Modify: `src/lib/sim/scenario/line.ts:7-24` (`App`), `:27-30` (`AwardTest`), `:46` (`serve`), `:185-387` (`groupedLine`: `loc` at `:190`, `threshold` at `:271`)
- Modify: `src/lib/sim/scenario/funding.ts:345-415` (add `awardPasses` beside `awardSet`)
- Modify: `src/lib/sim/scenario/funded.ts:921-945` (`sortByKey`), `:1120` (`test`), `:1382-1397` (the `App` literal), `:1411` (the `serve` call)
- Test: `src/lib/sim/scenario/line.spec.ts`, `src/lib/sim/scenario/funding.spec.ts`

**Interfaces:**
- Consumes: Task 1's tables (nothing new).
- Produces:
  - `App` gains three internal fields, initialised in every literal that builds an `App` (engine and specs): `lgr: unknown` (its group in the grouped line it belongs to, `null` when not live there), `lgi: number`, `lk: number`. An `App` belongs to at most one grouped line at a time; the doc comment says so.
  - `export type AwardProbe = (g: { kind: ProjectKind; bundle: readonly number[]; protoId: PrototypeId }, units: number) => boolean;`
  - `Line.serve(test: AwardTest, take: (app: App, a: Award) => void, keep?: boolean, passes?: AwardProbe): number`. `threshold` uses `passes` when given, else `test(...) !== null`.
  - `export function awardPasses(bundle: readonly number[], kind: ProjectKind, protoId: PrototypeId, units: number, avail: (pool: number) => number, f: FinanceIndex): boolean`. It returns exactly `awardSet(...) !== null`, summing each pool's ask in the same order as `asksOf`, into a scratch `Float64Array` indexed by pool (so the sums are bit-identical), and allocating nothing per call.

- [ ] **Step 1: Write the failing tests**
  - `funding.spec.ts`: `awardPasses agrees with awardSet on random bundles and money`. Run 2,000 random cases (bundle subsets of the bench baseline plus bench funding programmes, units 1 to 400, pool money from 0 to 2× the ask, both kinds, every prototype), each `expect(awardPasses(...)).toBe(awardSet(...) !== null)`.
  - `line.spec.ts`: in the existing "500 random lines" comparison, also run the grouped line with a `passes` built from the test (`(g, u) => test(g, u) !== null`); same awards, order and sets. Add `size counts live applications after remove and regroup`: add 5, remove 2, regroup 1 into another group, then `expect(line.size).toBe(3)`.
- [ ] **Step 2: Run and see them fail**
  Run: `npm --prefix … run test:unit -- src/lib/sim/scenario/funding.spec.ts src/lib/sim/scenario/line.spec.ts`
  Expected: FAIL, `awardPasses` is not exported.
- [ ] **Step 3: Implement.** `groupedLine` drops the `loc` map for the fields and a live counter, and `clean` tests `x.lgr === gr`. `scanLine` is unchanged. In `funded.ts`, pass `(g, u) => awardPasses(g.bundle, g.kind, g.protoId, u, avail, f)` as `passes`. `sortByKey` computes the slot as `key - Math.min(keyDay, NEVER_KEY_DAY) * KEY_DAY_SCALE` (exact: integers below 2^53), not `key % KEY_DAY_SCALE`, in both places. The prototype found that a counting sort by `keyDay` is slower, because affordable `keyDay`s span far past the horizon; keep `Float64Array.sort`.
- [ ] **Step 4: Run the tests and the exactness guards** (as Task 1 Step 5, plus `line.spec.ts`, `funding.spec.ts`, `engine-finance*.spec.ts`). Expected: PASS, goldens unchanged.
- [ ] **Step 5: Time it** (cases 2 and 3).
- [ ] **Step 6: Commit:** `perf(sim): keep line places on the application and probe awards without allocating`.

### Task 3: Structure-of-arrays records for the walk

After Tasks 1 and 2, about 56 ms a run remains (prototype profile): walk 16 ms (`quickLatents` 12.7, `kindLatent` 7.6, mostly building result objects), the inlined day loop about 12, GC 7. A run allocates about 530,000 objects: per walked lot a `Lot`, its `apps` array, `AttemptLatents`, a size array, up to two `KindLatent`s and up to three calendar entries. Expected gain: −8 to −15 ms on case 3 (estimated, not prototyped). Stop rule: if the interleaved ratio gains under 5%, or exactness fails and cannot be fixed, revert the task and report the numbers.

**Files:**
- Modify: `src/lib/sim/scenario/funded.ts:576-688` (`kindLatent`), `:745-789` (`quickLatents`), `:947-1034` (`Lot`, `Entry`, `Bucket`, `Calendar`), `:1068-1433` (`fundedPass`)
- Test: `src/lib/sim/scenario/funded.spec.ts`

**Interfaces:**
- Consumes: Task 1's `sizeAt`; Task 2's `App` fields.
- Produces (internal to `funded.ts`; the exported `latentsOf`, `latentsWith`, `attemptLatents`, `respell` keep their object-returning signatures):
  - `interface KindOut`: a reusable mutable record with exactly the fields of `KindLatent` (`funded.ts:336-348`), `bundle` holding the canonical array (never copied).
  - `kindLatentInto(out: KindOut, run: Run, fp: FinancePre, i: number, size: readonly (LatentSize | null)[], kind: ProjectKind, r: Day, u: number, v: number, TO: number, c: number, tab: KindTables | null): void`. This is the one kernel. `kindLatent` calls it and copies `out` into a `KindLatent`, so the object path (used by `noShortcuts` and the tests) and the fast path compute the same numbers.
  - A per-pass lot table indexed by candidate `c` (typed arrays for `k`, `r`, `d`, `gen`, `stream`, `e`, `O`, the draws, `TO`, `Oview`, per-kind `T`, `day`, `keyDay`, `view`, `f`, `units`, `stories`, `level`, plus `bundle` and `protoId` as small-integer ids into per-pass lookup arrays; `Uint8Array` flags for `fresh`, `demolished`, `parked`). Builder's call on layout. Calendar entries become `Int32Array`-backed lists of `c * 4 + tag` (tag 0 market app, 1 affordable app, 2 ordinary start, 3 reservation) with a parallel `gen`.
  - `App` objects stay (the line's interface). A lot's applications are found through its `App`s' `lot` row.

- [ ] **Step 1: Write the failing test** (`funded.spec.ts`): `kindLatentInto and kindLatent agree`. For the mini city with the bench baseline plus bench funding, every candidate, attempt 0, risk start `asOf` and seeds 1 to 3, both kinds: the object `kindLatent` result `toEqual` the record built from `kindLatentInto`'s `out`.
- [ ] **Step 2: Run it and see it fail** (`kindLatentInto` is not defined).
- [ ] **Step 3: Implement** the kernel, the lot table and the integer calendar. `fundedPass` uses them on the shortcut path only. The `noShortcuts` path keeps `latentsOf` objects, so the existing on/off tests compare the two data models.
- [ ] **Step 4: Run the tests and the exactness guards** (as Task 2 Step 4). Expected: PASS, goldens unchanged.
- [ ] **Step 5: Time it** (cases 2 and 3), and apply the stop rule.
- [ ] **Step 6: Commit:** `perf(sim): walk the funded pass on typed lot records`.

### Task 4: Resumable runs in the host (case 5) (CANCELLED)

**Cancelled by the conductor's ruling (case 5 route (b)).** Resumable runs change the host's job model, so they are out of this round: case 5 takes spec fallback 2 (its budget re-set from a measured median) instead. The task is kept below as the known route to case 5 at or under 50 ms, should the need appear. None of its steps were done.

Case 5's long tasks are single funded runs: 161 ms for the first, then about 118 ms each, against 50 ms. Even at Task 3's best estimate a funded band run stays above about 45 ms in the host, and the shown run's task also counts toward case 5. Expected gain: the longest band, twin or shown macrotask ≤ 50 ms whatever the per-run cost; case 4 within +5%.

**Files:**
- Modify: `src/lib/sim/scenario/funded.ts:1068` (`fundedPass` → `fundedSteps`), `:1036-1058` (`stats`)
- Modify: `src/lib/sim/scenario/engine.ts:1185-1208` (`runEngine`, `runEngineWith`)
- Modify: `src/lib/sim/scenario/simulate.ts:26-75`, `:79-…` (`simulateDetailed`, `simulateNet`)
- Modify: `src/lib/sim/scenario/scenario-host.ts:391` (`Job`), `:829-847` (`slice`), `:849-911` (`nextJob`), `:1153-1180`, `:1263` (`bandFzp`, `bandTwin`, `shownRun`, `shownTwin`), and every reset of `Work.run` and `Work.band` (reroll, lever `current`, `dispose`)
- Modify: `src/lib/sim/scenario/scenario.bench.spec.ts:58-82` (the `vi.mock('./simulate')` probe only)
- Test: `src/lib/sim/scenario/engine-finance.spec.ts`, `src/lib/sim/scenario/scenario-host.finance.spec.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3 unchanged.
- Produces:
  - `export function* fundedSteps(run: Run, holds: Holds, sink: Sink, opts: EngineOpts): Generator<void, void, void>`. It yields after every `STEP_CANDIDATES = 4_096` candidates of the eager phase and after each day of the day loop (builder's call: about 1 ms of eager work per step, quiet; day 1 is the largest single step, with about 61k adds and the first serve). `fundedPass` drains it. Stats accumulate in a per-pass object and are published to the module's `stats` when the pass ends, so `fundedRunStats()` stays "the last finished funded run".
  - `export function* engineSteps(input: SimInput, seed: number, horizon: Day, sink: Sink, opts?: EngineOpts): Generator<void, void, void>`. The pipeline and multi-phase passes are one step. `simulatedPass` (no finance) is one step. `runEngineWith` drains it.
  - `export function* simulateNetSteps(input: SimInput, seed: number, horizon: Day, months: Day[]): Generator<void, NetSeries, void>` and `export function* simulateDetailedSteps(input: SimInput, seed: number, horizon: Day): Generator<void, { schedules: Schedule[]; masters: Master[]; ledger: LedgerEvent[] }, void>`. `simulateNet` and `simulateDetailed` drain them.
  - Host: `type Job = { kind: JobKind; run(): void } | { kind: JobKind; steps: Generator<void, void, void> }`; `Work.inflight: { kind: JobKind; steps: Generator<void, void, void> } | null`. `nextJob` returns `inflight` first. `slice` advances a resumable job step by step while `deps.now() - start < SLICE_PLAN_MS` (at least one step a slice) and keeps it in `inflight` until done. A resumable job is not cost-measured. The shown run still starts a fresh slice. Every reset of `Work.run` or `Work.band`, and `dispose`, calls `inflight?.steps.return()` and clears it.

- [ ] **Step 1: Write the failing tests**
  - `engine-finance.spec.ts`: `draining engineSteps equals runEngineWith`. Mini city with the bench funding, seeds 1 to 5: collect through a sink both ways, then `toEqual`.
  - `engine-finance.spec.ts`: `interleaved engineSteps give each run its solo output`. Two generators (funded input seed 1, and the bench-baseline input seed 2) advanced alternately one `next()` at a time; each collected output `toEqual` its solo `runCollect`, and `fundedRunStats()` after both equals the solo stats of the one that finished last.
  - `scenario-host.finance.spec.ts`: `a funded band run spans several macrotasks and gives the same band`. Use a `deps.now` that advances 10 ms per call (builder's call: the harness's clock seam), so that a run needs several slices. The final timeline's `score` and `render` `toEqual` an unsliced session's, and more `net` macrotasks than band runs are observed.
  - `scenario-host.finance.spec.ts`: `drops an in-flight run on reroll`. Reroll while a band run is part-way through; no timeline with the old `rev` is posted after the reroll, and the new revision's final timeline equals a fresh session's for the same seed.
- [ ] **Step 2: Run them and see them fail** (`engineSteps` is not exported).
- [ ] **Step 3: Implement** the generators (`fundedPass` and `runEngineWith` become drains; no logic moves) and the host's resumable jobs. In `scenario.bench.spec.ts`, extend the `./simulate` mock so that `simulateNetSteps` and `simulateDetailedSteps` also bump `probe.net` / `probe.detailed` and set `probe.pools`, counted once when a run starts. This keeps `t.net`, `t.detailed` and the case-4 pool check meaning what they mean today. The bench's budgets are not touched.
- [ ] **Step 4: Run the tests and the exactness guards** (Task 2 Step 4's list plus every `scenario-host*.spec.ts`). Expected: PASS, goldens unchanged.
- [ ] **Step 5: Time it** (cases 2, 3, 4 and 5, plus the whole perf file once, so the unfunded host budgets show no regression).
- [ ] **Step 6: Commit:** `perf(sim): resume funded runs across host slices`.

### Task R0: Time to revision 0 (added during the round)

The first visible result on `/sim` (revision 0 after `initScenario` with levers and a null seed) waits on all 101 FZP band runs, so the round measures it. In `src/lib/sim/scenario/scenario.bench.spec.ts`, add three reported cases with a host each: `rev0: unfunded` (the bench city as is, default levers), `rev0: funded baseline` (the bench calibration: market, `baselineFunding`, `affordableRoutes`; default levers) and `rev0: bench funding` (the same with the bench funding on the plan, case 4's lever rig). Each logs the time to revision 0 and its split (load, warm, FZP band, shown run, geometry). No budget at first; the logged numbers are the evidence a budget is set from (fallback 2). The order (bands first, then the representative seed) is fixed by `timelapse-sim-design.md:585` and is not changed.

- [x] **Commit:** `test(sim): time the host to revision 0 unfunded, funded and with the bench funding`.

### Task 5: Full suites, docs and the dataset note

**Files:**
- Modify: `docs/dev/finance-engine.md` (sections "Fallback 1", "The warm task", "Measured medians", "Builder's calls"), `docs/dev/finance-levers.md` ("The finance warm task")

- [ ] **Step 1: Run every suite, foreground, from the worktree** (`npm --prefix /Users/mindlace/Projects/sfhousing/.claude/worktrees/finance-engine-perf run <script>`): `check`, `lint`, `test:unit`, `test:e2e`, `test:pipeline`, `test:perf`. Expected: all pass, except any F18 case still over budget, which is reported, not fixed by a budget edit. Confirm `git -C … status --porcelain` lists no golden or fixture file.
- [ ] **Step 2: Update the docs.**
  - `finance-engine.md`: the warm is chunked (`financeWarm`, `WARM_CHUNK`) and fills the tables eagerly; `at` is `Uint8Array` (promoted to `Uint16Array` past 254 values); memory 15.9 MB on the bench. Runs are resumable in the host (`engineSteps`, `STEP_CANDIDATES`). Replace the measured-medians table with Task 5's numbers, labelled quiet or ballpark with the load. Add each builder's call of Tasks 1 to 4 to "Builder's calls and rulings".
  - `finance-levers.md`: replace "roughly 85 to 140 ms … still built in the first funded run's task" with the chunked warm. The measured cold cost was about 440 ms before Task 1 (`skipRatesOf` defeated the price memo).
- [ ] **Step 3: Dataset-version note.** `src/lib/sim/scenario` is a hashed path (`pipeline/lib/version.ts:42-53`), so this branch moves the dataset version even though no output changes. Record in the final report that the conductor runs `npm run pipeline -- build`, `upload`, `verify` and `npm run signoff`; this plan runs none of them.
- [ ] **Step 4: Remove the baseline tree** (`git -C /Users/mindlace/Projects/sfhousing/.claude/worktrees/finance-engine-perf worktree remove --force /Users/mindlace/Projects/sfhousing/.claude/worktrees/finance-engine-perf-base`).
- [ ] **Step 5: Commit:** `docs(sim): finance engine performance after the perf round`.

## Open questions (partner or conductor)

1. **Task 4's scope.** Resumable runs change the host's job model, beyond "split `financePreOf` and `tablesOf`". **Recommendation: yes.** It is the only change that makes case 5 independent of the per-run cost. Without it, case 5 needs a funded run under about 45 ms in the host, which Tasks 1 to 3 are not projected to reach.
2. **If case 3 is still over 45 ms after Tasks 1 to 3 on a quiet machine** (projection: about 64 ms in vitest after Tasks 1 and 2, perhaps 50 to 55 after Task 3), the spec's fallback 2 applies: the conductor re-sets the F18 budget from the measured median + 20%. **Recommendation:** decide after Task 5's quiet run.
3. **Float32 tables (the spec's 4 MB).** These change outputs (the existing ruling), so they are out of scope. Memory would fall from about 15.9 to about 8 MB. Speed was not measured, and there is no reason to expect a gain. **Recommendation:** keep Float64.
4. **Precomputing tables in the pipeline.** **Recommendation: no.** The tables depend on the plan's `finance`, which levers change at every revision, so only the baseline-only twin could use them. That would add a per-dataset file of about 16 MB (a new `scenarios/fzp/` output; the touched paths would be `pipeline/` and the hashed `src/lib/sim/scenario`), and downloading it costs more than the about 170 ms warm.
5. **The funded host's `initScenario(null)` → revision 0 takes 11.4 s** (101 funded FZP band runs before the representative seed). No F18 case covers it; the unfunded host's budget for the same step is 3 s. **Recommendation:** the conductor decides whether F18 should name it; Tasks 1 to 3 cut it in proportion to the per-run cost.
