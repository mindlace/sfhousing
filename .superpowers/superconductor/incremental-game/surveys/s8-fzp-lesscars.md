# S8 survey: /fzp, /lesscars and what they share

Mechanical census. V = verified in code (path:line); I = inferred (source named). Importer data
for sections 2, 3, 12 comes from a script that resolved every `import ... from`, `export ... from`,
side-effect import, `import()` and `new URL()` specifier (`$lib/...` and relative) in `src`,
`pipeline`, `e2e`, `scripts` and the repo-root `*.ts`. Not examined by it: imports spelled any other
way (string-built paths, `import.meta.glob`), non-TS/Svelte files. Groups used below:
LC = `src/lib/{lesscars,sim/lesscars,data/lesscars}`, `src/routes/lesscars`;
SIM = `src/lib/{sim-page,timeline,goal,dock,about,scoreboard,map}`, `src/lib/sim/*` (not `sim/lesscars`), routes `sim`, `s/[id]`;
PAINT = `src/routes/+page*`, `src/routes/p/**`; PIPE = `pipeline/`; tests = spec/test files, `test/`, `fixtures/`, Harness components, `e2e/`.

## 0. Headline facts

1. Nothing in `src` links to `/lesscars` (V: grep, section 1/11). The page is reachable by typing the URL only. `docs/dev/lesscars.md:892` says the same.
2. `/fzp` is a 307 redirect to `/sim` (V `src/routes/fzp/+page.ts:7-12`). No page, no components of its own.
3. `src/lib/fzp/` is mostly NOT lesscars code: of 23 non-test modules, 21 are imported by `/sim` code (V, section 2); only `TimeScrubber.svelte` and `high-water.svelte.ts` have `/lesscars` as their only non-test importer. The directory is the shared kernel of `/sim`.
4. The step engine (`src/lib/sim/world`) has no lesscars input (V, section 4). The older scenario engine (`src/lib/sim/scenario/{engine,funded,input,types}.ts`) has `regimes` and `reservedFrom` inputs that only the lesscars pipeline sets in production code (V), but the step-engine referee tests use `regimes` as the reference oracle (V `src/lib/sim/world/frames.referee.spec.ts:64,105,167` via `world/test/timeline.ts:112,125`).
5. `/lesscars` runs no engine in the browser. The playback host decodes a precomputed `timeline.bin` ("It simulates nothing", V `src/lib/sim/lesscars/playback-host.ts:7`). The engine runs at dataset-build time (V `pipeline/lib/lesscars/runs.ts:336,339,448`).
6. The lesscars build step runs inside every `build` (and so `all`), unconditionally; the live plan file exists, so a live build writes `scenarios/lesscars/*` (V section 6).
7. The freeway-land catalog (`pipeline/enrichment/lesscars/freeway-land.json`, 559 parcels in 11 segments, V by reading the JSON) is applied to the shared scenario step: those parcels are ineligible in `scenarios/fzp/parcels.bin`, so it changes `/sim` and Paint-adjacent numbers (V `pipeline/steps/scenario.ts:687-786,999`, `pipeline/lib/scenario-eligibility.ts:21-23`; doc `docs/dev/lesscars.md:552`). It also feeds `55_road_lots.sql` (`rl_catalog`).
8. `datasf-streets` / `src_streets` is read by the road-like-lot SQL (`pipeline/sql/55_road_lots.sql:114,135,141`) and by `pipeline/steps/boxes.ts:76`, not only by lesscars (V).
9. The lesscars playback host is compiled into the one shared sim Worker (V `src/lib/sim/worker.ts:4,47-56`; router `src/lib/sim/router.ts:4-5,22`), and its protocol types are imported by the shared scenario types (V `src/lib/sim/scenario/types.ts:35`).
10. The base map style (shared by Paint, /sim, /lesscars) carries a `roads_lc` clone of every `roads` layer, `${id}__lc`, for every consumer (V `src/lib/map/style.ts:197-216`); the palette carries 12 `lc-*` tokens (V `src/lib/map/palette.ts:43-54`).
11. Handle words `lesscars` and `fzp` are reserved (V `src/lib/server/user-store/handle-normalize.ts:20`, spec `handle-normalize.spec.ts:63`).

## 1. `src/routes/fzp/**`, `src/routes/lesscars/**`, and every link to them

### Files (V)

| File | Lines | What it does |
|---|---|---|
| `src/routes/fzp/+page.ts` | 12 | `load` copies `url.searchParams`, deletes `start`, `redirect(307, '/sim' + query)` (lines 7-12) |
| `src/routes/fzp/page.spec.ts` | 39 | tests the redirect (query kept, `start` dropped, bare `/fzp`) |
| `src/routes/lesscars/+page.ts` | 15 | universal `load`: `await parent()` for `datasetVersion`, then `loadLessCars(datasetVersion, fetch)` (lines 12-15); exports `LessCarsRouteData` (line 10) |
| `src/routes/lesscars/+page.svelte` | 36 | title "Fewer cars"; `sr-only` h1; `ready` renders `<LessCarsMode data={data.data}/>` under `{#key data.data.manifest}` (line 16); `no-scenario` renders a message plus `<a href="/sim">` (lines 21-25); `error` renders a Retry calling `invalidateAll()` (lines 27-32). Only link emitted by lesscars code to another page is this `/sim` link |
| `src/routes/lesscars/page.spec.ts` | 45 | the load's states against fixture fetch |
| `src/routes/lesscars/page.svelte.spec.ts` | 31 | no-scenario and error states |

No `+layout`, `+server`, or `+page.server` under either dir (V: `find` listing).

### Inbound references to `/lesscars` and `/fzp` (V unless marked)

Real navigation (none from product UI):
- `src/routes/fzp/+page.ts:11` redirects to `/sim` (outbound).
- `src/routes/lesscars/+page.svelte:23` links to `/sim` (outbound).
- No `href="/lesscars"` or `href="/fzp"` in any non-test `src` file (V: `grep -rniE "lesscars|less-cars|fewer.cars" src` outside the owned dirs returns only the lines in this section and section 11). The header's links are `/` (Paint), `/sim` (Simulate), `/account` or `/signin`, `/about` (V `src/lib/shell/SiteHeader.svelte:122,127,215,223`).

Route-id / string references in shared code:
- `src/lib/shell/layout.ts:6` `routeId === '/lesscars'` in `isFullHeightRoute` (so lesscars gets no footer and fills the viewport). `/fzp` is not full-height (spec `layout.spec.ts:24-26`).
- `src/lib/shell/layout.spec.ts:24-30`; `src/lib/shell/SiteHeader.svelte.spec.ts:188,191,199,258` (asserts no `a[href="/lesscars"]`, no step current on `/lesscars`).
- `src/lib/shell/SiteHeader.svelte:7` and `src/lib/shell/header-actions.svelte.ts:10`: comments naming `/lesscars` as a page that pins an item.
- `src/lib/server/user-store/handle-normalize.ts:20` (`'lesscars'` in the reserved list); `handle-normalize.spec.ts:63` (`'lesscars'`, `'fzp'`).
- `src/lib/test/` stubs: `src/lib/fzp/test/FzpSimMapStub.svelte` (testid `fzp-sim-map-stub`) is used by lesscars and `/sim` and Paint tests (section 2).

Comments only (no behaviour): `src/lib/map/filter-expr.ts:1`, `src/lib/map/SimMap.svelte:1547`, `src/lib/map/palette.ts:56`, `src/lib/map/palette.spec.ts:341`, `src/lib/map/style.ts:197-200`, `src/lib/sim/router.ts:2`, `src/lib/data/manifest.ts:69`, `src/lib/timeline/copy.ts:3`, `src/lib/timeline/copy.spec.ts:1`, and `/fzp` comments in `src/lib/sim/scenario/{score,load,types,scenario-host}.ts` and `scenario/*.spec.ts` ("absent levers = /fzp").

e2e:
- `e2e/sim.spec.ts:237-238` `page.goto('/fzp')` expects landing on `/sim`.
- `e2e/pages-a11y.spec.ts:16` `MAP = new Set(['/', '/fzp'])` (`/fzp` follows the redirect, so the test actually runs against `/sim`) (I: `page.goto` follows redirects).
- `e2e/targets.spec.ts:507` `page.goto('/lesscars')` ("/lesscars at rest").
- `e2e/sim-citywide.spec.ts:127` `gotoHydrated(page, '/lesscars')` ("/lesscars keeps street bars and draws no city feed").
- `e2e/lesscars.spec.ts:316` `gotoHydrated(page, '/lesscars')`, `:633` `clientNavigate(page, '/lesscars')`, `:634,675` `toHaveURL(/\/lesscars$/)`.

