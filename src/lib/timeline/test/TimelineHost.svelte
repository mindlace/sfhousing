<!-- Test host: a Timeline with placeholder Playhead and chart parts, and no goal step
     (Timeline.svelte.spec.ts). The pinned block's reported height shows as data-pin-height on a
     box that is no box. With `height`, the timeline sits in a box that many px tall. -->
<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import Timeline from '../Timeline.svelte';

  let {
    height,
    ...props
  }: Omit<
    ComponentProps<typeof Timeline>,
    'playhead' | 'chart' | 'goalShown' | 'inForce' | 'pinHeight'
  > & {
    height?: number;
  } = $props();
  let pinHeight = $state(0);
</script>

<div
  class={height === undefined ? 'contents' : undefined}
  style:height={height === undefined ? undefined : `${height}px`}
  data-testid="host-pin"
  data-pin-height={pinHeight}
>
  <Timeline {...props} goalShown={false} inForce={false} bind:pinHeight>
    {#snippet playhead()}
      <div data-testid="ph-part" style="grid-column: 1 / -1">playhead</div>
    {/snippet}
    {#snippet chart()}
      <div data-testid="chart-part">chart</div>
    {/snippet}
  </Timeline>
</div>
