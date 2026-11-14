/**
 * Reconcile a stored schema 4 document with the dataset it is opened on (policy-timeline spec,
 * "Reconciling"): permitting presets are re-fitted, and scale entries and programmes the data
 * cannot honour are dropped and reported in today's report shapes, and spans saved on an earlier
 * dataset are re-aligned to the model months of `asOf`. It never rejects a document and
 * returns the same object when nothing changes (the house rule, funding-reconcile.ts), so the
 * compiler can treat "reconciled" as `reconcilePolicy4(doc, cal, asOf).doc === doc`. Pure TS.
 */
import { MARKET_TERMS, TYPED_TERM_RANGES, missingTerms, resolveTerms } from '$lib/sim/finance';
import type { FinanceLevers } from '$lib/sim/levers/types';
import { reconcileFunding, type FundingLoadReport } from '$lib/sim-page/funding-reconcile';
import { reconcileTiming, type TimingChange } from '$lib/sim-page/reconcile';
import { monthFirstDay, monthLastDay, monthOfDay } from '$lib/sim/world/months';
import type { Day } from '$lib/timelapse/time';
import type { Calibration, TermKey } from '$lib/timelapse/types';
import type { Effect, Policy, SimPolicy4, Span } from './policy4';

export interface Policy4Report {
  /** `change.set` is 'current' when the policy is on, 'saved' when it is off. */
  timing: { policy: string; change: TimingChange }[];
  /** Today's shape, summed over the document. */
  funding: Omit<FundingLoadReport, 'upgradedFrom'>;
  /**
   * Spans re-aligned to the dataset's model months. `index` is the span's place in the stored
   * policy; `now` is null when it was dropped.
   */
  spans: {
    policy: string;
    index: number;
    change: 'moved' | 'trimmed' | 'dropped';
    was: { from: Day; to: Day | null };
    now: { from: Day; to: Day | null } | null;
  }[];
}

/** Every term typed at its range's lower bound, so the pool checks never trip on an unsourced one. */
const ALL_TYPED = Object.fromEntries(
  (Object.keys(TYPED_TERM_RANGES) as TermKey[]).map((k) => [k, TYPED_TERM_RANGES[k][0]])
) as Record<TermKey, number>;

const same = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Snap a policy's spans to the model months of `asOf`: `from` to the first day of its month
 * (clamped to month 1), `to` to the last day of its month. A span wholly before month 1 or emptied
 * by the snap is dropped; where snapping makes consecutive spans overlap, the earlier one ends the
 * day before the later one begins (dropped when that empties it). Nothing is merged, and days
 * inside a `what` are not touched. Returns `p` itself when no span changes.
 */
function snapSpans(p: Policy, asOf: Day, out: Policy4Report['spans']): Policy {
  type Cur = { index: number; span: Span; from: Day; to: Day | null; change: 'moved' | 'trimmed' };
  const report = (c: Cur, change: 'moved' | 'trimmed' | 'dropped', now: boolean) => ({
    policy: p.id,
    index: c.index,
    change,
    was: { from: c.span.from, to: c.span.to },
    now: now ? { from: c.from, to: c.to } : null
  });
  const kept: Cur[] = [];
  const dropped: Policy4Report['spans'] = [];
  p.spans.forEach((span, index) => {
    const from = monthFirstDay(asOf, Math.max(1, monthOfDay(asOf, span.from)));
    let to: Day | null = null;
    if (span.to !== null) {
      const m = monthOfDay(asOf, span.to);
      to = m === 0 ? -Infinity : monthLastDay(asOf, m);
    }
    const cur: Cur = { index, span, from, to, change: 'moved' };
    if (to !== null && to < from) {
      dropped.push(report(cur, 'dropped', false));
      return;
    }
    while (kept.length > 0) {
      const top = kept[kept.length - 1];
      if (top.to !== null && top.to < from) break;
      top.to = from - 1;
      top.change = 'trimmed';
      if (top.to >= top.from) break;
      kept.pop();
      dropped.push(report(top, 'dropped', false));
    }
    kept.push(cur);
  });
  const changed = kept.filter((c) => c.from !== c.span.from || c.to !== c.span.to);
  if (changed.length === 0 && dropped.length === 0) return p;
  for (const c of changed) out.push(report(c, c.change, true));
  out.push(...dropped);
  const spans = kept.map((c) =>
    c.from === c.span.from && c.to === c.span.to ? c.span : { ...c.span, from: c.from, to: c.to }
  );
  return { ...p, spans };
}

