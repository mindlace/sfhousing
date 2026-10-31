<script lang="ts">
  import { createRawSnippet } from 'svelte';
  import { provideHeaderActions } from '../header-actions.svelte';
  import ActionsChild from './ActionsChild.svelte';

  let {
    showA = true,
    showB = false,
    pinnedA,
    pinnedB,
    statusA,
    statusB,
    shared = false
  }: {
    showA?: boolean;
    showB?: boolean;
    pinnedA?: string;
    pinnedB?: string;
    statusA?: string;
    statusB?: string;
    /** A and B register one snippet object (two instances of one component, as FzpMode's). */
    shared?: boolean;
  } = $props();
  const slot = provideHeaderActions();
  const one = createRawSnippet(() => ({ render: () => '<button>Shared</button>' }));
</script>

<div data-testid="slot">{@render slot.current?.()}</div>
<div data-testid="pinned">{@render slot.pinned?.()}</div>
<div data-testid="status">{@render slot.status?.()}</div>
{#if showA}<ActionsChild
    label="A"
    pinned={pinnedA}
    status={statusA}
    shared={shared ? one : undefined}
  />{/if}
{#if showB}<ActionsChild
    label="B"
    pinned={pinnedB}
    status={statusB}
    shared={shared ? one : undefined}
  />{/if}
