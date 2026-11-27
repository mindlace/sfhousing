<script lang="ts">
  // Test host: SiteHeader with the game provided (its game panel sits in the Menu), plus an
  // area outside the header to press.
  import type { Snippet } from 'svelte';
  import { provideGame, type GameStore } from '$lib/game/store.svelte';
  import SiteHeader from '../SiteHeader.svelte';

  interface Props {
    game: GameStore;
    routeId?: string | null;
    user?: { handle: string } | null;
    signInAvailable?: boolean;
    actions?: Snippet;
    pinned?: Snippet;
    status?: Snippet;
  }
  let {
    game,
    routeId = null,
    user = null,
    signInAvailable = true,
    actions,
    pinned,
    status
  }: Props = $props();
  // svelte-ignore state_referenced_locally
  provideGame(game);
</script>

<SiteHeader {routeId} {user} {signInAvailable} {actions} {pinned} {status} />
<div data-testid="outside" style="height: 400px">Map</div>
