<script lang="ts">
  // Test host: BrushEditor in a map region with a height, as `/` lays it out, so the dock's
  // phone sheet sits at the region's bottom on screen. `editor()` is the BrushEditor instance.
  import type { ComponentProps } from 'svelte';
  import BrushEditor from '../BrushEditor.svelte';

  let props: ComponentProps<typeof BrushEditor> = $props();
  let inner = $state<ReturnType<typeof BrushEditor>>();

  export function editor(): ReturnType<typeof BrushEditor> | undefined {
    return inner;
  }
</script>

<div id="map-region" class="relative" style="height: 600px">
  <BrushEditor bind:this={inner} {...props} />
</div>
