<!--
  The /sim session notices (plan 5, Task 5): the autosave restore (N1 to N3 in the policy
  wording), the timelines refit, the Remix toast and the `start=fzp` deferral. Each is one line
  (compact UI): a "Details" disclosure holds a list, a link goes where the notice says. Rendered
  in FzpMode's notice row above the scrubber, whose height the dock and the map inset include, so
  a notice never covers the map's controls. One always-mounted polite status region: a notice
  added later is announced, and the empty region stays in the accessibility tree.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { SimNotice } from './sim-session';

  let { notices, ondismiss }: { notices: SimNotice[]; ondismiss: (id: SimNotice['id']) => void } =
    $props();

  const TOAST_MS = 8_000;
  const uid = $props.id();

  let open = $state<Record<string, boolean>>({});

  // One timer per toast id, started when it first appears; not reactive state.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const timers = new Map<SimNotice['id'], ReturnType<typeof setTimeout>>();

  $effect(() => {
    const toasts = new Set(notices.filter((n) => n.tone === 'toast').map((n) => n.id));
    for (const [id, t] of timers) {
      if (!toasts.has(id)) {
        clearTimeout(t);
        timers.delete(id);
      }
    }
    for (const id of toasts) {
      if (timers.has(id)) continue;
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          ondismiss(id);
        }, TOAST_MS)
      );
    }
  });

  onDestroy(() => {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  });

  const chip =
    'min-h-6 min-w-6 shrink-0 rounded-md px-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11';
</script>

<div
  role="status"
  aria-live="polite"
  data-testid="sim-notices"
  class="flex w-[min(34rem,100%)] flex-col"
>
  {#each notices as n (n.id)}
    <div
      data-testid="sim-notice"
      class="pointer-events-auto mb-2 rounded-lg bg-white py-1 pr-1 pl-3 text-sm text-black shadow"
    >
      <div class="flex items-center gap-1">
        <span class="min-w-0 flex-1 py-1">{n.text}</span>
        {#if n.link}
          <a href={n.link.href} class="{chip} inline-flex items-center font-semibold underline"
            >{n.link.label}</a
          >
        {/if}
        {#if n.details && n.details.length > 0}
          <button
            type="button"
            class="{chip} font-semibold underline"
            aria-expanded={open[n.id] ?? false}
            aria-controls="{uid}-{n.id}-details"
            onclick={() => (open[n.id] = !(open[n.id] ?? false))}>Details</button
          >
        {/if}
        <button
          type="button"
          aria-label="Dismiss"
          class="{chip} flex items-center justify-center text-gray-700 hover:bg-gray-100"
          onclick={() => ondismiss(n.id)}
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" />
          </svg>
        </button>
      </div>
      {#if n.details && n.details.length > 0}
        <ul
          id="{uid}-{n.id}-details"
          hidden={!(open[n.id] ?? false)}
          class="mb-1 list-disc pr-2 pl-4 text-xs text-gray-800"
        >
          {#each n.details as d (d)}
            <li>{d}</li>
          {/each}
        </ul>
      {/if}
    </div>
  {/each}
</div>
