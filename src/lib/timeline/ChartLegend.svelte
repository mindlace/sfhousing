<!--
  The chart row's legend names only what is drawn, by lens (through `lensOf`). Homes: the homes
  line ("Homes completed"), or with a policy in force (`inForce`) "With your policy", "Current
  law" and the shaded gap "From your policy", then "Goal" while its step is drawn (`goal`). By
  source: "All homes", "From today's pipeline" (dashed, as its line) and the shaded gap "New
  projects", no goal. From your policy: its one line, no goal. At most four entries. Below md it
  runs under the plot (ChartRow); from md it stacks in the label column as the row's label
  (Timeline), so the plot keeps the lane's full width. Stacked, its four entries fit the plot's height at
  every size (16 px lines: 70 of 96; compact, 14 px lines: 62 of 64), so a first policy or a lens
  never moves the pinned block.
-->
<script lang="ts">
  import { COLORS } from '$lib/fzp/chart';
  import { lensOf, PIPELINE_DASH, type ChartLens } from './chart-model';

  interface Props {
    /** Stacked in the label column (from md) rather than wrapped under the plot. */
    stacked?: boolean;
    /** The goal's step is drawn (`goalStep` is not null): its entry shows. */
    goal: boolean;
    /** A policy is in force: the current-law line and the gap are drawn. */
    inForce: boolean;
    /** What the chart plots; 'effect' without a policy in force is 'homes'. */
    lens?: ChartLens;
    class?: string;
  }

  let { stacked = false, goal, inForce, lens = 'homes', class: cls = '' }: Props = $props();

  type Entry = { name: string; color: string; width?: number; dash?: string; fill?: boolean };
  const HOMES: Entry = { name: 'Homes completed', width: 2.5, color: COLORS.total };
  const POLICY: Entry = { name: 'With your policy', width: 2.5, color: COLORS.total };
  const LAW: Entry = { name: 'Current law', width: 2.5, color: 'var(--chart-law)' };
  const GAP: Entry = { name: 'From your policy', color: 'var(--chart-gap)', fill: true };
  const ALL: Entry = { name: 'All homes', width: 2.5, color: COLORS.total };
  const PIPELINE: Entry = {
    name: "From today's pipeline",
    width: 2.5,
    color: 'var(--chart-law)',
    dash: PIPELINE_DASH
  };
  const NEW: Entry = { name: 'New projects', color: 'var(--chart-gap)', fill: true };
  const EFFECT: Entry = { name: 'From your policy', width: 2.5, color: COLORS.total };
  const GOAL_LINE: Entry = { name: 'Goal', dash: '5 3', width: 1.5, color: 'var(--chart-ink)' };
  const shown = $derived(lensOf(lens, inForce));
  // Only the homes lens draws the goal.
  const legend = $derived(
    shown === 'effect'
      ? [EFFECT]
      : shown === 'source'
        ? [ALL, PIPELINE, NEW]
        : [...(inForce ? [POLICY, LAW, GAP] : [HOMES]), ...(goal ? [GOAL_LINE] : [])]
  );
</script>

<ul
  class:stacked
  class="legend m-0 flex list-none p-0 text-xs text-ink dark:text-ink-dark {stacked
    ? 'flex-col gap-0.5 font-normal'
    : 'flex-wrap gap-x-4 gap-y-1 pt-1'} {cls}"
  data-testid={stacked ? 'tl-chart-legend' : 'chart-legend'}
>
  {#each legend as l (l.name)}
    <li class="flex items-center gap-1.5 {stacked ? 'leading-4 whitespace-nowrap' : 'min-h-6'}">
      <svg width="22" height="10" aria-hidden="true" class="shrink-0">
        {#if l.fill}
          <!-- Outlined in the plan line's colour, so the pale fill reads on its own. -->
          <rect
            x="1.5"
            y="1.5"
            width="19"
            height="7"
            fill={l.color}
            stroke={COLORS.plan}
            stroke-width="1"
          />
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

<style>
  /* From md on a short viewport the plot is 64 px: four 14 px entries and their gaps fit it. */
  @media (min-width: 768px) and (max-height: 820px) {
    .stacked li {
      line-height: 14px;
    }
  }
</style>
