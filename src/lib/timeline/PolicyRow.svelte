<!--
  An open kind's full row for one policy (rule 6): its label and one SpanBar per span. A policy
  that is off is dimmed in place. Renders a label cell and a lane for the Timeline's grid.
-->
<script lang="ts">
  import type { Day } from '$lib/timelapse/time';
  import Lane from './Lane.svelte';
  import type { Policy, PolicyKind, SimPolicy4 } from './policy4';
  import type { LevelSet } from './pool-level';
  import SpanBar from './SpanBar.svelte';
  import type { SpanRef } from './spans';

  interface Props {
    /** The pool levels on show; a fund policy with an own capped pool has one. */
    levels?: LevelSet | null;
    /** The playhead's day and the furthest day reached. */
    day?: Day;
    reached?: Day;
    kind: PolicyKind;
    policy: Policy;
    asOf: Day;
    windowEnd: Day;
    months: number;
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
    playheadMonth,
    selected,
    readonly,
    onselect,
    onedit,
    levels = null,
    day = asOf,
    reached = day
  }: Props = $props();

  const level = $derived(levels?.byPolicy.get(policy.id) ?? null);
</script>

<div class="contents" data-testid="tl-policy" data-off={!policy.on}>
  <div class="lab" class:off={!policy.on}>
    <span class="name" title={policy.label}>{policy.label}</span>
    {#if !policy.on}<span class="sr-only">, off</span>{/if}
  </div>
  <Lane>
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
        {level}
        {levels}
        {day}
        {reached}
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
