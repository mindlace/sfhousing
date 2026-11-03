<!--
  The /sim header score, one button: the headline count ("{n} homes added" at the scrubbed day),
  a "vs FZP" delta under it when the page passes one (a run that compares your policy with the
  Family Zoning Plan; stacked, so it adds height and not width to the header row), and a 4 px
  RHNA progress bar along its bottom edge. Pressing it shows or hides the
  dock's Results face (`expanded` and `controls` are the dock's state and id). Below lg the word
  "added" is visually hidden ("{n} homes"; the name keeps it), so the header row fits the save
  state at 375 px and 768 px. The button text is not a live region; one polite sr-only region
  speaks a new `live` text 1,000 ms after it last changed, and only while `quiet` is false.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { vsFzpText } from '$lib/fzp/score-view';
  import { formatCount } from './format';
  import type { TargetProgress } from './types';
  import { fillPercent, meterValueText, trackMax } from './view';

  interface Props {
    /** The headline count; null before the first score (shows `pending`). */
    total: number | null;
    pending?: string;
    /** The progress bar's target (RHNA); null hides the bar. */
    target: TargetProgress | null;
    /** The delta vs FZP; null or absent hides it. */
    delta?: number | null;
    busy?: boolean;
    /** The dock shows Results. */
    expanded: boolean;
    /** The dock's id. */
    controls: string;
    onclick(): void;
    /** The polite region's text; spoken 1,000 ms after it settles while `quiet` is false. */
    live: string;
    quiet: boolean;
  }
  let {
    total,
    pending = 'Simulating…',
    target,
    delta = null,
    busy = false,
    expanded,
    controls,
    onclick,
    live,
    quiet
  }: Props = $props();

  // The text present at mount is never spoken; a new one is, once it has held for a second.
  let spoken = $state('');
  let lastSpoken = untrack(() => live);
  $effect(() => {
    const msg = live;
    if (quiet || msg === '' || msg === lastSpoken) return;
    const t = setTimeout(() => {
      lastSpoken = msg;
      spoken = msg;
    }, 1000);
    return () => clearTimeout(t);
  });
</script>

<button
  type="button"
  class="relative flex min-h-6 min-w-6 flex-col items-start justify-center overflow-hidden rounded-md border border-gray-300 bg-surface px-2 pb-1 text-sm leading-tight font-semibold whitespace-nowrap text-ink tabular-nums hover:bg-surface-raised dark:border-gray-600 dark:bg-surface-dark dark:text-ink-dark dark:hover:bg-surface-dark-raised pointer-coarse:min-h-11 pointer-coarse:min-w-11"
  aria-expanded={expanded}
  aria-controls={controls || undefined}
  aria-busy={busy}
  data-testid="score-bar"
  {onclick}
>
  <span
    >{#if total !== null}{formatCount(total)} homes&#32;<span class="max-lg:sr-only">added</span
      >{:else}{pending}{/if}</span
  >
  {#if delta !== null}
    <span
      class="text-xs font-medium text-ink-muted tabular-nums dark:text-ink-dark-muted"
      data-testid="score-delta">{vsFzpText(delta)}</span
    >
  {/if}
  {#if target}
    <span
      role="meter"
      aria-label={target.target.label}
      aria-valuemin={0}
      aria-valuemax={target.target.units}
      aria-valuenow={Math.round(target.fraction * target.target.units)}
      aria-valuetext={meterValueText(target)}
      class="absolute inset-x-0 bottom-0 h-1 bg-gray-200 dark:bg-surface-dark-raised"
    >
      <span
        class="absolute inset-y-0 left-0 bg-accent dark:bg-accent-dark"
        style:width="{fillPercent(target.fraction, trackMax([target]))}%"
      ></span>
    </span>
  {/if}
</button>

<span class="sr-only" aria-live="polite" data-testid="score-live">{spoken}</span>
