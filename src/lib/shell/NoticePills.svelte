<!--
  The notice stack: every /sim and /fzp notice is a pill (`PILL` in ./pill) in this column. From md
  it overlays the map's top, centred over the map right of the dock (`--dock-w`: the open panel or
  the rail), and takes no space, so a notice never moves the dock, the time bar or the map inset.
  The container lets clicks through to the map; each pill takes them. Below md it sits in flow
  under the header, full width, and pushes the map down (the phone rule, spec Goal 8).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<div
  data-testid="fzp-notices"
  class="sfh-notice-pills pointer-events-none flex flex-col items-center gap-1 px-4 py-1 md:absolute md:top-2 md:z-30 md:w-max md:-translate-x-1/2 md:p-0"
>
  {@render children()}
</div>

<style>
  /* Below md the stack is in flow: with no pill showing it takes no space. */
  @media (max-width: 47.999rem) {
    .sfh-notice-pills:not(:has(:global(.pointer-events-auto))) {
      padding-block: 0;
    }
  }
  @media (min-width: 48rem) {
    .sfh-notice-pills {
      left: calc(50% + var(--dock-w, 0px) / 2);
      max-width: calc(100% - 2rem - var(--dock-w, 0px));
    }
  }
</style>
