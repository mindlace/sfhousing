<!--
  The scoreboard's contents at one month (spec §4.5, items 1-13): the dock's Results face on /sim.
  The headline and what the plan did come first, the sources and method fold into one closed
  disclosure at the end. Every id is per instance.
-->
<script lang="ts">
  import { timelineTokenCss } from '$lib/map/palette';
  import { count } from '$lib/sim-page/brush-summary';
  import { comparisonLine, scoreCopy, type ScoreCopy } from '$lib/sim-page/policy';
  import type { LeverCapacity } from '$lib/sim/levers/resolve';
  import { formatBuiltDate, formatCount, formatPercent, trackMax } from '$lib/scoreboard';
  import TargetRow from '$lib/scoreboard/TargetRow.svelte';
  import type { TimelineScore } from '$lib/sim/protocol';
  import type { TimelineView } from '$lib/sim/world/score/types';
  import { GOAL, goalStep, readGoal } from '$lib/goal/goal';
  import type { Day } from '$lib/timelapse/time';
  import { formatDate, formatMonthYear } from './format';
  import { FORECAST_NOTE, TWIN_NOTE, capacityNote, marketBody } from '$lib/timeline/copy';
  import Explain from '$lib/timeline/Explain.svelte';
  import { monthIndex, utcParts } from './time';
  import MapKey from './MapKey.svelte';
  import MoneyResults from './MoneyResults.svelte';
  import { resolveTerms } from '$lib/sim/finance';
  import type { ResolvedTerms } from '$lib/timelapse/types';
  import ScoreChart from './ScoreChart.svelte';
  import {
    CALCULATING,
    builtTowardGoalText,
    inProgressRows,
    deadlineIndex,
    phasingFootnote
  } from './score-view';
  import type { ScoreAt } from './types';

  interface Props {
    score: TimelineScore | null;
    /** `null` exactly when `score` is. */
    at: ScoreAt | null;
    /** The view `score` is built from (`null` exactly when `score` is): the target rows read it. */
    view: TimelineView | null;
    day: Day;
    asOf: Day;
    horizon: Day;
    /** The last filled month's day: the Results chart's scale covers every filled month. */
    filledEnd: Day;
    /** The furthest day reached: the deadline line and the chart's lines stop here. */
    reached: Day;
    datasetVersion: string;
    builtAt: string;
    onsources: () => void;
    /** Who the plan effect is for (/sim): the current-law copy by default. */
    copy?: ScoreCopy;
    /** The current levers' capacity (/sim): the protection line (plan 3, Task 10) reads it. */
    capacity?: LeverCapacity | null;
    /** The latest levers failed to apply (/sim): the numbers are from the policy before them. */
    stale?: boolean;
    /** Today's market, in words (spec 4.11); `null` renders nothing. */
    market?: string | null;
    /** A revision is pending (/sim): the money and tier blocks carry aria-busy (4.11). */
    pending?: boolean;
    /** The resolved market terms of the shown levers: the lost-grants line reads `lossOnExit`. */
    terms?: ResolvedTerms;
    /** Ids of the pools whose `Pool.uncapped` is true (baseline and levers): "no limit" (4.11). */
    uncapped?: ReadonlySet<string>;
  }
  let {
    score,
    at,
    view,
    day,
    asOf,
    horizon,
    filledEnd,
    reached,
    datasetVersion,
    builtAt,
    onsources,
    copy = scoreCopy(null),
    capacity = null,
    stale = false,
    market = null,
    pending = false,
    terms = resolveTerms(),
    uncapped = new Set()
  }: Props = $props();

  /**
   * What the protections cost in zoned capacity (/sim), or null with no protected lots. The
   * resolver guarantees `withoutProtections >= plan`.
   */
  const protectionLine = $derived.by(() => {
    if (!capacity || capacity.protectedLots <= 0) return null;
    const lots = count(capacity.protectedLots, 'lot', 'lots');
    const fewer = count(capacity.withoutProtections - capacity.plan, 'fewer home', 'fewer homes');
    return { lots, fewer };
  });

  /** The year of the window's last month: the capacity figure's note names it. */
  const lastYear = $derived(score ? utcParts(score.months[score.months.length - 1]).y : 0);

  const WIDE = '(min-width: 768px)';

  /** The goal's deadline month in the view: null when it falls outside the window. */
  const deadline = $derived(view ? (goalStep(GOAL, view)?.deadlineIndex ?? null) : null);
  /**
   * The target rows at the playhead's month up to the goal's deadline, then held at the deadline
   * month, as the header's goal part is. The goal's own row is `readGoal`'s figure.
   */
  const rows = $derived.by(() => {
    if (!at || !view) return [];
    const i = at.monthIndex;
    const held = deadline === null ? i : Math.min(i, deadline);
    const net = GOAL.measure.valueAt(view, held);
    const goal = readGoal(GOAL, view, i);
    return view.targets.map((t, k) => ({
      tp: {
        target: t.target,
        fraction: k === 0 && goal ? goal.fraction : t.fraction[held]
      },
      net,
      atDeadline: at.targets[k].atDeadline,
      // Past the deadline the row's own figure is the deadline's: the line would repeat it.
      deadlineLine: deadline === null || i < deadline
    }));
  });
  const max = $derived(rows.length > 0 ? trackMax(rows.map((r) => r.tp)) : 1);
  const stages = $derived(score && at ? inProgressRows(score.shown[at.monthIndex].inProgress) : []);
  const inProgressTotal = $derived(stages.reduce((sum, s) => sum + s.units, 0));
  const phasing = $derived(score ? phasingFootnote(score.phasing) : null);
  const planPending = $derived(at !== null && at.planCompleted === null);
  /** The month index of the furthest day reached: nothing after it is revealed. */
  const reveal = $derived(score ? monthIndex(reached, score.months[0], score.months.length) : -1);

  /** The map key opens by default on a wide viewport (the sheet on a phone starts closed). */
  const keyOpen = typeof matchMedia === 'function' && matchMedia(WIDE).matches;
