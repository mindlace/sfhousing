<!--
  The phone palette strip, shared by `/sim` and (plan 5) `/`: below md, while Paint or Erase is the
  tool and the dock's sheet is out of the way, one line over the map: the tool (a button that
  cycles Paint and Erase), the height swatch (a neutral tile with the story count, opening a
  pop-over that holds the height palette; disabled with the hint while Erase), the brush size (the
  radius pop-over) and Done. The page's `ontool` routes a tool choice (on a phone it closes the
  sheet for Paint and Erase); Done chooses Move through it, then `ondone` lets the page reopen the
  sheet. The pop-overs share one open slot (opening one closes the other); Escape closes the open
  one and returns focus to its opener; a press outside closes it. The strip sits above the
  scrubber (`--fzp-scrubber-h`, 0 when unset) and above `lift` px (the dock's sheet handle on
  `/sim`). On a fine pointer (a narrow desktop window) the map's bottom-left navigation control
  would sit under it, so while the strip shows the control is lifted above it (WCAG 2.2 2.4.11).
  Colours are tokens; a control's hover steps one level up from its background.
-->
<script lang="ts">
  import RadiusPopover from '$lib/brush/RadiusPopover.svelte';
  import type { BrushTool } from '$lib/brush/sampler';
  import type { BrushState } from '$lib/brush/state.svelte';
  import HeightPalette from './HeightPalette.svelte';
  import { PAINT_TOOLS } from './tools';

  interface Props {
    brush: BrushState;
    tool: BrushTool;
    /**
     * Choosing a tool: the page's handler sets it and, on a phone, closes the sheet
     * (`dock.sheet = 'closed'`) when it is Paint or Erase.
     */
    ontool(t: BrushTool): void;
    /** After Done chose Move: the page reopens the sheet on Paint. */
    ondone(): void;
    /** Why the height swatch is disabled while Erase is chosen. */
    eraseHint: string;
    /** Px above the scrubber to clear (the dock's sheet handle on `/sim`). */
    lift?: number;
  }

  let { brush, tool, ontool, ondone, eraseHint, lift = 0 }: Props = $props();

  const uid = $props.id();
  const popId = `${uid}-height-pop`;
  const hintId = `${uid}-hint`;

  type Pop = 'height' | 'radius';
  let open = $state<Pop | null>(null);
  let bar = $state<HTMLElement>();
  let swatch = $state<HTMLButtonElement>();
  let popEl = $state<HTMLElement>();

  const erasing = $derived(tool === 'erase');
  const current = $derived(PAINT_TOOLS.find((t) => t.id === tool) ?? PAINT_TOOLS[1]);
  const stories = $derived(brush.stories);
  const storiesName = $derived(`${stories} ${stories === 1 ? 'story' : 'stories'}`);

  // Erase disables the swatch: a pop-over left open would hold a disabled palette.
  $effect(() => {
    if (erasing && open === 'height') open = null;
  });

  function toggle(p: Pop) {
    open = open === p ? null : p;
  }

  function onWindowKey(e: KeyboardEvent) {
    if (open !== 'height' || e.key !== 'Escape') return;
    open = null;
    swatch?.focus();
  }

  function onWindowPointer(e: PointerEvent) {
    if (open !== 'height') return;
    const t = e.target as Node | null;
    if (t && (popEl?.contains(t) || swatch?.contains(t))) return;
    open = null;
  }

  /** Moves focus to the strip's first control (after the sheet closed on a tool pick). */
  export function focus(): void {
    bar?.querySelector<HTMLElement>('button')?.focus();
  }

  const CTL =
    'min-h-11 min-w-11 rounded-md px-2 text-sm font-semibold text-ink enabled:hover:bg-surface-raised disabled:opacity-40 dark:text-ink-dark dark:enabled:hover:bg-surface-dark-raised';
  const POP =
    'absolute bottom-full left-0 z-10 mb-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-2 text-ink shadow-lg dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark';
</script>

<svelte:window onkeydown={onWindowKey} onpointerdown={onWindowPointer} />

<div
  bind:this={bar}
  role="group"
  aria-label="Brush"
  data-testid="palette-strip"
  class="sfh-palette-strip absolute left-4 z-30 flex items-center gap-1 rounded-lg border border-line bg-surface p-1 text-sm text-ink shadow-lg [--bt-fg:var(--color-ink)] md:hidden dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark dark:[--bt-fg:var(--color-ink-dark)]"
  style:bottom="calc(var(--fzp-scrubber-h, 0px) + {lift}px + 0.5rem)"
>
  <button
    type="button"
    aria-label="Tool: {current.label}"
    class="{CTL} flex items-center gap-1.5"
    onclick={() => {
      open = null;
      ontool(erasing ? 'paint' : 'erase');
    }}
  >
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {#each current.icon as d (d)}<path {d} />{/each}
    </svg>
    {current.label}
  </button>

  <div class="flex">
    <button
      bind:this={swatch}
      type="button"
      aria-label="Height: {storiesName}"
      aria-expanded={open === 'height'}
      aria-controls={popId}
      aria-describedby={erasing ? hintId : undefined}
      title={erasing ? eraseHint : undefined}
      disabled={erasing}
      class="{CTL} flex items-center justify-center px-1"
      onclick={() => toggle('height')}
    >
      <!-- The same neutral ink tile as the Paint tab's palette and rows. -->
      <span
        aria-hidden="true"
        class="flex size-8 items-center justify-center rounded-md bg-ink text-sm font-medium text-surface dark:bg-ink-dark dark:text-surface-dark"
        >{stories}</span
      >
    </button>
    {#if erasing}
      <span id={hintId} class="sr-only">{eraseHint}</span>
    {/if}
    {#if open === 'height'}
      <div bind:this={popEl} id={popId} class={POP}>
        <HeightPalette {brush} disabled={erasing} hint={eraseHint} onpick={() => (open = null)} />
      </div>
    {/if}
  </div>

  <RadiusPopover
    state={brush}
    open={open === 'radius'}
    ontoggle={() => toggle('radius')}
    onclose={() => (open = null)}
    popClass={POP}
  />

  <button
    type="button"
    class="{CTL} underline"
    onclick={() => {
      open = null;
      ontool('move');
      ondone();
    }}>Done</button
  >
</div>

<style>
  /* The strip is 54 px tall (a 44 px target, 4 px padding, 1 px border) and sits 0.5rem above the
     map inset (the scrubber and the sheet handle, which /sim adds to the inset), so the
     control's container clears it by 0.5rem + 3.5rem. `.sim-map` outranks
     SimMap's own `bottom` rule for the container. */
  :global(.sfh-fzp:has(.sfh-palette-strip) .sim-map .maplibregl-ctrl-bottom-left) {
    bottom: calc(var(--map-bottom-inset, 0px) + 4rem);
  }
</style>
