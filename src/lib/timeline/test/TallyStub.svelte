<!--
  Test double for Tally: records the props of each mount, in mount order, and how many are mounted
  now. Its first button is `tally-continue`, calling `oncontinue`, as in Tally.
-->
<script module lang="ts">
  import type { ComponentProps } from 'svelte';
  import type Tally from '$lib/game/ui/Tally.svelte';

  type TallyProps = ComponentProps<typeof Tally>;

  /** Each mount's props, in mount order; `live` counts the stubs mounted now. */
  export const tallyRec: { mounts: TallyProps[]; live: number; reset(): void } = {
    mounts: [],
    live: 0,
    reset() {
      tallyRec.mounts = [];
      tallyRec.live = 0;
    }
  };
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';

  let props: TallyProps = $props();

  untrack(() => {
    tallyRec.mounts.push({ ...props });
    tallyRec.live++;
  });
  onDestroy(() => {
    tallyRec.live--;
  });
</script>

<div data-testid="tally-stub">
  <button type="button" data-testid="tally-continue" onclick={() => props.oncontinue()}
    >Continue</button
  >
</div>
