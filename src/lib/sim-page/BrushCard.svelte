<!--
  One brush in "Your zoning"'s ordered list (later brushes win). A one-line summary with the lot
  count in a polite live region (WCAG 4.1.3), then Edit (rule brushes only), Move up, Move down and
  Remove, each named with the summary. Moving and removing are labelled store changes, so Undo
  names and undoes them; a moved card keeps focus on the button pressed.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import {
    brushSummary,
    changeLabel,
    summaryParts,
    lotStatus,
    lotsText,
    ruleKindOf
  } from './brush-summary';
  import type { ZoningBrush } from './policy';
  import type { LeverSync, PolicyStore } from './policy-store.svelte';

  interface Props {
    store: PolicyStore;
    sync: Pick<LeverSync, 'result' | 'retry'>;
    brush: ZoningBrush;
    index: number;
    /** Opens the brush's form; absent (or the catalog not loaded) leaves Edit disabled. */
    onedit?: (b: ZoningBrush) => void;
    editDisabled?: boolean;
    announce?: (msg: string) => void;
    /** After Remove: the list moves focus (this card is gone). */
    onremoved?: (index: number) => void;
  }
  let {
    store,
    sync,
    brush,
    index,
    onedit = undefined,
    editDisabled = false,
    announce = undefined,
    onremoved = undefined
  }: Props = $props();

  const uid = $props.id();
  const total = $derived(store.policy.brushes.length);
  const status = $derived(lotStatus(brush, (k) => sync.result(k)));
  const summary = $derived(brushSummary(brush, lotsText(status)));
  const parts = $derived(summaryParts(brush));
  const editable = $derived(ruleKindOf(brush) !== null);

  let upBtn = $state<HTMLButtonElement>();
  let downBtn = $state<HTMLButtonElement>();

  function move(dir: -1 | 1): void {
    const from = store.policy.brushes.findIndex((b) => b.id === brush.id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= store.policy.brushes.length) return;
    const label = `Moved ${dir < 0 ? 'up' : 'down'}: ${changeLabel(brush)}`;
    store.apply((p) => {
      const brushes = [...p.brushes];
      [brushes[from], brushes[to]] = [brushes[to], brushes[from]];
      return { ...p, brushes };
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
    const label = `Removed: ${changeLabel(brush)}`;
    store.apply((p) => ({ ...p, brushes: p.brushes.filter((b) => b.id !== brush.id) }), label);
    announce?.(label);
    onremoved?.(index);
  }

  const btn =
    'min-h-6 min-w-6 rounded-md px-1 font-semibold underline disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11';
</script>

<li class="flex flex-col gap-1 rounded-md border border-gray-300 p-2">
  <!-- The lot count is its own polite region, kept across states, so a count arriving is
       spoken (WCAG 4.1.3). -->
  <p id="{uid}-summary">
    {parts.head} · <span role="status">{lotsText(status)}</span>{parts.tail
      ? ` · ${parts.tail}`
      : ''}
  </p>
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
    {#if editable}
      <button
        type="button"
        data-brush-edit={brush.id}
        aria-label="Edit: {summary}"
        disabled={!onedit || editDisabled}
        class={btn}
        onclick={() => onedit?.(brush)}>Edit</button
      >
    {/if}
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
    <button type="button" aria-label="Remove: {summary}" class={btn} onclick={remove}>Remove</button
    >
  </div>
</li>
