<!--
  The /sim policy panel (layout rulings 3, 4 and 9). From md it docks on the left of the map as a
  `<section>` 320 px wide, ending above the scrubber, and publishes `--sim-panel-w` on `.sfh-fzp`
  so the project card sits to its right, and moves the map's bottom-left navigation control (zoom
  and compass) to its right edge so the panel never covers it (WCAG 2.2 2.4.11). Below md it is a modal sheet (`<dialog>`) that joins the
  header overlays, so it never shows with the phone Menu or the score details. Its sections are
  disclosures; only "Zoning layers" starts open. Below md a sub-view (Task 9's "Add a brush")
  replaces the sections, with a Back button.
-->
<script lang="ts">
  import { tick, untrack, type Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { headerOverlay } from '$lib/shell/header-actions.svelte';
  import LayersSection from './LayersSection.svelte';
  import type { PolicyStore } from './policy-store.svelte';

  interface Props {
    store: PolicyStore;
    open: boolean;
    onclose(): void;
    /** Opening the docked panel moves focus into it (false for the default open on md+). */
    focusOnOpen?: boolean;
    /** The panel's id, for the Policy button's `aria-controls`. */
    id?: string;
    /** 'add-brush' replaces the sections with `subview` and a Back button (Task 9). */
    view?: 'sections' | 'add-brush';
    subview?: Snippet;
    onback?: () => void;
    /** The "Your zoning" and "Protections" sections' contents (Tasks 8 to 10). */
    zoning?: Snippet;
    protections?: Snippet;
  }
  let {
    store,
    open,
    onclose,
    focusOnOpen = true,
    id = undefined,
    view = 'sections',
    subview = undefined,
    onback = undefined,
    zoning = undefined,
    protections = undefined
  }: Props = $props();

  const uid = $props.id();
  const panelId = $derived(id ?? `${uid}-policy`);
  const headingId = `${uid}-heading`;

  const wide = new MediaQuery('(min-width: 768px)');

  type SectionId = 'layers' | 'zoning' | 'protections';
  const SECTIONS: { id: SectionId; title: string }[] = [
    { id: 'layers', title: 'Zoning layers' },
    { id: 'zoning', title: 'Your zoning' },
    { id: 'protections', title: 'Protections' }
  ];
  let expanded = $state<Record<SectionId, boolean>>({
    layers: true,
    zoning: false,
    protections: false
  });

  let dialog = $state<HTMLDialogElement>();
  let docked = $state<HTMLElement>();

  // The sheet is a header overlay: opening it (by any input) closes the Menu and the score
  // details, and opening either of those closes the sheet. The docked panel sits apart from them.
  const openOnly = headerOverlay(`${uid}-policy-overlay`, () => {
    if (!wide.current && open) onclose();
  });
  $effect(() => {
    if (open && !wide.current) untrack(openOnly);
  });

  $effect(() => {
    if (dialog && !dialog.open) dialog.showModal();
  });

  // Opening the docked panel moves focus into it, as the sheet does, unless the page opened it
  // by default (focus is moved only on the user's request, WCAG 2.4.3).
  $effect(() => {
    if (docked && untrack(() => focusOnOpen)) void tick().then(() => docked?.focus());
  });

  function oncancel(e: Event): void {
    e.preventDefault();
    onclose();
  }

  /** Escape with focus in the docked panel closes it (the sheet has the dialog's own cancel). */
  function onkeydown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || e.defaultPrevented || !docked) return;
    if (!docked.contains(document.activeElement)) return;
    if (document.querySelector('dialog:modal')) return;
    e.preventDefault();
    onclose();
  }
</script>

<svelte:window {onkeydown} />

{#snippet body()}
  <div class="flex items-center justify-between gap-2 border-b border-gray-300 px-4 py-2">
    <h2 id={headingId} class="text-base font-semibold">Policy</h2>
    <button
      type="button"
      aria-label="Close policy"
      class="min-h-6 min-w-6 rounded-md px-2 text-sm font-semibold underline pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      onclick={() => onclose()}>Close</button
    >
  </div>
  {#if view === 'add-brush' && subview}
    <div class="p-4">
      <button
        type="button"
        class="mb-2 min-h-6 rounded-md px-1 text-sm font-semibold underline pointer-coarse:min-h-11"
        onclick={() => onback?.()}>Back</button
      >
      {@render subview()}
    </div>
  {:else}
    {#each SECTIONS as s (s.id)}
      {@const bodyId = `${uid}-${s.id}`}
      <div class="border-b border-gray-200">
        <h3>
          <button
            type="button"
            class="flex min-h-11 w-full items-center justify-between gap-2 px-4 text-left text-sm font-semibold"
            aria-expanded={expanded[s.id]}
            aria-controls={bodyId}
            onclick={() => (expanded[s.id] = !expanded[s.id])}
          >
            <span>{s.title}</span>
            <span aria-hidden="true">{expanded[s.id] ? '−' : '+'}</span>
          </button>
        </h3>
        {#if expanded[s.id]}
          <div id={bodyId} class="px-4 pb-4">
            {#if s.id === 'layers'}
              <LayersSection {store} />
            {:else if s.id === 'zoning'}
              {@render zoning?.()}
            {:else}
              {@render protections?.()}
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
{/snippet}

{#if open}
  {#if wide.current}
    <section
      bind:this={docked}
      id={panelId}
      aria-labelledby={headingId}
      tabindex="-1"
      data-testid="policy-panel"
      class="sim-policy-docked absolute top-0 left-0 z-30 w-80 overflow-y-auto border-r border-gray-300 bg-white text-black shadow-lg focus:outline-none"
      style:bottom="var(--fzp-scrubber-h, 0px)"
    >
      {@render body()}
    </section>
  {:else}
    <dialog
      bind:this={dialog}
      id={panelId}
      aria-labelledby={headingId}
      data-testid="policy-panel"
      class="mx-0 mt-auto mb-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-lg bg-white text-black shadow-lg backdrop:bg-black/30"
      {oncancel}
    >
      {@render body()}
    </dialog>
  {/if}
{/if}

<style>
  /* The card offset (layout ruling 3): the project card's md left edge reads this variable.
     The map's bottom-left navigation control moves right of the panel too (WCAG 2.2 2.4.11). */
  @media (min-width: 768px) {
    :global(.sfh-fzp:has(.sim-policy-docked)) {
      --sim-panel-w: 320px;
    }
    :global(.sfh-fzp:has(.sim-policy-docked) .maplibregl-ctrl-bottom-left) {
      left: var(--sim-panel-w);
    }
  }
</style>
