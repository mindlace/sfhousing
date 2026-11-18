<!--
  The score chart (spec §4.6): a plain inline SVG laid out from `chartModel`. The model depends on
  the width, the score and the last filled day, never on `day` or `reached`, so scrubbing moves
  only the cursor line and two clip rectangles (O(1)). Each line is one path drawn twice: solid
  under the shown clip (the start to the cursor) and thinner under the seen one (the cursor to the
  furthest day reached); nothing past it. The table and the summary stop at the playhead's month.
-->
<script lang="ts">
  import { GOAL } from '$lib/goal/goal';
  import type { TimelineScore } from '$lib/sim/protocol';
  import type { Day } from '$lib/timelapse/time';
  import { REFERENCE_NOTE } from '$lib/timeline/copy';
  import Explain from '$lib/timeline/Explain.svelte';
  import { CHART_H, COLORS, SERIES_NAME, chartLabel, chartModel, tableRows } from './chart';
  import { CALCULATING } from './score-view';
  import { monthIndex } from './time';

  interface Props {
    score: TimelineScore;
    asOf: Day;
    horizon: Day;
    day: Day;
    /** The last filled day: the scale and the paths cover every filled month. */
    highWater: Day;
    /** The furthest day reached: lines are drawn solid to `day`, thinner to here, nothing past. */
    reached: Day;
  }
  let { score, asOf, horizon, day, highWater, reached }: Props = $props();

  const uid = $props.id();
  const shownId = `${uid}-shown`;
  const seenId = `${uid}-seen`;

  /** Used until the container reports its width. */
  const FALLBACK_W = 288;
  const VERTICAL = 'var(--chart-vertical)';
  /** The total's thinner stroke for the part seen but not shown (as the timeline chart's). */
  const SEEN_TOTAL = 'var(--chart-total-seen)';

  let measured = $state(0);
  const width = $derived(measured > 0 ? measured : FALLBACK_W);
  const filled = $derived(monthIndex(highWater, score.months[0], score.months.length));
  const model = $derived(chartModel(score, asOf, horizon, width, filled));
  // The table and the summary name the playhead's month, never one beyond it.
  const playIndex = $derived(
    Math.min(monthIndex(day, score.months[0], score.months.length), filled)
  );
  const rows = $derived(tableRows(score, asOf, playIndex));
  const label = $derived(chartLabel(score, playIndex));
  const cursorX = $derived(model.x(Math.min(Math.max(day, asOf), horizon)));
  // A zone edge at or past the last filled day is the plot's end, as on the ruler.
  const edge = (d: Day) => (d >= highWater ? width : model.x(Math.min(Math.max(d, asOf), horizon)));
  const reachedX = $derived(Math.max(edge(reached), cursorX));

  type LineKey = 'total' | 'pipeline' | 'fresh' | 'planCompleted' | 'planEntitled';
  const LINES: Record<LineKey, { stroke: string; width: number; dash?: string }> = {
    total: { stroke: COLORS.total, width: 2.5 },
    pipeline: { stroke: COLORS.pipeline, width: 2, dash: '6 3' },
    fresh: { stroke: COLORS.fresh, width: 2 },
    planCompleted: { stroke: COLORS.plan, width: 2 },
    planEntitled: { stroke: COLORS.plan, width: 2, dash: '2 2' }
  };
  const LEGEND_ORDER: LineKey[] = ['total', 'pipeline', 'fresh', 'planCompleted', 'planEntitled'];
  const COLUMNS = [
    'Date',
    'Toward the goal',
    'From pipeline',
    'New projects',
    'Plan effect (completed)',
    'Plan effect (approved)'
  ];

  const lineKeys = Object.keys(LINES) as LineKey[];
</script>

