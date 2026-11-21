<!--
  One message in its shape (docs/dev/ui-parts.md): a chip for a few words (CHIP, the text then the
  actions on one line), a card for a paragraph (CARD, the text wraps, the actions and the details
  under it). The shape follows the words (`messageShape`), so the same message always looks the
  same; `shape` overrides it. No role of its own: the page's status and alert containers stay
  where they are, so what is announced and when does not change. `textRole` and `textTestid` are
  for a page whose live region is the words alone (the load failure's alert, without its Retry).
  `ondismiss` draws the one dismiss (BUTTON_DISMISS, the drawn ×, named "Dismiss"): last on a
  chip's line; on a card, top right on the text's first line, pulled into the padding so it adds
  no height, the other actions staying in the row under the text.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { BUTTON_DISMISS, CARD, CHIP, CHIP_STILL, messageShape, type MessageShape } from './ui';

  interface Props {
    text: string;
    shape?: MessageShape;
    actions?: Snippet;
    details?: Snippet;
    /** Given: the message's dismiss (×); the press's event, for a page that moves focus on. */
    ondismiss?: (e: MouseEvent) => void;
    /** A chip that takes no presses (the stroke chip). */
    still?: boolean;
    testid?: string;
    textRole?: 'status' | 'alert';
    textTestid?: string;
  }

  let {
    text,
    shape = undefined,
    actions,
    details,
    ondismiss = undefined,
    still = false,
    testid,
    textRole,
    textTestid
  }: Props = $props();

  const s = $derived(shape ?? messageShape(text, !!details));
  // A chip with no action pads its right as its left.
  const chip = $derived(
    still ? CHIP_STILL : actions || ondismiss ? CHIP : CHIP.replace('pr-1', 'pr-4')
  );
</script>

{#snippet dismiss(extra: string)}
  <button
    type="button"
    aria-label="Dismiss"
    class="{BUTTON_DISMISS} {extra}"
    onclick={(e) => ondismiss?.(e)}
  >
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" />
    </svg>
  </button>
{/snippet}

{#if s === 'chip'}
  <div data-testid={testid} data-shape="chip" class={chip}>
    <span role={textRole} data-testid={textTestid} class="min-w-0">{text}</span>
    {@render actions?.()}
    {#if ondismiss}{@render dismiss('')}{/if}
  </div>
{:else}
  <div data-testid={testid} data-shape="card" class={CARD}>
    {#if ondismiss}
      <!-- The × on the first line: its 24 px box is 2 px taller than the line, so it is pulled up
           and down by 2 px (no extra height) and right into the padding. -->
      <div class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-1">
        <span role={textRole} data-testid={textTestid}>{text}</span>
        {@render dismiss('-my-0.5 -mr-2')}
      </div>
    {:else}
      <span role={textRole} data-testid={textTestid}>{text}</span>
    {/if}
    {#if actions}
      <!-- The quiet buttons' padding lines their words up with the text. -->
      <div class="-my-2 -ml-3 flex flex-wrap items-center">{@render actions()}</div>
    {/if}
    {@render details?.()}
  </div>
{/if}
