# src/lib/fzp: what is left of the FZP timelapse page

Developer notes for `src/lib/fzp/`. `FzpMode.svelte` is gone (timeline-ui): `/sim` and `/s/<id>` are `TimelineMode` ([timeline-ui.md](timeline-ui.md)), `/lesscars` has its own mode ([lesscars.md](lesscars.md)). What stays here is what those two share. The original design is `docs/superpowers/specs/2026-10-16-fzp-mode-design.md`.

**Routing.** `/fzp` is no longer a page: its load (`src/routes/fzp/+page.ts`) is a 307 redirect to `/sim` with every query parameter kept except the retired `start`. The header link is "Simulate" (`/sim`). `/sim` ignores `?seed=` and drops it from the address ([timeline-ui.md](timeline-ui.md)).

## What is here

| Group                      | Files                                                                                                                                                                                                  | Used by                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| The scrubber and its clock | `TimeScrubber.svelte`, `playback.ts`, `time.ts`, `high-water.svelte.ts`                                                                                                                                | `/lesscars` (`LessCarsMode`); `/sim`'s `Playhead` takes `playback.ts` and `time.ts`                                             |
| Results                    | `SimResults.svelte`, `ScoreChart.svelte`, `MoneyResults.svelte`, `MapKey.svelte`, `score-view.ts`, `money-view.ts`, `market-view.ts`, `chart.ts`, `format.ts`, `SourcesDialog.svelte`, `provenance.ts` | `/sim` (fed from `TimelineView` by `src/lib/timeline/results.ts`); `/lesscars` imports `chart.ts`, `format.ts`, `provenance.ts` |
| The map's card and tooltip | `ProjectCardPanel.svelte`, `ProjectTooltip.svelte`, `summary-request.ts`, `card.ts`, `card-place.ts`, `card-area-watch.ts`, `labels.ts`                                                                | `/sim` (`TimelineMode`)                                                                                                         |
| Loading and shared types   | `load.ts`, `types.ts`, `copy.ts`                                                                                                                                                                       | `/sim`, `/lesscars`                                                                                                             |
| The e2e hook               | `debug.ts` (`window.__sfhFzp`)                                                                                                                                                                         | `/sim`; fields in [timeline-ui.md](timeline-ui.md)                                                                              |

A file `/lesscars` imports is not edited by `/sim` work ([lesscars.md](lesscars.md)). Run phases, the run slider, `RunSwitcher`, the swap reroll and `HighWater` are gone from `/sim`.

## The scrubber contract

`TimeScrubber.svelte` is a native `<input type="range">` over `[asOf, horizon]` in days (`step=1`), where `asOf` is `calibration.asOf` and `horizon` is `HORIZON` (2066-12-31, `src/lib/fzp/time.ts`). Its accessible name is "Date in the simulation" and `aria-valuetext` is the readout ("October 2026").

| Key                 | Effect                                                                    |
| ------------------- | ------------------------------------------------------------------------- |
| Left / Down         | the previous first-of-month strictly before the day, clamped up to `asOf` |
| Right / Up          | the next first-of-month strictly after the day, clamped to `horizon`      |
| Page Down / Page Up | twelve months back or forward from the month start, clamped to the range  |
| Home / End          | `asOf` / `horizon`                                                        |

Keys with Alt, Ctrl or Meta are left to the browser. Every handled key, a drag on the track, the start and end marker buttons and the marker buttons under the track **pause** playback and move the day (`jump`).

**Transport.** Left to right: Pause (`fzp-pause`), Play (`fzp-play`), Faster (`fzp-faster`, `title` "3 years per second"), the readout (`fzp-readout`), then the track row: the start marker (`fzp-start`, text `startLabel`, default the short month and year of `asOf`; `/sim` passes "Today"), the range, the end marker (`fzp-end`, the horizon year), and the marker row under the range. Pause stops. Play plays at 1 year per second (`year`); Faster plays at 3 years per second (`threeYears`). Either one, pressed at `horizon`, restarts from `asOf` first (Replay). Play and Faster carry `aria-pressed` (`playing` and their speed), so a test reads the play state from `fzp-play`'s `aria-pressed` and the speed from `fzp-faster`'s, not from a label. There is no speed select.

