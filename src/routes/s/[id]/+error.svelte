<script lang="ts">
  import { page } from '$app/state';
  import { copyFor } from '$lib/sharing/copy';

  // As /p/[id]'s error page, in the policy wording; "Start your own" goes to /sim.
  const SIM = copyFor('sim');
  const notFound = $derived(page.status === 404);
  // Only the load's own unparsable error gets that copy; anything else is a generic failure.
  const unparsable = $derived(page.status === 500 && page.error?.message === SIM.unparsable);
  const heading = $derived(
    notFound ? SIM.notFoundHeading : unparsable ? SIM.unparsable : 'Something went wrong'
  );
</script>

<svelte:head>
  <title>{heading} · SF Housing Simulator</title>
  {#if notFound}
    <meta name="robots" content="noindex" />
  {/if}
</svelte:head>

<!-- /s/[id] is a full-height route (overflow hidden), so this scrolls inside <main>. -->
<div class="h-full overflow-y-auto">
  <div class="mx-auto max-w-3xl px-4 py-6">
    <h1 class="text-2xl font-semibold">{heading}</h1>
    {#if notFound}
      <p class="mt-3">{SIM.notFoundBody}</p>
      <p class="mt-3"><a href={SIM.startHref} class="underline">{SIM.startOwn}</a></p>
    {:else}
      <p class="mt-3"><a href="/" class="underline">Go to the home page</a></p>
    {/if}
  </div>
</div>
