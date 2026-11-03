<script lang="ts">
  // Test host: NoticePills around two pills (none with `empty`), inside a positioned host as
  // FzpMode and BrushEditor render it.
  import NoticePills from '../NoticePills.svelte';
  import { PILL, PILL_ACTION } from '../pill';

  let { empty = false }: { empty?: boolean } = $props();
</script>

<div data-testid="pills-host" class="sfh-dock-host relative" style="height: 400px">
  <NoticePills>
    {#if !empty}
      <p role="status" class="{PILL} pr-4">First notice</p>
      <p role="status" class={PILL}>
        <span>Second notice</span>
        <button type="button" class={PILL_ACTION}>Retry</button>
      </p>
    {/if}
  </NoticePills>
</div>
