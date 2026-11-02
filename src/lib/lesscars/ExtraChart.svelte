<!--
  Extra homes by year: the mean line, the p10 to p90 band, a zero line when the axis reaches below
  zero, and a vertical marker at the scrubbed year. A plain inline SVG; the model depends on the
  summary and width, never on the day, so scrubbing moves only the marker.
-->
<script lang="ts">
  import type { LessCarsSummary } from '$lib/data/lesscars/codec';
  import { formatCount } from '$lib/scoreboard/format';
  import type { Day } from '$lib/timelapse/time';
  import { extraChartModel, finalYear, signed, yearIndexAt } from './summary-view';

  interface Props {
    summary: LessCarsSummary;
    day: Day;
  }
  let { summary, day }: Props = $props();

  const H = 140;
  const PAD = { l: 44, r: 8, t: 8, b: 20 };
  const FALLBACK_W = 320;
  let measured = $state(0);
  const width = $derived(measured > 0 ? measured : FALLBACK_W);

  const m = $derived(extraChartModel(summary));
  const n = $derived(m.mean.length);
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
    `Extra homes by year: ${signed(Math.round(m.mean[0]))} in ${m.years[0]}, ${signed(Math.round(m.mean[n - 1]))} by ${finalYear(summary)}`
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
      <line x1={PAD.l} x2={width - PAD.r} y1={y(m.yMax)} y2={y(m.yMax)} stroke="#d1d5db" />
      <line x1={PAD.l} x2={width - PAD.r} y1={y(m.yMin)} y2={y(m.yMin)} stroke="#d1d5db" />
      {#if m.yMin < 0}
        <line
          data-zero-line
          x1={PAD.l}
          x2={width - PAD.r}
          y1={y(0)}
          y2={y(0)}
          stroke="#6b7280"
          stroke-dasharray="4 3"
        />
      {/if}
      <polygon points={band} fill="#2563eb" fill-opacity="0.18" />
      <polyline points={line} fill="none" stroke="#1d4ed8" stroke-width="2.5" />
      <line
        data-now
        data-year-index={nowIndex}
        x1={x(nowIndex)}
        x2={x(nowIndex)}
        y1={PAD.t}
        y2={H - PAD.b}
        stroke="#374151"
        stroke-width="1.5"
        stroke-dasharray="2 2"
      />
      <g font-size="10" fill="#374151">
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
