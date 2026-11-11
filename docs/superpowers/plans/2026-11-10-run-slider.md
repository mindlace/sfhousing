# Run Slider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A vertical slider on /sim's map, in run mode, that walks all 101 band runs ranked best to worst, switching the map, headline, chart, Results face and cards with roughly constant latency and no blank map.

**Architecture:** The scenario worker posts the band's rank order once its 101 FZP runs are set. The page keeps a latest-wins switcher that sends one `reroll` at a time (marked `swap`). The worker answers a swap with a revision 0 after one packing slice, viewport cells first, and streams the rest. The map's `TimelineController` installs a swap over the old cells (no clear, a larger per-frame budget), removes leftovers once the run is complete, and diffs the demolish feature-state. "Another future" goes.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Tailwind 4, deck.gl `SolidPolygonLayer` under MapLibre, a Web Worker scenario host, Vitest (server, client, perf, client-perf projects), Playwright (e2e and the headed `bench:map`).

**Spec:** `docs/superpowers/specs/2026-11-10-run-slider-design.md`

## Global Constraints

- `BAND_RUNS` = 101, seeds `bandSeed(i) = i + 1` (`src/lib/sim/scenario/band.ts:6-12`). Ranking is by the final-month `completedNet` (`finals()`, band.ts:149-153; the horizon is `HORIZON` = 2066-12-31, `src/lib/fzp/time.ts:21`).
- The rank order is the exact reverse of `representativeIndex`'s ascending sort (`finals[a] - finals[b] || a - b`, band.ts:52-58), ties included, so the middle position (`n - ceil(n/2)`, 50 for 101) is always `representativeSeed()`.
- Top of the slider = most homes, label "Best"; bottom = fewest, label "Worst". The handle shows the run number: the seed, as `#37`. `aria-valuetext` reads like "Run 37, rank 12 of 101". Nothing else on the slider.
- Keyboard: Up/Right = better, Down/Left = worse, Page Up/Down = ±10, Home = Best, End = Worst. Clicking a point on the track selects it. WCAG 2.2 AA (`docs/dev/accessibility.md`), handle at least 24×24 CSS px (44 on coarse pointers).
- Shown only when `runPhase === 'run'`. Disabled, handle on the middle tick, until the current band's order arrives. After a lever change it goes back to the median.
- Requests are latest-wins. Lever sends never wait on a slider request.
- URL: `?seed=N` via `replaceState` only, never push, written once a switch settles. The median run keeps a clean URL (no `seed`).
- Kept across a switch: the scrubber day, the high-water mark, play state, the band.
- The map never blanks between runs. Old buildings stay until replaced. A mixed map mid-switch is acceptable; the headline and chart may lead the map.
- Signoff tests (chreode, `chreode.config.ts`: `test:unit` = vitest `server` + `client`, `test:e2e` = every Playwright project, burn-in, the `timing` step) must pass on a heavily loaded machine. Assert behaviour and order, never wall-clock. Wait on conditions, never sleeps.
- chreode's `timing` step fails a branch that adds a fixed wait, a new or raised `timeout`, or retries above 1 to a test file (perf and bench files exempt). A wait that needs longer than the default reuses an existing waiter that already carries a timeout (for example `waitReady` in `e2e/fzp.spec.ts:114-119`, 20 s), or gets a `timing.allow` entry with a reason in `chreode.config.ts`.
- All latency and baseline measurement goes in non-signoff suites only: `*.bench.spec.ts` (vitest `perf`), `*.perf.svelte.spec.ts` (vitest `client-perf`), both run by `npm run test:perf`, or `e2e/bench/**` (`npm run bench:map`). Not `e2e/perf/**`: `test:e2e` runs those projects in signoff.
- Vitest runs with `expect.requireAssertions`: every test calls `expect`.
- Any change under `src/lib/sim/scenario/**` changes the dataset version `<v>` (`pipeline/lib/version.ts:47`). Signoff's `dataset` step then fails until the dataset is built and uploaded (`docs/dev/pipeline.md`, "Finishing a branch that changes the dataset"). Task 7 does it.
- No new runtime dependencies. If one becomes unavoidable, credit it in `SOFTWARE` in `src/lib/attribution.ts`.
- The agent runs the headed GPU bench (`npm run bench:map`) itself and records results in `docs/dev/map-perf.md`.
- Code style: Svelte 5 runes, 2-space indent, single quotes, no trailing commas, 100 columns. Conventional Commits, no Claude attribution or Co-Authored-By trailers. Never `cd x && cmd`.
- Docs updated in the task that changes the behaviour: `docs/dev/fzp-mode.md`, `docs/dev/sim-page.md`, `docs/dev/map-interfaces.md`, `docs/dev/map-perf.md`.

## Review Focus

1. **Release while a switch is in flight.** The view must land on the run under the handle: the waiting request is sent when the in-flight one answers, and nothing older plays after it. Pinned in Task 5 (RunSwitcher) and Task 6 (FzpMode).
2. **A lever change mid-drag or mid-switch.** `setLevers` goes out at once. The slider resets to the median and disables. Ranks from the older band are ignored. Pinned in Task 6.
3. **A worker crash or Retry during a switch.** No stuck in-flight request, no busy state. The slider disables until the new session's ranks arrive. Pinned in Task 6.
4. **`setTimelineLookups` or a theme change during a swap.** Re-encode work for cells still on the map survives the swap. Leftover cells still go at `complete`. Pinned in Task 4.
5. **Old and odd links.** `?seed=4242` (outside 1..101) loads that run with no selected tick. An in-band `?seed=` equal to the median seed shows that tick. Pinned in Task 6.

---

## File Structure

| File | Responsibility | Tasks |
| --- | --- | --- |
| `src/lib/sim/scenario/band.ts` | `rankOrder`, `medianRank`, `BandState.rankSeeds()` | 1 |
| `src/lib/sim/scenario/types.ts` | `RanksResponse`; `reroll.swap` | 1, 3 |
| `src/lib/sim/scenario/scenario-host.ts` | post ranks; swap runs; view-first packing; `render.swap` / `render.complete` | 1, 3 |
| `src/lib/sim/scenario/geometry.ts` | `packable(first?)` view-first order | 3 |
| `src/lib/sim/scenario-client.ts` | `onRanks`; `reroll(seed, { swap })` | 1, 3 |
| `src/lib/map/types.ts` | `TimelineUpdate.swap`, `.complete` | 3 |
| `src/lib/map/timeline-controller.ts` | `installs` counter; swap install mode | 2, 4 |
| `src/lib/map/timelapse/demolish.ts` | `DemolishPump.swap` diff | 4 |
| `src/lib/map/hide.ts` | `SWAP_CELLS_PER_SLICE` | 4 |
| `src/lib/fzp/run-slider.ts` | pure position, key, text helpers | 5 |
| `src/lib/fzp/run-switch.ts` | `RunSwitcher`, latest-wins requests | 5 |
| `src/lib/fzp/RunSlider.svelte` | the slider control | 5 |
| `src/lib/fzp/FzpMode.svelte` | ranks state, debug hook, switcher wiring, slider placement, removal of "Another future" | 2, 6 |
| `src/lib/fzp/debug.ts` | `ranks`, `selectRank`, `switchTrace` | 2 |
| `src/lib/fzp/SimResults.svelte` | `canSwitch`; back-to-median | 6 |
| `src/lib/fzp/card-place.ts` | `controls.right` inset | 6 |
| `e2e/bench/run-slider.bench.ts`, `playwright.bench.config.ts` | live switch-latency harness | 2 |

