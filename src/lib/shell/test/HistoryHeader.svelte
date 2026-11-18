<script lang="ts">
  // Test host: SiteHeader on /sim with a plain pinned score button and the actions of the
  // paint page's row: Undo, Redo and the keyboard shortcuts (HistoryButtons), then Publish.
  import HistoryButtons from '$lib/paint/HistoryButtons.svelte';
  import SiteHeader from '../SiteHeader.svelte';
</script>

{#snippet pinned()}
  <button type="button" class="min-h-6 px-2 text-sm">12,345 homes added</button>
{/snippet}

{#snippet actions()}
  <HistoryButtons
    canUndo={true}
    canRedo={true}
    undoLabel="Allowed 8 stories"
    redoLabel="Erased custom zoning"
    onundo={() => {}}
    onredo={() => {}}
  />
  <button type="button" class="min-h-6 px-2 text-sm">Publish</button>
{/snippet}

<SiteHeader routeId="/sim" {actions} {pinned} />
<div data-testid="outside" style="height: 400px">Map</div>
