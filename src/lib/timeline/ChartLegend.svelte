<!--
  The chart row's legend: the homes line, and the goal's dash while its step is drawn (`goal`).
  Below md it runs under the plot (ChartRow); from md it stacks in the label column as the row's
  label (Timeline), so the plot keeps the lane's full width and a short height.
-->
<script lang="ts">
  import { COLORS } from '$lib/fzp/chart';
  import { GOAL } from '$lib/goal/goal';

  interface Props {
    /** Stacked in the label column (from md) rather than wrapped under the plot. */
    stacked?: boolean;
    /** The goal's step is drawn (`goalStep` is not null): its entry shows. */
    goal: boolean;
    class?: string;
  }

  let { stacked = false, goal, class: cls = '' }: Props = $props();

  const HOMES = { name: 'Homes completed', dash: undefined, width: 2.5, color: COLORS.total };
  const GOAL_LINE = { name: GOAL.name, dash: '5 3', width: 2, color: COLORS.plan };
  const legend = $derived(goal ? [HOMES, GOAL_LINE] : [HOMES]);
</script>

<ul
  class="legend m-0 flex list-none p-0 text-xs text-ink dark:text-ink-dark {stacked
    ? 'flex-col gap-0.5 font-normal'
    : 'flex-wrap gap-x-4 gap-y-1 pt-1'} {cls}"
  data-testid={stacked ? 'tl-chart-legend' : undefined}
>
  {#each legend as l (l.name)}
    <li class="flex items-center gap-1.5 {stacked ? 'leading-4 whitespace-nowrap' : 'min-h-6'}">
      <svg width="22" height="10" aria-hidden="true" class="shrink-0">
        <line
          x1="1"
          x2="21"
          y1="5"
          y2="5"
          stroke={l.color}
          stroke-width={l.width}
          stroke-dasharray={l.dash}
        />
      </svg>
      <span>{l.name}</span>
    </li>
  {/each}
</ul>
