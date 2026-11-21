<!--
  One message in its shape (docs/dev/ui-parts.md): a chip for a few words (CHIP, the text then the
  actions on one line), a card for a paragraph (CARD, the text wraps, the actions and the details
  under it). The shape follows the words (`messageShape`), so the same message always looks the
  same; `shape` overrides it. No role of its own: the page's status and alert containers stay
  where they are, so what is announced and when does not change. `textRole` and `textTestid` are
  for a page whose live region is the words alone (the load failure's alert, without its Retry).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { CARD, CHIP, CHIP_STILL, messageShape, type MessageShape } from './ui';

  interface Props {
    text: string;
    shape?: MessageShape;
    actions?: Snippet;
    details?: Snippet;
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
    still = false,
    testid,
    textRole,
    textTestid
  }: Props = $props();

  const s = $derived(shape ?? messageShape(text, !!details));
  // A chip with no action pads its right as its left.
  const chip = $derived(still ? CHIP_STILL : actions ? CHIP : CHIP.replace('pr-1', 'pr-4'));
</script>

{#if s === 'chip'}
  <div data-testid={testid} data-shape="chip" class={chip}>
    <span role={textRole} data-testid={textTestid} class="min-w-0">{text}</span>
    {@render actions?.()}
  </div>
{:else}
  <div data-testid={testid} data-shape="card" class={CARD}>
    <span role={textRole} data-testid={textTestid}>{text}</span>
    {#if actions}
      <!-- The quiet buttons' padding lines their words up with the text. -->
      <div class="-my-2 -ml-3 flex flex-wrap items-center">{@render actions()}</div>
    {/if}
    {@render details?.()}
  </div>
{/if}
