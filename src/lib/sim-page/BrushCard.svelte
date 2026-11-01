<!--
  One card in "New zoning rules" or "Custom zoning": a zoning rule (`list="rules"`: Edit and Remove; rules are additive,
  so their order does not matter) or a custom brush (`list="custom"`: Move up, Move down and
  Remove; a later brush wins). A one-line summary with the lot count in a polite live region
  (WCAG 4.1.3), then the buttons, each named with the summary. Every change is a labelled store
  change, so Undo names and undoes it; a moved card keeps focus on the button pressed.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import {
    customChangeLabel,
    customHead,
    customLotStatus,
    customSummary,
    lotsText,
    ruleChangeLabel,
    ruleHead,
    ruleLotStatus,
    ruleSummary
  } from './brush-summary';
  import type { ZoningRule } from './policy';
  import type { LeverSync, PolicyStore } from './policy-store.svelte';

  interface Props {
    store: PolicyStore;
    sync: Pick<LeverSync, 'result' | 'retry'>;
    list: 'rules' | 'custom';
    /** The rule's or custom brush's id in `store.policy[list]`. */
    id: string;
    index: number;
    /** Opens a rule's form; absent (or the catalog not loaded) leaves Edit disabled. */
    onedit?: (r: ZoningRule) => void;
    /** Why Edit is unavailable (the catalog is loading or lacks the rule's data), or null. */
    editUnavailable?: string | null;
    announce?: (msg: string) => void;
    /** After Remove: the list moves focus (this card is gone). */
    onremoved?: (index: number) => void;
  }
  let {
    store,
    sync,
    list,
    id,
    index,
    onedit = undefined,
    editUnavailable = null,
    announce = undefined,
    onremoved = undefined
  }: Props = $props();

  const uid = $props.id();
  const rule = $derived(list === 'rules' ? store.policy.rules.find((r) => r.id === id) : undefined);
  const custom = $derived(
    list === 'custom' ? store.policy.custom.find((b) => b.id === id) : undefined
  );
  const total = $derived(store.policy.custom.length);
  const result = (k: string) => sync.result(k);
  const status = $derived(
    rule ? ruleLotStatus(rule, result) : custom ? customLotStatus(custom, result) : null
  );
  const lots = $derived(status ? lotsText(status) : '');
  const head = $derived(rule ? ruleHead(rule) : custom ? customHead(custom) : '');
  const summary = $derived(
    rule ? ruleSummary(rule, lots) : custom ? customSummary(custom, lots) : ''
  );
  const changeLabel = () =>
    rule ? ruleChangeLabel(rule) : custom ? customChangeLabel(custom) : '';

  let upBtn = $state<HTMLButtonElement>();
  let downBtn = $state<HTMLButtonElement>();

  function move(dir: -1 | 1): void {
    const from = store.policy.custom.findIndex((b) => b.id === id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= store.policy.custom.length) return;
    const label = `Moved ${dir < 0 ? 'up' : 'down'}: ${changeLabel()}`;
    store.apply((p) => {
      const custom = [...p.custom];
      [custom[from], custom[to]] = [custom[to], custom[from]];
      return { ...p, custom };
    }, label);
    announce?.(label);
    // The keyed list moves this card's node, which drops focus: put it back, on the other move
    // button when this one has just become disabled.
    void tick().then(() => {
      const want = dir < 0 ? upBtn : downBtn;
      (want && !want.disabled ? want : dir < 0 ? downBtn : upBtn)?.focus();
    });
  }

  function remove(): void {
    const label = `Removed: ${changeLabel()}`;
    store.apply(
      (p) =>
        list === 'rules'
          ? { ...p, rules: p.rules.filter((r) => r.id !== id) }
          : { ...p, custom: p.custom.filter((b) => b.id !== id) },
      label
    );
    announce?.(label);
    onremoved?.(index);
  }

  const btn =
    'min-h-6 min-w-6 rounded-md px-1 font-semibold underline disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11';
</script>

{#if status}
  <li class="flex flex-col gap-1 rounded-md border border-gray-300 p-2">
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
      {#if rule}
        {@const r = rule}
        <button
          type="button"
          data-brush-edit={id}
          aria-label="Edit: {summary}"
          disabled={!onedit || editUnavailable !== null}
          aria-describedby={editUnavailable ? `${uid}-edit-why` : undefined}
          class={btn}
          onclick={() => onedit?.(r)}>Edit</button
        >
      {:else}
        <button
          bind:this={upBtn}
          type="button"
          aria-label="Move up: {summary}"
          disabled={index === 0}
          class={btn}
          onclick={() => move(-1)}>Move up</button
        >
        <button
          bind:this={downBtn}
          type="button"
          aria-label="Move down: {summary}"
          disabled={index >= total - 1}
          class={btn}
          onclick={() => move(1)}>Move down</button
        >
      {/if}
      <button type="button" aria-label="Remove: {summary}" class={btn} onclick={remove}
        >Remove</button
      >
    </div>
    {#if rule && editUnavailable}
      <span id="{uid}-edit-why" class="text-gray-700">{editUnavailable}</span>
    {/if}
  </li>
{/if}
