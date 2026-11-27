/**
 * What "+" offers on each kind and the policy it adds (timeline-ui spec, rule 12). Today's add
 * actions are reused through schema 3: a `SimPolicy` with the action applied is upgraded and the
 * policies it gives are renamed clear of the document's ids, start on the playhead's month with no
 * end, and are appended to the kind. Where today's action leaves schema 3 empty (an empty painted
 * area, observed timing, a baseline or terms policy with nothing typed yet) the policy is built
 * directly. Pure TS.
 */
import { FREE_MEASURES, OPEN_LIMITS, isGiven, type Limits } from '$lib/game/limits';
import type { LimitKind } from '$lib/sim-page/funding-copy';
import { DEFAULT_POLICY, type SimPolicy } from '$lib/sim-page/policy';
import { addPreset, dateMeasure, fundingPresets, nextAddedId } from '$lib/sim-page/funding-presets';
import { PRESETS, resolvePreset, timingLabel, type PresetId } from '$lib/sim-page/timing';
import { newLayer } from '$lib/sim-page/transit-edit';
import { FINANCE_LIMITS } from '$lib/sim/levers/finance';
import type { FinanceLevers } from '$lib/sim/levers/types';
import { monthFirstDay } from '$lib/sim/world/months';
import type { Calibration, Pool } from '$lib/timelapse/types';
import { CUSTOM_TIMING_LABEL } from './lens';
import type { Effect, Policy, PolicyKind, Selector, SimPolicy4 } from './policy4';
import type { SpanRef, TimelineWindow } from './spans';
import { upgradePolicy } from './upgrade';

type Category = 'rentControl' | 'historic' | 'newerThan';

export type AddChoice =
  // One member per `what`, so a check on `what` narrows the choice.
  | { kind: 'zoning'; what: 'transit' }
  | { kind: 'zoning'; what: 'paint' }
  | { kind: 'zoning'; what: 'protect'; category: Category }
  | { kind: 'permitting'; what: 'preset'; preset: PresetId }
  | { kind: 'permitting'; what: 'custom' }
  | { kind: 'money'; what: 'preset'; preset: string }
  /** A complete own pool, from the Inspector's pool draft (ruling on Task 5). */
  | { kind: 'money'; what: 'fund'; pool: Omit<Pool, 'id'> }
  | { kind: 'money'; what: 'baseline' }
  | { kind: 'money'; what: 'terms' };

/**
 * What the "+" menu lists: an `AddChoice`, or `ownPool`, which opens a pool draft; the draft, once
 * complete, is added as `{ kind: 'money', what: 'fund', pool }`.
 */
export type AddOffer = AddChoice | { kind: 'money'; what: 'ownPool' };

/** Today's starting years for "Protect buildings newer than" (ProtectionsSection's DEFAULT_YEARS). */
const NEWER_THAN_YEARS = 30;

/** An add past a `FINANCE_LIMITS` bound over the document; `limit` names which (today's texts). */
export class AddLimitError extends RangeError {
  constructor(readonly limit: LimitKind) {
    super(`past the ${limit} limit`);
  }
}

/** Added pools over the document, as the pool limit counts them. */
export const poolCount = (doc: SimPolicy4): number => documentFunding(doc).pools.length;

const PROTECT_LABELS: Record<Category, string> = {
  rentControl: 'Protect rent-controlled buildings',
  historic: 'Protect historic buildings',
  newerThan: `Protect buildings newer than ${NEWER_THAN_YEARS} years`
};

/** The data can run money (rule 8; the condition the Funding tab is shown on today). */
const hasMoney = (cal: Calibration): boolean =>
  cal.market !== undefined && cal.baselineFunding !== undefined;

/** "+" opens on this kind: something in it can be added. */
export function kindOpen(kind: PolicyKind, limits: Limits): boolean {
  const all = limits.open || limits.whole;
  switch (kind) {
    case 'zoning':
      return all || limits.stops.size > 0;
    case 'permitting':
      return all;
    case 'money':
      return all || limits.money;
  }
}

