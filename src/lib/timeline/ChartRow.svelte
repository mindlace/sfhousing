<!--
  The chart row (rule 4, rule 28): net new homes by month as the average of the simulated cities
  (heavy solid line) with the 8-in-10 band behind it, this city (thin dotted line) and the state
  target as a dashed marker at its deadline. Lines differ by dash as well as colour. The part
  after `index` is drawn lighter, as sparser dashes at full colour (3:1 holds); nothing is drawn past `filledThrough`. Hover or focus of a
  month, and Left and Right on the focused overlay, show that month's three numbers.
  The figcaption points to the Results table as the text alternative.
-->
<script lang="ts">
  import { COLORS } from '$lib/fzp/chart';
  import { formatMonthYear } from '$lib/fzp/format';
  import { formatRange } from '$lib/fzp/score-view';
  import { formatCount } from '$lib/scoreboard';
  import type { TimelineView } from '$lib/sim/world/score/types';
  import { CITY_NOTE, RANGE_NOTE } from './copy';
  import Explain from './Explain.svelte';

  interface Props {
    view: TimelineView | null;
    /** The playhead's calendar month. */
    index: number;
    /** The state target: its deadline's month and its homes. */
    target: { deadlineIndex: number; units: number } | null;
  }

  let { view, index, target }: Props = $props();

  const W = 1000;
  const H = 100;
  const last = $derived(view?.filledThrough ?? -1);
  /** The homes already completed at the dataset date: added, as the headline counts them. */
  const base = $derived(view?.baseline.completedNet ?? 0);
  const lastIndex = $derived(Math.max(view?.lastIndex ?? 1, 1));
  const x = (i: number) => (i / lastIndex) * W;

  const yMax = $derived.by(() => {
    if (!view || last < 0) return 1;
    let m = target?.units ?? 0;
    for (let i = 0; i <= last; i++) {
      m = Math.max(m, base + view.band[i].hi, avg(i), city(i));
    }
    return Math.max(m, 1);
  });
  const yMin = $derived.by(() => {
    if (!view || last < 0) return 0;
    let m = Math.min(0, base);
    for (let i = 0; i <= last; i++) m = Math.min(m, base + view.band[i].lo);
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
  function area(a: number, b: number): string {
    if (!view || b < a) return '';
    let d = '';
    for (let i = a; i <= b; i++) d += `${i === a ? 'M' : 'L'}${pt(i, base + view.band[i].hi)}`;
    for (let i = b; i >= a; i--) d += `L${pt(i, base + view.band[i].lo)}`;
    return `${d}Z`;
  }

  // The solid part runs through the playhead's month, the lighter part from there on.
  const split = $derived(Math.min(Math.max(index, 0), last));
  const avg = (i: number) => base + view!.mean[i].completedNet;
  const city = (i: number) => base + view!.shown[i].completedNet;

  let focusAt = $state<number | null>(null);
  let hoverAt = $state<number | null>(null);
  const active = $derived(hoverAt ?? focusAt);

  function summary(i: number): string {
    const b = view!.band[i];
    return (
      `${formatMonthYear(view!.months[i])}: average ${formatCount(avg(i))}, ` +
      `8 in 10 ${formatRange(base + b.lo, base + b.hi)}, this city ${formatCount(city(i))}`
    );
  }

  let overlay: HTMLElement | undefined = $state();
  function monthAt(clientX: number): number {
    const r = overlay!.getBoundingClientRect();
    const f = r.width > 0 ? (clientX - r.left) / r.width : 0;
    return Math.min(Math.max(Math.round(f * lastIndex), 0), last);
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
    'Average of the simulated cities with their range, this city and the state target; the Results table has the numbers.';

  const LEGEND = [
    { name: 'Average', dash: undefined, width: 2.5, color: COLORS.total, note: null },
    { name: '8 in 10 futures', dash: undefined, width: 8, color: COLORS.total, note: RANGE_NOTE },
    { name: 'This city', dash: '1 3', width: 1.25, color: COLORS.fresh, note: CITY_NOTE },
    { name: 'State target', dash: '5 3', width: 2, color: COLORS.plan, note: null }
  ] as const;
</script>

<figure class="sfh-chart-row m-0" aria-label="Net new homes by month">
  <div class="plot relative">
    <svg
      viewBox="0 0 {W} {H}"
      preserveAspectRatio="none"
      class="block h-24 w-full"
      aria-hidden="true"
      data-testid="chart-svg"
    >
      {#if view && last >= 0}
        <path d={area(0, split)} fill={COLORS.total} fill-opacity="0.18" data-testid="chart-band" />
        <path
          d={area(split, last)}
          fill={COLORS.total}
          fill-opacity="0.08"
          data-testid="chart-band-later"
        />
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
          d={line(city, 0, split)}
          fill="none"
          stroke={COLORS.fresh}
          stroke-width="1.25"
          stroke-dasharray="1 3"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
          data-testid="chart-city"
        />
        <path
          d={line(city, split, last)}
          fill="none"
          stroke={COLORS.fresh}
          stroke-width="1.25"
          stroke-dasharray="1 7"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
          data-testid="chart-city-later"
        />
        <path
          d={line(avg, 0, split)}
          fill="none"
          stroke={COLORS.total}
          stroke-width="2.5"
          vector-effect="non-scaling-stroke"
          data-testid="chart-avg"
        />
        <path
          d={line(avg, split, last)}
          fill="none"
          stroke={COLORS.total}
          stroke-width="2.5"
          stroke-dasharray="7 4"
          vector-effect="non-scaling-stroke"
          data-testid="chart-avg-later"
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
        <p
          class="readout pointer-events-none absolute top-0 m-0 rounded border border-line bg-surface px-2 py-1 text-xs whitespace-nowrap text-ink tabular-nums shadow-md dark:text-ink-dark"
          style:left="{(x(active) / W) * 100}%"
          class:flip={active > lastIndex / 2}
          data-testid="chart-readout"
        >
          {summary(active)}
        </p>
      {/if}
    {/if}
  </div>
  <!-- Each item is 24 px tall and the list clears the chart by 4 px, so a 16 px explanation
       button keeps its 24 px target (WCAG 2.5.8) clear of the chart's slider above it. -->
  <ul
    class="legend m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 pt-1 text-xs text-ink dark:text-ink-dark"
  >
    {#each LEGEND as l (l.name)}
      <li class="flex min-h-6 items-center gap-1.5">
        <svg width="22" height="10" aria-hidden="true">
          <line
            x1="1"
            x2="21"
            y1="5"
            y2="5"
            stroke={l.color}
            stroke-width={l.width}
            stroke-dasharray={l.dash}
            stroke-linecap={l.dash === '1 3' ? 'round' : undefined}
            stroke-opacity={l.width === 8 ? 0.3 : 1}
          />
        </svg>
        {#if l.note}
          <Explain text={l.note}>{l.name}</Explain>
        {:else}
          <span>{l.name}</span>
        {/if}
      </li>
    {/each}
  </ul>
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
