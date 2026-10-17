import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { generateWith } from './generate';
import { drawComposition } from './composition-variety';
import { varietyFromUniforms } from './variety';
import { massedUnits, massingApproximate, unitsTolerance } from './units';
import std from './fixtures/std-25x100.json';

/** Same golden draws as golden.spec.ts: deterministic, independent of the seed hash. */
const GOLDEN = varietyFromUniforms([0.5, 0.5, 0.5, 0.5, 0, 0.25]);
const SIMPLE = { ...drawComposition(1), familyOrder: ['simple' as const], capEnabled: false };

describe('massing helpers', () => {
  it('unitsTolerance is max(1, round(10%))', () => {
    expect(unitsTolerance(0)).toBe(1);
    expect(unitsTolerance(1)).toBe(1);
    expect(unitsTolerance(9)).toBe(1);
    expect(unitsTolerance(15)).toBe(2);
    expect(unitsTolerance(20)).toBe(2);
    expect(unitsTolerance(100)).toBe(10);
  });

  const b = generateWith(std as ParcelRecord, { maxStories: 5 }, GOLDEN, 'max', SIMPLE)!;

  it('a user building is not approximate and masses to its own units', () => {
    expect(b.typology).toBe('walkup');
    expect(Math.abs(b.floorAreaM2 - 812.9)).toBeLessThanOrEqual(2); // golden.spec.ts:56
    expect(massedUnits(b)).toBe(b.units);
    expect(massingApproximate(b)).toBe(false);
  });

  it('flags a unit count far from what the floor area supports', () => {
    expect(massedUnits({ ...b, units: 20 })).toBe(9);
    expect(massingApproximate({ ...b, units: 20 })).toBe(true);
    expect(massingApproximate({ ...b, units: 10 })).toBe(false);
  });
});
