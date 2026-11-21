<script lang="ts">
  import { SURFACE_POP } from '$lib/shell/ui';
  import type { SaveStatus } from './autosave.svelte';
  import { COPY } from './copy';

  let {
    status,
    align = 'end',
    covered = false
  }: {
    status: SaveStatus;
    /** The popover's edge: 'end' (right-aligned, for a right-hand slot) or 'start' (left). */
    align?: 'start' | 'end';
    /**
     * Another status covers this one in its cell (/sim's "Updating"): the button goes inert and
     * the popover closes; the live region keeps speaking.
     */
    covered?: boolean;
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
  when the text comes or goes; the shown text and the "Autosave off" button share its cell. -->
<div
  class="relative inline-grid items-center text-xs text-gray-700 dark:text-gray-300"
  data-testid="save-state"
  data-save-status={status}
  bind:this={root}
>
  <span class="invisible col-start-1 row-start-1 whitespace-nowrap" aria-hidden="true">Saving…</span
  >
  {#if status === 'off'}
    <button
      type="button"
      class="col-start-1 row-start-1 min-h-6 min-w-6 rounded-full border border-amber-700 bg-amber-50 px-2 whitespace-nowrap text-amber-900"
      aria-expanded={popOpen}
      aria-controls={popId}
      inert={covered}
      onclick={() => (popOpen = !popOpen)}
    >
      {COPY.autosaveOff}
    </button>
    <p
      id={popId}
      hidden={!popOpen}
      class={[
        // z-40: above the messages over the map (the notices, the failure column and the stroke
        // chip, z-10 to z-30), which come later in the page.
        'absolute top-full z-40 mt-1 w-64 max-w-[calc(100vw-2rem)]',
        SURFACE_POP,
        align === 'start' ? 'left-0' : 'right-0'
      ]}
    >
      {COPY.n4}
    </p>
  {:else if status === 'saving'}
    <span class="col-start-1 row-start-1 whitespace-nowrap" data-testid="save-text">Saving…</span>
  {/if}
  <!-- `visible`: a covering parent hides the rest with `visibility: hidden` (/sim's "Updating");
       the announcements still reach screen readers. -->
  <span class="visible sr-only" role="status" aria-live="polite" data-testid="save-live"
    >{announcement}</span
  >
</div>
