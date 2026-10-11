<script module lang="ts">
  const MEASURE = import.meta.env.DEV || import.meta.env.VITE_E2E === '1';
  const NARROW = '(max-width: 767px)';

  function cssPx(el: Element, name: string): number {
    return parseFloat(getComputedStyle(el).getPropertyValue(name)) || 0;
  }
</script>

<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { Manifest } from '$lib/data/manifest';
  import SimMap from '$lib/map/SimMap.svelte';
  import type { ChunkStatus, GeneratedUpdate, SimMapHandle } from '$lib/map/types';
  import type { Plan } from '$lib/plan';
  import type { Score } from '$lib/scoreboard';
  import {
    SimClient,
    spawnSimWorker,
    type SimClientEvents,
    type WorkerLike
  } from '$lib/sim/client';
  import type { OpStats } from '$lib/sim/protocol';
  import { BrushController } from './BrushController.svelte';
  import BrushToolbar from './BrushToolbar.svelte';
  import { installBrushDebug } from './debug';
  import { createEditor } from './editor.svelte';
  import type { OverlayCtors } from './overlay';
  import type { BrushTool } from './sampler';
  import { BrushState } from './state.svelte';

  interface Props {
    manifest: Manifest | null;
    manifestError: boolean;
    plan: Plan;
    /** PUBLIC_DATASET_VERSION (layout data). Part of the I16 contract; plan-sharing (W5) reads
     *  it for its older-data notice, so nothing here consumes it yet. */
    currentVersion: string;
    readOnly?: boolean;
    /** Retry: reruns loadManifest client-side (the parent supplies it so /p/:id can reuse this). */
    reloadManifest(): Promise<Manifest>;
    /** Latest score from the worker, for scoreboard UI (W5). */
    onscore?(s: Score): void;
    /** Tests inject a fake worker. */
    createWorker?: () => WorkerLike;
  }

  // eslint-disable-next-line svelte/no-unused-props -- currentVersion: see Props
  let {
    manifest: initialManifest,
    manifestError,
    plan,
    readOnly = false,
    reloadManifest,
    onscore,
    createWorker = spawnSimWorker
  }: Props = $props();

  // The props seed the editor once; later changes belong to whoever remounts this component.
  const editor = untrack(() => createEditor(plan, { readOnly }));
  const brush = new BrushState();
  let manifest = $state.raw<Manifest | null>(untrack(() => initialManifest));
  let crosshair = $state(false);
  let insetPx = $state(0);
  let frame = $state<HTMLElement>();

  untrack(() => {
    if (manifestError || !initialManifest) brush.phase = 'failed';
    if (readOnly) brush.tool = 'move';
  });

  let client: SimClient | null = null;
  let handle: SimMapHandle | null = null;
  let layers: OverlayCtors | null = null;
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
      onscore?.(d.score);
    },
    onChunks(c) {
      for (const [cellId, s] of Object.entries(c.status)) setChunkStatus(cellId, s);
      brush.loadingParcels = c.pending > 0;
      chunks = { pending: c.pending, failed: [...c.failed] };
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
        if (!m || fresh.datasetVersion !== m.datasetVersion) manifest = m = fresh;
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
    chunks = { pending: 0, failed: [] };
  }

  function applyInset(): void {
    let px = 0;
    if (matchMedia(NARROW).matches) {
      const bar = frame?.querySelector('.brush-toolbar');
      const brushbar = bar ? cssPx(bar, '--brushbar-h') : 56;
      px = brushbar + cssPx(document.documentElement, '--scorebar-h'); // R17: 0 until W5
    }
    insetPx = px;
    handle?.setBottomInset(px);
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
    if (controller || dead || !handle || !layers || !client) return;
    const map = handle.getMap();
    if (!map) return;
    controllerMap = map;
    controller = new BrushController({
      handle,
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

    const mq = matchMedia(NARROW);
    mq.addEventListener('change', applyInset);
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
      mq.removeEventListener('change', applyInset);
      controller?.destroy(); // first: it may still send to the client
      controller = null;
      client?.dispose();
      client = null;
      handle = null;
      brush.destroy();
    };
  });
</script>

<div bind:this={frame} class="brush-editor relative h-full">
  {#if manifest}
    <SimMap
      {manifest}
      requestParcelSummary={(id) => client?.parcelSummary(id) ?? Promise.resolve(null)}
      onRetryChunks={() => client?.retryChunks()}
      onready={onMapReady}
    />
  {:else}
    <div class="brush-editor-frame h-full" data-testid="brush-frame"></div>
  {/if}

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

  <BrushToolbar
    state={brush}
    {editor}
    onUndo={() => controller?.undo()}
    onRedo={() => controller?.redo()}
    onRetry={() => void retry()}
    {onToolChange}
  />

  {#if editor.readOnly && brush.phase !== 'ready'}
    <!-- The read-only toolbar has no status line (§4.1); /p/:id still needs these states. -->
    <div
      class="brush-readonly-status absolute top-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2"
    >
      <p role="status" aria-live="polite" class="rounded-lg bg-white px-3 py-2 text-sm text-black">
        {brush.statusText}
      </p>
      {#if brush.phase === 'failed'}
        <button
          type="button"
          class="min-h-11 min-w-11 rounded-lg bg-white px-3 text-sm font-semibold text-black underline"
          onclick={() => void retry()}>Retry</button
        >
      {/if}
    </div>
  {/if}
</div>
