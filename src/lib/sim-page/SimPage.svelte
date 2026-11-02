<!--
  The /sim page (plan 3): FzpMode running the lever engine on the policy in memory. The recipe
  lives in a PolicyStore (undo, redo); LeverSync resolves its brushes in the worker, compiles it
  and sends each new SimLevers to FzpMode's `levers`, which FzpMode passes on with setLevers. Every
  start opens on the Family Zoning Plan compared with the pre-FZP baseline (`DEFAULT_LEVERS`).
  Custom paint and erase strokes (Task 8) reuse `/`'s BrushController through the stroke
  adapter; the overlay layers and the brush ring share SimMap's overlay through the overlay mux.
  Zoning rules (Task 9) read the brush catalog, asked for once when the panel first opens and
  again after a session restart if it came back null; below md their form replaces the sheet's
  contents (layout ruling 9). "Protections" (Task 10) edits the category protections.
  Plan 5 (Task 5): the policy autosaves (`sfhousing:sim:v1`) and is restored on mount, reconciled
  with the calibration (Calls 11 and 12). The header gets the save state (its status slot) and Publish. In `mode: 'view'` (the
  read-only /s/<id>, Task 6) the shared policy opens reconciled with the calibration (Call 7, with
  the timing notice when anything moved); there is no stroke controller, no tools, no autosave and
  no Publish, and the panel is the summary.
  Setup and Run (spec §1, sim-runs Task 7): the page opens in Setup (never persisted). Run (the
  scrubber's button) sets the tool to Move, locks the store and plays; the panel is read-only
  until "Change policy" ("Back to start" in the view) unlocks it and returns to the present.
  Map overlays (sim-runs plan 2, Task 4): in Setup the header's View menu (transit stops, transit
  capacity, height limits); a run hides them all and keeps the toggles. The height limits (glass
  lids and contours, height-lids plan) come from FzpMode's `onheights`; nothing draws them yet.
  Paint feedback (Task 6): in Setup a Paint stroke, and a saved zoning rule once its revision is
  current, briefly shows the buildings its lots in view could hold (the overlay's feedback slot).
-->
<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
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
  import FzpMode, { type SimClientApi } from '$lib/fzp/FzpMode.svelte';
  import type { HeightCity } from '$lib/map/height/types';
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
  import RuleBrushForm from './RuleBrushForm.svelte';
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
  import { paintedOutlineLayers } from './painted-outline';
  import { SIM_CODEC, simDocProblems, type SimDoc } from './sim-doc';
  import SimNotices from './SimNotices.svelte';
  import { restoreSimDoc, type SimNotice } from './sim-session';
  import { createStrokeAdapter } from './stroke-adapter';
  import { timingLabel } from './timing';
  import { focusHeaderMenu } from '$lib/shell/header-actions.svelte';
  import { LeverSync, PolicyStore } from './policy-store.svelte';
  import { RunPhase } from './run-phase.svelte';
  import PermittingSection from './PermittingSection.svelte';
  import PolicyPanel from './PolicyPanel.svelte';
  import RulesSection from './RulesSection.svelte';
  import PolicySummary from './PolicySummary.svelte';
  import { customLotStatus, ruleLotStatus, type LotStatus } from './brush-summary';
  import ProtectionsSection from './ProtectionsSection.svelte';

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

  const uid = $props.id();
  const panelId = `${uid}-policy`;
  let policyOpen = $state(false);
  /** Opening moves focus into the panel only when the user opened it (WCAG 2.4.3). */
  let policyFocus = $state(true);
  let policyButton = $state<HTMLButtonElement>();

  // The panel starts open, docked, from md and closed below (the controller's ruling); read once,
  // on the client. With no scenario there is no panel.
  onMount(() => {
    if (noScenario || !matchMedia('(min-width: 768px)').matches) return;
    policyFocus = false;
    policyOpen = true;
  });

  function openPolicy(): void {
    policyFocus = true;
    policyOpen = true;
  }

  /**
   * Closing the panel returns focus to the Policy button, or, when it sits in the closed phone
   * Menu, to the Menu button. Focus elsewhere on the page (a press on the map) stays put.
   */
  async function closePolicy(): Promise<void> {
    const a = document.activeElement;
    const panel = document.getElementById(panelId);
    const restore = !a || a === document.body || !!panel?.contains(a);
    policyOpen = false;
    await tick();
    if (!restore) return;
    if (policyButton?.checkVisibility()) policyButton.focus();
    else focusHeaderMenu();
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
  const wide = new MediaQuery('(min-width: 768px)');
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
    attachController();
  }

  function setTool(t: SimTool): void {
    tools.tool = t;
    const bt = brushToolOf(t);
    if (controller) controller.setTool(bt);
    else brush.tool = bt;
    // On a phone, a stroke tool closes the sheet and shows the floating tool bar.
    if (t !== 'move' && !wide.current && policyOpen) {
      policyOpen = false;
      void tick().then(() => phoneBar?.focus());
    }
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
    store.locked = true;
    run.run();
  }

  function resetRun(): void {
    store.locked = false;
    run.reset();
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
    mapManifest?.transit ? ['transitStops', 'transitAccess', 'heightFog'] : ['heightFog']
  );

  function setView(v: ViewPrefs): void {
    viewPrefs = v;
    writeViewPrefs(v, storage());
  }

  /**
   * The latest kept lever revision's height regions and contours (FzpMode's `onheights`). Not
   * drawn yet: the contour and lid layers read it (height-lids plan, Task 12).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Task 12's layers read it
  let city = $state.raw<HeightCity | null>(null);

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

  const forms = new BrushForms();

  // Closing the panel, or crossing md (inline form <-> sheet sub-view), discards an open brush
  // form, so the panel reopens on the brush list (the coordinator's ruling).
  let formLayout: boolean | null = null;
  $effect(() => {
    const isOpen = policyOpen;
    const w = wide.current;
    untrack(() => {
      if (!isOpen || (formLayout !== null && formLayout !== w)) forms.dismiss();
      formLayout = w;
    });
  });
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

  // Asked for once, when the panel first opens (the view's summary needs no catalog).
  $effect(() => {
    if (!policyOpen || mode === 'view') return;
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
   * A rule form saved (the inline form from md, or the sheet's below): arm the rule feedback, but
   * only for a save that changed the policy, as only that sends a new revision to wait for.
   */
  function ruleSaved(r: { id: string }, changed: boolean): void {
    if (changed) feedbackTrigger.saved(r.id);
  }

  function saveRuleBrush(b: Parameters<BrushForms['save']>[1]): void {
    const before = store.policy;
    brush.announce(forms.save(store, b), ANNOUNCE_MS);
    ruleSaved(b, store.policy !== before);
    forms.close();
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
    return () => {
      dead = true;
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
    aria-expanded={policyOpen}
    aria-controls={panelId}
    class="min-h-6 min-w-6 rounded-md border border-gray-300 px-2 text-sm font-medium whitespace-nowrap md:max-lg:px-1 dark:border-gray-600 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
    onclick={() => (policyOpen ? void closePolicy() : openPolicy())}>Policy</button
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

{#snippet policySummary()}
  <PolicySummary policy={store.policy} {calibration} {lotsOf} />
{/snippet}

{#snippet timingSection()}
  {#if calibration}
    <PermittingSection {store} {calibration} announce={(m) => brush.announce(m, ANNOUNCE_MS)} />
  {/if}
{/snippet}

{#snippet panel()}
  <PolicyPanel
    id={panelId}
    open={policyOpen}
    focusOnOpen={policyFocus}
    onclose={() => void closePolicy()}
    view={mode === 'view'
      ? 'summary'
      : forms.current && catalog && !wide.current
        ? 'add-brush'
        : 'sections'}
    onback={() => forms.close()}
    timingSummary={calibration ? timingLabel(store.policy.timing.current) : undefined}
    timing={calibration ? timingSection : undefined}
    summary={policySummary}
    readonly={run.phase === 'run'}
    onreset={resetRun}
    resetLabel={mode === 'view' ? 'Back to start' : 'Change policy'}
  >
    {#snippet history()}
      <HistoryRow {store} onundo={undo} onredo={redo} />
    {/snippet}
    {#snippet rules()}
      <RulesSection
        {store}
        {sync}
        {catalog}
        {forms}
        inlineForm={wide.current}
        announce={(m) => brush.announce(m, ANNOUNCE_MS)}
        onsaved={ruleSaved}
      />
    {/snippet}
    {#snippet custom()}
      <CustomZoningSection
        {store}
        {sync}
        {tools}
        ontool={setTool}
        announce={(m) => brush.announce(m, ANNOUNCE_MS)}
      />
    {/snippet}
    {#snippet protections()}
      <ProtectionsSection {store} announce={(m) => brush.announce(m, ANNOUNCE_MS)} />
    {/snippet}
    {#snippet subview()}
      {#if forms.current && catalog}
        {#key forms.current}
          <RuleBrushForm
            {catalog}
            initial={forms.current.initial}
            onsave={saveRuleBrush}
            oncancel={() => forms.close()}
          />
        {/key}
      {/if}
    {/snippet}
  </PolicyPanel>
  {#if mode === 'edit' && run.phase === 'setup' && !wide.current && !policyOpen && tools.tool !== 'move'}
    <PhoneToolBar bind:this={phoneBar} {tools} ontool={setTool} ondone={openPolicy} />
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
  leversPending={sync.pending}
  view={run.phase === 'setup' ? viewPrefs : HIDDEN_VIEW}
  onheights={(c) => (city = c)}
  onlevers={onLevers}
  onchunks={() => outlineRequest.chunksChanged()}
  onmanifest={(m) => (mapManifest = m)}
  {actions}
  status={mode === 'edit' ? saveState : undefined}
  notices={sessionNotices}
  {panel}
  onmapready={onMapReady}
  onphase={(p) => (brush.phase = p === 'ready' ? 'ready' : p === 'failed' ? 'failed' : 'loading')}
  onclient={(a) => {
    api = a;
    // A new session: brush queries answered `no-session` can be asked again.
    if (a) {
      sync.resume();
      catalogSession();
    }
  }}
/>
