<!--
  The /lesscars evidence dialog: every number in the plan with its evidence tier, label, method
  and sources. Tier 4 reads "Assumption, not data" (the tier label, as /sim shows it) and carries
  a visible "Invented" tag, so the tag never rests on colour alone. show(id) opens the dialog,
  scrolls that section's heading into view and focuses it.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import type { LessCarsPlanFile, LessCarsSummary } from '$lib/data/lesscars/codec';
  import { evidenceSections } from './evidence';

  interface Props {
    plan: LessCarsPlanFile;
    summary: LessCarsSummary;
  }
  let { plan, summary }: Props = $props();

  let dlg = $state<HTMLDialogElement>();
  const sections = $derived(evidenceSections(plan, summary));

  export function show(sectionId?: string): void {
    if (!dlg) return;
    if (!dlg.open) dlg.showModal();
    if (!sectionId) return;
    void tick().then(() => {
      const h = dlg?.querySelector<HTMLElement>(`[id="${CSS.escape(sectionId)}"]`);
      if (!h) return;
      h.scrollIntoView({ block: 'start' });
      h.focus({ preventScroll: true });
    });
  }
</script>

<dialog
  bind:this={dlg}
  data-testid="lc-evidence"
  aria-labelledby="lc-evidence-h"
  class="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto rounded-lg bg-white p-5 text-gray-800 shadow-xl backdrop:bg-black/40 dark:bg-gray-900 dark:text-gray-100"
>
  <div class="flex items-start justify-between gap-3">
    <h2 id="lc-evidence-h" class="text-lg font-semibold">Evidence for every number</h2>
    <button
      type="button"
      class="min-h-6 rounded-md border border-gray-500 px-3 py-1 text-sm font-medium hover:bg-gray-100 dark:border-gray-500 dark:hover:bg-gray-800"
      onclick={() => dlg?.close()}>Close</button
    >
  </div>
  <p class="mt-1 text-sm text-gray-700 dark:text-gray-300">
    Every number in the plan says what kind of evidence it rests on. Numbers marked 'Assumption, not
    data' are invented and have no source.
  </p>
  <p class="mt-1 text-sm text-gray-700 dark:text-gray-300">
    Transit line paths are drawn straight between stations (approximate).
  </p>
  <div class="mt-3 space-y-5">
    {#each sections as s (s.id)}
      <section aria-labelledby={s.id}>
        <h3
          id={s.id}
          tabindex="-1"
          class="text-base font-semibold focus:outline-2 focus:outline-offset-2 focus:outline-blue-700 dark:focus:outline-blue-300"
        >
          {s.heading}
        </h3>
        <ul class="mt-2 space-y-3">
          {#each s.rows as r, i (i)}
            <li class="border-t border-gray-200 pt-2 text-sm dark:border-gray-700">
              <p class="flex flex-wrap items-baseline gap-x-2 font-medium">
                <span>{r.name}</span>
                {#if r.value}<span class="tabular-nums">{r.value}</span>{/if}
                {#if r.invented}
                  <span
                    class="rounded-sm border border-amber-800 bg-amber-100 px-1.5 text-xs font-semibold text-amber-950 dark:border-amber-300 dark:bg-amber-950 dark:text-amber-100"
                    >Invented</span
                  >
                {/if}
              </p>
              <ul class="mt-1 text-gray-700 dark:text-gray-300">
                {#each r.lines as line, j (j)}
                  <li class={j === 0 ? 'font-medium' : ''}>{line}</li>
                {/each}
              </ul>
              {#if r.prov.sources.length > 0}
                <p class="mt-1 break-words">
                  Sources:
                  {#each r.prov.sources as src, k (k)}{k > 0 ? '; ' : ''}<a
                      class="underline"
                      href={src.url}>{src.label}</a
                    >{/each}
                </p>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
</dialog>
