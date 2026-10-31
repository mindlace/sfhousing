<script lang="ts">
  // Test host: the real site header, filled from the main page through the header slots.
  import type { ComponentProps } from 'svelte';
  import { provideHeaderActions } from '$lib/shell/header-actions.svelte';
  import SiteHeader from '$lib/shell/SiteHeader.svelte';
  import Page from '../+page.svelte';

  let { data }: { data: ComponentProps<typeof Page>['data'] } = $props();
  const slot = provideHeaderActions();
</script>

<SiteHeader
  routeId="/"
  actions={slot.current ?? undefined}
  pinned={slot.pinned ?? undefined}
  status={slot.status ?? undefined}
/>
<Page {data} params={{}} />
