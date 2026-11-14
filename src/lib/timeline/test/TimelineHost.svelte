<!-- Test host: a Timeline with placeholder Playhead and chart parts (Timeline.svelte.spec.ts). -->
<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import Timeline from '../Timeline.svelte';

  let props: Omit<ComponentProps<typeof Timeline>, 'playhead' | 'chart'> = $props();
</script>

<Timeline {...props}>
  {#snippet playhead()}
    <div data-testid="ph-part">playhead</div>
  {/snippet}
  {#snippet chart()}
    <div data-testid="chart-part">chart</div>
  {/snippet}
</Timeline>
