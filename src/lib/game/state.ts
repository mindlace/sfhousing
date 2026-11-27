// The game's state (version 3) and the frozen new game.
import type { Day } from '$lib/timelapse/time';

export interface Win {
  /** The round the win was taken in (0: the baseline). */
  round: number;
  goalMonth: Day | null;
  /** The target it beat; null: none. */
  beat: Day | null;
  at: string;
  datasetVersion: string;
}

export interface GameState {
  v: 3;
  phase: 'opening' | 'runs';
  firstWinAt: string | null;
  /** Rounds offered so far, 0 (the baseline) to ROUNDS. */
  round: number;
  /** The first day of the month to beat; null: none yet. */
  target: Day | null;
  /** Catalogue keys the player can edit, sorted; fitState drops unknown ones. */
  editable: string[];
  wins: Win[];
  finished: boolean;
  /** Upgraded from version 2 with a run played: transit rules outside the catalogue run. */
  own: boolean;
}

export const NEW_GAME: GameState = freeze({
  v: 3,
  phase: 'opening',
  firstWinAt: null,
  round: 0,
  target: null,
  editable: [],
  wins: [],
  finished: false,
  own: false
});

/** Object.freeze on the state and on its editable and wins. */
function freeze(s: GameState): GameState {
  Object.freeze(s.editable);
  Object.freeze(s.wins);
  return Object.freeze(s);
}
