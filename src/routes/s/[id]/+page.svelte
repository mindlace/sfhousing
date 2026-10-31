<script lang="ts">
  // A published /sim policy, read-only (plan 5, Task 6; spec §4.7 as /p/[id]): the banner above
  // the map with Remix and Start your own, then the shared /sim body in view mode (no tools, no
  // autosave, no Publish; the panel is the summary). The local autosaved policy is only read (is
  // it non-default?) and written by an explicit Remix.
  import { goto } from '$app/navigation';
  import { copyFor } from '$lib/sharing/copy';
  import { localDoc, remixToLocal } from '$lib/sharing/remix';
  import SharedBanner from '$lib/sharing/SharedBanner.svelte';
  import { getStorage } from '$lib/sharing/storage';
  import { SIM_CODEC, isDefaultPolicy } from '$lib/sim-page/sim-doc';
  import SimRoute from '$lib/sim-page/SimRoute.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const SIM = copyFor('sim');
  const OG_DESCRIPTION =
    'A housing policy for San Francisco, run through the simulation lot by lot. Open it to see how many homes it adds against the RHNA target.';

  const heading = $derived(data.doc.title ?? 'Shared policy');
  const pageTitle = $derived(`${heading} · SF Housing Simulator`);

  /** Call 18: confirm only when Remix would replace a non-default local policy. */
  function confirmText(): string | null {
    const local = localDoc(getStorage(), SIM_CODEC);
    return local && !isDefaultPolicy(local.policy) ? SIM.remixConfirm(0) : null;
  }

  // As /p (ruling 7): hand the remix to /sim via history state; the document rides along only
  // when the localStorage write failed.
  function remix(): void {
    const { planText, stored } = remixToLocal(
      SIM_CODEC.publishable(data.doc),
      data.currentDatasetVersion,
      getStorage(),
      new Date(),
      SIM_CODEC
    );
    const from = data.doc.title ?? data.id;
    void goto('/sim', { state: { sfhSimRemix: stored ? { from } : { from, doc: planText } } });
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
    <SimRoute {data} mode="view" persist="off" initialPolicy={data.doc.policy} />
  </div>
</div>
