<!--
  The site header. From lg: the site name, the two steps (1 Paint, 2 Simulate), the page's status,
  the pinned item centred in the bar (when both sides fit; a side that does not pushes it off
  centre, never clips), and the actions on the right. Below lg: the site name, the status, the
  pinned item and a hamburger Menu button whose panel (under the header) holds the steps and the
  actions.
  Below sm, on a page that pins an item (Paint, /sim, /lesscars, /p/:id), the site name moves into
  the panel too. The account entry (Sign in, or @handle) follows the actions in the same group;
  Sign in shows only while a sign-in method is in effect (`signInAvailable`). The About entry
  follows the account entry on every route (the map pages have no footer). The status is the
  page's one status cell, left-aligned at every width and never in the Menu: on Paint and /sim
  the save state (nothing when saved), and on /sim "Updating" covers it while the numbers are
  stale or Play waits (beside it while autosave is off), with its explanation button. The status and the actions render once at every width:
  from lg the panel is `display: contents`, so the actions sit in the header row.
-->
<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import { AUTH_COPY } from '$lib/account/copy';
  import { headerOverlay } from './header-actions.svelte';

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
    /** The page's status cell (the save state; "Updating" covers it on /sim). */
    status?: Snippet;
    /** The signed-in account's handle, or null when signed out. */
    user?: { handle: string } | null;
    /** Whether any sign-in method is in effect; without one a signed-out visitor sees no Sign in. */
    signInAvailable?: boolean;
    routeId?: string | null;
  } = $props();

  const WIDE = '(min-width: 1024px)';
  const uid = $props.id();
  const panelId = `${uid}-menu`;

  const onSim = $derived(routeId === '/sim');
  // The steps are page navigation, so they stay links with aria-current rather than ARIA tabs.
  // The current one is filled with the accent; the other carries a resting border so it reads as
  // pressable. Both take a 1 px border so their sizes match.
  const link =
    'inline-flex min-h-6 min-w-6 items-center whitespace-nowrap rounded-md border px-2 no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-accent-dark';
  const tab = (current: boolean) => [
    link,
    current
      ? 'cursor-default border-transparent bg-accent text-on-accent dark:bg-accent-dark dark:text-on-accent-dark'
      : 'border-gray-500 hover:bg-gray-100 dark:border-gray-400 dark:hover:bg-chrome-dark-raised'
  ];

  let open = $state(false);
  let header = $state<HTMLElement>();
  let menuButton = $state<HTMLButtonElement>();
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
    // A modal dialog (Publish) or a disclosure open inside the menu (Keyboard shortcuts) takes
    // Escape first.
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
    void close(false);
  }

  onMount(() => {
    const mq = matchMedia(WIDE);
    const onChange = () => {
      if (mq.matches) open = false;
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });
</script>

<svelte:window {onkeydown} {onpointerdown} />

<!-- From lg the list never wraps, so its full width counts in the left track's minimum. -->
{#snippet steps()}
  <ol class="m-0 flex list-none flex-wrap items-center gap-[inherit] p-0 lg:flex-nowrap">
    <li>
      <a href="/" class={tab(routeId === '/')} aria-current={routeId === '/' ? 'page' : undefined}
        >{@render stepNumber(1)}Paint</a
      >
    </li>
    <li>
      <a href="/sim" class={tab(onSim)} aria-current={onSim ? 'page' : undefined}
        >{@render stepNumber(2)}Simulate</a
      >
    </li>
  </ol>
{/snippet}

<!-- The order is the list's to speak; the number is for the eye, at every width. -->
{#snippet stepNumber(n: number)}
  <span aria-hidden="true" data-step-number class="mr-1 font-semibold tabular-nums">{n}</span>
{/snippet}

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
  <div class={pinned ? 'flex min-w-0 flex-1 items-center gap-2 lg:min-w-auto' : 'contents'}>
    <!-- Below sm a page that pins an item needs the room: the name waits in the Menu. -->
    <a href="/" class={['shrink-0 font-semibold whitespace-nowrap', pinned && 'max-sm:hidden']}
      >SF Housing <span class="sr-only xl:not-sr-only">Simulator</span></a
    >
    <nav aria-label="Steps" class="flex shrink-0 items-center gap-3 text-sm max-lg:hidden">
      {@render steps()}
    </nav>
    <!-- The status, then the space that pushes the pinned item and the actions right. -->
    <!-- In the grid (from lg, with a pinned item) it takes its content's width, so a status too
         wide for the left track widens the track (the score moves) rather than running under it. -->
    <div
      class={[
        'flex min-w-0 flex-1 items-center lg:pl-2 lg:max-xl:pl-0',
        pinned && 'lg:min-w-auto lg:flex-initial'
      ]}
      data-header-status
    >
      {@render status?.()}
    </div>
  </div>
  {#if pinned}
    <div class="flex min-w-0 items-center">{@render pinned()}</div>
  {/if}
  <button
    bind:this={menuButton}
    type="button"
    class="inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-md border border-gray-300 lg:hidden dark:border-gray-600"
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
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    bind:this={panel}
    id={panelId}
    class={[
      'lg:contents',
      open
        ? 'max-lg:absolute max-lg:inset-x-0 max-lg:top-full max-lg:z-50 max-lg:flex max-lg:flex-col max-lg:gap-3 max-lg:border-b max-lg:bg-surface max-lg:p-4 max-lg:shadow-lg dark:max-lg:border-gray-700 dark:max-lg:bg-chrome-dark'
        : 'max-lg:hidden'
    ]}
    onclick={onpanelclick}
  >
    {#if pinned}
      <a
        href="/"
        class="inline-flex min-h-6 min-w-6 items-center self-start font-semibold whitespace-nowrap sm:hidden"
        >SF Housing Simulator</a
      >
    {/if}
    <nav aria-label="Steps" class="flex flex-wrap items-center gap-4 text-sm lg:hidden">
      {@render steps()}
    </nav>
    <!-- From lg nothing here shrinks, so the group's full width counts in the right track's
         minimum (a row too wide moves the score rather than squeezing a control). -->
    <div class="flex items-center gap-2 max-lg:flex-wrap lg:justify-self-end lg:*:shrink-0">
      {@render actions?.()}
      {#if user || signInAvailable}
        <a
          href={user ? '/account' : '/signin'}
          class={[tab(false), 'max-w-40 text-sm lg:max-xl:max-w-24']}
          title={user ? `@${user.handle}` : undefined}
          data-header-account
          ><span class="truncate">{user ? `@${user.handle}` : AUTH_COPY.signIn}</span></a
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
