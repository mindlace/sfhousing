// The Funding tab's edits (funding-ui spec 4.5 to 4.9): one `FundingEdit` per store change, with
// its undo label and coalesce key (table 4.9), the field parsers and their messages, the limits
// alert, and the drafts that hold an unfinished pool or programme outside the policy. Pure.
//
// Every `change` returns its input unchanged when the result equals it or would not pass
// `parseFinanceLevers`, so nothing invalid or over a limit reaches the store, and `store.apply`
// ignores an edit that changes nothing. The caller adds the coalesce run suffix (`@<n>`).
import { MARKET_TERMS, missingTerms, resolveTerms, validateInstrument } from '$lib/sim/finance';
import { FINANCE_LIMITS, MAX_DOLLARS, parseFinanceLevers } from '$lib/sim/levers/finance';
import { LeverFormatError, type FinanceLevers } from '$lib/sim/levers/types';
import {
  INCOME_TIERS,
  type Day,
  type IncomeTier,
  type Inflow,
  type Instrument,
  type Pool,
  type PoolKind,
  type Programme,
  type TermKey
} from '$lib/timelapse/types';
import {
  AMOUNT_ERROR,
  GROUP_NAME,
  INFLOW_LIMIT_DESC,
  INFLOW_MIN_DESC,
  LEVERAGE_ERROR,
  MIN_HOMES_ERROR,
  NAME_ERROR,
  RATE_CUT_ERROR,
  SHORT_KIND,
  TERM_IN_USE_DESC,
  YEARS_ERROR,
  labelAmountChanged,
  labelDateChanged,
  labelIncomeMixChanged,
  labelInflowAdded,
  labelInflowKindChanged,
  labelInflowRemoved,
  labelKindChanged,
  labelOwnPoolAdded,
  labelPoolNumberChanged,
  labelPoolRemoved,
  labelPresetAdded,
  labelProgrammeAdded,
  labelProgrammeKindChanged,
  labelProgrammeNumberChanged,
  labelProgrammeRemoved,
  labelRenamed,
  labelScaleApplied,
  labelScaleRemoved,
  labelTermCleared,
  labelTermTyped,
  limitAlert,
  scaleLimitDesc
} from './funding-copy';
import { addPreset, nextAddedId, nextFiscal, type FundingPreset } from './funding-presets';
import { POOL_KIND_DEFAULTS } from './funding-sources';
import {
  groupOf,
  poolsOf,
  programmeSentence,
  type Baseline,
  type GroupId,
  type ScaleLine
} from './funding-view';
import { canonicalJson, type SimPolicy } from './policy';

/** One store change: `store.apply(edit.change, edit.label, edit.coalesce)`. */
export interface FundingEdit {
  change: (p: SimPolicy) => SimPolicy;
  label: string;
  coalesce?: string;
}

/** An edit that cannot be made; `refused` is the text the page shows. */
export type Refused = { refused: string };

export const isRefused = (x: FundingEdit | Refused | null): x is Refused =>
  x !== null && 'refused' in x;

export type Parsed<T = number> = { value: T } | { error: string };

// ---- field parsers (4.7, 4.8, 4.8a) ----

/** A finite number from a field's text, or null for empty or unreadable text. */
function numberOf(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
}

/** Rounds away the binary noise of a division (34.8251 ÷ 100 is 0.348251). */
const clean = (x: number): number => Math.round(x * 1e12) / 1e12;

/** "$ million": above 0 and at most 100,000, stored as whole dollars, at least 1. */
export function parseAmountMillions(text: string): Parsed {
  const x = numberOf(text);
  if (x === null || !(x > 0) || x > MAX_DOLLARS / 1e6) return { error: AMOUNT_ERROR };
  return { value: Math.max(1, Math.round(x * 1e6)) };
}

/**
 * A percent field from `lo` to `hi` (above `lo` when `gtLo`), stored as a fraction. Use with
 * the message of its row: share (0, 100, true), debt rate (0, 25, true), loan rate (0, 25,
 * false), lower return (1, 25, false), reserve (0, 100, false).
 */
export function parsePercent(
  lo: number,
  hi: number,
  gtLo: boolean,
  msg: string
): (text: string) => Parsed {
  return (text) => {
    const x = numberOf(text);
    if (x === null || (gtLo ? !(x > lo) : x < lo) || x > hi) return { error: msg };
    return { value: clean(x / 100) };
  };
}

/** Years to repay: a whole number from 1 to 40. */
export function parseWholeYears(text: string): Parsed {
  const x = numberOf(text);
  if (x === null || !Number.isInteger(x) || x < 1 || x > 40) return { error: YEARS_ERROR };
  return { value: x };
}

/** Dollars lent per dollar received: above 0 and at most 10. */
export function parseLeverage(text: string): Parsed {
  const x = numberOf(text);
  if (x === null || !(x > 0) || x > 10) return { error: LEVERAGE_ERROR };
  return { value: x };
}

