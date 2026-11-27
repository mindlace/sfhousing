<!--
  An open kind's full row for one policy (rule 6): its label and one SpanBar per span. The label is
  the policy's switch, its name, then "New" (a policy the game keeps fixed: its pane shows details)
  or "Edit" (its editor); both select the policy, and say whether the pane shows it
  (`aria-expanded`) and which pane it is (`aria-controls`, `paneId`). Read-only and locked rows have neither: the name
  only. A policy that is off is dimmed in place; a fixed policy's bars select it and cannot be
  moved. A locked policy's bars are dimmed and inert; `note` is a muted second line under the name.
  Renders a label cell and a lane for the Timeline's grid; below md the label cell has no box of
  its own, so the switch, the name, the button and the lane fill the grid as switch | name, then
  button | lane.
-->
<script lang="ts">
  import type { Day } from '$lib/timelapse/time';
  import Lane from './Lane.svelte';
  import type { Policy, PolicyKind, SimPolicy4 } from './policy4';
  import type { LevelSet } from './pool-level';
  import SpanBar from './SpanBar.svelte';
  import { setOn, type SpanRef } from './spans';

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
    /** A catalogue policy the player cannot edit yet: only its switch works; its row reads New. */
    fixed?: boolean;
    /** The id of the pane New and Edit open (their `aria-controls`); none when it is not shown. */
    paneId?: string;
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
    note = null,
    fixed = false,
    paneId = undefined
  }: Props = $props();

  const level = $derived(levels?.byPolicy.get(policy.id) ?? null);
  /** The switch and the button show: a row that is neither read-only nor locked. */
  const controls = $derived(!readonly && !locked);
  const select = () => onselect({ kind, id: policy.id, span: 0 });
  /** The pane shows this policy: New's and Edit's `aria-expanded`. Focus stays on the button. */
  const shown = $derived(selected?.kind === kind && selected.id === policy.id);
  const toggle = () =>
    onedit(
      (d) => setOn(d, kind, policy.id, !policy.on),
      `${policy.on ? 'Switched off' : 'Switched on'}: ${policy.label}`
    );
</script>

<div
  class="contents"
  data-testid="tl-policy"
  data-policy-id={policy.id}
  data-off={!policy.on}
  data-locked={locked || undefined}
