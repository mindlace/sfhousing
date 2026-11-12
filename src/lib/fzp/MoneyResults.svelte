<!--
  The Results face's "Public money" and "Who the homes are for" blocks (funding-ui spec 4.11).
  `part` picks one, so SimResults renders this twice and keeps the face order of 4.11 without
  moving its own markup. Every value is the month `i`'s (the scrubbed month, never past the
  high-water mark); only the limit statements are not series. The first lines are not live
  regions: they change every frame during play, as the headline does.
-->
<script lang="ts">
  import { formatCount, formatPercent } from '$lib/scoreboard/format';
  import { DISPLACEMENT_RANGE, MARKET_TERMS } from '$lib/sim/finance';
  import { MONEY_SOURCES, TIER_SOURCES, tierBaselineLabel } from '$lib/sim/scenario/finance-score';
  import type { TimelineScore } from '$lib/sim/protocol';
  import SourceList from '$lib/sim-page/SourceList.svelte';
  import type { Day } from '$lib/timelapse/time';
  import type { ResolvedTerms } from '$lib/timelapse/types';
  import { formatDollars, formatMonthYear } from './format';
  import {
    COLUMN_NAME,
    TIER_NAME,
    affordableLine,
    allLine,
    bySourceColumns,
    cityLine,
    displacementLine,
    fundedLine,
    isUncapped,
    limitLines,
    lostGrantsLine,
    moneyAt,
    owedLines,
    tiersAt
  } from './money-view';

  interface Props {
    score: TimelineScore;
    /** The scrubbed month's index: every series is read here. */
    i: number;
    /** The first day of that month, for the captions. */
    at: Day;
    terms: ResolvedTerms;
    /** A revision is pending: both blocks carry aria-busy. */
    pending: boolean;
    part: 'money' | 'tiers';
  }
  let { score, i, at, terms, pending, part }: Props = $props();

  const uid = $props.id();
  let detailsOpen = $state(false);
  let tiersOpen = $state(false);

  const money = $derived(score.money ?? null);
  const m = $derived(money ? moneyAt(money, i) : null);
  const columns = $derived(m ? bySourceColumns(m) : []);
  const lossOnExit = $derived(terms.lossOnExit ?? 1);
  const lostLine = $derived(m ? lostGrantsLine(m, lossOnExit) : null);
  const lossCustom = $derived(terms.custom.includes('lossOnExit'));
  const owed = $derived(money ? owedLines(money, i) : []);
  const limits = $derived(money ? limitLines(money.limits) : []);
  const city = $derived(m ? cityLine(m) : null);
  const uncapped = $derived(new Set(money?.pools.filter(isUncapped).map((p) => p.id) ?? []));

  const tiers = $derived(score.tiers ?? null);
  const t = $derived(tiers ? tiersAt(tiers, i) : null);
  const month = $derived(formatMonthYear(at));
  const busy = $derived(pending ? 'true' : undefined);

  const button =
    'min-h-6 min-w-6 rounded-md px-1 text-left text-sm font-semibold underline pointer-coarse:min-h-11';
  const muted = 'text-ink-muted dark:text-ink-dark-muted';
</script>

