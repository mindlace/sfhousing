<!--
  The brush radius control (spec §4.2), shared by `/`'s BrushToolbar and /sim: inline, the
  labelled slider; otherwise a "{n} m" opener whose pop-over holds the slider. Escape closes the
  pop-over and refocuses the opener; a press outside it closes it.
-->
<script lang="ts">
  import { radiusValueText } from './messages';
  import { posFromRadius, radiusFromPos } from './radius';
  import type { BrushState } from './state.svelte';

  interface Props {
    state: BrushState;
    /** The slider alone, no opener. */
    inline?: boolean;
    open?: boolean;
    ontoggle?(): void;
    onclose?(): void;
    openerClass?: string;
    popClass?: string;
  }

  let {
    state: brush,
    inline = false,
    open = false,
    ontoggle = undefined,
    onclose = undefined,
    openerClass = '',
    popClass = ''
  }: Props = $props();

  const uid = $props.id();
  const popId = `${uid}-radius-pop`;
  const inputId = `${uid}-radius`;
  let opener = $state<HTMLButtonElement>();
  let popEl = $state<HTMLElement>();

  function onWindowKey(e: KeyboardEvent) {
    if (inline || !open || e.key !== 'Escape') return;
    onclose?.();
    opener?.focus();
  }

  function onWindowPointer(e: PointerEvent) {
    if (inline || !open) return;
    const t = e.target as Node | null;
    if (t && (popEl?.contains(t) || opener?.contains(t))) return;
    onclose?.();
  }
</script>

<svelte:window onkeydown={onWindowKey} onpointerdown={onWindowPointer} />

{#snippet slider()}
  <div class="flex w-full items-center gap-2">
    <label for={inputId} class="text-sm whitespace-nowrap">Brush {brush.radiusM} m</label>
    <input
      id={inputId}
      type="range"
      min="0"
      max="99"
      step="1"
      aria-valuetext={radiusValueText(brush.radiusM)}
      value={posFromRadius(brush.radiusM)}
      class="range min-h-11 min-w-11 flex-1"
      oninput={(e) => brush.setRadius(radiusFromPos(Number(e.currentTarget.value)))}
    />
  </div>
{/snippet}

{#if inline}
  {@render slider()}
{:else}
  <button
    bind:this={opener}
    type="button"
    aria-label="Brush {brush.radiusM} m"
    aria-expanded={open}
    aria-controls={popId}
    class="ctl min-h-11 min-w-11 rounded-md px-2 text-sm whitespace-nowrap {openerClass}"
    onclick={() => ontoggle?.()}>{brush.radiusM} m</button
  >
  {#if open}
    <div bind:this={popEl} id={popId} role="group" aria-label="Brush radius" class={popClass}>
      {@render slider()}
    </div>
  {/if}
{/if}

<style>
  .ctl:not(:disabled):hover {
    background: color-mix(in srgb, var(--bt-fg, currentColor) 10%, transparent);
  }
  .range {
    accent-color: var(--brush-paint, rgb(29 78 216));
  }
</style>
