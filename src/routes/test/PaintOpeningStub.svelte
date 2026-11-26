<script lang="ts">
  // Stands in for $lib/shell/PaintOpening.svelte: Start with FRAME, once or twice in one handler.
  import type { ComponentProps } from 'svelte';
  import type PaintOpening from '$lib/shell/PaintOpening.svelte';
  import { FRAME } from './opening-stub';

  let { onstart }: ComponentProps<typeof PaintOpening> = $props();
</script>

<button type="button" onclick={() => onstart(FRAME)}>Stub start</button>
<button
  type="button"
  onclick={() => {
    onstart(FRAME);
    onstart(FRAME);
  }}>Stub start twice</button
>
