<!--
  The hover tooltip over a timeline project (spec §4.8): non-interactive, same markup as
  SimMap's tooltip (`role="tooltip"`, `sim-map-panel`). It renders a `SummaryState`; FzpMode owns
  the request. `x`/`y` are the pointer position inside the map region, in CSS pixels.
-->
<script lang="ts">
  import { formatCount } from '$lib/scoreboard/format';
  import { tooltipPosition } from '$lib/map/pick';
  import type { Day } from '$lib/timelapse/time';
  import { cardStatus, type ChanceTable } from './card';
  import { inStageLabel } from './labels';
  import { SUMMARY_COPY, type SummaryState } from './summary-request';

  interface Props {
    state: SummaryState;
    day: Day;
    x: number;
    y: number;
  }
  let { state: summary, day, x, y }: Props = $props();

  /** The tooltip never reads a chance; `cardStatus` only indexes the pathway. */
  const NO_CHANCE = { discretionary: {}, streamlined: {}, permitOnly: {} } as ChanceTable;

  const lines = $derived.by((): [string, string] | null => {
    if (summary.kind === 'idle') return null;
    if (summary.kind !== 'project') return [SUMMARY_COPY[summary.kind], ''];
    const card = summary.card;
    const status = cardStatus(card, day, NO_CHANCE);
    if (status === null) return [SUMMARY_COPY.none, ''];
    const stage =
      status.kind === 'exited'
        ? `Stopped: ${inStageLabel(status.stage)}`
        : inStageLabel(status.stage);
    const origin = card.origin === 'pipeline' ? 'Real' : 'Simulated';
    const homes = status.units === 1 ? 'home' : 'homes';
    return [card.label, `${origin} project · ${stage} · ${formatCount(status.units)} ${homes}`];
  });

  let tip = $state<HTMLElement | null>(null);
  let tw = $state(0);
  let th = $state(0);
  let vw = $state(0);
  let vh = $state(0);
  // The map region is the tooltip's containing block; measure it so the tooltip flips at its edge.
  $effect(() => {
    const parent = tip?.offsetParent;
    vw = parent?.clientWidth ?? 0;
    vh = parent?.clientHeight ?? 0;
  });
  const pos = $derived(tooltipPosition(x, y, tw, th, vw || Infinity, vh || Infinity));
</script>

{#if lines}
  <div
    role="tooltip"
    bind:this={tip}
    bind:offsetWidth={tw}
    bind:offsetHeight={th}
    class="sim-map-panel pointer-events-none absolute z-20 max-w-xs rounded-md px-3 py-2 text-xs"
    style="left: {pos.left}px; top: {pos.top}px"
  >
    <p class="font-semibold">{lines[0]}</p>
    {#if lines[1]}<p>{lines[1]}</p>{/if}
  </div>
{/if}

<style>
  /* SimMap's panel look. The --map-* tokens live on .sim-map, which this is not inside. */
  .sim-map-panel {
    background: var(--map-land, #fff);
    color: var(--map-label, #111);
    border: 1px solid var(--map-existing, #6b7280);
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.2);
  }
</style>
