<!--
  The /sim page (plan 3): FzpMode running the lever engine on the policy in memory. The recipe
  lives in a PolicyStore (undo, redo); LeverSync resolves its brushes in the worker, compiles it
  and sends each new SimLevers to FzpMode's `levers`, which FzpMode passes on with setLevers. Every
  start opens on the Family Zoning Plan compared with the pre-FZP baseline (`DEFAULT_LEVERS`).
  Custom paint and erase strokes (Task 8) reuse `/`'s BrushController through the stroke
  adapter; the lot dots and the brush ring share SimMap's overlay through the overlay mux.
  Zoning rules (Task 9) read the brush catalog, asked for once when the panel first opens and
  again after a session restart if it came back null; below md their form replaces the sheet's
  contents (layout ruling 9). "Protections" (Task 10) edits the category protections.
  Plan 5 (Task 5): the policy autosaves (`sfhousing:sim:v1`) and is restored on mount, reconciled
  with the calibration (Calls 11 and 12). The header gets the save state (its status slot) and Publish. In `mode: 'view'` (the
  read-only /s/<id>, Task 6) the shared policy opens reconciled with the calibration (Call 7, with
  the timing notice when anything moved); there is no stroke controller, no tools, no autosave and
  no Publish, and the panel is the summary. The lot dots still draw.
  Setup and Run (spec §1, sim-runs Task 7): the page opens in Setup (never persisted). Run (the
  scrubber's button) sets the tool to Move, locks the store and plays; the panel is read-only
  until "Change policy" ("Back to start" in the view) unlocks it and returns to the present.
-->
<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { replaceState } from '$app/navigation';
  import { Autosave } from '$lib/sharing/autosave.svelte';
  import PublishButton from '$lib/sharing/PublishButton.svelte';
  import SaveIndicator from '$lib/sharing/SaveIndicator.svelte';
  import { getStorage } from '$lib/sharing/storage';
  import type { Layer } from '@deck.gl/core';
  import { BrushController, type ControllerMap } from '$lib/brush/BrushController.svelte';
  import { ANNOUNCE_MS } from '$lib/brush/messages';
  import type { OverlayCtors } from '$lib/brush/overlay';
  import { BrushState } from '$lib/brush/state.svelte';
  import type { Manifest } from '$lib/data/manifest';
  import type { ParcelId } from '$lib/data/parcel';
  import FzpMode, { type SimClientApi } from '$lib/fzp/FzpMode.svelte';
  import type { SimMapHandle } from '$lib/map/types';
  import { DEFAULT_LEVERS } from '$lib/sim/levers/types';
  import type { BrushCatalog } from '$lib/sim/levers/brushes';
  import type { BrushLotsResult } from '$lib/sim/scenario/types';
  import { BrushForms } from './brush-forms.svelte';
  import RuleBrushForm from './RuleBrushForm.svelte';
  import type { Calibration } from '$lib/timelapse/types';
  import CustomZoningSection from './CustomZoningSection.svelte';
  import HistoryRow from './HistoryRow.svelte';
  import { SimBrushTools, brushToolOf, type SimTool } from './brush-tools.svelte';
  import { lotOverlayLayers } from './lot-overlay';
  import { createOverlayMux } from './overlay-mux';
  import PhoneToolBar from './PhoneToolBar.svelte';
  import {
    DEFAULT_POLICY,
    canonicalJson,
    compileLevers,
    lotRoles,
    queriesOf,
    type SimPolicy
  } from './policy';
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
    /** Tests: the autosave's storage (default `localStorage`). */
    storage?: () => Storage | null;
    /** Tests: Publish's fetch. */
    fetchFn?: typeof fetch;
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
    fetchFn = undefined
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
    setTimeout,
    clearTimeout
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
    announce: (m) => brush.announce(m, ANNOUNCE_MS)
  });
  const wide = new MediaQuery('(min-width: 768px)');
  let controller: BrushController | null = null;
  let controllerMap: ControllerMap | null = null;
  let mapHandle: SimMapHandle | null = null;
  let deckLayers = $state.raw<OverlayCtors | null>(null);
  let lotsSlot = $state.raw<((l: Layer[]) => void) | null>(null);
  let dead = false;
  let phoneBar = $state<PhoneToolBar>();

  /** The view's map handle: it draws the lot dots only (no stroke controller, no ring). */
  let viewHandle: SimMapHandle | null = null;

  function attachController(): void {
    if (dead || !mapHandle || !deckLayers) return;
    if (mode === 'view') {
      if (viewHandle === mapHandle) return;
      const h = mapHandle;
      viewHandle = h;
      lotsSlot = createOverlayMux((l) => h.setOverlayLayers(l)).slot('lots');
      return;
    }
    if (controller) return;
    const map = mapHandle.getMap();
    if (!map) return;
    const h = mapHandle;
    const mux = createOverlayMux((l) => h.setOverlayLayers(l));
    controllerMap = map;
    controller = new BrushController({
      handle: { setPanEnabled: (b) => h.setPanEnabled(b), setOverlayLayers: mux.slot('ring') },
      map,
      client: adapter.client,
      editor: adapter.editor,
      state: brush,
      layers: deckLayers,
      raf: (cb) => requestAnimationFrame(cb),
      cancelRaf: (id) => cancelAnimationFrame(id)
    });
    controller.attach();
    lotsSlot = mux.slot('lots');
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

  function saveRuleBrush(b: Parameters<BrushForms['save']>[1]): void {
    brush.announce(forms.save(store, b), ANNOUNCE_MS);
    forms.close();
  }

  const prefersDark = new MediaQuery('(prefers-color-scheme: dark)');

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

  // The lot dots: every lot a rule or the custom painting changes, at its label point.
  $effect(() => {
    const slot = lotsSlot;
    const L = deckLayers;
    if (!slot || !L) return;
    const p = store.policy;
    // A local scratch map, rebuilt on each run: not state.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const points = new Map<ParcelId, [number, number]>();
    for (const { key } of queriesOf(p)) {
      const r = sync.result(key);
      if (!r?.ok) continue;
      r.lots.forEach((id, i) => points.set(id, [r.points[2 * i], r.points[2 * i + 1]]));
    }
    const roles = lotRoles(p, (k) => {
      const r = sync.result(k);
      return r?.ok ? r.lots : undefined;
    });
    slot(lotOverlayLayers(L, roles, (id) => points.get(id), prefersDark.current));
  });

  onMount(() => {
    import('@deck.gl/layers').then(
      (mod) => {
        if (dead) return;
        deckLayers = mod;
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
  <button
    bind:this={policyButton}
    type="button"
    aria-expanded={policyOpen}
    aria-controls={panelId}
    class="min-h-6 min-w-6 rounded-md border border-gray-300 px-2 text-sm font-medium whitespace-nowrap pointer-coarse:min-h-11 pointer-coarse:min-w-11"
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
            kind={forms.current.kind}
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
