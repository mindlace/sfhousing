import { formatCount } from '$lib/scoreboard/format';
import type { GameState } from '../state';
import { RUNGS } from '../ladder';

// Units
export const UNIT_MARK = '◆';
export function unitsName(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'unit' : 'units'}`;
}
export function priceText(n: number): string {
  return n === 0 ? 'Free' : `${UNIT_MARK} ${formatCount(n)}`;
}

// The goal headline
export function goalLine(homes: number | null, amount: number, deadline: string): string {
  const goal = `${formatCount(amount)} homes by ${deadline}`;
  return homes === null ? goal : `${formatCount(homes)} of ${goal}`;
}
export const HOMES_WORD = ' homes';
export function unlocksText(unlocks: string): string {
  return `Unlocks: ${unlocks}`;
}
export const GOAL_MET = 'Goal met';
export const LAST_GOAL = 'Last goal';
export function sideMetText(n: number): string {
  return `${formatCount(n)} side ${n === 1 ? 'goal' : 'goals'} met`;
}
export const SIDE_GOALS_TITLE = 'Side goals';
export const NO_SIDE_GOALS = 'None open';
export function progressText(value: number, target: number): string {
  return `${formatCount(value)} of ${formatCount(target)}`;
}
export const MET = 'Met';
export function goalMetLive(amount: number, deadline: string): string {
  return `${GOAL_MET}: ${formatCount(amount)} homes by ${deadline}`;
}
export function sideMetLive(label: string): string {
  return `Side goal met: ${label}`;
}

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
export function entryStage(phase: GameState['phase'], rung: number): string {
  return phase === 'opening' ? 'Painting' : `Goal ${rung + 1} of ${RUNGS}`;
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
