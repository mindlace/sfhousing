<!-- Test harness: opener buttons for SourcesDialog, so focus return has something to return to. -->
<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import SourcesDialog from '../SourcesDialog.svelte';

  let props: ComponentProps<typeof SourcesDialog> = $props();
  let dialog: SourcesDialog;
</script>

<button type="button" onclick={() => dialog.open()}>Sources</button>
<button type="button" onclick={() => dialog.open('src-transition-discretionary-entitled')}>
  Open at entitled
</button>
<SourcesDialog bind:this={dialog} {...props} />
