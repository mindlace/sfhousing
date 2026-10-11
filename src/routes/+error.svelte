<script lang="ts">
  import { page } from '$app/state';

  const notFound = $derived(page.status === 404);
  const heading = $derived(notFound ? 'Page not found' : 'Something went wrong');
</script>

<svelte:head><title>{heading}</title></svelte:head>

<div class="mx-auto max-w-3xl px-4 py-6">
  <h1 class="text-2xl font-semibold">{heading}</h1>
  {#if !notFound}
    <p class="mt-3">Error {page.status}</p>
  {/if}
  <p class="mt-3"><a href="/" class="underline">Go to the home page</a></p>
</div>
