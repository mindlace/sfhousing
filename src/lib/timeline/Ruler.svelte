<!--
  The ruler (rule 3): the years from the dataset date's year to forty years on, which never move
  or zoom; the bar of filled forecast from the start to `filledEnd`, the hatched part not yet
  filled, and the jump markers (the "RHNA deadline" and "2045"). A marker reports its day through
  `onjump`; the parent clamps it and pauses.
-->
<script lang="ts">
  import { dayFromUtc, utcParts } from '$lib/fzp/time';
  import type { Marker } from '$lib/fzp/types';
  import type { Day } from '$lib/timelapse/time';

  interface Props {
    asOf: Day;
    windowEnd: Day;
    filledEnd: Day;
    markers: Marker[];
    onjump: (day: Day) => void;
  }

  let { asOf, windowEnd, filledEnd, markers, onjump }: Props = $props();

  const span = $derived(Math.max(windowEnd - asOf, 1));
  const pct = (d: Day) => Math.min(Math.max((d - asOf) / span, 0), 1) * 100;
  const startYear = $derived(utcParts(asOf).y);
  /** A label at the dataset date, then every fifth year and the last, where the year starts. */
  const years = $derived.by(() => {
    const out: { y: number; x: number }[] = [{ y: startYear, x: 0 }];
    for (let k = 1; k <= 40; k++) {
      if (k % 5 !== 0) continue;
      const d = dayFromUtc(startYear + k, 1, 1);
      if (d <= windowEnd) out.push({ y: startYear + k, x: pct(d) });
    }
    return out;
  });
  const filledPct = $derived(pct(Math.min(filledEnd, windowEnd)));
</script>

<div class="sfh-ruler relative" data-testid="tl-ruler">
  <div class="years relative">
    {#each years as t (t.y)}
      <span
        class="year absolute text-xs text-ink-muted tabular-nums dark:text-ink-dark-muted"
        class:first={t.x === 0}
        style:left="{t.x}%">{t.y}</span
      >
    {/each}
  </div>
  <div class="bar relative" aria-hidden="true">
    <i class="done" data-testid="tl-ruler-filled" style:width="{filledPct}%"></i>
    <i class="rest" data-testid="tl-ruler-unfilled" style:left="{filledPct}%"></i>
  </div>
  <div class="markers relative">
    {#each markers as m (m.name)}
      <button
        type="button"
        class="marker absolute top-0 rounded-md px-1.5 text-xs whitespace-nowrap"
        style:left="{pct(m.day)}%"
        aria-label={m.name}
        onclick={() => onjump(m.day)}
      >
        {m.label}
      </button>
    {/each}
  </div>
</div>

<style>
  .years {
    height: 18px;
  }
  .year {
    top: 1px;
    transform: translateX(-50%);
  }
  .year.first {
    transform: none;
  }
  .bar {
    height: 5px;
    border-radius: 3px;
    background: var(--color-surface-raised);
    overflow: hidden;
  }
  .done {
    position: absolute;
    inset-block: 0;
    left: 0;
    background: var(--color-ink-muted);
  }
  .rest {
    position: absolute;
    inset-block: 0;
    right: 0;
    background-image: repeating-linear-gradient(
      135deg,
      transparent 0 3px,
      var(--color-control-line) 3px 4px
    );
  }
  .markers {
    min-height: 32px;
  }
  .marker {
    min-height: 32px;
    transform: translateX(-50%);
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    text-decoration: underline;
  }
  .marker:hover {
    background: var(--color-surface-raised);
  }
  .marker:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  @media (prefers-color-scheme: dark) {
    .bar {
      background: var(--color-surface-dark-raised);
    }
    .done {
      background: var(--color-ink-dark-muted);
    }
    .rest {
      background-image: repeating-linear-gradient(
        135deg,
        transparent 0 3px,
        var(--color-control-line-dark) 3px 4px
      );
    }
    .marker:hover {
      background: var(--color-surface-dark-raised);
    }
    .marker:focus-visible {
      outline-color: var(--color-accent-dark);
    }
  }
  @media (pointer: coarse) {
    .markers,
    .marker {
      min-height: 44px;
    }
  }
</style>
