<script module lang="ts">
  import type { Protocol as PmtilesProtocol } from 'pmtiles';
  import { TOKENS as THEME_TOKENS } from './palette';
  import { attributionHtml } from './attribution';

  type MapLibreModule = typeof import('maplibre-gl');

  // CSS defaults for the --map-* tokens, so the SSR frame follows prefers-color-scheme before
  // JS resolves a theme (an explicit or JS-resolved theme overrides them inline).
  const tokenVars = (t: 'light' | 'dark') =>
    Object.entries(THEME_TOKENS[t])
      .map(([k, v]) => `--map-${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}: ${v}`)
      .join('; ');
  const DEFAULT_TOKENS_CSS =
    `<style>.sim-map { ${tokenVars('light')} } ` +
    `@media (prefers-color-scheme: dark) { .sim-map { ${tokenVars('dark')} } }</style>`;

  // One pmtiles protocol per page (spec §4.1). Removed only on a real unload, never when the
  // page enters the back/forward cache (a restored page keeps its live map).
  let protocol: PmtilesProtocol | null = null;

  // MapLibre v6 derives its worker URL from import.meta.url + './maplibre-gl-worker.mjs'.
  // Bundlers (Vite's dep pre-bundling in dev, Rollup in build) move maplibre-gl.mjs away from
  // that sibling, so the worker 404s. Pass Vite's emitted asset URL explicitly instead.
  function setupLibraries(
    ml: MapLibreModule,
    P: typeof PmtilesProtocol,
    workerUrl: string
  ): PmtilesProtocol {
    if (protocol) return protocol;
    ml.setWorkerUrl(workerUrl);
    const p = new P();
    ml.addProtocol('pmtiles', p.tile);
    protocol = p;
    addEventListener('pagehide', (e) => {
      if (e.persisted || protocol !== p) return;
      ml.removeProtocol('pmtiles');
      protocol = null;
    });
    return p;
  }
</script>

