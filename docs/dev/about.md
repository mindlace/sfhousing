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
| Assumptions           | `about-assumptions` | the heading only, until the assumptions arrive                             |
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
The page fetches nothing in the browser: several e2e specs use `/about` as a neutral page to
navigate from. The deploy smoke checks read the dataset version from `/about`.

## `/attribution`

A permanent redirect: `redirect(308, '/about#about-data')`, so old links (and the hashed
`ScoreboardPanel` link) land on Data and licences. The footer's "Data & licences" links
`/about#about-data` directly.

## The colours

The page is light at every setting; the dialog on `/sim` follows the theme. So the parts carry no
`dark:` utilities and no gray, white, black or ink utilities of their own: text colour is inherited,
and they read two custom properties the container sets:

- `--about-muted`: muted text (the Retrieved dates, the Painting caption).
- `--about-line`: rules and borders (the tables' head rows).

`/about` sets them to `var(--color-ink-muted)` and `var(--color-line)` on the parts' wrapper.
`AboutParts.svelte.spec.ts` checks the rendered classes.

## Still to come in slice 9

The assumptions' loading on the page, the dialog on `/sim` and the link rule, and the map's credit
are added here by the tasks that build them.
