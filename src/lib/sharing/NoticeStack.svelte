<script lang="ts">
  import { onDestroy } from 'svelte';

  type Notice = { id: string; text: string; tone?: 'info' | 'toast' };

  let { notices, ondismiss }: { notices: Notice[]; ondismiss: (id: string) => void } = $props();

  const TOAST_MS = 8_000;

  // One timer per toast id, started when it first appears; not reactive state.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

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
</script>

<!--
  Top of #map-region. Below 768 px the brush toolbar and score bar sit at the bottom, so the top
  is free. From xl the stack sits in the gap between the toolbar (left, 23rem) and the
  scoreboard (right, 20rem).
  One always-mounted status region (not a list): notices added to it later are announced, which
  a status node inserted with its text already inside often is not. Empty, it has no size.
-->
<div
  role="status"
  aria-live="polite"
  data-testid="notice-stack"
  class="notice-stack pointer-events-none absolute top-2 left-1/2 z-20 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col gap-2 xl:top-4 xl:left-[calc(50%+1.5rem)] xl:max-w-[calc(100%-47rem)]"
>
  {#each notices as n (n.id)}
    <div
      data-testid="notice"
      class="pointer-events-auto flex items-start gap-2 rounded-lg border border-gray-300 bg-white py-1 pr-1 pl-3 text-sm text-gray-900 shadow-lg"
    >
      <span class="min-w-0 flex-1 py-1">{n.text}</span>
      <button
        type="button"
        aria-label="Dismiss"
        class="flex min-h-6 min-w-6 shrink-0 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        onclick={() => ondismiss(n.id)}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" />
        </svg>
      </button>
    </div>
  {/each}
</div>
