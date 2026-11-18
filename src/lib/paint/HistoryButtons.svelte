<!--
  Undo and Redo as icon buttons named by the change they would undo or redo, then a button that
  opens the keyboard shortcuts in a native popover (hidden on coarse pointers, as on `/`). The
  popover sits in the top layer, so it takes no room in the header row or the dock and is not
  clipped by the dock's scroll box; script places it under its button. Escape, a second press
  and an outside press close it, as do a resize and a scroll outside it. The label shows as
  "Shortcuts" while the name stays "Keyboard shortcuts": the full words do not fit the header's
  actions column at 1024 px. Colours are tokens.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { SHORTCUTS } from '$lib/brush/shortcuts';
  import { placePopover } from './place-popover';
  import { HISTORY_ICONS } from './tools';

  interface Props {
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string | null;
    redoLabel: string | null;
    onundo(): void;
    onredo(): void;
  }

  let { canUndo, canRedo, undoLabel, redoLabel, onundo, onredo }: Props = $props();

  let coarse = $state(false);
  onMount(() => {
    try {
      coarse = matchMedia('(pointer: coarse)').matches;
    } catch {
      coarse = false;
    }
  });

  const uid = $props.id();
  const popId = `${uid}-shortcuts`;
  let open = $state(false);
  let button = $state<HTMLButtonElement>();
  let pop = $state<HTMLDivElement>();

  // Hidden until placed, so the browser's centred default is never painted.
  function onbeforetoggle(e: ToggleEvent): void {
    if (e.newState === 'open' && pop) pop.style.visibility = 'hidden';
  }

  function ontoggle(e: ToggleEvent): void {
    open = e.newState === 'open';
    if (!open || !pop || !button) return;
    const a = button.getBoundingClientRect();
    const p = placePopover(
      a,
      { width: pop.getBoundingClientRect().width },
      { width: document.documentElement.clientWidth, height: window.innerHeight }
    );
    pop.style.left = `${p.left}px`;
    pop.style.top = `${p.top}px`;
    pop.style.maxHeight = `${p.maxHeight}px`;
    pop.style.visibility = '';
  }

  // While open, a resize or a scroll elsewhere would leave it under the wrong place: close it.
  $effect(() => {
    if (!open) return;
    const hide = () => pop?.hidePopover();
    const onscroll = (e: Event) => {
      if (!(e.target instanceof Node && pop?.contains(e.target))) hide();
    };
    // Escape closes only the list: the key is marked handled, so the dock and the header Menu
    // (which fold on an unhandled Escape) stay as they were.
    const onkey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      hide();
    };
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', onscroll, true);
    window.addEventListener('keydown', onkey, true);
    return () => {
      window.removeEventListener('resize', hide);
      window.removeEventListener('scroll', onscroll, true);
      window.removeEventListener('keydown', onkey, true);
    };
  });

  const undoName = $derived(undoLabel ? `Undo: ${undoLabel}` : 'Undo');
  const redoName = $derived(redoLabel ? `Redo: ${redoLabel}` : 'Redo');

  const BTN =
    'flex min-h-11 min-w-11 items-center justify-center rounded-md border border-control-line bg-surface text-ink enabled:hover:bg-surface-raised disabled:opacity-40 dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark dark:enabled:hover:bg-surface-dark-raised';
</script>

{#snippet icon(paths: readonly string[])}
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    {#each paths as d (d)}<path {d} />{/each}
  </svg>
{/snippet}

<div class="flex flex-wrap items-start gap-1 text-ink dark:text-ink-dark">
  <button
    type="button"
    aria-label={undoName}
    title={undoName}
    disabled={!canUndo}
    class={BTN}
    onclick={() => onundo()}>{@render icon(HISTORY_ICONS.undo)}</button
  >
  <button
    type="button"
    aria-label={redoName}
    title={redoName}
    disabled={!canRedo}
    class={BTN}
    onclick={() => onredo()}>{@render icon(HISTORY_ICONS.redo)}</button
  >
  {#if !coarse}
    <button
      bind:this={button}
      type="button"
      aria-expanded={open}
      aria-controls={popId}
      popovertarget={popId}
      class="flex min-h-11 cursor-pointer items-center rounded-md px-2 text-sm text-ink-muted underline hover:bg-surface-raised dark:text-ink-dark-muted dark:hover:bg-surface-dark-raised"
      ><span aria-hidden="true">Shortcuts</span><span class="sr-only">Keyboard shortcuts</span
      ></button
    >
    <div
      bind:this={pop}
      id={popId}
      popover="auto"
      data-testid="shortcuts"
      {onbeforetoggle}
      {ontoggle}
      class="fixed m-0 w-max max-w-[min(20rem,calc(100vw-1rem))] overflow-y-auto rounded-md border border-control-line bg-surface p-3 text-xs text-ink shadow-lg dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark"
    >
      <table aria-label="Keyboard shortcuts" class="text-left">
        <thead>
          <tr><th scope="col" class="py-1 pr-2">Key</th><th scope="col">Action</th></tr>
        </thead>
        <tbody>
          {#each SHORTCUTS as s (s.keys)}
            <tr><td class="py-1 pr-2 font-mono">{s.keys}</td><td>{s.action}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
