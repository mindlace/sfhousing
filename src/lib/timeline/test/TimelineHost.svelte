<!-- Test host: a Timeline with placeholder Playhead and chart parts, and no goal step
     (Timeline.svelte.spec.ts). The pinned block's reported height shows as data-pin-height on a
     box that is no box. -->
<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import Timeline from '../Timeline.svelte';

  let props: Omit<
    ComponentProps<typeof Timeline>,
    'playhead' | 'chart' | 'goalShown' | 'pinHeight'
  > = $props();
  let pinHeight = $state(0);
</script>

<div class="contents" data-testid="host-pin" data-pin-height={pinHeight}>
  <Timeline {...props} goalShown={false} bind:pinHeight>
    {#snippet playhead()}
      <div data-testid="ph-part" style="grid-column: 1 / -1">playhead</div>
    {/snippet}
    {#snippet chart()}
      <div data-testid="chart-part">chart</div>
    {/snippet}
  </Timeline>
</div>
