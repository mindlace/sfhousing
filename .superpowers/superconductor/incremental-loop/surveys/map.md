# Survey: what the map offers today

Repository root: `/Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-feel`. Paths below are relative to it. Line numbers are from the files as read on 2026-11-24 on branch `worktree-incremental-feel`.

Marks: **V** = verified at a file:line I read. **I** = inferred. "Doc" = testimony from a doc or a code comment, not checked against behaviour.

Read-only survey. No design proposals.

---

## Doc and code disagreements found

| # | Doc or comment says | Code says |
|---|---|---|
| D1 | `docs/dev/map-interfaces.md:79`: stack order is "base, `transit-access`, `existing-buildings`, chunk layers, labels, the stop layers, `overlay-anchor`. So ... the stops sit above the labels." `src/lib/map/SimMap.svelte:1281` comment: "Stops draw on top of everything". | `src/lib/map/style.ts:374-382` puts the stop layers straight after `transit-access`, before the rest of the base (roads), before `existing-buildings` and before the labels. `style.ts:317-319` comment: "buildStyle puts them under the roads". (V) |
| D2 | `src/lib/map/types.ts:183` comment on `SimMapProps.view`: "default both on". | `src/lib/view/prefs.ts:15-19` `DEFAULT_VIEW` has both transit fields `false`; `SimMap.svelte:1153` uses `view ?? DEFAULT_VIEW`. `map-interfaces.md:80` agrees with the code. (V) |
| D3 | `map-interfaces.md:42`: "The OpenStreetMap link is a navigation in the same tab (`rel="noopener noreferrer"`, no `target`)." | `src/lib/map/attribution.ts:10` has `target="_blank"`. `map-interfaces.md:34` also says `target="_blank"`, so the doc disagrees with itself. (V) |
| D4 | `docs/dev/map-perf.md:96`: citywide playback case "Not yet run". | `map-perf.md:72` results row "after map-citywide (#134) ... every case p95 9.3 ms; recorded in the review spec". The case exists at `e2e/bench/map-timeline.bench.ts:87`. Doc disagrees with itself; I did not open the review spec. (V for both lines) |
| D5 | `src/lib/map/timeline-controller.ts:3` cites `map-interfaces.md` "Halos and marks"; `types.ts:131-134` says `setHalos` draws "Halos on stage changes ... and marks". | The doc section is "Policy marks" (`map-interfaces.md:124`) and says "it once drew rings too" (`:126`). `HaloLayer` draws one diamond per record and nothing else (`src/lib/map/timelapse/halo-layer.ts:1-6`, fragment shader `:118-124`). (V) |
| D6 | `src/lib/view/prefs.ts:20` comment on `HIDDEN_VIEW`: "what /sim's map gets during a run". | In non-test `src`, `HIDDEN_VIEW` is referenced only as `TimelineMode`'s prop default (`src/lib/timeline/TimelineMode.svelte:125`, `:315`). `SimPage` passes `view={viewPrefs}` (`src/lib/sim-page/SimPage.svelte:1260`). I found no code that passes `HIDDEN_VIEW` during playback; not traced further. (V for the grep; the claim itself unverified) |
| D7 | `map-interfaces.md:156`: street bars "from zoom 15", far bars "from zoom 12". | The alpha ramps in over the half zoom below the gate: `zoomAlpha = clamp01((zoom - (gate - 0.5)) / 0.5)` (`src/lib/map/timelapse/bars.ts:182-183`, `constants.ts:16`). So a bar is partly visible from gate − 0.5. A nuance, not a contradiction. (V) |
| D8 | `map-perf.md:47`: the pass bar is for "a 2022 MacBook Air (M2) class machine". | `map-perf.md:56`: the M2 row is "not yet recorded". Every recorded row is an Apple M5 Pro. (V) |

---

## (a) The map component's public surface

The component is `src/lib/map/SimMap.svelte`. One `SimMap` mounts per page (Doc, `map-interfaces.md:14`).

### Props (`SimMapProps`, `src/lib/map/types.ts:175-203`; destructured at `SimMap.svelte:109-123`)

| Prop | Type | Default | Notes |
|---|---|---|---|
| `manifest` | `Manifest` | required | A different manifest object tears the map down and builds a new one (`SimMap.svelte:472-486`). V |
| `theme` | `'light' \| 'dark'` | system theme | `SimMap.svelte:150`. V |
| `initialFrame` | `CameraFrame \| 'plan-bbox'` | `undefined` | Read once in `start()` (`SimMap.svelte:586`), inside `untrack` (`:479-484`). V |
| `planBBox` | `BBox` | `undefined` | Used only with `initialFrame: 'plan-bbox'` (`camera.ts:37-53`). V |
| `requestParcelSummary` | `(parcelId) => Promise<ParcelSummaryLike \| null>` | `undefined` | Feeds SimMap's own tooltip for existing buildings (`SimMap.svelte:1386-1400`). V |
| `onRetryChunks` | `() => void` | `undefined` | The "Some parcels didn't load" chip's Retry (`SimMap.svelte:1581`). V |
| `onready` | `(h: SimMapHandle) => void` | `undefined` | Fired once, after deck.gl has loaded and the overlay exists (`SimMap.svelte:862-864`). Not fired again on a remount (`:838`, `:862`). V |
| `view` | `ViewPrefs` | `DEFAULT_VIEW` | SimMap reads only `transitStops` and `transitAccess` (`SimMap.svelte:508-511`, `:1149-1160`). V |
| `fetchTransit` | `(url) => Promise<TransitNetwork>` | fetch + decode | Test seam (`SimMap.svelte:1177`). V |
| `timelinePick` | `(p: TimelinePick) => void` | `undefined` | See (c). V |
| `tapCards` | `boolean` | `true` | A touch tap opens SimMap's own card; off closes an open card (`SimMap.svelte:500-506`, `:1328`). V |
| `creditShowMs` | `number` | `0` in a `VITE_E2E` build, else `CREDIT_SHOW_MS` = 5000 | `SimMap.svelte:9`, `:122`. V |

There is no `children`, snippet or slot prop (V: `SimMap.svelte:109-123`; a grep of `src/lib/map` and `src/lib/view` for `Snippet`, `{@render`, `<slot` finds only `key/MapKeyControl.svelte`).

### Callbacks and events

- Callback props: `onready`, `onRetryChunks`, `timelinePick`, `requestParcelSummary` (above). V
- One DOM event: `mapunsupported`, a bubbling `CustomEvent` dispatched on the map root, once (`SimMap.svelte:1078-1080`). V
- No other `dispatchEvent` or event prop in the component (V: read in full).

### Exported methods (`SimMapHandle`, `types.ts:118-146`; the same functions are `export function`s on the component and are collected into `handle` at `SimMap.svelte:454-468`)

| Method | What it does | Where |
|---|---|---|
| `applyGenerated(u)` | Generated-building update (Paint). Ignored with one `console.error` in timeline mode. Queued until the controller exists. | `SimMap.svelte:262-273` V |
| `setChunkStatus(cellId, s)` | `'loading' \| 'ready' \| 'error'` per chunk; drives the chunk layers and the tooltip. | `:275-285` V |
| `setPanEnabled(enabled)` | See (d). Also clears any shown tooltip or card when `false`. | `:287-291`, `:1107-1119` V |
| `setBottomInset(px)` | `map.setPadding({ bottom: px })`, sets `--map-bottom-inset`, re-measures the footprint. Works before the map exists. | `:293-300` V |
| `getMap()` | Returns the MapLibre `Map` or `null`. | `:386-388` V |
| `setOverlayLayers(layers)` | Replaces the consumer's deck layers. Throws on a layer id matching `/^(generated\|rising\|timeline)-/`. | `:390-396` V |
| `onResyncNeeded(cb)` | One callback, called on a revision gap or after a remount with nothing queued. | `:398-400`, `:860`, `:892`, `:999` V |
| `applyTimeline(u)` | Enters timeline mode on the first call (kept until unmount); validates every cell and the `city` delta first; queues until ready. | `:407-419` V |
| `setTime(day)` | Throws `RangeError` on a non-finite day. Kept and applied when the timeline controller exists. | `:422-426` V |
| `setTimelineLookups(l)` | Validates by packing the chance texture; kept like the day. | `:432-436` V |
| `setHalos({ from } \| null)` | Policy marks on or off. Kept like the day. | `:439-444` V |
| `setBarMode('street' \| 'far')` | Kept like the day. | `:447-452` V |
| `collapseCredit()` | Collapses the attribution unless focus is inside it. | `:791-796` V |

