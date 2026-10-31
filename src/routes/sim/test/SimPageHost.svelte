<script lang="ts">
  // Test host: the /sim page with the root layout's header slots rendered beside it, so the score
  // bar (the header's pinned item) and its details are reachable.
  import type { ComponentProps } from 'svelte';
  import { provideHeaderActions } from '$lib/shell/header-actions.svelte';
  import Page from '../+page.svelte';

  let { data }: { data: ComponentProps<typeof Page>['data'] } = $props();
  const slot = provideHeaderActions();
</script>

<div class="relative flex h-12 items-center gap-2">
  <div data-testid="header-status">{@render slot.status?.()}</div>
  <div data-testid="header-pinned">{@render slot.pinned?.()}</div>
  <div data-testid="header-actions">{@render slot.current?.()}</div>
</div>
<Page {data} params={{}} />
