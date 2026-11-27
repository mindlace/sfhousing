<!--
  The header's pinned goal: the round's result state (P19), pending, win or late. From sm line 1
  the round's words, a bar (the homes at the playhead's month over the amount), line 2 what
  beating it brings or by how much it was early or late. Below sm one line from `words.phone`,
  from the bar's left up to the Menu, the bar under it: "homes" hides first as the box narrows,
  then the short count replaces the full one; the rest is always shown. A win carries the gift
  (with `ongift`), a 24 px button that jiggles (still under reduced motion), and an accent border
  on top of its words. Win and late arriving after mount are announced in `goal-live`. With
  `panel` the lines are a button that opens it under the goal; without, plain text.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { useGame } from '../store.svelte';
  import { JIGGLE_MS } from './motion';
  import type { PinnedWords } from './round-words';

  interface GoalHeadlineProps {
    state: 'pending' | 'win' | 'late';
    words: PinnedWords;
    /** 0..1: homes at the playhead's month over the amount; clamped. */
    fill: number;
    ongift?: () => void;
    panel?: Snippet;
  }

  // `state` is the prop's name; `$state` is the rune, so it is read as `result`.
  let { state: result, words, fill, ongift, panel }: GoalHeadlineProps = $props();

  const game = useGame();
  const uid = $props.id();
  const panelId = `${uid}-panel`;
  let open = $state(false);

  const shown = $derived(Math.max(0, Math.min(1, Number.isFinite(fill) ? fill : 0)));
  const gift = $derived(result === 'win' && ongift && words.gift ? words.gift : null);

  /** What the live region says: nothing for the state at mount, then each win or late arriving. */
  let live = $state('');
  let last: string | null = null;
  $effect(() => {
    const s = result;
    const said = words.live;
    untrack(() => {
      if (last === null || s === last) {
        last = s;
        return;
      }
      last = s;
      live = s === 'pending' ? '' : (said ?? '');
    });
  });
</script>

{#snippet lines()}
  <span data-testid="goal-line1" class="truncate font-semibold max-sm:hidden">{words.line1}</span>
  <span
    data-testid="goal-phone"
    class="goal-phone block text-xs leading-tight font-semibold sm:hidden"
    ><span class="goal-count">{words.phone.count}</span><span class="goal-short"
      >{words.phone.short}</span
    ><span class="goal-homes">{words.phone.homes}</span>
    <span class="goal-rest">{words.phone.rest}</span></span
  >
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
    class="truncate text-xs leading-tight font-medium text-ink-muted max-sm:hidden dark:text-ink-dark-muted"
    >{words.line2}</span
  >
{/snippet}

{#if !game.open}
  <span class="inline-flex min-w-0 max-sm:flex-1" data-testid="goal-headline" data-state={result}>
    <!-- At most 44 px: line 1 17.5, the bar 4, line 2 15 (text-xs sets its own 16 px line
         height, hence leading-tight), two 2 px gaps and the border; no vertical padding. -->
    <span
      data-testid="goal-box"
      class={[
        'flex max-w-80 min-w-6 items-center gap-1 rounded-md border bg-surface px-2 text-sm leading-tight whitespace-nowrap text-ink tabular-nums max-sm:max-w-none max-sm:flex-1 max-sm:px-1.5 dark:bg-surface-dark dark:text-ink-dark',
        result === 'win'
          ? 'border-accent dark:border-accent-dark'
          : 'border-gray-300 dark:border-gray-600'
      ]}
    >
      {#if panel}
        <button
          type="button"
          data-testid="goal-headline-button"
          class="flex min-w-0 flex-1 flex-col justify-center gap-0.5 self-stretch text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-accent-dark"
          aria-expanded={open}
          aria-controls={panelId}
          onclick={() => (open = !open)}>{@render lines()}</button
        >
      {:else}
        <span
          data-testid="goal-headline-button"
          class="flex min-w-0 flex-1 flex-col justify-center gap-0.5">{@render lines()}</span
        >
      {/if}
      {#if gift}
        <button
          type="button"
          data-testid="goal-gift"
          class="goal-gift inline-flex size-6 shrink-0 items-center justify-center rounded-md text-accent hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent dark:text-accent-dark dark:hover:bg-chrome-dark-raised dark:focus-visible:outline-accent-dark"
          aria-label={gift}
          title={gift}
          style:animation-duration="{JIGGLE_MS}ms"
          onclick={() => ongift?.()}
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none">
            <path
              d="M2.5 6.5h11v2.5h-11zM3.5 9v5h9V9M8 6.5V14M8 6.5C6.5 6.5 4.5 5.5 5 4s2.5-.5 3 2.5c.5-3 2.5-4 3-2.5s-1.5 2.5-3 2.5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      {/if}
    </span>
    {#if panel}
      <div
        id={panelId}
        class={open
          ? 'absolute top-full z-40 mt-1 max-w-sm rounded-lg border bg-surface p-3 shadow-lg dark:border-gray-700 dark:bg-chrome-dark'
          : 'hidden'}
      >
        {@render panel()}
      </div>
    {/if}
  </span>
  <span class="sr-only" aria-live="polite" data-testid="goal-live">{live}</span>
{/if}

<style>
  /* The phone line measures its own width: "homes" goes first, then the full count. */
  .goal-phone {
    container-type: inline-size;
    overflow: hidden;
  }
  .goal-short {
    display: none;
  }
  @container (max-width: 17rem) {
    .goal-homes {
      display: none;
    }
  }
  @container (max-width: 13rem) {
    .goal-count {
      display: none;
    }
    .goal-short {
      display: inline;
    }
  }
  /* A turn of 600 ms (JIGGLE_TURN_MS: 15% of the 4 s JIGGLE_MS period), then still. */
  .goal-gift {
    animation-name: goal-jiggle;
    animation-iteration-count: infinite;
    animation-timing-function: ease-in-out;
  }
  @keyframes goal-jiggle {
    0%,
    15%,
    100% {
      transform: rotate(0);
    }
    3.75% {
      transform: rotate(-14deg);
    }
    7.5% {
      transform: rotate(12deg);
    }
    11.25% {
      transform: rotate(-6deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .goal-gift {
      animation: none;
    }
  }
</style>
