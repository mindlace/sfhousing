import { describe, expect, it } from 'vitest';
import type { PlanError, PlanErrorCode } from '$lib/plan';
import { errorForParse } from './publish';

const err = (code: PlanErrorCode, path = ''): PlanError => ({ path, code, message: code });

describe('errorForParse', () => {
  it.each([
    ['not-json', 400, 'invalid_json'],
    ['future-schema', 422, 'unsupported_schema'],
    ['unknown-schema', 422, 'unsupported_schema'],
    ['too-many-ops', 422, 'too_many_ops'],
    ['too-large', 413, 'too_large']
  ] as const)('%s → %i %s without details', (code, status, shareCode) => {
    expect(errorForParse([err(code)])).toEqual({ status, code: shareCode });
  });

  it.each(['bad-field', 'not-object', 'out-of-bounds', 'too-many-points', 'duplicate-id'] as const)(
    '%s → 422 invalid_plan with details',
    (code) => {
      const errors = [err(code, '/ops/0')];
      expect(errorForParse(errors)).toEqual({ status: 422, code: 'invalid_plan', details: errors });
    }
  );

  it('the first error decides the mapping', () => {
    expect(errorForParse([err('too-many-ops'), err('bad-field')]).code).toBe('too_many_ops');
    expect(errorForParse([err('bad-field'), err('too-many-ops')]).code).toBe('invalid_plan');
  });

  it('clips details to the first 20 errors', () => {
    const errors = Array.from({ length: 25 }, (_, i) => err('bad-field', `/ops/${i}`));
    const out = errorForParse(errors);
    expect(out.details).toHaveLength(20);
    expect(out.details).toEqual(errors.slice(0, 20));
  });
});
