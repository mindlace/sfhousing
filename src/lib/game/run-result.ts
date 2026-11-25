// G6 (contracts stub): a run's reading, take and result, and settling. game-core makes it real.
import type { Goal } from '$lib/goal/goal';
import type { TimelineView } from '$lib/sim/world/score/types';
import type { Day } from '$lib/timelapse/time';
import type { Stage } from '$lib/timelapse/types';
import type { SideInput } from './side-goals';
import type { GameState, Units } from './state';

export interface RunTake {
  dropped: Units;
  collected: Units;
}

export interface RunReading {
  homes: number;
  reachedOn: Day | null;
  stages: Record<Exclude<Stage, 'complete'>, number>;
  waitingMoney: number | null;
}

export interface RunResult extends RunTake, RunReading {
  rung: number;
  amount: number;
  datasetVersion: string;
  at: string;
  lump: Units | null;
  side: { id: string; reward: Units }[];
}

export function readRun(_view: TimelineView, _goal: Goal): RunReading | null {
  throw new Error('not implemented');
}

export function resultOf(
  _s: GameState,
  _reading: RunReading,
  _take: RunTake,
  _input: SideInput,
  _meta: { amount: number; datasetVersion: string; at: string }
): RunResult {
  throw new Error('not implemented');
}

export function settle(_s: GameState, _r: RunResult): GameState {
  throw new Error('not implemented');
}
