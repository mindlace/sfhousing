<script lang="ts" module>
  /** A View menu row: a checkbox (and its legend or caption) for one ViewPrefs field. */
  export type ViewRow = 'transitStops' | 'transitAccess' | 'heightLimits';
</script>

<script lang="ts">
  // Header View menu (transit spec §6.3): a disclosure with one checkbox + legend per layer, in
  // `rows` order. / and /p/:id show the two transit rows (the default); /sim adds the zoning height
  // limits (height-lids plan Task 12), and shows only that row when the dataset has no transit.
  import { TOKENS, accessSwatch } from '$lib/map/palette';
  import type { Theme } from '$lib/map/types';
  import { ACCESS_CAPTION, ACCESS_LEGEND } from '$lib/transit/legend';
  import type { ViewPrefs } from './prefs';

  interface Props {
    view: ViewPrefs;
    theme: Theme;
    onchange(v: ViewPrefs): void;
    /** The rows shown, in order (default: the two transit rows). */
    rows?: readonly ViewRow[];
  }
  let { view, theme, onchange, rows = ['transitStops', 'transitAccess'] }: Props = $props();

  const id = $props.id();
  let open = $state(false);
  let button = $state<HTMLButtonElement>();
  let panel = $state<HTMLDivElement>();
  const t = $derived(TOKENS[theme]);

  const LIMITS_CAPTION =
    "Glass lids at the height zoning allows, with each area's room to grow in floors. Zoomed out, contour lines.";

  const STOP_LEGEND = [
    ['transit-regional', 'BART / Caltrain'],
    ['transit-rail', 'Muni Metro / streetcar'],
    ['transit-bus', 'Bus / cable car']
  ] as const;
  function close(refocus: boolean): void {
    open = false;
    if (refocus) button?.focus();
  }

  function onkeydown(e: KeyboardEvent): void {
    if (open && e.key === 'Escape') {
      e.preventDefault();
      close(true);
    }
  }

  function onpointerdown(e: PointerEvent): void {
    const target = e.target as Node | null;
    if (open && target && !panel?.contains(target) && !button?.contains(target)) close(false);
  }
</script>

<svelte:window {onkeydown} {onpointerdown} />

<div class="sm:relative">
  <button
    bind:this={button}
    type="button"
    aria-expanded={open}
    aria-controls="{id}-panel"
    class="min-h-6 min-w-6 rounded-md border border-gray-300 px-2 text-sm font-medium whitespace-nowrap md:max-lg:px-1 dark:border-gray-600 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
    onclick={() => (open = !open)}>View</button
  >
  {#if open}
    <div
      bind:this={panel}
      id="{id}-panel"
      role="group"
      aria-label="Map layers"
      class="absolute top-full right-4 z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-gray-300 bg-white p-3 text-sm text-gray-900 shadow-lg sm:right-0 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
    >
      {#each rows as row, n (row)}
        <div class={n > 0 ? 'mt-3' : undefined}>
          {#if row === 'transitStops'}
            <label class="flex min-h-6 items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={view.transitStops}
                onchange={(e) => onchange({ ...view, transitStops: e.currentTarget.checked })}
              />
              Transit stops
            </label>
            <ul class="mt-1 space-y-1 pl-6" aria-label="Transit stops legend">
              {#each STOP_LEGEND as [token, label] (token)}
                <li class="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    class="inline-block size-3 rounded-full"
                    style="background: {t[token]}"
                  ></span>
                  {label}
                </li>
              {/each}
            </ul>
          {:else if row === 'transitAccess'}
            <label class="flex min-h-6 items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={view.transitAccess}
                onchange={(e) => onchange({ ...view, transitAccess: e.currentTarget.checked })}
              />
              Transit capacity within a 10-minute walk
            </label>
            <ul
              class="mt-1 flex flex-wrap gap-x-3 gap-y-1 pl-6"
              aria-label="Transit capacity legend"
            >
              {#each ACCESS_LEGEND as label, i (label)}
                <li class="flex items-center gap-1">
                  <span
                    aria-hidden="true"
                    class="inline-block size-3"
                    style="background: {accessSwatch(theme, (i + 1) as 1 | 2 | 3 | 4 | 5)}"
                  ></span>
                  {label}
                </li>
              {/each}
            </ul>
            <p class="mt-2 pl-6 text-xs text-gray-700 dark:text-gray-300">{ACCESS_CAPTION}</p>
          {:else}
            <label class="flex min-h-6 items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={view.heightLimits}
                onchange={(e) => onchange({ ...view, heightLimits: e.currentTarget.checked })}
              />
              Zoning height limits
            </label>
            <p class="mt-1 pl-6 text-xs text-gray-700 dark:text-gray-300">{LIMITS_CAPTION}</p>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
