<script lang="ts">
  // /fzp (spec §4.1, §4.2, §4.7): the Family Zoning Plan timelapse. The seed lives in the URL;
  // unknown query parameters are kept (the T9 seam).
  import { afterNavigate, replaceState } from '$app/navigation';
  import FzpMode from '$lib/fzp/FzpMode.svelte';
  import { reloadScenario } from '$lib/fzp/load';
  import { addressSeed, searchWithSeed } from '$lib/fzp/seed';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  /**
   * The seed FzpMode mounts with: the load's, unless after a navigation the address bar named
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
      replaceState(searchWithSeed(location.search, seed) || location.pathname, {});
    } catch (e) {
      console.error('[fzp] could not update the URL', e);
    }
  }

  // Not onMount: on the first load the router is not ready for replaceState until hydration ends.
  afterNavigate(() => {
    if (data !== shownFor) {
      // A new load result (the first mount, or a navigation that reran the load): `{#key data}`
      // mounted FzpMode with its seed.
      shownFor = data;
      shown = data.seed;
    }
    // SvelteKit's URLs predate replaceState: a link to /fzp after a reroll to ?seed=N skips the
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

<svelte:head><title>Family Zoning Plan timelapse · SF Housing Simulator</title></svelte:head>

<h1 class="sr-only">Family Zoning Plan timelapse (simulation)</h1>
<div id="map-region" class="relative h-full">
  <!-- FzpMode remounts on a new load result, and after any navigation (link, Back, Forward)
       whose address bar names another future than the one on show. A replaceState itself
       (reroll, seed clean-up) fires no navigation, so it never remounts. -->
  {#key data}
    {#key mount?.n}
      <FzpMode
        manifest={data.manifest}
        manifestError={data.manifestError}
        calibration={data.calibration}
        calibrationError={data.calibrationError}
        noScenario={data.noScenario}
        datasetVersion={data.datasetVersion}
        {urlSeed}
        reload={() => reloadScenario(data.datasetVersion)}
        onurlseed={writeSeed}
      />
    {/key}
  {/key}
</div>
