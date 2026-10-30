<script lang="ts">
  import { createRawSnippet } from 'svelte';
  import { useHeaderActions } from '../header-actions.svelte';

  let { label, pinned }: { label: string; pinned?: string } = $props();
  const button = (text: string) =>
    createRawSnippet(() => ({ render: () => `<button>${text}</button>` }));
  // svelte-ignore state_referenced_locally
  useHeaderActions(button(label), pinned === undefined ? undefined : { pinned: button(pinned) });
</script>
