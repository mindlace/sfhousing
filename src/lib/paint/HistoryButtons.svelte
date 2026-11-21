<!--
  Undo and Redo as icon buttons named by the change they would undo or redo, then the Shortcuts
  button (`ShortcutsButton`, which renders nothing on a coarse pointer). `/sim`'s header shows
  all of it; `/` shows this row only on a coarse pointer (a phone or tablet has no keyboard), so
  there it is just the two buttons. Colours are tokens.
-->
<script lang="ts">
  import ShortcutsButton from './ShortcutsButton.svelte';
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

  const undoName = $derived(undoLabel ? `Undo: ${undoLabel}` : 'Undo');
  const redoName = $derived(redoLabel ? `Redo: ${redoLabel}` : 'Redo');

  const BTN =
    'flex min-h-6 min-w-6 items-center justify-center rounded-md border border-control-line bg-surface text-ink enabled:hover:bg-surface-raised disabled:opacity-40 dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark dark:enabled:hover:bg-surface-dark-raised';
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
  <ShortcutsButton />
</div>
