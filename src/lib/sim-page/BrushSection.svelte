<!--
  "Your zoning", tools part (layout rulings 7 and 8). Undo and Redo first, named by the change they
  would undo or redo and disabled when there is none: the non-drag way back. Then the brush tools
  (Move, Paint, Erase, Protect, Unprotect), the freehand effect (mode, stories, density limits;
  hidden while Protect or Unprotect is chosen), the radius, and each brush with its lot count,
  "Finding lots…", or "Couldn't find lots" with Retry. A `no-session` answer is parked by
  LeverSync until the next session, so it reads as "Finding lots…", not a failure.
-->
<script lang="ts">
  import RadiusPopover from '$lib/brush/RadiusPopover.svelte';
  import StoriesPopover from '$lib/brush/StoriesPopover.svelte';
  import type { BrushLotsResult } from '$lib/sim/scenario/types';
  import {
    ERASE_HINT,
    SIM_TOOLS,
    isProtectTool,
    type SimBrushTools,
    type SimTool
  } from './brush-tools.svelte';
  import { LOT_COLORS, LOT_EDGE } from './lot-overlay';
  import { brushQueries, queryKey, type BrushMode, type ZoningBrush } from './policy';
  import type { LeverSync, PolicyStore } from './policy-store.svelte';

  interface Props {
    store: PolicyStore;
    sync: Pick<LeverSync, 'result' | 'retry'>;
    tools: SimBrushTools;
    /** Choose a tool (SimPage routes it through the controller, which cancels a stroke). */
    ontool(t: SimTool): void;
    onundo(): void;
    onredo(): void;
  }

  let { store, sync, tools, ontool, onundo, onredo }: Props = $props();

  const uid = $props.id();
  const brush = $derived(tools.brush);
  const MODES: { id: BrushMode; label: string }[] = [
    { id: 'raise', label: 'Raise' },
    { id: 'lower', label: 'Lower' },
    { id: 'set', label: 'Set to' }
  ];
  const KEY = [
    { role: 'raise', label: 'Raised' },
    { role: 'lower', label: 'Lowered' },
    { role: 'set', label: 'Set' },
    { role: 'protected', label: 'Protected (ring)' }
  ] as const;
  const rgb = ([r, g, b]: [number, number, number]) => `rgb(${r} ${g} ${b})`;
  const radios: Partial<Record<SimTool, HTMLButtonElement>> = $state({});

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

  const VERB: Record<BrushMode, string> = { raise: 'Raise', lower: 'Lower', set: 'Set' };
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

  function brushLabel(b: ZoningBrush): string {
    switch (b.kind) {
      case 'freehand':
        return `${VERB[b.effect.mode]} to ${n(b.effect.stories, 'story', 'stories')} · ${n(b.strokes.length, 'stroke', 'strokes')}`;
      case 'erase':
        return `Erase · ${n(b.strokes.length, 'stroke', 'strokes')}`;
      case 'transit':
        return `${VERB[b.mode]} near transit`;
      case 'street':
        return `${VERB[b.effect.mode]} along streets to ${n(b.effect.stories, 'story', 'stories')}`;
      case 'area':
        return `${VERB[b.effect.mode]} areas to ${n(b.effect.stories, 'story', 'stories')}`;
    }
  }

  type Status =
    { kind: 'found'; lots: number } | { kind: 'finding' } | { kind: 'failed'; keys: string[] };

  function status(b: ZoningBrush): Status {
    const keys = brushQueries(b).map(queryKey);
    const results = keys.map((k) => sync.result(k));
    const failed = keys.filter((_, i) => {
      const r = results[i];
      return r !== undefined && !r.ok && r.reason !== 'no-session';
    });
    if (failed.length > 0) return { kind: 'failed', keys: failed };
    if (results.every((r): r is Extract<BrushLotsResult, { ok: true }> => r?.ok === true)) {
      return { kind: 'found', lots: new Set(results.flatMap((r) => r.lots)).size };
    }
    return { kind: 'finding' };
  }
