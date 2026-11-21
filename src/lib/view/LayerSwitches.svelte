<script lang="ts" module>
  /** A layer row: a checkbox (and its legend or caption) for one ViewPrefs field. */
  export type ViewRow = 'transitStops' | 'transitAccess' | 'heightLimits';

  /** The Zoning height limits row's caption. */
  export const LIMITS_CAPTION =
    'Glass lids at the height zoning allows. Zoomed out, contour lines.';
</script>

<script lang="ts">
  // The map's layer switches (transit spec §6.3; height-lids plan Task 12; map-on-screen Task 6):
  // one checkbox and its legend or caption per layer, in `rows` order. The rows only: they sit in
  // MapKeyControl's Layers panel, the group named "Map layers". / and /p/:id show the two transit
  // rows (the default); /sim adds the zoning height limits, and shows only that row when the
  // dataset has no transit.
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

  const t = $derived(TOKENS[theme]);

  const STOP_LEGEND = [
    ['transit-regional', 'BART / Caltrain'],
    ['transit-rail', 'Muni Metro / streetcar'],
    ['transit-bus', 'Bus / cable car']
  ] as const;

  /** Each switch's target: its whole label, at least 24 px either way on every pointer. */
  const SWITCH = 'flex min-h-6 min-w-6 items-center gap-2 font-medium';
</script>

{#each rows as row, n (row)}
  <div class={n > 0 ? 'mt-3' : undefined}>
    {#if row === 'transitStops'}
      <label class={SWITCH}>
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
              class="inline-block size-3 shrink-0 rounded-full"
              style="background: {t[token]}"
            ></span>
            {label}
          </li>
        {/each}
      </ul>
    {:else if row === 'transitAccess'}
      <label class={SWITCH}>
        <input
          type="checkbox"
          checked={view.transitAccess}
          onchange={(e) => onchange({ ...view, transitAccess: e.currentTarget.checked })}
        />
        Transit capacity within a 10-minute walk
      </label>
      <ul class="mt-1 flex flex-wrap gap-x-3 gap-y-1 pl-6" aria-label="Transit capacity legend">
        {#each ACCESS_LEGEND as label, i (label)}
          <li class="flex items-center gap-1">
            <span
              aria-hidden="true"
              class="inline-block size-3 shrink-0"
              style="background: {accessSwatch(theme, (i + 1) as 1 | 2 | 3 | 4 | 5)}"
            ></span>
            {label}
          </li>
        {/each}
      </ul>
      <p class="mt-2 pl-6 text-xs text-gray-700 dark:text-gray-300">{ACCESS_CAPTION}</p>
    {:else}
      <label class={SWITCH}>
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
