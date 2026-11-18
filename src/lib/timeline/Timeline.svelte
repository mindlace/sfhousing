<!--
  The timeline's rows (rules 2, 5 to 9, 11). From the top: the playhead part (its Ruler is inside
  it), the chart, Zoning, Permitting, Public money (only when the data can run money) and "The
  world". Every row is hatched past `filledEnd` (rule 3). From md a kind opens in place; below md
  tapping a kind opens its rows as a full-height sheet over the same lanes, with the playhead and
  chart staying above its handle (rule 9). The "+" menu and the editor belong to the page.
  The playhead's slider and Ruler, the chart and every lane sit on one grid column, so they share
  one x scale; the playhead line runs down that column at `playheadDay`.
-->
<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { marketLevel } from '$lib/sim/scenario/market';
  import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
  import { monthLastDay } from '$lib/sim/world/months';
  import type { Day } from '$lib/timelapse/time';
  import type { Calibration } from '$lib/timelapse/types';
  import ChartLegend from './ChartLegend.svelte';
  import FixedRow from './FixedRow.svelte';
  import KindRow from './KindRow.svelte';
  import Lane from './Lane.svelte';
  import type { PolicyKind, SimPolicy4 } from './policy4';
  import {
    dayPct,
    hasMoney,
    KIND_LABEL,
    MARKET_LABEL,
    isFixedRef,
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
    /** The chart draws the goal's step: the stacked legend names the goal. */
    goalShown: boolean;
    /** The playhead's model month, for the keys' nearer edge. */
    playheadMonth: number;
    /** The playhead's day: the line through the rows sits at it. */
    playheadDay: Day;
    /** Each row is hatched past it. */
    filledEnd: Day;
    /** The pinned block's height (its offsetHeight), for the page's scroll padding. */
    pinHeight?: number;
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
    goalShown,
    playheadMonth,
    playheadDay,
    filledEnd,
    pinHeight = $bindable(0)
  }: Props = $props();

  const windowEnd = $derived(monthLastDay(asOf, WINDOW_MONTHS));
  const filledPct = $derived(dayPct(filledEnd, asOf, windowEnd));
  const playheadPct = $derived(dayPct(playheadDay, asOf, windowEnd));
  const kinds = $derived<PolicyKind[]>(
    hasMoney(calibration) ? ['zoning', 'permitting', 'money'] : ['zoning', 'permitting']
  );
  const marketSelected = $derived(
    selected !== null && isFixedRef(selected) && selected.id === MARKET_ID
  );

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

  // The element that opened the sheet gets focus back when it closes.
  let opener: HTMLElement | null = null;

  function toggle(kind: PolicyKind) {
    if (!phone) {
      opened[kind] = !opened[kind];
      return;
    }
    if (sheet === kind) {
      closeSheet();
      return;
    }
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet = kind;
  }

  async function closeSheet() {
    sheet = null;
    // The grid is inert while the sheet is open; focus goes back once it is not.
    await tick();
    opener?.focus();
    opener = null;
  }

  // The sheet covers the page from just under the chart to the end of the page's mode box (not
  // past it), across the timeline's width.
  // Opening scrolls the timeline to the top of the viewport first, so the playhead and chart are in
  // view above it; the sheet is never left shorter than MIN_SHEET.
  const MIN_SHEET = 280;
  let root: HTMLElement | undefined = $state();
  let chartCell: HTMLElement | undefined = $state();
  let handle: HTMLElement | undefined = $state();
  let box = $state({ top: 0, left: 0, width: 0, bottom: 0 });
  const sheeting = $derived(phone && sheet !== null && kinds.includes(sheet));

  function place() {
    if (!root || !chartCell) return;
    const r = root.getBoundingClientRect();
    const bottom = chartCell.getBoundingClientRect().bottom;
    // The sheet ends where the page's mode box ends, so it never reaches past the box it belongs to.
    const mode = root.closest('[data-testid="tl-mode"]')?.getBoundingClientRect().bottom;
    const end = Math.min(mode ?? Infinity, window.innerHeight);
    box = {
      top: Math.max(0, Math.min(bottom, end - MIN_SHEET)),
      left: r.left,
      width: r.width,
      bottom: Math.max(0, window.innerHeight - end)
    };
  }
  $effect(() => {
    if (!sheeting) return;
    root?.scrollIntoView({ block: 'start', behavior: 'instant' });
    place();
    tick().then(() => handle?.focus());
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  });

  // Tab wraps inside the sheet: nothing behind it is reachable.
  function ontrap(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const items = [
      ...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button, [tabindex="0"]')
    ].filter((el) => !el.hasAttribute('disabled'));
    if (items.length === 0) return;
    const [first, last] = [items[0], items[items.length - 1]];
    const at = document.activeElement;
    if (e.shiftKey && at === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onwindowkeydown(e: KeyboardEvent) {
    // An Escape the editor (over the sheet) took closes the editor only; focus goes back to its bar.
    if (e.key === 'Escape' && sheeting && !e.defaultPrevented) {
      e.stopPropagation();
      closeSheet();
    }
  }
</script>

<svelte:window onkeydown={onwindowkeydown} />

<!-- With the sheet open the page gets room to scroll the timeline to the top of the viewport. -->
<div
  bind:this={root}
  class="tl relative"
  data-testid="tl-timeline"
  style:padding-bottom={sheeting ? '100dvh' : undefined}
>
  <div class="rows grid" inert={sheeting}>
    <!-- The playhead's parts, the chart's label and the chart share the rows' columns. They stay
         pinned at the top of the scroll box while the rows scroll under them. -->
    <div class="pin" data-testid="tl-pin" bind:offsetHeight={pinHeight}>
      {@render playhead()}

      <!-- From md the stacked legend is the row's label (its first entry names the line); below
           md the plain label, with the legend under the plot. -->
      <div class="lab plain chart-lab">
        {#if phone}
          <span>Homes completed</span>
        {:else}
          <ChartLegend stacked goal={goalShown} />
        {/if}
      </div>
      <div class="cell" bind:this={chartCell}>
        <Lane {filledPct}>{@render chart()}</Lane>
      </div>

      <div
        class="line"
        data-testid="tl-playhead-line"
        aria-hidden="true"
        style:left="{playheadPct}%"
      ></div>
    </div>

    {#each kinds as kind (kind)}
      <KindRow
        {kind}
        policies={policy.kinds[kind]}
        open={phone ? false : opened[kind]}
        expanded={phone ? sheet === kind : opened[kind]}
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

    <div
      class="line"
      data-testid="tl-playhead-line"
      aria-hidden="true"
      style:left="{playheadPct}%"
    ></div>
  </div>

  {#if sheeting && sheet}
    <div
      class="sheet"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onkeydown={ontrap}
      aria-label={KIND_LABEL[sheet]}
      style:top="{box.top}px"
      style:bottom="{box.bottom}px"
      style:left="{box.left}px"
      style:width="{box.width}px"
    >
      <button
        bind:this={handle}
        type="button"
        class="handle"
        aria-label="Close {KIND_LABEL[sheet]}"
        onclick={closeSheet}
      >
        <span aria-hidden="true"></span>
      </button>
      <div class="grid">
        <KindRow
          kind={sheet}
          policies={policy.kinds[sheet]}
          open={true}
          ontoggle={closeSheet}
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
        <div
          class="line"
          data-testid="tl-playhead-line"
          aria-hidden="true"
          style:left="{playheadPct}%"
        ></div>
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
    --on-k: #ffffff;
    color: var(--color-ink);
    /* A page that pads its scroll box for the pinned block sets --tl-scroll-mt to take the block
       back off when the timeline is scrolled to the top. */
    scroll-margin-top: var(--tl-scroll-mt, 0px);
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
  .rows {
    position: relative;
  }
  /* Opaque and above the rows (and their line segment), so rows scrolling under it are hidden. A
     page whose scroll box is too short for the block and some rows sets --tl-pin-pos to relative:
     the block then scrolls with the rows. */
  .pin {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    position: var(--tl-pin-pos, sticky);
    top: 0;
    z-index: 3;
    background: var(--color-surface);
  }
  /* A page that pads its scroll box by the block's height (plus a gap: TimelineMode's PIN_GAP from
     md) sets --tl-pin-mt to minus that padding, so focusing a control in the block (inside the
     padding) never scrolls the rows. */
  .pin :global(*) {
    scroll-margin-top: var(--tl-pin-mt, 0px);
  }
  /* The playhead line, in two segments at the same x: one through the pinned block from the
     slider's row down, one through every row under it. An absolutely placed grid child takes its
     grid area as its containing block; the row end left auto reaches the grid's bottom edge. */
  .line {
    position: absolute;
    grid-column: 2;
    grid-row: 2;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    z-index: 1;
    pointer-events: none;
    background: var(--color-accent);
  }
  /* In the kind sheet the line runs through every lane, its kind's own row included. */
  .sheet .grid {
    position: relative;
  }
  .sheet .line {
    grid-row: 1;
  }
  .cell {
    position: relative;
    min-width: 0;
  }
  /* While the chart shows its readout, the chart cell rises above the playhead line so the
     readout is never crossed by it; otherwise the line stays on top. */
  .cell:has(:global(.sfh-chart-readout)) {
    z-index: 2;
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
  /* From md the chart's label stacks its legend under it (the plot keeps the lane's width). */
  @media (min-width: 768px) {
    .chart-lab {
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      gap: 2px;
    }
  }
  .sheet {
    position: fixed;
    bottom: 0;
    z-index: 20;
    overflow-y: auto;
    overscroll-behavior: contain;
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
      /* Fills reach 3:1 on the dark surface and its raised tone; the text on them 4.5:1. */
      --k-zoning: #7aa2f0;
      --k-permitting: #d9a24e;
      --k-money: #4fb98a;
      --k-world: #a0a0a8;
      --on-k: #1c1d1f;
    }
    .lab {
      border-bottom-color: var(--color-line-dark);
    }
    .pin {
      background: var(--color-surface-dark);
    }
    .line {
      background: var(--color-accent-dark);
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
