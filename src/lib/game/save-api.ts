import type { GameSave, SaveEntry } from './saves';

export const MAX_SAVE_BYTES = 600_000;

/** What every answer about the account carries. */
export interface AccountLine {
  handle: string;
  /** This identity has changed its handle at least once. */
  handleClaimed: boolean;
}

/** GET /api/game */
export type ListGames =
  | {
      status: 200;
      body: AccountLine & { saves: (SaveEntry & { rev: number })[]; removed: string[] };
    }
  | { status: 401 };

/** GET /api/game/[id] */
export type GetGame =
  { status: 200; body: { rev: number; save: GameSave } } | { status: 401 | 404 | 410 };

/** PUT /api/game/[id] */
export interface PutGameBody {
  /** The rev this browser last saw for this saved game; null when it has never sent it. */
  baseRev: number | null;
  save: GameSave;
}

/** PUT /api/game/[id] */
export type PutGame =
  | { status: 200; body: AccountLine & { rev: number } }
  | { status: 409; body: { rev: number; save: GameSave } }
  | { status: 410 }
  | { status: 401; body: { error: 'sign_in' } }
  | { status: 422; body: { error: 'invalid' | 'too_many' | 'no_win' } }
  | { status: 403 | 413 | 415 | 429 };

/** DELETE /api/game/[id] */
export type DeleteGame = { status: 204 } | { status: 401 };