</script>

<div class="flex flex-col gap-3 text-sm">
  <div class="flex gap-2">
    <button
      type="button"
      aria-label={store.undoLabel ? `Undo: ${store.undoLabel}` : 'Undo'}
      title={store.undoLabel ? `Undo: ${store.undoLabel}` : undefined}
      disabled={!store.canUndo}
      class="min-h-11 min-w-11 rounded-md border border-gray-300 px-3 font-medium disabled:opacity-40"
      onclick={() => onundo()}>Undo</button
    >
    <button
      type="button"
      aria-label={store.redoLabel ? `Redo: ${store.redoLabel}` : 'Redo'}
      title={store.redoLabel ? `Redo: ${store.redoLabel}` : undefined}
      disabled={!store.canRedo}
      class="min-h-11 min-w-11 rounded-md border border-gray-300 px-3 font-medium disabled:opacity-40"
      onclick={() => onredo()}>Redo</button
    >
  </div>

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

  <!-- Protect and Unprotect hide the effect (ruling 8); Erase has no mode or density, and its
       stories stepper is disabled with the /sim hint. -->
  {#if !isProtectTool(tools.tool) && tools.tool !== 'erase'}
    <div role="radiogroup" aria-label="Mode" class="flex flex-wrap gap-x-3 gap-y-1">
      {#each MODES as m (m.id)}
        <label class="flex min-h-6 items-center gap-1.5">
          <input
            type="radio"
            name="{uid}-mode"
            class="size-6"
            checked={tools.mode === m.id}
            onchange={() => tools.setMode(m.id)}
          />
          {m.label}
        </label>
      {/each}
    </div>
  {/if}
  {#if !isProtectTool(tools.tool)}
    <StoriesPopover state={brush} inline disabled={tools.tool === 'erase'} hint={ERASE_HINT} />
  {/if}
  {#if !isProtectTool(tools.tool) && tools.tool !== 'erase'}
    <label class="flex min-h-6 items-center gap-1.5">
      <input
        type="checkbox"
        class="size-6"
        checked={tools.densityLimits}
        onchange={(e) => (tools.densityLimits = e.currentTarget.checked)}
      />
      Density limits
    </label>
  {/if}

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
            {#if k.role === 'protected'}
              <circle
                cx="8"
                cy="8"
                r="5"
                fill="none"
                stroke={rgb(LOT_EDGE.light.outline)}
                stroke-width="2.5"
              />
            {:else}
              <circle
                cx="8"
                cy="8"
                r="5"
                fill={rgb(LOT_COLORS.light[k.role])}
                stroke={rgb(LOT_EDGE.light.outline)}
                stroke-width="1.5"
              />
            {/if}
          </svg>
          {k.label}
        </li>
      {/each}
    </ul>
  </div>

  {#if store.policy.brushes.length > 0}
    <ul aria-label="Your brushes" class="flex flex-col gap-2">
      {#each store.policy.brushes as b (b.id)}
        {@const s = status(b)}
        {@const labelId = `${uid}-brush-${b.id}`}
        <li class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span id={labelId} class="font-medium">{brushLabel(b)}</span>
          <!-- One polite region per brush, kept across states, so a count arriving is spoken
               (WCAG 4.1.3). -->
          <span role="status"
            >{s.kind === 'found'
              ? n(s.lots, 'lot', 'lots')
              : s.kind === 'finding'
                ? 'Finding lots…'
                : "Couldn't find lots"}</span
          >
          {#if s.kind === 'failed'}
            <button
              type="button"
              aria-describedby={labelId}
              class="min-h-6 min-w-6 rounded-md px-1 font-semibold underline pointer-coarse:min-h-11 pointer-coarse:min-w-11"
              onclick={() => s.keys.forEach((k) => sync.retry(k))}>Retry</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .sim-tool[aria-checked='true'] {
    background: rgb(0 0 0 / 0.08);
    box-shadow: inset 0 -3px 0 currentColor;
    font-weight: 600;
  }
</style>
