import { describe, expect, it } from 'vitest';
import { datasetDecision } from './dataset';

const P = 'fixture-1';
const O = 'fixture-0';
const N = 'fixture-2';

describe('datasetDecision', () => {
  it.each([
    [null, null, 'edit'],
    [null, P, 'edit'],
    [null, N, 'edit'],
    [P, null, 'edit'],
    [P, P, 'edit'],
    [P, N, 'edit'],
    [O, null, 'stop:unknown-dataset'],
    [O, P, 'move'],
    [O, N, 'stop:stale'],
    [O, O, 'stop:stale']
  ] as const)('fold %s, server %s: %s', (fold, server, want) => {
    const d = datasetDecision(P, fold, server);
    expect(d.kind === 'stop' ? `stop:${d.why}` : d.kind).toBe(want);
  });
});
