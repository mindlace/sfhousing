// G4 (contracts stub): limits from what is bought. game-core makes it real.
import type { StopType } from '$lib/sim/levers/brushes';
import type { Policy, PolicyKind, SimPolicy4 } from '$lib/timeline/policy4';
import type { GameState } from './state';
import type { TreeNode } from './tree';

export interface Hands {
  radiusPx: number;
  lingerMs: number;
  auto: boolean;
}

export interface Limits {
  open: boolean;
  presets: ReadonlySet<string>;
  measures: ReadonlySet<string>;
  stops: ReadonlySet<StopType>;
  bands: number;
  stories: number;
  reachM: number;
  custom: boolean;
  hands: Hands;
}

export const BASE_HANDS: Hands = { radiusPx: 48, lingerMs: 4000, auto: false };
export const START_BANDS = 1;
export const START_STORIES = 4;
export const START_REACH_M = 402;

export const FREE_MEASURES: readonly string[] = ['state-off', 'federal-credits-off'];

// presets: every PRESETS id (sim-page/timing.ts); stops: STOP_TYPES (sim/levers/brushes.ts);
// bands: MAX_BANDS, reachM: BAND_MAX_M (sim-page/transit-edit.ts); stories: STORIES_MAX
// (plan/constants.ts). Funding preset ids are made from the calibration, so `measures` is
// empty: `open` lets every money policy through.
export const OPEN_LIMITS: Limits = {
  open: true,
  presets: new Set<string>([
    'observed',
    'sb423Clock',
    'noDiscretionary',
    'ceqaInfill',
    'benchmarkPermits'
  ]),
  measures: new Set<string>(),
  stops: new Set<StopType>(['regionalRail', 'metro', 'rapidBus', 'frequentBus']),
  bands: 3,
  stories: 80,
  reachM: 3219,
  custom: true,
  hands: BASE_HANDS
};

export function limitsOf(_s: GameState, _nodes?: readonly TreeNode[]): Limits {
  throw new Error('not implemented');
}

export function within(_kind: PolicyKind, _p: Policy, _l: Limits): boolean {
  throw new Error('not implemented');
}

export function runnable(_doc: SimPolicy4, _l: Limits): SimPolicy4 {
  throw new Error('not implemented');
}

export function isGiven(_p: Policy): boolean {
  throw new Error('not implemented');
}
