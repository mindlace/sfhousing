# src/lib/fzp: what is left of the FZP timelapse page

Developer notes for `src/lib/fzp/`, the shared kernel of the simulation and `/s/<id>`, both `TimelineMode` ([timeline-ui.md](timeline-ui.md)). `/fzp` and `/lesscars` answer 404. The original design is `docs/superpowers/specs/2026-10-16-fzp-mode-design.md`.

**Routing.** The simulation is the game at `/` once its phase is `'runs'`; `/sim` is a 308 to `/` ([game.md](game.md)). The simulation ignores `?seed=` and drops it from the address ([timeline-ui.md](timeline-ui.md)).

## What is here

| Group                      | Files                                                                                                                                                                                                                           | Used by                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| The clock                  | `playback.ts`, `time.ts`                                                                                                                                                                                                        | The simulation's `Playhead`                                                                                               |
| Details' pieces            | `MoneyResults.svelte`, `score-view.ts`, `money-view.ts`, `market-view.ts`, `chart.ts`, `format.ts`, `ProvenanceBody.svelte`, `provenance.ts` (About's dialog, `src/lib/about/AboutDialog.svelte`, shows them on the simulation) | The simulation's Details (`src/lib/timeline/SimDetails.svelte`, fed from `TimelineView` by `src/lib/timeline/results.ts`) |
| The map's card and tooltip | `ProjectCardPanel.svelte`, `ProjectTooltip.svelte`, `summary-request.ts`, `card.ts`, `card-place.ts`, `card-area-watch.ts`, `labels.ts`                                                                                         | The simulation (`TimelineMode`)                                                                                           |
| Loading and shared types   | `load.ts`, `types.ts`, `copy.ts`                                                                                                                                                                                                | The simulation                                                                                                            |
| The e2e hook               | `debug.ts` (`window.__sfhFzp`)                                                                                                                                                                                                  | The simulation; fields in [timeline-ui.md](timeline-ui.md)                                                                |

Details holds no map key: the key is on the map (`MapKeyControl` with `SimKey`, [timeline-ui.md](timeline-ui.md), "The screen").

## The clock

- **Speeds** (`playback.ts`, a tier 4 UI choice): `Speed` is `year` ("1 year per second", the default, Play) or `threeYears` ("3 years per second", Faster; `SPEED_NAME`), as days of simulated time per second of wall time (`12 x MONTH_DAYS`, `36 x MONTH_DAYS`). `window.__sfhFzp.speed` reports the current one.
- **Frame step:** only while `playing`, through `requestAnimationFrame`: `t += min(dt, 100 ms) x daysPerSecond`, `day = min(floor(t), horizon)`. The 100 ms clamp stops a background tab from making the clock jump. If something else moves the day mid-play, the clock continues from there.

## Layout variables

`--map-controls-br-block-size` is set by `SimMap` ([map-interfaces.md](map-interfaces.md)); the card on a phone sits above it (`bottom-[calc(var(--map-controls-br-block-size,60px)+8px)]`) and a tall card is capped by it. The simulation sets neither `--dock-w` nor `--fzp-scrubber-h`. The notice stack (`NoticePills`, [sim-page.md](sim-page.md)) is an overlay at the map's top from md and in flow below it; the header, its status slot and the timeline layout is [timeline-ui.md](timeline-ui.md).

## `TimelineMode`'s map and card props

