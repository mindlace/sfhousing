<!--
  The map key control (map-on-screen slice 5), shared by /sim and Paint: a toolbar at the map's
  bottom right, 8 px in and 0.5rem above the attribution's footprint
  (`--map-controls-br-block-size`, which includes the bottom inset), with a Key toggle and, when
  the page has layer rows, a Layers toggle before it. Each opens its panel 12 px above the toolbar
  (clear of the 29 px Reset view on a phone); at most one is open. The panel's room runs from
  0.5rem below the map's top down to the toolbar, and it scrolls inside it. The toggles' words are fixed: status lives in the panels.
  The toolbar comes first in the DOM (the box is flex-col-reverse, so the panels still sit above
  it): Tab reaches the toggles before an open panel's controls.

  The control's box spans that room (the wrapper ignores the pointer; its toolbar and panel do not),
  so a page can read its left edge for the card's area. Mount it inside the map's positioned box,
  after the map, so Tab reaches it after the map's own controls.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { BUTTON, ON_MAP, SURFACE_POP } from '$lib/shell/ui';
  import { timelineTokenCss } from '../palette';
  import { KEY_COPY } from './copy';

  interface Props {
    /** The key panel's content. */
    key: Snippet;
    /** The Layers panel's content; no Layers toggle without it. */
    layers?: Snippet;
    /** The key starts open from md (true on /sim, false on /), always closed below md. */
    openFromMd?: boolean;
    /** Below md, while a card sheet covers the corner: not shown and inert. */
    hidden?: boolean;
    /**
     * The least the toolbar sits above the map's bottom, px, whatever the footprint says (Paint's
     * sheet handle): it never sits under the sheet, even before the map measures or with no map.
     */
    floor?: number;
    /** The key panel's text dims as Results does (data-stale); the Layers panel's never does. */
    stale?: boolean;
    /** The control's box, for the card area. */
    el?: HTMLElement;
    /**
     * The panel the viewer can see, whenever it changes: 'key', 'layers', or null while none is
     * open or the control is hidden. A panel's content stays mounted while closed, so a page whose
     * panel draws on the map clears that drawing on anything but its own panel.
     */
    onopenchange?: (open: 'key' | 'layers' | null) => void;
  }
  let {
    key,
    layers,
    openFromMd = false,
    hidden = false,
    floor = 0,
    stale = false,
    el = $bindable(),
    onopenchange = undefined
  }: Props = $props();

  type Panel = 'key' | 'layers';
  const md = new MediaQuery('(min-width: 768px)');
  /** On arrival: the key from md when the page asks for it, else nothing. Not stored. */
  const atRest = (): Panel | null => (openFromMd && md.current ? 'key' : null);
  let open = $state<Panel | null>(atRest());
  // Going below md closes the open panel (focus inside it goes to its toggle, as Escape's does);
  // going up keeps the viewer's state, so a key closed by the viewer stays closed.
  let wasMd = md.current;
  $effect(() => {
    const now = md.current;
    if (now === wasMd) return;
    wasMd = now;
    if (!now && open !== null) untrack(() => close(open!));
  });
  $effect(() => {
    const visible = hidden ? null : open;
    untrack(() => onopenchange?.(visible));
  });
  // A page that drops its layer rows closes their panel.
  $effect(() => {
    if (!layers && open === 'layers') open = null;
  });

  const uid = $props.id();
  const ids = { key: `${uid}-key`, layers: `${uid}-layers` };
  let keyButton = $state<HTMLButtonElement>();
  let layersButton = $state<HTMLButtonElement>();

  function toggle(p: Panel): void {
    // The width changes a rendering update before its change event: a press in between was made
    // at the new width, so the crossing is behind it and must not close what it opens (issue 131).
    wasMd = md.current;
    open = open === p ? null : p;
  }

  /** Closes `p`; focus inside its panel goes to its toggle. */
  function close(p: Panel): void {
    const panel = document.getElementById(ids[p]);
    const had = !!panel && panel.contains(document.activeElement);
    open = null;
    if (had) (p === 'key' ? keyButton : layersButton)?.focus();
  }

  function onkeydown(e: KeyboardEvent): void {
    // A key already handled (an explanation inside or hovered closed on it) is not the panel's.
    if (e.key !== 'Escape' || e.defaultPrevented || open === null) return;
    e.stopPropagation();
    const was = open;
    open = null;
    (was === 'key' ? keyButton : layersButton)?.focus();
  }

  // Below md a pointerdown on the map (anywhere in the control's parent box outside the control)
  // closes the panel; from md it stays until its toggle closes it.
  $effect(() => {
    const box = el?.parentElement;
    if (!box || md.current || open === null) return;
    const down = (e: PointerEvent) => {
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      open = null;
    };
    box.addEventListener('pointerdown', down);
    return () => box.removeEventListener('pointerdown', down);
  });

  // The shared button over the map; the open panel's toggle shows one step raised.
  const TOGGLE = `pointer-events-auto ${BUTTON} ${ON_MAP} aria-expanded:bg-surface-raised dark:aria-expanded:bg-surface-dark-raised`;
  const PANEL = `pointer-events-auto min-h-0 w-[min(18rem,calc(100vw-1rem))] overflow-y-auto md:w-60 ${SURFACE_POP}`;
