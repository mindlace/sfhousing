import type { Level } from './levels';
import type { Progress } from './progress';

export interface GameSave {
  v: 1;
  /** `newId()` of `$lib/ids/base58`. */
  id: string;
  name: string;
  /** True until the player types a name. */
  nameIsDefault: boolean;
  progress: Progress;
  /** The plan record's text as `sfhousing:plan:v1` holds it, or null. */
  plan: string | null;
  /** The policy record's text as `sfhousing:sim:v2` holds it, or null. */
  policy: string | null;
  /** ISO time of the last change. */
  savedAt: string;
}

/** What the list shows of a saved game. */
export type SaveEntry = Pick<GameSave, 'id' | 'name' | 'nameIsDefault' | 'savedAt'> & {
  level: Level;
};

export const SAVES_KEY = 'sfhousing:saves:v1';
export const saveKey = (id: string): string => `sfhousing:save:${id}`;
export const MAX_SAVES = 12;
export const SAVE_NAME_MAX = 60;

export function parseGameSave(json: unknown): GameSave | null {
  void json;
  throw new Error('not implemented');
}

export function defaultSaveName(
  from:
    | { kind: 'new'; at: Date }
    | { kind: 'remix'; title: string }
    | { kind: 'conflict'; name: string },
  taken: readonly string[]
): string {
  void from;
  void taken;
  throw new Error('not implemented');
}
