<script lang="ts">
  // The /sim route body (spec §4.1, §4.2, §4.7; plan 3; plan 5 Call 19), shared by /sim and the
  // read-only /s/<id>: SimPage, remounted on each new load result. The URL names no future (rule
  // 25, OD-4): after a navigation a `?seed=` left from an older link is dropped from the address
  // with replaceState, other parameters and the history state kept; it remounts nothing.
  import { afterNavigate, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { reloadScenario } from '$lib/fzp/load';
  import { addressHref, withoutSeed } from '$lib/timeline/address';
  import type { SimNotice4 } from '$lib/timeline/session4';
  import type { SimDoc4 } from '$lib/timeline/sim-doc4';
  import type { SimPageData } from './load';
  import SimPage from './SimPage.svelte';

  interface Props {
    /** The load's data, with the dataset the page runs on. */
    data: SimPageData & { datasetVersion: string };
    /** 'view': a published policy, read-only. */
    mode: 'edit' | 'view';
    /** SimPage's persistence (edit: 'restore'; view: 'off'). */
    persist: 'restore' | 'off';
    /** View: the shared document's text. */
    initialText?: string;
    /** View: the shared document, already opened by the route's load (with the calibration). */
    opened?: { doc: SimDoc4; notices: SimNotice4[] } | null;
    /** Edit: the Remix hand-off from /s/<id>. */
    remix?: { from: string; doc?: string; upgradedFrom?: number };
    /** View: the schema the shared document was upgraded from. */
    upgradedFrom?: number;
  }

  let {
    data,
    mode,
    persist,
    initialText = undefined,
    opened = undefined,
    remix = undefined,
    upgradedFrom = undefined
  }: Props = $props();

  // Not onMount: on the first load the router is not ready for replaceState until hydration ends.
  afterNavigate(() => {
    const next = withoutSeed(addressHref());
    if (next === null) return;
    try {
      replaceState(next, $state.snapshot(page.state) as App.PageState);
    } catch (e) {
      console.error('[sim] could not update the URL', e);
    }
  });
</script>

<div id="map-region" class="relative h-full">
  <!-- SimPage remounts on a new load result only. -->
  {#key data}
    <SimPage
      manifest={data.manifest}
      manifestError={data.manifestError}
      calibration={data.calibration}
      calibrationError={data.calibrationError}
      noScenario={data.noScenario}
      datasetVersion={data.datasetVersion}
      {mode}
      {persist}
      {initialText}
      opened={opened ?? undefined}
      {remix}
      {upgradedFrom}
      reload={() => reloadScenario(data.datasetVersion)}
    />
  {/key}
</div>
