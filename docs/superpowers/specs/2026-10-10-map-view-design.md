# map-view: spec (Milestone 1)

Source: `docs/superpowers/design/2026-10-10-1749-sf-housing-sim.md` (approved 2026-10-10).
Status: draft for orchestrator review. No product code has been written.
Evidence marks: **V** means verified, with a URL or file:line. **I** means inferred.

## 1. Scope

Design row (verbatim):

| slug | scope |
|---|---|
| `map-view` | The MapLibre GL map. The basemap is a Protomaps SF extract on R2. Existing buildings render from `buildings.pmtiles` as `fill-extrusion`. Buildings on replaced parcels are hidden with a filter or feature-state keyed by `parcelId`. A deck.gl `MapLibreOverlay` from `@deck.gl/maplibre` (interleaved) `SolidPolygonLayer` draws the generated building parts, with a short rise-in animation. |

**In scope**
- The `SimMap.svelte` component, which fills the map slot of the `/` and `/p/[id]` shells that platform owns.
- Map construction, the camera, the PMTiles protocol, and the basemap style (a Protomaps-derived custom flavour, light and dark).
- Existing-building extrusions, plus hiding the buildings on replaced parcels.
- The deck.gl overlay and the generated-building layers. The pure `packCell()` packer, which the worker host imports, and the main-thread consumer of `GeneratedUpdate`.
- The rise-in animation and its reduced-motion behaviour.
- Hover and tap picking, plus the tooltip or card.
- Loading, error and unsupported states for the basemap, building tiles and parcel chunks.
- The attribution control.
- The map's layout at 375 px, and its SSR static frame.
- A pan-input gate that brush-tool drives, and the overlay-layer slot for its ring and swath (I17).
- The performance budget for rendering.

**Out of scope**
- Brush gestures, the brush ring, the pan/paint mode switch UI, and undo/redo (brush-tool).
- Fetching parcel chunks and hosting the worker (the worker host is in the brush-tool spec; see plan-model spec §1). map-view only *displays* chunk status.
- Generating buildings (typology-generator).
- Scoreboard UI.
- Share and load flows (plan-sharing). map-view only accepts an initial camera frame.
- The `/attribution` page and the CSP (platform).
- Neighbourhood boundary rendering. This is not needed in M1.
- Terrain, globe projection, shadows.

## 2. Interfaces

Rows consumed (verbatim from the design):

