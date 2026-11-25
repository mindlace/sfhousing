<script lang="ts">
  // A published /sim policy, read-only (plan 5, Task 6; spec §4.7 as /p/[id]): the banner above
  // the map with Your game, then the shared /sim body in view mode (no editing, no autosave, no
  // Publish). The load opened the document (timeline-ui Task 15, R-4).
  import { copyFor } from '$lib/sharing/copy';
  import SharedBanner from '$lib/sharing/SharedBanner.svelte';
  import { SITE_NAME } from '$lib/shell/name';
  import SimRoute from '$lib/sim-page/SimRoute.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const SIM = copyFor('sim');
  const OG_DESCRIPTION =
    'A housing policy for San Francisco, run through the simulation lot by lot. Open it to see how many homes it adds against the goal.';

  const heading = $derived(data.doc.title ?? SIM.shared);
  const pageTitle = $derived(`${heading} · ${SITE_NAME}`);
</script>

<svelte:head>
  <title>{pageTitle}</title>
  <meta property="og:title" content={pageTitle} />
  <meta property="og:description" content={OG_DESCRIPTION} />
  <meta property="og:url" content="https://sfhousing.mindlace.net/s/{data.id}" />
</svelte:head>

<h1 class="sr-only">{heading}</h1>
<div class="flex h-full flex-col">
  <SharedBanner
    title={data.doc.title}
    id={data.id}
    createdAt={data.createdAt}
    datasetNotice={data.datasetNotice}
    planVersion={data.doc.datasetVersion}
    currentVersion={data.currentDatasetVersion}
    kind="sim"
  />
  <div class="relative min-h-0 flex-1">
    <SimRoute
      {data}
      mode="view"
      persist="off"
      initialText={data.doc.text}
      opened={data.opened}
      upgradedFrom={data.upgradedFrom}
    />
  </div>
</div>
