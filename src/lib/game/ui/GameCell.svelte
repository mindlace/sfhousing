<!--
  The header's unit count: a button reading the total (a count that rolls to each new total) and
  the game panel it opens. From lg it sits in the bar and the panel is a pop-over under the header;
  in the Menu (`inMenu`) the panel opens in place under the cell. SiteHeader renders one instance
  at any width. Nothing renders for the open game.
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { Tween, prefersReducedMotion } from 'svelte/motion';
  import { formatCount } from '$lib/scoreboard/format';
  import { headerOverlay } from '$lib/shell/header-actions.svelte';
  import { BUTTON, SURFACE_POP } from '$lib/shell/ui';
  import { useGame } from '../store.svelte';
  import { total } from '../units';
  import GamePanel from './GamePanel.svelte';
  import { ROLL_MS } from './motion';
  import { UNIT_MARK, unitsName } from './words';

  interface GameCellProps {
    inMenu: boolean;
  }

  let { inMenu }: GameCellProps = $props();

  const game = useGame();
  const uid = $props.id();
  const panelId = `${uid}-game`;

  let open = $state(false);
  /** The pop-over's left edge in the header's box, measured at open. */
  let left = $state(0);
  let root = $state<HTMLDivElement>();
  let button = $state<HTMLButtonElement>();

  const count = $derived(total(game.state.units));
  // svelte-ignore state_referenced_locally
  const roll = new Tween(count, {
    duration: () => (prefersReducedMotion.current ? 0 : ROLL_MS),
    easing: cubicOut
  });
  // With reduced motion the count is the total itself, in the same flush as the total.
  const shown = $derived(prefersReducedMotion.current ? count : Math.round(roll.current));
  let mounted = false;
  $effect(() => {
    const n = count;
    if (!mounted) {
      mounted = true;
      return;
    }
    untrack(() => void roll.set(n));
  });

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

{#if !game.open}
  <!-- SiteHeader's Menu stays open for a press on a button in here (data-header-keep-open). -->
  <div
    bind:this={root}
    data-header-keep-open
    class={inMenu ? 'flex flex-col items-start gap-2' : 'flex shrink-0 items-center'}
  >
    <button
      bind:this={button}
      type="button"
      class={BUTTON}
      data-testid="header-units"
      aria-expanded={open}
      aria-controls={panelId}
      onclick={toggle}
      ><span aria-hidden="true">{UNIT_MARK}</span><span aria-hidden="true"
        >{formatCount(shown)}</span
      ><span class="sr-only">{unitsName(count)}</span></button
    >
    {#if open}
      <!-- The click only watches for a link's activation; the link itself takes the keys. -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div
        onclick={onpanelclick}
        id={panelId}
        data-testid="header-game-panel"
        class={inMenu
          ? undefined
          : `${SURFACE_POP} absolute top-full z-50 mt-1 max-h-[calc(100vh-4rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto`}
        style:left={inMenu ? undefined : `${left}px`}
      >
        <GamePanel />
      </div>
    {/if}
  </div>
{/if}
