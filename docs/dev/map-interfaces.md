# Map-view interfaces for page and subsystem consumers

Contracts that `SimMap` (`src/lib/map/SimMap.svelte`) publishes for code that lives outside it, such as the brush toolbar and sheets.

## Bottom-right controls footprint

MapLibre's bottom-right container (`.maplibregl-ctrl-bottom-right`, holding the attribution) occupies a corner of the map. Anything anchored to the map's bottom-right must clear it. `SimMap` publishes the footprint as two CSS custom properties.

| Property                        | Meaning                                                                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--map-controls-br-inline-size` | px from the map root's right edge to the left edge of the controls: horizontal clearance for right-anchored elements.                                           |
| `--map-controls-br-block-size`  | px from the map root's bottom edge to the top edge of the controls. Includes the bottom-inset lift (`setBottomInset`), so it is measured from the map's bottom. |

- **Where:** on `document.documentElement` (`:root`), and mirrored on the `[data-testid=map-root]` element. Publish on `:root` because consumers such as the brush toolbar are siblings of SimMap's root inside `BrushEditor`, not descendants, so a variable on the map root is invisible to them. Only one `SimMap` mounts per page.
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
