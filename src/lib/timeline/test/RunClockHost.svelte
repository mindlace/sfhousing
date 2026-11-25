<!--
  Test host: a RunClock binding its day and running, exposed with the end through a `ctl` object
  the spec passes in (RunClock.svelte.spec.ts).
-->
<script lang="ts" module>
  import type { Day } from '$lib/timelapse/time';

  export interface RunClockCtl {
    day?: () => Day;
    running?: () => boolean;
    end?: () => Day;
    setEnd?: (d: Day) => void;
  }
</script>

<script lang="ts">
  import RunClock from '../RunClock.svelte';

  interface Props {
    asOf: Day;
    stop: Day;
    end: Day;
    rate: number;
    ctl: RunClockCtl;
    onday?: (day: Day) => void;
    raf?: (cb: FrameRequestCallback) => number;
    cancelRaf?: (h: number) => void;
  }
  let { asOf, stop, end: endProp, rate, ctl, onday = () => {}, raf, cancelRaf }: Props = $props();

  // svelte-ignore state_referenced_locally
  let day = $state<Day>(asOf);
  let running = $state(true);
  // svelte-ignore state_referenced_locally
  let end = $state<Day>(endProp);

  // svelte-ignore state_referenced_locally
  Object.assign(ctl, {
    day: () => day,
    running: () => running,
    end: () => end,
    setEnd: (d: Day) => {
      end = d;
    }
  });
</script>

<div class="relative h-40 w-80">
  <RunClock {asOf} {stop} {end} {rate} bind:day bind:running {onday} {raf} {cancelRaf} />
</div>
