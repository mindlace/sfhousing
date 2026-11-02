<!--
  The time scrubber (design doc §4.4, layout §4.3): a native range input over [asOf, horizon] with
  keyboard overrides, marker buttons, a month readout, play/pause/replay and speed.
  The button and the readout keep a fixed width (every label stacked in one grid cell), so the
  bar does not shift. In `setup` the button reads Run and the track is disabled.
  The frame loop runs only while `playing`, through the injected `raf`, and does O(1) work.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { Day } from '$lib/timelapse/time';
  import { formatMonthYear, formatShortMonthYear, monthYearLabels } from './format';
  import { advance, DEFAULT_SPEED, SPEED_LABEL } from './playback';
  import { nextMonth, prevMonth, shiftYear, utcParts } from './time';
  import type { Marker, Speed } from './types';

  interface Props {
    asOf: Day;
    horizon: Day;
    day: Day;
    playing?: boolean;
    speed?: Speed;
    markers?: Marker[];
    /** Setup mode: the button reads Run and calls `onrun`; the track and markers are disabled. */
    setup?: boolean;
    onrun?: () => void;
    /** A Run is waiting for the latest score: the Run button is `aria-busy`. */
    busy?: boolean;
    /** Called exactly once per day change. */
    onday?: (day: Day) => void;
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
    onday,
    onheight,
    raf = (cb) => requestAnimationFrame(cb),
    cancelRaf = (h) => cancelAnimationFrame(h)
  }: Props = $props();

  const uid = $props.id();
  const speedId = `${uid}-speed`;
  const SPEEDS = Object.keys(SPEED_LABEL) as Speed[];

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

  function jump(to: Day) {
    playing = false;
    setDay(to);
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

  function oninput(e: Event & { currentTarget: HTMLInputElement }) {
    jump(Number(e.currentTarget.value));
  }

  const PLAY_LABELS = ['Run', 'Play', 'Pause', 'Replay'] as const;
  const playLabel = $derived(setup ? 'Run' : playing ? 'Pause' : atEnd ? 'Replay' : 'Play');
  const monthLabels = $derived(monthYearLabels(utcParts(day).y));
  const monthLabel = $derived(formatMonthYear(day));

  function toggle() {
    if (setup) {
      onrun?.();
      return;
    }
    if (atEnd) {
      setDay(asOf);
      playing = true;
    } else {
      playing = !playing;
    }
  }
</script>

<div
  class="sfh-fzp-scrubber flex flex-col gap-1 px-3 py-2 text-slate-900 md:flex-row md:items-center md:gap-4"
  data-testid="fzp-scrubber"
  bind:offsetHeight={height}
>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
    <button
      type="button"
      class="ctl grid items-center justify-items-center rounded-md px-3 text-sm font-medium"
      class:run={setup}
      data-testid="fzp-play"
      aria-busy={busy}
      onclick={toggle}
    >
      {#each PLAY_LABELS as l (l)}
        {#if l === playLabel}
          <span class="[grid-area:1/1]" data-testid="fzp-play-label">{l}</span>
        {:else}
          <span class="invisible [grid-area:1/1]" aria-hidden="true">{l}</span>
        {/if}
      {/each}
    </button>
    <!-- Not a live region: the date changes every frame during playback. Every month of the year
         is stacked invisibly in the cell so the readout keeps the widest label's width. -->
    <p
      class="m-0 grid text-sm font-medium whitespace-nowrap tabular-nums"
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
    <div class="flex items-center gap-1.5 text-sm">
      <label for={speedId} class="sr-only sm:not-sr-only">Speed</label>
      <select id={speedId} class="ctl rounded-md px-2" bind:value={speed}>
        {#each SPEEDS as s (s)}
          <option value={s}>{SPEED_LABEL[s]}</option>
        {/each}
      </select>
    </div>
  </div>

  <div class="grid min-w-0 grid-cols-[auto_1fr_auto] items-center gap-x-2 text-xs md:flex-1">
    <span>{formatShortMonthYear(asOf)}</span>
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
    />
    <span>{utcParts(horizon).y}</span>
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
    background: #fff;
    border-top: 1px solid #cbd5e1;
    overflow-x: clip;
  }
  .ctl {
    min-width: 32px;
    min-height: 32px;
    border: 1px solid #64748b;
    background: #fff;
    color: inherit;
  }
  .ctl:disabled {
    opacity: 0.5;
  }
  .ctl:hover:not(:disabled) {
    background: #f1f5f9;
  }
  .track {
    min-height: 32px;
    accent-color: #a3472c;
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
    outline: 2px solid #a3472c;
    outline-offset: 2px;
  }
  /* Run (setup only) carries the app accent (spec §8); Play, Pause and Replay stay plain. */
  .run {
    border-color: #a3472c;
    background: #a3472c;
    color: #fff;
  }
  .run:hover:not(:disabled) {
    border-color: #84371f;
    background: #84371f;
  }
  @media (prefers-color-scheme: dark) {
    .sfh-fzp-scrubber {
      background: #1c1d1f;
      border-top-color: #3b3d41;
      color: #e8e4dc;
    }
    .ctl {
      border-color: #8f8a80;
      background: #232427;
    }
    .ctl:hover:not(:disabled) {
      background: #2c2e31;
    }
    .marker {
      border-color: transparent;
      background: transparent;
    }
    .track {
      accent-color: #e0955a;
    }
    .ctl:focus-visible,
    .track:focus-visible {
      outline-color: #e0955a;
    }
    .run {
      border-color: #e0955a;
      background: #e0955a;
      color: #1c1d1f;
    }
    .run:hover:not(:disabled) {
      border-color: #ebae7e;
      background: #ebae7e;
    }
  }
  /* The repo's coarse-pointer pattern (BrushToolbar): 44 px targets. */
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
