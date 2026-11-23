import type { Day } from '$lib/timelapse/time';
import type { Bar, Level } from './levels';

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
  void p;
  throw new Error('not implemented');
}

/** Level 5 has been won and banked. */
export function roundComplete(p: Progress): boolean {
  void p;
  throw new Error('not implemented');
}

export function levelUp(p: Progress, banked: Banked | null): Progress {
  void p;
  void banked;
  throw new Error('not implemented');
}