/** Projects of at least, homes: a whole number from 0 to 10,000. */
export function parseMinHomes(text: string): Parsed {
  const x = numberOf(text);
  if (x === null || !Number.isInteger(x) || x < 0 || x > 10_000) return { error: MIN_HOMES_ERROR };
  return { value: x };
}

/** An income tier: a whole percent from 0 to 100 (the value is the percent, for `rescaleTiers`). */
export function parseTierPercent(text: string, msg: string): Parsed {
  const x = numberOf(text);
  if (x === null || !Number.isInteger(x) || x < 0 || x > 100) return { error: msg };
  return { value: x };
}

/** Guarantee rate cut in percentage points, 0 to 5; stored as the fraction. */
export function parseRateCutPoints(text: string): Parsed {
  const x = numberOf(text);
  if (x === null || x < 0 || x > 5) return { error: RATE_CUT_ERROR };
  return { value: clean(x / 100) };
}

/** A pool's name: 1 to 48 characters, trimmed. */
export function parseName(text: string): Parsed<string> {
  const t = text.trim();
  if (t.length < 1 || t.length > 48) return { error: NAME_ERROR };
  return { value: t };
}

export type FieldUnit = 'fraction' | 'millions' | 'plain';

/**
 * A stored value as its field shows it (4.7 "Precision"): a fraction × 100 with the decimals it
 * needs (0.348251 is "34.8251"), dollars in millions to six decimals (8,666,667 is "8.666667").
 */
export function fieldText(stored: number, unit: FieldUnit): string {
  if (unit === 'fraction') return String(Number((stored * 100).toFixed(10)));
  if (unit === 'millions') return String(Number((stored / 1e6).toFixed(6)));
  return String(stored);
}

/** True when committing `text` would store `stored` again: no edit (4.7 "Precision"). */
export function isUnchanged(text: string, stored: number, unit: FieldUnit): boolean {
  const x = numberOf(text);
  if (x === null) return false;
  if (unit === 'fraction') return Math.abs(x - stored * 100) <= 1e-9 * Math.max(1, Math.abs(x));
  if (unit === 'millions') return Math.round(x * 1e6) === stored;
  return x === stored;
}

// ---- limits (4.6) ----

/**
 * The 4.6 alert when adding `add` to `f` (with the open draft's items) would pass a limit of F7,
 * else null. Checked in the order pools, programmes, dated changes.
 */
export function limitProblem(
  f: FinanceLevers,
  add: { pools?: number; programmes?: number; scales?: number },
  draftCounts?: { pools: number; programmes: number }
): string | null {
  if (f.pools.length + (draftCounts?.pools ?? 0) + (add.pools ?? 0) > FINANCE_LIMITS.pools)
    return limitAlert('pools');
  if (
    f.programmes.length + (draftCounts?.programmes ?? 0) + (add.programmes ?? 0) >
    FINANCE_LIMITS.programmes
  )
    return limitAlert('programmes');
  if (f.baselineScale.length + (add.scales ?? 0) > FINANCE_LIMITS.baselineScale)
    return limitAlert('baselineScale');
  return null;
}

// ---- helpers ----

/**
 * The policy with `fn` applied to its funding; `p` itself when `fn` returns null, the result
 * equals the input, or the result does not pass `parseFinanceLevers`.
 */
function withFunding(p: SimPolicy, fn: (f: FinanceLevers) => FinanceLevers | null): SimPolicy {
  const next = fn(p.funding);
  if (next === null || canonicalJson(next) === canonicalJson(p.funding)) return p;
  try {
    parseFinanceLevers(next, 'funding');
  } catch (e) {
    if (e instanceof LeverFormatError) return p;
    throw e;
  }
  return { ...p, funding: next };
}

/** An added pool's fields replaced by `fn`; null when there is no such pool. */
function mapPool(f: FinanceLevers, id: string, fn: (x: Pool) => Pool | null): FinanceLevers | null {
  const i = f.pools.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const next = fn(f.pools[i]);
  if (next === null) return null;
  return { ...f, pools: f.pools.map((x, j) => (j === i ? next : x)) };
}

const poolName = (p: SimPolicy, id: string): string =>
  p.funding.pools.find((x) => x.id === id)?.label ?? id;

const firstDayOf = (
  inflows: readonly ({ kind: 'once'; day: Day } | { from: Day } | { day: Day })[]
) => Math.min(...inflows.map((x) => ('from' in x ? x.from : x.day)));

const utcYear = (d: Day): number => new Date(d * 86_400_000).getUTCFullYear();

/** "City bond, 2028": the short kind and the year of the first inflow (4.9). */
export function generatedName(kind: PoolKind, firstDay: Day): string {
  return `${SHORT_KIND[kind]}, ${utcYear(firstDay)}`;
}

/** The generated name of a stored pool after an edit. */
const regenerated = (x: Pool): Pool =>
  x.inflows.length === 0 ? x : { ...x, label: generatedName(x.kind, firstDayOf(x.inflows)) };

