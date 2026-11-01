<!--
  "New zoning rules" (sim runs): the rules (BrushCard: summary, lot count, Edit, Remove) with "Add a
  rule" (Transit, Street, Commercial corridor, each disabled with its reason while the catalog
  lacks its data). Each lot takes the tallest rule that covers it, never below FZP. With
  `inlineForm` (md+) a rule's form opens here; otherwise SimPage shows it in place of the sheet's
  contents (layout ruling 9). After the last rule is removed focus moves to "Add a rule".
-->
<script lang="ts">
  import { tick } from 'svelte';
  import type { BrushCatalog } from '$lib/sim/levers/brushes';
  import BrushCard from './BrushCard.svelte';
  import { BrushForms } from './brush-forms.svelte';
  import { RULE_KINDS, kindUnavailable, ruleKindOf, type RuleKind } from './brush-summary';
  import ReadonlyFieldset from './ReadonlyFieldset.svelte';
  import RuleBrushForm from './RuleBrushForm.svelte';
  import type { ZoningRule } from './policy';
  import type { LeverSync, PolicyStore } from './policy-store.svelte';

  interface Props {
    store: PolicyStore;
    sync: Pick<LeverSync, 'result' | 'retry'>;
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
    catalog = undefined,
    forms = new BrushForms(),
    inlineForm = true,
    announce = undefined
  }: Props = $props();

  const uid = $props.id();
  let adding = $state(false);
  let rulesList = $state<HTMLUListElement>();
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

  /** After a card's Remove, focus the card now at its place, the one before it, or "Add a rule". */
  function afterRemove(i: number): void {
    void tick().then(() => {
      const cards = rulesList?.querySelectorAll('li') ?? [];
      const card = cards[Math.min(i, cards.length - 1)];
      const target = card?.querySelector<HTMLButtonElement>('button:not(:disabled)');
      (target ?? addBtn)?.focus();
    });
  }
</script>

<div class="flex flex-col gap-3 text-sm">
  <p class="text-gray-700">Each lot takes the tallest rule that covers it, never below FZP.</p>
  {#if store.policy.rules.length > 0}
    <ul bind:this={rulesList} aria-label="New zoning rules" class="flex flex-col gap-2">
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
          onremoved={afterRemove}
        />
      {/each}
    </ul>
  {/if}

  {#if inlineForm && forms.current && catalog}
    <ReadonlyFieldset>
      {#key forms.current}
        <RuleBrushForm
          kind={forms.current.kind}
          {catalog}
          initial={forms.current.initial}
          onsave={save}
          oncancel={() => forms.close()}
        />
      {/key}
    </ReadonlyFieldset>
  {:else}
    <div>
      <ReadonlyFieldset>
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
      </ReadonlyFieldset>
    </div>
  {/if}
</div>
