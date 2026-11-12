<!--
  The editor of one of today's funding groups (funding-ui spec 4.5, items 1 to 5), expanded in
  place under its row in the Funding tab:
  1. "Sources" (City only): each City pool and its yearly amount, its own dated changes, and its
     own "+ Change from a date".
  2. "Dated changes": scaleLines, a City-wide change as one "City money" line, each with Remove.
  3. "+ Change from a date": the inline entry (From month and year; a capped group's
     "Amount, % of today's", or the federal group's Switched off / Switched back on), with Apply
     change and Cancel. aria-disabled with its reason when the entries would pass 24; checked
     again on Apply, so nothing over the limit reaches the store.
  4. "What it pays for": the baseline programmes, read-only, then the added ones on the group's
     pools, then "+ What it pays for" (wired in Task 7).
  5. The group's sources (SourceList).
  Every edit goes to `onedit`; the tab applies it, labels it and announces it.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { formatMonthYear } from '$lib/fzp/format';
  import { dayOf, firstOfMonth } from '$lib/sim/scenario/dates';
  import { FINANCE_LIMITS } from '$lib/sim/levers/finance';
  import type { Day, Pool } from '$lib/timelapse/types';
  import {
    SCALE_AMOUNT_DESC,
    SCALE_PCT_ERROR,
    addProgrammeName,
    baselineProgrammeText,
    dateRangeError,
    perYearText,
    scaleLimitDesc
  } from './funding-copy';
  import {
    addScaleEdit,
    isRefused,
    removeScaleEdit,
    type FundingEdit,
    type Refused
  } from './funding-edit';
  import { nextFiscal } from './funding-presets';
  import {
    groupProvenance,
    programmeSentence,
    scaleLines,
    tiersText,
    type Baseline,
    type BaselineGroup
  } from './funding-view';
  import type { SimPolicy } from './policy';
  import SourceList from './SourceList.svelte';

  interface Props {
    group: BaselineGroup;
    policy: SimPolicy;
    baseline: Baseline;
    asOf: Day;
    onedit: (e: FundingEdit | Refused) => void;
  }

  let { group, policy, baseline, asOf, onedit }: Props = $props();

  const uid = $props.id();
  let root = $state<HTMLDivElement>();

  const f = $derived(policy.funding);
  const isCity = $derived(group.group === 'city');
  const lines = $derived(scaleLines(f, baseline, group.group));
  const poolById = $derived(new Map(group.pools.map((p) => [p.id, p])));
  const added = $derived(f.programmes.filter((g) => poolById.has(g.pool)));

  const MONTHS = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2000, i, 1))
    )
  );
  const LAST_MONTH: Day = dayOf(2066, 12, 1);
  const utcYear = (d: Day): number => new Date(d * 86_400_000).getUTCFullYear();

  /** A pool's yearly inflows in force at `asOf`, scaled by the entry in force then. */
  function poolPerYear(p: Pool): number {
    let best: { from: Day; scale: number } | undefined;
    for (const e of f.baselineScale)
      if (e.pool === p.id && e.from <= asOf && (best === undefined || e.from >= best.from))
        best = e;
    let sum = 0;
    for (const x of p.inflows)
      if (x.kind === 'yearly' && x.from <= asOf && (x.to === null || x.to >= asOf))
        sum += x.dollarsPerYear;
    return Math.round(sum * (best?.scale ?? 1));
  }

  /** What an entry targets: the whole group, or one City source. */
  type Target = { key: string; target: { group: BaselineGroup['group'] } | { pool: string } };
  const groupTarget = $derived<Target>({ key: 'group', target: { group: group.group } });
  const poolTarget = (p: Pool): Target => ({ key: p.id, target: { pool: p.id } });

  const poolsOf = (t: Target): Pool[] =>
    'group' in t.target
      ? group.pools
      : group.pools.filter((p) => p.id === (t.target as { pool: string }).pool);

  /** Entries a change on `t` adds at most (one per pool, before any it replaces). */
  const needs = (t: Target): number => poolsOf(t).length;
  const overLimit = (t: Target): boolean =>
    f.baselineScale.length + needs(t) > FINANCE_LIMITS.baselineScale;

  /** The one open entry, if any. */
  let entry = $state<{
    key: string;
    month: string;
    year: number | null;
    pct: number | null;
    on: boolean;
    error: string | null;
  } | null>(null);

  function addButton(key: string): HTMLButtonElement | null {
    return root?.querySelector<HTMLButtonElement>(`[data-scale-add="${key}"]`) ?? null;
  }

  function openEntry(t: Target): void {
    if (overLimit(t)) return;
    const start = nextFiscal(asOf);
    entry = {
      key: t.key,
      month: String(new Date(start * 86_400_000).getUTCMonth() + 1),
      year: utcYear(start),
      pct: 0,
      on: false,
      error: null
    };
    void tick().then(() => root?.querySelector<HTMLElement>(`#${uid}-month`)?.focus());
  }

  function closeEntry(): void {
    const key = entry?.key;
    entry = null;
    if (key !== undefined) void tick().then(() => addButton(key)?.focus());
  }

  function apply(t: Target): void {
    if (entry === null) return;
    const y = entry.year;
    const from =
      typeof y === 'number' && Number.isInteger(y) ? dayOf(y, Number(entry.month), 1) : NaN;
    if (!(from >= firstOfMonth(asOf) && from <= LAST_MONTH)) {
      entry.error = dateRangeError(asOf);
      return;
    }
    const uncapped = poolsOf(t).every((p) => p.uncapped);
    let scale: number;
    if (uncapped) scale = entry.on ? 1 : 0;
    else {
      const pct = typeof entry.pct === 'number' ? entry.pct : NaN;
      if (!(Number.isFinite(pct) && pct >= 0 && pct <= 1000)) {
        entry.error = SCALE_PCT_ERROR;
        return;
      }
      scale = Math.round(pct * 1e10) / 1e12;
    }
    const e = addScaleEdit(policy, baseline, t.target, from, scale);
    if (isRefused(e)) {
      entry.error = e.refused;
      return;
    }
    onedit(e);
    closeEntry();
  }

  function remove(i: number): void {
    onedit(removeScaleEdit(lines[i]));
    // The line is gone: focus the Remove now at its place, else "+ Change from a date".
    void tick().then(() => {
      const removes = root?.querySelectorAll<HTMLButtonElement>('[data-scale-remove]');
      (removes?.[i] ?? addButton('group'))?.focus();
    });
  }

  const link =
    'min-h-6 min-w-6 rounded-md px-1 font-semibold underline aria-disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11';
  const field =
    'min-h-6 rounded-md border border-control-line bg-surface px-2 text-ink dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark pointer-coarse:min-h-11';
  const muted = 'text-ink-muted dark:text-ink-dark-muted';
