<!--
  The explainers after the gift (docs/dev/game.md): one modal dialog, one new policy at a time: its
  title, the step ("1 of 3"), a line on what it is and, for a zoning policy, its rules. Accept shows
  the next; after the last it closes and calls `onclose`. A native modal, so the page is inert
  behind it; Accept is the one control and holds focus (Tab stays on it). Escape acts as Accept:
  the policies are already in the document, so nothing is lost by it.
-->
<script lang="ts">
  import { BUTTON_PRIMARY, SURFACE_DIALOG } from '$lib/shell/ui';
  import type { GiftItem } from '../round-panel';

  interface GiftDialogProps {
    items: GiftItem[];
    onclose: () => void;
  }

  let { items, onclose }: GiftDialogProps = $props();

  const headingId = $props.id();
  let dialog = $state<HTMLDialogElement | null>(null);
  let at = $state(0);
  const item = $derived(items.length === 0 ? null : items[Math.min(at, items.length - 1)]);

  $effect(() => {
    if (dialog && !dialog.open && items.length > 0) dialog.showModal();
  });

  function accept(): void {
    if (at < items.length - 1) {
      at += 1;
      return;
    }
    dialog?.close();
  }

  // Escape in the capture phase, marked handled, so the native close never runs (a second Escape
  // without a press in between would otherwise close the dialog past the rest).
  $effect(() => {
    const onkey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !dialog?.open || e.defaultPrevented) return;
      e.preventDefault();
      accept();
    };
    document.addEventListener('keydown', onkey, { capture: true });
    return () => document.removeEventListener('keydown', onkey, { capture: true });
  });

  /** Accept is the only control: Tab stays on it instead of leaving through the browser's UI. */
  function onkeydown(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    dialog?.querySelector<HTMLElement>('[data-testid=gift-accept]')?.focus();
  }
</script>

{#if item}
  <dialog
    bind:this={dialog}
    data-testid="gift-dialog"
    aria-labelledby={headingId}
    oncancel={(e) => {
      e.preventDefault();
      accept();
    }}
    {onclose}
    {onkeydown}
    class="m-auto w-[calc(100vw-2rem)] max-w-md {SURFACE_DIALOG}"
  >
    <div aria-live="polite" class="space-y-2">
      <p
        data-testid="gift-step"
        class="text-xs font-medium text-ink-muted dark:text-ink-dark-muted"
      >
        {at + 1} of {items.length}
      </p>
      <h2 id={headingId} class="text-lg font-semibold">{item.title}</h2>
      <p class="text-sm">{item.line}</p>
      {#if item.rules !== ''}
        <p data-testid="gift-rules" class="text-sm font-medium">{item.rules}</p>
      {/if}
    </div>
    <div class="mt-4 flex justify-end">
      <!-- svelte-ignore a11y_autofocus -->
      <button
        type="button"
        data-testid="gift-accept"
        class={BUTTON_PRIMARY}
        autofocus
        onclick={accept}>Accept</button
      >
    </div>
  </dialog>
{/if}
