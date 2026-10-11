<script lang="ts">
  import { createRawSnippet } from 'svelte';
  import { useHeaderActions } from '../header-actions.svelte';

  let { label }: { label: string } = $props();
  useHeaderActions(createRawSnippet(() => ({ render: () => `<button>${label}</button>` })));
</script>
