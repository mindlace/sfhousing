<!-- Test host: /sim's key (SimKey) inside the shared MapKeyControl, as TimelineMode mounts it. -->
<script lang="ts">
  import MapKeyControl from '$lib/map/key/MapKeyControl.svelte';
  import SimKey from '../SimKey.svelte';
  import type { KeyTally } from '../key';

  let { tally, inForce }: { tally: KeyTally | null; inForce: boolean } = $props();
</script>

<div class="relative w-full" style:height="600px">
  <MapKeyControl openFromMd>
    {#snippet key()}
      <SimKey {tally} {inForce} />
    {/snippet}
  </MapKeyControl>
</div>
