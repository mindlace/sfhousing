<!--
  /sim's key panel: the homes in each stage group at the playhead's month (`keyTally`), each
  label beside its swatch and count, under "Homes". '…' while the numbers are calculating.
-->
<script lang="ts">
  import KeySwatch from '$lib/map/key/KeySwatch.svelte';
  import { KEY_COPY } from '$lib/map/key/copy';
  import { STAGE_KEY } from '$lib/map/key/rows';
  import { formatCount } from '$lib/scoreboard/format';
  import type { KeyTally } from './key';

  interface Props {
    tally: KeyTally | null;
  }
  let { tally }: Props = $props();

  const id = $props.id();
</script>

<p id="{id}-homes" class="text-xs font-semibold">{KEY_COPY.homes}</p>
<dl aria-labelledby="{id}-homes" class="mt-1 space-y-1">
  {#each STAGE_KEY as row (row.id)}
    <div class="flex items-center gap-2" data-key-row={row.id}>
      <KeySwatch swatch={row.swatch} />
      <dt>{row.label}</dt>
      <dd class="ml-auto tabular-nums">{tally ? formatCount(tally[row.id]) : '…'}</dd>
    </div>
  {/each}
</dl>
