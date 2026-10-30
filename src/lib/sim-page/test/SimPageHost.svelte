<script lang="ts">
  // Test host: SimPage under the real SiteHeader, wired as the root layout wires it.
  import type { ComponentProps } from 'svelte';
  import { provideHeaderActions } from '$lib/shell/header-actions.svelte';
  import SiteHeader from '$lib/shell/SiteHeader.svelte';
  import SimPage from '../SimPage.svelte';

  let props: ComponentProps<typeof SimPage> = $props();
  const slot = provideHeaderActions();
</script>

<SiteHeader actions={slot.current ?? undefined} pinned={slot.pinned ?? undefined} routeId="/sim" />
<div id="map-region" class="relative" style="height: 600px" data-testid="map">
  <SimPage {...props} />
</div>
