# About this model

"About this model" is the one place for background: what the numbers mean, the assumptions, the
data and licences with every credit, and how to use the app. It is the page `/about`; its parts
live in `src/lib/about/` so that `/sim` can show the same content in a dialog.

## The parts and their ids

Four parts, in this order. Each part's root is a `<section>` with its id; links name them as
`/about#<id>` (`ABOUT_ID`, `src/lib/about/copy.ts`). The ids carry an `about-` prefix so that the
dialog on `/sim` never duplicates an id the page already holds.

| Part                  | Id                  | Component                                                                  |
| --------------------- | ------------------- | -------------------------------------------------------------------------- |
| What the numbers mean | `about-meanings`    | `AboutMeanings.svelte`: the terms of `MEANINGS`                            |
| Assumptions           | `about-assumptions` | `AboutAssumptions.svelte`: the Sources dialog's body, loaded on demand     |
| Data and licences     | `about-data`        | `AboutData.svelte`: version, sources, notices, Software, the code line     |
| Using it              | `about-using`       | `AboutUsing.svelte`: Keyboard shortcuts (`about-shortcuts`) and Your plans |

Every part takes `level` (`2 | 3`): its heading's level, 2 on the page and 3 in a dialog; its
sub-headings are one deeper. `AboutData` also takes `datasetVersion` and `manifest`
(`ManifestSources | null`); without a manifest it shows "Dataset version {v}." and "Source list
unavailable for this dataset version." and the fixed notices.

## The strings

Every string of the parts is in `src/lib/about/copy.ts`, except the notices of Data and licences,
which stay in `AboutData.svelte` as they were on `/attribution`. Part 1's amounts, dates and its
source link are read from `GOAL`, `bufferAmount` (`src/lib/goal/goal.ts`) and `M1_TARGETS[0]`,
never copied; "Room for N homes" reads `ROOM_MEANS` (`src/lib/paint/details.ts`). The Painting
shortcuts table is `SHORTCUTS` (`src/lib/brush/shortcuts.ts`), the list Paint's Shortcuts button
shows.

## The Overture notice

`overtureNotice(sources)` (`src/lib/about/credits.ts`) builds the buildings notice from the
manifest's `overture:*` sources: grouped by licence (ODbL-1.0, then CC-BY-4.0, then any other
licence in manifest order), names in manifest order, each name the source's label less " via
Overture Maps". `AboutData` renders "Buildings © Overture Maps Foundation, from {names} under the
ODbL and {names} under CC BY 4.0.", linking each licence (`LICENCE_LINK`); with no `overture:*`
source, "Buildings © Overture Maps Foundation, under the ODbL." What each licence requires is in
the slice 9 plan's licence section (`docs/superpowers/plans/2026-11-23-about-this-model.html`).

## The page

`src/routes/about/+page.svelte`: the heading "About this model", the line under it, then the four
parts at level 2. `+page.server.ts` reads `manifest.json` for the dataset version from R2 and
passes `datasetVersion` and `manifest` (null when the manifest is missing, invalid or unreadable).
The page fetches nothing in the browser until the reader opens the assumptions: several e2e specs
use `/about` as a neutral page to navigate from. The deploy smoke checks read the dataset version
from `/about`.

## The assumptions

`AboutAssumptions.svelte` (`{ level; live?; datasetVersion?; manifest?; fetchFn? }`) renders
`ProvenanceBody` ([fzp-mode.md](fzp-mode.md)), the Sources dialog's sections and strings unchanged,
one heading level under the part.

- `live` (`{ sections, projectsUrl }`, the dialog on `/sim`): the run's sections at once, no
  disclosure, no fetch of the calibration. The part exports `loadChecks()`, which passes through
  to the body's: the dialog calls it on every open (it loads once, and retries after a failure).
- On the page: a `<details>` "Show the assumptions" (`ASSUMPTIONS_SHOW`). Its first open fetches
  `manifest.scenarios.fzp.calibration` (`fetchCalibration`) and shows `modelSections`; then the
  data checks load `manifest.scenarios.fzp.projects`. Closing and opening again fetches nothing,
  except that a failed data-checks load tries again on the next open (`loadChecks()`).
  These are the same-origin, immutable `/data/<version>/…` files `/sim` loads.
- The state shows as a `Message`: "Loading…", then nothing, or `ASSUMPTIONS_FAILED` with Retry
  (`BUTTON_QUIET`), which loads again. One `role="status"` region, a plain `sr-only` block mounted
  with the disclosure, carries the same words alone (never Retry), so each change is announced once
  (no `display: contents`, whose role older WebKit dropped).
- No `fzp` scenario in the manifest (or no manifest): the heading and `ASSUMPTIONS_FAILED`, with
  no disclosure and no Retry.
- A hash naming `about-assumptions` or any `src-…` id, on mount or on a later `hashchange` (a
  pasted link, back or forward; the listener goes with the part), opens the disclosure (and so
  loads); once the target exists it is scrolled to (`block: 'start'`), once, after a failure and
  Retry too, and focused (`tabindex="-1"`, `preventScroll`), so a keyboard user's next Tab starts
  there. The hash is taken as written, never decoded (the ids are ASCII; a stray `%` would
  throw).
