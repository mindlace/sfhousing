<!--
  The header's level cell: a button reading the level ("Level 3", or "Round complete"), "Level up"
  while the page offers a win, and the level panel the button opens. From lg it sits in the bar
  after the steps and the panel is a pop-over under the header; in the Menu (`inMenu`) the panel
  opens in place under the cell. SiteHeader renders one instance at any width.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import LevelPanel from '$lib/game/LevelPanel.svelte';
  import { levelText } from '$lib/game/copy';
  import { roundComplete } from '$lib/game/progress';
  import { useGame } from '$lib/game/store.svelte';
  import { headerOverlay } from './header-actions.svelte';
  import { BUTTON, BUTTON_PRIMARY, SURFACE_POP } from './ui';

  let { inMenu }: { inMenu: boolean } = $props();

  const game = useGame();
  const uid = $props.id();
  const panelId = `${uid}-level`;

  let open = $state(false);
  /** The pop-over's left edge in the header's box, measured at open. */
  let left = $state(0);
  let root = $state<HTMLDivElement>();
  let button = $state<HTMLButtonElement>();

  const label = $derived(
    roundComplete(game.progress) ? 'Round complete' : levelText(game.progress.level)
  );
  const showLevelUp = $derived(game.offer !== null && !roundComplete(game.progress));

  const openOnly = headerOverlay(panelId, () => (open = false));

  function toggle(): void {
    if (open) {
      open = false;
      return;
    }
    if (!inMenu && button) {
      // The header is the nearest positioned ancestor: the pop-over follows the cell from there.
      const header = button.closest('header');
      left = button.getBoundingClientRect().left - (header?.getBoundingClientRect().left ?? 0);
    }
    open = true;
    // In the Menu the panel lives inside it; announcing would close the Menu that holds it.
    if (!inMenu) openOnly();
  }

  async function levelUp(): Promise<void> {
    game.levelUp();
    await tick();
    if (!showLevelUp) button?.focus();
  }

  async function onkeydown(e: KeyboardEvent): Promise<void> {
    if (!open || e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.querySelector('dialog:modal')) return;
    // SiteHeader's window listener has already seen this Escape and left the Menu open, since
    // this button reads aria-expanded true inside it; the next Escape closes the Menu. Marked
    // handled for any listener after this one.
    e.preventDefault();
    open = false;
    await tick();
    button?.focus();
  }

  function onpointerdown(e: PointerEvent): void {
    const t = e.target as Node | null;
    if (!open || !t || root?.contains(t)) return;
    open = false;
  }

  /**
   * A link in the panel (Sign in to save) navigates, and the header outlives a client navigation
   * (it is the root layout's): the panel closes with it, so nothing stays open over the next page.
   */
  function onpanelclick(e: MouseEvent): void {
    if ((e.target as Element | null)?.closest('a')) open = false;
  }
</script>

<svelte:window {onkeydown} {onpointerdown} />

<!-- SiteHeader's Menu stays open for a press on a button in here (data-header-keep-open). -->
<div
  bind:this={root}
  data-header-keep-open
  class={inMenu ? 'flex flex-col items-start gap-2' : 'flex shrink-0 items-center'}
>
  <div class="flex items-center gap-2">
    <button
      bind:this={button}
      type="button"
      class={BUTTON}
      data-testid="header-level"
      aria-expanded={open}
      aria-controls={panelId}
      onclick={toggle}>{label}</button
    >
    {#if showLevelUp}
      <button type="button" class={BUTTON_PRIMARY} data-testid="header-level-up" onclick={levelUp}
        >Level up</button
      >
    {/if}
  </div>
  {#if open}
    <!-- The click only watches for a link's activation; the link itself takes the keys. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      onclick={onpanelclick}
      id={panelId}
      data-testid="header-level-panel"
      class={inMenu
        ? undefined
        : `${SURFACE_POP} absolute top-full z-50 mt-1 max-h-[calc(100vh-4rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto`}
      style:left={inMenu ? undefined : `${left}px`}
    >
      <LevelPanel />
    </div>
  {/if}
</div>
