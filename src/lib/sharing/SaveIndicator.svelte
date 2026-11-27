<script lang="ts">
  import { SURFACE_POP } from '$lib/shell/ui';
  import type { SaveStatus } from './autosave.svelte';
  import { COPY } from './copy';

  let {
    status,
    align = 'end',
    covered = false,
    icons = false
  }: {
    status: SaveStatus;
    /** The popover's edge: 'end' (right-aligned, for a right-hand slot) or 'start' (left; right
     *  below sm, where a header status sits after the pinned item). */
    align?: 'start' | 'end';
    /**
     * Another status covers this one in its cell (/sim's "Updating"): the button goes inert and
     * the popover closes; the live region keeps speaking.
     */
    covered?: boolean;
    /**
     * A game's header: below sm the cell is icons, so the pinned goal has the room on a phone.
     * "Saving…" and its sizer draw nothing; "Autosave off" is a 24 px icon button, its word kept
     * as its name. From sm the cell is as always.
     */
    icons?: boolean;
  } = $props();

  const uid = $props.id();
  const popId = `${uid}-n4`;

  let popOpen = $state(false);
  let announcement = $state('');
  let root: HTMLElement | undefined = $state();

  // Whether autosave is known to work. 'saving' tells us nothing new: recovery from 'off'
  // is only known once a write succeeds ('saved').
  let known: 'on' | 'off' | undefined;

  $effect(() => {
    const next = status === 'off' ? 'off' : status === 'saved' ? 'on' : known;
    if (known === undefined) {
      known = next ?? 'on';
      return;
    }
    if (next !== undefined && next !== known) {
      known = next;
      announcement = next === 'off' ? COPY.autosaveOff : 'Autosave on';
    }
  });

  $effect(() => {
    if (status !== 'off' || covered) popOpen = false;
  });

  // An Escape already handled (an open explanation's, `defaultPrevented`) is not this one's.
  function onWindowKeydown(e: KeyboardEvent) {
    if (popOpen && e.key === 'Escape' && !e.defaultPrevented) popOpen = false;
  }

  function onWindowPointerdown(e: PointerEvent) {
    if (popOpen && root && !root.contains(e.target as Node)) popOpen = false;
  }
</script>

<svelte:window onkeydown={onWindowKeydown} onpointerdown={onWindowPointerdown} />

<!-- One inline grid cell: the invisible sizer holds the width of "Saving…" so the header never moves
  when the text comes or goes; the shown text and the "Autosave off" button share its cell. With
  `icons`, below sm, the sizer and "Saving…" draw nothing and "Autosave off" is an icon. -->
<div
  class="relative inline-grid items-center text-xs text-gray-700 dark:text-gray-300"
  data-testid="save-state"
  data-save-status={status}
  bind:this={root}
>
  <span
    class={['invisible col-start-1 row-start-1 whitespace-nowrap', icons && 'max-sm:hidden']}
    aria-hidden="true">Saving…</span
  >
  {#if status === 'off'}
    <button
      type="button"
      class={[
        'col-start-1 row-start-1 min-h-6 min-w-6 rounded-full border border-amber-700 bg-amber-50 px-2 whitespace-nowrap text-amber-900',
        icons && 'max-sm:inline-flex max-sm:items-center max-sm:justify-center max-sm:px-0'
      ]}
      aria-expanded={popOpen}
      aria-controls={popId}
      inert={covered}
      onclick={() => (popOpen = !popOpen)}
    >
      {#if icons}
        <!-- A disk struck through: autosave is off. -->
        <svg
          aria-hidden="true"
          class="hidden max-sm:block"
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
          ><path d="M3 2.5h8l2.5 2.5v8.5h-11z M5.5 2.5v3.5h5v-3.5" /><path
            d="M1.5 1.5l13 13"
            stroke-linecap="round"
          /></svg
        ><span class="max-sm:sr-only">{COPY.autosaveOff}</span>
      {:else}
        {COPY.autosaveOff}
      {/if}
    </button>
    <p
      id={popId}
      hidden={!popOpen}
      class={[
        // z-40: above the messages over the map (the notices, the failure column and the stroke
        // chip, z-10 to z-30), which come later in the page.
        'absolute top-full z-40 mt-1 w-64 max-w-[calc(100vw-2rem)]',
        SURFACE_POP,
        align === 'start' ? 'left-0 max-sm:right-0 max-sm:left-auto' : 'right-0'
      ]}
    >
      {COPY.n4}
    </p>
  {:else if status === 'saving'}
    <span
      class={['col-start-1 row-start-1 whitespace-nowrap', icons && 'max-sm:hidden']}
      data-testid="save-text">Saving…</span
    >
  {/if}
  <!-- `visible`: a covering parent hides the rest with `visibility: hidden` (/sim's "Updating");
       the announcements still reach screen readers. -->
  <span class="visible sr-only" role="status" aria-live="polite" data-testid="save-live"
    >{announcement}</span
  >
</div>
