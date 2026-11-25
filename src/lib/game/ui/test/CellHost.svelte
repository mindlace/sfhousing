<script lang="ts">
  // Test host: the cell in a positioned header (or in a stand-in Menu box under it), and an area
  // outside to press.
  import { provideGame, type GameStore } from '../../store.svelte';
  import GameCell from '../GameCell.svelte';

  interface CellHostProps {
    /** provideGame(game) at init. */
    game: GameStore;
    inMenu: boolean;
    /** Each Escape keydown that reaches window. */
    onescape?: () => void;
  }

  let { game, inMenu, onescape }: CellHostProps = $props();

  // Init-time only, as a page's script would do it.
  // svelte-ignore state_referenced_locally
  provideGame(game);

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') onescape?.();
  }
</script>

<svelte:window {onkeydown} />

<header class="relative flex h-12 items-center gap-2 px-4">
  <span style="width: 12rem">Site name</span>
  {#if !inMenu}<GameCell {inMenu} />{/if}
</header>
{#if inMenu}
  <div data-testid="menu-box" class="flex flex-col items-start gap-2 p-4">
    <GameCell {inMenu} />
  </div>
{/if}
<div data-testid="outside" style="height: 400px">Map</div>
