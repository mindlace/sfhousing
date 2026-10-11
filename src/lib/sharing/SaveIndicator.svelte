<script lang="ts">
  import type { SaveStatus } from './autosave.svelte';
  import { COPY } from './copy';

  let { status }: { status: SaveStatus } = $props();

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

<div class="relative flex items-center text-xs text-gray-700" bind:this={root}>
  {#if status === 'off'}
    <button
      type="button"
      class="min-h-6 min-w-6 rounded-full border border-amber-700 bg-amber-50 px-2 whitespace-nowrap text-amber-900 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      aria-expanded={popOpen}
      aria-controls={popId}
      onclick={() => (popOpen = !popOpen)}
    >
      {COPY.autosaveOff}
    </button>
    <p
      id={popId}
      hidden={!popOpen}
      class="absolute top-full right-0 z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-gray-300 bg-white p-3 text-sm text-gray-800 shadow-lg"
    >
      {COPY.n4}
    </p>
  {:else}
    <span class="whitespace-nowrap">{status === 'saving' ? 'Saving…' : 'Saved'}</span>
  {/if}
  <span class="sr-only" role="status" aria-live="polite" data-testid="save-live"
    >{announcement}</span
  >
</div>
