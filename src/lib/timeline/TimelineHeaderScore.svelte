<!--
  The header score of `/sim` on the timeline: "{n} homes by {year}", the average of the simulated
  cities at the last month of the window, with the "vs FZP" delta under it and the 4 px RHNA meter
  along its bottom edge (rule 27). Same markup and test ids as `scoreboard/HeaderScore.svelte`,
  which is hashed and says "added". Its accessible name and the delta's description carry "by
  {year}". It reads "calculating" until the forecast is filled to its end, and while `provisional`
  (a stripped document is open); `stale` dims it. The count is the button (its name); one polite
  sr-only region speaks a new `live` text 1,000 ms after it last changed, only while `quiet` is false.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { CALCULATING, vsFzpText } from '$lib/fzp/score-view';
  import { formatCount } from '$lib/scoreboard/format';
  import type { TargetProgress } from '$lib/scoreboard/types';
  import { fillPercent, meterValueText, trackMax } from '$lib/scoreboard/view';

  interface Props {
    /** The headline count; null until the forecast is filled to its end. */
    total: number | null;
    /** The year of the window's last month. */
    year: number;
    /** The progress bar's target (RHNA); null hides the bar. */
    target: TargetProgress | null;
    /** The delta vs FZP; null hides it. */
    delta: number | null;
    /** True while a stripped document is open: "calculating" whatever the fill state. */
    provisional?: boolean;
    busy: boolean;
    stale: boolean;
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
    year,
    target,
    delta,
    provisional = false,
    busy,
    stale,
    expanded,
    controls,
    onclick,
    live,
    quiet
  }: Props = $props();

  const uid = $props.id();
  const deltaId = `${uid}-delta`;
  const calculating = $derived(total === null || provisional);

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

<!-- The box is the button's target (its ::before covers it), but only the count is inside the
     button: the button is named by the count, the delta describes it, and the meter is read on
     its own. The delta and the meter take no pointer events, so a press on them presses it. -->
<div
  class="relative flex min-h-6 min-w-6 flex-col items-start justify-center overflow-hidden rounded-md border border-gray-300 bg-surface px-2 pb-1 text-sm leading-tight font-semibold whitespace-nowrap text-ink tabular-nums hover:bg-surface-raised has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-offset-2 has-[button:focus-visible]:outline-accent dark:border-gray-600 dark:bg-surface-dark dark:text-ink-dark dark:hover:bg-surface-dark-raised dark:has-[button:focus-visible]:outline-accent-dark pointer-coarse:min-h-11 pointer-coarse:min-w-11"
  data-stale={stale ? 'true' : undefined}
>
  <button
    type="button"
    class="text-left whitespace-nowrap before:absolute before:inset-0 before:content-[''] focus-visible:outline-none"
    aria-expanded={expanded}
    aria-controls={controls || undefined}
    aria-busy={busy}
    aria-describedby={!calculating && delta !== null ? deltaId : undefined}
    data-testid="score-bar"
    {onclick}
  >
    {#if !calculating && total !== null}{formatCount(total)} homes&#32;<span class="max-lg:sr-only"
        >added</span
      >
      by {year}{:else}{CALCULATING}{/if}
  </button>
  {#if !calculating && delta !== null}
    <span
      id={deltaId}
      class="pointer-events-none text-xs font-medium text-ink-muted tabular-nums dark:text-ink-dark-muted"
      data-testid="score-delta">{vsFzpText(delta)}<span class="sr-only"> by {year}</span></span
    >
  {/if}
  {#if !provisional && target}
    <span
      role="meter"
      aria-label={target.target.label}
      aria-valuemin={0}
      aria-valuemax={target.target.units}
      aria-valuenow={Math.round(target.fraction * target.target.units)}
      aria-valuetext={meterValueText(target)}
      class="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-gray-200 dark:bg-surface-dark-raised"
    >
      <span
        class="absolute inset-y-0 left-0 bg-accent dark:bg-accent-dark"
        style:width="{fillPercent(target.fraction, trackMax([target]))}%"
      ></span>
    </span>
  {/if}
</div>

<span class="sr-only" aria-live="polite" data-testid="score-live">{spoken}</span>

<style>
  /* Stale (rule 31): the count turns to the muted ink, which keeps the button at AA contrast. */
  div[data-stale] {
    color: var(--color-ink-muted);
  }
  @media (prefers-color-scheme: dark) {
    div[data-stale] {
      color: var(--color-ink-dark-muted);
    }
  }
</style>
