<script lang="ts">
  // Test host: the shared-plan page with the root layout's header-actions slot rendered beside it.
  import type { ComponentProps } from 'svelte';
  import { provideHeaderActions } from '$lib/shell/header-actions.svelte';
  import Page from '../+page.svelte';

  let { data }: { data: ComponentProps<typeof Page>['data'] } = $props();
  const slot = provideHeaderActions();
</script>

<div data-testid="header-actions">{@render slot.current?.()}</div>
<Page {data} form={undefined} params={{ id: data.id }} />
