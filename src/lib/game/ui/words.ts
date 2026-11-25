import type { Stage } from '$lib/timelapse/types';
import type { Day } from '$lib/timelapse/time';
import { formatCount } from '$lib/scoreboard/format';
import { formatDollarsExact, formatShortMonthYear } from '$lib/fzp/format';
import type { GameState } from '../state';
import type { Branch } from '../tree';
import { RUNGS } from '../ladder';

// Units
export const UNIT_MARK = '◆';
export function unitsName(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'unit' : 'units'}`;
}
export function priceText(n: number): string {
  return n === 0 ? 'Free' : `${UNIT_MARK} ${formatCount(n)}`;
}
export function priceName(n: number): string {
  return n === 0 ? 'Free' : unitsName(n);
}
export function shortText(n: number): string {
  return `${formatCount(n)} short`;
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

// The tally
export function tallyTitle(reachedOn: Day | null, deadline: string): string {
  return reachedOn === null
    ? `By ${deadline}`
    : `${GOAL_MET} in ${formatShortMonthYear(reachedOn)}`;
}
export function homesOfText(homes: number, amount: number): string {
  return `${formatCount(homes)} of ${formatCount(amount)} homes`;
}
export function changeText(d: number): string {
  if (d === 0) return 'No change';
  return `${d > 0 ? '+' : '−'}${formatCount(Math.abs(d))}`;
}
export function collectedText(collected: number, dropped: number): string {
  return `${formatCount(collected)} of ${formatCount(dropped)} collected`;
}
export function collectedName(collected: number, dropped: number): string {
  return `${formatCount(collected)} of ${unitsName(dropped)} collected`;
}
export function lumpName(n: number): string {
  return `+${unitsName(n)} for the goal`;
}
export function sideRewardName(n: number, label: string): string {
  return `+${unitsName(n)} for ${label}`;
}
export function lumpText(n: number): string {
  return `+${formatCount(n)} for the goal`;
}
export function sideRewardText(n: number, label: string): string {
  return `+${formatCount(n)} for ${label}`;
}
export const SIDE_GOAL_FALLBACK = 'a side goal';
export function notBuiltTitle(deadline: string): string {
  return `Not yet built by ${deadline}`;
}
export const STAGE_ROWS: readonly {
  id: 'planning' | 'approved' | 'issued' | 'building';
  label: string;
  stages: readonly Exclude<Stage, 'complete'>[];
}[] = [
  { id: 'planning', label: 'Planning review', stages: ['preApplication', 'filed'] },
  { id: 'approved', label: 'Approved', stages: ['entitled', 'permitFiled'] },
  { id: 'issued', label: 'Permit issued', stages: ['permitIssued'] },
  { id: 'building', label: 'Building', stages: ['construction'] }
];
export const WAITING_MONEY = 'Waiting for money';
export const CONTINUE = 'Continue';

// The tree
export const TREE_TITLE = 'Levers';
export const CURRENT_LAW = 'Current law';
export const BRANCH_NAMES: Readonly<Record<Branch, string>> = {
  permitting: 'Permitting',
  zoning: 'Zoning',
  money: 'Public money',
  hands: 'Hands'
};
export function buyText(price: number): string {
  return `Buy · ${priceText(price)}`;
}
export function buyName(price: number): string {
  return price === 0 ? 'Buy for free' : `Buy for ${unitsName(price)}`;
}
export const BOUGHT = 'Bought';
export const EDIT = 'Edit';
export function editName(label: string): string {
  return `Edit ${label}`;
}
export const ON = 'On';
export function switchName(label: string): string {
  return `${label} on`;
}
export const OFF = 'off';
export function nextStepText(step: string): string {
  return `Next: ${step}`;
}
export function nextPriceText(price: number): string {
  return `next ${UNIT_MARK} ${formatCount(price)}`;
}
export function nextPriceName(price: number): string {
  return price === 0 ? 'next free' : `next ${unitsName(price)}`;
}
export const SOURCE = 'Source';
export function boughtLive(label: string, step: string): string {
  return `Bought: ${label}, ${step}`;
}
export const RUN = 'Run';
export const RUN_BUSY = 'Getting the forecast ready';
export function balanceText(n: number): string {
  return `${UNIT_MARK} ${formatCount(n)} to spend`;
}
export function balanceName(n: number): string {
  return `${unitsName(n)} to spend`;
}
export function takeNextText(label: string): string {
  return `Take the next goal: ${label}`;
}
export const ENDING_TITLE = 'Every goal met';
export function endingReached(reachedOn: Day): string {
  return `Reached in ${formatShortMonthYear(reachedOn)}`;
}
export function endingState(stateBy: Day): string {
  return `The state asks by ${formatShortMonthYear(stateBy)}`;
}
export const ENDING_LEVERS = 'Levers bought';
export function perAddedHomeText(dollars: number): string {
  return `Public money per added home: ${formatDollarsExact(dollars)}`;
}
export const ENDING_LIFTED = 'Every limit is lifted.';
export const PUBLISH = 'Publish';

// The opening card
export function roomMet(amount: number): string {
  return `Room for ${formatCount(amount)} homes`;
}
export const OPENING_LINES: readonly string[] = [
  'Next, the forecast plays today’s law to the deadline.',
  'Sweep over homes as they finish to collect them.'
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
export const SOUND = 'Sound';
export const COLLECT_FOR_ME = 'Collect for me';
export const COLLECT_BOUGHT = 'Always on: bought';
