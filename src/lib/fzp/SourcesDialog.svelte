<!--
  "Where these numbers come from" (spec §4.10): a native modal <dialog>, so it is inert behind,
  traps focus, closes on Escape and returns focus to its opener. Sections 1-9 come from
  `provenanceSections`; section 10 (the data checks) is this component's own state, loaded the
  first time the dialog opens and held for the page's lifetime.
-->
<script lang="ts">
  import type { TimelineScore } from '$lib/sim/protocol';
  import type { ProjectsFile } from '$lib/timelapse/projects';
  import type { Day } from '$lib/timelapse/time';
  import type { Calibration } from '$lib/timelapse/types';
  import { TIER_LABEL } from './labels';
  import {
    NOT_SF_NOTE,
    QUALITY_EMPTY,
    QUALITY_HEADING,
    QUALITY_INTRO,
    QUALITY_LOAD_FAILED,
    QUALITY_PARCEL_SENTENCE,
    QUALITY_SECTION_ID,
    loadProjectsFile,
    provenanceSections,
    qualityRows
  } from './provenance';

  interface Props {
    calibration: Calibration;
    score: TimelineScore | null;
    /** `manifest.scenarios.fzp.projects`; null until the manifest is known. */
    projectsUrl: string | null;
    /** In the interface for the caller; the "Simulated counts start" date is the calibration's `asOf`. */
    asOf: Day;
    fetchFn?: typeof fetch;
    onopen?: () => void;
  }
  // `asOf` is deliberately not read: the calibration carries the same date.
  // eslint-disable-next-line svelte/no-unused-props
  let { calibration, score, projectsUrl, fetchFn, onopen }: Props = $props();

  type Quality =
    | { kind: 'loading' }
    | { kind: 'failed' }
    | { kind: 'ready'; rows: ReturnType<typeof qualityRows> };

  const headingId = $props.id();
  const sections = $derived(provenanceSections(calibration, score));

  let dialog = $state<HTMLDialogElement | null>(null);
  let quality = $state<Quality>({ kind: 'loading' });
  let opener: HTMLElement | null = null;
  // The in-flight or settled load, held by the instance; a failure clears it so the next open retries.
  let loading: Promise<ProjectsFile> | null = null;

  function load() {
    if (loading !== null || projectsUrl === null) return;
    const attempt = loadProjectsFile(projectsUrl, fetchFn ?? ((...a) => fetch(...a)));
    loading = attempt;
    attempt.then(
      (file) => {
        quality = { kind: 'ready', rows: qualityRows(file) };
      },
      () => {
        if (loading === attempt) loading = null;
        quality = { kind: 'failed' };
      }
    );
  }

  /** Open the dialog, optionally scrolled to the section or entry with this id. */
  export function open(sectionId?: string): void {
    if (dialog === null) return;
    if (!dialog.open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    }
    onopen?.();
    if (quality.kind === 'failed') quality = { kind: 'loading' };
    load();
    if (sectionId !== undefined) {
      dialog.querySelector(`[id="${CSS.escape(sectionId)}"]`)?.scrollIntoView({ block: 'start' });
    }
  }

  /**
   * A native modal keeps the page inert, but Chromium still lets Tab leave through the browser's
   * own UI after the last control. Wrap instead, so focus never leaves the dialog.
   */
  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab' || dialog === null) return;
    const items = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || !dialog.contains(at))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !dialog.contains(at))) {
      e.preventDefault();
      first.focus();
    }
  }

  function onclose() {
    if (opener?.isConnected) opener.focus();
    opener = null;
  }

  /** Provenance links come from our own calibration file; still never render a non-http(s) href. */
  const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : undefined);
  const plural = (n: number) => `${n} ${n === 1 ? 'project' : 'projects'}`;
</script>

<dialog
  bind:this={dialog}
  aria-labelledby={headingId}
  {onclose}
  {onkeydown}
  class="m-auto w-full max-w-2xl rounded-lg bg-white p-0 text-black shadow-2xl backdrop:bg-black/50 open:flex open:max-h-[85vh] open:flex-col max-md:max-w-none"
