<!--
  The site header. There are no steps: the name is the way home. The bar holds the name, the round
  (plain text, after mount, for a game in its runs; never the open game), the page's status, the
  pinned item (centred in the bar from lg when both sides fit; a side that does not pushes it off
  centre, never clips; below sm it leads the bar and grows to the Menu, the status after it), and,
  from lg, the page's actions, then the Menu button (a hamburger named "Menu", never a dot) at
  every width. The Menu's panel (under the header; from lg a pop-over at the right, below lg full
  width) holds, in order: the site name and the round (below sm, on a page that pins an item: Paint,
  /sim, /p/:id), the actions (below lg only), the game panel (saved games, New game, the sync line;
  after mount, never for the open game), the account entry (Sign in, or @handle; Sign in shows only while
  a sign-in method is in effect, `signInAvailable`) and About (on every route: the map pages have no
  footer). The status is the page's one status cell, never in the Menu: left of the pinned item,
  except below sm with one, where it sits between the pinned item and the Menu, after it in the DOM
  too (`phone`, known after mount; the move waits while a modal dialog is open, as `wide` does). On
  Paint and /sim the save state (nothing when saved), and on /sim "Updating" takes its place while
  the numbers are stale or Play waits, beside it when autosave is off, with its explanation button.
  The actions render once: in the bar when `wide` (known after mount), else in the panel.
  Placement: the `<header>` is `relative`, and the pinned slot's box is a direct child of it with no
  position class (never `relative`, `absolute`, `fixed` or `sticky`) and no wrapper of its own
  around the snippet, so a pinned item's pop-over (the round panel) places itself against
  the header, inside its gutters.
