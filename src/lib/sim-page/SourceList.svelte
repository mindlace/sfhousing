<!--
  A list of provenances: each item reads "<label> (tier N)" followed by its sources as links.
  Shared by the stage details (RouteTimeline) and the "Sources and tiers" footer
  (PermittingSection), so a number's tier and source read the same everywhere.
-->
<script lang="ts">
  import type { Provenance } from '$lib/timelapse/types';

  interface Props {
    items: readonly Provenance[];
  }
  let { items }: Props = $props();
</script>

<ul class="ml-4 list-disc break-words">
  {#each items as pv, k (k)}
    <li>
      <span>{pv.label} (tier {pv.tier})</span>{#each pv.sources as s, j (j)}; <a
          class="underline"
          href={s.url}>{s.label}</a
        >{/each}
    </li>
  {/each}
</ul>
