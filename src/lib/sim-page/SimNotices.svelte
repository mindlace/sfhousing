<!--
  The /sim session notices (plan 5, Task 5): the autosave restore (N1 to N3 in the policy
  wording), the timelines refit, and the Remix toast. Each is one pill line (compact UI, `PILL`
  in shell/pill): a "Details" disclosure holds a list, a link goes where the notice says. Rendered
  in FzpMode's notice stack (`NoticePills`): an overlay at the map's top from md that moves
  nothing, in flow under the header below md. One always-mounted polite status region
  (`display: contents`, so its empty box adds no gap in the stack): a notice
  added later is announced, and the empty region stays in the accessibility tree. The region
  mounts empty and takes the notices present on load a moment later (LIVE_DELAY_MS), since a
  screen reader announces a change to a live region, not one that mounts already populated.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { PILL, PILL_ACTION } from '$lib/shell/pill';
  import type { SimNotice } from './sim-session';

  let { notices, ondismiss }: { notices: SimNotice[]; ondismiss: (id: SimNotice['id']) => void } =
    $props();

  const TOAST_MS = 8_000;
  /** Long enough for assistive tech to register the empty region before it fills. */
  const LIVE_DELAY_MS = 100;
  const uid = $props.id();

  let live = $state(false);
  onMount(() => {
    const t = setTimeout(() => (live = true), LIVE_DELAY_MS);
    return () => clearTimeout(t);
  });
  /** What the region shows: nothing until it has been in the document empty. */
  const shown = $derived(live ? notices : []);

  let open = $state<Record<string, boolean>>({});

  // One timer per toast id, started when it first appears; not reactive state.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const timers = new Map<SimNotice['id'], ReturnType<typeof setTimeout>>();

  $effect(() => {
    const toasts = new Set(shown.filter((n) => n.tone === 'toast').map((n) => n.id));
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

<div role="status" aria-live="polite" data-testid="sim-notices" class="contents">
  {#each shown as n (n.id)}
    <!-- A notice with its details open is a card: a list does not fit a full-radius pill. -->
    <div
      data-testid="sim-notice"
      class="{PILL} max-w-[min(34rem,100%)]! {n.details && n.details.length > 0 && open[n.id]
        ? 'flex-col! items-stretch! rounded-2xl!'
        : ''}"
    >
      <div class="flex items-center gap-1">
        <span class="min-w-0 flex-1 py-1">{n.text}</span>
        {#if n.link}
          <a href={n.link.href} class="{PILL_ACTION} inline-flex items-center">{n.link.label}</a>
        {/if}
        {#if n.details && n.details.length > 0}
          <button
            type="button"
            class={PILL_ACTION}
            aria-expanded={open[n.id] ?? false}
            aria-controls="{uid}-{n.id}-details"
            onclick={() => (open[n.id] = !(open[n.id] ?? false))}>Details</button
          >
        {/if}
        <button
          type="button"
          aria-label="Dismiss"
          class="{PILL_ACTION} flex items-center justify-center no-underline hover:bg-surface-raised dark:hover:bg-line-dark"
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
          class="mb-1 list-disc pr-2 pl-4 text-xs text-ink-muted dark:text-ink-dark-muted"
        >
          {#each n.details as d (d)}
            <li>{d}</li>
          {/each}
        </ul>
      {/if}
    </div>
  {/each}
</div>
