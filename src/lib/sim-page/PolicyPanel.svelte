<!--
  The /sim policy panel (layout rulings 3, 4 and 9). From md it docks on the left of the map as a
  `<section>` 320 px wide, ending above the scrubber, and publishes `--sim-panel-w` on `.sfh-fzp`
  so the project card sits to its right, and moves the map's bottom-left navigation control (zoom
  and compass) to its right edge so the panel never covers it (WCAG 2.2 2.4.11). Below md it is a modal sheet (`<dialog>`) that joins the
  header overlays, so it never shows with the phone Menu or the score details. Its sections are
  disclosures, in order: New zoning rules, Custom zoning, Permitting timelines, Protections; the
  two zoning sections start open, the others collapsed. The Undo and Redo row (`history`) sits once
  above them. Below md a sub-view ("Add a rule") replaces the sections, with a Back button. The read-only view (plan 5) shows a summary instead,
  titled "Policy (read-only)". During a run (`readonly`, spec §1) a reset button ("Change policy",
  or "Back to start" on /s/<id>) and the line "Read-only during a run" sit at the top, and the
  history row hides. The sections read the state through `policyReadonly()` and wrap their
  editing controls in `ReadonlyFieldset` (disabled, described by that line), so every control
  stays readable and controls that only show information stay usable; the disclosure toggles
  still work. After the reset, focus moves to the first section toggle (WCAG 2.4.3).
-->
<script lang="ts">
  import { tick, untrack, type Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { headerOverlay } from '$lib/shell/header-actions.svelte';
  import { provideReadonly } from './policy-readonly';

  interface Props {
    open: boolean;
    onclose(): void;
    /** Opening the docked panel moves focus into it (false for the default open on md+). */
    focusOnOpen?: boolean;
    /** The panel's id, for the Policy button's `aria-controls`. */
    id?: string;
    /**
     * 'add-brush' replaces the sections with `subview` and a Back button (Task 9); 'summary'
     * (the read-only /s/<id>, plan 5) shows `summary` under the title "Policy (read-only)".
     */
    view?: 'sections' | 'add-brush' | 'summary';
    subview?: Snippet;
    summary?: Snippet;
    onback?: () => void;
    /** The Undo and Redo row, once above the sections (it covers every section). */
    history?: Snippet;
    /** The "New zoning rules", "Custom zoning" and "Protections" sections' contents. */
    rules?: Snippet;
    custom?: Snippet;
    protections?: Snippet;
    /** The "Permitting timelines" section's contents; the section shows only when given. */
    timing?: Snippet;
    /** A second line under that section's title (the set's label). */
    timingSummary?: string;
    /** During a run: the reset button on top, no history row, every section body disabled. */
    readonly?: boolean;
    /** The reset button's press (ends the run). */
    onreset?: () => void;
    resetLabel?: 'Change policy' | 'Back to start';
  }
  let {
    open,
    onclose,
    focusOnOpen = true,
    id = undefined,
    view = 'sections',
    subview = undefined,
    summary = undefined,
    onback = undefined,
    history = undefined,
    rules = undefined,
    custom = undefined,
    protections = undefined,
    timing = undefined,
    timingSummary = undefined,
    readonly = false,
    onreset = undefined,
    resetLabel = 'Change policy'
  }: Props = $props();

  const uid = $props.id();
  const panelId = $derived(id ?? `${uid}-policy`);
  const headingId = `${uid}-heading`;
  const noteId = `${uid}-readonly-note`;
  provideReadonly(() => ({ on: readonly, noteId: readonly ? noteId : undefined }));

  let headingEl = $state<HTMLElement>();

  /**
   * Ends the run. The reset button goes with the read-only state, so focus moves to the first
   * section toggle (or the heading, in the summary view) instead of falling to the body.
   */
  async function reset(): Promise<void> {
    onreset?.();
    await tick();
    const toggle = (docked ?? dialog)?.querySelector<HTMLElement>('[data-section-toggle]');
    (toggle ?? headingEl)?.focus();
  }

  const wide = new MediaQuery('(min-width: 768px)');

  type SectionId = 'rules' | 'custom' | 'timing' | 'protections';
  const ALL_SECTIONS: { id: SectionId; title: string }[] = [
    { id: 'rules', title: 'New zoning rules' },
    { id: 'custom', title: 'Custom zoning' },
    { id: 'timing', title: 'Permitting timelines' },
    { id: 'protections', title: 'Protections' }
  ];
  const SECTIONS = $derived(ALL_SECTIONS.filter((s) => s.id !== 'timing' || timing));
  let expanded = $state<Record<SectionId, boolean>>({
    rules: true,
    custom: true,
    timing: false,
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
    <h2 bind:this={headingEl} id={headingId} tabindex="-1" class="text-base font-semibold">
      {view === 'summary' ? 'Policy (read-only)' : 'Policy'}
    </h2>
    <button
      type="button"
      aria-label="Close policy"
      class="min-h-6 min-w-6 rounded-md px-2 text-sm font-semibold underline pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      onclick={() => onclose()}>Close</button
    >
  </div>
  {#if readonly}
    <div class="flex flex-col items-start gap-1 border-b border-gray-300 px-4 py-2">
      <p id={noteId} class="text-sm text-gray-700">Read-only during a run</p>
      <button
        type="button"
        class="min-h-11 rounded-md border border-gray-500 px-3 text-sm font-semibold"
        onclick={() => void reset()}>{resetLabel}</button
      >
    </div>
  {/if}
  {#if view === 'summary'}
    {@render summary?.()}
  {:else if view === 'add-brush' && subview}
    <div class="p-4">
      <button
        type="button"
        class="mb-2 min-h-6 rounded-md px-1 text-sm font-semibold underline pointer-coarse:min-h-11"
        onclick={() => onback?.()}>Back</button
      >
      <fieldset
        disabled={readonly}
        aria-describedby={readonly ? noteId : undefined}
        class="contents"
      >
        {@render subview()}
      </fieldset>
    </div>
  {:else}
    {#if !readonly}
      {@render history?.()}
    {/if}
    {#each SECTIONS as s (s.id)}
      {@const bodyId = `${uid}-${s.id}`}
      <div class="border-b border-gray-200">
        <h3>
          <button
            type="button"
            data-section-toggle
            class="flex min-h-11 w-full items-center justify-between gap-2 px-4 text-left text-sm font-semibold"
            aria-expanded={expanded[s.id]}
            aria-controls={bodyId}
            aria-label={s.id === 'timing' && timingSummary
              ? `${s.title}, ${timingSummary}`
              : undefined}
            onclick={() => (expanded[s.id] = !expanded[s.id])}
          >
            <span class="flex flex-col"
              >{s.title}{#if s.id === 'timing' && timingSummary}<span
                  class="text-xs font-normal text-gray-700">{timingSummary}</span
                >{/if}</span
            >
            <span aria-hidden="true">{expanded[s.id] ? '−' : '+'}</span>
          </button>
        </h3>
        {#if expanded[s.id]}
          <div id={bodyId} class="px-4 pb-4">
            {#if s.id === 'rules'}
              {@render rules?.()}
            {:else if s.id === 'custom'}
              {@render custom?.()}
            {:else if s.id === 'protections'}
              {@render protections?.()}
            {:else}
              {@render timing?.()}
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
