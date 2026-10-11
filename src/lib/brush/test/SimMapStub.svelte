<script lang="ts">
  // Test double for SimMap: hands BrushEditor a recording handle at mount (no WebGL, no map).
  import { onMount } from 'svelte';
  import type { SimMapHandle } from '$lib/map/types';
  import { stubHandle } from './sim-map-stub';

  let { onready }: { onready?: (h: SimMapHandle) => void } = $props();

  onMount(() => onready?.(stubHandle));
</script>
