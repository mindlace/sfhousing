<script lang="ts">
  // A published /sim policy, read-only (plan 5, Task 6; spec §4.7 as /p/[id]): the banner above
  // the map with Remix and Your game, then the shared /sim body in view mode (no editing, no
  // autosave, no Publish). The load opened the document (timeline-ui Task 15, R-4). Remix makes a
  // saved game holding the opened document and loads /sim (game-shell, sec-design-remix).
  import { onMount } from 'svelte';
  import { needsHigher, simLocked } from '$lib/game/allowed';
  import { STORAGE_TEXT } from '$lib/game/copy';
  import { gamePath, loadPage, remixPath } from '$lib/game/navigate';
  import { MAX_SAVES } from '$lib/game/saves';
  import { useGame } from '$lib/game/store.svelte';
  import { REMIX_LATER, copyFor, remixNeeds } from '$lib/sharing/copy';
  import SharedBanner, { type RemixState } from '$lib/sharing/SharedBanner.svelte';
  import type { LocalPlanRecord } from '$lib/sharing/storage';
  import SimRoute from '$lib/sim-page/SimRoute.svelte';
  import { createSimCodec4 } from '$lib/timeline/sim-doc4';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const SIM = copyFor('sim');
  const OG_DESCRIPTION =
    'A housing policy for San Francisco, run through the simulation lot by lot. Open it to see how many homes it adds against the goal.';

  const heading = $derived(data.doc.title ?? 'Shared policy');
  const pageTitle = $derived(`${heading} · SF Housing Simulator`);

  const game = useGame();
  let mounted = $state(false);
  onMount(() => {
    mounted = true;
  });
  /** Why the last Remix failed; null when it did not. */
  let error = $state<string | null>(null);
  /** Set once a Remix succeeded: the page is loading /sim, so a second press does nothing. */
  let leaving = false;

  const remixState: RemixState = $derived.by(() => {
    if (!mounted) return { kind: 'ready', note: null };
    if (game.open) return null;
    if (simLocked(game.progress)) return { kind: 'locked' };
    if (game.saves.length >= MAX_SAVES) return { kind: 'full' };
    const need = data.opened ? needsHigher(data.opened.doc.policy, game.progress) : null;
    return {
      kind: 'ready',
      note: need === null ? null : need === 6 ? REMIX_LATER : remixNeeds(need)
    };
  });
  const gameHref = $derived(mounted ? gamePath(game.progress.level) : '/');

  function remix(): void {
    if (leaving || remixState?.kind !== 'ready') return;
    const cal = data.calibration;
    let plan = data.doc.text;
    if (data.opened && cal) {
      const codec = createSimCodec4({ asOf: cal.asOf, calibration: cal });
      plan = codec.serialize(codec.rebase(data.opened.doc, data.currentDatasetVersion));
    }
    const record = JSON.stringify({
      v: 1,
      savedAt: new Date().toISOString(),
      plan
    } satisfies LocalPlanRecord);
    const r = game.remix({ kind: 'sim', record, title: data.doc.title ?? SIM.untitled });
    if (r.ok) {
      leaving = true;
      error = null;
      loadPage(remixPath('sim'));
    } else error = r.reason === 'storage' ? STORAGE_TEXT : null;
  }
</script>

<svelte:head>
  <title>{pageTitle}</title>
  <meta property="og:title" content={pageTitle} />
  <meta property="og:description" content={OG_DESCRIPTION} />
  <meta property="og:url" content="https://sfhousing.mindlace.net/s/{data.id}" />
</svelte:head>

<h1 class="sr-only">{heading}</h1>
<div class="flex h-full flex-col">
  <SharedBanner
    title={data.doc.title}
    id={data.id}
    createdAt={data.createdAt}
    datasetNotice={data.datasetNotice}
    planVersion={data.doc.datasetVersion}
    currentVersion={data.currentDatasetVersion}
    kind="sim"
    remix={remixState}
    {error}
    {gameHref}
    onremix={remix}
  />
  <div class="relative min-h-0 flex-1">
    <SimRoute
      {data}
      mode="view"
      persist="off"
      initialText={data.doc.text}
      opened={data.opened}
      upgradedFrom={data.upgradedFrom}
    />
  </div>
</div>
