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
  import type { Day } from '$lib/timelapse/time';
  import { formatDate, formatMonthYear } from './format';
  import MapKey from './MapKey.svelte';
  import ScoreChart from './ScoreChart.svelte';
  import {
    CALCULATING,
    bandLine,
    builtByTodayText,
    inProgressRows,
    phasingFootnote,
    planBandLine,
    sinceText
  } from './score-view';
  import type { ScoreAt } from './types';

  interface Props {
    score: TimelineScore | null;
    /** `null` exactly when `score` is. */
    at: ScoreAt | null;
    day: Day;
    asOf: Day;
    horizon: Day;
    bandRuns: number;
    bandRunsTotal: number;
    seed: number | null;
    representative: boolean;
    /** False while a reroll is in flight or the worker has stopped ('Another future' too). */
    canReroll: boolean;
    datasetVersion: string;
    builtAt: string;
    onrepresentative: () => void;
    onsources: () => void;
    /** Who the plan effect is for (/sim): the Family Zoning Plan copy by default. */
    copy?: ScoreCopy;
    /** The current levers' capacity (/sim): the protection line (plan 3, Task 10) reads it. */
    capacity?: LeverCapacity | null;
    /** The latest levers failed to apply (/sim): the numbers are from the policy before them. */
    stale?: boolean;
  }
  let {
    score,
    at,
    day,
    asOf,
    horizon,
    bandRuns,
    bandRunsTotal,
    seed,
    representative,
    canReroll,
    datasetVersion,
    builtAt,
    onrepresentative,
    onsources,
    copy = scoreCopy(null),
    capacity = null,
    stale = false
  }: Props = $props();

  /**
   * What the protections cost in zoned capacity (/sim), or null with no protected lots. The
   * resolver guarantees `withoutProtections >= plan`.
   */
  const protectionLine = $derived.by(() => {
    if (!capacity || capacity.protectedLots <= 0) return null;
    const lots = count(capacity.protectedLots, 'lot', 'lots');
    const fewer = count(capacity.withoutProtections - capacity.plan, 'fewer home', 'fewer homes');
    return `${lots} protected: ${fewer} of zoned capacity`;
  });

  /** "the plan" in the Family Zoning Plan copy (its text unchanged), else the copy's own name. */
  const short = $derived(copy.plan === 'the Family Zoning Plan' ? 'the plan' : copy.plan);

  const WIDE = '(min-width: 768px)';

  const provisional = $derived(bandRuns < bandRunsTotal);
  const band = $derived(score && at ? bandLine(score, at.monthIndex, provisional) : null);
  const planBand = $derived(score && at ? planBandLine(score, at.monthIndex, provisional) : null);
  const max = $derived(at ? trackMax(at.targets.map((t) => t.tp)) : 1);
  const stages = $derived(score && at ? inProgressRows(score.shown[at.monthIndex].inProgress) : []);
  const inProgressTotal = $derived(stages.reduce((sum, s) => sum + s.units, 0));
  const phasing = $derived(score ? phasingFootnote(score.phasing) : null);
  /** The headline's text after its count: "homes added since Jan 2021". */
  const sinceRest = $derived(
    score && at ? sinceText(score, at).slice(formatCount(at.total).length) : ''
  );
  const planPending = $derived(at !== null && at.planCompleted === null);

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
  {#if !score || !at || !band || !planBand}
    {@render staleLine()}
    <p class="mt-3 text-sm text-ink-muted dark:text-ink-dark-muted">Loading the simulation…</p>
  {:else}
    <p>
      <span data-testid="fzp-net" class="text-3xl font-bold tabular-nums"
        >{formatCount(at.total)}</span
      ><span class="text-base">{sinceRest}</span>
    </p>
    <p class="text-sm text-ink-muted dark:text-ink-dark-muted">{builtByTodayText(at)}</p>
    {@render staleLine()}

    <section class="mt-4" aria-busy={planPending ? 'true' : undefined}>
      <h2 class="text-sm font-semibold">What {short} added</h2>
      <p class="mt-1 text-sm text-ink-muted dark:text-ink-dark-muted">
        {comparisonLine(copy, at.planCompleted)}
      </p>
      <dl class="mt-1 space-y-1 text-sm">
        <div class="flex justify-between gap-3">
          <dt>Homes completed because of {short}</dt>
          <dd class="tabular-nums">
            {at.planCompleted === null ? CALCULATING : formatCount(at.planCompleted)}
          </dd>
        </div>
      </dl>
      <p
        class="text-sm text-ink-muted dark:text-ink-dark-muted"
        aria-busy={planBand.busy ? 'true' : undefined}
      >
        {planBand.text}
      </p>
      <dl class="mt-1 text-sm">
        <div class="flex justify-between gap-3">
          <dt>Homes approved because of {short}</dt>
          <dd class="tabular-nums">
            {at.planEntitled === null ? CALCULATING : formatCount(at.planEntitled)}
          </dd>
        </div>
      </dl>
      {#if protectionLine}
        <!-- Not live: the numbers change with every lever change (spec: no aria-live). -->
        <p class="mt-2 text-sm text-ink-muted tabular-nums dark:text-ink-dark-muted">
          {protectionLine}
        </p>
      {/if}
    </section>

    <ScoreChart {score} {asOf} {horizon} {day} />

    <div class="mt-4">
      {#each at.targets as t, k (t.tp.target.id)}
        <TargetRow tp={t.tp} net={at.total} {max} primary={k === 0} themed />
        <p class="text-sm text-ink-muted dark:text-ink-dark-muted">
          At the deadline ({formatDate(score.targets[k].deadline)}): {formatPercent(t.atDeadline)}
        </p>
      {/each}
    </div>

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
      <p class="mt-2 text-sm text-ink-muted dark:text-ink-dark-muted">
        One possible future for San Francisco under {copy.plan}. It starts from every real project
        in the pipeline today and adds new ones at the rates the city's own records show. It is a
        simulation, not a forecast.
      </p>
      <p
        class="mt-2 text-sm text-ink-muted dark:text-ink-dark-muted"
        aria-busy={band.busy ? 'true' : undefined}
      >
        {band.text}
      </p>
      <p class="mt-2 text-sm text-ink-muted dark:text-ink-dark-muted">
        To see what {short} itself does, each future is run twice: once with {copy.plan}, and once
        as the same city simulated under {copy.twin}, with the same luck. The difference between the
        two is {short}'s effect. Some homes would have been built anyway; they are not counted here.
      </p>

      {#if seed !== null}
        <p class="mt-3 text-sm">
          This future: #{seed}{representative ? ' (representative)' : ''}
        </p>
      {/if}
      {#if !representative}
        <!-- aria-disabled, not disabled, so a press does not drop keyboard focus to <body>. -->
        <button
          type="button"
          aria-disabled={canReroll ? undefined : 'true'}
          class="min-h-11 rounded-md px-1 text-left text-sm font-semibold underline aria-disabled:cursor-not-allowed aria-disabled:text-ink-muted dark:aria-disabled:text-ink-dark-muted"
          onclick={() => {
            if (canReroll) onrepresentative();
          }}>Back to the representative future</button
        >
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
          href="/attribution">Sources</a
        >
      </p>
      {#if phasing}
        <p class="mt-1 text-xs text-ink-muted dark:text-ink-dark-muted">{phasing}</p>
      {/if}
    </details>
  {/if}
</div>