- The disclosure is not `bind:open`: Svelte's binding writes the state over the element on
  hydration, closing a disclosure pressed before then. The part reads `details.open` on mount and
  follows `toggle`.

`Message` follows the theme (its `dark:` partners), so in a dark system its card is dark on the
light page; the body's tier badges and head rules keep `control-line` with its dark partner.

The data checks have one way in: `loadChecks()`. `ProvenanceBody` exports it (it starts the load,
is a no-op in flight or once loaded, and retries after a failure); `AboutAssumptions` passes it
through, calls it on each open of the page's disclosure, and the dialog calls it on each open.

## `/attribution`

A permanent redirect: `redirect(308, '/about#about-data')`, so old links (and the hashed
`ScoreboardPanel` link) land on Data and licences. The footer's "Data & licences" links
`/about#about-data` directly.

## The colours

The page is light at every setting; the dialog on `/sim` follows the theme. So the parts' own
markup carries no `dark:` utilities and no gray, white, black or ink utilities: text colour is
inherited, and they read two custom properties the container sets. Two things inside part 2 follow
the theme on their own: `ProvenanceBody`'s tier badges and tables' head rules
(`border-control-line dark:border-control-line-dark`) and the page's `Message` states. On the light
page in a dark system both show their dark partners (still legible; ruled acceptable in Task 2's
review). The properties:

- `--about-muted`: muted text (the Retrieved dates, the Painting caption).
- `--about-line`: rules and borders (the tables' head rows).

`/about` sets them to `var(--color-ink-muted)` and `var(--color-line)` on the parts' wrapper.
`AboutDialog` sets them on its scroll box with dark partners (`ink-dark-muted`, `line-dark`); the
muted text is 4.5:1 or better on its surface in both themes (`accent.spec.ts`). `AboutParts.svelte.spec.ts` checks the
rendered classes; `AboutDialog.svelte.spec.ts` the computed colours in light and dark.

## The dialog on `/sim`

On `/sim` and `/s/<id>` leaving the page would drop the playhead, the furthest date reached and
the live assumptions, so About opens over the map instead. `src/lib/about/AboutDialog.svelte`
(props `{ manifest; datasetVersion; sections; projectsUrl; fetchFn?; onopen? }`) is a native modal
`<dialog>` on the shared surface (`SURFACE_DIALOG_FLUSH`) headed "About this model" (h2), with
Close (`BUTTON_QUIET`), then the four parts at level 3, part 2 live (`sections` is the run's
`provenanceSections(calibration, score, terms)`). `TimelineMode` mounts it while it has a
calibration and a scenario (the Sources dialog's old place and condition).

- `open(target = '')`: `''` is the top; an `ABOUT_ID` value or an entry id (`src-…`) is scrolled
  to the top of the dialog's scroll box. Every open calls `onopen` (the page pauses Play) and
  `loadChecks()`.
- Nothing is built before the first open: the parts mount then and stay, so nothing is fetched
  until About is first opened, and `sections` (a lazy prop) is not computed before it.
- Focus: Tab wraps inside. On close, focus returns to the opener while it is rendered
  (`getClientRects().length > 0`); otherwise to the header's Menu button (`focusHeaderMenu()`,
  for About pressed in the phone's Menu, which closed); otherwise the body.
- Escape: a capture-phase listener on the document closes the dialog and marks the key handled
  (`preventDefault`), so nothing under it (a card, the dock) also acts on it. A key already handled
  (an open explanation, `Explain`, takes Escape in the capture phase on the window) is left alone,
  and the dialog stays open for the next press.
- Colours: the scroll box sets `--about-muted` and `--about-line` with dark partners.

## The link rule

Every way into About is a link to `/about#…`: the header's About, Details' last line ("How this is
worked out", `WORKED_OUT`, to `/about#about-assumptions`), the card's sources (through
`open(id)`), and later the map's credit. `src/lib/about/links.ts`:

- `aboutTarget(a, origin)`: the fragment a link opens (`''` for `/about`), or null when it is not
  a same-origin link to exactly `/about`, or has a `target` other than `_self`, or `download`.
  The fragment is taken as written (the ids are ASCII), so a malformed one never throws.
- `interceptAboutLinks(open)`: while installed (the dialog installs it for its lifetime), a
  capture-phase click listener on `document`. A plain click (button 0, no Ctrl, Meta, Shift or
  Alt, not already handled) on an About link calls `preventDefault()` and `open(fragment, link)`.
  It runs before SvelteKit's router, which skips a handled click. Enter on a focused link is a
  click, so the keyboard follows the same rule. A modified or middle click, a `target=_blank` link
  and links to other pages are left to the browser (a new tab on `/about`; the run untouched).

Pages that mount no dialog (`/about` itself, Paint, `/p/<id>`, `/lesscars`) have no listener: their
About links navigate.

## Still to come in slice 9

The map's credit is added here by the task that builds it.
