<!--
  The time-aware scoreboard (spec §4.3, §4.5): a sibling of the editor's Scoreboard.svelte with the
  same shell (desktop panel, mobile bar and sheet) around FzpScorePanel. Everything it shows is a
  pure function of the T8 score and the scrubbed day.
-->
<script module lang="ts">
  const WIDE = '(min-width: 768px)';
</script>

<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { timelineTokenCss } from '$lib/map/palette';
  import type { TimelineScore } from '$lib/sim/protocol';
  import type { Day } from '$lib/timelapse/time';
  import FzpScorePanel from './FzpScorePanel.svelte';
  import { announcement, barText, scoreAt } from './score-view';
  import { monthIndex } from './time';

  interface Props {
    /** `null` before the first timeline: only the badge, the intro and a loading line. */
    score: TimelineScore | null;
    day: Day;
    asOf: Day;
    horizon: Day;
    /** The live region speaks only when this is false. */
    playing: boolean;
    bandRuns: number;
    bandRunsTotal: number;
    seed: number | null;
    representative: boolean;
    datasetVersion: string;
    builtAt: string;
    onrepresentative: () => void;
    onsources: () => void;
    /** Mobile sheet opened/closed or resized: the shell adjusts the map's bottom inset. */
    onsheetchange?: (open: boolean, heightPx: number) => void;
  }
  let {
    score,
    day,
    asOf,
    horizon,
    playing,
    bandRuns,
    bandRunsTotal,
    seed,
    representative,
    datasetVersion,
    builtAt,
    onrepresentative,
    onsources,
    onsheetchange
  }: Props = $props();

  const uid = $props.id();
  const sheetId = `${uid}-sheet`;
  const at = $derived(
    score ? scoreAt(score, monthIndex(day, score.months[0], score.months.length)) : null
  );

  let open = $state(false);
  let sheetH = $state(0);
  let barButton = $state<HTMLButtonElement>();
  let closeButton = $state<HTMLButtonElement>();
  let sheetEl = $state<HTMLDivElement>();

  async function openSheet(): Promise<void> {
    open = true;
    await tick();
    closeButton?.focus();
  }
  async function closeSheet(): Promise<void> {
    // Restore focus only if it was inside the sheet (or lost to <body>); never steal it.
    const a = document.activeElement;
    const restore = !a || a === document.body || !!sheetEl?.contains(a);
    open = false;
    await tick();
    if (restore) barButton?.focus();
  }

  $effect(() => {
    const o = open;
    const h = sheetH;
    // First open, before the size observer has reported: skip so the inset doesn't jump to 0.
    if (o && h === 0) return;
    untrack(() => onsheetchange?.(o, o ? h : 0));
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

  // Live region: silent while playing; once paused it speaks 1,000 ms after the day settles.
  // Starting paused, the load state is not announced; starting while playing, the first pause
  // announces where playback stopped.
  const message = $derived(score && at ? announcement(day, at) : '');
  let live = $state('');
  let lastSpoken = untrack(() => (playing ? '' : message));
  $effect(() => {
    const msg = message;
    if (playing || msg === '' || msg === lastSpoken) return;
    const t = setTimeout(() => {
      lastSpoken = msg;
      live = msg;
    }, 1000);
    return () => clearTimeout(t);
  });
</script>

<svelte:head>
  <!-- The legend sits outside SimMap, so it cannot inherit SimMap's --map-* variables. -->
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- constant CSS built from palette TOKENS -->
  {@html '<style>' + timelineTokenCss('.sfh-fzp-legend') + '</style>'}
</svelte:head>

<svelte:window
  onkeydown={(e) => {
    if (open && e.key === 'Escape' && !e.defaultPrevented) void closeSheet();
  }}
/>

{#snippet panel()}
  <FzpScorePanel
    {score}
    {at}
    {day}
    {asOf}
    {horizon}
    {bandRuns}
    {bandRunsTotal}
    {seed}
    {representative}
    {datasetVersion}
    {builtAt}
    {onrepresentative}
    {onsources}
  />
{/snippet}

<div class="sfh-fzp-scoreboard" role="region" aria-label="Simulation scoreboard">
  <div
    class="absolute top-4 right-4 z-20 hidden w-80 overflow-y-auto rounded-lg bg-white p-4 shadow-lg md:block"
    style:max-height="calc(100% - 2rem - var(--fzp-scrubber-h, 0px))"
  >
    {@render panel()}
  </div>

  <div class="absolute inset-x-0 bottom-0 z-20 h-14 bg-white md:hidden">
    <button
      bind:this={barButton}
      type="button"
      class="flex h-full w-full flex-col items-start justify-center border-t border-gray-300 px-4 text-left text-black"
      aria-expanded={open}
      aria-controls={sheetId}
      onclick={() => void openSheet()}
    >
      <span class="text-sm font-semibold" data-testid="fzp-scorebar-text"
        >{at ? barText(at) : 'Loading the simulation…'}</span
      >
      <span class="text-xs text-gray-700">Simulation</span>
    </button>
  </div>

  {#if open}
    <div
      id={sheetId}
      bind:this={sheetEl}
      role="group"
      aria-label="Simulation scoreboard details"
      class="absolute inset-x-0 bottom-0 z-30 max-h-[85%] overflow-y-auto rounded-t-xl bg-white p-4 shadow-2xl md:hidden"
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
      {@render panel()}
    </div>
  {/if}

  <p class="sr-only" aria-live="polite" data-testid="fzp-score-live">{live}</p>
</div>

<style>
  @media (width < 768px) {
    :global(:root:has(.sfh-fzp-scoreboard)) {
      --scorebar-h: 56px;
    }
  }
</style>