---

### Task 1: Rank order from the band

**Files:**
- Modify: `src/lib/sim/scenario/band.ts` (after `representativeIndex`, :52-58; `BandState` :60-89; `createBandState` :92-157)
- Modify: `src/lib/sim/scenario/types.ts:187-205` (`ScenarioResponse`)
- Modify: `src/lib/sim/scenario/scenario-host.ts` (`Work` :303-329, `loadedHook` :638-682, lever `current` :907-935, `bandFzp` :1082-1086)
- Modify: `src/lib/sim/scenario-client.ts` (`ScenarioClientEvents` :41-56, `#receive` :382-482)
- Test: `src/lib/sim/scenario/band.spec.ts`, `src/lib/sim/scenario/scenario-host.spec.ts`, `src/lib/sim/scenario/scenario-host.levers.spec.ts`, the client spec beside `scenario-client.ts`

**Interfaces:**
- Produces:
  - `rankOrder(finals: readonly number[]): number[]`: band-run indices best to worst, the exact reverse of the ascending `(a, b) => finals[a] - finals[b] || a - b` order. Throws `RangeError('no runs')` on `[]`, as `representativeIndex` does.
  - `medianRank(n: number): number` = `n - Math.ceil(0.5 * n)` (50 for 101). Invariant: `rankOrder(f)[medianRank(f.length)] === representativeIndex(f)`.
  - `BandState.rankSeeds(): number[]` = `rankOrder(this.finals()).map(bandSeed)`. Throws like `finals()` until all FZP runs are set.
  - `type RanksResponse = { type: 'ranks'; rev: Rev; seeds: number[] }`, added to `ScenarioResponse`. `rev` is the `initScenario` (no levers, /fzp-style session) or the lever revision (`setLevers`/levered `initScenario`) whose band it ranks.
  - `ScenarioClientEvents.onRanks?(r: RanksResponse): void`, forwarded unfiltered (the page decides staleness).
  - Host: posts `ranks` exactly once per band, in the job that sets its last FZP run (`fzpCount` reaching `total`), before any later post. A lever `current` creates a fresh band (:923), so each lever revision gets its own post.

- [ ] **Step 1: Write the failing band tests** in `band.spec.ts`

```ts
it('rankOrder is the exact reverse of the ascending order, ties by index', () => {
  expect(rankOrder([5, 9, 5, 1, 9])).toEqual([4, 1, 2, 0, 3]);
});
it('the median rank is the representative run, ties included', () => {
  for (const f of [[7], [3, 3, 3], [2, 9, 2, 9, 5, 5, 1], seededFinals(101), seededFinals(17)])
    expect(rankOrder(f)[medianRank(f.length)]).toBe(representativeIndex(f));
});
it('medianRank(101) is 50', () => expect(medianRank(BAND_RUNS)).toBe(50));
it('rankSeeds throws until every FZP run is set, then is rankOrder through bandSeed', () => {
  const b = createBandState(3);
  b.setFzp(0, Int32Array.of(1, 4));
  b.setFzp(1, Int32Array.of(1, 9));
  expect(() => b.rankSeeds()).toThrow(RangeError);
  b.setFzp(2, Int32Array.of(1, 4));
  expect(b.rankSeeds()).toEqual([2, 3, 1]);
});
```

`seededFinals(n)` is a local helper: `n` integers from a small LCG in `[0, 20)`, so ties occur.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project server src/lib/sim/scenario/band.spec.ts`
Expected: FAIL, `rankOrder` / `medianRank` / `rankSeeds` not defined.

- [ ] **Step 3: Implement `rankOrder`, `medianRank`, `BandState.rankSeeds` in `band.ts`**

- [ ] **Step 4: Run the band tests to verify they pass**

Run: `npx vitest --run --project server src/lib/sim/scenario/band.spec.ts`
Expected: PASS

- [ ] **Step 5: Write the failing host and client tests**

In `scenario-host.spec.ts` (N = 17 band, `SEED` = 1000, helpers at :117-260):
- `'posts ranks once, after the last FZP band run, at the init rev'`: init with seed null, `stepUntil` idle. `ranks = h.posts.filter((m) => m.type === 'ranks')`. Expect `ranks.length === 1`, `ranks[0].rev === initRev`, `ranks[0].seeds` equal to `rankOrder(finals of bandOf(inputs(), N)).map(bandSeed)`, and `ranks[0].seeds[medianRank(N)]` equal to the representative timeline's `seed`. Expect the ranks post's index in `h.posts` to come after the last FZP band computation and before the first timeline (a null seed needs every FZP run first, :816).
- `'with a requested seed, ranks come once every FZP run is set'`: init with `SEED`. Exactly one `ranks`, and it comes after revision 0.
- `'a reroll does not repost ranks'`: after idle, reroll and step to idle. Still one `ranks`.

In `scenario-host.levers.spec.ts`: `'each lever revision posts its own ranks at its rev'`: init with levers, idle, `setLevers`, idle. Two `ranks` posts, with revs equal to the init rev and the `setLevers` rev.

In the client spec: `'forwards ranks to onRanks, stale or not'`: emit `{ type: 'ranks', rev: 1, seeds: [2, 1, 3] }` after a later barrier. `onRanks` is called with it.

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest --run --project server src/lib/sim/scenario/scenario-host.spec.ts src/lib/sim/scenario/scenario-host.levers.spec.ts src/lib/sim/scenario-client.spec.ts`
Expected: FAIL, no `ranks` posts and no `onRanks`.

- [ ] **Step 7: Implement**

Add `bandRev: Rev` to `Work`: `st.rev` in `loadedHook`, `p.rev` at lever `current`. Post `{ type: 'ranks', rev: w.bandRev, seeds: w.band.rankSeeds() }` in `bandFzp` when `w.band.fzpCount === w.band.total`. Add the `'ranks'` case to the client's `#receive` switch (its `never` default forces it).

- [ ] **Step 8: Run the tests, `npm run check` and `npm run lint`**

