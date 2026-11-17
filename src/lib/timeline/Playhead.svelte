<!--
  The playhead (rules 23, 24): transport controls, a fixed-width month readout and a slider over
  [asOf, windowEnd] that reaches only as far as `end`, the filled mark. A key, a drag or a jump
  pauses. At `end` before the window's end playback idles with `playing` still true and goes on by
  itself when `end` grows; at the window's end `playing` becomes false. Nothing plays on mount.
  The Ruler sits below the slider; its marker jumps go through `jump`, so they pause too. The root
  is `display: contents`: in the timeline's grid the controls span both columns and the slider and
  Ruler sit on the lane column.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { formatMonthYear, monthYearLabels } from '$lib/fzp/format';
  import { advance, DEFAULT_SPEED, SPEED_NAME } from '$lib/fzp/playback';
  import { utcParts } from '$lib/fzp/time';
  import type { Marker, Speed } from '$lib/fzp/types';
  import type { Day } from '$lib/timelapse/time';
  import { clampDay, keyTarget } from './playhead';
  import Ruler from './Ruler.svelte';

  interface Props {
    asOf: Day;
    windowEnd: Day;
    /** The filled mark (`filledEndDay`): the playhead never goes past it. */
    end: Day;
    day: Day;
    playing?: boolean;
    speed?: Speed;
    /** Play is off while the forecast refills after an edit (rule 24). */
    playable?: boolean;
    /** The Ruler's jump markers; a jump pauses, clamps to `end` and reports through `onday`. */
    markers?: Marker[];
    /** Called exactly once per day change. */
    onday?: (day: Day) => void;
    /** Test seams. */
    raf?: (cb: FrameRequestCallback) => number;
    cancelRaf?: (h: number) => void;
  }

  let {
    asOf,
    windowEnd,
    end,
    day = $bindable(),
    playing = $bindable(false),
    speed = $bindable(DEFAULT_SPEED),
    playable = true,
    markers = [],
    onday,
    raf = (cb) => requestAnimationFrame(cb),
    cancelRaf = (h) => cancelAnimationFrame(h)
  }: Props = $props();

  const span = $derived(Math.max(windowEnd - asOf, 1));
  const pct = (d: Day) => `${(Math.min(Math.max((d - asOf) / span, 0), 1) * 100).toFixed(3)}%`;
  const atWindowEnd = $derived(day >= windowEnd && !playing);

  function setDay(next: Day) {
    if (next === day) return;
    day = next;
    onday?.(next);
  }

  // An edit stops playback until the forecast is whole again.
  $effect(() => {
    if (!playable && playing) playing = false;
  });

  $effect(() => {
    if (!playing) return;
    let handle: number | undefined;
    let last: number | null = null;
    let clock: number = untrack(() => day);
    let emitted: Day = clock;
    const frame: FrameRequestCallback = (ts) => {
      const dt = last === null ? 0 : ts - last;
      last = ts;
      // The day moved by something other than this loop: continue from there.
      if (day !== emitted) {
        clock = day;
        emitted = day;
      }
      if (clock >= end) {
        // At the filled mark: wait for it to grow, or stop at the window's end.
        if (clock >= windowEnd) {
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
      if (r.done && end >= windowEnd) {
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

  function onkeydown(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const to = keyTarget(e.key, day, asOf, end);
    if (to === null) return;
    e.preventDefault();
    jump(to);
  }

  let track: HTMLElement | undefined = $state();
  let dragging = false;
  function dayAt(clientX: number): Day {
    const r = track!.getBoundingClientRect();
    const f = r.width > 0 ? (clientX - r.left) / r.width : 0;
    return clampDay(Math.round(asOf + f * span), asOf, end);
  }
  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0 || !track) return;
    dragging = true;
    track.setPointerCapture(e.pointerId);
    track.focus();
    jump(dayAt(e.clientX));
  }
  function onpointermove(e: PointerEvent) {
    if (dragging) jump(dayAt(e.clientX));
  }
  function onpointerup() {
    dragging = false;
  }

  const PLAY_LABELS = ['Play', 'Replay'] as const;
  const playLabel = $derived(atWindowEnd ? 'Replay' : 'Play');
  const monthLabels = $derived(monthYearLabels(utcParts(day).y));
  const monthLabel = $derived(formatMonthYear(day));
  const WHY_OFF = 'Play is back when the forecast is filled.';
  const reasonId = $props.id();

  function play(s: Speed) {
    if (!playable) return;
    if (atWindowEnd) setDay(asOf);
    speed = s;
    playing = true;
  }
</script>

<div class="sfh-playhead text-ink dark:text-ink-dark">
  <div class="controls flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="tl-controls">
    <button
      type="button"
      class="ctl grid items-center justify-items-center rounded-md px-2"
      data-testid="tl-pause"
      aria-label="Pause"
      onclick={() => (playing = false)}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
        <rect x="3" y="2" width="3.5" height="12" rx="0.5" />
        <rect x="9.5" y="2" width="3.5" height="12" rx="0.5" />
      </svg>
    </button>
    <button
      type="button"
      class="ctl flex items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium"
      class:off={!playable}
      data-testid="tl-play"
      aria-disabled={!playable}
      aria-describedby={playable ? undefined : `${reasonId}-why`}
      aria-pressed={playing && speed === 'year'}
      onclick={() => play('year')}
    >
      <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
        <path d="M3 1.5v13l11-6.5z" />
      </svg>
      <span class="grid items-center justify-items-center">
        {#each PLAY_LABELS as l (l)}
          {#if l === playLabel}
            <span class="[grid-area:1/1]" data-testid="tl-play-label">{l}</span>
          {:else}
            <span class="invisible [grid-area:1/1]" aria-hidden="true">{l}</span>
          {/if}
        {/each}
      </span>
    </button>
    {#if !playable}
      <span id="{reasonId}-why" class="sr-only">{WHY_OFF}</span>
    {/if}
    <button
      type="button"
      class="ctl grid items-center justify-items-center rounded-md px-2"
      class:off={!playable}
      data-testid="tl-faster"
      aria-label="Faster"
      aria-disabled={!playable}
      aria-describedby={playable ? undefined : `${reasonId}-why`}
      aria-pressed={playing && speed === 'threeYears'}
      title={SPEED_NAME.threeYears}
      onclick={() => play('threeYears')}
    >
      <svg viewBox="0 0 20 16" width="18" height="14" fill="currentColor" aria-hidden="true">
        <path d="M2 1.5v13l8-6.5z" />
        <path d="M10 1.5v13l8-6.5z" />
      </svg>
    </button>
    <button
      type="button"
      class="ctl rounded-md px-2 text-xs"
      data-testid="tl-today"
      aria-label="Jump to today, {formatMonthYear(asOf)}"
      onclick={() => jump(asOf)}
    >
      Today
    </button>
    <!-- Not a live region: the date changes every frame during playback. Every month of the year
         is stacked invisibly in the cell so the readout keeps the widest label's width. -->
    <p
      class="m-0 ml-1 grid text-sm font-medium whitespace-nowrap tabular-nums"
      data-testid="tl-readout"
    >
      {#each monthLabels as l (l)}
        {#if l === monthLabel}
          <span class="[grid-area:1/1]" data-testid="tl-readout-label">{l}</span>
        {:else}
          <span class="invisible [grid-area:1/1]" aria-hidden="true">{l}</span>
        {/if}
      {/each}
    </p>
  </div>

  <div class="axis min-w-0" data-testid="tl-axis">
    <div
      bind:this={track}
      class="track relative min-w-0"
      role="slider"
      tabindex="0"
      aria-label="Date in the simulation"
      aria-orientation="horizontal"
      aria-valuemin={asOf}
      aria-valuemax={windowEnd}
      aria-valuenow={day}
      aria-valuetext={monthLabel}
      {onkeydown}
      {onpointerdown}
      {onpointermove}
      {onpointerup}
      onpointercancel={onpointerup}
    >
      <div class="rail"></div>
      <div class="filled" style:width={pct(end)}></div>
      <div class="thumb" style:left={pct(day)}></div>
    </div>
    <Ruler
      {asOf}
      {windowEnd}
      filledEnd={end}
      {markers}
      onjump={(d) => jump(clampDay(d, asOf, end))}
    />
  </div>
</div>

<style>
  /* Its parts are the timeline grid's cells: the controls span the label and lane columns, the
     slider and Ruler sit on the lane column, so they share the lanes' x scale. */
  .sfh-playhead {
    display: contents;
  }
  .controls {
    grid-column: 1 / -1;
  }
  .axis {
    grid-column: 2;
  }
  .ctl {
    min-width: 32px;
    min-height: 32px;
    border: 1px solid var(--color-control-line);
    background: var(--color-surface);
    color: inherit;
  }
  .ctl.off {
    opacity: 0.5;
  }
  .ctl:hover:not(.off) {
    background: var(--color-surface-raised);
  }
  .track {
    min-height: 32px;
    cursor: pointer;
    touch-action: none;
  }
  .rail,
  .filled {
    position: absolute;
    top: 14px;
    height: 4px;
    border-radius: 2px;
    left: 0;
  }
  .rail {
    right: 0;
    background: var(--color-line);
  }
  .filled {
    background: var(--color-ink-muted);
  }
  .thumb {
    position: absolute;
    top: 6px;
    width: 4px;
    height: 20px;
    margin-left: -2px;
    border-radius: 2px;
    background: var(--color-accent);
  }
  .ctl:focus-visible,
  .track:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  @media (prefers-color-scheme: dark) {
    .ctl {
      border-color: var(--color-control-line-dark);
      background: var(--color-surface-dark);
    }
    .ctl:hover:not(.off) {
      background: var(--color-surface-dark-raised);
    }
    .rail {
      background: var(--color-line-dark);
    }
    .filled {
      background: var(--color-ink-dark-muted);
    }
    .thumb {
      background: var(--color-accent-dark);
    }
    .ctl:focus-visible,
    .track:focus-visible {
      outline-color: var(--color-accent-dark);
    }
  }
  @media (pointer: coarse) {
    .ctl,
    .track {
      min-width: 44px;
      min-height: 44px;
    }
    .rail,
    .filled {
      top: 20px;
    }
    .thumb {
      top: 12px;
    }
  }
</style>