Docs (V by grep; line numbers are the first match per file): `CLAUDE.md:42,49`; `docs/dev/lesscars.md` (throughout, e.g. 1, 3, 583, 877, 889-912); `docs/dev/fzp-mode.md:1-17,49`; `docs/dev/road-lots.md:341,386,465,504-513,564`; `docs/dev/pipeline.md:5,40,72`; `docs/dev/finance-score.md:262-272`; `docs/dev/sim-levers.md:20,96,235`; `docs/dev/market.md:187,234-235`; `docs/dev/finance-engine.md:500`; `docs/dev/map-interfaces.md:64,92-94,124,150`; `docs/dev/about.md:172`; `docs/dev/developing.md:79`; `docs/dev/timeline-ui.md:17,40`; `docs/dev/ui-parts.md:107`; `docs/dev/sim-funding.md:134`, `docs/dev/sim-page.md:3`. `README.md`: no mention (V grep). `CHANGELOG.md`: 5 lines (history; I). ~110 files under `docs/superpowers/{specs,plans,design,research}` mention lesscars or `/fzp` (V `grep -rli`; list in appendix note, not itemised).
- `CLAUDE.md` indexes both docs; `scripts/docs-index.spec.ts:8-16` fails if any `docs/dev/*.md` is not linked from `CLAUDE.md` (V). So removing `lesscars.md`, `fzp-mode.md` or `road-lots.md` requires editing `CLAUDE.md` in the same change.

## 2. `src/lib/fzp/`, module by module

Non-test modules (23 `.ts`/`.svelte`), lines, exports, importers (non-test, excluding `lib/fzp` itself unless noted). "tests" = spec/fixture/Harness importers. All importer lists are V.

| Module | Lines | Exports (main) | /sim | /lesscars | Paint | Importers |
|---|---:|---|:-:|:-:|:-:|---|
| `MoneyResults.svelte` | 244 | component | yes | no | no | SIM `timeline/SimDetails.svelte:23` |
| `ProjectCardPanel.svelte` | 254 | component | yes | no | no | SIM `timeline/TimelineMode.svelte:104` |
| `ProjectTooltip.svelte` | 69 | component | yes | no | no | SIM `timeline/TimelineMode.svelte:105` |
| `ProvenanceBody.svelte` | 227 | component | yes | no | no | SIM `about/AboutAssumptions.svelte:11` |
| `TimeScrubber.svelte` | 392 | component | no | yes | no | LC `lesscars/LessCarsMode.svelte:16`; tests `TimeScrubberHarness.svelte` |
| `card-area-watch.ts` | 58 | `BR_BLOCK`, `CardAreaTargets`, `watchCardArea` | yes | no | no | SIM `timeline/TimelineMode.svelte:99` |
| `card-place.ts` | 61 | `CardArea`, `cardArea`, `cardPlacement` | yes | no | no | SIM `timeline/TimelineMode.svelte:100` |
| `card.ts` | 357 | `ChanceTable`, `CardChance`, `CardCalibration`, `SIMULATED_DISCLAIMER`, `CHANCE_EXPLANATION`, `RESEARCH_NOTE`, `cardStatus`, `statusText`, `storiesText`, `sizeLine`, `revisionLines`, `chanceLine`, `chanceProvenance`, `timelineRows`, `massingNote`, `phaseLine`, `dataNotes`, `SOURCE_DATASETS`, `sourceLinks`, `CardFunding`, `cardFunding`, `fundingLine` | yes | no | no | SIM `sim-page/funding-view.ts:64`, `timeline/TimelineMode.svelte:98`, `timeline/owner.ts:5`; FZP `ProjectCardPanel.svelte:12`, `ProjectTooltip.svelte:12`, `provenance.ts:41` |
| `chart.ts` | 51 | `COLORS`, `SERIES_NAME`, `niceCeil`, `MEASURE_SERIES` | yes | yes | no | SIM `timeline/ChartLegend.svelte:13`, `ChartRow.svelte:25`, `chart-model.ts:3`; LC `lesscars/summary-view.ts:8`; FZP `provenance.ts:42` |
| `copy.ts` | 2 | `CALCULATING` | yes | no | no | SIM `sim-page/policy.ts:11`, `timeline/SimActivity.svelte:11`; FZP `score-view.ts:13` |
| `debug.ts` | 87 | `SfhFzpDebug`, `installFzpDebug` (window `__sfhFzp`) | yes | no | no | SIM `timeline/TimelineMode.svelte:101`; tests: 16 e2e files and helper `e2e/helpers/run.ts:5` |
| `format.ts` | 111 | `formatMonthYear`, `monthYearLabels`, `formatShortMonthYear`, `formatDate`, `formatCardDate`, `formatChance`, `formatDollars`, `formatDollarsExact`, `formatSourcePercent`, `formatOddsChange` | yes | yes | no | SIM 14 files (`about/copy.ts:5`, `goal/goal.ts:6`, `sim-page/FundingPoolRow.svelte:18`, `funding-copy.ts:3`, `funding-view.ts:28`, `timeline/{Playhead.svelte:14,SimActivity.svelte:10,SimDetails.svelte:21,activity-view.ts:6,copy.ts:6,details.ts:2,outcome.ts:3,playhead.ts:3,session4.ts:9}`); LC `lesscars/{LessCarsCard.svelte:11,TimelineDialog.svelte:9,timeline-view.ts:6}` |
| `high-water.svelte.ts` | 27 | `HighWater` | no | yes | no | LC `lesscars/LessCarsMode.svelte:13` |
| `labels.ts` | 65 | `enteredLabel`, `inStageLabel`, `masterEnteredLabel`, `PATHWAY_LABEL`, `EXIT_LABEL`, `TIER_LABEL` | yes (transitively) | no (direct) | no | FZP only: `ProjectCardPanel.svelte:30`, `ProjectTooltip.svelte:13`, `ProvenanceBody.svelte:13`, `card.ts:13`, `provenance.ts:50`; tests incl. `lesscars/{EvidenceDialog.svelte.spec,evidence.spec}.ts` |
| `load.ts` | 27 | `fetchCalibration`, `reloadScenario` | yes | yes | no | SIM `about/AboutAssumptions.svelte:12`, `sim-page/SimRoute.svelte:8`, `sim-page/load.ts:5`; LC `lesscars/load.ts:13` |
| `market-view.ts` | 44 | `MARKET_INTRO_SENTENCE`, `MARKET_HOLD_SENTENCE`, `MARKET_FUNDING_SENTENCE4`, `marketShare`, `marketSentence` | yes (transitively) | no | no | FZP only: `money-view.ts:32`, `provenance.ts:44` |
| `money-view.ts` | 279 | `plainSources`, `MoneyAt`, `TiersAt`, `moneyFigureAt`, `moneyAt`, `tiersAt`, `TIER_NAME`, `cityLine`, `allLine`, `lostGrantsLine`, `fundedLine`, `displacementLine`, `owedLines`, `limitLines`, `SourceColumn`, `COLUMN_NAME`, `bySourceColumns`, `uncappedPoolIds`, `TIERS_*_SENTENCE`, `affordableLine`, `marketText` | yes | no | no | SIM `timeline/TimelineMode.svelte:102`, `timeline/activity-view.ts:7`; FZP `MoneyResults.svelte:17` |
| `playback.ts` | 37 | `SPEED_DAYS`, `DEFAULT_SPEED`, `SPEED_NAME`, `FRAME_CLAMP_MS`, `advance` | yes | yes | no | SIM `timeline/Playhead.svelte:15`, `TimelineMode.svelte:103`, `copy.ts:7`; LC `LessCarsMode.svelte:14`; FZP `TimeScrubber.svelte:14` |
| `provenance.ts` | 648 | `ProvEntry`, `ProvSection`, ~14 `*_SENTENCE` consts, `QUALITY_*`, `lossSentence`, `provenanceLines`, `transitionShares`, `provenanceSections`, `modelSections`, `qualityRows`, `loadProjectsFile` | yes | yes | no | SIM `about/AboutAssumptions.svelte:13`, `about/AboutDialog.svelte:31`, `timeline/TimelineMode.svelte:106`; LC `lesscars/evidence.ts:4`; FZP `ProvenanceBody.svelte:14` |
| `score-view.ts` | 62 | `deadlineIndex`, `scoreAt`, `fromPolicyText`, `vsFzpText`, `builtTowardGoalText` | yes | no | no | SIM `scoreboard/HeaderScore.svelte:16`, `timeline/SimDetails.svelte:26`, `TimelineHeaderScore.svelte:11`, `results.ts:2` |
| `summary-request.ts` | 133 | `SummaryQuery`, `SummaryState`, `SUMMARY_COPY`, `SummaryRequester` | yes | no | no | SIM `timeline/TimelineMode.svelte:108`; FZP `ProjectCardPanel.svelte:31`, `ProjectTooltip.svelte:14` |
| `time.ts` | 57 | `dayFromUtc`, `utcParts`, `HORIZON`, `monthStart`, `nextMonth`, `prevMonth`, `shiftYear`, `monthIndex` | yes | yes | no | SIM 11 files (`goal/goal.ts:7`, `sim-page/{FundingTab.svelte:29,PolicySummary.svelte:15,funding-view.ts:34}`, `timeline/{Playhead.svelte:16,SimDetails.svelte:22,TimelineMode.svelte:109,axis.ts:2,copy.ts:8,details.ts:3,playhead.ts:4}`); LC `lesscars/{LessCarsMode.svelte:15,summary-view.ts:9,timeline-view.ts:8}`; tests 44 incl. `pipeline/test/fixture-funding.test.ts` |
| `types.ts` | 49 | `FzpPhase`, `Speed`, `ScoreAt`, `CardStatus`, `Marker` | yes | yes | no | SIM `timeline/{Playhead.svelte:17,SimDetails.svelte:27,TimelineMode.svelte:110,copy.ts:9,results.ts:3}`; LC `lesscars/{LessCarsMode.svelte:17,timeline-view.ts:8}` |