Run: `npx vitest --run --project server src/lib/sim/scenario src/lib/sim/scenario-client.spec.ts`, then `npm run check`, then `npm run lint`
Expected: all PASS, 0 errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/sim/scenario/band.ts src/lib/sim/scenario/band.spec.ts src/lib/sim/scenario/types.ts src/lib/sim/scenario/scenario-host.ts src/lib/sim/scenario/scenario-host.spec.ts src/lib/sim/scenario/scenario-host.levers.spec.ts src/lib/sim/scenario-client.ts src/lib/sim/scenario-client.spec.ts
git commit -m "feat: post the band's rank order from the scenario worker"
```

---

### Task 2: Switch-latency harness and the live baseline

Measure early, on today's switch path: `selectRank` goes through the existing `requestReroll` (`src/lib/fzp/FzpMode.svelte:481-487`). Tasks 3, 4 and 7 re-run the same bench.

**Files:**
- Modify: `src/lib/fzp/FzpMode.svelte` (state :264-300, `startScenario` :431-450, `syncLevers` :456-465, `events` :758-855, `installFzpDebug` call :925-943)
- Modify: `src/lib/fzp/debug.ts`
- Modify: `src/lib/map/timeline-controller.ts` (`install` :335-353, `debugSnapshot` :246-259), `src/lib/map/timelapse/types.ts:74-83`
- Modify: `playwright.bench.config.ts`
- Create: `e2e/bench/run-slider.bench.ts`
- Modify: `docs/dev/map-perf.md` (new section "Run slider switch")
- Test: `src/lib/fzp/FzpMode.svelte.spec.ts`, `src/lib/map/timeline-controller.spec.ts`, `src/lib/fzp/test/fake-worker.ts` (a `ranksMsg(rev, seeds)` helper)

**Interfaces:**
- Consumes: `RanksResponse`, `onRanks`, `medianRank` (Task 1).
- Produces:
  - FzpMode state `ranks: number[] | null` (`$state.raw`) and `ranksFloor: number`, the rev of the latest `initScenario` or `setLevers` sent. `onRanks(m)` keeps `m.seeds` iff `m.rev >= ranksFloor`. `startScenario` and every `setLevers` send set `ranksFloor` to the new rev and `ranks = null`.
  - `SfhFzpDebug` gains:
    - `readonly ranks: readonly number[] | null`
    - `selectRank(position: number): void`: position 0 = Best. Requests `null` at `medianRank(ranks.length)`, else `ranks[position]`. A no-op while `ranks` is null.
    - `readonly switchTrace: { seed: number | null; rev: number; requestedAt: number; answeredAt: number | null; completeAt: number | null } | null`: `performance.now()` stamps. `answeredAt` is the first non-stale timeline at `rev`. `completeAt` is the first at `rev` with `complete: true`.
    The hook is no longer read-only: update `debug.ts`'s header comment. Still compiled only when `VITE_E2E === '1'`.
  - `TimelineSnapshot.installs: number`: cells installed since construction, cumulative, never reset.
  - `playwright.bench.config.ts`: with `SFH_BENCH_DATASET=<v>`, the webServer command is the base one (`playwright.config.ts:43-49`) without `npm run data:fixture` and with `PUBLIC_DATASET_VERSION:<v>`. Without it, unchanged (fixture-0).
  - `e2e/bench/run-slider.bench.ts`: four cases, camera `default` (the page's opening camera) and `zoomed` (`[-122.401, 37.789]`, zoom 15.5, pitch 55, as `map-timeline.bench.ts`) × move `one tick` (alternate `medianRank` and `medianRank + 1`) and `Best↔Worst` (alternate 0 and `n - 1`). 10 switches per case, after `startRun` (`e2e/helpers/run.ts:16`) and a wait for `ranks`, the first run's `complete` and `timelineSnapshot().pending === 0`. Each switch is one in-page `page.evaluate`: stamp `t0`, read `installs0`, call `selectRank`, then poll each `requestAnimationFrame`. `first` is the first frame where `installs > installs0` and `switchTrace.answeredAt !== null`. `full` is the first frame where `switchTrace.completeAt !== null` and `pending === 0`. Return `{ first: first - t0, full: full - t0 }`. Print p50/p95 of each per case, the dataset, renderer and DPR. Assert `default` camera `full` p95 ≤ 3000 ms (the spec's ceiling).

- [ ] **Step 1: Write the failing unit tests**

`timeline-controller.spec.ts`: `'debugSnapshot().installs counts every installed cell across revisions'`. Apply `timelineSmall` (revision 0), drain frames, expect `installs === timelineSmall.cells.length`. Apply `timelineSmallRev1`, drain, expect it to grow by that update's `cells.length`. A `setLookups` re-encode leaves it unchanged.

`FzpMode.svelte.spec.ts`:
- `'keeps the latest band's ranks and drops an older revision's'`: `toReady(s, 7)`. Emit `ranksMsg(initRev, [3, 1, 2])`, then expect `__sfhFzp.ranks` to equal `[3, 1, 2]`. Change `levers` (`setLevers` posts rev R), emit `ranksMsg(initRev, [9, 9, 9])`, expect `ranks` null. Emit `ranksMsg(R, [2, 3, 1])`, expect `[2, 3, 1]`.
- `'selectRank requests the run at that position, null at the median'`: with ranks `[3, 1, 2]`, `selectRank(0)` posts `reroll` seed 3. After its answer, `selectRank(1)` posts seed `null`. `switchTrace.seed` follows.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project client src/lib/fzp/FzpMode.svelte.spec.ts -t "ranks|selectRank"`, then `npx vitest --run --project server src/lib/map/timeline-controller.spec.ts -t installs`
Expected: FAIL

- [ ] **Step 3: Implement the FzpMode ranks state, the debug fields and `installs`**

- [ ] **Step 4: Run the unit tests to verify they pass**

Same commands as Step 2. Expected: PASS.

- [ ] **Step 5: Write the bench and the config switch; smoke it on fixture-0**

Run: `lsof -ti :4173 | xargs kill` (only if a non-VITE_E2E preview holds the port), then `npm run bench:map -- run-slider`
Expected: four case lines printed, the test passing (fixture-0 numbers are only a smoke check).

- [ ] **Step 6: Take the live-SF baseline**

Find the production dataset version: in the main checkout (`/Users/mindlace/Projects/sfhousing`, branch `main`), `npx tsx scripts/dataset-version.ts` prints it. Or read `datasetVersion` from the manifest URL the production `/sim` page loads.

Run: `npm run data:local -- <v>`, then `SFH_BENCH_DATASET=<v> npm run bench:map -- run-slider`
Expected: four case lines. Record them in `docs/dev/map-perf.md` under a new "Run slider switch" section: what the bench does, how to run it live, and a results table (machine, date, dataset, case, first p50/p95, full p50/p95, label "baseline: reroll path"). If the default camera's full p95 already fails the 3 s assert, record it and continue: the bench exists to measure.

- [ ] **Step 7: `npm run check`, `npm run lint`, commit**

```bash
git add src/lib/fzp/FzpMode.svelte src/lib/fzp/FzpMode.svelte.spec.ts src/lib/fzp/debug.ts src/lib/fzp/test/fake-worker.ts src/lib/map/timeline-controller.ts src/lib/map/timeline-controller.spec.ts src/lib/map/timelapse/types.ts playwright.bench.config.ts e2e/bench/run-slider.bench.ts docs/dev/map-perf.md
git commit -m "test: add the run switch latency bench and its live baseline"
```

