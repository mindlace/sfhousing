import type { Policy, PolicyKind, SimPolicy4 } from '$lib/timeline/policy4';
import type { Level } from './levels';
import type { Progress } from './progress';

export interface Allowed {
  /** Kinds whose policies run and can be edited. */
  kinds: ReadonlySet<PolicyKind>;
  /** 'given': only given measures run, and what they pay is read-only. */
  money: 'given' | 'all';
}

export const ALL_ALLOWED: Allowed = {
  kinds: new Set<PolicyKind>(['zoning', 'permitting', 'money']),
  money: 'all'
};

const NONE: Allowed = { kinds: new Set<PolicyKind>(), money: 'given' };
const AT: Record<Level, Allowed> = {
  1: NONE,
  2: { kinds: new Set<PolicyKind>(), money: 'given' },
  3: { kinds: new Set<PolicyKind>(['permitting']), money: 'given' },
  4: { kinds: new Set<PolicyKind>(['permitting', 'zoning']), money: 'given' },
  5: { kinds: new Set<PolicyKind>(['permitting', 'zoning', 'money']), money: 'given' }
};

export function allowedAt(level: Level): Allowed {
  return AT[level];
}

const UNLOCKS: Record<PolicyKind, Level> = { permitting: 3, zoning: 4, money: 5 };

/** permitting 3, zoning 4, money 5. */
export function unlocksAt(kind: PolicyKind): Level {
  return UNLOCKS[kind];
}

/** A money policy made from a funding preset: its `preset` is the preset's id. */
export function isGiven(p: Policy): boolean {
  return (
    typeof p.preset === 'string' &&
    (p.where.tag === 'fund' || p.where.tag === 'baseline' || p.where.tag === 'terms')
  );
}

export function runs(kind: PolicyKind, p: Policy, a: Allowed): boolean {
  return a.kinds.has(kind) && (kind !== 'money' || a.money === 'all' || isGiven(p));
}

const KINDS: PolicyKind[] = ['zoning', 'permitting', 'money'];

export function playable(doc: SimPolicy4, a: Allowed): SimPolicy4 {
  const next = { ...doc.kinds };
  let changed = false;
  for (const kind of KINDS) {
    const list = doc.kinds[kind];
    const kept = list.filter((p) => runs(kind, p, a));
    if (kept.length !== list.length) {
      next[kind] = kept;
      changed = true;
    }
  }
  return changed ? { ...doc, kinds: next } : doc;
}

/** The lowest level whose `allowedAt` runs every policy of `doc`; 6 when none does. */
export function levelNeeded(doc: SimPolicy4): Level | 6 {
  const { zoning, permitting, money } = doc.kinds;
  if (money.some((p) => !isGiven(p))) return 6;
  if (money.length > 0) return 5;
  if (zoning.length > 0) return 4;
  if (permitting.length > 0) return 3;
  return 2;
}

/** True while the game's level is below the one that opens the simulation. */
export function simLocked(p: Progress): boolean {
  return p.level === 1;
}

/** The level that runs all of `doc`, when it is above the game's level; null otherwise. */
export function needsHigher(doc: SimPolicy4, p: Progress): Level | 6 | null {
  const need = levelNeeded(doc);
  return need <= p.level ? null : need;
}
