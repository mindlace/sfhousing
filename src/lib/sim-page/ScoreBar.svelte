<!--
  The /sim score bar in the header's pinned slot (layout ruling 1): one button, "{n} homes added"
  at the scrubbed day (`at.total`, never the plan effect), that opens the score details under the
  header: a popover at the top right from md, a full-width disclosure below md. Both end above the
  scrubber dock (`--fzp-dock-top`, published on :root by FzpMode). The button text is not a live
  region; one polite sr-only region speaks only while paused, 1,000 ms after the day settles.
-->
<script lang="ts">
  import { tick, untrack, type Snippet } from 'svelte';
  import { homesAdded, homesAddedBy, scoreAt } from '$lib/fzp/score-view';
  import { monthIndex } from '$lib/fzp/time';
  import { headerOverlay } from '$lib/shell/header-actions.svelte';
  import type { TimelineScore } from '$lib/sim/protocol';
  import type { Day } from '$lib/timelapse/time';

  interface Props {
    /** `null` before the first timeline. */
    score: TimelineScore | null;
    day: Day;
    /** The live region speaks only when this is false. */
    playing: boolean;
    /** The details' contents (FzpMode passes FzpScorePanel). */
    panel: Snippet;
    /** The score is from before the latest levers until their run arrives. */
    busy?: boolean;
  }
  let { score, day, playing, panel, busy = false }: Props = $props();

  const uid = $props.id();
  const detailsId = `${uid}-details`;
  const at = $derived(
    score ? scoreAt(score, monthIndex(day, score.months[0], score.months.length)) : null
  );

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

  // A press anywhere but the button and the details closes them (the header Menu button too, so
  // the Menu and the details never show together). A modal dialog opened from them keeps them.
  function onpointerdown(e: PointerEvent): void {
    const t = e.target as Node | null;
    if (!open || !t || button?.contains(t) || details?.contains(t)) return;
    if (document.querySelector('dialog:modal')) return;
    open = false;
  }

  function onkeydown(e: KeyboardEvent): void {
    if (!open || e.key !== 'Escape' || e.defaultPrevented) return;
    // Escape belongs to the sources dialog while it is open.
    if (document.querySelector('dialog:modal')) return;
    void close();
  }

  // Live region: silent while playing; once paused it speaks 1,000 ms after the day settles.
  // Starting paused, the load state is not announced; starting while playing, the first pause
  // announces where playback stopped.
  const message = $derived(at ? homesAddedBy(day, at) : '');
  let live = $state('');
  let lastSpoken = untrack(() => (playing ? '' : message));
  $effect(() => {
    const msg = message;
    if (playing || msg === '' || msg === lastSpoken) return;
    const t = setTimeout(() => {
      lastSpoken = msg;
      live = msg;
    }, 1000);
    return () => clearTimeout(t);
  });
</script>

<svelte:window {onkeydown} {onpointerdown} />

<button
  bind:this={button}
  type="button"
  class="min-h-6 min-w-6 rounded-md border border-gray-300 px-2 text-sm font-semibold whitespace-nowrap tabular-nums pointer-coarse:min-h-11 pointer-coarse:min-w-11"
  aria-expanded={open}
  aria-controls={detailsId}
  aria-busy={busy}
  data-testid="score-bar"
  onclick={toggle}>{at ? homesAdded(at) : 'Simulating…'}</button
>

{#if open}
  <div
    bind:this={details}
    id={detailsId}
    role="region"
    aria-label="Score details"
    aria-busy={busy}
    data-testid="score-details"
    class="absolute inset-x-0 top-full z-50 overflow-y-auto border-b border-gray-300 bg-white p-4 text-left font-normal shadow-lg md:right-4 md:left-auto md:mt-2 md:w-96 md:rounded-lg md:border"
    style:max-height="calc(var(--fzp-dock-top, 100dvh) - 3rem - 1rem)"
  >
    {@render panel()}
  </div>
{/if}

<span class="sr-only" aria-live="polite" data-testid="score-live">{live}</span>
