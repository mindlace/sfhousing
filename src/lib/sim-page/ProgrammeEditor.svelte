<!--
  One programme's nested row (funding-ui spec 4.8, 4.8a, 4.6 drafts, 4.16): a select button named by
  the programme's sentence (computed live, never the stored label), and, when selected, the fields
  of table 4.8 in order: "Pays from" (only with `poolChoices`, the City group), For, As (the "Loan
  guarantee" option aria-disabled with its reason while no rate cut resolves, followed by "Go to
  Market terms you set"), the instrument's numbers, From and Until, Projects of at least, the
  income mix (affordable only), each evidence field's source line, the preview, then Remove.

  A draft (`prog` without an id: a new programme, or a stored one, `id`, whose new instrument needs
  a value with no source) is always open, shows the "Not added yet" line and "Discard {name}", and
  reports every change through `ondraft`. A stored programme reports its edits through `onedit`,
  except an instrument change that needs a value with no source, which opens a draft of it.
  Every field commits on `change` (and Enter in a number input); a failed check keeps the typed
  text, sets aria-invalid and fills the field's always-present role="alert" paragraph.
-->
<script module lang="ts">
  import type { Day, Pool } from '$lib/timelapse/types';
  import type { ProgrammeDraft } from './funding-edit';
  import type { FundingPreset } from './funding-presets';
  import type { Baseline } from './funding-view';

  /** What the tab hands a list of programme rows (a pool's or a baseline group's). */
  export interface ProgrammeHost {
    baseline: Baseline;
    asOf: Day;
    /** `calibration.market.slope.perCostShare`, or null. */
    slope: number | null;
    presets: FundingPreset[];
    /** The open programme draft, if any. */
    draft: ProgrammeDraft | null;
    /** Why "+ What it pays for" is aria-disabled (a draft open, 24 programmes), or null. */
    addDisabled: string | null;
    /** Adds a new programme on `pool` (or opens its draft): the new row's key, or null. */
    onadd: (pool: Pool) => string | null;
    /** A draft's next state; the row's key when it became a stored programme, else null. */
    ondraft: (d: ProgrammeDraft, field: string) => string | null;
    ondiscard: () => void;
    /** Moves focus to the guarantee rate cut under "Market terms you set" (4.8a). */
    ongoterms: () => void;
    /** A programme row's selection changed: the tab ends its coalesce run (4.9). */
    onpick: () => void;
  }
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import { dayOf, firstOfMonth } from '$lib/sim/scenario/dates';
  import {
    AVERAGE_DRAWN,
    DRAW_UP_FRONT,
    MARKET_TERMS,
    missingTerms,
    resolveTerms,
    termsNeeded
  } from '$lib/sim/finance';
  import {
    INCOME_TIERS,
    type IncomeTier,
    type Instrument,
    type Programme,
    type Provenance
  } from '$lib/timelapse/types';
  import {
    CUSTOM_LINE,
    DRAFT_LINE,
    GO_TO_TERMS,
    GUARANTEE_DISABLED_DESC,
    INCOME_MIX_DESC,
    LOAN_RATE_ERROR,
    NEW_PROGRAMME,
    RESERVE_ERROR,
    RETURN_ERROR,
    SHARE_ERROR,
    TIER_ERROR,
    UNTIL_ERROR,
    YOUR_MIX_LINE,
    customLine,
    dateRangeError,
    discardName,
    drawAssumptionText,
    ratePercent,
    sourcedLine,
    typedTermText
  } from './funding-copy';
  import {
    NEW_REQUIRED_RETURN,
    fieldText,
    instrumentStart,
    isUnchanged,
    minHomesStart,
    parseMinHomes,
    parsePercent,
    parseTierPercent,
    removeProgrammeEdit,
    rescaleTiers,
    setProgrammeEdit,
    setProgrammePoolEdit,
    startTiers,
    type FieldUnit,
    type FundingEdit,
    type Parsed,
    type Refused
  } from './funding-edit';
  import type { ProgrammeField } from './funding-presets';
  import { POOL_KIND_DEFAULTS } from './funding-sources';
  import { fieldSource, programmePreview, programmeSentence, tiersSource } from './funding-view';
  import type { SimPolicy } from './policy';
  import SourceList from './SourceList.svelte';

  interface Props {
    /** A stored programme, or a draft's programme (no id). */
    prog: Programme | ProgrammeDraft['prog'];
    /** The stored id, or the id a draft replaces; null for a new draft. */
    id: string | null;
    pool: Pool;
    /** The pools "Pays from" offers (the City group), or null for no select. */
    poolChoices: Pool[] | null;
    policy: SimPolicy;
    baseline: Baseline;
    asOf: Day;
    slope: number | null;
    presets: FundingPreset[];
    selected: boolean;
    /** "Added" before the sentence (a programme on a baseline group's pool, 4.5 item 4). */
    added?: boolean;
    onselect: () => void;
    onedit: (e: FundingEdit | Refused) => void;
    /** A draft's next state; `field` is the `data-field` of the control that committed it. */
    ondraft: (d: ProgrammeDraft, field: string) => void;
    ondiscard?: () => void;
    ongoterms: () => void;
  }

  let {
    prog,
    id,
    pool,
    poolChoices,
    policy,
    baseline,
    asOf,
    slope,
    presets,
    selected,
    added = false,
    onselect,
    onedit,
    ondraft,
    ondiscard = undefined,
    ongoterms
  }: Props = $props();

  const uid = $props.id();
  let root = $state<HTMLLIElement>();

  type DraftProg = ProgrammeDraft['prog'];
  type Inst = DraftProg['instrument'];

  const MONTHS = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2000, i, 1))
    )
  );
  const LAST_MONTH: Day = dayOf(2066, 12, 1);
  const utcYear = (d: Day): number => new Date(d * 86_400_000).getUTCFullYear();
  const utcMonth = (d: Day): number => new Date(d * 86_400_000).getUTCMonth() + 1;

  const parseShare = parsePercent(0, 100, true, SHARE_ERROR);
  const parseLoanRate = parsePercent(0, 25, false, LOAN_RATE_ERROR);
  const parseReturn = parsePercent(1, 25, false, RETURN_ERROR);
  const parseReserve = parsePercent(0, 100, false, RESERVE_ERROR);

  const TIER_LABEL: Record<IncomeTier, string> = {
    veryLow: 'Very low income, %',
    low: 'Low income, %',
    moderate: 'Moderate income, %',
    aboveModerate: 'Above moderate income, %'
  };
  const REACH = [
    ['affordable', 'Affordable homes (100% affordable projects)'],
    ['market', "Private projects that don't pencil"]
  ] as const;
  const AS = [
    ['grant', 'Grant'],
    ['loan', 'Loan'],
    ['guarantee', 'Loan guarantee']
  ] as const;

  const isDraft = $derived(!('id' in prog));
  const stored = $derived(isDraft ? null : (prog as Programme));
  const inst = $derived(prog.instrument as Inst);
  const rateEmpty = $derived(inst.kind === 'loan' && inst.rate === null);

  /** The programme the views read: null while a draft's loan rate is empty. */
  const complete = $derived.by((): Programme | null => {
    if (stored !== null) return stored;
    if (rateEmpty) return null;
    return { ...(prog as DraftProg), instrument: inst as Instrument, id: id ?? '', label: '' };
  });
  /** The sentence, computed live (never the stored label). */
  const sentence = $derived(complete === null ? null : programmeSentence(complete, pool));
  /** A draft is named by the programme it replaces, while it has no sentence of its own. */
  const name = $derived.by((): string => {
    if (!isDraft && sentence !== null) return sentence;
    const was = id === null ? undefined : policy.funding.programmes.find((g) => g.id === id);
    if (was !== undefined) {
      const wasPool =
        was.pool === pool.id ? pool : (poolChoices?.find((p) => p.id === was.pool) ?? pool);
      return programmeSentence(was, wasPool);
    }
    return sentence ?? NEW_PROGRAMME;
  });

  const terms = $derived(resolveTerms(MARKET_TERMS, policy.funding.terms));
  /** No rate cut resolves: a guarantee cannot be priced or offered (4.8a). */
  const guaranteeOff = $derived(
    missingTerms({ kind: 'guarantee', costShare: 1, reserve: 0 }, terms).length > 0
  );
  const preview = $derived(
    complete === null
      ? null
      : programmePreview(complete, pool, policy.funding, baseline, asOf, slope)
  );
  /** The preview's sources, each once (the draw assumption's two entries may repeat). */
  const sources = $derived.by((): Provenance[] => {
    const all = preview?.sources ?? [];
    const key = (pv: Provenance): string => `${pv.tier}|${pv.label}`;
    return all.filter((pv, i) => all.findIndex((x) => key(x) === key(pv)) === i);
  });
  const typedTerms = $derived(
    complete === null
      ? []
      : termsNeeded(complete.instrument).filter((k) => terms.custom.includes(k))
  );

  /** Made by a preset: its id is `u-<presetId>-<n>` for a preset on the page. */
  const presetMade = $derived(
    stored !== null &&
      presets.some((p) => {
        const prefix = `u-${p.id}-`;
        return stored.id.startsWith(prefix) && /^\d+$/.test(stored.id.slice(prefix.length));
      })
  );

  // ---- field errors ----

  type Pending = { text: string; error: string; stored: unknown };
  let pending = $state<Record<string, Pending>>({});

  function pendingOf(key: string, value: unknown): Pending | null {
    const p = pending[key];
    return p !== undefined && p.stored === value ? p : null;
  }
  const errorOf = (key: string, value: unknown): string | null =>
    pendingOf(key, value)?.error ?? null;
  const textOf = (key: string, value: unknown, text: string): string =>
    pendingOf(key, value)?.text ?? text;

  /** The stored value a field's error is held against. */
  function currentOf(key: string): unknown {
    const i = inst as unknown as Record<string, unknown>;
    if (key.startsWith('tier-')) return prog.tiers?.[key.slice(5) as IncomeTier];
    switch (key) {
      case 'share':
      case 'costShare':
      case 'rate':
      case 'requiredReturn':
      case 'reserve':
        return i[key];
      case 'from':
        return prog.from;
      case 'to':
        return prog.to;
      case 'minHomes':
        return prog.minHomes;
      default:
        return undefined;
    }
  }

  // An undo or redo that rewrites a field drops its error for good (4.7).
  $effect.pre(() => {
    for (const [key, p] of Object.entries(pending)) if (currentOf(key) !== p.stored) clear(key);
  });

  function fail(key: string, text: string, error: string, value: unknown): void {
    pending[key] = { text, error, stored: value };
  }
  function clear(key: string): void {
    delete pending[key];
  }

  // ---- edits ----

  /** The programme as a draft's fields (no id, no label). */
  function asDraft(): DraftProg {
    const { id: _id, label: _label, ...rest } = prog as Programme;
    void _id;
    void _label;
    return structuredClone(rest) as DraftProg;
  }

  function toDraft(next: DraftProg, field: string): void {
    ondraft({ replaces: id, pool: next.pool, prog: next }, field);
  }

  /**
   * One change of the programme: a stored programme's edit (`path` is its field for the undo
   * label and coalesce key), or the draft's next state.
   */
  function apply(patch: Partial<DraftProg>, path: string, field: string): void {
    if (stored !== null) {
      onedit(setProgrammeEdit(policy, baseline, stored.id, patch as Partial<Programme>, path));
      return;
    }
    toDraft({ ...asDraft(), ...patch }, field);
  }

  /** Commits a number field: unchanged text is no edit; a failed check keeps the text. */
  function commitNumber(
    key: string,
    text: string,
    value: number | null | undefined,
    unit: FieldUnit,
    parse: (t: string) => Parsed,
    commit: (v: number) => void
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
    commit(r.value);
  }

  function commitPool(next: string): void {
    if (next === pool.id) return;
    if (stored !== null) onedit(setProgrammePoolEdit(policy, baseline, stored.id, next));
    else toDraft({ ...asDraft(), pool: next }, 'prog-pool');
  }

  function commitReach(reach: Programme['reach']): void {
    if (reach === prog.reach) return;
    const minHomes =
      prog.minHomes === minHomesStart(prog.reach, baseline)
        ? minHomesStart(reach, baseline)
        : prog.minHomes;
    const tiers = reach === 'market' ? null : (prog.tiers ?? startTiers(baseline));
    apply({ reach, minHomes, tiers }, 'reach', `prog-reach-${reach}`);
  }

  function commitAs(kind: Instrument['kind']): void {
    if (kind === inst.kind) return;
    const next = instrumentStart(kind, pool.kind);
    const field = `prog-as-${kind}`;
    // A loan whose rate has no source opens a draft of the stored programme (4.6).
    if (stored !== null && next.kind === 'loan' && next.rate === null) {
      toDraft({ ...asDraft(), instrument: next }, field);
      return;
    }
    apply({ instrument: next }, 'instrument.kind', field);
  }

  function commitInst(
    key: 'share' | 'costShare' | 'rate' | 'requiredReturn' | 'reserve',
    v: number | null
  ): void {
    apply({ instrument: { ...inst, [key]: v } as Inst }, `instrument.${key}`, `prog-${key}`);
  }

  function commitField(
    key: 'share' | 'costShare' | 'rate' | 'requiredReturn' | 'reserve',
    parse: (t: string) => Parsed,
    text: string
  ): void {
    const value = (inst as unknown as Record<string, number | null | undefined>)[key];
    commitNumber(key, text, value, 'fraction', parse, (v) => commitInst(key, v));
  }

  function commitReturnOn(on: boolean): void {
    if (inst.kind !== 'loan' || on === (inst.requiredReturn !== null)) return;
    commitInst('requiredReturn', on ? NEW_REQUIRED_RETURN : null);
  }

  /** The day a month select and year input pair reads, or null for an unreadable year. */
  function readDate(prefix: string): { day: Day | null; text: string } {
    const m = root?.querySelector(
      `[data-field="prog-${prefix}-month"]`
    ) as HTMLSelectElement | null;
    const y = root?.querySelector<HTMLInputElement>(`[data-field="prog-${prefix}-year"]`);
    const text = y?.value ?? '';
    const year = Number(text);
    if (!m || text.trim() === '' || !Number.isInteger(year)) return { day: null, text };
    return { day: dayOf(year, Number(m.value), 1), text };
  }
  const inRange = (d: Day | null): d is Day =>
    d !== null && d >= firstOfMonth(asOf) && d <= LAST_MONTH;

  function commitFrom(field: string): void {
    const { day, text } = readDate('from');
    if (!inRange(day)) {
      fail('from', text, dateRangeError(asOf), prog.from);
      return;
    }
    if (prog.to !== null && day >= prog.to) {
      fail('from', text, UNTIL_ERROR, prog.from);
      return;
    }
    clear('from');
    if (day !== prog.from) apply({ from: day }, 'from', field);
  }

  function setUntil(to: Day | null, text: string, field: string): void {
    if (to !== null) {
      if (!inRange(to)) {
        fail('to', text, dateRangeError(asOf), prog.to);
        return;
      }
      if (to <= prog.from) {
        fail('to', text, UNTIL_ERROR, prog.to);
        return;
      }
    }
    clear('to');
    if (to !== prog.to) apply({ to }, 'to', field);
  }

  function commitEnds(on: boolean): void {
    if (!on) {
      setUntil(null, '', 'prog-ends');
      return;
    }
    const to = Math.min(dayOf(utcYear(prog.from) + 1, utcMonth(prog.from), 1), LAST_MONTH);
    setUntil(to, String(utcYear(to)), 'prog-ends');
  }

  function commitMinHomes(text: string): void {
    commitNumber('minHomes', text, prog.minHomes, 'plain', parseMinHomes, (v) =>
      apply({ minHomes: v }, 'minHomes', 'prog-minHomes')
    );
  }

  function commitTier(k: IncomeTier, text: string): void {
    const t = prog.tiers;
    if (t === null) return;
    commitNumber(
      `tier-${k}`,
      text,
      t[k],
      'fraction',
      (s) => parseTierPercent(s, TIER_ERROR),
      (pct) => apply({ tiers: rescaleTiers(t, k, pct) }, 'tiers', `prog-tier-${k}`)
    );
  }

  /** The last text committed from a number input (handler memory, not state). */
  let lastCommit: { el: EventTarget; text: string } | null = null;

  /** A number input's handlers: `change` and Enter commit, once per typed text. */
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

  // ---- source lines (4.7, 4.8) ----

  /**
   * A field's line. A preset-made programme: every field `valueSource` covers, its source or
   * "Custom, not sourced.". A hand-made one: only the loan rate, an evidence field, has a line.
   */
  function lineFor(field: ProgrammeField): string | null {
    if (complete === null) return null;
    const s = fieldSource(complete, field, presets, pool.kind);
    if (presetMade) {
      return s.kind === 'sourced'
        ? sourcedLine(s.provenance.label, s.provenance.tier)
        : CUSTOM_LINE;
    }
    if (field !== 'instrument.rate') return null;
    if (s.kind === 'sourced') return sourcedLine(s.provenance.label, s.provenance.tier);
    const d = POOL_KIND_DEFAULTS[pool.kind].loanRate;
    return 'provenance' in d ? customLine(ratePercent(d.value), d.provenance.label) : CUSTOM_LINE;
  }

  /** The income mix's line: evidence while it equals the baseline's (or as `valueSource` says). */
  const tiersLine = $derived.by((): string | null => {
    if (complete === null || complete.tiers === null) return null;
    const s = tiersSource(complete, baseline, presets);
    if (s.kind === 'sourced') return sourcedLine(s.provenance.label, s.provenance.tier);
    return presetMade ? CUSTOM_LINE : YOUR_MIX_LINE;
  });

  /** An Unsourced loan rate's reason: the description of the empty field (4.8). */
  const rateReason = $derived.by((): string | null => {
    const d = POOL_KIND_DEFAULTS[pool.kind].loanRate;
    return 'reason' in d ? d.reason : null;
  });

  async function goTerms(): Promise<void> {
    await tick();
    ongoterms();
  }

  const muted = 'text-ink-muted dark:text-ink-dark-muted';
  const rowButton =
    'flex min-h-11 w-full flex-col items-start rounded-md px-1 py-1 text-left hover:bg-surface-raised dark:hover:bg-surface-dark-raised';
  const link =
    'min-h-6 min-w-6 rounded-md px-1 font-semibold underline aria-disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11';
  const input =
    'min-h-6 rounded-md border border-control-line bg-surface px-2 text-ink aria-invalid:border-red-800 dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark dark:aria-invalid:border-red-300 pointer-coarse:min-h-11';
  const radioLabel = 'flex min-h-6 items-center gap-1.5 pointer-coarse:min-h-11';
  const alertClass = (msg: string | null): string =>
    `text-red-800 dark:text-red-300 ${msg ? '' : 'sr-only'}`;
  const rowClass = (on: boolean): string =>
    `flex flex-col rounded-md border p-1 ${
      on
        ? 'border-accent bg-surface-raised dark:border-accent-dark dark:bg-surface-dark-raised'
        : 'border-line bg-surface dark:border-line-dark dark:bg-surface-dark'
    }`;
