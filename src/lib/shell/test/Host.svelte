<script lang="ts">
  import { provideHeaderActions } from '../header-actions.svelte';
  import ActionsChild from './ActionsChild.svelte';

  let {
    showA = true,
    showB = false,
    pinnedA,
    pinnedB
  }: { showA?: boolean; showB?: boolean; pinnedA?: string; pinnedB?: string } = $props();
  const slot = provideHeaderActions();
</script>

<div data-testid="slot">{@render slot.current?.()}</div>
<div data-testid="pinned">{@render slot.pinned?.()}</div>
{#if showA}<ActionsChild label="A" pinned={pinnedA} />{/if}
{#if showB}<ActionsChild label="B" pinned={pinnedB} />{/if}
