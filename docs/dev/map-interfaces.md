# Map-view interfaces for page and subsystem consumers

Contracts that `SimMap` (`src/lib/map/SimMap.svelte`) publishes for code that lives outside it, such as the dock, the palette strip and sheets.

## Bottom-right controls footprint

MapLibre's bottom-right container (`.maplibregl-ctrl-bottom-right`, holding the attribution) occupies a corner of the map. Anything anchored to the map's bottom-right must clear it. `SimMap` publishes the footprint as two CSS custom properties.

| Property                        | Meaning                                                                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--map-controls-br-inline-size` | px from the map root's right edge to the left edge of the controls: horizontal clearance for right-anchored elements.                                           |
| `--map-controls-br-block-size`  | px from the map root's bottom edge to the top edge of the controls. Includes the bottom-inset lift (`setBottomInset`), so it is measured from the map's bottom. |

- **Where:** on `document.documentElement` (`:root`), and mirrored on the `[data-testid=map-root]` element. Publish on `:root` because consumers (the dock, the palette strip, the notice pills) are siblings of SimMap's root inside `BrushEditor` and FzpMode, not descendants, so a variable on the map root is invisible to them. Only one `SimMap` mounts per page.
- **Direction:** the values are physical right and bottom distances (the app is LTR only), not logical inline-end/block-end.
- **Remount:** consumers see a transient `0px` while the map remounts (new manifest), until the new map re-measures.
- **Units:** integer px (`Math.ceil`), always with the `px` suffix.
- **Zero:** `0px` while the map is loading, unsupported, in error, or when the container is empty or hidden. Both properties are removed from `:root` when `SimMap` unmounts, so consumers should use a fallback: `var(--map-controls-br-inline-size, 60px)`.
- **Updates:** a `ResizeObserver` on the controls container and the map root, plus a re-measure after `setBottomInset`, coalesced to one `requestAnimationFrame`. Expanding or collapsing the compact attribution resizes the container and so updates the value. Nothing runs on map `move` (zero map-view JS during pan).
- **Geometry:** the pure function `controlsFootprint` in `src/lib/map/footprint.ts`.

Example:

```css
.my-floating-button {
  position: absolute;
  right: max(1rem, var(--map-controls-br-inline-size, 60px));
  bottom: max(1rem, var(--map-controls-br-block-size, 60px));
}
```

## The dock's width and the bottom-left control

`Dock` (`src/lib/dock/Dock.svelte`) publishes `--dock-w` on its host, the nearest ancestor with the class `sfh-dock-host` (on `/sim` and `/s/<id>`, FzpMode's root; on `/` and `/p/:id`, BrushEditor's): from 768 px, `320px` while the panel is open and `48px` while it is folded to the rail; unset below 768 px (the phone sheet sits over the map's bottom instead) and when no dock renders. Anything placed over the map from the left reads it with a fallback, `calc(var(--dock-w, 0px) + 1rem)` (the notice stack's centre, SimMap's failure chips' centre, `calc(50% + var(--dock-w, 0px) / 2)`, and the left of the area the project card may take: the card opens beside the clicked building, never under the dock or a showing notice pill; see [fzp-mode.md](fzp-mode.md), "Card placement").

The same host rule moves MapLibre's bottom-left container (`.maplibregl-ctrl-bottom-left`: zoom and compass, fine pointers only) to `left: var(--dock-w)`, so the dock never covers it (WCAG 2.2 2.4.11). Below 768 px the phone sheet's height is added to the map's bottom inset (`setBottomInset`, through FzpMode's `bottomExtra`; on `/` and `/p/:id`, BrushEditor's inset is the sheet's height alone: nothing sits under the sheet there, since the score is in the header, so `--fzp-scrubber-h` is unset and reads as 0), so both bottom containers, and `--map-controls-br-block-size`, sit above the sheet's handle. While the phone palette strip shows, `PaletteStrip` lifts the bottom-left controls (the navigation control on fine pointers, SimMap's Reset view button on coarse ones) 4rem above the inset, clear of the strip.

## The notice pills and the failure chips

From 768 px the page's notice stack (`NoticePills`, `src/lib/shell/NoticePills.svelte`, on `/sim`, `/s/<id>`, `/` and `/p/:id`) overlays the map's top centre, where `SimMap`'s failure chips ("Some parcels didn't load", "Existing buildings couldn't load") sit too. So `NoticePills` publishes the stack's bottom edge, in px from its host's top (the host is its parent element: FzpMode's root or BrushEditor's, whose top is the map's), as `--notice-pills-bottom` on that host, and `SimMap` places the chips that far down plus their own offsets (0.5rem and 4rem), so a notice never covers a chip's Retry. It is `0px` while the stack is empty and below 768 px, where the stack is in flow above the map; it is removed when the stack unmounts, so `SimMap` reads it with a `0px` fallback.

Consumers of `--map-controls-br-block-size` from md include the project card's placement area (`cardArea` in `src/lib/fzp/card-place.ts`): its bottom is the map's height less the larger of the time bar and this footprint, so a card opened beside a building never covers the attribution; its left is right of the bottom-left controls' right edge (read from their box). A change to the footprint re-places an open card (`watchCardArea`, `src/lib/fzp/card-area-watch.ts`, watches the inline value on `:root`). Below md the card is a bottom sheet over the same footprint (see [fzp-mode.md](fzp-mode.md), "Card placement").

## Transit layers

Transit spec section 6. `SimMap` draws a transit access surface and the stops as ordinary MapLibre layers, present only when the manifest names `transit` (`src/lib/map/style.ts`).

- **Sources:** GeoJSON `transit-access` (binned 10-minute-walk capacity polygons) and `transit-stops`. The stops source is filled from `transit.json`, the access source once the map is idle (the grid is built on the main thread).
- **Layers:** `transit-access` (fill) and `transit-stops-bus`, `transit-stops-rail`, `transit-stops-regional` (circles; bus from zoom 15, rail from 13, regional always). Stack order: base, `transit-access`, `existing-buildings`, chunk layers, labels, the stop layers, `overlay-anchor`. So the surface sits under existing buildings and the stops sit above the labels.
- **Props:** `SimMapProps.view` (`ViewPrefs`: `transitStops`, `transitAccess`, `heightLimits`; default stops off, capacity on, limits on; SimMap reads only the two transit fields) toggles layer `visibility`; `SimMapProps.fetchTransit` replaces the `transit.json` loader (tests inject a fixture network).
- **Why MapLibre layers:** `setOverlayLayers` is single-owner (the overlay mux, `src/lib/map/overlay-mux.ts`, on `/` and `/sim`: on `/` its `outline` slot holds the selected row's outline and its `ring` slot the brush ring), so transit does not use it.
- **UI gating:** the header View menu (`src/lib/view/ViewMenu.svelte`; prefs persist in localStorage `sfhousing:view`, one record for every route). Gating is per route. On `/` and `/p/:id` it is mounted only when `manifest.transit` is set, with the two transit rows (the default `rows`); those pages never show `heightLimits` and write back the value they read. On `/sim` (and `/s/:id`) the menu is always mounted in Setup, so only the transit rows are gated on `manifest.transit` (the limits row needs no transit), with `rows` `['transitStops', 'transitAccess', 'heightLimits']`, or `['heightLimits']` without `manifest.transit`; during a run the menu goes and the map gets `HIDDEN_VIEW` (every layer off), and the toggles come back with Setup. Without `manifest.transit` there are no transit sources, layers or transit rows, and `transit.json` is never fetched.
- **Known gap:** the stop tooltip is pointer-only. It has no keyboard parity yet.

## Height limits

Height-lids spec (`docs/superpowers/specs/2026-11-01-height-lids-design.md`); it replaces the height fog (sim-runs spec §4), whose layer, grid and token are gone. `/sim` draws the zoning height limit as glass lids over the lots (zoomed in) and as contour lines on the ground (zoomed out), through SimMap's `setOverlayLayers` in the overlay mux's `limits` slot (`src/lib/map/overlay-mux.ts`), so it is a deck layer, not a MapLibre one.

- **Layer:** `HeightLimitsLayer` (`src/lib/map/height/limits-layer.ts`, id `LIMITS_LAYER_ID` = `sim-height-limits`), built by `heightLimitsLayer({ city, lids, mode, theme })`. A composite layer: glaze faces and walls (depth-tested against MapLibre's buildings, see [testing.md](testing.md)), ink rims, contour chains and two label layers. Lids fade in and contours fade out over `LIDS_FADE` (zoom 14.5 to 15.5); a sublayer at opacity 0 is hidden, not dropped. The look per mode is pure (`limits-style.ts`).
- **Data, two messages** ([sim-levers.md](sim-levers.md)): the scenario worker posts `heights` (`HeightCity`: city-wide contour chains and region labels) with each lever revision; FzpMode's `onheights` hands it to SimPage ([fzp-mode.md](fzp-mode.md)). The lids are a request: `SimClientApi.heightLids(bbox)` answers a `HeightLids` for the view (pieces, faces, rims, walls, labels), tagged with the `limitsRev` and `sourceIds` of the limits it was built on. SimPage asks on each `moveend` from z14.5 (`LidRequest`, latest wins) with the view bbox clamped to 3 km (`LID_MAX_SPAN_M`) around the view centre, so a pitched view far out asks for a bounded area.
- **Modes:** `LimitsView` is `{ kind: 'plain' } | { kind: 'paint' } | { kind: 'rule'; ruleId } | { kind: 'fzp' }`. Plain: a solid translucent edge at limit steps, source boundaries hidden. Paint (brush or eraser chosen, or a painted area selected in `/sim`): lots set by paint, and the lines bounding them, are dashed in the paint tone, source boundaries included. Rule: the selected rule's rims and its lot-set outline are full edge colour (the outline 1.5 px), everything else dims, glaze shows on its lots only; zoomed out, its outline is a bold contour. The page passes a rule by id; the layer maps it through the `sourceIds` of the lids or of the city (they may be from different revisions), so a rule that decides nothing in one of them dims everything there. `fzp` (the FZP baseline row selected in `/sim`) is rule mode on `SRC_FZP`: the lots FZP sets in full edge colour, everything else dimmed.
- **Gating:** drawn only in Setup with `viewPrefs.heightLimits` on (the View menu's "Zoning height limits" row, default on) and a city in hand; the slot is emptied for a run and refilled by Edit policy (or Policy in the view). It is not gated on `manifest.transit`. Selecting a Transit tab row (a layer or the FZP baseline) turns the row on.
- **Theme:** the `limit-ink`, `limit-edge`, `limit-glaze`, `limit-wall` and `limit-halo` tokens (and `painted-outline` for the paint tone) of the system theme (`useSystemTheme()`, the same instance that themes the View menu's swatches). Only the layer rebuilds on a theme change, not the data.
- **Labels:** one per region (a component of lots with the same limit, joined across streets up to 30 m), showing the limit and the room to grow. Placement is per zoom in the worker (`placeLabels`), then a screen-space collision pass (`declutter`) on the main thread, one per label key (integer zoom, pitch and bearing steps), so the labels shown never overlap. When part of a component is set by paint, the plain-mode label still shows the whole region's room to grow (and the rule selection dims it only when none of the region's lots are the rule's); only its placement sits on the roomier part, which can leave it less space, so it may drop out at lower zooms. Paint mode labels the paint part and the rest separately, each with its own room.
- **Module:** `limits-layer.ts` is lazy-imported once on mount, beside `@deck.gl/layers`.

## Timeline lookups and cohorts

`SimMapHandle.setTimelineLookups(l)` takes a lookup set (`{ chance, typicalMonths }`, from `chanceTable` and `typicalMonths`) and, optionally, a second set under `inFlight` (plan 4, Call 15). Absent `inFlight`, in-flight slots read the top-level (fresh) set, so `/fzp` is unchanged. The packed cell carries `slotCohort: Uint8Array` (0 fresh, 1 in flight; in the transferables and validated: wrong length or a value above 1 fails). The chance texture has 36 rows, `chanceRow(pathway, stage, cohort) = cohort · 18 + pathway · 6 + stage`; a bar's `segRow` and typical days read its slot's cohort. Lookups compare by identity, so send one object per posted `lookups`. The shader is unchanged (the row index is per-instance data). The map does not apply the in-flight `chanceShift` (a card does): see [sim-page.md](sim-page.md), Known gaps. Details: [fzp-mode.md](fzp-mode.md), "Cohort-aware bars".
