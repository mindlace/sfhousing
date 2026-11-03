<!-- Test harness: binds the scrubber's $bindable props and prints them (TimeScrubber.svelte.spec.ts). -->
<script lang="ts">
  import type { Day } from '$lib/timelapse/time';
  import { DEFAULT_SPEED } from './playback';
  import TimeScrubber from './TimeScrubber.svelte';
  import type { Marker, Speed } from './types';

  interface Props {
    asOf: Day;
    horizon: Day;
    markers?: Marker[];
    startDay?: Day;
    startPlaying?: boolean;
    setup?: boolean;
    onrun?: () => void;
    onday?: (day: Day) => void;
    ontoday?: () => void;
    startLabel?: string;
    raf?: (cb: FrameRequestCallback) => number;
    cancelRaf?: (h: number) => void;
    onheight?: (px: number) => void;
  }
  let {
    asOf,
    horizon,
    markers = [],
    startDay,
    startPlaying = false,
    ontoday,
    ...rest
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  let day = $state<Day>(startDay ?? asOf);
  // svelte-ignore state_referenced_locally
  let playing = $state(startPlaying);
  let speed = $state<Speed>(DEFAULT_SPEED);
  let todayCalls = $state(0);
</script>

<TimeScrubber
  {asOf}
  {horizon}
  {markers}
  bind:day
  bind:playing
  bind:speed
  ontoday={() => {
    todayCalls += 1;
    ontoday?.();
  }}
  {...rest}
/>
<output data-testid="today-calls">{todayCalls}</output>
<output data-testid="state">{day}|{playing}|{speed}</output>
