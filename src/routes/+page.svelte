<script lang="ts">
  import SimMap from '$lib/map/SimMap.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head><title>SF Housing Simulator</title></svelte:head>

<h1 class="sr-only">SF Housing Simulator</h1>
<div id="map-region" class="h-full">
  <SimMap manifest={data.manifest} />
</div>
