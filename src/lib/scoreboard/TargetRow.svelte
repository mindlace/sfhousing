<script lang="ts">
  import { formatPercent } from './format';
  import type { TargetProgress } from './types';
  import { fillPercent, meterValueText, remainderText, tickPercent } from './view';

  interface Props {
    tp: TargetProgress;
    net: number;
    /** Shared track full-scale (trackMax). */
    max: number;
    primary: boolean;
  }
  let { tp, net, max, primary }: Props = $props();
  // The light and dark surface tokens: the row sits on the dock's Results face on every page.
  const TRACK = 'bg-gray-200 dark:bg-line-dark';
  const FILL = 'bg-accent dark:bg-accent-dark';
  const TICK = 'bg-ink dark:bg-ink-dark';
  const MUTED = 'text-ink-muted dark:text-ink-dark-muted';
  const BODY = 'text-ink dark:text-ink-dark';
  const tick = $derived(tickPercent(max));
</script>

<div class="mt-3" data-testid="target-{tp.target.id}" data-primary={String(primary)}>
  <div class="flex items-baseline justify-between gap-2">
    <span class={primary ? 'text-sm font-semibold' : 'text-sm'}>{tp.target.label}</span>
    <span class={primary ? 'text-lg font-bold tabular-nums' : 'text-sm tabular-nums'}
      >{formatPercent(tp.fraction)}</span
    >
  </div>
  <div
    role="meter"
    aria-label={tp.target.label}
    aria-valuemin={0}
    aria-valuemax={max * tp.target.units}
    aria-valuenow={net}
    aria-valuetext={meterValueText(tp)}
    class="relative mt-1 overflow-visible rounded-sm {TRACK} {primary ? 'h-4' : 'h-2.5'}"
  >
    <div
      data-testid="bar-fill"
      class="absolute inset-y-0 left-0 rounded-sm {FILL}"
      style:width="{fillPercent(tp.fraction, max)}%"
    ></div>
    <div
      data-testid="bar-tick"
      class="absolute -inset-y-1 w-0.5 -translate-x-1/2 {TICK}"
      style:left="{tick}%"
    ></div>
  </div>
  <div class="relative h-4 text-xs {MUTED}" aria-hidden="true">
    <span
      class="absolute whitespace-nowrap {tick >= 99 ? '-translate-x-full' : '-translate-x-1/2'}"
      style:left="{tick}%">target</span
    >
  </div>
  <p class="text-sm {BODY}">{remainderText(net, tp.target.units)}</p>
</div>
