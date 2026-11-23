# C5: the build order, checked

Read on the worktree at `440174b3` (code as on `8125e557`). Sources: the build graph
(`docs/superpowers/design/2026-11-22-1216-incremental-game-build-graph.md`), the design doc's
`sec-subsystems`, `sec-interfaces`, `sec-contracts`, `sec-write-sets`, `sec-global-constraints`,
and every unit spec's `sec-goal`, `sec-design*`, `sec-write-set*`, `sec-tests*`. "Spec X §id"
means `docs/superpowers/specs/2026-11-22-X-design.html#id`.

A note on the chain length: by unit count the longest chain stays 4 whatever is done to edges
2 to 9, because `contracts -> game-core -> {game-sim, game-save, funding-measures} -> closing`
cannot be shortened without either folding `contracts` into `game-core` or letting the game
units build against the stubs (finding M1). The effects below are therefore given as waits
removed (which upstream unit a consumer no longer waits for), not as a shorter count.

## The ten edges

| # | Edge | Verdict | What the consumer needs, and whether the producer delivers it only at its end | Effect |
|---|---|---|---|---|
| 1 | `contracts -> game-core` | **needed** | game-core fills the bodies of the files contracts creates (spec game-core §sec-today: every G function, `GameStore`, `openGame`, `provideGame`, `useGame` throw until then; game-core deletes `contracts.spec.ts` and `contracts.svelte.spec.ts`). Its root-layout script imports contracts' `createSaveSync` stub (S2) and `e2eOpen` (X1, working in contracts); its `e2e/game-core.spec.ts` uses contracts' `seedGame`/`newVisitor` (X1). The edge exists only because of the contracts-first method; contracts is small and delivers all of it at once, so no cut inside it helps. See M1: no unit but game-core consumes contracts before game-core lands, so folding contracts into game-core (or exploiting the stubs) is the only way to shorten this chain. | None as drawn. Folding contracts into game-core removes one serial hop from every game chain (4 units to 3). |
| 2 | `contracts -> finite-funding` | **removable** | Only a shared file: contracts adds one import and `dateMeasure` returning its policy (spec contracts §sec-write-set: "funding-presets.ts (one import, one function)"); finite-funding only drops `uncapped: false` at `src/lib/sim-page/funding-presets.ts:149` and "leaves [the stub] as it is" (spec finite-funding §sec-write-set). It never calls `dateMeasure`. The two hunks do not touch; git merges them. Replace the edge with "either order; the hunks are disjoint". | Nil in practice: finite-funding also waits for remove-lesscars (edge 3), which is far longer than contracts. |
| 3 | `remove-lesscars -> finite-funding` | **needed** (as drawn); **splittable** | Real overlap of generated files: both regenerate `e2e/fixtures/data/fixture-0/report.json` (56 lines name the calibration) and the pipeline's mini goldens (`golden/report.json`, `golden/manifest.json`; finite-funding adds `golden/scenarios/fzp/calibration.json`, `golden/derived/calibration-report.md`). If finite-funding went first, the less-cars build step, which runs the older engine on the calibration at build time (`pipeline/steps/build.ts:349-373`), would see the changed finance engine and its goldens (`golden/scenarios/lesscars/timeline.decoded.json`) would move too. The design's own reason (L1 "not touched by this row's owner": `funding.json`, `fzp-cal/**`, `calibration.ts`) keeps the source files apart; only the regenerated outputs collide. **Cut:** what downstream units wait for is F2 in `src/` (spec finite-funding §sec-design-pool) and the fixture regenerated from the *mini twin* (§sec-design-data-fixture). The live `funding.json` bounds, which need the builder to read nine primaries (impact-fee report, state programme reports, the Charter; §sec-design-data-*), feed only closing's level 2 check. A `finite-funding-live` unit (the live file's bounds after the primaries, the live-file tests, `finance-data.md`) could follow a `finite-funding-core` unit. Cost: schema 2 must hold the live file from the core unit on, so core either writes the research note's values before their primaries are read (the spec forbids that: "Before a value enters the file, the builder reads its primary") or keeps a temporary schema-1 path in `parseFundingFile`; the owner decides. | As drawn: none. With the core/live cut, pool-closing, funding-measures (and game-sim, if edge 6 stays) stop waiting on the primary-source research. |
| 4 | `finite-funding -> pool-closing` | **splittable** | Spec pool-closing §sec-today: "finite-funding lands first and removes uncapped; nothing below depends on that flag." Its engine tests (§sec-tests-engine) use added pools with once inflows on the mini city; today an uncapped pool has infinite `availableOf` (`src/lib/sim/world/funding/pools.ts:85-87`), so it is never short and never closes, and the engine work builds on today's code. What does need finite-funding: (a) files both write: `src/lib/sim/world/funding/test/fixtures.ts`, `src/lib/fzp/money-view.ts`, `money-view.spec.ts`, `MoneyResults.svelte`, `docs/dev/world-funding.md`, and the regenerated `funding/fixtures/funded-events-mini-seed1.json` (both specs regenerate it); (b) one test, "referee-ledger.spec.ts ... passes with closing on, on fixture-0's finite pools" (§sec-tests-other). **Cut:** `pool-closing-engine` (`closing.ts`, `columns.ts`, `serve.ts`, `system.ts`, `world/{types,world}.ts`, `score/**`, `runner/ensemble.spec.ts` and their tests) needs nothing and can start at once; a short tail after finite-funding: `closedLines` in `money-view.ts`, the `MoneyResults` line and its new spec, `runFunded`'s option in `test/fixtures.ts`, the funded golden, the referee-ledger run, the two docs. Cost: one more unit and merge, and a rebase of `serve.ts`'s neighbours onto finite-funding's `pools.ts`/`serve.spec.ts` changes. | pool-closing's engine work (the larger part, and the D1-critical one) leaves the `remove-lesscars -> finite-funding` chain; only its tail waits. |
| 5 | `finite-funding -> funding-measures` | **needed** | Real behaviour and heavy file overlap. funding-measures treats the federal pool as "a capped pool with one yearly inflow, its ceiling (F2)" and uses `isNoCeiling` and `LEGACY_UNCAPPED_DOLLARS`, which finite-funding adds (spec funding-measures §sec-design-federal); it counts once inflows from a `remaining` bound in a group's amount (F1, same section); its tests read the fixture's federal ceiling (§sec-tests-unit "the federal group's amount is its ceiling"; §sec-tests-e2e test 1a "as finite-funding leaves it"). Both write `funding-{presets,view,copy,edit}.ts`, `FundingGroupEditor`, `FundingPoolRow`, `FundingTab`, `src/lib/timeline/{pool-level,money-copy}.ts` and `e2e/sim-funding.spec.ts`. Running them together would conflict in most of those files. The core/live cut of edge 3 would let it start without the live-file research. | — (shortened only by the edge-3 cut). |
| 6 | `finite-funding -> game-sim` | **removable** | Only a shared file. The design says so itself: game-sim "Needs ... F2 (it writes two timeline files after finite-funding)" (`sec-subsystems`). Nothing in game-sim's spec uses F2 behaviour: its tests use `FakeTimelineWorker`, the e2e goal seam and fixture current law (spec game-sim §sec-tests). The overlap is about 25 lines: `TimelineMode.svelte:102, :653, :1493`, `SimDetails.svelte:58-59, :84, :236`, and `uncapped` lines in `TimelineMode.svelte.spec.ts`, `SimDetails.svelte.spec.ts`, `owner.spec.ts:67`, `Timeline.svelte.spec.ts:41`, plus import lines of `Inspector.svelte.spec.ts:19` (and `WhatEditor.svelte:32`, which game-sim does not edit). The `copy.ts` move does not collide: game-sim leaves `copy.ts` unchanged and writes `game-copy.ts` (spec game-sim §sec-write-set). Replace the edge with a merge rule: game-sim starts when game-core merges; whichever of the two merges second rebases those hunks (game-sim's `bar` prop sits next to `uncapped` in `SimDetails`' props, so expect one trivial conflict there). | Removes the chain `remove-lesscars -> finite-funding -> game-sim -> closing`. game-sim, likely the largest UI unit, starts when game-core lands instead of after remove-lesscars, finite-funding and its research. |
| 7 | `game-core -> game-sim` | **needed**; **splittable** | game-sim's tests run the real store and the real card: "TimelineMode.game.svelte.spec.ts, with ... a GameStore on memory storage", whose cases press the card's "Level up" (G5's `WinCard`), read `game.offer` and call `game.levelUp()` (G2); `GameSimHost` provides a real `GameStore`; the e2e seeds games the real store must keep (spec game-sim §sec-tests-component, §sec-tests-e2e). Against contracts' stubs every one throws. **Cut:** most of game-sim (add.ts, lens, parse4, server-codec, activity-view, Timeline/KindRow/SpanBar/Playhead/SimDetails/Inspector) needs only the pure rules `allowedAt`, `runs`, `playable`, `isGiven`, `standing`, `barOf`, `lockedLane`, `unlockText`. A `game-rules` slice of game-core (G1, G3, G4 and `copy.ts`: pure TypeScript) could land first; the store, `WinCard`, `LevelPanel` and the layout script follow. Cost: one more review loop for game-core, and game-sim's TimelineMode/route tests still wait for the second slice. | game-sim starts after the small pure slice instead of the whole of game-core. |
| 8 | `game-core -> funding-measures` | **removable** | The only use is `isGiven` inside `dateMeasure` (spec funding-measures §sec-design-dates; §sec-write-set "so isGiven ... is real when dateMeasure calls it"). `isGiven` is one expression (spec game-core §sec-design-allowed: `p.preset` is a string and `where.tag` is fund, baseline or terms). `dateMeasure` already returns its policy for an id that names no preset on offer, so a local check, `vi.mock('$lib/game/allowed')` in `funding-presets.spec.ts`, or contracts shipping `isGiven` working (as it ships `e2e.ts` working) replaces the edge. | Small: funding-measures already waits for finite-funding, which very likely lands after game-core. |
| 9 | `game-core -> game-save` | **needed**; **splittable** | The server half needs `parseGameSave` ("A body parseGameSave refuses is 422 invalid", S1), a stub in contracts. The browser half needs `useGame()` (`AccountOffer` reads `useGame().sync.account`, S3) and the real store and root-layout script for `e2e/game-save.spec.ts` ("seedGame(page, 2), load /, wait for the PUT", spec game-save §sec-tests-e2e). The sync's own tests use a fake store and need no game-core (§sec-tests-client). **Cut:** `game-save-server` (table, migration, `/api/game`, join via `onFuse`, deletion, `AUTH_METHODS`, `auth.md`) after remove-multiuser, with `parseGameSave` shipped working by contracts or mocked; `game-save-sync` (sync, account offer, e2e, `game-save.md`) after game-core and the server half. | The server half leaves the game-core chain; only the browser half waits for game-core. |
| 10 | `pool-closing`, `funding-measures`, `game-sim`, `game-save -> closing` | **needed**; **splittable** (the check and the dataset) | Each is needed for something in closing: the journey (`e2e/game-journey.spec.ts`) crosses game-shell, game-core, game-sim and game-save (spec closing §sec-design-journey); the level 2 check (G4, D1) needs finite-funding and pool-closing (closing is on by default); the doc prose and the sweep need everything, funding-measures included. But two pieces need much less: (a) **the dataset build and upload**: after remove-lesscars, `PATHS` is `pipeline`, `src/lib/{config.ts,data,generator,timelapse,sim/finance}` and two plan files (spec remove-lesscars §sec-design-version); after finite-funding no unit writes a hashed path (pool-closing writes `src/lib/sim/world`, funding-measures `src/lib/sim-page`, the game units `src/lib/game`, `timeline`, `shell`, routes). (b) **the level 2 check** needs only the dataset and pool-closing. The design warns the margin is thin and "stops holding if the state source turns out to end"; when it fails "the remedy is yours to choose" (design `tbl-reach` warning). Today the owner learns that after every unit has merged. **Cut:** a `reach-check` unit (scripts/level2-check.ts, the live build, the check, and the upload if it passes) right after finite-funding and pool-closing; closing keeps the journey, prose, sweep and signoff. | The owner's one open decision (D1 on the live data) surfaces after pool-closing, not at the very end. funding-measures, game-sim, game-save no longer gate the dataset. |

## Whole-graph findings

### Blocker

**B1. remove-lesscars cannot hand back green: `src/lib/shell/accent.spec.ts` reads the file it
deletes, and that spec is game-shell's.**
- remove-lesscars deletes `src/lib/fzp/TimeScrubber.svelte` (spec remove-lesscars
  §sec-write-delete).
- `src/lib/shell/accent.spec.ts:26` lists it in `SCANNED` (read in the loop at :245-250), and
  `:151-154` ("the time bar uses tokens, not hex") does `readFileSync` on it. Both throw
  ENOENT.
- The spec is in the server Vitest project (`vite.config.ts:57-60`: `src/**/*.{test,spec}.ts`),
  which remove-lesscars must run before it hands back (`sec-global-constraints`).
- `src/lib/shell/**` is game-shell's write set; neither remove-lesscars' graph row nor its
  spec names `accent.spec.ts`.
- game-shell edits the same file (`THEMED_FILES` gains `WinCard`/`LevelPanel`, spec game-shell
  §sec-write-set-files). game-shell starts after game-core, so it can run while
  remove-lesscars is still open.

Fix:
- Add `src/lib/shell/accent.spec.ts` (the `SCANNED` entry and the time-bar test only) to
  remove-lesscars' write set.
- Add the ordering note "written by remove-lesscars, then by game-shell", with an edge
  `remove-lesscars -> game-shell`. It costs nothing on the critical path: remove-lesscars has
  no needs, and game-shell already waits for contracts and game-core.

No other cross-unit break was found for the names the three removal units delete. The checks:
- **remove-lesscars:** every importer of the playback types, `filter-expr`, the `lc-*` tokens,
  `scenarios.lesscars` and the deleted pipeline modules is inside its write set. Every other
  hit is a comment or a route string: `layout.spec.ts:30`, `SiteHeader.svelte.spec.ts:188-258`,
  `handle-normalize.ts:20`.
- **remove-multiuser:** every importer of `sim-log`, `sim-store`, `sim-sync`, `sim-stream`,
  `members`, `server/{sims,invites,sim-object,operator,authz,event-log}`, `SIMS_COPY`,
  `MEMBERS_COPY`, `startFresh` and `worker-entry` is in its write set. That includes all 18
  e2e specs and helpers, `scripts/worker-entry*` and `package.json:13`. The root layout's load
  reads only `locals.user` and `locals.session` (`src/routes/+layout.server.ts`).
- **finite-funding:** every reader of `NO_LIMIT`, `uncappedPoolIds`, `perYear`, `ScaleLine`,
  `LevelPool` and `bySourceColumns` is in its file list. The other `uncapped` hits (zoning
  caps in `levers`, `goal.ts`, `scripts/bench-levers.ts`) are a different word.
- **pool-closing:** `MoneyView.closed` is required, but every `MoneyView` literal outside its
  files is cast (`pool-level.spec.ts:57`) or spread (`SimDetails.svelte.spec.ts:870`).
- **game-sim:** it drops the `remix` prop. `SimPageHost.svelte` (funding-measures' file)
  passes props by spread, and `app.d.ts`' `sfhSimRemix` stays until closing, so
  `/s/[id]/+page.svelte:53` still type-checks before game-shell lands.

### Major

**M1. The contracts-first step buys no parallelism.**
- No unit consumes contracts' stubs before game-core merges:
  - game-sim, game-shell, funding-measures and game-save all wait for G rows "as built by
    game-core" (graph rows 9-12).
  - finite-funding takes only a file from contracts (edge 2).
  - The removal units and mail-setup take nothing.
- So every game chain pays two serial hops (contracts, then game-core), and the stubs are
  never built against.

Fix, either of:
- Fold contracts' game files into game-core and keep only its doc work and X1 as a small
  unit. Every game chain drops to 3 units.
- Make contracts ship the pure rules working (G1, G3 and G4 are each a few lines; `isGiven`,
  `parseGameSave` and `defaultSaveName` are pure). Then funding-measures (edge 8), the
  game-save server half (edge 9) and most of game-sim (edge 7) build against contracts plus
  fakes, and wait for game-core only where they need the store or the card.

**M2. game-sim waits on remove-lesscars and finite-funding for about 25 lines of `uncapped`
(edge 6).**
- The design admits the dependency is a file overlap (`sec-subsystems`: "it writes two
  timeline files after finite-funding").
- Fix: drop the edge, and add a merge rule that the second of the two to merge rebases those
  hunks.

**M3. pool-closing's engine work waits on finite-funding although it does not use F2
(edge 4).**
- pool-closing is the unit D1 depends on: without closing, current law misses the goal by
  about 12,000 homes (`tbl-reach`).
- Fix: split it into an engine unit with no needs and a small tail after finite-funding.

**M4. The D1 check and the dataset upload sit behind every unit (edge 10).**
- No unit after finite-funding writes a hashed path.
- The check needs only the dataset and pool-closing.
- Fix: split a `reach-check` unit out of closing, after finite-funding and pool-closing. The
  owner then sees the thin-margin result (the state source's bound, spec finite-funding
  §sec-design-data-state: "expected to make current law miss the goal") while the game units
  are still building.

**M5. The live-file research holds up every F2 consumer (edge 3).**
- finite-funding's slow part is reading nine primaries for the live `funding.json`
  (§sec-design-data-*). Nothing downstream but closing needs it: the fixture is built from the
  mini twin (§sec-design-data-fixture), and pool-closing, funding-measures and game-sim test on
  the fixture.
- Fix: split it into core (schema 2, emission, twin, F2, fixture regeneration) and live (live
  bounds after their primaries).
- Cost: an owner decision on the "read the primary before a value enters the file" rule, or a
  temporary schema-1 path.

### Minor

**m1. game-core -> funding-measures is for `isGiven` only (edge 8).**
- Fix: replace it with a local check or `vi.mock`, or ship `isGiven` working in contracts.

**m2. No test exercises the real `dateMeasure` through `addPolicy` and `normalize` before
closing, and closing's journey does not either.**
- game-sim tests `addPolicy` and `redateMoved` against a spy on the M1 stub (spec game-sim
  §sec-tests-unit).
- funding-measures tests `dateMeasure` alone, and says the e2e of "a measure added at a later
  playhead month belongs with game-sim's calls" (spec funding-measures §sec-tests-e2e). That
  e2e is absent from game-sim's §sec-tests-e2e and from closing §sec-design-journey.
- Fix: give the e2e (add "A housing bond" at a later playhead month at level 5; its money
  arrives in that month) to whichever of game-sim and funding-measures merges second, or to
  closing.

**m3. game-sim's "Existing tests" claim is too strong.**
- It says no existing e2e spec changes (spec game-sim §sec-tests-existing). But game-sim
  removes `/sim`'s Remix hand-off and toast, which the remix tests in
  `e2e/{share-states,share-roundtrip,share-notices,sim-share,chrome-dark}.spec.ts` assert.
- game-shell rewrites those tests, and nobody runs e2e before closing, so nothing breaks in
  the build order. But if game-sim merges before game-shell, `main` carries red e2e until
  game-shell lands.
- Fix: one sentence in game-sim's spec naming game-shell as the unit that rewrites those
  tests.

**m4. Doc slips in the design's `sec-subsystems`.**
- finite-funding "Needs L1 ... and F1, F2", and pool-closing "Needs F2 and F3", list rows the
  units themselves produce. The graph is right (finite-funding needs L1 and the M1 stub file;
  pool-closing needs F2).
- game-shell's entry names "the root layout providing the store", which G2 gives to game-core.
  The game-shell spec changes nothing in `+layout.svelte` (§sec-write-set-files: "+layout.svelte
  ... need[s] no change"), yet `tbl-write-sets` still lists "src/routes/+layout.svelte outside
  the store's script" and `src/lib/paint/headline.ts` for it.
- Fix: correct the text in `sec-subsystems` and `tbl-write-sets`.

**m5. Write-cell drift between the graph and the design's `tbl-write-sets`. Both are
harmless.**
- remove-multiuser: the design lists `svelte.config.js`. The graph omits it, and the spec
  says it "is in the write set and is not changed".
- remove-lesscars: the graph lists `TimeScrubberHarness.svelte`, which the design row omits.
  The spec deletes it.

**m6. `chreode.config.ts:72` keeps naming `drizzle.sim.config.ts`, which remove-multiuser
deletes.**
- It is a match string only, so nothing fails. closing owns `chreode.config.ts`, but its
  sweep list should name this line.

**m7. Generated goldens with two writers.**
- `src/lib/sim/world/funding/fixtures/funded-events-mini-seed1.json` is regenerated by both
  finite-funding and pool-closing.
- `fixture-0/report.json` and the mini goldens are regenerated by both remove-lesscars and
  finite-funding.
- The edges keep each pair serial today. If edges 3 or 4 are cut as proposed, the rule must
  say "the later unit regenerates; never hand-merge".

### Checked and clean

**Implements cells.**
- Every `§id` named in the graph exists in its spec.
- Every `sec-design-*` section of every spec is named by its unit's row.

**Needs cells against the specs' ordering notes and `sec-subsystems`.**
- They agree, apart from m4.

**The pairs the brief asked about. No shared file, and no test that needs the other's merged
work.**
- game-sim and game-shell.
  - game-shell's e2e reads only today's `/sim` (spec game-shell §sec-tests-e2e). game-sim's
    e2e uses only its own card (§sec-tests-e2e).
  - The shared seam is `SimRoute`'s existing view-mode props.
- game-sim and funding-measures.
  - `addChoices` and `Inspector` call `fundingPresets(cal)`, whose new `start` argument is
    optional.
  - `levelSet`'s signature is unchanged.
  - game-sim mounts `PolicySummary` through its existing props.
- game-sim and pool-closing.
  - `MoneyRow.closed` is optional.
  - `chunk-log.ts` is untouched.
- funding-measures and pool-closing.
- game-save and game-shell, and game-save and game-sim.
  - `AccountOffer` reads `$app/state`, which the client tests stub
    (`vite.config.client-test.ts:30`).
  - Playwright pins `AUTH_METHODS:magic-link` (`playwright.config.ts:51`), so game-save's
    `wrangler.jsonc` change breaks no remove-multiuser spec.
- remove-multiuser and remove-lesscars.
- contracts beside remove-lesscars, remove-multiuser and mail-setup.
  - contracts deletes five docs. Links to them stay until closing, and no test checks
    doc-to-doc links. `scripts/docs-index.spec.ts` is kept true by contracts alone.
- finite-funding and game-core.

## Not examined

- Wall-clock size of each unit. The effects above name the waits that are removed, not
  hours.
- Whether the F2-src slice proposed under edge 3 leaves the less-cars build goldens
  byte-identical. That needs a pipeline run, which this check may not do.
- mail-setup's external steps (AWS, DNS) beyond their file boundary in `deploy.md`.
- Byte-identity of each spec's copied `sec-interfaces` and `sec-global-constraints` against
  the design doc.
- The closing spec beyond §sec-design-check, §sec-design-journey and its write set.
- No tests, type checks or builds were run. Every "would fail" above is read from the code
  and the Vitest project globs.
