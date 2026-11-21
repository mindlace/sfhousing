<!-- A map-sized box with MapKeyControl over it, for MapKeyControl.svelte.spec.ts. -->
<script lang="ts">
  import Explain from '$lib/timeline/Explain.svelte';
  import MapKeyControl from '../MapKeyControl.svelte';

  interface Props {
    /** The map box's height, px. */
    height?: number;
    openFromMd?: boolean;
    hidden?: boolean;
    stale?: boolean;
    withLayers?: boolean;
    /** An explanation in the key panel, as SimKey's mark row has. */
    withExplain?: boolean;
    /** Lines in the key panel. */
    lines?: number;
    el?: HTMLElement;
    onopenchange?: (open: 'key' | 'layers' | null) => void;
  }
  let {
    height = 600,
    openFromMd = false,
    hidden = false,
    stale = false,
    withLayers = false,
    withExplain = false,
    lines = 3,
    el = $bindable(),
    onopenchange = undefined
  }: Props = $props();
</script>

{#snippet key()}
  <p data-testid="host-key-body">Key body</p>
  {#if withExplain}
    <p><Explain text="Why this row shows.">Marked</Explain></p>
  {/if}
  {#each { length: lines }, i (i)}
    <p class="leading-5">Row {i}</p>
  {/each}
{/snippet}

{#snippet layers()}
  <label class="flex items-center gap-2"><input type="checkbox" /> Transit stops</label>
{/snippet}

<div data-testid="host-map" class="relative w-full" style:height="{height}px">
  <button type="button" data-testid="host-before">Zoom in</button>
  <div data-testid="host-canvas" class="absolute inset-0"></div>
  <MapKeyControl
    {key}
    layers={withLayers ? layers : undefined}
    {openFromMd}
    {hidden}
    {stale}
    {onopenchange}
    bind:el
  />
</div>
