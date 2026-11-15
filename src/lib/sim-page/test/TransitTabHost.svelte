<!--
  Test host for TransitTab: owns the dock selection the way SimPage does (a selection whose rule
  has left the policy is dropped), and shows it for the test to read.
-->
<script lang="ts">
  import type { BrushCatalog } from '$lib/sim/levers/brushes';
  import type { PolicySync } from '$lib/timeline/policy-sync.svelte';
  import type { SimPolicy } from '../policy';
  import type { PolicyStore } from '../policy-store.svelte';
  import { liveSelection, type DockSelection } from '../selection';
  import TransitTab from '../TransitTab.svelte';

  interface Props {
    store: PolicyStore<SimPolicy>;
    sync: Pick<PolicySync, 'result' | 'retry'>;
    catalog?: BrushCatalog | null;
    selection?: DockSelection;
    announce?: (msg: string) => void;
  }

  let {
    store,
    sync,
    catalog = undefined,
    selection: initial = null,
    announce = undefined
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  let picked = $state.raw<DockSelection>(initial);
  const selection = $derived(liveSelection(picked, store.policy));
</script>

<TransitTab {store} {sync} {catalog} {selection} onselect={(s) => (picked = s)} {announce} />

<span data-testid="selection" hidden>{JSON.stringify(selection)}</span>
