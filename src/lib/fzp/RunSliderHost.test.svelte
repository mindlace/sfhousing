<script lang="ts">
  import RunSlider from './RunSlider.svelte';

  let {
    ranks,
    start,
    record
  }: { ranks: readonly number[]; start: number; record: (p: number) => void } = $props();

  let position = $state<number | null>(null);
  $effect.pre(() => {
    if (position === null) position = start;
  });
</script>

<RunSlider
  {ranks}
  {position}
  shownSeed={position === null ? null : ranks[position]}
  disabled={false}
  onselect={(p) => {
    position = p;
    record(p);
  }}
/>
