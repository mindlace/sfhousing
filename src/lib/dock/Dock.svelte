<script lang="ts" module>
  /** One editing tab: `icon` is a `DOCK_ICONS` entry (SVG path data on a 24 grid). */
  export interface DockTab {
    id: string;
    label: string;
    icon: readonly string[];
    /** The rail button's accessible name when it must differ from `label` (default `label`). */
    railLabel?: string;
  }
</script>

<!--
  The dock: one panel of tabs on two faces, the editing face (tabs, a `top` row, the tab panel)
  and the Results face (a flip button, then the results). From md it is a 320 px panel on the
  left of the map that folds to a 48 px rail of icon buttons (one per tab and Results); below md it
  is a bottom sheet over the map, a handle always visible and the body at 'peek' (about 40dvh) or
  'full' (up to 85dvh), never taller than its host above the time bar (so it never covers the
  header). The page owns `state` (a `DockState`); this component renders it and writes
  to it for the user's own input (tabs, rail, handle, collapse, Escape).

  The root is a `display: contents` region named by `label` (the target of the header buttons'
  `aria-controls`); the panel, rail and sheet position against the nearest positioned ancestor, as
  the old policy panel did. A host that carries the class `sfh-dock-host` gets `--dock-w` (320px
  open, 48px as a rail, from md only) and its MapLibre bottom-left control (zoom, compass) moves
  right of the dock so the dock never covers it (WCAG 2.2 2.4.11). `--fzp-scrubber-h` lifts the
  dock clear of the time bar.

  The sheet is non-modal on purpose: a modal cannot peek at 40dvh while the map and the time bar
  stay usable. It joins the header overlays (`headerOverlay`): opening it closes the phone Menu and
  the Menu opening closes it. The handle expands a closed or peeking sheet to 'full' and closes a
  full one; the collapse button and Escape close it. Focus moves into the dock only for the user's
  own opening (rail, handle, or the page's `focusOnOpen`), never for a default open (WCAG 2.4.3),
  and survives a resize across md.
-->
<script lang="ts">
  import { tick, untrack, type Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { headerOverlay } from '$lib/shell/header-actions.svelte';
  import type { DockState } from './dock-state.svelte';
  import { DOCK_ICONS } from './icons';

  interface Props {
    /** The region's id, for the header buttons' `aria-controls`. */
    id: string;
    /** 'Policy' (/sim, /s/<id>) or 'Paint' (/): the region and tablist name. */
    label: string;
    state: DockState;
    tabs: readonly DockTab[];
    /** The tab panel's body for a tab id. */
    panel: Snippet<[string]>;
    /** Above the tab panel, editing face only (Undo and Redo). */
    top?: Snippet;
    /** The Results face's body. */
    results?: Snippet;
    /** 'Edit policy' | 'Paint' | 'Policy'. */
    flipLabel: string;
    /**
     * The flip button's accessible name when the visible `flipLabel` alone would repeat another
     * button's (it contains `flipLabel`, so the visible label stays in the name).
     */
    flipName?: string;
    /** The flip button on Results. */
    onflip(): void;
    /** The user opened it (button, handle, score): move focus in. False for the default open. */
    focusOnOpen?: boolean;
    /** Phones: the sheet's visible height above `bottom` in px (0 from md). */
    onsheetheight?: (px: number) => void;
    /** After the dock collapsed by the collapse button or Escape (the page restores focus). */
    onclose?: () => void;
    /** A run is active: the rail shows only the Results button (the tabs are not offered). */
    resultsOnly?: boolean;
  }
  let {
    id,
    label,
    state: dock,
    tabs,
    panel,
    top = undefined,
    results = undefined,
    flipLabel,
    flipName = undefined,
    onflip,
    focusOnOpen = false,
    onsheetheight = undefined,
    onclose = undefined,
    resultsOnly = false
  }: Props = $props();

  const uid = $props.id();
  const panelId = `${uid}-tabpanel`;
  const bodyId = `${uid}-body`;
  const tabId = (t: string) => `${uid}-tab-${t}`;

  const wide = new MediaQuery('(min-width: 768px)');

  let root = $state<HTMLElement>();
  let sheetEl = $state<HTMLElement>();

  const CHEVRON_LEFT = ['M15 6l-6 6 6 6'];
  const CHEVRON_DOWN = ['M6 9l6 6 6-6'];

  // Control surfaces: light on surface, hover one step up; dark mirrors it (surface-dark, then
  // surface-dark-raised). The selected tab and the flip button are the face's primary action.
  const HOVER = 'hover:bg-surface-raised dark:hover:bg-surface-dark-raised';
  const PRIMARY =
    'bg-accent text-on-accent hover:bg-accent-hover dark:bg-accent-dark dark:text-on-accent-dark dark:hover:bg-accent-dark-hover';
  const ICON_BUTTON = `flex size-10 shrink-0 items-center justify-center rounded-md text-ink dark:text-ink-dark pointer-coarse:size-11 ${HOVER}`;

  /** Focus lands on the face's first control: the selected tab, or the flip button. */
  function moveFocusIn(): void {
    const target = root?.querySelector<HTMLElement>(
      dock.face === 'results' ? '[data-testid="dock-flip"]' : '[role="tab"][aria-selected="true"]'
    );
    (target ?? root?.querySelector<HTMLElement>('[data-testid="dock-handle"]'))?.focus();
  }

  // Crossing md: a sheet that was open becomes the panel (in the pre-effect, so the DOM renders
  // once), and focus that was in the dock goes to the new layout's equivalent.
  let prevWide: boolean | undefined;
  let hadFocus = false;
  let crossed = false;
  $effect.pre(() => {
    const w = wide.current;
    untrack(() => {
      hadFocus = root?.contains(document.activeElement) ?? false;
      if (prevWide !== undefined && prevWide !== w) {
        crossed = true;
        dock.widthChanged(w);
      }
      prevWide = w;
    });
  });

  // Opening: the page asks for focus to move in (the header's own button, the score).
  let wasVisible = false;
  $effect(() => {
    const v = dock.visible(wide.current);
    untrack(() => {
      if (crossed) {
        crossed = false;
        if (hadFocus) void tick().then(moveFocusIn);
      } else if (v && !wasVisible && focusOnOpen) {
        void tick().then(moveFocusIn);
      }
      wasVisible = v;
    });
  });

  // The sheet is a header overlay: opening it (by any input) closes the Menu, and the Menu
  // opening closes it. The panel sits apart from the overlays.
  const openOnly = headerOverlay(`${uid}-dock-overlay`, () => {
    if (!wide.current && dock.sheet !== 'closed') dock.sheet = 'closed';
  });
  $effect(() => {
    if (!wide.current && dock.sheet !== 'closed') untrack(openOnly);
  });

  // The sheet's height (handle included) above `bottom`, for the page to inset the map.
  $effect(() => {
    const report = untrack(() => onsheetheight);
    if (!report) return;
    const el = sheetEl;
    if (wide.current || !el) {
      report(0);
      return;
    }
    const send = () => report(el.getBoundingClientRect().height);
    const ro = new ResizeObserver(send);
    ro.observe(el);
    send();
    return () => ro.disconnect();
  });

  /** After a collapse: the page restores focus through `onclose`, else the rail or handle. */
  async function collapse(): Promise<void> {
    if (wide.current) dock.open = false;
    else dock.sheet = 'closed';
    await tick();
    if (onclose) {
      onclose();
      return;
    }
    const rail = root?.querySelector<HTMLElement>(
      `[data-dock-rail="${dock.face === 'results' ? 'results' : dock.tab}"]`
    );
    (rail ?? root?.querySelector<HTMLElement>('[data-testid="dock-handle"]'))?.focus();
  }

  /** Escape with focus in the dock collapses it, unless a modal dialog is open. */
  function onkeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (!root?.contains(document.activeElement)) return;
    if (!dock.visible(wide.current)) return;
    if (document.querySelector('dialog:modal')) return;
    e.preventDefault();
    void collapse();
  }

  function onTabKeydown(e: KeyboardEvent): void {
    const i = tabs.findIndex((t) => t.id === dock.tab);
    let next: number;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    dock.showEdit(tabs[next].id);
    void tick().then(() => document.getElementById(tabId(tabs[next].id))?.focus());
  }

  async function openFromRail(action: () => void): Promise<void> {
    action();
    await tick();
    moveFocusIn();
  }

  function pressHandle(): void {
    if (dock.sheet === 'peek') dock.sheet = 'full';
    else dock.toggleOpen(false);
    if (dock.sheet !== 'closed') void tick().then(moveFocusIn);
  }

  const shownTab = $derived(tabs.find((t) => t.id === dock.tab));
  const handleText = $derived(dock.face === 'results' ? 'Results' : (shownTab?.label ?? label));
  /** The handle's name: its text, or the tab's `railLabel` (which contains the text). */
  const handleName = $derived(
    dock.face === 'results' ? 'Results' : (shownTab?.railLabel ?? handleText)
  );
</script>

<svelte:window {onkeydown} />

{#snippet icon(paths: readonly string[])}
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {#each paths as d (d)}<path {d} />{/each}
  </svg>
{/snippet}

{#snippet face()}
  <div
    class="sticky top-0 z-10 flex items-start gap-1 border-b border-line bg-surface p-1 dark:border-line-dark dark:bg-surface-dark"
  >
    {#if dock.face === 'edit'}
      <div role="tablist" aria-label={label} class="flex min-w-0 flex-1 gap-1">
        {#each tabs as t (t.id)}
          {@const selected = dock.tab === t.id}
          <button
            type="button"
            role="tab"
            id={tabId(t.id)}
            aria-selected={selected}
            aria-controls={panelId}
            tabindex={selected ? 0 : -1}
            class="flex min-h-12 min-w-6 flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-xs font-semibold pointer-coarse:min-h-14 {selected
              ? PRIMARY
              : `text-ink-muted dark:text-ink-dark-muted ${HOVER}`}"
            onclick={() => dock.showEdit(t.id)}
            onkeydown={onTabKeydown}
          >
            {@render icon(t.icon)}
            <span>{t.label}</span>
          </button>
        {/each}
      </div>
    {:else}
      <div class="flex min-w-0 flex-1 items-center">
        <button
          type="button"
          data-testid="dock-flip"
          aria-label={flipName}
          class="min-h-10 rounded-md px-3 text-sm font-semibold pointer-coarse:min-h-11 {PRIMARY}"
          onclick={() => onflip()}>{flipLabel}</button
        >
      </div>
    {/if}
    <button
      type="button"
      aria-label="Collapse {label}"
      title="Collapse {label}"
      class={ICON_BUTTON}
      onclick={() => void collapse()}
    >
      {@render icon(wide.current ? CHEVRON_LEFT : CHEVRON_DOWN)}
    </button>
  </div>
  {#if dock.face === 'edit'}
    {@render top?.()}
    <div role="tabpanel" id={panelId} aria-labelledby={tabId(dock.tab)} class="p-4">
      {@render panel(dock.tab)}
    </div>
  {:else}
    <div role="region" aria-label="Results" data-testid="score-details">
      {@render results?.()}
    </div>
  {/if}
{/snippet}

<section bind:this={root} {id} data-testid="dock" aria-label={label} class="sfh-dock contents">
  {#if wide.current}
    {#if dock.open}
      <section
        class="sfh-dock-panel absolute top-0 left-0 z-30 w-80 overflow-y-auto border-r border-line bg-surface text-ink shadow-lg dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
        style:bottom="var(--fzp-scrubber-h, 0px)"
      >
        {@render face()}
      </section>
    {:else}
      <nav
        class="sfh-dock-rail absolute top-0 left-0 z-30 flex w-12 flex-col items-center gap-1 overflow-y-auto border-r border-line bg-surface py-2 shadow-lg dark:border-line-dark dark:bg-surface-dark"
        data-testid="dock-rail"
        aria-label={label}
        style:bottom="var(--fzp-scrubber-h, 0px)"
      >
        {#if !resultsOnly}
          {#each tabs as t (t.id)}
            <button
              type="button"
              class={ICON_BUTTON}
              aria-label={t.railLabel ?? t.label}
              title={t.railLabel ?? t.label}
              data-dock-rail={t.id}
              onclick={() =>
                void openFromRail(() => {
                  dock.open = true;
                  dock.showEdit(t.id);
                })}>{@render icon(t.icon)}</button
            >
          {/each}
        {/if}
        <button
          type="button"
          class={ICON_BUTTON}
          aria-label="Results"
          title="Results"
          data-dock-rail="results"
          onclick={() => void openFromRail(() => dock.showResults())}
          >{@render icon(DOCK_ICONS.results)}</button
        >
      </nav>
    {/if}
  {:else}
    <section
      bind:this={sheetEl}
      class="sfh-dock-sheet absolute right-0 left-0 z-30 flex flex-col rounded-t-lg border-t border-line bg-surface text-ink shadow-lg dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
      style:bottom="var(--fzp-scrubber-h, 0px)"
      style:max-height={dock.sheet === 'closed'
        ? null
        : `min(${dock.sheet === 'full' ? 85 : 40}dvh, calc(100% - var(--fzp-scrubber-h, 0px)))`}
    >
      <button
        type="button"
        data-testid="dock-handle"
        aria-label={handleName}
        aria-expanded={dock.sheet !== 'closed'}
        aria-controls={bodyId}
        class="flex min-h-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-t-lg px-4 text-sm font-semibold {HOVER}"
        onclick={pressHandle}
      >
        <span
          aria-hidden="true"
          class="h-1 w-10 rounded-full bg-control-line dark:bg-control-line-dark"
        ></span>
        <span>{handleText}</span>
      </button>
      {#if dock.sheet !== 'closed'}
        <div id={bodyId} class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {@render face()}
        </div>
      {/if}
    </section>
  {/if}
</section>

<style>
  /* The map's room beside the dock (from md): hosts read --dock-w; the bottom-left navigation
     control (zoom, compass) moves right of the dock so the dock never covers it. */
  @media (min-width: 768px) {
    :global(.sfh-dock-host:has(.sfh-dock-panel)) {
      --dock-w: 320px;
    }
    :global(.sfh-dock-host:has(.sfh-dock-rail)) {
      --dock-w: 48px;
    }
    :global(
      .sfh-dock-host:is(:has(.sfh-dock-panel), :has(.sfh-dock-rail)) .maplibregl-ctrl-bottom-left
    ) {
      left: var(--dock-w);
    }
  }
</style>