---

### Task 3: Worker fast switch

**Files:**
- Modify: `src/lib/sim/scenario/types.ts:86` (`reroll` request)
- Modify: `src/lib/map/types.ts:60-65` (`TimelineUpdate`)
- Modify: `src/lib/sim/scenario/scenario-host.ts` (`Run` :250-266, `Chunks` :269-278, `prefetch` :587-598, `newRun` :688-703, `reroll` :705-721, `nextJob` :797-855, `revision0Pending` :1132-1135, `packCells` :1142-1155, `postTimeline` :1183-1215)
- Modify: `src/lib/sim/scenario/geometry.ts:36, 195` (`packable`)
- Modify: `src/lib/sim/scenario-client.ts:195-197` (`reroll`)
- Modify: `src/lib/sim/scenario/scenario.bench.spec.ts` (after :461-471)
- Modify: `docs/dev/fzp-mode.md` (the worker and "Scenario" notes: swap reroll, view-first packing, `complete`)
- Test: `src/lib/sim/scenario/scenario-host.spec.ts`, the client spec

**Interfaces:**
- Consumes: Task 1's host state.
- Produces:
  - Request: `{ type: 'reroll'; rev: Rev; seed: number | null; swap?: true }`.
  - `ScenarioClient.reroll(seed: number | null, opts?: { swap?: boolean }): Rev`. It sends `swap: true` only when `opts.swap` is set. `resync()` (:290-294) stays a plain reroll.
  - `TimelineUpdate` gains `swap?: true` (revision 0 only: install over the cells on the map instead of clearing them) and `complete?: boolean` (equal to `TimelineResponse.complete`: the run has packed every loaded cell). The host sets `render.complete` on every timeline and `render.swap` on a swap run's revision 0.
  - `Geometry.packable(first?: ReadonlySet<string>): string[]`: the cells in `first` come first, then the rest, each group in today's id order.
  - Host `Chunks.view: Set<string>`: the cells of the latest `prefetch` bbox, replaced on each call (`wanted` keeps accumulating). Packing passes it as `first` on every run.
  - Swap run (`Run.swap`, from `req.swap === true`): revision 0 posts after the shown run, its geometry and **at most one packing slice**, with no `REVISION0_CAP_MS` wait. Then the twin (unchanged order), then the rest of the cells in later revisions, one slice each. A non-swap run's revision 0 rule is unchanged. A swap reroll while levers are pending only sets `p.runRev`/`p.seed` (:710-715), so that run is a plain snapshot.
  - Builder's call: one packing slice, not "all viewport cells". At the default camera the viewport is the whole city, so waiting for it would make the first buildings wait for the full switch. Constant time needs a fixed first slice.

- [ ] **Step 1: Write the failing host and client tests**

