/** The game's words on /sim: the tree's fixed words and labels. */
import type { TreeNode } from '$lib/game/tree';

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
