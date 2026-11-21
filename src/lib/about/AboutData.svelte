<!--
  About, part 3: data and licences. The dataset version, the manifest's sources, every notice
  and the software credits (what /attribution showed before it redirected here). The Overture
  notice is built from the manifest's `overture:*` sources (overtureNotice). Without a manifest
  it shows the version alone and the fixed notices. Headings at `level` and `level + 1`; colours
  only from --about-muted and --about-line, which the container sets (docs/dev/about.md).
-->
<script lang="ts">
  import { REPO_URL } from '$lib/config';
  import { SOFTWARE, isoDate } from '$lib/attribution';
  import type { ManifestSources } from '$lib/data/manifest';
  import { ABOUT_ID, PART_HEADING } from './copy';
  import { LICENCE_LINK, listJoin, overtureNotice } from './credits';

  let {
    level,
    datasetVersion,
    manifest
  }: { level: 2 | 3; datasetVersion: string; manifest: ManifestSources | null } = $props();

  const sub = $derived(`h${level + 1}`);
  const hasScenario = $derived(!!manifest?.scenarios?.fzp);
  const hasPolicy = $derived(!!manifest?.scenarios?.fzp?.policy);
  const hasTransit = $derived(manifest?.sources.some((s) => s.id.startsWith('gtfs-')) ?? false);
  // "from A and B under the ODbL, C under X and D under CC BY 4.0": each clause's words before
  // its licence, joined as a list; none gives "under the ODbL" alone.
  const clauses = $derived(
    overtureNotice(manifest?.sources ?? []).map((c, i, all) => ({
      license: c.license,
      lead: `${i === 0 ? 'from ' : i === all.length - 1 ? ' and ' : ', '}${listJoin(c.names)} under `
    }))
  );
</script>

{#snippet licence(id: string)}{#if LICENCE_LINK[id]}<a
      class="underline"
      href={LICENCE_LINK[id].url}
      rel="noopener noreferrer">{LICENCE_LINK[id].text}</a
    >{:else}{id}{/if}{/snippet}

<section id={ABOUT_ID.data}>
  <svelte:element this={`h${level}`} class="text-lg font-semibold"
    >{PART_HEADING.data}</svelte:element
  >

  {#if manifest}
    <p class="mt-3">
      Dataset version <code>{manifest.datasetVersion}</code>, built {isoDate(manifest.builtAt)}.
    </p>
    <svelte:element this={sub} class="mt-4 font-semibold">Sources</svelte:element>
    <div class="mt-2 overflow-x-auto">
      <table class="w-full text-left">
        <caption class="sr-only">Data sources for this dataset version</caption>
        <thead>
          <tr class="border-b border-(--about-line)">
            <th scope="col" class="pr-4 pb-1">Source</th>
            <th scope="col" class="pr-4 pb-1">Licence</th>
            <th scope="col" class="pb-1">Retrieved</th>
          </tr>
        </thead>
        <tbody>
          {#each manifest.sources as source (source.id)}
            <tr>
              <td class="pr-4"
                ><a
                  class="inline-flex min-h-6 items-center underline"
                  href={source.url}
                  rel="noopener noreferrer">{source.label ?? source.id}</a
                ></td
              >
              <td class="pr-4">{source.license}</td>
              <td class="whitespace-nowrap text-(--about-muted)">{isoDate(source.retrievedAt)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <p class="mt-3">Dataset version <code>{datasetVersion}</code>.</p>
    <p class="mt-3">Source list unavailable for this dataset version.</p>
  {/if}

  <svelte:element this={sub} class="mt-4 font-semibold">Licences and notices</svelte:element>
  <ul class="mt-2 list-disc space-y-2 pl-5">
    <li>
      Map data © <a
        class="underline"
        href="https://www.openstreetmap.org/copyright"
        rel="noopener noreferrer">OpenStreetMap contributors</a
      >, available under the Open Database License (ODbL).
    </li>
    <li>
      Buildings © Overture Maps Foundation, {#each clauses as c (c.license)}{c.lead}{@render licence(
          c.license
        )}{:else}under {@render licence('ODbL-1.0')}{/each}.
    </li>
    <li>Basemap by Protomaps (protomaps.com): BSD-3-Clause code, ODbL data.</li>
    <li>
      Parcels, land use, building footprints and neighborhoods from DataSF (datasf.org), Public
      Domain Dedication and License (PDDL) / public domain.
    </li>
    {#if hasScenario}
      <li>
        Housing project records (building permits, Planning applications, approvals and completions,
        the development pipeline), the assessor's secured roll, the City Lands inventory of
        city-owned land and the Family Zoning Plan height districts from DataSF, under PDDL, CC0 or
        public domain. The simulation's comparison estimates are cited from SF Planning and the SF
        Controller's Office.
      </li>
    {/if}
    {#if hasTransit}
      <li>
        Transit stops and schedules from SFMTA Muni, BART and Caltrain GTFS feeds. These are facts,
        credited as a courtesy; vehicle capacities are agency planning figures.
      </li>
    {/if}
    {#if hasPolicy}
      <li>
        Street centerlines and historic resource status from DataSF, under PDDL. SB 79 exemption
        parcel tables from San Francisco Board of Supervisors File No. 260132 (Ordinance No.
        082-26), SF public record (Board File 260132). Zoning rules follow California Government
        Code §§65912.155–65912.162 (SB 79, 2025) and San Francisco Planning Code §207.11.
      </li>
    {/if}
    <li>
      Derived data files under <code>/data/</code> that incorporate OpenStreetMap or Overture data are
      made available under the ODbL 1.0.
    </li>
  </ul>

  <svelte:element this={sub} class="mt-4 font-semibold">Software</svelte:element>
  <ul class="mt-2 list-disc space-y-1 pl-5">
    {#each SOFTWARE as sw (sw.name)}
      <li>
        <a class="underline" href={sw.url} rel="noopener noreferrer">{sw.name}</a>, {sw.license}
      </li>
    {/each}
  </ul>
  <p class="mt-3">
    This project's <a class="underline" href={REPO_URL}>code</a> is
    <a class="underline" href="{REPO_URL}/blob/main/LICENSE">MIT licensed</a>.
  </p>
</section>
