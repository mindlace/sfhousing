<!--
  The /lesscars headline in the header's pinned slot: one button, "+N homes by 2068", that opens
  the details under the header: a popover at the top right from md, a full-width disclosure below
  md. The text follows the high-water mark (the latest reached year end's mean, "No extra homes
  yet" before the first), so it changes with playback; there is no live region. The details close on Escape, an
  outside press, or another header overlay; focus returns to the button only when it was inside
  them.
-->
<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import type { LessCarsSummary } from '$lib/data/lesscars/codec';
  import { headerOverlay } from '$lib/shell/header-actions.svelte';
  import type { Day } from '$lib/timelapse/time';
  import { headlineName, headlineText, revealedYearIndex } from './summary-view';

  interface Props {
    summary: LessCarsSummary;
    /** The furthest day reached; the headline shows the latest year end at or before it. */
    highWater: Day;
    /** The details' contents (the page passes DetailsPanel). */
    panel: Snippet;
  }
  let { summary, highWater, panel }: Props = $props();

  const idx = $derived(revealedYearIndex(summary, highWater));

  const uid = $props.id();
  const detailsId = `${uid}-details`;

  let open = $state(false);
  let button = $state<HTMLButtonElement>();
  let details = $state<HTMLDivElement>();

  const openOnly = headerOverlay(detailsId, () => (open = false));

  function toggle(): void {
    open = !open;
    if (open) openOnly();
  }

  async function close(): Promise<void> {
    // Restore focus only if it was in the details (or lost to <body>); never steal it.
    const a = document.activeElement;
    const restore = !a || a === document.body || !!details?.contains(a);
    open = false;
    await tick();
    if (restore) button?.focus();
  }

  // A press anywhere but the button and the details closes them (the header Menu button too).
  // A modal dialog opened from them keeps them.
  function onpointerdown(e: PointerEvent): void {
    const t = e.target as Node | null;
    if (!open || !t || button?.contains(t) || details?.contains(t)) return;
    if (document.querySelector('dialog:modal')) return;
    open = false;
  }

  function onkeydown(e: KeyboardEvent): void {
    if (!open || e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.querySelector('dialog:modal')) return;
    void close();
  }
</script>

<svelte:window {onkeydown} {onpointerdown} />

<button
  bind:this={button}
  type="button"
  class="min-h-6 min-w-6 rounded-md border border-gray-300 px-2 text-sm font-semibold whitespace-nowrap tabular-nums dark:border-gray-600 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
  aria-label={headlineName(summary, idx)}
  aria-expanded={open}
  aria-controls={detailsId}
  data-testid="lc-headline"
  onclick={toggle}>{headlineText(summary, idx)}</button
>

{#if open}
  <div
    bind:this={details}
    id={detailsId}
    role="region"
    aria-label="Fewer-cars details"
    data-testid="lc-details"
    class="absolute inset-x-0 top-full z-50 overflow-y-auto border-b border-gray-300 bg-white p-4 text-left font-normal text-gray-900 shadow-lg md:right-4 md:left-auto md:mt-2 md:w-96 md:rounded-lg md:border dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
    style:max-height="calc(100dvh - 4rem)"
  >
    {@render panel()}
  </div>
{/if}
