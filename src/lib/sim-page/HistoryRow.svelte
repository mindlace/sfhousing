<!--
  Undo and Redo (sim runs): the non-drag way back. Named by the change they would undo or redo and
  disabled when there is none. The history covers every section, so the panel renders this row once
  above them.
-->
<script lang="ts">
  import type { PolicyStore } from './policy-store.svelte';

  interface Props {
    store: PolicyStore;
    onundo(): void;
    onredo(): void;
  }
  let { store, onundo, onredo }: Props = $props();
</script>

<div class="flex gap-2 border-b border-gray-200 px-4 py-2">
  <button
    type="button"
    aria-label={store.undoLabel ? `Undo: ${store.undoLabel}` : 'Undo'}
    title={store.undoLabel ? `Undo: ${store.undoLabel}` : undefined}
    disabled={!store.canUndo}
    class="min-h-11 min-w-11 rounded-md border border-gray-300 px-3 text-sm font-medium disabled:opacity-40"
    onclick={() => onundo()}>Undo</button
  >
  <button
    type="button"
    aria-label={store.redoLabel ? `Redo: ${store.redoLabel}` : 'Redo'}
    title={store.redoLabel ? `Redo: ${store.redoLabel}` : undefined}
    disabled={!store.canRedo}
    class="min-h-11 min-w-11 rounded-md border border-gray-300 px-3 text-sm font-medium disabled:opacity-40"
    onclick={() => onredo()}>Redo</button
  >
</div>
