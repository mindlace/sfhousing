<!--
  The /lesscars building card: what a tapped building is (built by the plan on freed land or a
  former parking lot, or a market project), its homes, stories and status at the scrubbed day.
  The worker never sends a future date (a start or completion after the day is null), so the card
  shows none. Below md it spans the map above the scrubber; from md it sits at the bottom left,
  right of the zoom controls. Both clear the bottom-right map controls
  (`--map-controls-br-block-size`, which includes the scrubber's inset). Escape closes it unless a
  modal dialog is open.
-->
<script lang="ts">
  import { formatShortMonthYear } from '$lib/fzp/format';
  import { formatCount } from '$lib/scoreboard/format';
  import type { PlaybackCard } from '$lib/sim/lesscars/types';

  interface Props {
    card: PlaybackCard | null;
    loading: boolean;
    onclose: () => void;
  }
  let { card, loading, onclose }: Props = $props();

  const uid = $props.id();
  const headingId = `${uid}-h`;

  const HEADING: Record<PlaybackCard['kind'], string> = {
    freed: 'Built by the plan on freed land',
    parking: 'Built by the plan on a former parking lot',
    market: 'Market project'
  };

  const homes = (n: number) => `${formatCount(n)} ${n === 1 ? 'home' : 'homes'}`;

  function statusLine(c: PlaybackCard): string {
    switch (c.status) {
      case 'construction':
        return c.constructionDay === null
          ? 'Under construction'
          : `Under construction since ${formatShortMonthYear(c.constructionDay)}`;
      case 'complete':
        return c.completeDay === null
          ? 'Completed'
          : `Completed ${formatShortMonthYear(c.completeDay)}`;
      case 'planning':
        return 'In planning';
      case 'stopped':
        return 'Stopped';
    }
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.querySelector('dialog:modal')) return;
    onclose();
  }
</script>

<svelte:window {onkeydown} />

<div
  role="region"
  aria-label="Building details"
  data-testid="lc-card"
  class="absolute inset-x-2 z-20 max-h-[50%] overflow-y-auto rounded-lg bg-white p-4 text-sm text-gray-900 shadow-lg md:right-auto md:left-16 md:w-80 dark:bg-gray-900 dark:text-gray-100"
  style:bottom="calc(var(--map-controls-br-block-size, var(--lc-scrubber-h, 60px)) + 8px)"
>
  <div class="flex items-start justify-between gap-2">
    <h2 id={headingId} class="text-base font-semibold">
      {card ? HEADING[card.kind] : 'Building details'}
    </h2>
    <button
      type="button"
      class="min-h-6 min-w-6 shrink-0 rounded-md px-2 text-sm font-semibold underline pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      onclick={onclose}>Close</button
    >
  </div>
  {#if card}
    {#if card.planLabel}<p class="mt-1 font-medium">{card.planLabel}</p>{/if}
    <p class="mt-1 text-gray-700 dark:text-gray-300">{card.where}</p>
    <p class="mt-2">
      {homes(card.units)}{#if card.existingUnits > 0}, replacing {homes(card.existingUnits)}{/if}
    </p>
    {#if card.stories !== null}
      <p class="mt-1">{card.stories} {card.stories === 1 ? 'story' : 'stories'}</p>
    {/if}
    <p class="mt-2 font-semibold">{statusLine(card)}</p>
  {:else}
    <p class="mt-2 text-gray-700 dark:text-gray-300" role="status">
      {loading ? 'Loading…' : 'Details unavailable.'}
    </p>
  {/if}
</div>
