<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>{data.title}</title>
</svelte:head>

<div class="mx-auto max-w-xl px-4 py-8">
  <h1 class="text-2xl font-semibold">{data.title}</h1>
</div>
