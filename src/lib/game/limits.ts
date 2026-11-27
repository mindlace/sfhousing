// What a game may run and edit: the rounds offered so far, the editable policies and the end.
import { STOP_TYPES, type StopType } from '$lib/sim/levers/brushes';
import type { Policy, PolicyKind, SimPolicy4 } from '$lib/timeline/policy4';
import { CATALOGUE, POLICY_KEYS, isPolicyKey, keyOf, type PolicyKey } from './catalogue/rounds';
import type { GameState } from './state';

export interface Limits {
  /** No game: today's page, painted zoning and the brush included. */
  open: boolean;
  /** A finished game: every lever but painted zoning; every catalogue policy editable. */
  whole: boolean;
  own: boolean;
  /** Rounds 1..round, plus editable. */
  offered: ReadonlySet<PolicyKey>;
  /** Every key when whole. */
  editable: ReadonlySet<PolicyKey>;
  /** Offered transit entries' stop types; all when whole. */
  stops: ReadonlySet<StopType>;
  /** Any money entry offered (the free measures run and "+" offers them). */
  money: boolean;
}

export const FREE_MEASURES: readonly string[] = Object.freeze(['state-off', 'federal-credits-off']);

export const OPEN_LIMITS: Limits = Object.freeze({
  open: true,
  whole: true,
  own: true,
  offered: new Set<PolicyKey>(POLICY_KEYS),
  editable: new Set<PolicyKey>(POLICY_KEYS),
  stops: new Set<StopType>(STOP_TYPES),
  money: true
});

export function limitsOf(s: GameState): Limits {
  const whole = s.finished;
  const editable = new Set<PolicyKey>(whole ? POLICY_KEYS : s.editable.filter(isPolicyKey));
  const offered = new Set<PolicyKey>(editable);
  for (const e of CATALOGUE) if (e.round <= s.round) offered.add(e.key);
  const stops = new Set<StopType>(whole ? STOP_TYPES : []);
  let money = false;
  for (const e of CATALOGUE) {
    if (!offered.has(e.key)) continue;
    if (e.kind === 'zoning') for (const t of e.stopTypes) stops.add(t);
    if (e.kind === 'money') money = true;
  }
  return { open: false, whole, own: s.own, offered, editable, stops, money };
}

const TAGS: Record<PolicyKind, readonly Policy['where']['tag'][]> = {
  zoning: ['transit', 'painted', 'category'],
  permitting: ['routes'],
  money: ['baseline', 'fund', 'terms']
};

export function within(kind: PolicyKind, p: Policy, l: Limits): boolean {
  if (l.open) return true;
  if (!TAGS[kind].includes(p.where.tag)) return false;
  const key = keyOf(p);
  if (key !== null && l.offered.has(key)) return true;
  switch (p.where.tag) {
    case 'painted':
      return false;
    case 'category':
      return l.stops.size > 0;
    case 'transit':
      return l.whole || l.own;
    case 'routes':
      return l.whole;
    case 'baseline':
    case 'fund':
    case 'terms':
      return l.whole || (isGiven(p) && FREE_MEASURES.includes(p.preset as string) && l.money);
  }
}

const KINDS: readonly PolicyKind[] = ['zoning', 'permitting', 'money'];

export function runnable(doc: SimPolicy4, l: Limits): SimPolicy4 {
  if (l.open) return doc;
  const kinds = { ...doc.kinds };
  let changed = false;
  for (const kind of KINDS) {
    const list = doc.kinds[kind];
    const kept = list.filter((p) => within(kind, p, l));
    if (kept.length !== list.length) {
      kinds[kind] = kept;
      changed = true;
    }
  }
  return changed ? { ...doc, kinds } : doc;
}

/** A money policy made from a funding preset: its `preset` is the preset's id. */
export function isGiven(p: Policy): boolean {
  return (
    typeof p.preset === 'string' &&
    (p.where.tag === 'fund' || p.where.tag === 'baseline' || p.where.tag === 'terms')
  );
}

/** A catalogue policy the player cannot edit yet: only its switch works. */
export function isFixed(p: Policy, l: Limits): boolean {
  if (l.open || l.whole) return false;
  const key = keyOf(p);
  return key !== null && !l.editable.has(key);
}

/**
 * The Inspector's What is the summary only: a catalogue policy not yet editable (`isFixed`), or, in
 * a game before the end, a given measure outside the catalogue (a free measure runs at any values,
 * so editing it could reach a later round's policy). Its switch, order and When still edit.
 */
export function whatFixed(p: Policy, l: Limits): boolean {
  if (l.open || l.whole) return false;
  return isFixed(p, l) || (keyOf(p) === null && isGiven(p));
}

/** Remove is offered: no game, a finished game, or a policy outside the catalogue. */
export function canRemove(p: Policy, l: Limits): boolean {
  return l.open || l.whole || keyOf(p) === null;
}
