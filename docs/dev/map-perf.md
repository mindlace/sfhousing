# Map performance (`npm run bench:map`)

Spec: `docs/superpowers/specs/2026-10-10-map-view-design.md` §4.12.

## What the bench does

`npm run bench:map` runs `e2e/bench/map-pan.bench.ts` with `playwright.bench.config.ts`:

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
   `GeneratedController`, bypassing the generator worker, because fixture-0 has only 14 parcels.
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

| Machine                                             | Date       | Browser                    | DPR | Frames | p50    | p95     | Pass                         |
| --------------------------------------------------- | ---------- | -------------------------- | --- | ------ | ------ | ------- | ---------------------------- |
| Apple M5 Pro (Mac17,9), 24 GB, macOS 27.0.1, 120 Hz | 2026-10-11 | Playwright Chromium, Metal | 2   | 1201   | 8.3 ms | 9.0 ms  | Yes                          |
| Apple M5 Pro (same), superseded first run           | 2026-10-11 | Playwright Chromium, Metal | 1   | 1201   | 8.3 ms | 10.0 ms | Yes (DPR 1, fixed 6 px step) |
| 2022 MacBook Air (M2)                               | —          | —                          | 2   | —      | —      | —       | not yet recorded             |

| Apple M5 Pro (same), both transit layers on (default) | 2026-10-15 | Playwright Chromium, Metal | 2 | 1201 | 8.3 ms | 8.5 ms | Yes (representative; worst-case p95 8.4 ms) |

Run the bench with both transit layers on (the default View prefs) on the bench machine. fixture-0 has only 8 stops, so the transit row measures the layer overhead, not a full network. Re-check against live data (`npm run data:transit`) when the stop layers change.

Add a row when you run the bench on new hardware or after a change to the rendering path.

## CI

CI does not run this bench. Headless Chromium in CI renders with software GL (SwiftShader), so
GPU frame times there mean nothing. CI gates the main-thread budgets instead: client test C5 in
`src/lib/map/generated-controller.svelte.spec.ts` checks that a 500-parcel update reaches its first
rising frame within 30 ms.

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