`manifest`, `calibration`, `datasetVersion`, the load and error props, `noScenario`, `reload`, `createWorker`, `view` (`ViewPrefs`, default `HIDDEN_VIEW`), `cards` (default true; taps and clicks open project cards, and `SimMap`'s own `tapCards` follows it; the simulation always passes true), `ownerName`, `fundingName`, `onmanifest`, `onheights`, `onchunks`, `onmapready` and the snippets. Hover tooltips and `timelinePick` reports are unaffected by `cards`. `SimClientApi.lotAt(point)` forwards the worker's `lotAt` ([sim-levers.md](sim-levers.md)); the simulation calls it for a tap on a lot with no project.

## Picks, summaries and the card

- **Picks:** SimMap reports `timelinePick` events. A hover over a part feeds the tooltip's requester; a tap or mouse click feeds the card's requester and records the tap point as the card's anchor (`cards` is always on in the simulation); a tap or click on nothing closes the card. Hover shows a tooltip only. Existing buildings keep SimMap's own tooltip. When a camera move ends under a resting mouse, SimMap picks again there, as a 1 px move would. Parts of a simulated project are pickable only while visible at the scrubbed day.
- **Summaries are latest-wins** (`summary-request.ts`). One `SummaryRequester` per surface (card, tooltip): at most one request in flight and one queued behind it, and only the latest query's answer reaches the UI. While a card is on show, a request for the same parcel and project keeps it on show until the answer replaces it (no flash of "loading" on every month). A `not-loaded` answer is retried on each worker `chunks` message.
- **Card placement** (sim-ux plan 4, Task 5). From md the card opens beside the clicked building, not in a fixed spot; below md it stays the bottom sheet above. `TimelineMode` keeps the tap's `{ x, y, lngLat, parcelId }` (`TimelinePick`'s `x`/`y` are map-container px; `lngLat` is `map.unproject` of them) and the card's measured box (`ProjectCardPanel`'s `onsize`, a `ResizeObserver` on the card), and hands `ProjectCardPanel` an `anchor` `{ left, top, maxHeight }` from `cardPlacement(anchor, size, area)` (`card-place.ts`): right of the point by 16 px, or left of it when that overflows the area's right edge, vertically centred on it, clamped 8 px inside the area (the left and top edges win for a card taller than the area). The area is `cardArea(map, pills, dockW, scrubberH, controls)`: its left is the right edge of MapLibre's bottom-left controls (zoom and compass, `controls.left`); its right is the left edge of the map key control (`MapKeyControl`'s box, open or closed, `controls.right`; [map-interfaces.md](map-interfaces.md), "The map key control"), so a card never covers the key; its bottom is above the bottom-right controls' footprint (`--map-controls-br-block-size` on `:root`, read from its inline value, `controls.bottom`), so a tall card never covers the map's credit (WCAG 2.4.11); and its top is the bottom of the notice-pill stack while a pill shows (`NoticePills` binds its element; from md the stack overlays the map's top, so a card never covers a pill; below md it is in flow above the map and a card is a sheet anyway). While a card is open `watchCardArea` (`card-area-watch.ts`) re-measures the area, once per frame, on only these: a `ResizeObserver` on the map box, the pill stack, the bottom-left controls (a pill appearing takes the stack's height from 0) and the key control (its panel opening or closing), and a style-attribute observer on `:root` that reacts only to the footprint's inline values changing. Nothing in the map's subtree is observed, so the scrubber's readout during playback and tooltip text cost nothing here. The card also follows its building: while open, `TimelineMode` listens to the map's `move`, and once per frame reprojects the stored `lngLat` (`map.project`) into a new anchor point and places the card again, clamped as usual when the building leaves the area; the card is never closed by a pan or zoom, and the listener goes with the card. The anchor reaches the card as `--card-left`, `--card-top` and `--card-max-h` custom properties that only the `md:` classes read, so a phone sheet ignores it; with no anchor (null) the card keeps the fixed spot right of the dock. Closing the card forgets the tap.
- **"Allowed by"** (`ownerName`). With the `ownerName` prop `TimelineMode` shows `Allowed by: {name}` (`data-testid="card-allowed-by"`) after the card's size line, from the `limits.owner` that `parcelSummary` carries (`SummaryState` `project` has `limits?: LotLimits`) and the tap's parcel. The simulation passes `ownerName4` (`src/lib/timeline/owner.ts`): the label of the policy that sets the lot's limit, null for the Family Zoning Plan or a policy that has left the document (the worker's limits can be a revision behind), so then there is no line.
- **"Funded by"** (`fundingName`, funding-ui 4.13). With the `fundingName?: (f: CardFunding) => string | null` prop `TimelineMode` shows the line from `fundingName(cardFunding(card))` (`data-testid="card-funded-by"`, `ProjectCardPanel`'s `fundedBy`) after "Allowed by", on a simulated card that carries `funding`, and "100% affordable homes." on an affordable start. The simulation and `/s/<id>` pass `fundingName4` from `SimPage`, over the document's money policies and the calibration's baseline funding. Wording in [sim-funding.md](sim-funding.md).
- **Card refresh:** the open card asks again when the playhead's month changes, after an edit once a `filled` covers its day, and when the worker crashes (then it reads "Details unavailable" until Retry). The answer's `lookups` are the stage tables of the frame in force that day.

## Lookups on the map

The card's chance lookup (`chanceTable`) and the map's stage-duration lookup (`typicalMonths`) start from the base `calibration.json` (`lookupsFor` in `TimelineMode.svelte`, one object per calibration object, because SimMap compares lookups by identity). The worker's posted `lookups` (`{ inFlight, fresh }`, for the playhead's month, a new object each time) replace them: the map gets `{ ...lookups.fresh, inFlight: lookups.inFlight }` (`mapLookupsFor`, one object per posted `lookups`). Nothing else in the page should read the calibration for these tables.

