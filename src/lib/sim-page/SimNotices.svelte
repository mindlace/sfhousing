<!--
  The /sim session notices (plan 5, Task 5; timeline-ui Task 14): the autosave restore (N1 to N3
  in the policy wording), funding, the timelines refit, moved dates, "upgraded", and the Remix
  toast. Each is a `Message` (shell/Message): a notice with details is a card, whose "Details"
  disclosure holds a list; a link goes where the notice says. Rendered
  in TimelineMode's notice stack (`NoticePills`): an overlay at the map's top from md that moves
  nothing, in flow under the header below md. One always-mounted polite status region
  (`display: contents`, so its empty box adds no gap in the stack): a notice
  added later is announced, and the empty region stays in the accessibility tree. The region
  mounts empty and takes the notices present on load a moment later (LIVE_DELAY_MS), since a
  screen reader announces a change to a live region, not one that mounts already populated. A
  notice of tone 'alert' (nothing to show) is its own alert region, announced at once.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Message from '$lib/shell/Message.svelte';
  import { BUTTON_QUIET } from '$lib/shell/ui';
  import type { SimNotice4 } from '$lib/timeline/session4';

  let { notices, ondismiss }: { notices: SimNotice4[]; ondismiss: (id: SimNotice4['id']) => void } =
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
  const timers = new Map<SimNotice4['id'], ReturnType<typeof setTimeout>>();

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
    {@const hasDetails = !!n.details && n.details.length > 0}
    {#snippet actions()}
      {#if n.link}
        <a href={n.link.href} class="{BUTTON_QUIET} inline-flex items-center">{n.link.label}</a>
      {/if}
      {#if hasDetails}
        <button
          type="button"
          class={BUTTON_QUIET}
          aria-expanded={open[n.id] ?? false}
          aria-controls="{uid}-{n.id}-details"
          onclick={() => (open[n.id] = !(open[n.id] ?? false))}>Details</button
        >
      {/if}
      <button
        type="button"
        aria-label="Dismiss"
        class="{BUTTON_QUIET} flex items-center justify-center no-underline hover:bg-surface-raised dark:hover:bg-line-dark"
        onclick={() => ondismiss(n.id)}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" />
        </svg>
      </button>
    {/snippet}
    {#snippet details()}
      <ul
        id="{uid}-{n.id}-details"
        hidden={!(open[n.id] ?? false)}
        class="list-disc pr-2 pl-4 text-xs text-ink-muted dark:text-ink-dark-muted"
      >
        {#each n.details ?? [] as d (d)}
          <li>{d}</li>
        {/each}
      </ul>
    {/snippet}
    <!-- A notice with details is a card: its list does not fit a chip's one line. -->
    <div role={n.tone === 'alert' ? 'alert' : undefined} class="contents">
      <Message
        text={n.text}
        {actions}
        details={hasDetails ? details : undefined}
        testid="sim-notice"
      />
    </div>
  {/each}
</div>
