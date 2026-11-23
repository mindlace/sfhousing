import type { Day } from '$lib/timelapse/time';
import { LAST_LEVEL, type Bar, type Level } from './levels';

export interface Banked {
  /** The day the banked result reached the goal. */
  on: Day;
  /** The dataset the result was earned on. */
  datasetVersion: string;
  /** ISO time of the level up. */
  at: string;
}

export interface Progress {
  v: 1;
  level: Level;
  /** banked[n] is the result banked on leaving level n. */
  banked: Partial<Record<2 | 3 | 4 | 5, Banked>>;
  /** ISO time the player first won anything; null until then. */
  firstWinAt: string | null;
}

export const NEW_GAME: Progress = { v: 1, level: 1, banked: {}, firstWinAt: null };

/** The bar at the progress's level; null at levels 1 and 2. */
export function barOf(p: Progress): Bar | null {
  if (p.level < 3) return null;
  const prev = p.banked[(p.level - 1) as 2 | 3 | 4];
  return prev ? { on: prev.on } : null;
}

/** Level 5 has been won and banked. */
export function roundComplete(p: Progress): boolean {
  return p.level === LAST_LEVEL && p.banked[5] !== undefined;
}

/** Pure: a new progress, or `p` itself when there is nothing to change. */
export function levelUp(p: Progress, banked: Banked | null): Progress {
  if (roundComplete(p)) return p;
  if (p.level === 1) return { ...p, level: 2 };
  if (banked === null) return p;
  const level = p.level === LAST_LEVEL ? LAST_LEVEL : ((p.level + 1) as Level);
  return { ...p, level, banked: { ...p.banked, [p.level]: banked } };
}
