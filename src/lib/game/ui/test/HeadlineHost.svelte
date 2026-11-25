<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import { provideGame, type GameStore } from '../../store.svelte';
  import GoalHeadline from '../GoalHeadline.svelte';

  interface HeadlineHostProps {
    /** Given: provideGame(store) at init. */
    store?: GameStore;
    headline: ComponentProps<typeof GoalHeadline>;
    /** Each Escape keydown that reaches window (svelte:window). */
    onescape?: () => void;
  }

  let { store, headline, onescape }: HeadlineHostProps = $props();

  // svelte-ignore state_referenced_locally
  if (store) provideGame(store);

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') onescape?.();
  }
</script>

<svelte:window {onkeydown} />

<!-- Positioned, as the site header is: the pop-over is placed against it. -->
<header class="relative flex h-12 w-full items-center justify-center">
  <GoalHeadline {...headline} />
</header>
<div data-testid="outside" class="h-40"></div>
