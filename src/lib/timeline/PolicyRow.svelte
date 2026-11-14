<!--
  An open kind's full row for one policy (rule 6): its label and one SpanBar per span. A policy
  that is off is dimmed in place. Renders a label cell and a lane for the Timeline's grid.
-->
<script lang="ts">
  import type { Day } from '$lib/timelapse/time';
  import Lane from './Lane.svelte';
  import type { Policy, PolicyKind, SimPolicy4 } from './policy4';
  import SpanBar from './SpanBar.svelte';
  import type { SpanRef } from './spans';

  interface Props {
    kind: PolicyKind;
    policy: Policy;
    asOf: Day;
    windowEnd: Day;
    months: number;
    filledPct: number;
    playheadMonth: number;
    selected: SpanRef | null;
    readonly: boolean;
    onselect: (ref: SpanRef) => void;
    onedit: (change: (p: SimPolicy4) => SimPolicy4, label: string) => void;
  }

  let {
    kind,
    policy,
    asOf,
    windowEnd,
    months,
    filledPct,
    playheadMonth,
    selected,
    readonly,
    onselect,
    onedit
  }: Props = $props();
</script>

<div class="contents" data-testid="tl-policy" data-off={!policy.on}>
  <div class="lab" class:off={!policy.on}>
    <span class="name" title={policy.label}>{policy.label}</span>
    {#if !policy.on}<span class="sr-only">, off</span>{/if}
  </div>
  <Lane {filledPct}>
    {#each policy.spans as span, i (i)}
      <SpanBar
        {kind}
        policyId={policy.id}
        policyLabel={policy.label}
        index={i}
        {span}
        {asOf}
        {windowEnd}
        {months}
        {playheadMonth}
        selected={selected?.kind === kind && selected.id === policy.id && selected.span === i}
        off={!policy.on}
        {readonly}
        {onselect}
        {onedit}
      />
    {/each}
  </Lane>
</div>

<style>
  .lab {
    display: flex;
    align-items: center;
    min-width: 0;
    padding: 0 10px 0 28px;
    border-bottom: 1px solid var(--color-line);
    font-size: 13px;
  }
  .lab.off {
    opacity: 0.6;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (prefers-color-scheme: dark) {
    .lab {
      border-bottom-color: var(--color-line-dark);
    }
  }
</style>
