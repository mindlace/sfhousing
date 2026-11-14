<!--
  When (rules 10, 11): a policy's spans, each "{start date} to {end date | no end}" (`spanEdgeText`,
  the end inclusive). The
  selected span gets month and year selects for its start and end ("No end" is the end year's
  first option); a choice snaps to the model month whose first (or last) day falls in, or next
  after, the chosen calendar month, clamped by the neighbours and the window. Add span (from the
  playhead's month), Split at playhead and Remove span (never the only one) act on the policy and
  the selected span. Read-only: the spans as text.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
  import { monthFirstDay, monthLastDay } from '$lib/sim/world/months';
  import type { Day } from '$lib/timelapse/time';
  import type { PolicyKind, SimPolicy4, Span } from './policy4';
  import { spanEdgeText } from './rows';
  import {
    addSpan,
    policyOf,
    removeSpan,
    setFrom,
    setTo,
    spanMonths,
    splitSpan,
    type TimelineWindow
  } from './spans';

  interface Props {
    doc: SimPolicy4;
    kind: PolicyKind;
    id: string;
    /** The selected span's index. */
    span: number;
    asOf: Day;
    /** The playhead's model month (Add span and Split start there). */
    playheadMonth: number;
    readonly: boolean;
    onspan(i: number): void;
    /** One store change; `span` is the span to select after it. */
    onedit(change: (d: SimPolicy4) => SimPolicy4, label: string, span?: number): void;
  }

  let { doc, kind, id, span, asOf, playheadMonth, readonly, onspan, onedit }: Props = $props();

  const uid = $props.id();
  const w = $derived<TimelineWindow>({ asOf, months: WINDOW_MONTHS });
  const policy = $derived(policyOf(doc, kind, id));
  const spans = $derived(policy?.spans ?? []);
  const cur = $derived<Span | undefined>(spans[span]);
  const ref = $derived({ kind, id, span });

  const MONTHS = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2000, i, 1))
    )
  );
  const ym = (d: Day) => {
    const t = new Date(d * 86_400_000);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 };
  };
  const edgeDay = (edge: 'from' | 'to', m: number): Day =>
    edge === 'from' ? monthFirstDay(asOf, m) : monthLastDay(asOf, m);

  /** The first model month whose edge day is in or after calendar month (y, mo); else the last. */
  function monthAt(edge: 'from' | 'to', y: number, mo: number): number {
    const want = y * 12 + mo;
    for (let m = 1; m <= WINDOW_MONTHS; m++) {
      const p = ym(edgeDay(edge, m));
      if (p.y * 12 + p.m >= want) return m;
    }
    return WINDOW_MONTHS;
  }

  const years = $derived.by(() => {
    const a = ym(monthFirstDay(asOf, 1)).y;
    const b = ym(monthLastDay(asOf, WINDOW_MONTHS)).y;
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  });

  const edgeText = (s: Span) => {
    const t = spanEdgeText(s, asOf);
    return { fromText: t.from, toText: t.to };
  };

  /** The months shown: the span's own, snapped as spanMonths reads them. */
  const shown = (s: Span) => {
    const m = spanMonths(s, asOf);
    return {
      from: ym(monthFirstDay(asOf, m.from)),
      to: m.to === null ? null : ym(monthLastDay(asOf, m.to)),
      ...edgeText(s)
    };
  };
  const view = $derived(cur ? shown(cur) : null);
  const curMonths = $derived(cur ? spanMonths(cur, asOf) : null);
  const canSplit = $derived(
    curMonths !== null &&
      playheadMonth > curMonths.from &&
      playheadMonth <= (curMonths.to ?? WINDOW_MONTHS)
  );

  let fromMonthEl = $state<HTMLSelectElement>();
  let fromYearEl = $state<HTMLSelectElement>();
  let toMonthEl = $state<HTMLSelectElement>();
  let toYearEl = $state<HTMLSelectElement>();

  /** After a change that was clamped (or refused), the selects show what the span holds. */
  async function resync(): Promise<void> {
    await tick();
    if (!view) return;
    if (fromMonthEl) fromMonthEl.value = String(view.from.m);
    if (fromYearEl) fromYearEl.value = String(view.from.y);
    if (toYearEl) toYearEl.value = view.to === null ? '' : String(view.to.y);
    if (toMonthEl) toMonthEl.value = String((view.to ?? view.from).m);
  }

  const label = $derived(policy?.label ?? '');

  function changeFrom(y: number, mo: number): void {
    const m = monthAt('from', y, mo);
    onedit((d) => setFrom(d, ref, m, w), `Changed start: ${label}`);
    void resync();
  }

  function changeTo(y: number | null, mo: number): void {
    const m = y === null ? null : monthAt('to', y, mo);
    onedit((d) => setTo(d, ref, m, w), `Changed end: ${label}`);
    void resync();
  }

  function add(): void {
    const r = addSpan(doc, kind, id, playheadMonth, w);
    if (r.span < 0) return;
    onedit(() => r.doc, `Added span: ${label}`, r.span);
  }

  function split(): void {
    if (!canSplit) return;
    onedit((d) => splitSpan(d, ref, playheadMonth, w), `Split: ${label}`, span + 1);
  }

  function remove(): void {
    if (spans.length < 2) return;
    onedit((d) => removeSpan(d, ref), `Removed span: ${label}`, Math.max(0, span - 1));
  }

  const select =
    'min-h-6 rounded-md border border-control-line bg-surface px-1 text-ink disabled:opacity-40 dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark pointer-coarse:min-h-11';
  const btn =
    'min-h-6 min-w-6 rounded-md border border-control-line px-2 font-semibold text-ink hover:bg-surface-raised aria-disabled:opacity-40 dark:border-control-line-dark dark:text-ink-dark dark:hover:bg-surface-dark-raised pointer-coarse:min-h-11';
