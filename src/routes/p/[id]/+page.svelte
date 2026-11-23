<script module lang="ts">
  import { M1_TARGETS, score as computeScore } from '$lib/scoreboard';
  /** The score before the worker's first diff. */
  const EMPTY = computeScore([], M1_TARGETS);
</script>

<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import BrushEditor from '$lib/brush/BrushEditor.svelte';
  import type { Manifest } from '$lib/data/manifest';
  import { DockState } from '$lib/dock/dock-state.svelte';
  import { STORAGE_TEXT } from '$lib/game/copy';
  import { gamePath, loadPage, remixPath } from '$lib/game/navigate';
  import { MAX_SAVES } from '$lib/game/saves';
  import { useGame } from '$lib/game/store.svelte';
  import { paintHeadline } from '$lib/paint/headline';
  import PaintDetails from '$lib/paint/PaintDetails.svelte';
  import { frameLatest, viewState, type Score, type ScoreStatus } from '$lib/scoreboard';
  import { copyFor, ogDescription } from '$lib/sharing/copy';
  import { PLAN_CODEC } from '$lib/sharing/doc-codec';
  import SharedBanner, { type RemixState } from '$lib/sharing/SharedBanner.svelte';
  import type { LocalPlanRecord } from '$lib/sharing/storage';
  import { useHeaderActions } from '$lib/shell/header-actions.svelte';
  import { loadManifest } from '$lib/sim/manifest';
  import { headlineSpoken } from '$lib/timeline/results';
  import TimelineHeaderScore from '$lib/timeline/TimelineHeaderScore.svelte';
  import { readViewPrefs, writeViewPrefs, type ViewPrefs } from '$lib/view/prefs';
  import LayerSwitches from '$lib/view/LayerSwitches.svelte';
  import { useSystemTheme } from '$lib/map/system-theme.svelte';
  import type { PageProps } from './$types';

  // Read-only view (spec §4.7): no oneditor, no autosave; no header actions, with the header score
  // pinned as on `/`. Remix makes a saved game holding the published plan and loads `/`
  // (game-shell, sec-design-remix).
  let { data }: PageProps = $props();

  const pageTitle = $derived(`${data.plan.title ?? 'Shared plan'} · SF Housing Simulator`);

  async function reloadManifest() {
    return (await loadManifest(data.plan.datasetVersion, data.currentDatasetVersion)).manifest;
  }

  const game = useGame();
  let mounted = $state(false);
  onMount(() => {
    mounted = true;
  });
  /** Why the last Remix failed; null when it did not. */
  let error = $state<string | null>(null);
  /** Set once a Remix succeeded: the page is loading `/`, so a second press does nothing. */
  let leaving = false;

  // Remix is offered at every level: no locked state and no note.
  const remixState: RemixState = $derived.by(() => {
    if (!mounted) return { kind: 'ready', note: null };
    if (game.open) return null;
    if (game.saves.length >= MAX_SAVES) return { kind: 'full' };
    return { kind: 'ready', note: null };
  });
  const gameHref = $derived(mounted ? gamePath(game.progress.level) : '/');

  function remix(): void {
    if (leaving || remixState?.kind !== 'ready') return;
    const record = JSON.stringify({
      v: 1,
      savedAt: new Date().toISOString(),
      plan: PLAN_CODEC.serialize(PLAN_CODEC.rebase(data.plan, data.currentDatasetVersion))
    } satisfies LocalPlanRecord);
    const r = game.remix({
      kind: 'plan',
      record,
      title: data.plan.title ?? copyFor('plan').untitled
    });
    if (r.ok) {
      leaving = true;
      error = null;
      loadPage(remixPath('plan'));
    } else error = r.reason === 'storage' ? STORAGE_TEXT : null;
  }

  // Map layer toggles (transit spec §6.3): the viewer's own prefs, shared with `/`, in the map
  // toolbar's Layers panel, which shows only when the manifest the map renders has a transit
  // network.
  let view = $state<ViewPrefs>(readViewPrefs());
  let mapManifest = $state.raw<Manifest | null>(null);
  function onViewChange(v: ViewPrefs): void {
    view = v;
    writeViewPrefs(v);
  }
  useHeaderActions(null, { pinned: scoreBar });

  // The dock, as on `/` (sim-ux plan 5): it opens on the read-only Paint tab (the heights it paints, no
  // tools); its own collapse button and rail fold and open it, the header score flips it to
  // Details (PaintDetails).
  const wide = new MediaQuery('(min-width: 768px)');
  const uid = $props.id();
  const dockId = `${uid}-dock`;
  const dock = new DockState({ tab: 'paint' });
  /** The user opened the dock (the score): focus moves in. False for the default open. */
  let dockFocus = $state(false);

  function pressScore(): void {
    dockFocus = true;
    dock.toggleResults(wide.current);
  }

  // Score wiring, as on `/` (scoreboard spec §4.3/§4.4): the header score and the Details face.
  let brushEditor = $state<ReturnType<typeof BrushEditor>>();
  const latestScore = frameLatest<{ score: Score | null; complete: boolean }>({
    score: null,
    complete: true
  });
  onDestroy(() => latestScore.dispose());
  let chunkState = $state({ pending: 0, failed: 0 });
  const scoreStatus = $derived<ScoreStatus>({
    pendingChunks: chunkState.pending,
    failedChunks: chunkState.failed,
    complete: latestScore.current.complete,
    datasetVersion: data.manifest?.datasetVersion ?? data.currentDatasetVersion,
    builtAt: data.manifest?.builtAt ?? '',
    // The header score (in the layout) reads this, and a client navigation away updates `data`
    // to the next page's before this page unmounts: that data may have no `plan`.
    planDatasetVersion: data.plan?.datasetVersion ?? data.currentDatasetVersion,
    mode: 'max'
  });
  const shown = $derived(latestScore.current.score ?? EMPTY);
  const scoreView = $derived(viewState(shown, scoreStatus));
  const headText = $derived(paintHeadline(shown.netUnits));
  const systemTheme = useSystemTheme();
