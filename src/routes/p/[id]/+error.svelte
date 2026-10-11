<script lang="ts">
  import { page } from '$app/state';
  import { COPY } from '$lib/sharing/copy';

  const notFound = $derived(page.status === 404);
  // Only the load's own unparsable error gets that copy; anything else is a generic failure.
  const unparsable = $derived(page.status === 500 && page.error?.message === COPY.unparsable);
  const heading = $derived(
    notFound ? COPY.notFoundHeading : unparsable ? COPY.unparsable : 'Something went wrong'
  );
</script>

<svelte:head>
  {#if notFound}
    <title>Plan not found · SF Housing Simulator</title>
    <meta name="robots" content="noindex" />
  {:else}
    <title>{heading} · SF Housing Simulator</title>
  {/if}
</svelte:head>

<!-- /p/[id] is a full-height route (overflow hidden), so this scrolls inside <main>. -->
<div class="h-full overflow-y-auto">
  <div class="mx-auto max-w-3xl px-4 py-6">
    <h1 class="text-2xl font-semibold">{heading}</h1>
    {#if notFound}
      <p class="mt-3">{COPY.notFoundBody}</p>
      <p class="mt-3"><a href="/" class="underline">{COPY.startOwn}</a></p>
    {:else}
      <p class="mt-3"><a href="/" class="underline">Go to the home page</a></p>
    {/if}
  </div>
</div>
