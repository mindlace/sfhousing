# Map performance (`npm run bench:map`)

Spec: `docs/superpowers/specs/2026-10-10-map-view-design.md` §4.12.

## What the bench does

`npm run bench:map` runs `e2e/bench/map-pan.bench.ts` with `playwright.bench.config.ts`:

1. Starts the same VITE_E2E preview server as `npm run test:e2e` (fixture-0 data on :4173).
   It refuses to reuse an existing server, so a stale build cannot silently supply the wrong code.
   Inspect the owner of :4173 and stop that server before running; the bench needs the
   `window.__sfhMap` debug hook from its own build.
2. Opens `/` in **headed** Chromium on the real GPU, at 1280×800 CSS px with
   `deviceScaleFactor: 2` (the 2022 MacBook Air in the pass bar is a DPR 2 display, so the
   canvas is 2560×1600 device px). The config adds no SwiftShader or `--use-gl`
   flags. It prints the WebGL renderer string so you can confirm the GPU in use.
3. Waits for `window.__sfhBrush.ready`, so the worker host's own revision-0 snapshot has landed
   (a later one would reset the controller). Then loads a synthetic whole-city plan: `window.__sfhMap.loadSyntheticCity(1)` applies
   `makeSyntheticCity(1, 150_000)` (`src/lib/map/test/synthetic-city.ts`) as one settled
   revision-0 snapshot. That is 150,000 generated buildings in 100 cells across the SF bbox, about
   30% of them two-part podium/tower buildings. The plan goes straight to the
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
lsof -nP -iTCP:4173 -sTCP:LISTEN   # inspect any conflicting preview server
npm run bench:map
BENCH_CHANNEL=chrome npm run bench:map   # use installed Google Chrome instead of Playwright's Chromium
```

It needs a display. It does not run in the default `npx playwright test` sweep
(`playwright.config.ts` ignores `e2e/bench/**`) or in CI.

## Pass bar

p95 frame time ≤ **16.7 ms** (60 fps) on a 2022 MacBook Air (M2) class machine. rAF follows the
display refresh rate, so on a 120 Hz display the p50 is about 8.3 ms. The bar is the same.

## Results

| Machine                                             | Date       | Browser                                 | DPR | Frames | p50    | p95     | Pass                         |
| --------------------------------------------------- | ---------- | --------------------------------------- | --- | ------ | ------ | ------- | ---------------------------- |
| Apple M5 Pro (Mac17,9), 24 GB, macOS 27.0.1, 120 Hz | 2026-10-11 | Playwright Chromium, Metal              | 2   | 1201   | 8.3 ms | 9.0 ms  | Yes                          |
| Apple M5 Pro (same), superseded first run           | 2026-10-11 | Playwright Chromium, Metal              | 1   | 1201   | 8.3 ms | 10.0 ms | Yes (DPR 1, fixed 6 px step) |
| Apple M5 Pro (Mac17,9), final synthetic regression  | 2026-10-12 | Playwright Chromium 156.0.8078.4, Metal | 2   | 1200   | 8.3 ms | 9.9 ms  | Yes                          |
| 2022 MacBook Air (M2)                               | —          | —                                       | 2   | —      | —      | —       | not yet recorded             |

Add a row when you run the bench on new hardware or after a change to the rendering path.

## CI

CI does not run this bench. Headless Chromium in CI renders with software GL (SwiftShader), so
GPU frame times there mean nothing. CI gates the main-thread budgets instead: client test C5 in
`src/lib/map/generated-controller.svelte.spec.ts` checks that a 500-parcel update reaches its first
rising frame within 30 ms.

## Explicit real roof sample benchmark

The default fixture command and synthetic whole-city test body remain unchanged. Opt in to the
previously built `2026-10-12-c9b71965` local sample with:

```sh
BENCH_DATASET_VERSION=2026-10-12-c9b71965 npm run bench:map -- --grep 'actual roofs'
BENCH_FIXTURE_VISUALS=1 npm run bench:map -- --grep 'fixture courtyard'
```

The sample must already exist in the isolated worktree's local R2 and `pipeline/out/`.
`BENCH_DATASET_VERSION` is validated and changes only the benchmark preview command; it does not
change production configuration or reuse another app. Its exact index SHA-256 is
`49384f5d1e8954bdd28ada6de1a6e2e0686e3bfa04029f962de46d357bc47faf`. This is the earlier
**roofer 1.0.0** output, retained as real runtime/backward-compatibility evidence. It is not a new
build with the current 1.1.0-beta.1 tool pin.

The opt-in group checks cold default first-idle transfer independently, then empty and real
editor-generated replacement plans over Noe `49_24-000` and Mission `51_24-000`. Each route pans
for ten seconds at zoom 17/pitch 55 within the actual roof block and checks rendered camera
visibility and target residency. Its p95 is GPU-backed rAF cadence, not a GPU-only execution timer.
It requires native hardware and `KHR_parallel_shader_compile` (Metal on macOS), at least 500
frames, and p95 at most 16.7 ms. Main-thread longtasks are observed before activation through
below-15 disposal, including `takeRecords`, with the unchanged 50 ms ceiling.

Readiness must equal every piece in the active chunks; replacement visibility remains independent.
Final composer publications record preparing/active roof layers, maximum layer count and duplicate
publications. E2E-only cache mutation observations retain high-water accounting including index
reservations, uninstalled jobs and retired ownership; these are state-transition observations,
not per-frame claims of an instantaneous process/GPU memory maximum. Accounted total must stay
within 64 MiB and jobs within four. Below zoom 15, roof layers/readiness/jobs/owned/reserved/retired
state must release; cached index bytes may remain. Returning restores exact readiness. Browser
requests for source LAZ/LAS/TIFF or the large build-only audit fail the group.

Measured on Apple M5 Pro (Mac17,9), 24 GiB, macOS 27.0.1, Chromium 156.0.8078.4,
ANGLE Metal, 1280×800 CSS viewport, DPR 2; observed median cadence 8.3 ms (about 120 Hz):

| Route / scenario              | Date       | Frames |    p50 |    p95 | Result |
| ----------------------------- | ---------- | -----: | -----: | -----: | ------ |
| Noe / empty                   | 2026-10-12 |   1200 | 8.3 ms | 8.9 ms | Pass   |
| Mission / empty               | 2026-10-12 |   1200 | 8.3 ms | 8.7 ms | Pass   |
| Noe / editor replacements     | 2026-10-12 |   1200 | 8.3 ms | 8.7 ms | Pass   |
| Mission / editor replacements | 2026-10-12 |   1200 | 8.3 ms | 8.6 ms | Pass   |

The separate real first-idle transfer was **2,344,875 encoded bytes**, with no roof warmup or
runtime roof requests at the default view. Both scenarios recorded **zero longtasks** through
activation/disposal. Both chunks were resident: **98 pieces, 50 parent models, 6,174 triangles**.
Transition maxima were **8,388,608 accounted bytes** (the initial bounded index-read reservation),
**6,868,159 reserved/owned bytes**, two jobs and two roof layers, with zero invalid accounting or
duplicate publications. The matching named screenshots show Whole Foods' spike fallback,
a96's partly modelled result, retained hillside/Mission roofs, Salesforce's inactive coverage
fallback, and real single-parcel editing/Undo. The separate courtyard visuals use **fixture-0**;
they are not real sample evidence.

This small two-chunk sample cannot exercise four-job saturation, 64 MiB pressure, maximum-size
chunks, full-city complexity tails or sustained city eviction churn. **M2-class validation remains
pending**. The old sample does not validate beta reconstruction quality, source coverage, operator
completion, publication readiness or a full Task 10/city rollout. Default first-idle, generated
commit/score and C5 latency regressions remain separate correctness gates.
