<!--
  "Custom zoning" (sim runs): the brush tools (Move, Paint, Erase), "Allow N stories" (the stories
  a Paint stroke allows; disabled with the /sim hint while Erase is chosen), the radius, the map
  key, then the custom brushes in order (BrushCard: Move up, Move down, Remove; later strokes win
  where they overlap). A `no-session` answer is parked by LeverSync until the next session, so it
  reads as "Finding lots…", not a failure. After the last brush is removed focus moves to the
  tool radio that is the group's tab stop.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import RadiusPopover from '$lib/brush/RadiusPopover.svelte';
  import StoriesPopover from '$lib/brush/StoriesPopover.svelte';
  import BrushCard from './BrushCard.svelte';
  import { ERASE_HINT, SIM_TOOLS, type SimBrushTools, type SimTool } from './brush-tools.svelte';
  import { LOT_COLORS, LOT_EDGE } from './lot-overlay';
  import type { LeverSync, PolicyStore } from './policy-store.svelte';

  interface Props {
    store: PolicyStore;
    sync: Pick<LeverSync, 'result' | 'retry'>;
    tools: SimBrushTools;
    /** Choose a tool (SimPage routes it through the controller, which cancels a stroke). */
    ontool(t: SimTool): void;
    /** Speaks a change's label (WCAG 4.1.3). */
    announce?: (msg: string) => void;
  }

  let { store, sync, tools, ontool, announce = undefined }: Props = $props();

  const uid = $props.id();
  const brush = $derived(tools.brush);
  const KEY = [{ role: 'changed', label: 'Your zoning changes' }] as const;
  const allowText = $derived(`Allow ${brush.stories} ${brush.stories === 1 ? 'story' : 'stories'}`);
  const rgb = ([r, g, b]: [number, number, number]) => `rgb(${r} ${g} ${b})`;
  const radios: Partial<Record<SimTool, HTMLButtonElement>> = $state({});
  let customList = $state<HTMLOListElement>();

  const enabled = (t: SimTool) => t === 'move' || brush.phase === 'ready';
  const tabStop = $derived<SimTool>(enabled(tools.tool) ? tools.tool : 'move');

  function select(t: SimTool) {
    if (!enabled(t) || tools.tool === t) return;
    ontool(t);
  }

  function onRadioKey(e: KeyboardEvent, from: SimTool) {
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (dir === 0) return;
    e.preventDefault();
    const ids = SIM_TOOLS.map((t) => t.id);
    let i = ids.indexOf(from);
    for (let n = 0; n < ids.length; n++) {
      i = (i + dir + ids.length) % ids.length;
      if (enabled(ids[i])) break;
    }
    select(ids[i]);
    radios[ids[i]]?.focus();
  }

  /** After a card's Remove, focus the card now at its place, the one before it, or the tool. */
  function afterRemove(i: number): void {
    void tick().then(() => {
      const cards = customList?.querySelectorAll('li') ?? [];
      const card = cards[Math.min(i, cards.length - 1)];
      const target = card?.querySelector<HTMLButtonElement>('button:not(:disabled)');
      (target ?? radios[tabStop])?.focus();
    });
  }
</script>

<div class="flex flex-col gap-3 text-sm">
  <div role="radiogroup" aria-label="Brush tool" class="flex flex-wrap gap-1">
    {#each SIM_TOOLS as t (t.id)}
      <button
        bind:this={radios[t.id]}
        type="button"
        role="radio"
        aria-checked={tools.tool === t.id}
        tabindex={t.id === tabStop ? 0 : -1}
        disabled={!enabled(t.id)}
        class="sim-tool min-h-11 min-w-11 rounded-md border border-gray-300 px-2 disabled:opacity-40"
        onclick={() => select(t.id)}
        onkeydown={(e) => onRadioKey(e, t.id)}>{t.label}</button
      >
    {/each}
  </div>

  <!-- Erase has no height: the stepper is disabled with the /sim hint. -->
  <div role="group" aria-labelledby="{uid}-allow" class="flex flex-col gap-1">
    <p id="{uid}-allow" class="font-semibold">{allowText}</p>
    <StoriesPopover state={brush} inline disabled={tools.tool === 'erase'} hint={ERASE_HINT} />
  </div>

  <RadiusPopover state={brush} inline />

  <div>
    <h4 id="{uid}-key" class="font-semibold">Map key</h4>
    <ul aria-labelledby="{uid}-key" class="mt-1 flex flex-wrap gap-x-3 gap-y-1">
      {#each KEY as k (k.role)}
        <li class="flex items-center gap-1.5">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
            <circle
              cx="8"
              cy="8"
              r="6.5"
              fill="none"
              stroke={rgb(LOT_EDGE.light.halo)}
              stroke-width="3"
            />
            <circle
              cx="8"
              cy="8"
              r="5"
              fill={rgb(LOT_COLORS.light[k.role])}
              stroke={rgb(LOT_EDGE.light.outline)}
              stroke-width="1.5"
            />
          </svg>
          {k.label}
        </li>
      {/each}
    </ul>
  </div>

  {#if store.policy.custom.length > 0}
    <div>
      <p class="text-gray-700">Later strokes win where they overlap.</p>
      <ol bind:this={customList} aria-label="Custom zoning" class="mt-1 flex flex-col gap-2">
        {#each store.policy.custom as b, i (b.id)}
          <BrushCard
            {store}
            {sync}
            list="custom"
            id={b.id}
            index={i}
            {announce}
            onremoved={afterRemove}
          />
        {/each}
      </ol>
    </div>
  {/if}
</div>

<style>
  .sim-tool[aria-checked='true'] {
    background: rgb(0 0 0 / 0.08);
    box-shadow: inset 0 -3px 0 currentColor;
    font-weight: 600;
  }
</style>
