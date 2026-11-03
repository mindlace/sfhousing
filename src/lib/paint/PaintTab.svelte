<!--
  The Paint tab shared by `/sim` and `/`: the brush tools (Move, Paint, Erase as a radiogroup with
  a roving tab stop), the height palette (disabled with the mode's hint while Erase is chosen), the
  brush size, then "Painted areas": one row per painted height (or erase), in creation order, a
  later stroke winning where they overlap. A row is a select button (pressed = the row shown on the
  map) holding a neutral swatch, its name and its meta, whose lot part is a polite status
  (WCAG 4.1.3); Retry when its lot lookup failed; and, when selected, Remove. After Remove focus
  moves to the row now at that place, the one before it, or the checked tool radio. `readonly`
  (a shared plan) shows the rows alone. Colours are tokens.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import type { BrushTool } from '$lib/brush/sampler';
  import RadiusPopover from '$lib/brush/RadiusPopover.svelte';
  import type { BrushState } from '$lib/brush/state.svelte';
  import HeightPalette from './HeightPalette.svelte';
  import { count, lotsText, rowMeta, rowName, type PaintRow } from './rows';
  import { PAINT_TOOLS } from './tools';

  interface Props {
    brush: BrushState;
    tool: BrushTool;
    /** The page routes it through its controller (which cancels a stroke). */
    ontool(t: BrushTool): void;
    rows: readonly PaintRow[];
    /** A row id. */
    selected: string | null;
    onselect(id: string | null): void;
    onremove(id: string): void;
    /** Why the height palette is disabled while Erase is chosen. */
    eraseHint: string;
    /** A shared plan: rows only, no tools, no Remove. */
    readonly?: boolean;
    /** A row's lot lookup failed: retry its keys. */
    onretry?: (keys: string[]) => void;
  }

  let {
    brush,
    tool,
    ontool,
    rows,
    selected,
    onselect,
    onremove,
    eraseHint,
    readonly = false,
    onretry = undefined
  }: Props = $props();

  const radios: Partial<Record<BrushTool, HTMLButtonElement>> = $state({});
  let list = $state<HTMLOListElement>();

  const enabled = (t: BrushTool) => t === 'move' || brush.phase === 'ready';
  const tabStop = $derived<BrushTool>(enabled(tool) ? tool : 'move');

  function choose(t: BrushTool) {
    if (!enabled(t) || tool === t) return;
    ontool(t);
  }

  function onRadioKey(e: KeyboardEvent, from: BrushTool) {
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (dir === 0) return;
    e.preventDefault();
    const ids = PAINT_TOOLS.map((t) => t.id);
    let i = ids.indexOf(from);
    for (let n = 0; n < ids.length; n++) {
      i = (i + dir + ids.length) % ids.length;
      if (enabled(ids[i])) break;
    }
    choose(ids[i]);
    radios[ids[i]]?.focus();
  }

  function remove(id: string, index: number) {
    onremove(id);
    // The row is gone once the page has applied the removal: focus the row now at its place, the
    // one before it, or the tool radio that is the group's tab stop.
    void tick().then(() => {
      const items = list?.querySelectorAll<HTMLButtonElement>('[data-paint-row]') ?? [];
      const target = items[Math.min(index, items.length - 1)];
      (target ?? radios[tabStop])?.focus();
    });
  }

  const erase = PAINT_TOOLS.find((t) => t.id === 'erase')!;
  const btn =
    'min-h-6 min-w-6 rounded-md px-2 font-semibold underline pointer-coarse:min-h-11 pointer-coarse:min-w-11';
</script>

<div class="flex flex-col gap-3 text-sm text-ink dark:text-ink-dark">
  {#if !readonly}
    <div role="radiogroup" aria-label="Brush tool" class="flex flex-wrap gap-1">
      {#each PAINT_TOOLS as t (t.id)}
        <button
          bind:this={radios[t.id]}
          type="button"
          role="radio"
          aria-checked={tool === t.id}
          tabindex={t.id === tabStop ? 0 : -1}
          disabled={!enabled(t.id)}
          class="paint-tool flex min-h-11 min-w-11 items-center gap-1.5 rounded-md border border-control-line bg-surface px-2 text-ink enabled:hover:bg-surface-raised disabled:opacity-40 dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark dark:enabled:hover:bg-surface-dark-raised"
          onclick={() => choose(t.id)}
          onkeydown={(e) => onRadioKey(e, t.id)}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            {#each t.icon as d (d)}<path {d} />{/each}
          </svg>
          {t.label}
        </button>
      {/each}
    </div>

    <HeightPalette {brush} disabled={tool === 'erase'} hint={eraseHint} />

    <RadiusPopover state={brush} inline />
  {/if}

  {#if rows.length > 0}
    <ol bind:this={list} aria-label="Painted areas" class="flex flex-col gap-2">
      {#each rows as row, i (row.id)}
        {@const isSel = selected === row.id}
        {@const name = rowName(row)}
        {@const meta = rowMeta(row)}
        <li
          class="flex flex-col gap-1 rounded-md border p-1 {isSel
            ? 'border-accent bg-surface-raised dark:border-accent-dark dark:bg-surface-dark-raised'
            : 'border-line bg-surface dark:border-line-dark dark:bg-surface-dark'}"
        >
          <button
            type="button"
            data-paint-row={row.id}
            aria-pressed={isSel}
            class="flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-left hover:bg-surface-raised dark:hover:bg-surface-dark-raised"
            onclick={() => onselect(isSel ? null : row.id)}
          >
            <!-- The same neutral ink tile as the palette: the height, or an eraser. -->
            <span
              aria-hidden="true"
              class="flex size-8 shrink-0 items-center justify-center rounded-md bg-ink text-sm font-medium text-surface dark:bg-ink-dark dark:text-surface-dark"
            >
              {#if row.kind === 'erase' || row.stories === null}
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  {#each erase.icon as d (d)}<path {d} />{/each}
                </svg>
              {:else}
                {row.stories}
              {/if}
            </span>
            <span class="flex min-w-0 flex-col">
              <span class="font-semibold">{name}</span>
              <span class="text-ink-muted dark:text-ink-dark-muted"
                >{count(row.strokes, 'stroke', 'strokes')} ·
                <span role="status">{lotsText(row.lots)}</span></span
              >
            </span>
          </button>
          {#if row.lots.kind === 'failed' || (isSel && !readonly)}
            <div class="flex flex-wrap gap-x-2 gap-y-1">
              {#if row.lots.kind === 'failed'}
                {@const keys = row.lots.keys}
                <button
                  type="button"
                  aria-label="Retry: {name} · {meta}"
                  class={btn}
                  onclick={() => onretry?.(keys)}>Retry</button
                >
              {/if}
              {#if isSel && !readonly}
                <button
                  type="button"
                  aria-label="Remove: {name} · {meta}"
                  class={btn}
                  onclick={() => remove(row.id, i)}>Remove</button
                >
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .paint-tool[aria-checked='true'] {
    background: color-mix(in srgb, currentColor 10%, transparent);
    box-shadow: inset 0 -3px 0 currentColor;
    font-weight: 600;
  }
</style>
