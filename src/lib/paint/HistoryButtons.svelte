<!--
  Undo and Redo as icon buttons named by the change they would undo or redo (`historyName`). Each
  page shows the row only while some pointer is coarse (`usePrimaryPointer().touch`): `/` above the
  Paint tab, `/sim` in its header. The Shortcuts button is the page's own, beside it. Colours are
  tokens.
-->
<script lang="ts">
  import { historyName } from './history';
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

  const undoName = $derived(historyName('undo', undoLabel));
  const redoName = $derived(historyName('redo', redoLabel));

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

<div class="flex items-start gap-1 text-ink dark:text-ink-dark">
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
</div>
