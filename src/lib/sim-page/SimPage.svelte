<!--
  The /sim page (plan 3): FzpMode running the lever engine on the policy in memory. The recipe
  lives in a PolicyStore (undo, redo); LeverSync resolves its brushes in the worker, compiles it
  and sends each new SimLevers to FzpMode's `levers`, which FzpMode passes on with setLevers. `start=fzp` (the /fzp
  redirect) opens the Family Zoning Plan comparison, otherwise current law (Calls 14 and 16).
  Freehand, erase and protect strokes (Task 8) reuse `/`'s BrushController through the stroke
  adapter; the lot dots and the brush ring share SimMap's overlay through the overlay mux.
  Rule brushes (Task 9) read the brush catalog, asked for once when the panel first opens and
  again after a session restart if it came back null; below md their form replaces the sheet's
  contents (layout ruling 9).
-->
<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import type { Layer } from '@deck.gl/core';
  import { BrushController, type ControllerMap } from '$lib/brush/BrushController.svelte';
  import { ANNOUNCE_MS } from '$lib/brush/messages';
  import type { OverlayCtors } from '$lib/brush/overlay';
  import { BrushState } from '$lib/brush/state.svelte';
  import type { Manifest } from '$lib/data/manifest';
  import type { ParcelId } from '$lib/data/parcel';
  import FzpMode, { type SimClientApi } from '$lib/fzp/FzpMode.svelte';
  import type { SimMapHandle } from '$lib/map/types';
  import { DEFAULT_LEVERS, FZP_COMPAT_LEVERS } from '$lib/sim/levers/types';
  import type { BrushCatalog } from '$lib/sim/levers/brushes';
  import type { BrushLotsResult } from '$lib/sim/scenario/types';
  import { BrushForms } from './brush-forms.svelte';
  import RuleBrushForm from './RuleBrushForm.svelte';
  import type { Calibration } from '$lib/timelapse/types';
  import BrushSection from './BrushSection.svelte';
  import { SimBrushTools, brushToolOf, isProtectTool, type SimTool } from './brush-tools.svelte';
  import { lotOverlayLayers } from './lot-overlay';
  import { createOverlayMux } from './overlay-mux';
  import PhoneToolBar from './PhoneToolBar.svelte';
  import { lotRoles, policyFromLevers, queriesOf } from './policy';
  import { createStrokeAdapter } from './stroke-adapter';
  import { focusHeaderMenu } from '$lib/shell/header-actions.svelte';
  import { LeverSync, PolicyStore } from './policy-store.svelte';
  import PolicyPanel from './PolicyPanel.svelte';

  interface Props {
    manifest: Manifest | null;
    manifestError: boolean;
    calibration: Calibration | null;
    calibrationError: boolean;
    noScenario: boolean;
    datasetVersion: string;
    /** 'fzp' when the /fzp redirect opened the page. */
    start: 'fzp' | null;
    /** `?seed=N`, or null for the representative future. */
    urlSeed: number | null;
    reload(): Promise<{ manifest: Manifest; calibration: Calibration }>;
    onurlseed?: (seed: number | null) => void;
  }

  let {
    manifest,
    manifestError,
    calibration,
    calibrationError,
    noScenario,
    datasetVersion,
    start,
    urlSeed,
    reload,
    onurlseed
  }: Props = $props();

  /** The document the session opens with; a remount (new load) starts over. */
  const initial = untrack(() => (start === 'fzp' ? FZP_COMPAT_LEVERS : DEFAULT_LEVERS));
  const initialPolicy = policyFromLevers(initial);
  const store = new PolicyStore(initialPolicy);

  /** The scenario client's brush requests; null before mount, after a crash and after unmount. */
  let api: SimClientApi | null = null;
  /** What FzpMode runs: `initial`, then each document LeverSync sends. */
  let levers = $state.raw(initial);

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
    target: () => tools.target(),
    effect: () => tools.effect(),
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

  function attachController(): void {
    if (dead || controller || !mapHandle || !deckLayers) return;
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

  // The controller's own tool keys set brush.tool: keep the /sim tool in step. While Protect or
  // Unprotect is active, B and E stay on the protections (B: Protect, E: Unprotect), so a key
  // never silently turns a protect stroke into zoning paint.
  $effect(() => {
    const bt = brush.tool;
    untrack(() => {
      if (brushToolOf(tools.tool) === bt) return;
      if (isProtectTool(tools.tool) && bt !== 'move') {
        tools.tool = bt === 'paint' ? 'protect' : 'unprotect';
      } else {
        tools.tool = bt;
      }
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

  // Asked for once, when the panel first opens.
  $effect(() => {
    if (!policyOpen) return;
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

  // The lot dots: every lot the user layer or the brushed protections touch, at its label point.
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
{/snippet}

{#snippet panel()}
  <PolicyPanel
    {store}
    id={panelId}
    open={policyOpen}
    focusOnOpen={policyFocus}
    onclose={() => void closePolicy()}
    view={forms.current && catalog && !wide.current ? 'add-brush' : 'sections'}
    onback={() => forms.close()}
  >
    {#snippet zoning()}
      <BrushSection
        {store}
        {sync}
        {tools}
        ontool={setTool}
        onundo={undo}
        onredo={redo}
        {catalog}
        {forms}
        inlineForm={wide.current}
        announce={(m) => brush.announce(m, ANNOUNCE_MS)}
      />
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
  {#if !wide.current && !policyOpen && tools.tool !== 'move'}
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
  {actions}
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
