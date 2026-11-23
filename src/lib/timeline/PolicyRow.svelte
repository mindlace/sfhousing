<!--
  An open kind's full row for one policy (rule 6): its label and one SpanBar per span. A policy
  that is off is dimmed in place. A locked policy's bars are dimmed and inert; `note` is a muted
  second line under the name. Renders a label cell and a lane for the Timeline's grid.
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
    /** The levels are held numbers: they dim. */
    stale?: boolean;
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
    /** The game does not run this policy: its bars are dimmed and cannot be selected or moved. */
    locked?: boolean;
    /** The label's second, muted line; null for none. */
    note?: string | null;
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
    reached = day,
    stale = false,
    locked = false,
    note = null
  }: Props = $props();

  const level = $derived(levels?.byPolicy.get(policy.id) ?? null);
</script>

<div
  class="contents"
  data-testid="tl-policy"
  data-off={!policy.on}
  data-locked={locked || undefined}
>
  <div class="lab" class:off={!policy.on} class:noted={note !== null}>
    <span class="name" title={policy.label}>{policy.label}</span>
    {#if !policy.on}<span class="sr-only">, off</span>{/if}
    {#if note !== null}<span class="note" data-testid="tl-policy-note">{note}</span>{/if}
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
        {locked}
        {onselect}
        {onedit}
        {level}
        {levels}
        {day}
        {reached}
        {stale}
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
  .name,
  .note {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* A note is a second line under the name. */
  .lab.noted {
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    padding-top: 2px;
    padding-bottom: 2px;
  }
  .note {
    color: var(--color-ink-muted);
    font-size: 11px;
    line-height: 1.2;
  }
  @media (prefers-color-scheme: dark) {
    .lab {
      border-bottom-color: var(--color-line-dark);
    }
    .note {
      color: var(--color-ink-dark-muted);
    }
  }
</style>
