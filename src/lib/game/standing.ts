import type { Day } from '$lib/timelapse/time';
import { beats, type Bar, type Level, type Result } from './levels';

export type Standing =
  { kind: 'playing' } | { kind: 'short'; seen: Result; bar: Bar | null } | { kind: 'won'; on: Day };

/** `seen` is `goalOutcome(...)` for the months reached; null while no result is seen. */
export function standing(level: Level, bar: Bar | null, seen: Result | null): Standing {
  if (level === 1 || seen === null) return { kind: 'playing' };
  const against = level === 2 ? null : bar;
  const won = against === null ? seen.kind === 'reached' : beats(seen, against);
  if (won && seen.kind === 'reached') return { kind: 'won', on: seen.on };
  return { kind: 'short', seen, bar };
}
