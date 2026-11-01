<!--
  "Your zoning" (sim runs; Task 4 splits it into New zoning rules and Custom zoning). Undo and
  Redo first, named by the change they would undo or redo and disabled when there is none: the
  non-drag way back. Then the brush tools (Move, Paint, Erase), "Allow N stories" (the stories a
  Paint stroke allows; disabled with the /sim hint while Erase is chosen), the radius, the map
  key, the new zoning rules (BrushCard: summary, lot count, Edit, Remove) with "Add a rule"
  (Transit, Street, Commercial corridor, each disabled with its reason while the catalog lacks
  its data), then the custom brushes in order (BrushCard: Move up, Move down, Remove). A
  `no-session` answer is parked by LeverSync until the next session, so it reads as "Finding
  lots…", not a failure. With `inlineForm` (md+) a rule's form opens here; otherwise SimPage
  shows it in place of the sheet's contents (layout ruling 9).
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
  import { ERASE_HINT, SIM_TOOLS, type SimBrushTools, type SimTool } from './brush-tools.svelte';
  import { LOT_COLORS, LOT_EDGE } from './lot-overlay';
  import type { ZoningRule } from './policy';
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
  const KEY = [{ role: 'changed', label: 'Your zoning changes' }] as const;
  const allowText = $derived(`Allow ${brush.stories} ${brush.stories === 1 ? 'story' : 'stories'}`);
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
  let rulesList = $state<HTMLUListElement>();
  let customList = $state<HTMLOListElement>();
  let addBtn = $state<HTMLButtonElement>();
  const ADD_SELECTOR = '[data-brush-add]';

  function openKind(kind: RuleKind): void {
    adding = false;
    forms.open({ kind }, ADD_SELECTOR);
  }

  function edit(r: ZoningRule): void {
    forms.open({ kind: ruleKindOf(r), initial: r }, `[data-brush-edit="${r.id}"]`);
  }

  function save(r: ZoningRule): void {
    announce?.(forms.save(store, r));
    forms.close();
  }

  /**
   * After a card's Remove, focus the card now at its place in that list, the one before it, or
   * "Add a rule".
   */
  function afterRemove(el: HTMLElement | undefined, i: number): void {
    void tick().then(() => {
      const cards = el?.querySelectorAll('li') ?? [];
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

  <div>
    <h4 id="{uid}-rules" class="font-semibold">New zoning rules</h4>
    <p class="text-gray-700">Each lot takes the tallest rule that covers it, never below FZP.</p>
    {#if store.policy.rules.length > 0}
      <ul bind:this={rulesList} aria-labelledby="{uid}-rules" class="mt-1 flex flex-col gap-2">
        {#each store.policy.rules as r, i (r.id)}
          <BrushCard
            {store}
            {sync}
            list="rules"
            id={r.id}
            index={i}
            onedit={edit}
            editUnavailable={kindUnavailable(ruleKindOf(r), catalog)}
            {announce}
            onremoved={(at) => afterRemove(rulesList, at)}
          />
        {/each}
      </ul>
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
      <div class="mt-2">
        <button
          bind:this={addBtn}
          type="button"
          data-brush-add
          aria-expanded={adding}
          aria-controls="{uid}-kinds"
          class="min-h-11 rounded-md border border-gray-300 px-3 font-medium"
          onclick={() => (adding = !adding)}>Add a rule</button
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

  {#if store.policy.custom.length > 0}
    <div>
      <h4 id="{uid}-custom" class="font-semibold">Custom zoning</h4>
      <p class="text-gray-700">Later strokes win where they overlap.</p>
      <ol bind:this={customList} aria-labelledby="{uid}-custom" class="mt-1 flex flex-col gap-2">
        {#each store.policy.custom as b, i (b.id)}
          <BrushCard
            {store}
            {sync}
            list="custom"
            id={b.id}
            index={i}
            {announce}
            onremoved={(at) => afterRemove(customList, at)}
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
