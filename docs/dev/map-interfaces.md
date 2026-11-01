# Map-view interfaces for page and subsystem consumers

Contracts that `SimMap` (`src/lib/map/SimMap.svelte`) publishes for code that lives outside it, such as the brush toolbar and sheets.

## Bottom-right controls footprint

MapLibre's bottom-right container (`.maplibregl-ctrl-bottom-right`, holding the attribution) occupies a corner of the map. Anything anchored to the map's bottom-right must clear it. `SimMap` publishes the footprint as two CSS custom properties.

| Property                        | Meaning                                                                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--map-controls-br-inline-size` | px from the map root's right edge to the left edge of the controls: horizontal clearance for right-anchored elements.                                           |
| `--map-controls-br-block-size`  | px from the map root's bottom edge to the top edge of the controls. Includes the bottom-inset lift (`setBottomInset`), so it is measured from the map's bottom. |

- **Where:** on `document.documentElement` (`:root`), and mirrored on the `[data-testid=map-root]` element. Publish on `:root` because consumers such as the brush toolbar are siblings of SimMap's root inside `BrushEditor`, not descendants, so a variable on the map root is invisible to them. Only one `SimMap` mounts per page.
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

## Transit layers

Transit spec section 6. `SimMap` draws a transit access surface and the stops as ordinary MapLibre layers, present only when the manifest names `transit` (`src/lib/map/style.ts`).

- **Sources:** GeoJSON `transit-access` (binned 10-minute-walk capacity polygons) and `transit-stops`. The stops source is filled from `transit.json`, the access source once the map is idle (the grid is built on the main thread).
- **Layers:** `transit-access` (fill) and `transit-stops-bus`, `transit-stops-rail`, `transit-stops-regional` (circles; bus from zoom 15, rail from 13, regional always). Stack order: base, `transit-access`, `existing-buildings`, chunk layers, labels, the stop layers, `overlay-anchor`. So the surface sits under existing buildings and the stops sit above the labels.
- **Props:** `SimMapProps.view` (`ViewPrefs`: `transitStops`, `transitAccess`, `heightFog`; default stops off, capacity on, fog on; SimMap reads only the two transit fields) toggles layer `visibility`; `SimMapProps.fetchTransit` replaces the `transit.json` loader (tests inject a fixture network).
- **Why MapLibre layers:** `setOverlayLayers` is single-owner (on `/` the generated-buildings deck layers, on `/sim` the overlay mux), so transit does not use it.
- **UI gating:** the header View menu (`src/lib/view/ViewMenu.svelte`; prefs persist in localStorage `sfhousing:view`, one record for every route). Gating is per route. On `/` and `/p/:id` it is mounted only when `manifest.transit` is set, with the two transit rows (the default `rows`); those pages never show `heightFog` and write back the value they read. On `/sim` (and `/s/:id`) the menu is always mounted in Setup, so only the transit rows are gated on `manifest.transit` (the fog row needs no transit), with `rows` `['transitStops', 'transitAccess', 'heightFog']`, or `['heightFog']` without `manifest.transit`; during a run the menu goes and the map gets `HIDDEN_VIEW` (every layer off), and the toggles come back with Setup. Without `manifest.transit` there are no transit sources, layers or transit rows, and `transit.json` is never fetched.
- **Known gap:** the stop tooltip is pointer-only. It has no keyboard parity yet.

## Height fog

Sim runs spec (`docs/superpowers/specs/2026-10-31-sim-runs-design.md`) §4. `/sim` draws the allowed height as a translucent, smoothed surface over the whole city (`HeightFogLayer`, id `sim-height-fog`, `src/lib/map/fog/fog-layer.ts`), through SimMap's `setOverlayLayers` in the overlay mux's `fog` slot (`src/lib/sim-page/overlay-mux.ts`), so it is a deck layer, not a MapLibre one.

- **Data:** the scenario worker posts a `FogGrid` (`src/lib/map/fog/grid.ts`, 50 m cells over the map bounds) with each lever revision; FzpMode's `onfog` hands it to SimPage once per kept rev ([sim-levers.md](sim-levers.md)). `fogInstances(grid)` is derived per grid; `heightFogLayer(instances, grid, theme)` builds the layer, so a theme change rebuilds the layer, not the instances.
- **Gating:** drawn only in Setup with `viewPrefs.heightFog` on (the View menu's "Height limits" row) and a grid in hand; the slot is emptied for a run and refilled by Change policy (or Back to start). It is not gated on `manifest.transit`.
- **Theme:** the `height-fog` token of the system theme (`useSystemTheme()`, the same instance that themes the View menu's swatches).
- **Module:** `fog-layer.ts` is lazy-imported once on mount, beside `@deck.gl/layers`.

## Timeline lookups and cohorts

`SimMapHandle.setTimelineLookups(l)` takes a lookup set (`{ chance, typicalMonths }`, from `chanceTable` and `typicalMonths`) and, optionally, a second set under `inFlight` (plan 4, Call 15). Absent `inFlight`, in-flight slots read the top-level (fresh) set, so `/fzp` is unchanged. The packed cell carries `slotCohort: Uint8Array` (0 fresh, 1 in flight; in the transferables and validated: wrong length or a value above 1 fails). The chance texture has 36 rows, `chanceRow(pathway, stage, cohort) = cohort · 18 + pathway · 6 + stage`; a bar's `segRow` and typical days read its slot's cohort. Lookups compare by identity, so send one object per posted `lookups`. The shader is unchanged (the row index is per-instance data). The map does not apply the in-flight `chanceShift` (a card does): see [sim-page.md](sim-page.md), Known gaps. Details: [fzp-mode.md](fzp-mode.md), "Cohort-aware bars".
