import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY4 } from '$lib/timeline/policy4';
import { FIXTURE_1 } from './test/harness';
import { openTimelineProblem, setPolicyProblem } from './timeline-protocol';

const valid = {
  type: 'openTimeline',
  rev: 1,
  manifest: FIXTURE_1.manifest,
  policy: DEFAULT_POLICY4,
  lots: { a: ['p1', 'p2'] },
  worlds: 48,
  months: 480
};

describe('openTimelineProblem', () => {
  it('accepts a valid request', () => {
    expect(openTimelineProblem(valid)).toBeNull();
  });

  it.each([
    ['worlds: 0', { worlds: 0 }],
    ['months: 1.5', { months: 1.5 }],
    ['a missing lots', { lots: undefined }],
    ['lots with a non-string id', { lots: { a: [1] } }],
    ['policy: null', { policy: null }],
    ['a non-integer rev', { rev: 'x' }],
    ['manifest: null', { manifest: null }]
  ])('rejects %s', (_name, patch) => {
    expect(openTimelineProblem({ ...valid, ...patch })).toEqual(expect.any(String));
  });

  it('rejects a non-object', () => {
    expect(openTimelineProblem(null)).toEqual(expect.any(String));
  });
});

describe('setPolicyProblem', () => {
  const set = { type: 'setPolicy', rev: 2, policy: DEFAULT_POLICY4, lots: {} };
  it('accepts a valid request and rejects bad fields', () => {
    expect(setPolicyProblem(set)).toBeNull();
    expect(setPolicyProblem({ ...set, policy: null })).toEqual(expect.any(String));
    expect(setPolicyProblem({ ...set, lots: undefined })).toEqual(expect.any(String));
    expect(setPolicyProblem({ ...set, rev: 1.5 })).toEqual(expect.any(String));
  });
});
