<!--
  "Market terms you set" (funding-ui spec 4.8a): one row per `termRows` term, nothing rendered
  without rows. The guarantee rate cut is a number input in percentage points (0 to 5, step
  0.05; stored as the fraction):
  - empty: its description says no source gives it;
  - typed: "Your value (custom, not sourced)." and "Clear", aria-disabled with its reason while a
    guarantee in the policy is valued with it;
  - typed over a sourced term (a loaded document): "Your value … Sourced: {value} from {label}."
    and "Use the sourced value" in place of "Clear";
  - invalid: the typed text kept, aria-invalid and the role="alert" line; nothing reaches the store.
  A sourced term a loaded document typed over shows its value, its line and "Use the sourced value"
  (the page offers no field for a term with a source).
-->
<script lang="ts">
  import { tick } from 'svelte';
  import type { TermKey } from '$lib/timelapse/types';
  import {
    RATE_CUT_DESC,
    TERM_IN_USE_DESC,
    USE_SOURCED,
    YOUR_VALUE_LINE,
    customLine,
    ratePercent,
    termTitle
  } from './funding-copy';
  import {
    clearTermEdit,
    fieldText,
    isUnchanged,
    parseRateCutPoints,
    setTermEdit,
    type FundingEdit,
    type Refused
  } from './funding-edit';
  import type { termRows } from './funding-view';
  import type { SimPolicy } from './policy';

  interface Props {
    rows: ReturnType<typeof termRows>;
    /** The policy `clearTermEdit` checks for a guarantee that needs the term. */
    policy: SimPolicy;
    onedit: (e: FundingEdit | Refused) => void;
    /** The id of a term's input, so "Go to Market terms you set" can focus it. */
    inputId: (k: TermKey) => string;
  }

  let { rows, policy, onedit, inputId }: Props = $props();

  const uid = $props.id();

  type Row = Props['rows'][number];

  /** A term's rejected text and message, while its stored value is unchanged. */
  let pending = $state<Partial<Record<TermKey, { text: string; error: string; stored: unknown }>>>(
    {}
  );
  const pendingOf = (r: Row) => {
    const p = pending[r.key];
    return p !== undefined && p.stored === r.typed ? p : null;
  };
  // An undo or redo that rewrites the term drops its error for good.
  $effect.pre(() => {
    for (const r of rows) {
      const p = pending[r.key];
      if (p !== undefined && p.stored !== r.typed) delete pending[r.key];
    }
  });

  /** The term in its own unit: years for the construction period, else a percent. */
  const valueText = (k: TermKey, v: number): string =>
    k === 'constructionYears' ? `${v} years` : ratePercent(v);

  let lastCommit: { el: EventTarget; text: string } | null = null;

  function commit(r: Row, el: HTMLInputElement): void {
    if (lastCommit !== null && lastCommit.el === el && lastCommit.text === el.value) return;
    lastCommit = { el, text: el.value };
    const text = el.value;
    if (r.typed !== null && isUnchanged(text, r.typed, 'fraction')) {
      delete pending[r.key];
      return;
    }
    if (r.typed === null && text.trim() === '') {
      delete pending[r.key];
      return;
    }
    const v = parseRateCutPoints(text);
    if ('error' in v) {
      pending[r.key] = { text, error: v.error, stored: r.typed };
      return;
    }
    delete pending[r.key];
    onedit(setTermEdit(r.key, v.value));
  }

  function clear(r: Row, locked: boolean): void {
    if (locked) return;
    onedit(clearTermEdit(policy, r.key));
    void tick().then(() => document.getElementById(inputId(r.key))?.focus());
  }

  const muted = 'text-ink-muted dark:text-ink-dark-muted';
  const link =
    'min-h-6 min-w-6 rounded-md px-1 font-semibold underline aria-disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11';
  const input =
    'min-h-6 w-24 rounded-md border border-control-line bg-surface px-2 text-ink aria-invalid:border-red-800 dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark dark:aria-invalid:border-red-300 pointer-coarse:min-h-11';
</script>

{#if rows.length > 0}
  <section class="flex flex-col gap-2">
    <h3 class="font-semibold">Market terms you set</h3>
    <ul class="flex flex-col gap-2">
      {#each rows as r (r.key)}
        {@const p = pendingOf(r)}
        {@const locked = r.inUse && r.sourced === null}
        <li data-term-row={r.key} class="flex flex-col items-start gap-0.5">
          {#if r.key === 'guaranteeRateCut'}
            <label class="flex flex-wrap items-center gap-1">
              {termTitle(r.key)}, percentage points
              <input
                id={inputId(r.key)}
                type="number"
                inputmode="decimal"
                min="0"
                max="5"
                step="0.05"
                class={input}
                value={p?.text ?? (r.typed === null ? '' : fieldText(r.typed, 'fraction'))}
                aria-invalid={p ? 'true' : undefined}
                aria-describedby="{r.typed === null
                  ? `${uid}-${r.key}-desc `
                  : ''}{uid}-{r.key}-err"
                onchange={(e) => commit(r, e.currentTarget)}
                onkeydown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  commit(r, e.currentTarget);
                }}
                oninput={() => (lastCommit = null)}
              />
            </label>
          {:else if r.typed !== null}
            <p id={inputId(r.key)} tabindex="-1">
              {termTitle(r.key)}: {valueText(r.key, r.typed)}
            </p>
          {/if}
          <p
            id="{uid}-{r.key}-err"
            role="alert"
            class="text-red-800 dark:text-red-300 {p ? '' : 'sr-only'}"
          >
            {p?.error ?? ''}
          </p>
          {#if r.typed === null}
            <p id="{uid}-{r.key}-desc" class={muted}>{RATE_CUT_DESC}</p>
          {:else if r.sourced === null || r.sourcedValue === null}
            <p data-source-line class={muted}>{YOUR_VALUE_LINE}</p>
            <button
              type="button"
              class={link}
              aria-disabled={locked ? 'true' : undefined}
              aria-describedby={locked ? `${uid}-${r.key}-lock` : undefined}
              onclick={() => clear(r, locked)}
              >Clear<span class="sr-only"> {termTitle(r.key).toLowerCase()}</span></button
            >
            {#if locked}
              <p id="{uid}-{r.key}-lock" class={muted}>{TERM_IN_USE_DESC}</p>
            {/if}
          {:else}
            <p data-source-line class={muted}>
              {customLine(valueText(r.key, r.sourcedValue), r.sourced.label)}
            </p>
            <button type="button" class={link} onclick={() => clear(r, false)}>{USE_SOURCED}</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}
