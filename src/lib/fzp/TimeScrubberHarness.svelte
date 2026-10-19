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
    autoplay?: boolean;
    startDay?: Day;
    startPlaying?: boolean;
    onday?: (day: Day) => void;
    raf?: (cb: FrameRequestCallback) => number;
    cancelRaf?: (h: number) => void;
    reducedMotion?: () => boolean;
    onheight?: (px: number) => void;
  }
  let {
    asOf,
    horizon,
    markers = [],
    autoplay: autoplayStart = false,
    startDay,
    startPlaying = false,
    ...rest
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  let day = $state<Day>(startDay ?? asOf);
  // svelte-ignore state_referenced_locally
  let playing = $state(startPlaying);
  let speed = $state<Speed>(DEFAULT_SPEED);
  // svelte-ignore state_referenced_locally
  let autoplay = $state(autoplayStart);
</script>

<TimeScrubber {asOf} {horizon} {markers} bind:day bind:playing bind:speed {autoplay} {...rest} />
<button type="button" data-testid="autoplay-flip" onclick={() => (autoplay = !autoplay)}>AP</button>
<output data-testid="state">{day}|{playing}|{speed}</output>
