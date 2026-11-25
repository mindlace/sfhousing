import type { SyncState } from './save-sync.svelte';
import { MAX_SAVES, SAVE_NAME_MAX, SHORT_MONTHS } from './saves';

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

export type DefaultFrom = { kind: 'new'; at: Date } | { kind: 'conflict'; name: string };

function base(from: DefaultFrom): string {
  if (from.kind === 'new') return `Game, ${from.at.getDate()} ${SHORT_MONTHS[from.at.getMonth()]}`;
  return `${from.name} (this device)`;
}

/** At most `max` code points, trailing white space removed after a cut. */
function fit(s: string, max: number): string {
  const cps = Array.from(s);
  return cps.length <= max ? s : cps.slice(0, max).join('').trimEnd();
}

/** 'Game, 4 Mar' | 'Game, 4 Mar (2)' | 'Home (this device)': the first name not in `taken`. */
export function defaultSaveName(from: DefaultFrom, taken: readonly string[]): string {
  const b = base(from);
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '' : ` (${n})`;
    const candidate = fit(b, SAVE_NAME_MAX - suffix.length) + suffix;
    if (!taken.includes(candidate)) return candidate;
  }
}
