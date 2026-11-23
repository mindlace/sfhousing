<script lang="ts">
  // Test host: the /sim page's body under a provided game, with the root layout's header slots
  // rendered beside it. The game and the page's autosave share one storage.
  import type { ComponentProps } from 'svelte';
  import { provideGame, type GameStore } from '$lib/game/store.svelte';
  import { provideHeaderActions } from '$lib/shell/header-actions.svelte';
  import SimRoute from '$lib/sim-page/SimRoute.svelte';

  let {
    data,
    game,
    storage
  }: { data: ComponentProps<typeof SimRoute>['data']; game: GameStore; storage: Storage } =
    $props();
  // svelte-ignore state_referenced_locally
  provideGame(game);
  const slot = provideHeaderActions();
</script>

<div class="relative flex h-12 items-center gap-2">
  <div data-testid="header-status">{@render slot.status?.()}</div>
  <div data-testid="header-pinned">{@render slot.pinned?.()}</div>
  <div data-testid="header-actions">{@render slot.current?.()}</div>
</div>
<SimRoute {data} mode="edit" persist="restore" storage={() => storage} />
