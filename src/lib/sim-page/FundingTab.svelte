<!--
  The Funding tab (funding-ui spec 4.4, 4.5, 4.9, 4.10). One column, the same at every width:
  - the coverage line and the "Coverage over time" disclosure (status: above every control);
  - "Today's funding": the baseline groups as select buttons (aria-pressed), each expanding its
    FundingGroupEditor in place under it;
  - "Money you add": the added pools as select buttons, or "Nothing added yet.", then
    "+ Add money" (Task 6 wires the chooser and the pool editor);
  - the closed "Sources and tiers" details.
  Every edit is one labelled store change, its coalesce key suffixed with the run number (a run
  ends when the selection changes or the tab remounts), announced with the new coverage summary
  when the coverage text changed. The open draft lives in SimPage's FundingDrafts, not here.
-->
<script module lang="ts">
  /** Coalesce runs, numbered across mounts, so a remounted tab never resumes an old run. */
  let runs = 0;
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import { HORIZON } from '$lib/fzp/time';
  import { formatDollars } from '$lib/fzp/format';
  import { AFFORDABLE, AVERAGE_DRAWN, DRAW_UP_FRONT, MARKET_TERMS } from '$lib/sim/finance';
  import type { Calibration, TermKey } from '$lib/timelapse/types';
  import {
    COVERAGE_OFF_SHORT_SENTENCE,
    COVERAGE_PRIVATE_SENTENCE,
    COVERAGE_RULE_SENTENCE,
    COVERAGE_RUN_SENTENCE,
    COVERAGE_SIZE_SENTENCE,
    MONTH_OFFER_CAVEAT,
    NOTHING_ADDED,
    NO_LIMIT,
    SWITCHED_OFF,
    TERM_NAME,
    affordableCostText,
    checkLineText,
    coverageLineText,
    coverageStepText,
    coverageSummaryText,
    groupChangesText,
    groupLendsText,
    groupPaysText,
    noSourcedValueText,
    notOfferedText,
    perYearText,
    smallProjectsCaveat
  } from './funding-copy';
  import type { FundingDrafts } from './funding-drafts.svelte';
  import { isRefused, type FundingEdit, type Refused } from './funding-edit';
  import { fundingPresets } from './funding-presets';
  import {
    baselineGroups,
    coverageSizeMixed,
    coverageSteps,
    poolPreview,
    poolsOf,
    programmeSentence,
    type BaselineGroup,
    type FundingRowId
  } from './funding-view';
  import FundingGroupEditor from './FundingGroupEditor.svelte';
  import type { PolicyStore } from './policy-store.svelte';
  import SourceList from './SourceList.svelte';

  interface Props {
    store: PolicyStore;
    /** A calibration with `market` and `baselineFunding` (`simTabs` offers the tab only then). */
    calibration: Calibration;
    /** The page's one unfinished pool or programme (Tasks 6 and 7 open it). */
    drafts: FundingDrafts;
    /** Speaks an edit's label, then the new coverage summary when it changed (WCAG 4.1.3). */
    announce: (m: string) => void;
  }

  let { store, calibration, drafts, announce }: Props = $props();

  const uid = $props.id();
  let rowsEl = $state<HTMLDivElement>();

  const baseline = $derived(calibration.baselineFunding);
  const asOf = $derived(calibration.asOf);
  const f = $derived(store.policy.funding);
  const presets = $derived(fundingPresets(calibration));

  const steps = $derived(baseline ? coverageSteps(f, baseline, asOf, HORIZON) : []);
  const summary = $derived(steps.length > 0 ? coverageSummaryText(steps) : '');
  const sized = $derived(steps.map((s) => coverageSizeMixed(f, baseline, s.from)));
  const groups = $derived(baseline ? baselineGroups(f, baseline, asOf) : []);
  /** R22: the smallest project size today's affordable programmes reach. */
  const smallest = $derived(
    Math.min(
      ...(baseline?.programmes ?? []).filter((g) => g.reach === 'affordable').map((g) => g.minHomes)
    )
  );

  let coverageOpen = $state(false);
  /** A refused edit's text: always present, spoken when it appears (WCAG 4.1.3). */
  let alertText = $state('');

  // ---- selection (one row at a time) ----

  let picked = $state.raw<FundingRowId | null>(null);
  /**
   * The selected row, while it still exists: an undo or redo that removes the selected pool
   * clears the selection in the same render (4.9), as `liveSelection` does for layers.
   */
  const selected = $derived.by((): FundingRowId | null => {
    if (picked === null) return null;
    if (picked.kind === 'pool') {
      const id = picked.id;
      return f.pools.some((p) => p.id === id) ? picked : null;
    }
    const g = picked.group;
    return groups.some((x) => x.group === g) ? picked : null;
  });
  // The effect forgets a row that left the policy, so a Redo does not bring its selection back
  // (SimPage's rule for layers and painted areas).
  $effect(() => {
    if (picked !== null && selected === null) picked = null;
  });
  const rowKey = (r: FundingRowId | null): string =>
    r === null ? '' : r.kind === 'pool' ? `pool:${r.id}` : `group:${r.group}`;
  const selKey = $derived(rowKey(selected));

  /**
   * The current coalesce run: renewed on mount and on every selection change, so a later edit of
   * the same field is a new undo step. A different key is PolicyStore's run boundary.
   */
  let run = ++runs;
  $effect.pre(() => {
    void selKey;
    run = ++runs;
  });

  function select(r: FundingRowId | null): void {
    picked = r;
    if (r === null) return;
    const key = rowKey(r);
    void tick().then(() =>
      rowsEl?.querySelector(`[data-funding-row="${key}"]`)?.scrollIntoView({ block: 'nearest' })
    );
  }

  // ---- edits ----

  function onedit(e: FundingEdit | Refused): void {
    if (isRefused(e)) {
      alertText = e.refused;
      return;
    }
    alertText = '';
    // Read before the change: `summary` is derived from the store and follows it at once.
    const said = summary;
    const before = store.policy;
    store.apply(e.change, e.label, e.coalesce === undefined ? undefined : `${e.coalesce}@${run}`);
    if (store.policy === before || !baseline) return;
    const after = coverageSummaryText(coverageSteps(store.policy.funding, baseline, asOf, HORIZON));
    announce(`${e.label}.${after === said ? '' : ` ${after}`}`);
  }

  // ---- row text ----

  function groupAmount(g: BaselineGroup): string {
    if (g.off) return SWITCHED_OFF;
    return g.perYear === null ? NO_LIMIT : perYearText(g.perYear);
  }

  function groupPays(g: BaselineGroup): string {
    return (
      groupPaysText(g.perHome) + (g.lentPerHome > 0 ? `; ${groupLendsText(g.lentPerHome)}` : '')
    );
  }

  function poolAmount(pool: (typeof f.pools)[number]): string {
    const p = poolPreview(pool, asOf);
    return p.perYear !== null ? perYearText(p.perYear) : formatDollars(p.once);
  }

  const allPools = $derived(poolsOf(f, baseline));
  const poolSentences = (id: string): string[] =>
    f.programmes
      .filter((g) => g.pool === id)
      .flatMap((g) => {
        const pool = allPools.find((p) => p.id === g.pool);
        return pool ? [programmeSentence(g, pool)] : [];
      });

  // ---- sources and tiers ----

  /** Presets with an item in the policy (ids `u-<presetId>-<n>`). */
  const addedPresets = $derived(
    presets.filter((p) =>
      [...f.pools, ...f.programmes].some((x) => new RegExp(`^u-${p.id}-\\d+$`).test(x.id))
    )
  );
  const unsourcedTerms = (Object.keys(MARKET_TERMS) as TermKey[]).flatMap((k) => {
    const e = MARKET_TERMS[k];
    return e.value === null && 'reason' in e ? [{ key: k, reason: e.reason }] : [];
  });

  const rowClass = (on: boolean): string =>
    `flex flex-col rounded-md border p-1 ${
      on
        ? 'border-accent bg-surface-raised dark:border-accent-dark dark:bg-surface-dark-raised'
        : 'border-line bg-surface dark:border-line-dark dark:bg-surface-dark'
    }`;
  const rowButton =
    'flex min-h-11 w-full flex-col items-start rounded-md px-1 py-1 text-left hover:bg-surface-raised dark:hover:bg-surface-dark-raised';
  const muted = 'text-ink-muted dark:text-ink-dark-muted';
  const link =
    'min-h-6 min-w-6 rounded-md px-1 font-semibold underline aria-disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11';