Module export: `CREDIT_SHOW_MS = 5000` (`SimMap.svelte:9`). V

In an e2e build only (`VITE_E2E === '1'`), `window.__sfhMap` exposes the map, snapshots, `timelinePartAt(x, y)` and the synthetic loaders (`src/lib/map/debug.ts:22-86`, `:105`). V

### CSS custom properties

Set by SimMap:

| Property | On | Value | Where |
|---|---|---|---|
| `--map-<token>` for every `TOKENS` key (camelCase to kebab) | the map root (`.sim-map`) inline, once the theme is known; before that a `<style>` in `<head>` gives the defaults under `prefers-color-scheme` | the palette's hex or rgba | `SimMap.svelte:11-16`, `:167-176`, `:1504-1507`; `palette.ts:234-255` V |
| `--map-bottom-inset` | the map root | `<px>px` | `SimMap.svelte:174`, `:298` V |
| `--map-controls-br-inline-size`, `--map-controls-br-block-size` | `:root` and the map root | integer px (`Math.ceil`); `0px` and the inset while there are no controls; removed from both on unmount | `SimMap.svelte:303-336`, `:488-493`; `footprint.ts:18-24` V |
| `--map-chips-bottom` | `:root` and the map root | integer px from the map root's top to the failure column's bottom; `0px` with no failure; removed on cleanup | `SimMap.svelte:357-384` V |

Read by SimMap:

| Property | Where used | Where |
|---|---|---|
| `--notice-pills-bottom` (fallback `0px`) | the failure column's top padding | `SimMap.svelte:1570` V |
| `--dock-w` (fallback `0px`) | the failure column's centre and max width | `SimMap.svelte:1691-1694` V |
| `--map-bottom-inset` (fallback `0px`) | the card, the Reset view button, both MapLibre bottom control containers | `SimMap.svelte:1698`, `:1704`, `:1803-1806` V |
| `--map-land`, `--map-label`, `--map-existing`, `--map-chunk-loading` | the map's own panels, background and loading bar | `SimMap.svelte:1681-1689`, `:1716` V |
| `--color-accent`, `--color-accent-dark` | the credit toggle's focus ring | `SimMap.svelte:1763`, `:1768` V |

`MapKeyControl` reads `--map-controls-br-block-size` with a `60px` fallback (`src/lib/map/key/MapKeyControl.svelte:141`) and puts the `--map-*` timeline tokens on `.sfh-map-key` (`:130-134`). V

Root element: `<section role="region" aria-label="3D map of San Francisco" data-testid="map-root" data-state=...>` with class `sim-map relative h-full w-full overflow-hidden` (`SimMap.svelte:1511-1521`). `data-state` is `loading | ready | unsupported | error | context-lost` (`:127`, `:1518`). V

---

## (b) The layers

Two renderers share one WebGL context: MapLibre style layers, and deck.gl layers through `MapLibreOverlay({ interleaved: true })` (`SimMap.svelte:818-835`). Every deck layer the controllers emit carries `beforeId` = the id of the style's first `symbol` layer, so deck layers draw beneath every basemap label (`SimMap.svelte:852`, `:966`; `style.ts:390-394`; `timeline-controller.ts:351-359`, `:738`; `generated-controller.ts:224-232`). V

### MapLibre sources (`style.ts:366-373`)

| Source | Type | Content |
|---|---|---|
| `protomaps` | vector, `pmtiles://` + `manifest.basemapTiles` | basemap |
| `buildings` | vector, `pmtiles://` + `manifest.buildingsTiles`, `promoteId: { buildings: 'parcelId' }` (`style.ts:221-227`) | existing buildings |
| `chunk-status` | GeoJSON, empty at start | one bbox polygon per chunk that is not `ready` (`pick.ts:51-78`) |
| `transit-access`, `transit-stops` | GeoJSON, only when `manifest.transit` is set | binned capacity polygons; stop markers |

V for all rows.

### MapLibre layers, in style order (`style.ts:355-384`)

| Layer | Type | Draws | Zoom |
|---|---|---|---|
| Protomaps base layers (non-symbol) before the first road after `water` | various | land, water, parks, landuse. `pois` and `buildings` layers and every icon layer are dropped (`style.ts:178-183`). With `manifest.splitRoads`, each `roads` layer has a clone `${id}__lc` (`:192-194`, `:206-219`). | Protomaps' own |
| `transit-access` | fill | capacity bins 1 to 5, opacity 0.45 (`palette.ts:156`); `visibility: none` until the view turns it on | none set (`style.ts:276-303`) |
| `transit-stops-bus` / `-rail` / `-regional` | circle, flat on the map plane | stop discs, radius by `log10(capacity)`, ×3 from z11 to z16; `visibility: none` until on | bus `minzoom` 15, rail 13, regional none (`style.ts:307-342`) |
| The rest of the base layers (roads and after) | various | roads | Protomaps' own |
| `existing-buildings` | fill-extrusion | every existing building at `heightM` (default 6) from `baseM`; a building with feature-state `replaced` draws at height 0 in the `replaced` colour | `minzoom: 12`; opacity interpolates 0 at z12 to 0.92 at z13 (`style.ts:231-246`) |
| `chunk-fill`, `chunk-loading-line`, `chunk-error-line` | fill, line, line | loading chunks tinted at 0.06 with a dashed outline; failed chunks outlined | none set (`style.ts:248-273`) |
| Protomaps label layers (symbol) | symbol | street and place labels | Protomaps' own |
| `overlay-anchor` | background, `visibility: none` | nothing | (`style.ts:381`) |

V for all rows. See D1 for the doc's different account of the stop layers' position.

Existing-building geometry by zoom is in the tiles, not the style: z12 to z13 hold one box per building, z14 and z15 hold several boxes per building from LiDAR, z16 and up overzoom z15 (Doc: `docs/dev/building-boxes.md:3`, `:97`). The style has one layer and nothing styles by `src` (V: `style.ts:231-246`).

### deck.gl layers

Generated mode (Paint; `GeneratedController`, `src/lib/map/generated-controller.ts`):

| Layer id | Draws | Zoom |
|---|---|---|
| `generated-<cellId>` | `SolidPolygonLayer`, extruded, one per cell with parts; fill by typology and appearance (`gen-*` tokens); `pickable`, `autoHighlight` (`generated-controller.ts:421-432`, `:122-150`) | no zoom gate |
| `rising-<rev>-<cellId>` | the same, for buildings rising in (see (g)) | no zoom gate |
| overlay layers | whatever `setOverlayLayers` holds, last (`:451`) | the layer's own |

Timeline mode (`/sim`; `TimelineController`, `src/lib/map/timeline-controller.ts`). Emit order is solids by cell id, ghosts by cell id, `timeline-bars`, `timeline-halos`, then the overlay (`:742-763`). V

| Layer id | Draws | Pickable | Zoom |
|---|---|---|---|
| `timeline-solid-<cellId>` | `SolidPolygonLayer` + `TimelapseExtension`, pass 0: built floors and completed buildings in the typology colour; `autoHighlight` in the `highlight` token (`timeline-controller.ts:720-740`) | yes | no zoom gate |
| `timeline-ghost-<cellId>` | the same geometry, pass 1: translucent tinted ghosts; no depth write | yes | no zoom gate |
| `timeline-bars` | `StageBarLayer`: one instanced screen-space quad per bar record (`timelapse/stage-bar-layer.ts:420-424`); depth-tested against buildings, no depth write | no | street: gate 15; far: gate 12 (see below) |
| `timeline-halos` | `HaloLayer`: one instanced screen-space diamond per policy mark; `depthCompare: 'always'`, no depth write (`timelapse/halo-layer.ts:161-166`) | no | below z14 one per 800 m square; from z14 every mark |
| overlay layers | the consumer's | the layer's own | the layer's own |

