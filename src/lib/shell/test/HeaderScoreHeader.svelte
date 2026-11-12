<script lang="ts">
  // Test host: SiteHeader on /sim with the real HeaderScore pinned (fixed props) and one plain
  // action, plus an area outside the header to press. A spec passes its own `actions`, `status`
  // and the score's `total` and `delta` to check how the row fits.
  import { createRawSnippet, type Snippet } from 'svelte';
  import HeaderScore from '$lib/scoreboard/HeaderScore.svelte';
  import { M1_TARGETS } from '$lib/scoreboard/targets';
  import SiteHeader from '../SiteHeader.svelte';

  interface Props {
    actions?: Snippet;
    status?: Snippet;
    total?: number;
    delta?: number | null;
  }
  const defaultActions = createRawSnippet(() => ({
    render: () => '<button>Example</button>'
  }));
  let {
    actions = defaultActions,
    status = undefined,
    total = 1234,
    delta = null
  }: Props = $props();
  const rhna = M1_TARGETS.find((t) => t.id === 'rhna')!;
</script>

{#snippet pinned()}
  <HeaderScore
    {total}
    target={{ target: rhna, fraction: 0.15 }}
    {delta}
    expanded={false}
    controls="dock"
    onclick={() => {}}
    live=""
    quiet={false}
  />
{/snippet}

<SiteHeader routeId="/sim" {actions} {pinned} {status} />
<div data-testid="outside" style="height: 400px">Map</div>
