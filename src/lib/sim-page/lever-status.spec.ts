import { describe, expect, it } from 'vitest';
import type { LeversResponse } from '$lib/sim/scenario/types';
import {
  leversError,
  leversMessage,
  leversSent,
  leversSession,
  type LeverStatusState
} from './lever-status';

const OFF: LeverStatusState = { sentRev: null, sessionRev: null, status: { kind: 'off' } };
const resolving = (rev: number): LeversResponse => ({
  type: 'levers',
  rev,
  phase: 'resolving',
  done: 1,
  total: 3,
  failedCells: ['a']
});
const current = (rev: number): LeversResponse =>
  ({
    type: 'levers',
    rev,
    phase: 'current',
    lookups: {},
    capacity: {},
    unknownLots: 0
  }) as unknown as LeversResponse;

describe('lever status', () => {
  it('leversSent starts resolving 0/0', () => {
    const s = leversSent(OFF, 2);
    expect(s.sentRev).toBe(2);
    expect(s.status).toEqual({ kind: 'resolving', rev: 2, done: 0, total: 0, failedCells: [] });
  });

  it('reroll while resolving keeps the status', () => {
    let s = leversSent(OFF, 2);
    // a reroll at rev 3 does not touch lever status; messages for rev 2 still land
    s = leversMessage(s, resolving(2));
    expect(s.status.kind).toBe('resolving');
    s = leversMessage(s, current(2));
    expect(s.status.kind).toBe('current');
  });

  it('drops an older message and fails on an error at or after the sent rev', () => {
    const s = leversSent(OFF, 2);
    expect(leversMessage(s, current(1))).toEqual(s);
    expect(leversMessage(s, resolving(1))).toEqual(s);
    expect(leversError(s, 1, 'scenario-invalid')).toEqual(s);
    expect(leversError(s, 2, 'scenario-invalid').status).toEqual({ kind: 'failed', rev: 2 });
  });

  it('load failure fails the status', () => {
    const s = leversSent(leversSession(OFF, 1), 2);
    expect(leversError(s, 1, 'scenario-invalid').status).toEqual({ kind: 'failed', rev: 1 });
    expect(leversError(s, 1, 'bad-request').status.kind).toBe('failed'); // rev === sessionRev
    expect(leversError(leversSent(leversSession(OFF, 1), 2), 3, 'bad-request').status.kind).toBe(
      'failed'
    ); // rev >= sentRev
  });

  it('keeps a current at a rev above the sent rev', () => {
    const s = leversMessage(leversSent(OFF, 2), current(3));
    expect(s.status.kind).toBe('current');
  });
});
