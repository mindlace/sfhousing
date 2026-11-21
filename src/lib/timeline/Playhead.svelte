<!--
  The playhead (rules 3, 23, 24): one row of the timeline's grid. In the label cell the transport:
  Play (Pause while playing, Replay at `last`, "Play from {year}" when offered) on line 1, the
  speed and Today on line 2. The lane cell is the ruler and the slider in one: the years, the
  track in three zones (shown from today to the day, seen from there to the furthest date
  reached, unseen and hatched past it), the thumb, the date flag over it and the goal flag under
  the track. A press or drag anywhere on it, a key or Today pauses and moves the day, never past
  `end`, the computed edge. At `end` before `last` playback waits with `playing` still true and
  goes on by itself when `end` grows; at `last` `playing` becomes false. Nothing plays on mount.
  The root is `display: contents`, so both cells are the grid's.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { formatMonthYear } from '$lib/fzp/format';
  import { advance, DEFAULT_SPEED } from '$lib/fzp/playback';
  import { monthStart } from '$lib/fzp/time';
  import type { Speed } from '$lib/fzp/types';
  import type { Day } from '$lib/timelapse/time';
  import { yearMarks } from './axis';
  import { GOAL_FLAG, rulerDescription, speedName } from './copy';
  import { clampDay, dateFlag, keyTarget, playLabel } from './playhead';

  interface Props {
    asOf: Day;
    /** The lanes' scale: the ruler spans [asOf, windowEnd]. */
    windowEnd: Day;
    /**
     * The furthest day the playhead may reach: the last day of the last calendar month row
     * (default `windowEnd`). Playback stops there, Replay shows there, `aria-valuemax` is it. A
     * zone edge at or past it is drawn at the track's end.
     */
    last?: Day;
    /** The computed edge (`filledEndDay`): the playhead never goes past it and waits there. */
    end: Day;
    day: Day;
    playing?: boolean;
    speed?: Speed;
    /** The furthest day reached: shown up to `day`, seen from there to here, unseen past it. */
    reached: Day;
    /** "Play from {year}": Play moves the day here (onday) and plays. Null: Play or Replay. */
    playFrom?: Day | null;
    /** The goal flag's day; null hides the flag and the description's deadline sentence. */
    goalDeadline?: Day | null;
    /** Called exactly once per day change. */
    onday?: (day: Day) => void;
    /** Test seams. */
    raf?: (cb: FrameRequestCallback) => number;
    cancelRaf?: (h: number) => void;
  }

  let {
    asOf,
    windowEnd,
    last = windowEnd,
    end,
    day = $bindable(),
    playing = $bindable(false),
    speed = $bindable(DEFAULT_SPEED),
    reached,
    playFrom = null,
    goalDeadline = null,
    onday,
    raf = (cb) => requestAnimationFrame(cb),
    cancelRaf = (h) => cancelAnimationFrame(h)
  }: Props = $props();

  const span = $derived(Math.max(windowEnd - asOf, 1));
  /** Day `d`'s place across the track, 0 to 100. */
  const at = (d: Day) => Math.min(Math.max((d - asOf) / span, 0), 1) * 100;
  /** A zone edge: at or past `last` it is the track's end, so a whole forecast has no sliver. */
  const edge = (d: Day) => (d >= last ? 100 : at(d));
  const dayEdge = $derived(edge(day));
  const reachedEdge = $derived(Math.max(edge(reached), dayEdge));
  const atLast = $derived(day >= last && !playing);
  const years = $derived(yearMarks(asOf, windowEnd));
  const flag = $derived(dateFlag(day, asOf));

  // A year label the date flag overlaps is hidden whole, never cut. The ruler's width and a
  // label's width are measured on resize only; per frame this reads at most the 9 year marks
  // and yields a string, so a label's class changes only when the flag reaches or leaves it.
  /** The date flag's width (.flag --w). */
  const FLAG_W = 64;
  /** Clear space kept between the flag and a year label. */
  const FLAG_GAP = 2;
  let rulerW = $state(0);
  let yearW = $state(0);
  const covered = $derived.by(() => {
    if (rulerW <= FLAG_W) return '';
    const x = (at(day) / 100) * rulerW;
    const left = Math.min(Math.max(x - FLAG_W / 2, 0), rulerW - FLAG_W) - FLAG_GAP;
    const right = left + FLAG_W + 2 * FLAG_GAP;
    let out = ' ';
    for (const t of years) {
      const c = (t.pct / 100) * rulerW;
      const a = t.pct === 0 ? 0 : c - yearW / 2;
      if (a < right && a + yearW > left) out += `${t.year} `;
    }
    return out;
  });
  const label = $derived(playLabel({ playing, playFrom, atLast }));
  /** "Seen up to …" only while the furthest month reached is after the playhead's month. */
  const seenAhead = $derived(monthStart(reached) > monthStart(day));
  const description = $derived(rulerDescription(seenAhead ? reached : null, goalDeadline));
  const descId = $props.id();

  function setDay(next: Day) {
    if (next === day) return;
    day = next;
    onday?.(next);
  }

  $effect(() => {
    if (!playing) return;
    let handle: number | undefined;
    let prevTs: number | null = null;
    let clock: number = untrack(() => day);
    let emitted: Day = clock;
    const frame: FrameRequestCallback = (ts) => {
      const dt = prevTs === null ? 0 : ts - prevTs;
      prevTs = ts;
      // The day moved by something other than this loop: continue from there.
      if (day !== emitted) {
        clock = day;
        emitted = day;
      }
      if (clock >= end) {
        // At the computed edge: wait for it to grow, or stop at `last`.
        if (clock >= last) {
          playing = false;
          return;
        }
        handle = raf(frame);
        return;
      }
      const r = advance(clock, dt, speed, end);
      clock = r.t;
      if (r.day !== day) {
        emitted = r.day;
        setDay(r.day);
      }
      if (r.done && end >= last) {
        playing = false;
        return;
      }
      handle = raf(frame);
    };
    handle = raf(frame);
    return () => {
      if (handle !== undefined) cancelRaf(handle);
    };
  });

  function jump(to: Day) {
    playing = false;
    setDay(to);
  }

  function onplay() {
    if (playing) {
      playing = false;
      return;
    }
    if (playFrom !== null) setDay(clampDay(playFrom, asOf, end));
    else if (atLast) setDay(asOf);
    playing = true;
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const to = keyTarget(e.key, day, asOf, end);
    if (to === null) return;
    e.preventDefault();
    jump(to);
  }

  let ruler: HTMLElement | undefined = $state();
  $effect(() => {
    const el = ruler;
    if (!el) return;
    const measure = () => {
      rulerW = el.clientWidth;
      yearW = el.querySelector<HTMLElement>('.year')?.offsetWidth ?? 0;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });
  let dragging = false;
  function dayAt(clientX: number): Day {
    const r = ruler!.getBoundingClientRect();
    const f = r.width > 0 ? (clientX - r.left) / r.width : 0;
    return clampDay(Math.round(asOf + f * span), asOf, end);
  }
  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0 || !ruler) return;
    dragging = true;
    ruler.setPointerCapture(e.pointerId);
    ruler.focus();
    jump(dayAt(e.clientX));
  }
  function onpointermove(e: PointerEvent) {
    if (dragging) jump(dayAt(e.clientX));
  }
  function onpointerup() {
    dragging = false;
  }
