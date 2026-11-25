// G6 (contracts stub): side goals. game-core makes it real.
import type { TimelineView } from '$lib/sim/world/score/types';
import type { RunTake } from './run-result';
import type { GameState, Units } from './state';

export interface SideInput {
  view: TimelineView;
  index: number;
  take: RunTake;
}

export interface SideGoal {
  id: string;
  label: string;
  ring: number;
  reward: Units;
  read(i: SideInput): { value: number; target: number } | null;
}

export const SIDE_GOALS: readonly SideGoal[] = [];
export const SIDE_SHOWN = 3;

export function sideShown(_s: GameState, _goals?: readonly SideGoal[]): SideGoal[] {
  throw new Error('not implemented');
}
