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

export function allowedAt(level: Level): Allowed {
  void level;
  throw new Error('not implemented');
}

/** permitting 3, zoning 4, money 5. */
export function unlocksAt(kind: PolicyKind): Level {
  void kind;
  throw new Error('not implemented');
}

/** A money policy made from a funding preset: its `preset` is the preset's id. */
export function isGiven(p: Policy): boolean {
  void p;
  throw new Error('not implemented');
}

export function runs(kind: PolicyKind, p: Policy, a: Allowed): boolean {
  void kind;
  void p;
  void a;
  throw new Error('not implemented');
}

export function playable(doc: SimPolicy4, a: Allowed): SimPolicy4 {
  void doc;
  void a;
  throw new Error('not implemented');
}

/** The lowest level whose `allowedAt` runs every policy of `doc`; 6 when none does. */
export function levelNeeded(doc: SimPolicy4): Level | 6 {
  void doc;
  throw new Error('not implemented');
}

/** True while the game's level is below the one that opens the simulation. */
export function simLocked(p: Progress): boolean {
  void p;
  throw new Error('not implemented');
}

/** The level that runs all of `doc`, when it is above the game's level; null otherwise. */
export function needsHigher(doc: SimPolicy4, p: Progress): Level | 6 | null {
  void doc;
  void p;
  throw new Error('not implemented');
}
