<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import { provideGame, type GameStore } from '../../store.svelte';
  import Tally from '../Tally.svelte';

  interface TallyHostProps {
    /** Given: provideGame(store) at init. */
    store?: GameStore;
    tally: ComponentProps<typeof Tally>;
    /** Each Escape keydown that reaches window (svelte:window). */
    onescape?: () => void;
  }

  let { store, tally, onescape }: TallyHostProps = $props();

  // svelte-ignore state_referenced_locally
  if (store) provideGame(store);

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') onescape?.();
  }
</script>

<svelte:window {onkeydown} />

<Tally {...tally} />
