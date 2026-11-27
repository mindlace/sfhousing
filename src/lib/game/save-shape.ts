// The saved game and its parser. Value imports are relative; $lib only as types.
import { isValidId } from '../ids/base58';
import { SAVE_NAME_MAX } from './saves';
import type { GameState, Win } from './state';
import { upgradeV2 } from './upgrade';

/** The envelope. Its version stays 2: only the state inside moved to version 3. */
export interface GameSave {
  v: 2;
  id: string;
  name: string;
  nameIsDefault: boolean;
  state: GameState;
  plan: string | null;
  policy: string | null;
  savedAt: string;
}

export type SaveEntry = Pick<GameSave, 'id' | 'name' | 'nameIsDefault' | 'savedAt'> & {
  phase: GameState['phase'];
  round: number;
};

type Plain = Record<string, unknown>;
const isPlain = (x: unknown): x is Plain =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isTime = (x: unknown): x is string => typeof x === 'string' && Number.isFinite(Date.parse(x));
const isWhole = (x: unknown, min: number): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= min;
const isDay = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x);
const isText = (x: unknown): x is string => typeof x === 'string' && x !== '';

function parseWin(x: unknown): Win | null {
  if (!isPlain(x)) return null;
  const { round, goalMonth, beat, at, datasetVersion } = x;
  if (!isWhole(round, 0)) return null;
  if (goalMonth !== null && !isDay(goalMonth)) return null;
  if (beat !== null && !isDay(beat)) return null;
  if (!isTime(at) || !isText(datasetVersion)) return null;
  return { round, goalMonth, beat, at, datasetVersion };
}

/** A version 3 state, strictly; a version 2 state through upgradeV2; else null. */
export function parseGameState(x: unknown): GameState | null {
  if (!isPlain(x)) return null;
  if (x.v === 2) return upgradeV2(x);
  if (x.v !== 3) return null;
  const { phase, firstWinAt, round, target, finished, own } = x;
  if (phase !== 'opening' && phase !== 'runs') return null;
  if (firstWinAt !== null && !isTime(firstWinAt)) return null;
  if (!isWhole(round, 0)) return null;
  if (target !== null && !isDay(target)) return null;
  if (!Array.isArray(x.editable) || !x.editable.every(isText)) return null;
  if (!Array.isArray(x.wins)) return null;
  const wins: Win[] = [];
  for (const e of x.wins) {
    const w = parseWin(e);
    if (!w) return null;
    wins.push(w);
  }
  if (typeof finished !== 'boolean' || typeof own !== 'boolean') return null;
  // The phase agrees with the rest.
  if (phase === 'runs' && firstWinAt === null) return null;
  if (
    phase === 'opening' &&
    (round !== 0 || target !== null || wins.length > 0 || x.editable.length > 0 || finished)
  ) {
    return null;
  }
  return {
    v: 3,
    phase,
    firstWinAt,
    round,
    target,
    editable: [...(x.editable as string[])],
    wins,
    finished,
    own
  };
}

export function parseGameSave(json: unknown): GameSave | null {
  if (!isPlain(json) || json.v !== 2) return null;
  const { id, name, nameIsDefault, savedAt, plan, policy } = json;
  if (typeof id !== 'string' || !isValidId(id)) return null;
  if (typeof name !== 'string' || name !== name.trim()) return null;
  const length = Array.from(name).length;
  if (length < 1 || length > SAVE_NAME_MAX) return null;
  if (typeof nameIsDefault !== 'boolean') return null;
  if (!isTime(savedAt)) return null;
  if (plan !== null && typeof plan !== 'string') return null;
  if (policy !== null && typeof policy !== 'string') return null;
  const state = parseGameState(json.state);
  if (!state) return null;
  return { v: 2, id, name, nameIsDefault, state, plan, policy, savedAt };
}
