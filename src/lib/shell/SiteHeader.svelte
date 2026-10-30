<!--
  The site header. From md: the site name, the mode links, the page's pinned item, then its
  actions. Below md: the site name, the pinned item and a Menu button whose panel (under the
  header) holds the mode links and the actions. The actions render once at every width: from md
  the panel is `display: contents`, so they sit in the header row.
-->
<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';

  let {
    actions,
    pinned,
    routeId = null
  }: { actions?: Snippet; pinned?: Snippet; routeId?: string | null } = $props();

  const WIDE = '(min-width: 768px)';
  const uid = $props.id();
  const panelId = `${uid}-menu`;

  const onSim = $derived(routeId === '/sim');
  const link = 'inline-flex min-h-6 items-center whitespace-nowrap pointer-coarse:min-h-11';

  let open = $state(false);
  let header = $state<HTMLElement>();
  let menuButton = $state<HTMLButtonElement>();
  let panel = $state<HTMLDivElement>();

  async function close(refocus: boolean): Promise<void> {
    open = false;
    if (!refocus) return;
    await tick();
    menuButton?.focus();
  }

  function onkeydown(e: KeyboardEvent): void {
    if (!open || e.key !== 'Escape' || e.defaultPrevented) return;
    // A modal dialog (Publish) or a disclosure open inside the menu (View) takes Escape first.
    if (document.querySelector('dialog:modal')) return;
    if (panel?.querySelector('[aria-expanded="true"]')) return;
    const a = document.activeElement;
    void close(!a || a === document.body || !!header?.contains(a));
  }

  function onpointerdown(e: PointerEvent): void {
    const t = e.target as Node | null;
    if (open && t && !header?.contains(t) && !document.querySelector('dialog:modal')) {
      void close(false);
    }
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

{#snippet modeLinks()}
  <a
    href="/"
    class={link}
    class:underline={routeId === '/'}
    aria-current={routeId === '/' ? 'page' : undefined}>Paint</a
  >
  <a href="/sim" class={link} class:underline={onSim} aria-current={onSim ? 'page' : undefined}
    >Simulate</a
  >
{/snippet}

<header
  bind:this={header}
  class="relative flex h-12 items-center justify-between gap-2 border-b px-4"
>
  <a href="/" class="shrink-0 font-semibold whitespace-nowrap"
    >SF Housing <span class="sr-only sm:not-sr-only">Simulator</span></a
  >
  <nav aria-label="Modes" class="flex min-w-0 flex-1 items-center gap-3 text-sm max-md:hidden">
    {@render modeLinks()}
  </nav>
  {#if pinned}
    <div class="flex min-w-0 items-center max-md:ml-auto">{@render pinned()}</div>
  {/if}
  <button
    bind:this={menuButton}
    type="button"
    class="min-h-6 min-w-6 shrink-0 rounded-md border border-gray-300 px-2 text-sm font-medium md:hidden pointer-coarse:min-h-11 pointer-coarse:min-w-11"
    class:ml-auto={!pinned}
    aria-expanded={open}
    aria-controls={panelId}
    onclick={() => (open = !open)}>Menu</button
  >
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    bind:this={panel}
    id={panelId}
    class={[
      'md:contents',
      open
        ? 'max-md:absolute max-md:inset-x-0 max-md:top-full max-md:z-50 max-md:flex max-md:flex-col max-md:gap-3 max-md:border-b max-md:bg-white max-md:p-4 max-md:shadow-lg'
        : 'max-md:hidden'
    ]}
    onclick={onpanelclick}
  >
    <nav aria-label="Modes" class="flex flex-wrap items-center gap-4 text-sm md:hidden">
      {@render modeLinks()}
    </nav>
    <div class="flex flex-wrap items-center gap-2">{@render actions?.()}</div>
  </div>
</header>
