<!--
  The chart row's legend names only what is drawn: the homes line ("Homes completed"), or with a
  policy in force (`inForce`) "With your policy", "Current law" and the shaded gap "From your
  policy"; then "Goal" while its step is drawn (`goal`). Below md it runs under the plot
  (ChartRow); from md it stacks in the label column as the row's label (Timeline), so the plot
  keeps the lane's full width.
-->
<script lang="ts">
  import { COLORS } from '$lib/fzp/chart';

  interface Props {
    /** Stacked in the label column (from md) rather than wrapped under the plot. */
    stacked?: boolean;
    /** The goal's step is drawn (`goalStep` is not null): its entry shows. */
    goal: boolean;
    /** A policy is in force: the current-law line and the gap are drawn. */
    inForce: boolean;
    class?: string;
  }

  let { stacked = false, goal, inForce, class: cls = '' }: Props = $props();

  type Entry = { name: string; color: string; width?: number; dash?: string; fill?: boolean };
  const HOMES: Entry = { name: 'Homes completed', width: 2.5, color: COLORS.total };
  const POLICY: Entry = { name: 'With your policy', width: 2.5, color: COLORS.total };
  const LAW: Entry = { name: 'Current law', width: 2.5, color: 'var(--chart-law)' };
  const GAP: Entry = { name: 'From your policy', color: 'var(--chart-gap)', fill: true };
  const GOAL_LINE: Entry = { name: 'Goal', dash: '5 3', width: 1.5, color: 'var(--chart-ink)' };
  const legend = $derived([
    ...(inForce ? [POLICY, LAW, GAP] : [HOMES]),
    ...(goal ? [GOAL_LINE] : [])
  ]);
</script>

<ul
  class="legend m-0 flex list-none p-0 text-xs text-ink dark:text-ink-dark {stacked
    ? 'flex-col gap-0.5 font-normal'
    : 'flex-wrap gap-x-4 gap-y-1 pt-1'} {cls}"
  data-testid={stacked ? 'tl-chart-legend' : 'chart-legend'}
>
  {#each legend as l (l.name)}
    <li class="flex items-center gap-1.5 {stacked ? 'leading-4 whitespace-nowrap' : 'min-h-6'}">
      <svg width="22" height="10" aria-hidden="true" class="shrink-0">
        {#if l.fill}
          <rect x="1" y="1" width="20" height="8" fill={l.color} />
        {:else}
          <line
            x1="1"
            x2="21"
            y1="5"
            y2="5"
            stroke={l.color}
            stroke-width={l.width}
            stroke-dasharray={l.dash}
          />
        {/if}
      </svg>
      <span>{l.name}</span>
    </li>
  {/each}
</ul>
