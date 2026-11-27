<script lang="ts">
  // Test host: SiteHeader on / (the simulation) with the real GoalHeadline pinned, plus an area
  // outside the header. Pins where the headline's root nodes sit (in the pinned box). With
  // `status` the header's status cell holds an "Autosave off" button.
  import type { ComponentProps } from 'svelte';
  import GoalHeadline from '$lib/game/ui/GoalHeadline.svelte';
  import { provideGame, type GameStore } from '$lib/game/store.svelte';
  import SiteHeader from '../SiteHeader.svelte';

  let {
    game,
    headline,
    status = false
  }: {
    game: GameStore;
    headline: ComponentProps<typeof GoalHeadline>;
    status?: boolean;
  } = $props();
  // svelte-ignore state_referenced_locally
  provideGame(game);
</script>

{#snippet pinned()}
  <GoalHeadline {...headline} />
{/snippet}

{#snippet statusCell()}
  <button type="button" data-testid="status-control">Autosave off</button>
{/snippet}

<SiteHeader routeId="/" {pinned} status={status ? statusCell : undefined} />
<div data-testid="outside" style="height: 400px">Map</div>
