<!--
  About this model, the page: what the numbers mean, the assumptions, data and licences, using
  it. The page is light at every setting, so it gives the parts the light tokens for their two
  colour properties (docs/dev/about.md). It fetches nothing in the browser: the manifest comes
  from the server load.
-->
<script lang="ts">
  import type { PageData } from './$types';
  import AboutData from '$lib/about/AboutData.svelte';
  import AboutMeanings from '$lib/about/AboutMeanings.svelte';
  import AboutUsing from '$lib/about/AboutUsing.svelte';
  import { ABOUT_ID, ABOUT_INTRO, ABOUT_TITLE, PART_HEADING } from '$lib/about/copy';
  import { APP_NAME } from '$lib/config';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{ABOUT_TITLE} · {APP_NAME}</title></svelte:head>

<h1 class="text-2xl font-semibold">{ABOUT_TITLE}</h1>
<p class="mt-3">{ABOUT_INTRO}</p>

<div
  class="mt-6 space-y-6"
  style:--about-muted="var(--color-ink-muted)"
  style:--about-line="var(--color-line)"
>
  <AboutMeanings level={2} />
  <section id={ABOUT_ID.assumptions}>
    <h2 class="text-lg font-semibold">{PART_HEADING.assumptions}</h2>
  </section>
  <AboutData level={2} datasetVersion={data.datasetVersion} manifest={data.manifest} />
  <AboutUsing level={2} />
</div>