-->
<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import { AUTH_COPY } from '$lib/account/copy';
  import GamePanel from '$lib/game/ui/GamePanel.svelte';
  import { useGame } from '$lib/game/store.svelte';
  import { roundName } from '$lib/game/ui/round-words';
  import { headerOverlay } from './header-actions.svelte';
  import { SITE_NAME } from './name';

  let {
    actions,
    pinned,
    status,
    user = null,
    signInAvailable = true,
    routeId = null
  }: {
    actions?: Snippet;
    pinned?: Snippet;
    /** The page's status cell (the save state; on /sim "Updating" takes its place, or sits beside
     * it when autosave is off). */
    status?: Snippet;
    /** The signed-in account's handle, or null when signed out. */
    user?: { handle: string } | null;
    /** Whether any sign-in method is in effect; without one a signed-out visitor sees no Sign in. */
    signInAvailable?: boolean;
    routeId?: string | null;
  } = $props();

  const WIDE = '(min-width: 1024px)';
  /** Below sm (Tailwind's `max-sm`). */
  const PHONE = '(width < 40rem)';
  const uid = $props.id();
  const panelId = `${uid}-menu`;

  // The About and account entries: a resting border so they read as pressable.
  const link =
    'inline-flex min-h-6 min-w-6 items-center whitespace-nowrap rounded-md border px-2 no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-accent-dark';
  const tab = (current: boolean) => [
    link,
    current
      ? 'cursor-default border-transparent bg-accent text-on-accent dark:bg-accent-dark dark:text-on-accent-dark'
      : 'border-gray-500 hover:bg-gray-100 dark:border-gray-400 dark:hover:bg-chrome-dark-raised'
  ];

  const game = useGame();
  // The first client render matches the server's: the game's state shows only after mount.
  let mounted = $state(false);
  /**
   * The round, plain text after the name: a game in its runs on the game's page, `/`; never the
   * open game, and never on another page (a shared plan or policy, About), whatever game the
   * browser holds.
   */
  const round = $derived(
    mounted && routeId === '/' && !game.open && game.state.phase === 'runs'
      ? roundName(game.state.round, game.state.finished)
      : null
  );
  const account = $derived(user ?? (mounted ? game.sync.account : null));
  // From lg the actions are in the bar, below lg in the Menu: one instance at any width.
  let wide = $state(false);
  // Below sm, with a pinned item, the status renders after it: DOM order is visual order.
  let phone = $state(false);
  const statusAfter = $derived(!!pinned && phone);

  let open = $state(false);
  let header = $state<HTMLElement>();
  let menuButton = $state<HTMLButtonElement>();
  /** From lg the panel is a pop-over: SURFACE_POP (ui.ts), each class with `lg:` (ui.spec.ts). */
  const PANEL_POP =
    'lg:rounded-lg lg:border lg:border-line lg:bg-surface lg:p-2 lg:text-sm lg:text-ink lg:shadow-lg lg:dark:border-line-dark lg:dark:bg-surface-dark lg:dark:text-ink-dark lg:dark:scheme-dark';
  let panel = $state<HTMLDivElement>();

  const openOnly = headerOverlay(panelId, () => (open = false));

  function toggle(): void {
    open = !open;
    if (open) openOnly();
  }

  async function close(refocus: boolean): Promise<void> {
    open = false;
    if (!refocus) return;
    await tick();
    menuButton?.focus();
  }

  function onkeydown(e: KeyboardEvent): void {
    if (!open || e.key !== 'Escape' || e.defaultPrevented) return;
    // A modal dialog (Publish) or a disclosure open inside the menu takes Escape first.
    if (document.querySelector('dialog:modal')) return;
    if (panel?.querySelector('[aria-expanded="true"]')) return;
    const a = document.activeElement;
    void close(!a || a === document.body || !!header?.contains(a));
  }

  // A press anywhere but the Menu button and its panel closes the menu, including on the pinned
  // item: the pinned score bar's details open in the same place, so the two never show together.
  function onpointerdown(e: PointerEvent): void {
    const t = e.target as Node | null;
    if (!open || !t || menuButton?.contains(t) || panel?.contains(t)) return;
    if (document.querySelector('dialog:modal')) return;
    void close(false);
  }

  /** Choosing an item closes the menu: a link, or a button that opens nothing of its own. */
  function onpanelclick(e: MouseEvent): void {
    if (!open) return;
    const item = (e.target as Element | null)?.closest('a, button');
    if (!item || !panel?.contains(item)) return;
    if (item.matches('[aria-expanded], [aria-haspopup]')) return;
    // Inside a dialog an action opened (Publish's own buttons): closing would hide the dialog.
    if (item.closest('dialog')) return;
    // The game panel's buttons (saved games, New game) act in place.
    if (item.matches('button') && item.closest('[data-header-keep-open]')) return;
    void close(false);
  }

  onMount(() => {
    mounted = true;
    const mq = matchMedia(WIDE);
    const mqPhone = matchMedia(PHONE);
    wide = mq.matches;
    phone = mqPhone.matches;
    // Moving the actions between the bar and the panel remounts them, and a modal dialog they own
    // (Publish's) would go with them: while one is open the move waits for its close. The status
    // moving across sm remounts it too, so it waits the same way.
    const settle = () => {
      if (document.querySelector('dialog:modal')) return;
      wide = mq.matches;
      phone = mqPhone.matches;
    };
    mq.addEventListener('change', settle);
    mqPhone.addEventListener('change', settle);
    // `close` does not bubble: seen in the capture phase, for any dialog.
    document.addEventListener('close', settle, true);
    return () => {
      mq.removeEventListener('change', settle);
      mqPhone.removeEventListener('change', settle);
      document.removeEventListener('close', settle, true);
    };
  });
</script>

<svelte:window {onkeydown} {onpointerdown} />

<header
  bind:this={header}
  class={[
    'relative flex h-12 items-center justify-between gap-2 border-b bg-surface px-4 text-gray-900 dark:border-gray-700 dark:bg-chrome-dark dark:text-gray-100',
    // From lg the pinned item is centred. The side tracks are `1fr` with an automatic minimum, not
    // `minmax(0,1fr)`: a side too wide for half the row pushes the score off centre instead of
    // being clipped under it.
    pinned && 'lg:grid lg:grid-cols-[1fr_auto_1fr]'
  ]}
