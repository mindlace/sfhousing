import { formatCount } from '$lib/scoreboard/format';
import type { GameState } from '../state';
import { roundName } from './round-words';

// The opening card
export function roomMet(amount: number): string {
  return `Room for ${formatCount(amount)} homes`;
}
export const OPENING_LINES: readonly string[] = [
  'Next, play the forecast under today’s law.',
  'The month it reaches the goal is your date to beat.'
];
export const START = 'Start';

// The game panel
export function entryStage(phase: GameState['phase'], round: number): string {
  return phase === 'opening' ? 'Painting' : roundName(round, false);
}
export const PLAYING = 'Playing';
export const SAVED_GAMES = 'Saved games';
export const NEW_GAME_LABEL = 'New game';
export const NAME_LABEL = 'Name';
export const RENAME = 'Rename';
export const DELETE = 'Delete';
export const CANCEL = 'Cancel';
export function renameName(name: string): string {
  return `Rename ${name}`;
}
export function deleteName(name: string): string {
  return `Delete ${name}`;
}
export function deleteAsk(name: string): string {
  return `Delete ${name}?`;
}
