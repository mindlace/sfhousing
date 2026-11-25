<script lang="ts">
  // Stands in for $lib/sim-page/SimRoute.svelte: records each mount and its props.
  import { simRoute } from './sim-route-stub';

  const props: Record<string, unknown> = $props();
  simRoute.mounts += 1;
  // The props object itself: a test reads its current values.
  // svelte-ignore state_referenced_locally
  simRoute.props = props;
</script>

<div data-testid="sim-route-stub"></div>
