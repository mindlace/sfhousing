<!--
  The project card (spec §4.8): an interactive panel over the map. It renders a `SummaryState` and
  never requests anything itself; FzpMode owns the requests. All text comes from card.ts.
-->
<script lang="ts">
  import type { Calibration } from '$lib/timelapse/types';
  import type { Day } from '$lib/timelapse/time';
  import {
    CHANCE_EXPLANATION,
    RESEARCH_NOTE,
    SIMULATED_DISCLAIMER,
    cardStatus,
    chanceLine,
    chanceProvenance,
    dataNotes,
    massingNote,
    phaseLine,
    revisionLines,
    sizeLine,
    sourceLinks,
    statusText,
    timelineRows,
    type ChanceTable
  } from './card';
  import { PATHWAY_LABEL, TIER_LABEL } from './labels';
  import { SUMMARY_COPY, type SummaryState } from './summary-request';

  interface Props {
    state: SummaryState;
    day: Day;
    asOf: Day;
    calibration: Calibration;
    chance: ChanceTable;
    onclose: () => void;
    /** A dialog section id from `chanceProvenance` (the "How is this estimated?" list). */
    onsource: (sectionId: string) => void;
  }
  let { state, day, asOf, calibration, chance, onclose, onsource }: Props = $props();

  const headingId = $props.id();

  const card = $derived(state.kind === 'project' ? state.card : null);
  const status = $derived(card ? cardStatus(card, day, chance) : null);
  const marked = $derived(card !== null && card.quality.length > 0);
  const heading = $derived(card ? card.label : 'Project details');
  const message = $derived.by(() => {
    if (state.kind === 'idle') return null;
    if (state.kind === 'project') return status ? null : SUMMARY_COPY.none;
    return SUMMARY_COPY[state.kind];
  });
  const estimate = $derived(
    card && status && status.kind === 'inStage' && status.chance !== null
      ? chanceProvenance(calibration, card, status.stage)
      : null
  );
  const rows = $derived(card ? timelineRows(card, day, asOf, marked) : []);
  /** Rows split at the "This phase" heading (phase cards only). */
  const timeline = $derived.by(() => {
    const at = rows.findIndex((r) => r.heading !== null);
    return at < 0
      ? { before: rows, phase: [] as typeof rows }
      : { before: rows.slice(0, at), phase: rows.slice(at) };
  });
  const notes = $derived(card ? dataNotes(card) : null);
  const links = $derived(card ? sourceLinks(card.sources) : []);

  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented || state.kind === 'idle') return;
    // Escape belongs to the sources dialog while it is open.
    if (document.querySelector('dialog:modal')) return;
    onclose();
  }
</script>

<svelte:window {onkeydown} />

{#if state.kind !== 'idle'}
  <section
    aria-labelledby={headingId}
    class="absolute inset-x-4 bottom-[calc(var(--map-controls-br-block-size,60px)+8px)] z-20 max-h-1/2 overflow-y-auto rounded-lg bg-white p-4 text-sm text-black shadow-lg md:inset-x-auto md:top-4 md:bottom-auto md:left-4 md:max-h-[calc(100%-2rem-var(--fzp-scrubber-h,0px))] md:w-80"
  >
    <div class="flex items-start justify-between gap-2">
      <h2 id={headingId} class="text-base font-semibold">{heading}</h2>
      <button
        type="button"
        class="min-h-11 min-w-11 shrink-0 rounded-md px-2 text-sm font-semibold underline"
        onclick={onclose}
      >
        Close
      </button>
    </div>

    {#if message !== null}
      <p class="mt-2 text-gray-800" role="status">{message}</p>
    {:else if card && status}
      <p
        class="mt-1 inline-block rounded-full border border-gray-700 px-2 py-0.5 text-xs font-semibold"
        data-testid="card-badge"
      >
        {card.origin === 'pipeline' ? 'Real project' : 'Simulated project'}
      </p>
      {#if phaseLine(card)}
        <p class="mt-2">{phaseLine(card)}</p>
      {/if}
      {#if massingNote(card)}
        <p class="mt-2 text-gray-800">{massingNote(card)}</p>
      {/if}
      {#if card.origin === 'simulated'}
        <p class="mt-2 text-gray-800">{SIMULATED_DISCLAIMER}</p>
      {/if}

      <p class="mt-2">{PATHWAY_LABEL[card.pathway]}</p>
      <p class="mt-2 font-semibold">{statusText(status, card, asOf)}</p>
      <p class="mt-1">{sizeLine(card, day, marked)}</p>
      {#each revisionLines(card, day, asOf) as line, i (i)}
        <p class="text-gray-800">{line}</p>
      {/each}

      {#if estimate && status.chance !== null}
        <div class="mt-3">
          <p class="font-semibold">{chanceLine(status.chance)}</p>
          {#if estimate.research}
            <p class="text-gray-800">This is {RESEARCH_NOTE}.</p>
          {/if}
          <p class="text-gray-800">{CHANCE_EXPLANATION}</p>
          <details class="mt-1">
            <summary class="min-h-6 cursor-pointer pointer-coarse:min-h-11"
              >How is this estimated?</summary
            >
            <ul class="mt-1 space-y-1">
              {#each estimate.entries as e, i (i)}
                <li>
                  <button
                    type="button"
                    class="inline-flex min-h-6 items-center text-left underline pointer-coarse:min-h-11"
                    onclick={() => onsource(e.sectionId)}
                  >
                    {TIER_LABEL[e.tier as 0 | 1 | 2 | 3 | 4]}: {e.label}
                  </button>
                </li>
              {/each}
            </ul>
          </details>
        </div>
      {/if}

      <h3 class="mt-3 font-semibold">Timeline</h3>
      <ol class="mt-1 space-y-1">
        {#each timeline.before as r, i (i)}
          <li>{r.text}</li>
        {/each}
      </ol>
      {#if timeline.phase.length > 0}
        <h4 class="mt-2 font-semibold">This phase</h4>
        <ol class="mt-1 space-y-1">
          {#each timeline.phase as r, i (i)}
            <li>{r.text}</li>
          {/each}
        </ol>
      {/if}

      {#if notes}
        <h3 class="mt-3 font-semibold">{notes.heading}</h3>
        <ul class="mt-1 list-disc space-y-1 pl-5">
          {#each notes.items as item, i (i)}
            <li>{item}</li>
          {/each}
        </ul>
        <p class="mt-1 text-gray-800">{notes.footer}</p>
      {/if}

      {#if links.length > 0}
        <h3 class="mt-3 font-semibold">Sources</h3>
        <ul class="mt-1 space-y-1">
          {#each links as link, i (i)}
            <li>
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex min-h-6 items-center underline pointer-coarse:min-h-11"
                >{link.text}<span class="sr-only"> (opens in a new tab)</span></a
              >
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </section>
{/if}
