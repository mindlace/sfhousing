<script lang="ts">
  // Header View menu (transit spec §6.3): a disclosure with one checkbox + legend per layer. A
  // list, so later layers add rows.
  import { TOKENS } from '$lib/map/palette';
  import { ACCESS_CAPTION, ACCESS_LEGEND } from '$lib/transit/legend';
  import type { ViewPrefs } from './prefs';

  interface Props {
    view: ViewPrefs;
    onchange(v: ViewPrefs): void;
  }
  let { view, onchange }: Props = $props();

  const id = $props.id();
  let open = $state(false);
  let button = $state<HTMLButtonElement>();
  let panel = $state<HTMLDivElement>();
  let dark = $state(false);
  const t = $derived(TOKENS[dark ? 'dark' : 'light']);

  $effect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    dark = mq.matches;
    const on = (e: MediaQueryListEvent) => (dark = e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });

  const STOP_LEGEND = [
    ['transit-regional', 'BART / Caltrain'],
    ['transit-rail', 'Muni Metro / streetcar'],
    ['transit-bus', 'Bus / cable car']
  ] as const;
  const ACCESS_TOKENS = [
    'transit-access-1',
    'transit-access-2',
    'transit-access-3',
    'transit-access-4',
    'transit-access-5'
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
    class="min-h-6 min-w-6 rounded-md border border-gray-300 px-2 text-sm font-medium whitespace-nowrap pointer-coarse:min-h-11 pointer-coarse:min-w-11"
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
      <label class="flex min-h-6 items-center gap-2 font-medium">
        <input
          type="checkbox"
          checked={view.transitStops}
          onchange={(e) => onchange({ ...view, transitStops: e.currentTarget.checked })}
        />
        Transit stops
      </label>
      <ul class="mt-1 mb-3 space-y-1 pl-6" aria-label="Transit stops legend">
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
      <label class="flex min-h-6 items-center gap-2 font-medium">
        <input
          type="checkbox"
          checked={view.transitAccess}
          onchange={(e) => onchange({ ...view, transitAccess: e.currentTarget.checked })}
        />
        Transit capacity within a 10-minute walk
      </label>
      <ul class="mt-1 flex flex-wrap gap-x-3 gap-y-1 pl-6" aria-label="Transit capacity legend">
        {#each ACCESS_LEGEND as label, k (label)}
          <li class="flex items-center gap-1">
            <span
              aria-hidden="true"
              class="inline-block size-3"
              style="background: {t[ACCESS_TOKENS[k]]}"
            ></span>
            {label}
          </li>
        {/each}
      </ul>
      <p class="mt-2 pl-6 text-xs text-gray-700 dark:text-gray-300">{ACCESS_CAPTION}</p>
    </div>
  {/if}
</div>
