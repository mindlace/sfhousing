<!--
  One card in "New zoning rules": a zoning rule with Show on map, Edit and Remove (rules are
  additive, so their order does not matter). A one-line summary with the lot count in a polite live
  region (WCAG 4.1.3), then the buttons, each named with the summary. Every change is a labelled
  store change, so Undo names and undoes it. Painted areas are rows of the Paint tab (PaintTab).
-->
<script lang="ts">
  import { lotsText, ruleChangeLabel, ruleHead, ruleLotStatus, ruleSummary } from './brush-summary';
  import type { ZoningRule } from './policy';
  import type { LeverSync, PolicyStore } from './policy-store.svelte';

  interface Props {
    store: PolicyStore;
    sync: Pick<LeverSync, 'result' | 'retry'>;
    /** The rule's id in `store.policy.rules`. */
    id: string;
    index: number;
    /** Opens the rule's form; absent (or the catalog not loaded) leaves Edit disabled. */
    onedit?: (r: ZoningRule) => void;
    /** Why Edit is unavailable (the catalog is loading or lacks the rule's data), or null. */
    editUnavailable?: string | null;
    announce?: (msg: string) => void;
    /** After Remove: the list moves focus (this card is gone). */
    onremoved?: (index: number) => void;
    /** This rule is the one shown on the map ("Show on map" is pressed). */
    selected?: boolean;
    /** "Show on map" pressed (`on`) or released. */
    onselect?: (on: boolean) => void;
  }
  let {
    store,
    sync,
    id,
    index,
    onedit = undefined,
    editUnavailable = null,
    announce = undefined,
    onremoved = undefined,
    selected = false,
    onselect = undefined
  }: Props = $props();

  const uid = $props.id();
  const rule = $derived(store.policy.rules.find((r) => r.id === id));
  const result = (k: string) => sync.result(k);
  const status = $derived(rule ? ruleLotStatus(rule, result) : null);
  const lots = $derived(status ? lotsText(status) : '');
  const head = $derived(rule ? ruleHead(rule) : '');
  const summary = $derived(rule ? ruleSummary(rule, lots) : '');

  function remove(): void {
    if (!rule) return;
    const label = `Removed: ${ruleChangeLabel(rule)}`;
    store.apply((p) => ({ ...p, rules: p.rules.filter((r) => r.id !== id) }), label);
    announce?.(label);
    onremoved?.(index);
  }

  const btn =
    'min-h-6 min-w-6 rounded-md px-1 font-semibold underline disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11';
</script>

{#if status && rule}
  {@const r = rule}
  <li class="flex flex-col gap-1 rounded-md border border-line p-2 dark:border-line-dark">
    <!-- The lot count is its own polite region, kept across states, so a count arriving is
         spoken (WCAG 4.1.3). -->
    <p id="{uid}-summary">{head} · <span role="status">{lots}</span></p>
    <div class="flex flex-wrap gap-x-2 gap-y-1">
      {#if status.kind === 'failed'}
        {@const keys = status.keys}
        <button
          type="button"
          aria-describedby="{uid}-summary"
          class={btn}
          onclick={() => keys.forEach((k) => sync.retry(k))}>Retry</button
        >
      {/if}
      <button
        type="button"
        aria-pressed={selected}
        aria-label="Show on map: {summary}"
        class="{btn} aria-pressed:bg-accent-tint aria-pressed:text-ink aria-pressed:no-underline dark:aria-pressed:bg-accent-dark/30 dark:aria-pressed:text-ink-dark"
        onclick={() => onselect?.(!selected)}>Show on map</button
      >
      <button
        type="button"
        data-brush-edit={id}
        aria-label="Edit: {summary}"
        disabled={!onedit || editUnavailable !== null}
        aria-describedby={editUnavailable ? `${uid}-edit-why` : undefined}
        class={btn}
        onclick={() => onedit?.(r)}>Edit</button
      >
      <button type="button" aria-label="Remove: {summary}" class={btn} onclick={remove}
        >Remove</button
      >
    </div>
    {#if editUnavailable}
      <span id="{uid}-edit-why" class="text-ink-muted dark:text-ink-dark-muted"
        >{editUnavailable}</span
      >
    {/if}
  </li>
{/if}
