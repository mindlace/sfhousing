<!--
  The chart row (rule 4, rule 28): the homes completed by month as one heavy line and the state
  target as a dashed marker at its deadline. The part after `index` is drawn dashed at full colour
  (3:1 holds); nothing is drawn past `filledThrough`. Hover or focus of a month, and Left and Right
  on the focused overlay, read out that month's homes. The plot is 96 px tall below md and 64 px
  from md, where the legend moves to the label column. The figcaption points to the Results table
  as the text alternative.
-->
<script lang="ts">
  import { COLORS } from '$lib/fzp/chart';
  import { formatMonthYear } from '$lib/fzp/format';
  import { formatCount } from '$lib/scoreboard';
  import type { TimelineView } from '$lib/sim/world/score/types';
  import type { Day } from '$lib/timelapse/time';
  import { indexOfDay } from './playhead';
  import ChartLegend from './ChartLegend.svelte';
  import { dayPct } from './rows';

  interface Props {
    /** The window the lanes span: a month sits where its first day sits in every lane. */
    asOf: Day;
    windowEnd: Day;
    view: TimelineView | null;
    /** The playhead's calendar month. */
    index: number;
    /** The state target: its deadline's month and its homes. */
    target: { deadlineIndex: number; units: number } | null;
  }

  let { asOf, windowEnd, view, index, target }: Props = $props();

  const W = 1000;
  const H = 100;
  const last = $derived(view?.filledThrough ?? -1);
  /** The homes already completed at the dataset date: added, as the headline counts them. */
  const base = $derived(view?.baseline.completedNet ?? 0);
  const x = (i: number) => (dayPct(view!.months[i], asOf, windowEnd) / 100) * W;

  const yMax = $derived.by(() => {
    if (!view || last < 0) return 1;
    let m = target?.units ?? 0;
    for (let i = 0; i <= last; i++) m = Math.max(m, homes(i));
    return Math.max(m, 1);
  });
  const yMin = $derived.by(() => {
    if (!view || last < 0) return 0;
    let m = Math.min(0, base);
    for (let i = 0; i <= last; i++) m = Math.min(m, homes(i));
    return m;
  });
  const y = (v: number) => H - ((v - yMin) / Math.max(yMax - yMin, 1)) * (H - 4) - 2;

  const pt = (i: number, v: number) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`;
  /** A polyline for months a to b (inclusive), '' when empty. */
  function line(get: (i: number) => number, a: number, b: number): string {
    if (b < a) return '';
    let d = '';
    for (let i = a; i <= b; i++) d += `${i === a ? 'M' : 'L'}${pt(i, get(i))}`;
    return d;
  }

  // The solid part runs through the playhead's month, the dashed part from there on.
  const split = $derived(Math.min(Math.max(index, 0), last));
  const homes = (i: number) => base + view!.rows[i].completedNet;

  let focusAt = $state<number | null>(null);
  let hoverAt = $state<number | null>(null);
  const active = $derived(hoverAt ?? focusAt);

  function summary(i: number): string {
    return `${formatMonthYear(view!.months[i])}: ${formatCount(homes(i))} homes completed`;
  }

  let overlay: HTMLElement | undefined = $state();
  function monthAt(clientX: number): number {
    const r = overlay!.getBoundingClientRect();
    const f = r.width > 0 ? (clientX - r.left) / r.width : 0;
    const i = indexOfDay(view!.months, asOf + f * (windowEnd - asOf));
    return Math.min(Math.max(i, 0), last);
  }
  function onfocus() {
    focusAt = Math.min(Math.max(index, 0), last);
  }
  function onblur() {
    focusAt = null;
  }
  function onkeydown(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const cur = focusAt ?? Math.min(Math.max(index, 0), last);
    let next: number;
    if (e.key === 'ArrowLeft') next = Math.max(cur - 1, 0);
    else if (e.key === 'ArrowRight') next = Math.min(cur + 1, last);
    else return;
    e.preventDefault();
    focusAt = next;
  }

  const CAPTION =
    'Homes completed by month and the state target; the Results table has the numbers.';
</script>

<figure class="sfh-chart-row m-0" aria-label="Net new homes by month">
  <div class="plot relative">
    <svg
      viewBox="0 0 {W} {H}"
      preserveAspectRatio="none"
      class="block h-24 w-full md:h-16"
      aria-hidden="true"
      data-testid="chart-svg"
    >
      {#if view && last >= 0}
        {#if target}
          <line
            x1="0"
            x2={x(target.deadlineIndex)}
            y1={y(target.units)}
            y2={y(target.units)}
            stroke={COLORS.plan}
            stroke-width="2"
            stroke-dasharray="5 3"
            vector-effect="non-scaling-stroke"
            data-testid="chart-target"
          />
          <line
            x1={x(target.deadlineIndex)}
            x2={x(target.deadlineIndex)}
            y1="0"
            y2={H}
            stroke={COLORS.plan}
            stroke-width="2"
            stroke-dasharray="5 3"
            vector-effect="non-scaling-stroke"
          />
        {/if}
        <path
          d={line(homes, 0, split)}
          fill="none"
          stroke={COLORS.total}
          stroke-width="2.5"
          vector-effect="non-scaling-stroke"
          data-testid="chart-line"
        />
        <path
          d={line(homes, split, last)}
          fill="none"
          stroke={COLORS.total}
          stroke-width="2.5"
          stroke-dasharray="7 4"
          vector-effect="non-scaling-stroke"
          data-testid="chart-line-later"
        />
        {#if active !== null}
          <line
            x1={x(active)}
            x2={x(active)}
            y1="0"
            y2={H}
            stroke="var(--chart-vertical)"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
        {/if}
      {/if}
    </svg>
    {#if view && last >= 0}
      <div
        bind:this={overlay}
        class="overlay absolute inset-0"
        role="slider"
        tabindex="0"
        aria-label="Month in the chart"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={active ?? split}
        aria-valuetext={summary(active ?? split)}
        {onfocus}
        {onblur}
        {onkeydown}
        onpointermove={(e) => (hoverAt = monthAt(e.clientX))}
        onpointerleave={() => (hoverAt = null)}
      ></div>
      {#if active !== null}
        <!-- sfh-chart-readout: Timeline.svelte's stacking rule selects it to lift the chart cell
             above the playhead line while the readout shows. Keep the class name in step. -->
        <p
          class="sfh-chart-readout readout pointer-events-none absolute top-0 m-0 rounded border border-line bg-surface px-2 py-1 text-xs whitespace-nowrap text-ink tabular-nums shadow-md dark:text-ink-dark"
          style:left="{(x(active) / W) * 100}%"
          class:flip={x(active) > W / 2}
          data-testid="chart-readout"
        >
          {summary(active)}
        </p>
      {/if}
    {/if}
  </div>
  <!-- From md the legend sits in the label column beside the plot (Timeline). -->
  <ChartLegend class="md:hidden" />
  <figcaption class="sr-only">{CAPTION}</figcaption>
</figure>

<style>
  .overlay {
    cursor: crosshair;
  }
  .overlay:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }
  .readout {
    transform: translateX(8px);
  }
  .readout.flip {
    transform: translateX(calc(-100% - 8px));
  }
  @media (prefers-color-scheme: dark) {
    .readout {
      border-color: var(--color-line-dark);
      background: var(--color-surface-dark);
      color: var(--color-ink-dark);
    }
    .overlay:focus-visible {
      outline-color: var(--color-accent-dark);
    }
  }
</style>
