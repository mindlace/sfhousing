<!--
  The score chart (spec §4.6): a plain inline SVG laid out from `chartModel`. The model depends on
  the width, the score and the high-water day, never on `day`, so scrubbing moves only the cursor
  line (O(1)).
-->
<script lang="ts">
  import type { TimelineScore } from '$lib/sim/protocol';
  import type { Day } from '$lib/timelapse/time';
  import { CHART_H, COLORS, SERIES_NAME, chartLabel, chartModel, tableRows } from './chart';
  import { CALCULATING } from './score-view';
  import { monthIndex } from './time';

  interface Props {
    score: TimelineScore;
    asOf: Day;
    horizon: Day;
    day: Day;
    /** The furthest day reached; the chart draws nothing after its month. */
    highWater: Day;
  }
  let { score, asOf, horizon, day, highWater }: Props = $props();

  /** Used until the container reports its width. */
  const FALLBACK_W = 288;
  const VERTICAL = 'var(--chart-vertical)';

  let measured = $state(0);
  const width = $derived(measured > 0 ? measured : FALLBACK_W);
  const reveal = $derived(monthIndex(highWater, score.months[0], score.months.length));
  const model = $derived(chartModel(score, asOf, horizon, width, reveal));
  const rows = $derived(tableRows(score, asOf, reveal));
  const label = $derived(chartLabel(score, reveal));
  const cursorX = $derived(model.x(Math.min(Math.max(day, asOf), horizon)));

  type LineKey = 'total' | 'pipeline' | 'fresh' | 'planCompleted' | 'planEntitled';
  type AreaKey = 'band' | 'planBand';
  const LINES: Record<LineKey, { stroke: string; width: number; dash?: string }> = {
    total: { stroke: COLORS.total, width: 2.5 },
    pipeline: { stroke: COLORS.pipeline, width: 2, dash: '6 3' },
    fresh: { stroke: COLORS.fresh, width: 2 },
    planCompleted: { stroke: COLORS.plan, width: 2 },
    planEntitled: { stroke: COLORS.plan, width: 2, dash: '2 2' }
  };
  const AREAS: Record<AreaKey, string> = { band: COLORS.total, planBand: COLORS.plan };
  const LEGEND_ORDER: (LineKey | AreaKey)[] = [
    'total',
    'pipeline',
    'fresh',
    'band',
    'planCompleted',
    'planEntitled',
    'planBand'
  ];
  const COLUMNS = [
    'Date',
    'Total',
    'From pipeline',
    'New projects',
    'Plan effect (completed)',
    'Plan effect (approved)',
    '8 in 10 futures',
    'Plan effect, 8 in 10 futures'
  ];

  const lineKeys = Object.keys(LINES) as LineKey[];
  const areaKeys = Object.keys(AREAS) as AreaKey[];
  const isLine = (k: LineKey | AreaKey): k is LineKey => k in LINES;
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

      {#each areaKeys as key (key)}
        {#if model[key]}
          <path
            data-series={key}
            d={model[key]}
            fill={AREAS[key]}
            fill-opacity="0.15"
            stroke="none"
          />
        {/if}
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
        paint-order="stroke">RHNA</text
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
            {#if isLine(key)}
              <line
                x1="0"
                x2="24"
                y1="4"
                y2="4"
                stroke={LINES[key].stroke}
                stroke-width={LINES[key].width}
                stroke-dasharray={LINES[key].dash}
              />
            {:else}
              <rect width="24" height="8" fill={AREAS[key]} fill-opacity="0.15" />
            {/if}
          </svg>
          <span>{SERIES_NAME[key]}{model[key] ? '' : `: ${CALCULATING}`}</span>
        </li>
      {/each}
    </ul>
    <p class="mt-2 text-xs text-ink dark:text-ink-dark">
      Dotted: published estimates of what the plan adds. Compare them with the violet lines, which
      show this simulation's plan effect (with the plan minus the old zoning).
    </p>
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
          <span>{r.label}</span>
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
              <td class="px-1 py-1 whitespace-nowrap">{r.band}</td>
              <td class="px-1 py-1 whitespace-nowrap">{r.planBand}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </details>
</figure>