Cell layers for `generated-`, `rising-`, `timeline-solid-` and `timeline-ghost-` ids are culled per cell against the view's ground and roof bounds; culling is off when pitch is above 60 or the camera is at or below the cell's roof height (`src/lib/map/cull.ts:26-62`). V

Overlay slot contents (outside SimMap; `src/lib/map/overlay-mux.ts:13`): fixed order `feedback`, `limits`, `outline`, `ring`. On `/sim`: feedback buildings, the height limits, painted outlines and the brush ring; on `/`: the brush ring (`overlay-mux.ts:1-6`). V for the mux; the slot owners are per its comment (Doc).

Height limits (`sim-height-limits`, `src/lib/map/height/limits-layer.ts:43`): a composite deck layer in the `limits` slot. Glass lids fade in and ground contours fade out over zoom 14.5 to 15.5 (`height/limits-style.ts:26`, `:118-122`); a sublayer at opacity 0 is `visible: false` (`limits-layer.ts:435-447`, `:488-489`). V. Lids are requested per view from z14.5 on `moveend` (Doc, `map-interfaces.md:102`).

### How a project in progress is drawn

All of it is a function of the simulated day in a shared clock object (`TimelineClock`, `timelapse/types.ts:107-111`); `setTime` writes `clock.day`, moves the demolish pump's target and calls `map.triggerRepaint()` once (`timeline-controller.ts:269-275`). No per-project JS runs per frame. V

Part states, in rule order (`timelapse/state.ts:16-50`, ported to GLSL at `timelapse/shader.ts:110-146`):

1. `hidden`: before the slot's first stage day, outside the part's revision window, or a stopped project past hold + fade. A hidden part emits no fragments, so it is neither drawn nor picked (`shader.ts:175-178`).
2. `dying` (the project exited): red ghost (`tl-ghost-dying`); full for 90 simulated days, then fading over 180 (`constants.ts:8-10`; `DYING_DAYS` = 270 at `src/lib/timelapse/time.ts:77`).
3. `complete`: the whole building solid in its typology colour; the ghost pass discards (`shader.ts:193-194`).
4. `constructing`: solid floors below a cut height, the "ready" ghost above. The cut rises a floor at a time and stops at 90% of the stories until the completion day (`state.ts:9-13`, `FLOOR_CAP` at `constants.ts:12`).
5. Pre-construction ghost: `planning`, `permit` or `ready` tint (`tl-ghost-planning`, `tl-ghost-permit`, `tl-ghost-ready`).

Ghost alpha is 0.28 light, 0.35 dark (`constants.ts:6`). V

Existing buildings on a project's lot are hidden by feature-state `replaced` as the day passes each lot's demolish day, at most 2,000 feature-state calls a frame (`timelapse/demolish.ts:1-8`; `hide.ts:22`). V

### Progress bars (`timeline-bars`)

- One bar record per (slot, revision) with parts (`bars.ts:92-138`). The anchor is the centre of the revision's bbox, 2 m above its highest part (`bars.ts:131`, `constants.ts:38`). The bar's bottom edge sits 10 px above the anchor on screen (`constants.ts:36`, `stage-bar-layer.ts:322`). V
- Segments per pathway: 5 for discretionary and streamlined, 3 for permit-only, plus `preApplication` when entered; at most 6 (`bars.ts:31-35`, `stage-bar-layer.ts:42`). V
- Fill: the segments entered so far plus the share of the current one, capped at 0.9 (`bars.ts:206-211`). Colour: a chance ramp through `tl-bar-unlikely`, `tl-bar-uncertain`, `tl-bar-likely` at 0.15, 0.45, 0.75; `tl-bar-dead` once exited (`bars.ts:258-280`, `constants.ts:44`). V
- A bar shows only inside `[from, to)` (`bars.ts:188`). V
- **Street mode** (default): gate zoom 15, 32×6 px growing to 48×8 px at z17 (`constants.ts:14-20`, `bars.ts:225-232`). V
- **Far mode**: gate zoom 12, 32×6 px at every zoom (`constants.ts:26-28`). The gate is read at each bar's anchor: `zoom + log2(focalW / w)` (`bars.ts:165-168`, `stage-bar-layer.ts:281-284`). V
- `/sim` calls `setBarMode('far')` once when its map is ready (`src/lib/timeline/TimelineMode.svelte:1187`; outside scope, read in part). V. The Paint pages never call it (Doc, `map-interfaces.md:156`).

### Completed projects

- The building: state `complete`, fully solid, typology colour, from `completeDay` on with no end (`state.ts:38`). V
- The bar: full, in `tl-bar-likely`, holds for 90 simulated days, then fades linearly over 90 more, then is gone (`constants.ts:40-42`; `bars.ts:67-72`, `:197-204`). V
- The mark: a completed flagged project keeps its diamond to the end; `until` is `OPEN_DAY` unless the project exited (`halos.ts:70`). V
- Nothing in the map marks the moment of completion: there is no event, callback or one-shot effect when a part crosses `completeDay`; the shader's state test simply changes (V: `timeline-controller.ts` and `SimMap.svelte` read in full; no such hook).

### Policy marks (`timeline-halos`)

- A filled diamond, 10 px across its diagonal (`MARK_PX`, `constants.ts:50`), in `tl-halo-policy` with a 1 px edge in the `land` colour (`halo-layer.ts:118-124`). V
- One per slot that has a `SLOT_FLAG` bit and a first stage day after `from`, at the bbox centre of its final revision's parts, at ground level (`halos.ts:57-84`; `halo-layer.ts:192`). V
- Shows while `day <= t < until`; below zoom 14 only from its `areaFrom`, as its 800 m grid square's single diamond (`halos.ts:137-139`; `constants.ts:52-54`; grid at `timelapse/city-grid.ts:13-35`). The shader compares `project.scale` with `2^14` (`halo-layer.ts:69-75`). V
- Off unless `setHalos({ from })` was called (`timeline-controller.ts:673-680`). `/sim` calls it with the dataset date (`TimelineMode.svelte:1184`, `:1408`). V

### What is visible with the whole city in view

"Whole city in view" is not a defined camera in the code (see (d)). At the default frames (zoom 13 desktop, 12.2 phone, both pitched):

| Thing | At zoom 12.2 to 13 | Basis |
|---|---|---|
| Basemap and labels | yes | V `style.ts:374-382` |
| Existing buildings | yes, fading in: opacity 0 at z12, 0.92 at z13 (about 0.18 at 12.2 by the linear interpolation) | V `style.ts:238-243`; the 0.18 is I |
| Timeline ghosts and solids | yes, at any zoom, for the cells the map holds | V no zoom gate at `timeline-controller.ts:720-740` |
| Bars, street mode | no (gate 15, ramp from 14.5) | V `bars.ts:182-183` |
| Bars, far mode (`/sim`) | yes (gate 12, ramp from 11.5), thinned by the far declutter with a 12 px gap; about 400 bars at the desktop default on the synthetic 30,000 projects | V `constants.ts:26-34`; the count is Doc (`map-interfaces.md:165`) |
| Policy marks | one per 800 m square below z14 | V `halos.ts:137-139` |
| Transit stops (when switched on) | regional always; rail from z13; bus from z15 | V `style.ts:310-314` |
| Stop tooltips | no (from z14) | V `SimMap.svelte:144`, `:1282` |
| Height limits (when on) | contours and their labels; no lids below 14.5 | V `limits-style.ts:26`, `:118-122` |

Which timeline cells the map holds at a citywide view is decided by the producer (the `/sim` map stream and `prefetchViewport`), outside this scope. The citywide feed exists because a project's cell may not be loaded (Doc, `map-interfaces.md:138`). Not examined.

---

## (c) Pointer picking

### Events

Five passive pointer handlers sit on the map's container `<div>`; MapLibre's canvas owns the interaction (`SimMap.svelte:1522-1535`). There are no keyboard handlers for picking; the only `keydown` listener in SimMap is the credit's Escape (`:709-719`). The stop tooltip has no keyboard parity (Doc, `map-interfaces.md:83`). V

### Hover and the resting pointer

