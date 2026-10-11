<script lang="ts">
  import { page } from '$app/state';
  import { COPY } from '$lib/sharing/copy';

  const notFound = $derived(page.status === 404);
</script>

<svelte:head>
  {#if notFound}
    <title>Plan not found · SF Housing Simulator</title>
    <meta name="robots" content="noindex" />
  {:else}
    <title>{COPY.unparsable} · SF Housing Simulator</title>
  {/if}
</svelte:head>

<!-- /p/[id] is a full-height route (overflow hidden), so this scrolls inside <main>. -->
<div class="h-full overflow-y-auto">
  <div class="mx-auto max-w-3xl px-4 py-6">
    {#if notFound}
      <h1 class="text-2xl font-semibold">{COPY.notFoundHeading}</h1>
      <p class="mt-3">{COPY.notFoundBody}</p>
      <p class="mt-3"><a href="/" class="underline">{COPY.startOwn}</a></p>
    {:else}
      <h1 class="text-2xl font-semibold">{COPY.unparsable}</h1>
      <p class="mt-3"><a href="/" class="underline">Go to the home page</a></p>
    {/if}
  </div>
</div>
