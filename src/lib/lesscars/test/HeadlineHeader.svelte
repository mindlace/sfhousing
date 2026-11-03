<script lang="ts">
  // Test host: SiteHeader on /lesscars with the real HeadlineBar pinned, as the page renders it.
  import { createRawSnippet } from 'svelte';
  import type { LessCarsSummary } from '$lib/data/lesscars/codec';
  import SiteHeader from '$lib/shell/SiteHeader.svelte';
  import HeadlineBar from '../HeadlineBar.svelte';

  let { summary }: { summary: LessCarsSummary } = $props();
  const panel = createRawSnippet(() => ({ render: () => '<p>Details here</p>' }));
  const actions = createRawSnippet(() => ({ render: () => '<button>Timeline</button>' }));
</script>

{#snippet pinned()}
  <HeadlineBar {summary} {panel} />
{/snippet}

<SiteHeader routeId="/lesscars" {actions} {pinned} />
