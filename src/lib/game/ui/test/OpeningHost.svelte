<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import { provideGame, type GameStore } from '../../store.svelte';
  import OpeningCard from '../OpeningCard.svelte';

  interface OpeningHostProps {
    /** Given: provideGame(store) at init. */
    store?: GameStore;
    card: ComponentProps<typeof OpeningCard>;
    /** Each Escape keydown that reaches window (svelte:window). */
    onescape?: () => void;
  }

  let { store, card, onescape }: OpeningHostProps = $props();

  // svelte-ignore state_referenced_locally
  if (store) provideGame(store);

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') onescape?.();
  }
</script>

<svelte:window {onkeydown} />

<OpeningCard {...card} />
