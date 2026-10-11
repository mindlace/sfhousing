<script module lang="ts">
  import { score as computeScore } from './accumulator';
  import { M1_TARGETS } from './targets';
  const EMPTY = computeScore([], M1_TARGETS);
  const WIDE = '(min-width: 768px)';
</script>

<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import ScoreboardPanel from './ScoreboardPanel.svelte';
  import type { Score } from './types';
  import { announcement, BADGE, barText, viewState, type ScoreStatus } from './view';

  interface Props {
    /** Latest score from the worker (`null` before the first diff → empty). */
    score: Score | null;
    status: ScoreStatus;
    /** Partial-failure Retry: the shell sends brush-tool's `retryChunks`. */
    onretry?: () => void;
    /** Mobile sheet opened/closed or resized: the shell adjusts the map's bottom inset. */
    onsheetchange?: (open: boolean, heightPx: number) => void;
  }
  let { score, status, onretry, onsheetchange }: Props = $props();

  const uid = $props.id();
  const sheetId = `${uid}-sheet`;
  const shown = $derived(score ?? EMPTY);
  const view = $derived(viewState(shown, status));

  let open = $state(false);
  let sheetH = $state(0);
  let barButton = $state<HTMLButtonElement>();
  let closeButton = $state<HTMLButtonElement>();

  async function openSheet(): Promise<void> {
    open = true;
    await tick();
    closeButton?.focus();
  }
  async function closeSheet(): Promise<void> {
    open = false;
    await tick();
    barButton?.focus();
  }

  $effect(() => {
    onsheetchange?.(open, open ? sheetH : 0);
  });

  onMount(() => {
    const mq = matchMedia(WIDE);
    const onChange = () => {
      if (mq.matches) open = false;
    };
    mq.addEventListener('change', onChange);
    return () => {
      mq.removeEventListener('change', onChange);
      if (untrack(() => open)) onsheetchange?.(false, 0);
    };
  });

  let live = $state('');
  let lastSpoken = untrack(() => announcement(shown));
  $effect(() => {
    const msg = announcement(shown);
    if (view.updating || msg === lastSpoken) return;
    const t = setTimeout(() => {
      lastSpoken = msg;
      live = msg;
    }, 1000);
    return () => clearTimeout(t);
  });
</script>

<svelte:window
  onkeydown={(e) => {
    if (open && e.key === 'Escape') void closeSheet();
  }}
/>

<div class="sfh-scoreboard" role="region" aria-label="Housing scoreboard">
  <div
    class="absolute top-4 right-4 z-20 hidden max-h-[calc(100%-2rem)] w-80 overflow-y-auto rounded-lg bg-white p-4 shadow-lg md:block"
  >
    <ScoreboardPanel score={shown} {status} {onretry} />
  </div>

  <div class="fixed inset-x-0 bottom-0 z-20 h-14 bg-white md:hidden">
    <button
      bind:this={barButton}
      type="button"
      class="flex h-full w-full flex-col items-start justify-center border-t border-gray-300 px-4 text-left text-black"
      aria-expanded={open}
      aria-controls={sheetId}
      onclick={() => void openSheet()}
    >
      <span class="text-sm font-semibold" data-testid="scorebar-text">{barText(shown)}</span>
      <span class="text-xs text-gray-700">{BADGE[status.mode]}</span>
    </button>
  </div>

  {#if open}
    <div
      id={sheetId}
      role="group"
      aria-label="Scoreboard details"
      class="fixed inset-x-0 bottom-0 z-30 max-h-[85dvh] overflow-y-auto rounded-t-xl bg-white p-4 shadow-2xl md:hidden"
      bind:offsetHeight={sheetH}
    >
      <div class="flex justify-end">
        <button
          bind:this={closeButton}
          type="button"
          class="min-h-11 min-w-11 rounded-md px-3 text-sm font-semibold underline"
          onclick={() => void closeSheet()}>Close</button
        >
      </div>
      <ScoreboardPanel score={shown} {status} {onretry} />
    </div>
  {/if}

  <p class="sr-only" aria-live="polite" data-testid="score-live">{live}</p>
</div>

<style>
  @media (max-width: 767px) {
    :global(:root:has(.sfh-scoreboard)) {
      --scorebar-h: 56px;
    }
  }
</style>
