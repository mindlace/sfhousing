<!--
  Test host: the Playhead in a two-column grid like the timeline's pinned block (a 168 px label
  column from md, 92 px below), binding its $bindable props and printing them
  (Playhead.svelte.spec.ts).
-->
<script lang="ts">
  import type { Speed } from '$lib/fzp/types';
  import { DEFAULT_SPEED } from '$lib/fzp/playback';
  import type { Day } from '$lib/timelapse/time';
  import Playhead from '../Playhead.svelte';

  interface Props {
    asOf: Day;
    windowEnd: Day;
    last?: Day;
    end: Day;
    reached?: Day;
    playFrom?: Day | null;
    goalDeadline?: Day | null;
    barDay?: Day | null;
    startDay?: Day;
    startPlaying?: boolean;
    startSpeed?: Speed;
    onday?: (day: Day) => void;
    raf?: (cb: FrameRequestCallback) => number;
    cancelRaf?: (h: number) => void;
  }
  let {
    asOf,
    windowEnd,
    end,
    reached = undefined,
    startDay,
    startPlaying = false,
    startSpeed = DEFAULT_SPEED,
    ...rest
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  let day = $state<Day>(startDay ?? asOf);
  // svelte-ignore state_referenced_locally
  let playing = $state(startPlaying);
  // svelte-ignore state_referenced_locally
  let speed = $state<Speed>(startSpeed);
</script>

<div class="host grid" data-testid="host-grid">
  <Playhead
    {asOf}
    {windowEnd}
    {end}
    reached={reached ?? day}
    bind:day
    bind:playing
    bind:speed
    {...rest}
  />
</div>
<output data-testid="state">{day}|{playing}|{speed}</output>

<style>
  .host {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
  }
  @media (min-width: 768px) {
    .host {
      grid-template-columns: 168px minmax(0, 1fr);
    }
  }
</style>
