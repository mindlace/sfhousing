<!--
  A fixed row (rule 7): what holds without any policy. It spans the whole window, cannot move or be
  removed; selecting it shows what it is, read-only. Renders a label cell and a lane for the
  Timeline's grid.
-->
<script lang="ts">
  import Lane from './Lane.svelte';
  import type { SpanRef } from './spans';

  interface Props {
    label: string;
    /** The bar's text. */
    text: string;
    color: 'zoning' | 'permitting' | 'money' | 'world';
    spanRef: SpanRef;
    selected: boolean;
    filledPct: number;
    onselect: (ref: SpanRef) => void;
    /** Indent as a child of an open kind. */
    child?: boolean;
  }

  let {
    label,
    text,
    color,
    spanRef,
    selected,
    filledPct,
    onselect,
    child = true
  }: Props = $props();
</script>

<div class="contents" data-testid="tl-fixed">
  <div class="lab" class:child>
    <span class="name" title={label}>{label}</span>
  </div>
  <Lane {filledPct}>
    <button
      type="button"
      class="bar k-{color} absolute"
      class:sel={selected}
      aria-label="{label}, whole window"
      aria-pressed={selected}
      onclick={() => onselect(spanRef)}
    >
      {text}
    </button>
  </Lane>
</div>

<style>
  .lab {
    display: flex;
    align-items: center;
    min-width: 0;
    padding: 0 10px;
    border-bottom: 1px solid var(--color-line);
    font-size: 13px;
  }
  .lab.child {
    padding-left: 28px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar {
    top: 5px;
    left: 0;
    right: 0;
    height: 20px;
    padding: 0 6px;
    border: 0;
    border-radius: 4px;
    font-size: 11px;
    line-height: 20px;
    color: #fff;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    cursor: pointer;
    background: var(--k);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.45);
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
  .k-world {
    --k: var(--k-world);
  }
  .bar.sel,
  .bar:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }
  @media (prefers-color-scheme: dark) {
    .lab {
      border-bottom-color: var(--color-line-dark);
    }
    .bar.sel,
    .bar:focus-visible {
      outline-color: var(--color-accent-dark);
    }
  }
</style>
