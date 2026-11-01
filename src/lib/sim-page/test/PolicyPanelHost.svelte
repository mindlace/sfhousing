<script lang="ts">
  // Test host: the policy panel inside a `.sfh-fzp` map region, beside a loading project card,
  // as FzpMode lays them out (layout ruling 3: the card sits right of the docked panel).
  import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
  import ProjectCardPanel from '$lib/fzp/ProjectCardPanel.svelte';
  import { chanceTable } from '$lib/timelapse/model';
  import HistoryRow from '../HistoryRow.svelte';
  import { DEFAULT_POLICY } from '../policy';
  import { PolicyStore } from '../policy-store.svelte';
  import PolicyPanel from '../PolicyPanel.svelte';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  const cal = fixtureCalibration();
  const chance = chanceTable(cal);
  const store = new PolicyStore(DEFAULT_POLICY);
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
  <PolicyPanel {open} {onclose} timingSummary="SF as observed">
    {#snippet history()}
      <HistoryRow {store} onundo={() => {}} onredo={() => {}} />
    {/snippet}
    {#snippet rules()}
      <p>Rules body</p>
    {/snippet}
    {#snippet custom()}
      <p>Custom body</p>
    {/snippet}
    {#snippet timing()}
      <p>Timing body</p>
    {/snippet}
    {#snippet protections()}
      <p>Protections body</p>
    {/snippet}
  </PolicyPanel>
</div>
