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
    class="relative mt-1 overflow-visible rounded-sm bg-gray-200 {primary ? 'h-4' : 'h-2.5'}"
  >
    <div
      data-testid="bar-fill"
      class="absolute inset-y-0 left-0 rounded-sm {primary ? 'bg-blue-700' : 'bg-blue-600'}"
      style:width="{fillPercent(tp.fraction, max)}%"
    ></div>
    <div
      data-testid="bar-tick"
      class="absolute -inset-y-1 w-0.5 -translate-x-1/2 bg-black"
      style:left="{tick}%"
    ></div>
  </div>
  <div class="relative h-4 text-xs text-gray-700" aria-hidden="true">
    <span
      class="absolute whitespace-nowrap {tick >= 99 ? '-translate-x-full' : '-translate-x-1/2'}"
      style:left="{tick}%">target</span
    >
  </div>
  <p class="text-sm text-gray-800">{remainderText(net, tp.target.units)}</p>
</div>
