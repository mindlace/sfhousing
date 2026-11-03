<!--
  Test host for TransitLayerRow: one row in a list, owning its rule the way a page does (each
  `onedit` replaces it), and recording the callbacks.
-->
<script lang="ts">
  import type { BrushCatalog } from '$lib/sim/levers/brushes';
  import type { LotStatus } from '$lib/paint/rows';
  import type { ZoningRule } from '../policy';
  import TransitLayerRow from '../TransitLayerRow.svelte';

  interface Props {
    rule: ZoningRule;
    status?: LotStatus;
    catalog?: BrushCatalog | null;
    selected?: boolean;
    onselect?: () => void;
    onedit?: (next: ZoningRule, coalesce?: string) => void;
    onremove?: () => void;
    onretry?: (keys: string[]) => void;
  }

  let {
    rule: initial,
    status = { kind: 'found', lots: 1204 },
    catalog = undefined,
    selected = false,
    onselect = () => {},
    onedit = undefined,
    onremove = () => {},
    onretry = () => {}
  }: Props = $props();

  // The prop only seeds the host's own rule, as a page's store would.
  // svelte-ignore state_referenced_locally
  let rule = $state.raw<ZoningRule>(initial);
</script>

<ol aria-label="Transit layers">
  <TransitLayerRow
    {rule}
    {status}
    {catalog}
    {selected}
    {onselect}
    onedit={(next, coalesce) => {
      onedit?.(next, coalesce);
      rule = next;
    }}
    {onremove}
    {onretry}
  />
</ol>
