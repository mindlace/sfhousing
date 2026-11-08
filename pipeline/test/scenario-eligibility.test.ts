import { describe, expect, it } from 'vitest';
import { NO_LAND_USE, scenarioEligible } from '../lib/scenario-eligibility';

describe('scenarioEligible road-like', () => {
  it('a road-like lot is never scenario-eligible', () => {
    expect(scenarioEligible({ eligible: true, landUse: 'VACANT', roadLike: 'r1n' }, 0)).toBe(false);
  });
  it('a road-like NONE lot with roll homes is not eligible', () => {
    expect(scenarioEligible({ eligible: false, landUse: NO_LAND_USE, roadLike: 'r7' }, 3)).toBe(
      false
    );
    expect(scenarioEligible({ eligible: false, landUse: NO_LAND_USE }, 3)).toBe(true);
  });
});
