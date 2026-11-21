<!--
  A fixed row (rule 7): what holds without any policy. It spans the whole window, cannot move or be
  removed; selecting it shows what it is, read-only. Renders a label cell and a lane for the
  Timeline's grid.
-->
<script lang="ts">
  import type { Day } from '$lib/timelapse/time';
  import Lane from './Lane.svelte';
  import LevelFill from './LevelFill.svelte';
  import { levelIndexAt, levelLeft, type LevelSet } from './pool-level';
  import { fixedLabel } from './rows';
  import type { SpanRef } from './spans';

  interface Props {
    label: string;
    /** The bar's text. */
    text: string;
    color: 'zoning' | 'permitting' | 'money' | 'world';
    spanRef: SpanRef;
    selected: boolean;
    onselect: (ref: SpanRef) => void;
    /** Indent as a child of an open kind. */
    child?: boolean;
    /** The capped baseline pools' level ("Current funding"); null for none. */
    level?: Float64Array | null;
    /** The set `level` is from: its months and dataset date (the window's start). */
    levels?: LevelSet | null;
    /** The window's last day: the bar spans the dataset date to it. */
    windowEnd?: Day;
    /** The playhead's day and the furthest day reached: the level's two zones. */
    day?: Day;
    reached?: Day;
    /** The level is held numbers: it and its words dim. */
    stale?: boolean;
  }

  let {
    label,
    text,
    color,
    spanRef,
    selected,
    onselect,
    child = true,
    level = null,
    levels = null,
    windowEnd = 0,
    day = 0,
    reached = day,
    stale = false
  }: Props = $props();

  const shownLevel = $derived(levels !== null && windowEnd > 0 ? level : null);
  const left = $derived(
    shownLevel && levels
      ? levelLeft(shownLevel, levelIndexAt(levels.months, levels.asOf, day, levels.asOf, windowEnd))
      : null
  );
</script>

<div class="contents" data-testid="tl-fixed">
  <div class="lab" class:child>
    <span class="name" title={label}>{label}</span>
  </div>
  <Lane>
    <button
      type="button"
      class="bar k-{color} absolute"
      class:sel={selected}
      class:leveled={shownLevel !== null}
      class:stale={shownLevel !== null && stale}
      aria-label={fixedLabel(text, label, left)}
      aria-pressed={selected}
      onclick={() => onselect(spanRef)}
    >
      {#if shownLevel && levels}
        <LevelFill
          level={shownLevel}
          months={levels.months}
          asOf={levels.asOf}
          from={levels.asOf}
          to={windowEnd}
          {day}
          {reached}
          {stale}
        />
      {/if}
      <span class="txt"
        >{text}{#if left}<span class="left">{left}</span>{/if}</span
      >
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
    color: var(--on-k, #fff);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    cursor: pointer;
    background: var(--k);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.45);
  }
  /* The text sits over the level, on a small backing in the bar's colour, so the level's edge
     passes under the words and never strikes them through. While stale the backing takes the
     fill's shade and ", N% left" dims (`--level-dim`), still 4.5:1. */
  .txt {
    position: relative;
  }
  .leveled .txt {
    margin: 0 -3px;
    padding: 0 3px;
    border-radius: 3px;
    background: var(--k);
  }
  .leveled.stale .txt {
    background: linear-gradient(var(--level-empty), var(--level-empty)), var(--k);
  }
  .stale .left {
    opacity: var(--level-dim);
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
  /* Under forced colours the bar's fill is not drawn: a 1 px line inside its box draws its extent
     (a selected or focused bar keeps its own outline). */
  @media (forced-colors: active) {
    .bar {
      outline: 1px solid ButtonText;
      outline-offset: -1px;
    }
  }
</style>
