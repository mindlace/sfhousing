<script lang="ts">
  import { formatCount } from './format';
  import { NEIGHBORHOOD_TOP, type NeighborhoodRow } from './view';

  interface Props {
    rows: NeighborhoodRow[];
  }
  let { rows }: Props = $props();
  let showAll = $state(false);
  const visible = $derived(showAll ? rows : rows.slice(0, NEIGHBORHOOD_TOP));
  const largest = $derived(Math.max(0, ...rows.map((r) => r.net)));
</script>

<ul class="mt-2 space-y-1">
  {#each visible as r (r.name)}
    <li data-testid="hood-row" class="text-sm">
      <div class="flex justify-between gap-2">
        <span class="truncate">{r.name}</span>
        <span class="tabular-nums">{formatCount(r.net)}</span>
      </div>
      <div class="h-1.5 rounded-sm bg-gray-100" aria-hidden="true">
        <div
          class="h-full rounded-sm bg-blue-600"
          style:width="{largest > 0 ? (Math.max(0, r.net) / largest) * 100 : 0}%"
        ></div>
      </div>
    </li>
  {/each}
</ul>
{#if !showAll && rows.length > NEIGHBORHOOD_TOP}
  <button
    type="button"
    class="mt-2 min-h-11 text-sm font-semibold underline"
    onclick={() => (showAll = true)}>Show all {rows.length}</button
  >
{/if}
