<!--
  Test host for PaletteStrip: owns `tool` the way a page does and hands the test its `focus()`.
-->
<script lang="ts">
  import type { BrushState } from '$lib/brush/state.svelte';
  import type { BrushTool } from '$lib/brush/sampler';
  import PaletteStrip from '../PaletteStrip.svelte';

  interface Props {
    brush: BrushState;
    tool?: BrushTool;
    eraseHint?: string;
    ontool?: (t: BrushTool) => void;
    ondone?: () => void;
    onready?: (focus: () => void) => void;
  }

  let {
    brush,
    tool: initialTool = 'paint',
    eraseHint = 'Erase has no height.',
    ontool = undefined,
    ondone = undefined,
    onready = undefined
  }: Props = $props();

  // The prop only seeds the host's own state, as a page's would.
  // svelte-ignore state_referenced_locally
  let tool = $state<BrushTool>(initialTool);
  let strip = $state<PaletteStrip>();

  $effect(() => {
    if (strip) onready?.(() => strip?.focus());
  });
</script>

<PaletteStrip
  bind:this={strip}
  {brush}
  {tool}
  ontool={(t) => {
    tool = t;
    ontool?.(t);
  }}
  ondone={() => ondone?.()}
  {eraseHint}
/>
