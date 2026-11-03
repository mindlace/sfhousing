<!--
  The /sim page (plan 3): FzpMode running the lever engine on the policy in memory. The recipe
  lives in a PolicyStore (undo, redo); LeverSync resolves its brushes in the worker, compiles it
  and sends each new SimLevers to FzpMode's `levers`, which FzpMode passes on with setLevers. Every
  start opens on the Family Zoning Plan compared with the pre-FZP baseline (`DEFAULT_LEVERS`).
  Custom paint and erase strokes (Task 8) reuse `/`'s BrushController through the stroke
  adapter; the overlay layers and the brush ring share SimMap's overlay through the overlay mux.
  Zoning rules (Task 9) read the brush catalog, asked for once when the dock's editing face first
  shows and again after a session restart if it came back null. The Transit tab (sim-ux plan 4,
  Task 2) lists them as layers, each edited in place when selected, then the locked FZP baseline
  row. "Protections" (Task 10) edits the category protections.
  Plan 5 (Task 5): the policy autosaves (`sfhousing:sim:v1`) and is restored on mount, reconciled
  with the calibration (Calls 11 and 12). The header gets the save state (its status slot) and Publish. In `mode: 'view'` (the
  read-only /s/<id>, Task 6) the shared policy opens reconciled with the calibration (Call 7, with
  the timing notice when anything moved); there is no stroke controller, no tools, no autosave and
  no Publish, and the dock's one tab is the summary.
  The dock (sim-ux plan 2, Task 4): the policy lives in a `Dock` with the tabs Transit · Paint ·
  Permits · Protect (`SIM_TABS`), Undo and Redo (`HistoryButtons`) above them, and a Results face (FzpMode's
  `SimResults`). From md it is open on the left of the map by default and folds to a rail; below
  md it is a bottom sheet behind a handle. The header's Policy button opens and folds it; the
  header score flips it to Results and back.
  Setup and Run (spec §1, sim-runs Task 7): the page opens in Setup (never persisted). Run (the
  scrubber's button) sets the tool to Move, locks the store, plays and flips the dock to Results
  (a phone sheet peeks); a run offers Results only, until "Edit policy" ("Policy" in the
  view) or a scrub back to Today unlocks the store and returns to the editing face.
  Map overlays (sim-runs plan 2, Task 4): in Setup the header's View menu (transit stops, transit
  capacity, height limits); a run hides them all and keeps the toggles. The height limits
  (height-lids plan, Task 12) draw in the overlay's `limits` slot: the contours from FzpMode's
  `onheights`, and from z14.5 the glass lids of the view, asked of the worker on each `moveend`
  (LidRequest: latest wins, the bbox clamped around the centre).
  Selection (sim-ux plan 3, Task 3; plan 4, Task 2): one `picked` selection, a transit layer or
  the FZP baseline (a Transit tab row) or a painted area (a Paint tab row); the selected area's
  lots are outlined on the map. In Set Policy with Move, a click on a lot selects the layer that
  sets its limit (the worker's `lotAt`, latest click wins) and shows its row (plan 4, Task 4); a
  click outside every lot clears it. Project cards open on a tap only in a run (`cards`).
  Live preview (sim-ux plan 3, Task 4): in Setup, while a Paint stroke is drawn, the buildings
  its lots nearest the brush ring could hold show under it (StrokePreview, the overlay's feedback
  slot); they fade on release, clear at once on a cancel, and a run clears them.
-->
<script lang="ts">
  import { onMount, tick, untrack, type Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { replaceState } from '$app/navigation';
  import { Autosave } from '$lib/sharing/autosave.svelte';
  import PublishButton from '$lib/sharing/PublishButton.svelte';
  import SaveIndicator from '$lib/sharing/SaveIndicator.svelte';
  import { getStorage } from '$lib/sharing/storage';
  import { BrushController, type ControllerMap } from '$lib/brush/BrushController.svelte';
  import { ANNOUNCE_MS } from '$lib/brush/messages';
  import type { OverlayCtors } from '$lib/brush/overlay';
  import { BrushState } from '$lib/brush/state.svelte';
  import type { Manifest } from '$lib/data/manifest';
  import Dock from '$lib/dock/Dock.svelte';
  import { DockState } from '$lib/dock/dock-state.svelte';
  import FzpMode, { type SimClientApi } from '$lib/fzp/FzpMode.svelte';
  import type { HeightCity, HeightLids } from '$lib/map/height/types';
  import { LID_MAX_SPAN_M } from '$lib/map/height/lids';
  import { LIDS_FADE, type LimitsView } from '$lib/map/height/limits-style';
  import { useSystemTheme } from '$lib/map/system-theme.svelte';
  import type { SimMapHandle } from '$lib/map/types';
  import ViewMenu, { type ViewRow } from '$lib/view/ViewMenu.svelte';
  import { HIDDEN_VIEW, readViewPrefs, writeViewPrefs, type ViewPrefs } from '$lib/view/prefs';
  import { DEFAULT_LEVERS } from '$lib/sim/levers/types';
  import type { BrushCatalog } from '$lib/sim/levers/brushes';
  import type { BrushLotsResult, LotOutlinesResult, PreviewResult } from '$lib/sim/scenario/types';
  import { PREVIEW_MAX_LOTS } from '$lib/sim/scenario/preview';
  import type { ParcelId } from '$lib/data/parcel';
  import { packedCellLayer, type SolidPolygonLayerCtor } from '$lib/map/generated-controller';
  import { PaintFeedback, lotsInView } from './feedback';
  import { installSimDebug } from './debug';
  import { StrokePreview } from './stroke-preview';
  import type { Calibration } from '$lib/timelapse/types';
  import HistoryButtons from '$lib/paint/HistoryButtons.svelte';
  import PaintTab from '$lib/paint/PaintTab.svelte';
  import PaletteStrip from '$lib/paint/PaletteStrip.svelte';
  import { ERASE_HINT, SimBrushTools, brushToolOf, type SimTool } from './brush-tools.svelte';
  import { createOverlayMux } from './overlay-mux';
  import {
    DEFAULT_POLICY,
    canonicalJson,
    compileLevers,
    customQuery,
    paintedLots,
    queryKey,
    type Lots,
    type SimPolicy
  } from './policy';
  import { OutlineRequest } from './outline-request';
  import { LidRequest, clampBbox } from './lid-request';
  import { paintedOutlineLayers } from './painted-outline';
  import { SIM_CODEC, simDocProblems, type SimDoc } from './sim-doc';
  import SimNotices from './SimNotices.svelte';
  import { restoreSimDoc, type SimNotice } from './sim-session';
  import {
    limitsViewOf,
    liveSelection,
    selectionForLot,
    tabOf,
    type DockSelection
  } from './selection';
  import { createStrokeAdapter, removeCustomBrush } from './stroke-adapter';
  import { focusHeaderMenu } from '$lib/shell/header-actions.svelte';
  import { LeverSync, PolicyStore } from './policy-store.svelte';
  import { RunPhase } from './run-phase.svelte';
  import PermittingSection from './PermittingSection.svelte';
  import TransitTab from './TransitTab.svelte';
  import PolicySummary from './PolicySummary.svelte';
  import {
    customChangeLabel,
    customLotStatus,
    ruleLotStatus,
    simPaintRows,
    type LotStatus
  } from './brush-summary';
  import ProtectionsSection from './ProtectionsSection.svelte';
  import { VIEW_TABS, simTabs, tabOrFirst } from './tabs';

  interface Props {
    manifest: Manifest | null;
    manifestError: boolean;
    calibration: Calibration | null;
    calibrationError: boolean;
    noScenario: boolean;
    datasetVersion: string;
    /** `?seed=N`, or null for the representative future. */
    urlSeed: number | null;
    reload(): Promise<{ manifest: Manifest; calibration: Calibration }>;
    onurlseed?: (seed: number | null) => void;
    /** 'view': a published policy, read-only (no autosave, no Publish). Default 'edit'. */
    mode?: 'edit' | 'view';
    /** The policy to open with instead of the default (view: the shared document's). */
    initialPolicy?: SimPolicy;
    /** View: the shared document's title (shown in the banner, not edited). */
    title?: string;
    /**
     * Edit: 'restore' (the autosaved policy, then every change saved). View: 'off'. Defaults to
     * 'off' in view, else 'restore'.
     */
    persist?: 'restore' | 'off';
    /** The Remix hand-off from /s/<id> (`history.state.sfhSimRemix`). */
    remix?: { from: string; doc?: string };
    /** Tests: the autosave's and the view prefs' storage (default `localStorage`). */
    storage?: () => Storage | null;
    /** Tests: Publish's fetch. */
    fetchFn?: typeof fetch;
    /** Tests: the lever debounce's timers (default the global ones). */
    leverTimers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
  }

  let {
    manifest,
    manifestError,
    calibration,
    calibrationError,
    noScenario,
    datasetVersion,
    urlSeed,
    reload,
    onurlseed,
    mode = 'edit',
    initialPolicy = undefined,
    title: viewTitle = undefined,
    persist = undefined,
    remix = undefined,
    storage = getStorage,
    fetchFn = undefined,
    leverTimers = undefined
  }: Props = $props();

  /**
   * A given policy (the shared document's) opens reconciled with the calibration it runs on
   * (Call 7), with the timing notice when anything moved.
   */
  const opened = untrack(() =>
    initialPolicy
      ? restoreSimDoc(
          {
            plan: { schema: 2, kind: 'sim', datasetVersion, policy: initialPolicy },
            notice: null
          },
          calibration
        )
      : null
  );
  /** The document the session opens with; a remount (new load) starts over. */
  const firstPolicy = untrack(() => opened?.doc.policy ?? DEFAULT_POLICY);
  /** Call 12: the policy without its lot lists, until LeverSync resolves the brushes. */
  const initial = untrack(() =>
    opened ? (compileLevers(firstPolicy, () => []) ?? DEFAULT_LEVERS) : DEFAULT_LEVERS
  );
  const store = new PolicyStore(firstPolicy);

  /** The scenario client's brush requests; null before mount, after a crash and after unmount. */
  let api: SimClientApi | null = null;
  /** What FzpMode runs: `initial`, then each document LeverSync sends. */
  let levers = $state.raw(initial);

  // ---- autosave, restore and publish (plan 5, Task 5) ----

  /** Fixed for the component's life, as the props it derives from. */
  const persistMode = untrack(() => persist ?? (mode === 'view' ? 'off' : 'restore'));
  const autosave = untrack(
    () =>
      new Autosave<SimDoc>({
        currentVersion: datasetVersion,
        codec: SIM_CODEC,
        storage,
        // Ruling R4: an over-limit document would load back as corrupt, so it is never written.
        writable: (d) => simDocProblems(d).length === 0
      })
  );
  /** The document's title: the restored one, then each published one. */
  let title = $state<string | undefined>(untrack(() => viewTitle));
  const doc = $derived<SimDoc>(
    title === undefined
      ? { schema: 2, kind: 'sim', datasetVersion, policy: store.policy }
      : { schema: 2, kind: 'sim', datasetVersion, title, policy: store.policy }
  );
  let notices = $state<SimNotice[]>(untrack(() => opened?.notices ?? []));
  /** Autosave writes once this is set: after the restore. */
  let saving = $state(false);

  function restore(): void {
    const r = autosave.restore(remix?.doc);
    const { doc: d, notices: ns } = restoreSimDoc(r, calibration, remix?.from);
    notices = ns;
    title = d.title;
    if (canonicalJson(d.policy) !== canonicalJson(store.policy)) {
      // Call 12: a load, not a change; the policy without its lot lists runs until LeverSync
      // resolves the brushes and sends the full levers. The policy effect below skips the policy
      // it first sees (this one: onMount runs before it), so the restore asks LeverSync itself,
      // as the view does. A second update of the same policy only restarts the debounce.
      store.reset(d.policy);
      levers = compileLevers(d.policy, () => []) ?? levers;
      sync.update(d.policy);
    }
    if (remix) {
      try {
        replaceState('', {}); // no re-toast on reload, as on /
      } catch (e) {
        console.error('[sim] could not clear the remix hand-off', e);
      }
    }
  }

  onMount(() => {
    // A given policy's brushes are resolved, then its full levers sent (Call 12).
    if (opened) sync.update(store.policy);
    if (persistMode === 'off') return;
    restore();
    saving = true;
    return autosave.attach();
  });

  // Every change is saved: the policy (undo and redo included) and the title. Only the document
  // is tracked: schedule() reads and writes autosave.status, which must not re-run this.
  $effect(() => {
    const d = doc;
    if (persistMode === 'off') return;
    untrack(() => {
      if (!saving) return;
      autosave.schedule(d);
    });
  });

  // `onpublished` may fire after the dialog closed and the user kept editing: take the title
  // only, and record lastPublished against the current document (a mismatched hash makes the
  // button read "Publish" again).
  function onPublished(r: { id: string; hash: string; plan: SimDoc }): void {
    title = r.plan.title;
    saving = true;
    autosave.setLastPublished({ id: r.id, hash: r.hash }, SIM_CODEC.withTitle(doc, r.plan.title));
  }

  function dismissNotice(id: string): void {
    notices = notices.filter((n) => n.id !== id);
  }

  const noSession = (): BrushLotsResult => ({
    ok: false,
    reason: 'no-session',
    message: 'the simulation is not running'
  });
  const sync = new LeverSync({
    resolve: (q) => (api ? api.resolveBrush(q) : Promise.resolve(noSession())),
    send: (l) => (levers = l),
    ...untrack(() => leverTimers ?? { setTimeout, clearTimeout })
  });

  const wide = new MediaQuery('(min-width: 768px)');
  const uid = $props.id();
  const dockId = `${uid}-dock`;
  /**
   * The dock: open (docked) from md by default, the phone sheet closed to its handle. With no
   * scenario FzpMode renders no dock. The view's only tab is the summary (`policy`).
   */
  const dock = new DockState({ tab: untrack(() => mode) === 'view' ? 'policy' : 'transit' });
  /** The dock's tabs: Permits is offered only with a calibration (no empty face). */
  const dockTabs = $derived(mode === 'view' ? VIEW_TABS : simTabs(calibration !== null));
  // A tab that is no longer offered (Permits without a calibration) falls back to the first.
  $effect.pre(() => {
    const t = tabOrFirst(dockTabs, dock.tab);
    if (t !== dock.tab) dock.tab = t;
  });
  /**
   * Opening moves focus into the dock only when the user asked (the Policy button, the header
   * score, Done on the palette strip), never for the default open or a Run (WCAG 2.4.3).
   */
  let dockFocus = $state(false);
  let policyButton = $state<HTMLButtonElement>();
  /** The phone sheet's height above the scrubber (0 from md): FzpMode's extra map inset. */
  let sheetH = $state(0);

  /** The header's Policy button: desktop open <-> rail; phone sheet closed <-> full. */
  function togglePolicy(): void {
    dockFocus = true;
    dock.toggleOpen(wide.current);
  }

  /** The header score: Results in a run (it stays); in Setup, Results <-> the editing face. */
  function pressScore(): void {
    dockFocus = true;
    if (run.phase === 'run') dock.showResults();
    else dock.toggleResults(wide.current);
  }

  /**
   * The dock folded by its collapse button or Escape: focus goes to the Policy button, or, when it
   * sits in the closed phone Menu, to the Menu button.
   */
  function dockClosed(): void {
    if (policyButton?.checkVisibility()) policyButton.focus();
    else focusHeaderMenu();
  }

  /**
   * The Results face's flip ("Edit policy", "Policy" in the view): ends a run, else shows the
   * editing face (the view's one Policy tab). The flip button goes with the face, so focus moves to the selected tab.
   */
  async function flip(): Promise<void> {
    if (run.phase === 'run') resetRun();
    else dock.showEdit();
    await tick();
    document
      .getElementById(dockId)
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.focus();
  }

  // Every policy change after the first goes to LeverSync. The initial policy is `initial`, which
  // FzpMode sends with initScenario; an undo back to it is a change like any other.
  let first = true;
  $effect(() => {
    const p = store.policy;
    if (first) {
      first = false;
      return;
    }
    untrack(() => sync.update(p));
  });

  // ---- strokes on the map (Task 8) ----

  /** /sim keeps no brush settings: `/`'s saved stories and radius stay untouched. */
  const brush = new BrushState({ storage: null, fine: false });
  const tools = new SimBrushTools(brush);
  const noSessionPreview = (): PreviewResult => ({
    ok: false,
    reason: 'no-session',
    message: 'the simulation is not running'
  });
  /** The live preview while painting (sim-ux plan 3, Task 4); its layer is `feedback`. */
  const strokePreview = new StrokePreview({
    resolve: (q) => (api ? api.resolveBrush(q) : Promise.resolve(noSession())),
    buildings: (lots, stories) =>
      api ? api.previewBuildings(lots, stories) : Promise.resolve(noSessionPreview()),
    nearest: (lots, points, at) => nearest(lots, points, at),
    live: (pack) => {
      if (!dead && run.phase === 'setup') feedback?.live(pack);
    },
    release: () => feedback?.release(),
    clear: () => feedback?.clear(),
    answered: (rev) => controller?.previewDone(rev)
  });
  const adapter = createStrokeAdapter({
    store,
    stories: () => tools.stories(),
    announce: (m) => brush.announce(m, ANNOUNCE_MS),
    preview: strokePreview
  });
  let controller: BrushController | null = null;
  let controllerMap: ControllerMap | null = null;
  let mapHandle: SimMapHandle | null = null;
  let deckLayers = $state.raw<OverlayCtors | null>(null);
  /** `@deck.gl/layers`' SolidPolygonLayer, from the same lazy module (the live preview). */
  let solidLayer = $state.raw<SolidPolygonLayerCtor | null>(null);
  let overlay = $state.raw<ReturnType<typeof createOverlayMux> | null>(null);
  let dead = false;
  let paletteStrip = $state<PaletteStrip>();

  /** The map handle whose overlay mux exists (either mode); a new handle gets a new mux. */
  let overlayHandle: SimMapHandle | null = null;

  function attachController(): void {
    if (dead || !mapHandle || !deckLayers) return;
    const h = mapHandle;
    if (overlayHandle !== h) {
      overlayHandle = h;
      overlay = createOverlayMux((l) => h.setOverlayLayers(l));
    }
    if (mode === 'view' || controller) return;
    const map = h.getMap();
    if (!map || !overlay) return;
    controllerMap = map;
    controller = new BrushController({
      handle: {
        setPanEnabled: (b) => h.setPanEnabled(b),
        setOverlayLayers: overlay.slot('ring')
      },
      map,
      client: adapter.client,
      editor: adapter.editor,
      state: brush,
      layers: deckLayers,
      raf: (cb) => requestAnimationFrame(cb),
      cancelRaf: (id) => cancelAnimationFrame(id)
    });
    controller.attach();
  }

  function onMapReady(h: SimMapHandle, map: ControllerMap & ClickMap): void {
    if (controller && map !== controllerMap) {
      controller.destroy();
      controller = null;
      // A preview barrier: the live buildings clear and an answer still on its way is dropped.
      strokePreview.cancel();
    }
    mapHandle = h;
    watchView(map);
    watchClicks(map);
    attachController();
  }

  function setTool(t: SimTool): void {
    tools.tool = t;
    const bt = brushToolOf(t);
    if (controller) controller.setTool(bt);
    else brush.tool = bt;
    // On a phone, a stroke tool closes the sheet and shows the palette strip.
    if (t !== 'move' && !wide.current && dock.sheet !== 'closed') {
      dock.sheet = 'closed';
      void tick().then(() => paletteStrip?.focus());
    }
  }

  /** The palette strip's Done (it chose Move): the sheet opens full on the Paint tab. */
  function stripDone(): void {
    dockFocus = true;
    dock.showEdit('paint');
    dock.sheet = 'full';
  }

  // ---- Setup and Run (spec §1) ----

  const run = new RunPhase();

  function startRun(): void {
    // The live preview is a Setup thing: a run clears it and drops any answer still on its way.
    strokePreview.reset();
    setTool('move');
    picked = null;
    store.locked = true;
    run.run();
    // The dock flips to Results (a rail or a closed sheet opens on it); focus stays at Run.
    dockFocus = false;
    dock.showResults();
  }

  /** Ends a run ("Edit policy", a scrub back to Today): the editing face, on its last tab. */
  function resetRun(): void {
    store.locked = false;
    run.reset();
    dock.showEdit();
  }

  // The controller's own tool keys set brush.tool: keep the /sim tool in step. During a run the
  // tool stays Move (the store is locked, so a stroke would change nothing).
  $effect(() => {
    const bt = brush.tool;
    const running = run.phase === 'run';
    untrack(() => {
      if (running && bt !== 'move') setTool('move');
      else if (brushToolOf(tools.tool) !== bt) tools.tool = bt;
    });
  });

  function undo(): void {
    if (controller) controller.undo();
    else adapter.editor.undo();
  }
  function redo(): void {
    if (controller) controller.redo();
    else adapter.editor.redo();
  }

  // ---- map overlays (plan 2, Task 4) ----

  /** The viewer's layer toggles, shared with / (`sfhousing:view`); kept through a run. */
  let viewPrefs = $state.raw<ViewPrefs>(untrack(() => readViewPrefs(storage())));
  const systemTheme = useSystemTheme();
  /** The manifest the map renders (FzpMode's own, which a Retry can replace). */
  let mapManifest = $state.raw<Manifest | null>(null);
  const viewRows = $derived<readonly ViewRow[]>(
    mapManifest?.transit ? ['transitStops', 'transitAccess', 'heightLimits'] : ['heightLimits']
  );

  function setView(v: ViewPrefs): void {
    viewPrefs = v;
    writeViewPrefs(v, storage());
  }

  // ---- zoning height limits: contours and glass lids (height-lids plan, Task 12) ----

  /** The latest kept lever revision's height regions and contours (FzpMode's `onheights`). */
  let city = $state.raw<HeightCity | null>(null);
  /** The latest lids answer for the view; kept, so a theme or tool change asks nothing new. */
  let lids = $state.raw<HeightLids | null>(null);
  /** `limits-layer`, lazy-loaded on mount (it pulls in deck's layers). */
  let limitsModule = $state.raw<typeof import('$lib/map/height/limits-layer') | null>(null);
  /** What was picked in the dock (a Transit or Paint tab row); `selection` is it while it is still in the policy. */
  let picked = $state.raw<DockSelection>(null);
  /** The map's view at its latest `moveend` (or when it became ready). */
  let mapView = $state.raw<{
    zoom: number;
    bbox: [number, number, number, number];
    centre: [number, number];
  } | null>(null);
  let viewMap: ControllerMap | null = null;

  function readView(): void {
    const m = viewMap;
    if (!m) return;
    const b = m.getBounds();
    const c = m.getCenter();
    mapView = {
      zoom: m.getZoom(),
      bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      centre: [c.lng, c.lat]
    };
  }

  /** Follows `map`'s view on `moveend` (a new map replaces the old one's listener). */
  function watchView(map: ControllerMap): void {
    if (map === viewMap) return;
    viewMap?.off('moveend', readView);
    viewMap = map;
    map.on('moveend', readView);
    readView();
  }

  const lidRequest = new LidRequest({
    request: (bbox) =>
      api
        ? api.heightLids(bbox)
        : Promise.resolve({
            ok: false,
            reason: 'no-session',
            message: 'the simulation is not running'
          }),
    show: (l) => (lids = l)
  });

  // A rule or painted area that leaves the policy (Remove, Undo, a restore) is no longer selected,
  // in the same render (no frame dims everything or outlines lots for one that is gone); the
  // effect forgets it, so a Redo does not bring the selection back.
  const selection = $derived(liveSelection(picked, store.policy));
  $effect(() => {
    if (picked !== null && selection === null) picked = null;
  });
  const selectedPaint = $derived(selection?.kind === 'paint' ? selection.id : null);
  /**
   * A Transit tab row (a layer or the FZP baseline) pressed or released. Showing one turns the
   * limits view on, which it needs.
   */
  function selectLayer(sel: DockSelection): void {
    picked = sel;
    if (sel !== null && !viewPrefs.heightLimits) setView({ ...viewPrefs, heightLimits: true });
  }
  /** A painted area's row pressed or released. */
  function selectPaint(id: string | null): void {
    picked = id === null ? null : { kind: 'paint', id };
  }

  // ---- selecting on the map (sim-ux plan 4, Task 4) ----

  /** MapLibre's `click`, as the selection reads it. */
  interface MapClick {
    lngLat: { lng: number; lat: number };
  }
  /** What the selection needs of the map (`ControllerMap` has no `click`). */
  interface ClickMap {
    on(ev: 'click', fn: (e: MapClick) => void): void;
    off(ev: 'click', fn: (e: MapClick) => void): void;
  }
  let clickMap: ClickMap | null = null;
  /** The latest click's number: only its answer counts. */
  let clickSeq = 0;

  /** Listens for clicks on `map` (a new map replaces the old one's listener). */
  function watchClicks(map: ClickMap): void {
    if (map === clickMap) return;
    clickMap?.off('click', onMapClick);
    clickMap = map;
    map.on('click', onMapClick);
  }

  /** A click selects only in Set Policy with Move: Paint and Erase stroke, a run opens a card. */
  const selecting = () => mode === 'edit' && run.phase === 'setup' && tools.tool === 'move';

  function onMapClick(e: MapClick): void {
    if (!selecting() || !api) return;
    void selectAt([e.lngLat.lng, e.lngLat.lat], ++clickSeq, api);
  }

  /**
   * Asks the worker which lot is under `point` and which layer sets its limit (from the limits it
   * holds now, one source of truth with the height layer), then selects that layer's row: the
   * dock shows it (a closed phone sheet peeks, so the lot stays in view) and scrolls it into view.
   * Focus stays on the map. A `no-session` answer, or one overtaken by a later click or by a
   * change out of Set Policy's Move, changes nothing.
   */
  async function selectAt(point: [number, number], seq: number, a: SimClientApi): Promise<void> {
    const r = await a.lotAt(point);
    if (seq !== clickSeq || dead || !r.ok || !selecting()) return;
    const lots: Lots = (key) => {
      const x = sync.result(key);
      return x?.ok ? x.lots : undefined;
    };
    const sel = selectionForLot(r.owner, r.parcelId, store.policy, lots);
    if (sel === null) {
      picked = null;
      return;
    }
    if (sel.kind === 'paint') selectPaint(sel.id);
    else selectLayer(sel);
    dockFocus = false;
    dock.reveal(tabOf(sel));
    await tick();
    const row =
      sel.kind === 'paint'
        ? `[data-paint-row="${CSS.escape(sel.id)}"]`
        : `[data-layer-row="${sel.kind === 'fzp' ? 'fzp' : CSS.escape(sel.id)}"]`;
    document.getElementById(dockId)?.querySelector(row)?.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Plain; with the brush or eraser chosen, or a painted area selected, paint-set limits stand
   * out; a selected layer (or the FZP baseline) wins.
   */
  const limitsMode = $derived<LimitsView>(limitsViewOf(selection, tools.tool, mode));
  const limitsOn = $derived(run.phase === 'setup' && viewPrefs.heightLimits);

  // Lids from LIDS_FADE's start: the view's bbox, clamped around the view centre (R14).
  $effect(() => {
    const v = mapView;
    const bbox =
      limitsOn && v !== null && v.zoom >= LIDS_FADE[0]
        ? clampBbox(v.bbox, LID_MAX_SPAN_M, v.centre)
        : null;
    untrack(() => lidRequest.want(bbox));
  });

  $effect(() => {
    const o = overlay;
    const M = limitsModule;
    if (!o) return;
    const c = city;
    const layers =
      M && c && limitsOn
        ? [M.heightLimitsLayer({ city: c, lids, mode: limitsMode, theme: systemTheme.current })]
        : [];
    untrack(() => o.slot('limits')(layers));
  });

  // ---- outlines of custom-painted lots while erasing (plan 2, Task 5) ----

  type Outlines = Extract<LotOutlinesResult, { ok: true }>;
  /** The latest outline answer; kept, so a theme change redraws it without a new request. */
  let outlines = $state.raw<Outlines | null>(null);
  const outlineRequest = new OutlineRequest({
    request: (lots) =>
      api
        ? api.lotOutlines(lots)
        : Promise.resolve<LotOutlinesResult>({
            ok: false,
            reason: 'no-session',
            message: 'the simulation is not running'
          }),
    show: (o) => (outlines = o)
  });

  // The outlines wanted, in order: the selected painted area's lots (an erase area's too), else
  // the painted lots while Erase is chosen, else none.
  $effect(() => {
    const area =
      selectedPaint !== null ? store.policy.custom.find((b) => b.id === selectedPaint) : undefined;
    if (area) {
      // Read here, so the effect reruns when the area's lots arrive.
      const r = sync.result(queryKey(customQuery(area)));
      // Unanswered (a stroke just joined this area): keep what is drawn.
      if (!r) return;
      untrack(() => outlineRequest.want(r.ok ? new Set(r.lots) : null));
      return;
    }
    const erasing = mode === 'edit' && tools.tool === 'erase';
    if (!erasing) {
      untrack(() => outlineRequest.want(null));
      return;
    }
    const lots: Lots = (key) => {
      const r = sync.result(key);
      return r?.ok ? r.lots : undefined;
    };
    const painted = paintedLots(store.policy, lots);
    // A query is unresolved (an erase stroke just landed): keep what is drawn.
    if (painted === null) return;
    untrack(() => outlineRequest.want(new Set(painted.keys())));
  });

  $effect(() => {
    const o = overlay;
    if (!o) return;
    const out = outlines;
    const L = deckLayers;
    const layers = out && L ? paintedOutlineLayers(L, out, systemTheme.current) : [];
    untrack(() => o.slot('outline')(layers));
  });

  // ---- live preview (sim-ux plan 3, Task 4) ----

  const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)');
  /** Per overlay mux: the preview layer in its `feedback` slot. */
  let feedback: PaintFeedback | null = null;

  $effect(() => {
    const o = overlay;
    const L = solidLayer;
    if (!o || !L) return;
    const fb = new PaintFeedback({
      set: o.slot('feedback'),
      layer: (pack, opacity, id) =>
        packedCellLayer(L, id, pack, systemTheme.current, { opacity, pickable: false }),
      now: () => performance.now(),
      raf: (cb) => requestAnimationFrame(() => cb()),
      cancelRaf: (h) => cancelAnimationFrame(h),
      reducedMotion: () => reducedMotion.current
    });
    feedback = fb;
    return () => {
      fb.destroy();
      if (feedback === fb) feedback = null;
    };
  });

  /**
   * `lots` (with label points) in the map's view, nearest `at` (the brush ring) first, up to the
   * cap, so the buildings appear under the brush.
   */
  function nearest(
    lots: readonly ParcelId[],
    points: Float64Array,
    at: [number, number]
  ): ParcelId[] {
    const map = mapHandle?.getMap();
    if (!map) return lots.slice(0, PREVIEW_MAX_LOTS);
    const b = map.getBounds();
    return lotsInView(
      lots,
      points,
      [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      at,
      PREVIEW_MAX_LOTS
    );
  }

  // ---- transit layers (Task 9; sim-ux plan 4, Task 2) ----

  /** undefined: not asked yet or in flight; null: the session had none to give. */
  let catalog = $state.raw<BrushCatalog | null | undefined>(undefined);
  let catalogWanted = false;
  let catalogToken = 0;
  let catalogInFlight = false;

  function fetchCatalog(): void {
    if (!api || catalog || catalogInFlight) return;
    const token = ++catalogToken;
    catalogInFlight = true;
    void api.brushCatalog().then((c) => {
      if (token !== catalogToken || dead) return;
      catalogInFlight = false;
      catalog = c;
    });
  }

  // Asked for once, when the editing face first shows (the view's summary needs no catalog).
  $effect(() => {
    if (dock.face !== 'edit' || !dock.visible(wide.current) || mode === 'view') return;
    untrack(() => {
      if (catalogWanted) return;
      catalogWanted = true;
      fetchCatalog();
    });
  });

  /** A new session: ask again if the catalog came back null or is still owed. */
  function catalogSession(): void {
    if (!catalogWanted || catalog) return;
    catalogToken++; // an answer from the old session is dropped
    catalogInFlight = false;
    catalog = undefined;
    fetchCatalog();
  }

  /** The Paint tab's rows: one per custom brush, in policy order. */
  const paintRows = $derived(simPaintRows(store.policy, (k) => sync.result(k)));

  /**
   * A painted area's Remove: one store change Undo names, applied synchronously (PaintTab moves
   * focus after a single tick). Neighbours of equal kind and height merge, as on `/`.
   */
  function removePaintArea(id: string): void {
    const b = store.policy.custom.find((x) => x.id === id);
    if (!b) return;
    const label = `Removed: ${customChangeLabel(b)}`;
    store.apply((p) => removeCustomBrush(p, id), label);
    brush.announce(label, ANNOUNCE_MS);
  }

  /** The summary's per-card lot lookup: a rule (`rule:<id>`) or a custom brush (`custom:<id>`). */
  function lotsOf(key: `rule:${string}` | `custom:${string}`): LotStatus {
    const p = store.policy;
    const result = (k: string) => sync.result(k);
    const sep = key.indexOf(':');
    const list = key.slice(0, sep);
    const id = key.slice(sep + 1);
    if (list === 'rule') {
      const r = p.rules.find((x) => x.id === id);
      return r ? ruleLotStatus(r, result) : { kind: 'finding' };
    }
    const b = p.custom.find((x) => x.id === id);
    return b ? customLotStatus(b, result) : { kind: 'finding' };
  }

  onMount(() => {
    import('@deck.gl/layers').then(
      (mod) => {
        if (dead) return;
        deckLayers = mod;
        solidLayer = mod.SolidPolygonLayer;
        attachController();
      },
      (e) => console.error('[sim] overlay layers failed to load', e)
    );
    import('$lib/map/height/limits-layer').then(
      (mod) => {
        if (!dead) limitsModule = mod;
      },
      (e) => console.error('[sim] height limits layer failed to load', e)
    );
    const uninstall = installSimDebug(() => ({ preview: feedback?.state ?? 'none' }));
    return () => {
      dead = true;
      uninstall();
      strokePreview.reset();
      viewMap?.off('moveend', readView);
      viewMap = null;
      clickMap?.off('click', onMapClick);
      clickMap = null;
      controller?.destroy();
      controller = null;
      mapHandle = null;
      brush.destroy();
    };
  });
</script>

{#snippet actions()}
  {#if run.phase === 'setup'}
    <ViewMenu view={viewPrefs} theme={systemTheme.current} rows={viewRows} onchange={setView} />
  {/if}
  <button
    bind:this={policyButton}
    type="button"
    aria-expanded={dock.visible(wide.current)}
    aria-controls={dockId}
    class="min-h-6 min-w-6 rounded-md border border-gray-300 px-2 text-sm font-medium whitespace-nowrap md:max-lg:px-1 dark:border-gray-600 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
    onclick={togglePolicy}>Policy</button
  >
  {#if mode === 'edit'}
    <PublishButton
      codec={SIM_CODEC}
      {doc}
      lastPublished={autosave.lastPublished}
      onpublished={onPublished}
      {fetchFn}
    />
  {/if}
{/snippet}

{#snippet saveState()}
  {#if mode === 'edit' && persistMode !== 'off'}
    <SaveIndicator status={autosave.status} align="start" />
  {/if}
{/snippet}

{#snippet sessionNotices()}
  <SimNotices {notices} ondismiss={dismissNotice} />
{/snippet}

{#snippet history()}
  <div class="border-b border-line px-4 py-2 dark:border-line-dark">
    <HistoryButtons
      canUndo={store.canUndo}
      canRedo={store.canRedo}
      undoLabel={store.undoLabel}
      redoLabel={store.redoLabel}
      onundo={undo}
      onredo={redo}
    />
  </div>
{/snippet}

{#snippet tabPanel(id: string)}
  {#if id === 'policy'}
    <PolicySummary policy={store.policy} {calibration} {lotsOf} />
  {:else if id === 'transit'}
    <TransitTab
      {store}
      {sync}
      {catalog}
      {selection}
      onselect={selectLayer}
      announce={(m) => brush.announce(m, ANNOUNCE_MS)}
    />
  {:else if id === 'paint'}
    <PaintTab
      {brush}
      tool={tools.tool}
      ontool={setTool}
      rows={paintRows}
      selected={selectedPaint}
      onselect={selectPaint}
      onremove={removePaintArea}
      eraseHint={ERASE_HINT}
      onretry={(keys) => keys.forEach((k) => sync.retry(k))}
    />
  {:else if id === 'permits'}
    {#if calibration}
      <PermittingSection {store} {calibration} announce={(m) => brush.announce(m, ANNOUNCE_MS)} />
    {/if}
  {:else if id === 'protect'}
    <ProtectionsSection {store} announce={(m) => brush.announce(m, ANNOUNCE_MS)} />
  {/if}
{/snippet}

{#snippet panel(results: Snippet)}
  <Dock
    id={dockId}
    label={mode === 'view' ? 'Policy (read-only)' : 'Policy'}
    state={dock}
    tabs={dockTabs}
    panel={tabPanel}
    top={mode === 'edit' ? history : undefined}
    {results}
    flipLabel={mode === 'view' ? 'Policy' : 'Edit policy'}
    flipName={mode === 'view' ? 'Back to the policy' : undefined}
    onflip={() => void flip()}
    focusOnOpen={dockFocus}
    onsheetheight={(px) => (sheetH = px)}
    onclose={dockClosed}
    resultsOnly={run.phase === 'run'}
  />
  {#if mode === 'edit' && run.phase === 'setup' && !wide.current && dock.sheet === 'closed' && tools.tool !== 'move'}
    <PaletteStrip
      bind:this={paletteStrip}
      {brush}
      tool={tools.tool}
      ontool={setTool}
      ondone={stripDone}
      eraseHint={ERASE_HINT}
      lift={sheetH}
    />
  {/if}
  <p role="status" aria-live="polite" class="sr-only">{brush.announcement}</p>
{/snippet}

<FzpMode
  {manifest}
  {manifestError}
  {calibration}
  {calibrationError}
  {noScenario}
  {datasetVersion}
  {urlSeed}
  {reload}
  {onurlseed}
  {levers}
  runPhase={run.phase}
  onrun={startRun}
  onrewind={resetRun}
  leversPending={sync.pending}
  view={run.phase === 'setup' ? viewPrefs : HIDDEN_VIEW}
  onheights={(c) => {
    city = c;
    lidRequest.limitsChanged(c.rev);
  }}
  onchunks={() => {
    outlineRequest.chunksChanged();
    lidRequest.chunksChanged();
  }}
  onmanifest={(m) => (mapManifest = m)}
  cards={run.phase === 'run'}
  {actions}
  status={mode === 'edit' ? saveState : undefined}
  notices={sessionNotices}
  {panel}
  scoreExpanded={dock.face === 'results' && dock.visible(wide.current)}
  scoreControls={dockId}
  onscore={pressScore}
  bottomExtra={sheetH}
  onmapready={onMapReady}
  onphase={(p) => (brush.phase = p === 'ready' ? 'ready' : p === 'failed' ? 'failed' : 'loading')}
  onclient={(a) => {
    api = a;
    // A new session: brush queries answered `no-session` can be asked again.
    if (a) {
      sync.resume();
      catalogSession();
      lidRequest.sessionChanged();
    }
  }}
/>
