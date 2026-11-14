<!--
  One row's lane (rules 2, 3, 6): the window's width, with the part past the filled mark hatched.
  `filledPct` is the filled mark's place across the window; the hatch is drawn over the content and
  never takes the pointer.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    filledPct: number;
    children?: Snippet;
  }

  let { filledPct, children }: Props = $props();
</script>

<div class="lane relative" data-testid="tl-lane">
  {@render children?.()}
  {#if filledPct < 99.95}
    <div
      class="hatch absolute"
      data-testid="tl-hatch"
      aria-hidden="true"
      style:left="{filledPct}%"
    ></div>
  {/if}
</div>

<style>
  .lane {
    min-height: 30px;
    border-bottom: 1px solid var(--color-line);
    min-width: 0;
    isolation: isolate;
  }
  .hatch {
    top: 0;
    right: 0;
    bottom: 0;
    z-index: -1;
    pointer-events: none;
    background-color: color-mix(in srgb, var(--color-surface) 55%, transparent);
    background-image: repeating-linear-gradient(
      135deg,
      transparent 0 4px,
      color-mix(in srgb, var(--color-ink-muted) 35%, transparent) 4px 5px
    );
  }
  @media (prefers-color-scheme: dark) {
    .lane {
      border-bottom-color: var(--color-line-dark);
    }
    .hatch {
      background-color: color-mix(in srgb, var(--color-surface-dark) 55%, transparent);
      background-image: repeating-linear-gradient(
        135deg,
        transparent 0 4px,
        color-mix(in srgb, var(--color-ink-dark-muted) 35%, transparent) 4px 5px
      );
    }
  }
</style>
