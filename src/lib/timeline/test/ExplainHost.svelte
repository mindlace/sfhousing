<script lang="ts">
  // Test host: Explain around a plain text target (button mode) or a focusable child (wrap mode).
  import Explain from '../Explain.svelte';

  let {
    text,
    as = 'button',
    label = undefined,
    own = undefined
  }: { text: string; as?: 'button' | 'wrap'; label?: string; own?: string } = $props();
</script>

<div>
  {#if own}<span id="own-d">{own}</span>{/if}
  <Explain {text} {as} {label}>
    {#if as === 'wrap'}
      <a href="#x" data-testid="target" aria-describedby={own ? 'own-d' : undefined}>Target</a>
    {:else}
      <span data-testid="target">Target</span>
    {/if}
  </Explain>
  <button type="button">After</button>
</div>
