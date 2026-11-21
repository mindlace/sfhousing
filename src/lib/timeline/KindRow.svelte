<!--
  A kind's row (rules 5, 6, 7). Closed: a label with the count and a "+", and a miniature, one thin
  bar per policy over its spans. Open: the label row as a heading, then the kind's fixed row and a
  full row per policy; no miniature. Renders cells for the Timeline's two-column grid.
-->
<script lang="ts">
  import type { Day } from '$lib/timelapse/time';
  import FixedRow from './FixedRow.svelte';
  import Lane from './Lane.svelte';
  import PolicyRow from './PolicyRow.svelte';
  import type { PolicyKind, Policy, SimPolicy4 } from './policy4';
  import {
    barBox,
    EMPTY_LANE,
    FIXED_ID,
    FIXED_LABEL,
    fixedRef,
    isFixedRef,
    KIND_LABEL
  } from './rows';
  import type { SpanRef } from './spans';

  interface Props {
    kind: PolicyKind;
    policies: Policy[];
    open: boolean;
    /** What the toggle reports; its sheet counts as open on a phone. Defaults to `open`. */
    expanded?: boolean;
    ontoggle: () => void;
    asOf: Day;
    windowEnd: Day;
    months: number;
    playheadMonth: number;
    selected: SpanRef | null;
    readonly: boolean;
    onselect: (ref: SpanRef | null) => void;
    onedit: (change: (p: SimPolicy4) => SimPolicy4, label: string) => void;
    onadd: (kind: PolicyKind) => void;
  }

  let {
    kind,
    policies,
    open,
    expanded = undefined,
    ontoggle,
    asOf,
    windowEnd,
    months,
    playheadMonth,
    selected,
    readonly,
    onselect,
    onedit,
    onadd
  }: Props = $props();

  const label = $derived(KIND_LABEL[kind]);
  const countId = $props.id();
  const step = $derived(Math.min(7, 24 / Math.max(policies.length, 1)));
  const fixedSelected = $derived(
    selected !== null && isFixedRef(selected) && selected.id === FIXED_ID && selected.kind === kind
  );
</script>

<div class="contents" data-testid="tl-kind-{kind}">
  <div class="lab kind">
    <button
      type="button"
      class="toggle"
      aria-expanded={expanded ?? open}
      aria-describedby={countId}
      onclick={ontoggle}
    >
      <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" class:turned={open}>
        <path d="M3 1.5 7 5 3 8.5" fill="none" stroke="currentColor" stroke-width="1.6" />
      </svg>{label}
    </button>
    <span class="count" id={countId} data-testid="tl-count">{policies.length}</span>
    {#if !readonly}
      <button
        type="button"
        class="plus"
        aria-label="Add {label} policy"
        onclick={() => onadd(kind)}
      >
        +
      </button>
    {/if}
  </div>
  <Lane>
    {#if !open && policies.length === 0 && !readonly}
      <!-- The "+" in words, for the pointer: the "+" named "Add {label} policy" is the keyboard
           and assistive path, so this is hidden from both (one stop per action). -->
      <button
        type="button"
        class="empty"
        data-testid="tl-empty-lane"
        tabindex="-1"
        aria-hidden="true"
        onclick={() => onadd(kind)}>{EMPTY_LANE[kind]}</button
      >
    {:else if !open}
      {#each policies as p, i (p.id)}
        <div class="mini-policy" data-testid="tl-mini" class:off={!p.on} aria-hidden="true">
          {#each p.spans as s, j (j)}
            {@const b = barBox(s, asOf, windowEnd)}
            <i
              class="mini k-{kind}"
              style:left="{b.left}%"
              style:width="{b.width}%"
              style:top="{3 + i * step}px"
            ></i>
          {/each}
        </div>
      {/each}
    {/if}
  </Lane>
  {#if open}
    <FixedRow
      label={FIXED_LABEL[kind]}
      text="In force"
      color={kind}
      spanRef={fixedRef(kind)}
      selected={fixedSelected}
      onselect={(r) => onselect(r)}
    />
    {#each policies as p (p.id)}
      <PolicyRow
        {kind}
        policy={p}
        {asOf}
        {windowEnd}
        {months}
        {playheadMonth}
        {selected}
        {readonly}
        onselect={(r) => onselect(r)}
        {onedit}
      />
    {/each}
  {/if}
</div>

<style>
  .lab {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 0 6px 0 4px;
    border-bottom: 1px solid var(--color-line);
    font-size: 13px;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    min-height: 30px;
    padding: 0 4px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .toggle svg {
    flex: none;
    transition: transform 0.1s;
  }
  .toggle svg.turned {
    transform: rotate(90deg);
  }
  .count {
    margin-left: auto;
    color: var(--color-ink-muted);
    font-size: 11px;
  }
  .plus {
    min-width: 24px;
    min-height: 24px;
    border-radius: 6px;
    border: 1px solid var(--color-control-line);
    background: var(--color-surface);
    color: inherit;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
  }
  .toggle:focus-visible,
  .plus:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }
  .empty {
    position: absolute;
    inset: 3px auto 3px 6px;
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 0 6px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--color-ink-muted);
    font: inherit;
    font-size: 13px;
    white-space: nowrap;
    cursor: pointer;
  }
  .empty:hover {
    color: var(--color-ink);
    text-decoration: underline;
  }
  .mini-policy {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .mini-policy.off {
    opacity: 0.4;
  }
  .mini {
    position: absolute;
    height: 5px;
    border-radius: 2px;
    background: var(--k);
  }
  .k-zoning {
    --k: var(--k-zoning);
  }
  .k-permitting {
    --k: var(--k-permitting);
  }
  .k-money {
    --k: var(--k-money);
  }
  @media (pointer: coarse) {
    .toggle,
    .plus {
      min-height: 44px;
    }
    .plus {
      min-width: 44px;
    }
  }
  @media (prefers-color-scheme: dark) {
    .lab {
      border-bottom-color: var(--color-line-dark);
    }
    .plus {
      border-color: var(--color-control-line-dark);
      background: var(--color-surface-dark);
    }
    .count,
    .empty {
      color: var(--color-ink-dark-muted);
    }
    .empty:hover {
      color: var(--color-ink-dark);
    }
    .toggle:focus-visible,
    .plus:focus-visible {
      outline-color: var(--color-accent-dark);
    }
  }
</style>