**`ontoday`.** Called when a user jump lands on `asOf` outside setup: Home, the start marker, an arrow or Page key clamped to `asOf`, or a drag released there (the range's `change`; `input` events passing through `asOf` do not count). Not called by Replay, by the frame loop or by a programmatic `day` change. It fires even when the day was already `asOf`.

**Fixed width.** The Play button (`fzp-play`) and the readout (`fzp-readout`) stack every label (Run, Play, Replay; the 12 month names of the current year, `monthYearLabels`) in one grid cell, the extras `invisible` and `aria-hidden`, so the bar never shifts. The visible text has its own testid (`fzp-play-label`, `fzp-readout-label`); assert on those, because the readout's own text contains every month. There is no "Simulation" pill.

**Setup mode** (`/sim`'s `Playhead` has none). With `setup` Play reads "Run" and calls `onrun`; Pause and Faster are `invisible` (they keep their space and leave the tab order, so the bar does not shift); the range, the start and end markers and the marker buttons are `disabled` and keys do nothing.

- **Speeds** (`playback.ts`, a tier 4 UI choice): `Speed` is `year` ("1 year per second", the default, Play) or `threeYears` ("3 years per second", Faster; `SPEED_NAME`), as days of simulated time per second of wall time (`12 x MONTH_DAYS`, `36 x MONTH_DAYS`). `window.__sfhFzp.speed` reports the current one.
- **Frame step:** only while `playing`, through `requestAnimationFrame`: `t += min(dt, 100 ms) x daysPerSecond`, `day = min(floor(t), horizon)`. The 100 ms clamp stops a background tab from making the clock jump. If something else moves the day mid-play, the clock continues from there.
- **No autoplay:** playback never starts on its own; the page opens paused at `asOf` and waits on Play (`/sim`'s `Playhead` is the same: Play is the reader's act).
- **`onday`:** called exactly once per day change (`setDay` compares with the current day first). The page's handler does O(1) work: `handle.setTime(day)`, and a card refresh only when the month changed.
- **Opening the sources dialog pauses** (`onopen` sets `playing = false`). Opening a card does not.
- The readout is not a live region (it changes every frame). The header score's live region (`HeaderScore`, `data-testid="score-live"`) speaks only when playback is paused, 1000 ms after the day settles.

The page always opens paused, so tests get a stable day without any media emulation.

**The high-water mark** (`/lesscars` only). `HighWater` (`src/lib/fzp/high-water.svelte.ts`) holds the furthest day reached by playback or scrubbing; `/lesscars` keeps its own `HighWater(LESSCARS_START)` (`window.__sfhLessCars.highWater`, [lesscars.md](lesscars.md)). `/sim` has none: its rows show the playhead's month, and what is shown is bounded by the filled mark (`TimelineView.filledThrough`).

## Layout variables

`--map-controls-br-block-size` is set by `SimMap` ([map-interfaces.md](map-interfaces.md)); the card on a phone sits above it (`bottom-[calc(var(--map-controls-br-block-size,60px)+8px)]`) and a tall card is capped by it. `--dock-w` and `--fzp-scrubber-h` were `Dock`'s and `FzpMode`'s; `/sim` sets neither. The notice stack (`NoticePills`, [sim-page.md](sim-page.md)) is an overlay at the map's top from md and in flow below it; the header, status line and timeline layout is [timeline-ui.md](timeline-ui.md).

## Props `TimelineMode` keeps from `FzpMode`

`manifest`, `calibration`, `datasetVersion`, the load and error props, `noScenario`, `reload`, `createWorker`, `view` (`ViewPrefs`, default `HIDDEN_VIEW`), `cards` (default true; taps and clicks open project cards, and `SimMap`'s own `tapCards` follows it; `/sim` always passes true), `ownerName`, `fundingName`, `onmanifest`, `onheights`, `onchunks`, `onmapready` and the snippets. Hover tooltips and `timelinePick` reports are unaffected by `cards`. `SimClientApi.lotAt(point)` forwards the worker's `lotAt` ([sim-levers.md](sim-levers.md)); `/sim` calls it for a tap on a lot with no project.

## Picks, summaries and the card

- **Picks:** SimMap reports `timelinePick` events. A hover over a part feeds the tooltip's requester; a tap or mouse click feeds the card's requester and records the tap point as the card's anchor (`cards` is always on on `/sim`); a tap or click on nothing closes the card. Hover shows a tooltip only. Existing buildings keep SimMap's own tooltip. Parts of a simulated project are pickable only while visible at the scrubbed day.
- **Summaries are latest-wins** (`summary-request.ts`). One `SummaryRequester` per surface (card, tooltip): at most one request in flight and one queued behind it, and only the latest query's answer reaches the UI. While a card is on show, a request for the same parcel and project keeps it on show until the answer replaces it (no flash of "loading" on every month). A `not-loaded` answer is retried on each worker `chunks` message.
- **Card placement** (sim-ux plan 4, Task 5). From md the card opens beside the clicked building, not in a fixed spot; below md it stays the bottom sheet above. `TimelineMode` keeps the tap's `{ x, y, lngLat, parcelId }` (`TimelinePick`'s `x`/`y` are map-container px; `lngLat` is `map.unproject` of them) and the card's measured box (`ProjectCardPanel`'s `onsize`, a `ResizeObserver` on the card), and hands `ProjectCardPanel` an `anchor` `{ left, top, maxHeight }` from `cardPlacement(anchor, size, area)` (`card-place.ts`): right of the point by 16 px, or left of it when that overflows the area's right edge, vertically centred on it, clamped 8 px inside the area (the left and top edges win for a card taller than the area). The area is `cardArea(map, pills, dockW, scrubberH, controls)`: its left is the right edge of MapLibre's bottom-left controls (zoom and compass, `controls.left`); its right is the map's right edge; its bottom is above the bottom-right controls' footprint (`--map-controls-br-block-size` on `:root`, read from its inline value, `controls.bottom`), so a tall card never covers the attribution links (WCAG 2.4.11); and its top is the bottom of the notice-pill stack while a pill shows (`NoticePills` binds its element; from md the stack overlays the map's top, so a card never covers a pill; below md it is in flow above the map and a card is a sheet anyway). While a card is open `watchCardArea` (`card-area-watch.ts`) re-measures the area, once per frame, on only these: a `ResizeObserver` on the map box, the pill stack and the bottom-left controls (a pill appearing takes the stack's height from 0), and a style-attribute observer on `:root` that reacts only to the footprint's inline values changing. Nothing in the map's subtree is observed, so the scrubber's readout during playback and tooltip text cost nothing here. The card also follows its building: while open, `TimelineMode` listens to the map's `move`, and once per frame reprojects the stored `lngLat` (`map.project`) into a new anchor point and places the card again, clamped as usual when the building leaves the area; the card is never closed by a pan or zoom, and the listener goes with the card. The anchor reaches the card as `--card-left`, `--card-top` and `--card-max-h` custom properties that only the `md:` classes read, so a phone sheet ignores it; with no anchor (null) the card keeps the fixed spot right of the dock. Closing the card forgets the tap.
- **"Allowed by"** (`ownerName`). With the `ownerName` prop `TimelineMode` shows `Allowed by: {name}` (`data-testid="card-allowed-by"`) after the card's size line, from the `limits.owner` that `parcelSummary` carries (`SummaryState` `project` has `limits?: LotLimits`) and the tap's parcel. `/sim` passes `ownerName4` (`src/lib/timeline/owner.ts`): the label of the policy that sets the lot's limit, null for the Family Zoning Plan or a policy that has left the document (the worker's limits can be a revision behind), so then there is no line.
- **"Funded by"** (`fundingName`, funding-ui 4.13). With the `fundingName?: (f: CardFunding) => string | null` prop `TimelineMode` shows the line from `fundingName(cardFunding(card))` (`data-testid="card-funded-by"`, `ProjectCardPanel`'s `fundedBy`) after "Allowed by", on a simulated card that carries `funding`, and "100% affordable homes." on an affordable start. `/sim` and `/s/<id>` pass `fundingName4` from `SimPage`, over the document's money policies and the calibration's baseline funding. Wording in [sim-funding.md](sim-funding.md).
- **Card refresh:** the open card asks again when the playhead's month changes, after an edit once a `filled` covers its day, and when the worker crashes (then it reads "Details unavailable" until Retry). The answer's `lookups` are the stage tables of the frame in force that day.

## Lookups on the map

The card's chance lookup (`chanceTable`) and the map's stage-duration lookup (`typicalMonths`) start from the base `calibration.json` (`lookupsFor` in `TimelineMode.svelte`, one object per calibration object, because SimMap compares lookups by identity). The worker's posted `lookups` (`{ inFlight, fresh }`, for the playhead's month, a new object each time) replace them: the map gets `{ ...lookups.fresh, inFlight: lookups.inFlight }` (`mapLookupsFor`, one object per posted `lookups`). Nothing else in the page should read the calibration for these tables.

