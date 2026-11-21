<!-- A 100 px scroll box with the moreBelow attachment, over content of a given height. `swap`
     replaces the content with another element (a new first child) of that height. -->
<script lang="ts">
  import { moreBelow } from '../more-below';

  let { height = 80, swap = false }: { height?: number; swap?: boolean } = $props();
</script>

<div data-testid="box" class="more-below h-[100px] overflow-y-auto" {@attach moreBelow}>
  {#if swap}
    <section data-testid="swapped" style:height="{height}px"></section>
  {:else}
    <div data-testid="content" style:height="{height}px"></div>
  {/if}
</div>
