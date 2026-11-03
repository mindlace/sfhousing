<!--
  The time scrubber (design doc §4.4, layout §4.3): a native range input over [asOf, horizon] with
  keyboard overrides, start and end marker buttons, marker buttons under the track, a month
  readout and sim-game transport controls: Pause, Play (1 year/s) and Faster (3 years/s).
  The Play button and the readout keep a fixed width (every label stacked in one grid cell), so
  the bar does not shift. In `setup` Play reads Run, Pause and Faster are invisible (they keep
  their space) and the track and every marker are disabled.
  The frame loop runs only while `playing`, through the injected `raf`, and does O(1) work.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { Day } from '$lib/timelapse/time';
  import { formatMonthYear, formatShortMonthYear, monthYearLabels } from './format';
  import { advance, DEFAULT_SPEED, SPEED_NAME } from './playback';
  import { nextMonth, prevMonth, shiftYear, utcParts } from './time';
  import type { Marker, Speed } from './types';

  interface Props {
    asOf: Day;
    horizon: Day;
    day: Day;
    playing?: boolean;
    speed?: Speed;
    markers?: Marker[];
    /** Setup mode: Play reads Run and calls `onrun`; the track and markers are disabled. */
    setup?: boolean;
    onrun?: () => void;
    /** A Run is waiting for the latest score: the Run button is `aria-busy`. */
    busy?: boolean;
    /** The start marker's visible text (default `formatShortMonthYear(asOf)`; /sim passes 'Today'). */
    startLabel?: string;
    /** Called exactly once per day change. */
    onday?: (day: Day) => void;
    /**
     * A user jump landed on `asOf` outside setup: Home, the start marker, an arrow or Page key
     * clamped to it, or a drag released there (the range's `change`). Not Replay, not a drag
     * passing through, not a programmatic `day` change.
     */
    ontoday?: () => void;
    onheight?: (px: number) => void;
    /** Test seams. */
    raf?: (cb: FrameRequestCallback) => number;
    cancelRaf?: (h: number) => void;
  }

  let {
    asOf,
    horizon,
    day = $bindable(),
    playing = $bindable(false),
    speed = $bindable(DEFAULT_SPEED),
    markers = [],
    setup = false,
    onrun,
    busy = false,
    startLabel,
    onday,
    ontoday,
    onheight,
    raf = (cb) => requestAnimationFrame(cb),
    cancelRaf = (h) => cancelAnimationFrame(h)
  }: Props = $props();

  let height = $state(0);
  $effect(() => {
    if (height > 0) onheight?.(height);
  });

  const atEnd = $derived(day >= horizon && !playing);
  const span = $derived(Math.max(horizon - asOf, 1));

  /** Sets the day and reports it, once, only when it changed. */
  function setDay(next: Day) {
    if (next === day) return;
    day = next;
    onday?.(next);
  }

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
      const r = advance(clock, dt, speed, horizon);
      clock = r.t;
      if (r.day !== day) {
        emitted = r.day;
        setDay(r.day);
      }
      if (r.done) {
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

  /** A jump pauses and moves the day; a user jump onto `asOf` outside setup also reports it. */
  function jump(to: Day, user = true) {
    playing = false;
    setDay(to);
    if (user && !setup && to === asOf) ontoday?.();
  }

  /** A marker's day inside the track: a target before `asOf` (or after the horizon) is its end. */
  const clampDay = (d: Day): Day => Math.min(Math.max(d, asOf), horizon);

  function onkeydown(e: KeyboardEvent) {
    if (setup) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    let to: Day;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        to = prevMonth(day, asOf);
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        to = nextMonth(day, horizon);
        break;
      case 'PageDown':
        to = shiftYear(day, -1, asOf, horizon);
        break;
      case 'PageUp':
        to = shiftYear(day, 1, asOf, horizon);
        break;
      case 'Home':
        to = asOf;
        break;
      case 'End':
        to = horizon;
        break;
      default:
        return;
    }
    e.preventDefault();
    jump(to);
  }

  // A drag passes through `asOf` on input events; only its release (change) is a jump to it.
  function oninput(e: Event & { currentTarget: HTMLInputElement }) {
    jump(Number(e.currentTarget.value), false);
  }

  function onchange(e: Event & { currentTarget: HTMLInputElement }) {
    if (!setup && Number(e.currentTarget.value) === asOf) ontoday?.();
  }

  const PLAY_LABELS = ['Run', 'Play', 'Replay'] as const;
  const playLabel = $derived(setup ? 'Run' : atEnd ? 'Replay' : 'Play');
  const startText = $derived(startLabel ?? formatShortMonthYear(asOf));
  const endYear = $derived(utcParts(horizon).y);
  const monthLabels = $derived(monthYearLabels(utcParts(day).y));
  const monthLabel = $derived(formatMonthYear(day));

  function pause() {
    playing = false;
  }

  /** Plays at `s`; at the end it restarts from `asOf` first (Replay), which is not a Today jump. */
  function play(s: Speed) {
    if (atEnd) setDay(asOf);
    speed = s;
    playing = true;
  }

  function onplay() {
    if (setup) onrun?.();
    else play('year');
  }
</script>

<div
  class="sfh-fzp-scrubber flex flex-col gap-1 px-3 py-2 text-ink md:flex-row md:items-center md:gap-4"
  data-testid="fzp-scrubber"
  bind:offsetHeight={height}
