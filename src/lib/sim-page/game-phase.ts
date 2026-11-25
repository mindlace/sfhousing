import type { GameState } from '$lib/game/state';

export type GamePhase = 'starting' | 'run' | 'tally' | 'tree' | 'workshop';
export type PhaseEvent = 'run' | 'ready' | 'settled' | 'abort' | 'continue' | 'edit' | 'back';

export const PHASES: Readonly<Record<GamePhase, Partial<Record<PhaseEvent, GamePhase>>>> = {
  starting: { ready: 'run', abort: 'tree' },
  run: { settled: 'tally', abort: 'tree' },
  tally: { continue: 'tree' },
  tree: { run: 'starting', edit: 'workshop' },
  workshop: { back: 'tree' }
};

/**
 * The phase after `e`; an event the table does not list leaves the phase as it is. With
 * `runs` 0 (no run settled yet), `abort` gives 'starting' from starting and from run.
 */
export function nextPhase(p: GamePhase, e: PhaseEvent, runs: number): GamePhase {
  if (e === 'abort' && runs === 0 && (p === 'starting' || p === 'run')) return 'starting';
  return PHASES[p][e] ?? p;
}

/** Where a mount lands: 'starting' while no run has settled, else 'tree'. */
export function landing(s: GameState): GamePhase {
  return s.runs > 0 ? 'tree' : 'starting';
}

/** The phases in which the map is in its run view. */
export const RUN_VIEW: ReadonlySet<GamePhase> = new Set<GamePhase>(['starting', 'run', 'tally']);
