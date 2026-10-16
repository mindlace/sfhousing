<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import BrushEditor from '$lib/brush/BrushEditor.svelte';
  import { exposeEditorForDebug } from '$lib/brush/debug';
  import type { Editor } from '$lib/brush/editor.svelte';
  import type { Manifest } from '$lib/data/manifest';
  import { frameLatest, type Score, type ScoreStatus } from '$lib/scoreboard';
  import Scoreboard from '$lib/scoreboard/Scoreboard.svelte';
  import { Autosave } from '$lib/sharing/autosave.svelte';
  import { COPY, n3, remixedToast } from '$lib/sharing/copy';
  import NoticeStack from '$lib/sharing/NoticeStack.svelte';
  import PublishButton from '$lib/sharing/PublishButton.svelte';
  import SaveIndicator from '$lib/sharing/SaveIndicator.svelte';
  import { applyTitle } from '$lib/sharing/title';
  import { useHeaderActions } from '$lib/shell/header-actions.svelte';
  import { loadManifest } from '$lib/sim/manifest';
  import { readViewPrefs, writeViewPrefs, type ViewPrefs } from '$lib/view/prefs';
  import ViewMenu from '$lib/view/ViewMenu.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let disposeDebugEditor = () => {};
  onDestroy(() => disposeDebugEditor());
  async function reloadManifest() {
    return (await loadManifest(data.plan.datasetVersion, data.datasetVersion)).manifest;
  }

  // Plan sharing (spec §4.5/§4.6): restore the autosaved plan on mount (ruling 6), autosave every
  // committed change, notices N1–N3 and the Remix toast, and Publish + Saved in the header.
  type Notice = { id: string; text: string; tone?: 'info' | 'toast' };
  // The dataset version is fixed for the page's life.
  // svelte-ignore state_referenced_locally
  const autosave = new Autosave({ currentVersion: data.datasetVersion });
  let editor = $state.raw<Editor>();
  let notices = $state<Notice[]>([]);

  function onEditor(e: Editor): void {
    disposeDebugEditor = exposeEditorForDebug(e);
    editor = e;
  }

  // Runs after BrushEditor's own onMount (children mount first): its onLoad hook posts the
  // restored plan if the worker is ready, else the worker's onReady sends editor.plan.
  onMount(() => {
    if (!editor) return;
    const remix = page.state.sfhRemix;
    const r = autosave.restore(remix?.plan);
    editor.load(r.plan);
    if (r.notice?.kind === 'corrupt') notices.push({ id: 'n1', text: COPY.n1 });
    else if (r.notice?.kind === 'future') notices.push({ id: 'n2', text: COPY.n2 });
    else if (r.notice?.kind === 'rebased')
      notices.push({ id: 'n3', text: n3(r.notice.from, r.notice.to) });
    if (remix) {
      notices.push({ id: 'remix', text: remixedToast(remix.from), tone: 'toast' });
      try {
        replaceState('', {}); // ruling 7: no re-toast on reload
      } catch (e) {
        console.error('[sharing] could not clear the remix hand-off', e);
      }
    }
    return autosave.attach();
  });

  // The restored plan serializes the same as what restore() wrote, so this first run is a no-op.
  // Only editor.plan is tracked: schedule() reads/writes autosave.status, which must not re-run this.
  $effect(() => {
    if (!editor) return;
    const plan = editor.plan;
    untrack(() => autosave.schedule(plan));
  });

  // `onpublished` may fire after the dialog closed and the user kept editing: merge only the title
  // into the current plan, and record lastPublished against that plan (a mismatched hash simply
  // makes the button read "Publish" again).
  function onPublished(r: { id: string; hash: string; plan: { title?: string } }): void {
    if (!editor) return;
    applyTitle(editor, r.plan.title);
    autosave.setLastPublished({ id: r.id, hash: r.hash }, editor.plan);
  }

  useHeaderActions(headerActions);

  // Map layer toggles (transit spec §6.3), per viewer. View shows only when the manifest the map
  // renders (BrushEditor's own, which a Retry can replace) has a transit network.
  let view = $state<ViewPrefs>(readViewPrefs());
  let mapManifest = $state.raw<Manifest | null>(null);
  function onViewChange(v: ViewPrefs): void {
    view = v;
    writeViewPrefs(v);
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

{#snippet headerActions()}
  {#if mapManifest?.transit}
    <ViewMenu {view} onchange={onViewChange} />
  {/if}
  <SaveIndicator status={autosave.status} />
  {#if editor}
    <!-- editor.plan passes straight through: PublishDialog's 413 lock keys on its identity. -->
    <PublishButton
      plan={editor.plan}
      lastPublished={autosave.lastPublished}
      onpublished={onPublished}
    />
  {/if}
{/snippet}

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
    oneditor={onEditor}
    onscore={(s, meta) => latestScore.push({ score: s, complete: meta.complete })}
    onchunks={(c) => (chunkState = c)}
    {view}
    onmanifest={(m) => (mapManifest = m)}
  />
  <Scoreboard
    score={latestScore.current.score}
    status={scoreStatus}
    onretry={() => brushEditor?.retryChunks()}
    onsheetchange={(open, h) => brushEditor?.setSheetInset(open ? h : null)}
  />
  <NoticeStack {notices} ondismiss={(id) => (notices = notices.filter((n) => n.id !== id))} />
</div>
