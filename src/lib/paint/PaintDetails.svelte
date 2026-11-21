<!--
  Paint's Details: the dock's Details face on `/` and on shared plans (`/p/:id`), opened by the
  header's headline. The goal rows at the headline's share, what the strokes changed, the
  neighborhoods, what room for homes means, an old plan's recalculated note, then the link to
  About's meanings (WORKED_OUT). No badge, no repeated
  headline: the header carries the number. On the dock's surface, so every colour is a light and
  dark token pair.
-->
<script lang="ts">
  import { ABOUT_ID, WORKED_OUT } from '$lib/about/copy';
  import { capacityRows, goalTrackMax } from '$lib/goal/goal';
  import GoalRow from '$lib/goal/GoalRow.svelte';
  import NeighborhoodList from '$lib/scoreboard/NeighborhoodList.svelte';
  import { TARGET } from '$lib/shell/ui';
  import {
    neighborhoodRows,
    oldPlanNote,
    viewState,
    type Score,
    type ScoreStatus
  } from '$lib/scoreboard';
  import { paintCounts, ROOM_MEANS } from './details';

  interface Props {
    score: Score;
    status: ScoreStatus;
    onretry?: () => void;
  }
  let { score, status, onretry }: Props = $props();
  const view = $derived(viewState(score, status));
  const rows = $derived(capacityRows(score.netUnits));
  const max = $derived(goalTrackMax(rows));
</script>

<div data-testid="paint-details" class="text-ink dark:text-ink-dark">
  {#if view.updating}
    <p class="flex items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        data-testid="updating-spinner"
        class="inline-block h-3.5 w-3.5 rounded-full border-2 border-line border-t-ink motion-safe:animate-spin dark:border-line-dark dark:border-t-ink-dark"
      ></span>
      Updating…
    </p>
  {/if}

  {#if view.failed}
    <div
      class="mb-2 flex items-start gap-2 rounded-md border border-amber-700 bg-surface p-2 dark:border-amber-400 dark:bg-surface-dark"
    >
      <p class="text-sm">
        <span aria-hidden="true">⚠ </span>Some areas didn't load ({status.failedChunks}). Totals
        leave them out.
      </p>
      <button
        type="button"
        class="min-h-6 min-w-6 shrink-0 rounded-md px-2 text-sm font-semibold underline hover:bg-surface-raised dark:hover:bg-surface-dark-raised"
        onclick={() => onretry?.()}>Retry</button
      >
    </div>
  {/if}

  {#if view.empty}
    <p class="text-sm">Paint a height on the map to add homes.</p>
  {/if}

  {#each rows as row, k (row.id)}
    <GoalRow {row} {max} primary={k === 0} />
  {/each}

  {#if !view.empty}
    <p class="mt-3 text-sm tabular-nums">{paintCounts(score)}</p>
  {/if}

  {#if score.parcelsChanged > 0}
    <details class="mt-3">
      <summary class="min-h-6 cursor-pointer text-sm font-semibold">By neighborhood</summary>
      <NeighborhoodList rows={neighborhoodRows(score.byNeighborhood)} />
    </details>
  {/if}

  <details class="mt-3">
    <summary class="min-h-6 cursor-pointer text-sm font-semibold">What room for homes means</summary
    >
    <div class="mt-2 space-y-2 text-sm">
      {#each ROOM_MEANS as line (line)}
        <p>{line}</p>
      {/each}
    </div>
  </details>

  {#if view.oldPlan}
    <p class="mt-3 text-xs text-ink-muted first-letter:uppercase dark:text-ink-dark-muted">
      {oldPlanNote(status)}
    </p>
  {/if}

  <p class={view.oldPlan ? 'mt-1 text-sm' : 'mt-3 text-sm'}>
    <a
      class="{TARGET} inline-flex items-center font-semibold underline"
      href="/about#{ABOUT_ID.meanings}"
      data-testid="paint-details-about">{WORKED_OUT}</a
    >
  </p>
</div>
