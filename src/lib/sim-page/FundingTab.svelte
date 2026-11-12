<!--
  The Funding tab (funding-ui spec 4.4, 4.5, 4.9, 4.10). One column, the same at every width:
  - the coverage line and the "Coverage over time" disclosure (status: above every control);
  - "Today's funding": the baseline groups as select buttons (aria-pressed), each expanding its
    FundingGroupEditor in place under it;
  - "Money you add": the added pools (FundingPoolRow, each expanding its editor in place), the
    open draft pool after them, or "Nothing added yet.", then "+ Add money" (AddMoney: the
    presets and "Your own pool");
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
  import { SvelteSet } from 'svelte/reactivity';
  import { HORIZON } from '$lib/fzp/time';
  import { AFFORDABLE, AVERAGE_DRAWN, DRAW_UP_FRONT, MARKET_TERMS } from '$lib/sim/finance';
  import type { Calibration, TermKey } from '$lib/timelapse/types';
  import {
    COVERAGE_OFF_SHORT_SENTENCE,
    COVERAGE_PRIVATE_SENTENCE,
    COVERAGE_RULE_SENTENCE,
    COVERAGE_RUN_SENTENCE,
    COVERAGE_SIZE_SENTENCE,
    DRAFT_OPEN_DESC,
    MONTH_OFFER_CAVEAT,
    NOTHING_ADDED,
    NO_LIMIT,
    POOL_LIMIT_DESC,
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
  import {
    addPresetEdit,
    completeDraft,
    isRefused,
    newOwnPool,
    type FundingEdit,
    type PoolDraft,
    type Refused
  } from './funding-edit';
  import { FINANCE_LIMITS } from '$lib/sim/levers/finance';
  import { fundingPresets, pastItems, type FundingPreset } from './funding-presets';
  import {
    baselineGroups,
    coverageSizeMixed,
    coverageSteps,
    groupOf,
    type BaselineGroup,
    type FundingRowId
  } from './funding-view';
  import AddMoney from './AddMoney.svelte';
  import FundingGroupEditor from './FundingGroupEditor.svelte';
  import FundingPoolRow from './FundingPoolRow.svelte';
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

  // ---- adding money (4.6) ----

  let addOpen = $state(false);
  /** A refused preset's text, in the chooser's alert line. */
  let addAlert = $state('');

  const poolDraft = $derived(drafts.draft?.kind === 'pool' ? drafts.draft.pool : null);
  const addDisabled = $derived(
    drafts.isOpen
      ? DRAFT_OPEN_DESC
      : f.pools.length >= FINANCE_LIMITS.pools
        ? POOL_LIMIT_DESC
        : null
  );
  const past = $derived(pastItems(f, asOf));
  const pastOf = (id: string) => ({
    pool: past.pools.includes(id),
    inflows: past.inflows.filter((x) => x.pool === id).map((x) => x.index)
  });
  /** Pools whose name the page generated and the user never edited (page memory, 4.9). */
  const autoNamed = new SvelteSet<string>();

  const rowEl = (key: string): HTMLElement | null =>
    rowsEl?.querySelector<HTMLElement>(`[data-funding-row="${key}"]`) ?? null;
  const addButton = (): HTMLElement | null =>
    rowsEl?.querySelector<HTMLElement>('[data-funding-add]') ?? null;

  /** Focuses `field` in a row after the next render. */
  async function focusIn(key: string, field: string): Promise<void> {
    await tick();
    rowEl(key)?.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus();
  }

  function onpreset(p: FundingPreset): void {
    const e = addPresetEdit(store.policy, p);
    if (isRefused(e)) {
      addAlert = e.refused;
      return;
    }
    addAlert = '';
    const had = new Set(f.pools.map((x) => x.id));
    onedit(e);
    addOpen = false;
    const added = store.policy.funding.pools.find((x) => !had.has(x.id));
    if (added !== undefined) {
      select({ kind: 'pool', id: added.id });
      void focusIn(`pool:${added.id}`, 'kind');
      return;
    }
    // Only dated changes: select the affected group and focus its new change (4.6).
    const entry = p.baselineScale[0];
    const target = baseline?.pools.find((x) => x.id === entry?.pool);
    if (entry === undefined || target === undefined) return;
    const group = groupOf(target.kind);
    select({ kind: 'baselineGroup', group });
    void tick().then(() =>
      rowEl(`group:${group}`)
        ?.querySelector<HTMLElement>(`[data-scale-line][data-scale-from="${entry.from}"]`)
        ?.focus()
    );
  }

  function onownpool(): void {
    addAlert = '';
    addOpen = false;
    drafts.open({ kind: 'pool', pool: newOwnPool(asOf) });
    void focusIn('draft', 'kind');
  }

  /**
   * A draft's next state: kept as a draft while incomplete, else added in one store change and
   * shown as its row, focus staying in the field just committed (4.6).
   */
  function ondraft(d: PoolDraft, field: string): void {
    if (drafts.draft?.kind !== 'pool') return;
    const next = { kind: 'pool' as const, pool: d };
    const e = completeDraft(next, store.policy, baseline);
    if (e === null) {
      drafts.open(next);
      return;
    }
    const had = new Set(f.pools.map((x) => x.id));
    drafts.discard();
    onedit(e);
    const added = store.policy.funding.pools.find((x) => !had.has(x.id));
    if (added === undefined) return;
    if (!d.labelEdited) autoNamed.add(added.id);
    select({ kind: 'pool', id: added.id });
    void focusIn(`pool:${added.id}`, field);
  }

  function ondiscard(): void {
    drafts.discard();
    void tick().then(() => addButton()?.focus());
  }

  /** A pool row's edit; after its removal, focus the row now at its index, else Add money. */
  function poolEdit(i: number, id: string, e: FundingEdit | Refused): void {
    onedit(e);
    if (store.policy.funding.pools.some((x) => x.id === id)) return;
    void tick().then(() => {
      const next = store.policy.funding.pools[i];
      const el =
        next === undefined ? null : rowEl(`pool:${next.id}`)?.querySelector<HTMLElement>('button');
      (el ?? addButton())?.focus();
    });
  }

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
        {#if f.pools.length === 0 && poolDraft === null}
          <p class={muted}>{NOTHING_ADDED}</p>
        {:else}
          <ul class="flex flex-col gap-2">
            {#each f.pools as pool, i (pool.id)}
              {@const on = selected?.kind === 'pool' && selected.id === pool.id}
              <FundingPoolRow
                {pool}
                id={pool.id}
                selected={on}
                policy={store.policy}
                {presets}
                past={pastOf(pool.id)}
                {asOf}
                autoName={autoNamed.has(pool.id)}
                onselect={() => select(on ? null : { kind: 'pool', id: pool.id })}
                onedit={(e) => poolEdit(i, pool.id, e)}
              />
            {/each}
            {#if poolDraft !== null}
              <!-- The draft in the place the pool will take (4.6). -->
              <FundingPoolRow
                pool={poolDraft}
                id={null}
                selected={true}
                policy={store.policy}
                {presets}
                past={{ pool: false, inflows: [] }}
                {asOf}
                onselect={() => {}}
                {onedit}
                {ondraft}
                {ondiscard}
              />
            {/if}
          </ul>
        {/if}
        <AddMoney
          {presets}
          disabledReason={addDisabled}
          alert={addAlert}
          {onpreset}
          {onownpool}
          bind:open={addOpen}
        />
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
