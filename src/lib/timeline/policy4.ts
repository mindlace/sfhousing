/**
 * Schema 4 policy document (policy-timeline spec S10): three kinds of policies, each a selector,
 * an effect and spans of days it is in force. Pure TS: no Svelte, no DOM.
 */
import type { StopType, BrushQuery } from '$lib/sim/levers/brushes';
import {
  customQuery,
  queryKey,
  ruleQueries,
  type CustomBrush,
  type TransitBand
} from '$lib/sim-page/policy';
import type { TimingSet } from '$lib/sim-page/timing';
import type { Day } from '$lib/timelapse/time';
import type { Pool, Programme, TermKey } from '$lib/timelapse/types';

export type Selector =
  | { tag: 'transit'; stopTypes: StopType[] }
  | { tag: 'painted' }
  | { tag: 'category'; category: 'rentControl' | 'historic' | 'newerThan' }
  | { tag: 'routes' }
  | { tag: 'baseline' }
  | { tag: 'fund'; pool: string }
  | { tag: 'terms' };

export type Effect =
  | { tag: 'bands'; bands: TransitBand[] }
  | { tag: 'brushes'; brushes: CustomBrush[] }
  | { tag: 'protect'; years: number | null }
  | { tag: 'timing'; set: TimingSet }
  | { tag: 'scales'; entries: { pool: string; from: Day; scale: number }[] }
  | { tag: 'fund'; pool: Pool | null; programmes: Programme[] }
  | { tag: 'terms'; terms: Partial<Record<TermKey, number>> };

export interface Span {
  from: Day;
  to: Day | null;
  what: Effect;
}

export interface Policy {
  id: string;
  label: string;
  preset: string | null;
  on: boolean;
  where: Selector;
  spans: Span[];
}

export interface SimPolicy4 {
  schema: 4;
  kinds: { zoning: Policy[]; permitting: Policy[]; money: Policy[] };
}

export type PolicyKind = keyof SimPolicy4['kinds'];

/** Empty lists in all three kinds: the plan as adopted, observed timing, today's City funding. */
export const DEFAULT_POLICY4: SimPolicy4 = {
  schema: 4,
  kinds: { zoning: [], permitting: [], money: [] }
};

/** Every lot query the document needs (off policies too), keyed as `queryKey` keys them. */
export function queriesOf4(doc: SimPolicy4): { key: string; query: BrushQuery }[] {
  const seen = new Map<string, BrushQuery>();
  const add = (q: BrushQuery) => {
    const k = queryKey(q);
    if (!seen.has(k)) seen.set(k, q);
  };
  for (const p of doc.kinds.zoning) {
    for (const s of p.spans) {
      if (s.what.tag === 'bands' && p.where.tag === 'transit') {
        ruleQueries({
          id: p.id,
          kind: 'transit',
          stopTypes: p.where.stopTypes,
          bands: s.what.bands
        }).forEach(add);
      } else if (s.what.tag === 'brushes') {
        s.what.brushes.forEach((b) => add(customQuery(b)));
      }
    }
  }
  return [...seen].map(([key, query]) => ({ key, query }));
}

/** The span covering `day`; null when the policy is off or no span covers it. */
export function spanAt(p: Policy, day: Day): Span | null {
  if (!p.on) return null;
  return p.spans.find((s) => s.from <= day && (s.to === null || day <= s.to)) ?? null;
}

/** Rule 9: no policy that is on has a span. */
export function nothingInForce(doc: SimPolicy4): boolean {
  return ![...doc.kinds.zoning, ...doc.kinds.permitting, ...doc.kinds.money].some(
    (p) => p.on && p.spans.length > 0
  );
}