Cohort-aware bars (Call 15). The engine sets `Schedule.inFlight: true` on each schedule whose job ran on `calibration`: pipeline rows past `preApplication`, and phases. `packTimedCell` writes it to `slotCohort` (0 fresh, 1 in flight). The chance texture is 36 rows, `chanceRow(pathway, stage, cohort) = cohort * 18 + pathway * 6 + stage`: rows 0 to 17 hold the top-level (fresh) chance, rows 18 to 35 `inFlight.chance`, or the fresh rows again when `inFlight` is absent. A bar's `segRow` and `segTypicalDays`, and a part's construction typical days, read its slot's cohort. Without `newProjects` no schedule carries the flag, every slot is cohort 0, and the bars are unchanged.

Freeway land never builds in the forecast: a parcel in the freeway-land catalog is scenario-ineligible in `parcels.bin` ([pipeline.md](pipeline.md), "Freeway land").

## Known gap: no keyboard access to cards

Map picking is pointer-only (mouse click, touch tap, hover), a gap shared with the editor's tooltips (see "Known gap" in [map-interfaces.md](map-interfaces.md)). A keyboard user can drive the playhead, Details and About's dialog, but cannot open a project card. Once a card is open it is a normal region with a Close button, and Escape closes it (unless About's dialog is open, which takes Escape first and marks it handled).

## Today's market in About

Details has no market paragraph (rule 5: it is an assumption, not a number behind an effect); today's market is About's "Today's market" section, below. `marketText(calibration)`
(`src/lib/fzp/money-view.ts`: `marketSentence(calibration, marketLevel(calibration))`, with
`MARKET_FUNDING_SENTENCE` appended at the private level) is kept for `e2e/sim-funding.spec.ts`,
which checks that the fixture has one; no page renders it. The level always comes from
`marketLevel`; the page never picks one, and the percent comes from the counts (`marketShare`).

About's assumptions get a section `src-market` ("Today's market") after "Where new projects
start", with the "In force" line following `marketLevel`; without `calibration.market` there is no
section and no paragraph. In Release 2 (`funding-ui` 4.12) the "Today's level" entry's line for
the level not in force reads "Not in force: today's public funding is modelled, so private starts
run at their own level." (all starts) or, when `marketLevel` is `'all'` (data without
`baselineFunding`), "Not in force: this data has no public funding, so every start runs at one
level." (private starts; ruling R-P5 rewords the Release 1 text). At the private level the entry
also says that today's public funding is in every run, the comparison included
(`MARKET_FUNDING_SENTENCE4`, `src/lib/fzp/market-view.ts`, after the "In force" line), and a second
entry, `src-market-slope` ("How strongly money moves a private project's odds"), gives the slope's
provenance with the Controller's cost and price coefficients as cross-check lines, not entries.
The e2e reads their numbers from `fixture-0`'s calibration. See [market.md](market.md).

`provenanceSections(calibration, score, terms)` (which `TimelineMode` passes to `AboutDialog` as `sections`) takes the terms in
force at the playhead (`TimelineMode`: `resolveTerms(MARKET_TERMS, termsInForce(policy, day))`). With both
`market` and `baselineFunding` the dialog has a section `src-money` ("Public money") after
`src-market`: the baseline's provenance, how fully funded affordable projects are approved, the
prototypes and land, the loan and guarantee terms (unsourced ones as "No sourced value", typed ones
as "your value (custom, not sourced)"), the draw assumption, the displacement range and
`finance-score`'s `MONEY_SOURCES` (first `PIPELINE_FUNDED`), then three fixed sentences (the
pricing rule, the loss on exit worded from `terms.lossOnExit`, and ruling R8).

