<script lang="ts">
  import { provideHeaderActions } from '../header-actions.svelte';
  import ActionsChild from './ActionsChild.svelte';

  let { showA = true, showB = false }: { showA?: boolean; showB?: boolean } = $props();
  const slot = provideHeaderActions();
</script>

<div data-testid="slot">{@render slot.current?.()}</div>
{#if showA}<ActionsChild label="A" />{/if}
{#if showB}<ActionsChild label="B" />{/if}
