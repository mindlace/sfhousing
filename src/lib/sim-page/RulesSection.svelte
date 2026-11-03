<!--
  "New zoning rules" (sim runs): the rules (BrushCard: summary, lot count, Edit, Remove) with "Add
  transit layer" (aria-disabled with its reason while the catalog lacks transit data). A rule's
  form opens here, in place of "Add transit layer", at every width (the dock's Transit tab). After
  the last rule is removed focus moves to "Add transit layer".
-->
<script lang="ts">
  import { tick } from 'svelte';
  import type { BrushCatalog } from '$lib/sim/levers/brushes';
  import BrushCard from './BrushCard.svelte';
  import { BrushForms } from './brush-forms.svelte';
  import { transitUnavailable } from './brush-summary';
  import RuleBrushForm from './RuleBrushForm.svelte';
  import type { ZoningRule } from './policy';
  import type { LeverSync, PolicyStore } from './policy-store.svelte';

  interface Props {
    store: PolicyStore;
    sync: Pick<LeverSync, 'result' | 'retry'>;
    /** The brush pickers' data: undefined while loading, null when unavailable. */
    catalog?: BrushCatalog | null;
    /** The open rule brush form, shared with SimPage (it outlives a tab change). */
    forms?: BrushForms;
    /** Speaks a change's label (WCAG 4.1.3). */
    announce?: (msg: string) => void;
    /** A rule form saved `r`; `changed` is false for an edit that changed nothing. */
    onsaved?: (r: ZoningRule, changed: boolean) => void;
    /** The rule shown on the map ("Show on map" pressed), or null. */
    selectedRule?: string | null;
    /** A card's "Show on map" changed: the rule's id, or null when released. */
    onselectrule?: (id: string | null) => void;
  }

  let {
    store,
    sync,
    catalog = undefined,
    forms = new BrushForms(),
    announce = undefined,
    onsaved = undefined,
    selectedRule = null,
    onselectrule = undefined
  }: Props = $props();

  const uid = $props.id();
  let rulesList = $state<HTMLUListElement>();
  let addBtn = $state<HTMLButtonElement>();
  let root = $state<HTMLDivElement>();
  const ADD_SELECTOR = '[data-brush-add]';

  const why = $derived(transitUnavailable(catalog));

  function openTransit(): void {
    if (why === null) forms.open({}, ADD_SELECTOR);
  }

  function edit(r: ZoningRule): void {
    forms.open({ initial: r }, `[data-brush-edit="${r.id}"]`);
  }

  function save(r: ZoningRule): void {
    const before = store.policy;
    announce?.(forms.save(store, r));
    forms.close();
    onsaved?.(r, store.policy !== before);
  }

  const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled)';

  /**
   * After a card's Remove, focus the card now at its place, the one before it, or "Add transit layer".
   * A form open on the removed rule closes (saving it would re-add the rule); a new rule's form
   * stays, and with no card left focus goes to its first control (WCAG 2.4.3).
   */
  function afterRemove(i: number): void {
    const open = forms.current?.initial;
    if (open && !store.policy.rules.some((r) => r.id === open.id)) forms.dismiss();
    void tick().then(() => {
      const cards = rulesList?.querySelectorAll('li') ?? [];
      const card = cards[Math.min(i, cards.length - 1)];
      const target = card?.querySelector<HTMLElement>('button:not(:disabled)');
      (target ?? addBtn ?? root?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    });
  }
</script>

<div bind:this={root} class="flex flex-col gap-3 text-sm">
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
          editUnavailable={transitUnavailable(catalog)}
          {announce}
          onremoved={afterRemove}
          selected={selectedRule === r.id}
          onselect={(on) => onselectrule?.(on ? r.id : null)}
        />
      {/each}
    </ul>
  {/if}

  {#if forms.current && catalog}
    {#key forms.current}
      <RuleBrushForm
        {catalog}
        initial={forms.current.initial}
        draft={forms.current.draft}
        onsave={save}
        oncancel={() => forms.close()}
      />
    {/key}
  {:else}
    <div class="flex flex-col items-start">
      <!-- aria-disabled, not disabled: it stays in the tab order, so focus can land here while
           the catalog loads (WCAG 2.4.3); the reason is its description. -->
      <button
        bind:this={addBtn}
        type="button"
        data-brush-add
        aria-disabled={why !== null ? 'true' : undefined}
        aria-describedby={why ? `${uid}-why` : undefined}
        class="min-h-11 rounded-md border border-control-line px-3 font-medium text-ink hover:bg-surface-raised aria-disabled:opacity-40 dark:border-control-line-dark dark:text-ink-dark dark:hover:bg-surface-dark-raised"
        onclick={openTransit}
        ><span class="sr-only">Add</span> <span aria-hidden="true">+</span> Transit layer</button
      >
      {#if why}
        <span id="{uid}-why" class="mt-1 block text-ink-muted dark:text-ink-dark-muted">{why}</span>
      {/if}
    </div>
  {/if}
</div>
