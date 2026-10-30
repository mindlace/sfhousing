<script lang="ts">
  // Test host: the policy panel inside a `.sfh-fzp` map region, beside a loading project card,
  // as FzpMode lays them out (layout ruling 3: the card sits right of the docked panel).
  import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
  import ProjectCardPanel from '$lib/fzp/ProjectCardPanel.svelte';
  import { chanceTable } from '$lib/timelapse/model';
  import PolicyPanel from '../PolicyPanel.svelte';
  import type { PolicyStore } from '../policy-store.svelte';

  let { store, open, onclose }: { store: PolicyStore; open: boolean; onclose: () => void } =
    $props();

  const cal = fixtureCalibration();
  const chance = chanceTable(cal);
</script>

<div class="sfh-fzp relative" style="height: 600px" data-testid="map">
  <ProjectCardPanel
    state={{ kind: 'loading' }}
    day={cal.asOf}
    asOf={cal.asOf}
    calibration={{ inFlight: cal, fresh: cal }}
    chance={{ inFlight: chance, fresh: chance }}
    onclose={() => {}}
    onsource={() => {}}
  />
  <PolicyPanel {store} {open} {onclose} timingSummary="SF as observed">
    {#snippet timing()}
      <p>Timing body</p>
    {/snippet}
  </PolicyPanel>
</div>
