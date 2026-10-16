<script lang="ts">
  // Test double for SimMap: hands BrushEditor a recording handle at mount (no WebGL, no map).
  import { onMount } from 'svelte';
  import type { SimMapHandle, SimMapProps } from '$lib/map/types';
  import { stubHandle, stubProps } from './sim-map-stub';

  let { onready, view }: { onready?: (h: SimMapHandle) => void; view?: SimMapProps['view'] } =
    $props();

  $effect.pre(() => {
    stubProps.view = view && { ...view };
  });
  onMount(() => onready?.(stubHandle));
</script>
