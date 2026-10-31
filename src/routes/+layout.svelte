<script lang="ts">
  import './layout.css';
  import { page } from '$app/state';
  import SiteHeader from '$lib/shell/SiteHeader.svelte';
  import SiteFooter from '$lib/shell/SiteFooter.svelte';
  import { provideHeaderActions } from '$lib/shell/header-actions.svelte';
  import { isFullHeightRoute } from '$lib/shell/layout';
  import { onMount } from 'svelte';

  let { children } = $props();
  const headerActions = provideHeaderActions();
  const full = $derived(isFullHeightRoute(page.route.id));

  // VITE_E2E build only: marks hydration for e2e (helpers/sharing.ts gotoHydrated). SvelteKit
  // starts its router in the same microtask chain as this onMount, so once a test sees the mark,
  // a link click is a client navigation, never a full page load.
  onMount(() => {
    if (import.meta.env.VITE_E2E === '1') document.documentElement.dataset.hydrated = '';
  });
</script>

<a
  href="#main"
  class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:px-3 focus:py-2"
  >Skip to content</a
>
<div class={full ? 'flex h-dvh flex-col overflow-hidden' : 'flex min-h-dvh flex-col'}>
  <SiteHeader
    actions={headerActions.current ?? undefined}
    pinned={headerActions.pinned ?? undefined}
    status={headerActions.status ?? undefined}
    routeId={page.route.id}
  />
  <main
    id="main"
    tabindex="-1"
    class={full ? 'min-h-0 flex-1' : 'mx-auto w-full max-w-3xl flex-1 px-4 py-6'}
  >
    {@render children()}
  </main>
  <SiteFooter />
</div>
