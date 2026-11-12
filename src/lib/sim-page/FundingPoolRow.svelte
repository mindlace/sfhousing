<!--
  An added pool's row in the Funding tab (funding-ui spec 4.6, 4.7, 4.9, 4.16): its select button
  ("{name} · {amount}", then what it pays for), and, when selected, its editor in place:
  the fields of table 4.7 in order (Name, Kind of money, one block per row of money in with its
  Once / Every year radios, amount, When or From, and Until for a yearly row, "+ Money in", then a
  bond's rate and years to repay or a bank's lending per dollar), each field's source line,
  the pool preview, "Remove {name}" and "What it pays for" (its "+ What it pays for" is wired by
  Task 7). A draft (`id` null) is always open, with the "Not added yet" line and "Discard {name}",
  and reports every change through `ondraft` instead of `onedit`.

  Every field commits on `change` (and Enter in a text or number input). A value that fails its
  check is not applied: the field keeps the typed text, gets aria-invalid, and its always-present
  role="alert" paragraph shows the message, until the stored value under it changes (an undo or
  redo that rewrites the field clears the error).
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { formatDollars } from '$lib/fzp/format';
  import { dayOf, firstOfMonth } from '$lib/sim/scenario/dates';
  import { FINANCE_LIMITS } from '$lib/sim/levers/finance';
  import type { Day, Inflow, Pool, PoolKind } from '$lib/timelapse/types';
  import {
    AMOUNT_ERROR,
    CUSTOM_LINE,
    DEBT_RATE_ERROR,
    DRAFT_LINE,
    INFLOW_LIMIT_DESC,
    INFLOW_MIN_DESC,
    KIND_NAME,
    LEVERAGE_ERROR,
    PAST_LINE,
    UNTIL_ERROR,
    addProgrammeName,
    customLine,
    dateRangeError,
    discardName,
    perYearText,
    ratePercent,
    sourcedLine
  } from './funding-copy';
  import {
    addInflowEdit,
    fieldText,
    generatedName,
    isUnchanged,
    parseAmountMillions,
    parseLeverage,
    parseName,
    parsePercent,
    parseWholeYears,
    removeInflowEdit,
    removePoolEdit,
    renamePoolEdit,
    setDebtEdit,
    setInflowAmountEdit,
    setInflowDateEdit,
    setInflowKindEdit,
    setKindEdit,
    setLeverageEdit,
    updatePoolDraft,
    type FieldUnit,
    type FundingEdit,
    type Parsed,
    type PoolDraft,
    type Refused
  } from './funding-edit';
  import type { FundingPreset, PoolField } from './funding-presets';
  import { POOL_KIND_DEFAULTS } from './funding-sources';
  import { fieldSource, poolPreview, programmeSentence } from './funding-view';
  import type { SimPolicy } from './policy';
  import SourceList from './SourceList.svelte';

  interface Props {
    /** A stored added pool, or the open draft (`id` null). */
    pool: Pool | PoolDraft;
    id: string | null;
    selected: boolean;
    /** The policy the edits are built against (labels name the pool as stored). */
    policy: SimPolicy;
    presets: FundingPreset[];
    /** What `pastItems` reports for this pool: the whole pool, and its rows (from 0). */
    past: { pool: boolean; inflows: number[] };
    asOf: Day;
    /** The page's memory that this pool's name was generated and never edited (4.9). */
    autoName?: boolean;
    onselect: () => void;
    onedit: (e: FundingEdit | Refused) => void;
    /** A draft's next state; `field` is the `data-field` of the control that committed it. */
    ondraft?: (d: PoolDraft, field: string) => void;
    ondiscard?: () => void;
  }

  let {
    pool,
    id,
    selected,
    policy,
    presets,
    past,
    asOf,
    autoName = false,
    onselect,
    onedit,
    ondraft = undefined,
    ondiscard = undefined
  }: Props = $props();

  const uid = $props.id();
  let root = $state<HTMLLIElement>();

  type Row = PoolDraft['inflows'][number];

  const MONTHS = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2000, i, 1))
    )
  );
  const LAST_MONTH: Day = dayOf(2066, 12, 1);
  const KINDS = Object.keys(KIND_NAME) as PoolKind[];
  const parseDebtRate = parsePercent(0, 25, true, DEBT_RATE_ERROR);

  const utcYear = (d: Day): number => new Date(d * 86_400_000).getUTCFullYear();
  const utcMonth = (d: Day): number => new Date(d * 86_400_000).getUTCMonth() + 1;

  const isDraft = $derived(id === null);
  const draft = $derived(isDraft ? (pool as PoolDraft) : null);
  const stored = $derived(isDraft ? null : (pool as Pool));
  const rows = $derived(pool.inflows as Row[]);
  const kind = $derived(pool.kind);
  const name = $derived(pool.label);

  const isEmpty = (x: Row): x is Extract<Row, { empty: true }> => 'empty' in x;
  const rowDay = (x: Row): Day => (isEmpty(x) || x.kind === 'once' ? x.day : x.from);
  const rowAmount = (x: Row): number | undefined =>
    isEmpty(x) ? undefined : x.kind === 'once' ? x.dollars : x.dollarsPerYear;
  const rowTo = (x: Row): Day | null => (!isEmpty(x) && x.kind === 'yearly' ? x.to : null);

  /** The pool as the views read it: a draft keeps only its complete rows. */
  const asPool = $derived.by((): Pool => {
    if (stored !== null) return stored;
    const d = draft!;
    return {
      id: '',
      kind: d.kind,
      label: d.label,
      inflows: d.inflows.filter((x): x is Inflow => !isEmpty(x)),
      uncapped: false,
      debt: d.debt === null ? null : ({ ...d.debt } as Pool['debt']),
      leverage: d.leverage ?? 1
    };
  });
  const preview = $derived(asPool.inflows.length > 0 ? poolPreview(asPool, asOf) : null);
  const programmes = $derived(
    id === null ? [] : policy.funding.programmes.filter((g) => g.pool === id)
  );

  /** A stored pool's name follows its kind and first year while the page generated it (4.9). */
  const regen = $derived(
    stored !== null &&
      autoName &&
      stored.inflows.length > 0 &&
      stored.label === generatedName(stored.kind, Math.min(...stored.inflows.map(rowDay)))
  );

  // ---- field errors (4.7) ----

  type Pending = { text: string; error: string; stored: unknown };
  /** A field's rejected text and message, while the stored value under it is unchanged. */
  let pending = $state<Record<string, Pending>>({});

  function pendingOf(key: string, value: unknown): Pending | null {
    const p = pending[key];
    return p !== undefined && p.stored === value ? p : null;
  }
  const errorOf = (key: string, value: unknown): string | null =>
    pendingOf(key, value)?.error ?? null;
  const textOf = (key: string, value: unknown, text: string): string =>
    pendingOf(key, value)?.text ?? text;

  /** The stored value a field's error is held against (`pending` keys). */
  function currentOf(key: string): unknown {
    const [field, k] = key.split('-');
    const x = k === undefined ? undefined : rows[Number(k)];
    switch (field) {
      case 'name':
        return name;
      case 'amount':
        return x === undefined ? undefined : rowAmount(x);
      case 'date':
        return x === undefined ? undefined : rowDay(x);
      case 'until':
        return x === undefined ? undefined : rowTo(x);
      case 'rate':
        return pool.debt?.rate;
      case 'years':
        return pool.debt?.termYears;
      case 'leverage':
        return pool.leverage;
      default:
        return undefined;
    }
  }

  // An undo or redo that rewrites a field drops its error for good, so a later change back to
  // the value it was typed over does not bring the stale text and message back (4.7).
  $effect.pre(() => {
    for (const [key, p] of Object.entries(pending)) if (currentOf(key) !== p.stored) clear(key);
  });

  function fail(key: string, text: string, error: string, value: unknown): void {
    pending[key] = { text, error, stored: value };
  }
  function clear(key: string): void {
    delete pending[key];
  }

  /** The draft's next state, or this stored pool's edit. */
  function draftWith(patch: Parameters<typeof updatePoolDraft>[1], field: string): void {
    if (draft !== null) ondraft?.(updatePoolDraft(draft, patch), field);
  }
  const withRow = (k: number, next: Row): Row[] => rows.map((x, j) => (j === k ? next : x));

  /** Commits a number field: unchanged text is no edit; a failed check keeps the text. */
  function commitNumber(
    key: string,
    text: string,
    value: number | null | undefined,
    unit: FieldUnit,
    parse: (t: string) => Parsed,
    apply: (v: number) => void
  ): void {
    if (typeof value === 'number' && isUnchanged(text, value, unit)) {
      clear(key);
      return;
    }
    const r = parse(text);
    if ('error' in r) {
      fail(key, text, r.error, value);
      return;
    }
    clear(key);
    apply(r.value);
  }

  // ---- commits, field by field ----

  function commitName(text: string): void {
    if (text.trim() === name) {
      clear('name');
      return;
    }
    const r = parseName(text);
    if ('error' in r) {
      fail('name', text, r.error, name);
      return;
    }
    clear('name');
    if (stored !== null) onedit(renamePoolEdit(policy, id!, r.value));
    else draftWith({ label: r.value }, 'name');
  }

  function commitKind(next: PoolKind): void {
    if (next === kind) return;
    if (stored !== null) onedit(setKindEdit(policy, id!, next, regen));
    else draftWith({ kind: next }, 'kind');
  }

  function commitRowKind(k: number, next: 'once' | 'yearly'): void {
    const x = rows[k];
    if (x.kind === next) return;
    if (stored !== null) {
      onedit(setInflowKindEdit(policy, id!, k, next, regen));
      return;
    }
    const day = rowDay(x);
    const amount = rowAmount(x);
    const row: Row =
      amount === undefined
        ? { kind: next, empty: true, day }
        : next === 'once'
          ? { kind: 'once', day, dollars: amount }
          : { kind: 'yearly', from: day, to: null, dollarsPerYear: amount };
    draftWith({ inflows: withRow(k, row) }, `${next}-${k}`);
  }

  function commitAmount(k: number, text: string): void {
    const x = rows[k];
    commitNumber(`amount-${k}`, text, rowAmount(x), 'millions', parseAmountMillions, (v) => {
      if (stored !== null) {
        onedit(setInflowAmountEdit(policy, id!, k, v));
        return;
      }
      const day = rowDay(x);
      const row: Row = isEmpty(x)
        ? x.kind === 'once'
          ? { kind: 'once', day, dollars: v }
          : { kind: 'yearly', from: day, to: null, dollarsPerYear: v }
        : x.kind === 'once'
          ? { ...x, dollars: v }
          : { ...x, dollarsPerYear: v };
      draftWith({ inflows: withRow(k, row) }, `amount-${k}`);
    });
  }

  /** The day a month select and year input pair reads, or null for an unreadable year. */
  function readDate(prefix: string, k: number): { day: Day | null; text: string } {
    const m = root?.querySelector(`[data-field="${prefix}month-${k}"]`) as HTMLSelectElement | null;
    const y = root?.querySelector<HTMLInputElement>(`[data-field="${prefix}year-${k}"]`);
    const text = y?.value ?? '';
    const year = Number(text);
    if (!m || text.trim() === '' || !Number.isInteger(year)) return { day: null, text };
    return { day: dayOf(year, Number(m.value), 1), text };
  }

  const inRange = (d: Day | null): d is Day =>
    d !== null && d >= firstOfMonth(asOf) && d <= LAST_MONTH;

  function commitStart(k: number, field: string): void {
    const x = rows[k];
    const was = rowDay(x);
    const key = `date-${k}`;
    const { day, text } = readDate('', k);
    if (!inRange(day)) {
      fail(key, text, dateRangeError(asOf), was);
      return;
    }
    const to = rowTo(x);
    if (to !== null && day >= to) {
      fail(key, text, UNTIL_ERROR, was);
      return;
    }
    clear(key);
    if (day === was) return;
    if (stored !== null) {
      onedit(setInflowDateEdit(policy, id!, k, x.kind === 'once' ? 'day' : 'from', day, regen));
      return;
    }
    const row: Row = isEmpty(x) || x.kind === 'once' ? { ...x, day } : { ...x, from: day };
    draftWith({ inflows: withRow(k, row) }, field);
  }

  function setUntil(k: number, to: Day | null, text: string, field: string): void {
    const x = rows[k];
    const was = rowTo(x);
    const key = `until-${k}`;
    if (to !== null) {
      if (!inRange(to)) {
        fail(key, text, dateRangeError(asOf), was);
        return;
      }
      if (to <= rowDay(x)) {
        fail(key, text, UNTIL_ERROR, was);
        return;
      }
    }
    clear(key);
    if (to === was || isEmpty(x) || x.kind !== 'yearly') return;
    if (stored !== null) onedit(setInflowDateEdit(policy, id!, k, 'to', to));
    else draftWith({ inflows: withRow(k, { ...x, to }) }, field);
  }

  function commitEnds(k: number, on: boolean): void {
    if (!on) {
      setUntil(k, null, '', `ends-${k}`);
      return;
    }
    const from = rowDay(rows[k]);
    const to = Math.min(dayOf(utcYear(from) + 1, utcMonth(from), 1), LAST_MONTH);
    setUntil(k, to, String(utcYear(to)), `ends-${k}`);
  }

  function commitUntil(k: number, field: string): void {
    const { day, text } = readDate('until-', k);
    setUntil(k, day, text, field);
  }

  async function focusField(key: string, fallback?: string): Promise<void> {
    await tick();
    const el =
      root?.querySelector<HTMLElement>(`[data-field="${key}"]`) ??
      (fallback ? root?.querySelector<HTMLElement>(`[data-field="${fallback}"]`) : null);
    el?.focus();
  }

  function addRow(): void {
    if (rows.length >= FINANCE_LIMITS.inflowsPerPool) return;
    const n = rows.length;
    if (stored !== null) onedit(addInflowEdit(policy, id!, regen));
    else draftWith({ inflows: [...rows, { ...rows[n - 1] }] }, `once-${n}`);
    void focusField(`once-${n}`);
  }

  function removeRow(k: number): void {
    if (rows.length <= 1) return;
    if (stored !== null) onedit(removeInflowEdit(policy, id!, k, regen));
    else draftWith({ inflows: rows.filter((_, j) => j !== k) }, 'add-inflow');
    // The row now at its place, else "+ Money in" (4.9).
    void focusField(`once-${k}`, 'add-inflow');
  }

  function commitRate(text: string): void {
    const debt = pool.debt;
    if (debt === null) return;
    commitNumber('rate', text, debt.rate, 'fraction', parseDebtRate, (v) => {
      if (stored !== null) onedit(setDebtEdit(policy, id!, 'rate', v));
      else draftWith({ debt: { rate: v, termYears: debt.termYears } }, 'rate');
    });
  }

  function commitYears(text: string): void {
    const debt = pool.debt;
    if (debt === null) return;
    commitNumber('years', text, debt.termYears, 'plain', parseWholeYears, (v) => {
      if (stored !== null) onedit(setDebtEdit(policy, id!, 'termYears', v));
      else draftWith({ debt: { rate: debt.rate, termYears: v } }, 'years');
    });
  }

  function commitLeverage(text: string): void {
    commitNumber('leverage', text, pool.leverage, 'plain', parseLeverage, (v) => {
      if (stored !== null) onedit(setLeverageEdit(policy, id!, v));
      else draftWith({ leverage: v }, 'leverage');
    });
  }

  /** The last text committed from a text or number input (not state: handler memory). */
  let lastCommit: { el: EventTarget; text: string } | null = null;

  /**
   * A text or number input's handlers: `change` and Enter commit, once per typed text, so the
   * `change` a browser fires after Enter, or while the element is being removed (a draft that
   * just became a row), commits nothing again. Typing starts a new text.
   */
  function typed(commit: (text: string) => void) {
    const go = (el: HTMLInputElement): void => {
      if (lastCommit !== null && lastCommit.el === el && lastCommit.text === el.value) return;
      lastCommit = { el, text: el.value };
      commit(el.value);
    };
    return {
      onchange: (e: Event) => go(e.currentTarget as HTMLInputElement),
      onkeydown: (e: KeyboardEvent) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        go(e.currentTarget as HTMLInputElement);
      },
      oninput: () => {
        lastCommit = null;
      }
    };
  }

  // ---- source lines (4.7) ----

  /** A choice field's line: only on a preset-made pool, for the paths `valueSource` covers. */
  function choiceLine(field: PoolField): string | null {
    const s = fieldSource(asPool, field, presets, kind);
    if (s.kind === 'choice') return null;
    return s.kind === 'sourced' ? sourcedLine(s.provenance.label, s.provenance.tier) : CUSTOM_LINE;
  }

  /** Made by a preset: its id is `u-<presetId>-<n>` for a preset on the page. */
  const presetMade = $derived(
    id !== null &&
      presets.some((p) => {
        const prefix = `u-${p.id}-`;
        return id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length));
      })
  );

  /**
   * An evidence field's line: its source; on a preset-made pool otherwise "Custom, not sourced."
   * (4.7, whatever its kind); on a hand-made pool "your value" beside the sourced default.
   */
  function evidenceLine(field: 'debt.rate' | 'debt.termYears' | 'leverage'): string {
    const s = fieldSource(asPool, field, presets, kind);
    if (s.kind === 'sourced') return sourcedLine(s.provenance.label, s.provenance.tier);
    if (presetMade) return CUSTOM_LINE;
    const d = POOL_KIND_DEFAULTS[kind];
    if (field === 'leverage') {
      const e = d.leverage;
      return e !== null && 'provenance' in e
        ? customLine(String(e.value), e.provenance.label)
        : CUSTOM_LINE;
    }
    const e = d.debt;
    if (e === null || !('provenance' in e)) return CUSTOM_LINE;
    const value = field === 'debt.rate' ? ratePercent(e.value.rate) : `${e.value.termYears} years`;
    return customLine(value, e.provenance.label);
  }

  const amountPath = (x: Row, k: number): PoolField =>
    `inflows[${k}].${x.kind === 'once' ? 'dollars' : 'dollarsPerYear'}`;
  const startPath = (x: Row, k: number): PoolField =>
    `inflows[${k}].${x.kind === 'once' ? 'day' : 'from'}`;

  // ---- the select button ----

  function amountText(p: Pool): string {
    const v = poolPreview(p, asOf);
    return v.perYear !== null ? perYearText(v.perYear) : formatDollars(v.once);
  }

  const muted = 'text-ink-muted dark:text-ink-dark-muted';
  const rowButton =
    'flex min-h-11 w-full flex-col items-start rounded-md px-1 py-1 text-left hover:bg-surface-raised dark:hover:bg-surface-dark-raised';
  const link =
    'min-h-6 min-w-6 rounded-md px-1 font-semibold underline aria-disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11';
  const input =
    'min-h-6 rounded-md border border-control-line bg-surface px-2 text-ink aria-invalid:border-red-800 dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark dark:aria-invalid:border-red-300 pointer-coarse:min-h-11';
  const alertClass = (msg: string | null): string =>
    `text-red-800 dark:text-red-300 ${msg ? '' : 'sr-only'}`;
  const rowClass = (on: boolean): string =>
    `flex flex-col rounded-md border p-1 ${
      on
        ? 'border-accent bg-surface-raised dark:border-accent-dark dark:bg-surface-dark-raised'
        : 'border-line bg-surface dark:border-line-dark dark:bg-surface-dark'
    }`;
