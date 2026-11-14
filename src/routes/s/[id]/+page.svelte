<script lang="ts">
  // A published /sim policy, read-only (plan 5, Task 6; spec §4.7 as /p/[id]): the banner above
  // the map with Remix and Start your own, then the shared /sim body in view mode (no editing, no
  // autosave, no Publish). The load opened the document (timeline-ui Task 15, R-4). The local
  // schema 4 autosave is only read (is anything in force?) and written by an explicit Remix.
  import { goto } from '$app/navigation';
  import { copyFor } from '$lib/sharing/copy';
  import { localDoc, remixToLocal } from '$lib/sharing/remix';
  import SharedBanner from '$lib/sharing/SharedBanner.svelte';
  import { getStorage } from '$lib/sharing/storage';
  import SimRoute from '$lib/sim-page/SimRoute.svelte';
  import { SIM_SERVER_CODEC4 } from '$lib/timeline/server-codec';
  import { createSimCodec4 } from '$lib/timeline/sim-doc4';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const SIM = copyFor('sim');
  const OG_DESCRIPTION =
    'A housing policy for San Francisco, run through the simulation lot by lot. Open it to see how many homes it adds against the RHNA target.';

  const heading = $derived(data.doc.title ?? 'Shared policy');
  const pageTitle = $derived(`${heading} · SF Housing Simulator`);

  /** Call 18: confirm only when Remix would replace a local document with anything in force. */
  function confirmText(): string | null {
    // The server codec reads the v2 record without a dataset: nothing to open for this question.
    const local = localDoc(getStorage(), SIM_SERVER_CODEC4);
    return local && !SIM_SERVER_CODEC4.isEmpty(local) ? SIM.remixConfirm(0) : null;
  }

  // As /p (ruling 7): hand the remix to /sim via history state. The opened document is written
  // under `sfhousing:sim:v2`; it rides along only when that write failed. With no calibration
  // (nothing opened yet), the shared text rides along and /sim opens it.
  function remix(): void {
    const from = data.doc.title ?? data.id;
    const upgradedFrom = data.upgradedFrom;
    const cal = data.calibration;
    let handoff: { from: string; doc?: string; upgradedFrom?: number };
    if (data.opened && cal) {
      const { planText, stored } = remixToLocal(
        data.opened.doc,
        data.currentDatasetVersion,
        getStorage(),
        new Date(),
        createSimCodec4({ asOf: cal.asOf, calibration: cal })
      );
      handoff = stored ? { from, upgradedFrom } : { from, doc: planText, upgradedFrom };
    } else {
      handoff = { from, doc: data.doc.text, upgradedFrom };
    }
    if (handoff.upgradedFrom === undefined) delete handoff.upgradedFrom;
    void goto('/sim', { state: { sfhSimRemix: handoff } });
  }
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
    {confirmText}
    onremix={remix}
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
