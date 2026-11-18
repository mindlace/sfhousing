<!--
  One row's lane (rules 2, 6): the window's width, on the timeline's one x scale. What the person
  has not seen yet is shown on the ruler alone; no lane is hatched.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();
</script>

<div class="lane relative" data-testid="tl-lane">
  {@render children?.()}
</div>

<style>
  .lane {
    min-height: 30px;
    border-bottom: 1px solid var(--color-line);
    min-width: 0;
    isolation: isolate;
  }
  @media (prefers-color-scheme: dark) {
    .lane {
      border-bottom-color: var(--color-line-dark);
    }
  }
</style>
