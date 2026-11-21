<!--
  One span's bar on an open policy's row (rules 6, 11): a focusable button carrying the span's short
  setting. Enter or click selects it; Arrow keys move the nearer edge (Shift: twelve months; Alt: the
  whole span) through `onedit`. Dragging an edge snaps to months and commits one `onedit` on
  pointer-up. Read-only: no keys, no edges. An open end fades at the right edge.
-->
<script lang="ts">
  import type { Day } from '$lib/timelapse/time';
  import { monthFirstDay, monthLastDay, monthOfDay } from '$lib/sim/world/months';
  import type { PolicyKind, SimPolicy4, Span } from './policy4';
  import { barBox, barLabel, settingOf } from './rows';
  import { barKey, moveEdge, moveSpan, setFrom, setTo, spanMonths, type SpanRef } from './spans';
  import LevelFill from './LevelFill.svelte';
  import { levelIndexAt, levelLeft, type LevelSet } from './pool-level';

  interface Props {
    kind: PolicyKind;
    policyId: string;
    policyLabel: string;
    index: number;
    span: Span;
    asOf: Day;
    windowEnd: Day;
    months: number;
    playheadMonth: number;
    selected: boolean;
    off: boolean;
    readonly: boolean;
    onselect: (ref: SpanRef) => void;
    onedit: (change: (p: SimPolicy4) => SimPolicy4, label: string) => void;
    /** A fund policy's own pool level (`LevelSet.byPolicy`); null for none. */
    level?: Float64Array | null;
    /** The set `level` is from: its months and dataset date. */
    levels?: LevelSet | null;
    /** The playhead's day and the furthest day reached: the level's two zones. */
    day?: Day;
    reached?: Day;
    /** The level is held numbers: it and its words dim. */
    stale?: boolean;
  }

  let {
    kind,
    policyId,
    policyLabel,
    index,
    span,
    asOf,
    windowEnd,
    months,
    playheadMonth,
    selected,
    off,
    readonly,
    onselect,
    onedit,
    level = null,
    levels = null,
    day = asOf,
    reached = day,
    stale = false
  }: Props = $props();

  const ref = $derived<SpanRef>({ kind, id: policyId, span: index });
  const win = $derived({ asOf, months });
  const open = $derived(span.to === null);
  const editLabel = $derived(`Moved: ${policyLabel}`);

  // The edge being dragged and the month under the pointer.
  let drag: { edge: 'from' | 'to'; month: number } | null = $state(null);

  // The level: drawn on an on bar only, over the days its box spans (as `barBox` places it), and
  // hidden while an edge is dragged (the box then no longer matches the run's months).
  const shownLevel = $derived(!off && drag === null && levels !== null ? level : null);
  const boxFrom = $derived(Math.max(monthFirstDay(asOf, spanMonths(span, asOf).from), asOf));
  const boxTo = $derived.by(() => {
    const m = spanMonths(span, asOf);
    return m.to === null ? windowEnd : Math.min(monthLastDay(asOf, m.to), windowEnd);
  });
  const left = $derived(
    shownLevel && levels
      ? levelLeft(shownLevel, levelIndexAt(levels.months, levels.asOf, day, boxFrom, boxTo))
      : null
  );

  const box = $derived.by(() => {
    if (!drag) return barBox(span, asOf, windowEnd);
    const m = spanMonths(span, asOf);
    const from = drag.edge === 'from' ? Math.min(drag.month, m.to ?? drag.month) : m.from;
    const to = drag.edge === 'to' ? Math.max(drag.month, m.from) : m.to;
    return barBox(
      {
        ...span,
        from: monthFirstDay(asOf, from),
        to: to === null ? null : monthLastDay(asOf, to)
      },
      asOf,
      windowEnd
    );
  });

  function onkeydown(e: KeyboardEvent) {
    if (readonly || e.ctrlKey || e.metaKey) return;
    const k = barKey(e, span, playheadMonth, asOf);
    if (!k) return;
    e.preventDefault();
    onedit(
      (p) => (k.op === 'edge' ? moveEdge(p, ref, k.edge, k.by, win) : moveSpan(p, ref, k.by, win)),
      editLabel
    );
  }

  function monthAt(e: PointerEvent): number {
    const lane = (e.currentTarget as HTMLElement).closest('[data-testid=tl-lane]');
    const r = lane?.getBoundingClientRect();
    const f = r && r.width > 0 ? (e.clientX - r.left) / r.width : 0;
    const day = Math.round(asOf + Math.min(Math.max(f, 0), 1) * (windowEnd - asOf));
    return Math.max(1, monthOfDay(asOf, day));
  }

  function ondown(edge: 'from' | 'to', e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer has nothing to capture.
    }
    onselect(ref);
    drag = { edge, month: monthAt(e) };
  }
  function onmove(e: PointerEvent) {
    if (drag) drag = { ...drag, month: monthAt(e) };
  }
  function onup(e: PointerEvent) {
    if (!drag) return;
    const { edge } = drag;
    const month = monthAt(e);
    drag = null;
    const cur = spanMonths(span, asOf);
    if (month === (edge === 'from' ? cur.from : cur.to)) return;
    onedit(
      (p) => (edge === 'from' ? setFrom(p, ref, month, win) : setTo(p, ref, month, win)),
      editLabel
    );
  }
  const oncancel = () => (drag = null);
