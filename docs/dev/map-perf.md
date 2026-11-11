# Map performance (`npm run bench:map`)

Spec: `docs/superpowers/specs/2026-10-10-map-view-design.md` §4.12.

## What the bench does

`npm run bench:map` runs `e2e/bench/map-pan.bench.ts` (and the timeline cases below) with `playwright.bench.config.ts`:

1. Starts the same VITE_E2E preview server as `npm run test:e2e` (fixture-0 data on :4173), or
   reuses one that is already running. Kill a stale non-VITE_E2E server first
   (`lsof -ti :4173 | xargs kill`): the bench needs the `window.__sfhMap` debug hook.
2. Opens `/` in **headed** Chromium on the real GPU, at 1280×800 CSS px with
   `deviceScaleFactor: 2` (the 2022 MacBook Air in the pass bar is a DPR 2 display, so the
   canvas is 2560×1600 device px). The config adds no SwiftShader or `--use-gl`
   flags. It prints the WebGL renderer string so you can confirm the GPU in use.
3. Waits for `window.__sfhBrush.ready`, so the worker host's own revision-0 snapshot has landed
   (a later one would reset the controller). Then loads a synthetic whole-city plan: `window.__sfhMap.loadSyntheticCity(1)` applies
   `makeSyntheticCity(1, 150_000)` (`src/lib/map/test/synthetic-city.ts`) as one settled
   revision-0 snapshot. That is 150,000 buildings in 100 cells across the SF bbox. The representative population translates cached real generated buildings covering every composition family; the separate stress population exercises eight occupied solids, two roof accents and 128 input vertices per building. The plan goes straight to the
   `GeneratedController`, bypassing the generator worker, because fixture-0 has only 18 parcels.
   Painting a whole-city plan through `__sfhBrush.load` would need production data.
4. Waits for every cell to install, then jumps to downtown (`[-122.4010, 37.7890]`, zoom 15,
   pitch 55) and waits for `idle`.
5. Pans for 10 s with `map.panBy([±360 px/s × dt, 0], { animate: false })` once per
   `requestAnimationFrame`. The step scales with each frame's delta, so 60 Hz and 120 Hz displays
   pan at the same speed. The direction reverses every 2.5 s so the camera stays over downtown.
   It records every rAF delta, then asserts the controller still holds every synthetic cell and
   hides every synthetic parcel.
6. Prints `p50`, `p95`, the frame count, the renderer and PASS/FAIL. The test fails when p95 is
   above the bar.

The debug hook (`loadSyntheticCity`, `applyGenerated`) is compiled only into VITE_E2E builds.

## Running it

```sh
lsof -ti :4173 | xargs kill   # if a non-VITE_E2E preview is running
npm run bench:map
BENCH_CHANNEL=chrome npm run bench:map   # use installed Google Chrome instead of Playwright's Chromium
```

It needs a display. It does not run in the default `npx playwright test` sweep
(`playwright.config.ts` ignores `e2e/bench/**`) or in CI.

## Pass bar

p95 frame time ≤ **16.7 ms** (60 fps) on a 2022 MacBook Air (M2) class machine. rAF follows the
display refresh rate, so on a 120 Hz display the p50 is about 8.3 ms. The bar is the same.

## Results