</script>

<!-- The always-present error paragraph of one field (WCAG 4.1.3). -->
{#snippet alertLine(key: string, msg: string | null)}
  <p id="{uid}-{key}-err" role="alert" class={alertClass(msg)}>{msg ?? ''}</p>
{/snippet}

{#snippet sourceLine(text: string | null)}
  {#if text !== null}
    <p data-source-line class={muted}>{text}</p>
  {/if}
{/snippet}

<li
  bind:this={root}
  data-funding-row={id === null ? 'draft' : `pool:${id}`}
  class={rowClass(selected || isDraft)}
>
  {#if stored !== null}
    <button type="button" aria-pressed={selected} class={rowButton} onclick={onselect}>
      <span class="font-semibold">{name} · {amountText(stored)}</span>
      {#each programmes as g (g.id)}
        <span class={muted}>{programmeSentence(g, stored)}</span>
      {/each}
    </button>
    <!-- A button's children are presentational: a changed amount is also a sibling status, so it
         is spoken (4.16, WCAG 4.1.3). -->
    <span role="status" class="sr-only">{name}: {amountText(stored)}</span>
    {#if past.pool}
      <p class="px-1 {muted}">{PAST_LINE}</p>
    {/if}
  {:else}
    <p class="px-1 pt-1 font-semibold">{name}</p>
    <p class="px-1 {muted}">{DRAFT_LINE}</p>
  {/if}

  {#if selected || isDraft}
    {@const nameErr = errorOf('name', name)}
    <div data-funding-editor class="flex flex-col gap-3 px-1 pt-1 pb-2">
      <div class="flex flex-col gap-0.5">
        <label class="flex flex-col items-start gap-0.5">
          Name
          <input
            type="text"
            data-field="name"
            class="{input} w-full"
            value={textOf('name', name, name)}
            aria-invalid={nameErr ? 'true' : undefined}
            aria-describedby="{uid}-name-err"
            {...typed(commitName)}
          />
        </label>
        {@render alertLine('name', nameErr)}
      </div>

      <label class="flex flex-col items-start gap-0.5">
        Kind of money
        <select
          data-field="kind"
          class="{input} w-full"
          value={kind}
          onchange={(e) => commitKind(e.currentTarget.value as PoolKind)}
        >
          {#each KINDS as k (k)}
            <option value={k}>{KIND_NAME[k]}</option>
          {/each}
        </select>
      </label>

      {#each rows as x, k (k)}
        {@const n = k + 1}
        {@const amount = rowAmount(x)}
        {@const amountErr =
          errorOf(`amount-${k}`, amount) ?? (amount === undefined ? AMOUNT_ERROR : null)}
        {@const start = rowDay(x)}
        {@const startErr = errorOf(`date-${k}`, start)}
        {@const to = rowTo(x)}
        {@const untilErr = errorOf(`until-${k}`, to)}
        {@const legend = x.kind === 'once' ? 'When' : 'From'}
        <div class="flex flex-col gap-1.5 border-t border-line pt-2 dark:border-line-dark">
          <fieldset class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <legend class="font-semibold">Money in, row {n}</legend>
            {#each [['once', 'Once'], ['yearly', 'Every year']] as const as [value, text] (value)}
              <label class="flex min-h-6 items-center gap-1.5 pointer-coarse:min-h-11">
                <input
                  type="radio"
                  class="size-5"
                  name="{uid}-kind-{k}"
                  data-field="{value}-{k}"
                  checked={x.kind === value}
                  onchange={() => commitRowKind(k, value)}
                />
                <span>{text}<span class="sr-only">, row {n}</span></span>
              </label>
            {/each}
          </fieldset>

          <div class="flex flex-col gap-0.5">
            <label class="flex flex-wrap items-center gap-1">
              <span
                >Amount, $ million{x.kind === 'yearly' ? ' a year' : ''}<span class="sr-only"
                  >, row {n}</span
                ></span
              >
              <input
                type="number"
                inputmode="decimal"
                step="any"
                data-field="amount-{k}"
                class="{input} w-32"
                value={textOf(
                  `amount-${k}`,
                  amount,
                  amount === undefined ? '' : fieldText(amount, 'millions')
                )}
                aria-invalid={amountErr ? 'true' : undefined}
                aria-describedby="{uid}-amount-{k}-err"
                {...typed((t) => commitAmount(k, t))}
              />
            </label>
            {@render alertLine(`amount-${k}`, amountErr)}
            {#if !isEmpty(x)}
              {@render sourceLine(choiceLine(amountPath(x, k)))}
            {/if}
          </div>

          <div class="flex flex-col gap-0.5">
            <fieldset class="flex flex-wrap items-center gap-2">
              <legend class="font-semibold">{legend}</legend>
              <label class="flex items-center gap-1">
                <span>Month<span class="sr-only">, {legend}, row {n}</span></span>
                <select
                  data-field="month-{k}"
                  class={input}
                  value={String(utcMonth(start))}
                  aria-invalid={startErr ? 'true' : undefined}
                  aria-describedby="{uid}-date-{k}-err"
                  onchange={() => commitStart(k, `month-${k}`)}
                >
                  {#each MONTHS as m, i (i)}
                    <option value={String(i + 1)}>{m}</option>
                  {/each}
                </select>
              </label>
              <label class="flex items-center gap-1">
                <span>Year<span class="sr-only">, {legend}, row {n}</span></span>
                <input
                  type="number"
                  inputmode="numeric"
                  step="1"
                  data-field="year-{k}"
                  class="{input} w-24"
                  value={textOf(`date-${k}`, start, String(utcYear(start)))}
                  aria-invalid={startErr ? 'true' : undefined}
                  aria-describedby="{uid}-date-{k}-err"
                  {...typed(() => commitStart(k, `year-${k}`))}
                />
              </label>
            </fieldset>
            {@render alertLine(`date-${k}`, startErr)}
            {#if !isEmpty(x)}
              {@render sourceLine(choiceLine(startPath(x, k)))}
            {/if}
          </div>

          {#if !isEmpty(x) && x.kind === 'yearly'}
            <div class="flex flex-col gap-0.5">
              <fieldset class="flex flex-wrap items-center gap-2">
                <legend class="font-semibold">Until</legend>
                <label class="flex min-h-6 items-center gap-1.5 pointer-coarse:min-h-11">
                  <input
                    type="checkbox"
                    class="size-5"
                    data-field="ends-{k}"
                    checked={to !== null}
                    aria-describedby="{uid}-until-{k}-err"
                    onchange={(e) => commitEnds(k, e.currentTarget.checked)}
                  />
                  <span>Ends<span class="sr-only">, row {n}</span></span>
                </label>
                {#if to !== null}
                  <label class="flex items-center gap-1">
                    <span>Month<span class="sr-only">, Until, row {n}</span></span>
                    <select
                      data-field="until-month-{k}"
                      class={input}
                      value={String(utcMonth(to))}
                      aria-invalid={untilErr ? 'true' : undefined}
                      aria-describedby="{uid}-until-{k}-err"
                      onchange={() => commitUntil(k, `until-month-${k}`)}
                    >
                      {#each MONTHS as m, i (i)}
                        <option value={String(i + 1)}>{m}</option>
                      {/each}
                    </select>
                  </label>
                  <label class="flex items-center gap-1">
                    <span>Year<span class="sr-only">, Until, row {n}</span></span>
                    <input
                      type="number"
                      inputmode="numeric"
                      step="1"
                      data-field="until-year-{k}"
                      class="{input} w-24"
                      value={textOf(`until-${k}`, to, String(utcYear(to)))}
                      aria-invalid={untilErr ? 'true' : undefined}
                      aria-describedby="{uid}-until-{k}-err"
                      {...typed(() => commitUntil(k, `until-year-${k}`))}
                    />
                  </label>
                {/if}
              </fieldset>
              {@render alertLine(`until-${k}`, untilErr)}
              {@render sourceLine(choiceLine(`inflows[${k}].to`))}
            </div>
          {/if}

          {#if past.inflows.includes(k)}
            <p class={muted}>{PAST_LINE}</p>
          {/if}

          <div class="flex flex-col items-start">
            <!-- aria-disabled, not disabled: it keeps focus, and its reason is its description. -->
            <button
              type="button"
              data-field="remove-inflow-{k}"
              class={link}
              aria-disabled={rows.length <= 1 ? 'true' : undefined}
              aria-describedby={rows.length <= 1 ? `${uid}-min` : undefined}
              onclick={() => removeRow(k)}
              >Remove<span class="sr-only"> money in, row {n}</span></button
            >
          </div>
        </div>
      {/each}
      {#if rows.length <= 1}
        <span id="{uid}-min" class="sr-only">{INFLOW_MIN_DESC}</span>
      {/if}

      <div class="flex flex-col items-start gap-0.5">
        <button
          type="button"
          data-field="add-inflow"
          class={link}
          aria-disabled={rows.length >= FINANCE_LIMITS.inflowsPerPool ? 'true' : undefined}
          aria-describedby={rows.length >= FINANCE_LIMITS.inflowsPerPool ? `${uid}-max` : undefined}
          onclick={addRow}
          ><span aria-hidden="true">+</span> Add money in<span class="sr-only">, {name}</span
          ></button
        >
        {#if rows.length >= FINANCE_LIMITS.inflowsPerPool}
          <span id="{uid}-max" class={muted}>{INFLOW_LIMIT_DESC}</span>
        {/if}
      </div>

      {#if pool.debt !== null && (kind === 'goBond' || kind === 'cop')}
        {@const debt = pool.debt}
        {@const rateErr =
          errorOf('rate', debt.rate) ?? (debt.rate === null ? DEBT_RATE_ERROR : null)}
        {@const yearsErr = errorOf('years', debt.termYears)}
        <div class="flex flex-col gap-0.5">
          <label class="flex flex-wrap items-center gap-1">
            Interest rate, %
            <input
              type="number"
              inputmode="decimal"
              step="any"
              data-field="rate"
              class="{input} w-24"
              value={textOf(
                'rate',
                debt.rate,
                debt.rate === null ? '' : fieldText(debt.rate, 'fraction')
              )}
              aria-invalid={rateErr ? 'true' : undefined}
              aria-describedby="{uid}-rate-err"
              {...typed(commitRate)}
            />
          </label>
          {@render alertLine('rate', rateErr)}
          {@render sourceLine(evidenceLine('debt.rate'))}
        </div>
        <div class="flex flex-col gap-0.5">
          <label class="flex flex-wrap items-center gap-1">
            Years to repay
            <input
              type="number"
              inputmode="numeric"
              step="any"
              data-field="years"
              class="{input} w-24"
              value={textOf('years', debt.termYears, fieldText(debt.termYears, 'plain'))}
              aria-invalid={yearsErr ? 'true' : undefined}
              aria-describedby="{uid}-years-err"
              {...typed(commitYears)}
            />
          </label>
          {@render alertLine('years', yearsErr)}
          {@render sourceLine(evidenceLine('debt.termYears'))}
        </div>
      {/if}

      {#if kind === 'bank'}
        {@const lev = pool.leverage}
        {@const levErr = errorOf('leverage', lev) ?? (lev === null ? LEVERAGE_ERROR : null)}
        <div class="flex flex-col gap-0.5">
          <label class="flex flex-wrap items-center gap-1">
            Dollars lent per dollar received
            <input
              type="number"
              inputmode="decimal"
              step="any"
              data-field="leverage"
              class="{input} w-24"
              value={textOf('leverage', lev, lev === null ? '' : fieldText(lev, 'plain'))}
              aria-invalid={levErr ? 'true' : undefined}
              aria-describedby="{uid}-leverage-err"
              {...typed(commitLeverage)}
            />
          </label>
          {@render alertLine('leverage', levErr)}
          {@render sourceLine(evidenceLine('leverage'))}
        </div>
      {/if}

      {#if preview !== null}
        <div class="flex flex-col gap-0.5 {muted}">
          <p>{preview.lines.join(' ')}</p>
          {#if preview.sources.length > 0}
            <div class="text-xs"><SourceList items={preview.sources} /></div>
          {/if}
        </div>
      {/if}

      {#if stored !== null}
        <div>
          <button
            type="button"
            data-field="remove"
            class={link}
            onclick={() => onedit(removePoolEdit(policy, id!))}>Remove {name}</button
          >
        </div>

        <section class="flex flex-col gap-1">
          <h4 class="font-semibold">What it pays for</h4>
          {#if programmes.length > 0}
            <ul class="flex flex-col gap-1">
              {#each programmes as g (g.id)}
                <li>{programmeSentence(g, stored)}</li>
              {/each}
            </ul>
          {/if}
          <div>
            <!-- Wired by Task 7 (the programme editor). -->
            <button type="button" class={link} aria-label={addProgrammeName(name)}
              ><span aria-hidden="true">+</span> What it pays for</button
            >
          </div>
        </section>
      {:else}
        <div>
          <button type="button" data-field="discard" class={link} onclick={() => ondiscard?.()}
            >{discardName(name)}</button
          >
        </div>
      {/if}
    </div>
  {/if}
</li>
