<script lang="ts">
  import { formatCount } from './format';
  import NeighborhoodList from './NeighborhoodList.svelte';
  import TargetRow from './TargetRow.svelte';
  import type { Score } from './types';
  import {
    BADGE,
    footnoteLead,
    neighborhoodRows,
    oldPlanNote,
    secondaryText,
    trackMax,
    viewState,
    type ScoreStatus
  } from './view';

  interface Props {
    score: Score;
    status: ScoreStatus;
    onretry?: () => void;
  }
  let { score, status, onretry }: Props = $props();
  const view = $derived(viewState(score, status));
  const max = $derived(trackMax(score.targets));
</script>

<div class="text-black">
  <p
    class="inline-block rounded-full border border-gray-700 px-2 py-0.5 text-xs font-semibold tracking-wide uppercase"
  >
    {BADGE[status.mode]}
  </p>
  <p class="mt-2">
    <span data-testid="score-net" class="text-3xl font-bold tabular-nums"
      >{formatCount(score.netUnits)}</span
    >
    <span class="text-base">net new homes</span>
  </p>

  {#if view.updating}
    <p class="mt-1 flex items-center gap-2 text-sm text-gray-800">
      <span
        aria-hidden="true"
        data-testid="updating-spinner"
        class="inline-block h-3.5 w-3.5 rounded-full border-2 border-gray-400 border-t-gray-900 motion-safe:animate-spin"
      ></span>
      Updating…
    </p>
  {/if}

  {#if view.failed}
    <div class="mt-2 flex items-start gap-2 rounded-md border border-amber-700 bg-amber-50 p-2">
      <p class="text-sm">
        <span aria-hidden="true">⚠ </span>Some areas didn't load ({status.failedChunks}). Totals
        leave them out.
      </p>
      <button
        type="button"
        class="min-h-11 min-w-11 shrink-0 rounded-md px-2 text-sm font-semibold underline"
        onclick={() => onretry?.()}>Retry</button
      >
    </div>
  {/if}

  {#if view.empty}
    <p class="mt-2 text-sm text-gray-800">Paint a height on the map to add homes.</p>
  {/if}

  {#each score.targets as tp, i (tp.target.id)}
    <TargetRow {tp} net={score.netUnits} {max} primary={i === 0} />
  {/each}

  <p class="mt-3 text-sm text-gray-800">{secondaryText(score)}</p>

  {#if score.parcelsChanged > 0}
    <details class="mt-3">
      <summary class="min-h-6 cursor-pointer text-sm font-semibold">By neighborhood</summary>
      <NeighborhoodList rows={neighborhoodRows(score.byNeighborhood)} />
    </details>
  {/if}

  <details class="mt-3">
    <summary class="min-h-6 cursor-pointer text-sm font-semibold"
      >What does this number mean?</summary
    >
    <div class="mt-2 space-y-2 text-sm">
      <p>
        <strong>Theoretical max buildout.</strong> This counts every home the heights you painted would
        allow if every eligible parcel under your strokes were rebuilt to the maximum, all at once, today.
        It is not a forecast: real construction depends on cost, demand, permitting and time.
      </p>
      <p>
        <strong>Net, not gross.</strong> When a new building replaces an existing one, the homes in the
        old building are subtracted. Backyard cottages (1–2 stories painted on a lot with homes) keep
        the existing building and add one home.
      </p>
      <p>
        <strong>Targets.</strong> RHNA is the state-assigned number of homes San Francisco must plan for
        in 2023–2031 (82,069). The state also expects a buffer of at least 15% (94,379). Going past 100%
        is meaningful: SF is far behind, and more housing than the minimum is a real policy choice.
      </p>
      <ul class="space-y-1">
        {#each score.targets as tp (tp.target.id)}
          <li>
            <a class="underline" href={tp.target.source.url} rel="external noopener"
              >{tp.target.label}: {tp.target.source.label}</a
            >
          </li>
        {/each}
      </ul>
    </div>
  </details>

  <p class="mt-3 text-xs text-gray-700">
    {footnoteLead(status)} · <a class="underline" href="/attribution">Sources</a>{#if view.oldPlan}
      · {oldPlanNote(status)}{/if}
  </p>
</div>