>
  <div class="flex items-start justify-between gap-2 border-b border-gray-300 px-4 py-2">
    <h2 id={headingId} class="text-lg font-semibold">Where these numbers come from</h2>
    <button
      type="button"
      class="min-h-11 min-w-11 shrink-0 rounded-md px-2 text-sm font-semibold underline"
      onclick={() => dialog?.close()}
    >
      Close
    </button>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-6 text-sm">
    {#snippet badge(tier: 0 | 1 | 2 | 3 | 4)}
      <span
        data-testid="tier-badge"
        class="inline-block rounded-full border border-gray-700 px-2 py-0.5 text-xs font-semibold"
        >{TIER_LABEL[tier]}</span
      >
    {/snippet}

    {#snippet table(t: { caption: string; head: string[]; rows: string[][] })}
      <table class="mt-3 w-full border-collapse text-left">
        <caption class="pb-1 text-left font-semibold">{t.caption}</caption>
        <thead>
          <tr>
            {#each t.head as h, i (i)}
              <th scope="col" class="border-b border-gray-400 py-1 pr-2 font-semibold">{h}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each t.rows as row, r (r)}
            <tr>
              {#each row as cell, c (c)}
                <td
                  colspan={row.length < t.head.length ? t.head.length : undefined}
                  class="border-b border-gray-200 py-1 pr-2 align-top">{cell}</td
                >
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    {/snippet}

    {#each sections as s (s.id)}
      <section id={s.id} class="scroll-mt-2 pt-5">
        <h3 class="text-base font-semibold">{s.heading}</h3>
        {#each s.intro as p, i (i)}
          <p class="mt-2">{p}</p>
        {/each}
        {#each s.entries as e (e.id)}
          <article id={e.id} class="mt-3 scroll-mt-2 rounded-md border border-gray-300 p-3">
            <h4 class="font-semibold">{e.title}</h4>
            <p class="mt-1">{@render badge(e.prov.tier)}</p>
            {#each e.lines.slice(1) as line, i (i)}
              <p class={i === 0 ? 'mt-1 font-semibold' : 'mt-1'}>{line}</p>
            {/each}
            {#if e.research}
              <p class="mt-1 font-semibold">{NOT_SF_NOTE}</p>
            {/if}
            {#if e.shares.length > 0}
              <ul class="mt-1 list-disc pl-5">
                {#each e.shares as share (share)}
                  <li>{share}</li>
                {/each}
              </ul>
            {/if}
            {#if e.tail}
              <p class="mt-2">
                {@render badge(e.tail.tier)}
                <span>{e.tail.label}</span>
              </p>
              {#if e.tail.tier >= 3 && !e.research}
                <p class="mt-1 font-semibold">{NOT_SF_NOTE}</p>
              {/if}
            {/if}
            {#if e.prov.sources.length > 0}
              <ul class="mt-2 space-y-1">
                {#each e.prov.sources as src (src.url)}
                  <li>
                    <a
                      href={safeHref(src.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="underline"
                      >{src.label}<span class="sr-only"> (opens in a new tab)</span></a
                    >
                  </li>
                {/each}
              </ul>
            {/if}
          </article>
        {/each}
        {#each s.tables as t (t.caption)}
          {@render table(t)}
        {/each}
      </section>
    {/each}

    <section id={QUALITY_SECTION_ID} class="scroll-mt-2 pt-5">
      <h3 class="text-base font-semibold">{QUALITY_HEADING}</h3>
      {#if quality.kind === 'loading'}
        <p class="mt-2" role="status">Loading…</p>
      {:else if quality.kind === 'failed'}
        <p class="mt-2" role="status">{QUALITY_LOAD_FAILED}</p>
      {:else}
        <p class="mt-2">{QUALITY_INTRO}</p>
        {#if quality.rows.length === 0}
          <p class="mt-2">{QUALITY_EMPTY}</p>
        {:else}
          <table class="mt-3 w-full border-collapse text-left">
            <caption class="pb-1 text-left font-semibold">Data checks that changed a value</caption>
            <thead>
              <tr>
                <th scope="col" class="border-b border-gray-400 py-1 pr-2 font-semibold">Check</th>
                <th scope="col" class="border-b border-gray-400 py-1 pr-2 font-semibold"
                  >Kind of evidence</th
                >
                <th scope="col" class="border-b border-gray-400 py-1 pr-2 font-semibold"
                  >Projects changed</th
                >
              </tr>
            </thead>
            <tbody>
              {#each quality.rows as row (row.id)}
                <tr>
                  <td class="border-b border-gray-200 py-1 pr-2 align-top">{row.label}</td>
                  <td class="border-b border-gray-200 py-1 pr-2 align-top"
                    >{row.tierLabel}{#if row.research}
                      <span class="block">{NOT_SF_NOTE}</span>{/if}</td
                  >
                  <td class="border-b border-gray-200 py-1 pr-2 align-top">{plural(row.count)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
        <p class="mt-3">{QUALITY_PARCEL_SENTENCE}</p>
      {/if}
    </section>
  </div>
</dialog>
