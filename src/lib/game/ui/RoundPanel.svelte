<!--
  The round panel (docs/dev/game.md): information only, with nothing to operate. The round, the
  policies it offers with their rules as set, and what earlier rounds achieved. Rendered in
  GoalHeadline's pop-over; it holds no button, link or other focusable part.
-->
<script lang="ts">
  import type { RoundPanelData } from '../round-panel';

  interface RoundPanelProps {
    data: RoundPanelData;
  }

  let { data }: RoundPanelProps = $props();
</script>

<div data-testid="round-panel" class="space-y-2 text-sm">
  <h2 class="font-semibold">{data.title}</h2>
  {#if data.items.length > 0}
    <ul class="list-disc space-y-0.5 pl-4">
      {#each data.items as item (item)}
        <li>{item}</li>
      {/each}
    </ul>
  {/if}
  {#if data.earlier.length > 0}
    <h3 class="font-semibold">Earlier</h3>
    <ul class="list-disc space-y-0.5 pl-4">
      {#each data.earlier as line (line)}
        <li>{line}</li>
      {/each}
    </ul>
  {/if}
</div>