function withWhat(s: Span, what: Effect): Span {
  return what === s.what ? s : { ...s, what };
}

function hasMoney(w: Effect): boolean {
  switch (w.tag) {
    case 'scales':
      return w.entries.length > 0;
    case 'fund':
      return w.pool !== null || w.programmes.length > 0;
    case 'terms':
      return Object.keys(w.terms).length > 0;
    default:
      return false;
  }
}

function reconcilePermitting(p: Policy, cal: Calibration, timing: Policy4Report['timing']): Policy {
  const set = p.on ? 'current' : 'saved';
  let unavailable = false;
  const spans = p.spans.map((s) => {
    const w = s.what;
    if (w.tag !== 'timing') return s;
    const r = reconcileTiming({ current: w.set, saved: null }, cal);
    for (const c of r.changes) {
      timing.push({ policy: p.id, change: { ...c, set } });
      if (c.kind === 'preset-unavailable' && c.preset === p.preset) unavailable = true;
    }
    return r.timing.current === w.set
      ? s
      : { ...s, what: { tag: 'timing' as const, set: r.timing.current } };
  });
  const preset = unavailable ? 'observed' : p.preset;
  if (preset === p.preset && same(spans, p.spans)) return p;
  return { ...p, preset, spans };
}

function reconcileMoneyPools(
  p: Policy,
  cal: Calibration,
  report: Policy4Report['funding']
): Policy {
  const spans = p.spans.map((s) => {
    const w = s.what;
    if (w.tag !== 'scales' && w.tag !== 'fund') return s;
    const f: FinanceLevers = {
      baselineScale: w.tag === 'scales' ? w.entries : [],
      pools: [],
      programmes: w.tag === 'fund' ? w.programmes : [],
      terms: ALL_TYPED
    };
    const r = reconcileFunding(f, cal);
    report.droppedScales.push(...r.report.droppedScales);
    report.droppedProgrammes.push(...r.report.droppedProgrammes);
    if (r.funding === f) return s;
    return withWhat(
      s,
      w.tag === 'scales'
        ? { tag: 'scales', entries: r.funding.baselineScale }
        : { ...w, programmes: r.funding.programmes }
    );
  });
  return same(spans, p.spans) ? p : { ...p, spans };
}

/**
 * The programmes (in any fund policy, on or off) that have a stretch of their policy's spans in
 * which a term they need is neither sourced nor typed by an `on` terms policy in force then. Where
 * two policies type one key, only whether the term is typed matters here, not which policy's value.
 * One entry per programme per span, naming the first missing term; `path` is the programme's
 * place in the document.
 */
export function programmeTermGaps(
  doc: SimPolicy4
): { path: string; programme: string; term: TermKey }[] {
  const termPolicies = doc.kinds.money.filter((p) => p.on && p.where.tag === 'terms');
  const cuts: number[] = [];
  for (const t of termPolicies) {
    for (const s of t.spans) {
      cuts.push(s.from);
      if (s.to !== null) cuts.push(s.to + 1);
    }
  }
  const resolvedAt = (day: number) => {
    const merged: Partial<Record<TermKey, number>> = {};
    for (const t of termPolicies) {
      const s = t.spans.find((x) => x.from <= day && (x.to === null || day <= x.to));
      if (s === undefined || s.what.tag !== 'terms') continue;
      for (const [k, v] of Object.entries(s.what.terms) as [TermKey, number][]) {
        if (!(k in merged)) merged[k] = v;
      }
    }
    return resolveTerms(MARKET_TERMS, merged);
  };

  const gaps: { path: string; programme: string; term: TermKey }[] = [];
  doc.kinds.money.forEach((p, pi) => {
    p.spans.forEach((s, si) => {
      if (s.what.tag !== 'fund') return;
      // each piece is named by its first day; the terms in force are constant across a piece
      const starts = [
        ...new Set([s.from, ...cuts.filter((c) => c > s.from && (s.to === null || c <= s.to))])
      ];
      const resolved = starts.map(resolvedAt);
      s.what.programmes.forEach((g, gi) => {
        for (const t of resolved) {
          const missing = missingTerms(g.instrument, t);
          if (missing.length > 0) {
            gaps.push({
              path: `kinds.money[${pi}].spans[${si}].what.programmes[${gi}]`,
              programme: g.id,
              term: missing[0]
            });
            break;
          }
        }
      });
    });
  });
  return gaps;
}