</script>

<!-- One "+ Change from a date" and, when open, its inline entry. `who` names a City source so
     the row's buttons are unique (WCAG 2.5.3: the name starts with the visible text). -->
{#snippet change(t: Target, who: string | null)}
  {@const over = overLimit(t)}
  {@const isOpen = entry?.key === t.key}
  {@const uncapped = poolsOf(t).every((p) => p.uncapped)}
  <div class="flex flex-col items-start gap-1">
    {#if !isOpen}
      <!-- aria-disabled, not disabled: it keeps focus, and its reason is its description. -->
      <button
        type="button"
        data-scale-add={t.key}
        aria-disabled={over ? 'true' : undefined}
        aria-describedby={over ? `${uid}-${t.key}-limit` : undefined}
        class={link}
        onclick={() => openEntry(t)}
        ><span aria-hidden="true">+</span> Change from a date{#if who}<span class="sr-only"
            >, {who}</span
          >{/if}</button
      >
      {#if over}
        <span id="{uid}-{t.key}-limit" class={muted}>{scaleLimitDesc(needs(t))}</span>
      {/if}
    {:else if entry}
      <div class="flex flex-col gap-2 rounded-md border border-line p-2 dark:border-line-dark">
        <fieldset class="flex flex-wrap items-center gap-2">
          <legend class="font-semibold">From</legend>
          <label class="flex items-center gap-1">
            Month
            <select
              id="{uid}-month"
              class={field}
              aria-invalid={entry.error === dateRangeError(asOf) ? 'true' : undefined}
              aria-describedby="{uid}-entry-error"
              bind:value={entry.month}
            >
              {#each MONTHS as name, i (i)}
                <option value={String(i + 1)}>{name}</option>
              {/each}
            </select>
          </label>
          <label class="flex items-center gap-1">
            Year
            <input
              type="number"
              inputmode="numeric"
              min={utcYear(asOf)}
              max="2066"
              step="1"
              class="{field} w-24"
              aria-invalid={entry.error === dateRangeError(asOf) ? 'true' : undefined}
              aria-describedby="{uid}-entry-error"
              bind:value={entry.year}
            />
          </label>
        </fieldset>
        {#if uncapped}
          <fieldset class="flex flex-col gap-1">
            <legend class="font-semibold">Federal tax credits</legend>
            <label class="flex min-h-6 items-center gap-1.5 pointer-coarse:min-h-11">
              <input
                type="radio"
                class="size-5"
                name="{uid}-on"
                checked={!entry.on}
                onchange={() => entry && (entry.on = false)}
              />
              Switched off
            </label>
            <label class="flex min-h-6 items-center gap-1.5 pointer-coarse:min-h-11">
              <input
                type="radio"
                class="size-5"
                name="{uid}-on"
                checked={entry.on}
                onchange={() => entry && (entry.on = true)}
              />
              Switched back on
            </label>
          </fieldset>
        {:else}
          <label class="flex flex-wrap items-center gap-1">
            Amount, % of today's
            <input
              type="number"
              inputmode="decimal"
              min="0"
              max="1000"
              step="5"
              class="{field} w-24"
              aria-invalid={entry.error === SCALE_PCT_ERROR ? 'true' : undefined}
              aria-describedby="{uid}-pct-desc {uid}-entry-error"
              bind:value={entry.pct}
            />
          </label>
          <span id="{uid}-pct-desc" class={muted}>{SCALE_AMOUNT_DESC}</span>
        {/if}
        <!-- Always present and in the accessibility tree (sr-only while empty), so an error is
             spoken when it appears (WCAG 4.1.3). -->
        <p
          id="{uid}-entry-error"
          role="alert"
          class="text-red-800 dark:text-red-300 {entry.error ? '' : 'sr-only'}"
        >
          {entry.error ?? ''}
        </p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class={link} onclick={() => apply(t)}>Apply change</button>
          <button type="button" class={link} onclick={closeEntry}>Cancel</button>
        </div>
      </div>
    {/if}
  </div>
{/snippet}

<div bind:this={root} data-funding-editor class="flex flex-col gap-3 px-1 pt-1 pb-2">
  {#if isCity}
    <section class="flex flex-col gap-1">
      <h4 class="font-semibold">Sources</h4>
      <ul class="flex flex-col gap-2">
        {#each group.pools as pool (pool.id)}
          <li class="flex flex-col gap-0.5">
            <span>{pool.label}: {perYearText(poolPerYear(pool))}</span>
            {#each lines.filter((l) => l.pools.length === 1 && l.pools[0] === pool.id) as l (l.from)}
              <span class={muted}>{l.text}</span>
            {/each}
            {@render change(poolTarget(pool), pool.label)}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="flex flex-col gap-1">
    <h4 class="font-semibold">Dated changes</h4>
    {#if lines.length > 0}
      <ul class="flex flex-col gap-1">
        {#each lines as l, i (`${l.pools.join(',')}@${l.from}`)}
          <li data-scale-line class="flex flex-wrap items-center gap-x-2">
            <span
              >{#if isCity}<span class="font-medium">{l.name}</span>:
              {/if}{l.text}</span
            >
            <button type="button" data-scale-remove class={link} onclick={() => remove(i)}
              >Remove<span class="sr-only"
                >{` change from ${formatMonthYear(l.from)}`}{isCity ? `, ${l.name}` : ''}</span
              ></button
            >
          </li>
        {/each}
      </ul>
    {/if}
    {@render change(groupTarget, null)}
  </section>

  <section class="flex flex-col gap-1">
    <h4 class="font-semibold">What it pays for</h4>
    <ul class="flex flex-col gap-1">
      {#each group.programmes as g (g.id)}
        {@const pool = poolById.get(g.pool)}
        {#if pool}
          <li>
            {g.instrument.kind === 'grant'
              ? baselineProgrammeText(
                  g.minHomes,
                  g.instrument.share,
                  g.tiers ? tiersText(g.tiers) : null
                )
              : programmeSentence(g, pool)}
          </li>
        {/if}
      {/each}
      {#each added as g (g.id)}
        {@const pool = poolById.get(g.pool)}
        {#if pool}
          <li><span class="font-medium">Added</span> {programmeSentence(g, pool)}</li>
        {/if}
      {/each}
    </ul>
    <div>
      <button type="button" class={link} aria-label={addProgrammeName(group.name)}
        ><span aria-hidden="true">+</span> What it pays for</button
      >
    </div>
  </section>

  <section class="flex flex-col gap-1 text-xs {muted}">
    <p>Where these figures come from:</p>
    <SourceList items={groupProvenance(baseline, group.group)} />
  </section>
</div>
