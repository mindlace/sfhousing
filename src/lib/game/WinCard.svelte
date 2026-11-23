<script lang="ts">
  import { onMount } from 'svelte';
  import { BUTTON, BUTTON_PRIMARY, SURFACE_POP } from '$lib/shell/ui';
  import AccountOffer from './AccountOffer.svelte';
  import { useGame } from './store.svelte';

  interface WinCardProps {
    /** 'Room for 82,069 homes' | 'Goal reached in Mar 2049'. */
    title: string;
    /** What levelling up unlocks, in words; null when the round is complete. */
    unlocks: string | null;
    onlevelup: () => void;
    onkeep: () => void;
  }

  let { title, unlocks, onlevelup, onkeep }: WinCardProps = $props();

  const game = useGame();
  const titleId = $props.id();
  let levelUpButton: HTMLButtonElement | undefined = $state();
  let keepButton: HTMLButtonElement | undefined = $state();

  onMount(() => {
    (levelUpButton ?? keepButton)?.focus();
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onkeep();
  }
</script>

{#if !game.open}
  <!-- Escape is handled for focus inside the card; the dialog itself is not a tab stop. -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    role="dialog"
    aria-modal="false"
    aria-labelledby={titleId}
    data-testid="win-card"
    class="{SURFACE_POP} flex w-72 max-w-full flex-col gap-3"
    onkeydown={onKeydown}
  >
    <h2 id={titleId} class="text-base font-semibold">{title}</h2>
    {#if unlocks !== null}
      <p>Unlocks: {unlocks}</p>
    {:else}
      <p>Round complete</p>
    {/if}
    <div class="flex flex-wrap gap-2">
      {#if unlocks !== null}
        <button type="button" class={BUTTON_PRIMARY} onclick={onlevelup} bind:this={levelUpButton}>
          Level up
        </button>
      {/if}
      <button type="button" class={BUTTON} onclick={onkeep} bind:this={keepButton}>
        Keep playing
      </button>
    </div>
    <AccountOffer />
  </div>
{/if}
