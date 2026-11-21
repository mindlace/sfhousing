<!--
  Details on /sim (was Results): the numbers behind the headline at the playhead's month. It draws
  no chart of its own: its Chart switch (`lens`, bound) picks what the one timeline chart plots.
  Order: the heading (with Activity in its row), the switch, the goal rows, what the policy added (the protection line kept),
  the homes by source, the stopped line, public money, who the homes are for, the year table
  (stopping at the playhead's month), then one link, "How this is worked out", into About's
  assumptions (on /sim it opens About over the map; docs/dev/about.md). Unmounting puts the chart
  back on Homes: the chart at rest always means one thing. Every id is per instance.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { count } from '$lib/sim-page/brush-summary';
  import { comparisonLine, scoreCopy, type ScoreCopy } from '$lib/sim-page/policy';
  import type { LeverCapacity } from '$lib/sim/levers/resolve';
  import { formatCount } from '$lib/scoreboard';
  import type { TimelineScore } from '$lib/sim/protocol';
  import type { TimelineView } from '$lib/sim/world/score/types';
  import { GOAL, goalRows, goalTrackMax, type Goal } from '$lib/goal/goal';
  import GoalRow from '$lib/goal/GoalRow.svelte';
  import type { Day } from '$lib/timelapse/time';
  import { formatMonthYear } from '$lib/fzp/format';
  import { utcParts } from '$lib/fzp/time';
  import MoneyResults from '$lib/fzp/MoneyResults.svelte';
  import { resolveTerms } from '$lib/sim/finance';
  import type { ResolvedTerms } from '$lib/timelapse/types';
  import { CALCULATING, builtTowardGoalText } from '$lib/fzp/score-view';
  import type { ScoreAt } from '$lib/fzp/types';
  import type { ChartLens } from './chart-lens';
  import { LENS_NAME, TWIN_NOTE, capacityNote } from './copy';
  import { YEAR_COLUMNS, yearRows } from './details';
  import Explain from './Explain.svelte';
  import { BUTTON, TARGET } from '$lib/shell/ui';
  import { ABOUT_ID, WORKED_OUT } from '$lib/about/copy';
  import type { PlayheadAt } from './results';

  interface Props {
    score: TimelineScore | null;
    /** `null` exactly when `score` is. */
    at: ScoreAt | null;
    /** The view `score` is built from (`null` exactly when `score` is): goal rows and the table. */
    view: TimelineView | null;
    /** The header's playhead (`playheadAt`): the goal rows and the table read its month. */
    playhead: PlayheadAt;
    /** The month of the furthest date reached (TODAY before any): the deadline preview waits
     *  for it. */
    reachedMonth: number;
    asOf: Day;
    /** Who the plan effect is for: the current-law copy by default. */
    copy?: ScoreCopy;
    /** The current levers' capacity: the protection line reads it. */
    capacity?: LeverCapacity | null;
    /** The numbers on show are from before the latest policy change. */
    stale?: boolean;
    /** A revision is pending: the money and tier blocks carry aria-busy (4.11). */
    pending?: boolean;
    /** The resolved market terms of the shown levers: the lost-grants line reads `lossOnExit`. */
    terms?: ResolvedTerms;
    /** Ids of the pools whose `Pool.uncapped` is true (baseline and levers): "no limit" (4.11). */
    uncapped?: ReadonlySet<string>;
    /**
     * A policy is in force in the document the numbers on show came from (the chart's own
     * `inForce`): "From your policy" is offered only then, and the table gets its column.
     */
    inForce?: boolean;
    /** What the timeline chart plots (bound): Details switches it. */
    lens?: ChartLens;
    /** Test seam: the goal the rows read, as the page's (TimelineMode's `goal`). */
    goal?: Goal;
    /** Shows Activity in the column: the heading row's button (none without it). */
    onactivity?: () => void;
  }
  let {
    score,
    at,
    view,
    playhead,
    reachedMonth,
    asOf,
    copy = scoreCopy(null),
    capacity = null,
    stale = false,
    pending = false,
    terms = resolveTerms(),
    uncapped = new Set(),
    inForce = false,
    lens = $bindable<ChartLens>('homes'),
    goal = GOAL,
    onactivity = undefined
  }: Props = $props();

  const uid = $props.id();
  /** The lenses offered: "From your policy" only while a policy is in force. */
  const lenses = $derived<ChartLens[]>(
    inForce ? ['homes', 'source', 'effect'] : ['homes', 'source']
  );
  // A choice no longer offered goes back to Homes, so a radio is always checked and a policy added
  // later does not switch the chart unasked.
  $effect.pre(() => {
    if (!lenses.includes(lens)) lens = 'homes';
  });
  // Closing Details puts the chart back on Homes.
  onDestroy(() => {
    lens = 'homes';
  });

  /**
   * What the protections cost in zoned capacity, or null with no protected lots. The resolver
   * guarantees `withoutProtections >= plan`.
   */
  const protectionLine = $derived.by(() => {
    if (!capacity || capacity.protectedLots <= 0) return null;
    const lots = count(capacity.protectedLots, 'lot', 'lots');
    const fewer = count(capacity.withoutProtections - capacity.plan, 'fewer home', 'fewer homes');
    return { lots, fewer };
  });

  /** The year of the window's last month: the capacity figure's note names it. */
  const lastYear = $derived(score ? utcParts(score.months[score.months.length - 1]).y : 0);

  /**
   * The goal rows at the header's playhead under its rule (TODAY at today, then the playhead's
   * month up to the deadline's, held there after), dated; empty while the month is not filled.
   */
  const rows = $derived(view ? (goalRows(goal, view, playhead, reachedMonth) ?? []) : []);
  /** The rows' shared track. */
  const max = $derived(goalTrackMax(rows));
  const planPending = $derived(at !== null && at.planCompleted === null);
  /** The year table: nothing at today (no month has ended), else up to the playhead's month. */
  const years = $derived(view && !playhead.atToday ? yearRows(view, playhead.index, inForce) : []);
  const columns = $derived(inForce ? YEAR_COLUMNS : YEAR_COLUMNS.slice(0, -1));
  const signed = (n: number) => `${n < 0 ? '' : '+'}${formatCount(n)}`;
  const CHOICE_LABEL = 'inline-flex min-h-6 min-w-6 cursor-pointer items-center gap-2 pr-2 text-sm';
</script>

{#snippet staleLine()}
  {#if stale}
    <p class="mt-2 text-sm font-semibold" data-testid="fzp-score-stale">
      These numbers are from before your latest policy change.
    </p>
  {/if}
{/snippet}

<div class="text-ink dark:text-ink-dark">
  <div class="flex items-center justify-between gap-2">
    <h2 class="text-base font-semibold">Details</h2>
    {#if onactivity}
      <button type="button" class={BUTTON} onclick={onactivity}>Activity</button>
    {/if}
  </div>
  {#if !score || !at}
    {@render staleLine()}
    <p class="mt-3 text-sm text-ink-muted dark:text-ink-dark-muted">Loading the simulation…</p>
  {:else}
    {@render staleLine()}

    <fieldset class="mt-3" data-testid="tl-lens">
      <legend class="text-sm font-semibold">Chart</legend>
      <div class="flex flex-wrap gap-x-3">
        {#each lenses as l (l)}
          <label class={CHOICE_LABEL}>
            <input
              type="radio"
              name="{uid}-lens"
              value={l}
              bind:group={lens}
              class="size-4 accent-accent dark:accent-accent-dark"
            />
            {LENS_NAME[l]}
          </label>
        {/each}
      </div>
    </fieldset>

    <div class="mt-4">
      <p class="text-sm" data-testid="fzp-built">{builtTowardGoalText(score.baseline)}</p>
      {#each rows as row, k (row.id)}
        <GoalRow {row} {max} primary={k === 0} />
      {/each}
    </div>

    <section class="mt-4" aria-busy={planPending ? 'true' : undefined}>
      <h3 class="text-sm font-semibold">
        <Explain text={TWIN_NOTE}>What {copy.plan} added</Explain>
      </h3>
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

    <dl class="mt-4 space-y-1 text-sm" data-testid="tl-sources-of-homes">
      <div class="flex justify-between gap-3">
        <dt>From today's pipeline</dt>
        <dd class="tabular-nums">{formatCount(at.pipeline)}</dd>
      </div>
      <div class="flex justify-between gap-3">
        <dt>New projects</dt>
        <dd class="tabular-nums">{formatCount(at.fresh)}</dd>
      </div>
    </dl>

    <p class="mt-3 text-sm">
      Proposed homes in projects that stopped since {formatMonthYear(asOf)}:
      <span class="tabular-nums">{formatCount(at.exitedUnits)}</span>
    </p>

    <!-- At today nothing is spent or finished yet: no money or tier block, as no table. -->
    {#if !playhead.atToday}
      <MoneyResults
        {score}
        i={at.monthIndex}
        at={score.months[at.monthIndex]}
        {terms}
        {pending}
        {uncapped}
        part="money"
      />

      <MoneyResults
        {score}
        i={at.monthIndex}
        at={score.months[at.monthIndex]}
        {terms}
        {pending}
        part="tiers"
      />
    {/if}

    {#if years.length > 0}
      <details class="mt-4" data-testid="tl-year-table">
        <summary class="min-h-6 min-w-6 cursor-pointer text-sm font-semibold">Show as table</summary
        >
        <!-- A scrollable region must be keyboard reachable (axe: scrollable-region-focusable). -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="mt-2 overflow-x-auto" role="region" aria-labelledby="{uid}-years" tabindex="0">
          <table class="w-full text-left text-xs tabular-nums">
            <caption
              id="{uid}-years"
              class="text-left text-xs text-ink-muted dark:text-ink-dark-muted"
              >Running total from today, by year</caption
            >
            <thead>
              <tr>
                {#each columns as c (c)}
                  <th scope="col" class="px-1 py-1 align-bottom font-semibold">{c}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each years as r (r.index)}
                <tr class="border-t border-line dark:border-line-dark">
                  <th scope="row" class="px-1 py-1 font-normal whitespace-nowrap">{r.label}</th>
                  <td class="px-1 py-1">{formatCount(r.homes)}</td>
                  <td class="px-1 py-1">{formatCount(r.pipeline)}</td>
                  <td class="px-1 py-1">{formatCount(r.fresh)}</td>
                  {#if r.effect !== null}
                    <td class="px-1 py-1">{signed(r.effect)}</td>
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </details>
    {/if}
  {/if}

  <p class="mt-4 text-sm">
    <a
      class="{TARGET} inline-flex items-center font-semibold underline"
      href="/about#{ABOUT_ID.assumptions}"
      data-testid="details-about">{WORKED_OUT}</a
    >
  </p>
</div>
