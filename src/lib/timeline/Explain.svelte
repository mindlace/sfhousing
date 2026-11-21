<script lang="ts">
  // The one explanation component (rule 37). WCAG 1.4.13: it appears on pointer enter, focus and
  // tap; stays while the pointer is over the target or the text (the text sits inside the same
  // wrapper); closes on Escape, on focus leaving both, and on a second tap. The text exists only
  // while open. From md it is a popover beside the target, below md an inline line under it.
  import type { Snippet } from 'svelte';
  import { TARGET } from '$lib/shell/ui';

  interface Props {
    /** The explanation: short, what the reader cannot infer. */
    text: string;
    /** 'button': wraps a non-interactive target in a button; 'wrap': the child is focusable. */
    as?: 'button' | 'wrap';
    /** Accessible name of the button (default: the child's text). */
    label?: string;
    /**
     * Wrap mode: whether the open text describes the child (default true). False when the child
     * carries the same words as a description of its own at rest, so they are read once.
     */
    describes?: boolean;
    /**
     * Never opens (and closes if open), with the same elements in place: a child that only
     * sometimes needs explaining keeps its node, so focus on it survives the switch.
     */
    off?: boolean;
    children: Snippet;
  }

  let {
    text,
    as = 'button',
    label = undefined,
    describes = true,
    off = false,
    children
  }: Props = $props();

  const id = $props.id();
  const textId = `${id}-explain`;

  let opened = $state(false);
  /** Shown: opened, and not switched off. */
  const open = $derived(opened && !off);
  let wrapper: HTMLElement | undefined = $state();
  // Whether the panel was open when a touch or pen press began (it opens on focus in between).
  let openAtPress = false;
  let pressKind = '';

  /**
   * Dismissed by Escape: a mouse entering does not reopen it until the pointer moves. A layout
   * change can put the target under a resting pointer, and the browser then sends an enter with no
   * move (WCAG 1.4.13: dismissed without moving the pointer).
   */
  let dismissed = false;

  const withinFocus = () => !!wrapper && wrapper.contains(document.activeElement);

  function onenter(e: PointerEvent) {
    if (e.pointerType === 'mouse' && !dismissed) opened = true;
  }
  function onmove(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || !dismissed) return;
    dismissed = false;
    opened = true;
  }
  function onleave(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    dismissed = false;
    if (!withinFocus()) opened = false;
  }
  function onfocusin() {
    dismissed = false;
    opened = true;
  }
  function onfocusout(e: FocusEvent) {
    const next = e.relatedTarget as Node | null;
    if (!next || !wrapper?.contains(next)) opened = false;
  }
  /** Closes on Escape and marks the key handled, so no other Escape handler acts on it too. */
  function dismiss(e: KeyboardEvent) {
    opened = false;
    dismissed = true;
    e.preventDefault();
  }
  // On the window, in the capture phase: Escape closes however it opened, including by hover with
  // focus elsewhere, before any bubbling window handler (a card, the Menu, the dock) sees it; they
  // skip a key already handled (`defaultPrevented`). A key from inside is left to `onkeydown`.
  function onwindowkeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !open) return;
    if (e.target instanceof Node && wrapper?.contains(e.target)) return;
    dismiss(e);
  }
  $effect(() => {
    window.addEventListener('keydown', onwindowkeydown, { capture: true });
    return () => window.removeEventListener('keydown', onwindowkeydown, { capture: true });
  });
  // Within it: an open explanation is the innermost layer, so Escape closes it and goes no further
  // (a panel or sheet around it keeps its own Escape for the next press).
  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !open) return;
    dismiss(e);
    e.stopPropagation();
  }
  // A native listener on the wrapper, not a delegated one: it runs before any container's handler,
  // delegated (at the root) or native, and stopping it there keeps them all from seeing the key.
  $effect(() => {
    const el = wrapper;
    if (!el) return;
    el.addEventListener('keydown', onkeydown);
    return () => el.removeEventListener('keydown', onkeydown);
  });
  function onpointerdown(e: PointerEvent) {
    pressKind = e.pointerType;
    openAtPress = open;
  }
  // Wrap mode has no second-tap close: a tap there belongs to the focusable child's own action.
  function onclick(e: MouseEvent) {
    if (as !== 'button') return;
    if (e.detail === 0) opened = !open;
    else if (pressKind === 'mouse') opened = true;
    else opened = !openAtPress;
  }

  // Wrap mode: the focusable child gets the description while open (unless it describes itself).
  $effect(() => {
    if (as !== 'wrap' || !describes || !wrapper) return;
    const el = wrapper.querySelector<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]'
    );
    if (!el || !open) return;
    // Its own token is added to what the child points at (an error line, say), and only that token
    // is taken out again, from the value at that moment: ids set while open are kept.
    const ids = () => (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    const set = (list: string[]) => {
      if (list.length > 0) el.setAttribute('aria-describedby', list.join(' '));
      else el.removeAttribute('aria-describedby');
    };
    if (!ids().includes(textId)) set([...ids(), textId]);
    return () => set(ids().filter((t) => t !== textId));
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
  bind:this={wrapper}
  class="relative inline-flex flex-col md:inline-block"
  onpointerenter={onenter}
  onpointerleave={onleave}
  onpointermove={onmove}
  {onfocusin}
  {onfocusout}
  {onpointerdown}
>
  {#if as === 'button'}
    <button
      type="button"
      class="{TARGET} cursor-help text-left"
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
    <!-- From md the text is a pop-over drawn as SURFACE_TIP (src/lib/shell/ui.ts), each class with
         `md:`; below md a muted line under the target. ui.spec.ts keeps the two in step. -->
    <span
      id={textId}
      role="tooltip"
      data-explain-open
      class="mt-1 text-sm text-ink-muted md:absolute md:top-0 md:left-full md:z-30 md:mt-0 md:ml-1 md:w-max md:max-w-[min(14rem,calc(100vw-2rem))] md:rounded md:border md:border-line md:bg-surface md:px-2 md:py-1 md:text-ink md:shadow-md dark:text-ink-dark-muted md:dark:border-line-dark md:dark:bg-surface-dark md:dark:text-ink-dark"
    >
      {text}
    </span>
  {/if}
</span>
