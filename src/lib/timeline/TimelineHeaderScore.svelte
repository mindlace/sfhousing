<!--
  The header score of `/sim` on the timeline: the headline at the playhead's month. Line 1 is the
  button ("47,335 homes by Apr 2040", its name); line 2 ("+1,817 from your policy · 68% of the
  goal") describes it. Hovering or focusing the box names the goal. `text` null reads
  "calculating"; `stale` dims it. Below sm only line 1 shows; from lg to xl the goal part drops
  while the effect shows. One polite sr-only region speaks a new `live` text 1,000 ms after it
  last changed, only while `quiet` is false.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { CALCULATING } from '$lib/fzp/score-view';
  import Explain from './Explain.svelte';
  import type { HeadlineText } from './results';

  interface Props {
    /** null: "calculating…" (CALCULATING). */
    text: HeadlineText | null;
    busy: boolean;
    stale: boolean;
    /** The sheet shows (below md); undefined (from md, where the column always shows): no
     *  `aria-expanded`. */
    expanded?: boolean;
    /** The detail column's or sheet's id. */
    controls: string;
    onclick(): void;
    /** The polite region's text; spoken 1,000 ms after it settles while `quiet` is false. */
    live: string;
    quiet: boolean;
  }
  let { text, busy, stale, expanded = undefined, controls, onclick, live, quiet }: Props = $props();

  const uid = $props.id();
  const detailId = `${uid}-detail`;
  const effectText = $derived(text?.effect ?? null);
  const goalText = $derived(text?.goal ?? null);
  const goalName = $derived(text?.goalName ?? null);
  /** The goal part drops from lg to xl while the effect shows. */
  const goalClass = $derived(effectText !== null ? 'lg:max-xl:hidden' : '');
  const SEP = ' · ';
  /** Line 2 in full: the button's description at every width. */
  const detail = $derived([effectText, goalText].filter((s) => s !== null).join(SEP));

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

{#snippet box()}
  <!-- The box is the button's target (its ::before covers it), but only line 1 is inside the
       button: the button is named by it and line 2 describes it. Line 2 takes no pointer events,
       so a press on it presses the button. -->
  <div
    class="relative flex min-h-6 min-w-6 flex-col items-start justify-center overflow-hidden rounded-md border border-gray-300 bg-surface px-2 text-sm leading-tight font-semibold whitespace-nowrap text-ink tabular-nums hover:bg-surface-raised has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-offset-2 has-[button:focus-visible]:outline-accent dark:border-gray-600 dark:bg-surface-dark dark:text-ink-dark dark:hover:bg-surface-dark-raised dark:has-[button:focus-visible]:outline-accent-dark"
    data-stale={stale ? 'true' : undefined}
    data-testid="score-box"
  >
    <button
      type="button"
      class="text-left whitespace-nowrap before:absolute before:inset-0 before:content-[''] focus-visible:outline-none"
      aria-expanded={expanded}
      aria-controls={controls || undefined}
      aria-busy={busy}
      aria-describedby={detail !== '' ? detailId : undefined}
      data-testid="score-bar"
      {onclick}
    >
      {text ? text.main : CALCULATING}
    </button>
    {#if detail !== ''}
      <!-- Line 2 as shown, parts dropped at narrow widths; the sr-only copy is the description,
           so the dropped parts stay in it. -->
      <span
        class="pointer-events-none text-xs font-medium text-ink-muted tabular-nums max-sm:hidden dark:text-ink-dark-muted"
        aria-hidden="true"
        data-testid="score-detail"
        >{#if effectText !== null}<span data-testid="score-delta">{effectText}</span
          >{/if}{#if effectText !== null && goalText !== null}<span class={goalClass}>{SEP}</span
          >{/if}{#if goalText !== null}<span class={goalClass} data-testid="score-goal"
            >{goalText}</span
          >{/if}</span
      >
      <span id={detailId} class="sr-only">{detail}</span>
    {/if}
  </div>
{/snippet}

<!-- Always wrapped, so the button is never re-created (and focus never lost) as the goal comes
     and goes; with no goal on show the name stays hidden. -->
<span
  class="hs-score explain-under relative inline-flex"
  data-no-goal={goalText === null || goalName === null ? 'true' : undefined}
>
  <Explain as="wrap" text={goalName ?? ''}>{@render box()}</Explain>
</span>

<span class="sr-only" aria-live="polite" data-testid="score-live">{spoken}</span>

<style>
  /* Stale (rule 31): the text turns to the muted ink, which keeps the button at AA contrast. */
  div[data-stale] {
    color: var(--color-ink-muted);
  }
  @media (prefers-color-scheme: dark) {
    div[data-stale] {
      color: var(--color-ink-dark-muted);
    }
  }
  /* The goal's name opens under the box at every width (`explain-under`, layout.css), so the
     header neither widens nor grows; below sm it is hidden with line 2. */
  .hs-score :global([role='tooltip']) {
    margin-left: 0;
    font-size: 0.875rem;
    font-weight: 400;
  }
  .hs-score[data-no-goal] :global([role='tooltip']) {
    display: none;
  }
  @media (width < 40rem) {
    .hs-score :global([role='tooltip']) {
      display: none;
    }
  }
</style>