- `pointermove` with `pointerType === 'touch'` is ignored (`SimMap.svelte:1416`). V
- A move counts only when its target is the map canvas and no button is down (`e.buttons === 0`); otherwise the stored pointer is cleared, the tooltip closes and one hover miss is reported (`:1419-1426`). V
- While the camera moves (`movestart` to `moveend`), the pointer position is kept but nothing is picked; the tooltip closes at `movestart` (`:632-636`, `:1422`). At `moveend`, if a pointer is stored, a pick runs under it (`:637-641`). V
- Picks are coalesced: at most one hover pick per animation frame (`hoverSoon`, `:1431-1439`). V
- `pointerleave` clears the pointer, the tooltip and reports one hover miss (`:1441-1445`). V
- A `pointerdown` clears the stored pointer (`:1456`); a mouse release on the canvas with no buttons stores it again (`:1477`). V
- Hover picking does not check `panEnabled` (V: `onPointerMove` and `hoverSoon` never read it).

### Tap and click

- Touch tap: exactly one active touch, down on the canvas, released under 6 px and under 300 ms later (`TAP_PX`, `TAP_MS`, `:139-140`, `:1447-1450`, `:1463-1468`, `:1485-1492`). Not delivered while `panEnabled` is false (`:1489`). V
- Mouse or pen click: picked only when `timelinePick` is set, button 0, down on the canvas, same 6 px and 300 ms test, and `panEnabled` is true (`:1457-1461`, `:1478-1483`). V

### What a pick does (`pickAt`, `SimMap.svelte:1278-1316`)

In order, first hit wins:

1. A transit stop, when transit data is loaded and zoom is at least 14: `queryRenderedFeatures` over a 12 px square on the stop layers (`:1282-1296`).
2. `overlay.pickObject({ x, y, radius: 2 })` on the deck layers (`:1297`).
   - A `generated-` or `rising-` layer: the generated controller's part lookup (`:1298-1301`).
   - A `timeline-solid-` or `timeline-ghost-` layer: the timeline controller's lookup (`:1302-1305`; `TIMELINE_PART_LAYER` at `timeline-controller.ts:72`). Bars and marks are not pickable.
3. An existing building: `queryRenderedFeatures([x, y], { layers: ['existing-buildings'] })`, skipping buildings hidden by the generated mirror or the demolish pump (`:1306-1315`; `pick.ts:26-39`).

V for all three.

Return shape (`SimMap.svelte:131-132`):

```ts
type PickResult =
  { hit: TooltipHit; cell: string | null } | { timeline: TimelinePartLookup } | null;
```

`TimelinePartLookup` is `{ projectId, parcelId, typology, stories, units, existingUnits }` (`timeline-controller.ts:59-66`, built at `:361-375`). `TooltipHit` is `generated | existing | stop` (`tooltip.ts:22-37`). V

### How a page receives it

Only timeline parts reach the page, through the `timelinePick` prop (`deliver`, `SimMap.svelte:1325-1350`):

```ts
type TimelinePick =
  | { projectId: string; parcelId: ParcelId; x: number; y: number; kind: 'hover' | 'tap' }
  | { projectId: null; kind: 'hover' | 'tap' };
```

(`types.ts:209-211`). V

- `x`, `y` are CSS px relative to the map canvas (`canvasPoint`, `SimMap.svelte:1408-1411`). V
- A mouse click is reported as `kind: 'tap'` (`:1335`). V
- A miss: every tap or click miss sends `{ projectId: null, kind: 'tap' }`; a hover miss is sent once, only after a hover hit (`:1342-1348`, `:1354-1358`). `null` is never sent. V
- With `timelinePick` set, a timeline hit suppresses SimMap's own tooltip or card (`:1332-1337`). Without it, a part shows SimMap's "generated" tooltip or card (`:1338-1340`). V
- Everything else (existing buildings, stops, generated parts) is presented by SimMap itself: a tooltip on hover placed 12 px from the pointer and flipped to stay inside the map (`pick.ts:80-96`; markup at `SimMap.svelte:1617-1629`), or a card on a touch tap when `tapCards` is on (`:1631-1647`). The page gets no callback for these. V
- deck's own `autoHighlight` tints the hovered solid part (`timeline-controller.ts:735-736`). V

On `/sim` the receiver is `TimelineMode.onPick`: a hover requests a tooltip, a tap opens the project card and stores the tap's `lngLat` via `map.unproject`, a miss hides them (`src/lib/timeline/TimelineMode.svelte:1079-1102`; outside scope, read in part). V

---

## (d) The camera

### Default view and bounds (`src/lib/map/camera.ts`)

- Centre `[-122.4194, 37.7749]` (`:4`). V
- Width at least 640 px: zoom 13, pitch 55, bearing −20. Narrower: zoom 12.2, pitch 45, bearing −20 (`:14-20`). V
- Constraints passed to the MapLibre constructor: `minZoom: 11`, `maxZoom: 18`, `maxPitch: 70`, `maxBounds: [[-122.56, 37.69], [-122.33, 37.84]]` (`:5-13`; applied at `SimMap.svelte:603`). V
- `pixelRatio` is capped at 2; antialias is on only when the device ratio is below 2 (`camera.ts:58-60`; `SimMap.svelte:604-605`). V
- `hash: false`, `cooperativeGestures: false` (`SimMap.svelte:608-609`). V

### Setting the view

- At mount only, through props: `initialFrame` as a `CameraFrame` jumps there; `'plan-bbox'` with `planBBox` fits those bounds with padding `48 + bottomInset`, the default pitch and bearing, `maxZoom: 16`, `animate: false`; otherwise the default frame (`camera.ts:30-56`; `SimMap.svelte:586`, `:610`). The props are read once per mount, not reactively (`:479-484`). V
- `SimMapHandle` has no method to set, fit or animate the view (V: `types.ts:118-146`).
- `getMap()` hands the consumer the MapLibre `Map` (`SimMap.svelte:386-388`), so a consumer can call MapLibre's camera methods on it directly. V that the raw map is returned; I that this is the only route. In `src/lib/map` the only camera calls are the constructor and `resetView`'s `jumpTo(defaultFrame(width))` (`SimMap.svelte:1271-1274`); a grep of non-test `src` outside `src/lib/map` for `jumpTo|easeTo|flyTo|fitBounds` finds none. V
- No code in `src/lib/map` computes a "whole city" fit (V: the only camera calls are those above). City bounds appear as `CONSTRAINTS.maxBounds` (`camera.ts:9-12`, V) and as `SF_GRID_BBOX` from `$lib/transit`, imported at `SimMap.svelte:54` for the transit access grid (`:1198`); its value was not examined.
- `setBottomInset(px)` changes the map's bottom padding, which shifts the camera's effective centre (`SimMap.svelte:293-295`). V

### Reading the view

- No handle method reads the view. Consumers read the MapLibre map: `SimPage` follows `moveend` and reads `map.getBounds()` (`src/lib/sim-page/SimPage.svelte:847-852`, `:1059-1061`); `TimelineMode` uses `map.project` and `map.unproject` (`TimelineMode.svelte:1036`, `:1097`). Outside scope, read in part. V
- The timeline controller's `debugView` (zoom, centre, a clip-space projector) is built only for the debug snapshot (`SimMap.svelte:936-963`; `timeline-controller.ts:38-45`). V

### Disabling pan and zoom

`setPanEnabled(false)` calls exactly three things (`SimMap.svelte:1107-1119`):

```ts
m.dragPan.disable();
m.dragRotate.disable();
m.touchZoomRotate.disableRotation();
```

and `true` re-enables the same three. V

- It does not touch `scrollZoom`, `doubleClickZoom`, `boxZoom`, `keyboard`, `touchPitch`, or the pinch-zoom part of `touchZoomRotate`. V: a grep of `src/lib/map` and `src/lib/view` (non-test) for those handler names finds only the lines above.
- While pan is disabled, taps and clicks are not delivered (`:1480`, `:1489`) and any shown tooltip or card is cleared (`:289`). Hover picks continue. V
- The state survives a remount: `applyPan()` runs when the new map is created (`:620`). V
- Its one consumer is the brush (`src/lib/brush/BrushController.svelte.ts:295`; `types.ts:121` comment "brush-tool: false in paint mode"). V

### Controls

