import { formatShortMonthYear } from '$lib/fzp/format';
import type { PolicyKind } from '$lib/timeline/policy4';
import { unlocksAt } from './allowed';
import type { Bar, Level } from './levels';
import { barOf, roundComplete, type Progress } from './progress';
import type { SyncState } from './save-sync.svelte';
import { MAX_SAVES, SHORT_MONTHS } from './saves';

/** 'Beat Jun 2057'. */
export function barText(bar: Bar): string {
  return `Beat ${formatShortMonthYear(bar.on)}`;
}

const UNLOCKS: Record<Level | 6, string> = {
  1: 'Paint',
  2: 'The simulation',
  3: 'Permitting',
  4: 'Zoning',
  5: 'Public money',
  6: 'The end of the round'
};

/** 'Permitting' | 'Zoning' | 'Public money' | …. */
export function unlockText(next: Level | 6): string {
  return UNLOCKS[next];
}

/** "Unlocks when you level up" for the kind `level + 1` unlocks, "Unlocks at level N" for the others. */
export function lockedLane(kind: PolicyKind, level: Level): string {
  const at = unlocksAt(kind);
  if (at <= level) return '';
  if (at === level + 1) return 'Unlocks when you level up';
  return `Unlocks at level ${at}`;
}

/** 'Level 3'. */
export function levelText(level: Level): string {
  return `Level ${level}`;
}

/** What the player is after: 'Beat Jun 2057'. */
export function aimText(p: Progress): string {
  if (roundComplete(p)) return 'Round complete';
  if (p.level === 1) return 'Paint room for the goal';
  const bar = barOf(p);
  return bar ? barText(bar) : 'Play to the goal';
}

/** 'Next: Zoning'. */
export function nextText(p: Progress): string {
  if (roundComplete(p)) {
    return 'Coming next: designing funding, market rules and affordability targets';
  }
  return `Next: ${unlockText((p.level + 1) as Level | 6)}`;
}

/** The save sync's state in words; null when saved. */
export function syncText(state: SyncState): string | null {
  switch (state) {
    case 'local':
      return 'On this device only';
    case 'saving':
      return 'Saving';
    case 'offline':
      return 'Offline';
    case 'sign-in':
      return 'Sign in to save';
    case 'full':
      return 'Account full. Delete a saved game.';
    case 'saved':
      return null;
  }
}

/** 'Today', 'Yesterday', '4 Mar' or '4 Mar 2025', by local calendar date. */
export function playedText(savedAt: string, now: Date): string {
  const d = new Date(savedAt);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (same(d, now)) return 'Today';
  if (same(d, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'Yesterday';
  const day = `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? day : `${day} ${d.getFullYear()}`;
}

export const FULL_TEXT = `${MAX_SAVES} saved games. Delete one first.`;
export const STORAGE_TEXT = 'This browser refused to save.';
