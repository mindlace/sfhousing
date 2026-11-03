<!--
  The notice stack: every notice on `/`, `/p/:id`, `/sim` and `/s/<id>` is a pill (`PILL` in
  ./pill) in this column, one stack per page. From md it overlays the map's top, centred over the
  map right of the dock (`--dock-w`: the open panel or the rail), and takes no space, so a notice
  never moves the dock, the time bar or the map inset. The container lets clicks through to the
  map; each pill takes them. Below md it sits in flow under the header, full width, and pushes the
  map down (the phone rule, spec Goal 8).
  Map-view's failure chips sit at the same top centre, so from md the stack publishes its
  bottom edge, in px from its host's top, on its host (the parent element: FzpMode's or
  BrushEditor's root) as `--notice-pills-bottom`, and SimMap places the chips below it. It is `0px`
  while the stack is empty and below md (in flow, the map is already below it).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';

  /** `el` is the stack's element, for a host that places something clear of the pills. */
  let { children, el = $bindable() }: { children: Snippet; el?: HTMLElement } = $props();

  const wide = new MediaQuery('(min-width: 48rem)');
  let height = $state(0);
  $effect(() => {
    const stack = el;
    const host = stack?.parentElement;
    if (!stack || !host) return;
    const bottom = wide.current && height > 0 ? stack.offsetTop + height : 0;
    host.style.setProperty('--notice-pills-bottom', `${Math.round(bottom)}px`);
    return () => host.style.removeProperty('--notice-pills-bottom');
  });
</script>

<div
  bind:this={el}
  bind:offsetHeight={height}
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