| Machine                                                                                          | Date       | Browser                    | DPR | Frames | p50    | p95     | Pass                                         |
| ------------------------------------------------------------------------------------------------ | ---------- | -------------------------- | --- | ------ | ------ | ------- | -------------------------------------------- |
| Apple M5 Pro (Mac17,9), 24 GB, macOS 27.0.1, 120 Hz                                              | 2026-10-11 | Playwright Chromium, Metal | 2   | 1201   | 8.3 ms | 9.0 ms  | Yes                                          |
| Apple M5 Pro (same), superseded first run                                                        | 2026-10-11 | Playwright Chromium, Metal | 1   | 1201   | 8.3 ms | 10.0 ms | Yes (DPR 1, fixed 6 px step)                 |
| 2022 MacBook Air (M2)                                                                            | —          | —                          | 2   | —      | —      | —       | not yet recorded                             |
| Apple M5 Pro (same), both transit layers on, fixture-0 (8 stops)                                 | 2026-10-15 | Playwright Chromium, Metal | 2   | 1201   | 8.3 ms | 8.5 ms  | Yes (representative; worst-case p95 8.4 ms)  |
| Apple M5 Pro (same), both transit layers on, live network (3,147 markers)                        | 2026-10-15 | Playwright Chromium, Metal | 2   | 1181   | 8.3 ms | 10.2 ms | Yes (representative; worst-case p95 10.0 ms) |
| Apple M5 Pro (same), closed packed rings (one more wall per part)                                | 2026-10-17 | Playwright Chromium, Metal | 2   | 1201   | 8.3 ms | 9.3 ms  | Yes (representative; worst-case p95 8.6 ms)  |
| Apple M5 Pro (Mac17,9), timeline "playback", 30,000 projects, zoom 15.5                          | 2026-10-17 | Playwright Chromium, Metal | 2   | 1201   | 8.3 ms | 10.3 ms | Yes                                          |
| Apple M5 Pro (Mac17,9), timeline "drag", 30,000 projects, zoom 15.5                              | 2026-10-17 | Playwright Chromium, Metal | 2   | 1201   | 8.3 ms | 9.0 ms  | Yes                                          |
| Apple M5 Pro (same), timeline "playback", closed rings (after #21)                               | 2026-10-17 | Playwright Chromium, Metal | 2   | 1201   | 8.3 ms | 10.3 ms | Yes                                          |
| Apple M5 Pro (same), timeline "drag", closed rings (after #21)                                   | 2026-10-17 | Playwright Chromium, Metal | 2   | 1200   | 8.3 ms | 10.3 ms | Yes                                          |
| Apple M5 Pro (same), timeline "playback + limits", 5,531 faces, 10,352 rim paths, 390,036 chains | 2026-11-01 | Playwright Chromium, Metal | 2   | 1201   | 8.3 ms | 10.0 ms | Yes                                          |
| Apple M5 Pro (Mac17,9), representative, after the `__lc` road-layer clones (Plan A)              | 2026-11-03 | Playwright Chromium, Metal | 2   | 1200   | 8.3 ms | 9.0 ms  | Yes (worst-case p95 8.9 ms)                  |
| Apple M5 Pro (same), timeline "playback", after the `__lc` clones                                | 2026-11-03 | Playwright Chromium, Metal | 2   | 1201   | 8.3 ms | 9.0 ms  | Yes                                          |
| Apple M5 Pro (same), timeline "drag", after the `__lc` clones                                    | 2026-11-03 | Playwright Chromium, Metal | 2   | 1201   | 8.3 ms | 8.9 ms  | Yes                                          |
| Apple M5 Pro (same), timeline "playback + limits", after the `__lc` clones                       | 2026-11-03 | Playwright Chromium, Metal | 2   | 1201   | 8.3 ms | 9.0 ms  | Yes                                          |

Run the bench with both transit layers on (the default View prefs). fixture-0 has only 8 stops, so its transit row measures the layer overhead. The live-network row ran the same bench against a local copy of the production dataset (`npm run data:local -- <version>`, then `npm run data:transit -- <version>`) served with `PUBLIC_DATASET_VERSION` set to that version instead of `fixture-0` (the override is ignored unless `ENVIRONMENT=development` is also set) (the bench config pins `fixture-0`, so this needs a one-off config override). Re-check against live data when the stop layers change.

Add a row when you run the bench on new hardware or after a change to the rendering path.

## Timeline cases (FZP timelapse renderer)

Spec: `docs/superpowers/specs/2026-10-16-timelapse-render-design.md` §4.7 and §6.
`e2e/bench/map-timeline.bench.ts` runs in the same `npm run bench:map` sweep as `map-pan.bench.ts` (the shared `pct`, `verdict` and `BAR_MS` live in `e2e/bench/bench-util.ts`). Each case is a fresh page load. After the worker's revision 0 lands, it calls `window.__sfhMap.loadSyntheticTimeline(1, 30000)`, which sets `SYNTHETIC_LOOKUPS` and applies `makeSyntheticTimeline(1, 30000)` through SimMap's `applyTimeline` (this puts SimMap in timeline mode). It waits for `timelineSnapshot().cells` to reach the cell count, calls `setTime(Day 20742)`, then jumps to downtown (`[-122.401, 37.789]`, zoom 15.5, pitch 55). 30,000 projects is a tier-4 stress size, about 1.5× the high end of the design's buildout expectations.

Both cases then pan for 10 s exactly as `map-pan` does (360 px/s, direction flipping every 2.5 s), and call `setTime` once per frame as a triangle wave over Day 20742 to Day 29584:

- **playback**: 1,095.7 simulated days/s (3 years/s, fzp-mode's fastest speed). It clamps at Day 29584 and reverses, so one 10 s run goes forward for about 8.1 s and back for the rest.
- **drag**: the full range in 2 s, back and forth (4,421 days/s, a 4 s period).

Each prints `p50`, `p95`, frames, parts, `pumpMaxOps` (the demolish pump's largest feature-state call count in one frame, from `demolishMaxFrameOps`; the "catch-up" figure in parentheses is its value before the pan, i.e. the revision-0 install), the renderer and PASS/FAIL, and asserts p95 ≤ 16.7 ms. The existing-building catch-up bound is 2,000 feature-state changes per frame.

**Height limits case.** **playback + limits** is `playback` plus the sim map's height limits (`HeightLimitsLayer`, `src/lib/map/height/limits-layer.ts`) in plain mode, at the bench camera (zoom 15.5, pitch 55: inside the lid band, so lids and their labels draw and the contours are faded out). Once the timeline cells are in, it calls `window.__sfhMap.loadSyntheticLimits(1)`, which runs `makeSyntheticLimits(1)` (`src/lib/map/test/synthetic-limits.ts`) on the main thread, the one place the real builders do: the city build over 150,000 seeded lots across `CITY_BOUNDS` (limits 4–40 stories), and a lid build over a 3 km × 3 km downtown view centred on the bench camera, of 25 ft × 100 ft lots in 3 × 2 blocks between 10 m streets, a limit per block of 4–40, 1 lot in 20 an exception and 1 in 50 painted. It sets `[heightLimitsLayer(…)]` through SimMap's `setOverlayLayers`. The line adds `limits=faces/rimPaths/chains`. On 2026-11-01 (M5 Pro, 120 Hz), after the final review's fixes (no re-render on a pan at a fixed zoom inside the fade), the run printed `limits=5531/10352/390036`, p50 8.3 ms and p95 10.0 ms over 1201 frames, under the bar (the first run read 9.3 ms over 1200 frames; this run's other cases also read 9.7 to 10.0 ms, so the spread is run to run); `npm run bench:map` ran all five cases (5 passed). The worker's own build times are separate (`src/lib/map/height/height.bench.spec.ts`).

The synthetic parcel ids match no buildings-tile features. The pump's `setFeatureState` call count is real, but MapLibre's render-time cost on live tiles is not measured here.

Pump max ops per frame, 2026-10-17 (full sweep; the earlier timeline-only run gave 48 and 155 ops at p95 10.0 ms and 8.5 ms):

| Case                               | p95     | Pump max ops/frame |
| ---------------------------------- | ------- | ------------------ |
| playback                           | 10.3 ms | 48                 |
| drag                               | 9.0 ms  | 170                |
| playback, closed rings (after #21) | 10.3 ms | 53                 |
| drag, closed rings (after #21)     | 10.3 ms | 171                |

The first two rows were measured on open packed rings; the "closed rings (after #21)" rows were re-run after the closing vertex landed (every timeline part has one more wall). The closed-ring deltas (pump 48 to 53 ops, drag p95 9.0 to 10.3 ms) are run-to-run spread, not an effect of the extra wall: pump op counts do not depend on wall count, and earlier runs already varied by this much. Other preview servers were running on the machine during the closed-ring run, which adds to the noise. Both pump maxima stay far under the 2,000 feature-state cap.

## Run slider switch

`e2e/bench/run-slider.bench.ts` measures how long `/sim` takes to show another of the band's 101 runs. It opens `/sim`, starts a run, waits for the band's `ranks`, the first run's timeline and an idle install queue, then makes 10 switches per case through the e2e hook (`window.__sfhFzp.selectRank(position)`, position 0 = Best; the median position asks for the representative run). Each switch is one in-page evaluate that stamps `t0`, reads `timelineSnapshot().installs`, calls `selectRank`, and polls every `requestAnimationFrame`:

- `first`: the first frame where a cell has installed (`installs` grew) and the new timeline has answered (`switchTrace.answeredAt`).
- `full`: the first frame where the run is complete (`switchTrace.completeAt`) and the install queue is empty (`pending === 0`).

Four cases: camera `default` (the page's opening camera) or `zoomed` (downtown, zoom 15.5, pitch 55, as the timeline cases) times move `one tick` (alternate the median and the next position) or `Best↔Worst` (alternate positions 0 and 100). It prints p50/p95 of `first` and `full` with the dataset, renderer and DPR, and asserts the `default` camera's `full` p95 is at most 3000 ms (the spec's ceiling). Later run-slider tasks re-run the same bench.

Run it on a quiet machine, live:

```bash
npm run data:local -- <production dataset version>   # once; `npx tsx scripts/dataset-version.ts` on main prints it
SFH_BENCH_DATASET=<version> npm run bench:map -- 'run-slider\.bench'
```

`SFH_BENCH_DATASET` makes `playwright.bench.config.ts` skip `npm run data:fixture` and serve that version (`PUBLIC_DATASET_VERSION`). Without it the bench runs against fixture-0, which is only a smoke check: its timeline is tiny (the smoke run on 2026-11-10 read about 6 ms `first` and 15 ms `full` in all four cases). Filter with `'run-slider\.bench'`, not `run-slider`: Playwright matches the filter against the whole file path, so inside a worktree named `*run-slider*` the bare word selects every bench file.

### Results

| Machine   | Date      | Dataset | Case     | first p50/p95               | full p50/p95                | Label                   |
| --------- | --------- | ------- | -------- | --------------------------- | --------------------------- | ----------------------- |
| (pending) | (pending) | live SF | all four | deferred: needs a quiet run | deferred: needs a quiet run | baseline: reroll path   |
| (pending) | (pending) | live SF | all four | deferred: needs a quiet run | deferred: needs a quiet run | after worker + map swap |

The live baseline was not taken in the session that wrote the bench: the machine was under heavy load (1-minute load average about 38) when it was written, and it needs the production dataset in local R2 (`data:local`) on a quiet machine. Ballpark expectations, from the pieces and not measured: the worker simulates a run in about 20 ms, cold building generation costs about 25 microseconds per building, and today's whole-city install is about 1 s (4 cells per frame times 256 cells at 60 Hz). So the baseline full switch at the default camera should land around 1 to 3 s, and a viewport-sized install around 0.2 to 0.5 s.

The "after worker + map swap" rows (worker swap reroll and `TimelineController` swap mode, with `selectRank` asking for a swap) were deferred too: the session that added the map swap saw a 1-minute load average of about 4 with another worktree's Vitest run going, and the production dataset was not yet in local R2. Its main-thread companion, `swap install cadence at 30,000 projects (baseline)` in `src/lib/map/timeline.perf.svelte.spec.ts` (`client-perf`; rAF gaps from a swap revision 0 until `pending` is 0, p95 at most 50 ms, never an empty layer list), has no baseline yet either: there, as for every real-map test in that file, the map did not reach `ready` (map sources failed with `e.split is not a function`, an environment fault that also fails `SimMap*.svelte.spec.ts` at the branch base).

## CI

CI does not run this bench. Headless Chromium in CI renders with software GL (SwiftShader), so
GPU frame times there mean nothing. The main-thread budgets are client tests instead: C5 in
`src/lib/map/generated-controller.perf.svelte.spec.ts` checks that a 500-parcel update reaches its
first rising frame within 30 ms. Like every wall-clock budget they run in `npm run test:perf`
(project `client-perf`) on an idle machine, not in `test:unit` or signoff
([testing.md](testing.md)).

## Building compositions validation (2026-10-11)

Run with `SFH_E2E_PORT=4191 npm run bench:map` to use an isolated preview while another worktree owns the default port. Both benchmark cases run on the real GPU. Cells wholly outside the visible volume between ground and roof height are culled; culling is disabled for cameras below roof height and pitches above 60°, preserving conservative visibility.

Hardware: Apple M5 Pro, 24 GB, headed Playwright Chromium, ANGLE Metal Renderer, DPR 2, 1280×800 CSS pixels. These results do **not** establish the M2 or real-mobile acceptance target.

| Population                  | Buildings |     Parts | Input vertices |    p50 |    p95 | ≤16.7 ms |
| --------------------------- | --------: | --------: | -------------: | -----: | -----: | -------- |
| Representative compositions |   150,000 |   494,972 |      2,458,446 | 8.3 ms | 9.3 ms | Pass     |
| Maximum-budget stress       |   150,000 | 1,500,000 |     19,200,000 | 8.3 ms | 9.3 ms | Pass     |

Before culling, representative p95 was 12.1 ms and stress p95 was 25.2 ms (failed). Culling changes draw eligibility, not packed geometry, housing totals or the number of layers/cells.

Standalone generation of the existing 150,000-case seed-42 mix took 2,208 ms (145,132 non-null buildings). Synthetic population packing took 170 ms representative / 694 ms stress; this is fixture construction, not gesture latency. The existing generation and worker-host limits remain enforced.

The separate loaded 500-parcel pointer-up-to-visible-frame test measured 106 ms desktop and 111 ms at 375 px in browser mobile emulation, against a 150 ms limit. It routes 500 real parcel records through the worker, generator, packer and renderer; synthetic renderer loading is not used for this measurement. Mobile emulation is not a real mobile GPU result.

Elevated views at 5/6/8/12/20/40 floors were inspected in light and dark themes at desktop and 375 px, with parcel boundary overlays and excluded/concave sites. M2 and physical-mobile performance acceptance remains open.

Independent review found and corrected a same-typology capacity decrease at a family transition and a simple tower reference that bypassed the six-metre-core rule. Family/attempt retention is now checked across each typology's finite height range using fixed floor plates, and preference is anchored at the earliest replacement gain. These checks use bounded arithmetic, with the bounded fitted candidate set evaluated only when existing development prevents a gain at the typology's minimum height. Invalid tower references use the existing twelve-floor midrise fallback.

Post-review verification passed: 1,180 unit/component tests, 143 end-to-end tests (33 expected skips), type checking and lint. Both headed GPU populations passed again at 9.3 ms p95. M2/physical-mobile acceptance remains open. A minor deferred issue is that final coordinate rounding can move tower plate area/separation slightly beyond local-space limits (observed plate excess 0.378 m² and expanded-plate overlap 0.022 m²).
