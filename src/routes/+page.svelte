<script lang="ts">
  import { onMount } from 'svelte';
  import { useGame, type StoreChange } from '$lib/game/store.svelte';
  import type { CameraFrame } from '$lib/map/types';
  import { SITE_NAME } from '$lib/shell/name';
  import PaintOpening from '$lib/shell/PaintOpening.svelte';
  import SimRoute from '$lib/sim-page/SimRoute.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const game = useGame();
  let mounted = $state(false);
  onMount(() => (mounted = true));
  /** The opening's camera, handed to the simulation's map at Start; undefined after a load. */
  let frame = $state<CameraFrame | undefined>();
  const body = $derived(
    !mounted ? 'pending' : game.open || game.state.phase === 'runs' ? 'sim' : 'opening'
  );

  function start(f: CameraFrame | null): StoreChange {
    frame = f ?? undefined;
    return game.startRuns();
  }
</script>

<svelte:head><title>{SITE_NAME}</title></svelte:head>
<h1 class="sr-only">{SITE_NAME}</h1>
{#if body === 'pending'}
  <div id="map-region" class="relative h-full" data-testid="home-frame"></div>
{:else if body === 'sim'}
  <SimRoute {data} mode="edit" persist="restore" initialFrame={frame} />
{:else}
  <PaintOpening {data} onstart={start} />
{/if}