{#if part === 'money' && money && m}
  <section
    class="mt-4 text-sm"
    aria-labelledby="{uid}-money-h"
    aria-busy={busy}
    data-testid="fzp-money"
  >
    <h2 id="{uid}-money-h" class="font-semibold">Public money</h2>
    {#if city}
      <p class="mt-1 tabular-nums" data-testid="fzp-money-city">{city}</p>
    {/if}
    <p class="tabular-nums" data-testid="fzp-money-all">{allLine(m, money.publicSpent[i])}</p>
    <button
      type="button"
      class="mt-1 {button}"
      aria-expanded={detailsOpen}
      aria-controls="{uid}-money-details"
      onclick={() => (detailsOpen = !detailsOpen)}
      >Money details <span aria-hidden="true">{detailsOpen ? '−' : '+'}</span></button
    >
    <div id="{uid}-money-details" hidden={!detailsOpen} class="mt-2 space-y-2">
      <table class="w-full table-fixed border-collapse text-left" data-testid="fzp-money-sources">
        <caption class="text-left font-semibold">Public money by source, {month}</caption>
        <thead>
          <tr class="border-b border-line dark:border-line-dark">
            <th scope="col" class="py-1 pr-2 align-bottom font-semibold break-words">Source</th>
            {#each columns as c (c)}
              <th scope="col" class="py-1 pr-2 align-bottom font-semibold break-words"
                >{COLUMN_NAME[c]}</th
              >
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each m.pools as p, k (p.id)}
            <tr class="border-b border-line dark:border-line-dark">
              <th scope="row" class="py-1 pr-2 align-top font-normal break-words">{p.label}</th>
              {#each columns as c (c)}
                <td class="py-1 pr-2 align-top break-words tabular-nums">
                  {#if c === 'received' && uncapped.has(money.pools[k].id)}
                    no limit
                  {:else}
                    {formatDollars(p[c])}
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
      {#if lostLine}
        <div data-testid="fzp-money-lost">
          <p>{lostLine}</p>
          {#if lossCustom}
            <p class={muted}>Your value (custom, not sourced).</p>
          {:else if 'provenance' in MARKET_TERMS.lossOnExit}
            <div class={muted}><SourceList items={[MARKET_TERMS.lossOnExit.provenance]} /></div>
          {/if}
        </div>
      {/if}
      <p data-testid="fzp-money-funded">{fundedLine(m)}</p>
      <p class={muted}>
        Per added home counts the money spent so far, including on homes still being built, against
        the homes funded projects have finished, less the private homes they took the place of. It
        is high early in a run and falls as projects finish.
      </p>
      <div data-testid="fzp-money-displaced">
        <p>{displacementLine(money, i)}</p>
        <div class={muted}><SourceList items={[DISPLACEMENT_RANGE.provenance]} /></div>
      </div>
      {#each owed as line, k (k)}
        <p data-testid="fzp-money-owed">{line}</p>
      {/each}
      <div class={muted} data-testid="fzp-money-sources-list">
        <SourceList items={MONEY_SOURCES} />
      </div>
      {#if limits.length > 0}
        <div data-testid="fzp-money-limits">
          <h3 id="{uid}-limits-h" class="font-semibold" aria-describedby="{uid}-limits-d">
            Limits on the City borrowing this policy adds (shown, not enforced)
          </h3>
          <p id="{uid}-limits-d" class={muted}>
            These follow from the borrowing your policy adds, not from what the simulation builds.
          </p>
          <ul class="mt-1 space-y-2">
            {#each limits as l, k (k)}
              <li>
                <p class={l.word === 'Over:' ? 'text-amber-800 dark:text-amber-300' : ''}>
                  <span class="font-semibold">{l.word}</span>
                  {l.text}
                </p>
                <div class={muted}><SourceList items={[l.provenance]} /></div>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </section>
{/if}

{#if part === 'tiers' && tiers && t}
  <section
    class="mt-4 text-sm"
    aria-labelledby="{uid}-tiers-h"
    aria-busy={busy}
    data-testid="fzp-tiers"
  >
    <h2 id="{uid}-tiers-h" class="font-semibold">Who the homes are for</h2>
    <p class="mt-1 tabular-nums" data-testid="fzp-tiers-affordable">{affordableLine(t)}</p>
    <button
      type="button"
      class="mt-1 {button}"
      aria-expanded={tiersOpen}
      aria-controls="{uid}-tiers-details"
      onclick={() => (tiersOpen = !tiersOpen)}
      >Homes by income level <span aria-hidden="true">{tiersOpen ? '−' : '+'}</span></button
    >
    <div id="{uid}-tiers-details" hidden={!tiersOpen} class="mt-2 space-y-2">
      <table class="w-full table-fixed border-collapse text-left" data-testid="fzp-tiers-table">
        <caption class="text-left font-semibold"
          >Homes by income level against the 2023–2031 targets, {month}</caption
        >
        <thead>
          <tr class="border-b border-line dark:border-line-dark">
            <th scope="col" class="w-2/5 py-1 pr-2 font-semibold break-words">Income level</th>
            <th scope="col" class="py-1 pr-2 font-semibold break-words">Homes</th>
            <th scope="col" class="py-1 pr-2 font-semibold break-words">Target</th>
            <th scope="col" class="py-1 pr-2 font-semibold break-words">Share</th>
          </tr>
        </thead>
        <tbody>
          {#each t.rows as r (r.tier)}
            <tr class="border-b border-line dark:border-line-dark">
              <th scope="row" class="py-1 pr-2 align-top font-normal break-words"
                >{TIER_NAME[r.tier]}</th
              >
              <td class="py-1 pr-2 align-top tabular-nums">{formatCount(r.homes)}</td>
              <td class="py-1 pr-2 align-top tabular-nums">{formatCount(r.target)}</td>
              <td class="py-1 pr-2 align-top tabular-nums">{formatPercent(r.fraction)}</td>
            </tr>
          {/each}
          <tr class="border-b border-line dark:border-line-dark">
            <th scope="row" class="py-1 pr-2 align-top font-normal break-words"
              >Affordable, income level not recorded</th
            >
            <td class="py-1 pr-2 align-top tabular-nums">{formatCount(t.unrecorded)}</td>
            <td class="py-1 pr-2 align-top" aria-label="none">—</td>
            <td class="py-1 pr-2 align-top" aria-label="none">—</td>
          </tr>
        </tbody>
      </table>
      <p data-testid="fzp-tiers-label">
        The Homes column counts homes {tierBaselineLabel(score.baseline.since)}, plus those this run
        completes.
      </p>
      <p>
        A fully funded affordable project's homes are counted in the income levels of the programmes
        that pay it, in proportion to what each pays.
      </p>
      <p>
        Homes in real projects whose records give no income level are counted here and never guessed
        into a level. Private projects of 10 homes or more count their on-site affordable homes at
        the legal rate, assuming they build them on site (tier 2).
      </p>
      <div class={muted} data-testid="fzp-tiers-sources">
        <SourceList items={TIER_SOURCES} />
        <!-- TIER_SOURCES' last entry is a fixed statement; the dataset's own provenance is here. -->
        <p class="mt-1" data-testid="fzp-tiers-baseline">
          Homes {tierBaselineLabel(score.baseline.since)}:
        </p>
        <SourceList items={[score.baseline.provenance]} />
      </div>
    </div>
  </section>
{/if}
