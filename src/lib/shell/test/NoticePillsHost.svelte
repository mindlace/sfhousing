<script lang="ts">
  // Test host: NoticePills around two pills, as FzpMode renders them.
  import NoticePills from '../NoticePills.svelte';
  import { PILL, PILL_ACTION } from '../pill';
</script>

<NoticePills>
  <p role="status" class="{PILL} pr-4">First notice</p>
  <p role="status" class={PILL}>
    <span>Second notice</span>
    <button type="button" class={PILL_ACTION}>Retry</button>
  </p>
</NoticePills>
