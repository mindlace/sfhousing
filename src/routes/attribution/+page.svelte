<script lang="ts">
  import type { PageData } from './$types';
  import { REPO_URL } from '$lib/config';
  import { SOFTWARE, isoDate } from '$lib/attribution';

  let { data }: { data: PageData } = $props();
  const manifest = $derived(data.manifest);
</script>

<svelte:head><title>Data &amp; licences · SF Housing Simulator</title></svelte:head>

<h1 class="text-2xl font-semibold">Data &amp; licences</h1>

{#if manifest}
  <p class="mt-3">
    Dataset version <code>{manifest.datasetVersion}</code>, built {isoDate(manifest.builtAt)}.
  </p>
  <h2 class="mt-6 text-lg font-semibold">Sources</h2>
  <div class="mt-3 overflow-x-auto">
    <table class="w-full text-left">
      <caption class="sr-only">Data sources for this dataset version</caption>
      <thead>
        <tr>
          <th scope="col" class="pr-4 pb-2">Source</th>
          <th scope="col" class="pr-4 pb-2">Licence</th>
          <th scope="col" class="pb-2">Retrieved</th>
        </tr>
      </thead>
      <tbody>
        {#each manifest.sources as source (source.id)}
          <tr>
            <td class="py-1 pr-4"
              ><a class="underline" href={source.url} rel="noopener noreferrer"
                >{source.label ?? source.id}</a
              ></td
            >
            <td class="py-1 pr-4">{source.license}</td>
            <td class="py-1">{isoDate(source.retrievedAt)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{:else}
  <p class="mt-3">Source list unavailable for this dataset version.</p>
{/if}

<h2 class="mt-6 text-lg font-semibold">Licences and notices</h2>
<ul class="mt-3 list-disc space-y-2 pl-5">
  <li>
    Map data © <a
      class="underline"
      href="https://www.openstreetmap.org/copyright"
      rel="noopener noreferrer">OpenStreetMap contributors</a
    >, available under the Open Database License (ODbL).
  </li>
  <li>
    Buildings © Overture Maps Foundation; OSM-derived data under ODbL, other data under CDLA
    Permissive 2.0.
  </li>
  <li>Basemap by Protomaps (protomaps.com): BSD-3-Clause code, ODbL data.</li>
  <li>
    Parcels, land use, building footprints and neighborhoods from DataSF (datasf.org), Public Domain
    Dedication and License (PDDL) / public domain.
  </li>
  <li>
    Derived data files under <code>/data/</code> that incorporate OpenStreetMap or Overture data are made
    available under the ODbL 1.0.
  </li>
</ul>

<h2 class="mt-6 text-lg font-semibold">Software</h2>
<ul class="mt-3 list-disc space-y-1 pl-5">
  {#each SOFTWARE as sw (sw.name)}
    <li>
      <a class="underline" href={sw.url} rel="noopener noreferrer">{sw.name}</a>, {sw.license}
    </li>
  {/each}
</ul>
<p class="mt-3">
  This project's code is <a class="underline" href="{REPO_URL}/blob/main/LICENSE">MIT licensed</a>.
</p>
