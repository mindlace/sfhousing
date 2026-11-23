<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import LevelPanel from '../LevelPanel.svelte';
  import WinCard from '../WinCard.svelte';
  import { provideGame, useGame, type GameStore } from '../store.svelte';

  interface StoreHostProps {
    /** Given: provideGame(store) at init. Omitted: no provider. */
    store?: GameStore;
    show: 'panel' | 'card' | 'none';
    /** WinCard's props when show is 'card'. */
    card?: ComponentProps<typeof WinCard>;
    /** Called once at init with useGame(). */
    onuse?: (game: GameStore) => void;
    /** Each Escape keydown that reaches window (svelte:window). */
    onescape?: () => void;
  }

  let { store, show, card, onuse, onescape }: StoreHostProps = $props();

  // Init-time only, as a page's script would do it.
  // svelte-ignore state_referenced_locally
  if (store) provideGame(store);
  // svelte-ignore state_referenced_locally
  onuse?.(useGame());

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') onescape?.();
  }
</script>

<svelte:window {onkeydown} />

{#if show === 'panel'}
  <LevelPanel />
{:else if show === 'card' && card}
  <WinCard {...card} />
{/if}