export function addChoices(
  kind: PolicyKind,
  cal: Calibration,
  doc: SimPolicy4,
  limits: Limits = OPEN_LIMITS
): { choice: AddOffer; label: string }[] {
  if (!kindOpen(kind, limits)) return [];
  switch (kind) {
    case 'zoning': {
      const has = (c: Category) =>
        doc.kinds.zoning.some((p) => p.where.tag === 'category' && p.where.category === c);
      const all = limits.open || limits.whole;
      return [
        ...(all ? [{ choice: { kind, what: 'transit' as const }, label: 'Transit rule' }] : []),
        ...(limits.open
          ? [{ choice: { kind, what: 'paint' as const }, label: 'Painted area' }]
          : []),
        ...(['rentControl', 'historic', 'newerThan'] as const)
          .filter((c) => !has(c))
          .map((category) => ({
            choice: { kind, what: 'protect' as const, category },
            label: PROTECT_LABELS[category]
          }))
      ];
    }
    case 'permitting':
      return [
        // Observed timing is the fixed row, not an addition.
        ...PRESETS.filter((p) => p.available && p.id !== 'observed').map((p) => ({
          choice: { kind, what: 'preset' as const, preset: p.id },
          label: p.name
        })),
        { choice: { kind, what: 'custom' as const }, label: CUSTOM_TIMING_LABEL }
      ];
    case 'money': {
      if (!hasMoney(cal)) return [];
      // In a game before the end, only the free measures; kindOpen made `money` true.
      const given = fundingPresets(cal)
        .filter((p) => p.available)
        .filter((p) => limits.open || limits.whole || FREE_MEASURES.includes(p.id))
        .map((p) => ({
          choice: { kind, what: 'preset' as const, preset: p.id },
          label: p.label
        }));
      if (!limits.open && !limits.whole) return given;
      return [
        ...given,
        { choice: { kind, what: 'ownPool' }, label: 'Your own pool' },
        { choice: { kind, what: 'baseline' }, label: 'City funding scale' },
        { choice: { kind, what: 'terms' }, label: 'Market terms' }
      ];
    }
  }
}

const allPolicies = (doc: SimPolicy4): Policy[] => [
  ...doc.kinds.zoning,
  ...doc.kinds.permitting,
  ...doc.kinds.money
];

/** The document's added pools, programmes and scale entries, as one `FinanceLevers` (for ids and limits). */
function documentFunding(doc: SimPolicy4): FinanceLevers {
  const f: FinanceLevers = { baselineScale: [], pools: [], programmes: [], terms: {} };
  for (const p of doc.kinds.money) {
    if (p.where.tag === 'fund' && p.where.pool.startsWith('u-') && p.spans.length === 0)
      f.pools.push({ id: p.where.pool } as Pool);
    // Every span of a fund policy names the same pool and programmes; scale entries are per span.
    const s = p.spans[0];
    if (s?.what.tag === 'fund') {
      if (s.what.pool) f.pools.push(s.what.pool);
      f.programmes.push(...s.what.programmes);
    }
    for (const t of p.spans) if (t.what.tag === 'scales') f.baselineScale.push(...t.what.entries);
  }
  return f;
}

/** A policy built directly, for an action schema 3 cannot carry. */
function direct(
  id: string,
  label: string,
  where: Selector,
  what: Effect,
  preset: string | null = null
): Policy {
  return { id, label, preset, on: true, where, spans: [{ from: 0, to: null, what }] };
}

