<script lang="ts">
  // Test host: the shared-policy page under the real SiteHeader, wired as the root layout wires
  // it, so the header's actions, pinned score bar and status slot are all reachable.
  import type { ComponentProps } from 'svelte';
  import { provideHeaderActions } from '$lib/shell/header-actions.svelte';
  import SiteHeader from '$lib/shell/SiteHeader.svelte';
  import Page from '../+page.svelte';

  let { data }: { data: ComponentProps<typeof Page>['data'] } = $props();
  const slot = provideHeaderActions();
</script>

<SiteHeader
  actions={slot.current ?? undefined}
  pinned={slot.pinned ?? undefined}
  status={slot.status ?? undefined}
  routeId="/s/[id]"
/>
<div style="height: 600px" data-testid="main">
  <Page {data} form={undefined} params={{ id: data.id }} />
</div>
