<script lang="ts">
  // Test host: SiteHeader on /sim with the real GoalHeadline pinned, plus an area outside the
  // header. Pins where the headline's root nodes sit (in the pinned box).
  import type { ComponentProps } from 'svelte';
  import GoalHeadline from '$lib/game/ui/GoalHeadline.svelte';
  import { provideGame, type GameStore } from '$lib/game/store.svelte';
  import SiteHeader from '../SiteHeader.svelte';

  let { game, headline }: { game: GameStore; headline: ComponentProps<typeof GoalHeadline> } =
    $props();
  // svelte-ignore state_referenced_locally
  provideGame(game);
</script>

{#snippet pinned()}
  <GoalHeadline {...headline} />
{/snippet}

<SiteHeader routeId="/sim" {pinned} />
<div data-testid="outside" style="height: 400px">Map</div>
