<script lang="ts">
  // Test host: SiteHeader with the real /sim ScoreBar pinned and one plain action, plus an area
  // outside the header to press.
  import { createRawSnippet } from 'svelte';
  import { makeTimelineScore } from '$lib/fzp/fixtures/timeline-score';
  import { dayFromUtc } from '$lib/fzp/time';
  import ScoreBar from '$lib/sim-page/ScoreBar.svelte';
  import SiteHeader from '../SiteHeader.svelte';

  const base = makeTimelineScore();
  const score = { ...base, baseline: { ...base.baseline, completedNet: 1234 } };
  const day = dayFromUtc(2026, 10, 20);
  const panel = createRawSnippet(() => ({ render: () => '<p>Score details here</p>' }));
  const actions = createRawSnippet(() => ({ render: () => '<button>Another future</button>' }));
</script>

{#snippet pinned()}
  <ScoreBar {score} {day} playing={false} {panel} />
{/snippet}

<SiteHeader routeId="/sim" {actions} {pinned} />
<div data-testid="outside" style="height: 400px">Map</div>
