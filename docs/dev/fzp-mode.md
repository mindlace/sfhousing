# /fzp: the Family Zoning Plan timelapse

Developer notes for `src/lib/fzp/`. The design is `docs/superpowers/specs/2026-10-16-fzp-mode-design.md`; this file records what the code does for people who change it or write tests against it. The page composition is `src/lib/fzp/FzpMode.svelte`.

**Routing (plan 3).** `/fzp` is no longer a page: its load (`src/routes/fzp/+page.ts`) is a 307 redirect to `/sim` with every query parameter kept and `start=fzp` added, which opens the Family Zoning Plan comparison (`FZP_COMPAT_LEVERS`). The `/sim` route (`src/routes/sim/+page.ts`, `+page.svelte`) loads the manifest and calibration, owns the `?seed=` URL and renders `SimPage`, which wraps FzpMode with the policy panel. See [sim-page.md](sim-page.md). The header link is "Simulate" (`/sim`).

## The scrubber contract

`TimeScrubber.svelte` is a native `<input type="range">` over `[asOf, horizon]` in days (`step=1`), where `asOf` is `calibration.asOf` and `horizon` is `HORIZON` (2066-12-31, `src/lib/fzp/time.ts`). Its accessible name is "Date in the simulation" and `aria-valuetext` is the readout ("October 2026").

| Key                 | Effect                                                                    |
| ------------------- | ------------------------------------------------------------------------- |
| Left / Down         | the previous first-of-month strictly before the day, clamped up to `asOf` |
| Right / Up          | the next first-of-month strictly after the day, clamped to `horizon`      |
| Page Down / Page Up | twelve months back or forward from the month start, clamped to the range  |
| Home / End          | `asOf` / `horizon`                                                        |

Keys with Alt, Ctrl or Meta are left to the browser. Every handled key, a drag on the track and a marker button **pause** playback and move the day (`jump`). The Play button toggles; at `horizon` it reads "Replay" and a press restarts from `asOf`.

- **Speeds** (`playback.ts`, a tier 4 UI choice): "1 month/s", "1 year/s" (default), "3 years/s", as days of simulated time per second of wall time (`MONTH_DAYS`, `12 x MONTH_DAYS`, `36 x MONTH_DAYS`).
- **Frame step:** only while `playing`, through `requestAnimationFrame`: `t += min(dt, 100 ms) x daysPerSecond`, `day = min(floor(t), horizon)`. The 100 ms clamp stops a background tab from making the clock jump. If something else moves the day mid-play, the clock continues from there.
- **No autoplay:** playback never starts on its own; the page opens paused at `asOf` and waits on Play.
- **`onday`:** called exactly once per day change (`setDay` compares with the current day first). FzpMode's `onDay` does O(1) work: `handle.setTime(day)`, and a card refresh only when the month changed.
- **Opening the sources dialog pauses** (`onopen` sets `playing = false`). Opening a card does not.
- The readout is not a live region (it changes every frame). The header score bar's live region (`ScoreBar`, `data-testid="score-live"`) speaks only when playback is paused, 1000 ms after the day settles.

The page always opens paused, so tests get a stable day without any media emulation. `gotoFzp` emulates `reducedMotion: 'reduce'` only to keep the map's generated-building animation off (`SimMap` reads `prefers-reduced-motion`).

## Layout variables

