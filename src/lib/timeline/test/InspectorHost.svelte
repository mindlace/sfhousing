<!--
  Test host for the Inspector (Inspector.svelte.spec.ts): owns the store, the funding drafts, the
  sync, the selection and the "+" state the way the page does, and draws one stand-in bar per span
  (and per fixed row) and one "Add" button per kind. Closing the editor focuses the selected bar,
  as the page does. Every announcement is recorded in order for the test to read.
-->
<script lang="ts">
  import type { Allowed } from '$lib/game/allowed';
  import type { BrushCatalog } from '$lib/sim/levers/brushes';
  import { FundingDrafts } from '$lib/sim-page/funding-drafts.svelte';
  import { PolicyStore } from '$lib/sim-page/policy-store.svelte';
  import type { Calibration, Day } from '$lib/timelapse/types';
  import Inspector from '../Inspector.svelte';
  import type { PolicyKind, SimPolicy4 } from '../policy4';
  import { PolicySync } from '../policy-sync.svelte';
  import { fixedRef } from '../rows';
  import type { SpanRef } from '../spans';

  interface Props {
    doc: SimPolicy4;
    calibration: Calibration;
    playheadDay: Day;
    readonly?: boolean;
    initial?: SpanRef | null;
    catalog?: BrushCatalog | null;
    onready?: (h: { store: PolicyStore<SimPolicy4>; drafts: FundingDrafts }) => void;
    /** What the level allows; the Inspector's default when absent. */
    allowed?: Allowed;
  }

  let {
    doc,
    calibration,
    playheadDay,
    readonly = false,
    initial = null,
    catalog = null,
    onready = undefined,
    allowed = undefined
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  const store = new PolicyStore<SimPolicy4>(doc);
  const drafts = new FundingDrafts();
  // The lots never resolve: the editors show "finding".
  const sync = new PolicySync({
    resolve: () => new Promise(() => {}),
    setTimeout: window.setTimeout.bind(window) as typeof setTimeout,
    clearTimeout: window.clearTimeout.bind(window) as typeof clearTimeout
  });
  // svelte-ignore state_referenced_locally
  onready?.({ store, drafts });

  // svelte-ignore state_referenced_locally
  let selected = $state<SpanRef | null>(initial);
  let adding = $state<PolicyKind | null>(null);
  let announced = $state<string[]>([]);

  const KINDS: PolicyKind[] = ['zoning', 'permitting', 'money'];
  const key = (r: SpanRef) => `${r.kind}/${r.id}/${r.span}`;

  function close(): void {
    if (selected === null) return;
    document.querySelector<HTMLElement>(`[data-ref="${key(selected)}"]`)?.focus();
  }
</script>

<div data-testid="bars">
  {#each KINDS as kind (kind)}
    <button type="button" data-ref={key(fixedRef(kind))} onclick={() => (selected = fixedRef(kind))}
      >Fixed {kind}</button
    >
    <button type="button" onclick={() => (adding = kind)}>Add {kind}</button>
    {#each store.policy.kinds[kind] as p (p.id)}
      {#each p.spans as _, i (i)}
        {@const r = { kind, id: p.id, span: i }}
        <button type="button" data-ref={key(r)} onclick={() => (selected = r)}
          >Bar {p.id} {i}</button
        >
      {/each}
    {/each}
  {/each}
</div>

<output data-testid="selected">{selected === null ? '' : key(selected)}</output>

<Inspector
  {store}
  {sync}
  {calibration}
  {catalog}
  {drafts}
  {selected}
  onselect={(r) => (selected = r)}
  {playheadDay}
  asOf={calibration.asOf}
  {readonly}
  {allowed}
  announce={(m) => (announced = [...announced, m])}
  onclose={close}
  bind:adding
>
  {#snippet paint()}
    <div data-testid="paint-part">paint</div>
  {/snippet}
</Inspector>

<ol data-testid="announced" hidden>
  {#each announced as m, i (i)}
    <li>{m}</li>
  {/each}
</ol>
