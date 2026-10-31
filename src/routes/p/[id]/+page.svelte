<script lang="ts">
  import { onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import BrushEditor from '$lib/brush/BrushEditor.svelte';
  import type { Manifest } from '$lib/data/manifest';
  import { frameLatest, type Score, type ScoreStatus } from '$lib/scoreboard';
  import Scoreboard from '$lib/scoreboard/Scoreboard.svelte';
  import { ogDescription, remixConfirm } from '$lib/sharing/copy';
  import { localOpCount, remixToLocal } from '$lib/sharing/remix';
  import SharedBanner from '$lib/sharing/SharedBanner.svelte';
  import { getStorage } from '$lib/sharing/storage';
  import { useHeaderActions } from '$lib/shell/header-actions.svelte';
  import { loadManifest } from '$lib/sim/manifest';
  import { readViewPrefs, writeViewPrefs, type ViewPrefs } from '$lib/view/prefs';
  import ViewMenu from '$lib/view/ViewMenu.svelte';
  import type { PageProps } from './$types';

  // Read-only view (spec §4.7): no oneditor, no autosave; the only header action is View. The
  // local autosaved plan is only read (op count) and written by an explicit Remix.
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
  useHeaderActions(headerActions);

  // Scoreboard wiring, as on `/` (scoreboard spec §4.3/§4.4).
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
    planDatasetVersion: data.plan.datasetVersion,
    mode: 'max'
  });
</script>

{#snippet headerActions()}
  {#if mapManifest?.transit}
    <ViewMenu {view} onchange={onViewChange} />
  {/if}
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
      />
    {/key}
    <Scoreboard
      score={latestScore.current.score}
      status={scoreStatus}
      onretry={() => brushEditor?.retryChunks()}
      onsheetchange={(open, h) => brushEditor?.setSheetInset(open ? h : null)}
    />
  </div>
</div>
