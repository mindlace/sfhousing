<!--
  "Your zoning", tools part (layout rulings 7 and 8). Undo and Redo first, named by the change they
  would undo or redo and disabled when there is none: the non-drag way back. Then the brush tools
  (Move, Paint, Erase, Protect, Unprotect), the freehand effect (mode, stories, density limits;
  hidden while Protect or Unprotect is chosen), the radius, the map key, and the brushes in order
  (BrushCard: summary, lot count, Edit, Move up, Move down, Remove). A `no-session` answer is
  parked by LeverSync until the next session, so it reads as "Finding lots…", not a failure.
  "Add a brush" offers the rule brushes (Transit, Street, Commercial corridor, Area), each
  disabled with its reason while the catalog lacks its data. With `inlineForm` (md+) the form
  opens here; otherwise SimPage shows it in place of the sheet's contents (layout ruling 9).
-->
<script lang="ts">
  import { tick } from 'svelte';
  import RadiusPopover from '$lib/brush/RadiusPopover.svelte';
  import StoriesPopover from '$lib/brush/StoriesPopover.svelte';
  import type { BrushCatalog } from '$lib/sim/levers/brushes';
  import BrushCard from './BrushCard.svelte';
  import { BrushForms } from './brush-forms.svelte';
  import { RULE_KINDS, kindUnavailable, ruleKindOf, type RuleKind } from './brush-summary';
  import RuleBrushForm from './RuleBrushForm.svelte';
  import {
    ERASE_HINT,
    SIM_TOOLS,
    isProtectTool,
    type SimBrushTools,
    type SimTool
  } from './brush-tools.svelte';
  import { LOT_COLORS, LOT_EDGE } from './lot-overlay';
  import type { BrushMode, ZoningBrush } from './policy';
  import type { LeverSync, PolicyStore } from './policy-store.svelte';

  interface Props {
    store: PolicyStore;
    sync: Pick<LeverSync, 'result' | 'retry'>;
    tools: SimBrushTools;
    /** Choose a tool (SimPage routes it through the controller, which cancels a stroke). */
    ontool(t: SimTool): void;
    onundo(): void;
    onredo(): void;
    /** The brush pickers' data: undefined while loading, null when unavailable. */
    catalog?: BrushCatalog | null;
    /** The open rule brush form, shared with SimPage. */
    forms?: BrushForms;
    /** Show the open form here (md+); below md SimPage shows it in place of the sections. */
    inlineForm?: boolean;
    /** Speaks a change's label (WCAG 4.1.3). */
    announce?: (msg: string) => void;
  }

  let {
    store,
    sync,
    tools,
    ontool,
    onundo,
    onredo,
    catalog = undefined,
    forms = new BrushForms(),
    inlineForm = true,
    announce = undefined
  }: Props = $props();

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

  let adding = $state(false);
  let list = $state<HTMLOListElement>();
  let addBtn = $state<HTMLButtonElement>();
  const ADD_SELECTOR = '[data-brush-add]';

  function openKind(kind: RuleKind): void {
    adding = false;
    forms.open({ kind }, ADD_SELECTOR);
  }

  function edit(b: ZoningBrush): void {
    const kind = ruleKindOf(b);
    if (kind) forms.open({ kind, initial: b }, `[data-brush-edit="${b.id}"]`);
  }

  function save(b: ZoningBrush): void {
    announce?.(forms.save(store, b));
    forms.close();
  }

  /** After a card's Remove, focus the card now at its place, the one before it, or "Add a brush". */
  function afterRemove(i: number): void {
    void tick().then(() => {
      const cards = list?.querySelectorAll('li') ?? [];
      const card = cards[Math.min(i, cards.length - 1)];
      const target = card?.querySelector<HTMLButtonElement>('button:not(:disabled)');
      (target ?? addBtn)?.focus();
    });
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
    <div>
      <h4 id="{uid}-brushes" class="font-semibold">Your brushes</h4>
      <p class="text-gray-700">Later brushes win where they overlap.</p>
      <ol bind:this={list} aria-labelledby="{uid}-brushes" class="mt-1 flex flex-col gap-2">
        {#each store.policy.brushes as b, i (b.id)}
          <BrushCard
            {store}
            {sync}
            brush={b}
            index={i}
            onedit={edit}
            editUnavailable={kindUnavailable(ruleKindOf(b) ?? 'area', catalog)}
            {announce}
            onremoved={afterRemove}
          />
        {/each}
      </ol>
    </div>
  {/if}

  {#if inlineForm && forms.current && catalog}
    {#key forms.current}
      <RuleBrushForm
        kind={forms.current.kind}
        {catalog}
        initial={forms.current.initial}
        onsave={save}
        oncancel={() => forms.close()}
      />
    {/key}
  {:else}
    <div>
      <button
        bind:this={addBtn}
        type="button"
        data-brush-add
        aria-expanded={adding}
        aria-controls="{uid}-kinds"
        class="min-h-11 rounded-md border border-gray-300 px-3 font-medium"
        onclick={() => (adding = !adding)}>Add a brush</button
      >
      {#if adding}
        <ul id="{uid}-kinds" class="mt-2 flex flex-col gap-2">
          {#each RULE_KINDS as kd (kd.id)}
            {@const why = kindUnavailable(kd.id, catalog)}
            <li class="flex flex-col">
              <button
                type="button"
                disabled={why !== null}
                aria-describedby={why ? `${uid}-why-${kd.id}` : undefined}
                class="min-h-11 self-start rounded-md border border-gray-300 px-3 font-medium disabled:opacity-40"
                onclick={() => openKind(kd.id)}>{kd.label}</button
              >
              {#if why}
                <span id="{uid}-why-{kd.id}" class="text-gray-700">{why}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
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
