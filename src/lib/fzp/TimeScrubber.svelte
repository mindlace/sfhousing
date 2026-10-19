<!--
  The time scrubber (design doc §4.4, layout §4.3): a native range input over [asOf, horizon] with
  keyboard overrides, marker buttons, a Simulation readout, play/pause/replay and speed.
  The frame loop runs only while `playing`, through the injected `raf`, and does O(1) work.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { Day } from '$lib/timelapse/time';
  import { formatMonthYear, formatShortMonthYear } from './format';
  import { advance, DEFAULT_SPEED, SPEED_LABEL } from './playback';
  import { nextMonth, prevMonth, shiftYear, utcParts } from './time';
  import type { Marker, Speed } from './types';

  interface Props {
    asOf: Day;
    horizon: Day;
    day: Day;
    playing?: boolean;
    speed?: Speed;
    /** The first false-to-true transition starts playback, unless reduced motion is set. */
    autoplay?: boolean;
    markers?: Marker[];
    /** Called exactly once per day change. */
    onday?: (day: Day) => void;
    onheight?: (px: number) => void;
    /** Test seams. */
    raf?: (cb: FrameRequestCallback) => number;
    cancelRaf?: (h: number) => void;
    reducedMotion?: () => boolean;
  }

  let {
    asOf,
    horizon,
    day = $bindable(),
    playing = $bindable(false),
    speed = $bindable(DEFAULT_SPEED),
    autoplay = false,
    markers = [],
    onday,
    onheight,
    raf = (cb) => requestAnimationFrame(cb),
    cancelRaf = (h) => cancelAnimationFrame(h),
    reducedMotion = () => {
      try {
        return matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch {
        return false;
      }
    }
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

  // The autoplay latch is deliberately not reactive: it fires once per mount.
  let autoplayed = false;
  $effect(() => {
    if (!autoplay || autoplayed) return;
    autoplayed = true;
    if (!reducedMotion()) playing = true;
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

  function onkeydown(e: KeyboardEvent) {
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

  function toggle() {
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
    <button type="button" class="ctl rounded-md px-3 text-sm font-medium" onclick={toggle}>
      {playing ? 'Pause' : atEnd ? 'Replay' : 'Play'}
    </button>
    <!-- Not a live region: the date changes every frame during playback. -->
    <p class="m-0 flex items-center gap-1.5 text-sm whitespace-nowrap" data-testid="fzp-readout">
      <span class="pill rounded-full px-2 py-0.5 text-xs font-semibold">Simulation</span>
      <span aria-hidden="true">·</span>
      <span class="font-medium">{formatMonthYear(day)}</span>
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
          style:left="{((m.day - asOf) / span) * 100}%"
          aria-label={m.name}
          onclick={() => jump(m.day)}
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
  .ctl:hover {
    background: #f1f5f9;
  }
  .track {
    min-height: 32px;
    accent-color: #1d4ed8;
  }
  .markers {
    min-height: 32px;
  }
  .pill {
    background: #0f172a;
    color: #fff;
  }
  .marker {
    transform: translateX(-50%);
    border-color: transparent;
    background: transparent;
    text-decoration: underline;
  }
  .ctl:focus-visible,
  .track:focus-visible {
    outline: 2px solid #1d4ed8;
    outline-offset: 2px;
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
