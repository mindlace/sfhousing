<!--
  The stories control (spec §4.2), shared by `/`'s BrushToolbar and /sim: inline, the stepper
  (fewer, a number input, more, the height hint and the presets); otherwise a "{n} st" opener
  whose pop-over holds the stepper. Escape closes the pop-over and refocuses the opener; a press
  outside it closes it. Colours come from the host's `--bt-*` variables, with fallbacks.
-->
<script lang="ts">
  import { MSG } from './messages';
  import { STORY_PRESETS, heightHintM } from './radius';
  import type { BrushState } from './state.svelte';

  interface Props {
    state: BrushState;
    /** The stepper alone, no opener. */
    inline?: boolean;
    /** Erase: the stepper is disabled, with the erase hint. */
    disabled?: boolean;
    open?: boolean;
    ontoggle?(): void;
    onclose?(): void;
    openerClass?: string;
    popClass?: string;
  }

  let {
    state: brush,
    inline = false,
    disabled = false,
    open = false,
    ontoggle = undefined,
    onclose = undefined,
    openerClass = '',
    popClass = ''
  }: Props = $props();

  const uid = $props.id();
  const popId = `${uid}-stories`;
  const hintId = `${uid}-hint`;
  let opener = $state<HTMLButtonElement>();
  let popEl = $state<HTMLElement>();

  function commitStories(el: HTMLInputElement) {
    const v = parseFloat(el.value);
    if (Number.isFinite(v)) brush.setStories(v);
    // Re-sync even when the clamped value equals the old one (80 → "85" → 80).
    el.value = String(brush.stories);
  }

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

{#snippet stepper()}
  <fieldset {disabled} aria-describedby={disabled ? hintId : undefined} class="flex flex-col gap-1">
    <legend class="sr-only">Stories</legend>
    <div class="flex items-center gap-1">
      <button
        type="button"
        aria-label="Fewer stories"
        class="ctl min-h-11 min-w-11 rounded-md text-lg disabled:opacity-40"
        onclick={() => brush.setStories(brush.stories - 1)}>−</button
      >
      <input
        type="number"
        min="1"
        max="80"
        step="1"
        aria-label="Stories"
        aria-describedby={disabled ? hintId : undefined}
        value={brush.stories}
        class="field min-h-11 w-16 rounded-md text-center disabled:opacity-40"
        onblur={(e) => commitStories(e.currentTarget)}
        onkeydown={(e) => {
          if (e.key === 'Enter') commitStories(e.currentTarget);
        }}
      />
      <button
        type="button"
        aria-label="More stories"
        class="ctl min-h-11 min-w-11 rounded-md text-lg disabled:opacity-40"
        onclick={() => brush.setStories(brush.stories + 1)}>+</button
      >
      <span class="ml-1 text-sm whitespace-nowrap">stories</span>
      <span class="ml-auto text-sm whitespace-nowrap">≈ {heightHintM(brush.stories)} m</span>
    </div>
    <div class="flex flex-wrap gap-1">
      {#each STORY_PRESETS as n (n)}
        <button
          type="button"
          aria-pressed={brush.stories === n}
          aria-label="{n} stories"
          class="chip min-h-11 min-w-11 rounded-md text-sm disabled:opacity-40"
          onclick={() => brush.setStories(n)}>{n}</button
        >
      {/each}
    </div>
  </fieldset>
  {#if disabled}
    <p id={hintId} class="mt-1 text-sm">{MSG.eraseHint}</p>
  {/if}
{/snippet}

{#if inline}
  {@render stepper()}
{:else}
  <button
    bind:this={opener}
    type="button"
    aria-label="{brush.stories} stories per stroke"
    aria-expanded={open}
    aria-controls={popId}
    class="ctl min-h-11 min-w-11 rounded-md px-2 text-sm whitespace-nowrap {openerClass}"
    onclick={() => ontoggle?.()}>{brush.stories} st</button
  >
  {#if open}
    <div bind:this={popEl} id={popId} role="group" aria-label="Stories" class={popClass}>
      {@render stepper()}
    </div>
  {/if}
{/if}

<style>
  .ctl:not(:disabled):hover,
  .chip:not(:disabled):hover {
    background: color-mix(in srgb, var(--bt-fg, currentColor) 10%, transparent);
  }
  .field {
    background: transparent;
    border: 1px solid var(--bt-fg, currentColor);
  }
  .chip {
    border: 1px solid var(--bt-line, rgb(156 163 175));
  }
  .chip[aria-pressed='true'] {
    background: var(--bt-fg, rgb(0 0 0));
    color: var(--bt-bg, rgb(255 255 255));
    border-color: var(--bt-fg, rgb(0 0 0));
  }
</style>
