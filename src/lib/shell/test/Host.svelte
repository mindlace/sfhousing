<script lang="ts">
  import { provideHeaderActions } from '../header-actions.svelte';
  import ActionsChild from './ActionsChild.svelte';

  let {
    showA = true,
    showB = false,
    pinnedA,
    pinnedB,
    statusA,
    statusB
  }: {
    showA?: boolean;
    showB?: boolean;
    pinnedA?: string;
    pinnedB?: string;
    statusA?: string;
    statusB?: string;
  } = $props();
  const slot = provideHeaderActions();
</script>

<div data-testid="slot">{@render slot.current?.()}</div>
<div data-testid="pinned">{@render slot.pinned?.()}</div>
<div data-testid="status">{@render slot.status?.()}</div>
{#if showA}<ActionsChild label="A" pinned={pinnedA} status={statusA} />{/if}
{#if showB}<ActionsChild label="B" pinned={pinnedB} status={statusB} />{/if}
