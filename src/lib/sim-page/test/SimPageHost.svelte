<script lang="ts">
  // Test host: SimPage under the real SiteHeader, wired as the root layout wires it. Autosave
  // goes to an in-memory storage of its own unless the test passes one, so tests never share
  // the browser's localStorage.
  import type { ComponentProps } from 'svelte';
  import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
  import { provideHeaderActions } from '$lib/shell/header-actions.svelte';
  import SiteHeader from '$lib/shell/SiteHeader.svelte';
  import SimPage from '../SimPage.svelte';

  let props: ComponentProps<typeof SimPage> = $props();
  const slot = provideHeaderActions();
  const own = new MemoryStorage();
  const storage = $derived(props.storage ?? (() => own));
</script>

<SiteHeader
  actions={slot.current ?? undefined}
  pinned={slot.pinned ?? undefined}
  status={slot.status ?? undefined}
  routeId="/sim"
/>
<div id="map-region" class="relative" style="height: 600px" data-testid="map">
  <SimPage {...props} {storage} />
</div>