</script>

{#snippet layerSwitches()}
  <LayerSwitches {view} theme={systemTheme.current} onchange={onViewChange} />
{/snippet}

{#snippet scoreBar()}
  <!-- As on `/`: room for homes and its share of the goal. -->
  <TimelineHeaderScore
    text={headText}
    busy={scoreView.updating}
    stale={false}
    expanded={dock.face === 'results' && dock.visible(wide.current)}
    controls={dockId}
    onclick={pressScore}
    live={headlineSpoken(headText)}
    quiet={scoreView.updating}
  />
{/snippet}

{#snippet results()}
  <PaintDetails score={shown} status={scoreStatus} onretry={() => brushEditor?.retryChunks()} />
{/snippet}

<svelte:head>
  <title>{pageTitle}</title>
  <meta property="og:title" content={pageTitle} />
  <meta property="og:description" content={ogDescription(data.plan.ops.length)} />
  <meta property="og:url" content="https://sfhousing.mindlace.net/p/{data.id}" />
</svelte:head>

<h1 class="sr-only">{data.plan.title ?? 'Shared plan'}</h1>
<div class="flex h-full flex-col">
  <SharedBanner
    title={data.plan.title}
    id={data.id}
    createdAt={data.createdAt}
    datasetNotice={data.datasetNotice}
    planVersion={data.plan.datasetVersion}
    currentVersion={data.currentDatasetVersion}
    kind="plan"
    remix={remixState}
    {error}
    {gameHref}
    onremix={remix}
  />
  <div id="map-region" class="relative min-h-0 flex-1">
    <!-- {#key} remounts on client navigation between shared plans: BrushEditor seeds once. -->
    {#key data.id}
      <BrushEditor
        bind:this={brushEditor}
        readOnly
        plan={data.plan}
        manifest={data.manifest}
        manifestError={data.manifestError}
        currentVersion={data.currentDatasetVersion}
        {reloadManifest}
        onscore={(s, meta) => latestScore.push({ score: s, complete: meta.complete })}
        onchunks={(c) => (chunkState = c)}
        {view}
        onmanifest={(m) => (mapManifest = m)}
        layers={mapManifest?.transit ? layerSwitches : undefined}
        {dock}
        {dockId}
        {dockFocus}
        {results}
      />
    {/key}
  </div>
</div>