</script>

<div class="sfh-playhead text-ink dark:text-ink-dark">
  <div class="controls" data-testid="tl-controls">
    <button type="button" class="ctl play" data-testid="tl-play" onclick={onplay}>
      <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
        {#if playing}
          <rect x="3" y="2" width="3.5" height="12" rx="0.5" />
          <rect x="9.5" y="2" width="3.5" height="12" rx="0.5" />
        {:else}
          <path d="M3 1.5v13l11-6.5z" />
        {/if}
      </svg>
      <span data-testid="tl-play-label">{label}</span>
    </button>
    <div class="line2">
      <button
        type="button"
        class="ctl small tabular-nums"
        data-testid="tl-speed"
        aria-label={speedName(speed)}
        onclick={() => (speed = speed === 'year' ? 'threeYears' : 'year')}
        >{speed === 'year' ? '1×' : '3×'}</button
      >
      <button
        type="button"
        class="ctl small"
        data-testid="tl-today"
        aria-label="Jump to today, {formatMonthYear(asOf)}"
        onclick={() => jump(asOf)}
      >
        Today
      </button>
    </div>
  </div>

  <div class="axis" data-testid="tl-axis">
    <!-- Not a live region: the value changes every frame during playback. -->
    <div
      bind:this={ruler}
      class="ruler"
      data-testid="tl-ruler"
      role="slider"
      tabindex="0"
      aria-label="Date in the simulation"
      aria-orientation="horizontal"
      aria-valuemin={asOf}
      aria-valuemax={last}
      aria-valuenow={day}
      aria-valuetext={formatMonthYear(day)}
      aria-describedby={description ? descId : undefined}
      {onkeydown}
      {onpointerdown}
      {onpointermove}
      {onpointerup}
      onpointercancel={onpointerup}
    >
      <div class="years" data-testid="tl-years" aria-hidden="true">
        {#each years as t (t.year)}
          <span
            class="year text-ink-muted tabular-nums dark:text-ink-dark-muted"
            class:first={t.pct === 0}
            class:covered={covered.includes(` ${t.year} `)}
            data-testid="tl-year"
            style:left="{t.pct}%">{t.year}</span
          >
        {/each}
      </div>
      <div class="track" data-testid="tl-track" aria-hidden="true">
        <i class="zone shown" data-testid="tl-zone-shown" style:width="{dayEdge}%"></i>
        <i
          class="zone seen"
          data-testid="tl-zone-seen"
          style:left="{dayEdge}%"
          style:width="{reachedEdge - dayEdge}%"
        ></i>
        <i class="zone unseen" data-testid="tl-zone-unseen" style:left="{reachedEdge}%"></i>
        <i class="thumb" data-testid="tl-thumb" style:left="{at(day)}%"></i>
      </div>
      <span
        class="flag tabular-nums"
        data-testid="tl-flag"
        aria-hidden="true"
        style:--at="{at(day)}%">{flag}</span
      >
      {#if goalDeadline !== null}
        <span
          class="goal text-ink-muted dark:text-ink-dark-muted"
          data-testid="tl-goal-flag"
          aria-hidden="true"
          style:left="{at(goalDeadline)}%">{GOAL_FLAG}</span
        >
      {/if}
    </div>
    {#if description}
      <span id={descId} class="sr-only">{description}</span>
    {/if}
  </div>
</div>

<style>
  /* Its two cells are the timeline grid's: the transport in the label column, the ruler in the
     lane column, so the ruler shares the lanes' x scale. */
  .sfh-playhead {
    display: contents;
  }
  /* Two lines: Play at the cell's width, then speed and Today (32 + 4 + 32). Below md the cell
     has no padding and line 2 is two 44 px buttons (92 px). */
  .controls {
    grid-column: 1;
    display: grid;
    grid-template-rows: auto auto;
    align-content: start;
    gap: 4px;
    min-width: 0;
  }
  .line2 {
    display: flex;
    gap: 4px;
  }
  .axis {
    grid-column: 2;
    position: relative;
    min-width: 0;
  }
  .ctl {
    min-width: 32px;
    min-height: 32px;
    border: 1px solid var(--color-control-line);
    border-radius: 6px;
    background: var(--color-surface);
    color: inherit;
  }
  .ctl:hover {
    background: var(--color-surface-raised);
  }
  .play {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 2px 4px;
    font-size: 12px;
    line-height: 1.25;
    font-weight: 500;
    text-align: start;
  }
  .play svg {
    flex: none;
  }
  .small {
    width: 44px;
    padding: 0 2px;
    font-size: 12px;
  }
  @media (min-width: 768px) {
    .controls {
      padding: 0 10px;
    }
    .play {
      gap: 6px;
      padding: 0 12px;
      font-size: 14px;
      line-height: 20px;
      white-space: nowrap;
    }
    .small {
      width: auto;
      padding: 0 8px;
    }
  }
  /* The whole lane cell: the years on top, the track in the middle, the goal flag under it. */
  .ruler {
    position: absolute;
    inset: 0;
    cursor: pointer;
    touch-action: none;
  }
  .years {
    position: absolute;
    inset: 0 0 auto;
    height: 16px;
  }
  .year {
    position: absolute;
    top: 0;
    font-size: 12px;
    line-height: 16px;
    transform: translateX(-50%);
  }
  .year.first {
    transform: none;
  }
  .year.covered {
    visibility: hidden;
  }
  .track {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 6px;
    margin-top: -3px;
  }
  .zone {
    position: absolute;
    inset-block: 0;
  }
  .shown {
    left: 0;
    border-radius: 3px 0 0 3px;
    background: var(--color-ink-muted);
  }
  .seen {
    background: var(--color-control-line);
  }
  .unseen {
    right: 0;
    background-image: repeating-linear-gradient(
      135deg,
      transparent 0 3px,
      var(--color-control-line) 3px 4px
    );
  }
  .thumb {
    position: absolute;
    top: 50%;
    width: 4px;
    height: 20px;
    margin: -10px 0 0 -2px;
    border-radius: 2px;
    background: var(--color-accent);
  }
  /* The date flag rides the thumb on the year line; a year label it overlaps is hidden
     (.covered). It keeps inside the cell at either end. Its width is FLAG_W in the script. */
  .flag {
    --w: 64px;
    position: absolute;
    top: 0;
    left: clamp(0px, calc(var(--at) - var(--w) / 2), calc(100% - var(--w)));
    width: var(--w);
    height: 16px;
    border-radius: 3px;
    font-size: 12px;
    line-height: 16px;
    font-weight: 500;
    text-align: center;
    white-space: nowrap;
    background: var(--color-accent);
    color: var(--color-on-accent);
  }
  .goal {
    position: absolute;
    bottom: 0;
    font-size: 12px;
    line-height: 16px;
    transform: translateX(-50%);
    white-space: nowrap;
  }
  .ctl:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .ruler:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }
  @media (prefers-color-scheme: dark) {
    .ctl {
      border-color: var(--color-control-line-dark);
      background: var(--color-surface-dark);
    }
    .ctl:hover {
      background: var(--color-surface-dark-raised);
    }
    .shown {
      background: var(--color-ink-dark-muted);
    }
    .seen {
      background: var(--color-control-line-dark);
    }
    .unseen {
      background-image: repeating-linear-gradient(
        135deg,
        transparent 0 3px,
        var(--color-control-line-dark) 3px 4px
      );
    }
    .thumb,
    .flag {
      background: var(--color-accent-dark);
    }
    .flag {
      color: var(--color-on-accent-dark);
    }
    .ctl:focus-visible,
    .ruler:focus-visible {
      outline-color: var(--color-accent-dark);
    }
  }
  /* From md on a short viewport the pinned block is compact (24 + 4 + 24), so the rows under it
     keep room. A coarse pointer keeps its 44 px (below). */
  @media (min-width: 768px) and (max-height: 820px) {
    .ctl {
      min-width: 24px;
      min-height: 24px;
    }
    .thumb {
      height: 16px;
      margin-top: -8px;
    }
  }
</style>
