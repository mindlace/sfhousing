import { describe, expect, it } from 'vitest';
import { NEW_GAME } from '$lib/game/state';
import { landing, nextPhase, RUN_VIEW, type GamePhase, type PhaseEvent } from './game-phase';

const ROWS: [GamePhase, PhaseEvent, GamePhase][] = [
  ['starting', 'ready', 'run'],
  ['starting', 'abort', 'tree'],
  ['run', 'settled', 'tally'],
  ['run', 'abort', 'tree'],
  ['tally', 'continue', 'tree'],
  ['tree', 'run', 'starting'],
  ['tree', 'edit', 'workshop'],
  ['workshop', 'back', 'tree']
];

describe('game phases', () => {
  it.each(ROWS)('%s + %s gives %s with a run settled', (p, e, to) => {
    expect(nextPhase(p, e, 1)).toBe(to);
  });

  it('abort with no run settled returns to starting', () => {
    expect(nextPhase('starting', 'abort', 0)).toBe('starting');
    expect(nextPhase('run', 'abort', 0)).toBe('starting');
  });

  it('an event not listed leaves the phase', () => {
    expect(nextPhase('tally', 'run', 1)).toBe('tally');
    expect(nextPhase('starting', 'run', 0)).toBe('starting');
    expect(nextPhase('workshop', 'abort', 1)).toBe('workshop');
  });

  it('landing', () => {
    expect(landing({ ...NEW_GAME, phase: 'runs', runs: 0 })).toBe('starting');
    expect(landing({ ...NEW_GAME, phase: 'runs', runs: 3 })).toBe('tree');
  });

  it('RUN_VIEW', () => {
    expect([...RUN_VIEW].sort()).toEqual(['run', 'starting', 'tally']);
  });
});
