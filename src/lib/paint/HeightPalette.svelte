<!--
  The Paint tab's height control: a swatch per story preset, then the stepper (fewer, a number
  input, more, the height in metres). Disabled as a whole with `hint` as its description (Erase).
  Behaviour of the stories stepper in brush/StoriesPopover.svelte, which stays for `/`. Colours
  are tokens.
-->
<script lang="ts">
  import { MSG } from '$lib/brush/messages';
  import { STORY_PRESETS, heightHintM } from '$lib/brush/radius';
  import type { BrushState } from '$lib/brush/state.svelte';

  interface Props {
    brush: BrushState;
    disabled?: boolean;
    /** Shown, and describing every control, while disabled. */
    hint?: string;
    /** A preset swatch was chosen (not the stepper): the phone strip closes its pop-over. */
    onpick?(stories: number): void;
  }

  let { brush, disabled = false, hint = MSG.eraseHint, onpick = undefined }: Props = $props();

  const uid = $props.id();
  const hintId = `${uid}-hint`;

  function commitStories(el: HTMLInputElement) {
    const v = parseFloat(el.value);
    if (Number.isFinite(v)) brush.setStories(v);
    // Re-sync even when the clamped value equals the old one (80 → "85" → 80).
    el.value = String(brush.stories);
  }

  const BTN =
    'min-h-11 min-w-11 rounded-md border border-control-line bg-surface text-ink enabled:hover:bg-surface-raised disabled:opacity-40 dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark dark:enabled:hover:bg-surface-dark-raised';
</script>

<div
  role="group"
  aria-label="Height"
  aria-describedby={disabled ? hintId : undefined}
  class="flex flex-col gap-2 text-ink dark:text-ink-dark"
>
  <div class="flex flex-wrap gap-1">
    {#each STORY_PRESETS as n (n)}
      <button
        type="button"
        aria-pressed={brush.stories === n}
        aria-label="{n} stories"
        {disabled}
        class="min-h-11 min-w-11 rounded-md border border-control-line text-sm font-medium disabled:opacity-40 dark:border-control-line-dark {brush.stories ===
        n
          ? 'bg-ink text-surface dark:bg-ink-dark dark:text-surface-dark'
          : 'bg-surface-raised text-ink dark:bg-surface-dark-raised dark:text-ink-dark'}"
        onclick={() => {
          brush.setStories(n);
          onpick?.(n);
        }}>{n}</button
      >
    {/each}
  </div>
  <div class="flex items-center gap-1">
    <button
      type="button"
      aria-label="Fewer stories"
      {disabled}
      class="{BTN} text-lg"
      onclick={() => brush.setStories(brush.stories - 1)}>−</button
    >
    <input
      type="number"
      min="1"
      max="80"
      step="1"
      aria-label="Stories"
      {disabled}
      value={brush.stories}
      class="min-h-11 w-16 rounded-md border border-control-line bg-surface text-center text-ink disabled:opacity-40 dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark"
      onblur={(e) => commitStories(e.currentTarget)}
      onkeydown={(e) => {
        if (e.key === 'Enter') commitStories(e.currentTarget);
      }}
    />
    <button
      type="button"
      aria-label="More stories"
      {disabled}
      class="{BTN} text-lg"
      onclick={() => brush.setStories(brush.stories + 1)}>+</button
    >
    <span class="ml-1 text-sm whitespace-nowrap">stories</span>
    <span class="ml-auto text-sm whitespace-nowrap text-ink-muted dark:text-ink-dark-muted"
      >≈ {heightHintM(brush.stories)} m</span
    >
  </div>
  {#if disabled}
    <p id={hintId} class="text-sm text-ink-muted dark:text-ink-dark-muted">{hint}</p>
  {/if}
</div>