</script>

{#snippet alertLine(key: string, msg: string | null)}
  <p id="{uid}-{key}-err" role="alert" class={alertClass(msg)}>{msg ?? ''}</p>
{/snippet}

{#snippet sourceLine(text: string | null)}
  {#if text !== null}
    <p data-source-line class={muted}>{text}</p>
  {/if}
{/snippet}

<!-- A percent field of the instrument: label, input, alert, source line. -->
{#snippet percentField(
  key: 'share' | 'costShare' | 'rate' | 'requiredReturn' | 'reserve',
  label: string,
  parse: (t: string) => Parsed,
  path: ProgrammeField | null,
  description: string | null
)}
  {@const value = (inst as unknown as Record<string, number | null | undefined>)[key]}
  {@const err = errorOf(key, value)}
  <div class="flex flex-col gap-0.5">
    <label class="flex flex-wrap items-center gap-1">
      {label}
      <input
        type="number"
        inputmode="decimal"
        step="any"
        data-field="prog-{key}"
        class="{input} w-24"
        value={textOf(key, value, typeof value === 'number' ? fieldText(value, 'fraction') : '')}
        aria-invalid={err ? 'true' : undefined}
        aria-describedby="{description ? `${uid}-${key}-desc ` : ''}{uid}-{key}-err"
        {...typed((t) => commitField(key, parse, t))}
      />
    </label>
    {#if description}
      <p id="{uid}-{key}-desc" class={muted}>{description}</p>
    {/if}
    {@render alertLine(key, err)}
    {#if path}
      {@render sourceLine(lineFor(path))}
    {/if}
  </div>
{/snippet}

<li
  bind:this={root}
  data-prog-row={id === null ? 'draft' : id}
  class={rowClass(selected || isDraft)}
>
  {#if !isDraft}
    <button type="button" aria-pressed={selected} class={rowButton} onclick={onselect}
      >{#if added}<span class="font-medium">Added</span>{/if}
      {name}</button
    >
  {:else}
    <p class="px-1 pt-1 font-semibold">{name}</p>
    <p class="px-1 {muted}">{DRAFT_LINE}</p>
  {/if}

  {#if selected || isDraft}
    {@const fromErr = errorOf('from', prog.from)}
    {@const toErr = errorOf('to', prog.to)}
    {@const minErr = errorOf('minHomes', prog.minHomes)}
    <div data-programme-editor class="flex flex-col gap-3 px-1 pt-1 pb-2">
      {#if poolChoices !== null}
        <label class="flex flex-col items-start gap-0.5">
          Pays from
          <select
            data-field="prog-pool"
            class="{input} w-full"
            value={pool.id}
            onchange={(e) => commitPool(e.currentTarget.value)}
          >
            {#each poolChoices as p (p.id)}
              <option value={p.id}>{p.label}</option>
            {/each}
          </select>
        </label>
      {/if}

      <fieldset class="flex flex-col gap-1">
        <legend class="font-semibold">For</legend>
        {#each REACH as [value, text] (value)}
          <label class={radioLabel}>
            <input
              type="radio"
              class="size-5"
              name="{uid}-reach"
              data-field="prog-reach-{value}"
              checked={prog.reach === value}
              onchange={() => commitReach(value)}
            />
            {text}
          </label>
        {/each}
      </fieldset>

      <div class="flex flex-col items-start gap-1">
        <fieldset class="flex flex-col gap-1">
          <legend class="font-semibold">As</legend>
          {#each AS as [value, text] (value)}
            {@const off = value === 'guarantee' && guaranteeOff && inst.kind !== 'guarantee'}
            <label class={radioLabel}>
              <!-- aria-disabled, not disabled: it keeps focus, and its reason is its description;
                   a press is cancelled so the option is never chosen. -->
              <input
                type="radio"
                class="size-5 aria-disabled:opacity-40"
                name="{uid}-as"
                data-field="prog-as-{value}"
                checked={inst.kind === value}
                aria-disabled={off ? 'true' : undefined}
                aria-describedby={off ? `${uid}-guarantee-off` : undefined}
                onclick={(e) => {
                  if (off) e.preventDefault();
                }}
                onchange={() => {
                  if (!off) commitAs(value);
                }}
              />
              {text}
            </label>
          {/each}
          {#if guaranteeOff}
            <p id="{uid}-guarantee-off" class={muted}>{GUARANTEE_DISABLED_DESC}</p>
          {/if}
        </fieldset>
        {#if guaranteeOff}
          <!-- After the radio group, outside the option's description (4.8a, Focus). -->
          <button type="button" class={link} onclick={goTerms}>{GO_TO_TERMS}</button>
        {/if}
      </div>

      {#if inst.kind === 'grant'}
        {@render percentField(
          'share',
          'Grant, % of the uncovered cost',
          parseShare,
          'instrument.share',
          null
        )}
      {:else if inst.kind === 'loan'}
        {@render percentField(
          'costShare',
          'Loan, % of the building cost',
          parseShare,
          'instrument.costShare',
          null
        )}
        {@render percentField(
          'rate',
          'Loan interest rate, %',
          parseLoanRate,
          'instrument.rate',
          rateEmpty ? rateReason : null
        )}
        <div class="flex flex-col gap-1">
          <label class={radioLabel}>
            <input
              type="checkbox"
              class="size-5"
              data-field="prog-return-on"
              checked={inst.requiredReturn !== null}
              onchange={(e) => commitReturnOn(e.currentTarget.checked)}
            />
            Lender accepts a lower return
          </label>
          {#if inst.requiredReturn !== null}
            {@render percentField(
              'requiredReturn',
              'Lender accepts a lower return, %',
              parseReturn,
              'instrument.requiredReturn',
              null
            )}
          {/if}
        </div>
      {:else}
        {@render percentField(
          'costShare',
          'Guaranteed loan, % of the building cost',
          parseShare,
          'instrument.costShare',
          null
        )}
        {@render percentField('reserve', 'Reserve held, % of the loan', parseReserve, null, null)}
      {/if}

      <div class="flex flex-col gap-0.5">
        <fieldset class="flex flex-wrap items-center gap-2">
          <legend class="font-semibold">From</legend>
          <label class="flex items-center gap-1">
            <span>Month<span class="sr-only">, From</span></span>
            <select
              data-field="prog-from-month"
              class={input}
              value={String(utcMonth(prog.from))}
              aria-invalid={fromErr ? 'true' : undefined}
              aria-describedby="{uid}-from-err"
              onchange={() => commitFrom('prog-from-month')}
            >
              {#each MONTHS as m, i (i)}
                <option value={String(i + 1)}>{m}</option>
              {/each}
            </select>
          </label>
          <label class="flex items-center gap-1">
            <span>Year<span class="sr-only">, From</span></span>
            <input
              type="number"
              inputmode="numeric"
              step="1"
              data-field="prog-from-year"
              class="{input} w-24"
              value={textOf('from', prog.from, String(utcYear(prog.from)))}
              aria-invalid={fromErr ? 'true' : undefined}
              aria-describedby="{uid}-from-err"
              {...typed(() => commitFrom('prog-from-year'))}
            />
          </label>
        </fieldset>
        {@render alertLine('from', fromErr)}
        {@render sourceLine(lineFor('from'))}
      </div>

      <div class="flex flex-col gap-0.5">
        <fieldset class="flex flex-wrap items-center gap-2">
          <legend class="font-semibold">Until</legend>
          <label class={radioLabel}>
            <input
              type="checkbox"
              class="size-5"
              data-field="prog-ends"
              checked={prog.to !== null}
              aria-describedby="{uid}-to-err"
              onchange={(e) => commitEnds(e.currentTarget.checked)}
            />
            Ends
          </label>
          {#if prog.to !== null}
            {@const to = prog.to}
            <label class="flex items-center gap-1">
              <span>Month<span class="sr-only">, Until</span></span>
              <select
                data-field="prog-to-month"
                class={input}
                value={String(utcMonth(to))}
                aria-invalid={toErr ? 'true' : undefined}
                aria-describedby="{uid}-to-err"
                onchange={() => {
                  const r = readDate('to');
                  setUntil(r.day, r.text, 'prog-to-month');
                }}
              >
                {#each MONTHS as m, i (i)}
                  <option value={String(i + 1)}>{m}</option>
                {/each}
              </select>
            </label>
            <label class="flex items-center gap-1">
              <span>Year<span class="sr-only">, Until</span></span>
              <input
                type="number"
                inputmode="numeric"
                step="1"
                data-field="prog-to-year"
                class="{input} w-24"
                value={textOf('to', to, String(utcYear(to)))}
                aria-invalid={toErr ? 'true' : undefined}
                aria-describedby="{uid}-to-err"
                {...typed(() => {
                  const r = readDate('to');
                  setUntil(r.day, r.text, 'prog-to-year');
                })}
              />
            </label>
          {/if}
        </fieldset>
        {@render alertLine('to', toErr)}
        {@render sourceLine(lineFor('to'))}
      </div>

      <div class="flex flex-col gap-0.5">
        <label class="flex flex-wrap items-center gap-1">
          Projects of at least, homes
          <input
            type="number"
            inputmode="numeric"
            step="any"
            data-field="prog-minHomes"
            class="{input} w-24"
            value={textOf('minHomes', prog.minHomes, String(prog.minHomes))}
            aria-invalid={minErr ? 'true' : undefined}
            aria-describedby="{uid}-minHomes-err"
            {...typed(commitMinHomes)}
          />
        </label>
        {@render alertLine('minHomes', minErr)}
        {@render sourceLine(lineFor('minHomes'))}
      </div>

      {#if prog.reach === 'affordable' && prog.tiers !== null}
        {@const tiers = prog.tiers}
        <div class="flex flex-col gap-0.5">
          <fieldset class="flex flex-col gap-1" aria-describedby="{uid}-mix-desc">
            <legend class="font-semibold">Who the homes are for</legend>
            {#each INCOME_TIERS as k (k)}
              {@const err = errorOf(`tier-${k}`, tiers[k])}
              <label class="flex flex-wrap items-center gap-1">
                {TIER_LABEL[k]}
                <input
                  type="number"
                  inputmode="numeric"
                  step="any"
                  data-field="prog-tier-{k}"
                  class="{input} w-20"
                  value={textOf(`tier-${k}`, tiers[k], fieldText(tiers[k], 'fraction'))}
                  aria-invalid={err ? 'true' : undefined}
                  aria-describedby="{uid}-tier-{k}-err"
                  {...typed((t) => commitTier(k, t))}
                />
              </label>
              {@render alertLine(`tier-${k}`, err)}
            {/each}
          </fieldset>
          <p id="{uid}-mix-desc" class={muted}>{INCOME_MIX_DESC}</p>
          {@render sourceLine(tiersLine)}
        </div>
      {/if}

      {#if preview !== null && preview.needsTerm !== null}
        <!-- A loaded programme whose term resolves to null cannot be priced: an alert, and the
             coverage line leaves it out (4.8a). -->
        <p role="alert" class="text-red-800 dark:text-red-300">{preview.lines.join(' ')}</p>
      {:else if preview !== null}
        <div class="flex flex-col gap-0.5 {muted}">
          <p>{preview.lines.join(' ')}</p>
          {#each typedTerms as k (k)}
            <p>{typedTermText(k)}</p>
          {/each}
          {#if complete !== null && complete.instrument.kind !== 'grant'}
            <p>{drawAssumptionText(DRAW_UP_FRONT.value, AVERAGE_DRAWN.value)}</p>
          {/if}
          {#if sources.length > 0}
            <div class="text-xs"><SourceList items={sources} /></div>
          {/if}
        </div>
      {/if}

      <div>
        {#if stored !== null}
          <button
            type="button"
            data-field="prog-remove"
            class={link}
            onclick={() => onedit(removeProgrammeEdit(policy, baseline, stored.id))}
            >Remove {name}</button
          >
        {:else}
          <button type="button" data-field="prog-discard" class={link} onclick={() => ondiscard?.()}
            >{discardName(name)}</button
          >
        {/if}
      </div>
    </div>
  {/if}
</li>
