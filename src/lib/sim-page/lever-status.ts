// Lever status rules for /sim (pure). A lever message is kept when its rev is at or after the
// latest setLevers/initScenario rev sent. The timeline barrier is never consulted, so a reroll
// does not make lever messages stale.
import type { LeverLookups } from '$lib/sim/levers/apply';
import type { LeverCapacity } from '$lib/sim/levers/resolve';
import type { LeversResponse } from '$lib/sim/scenario/types';

export type LeverStatus =
  | { kind: 'off' }
  | { kind: 'resolving'; rev: number; done: number; total: number; failedCells: string[] }
  | { kind: 'current'; rev: number; lookups: LeverLookups; capacity: LeverCapacity }
  | { kind: 'failed'; rev: number };

export interface LeverStatusState {
  sentRev: number | null;
  status: LeverStatus;
}

export function leversSent(s: LeverStatusState, rev: number): LeverStatusState {
  return {
    ...s,
    sentRev: rev,
    status: { kind: 'resolving', rev, done: 0, total: 0, failedCells: [] }
  };
}

export function leversMessage(s: LeverStatusState, m: LeversResponse): LeverStatusState {
  if (s.sentRev === null || m.rev < s.sentRev) return s;
  if (m.phase === 'current') {
    return {
      ...s,
      status: { kind: 'current', rev: m.rev, lookups: m.lookups, capacity: m.capacity }
    };
  }
  return {
    ...s,
    status: {
      kind: 'resolving',
      rev: m.rev,
      done: m.done,
      total: m.total,
      failedCells: m.failedCells
    }
  };
}

export function leversError(s: LeverStatusState, rev: number): LeverStatusState {
  if (s.sentRev === null || rev < s.sentRev) return s;
  return { ...s, status: { kind: 'failed', rev } };
}