/** `x`, its name regenerated when `regenName`. */
const named = (x: Pool, regenName: boolean): Pool => (regenName ? regenerated(x) : x);

const LABEL_CHARS = FINANCE_LIMITS.labelChars;

/** A generated label within the parser's 80 characters. */
const fitLabel = (s: string): string =>
  s.length <= LABEL_CHARS ? s : `${s.slice(0, LABEL_CHARS - 1).trimEnd()}…`;

/** A programme's sentence, against its pool (baseline or added) in `f`. */
function sentence(f: FinanceLevers, baseline: Baseline | undefined, g: Programme): string {
  const pool = poolsOf(f, baseline).find((x) => x.id === g.pool) ?? {
    id: g.pool,
    kind: 'generalRevenue',
    label: g.pool,
    inflows: [],
    uncapped: false,
    debt: null,
    leverage: 1
  };
  return programmeSentence(g, pool);
}

const byPoolThenFrom = (
  a: FinanceLevers['baselineScale'][number],
  b: FinanceLevers['baselineScale'][number]
): number => (a.pool < b.pool ? -1 : a.pool > b.pool ? 1 : a.from - b.from);

// ---- pools (4.6, 4.7) ----

/** A preset in one store change, "Added: {label}"; refused over a limit of F7 (4.6). */
export function addPresetEdit(p: SimPolicy, preset: FundingPreset): FundingEdit | Refused {
  if (!preset.available) return { refused: preset.reason ?? 'Not offered.' };
  const f = p.funding;
  const scales =
    f.baselineScale.filter(
      (e) => !preset.baselineScale.some((n) => n.pool === e.pool && n.from === e.from)
    ).length + preset.baselineScale.length;
  const problem = limitProblem(f, {
    pools: preset.pools.length,
    programmes: preset.programmes.length,
    scales: scales - f.baselineScale.length
  });
  if (problem !== null) return { refused: problem };
  return {
    change: (q) =>
      withFunding(q, (g) => {
        try {
          return addPreset(g, preset);
        } catch (e) {
          if (e instanceof RangeError) return null;
          throw e;
        }
      }),
    label: labelPresetAdded(preset.label)
  };
}

/** A complete hand-made pool, "Added: your own pool"; its id is taken when it is applied. */
export function addPoolEdit(pool: Omit<Pool, 'id'>): FundingEdit {
  return {
    change: (q) =>
      withFunding(q, (f) => ({
        ...f,
        pools: [...f.pools, { ...structuredClone(pool), id: nextAddedId(f, 'pool') }]
      })),
    label: labelOwnPoolAdded()
  };
}

/** Removes an added pool and every programme that pays from it. */
export function removePoolEdit(p: SimPolicy, id: string): FundingEdit {
  const n = p.funding.programmes.filter((g) => g.pool === id).length;
  return {
    change: (q) =>
      withFunding(q, (f) => ({
        ...f,
        pools: f.pools.filter((x) => x.id !== id),
        programmes: f.programmes.filter((g) => g.pool !== id)
      })),
    label: labelPoolRemoved(poolName(p, id), n)
  };
}

/** Renames an added pool; the caller has checked the name with `parseName`. */
export function renamePoolEdit(p: SimPolicy, id: string, name: string): FundingEdit {
  const label = name.trim();
  return {
    change: (q) => withFunding(q, (f) => mapPool(f, id, (x) => ({ ...x, label }))),
    label: labelRenamed(label),
    coalesce: `pool:${id}:name`
  };
}

/**
 * Changes an added pool's kind, setting `debt` and `leverage` from `POOL_KIND_DEFAULTS` as one
 * change. Refused (with the entry's reason) when a default the kind needs is `Unsourced`: the
 * field then opens a draft. `regenName` is the page's memory that the name was never edited.
 */
export function setKindEdit(
  p: SimPolicy,
  id: string,
  kind: PoolKind,
  regenName = false
): FundingEdit | Refused {
  const def = POOL_KIND_DEFAULTS[kind];
  if (def.debt !== null && def.debt.value === null && 'reason' in def.debt)
    return { refused: def.debt.reason };
  if (kind === 'bank' && def.leverage !== null && def.leverage.value === null)
    return { refused: 'reason' in def.leverage ? def.leverage.reason : '' };
  const debt = def.debt?.value ? { ...def.debt.value } : null;
  const leverage = kind === 'bank' ? (def.leverage?.value ?? 1) : 1;
  const apply = (x: Pool): Pool => {
    const y = { ...x, kind, debt, leverage };
    return regenName ? regenerated(y) : y;
  };
  const cur = p.funding.pools.find((x) => x.id === id);
  const name = cur === undefined ? id : apply(cur).label;
  return {
    change: (q) => withFunding(q, (f) => mapPool(f, id, apply)),
    label: labelKindChanged(name, kind)
  };
}

