<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import Tree from '../Tree.svelte';

  interface TreeHostProps {
    tree: ComponentProps<typeof Tree>;
    /** Each Escape keydown that reaches window (svelte:window). */
    onescape?: () => void;
  }

  let { tree, onescape }: TreeHostProps = $props();

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') onescape?.();
  }
</script>

<svelte:window {onkeydown} />

<div data-testid="tree-host" class="h-[600px] w-full">
  <Tree {...tree} />
</div>
