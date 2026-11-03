<!--
  The Transit tab: "Transit layers", one TransitLayerRow per zoning rule (in policy order; layers
  combine by taking the tallest, so order means nothing), then the locked FZP baseline row (a
  select button with a lock glyph: no lot count, no editor), then "+ Transit layer" (aria-disabled
  with its reason while the catalog is loading or lacks transit data). The selected row expands
  in place into its editor; every edit is one labelled store change, a stepper or distance run
  coalesced into one undo step. "+ Transit layer" adds a layer selected and expanded, focusing its
  first chip; Remove layer clears the selection and focus moves to the layer now at its place, or
  to "+ Transit layer".
-->
<script module lang="ts">
  /** Coalesce runs, numbered across mounts, so a remounted tab never resumes an old run. */
  let runs = 0;
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import type { BrushCatalog } from '$lib/sim/levers/brushes';
  import { ruleChangeLabel, ruleLotStatus, transitUnavailable } from './brush-summary';
  import type { ZoningRule } from './policy';
  import type { LeverSync, PolicyStore } from './policy-store.svelte';
  import type { DockSelection } from './selection';
  import { newLayer, replaceRule } from './transit-edit';
  import TransitLayerRow from './TransitLayerRow.svelte';

  interface Props {
    store: PolicyStore;
    sync: Pick<LeverSync, 'result' | 'retry'>;
    /** The chips' data: undefined while loading, null when unavailable. */
    catalog: BrushCatalog | null | undefined;
    selection: DockSelection;
    onselect(sel: DockSelection): void;
    /** Speaks an added or removed layer's label (WCAG 4.1.3). */
    announce?: (msg: string) => void;
  }

  let { store, sync, catalog, selection, onselect, announce = undefined }: Props = $props();

  const uid = $props.id();
  let list = $state<HTMLOListElement>();
  let addBtn = $state<HTMLButtonElement>();

  const why = $derived(transitUnavailable(catalog));
  const result = (k: string) => sync.result(k);
  const fzpSelected = $derived(selection?.kind === 'fzp');

  function add(): void {
    if (why !== null) return;
    const r = newLayer();
    const label = ruleChangeLabel(r);
    store.apply((p) => ({ ...p, rules: [...p.rules, r] }), label);
    announce?.(label);
    onselect({ kind: 'rule', id: r.id });
    void tick().then(() =>
      list
        ?.querySelector<HTMLElement>(
          `[data-layer-row="${r.id}"] [role="group"][aria-label="Stop types"] button`
        )
        ?.focus()
    );
  }

  /**
   * The current coalesce run: renewed on mount and on every selection change (deselecting the
   * row, selecting another), so a later press on the same band is a new undo step. A different
   * key is PolicyStore's run boundary.
   */
  let run = ++runs;
  const selKey = $derived(
    selection === null ? '' : selection.kind === 'fzp' ? 'fzp' : `${selection.kind}:${selection.id}`
  );
  $effect.pre(() => {
    void selKey;
    run = ++runs;
  });

  function edit(next: ZoningRule, coalesce?: string): void {
    const key = coalesce === undefined ? undefined : `${coalesce}@${run}`;
    store.apply((p) => replaceRule(p, next), `Edited: ${ruleChangeLabel(next)}`, key);
  }

  function remove(r: ZoningRule, index: number): void {
    const label = `Removed: ${ruleChangeLabel(r)}`;
    store.apply((p) => ({ ...p, rules: p.rules.filter((x) => x.id !== r.id) }), label);
    onselect(null);
    announce?.(label);
    // The row is gone: focus the layer now at its place, else "+ Transit layer" (WCAG 2.4.3).
    void tick().then(() => {
      const rows = list?.querySelectorAll<HTMLElement>(
        '[data-layer-row]:not([data-layer-row="fzp"]) > button'
      );
      (rows?.[index] ?? addBtn)?.focus();
    });
  }
</script>

<div class="flex flex-col gap-3 text-sm text-ink dark:text-ink-dark">
  <ol bind:this={list} aria-label="Transit layers" class="flex flex-col gap-2">
    {#each store.policy.rules as r, i (r.id)}
      {@const selected = selection?.kind === 'rule' && selection.id === r.id}
      <TransitLayerRow
        rule={r}
        status={ruleLotStatus(r, result)}
        {catalog}
        {selected}
        onselect={() => onselect(selected ? null : { kind: 'rule', id: r.id })}
        onedit={edit}
        onremove={() => remove(r, i)}
        onretry={(keys) => keys.forEach((k) => sync.retry(k))}
      />
    {/each}
    <li
      data-layer-row="fzp"
      class="flex flex-col rounded-md border p-1 {fzpSelected
        ? 'border-accent bg-surface-raised dark:border-accent-dark dark:bg-surface-dark-raised'
        : 'border-line bg-surface dark:border-line-dark dark:bg-surface-dark'}"
    >
      <button
        type="button"
        aria-pressed={fzpSelected}
        class="flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-left font-semibold hover:bg-surface-raised dark:hover:bg-surface-dark-raised"
        onclick={() => onselect(fzpSelected ? null : { kind: 'fzp' })}
      >
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-md bg-ink text-surface dark:bg-ink-dark dark:text-surface-dark"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </span>
        FZP baseline
      </button>
    </li>
  </ol>

  <div class="flex flex-col items-start">
    <!-- aria-disabled, not disabled: it stays in the tab order, so focus can land here while
         the catalog loads (WCAG 2.4.3); the reason is its description. -->
    <button
      bind:this={addBtn}
      type="button"
      data-brush-add
      aria-disabled={why !== null ? 'true' : undefined}
      aria-describedby={why ? `${uid}-why` : undefined}
      class="min-h-11 rounded-md border border-control-line bg-surface px-3 font-medium text-ink hover:bg-surface-raised aria-disabled:opacity-40 dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark dark:hover:bg-surface-dark-raised"
      onclick={add}
      ><span class="sr-only">Add</span> <span aria-hidden="true">+</span> Transit layer</button
    >
    {#if why}
      <span id="{uid}-why" class="mt-1 block text-ink-muted dark:text-ink-dark-muted">{why}</span>
    {/if}
  </div>
</div>
