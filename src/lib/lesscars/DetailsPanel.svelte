<!--
  The /lesscars details (opened from the header headline): the headline as a sentence, the band,
  the source breakdown (a table whose rows add to the total, plus a divergent bar per row), the
  extra-homes chart, the amenities note, the map key and the evidence button.
  Map-key swatches carry the non-colour cues (width, dash, double stroke) the map draws.
-->
<script lang="ts">
  import type { LessCarsSitesFile, LessCarsSummary } from '$lib/data/lesscars/codec';
  import { TOKENS } from '$lib/map/palette';
  import { useSystemTheme } from '$lib/map/system-theme.svelte';
  import { formatCount } from '$lib/scoreboard/format';
  import type { Day } from '$lib/timelapse/time';
  import {
    AMENITIES_COPY,
    BUILDING_NOTE,
    breakdownCaption,
    freedLandCopy,
    garageCostCopy,
    headlineSentence
  } from './copy';
  import ExtraChart from './ExtraChart.svelte';
  import { LESSCARS_LEGEND } from './legend';
  import {
    bandText,
    breakdownRows,
    freedLandSplit,
    homesAt,
    revealedYearIndex,
    yearAt
  } from './summary-view';

  interface Props {
    summary: LessCarsSummary;
    sites: LessCarsSitesFile;
    day: Day;
    /** The furthest day reached; figures show the latest year end at or before it. */
    highWater: Day;
    onevidence: () => void;
  }
  let { summary, sites, day, highWater, onevidence }: Props = $props();

  const theme = useSystemTheme();
  const idx = $derived(revealedYearIndex(summary, highWater));
  const rows = $derived(breakdownRows(summary, idx));
  const total = $derived(homesAt(summary, idx));
  const year = $derived(yearAt(summary, idx));
  const scale = $derived(Math.max(1, ...rows.map((r) => Math.abs(r.homes))));
  const land = $derived(freedLandSplit(sites));
  // The disclosure belongs to the v1.1 sites file: any site carrying `parcels` (the key is absent
  // in v1 files, so a published v1 dataset renders as before).
  const hasParcelInfo = $derived(sites.sites.some((s) => s.parcels !== undefined));
  const landText = $derived(
    hasParcelInfo && land.parcelM2 + land.rowM2 > 0
      ? freedLandCopy((land.parcelM2 / 10000).toFixed(1), (land.rowM2 / 10000).toFixed(1))
      : null
  );
  const garageHomes = $derived((summary.garageCost ?? []).reduce((a, g) => a + g.homes, 0));
  const color = (t: (typeof LESSCARS_LEGEND)[number]['token']) => TOKENS[theme.current][t];
</script>

<div class="space-y-3 text-sm" data-testid="lc-panel">
  <p class="font-semibold">{headlineSentence(total, year, idx >= 0)}</p>
  {#if idx >= 0}
    <p class="text-gray-700 dark:text-gray-300">{bandText(summary, idx)}</p>
  {/if}

  <table class="w-full border-collapse text-left tabular-nums">
    <caption class="pb-1 text-left text-xs font-semibold text-gray-600 dark:text-gray-400"
      >{breakdownCaption(year)}</caption
    >
    <thead class="sr-only">
      <tr><th scope="col">Source</th><th scope="col">Homes</th></tr>
    </thead>
    <tbody>
      {#each rows as r (r.source)}
        <tr class="border-t border-gray-200 dark:border-gray-700"
          ><th scope="row" class="w-1/2 py-1 pr-2 font-normal">{r.label}</th><td class="py-1"
            ><span class="inline-block w-14 text-right">{formatCount(r.homes)}</span><span
              class="relative ml-2 inline-block h-2 w-20 align-middle"
              aria-hidden="true"
              ><span class="absolute inset-y-0 left-1/2 w-px bg-gray-400"></span><span
                class="absolute inset-y-0 bg-blue-700 dark:bg-blue-400"
                style:left={r.homes >= 0 ? '50%' : `${50 - (Math.abs(r.homes) / scale) * 50}%`}
                style:width="{(Math.abs(r.homes) / scale) * 50}%"
              ></span></span
            ></td
          ></tr
        >
      {/each}
    </tbody>
    <tfoot>
      <tr class="border-t-2 border-gray-400 font-semibold"
        ><th scope="row" class="py-1 pr-2 text-left">Total</th><td class="py-1"
          ><span class="inline-block w-14 text-right">{formatCount(total)}</span></td
        ></tr
      >
    </tfoot>
  </table>

  {#if landText}
    <p class="text-gray-700 dark:text-gray-300">{landText}</p>
  {/if}
  {#if summary.garageCost && garageHomes > 0}
    <p class="text-gray-700 dark:text-gray-300">{garageCostCopy(garageHomes)}</p>
  {/if}

  <ExtraChart {summary} {day} {highWater} />

  <p class="text-gray-700 dark:text-gray-300">{AMENITIES_COPY}</p>

  <details class="rounded-md border border-gray-300 dark:border-gray-600">
    <summary class="min-h-6 cursor-pointer px-2 py-1 font-semibold pointer-coarse:min-h-11"
      >Map key</summary
    >
    <ul class="space-y-1 px-2 pb-2">
      {#each LESSCARS_LEGEND as row (row.id)}
        <li class="flex items-center gap-2">
          <svg width="40" height="16" viewBox="0 0 40 16" aria-hidden="true" class="shrink-0">
            {#if row.kind === 'line'}
              {#each row.double ? [-1, 1] : [0] as side (side)}
                <line
                  x1="2"
                  x2="38"
                  y1={8 + side * (row.gap / 2 + (row.width ?? 2) / 2)}
                  y2={8 + side * (row.gap / 2 + (row.width ?? 2) / 2)}
                  stroke={color(row.token)}
                  stroke-width={row.double ? Math.max(1, (row.width ?? 2) / 2) : (row.width ?? 2)}
                  stroke-dasharray={row.dash
                    ? row.dash.map((d) => d * (row.width ?? 2)).join(' ')
                    : undefined}
                />
              {/each}
            {:else if row.kind === 'disc'}
              <circle
                cx="20"
                cy="8"
                r={row.radius ?? 5}
                fill="none"
                stroke={color(row.token)}
                stroke-width="2"
              />
            {:else if row.kind === 'square'}
              <rect x="13" y="1" width="14" height="14" fill={color(row.token)} />
            {:else}
              <rect
                x="3"
                y="2"
                width="34"
                height="12"
                fill={color(row.token)}
                fill-opacity="0.35"
                stroke={color(row.token)}
                stroke-width="1.5"
              />
            {/if}
          </svg>
          <span>{row.label}</span>
        </li>
      {/each}
    </ul>
    <p class="px-2 pb-2 text-xs text-gray-600 dark:text-gray-400">{BUILDING_NOTE}</p>
  </details>

  <button
    type="button"
    class="min-h-6 rounded-md border border-gray-300 px-3 py-1 font-semibold dark:border-gray-600 pointer-coarse:min-h-11"
    onclick={onevidence}>Evidence for every number</button
  >
</div>
