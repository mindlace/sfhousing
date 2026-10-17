import { describe, expect, it } from 'vitest';
import {
  FILL_LEVELS,
  LAND_USE_CLASSES,
  ScenarioFormatError,
  decodeScenarioPayload,
  encodeScenarioPayload,
  envelopeOf,
  featureValue,
  fillStories,
  readScenarioParcels
} from './scenario-codec';

describe('sfh-scenario/1 codec declarations (step 0)', () => {
  it('fixes the fill levels ascending, ending at 1', () => {
    expect([...FILL_LEVELS]).toEqual([0.25, 0.5, 0.75, 0.9, 1]);
    expect(FILL_LEVELS[FILL_LEVELS.length - 1]).toBe(1);
  });

  it('proposes stories per fill level via the shared rule', () => {
    const over = (max: number) => FILL_LEVELS.map((f) => fillStories(f, max));
    expect(over(4)).toEqual([1, 2, 3, 4, 4]);
    expect(over(8)).toEqual([2, 4, 6, 7, 8]);
    expect(over(1)).toEqual([1, 1, 1, 1, 1]);
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

  it('sync functions throw not implemented', () => {
    const bytes = new Uint8Array();
    expect(() => encodeScenarioPayload(undefined as never)).toThrow('not implemented');
    expect(() => decodeScenarioPayload(bytes)).toThrow('not implemented');
    expect(() => featureValue(undefined as never, 0, undefined as never, 'fzp')).toThrow(
      'not implemented'
    );
    expect(() => envelopeOf(undefined as never, 0)).toThrow('not implemented');
  });

  it('readScenarioParcels rejects with not implemented', async () => {
    await expect(readScenarioParcels(new Uint8Array())).rejects.toThrow('not implemented');
  });
});
