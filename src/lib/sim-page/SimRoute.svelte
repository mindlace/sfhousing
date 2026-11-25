<script lang="ts">
  // The /sim route body (spec §4.1, §4.2, §4.7; plan 3; plan 5 Call 19), shared by /sim and the
  // read-only /s/<id>: SimPage, remounted on each new load result. The URL names no future (rule
  // 25, OD-4): after a navigation a `?seed=` left from an older link is dropped from the address
  // with replaceState, other parameters and the history state kept; it remounts nothing.
  //
  // The game (game-sim #sec-design-route): in edit mode the current game goes to SimPage; view
  // mode and the open game pass none. Edit mode decides nothing until mounted (the game store is
  // browser state), then renders nothing while the game is in its opening.
  import { onMount } from 'svelte';
  import { afterNavigate, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { reloadScenario } from '$lib/fzp/load';
  import { useGame } from '$lib/game/store.svelte';
  import type { CameraFrame } from '$lib/map/types';
  import { getStorage } from '$lib/sharing/storage';
  import { addressHref, withoutSeed } from '$lib/timeline/address';
  import type { SimNotice4 } from '$lib/timeline/session4';
  import type { SimDoc4 } from '$lib/timeline/sim-doc4';
  import type { SimPageData } from './load';
  import SimPage from './SimPage.svelte';

  interface Props {
    /** The load's data, with the dataset the page runs on. */
    data: SimPageData & { datasetVersion: string };
    /** 'view': a published policy, read-only. */
    mode: 'edit' | 'view';
    /** SimPage's persistence (edit: 'restore'; view: 'off'). */
    persist: 'restore' | 'off';
    /** View: the shared document's text. */
    initialText?: string;
    /** View: the shared document, already opened by the route's load (with the calibration). */
    opened?: { doc: SimDoc4; notices: SimNotice4[] } | null;
    /** View: the schema the shared document was upgraded from. */
    upgradedFrom?: number;
    /** Tests: the page's storage, shared with the game in a test (default `localStorage`). */
    storage?: () => Storage | null;
    /** The map's opening camera, passed unchanged to the page and TimelineMode. */
    initialFrame?: CameraFrame;
  }

  let {
    data,
    mode,
    persist,
    initialText = undefined,
    opened = undefined,
    upgradedFrom = undefined,
    storage = getStorage,
    initialFrame = undefined
  }: Props = $props();

  const store = useGame();
  /** The game SimPage plays; null in view mode and for the open game. */
  const game = $derived(mode === 'edit' && !store.open ? store : null);
  let mounted = $state(false);
  onMount(() => {
    mounted = true;
  });

  // Not onMount: on the first load the router is not ready for replaceState until hydration ends.
  afterNavigate(() => {
    const next = withoutSeed(addressHref());
    if (next === null) return;
    try {
      replaceState(next, $state.snapshot(page.state) as App.PageState);
    } catch (e) {
      console.error('[sim] could not update the URL', e);
    }
  });
</script>

{#snippet simPage(g: typeof game)}
  <!-- SimPage remounts on a new load result only. -->
  {#key data}
    <SimPage
      manifest={data.manifest}
      manifestError={data.manifestError}
      calibration={data.calibration}
      calibrationError={data.calibrationError}
      noScenario={data.noScenario}
      datasetVersion={data.datasetVersion}
      {mode}
      {persist}
      {initialText}
      opened={opened ?? undefined}
      {upgradedFrom}
      {storage}
      game={g}
      {initialFrame}
      reload={() => reloadScenario(data.datasetVersion)}
    />
  {/key}
{/snippet}

<div id="map-region" class="relative h-full">
  {#if mode === 'view'}
    {@render simPage(null)}
  {:else if mounted && game?.state.phase !== 'opening'}
    {@render simPage(game)}
  {/if}
</div>
