<script lang="ts">
  import { createRawSnippet, type Snippet } from 'svelte';
  import { useHeaderActions } from '../header-actions.svelte';

  let {
    label,
    pinned,
    status,
    shared
  }: { label: string; pinned?: string; status?: string; shared?: Snippet } = $props();
  const button = (text: string) =>
    createRawSnippet(() => ({ render: () => `<button>${text}</button>` }));
  const text = (t: string) => createRawSnippet(() => ({ render: () => `<span>${t}</span>` }));
  // svelte-ignore state_referenced_locally
  useHeaderActions(
    shared ?? button(label),
    pinned === undefined && status === undefined
      ? undefined
      : {
          pinned: pinned === undefined ? undefined : button(pinned),
          status: status === undefined ? undefined : text(status)
        }
  );
</script>
