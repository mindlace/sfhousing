<!--
  Paint's key panel (`/` and `/p/<id>`, inside MapKeyControl): the six building types beside their
  colours under "New buildings", then, once the plan holds a paint op, one toggle button per
  painted height under "Painted" ("6 stories · 42 lots · 30 rebuilt", `heightRowText`; the
  height alone until its count arrives). Pointer enter and keyboard focus show a height's dashed
  outline on the map; leave and blur clear it unless the row is pressed (`aria-pressed`); a press
  pins it until it is pressed again or another row is. A row whose height leaves the plan takes
  its outline with it.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import KeySwatch from '$lib/map/key/KeySwatch.svelte';
  import { KEY_COPY } from '$lib/map/key/copy';
  import { TYPE_KEY } from '$lib/map/key/rows';
  import { TOKENS } from '$lib/map/palette';
  import { useSystemTheme } from '$lib/map/system-theme.svelte';
  import type { PlanOp } from '$lib/plan';
  import type { HeightLotsResult } from '$lib/sim/protocol';
  import { heightRowText, heightsOf } from './heights';

  interface Props {
    ops: readonly PlanOp[];
    result: HeightLotsResult | null;
    /** The height whose outline is on the map. */
    shown: number | null;
    /** Hover, focus or press: the height to outline, or null. */
    onshow(stories: number | null): void;
  }
  let { ops, result, shown, onshow }: Props = $props();

  const id = $props.id();
  /** The map draws the outline in the system theme's token (BrushEditor's outline slot). */
  const theme = useSystemTheme();
  const heights = $derived(heightsOf(ops));

  let hovered = $state<number | null>(null);
  let focused = $state<number | null>(null);
  let pinned = $state<number | null>(null);

  // A height that leaves the plan takes its hover, focus and pin with it (its row is gone, so no
  // leave or blur will come).
  $effect(() => {
    const hs = heights;
    untrack(() => {
      if (hovered !== null && !hs.includes(hovered)) hovered = null;
      if (focused !== null && !hs.includes(focused)) focused = null;
      if (pinned !== null && !hs.includes(pinned)) pinned = null;
    });
  });

  /** What the pointer or the keyboard is on, else the pinned row. */
  const wanted = $derived(hovered ?? focused ?? pinned);
  $effect(() => {
    const w = wanted;
    untrack(() => onshow(w));
  });

  function text(stories: number): string {
    const row = result?.heights.find((h) => h.stories === stories);
    return row
      ? heightRowText(stories, row.lots, row.rebuilt, result!.missing)
      : heightRowText(stories, null, 0, 0);
  }

  const ROW =
    'flex min-h-6 w-full items-center gap-2 rounded-md px-1 text-left pointer-coarse:min-h-11 hover:bg-surface-raised data-shown:bg-surface-raised aria-pressed:font-semibold dark:hover:bg-surface-dark-raised dark:data-shown:bg-surface-dark-raised';
</script>

<p id="{id}-types" class="text-xs font-semibold">{KEY_COPY.types}</p>
<ul aria-labelledby="{id}-types" class="mt-1 space-y-1">
  {#each TYPE_KEY as row (row.typology)}
    <li class="flex items-center gap-2" data-key-type={row.typology}>
      <KeySwatch swatch={{ kind: 'solid', tokens: [row.token] }} />
      <span>{row.label}</span>
    </li>
  {/each}
</ul>
{#if heights.length > 0}
  <p
    id="{id}-painted"
    class="mt-2 border-t border-line pt-2 text-xs font-semibold dark:border-line-dark"
  >
    {KEY_COPY.painted}
  </p>
  <ul aria-labelledby="{id}-painted" class="mt-1 space-y-1">
    {#each heights as stories (stories)}
      <li>
        <button
          type="button"
          class={ROW}
          data-height={stories}
          data-shown={shown === stories ? 'true' : undefined}
          aria-pressed={pinned === stories}
          onpointerenter={() => (hovered = stories)}
          onpointerleave={() => {
            if (hovered === stories) hovered = null;
          }}
          onfocus={(e) => {
            // Keyboard focus only: a click focuses the button too, and its press already decides.
            if (e.currentTarget.matches(':focus-visible')) focused = stories;
          }}
          onblur={() => {
            if (focused === stories) focused = null;
          }}
          onclick={() => (pinned = pinned === stories ? null : stories)}
        >
          <!-- The dashed outline the map draws: shape, not colour alone, ties the row to it. -->
          <span class="flex w-7 shrink-0 justify-center" aria-hidden="true">
            <span
              class="inline-block h-4 w-4 rounded-sm border-2 border-dashed"
              data-swatch="outline"
              style:border-color={TOKENS[theme.current]['painted-outline']}
            ></span>
          </span>
          <span class="tabular-nums">{text(stories)}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}
