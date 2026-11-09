<!--
  Extra homes by year: the mean line, the p10 to p90 band, a zero line when the axis reaches below
  zero, and a vertical marker at the scrubbed year. A plain inline SVG; the model depends on the
  summary, the high-water mark and width, never on the day, so scrubbing moves only the marker.
  Only year ends up to the high-water mark are drawn; the x axis keeps the full span.
-->
<script lang="ts">
  import type { LessCarsSummary } from '$lib/data/lesscars/codec';
  import { useSystemTheme } from '$lib/map/system-theme.svelte';
  import { formatCount } from '$lib/scoreboard/format';
  import { CHART_COLORS } from './chart-colors';
  import type { Day } from '$lib/timelapse/time';
  import {
    extraChartModel,
    homesAt,
    revealedYearIndex,
    signed,
    yearAt,
    yearIndexAt
  } from './summary-view';

  interface Props {
    summary: LessCarsSummary;
    day: Day;
    /** The furthest day reached: year ends after it are not drawn. */
    highWater: Day;
  }
  let { summary, day, highWater }: Props = $props();

  const theme = useSystemTheme();
  const col = $derived(CHART_COLORS[theme.current]);
  const H = 140;
  const PAD = { l: 44, r: 8, t: 8, b: 20 };
  const FALLBACK_W = 320;
  let measured = $state(0);
  const width = $derived(measured > 0 ? measured : FALLBACK_W);

  const idx = $derived(revealedYearIndex(summary, highWater));
  const m = $derived(extraChartModel(summary, idx));
  const n = $derived(m.years.length);
  const x = $derived((i: number) => PAD.l + (n > 1 ? (i / (n - 1)) * (width - PAD.l - PAD.r) : 0));
  const y = $derived(
    (v: number) => PAD.t + ((m.yMax - v) / (m.yMax - m.yMin)) * (H - PAD.t - PAD.b)
  );
  const line = $derived(m.mean.map((v, i) => `${x(i)},${y(v)}`).join(' '));
  const band = $derived(
    [
      ...m.p90.map((v, i) => `${x(i)},${y(v)}`),
      ...m.p10.map((v, i) => `${x(i)},${y(v)}`).reverse()
    ].join(' ')
  );
  const nowIndex = $derived(yearIndexAt(summary, day));
  const label = $derived(
    idx < 0
      ? 'No extra homes yet'
      : `Extra homes by year: ${signed(homesAt(summary, idx))} by ${yearAt(summary, idx)}`
  );
</script>

<figure class="mt-3" data-testid="lc-chart">
  <div bind:clientWidth={measured}>
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 {width} {H}"
      class="block w-full"
      style:height="{H}px"
    >
      <line x1={PAD.l} x2={width - PAD.r} y1={y(m.yMax)} y2={y(m.yMax)} stroke={col.grid} />
      <line x1={PAD.l} x2={width - PAD.r} y1={y(m.yMin)} y2={y(m.yMin)} stroke={col.grid} />
      {#if m.yMin < 0}
        <line
          data-zero-line
          x1={PAD.l}
          x2={width - PAD.r}
          y1={y(0)}
          y2={y(0)}
          stroke={col.zero}
          stroke-dasharray="4 3"
        />
      {/if}
      {#if idx >= 0}
        <polygon points={band} fill={col.band} fill-opacity="0.18" />
        <polyline points={line} fill="none" stroke={col.mean} stroke-width="2.5" />
      {/if}
      <line
        data-now
        data-year-index={nowIndex}
        x1={x(nowIndex)}
        x2={x(nowIndex)}
        y1={PAD.t}
        y2={H - PAD.b}
        stroke={col.now}
        stroke-width="1.5"
        stroke-dasharray="2 2"
      />
      <g font-size="10" fill={col.text}>
        <text x={PAD.l - 4} y={y(m.yMax) + 3} text-anchor="end">{formatCount(m.yMax)}</text>
        <text x={PAD.l - 4} y={y(m.yMin) + 3} text-anchor="end">{formatCount(m.yMin)}</text>
        <text x={PAD.l} y={H - 6}>{m.years[0]}</text>
        <text x={width - PAD.r} y={H - 6} text-anchor="end">{m.years[n - 1]}</text>
      </g>
    </svg>
  </div>
  <figcaption class="mt-1 text-xs text-gray-600 dark:text-gray-400">
    Extra homes by year. Line: average. Shaded: middle 80% of futures.
  </figcaption>
</figure>
