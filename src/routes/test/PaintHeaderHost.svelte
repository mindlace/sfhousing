<script lang="ts">
  // Test host: the real site header, filled from the main page through the header slots, with
  // the game store provided (default: a new game in the opening).
  import type { ComponentProps } from 'svelte';
  import { provideGame, type GameStore } from '$lib/game/store.svelte';
  import { provideHeaderActions } from '$lib/shell/header-actions.svelte';
  import SiteHeader from '$lib/shell/SiteHeader.svelte';
  import { seededGame } from '$lib/shell/test/seeded-game';
  import Page from '../+page.svelte';

  let {
    data,
    game = seededGame().game
  }: { data: ComponentProps<typeof Page>['data']; game?: GameStore } = $props();
  const slot = provideHeaderActions();
  // The store is fixed for the host's life, as the root layout's is.
  // svelte-ignore state_referenced_locally
  provideGame(game);
</script>

<SiteHeader
  routeId="/"
  actions={slot.current ?? undefined}
  pinned={slot.pinned ?? undefined}
  status={slot.status ?? undefined}
/>
<Page {data} params={{}} />