/** Remove the programmes the gaps name from every span of their policy, reporting each id once. */
function dropGapped(
  money: Policy[],
  gaps: ReturnType<typeof programmeTermGaps>,
  report: Policy4Report['funding']
): Policy[] {
  const dropIds = new Map<number, Map<string, TermKey>>();
  for (const g of gaps) {
    const pi = Number(/^kinds\.money\[(\d+)\]/.exec(g.path)![1]);
    const m = dropIds.get(pi) ?? new Map<string, TermKey>();
    if (!m.has(g.programme)) m.set(g.programme, g.term);
    dropIds.set(pi, m);
  }
  return money.map((p, pi) => {
    const drop = dropIds.get(pi);
    if (drop === undefined) return p;
    const spans = p.spans.map((s) => {
      const w = s.what;
      if (w.tag !== 'fund') return s;
      const kept = w.programmes.filter((g) => {
        const term = drop.get(g.id);
        if (term === undefined) return true;
        report.droppedProgrammes.push({
          id: g.id,
          label: g.label,
          pool: g.pool,
          reason: 'term',
          term
        });
        return false;
      });
      return { ...s, what: { ...w, programmes: kept } };
    });
    return { ...p, spans };
  });
}

export function reconcilePolicy4(
  doc: SimPolicy4,
  cal: Calibration,
  asOf: Day
): { doc: SimPolicy4; report: Policy4Report } {
  const timing: Policy4Report['timing'] = [];
  const funding: Policy4Report['funding'] = {
    droppedScales: [],
    droppedProgrammes: [],
    unusable: false
  };

  const snapped: Policy4Report['spans'] = [];
  const snap = (ps: Policy[]) => ps.map((p) => snapSpans(p, asOf, snapped));
  const zoning = snap(doc.kinds.zoning);
  const permittingIn = snap(doc.kinds.permitting);
  const moneyIn = snap(doc.kinds.money);

  const permitting = permittingIn.map((p) => reconcilePermitting(p, cal, timing));

  let money = moneyIn.map((p) => reconcileMoneyPools(p, cal, funding));
  // Term gaps are found on the document the pool drops left.
  const gaps = programmeTermGaps({ ...doc, kinds: { ...doc.kinds, zoning, permitting, money } });
  if (gaps.length > 0) money = dropGapped(money, gaps, funding);
  // A programme met in several spans is reported once per id and reason, a scale once per pool and day.
  funding.droppedProgrammes = funding.droppedProgrammes.filter(
    (d, i, all) => all.findIndex((e) => e.id === d.id && e.reason === d.reason) === i
  );
  funding.droppedScales = funding.droppedScales.filter(
    (d, i, all) => all.findIndex((e) => e.pool === d.pool && e.from === d.from) === i
  );
  // As reconcileFunding: the data cannot run money and some money is left after the drops.
  funding.unusable =
    (cal.market === undefined || cal.baselineFunding === undefined) &&
    money.some((p) => p.spans.some((s) => hasMoney(s.what)));

  const report = { timing, funding, spans: snapped };
  if (
    same(zoning, doc.kinds.zoning) &&
    same(permitting, doc.kinds.permitting) &&
    same(money, doc.kinds.money)
  ) {
    return { doc, report };
  }
  return { doc: { ...doc, kinds: { zoning, permitting, money } }, report };
}
