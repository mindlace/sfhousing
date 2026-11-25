<script lang="ts">
  import { onMount } from 'svelte';
  import { BUTTON_PRIMARY, SURFACE_POP } from '$lib/shell/ui';
  import AccountOffer from '../AccountOffer.svelte';
  import { OPENING_LINES, START, roomMet } from './words';

  interface OpeningCardProps {
    amount: number;
    onstart(): void;
  }

  let { amount, onstart }: OpeningCardProps = $props();

  const titleId = $props.id();
  let startButton: HTMLButtonElement | undefined = $state();

  onMount(() => {
    startButton?.focus();
  });
</script>

<div
  role="dialog"
  aria-modal="false"
  aria-labelledby={titleId}
  data-testid="opening-card"
  class="{SURFACE_POP} flex w-80 max-w-full flex-col gap-3"
>
  <h2 id={titleId} class="text-base font-semibold">{roomMet(amount)}</h2>
  {#each OPENING_LINES as line (line)}
    <p>{line}</p>
  {/each}
  <button
    type="button"
    class={BUTTON_PRIMARY}
    data-testid="opening-start"
    onclick={() => onstart()}
    bind:this={startButton}
  >
    {START}
  </button>
  <AccountOffer />
</div>
