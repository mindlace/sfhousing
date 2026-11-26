# Testing

## Vitest

`npm run test:unit` runs two projects (`vite.config.ts`):

- **server** (Node): `src/**/*.{test,spec}.ts` and `scripts/**/*.spec.ts`, excluding `*.svelte.{test,spec}.ts` and the wall-clock budgets below.
- **client** (browser via Playwright, `vite.config.client-test.ts`): component tests named `*.svelte.spec.ts`, importing `page` from `vitest/browser`, excluding `*.perf.svelte.spec.ts`.

`npm run test:perf` runs the wall-clock budgets, one file at a time (and then the e2e budgets, see below): project **perf** (Node: `src/**/*.bench.spec.ts` and `src/**/*.perf.spec.ts`, e.g. `src/lib/sim/host.bench.spec.ts`, `src/lib/sim/scenario/scenario.bench.spec.ts`, `src/lib/map/height/height.bench.spec.ts`) and project **client-perf** (browser, no retry: `src/**/*.perf.svelte.spec.ts`, the C5 frame budgets in `src/lib/map/generated-controller.perf.svelte.spec.ts` and `src/lib/map/timeline.perf.svelte.spec.ts`). Their limits sit a few milliseconds above an idle M5 Pro, so any other load on the machine (another agent's test run, a preview server) fails them: they are not in `test:unit` or signoff. Run `npm run test:perf` on an idle machine before merging a change that could move them (the scenario worker, the sim host, the generator, the map controllers, the height builds). A spec whose assertions are wall-clock budgets goes in a `*.bench.spec.ts` / `*.perf.spec.ts` / `*.perf.svelte.spec.ts` file; behaviour tests stay deterministic (count work, not milliseconds). The fixture checks inside the bench files (bench city size, every eligible lot built) run with them.

Test files are colocated with the code. `expect.requireAssertions` is on: every test must call `expect` (wrap `fc.assert` in `expect(() => ...).not.toThrow()`).

The client project needs the Playwright chromium browser: run `npx playwright install chromium` once (the one download beyond npm; `test:e2e` needs it too).

Cross-engine goldens (AC-11): `SFH_BROWSER=chromium|webkit|firefox` selects the client project's single browser (default `chromium`; anything else throws). Install the engines once with `npx playwright install webkit firefox`, then run for example `SFH_BROWSER=webkit npm run test:unit -- src/lib/timelapse/math.golden.svelte.spec.ts src/lib/timelapse/model.golden.svelte.spec.ts` (and `SFH_BROWSER=firefox` likewise). Vitest's own `--browser.name` only filters the configured instances, so it cannot switch engines here. The server project still runs in the same invocation; the engine run is the `client (webkit)` / `client (firefox)` lines.

In the client project, `$app/state` and `$app/navigation` are aliased to small stubs in `src/test-stubs/app/` (kept outside `$lib`) so route component specs (e.g. `src/routes/page.svelte.spec.ts`) can render pages: specs set `page.state` and read `replaceStateCalls`. Other `$app/*` modules and `$env/*` have no alias and still need `vi.mock(...)`. `src/lib/sharing/**` must not import `$app/*` at all; an ESLint `no-restricted-imports` rule enforces it so the stubs can't hide such an import.

The timeline debug snapshot (`window.__sfhMap.timelineSnapshot()`, `TimelineSnapshot` in `src/lib/map/timelapse/types.ts`) reports the mark layer: `marks` (records) and `marksShown` (marks `evalHalo` shows on the clock's day at the map's zoom, behind the zoom-14 gate; below it, one per square), both 0 until a page calls `setHalos`; `flagged` (installed slots with a flag), `projects` (installed slots with parts) and the feed's `cityMarkers` and `cityFlagged` ([map-interfaces.md](map-interfaces.md), "The citywide feed"). It also reports the bars' `barMode` (`'street'` until `setBarMode`) and `barsShown` (bars `evalBar` shows on the clock's day at the zoom at each anchor, in the map's view; [map-interfaces.md](map-interfaces.md), "Bar modes"). The shown counts read the camera through `TimelineDeps.debugView`, so they follow a `jumpTo` once the map is idle. In server specs, `makeFakeTimelineDeps()` records every `HaloLayer` construction (a `clone` included) in `haloLayers`, so a test counts rebuilds structurally; set `deps.view` (a `DebugView` with `zoom`, `centre` and a `clip` function) to give the snapshot a camera, and `viewReads` counts its reads. `src/lib/map/timelapse/halo-layer.gpu.svelte.spec.ts` renders the layer in a standalone `Deck` and checks marks against `evalHalo`.

Tapping a project on `/sim` in e2e: use `tapProject` (or `waitProjectAt` for several candidate lots) from `e2e/helpers/sharing.ts`. It waits until `window.__sfhMap.timelinePartAt(x, y)` (SimMap's own pick at a canvas point) answers the project, or one of its phases (`<id>:phase:<n>`), with the canvas topmost there, then taps once. Never retry a tap on a miss: a miss selects the lot's plan (on a phone its sheet covers the map) and a stray pick can open a neighbour's card over the next point, so a retried tap can never land. After moving the playhead, also wait for `timelineSnapshot().day` to equal `__sfhFzp.day` before probing.

GPU specs for deck layers (`*.gpu.svelte.spec.ts`, client project, real WebGL in Playwright Chromium): `src/lib/map/height/limits-layer.gpu.svelte.spec.ts` renders `HeightLimitsLayer` in a standalone `Deck` over a small canvas, and `limits-maplibre.gpu.svelte.spec.ts` renders it in an interleaved `MapLibreOverlay` before the first symbol layer, as `SimMap` does, over real MapLibre fill-extrusions. The interleaved pattern: build a tiny scene (`tinyLimits()` in `src/lib/map/height/test/fixtures.ts`), render it pitched with the layer and again without it, and compare chosen pixels (a box face tinted below the lid and untouched above it; open ground and ground hidden behind a tall box tinted), because a depth mistake against MapLibre's buildings only shows in a combined frame. Pixel assertions use the dark theme, where the light glaze shows most. The shared lot and scene builders for the height specs and the benches are in `src/lib/map/height/test/fixtures.ts`.

Single test: `npx vitest --run --project server path/to/file.spec.ts` (or `--project client`, `perf`, `client-perf`).

A coarse pointer in a client spec is a stubbed `window.matchMedia` (`vi.stubGlobal`, undone with `vi.unstubAllGlobals()` in `afterEach`), set before render: it matches `(pointer: coarse)` and not `(pointer: fine)`, and passes every other query (the dock reads `(min-width: 768px)`) to the real `matchMedia`. The Playwright `mobile` project (touch) is coarse. A touch laptop is the primary pointer fine with `(any-pointer: coarse)` true: `usePrimaryPointer().touch` reads `(any-pointer: coarse)` (Undo and Redo buttons show on it) and `.fine` the primary pointer (Paint's Shortcuts button on `/` shows on it), so it gets both. `stubPointer(primary, any?)` and `stubTouchLaptop()` in `src/lib/paint/test/pointer-stub.ts` stub it; `set` and `setAny` fire a `change` to see the buttons come and go (`BrushEditor.dock.svelte.spec.ts`, `SimPage.svelte.spec.ts`). In e2e, Chromium cannot emulate that pair (`hasTouch` makes the primary pointer coarse too), so `touchLaptop(page)` (`e2e/helpers/pointer.ts`) answers `(any-pointer: coarse)` in the page before it loads; a desktop spec that presses the header's Undo uses it. `/`'s keyboard undo needs a map for the brush controller: `src/routes/page.undo.svelte.spec.ts` mocks `SimMap` with the `FzpSimMapStub` double, which `page.svelte.spec.ts` cannot (it relies on the real map's no-WebGL fallback).

## Finance engine tests

The engine's funded starts ([finance-engine.md](finance-engine.md)) have their own golden, fixtures
and bench cases.

- **Finance golden.** `src/lib/sim/scenario/fixtures/golden-finance-seed1.json` holds the schedules
  and ledger of the mini city with `miniCalibrationWithRoutes()` and `miniFinance()`, its federal pool
  capped at 20,000,000 a year (`withFederalYearly`), for seeds 1 and 4 (horizon 2050-12-31), checked in Node (`simulate.finance.golden.test.ts`) and in the browser
  (`simulate.finance.golden.svelte.spec.ts`). Its builder is
  `fixtures/build-finance-golden.ts`, run deliberately (`env -C <worktree> node_modules/.bin/tsx
src/lib/sim/scenario/fixtures/build-finance-golden.ts`), never from CI: a changed file is an engine
  change to review. It does not replace `golden-seed1.json`, which has no `finance` and locks "no
  public money means no change".
- **Fixtures.** `fixtures/mini-finance.ts` (`miniFinance()`, `miniCalibrationWithRoutes()`: three
  pools, `m-city` yearly, `m-bank` with one inflow, and `federal` with a yearly
  `LEGACY_UNCAPPED_DOLLARS` that no test reaches; a certain affordable stack, a market loan, a
  market guarantee, one `off` span; `withFederalYearly` caps any finance's `federal` pool) and
  `fixtures/tiny-queue.ts` (`tinyQueue()`, a five-lot city with hand-set hazards and
  yields for exact queue cases; `tinyStack()`, a baseline-shaped affordable stack with an optional
  bond and optional federal inflows). Under the fallback award (rule 16 as amended, 2026-11-25) an
  application waits only when every pool of its bundle is short, so a test about the waiting line
  makes every pool short (empty, late or capped federal and state money), not one. All values are
  test values, not data. `test/finance-harness.ts` checks the ledger identities after every event
  (`checkLedger`) and collects a run (`runCollect`).
- **Old-engine comparisons retired.** The tolerance referee (`tolerance.referee.spec.ts`) and
  `score/money.spec.ts`'s "rule 12 against today's engine" compared the world engine with the old
  scenario engine. They were retired on 2026-11-25 by the owner's decision: the old engine no
  longer runs in production, and under the fallback award the two engines differ by construction
  (monthly against daily serving and re-application; [world-funding.md](world-funding.md),
  Tolerance referee). The old engine's own tests and goldens stay.
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

`npm run test:e2e` (`playwright.config.ts`, `e2e/`): projects `chromium` (desktop) and `mobile` (375x812, touch). The wall-clock budgets in `e2e/**/*.perf.spec.ts` (the 500-parcel pointer-up-to-display 150 ms budget, the desktop stroke's pointer-up-to-commit-applied 150 ms budget on fixture-0, timed from the `pointerup` event's own `timeStamp`, and the first month) are not in `test:e2e` or signoff: `npm run test:perf` runs them after the vitest budgets with `SFH_E2E_PERF=1`, which swaps in the `chromium-perf` and `mobile-perf` projects on one worker. Like the other budgets, run them on an idle machine. The `webServer` runs `npm run data:fixture && npm run db:migrate && VITE_E2E=1 npm run build && wrangler dev --port 4173 --var ENVIRONMENT:development --var PUBLIC_DATASET_VERSION:fixture-0` (the override is honoured because `ENVIRONMENT` is `development`), plus the pins for sign-in, mail, the auth secret and the auth URL listed in [developing.md](developing.md). It never reuses an existing server (a stale build from another worktree would silently test the wrong code), so Playwright fails if port 4173 is busy: free it first.

The `VITE_E2E=1` build adds the brush hook `window.__sfhBrush` (`src/lib/brush/debug.ts`: `ops`, `lastStats`, `ready`, `chunks`, and `load(plan)`, which loads through the editor `+page.svelte` received via BrushEditor's `oneditor`) beside map-view's `window.__sfhMap`, and the `sfh-brush-commit` performance measure (pointer-up to commit applied; its start mark is set in the pointerup handler once the editor has taken the op, so it misses the time the event waited on the main thread, about 25 ms on an idle machine). It also marks hydration with `data-hydrated` on `<html>` (root layout): a test that needs a client navigation, so that its `page.route` sees the load's fetches instead of SSR, starts with `gotoHydrated(page, path)` (`e2e/helpers/sharing.ts`) before clicking a link. The header's Menu button has no handler before hydration, so a tap then is lost: specs open the Menu only through `openHeaderMenu(page)` (`e2e/helpers/sharing.ts`), which waits for the mark first. In that build the sim worker retries a failed chunk after 50/100/200 ms instead of 1/4/16 s, so `e2e/brush.spec.ts` sees the Retry chip within seconds. The 500-parcel and whole-city budgets are not e2e: `src/lib/sim/host.bench.spec.ts` (perf project, `npm run test:perf`) fails above 100 ms for a ≈500-parcel commit diff and 5,000 ms for a whole-city load.

On `/` the brush tools sit in the dock's Paint tab: from md it is open on the left; below md it is a sheet behind its handle, and choosing Paint or Erase folds it to the palette strip. `chooseTool(page, tool)` (`e2e/helpers/sharing.ts`) handles both, and `paintOnce` uses it. The brush status line is a pill in the notice stack (`data-testid="brush-status"`); a stroke's, a refusal's, an undo's or a redo's announcement is not in it but in the stroke chip (`data-testid="stroke-chip"`, "6 stories on 42 lots"), inside a polite status over the map's top (`data-testid="brush-announcement"`, mounted empty), so assert those there. The chip clears after 4 s (6 s for a refusal): assert it right after the action, and in a client spec use fake timers (`vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })` before render) to see it clear. The score is the header's (`data-testid="score-bar"`, "Room for {n} homes"; `settledNet` reads it), and the detail is the dock's Details face (`getByRole('region', { name: 'Details' })`, `PaintDetails`; its "Goal" meter carries the net as `aria-valuenow`), opened by pressing the score. The E9 map goldens (`e2e/map.spec.ts-snapshots/`) capture the map root with the chrome over it (the dock, the status pill), so a change to that chrome means regenerating them on darwin with `--update-snapshots`. They allow 1% of pixels to differ, so a small change to the dock can pass unregenerated; plain `--update-snapshots` then writes nothing, and `--update-snapshots=all` rewrites them.

Auth specs (see [auth.md](auth.md)) use the e2e-only seams, which exist only in the `VITE_E2E=1` build running with `ENVIRONMENT=development`: `POST /api/e2e/login` signs a context in as an email, `GET /api/e2e/mail` returns the link of the latest mail of a kind (`password-reset`, `change-email-approve`, `change-email-verify`), and the `sfh_e2e_auth_methods` cookie switches sign-in methods on for one browser context. Specs use them through `loginAs`, `readMail` and `enableAuthMethods` in `e2e/helpers/auth.ts`; a spec that reads its session uses `Session` and `sessionOf` there. Server specs that need D1 use `src/lib/server/test/auth-db.ts`: `freshDb` (an in-memory D1 with the migrations applied), `makePlatform`, `seedUser` and `seedIdentity`.

`e2e/game-journey.spec.ts` is the one spec that plays the game across pages, from a new visitor's first win to a saved game at level 3.

Signoff's `test:e2e` step runs `npm run test:e2e`, every project; no workflow runs Playwright. Single spec: `npx playwright test e2e/data-route.spec.ts --project=chromium`.

## The game in tests

The game's rules are in [game.md](game.md), saved games in [game-save.md](game-save.md).

- With `VITE_E2E=1` a page with no `sfhousing:e2e:game` key (`E2E_GAME_KEY`, `src/lib/game/e2e.ts`) gets the open game: level 5, every control, nothing stored. A spec that calls neither helper below sees every control.
- `e2e/helpers/game.ts`, each called before the page loads: `seedGame(page, level)` switches the real game on and stores a game at that level with bars any result beats (`SEED_BAR_DAY`); `newVisitor(page)` switches the real game on with nothing stored; `seedGoalAmount(page, amount)` sets the goal's amount (`sfhousing:e2e:goal`). A spec that plays a level to a win calls `seedGoalAmount`: the fixture cannot reach 82,069 homes.
- A component test with no provider gets a level 5 store from `useGame()` (`openGame()`, `src/lib/game/store.svelte.ts`).

## The level 2 check

`npx tsx scripts/level2-check.ts <datasetDir> [--amount <homes>] [--cars on|off]` runs the empty policy document (current law) through the timeline host on a built dataset directory, over the whole window, and reads the goal. It prints three lines: `Dataset <v>`, `Goal: <amount> homes by <month>` (82,069 unless `--amount` gives another), then `Reached: <month>, N months before the window's end` or `Missed: N homes by <month>, M short`, then `Filled in N s (cars on|off)`. Both worlds run the dataset's car system unless `--cars off` (no car system at all, so the on/off difference is the parking link alone). Exit 0 when current law reaches the goal, 1 when it misses, 2 when the check could not run (one stderr line, `level2-check: {reason}`, nothing on stdout). Every dataset upload is preceded by it ([pipeline.md](pipeline.md), "Finishing a branch that changes the dataset"). Its test, `scripts/level2-check.spec.ts`, runs it on `fixture-0` and reads the result at several amounts (`readLevel2(run, amount)`).

## The money monotonicity check

`npx tsx scripts/money-monotone.ts <datasetDir> | --version <v> [--from <origin>] [--presets a,b] [--out <file.jsonl>] [--cars on|off]` checks that more public money never builds fewer homes. It opens one timeline host on the dataset (a built directory, or a published version fetched from `--from`, default production; `scripts/lib/engine-runner.ts`) and runs every subset of the funding presets the data offers (`fundingPresets(cal)`, those `available` that add money, so not `state-off` or `federal-credits-off`, which withdraw a pool; 2^n sets: 64 for the six today) as a policy document that adds each preset from month 1 of the window, prerequisites ignored. `--presets` limits the check to those ids (kept in offered order); `--cars off` runs without the car system, as level2-check does (default on). An edge is a set S and a preset p not in S. Three readings are taken at the December of 2035, 2040, 2045, 2055 and 2060: `net` (completed net homes), `funded` (funded homes) and `affordable` (very low, low and moderate income homes). A reading that falls by more than `MONOTONE_TOLERANCE` (5) homes from S to S + p is an offender. `--out` writes one JSON line per set (`set`, `secs`, `at` by year).

Output: `Dataset <v>`, `Presets: a, b, ...`, one `Drop: net Dec 2045, [a] + b: 100 -> 94 (-6)` line per offender, then `Monotone: no reading drops more than 5 homes` or `Not monotone: N drops on M edges`. The run's wall time goes to stderr. Exit 0 when monotone, 1 on an offender, 2 when the check could not run (one stderr line, `money-monotone: {reason}`, nothing on stdout). Its test, `scripts/money-monotone.spec.ts`, runs the sets, the edges and the readings on `fixture-0`. The dataset-free property test in `src/lib/sim/scenario/funding.spec.ts` is the gate signoff enforces; this command is the dataset-level check, run by hand ([pipeline.md](pipeline.md), step 3b, and "Changes on the funding paths"). For now it is a report, not a gate: on `2026-11-25-76c90397` it prints `Not monotone: 132 drops on 44 edges`, and the cause and its follow-up are in [finance-data.md](finance-data.md), "What current law builds against the check".

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
