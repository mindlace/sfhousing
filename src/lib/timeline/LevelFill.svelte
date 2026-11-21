<!--
  A pool's level inside its bar (timeline-ui, "A pool's bar shows its level"), under the bar's
  text: the empty part of the money received so far, from the bar's top down to the level, and the
  level's edge as a line in the bar's text colour (3:1 and more against the bar in both themes).
  The empty part darkens the bar where its text is light and lightens it where its text is dark, so
  the text only gains contrast over it. Each month's level holds across that month, so at the
  playhead it is the month the bar's name reads (", 62% left", `levelLeft`). Drawn like the chart
  (ChartRow): one path, under a shown clip from the bar's start to the playhead's day and, at half
  strength with a thinner edge, a seen clip from the day to the furthest day reached; nothing past
  it. The paths are built once per level and box; as the day moves only the clip edges change.
  Nothing animates. Hidden from assistive tech: the percentage is in the bar's name.
-->
<script lang="ts">
  import type { Day } from '$lib/timelapse/time';
  import { levelIndexAt, levelLine, levelPath, levelPercent } from './pool-level';

  interface Props {
    /** The pool's level by month (`poolLevel`). */
    level: Float64Array;
    months: readonly Day[];
    asOf: Day;
    /** The bar's first and last day: the box the svg spans. */
    from: Day;
    to: Day;
    /** The playhead's day: shown up to it. */
    day: Day;
    /** The furthest day reached: seen from `day` to it; nothing past it. */
    reached: Day;
    /** The numbers on show are held while an edit waits: both zones take the seen styling. */
    stale?: boolean;
  }

  let { level, months, asOf, from, to, day, reached, stale = false }: Props = $props();

  const W = 1000;
  const H = 20;
  const uid = $props.id();
  const shownId = `${uid}-shown`;
  const seenId = `${uid}-seen`;

  // Props arrive through getters that may fire on any parent change: these pass a change on only
  // when the value itself changed, so the paths below are not rebuilt as the day moves.
  const lv = $derived(level);
  const ms = $derived(months);
  const a0 = $derived(asOf);
  const x0 = $derived(from);
  const x1 = $derived(to);

  // Built once per level and box, never as the day moves.
  const area = $derived(levelPath(lv, ms, a0, x0, x1));
  const line = $derived(levelLine(lv, ms, a0, x0, x1));

  const x = (d: Day) => Math.min(Math.max((d - x0) / Math.max(x1 - x0, 1), 0), 1) * W;
  const dayX = $derived(x(day));
  const seenW = $derived(Math.max(x(reached) - dayX, 0));
  const left = $derived(levelPercent(lv, levelIndexAt(ms, a0, day, x0, x1)));
</script>

<svg
  class="level"
  viewBox="0 0 {W} {H}"
  preserveAspectRatio="none"
  aria-hidden="true"
  data-testid="tl-level"
  data-left={left === null ? '' : String(left)}
  data-stale={stale ? 'true' : undefined}
>
  <defs>
    <clipPath id={shownId} clipPathUnits="userSpaceOnUse">
      <rect x="0" y="-1" width={dayX} height={H + 2} data-testid="tl-level-clip-shown" />
    </clipPath>
    <clipPath id={seenId} clipPathUnits="userSpaceOnUse">
      <rect x={dayX} y="-1" width={seenW} height={H + 2} data-testid="tl-level-clip-seen" />
    </clipPath>
  </defs>
  <g clip-path="url(#{shownId})" data-testid="tl-level-shown">
    <path d={area} fill="var(--level-empty)" fill-opacity={stale ? '0.5' : '1'} />
    <path
      d={line}
      fill="none"
      stroke="var(--on-k)"
      stroke-width={stale ? '1' : '1.5'}
      vector-effect="non-scaling-stroke"
    />
  </g>
  <g clip-path="url(#{seenId})" data-testid="tl-level-seen">
    <path d={area} fill="var(--level-empty)" fill-opacity="0.5" />
    <path
      d={line}
      fill="none"
      stroke="var(--on-k)"
      stroke-width="1"
      vector-effect="non-scaling-stroke"
    />
  </g>
</svg>

<style>
  /* `--level-empty` and `--on-k` are the timeline's (Timeline.svelte `.tl`, both themes). */
  .level {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
</style>
