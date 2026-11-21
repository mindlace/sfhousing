<!--
  The assumptions' body: sections 1-9 from `provenanceSections` (or `modelSections`), then section
  10, the data checks, which is this component's own state: loaded when `load` turns true or on
  `loadChecks()`, held for its lifetime; after a failure the next `loadChecks()` tries again.
  Shown in /sim's Sources dialog and in About's assumptions (docs/dev/fzp-mode.md). Section
  headings at `level`, entries one below. Rules and borders read --about-line, which the container
  sets (docs/dev/about.md); the badge and the tables' head rule keep the control line.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { ProjectsFile } from '$lib/timelapse/projects';
  import { perHomeMethod } from '$lib/timeline/copy';
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
    qualityRows,
    type ProvSection
  } from './provenance';

  interface Props {
    sections: ProvSection[];
    /** `manifest.scenarios.fzp.projects`; null until the manifest is known. */
    projectsUrl: string | null;
    /** The sections' heading level; entries are one below. */
    level: 3 | 4;
    fetchFn?: typeof fetch;
    /** Start the data checks' load (the page, once the body shows; the dialog calls loadChecks). */
    load?: boolean;
  }

  let { sections, projectsUrl, level, fetchFn, load = false }: Props = $props();

  type Quality =
    | { kind: 'loading' }
    | { kind: 'failed' }
    | { kind: 'ready'; rows: ReturnType<typeof qualityRows> };

  let quality = $state<Quality>({ kind: 'loading' });
  // The in-flight or settled load, held by the instance; a failure clears it so the next start retries.
  let loading: Promise<ProjectsFile> | null = null;

  /**
   * Start the data checks' load: a no-op while one is in flight or done, a retry after a failure.
   * The dialog calls it on every open; `load` calls it once.
   */
  export function loadChecks(): void {
    if (projectsUrl === null) return;
    if (quality.kind === 'failed') quality = { kind: 'loading' };
    if (loading !== null) return;
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

  $effect(() => {
    // Only `load` and the URL start a load: a failure must not retry by itself.
    if (load && projectsUrl !== null) untrack(loadChecks);
  });

  const heading = $derived(`h${level}`);
  const entryHeading = $derived(`h${level + 1}`);

  /** Provenance links come from our own calibration file; still never render a non-http(s) href. */
  const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : undefined);
  const plural = (n: number) => `${n} ${n === 1 ? 'project' : 'projects'}`;
</script>

{#snippet badge(tier: 0 | 1 | 2 | 3 | 4)}
  <span
    data-testid="tier-badge"
    class="inline-block rounded-full border border-control-line px-2 py-0.5 text-xs font-semibold dark:border-control-line-dark"
    >{TIER_LABEL[tier]}</span
  >
{/snippet}

{#snippet table(t: { caption: string; head: string[]; rows: string[][] })}
  <table class="mt-3 w-full border-collapse text-left">
    <caption class="pb-1 text-left font-semibold">{t.caption}</caption>
    <thead>
      <tr>
        {#each t.head as h, i (i)}
          <th
            scope="col"
            class="border-b border-control-line py-1 pr-2 font-semibold dark:border-control-line-dark"
            >{h}</th
          >
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each t.rows as row, r (r)}
        <tr>
          {#each row as cell, c (c)}
            <td
              colspan={row.length < t.head.length ? t.head.length : undefined}
              class="border-b border-(--about-line) py-1 pr-2 align-top">{cell}</td
            >
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

{#each sections as s (s.id)}
  <section id={s.id} class="scroll-mt-2 pt-5">
    <svelte:element this={heading} class="text-base font-semibold">{s.heading}</svelte:element>
    {#each s.intro as p, i (i)}
      <p class="mt-2">{p}</p>
    {/each}
    {#each s.entries as e (e.id)}
      <article id={e.id} class="mt-3 scroll-mt-2 rounded-md border border-(--about-line) p-3">
        <svelte:element this={entryHeading} class="font-semibold">{e.title}</svelte:element>
        <p class="mt-1">{@render badge(e.prov.tier)}</p>
        {#each e.lines.slice(1) as line, i (i)}
          <p class={i === 0 ? 'mt-1 font-semibold' : 'mt-1'}>
            {line === e.prov.method ? perHomeMethod(line) : line}
          </p>
        {/each}
        {#if e.research}
          <p class="mt-1 font-semibold">{NOT_SF_NOTE}</p>
        {/if}
        {#if e.shares.length > 0}
          <ul class="mt-1 list-disc pl-5">
            {#each e.shares as share, i (i)}
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
            {#each e.prov.sources as src, i (i)}
              <li>
                <a
                  href={safeHref(src.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex min-h-6 min-w-6 items-center underline"
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
  <svelte:element this={heading} class="text-base font-semibold">{QUALITY_HEADING}</svelte:element>
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
            <th
              scope="col"
              class="border-b border-control-line py-1 pr-2 font-semibold dark:border-control-line-dark"
              >Check</th
            >
            <th
              scope="col"
              class="border-b border-control-line py-1 pr-2 font-semibold dark:border-control-line-dark"
              >Kind of evidence</th
            >
            <th
              scope="col"
              class="border-b border-control-line py-1 pr-2 font-semibold dark:border-control-line-dark"
              >Projects changed</th
            >
          </tr>
        </thead>
        <tbody>
          {#each quality.rows as row (row.id)}
            <tr>
              <td class="border-b border-(--about-line) py-1 pr-2 align-top">{row.label}</td>
              <td class="border-b border-(--about-line) py-1 pr-2 align-top"
                >{row.tierLabel}{#if row.research}
                  <span class="block">{NOT_SF_NOTE}</span>{/if}</td
              >
              <td class="border-b border-(--about-line) py-1 pr-2 align-top">{plural(row.count)}</td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    <p class="mt-3">{QUALITY_PARCEL_SENTENCE}</p>
  {/if}
</section>
