<script lang="ts">
  // Test host: the dock inside a `.sfh-dock-host` map region with a stand-in MapLibre
  // bottom-left control container, three tabs and a Results body, as /sim lays it out.
  import Dock, { type DockTab } from '../Dock.svelte';
  import type { DockState } from '../dock-state.svelte';
  import { DOCK_ICONS } from '../icons';

  let {
    state,
    onflip = () => {},
    onclose = undefined,
    onsheetheight = undefined,
    resultsOnly = false,
    focusOnOpen = true
  }: {
    state: DockState;
    onflip?: () => void;
    onclose?: () => void;
    onsheetheight?: (px: number) => void;
    resultsOnly?: boolean;
    focusOnOpen?: boolean;
  } = $props();

  const tabs: DockTab[] = [
    { id: 'transit', label: 'Transit', icon: DOCK_ICONS.transit },
    { id: 'paint', label: 'Zoning', icon: DOCK_ICONS.paint },
    { id: 'permits', label: 'Permits', icon: DOCK_ICONS.permits }
  ];
</script>

<div class="sfh-dock-host relative" style="height: 600px" data-testid="map">
  <div class="maplibregl-ctrl-bottom-left absolute bottom-0 left-0" data-testid="ctrl">Zoom</div>
  <Dock
    id="host-dock"
    label="Policy"
    {state}
    {tabs}
    flipLabel="Edit policy"
    {onflip}
    {onclose}
    {onsheetheight}
    {resultsOnly}
    {focusOnOpen}
  >
    {#snippet top()}
      <button type="button">Undo</button>
    {/snippet}
    {#snippet panel(tab)}
      <p>{tab} body</p>
      <button type="button">{tab} control</button>
      <div aria-hidden="true" style="height: 800px"></div>
    {/snippet}
    {#snippet results()}
      <p>Results body</p>
      <button type="button">Results control</button>
      <div aria-hidden="true" style="height: 800px"></div>
    {/snippet}
  </Dock>
</div>
