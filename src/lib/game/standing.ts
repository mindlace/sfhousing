import type { Day } from '$lib/timelapse/time';
import type { Bar, Level, Result } from './levels';

export type Standing =
  { kind: 'playing' } | { kind: 'short'; seen: Result; bar: Bar | null } | { kind: 'won'; on: Day };

/** `seen` is `goalOutcome(...)` for the months reached; null while no result is seen. */
export function standing(level: Level, bar: Bar | null, seen: Result | null): Standing {
  void level;
  void bar;
  void seen;
  throw new Error('not implemented');
}
