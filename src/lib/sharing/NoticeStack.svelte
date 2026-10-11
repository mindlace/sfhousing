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
  Placement against the W6b layout (e2e/share-notices.spec.ts checks 375, 768, 1024, 1280, 1440):
  - Below 768 px the brush bar and score bar sit at the bottom, the compact attribution button
    just above them. The top is free except map-view's failure chips, whose tops sit at 0.5rem
    (parcels) and 4rem (buildings, about 46 px tall), so the stack starts at 8rem, below both.
    Below 640 px it keeps 60 px clear on the right (W6b rule).
  - From 768 px the toolbar (left, 23rem) and the scoreboard panel (right, 20rem) hang from the
    top with the chips between them; at 768 px the two columns are only 48 px apart. So the stack
    sits near the bottom: 6rem up clears the attribution strip and, at its usual two-line height,
    the parcel card (16 px up); 4rem in from the left clears the navigation control; 22rem in
    from the right keeps it out of the scoreboard column however tall the panel grows. From lg it
    also starts right of the toolbar column (25rem), so a tall toolbar (keyboard shortcuts open,
    about 620 px at 1024x768) cannot reach it either.
    Known limit, 768-1023 px: the two columns leave no room beside the toolbar, so the stack sits
    under it and relies on the toolbar ending above it. With the shortcuts open on a short
    viewport the toolbar can reach the stack; fixing that needs the toolbar's height (brush owner),
    not a NoticeStack class.
  One always-mounted status region (not a list): notices added to it later are announced, which
  a status node inserted with its text already inside often is not. Empty, it has no height.
-->
<div
  role="status"
  aria-live="polite"
  data-testid="notice-stack"
  class="notice-stack pointer-events-none absolute top-32 right-[60px] left-4 z-20 flex flex-col gap-2 sm:right-4 md:top-auto md:right-[22rem] md:bottom-24 md:left-16 md:items-center lg:left-[25rem]"
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
