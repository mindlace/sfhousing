<!--
  "Where these numbers come from" (spec §4.10): a native modal <dialog>, so it is inert behind,
  traps focus, closes on Escape and returns focus to its opener. Sections 1-9 come from
  `provenanceSections`; the body (`ProvenanceBody`) renders them and section 10, the data checks,
  loaded the first time the dialog opens, held for the page's lifetime, retried on the next open
  after a failure.
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
  import { BUTTON_QUIET, SURFACE_DIALOG_FLUSH } from '$lib/shell/ui';
  import type { TimelineScore } from '$lib/sim/protocol';
  import type { Day } from '$lib/timelapse/time';
  import type { Calibration, ResolvedTerms } from '$lib/timelapse/types';
  import { resolveTerms } from '$lib/sim/finance';
  import ProvenanceBody from './ProvenanceBody.svelte';
  import { provenanceSections } from './provenance';

  interface Props {
    calibration: Calibration;
    score: TimelineScore | null;
    /** `manifest.scenarios.fzp.projects`; null until the manifest is known. */
    projectsUrl: string | null;
    /** In the interface for the caller; the "Simulated counts start" date is the calibration's `asOf`. */
    asOf: Day;
    fetchFn?: typeof fetch;
    onopen?: () => void;
    /** The shown levers' resolved market terms, for "Public money" (4.12); sourced by default. */
    terms?: ResolvedTerms;
  }
  // `asOf` is deliberately not read: the calibration carries the same date.
  // eslint-disable-next-line svelte/no-unused-props
  let {
    calibration,
    score,
    projectsUrl,
    fetchFn,
    onopen,
    terms = resolveTerms()
  }: Props = $props();

  const headingId = $props.id();
  const sections = $derived(provenanceSections(calibration, score, terms));

  let dialog = $state<HTMLDialogElement | null>(null);
  let opener: HTMLElement | null = null;
  let body = $state<ProvenanceBody | null>(null);

  /** Open the dialog, optionally scrolled to the section or entry with this id. */
  export function open(sectionId?: string): void {
    if (dialog === null) return;
    if (!dialog.open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    }
    onopen?.();
    body?.loadChecks();
    if (sectionId !== undefined) {
      dialog.querySelector(`[id="${CSS.escape(sectionId)}"]`)?.scrollIntoView({ block: 'start' });
    }
  }

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

  function onclose() {
    if (opener?.isConnected) opener.focus();
    opener = null;
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
    <h2 id={headingId} class="text-lg font-semibold">Where these numbers come from</h2>
    <button type="button" class="{BUTTON_QUIET} shrink-0 text-sm" onclick={() => dialog?.close()}>
      Close
    </button>
  </div>

  <div
    class="min-h-0 flex-1 overflow-y-auto px-4 pb-6 text-sm [--about-line:var(--color-line)] dark:[--about-line:var(--color-line-dark)]"
  >
    <ProvenanceBody bind:this={body} {sections} {projectsUrl} level={3} {fetchFn} />
  </div>
</dialog>
