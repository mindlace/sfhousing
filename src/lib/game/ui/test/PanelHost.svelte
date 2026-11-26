<script lang="ts">
  import { provideGame, type GameStore } from '../../store.svelte';
  import GamePanel from '../GamePanel.svelte';

  interface PanelHostProps {
    /** provideGame(game) at init. */
    game: GameStore;
    /** Each Escape keydown that reaches window (svelte:window). */
    onescape?: () => void;
  }

  let { game, onescape }: PanelHostProps = $props();

  // Init-time only, as a page's script would do it.
  // svelte-ignore state_referenced_locally
  provideGame(game);

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') onescape?.();
  }
</script>

<svelte:window {onkeydown} />

<GamePanel />