>
  <div class="lab" class:ctl={controls} class:off={!policy.on} class:noted={note !== null}>
    {#if controls}
      <button
        type="button"
        role="switch"
        class="sw"
        aria-checked={policy.on}
        aria-label="{policy.label} on"
        data-testid="tl-policy-switch"
        onclick={toggle}
      >
        <span class="sw-track" aria-hidden="true"><span class="sw-knob"></span></span>
      </button>
    {/if}
    <span class="name" title={policy.label}>{policy.label}</span>
    {#if !policy.on && !controls}<span class="sr-only">, off</span>{/if}
    {#if note !== null}<span class="note" data-testid="tl-policy-note">{note}</span>{/if}
    {#if controls}
      {#if fixed}
        <button
          type="button"
          class="newb"
          aria-label="New: {policy.label}, details"
          aria-expanded={shown}
          aria-controls={paneId}
          data-testid="tl-policy-new"
          onclick={select}><span class="new" aria-hidden="true">New</span></button
        >
      {:else}
        <button
          type="button"
          class="editb"
          aria-label="Edit {policy.label}"
          aria-expanded={shown}
          aria-controls={paneId}
          data-testid="tl-policy-edit"
          onclick={select}>Edit</button
        >
      {/if}
    {/if}
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
        readonly={readonly || fixed}
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
  /* With controls: the switch, the name, then New or Edit at the right. */
  .lab.ctl {
    gap: 4px;
    padding: 0 6px 0 16px;
  }
  .lab.ctl .name {
    flex: 1;
    min-width: 0;
  }
  /* Off dims the name's colour only, never the switch or New or Edit (they keep their contrast). */
  .lab.off .name {
    color: var(--color-ink-muted);
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
  /* "New": a pill (18 px) inside a 24 px button. "Edit": a 12 px text button. */
  .newb,
  .editb {
    flex: none;
    display: inline-flex;
    align-items: center;
    min-width: 24px;
    min-height: 24px;
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .newb {
    padding: 0;
    border-radius: 9999px;
  }
  .new {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 6px;
    border: 1px solid var(--color-accent);
    border-radius: 9999px;
    background: var(--color-surface);
    color: var(--color-accent);
    font-size: 11px;
    line-height: 1;
    font-weight: 700;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  .newb:hover .new {
    background: var(--color-accent-tint);
  }
  .editb {
    justify-content: center;
    padding: 0 6px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
  }
  .editb:hover {
    background: var(--color-surface-raised);
  }
  /* The switch: a 34 by 24 px target holding a 30 by 16 px track; on is the knob at the right and
     the accent fill, never colour alone. */
  .sw {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 34px;
    min-height: 24px;
    padding: 0 2px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
  }
  .sw-track {
    position: relative;
    display: block;
    width: 30px;
    height: 16px;
    border: 1.5px solid var(--color-control-line);
    border-radius: 8px;
    background: var(--color-surface);
  }
  .sw-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--color-control-line);
  }
  .sw[aria-checked='true'] .sw-track {
    border-color: var(--color-accent);
    background: var(--color-accent);
  }
  .sw[aria-checked='true'] .sw-knob {
    left: 16px;
    background: var(--color-surface);
  }
  .sw:focus-visible,
  .newb:focus-visible,
  .editb:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }
  /* Below md two rows: switch | name, then New or Edit | the lane (Timeline puts the lane in
     column 2). The label cell has no box; each part keeps the ground and rides over the
     playhead line. */
  @media (max-width: 767.98px) {
    .lab.ctl {
      display: contents;
    }
    .lab.ctl .sw,
    .lab.ctl .name,
    .lab.ctl .newb,
    .lab.ctl .editb {
      position: relative;
      z-index: 2;
      background: var(--color-surface);
    }
    .lab.ctl .sw {
      grid-column: 1;
      padding-left: 4px;
      justify-content: flex-start;
    }
    .lab.ctl .name {
      grid-column: 2;
      align-self: stretch;
      display: flex;
      align-items: center;
    }
    .lab.ctl .newb,
    .lab.ctl .editb {
      grid-column: 1;
      align-self: stretch;
      justify-self: stretch;
      justify-content: flex-start;
      border-bottom: 1px solid var(--color-line);
      border-radius: 0;
      padding-left: 4px;
    }
  }
  @media (prefers-color-scheme: dark) {
    .lab {
      border-bottom-color: var(--color-line-dark);
    }
    .note,
    .lab.off .name {
      color: var(--color-ink-dark-muted);
    }
    .new {
      border-color: var(--color-accent-dark);
      background: var(--color-surface-dark);
      color: var(--color-accent-dark);
    }
    .sw-track {
      border-color: var(--color-control-line-dark);
      background: var(--color-surface-dark);
    }
    .sw-knob {
      background: var(--color-control-line-dark);
    }
    .sw[aria-checked='true'] .sw-track {
      border-color: var(--color-accent-dark);
      background: var(--color-accent-dark);
    }
    .sw[aria-checked='true'] .sw-knob {
      background: var(--color-surface-dark);
    }
    .newb:hover .new {
      background: var(--color-surface-dark-raised);
    }
    .editb:hover {
      background: var(--color-surface-dark-raised);
    }
    .sw:focus-visible,
    .newb:focus-visible,
    .editb:focus-visible {
      outline-color: var(--color-accent-dark);
    }
    @media (max-width: 767.98px) {
      .lab.ctl .sw,
      .lab.ctl .name,
      .lab.ctl .newb,
      .lab.ctl .editb {
        background: var(--color-surface-dark);
      }
      .lab.ctl .newb,
      .lab.ctl .editb {
        border-bottom-color: var(--color-line-dark);
      }
    }
  }
</style>
