<script lang="ts">
  // Test host: FzpMode with the root layout's header-actions slot rendered beside it (the pattern
  // of src/lib/shell/test/Host.svelte and src/routes/test/PageHost.svelte).
  import type { ComponentProps } from 'svelte';
  import { provideHeaderActions } from '$lib/shell/header-actions.svelte';
  import FzpMode from '../FzpMode.svelte';

  let props: ComponentProps<typeof FzpMode> = $props();
  const slot = provideHeaderActions();
</script>

<div data-testid="header-actions">{@render slot.current?.()}</div>
<!-- Sized like the page's #map-region, so the overlays sit below the header slot. -->
<div id="map-region" class="relative" style="height: 600px">
  <FzpMode {...props} />
</div>
