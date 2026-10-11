<script lang="ts">
  import BrushEditor from '$lib/brush/BrushEditor.svelte';
  import { loadManifest } from '$lib/sim/manifest';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  async function reloadManifest() {
    return (await loadManifest(data.plan.datasetVersion, data.datasetVersion)).manifest;
  }
</script>

<svelte:head><title>SF Housing Simulator</title></svelte:head>

<h1 class="sr-only">SF Housing Simulator</h1>
<div id="map-region" class="relative h-full">
  <BrushEditor
    manifest={data.manifest}
    manifestError={data.manifestError}
    plan={data.plan}
    currentVersion={data.datasetVersion}
    {reloadManifest}
  />
</div>
