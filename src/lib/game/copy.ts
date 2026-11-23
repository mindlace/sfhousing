import type { PolicyKind } from '$lib/timeline/policy4';
import type { Bar, Level } from './levels';

/** 'Beat Jun 2057'. */
export function barText(bar: Bar): string {
  void bar;
  throw new Error('not implemented');
}

/** 'Permitting' | 'Zoning' | 'Public money' | …. */
export function unlockText(next: Level | 6): string {
  void next;
  throw new Error('not implemented');
}

/** "Unlocks when you level up" for the kind `level + 1` unlocks, "Unlocks at level N" for the others. */
export function lockedLane(kind: PolicyKind, level: Level): string {
  void kind;
  void level;
  throw new Error('not implemented');
}
