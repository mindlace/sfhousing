<script lang="ts">
  // /sim (spec §4.1, §4.2, §4.7; plan 3): the policy simulation, and /fzp's timelapse under
  // `start=fzp`. The seed lives in the URL; unknown query parameters are kept (the T9 seam).
  import { afterNavigate, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { reloadScenario } from '$lib/fzp/load';
  import { addressSearch, addressSeed, searchWithSeed } from '$lib/fzp/seed';
  import SimPage from '$lib/sim-page/SimPage.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  /**
   * The seed SimPage mounts with: the load's, unless after a navigation the address bar named
   * another one. `data` identity tells the two apart.
   */
  let mount = $state.raw<{ data: typeof data; seed: number | null; n: number } | null>(null);
  const urlSeed = $derived(mount !== null && mount.data === data ? mount.seed : data.seed);
  /** The future on show: the mounted seed, then each reroll answer's (what the URL now names). */
  let shown: number | null = null;
  let shownFor: typeof data | null = null;

  function writeSeed(seed: number | null): void {
    shown = seed;
    try {
      replaceState(searchWithSeed(addressSearch(), seed) || location.pathname, {});
    } catch (e) {
      console.error('[sim] could not update the URL', e);
    }
  }

  // Not onMount: on the first load the router is not ready for replaceState until hydration ends.
  afterNavigate(() => {
    if (data !== shownFor) {
      // A new load result (the first mount, or a navigation that reran the load): `{#key data}`
      // mounted SimPage with its seed.
      shownFor = data;
      shown = data.seed;
    }
    // SvelteKit's URLs predate replaceState: a link to /sim after a reroll to ?seed=N skips the
    // load, and Back or Forward onto a rerolled entry navigates to (and loads) the URL stored
    // before the reroll. The address bar is the truth, so compare it with the future on show.
    const { seed, invalid } = addressSeed();
    if (seed !== shown) {
      shown = seed;
      mount = { data, seed, n: (mount?.n ?? 0) + 1 };
    }
    if (invalid) writeSeed(null);
  });
</script>

<svelte:head><title>Policy simulation · SF Housing Simulator</title></svelte:head>

<h1 class="sr-only">Housing policy simulation</h1>
<div id="map-region" class="relative h-full">
  <!-- SimPage remounts on a new load result, and after any navigation (link, Back, Forward)
       whose address bar names another future than the one on show. A replaceState itself
       (reroll, seed clean-up) fires no navigation, so it never remounts. -->
  {#key data}
    {#key mount?.n}
      <SimPage
        manifest={data.manifest}
        manifestError={data.manifestError}
        calibration={data.calibration}
        calibrationError={data.calibrationError}
        noScenario={data.noScenario}
        datasetVersion={data.datasetVersion}
        start={data.start}
        persist={data.start === 'fzp' ? 'deferred' : 'restore'}
        remix={page.state.sfhSimRemix}
        {urlSeed}
        reload={() => reloadScenario(data.datasetVersion)}
        onurlseed={writeSeed}
      />
    {/key}
  {/key}
</div>
