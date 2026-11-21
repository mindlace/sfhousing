<!--
  The chart row (rules 3, 4): homes completed from today on the ruler's axis, from 0 at today to
  the end of each filled month (`chart-model.ts`). With a policy in force (`inForce`, from the
  document the numbers on show came from) it adds the current-law line and the shaded gap between
  them. The goal is a dashed step at the homes still needed to the end of its deadline's month,
  labelled in the plot (`goalNote`); it is an input, so it is always drawn whole.
  Lenses (`lens`, through `lensOf`; Details switches it): Homes as above; By source, all homes
  over today's pipeline (the current-law tokens, dashed `PIPELINE_DASH`) with the gap, new
  projects, shaded, with or without a policy; From your policy, the effect's one line. Only Homes
  draws the goal: in the other two there is no step or note and the goal does not set the scale.
  The zones, the scale rule and the readout hold in every lens.
  Zones: each series is drawn twice from one path, cut by two clip rectangles: shown, today to the
  playhead's day (full strength), and seen, the day to the furthest date reached (the -seen tokens
  and a thinner stroke). Nothing past `reached`. A zone edge at or past the last row's day reaches
  the plot's end, as on the ruler. As the day moves only the two rectangles change; the paths are
  rebuilt only when the view, `inForce`, the lens or the scale changes, and the scale (a running
  maximum over the months reached, in 1-2-5 steps) changes at most as the furthest date crosses a
  month.
  While stale it draws the view on show (the held numbers) with the seen styling throughout.
  Hover or focus of a month, and Left and Right on the focused overlay, read out the header's
  line 1 for it (`chartReading`). The plot is 96 px tall (64 from md on a viewport 820 px tall or
  less); from md the legend moves to the label column.
