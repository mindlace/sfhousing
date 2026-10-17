import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeneratedBuilding } from '../generator';
import type { ParcelRecord } from './parcel';

const generateMock = vi.hoisted(() => vi.fn());

vi.mock('../generator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../generator')>();
  return { ...actual, generate: generateMock };
});

import { fnv1a32 } from '../generator';
import { scenarioYield } from './scenario-yield';

function rec(over: Partial<ParcelRecord> = {}): ParcelRecord {
  return {
    id: '0001001',
    polygon: [
      [
        [-12.5, -20],
        [12.5, -20],
        [12.5, 20],
        [-12.5, 20]
      ]
    ],
    labelPoint: [-122.4194, 37.7749],
    areaM2: 1000,
    existingUnits: 1,
    existingFloorAreaM2: 180,
    existingHeightM: 7,
    landUse: 'RESIDENTIAL',
    eligible: true,
    neighborhood: 'Mission',
    ...over
  };
}

function building(units: number, replacesExisting = true): GeneratedBuilding {
  return { units, replacesExisting } as unknown as GeneratedBuilding;
}

describe('scenarioYield', () => {
  beforeEach(() => {
    generateMock.mockReset();
  });

  it('ADU outcome gives 0', () => {
    generateMock.mockReturnValue(building(2, false));
    expect(scenarioYield(rec(), 4, null)).toBe(0);
  });

  it('null gives 0', () => {
    generateMock.mockReturnValue(null);
    expect(scenarioYield(rec(), 4, null)).toBe(0);
  });

  it('cap clips gross units', () => {
    generateMock.mockReturnValue(building(10));
    expect(scenarioYield(rec(), 4, 6)).toBe(6);
  });

  it('cap at or below existing gives 0', () => {
    generateMock.mockReturnValue(building(10));
    expect(scenarioYield(rec({ existingUnits: 3 }), 4, 3)).toBe(0);
    expect(scenarioYield(rec({ existingUnits: 3 }), 4, 2)).toBe(0);
    expect(scenarioYield(rec({ existingUnits: 3 }), 4, 4)).toBe(4);
  });

  it('no cap passes gross through', () => {
    generateMock.mockReturnValue(building(10));
    expect(scenarioYield(rec(), 4, null)).toBe(10);
  });

  it('stories 0 gives 0 and never calls generate', () => {
    generateMock.mockReturnValue(building(10));
    expect(scenarioYield(rec(), 0, null)).toBe(0);
    expect(scenarioYield(rec(), -3, 5)).toBe(0);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('passes fnv1a32(id) as the seed and { maxStories: stories }', () => {
    generateMock.mockReturnValue(building(10));
    const r = rec({ id: '0042007' });
    scenarioYield(r, 7, null);
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(generateMock).toHaveBeenCalledWith(r, { maxStories: 7 }, fnv1a32('0042007'), 'max');
  });
});
