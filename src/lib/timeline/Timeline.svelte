<!--
  The timeline's rows (rules 2, 5 to 9, 11). From the top: the playhead part (its Ruler is inside
  it), the chart, Zoning, Permitting, Public money (only when the data can run money) and "The
  world". Every row is hatched past `filledEnd` (rule 3). From md a kind opens in place; below md
  tapping a kind opens its rows as a full-height sheet over the same lanes, with the playhead and
  chart staying above its handle (rule 9). The "+" menu and the editor belong to the page.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { marketLevel } from '$lib/sim/scenario/market';
  import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
  import { monthLastDay } from '$lib/sim/world/months';
  import type { Day } from '$lib/timelapse/time';
  import type { Calibration } from '$lib/timelapse/types';
  import FixedRow from './FixedRow.svelte';
  import KindRow from './KindRow.svelte';
  import Lane from './Lane.svelte';
  import type { PolicyKind, SimPolicy4 } from './policy4';
  import {
    dayPct,
    hasMoney,
    KIND_LABEL,
    MARKET_LABEL,
    marketRef,
    marketText,
    MARKET_ID
  } from './rows';
  import type { SpanRef } from './spans';

  interface Props {
    policy: SimPolicy4;
    calibration: Calibration;
    asOf: Day;
    readonly: boolean;
    selected: SpanRef | null;
    onselect: (ref: SpanRef | null) => void;
    onedit: (change: (p: SimPolicy4) => SimPolicy4, label: string) => void;
    /** "+": the menu is the page's. */
    onadd: (kind: PolicyKind) => void;
    /** The playhead's controls, slider and Ruler. */
    playhead: Snippet;
    /** The chart row's figure. */
    chart: Snippet;
    /** The playhead's model month, for the keys' nearer edge. */
    playheadMonth: number;
    /** Each row is hatched past it. */
    filledEnd: Day;
  }

  let {
    policy,
    calibration,
    asOf,
    readonly,
    selected,
    onselect,
    onedit,
    onadd,
    playhead,
    chart,
    playheadMonth,
    filledEnd
  }: Props = $props();

  const windowEnd = $derived(monthLastDay(asOf, WINDOW_MONTHS));
  const filledPct = $derived(dayPct(filledEnd, asOf, windowEnd));
  const kinds = $derived<PolicyKind[]>(
    hasMoney(calibration) ? ['zoning', 'permitting', 'money'] : ['zoning', 'permitting']
  );
  const marketSelected = $derived(selected?.id === MARKET_ID);

  // Open kinds from md; below md one kind at a time opens as a sheet.
  let opened = $state<Record<PolicyKind, boolean>>({
    zoning: false,
    permitting: false,
    money: false
  });
  let phone = $state(false);
  let sheet = $state<PolicyKind | null>(null);

  $effect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    phone = mq.matches;
    const on = () => (phone = mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });

  function toggle(kind: PolicyKind) {
    if (phone) sheet = sheet === kind ? null : kind;
    else opened[kind] = !opened[kind];
  }

  // The sheet covers the page from just under the chart to the bottom, across the timeline's width.
  let root: HTMLElement | undefined = $state();
  let chartCell: HTMLElement | undefined = $state();
  let box = $state({ top: 0, left: 0, width: 0 });
  const sheeting = $derived(phone && sheet !== null && kinds.includes(sheet));

  function place() {
    if (!root || !chartCell) return;
    const r = root.getBoundingClientRect();
    box = { top: chartCell.getBoundingClientRect().bottom, left: r.left, width: r.width };
  }
  $effect(() => {
    if (!sheeting) return;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  });

  function onwindowkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && sheeting) {
      sheet = null;
      e.stopPropagation();
    }
  }
</script>

<svelte:window onkeydown={onwindowkeydown} />

<div bind:this={root} class="tl relative" data-testid="tl-timeline">
  <div class="grid">
    <div class="ph">{@render playhead()}</div>

    <div class="lab plain">Homes completed</div>
    <div class="cell" bind:this={chartCell}>
      <Lane {filledPct}>{@render chart()}</Lane>
    </div>

    {#each kinds as kind (kind)}
      <KindRow
        {kind}
        policies={policy.kinds[kind]}
        open={phone ? false : opened[kind]}
        ontoggle={() => toggle(kind)}
        {asOf}
        {windowEnd}
        months={WINDOW_MONTHS}
        {filledPct}
        {playheadMonth}
        {selected}
        {readonly}
        {onselect}
        {onedit}
        {onadd}
      />
    {/each}

    <div class="contents" data-testid="tl-world">
      <div class="lab plain heading">The world</div>
      <Lane {filledPct} />
      <FixedRow
        label={MARKET_LABEL}
        text={marketText(calibration, marketLevel(calibration))}
        color="world"
        spanRef={marketRef()}
        selected={marketSelected}
        {filledPct}
        {onselect}
      />
    </div>
  </div>

  {#if sheeting && sheet}
    <div
      class="sheet"
      role="dialog"
      aria-label={KIND_LABEL[sheet]}
      style:top="{box.top}px"
      style:left="{box.left}px"
      style:width="{box.width}px"
    >
      <button
        type="button"
        class="handle"
        aria-label="Close {KIND_LABEL[sheet]}"
        onclick={() => (sheet = null)}
      >
        <span aria-hidden="true"></span>
      </button>
      <div class="grid">
        <KindRow
          kind={sheet}
          policies={policy.kinds[sheet]}
          open={true}
          ontoggle={() => (sheet = null)}
          {asOf}
          {windowEnd}
          months={WINDOW_MONTHS}
          {filledPct}
          {playheadMonth}
          {selected}
          {readonly}
          {onselect}
          {onedit}
          {onadd}
        />
      </div>
    </div>
  {/if}
</div>

<style>
  .tl {
    --lab: 92px;
    --k-zoning: #2f5fc4;
    --k-permitting: #8f5a12;
    --k-money: #1f7a55;
    --k-world: #5f5f66;
    color: var(--color-ink);
  }
  @media (min-width: 768px) {
    .tl {
      --lab: 168px;
    }
  }
  .grid {
    display: grid;
    grid-template-columns: var(--lab) minmax(0, 1fr);
  }
  .ph {
    grid-column: 2;
  }
  .cell {
    min-width: 0;
  }
  .lab {
    display: flex;
    align-items: center;
    padding: 0 10px;
    border-bottom: 1px solid var(--color-line);
    font-size: 13px;
    min-width: 0;
  }
  .lab.heading {
    font-weight: 600;
  }
  .sheet {
    position: fixed;
    bottom: 0;
    z-index: 20;
    overflow-y: auto;
    border-top: 1px solid var(--color-line);
    border-radius: 16px 16px 0 0;
    background: var(--color-surface);
    box-shadow: 0 -4px 16px rgb(0 0 0 / 0.18);
  }
  .handle {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    min-height: 44px;
    border: 0;
    background: transparent;
    cursor: pointer;
  }
  .handle span {
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: var(--color-ink-muted);
  }
  .handle:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }
  @media (prefers-color-scheme: dark) {
    .tl {
      color: var(--color-ink-dark);
    }
    .lab {
      border-bottom-color: var(--color-line-dark);
    }
    .sheet {
      border-top-color: var(--color-line-dark);
      background: var(--color-surface-dark);
    }
    .handle span {
      background: var(--color-ink-dark-muted);
    }
    .handle:focus-visible {
      outline-color: var(--color-accent-dark);
    }
  }
</style>