</script>

<div class="wrap absolute" style:left="{box.left}%" style:width="{box.width}%">
  <button
    type="button"
    class="bar k-{kind}"
    class:sel={selected}
    class:off
    class:open
    class:leveled={shownLevel !== null}
    class:stale={shownLevel !== null && stale}
    data-testid="tl-bar"
    data-open={open}
    aria-label={barLabel(policyLabel, span, asOf) + (off ? ', off' : '') + (left ?? '')}
    aria-pressed={selected}
    onclick={() => onselect(ref)}
    {onkeydown}
  >
    {#if shownLevel && levels}
      <LevelFill
        level={shownLevel}
        months={levels.months}
        asOf={levels.asOf}
        from={boxFrom}
        to={boxTo}
        {day}
        {reached}
        {stale}
      />
    {/if}
    <span class="txt"
      >{settingOf(span.what)}{#if left}<span class="left">{left}</span>{/if}</span
    >
  </button>
  {#if !readonly}
    <span
      class="edge from"
      data-edge="from"
      aria-hidden="true"
      onpointerdown={(e) => ondown('from', e)}
      onpointermove={onmove}
      onpointerup={onup}
      onpointercancel={oncancel}
    ></span>
    {#if !open}
      <span
        class="edge to"
        data-edge="to"
        aria-hidden="true"
        onpointerdown={(e) => ondown('to', e)}
        onpointermove={onmove}
        onpointerup={onup}
        onpointercancel={oncancel}
      ></span>
    {/if}
  {/if}
</div>

<style>
  .wrap {
    top: 5px;
    height: 20px;
  }
  .bar {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    padding: 0 6px;
    border-radius: 4px;
    border: 0;
    font-size: 11px;
    line-height: 20px;
    color: var(--on-k, #fff);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    cursor: pointer;
    background: var(--k);
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
  .bar.open {
    border-radius: 4px 0 0 4px;
    -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 26px), transparent);
    mask-image: linear-gradient(90deg, #000 calc(100% - 26px), transparent);
  }
  /* Off: no whole-element fade (it would lighten the ground under white text). */
  .bar.off {
    background: var(--color-surface-raised);
    color: var(--color-ink-muted);
    box-shadow: inset 0 0 0 2px var(--k);
  }
  .bar.sel {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }
  .bar:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .edge {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 8px;
    cursor: ew-resize;
    touch-action: none;
  }
  .edge.from {
    left: -4px;
  }
  .edge.to {
    right: -4px;
  }
  @media (prefers-color-scheme: dark) {
    .bar.off {
      background: var(--color-surface-dark-raised);
      color: var(--color-ink-dark-muted);
    }
    .bar.sel,
    .bar:focus-visible {
      outline-color: var(--color-accent-dark);
    }
  }
</style>