Cohort-aware bars (Call 15). The engine sets `Schedule.inFlight: true` on each schedule whose job ran on `calibration`: pipeline rows past `preApplication`, and phases. `packTimedCell` writes it to `slotCohort` (0 fresh, 1 in flight). The chance texture is 36 rows, `chanceRow(pathway, stage, cohort) = cohort * 18 + pathway * 6 + stage`: rows 0 to 17 hold the top-level (fresh) chance, rows 18 to 35 `inFlight.chance`, or the fresh rows again when `inFlight` is absent. A bar's `segRow` and `segTypicalDays`, and a part's construction typical days, read its slot's cohort. Without `newProjects` no schedule carries the flag, every slot is cohort 0, and the bars are unchanged.

Freeway land never builds in the forecast: a parcel in the freeway-land catalog is scenario-ineligible in `parcels.bin` ([pipeline.md](pipeline.md), "Freeway land").

## Known gap: no keyboard access to cards

Map picking is pointer-only (mouse click, touch tap, hover), a gap shared with the editor's tooltips (see "Known gap" in [map-interfaces.md](map-interfaces.md)). A keyboard user can drive the playhead, the Results face and the sources dialog, but cannot open a project card. Once a card is open it is a normal region with a Close button, and Escape closes it (unless the sources dialog is open, which takes Escape first).

