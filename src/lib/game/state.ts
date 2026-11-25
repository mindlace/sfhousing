// G1 (contracts stub): the game's state. game-core makes it real.
import type { Day } from '$lib/timelapse/time';
import type { RunResult } from './run-result';

export type UnitKind = 'home';
export const UNIT_KINDS: readonly UnitKind[] = ['home'];
export type Units = Partial<Record<UnitKind, number>>;
export type NodeId = string;

export interface MetRung {
  rung: number;
  reachedOn: Day;
  datasetVersion: string;
  at: string;
}

export interface GameState {
  v: 2;
  phase: 'opening' | 'runs';
  firstWinAt: string | null;
  bought: Record<NodeId, number>;
  units: Units;
  rung: number;
  met: MetRung[];
  side: Record<string, string>;
  runs: number;
  last: RunResult | null;
}

export const NEW_GAME: GameState = {
  v: 2,
  phase: 'opening',
  firstWinAt: null,
  bought: {},
  units: {},
  rung: 0,
  met: [],
  side: {},
  runs: 0,
  last: null
};
