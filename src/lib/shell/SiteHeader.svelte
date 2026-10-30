<script lang="ts">
  import type { Snippet } from 'svelte';

  let { actions, routeId = null }: { actions?: Snippet; routeId?: string | null } = $props();

  const onSim = $derived(routeId === '/sim');
  // Below 640px only the link to the other mode shows; from 640px both do.
  const link = 'inline-flex min-h-6 items-center whitespace-nowrap pointer-coarse:min-h-11';
  const paintClass = $derived(`${link} ${onSim ? '' : 'max-sm:hidden'}`);
  const simulateClass = $derived(`${link} ${onSim ? 'max-sm:hidden' : ''}`);
</script>

<header class="relative flex h-12 items-center justify-between gap-2 border-b px-4">
  <a href="/" class="shrink-0 font-semibold whitespace-nowrap"
    >SF Housing <span class="sr-only sm:not-sr-only">Simulator</span></a
  >
  <nav aria-label="Modes" class="flex min-w-0 flex-1 items-center gap-3 text-sm">
    <a
      href="/"
      class={paintClass}
      class:underline={routeId === '/'}
      aria-current={routeId === '/' ? 'page' : undefined}>Paint</a
    >
    <a
      href="/sim"
      class={simulateClass}
      class:underline={onSim}
      aria-current={onSim ? 'page' : undefined}>Simulate</a
    >
  </nav>
  <div class="flex items-center gap-2">{@render actions?.()}</div>
</header>
