<script lang="ts">
  // Test double for SimMap on /fzp: records its props and hands FzpMode the recording handle at
  // mount (or on `stub.fireReady()` when `stub.autoReady` is false). No WebGL, no map.
  import { onMount } from 'svelte';
  import type { SimMapProps } from '$lib/map/types';
  import { stub } from './sim-map-stub';

  let props: SimMapProps = $props();

  $effect.pre(() => {
    stub.props = { ...props };
  });
  onMount(() => {
    if (stub.autoReady) props.onready?.(stub.handle);
  });
</script>

<div data-testid="fzp-sim-map-stub"></div>
