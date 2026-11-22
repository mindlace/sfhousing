<!--
  About this model over the map (/sim and /s/<id>; docs/dev/about.md): the four parts at level 3,
  the assumptions live (the run's sections). A native modal <dialog>, so it is inert behind and
  traps focus. Nothing of the parts is built, and nothing fetched, before the first open; each open
  starts the data checks (a no-op once loaded, a retry after a failure). While mounted, a plain
  click on any link to /about opens it at the link's fragment (links.ts). Escape closes it once and
  is marked handled, unless something above it (an open explanation) took the key first. On close,
  focus returns to the opener while it is rendered, else to the header's Menu button.
-->
<script module lang="ts">
  /** Every element kind that can take keyboard focus (the Tab wrap filters out tabindex=-1). */
  const FOCUSABLE = [
    'a[href]',
    'area[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'summary',
    'iframe',
    'audio[controls]',
    'video[controls]',
    '[contenteditable]:not([contenteditable="false"])',
    '[tabindex]'
  ].join(', ');
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import type { ManifestSources } from '$lib/data/manifest';
  import type { ProvSection } from '$lib/fzp/provenance';
  import { focusHeaderMenu } from '$lib/shell/header-actions.svelte';
  import { BUTTON_QUIET, SURFACE_DIALOG_FLUSH } from '$lib/shell/ui';
  import AboutAssumptions from './AboutAssumptions.svelte';
  import AboutData from './AboutData.svelte';
  import AboutMeanings from './AboutMeanings.svelte';
  import AboutUsing from './AboutUsing.svelte';
  import { ABOUT_TITLE } from './copy';
  import { focusLanding } from './land';
  import { interceptAboutLinks } from './links';

  interface Props {
    manifest: ManifestSources | null;
    datasetVersion: string;
    /** The run's sections (`provenanceSections`); read only once the dialog has opened. */
    sections: ProvSection[];
    /** `manifest.scenarios.fzp.projects`; null until the manifest is known. */
    projectsUrl: string | null;
    fetchFn?: typeof fetch;
    onopen?: () => void;
  }

  let { manifest, datasetVersion, sections, projectsUrl, fetchFn, onopen }: Props = $props();

  const headingId = $props.id();

  let dialog = $state<HTMLDialogElement | null>(null);
  let scroller = $state<HTMLElement | null>(null);
  let assumptions = $state<AboutAssumptions | null>(null);
  /** The parts are built on the first open and kept. */
  let built = $state(false);
  let opener: HTMLElement | null = null;

  /**
   * Open the dialog. `target`: '' (the top), an ABOUT_ID value, or an entry id (src-…), scrolled
   * to the top of the dialog's scroll box.
   */
  export function open(target = ''): void {
    show(target, null);
  }

  function show(target: string, from: HTMLElement | null): void {
    if (dialog === null) return;
    if (!dialog.open) {
      opener =
        from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      dialog.showModal();
    }
    onopen?.();
    built = true;
    // The parts mount with the first open: wait for them before loading and scrolling.
    void tick().then(() => {
      if (!dialog?.open) return;
      const checks = assumptions?.loadChecks();
      if (scroller === null) return;
      const box = scroller;
      const el = target ? box.querySelector(`[id="${CSS.escape(target)}"]`) : null;
      const visit = ++visits;
      moved = false;
      land(box, el);
      // Focus where the reader was sent, so the next Tab starts there; with no target Close keeps it.
      if (el) focusLanding(el);
      // The data checks grow when they arrive, above every later part, and WebKit anchors no
      // scroll: land again then, unless the reader has scrolled or another open came first.
      void checks?.then(() => {
        if (visit === visits && !moved && dialog?.open) land(box, el);
      });
    });
  }

  /** The scroll box alone: scrollIntoView would also scroll the dialog, hiding its title row. */
  function land(box: HTMLElement, el: Element | null): void {
    box.scrollTop = el
      ? box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top
      : 0;
  }

  /** Counts opens: a later land belongs to the open that asked for it. */
  let visits = 0;
  /** The reader moved the scroll box (wheel, touch, a press, a key) since the last open. */
  let moved = false;
  const onmove = () => (moved = true);
  $effect(() => {
    const box = scroller;
    if (box === null) return;
    const kinds = ['wheel', 'touchmove', 'pointerdown', 'keydown'] as const;
    for (const k of kinds) box.addEventListener(k, onmove, { capture: true, passive: true });
    return () => {
      for (const k of kinds) box.removeEventListener(k, onmove, { capture: true });
    };
  });

  $effect(() => interceptAboutLinks((fragment, link) => show(fragment, link)));

  // Escape: on the document in the capture phase, so it is marked handled before any bubbling
  // handler under the dialog (a card, the dock) sees it. An explanation's capture listener on the
  // window runs first; a key it handled is left alone, and the dialog stays open.
  $effect(() => {
    const onkey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !dialog?.open || e.defaultPrevented) return;
      e.preventDefault();
      dialog.close();
    };
    document.addEventListener('keydown', onkey, { capture: true });
    return () => document.removeEventListener('keydown', onkey, { capture: true });
  });

  /**
   * A native modal keeps the page inert, but Chromium still lets Tab leave through the browser's
   * own UI after the last control. Wrap instead, so focus never leaves the dialog.
   */
  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab' || dialog === null) return;
    // In the tab order and rendered (not tabindex=-1, not inside a closed <details>).
    const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.tabIndex >= 0 && el.getClientRects().length > 0
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || !dialog.contains(at))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !dialog.contains(at))) {
      e.preventDefault();
      first.focus();
    }
  }

  // Back to the opener while it is rendered; one in the phone's Menu is hidden once the Menu
  // closed, so the Menu button; the body only when neither exists.
  function onclose() {
    const o = opener;
    opener = null;
    if (o?.isConnected && o.getClientRects().length > 0) o.focus();
    else if (!focusHeaderMenu() && document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby={headingId}
  {onclose}
  {onkeydown}
  class="m-auto w-full max-w-2xl open:flex open:max-h-[85vh] open:flex-col max-md:max-w-none {SURFACE_DIALOG_FLUSH}"
>
  <div
    class="flex items-start justify-between gap-2 border-b border-line px-4 py-2 dark:border-line-dark"
  >
    <h2 id={headingId} class="text-lg font-semibold">{ABOUT_TITLE}</h2>
    <button type="button" class="{BUTTON_QUIET} shrink-0 text-sm" onclick={() => dialog?.close()}>
      Close
    </button>
  </div>

  <!-- The parts' two colour properties, with dark partners: the dialog follows the theme. -->
  <div
    bind:this={scroller}
    data-about-scroll
    class="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pt-4 pb-6 text-sm [--about-line:var(--color-line)] [--about-muted:var(--color-ink-muted)] dark:[--about-line:var(--color-line-dark)] dark:[--about-muted:var(--color-ink-dark-muted)]"
  >
    {#if built}
      <AboutMeanings level={3} />
      <AboutAssumptions
        bind:this={assumptions}
        level={3}
        live={{ sections, projectsUrl }}
        {fetchFn}
      />
      <AboutData level={3} {datasetVersion} {manifest} />
      <AboutUsing level={3} />
    {/if}
  </div>
</dialog>