| Variable                       | Set by                                                                                                             | Used by                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--fzp-scrubber-h`             | `FzpMode` (`.sfh-fzp`), the scrubber's measured height plus the notice row's (0 when no notice shows), in px       | the card's `max-height` on a wide viewport, the docked policy panel's `bottom` and the phone tool bar's `bottom`, so none runs under the scrubber or a notice                                |
| `--fzp-dock-top`               | `FzpMode` (`:root`, while mounted), the viewport y of the dock's top edge (the notice row and the scrubber), in px | the header score details' `max-height` (`calc(var(--fzp-dock-top) - 3rem - 1rem)`), so they end above the dock. `ScoreBar` assumes the shell header is 48 px (`h-12`), the `3rem` there      |
| `--sim-panel-w`                | `PolicyPanel` (`.sfh-fzp`, from 768 px, while the docked panel is open), 320px                                     | from 768 px, the card's and the loading notice's left edge, the top failure notice's centre and width, and the map's bottom-left navigation control's `left`, so they sit right of the panel |
| `--map-controls-br-block-size` | `SimMap`, see [map-interfaces.md](map-interfaces.md)                                                               | the card on a phone: `bottom-[calc(var(--map-controls-br-block-size,60px)+8px)]`, so it clears the attribution                                                                               |

`FzpMode` also passes the bottom inset to the map (`handle.setBottomInset`): the scrubber's height plus the notice row's. `--map-controls-br-block-size` includes that inset, so the phone card clears the notices too.

The top-right scoreboard card, `FzpScoreboard` with its phone score bar and sheet, and `--scorebar-h` are gone (plan 3, layout ruling 1): the header score bar (`src/lib/sim-page/ScoreBar.svelte`, `data-testid="score-bar"`, "{n} homes added") replaces them, and opens the score details (`FzpScorePanel`, the region "Score details") under the header: a popover at the top right from 768 px, a full-width disclosure below. With no bottom score bar, the scrubber sits at the bottom on phones.

The ready-phase notices (the stopped chip with Retry, "Making another future…", the dismissible reroll alert, and on `/sim` the lever notices in `data-testid="fzp-lever-status"` and the failed-revision alert in `data-testid="fzp-lever-failed"`) sit in one row just above the scrubber, never at the top of the map, so they never cover the card or the score details. The loading notice is top centre on a phone and top left from 768 px (right of the docked policy panel).

## The debug hook

`window.__sfhFzp` (`src/lib/fzp/debug.ts`) is read-only and exists only in a build made with `VITE_E2E=1` (the e2e build sets it; otherwise the branch is constant-false and dropped). Each field is a getter over the live page state.

| Field             | Meaning                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `phase`           | `'loading'`, `'ready'`, `'failed'` or `'no-scenario'`                                                                                                              |
| `seed`            | the shown future's seed, `null` until the first timeline                                                                                                           |
| `representative`  | true for the representative future (no `?seed=` in the URL)                                                                                                        |
| `day`             | the scrubbed `Day`                                                                                                                                                 |
| `asOf`, `horizon` | the scrubber's range                                                                                                                                               |
| `playing`         | whether the frame loop is running                                                                                                                                  |
| `score`           | the latest `TimelineScore`, or `null`; `score.band` and `planEffect` may be incomplete until the band runs finish (the score details mark those lines `aria-busy`) |
| `levers`          | `/sim`'s lever status: `{ status, done, total, sentRev }`, see [sim-page.md](sim-page.md)                                                                          |

`window.__sfhMap` (`src/lib/map/debug.ts`) gives the MapLibre map. Test helpers: `e2e/helpers/sharing.ts` (`jumpAndIdle`, `projectToPage`, `FRAME`, `headerAction`, `openHeaderMenu`) and `e2e/helpers/a11y.ts`. The specs are `e2e/fzp.spec.ts`, `e2e/fzp-sim.spec.ts` and, for `/sim`'s own controls, `e2e/sim.spec.ts`.

## Request flow

- **Scenario:** `FzpMode` owns a `ScenarioClient` (`src/lib/sim/scenario-client.ts`) over the simulation worker. `startScenario` is the only caller of `initScenario`; "Another future" and "Back to the representative future" go through `requestReroll`. Each request carries a revision; timelines and errors for older revisions are dropped. The page writes `?seed=N` through `onurlseed` only for the answer to a reroll (a null seed is the representative future and removes the parameter). Unknown query parameters are kept.
- **Prefetch:** after the first timeline following each `initScenario`, and on every `moveend`, the page asks the worker to fetch the parcel chunks for the viewport. The worker fetches only those chunks, the three `scenarios/fzp/` timelapse files and, because `/sim` always initialises with levers, `policy.bin`. `frontage.bin`, `transit.json` and `neighborhoods.geojson` are fetched only for brushes (see [sim-page.md](sim-page.md), "Request flow").
- **Picks:** SimMap reports `timelinePick` events. A hover over a part feeds the tooltip's requester; a tap or mouse click feeds the card's requester; a tap or click on nothing closes the card. Hover shows a tooltip only. Existing buildings keep SimMap's own tooltip. Parts of a simulated project are pickable only while visible at the scrubbed day.
- **Summaries are latest-wins** (`summary-request.ts`). One `SummaryRequester` per surface (card, tooltip): at most one request in flight and one queued behind it, and only the latest query's answer reaches the UI. While a card is on show, a request for the same parcel and project keeps it on show until the answer replaces it (no flash of "loading" on every month). A `not-loaded` answer is retried on each worker `chunks` message.
- **Card refresh:** the open card asks again when the scrubbed month changes, when a reroll or crash Retry answers, and when the worker crashes (then it reads "Details unavailable" until Retry).

## The T9 lookups seam

The card's chance lookup (`chanceTable`) and the map's stage-duration lookup (`typicalMonths`) start from the base `calibration.json` (`lookupsFor` in `FzpMode.svelte`, one object per calibration object, because SimMap compares lookups by identity). `pushLookups` is the single call site that hands them to the map.

The seam is switched on `/sim` (plan 3). Every session initialises with levers (`startScenario({ seed })` sends the current `levers` with `initScenario`), and once a lever revision is `current` the worker's posted `lookups` (`{ inFlight, fresh }`, [sim-levers.md](sim-levers.md)) replace the calibration's: the map gets `lookups.fresh` (Call 13: it takes one set, and most bars over the horizon are new projects), and each card picks its cohort's table (`card.lookups`, `'inFlight'` or `'fresh'`, shifted by `chanceShift` for an in-flight project in a rescaled stage). Until then the main-thread tables stand in. Nothing else in the page should read the calibration for these tables.

## Known gap: no keyboard access to cards

Map picking is pointer-only (mouse click, touch tap, hover), a gap shared with the editor's tooltips (see "Known gap" in [map-interfaces.md](map-interfaces.md)). A keyboard user can drive the scrubber, the score details and the sources dialog, but cannot open a project card. Once a card is open it is a normal region with a Close button, and Escape closes it (unless the sources dialog is open, which takes Escape first).

## The chart's y domain

`ScoreChart` (`chart.ts`) draws every series on one y axis. The domain covers every drawn value, the references and the RHNA target. It starts at 0, **unless a drawn value is negative**: the plan-effect series can be early on. Then the axis reaches down to `-niceCeil(-min)` so the negative part stays inside the plot, and a floor gridline is added when it is clear of the zero line. Spec section 4.6 says "0 to niceCeil"; the extension is deliberate.

## e2e notes

- Run on port 4206 with one worker: `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/sim.spec.ts e2e/fzp.spec.ts e2e/fzp-sim.spec.ts`.
- `e2e/fzp.spec.ts` opens the timelapse at `/sim?start=fzp` (`gotoFzp`; a reroll's URL is `/sim?start=fzp&seed=N`). `e2e/sim.spec.ts` covers the `/fzp` redirect itself (`/fzp?seed=5` lands on `/sim?seed=5&start=fzp`).
- The fixture dataset (`fixture-0`) has two parcel chunks (cell 50_25, 15 parcels; cell 51_25, 3 parcels, lots 15 to 17) and five scenario files. `/sim` reads four at load (`parcels.bin`, `projects.json`, `calibration.json`, `policy.bin`) and `frontage.bin` for the brush catalog, which the policy panel asks for when it first opens (by default from 768 px). Tests read `projects.json`, `calibration.json`, `frontage.bin`, `parcels.bin` and the chunk from disk and derive counts, ids and labels; do not hard-code them.
- fixture-0's two parcel chunks are neighbouring cells about 700 m apart, so they cannot show over-fetching by themselves. `e2e/fzp-sim.spec.ts` adds a third, far-away chunk to the manifest the page loads (route on `manifest.json`, reached by client navigation as below), asserts it is not requested while the viewport is elsewhere, then pans to it and asserts it is.
- The score details are one region ("Score details") under the header; open them with the score bar (`data-testid="score-bar"`). Below 768 px the header's links and actions ("Policy", "Another future") wait in the Menu: use `headerAction` / `openHeaderMenu` (`e2e/helpers/sharing.ts`). The phone policy sheet is a modal `<dialog>`, so close it before pressing anything outside it.
- A first load of `/sim` takes the manifest from the server's render, so `page.route` on `manifest.json` has no effect there. To test a dataset without scenarios, navigate to `/sim` from `/about` (a page that loads no manifest) with the route in place.
- Axe and the footer check: `expectNoA11yViolations` runs with the card open, with the sources dialog open (scoped to the dialog, `structure: true`), with the score details open and, in `e2e/sim.spec.ts`, with the policy panel open and with the Area brush form open. At 375 px the footer links must stay unobscured with the scrubber, the card, the score details and the phone tool bar showing.
