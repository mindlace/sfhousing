<script lang="ts">
  import { onDestroy } from 'svelte';
  import BrushEditor from '$lib/brush/BrushEditor.svelte';
  import { exposeEditorForDebug } from '$lib/brush/debug';
  import { frameLatest, type Score, type ScoreStatus } from '$lib/scoreboard';
  import Scoreboard from '$lib/scoreboard/Scoreboard.svelte';
  import { loadManifest } from '$lib/sim/manifest';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let disposeDebugEditor = () => {};
  onDestroy(() => disposeDebugEditor());
  async function reloadManifest() {
    return (await loadManifest(data.plan.datasetVersion, data.datasetVersion)).manifest;
  }

  // Scoreboard wiring (scoreboard spec §4.3/§4.4), separate from the editor/plan concern above.
  let brushEditor = $state<ReturnType<typeof BrushEditor>>();
  // Score and its diff's `complete` travel together, coalesced to ≤ 1 commit per frame.
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
    datasetVersion: data.manifest?.datasetVersion ?? data.datasetVersion,
    builtAt: data.manifest?.builtAt ?? '',
    planDatasetVersion: data.plan.datasetVersion,
    mode: 'max'
  });
</script>

<svelte:head><title>SF Housing Simulator</title></svelte:head>

<h1 class="sr-only">SF Housing Simulator</h1>
<div id="map-region" class="relative h-full">
  <BrushEditor
    bind:this={brushEditor}
    manifest={data.manifest}
    manifestError={data.manifestError}
    plan={data.plan}
    currentVersion={data.datasetVersion}
    {reloadManifest}
    oneditor={(e) => (disposeDebugEditor = exposeEditorForDebug(e))}
    onscore={(s, meta) => latestScore.push({ score: s, complete: meta.complete })}
    onchunks={(c) => (chunkState = c)}
  />
  <Scoreboard
    score={latestScore.current.score}
    status={scoreStatus}
    onretry={() => brushEditor?.retryChunks()}
    onsheetchange={(open, h) => brushEditor?.setSheetInset(open ? h : null)}
  />
</div>