/** A row's inflows replaced by `fn`, for row `k` (from 0); null when there is no such row. */
function mapInflow(
  f: FinanceLevers,
  id: string,
  k: number,
  fn: (x: Inflow) => Inflow | null,
  regenName = false
): FinanceLevers | null {
  return mapPool(f, id, (x) => {
    const row = x.inflows[k];
    if (row === undefined) return null;
    const next = fn(row);
    if (next === null) return null;
    const y = { ...x, inflows: x.inflows.map((r, j) => (j === k ? next : r)) };
    return regenName ? regenerated(y) : y;
  });
}

/** Sets row `k`'s (from 0) amount in whole dollars, once or a year. */
export function setInflowAmountEdit(
  p: SimPolicy,
  id: string,
  k: number,
  dollars: number
): FundingEdit {
  return {
    change: (q) =>
      withFunding(q, (f) =>
        mapInflow(f, id, k, (x) =>
          x.kind === 'once' ? { ...x, dollars } : { ...x, dollarsPerYear: dollars }
        )
      ),
    label: labelAmountChanged(poolName(p, id), k + 1, dollars),
    coalesce: `pool:${id}:in:${k + 1}:amount`
  };
}

/**
 * Turns row `k` (from 0) into a single payment or a yearly one, keeping its date and amount.
 * `regenName` regenerates the name from the first inflow's year (4.9).
 */
export function setInflowKindEdit(
  p: SimPolicy,
  id: string,
  k: number,
  kind: 'once' | 'yearly',
  regenName = false
): FundingEdit {
  return {
    change: (q) =>
      withFunding(q, (f) =>
        mapInflow(
          f,
          id,
          k,
          (x): Inflow => {
            if (x.kind === kind) return x;
            return x.kind === 'once'
              ? { kind: 'yearly', from: x.day, to: null, dollarsPerYear: x.dollars }
              : { kind: 'once', day: x.from, dollars: x.dollarsPerYear };
          },
          regenName
        )
      ),
    label: labelInflowKindChanged(poolName(p, id), k + 1, kind)
  };
}

const DATE_FIELD = { day: 'When', from: 'From', to: 'Until' } as const;

/**
 * Sets row `k`'s (from 0) date: `day` of a single payment, `from` or `to` (null: no end) of a
 * yearly one. `regenName` regenerates the name from the first inflow's year (4.9).
 */
export function setInflowDateEdit(
  p: SimPolicy,
  id: string,
  k: number,
  field: 'from' | 'to' | 'day',
  day: Day | null,
  regenName = false
): FundingEdit {
  const set = (x: Inflow): Inflow | null => {
    if (field === 'day') return x.kind === 'once' && day !== null ? { ...x, day } : null;
    if (x.kind !== 'yearly') return null;
    if (field === 'from') return day === null ? null : { ...x, from: day };
    return { ...x, to: day };
  };
  const cur = p.funding.pools.find((x) => x.id === id);
  let name = poolName(p, id);
  if (cur !== undefined && regenName) {
    const next = mapInflow({ ...p.funding, pools: [cur] }, id, k, set, true);
    if (next !== null) name = next.pools[0].label;
  }
  return {
    change: (q) => withFunding(q, (f) => mapInflow(f, id, k, set, regenName)),
    label: labelDateChanged(name, DATE_FIELD[field], day),
    coalesce: `pool:${id}:in:${k + 1}:${field}`
  };
}

/** "+ Money in": a copy of the last row; refused at 12 rows (F7). `regenName` as above. */
export function addInflowEdit(p: SimPolicy, id: string, regenName = false): FundingEdit | Refused {
  const cur = p.funding.pools.find((x) => x.id === id);
  if (cur !== undefined && cur.inflows.length >= FINANCE_LIMITS.inflowsPerPool)
    return { refused: INFLOW_LIMIT_DESC };
  return {
    change: (q) =>
      withFunding(q, (f) =>
        mapPool(f, id, (x) =>
          x.inflows.length === 0
            ? null
            : named(
                { ...x, inflows: [...x.inflows, { ...x.inflows[x.inflows.length - 1] }] },
                regenName
              )
        )
      ),
    label: labelInflowAdded(poolName(p, id))
  };
}

/** Removes row `k` (from 0); refused on a pool's only row. `regenName` as above. */
export function removeInflowEdit(
  p: SimPolicy,
  id: string,
  k: number,
  regenName = false
): FundingEdit | Refused {
  const cur = p.funding.pools.find((x) => x.id === id);
  if (cur !== undefined && cur.inflows.length <= 1) return { refused: INFLOW_MIN_DESC };
  return {
    change: (q) =>
      withFunding(q, (f) =>
        mapPool(f, id, (x) =>
          x.inflows.length <= 1 || k >= x.inflows.length
            ? null
            : named({ ...x, inflows: x.inflows.filter((_, j) => j !== k) }, regenName)
        )
      ),
    label: labelInflowRemoved(poolName(p, id), k + 1)
  };
}

