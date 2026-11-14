<!--
  Test host for FundingTab: builds a PolicyStore from the given policy (a load, so the history
  starts empty) and owns the FundingDrafts the way SimPage does. Hands both to the test through
  `onready`, and records every announcement in order for the test to read.
-->
<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import type { Calibration, Day } from '$lib/timelapse/types';
  import { FundingDrafts } from '../funding-drafts.svelte';
  import FundingTab from '../FundingTab.svelte';
  import type { SimPolicy } from '../policy';
  import { PolicyStore } from '../policy-store.svelte';

  interface Props {
    policy: SimPolicy;
    calibration: Calibration;
    onready?: (store: PolicyStore<SimPolicy>, drafts: FundingDrafts) => void;
    only?: ComponentProps<typeof FundingTab>['only'];
    termsReadOnly?: boolean;
    priceDay?: Day;
  }

  let {
    policy,
    calibration,
    onready = undefined,
    only = undefined,
    termsReadOnly = undefined,
    priceDay = undefined
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  const store = new PolicyStore(policy);
  const drafts = new FundingDrafts();
  // svelte-ignore state_referenced_locally
  onready?.(store, drafts);

  let announced = $state<string[]>([]);
</script>

<FundingTab
  {store}
  {calibration}
  {drafts}
  {only}
  {termsReadOnly}
  {priceDay}
  announce={(m) => (announced = [...announced, m])}
/>

<ol data-testid="announced" hidden>
  {#each announced as m, i (i)}
    <li>{m}</li>
  {/each}
</ol>