## Today's market in the Results' sources

When `calibration.market` is present, the Results face's Sources disclosure
(`data-testid="fzp-sources"`) has a paragraph `data-testid="fzp-market"` directly after its first
paragraph. `SimResults` takes it as the `market?: string | null` prop (default `null` renders
nothing); `TimelineMode` passes `marketText(calibration)` (`src/lib/fzp/money-view.ts`):
`marketSentence(calibration, marketLevel(calibration))` (`src/lib/fzp/market-view.ts`), `null`
without `calibration.market`, with `MARKET_FUNDING_SENTENCE` (`sim-page/funding-copy.ts`)
appended when the level is `'private'` (Release 2: the forecast includes today's public funding, so
nothing is counted twice). The level always comes from `marketLevel`; the page never picks one. The sentence's
percent comes from the counts, not from `exp(level)`, so its three numbers agree. It is static text
in a closed disclosure, with no `aria-live`. Both `/sim` and `/s/<id>` show it.

The sources dialog gets a section `src-market` ("Today's market") after "Where new projects
start", with the "In force" line following `marketLevel`; without `calibration.market` there is no
section and no paragraph. In Release 2 (`funding-ui` 4.12) the "Today's level" entry's line for
the level not in force reads "Not in force: today's public funding is modelled, so private starts
run at their own level." (all starts) or, when `marketLevel` is `'all'` (data without
`baselineFunding`), "Not in force: this data has no public funding, so every start runs at one
level." (private starts; ruling R-P5 rewords the Release 1 text). At the private level a second
entry, `src-market-slope` ("How strongly money moves a private project's odds"), gives the slope's
provenance with the Controller's cost and price coefficients as cross-check lines, not entries.
The e2e reads their numbers from `fixture-0`'s calibration. See [market.md](market.md).

`provenanceSections(calibration, score, terms)` and `SourcesDialog`'s `terms` prop take the terms in
force at the playhead (`TimelineMode`: `resolveTerms(MARKET_TERMS, termsInForce(policy, day))`). With both
`market` and `baselineFunding` the dialog has a section `src-money` ("Public money") after
`src-market`: the baseline's provenance, how fully funded affordable projects are approved, the
prototypes and land, the loan and guarantee terms (unsourced ones as "No sourced value", typed ones
as "your value (custom, not sourced)"), the draw assumption, the displacement range and
`finance-score`'s `MONEY_SOURCES` (first `PIPELINE_FUNDED`), then three fixed sentences (the
pricing rule, the loss on exit worded from `terms.lossOnExit`, and ruling R8).

