<script lang="ts">
  import type { SaveStatus } from './autosave.svelte';
  import { COPY } from './copy';

  let {
    status,
    align = 'end'
  }: {
    status: SaveStatus;
    /** The popover's edge: 'end' (right-aligned, for a right-hand slot) or 'start' (left). */
    align?: 'start' | 'end';
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
    if (status !== 'off') popOpen = false;
  });

  function onWindowKeydown(e: KeyboardEvent) {
    if (popOpen && e.key === 'Escape') popOpen = false;
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
      class="col-start-1 row-start-1 min-h-6 min-w-6 rounded-full border border-amber-700 bg-amber-50 px-2 whitespace-nowrap text-amber-900 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      aria-expanded={popOpen}
      aria-controls={popId}
      onclick={() => (popOpen = !popOpen)}
    >
      {COPY.autosaveOff}
    </button>
    <p
      id={popId}
      hidden={!popOpen}
      class={[
        'absolute top-full z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-gray-300 bg-white p-3 text-sm text-gray-800 shadow-lg',
        align === 'start' ? 'left-0' : 'right-0'
      ]}
    >
      {COPY.n4}
    </p>
  {:else if status === 'saving'}
    <span class="col-start-1 row-start-1 whitespace-nowrap" data-testid="save-text">Saving…</span>
  {/if}
  <span class="sr-only" role="status" aria-live="polite" data-testid="save-live"
    >{announcement}</span
  >
</div>