<figure class="mt-3" data-testid="fzp-chart">
  <div bind:clientWidth={measured}>
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 {width} {CHART_H}"
      class="block w-full"
      style:height="{CHART_H}px"
    >
      {#each model.gridlines as g, i (i)}
        <line x1="0" x2={width} y1={g.y} y2={g.y} stroke="var(--chart-grid)" stroke-width="1" />
        <text
          x="2"
          y={g.y - 2}
          font-size="10"
          fill="var(--chart-label)"
          stroke="var(--chart-halo)"
          stroke-width="3"
          paint-order="stroke">{g.label}</text
        >
      {/each}

      <line
        data-series="rhna"
        x1="0"
        x2={width}
        y1={model.rhnaY}
        y2={model.rhnaY}
        stroke="var(--chart-ink)"
        stroke-width="1"
      />

      {#each model.verticals as v (v.label)}
        <line
          data-vertical={v.label}
          x1={v.x}
          x2={v.x}
          y1="0"
          y2={CHART_H}
          stroke={VERTICAL}
          stroke-width="1"
          stroke-dasharray="4 3"
        />
      {/each}

      <defs>
        <clipPath id={shownId} clipPathUnits="userSpaceOnUse">
          <rect
            x="0"
            y="-10"
            width={cursorX}
            height={CHART_H + 20}
            data-testid="chart-clip-shown"
          />
        </clipPath>
        <clipPath id={seenId} clipPathUnits="userSpaceOnUse">
          <rect
            x={cursorX}
            y="-10"
            width={reachedX - cursorX}
            height={CHART_H + 20}
            data-testid="chart-clip-seen"
          />
        </clipPath>
      </defs>
      <g clip-path="url(#{shownId})">
        {#each lineKeys as key (key)}
          {#if model[key]}
            <path
              data-series={key}
              d={model[key]}
              fill="none"
              stroke={LINES[key].stroke}
              stroke-width={LINES[key].width}
              stroke-dasharray={LINES[key].dash}
              stroke-linejoin="round"
            />
          {/if}
        {/each}
      </g>
      <g clip-path="url(#{seenId})">
        {#each lineKeys as key (key)}
          {#if model[key]}
            <path
              data-series-seen={key}
              d={model[key]}
              fill="none"
              stroke={key === 'total' ? SEEN_TOTAL : LINES[key].stroke}
              stroke-width={LINES[key].width / 2}
              stroke-dasharray={LINES[key].dash}
              stroke-linejoin="round"
            />
          {/if}
        {/each}
      </g>

      {#each model.references as r, i (i)}
        <line
          data-reference={i}
          x1={r.x1}
          x2={r.x2}
          y1={r.y}
          y2={r.y}
          stroke={r.color}
          stroke-width="2"
          stroke-dasharray="1 3"
          stroke-linecap="round"
        />
        <circle cx={r.x2} cy={r.y} r="3" fill={r.color} />
      {/each}

      <line
        data-cursor
        x1={cursorX}
        x2={cursorX}
        y1="0"
        y2={CHART_H}
        stroke="var(--chart-ink)"
        stroke-width="1.5"
      />

      <text
        x={width - 2}
        y={model.rhnaY - 3}
        text-anchor="end"
        font-size="10"
        fill="var(--chart-ink)"
        stroke="var(--chart-halo)"
        stroke-width="3"
        paint-order="stroke">{GOAL.name}</text
      >
      {#each model.verticals as v (v.label)}
        <text
          x={v.x + 3}
          y="10"
          font-size="10"
          fill="var(--chart-label)"
          stroke="var(--chart-halo)"
          stroke-width="3"
          paint-order="stroke">{v.label}</text
        >
      {/each}
      {#each model.xTicks as t, i (t.label)}
        <text
          x={t.x}
          y={CHART_H - 3}
          text-anchor={i === model.xTicks.length - 1 && t.x > width - 24 ? 'end' : 'middle'}
          font-size="10"
          fill="var(--chart-label)"
          stroke="var(--chart-halo)"
          stroke-width="3"
          paint-order="stroke">{t.label}</text
        >
      {/each}
    </svg>
  </div>

  <div>
    <ul class="mt-2 space-y-1 text-xs text-ink dark:text-ink-dark">
      {#each LEGEND_ORDER as key (key)}
        <li class="flex items-center gap-2" data-legend-series={key}>
          <svg width="24" height="8" aria-hidden="true" class="shrink-0">
            <line
              x1="0"
              x2="24"
              y1="4"
              y2="4"
              stroke={LINES[key].stroke}
              stroke-width={LINES[key].width}
              stroke-dasharray={LINES[key].dash}
            />
          </svg>
          <span>{SERIES_NAME[key]}{model[key] ? '' : `: ${CALCULATING}`}</span>
        </li>
      {/each}
    </ul>
    <ul class="mt-1 space-y-1 text-xs text-ink dark:text-ink-dark">
      {#each model.references as r, i (i)}
        <li class="flex items-center gap-2" data-reference-label={i}>
          <svg width="24" height="8" aria-hidden="true" class="shrink-0">
            <line
              x1="1"
              x2="23"
              y1="4"
              y2="4"
              stroke={r.color}
              stroke-width="2"
              stroke-dasharray="1 3"
              stroke-linecap="round"
            />
          </svg>
          <Explain text={REFERENCE_NOTE}>{r.label}</Explain>
        </li>
      {/each}
    </ul>
  </div>

  <details class="mt-2">
    <summary class="min-h-6 cursor-pointer text-sm font-semibold pointer-coarse:min-h-11"
      >Show as table</summary
    >
    <!-- A scrollable region must be keyboard reachable (axe: scrollable-region-focusable). -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="mt-2 overflow-x-auto" role="region" aria-label="Chart data as a table" tabindex="0">
      <table class="w-full text-left text-xs tabular-nums">
        <thead>
          <tr>
            {#each COLUMNS as c (c)}
              <th scope="col" class="px-1 py-1 align-bottom font-semibold">{c}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each rows as r (r.index)}
            <tr class="border-t border-line dark:border-line-dark">
              <th scope="row" class="px-1 py-1 font-normal whitespace-nowrap">{r.date}</th>
              <td class="px-1 py-1">{r.total}</td>
              <td class="px-1 py-1">{r.pipeline}</td>
              <td class="px-1 py-1">{r.fresh}</td>
              <td class="px-1 py-1">{r.planCompleted}</td>
              <td class="px-1 py-1">{r.planEntitled}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </details>
</figure>