<script lang="ts">
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import type { Layer } from '@deck.gl/core';
  import type { MapLibreOverlay } from '@deck.gl/maplibre';
  import type { ErrorEvent as MapErrorEvent, GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
  import type { ParcelId } from '$lib/data/parcel';
  import type { Manifest } from '$lib/data/manifest';
  import type { Day } from '$lib/timelapse/time';
  import { DEFAULT_TRANSIT_PARAMS, SF_GRID_BBOX, buildAccessGrid } from '$lib/transit';
  import { DEFAULT_VIEW } from '$lib/view/prefs';
  import { CONSTRAINTS, NARROW_PX, defaultFrame, initialCamera, pixelRatio } from './camera';
  import { loadDeck } from './deck-loader';
  import { loadTimelapse } from './timelapse-loader';
  import { generatedCellFilter } from './cull';
  import { controlsFootprint } from './footprint';
  import { installDebug } from './debug';
  import { GeneratedController, type ControllerDeps } from './generated-controller';
  import type { TimelineController, TimelinePartLookup } from './timeline-controller';
  import type { TimelineLookups } from './timelapse/types';
  // Pure (no deck or luma): the handle validates before it stores or queues (ruling R18).
  import { validateTimedCell } from './timelapse/encode';
  import { packChanceTexture } from './timelapse/lookups';
  import { TOKENS } from './palette';
  import { cellAt, chunkStatusCollection, resolveExistingHit, tooltipPosition } from './pick';
  import {
    BUILDINGS_LAYER,
    BUILDINGS_SOURCE,
    CHUNK_LAYERS,
    CHUNK_SOURCE,
    TRANSIT_ACCESS_LAYER,
    TRANSIT_ACCESS_SOURCE,
    TRANSIT_STOP_LAYERS,
    TRANSIT_STOPS_SOURCE,
    buildStyle,
    firstSymbolLayerId,
    buildingsSource,
    existingBuildingsLayer,
    themePaintDiff,
    type PaintSet
  } from './style';
  import { tooltipLines, type TooltipHit } from './tooltip';
  import {
    accessCollection,
    loadTransitNetwork,
    stopTooltipLines,
    stopsCollection,
    transitView,
    type TransitView
  } from './transit-layer';
  import type {
    ChunkStatus,
    GeneratedUpdate,
    ParcelSummaryLike,
    SimMapHandle,
    SimMapProps,
    Theme,
    TimelineUpdate
  } from './types';
  import { hasWebGL2 } from './webgl';

  let {
    manifest,
    theme: themeProp = undefined,
    initialFrame = undefined,
    planBBox = undefined,
    requestParcelSummary = undefined,
    onRetryChunks = undefined,
    onready = undefined,
    view = undefined,
    fetchTransit = undefined,
    timelinePick = undefined
  }: SimMapProps = $props();

  type PaintProp = Parameters<MapLibreMap['setPaintProperty']>[1];
  type PaintValue = Parameters<MapLibreMap['setPaintProperty']>[2];
  type MapState = 'loading' | 'ready' | 'unsupported' | 'error' | 'context-lost';
  type Surface = 'tooltip' | 'card';
  /** hover: fine-pointer move; tap: touch tap; click: mouse/pen tap (only with `timelinePick`). */
  type PickKind = 'hover' | 'tap' | 'click';
  type PickResult =
    { hit: TooltipHit; cell: string | null } | { timeline: TimelinePartLookup } | null;
  type SolidPolygonLayerClass = Awaited<ReturnType<typeof loadDeck>>[1]['SolidPolygonLayer'];

  const FS = { source: BUILDINGS_SOURCE, sourceLayer: 'buildings' } as const;
  const RESERVED = /^(generated|rising|timeline)-/;
  const GENERATED = /^(generated|rising)-/;
  const TIMELINE = /^timeline-/;
  const TAP_PX = 6;
  const TAP_MS = 300;
  /** Half-size of the square hit box around the pointer for stop markers (transit spec §6.1). */
  const STOP_HIT_PX = 6;
  /** Stop tooltips from this zoom up (transit spec §6.1). */
  const STOP_TOOLTIP_MIN_ZOOM = 14;

  let root = $state<HTMLElement>();
  let container = $state<HTMLDivElement>();
  let mapState = $state<MapState>('loading');
  let systemTheme = $state<Theme>('light');
  let systemResolved = $state(false);
  const theme = $derived<Theme>(themeProp ?? systemTheme);
  let bottomInset = $state(0);
  const chunkStatuses = new SvelteMap<string, ChunkStatus>();
  const chunkError = $derived([...chunkStatuses.values()].includes('error'));
  let loadingBar = $state(false);
  let loadingSlow = $state(false);
  let buildingsFailed = $state(false);
  let coarse = $state(false);
  let shown = $state<{ surface: Surface; x: number; y: number; hit: TooltipHit } | null>(null);
  let vw = $state(0);
  let vh = $state(0);
  let tw = $state(0);
  let th = $state(0);

  const lines = $derived(shown ? tooltipLines(shown.hit) : null);
  const tipPos = $derived(shown ? tooltipPosition(shown.x, shown.y, tw, th, vw, vh) : null);

  const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  // Unset theme before the client resolves it (SSR, first paint): the CSS defaults apply.
  const rootStyle = $derived(
    [
      ...(themeProp !== undefined || systemResolved
        ? Object.entries(TOKENS[theme]).map(([k, v]) => `--map-${kebab(k)}: ${v}`)
        : []),
      `--map-bottom-inset: ${bottomInset}px`
    ].join('; ')
  );

  // ---- per-mount (per manifest) state; never reactive ------------------------------------------

  interface Live {
    dead: boolean;
    loaded: boolean;
    map: MapLibreMap | null;
    overlay: MapLibreOverlay | null;
    controller: GeneratedController | null; // null in timeline mode
    timeline: TimelineController | null; // timeline mode only, once its lazy module has loaded
    timelinePart: RegExp | null; // TIMELINE_PART_LAYER, from that module
    timelineLoading: boolean;
    timelineFailed: boolean; // a timelapse shader error: the error state is final for this map
    onRejection: ((e: PromiseRejectionEvent) => void) | null; // timeline mode's compile watch
    SolidPolygonLayer: SolidPolygonLayerClass | null; // from loadDeck(), once the overlay exists
    appliedTheme: Theme;
    paintDiff: Record<Theme, PaintSet[]> | null;
    timers: Set<ReturnType<typeof setTimeout>>;
    loadTimer: ReturnType<typeof setTimeout> | null;
    pickRaf: number | null;
    chunkRaf: number | null;
    pointer: { x: number; y: number } | null;
    touches: number; // active touch pointers (a tap needs exactly one)
    tap: { id: number; x: number; y: number; t: number } | null;
    click: { id: number; x: number; y: number; t: number } | null; // mouse/pen, timelinePick only
    moving: boolean;
    buildingsTileLoaded: boolean;
    warned: Set<string>;
    transit: TransitView | null;
    transitIdle: (() => void) | null; // cancels the pending access-grid build
    deckLayers: Layer[]; // the generated controller's latest deck layers
    deckGroupsPending: boolean; // set while deck skipped adding its MapLibre layer groups
  }

  let live: Live | null = null;

  // ---- handle state that outlives a remount -----------------------------------------------------

  let pendingApplies: GeneratedUpdate[] = [];
  let overlayLayers: Layer[] = [];
  let panEnabled = true;
  let resyncCb: (() => void) | null = null;
  let readyFired = false;
  let unsupportedFired = false;

  // Timeline mode (timelapse-render §4.1 "Mode"): set by the first applyTimeline, kept until
  // unmount. The day and lookups are kept so a new controller (remount) starts with them.
  let timelineMode = false;
  let pendingTimeline: TimelineUpdate[] = [];
  let pendingDay: Day | null = null;
  let pendingLookups: TimelineLookups | null = null;
  let warnedGenerated = false;
  /** The last hover report to `timelinePick` was a part: the next hover miss is sent once. */
  let hoverReported = false;

  // Hovered/tapped existing parcel: summary requests are latest-wins.
  let hovered: {
    parcelId: ParcelId;
    cell: string | null;
    summary: ParcelSummaryLike | null;
  } | null = null;
  let reqSeq = 0;

  // ---- SimMapHandle (I17) -----------------------------------------------------------------------

  export function applyGenerated(u: GeneratedUpdate): void {
    if (timelineMode) {
      if (!warnedGenerated) console.error('[map] applyGenerated ignored in timeline mode');
      warnedGenerated = true;
      return;
    }
    const c = live?.controller;
    if (c) return c.apply(u);
    if (mapState === 'error' || mapState === 'unsupported') return; // nothing will drain them
    if (u.revision === 0) pendingApplies = [];
    pendingApplies.push(u);
  }

  export function setChunkStatus(cellId: string, s: ChunkStatus): void {
    const prev = chunkStatuses.get(cellId);
    chunkStatuses.set(cellId, s);
    pushChunkData();
    if (hovered && hovered.cell === cellId) {
      if (shown?.hit.kind === 'existing' && shown.hit.parcelId === hovered.parcelId) {
        shown = { ...shown, hit: { ...shown.hit, chunk: s } };
      }
      if (s === 'ready' && prev !== 'ready') requestSummary(hovered.parcelId);
    }
  }

  export function setPanEnabled(enabled: boolean): void {
    panEnabled = enabled;
    if (!enabled) clearShown();
    applyPan();
  }

  export function setBottomInset(px: number): void {
    bottomInset = px;
    live?.map?.setPadding({ top: 0, left: 0, right: 0, bottom: px });
    scheduleFootprint(); // the inset lifts the control container; re-measure next frame
  }

  // ---- bottom-right controls footprint (docs/dev/map-interfaces.md) -----------------------------
  const FP_INLINE = '--map-controls-br-inline-size';
  const FP_BLOCK = '--map-controls-br-block-size';
  let fpRaf: number | null = null;
  let fpObserver: ResizeObserver | null = null;
  let footprintGone = false;

  function publishFootprint(inline: number, block: number): void {
    if (footprintGone) return;
    // :root, not the map root: BrushEditor's toolbar and sheets are siblings of SimMap's root.
    for (const el of [document.documentElement, root]) {
      el?.style.setProperty(FP_INLINE, `${inline}px`);
      el?.style.setProperty(FP_BLOCK, `${block}px`);
    }
  }

  function clearFootprint(): void {
    for (const el of [document.documentElement, root]) {
      el?.style.removeProperty(FP_INLINE);
      el?.style.removeProperty(FP_BLOCK);
    }
  }

  function measureFootprint(): void {
    fpRaf = null;
    const controls = live?.map?.getContainer().querySelector('.maplibregl-ctrl-bottom-right');
    if (!root || !controls) return publishFootprint(0, 0);
    const f = controlsFootprint(root.getBoundingClientRect(), controls.getBoundingClientRect());
    publishFootprint(f.inline, f.block);
  }

  function scheduleFootprint(): void {
    if (fpRaf === null && typeof requestAnimationFrame === 'function')
      fpRaf = requestAnimationFrame(measureFootprint);
  }

  function observeFootprint(map: MapLibreMap): void {
    unobserveFootprint();
    const controls = map.getContainer().querySelector('.maplibregl-ctrl-bottom-right');
    if (!controls || !root || typeof ResizeObserver === 'undefined') return;
    fpObserver = new ResizeObserver(scheduleFootprint);
    fpObserver.observe(controls);
    fpObserver.observe(root);
    scheduleFootprint();
  }

  function unobserveFootprint(): void {
    fpObserver?.disconnect();
    fpObserver = null;
    if (fpRaf !== null) cancelAnimationFrame(fpRaf);
    fpRaf = null;
  }

  export function getMap(): MapLibreMap | null {
    return live?.map ?? null;
  }

  export function setOverlayLayers(layers: Layer[]): void {
    for (const l of layers)
      if (RESERVED.test(l.id)) throw new Error(`setOverlayLayers: reserved layer id ${l.id}`);
    overlayLayers = [...layers];
    live?.controller?.setOverlayLayers(overlayLayers);
    live?.timeline?.setOverlayLayers(overlayLayers);
  }

  export function onResyncNeeded(cb: () => void): void {
    resyncCb = cb;
  }

  /**
   * Enters timeline mode on the first call; queues (revision 0 drops the queue) until ready.
   * Every cell is validated first (§4.1 "Validation"), so a malformed cell throws its TypeError
   * whether or not the controller exists yet, and nothing is stored.
   */
  export function applyTimeline(u: TimelineUpdate): void {
    for (const c of u.cells) validateTimedCell(c);
    const t = live?.timeline;
    if (t) return t.apply(u);
    // Generated updates queued for a GeneratedController will never drain in timeline mode.
    if (!timelineMode) pendingApplies = [];
    timelineMode = true;
    if (mapState === 'error' || mapState === 'unsupported') return; // nothing will drain them
    if (u.revision === 0) pendingTimeline = [];
    pendingTimeline.push(u);
    if (live) void enterTimeline(live, false);
  }

  /** O(1) (§4.7). Kept for the controller when there is none yet, or for the next one. */
  export function setTime(day: Day): void {
    if (!Number.isFinite(day)) throw new RangeError(`setTime: day must be finite, got ${day}`);
    pendingDay = day;
    live?.timeline?.setTime(day);
  }

  /**
   * Kept like the day. A chance row longer than 2048 throws a RangeError (§4.4.3) before
   * anything is kept, with or without a controller.
   */
  export function setTimelineLookups(l: TimelineLookups): void {
    packChanceTexture(l.chance);
    live?.timeline?.setLookups(l);
    pendingLookups = l;
  }

  const handle: SimMapHandle = {
    applyGenerated,
    setChunkStatus,
    setPanEnabled,
    setBottomInset,
    getMap,
    setOverlayLayers,
    onResyncNeeded,
    applyTimeline,
    setTime,
    setTimelineLookups
  };

  // ---- effects ----------------------------------------------------------------------------------

  $effect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    systemTheme = mq.matches ? 'dark' : 'light';
    systemResolved = true;
    const on = (e: MediaQueryListEvent) => (systemTheme = e.matches ? 'dark' : 'light');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });

  // Mount per manifest: a different manifest tears the map down and builds a new one. Read via a
  // $derived so an unrelated prop change (which re-signals every prop) with the same manifest
  // object is equality-checked away instead of remounting the map.
  const mounted = $derived(manifest);
  $effect(() => {
    const m = mounted;
    const l = newLive();
    untrack(() => {
      live = l;
      mapState = 'loading';
      publishFootprint(0, 0); // no controls until the map exists
      void start(m, l);
    });
    return () => teardown(l);
  });

  // Unmount only: remove the :root vars. `footprintGone` makes this independent of whether
  // teardown()'s 0px publish runs before or after this cleanup.
  $effect(() => () => {
    footprintGone = true;
    clearFootprint();
  });

  $effect(() => {
    const t = theme;
    untrack(() => applyTheme(t));
  });

  $effect(() => {
    void [view?.transitStops, view?.transitAccess];
    untrack(() => applyView());
  });

  $effect(() =>
    installDebug(
      () => ({
        map: live?.map ?? null,
        controller: live?.controller ?? null,
        timeline: live?.timeline ?? null,
        pendingGenerated: pendingApplies.length
      }),
      { applyTimeline, setTime, setTimelineLookups }
    )
  );

  // ---- lifecycle --------------------------------------------------------------------------------

  function newLive(): Live {
    return {
      dead: false,
      loaded: false,
      map: null,
      overlay: null,
      controller: null,
      timeline: null,
      timelinePart: null,
      timelineLoading: false,
      timelineFailed: false,
      onRejection: null,
      SolidPolygonLayer: null,
      appliedTheme: 'light',
      paintDiff: null,
      timers: new Set(),
      loadTimer: null,
      pickRaf: null,
      chunkRaf: null,
      pointer: null,
      touches: 0,
      tap: null,
      click: null,
      moving: false,
      buildingsTileLoaded: false,
      warned: new Set(),
      transit: null,
      transitIdle: null,
      deckLayers: [],
      deckGroupsPending: false
    };
  }

  async function start(m: Manifest, l: Live): Promise<void> {
    if (!hasWebGL2()) return unsupported(l);
    let ml: MapLibreModule;
    let Protocol: typeof PmtilesProtocol;
    let workerUrl: string;
    try {
      ml = await import('maplibre-gl');
      if (l.dead) return;
      ({ Protocol } = await import('pmtiles'));
      if (l.dead) return;
      ({ default: workerUrl } = await import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'));
      if (l.dead) return;
    } catch (e) {
      if (!l.dead) fail(l, e);
      return;
    }
    setupLibraries(ml, Protocol, workerUrl);
    if (!container) return;
    coarse = matchMedia('(pointer: coarse)').matches;
    const width = container.clientWidth;
    const cam = initialCamera(width, initialFrame, planBBox, bottomInset);
    const dpr = devicePixelRatio;
    l.appliedTheme = theme;
    // Root-relative URLs (glyphs, pmtiles://) resolve without a transformRequest: glyphs are
    // fetched on the main thread and the pmtiles protocol fetches on the main thread too
    // (verified by SimMap.svelte.spec.ts "ready", which fails on any map error).
    let style: ReturnType<typeof buildStyle>;
    try {
      style = buildStyle(m, l.appliedTheme);
    } catch (e) {
      return fail(l, e);
    }
    let map: MapLibreMap;
    try {
      map = new ml.Map({
        container,
        style,
        ...CONSTRAINTS,
        pixelRatio: pixelRatio(dpr),
        canvasContextAttributes: { antialias: dpr < 2 },
        attributionControl: false,
        hash: false,
        cooperativeGestures: false,
        ...(cam.kind === 'jump' ? cam.frame : { bounds: cam.bounds, fitBoundsOptions: cam.options })
      });
    } catch (e) {
      // Only a failed WebGL context means "needs WebGL 2"; anything else is a load error.
      const GPUError = ml.GPUInitializationError;
      const gpu = GPUError ? e instanceof GPUError : /webgl/i.test(String(e));
      return gpu ? unsupported(l) : fail(l, e);
    }
    l.map = map;
    if (bottomInset > 0) map.setPadding({ top: 0, left: 0, right: 0, bottom: bottomInset });
    applyPan();

    map.on('error', (e) => onMapError(l, e));
    map.on('dataloading', () => onDataLoading(l));
    map.on('idle', () => {
      clearLoading(l);
      flushDeckGroups(l);
    });
    map.on('sourcedata', (e) => {
      if (e.sourceId === BUILDINGS_SOURCE && e.tile) l.buildingsTileLoaded = true;
      flushDeckGroups(l);
    });
    map.on('movestart', () => {
      l.moving = true;
      if (shown?.surface === 'tooltip') clearShown();
      unreportHover();
    });
    map.on('moveend', () => (l.moving = false));
    map.on('webglcontextlost', () => {
      if (!l.dead) mapState = 'context-lost';
    });
    map.on('webglcontextrestored', () => {
      if (l.dead) return;
      // A timelapse shader failure stays an error: the restored context would fail the same way.
      mapState = l.timelineFailed ? 'error' : l.loaded ? 'ready' : 'loading';
    });
    map.once('load', () => void onLoad(l, map));

    if (!coarse) map.addControl(new ml.NavigationControl({ showCompass: true }), 'bottom-left');
    const compact = width < NARROW_PX;
    map.addControl(
      new ml.AttributionControl({ compact, customAttribution: attributionHtml(manifest.sources) }),
      'bottom-right'
    );
    observeFootprint(map);
    if (compact) {
      // MapLibre v6 starts compact attribution expanded (maplibregl-compact-show) and collapses
      // it on `drag` only. Also collapse on the first user zoom, rotate or pitch.
      const collapse = (e: { originalEvent?: unknown }) => {
        if (!e.originalEvent) return;
        container
          ?.querySelector('.maplibregl-ctrl-attrib.maplibregl-compact')
          ?.classList.remove('maplibregl-compact-show');
        for (const t of ['zoomstart', 'rotatestart', 'pitchstart'] as const) map.off(t, collapse);
      };
      for (const t of ['zoomstart', 'rotatestart', 'pitchstart'] as const) map.on(t, collapse);
    }
  }

  async function onLoad(l: Live, map: MapLibreMap): Promise<void> {
    if (l.dead) return;
    l.loaded = true;
    mapState = 'ready';
    pushChunkData();
    applyTheme(theme);
    applyView();
    void startTransit(l, map);
    let mods: Awaited<ReturnType<typeof loadDeck>>;
    try {
      mods = await loadDeck();
    } catch (e) {
      // No generated layers without deck: show the error state, drop queued updates, and
      // never fire onready.
      if (!l.dead) fail(l, e);
      return;
    }
    if (l.dead) return;
    const [{ MapLibreOverlay }, { SolidPolygonLayer }] = mods;
    const overlay = new MapLibreOverlay({
      interleaved: true,
      layers: [],
      layerFilter: generatedCellFilter,
      // luma reports shader compile/link failures here, not to deck's onError (ruling R10).
      deviceProps: { onError: (e: Error) => onDeviceError(l, e) },
      // deck seeds its view state from the camera at addControl, then creates its luma device
      // asynchronously and follows map `move` only from its onLoad. onready (below) runs in
      // between, so a camera change there (setBottomInset, a consumer's jumpTo, a drag) left
      // deck's picking viewport behind until the next move. onDeviceInitialized runs in the same
      // synchronous turn as deck's onLoad, so one `move` after that turn resyncs deck. (Not
      // onLoad: the overlay wraps it, and a later setProps would replace the wrapper.)
      onDeviceInitialized: () =>
        queueMicrotask(() => {
          if (!l.dead && l.map === map) map.fire('move');
        })
    });
    map.addControl(overlay);
    l.overlay = overlay;
    l.SolidPolygonLayer = SolidPolygonLayer;
    const remount = readyFired;
    if (timelineMode) {
      // Timeline mode outlives a remount: no GeneratedController; the timeline one replaces it.
      void enterTimeline(l, remount);
    } else {
      const controller = new GeneratedController(
        {
          ...controllerDeps(l, map, overlay),
          SolidPolygonLayer,
          now: () => performance.now(),
          reducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches
        },
        l.appliedTheme,
        // Generated and overlay layers draw beneath the basemap labels (§4.4, ruling 2026-10-11).
        firstSymbolLayerId(map.getStyle())
      );
      l.controller = controller;
      const queued = pendingApplies;
      pendingApplies = [];
      if (overlayLayers.length > 0) controller.setOverlayLayers(overlayLayers);
      for (const u of queued) controller.apply(u);
      // Remount (new manifest): the old generated state went with the old map.
      if (remount && queued.length === 0) resyncCb?.();
    }
    if (remount) return;
    readyFired = true;
    onready?.(handle);
  }

  /** The deps both controllers share. Feature-state calls never throw (the pump counts first). */
  function controllerDeps(
    l: Live,
    map: MapLibreMap,
    overlay: MapLibreOverlay
  ): Omit<ControllerDeps, 'SolidPolygonLayer' | 'now' | 'reducedMotion'> {
    return {
      setLayers: (layers) => {
        l.deckLayers = layers;
        overlay.setProps({ layers });
        // Deck adds a new layer group only while the style reports loaded; any loading tile or
        // GeoJSON setData (transit, chunk status) makes it report not loaded. Retry on load.
        l.deckGroupsPending = !map.isStyleLoaded();
      },
      setReplaced: (id) => {
        if (map.getSource(BUILDINGS_SOURCE)) map.setFeatureState({ ...FS, id }, { replaced: true });
      },
      clearReplaced: (id) => {
        if (map.getSource(BUILDINGS_SOURCE)) map.removeFeatureState({ ...FS, id }, 'replaced');
      },
      clearAllReplaced: () => {
        if (map.getSource(BUILDINGS_SOURCE)) map.removeFeatureState(FS);
      },
      raf: (cb) => requestAnimationFrame(cb),
      cancelRaf: (h) => cancelAnimationFrame(h),
      onResyncNeeded: () => resyncCb?.()
    };
  }

  /**
   * Timeline mode, once the overlay exists (§4.1 "Mode"): loads the timelapse module, replaces the
   * GeneratedController with a TimelineController and hands it the stored day, lookups, overlay
   * layers and queued updates. `remount`: a new map in timeline mode, which asks for a resync
   * when nothing is queued, as the generated path does.
   */
  async function enterTimeline(l: Live, remount: boolean): Promise<void> {
    const { map, overlay, SolidPolygonLayer } = l;
    if (l.dead || l.timeline || l.timelineLoading || !map || !overlay || !SolidPolygonLayer) return;
    l.timelineLoading = true;
    let mods: Awaited<ReturnType<typeof loadTimelapse>>;
    try {
      mods = await loadTimelapse();
    } catch (e) {
      l.timelineLoading = false;
      if (l.dead) return;
      // fail() removes the map: stop a GeneratedController still running from editor use.
      l.controller?.destroy();
      l.controller = null;
      fail(l, e); // drops the queued timelines
      return;
    }
    l.timelineLoading = false;
    if (l.dead || l.map !== map) return;
    const [{ TimelapseExtension, StageBarLayer }, { TimelineController, TIMELINE_PART_LAYER }] =
      mods;
    const { log } = mods[2];
    // Only one controller emits to the overlay.
    l.controller?.destroy();
    l.controller = null;
    const timeline = new TimelineController(
      {
        ...controllerDeps(l, map, overlay),
        SolidPolygonLayer,
        TimelapseExtension,
        StageBarLayer,
        repaint: () => map.triggerRepaint()
      },
      l.appliedTheme,
      firstSymbolLayerId(map.getStyle())
    );
    l.timeline = timeline;
    l.timelinePart = TIMELINE_PART_LAYER;
    watchCompileErrors(l);
    overlay.setProps({
      // Other layers keep deck's default (deck.ts defaultProps.onError).
      onError: (e: Error, layer?: Layer) => {
        if (layer && TIMELINE.test(layer.id)) timelapseFailed(l, e);
        else log.error(e.message, e.cause)();
      }
    });
    if (pendingDay !== null) timeline.setTime(pendingDay);
    if (pendingLookups) {
      try {
        timeline.setLookups(pendingLookups);
      } catch (e) {
        console.error('[map] timeline lookups rejected', e);
        pendingLookups = null;
      }
    }
    timeline.setOverlayLayers(overlayLayers); // also replaces any generated layers
    const queued = pendingTimeline;
    pendingTimeline = [];
    for (const u of queued) {
      try {
        timeline.apply(u);
      } catch (e) {
        console.error('[map] queued timeline update rejected', e);
      }
    }
    if (remount && queued.length === 0) resyncCb?.();
  }

  /** luma device errors: logged as before, except in timeline mode (§4.8 "Errors"). */
  function onDeviceError(l: Live, e: Error): boolean {
    if (!timelineMode || l.dead) return false;
    timelapseFailed(l, e);
    return true;
  }

  /**
   * luma 9.4.2 throws a shader compile error inside its un-awaited link-status check
   * (webgl-shared-render-pipeline.ts:89, :101), so it surfaces only as an unhandled rejection
   * (ruling R13). Installed in timeline mode only; removed in teardown.
   */
  function watchCompileErrors(l: Live): void {
    if (l.onRejection) return;
    l.onRejection = (e: PromiseRejectionEvent) => {
      const r: unknown = e.reason;
      if (!(r instanceof Error) || !/during compilation of/.test(r.message)) return;
      e.preventDefault();
      timelapseFailed(l, r);
    };
    addEventListener('unhandledrejection', l.onRejection);
  }

  /** The timelapse shader failed: log once, stop the timeline and keep the error state. */
  function timelapseFailed(l: Live, e: unknown): void {
    if (l.dead || l.timelineFailed) return;
    l.timelineFailed = true;
    console.error('[map] timelapse shader', e);
    // The destroyed controller stays in place, so later handle calls are no-ops.
    l.timeline?.destroy();
    l.deckLayers = [];
    l.overlay?.setProps({ layers: [] });
    mapState = 'error';
  }

  function teardown(l: Live): void {
    l.dead = true;
    unobserveFootprint();
    publishFootprint(0, 0); // a remount or error state has no controls until the next map exists
    for (const t of l.timers) clearTimeout(t);
    l.timers.clear();
    if (l.pickRaf !== null) cancelAnimationFrame(l.pickRaf);
    if (l.chunkRaf !== null) cancelAnimationFrame(l.chunkRaf);
    l.transitIdle?.();
    l.transitIdle = null;
    l.transit = null;
    l.controller?.destroy();
    l.timeline?.destroy();
    if (l.onRejection) removeEventListener('unhandledrejection', l.onRejection);
    l.onRejection = null;
    l.overlay?.finalize();
    l.map?.remove();
    l.controller = null;
    l.timeline = null;
    l.overlay = null;
    l.map = null;
    if (live === l) live = null;
    chunkStatuses.clear(); // statuses belong to this manifest's chunks; a remount starts clean
    hovered = null;
    reqSeq++;
    shown = null;
    unreportHover();
    loadingBar = false;
    loadingSlow = false;
    buildingsFailed = false;
  }

  function unsupported(l: Live): void {
    if (l.dead) return;
    l.map?.remove();
    l.map = null;
    mapState = 'unsupported';
    publishFootprint(0, 0);
    if (unsupportedFired) return;
    unsupportedFired = true;
    root?.dispatchEvent(new CustomEvent('mapunsupported', { bubbles: true }));
  }

  function fail(l: Live, e: unknown): void {
    console.error('[map] failed to start', e);
    if (l.chunkRaf !== null) cancelAnimationFrame(l.chunkRaf);
    l.chunkRaf = null;
    l.map?.remove();
    l.map = null;
    pendingApplies = [];
    pendingTimeline = [];
    unobserveFootprint();
    publishFootprint(0, 0);
    mapState = 'error';
  }

  function later(l: Live, ms: number, fn: () => void): ReturnType<typeof setTimeout> {
    const t = setTimeout(() => {
      l.timers.delete(t);
      if (!l.dead) fn();
    }, ms);
    l.timers.add(t);
    return t;
  }

  // ---- map state --------------------------------------------------------------------------------

  function applyPan(): void {
    const m = live?.map;
    if (!m) return;
    if (panEnabled) {
      m.dragPan.enable();
      m.dragRotate.enable();
      m.touchZoomRotate.enableRotation();
    } else {
      m.dragPan.disable();
      m.dragRotate.disable();
      m.touchZoomRotate.disableRotation();
    }
  }

  function applyTheme(t: Theme): void {
    const l = live;
    const map = l?.map;
    if (!l || !map || !l.loaded) return;
    if (l.appliedTheme !== t) {
      l.paintDiff ??= themePaintDiff(manifest);
      for (const [id, prop, v] of l.paintDiff[t]) {
        if (map.getLayer(id)) map.setPaintProperty(id, prop as PaintProp, v as PaintValue);
      }
      l.appliedTheme = t;
    }
    l.controller?.setTheme(t);
    l.timeline?.setTheme(t);
  }

  /** Coalesced: at most one chunk-status setData per animation frame. */
  function pushChunkData(): void {
    const l = live;
    if (!l?.loaded || !l.map || l.chunkRaf !== null) return;
    l.chunkRaf = requestAnimationFrame(() => {
      l.chunkRaf = null;
      if (l.dead || !l.map) return;
      const src = l.map.getSource(CHUNK_SOURCE) as GeoJSONSource | undefined;
      src?.setData(chunkStatusCollection(manifest.chunks, chunkStatuses));
    });
  }

  /** Transit spec §6.3: layer visibility from the view prefs; re-run after every (re)load. */
  function applyView(): void {
    const l = live;
    const map = l?.loaded ? l.map : null;
    if (!map) return;
    const v = view ?? DEFAULT_VIEW;
    const set = (id: string, on: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    };
    set(TRANSIT_ACCESS_LAYER, v.transitAccess);
    for (const id of TRANSIT_STOP_LAYERS) set(id, v.transitStops);
    if (!v.transitStops && shown?.hit.kind === 'stop') clearShown();
  }

  function onIdle(fn: () => void): () => void {
    if (typeof requestIdleCallback === 'function') {
      const h = requestIdleCallback(fn, { timeout: 2000 });
      return () => cancelIdleCallback(h);
    }
    const h = setTimeout(fn, 0);
    return () => clearTimeout(h);
  }

  /** Transit spec §5.3/§6.1: stops right away, the access grid in an idle callback. */
  async function startTransit(l: Live, map: MapLibreMap): Promise<void> {
    const url = manifest.transit;
    if (!url) return;
    let t: TransitView;
    try {
      t = transitView(await (fetchTransit ?? loadTransitNetwork)(url));
    } catch (e) {
      console.warn('[map] transit data unavailable', e);
      return;
    }
    // A teardown or start-up failure (fail() drops the map) while the network loaded.
    if (l.dead || l.map !== map) return;
    // Transit is warning-only: a failure here leaves that layer empty and the map ready.
    try {
      (map.getSource(TRANSIT_STOPS_SOURCE) as GeoJSONSource | undefined)?.setData(
        stopsCollection(t)
      );
      l.transit = t;
    } catch (e) {
      console.warn('[map] transit data unavailable', e);
      return;
    }
    l.transitIdle = onIdle(() => {
      l.transitIdle = null;
      if (l.dead || l.map !== map) return;
      try {
        const grid = buildAccessGrid(t.net, DEFAULT_TRANSIT_PARAMS, SF_GRID_BBOX, t.service);
        (map.getSource(TRANSIT_ACCESS_SOURCE) as GeoJSONSource | undefined)?.setData(
          accessCollection(grid)
        );
      } catch (e) {
        console.warn('[map] transit data unavailable', e);
      }
    });
  }

  /** Re-sends the deck layers once the style is loaded, so deck adds the groups it skipped. */
  function flushDeckGroups(l: Live): void {
    if (!l.deckGroupsPending || l.dead || !l.overlay || !l.map?.isStyleLoaded()) return;
    l.deckGroupsPending = false;
    l.overlay.setProps({ layers: l.deckLayers });
  }

  function onDataLoading(l: Live): void {
    if (l.loadTimer !== null || loadingBar) return;
    l.loadTimer = later(l, 300, () => {
      l.loadTimer = null;
      if (!l.map || l.map.areTilesLoaded()) return;
      loadingBar = true;
      later(l, 1700, () => {
        if (loadingBar) loadingSlow = true;
      });
    });
  }

  function clearLoading(l: Live): void {
    for (const t of l.timers) clearTimeout(t);
    l.timers.clear();
    l.loadTimer = null;
    loadingBar = false;
    loadingSlow = false;
  }

  function onMapError(l: Live, e: MapErrorEvent): void {
    if (l.dead) return;
    const err = e.error as Error | undefined;
    const msg = err?.message ?? '';
    if (!l.loaded && /webgl/i.test(msg)) return unsupported(l);
    const sourceId = (e as { sourceId?: string }).sourceId;
    if (sourceId) {
      if (!l.warned.has(sourceId)) {
        l.warned.add(sourceId);
        console.warn(`[map] source "${sourceId}" failed: ${msg}`);
      }
      if (sourceId === BUILDINGS_SOURCE && !l.buildingsTileLoaded) buildingsFailed = true;
      return;
    }
    console.error('[map]', err ?? e);
  }

  function retryBuildings(): void {
    const l = live;
    const map = l?.map;
    if (!l || !map) return;
    buildingsFailed = false;
    l.warned.delete(BUILDINGS_SOURCE);
    l.buildingsTileLoaded = false;
    // pmtiles caches a failed header fetch per archive URL: drop it so the retry refetches.
    protocol?.tiles.delete(manifest.buildingsTiles);
    if (map.getLayer(BUILDINGS_LAYER)) map.removeLayer(BUILDINGS_LAYER);
    if (map.getSource(BUILDINGS_SOURCE)) map.removeSource(BUILDINGS_SOURCE);
    map.addSource(BUILDINGS_SOURCE, buildingsSource(manifest));
    map.addLayer(existingBuildingsLayer(l.appliedTheme), CHUNK_LAYERS[0]);
    for (const id of l.controller?.hidden ?? []) {
      map.setFeatureState({ ...FS, id }, { replaced: true });
    }
    l.timeline?.reapplyDemolished();
  }

  function resetView(): void {
    const m = live?.map;
    if (m && container) m.jumpTo(defaultFrame(container.clientWidth));
  }

  // ---- picking (spec §4.7) ----------------------------------------------------------------------

  function pickAt(l: Live, x: number, y: number): PickResult {
    const map = l.map;
    if (!map || !l.loaded) return null;
    // Stops draw on top of everything, so they win. queryRenderedFeatures skips hidden layers.
    if (l.transit && map.getZoom() >= STOP_TOOLTIP_MIN_ZOOM) {
      const layers = TRANSIT_STOP_LAYERS.filter((id) => map.getLayer(id));
      const f = layers.length
        ? map.queryRenderedFeatures(
            [
              [x - STOP_HIT_PX, y - STOP_HIT_PX],
              [x + STOP_HIT_PX, y + STOP_HIT_PX]
            ],
            { layers }
          )[0]
        : undefined;
      const i = f?.properties?.i;
      if (typeof i === 'number')
        return { hit: { kind: 'stop', lines: stopTooltipLines(l.transit, i) }, cell: null };
    }
    const info = l.overlay?.pickObject({ x, y, radius: 2 });
    if (info?.layer && GENERATED.test(info.layer.id) && l.controller) {
      const part = l.controller.lookup(info.layer.id, info.index);
      if (part) return { hit: { kind: 'generated', ...part }, cell: null };
    }
    if (info?.layer && l.timeline && l.timelinePart?.test(info.layer.id)) {
      const part = l.timeline.lookup(info.layer.id, info.index);
      if (part) return { timeline: part };
    }
    if (!map.getLayer(BUILDINGS_LAYER)) return null;
    const features = map.queryRenderedFeatures([x, y], { layers: [BUILDINGS_LAYER] });
    if (features.length === 0) return null;
    const ll = map.unproject([x, y]);
    const cell = cellAt(manifest.chunks, [ll.lng, ll.lat]);
    const status = cell === null ? 'unknown' : (chunkStatuses.get(cell) ?? 'unknown');
    // In timeline mode the pump's applied set hides existing buildings (§4.5 "Picking").
    const hidden = l.timeline?.demolished ?? l.controller?.hidden ?? new Set<ParcelId>();
    const hit = resolveExistingHit(features, hidden, () => status);
    return hit ? { hit, cell } : null;
  }

  /**
   * Routes a pick (§4.8): with `timelinePick` set, timeline parts go to it and suppress SimMap's
   * own surface. A miss reports `{ projectId: null, kind }` (§4.8.1): every tap or click miss
   * sends a tap miss and leaves `hoverReported` alone; a hover miss is sent once, only after a
   * hover hit. Without it, a part shows the generated tooltip or card. Everything else presents as
   * in the editor.
   */
  function deliver(kind: PickKind, x: number, y: number, r: PickResult): void {
    const surface: Surface = kind === 'hover' ? 'tooltip' : 'card';
    const report = timelinePick;
    if (r && 'timeline' in r) {
      const { projectId, parcelId, typology, stories, units, existingUnits } = r.timeline;
      if (report) {
        if (shown?.surface === surface) clearShown();
        if (kind === 'hover') hoverReported = true;
        report({ projectId, parcelId, x, y, kind: kind === 'hover' ? 'hover' : 'tap' });
        return;
      }
      const hit = { kind: 'generated', parcelId, typology, stories, units, existingUnits } as const;
      return present(surface, x, y, { hit, cell: null });
    }
    if (report) {
      if (kind !== 'hover') report({ projectId: null, kind: 'tap' });
      else if (hoverReported) {
        hoverReported = false;
        report({ projectId: null, kind: 'hover' });
      }
    }
    if (kind !== 'click') present(surface, x, y, r);
  }

  /** A pointer left the parts with nothing new under it (leave, suppression, movestart, teardown):
   *  one hover miss. */
  function unreportHover(): void {
    if (!hoverReported) return;
    hoverReported = false;
    timelinePick?.({ projectId: null, kind: 'hover' });
  }

  function present(
    surface: Surface,
    x: number,
    y: number,
    r: { hit: TooltipHit; cell: string | null } | null
  ): void {
    if (!r) {
      hovered = null;
      reqSeq++;
      if (shown?.surface === surface) shown = null;
      return;
    }
    let hit = r.hit;
    if (hit.kind === 'existing' && hit.parcelId !== null) {
      if (hovered?.parcelId !== hit.parcelId) {
        hovered = { parcelId: hit.parcelId, cell: r.cell, summary: null };
        requestSummary(hit.parcelId);
      }
      hit = { ...hit, summary: hovered.summary };
    } else {
      hovered = null;
      reqSeq++;
    }
    shown = { surface, x, y, hit };
  }

  function requestSummary(parcelId: ParcelId): void {
    const seq = ++reqSeq;
    const req = requestParcelSummary;
    if (!req) return;
    req(parcelId).then(
      (summary) => {
        if (seq !== reqSeq || hovered?.parcelId !== parcelId) return;
        hovered.summary = summary;
        if (shown?.hit.kind === 'existing' && shown.hit.parcelId === parcelId) {
          shown = { ...shown, hit: { ...shown.hit, summary } };
        }
      },
      () => {}
    );
  }

  function clearShown(): void {
    hovered = null;
    reqSeq++;
    shown = null;
  }

  function canvasPoint(map: MapLibreMap, e: PointerEvent): { x: number; y: number } {
    const r = map.getCanvas().getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPointerMove(e: PointerEvent): void {
    const l = live;
    const map = l?.map;
    if (!l || !map || e.pointerType === 'touch') return;
    // `e.buttons` is live per event, so it covers a brush stroke (pan disabled + pointer down)
    // without trusting a down-counter that a release outside the map would leave stale.
    const suppressed = e.target !== map.getCanvas() || e.buttons !== 0 || l.moving;
    if (suppressed) {
      l.pointer = null;
      if (shown?.surface === 'tooltip') clearShown();
      unreportHover();
      return;
    }
    l.pointer = canvasPoint(map, e);
    if (l.pickRaf !== null) return;
    l.pickRaf = requestAnimationFrame(() => {
      l.pickRaf = null;
      const p = l.pointer;
      if (l.dead || !p) return;
      deliver('hover', p.x, p.y, pickAt(l, p.x, p.y));
    });
  }

  function onPointerLeave(): void {
    if (live) live.pointer = null;
    if (shown?.surface === 'tooltip') clearShown();
    unreportHover();
  }

  /** A tap: under TAP_PX of movement and TAP_MS of time since its pointerdown (§4.7). */
  function isTap(from: { x: number; y: number; t: number }, p: { x: number; y: number }): boolean {
    return Math.hypot(p.x - from.x, p.y - from.y) < TAP_PX && performance.now() - from.t < TAP_MS;
  }

  function onPointerDown(e: PointerEvent): void {
    const l = live;
    const map = l?.map;
    if (!l || !map) return;
    if (e.pointerType !== 'touch') {
      // Mouse/pen clicks pick only for timelinePick (§4.8); the editor ignores them.
      if (!timelinePick || e.button !== 0 || e.target !== map.getCanvas()) l.click = null;
      else l.click = { id: e.pointerId, ...canvasPoint(map, e), t: performance.now() };
      return;
    }
    l.touches++;
    const p = canvasPoint(map, e);
    l.tap =
      l.touches === 1 && e.target === map.getCanvas()
        ? { id: e.pointerId, x: p.x, y: p.y, t: performance.now() }
        : null;
  }

  function onPointerUp(e: PointerEvent): void {
    const l = live;
    const map = l?.map;
    if (!l || !map) return;
    if (e.pointerType !== 'touch') {
      const click = l.click;
      l.click = null;
      if (!click || click.id !== e.pointerId || !timelinePick || !panEnabled) return;
      const p = canvasPoint(map, e);
      if (isTap(click, p)) deliver('click', p.x, p.y, pickAt(l, p.x, p.y));
      return;
    }
    l.touches = Math.max(0, l.touches - 1);
    const tap = l.tap;
    if (!tap || tap.id !== e.pointerId) return;
    l.tap = null;
    if (!panEnabled) return;
    const p = canvasPoint(map, e);
    if (!isTap(tap, p)) return;
    deliver('tap', p.x, p.y, pickAt(l, p.x, p.y));
  }

  function onPointerCancel(e: PointerEvent): void {
    const l = live;
    if (l && e.pointerType !== 'touch') l.click = null;
    if (!l || e.pointerType !== 'touch') return;
    l.touches = Math.max(0, l.touches - 1);
    l.tap = null;
  }
</script>

<svelte:head>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- constant CSS built from TOKENS -->
  {@html DEFAULT_TOKENS_CSS}
</svelte:head>

<!-- The brief and spec §4.1 require the explicit role. -->
<!-- svelte-ignore a11y_no_redundant_roles -->
<section
  bind:this={root}
  bind:clientWidth={vw}
  bind:clientHeight={vh}
  role="region"
  aria-label="3D map of San Francisco"
  data-testid="map-root"
  data-state={mapState}
  class="sim-map relative h-full w-full overflow-hidden"
  style={rootStyle}
>
  <!-- Passive pointer observers for picking; MapLibre's canvas owns the interaction. -->
  <!-- Sized with h-full/w-full, not absolute+inset-0: MapLibre adds .maplibregl-map
       (position: relative, unlayered CSS), which beats Tailwind's layered .absolute and would
       collapse the container to 0 px high (the canvas then falls back to 300 px). -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={container}
    class="h-full w-full"
    onpointermove={onPointerMove}
    onpointerleave={onPointerLeave}
    onpointerdown={onPointerDown}
    onpointerup={onPointerUp}
    onpointercancel={onPointerCancel}
  ></div>

  {#if mapState === 'loading'}
    <p
      aria-live="polite"
      class="pointer-events-none absolute inset-0 flex items-center justify-center text-sm"
      style="color: var(--map-label)"
    >
      Loading map…
    </p>
  {/if}
  <noscript>
    <p class="absolute inset-x-0 top-1/2 mt-6 text-center text-sm" style="color: var(--map-label)">
      The map needs JavaScript and WebGL 2.
    </p>
  </noscript>

  {#if loadingBar}
    <div aria-hidden="true" class="sim-map-bar pointer-events-none absolute inset-x-0 top-0 z-10">
      <div class="sim-map-bar-fill"></div>
    </div>
  {/if}
  <p class="sr-only" aria-live="polite">{loadingSlow ? 'Loading buildings…' : ''}</p>

  {#if chunkError && mapState === 'ready'}
    <div
      role="status"
      class="sim-map-panel absolute top-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full pl-4 text-sm"
    >
      <span>Some parcels didn't load —</span>
      <button
        type="button"
        class="min-h-11 min-w-11 rounded-full px-3 font-semibold underline"
        onclick={() => onRetryChunks?.()}>Retry</button
      >
    </div>
  {/if}

  {#if buildingsFailed && mapState === 'ready'}
    <div
      role="status"
      class="sim-map-panel absolute top-16 left-1/2 z-10 flex w-max max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-1 rounded-lg pl-4 text-sm"
    >
      <span>Existing buildings couldn't load. Generated buildings still work.</span>
      <button
        type="button"
        class="min-h-11 min-w-11 shrink-0 rounded-lg px-3 font-semibold underline"
        aria-label="Retry existing buildings"
        onclick={retryBuildings}>Retry</button
      >
    </div>
  {/if}

  {#if coarse && mapState === 'ready'}
    <button
      type="button"
      aria-label="Reset view"
      class="sim-map-reset absolute z-10 flex h-11 w-11 items-center justify-center rounded-md"
      onclick={resetView}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none">
        <circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="2" />
        <circle cx="12" cy="12" r="2" fill="currentColor" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="2" />
      </svg>
    </button>
  {/if}

  {#if shown && lines && tipPos && shown.surface === 'tooltip'}
    <div
      role="tooltip"
      bind:offsetWidth={tw}
      bind:offsetHeight={th}
      class="sim-map-panel pointer-events-none absolute z-20 max-w-xs rounded-md px-3 py-2 text-xs"
      style="left: {tipPos.left}px; top: {tipPos.top}px"
    >
      <p class="font-semibold">{lines[0]}</p>
      <p>{lines[1]}</p>
    </div>
  {/if}

  {#if shown && lines && shown.surface === 'card'}
    <div
      aria-live="polite"
      class="sim-map-panel sim-map-card absolute z-20 flex items-center gap-2 rounded-lg py-2 pl-4 text-sm"
    >
      <div class="min-w-0 flex-1">
        <p class="font-semibold">{lines[0]}</p>
        <p>{lines[1]}</p>
      </div>
      <button
        type="button"
        class="min-h-11 min-w-11 shrink-0 rounded-lg px-3 font-semibold"
        onclick={clearShown}>Close</button
      >
    </div>
  {/if}

  {#if mapState === 'unsupported'}
    <div role="alert" class="absolute inset-0 z-30 flex items-center justify-center p-4">
      <div class="sim-map-panel max-w-md rounded-lg p-6">
        <h2 class="mb-2 text-lg font-semibold">This map needs WebGL 2</h2>
        <p class="text-sm">
          Your browser or device has WebGL turned off or unavailable. You can still read the
          scoreboard and share links. Try a current version of Firefox, Chrome, Safari or Edge with
          hardware acceleration enabled.
        </p>
      </div>
    </div>
  {/if}

  {#if mapState === 'context-lost' || mapState === 'error'}
    <div role="alert" class="absolute inset-0 z-30 flex items-center justify-center p-4">
      <div class="sim-map-panel flex max-w-md flex-col items-center gap-3 rounded-lg p-6">
        <p class="text-sm">
          {mapState === 'context-lost'
            ? "The map's graphics stopped. Reload the page to continue."
            : "The map couldn't load. Reload the page to try again."}
        </p>
        <button
          type="button"
          class="min-h-11 min-w-11 rounded-lg px-4 font-semibold underline"
          onclick={() => location.reload()}>Reload</button
        >
      </div>
    </div>
  {/if}
</section>

<style>
  .sim-map {
    background: var(--map-land);
  }
  .sim-map-panel {
    background: var(--map-land);
    color: var(--map-label);
    border: 1px solid var(--map-existing);
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.2);
  }
  .sim-map-card {
    left: 16px;
    right: 16px;
    bottom: calc(var(--map-bottom-inset, 0px) + 16px);
    padding-right: 4px;
  }
  .sim-map-reset {
    left: 10px;
    bottom: calc(var(--map-bottom-inset, 0px) + 10px);
    background: #fff;
    color: #333;
    box-shadow: 0 0 0 2px rgb(0 0 0 / 0.1);
  }
  .sim-map-bar {
    height: 2px;
    overflow: hidden;
  }
  .sim-map-bar-fill {
    height: 100%;
    width: 30%;
    background: var(--map-chunk-loading);
    animation: sim-map-bar 1.2s ease-in-out infinite;
  }
  @keyframes sim-map-bar {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(340%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sim-map-bar-fill {
      animation: none;
      width: 100%;
      opacity: 0.6;
    }
  }

  /* MapLibre controls: every target ≥ 44×44 (spec §4.11), lifted by the bottom inset. */
  .sim-map :global(.maplibregl-ctrl-group button) {
    width: 44px;
    height: 44px;
  }
  .sim-map :global(.maplibregl-ctrl-attrib-button) {
    width: 44px;
    height: 44px;
    border-radius: 22px;
    background-position: center;
    background-repeat: no-repeat;
  }
  .sim-map :global(.maplibregl-ctrl-attrib.maplibregl-compact) {
    min-height: 44px;
    padding: 0 44px 0 0;
    border-radius: 22px;
  }
  .sim-map :global(.maplibregl-ctrl-attrib.maplibregl-compact-show) {
    min-height: 20px;
    padding: 12px 48px 12px 12px;
  }
  .sim-map :global(.maplibregl-ctrl-bottom-left),
  .sim-map :global(.maplibregl-ctrl-bottom-right) {
    bottom: var(--map-bottom-inset, 0px);
  }
</style>
