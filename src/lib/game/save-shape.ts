// G1 (contracts stub): the saved game. game-core makes it real.
import type { GameState } from './state';

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

export type SaveEntry = Pick<GameSave, 'id' | 'name' | 'nameIsDefault' | 'savedAt'> &
  Pick<GameState, 'phase' | 'rung'>;

export function parseGameSave(_json: unknown): GameSave | null {
  throw new Error('not implemented');
}
