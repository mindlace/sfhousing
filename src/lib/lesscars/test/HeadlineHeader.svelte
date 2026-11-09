<script lang="ts">
  // Test host: SiteHeader on /lesscars with the real HeadlineBar pinned, as the page renders it.
  import { createRawSnippet } from 'svelte';
  import type { LessCarsSummary } from '$lib/data/lesscars/codec';
  import type { Day } from '$lib/timelapse/time';
  import SiteHeader from '$lib/shell/SiteHeader.svelte';
  import HeadlineBar from '../HeadlineBar.svelte';

  let { summary, highWater }: { summary: LessCarsSummary; highWater: Day } = $props();
  const panel = createRawSnippet(() => ({ render: () => '<p>Details here</p>' }));
  const actions = createRawSnippet(() => ({ render: () => '<button>Timeline</button>' }));
</script>

{#snippet pinned()}
  <HeadlineBar {summary} {panel} {highWater} />
{/snippet}

<SiteHeader routeId="/lesscars" {actions} {pinned} />
