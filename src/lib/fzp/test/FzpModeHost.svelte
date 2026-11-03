<script lang="ts">
  // Test host: FzpMode with the root layout's header slots rendered beside it (the pattern of
  // src/lib/shell/test/Host.svelte and src/routes/test/PageHost.svelte). The bar stands in for
  // SiteHeader: positioned and 48 px tall. Unless the test passes its own `panel` and `onscore`,
  // the host stands in for /sim's dock: the header score shows and hides FzpMode's Results
  // snippet in a region named "Results" (`data-testid="score-details"`, as the dock's face).
  import type { ComponentProps, Snippet } from 'svelte';
  import { provideHeaderActions } from '$lib/shell/header-actions.svelte';
  import FzpMode from '../FzpMode.svelte';

  let {
    panel = undefined,
    onscore = undefined,
    scoreExpanded = undefined,
    ...rest
  }: ComponentProps<typeof FzpMode> = $props();
  const slot = provideHeaderActions();
  let shown = $state(false);
</script>

{#snippet hostPanel(results: Snippet)}
  {#if shown}
    <div
      role="region"
      aria-label="Results"
      data-testid="score-details"
      class="absolute top-0 left-0 z-40 max-h-full w-80 overflow-y-auto bg-white"
    >
      {@render results()}
    </div>
  {/if}
{/snippet}

<div class="relative flex h-12 items-center justify-end gap-2 px-4">
  <div data-testid="header-pinned">{@render slot.pinned?.()}</div>
  <div data-testid="header-actions">{@render slot.current?.()}</div>
</div>
<!-- Sized like the page's #map-region, so the overlays sit below the header slot. -->
<div id="map-region" class="relative" style="height: 600px">
  <FzpMode
    {...rest}
    panel={panel ?? hostPanel}
    scoreExpanded={scoreExpanded ?? shown}
    onscore={onscore ?? (() => (shown = !shown))}
  />
</div>
