<!--
  The run's clock (game-sim, The run): while `running`, each frame advances the day at `rate` days a
  second toward min(end, stop). At the computed edge below the stop it waits with `running` true;
  at the stop it sets `running` false. It draws the playhead month and a bar of the run's span at
  the map box's top left, hidden from assistive tech.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { formatShortMonthYear } from '$lib/fzp/format';
  import { advance } from '$lib/fzp/playback';
  import type { Day } from '$lib/timelapse/time';

  interface Props {
    asOf: Day;
    /** The deadline: the run's last day. */
    stop: Day;
    /** The computed edge (`filledEnd`): the clock waits there. */
    end: Day;
    /** Days per second (`runRate`). */
    rate: number;
    day: Day;
    running: boolean;
    /** Exactly once per day change. */
    onday(day: Day): void;
    raf?: (cb: FrameRequestCallback) => number;
    cancelRaf?: (h: number) => void;
  }

  let {
    asOf,
    stop,
    end,
    rate,
    day = $bindable(),
    running = $bindable(),
    onday,
    raf = (cb) => requestAnimationFrame(cb),
    cancelRaf = (h) => cancelAnimationFrame(h)
  }: Props = $props();

  const fill = $derived(stop > asOf ? Math.min(Math.max((day - asOf) / (stop - asOf), 0), 1) : 1);

  function setDay(next: Day) {
    if (next === day) return;
    day = next;
    onday(next);
  }

  $effect(() => {
    if (!running) return;
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
      const horizon = Math.min(end, stop);
      if (clock >= horizon) {
        if (horizon >= stop) {
          running = false;
          return;
        }
        handle = raf(frame);
        return;
      }
      const r = advance(clock, dt, rate, horizon);
      clock = r.t;
      if (r.day !== day) {
        emitted = r.day;
        setDay(r.day);
      }
      if (r.done && horizon >= stop) {
        running = false;
        return;
      }
      handle = raf(frame);
    };
    handle = raf(frame);
    return () => {
      if (handle !== undefined) cancelRaf(handle);
    };
  });
</script>

<div
  class="pointer-events-none absolute top-2 left-2 z-20 rounded-md bg-white/90 px-2 py-1 text-sm shadow-sm"
  data-testid="run-clock"
  data-day={day}
  aria-hidden="true"
>
  <div class="font-medium tabular-nums">{formatShortMonthYear(day)}</div>
  <div class="mt-1 h-1 w-24 overflow-hidden rounded-full bg-neutral-200">
    <div class="h-full bg-neutral-800" style:width="{fill * 100}%"></div>
  </div>
</div>
