<!--
  The phone floating tool bar (layout ruling 5): below md, while a stroke tool is active and the
  policy sheet is closed. It shows the tool, the stories and radius pop-overs (as on `/`) and
  Done, which goes back to Move and the sheet. Mode and Density need the sheet; Protect and
  Unprotect have no stories (ruling 8). It sits above the scrubber. On a fine pointer (a narrow
  desktop window) the map's bottom-left navigation control would sit under it, so while the bar
  shows the control is lifted above it (WCAG 2.2 2.4.11).
-->
<script lang="ts">
  import RadiusPopover from '$lib/brush/RadiusPopover.svelte';
  import StoriesPopover from '$lib/brush/StoriesPopover.svelte';
  import {
    ERASE_HINT,
    SIM_TOOLS,
    isProtectTool,
    type SimBrushTools,
    type SimTool
  } from './brush-tools.svelte';

  interface Props {
    tools: SimBrushTools;
    ontool(t: SimTool): void;
    /** After Done chose Move: SimPage reopens the sheet. */
    ondone(): void;
  }

  let { tools, ontool, ondone }: Props = $props();

  type Pop = 'stories' | 'radius';
  let open = $state<Pop | null>(null);
  let bar = $state<HTMLElement>();

  const POP =
    'absolute bottom-full left-0 z-10 mb-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-gray-300 bg-white p-2 text-black shadow-lg';
  const label = $derived(SIM_TOOLS.find((t) => t.id === tools.tool)?.label ?? '');

  function toggle(p: Pop) {
    open = open === p ? null : p;
  }

  /** Moves focus to the bar's first control (after the sheet closed on a tool pick). */
  export function focus(): void {
    bar?.querySelector<HTMLElement>('button')?.focus();
  }
</script>

<div
  bind:this={bar}
  role="group"
  aria-label="Brush"
  data-testid="phone-tool-bar"
  class="sim-phone-tool-bar absolute left-4 z-30 flex items-center gap-1 rounded-lg border border-gray-300 bg-white p-1 text-sm text-black shadow-lg md:hidden"
  style:bottom="calc(var(--fzp-scrubber-h, 0px) + 0.5rem)"
>
  <span class="px-2 font-semibold">{label}</span>
  {#if !isProtectTool(tools.tool)}
    <StoriesPopover
      state={tools.brush}
      disabled={tools.tool === 'erase'}
      hint={ERASE_HINT}
      open={open === 'stories'}
      ontoggle={() => toggle('stories')}
      onclose={() => (open = null)}
      popClass={POP}
    />
  {/if}
  <RadiusPopover
    state={tools.brush}
    open={open === 'radius'}
    ontoggle={() => toggle('radius')}
    onclose={() => (open = null)}
    popClass={POP}
  />
  <button
    type="button"
    class="min-h-11 min-w-11 rounded-md px-3 font-semibold underline"
    onclick={() => {
      open = null;
      ontool('move');
      ondone();
    }}>Done</button
  >
</div>

<style>
  /* The bar is 54 px tall (a 44 px target, 4 px padding, 1 px border) and sits 0.5rem above the
     map inset, so the control's container clears it by 0.5rem + 3.5rem. `.sim-map` outranks
     SimMap's own `bottom` rule for the container. */
  :global(.sfh-fzp:has(.sim-phone-tool-bar) .sim-map .maplibregl-ctrl-bottom-left) {
    bottom: calc(var(--map-bottom-inset, 0px) + 4rem);
  }
</style>
