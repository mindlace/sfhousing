<script lang="ts">
  // Test host: the main page with the root layout's header-actions and pinned slots rendered
  // beside it.
  import type { ComponentProps } from 'svelte';
  import { provideHeaderActions } from '$lib/shell/header-actions.svelte';
  import Page from '../+page.svelte';

  let { data }: { data: ComponentProps<typeof Page>['data'] } = $props();
  const slot = provideHeaderActions();
</script>

<div data-testid="header-pinned">{@render slot.pinned?.()}</div>
<div data-testid="header-actions">{@render slot.current?.()}</div>
<Page {data} params={{}} />
