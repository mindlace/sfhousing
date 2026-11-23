<script module lang="ts">
  import { M1_TARGETS, score as computeScore } from '$lib/scoreboard';
  /** The score before the worker's first diff. */
  const EMPTY = computeScore([], M1_TARGETS);
</script>

<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { goto } from '$app/navigation';
  import BrushEditor from '$lib/brush/BrushEditor.svelte';
  import { exposeEditorForDebug } from '$lib/brush/debug';
  import type { Editor } from '$lib/brush/editor.svelte';
  import type { Manifest } from '$lib/data/manifest';
  import { DockState } from '$lib/dock/dock-state.svelte';
  import { simLocked } from '$lib/game/allowed';
  import { unlockText } from '$lib/game/copy';
  import { e2eGoalAmount } from '$lib/game/e2e';
  import { paintWon } from '$lib/game/levels';
  import { useGame } from '$lib/game/store.svelte';
  import WinCard from '$lib/game/WinCard.svelte';
  import { GOAL_BASE } from '$lib/goal/goal';
  import { paintHeadline, roomFor } from '$lib/paint/headline';
  import PaintDetails from '$lib/paint/PaintDetails.svelte';
  import { frameLatest, viewState, type Score, type ScoreStatus } from '$lib/scoreboard';
  import { Autosave } from '$lib/sharing/autosave.svelte';
  import { COPY, n3 } from '$lib/sharing/copy';
  import NoticeStack from '$lib/sharing/NoticeStack.svelte';
  import { PLAN_CODEC } from '$lib/sharing/doc-codec';
  import PublishButton from '$lib/sharing/PublishButton.svelte';
  import SaveIndicator from '$lib/sharing/SaveIndicator.svelte';
  import { getStorage } from '$lib/sharing/storage';
  import { applyTitle } from '$lib/sharing/title';
  import { useHeaderActions } from '$lib/shell/header-actions.svelte';
  import { loadManifest } from '$lib/sim/manifest';
  import { headlineSpoken } from '$lib/timeline/results';
  import TimelineHeaderScore from '$lib/timeline/TimelineHeaderScore.svelte';
  import { readViewPrefs, writeViewPrefs, type ViewPrefs } from '$lib/view/prefs';
  import LayerSwitches from '$lib/view/LayerSwitches.svelte';
  import { useSystemTheme } from '$lib/map/system-theme.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let disposeDebugEditor = () => {};
  onDestroy(() => disposeDebugEditor());
  async function reloadManifest() {
    return (await loadManifest(data.plan.datasetVersion, data.datasetVersion)).manifest;
  }

  // Plan sharing (spec §4.5/§4.6): restore the autosaved plan on mount (ruling 6), autosave every
  // committed change, notices N1–N3, and Publish + Saved in the header. A remixed plan arrives
  // as the current game's plan record.
  type Notice = { id: string; text: string; tone?: 'info' | 'toast' };
  // The dataset version is fixed for the page's life.
  // svelte-ignore state_referenced_locally
  const autosave = new Autosave({ currentVersion: data.datasetVersion });
  let editor = $state.raw<Editor>();
  let notices = $state<Notice[]>([]);
  const game = useGame();

  function onEditor(e: Editor): void {
    disposeDebugEditor = exposeEditorForDebug(e);
    editor = e;
  }

  // Runs after BrushEditor's own onMount (children mount first): its onLoad hook posts the
  // restored plan if the worker is ready, else the worker's onReady sends editor.plan.
  onMount(() => {
    mounted = true;
    goalAmount = e2eGoalAmount(getStorage()) ?? GOAL_BASE.amount;
    if (!editor) return;
    const r = autosave.restore();
    editor.load(r.plan);
    if (r.notice?.kind === 'corrupt') notices.push({ id: 'n1', text: COPY.n1 });
    else if (r.notice?.kind === 'future') notices.push({ id: 'n2', text: COPY.n2 });
    else if (r.notice?.kind === 'rebased')
      notices.push({ id: 'n3', text: n3(r.notice.from, r.notice.to) });
    const detach = autosave.attach();
    // Before the game changes, the plan still in the debounce is written to its record.
    const offLeave = game.beforeLeave(() => autosave.flush());
    return () => {
      offLeave();
      detach();
    };
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

  useHeaderActions(headerActions, { pinned: scoreBar, status: saveState });

  // The dock (sim-ux plan 5): the Paint tab, open on the left of the map from md (folding to a
  // rail), a bottom sheet behind its handle below md. Its own collapse button and rail (the
  // handle below md) fold and open it; the header score flips it to its Details face
  // (PaintDetails) and back.
  const wide = new MediaQuery('(min-width: 768px)');
  const uid = $props.id();
  const dockId = `${uid}-dock`;
  const dock = new DockState({ tab: 'paint' });
  /** The user opened the dock (the score): focus moves in. False for the default open. */
  let dockFocus = $state(false);

  /** The header score: Details <-> the Paint tab, opening the dock if it is hidden. */
  function pressScore(): void {
    dockFocus = true;
    dock.toggleResults(wide.current);
  }

  // Map layer toggles (transit spec §6.3), per viewer, in the map toolbar's Layers panel. Layers
  // shows only when the manifest the map renders (BrushEditor's own, which a Retry can replace)
  // has a transit network.
  let view = $state<ViewPrefs>(readViewPrefs());
  let mapManifest = $state.raw<Manifest | null>(null);
  function onViewChange(v: ViewPrefs): void {
    view = v;
    writeViewPrefs(v);
  }

  // Score wiring (scoreboard spec §4.3/§4.4), separate from the editor/plan concern above: the
  // header score and the dock's Details face (sim-ux spec Goal 5).
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
    // The header score (in the layout) reads this, and a client navigation away updates `data`
    // to the next page's before this page unmounts: that data may have no `plan`.
    planDatasetVersion: data.plan?.datasetVersion ?? data.datasetVersion,
    mode: 'max'
  });
  const shown = $derived(latestScore.current.score ?? EMPTY);
  const scoreView = $derived(viewState(shown, scoreStatus));
  /** Read once on mount (the e2e seam needs the browser's storage). */
  let goalAmount = $state(GOAL_BASE.amount);
  const goal = $derived({ ...GOAL_BASE, amount: goalAmount });
  const headText = $derived(paintHeadline(shown.netUnits, goal));
  const systemTheme = useSystemTheme();

  // Paint's win (game-shell spec): at level 1 the latest complete score at the goal wins. A score
  // that is not complete (a stroke, the worker filling) leaves the won state as it is.
  let mounted = $state(false);
  /** The net homes of the latest complete score; null before the first. */
  let completeNet = $state<number | null>(null);
  /** A pointer button is down on the page (window events; never rendered). */
  let held = false;
  /** This page set the store's offer. */
  let offered = false;

  const locked = $derived(mounted && !game.open && simLocked(game.progress));
  const won = $derived(locked && completeNet !== null && paintWon(completeNet, goal.amount));
  /** "Keep playing" or Escape; false again whenever Paint starts or stops being won. */
  let kept = $derived.by(() => {
    void won;
    return false;
  });
  /** The card is mounted; false again whenever Paint starts or stops being won. */
  let cardOpen = $derived.by(() => {
    void won;
    return false;
  });

  /** Opens the card when Paint is won, not kept, not open, and no pointer is held. */
  function maybeOpen(): void {
    if (!won || kept || cardOpen || held) return;
    cardOpen = true;
    game.won();
  }

  /** Judged here, before frameLatest coalesces, so no complete score is lost to a frame. */
  function onScore(s: Score, meta: { complete: boolean }): void {
    latestScore.push({ score: s, complete: meta.complete });
    if (!meta.complete) return;
    completeNet = s.netUnits;
    maybeOpen();
  }

  function release(): void {
    held = false;
    maybeOpen();
  }

  async function keep(): Promise<void> {
    kept = true;
    cardOpen = false;
    await tick();
    document.querySelector<HTMLElement>('[data-testid="score-bar"]')?.focus();
  }

  // The offer follows `won`; it reads only `won`, writes only the store and `offered`.
  $effect(() => {
    if (won) {
      untrack(() => game.setOffer({ on: null, datasetVersion: data.datasetVersion }));
      offered = true;
    } else if (offered) {
      untrack(() => game.setOffer(null));
      offered = false;
    }
  });
  onDestroy(() => {
    if (offered) game.setOffer(null);
  });

  // Leaving level 1 (the card's or the level panel's Level up): on to the simulation.
  let lockedBefore = false;
  $effect(() => {
    const now = locked;
    if (lockedBefore && !now) untrack(() => void goto('/sim'));
    lockedBefore = now;
  });

  // Each autosave write of the plan record touches the current game.
  let statusBefore = autosave.status;
  $effect(() => {
    const status = autosave.status;
    if (statusBefore === 'saving' && status === 'saved') untrack(() => game.touched());
    statusBefore = status;
  });
