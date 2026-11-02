<script lang="ts">
  // /lesscars: a fewer-cars San Francisco, 2028 to 2068. The body is LessCarsMode; a dataset
  // without the plan, or a plan that fails to load, gets a message and no map or worker.
  import { invalidateAll } from '$app/navigation';
  import LessCarsMode from '$lib/lesscars/LessCarsMode.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head><title>Fewer cars · SF Housing Simulator</title></svelte:head>

<h1 class="sr-only">A fewer-cars San Francisco, 2028 to 2068</h1>
{#if data.state === 'ready'}
  <div id="map-region" class="relative h-full">
    {#key data.data.manifest}<LessCarsMode data={data.data} />{/key}
  </div>
{:else}
  <div class="flex h-full items-center justify-center p-4">
    <div class="max-w-md text-center">
      {#if data.state === 'no-scenario'}
        <p>This dataset has no fewer-cars plan yet.</p>
        <a href="/sim" class="mt-2 inline-flex min-h-11 items-center font-semibold underline"
          >Open the policy simulation</a
        >
      {:else}
        <p role="alert">The fewer-cars plan couldn't be loaded.</p>
        <button
          type="button"
          class="mt-2 min-h-11 min-w-11 rounded-md border border-gray-300 px-3 font-semibold dark:border-gray-600"
          onclick={() => void invalidateAll()}>Retry</button
        >
      {/if}
    </div>
  </div>
{/if}
