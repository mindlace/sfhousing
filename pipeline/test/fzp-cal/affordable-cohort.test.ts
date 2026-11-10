import { describe, expect, it } from 'vitest';
import {
  AFFORDABLE_COHORT_SHARE,
  isAffordableCohort,
  startCohort
} from '../../lib/affordable-cohort';

describe('affordable cohort', () => {
  it.each([
    [{ units: 20, affordable: 19 }, 'affordable'],
    [{ units: 20, affordable: 18 }, 'private'],
    [{ units: 20, affordable: 20 }, 'affordable'],
    [{ units: 20, affordable: 21 }, 'affordable'],
    [{ units: 0, affordable: 0 }, 'unknown'],
    [{ units: null, affordable: 5 }, 'unknown'],
    [{ units: 20, affordable: null }, 'unknown'],
    [null, 'noRecord'],
    [undefined, 'noRecord']
  ] as const)('startCohort(%j) is %s', (p, want) => {
    expect(startCohort(p)).toBe(want);
    expect(isAffordableCohort(p)).toBe(want === 'affordable');
  });

  it('exports the share', () => expect(AFFORDABLE_COHORT_SHARE).toBe(0.95));
});