/** A bond's or lease financing's rate (a fraction) or years to repay. */
export function setDebtEdit(
  p: SimPolicy,
  id: string,
  field: 'rate' | 'termYears',
  v: number
): FundingEdit {
  return {
    change: (q) =>
      withFunding(q, (f) =>
        mapPool(f, id, (x) => (x.debt === null ? null : { ...x, debt: { ...x.debt, [field]: v } }))
      ),
    label: labelPoolNumberChanged(field, poolName(p, id), v),
    coalesce: `pool:${id}:${field}`
  };
}

/** A bank's dollars lent per dollar received. */
export function setLeverageEdit(p: SimPolicy, id: string, v: number): FundingEdit {
  return {
    change: (q) =>
      withFunding(q, (f) =>
        mapPool(f, id, (x) => (x.kind !== 'bank' ? null : { ...x, leverage: v }))
      ),
    label: labelPoolNumberChanged('leverage', poolName(p, id), v),
    coalesce: `pool:${id}:leverage`
  };
}

// ---- programmes (4.8) ----

/** A complete hand-made programme, "Added: {sentence}"; its id is taken when it is applied. */
export function addProgrammeEdit(
  p: SimPolicy,
  baseline: Baseline | undefined,
  prog: Omit<Programme, 'id'>
): FundingEdit {
  const s = sentence(p.funding, baseline, { ...prog, id: '' });
  return {
    change: (q) =>
      withFunding(q, (f) => {
        const g: Programme = { ...structuredClone(prog), id: nextAddedId(f, 'prog') };
        g.label = fitLabel(sentence(f, baseline, g));
        return { ...f, programmes: [...f.programmes, g] };
      }),
    label: labelProgrammeAdded(s)
  };
}

/** Removes an added programme. */
export function removeProgrammeEdit(
  p: SimPolicy,
  baseline: Baseline | undefined,
  id: string
): FundingEdit {
  const g = p.funding.programmes.find((x) => x.id === id);
  return {
    change: (q) =>
      withFunding(q, (f) => ({ ...f, programmes: f.programmes.filter((x) => x.id !== id) })),
    label: labelProgrammeRemoved(g === undefined ? id : sentence(p.funding, baseline, g))
  };
}

/** The baseline programmes' income mix (F12), or an even split when the data has none. */
function baselineTiers(baseline: Baseline | undefined): Record<IncomeTier, number> {
  const t = baseline?.programmes.find((g) => g.reach === 'affordable')?.tiers;
  return t ? { ...t } : { veryLow: 0.25, low: 0.25, moderate: 0.25, aboveModerate: 0.25 };
}

/** The programme with `patch`; a change of reach sets `tiers` when the patch does not. */
function patched(
  g: Programme,
  patch: Partial<Omit<Programme, 'id' | 'pool'>>,
  baseline: Baseline | undefined
): Programme {
  const next: Programme = { ...g, ...structuredClone(patch) };
  if (patch.reach !== undefined && !('tiers' in patch))
    next.tiers = patch.reach === 'market' ? null : (g.tiers ?? baselineTiers(baseline));
  return next;
}

/** A hand-made programme's label follows its sentence; a preset's keeps the preset's label. */
const relabel = (f: FinanceLevers, baseline: Baseline | undefined, g: Programme): Programme =>
  /^u-prog-\d+$/.test(g.id) ? { ...g, label: fitLabel(sentence(f, baseline, g)) } : g;

/**
 * One field of an added programme (`field` is the field path, e.g. `instrument.share`): "Changed:
 * {new sentence}" with key `prog:<id>:<field>` for a number; no key for `reach` or
 * `instrument.kind`; "Changed income mix: …" for `tiers`; "Changed date: …" for `from` and `to`.
 */
export function setProgrammeEdit(
  p: SimPolicy,
  baseline: Baseline | undefined,
  id: string,
  patch: Partial<Omit<Programme, 'id' | 'pool'>>,
  field: string
): FundingEdit {
  const cur = p.funding.programmes.find((x) => x.id === id);
  const s = cur === undefined ? id : sentence(p.funding, baseline, patched(cur, patch, baseline));
  const change = (q: SimPolicy) =>
    withFunding(q, (f) => {
      const i = f.programmes.findIndex((x) => x.id === id);
      if (i < 0) return null;
      const g = relabel(f, baseline, patched(f.programmes[i], patch, baseline));
      return { ...f, programmes: f.programmes.map((x, j) => (j === i ? g : x)) };
    });
  const key = `prog:${id}:${field}`;
  if (field === 'tiers') return { change, label: labelIncomeMixChanged(s), coalesce: key };
  if (field === 'reach' || field === 'instrument.kind')
    return { change, label: labelProgrammeKindChanged(s) };
  if (field === 'from' || field === 'to') {
    const day = field === 'from' ? (patch.from ?? null) : (patch.to ?? null);
    return {
      change,
      label: labelDateChanged(s, field === 'from' ? 'From' : 'Until', day),
      coalesce: key
    };
  }
  return { change, label: labelProgrammeNumberChanged(s), coalesce: key };
}

