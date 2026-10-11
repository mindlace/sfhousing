# Map performance (`npm run bench:map`)

Spec: `docs/superpowers/specs/2026-10-10-map-view-design.md` §4.12.

## What the bench does

`npm run bench:map` runs `e2e/bench/map-pan.bench.ts` with `playwright.bench.config.ts`:

1. Starts the same VITE_E2E preview server as `npm run test:e2e` (fixture-0 data on :4173), or
   reuses one that is already running. Kill a stale non-VITE_E2E server first
   (`lsof -ti :4173 | xargs kill`): the bench needs the `window.__sfhMap` debug hook.
2. Opens `/` in **headed** Chromium on the real GPU. The config adds no SwiftShader or `--use-gl`
   flags. It prints the WebGL renderer string so you can confirm the GPU in use.
3. Loads a synthetic whole-city plan: `window.__sfhMap.loadSyntheticCity(1)` applies
   `makeSyntheticCity(1, 150_000)` (`src/lib/map/test/synthetic-city.ts`) as one settled
   revision-0 snapshot. That is 150,000 generated buildings in 100 cells across the SF bbox, about
   30% of them two-part podium/tower buildings. The plan goes straight to the
   `GeneratedController`, bypassing the generator worker, because fixture-0 has only 14 parcels.
   Painting a whole-city plan through `__sfhBrush.load` would need production data.
4. Waits for every cell to install, then jumps to downtown (`[-122.4010, 37.7890]`, zoom 15,
   pitch 55) and waits for `idle`.
5. Pans for 10 s with `map.panBy([±6, 0], { animate: false })` once per `requestAnimationFrame`.
   The direction reverses every 2.5 s so the camera stays over downtown. It records every rAF
   delta.
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

| Machine                                     | Date       | Browser                    | Frames | p50    | p95     | Pass             |
| ------------------------------------------- | ---------- | -------------------------- | ------ | ------ | ------- | ---------------- |
| Apple M5 Pro (Mac17,9), 24 GB, macOS 27.0.1 | 2026-10-11 | Playwright Chromium, Metal | 1201   | 8.3 ms | 10.0 ms | Yes              |
| 2022 MacBook Air (M2)                       | —          | —                          | —      | —      | —       | not yet recorded |

Add a row when you run the bench on new hardware or after a change to the rendering path.

## CI

CI does not run this bench. Headless Chromium in CI renders with software GL (SwiftShader), so
GPU frame times there mean nothing. CI gates the main-thread budgets instead: client test C5 in
`src/lib/map/generated-controller.svelte.spec.ts` checks that a 500-parcel update reaches its first
rising frame within 30 ms.
