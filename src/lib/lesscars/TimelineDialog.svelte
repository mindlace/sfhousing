<!--
  The /lesscars project timeline: a modal dialog listing every plan project by group (start, open,
  homes-built months) with a bar per row over the scrubber range and an Evidence button. The bars
  are decoration (aria-hidden); the dates in the cells carry the same facts as text.
-->
<script lang="ts">
  import type { LessCarsPlanFile } from '$lib/data/lesscars/codec';
  import { LESSCARS_HORIZON, LESSCARS_START } from '$lib/data/lesscars/schedule';
  import { formatShortMonthYear } from '$lib/fzp/format';
  import type { Day } from '$lib/timelapse/time';
  import {
    GROUP_LABEL,
    GROUP_ORDER,
    KIND_LABEL,
    timelineRows,
    type TimelineRow
  } from './timeline-view';

  interface Props {
    plan: LessCarsPlanFile;
    day: Day;
    onevidence: (projectId: string) => void;
  }
  let { plan, day, onevidence }: Props = $props();

  let dlg = $state<HTMLDialogElement>();
  export function show(): void {
    if (dlg && !dlg.open) dlg.showModal();
  }

  const rows = $derived(timelineRows(plan));
  const groups = $derived(
    GROUP_ORDER.map((g) => ({ group: g, rows: rows.filter((r) => r.group === g) })).filter(
      (g) => g.rows.length > 0
    )
  );
  const COLLAPSE_OVER = 6;

  const SPAN = LESSCARS_HORIZON - LESSCARS_START;
  const pct = (d: Day) => Math.min(100, Math.max(0, ((d - LESSCARS_START) / SPAN) * 100));
  const left = (a: Day) => `${pct(a)}%`;
  const width = (a: Day, b: Day) => `${Math.max(0.6, pct(b) - pct(a))}%`;
  const built = (r: TimelineRow) =>
    r.build
      ? `${formatShortMonthYear(r.build.startDay)} to ${formatShortMonthYear(r.build.completeDay)}`
      : '—';

  function evidence(id: string) {
    dlg?.close();
    onevidence(id);
  }
</script>

{#snippet table(group: (typeof groups)[number])}
  <table class="w-full border-collapse text-left text-sm">
    <caption class="pb-1 text-left text-sm font-semibold">{GROUP_LABEL[group.group]}</caption>
    <thead class="text-xs text-gray-700 dark:text-gray-300">
      <tr>
        <th scope="col" class="py-1 pr-2 font-medium">Project</th>
        <th scope="col" class="px-2 py-1 font-medium">Starts</th>
        <th scope="col" class="px-2 py-1 font-medium">Opens</th>
        <th scope="col" class="px-2 py-1 font-medium">Homes built</th>
        <th scope="col" class="px-2 py-1 font-medium"><span class="sr-only">Over time</span></th>
        <th scope="col" class="py-1 pl-2 font-medium"><span class="sr-only">Evidence</span></th>
      </tr>
    </thead>
    <tbody>
      {#each group.rows as r (r.id)}
        <tr class="border-t border-gray-200 align-middle dark:border-gray-700">
          <th scope="row" class="py-1.5 pr-2 font-normal">
            {r.label}
            <span class="block text-xs text-gray-700 dark:text-gray-300">{KIND_LABEL[r.kind]}</span>
          </th>
          <td class="px-2 py-1.5 whitespace-nowrap tabular-nums"
            >{formatShortMonthYear(r.startDay)}</td
          >
          <td class="px-2 py-1.5 whitespace-nowrap tabular-nums"
            >{formatShortMonthYear(r.openDay)}</td
          >
          <td class="px-2 py-1.5 tabular-nums">{built(r)}</td>
          <td class="min-w-24 px-2 py-1.5">
            <span
              class="relative block h-3 rounded-sm bg-gray-200 dark:bg-gray-700"
              aria-hidden="true"
            >
              <span
                class="absolute inset-y-0.5 rounded-sm bg-blue-700 dark:bg-blue-400"
                style:left={left(r.startDay)}
                style:width={width(r.startDay, r.openDay)}
              ></span>
              {#if r.build}
                <span
                  class="absolute inset-y-0 rounded-sm border-2 border-emerald-800 bg-emerald-200 dark:border-emerald-300 dark:bg-emerald-900"
                  style:left={left(r.build.startDay)}
                  style:width={width(r.build.startDay, r.build.completeDay)}
                ></span>
              {/if}
              <span
                class="absolute -inset-y-0.5 w-0.5 bg-gray-900 dark:bg-gray-100"
                style:left={left(day)}
              ></span>
            </span>
          </td>
          <td class="py-1.5 pl-2">
            <button
              type="button"
              aria-label="Evidence for {r.label}"
              class="min-h-6 min-w-6 rounded-md border border-gray-400 px-2 py-0.5 text-xs font-medium hover:bg-gray-100 dark:border-gray-500 dark:hover:bg-gray-800"
              onclick={() => evidence(r.id)}>Evidence</button
            >
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

<dialog
  bind:this={dlg}
  data-testid="lc-timeline"
  aria-labelledby="lc-timeline-h"
  class="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto rounded-lg bg-white p-5 text-gray-800 shadow-xl backdrop:bg-black/40 dark:bg-gray-900 dark:text-gray-100"
>
  <div class="flex items-start justify-between gap-3">
    <h2 id="lc-timeline-h" class="text-lg font-semibold">Project timeline</h2>
    <button
      type="button"
      class="min-h-6 rounded-md border border-gray-400 px-3 py-1 text-sm font-medium hover:bg-gray-100 dark:border-gray-500 dark:hover:bg-gray-800"
      onclick={() => dlg?.close()}>Close</button
    >
  </div>
  <p class="mt-1 text-sm text-gray-700 dark:text-gray-300">
    Transit opens first; streets close and homes are built after.
  </p>
  <div class="mt-3 space-y-5">
    {#each groups as g (g.group)}
      {#if g.group === 'housing' && g.rows.length > COLLAPSE_OVER}
        <details>
          <summary class="cursor-pointer py-1 text-sm font-semibold"
            >{GROUP_LABEL.housing} ({g.rows.length})</summary
          >
          {@render table(g)}
        </details>
      {:else}
        {@render table(g)}
      {/if}
    {/each}
  </div>
</dialog>
