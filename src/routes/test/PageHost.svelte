<script lang="ts">
  // Test host: the main page with the root layout's header-actions, pinned and status slots
  // rendered beside it, and the game store provided when one is given.
  import type { ComponentProps } from 'svelte';
  import { provideGame, type GameStore } from '$lib/game/store.svelte';
  import { provideHeaderActions } from '$lib/shell/header-actions.svelte';
  import Page from '../+page.svelte';

  let { data, game }: { data: ComponentProps<typeof Page>['data']; game?: GameStore } = $props();
  const slot = provideHeaderActions();
  // The store is fixed for the host's life, as the root layout's is.
  // svelte-ignore state_referenced_locally
  if (game) provideGame(game);
</script>

<div data-testid="header-pinned">{@render slot.pinned?.()}</div>
<div data-testid="header-actions">{@render slot.current?.()}</div>
<div data-testid="header-status">{@render slot.status?.()}</div>
<Page {data} params={{}} />
