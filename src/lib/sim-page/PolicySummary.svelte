<!--
  The read-only policy summary (plan 5, Call 15): what a shared policy turns on, in words, one
  compact block per section. The zoning layers and comparison, one line per brush (with its
  lots), the protections (hard choices stay visible), and the timelines' label. The route shares
  and every stage that differs from observed sit behind one disclosure, closed by default
  (compact UI, details on demand). No controls change the policy.
-->
<script lang="ts">
  import { PATHWAYS, type Calibration, type Pathway } from '$lib/timelapse/types';
  import type { StockLayerId } from '$lib/sim/levers/types';
  import { brushSummary, count, lotsText } from './brush-summary';
  import type { SimPolicy } from './policy';
  import { OBSERVED_TIMING, routeView, shownRouteShares, timingLabel } from './timing';

  interface Props {
    policy: SimPolicy;
    /** Null when the calibration failed to load: the timelines show their label only. */
    calibration: Calibration | null;
    /** Lots a brush (by its id) or the brushed protections (`'protect'`) cover; null if unknown. */
    lotsOf(key: string): number | null;
  }
  let { policy, calibration, lotsOf }: Props = $props();

  const uid = $props.id();
  const detailsId = `${uid}-timing-details`;
  let open = $state(false);

  const LAYER: Record<StockLayerId, string> = {
    currentLaw: 'Current law',
    fzp: 'Family Zoning Plan map',
    sb79: 'SB 79 as written',
    base: 'Zoning before the Family Zoning Plan'
  };
  const COMPARE: Record<SimPolicy['compare'], string> = {
    currentLaw: 'current law',
    preFzp: 'zoning before the Family Zoning Plan'
  };
  const ROUTE: Record<Pathway, string> = {
    discretionary: 'discretionary',
    streamlined: 'streamlined',
    permitOnly: 'permit only'
  };

  const roundHalf = (x: number) => Math.round(x * 2) / 2;
  const monthsText = (m: number) => (m === 1 ? '1 month' : `${m} months`);
  const lots = (key: string) => {
    const n = lotsOf(key);
    return n === null ? lotsText({ kind: 'finding' }) : lotsText({ kind: 'found', lots: n });
  };

  const protections = $derived.by(() => {
    const p = policy.protect;
    const items: string[] = [];
    if (p.rentControl) items.push('rent-controlled buildings');
    if (p.historic) items.push('historic buildings');
    if (p.newerThanYears !== null)
      items.push(`buildings newer than ${count(p.newerThanYears, 'year', 'years')}`);
    if (p.strokes.length > 0) items.push(`${lots('protect')} by brush`);
    if (items.length === 0) return 'None';
    const text = items.join('; ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  });

  const current = $derived(policy.timing.current);

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

<div class="divide-y divide-gray-200 text-sm text-black">
  <section class="px-4 py-3" aria-labelledby="{uid}-layers">
    <h3 id="{uid}-layers" class="font-semibold">Zoning layers</h3>
    <ul class="mt-1">
      {#each policy.stock as id (id)}
        <li>{LAYER[id]}</li>
      {/each}
    </ul>
    <p class="mt-1 text-gray-700">Compared with: {COMPARE[policy.compare]}</p>
    {#if policy.assumeAlternativePlanKept}
      <p class="mt-1 text-gray-700">Assumes the City keeps an alternative plan after 2031</p>
    {/if}
  </section>

  <section class="px-4 py-3" aria-labelledby="{uid}-brushes">
    <h3 id="{uid}-brushes" class="font-semibold">Brushes</h3>
    {#if policy.brushes.length === 0}
      <p class="mt-1 text-gray-700">No brushes</p>
    {:else}
      <ul class="mt-1 list-disc space-y-1 pl-4">
        {#each policy.brushes as b (b.id)}
          <li>{brushSummary(b, lots(b.id))}</li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="px-4 py-3" aria-labelledby="{uid}-protections">
    <h3 id="{uid}-protections" class="font-semibold">Protections</h3>
    <p class="mt-1">{protections}</p>
  </section>

  <section class="px-4 py-3" aria-labelledby="{uid}-timing">
    <h3 id="{uid}-timing" class="font-semibold">Permitting timelines</h3>
    <p class="mt-1">{timingLabel(current)}</p>
    {#if timingLines.length > 0}
      <button
        type="button"
        class="mt-1 flex min-h-6 min-w-6 items-center gap-1 text-left font-semibold underline pointer-coarse:min-h-11"
        aria-expanded={open}
        aria-controls={detailsId}
        onclick={() => (open = !open)}
        >Shares and changed stages<span aria-hidden="true">{open ? '−' : '+'}</span></button
      >
      <ul id={detailsId} hidden={!open} class="mt-1 list-disc space-y-1 pl-4 text-gray-800">
        {#each timingLines as line (line)}
          <li>{line}</li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
