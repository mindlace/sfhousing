<script lang="ts">
  // Test host: NoticePills around two chips (none with `empty`), and with `card` a notice with
  // details, inside a positioned host as FzpMode and BrushEditor render it.
  import Message from '../Message.svelte';
  import NoticePills from '../NoticePills.svelte';
  import { BUTTON_QUIET } from '../ui';

  let { empty = false, card = false }: { empty?: boolean; card?: boolean } = $props();
</script>

{#snippet retry()}
  <button type="button" class={BUTTON_QUIET}>Retry</button>
{/snippet}
{#snippet details()}
  <ul class="list-disc pl-4 text-xs"><li>One detail</li></ul>
{/snippet}

<div data-testid="pills-host" class="sfh-dock-host relative" style="height: 400px">
  <NoticePills>
    {#if !empty}
      <div role="status" class="contents">
        <Message text="First notice" testid="first" />
      </div>
      <div role="status" class="contents">
        <Message text="Second notice" actions={retry} testid="second" />
      </div>
      {#if card}
        <div role="status" class="contents">
          <Message text="Third notice" {details} testid="third" />
        </div>
      {/if}
    {/if}
  </NoticePills>
</div>
