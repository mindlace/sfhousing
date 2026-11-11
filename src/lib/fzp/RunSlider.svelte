<script lang="ts">
  import { medianRank } from '$lib/sim/scenario/band';
  import { positionAt, runValueText, stepPosition } from './run-slider';

  interface Props {
    /** Seeds ranked Best (first) to Worst (last); null while the band is unknown. */
    ranks: readonly number[] | null;
    /** The selected tick; null when the run on screen is not one of the ranked runs. */
    position: number | null;
    /** The run on screen, for the text when no tick is selected. */
    shownSeed: number | null;
    disabled: boolean;
    /** Only on a change of position. */
    onselect: (position: number) => void;
  }

  let { ranks, position, shownSeed, disabled, onselect }: Props = $props();

  const n = $derived(ranks?.length ?? 101);
  const handleAt = $derived(position ?? medianRank(n));
  const seed = $derived(ranks && position !== null ? ranks[position] : null);
  const valueText = $derived(
    ranks
      ? runValueText(ranks, position, shownSeed)
      : shownSeed === null
        ? 'Run slider unavailable'
        : `Run ${shownSeed}`
  );

  let track = $state<HTMLElement>();
  let captured = $state(false);

  function choose(next: number | null) {
    if (disabled || !ranks || next === null || next === position) return;
    onselect(next);
  }

  function fromPointer(e: PointerEvent): number | null {
    if (!track) return null;
    // The padding box: the ticks run inside the 1px border.
    const box = track.getBoundingClientRect();
    return positionAt(e.clientY, box.top + track.clientTop, track.clientHeight, n);
  }

  function onpointerdown(e: PointerEvent) {
    if (disabled || !ranks || e.button !== 0) return;
    track?.setPointerCapture(e.pointerId);
    captured = true;
    choose(fromPointer(e));
  }
  function onpointermove(e: PointerEvent) {
    if (captured) choose(fromPointer(e));
  }
  function onpointerup(e: PointerEvent) {
    captured = false;
    if (track?.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const next = stepPosition(e.key, position, n);
    if (next === null) return;
    e.preventDefault();
    choose(next);
  }
</script>

<div
  class="flex h-full flex-col items-center gap-2 text-xs text-ink select-none dark:text-ink-dark"
>
  <span class="font-semibold">Best</span>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={track}
    data-testid="run-slider-track"
    class="relative min-h-24 w-11 flex-1 touch-none rounded-lg border border-line bg-surface dark:border-line-dark dark:bg-surface-dark"
    class:cursor-pointer={!disabled && ranks !== null}
    class:opacity-60={disabled}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    onpointercancel={onpointerup}
  >
    <div
      class="pointer-events-none absolute inset-x-3 inset-y-0 opacity-50"
      style="background-image: repeating-linear-gradient(to bottom, currentColor 0 1px, transparent 1px calc(100% / {n -
        1}))"
      aria-hidden="true"
    ></div>
    <div
      role="slider"
      tabindex={disabled ? -1 : 0}
      data-testid="run-slider"
      aria-label="Simulated run"
      aria-orientation="vertical"
      aria-valuemin={1}
      aria-valuemax={n}
      aria-valuenow={n - handleAt}
      aria-valuetext={valueText}
      aria-disabled={disabled ? 'true' : undefined}
      {onkeydown}
      class="absolute left-1/2 flex min-h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border border-line bg-surface px-1.5 text-xs font-semibold shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:border-line-dark dark:bg-surface-dark dark:focus-visible:outline-accent-dark pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      style="top: {(handleAt / (n - 1)) * 100}%"
    >
      {#if seed !== null}#{seed}{/if}
    </div>
  </div>
  <span class="font-semibold">Worst</span>
</div>
