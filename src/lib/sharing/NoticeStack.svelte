<!--
  `/`'s plan-sharing notices (plan-sharing spec §4.5/§4.8: N1 to N3 and the Remix toast), each one
  pill line (`PILL` in shell/pill). The page passes this as BrushEditor's `notices` snippet, so the
  pills sit in BrushEditor's one notice stack (`NoticePills`, `fzp-notices`) after the brush status
  (sim-ux spec Goal 8): an overlay at the map's top from md that moves nothing, in flow under the
  header below md. It has no stack or placement of its own. One always-mounted polite status region
  (`display: contents`, so its empty box adds no gap in the stack, not a list): a notice added to it
  later is announced, which a status node inserted with its text already inside often is not. A
  toast dismisses itself after 8 s.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { PILL, PILL_ACTION } from '$lib/shell/pill';

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

<div role="status" aria-live="polite" data-testid="notice-stack" class="contents">
  {#each notices as n (n.id)}
    <div data-testid="notice" class="{PILL} max-w-[min(34rem,100%)]!">
      <span class="min-w-0 flex-1 py-1">{n.text}</span>
      <button
        type="button"
        aria-label="Dismiss"
        class="{PILL_ACTION} flex shrink-0 items-center justify-center no-underline hover:bg-surface-raised dark:hover:bg-line-dark"
        onclick={() => ondismiss(n.id)}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" />
        </svg>
      </button>
    </div>
  {/each}
</div>
