/** The game's words on /sim: outcomes, the bar to beat, level-ups and the locked page. */
import type { Level } from '$lib/game/levels';
import type { TreeNode } from '$lib/game/tree';
import { formatMonthYear, formatShortMonthYear } from '$lib/fzp/format';
import { formatCount } from '$lib/scoreboard/format';
import type { Day } from '$lib/timelapse/time';

/** The goal was reached, but not before the bar. */
export function shortOfBar(on: Day, bar: Day): string {
  return `Goal reached in ${formatShortMonthYear(on)}. Beat ${formatShortMonthYear(bar)} to level up.`;
}

/** The goal was missed and a bar is set. */
export function missedBar(short: number, unit: string, bar: Day): string {
  return `Goal missed by ${formatCount(short)} ${unit}. Reach it before ${formatShortMonthYear(bar)} to level up.`;
}

/** The goal was missed and there is no bar. */
export function missed(short: number, unit: string): string {
  return `Goal missed by ${formatCount(short)} ${unit}.`;
}

export function winTitle(on: Day): string {
  return `Goal reached in ${formatShortMonthYear(on)}`;
}

export const TO_BEAT_FLAG = 'To beat';
export const GOAL_AND_BAR_FLAG = 'Goal · To beat';

export function toBeatLine(bar: Day): string {
  return `To beat: ${formatShortMonthYear(bar)}`;
}

export function toBeatDescription(bar: Day): string {
  return `To beat ${formatMonthYear(bar)}.`;
}

export const LATER_ROUND = 'Unlocks in a later round';

export function levelledUp(level: Level, unlocked: string | null): string {
  return unlocked === null ? 'Round complete.' : `Level ${level}. ${unlocked} unlocked.`;
}

export function lockedSim(amount: number, unit: string): string {
  return `Paint room for ${formatCount(amount)} ${unit} to unlock the simulation.`;
}

export const GO_TO_PAINT = 'Go to Paint';

export const NOT_BOUGHT = 'Not bought yet';
export const LOCKED_LANE = 'Opens in the tree';
export const BACK_TO_TREE = 'Back to the tree';

/** What reaching the goal opens: levers and, when it beats the bar, an earlier goal. */
export function goalUnlocks(levers: number, earlier: boolean): string {
  const lev = levers === 0 ? '' : `${levers} ${levers === 1 ? 'lever' : 'levers'}`;
  if (!earlier) return lev;
  return lev === '' ? 'an earlier goal' : `${lev} and an earlier goal`;
}

/** A node just bought; a multi-level node names the step reached. */
export function boughtLabel(node: TreeNode, level: number): string {
  return node.levels.length > 1
    ? `Bought: ${node.label}, ${node.levels[level - 1].step}`
    : `Bought: ${node.label}`;
}

export function restoredLabel(node: TreeNode): string {
  return `Restored: ${node.label}`;
}