</script>

<svelte:head>
  <!-- The key's swatches sit outside SimMap, so they cannot inherit its --map-* variables. -->
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- constant CSS built from palette TOKENS -->
  {@html '<style>' + timelineTokenCss('.sfh-map-key') + '</style>'}
</svelte:head>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={el}
  data-testid="map-key-control"
  class="sfh-map-key pointer-events-none absolute top-2 right-2 z-20 flex flex-col-reverse items-end justify-start gap-3"
  style:bottom="calc(max(var(--map-controls-br-block-size, 60px), {floor}px) + 0.5rem)"
  {hidden}
  inert={hidden}
  {onkeydown}
>
  <div class="flex shrink-0 gap-1">
    {#if layers}
      <button
        bind:this={layersButton}
        type="button"
        data-testid="map-layers-toggle"
        class={TOGGLE}
        aria-label={KEY_COPY.layersName}
        aria-expanded={open === 'layers'}
        aria-controls={ids.layers}
        onclick={() => toggle('layers')}>{KEY_COPY.layers}</button
      >
    {/if}
    <button
      bind:this={keyButton}
      type="button"
      data-testid="map-key-toggle"
      class={TOGGLE}
      aria-label={KEY_COPY.keyName}
      aria-expanded={open === 'key'}
      aria-controls={ids.key}
      onclick={() => toggle('key')}>{KEY_COPY.key}</button
    >
  </div>
  <!-- tabindex 0: a panel that scrolls is reachable by keyboard (WCAG 2.1.1). -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    id={ids.key}
    role="group"
    aria-label={KEY_COPY.keyName}
    data-testid="map-key-panel"
    data-stale={stale ? 'true' : undefined}
    tabindex="0"
    class="sfh-map-key-panel {PANEL}"
    hidden={open !== 'key'}
  >
    {@render key()}
  </div>
  {#if layers}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      id={ids.layers}
      role="group"
      aria-label={KEY_COPY.layersName}
      data-testid="map-layers-panel"
      tabindex="0"
      class="sfh-map-key-panel {PANEL}"
      hidden={open !== 'layers'}
    >
      {@render layers()}
    </div>
  {/if}
</div>

<style>
  /* Stale (rule 31): the panel's text turns to the muted ink, which keeps AA contrast; controls
     keep their own colours; swatches dim. */
  .sfh-map-key-panel[data-stale],
  .sfh-map-key-panel[data-stale] :global(:not(button, a, input, select, button *, a *)) {
    color: var(--color-ink-muted);
  }
  .sfh-map-key-panel[data-stale] :global([data-swatch]) {
    opacity: 0.6;
  }
  @media (prefers-color-scheme: dark) {
    .sfh-map-key-panel[data-stale],
    .sfh-map-key-panel[data-stale] :global(:not(button, a, input, select, button *, a *)) {
      color: var(--color-ink-dark-muted);
    }
  }
</style>