-->
<script lang="ts">
  import { COLORS } from '$lib/fzp/chart';
  import type { TimelineView } from '$lib/sim/world/score/types';
  import type { Day } from '$lib/timelapse/time';
  import { yearMarks } from './axis';
  import {
    chartPoints,
    gapPath,
    lensOf,
    linePath,
    PIPELINE_DASH,
    posDay,
    posOf,
    runningMax,
    runningMin,
    yBottom,
    yLabels,
    yTop,
    type ChartLens
  } from './chart-model';
  import ChartLegend from './ChartLegend.svelte';
  import { chartCaption, goalNote } from './copy';
  import { filledEndDay } from './playhead';
  import { chartReading, playheadAt } from './results';
  import { dayPct } from './rows';

  interface Props {
    /** The window the lanes span: a day sits where it sits in every lane. */
    asOf: Day;
    windowEnd: Day;
    /** The view on show (shown.view): the held numbers while stale, as the header. */
    view: TimelineView | null;
    /** A policy is in force in the document the numbers on show came from. */
    inForce: boolean;
    /** The playhead's day: solid up to it. */
    day: Day;
    /** The furthest day reached: thinner from `day` to it; nothing past it. */
    reached: Day;
    /** The goal: its deadline's month and the homes still needed (goalStep). */
    target: { deadlineIndex: number; units: number } | null;
    stale: boolean;
    /** What it plots (Details switches it); 'effect' without a policy in force is 'homes'. */
    lens?: ChartLens;
  }

  let {
    asOf,
    windowEnd,
    view,
    inForce,
    day,
    reached,
    target: targetIn,
    stale,
    lens = 'homes'
  }: Props = $props();

  const W = 1000;
  const H = 100;
  const PAD = 2;
  const uid = $props.id();
  const shownId = `${uid}-shown`;
  const seenId = `${uid}-seen`;

  // Props arrive through getters that may fire on any parent change (a new `shown` object at
  // every month crossed, a test host's one props signal): these deriveds pass a change on only
  // when the value itself changed, so nothing below reruns as the day moves.
  const v = $derived(view);
  const force = $derived(inForce);
  const shownLens = $derived(lensOf(lens, force));
  // Only the homes lens draws the goal: elsewhere no step, no note, and the goal does not set
  // the scale, which then comes from the lens's own values.
  const target = $derived(shownLens === 'homes' ? targetIn : null);
  // The source lens's pipeline line is dashed (more than colour tells it from all homes).
  const lawDash = $derived(shownLens === 'source' ? PIPELINE_DASH : undefined);
  const goalUnits = $derived(target?.units ?? null);
  const from = $derived(asOf);
  const to = $derived(windowEnd);
  const months = $derived(v?.months ?? null);
  const xDay = (d: Day) => (dayPct(d, from, to) / 100) * W;
  /** The last row's last day: a zone edge at or past it is the plot's end (as the ruler's). */
  const last = $derived(
    months && months.length > 0 ? filledEndDay(months, months.length - 1, from) : to
  );
  const edge = (d: Day) => (d >= last ? W : xDay(d));

  // Built once per view, inForce and lens.
  const points = $derived(v ? chartPoints(v, force, shownLens) : null);
  const runMax = $derived(points ? runningMax(points) : []);
  const runMin = $derived(points ? runningMin(points) : []);
  const xs = $derived(v && points ? points.policy.map((_, j) => xDay(posDay(v, j, from))) : []);
  const lastPos = $derived(points ? points.policy.length - 1 : 0);

  // The scale reads the furthest month reached: a number, so it changes only when that does.
  const reachedPos = $derived(
    months ? Math.min(posOf(playheadAt(months, from, Math.max(reached, day))), lastPos) : 0
  );
  const top = $derived(yTop(goalUnits, runMax, reachedPos));
  const bottom = $derived(yBottom(runMin, reachedPos));
  const y = (n: number) => PAD + (1 - (n - bottom) / (top - bottom)) * (H - 2 * PAD);

  const paths = $derived.by(() => {
    if (!points) return null;
    const x = (j: number) => xs[j];
    return {
      line: linePath(points.policy, x, y),
      law: points.law ? linePath(points.law, x, y) : null,
      gap: points.law ? gapPath(points.policy, points.law, x, y) : null
    };
  });

  // Per frame only these two change.
  const dayEdge = $derived(edge(day));
  const reachedEdge = $derived(Math.max(edge(reached), dayEdge));

  const years = $derived(yearMarks(from, to));
  const labels = $derived(yLabels(top));
  const goalX = $derived(v && target ? xDay(posDay(v, target.deadlineIndex + 1, from)) : 0);
  const goalY = $derived(target ? y(target.units) : 0);
  const note = $derived(v && target ? goalNote(target.units, v.months[target.deadlineIndex]) : '');

  /** Shown and seen strokes; while stale everything takes the seen styling. */
  const SEEN = { total: 'var(--chart-total-seen)', law: 'var(--chart-law-seen)', width: 1.25 };
  const shownStroke = $derived(
    stale ? SEEN : { total: COLORS.total, law: 'var(--chart-law)', width: 2.5 }
  );

  // The overlay: positions 0 (today) to the furthest month reached.
  let focusAt = $state<number | null>(null);
  let hoverAt = $state<number | null>(null);
  const active = $derived(hoverAt ?? focusAt);
  const playPos = $derived(months ? Math.min(posOf(playheadAt(months, from, day)), reachedPos) : 0);
  const valuePos = $derived(active ?? playPos);
  const reading = $derived(v ? chartReading(v, valuePos, force, shownLens) : '');

  let overlay: HTMLElement | undefined = $state();
  function posAt(clientX: number): number {
    const r = overlay!.getBoundingClientRect();
    const f = r.width > 0 ? (clientX - r.left) / r.width : 0;
    const p = posOf(playheadAt(months!, from, from + f * (to - from)));
    return Math.min(Math.max(p, 0), reachedPos);
  }
  function onfocus() {
    focusAt = playPos;
  }
  function onblur() {
    focusAt = null;
  }
  function onkeydown(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const cur = focusAt ?? playPos;
    let next: number;
    if (e.key === 'ArrowLeft') next = Math.max(cur - 1, 0);
    else if (e.key === 'ArrowRight') next = Math.min(cur + 1, reachedPos);
    else return;
    e.preventDefault();
    focusAt = next;
  }

  // The in-plot labels are hidden from assistive tech; the caption carries the goal's figures.
  const caption = $derived(
    chartCaption(
      force,
      v && target ? { units: target.units, deadline: v.months[target.deadlineIndex] } : null,
      shownLens
    )
  );
</script>

<figure
  class="sfh-chart-row m-0"
  aria-label="Homes completed"
  data-lens={shownLens}
  data-stale={stale ? 'true' : undefined}
