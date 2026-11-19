<script module lang="ts">
  import { M1_TARGETS, score as computeScore } from '$lib/scoreboard';
  /** The score before the worker's first diff. */
  const EMPTY = computeScore([], M1_TARGETS);
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { goto } from '$app/navigation';
  import BrushEditor from '$lib/brush/BrushEditor.svelte';
  import type { Manifest } from '$lib/data/manifest';
  import { DockState } from '$lib/dock/dock-state.svelte';
  import { paintHeadline } from '$lib/paint/headline';
  import { frameLatest, viewState, type Score, type ScoreStatus } from '$lib/scoreboard';
  import ScoreboardPanel from '$lib/scoreboard/ScoreboardPanel.svelte';
  import { ogDescription, remixConfirm } from '$lib/sharing/copy';
  import { localOpCount, remixToLocal } from '$lib/sharing/remix';
  import SharedBanner from '$lib/sharing/SharedBanner.svelte';
  import { getStorage } from '$lib/sharing/storage';
  import { useHeaderActions } from '$lib/shell/header-actions.svelte';
  import { loadManifest } from '$lib/sim/manifest';
  import { headlineSpoken } from '$lib/timeline/results';
  import TimelineHeaderScore from '$lib/timeline/TimelineHeaderScore.svelte';
  import { readViewPrefs, writeViewPrefs, type ViewPrefs } from '$lib/view/prefs';
  import ViewMenu from '$lib/view/ViewMenu.svelte';
  import { useSystemTheme } from '$lib/map/system-theme.svelte';
  import type { PageProps } from './$types';

  // Read-only view (spec §4.7): no oneditor, no autosave; the header action is View, with the
  // header score pinned as on `/`. The local autosaved plan is only read (op
  // count) and written by an explicit Remix.
  let { data }: PageProps = $props();

  const pageTitle = $derived(`${data.plan.title ?? 'Shared plan'} · SF Housing Simulator`);

  async function reloadManifest() {
    return (await loadManifest(data.plan.datasetVersion, data.currentDatasetVersion)).manifest;
  }

  // Ruling 7: hand the remix to `/` via history state; the plan rides along only when the
  // localStorage write failed.
  function remix() {
    const { planText, stored } = remixToLocal(data.plan, data.currentDatasetVersion, getStorage());
    const from = data.plan.title ?? data.id;
    void goto('/', { state: { sfhRemix: stored ? { from } : { from, plan: planText } } });
  }

  // Map layer toggles (transit spec §6.3): the viewer's own prefs, shared with `/`. View shows only
  // when the manifest the map renders has a transit network.
  let view = $state<ViewPrefs>(readViewPrefs());
  let mapManifest = $state.raw<Manifest | null>(null);
  function onViewChange(v: ViewPrefs): void {
    view = v;
    writeViewPrefs(v);
  }
  useHeaderActions(headerActions, { pinned: scoreBar });

  // The dock, as on `/` (sim-ux plan 5): it opens on the read-only Paint tab (the heights it paints, no
  // tools); its own collapse button and rail fold and open it, the header score flips it to
  // Results.
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

  // Score wiring, as on `/` (scoreboard spec §4.3/§4.4): the header score and the Results face.
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

{#snippet headerActions()}
  {#if mapManifest?.transit}
    <ViewMenu {view} theme={systemTheme.current} onchange={onViewChange} />
  {/if}
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
  <ScoreboardPanel score={shown} status={scoreStatus} onretry={() => brushEditor?.retryChunks()} />
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
    confirmText={() => {
      const n = localOpCount(getStorage());
      return n >= 1 ? remixConfirm(n) : null;
    }}
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
        {dock}
        {dockId}
        {dockFocus}
        {results}
      />
    {/key}
  </div>
</div>
