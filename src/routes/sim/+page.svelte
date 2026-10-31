<script lang="ts">
  // /sim (spec §4.1, §4.2, §4.7; plan 3): the policy simulation, and /fzp's timelapse under
  // `start=fzp`. The body (the URL seed, the remounts) is SimRoute, shared with /s/<id>.
  import { page } from '$app/state';
  import SimRoute from '$lib/sim-page/SimRoute.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head><title>Policy simulation · SF Housing Simulator</title></svelte:head>

<h1 class="sr-only">Housing policy simulation</h1>
<SimRoute
  {data}
  mode="edit"
  persist={data.start === 'fzp' ? 'deferred' : 'restore'}
  remix={page.state.sfhSimRemix}
/>