</script>

<div class="flex flex-col gap-4 text-sm text-ink dark:text-ink-dark">
  {#if baseline && steps.length > 0}
    <!-- Status of the policy, not a control: above every button (owner's rule). -->
    <div class="flex flex-col items-start gap-1">
      <p class="font-semibold">{coverageLineText(steps[0])}</p>
      <button
        type="button"
        aria-expanded={coverageOpen}
        aria-controls="{uid}-coverage"
        class={link}
        onclick={() => (coverageOpen = !coverageOpen)}
        >Coverage over time <span aria-hidden="true">{coverageOpen ? '−' : '+'}</span></button
      >
      <div id="{uid}-coverage" hidden={!coverageOpen} class="flex flex-col gap-1">
        <!-- One line per date the bundle changes; today is the coverage line above. -->
        {#if steps.length > 1}
          <ul class="flex flex-col gap-1">
            {#each steps.slice(1) as s, i (s.from)}
              <li>{coverageStepText(s, sized[i + 1])}</li>
            {/each}
          </ul>
        {/if}
        <p>{COVERAGE_RUN_SENTENCE}</p>
        <p>{COVERAGE_RULE_SENTENCE}</p>
        <p>{COVERAGE_OFF_SHORT_SENTENCE}</p>
        {#if sized.some((x) => x)}
          <p>{COVERAGE_SIZE_SENTENCE}</p>
        {/if}
        <p>{COVERAGE_PRIVATE_SENTENCE}</p>
        <!-- The model's known limits come last: they bound the line rather than explain it. -->
        {#if Number.isFinite(smallest) && smallest > 0}
          <p class={muted}>{smallProjectsCaveat(smallest)}</p>
        {/if}
        <p class={muted}>{MONTH_OFFER_CAVEAT}</p>
      </div>
    </div>

    <div bind:this={rowsEl} class="flex flex-col gap-4">
      <section class="flex flex-col gap-2">
        <h3 class="font-semibold">Today's funding</h3>
        <ul class="flex flex-col gap-2">
          {#each groups as g (g.group)}
            {@const on = selected?.kind === 'baselineGroup' && selected.group === g.group}
            <li data-funding-row="group:{g.group}" class={rowClass(on)}>
              <button
                type="button"
                aria-pressed={on}
                class={rowButton}
                onclick={() => select(on ? null : { kind: 'baselineGroup', group: g.group })}
              >
                <span class="font-semibold">{g.name} · {groupAmount(g)}</span>
                <span class={muted}>{groupPays(g)}</span>
                {#if g.changesFrom !== null}
                  <span class={muted}>{groupChangesText(g.changesFrom)}</span>
                {/if}
              </button>
              <!-- A button's children are presentational: a changed amount is also a sibling
                   status, so it is spoken (WCAG 4.1.3). -->
              <span role="status" class="sr-only">{g.name}: {groupAmount(g)}; {groupPays(g)}</span>
              {#if on}
                <FundingGroupEditor group={g} policy={store.policy} {baseline} {asOf} {onedit} />
              {/if}
            </li>
          {/each}
        </ul>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="font-semibold">Money you add</h3>
        {#if f.pools.length === 0}
          <p class={muted}>{NOTHING_ADDED}</p>
        {:else}
          <ul class="flex flex-col gap-2">
            {#each f.pools as pool (pool.id)}
              {@const on = selected?.kind === 'pool' && selected.id === pool.id}
              <li data-funding-row="pool:{pool.id}" class={rowClass(on)}>
                <button
                  type="button"
                  aria-pressed={on}
                  class={rowButton}
                  onclick={() => select(on ? null : { kind: 'pool', id: pool.id })}
                >
                  <span class="font-semibold">{pool.label} · {poolAmount(pool)}</span>
                  {#each poolSentences(pool.id) as line, k (k)}
                    <span class={muted}>{line}</span>
                  {/each}
                </button>
                {#if on}
                  <!-- Task 6 replaces this with the pool editor (FundingPoolRow). -->
                  <div data-funding-editor class="flex flex-col gap-1 px-1 pt-1 pb-2">
                    {#each poolPreview(pool, asOf).lines as line, k (k)}
                      <p>{line}</p>
                    {/each}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
        <div>
          <button
            type="button"
            data-funding-add
            data-draft-open={drafts.isOpen ? 'true' : undefined}
            class="min-h-11 rounded-md border border-control-line bg-surface px-3 font-medium text-ink hover:bg-surface-raised aria-disabled:opacity-40 dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark dark:hover:bg-surface-dark-raised"
            ><span aria-hidden="true">+</span> Add money</button
          >
        </div>
      </section>
    </div>

    <p role="alert" class="text-red-800 dark:text-red-300 {alertText ? '' : 'sr-only'}">
      {alertText}
    </p>

    <details class="text-xs {muted}">
      <summary
        class="flex min-h-6 cursor-pointer items-center font-semibold text-ink dark:text-ink-dark pointer-coarse:min-h-11"
        >Sources and tiers</summary
      >
      <div class="mt-1 flex flex-col gap-1">
        <p>Today's funding:</p>
        <SourceList items={baseline.provenance} />
        <p>
          {checkLineText(baseline.check.impliedHomesPerYear, baseline.check.observedHomesPerYear)}
        </p>
        <SourceList items={[baseline.check.provenance]} />
        {#each addedPresets as p (p.id)}
          <p>{p.label}:</p>
          <SourceList items={p.provenance} />
        {/each}
        <p>{COVERAGE_RULE_SENTENCE}</p>
        <p>
          {affordableCostText(
            AFFORDABLE.value.costPerHome,
            AFFORDABLE.value.ownPerHome,
            AFFORDABLE.provenance.tier
          )}
        </p>
        <SourceList items={[AFFORDABLE.provenance]} />
        {#each unsourcedTerms as t (t.key)}
          <p>{TERM_NAME[t.key]}: {noSourcedValueText(t.reason)}</p>
        {/each}
        <p>How a loan is drawn, an assumption:</p>
        <SourceList items={[DRAW_UP_FRONT.provenance, AVERAGE_DRAWN.provenance]} />
        {#each presets.filter((p) => !p.available) as p (p.id)}
          <p>{notOfferedText(p.label, p.reason ?? '')}</p>
        {/each}
      </div>
    </details>
  {/if}
</div>
