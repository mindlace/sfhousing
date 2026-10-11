<script lang="ts">
  import type { Snippet } from 'svelte';
  import { APP_NAME } from '$lib/config';

  let { actions }: { actions?: Snippet } = $props();
</script>

<header class="flex h-12 items-center justify-between gap-2 border-b px-4">
  <a href="/" class="font-semibold">{APP_NAME}</a>
  <div class="flex items-center gap-2">{@render actions?.()}</div>
</header>