</script>

{#snippet scoreBar()}
  <!-- Room for homes and its share of the goal: undated, no effect line. -->
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

{#snippet noticeStack()}
  <NoticeStack {notices} ondismiss={(id) => (notices = notices.filter((n) => n.id !== id))} />
  {#if cardOpen}
    <!-- The stack lets clicks through; the card takes them. -->
    <div data-testid="paint-win" class="pointer-events-auto">
      <WinCard
        title={roomFor(goal.amount)}
        unlocks={unlockText(2)}
        onlevelup={() => game.levelUp()}
        onkeep={keep}
      />
    </div>
  {/if}
{/snippet}

{#snippet layerSwitches()}
  <LayerSwitches {view} theme={systemTheme.current} onchange={onViewChange} />
{/snippet}

{#snippet headerActions()}
  {#if editor}
    <!-- editor.plan passes straight through: PublishDialog's 413 lock keys on its identity. -->
    <PublishButton
      codec={PLAN_CODEC}
      doc={editor.plan}
      lastPublished={autosave.lastPublished}
      onpublished={onPublished}
    />
  {/if}
{/snippet}

{#snippet saveState()}
  <SaveIndicator status={autosave.status} align="start" />
{/snippet}

<svelte:head><title>SF Housing Simulator</title></svelte:head>
<svelte:window
  onpointerdown={() => (held = true)}
  onpointerup={release}
  onpointercancel={release}
/>

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
    onscore={onScore}
    onchunks={(c) => (chunkState = c)}
    {view}
    onmanifest={(m) => (mapManifest = m)}
    layers={mapManifest?.transit ? layerSwitches : undefined}
    {dock}
    {dockId}
    {dockFocus}
    {results}
    notices={noticeStack}
  />
</div>