- Fine pointers: MapLibre `NavigationControl` with compass, bottom left (`SimMap.svelte:652`). V
- Coarse pointers (`matchMedia('(pointer: coarse)')` at mount, `:584`): no navigation control; a 29 px "Reset view" button that jumps to the default frame for the container's width (`:1602-1615`, `:1271-1274`). V
- Attribution control, compact, bottom right (`:653-656`). V

### Touch gestures

- MapLibre's defaults apply; SimMap changes none of them except through `setPanEnabled` (V: constructor options at `SimMap.svelte:600-611`).
- SimMap tracks active touch pointers only to recognise a single-finger tap (`:1463-1468`, `:1485-1501`). V
- With `dragPan` off, MapLibre leaves the canvas container at `touch-action: pan-x pan-y`, so the browser claims a one-finger drag and fires `pointercancel` mid-stroke; the brush sets `touch-action: none` on `map.getCanvasContainer()` itself while it owns the drag (`src/lib/brush/BrushController.svelte.ts:297-301`; outside scope, read in part). V that the brush does this; the MapLibre behaviour is that comment's testimony (Doc).

### Other camera facts

- After deck's device initialises, SimMap fires one synthetic `move` so deck's picking viewport matches a camera changed during `onready` (`SimMap.svelte:824-833`). V
- WebGL context loss sets `data-state="context-lost"` and shows a Reload panel (`:642-649`, `:1662-1677`). V

---

## (e) Drawing transient screen-space markers over the map

What exists:

1. **`setOverlayLayers(layers: Layer[])`** (`SimMap.svelte:390-396`). The one supported way for a consumer to draw in the map's GL context. V
   - deck.gl `Layer` instances. Ids matching `/^(generated|rising|timeline)-/` throw (`:391-392`).
   - The array replaces the previous one; `[]` clears (`types.ts:124`).
   - Each layer is cloned with `beforeId` = the first label layer, so overlay layers draw beneath basemap labels and after (on top of) the bars and marks (`timeline-controller.ts:351-359`, `:755-761`).
   - Single owner. On `/` and `/sim` the owner is the overlay mux, which concatenates four named slots in a fixed order, `feedback`, `limits`, `outline`, `ring` (`overlay-mux.ts:13-28`). There is no fifth slot.
   - Every call triggers a controller `emit()` and `overlay.setProps({ layers })` (`timeline-controller.ts:358`, `:762`; `SimMap.svelte:874-880`).
   - Kept across a remount and re-applied (`SimMap.svelte:234`, `:857`, `:989`).

2. **Two in-repo examples of instanced screen-space quads driven by a shared clock**: `StageBarLayer` and `HaloLayer`. Each projects an anchor to clip space, then offsets by pixels with `project_pixel_size_to_clipspace(offsetPx) * (anchor.w / project.focalDistance)` so the quad keeps its px size at any depth (`stage-bar-layer.ts:319-324`; `halo-layer.ts:89-93`). Their `draw()` reads the clock object, so a time change sets no prop and re-uploads no attribute (`stage-bar-layer.ts:486-507`; `halo-layer.ts:208-221`). Both are constructed inside `TimelineController` with reserved ids; neither is reachable through `setOverlayLayers`. V

3. **`getMap()`** returns the MapLibre map. A consumer can call `map.project(lngLat)` for canvas-relative CSS px, `map.unproject`, and listen to `move`. `/sim` does this to keep its project card beside a tapped building: on every `move` it re-projects the stored `lngLat` inside a `requestAnimationFrame` (`TimelineMode.svelte:1027-1045`; outside scope, read in part). V. This is the only lngLat-to-screen conversion a consumer uses today; SimMap offers no helper of its own (V: `SimMapHandle`, `types.ts:118-146`).

4. **DOM siblings in the map's positioned box.** SimMap's root is `relative overflow-hidden` and has no slot (`SimMap.svelte:1519`). Consumers mount absolutely positioned siblings after it: `MapKeyControl` (`absolute top-1 right-2 z-20`, wrapper `pointer-events-none`, `MapKeyControl.svelte:140`), the `/sim` card, the notice pills, Paint's strip (Doc, `map-interfaces.md:14`, `:46-62`). SimMap's own overlay children use `z-10` (loading bar, failure chips, Reset view), `z-20` (tooltip, card) and `z-30` (unsupported and error panels) (`SimMap.svelte:1553`, `:1569`, `:1606`, `:1622`, `:1634`, `:1650`, `:1663`). V

What does not exist in `src/lib/map` or `src/lib/view` (V by grep over non-test files, plus the full read of SimMap):

- No MapLibre `Marker` or `Popup` (the only "Marker" match is the `StopMarker` data type in `transit-layer.ts:22`).
- No 2D canvas overlay (`getContext` appears only in the WebGL probe, `webgl.ts:8`).
- No MapLibre custom style layer.
- No per-frame hook: SimMap does not expose a render or frame callback, and (Doc, `map-interfaces.md:19`, `:58`) "Nothing runs on map `move`" for the footprint and chips.
- No CSS transitions or keyframes on any marker; see (g).

The pointer handlers treat any event whose target is not the map canvas as "off the map" (`SimMap.svelte:1419`, `:1459`, `:1466`). So a DOM element placed over the map that takes pointer events stops hover picks and taps beneath it. V for the test; I for the consequence.

---

## (f) The citywide feed, policy marks and bar modes

### `CityDelta` (`src/lib/map/types.ts:63-83`)

```ts
export const CITY_DAY = { approved: 0, started: 1, completed: 2 } as const;

export interface CityDelta {
  rows: number;          // the world's row count now: markers at rows >= this are dropped
  from?: number;         // drop floor after a rewind; never in revision 0
  row: Int32Array;       // changed rows, strictly ascending, each < rows
  lngLat: Float32Array;  // 2 per changed row: the anchor lot's label point
  days: Float32Array;    // 3 per changed row (CITY_DAY): NaN = not (yet)
  homes: Uint16Array;    // per changed row: the final revision's units, capped at 65535
  flags: Uint8Array;     // per changed row: SLOT_FLAG bits
}
```

V

- It rides on `TimelineUpdate.city?` (`types.ts:86-96`). Absent in a later update: no marker changed. Absent in a revision 0: no feed, the store is cleared (`timeline-controller.ts:691-695`). V
- 27 bytes a row (`city-delta.ts:6`). V
- `validateCityDelta` throws `RangeError` on a bad length, a row not ascending or not below `rows`, a bad `rows` or `from`, or a flag above 3 (`city-delta.ts:16-44`). SimMap validates before storing or queueing (`SimMap.svelte:409`). V
- Meaning of the days (Doc, `map-interfaces.md:142`): `approved` is the first of entitled and permitIssued, `started` is construction, `completed` is a complete end. Days run ahead of the playhead: the worker reads the world as of its last stepped month and the page hides what the clock has not reached (`map-interfaces.md:145`).
- One marker per project row with a lot, "whether its cell is loaded or not" (Doc, `map-interfaces.md:138`; `types.ts:66-69`).
- Producer: only `/sim`'s map stream (Doc, `map-interfaces.md:148`). Not examined.

How the map consumes it: it stores it and draws nothing from it.

- The controller keeps a `CityStore` (`timelapse/city.ts:7-110`), a struct of typed arrays by world row with `size`, `flagged`, `length` and views `lngLat`, `days`, `homes`, `flags`, `has`. V
- The only readers in the controller are the debug snapshot's `cityMarkers` and `cityFlagged` (`timeline-controller.ts:421-422`). A city-only update returns before any layer work (`:249-256`). V
- `/sim`'s `TimelineMode.applyRender` feeds each update with `city` to its own index (`activityIndex.apply(u)`) before forwarding to the map (`TimelineMode.svelte:1113-1126`; outside scope, read in part). V. So two copies of the markers exist (Doc, `map-interfaces.md:150`).

### Policy marks interface

- `SLOT_FLAG = { zoning: 1, money: 2 }` (`types.ts:47`). `TimedPackedCell.slotFlags?: Uint8Array`, one byte per slot (`types.ts:60`). V
- `setHalos({ from: Day } | null)` on the handle (`types.ts:135`). Records come from `buildHalos(cells, from)` (`halos.ts:57-84`):

```ts
export interface HaloAttrs {
  projectId: string;
  anchor: [lng: number, lat: number];
  day: Day;      // the mark's first stage day
  until: Day;    // OPEN_DAY, or endDay + DYING_DAYS after an exit
  areaFrom: Day; // from this day until `until` it is its square's one diamond below zoom 14
}
```