>
  <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
    <button
      type="button"
      class="ctl grid items-center justify-items-center rounded-md px-2"
      class:invisible={setup}
      data-testid="fzp-pause"
      aria-label="Pause"
      onclick={pause}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
        <rect x="3" y="2" width="3.5" height="12" rx="0.5" />
        <rect x="9.5" y="2" width="3.5" height="12" rx="0.5" />
      </svg>
    </button>
    <button
      type="button"
      class="ctl flex items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium"
      class:run={setup}
      data-testid="fzp-play"
      aria-busy={busy}
      aria-pressed={setup ? undefined : playing && speed === 'year'}
      onclick={onplay}
    >
      <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
        <path d="M3 1.5v13l11-6.5z" />
      </svg>
      <span class="grid items-center justify-items-center">
        {#each PLAY_LABELS as l (l)}
          {#if l === playLabel}
            <span class="[grid-area:1/1]" data-testid="fzp-play-label">{l}</span>
          {:else}
            <span class="invisible [grid-area:1/1]" aria-hidden="true">{l}</span>
          {/if}
        {/each}
      </span>
    </button>
    <button
      type="button"
      class="ctl grid items-center justify-items-center rounded-md px-2"
      class:invisible={setup}
      data-testid="fzp-faster"
      aria-label="Faster"
      aria-pressed={playing && speed === 'threeYears'}
      title={SPEED_NAME.threeYears}
      onclick={() => play('threeYears')}
    >
      <svg viewBox="0 0 20 16" width="18" height="14" fill="currentColor" aria-hidden="true">
        <path d="M2 1.5v13l8-6.5z" />
        <path d="M10 1.5v13l8-6.5z" />
      </svg>
    </button>
    <!-- Not a live region: the date changes every frame during playback. Every month of the year
         is stacked invisibly in the cell so the readout keeps the widest label's width. -->
    <p
      class="m-0 ml-1 grid text-sm font-medium whitespace-nowrap tabular-nums"
      data-testid="fzp-readout"
    >
      {#each monthLabels as l (l)}
        {#if l === monthLabel}
          <span class="[grid-area:1/1]" data-testid="fzp-readout-label">{l}</span>
        {:else}
          <span class="invisible [grid-area:1/1]" aria-hidden="true">{l}</span>
        {/if}
      {/each}
    </p>
  </div>

  <div class="grid min-w-0 grid-cols-[auto_1fr_auto] items-center gap-x-2 text-xs md:flex-1">
    <button
      type="button"
      class="end ctl rounded-md px-2"
      data-testid="fzp-start"
      aria-label="Jump to {startText}, {formatMonthYear(asOf)}"
      disabled={setup}
      onclick={() => jump(asOf)}
    >
      {startText}
    </button>
    <input
      type="range"
      class="track min-w-0"
      aria-label="Date in the simulation"
      aria-valuetext={formatMonthYear(day)}
      min={asOf}
      max={horizon}
      step="1"
      value={day}
      disabled={setup}
      {onkeydown}
      {oninput}
      {onchange}
    />
    <button
      type="button"
      class="end ctl rounded-md px-2"
      data-testid="fzp-end"
      aria-label="Jump to {endYear}"
      disabled={setup}
      onclick={() => jump(horizon)}
    >
      {endYear}
    </button>
    <!-- Under the range: the same column, so a marker's percentage lines up with the thumb. -->
    <div class="markers relative col-start-2">
      {#each markers as m (m.name)}
        <button
          type="button"
          class="marker ctl absolute top-0 rounded-md px-1.5 whitespace-nowrap"
          style:left="{((clampDay(m.day) - asOf) / span) * 100}%"
          aria-label={m.name}
          disabled={setup}
          onclick={() => jump(clampDay(m.day))}
        >
          {m.label}
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .sfh-fzp-scrubber {
    background: var(--color-surface);
    border-top: 1px solid var(--color-line);
    overflow-x: clip;
  }
  .ctl {
    min-width: 32px;
    min-height: 32px;
    border: 1px solid var(--color-control-line);
    background: var(--color-surface);
    color: inherit;
  }
  .ctl:disabled {
    opacity: 0.5;
  }
  .ctl:hover:not(:disabled) {
    background: var(--color-surface-raised);
  }
  .track {
    min-height: 32px;
    accent-color: var(--color-accent);
  }
  .markers {
    min-height: 32px;
  }
  .marker {
    transform: translateX(-50%);
    border-color: transparent;
    background: transparent;
    text-decoration: underline;
  }
  .ctl:focus-visible,
  .track:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  /* Run (setup only) carries the app accent (spec §8); Play, Pause and Replay stay plain. */
  .run {
    border-color: var(--color-accent);
    background: var(--color-accent);
    color: var(--color-on-accent);
  }
  .run:hover:not(:disabled) {
    border-color: var(--color-accent-hover);
    background: var(--color-accent-hover);
  }
  @media (prefers-color-scheme: dark) {
    .sfh-fzp-scrubber {
      background: var(--color-surface-dark);
      border-top-color: var(--color-line-dark);
      color: var(--color-ink-dark);
    }
    .ctl {
      border-color: var(--color-control-line-dark);
      background: var(--color-surface-dark);
    }
    .ctl:hover:not(:disabled) {
      background: var(--color-surface-dark-raised);
    }
    .marker {
      border-color: transparent;
      background: transparent;
    }
    .track {
      accent-color: var(--color-accent-dark);
    }
    .ctl:focus-visible,
    .track:focus-visible {
      outline-color: var(--color-accent-dark);
    }
    .run {
      border-color: var(--color-accent-dark);
      background: var(--color-accent-dark);
      color: var(--color-on-accent-dark);
    }
    .run:hover:not(:disabled) {
      border-color: var(--color-accent-dark-hover);
      background: var(--color-accent-dark-hover);
    }
  }
  /* The repo's coarse-pointer pattern (the Paint tab's tools): 44 px targets. */
  @media (pointer: coarse) {
    .ctl,
    .track,
    .markers {
      min-width: 44px;
      min-height: 44px;
    }
    .markers {
      min-width: 0;
    }
  }
</style>
