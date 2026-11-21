<!--
  Test host: SimDetails with its `lens` bound to the host's state, as TimelineMode binds it, shown in
  `host-lens`. `shown` false unmounts Details and keeps the host (closing Details on the page).
-->
<script lang="ts">
  import { untrack, type ComponentProps } from 'svelte';
  import type { ChartLens } from '../chart-lens';
  import SimDetails from '../SimDetails.svelte';

  type Props = Omit<ComponentProps<typeof SimDetails>, 'lens'> & {
    initialLens?: ChartLens;
    shown?: boolean;
  };
  let { initialLens = 'homes', shown = true, ...rest }: Props = $props();
  let lens = $state<ChartLens>(untrack(() => initialLens));
</script>

<output data-testid="host-lens">{lens}</output>
{#if shown}
  <SimDetails {...rest} bind:lens />
{/if}