</script>

<section aria-labelledby="{uid}-h" class="flex flex-col gap-2 text-sm text-ink dark:text-ink-dark">
  <h3 id="{uid}-h" class="font-semibold">When</h3>
  <ul class="flex flex-col gap-1">
    {#each spans as s, i (i)}
      {@const v = shown(s)}
      <li>
        {#if readonly}
          <span aria-current={i === span ? 'true' : undefined} class:font-semibold={i === span}
            >{v.fromText} to {v.toText}</span
          >
        {:else}
          <button
            type="button"
            aria-pressed={i === span}
            class="min-h-6 rounded-md px-1 text-left tabular-nums hover:bg-surface-raised aria-pressed:bg-accent-tint aria-pressed:font-semibold dark:hover:bg-surface-dark-raised dark:aria-pressed:bg-accent-dark/30 pointer-coarse:min-h-11"
            onclick={() => onspan(i)}>{v.fromText} to {v.toText}</button
          >
        {/if}
      </li>
    {/each}
  </ul>

  {#if !readonly && view}
    <div class="flex flex-col gap-2">
      <fieldset class="flex flex-wrap items-center gap-1">
        <legend class="sr-only">From</legend>
        <span aria-hidden="true" class="w-10">From</span>
        <select
          bind:this={fromMonthEl}
          aria-label="From month"
          class={select}
          value={String(view.from.m)}
          onchange={(e) => changeFrom(view.from.y, Number(e.currentTarget.value))}
        >
          {#each MONTHS as name, i (i)}
            <option value={String(i + 1)}>{name}</option>
          {/each}
        </select>
        <select
          bind:this={fromYearEl}
          aria-label="From year"
          class={select}
          value={String(view.from.y)}
          onchange={(e) => changeFrom(Number(e.currentTarget.value), view.from.m)}
        >
          {#each years as y (y)}
            <option value={String(y)}>{y}</option>
          {/each}
        </select>
      </fieldset>
      <fieldset class="flex flex-wrap items-center gap-1">
        <legend class="sr-only">To</legend>
        <span aria-hidden="true" class="w-10">To</span>
        <select
          bind:this={toMonthEl}
          aria-label="To month"
          class={select}
          disabled={view.to === null}
          value={String((view.to ?? view.from).m)}
          onchange={(e) => changeTo(view.to?.y ?? view.from.y, Number(e.currentTarget.value))}
        >
          {#each MONTHS as name, i (i)}
            <option value={String(i + 1)}>{name}</option>
          {/each}
        </select>
        <select
          bind:this={toYearEl}
          aria-label="To year"
          class={select}
          value={view.to === null ? '' : String(view.to.y)}
          onchange={(e) => {
            const v = e.currentTarget.value;
            changeTo(v === '' ? null : Number(v), (view.to ?? view.from).m);
          }}
        >
          <option value="">No end</option>
          {#each years as y (y)}
            <option value={String(y)}>{y}</option>
          {/each}
        </select>
      </fieldset>
      <div class="flex flex-wrap gap-2">
        <button type="button" class={btn} onclick={add}>Add span</button>
        <!-- aria-disabled: a press that disables its own button keeps focus (2.4.3). -->
        <button
          type="button"
          class={btn}
          aria-disabled={canSplit ? undefined : 'true'}
          onclick={split}>Split at playhead</button
        >
        <button
          type="button"
          class={btn}
          aria-disabled={spans.length < 2 ? 'true' : undefined}
          onclick={remove}>Remove span</button
        >
      </div>
    </div>
  {/if}
</section>
