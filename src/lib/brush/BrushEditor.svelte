<!--
  `/`'s map editor (and /p/:id's read-only view): the map, its editor worker and, on plan 2's
  `Dock`, the Paint tab shared with /sim (plan 3's `PaintTab`, `HistoryButtons` above it on a
  coarse pointer only, and the phone `PaletteStrip`), so the two pages are one paint experience
  (sim-ux spec Goals 1, 3, 11 and 12). The page owns the `DockState` (the dock folds by its own button) and the Results face.
  Undo and Redo sit above the tab only on a coarse pointer (a keyboard does both; the stroke chip
  says what it did) and the phone strip carries Undo; the Shortcuts button ends the tab on a fine
  pointer.
  `/` has no painted-areas list (that is `/sim`'s): the tab holds the tools, and read-only
  (`/p/:id`) the read-only line and one summary line (`paintedSummary`: the heights used and the
  lots the latest score rebuilds). The map key (`MapKeyControl` with `PaintKey`, closed at rest)
  names the building types and each painted height with its lots (the worker's `heightLots`,
  latest wins); hovering, focusing or pressing a height draws its lots' outline in the overlay
  mux's `outline` slot, under the brush ring in its `ring` slot. The brush status
  line, its Retry and the page's own notices are pills in one notice stack (`NoticePills`). What a
  stroke, a refusal, an undo or a redo did shows in the stroke chip, a polite status over the
  map's top (never in the stack, which is in flow on a phone), so painting never moves or resizes
  the map. The page's header score flips the dock to its Results face (`results`, the
  scoreboard). The live preview stays after release here, because on `/` it is the plan.
-->
<script module lang="ts">
  const MEASURE = import.meta.env.DEV || import.meta.env.VITE_E2E === '1';
</script>

