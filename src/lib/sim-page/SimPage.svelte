<!--
  The /sim page (plan 3): FzpMode running the lever engine on the policy in memory. The recipe
  lives in a PolicyStore (undo, redo); LeverSync resolves its brushes in the worker, compiles it
  and sends each new SimLevers to FzpMode's `levers`, which FzpMode passes on with setLevers. Every
  start opens on the Family Zoning Plan compared with the pre-FZP baseline (`DEFAULT_LEVERS`).
  Custom paint and erase strokes (Task 8) reuse `/`'s BrushController through the stroke
  adapter; the overlay layers and the brush ring share SimMap's overlay through the overlay mux.
  Zoning rules (Task 9) read the brush catalog, asked for once when the dock's editing face first
  shows and again after a session restart if it came back null; their form opens inline in the
  Transit tab at every width. "Protections" (Task 10) edits the category protections.
  Plan 5 (Task 5): the policy autosaves (`sfhousing:sim:v1`) and is restored on mount, reconciled
  with the calibration (Calls 11 and 12). The header gets the save state (its status slot) and Publish. In `mode: 'view'` (the
  read-only /s/<id>, Task 6) the shared policy opens reconciled with the calibration (Call 7, with
  the timing notice when anything moved); there is no stroke controller, no tools, no autosave and
  no Publish, and the dock's one tab is the summary.
  The dock (sim-ux plan 2, Task 4): the policy lives in a `Dock` with the tabs Transit · Paint ·
  Permits · Protect (`SIM_TABS`), the Undo and Redo row above them, and a Results face (FzpMode's
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
  Paint feedback (Task 6): in Setup a Paint stroke, and a saved zoning rule once its revision is
  current, briefly shows the buildings its lots in view could hold (the overlay's feedback slot).
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
  import type { BrushLotsResult, LotOutlinesResult } from '$lib/sim/scenario/types';
  import { PREVIEW_MAX_LOTS } from '$lib/sim/scenario/preview';
  import type { ParcelId } from '$lib/data/parcel';
  import { packedCellLayer, type SolidPolygonLayerCtor } from '$lib/map/generated-controller';
  import { PaintFeedback, RuleFeedbackTrigger, lotsInView, mergeLots } from './feedback';
  import type { LeverStatus } from './lever-status';
  import { BrushForms } from './brush-forms.svelte';
  import type { Calibration } from '$lib/timelapse/types';
  import CustomZoningSection from './CustomZoningSection.svelte';
  import HistoryRow from './HistoryRow.svelte';
  import { SimBrushTools, brushToolOf, type SimTool } from './brush-tools.svelte';
  import { createOverlayMux } from './overlay-mux';
  import PhoneToolBar from './PhoneToolBar.svelte';
  import {
    DEFAULT_POLICY,
    canonicalJson,
    compileLevers,
    customQuery,
    paintedLots,
    queriesOf,
    queryKey,
    ruleQueries,
    type Lots,
    type SimPolicy,
    type Stroke
  } from './policy';
  import { OutlineRequest } from './outline-request';
  import { LidRequest, clampBbox } from './lid-request';
  import { paintedOutlineLayers } from './painted-outline';
  import { SIM_CODEC, simDocProblems, type SimDoc } from './sim-doc';
  import SimNotices from './SimNotices.svelte';
  import { restoreSimDoc, type SimNotice } from './sim-session';
  import { createStrokeAdapter } from './stroke-adapter';
  import { focusHeaderMenu } from '$lib/shell/header-actions.svelte';
  import { LeverSync, PolicyStore } from './policy-store.svelte';
  import { RunPhase } from './run-phase.svelte';
  import PermittingSection from './PermittingSection.svelte';
  import RulesSection from './RulesSection.svelte';
  import PolicySummary from './PolicySummary.svelte';
  import { customLotStatus, ruleLotStatus, type LotStatus } from './brush-summary';
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
   * score, Done on the phone tool bar), never for the default open or a Run (WCAG 2.4.3).
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
  const adapter = createStrokeAdapter({
    store,
    stories: () => tools.stories(),
    announce: (m) => brush.announce(m, ANNOUNCE_MS),
    onpaint: (stroke, stories) => paintFeedback(stroke, stories)
  });
  let controller: BrushController | null = null;
  let controllerMap: ControllerMap | null = null;
  let mapHandle: SimMapHandle | null = null;
  let deckLayers = $state.raw<OverlayCtors | null>(null);
  /** `@deck.gl/layers`' SolidPolygonLayer, from the same lazy module (the paint feedback). */
  let solidLayer = $state.raw<SolidPolygonLayerCtor | null>(null);
  let overlay = $state.raw<ReturnType<typeof createOverlayMux> | null>(null);
  let dead = false;
  let phoneBar = $state<PhoneToolBar>();

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

  function onMapReady(h: SimMapHandle, map: ControllerMap): void {
    if (controller && map !== controllerMap) {
      controller.destroy();
      controller = null;
    }
    mapHandle = h;
    watchView(map);
    attachController();
  }

  function setTool(t: SimTool): void {
    tools.tool = t;
    const bt = brushToolOf(t);
    if (controller) controller.setTool(bt);
    else brush.tool = bt;
    // On a phone, a stroke tool closes the sheet and shows the floating tool bar.
    if (t !== 'move' && !wide.current && dock.sheet !== 'closed') {
      dock.sheet = 'closed';
      void tick().then(() => phoneBar?.focus());
    }
  }

  /** The phone tool bar's Done (it chose Move): the sheet opens full on the Paint tab. */
  function toolBarDone(): void {
    dockFocus = true;
    dock.showEdit('paint');
    dock.sheet = 'full';
  }

  // ---- Setup and Run (spec §1) ----

  const run = new RunPhase();

  function startRun(): void {
    // Feedback is a Setup thing: a run clears it and drops any answer still on its way.
    feedbackSeq++;
    strokeWait = null;
    feedbackTrigger.reset();
    feedback?.show(null);
    setTool('move');
    pickedRule = null;
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
  /** The rule whose "Show on map" was pressed; `selectedRule` is it while it is still in the policy. */
  let pickedRule = $state.raw<string | null>(null);
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

  // A rule that leaves the policy (Remove, Undo, a restore) is no longer selected, in the same
  // render (no frame dims everything for a rule that is gone); the effect forgets it, so a Redo
  // does not bring the selection back.
  const selectedRule = $derived(
    pickedRule !== null && store.policy.rules.some((r) => r.id === pickedRule) ? pickedRule : null
  );
  $effect(() => {
    if (pickedRule !== null && selectedRule === null) pickedRule = null;
  });
  /** "Show on map" pressed or released. Showing a rule turns the limits view on, which it needs. */
  function selectRule(id: string | null): void {
    pickedRule = id;
    if (id !== null && !viewPrefs.heightLimits) setView({ ...viewPrefs, heightLimits: true });
  }
  /** Plain; with the brush or eraser chosen, paint-set limits stand out; a selected rule wins. */
  const limitsMode = $derived<LimitsView>(
    selectedRule !== null
      ? { kind: 'rule', ruleId: selectedRule }
      : mode === 'edit' && (tools.tool === 'paint' || tools.tool === 'erase')
        ? { kind: 'paint' }
        : { kind: 'plain' }
  );
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

  $effect(() => {
    const erasing = mode === 'edit' && tools.tool === 'erase';
    if (!erasing) {
      untrack(() => outlineRequest.want(null));
      return;
    }
    // Read here, so the effect reruns when a stroke's lots arrive.
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

  // ---- paint feedback (plan 2, Task 6) ----

  const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)');
  /** Per overlay mux: the fading layer in its `feedback` slot. */
  let feedback: PaintFeedback | null = null;
  const feedbackTrigger = new RuleFeedbackTrigger();
  /** Latest wins: a stroke or rule feedback bumps it, so an older answer is dropped. */
  let feedbackSeq = 0;

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

  /** `lots` (with label points) in the map's view, nearest its centre first, up to the cap. */
  function inView(lots: readonly ParcelId[], points: Float64Array): ParcelId[] {
    const map = mapHandle?.getMap();
    if (!map) return lots.slice(0, PREVIEW_MAX_LOTS);
    const b = map.getBounds();
    const c = map.getCenter();
    return lotsInView(
      lots,
      points,
      [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      [c.lng, c.lat],
      PREVIEW_MAX_LOTS
    );
  }

  /** Asks for the buildings `lots` could hold and shows them, unless superseded or running. */
  function showPreview(seq: number, a: SimClientApi, lots: ParcelId[], stories?: number): void {
    if (lots.length === 0) return;
    void a.previewBuildings(lots, stories).then((p) => {
      if (dead || seq !== feedbackSeq || run.phase !== 'setup' || !p.ok) return;
      feedback?.show(p.pack);
    });
  }

  /**
   * A stroke whose lots LeverSync is already finding (it started a new brush, so its query is the
   * brush's own): the feedback waits for that answer instead of asking again.
   */
  let strokeWait = $state.raw<{ seq: number; key: string; stories: number } | null>(null);

  $effect(() => {
    const w = strokeWait;
    if (!w) return;
    const r = sync.result(w.key);
    if (!r) return;
    untrack(() => {
      strokeWait = null;
      const a = api;
      if (dead || !a || w.seq !== feedbackSeq || !r.ok) return;
      showPreview(w.seq, a, inView(r.lots, r.points), w.stories);
    });
  });

  /** A Paint stroke landed: its own lots (the stroke alone, as it may join a brush). */
  function paintFeedback(stroke: Stroke, stories: number): void {
    const a = api;
    if (!a || run.phase !== 'setup') return;
    const seq = ++feedbackSeq;
    const q = customQuery({ id: 'feedback', kind: 'paint', strokes: [stroke], stories });
    const key = queryKey(q);
    if (queriesOf(store.policy).some((x) => x.key === key)) {
      strokeWait = { seq, key, stories };
      return;
    }
    strokeWait = null;
    void a.resolveBrush(q).then((r) => {
      if (dead || seq !== feedbackSeq || !r.ok) return;
      showPreview(seq, a, inView(r.lots, r.points), stories);
    });
  }

  /** A saved rule's revision is current: its lots in view, at the levers in force. */
  function ruleFeedback(ruleId: string): void {
    const a = api;
    const rule = store.policy.rules.find((r) => r.id === ruleId);
    if (!a || !rule || run.phase !== 'setup') return;
    const seq = ++feedbackSeq;
    const { lots, points } = mergeLots(ruleQueries(rule).map((q) => sync.result(queryKey(q))));
    showPreview(seq, a, inView(lots, points));
  }

  function onLevers(s: LeverStatus): void {
    const id = feedbackTrigger.status(s);
    if (id !== null) ruleFeedback(id);
  }

  // ---- rule brushes (Task 9) ----

  /** The open rule form, kept while the user moves between tabs (it shows in Transit). */
  const forms = new BrushForms();
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

  /**
   * A rule form saved: arm the rule feedback, but only for a save that changed the policy, as
   * only that sends a new revision to wait for.
   */
  function ruleSaved(r: { id: string }, changed: boolean): void {
    if (changed) feedbackTrigger.saved(r.id);
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
    return () => {
      dead = true;
      viewMap?.off('moveend', readView);
      viewMap = null;
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
  <HistoryRow {store} onundo={undo} onredo={redo} />
{/snippet}

{#snippet tabPanel(id: string)}
  {#if id === 'policy'}
    <PolicySummary policy={store.policy} {calibration} {lotsOf} />
  {:else if id === 'transit'}
    <RulesSection
      {store}
      {sync}
      {catalog}
      {forms}
      announce={(m) => brush.announce(m, ANNOUNCE_MS)}
      onsaved={ruleSaved}
      {selectedRule}
      onselectrule={selectRule}
    />
  {:else if id === 'paint'}
    <CustomZoningSection
      {store}
      {sync}
      {tools}
      ontool={setTool}
      announce={(m) => brush.announce(m, ANNOUNCE_MS)}
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
    <PhoneToolBar
      bind:this={phoneBar}
      {tools}
      ontool={setTool}
      ondone={toolBarDone}
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
  onlevers={onLevers}
  onchunks={() => {
    outlineRequest.chunksChanged();
    lidRequest.chunksChanged();
  }}
  onmanifest={(m) => (mapManifest = m)}
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