</script>

<svelte:head>
  <!-- The legend sits outside SimMap, so it cannot inherit SimMap's --map-* variables. -->
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- constant CSS built from palette TOKENS -->
  {@html '<style>' + timelineTokenCss('.sfh-fzp-legend') + '</style>'}
</svelte:head>

{#snippet staleLine()}
  {#if stale}
    <p class="mt-2 text-sm font-semibold" data-testid="fzp-score-stale">
      These numbers are from before your latest policy change.
    </p>
  {/if}
{/snippet}

<div class="text-ink dark:text-ink-dark">
  {#if !score || !at}
    {@render staleLine()}
    <p class="mt-3 text-sm text-ink-muted dark:text-ink-dark-muted">Loading the simulation…</p>
  {:else}
    {@render staleLine()}

    <section class="mt-4" aria-busy={planPending ? 'true' : undefined}>
      <h2 class="text-sm font-semibold">
        <Explain text={TWIN_NOTE}>What {copy.plan} added</Explain>
      </h2>
      <p class="mt-1 text-sm text-ink-muted dark:text-ink-dark-muted">
        {comparisonLine(copy, at.planCompleted)}
      </p>
      <dl class="mt-1 space-y-1 text-sm">
        <div class="flex justify-between gap-3">
          <dt>Homes completed because of {copy.plan}</dt>
          <dd class="tabular-nums">
            {at.planCompleted === null ? CALCULATING : formatCount(at.planCompleted)}
          </dd>
        </div>
      </dl>
      <dl class="mt-1 text-sm">
        <div class="flex justify-between gap-3">
          <dt>Homes approved because of {copy.plan}</dt>
          <dd class="tabular-nums">
            {at.planEntitled === null ? CALCULATING : formatCount(at.planEntitled)}
          </dd>
        </div>
      </dl>
      {#if protectionLine}
        <!-- Not live: the numbers change with every lever change (spec: no aria-live). -->
        <p class="mt-2 text-sm text-ink-muted tabular-nums dark:text-ink-dark-muted">
          {protectionLine.lots} protected:
          <Explain text={capacityNote(lastYear)}>{protectionLine.fewer}</Explain>
          of zoned capacity
        </p>
      {/if}
    </section>

    <MoneyResults
      {score}
      i={at.monthIndex}
      at={score.months[at.monthIndex]}
      {terms}
      {pending}
      {uncapped}
      part="money"
    />

    <ScoreChart {score} {asOf} {horizon} {day} highWater={filledEnd} {reached} />

    <div class="mt-4">
      <p class="text-sm" data-testid="fzp-built">{builtTowardGoalText(score.baseline)}</p>
      {#each rows as t, k (t.tp.target.id)}
        <TargetRow tp={t.tp} net={t.net} {max} primary={k === 0} />
        {#if t.deadlineLine && reveal >= deadlineIndex(score, score.targets[k].deadline)}
          <p class="text-sm text-ink-muted dark:text-ink-dark-muted">
            At the deadline ({formatDate(score.targets[k].deadline)}): {formatPercent(t.atDeadline)}
          </p>
        {/if}
      {/each}
    </div>

    <MoneyResults
      {score}
      i={at.monthIndex}
      at={score.months[at.monthIndex]}
      {terms}
      {pending}
      part="tiers"
    />

    <dl class="mt-4 space-y-1 text-sm">
      <div class="flex justify-between gap-3">
        <dt>Simulated, from today's pipeline</dt>
        <dd class="tabular-nums">{formatCount(at.pipeline)}</dd>
      </div>
      <div class="flex justify-between gap-3">
        <dt>Simulated, new projects not yet in today's pipeline</dt>
        <dd class="tabular-nums">{formatCount(at.fresh)}</dd>
      </div>
    </dl>

    <p class="mt-3 text-sm">
      Homes in projects still in progress: <span class="tabular-nums"
        >{formatCount(inProgressTotal)}</span
      >
    </p>
    <dl
      class="mt-1 space-y-0.5 text-sm text-ink-muted dark:text-ink-dark-muted"
      data-testid="fzp-stages"
    >
      {#each stages as s (s.stage)}
        <div class="flex justify-between gap-3">
          <dt>{s.label}</dt>
          <dd class="tabular-nums">{formatCount(s.units)}</dd>
        </div>
      {/each}
    </dl>

    <p class="mt-3 text-sm">
      Proposed homes in projects that stopped since {formatMonthYear(asOf)}:
      <span class="tabular-nums">{formatCount(at.exitedUnits)}</span>
    </p>

    <details class="mt-4" data-testid="fzp-sources">
      <summary class="min-h-6 cursor-pointer text-sm font-semibold pointer-coarse:min-h-11"
        >Sources</summary
      >
      {#if copy.compare === 'preFzp'}
        <p class="mt-2 text-sm text-ink-muted dark:text-ink-dark-muted">
          {FORECAST_NOTE}
        </p>
      {/if}
      {#if market}
        <p class="mt-2 text-sm text-ink-muted dark:text-ink-dark-muted" data-testid="fzp-market">
          {marketBody(market)}
        </p>
      {/if}
      <MapKey open={keyOpen} />

      <button
        type="button"
        class="mt-2 min-h-11 rounded-md px-1 text-left text-sm font-semibold underline"
        onclick={() => onsources()}>Where these numbers come from</button
      >

      <p class="mt-3 text-xs text-ink-muted dark:text-ink-dark-muted">
        Data {datasetVersion} · built {formatBuiltDate(builtAt)} · as of {formatDate(asOf)} ·
        <a
          class="inline-flex min-h-6 items-center underline pointer-coarse:min-h-11"
          href="/attribution">Data sources</a
        >
      </p>
      {#if phasing}
        <p class="mt-1 text-xs text-ink-muted dark:text-ink-dark-muted">{phasing}</p>
      {/if}
    </details>
  {/if}
</div>
