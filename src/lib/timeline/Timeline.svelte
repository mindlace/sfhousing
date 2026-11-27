<!--
  The timeline's rows (rules 2, 5 to 9, 11). From the top: the playhead part (the transport and
  the ruler, one row), the chart, Zoning, Permitting, Public money (only when the data can run
  money) and "The world". No row is hatched: the ruler alone shows what is unseen (rule 3). From
  md a kind opens in place; below md tapping a kind opens its rows as a full-height sheet over
  the same lanes, with the playhead and chart staying above its handle (rule 9). The "+" menu and
  the editor belong to the page.
  The ruler, the chart and every lane sit on one grid column, so they share one x scale; the
  playhead line runs down that column at `playheadDay`, from the chart down.
-->
<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { OPEN_LIMITS, within, type Limits } from '$lib/game/limits';
  import { marketLevel } from '$lib/sim/scenario/market';
  import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
  import { monthLastDay } from '$lib/sim/world/months';
  import type { Day } from '$lib/timelapse/time';
  import type { Calibration } from '$lib/timelapse/types';
  import ChartLegend from './ChartLegend.svelte';
  import type { ChartLens } from './chart-lens';
  import { kindOpen } from './add';
  import FixedRow from './FixedRow.svelte';
  import KindRow from './KindRow.svelte';
  import Lane from './Lane.svelte';
  import type { Policy, PolicyKind, SimPolicy4 } from './policy4';
  import type { LevelSet } from './pool-level';
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
    /** The playhead's row: the transport in the label column, the ruler in the lane column. */
    playhead: Snippet;
    /** The chart row's figure. */
    chart: Snippet;
    /** The chart draws the goal's step: the stacked legend names the goal. */
    goalShown: boolean;
    /** The chart draws current law and the gap: the stacked legend names them. */
    inForce: boolean;
    /** What the chart plots (Details switches it): the stacked legend names its lines. */
    lens?: ChartLens;
    /** The playhead's model month, for the keys' nearer edge. */
    playheadMonth: number;
    /** The playhead's day: the line through the rows sits at it. */
    playheadDay: Day;
    /** The pool levels on show (`levelSet`), drawn in an open Public money kind's bars. */
    levels?: LevelSet | null;
    /** The furthest day reached: the levels are seen (dimmed) to it, absent after. */
    reached?: Day;
    /** The numbers on show are held while an edit waits: the levels dim, as the chart does. */
    stale?: boolean;
    /** The pinned block's height (its offsetHeight): the page weighs it against its box. */
    pinHeight?: number;
    /**
     * True: the rows scroll in their own box under the pinned block (the block never covers a
     * row). False (a box too short to leave MIN_ROWS of rows): the block and rows are one piece
     * that the page's box scrolls. Default true.
     */
    pinned?: boolean;
    /** What the game offers: "+" only on a kind that opens; a policy not within is locked. */
    limits?: Limits;
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
    inForce,
    lens = 'homes',
    playheadMonth,
    playheadDay,
    levels = null,
    reached = playheadDay,
    stale = false,
    pinHeight = $bindable(0),
    pinned = true,
    limits = OPEN_LIMITS
  }: Props = $props();

  const lockedIn = (kind: PolicyKind) => (p: Policy) => !within(kind, p, limits);

  const windowEnd = $derived(monthLastDay(asOf, WINDOW_MONTHS));
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

  // The rows box's scrollbar width: the pinned block pads its end by it, so its lane column and
  // the rows' share one x scale.
  let rowsEl: HTMLElement | undefined = $state();
  let gutter = $state(0);
  $effect(() => {
    const el = rowsEl;
    if (!el) return;
    const measure = () => (gutter = el.offsetWidth - el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
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

<!-- With the sheet open and the timeline in one piece, the page gets room to scroll the timeline
     to the top of the viewport (pinned, the page's box is tall enough already). -->
<div
  bind:this={root}
  class="tl relative"
  class:pinned
  data-testid="tl-timeline"
  style:padding-bottom={sheeting && !pinned ? '100dvh' : undefined}
  style:--tl-gutter="{gutter}px"
>
  <!-- The playhead's parts, the chart's label and the chart: a grid of their own above the rows'
       scroll box, on the same columns (less the rows' scrollbar), so they share one x scale and
       a row never passes under them. -->
  <div class="pin grid" data-testid="tl-pin" inert={sheeting} bind:offsetHeight={pinHeight}>
    {@render playhead()}

    <!-- From md the stacked legend is the row's label (its first entry names the line); below
         md the plain label, with the legend under the plot. -->
    <div class="lab plain chart-lab">
      {#if phone}
        <span>Homes completed</span>
      {:else}
        <ChartLegend stacked goal={goalShown} {inForce} {lens} />
      {/if}
    </div>
    <div class="cell" bind:this={chartCell}>
      <Lane>{@render chart()}</Lane>
    </div>

    <div
      class="line"
      data-testid="tl-playhead-line"
      aria-hidden="true"
      style:left="{playheadPct}%"
    ></div>
  </div>

  <!-- The rows' scroll box while pinned (else it grows with them); its one child is the grid. -->
  <div bind:this={rowsEl} class="rows" data-testid="tl-rows" inert={sheeting}>
    <div class="rows-grid grid">
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
          {playheadMonth}
          {selected}
          {readonly}
          {onselect}
          {onedit}
          {onadd}
          {levels}
          day={playheadDay}
          {reached}
          {stale}
          canAdd={kindOpen(kind, limits)}
          isLocked={lockedIn(kind)}
        />
      {/each}

      <div class="world contents" data-testid="tl-world">
        <div class="lab plain heading">The world</div>
        <Lane />
        <FixedRow
          label={MARKET_LABEL}
          text={marketText(calibration, marketLevel(calibration))}
          color="world"
          spanRef={marketRef()}
          selected={marketSelected}
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
          {playheadMonth}
          {selected}
          {readonly}
          {onselect}
          {onedit}
          {onadd}
          {levels}
          day={playheadDay}
          {reached}
          {stale}
          canAdd={kindOpen(sheet, limits)}
          isLocked={lockedIn(sheet)}
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
    /* A pool's level (LevelFill): the empty part darkens the bar under light text and lightens it
       under dark text, so the text only gains contrast; held words dim to --level-dim. */
    --level-empty: rgb(0 0 0 / 0.35);
    --level-dim: 0.75;
    color: var(--color-ink);
    display: flex;
    flex-direction: column;
  }
  /* Pinned: the timeline fills its box; the block keeps its height, the rows take the rest and
     scroll in it. */
  .tl.pinned {
    height: 100%;
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
  /* Never sticky: the rows' box starts under it, so no row passes beneath it. Its end padding is
     the rows' scrollbar, so both lane columns are the same width. */
  .pin {
    flex: none;
    position: relative;
    padding-inline-end: var(--tl-gutter, 0px);
    background: var(--color-surface);
  }
  /* Pinned, the rows scroll in their own box; 4 px of scroll padding keep a 20 px bar scrolled to
     the top clear of the chart by its 24 px target (WCAG 2.2 2.5.8). */
  .tl.pinned .rows {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
    scroll-padding-top: 4px;
  }
  .rows-grid {
    position: relative;
    min-height: 100%;
  }
  /* The playhead line, in two segments at the same x: one through the pinned block from the
     chart's row down (the ruler's thumb marks the day above it), one through every row. An
     absolutely placed grid child takes its grid area as its containing block; the row end left
     auto reaches the grid's bottom edge. */
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
  /* In the rows and the kind sheet the line runs through every lane, from the first row. */
  .sheet .grid {
    position: relative;
  }
  .rows-grid .line,
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
  /* Below md the label column (92 px) has no room for a name beside the count and "+", so in the
     rows and the kind sheet every row's label is a line of its own across both columns, and its
     lane sits on the next line in the lane column (column 1 empty): the lanes keep the ruler's
     width and x scale. The name line rides over the playhead line (z-index 2, an opaque surface),
     so the line passes under the words. A lane that never holds anything (the world heading's) is
     not drawn. From md nothing changes (there the rows share out a tall box's spare height, as
     before). */
  @media (max-width: 767.98px) {
    /* The lines pack at the top of a tall box rather than share out its spare height. */
    .rows-grid {
      align-content: start;
    }
    .rows-grid :global(.lab),
    .sheet :global(.lab) {
      grid-column: 1 / -1;
      position: relative;
      z-index: 2;
      min-height: 24px;
      border-bottom: 0;
      background: var(--color-surface);
    }
    .rows-grid :global([data-testid='tl-lane']),
    .sheet :global([data-testid='tl-lane']) {
      grid-column: 2;
    }
    .world > :global([data-testid='tl-lane']) {
      display: none;
    }
  }
  @media (max-width: 767.98px) and (prefers-color-scheme: dark) {
    .rows-grid :global(.lab),
    .sheet :global(.lab) {
      background: var(--color-surface-dark);
    }
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
    min-height: 24px;
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
      --level-empty: rgb(255 255 255 / 0.35);
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