(`halos.ts:11-21`). V

- Rebuilt when an update's last slice has installed or removed cells, and when `setHalos` changes its value; never in `setTime` (`timeline-controller.ts:318-327`, `:557-563`, `:673-689`). V
- Marks come from the installed cells' slots, not from the city feed (`halos.ts:60-80`). So a flagged project whose cell is not installed has no mark. V for the source; I for the consequence.
- What the flags mean (Doc, `map-interfaces.md:117-122`): `zoning` over-counts and "never means 'because of'"; pipeline rows never carry it; the bits do not sum to "+N from your policy".

### Bar modes

- `type BarMode = 'street' | 'far'` (`types.ts:149`); `setBarMode(mode)` on the handle (`types.ts:140`). V
- The bar record is `BarAttrs` (`timelapse/types.ts:44-62`): `projectId`, `parcelId`, `units`, `pathway`, `anchor [lng, lat, z]`, `from`, `to`, `barEnd`, `endDay`, `endKind` (0 open, 1 complete, 2 exit), `completeDay`, `segCount`, `segEntry[]`, `segTypicalDays[]`, `segRow[]`, `minZoom`, `policy`. V
- The mode changes the zoom gate, the size and the declutter only (`bars.ts:171-174`). V
- Declutter visit order in both modes: policy first, then homes descending, then `parcelId`, then `projectId` (`declutter.ts:63-72`). It does not depend on the camera or the clock and runs on a bar rebuild only (`declutter.ts:58-61`). V
- Street: one synchronous pass sets `minZoom` per project on a ladder from 15 to 18 in steps of 0.5 (`declutter.ts:63-72`; `constants.ts:46-48`). V
- Far: `FarDeclutter`, run in slices of 1,500 units through the controller's slice queue, at most 4 pieces a unit, 12 px gap (`declutter.ts:211`, `:218`; `constants.ts:34`; `timeline-controller.ts:597-654`). The bar layer on the map stays until the last slice swaps the new one in. V for the constants and the controller flow; the algorithm body (`declutter.ts:81-585`) was not read.
- Cost (Doc, `map-interfaces.md:165`): on the synthetic 30,000 projects, far makes 117,959 records in about 260 to 310 ms over 44 slices, "warm, a busy machine; not benched".

---

## (g) Animation in the map today

Wall-clock animations (all of them):

| What | Duration | Reduced motion | Where |
|---|---|---|---|
| Generated buildings rising in after a Paint stroke: `elevationScale` 0 to 1, ease-out cubic | `RISE_MS` = 400 ms | Skipped: with `prefers-reduced-motion: reduce` (a live `matchMedia` check at install) the buildings install settled. Revision 0 snapshots never animate. | `generated-controller.ts:28-29`, `:297`, `:347-368`, `:381-406`; `SimMap.svelte:848` V |
| The tile loading bar: a 30%-wide fill sliding across | 1.2 s, ease-in-out, infinite; shown after 300 ms of loading, "Loading buildings…" announced after a further 1,700 ms | `animation: none`, full width, opacity 0.6 | `SimMap.svelte:1215-1225`, `:1709-1733` V |
| The credit's self-collapse | a 5,000 ms timer, not a transition | none | `SimMap.svelte:9`, `:755-760` V |

Generated mode only applies to the first row; the timeline controller has no `reducedMotion` dep (V: `timeline-controller.ts:47-57`).

Changes driven by the simulated day (they move only when a consumer calls `setTime`):

| What | Length | Where |
|---|---|---|
| Stopped project: red ghost and grey bar hold, then fade | 90 days hold + 180 days linear fade | `constants.ts:8-10`; `state.ts:26-35`; `bars.ts:194-196` V |
| Completed project's bar: hold, then fade | 90 days + 90 days | `constants.ts:40-42`; `bars.ts:197-200` V |
| Construction: solid floors step up, capped at 90% until completion | the stage's typical days | `state.ts:9-13` V |
| Bar fill within a segment | the segment's typical days, capped at 0.9 | `bars.ts:210-211` V |
| Existing building hidden at its demolish day | instant (feature-state) | `demolish.ts:1-8`; `style.ts:240-242` V |

Changes driven by zoom:

| What | Range | Where |
|---|---|---|
| Existing buildings' opacity | z12 to z13 | `style.ts:243` V |
| Bar alpha below its gate | 0.5 zoom | `constants.ts:16`; `bars.ts:183` V |
| Lids in, contours out (smoothstep) | z14.5 to z15.5 | `limits-style.ts:26`, `:118-122` V |
| Street bar size | z15 to z17 | `bars.ts:219-232` V |

Other facts:

- `prefers-reduced-motion` appears in non-test map code only at `SimMap.svelte:848` and `:1727` (V by grep). The marks have "no reduced-motion case" because "Nothing moves or fades" (Doc, `map-interfaces.md:130`).
- No CSS `transition` anywhere in non-test `src/lib/map` or `src/lib/view` (V by grep). The key panels: "nothing animates" (Doc, `map-interfaces.md:70`).
- SimMap never eases the camera: the initial fit is `animate: false` and Reset view uses `jumpTo` (`camera.ts:50`; `SimMap.svelte:1273`). V. MapLibre's own navigation buttons and gestures keep their library defaults (I).
- Slice work is spread over frames: at most 4 cells a slice for installs (`hide.ts:28`), 16 during a run swap (`hide.ts:37`), 1,500 far-declutter units (`declutter.ts:218`), 2,000 feature-state calls for the pump (`hide.ts:22`). V
- At the bench's fastest playback, 1,095.7 simulated days a second (Doc, `map-perf.md:87`), a 90-day hold lasts about 82 ms of wall clock and a 90-day fade the same (I, by division). The speed a 20-second run would use is not in this scope.

---

## (h) The performance budget

Source: `docs/dev/map-perf.md` (testimony), checked against the bench files where noted.

### How `npm run bench:map` measures

- `bench:map` is `playwright test --config playwright.bench.config.ts` (`package.json:26`). V
- Headed Chromium on the real GPU, viewport 1280×800, `deviceScaleFactor: 2`, `headless: false`, optional `BENCH_CHANNEL` (`playwright.bench.config.ts:20-24`). V
- It uses the `VITE_E2E` preview server on port 4173 with fixture-0, needs a display, and is not in the default Playwright sweep or CI (Doc, `map-perf.md:9-11`, `:42-43`, `:145`).
- Pan case (`e2e/bench/map-pan.bench.ts`): loads a synthetic whole-city plan of 150,000 buildings in 100 cells through `window.__sfhMap.loadSyntheticCity(1)`, jumps to downtown at zoom 15, pitch 55, then pans for 10 s with `map.panBy([±360 px/s × dt, 0], { animate: false })` once per `requestAnimationFrame`, reversing every 2.5 s, recording every rAF delta (Doc, `map-perf.md:16-30`; V for `zoom: 15`, `pitch: 55`, `jumpTo` and `panBy` at `map-pan.bench.ts:12-13`, `:57`, `:78`).
- Timeline cases (`e2e/bench/map-timeline.bench.ts`): 30,000 synthetic projects, `setTime` once per frame as a triangle wave over Day 20742 to 29584, at zoom 15.5, pitch 55. Cases: playback (1,095.7 days/s), drag (the full range in 2 s), playback + limits, playback + halos, citywide playback (default desktop camera, far bars, city feed on) (Doc, `map-perf.md:83-96`; V that the citywide case and its camera exist at `map-timeline.bench.ts:21-25`, `:87`).
- `/sim` cases (`e2e/bench/sim-timeline.bench.ts`): a docked-timeline pan, `fill-install` (skipped without `SFH_BENCH_DATASET`), `open-painted` and `open-empty` (Doc, `map-perf.md:117-122`; V for the four test titles at `sim-timeline.bench.ts:126`, `:204-205`, `:329`).
- It prints p50, p95, frame count, renderer string and PASS or FAIL (Doc, `map-perf.md:29`).

### The pass bar