## Public money and income tiers in Results

`SimResults` renders `MoneyResults.svelte` twice: `part="money"` ("Public money",
`data-testid="fzp-money"`, after "What … added", only with `score.money`) and `part="tiers"` ("Who
the homes are for", `data-testid="fzp-tiers"`, after the RHNA rows, only with `score.tiers`). Both
read the playhead's month. Its props:

- `pending` (`TimelineMode`: the numbers are stale): both blocks carry `aria-busy="true"`, with no
  visible text (the header score is the busy sign). A failed edit keeps the old
  numbers under the existing stale line instead.
- `terms`: the market terms in force at the playhead, for the lost-grants line (`lossOnExit`).
- `uncapped`: the ids of pools whose `Pool.uncapped` is true, which read "no limit" under Received.
  `TimelineMode` derives it with `uncappedPoolIds` over the calibration's baseline pools and the document's money policies
  (`money-view.ts`), because the money series carries no flag.

The rows and their wording are in [sim-funding.md](sim-funding.md) ("Results, card and summary").

## The chart's y domain

`ScoreChart` (`chart.ts`) draws every series only up to `monthIndex(highWater)`; on `/sim` that prop is the filled mark (`filledEnd`), so the table rows stop there and the "At the deadline" lines stay hidden until it reaches the deadline month. Its accessible name is "Net new homes in this simulation so far: ...". The y domain covers the shown values, so it can grow as the forecast fills, with the references and the RHNA target as a floor (so the axis does not jump for them). It starts at 0, **unless a shown value is negative**: the plan-effect series can be early on. Then the axis reaches down to `-niceCeil(-min)` so the negative part stays inside the plot, and a floor gridline is added when it is clear of the zero line. Spec section 4.6 says "0 to niceCeil"; the extension is deliberate.

## e2e notes

- Run on port 4206 with one worker: `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/sim.spec.ts e2e/sim-timeline.spec.ts e2e/fzp.spec.ts`. Helpers: `e2e/helpers/run.ts` (`waitFilled`, `waitFilledThrough`, `openKind`, `addPolicy`, `slider`), `e2e/helpers/sharing.ts` (`jumpAndIdle`, `projectToPage`, `FRAME`, `headerAction`, `openHeaderMenu`) and `e2e/helpers/a11y.ts`.
- The fixture dataset (`fixture-0`) has two parcel chunks (cell 50_25, 15 parcels; cell 51_25, 3 parcels, lots 15 to 17) and the scenario files `/sim` reads at load. Tests read `projects.json`, `calibration.json`, `parcels.bin` and the chunk from disk and derive counts, ids and labels; do not hard-code them. The two chunks are neighbouring cells about 700 m apart, so they cannot show over-fetching by themselves: `e2e/fzp-sim.spec.ts` adds a far-away chunk to the manifest the page loads and asserts it is fetched only after a pan.
- A first load of `/sim` takes the manifest from the server's render, so `page.route` on `manifest.json` has no effect there. To test a dataset without scenarios, navigate to `/sim` from `/about` (a page that loads no manifest) with the route in place.
- Results shows at rest from md; below md the header score (`data-testid="score-bar"`) opens it; the region is "Results" (`data-testid="score-details"`) and its Sources disclosure (`data-testid="fzp-sources"`) holds "Where these numbers come from": open it first. Below 1024 px the header's links and actions wait in the Menu: use `headerAction` / `openHeaderMenu`.
- Axe and the footer check: `expectNoA11yViolations` runs with the card open, with the sources dialog open (scoped to the dialog, `structure: true`) and with Results open; the timeline's own cases (a kind open, the editor open, light and dark) are in `e2e/sim-timeline.spec.ts`. At 375 px the footer links must stay unobscured with the card, the inspector sheet and the phone palette strip showing.
- `e2e/sim-funding.spec.ts` covers the Funding editors, the Results money and tier blocks, the market paragraph and `src-money`, the published summary and the funding notices ([sim-funding.md](sim-funding.md), "The e2e").
