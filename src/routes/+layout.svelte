<script lang="ts">
  import './layout.css';
  import { page } from '$app/state';
  import SiteHeader from '$lib/shell/SiteHeader.svelte';
  import SiteFooter from '$lib/shell/SiteFooter.svelte';
  import { provideHeaderActions } from '$lib/shell/header-actions.svelte';
  import { isFullHeightRoute } from '$lib/shell/layout';

  let { children } = $props();
  const headerActions = provideHeaderActions();
  const full = $derived(isFullHeightRoute(page.route.id));
</script>

<a
  href="#main"
  class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:px-3 focus:py-2"
  >Skip to content</a
>
<div class={full ? 'flex h-dvh flex-col overflow-hidden' : 'flex min-h-dvh flex-col'}>
  <SiteHeader actions={headerActions.current ?? undefined} />
  <main
    id="main"
    tabindex="-1"
    class={full ? 'min-h-0 flex-1' : 'mx-auto w-full max-w-3xl flex-1 px-4 py-6'}
  >
    {@render children()}
  </main>
  <SiteFooter />
</div>
