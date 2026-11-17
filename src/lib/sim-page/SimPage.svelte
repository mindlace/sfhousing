<!--
  The /sim page on the timeline (timeline-ui rules 1, 10-22, 40, 41): TimelineMode over the
  document in a `PolicyStore<SimPolicy4>` (undo, redo; edits reconciled with the calibration, and
  programmes or scales an edit leaves without a source dropped with today's funding notice),
  whose brush lots PolicySync resolves for the worker. The detail column (from md beside the
  timeline in the bottom pane under the map, below md a sheet) is the Inspector (the selected
  policy's editor, "+"'s menu) or Results: from md at rest or after a press on the header score,
  below md after that press. The header has the View menu (always offered, rule 18), Undo and
  Redo, and Publish; its status slot the save state.
  Opening (rule 40, R-3): with the calibration known, in the browser, the document opens before
  TimelineMode mounts, so its first `policy` is the opened one; with no calibration it opens on
  `oncalibration`, after a Retry's reload. Edit: the v1 autosave migrates to `sfhousing:sim:v2`,
  then the autosave (or a Remix hand-off) is restored through the schema 4 codec, with today's
  notices. View (`/s/<id>`): the document the route's load opened, else (no calibration then) the
  shared text, opened here after a Retry; one that won't open is an alert notice.
  The map (rule 19): with Paint or Erase a stroke goes into the selected painted policy's selected
  span (the span lens); with no painted policy selected a new one is added from the playhead's
  month, holding the stroke, as one change, and selected. A stroke tool is always on show: in the
  painted policy's editor, else (from md) as "Stop painting" in the header, below md the palette
  strip. With Move a tap on a project opens its
  card; a tap on a lot with none (TimelineMode's `onmiss`, then the map's `click`) asks the worker
  which policy sets the lot's limit and selects it. Height limits, lids, outlines and the paint
  preview are as before; the worker answers them for the last view month.
-->
<script lang="ts">
  import { onMount, tick, untrack, type Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { replaceState } from '$app/navigation';
  import { BrushController, type ControllerMap } from '$lib/brush/BrushController.svelte';
  import { ANNOUNCE_MS } from '$lib/brush/messages';
  import type { OverlayCtors } from '$lib/brush/overlay';
  import { BrushState } from '$lib/brush/state.svelte';
  import type { Manifest } from '$lib/data/manifest';
  import type { ParcelId } from '$lib/data/parcel';
  import { packedCellLayer, type SolidPolygonLayerCtor } from '$lib/map/generated-controller';
  import { LID_MAX_SPAN_M } from '$lib/map/height/lids';
  import { LIDS_FADE, type LimitsView } from '$lib/map/height/limits-style';
  import type { HeightCity, HeightLids } from '$lib/map/height/types';
  import { createOverlayMux } from '$lib/map/overlay-mux';
  import { useSystemTheme } from '$lib/map/system-theme.svelte';
  import type { SimMapHandle } from '$lib/map/types';
  import HistoryButtons from '$lib/paint/HistoryButtons.svelte';
  import { paintedOutlineLayers } from '$lib/paint/outline-layers';
  import PaintTab from '$lib/paint/PaintTab.svelte';
  import PaletteStrip from '$lib/paint/PaletteStrip.svelte';
  import { removedLabel } from '$lib/paint/rows';
  import { Autosave } from '$lib/sharing/autosave.svelte';
  import { copyFor } from '$lib/sharing/copy';
  import PublishButton from '$lib/sharing/PublishButton.svelte';
  import SaveIndicator from '$lib/sharing/SaveIndicator.svelte';
  import { getStorage } from '$lib/sharing/storage';
  import type { BrushCatalog } from '$lib/sim/levers/brushes';
  import { PREVIEW_MAX_LOTS } from '$lib/sim/scenario/preview';
  import type { BrushLotsResult, LotOutlinesResult, PreviewResult } from '$lib/sim/scenario/types';
  import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
  import type { Day } from '$lib/timelapse/time';
  import type { Calibration } from '$lib/timelapse/types';
  import { addPolicy } from '$lib/timeline/add';
  import Inspector from '$lib/timeline/Inspector.svelte';
  import { project, spanLens, writeBack, type StrokeStore } from '$lib/timeline/lens';
  import { fundingName4, ownerName4 } from '$lib/timeline/owner';
  import { viewMonthOf } from '$lib/timeline/playhead';
  import { DEFAULT_POLICY4, type PolicyKind, type SimPolicy4 } from '$lib/timeline/policy4';
  import { PolicySync } from '$lib/timeline/policy-sync.svelte';
  import { reconcilePolicy4 } from '$lib/timeline/reconcile4';
  import { isFixedRef } from '$lib/timeline/rows';
  import { openShared, restoreSim4, type SimNotice4 } from '$lib/timeline/session4';
  import {
    createSimCodec4,
    simDoc4Problems,
    type OpenDataset,
    type SimDoc4
  } from '$lib/timeline/sim-doc4';
  import { policyOf, type SpanRef } from '$lib/timeline/spans';
  import TimelineMode, {
    type MapLike,
    type TimelineClientApi
  } from '$lib/timeline/TimelineMode.svelte';
  import { readViewPrefs, writeViewPrefs, type ViewPrefs } from '$lib/view/prefs';
  import ViewMenu, { type ViewRow } from '$lib/view/ViewMenu.svelte';
  import { ERASE_HINT, SimBrushTools, brushToolOf, type SimTool } from './brush-tools.svelte';
  import { simPaintRows } from './brush-summary';
  import { installSimDebug } from './debug';
  import { PaintFeedback, lotsInView } from './feedback';
  import { fundingNotices } from './funding-copy';
  import { FundingDrafts } from './funding-drafts.svelte';
  import { LidRequest, clampBbox } from './lid-request';
  import { OutlineRequest } from './outline-request';
  import { customQuery, paintedLots, queryKey, type Lots } from './policy';
  import { PolicyStore } from './policy-store.svelte';
  import { limitsViewOf, selectionForLot } from './selection';
  import SimNotices from './SimNotices.svelte';
  import { createStrokeAdapter, removeCustomBrush } from './stroke-adapter';
  import { StrokePreview } from './stroke-preview';

  interface Props {
    manifest: Manifest | null;
    manifestError: boolean;
    calibration: Calibration | null;
    calibrationError: boolean;
    noScenario: boolean;
    datasetVersion: string;
    reload(): Promise<{ manifest: Manifest; calibration: Calibration }>;
    /** 'view': a published policy, read-only (no autosave, no Publish). Default 'edit'. */
    mode?: 'edit' | 'view';
    /** View: the shared document's title (shown in the banner, not edited). */
    title?: string;
    /**
     * Edit: 'restore' (the autosaved policy, then every change saved). View: 'off'. Defaults to
     * 'off' in view, else 'restore'.
     */
    persist?: 'restore' | 'off';
    /** View: the shared document's text (any schema `openSimDoc4` opens). */
    initialText?: string;
    /** View: the shared document as the route's load opened it (wins over `initialText`). */
    opened?: { doc: SimDoc4; notices: SimNotice4[] };
    /** The Remix hand-off from /s/<id> (`history.state.sfhSimRemix`). */
    remix?: { from: string; doc?: string; upgradedFrom?: number };
    /** View: the schema the shared document was upgraded from (`/s/<id>`). */
    upgradedFrom?: number;
    /** Tests: the autosave's and the view prefs' storage (default `localStorage`). */
    storage?: () => Storage | null;
    /** Tests: Publish's fetch. */
    fetchFn?: typeof fetch;
    /** Tests: PolicySync's debounce timers (default the global ones). */
    timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
  }

  let {
    manifest,
    manifestError,
    calibration,
    calibrationError,
    noScenario,
    datasetVersion,
    reload,
    mode = 'edit',
    title: viewTitle = undefined,
    persist = undefined,
    initialText = undefined,
    opened: openedByRoute = undefined,
    remix = undefined,
    upgradedFrom = undefined,
    storage = getStorage,
    fetchFn = undefined,
    timers = undefined
  }: Props = $props();

  const SIM = copyFor('sim');
  /** Fixed for the component's life, as the props it derives from. */
  const persistMode = untrack(() => persist ?? (mode === 'view' ? 'off' : 'restore'));
  const readonly = untrack(() => mode === 'view');

  /** The calibration the page runs on: the load's, then a Retry's. */
  let cal = $state.raw<Calibration | null>(untrack(() => calibration));
  const ds = $derived<OpenDataset | null>(cal ? { asOf: cal.asOf, calibration: cal } : null);
  const codec = $derived(ds ? createSimCodec4(ds) : null);

  // ---- notices ----

  let notices = $state<SimNotice4[]>([]);

  /** Adds `ns`, each replacing a notice of its id. */
  function showNotices(ns: SimNotice4[]): void {
    if (ns.length === 0) return;
    notices = [...notices.filter((n) => !ns.some((m) => m.id === n.id)), ...ns];
  }

  function dismissNotice(id: string): void {
    notices = notices.filter((n) => n.id !== id);
  }

  // ---- the document ----

  /**
   * Every change settles through `reconcilePolicy4` once the calibration is known (T4 ruling):
   * programmes or scales the edit leaves without a source are dropped, with today's notice.
   */
  function normalize(next: SimPolicy4): SimPolicy4 {
    const c = cal;
    if (!c) return next;
    const r = reconcilePolicy4(next, c, c.asOf);
    const { droppedProgrammes, droppedScales } = r.report.funding;
    if (droppedProgrammes.length > 0 || droppedScales.length > 0)
      showNotices(
        fundingNotices({ upgradedFrom: null, droppedProgrammes, droppedScales, unusable: false })
      );
    return r.doc;
  }

  const store = new PolicyStore<SimPolicy4>(DEFAULT_POLICY4, (next) => normalize(next));

  /** The scenario client's requests; null before the session opens, after a crash and unmount. */
  let api: TimelineClientApi | null = null;
  const noSession = (): BrushLotsResult => ({
    ok: false,
    reason: 'no-session',
    message: 'the simulation is not running'
  });
  const sync = new PolicySync({
    resolve: (q) => (api ? api.resolveBrush(q) : Promise.resolve(noSession())),
    ...untrack(() => timers ?? { setTimeout, clearTimeout })
  });

  /** The title: the restored or shared one, then each published one. */
  let title = $state<string | undefined>(untrack(() => viewTitle));
  const doc = $derived<SimDoc4>(
    title === undefined
      ? { schema: 4, kind: 'sim', datasetVersion, policy: store.policy }
      : { schema: 4, kind: 'sim', datasetVersion, title, policy: store.policy }
  );
  let autosave = $state.raw<Autosave<SimDoc4> | null>(null);
  /** Autosave writes once this is set: after the restore. */
  let saving = false;
  /** The document was opened (restored, or the shared text). */
  let opened = false;
  /** The policy PolicySync last took. */
  let synced: SimPolicy4 | null = null;
  let mounted = false;
  let detach: (() => void) | null = null;
  /** The Remix hand-off is cleared from history once the router is up (onMount). */
  let clearHandoff = false;

  function load(p: SimPolicy4): void {
    store.reset(p);
    synced = p;
    // A load, not a change: no debounce (`PolicySync.open`).
    sync.open(p);
  }

  function dropHandoff(): void {
    try {
      replaceState('', {}); // no re-toast on reload, as on /
    } catch (e) {
      console.error('[sim] could not clear the remix hand-off', e);
    }
  }

  /** Opens the document once the calibration is known (rule 40, R-3). */
  function openDoc(): void {
    const d = ds;
    if (opened || !d) return;
    opened = true;
    if (openedByRoute !== undefined) {
      title = viewTitle ?? openedByRoute.doc.title;
      notices = openedByRoute.notices;
      load(openedByRoute.doc.policy);
      return;
    }
    if (initialText !== undefined) {
      const r = openShared(initialText, d, upgradedFrom);
      if (r.ok) {
        title = viewTitle ?? r.doc.title;
        notices = r.notices;
        load(r.doc.policy);
      } else {
        notices = [{ id: 'unparsable', text: SIM.unparsable, tone: 'alert' }];
        load(store.policy);
      }
      return;
    }
    if (persistMode === 'off') {
      load(store.policy);
      return;
    }
    const a = new Autosave<SimDoc4>({
      currentVersion: datasetVersion,
      codec: createSimCodec4(d),
      storage,
      // Ruling R4: an over-limit document would load back as corrupt, so it is never written.
      writable: (x) => simDoc4Problems(x).length === 0
    });
    const r = restoreSim4(storage(), a, d, remix);
    autosave = a;
    notices = r.notices;
    title = r.doc.title;
    load(r.doc.policy);
    if (remix) {
      if (mounted) dropHandoff();
      else clearHandoff = true;
    }
    saving = true;
    if (mounted) detach = a.attach();
  }

  // In the browser with the calibration known, the document opens here, before TimelineMode
  // mounts, so the session's first `policy` is the opened one.
  if (typeof window !== 'undefined') untrack(openDoc);

  // Every change after the open goes to PolicySync (debounced, rule 16).
  $effect(() => {
    const p = store.policy;
    untrack(() => {
      if (!opened || p === synced) return;
      synced = p;
      sync.update(p);
    });
  });

  // Every change is saved: the document (undo and redo included) and the title. Only the document
  // is tracked: schedule() reads and writes autosave.status, which must not re-run this.
  $effect(() => {
    const d = doc;
    const a = autosave;
    if (!a) return;
    untrack(() => {
      if (saving) a.schedule(d);
    });
  });

  // `onpublished` may fire after the dialog closed and the user kept editing: take the title
  // only, and record lastPublished against the current document.
  function onPublished(r: { id: string; hash: string; plan: SimDoc4 }): void {
    title = r.plan.title;
    saving = true;
    if (codec)
      autosave?.setLastPublished({ id: r.id, hash: r.hash }, codec.withTitle(doc, r.plan.title));
  }

  function onCalibration(c: Calibration): void {
    cal = c;
    day = c.asOf;
    openDoc();
  }

  // ---- the selection and the inspector ----

  let selected = $state.raw<SpanRef | null>(null);
  /** The kind whose "+" menu is open. */
  let adding = $state<PolicyKind | null>(null);
  /** The inspector's face: the selection's editor, or Results (the header score). */
  let face = $state<'editor' | 'results'>('editor');
  let timeline = $state<ReturnType<typeof TimelineMode>>();
  let day = $state<Day>(untrack(() => calibration?.asOf ?? 0));
  /** The kind last selected or added to: where focus falls back (WCAG 2.4.3). */
  let focusKind: PolicyKind = 'zoning';
  /** Funding drafts: page memory outside the store, so autosave and undo never see one. */
  const drafts = new FundingDrafts();
  const wide = new MediaQuery('(min-width: 768px)');
  const uid = $props.id();
  const inspectorId = `${uid}-inspector`;

  const inspectorOpen = $derived(
    face === 'results' || selected !== null || adding !== null || drafts.isOpen
  );
  /** What the detail column shows: a change starts it at its top. */
  const detailKey = $derived(
    face === 'results'
      ? 'results'
      : `${adding ?? ''}:${selected ? `${selected.kind}:${selected.id}:${selected.span}` : ''}`
  );

  function select(ref: SpanRef | null): void {
    selected = ref;
    if (ref === null) return;
    face = 'editor';
    focusKind = ref.kind;
    // A transit policy or the plan shows its limits on the map: the view turns them on.
    const v = limitsViewOf(ref, store.policy, 'move', mode);
    if ((v.kind === 'rule' || v.kind === 'fzp') && !viewPrefs.heightLimits)
      setView({ ...viewPrefs, heightLimits: true });
  }

  function startAdd(kind: PolicyKind): void {
    face = 'editor';
    focusKind = kind;
    adding = kind;
  }

  /** The header score. From md it closes what is open as Close × does (the inspector's unmount
   *  discards and announces a draft) and shows Results; below md it toggles. */
  function pressScore(): void {
    if (wide.current) {
      adding = null;
      selected = null;
      face = 'results';
      void timeline?.showResults();
      return;
    }
    face = face === 'results' ? 'editor' : 'results';
  }

  // A policy the document no longer holds (an undo of its add) is no longer selected.
  $effect(() => {
    const s = selected;
    const p = store.policy;
    if (s === null || isFixedRef(s) || policyOf(p, s.kind, s.id)) return;
    untrack(() => (selected = null));
  });

  const PRESSED =
    '[data-testid="tl-bar"][aria-pressed="true"], [data-testid="tl-fixed"] button[aria-pressed="true"]';

  /**
   * The editor closed (Close, Escape, Remove, "+" or a draft closed): focus goes to the bar that
   * was selected, or, when it is gone (Remove) or there was none, to its kind's "+", else the
   * kind's toggle (WCAG 2.4.3).
   */
  function closeEditor(): void {
    const bar = document.querySelector<HTMLElement>(`[data-testid="tl-dock"] :is(${PRESSED})`);
    const kind = selected?.kind ?? focusKind;
    void tick().then(() => {
      if (dead) return;
      if (bar?.isConnected) {
        bar.focus();
        return;
      }
      const row = document.querySelector(`[data-testid="tl-kind-${kind}"]`);
      (
        row?.querySelector<HTMLElement>('button.plus') ??
        row?.querySelector<HTMLElement>('button.toggle')
      )?.focus();
    });
  }

  /** From md, a kind that is closed opens, so the selected policy's row shows. */
  function openKind(kind: PolicyKind): void {
    if (!wide.current) return;
    document
      .querySelector<HTMLElement>(
        `[data-testid="tl-kind-${kind}"] button.toggle[aria-expanded="false"]`
      )
      ?.click();
  }

  // ---- strokes on the map ----

  /** /sim keeps no brush settings: `/`'s saved stories and radius stay untouched. */
  const brush = new BrushState({ storage: null, fine: false });
  const tools = new SimBrushTools(brush);

  /** The selected painted policy's selected span: where strokes go. */
  const paintRef = $derived.by<SpanRef | null>(() => {
    const s = selected;
    if (s === null || s.kind !== 'zoning' || isFixedRef(s)) return null;
    return policyOf(store.policy, 'zoning', s.id)?.where.tag === 'painted' ? s : null;
  });
  const paintLens = spanLens(store, () => paintRef);

  /**
   * The stroke adapter's store: the span lens on the selected painted span; with none selected,
   * a new painted policy from the playhead's month holding the stroke (one change), then selected.
   */
  const strokeStore: StrokeStore = {
    get policy() {
      return paintLens.policy;
    },
    apply(change, label, coalesce) {
      if (paintRef !== null) {
        paintLens.apply(change, label, coalesce);
        return;
      }
      const c = cal;
      if (!c) return;
      const added: { ref: SpanRef | null } = { ref: null };
      store.apply(
        (d) => {
          const r = addPolicy(
            d,
            { kind: 'zoning', what: 'paint' },
            { w: { asOf: c.asOf, months: WINDOW_MONTHS }, month: viewMonthOf(c.asOf, day), cal: c }
          );
          added.ref = r.ref;
          return writeBack(r.doc, r.ref, change(project(r.doc, r.ref)));
        },
        label,
        coalesce
      );
      if (added.ref !== null) select(added.ref);
    },
    undo: () => store.undo(),
    redo: () => store.redo()
  };

  const noSessionPreview = (): PreviewResult => ({
    ok: false,
    reason: 'no-session',
    message: 'the simulation is not running'
  });
  /** The live preview while painting; its layer is `feedback`. */
  const strokePreview = new StrokePreview({
    resolve: (q) => (api ? api.resolveBrush(q) : Promise.resolve(noSession())),
    buildings: (lots, stories) =>
      api ? api.previewBuildings(lots, stories) : Promise.resolve(noSessionPreview()),
    nearest: (lots, points, at) => nearest(lots, points, at),
    live: (pack) => {
      if (!dead) feedback?.live(pack);
    },
    release: () => feedback?.release(),
    clear: () => feedback?.clear(),
    answered: (rev) => controller?.previewDone(rev)
  });
  const adapter = createStrokeAdapter({
    store: strokeStore,
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
    if (readonly || controller) return;
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

  function onMapReady(h: SimMapHandle, m: MapLike): void {
    const map = m as unknown as ControllerMap & ClickMap;
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
    // On a phone a stroke tool shows the palette strip.
    if (t !== 'move' && !wide.current) void tick().then(() => paletteStrip?.focus());
  }

  /**
   * From md, Paint or Erase with the painted policy's tools out of view (closed, another
   * selection, Results, or a "+" menu or pool draft in the inspector over the painted policy, as
   * Inspector picks its face): the header offers the way back to Move. Below md the palette strip
   * does.
   */
  const toolsShown = $derived(
    paintRef !== null && face === 'editor' && adding === null && drafts.draft?.kind !== 'pool'
  );
  const toolOff = $derived(!readonly && wide.current && tools.tool !== 'move' && !toolsShown);

  // The controller's own tool keys set brush.tool: keep the /sim tool in step.
  $effect(() => {
    const bt = brush.tool;
    untrack(() => {
      if (brushToolOf(tools.tool) !== bt) tools.tool = bt;
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

  // ---- painted areas of the selected span ----

  /** A painted area (custom brush) of the selected span, picked in its rows. */
  let paintArea = $state<string | null>(null);
  const selectedArea = $derived(
    paintArea !== null && paintLens.policy.custom.some((b) => b.id === paintArea) ? paintArea : null
  );
  // An area that leaves the span (Remove, Undo) is forgotten, so a Redo does not bring it back.
  $effect(() => {
    if (paintArea !== null && selectedArea === null) paintArea = null;
  });
  const paintRows = $derived(simPaintRows(paintLens.policy, (k) => sync.result(k)));

  /** A painted area's Remove: one change Undo names (neighbours of one kind and height merge). */
  function removePaintArea(id: string): void {
    const b = paintLens.policy.custom.find((x) => x.id === id);
    if (!b) return;
    const label = removedLabel({ kind: b.kind, stories: b.kind === 'paint' ? b.stories : null });
    paintLens.apply((p) => removeCustomBrush(p, id), label);
    brush.announce(label, ANNOUNCE_MS);
  }

  // ---- map overlays (rule 18: offered at all times) ----

  /** The viewer's layer toggles, shared with / (`sfhousing:view`). */
  let viewPrefs = $state.raw<ViewPrefs>(untrack(() => readViewPrefs(storage())));
  const systemTheme = useSystemTheme();
  /** The manifest the map renders (TimelineMode's own, which a Retry can replace). */
  let mapManifest = $state.raw<Manifest | null>(null);
  const viewRows = $derived<readonly ViewRow[]>(
    mapManifest?.transit ? ['transitStops', 'transitAccess', 'heightLimits'] : ['heightLimits']
  );

  function setView(v: ViewPrefs): void {
    viewPrefs = v;
    writeViewPrefs(v, storage());
  }

  /** The zoning in force at the last view month: height regions and contours. */
  let city = $state.raw<HeightCity | null>(null);
  /** The latest lids answer for the view; kept, so a theme or tool change asks nothing new. */
  let lids = $state.raw<HeightLids | null>(null);
  /** `limits-layer`, lazy-loaded on mount (it pulls in deck's layers). */
  let limitsModule = $state.raw<typeof import('$lib/map/height/limits-layer') | null>(null);
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

  /** A selected transit policy or the plan wins; a painted policy or a stroke tool: paint. */
  const limitsMode = $derived<LimitsView>(limitsViewOf(selected, store.policy, tools.tool, mode));
  const limitsOn = $derived(viewPrefs.heightLimits);

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

  // ---- selecting on the map (rule 19) ----

  /** MapLibre's `click`, as the selection reads it. */
  interface MapClick {
    lngLat: { lng: number; lat: number };
  }
  /** What the selection needs of the map (`ControllerMap` has no `click`). */
  interface ClickMap {
    on(ev: 'click', fn: (e: MapClick) => void): void;
    off(ev: 'click', fn: (e: MapClick) => void): void;
    getCanvas(): HTMLElement;
  }
  let clickMap: ClickMap | null = null;
  /** The canvas whose presses forget a miss. */
  let pressCanvas: HTMLElement | null = null;
  /** The latest selecting click's number: only its answer counts. */
  let clickSeq = 0;
  /**
   * TimelineMode reported a tap that opened no card; the map's `click` for that tap (which
   * follows, with the point) asks which policy sets the lot.
   */
  let missPending = false;

  const selecting = () => tools.tool === 'move';

  function watchClicks(map: ClickMap): void {
    if (map === clickMap) return;
    unwatchClicks();
    clickMap = map;
    map.on('click', onMapClick);
    // A new press starts a new tap: a miss whose click never came (a drag) is forgotten. A pointer
    // press, once per tap: a touch tap's mousedown comes after its miss, so it cannot be the press.
    pressCanvas = map.getCanvas();
    pressCanvas.addEventListener('pointerdown', forgetMiss);
  }

  function unwatchClicks(): void {
    clickMap?.off('click', onMapClick);
    pressCanvas?.removeEventListener('pointerdown', forgetMiss);
    pressCanvas = null;
  }

  function forgetMiss(): void {
    missPending = false;
  }

  function onMiss(): void {
    missPending = selecting();
  }

  function onMapClick(e: MapClick): void {
    const miss = missPending;
    missPending = false;
    if (!miss || !selecting() || !api) return;
    void selectAt([e.lngLat.lng, e.lngLat.lat], ++clickSeq, api);
  }

  /**
   * Asks the worker which lot is under `point` and which policy sets its limit (for the last view
   * month), then selects that policy's span covering the playhead (else its first) and opens its
   * kind. Focus stays on the map. An answer overtaken by a later click, or by a tool change,
   * changes nothing.
   */
  async function selectAt(
    point: [number, number],
    seq: number,
    a: TimelineClientApi
  ): Promise<void> {
    const r = await a.lotAt(point);
    if (seq !== clickSeq || dead || !r.ok || !selecting()) return;
    const ref = selectionForLot(r.owner, r.parcelId, store.policy, day);
    select(ref);
    if (ref !== null) openKind(ref.kind);
  }

  // ---- outlines of painted lots ----

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

  /** The lots each brush query has found so far (unknown while it is still being found). */
  const foundLots: Lots = (key) => {
    const r = sync.result(key);
    return r?.ok ? r.lots : undefined;
  };

  // The outlines wanted, in order: the selected painted area's lots, else the selected span's
  // painted lots while Erase is chosen, else none.
  $effect(() => {
    const id = selectedArea;
    const area = id !== null ? paintLens.policy.custom.find((b) => b.id === id) : undefined;
    if (area) {
      // Read here, so the effect reruns when the area's lots arrive.
      const r = sync.result(queryKey(customQuery(area)));
      // Unanswered (a stroke just joined this area): keep what is drawn.
      if (!r) return;
      untrack(() => outlineRequest.want(r.ok ? new Set(r.lots) : null));
      return;
    }
    if (readonly || tools.tool !== 'erase') {
      untrack(() => outlineRequest.want(null));
      return;
    }
    const painted = paintedLots(paintLens.policy, foundLots);
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

  // ---- live preview ----

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

  // ---- the transit catalog ----

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

  // Asked for once, when the editor first shows something (the view needs none).
  $effect(() => {
    if (readonly || (selected === null && adding === null)) return;
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

  function onClient(a: TimelineClientApi | null): void {
    api = a;
    brush.phase = a ? 'ready' : 'loading';
    if (!a) return;
    // A new session: brush queries answered `no-session` can be asked again.
    sync.resume();
    catalogSession();
    lidRequest.sessionChanged();
  }

  onMount(() => {
    mounted = true;
    if (clearHandoff) {
      clearHandoff = false;
      dropHandoff();
    }
    if (autosave) detach = autosave.attach();
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
      detach?.();
      strokePreview.reset();
      viewMap?.off('moveend', readView);
      viewMap = null;
      unwatchClicks();
      clickMap = null;
      controller?.destroy();
      controller = null;
      mapHandle = null;
      brush.destroy();
    };
  });
</script>

{#snippet actions()}
  <ViewMenu view={viewPrefs} theme={systemTheme.current} rows={viewRows} onchange={setView} />
  {#if toolOff}
    <button
      type="button"
      class="min-h-6 min-w-6 rounded-md border border-gray-300 px-2 text-sm font-medium whitespace-nowrap dark:border-gray-600 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      onclick={() => setTool('move')}
      >{tools.tool === 'erase' ? 'Stop erasing' : 'Stop painting'}</button
    >
  {/if}
  {#if !readonly}
    <HistoryButtons
      canUndo={store.canUndo}
      canRedo={store.canRedo}
      undoLabel={store.undoLabel}
      redoLabel={store.redoLabel}
      onundo={undo}
      onredo={redo}
    />
    {#if codec}
      <PublishButton
        {codec}
        {doc}
        lastPublished={autosave?.lastPublished}
        onpublished={onPublished}
        {fetchFn}
      />
    {/if}
  {/if}
{/snippet}

{#snippet saveState()}
  {#if autosave}
    <SaveIndicator status={autosave.status} align="start" />
  {/if}
{/snippet}

{#snippet sessionNotices()}
  <SimNotices {notices} ondismiss={dismissNotice} />
{/snippet}

{#snippet paintPart()}
  <PaintTab
    {brush}
    tool={tools.tool}
    ontool={setTool}
    rows={paintRows}
    selected={selectedArea}
    onselect={(id) => (paintArea = id)}
    onremove={removePaintArea}
    eraseHint={ERASE_HINT}
    onretry={(keys) => keys.forEach((k) => sync.retry(k))}
  />
{/snippet}

{#snippet inspectorPart({ results, day: at }: { results: Snippet; day: Day })}
  {#if face === 'results'}
    {@render results()}
  {:else if cal}
    <Inspector
      {store}
      {sync}
      calibration={cal}
      {catalog}
      {drafts}
      {selected}
      onselect={select}
      playheadDay={at}
      asOf={cal.asOf}
      {readonly}
      announce={(m) => brush.announce(m, ANNOUNCE_MS)}
      onclose={closeEditor}
      paint={paintPart}
      bind:adding
    />
  {/if}
{/snippet}

<TimelineMode
  bind:this={timeline}
  {manifest}
  {manifestError}
  {calibration}
  {calibrationError}
  {noScenario}
  {datasetVersion}
  {reload}
  view={viewPrefs}
  cards={readonly || tools.tool === 'move'}
  ownerName={(o) => ownerName4(o, store.policy)}
  fundingName={(c) => fundingName4(store.policy, cal?.baselineFunding)(c)}
  {actions}
  status={readonly ? undefined : saveState}
  notices={sessionNotices}
  policy={store.policy}
  lots={sync.lots}
  lotsFailed={sync.lots === null && !sync.pending && sync.failed.length > 0}
  onlotsretry={() => sync.failed.forEach((k) => sync.retry(k))}
  {readonly}
  onedit={(change, label) => store.apply(change, label)}
  onundoto={(p) => store.undoTo(p, 'Reverted a change')}
  {selected}
  onselect={select}
  onadd={startAdd}
  inspector={inspectorPart}
  {inspectorOpen}
  {detailKey}
  onday={(d) => (day = d)}
  onclient={onClient}
  onmapready={onMapReady}
  onmanifest={(m) => (mapManifest = m)}
  oncalibration={onCalibration}
  onheights={(c) => {
    city = c;
    lidRequest.limitsChanged(c.rev);
  }}
  onchunks={() => {
    outlineRequest.chunksChanged();
    lidRequest.chunksChanged();
  }}
  onmiss={onMiss}
  onscore={pressScore}
  scoreExpanded={face === 'results' && inspectorOpen}
  scoreControls={inspectorId}
/>
{#if !readonly && !wide.current && tools.tool !== 'move'}
  <PaletteStrip
    bind:this={paletteStrip}
    {brush}
    tool={tools.tool}
    ontool={setTool}
    ondone={() => {}}
    eraseHint={ERASE_HINT}
  />
{/if}
<p role="status" aria-live="polite" class="sr-only">{brush.announcement}</p>
