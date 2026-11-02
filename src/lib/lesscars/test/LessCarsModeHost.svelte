<script lang="ts">
  // Test host: LessCarsMode with the root layout's header slots rendered beside it (a copy of
  // src/lib/fzp/test/FzpModeHost.svelte). The bar stands in for SiteHeader: positioned and 48 px
  // tall, so the headline details drop below it as in the page.
  import type { ComponentProps } from 'svelte';
  import { provideHeaderActions } from '$lib/shell/header-actions.svelte';
  import LessCarsMode from '../LessCarsMode.svelte';

  let props: ComponentProps<typeof LessCarsMode> = $props();
  const slot = provideHeaderActions();
</script>

<div class="relative flex h-12 items-center justify-end gap-2 px-4">
  <div data-testid="header-pinned">{@render slot.pinned?.()}</div>
  <div data-testid="header-actions">{@render slot.current?.()}</div>
</div>
<!-- Sized like the page's #map-region, so the overlays sit below the header slot. -->
<div id="map-region" class="relative" style="height: 600px">
  <LessCarsMode {...props} />
</div>
