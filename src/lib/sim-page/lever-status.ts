// Lever status rules for /sim (pure). A lever message is kept when its rev is at or after the
// latest setLevers/initScenario rev sent. The timeline barrier is never consulted, so a reroll
// does not make lever messages stale.
import type { LeverLookups } from '$lib/sim/levers/apply';
import type { LeverCapacity } from '$lib/sim/levers/resolve';
import type { LeversResponse, ScenarioErrorCode } from '$lib/sim/scenario/types';

export type LeverStatus =
  | { kind: 'off' }
  | { kind: 'resolving'; rev: number; done: number; total: number; failedCells: string[] }
  | { kind: 'current'; rev: number; lookups: LeverLookups; capacity: LeverCapacity }
  | { kind: 'failed'; rev: number };

export interface LeverStatusState {
  sentRev: number | null;
  /** The latest initScenario rev: a load failure is posted at it, below a later setLevers. */
  sessionRev: number | null;
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

/** The page sent `initScenario` (with levers) at `rev`. */
export function leversSession(s: LeverStatusState, rev: number): LeverStatusState {
  return { ...leversSent(s, rev), sessionRev: rev };
}

export function leversError(
  s: LeverStatusState,
  rev: number,
  code: ScenarioErrorCode
): LeverStatusState {
  if (s.sentRev === null) return s;
  // A bad-request above the latest levers sent refused a later request (a reroll), not the
  // levers: the session lives on and the levers' status stands. Every lever refusal is at sentRev.
  if (code === 'bad-request' && rev > s.sentRev) return s;
  const endedSession =
    s.sessionRev !== null &&
    (rev === s.sessionRev || (rev >= s.sessionRev && code !== 'bad-request'));
  if (rev < s.sentRev && !endedSession) return s;
  return { ...s, status: { kind: 'failed', rev } };
}
