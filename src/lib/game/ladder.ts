// G6 (contracts stub): the ladder of deadlines. game-core makes it real.
import type { Goal } from '$lib/goal/goal';
import type { Day } from '$lib/timelapse/time';
import { LADDER_YEARS } from './catalogue/ladder-years';
import type { SideGoal } from './side-goals';
import type { GameState } from './state';
import type { TreeNode } from './tree';

export interface Rung {
  deadline: Day;
  label: string;
}

export const RUNGS: number = LADDER_YEARS.length + 1;

export function ladder(_asOf: Day): Rung[] {
  throw new Error('not implemented');
}

export function goalAt(_asOf: Day, _rung: number, _amount?: number): Goal {
  throw new Error('not implemented');
}

export function finished(_s: GameState): boolean {
  throw new Error('not implemented');
}

export function takeNext(_s: GameState): GameState {
  throw new Error('not implemented');
}

export function fitGame(
  _s: GameState,
  _nodes?: readonly TreeNode[],
  _goals?: readonly SideGoal[]
): GameState {
  throw new Error('not implemented');
}
