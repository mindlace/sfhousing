<script lang="ts">
  import { provideGame, useGame, type GameStore } from '../store.svelte';

  interface StoreHostProps {
    /** Given: provideGame(store) at init. Omitted: no provider. */
    store?: GameStore;
    /** Nothing is rendered; kept so callers say what they show. */
    show: 'none';
    /** Called once at init with useGame(). */
    onuse?: (game: GameStore) => void;
    /** Each Escape keydown that reaches window (svelte:window). */
    onescape?: () => void;
  }

  // eslint-disable-next-line svelte/no-unused-props
  let { store, onuse, onescape }: StoreHostProps = $props();

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
