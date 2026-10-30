<script lang="ts">
  // Test host: FzpMode with the root layout's header slots rendered beside it (the pattern of
  // src/lib/shell/test/Host.svelte and src/routes/test/PageHost.svelte). The bar stands in for
  // SiteHeader: positioned and 48 px tall, so the score details drop below it as in the page.
  import type { ComponentProps } from 'svelte';
  import { provideHeaderActions } from '$lib/shell/header-actions.svelte';
  import FzpMode from '../FzpMode.svelte';

  let props: ComponentProps<typeof FzpMode> = $props();
  const slot = provideHeaderActions();
</script>

<div class="relative flex h-12 items-center justify-end gap-2 px-4">
  <div data-testid="header-pinned">{@render slot.pinned?.()}</div>
  <div data-testid="header-actions">{@render slot.current?.()}</div>
</div>
<!-- Sized like the page's #map-region, so the overlays sit below the header slot. -->
<div id="map-region" class="relative" style="height: 600px">
  <FzpMode {...props} />
</div>