| # | interface | owner → consumers | mark |
|---|---|---|---|
| I1 | `type ParcelId = string` — SF `mapblklot` (block+lot, e.g. `"3512008"`), the single join key across all data | data-pipeline → all | DC |
| I6 | `interface ParcelRecord { id: ParcelId; polygon: [x: number, y: number][][] /* local metres, exactly EPSG:7131 (NAD83(2011) / San Francisco CS13, metres), origin at label point */; labelPoint: [lng, lat]; areaM2: number; existingUnits: number; existingFloorAreaM2: number; existingHeightM: number; landUse: string; eligible: boolean; neighborhood: string }` | data-pipeline → plan-model, generator, scoreboard | DC |
| I8 | `generate(parcel: ParcelRecord, env: Envelope, seed: number, mode: BuildoutMode): GeneratedBuilding \| null`. Returns `null` for a replacement when its floor area ≤ `existingFloorAreaM2` **or** its units ≤ `existingUnits`: nobody rebuilds smaller or to fewer homes. (An `adu` keeps the existing building and is exempt) | generator → map-view, scoreboard | DC |
| I9 | `interface GeneratedBuilding { parcelId: ParcelId; source: 'user'; /* widens to 'pipeline' \| 'scenario' later */ typology: TypologyId; parts: { footprint: [lng, lat][] /* single outer ring; parcel holes dropped in M1 */; baseM: number; topM: number }[] /* nested: each part's footprint ⊆ the part below; rendered ground-to-topM */; stories: number; units: number; floorAreaM2: number; replacesExisting: boolean }` | generator → map-view, scoreboard | DC |
| I10 | `type TypologyId = 'adu' \| 'plex' \| 'walkup' \| 'podium' \| 'midrise' \| 'tower'` | generator | DC |
| I12 | Data manifest: `/data/<datasetVersion>/manifest.json` → `{ datasetVersion, builtAt, sources: { id, label?, url, retrievedAt, license }[], chunks: { cellId, bbox, url, parcelCount }[], buildingsTiles: url, basemapTiles: url, glyphs: url /* MapLibre `{fontstack}/{range}.pbf` template */, sprite?: url, neighborhoods: url }`. All `url`s are root-relative (`/data/<v>/…`). Every eligible-or-not parcel appears in **exactly one** chunk. `buildingsTiles` has one source-layer `buildings` with properties `parcelId`, `heightM`, `baseM`, at minzoom ≤ 12, with buildings clipped to parcels. Published versions are immutable and retained indefinitely. `datasetVersion` matches `^(\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\|fixture-\d+)$` (build date + 8-hex input hash) everywhere it is validated. R2 key = `data/<datasetVersion>/<path>`, served at `/data/<datasetVersion>/<path>` | data-pipeline → platform, plan-model, brush-tool (worker host), typology-generator, map-view | DC |
| I15 | **The one main↔worker protocol** (`src/lib/sim/protocol.ts`, owned by brush-tool's worker host): `SimRequest` as in the brush-tool spec, and `SimResponse = { type: 'ready'; rev; datasetVersion; chunkCount } \| { type: 'diff'; rev; phase: DiffPhase; render: GeneratedUpdate; stats?: OpStats; complete: boolean; score: Score } \| { type: 'chunks'; status: Record<cellId, ChunkStatus>; pending: number; failed: string[] } \| { type: 'parcelSummary'; reqId: number; summary: ParcelSummary \| null } \| { type: 'error'; rev; code; message }`, with matching request `{ type: 'parcelSummary'; reqId: number; parcelId: ParcelId }` (no rev). `ParcelSummary = { parcelId; neighborhood; landUse; eligible; existingUnits; envelope: Envelope \| null; generated: { typology; stories; units } \| null }`, used by map-view's tooltip. `GeneratedUpdate` and `PackedCell` are owned by map-view (the worker imports the pure `packCell`). `Score` is owned by scoreboard (the worker calls its pure `score()`). The main thread never receives `GeneratedBuilding[]` | brush-tool ↔ map-view, scoreboard, typology-generator | DC |
| I16 | Dataset version discovery: the worker var `PUBLIC_DATASET_VERSION` names the current version for new plans. A **published** plan (`/p/:id`) renders on **its own** `plan.datasetVersion`, with an "Open with current data" action that remixes onto current. A **locally autosaved** plan is rebased to current on load: strokes are version-independent, so `datasetVersion` is rewritten and the plan re-resolved, with a one-line notice if the version changed (`manifestUrl = /data/${v}/manifest.json`). map-view and the worker host take the manifest as a parameter, never a global. If that version's manifest 404s, fall back to current and show the plan-sharing "older data" notice | platform → plan-sharing, brush-tool, map-view | DC |
| I17 | `SimMapHandle` (map-view → brush-tool), as in the map-view spec, plus `setOverlayLayers(layers: import('@deck.gl/core').Layer[]): void` for the brush ring and swath preview | map-view → brush-tool | DC |

map-view owns the `GeneratedUpdate` / `PackedCell` / `ChunkStatus` formats inside I15 (the worker imports the pure `packCell`) and owns I17 (`SimMapHandle`). It consumes I1 (the hide key), I6 (existing units and eligibility, shown in the tooltip), I8 and I9 (the geometry and metadata it draws), I10 (the palette key), I12 (tile, basemap, glyph and chunk URLs, and the chunk bboxes) and I16 (the manifest arrives as a parameter).

### Internal types (map-view-owned; none alters an I-row)

```ts
// src/lib/map/types.ts
type Theme = 'light' | 'dark';
interface CameraFrame { center: [lng: number, lat: number]; zoom: number; pitch: number; bearing: number }

// Packed per-cell geometry. Built in the worker by packCell() (src/lib/map/pack.ts,
// pure, no DOM), posted to the main thread with every typed array transferred.
interface PackedCell {
  cellId: string;                 // I12 chunks[].cellId
  parcelIds: ParcelId[];          // dense table; index = parcel slot
  parcelMeta: Uint32Array;        // per parcel slot: [units, existingUnits, stories, typologyIdx]
  partCount: number;
  startIndices: Uint32Array;      // length partCount + 1 (vertex index where each part starts; last = vertex count)
  positions: Float64Array;        // [lng, lat]*, rings open (no repeated closing vertex), CW
  partTopM: Float32Array;         // per part: topM (ground-up rendering, §4.4)
  partSlot: Uint32Array;          // per part → parcel slot
  partTypology: Uint8Array;       // per part → index into TYPOLOGY_ORDER (I10 order)
}

// One message per worker revision (worker host → SimMap).
interface GeneratedUpdate {
  revision: number;               // strictly +1 per message; 0 = full snapshot
  cells: { settled: PackedCell; rising: PackedCell | null }[]; // full repack of each touched cell
  removedCells: string[];         // cells that now hold no generated building
  hide: { add: ParcelId[]; remove: ParcelId[] };  // replacesExisting diff vs previous revision
}
type ChunkStatus = 'loading' | 'ready' | 'error';

interface SimMapHandle {
  applyGenerated(u: GeneratedUpdate): void;
  setChunkStatus(cellId: string, s: ChunkStatus): void;
  setPanEnabled(enabled: boolean): void;   // brush-tool: false in paint mode
  setBottomInset(px: number): void;        // mobile sheets → map.setPadding
  getMap(): import('maplibre-gl').Map | null; // brush-tool projects its ring
  setOverlayLayers(layers: import('@deck.gl/core').Layer[]): void; // I17: brush ring and swath; [] clears
  onResyncNeeded(cb: () => void): void;    // revision gap → worker host sends revision 0
}
// Props: { manifest: Manifest; theme?: Theme; initialFrame?: CameraFrame | 'plan-bbox'; planBBox?: BBox /* plan-model's BBox */ }
// `manifest` (data-pipeline's type) is a parameter, never a global (I16). It is the result of
// brush-tool's loadManifest(plan.datasetVersion, PUBLIC_DATASET_VERSION), which already applied
// the 404 fallback to current; the same object is sent to the worker host's `init`.
```

`TYPOLOGY_ORDER = ['adu','plex','walkup','podium','midrise','tower']` (the I10 order).

## 3. Global constraints (verbatim)

- **Free and open source.** No paid APIs and no vendor keys are needed to run
  or build it. Licence: MIT for code (OD-3). Data attribution is shown in-app
  (ODbL for the OSM/Protomaps basemap and Overture, PDDL/public domain for
  DataSF).
- **Determinism.** The same `Plan` + `datasetVersion` gives the same buildings
  and the same score, on every machine.
- **Overshoot is meaningful.** No readout caps at 100% of a target.
- **Honesty of numbers.** Every unit count is labelled with what it is (M1:
  *theoretical max buildout*). Net counts are shown, not gross. Sources and
  vintages are visible.
- **Performance targets.** Existing-city view pans at 60 fps on a 2022-era
  laptop. Generated buildings appear within 150 ms of pointer-up for strokes
  covering ≤ 500 parcels. A whole-city repaint (≈150k parcels) finishes within
  5 s, off the main thread. The first meaningful paint transfers ≤ 5 MB (parcel
  chunks load lazily under the brush).
- **Mobile works.** Touch painting uses an explicit mode switch. Layout works
  at 375 px.
- **Data is static and versioned.** The worker does no geo computation at
  runtime.
- **Cross-project conventions apply:** Conventional Commits, worktrees for all
  work, bare-name Cloudflare resources (`sfhousing`), and the migration
  workflow via Drizzle.

## 4. Behaviour

### 4.0 Library facts this spec rests on

| fact | evidence |
|---|---|
| maplibre-gl is at **6.13.0**. v6.0.0 shipped 2026-07-22 | `npm view maplibre-gl` (V, 2026-10-10) |
| v6 is **ESM-only**: use `import * as maplibregl` or named imports. The worker loads from a real URL, so `worker-src blob:` is no longer required | CHANGELOG 6.0.0, https://github.com/maplibre/maplibre-gl-js/blob/main/CHANGELOG.md (V) |
| v6 **requires WebGL2**. When no WebGL is available, the failure is reported through `map.on('error')` | same CHANGELOG 6.0.0 (V) |
| v6 rewrote feature-state storage as arrays ("up to 3.4X speedup") | same (V) |
| The `promoteId` vector-source option is "a property name, or an object `{<sourceLayer>: <propertyName>}`", used "as a feature id (for feature state)" | https://maplibre.org/maplibre-style-spec/sources/ (V) |
| `feature-state` is **not supported in filter expressions** | https://maplibre.org/maplibre-style-spec/layers/ (V) |
| `fill-extrusion-color`, `-height` and `-base` support feature-state. `fill-extrusion-opacity` is per-layer and not data-driven | same (V) |
| `removeFeatureState({source, sourceLayer, id}, key)` removes one key. Feature ids "can be any number or string" | https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/ (V) |
| Feature state set on a source applies to tiles that load later | I. This is MapLibre's per-source feature-state store. Covered by test E5 |
| PMTiles: `const protocol = new Protocol(); maplibregl.addProtocol('pmtiles', protocol.tile)`, with source URL `pmtiles://<url>`. pmtiles is at **4.5.0** | https://docs.protomaps.com/pmtiles/maplibre (V); npm (V) |
| `@protomaps/basemaps` **5.7.2**: `layers(source, namedFlavor(name), {lang})`. Flavours are `light`, `dark`, `white`, `black` and `grayscale`. Glyphs and sprites can be self-hosted. Recommended attribution: Protomaps © OpenStreetMap | https://docs.protomaps.com/basemaps/maplibre (V) |
| deck.gl is at **9.4.0** (2026-09-05) | npm (V) |
| **`@deck.gl/maplibre` `MapLibreOverlay` is "the recommended deck.gl integration for MapLibre GL JS v4.5.1, v5, and v6"**. Its peer range is `maplibre-gl ^4.5.1 \|\| ^5 \|\| ^6`. `interleaved: true` shares MapLibre's WebGL2 context, inserts layers into the style stack, is fixed at construction, and allows one interleaved overlay per map. Layers take `beforeId` | https://deck.gl/docs/api-reference/maplibre/overview (V); `npm view @deck.gl/maplibre peerDependencies` (V) |
| In interleaved mode, `useDevicePixels` is ignored (use MapLibre's `pixelRatio`). MapLibre manages the camera and controller. The base map uses `antialias:false` unless set | https://deck.gl/docs/api-reference/mapbox/mapbox-overlay (V) |
| SolidPolygonLayer binary input is `data = {length, startIndices, attributes: {getPolygon: {value, size}}}`, with `_normalize:false` and `_windingOrder:'CW'`. `extruded` adds `getElevation` | https://deck.gl/docs/api-reference/layers/solid-polygon-layer (V) |
| The shader does `pos.z += elevations * elevationScale`. `elevationScale` is a uniform (`solidPolygon` uniform block). `vertexPositions` is `float64` with `fp64: use64bitPositions()` | `modules/layers/src/solid-polygon-layer/solid-polygon-layer{,-vertex-main.glsl}.ts` on deck.gl master (V) |
| Attribute `transitions` match objects **by index**. Insertions and removals "may not look as expected", and `enter` backfill runs on the CPU | https://deck.gl/docs/developer-guide/animations-and-transitions (V) |
| Per-object accessors (`getFillColor`, `getElevation`) on binary data are expanded per vertex using `startIndices` | I. deck's attribute updater. Covered by test C3 |

**Overlay class.** Per the design row and the deck docs above, this spec uses `MapLibreOverlay` from `@deck.gl/maplibre@~9.4.0` with `interleaved: true`.

### 4.1 SSR and mounting

- The `/` and `/p/[id]` pages are SSR'd by platform. `SimMap.svelte` SSRs a static frame:
  - `<section role="region" aria-label="3D map of San Francisco" data-testid="map-root" data-state="loading">`, filling its slot. Its background is `--map-land`.
  - Inside it, a centred status line, "Loading map…", in an `aria-live="polite"` element.
  - A `<noscript>` with the text "The map needs JavaScript and WebGL 2."
  - No map library is imported at module top level.
- The component never fetches the manifest. If the plan's version 404s, the fallback to current (and plan-sharing's "older data" notice) has already happened upstream (I16); map-view renders whatever `manifest` it is given, and remounts if a different one is passed.
- In `onMount`, the component:
  1. Runs the WebGL2 probe (§4.9).
  2. `await import('maplibre-gl')` and `pmtiles`, then registers the protocol **once per page**. The registration is guarded by a module flag. `removeProtocol` runs only on full page unload.
  3. Constructs the map.
  4. Imports `@deck.gl/maplibre` and `@deck.gl/layers` after the map's first `load`. This keeps deck off the critical path.
  5. Tears everything down on destroy: `overlay.finalize()`, then `map.remove()`.
- `data-state` takes these values: `loading` → `ready` | `unsupported` | `error` | `context-lost`. e2e tests read it.

### 4.2 Camera

| | desktop (≥ 640 px wide) | narrow (< 640 px) |
|---|---|---|
| default frame | center `[-122.4194, 37.7749]`, zoom 13.0, pitch 55, bearing −20 | same center, zoom 12.2, pitch 45, bearing −20 |
| constraints | `minZoom 11`, `maxZoom 18`, `maxPitch 70`, `maxBounds [[-122.56, 37.69], [-122.33, 37.84]]` | same |

- `initialFrame: 'plan-bbox'` is used by `/p/[id]` when the plan has ops. It calls `fitBounds(planBBox, {padding: 48 + bottomInset, pitch, bearing})` with the default pitch and bearing, clamped to `maxZoom 16`. An empty plan uses the default frame.
- The camera is not written to the URL in M1. The `hash` option stays false.
- `prefers-reduced-motion: reduce` turns every programmatic camera move into `jumpTo` (no `flyTo` or `easeTo`).
- Projection is Mercator.
- `pixelRatio` is `min(devicePixelRatio, 2)`.

### 4.3 Style and palette

The basemap source is `protomaps`, `pmtiles://` + `manifest.basemapTiles` (an SF extract). Glyphs come from `manifest.glyphs` (`/data/<v>/fonts/{fontstack}/{range}.pbf`, root-relative per I12), self-hosted as the platform CSP §4.6 requires. The pipeline renames the font directories without spaces (`NotoSans-Regular`, `NotoSans-Medium`, `NotoSans-Italic`), so the built style rewrites every `text-font` stack to those names.

We build a custom flavour from `namedFlavor('white')` (light) and `namedFlavor('black')` (dark), overriding the tokens below. The `pois` layer and road shields are dropped, so **no sprite is loaded**; `manifest.sprite`, if present, is ignored in M1. Labels are kept for streets, neighbourhoods and water, with `lang: 'en'`.

| token | light | dark | used for |
|---|---|---|---|
| `--map-land` | `#F3EFE6` | `#1C1D1F` | background/earth, SSR frame |
| `--map-water` | `#C7D3D6` | `#10181C` | water |
| `--map-park` | `#E2E4D3` | `#1F2420` | parks/landcover |
| `--map-road` / `--map-road-minor` | `#FFFFFF` / `#EAE5DA` | `#2C2E31` / `#252729` | roads |
| `--map-label` | `#5E5A52` | `#A9A59C` | labels (halo = land) |
| `--map-existing` | `#D6D0C4` | `#3B3D41` | existing extrusions |
| `--map-replaced` | `#E3DACA` | `#2A2B2E` | footprint of a hidden existing building (§4.5) |
| `--gen-adu … --gen-tower` | `#E9A487 #E08A68 #D2704E #BF5A3A #A3472C #84371F` | `#6E3B22 #8A4A28 #A65C2E #C27236 #DB8B42 #F0A752` | generated buildings, by I10 order |
| `--map-highlight` | rgba(255,255,255,0.45) | rgba(255,255,255,0.30) | hover (`autoHighlight`) |
| `--map-chunk-loading` / `--map-chunk-error` | `#8A8478` / `#B3261E` | `#8F8A80` / `#F2B8B5` | chunk outlines |

The palette has three rules:
1. **Existing is neutral, generated is warm.** Existing buildings use a neutral hue and generated buildings a saturated terracotta (light) or amber (dark) ramp.
2. **Taller typologies get more ground contrast** in both themes.
3. **Every `--gen-*` is ΔE2000 ≥ 20 from `--map-existing`** in the same theme (test U4).

Colour is never the only carrier of typology: the tooltip names it.

**Theme.** The `theme` prop defaults to `matchMedia('(prefers-color-scheme: dark)')` and follows its `change` event. A theme change does **not** call `setStyle`. It does three things:
- applies a precomputed list of `setPaintProperty(layerId, prop, value)` pairs, generated by diffing the two built styles;
- bumps `updateTriggers.getFillColor` on deck layers;
- leaves feature-state intact.

### 4.4 Layer stack (bottom → top)

1. Protomaps base layers, up to and including roads.
2. `existing-buildings`: `fill-extrusion` on source `buildings` (`pmtiles://` + `manifest.buildingsTiles`), `promoteId: {buildings: 'parcelId'}`, minzoom 12. Its paint properties:
   - `fill-extrusion-height` = `case(feature-state.replaced, 0, coalesce(get heightM, 6))`
   - `fill-extrusion-base` = `case(feature-state.replaced, 0, coalesce(get baseM, 0))`
   - `fill-extrusion-color` = `case(feature-state.replaced, --map-replaced, --map-existing)`
   - `fill-extrusion-opacity`: zoom-interpolated, 0 at z12 and 0.92 at z13
3. `chunk-status`: GeoJSON `fill` and `line` layers over the cell bboxes from I12.
4. deck `generated-<cellId>` layers and `rising-<rev>-<cellId>` layers, with no `beforeId`, so they share the 3D depth buffer with the extrusions. The layers passed to `setOverlayLayers` (I17; brush-tool's `brush-ring` and `brush-swath`) follow them in the same overlay's layer list, so they draw on top. Their ids must not start with `generated-` or `rising-`.
5. Protomaps label layers.
6. **Reserved**: an `overlay-anchor` empty `background` layer with `visibility:none`, used as a `beforeId` slot for M2 area overlays and for the brush ring if brush-tool wants it in-map.

**Ground-up rendering of generated parts.** Each `parts[i]` renders as a prism from 0 to `topM`. The polygon positions are 2-D (z = 0), and elevation is `partTopM`. This is valid because I9 guarantees that parts are single rings and nested: every part's footprint lies within the footprint of the part directly beneath it (podium ⊇ tower, lower floors ⊇ stepback, roof ⊇ parapet), and they are rendered ground-to-`topM`. Under that containment the hidden lower sections are interior, so the picture is identical. typology-generator guarantees containment; property test U6 re-asserts it here. The payoff is that a single `elevationScale` uniform raises an entire building coherently, which is the basis of the rise-in (§4.6).

### 4.5 Hiding existing buildings on replaced parcels

- **Mechanism: feature-state, not filter.** A filter would need `["in", parcelId, literal[…]]` over up to ~150k ids, and every change re-evaluates every loaded tile. Feature-state cannot be used in filters (V), so hiding is done through the paint properties instead (§4.4): height 0 and the `--map-replaced` colour. What remains is a flat footprint at ground, a deliberate *ghost* that shows something was demolished. It is always covered by, or adjacent to, the generated replacement.
- **Which parcels.** A parcel is hidden iff its current `GeneratedBuilding.replacesExisting === true`. ADUs (`replacesExisting: false`) leave the existing building visible.
- **Tracking.** The worker host owns the authoritative previous set and sends `hide.add` / `hide.remove` diffs. Main thread keeps a `Set<ParcelId>` mirror, used only for picking checks and the debug hook. Applying a diff:
  - `setFeatureState({source:'buildings', sourceLayer:'buildings', id}, {replaced:true})` for each `add`;
  - `removeFeatureState({…id}, 'replaced')` for each `remove`.
- **Batching.** A diff of ≤ 2,000 ids is applied synchronously in the same task as the deck layer update, so the hide and the rise start on the same frame. Larger diffs (a whole-city repaint) are applied in slices of 2,000 per animation frame. Each slice's cells are applied with it, so a building is never hidden before its replacement exists. Main-thread time per slice is ≤ 8 ms (test C5).
- Buildings with no `parcelId` property are never hidden. Building tiles are clipped to parcels (I12), so a building straddling several parcels arrives as one feature per parcel and hiding removes only the piece on the replaced lot.
- **Empty plan.** No feature-state is set. `removeFeatureState({source:'buildings'})` clears everything on a revision-0 snapshot.

### 4.6 Generated-layer updates and rise-in

- **Packing.** It happens in the worker. `packCell` takes the cell's `GeneratedBuilding[]` (I9) together with the `ParcelRecord` (I6) fields, and is deterministic: identical inputs give byte-identical buffers. Positions are lng/lat `Float64Array`, so deck's fp64 path keeps sub-centimetre precision at z18 (V: attribute type `float64`). Every typed array is in the `postMessage` transfer list.
- **Granularity.** One deck `SolidPolygonLayer` per manifest cell (`id: generated-<cellId>`). An update re-packs only the touched cells, and deck re-tessellates only those layers. A cell holds ~0.5–2k parcels, so tessellation stays a few ms (I; budget measured by C5). We do **not** use deck `transitions` or `_dataDiff`, because index-matched transitions break on insertions and removals (V).
- **Layer props.** `extruded:true`, `_normalize:false`, `_windingOrder:'CW'`, `getElevation: (_, {index}) => partTopM[index]`, `getFillColor: (_, {index}) => palette[theme][partTypology[index]]`, `material` on (default lighting), `pickable:true`, `autoHighlight:true`, `highlightColor: --map-highlight`.
- **Rise-in.**
  - `cells[i].rising` holds the parcels that are **new or taller** in this revision. Shrunk parcels are in `settled` only.
  - `rising` is drawn as its own layer, with `elevationScale` animated 0 → 1 over **400 ms**, ease-out cubic (`1-(1-t)^3`), driven by `requestAnimationFrame` and `setProps`.
  - When the animation ends, the cell's `rising` and `settled` packs are concatenated on the main thread (array copies only) and become the new `generated-<cellId>`. The rising layer is removed. Merges are time-sliced at one cell per frame.
  - A taller rebuild re-rises from ground. Its previous geometry is gone from `settled`.
  - If a new update touches a cell mid-animation, that cell's pending rise finalises immediately (scale = 1, merge) before the new update applies.
  - Whole-city repaints arrive as many updates, so cells rise in waves as the worker finishes them.
- **Removal** (erase, lower to ineligible, or `null`) is instant, with no sink animation. Restoring the existing building (`hide.remove`) happens in the same frame.
- **Reduced motion.** When `matchMedia('(prefers-reduced-motion: reduce)')` matches (checked live), no rising layer is created. `rising` merges straight into the settled pack, so buildings appear at full height on the first frame after the update.
- **Ordering.** Updates apply strictly in `revision` order. When `revision !== last + 1` and is not 0, map-view discards the update and calls `onResyncNeeded`. The worker host answers with a revision-0 snapshot, which replaces all cells and the hide set. A revision-0 snapshot is never animated.
- **Latency budget.** The design budgets 150 ms from pointer-up to buildings appearing for ≤ 500 parcels. map-view's share is ≤ 30 ms main-thread from message receipt to the first frame drawn with the rising layer (test C5). The rest belongs to the worker host and generator.

### 4.7 Picking, tooltip and card

- **Pointer (hover-capable devices).**
  - Picking runs on `pointermove`, throttled to one pick per animation frame.
  - It is suppressed while any button is down, while the map is moving (`movestart`…`moveend`), and while brush-tool reports an active stroke (it does so via `setPanEnabled(false)` + pointer down).
  - Order: first `overlay.pickObject({x, y, radius: 2})` over the generated layers. If nothing is hit, `map.queryRenderedFeatures(point, {layers:['existing-buildings']})`, discarding any feature whose parcel is in the hidden mirror.
- **Tooltip.** A `role="tooltip"` element offset 12 px from the pointer and flipped to stay in the viewport. It contains text only:

| hit | line 1 | line 2 |
|---|---|---|
| generated, replaces | `Parcel 3512008` | `Mid-rise · 8 stories · 64 units · replaces 3 (net +61)` |
| generated ADU | `Parcel 3512008` | `ADU · adds 1 unit to 2 existing (net +1)` |
| existing, chunk ready, eligible | `Parcel 3512008` | `Existing building · 3 units` |
| existing, ineligible | `Parcel 3512008` | `Existing building · 4 units · not eligible for change` (units from the summary) |
| existing, chunk not loaded | `Parcel 3512008` | `Existing building · units loading…` (hover triggers no fetch; text updates if the chunk arrives while hovered) |
| existing, chunk error | `Parcel 3512008` | `Existing building · units unavailable` |
| existing, no `parcelId` | `Existing building` | `Not matched to a parcel` |

  - Typology display names: ADU, Plex, Walk-up, 5-over-1, Mid-rise, Tower.
  - Numbers use `Intl.NumberFormat('en-US')`.
  - Existing units for a non-generated hit come from the worker host's loaded `ParcelRecord`, through I15's `parcelSummary` request (brush-tool §4.9). The tooltip sends one request per newly hovered parcel id and ignores replies whose `reqId` is stale. The tooltip re-requests when the hovered parcel's cell turns `ready`. A `null` summary with the cell `loading` (or not yet requested) gives the "units loading…" row; with the cell `error`, the "units unavailable" row. The generated rows use the `PackedCell` `parcelMeta` already on the main thread.
- **Touch (no hover).** In pan mode, a tap without movement (< 6 px, < 300 ms) runs the same pick. The result shows as a card docked above the bottom inset, full width minus 16 px gutters, with a close button labelled "Close". Tapping empty map dismisses it. In paint mode, taps belong to brush-tool and do not pick.
- The tooltip and card never block map input (`pointer-events:none` on the tooltip).

### 4.8 Loading and error states

| what | UI | trigger |
|---|---|---|
| basemap/style | SSR frame "Loading map…"; on map `load` → frame removed, `data-state=ready` | — |
| tiles (basemap or buildings) | 2 px indeterminate bar at the map's top edge, `aria-hidden`. An `aria-live` text "Loading buildings…" is announced only if loading lasts > 2 s | shown when `!map.areTilesLoaded()` for > 300 ms; hidden on `idle` |
| basemap tile fetch errors | no blocking UI; MapLibre retries on next move; one console warning per source | `error` event with `sourceId` |
| buildings source unreachable (manifest URL 404/5xx) | inline banner "Existing buildings couldn't load. Generated buildings still work." + "Retry" button (re-adds source) | `error` with `sourceId:'buildings'` and no tile loaded |
| parcel chunk `loading` | cell bbox: 1 px dashed `--map-chunk-loading` outline + 6% fill (static; no animated hatch) | `setChunkStatus(cell,'loading')` |
| parcel chunk `error` | cell outline solid `--map-chunk-error`; status chip "Some parcels didn't load — Retry" (button sends brush-tool's `retryChunks` request, which retries every failed cell) | `setChunkStatus(cell,'error')`, forwarded from the I15 `chunks.status` map |
| chunk `ready` | outline removed | — |
| WebGL context lost | overlay "The map's graphics stopped. Reload the page to continue." + Reload button; `data-state=context-lost`; on `webglcontextrestored` overlay removed and state restored | map `webglcontextlost` |

A failed chunk never hides or alters existing buildings. Strokes over it simply generate nothing there (plan-model's coverage), and the retry chip remains until the chunk is `ready`.

### 4.9 WebGL-unavailable fallback

The probe runs before the map is constructed: `document.createElement('canvas').getContext('webgl2')`. If it returns null, or MapLibre emits a context-creation `error` during construction, map-view does the following:
- Renders a panel with `role="alert"`:
  - Heading: "This map needs WebGL 2".
  - Body: "Your browser or device has WebGL turned off or unavailable. You can still read the scoreboard and share links. Try a current version of Firefox, Chrome, Safari or Edge with hardware acceleration enabled."
- Sets `data-state=unsupported` and dispatches a `mapunsupported` event so brush-tool can disable painting.

The rest of the shell, including the scoreboard and `/p/[id]` numbers, still renders. Their numbers come from the worker, not from WebGL.

### 4.10 Attribution control

- Uses MapLibre's `AttributionControl`, bottom-right, with the default MapLibre credit removed (`attributionControl:false` plus a custom control).
- Its text is exactly the platform-fixed string "© OpenStreetMap · Overture Maps (Esri, Microsoft, USGS) · DataSF · Protomaps". The whole string is a link to `/attribution` (platform spec §4.6).
- The link has `title="Data & licences: OpenStreetMap and Overture data under ODbL; DataSF under PDDL / public domain; Protomaps basemap"`.
- ≥ 640 px: always expanded.
- < 640 px: `compact`, expanded on first load. It collapses to the (i) button after the first user map interaction, and the button re-expands it.
- The ODbL notices and source vintages live on `/attribution`, one tap away.

### 4.11 Layout at 375 px

- The map fills the area between platform's header and footer (platform §4.6). The brush-tool and scoreboard bottom bars overlay its lower edge, and `setBottomInset` keeps the camera and controls clear of them.
- `setBottomInset(px)` is called by the scoreboard and brush-tool sheets (via the shell) and maps to `map.setPadding({bottom})`, so the camera centre and `fitBounds` respect the sheets.
- No MapLibre NavigationControl on touch (`pointer: coarse`). Gestures handle zoom, and a 44×44 px "Reset view" button sits bottom-left (it `jumpTo`s the default frame). On fine pointers, a NavigationControl with compass sits bottom-left. Top-left belongs to brush-tool's toolbar and top-right to the scoreboard panel (≥ 768 px). `setBottomInset(px)` also lifts the bottom-left and bottom-right controls and the touch card by `px`, so the bottom bars never cover them (decided in fidelity pass).
- No horizontal page scroll. The tooltip card respects the 16 px gutters. All map buttons are ≥ 44×44 px.
- `cooperativeGestures` is off. Pan versus paint is the explicit mode switch, gated by `setPanEnabled(false)`, which disables `dragPan`, `touchZoomRotate.disableRotation` and `dragRotate`. Pinch-zoom stays enabled in paint mode.

### 4.12 Performance plan (60 fps pan target)

| lever | decision |
|---|---|
| pixel ratio | `min(dpr, 2)` |
| antialias | `canvasContextAttributes.antialias = dpr < 2` (MSAA only where aliasing is visible) |
| existing buildings | MVT extrusions from z12; no `fill-extrusion-vertical-gradient` changes; no data-driven expression except feature-state |
| deck | binary input, `_normalize:false`, ≤ 1 layer per cell plus transient rising layers; settled layers' props are referentially stable between frames (no new accessor functions per render: accessors are created once per cell/theme) |
| picking | throttled to 1/frame; disabled while moving; never `pickable:'3d'` |
| main-thread work during pan | zero map-view JS on `move` besides MapLibre/deck internals |
| big updates | feature-state slices 2k/frame; cell merges 1/frame; long tasks ≤ 50 ms (C5) |
| bundle | maplibre-gl + pmtiles in the first island chunk; deck (`@deck.gl/core`, `layers`, `maplibre`) lazy after `load`; no `@deck.gl/geo-layers`, no loaders.gl |
| first paint | target ≤ 5 MB transferred until first `idle` at the default frame (JS + style + glyphs + basemap + buildings tiles); verified by E10 against staging |

Measurement: a manual benchmark `npm run bench:map` (headed Chrome, real GPU) runs a scripted 10 s pan at pitch 55 over downtown with a synthetic whole-city plan loaded, and reports p50/p95 frame time. The pass bar is p95 ≤ 16.7 ms on a 2022 MacBook Air (M2) class machine. Results are recorded in `docs/dev/map-perf.md`. CI cannot measure GPU frame time, because headless Chromium uses a software GL. CI instead gates on main-thread budgets (C5).

## 5. Seams

- **M2 `area-select`**: the reserved `overlay-anchor` beforeId slot (§4.4). Nothing else.
- **M2 `buildout-likelihood` / M3 `scenario-loader` / M5 `pipeline-overlay`**: the palette lookup is `colorFor(source: GeneratedBuilding['source'], typology, theme)`. M1 implements only `'user'`, and other values throw in dev. Hiding stays keyed only on `replacesExisting`, so it is source-agnostic. `PackedCell` gains a per-part source byte when a second source exists, not now.
- **M4 `time-permitting`**: none now. The rise-in is M1's stand-in for construction.
- **M2 `consequences`**: none.

## 6. Testing

Fixtures:
- `src/lib/map/fixtures/generated-small.json`: 12 `GeneratedBuilding`s covering all 6 typologies, including podium+tower and ADU.
- `parcels-small.json`: the matching `ParcelRecord`s.
- `makeSyntheticCity(seed, n=150_000)`: a script-generated set, not committed.
- e2e dataset: platform's fixture dataset `fixture-0` (`e2e/fixtures/data/fixture-0/`, generated by data-pipeline), which includes `basemap.pmtiles`, glyphs, and a buildings tile set whose features carry `parcelId`.

**Unit (Vitest server project, pure TS)**
- U1 `pack.spec.ts`: `packCell` gives `startIndices` monotonic with last = vertex count, positions open and CW, `partSlot` and `parcelMeta` correct, and byte-identical output on repeat.
- U2 `hide-diff.spec.ts` (fast-check): applying any sequence of diffs to the mirror equals the full replaced set. ADU never enters it.
- U3 `camera.spec.ts`: the default frame for 1280 and 375 widths; `plan-bbox` clamps to z16; an empty plan gives the default frame.
- U4 `palette.spec.ts`: every I10 typology has light and dark colours; ΔE2000(gen, existing) ≥ 20 per theme; ground contrast increases with typology order.
- U5 `tooltip.spec.ts`: every row of the §4.7 table, including en-US formatting.
- U6 `containment.spec.ts` (fast-check over generator fixtures): each part footprint lies within the part beneath it.
- U7 `style.spec.ts`: built from a fixture `Manifest`, the style has no `sprite` (even when `manifest.sprite` is set), no `pois` layer, `glyphs === manifest.glyphs`, the basemap source URL is `pmtiles://` + `manifest.basemapTiles`, every `text-font` stack name contains no space, `promoteId` set, and the light/dark paint-diff list covers every themed layer.

**Client (Vitest browser project)**
- C1 `SimMap.svelte` with `getContext('webgl2')` stubbed to null: the fallback panel text is shown, it has `role=alert`, `data-state=unsupported`, and no maplibre import happened.
- C2 SSR render (`render` from `svelte/server`): the static frame markup, "Loading map…", and the noscript text.
- C3 Overlay with the fixture: per-object accessors expand per vertex. Read back via the debug hook: vertex count and colour of part 0.
- C4 Reduced motion (matchMedia stub): after `applyGenerated`, no `rising-*` layer, and settled elevationScale is 1.
- C5 Budgets (`performance.measure`): `applyGenerated` with 500 parcels takes ≤ 30 ms to the first rising frame. Feeding a synthetic whole-city update produces no `longtask` > 50 ms, and each feature-state slice takes ≤ 8 ms.
- C6 Revision gap: `onResyncNeeded` fires; revision 0 replaces everything.
- C7 `setOverlayLayers` (I17): the passed layers render above the generated layers; a second call replaces them; `[]` removes them; generated layers are untouched.

**e2e (Playwright, against the fixture dataset; axe gate per platform `expectNoA11yViolations`)**
- E1 `/` loads: `data-state=ready`, canvas present, attribution text exact and linking to `/attribution`. axe passes at 1280 and at 375.
- E2 Paint a stroke (brush-tool helper). The debug hook reports parts > 0 and hidden count = the replacing parcels. Erasing returns both to 0.
- E3 Hover a generated building: the tooltip contains the parcel id, typology name and units. Hover an existing one: "Existing building".
- E4 At 375 px: no horizontal scroll; a tap in pan mode shows the card; Close dismisses it; attribution starts expanded.
- E5 Feature-state persistence: paint, zoom out to z11, zoom back in. The replaced building is still hidden after its tiles reload.
- E6 WebGL off (init script returns null for `webgl2`): the fallback is shown and axe passes.
- E7 Chunk failure (route a chunk to 500): the error outline and chip appear; Retry with success clears them.
- E8 `reducedMotion:'reduce'` context: buildings are at full height on the first frame after the update.
- E9 Golden screenshots `map-light.png` and `map-dark.png` at the default frame with the fixture plan (plan-sharing's `src/lib/sharing/fixtures/plans/small.json`, 3 strokes on `fixture-0` (decided in fidelity pass)), `maxDiffPixelRatio 0.01`, under Chromium SwiftShader.
- E10 `@budget` (post-deploy, staging only): transferred bytes until the first `idle` are ≤ 5 MB.

The debug hook `window.__sfhMap` (counts, layer ids, elevationScale, hidden set size) is compiled in only when `import.meta.env.VITE_E2E === '1'`.

## 7. Acceptance criteria

1. Versions: `maplibre-gl@^6.13`, `pmtiles@^4.5`, `@deck.gl/{core,layers,maplibre}@~9.4`, `@protomaps/basemaps@^5.7`. No `@deck.gl/mapbox` dependency.
2. The server render of `/` contains the static map frame and no MapLibre or deck code. The client build loads deck only after map `load`.
3. Existing buildings render as extrusions from z12. Replaced parcels show only the `--map-replaced` ghost footprint. ADU parcels keep their building.
4. Generated buildings render in the typology ramp, rise over 400 ms ease-out, and appear at full height immediately under reduced motion.
5. Hidden state stays correct across tile reloads, revision-0 snapshots, and whole-city repaints, with no long task > 50 ms (C5).
6. The tooltip and card show exactly the §4.7 strings.
7. Every §4.8 state is reachable in tests and shows its specified text.
8. Without WebGL2, the §4.9 panel shows, `data-state=unsupported`, and axe passes.
9. The attribution text is exact, links to `/attribution`, and is visible on first load at 375 px.
10. At 375 px there is no horizontal scroll and map buttons are ≥ 44 px.
11. Light and dark themes switch without `setStyle` and without losing feature-state.
12. U1–U7, C1–C7 and E1–E9 pass in CI. The E10 and `bench:map` results are recorded.

## 8. Open questions (with recommendations)

1. *Ghost footprint versus fully invisible replaced buildings.* Recommend the ghost: it is honest about demolition, and it costs nothing.
2. *Should taller rebuilds rise from their previous height instead of from ground?* Recommend from ground for M1. It is simpler and reads clearly.
3. *Camera in the URL for share links?* Recommend no for M1. `/p/[id]` frames the plan bbox.
4. *Antialias policy (`dpr < 2`).* Recommend keeping it, and revisiting once `bench:map` numbers are in.

## 9. Interface concerns (for the orchestrator)

1. ~~**The design names `MapboxOverlay`.**~~ *Resolved:* the design row now names `MapLibreOverlay` from `@deck.gl/maplibre`.
2. ~~**I12 lacks the basemap and the building-tile schema.**~~ *Resolved:* I12 now has `basemapTiles`, `glyphs`, optional `sprite`, and the `buildings` source-layer schema (`parcelId`, `heightM`, `baseM`, minzoom ≤ 12, clipped to parcels).
3. ~~**Worker-host ↔ map-view channel.**~~ *Resolved by I15, including the `parcelSummary` request/response added in the follow-up rulings (§4.7).* History: `GeneratedUpdate` / `PackedCell` travel as `diff.render`; chunk status travels as `chunks.status` and is forwarded to `setChunkStatus`; per-cell retry is replaced by brush-tool's `retryChunks`. **Still open:** `getParcelSummary(id)` (existing units for the tooltip on a non-generated building, §4.7) has no carrier, because I15's `SimResponse` union has no reply variant for it. Options: add a `{ type: 'parcelSummary' }` response to I15, or ship existing units in the building tiles.
4. ~~**Part containment is not stated in I9.**~~ *Resolved:* I9 now states parts are single rings, nested, rendered ground-to-`topM`; typology-generator guarantees it.
