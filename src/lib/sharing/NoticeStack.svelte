<!--
  `/`'s plan-sharing notices (plan-sharing spec §4.5/§4.8: N1 to N3), each a
  `Message` (a chip or a card by its words, shell/Message). The page passes this as BrushEditor's
  `notices` snippet, so they sit in BrushEditor's one notice stack (`NoticePills`, `fzp-notices`) after the brush status
  (sim-ux spec Goal 8): an overlay at the map's top from md that moves nothing, in flow under the
  header below md. It has no stack or placement of its own. One always-mounted polite status region
  (`display: contents`, so its empty box adds no gap in the stack, not a list): a notice added to it
  later is announced, which a status node inserted with its text already inside often is not. A
  toast dismisses itself after 8 s.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import Message from '$lib/shell/Message.svelte';

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
    <Message text={n.text} ondismiss={() => ondismiss(n.id)} testid="notice" />
  {/each}
</div>