Result: used by `/sim` = 21 of 23 (yes, directly or transitively); modules used by `/lesscars` and not `/sim` = `TimeScrubber.svelte`, `high-water.svelte.ts` (2). Modules used by both: `chart`, `format`, `load`, `playback`, `provenance`, `time`, `types` (7). No module is dead. No module has a PAINT importer (V: the script's PAINT group and every non-SIM/non-LC group were empty for `src/lib/fzp`).
Corrections to the user's grouping (a)-(d): (a) lesscars-only = `TimeScrubber.svelte`, `high-water.svelte.ts`; (d) dead = none. `labels.ts` and `market-view.ts` are reached by `/sim` and `/lesscars` only through `provenance.ts`/`card.ts` (V importer lists above).

Test-support files inside `src/lib/fzp/` that other suites depend on (V importer lists):
- `src/lib/fzp/test/FzpSimMapStub.svelte` (18) and `test/sim-map-stub.ts` (182): used by Paint tests (`src/routes/page.undo.svelte.spec.ts`, `page.rest-text.svelte.spec.ts`, `src/routes/p/[id]/page.view.svelte.spec.ts`, `src/lib/brush/BrushEditor.dock.svelte.spec.ts`), `/sim` tests (`src/routes/sim/page.svelte.spec.ts`, `src/routes/s/[id]/page.view.svelte.spec.ts`, `src/lib/timeline/{TimelineMode.svelte.spec,rest-text.svelte.spec}.ts`, `src/lib/sim-page/SimPage.svelte.spec.ts`) and `lesscars/LessCarsMode.svelte.spec.ts`.
- `src/lib/fzp/fixtures/{calibration,cards,market,money,projects,timeline-score}.ts`: used by about, sim-page, timeline, routes/sim, routes/s tests (e.g. `fixtures/calibration.ts` imported by 17 spec/support files incl. `src/lib/server/test/sim-docs.ts`).
- `src/lib/fzp/TimeScrubberHarness.svelte` (55): only `TimeScrubber.svelte.spec.ts`.

Specs inside `src/lib/fzp/` (all V): `chart`, `labels`, `market-view`, `score-view`, `format`, `summary-request`, `high-water.svelte`, `card`, `card-area-watch.svelte`, `playback`, `time`, `ProjectCardPanel.svelte`, `ProjectTooltip.svelte`, `TimeScrubber.svelte`, `card-place`, `provenance`, `money-view`, `fixtures/timeline-score` `.spec.ts`.

## 3. Same table for the other directories

### `src/lib/lesscars/` (18 non-test modules; V)

| Module | Lines | /sim | /lesscars | Paint | Importers |
|---|---:|:-:|:-:|:-:|---|
| `LessCarsMode.svelte` | 433 | no | yes | no | `routes/lesscars/+page.svelte:5`; test host `test/LessCarsModeHost.svelte` |
| `DetailsPanel.svelte` | 167 | no | yes | no | `LessCarsMode.svelte:34` |
| `EvidenceDialog.svelte` | 98 | no | yes | no | `LessCarsMode.svelte:36` |
| `ExtraChart.svelte` | 108 | no | yes | no | `DetailsPanel.svelte:21` |
| `HeadlineBar.svelte` | 91 | no | yes | no | `LessCarsMode.svelte:46` |
| `LessCarsCard.svelte` | 91 | no | yes | no | `LessCarsMode.svelte:47`; no spec of its own |
| `TimelineDialog.svelte` | 153 | no | yes | no | `LessCarsMode.svelte:51` |
| `basemap-hide.ts` | 75 | no | yes | no | `LessCarsMode.svelte:32` (imports `$lib/map/filter-expr`, `LC_ROADS_SOURCE_LAYER` from `$lib/map/style`) |
| `chart-colors.ts` | 27 | no | yes | no | `ExtraChart.svelte:11` |
| `copy.ts` | 45 | no | yes | no | `DetailsPanel.svelte:13`, `summary-view.ts:12` |
| `debug.ts` | 58 | no | yes | no | `LessCarsMode.svelte:33` (window `__sfhLessCars`) |
| `evidence.ts` | 103 | no | yes | no | `EvidenceDialog.svelte:10`, `LessCarsMode.svelte:35`; imports `$lib/fzp/provenance` (line 4) |
| `features.ts` | 291 | no | yes | no | `LessCarsMode.svelte:37`, `legend.ts:5`, `map-layers.ts:28` |
| `legend.ts` | 84 | no | yes | no | `DetailsPanel.svelte:22` |
| `load.ts` | 70 | no | yes | no | `routes/lesscars/+page.ts:3`, `LessCarsMode.svelte:48` |
| `map-layers.ts` | 391 | no | yes | no | `LessCarsMode.svelte:49`, `legend.ts:6` |
| `summary-view.ts` | 129 | no | yes | no | `DetailsPanel.svelte:23`, `ExtraChart.svelte:13`, `HeadlineBar.svelte:14` |
| `timeline-view.ts` | 127 | no | yes | no | `LessCarsMode.svelte:50`, `TimelineDialog.svelte:11`, `evidence.ts:7` |

None is imported by `/sim`, Paint, or pipeline. Test-only: `test/HeadlineHeader.svelte`, `test/LessCarsModeHost.svelte`. Specs: `map-layers`, `HeadlineBar.svelte`, `LessCarsMode.svelte`, `timeline-view`, `EvidenceDialog.svelte`, `load`, `DetailsPanel.svelte`, `features`, `chart-colors`, `basemap-hide`, `market-pairing`, `summary-view`, `evidence`, `ExtraChart.svelte`, `TimelineDialog.svelte` (all `src/lib/lesscars/*.spec.ts`).

What `src/lib/lesscars` imports from shared code (V importer data): `$lib/map/{SimMap.svelte,palette,style,filter-expr,system-theme.svelte,types}`, `$lib/shell/header-actions.svelte`, `$lib/sim/{client,manifest}`, `$lib/timelapse/{model,time,types}`, `$lib/scoreboard/format`, `$lib/view/prefs` (`HIDDEN_VIEW`), `$lib/fzp/*` (section 2), `$lib/data/lesscars/*`, `$lib/sim/lesscars/*`. `LessCarsMode.svelte:373-379` mounts `SimMap` with `{manifest} onRetryChunks onready view={HIDDEN_VIEW} timelinePick`; every one of those props/handle methods (`applyTimeline`, `setTime`, `setBottomInset`, `setChunkStatus`, `getMap`) is also used by `/sim`'s `TimelineMode` or Paint's `BrushEditor` (V grep) so `SimMap` has no lesscars-only API.
Transitive reach into sim-page: `lesscars/evidence.ts:4` -> `fzp/provenance.ts:26` -> `sim-page/funding-copy.ts`; `fzp/money-view.ts:20`, `MoneyResults.svelte:13` -> `sim-page/SourceList.svelte` (V). This is why `src/lib/timeline/copy.ts:3` says `funding-copy.ts` "`/lesscars` imports and so stays unedited" (V; true only transitively).

### `src/lib/sim/lesscars/` (4 non-test modules; V)

| Module | Lines | /sim | /lesscars | Paint | Importers |
|---|---:|:-:|:-:|:-:|---|
| `playback-host.ts` | 530 | wiring only | yes | no | SIM `sim/router.ts:4` (type), `sim/worker.ts:4` (`createPlaybackHost`); no UI importer. Imports `scenario-host`'s `createToken`, `MEMO_CAP`, `SLICE_PLAN_MS` (line 53), `scenario/load` (44), `scenario/geometry` (43), `map/pack-timed` (35) |
| `types.ts` | 49 | wiring only | yes | no | SIM `sim/router.ts:5`, `sim/scenario/types.ts:35`; LC `LessCarsCard.svelte:13`, `LessCarsMode.svelte:28`, `builds.ts:12`, `playback-client.ts:11`, `playback-host.ts:56` |
| `builds.ts` | 87 | no | yes | no | LC `playback-host.ts:55` |
| `playback-client.ts` | 183 | no | yes | no | LC `lesscars/LessCarsMode.svelte:23` |

Specs: `playback-host.spec`, `builds.spec`, `playback-client.spec`; support `test/fake-playback-worker.ts` (used by `LessCarsMode.svelte.spec.ts`, `playback-client.spec.ts`). Also importers in tests: `sim/scenario/types.spec.ts:33`, `sim/worker-router.spec.ts:5`.
`/sim` never sends playback requests (I: `grep playback` in `src/lib/timeline`, `sim/timeline-client.ts`, `sim-page` finds only the unrelated "playback" word in `Playhead.svelte`). The router has a `'playback'` mode (V `router.ts:46`).

### `src/lib/data/lesscars/` (4 non-test modules; V)

| Module | Lines | /sim | /lesscars | Paint | Pipeline | Importers |
|---|---:|:-:|:-:|:-:|:-:|---|
| `codec.ts` | 735 | no | yes | no | yes | LC (15 files across `lesscars/` and `sim/lesscars/`), PIPE `lib/lesscars/runs.ts:29`, `steps/check-lesscars.ts:7`, `steps/lesscars.ts:27`; e2e |
| `plan.ts` | 490 | no | yes | no | yes | LC `codec.ts:27`, `network.ts:22`, `schedule.ts:7`, `lesscars/{evidence:3,features:13,map-layers:39,timeline-view:4}.ts`; PIPE `lib/lesscars/{regimes:39,runs:41}.ts`, `steps/{check-lesscars:15,lesscars-sql:4,lesscars:34}.ts` |
| `schedule.ts` | 291 | no | yes | no | yes | LC `codec.ts:28`, `network.ts:23`, `lesscars/LessCarsMode.svelte:12`, `TimelineDialog.svelte:8`, `features.ts:14`, `timeline-view.ts:5`, `sim/lesscars/playback-host.ts:29`; PIPE `lib/lesscars/{regimes:40,runs:42}.ts`, `steps/{check-lesscars:16,lesscars:43}.ts` |
| `network.ts` | 129 | no | no (no runtime importer) | no | yes | PIPE only: `lib/lesscars/regimes.ts:38`, `steps/lesscars.ts:42`. Imports `$lib/data/transit` (line 21) |

Test/support: `codec.test`, `network.test`, `plan.test`, `schedule.test`, `fixtures/tiny-plan.ts`, `fixtures/v1/{summary,plan,sites}.json` (byte copies of a past dataset's files; `.prettierignore:22-23`).
`src/lib/data/lesscars/**` is inside the dataset code hash (section 8).

### `src/lib/transit/` (5 non-test modules; V)

| Module | Lines | /sim | /lesscars | Paint | Importers |
|---|---:|:-:|:-:|:-:|---|
| `index.ts` | 4 | yes | yes (via SimMap) | yes (via SimMap) | SIM `map/SimMap.svelte:54`, `map/style.ts:10`, `map/transit-layer.ts:4` |
| `grid.ts` | 141 | yes | yes (via SimMap) | yes (via SimMap) | `index.ts:3` only (so through `$lib/transit`) |
| `service.ts` | 89 | yes | yes (via SimMap) | yes | `grid.ts:13`, `index.ts:2` |
| `legend.ts` | 13 | yes | no | yes | `index.ts:4`, `view/LayerSwitches.svelte:18` (LayerSwitches is mounted by `sim-page/SimPage.svelte:83`, `routes/+page.svelte:32`, `routes/p/[id]/+page.svelte:26`) |
| `types.ts` | 10 | yes | via SimMap | yes | `grid.ts:14`, `index.ts:1`, `service.ts:3` |

`SimMap.svelte` is imported by `brush/BrushEditor.svelte:34` (Paint and `/p`), `timeline/TimelineMode.svelte:113` (`/sim`, `/s`), `lesscars/LessCarsMode.svelte:18` (V). `src/lib/transit/**` is NOT in the dataset code hash and has no lesscars-specific code (V: no `lesscars` string in the dir: not exhaustively grepped; I). No pipeline file imports `$lib/transit` (V).

## 4. Engine coupling

Grep (case-insensitive) of `lesscars|freed|regime|reservation|reservedFrom|freeway|roadLot|road-lot|road_like` over `src/lib/sim/**` (excluding `sim/lesscars`) and `src/lib/timelapse/**` (non-spec, non-test), plus a second pass for `regimes`/`reservedFrom` over `src`, `pipeline`, `scripts`. `src/lib/sim/{levers,finance}` and `src/lib/timelapse` have zero hits. `src/lib/sim/*.ts`: only `worker.ts` and `router.ts`.

Step engine `src/lib/sim/world`: NO lesscars input. Hits are the English word "freed" (a lot freed by an ending project), unrelated:
- `world/pipeline.ts:178-179,321,324` `freed` field of the extras (`x.freed`); `world/holds.ts:61-102` `holdEnd`/`startEnd` push to `freed`; `world/world.ts:86,132,136,199-200,229,259-268,400-427,577-619` `planFreed`, due-list; `world/types.ts:208,239` comments.
- Test-only `regimes`: `world/test/timeline.ts:112,125` (`oldInputOf`, `OldOpts.regimes`) and `world/frames.referee.spec.ts:64,105,167`. These feed the OLD scenario engine as the oracle the new frames are compared to (V).

Scenario engine (older engine; step engine imports types/constants from it):
- `sim/scenario/types.ts:35` imports `PlaybackRequest, PlaybackResponse` from `../lesscars/types`. `:69-72` `Schedule.regime?`. `:110-117` `SimInput.regimes?: { day: Day; parcels: ScenarioParcels }[]`. `:119-122` `SimInput.reservedFrom?: Int32Array`.
- `sim/scenario/input.ts:111-169,226-231,271,358-361,421-492` `Precompute.regimes`, `regimeInputsOf`, `regimeMonths`, `segmentsOf` (piecewise hazard over views).
- `sim/scenario/engine.ts:46-47,67-70,241-244,252-331,971-1160` `Sink.reservation?`, `Run.regimes`, `Run.reservedFrom`, `checkInput` RangeErrors (278-294), `simulatedPass` reservations, `reservationsOff`.
- `sim/scenario/funded.ts:27,53,76-88,145,228,300-320,375,683,788,915,1112-1124,1249-1259,1391-1459,1651,1740-1773,1831,1908-1909` same inputs in the funded pass (`TAG_RESERVATION`, `regimeMonths`, `reservationsOff`).
- Production callers that SET `regimes`/`reservedFrom`: `pipeline/lib/lesscars/runs.ts:299,304,95-102,275-279,316-331,436-448` (`planInput`, `baselineInput`); `pipeline/steps/lesscars.ts:497-537`. No `src` non-test caller (V: the file list of `\bregimes\b|reservedFrom` has no non-test src file outside `sim/scenario/{engine,funded,input,types}.ts`). `docs/dev/sim-levers.md:235` says the same and is consistent.
- Specs for these inputs: `engine-regimes.spec.ts`, `engine-switch.spec.ts`, `engine-market.spec.ts`, `engine-finance*.spec.ts`, `funded.spec.ts`, `input.spec.ts`, `types.spec.ts`, `lesscars/market-pairing.spec.ts`, `pipeline/test/{lesscars-regimes,lesscars-runs,lesscars-step}.test.ts`, `pipeline/test/fixtures/engine-node-smoke.ts:30`.
- Dataset-version consequence: `src/lib/sim/scenario` is hashed (section 8).

Worker wiring: `sim/worker.ts:4,47-56` constructs the playback host; `sim/router.ts:4-5,22,44-85` has a third `mode` and `createPlayback` dep (V).

## 5. The lesscars plan format

Types (verbatim names; V):
- `src/lib/data/lesscars/plan.ts`: `LESSCARS_PLAN_SCHEMA` (16), `PROJECT_KINDS` (17), `ProjectKind` (28), `TRANSIT_KINDS` (29), `TRANSIT_MODES` (30), `TransitMode` (31), `LANE_USES` (32), `LaneUse` (41), `CAPACITY_KINDS` (42), `CapacityKind` (43), `NEW_STOP_PREFIX` (46, value `'lc:'`), `Param` (48), `SegmentRef` (52), `PlanStop` (54), `SiteBuild` (59), `FreewayLandPlan` (73, fields `parcels`, `excluded`), `PlanProject` (78, union by `kind`: `transit-line`, `tram-priority`, `bus-lane`, `street-change`, `highway-truncation`/`street-removal`, `parking-conversion`, `edge-garage`, `car-shuttle`), `CapacityRule` (123), `PlanDisplay` (132), `LessCarsPlan` (138), `PlanFormatError` (147), `parseProvenance` (227), `parseLessCarsPlan` (452), `capacityKindOf` (468), `closesToCars` (486).
- `src/lib/data/lesscars/schedule.ts`: `LESSCARS_START` (16, 2028-01-01), `LESSCARS_HORIZON` (17, 2068-12-31), `ProjectTimes` (23), `PlanSchedule` (33), `schedulePlan` (50), `PlanProblemCode` (77), `PlanProblem` (92), `inProgress` (123), `checkPlan` (148).
- `src/lib/data/lesscars/network.ts`: `PLAN_MODE` (25), `RAISE_MODES` (38), `networkAt` (56), `transitOpenDays` (120).
- `src/lib/data/lesscars/codec.ts` (output files, format `sfh-lesscars/1`, line 30): `LESSCARS_FORMAT`, `SOURCES`/`Source` (32-33: `freed`, `parking`, `transitUnlocked`, `other`), `FREED/PARKING/TRANSIT_UNLOCKED/OTHER` (34-37), `InitiativeBuild` (40), `LessCarsSummary` (56), `LessCarsTimeline` (81), `LessCarsSite` (97), `LessCarsSitesFile` (110), `LessCarsPlanFile` (116), `parseSummary` (211), `encodeTimelinePayload` (328), `decodeTimelinePayload` (431), `parseSitesFile` (654), `parsePlanFile` (703).
- Dated regimes: engine input types `SimInput.regimes` / `reservedFrom` (`sim/scenario/types.ts:117,122`); pipeline builder `RegimeSet` (`pipeline/lib/lesscars/regimes.ts:151`: `baseline`, `plan`, `unlocked`, `siteRowAt`, `parcelRowAt`), also `TierChange` (50), `Snapshot` (58), `tierChanges` (81), `regimeDays` (117), `afterSwitchRow` (134), `lotSb79Row` (186), `buildRegimes` (275). `Regimes = Pick<RegimeSet,'baseline'|'plan'>` (`runs.ts:201`).
- Reservations: `reservationsOf` (`runs.ts:67`), `sourceOfRows` (93), `Reservation` (`src/lib/lesscars/features.ts`, in export list), `PlaybackResponse.playbackLoaded.reservations` (`sim/lesscars/types.ts`), engine `Sink.reservation` (`engine.ts:70`).
- Freed land: `FreedSite` (`pipeline/lib/lesscars/sites.ts:35`), `readFreedSites` (111), `freedFzpRow` (185), `NeighbourZoning` (23), `chooseZoning` (57); `FreewayLandFile`/`FreewaySegment` (`pipeline/lib/lesscars/freeway-land.ts:28,9`); `FreewayLandPlan` above; runtime `freedMassing` (`sim/lesscars/builds.ts`).
- Paired runs: `runPairs` (`runs.ts:312`), `summarise` (366), `representativeTimeline` (434), `initiativeBuilds` (125), `garageCosts` (179), `planInput`/`baselineInput` (293, 302), `lesscarsYearEnds` (56).
- Constants: `LC` in `pipeline/lesscars-config.ts:14-45` (switchDay `'2032-01-31'`, keepHalfM, accessM, lotMaxM, minPieceM2, neighbourM, basemapBandM, basemapMinShare, basemapClipZooms, basemapParallelDeg, freewayBandM, freewayMinShare), `LC_CITE` (47).

Consumers (V from section 2/3 importers):
- `plan.ts`, `schedule.ts`, `codec.ts`: UI (`lesscars/*`, `sim/lesscars/playback-*`) and pipeline (`lib/lesscars/{regimes,runs}.ts`, `steps/{lesscars,lesscars-sql,check-lesscars}.ts`).
- `network.ts`: pipeline only.
- Live plan: `pipeline/enrichment/lesscars/plan.json` (`id: lesscars-v1`, 68 projects, V by reading JSON); mini fixture: `pipeline/test/fixtures/mini/enrichment/lesscars-plan.json`. Authoring source `docs/lesscars/plan-v1.md` (2062 lines) is read by `pipeline/test/lesscars-live-plan.test.ts:25`, `lesscars-v1-1-enrichment.test.ts:15`, helper `lesscars-doc.ts:1`.

## 6. Pipeline

### CLI commands (V `pipeline/cli.ts`)
- `lesscars-cnns` (242-245): runs `lesscarsCnns` (`steps/lesscars-cnns.ts`, 112 lines): resolves `pipeline/enrichment/lesscars/corridors.json` to `corridors.resolved.json` from the locked `datasf-streets` raw files (header comment `lesscars-cnns.ts:3`). Writes no dataset output.
- `lesscars-freeway-land` (246-262): `steps/lesscars-freeway-land.ts` (240 lines) + `sql/86_freeway_land.sql` (86): proposes parcels, writes `freeway-land.candidates.json` / `.draft.json` (V files exist); catalog is hand-curated truth (`lesscars-freeway-land.ts:4`).
- `lesscars-basemap` (263-290): `steps/lesscars-basemap.ts` (471 lines) modes `split`, `report`, `candidates`; writes `basemap-ids.candidates.json`.
- Not run by `build` or `all`: all three commands (V: `build.ts` imports none of the `steps/lesscars-{cnns,freeway-land,basemap}.ts`; `cli.ts:16-18` imports them only for their own commands).
- `build`: `runBuild` -> `pipeline/steps/build.ts`. `all` = `fetchAll` if no lock, then `runBuild` (`cli.ts` `all`, V). Both run the lesscars pieces below.
- `check`: `pipeline/steps/check.ts:34` imports `checkV35` (`steps/check-lesscars.ts`, 255 lines); `check.ts:68-72,674-700` V17 reads the freeway-land catalog (`cli.ts:148-149`).
- `fixture`: `steps/fixture.ts:21-47,182` includes `LESSCARS_FILES.{plan,sites,summary}` and `LESSCARS_TIMELINE_DUMP` in the golden.

### What `build` runs for lesscars (V `pipeline/steps/build.ts`)
1. `226-235` `readFreewayLand(LESSCARS_FREEWAY_LAND_JSON[...])` then `loadRoadLotInputs(db, freewayLandSet(...), readRoadLots(...))` before `runSql`.
2. `276` `freewayLand` passed to the scenario step (T11 eligibility).
3. `353-373` `writeLessCars({ basemap: { pmtiles, ids, sha256 }, db, outDir, datasetVersion, records, planPath, profile, capDay, freewayLand })` (`steps/lesscars.ts:413`). `planPath` is `LESSCARS_PLAN_JSON.fixture` or `.live`. Without a plan file it writes nothing (`lesscars.ts:400`, header lines 8-9; `build.ts:350-351`). The live plan file exists (V), so a live build writes lesscars files.
4. `390-404` `splitPhasesOf(db, lesscars.basemapPhases, LC.basemapBandM)`; if there are split phases `writeBasemap` rewrites `basemap.pmtiles` moving removed freeway stretches to source layer `roads_lc` (`steps/tiles.ts:199-218`, `lib/lesscars/basemap-split.ts`, `lib/pmtiles-rewrite.ts`), else a byte copy. Counter `tiles.basemap_split_changed` (`build.ts:403`).
5. `421` `lesscars: lesscars.written` passed to `buildManifest` (manifest key `scenarios.lesscars`, `steps/manifest.ts:89-93`); `436` `...lesscars.counts`; `453` `freewayLand` to the check.

### Does the pipeline run the engine for lesscars? Yes (V)
`pipeline/lib/lesscars/runs.ts:46` imports `runEngine`; calls at `336` (plan arm), `339` (baseline arm), `448` (representative timeline). `runPairs` (312) and `representativeTimeline` (434) are invoked from `steps/lesscars.ts:516,534`. Seeds per profile: `lesscarsSeeds` (`pipeline/config.ts:153-156`).

### Pipeline files that exist for lesscars (V; line counts)
- Config: `pipeline/lesscars-config.ts` (100): `LC` (14), `LC_CITE` (47), `LESSCARS_PLAN_JSON` (79, live `enrichment/lesscars/plan.json`, fixture `test/fixtures/mini/enrichment/lesscars-plan.json`), `LESSCARS_FREEWAY_LAND_JSON` (88), `LESSCARS_BASEMAP_IDS_JSON` (97). Spec ref line 8 `docs/superpowers/specs/2026-11-01-lesscars-design.md`.
- Lib: `pipeline/lib/lesscars/{basemap-ids 71, basemap-roads 237, basemap-split 533, corridors 376, freeway-land 152, regimes 495, runs 473, sites 198, streets 81}.ts`.
- Steps: `steps/{lesscars 649, lesscars-sql 202, lesscars-basemap 471, lesscars-cnns 112, lesscars-freeway-land 240, check-lesscars 255}.ts`.
- SQL: `sql/84_lesscars_sites.sql` (369), `85_lesscars_reach.sql` (24), `86_freeway_land.sql` (86). None is in `lib/sql.ts`'s `runSql` list (V `lib/sql.ts:8-18`: `05` to `70` plus `55_road_lots`); 84/85 are run by `steps/lesscars-sql.ts:171,201`, 86 by `steps/lesscars-freeway-land.ts:31`.
- Enrichment data: `pipeline/enrichment/lesscars/{plan.json 135 KB, freeway-land.json 91 KB, freeway-land.draft.json, freeway-land.candidates.json 433 KB, basemap-ids.json, basemap-ids.candidates.json, corridors.json, corridors.resolved.json}`; mini fixtures `pipeline/test/fixtures/mini/enrichment/lesscars-{plan,freeway-land,basemap-ids}.json`.
- Shared files with lesscars content: `pipeline/lib/scenario-files.ts:11-18` (`LESSCARS_FILES`, `LESSCARS_TIMELINE_DUMP`); `pipeline/steps/manifest.ts:5,33-34,89-93`; `pipeline/steps/tiles.ts:12,199-218`; `pipeline/lib/pmtiles-rewrite.ts:3-4`; `pipeline/lib/scenario-eligibility.ts:13-23`; `pipeline/steps/scenario.ts:40,277-300,490-511,687-786,999,1066`; `pipeline/lib/sb79.ts:34` (comment: lesscars snapshot adds BRT stops); `pipeline/sources/datasf.ts:185-196`, `sources/normalise.ts:22,38,48-55,73,279`; `pipeline/sources/protomaps.ts` (basemap fetch); `pipeline/lib/road-lots.ts`, `lib/quality-rules/sd.ts:197-230`, `pipeline/config.ts:34-49,78,103,153-156,181`; `pipeline/steps/{doctor 121-131,fetch 12,28,177,verify 52,boxes 74-80}.ts`.
- Sources: `pipeline/sources.lock.json` entry `datasf-streets` (id line 1024, dataset `3psu-pn9h`, 16,378 rows, PDDL-1.0, retrieved 2026-11-02) and `protomaps-basemap` (1150). `pipeline/lidar.lock.json` has no lesscars/freeway strings (V grep count 0 hits). The lock's `datasf-streets` page-only claim: see contradictions.

### Dataset outputs for lesscars (V `pipeline/lib/scenario-files.ts:11-18`, `steps/lesscars.ts:577-582`)
`scenarios/lesscars/plan.json`, `sites.json`, `summary.json`, `timeline.bin` (+ test-only `timeline.decoded.json` in goldens). Manifest key `scenarios.lesscars` (optional; `src/lib/data/manifest.ts:70-77`, files list 160-164). Also modifies `basemap.pmtiles` (split layer `roads_lc`) and the counts/report.

### `scenarios/fzp/*` outputs and readers (V)

Written by pipeline (names in `pipeline/lib/scenario-files.ts:5-9`, `steps/{scenario,projects,calibration,gross,policy}.ts`): `parcels.bin`, `policy.bin`, `gross.bin`, `projects.json`, `calibration.json`. Manifest `scenarios.fzp` (`manifest.ts:55-65`: parcels, projects, calibration required; policy, gross, frontage optional).

Readers in `src` (non-test), by file:
- `calibration.json`: `src/lib/fzp/load.ts:12-16,24-26` (`fetchCalibration`, `reloadScenario`) called by `sim-page/load.ts:38-41` (/sim and /s route load), `sim-page/SimRoute.svelte:70`, `about/AboutAssumptions.svelte:36,60` (About), `lesscars/load.ts:50-53` (/lesscars); parsed also in worker paths via `sim/scenario/load.ts` (`loadScenario`) from `sim/world/runner/dataset.ts:183`, `sim/scenario/scenario-host.ts:631`, `sim/lesscars/playback-host.ts:239`. Also pipeline `steps/lesscars.ts:477-479`.
- `projects.json`: `sim/scenario/load.ts` -> `scenario-host.ts:675,1337`; `fzp/provenance.ts:642` `loadProjectsFile` via `about/AboutAssumptions.svelte:153`, `timeline/TimelineMode.svelte:1731`, `fzp/ProvenanceBody.svelte:22`; `sim/lesscars/playback-host.ts` (via loadScenario). Pipeline `steps/lesscars.ts:477`, `steps/lesscars-freeway-land.ts:183`.
- `parcels.bin`: `loadScenario` consumers: `sim/world/runner/dataset.ts:207`, `runner.ts:977,1014`, `world/host.ts:255,393`, `scenario-host.ts` many, `playback-host.ts:289`; scripts `bench-levers.ts`, `ensemble-measure.ts`, `measure-policy-compile.ts`; pipeline `steps/lesscars.ts` and others; `e2e/scenario-data.spec.ts:5`, `e2e/lesscars.spec.ts`.
- `policy.bin`: `loadScenario({policy:true})` from `sim/world/runner/dataset.ts:183-207` (/sim); `about/AboutData.svelte:23` (`hasPolicy`); pipeline `steps/lesscars.ts:70`. The lesscars playback host does not read it (V grep: no `policy` match beyond loadScenario options is not examined; I).
- `gross.bin`: `sim/scenario/load.ts` (optional) -> `scenario-host.ts:43,317`; pipeline `steps/gross.ts`.
- `transit.json` (top-level, not under fzp): `sim/scenario/scenario-host.ts:1665`, `sim/world/runner/lookups.ts:23-24,70-91`, `sim/levers/brushes.ts:10,32,283`, map `transit-layer.ts:3`; pipeline `steps/lesscars.ts:458`.

The user-stated fact "the `/sim` page reads `scenarios/fzp/calibration.json`" is V (`sim-page/load.ts:41`).

## 7. Road-like lots

- Input: `pipeline/enrichment/road-lots.json` (override file: `keep` rows by `block` or `parcel`), mini `pipeline/test/fixtures/mini/enrichment/road-lots.json`; `ROAD_LOTS_JSON` at `pipeline/lib/road-lots.ts:143-146`. Not under `enrichment/lesscars/` (V).
- Rule: `pipeline/sql/55_road_lots.sql` (242) inside the standard `runSql` list (V `lib/sql.ts:15`), thresholds `pipeline/config.ts:34-49`, lib `pipeline/lib/road-lots.ts` (415), quality rule `lib/quality-rules/sd.ts:197-230`.
- Output reaches ALL consumers: `60_attributes.sql:23-24` sets `eligible = ... AND r.id IS NULL` and `road_like = r.reason`; chunks carry `rl` (`src/lib/data/parcel-chunk.ts:24-25,67-69,156-208`); `ParcelRecord.roadLike` (`src/lib/data/parcel.ts:6-8,25-26`); scenario step uses `scenarioEligible` (`pipeline/lib/scenario-eligibility.ts:21-23`). No `src` UI file reads `roadLike` outside the data codec (V grep of `src`).
- Who reads it: the whole dataset (Paint editor via chunks' `eligible`, T11 `parcels.bin` for `/sim`, and lesscars). Lesscars interplay: freeway-land catalog parcels are "never road-like" (`rl_catalog`, `road-lots.ts:149-150`, `build.ts:223-235`); `docs/dev/road-lots.md` sections "Live build" (lines 341-386, 465, 564) record the lesscars effect; `src_streets` is shared (section 0 fact 8). `docs/dev/road-lots.md` itself says it "is the build note" (line 3).
- Test files: `pipeline/test/road-lots{,-scenario,-sql}.test.ts`.
- Conclusion (V): road-like lots are NOT lesscars-only; only their interplay with the freeway-land catalog is.

## 8. `pipeline/lib/version.ts`: what is hashed into the dataset version

`PATHS` (V `pipeline/lib/version.ts:42-53`), verbatim:
```
'pipeline',
'src/lib/data',
'src/lib/generator',
'src/lib/timelapse',
'src/lib/plan/geometry.ts',
'src/lib/plan/types.ts',
'src/lib/sim/scenario',
'src/lib/sim/levers',
'src/lib/sim/finance',
'src/lib/scoreboard'
```
`EXCLUDE_PATHS` (55): `'pipeline/sources.lock.json'`, `'pipeline/.cache'`, `'pipeline/out'`. Hash = `treeHash` of `git ls-tree -r HEAD` (mode, blob, path) of those paths minus excludes, plus diff and untracked bytes when dirty (98-129). The lock is hashed separately (11-27, 134), tool versions too.

Within the scope, hashed (a deletion or edit changes the version): everything under `pipeline/` (all lesscars lib/steps/sql/config/enrichment files, ALL `pipeline/test/**` including `lesscars-*.test.ts`, mini fixtures and goldens, `pipeline/lidar.lock.json`, `pipeline/enrichment/road-lots.json`), `src/lib/data/lesscars/**` (including tests and `fixtures/v1`), and `src/lib/data/manifest.ts` etc. Also `src/lib/sim/scenario/**` (the `regimes`/`reservedFrom` engine code), `src/lib/sim/levers/**`, `src/lib/sim/finance/**`, `src/lib/timelapse/**`, `src/lib/scoreboard/**`.
NOT hashed: `src/lib/fzp/**`, `src/lib/lesscars/**`, `src/lib/sim/lesscars/**`, `src/lib/transit/**`, `src/lib/sim-page/**`, `src/lib/timeline/**`, `src/lib/map/**`, `src/lib/sim/world/**`, `src/routes/**`, `e2e/**` (except `e2e/fixtures/data/**` is checked by a golden test, not hashed), `docs/**`, `scripts/**`, `docs/lesscars/plan-v1.md`.
Comment `version.ts:33-41` explains: "The lesscars step runs the simulation engine, so sim/scenario, sim/levers and scoreboard shape the published data too ... the /lesscars step runs the baseline funding through [sim/finance]" (V).
Consequence for process (V `chreode.config.ts:19-29,34-35`): a change to `pipeline/**` or `src/lib/data/**` or `src/lib/sim/{scenario,levers,finance}/**` triggers the `dataset` signoff step (publish dataset to staging) and `pipeline` tests; `e2e/fixtures/data/**` triggers `pipeline` tests (43). `src/**` otherwise triggers lint, check, unit, e2e (40). `chreode.config.ts` contains no `lesscars`/`fzp` strings (V grep).

## 9. Fixture dataset `e2e/fixtures/data/fixture-0/` (V `find`)

Lesscars-only: `scenarios/lesscars/plan.json` (7,171 B), `sites.json` (2,450 B), `summary.json` (2,454 B), `timeline.bin` (1,230 B), and the `scenarios.lesscars` key in `manifest.json` (line 1 contains "lesscars"). Sort-of: `basemap.pmtiles` (may or may not contain `roads_lc`; not examined) and `report.json` (lesscars counts, I).
Other files (shared): `buildings.pmtiles`, `neighborhoods.geojson`, `parcels/{50_25,51_25}.json`, `README.md` (no lesscars mention, V), `scenarios/fzp/{calibration.json,gross.bin,parcels.bin,policy.bin,projects.json}`, `transit.json`, glyph/sprite assets (excluded from my listing; 22 files total).
Generated from `pipeline/test/fixtures/mini/` by `pipeline fixture`; goldens `pipeline/test/fixtures/mini/golden/scenarios/lesscars/{plan,sites,summary,timeline.decoded}.json` and `pipeline/test/fixtures/mini/raw/datasf-streets.page-000.geojson`, `pipeline/test/fixtures/mini/enrichment/lesscars-*.json`. `scripts/data-local.spec.ts:26-56` pins `scenarios/lesscars/*` URLs/paths in a manifest fixture (V). `src/lib/data/manifest.test.ts:169-180,236-240` too.

## 10. Tests that exist for the two pages and lesscars modules (V file lists)

Routes: `src/routes/fzp/page.spec.ts`; `src/routes/lesscars/{page.spec.ts,page.svelte.spec.ts}`.
`src/lib/fzp/` (18 specs, section 2). `src/lib/lesscars/` (15 specs, section 3). `src/lib/sim/lesscars/{playback-host,builds,playback-client}.spec.ts`. `src/lib/data/lesscars/{codec,network,plan,schedule}.test.ts`.
`src/lib/transit/{legend,service,purity,grid}.spec.ts`, `grid.bench.spec.ts` (bench), `src/lib/map/transit-layer.spec.ts`.
Shared-code tests mentioning lesscars: `src/lib/shell/{layout.spec,SiteHeader.svelte.spec}.ts`, `src/lib/map/{palette.spec,style.spec}.ts`, `src/lib/server/user-store/handle-normalize.spec.ts`, `src/lib/data/manifest.test.ts`, `src/lib/sim/{worker-router.spec}.ts`, `sim/scenario/{types.spec,engine-regimes.spec,engine-switch.spec}.ts`, `src/lib/timeline/copy.spec.ts`, `scripts/data-local.spec.ts`, `src/lib/sim/world/frames.referee.spec.ts` (uses `regimes` as oracle).
Pipeline tests (`pipeline/test/`): `lesscars-basemap-roads`, `lesscars-basemap-split`, `lesscars-corridors`, `lesscars-freeway-land`, `lesscars-live-plan`, `lesscars-regimes`, `lesscars-runs`, `lesscars-sites`, `lesscars-step`, `lesscars-v1-1-enrichment` (`.test.ts`); helpers `lesscars-doc.ts`, `lesscars-helpers.ts`; road-lots: `road-lots`, `road-lots-scenario`, `road-lots-sql` (`.test.ts`); also mention lesscars/freeway/basemap/cnn: `boxes-command`, `doctor`, `engine-node`, `fetch`, `golden`, `helpers.ts`, `invariants`, `land-source`, `live-raw`, `manifest`, `normalise`, `pmtiles-rewrite`, `scenario-features`, `scenario-quality`, `scenario-v18`, `sql`, `tiles`, `upload`, `verify`, `version` (grep by content; whether each mention is incidental was not examined), `fixtures/engine-node-smoke.ts`.
e2e (V): own specs `e2e/lesscars.spec.ts` (682 lines), `e2e/fzp.spec.ts` (763 lines; titled "/fzp e2e" but runs on `/sim`, header `fzp.spec.ts:1`), `e2e/fzp-sim.spec.ts` (121; named for fzp, tests `/sim`'s data reads, header `:22`). Other e2e that touch lesscars: `targets.spec.ts:506-514`, `sim-citywide.spec.ts:125-127`, `pages-a11y.spec.ts:16`, `sim.spec.ts:237-238`. e2e that use the `fzp` debug hook `window.__sfhFzp` (i.e. `/sim`, not lesscars): `chrome-dark`, `map-key`, `sim`, `sim-activity`, `sim-citywide`, `sim-details`, `sim-funding`, `sim-halos`, `sim-pools`, `sim-share`, `sim-timeline`, `share-notices` (testid `fzp-notices`), `bench/{map-timeline,sim-timeline}.bench.ts`, `perf/first-month.perf.spec.ts`.
e2e helpers: `e2e/helpers/run.ts:2-8,17-25,90-103` imports `SfhFzpDebug` from `src/lib/fzp/debug` (used by `/sim` specs); `e2e/helpers/sharing.ts:67` `clientNavigate` (used by `lesscars.spec.ts:633`); `e2e/helpers/{a11y,chrome}.ts` used by `lesscars.spec.ts:26-28`. `e2e/lesscars.spec.ts:9` imports `LC` from `pipeline/lesscars-config` (so e2e depends on pipeline code; V). Also imports from `src/lib/{fzp,lesscars,sim/lesscars,data/lesscars}`.
Perf tests: none named for lesscars (V: no `lesscars` in `*.perf*` filenames; content not grepped).
`e2e/transit.spec.ts` exists (transit layers; content not examined).

## 11. Shell / navigation

- Header: no link to `/lesscars`, `/fzp`, or "Fewer cars" anywhere in `src/lib/{shell,about,sim-page,timeline,map,goal,dock}`, `src/routes/+layout*` (V grep for `fewer.cars|lesscars|/fzp`: only comments and tests listed in section 1). Steps are `/` and `/sim` (V `SiteHeader.svelte:122,127`). About dialog/page: no link (V; grep of `src/lib/about` for lesscars returns nothing).
- "Fewer cars" string appears only as `<title>` of `/lesscars` (`+page.svelte:11`) and its no-scenario copy; `docs/dev/lesscars.md:464` says the header link "was removed later" (consistent).
- Shared components with a lesscars-only prop/branch: none found. `grep lesscars` in `src/lib/{sim-page,timeline,map,shell,about}` yields only: `shell/layout.ts:6` (a route id), comments (`shell/SiteHeader.svelte:7`, `header-actions.svelte.ts:10`, `map/SimMap.svelte:1547`, `map/filter-expr.ts:1`, `map/palette.ts:56`, `map/style.ts:197-200`, `timeline/copy.ts:3`), and data: `map/palette.ts:43-54,104-115,163-175` (12 `lc-*` tokens x 2 themes), `map/style.ts:202-216` (`LC_ROADS_SOURCE_LAYER`, `LC_CLONE_SUFFIX`, `roadsClone`, applied to every roads layer at the base-style builder lines ~190-216; consumer = every map), `map/filter-expr.ts` (only caller `lesscars/basemap-hide.ts:9`). `map/palette.ts` tokens `lc-*` are consumed only by `lesscars/{DetailsPanel.svelte:9,legend.ts:4,map-layers.ts:24,LessCarsCard.svelte}` (V importer + grep).
- `src/lib/shell/layout.ts:6` (`isFullHeightRoute`).
- `src/lib/data/manifest.ts:69-77,160-164` (schema + file list for `scenarios.lesscars`; optional).

## 12. Transit

- `src/lib/transit/*` (section 3): the map's access-grid layer and legend; serves `/sim`, Paint and (as part of `SimMap`) `/lesscars`. No lesscars-specific code (I, see section 3).
- `src/lib/data/transit.ts` and `transit-codec.ts` (the `transit.json` schema/codec): imported by `data/lesscars/network.ts:21` (PIPE only), `pipeline/lib/lesscars/regimes.ts:36`, `pipeline/steps/lesscars.ts:46-47`; and by `/sim` engine paths: `sim/levers/brushes.ts:10`, `sim/scenario/scenario-host.ts:93-94`, `sim/world/runner/lookups.ts:23-24`, `map/transit-layer.ts:3`, `map/types.ts:7`; and by pipeline `steps/{transit,policy,check,check-policy}.ts`, `lib/sb79.ts:7`, `transit-config.ts:14`; scripts `bench-levers`, `ensemble-measure`, `measure-policy-compile` (V importer lists).
- `transit.json`: built by `pipeline/steps/transit.ts` in `build` (`build.ts:54`, uses `writeTransit`, `transitTargetDate`), served as manifest key `transit` (optional, `manifest.ts:51`).
- `npm run data:transit`: `package.json` script -> `scripts/data-transit.ts` (fetches GTFS from agencies, builds `transit.json`, writes into the local R2 copy named by `.dev.vars`), helper `scripts/lib/data-transit-helpers`, spec `scripts/data-transit.spec.ts`. Serves local dev of `/sim` and Paint; fixture-0 has a mini `transit.json` (V file exists). Not lesscars (V: no lesscars in the script header; the lesscars build step reads `transit.json` from the build's outDir, `steps/lesscars.ts:458`, but the script is the same one).
- "Transit rule" zoning policy on `/sim` (the user's wording; code names it "Transit layers"/`kind: 'transit'`): `src/lib/sim-page/policy.ts:40-48` (`ZoningRule`), `sim-page/transit-edit.ts` (editor; importers `TransitLayerRow.svelte:15`, `TransitTab.svelte:24`, `timeline/add.ts:13`), `sim-page/TransitLayerRow.svelte` (imported by `TransitTab.svelte:25` and `timeline/WhatEditor.svelte:30`), `sim/levers/brushes.ts:32,283` (a transit brush needs `transit.json`, else `BrushDataMissing('transit')`), `sim/scenario/scenario-host.ts:378,1571,1665` and `sim/world/runner/lookups.ts:74,91` (load the file on demand). Serves `/sim` only. `sim-page/TransitTab.svelte` has no non-test importer (V: only `sim-page/test/TransitTabHost.svelte:34`; `sim-page/selection.ts:4` calls it "until it goes"): dead in the app, I mean not mounted by any product file.
- Lesscars transit: `data/lesscars/network.ts` (plan network by day, pipeline), `plan.ts` kinds `transit-line|tram-priority|bus-lane` and `PlanStop`, `NEW_STOP_PREFIX 'lc:'`, `pipeline/steps/lesscars.ts` stop/route validation against `transit.json` (header lines 11-16), `pipeline/lib/lesscars/regimes.ts` SB 79 tiers by year (reads `pipeline/lib/sb79.ts`, `pol_tod`, `policy.bin` columns), `sql/85_lesscars_reach.sql`, UI `lesscars/map-layers.ts` (`lc-line-*` marks), `features.ts` (`lineFeatures`, `stopFeatures`).

## Doc/code contradictions

1. `docs/dev/pipeline.md:5` says `datasf-streets` is "a page-only DataSF source for /lesscars ... /sim does not use it"; comments `pipeline/sources/datasf.ts:185` ("Page-only ... no /sim rule reads them") and `pipeline/sources/normalise.ts:48-50` ("page-only ... the live lock gains it in a later plan") say the same. Code: `pipeline/sql/55_road_lots.sql:114,135,141` (inside the standard `runSql` list, `lib/sql.ts:15`) and `pipeline/steps/boxes.ts:76` read `src_streets`, and the live `pipeline/sources.lock.json:1024` already has the source. So the road-like-lot rule, which decides `eligible` for Paint and `/sim`, depends on it. (V)
2. `src/lib/fzp/load.ts:1-3` header describes "The /fzp data ... used by the route load and by FzpMode's Retry"; code: no `/fzp` route load and no `FzpMode`; importers are `sim-page/load.ts:5`, `sim-page/SimRoute.svelte:8`, `about/AboutAssumptions.svelte:12`, `lesscars/load.ts:13` (V).
3. `docs/dev/fzp-mode.md:14` lists `load.ts, types.ts, copy.ts` as used by "`/sim`, `/lesscars`": `copy.ts` has no `/lesscars` importer (V importer list: SIM and FZP only).
4. `docs/dev/fzp-mode.md:11` and `docs/dev/lesscars.md:910` are accurate for `TimeScrubber`/`playback-host`; no contradiction. `docs/dev/fzp-mode.md:49` "`HighWater` (`/lesscars` only)": consistent with V (one importer). Not a contradiction, noted so the check is recorded.
5. `src/lib/timeline/copy.ts:3` says `funding-copy.ts` is something "`/lesscars` imports"; no lesscars file imports it directly, only transitively via `fzp/provenance.ts:26` (V). Minor.
6. `docs/dev/sim-levers.md:96,122` and `src/lib/sim/scenario/{types.ts:146,scenario-host.ts:21-52,361-413}` still speak of "/fzp" as a live consumer without levers ("absent = /fzp"); there is no `/fzp` page (redirect only) and `/sim` never sends `initScenario` (`docs/dev/timeline-ui.md:44`, V `router.ts` has the mode). The scenario host's `levers`-absent path is now exercised only by tests and the playback host's shared helpers (I; callers of `scenario-client.ts`: `timeline/{TimelineMode.svelte:123,session.svelte.ts:15}`, `sim/timeline-client.ts:21`, `sim/lesscars/playback-client.ts:9`, V).
7. e2e `pages-a11y.spec.ts:16` treats `/fzp` as a map page distinct from `/sim`, but `/fzp` redirects (V `routes/fzp/+page.ts`); it runs the `/sim` checks twice (I).
8. `docs/dev/lesscars.md:892` ("The header has no link to it") matches code (no contradiction). `e2e/lesscars.spec.ts` and `e2e/fzp.spec.ts` names vs content: `fzp.spec.ts:1` says it runs on `/sim`; the file name is stale.

## Appendix

### Files read in full
`src/routes/fzp/+page.ts`, `src/routes/lesscars/+page.ts`, `src/routes/lesscars/+page.svelte`, `pipeline/lib/version.ts`, `pipeline/lib/scenario-files.ts`, `src/lib/fzp/load.ts`, `src/lib/lesscars/load.ts`, `src/lib/sim/lesscars/types.ts`, `src/lib/sim/worker.ts`, `src/lib/shell/layout.ts` (first 12 lines = whole function), `pipeline/lesscars-config.ts` (grep + lines 12-46).

### Files read in part (line ranges)
`src/lib/data/lesscars/plan.ts` 14-146; `pipeline/lib/lesscars/regimes.ts` 148-166; `pipeline/lib/lesscars/runs.ts` 285-306; `pipeline/steps/build.ts` 160-170, 215-240, 340-372 (+ grep); `pipeline/cli.ts` 225-330 (+ grep); `pipeline/steps/lesscars.ts` 1-30 (+ grep); `src/lib/data/manifest.ts` 40-100, 120-175; `src/lib/sim/lesscars/playback-host.ts` 1-22 (+ grep); `src/lib/sim/scenario/types.ts` 105-125; `src/lib/sim/world/test/timeline.ts` 105-128; `pipeline/steps/scenario.ts` 274-305; `src/lib/map/style.ts` 190-250; `src/lib/lesscars/LessCarsMode.svelte` 1-75, 373-395 (+ grep); `src/lib/sim-page/load.ts` 25-60; `pipeline/steps/check-lesscars.ts` 1-12; `src/lib/timeline/copy.ts` 1-8; `docs/dev/fzp-mode.md` 1-20, 49; `docs/dev/lesscars.md` 880-935 (+ grep); `docs/dev/road-lots.md` 1-30; `docs/dev/pipeline.md` line 5; `docs/dev/sim-levers.md` line 235; `scripts/docs-index.spec.ts` 1-30; `src/lib/sim-page/transit-edit.ts` 1-30; `src/lib/transit/service.ts` 1-12; `scripts/data-transit.ts` 1-25; `pipeline/sources/datasf.ts` 183-188; `pipeline/sources/normalise.ts` 46-52; `pipeline/sql/55_road_lots.sql` 108-116; `pipeline/lib/sql.ts` 8-24; `e2e/pages-a11y.spec.ts` 10-30; `package.json` 5-40; `chreode.config.ts` (grep only for lesscars/fzp; paths and steps via grep lines 9-253); `pipeline/enrichment/lesscars/{freeway-land,plan,basemap-ids}.json` (parsed with node for counts only).

### Dirs listed
`src/routes`, `src/routes/{fzp,lesscars}`, `src/lib/{fzp,lesscars,sim/lesscars,data/lesscars,transit}` (+ `test`, `fixtures`), `src/lib/data`, `src/lib/timelapse`, `e2e`, `e2e/helpers`, `e2e/bench`, `e2e/perf`, `e2e/fixtures`, `e2e/fixtures/data`, `e2e/fixtures/data/fixture-0` (+ `scenarios/lesscars`), `pipeline`, `pipeline/{steps,lib,sql,enrichment,enrichment/lesscars,test,lib/lesscars,test/enrichment,test/fzp-cal,test/fixtures/mini,test/fixtures/mini/enrichment,test/fixtures/mini/raw}`, `docs`, `docs/lesscars`, `scripts`, repo root.

### NOT examined
- Full bodies of all `src/lib/fzp/**`, `src/lib/lesscars/**`, `src/lib/sim/lesscars/**`, `src/lib/data/lesscars/**` modules (line counts and exports come from `wc`/regex, importers from the import resolver).
- `src/lib/map/SimMap.svelte` internals (whether the base style's `roads_lc` clones are always built is from `style.ts:197-216` and its tests, not traced to every call site).
- Whether `fixture-0`'s `basemap.pmtiles` contains a `roads_lc` source layer; `report.json` contents.
- Full contents of `pipeline/steps/lesscars*.ts`, `check-lesscars.ts`, `lib/lesscars/*`, `sql/84-86`, `e2e/lesscars.spec.ts`, `e2e/fzp*.spec.ts`, `e2e/transit.spec.ts`.
- Whether each pipeline test that merely mentions lesscars/basemap/cnn depends on lesscars behaviour.
- `docs/superpowers/**` content (only filenames matching lesscars/`/fzp`: about 110 files); `CHANGELOG.md` content.
- Perf tests' contents (only filenames checked); `*.bench.*` content.
- `.github/` (does not exist in the grep roots; no hit in the root-level grep), `wrangler.jsonc`/`svelte.config.js` (grep for lesscars/fzp: no hit).
- `src/lib/sim/lesscars/playback-host.ts` use of `policy.bin` (not confirmed either way).
- Cloudflare/R2 side: whether published datasets on staging/prod carry `scenarios/lesscars` (not checkable from the tree).