>
  <!-- Below sm, with a pinned item, this group holds only the name, which waits in the Menu:
       the group goes and the pinned box leads the bar, the status after it. -->
  <div
    class={pinned
      ? ['flex min-w-0 flex-1 items-center gap-2 lg:min-w-auto', statusAfter && 'hidden']
      : 'contents'}
  >
    <!-- Below sm a page that pins an item needs the room: the name waits in the Menu. -->
    <a href="/" class={['shrink-0 font-semibold whitespace-nowrap', pinned && 'max-sm:hidden']}
      >{SITE_NAME}</a
    >
    {#if round !== null}
      <span
        data-testid="round-label"
        class={[
          'shrink-0 text-sm font-medium whitespace-nowrap text-ink-muted dark:text-ink-dark-muted',
          pinned && 'max-sm:hidden'
        ]}>{round}</span
      >
    {/if}
    <!-- The status, then the space that pushes the pinned item and the actions right. -->
    <!-- In the grid (from lg, with a pinned item) it takes its content's width, so a status too
         wide for the left track widens the track (the score moves) rather than running under it. -->
    {#if !statusAfter}
      <div
        class={[
          'flex min-w-0 flex-1 items-center lg:pl-2 lg:max-xl:pl-0',
          pinned && 'lg:min-w-auto lg:flex-initial'
        ]}
        data-header-status
      >
        {@render status?.()}
      </div>
    {/if}
  </div>
  {#if pinned}
    <div class={['flex min-w-0 items-center', statusAfter && 'flex-1']}>{@render pinned()}</div>
  {/if}
  {#if statusAfter}
    <div class="flex shrink-0 items-center empty:hidden" data-header-status>
      {@render status?.()}
    </div>
  {/if}
  <div class="flex shrink-0 items-center gap-2 lg:justify-self-end lg:*:shrink-0">
    <!-- From lg nothing here shrinks, so the group's full width counts in the right track's
         minimum (a row too wide moves the score rather than squeezing a control). -->
    {#if wide}{@render actions?.()}{/if}
    <button
      bind:this={menuButton}
      type="button"
      class="relative inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-md border border-gray-300 dark:border-gray-600"
      aria-label="Menu"
      aria-expanded={open}
      aria-controls={panelId}
      data-header-menu
      onclick={toggle}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none">
        <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="2" />
      </svg>
    </button>
  </div>
  <!-- The panel starts at the header's padding edge, 47 px down (the bar is 48 px with its 1 px
       bottom border), and ends at the viewport's bottom at most: taller, it scrolls in itself. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    bind:this={panel}
    id={panelId}
    data-header-panel
    class={[
      open
        ? [
            'absolute top-full z-50 flex max-h-[calc(100dvh-47px)] flex-col gap-3 overflow-y-auto overscroll-contain max-lg:inset-x-0 lg:right-4 lg:w-96',
            'max-lg:border-b max-lg:bg-surface max-lg:p-4 max-lg:shadow-lg max-lg:dark:border-gray-700 max-lg:dark:bg-chrome-dark',
            PANEL_POP
          ]
        : 'hidden'
    ]}
    onclick={onpanelclick}
  >
    {#if pinned}
      <div class="flex items-center gap-2 self-start sm:hidden">
        <a href="/" class="inline-flex min-h-6 min-w-6 items-center font-semibold whitespace-nowrap"
          >{SITE_NAME}</a
        >
        {#if round !== null}
          <span
            data-testid="round-label-menu"
            class="text-sm font-medium whitespace-nowrap text-ink-muted dark:text-ink-dark-muted"
            >{round}</span
          >
        {/if}
      </div>
    {/if}
    {#if !wide && actions}
      <div class="flex flex-wrap items-center gap-2">{@render actions()}</div>
    {/if}
    {#if mounted && !game.open}<GamePanel />{/if}
    <div class="flex flex-wrap items-center gap-2">
      {#if account || signInAvailable}
        <a
          href={account ? '/account' : '/signin'}
          class={[tab(false), 'max-w-40 text-sm']}
          title={account ? `@${account.handle}` : undefined}
          data-header-account
          ><span class="truncate">{account ? `@${account.handle}` : AUTH_COPY.signIn}</span></a
        >
      {/if}
      <a
        href="/about"
        class={[tab(false), 'text-sm']}
        aria-current={routeId === '/about' ? 'page' : undefined}
        data-header-about>About</a
      >
    </div>
  </div>
</header>
