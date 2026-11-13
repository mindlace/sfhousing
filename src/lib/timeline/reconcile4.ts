/**
 * Reconcile a stored schema 4 document with the dataset it is opened on (policy-timeline spec,
 * "Reconciling"): permitting presets are re-fitted, and scale entries and programmes the data
 * cannot honour are dropped and reported in today's report shapes. It never rejects a document and
 * returns the same object when nothing changes (the house rule, funding-reconcile.ts), so the
 * compiler can treat "reconciled" as `reconcilePolicy4(doc, cal).doc === doc`. Pure TS.
 */
import { MARKET_TERMS, missingTerms, resolveTerms } from '$lib/sim/finance';
import type { FinanceLevers } from '$lib/sim/levers/types';
import { reconcileFunding, type FundingLoadReport } from '$lib/sim-page/funding-reconcile';
import { reconcileTiming, type TimingChange } from '$lib/sim-page/reconcile';
import type { Calibration, TermKey } from '$lib/timelapse/types';
import type { Effect, Policy, SimPolicy4, Span } from './policy4';

export interface Policy4Report {
  /** `change.set` is 'current' when the policy is on, 'saved' when it is off. */
  timing: { policy: string; change: TimingChange }[];
  /** Today's shape, summed over the document. */
  funding: Omit<FundingLoadReport, 'upgradedFrom'>;
}

/** Valid values for every term, so the pool checks never trip on an unsourced one. */
const ALL_TYPED: Record<TermKey, number> = {
  constructionRate: 0.05,
  constructionYears: 2,
  requiredReturn: 0.1,
  guaranteeRateCut: 0.01,
  lossOnExit: 0.5
};

const same = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

function withWhat(s: Span, what: Effect): Span {
  return what === s.what ? s : { ...s, what };
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
 * two policies type one key, the lower in the list wins (rule 11's order, as the compiler merges).
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
  cal: Calibration
): { doc: SimPolicy4; report: Policy4Report } {
  const timing: Policy4Report['timing'] = [];
  const funding: Policy4Report['funding'] = {
    droppedScales: [],
    droppedProgrammes: [],
    unusable: false
  };

  const permitting = doc.kinds.permitting.map((p) => reconcilePermitting(p, cal, timing));

  let money = doc.kinds.money;
  if (cal.baselineFunding === undefined) {
    // The data cannot run money: kept, not used, nothing dropped.
    funding.unusable = money.some((p) => p.spans.length > 0);
  } else {
    money = money.map((p) => reconcileMoneyPools(p, cal, funding));
    // Term gaps are found on the document the pool drops left.
    const gaps = programmeTermGaps({ ...doc, kinds: { ...doc.kinds, money } });
    if (gaps.length > 0) money = dropGapped(money, gaps, funding);
    if (cal.market === undefined) funding.unusable = money.some((p) => p.spans.length > 0);
  }
  // A programme met in several spans is reported once per id and reason.
  funding.droppedProgrammes = funding.droppedProgrammes.filter(
    (d, i, all) => all.findIndex((e) => e.id === d.id && e.reason === d.reason) === i
  );

  const report = { timing, funding };
  if (same(permitting, doc.kinds.permitting) && same(money, doc.kinds.money)) {
    return { doc, report };
  }
  return { doc: { ...doc, kinds: { ...doc.kinds, permitting, money } }, report };
}
