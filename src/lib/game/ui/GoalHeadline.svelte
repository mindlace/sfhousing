<!--
  The header's pinned goal: line 1 the round's words, a bar (the homes at the playhead's month over
  the amount), line 2 what beating it brings. Interim: the round's result states arrive later.
-->
<script lang="ts">
  import { useGame } from '../store.svelte';
  import type { PinnedWords } from './round-words';

  interface GoalHeadlineProps {
    words: PinnedWords;
    /** 0..1; clamped. */
    fill: number;
  }

  let { words, fill }: GoalHeadlineProps = $props();

  const game = useGame();

  const shown = $derived(Math.max(0, Math.min(1, Number.isFinite(fill) ? fill : 0)));
</script>

{#if !game.open}
  <span class="inline-flex" data-testid="goal-headline">
    <!-- At most 44 px: line 1 17.5, the bar 4, line 2 15 (text-xs sets its own 16 px line
         height, hence leading-tight), two 2 px gaps and the border; no vertical padding. -->
    <div
      data-testid="goal-box"
      class="flex max-w-80 min-w-6 flex-col justify-center gap-0.5 rounded-md border border-gray-300 bg-surface px-2 text-sm leading-tight whitespace-nowrap text-ink tabular-nums dark:border-gray-600 dark:bg-surface-dark dark:text-ink-dark"
    >
      <span data-testid="goal-line1" class="truncate font-semibold">{words.line1}</span>
      <span
        aria-hidden="true"
        data-testid="goal-bar"
        data-fill={Math.floor(shown * 100)}
        class="block h-1 w-full rounded-full bg-line dark:bg-line-dark"
        ><span
          class="block h-full rounded-full bg-accent dark:bg-accent-dark"
          style:width="{shown * 100}%"
        ></span></span
      >
      <span
        data-testid="goal-line2"
        class="truncate text-xs leading-tight font-medium text-ink-muted max-sm:sr-only dark:text-ink-dark-muted"
        >{words.line2}</span
      >
    </div>
  </span>
  <span class="sr-only" aria-live="polite" data-testid="goal-live">{words.live ?? ''}</span>
{/if}
