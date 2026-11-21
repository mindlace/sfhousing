<!--
  The Shortcuts button and the keyboard shortcuts list it opens in a native popover (nothing on a
  coarse pointer, which has no keyboard: `usePrimaryPointer`, the one rule `BrushEditor` shares).
  `/` puts it last in the Paint tab; `/sim` has it in its header (after Undo and Redo where a
  pointer is coarse; from lg, the page hides it wherever Undo and Redo are in the header, through
  `class`). The popover
  sits in the top layer, so it takes no room in its row and is not clipped by the dock's scroll
  box; script places it under its button. Escape, a second press and an outside press close it,
  as do a resize and a scroll outside it. The label shows as "Shortcuts" while the name stays
  "Keyboard shortcuts": the full words do not fit the header's actions column at 1024 px. Lower
  in the tab than the header, the list can be taller than the room under the button and scrolls
  inside itself, so it is a named region that takes focus (`tabindex`) for a keyboard to scroll
  it (axe `scrollable-region-focusable`). Colours are tokens.
-->
<script lang="ts">
  import { SHORTCUTS } from '$lib/brush/shortcuts';
  import { SURFACE_POP } from '$lib/shell/ui';
  import { placePopover } from './place-popover';
  import { usePrimaryPointer } from './pointer.svelte';

  /** Classes for the button (on /sim: hidden from lg beside Undo and Redo). */
  let { class: extra = undefined }: { class?: string } = $props();

  // Shown once the client has read the query, and only on a fine primary pointer.
  const pointer = usePrimaryPointer();

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
    // In the header the button is shorter than the bar: open under the bar, not over its edge.
    const bar = button.closest('header')?.getBoundingClientRect();
    const p = placePopover(
      { right: a.right, bottom: Math.max(a.bottom, bar?.bottom ?? a.bottom) },
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
</script>

{#if pointer.fine}
  <button
    bind:this={button}
    type="button"
    aria-expanded={open}
    aria-controls={popId}
    popovertarget={popId}
    class={[
      'flex min-h-6 min-w-6 cursor-pointer items-center rounded-md px-2 text-sm text-ink-muted underline hover:bg-surface-raised dark:text-ink-dark-muted dark:hover:bg-surface-dark-raised',
      extra
    ]}
    ><span aria-hidden="true">Shortcuts</span><span class="sr-only">Keyboard shortcuts</span
    ></button
  >
  <!-- A scroll box a keyboard must reach: Svelte flags any tabindex on a region. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    bind:this={pop}
    id={popId}
    popover="auto"
    role="region"
    aria-label="Keyboard shortcuts"
    tabindex="0"
    data-testid="shortcuts"
    {onbeforetoggle}
    {ontoggle}
    class="fixed m-0 w-max max-w-[min(20rem,calc(100vw-1rem))] overflow-y-auto {SURFACE_POP}"
  >
    <table aria-label="Keyboard shortcuts" class="text-left text-xs">
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
