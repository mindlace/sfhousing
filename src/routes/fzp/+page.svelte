<script lang="ts">
  // /fzp (spec §4.1, §4.2, §4.7): the Family Zoning Plan timelapse. The seed lives in the URL;
  // unknown query parameters are kept (the T9 seam).
  import { afterNavigate, replaceState } from '$app/navigation';
  import FzpMode from '$lib/fzp/FzpMode.svelte';
  import { reloadScenario } from '$lib/fzp/load';
  import { searchWithSeed } from '$lib/fzp/seed';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  function writeSeed(seed: number | null): void {
    try {
      replaceState(searchWithSeed(location.search, seed) || location.pathname, {});
    } catch (e) {
      console.error('[fzp] could not update the URL', e);
    }
  }

  // Not onMount: on the first load the router is not ready for replaceState until hydration ends.
  afterNavigate(() => {
    if (data.seedInvalid) writeSeed(null);
  });
</script>

<svelte:head><title>Family Zoning Plan timelapse · SF Housing Simulator</title></svelte:head>

<h1 class="sr-only">Family Zoning Plan timelapse (simulation)</h1>
<div id="map-region" class="relative h-full">
  <!-- A new load run (a navigation within /fzp, e.g. the header's Timelapse link from ?seed=N)
       remounts FzpMode, so the future shown always matches the URL. replaceState (reroll, seed
       clean-up) does not rerun the load, so it never remounts. -->
  {#key data}
    <FzpMode
      manifest={data.manifest}
      manifestError={data.manifestError}
      calibration={data.calibration}
      calibrationError={data.calibrationError}
      noScenario={data.noScenario}
      datasetVersion={data.datasetVersion}
      urlSeed={data.seed}
      reload={() => reloadScenario(data.datasetVersion)}
      onurlseed={writeSeed}
    />
  {/key}
</div>
