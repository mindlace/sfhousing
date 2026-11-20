# Testing

## Vitest

`npm run test:unit` runs two projects (`vite.config.ts`):

- **server** (Node): `src/**/*.{test,spec}.ts` and `scripts/**/*.spec.ts`, excluding `*.svelte.{test,spec}.ts` and the wall-clock budgets below.
- **client** (browser via Playwright, `vite.config.client-test.ts`): component tests named `*.svelte.spec.ts`, importing `page` from `vitest/browser`, excluding `*.perf.svelte.spec.ts`.

`npm run test:perf` runs the wall-clock budgets, one file at a time: project **perf** (Node: `src/**/*.bench.spec.ts` and `src/**/*.perf.spec.ts`, e.g. `src/lib/sim/host.bench.spec.ts`, `src/lib/sim/scenario/scenario.bench.spec.ts`, `src/lib/map/height/height.bench.spec.ts`) and project **client-perf** (browser, no retry: `src/**/*.perf.svelte.spec.ts`, the C5 frame budgets in `src/lib/map/generated-controller.perf.svelte.spec.ts` and `src/lib/map/timeline.perf.svelte.spec.ts`). Their limits sit a few milliseconds above an idle M5 Pro, so any other load on the machine (another agent's test run, a preview server) fails them: they are not in `test:unit` or signoff. Run `npm run test:perf` on an idle machine before merging a change that could move them (the scenario worker, the sim host, the generator, the map controllers, the height builds). A spec whose assertions are wall-clock budgets goes in a `*.bench.spec.ts` / `*.perf.spec.ts` / `*.perf.svelte.spec.ts` file; behaviour tests stay deterministic (count work, not milliseconds). The fixture checks inside the bench files (bench city size, every eligible lot built) run with them.

Test files are colocated with the code. `expect.requireAssertions` is on: every test must call `expect` (wrap `fc.assert` in `expect(() => ...).not.toThrow()`).

The client project needs the Playwright chromium browser: run `npx playwright install chromium` once (the one download beyond npm; `test:e2e` needs it too).

Cross-engine goldens (AC-11): `SFH_BROWSER=chromium|webkit|firefox` selects the client project's single browser (default `chromium`; anything else throws). Install the engines once with `npx playwright install webkit firefox`, then run for example `SFH_BROWSER=webkit npm run test:unit -- src/lib/timelapse/math.golden.svelte.spec.ts src/lib/timelapse/model.golden.svelte.spec.ts` (and `SFH_BROWSER=firefox` likewise). Vitest's own `--browser.name` only filters the configured instances, so it cannot switch engines here. The server project still runs in the same invocation; the engine run is the `client (webkit)` / `client (firefox)` lines.

In the client project, `$app/state` and `$app/navigation` are aliased to small stubs in `src/test-stubs/app/` (kept outside `$lib`) so route component specs (e.g. `src/routes/page.svelte.spec.ts`) can render pages: specs set `page.state` and read `replaceStateCalls`. Other `$app/*` modules and `$env/*` have no alias and still need `vi.mock(...)`. `src/lib/sharing/**` must not import `$app/*` at all; an ESLint `no-restricted-imports` rule enforces it so the stubs can't hide such an import.

The timeline debug snapshot (`window.__sfhMap.timelineSnapshot()`, `TimelineSnapshot` in `src/lib/map/timelapse/types.ts`) also reports the halo layer: `halos` (rings), `marks`, `halosShown` and `marksShown` (rings and marks `evalHalo` shows on the clock's day at the map's zoom, behind the halo layer's gate) and `haloDays` (the rings' distinct event days, ascending, the first 500); all are 0 or empty until a page calls `setHalos`. A spec that steps the playhead to a halo reads a day from `haloDays` and waits on `halosShown`. It also reports `projects` (installed slots with parts), `ringMinZoom` (the halo layer's gate: 0, or 14 while the city layer exists) and the citywide view ([map-interfaces.md](map-interfaces.md), "Merged rings and edge glows"): `cityMarkers` and `cityFlagged` (markers held, halos on or off), `cityRecords` and `cityDays` (0 and empty without the city layer), `cityBuilds` (`buildCity` calls), and `cityRings` and `cityGlows` (records `evalCity` draws on the clock's day in the map's camera); and the bars' `barMode` (`'street'` until `setBarMode`) and `barsShown` (bars `evalBar` shows on the clock's day at the zoom at each anchor, in the map's view; [map-interfaces.md](map-interfaces.md), "Bar modes"). The shown counts read the camera through `TimelineDeps.debugView`, so they follow a `jumpTo` once the map is idle. In server specs, `makeFakeTimelineDeps()` records every `HaloLayer` and `CityLayer` construction (a `clone` included) in `haloLayers` and `cityLayers`, so a test counts rebuilds structurally; set `deps.view` (a `DebugView` with `zoom`, `viewPx`, `centre`, `pxPerMeter`, `bearing` and a `clip` function) to give the snapshot a camera, and `viewReads` counts its reads. `src/lib/map/timelapse/halo-layer.gpu.svelte.spec.ts` renders the layer in a standalone `Deck` and checks rings and marks against `evalHalo`.

GPU specs for deck layers (`*.gpu.svelte.spec.ts`, client project, real WebGL in Playwright Chromium): `src/lib/map/height/limits-layer.gpu.svelte.spec.ts` renders `HeightLimitsLayer` in a standalone `Deck` over a small canvas, and `limits-maplibre.gpu.svelte.spec.ts` renders it in an interleaved `MapLibreOverlay` before the first symbol layer, as `SimMap` does, over real MapLibre fill-extrusions. The interleaved pattern: build a tiny scene (`tinyLimits()` in `src/lib/map/height/test/fixtures.ts`), render it pitched with the layer and again without it, and compare chosen pixels (a box face tinted below the lid and untouched above it; open ground and ground hidden behind a tall box tinted), because a depth mistake against MapLibre's buildings only shows in a combined frame. Pixel assertions use the dark theme, where the light glaze shows most. The shared lot and scene builders for the height specs and the benches are in `src/lib/map/height/test/fixtures.ts`.

The sim object's logic runs in Node over `freshSimDb()` (`src/lib/server/sim-object/test/harness.ts`): the object's own migration bundle in better-sqlite3. No spec imports `cloudflare:workers`. See [sim-object.md](sim-object.md).

Single test: `npx vitest --run --project server path/to/file.spec.ts` (or `--project client`, `perf`, `client-perf`).

A coarse pointer in a client spec is a stubbed `window.matchMedia` (`vi.stubGlobal`, undone with `vi.unstubAllGlobals()` in `afterEach`), set before render: it matches `(pointer: coarse)` and not `(pointer: fine)`, and passes every other query (the dock reads `(min-width: 768px)`) to the real `matchMedia`. The Playwright `mobile` project (touch) is coarse. A touch laptop is the primary pointer fine with `(any-pointer: coarse)` true: the code reads `(pointer: ...)` only, so it counts as fine (`BrushEditor.dock.svelte.spec.ts` stubs it, and fires a `change` on the stubbed query to see the Undo row and the Shortcuts button swap). `/`'s keyboard undo needs a map for the brush controller: `src/routes/page.undo.svelte.spec.ts` mocks `SimMap` with the `FzpSimMapStub` double, which `page.svelte.spec.ts` cannot (it relies on the real map's no-WebGL fallback).

## Finance engine tests

The engine's funded starts ([finance-engine.md](finance-engine.md)) have their own golden, fixtures
and bench cases.

- **Finance golden.** `src/lib/sim/scenario/fixtures/golden-finance-seed1.json` holds the schedules
  and ledger of the mini city with `miniCalibrationWithRoutes()` and `miniFinance()` for seeds 1 and
  4 (horizon 2050-12-31), checked in Node (`simulate.finance.golden.test.ts`) and in the browser
  (`simulate.finance.golden.svelte.spec.ts`). Its builder is
  `fixtures/build-finance-golden.ts`, run deliberately (`env -C <worktree> node_modules/.bin/tsx
src/lib/sim/scenario/fixtures/build-finance-golden.ts`), never from CI: a changed file is an engine
  change to review. It does not replace `golden-seed1.json`, which has no `finance` and locks "no
  public money means no change".
- **Fixtures.** `fixtures/mini-finance.ts` (`miniFinance()`, `miniCalibrationWithRoutes()`: two
  capped pools, one uncapped, a certain affordable stack, a market loan, a market guarantee, one
  `off` span) and `fixtures/tiny-queue.ts` (`tinyQueue()`, a five-lot city with hand-set hazards and
  yields for exact queue cases; `tinyStack()`, a baseline-shaped affordable stack with an optional
  bond). All values are test values, not data. `test/finance-harness.ts` checks the ledger
  identities after every event (`checkLedger`) and collects a run (`runCollect`).
- **Bench cases.** `scenario.bench.spec.ts`, run by `npm run test:perf` on an idle machine:
  `simulateNet` with the bench baseline and with `benchFunding()`, the host's 101 band pairs and
  longest macrotask, a fixture check of the first-day applications and awards, and a reported case
  with `state` off. The fixtures are `fixtures/bench-finance.ts`. The budgets and the measured
  medians are in [finance-engine.md](finance-engine.md); cases 2, 3 and 5 miss their budgets on a
  busy machine until the conductor re-sets them after a quiet run.

## Stored schema-2 policies

`src/lib/sim-page/fixtures/schema2/` holds byte copies of stored schema-2 `/sim` documents taken from
the code as it was before the schema-3 change: `painted.json` (the text of `paintedText()` in
`src/lib/server/test/sim-docs.ts`), `profile.json` (the old `scripts/profile-sim-load.policy.json`),
`tampered.json` (`tamperedText()`) and `default-record.json` (a localStorage record `{ v: 1, savedAt,
plan }` whose `plan` is the schema-2 default policy). They are committed verbatim and listed in
`.prettierignore`, so their bytes stay as stored: never reformat or regenerate them. `sim-doc.spec.ts`
loads each in `'reconcile'` as schema 3 with default funding; the autosave, storage, shared-page and
`SimPage` specs and `e2e/sim-share.spec.ts` use them for the upgrade paths ([plan-sharing.md](plan-sharing.md),
"Policies (`/sim`)").

## FakeR2Bucket

`src/lib/server/test/fake-r2.ts` is an in-memory `R2Bucket` subset (`get` with `range`/`onlyIf` as `Headers`, `head`, `put`) for route tests. Options model both known R2 behaviours:

- `unsatisfiable: 'throw' | 'whole'`: past-the-end range throws (documented R2) or returns the whole object (local workerd).
- `suffixShape: 'resolved' | 'suffix'`: suffix ranges reported as `{offset, length}` (workerd) or `{suffix}`.

It is not a general R2 emulator. The Playwright e2e against workerd is the source of truth for R2 semantics; when they disagree, fix the fake.

## Playwright

`npm run test:e2e` (`playwright.config.ts`, `e2e/`): projects `chromium` (desktop) and `mobile` (375x812, touch), plus `chromium-perf` and `mobile-perf`, which run `e2e/**/*.perf.spec.ts` (the 500-parcel pointer-up-to-display 150 ms budget, and the desktop stroke's pointer-up-to-commit-applied 150 ms budget on fixture-0, timed from the `pointerup` event's own `timeStamp`) alone, after every parallel test has finished, because parallel workers compete for CPU and inflate wall-clock timings. The `webServer` runs `npm run data:fixture && npm run db:migrate && VITE_E2E=1 npm run build && wrangler dev --port 4173 --var ENVIRONMENT:development --var PUBLIC_DATASET_VERSION:fixture-0` (the override is honoured because `ENVIRONMENT` is `development`), plus the pins for sign-in, mail and the auth secret listed in [developing.md](developing.md), and `--var SIM_TAKEDOWN_TOKEN:e2e-takedown-token-00000000000000000000`: an obviously fake value of at least 32 characters that switches the operator takedown route on for `e2e/sim-control-plane.spec.ts`. The secret is unset in every deployed environment ([deploy.md](deploy.md)); no real value belongs in the repository. It never reuses an existing server (a stale build from another worktree would silently test the wrong code), so Playwright fails if port 4173 is busy: free it first.

The `VITE_E2E=1` build adds the brush hook `window.__sfhBrush` (`src/lib/brush/debug.ts`: `ops`, `lastStats`, `ready`, `chunks`, and `load(plan)`, which loads through the editor `+page.svelte` received via BrushEditor's `oneditor`) beside map-view's `window.__sfhMap`, and the `sfh-brush-commit` performance measure (pointer-up to commit applied; its start mark is set in the pointerup handler once the editor has taken the op, so it misses the time the event waited on the main thread, about 25 ms on an idle machine). It also marks hydration with `data-hydrated` on `<html>` (root layout): a test that needs a client navigation, so that its `page.route` sees the load's fetches instead of SSR, starts with `gotoHydrated(page, path)` (`e2e/helpers/sharing.ts`) before clicking a link. In that build the sim worker retries a failed chunk after 50/100/200 ms instead of 1/4/16 s, so `e2e/brush.spec.ts` sees the Retry chip within seconds. The 500-parcel and whole-city budgets are not e2e: `src/lib/sim/host.bench.spec.ts` (perf project, `npm run test:perf`) fails above 100 ms for a ≈500-parcel commit diff and 5,000 ms for a whole-city load.

On `/` the brush tools sit in the dock's Paint tab: from md it is open on the left; below md it is a sheet behind its handle, and choosing Paint or Erase folds it to the palette strip. `chooseTool(page, tool)` (`e2e/helpers/sharing.ts`) handles both, and `paintOnce` uses it. The brush status line is a pill in the notice stack (`data-testid="brush-status"`); a stroke's, a refusal's, an undo's or a redo's announcement is not in it but in the stroke chip (`data-testid="stroke-chip"`, "6 stories on 42 lots"), inside a polite status over the map's top (`data-testid="brush-announcement"`, mounted empty), so assert those there. The chip clears after 4 s (6 s for a refusal): assert it right after the action, and in a client spec use fake timers (`vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })` before render) to see it clear. The score is the header's (`data-testid="score-bar"`, "Room for {n} homes"; `settledNet` reads it), and the scoreboard is the dock's Results face (`getByRole('region', { name: 'Results' })`, `score-net` inside), opened by pressing the score. The E9 map goldens (`e2e/map.spec.ts-snapshots/`) capture the map root with the chrome over it (the dock, the status pill), so a change to that chrome means regenerating them on darwin with `--update-snapshots`. They allow 1% of pixels to differ, so a small change to the dock can pass unregenerated; plain `--update-snapshots` then writes nothing, and `--update-snapshots=all` rewrites them.

Auth specs (see [auth.md](auth.md)) use the e2e-only seams, which exist only in the `VITE_E2E=1` build running with `ENVIRONMENT=development`: `POST /api/e2e/login` signs a context in as an email, `GET /api/e2e/mail` returns the link of the latest password-reset, email-change or invite mail, and the `sfh_e2e_auth_methods` cookie switches sign-in methods on for one browser context. Specs use them through `loginAs`, `readMail` and `enableAuthMethods` in `e2e/helpers/auth.ts`. Server specs that need D1 use `src/lib/server/test/auth-db.ts`: `freshDb` (an in-memory D1 with the migrations applied), `makePlatform`, `seedUser`, `seedIdentity` and `grantEvent`.

Sim socket specs open sockets with `e2e/helpers/sim-socket.ts` (`openSimSocket`, `framesAtLeast`, `sendAndRead`, `closedCode`): the page's own `WebSocket`, frames kept in `window.__sfhSockets`, waits on frame counts and never on time. `e2e/sim-control-plane.spec.ts` covers registration, roster changes reaching open sockets, the fuse, the operator takedown and the rename against the real Worker; the rename's `appendAs` RPC cannot run in Node, so that spec is its only test. Specs that sign in as a given account use `Session` and `sessionOf` from `e2e/helpers/auth.ts`.

CI runs `npm run test:e2e -- --project=chromium --project=mobile --project=chromium-perf --project=mobile-perf`. Single spec: `npx playwright test e2e/data-route.spec.ts --project=chromium`.

## Fixture dataset

`e2e/fixtures/data/fixture-0/` is the one dataset every subsystem's e2e tests use; `npm run data:fixture` loads it into local R2. It is generated by `npm run pipeline -- fixture` (see [pipeline.md](pipeline.md)); do not edit it by hand. Its `README.md` is skipped by the loader.

## Accessibility

See [accessibility.md](accessibility.md).

`npm run signoff` runs the local gate with chreode: it merges `origin/main`, runs the checks the changes since the last signoff need (`chreode.config.ts`), pushes, and posts the `chreode/signoff` status that branch protection requires; `npm run signoff -- --dry-run` prints the plan without running it. See [deploy.md](deploy.md).

Signoff's `timing` step (`npx chreode timing-check`) fails when the branch adds a timing crutch to test code: a fixed wait (`waitForTimeout`, `sleep`), a raised timeout or retries above 1, or an unconditional skip. It reads only the branch's added lines, so legacy code never blocks. Fix the test with a readiness signal instead; the only exemptions are perf and bench tests by path and a reviewed `timing.allow` entry (with a `reason`) in `chreode.config.ts`.

## Flakes

Playwright runs with one retry and the vitest `client` project with `retry: 1`; the `server`
project stays at 0, since pure logic must not flake. A test that fails and then passes on retry
still passes, but chreode's reporters record it in `.chreode/flakes.jsonl`, and signoff files
or bumps one GitHub issue (label `flake`) per flaking test. From the third occurrence on, any signoff run that sees that flake again fails with the issue's URL, unless the issue is labelled `flake-snoozed`; runs that don't hit the flake are unaffected. Signoff's `burn-in` step
runs every test file changed on the branch five times with retries off (Playwright: `chromium`
only). Do not run repeat matrices by hand. Diagnose with the
[flake playbook](https://github.com/mindlace/chreode/blob/main/docs/flakes.md).