`scenario-host.spec.ts`, with the mini city: load all cells (`prefetch` with each cell's `bboxOf`), then a final `prefetch(bboxOf(B))` so `view` is B's cells:
- `'a swap reroll posts revision 0 with swap set and view cells first'`: idle, then `reroll { swap: true }` and step to idle. Over this rev's timelines: revision 0 has `render.swap === true` and later revisions none. The first packed cell in revision 0 is in B's set. No cell outside the view comes before every packable view cell is posted (order over the concatenated revisions). The union of cells equals `expectedCells(...)` for the seed (:760).
- `'every timeline's render.complete equals its complete'`, over all posts of a session with a reroll.
- `'a plain reroll posts revision 0 without swap'`.
- `'a swap reroll superseded mid-run posts nothing more at the old rev'`: reroll swap A, step one slice, reroll swap B, step to idle. No timeline at A's rev after B's reroll was handled. B's revision 0 has `swap`.
- `'a cell that becomes ready mid-swap still packs, and the last revision is complete'`: deliver a chunk between slices of a swap run. Its anchored cell appears in a later revision, and the last timeline has `complete: true`.

Client spec: `'reroll with swap posts swap: true; resync does not'`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project server src/lib/sim/scenario/scenario-host.spec.ts src/lib/sim/scenario-client.spec.ts -t "swap|complete|plain reroll"`
Expected: FAIL

- [ ] **Step 3: Implement the request field, the client option, `TimelineUpdate` fields, `Chunks.view`, `packable(first)` and the swap run's revision 0 rule**

`TimelineController` ignores `swap` until Task 4, so a swap still renders as a snapshot: correct, only slower.

- [ ] **Step 4: Run the tests to verify they pass, then the whole scenario directory**

Run: `npx vitest --run --project server src/lib/sim/scenario src/lib/sim/scenario-client.spec.ts`
Expected: PASS (the existing revision-0 tests are unchanged for non-swap runs).

- [ ] **Step 5: Add the perf baseline** in `scenario.bench.spec.ts`'s host describe

`'swap reroll → revision 0, Best ↔ Worst, cold (baseline)'`: after the band is in, read the posted `ranks`. Alternate 10 `reroll { swap: true }` between `seeds[0]` and `seeds.at(-1)` with new revs. Log revision-0 p50/max and time-to-complete p50/max with `[perf]`. Assert revision 0 ≤ 1000 ms and the longest macrotask ≤ 50 ms (builder's call: a loose ceiling; the printed numbers are the baseline).

Run: `npx vitest --run --project perf src/lib/sim/scenario/scenario.bench.spec.ts -t swap`
Expected: PASS, with `[perf]` lines.

- [ ] **Step 6: Update `docs/dev/fzp-mode.md`**, then `npm run check`, `npm run lint`

- [ ] **Step 7: Commit**

```bash
git add src/lib/sim/scenario src/lib/sim/scenario-client.ts src/lib/sim/scenario-client.spec.ts src/lib/map/types.ts docs/dev/fzp-mode.md
git commit -m "feat: swap reroll packs the viewport first and posts revision 0 after one slice"
```

---

### Task 4: Map swap mode and demolish diff

**Files:**
- Modify: `src/lib/map/timeline-controller.ts` (`apply` :171-187, `snapshot` :301-315, `runSlice` :317-333, `planTimelineSlices` :443-459)
- Modify: `src/lib/map/timelapse/demolish.ts` (new `swap` beside `replace` :60-79; `frame` :125-161)
- Modify: `src/lib/map/hide.ts` (beside `MAX_CELLS_PER_SLICE` :28)
- Modify: `src/lib/map/timeline.perf.svelte.spec.ts`
- Modify: `docs/dev/fzp-mode.md` (map side of a switch), `docs/dev/map-perf.md`
- Test: `src/lib/map/timeline-controller.spec.ts`, `src/lib/map/timelapse/demolish.spec.ts`

**Interfaces:**
- Consumes: `TimelineUpdate.swap`, `.complete` (Task 3).
- Produces:
  - `SWAP_CELLS_PER_SLICE = 16` in `hide.ts`. Builder's call: count-based like `MAX_CELLS_PER_SLICE`, because deck tessellates at the next render, not in `install`, so a JS time budget would miss the cost. Task 7 tunes it from the live bench.
  - `TimelineController.apply(u)` with `u.revision === 0 && u.swap`:
    - Cancels the frame and drops queued install slices. Keeps queued `reencode` ids for cells still installed.
    - Keeps every installed cell and the bars. Adds every installed cell id to a `leftover` set, which carries across consecutive swaps.
    - Calls `pump.swap(u.demolish)` and sets `lastRevision = 0`.
    - Queues the cells in update order, `SWAP_CELLS_PER_SLICE` per frame, while a swap is in progress (from the swap's revision 0 until its leftovers go). Later revisions of the same run use that budget too.
    - Installing a cell removes its id from `leftover`.
    - Once an update with `complete: true` has had all its slices run, every remaining `leftover` cell is removed in that frame and `leftover` cleared.
    - A non-swap revision 0 clears `leftover` along with everything else (today's `snapshot`).
    - No `setLayers` call during a swap emits fewer timeline cell layers than before it, until leftovers go.
  - `DemolishPump.swap(list: readonly { parcelId: ParcelId; day: Day }[]): void`:
    - Loads the sorted list as `replace` does. Its logical state (`has`, `appliedIds`, `applied`) is at once the new list's prefix at the current target.
    - It never calls `clearAllReplaced`. Feature-state converges by a diff: `setReplaced` for parcels newly hidden, `clearReplaced` for parcels no longer hidden, nothing for parcels in both.
    - At most `SLICE_IDS` feature-state calls per frame. Pending diff calls run before cursor moves in a frame.
    - A `swap` or `replace` mid-diff starts from the logical state, so it converges.

- [ ] **Step 1: Write the failing demolish tests** in `demolish.spec.ts`, with fake deps that keep a feature-state `Set` and count calls

- `'swap reaches the same feature-state as replace'`: list A, target t, drain. Then `swap(B)` and drain on one pump, `replace(B)` and drain on another. Both feature-state sets are equal, and `appliedIds` match.
- `'swap never clears all and touches only parcels whose state changes'`: `clearAllReplaced` calls 0. Calls equal |A∆B| at the target.
- `'swap issues at most SLICE_IDS feature-state calls per frame'`: lists of 5,000 parcels with no overlap. `lastFrameOps ≤ SLICE_IDS` every frame, and it converges.
- `'swap during a pending swap diff converges to the last list'`.
- `'setTarget during a swap diff converges to the new list at the new target'`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project server src/lib/map/timelapse/demolish.spec.ts`
Expected: FAIL, `swap` not a function.

- [ ] **Step 3: Implement `DemolishPump.swap`**

Algorithm: build the new `days`/`ids` and the new prefix counts at `target`. Diff the old `refs` keys against the new ones into a pending op list (`set` / `clear`). Set `refs` and `cursor` to the new state. `frame` drains pending ops first (sharing the `SLICE_IDS` budget), then moves the cursor as today. A new `swap`/`replace` first folds the pending ops into the logical state (the ops already describe the move from feature-state to `refs`, so the new diff is taken against "feature-state = old refs adjusted by applied ops").

- [ ] **Step 4: Run the demolish tests to verify they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Write the failing controller tests** in `timeline-controller.spec.ts` (`manyCells(n)`, `update(revision, partial)`, fake deps at :44-70)

- `'a swap revision 0 never empties the layers'`: install 8 cells (revision 0), drain. Apply `update(0, { cells: other8, swap: true })`, drain. Every `layerHistory` entry after the swap holds at least 8 `timeline-solid-` layers until leftovers go.
- `'a swap installs SWAP_CELLS_PER_SLICE cells per frame'`: 40 new cells. Per-frame install counts are `[16, 16, 8]` (from `installs` deltas).
- `'leftover cells go once a complete update has installed'`: old cells {a,b,c}, swap revision 0 {b,d} with `complete: false`. a and c still present. Revision 1 {e} `complete: true`, drain. Layers hold exactly b, d, e.
- `'a second swap before complete keeps both runs' leftovers until its own complete'`.
- `'a superseded swap's queued cells never install'`: swap with 40 cells, run one frame, swap again with 4 cells, drain. None of the first swap's uninstalled cells is present.
- `'setLookups during a swap re-encodes the cells still on the map, and leftovers still go at complete'` (Review Focus 4). Same with `setTheme`: every cell layer is rebuilt with the new theme.
- `'a plain revision 0 still clears (snapshot)'`.
- `'a swap revision 0 diffs the demolish list'`: fake deps record no `clearAllReplaced` on a swap.

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest --run --project server src/lib/map/timeline-controller.spec.ts`
Expected: FAIL

- [ ] **Step 7: Implement the swap mode in `TimelineController`**

- [ ] **Step 8: Run the controller and map tests to verify they pass**

Run: `npx vitest --run --project server src/lib/map`, then `npx vitest --run --project client src/lib/map/SimMap.timeline.svelte.spec.ts`
Expected: PASS

- [ ] **Step 9: Add the client-perf cadence baseline** in `timeline.perf.svelte.spec.ts`

`'swap install cadence at 30,000 projects (baseline)'`: real map. Apply `makeSyntheticTimeline(1, 30000)` as revision 0, wait for convergence. Apply `makeSyntheticTimeline(2, 30000)` as `{ revision: 0, swap: true, complete: true }`. Record each rAF delta and the frame count until `timelineSnapshot().pending === 0`. Log p50/p95/frames with `[perf]`. Assert p95 ≤ 50 ms (the §4.12 frame-gap bar `MAX_CELLS_PER_SLICE` was sized for, `hide.ts:24-27`) and `layerIds` non-empty on every frame.

Run: `npx vitest --run --project client-perf src/lib/map/timeline.perf.svelte.spec.ts -t swap`
Expected: PASS, with `[perf]` lines.

- [ ] **Step 10: Re-run the live bench** (Task 2 Step 6 command) and add rows labelled "after worker + map swap" to `docs/dev/map-perf.md`. Describe the swap in `docs/dev/fzp-mode.md`.

`selectRank` still uses the non-swap reroll until Task 6. For this measurement, change `selectRank` to pass `{ swap: true }`. Task 6 rewires it anyway.

- [ ] **Step 11: `npm run check`, `npm run lint`, commit**

```bash
git add src/lib/map src/lib/fzp/FzpMode.svelte docs/dev/fzp-mode.md docs/dev/map-perf.md
git commit -m "feat: timeline swap installs a new run over the old one and diffs demolitions"
```

---

### Task 5: Slider helpers, latest-wins switcher and the slider control

**Files:**
- Create: `src/lib/fzp/run-slider.ts`, `src/lib/fzp/run-slider.spec.ts`
- Create: `src/lib/fzp/run-switch.ts`, `src/lib/fzp/run-switch.spec.ts`
- Create: `src/lib/fzp/RunSlider.svelte`, `src/lib/fzp/RunSlider.svelte.spec.ts`

**Interfaces:**
- Consumes: `medianRank` (Task 1).
- Produces, `run-slider.ts` (position 0 = Best, `n - 1` = Worst, `n = ranks.length`):
  - `requestSeed(ranks: readonly number[], position: number): number | null`: `null` at `medianRank(n)` (the representative request, clean URL), else `ranks[position]`.
  - `positionOfShown(ranks: readonly number[], seed: number | null, representative: boolean): number | null`: `medianRank(n)` when `representative`, else `ranks.indexOf(seed)`, and `null` when absent (an off-band link: no selected tick).
  - `stepPosition(key: string, position: number | null, n: number): number | null`: ArrowUp/ArrowRight −1, ArrowDown/ArrowLeft +1, PageUp −10, PageDown +10, Home 0, End `n - 1`, clamped to `[0, n - 1]`. A `null` position steps from `medianRank(n)`. Other keys return `null`.
  - `positionAt(y: number, top: number, height: number, n: number): number`: `clamp(Math.round(((y - top) / height) * (n - 1)), 0, n - 1)`.
  - `runValueText(ranks: readonly number[], position: number | null, shownSeed: number | null): string`: `` `Run ${ranks[p]}, rank ${p + 1} of ${n}` ``. With no position: `` `Run ${shownSeed}, not one of the ${n} ranked runs` `` (builder's call copy).
- Produces, `run-switch.ts`:
  ```ts
  export class RunSwitcher {
    constructor(send: (seed: number | null) => number /* the request's rev */);
    /** Latest wins: sends at once when nothing is in flight, else replaces the waiting seed. */
    select(seed: number | null): void;
    /** A non-stale timeline at `rev`. Ends the in-flight request when rev >= its rev (a resync or
     *  setLevers barrier answers it too), then sends the waiting seed unless it equals the answered
     *  one. Returns the answered request's seed, or undefined when none was in flight. */
    answer(rev: number): { seed: number | null } | undefined;
    /** An error at `rev`: like `answer` for the in-flight request it names, but a failure. */
    fail(rev: number): { seed: number | null } | undefined;
    /** Drops the in-flight and waiting requests (a new session, a crash, a lever change). */
    reset(): void;
    /** Nothing in flight and nothing waiting. */
    get settled(): boolean;
  }
  ```
  Builder's call: at most one request in flight, with a latest-wins waiting slot. If every tick superseded the in-flight request outright, a fast drag would show nothing until it slowed, but the spec wants the page to "show the most recent run it can finish". The waiting slot gives that, and skipping comes from the real switch cost.
- Produces, `RunSlider.svelte`:
  ```ts
  interface Props {
    ranks: readonly number[] | null; // null: disabled, handle on the middle tick
    position: number | null;          // selected tick; null: none (off-band run), handle at the middle
    shownSeed: number | null;         // for the no-selection text
    disabled: boolean;                // also true while the worker is stopped
    onselect: (position: number) => void; // only on a change of position
  }
  ```
  - Vertical: "Best" label at the top, "Worst" at the bottom, a track with `n` ticks between them (one CSS repeating gradient), and a handle at `position ?? medianRank(n)` (n = 101 while `ranks` is null) showing `#seed` (nothing when `position` is null).
  - The focusable element has `role="slider"`, `aria-label="Simulated run"`, `aria-orientation="vertical"`, `aria-valuemin={1}`, `aria-valuemax={n}`, `aria-valuenow={n - position}` (top is the maximum, so Up increases it; builder's call), `aria-valuetext` from `runValueText`, and `aria-disabled="true"` when disabled. It carries `data-testid="run-slider"`.
  - Keys go through `stepPosition` with `preventDefault`. Pointer: `pointerdown` on the track or handle captures the pointer and selects `positionAt`; `pointermove` while captured selects on change; `pointerup` releases.
  - Theme tokens only (`text-ink`, `bg-surface`, `border-line` and their `dark:` variants, as `ProjectCardPanel.svelte:127`). Visible focus ring. Handle ≥ 24×24 px, `pointer-coarse:` 44×44.

- [ ] **Step 1: Write the failing pure tests**

`run-slider.spec.ts`, with `R = [4, 2, 5, 1, 3]` (n = 5, median position 2):

```ts
expect(requestSeed(R, 2)).toBeNull();
expect(requestSeed(R, 0)).toBe(4);
expect(positionOfShown(R, null, true)).toBe(2);
expect(positionOfShown(R, 1, false)).toBe(3);
expect(positionOfShown(R, 5, false)).toBe(2); // the median seed asked for by number
expect(positionOfShown(R, 4242, false)).toBeNull();
expect(stepPosition('ArrowUp', 2, 5)).toBe(1);
expect(stepPosition('ArrowRight', 0, 5)).toBe(0);
expect(stepPosition('ArrowDown', 4, 5)).toBe(4);
expect(stepPosition('PageDown', 0, 101)).toBe(10);
expect(stepPosition('PageUp', 5, 101)).toBe(0);
expect(stepPosition('Home', 3, 5)).toBe(0);
expect(stepPosition('End', null, 5)).toBe(4);
expect(stepPosition('ArrowUp', null, 101)).toBe(49);
expect(stepPosition('a', 2, 5)).toBeNull();
expect(positionAt(0, 0, 100, 101)).toBe(0);
expect(positionAt(100, 0, 100, 101)).toBe(100);
expect(positionAt(-20, 0, 100, 101)).toBe(0);
expect(runValueText(R, 0, 4)).toBe('Run 4, rank 1 of 5');
expect(runValueText(R, null, 4242)).toBe('Run 4242, not one of the 5 ranked runs');
```

`run-switch.spec.ts` (a recording `send` returning increasing revs):
- `'sends at once when idle'`.
- `'keeps only the latest waiting seed and sends it on the answer'`: select 3, 4, 5. Sends `[3]`. `answer(rev3)` returns `{ seed: 3 }`, and sends are `[3, 5]`.
- `'does not resend the seed just answered'`: select 3, select 3. `answer` sends nothing.
- `'an answer at a later rev ends the in-flight request'`: `answer(rev3 + 7)` returns `{ seed: 3 }`.
- `'an older rev answers nothing'`.
- `'fail ends the in-flight request and sends the waiting one'`.
- `'reset drops both; a late answer returns undefined and sends nothing'`.
- `'settled once the last answer is in'`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project server src/lib/fzp/run-slider.spec.ts src/lib/fzp/run-switch.spec.ts`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement `run-slider.ts` and `run-switch.ts`**

- [ ] **Step 4: Run them to verify they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Write the failing component tests** in `RunSlider.svelte.spec.ts` (vitest-browser-svelte)

- `'shows Best and Worst, the handle's seed and the value text'`: `ranks` 101 seeds, `position` 11. Text `Best`, `Worst`, `#<ranks[11]>`. `aria-valuetext` `Run <ranks[11]>, rank 12 of 101`. `aria-valuenow` 90.
- `'keys select positions'`: from position 11, focus, press ArrowUp, Home, PageDown, End. `onselect` calls are `[10]`, `[0]`, `[10]`, `[100]` (the props follow each call through a `$state` host).
- `'clicking the track's top and bottom selects Best and Worst'` (`click({ position })` on the track box).
- `'disabled: aria-disabled, no selection on keys or clicks, handle on the middle tick'` (ranks null).
- `'no selected tick: no number on the handle, the not-ranked text'`.
- `'the handle is at least 24×24 px'` (bounding box).

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest --run --project client src/lib/fzp/RunSlider.svelte.spec.ts`
Expected: FAIL

- [ ] **Step 7: Implement `RunSlider.svelte`**

- [ ] **Step 8: Run the component tests, `npm run check` and `npm run lint`**

Expected: PASS, 0 errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/fzp/run-slider.ts src/lib/fzp/run-slider.spec.ts src/lib/fzp/run-switch.ts src/lib/fzp/run-switch.spec.ts src/lib/fzp/RunSlider.svelte src/lib/fzp/RunSlider.svelte.spec.ts
git commit -m "feat: add the run slider control and its latest-wins switcher"
```

---

### Task 6: The slider on /sim replaces "Another future"

**Files:**
- Modify: `src/lib/fzp/FzpMode.svelte`
  - Remove `rerollBusy`, `rerollFailed`, `canReroll`, `requestReroll`, `anotherFuture` (:281-282, :371, :481-491).
  - Remove the header button (:990-1005), the "Making another future…" pill (:1092-1094) and the failed-reroll alert (:1126-1135).
  - Rework `syncLevers` (:456-465), `onTimeline`/`onError`/`onCrash` (:758-855) and `measureCardArea` (:584-610).
  - Place `RunSlider` in the map box (:1144-1205).
- Modify: `src/lib/fzp/SimResults.svelte:31-75, 242-256` (`canReroll` → `canSwitch`)
- Modify: `src/lib/fzp/card-place.ts:18-31`, `src/lib/fzp/card-area-watch.ts` (watch the slider's box)
- Modify: `src/lib/fzp/debug.ts` (`selectRank` now goes through the slider path)
- Modify tests:
  - `src/lib/fzp/FzpMode.svelte.spec.ts` (every "Another future" / "Making another future…" / failed-reroll test: :108-112, :488, :554, :588-660, :745, :1054-1137, :1632)
  - `src/lib/fzp/SimResults.svelte.spec.ts:35-53, 394-411`
  - `src/lib/fzp/card-place.spec.ts`
  - `src/lib/shell/SiteHeader.svelte.spec.ts`, `src/lib/shell/test/HeaderScoreHeader.svelte:17` (dummy label "Another future" → a neutral label such as "Example")
  - `src/routes/s/[id]/page.view.svelte.spec.ts:3, 134`
  - `e2e/fzp.spec.ts` (the reroll section :306-420 and the failed-reroll tests :830-910)
  - `e2e/fzp-sim.spec.ts:156`, `e2e/sim.spec.ts:766, 1374`, `e2e/chrome-dark.spec.ts:337`
- Modify docs: `docs/dev/fzp-mode.md` (:57, :66-67 debug table, :88, :94, :117-120), `docs/dev/sim-page.md` (a "Run slider" section; the header actions list), `docs/dev/map-interfaces.md` (the slider's placement and the card area's right edge)

**Interfaces:**
- Consumes: `RunSwitcher`, `RunSlider`, the helpers (Task 5); `client.reroll(seed, { swap: true })` (Task 3); `ranks`/`ranksFloor` (Task 2); `medianRank` (Task 1).
- Produces:
  - FzpMode state:
    - `runs = new RunSwitcher((seed) => client!.reroll(seed, { swap: true }))`.
    - `position: number | null`: the slider's selected tick, moved at once on select (the handle follows the user), set from `positionOfShown` on each answer and each `ranks` arrival.
    - `switchFailed: boolean`.
    - `canSwitch = phase === 'ready' && !stopped`.
  - Slider select `onselect(p)`: `position = p; runs.select(requestSeed(ranks, p))`. `__sfhFzp.selectRank(p)` calls the same function.
  - `onTimeline` (non-stale):
    - `const done = runs.answer(t.rev)`. When `done`: set `representative = done.seed === null` and `refreshCard()`.
    - When `runs.settled`: `position = positionOfShown(ranks, t.seed, representative)` and `onurlseed(done.seed === null ? null : t.seed)`.
    - The init path through `latest` (:395-410) stays for `initScenario` only. Drop its `writesUrl`.
  - `onError` at a switch rev: `runs.fail(e.rev)`, `switchFailed = true`, `position` back to the shown run's. The alert copy is "Couldn't show that future. Try again." (builder's call: it keeps the notice-stack and axe tests at `e2e/fzp.spec.ts:830-910` and `e2e/chrome-dark.spec.ts:337`, which now trigger it with a slider move under the same `postMessage` seed rewrite).
  - `syncLevers`: the `rerollBusy` guard goes. After `client.setLevers(l)`, when `scenarioLive`:
    - `ranks = null` and `position = null`. The handle sits at the middle and is disabled.
    - When `!representative || !runs.settled`: `runs.reset(); runs.select(null)`. That answer writes the clean URL.
    - Otherwise `runs.reset()`.
    - `scenarioLive` false (an `awaitLevers` `/s/<id>` open, :180-186) changes nothing, so its `?seed=` survives.
  - `startScenario` and `onCrash`: `runs.reset()`, `switchFailed = false`.
  - Slider placement: rendered when `runPhase === 'run' && phase === 'ready' && calibration` and not (card open and viewport < 768 px).
    - `absolute right-2 top-2 z-20`, bottom `calc(var(--map-controls-br-block-size, 60px) + 0.5rem)`. The footprint already includes the scrubber and the phone sheet (`docs/dev/map-interfaces.md`).
    - `disabled={!canSwitch || ranks === null}`.
    - The width comes from the handle's 44 px coarse target.
  - `cardArea(map, pills, dockW, scrubberH, controls: { left?: number; bottom?: number; right?: number })`: `right` is px from the map's right edge to the slider's left edge, and the area's `right` becomes `map.width - (controls.right ?? 0)`. FzpMode measures it from the slider's box. `watchCardArea` observes the slider element.
  - `SimResults` prop `canSwitch: boolean` replaces `canReroll`. Its back button calls `onrepresentative`, which FzpMode wires to `onselect(medianRank(ranks.length))` (or `runs.select(null)` while `ranks` is null).

- [ ] **Step 1: Write the failing FzpMode tests** (fake worker, `runPhase` prop, `ranksMsg` from Task 2)

- `'no run slider in Setup; in a run it shows, disabled, until ranks arrive'`.
- `'a slider move sends one swap reroll; later moves keep only the latest; the answer sends it'`: three key presses while the first is in flight. `allOf('reroll')` has 2 entries, both `swap: true`, the second with the third press's seed.
- `'an answer updates the headline and Results seed, keeps day, play state and high-water, and writes the URL once settled'`: `onurlseed.mock.calls` equals `[[finalSeed]]` after two answers. A move to the median writes `[null]`.
- `'a lever change sends setLevers at once during a switch, resets to the median and drops the old ranks'` (Review Focus 2). `setLevers` is posted while a reroll is unanswered, then a `reroll` with seed `null`. The slider is disabled until `ranksMsg(setLeversRev, …)`.
- `'a crash during a switch leaves nothing in flight; after Retry the slider waits for new ranks'` (Review Focus 3).
- `'an off-band URL seed shows no selected tick; an in-band seed shows its tick'` (Review Focus 5).
- `'Back to the representative future moves the slider to the median'`.
- `'a failed switch shows the alert and the handle returns to the run on show'`.
- `'the slider hides while the phone card sheet is open'` (viewport 375×812).
- `'there is no Another future button'`.

Rewrite the existing "Another future" tests onto the slider, or delete those whose behaviour is gone ("Making another future…", `aria-busy`).

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest --run --project client src/lib/fzp/FzpMode.svelte.spec.ts`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement the FzpMode wiring, `SimResults` `canSwitch`, `cardArea` `right` and the removal**

- [ ] **Step 4: Run the client and server suites for the touched areas**

Run: `npx vitest --run --project client src/lib/fzp src/lib/shell src/routes`, then `npx vitest --run --project server src/lib/fzp`
Expected: PASS

- [ ] **Step 5: Write the e2e tests** in `e2e/fzp.spec.ts`

Replace the "reroll" section with "run slider". Add `runSlider = (page) => page.getByRole('slider', { name: 'Simulated run' })`. Ranks may need more than the 5 s default: extend `waitReady(page, { ranked?: boolean })` so its existing `waitForFunction` predicate also requires `__sfhFzp.ranks !== null`, keeping its existing `timeout: 20_000` line (no new timeout for the `timing` step).
- `'run slider: absent in Setup, present and enabled in a run'`.
- `'End and Home move the headline and ?seed, adding no history entries'`:
  - `history.length` is unchanged.
  - After End: URL `seed` is `ranks[100]`, `__sfhFzp.seed` is `ranks[100]`, and the header score text matches `__sfhFzp.score`'s total at the day.
  - After Home: `seed` is `ranks[0]`, and the last `shown.completedNet` is ≥ End's.
  - Back to the middle (ArrowDown ×50): URL has no `seed`, `representative` is true.
- `'keyboard: arrows, Page keys, Home and End'`: `aria-valuetext` after each.
- `'the URL seed of a slider move reproduces the future'` (the old reroll reload test, moved onto the slider).
- The Back/Forward tests (:367-400) with the slider in place of `reroll(page)`.
- `'axe: the run slider'`: `expectNoA11yViolations(page)` in a run, desktop and mobile projects.
- The failed-switch alert tests (:830-910) and `chrome-dark.spec.ts:337`, driven by a slider move.

Update `e2e/fzp-sim.spec.ts:156`, `e2e/sim.spec.ts:766, 1374` (header action list without "Another future").

- [ ] **Step 6: Run the e2e files**

Run: `npx playwright test e2e/fzp.spec.ts e2e/fzp-sim.spec.ts e2e/sim.spec.ts e2e/chrome-dark.spec.ts`
Expected: PASS on chromium and mobile.

- [ ] **Step 7: Confirm no reference remains**

Run: `rg -n "Another future|anotherFuture|rerollBusy|canReroll|Making another future|Couldn't make another" src e2e docs/dev`
Expected: no output.

- [ ] **Step 8: Update the docs** (`fzp-mode.md`, `sim-page.md`, `map-interfaces.md`), then `npm run check`, `npm run lint`, `npx vitest --run --project server scripts/docs-index.spec.ts`

- [ ] **Step 9: Commit**

```bash
git add -A src e2e docs/dev
git commit -m "feat: run slider on /sim replaces Another future"
```

---

### Task 7: Live measurement, tuning and the dataset

**Files:**
- Modify (only if tuning is needed): `src/lib/map/hide.ts` (`SWAP_CELLS_PER_SLICE`), `src/lib/map/timeline-controller.ts`
- Modify: `docs/dev/map-perf.md`

- [ ] **Step 1: Run the live bench on the finished branch**

Run: `SFH_BENCH_DATASET=<v> npm run bench:map -- run-slider` (the Task 2 Step 6 dataset)
Expected: four case lines. Record them as "final" rows in `docs/dev/map-perf.md`.

- [ ] **Step 2: Judge against the spec**

Pass: default-camera full p95 ≤ 3000 ms, first p50 near 300 ms, and Best↔Worst within roughly 1.5× of one tick at the same camera. If it misses, follow the spec's order. First raise `SWAP_CELLS_PER_SLICE` (try 32, then 64) and re-run. Then cut per-switch main-thread work (encoding, tessellation, the bar rebuild, the demolish diff), each change re-measured and recorded. Bring anything beyond that back to the owner rather than pre-warming neighbours. If you change code, run `npx vitest --run --project server src/lib/map` and `npx vitest --run --project client src/lib/map` after each change.

- [ ] **Step 3: Commit the results (and any tuning)**

```bash
git add docs/dev/map-perf.md src/lib/map
git commit -m "perf: record run slider switch latency on the live dataset"
```

- [ ] **Step 4: Publish the branch's dataset before signoff**

Tasks 1 and 3 changed `src/lib/sim/scenario/**`, so `<v>` changed. Follow `docs/dev/pipeline.md` "Finishing a branch that changes the dataset" steps 1-4: `git merge origin/main`, `npm run pipeline -- fetch --restore` (fresh worktree), `npm run pipeline -- build`, `npm run pipeline -- upload <v>`, `npm run pipeline -- verify <v> --origin <staging>`.
Expected: `npx tsx scripts/dataset-version.ts --check` exits 0.

---

## Open questions

1. **Dataset rebuild.** The worker changes live under `src/lib/sim/scenario/`, which is in the dataset code hash. The branch therefore needs an ~8-minute pipeline build and a staging upload before signoff (Task 7 Step 4), though the data does not change. My recommendation is to accept it. Moving the host out of the hashed path is a larger refactor than this feature.
2. **Reference machine.** The spec asks for p50/p95 on the M2 Air class machine `map-perf.md` names, but that row has never been recorded and the agent's machine is the M5 Pro. My recommendation is to record M5 Pro numbers clearly labelled, and have the owner run `bench:map -- run-slider` on an M2 if the 3 s ceiling is close.
3. **"Generous timeouts" vs chreode's `timing` step.** The step fails any new or raised test timeout. The plan reuses `waitReady`'s existing 20 s timeout for waiting on ranks. If that proves tight under load, my recommendation is a `timing.allow` entry with a reason, not a raised default.
4. **Home/End direction.** The spec sets Home = Best (top) and End = Worst. ARIA's slider pattern maps Home to the minimum. The plan keeps the spec's mapping and makes the top the maximum value (`aria-valuenow = n - position`), so Up still increases the value. My recommendation is to keep it.