The dialog's body lives in `src/lib/fzp/ProvenanceBody.svelte`, so About can show it too
([about.md](about.md)). Props: `sections`, `projectsUrl`, `level` (the sections' heading level, 3
or 4; entries one below), `fetchFn`. It owns the data checks (`src-quality`), and `loadChecks()`
is the one way to start them: it starts the load or retries it after a failure, and a load in
flight or done is never repeated. Its owner calls it each time the body is shown (the dialog on
every open, About's page on every open of its disclosure). Its rules and entry
borders read `--about-line`, which the container sets (`AboutDialog` to `line`, `line-dark` in
dark); the tier badges and the tables' head rules keep `control-line` with its dark partner. Ids are
unchanged (`src-…`, `QUALITY_SECTION_ID`). `modelSections(calibration)` (`provenance.ts`) is the
run-free list About shows: `provenanceSections(calibration, null)` with default terms, then
"Targets and published estimates" over `M1_TARGETS` (deadline `RHNA_DEADLINE`) and every
`REFERENCES` entry. Actual completions and multi-phase projects need a run and stay in the simulation's
dialog; so do the typed terms of a policy.

## Public money and income tiers in Details

`SimDetails` (`src/lib/timeline/SimDetails.svelte`) renders `MoneyResults.svelte` twice: `part="money"`
("Public money", `data-testid="fzp-money"`, after the stopped line, only with `score.money`) and
`part="tiers"` ("Who the homes are for", `data-testid="fzp-tiers"`, right after it, only with
`score.tiers`). Both read the playhead's month. Its props:

- `pending` (`TimelineMode`: the numbers are stale): both blocks carry `aria-busy="true"`, with no
  visible text (the header score is the busy sign). A failed edit keeps the old
  numbers under the existing stale line instead.
- `terms`: the market terms in force at the playhead, for the lost-grants line (`lossOnExit`).

A Received cell reads "No ceiling" (`NO_CEILING`) where `isNoCeiling(received)`, an older dataset's
federal pool (`receivedCell`, `money-view.ts`).

The rows and their wording are in [sim-funding.md](sim-funding.md) ("Details, card and summary").

## e2e notes

- Run on port 4206 with one worker: `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/sim.spec.ts e2e/sim-timeline.spec.ts e2e/fzp.spec.ts`. Helpers: `e2e/helpers/run.ts` (`waitFilled`, `waitFilledThrough`, `openKind`, `addPolicy`, `slider`), `e2e/helpers/sharing.ts` (`jumpAndIdle`, `projectToPage`, `FRAME`, `headerAction`, `openHeaderMenu`) and `e2e/helpers/a11y.ts`.
- The fixture dataset (`fixture-0`) has two parcel chunks (cell 50_25, 15 parcels; cell 51_25, 3 parcels, lots 15 to 17) and the scenario files the simulation reads at load. Tests read `projects.json`, `calibration.json`, `parcels.bin` and the chunk from disk and derive counts, ids and labels; do not hard-code them. The two chunks are neighbouring cells about 700 m apart, so they cannot show over-fetching by themselves: `e2e/fzp-sim.spec.ts` adds a far-away chunk to the manifest the page loads and asserts it is fetched only after a pan.
- A first load of the simulation takes the manifest from the server's render, so `page.route` on `manifest.json` has no effect there. To test a dataset without scenarios, navigate to it from `/about` (a page that loads no manifest) with the route in place.
- Details shows at rest from md; below md the header score (`data-testid="score-bar"`) opens it in the sheet. It is `data-testid="tl-details"` in the detail column (`tl-inspector`), headed "Details" (`score-details` is the Paint dock's region), and it ends with the link "How this is worked out" (`data-testid="details-about"`), which opens About over the map (`getByRole('dialog', { name: 'About this model' })`). Below 1024 px the header's links and actions wait in the Menu: use `headerAction` / `openHeaderMenu`.
- Axe and the About check: `expectNoA11yViolations` runs with the card open, with About open over the map (scoped to the dialog, `structure: true`) and with Details open; the timeline's own cases (a kind open, the editor open, light and dark) are in `e2e/sim-timeline.spec.ts`. At 375 px there is no footer, and the header's About entry (in the Menu) must stay unobscured with the card or Details open.
- `e2e/sim-funding.spec.ts` covers the Funding editors, Details' money and tier blocks, About's `src-market` and `src-money`, the published summary and the funding notices ([sim-funding.md](sim-funding.md), "The e2e").
