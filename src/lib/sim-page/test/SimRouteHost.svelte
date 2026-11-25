<script lang="ts">
  // Test host: SimRoute in edit mode (no game provided, so the open game: no game parts), with the
  // root layout's header slots rendered beside it, so the score bar (the header's pinned item) and
  // its details are reachable.
  import type { ComponentProps } from 'svelte';
  import { provideHeaderActions } from '$lib/shell/header-actions.svelte';
  import SimRoute from '../SimRoute.svelte';

  let {
    data,
    initialFrame = undefined
  }: {
    data: ComponentProps<typeof SimRoute>['data'];
    initialFrame?: ComponentProps<typeof SimRoute>['initialFrame'];
  } = $props();
  const slot = provideHeaderActions();
</script>

<div class="relative flex h-12 items-center gap-2">
  <div data-testid="header-status">{@render slot.status?.()}</div>
  <div data-testid="header-pinned">{@render slot.pinned?.()}</div>
  <div data-testid="header-actions">{@render slot.current?.()}</div>
</div>
<SimRoute {data} mode="edit" persist="restore" {initialFrame} />
