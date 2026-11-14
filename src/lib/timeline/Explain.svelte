<script lang="ts">
  // The one explanation component (rule 37). WCAG 1.4.13: it appears on pointer enter, focus and
  // tap; stays while the pointer is over the target or the text (the text sits inside the same
  // wrapper); closes on Escape, on focus leaving both, and on a second tap. The text exists only
  // while open. From md it is a popover beside the target, below md an inline line under it.
  import type { Snippet } from 'svelte';

  interface Props {
    /** The explanation: short, what the reader cannot infer. */
    text: string;
    /** 'button': wraps a non-interactive target in a button; 'wrap': the child is focusable. */
    as?: 'button' | 'wrap';
    /** Accessible name of the button (default: the child's text). */
    label?: string;
    children: Snippet;
  }

  let { text, as = 'button', label = undefined, children }: Props = $props();

  const id = $props.id();
  const textId = `${id}-explain`;

  let open = $state(false);
  let wrapper: HTMLElement | undefined = $state();
  // Whether the panel was open when a touch or pen press began (it opens on focus in between).
  let openAtPress = false;
  let pressKind = '';

  const withinFocus = () => !!wrapper && wrapper.contains(document.activeElement);

  function onenter(e: PointerEvent) {
    if (e.pointerType === 'mouse') open = true;
  }
  function onleave(e: PointerEvent) {
    if (e.pointerType === 'mouse' && !withinFocus()) open = false;
  }
  function onfocusin() {
    open = true;
  }
  function onfocusout(e: FocusEvent) {
    const next = e.relatedTarget as Node | null;
    if (!next || !wrapper?.contains(next)) open = false;
  }
  // On the window: Escape closes however it opened, including by hover with focus elsewhere.
  function onwindowkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      open = false;
      e.stopPropagation();
    }
  }
  function onpointerdown(e: PointerEvent) {
    pressKind = e.pointerType;
    openAtPress = open;
  }
  // Wrap mode has no second-tap close: a tap there belongs to the focusable child's own action.
  function onclick(e: MouseEvent) {
    if (as !== 'button') return;
    if (e.detail === 0) open = !open;
    else if (pressKind === 'mouse') open = true;
    else open = !openAtPress;
  }

  // Wrap mode: the focusable child gets the description while open.
  $effect(() => {
    if (as !== 'wrap' || !wrapper) return;
    const el = wrapper.querySelector<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]'
    );
    if (!el) return;
    // Added to what the child already points at (an error line, say), never replacing it.
    const own = el.getAttribute('aria-describedby');
    if (open) el.setAttribute('aria-describedby', own ? `${own} ${textId}` : textId);
    return () => {
      if (own) el.setAttribute('aria-describedby', own);
      else el.removeAttribute('aria-describedby');
    };
  });
</script>

<svelte:window onkeydown={onwindowkeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
  bind:this={wrapper}
  class="relative inline-flex flex-col md:inline-block"
  onpointerenter={onenter}
  onpointerleave={onleave}
  {onfocusin}
  {onfocusout}
  {onpointerdown}
>
  {#if as === 'button'}
    <button
      type="button"
      class="cursor-help text-left"
      aria-label={label}
      aria-expanded={open}
      aria-describedby={open ? textId : undefined}
      {onclick}
    >
      {@render children()}
    </button>
  {:else}
    {@render children()}
  {/if}
  {#if open}
    <span
      id={textId}
      role="tooltip"
      data-explain-open
      class="mt-1 text-sm text-ink-muted md:absolute md:top-0 md:left-full md:z-30 md:mt-0 md:ml-1 md:w-max md:max-w-[min(14rem,calc(100vw-2rem))] md:rounded md:border md:border-line md:bg-surface md:px-2 md:py-1 md:text-ink md:shadow-md"
    >
      {text}
    </span>
  {/if}
</span>
