import { describe, expect, it } from 'vitest';
import { exp } from '../../timelapse/math';
import { carShares, densityOf, meanCars, type ZoneTerms } from './choice';
import { typeCount, typeIndex, type CarModel } from './types';

const prov = {
  tier: 4 as const,
  label: 'x',
  sources: [{ label: 's', url: 'https://x.org' }],
  method: 'm'
};
const asc = [0.1, -0.2, -0.5];
const den = [-0.01, -0.02, -0.03];
const acc = [-0.3, -0.4, -0.5];
const bands = { size: [1, 2], workers: [0, 1], income: [0] };
const T = typeCount(bands);
const hh = Array.from({ length: T * 3 }, (_, i) => 0.05 * i - 0.3);

const model: CarModel = {
  schema: 1,
  bands,
  choice: {
    asc,
    household: hh,
    location: { density: den, access: acc },
    terms: [],
    provenance: prov
  },
  threePlusMean: 3.2,
  moves: { perMonth: new Array(T).fill(0.01), inRatio: [new Array(T).fill(1)], provenance: prov },
  newHomes: {
    mix: {
      market: new Array(T).fill(1 / T),
      veryLow: new Array(T).fill(1 / T),
      low: new Array(T).fill(1 / T),
      moderate: new Array(T).fill(1 / T)
    },
    affordableTiers: { veryLow: 0.3, low: 0.3, moderate: 0.4 },
    provenance: prov
  },
  parking: { supplyOverUse: 1.1, costPerSpace: null, dollarsYear: null, provenance: [] },
  refreshMonths: 12
};
const zones: ZoneTerms = {
  access: new Float64Array([2, 5]),
  constant: new Float64Array([0.1, 0.2, 0.3, -0.1, -0.2, -0.3])
};

describe('carShares', () => {
  it('is the softmax of asc + household + location + zone constant', () => {
    const out = new Float64Array(4);
    carShares(model, zones, 0, 1, 10, out);
    expect(out[0] + out[1] + out[2] + out[3]).toBeCloseTo(1, 12);
    for (let k = 0; k < 3; k++) {
      const u = asc[k] + hh[3 + k] + den[k] * 10 + acc[k] * 2 + zones.constant[k];
      expect(out[k + 1] / out[0]).toBeCloseTo(exp(u), 12);
    }
  });

  it('reads the zone asked for', () => {
    const a = new Float64Array(4);
    const b = new Float64Array(4);
    carShares(model, zones, 0, 0, 0, a);
    carShares(model, zones, 1, 0, 0, b);
    expect(a[0]).not.toBe(b[0]);
  });
});

describe('meanCars and densityOf', () => {
  it('counts the 3+ level at its mean', () => {
    expect(meanCars([0.1, 0.2, 0.3, 0.4], 3.5)).toBeCloseTo(0.2 + 0.6 + 1.4, 12);
  });
  it('is households per hectare, 0 for no area', () => {
    expect(densityOf(50, 10_000)).toBe(50);
    expect(densityOf(5, 0)).toBe(0);
  });
});

describe('types', () => {
  it('numbers types row-major with owner first, clamping bands', () => {
    expect(T).toBe(8);
    expect(typeIndex(bands, 1, 0, 0, true)).toBe(0);
    expect(typeIndex(bands, 1, 0, 0, false)).toBe(1);
    expect(typeIndex(bands, 2, 1, 5, false)).toBe(T - 1);
    expect(typeIndex(bands, -3, -1, -1, true)).toBe(0);
  });
});