- p95 frame time at most 16.7 ms: `BAR_MS = 16.7`, `verdict = p95 <= BAR_MS` (`e2e/bench/bench-util.ts:17`, `:25`); asserted at `map-pan.bench.ts:106`. V
- Stated for "a 2022 MacBook Air (M2) class machine"; no M2 result is recorded (D8).
- The `/sim` cases report numbers with "no new bar beyond the pan's p95" (Doc, `map-perf.md:117`).
- Related caps: the demolish pump's catch-up bound is 2,000 feature-state changes per frame (Doc, `map-perf.md:90`; V `hide.ts:22`). A client test checks that a 500-parcel update reaches its first rising frame within 30 ms (Doc, `map-perf.md:146-148`; the spec was not read).

### Latest recorded results (all Apple M5 Pro, Playwright Chromium, Metal, DPR 2; Doc)

| Date | Case | p95 | Line |
|---|---|---|---|
| 2026-11-20 | after map-citywide (#134): "every case p95 9.3 ms; recorded in the review spec" | 9.3 ms | `map-perf.md:72` |
| 2026-11-20 | after map-on-screen (#132): representative and worst pan; timeline playback, drag, playback + limits (10.2), playback + halos (`halos=72532 marks=3000`); `/sim` docked pan on fixture-0 | 10.3 ms | `map-perf.md:71` |
| 2026-11-14 | representative pan on live data with building boxes at z14+, machine load about 6 ("ballpark") | 9.9 ms | `map-perf.md:70` |
| 2026-11-14 | `/sim` pan, timeline docked, live data (71 cells, 3,613 parts) | 10.3 ms (p50 8.3) | `map-perf.md:139` |
| 2026-11-14 | `/sim` fill on live data: first results 1,882 ms, whole 3,257 ms; painted open first full 3,664 ms; empty open whole 3,207 ms | n/a | `map-perf.md:140` |
| 2026-11-14 | apply-cost (headless SwiftShader, relative only): 22 cells 155 ms; 121 cells 889 ms | n/a | `map-perf.md:141` |

p50 is 8.3 ms in every pan row because the display is 120 Hz (Doc, `map-perf.md:47-48`).

Caveats the doc states about its own numbers:

- The marks case was "measured with rings, which the layer no longer draws ... Not re-run since" (`map-perf.md:94`).
- The citywide case is "Not yet run" in the prose but has a results row (D4). It runs on `/`, whose map box is about 960×752, "not `/sim`'s (1280 by 451)" (`map-perf.md:96`).
- The synthetic parcel ids match no building tiles, so MapLibre's render cost of feature-state changes on live tiles is not measured (`map-perf.md:98`).
- No bench case measures a pointer moving over the map: every case pans by script, and hover picking is off while the camera moves (V `SimMap.svelte:1422`, `:1436`). So the cost of `overlay.pickObject` per frame under a moving pointer is not in any recorded number (I).

---

## (i) The map toolbar and the Key and Layers panels

### The toolbar (`src/lib/map/key/MapKeyControl.svelte`)

- Mounted by the page as a sibling after the map, in the map's positioned box. Box: `absolute top-1 right-2 z-20`, `pointer-events-none`, `flex-col-reverse`; its bottom is `calc(max(var(--map-controls-br-block-size, 60px), <floor>px) + 0.5rem)` (`:137-145`). V
- Two toggles, 4 px apart: "Layers" (aria-label "Map layers"), present only when the page passes a `layers` snippet, then "Key" (aria-label "Map key"); each has `aria-expanded` and `aria-controls` (`:146-169`; words at `key/copy.ts:2-7`). V
- Props: `key` (snippet, required), `layers?` (snippet), `openFromMd` (default false), `hidden` (default false; sets `hidden` and `inert`), `floor` (default 0), `stale` (default false; sets `data-stale` on the key panel), `el` (bindable), `onopenchange?(open: 'key' | 'layers' | null)` (`:23-57`). V
- At most one panel is open. Panels are hidden, not unmounted (`:180`, `:194`). Panel width `min(18rem, 100vw - 1rem)`, `md:w-60`; each scrolls and is focusable (`:127`, `:170-198`). V
- Open state: the key opens at rest from 768 px when `openFromMd`; below that it starts closed. Crossing below 768 px closes the open panel. Escape closes the open panel and focuses its toggle. Below 768 px a `pointerdown` on the map closes it (`:60-72`, `:102-122`). The state is not stored (`:61`). V
- Test ids: `map-key-control`, `map-layers-toggle`, `map-key-toggle`, `map-key-panel`, `map-layers-panel` (`:139`, `:151`, `:162`, `:176`, `:191`). V
- `/sim` mounts it with `openFromMd`, `hidden` while narrow and a card is open, `stale`, and `SimKey` as the key (`TimelineMode.svelte:1844-1854`). Paint mounts it with `PaintKey`, closed at rest (`src/lib/brush/BrushEditor.svelte:11`, `:638`). Outside scope, read in part. V

### The Key panel's content

Supplied by the page, not by the control.

- `/sim` (`src/lib/timeline/SimKey.svelte`, 76 lines, skimmed by grep): under the heading "Homes", one row per stage group with a swatch, a label and a count at the playhead's month ('…' while calculating); then, when policy marks are in force, a diamond with "Under your policy" (explanation: "Your zoning sets its height limit, or your pool funds it."); then a bar swatch with "Bar: progress and chance of finishing". V for the structure (`SimKey.svelte:35-54`); the rest of the file was not read.
- The stage groups (`key/rows.ts:28-65`): Planning review, Approved, Permit issued, Building, Completed, Stopped, each with its swatch tokens. V
- Paint's key lists one row per building type: ADU, House or plex, Walk-up, 5-over-1, Mid-rise, Tower (`key/rows.ts:68-79`). `PaintKey.svelte` itself was not read. V for the rows.
- Swatch kinds: `ghost`, `solid`, `bar`, `mark` (a rotated 8 px square) (`key/KeySwatch.svelte:31-68`). V
- Other key words defined: `types: 'New buildings'`, `painted: 'Painted'` (`key/copy.ts:11-12`). V

### The Layers panel's content (`src/lib/view/LayerSwitches.svelte`)

One checkbox row per entry of `rows` (default `['transitStops', 'transitAccess']`), each label at least 24 px (`:28`, `:39`):

| Row | Label | Under it |
|---|---|---|
| `transitStops` | "Transit stops" | a three-item legend: BART / Caltrain, Muni Metro / streetcar, Bus / cable car (`:32-36`, `:44-64`) |
| `transitAccess` | "Transit capacity within a 10-minute walk" | a five-bin legend and a caption (`:65-86`) |
| `heightLimits` | "Zoning height limits" | "Glass lids at the height zoning allows. Zoomed out, contour lines." (`:6-7`, `:87-97`) |

V. Props: `view`, `theme`, `onchange(v)`, `rows?` (`:21-28`). V

Which rows a route shows (Doc, `map-interfaces.md:82`): `/` and `/p/:id` show the two transit rows and only when the manifest has `transit`; `/sim` and `/s/:id` always pass `layers`, with all three rows or `['heightLimits']` alone without transit. V only that `SimPage` renders `LayerSwitches` with a `rows` value (`SimPage.svelte:1159`).

### Which preferences persist (`src/lib/view/prefs.ts`)

- One record in `localStorage` under the key `sfhousing:view`, shared by every route (`:14`, `:2-5`). V
- Three booleans: `transitStops`, `transitAccess`, `heightLimits` (`:7-12`). V
- Defaults: stops off, capacity off, height limits on (`:15-19`). A stored boolean wins; anything else falls back to the default (`:42-47`). V
- A legacy `heightFog` value is read as `heightLimits` when `heightLimits` is absent (`:46`). V
- Persistence is best-effort: read and write are wrapped in `try`/`catch`; unavailable storage yields the defaults (`:27-33`, `:38-50`, `:57-68`). V
- `HIDDEN_VIEW` (all three off) is exported and is `TimelineMode`'s default `view` (`:20-25`; see D6). V
- `/sim` reads the record once at mount and writes on every change (`SimPage.svelte:808`, `:817-818`). V
- Not persisted: which panel is open (`MapKeyControl.svelte:61` "Not stored"), the camera (`hash: false`, `SimMap.svelte:608`; no storage access in `src/lib/map`, V by the full read of SimMap and `camera.ts`), the bar mode and the marks setting (set by the page on every mount, `TimelineMode.svelte:1184-1187`). V

---

## e2e specs that cover the map (names only; contents not read)

Found by grepping `e2e/` for `map-root`, `__sfhMap`, `SimMap`, `maplibre`, `map-key`, `timelineSnapshot`, `sim-map`.

Map-focused by name:

- `e2e/map.spec.ts` (with snapshots `e2e/map.spec.ts-snapshots/map-light-chromium-darwin.png`, `map-dark-chromium-darwin.png`)
- `e2e/map-key.spec.ts`
- `e2e/timelapse-render.spec.ts`
- `e2e/sim-halos.spec.ts`
- `e2e/sim-citywide.spec.ts`
- `e2e/transit.spec.ts`
- `e2e/compositions.spec.ts`

Others that reference the map: `e2e/brush.spec.ts`, `e2e/fzp.spec.ts`, `e2e/fzp-sim.spec.ts`, `e2e/chrome-dark.spec.ts`, `e2e/layout.spec.ts`, `e2e/scoreboard.spec.ts`, `e2e/sim.spec.ts`, `e2e/sim-share.spec.ts`, `e2e/sim-timeline.spec.ts`, `e2e/game-sim.spec.ts`, `e2e/targets.spec.ts`, `e2e/share-notices.spec.ts`.

Benches and perf: `e2e/bench/map-pan.bench.ts`, `e2e/bench/map-timeline.bench.ts`, `e2e/bench/sim-timeline.bench.ts`, `e2e/bench/bench-util.ts`, `e2e/perf/loaded-500.perf.spec.ts`.

Helpers that reference the map: `e2e/helpers/sharing.ts`. Other helpers present: `a11y.ts`, `account.ts`, `auth.ts`, `chrome.ts`, `game.ts`, `header-text.ts`, `pointer.ts`, `run.ts`.

---

## Appendix: what was and was not examined

### Files read in full

In scope:

- `src/lib/map/SimMap.svelte`
- `src/lib/map/types.ts`
- `src/lib/map/camera.ts`
- `src/lib/map/style.ts`
- `src/lib/map/timeline-controller.ts`
- `src/lib/map/generated-controller.ts`
- `src/lib/map/pick.ts`
- `src/lib/map/tooltip.ts`
- `src/lib/map/cull.ts`
- `src/lib/map/overlay-mux.ts`
- `src/lib/map/debug.ts`
- `src/lib/map/palette.ts`
- `src/lib/map/appearance.ts`
- `src/lib/map/footprint.ts`
- `src/lib/map/system-theme.svelte.ts`
- `src/lib/map/deck-loader.ts`
- `src/lib/map/timelapse-loader.ts`
- `src/lib/map/attribution.ts`
- `src/lib/map/webgl.ts`
- `src/lib/map/hide.ts`
- `src/lib/map/city-delta.ts`
- `src/lib/map/timelapse/constants.ts`
- `src/lib/map/timelapse/types.ts`
- `src/lib/map/timelapse/bars.ts`
- `src/lib/map/timelapse/halos.ts`
- `src/lib/map/timelapse/state.ts`
- `src/lib/map/timelapse/shader.ts`
- `src/lib/map/timelapse/halo-layer.ts`
- `src/lib/map/timelapse/stage-bar-layer.ts`
- `src/lib/map/timelapse/city.ts`
- `src/lib/map/timelapse/city-grid.ts`
- `src/lib/map/timelapse/extension.ts`
- `src/lib/map/timelapse/deck.ts`
- `src/lib/map/height/limits-style.ts`
- `src/lib/map/key/MapKeyControl.svelte`
- `src/lib/map/key/rows.ts`
- `src/lib/map/key/copy.ts`
- `src/lib/map/key/KeySwatch.svelte`
- `src/lib/view/prefs.ts`
- `src/lib/view/LayerSwitches.svelte`
- `docs/dev/map-interfaces.md`
- `docs/dev/map-perf.md`

### Files read in part

In scope:

- `src/lib/map/timelapse/declutter.ts`: lines 1-80, plus a grep for its exports and constants. The street and far algorithm bodies (lines 81-585) were not read.
- `src/lib/map/timelapse/demolish.ts`: lines 1-110 of 278.
- `src/lib/map/transit-layer.ts`: lines 1-70 of 183.
- `src/lib/map/height/limits-layer.ts`: lines 1-120 of 515, plus a grep for `pickable`, `visible`, `opacity`, `minZoom`.
- `src/lib/map/height/wall-layer.ts`: grep only.
- `docs/dev/building-boxes.md`: skim by grep of headings and zoom mentions, as asked.
- `docs/superpowers/specs/2026-11-24-incremental-feel-design.html`: skimmed as tag-stripped text, for context.

Outside scope, opened only to answer "how a page receives it":

- `src/lib/timeline/TimelineMode.svelte`: lines 300-320, 1020-1045, 1075-1130, 1170-1215, 1825-1858, plus greps.
- `src/lib/sim-page/SimPage.svelte`: lines 672-692, 1052-1070, plus greps.
- `src/lib/brush/BrushController.svelte.ts`: lines 285-312.
- `src/lib/brush/BrushEditor.svelte`, `src/lib/timeline/SimKey.svelte`, `src/lib/timelapse/time.ts`, `e2e/bench/bench-util.ts`, `e2e/bench/map-pan.bench.ts`, `e2e/bench/map-timeline.bench.ts`, `e2e/bench/sim-timeline.bench.ts`, `playwright.bench.config.ts`, `package.json`: grep only.

### Directories listed

- `src/lib/map/` and every subdirectory (`fixtures/`, `height/`, `height/test/`, `key/`, `key/test/`, `test/`, `timelapse/`), by a recursive file listing with line counts.
- `src/lib/view/`
- `e2e/`, `e2e/bench/`, `e2e/perf/`, `e2e/helpers/`, `e2e/map.spec.ts-snapshots/`
- `.superpowers/superconductor/incremental-loop/`

### In scope and NOT examined

Not opened at all:

- Every `*.spec.ts` under `src/lib/map/` and `src/lib/view/` (65 files), including `SimMap.svelte.spec.ts`, `SimMap.timeline.svelte.spec.ts`, `SimMap.deck-viewport.svelte.spec.ts`, `timeline-controller.spec.ts`, `camera.spec.ts`, `pick.spec.ts`, `city-delta.spec.ts`, `timelapse/*.spec.ts`, `height/*.spec.ts`, `key/*.spec.ts`, `prefs.spec.ts`, `LayerSwitches.svelte.spec.ts`, and the perf and GPU specs. Any behaviour those tests pin down that the source does not make obvious is not in this report.
- `src/lib/map/test/**` (synthetic city, timeline and limits builders; fake deps; `real-deck.ts`; `worst-composition.ts`).
- `src/lib/map/fixtures/**`.
- `src/lib/map/dash.ts`, `src/lib/map/pack.ts`, `src/lib/map/pack-timed.ts`.
- `src/lib/map/timelapse/encode.ts`, `src/lib/map/timelapse/lookups.ts`.
- `src/lib/map/height/city.ts`, `labels.ts`, `lids.ts`, `raster.ts`, `room.ts`, `types.ts`, `vectorize.ts`, `height/test/fixtures.ts`.
- `src/lib/map/key/test/KeyHost.svelte`.
- The contents of every e2e spec, bench and helper beyond the greps named above; the two snapshot images.

Not established, and not to be read as absent:

- Which timeline cells the map holds at a citywide view, and how many projects that is on live data. The producer (`/sim`'s map stream, the ensemble runner, `prefetchViewport`) is outside this scope.
- What fraction of the city the default pitched frames show in `/sim`'s map box.
- MapLibre's and deck.gl's own default behaviours (gesture handlers, navigation-button easing, paint transitions, `pickObject` cost). Nothing here was checked against the libraries' source or by running the app.
- Whether `HIDDEN_VIEW` reaches the map during playback (D6).
- The "review spec" that `map-perf.md:72` says records the post-#134 results.
- `PaintKey.svelte` and the Paint pages' use of the map beyond the three greps.
- No server was started, no test or bench was run, and no git command was issued. Every statement about runtime behaviour is from reading source.