/** Moves an added programme to another pool ("Pays from", 4.5 item 4): "Changed: {sentence}". */
export function setProgrammePoolEdit(
  p: SimPolicy,
  baseline: Baseline | undefined,
  id: string,
  pool: string
): FundingEdit {
  const cur = p.funding.programmes.find((x) => x.id === id);
  const s = cur === undefined ? id : sentence(p.funding, baseline, { ...cur, pool });
  return {
    change: (q) =>
      withFunding(q, (f) => {
        const i = f.programmes.findIndex((x) => x.id === id);
        if (i < 0) return null;
        const g = relabel(f, baseline, { ...f.programmes[i], pool });
        return { ...f, programmes: f.programmes.map((x, j) => (j === i ? g : x)) };
      }),
    label: labelProgrammeKindChanged(s)
  };
}

/**
 * Sets one income tier to `pct` whole percent; the others take the rest in proportion to their
 * current values (evenly when they are all 0), by largest remainder with ties to the earlier
 * tier: the timers' route-share rule. Takes and returns fractions (whole percents ÷ 100).
 */
export function rescaleTiers(
  t: Record<IncomeTier, number>,
  changed: IncomeTier,
  pct: number
): Record<IncomeTier, number> {
  const v = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  const others = INCOME_TIERS.filter((k) => k !== changed);
  const sum = others.reduce((s, k) => s + Math.max(0, t[k]), 0);
  const rest = 100 - v;
  const exact = others.map((k) =>
    sum > 0 ? (Math.max(0, t[k]) / sum) * rest : rest / others.length
  );
  const whole = exact.map((x) => Math.floor(x + 1e-9));
  let left = rest - whole.reduce((s, x) => s + x, 0);
  const order = exact
    .map((x, i) => ({ i, r: x - whole[i] }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    whole[i]++;
    left--;
  }
  const out = { [changed]: v / 100 } as Record<IncomeTier, number>;
  others.forEach((k, i) => (out[k] = whole[i] / 100));
  return Object.fromEntries(INCOME_TIERS.map((k) => [k, out[k]])) as Record<IncomeTier, number>;
}

/** Tier 4 UI default: a new programme's grant, the City's share of today's home (4.8). */
const NEW_GRANT_SHARE = 0.35;

/** Tier 4 UI starting points of 4.8: a loan's or guarantee's 60% of cost, 10% reserve, 5.25%. */
export const NEW_COST_SHARE = 0.6;
export const NEW_RESERVE = 0.1;
export const NEW_REQUIRED_RETURN = 0.0525;
/** A private programme's smallest project: the inclusionary threshold (4.8). */
export const PRIVATE_MIN_HOMES = 10;

/**
 * The instrument a programme starts with when its "As" changes to `kind` (4.8): a grant at 35%;
 * a loan of 60% of cost at `POOL_KIND_DEFAULTS[poolKind].loanRate` (rate null while that is
 * `Unsourced`: a draft), no lower return; a guarantee of 60% with a 10% reserve.
 */
export function instrumentStart(
  kind: Instrument['kind'],
  poolKind: PoolKind
): Instrument | LoanWithoutRate {
  switch (kind) {
    case 'grant':
      return { kind: 'grant', share: NEW_GRANT_SHARE };
    case 'loan':
      return {
        kind: 'loan',
        costShare: NEW_COST_SHARE,
        rate: POOL_KIND_DEFAULTS[poolKind].loanRate.value,
        requiredReturn: null
      } as Instrument | LoanWithoutRate;
    case 'guarantee':
      return { kind: 'guarantee', costShare: NEW_COST_SHARE, reserve: NEW_RESERVE };
  }
}

/** The smallest project a reach starts with: the baseline programmes' for affordable, 10 private. */
export function minHomesStart(reach: Programme['reach'], baseline: Baseline | undefined): number {
  if (reach === 'market') return PRIVATE_MIN_HOMES;
  return baseline?.programmes.find((g) => g.reach === 'affordable')?.minHomes ?? 0;
}

/** The baseline programmes' income mix (F12), for a new or a re-reached programme. */
export const startTiers = (baseline: Baseline | undefined): Record<IncomeTier, number> =>
  baselineTiers(baseline);

/**
 * A new programme on `pool` (4.8): a grant to affordable homes at 35% of the uncovered cost,
 * from the pool's first inflow, with the baseline programmes' tiers and `minHomes`. A pool with no
 * inflows (the uncapped tax-credit pool) starts at its baseline programme's `from`.
 */
export function newProgramme(pool: Pool, baseline: Baseline): Omit<Programme, 'id'> {
  const base = baseline.programmes.find((g) => g.reach === 'affordable');
  const from =
    pool.inflows.length > 0
      ? firstDayOf(pool.inflows)
      : (baseline.programmes.find((g) => g.pool === pool.id)?.from ??
        base?.from ??
        baseline.programmes[0].from);
  const g: Omit<Programme, 'id'> = {
    label: '',
    pool: pool.id,
    reach: 'affordable',
    instrument: { kind: 'grant', share: NEW_GRANT_SHARE },
    from,
    to: null,
    minHomes: base?.minHomes ?? 0,
    tiers: baselineTiers(baseline)
  };
  return { ...g, label: fitLabel(programmeSentence({ ...g, id: '' }, pool)) };
}

// ---- dated changes (4.5 item 3) ----

/**
 * A dated change on a baseline group (one entry per pool of the group, the City group's pools
 * all at once) or on one baseline pool. An entry on a pool and day that already has one
 * replaces it; `baselineScale` stays sorted by pool, then `from`. Refused when the entries it
 * adds would pass 24.
 */
export function addScaleEdit(
  p: SimPolicy,
  baseline: Baseline,
  target: { group: GroupId } | { pool: string },
  from: Day,
  scale: number
): FundingEdit | Refused {
  const pools =
    'group' in target
      ? baseline.pools.filter((x) => groupOf(x.kind) === target.group)
      : baseline.pools.filter((x) => x.id === target.pool);
  if (pools.length === 0) return { refused: 'This data has no such source.' };
  const ids = new Set(pools.map((x) => x.id));
  const f = p.funding;
  const replaced = f.baselineScale.filter((e) => ids.has(e.pool) && e.from === from).length;
  const needs = pools.length - replaced;
  if (f.baselineScale.length + needs > FINANCE_LIMITS.baselineScale)
    return { refused: scaleLimitDesc(needs) };
  // The name `scaleLines` gives the entry: the City group's pools move as one "City money".
  const name =
    'group' in target && target.group === 'city'
      ? 'City money'
      : pools.length === 1
        ? pools[0].label
        : GROUP_NAME[(target as { group: GroupId }).group];
  return {
    change: (q) =>
      withFunding(q, (g) => ({
        ...g,
        baselineScale: [
          ...g.baselineScale.filter((e) => !(ids.has(e.pool) && e.from === from)),
          ...pools.map((x) => ({ pool: x.id, from, scale }))
        ].sort(byPoolThenFrom)
      })),
    label: labelScaleApplied(
      name,
      from,
      scale,
      pools.every((x) => x.uncapped)
    )
  };
}

/** Removes a dated-change line: every entry it stands for, as one change. */
export function removeScaleEdit(line: ScaleLine): FundingEdit {
  const ids = new Set(line.pools);
  return {
    change: (q) =>
      withFunding(q, (f) => ({
        ...f,
        baselineScale: f.baselineScale.filter((e) => !(ids.has(e.pool) && e.from === line.from))
      })),
    label: labelScaleRemoved(line.name, line.from)
  };
}

// ---- market terms (4.8a) ----

/** A typed market term, stored as the fraction (0.5 points is 0.005). */
export function setTermEdit(key: TermKey, fraction: number): FundingEdit {
  return {
    change: (q) => withFunding(q, (f) => ({ ...f, terms: { ...f.terms, [key]: fraction } })),
    label: labelTermTyped(key, fraction),
    coalesce: `term:${key}`
  };
}

/** Clears a typed term; refused while a programme in the policy needs it. */
export function clearTermEdit(p: SimPolicy, key: TermKey): FundingEdit | Refused {
  const without = (f: FinanceLevers): FinanceLevers['terms'] => {
    const t = { ...f.terms };
    delete t[key];
    return t;
  };
  const resolved = resolveTerms(MARKET_TERMS, without(p.funding));
  if (p.funding.programmes.some((g) => missingTerms(g.instrument, resolved).includes(key)))
    return { refused: TERM_IN_USE_DESC };
  return {
    change: (q) => withFunding(q, (f) => ({ ...f, terms: without(f) })),
    label: labelTermCleared(key)
  };
}

// ---- drafts (4.6) ----

type EmptyInflow = { kind: 'once' | 'yearly'; empty: true; day: Day };

/** An unfinished pool: page state, outside the policy. */
export type PoolDraft = {
  kind: PoolKind;
  label: string;
  /** The page's memory that the user typed the name: it then stops regenerating. */
  labelEdited: boolean;
  inflows: (Inflow | EmptyInflow)[];
  /** Null for a kind without debt; `rate` null while it has no value. */
  debt: { rate: number | null; termYears: number } | null;
  /** A bank's lending per dollar, null while empty; null (meaning 1) for every other kind. */
  leverage: number | null;
};

export type LoanWithoutRate = Omit<Extract<Instrument, { kind: 'loan' }>, 'rate'> & { rate: null };

/** An unfinished programme, or a stored one (`replaces`) whose new instrument needs a value. */
export type ProgrammeDraft = {
  replaces: string | null;
  pool: string;
  prog: Omit<Programme, 'id' | 'label' | 'instrument'> & {
    instrument: Instrument | LoanWithoutRate;
  };
};

export type Draft = { kind: 'pool'; pool: PoolDraft } | { kind: 'programme'; prog: ProgrammeDraft };

/** The debt and leverage a kind starts with; an `Unsourced` value is left empty. */
function kindStart(kind: PoolKind): Pick<PoolDraft, 'debt' | 'leverage'> {
  const def = POOL_KIND_DEFAULTS[kind];
  const debt =
    def.debt === null
      ? null
      : def.debt.value === null
        ? { rate: null, termYears: 20 }
        : { ...def.debt.value };
  const leverage = kind === 'bank' ? (def.leverage === null ? 1 : def.leverage.value) : null;
  return { debt, leverage };
}

/** "Your own pool" (4.6): a City general fund pool, one yearly row from next July, no amount. */
export function newOwnPool(asOf: Day): PoolDraft {
  const day = nextFiscal(asOf);
  return {
    kind: 'generalRevenue',
    label: generatedName('generalRevenue', day),
    labelEdited: false,
    inflows: [{ kind: 'yearly', empty: true, day }],
    ...kindStart('generalRevenue')
  };
}

/**
 * A draft pool with `patch`: a new kind resets `debt` and `leverage` from `POOL_KIND_DEFAULTS`;
 * a typed `label` marks the name edited; until then the name follows the kind and first year.
 */
export function updatePoolDraft(
  d: PoolDraft,
  patch: Partial<Omit<PoolDraft, 'labelEdited'>>
): PoolDraft {
  const next: PoolDraft = { ...d, ...patch };
  if (patch.kind !== undefined && patch.kind !== d.kind) Object.assign(next, kindStart(patch.kind));
  if (patch.debt !== undefined) next.debt = patch.debt;
  if (patch.leverage !== undefined) next.leverage = patch.leverage;
  if (patch.label !== undefined) next.labelEdited = true;
  else if (!next.labelEdited && next.inflows.length > 0)
    next.label = generatedName(next.kind, firstDayOf(next.inflows));
  return next;
}

/** The pool a complete draft stands for, or null while a field is empty or invalid. */
function draftPool(d: PoolDraft): Omit<Pool, 'id'> | null {
  if (d.inflows.length === 0 || d.inflows.some((x) => 'empty' in x)) return null;
  const name = parseName(d.label);
  if ('error' in name) return null;
  const needsDebt = d.kind === 'goBond' || d.kind === 'cop';
  if (needsDebt && (d.debt === null || d.debt.rate === null)) return null;
  if (d.kind === 'bank' && d.leverage === null) return null;
  return {
    kind: d.kind,
    label: name.value,
    inflows: (d.inflows as Inflow[]).map((x) => ({ ...x })),
    uncapped: false,
    debt: needsDebt ? { rate: d.debt!.rate!, termYears: d.debt!.termYears } : null,
    leverage: d.kind === 'bank' ? d.leverage! : 1
  };
}

/**
 * The store change that adds a complete draft ("Added: your own pool", "Added: {sentence}", or
 * "Changed: {sentence}" for an instrument change of a stored programme), or null while a
 * required field is empty or the item would not pass `parseFinanceLevers` on `p`.
 */
export function completeDraft(
  d: Draft,
  p: SimPolicy,
  baseline: Baseline | undefined
): FundingEdit | null {
  if (d.kind === 'pool') {
    const pool = draftPool(d.pool);
    if (pool === null) return null;
    const e = addPoolEdit(pool);
    return e.change(p) === p ? null : e;
  }
  const { replaces, pool, prog } = d.prog;
  const inst = prog.instrument;
  if (inst.kind === 'loan' && inst.rate === null) return null;
  if (validateInstrument(inst as Instrument) !== null) return null;
  const g: Omit<Programme, 'id'> = {
    label: '',
    pool,
    reach: prog.reach,
    instrument: { ...(inst as Instrument) },
    from: prog.from,
    to: prog.to,
    minHomes: prog.minHomes,
    tiers: prog.tiers === null ? null : { ...prog.tiers }
  };
  if (replaces === null) {
    const e = addProgrammeEdit(p, baseline, g);
    return e.change(p) === p ? null : e;
  }
  const cur = p.funding.programmes.find((x) => x.id === replaces);
  if (cur === undefined) return null;
  const next = (f: FinanceLevers): Programme =>
    relabel(f, baseline, { ...g, id: replaces, label: cur.label });
  const e: FundingEdit = {
    change: (q) =>
      withFunding(q, (f) => ({
        ...f,
        programmes: f.programmes.map((x) => (x.id === replaces ? next(f) : x))
      })),
    label: labelProgrammeKindChanged(sentence(p.funding, baseline, next(p.funding)))
  };
  return e.change(p) === p ? null : e;
}
