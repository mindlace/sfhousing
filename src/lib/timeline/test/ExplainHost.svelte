<script lang="ts">
  // Test host: Explain around a plain text target (button mode) or a focusable child (wrap mode).
  // `onwindowkey`: a bubbling window listener, as a page's own Escape handlers are; it reports
  // whether the key arrived already handled.
  import Explain from '../Explain.svelte';

  let {
    text,
    as = 'button',
    label = undefined,
    own = undefined,
    onwindowkey = undefined
  }: {
    text: string;
    as?: 'button' | 'wrap';
    label?: string;
    own?: string;
    onwindowkey?: (key: string, prevented: boolean) => void;
  } = $props();

  // Installed as the host starts, before Explain mounts, so it is not merely later in line.
  const on = (e: KeyboardEvent) => onwindowkey?.(e.key, e.defaultPrevented);
  window.addEventListener('keydown', on);
  $effect(() => () => window.removeEventListener('keydown', on));
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
