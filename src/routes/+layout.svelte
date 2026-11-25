<script lang="ts">
  import './layout.css';
  import { page } from '$app/state';
  import { currentUser } from '$lib/account/current-user.svelte';
  import SiteHeader from '$lib/shell/SiteHeader.svelte';
  import SiteFooter from '$lib/shell/SiteFooter.svelte';
  import { provideHeaderActions } from '$lib/shell/header-actions.svelte';
  import { isFullHeightRoute } from '$lib/shell/layout';
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { e2eOpen } from '$lib/game/e2e';
  import { createSaveSync } from '$lib/game/save-sync.svelte';
  import { GameStore, openGame, provideGame } from '$lib/game/store.svelte';
  import { getStorage } from '$lib/sharing/storage';

  let { children } = $props();
  const headerActions = provideHeaderActions();

  function makeGame(): GameStore {
    if (!browser) return openGame();
    const storage = getStorage();
    if (e2eOpen(storage)) return openGame();
    const sync = createSaveSync({
      storage,
      fetchFn: (input, init) => fetch(input, init),
      signedIn: () => page.data.user != null
    });
    const store = new GameStore({ storage, sync });
    sync.attach(store);
    return store;
  }
  provideGame(makeGame());
  const full = $derived(isFullHeightRoute(page.route.id));

  // VITE_E2E build only: marks hydration for e2e (helpers/sharing.ts gotoHydrated). SvelteKit
  // starts its router in the same microtask chain as this onMount, so once a test sees the mark,
  // a link click is a client navigation, never a full page load.
  onMount(() => {
    if (import.meta.env.VITE_E2E === '1') document.documentElement.dataset.hydrated = '';
  });
</script>

<a href="#main" class="sr-only focus:not-sr-only focus:bg-white focus:px-3 focus:py-2"
  >Skip to content</a
>
<!-- The map pages are themed whole, so in dark they declare the dark color-scheme (native
     scrollbars and control internals follow). The document pages are light at every setting, so
     they keep the default (`:root` declares nothing). -->
<div
  class={full ? 'flex h-dvh flex-col overflow-hidden dark:scheme-dark' : 'flex min-h-dvh flex-col'}
>
  <SiteHeader
    actions={headerActions.current ?? undefined}
    pinned={headerActions.pinned ?? undefined}
    status={headerActions.status ?? undefined}
    user={currentUser.overlay(page.data.user)}
    signInAvailable={page.data.signInAvailable ?? true}
    routeId={page.route.id}
  />
  <main
    id="main"
    tabindex="-1"
    class={full ? 'min-h-0 flex-1' : 'mx-auto w-full max-w-3xl flex-1 px-4 py-6'}
  >
    {@render children()}
  </main>
  {#if !full}<SiteFooter />{/if}
</div>
