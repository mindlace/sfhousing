<!--
  The read-only policy summary (plan 5, Call 15), the view's dock tab: what a shared policy turns
  on, in words, as rows on the dock's surface. One row per new zoning rule and per custom brush
  (each with its lots), the protections (hard choices stay visible), and the timelines' label. The
  route shares and every stage that differs from observed sit behind one disclosure, closed by
  default (compact UI, details on demand). No controls change the policy. Colours are tokens. "Public money" (funding-ui 4.14) comes last:
  the coverage line on top when the calibration has `baselineFunding`, then `summaryRows` as plain
  list items.
-->
<script lang="ts">
  import { PATHWAYS, type Calibration, type Pathway } from '$lib/timelapse/types';
  import { count, customSummary, lotsText, ruleSummary, type LotStatus } from './brush-summary';
  import type { SimPolicy } from './policy';
  import { OBSERVED_TIMING, routeView, shownRouteShares, timingLabel } from './timing';
  import { HORIZON } from '$lib/fzp/time';
  import { coverageLineText } from './funding-copy';
  import { fundingPresets } from './funding-presets';
  import { coverageSteps, summaryRows } from './funding-view';

  interface Props {
    policy: SimPolicy;
    /** Null when the calibration failed to load: the timelines show their label only. */
    calibration: Calibration | null;
    /** Lot lookup state of a card: `rule:<id>` or `custom:<id>`. */
    lotsOf(key: `rule:${string}` | `custom:${string}`): LotStatus;
  }
  let { policy, calibration, lotsOf }: Props = $props();

  const uid = $props.id();
  const detailsId = `${uid}-timing-details`;
  let open = $state(false);

  /** A row on the dock's surface (as the editing cards): a line, outlined. */
  const ROW = 'rounded-md border border-line px-2 py-1.5 dark:border-line-dark';
  const MUTED = 'text-ink-muted dark:text-ink-dark-muted';

  const ROUTE: Record<Pathway, string> = {
    discretionary: 'discretionary',
    streamlined: 'streamlined',
    permitOnly: 'permit only'
  };

  const roundHalf = (x: number) => Math.round(x * 2) / 2;
  const monthsText = (m: number) => (m === 1 ? '1 month' : `${m} months`);

  const protections = $derived.by(() => {
    const p = policy.protect;
    const items: string[] = [];
    if (p.rentControl) items.push('rent-controlled buildings');
    if (p.historic) items.push('historic buildings');
    if (p.newerThanYears !== null)
      items.push(`buildings newer than ${count(p.newerThanYears, 'year', 'years')}`);
    if (items.length === 0) return 'None';
    const text = items.join('; ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  });

  const current = $derived(policy.timing.current);

  /** The coverage line (4.5) at the present, computed as the Funding tab computes it. */
  const coverageLine = $derived.by(() => {
    const baseline = calibration?.baselineFunding;
    if (!calibration || !baseline) return null;
    const steps = coverageSteps(policy.funding, baseline, calibration.asOf, HORIZON);
    return steps.length > 0 ? coverageLineText(steps[0]) : null;
  });
  const moneyRows = $derived(
    summaryRows(
      policy.funding,
      calibration?.baselineFunding,
      calibration ? fundingPresets(calibration) : []
    )
  );

  /** The shares (when not observed) and each stage whose months differ from observed. */
  const timingLines = $derived.by(() => {
    if (calibration === null) return [];
    const cal = calibration;
    const lines: string[] = [];
    const shares = shownRouteShares(current, cal);
    const observed = shownRouteShares(OBSERVED_TIMING.current, cal);
    if (PATHWAYS.some((p) => shares[p] !== observed[p]))
      lines.push(`Shares: ${PATHWAYS.map((p) => `${ROUTE[p]} ${shares[p]} %`).join(', ')}`);
    for (const p of PATHWAYS) {
      for (const v of routeView(cal, current, p)) {
        const was = roundHalf(v.observedMonths);
        if (v.months === was) continue;
        lines.push(`${v.label}, ${ROUTE[p]}: ${monthsText(v.months)} (observed ${was})`);
      }
    }
    if (!current.localProgramStreamlined)
      lines.push('Family Zoning Plan Local Program lots do not use the streamlined route');
    return lines;
  });
</script>

<div class="flex flex-col gap-4 text-sm text-ink dark:text-ink-dark">
  <section class="flex flex-col gap-1" aria-labelledby="{uid}-rules">
    <h3 id="{uid}-rules" class="font-semibold">Transit layers</h3>
    {#if policy.rules.length === 0}
      <p class={MUTED}>No transit layers</p>
    {:else}
      <ul class="flex flex-col gap-1">
        {#each policy.rules as r (r.id)}
          <li class={ROW}>{ruleSummary(r, lotsText(lotsOf(`rule:${r.id}`)))}</li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="flex flex-col gap-1" aria-labelledby="{uid}-custom">
    <h3 id="{uid}-custom" class="font-semibold">Painted areas</h3>
    {#if policy.custom.length === 0}
      <p class={MUTED}>No painted areas</p>
    {:else}
      <ul class="flex flex-col gap-1">
        {#each policy.custom as b (b.id)}
          <li class={ROW}>{customSummary(b, lotsText(lotsOf(`custom:${b.id}`)))}</li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="flex flex-col gap-1" aria-labelledby="{uid}-protections">
    <h3 id="{uid}-protections" class="font-semibold">Protections</h3>
    <p class={ROW}>{protections}</p>
  </section>

  <section class="flex flex-col gap-1" aria-labelledby="{uid}-timing">
    <h3 id="{uid}-timing" class="font-semibold">Permitting timelines</h3>
    <p class={ROW}>{timingLabel(current)}</p>
    {#if timingLines.length > 0}
      <button
        type="button"
        class="flex min-h-6 min-w-6 items-center gap-1 rounded-md px-2 text-left font-semibold hover:bg-surface-raised dark:hover:bg-surface-dark-raised pointer-coarse:min-h-11"
        aria-expanded={open}
        aria-controls={detailsId}
        onclick={() => (open = !open)}
        >Shares and changed stages<span aria-hidden="true">{open ? '−' : '+'}</span></button
      >
      <ul id={detailsId} hidden={!open} class="flex flex-col gap-1">
        {#each timingLines as line (line)}
          <li class={ROW}>{line}</li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="flex flex-col gap-1" aria-labelledby="{uid}-money">
    <h3 id="{uid}-money" class="font-semibold">Public money</h3>
    {#if coverageLine}
      <p class="font-semibold">{coverageLine}</p>
    {/if}
    <ul class="flex flex-col gap-1">
      {#each moneyRows as r, i (i)}
        <li
          class="{ROW}{r.indent ? ' ml-4' : ''}{r.muted ? ` ${MUTED}` : ''}"
          data-indent={r.indent}
        >
          {r.text}
        </li>
      {/each}
    </ul>
  </section>
</div>