>
  <div class="plot relative">
    <svg
      viewBox="0 0 {W} {H}"
      preserveAspectRatio="none"
      class="block h-24 w-full"
      aria-hidden="true"
      data-testid="chart-svg"
    >
      {#if v && paths}
        <defs>
          <clipPath id={shownId} clipPathUnits="userSpaceOnUse">
            <rect x="0" y="-10" width={dayEdge} height={H + 20} data-testid="chart-clip-shown" />
          </clipPath>
          <clipPath id={seenId} clipPathUnits="userSpaceOnUse">
            <rect
              x={dayEdge}
              y="-10"
              width={reachedEdge - dayEdge}
              height={H + 20}
              data-testid="chart-clip-seen"
            />
          </clipPath>
        </defs>
        {#each years as m (m.year)}
          <line
            x1={(m.pct / 100) * W}
            x2={(m.pct / 100) * W}
            y1="0"
            y2={H}
            stroke="var(--chart-grid)"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
            data-testid="chart-year"
          />
        {/each}
        {#each labels as l (l.label)}
          <line
            x1="0"
            x2={W}
            y1={y(l.value)}
            y2={y(l.value)}
            stroke="var(--chart-grid)"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
        {/each}
        {#if target}
          <line
            x1="0"
            x2={goalX}
            y1={goalY}
            y2={goalY}
            stroke="var(--chart-ink)"
            stroke-width="1.5"
            stroke-dasharray="5 3"
            vector-effect="non-scaling-stroke"
            data-testid="chart-target"
          />
          <line
            x1={goalX}
            x2={goalX}
            y1="0"
            y2={H}
            stroke="var(--chart-ink)"
            stroke-width="1.5"
            stroke-dasharray="5 3"
            vector-effect="non-scaling-stroke"
          />
        {/if}
        <g clip-path="url(#{shownId})">
          {#if paths.gap}
            <path
              d={paths.gap}
              fill="var(--chart-gap)"
              fill-opacity={stale ? 0.5 : 1}
              data-testid="chart-gap"
            />
          {/if}
          {#if paths.law}
            <path
              d={paths.law}
              fill="none"
              stroke={shownStroke.law}
              stroke-width={shownStroke.width}
              stroke-dasharray={lawDash}
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
              data-testid="chart-law"
            />
          {/if}
          <path
            d={paths.line}
            fill="none"
            stroke={shownStroke.total}
            stroke-width={shownStroke.width}
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
            data-testid="chart-line"
          />
        </g>
        <g clip-path="url(#{seenId})">
          {#if paths.gap}
            <path
              d={paths.gap}
              fill="var(--chart-gap)"
              fill-opacity="0.5"
              data-testid="chart-gap-seen"
            />
          {/if}
          {#if paths.law}
            <path
              d={paths.law}
              fill="none"
              stroke={SEEN.law}
              stroke-width={SEEN.width}
              stroke-dasharray={lawDash}
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
              data-testid="chart-law-seen"
            />
          {/if}
          <path
            d={paths.line}
            fill="none"
            stroke={SEEN.total}
            stroke-width={SEEN.width}
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
            data-testid="chart-line-seen"
          />
        </g>
        {#if active !== null}
          <line
            x1={xs[active]}
            x2={xs[active]}
            y1="0"
            y2={H}
            stroke="var(--chart-vertical)"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
        {/if}
      {/if}
    </svg>
    {#if v && paths}
      {#each labels as l (l.label)}
        <span
          class="ylabel pointer-events-none absolute left-0.5 text-[10px] leading-none tabular-nums"
          style:top="{y(l.value)}%"
          aria-hidden="true"
          data-testid="chart-ylabel">{l.label}</span
        >
      {/each}
      {#if target}
        <span
          class="ylabel note pointer-events-none absolute text-[10px] leading-none whitespace-nowrap tabular-nums"
          class:flip={goalX > W * 0.7}
          class:below={goalY < 20}
          style:left="{(goalX / W) * 100}%"
          style:top="{goalY}%"
          aria-hidden="true"
          data-testid="chart-target-note">{note}</span
        >
      {/if}
      <div
        bind:this={overlay}
        class="overlay absolute inset-0"
        role="slider"
        tabindex="0"
        aria-label="Month in the chart"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={reachedPos}
        aria-valuenow={valuePos}
        aria-valuetext={reading}
        {onfocus}
        {onblur}
        {onkeydown}
        onpointermove={(e) => (hoverAt = posAt(e.clientX))}
        onpointerleave={() => (hoverAt = null)}
      ></div>
      {#if active !== null}
        <!-- sfh-chart-readout: Timeline.svelte's stacking rule selects it to lift the chart cell
             above the playhead line while the readout shows. Keep the class name in step. -->
        <p
          class="sfh-chart-readout readout pointer-events-none absolute top-0 m-0 rounded border border-line bg-surface px-2 py-1 text-xs whitespace-nowrap text-ink tabular-nums shadow-md dark:text-ink-dark"
          style:left="{(xs[active] / W) * 100}%"
          class:flip={xs[active] > W / 2}
          data-testid="chart-readout"
        >
          {reading}
        </p>
      {/if}
    {/if}
  </div>
  <!-- From md the legend sits in the label column beside the plot (Timeline). -->
  <ChartLegend class="md:hidden" goal={target !== null} {inForce} lens={shownLens} />
  <figcaption class="sr-only">{caption}</figcaption>
</figure>

<style>
  .overlay {
    cursor: crosshair;
  }
  .overlay:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }
  /* Value labels and the goal's note sit just under their line, haloed as the Results chart's. */
  .ylabel {
    margin-top: 2px;
    color: var(--chart-label);
    text-shadow:
      0 0 2px var(--chart-halo),
      0 0 2px var(--chart-halo),
      0 0 2px var(--chart-halo);
  }
  .note {
    color: var(--chart-ink);
    transform: translate(4px, calc(-100% - 4px));
  }
  .note.below {
    transform: translate(4px, 0);
  }
  .note.flip {
    transform: translate(calc(-100% - 4px), calc(-100% - 4px));
  }
  .note.flip.below {
    transform: translate(calc(-100% - 4px), 0);
  }
  .readout {
    transform: translateX(8px);
  }
  /* From md on a short viewport the plot is shorter, so the rows under the pinned block keep
     room. */
  @media (min-width: 768px) and (max-height: 820px) {
    .plot svg {
      height: 64px;
    }
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
