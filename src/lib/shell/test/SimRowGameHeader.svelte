<script lang="ts">
  // Test host: SimRowHeader (/sim's widest row) with a game provided, so the level cell and
  // "Level up" sit in the row.
  import { provideGame, type GameStore } from '$lib/game/store.svelte';
  import SimRowHeader from './SimRowHeader.svelte';

  let {
    game,
    user = null,
    touch = false
  }: { game: GameStore; user?: { handle: string } | null; touch?: boolean } = $props();
  // svelte-ignore state_referenced_locally
  provideGame(game);
</script>

<SimRowHeader {user} {touch} />
