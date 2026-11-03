<!--
  Undo and Redo as icon buttons named by the change they would undo or redo, then an info
  disclosure holding the keyboard shortcuts (hidden on coarse pointers, as on `/`). Colours are
  tokens.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { SHORTCUTS } from '$lib/brush/shortcuts';
  import { HISTORY_ICONS } from './tools';

  interface Props {
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string | null;
    redoLabel: string | null;
    onundo(): void;
    onredo(): void;
  }

  let { canUndo, canRedo, undoLabel, redoLabel, onundo, onredo }: Props = $props();

  let coarse = $state(false);
  onMount(() => {
    try {
      coarse = matchMedia('(pointer: coarse)').matches;
    } catch {
      coarse = false;
    }
  });

  const undoName = $derived(undoLabel ? `Undo: ${undoLabel}` : 'Undo');
  const redoName = $derived(redoLabel ? `Redo: ${redoLabel}` : 'Redo');

  const BTN =
    'flex min-h-11 min-w-11 items-center justify-center rounded-md border border-control-line bg-surface text-ink enabled:hover:bg-surface-raised disabled:opacity-40 dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark dark:enabled:hover:bg-surface-dark-raised';
</script>

{#snippet icon(paths: readonly string[])}
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    {#each paths as d (d)}<path {d} />{/each}
  </svg>
{/snippet}

<div class="flex flex-wrap items-start gap-1 text-ink dark:text-ink-dark">
  <button
    type="button"
    aria-label={undoName}
    title={undoName}
    disabled={!canUndo}
    class={BTN}
    onclick={() => onundo()}>{@render icon(HISTORY_ICONS.undo)}</button
  >
  <button
    type="button"
    aria-label={redoName}
    title={redoName}
    disabled={!canRedo}
    class={BTN}
    onclick={() => onredo()}>{@render icon(HISTORY_ICONS.redo)}</button
  >
  {#if !coarse}
    <details class="ml-auto text-xs open:w-full">
      <summary
        class="flex min-h-11 cursor-pointer items-center rounded-md px-2 text-sm text-ink-muted underline hover:bg-surface-raised dark:text-ink-dark-muted dark:hover:bg-surface-dark-raised"
        >Keyboard shortcuts</summary
      >
      <table aria-label="Keyboard shortcuts" class="mt-1 w-full text-left">
        <thead>
          <tr><th scope="col" class="py-1 pr-2">Key</th><th scope="col">Action</th></tr>
        </thead>
        <tbody>
          {#each SHORTCUTS as s (s.keys)}
            <tr><td class="py-1 pr-2 font-mono">{s.keys}</td><td>{s.action}</td></tr>
          {/each}
        </tbody>
      </table>
    </details>
  {/if}
</div>