/** The new policies for `choice`, ids not yet renamed and spans not yet dated. */
function created(doc: SimPolicy4, choice: AddChoice, cal: Calibration): Policy[] {
  const p3: SimPolicy = structuredClone(DEFAULT_POLICY);
  const upgraded = () => upgradePolicy(p3, cal.asOf).kinds[choice.kind];
  switch (choice.kind) {
    case 'zoning':
      if (choice.what === 'transit') {
        p3.rules = [newLayer()];
        return upgraded();
      }
      if (choice.what === 'paint')
        return [
          direct('painted', 'Painted zoning', { tag: 'painted' }, { tag: 'brushes', brushes: [] })
        ];
      if (choice.category === 'newerThan') p3.protect.newerThanYears = NEWER_THAN_YEARS;
      else p3.protect[choice.category] = true;
      return upgraded();
    case 'permitting': {
      p3.timing.current =
        choice.what === 'preset' ? resolvePreset(choice.preset, cal) : p3.timing.current;
      const got = upgraded();
      if (got.length > 0) return got;
      // Observed timing: schema 3 holds it as "no change", so build the policy.
      const set = p3.timing.current;
      const label = choice.what === 'custom' ? CUSTOM_TIMING_LABEL : timingLabel(set);
      return [direct('timing', label, { tag: 'routes' }, { tag: 'timing', set }, set.preset)];
    }
    case 'money': {
      if (choice.what === 'baseline')
        return [
          direct(
            'baseline',
            'City funding scale',
            { tag: 'baseline' },
            { tag: 'scales', entries: [] }
          )
        ];
      if (choice.what === 'terms')
        return [direct('terms', 'Market terms', { tag: 'terms' }, { tag: 'terms', terms: {} })];
      const have = documentFunding(doc);
      if (choice.what === 'fund') {
        // As addPreset: past the pool limit over the document, a RangeError.
        if (have.pools.length + 1 > FINANCE_LIMITS.pools) throw new AddLimitError('pools');
        p3.funding.pools = [{ ...structuredClone(choice.pool), id: nextAddedId(have, 'pool') }];
        return upgraded();
      }
      const preset = fundingPresets(cal).find((x) => x.id === choice.preset && x.available);
      if (preset === undefined) throw new Error(`funding preset ${choice.preset} is not offered`);
      // Ids clear of the document's, limits over the document. Pools and programmes add up;
      // what addPreset still refuses past them is the scale limit (an entry may replace one).
      if (have.pools.length + preset.pools.length > FINANCE_LIMITS.pools)
        throw new AddLimitError('pools');
      if (have.programmes.length + preset.programmes.length > FINANCE_LIMITS.programmes)
        throw new AddLimitError('programmes');
      let all: FinanceLevers;
      try {
        all = addPreset(have, preset);
      } catch (e) {
        if (e instanceof RangeError) throw new AddLimitError('baselineScale');
        throw e;
      }
      const old = new Set([...have.pools.map((x) => x.id), ...have.programmes.map((g) => g.id)]);
      p3.funding = {
        baselineScale: preset.baselineScale.map((e) => ({ ...e })),
        pools: all.pools.filter((x) => !old.has(x.id)),
        programmes: all.programmes.filter((g) => !old.has(g.id)),
        terms: {}
      };
      // A given measure: every policy names its preset and carries the preset's label.
      return upgraded().map((p) => ({ ...p, preset: preset.id, label: preset.label }));
    }
  }
}

/**
 * Adds the policy `choice` stands for, starting on `month` (clamped to the window) with no end, at
 * the end of its kind's list. `ref` is the first new policy's span: the one to select.
 */
export function addPolicy(
  doc: SimPolicy4,
  choice: AddChoice,
  ctx: { w: TimelineWindow; month: number; cal: Calibration }
): { doc: SimPolicy4; ref: SpanRef } {
  const month = Math.min(ctx.w.months, Math.max(1, Math.round(ctx.month)));
  const from = monthFirstDay(ctx.w.asOf, month);
  const used = new Set(allPolicies(doc).map((p) => p.id));
  const idFor = (want: string): string => {
    let id = want;
    for (let n = 2; used.has(id); n++) id = `${want}-${n}`;
    used.add(id);
    return id;
  };
  const dated = created(doc, choice, ctx.cal).map((p) => ({
    ...p,
    id: idFor(p.id),
    spans: p.spans.map((s) => ({ ...s, from, to: null }))
  }));
  // A given measure's money follows its first span's start (M1).
  const added =
    choice.kind === 'money' && choice.what === 'preset'
      ? dated.map((p) => dateMeasure(p, ctx.cal))
      : dated;
  if (added.length === 0) throw new Error(`nothing to add for ${JSON.stringify(choice)}`);
  return {
    doc: { ...doc, kinds: { ...doc.kinds, [choice.kind]: [...doc.kinds[choice.kind], ...added] } },
    ref: { kind: choice.kind, id: added[0].id, span: 0 }
  };
}

/**
 * `after` with each given measure whose first span's `from` moved since `before` re-dated;
 * `after` itself when none moved.
 */
export function redateMoved(before: SimPolicy4, after: SimPolicy4, cal: Calibration): SimPolicy4 {
  const was = new Map(before.kinds.money.map((p) => [p.id, p]));
  let changed = false;
  const money = after.kinds.money.map((p) => {
    const old = was.get(p.id);
    if (!isGiven(p) || old === undefined || old.spans[0]?.from === p.spans[0]?.from) return p;
    const next = dateMeasure(p, cal);
    if (next !== p) changed = true;
    return next;
  });
  return changed ? { ...after, kinds: { ...after.kinds, money } } : after;
}
