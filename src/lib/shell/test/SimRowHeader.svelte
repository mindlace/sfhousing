<script lang="ts">
  // Test host: /sim's widest header row from lg on a fine-only pointer. The status cell holds
  // "Autosave off" with "Updating" beside it (Task 4's shape), the score is the real HeaderScore
  // with a five-digit total and its delta, the action is Publish, and the account entry shows
  // `user`'s handle. `touch` adds Undo and Redo before Publish (a touch laptop), as on /sim.
  import HistoryButtons from '$lib/paint/HistoryButtons.svelte';
  import SaveIndicator from '$lib/sharing/SaveIndicator.svelte';
  import { BUTTON_PRIMARY } from '../ui';
  import HeaderScoreHeader from './HeaderScoreHeader.svelte';

  let { user = null, touch = false }: { user?: { handle: string } | null; touch?: boolean } =
    $props();
</script>

{#snippet status()}
  <span class="inline-flex items-center gap-2" data-testid="status-row">
    <SaveIndicator status="off" align="start" />
    <span class="text-sm whitespace-nowrap text-ink-muted dark:text-ink-dark-muted">Updating</span>
  </span>
{/snippet}

{#snippet actions()}
  {#if touch}
    <HistoryButtons
      canUndo={true}
      canRedo={true}
      undoLabel="Allowed 8 stories"
      redoLabel="Erased custom zoning"
      onundo={() => {}}
      onredo={() => {}}
    />
  {/if}
  <button type="button" class={BUTTON_PRIMARY}>Publish</button>
{/snippet}

<HeaderScoreHeader {actions} {status} {user} total={12345} delta={1817} />
