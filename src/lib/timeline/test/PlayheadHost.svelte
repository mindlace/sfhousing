<!-- Test host: binds the Playhead's $bindable props and prints them (Playhead.svelte.spec.ts). -->
<script lang="ts">
  import type { Marker, Speed } from '$lib/fzp/types';
  import { DEFAULT_SPEED } from '$lib/fzp/playback';
  import type { Day } from '$lib/timelapse/time';
  import Playhead from '../Playhead.svelte';

  interface Props {
    asOf: Day;
    windowEnd: Day;
    last?: Day;
    end: Day;
    playable?: boolean;
    markers?: Marker[];
    startDay?: Day;
    startPlaying?: boolean;
    onday?: (day: Day) => void;
    raf?: (cb: FrameRequestCallback) => number;
    cancelRaf?: (h: number) => void;
  }
  let {
    asOf,
    windowEnd,
    end,
    playable = true,
    markers = [],
    startDay,
    startPlaying = false,
    ...rest
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  let day = $state<Day>(startDay ?? asOf);
  // svelte-ignore state_referenced_locally
  let playing = $state(startPlaying);
  let speed = $state<Speed>(DEFAULT_SPEED);
</script>

<Playhead
  {asOf}
  {windowEnd}
  {end}
  {playable}
  {markers}
  bind:day
  bind:playing
  bind:speed
  {...rest}
/>
<output data-testid="state">{day}|{playing}|{speed}</output>
