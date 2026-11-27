import { describe, expect, it } from 'vitest';
import { LAND_USE_CLASSES, SCENARIO_FORMAT, ScenarioFormatError } from './scenario-codec';

describe('sfh-scenario/2 codec declarations (step 0)', () => {
  it('is format sfh-scenario/2', () => {
    expect(SCENARIO_FORMAT).toBe('sfh-scenario/2');
  });

  it('lists land-use classes in order', () => {
    expect([...LAND_USE_CLASSES]).toEqual([
      'residential',
      'mixed',
      'commercial',
      'pdr',
      'vacant',
      'other'
    ]);
  });

  it('ScenarioFormatError is an Error named ScenarioFormatError', () => {
    const err = new ScenarioFormatError('x');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ScenarioFormatError);
    expect(err.name).toBe('ScenarioFormatError');
    expect(err.message).toBe('x');
  });
});