<script lang="ts">
  import { onDestroy, onMount, tick, untrack, type Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import type { Manifest } from '$lib/data/manifest';
  import Dock from '$lib/dock/Dock.svelte';
  import { DockState } from '$lib/dock/dock-state.svelte';
  import { DOCK_ICONS } from '$lib/dock/icons';
  import MapKeyControl from '$lib/map/key/MapKeyControl.svelte';
  import { createOverlayMux } from '$lib/map/overlay-mux';
  import SimMap from '$lib/map/SimMap.svelte';
  import { useSystemTheme } from '$lib/map/system-theme.svelte';
  import type { ChunkStatus, GeneratedUpdate, SimMapHandle } from '$lib/map/types';
  import HistoryButtons from '$lib/paint/HistoryButtons.svelte';
  import { paintedOutlineLayers } from '$lib/paint/outline-layers';
  import PaintKey from '$lib/paint/PaintKey.svelte';
  import PaintTab from '$lib/paint/PaintTab.svelte';
  import PaletteStrip from '$lib/paint/PaletteStrip.svelte';
  import { usePrimaryPointer } from '$lib/paint/pointer.svelte';
  import ShortcutsButton from '$lib/paint/ShortcutsButton.svelte';
  import { paintedSummary, storiesUsed } from '$lib/paint/summary';
  import type { Plan } from '$lib/plan';
  import type { Score } from '$lib/scoreboard';
  import NoticePills from '$lib/shell/NoticePills.svelte';
  import { CHIP, PILL, PILL_ACTION } from '$lib/shell/pill';
  import {
    SimClient,
    spawnSimWorker,
    type SimClientEvents,
    type WorkerLike
  } from '$lib/sim/client';
  import type { OpStats } from '$lib/sim/protocol';
  import type { ViewPrefs } from '$lib/view/prefs';
  import { BrushController } from './BrushController.svelte';
  import { installBrushDebug } from './debug';
  import { createEditor, type Editor } from './editor.svelte';
  import { HeightLots } from './height-lots.svelte';
  import { MSG } from './messages';
  import type { OverlayCtors } from './overlay';
  import type { BrushTool } from './sampler';
  import { BrushState, defaultTool } from './state.svelte';

  interface Props {
    manifest: Manifest | null;
    manifestError: boolean;
    plan: Plan;
    /** The layout's `datasetVersion`. Part of the I16 contract; plan-sharing (W5) reads
     *  it for its older-data notice, so nothing here consumes it yet. */
    currentVersion: string;
    readOnly?: boolean;
    /** Retry: reruns loadManifest client-side (the parent supplies it so /p/:id can reuse this). */
    reloadManifest(): Promise<Manifest>;
    /** Latest score from the worker, with that diff's `complete` flag (I15), for the scoreboard
     *  (its "Updating…" state reads `complete`). Fired on every diff. */
    onscore?(s: Score, meta: { complete: boolean }): void;
    /** Chunk loading summary for the scoreboard (pending count, failed count), fired whenever it
     *  changes: on every `chunks` message and when a worker restart resets it. */
    onchunks?(c: { pending: number; failed: number }): void;
    /**
     * Hands the parent this component's `Editor`, once, synchronously during setup (before
     * mount), so the parent may call `load` straight away (SimMap's `onready` pattern; the same
     * editor `getEditor()` returns). The contract plan-sharing builds on:
     * - `editor.plan` is reactive (`$state.raw`, replaced on every commit/undo/redo/load), so an
     *   `$effect` reading it can autosave;
     * - `editor.load(plan, { readOnly })` re-renders: it cancels a stroke in progress, posts the
     *   plan to the worker (or, before the worker is ready, the first load sends the latest plan)
     *   and switches the Paint tab to read-only (the read-only line and summary, Move) or back to
     *   the editable default tool;
     * - stroke previews never touch the editor: `plan` changes only on a committed op.
     */
    oneditor?: (editor: Editor) => void;
    /** Tests inject a fake worker. */
    createWorker?: () => WorkerLike;
    /** Map layer toggles (transit spec §6.3), passed to SimMap. */
    view?: ViewPrefs;
    /** The manifest SimMap renders (null: none yet), once during setup and again whenever a
     *  Retry replaces it, so the parent can gate manifest-dependent UI (the View menu) on it. */
    onmanifest?: (m: Manifest | null) => void;
    /** The page's dock (its header score flips it to Results and back); one tab, 'paint'. */
    dock?: DockState;
    /** The dock region's id, for the header score's `aria-controls`. */
    dockId?: string;
    /** The page's Results face. */
    results?: Snippet;
    /**
     * The page's own notices (`/`: plan sharing's), each a `PILL`, rendered after the brush status
     * in this component's one notice stack (`NoticePills`), as FzpMode's `notices`.
     */
    notices?: Snippet;
    /** The user opened the dock (the page's header score): focus moves into it. */
    dockFocus?: boolean;
    /** The dock folded by its collapse button or Escape: the page restores focus. */
    ondockclose?: () => void;
  }

  // eslint-disable-next-line svelte/no-unused-props -- currentVersion: see Props
  let {
    manifest: initialManifest,
    manifestError,
    plan,
    readOnly = false,
    reloadManifest,
    onscore,
    onchunks,
    oneditor,
    createWorker = spawnSimWorker,
    view = undefined,
    onmanifest = undefined,
    dock: dockProp = undefined,
    dockId: dockIdProp = undefined,
    results = undefined,
    notices = undefined,
    dockFocus = false,
    ondockclose = undefined
  }: Props = $props();

  // The props seed the editor once; later changes belong to whoever remounts this component.
  const editor = untrack(() => createEditor(plan, { readOnly }));
  const brush = new BrushState();
  let manifest = $state.raw<Manifest | null>(untrack(() => initialManifest));
  let crosshair = $state(false);
  let insetPx = $state(0);

  /** The page's dock, or (for a page that passes none) one of this component's own. */
  const dock = untrack(() => dockProp) ?? new DockState({ tab: 'paint' });
  const uid = $props.id();
  const dockId = $derived(dockIdProp ?? `${uid}-dock`);
  const wide = new MediaQuery('(min-width: 768px)');
  /** Undo and Redo buttons are for a device with no keyboard (`usePrimaryPointer`). */
  const pointer = usePrimaryPointer();
  /** Done on the palette strip reopened the sheet: focus moves into it. */
  let doneFocus = $state(false);
  /** The phone sheet's height (its handle while closed; 0 from md): part of the map's inset. */
  let sheetH = $state(0);
  let paletteStrip = $state<PaletteStrip>();

  untrack(() => {
    onmanifest?.(manifest);
    if (manifestError || !initialManifest) brush.phase = 'failed';
    if (readOnly) brush.tool = 'move';
  });

  /**
   * This component's `Editor`, for a parent holding it through `bind:this` (see `oneditor` in
   * Props for the contract: reactive `plan`, `load` re-renders, previews never change `plan`).
   */
  export function getEditor(): Editor {
    return editor;
  }

  /**
   * Re-sends a fetch for failed parcel chunks (I15 `retryChunks`), for a sibling's Retry control
   * (the scoreboard's partial-failure row). The same request map-view's on-map chip sends.
   */
  export function retryChunks(): void {
    client?.retryChunks();
  }

  let client: SimClient | null = null;
  let handle: SimMapHandle | null = null;
  let layers = $state.raw<OverlayCtors | null>(null);
  /** SimMap's one `setOverlayLayers`, shared: the controller's ring and the row outline. */
  let overlay = $state.raw<ReturnType<typeof createOverlayMux> | null>(null);
  /** The map handle whose overlay mux exists; a new handle gets a new mux. */
  let overlayHandle: SimMapHandle | null = null;
  let controller: BrushController | null = null;
  let controllerMap: ReturnType<SimMapHandle['getMap']> = null;
  let dead = false;
  let retrying = false;
  /** The current manifest is missing or the worker rejected it: Retry must reload it. */
  let needManifest = untrack(() => manifestError || !initialManifest);
  // Until SimMap's handle exists, renders and chunk statuses wait here, in order.
  let pendingRenders: GeneratedUpdate[] = [];
  const pendingStatus = new Map<string, ChunkStatus>(); // eslint-disable-line svelte/prefer-svelte-reactivity
  /** Every cell this worker has given map-view a status for, so a restart can clear them. */
  const statusCells = new Set<string>(); // eslint-disable-line svelte/prefer-svelte-reactivity
  let lastStats: OpStats | null = null;
  let chunks: { pending: number; failed: string[] } = { pending: 0, failed: [] };
  /** Failed parcel cells: map-view shows its failure chip, and the stroke chip sits below it. */
  let failedCells = $state(0);
  /** Lots the plan rebuilds (the latest score's `parcelsChanged`), for the read-only summary;
   *  null until the first diff of a load arrives, so the line never claims a false zero. */
  let rebuilt = $state<number | null>(null);

  /** Every assignment to `chunks` goes through here so `onchunks` never misses one. */
  function setChunks(next: { pending: number; failed: string[] }): void {
    chunks = next;
    failedCells = next.failed.length;
    onchunks?.({ pending: next.pending, failed: next.failed.length });
  }

  function applyRender(u: GeneratedUpdate): void {
    if (handle) {
      rebindController();
      return handle.applyGenerated(u);
    }
    if (u.revision === 0) pendingRenders = []; // a full snapshot supersedes what came before
    pendingRenders.push(u);
  }

  function setChunkStatus(cellId: string, s: ChunkStatus): void {
    statusCells.add(cellId);
    if (handle) return handle.setChunkStatus(cellId, s);
    pendingStatus.delete(cellId);
    pendingStatus.set(cellId, s);
  }

  function markCommit(): void {
    if (!MEASURE) return;
    try {
      performance.mark('sfh-brush-commit-applied');
      performance.measure('sfh-brush-commit', 'sfh-brush-pointerup', 'sfh-brush-commit-applied');
    } catch {
      // measurement is best-effort
    }
  }

  const events: SimClientEvents = {
    onReady() {
      brush.phase = 'ready';
      client?.load(editor.plan);
    },
    onDiff(d) {
      applyRender(d.render);
      const stale = client?.isStalePreview(d) ?? false;
      if (d.phase === 'commit' && d.stats && !stale) lastStats = d.stats;
      // Only a commit with its own pointerup mark: a redo's would span from an older stroke.
      if (d.phase === 'commit' && controller && d.rev === controller.markedCommitRev) markCommit();
      controller?.onDiff(d, stale);
      // Only read-only shows it: an editable stroke's previews write nothing here.
      if (!stale && editor.readOnly) rebuilt = d.score.parcelsChanged;
      onscore?.(d.score, { complete: d.complete });
    },
    onChunks(c) {
      for (const [cellId, s] of Object.entries(c.status)) setChunkStatus(cellId, s);
      brush.loadingParcels = c.pending > 0;
      setChunks({ pending: c.pending, failed: [...c.failed] });
      heightLots.chunksChanged();
    },
    onError(e) {
      controller?.onError(e.rev);
      if (e.code === 'manifest-invalid') {
        console.error('[brush] manifest rejected by the worker', e.message);
        needManifest = true;
        brush.phase = 'failed';
      } else if (e.code === 'internal') {
        console.error('[brush] worker error', e.message);
      } // bad-request: the client resyncs on its own
    },
    onCrash() {
      // No reply will come for anything in flight.
      controller?.onError(Number.POSITIVE_INFINITY);
      brush.loadingParcels = false;
      brush.phase = 'failed';
    }
  };

  async function retry(): Promise<void> {
    if (retrying || dead || !client) return;
    retrying = true;
    brush.phase = 'loading';
    try {
      if (client.crashed) {
        client.restart(createWorker());
        resetChunkStatuses();
      }
      let m = manifest;
      if (needManifest || !m) {
        const fresh = await reloadManifest();
        if (dead) return;
        // A new object remounts SimMap's map (and onready does not fire again), so keep the
        // mounted one when the reload is the same dataset; I16 still gets one object for both.
        if (!m || fresh.datasetVersion !== m.datasetVersion) {
          manifest = m = fresh;
          onmanifest?.(m);
        }
        needManifest = false;
      }
      client.init(m);
    } catch (e) {
      console.error('[brush] retry failed', e);
      if (!dead) brush.phase = 'failed';
    } finally {
      retrying = false;
    }
  }

  /**
   * After a worker restart the new loader reports only the cells it fetches, so statuses the
   * dead worker set would stick (a stale "Some parcels didn't load" chip whose Retry does nothing).
   * ChunkStatus has no "not loaded" value; 'ready' is the only one that is neither an error nor a
   * spinner (map-view's own "unknown" for an unreported cell is not settable). The new worker
   * reports 'loading'/'error' again for any cell it actually needs.
   */
  function resetChunkStatuses(): void {
    for (const cellId of statusCells) setChunkStatus(cellId, 'ready');
    statusCells.clear();
    setChunks({ pending: 0, failed: [] });
  }

  /**
   * The map's bottom inset: the dock sheet's height (its handle while closed; 0 from md, where the
   * dock sits beside the map), so the map's centre and controls sit above it. Nothing sits under
   * the sheet on `/` (no time bar; the score is in the header).
   */
  function applyInset(): void {
    insetPx = sheetH;
    handle?.setBottomInset(sheetH);
  }

  /** SimMap remounted its map (a new manifest): move the controller to the new one. */
  function rebindController(): void {
    if (controller && handle && handle.getMap() !== controllerMap) {
      controller.destroy();
      controller = null;
    }
    attachController();
  }

  function attachController(): void {
    if (dead || !handle || !layers || !client) return;
    const h = handle;
    if (overlayHandle !== h) {
      overlayHandle = h;
      overlay = createOverlayMux((l) => h.setOverlayLayers(l));
    }
    if (controller || !overlay) return;
    const map = h.getMap();
    if (!map) return;
    controllerMap = map;
    controller = new BrushController({
      handle: { setPanEnabled: (b) => h.setPanEnabled(b), setOverlayLayers: overlay.slot('ring') },
      map,
      client,
      editor,
      state: brush,
      layers,
      raf: (cb) => requestAnimationFrame(cb),
      cancelRaf: (h) => cancelAnimationFrame(h),
      onCrosshair: (v) => (crosshair = v)
    });
    controller.attach();
  }

  function onMapReady(h: SimMapHandle): void {
    if (dead) return;
    handle = h;
    h.onResyncNeeded(() => {
      rebindController();
      client?.resync();
    });
    for (const [cellId, s] of pendingStatus) h.setChunkStatus(cellId, s);
    pendingStatus.clear();
    const renders = pendingRenders;
    pendingRenders = [];
    for (const u of renders) h.applyGenerated(u);
    applyInset();
    attachController();
  }

  function onToolChange(t: BrushTool): void {
    if (controller) controller.setTool(t);
    else brush.tool = t;
  }

  /**
   * The user's tool choice (the Paint tab, the palette strip): below md, Paint or Erase also folds
   * the sheet to its handle so the palette strip shows, with focus on it.
   */
  function chooseTool(t: BrushTool): void {
    onToolChange(t);
    if (t !== 'move' && !wide.current && dock.sheet !== 'closed') {
      dock.sheet = 'closed';
      void tick().then(() => paletteStrip?.focus());
    }
  }

  /** The palette strip's Done (it chose Move): the sheet opens full on the Paint tab. */
  function stripDone(): void {
    doneFocus = true;
    dock.showEdit('paint');
    dock.sheet = 'full';
  }

  /** The Results face's "Paint": back to the Paint tab, focus on it. */
  async function flip(): Promise<void> {
    dock.showEdit('paint');
    await tick();
    document
      .getElementById(dockId)
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.focus();
  }

  /**
   * A shared plan's one line in the read-only tab: its heights (from the ops, when the plan
   * changes) and the lots it rebuilds (the latest score's `parcelsChanged`, as chunks load).
   */
  const stories = $derived(storiesUsed(editor.plan.ops)); // re-runs only when the plan changes
  const summary = $derived(editor.readOnly ? paintedSummary(stories, rebuilt) : null);

  /**
   * The map key's counts: the worker's `heightLots`, asked once per plan change while the worker
   * is ready (after the plan's own load, commit or undo, which the worker handles first), again on
   * a chunk message while a cell of the plan is missing, and for the height the key shows.
   */
  const heightLots = new HeightLots((h) => client?.heightLots(h) ?? Promise.resolve(null));
  /** The height the key asked to outline, or null. */
  let shownHeight = $state<number | null>(null);
  /** The key's panel is visible (open, and the control not hidden): outlines show only then. */
  let keyVisible = $state(false);
  /** The next plan change is another plan (Editor.load): its rows wait for their own counts. */
  let freshPlan = false;
  $effect(() => {
    void editor.plan;
    if (brush.phase !== 'ready') return;
    untrack(() => {
      heightLots.planChanged(freshPlan);
      freshPlan = false;
    });
  });
  function showHeight(stories: number | null): void {
    shownHeight = stories;
    heightLots.show(stories);
  }
  const systemTheme = useSystemTheme();
  /** Whether the outline slot holds a layer (an empty slot is not written again). */
  let outlined = false;
  $effect(() => {
    const o = overlay;
    const out = heightLots.outline;
    const L = layers;
    if (!o) return;
    const next = out && L ? paintedOutlineLayers(L, out, systemTheme.current) : [];
    if (next.length === 0 && !outlined) return;
    outlined = next.length > 0;
    untrack(() => o.slot('outline')(next));
  });

  let wasReadOnly = untrack(() => readOnly);
  /** Editor.load (plan-sharing's restore, /p/:id, Remix) must reach the worker and the tools. */
  const offLoad = editor.onLoad((loaded) => {
    controller?.cancelStroke();
    // The new plan's count comes with its load diff, never the previous plan's.
    rebuilt = null;
    freshPlan = true;
    // Not ready: onReady's load sends editor.plan, which is already `loaded`.
    if (brush.phase === 'ready') client?.load(loaded);
    if (editor.readOnly) onToolChange('move');
    else if (wasReadOnly) onToolChange(defaultTool());
    wasReadOnly = editor.readOnly;
  });
  onDestroy(offLoad);
  untrack(() => oneditor?.(editor));

  onMount(() => {
    client = new SimClient(createWorker(), events, () => editor.plan);
    if (manifest && !needManifest) client.init(manifest);

    import('@deck.gl/layers').then(
      (mod) => {
        if (dead) return;
        layers = mod;
        attachController();
      },
      (e) => console.error('[brush] overlay layers failed to load', e)
    );

    applyInset();

    const uninstall = installBrushDebug(() => ({
      ops: editor.plan.ops.length,
      lastStats,
      ready: brush.phase === 'ready',
      chunks
    }));

    return () => {
      dead = true;
      uninstall();
      controller?.destroy(); // first: it may still send to the client
      controller = null;
      client?.dispose();
      client = null;
      handle = null;
      brush.destroy();
    };
  });
</script>

{#snippet history()}
  <div class="border-b border-line px-4 py-2 dark:border-line-dark">
    <HistoryButtons
      canUndo={editor.canUndo}
      canRedo={editor.canRedo}
      undoLabel={null}
      redoLabel={null}
      onundo={() => controller?.undo()}
      onredo={() => controller?.redo()}
    />
  </div>
{/snippet}

{#snippet paintKey()}
  <PaintKey
    ops={editor.plan.ops}
    result={heightLots.result}
    shown={heightLots.outline ? shownHeight : null}
    onshow={showHeight}
    active={keyVisible}
  />
{/snippet}

{#snippet tabPanel(id: string)}
  {#if id === 'paint'}
    <PaintTab
      {brush}
      tool={brush.tool}
      ontool={chooseTool}
      eraseHint={MSG.eraseHint}
      readonly={editor.readOnly}
      intro={editor.readOnly ? MSG.readOnly : editor.plan.ops.length === 0 ? MSG.start : null}
      {summary}
    />
    {#if !editor.readOnly && pointer.fine}
      <div class="mt-3 -ml-2 flex"><ShortcutsButton /></div>
    {/if}
  {/if}
{/snippet}

<!-- No bar sits under the phone sheet on `/`: the dock and the palette strip read
     `--fzp-scrubber-h` (/sim's time bar) as 0, so the sheet's handle is at the map's bottom. -->
<div class="brush-editor sfh-dock-host relative flex h-full flex-col">
  <!-- One notice stack: the brush status line (city data, parcels loading, the zoom hint, a failure
       with its Retry), then the page's own notices. An overlay at the map's top from md; in flow
       under the header below md. -->
  <NoticePills>
    <div role="status" aria-live="polite" data-testid="brush-status" class="contents">
      {#if brush.statusText}
        <span class="{PILL} {brush.phase === 'failed' ? '' : 'pr-4'}">
          <span>{brush.statusText}</span>
          {#if brush.phase === 'failed'}
            <button type="button" class="shrink-0 {PILL_ACTION}" onclick={() => void retry()}
              >Retry</button
            >
          {/if}
        </span>
      {/if}
    </div>
    {@render notices?.()}
  </NoticePills>
  <!-- The map and everything over it: the stack above is not part of its box. -->
  <div class="relative min-h-0 flex-1">
    {#if manifest}
      <SimMap
        {manifest}
        requestParcelSummary={(id) => client?.parcelSummary(id) ?? Promise.resolve(null)}
        onRetryChunks={() => client?.retryChunks()}
        onready={onMapReady}
        {view}
      />
    {:else}
      <div class="brush-editor-frame h-full" data-testid="brush-frame"></div>
    {/if}

    <!-- The stroke chip (a stroke's result, a refusal, Undid, Redid, Removed): one polite status
         over the map's top, centred right of the dock, at the top of map-view's failure chips and
         one row lower while one of them shows (so it never covers Retry). It takes no presses, so
         a stroke can start under it, and never moves the map. Mounted empty (no box), so its
         first text is announced; it clears when the announcement does. -->
    <div
      role="status"
      aria-live="polite"
      data-testid="brush-announcement"
      data-notice
      class="brush-chip pointer-events-none absolute z-20 flex w-max -translate-x-1/2 justify-center"
      style:top="calc(var(--notice-pills-bottom, 0px) + {failedCells > 0 ? '3.5rem' : '0.5rem'})"
    >
      {#if brush.announcement}
        <span data-testid="stroke-chip" class={CHIP}>{brush.announcement}</span>
      {/if}
    </div>

    <!-- The map key at the map's bottom right, above the attribution (and the phone sheet's
         handle, which lifts the footprint); closed at rest at every width. Below md, while the
         sheet is open over the map, it hides (as /sim's does under a card's sheet). -->
    <MapKeyControl
      key={paintKey}
      hidden={!wide.current && dock.sheet !== 'closed'}
      onopenchange={(p) => (keyVisible = p === 'key')}
    />

    {#if crosshair}
      <svg
        aria-hidden="true"
        data-testid="brush-crosshair"
        class="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
        style="top: calc(50% - {insetPx / 2}px)"
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke-linecap="round"
      >
        <path d="M12 3v18M3 12h18" stroke="rgb(0 0 0 / 0.6)" stroke-width="4" />
        <path d="M12 3v18M3 12h18" stroke="white" stroke-width="2" />
      </svg>
    {/if}

    <Dock
      id={dockId}
      label="Paint"
      state={dock}
      tabs={[{ id: 'paint', label: 'Paint', icon: DOCK_ICONS.paint, railLabel: 'Paint tools' }]}
      panel={tabPanel}
      top={pointer.coarse && !editor.readOnly ? history : undefined}
      {results}
      flipLabel="Paint"
      flipName={editor.readOnly ? 'Back to the Paint tab' : 'Back to painting'}
      onflip={() => void flip()}
      focusOnOpen={dockFocus || doneFocus}
      onsheetheight={(px) =>
        // Dock reports from inside its own effect: read nothing it would then track.
        untrack(() => {
          sheetH = px;
          applyInset();
        })}
      onclose={ondockclose}
    />
    {#if !editor.readOnly && !wide.current && dock.sheet === 'closed' && brush.tool !== 'move'}
      <PaletteStrip
        bind:this={paletteStrip}
        {brush}
        tool={brush.tool}
        ontool={chooseTool}
        ondone={stripDone}
        eraseHint={MSG.eraseHint}
        lift={sheetH}
        canUndo={editor.canUndo}
        onundo={() => controller?.undo()}
      />
    {/if}
  </div>
</div>

<style>
  /* Centred over the map right of the dock (`--dock-w`, 0 below md), as map-view's failure chips
     and the notice pills are, within 16 px of the map's edges either side. */
  .brush-chip {
    left: calc(50% + var(--dock-w, 0px) / 2);
    max-width: calc(100% - 2rem - var(--dock-w, 0px));
  }
</style>
