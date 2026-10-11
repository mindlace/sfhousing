import { describe, expect, it } from 'vitest';
import * as plan from './index';

describe('public surface (spec §2 Internal types)', () => {
  it('exports every function and constant', () => {
    for (const name of [
      'project',
      'opBBox',
      'createParcelIndex',
      'resolveEnvelopes',
      'applyOp',
      'resolveParcels',
      'resolveChunk',
      'parsePlan',
      'validatePlan',
      'serializePlan',
      'planByteSize',
      'quantize',
      'rebasePlan',
      'emptyPlan'
    ]) {
      expect(typeof (plan as Record<string, unknown>)[name], name).toBe('function');
    }
    expect(plan.STORIES_MIN).toBe(1);
    expect(plan.STORIES_MAX).toBe(80);
    expect(plan.RADIUS_MIN_M).toBe(5);
    expect(plan.RADIUS_MAX_M).toBe(500);
    expect(plan.PATH_MAX_POINTS).toBe(2000);
    expect(plan.OPS_MAX).toBe(5000);
    expect(plan.MAX_PLAN_BYTES).toBe(262_144);
    expect(plan.SF_BBOX).toEqual([-123.1738, 37.604, -122.2818, 37.9298]);
    expect(plan.CURRENT_SCHEMA).toBe(1);
    expect(plan.MIGRATIONS).toEqual({});
  });
});
